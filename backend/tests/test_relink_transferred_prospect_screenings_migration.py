"""Migration beedcad5b36a: a transferred prospect's screenings follow the member.

Run against a real (SQLite) connection with rows already in the tables, because
a data migration proves nothing on the empty database CI migrates (CLAUDE.md
Pitfall #35). Each awkward row is here: a prospect still in the pipeline, a
member since deleted, a member in another organization, a record that already
names a member, a status stored by name rather than value.
"""

import importlib.util
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

pytestmark = pytest.mark.unit

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MATCHES = sorted(VERSIONS.glob("*_beedcad5b36a_*.py"))
assert len(MATCHES) == 1, f"expected exactly one migration, found {MATCHES}"


def _migration():
    spec = importlib.util.spec_from_file_location("relink_screenings", MATCHES[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def engine():
    database = sa.create_engine("sqlite://")
    yield database
    database.dispose()


def _seed(engine):
    statements = [
        "CREATE TABLE users (id TEXT PRIMARY KEY, organization_id TEXT)",
        "CREATE TABLE prospective_members (id TEXT PRIMARY KEY, "
        "organization_id TEXT, status TEXT, transferred_user_id TEXT)",
        "CREATE TABLE screening_records (id TEXT PRIMARY KEY, "
        "organization_id TEXT, prospect_id TEXT, user_id TEXT)",
        "INSERT INTO users VALUES ('u-rowan', 'org-a'), ('u-sky', 'org-a'), "
        "('u-elsewhere', 'org-b'), ('u-other', 'org-a')",
        "INSERT INTO prospective_members VALUES "
        # Transferred, status stored by value and by name.
        "('p-rowan', 'org-a', 'transferred', 'u-rowan'), "
        "('p-sky', 'org-a', 'TRANSFERRED', 'u-sky'), "
        # Still in the pipeline.
        "('p-waiting', 'org-a', 'active', NULL), "
        # Transferred to a member since deleted.
        "('p-gone', 'org-a', 'transferred', 'u-deleted'), "
        # Names a user in another organization.
        "('p-cross', 'org-a', 'transferred', 'u-elsewhere')",
        "INSERT INTO screening_records VALUES "
        "('r-rowan-1', 'org-a', 'p-rowan', NULL), "
        "('r-rowan-2', 'org-a', 'p-rowan', NULL), "
        "('r-sky', 'org-a', 'p-sky', NULL), "
        "('r-waiting', 'org-a', 'p-waiting', NULL), "
        "('r-gone', 'org-a', 'p-gone', NULL), "
        "('r-cross', 'org-a', 'p-cross', NULL), "
        # Already names a member: never overwritten.
        "('r-named', 'org-a', 'p-rowan', 'u-other'), "
        # Filed against the member after joining: no prospect.
        "('r-member', 'org-a', NULL, 'u-rowan')",
    ]
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(sa.text(statement))


def _run(engine, step):
    module = _migration()
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            getattr(module, step)()


def _owners(engine):
    with engine.begin() as connection:
        rows = connection.execute(
            sa.text("SELECT id, prospect_id, user_id FROM screening_records")
        ).fetchall()
    return {row.id: (row.prospect_id, row.user_id) for row in rows}


BEFORE = {
    "r-rowan-1": ("p-rowan", None),
    "r-rowan-2": ("p-rowan", None),
    "r-sky": ("p-sky", None),
    "r-waiting": ("p-waiting", None),
    "r-gone": ("p-gone", None),
    "r-cross": ("p-cross", None),
    "r-named": ("p-rowan", "u-other"),
    "r-member": (None, "u-rowan"),
}

AFTER = {
    **BEFORE,
    "r-rowan-1": ("p-rowan", "u-rowan"),
    "r-rowan-2": ("p-rowan", "u-rowan"),
    "r-sky": ("p-sky", "u-sky"),
}


class TestRelinkTransferredProspectScreenings:
    def test_files_each_transferred_prospects_records_under_the_member(self, engine):
        _seed(engine)
        assert _owners(engine) == BEFORE

        _run(engine, "upgrade")

        assert _owners(engine) == AFTER

    def test_running_twice_is_a_no_op(self, engine):
        _seed(engine)
        _run(engine, "upgrade")
        _run(engine, "upgrade")

        assert _owners(engine) == AFTER

    def test_downgrade_undoes_exactly_what_upgrade_did(self, engine):
        _seed(engine)
        _run(engine, "upgrade")

        _run(engine, "downgrade")

        assert _owners(engine) == BEFORE

    def test_a_missing_table_is_nothing_to_relink(self, engine):
        with engine.begin() as connection:
            connection.execute(
                sa.text(
                    "CREATE TABLE screening_records (id TEXT PRIMARY KEY, "
                    "organization_id TEXT, prospect_id TEXT, user_id TEXT)"
                )
            )

        _run(engine, "upgrade")
        _run(engine, "downgrade")
