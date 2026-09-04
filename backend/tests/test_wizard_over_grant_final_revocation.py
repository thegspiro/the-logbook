"""The wizard rows the fingerprint gate could not see.

``c9a5e21f7b04`` and ``d1c7f4a92e63`` were put behind a gate requiring the row
to still carry one of four "marker" grants, on the claim that every unrepaired
wizard row does. It does not: the onboarding position editor writes
``{module}.view`` per ticked box and lets an administrator untick each module
independently, so a department running none of those four modules produced a
wizard row holding ``reports.view`` and no marker at all. ``f3b8d0c26a17``
therefore revokes unconditionally.

The centrepiece is
``TestThePreviouslyMissedRow::test_a_marker_less_wizard_row_loses_reports_view``
— the exact row the gate walked past, and the regression this migration exists
to close. ``TestTheAcceptedCost`` records the other half of the trade in a test
rather than only in prose: a deliberately granted ``reports.view`` is revoked
too, because nothing in the row distinguishes it from the wizard's.
"""

import importlib.util
import json
from pathlib import Path

import pytest
import sqlalchemy as sa

from app.core.permissions import DEFAULT_POSITIONS, OPERATIONAL_RANKS


def _intended_grants(slug):
    """What the registry means this slug's holders to have.

    ``emt`` has no ``DEFAULT_POSITIONS`` entry — which is precisely why
    onboarding stored the heuristic's output verbatim under that slug — so its
    intent lives in the rank registry instead.
    """
    if slug in DEFAULT_POSITIONS:
        return set(DEFAULT_POSITIONS[slug]["permissions"])
    return set(OPERATIONAL_RANKS[slug]["default_permissions"])


_VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
_PATH = _VERSIONS / (
    "20260904_2050_f3b8d0c26a17_revoke_wizard_over_grants_unconditionally.py"
)

SLUGS = ("member", "firefighter", "engineer", "emt")

#: The four module views the editor let an administrator untick. Named here so
#: the tests can build a row with none of them — the case that motivated this
#: migration — without importing the superseded gate's constant.
MARKERS = (
    "integrations.view",
    "medical_supplies.view",
    "mobile.view",
    "prospective_members.view",
)


