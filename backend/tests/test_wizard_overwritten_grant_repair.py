"""The rest of the wizard overwrite, on the rows ``f7b3c8d2e569`` walks past.

The onboarding position editor replaced each seeded row with a module-category
heuristic's output. ``f7b3c8d2e569`` holds the correct target list per slug but
only rewrites a row matching that output *in full*, and four migrations mutate
these rows before it runs — so a department that onboarded before them is a
permission or two off, its row is skipped, and every discrepancy survives.

``d1c7f4a92e63`` settles what is left for ``member``, ``firefighter`` and
``engineer``. These tests drive it against a real table rather than restating
its constants, and the centrepiece is
``TestTheEndState::test_a_wizard_row_ends_up_matching_the_registry``: it
reconstructs the row as it actually exists today — heuristic output with the
earlier per-permission revocations already applied — and asserts that after this
migration it equals ``DEFAULT_POSITIONS`` exactly. That is the property the
whole repair chain exists to produce, and no reading of the constants
establishes it.
"""

import importlib.util
import json
from pathlib import Path

import pytest
import sqlalchemy as sa

from app.core.permissions import DEFAULT_POSITIONS

_VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
_PATH = _VERSIONS / (
    "20260904_1640_d1c7f4a92e63_repair_wizard_overwritten_baseline_grants.py"
)
_REPAIR_PATH = (
    _VERSIONS / "20260901_1320_f7b3c8d2e569_restore_seeded_position_grants.py"
)

#: What the earlier per-permission migrations had already stripped from these
#: rows by the time this one runs. Each is unconditional, so it applies whatever
#: else the row holds — which is why the row reaching us is the heuristic's
#: output minus exactly these.
#:
#: * ``facilities.view`` — ``e4f5a6b7c8d9`` (member, firefighter, emt, engineer)
#: * ``notifications.view`` — ``a1f7c34e9b02`` (member, firefighter, engineer)
#: * ``reports.view`` — ``c9a5e21f7b04`` (member, firefighter only; engineer is
#:   this migration's to remove)
#:
#: ``compliance.view`` (``31e2816df7c3``) is absent from the heuristic's output
#: for member and firefighter, and is legitimately seeded to engineer, so it
#: does not appear here.
_ALREADY_REVOKED = {
    "member": ("facilities.view", "notifications.view", "reports.view"),
    "firefighter": ("facilities.view", "notifications.view", "reports.view"),
    "engineer": ("facilities.view", "notifications.view"),
}


def _load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _migration():
    return _load(_PATH, "_repair_wizard_grants")


def _heuristic_output(slug):
    """The row the old editor wrote, from the repair migration's frozen table."""
    return list(_load(_REPAIR_PATH, "_restore_seeded_grants")._REWRITES[slug]["old"])


def _row_as_it_exists_today(slug):
    already = set(_ALREADY_REVOKED[slug])
    return [p for p in _heuristic_output(slug) if p not in already]


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


def _run_upgrade(engine):
    module = _migration()
    with engine.begin() as conn:
        module.op = _Op(conn)
        module.upgrade()


def _repair_row(engine, slug, permissions, is_system=True):
    """Insert one row, run the migration, return what it holds afterwards."""
    with engine.begin() as conn:
        _insert(conn, "row", slug, permissions, is_system=is_system)
    _run_upgrade(engine)
    with engine.connect() as conn:
        return _stored(conn, "row")


SLUGS = ("member", "firefighter", "engineer")


class TestTheEndState:
    """What the repair chain exists to produce."""

    @pytest.mark.parametrize("slug", SLUGS)
    def test_a_wizard_row_ends_up_matching_the_registry(self, positions_table, slug):
        result = _repair_row(positions_table, slug, _row_as_it_exists_today(slug))

        assert sorted(result) == sorted(DEFAULT_POSITIONS[slug]["permissions"])

    @pytest.mark.parametrize("slug", SLUGS)
    def test_an_already_correct_row_is_not_rewritten(self, positions_table, slug):
        seeded = list(DEFAULT_POSITIONS[slug]["permissions"])

        assert _repair_row(positions_table, slug, seeded) == seeded


