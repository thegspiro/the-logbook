"""The rank-and-file rows that still carry the fleet record.

``apparatus.view`` left ``_LINE_MEMBER_PERMISSIONS`` and the ``member``
position on 2026-09-05, but ``_collect_user_permissions`` unions each assigned
position's **stored** permissions — so the registry edit alone changes nothing
for a department that has already run onboarding (CLAUDE.md pitfall #23).
``b6e4a0d17c93`` rewrites those rows.

Two tests carry the weight.
``TestWhatItMustNotTouch::test_the_engineer_row_keeps_its_apparatus_grants`` is
the row a careless slug list eats: engineer is the driver/operator rank, and two
merged migrations narrow a stored ``apparatus.*`` on that row *to*
``apparatus.view`` + ``apparatus.maintenance``.
``TestTheStoredFormsOfTheGrant`` covers the wildcard, which is what would have
left the module open behind a revoked ``.view``.
"""

import importlib.util
import json
from pathlib import Path

import pytest
import sqlalchemy as sa

from app.core.permissions import DEFAULT_POSITIONS, OPERATIONAL_RANKS


def _intended_grants(slug):
    """What the registry means this slug's holders to have.

    The position registry is the authority where it has an entry. ``emt``
    gained one only on 2026-09-05 — its absence is precisely why onboarding
    stored the wizard's output verbatim under that slug — so the rank registry
    remains the fallback for any slug seeded as a rank alone.
    """
    if slug in DEFAULT_POSITIONS:
        return set(DEFAULT_POSITIONS[slug]["permissions"])
    return set(OPERATIONAL_RANKS[slug]["default_permissions"])


_VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
_PATH = _VERSIONS / "20260905_1420_b6e4a0d17c93_revoke_baseline_apparatus_view.py"

SLUGS = ("member", "firefighter", "emt")


def _migration():
    spec = importlib.util.spec_from_file_location("_apparatus_revocation", _PATH)
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


#: A seeded rank-and-file row as onboarding wrote it, before the revocation.
BASELINE_ROW = [
    "members.view",
    "training.view",
    "apparatus.view",
    "events.view",
    "scheduling.view",
]


class TestTheRevocation:
    @pytest.mark.parametrize("slug", SLUGS)
    def test_the_grant_is_removed(self, positions_table, slug):
        result = _revoke_row(positions_table, slug, BASELINE_ROW)

        assert "apparatus.view" not in result

    @pytest.mark.parametrize("slug", SLUGS)
    def test_it_leaves_other_grants_and_their_order_alone(self, positions_table, slug):
        result = _revoke_row(positions_table, slug, BASELINE_ROW)

        assert result == [
            "members.view",
            "training.view",
            "events.view",
            "scheduling.view",
        ]

    @pytest.mark.parametrize("slug", SLUGS)
    def test_a_row_without_it_is_untouched(self, positions_table, slug):
        stored = ["members.view", "events.view"]

        assert _revoke_row(positions_table, slug, stored) == stored

    @pytest.mark.parametrize("slug", SLUGS)
    def test_it_is_idempotent(self, positions_table, slug):
        once = _revoke_row(positions_table, slug, BASELINE_ROW)

        _run_upgrade(positions_table)

        with positions_table.connect() as conn:
            assert _stored(conn, "row") == once


class TestTheStoredFormsOfTheGrant:
    """``expand_module_checkboxes`` writes three strings, not one.

    A ticked Manage box stores ``apparatus.manage`` *and* ``apparatus.*``, and
    ``permission_matches`` treats the wildcard as satisfying ``apparatus.view``
    — so revoking only the ``.view`` string would leave the fleet record open
    behind the wildcard. This deliberately reverses ``f3b8d0c26a17``'s choice to
    leave a member's ``apparatus.manage`` tick alone: that rested on the module
    being theirs to see, which it no longer is.
    """

    @pytest.mark.parametrize("slug", SLUGS)
    @pytest.mark.parametrize(
        "form", ["apparatus.view", "apparatus.manage", "apparatus.*"]
    )
    def test_each_stored_form_is_removed(self, positions_table, slug, form):
        result = _revoke_row(positions_table, slug, ["members.view", form])

        assert result == ["members.view"]

    @pytest.mark.parametrize("slug", SLUGS)
    def test_a_row_holding_all_three_loses_all_three(self, positions_table, slug):
        stored = ["apparatus.view", "apparatus.manage", "apparatus.*", "members.view"]

        assert _revoke_row(positions_table, slug, stored) == ["members.view"]

    def test_it_leaves_the_other_apparatus_permissions_alone(self, positions_table):
        """Only the two checkbox forms and the wildcard are the wizard's to
        write; a granular grant on a rank-and-file row was put there by hand and
        is not this migration's business."""
        stored = ["apparatus.maintenance", "apparatus.approve_driver_exception"]

        assert _revoke_row(positions_table, "member", stored) == stored