def _migration():
    spec = importlib.util.spec_from_file_location("_final_revocation", _PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


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


def _revoke_row(engine, slug, permissions, is_system=True):
    with engine.begin() as conn:
        _insert(conn, "row", slug, permissions, is_system=is_system)
    _run_upgrade(engine)
    with engine.connect() as conn:
        return _stored(conn, "row")


class TestThePreviouslyMissedRow:
    """A wizard row whose four marker modules were unticked at onboarding."""

    @pytest.mark.parametrize("slug", ["member", "firefighter"])
    def test_a_marker_less_wizard_row_loses_reports_view(self, positions_table, slug):
        wizard = [
            "apparatus.view",
            "documents.view",
            "events.view",
            "members.view",
            "reports.view",
            "scheduling.view",
            "training.view",
        ]
        assert not set(wizard) & set(MARKERS), "fixture must carry no marker"

        result = _revoke_row(positions_table, slug, wizard)

        assert "reports.view" not in result
        assert "members.view" in result

    def test_a_marker_less_engineer_row_loses_its_over_grants(self, positions_table):
        wizard = ["apparatus.*", "members.view", "positions.view", "settings.view"]

        result = _revoke_row(positions_table, "engineer", wizard)

        assert "positions.view" not in result
        assert "settings.view" not in result
        assert "apparatus.*" not in result
        assert "members.view" in result


class TestTheRevocations:
    @pytest.mark.parametrize("slug", SLUGS)
    def test_every_listed_grant_is_removed(self, positions_table, slug):
        stored = list(_migration()._REVOKE[slug]) + ["members.view"]

        result = _revoke_row(positions_table, slug, stored)

        for permission in _migration()._REVOKE[slug]:
            assert permission not in result
        assert result == ["members.view"]

    def test_it_leaves_other_grants_and_their_order_alone(self, positions_table):
        stored = ["training.view", "mobile.view", "events.view", "members.view"]

        result = _revoke_row(positions_table, "member", stored)

        assert result == ["training.view", "events.view", "members.view"]

    def test_a_row_without_any_of_them_is_untouched(self, positions_table):
        stored = ["events.view", "training.view"]

        assert _revoke_row(positions_table, "member", stored) == stored

    @pytest.mark.parametrize("slug", SLUGS)
    def test_it_is_idempotent(self, positions_table, slug):
        stored = list(_migration()._REVOKE[slug]) + ["members.view"]
        with positions_table.begin() as conn:
            _insert(conn, "row", slug, stored)

        _run_upgrade(positions_table)
        with positions_table.connect() as conn:
            once = _stored(conn, "row")
        _run_upgrade(positions_table)
        with positions_table.connect() as conn:
            assert _stored(conn, "row") == once


class TestTheApparatusWildcard:
    def test_the_wildcard_is_replaced_by_the_two_seeded_grants(self, positions_table):
        result = _revoke_row(positions_table, "engineer", ["apparatus.*"])

        assert result == ["apparatus.view", "apparatus.maintenance"]

    def test_the_management_grants_it_carried_do_not_survive(self, positions_table):
        result = _revoke_row(positions_table, "engineer", ["apparatus.*"])

        assert "apparatus.manage" not in result
        assert "apparatus.approve_driver_exception" not in result

    def test_it_does_not_duplicate_a_replacement_already_present(self, positions_table):
        result = _revoke_row(
            positions_table, "engineer", ["apparatus.*", "apparatus.view"]
        )

        assert result.count("apparatus.view") == 1
        assert result.count("apparatus.maintenance") == 1

    def test_a_row_without_the_wildcard_gains_nothing(self, positions_table):
        assert _revoke_row(positions_table, "engineer", ["members.view"]) == [
            "members.view"
        ]


class TestTheStoredFormsOfAnOverGrant:
    """``.view`` is only one of the three strings the editor could have stored.

    ``expand_module_checkboxes`` writes ``{module}.manage`` *and* ``{module}.*``
    for a ticked Manage box, and ``permission_matches`` treats ``reports.*`` as
    satisfying ``reports.view`` — so removing the ``.view`` string alone would
    leave the reports open through the wildcard.
    """

    @pytest.mark.parametrize("slug", SLUGS)
    @pytest.mark.parametrize("form", ["reports.*", "reports.manage"])
    def test_a_managed_module_row_loses_the_wildcard(self, positions_table, slug, form):
        stored = ["members.view", "reports.view", form]

        result = _revoke_row(positions_table, slug, stored)

        assert result == ["members.view"]

    def test_engineer_loses_a_literal_apparatus_manage(self, positions_table):
        """Otherwise it would sit beside the narrowed wildcard and undo it."""
        result = _revoke_row(
            positions_table, "engineer", ["apparatus.*", "apparatus.manage"]
        )

        assert "apparatus.manage" not in result
        assert sorted(result) == ["apparatus.maintenance", "apparatus.view"]

    @pytest.mark.parametrize("slug", SLUGS)
    def test_every_over_granted_module_is_covered_in_all_three_forms(self, slug):
        module = _migration()
        revoked = set(module._REVOKE[slug])
        for over_granted in module._OVER_GRANTED_MODULES:
            for form in module._stored_forms(over_granted):
                assert form in revoked, (slug, form)


class TestTheWizardCreatedEmtPosition:
    """``emt`` has no registry entry, which is why its row is pure heuristic.

    It is in the wizard's ``DISCIPLINE_POSITION_IDS`` and is the whole roster
    for an ``ems_only`` agency. With no seeded row to update,
    ``save_session_roles`` takes its create branch and stores
    ``expand_module_checkboxes`` output verbatim with ``is_system=True``, and
    ``_collect_user_permissions`` unions it into every EMT's grants.
    """

    def test_it_is_covered(self):
        assert "emt" in _migration()._SLUGS

    def test_an_emt_row_loses_reports_view(self, positions_table):
        wizard = ["members.view", "reports.view", "training.view"]

        result = _revoke_row(positions_table, "emt", wizard)

        assert "reports.view" not in result
        assert result == ["members.view", "training.view"]

    def test_it_takes_the_same_revocations_as_firefighter(self):
        """An EMT's intended grants are the line-member set, same as
        Firefighter's — same standing, different discipline."""
        module = _migration()
        assert module._REVOKE["emt"] == module._REVOKE["firefighter"]
        assert _intended_grants("emt") == _intended_grants("firefighter")


class TestTheAcceptedCost:
    """Failing closed has a price, recorded here rather than only in prose.

    Nothing in a row distinguishes a grant the wizard wrote from one an
    administrator chose — ``RoleService.update_role`` edits a built-in
    position's permissions in place and leaves ``is_system`` set. Where the two
    cannot be told apart, a grant that discloses other members' data is removed
    and has to be re-added deliberately.
    """

    @pytest.mark.parametrize("slug", ["member", "firefighter"])
    def test_a_deliberate_reports_grant_is_revoked_too(self, positions_table, slug):
        curated = ["events.view", "members.view", "reports.view"]

        result = _revoke_row(positions_table, slug, curated)

        assert "reports.view" not in result

    def test_a_deliberate_apparatus_wildcard_is_narrowed_too(self, positions_table):
        result = _revoke_row(
            positions_table, "engineer", ["apparatus.*", "events.view"]
        )

        assert "apparatus.*" not in result
        assert "apparatus.view" in result


class TestWhatItMustNotTouch:
    @pytest.mark.parametrize("slug", SLUGS)
    def test_a_department_created_position_is_left_alone(self, positions_table, slug):
        """``is_system = False`` is a position the department built itself, not
        a seeded row the wizard overwrote."""
        stored = list(_migration()._REVOKE[slug])

        assert _revoke_row(positions_table, slug, stored, is_system=False) == stored

    def test_other_slugs_are_left_alone(self, positions_table):
        """Officers are seeded these grants by design."""
        stored = ["reports.view", "settings.view", "apparatus.*"]
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


class TestItAgreesWithTheRegistry:
    @pytest.mark.parametrize("slug", SLUGS)
    def test_nothing_it_revokes_is_seeded(self, slug):
        seeded = _intended_grants(slug)
        for permission in _migration()._REVOKE[slug]:
            assert permission not in seeded, (
                f"{permission} is now seeded to {slug}; this migration would "
                "revoke a grant the registry intends"
            )

    def test_both_apparatus_replacements_are_seeded_to_engineer(self):
        seeded = _intended_grants("engineer")
        for _wildcard, replacements in _migration()._WILDCARD_NARROWING["engineer"]:
            for permission in replacements:
                assert permission in seeded, permission

    def test_it_covers_the_slugs_the_baseline_set_is_stored_under(self):
        """``DEFAULT_POSITIONS["firefighter"]["permissions"]`` *is* the rank's
        list object, so onboarding writes a system position under that slug too
        (CLAUDE.md pitfall #23)."""
        assert set(_migration()._SLUGS) == set(SLUGS)
        for slug in ("firefighter", "engineer"):
            assert (
                DEFAULT_POSITIONS[slug]["permissions"]
                is OPERATIONAL_RANKS[slug]["default_permissions"]
            ), slug

    def test_it_is_wired_into_the_migration_chain(self):
        module = _migration()
        assert module.revision == "f3b8d0c26a17"
        assert module.down_revision == "9d2b4492faba"