class TestTheRevocations:
    @pytest.mark.parametrize("slug", SLUGS)
    def test_every_over_grant_is_removed(self, positions_table, slug):
        result = _repair_row(positions_table, slug, _row_as_it_exists_today(slug))

        for permission in _migration()._REVOKE[slug]:
            assert permission not in result

    def test_it_removes_them_whatever_else_the_row_holds(self, positions_table):
        """The case ``f7b3c8d2e569``'s whole-list match skips."""
        stored = ["integrations.view", "mobile.view", "some.custom.grant"]

        result = _repair_row(positions_table, "member", stored)

        assert "integrations.view" not in result
        assert "mobile.view" not in result
        assert "some.custom.grant" in result

    def test_it_leaves_other_grants_and_their_order_alone(self, positions_table):
        stored = ["training.view", "mobile.view", "events.view", "members.view"]

        result = _repair_row(positions_table, "member", stored)

        kept = [p for p in result if p in stored]
        assert kept == ["training.view", "events.view", "members.view"]


class TestTheApparatusWildcard:
    """Narrowing engineer's ``apparatus.*``, which must never split in two."""

    def test_the_wildcard_is_replaced_by_the_two_seeded_grants(self, positions_table):
        result = _repair_row(
            positions_table, "engineer", _row_as_it_exists_today("engineer")
        )

        assert "apparatus.*" not in result
        assert "apparatus.view" in result
        assert "apparatus.maintenance" in result

    def test_the_management_grants_the_wildcard_carried_are_gone(self, positions_table):
        """``apparatus.*`` matched ``manage`` and ``approve_driver_exception``;
        neither is seeded to a driver/operator, and neither may survive as a
        literal either."""
        result = _repair_row(
            positions_table, "engineer", _row_as_it_exists_today("engineer")
        )

        assert "apparatus.manage" not in result
        assert "apparatus.approve_driver_exception" not in result

    def test_removing_the_wildcard_never_happens_without_the_replacements(
        self, positions_table
    ):
        """Splitting the pair would strip apparatus access from every engineer."""
        result = _repair_row(positions_table, "engineer", ["apparatus.*"])

        assert result == ["apparatus.view", "apparatus.maintenance"]

    def test_it_does_not_duplicate_a_replacement_already_present(self, positions_table):
        result = _repair_row(
            positions_table, "engineer", ["apparatus.*", "apparatus.view"]
        )

        assert result.count("apparatus.view") == 1
        assert sorted(result) == ["apparatus.maintenance", "apparatus.view"]

    def test_a_row_without_the_wildcard_gains_nothing(self, positions_table):
        """Only the substitution adds these; a clean row is not topped up."""
        result = _repair_row(positions_table, "engineer", ["training.view"])

        assert result == ["training.view"]


class TestTheMarkerGatedAdditions:
    @pytest.mark.parametrize("slug", SLUGS)
    def test_a_wizard_row_gets_the_missing_seeded_grants(self, positions_table, slug):
        result = _repair_row(positions_table, slug, _row_as_it_exists_today(slug))

        for permission in _migration()._ADD[slug]:
            assert permission in result

    @pytest.mark.parametrize("slug", SLUGS)
    def test_a_row_without_the_markers_is_not_topped_up(self, positions_table, slug):
        """A department that removed a grant on purpose keeps it removed.

        Nothing but the wizard puts a marker on these slugs, so a row without
        one is not the wizard's output and this migration has no business
        deciding what belongs in it.
        """
        stored = ["training.view", "members.view"]

        assert _repair_row(positions_table, slug, stored) == stored

    def test_one_marker_is_enough(self, positions_table):
        """The four are stripped by different migrations over time; requiring
        all of them would re-create the whole-list brittleness being fixed."""
        for marker in _migration()._HEURISTIC_MARKERS:
            engine = sa.create_engine("sqlite://")
            try:
                with engine.begin() as conn:
                    conn.execute(
                        sa.text(
                            "CREATE TABLE positions (id VARCHAR(36) PRIMARY KEY,"
                            " slug VARCHAR(100), is_system BOOLEAN,"
                            " permissions TEXT)"
                        )
                    )
                result = _repair_row(engine, "member", [marker, "training.view"])
                assert "storefront.order" in result, marker
                assert "inventory.check_submit" in result, marker
            finally:
                engine.dispose()


