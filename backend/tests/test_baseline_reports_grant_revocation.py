"""``reports.view`` must not survive on a rank-and-file position row.

The registry has never seeded it — ``test_baseline_member_grants.py``'s
``test_baseline_excludes_the_reporting_and_audit_grants`` guards that, and
passes. The grant reaches departments through the *stored* row: the old
onboarding position editor derived its defaults from a module-category
heuristic rather than from ``DEFAULT_POSITIONS`` and saved that over the
seeded rows, and ``dependencies.py`` unions every assigned position's stored
permissions (CLAUDE.md pitfall #23).

``20260901_1320_f7b3c8d2e569`` was written for that overwrite and drops
``reports.view`` from both slugs — but only from a row matching the
heuristic's output *in full*, and four migrations mutate those rows before it
runs. A department that onboarded before them holds the heuristic output minus
one or two permissions, so its row is skipped and the grant stays live. That
is the case exercised below by
``test_it_revokes_the_grant_the_whole_list_match_skipped``.

These tests drive the migration's ``upgrade()`` against a real table rather
than restating its constants, because the ordering bug above was invisible in
a constants-only reading of ``f7b3c8d2e569``.
"""

import importlib.util
import json
from pathlib import Path

import pytest
import sqlalchemy as sa

_VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
_PATH = _VERSIONS / "20260904_1200_c9a5e21f7b04_revoke_baseline_reports_view.py"
_REPAIR_PATH = (
    _VERSIONS / "20260901_1320_f7b3c8d2e569_restore_seeded_position_grants.py"
)


def _load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _migration():
    return _load(_PATH, "_revoke_reports_view")


def _repair_migration():
    return _load(_REPAIR_PATH, "_restore_seeded_grants")


