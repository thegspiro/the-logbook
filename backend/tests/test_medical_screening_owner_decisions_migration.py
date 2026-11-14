"""Migration d6906e3dd76c: the view_details grant and the requirement-link backfill.

Run against a real (SQLite) connection with rows already in the tables, because
a data migration proves nothing on the empty database CI migrates (CLAUDE.md
Pitfall #35). The awkward rows are here: a department-created position, a
wildcard holder, a manage-only position, a stored JSON string; for records, a
type with one active requirement, one with two, one with only an inactive
requirement, one with none, a record already linked, and the same type in
another organization.
"""

import importlib.util
import json
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext

pytestmark = pytest.mark.unit

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
MATCHES = sorted(VERSIONS.glob("*_d6906e3dd76c_*.py"))
assert len(MATCHES) == 1, f"expected exactly one migration, found {MATCHES}"


def _migration():
    spec = importlib.util.spec_from_file_location("ms_owner_decisions", MATCHES[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def engine():
    database = sa.create_engine("sqlite://")
    yield database
    database.dispose()


POSITIONS = {
    # Department-created status reader: written.
    "p-clerk": ["medical_screening.view", "members.view"],
    # Seeded-looking officer holding view and manage: written.
    "p-officer": ["medical_screening.view", "medical_screening.manage"],
    # Manage only: reads the narrative by rule, not written.
    "p-manager": ["medical_screening.manage"],
    # Wildcards already cover it.
    "p-admin": ["*"],
    "p-module": ["medical_screening.*"],
    # Already holds it.
    "p-done": ["medical_screening.view", "medical_screening.view_details"],
    # Nothing to do with screening.
    "p-member": ["events.view"],
    "p-empty": [],
}


def _seed(engine):
    with engine.begin() as connection:
        connection.execute(
            sa.text("CREATE TABLE positions (id TEXT PRIMARY KEY, permissions TEXT)")
        )
        for position_id, permissions in POSITIONS.items():
            connection.execute(
                sa.text("INSERT INTO positions VALUES (:id, :p)"),
                {"id": position_id, "p": json.dumps(permissions)},
            )
        for statement in (
            "CREATE TABLE screening_requirements (id TEXT PRIMARY KEY, "
            "organization_id TEXT, screening_type TEXT, is_active BOOLEAN)",
            "CREATE TABLE screening_records (id TEXT PRIMARY KEY, "
            "organization_id TEXT, screening_type TEXT, requirement_id TEXT)",
            "INSERT INTO screening_requirements VALUES "
            # One active physical requirement, plus an inactive one: the
            # active one is chosen.
            "('req-physical', 'org-a', 'physical_exam', 1), "
            "('req-physical-old', 'org-a', 'physical_exam', 0), "
            # Two active drug requirements: ambiguous.
            "('req-drug-annual', 'org-a', 'drug_screening', 1), "
            "('req-drug-random', 'org-a', 'drug_screening', 1), "
            # Only an inactive vision requirement: still the only one.
            "('req-vision', 'org-a', 'vision_hearing', 0), "
            # Another org's physical requirement.
            "('req-physical-b', 'org-b', 'physical_exam', 1)",
            "INSERT INTO screening_records VALUES "
            "('r-physical', 'org-a', 'physical_exam', NULL), "
            "('r-drug', 'org-a', 'drug_screening', NULL), "
            "('r-vision', 'org-a', 'vision_hearing', NULL), "
            "('r-psych', 'org-a', 'psychological', NULL), "
            # Already linked, to the inactive one: never overwritten.
            "('r-linked', 'org-a', 'physical_exam', 'req-physical-old'), "
            "('r-physical-b', 'org-b', 'physical_exam', NULL)",
        ):
            connection.execute(sa.text(statement))


def _run(engine, step):
    module = _migration()
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            getattr(module, step)()


def _permissions(engine) -> dict:
    with engine.connect() as connection:
        rows = connection.execute(sa.text("SELECT id, permissions FROM positions"))
        return {row.id: json.loads(row.permissions) for row in rows}


def _links(engine) -> dict:
    with engine.connect() as connection:
        rows = connection.execute(
            sa.text("SELECT id, requirement_id FROM screening_records")
        )
        return {row.id: row.requirement_id for row in rows}


def test_view_holders_gain_view_details_and_nobody_else_changes(engine):
    _seed(engine)

    _run(engine, "upgrade")

    after = _permissions(engine)
    written = {pid for pid, perms in after.items() if perms != POSITIONS[pid]}
    assert written == {"p-clerk", "p-officer"}
    assert after["p-clerk"] == [
        "medical_screening.view",
        "members.view",
        "medical_screening.view_details",
    ]
    assert "medical_screening.view_details" not in after["p-manager"]


def test_unambiguous_records_are_linked_and_ambiguous_ones_left(engine):
    _seed(engine)

    _run(engine, "upgrade")

    assert _links(engine) == {
        "r-physical": "req-physical",
        "r-drug": None,  # two active drug requirements
        "r-vision": "req-vision",
        "r-psych": None,  # no requirement of the type
        "r-linked": "req-physical-old",
        "r-physical-b": "req-physical-b",
    }


def test_running_twice_changes_nothing_more(engine):
    _seed(engine)
    _run(engine, "upgrade")
    once = (_permissions(engine), _links(engine))

    _run(engine, "upgrade")

    assert (_permissions(engine), _links(engine)) == once


def test_downgrade_removes_the_grant_and_keeps_the_links(engine):
    _seed(engine)
    _run(engine, "upgrade")
    links = _links(engine)

    _run(engine, "downgrade")

    assert _permissions(engine) == {
        **POSITIONS,
        "p-done": ["medical_screening.view"],
    }
    assert _links(engine) == links


def test_a_missing_table_is_skipped(engine):
    """Defensive: neither step fails on a database without the tables."""
    _run(engine, "upgrade")
    _run(engine, "downgrade")