class TestWhatItMustNotTouch:
    @pytest.mark.parametrize("slug", SLUGS)
    def test_a_department_customized_row_is_left_alone(self, positions_table, slug):
        stored = _row_as_it_exists_today(slug)

        result = _repair_row(positions_table, slug, stored, is_system=False)

        assert result == stored

    def test_other_slugs_are_left_alone(self, positions_table):
        """The heuristic overwrote officer rows too, but their repair is
        ``f7b3c8d2e569``'s and their grants are largely legitimate."""
        stored = ["reports.view", "settings.view", "apparatus.*", "mobile.view"]
        with positions_table.begin() as conn:
            _insert(conn, "sec", "secretary", stored)
            _insert(conn, "cap", "captain", stored)

        _run_upgrade(positions_table)

        with positions_table.connect() as conn:
            assert _stored(conn, "sec") == stored
            assert _stored(conn, "cap") == stored

    def test_it_no_ops_when_the_table_does_not_exist(self, engine):
        """``positions`` is built by ``create_all``, not by any migration, and
        CI runs ``alembic upgrade head`` against an empty database (CLAUDE.md
        pitfall #26)."""
        _run_upgrade(engine)


class TestIdempotence:
    @pytest.mark.parametrize("slug", SLUGS)
    def test_a_second_run_changes_nothing(self, positions_table, slug):
        """The additions are gated on markers the first run removes, so a
        re-run must not re-derive them — nor thrash a row it already fixed."""
        with positions_table.begin() as conn:
            _insert(conn, "row", slug, _row_as_it_exists_today(slug))

        _run_upgrade(positions_table)
        with positions_table.connect() as conn:
            once = _stored(conn, "row")
        _run_upgrade(positions_table)
        with positions_table.connect() as conn:
            assert _stored(conn, "row") == once


class TestItAgreesWithTheRegistry:
    """The frozen tables are copies (pitfall #20); report drift, don't apply it."""

    @pytest.mark.parametrize("slug", SLUGS)
    def test_nothing_it_revokes_is_seeded(self, slug):
        seeded = set(DEFAULT_POSITIONS[slug]["permissions"])
        for permission in _migration()._REVOKE[slug]:
            assert permission not in seeded, (
                f"{permission} is now seeded to {slug}; this migration would "
                "revoke a grant the registry intends"
            )

    @pytest.mark.parametrize("slug", SLUGS)
    def test_everything_it_adds_is_seeded(self, slug):
        seeded = set(DEFAULT_POSITIONS[slug]["permissions"])
        module = _migration()
        added = list(module._ADD[slug])
        for _wildcard, replacements in module._WILDCARD_NARROWING.get(slug, ()):
            added.extend(replacements)
        for permission in added:
            assert permission in seeded, (
                f"{permission} is no longer seeded to {slug}; this migration "
                "would grant something the registry does not"
            )

    def test_the_markers_are_never_seeded_to_any_covered_slug(self):
        """A marker that became legitimate would stop identifying a wizard row
        and would start being revoked from rows that should keep it."""
        for slug in SLUGS:
            seeded = set(DEFAULT_POSITIONS[slug]["permissions"])
            for marker in _migration()._HEURISTIC_MARKERS:
                assert marker not in seeded, (slug, marker)

    def test_the_markers_are_exactly_the_shared_over_grants(self):
        """Same tuple by construction; asserted so a future edit that splits
        them has to say so out loud."""
        module = _migration()
        assert module._REVOKE["member"] == module._HEURISTIC_MARKERS
        assert module._REVOKE["firefighter"] == module._HEURISTIC_MARKERS

    def test_it_is_wired_into_the_migration_chain(self):
        module = _migration()
        assert module.revision == "d1c7f4a92e63"
        assert module.down_revision == "c9a5e21f7b04"