class _Op:
    """Stands in for ``alembic.op``, which only exists inside a real upgrade.

    The migration module is loaded by path and never registered in
    ``sys.modules``, so replacing its ``op`` attribute cannot leak into another
    test the way patching a shared module would (CLAUDE.md pitfall #22).
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


def _insert(conn, row_id, slug, permissions, is_system=True):
    conn.execute(
        sa.text(
            "INSERT INTO positions (id, slug, is_system, permissions) "
            "VALUES (:id, :slug, :is_system, :permissions)"
        ),
        {
            "id": row_id,
            "slug": slug,
            "is_system": is_system,
            "permissions": json.dumps(list(permissions)),
        },
    )


def _stored(conn, row_id):
    raw = conn.execute(
        sa.text("SELECT permissions FROM positions WHERE id = :id"), {"id": row_id}
    ).scalar_one()
    return json.loads(raw)


_MARKERS = (
    "integrations.view",
    "medical_supplies.view",
    "mobile.view",
    "prospective_members.view",
)


def _run_upgrade(engine):
    module = _migration()
    with engine.begin() as conn:
        module.op = _Op(conn)
        module.upgrade()


class TestTheRevocation:
    def test_it_revokes_the_grant_from_both_seeded_slugs(self, positions_table):
        wizard = ["events.view", "mobile.view", "reports.view"]
        with positions_table.begin() as conn:
            _insert(conn, "m", "member", wizard)
            _insert(conn, "f", "firefighter", wizard)

        _run_upgrade(positions_table)

        with positions_table.connect() as conn:
            assert "reports.view" not in _stored(conn, "m")
            assert "reports.view" not in _stored(conn, "f")

    def test_it_revokes_the_grant_the_whole_list_match_skipped(self, positions_table):
        """The row ``f7b3c8d2e569`` walks past: heuristic output, one edit on.

        ``e4f5a6b7c8d9`` strips ``facilities.view`` from these rows before the
        repair migration runs, while the repair's ``old`` list still carries
        it — so the whole-list comparison misses, and this is the department
        that still has the grant today.
        """
        heuristic = list(_repair_migration()._REWRITES["member"]["old"])
        assert "reports.view" in heuristic, "fixture drifted from the repair table"
        stored = [p for p in heuristic if p != "facilities.view"]

        with positions_table.begin() as conn:
            _insert(conn, "m", "member", stored)

        _run_upgrade(positions_table)

        with positions_table.connect() as conn:
            assert "reports.view" not in _stored(conn, "m")

    def test_it_leaves_every_other_grant_in_place(self, positions_table):
        """A revocation that quietly reshaped the row would be a second bug."""
        stored = list(_repair_migration()._REWRITES["member"]["old"])

        with positions_table.begin() as conn:
            _insert(conn, "m", "member", stored)

        _run_upgrade(positions_table)

        with positions_table.connect() as conn:
            assert _stored(conn, "m") == [p for p in stored if p != "reports.view"]

    def test_it_is_idempotent(self, positions_table):
        with positions_table.begin() as conn:
            _insert(conn, "m", "member", ["events.view", "mobile.view", "reports.view"])

        _run_upgrade(positions_table)
        with positions_table.connect() as conn:
            once = _stored(conn, "m")
        _run_upgrade(positions_table)
        with positions_table.connect() as conn:
            assert _stored(conn, "m") == once
            assert "reports.view" not in once

    def test_a_row_without_the_grant_is_untouched(self, positions_table):
        with positions_table.begin() as conn:
            _insert(conn, "m", "member", ["events.view", "training.view"])

        _run_upgrade(positions_table)

        with positions_table.connect() as conn:
            assert _stored(conn, "m") == ["events.view", "training.view"]


class TestItOnlyTouchesTheWizardsRows:
    """``is_system = True`` does not mean "untouched default".

    ``RoleService.update_role`` (``app/services/role_service.py:283-311``) lets
    an organization edit a built-in position's permissions in place and leaves
    the flag set, so a department can deliberately grant ``reports.view`` to its
    own Member position. Only a row still carrying the wizard's fingerprint is
    this migration's to change.
    """

    @pytest.mark.parametrize("slug", ["member", "firefighter"])
    def test_a_deliberate_grant_on_a_clean_row_survives(self, positions_table, slug):
        curated = ["events.view", "members.view", "training.view", "reports.view"]

        with positions_table.begin() as conn:
            _insert(conn, "row", slug, curated)

        _run_upgrade(positions_table)

        with positions_table.connect() as conn:
            assert _stored(conn, "row") == curated

    @pytest.mark.parametrize("marker", _MARKERS)
    def test_any_single_marker_identifies_a_wizard_row(self, positions_table, marker):
        """The four are revoked by ``d1c7f4a92e63`` and could be edited away
        individually, so requiring all of them would re-create the whole-list
        brittleness this migration exists to avoid."""
        with positions_table.begin() as conn:
            _insert(conn, "row", "member", [marker, "reports.view"])

        _run_upgrade(positions_table)

        with positions_table.connect() as conn:
            assert "reports.view" not in _stored(conn, "row")

    def test_the_markers_are_not_seeded_to_the_covered_slugs(self):
        """A marker that became legitimate would stop identifying a wizard row."""
        from app.core.permissions import DEFAULT_POSITIONS

        for slug in _migration()._SLUGS:
            seeded = set(DEFAULT_POSITIONS[slug]["permissions"])
            for marker in _MARKERS:
                assert marker not in seeded, (slug, marker)


class TestWhatItMustNotTouch:
    def test_a_department_customized_row_is_left_alone(self, positions_table):
        """``is_system = False`` is a position the department made its own."""
        with positions_table.begin() as conn:
            _insert(conn, "m", "member", ["reports.view"], is_system=False)

        _run_upgrade(positions_table)

        with positions_table.connect() as conn:
            assert _stored(conn, "m") == ["reports.view"]

    def test_an_officer_position_keeps_the_grant(self, positions_table):
        """``reports.view`` is seeded to officers by design."""
        with positions_table.begin() as conn:
            _insert(conn, "s", "secretary", ["reports.view", "minutes.manage"])
            _insert(conn, "c", "captain", ["reports.view"])

        _run_upgrade(positions_table)

        with positions_table.connect() as conn:
            assert "reports.view" in _stored(conn, "s")
            assert "reports.view" in _stored(conn, "c")

    def test_it_no_ops_when_the_table_does_not_exist(self, engine):
        """``positions`` is built by ``create_all``, not by any migration, and
        CI runs ``alembic upgrade head`` against an empty database — reflecting
        it unguarded would fail the whole upgrade (CLAUDE.md pitfall #26)."""
        _run_upgrade(engine)


class TestItCoversTheWholeBaseline:
    def test_the_slugs_are_the_positions_the_baseline_set_is_stored_under(self):
        """Both, not just ``member``.

        ``DEFAULT_POSITIONS["firefighter"]["permissions"]`` *is*
        ``OPERATIONAL_RANKS["firefighter"]["default_permissions"]`` — the same
        list object — so onboarding writes a system position under that slug
        too, and a member holding it would keep the grant if only ``member``
        were rewritten.
        """
        from app.core.permissions import DEFAULT_POSITIONS, OPERATIONAL_RANKS

        assert set(_migration()._SLUGS) == {"member", "firefighter"}
        assert (
            DEFAULT_POSITIONS["firefighter"]["permissions"]
            is OPERATIONAL_RANKS["firefighter"]["default_permissions"]
        ), "the aliasing this migration relies on has been broken; re-check _SLUGS"

    def test_the_registry_does_not_re_seed_what_this_revokes(self):
        """Otherwise the next onboarding writes the grant straight back."""
        from app.core.permissions import DEFAULT_POSITIONS

        for slug in _migration()._SLUGS:
            assert "reports.view" not in DEFAULT_POSITIONS[slug]["permissions"]

    def test_it_is_wired_into_the_migration_chain(self):
        module = _migration()
        assert module.revision == "c9a5e21f7b04"
        assert module.down_revision == "bbdaca0844df"