class TestWhatItMustNotTouch:
    def test_the_engineer_row_keeps_its_apparatus_grants(self, positions_table):
        """Engineer is the driver/operator rank, not rank-and-file.

        ``d1c7f4a92e63`` and ``f3b8d0c26a17`` both narrow a stored
        ``apparatus.*`` on an engineer row *to* these two. Revoking them here
        would undo two merged migrations and leave the rank holding
        ``apparatus.maintenance`` with no page behind it.
        """
        stored = ["apparatus.view", "apparatus.maintenance", "members.view"]

        assert _revoke_row(positions_table, "engineer", stored) == stored

    @pytest.mark.parametrize("slug", ["captain", "fire_chief", "apparatus_officer"])
    def test_officer_rows_are_left_alone(self, positions_table, slug):
        stored = ["apparatus.view", "apparatus.manage", "apparatus.*"]

        assert _revoke_row(positions_table, slug, stored) == stored

    @pytest.mark.parametrize("slug", SLUGS)
    def test_a_department_created_position_is_left_alone(self, positions_table, slug):
        """``is_system = False`` is a position the department built for itself."""
        stored = ["apparatus.view", "members.view"]

        result = _revoke_row(positions_table, slug, stored, is_system=False)

        assert result == stored

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

    def test_apparatus_view_is_still_seeded_to_engineer(self):
        """Fails here rather than silently making two shipped migrations write
        a grant the registry no longer intends."""
        assert "apparatus.view" in _intended_grants("engineer")

    def test_emt_and_firefighter_still_share_one_intent(self):
        """They hold the same list object; two copies would drift within a
        release."""
        assert _intended_grants("emt") == _intended_grants("firefighter")

    def test_it_covers_the_slugs_the_baseline_set_is_stored_under(self):
        """Each seeded slug reaches the database as a stored ``positions`` row.

        ``DEFAULT_POSITIONS["firefighter"]["permissions"]`` *is* the rank's list
        object, so onboarding writes a system position under that slug too
        (CLAUDE.md pitfall #23), and ``emt`` aliases the same list twice over —
        through ``OPERATIONAL_RANKS["emt"]``. Its registry entry arrived only on
        2026-09-05; every EMT row written before that came from
        ``save_session_roles``'s create branch, which is why the slug is covered
        whether or not it is seeded today.
        """
        assert set(_migration()._SLUGS) == set(SLUGS)
        for slug in ("firefighter", "emt"):
            assert (
                DEFAULT_POSITIONS[slug]["permissions"]
                is OPERATIONAL_RANKS[slug]["default_permissions"]
            ), slug

    def test_it_is_wired_into_the_migration_chain(self):
        """Ordered after the EMT restore, and that is load-bearing.

        ``b4d1c8e37f52`` restores four grants to an EMT row only when the row
        matches its frozen ``_UNEDITED_SHAPE``, which contains
        ``apparatus.view``. Revoking first would make every EMT row miss the
        match and skip the restore in silence. Its successor ``c7a4e91d3b68``,
        this revision's parent, gates on the absence of four unrelated grants
        and is indifferent — but sitting after both is what keeps the
        constraint against ``b4d1c8e37f52`` satisfied on any database that
        upgrades through the chain.
        """
        module = _migration()
        assert module.revision == "b6e4a0d17c93"
        assert module.down_revision == "c7a4e91d3b68"
