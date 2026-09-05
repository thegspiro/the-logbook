"""The EMT rows created between two deploys, which no earlier revision reaches.

``f3b8d0c26a17`` revokes these grants from ``emt``, but a migration runs once.
Until the registry gained an ``emt`` entry the onboarding wizard had nothing
seeded behind that slug, so ``save_session_roles`` created the row from the
position editor's checkbox expansion — the role-type heuristic's output, with
``reports.view`` in it. A department onboarding after ``f3b8d0c26a17`` was
stamped therefore holds a fresh row that revision will never revisit.

``a2e9f6b04c71`` repeats the revocation for that one slug, so the repair does
not depend on the registry entry and ``f3b8d0c26a17`` landing in one release.
"""

import importlib.util
import json
from pathlib import Path

import pytest
import sqlalchemy as sa

from app.core.permissions import DEFAULT_POSITIONS, OPERATIONAL_RANKS

_VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
_PATH = _VERSIONS / (
    "20260905_0110_a2e9f6b04c71_revoke_emt_over_grants_written_after_f3b8d0c26a17.py"
)
_PRIOR = _VERSIONS / (
    "20260904_2050_f3b8d0c26a17_revoke_wizard_over_grants_unconditionally.py"
)


def _load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _migration():
    return _load(_PATH, "_emt_window")


class _Op:
    """Stands in for ``alembic.op``, which only exists inside a real upgrade.

    The module is loaded by path and never registered in ``sys.modules``, so
    replacing its ``op`` cannot leak into another test (CLAUDE.md pitfall #22).
    """

    def __init__(self, bind):
        self._bind = bind

    def get_bind(self):
        return self._bind


@pytest.fixture
def engine():
    engine = sa.create_engine("sqlite://")
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture
def positions_table(engine):
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                "CREATE TABLE positions ("
                "  id VARCHAR(36) PRIMARY KEY,"
                "  slug VARCHAR(100),"
                "  is_system BOOLEAN,"
                "  permissions TEXT"
                ")"
            )
        )
    return engine


def _run_upgrade(engine):
    module = _migration()
    with engine.begin() as conn:
        module.op = _Op(conn)
        module.upgrade()


def _revoke_row(engine, slug, permissions, is_system=True):
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                "INSERT INTO positions (id, slug, is_system, permissions) "
                "VALUES ('row', :slug, :is_system, :permissions)"
            ),
            {
                "slug": slug,
                "is_system": is_system,
                "permissions": json.dumps(list(permissions)),
            },
        )
    _run_upgrade(engine)
    with engine.connect() as conn:
        raw = conn.execute(
            sa.text("SELECT permissions FROM positions WHERE id = 'row'")
        ).scalar_one()
    return json.loads(raw)


class TestTheWindowRow:
    def test_a_wizard_created_emt_row_loses_the_reporting_grant(self, positions_table):
        """The row the create branch wrote after the prior revision ran."""
        wizard = ["members.view", "reports.view", "training.view", "storefront.view"]

        result = _revoke_row(positions_table, "emt", wizard)

        assert "reports.view" not in result
        assert result == ["members.view", "training.view", "storefront.view"]

    @pytest.mark.parametrize("form", ["reports.*", "reports.manage"])
    def test_the_manage_forms_go_too(self, positions_table, form):
        result = _revoke_row(positions_table, "emt", ["members.view", form])

        assert result == ["members.view"]

    def test_a_clean_row_is_untouched(self, positions_table):
        seeded = list(DEFAULT_POSITIONS["emt"]["permissions"])

        assert _revoke_row(positions_table, "emt", seeded) == seeded

    def test_it_is_idempotent(self, positions_table):
        wizard = ["members.view", "reports.view"]
        with positions_table.begin() as conn:
            conn.execute(
                sa.text(
                    "INSERT INTO positions (id, slug, is_system, permissions) "
                    "VALUES ('row', 'emt', 1, :p)"
                ),
                {"p": json.dumps(wizard)},
            )
        _run_upgrade(positions_table)
        with positions_table.connect() as conn:
            once = conn.execute(
                sa.text("SELECT permissions FROM positions WHERE id = 'row'")
            ).scalar_one()
        _run_upgrade(positions_table)
        with positions_table.connect() as conn:
            assert (
                conn.execute(
                    sa.text("SELECT permissions FROM positions WHERE id = 'row'")
                ).scalar_one()
                == once
            )


class TestWhatItMustNotTouch:
    def test_a_department_created_position_is_left_alone(self, positions_table):
        stored = ["reports.view", "members.view"]

        assert _revoke_row(positions_table, "emt", stored, is_system=False) == stored

    @pytest.mark.parametrize("slug", ["member", "firefighter", "engineer", "captain"])
    def test_other_slugs_are_left_alone(self, positions_table, slug):
        """Scoped to emt: those were seeded throughout the window, so nothing
        was being created from the heuristic for them, and ``f3b8d0c26a17``
        already settled the rows that existed."""
        stored = ["reports.view", "members.view"]

        assert _revoke_row(positions_table, slug, stored) == stored

    def test_it_no_ops_when_the_table_does_not_exist(self, engine):
        _run_upgrade(engine)


class TestItAgreesWithWhatItRepeats:
    def test_it_revokes_what_the_prior_revision_revokes_from_emt(self):
        """A divergence would mean one of the two is wrong about the same row."""
        prior = _load(_PRIOR, "_prior")
        assert set(_migration()._REVOKE) == set(prior._REVOKE["emt"])

    def test_nothing_it_revokes_is_seeded_to_emt(self):
        seeded = set(OPERATIONAL_RANKS["emt"]["default_permissions"])
        for permission in _migration()._REVOKE:
            assert permission not in seeded, permission

    def test_it_is_wired_into_the_migration_chain(self):
        module = _migration()
        assert module.revision == "a2e9f6b04c71"
        assert module.down_revision == "f3b8d0c26a17"
