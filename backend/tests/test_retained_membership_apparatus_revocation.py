"""The membership standings that kept the fleet record after ``b6e4a0d17c93``.

The old role setup offered Probationary, Junior, Life, Administrative, Social
and Exempt as *positions*, each created from the ``member`` or ``probationary``
template. ``c3d4e5f6a7b8`` recovered the standing onto the member record and
kept those rows on purpose, so they still carry the template's
``apparatus.view`` — and ``b6e4a0d17c93`` visited only ``member``,
``firefighter`` and ``emt``.

``TestItCoversWhatThePredecessorMissed`` is the centrepiece: it asserts the
contrast against the predecessor module directly rather than describing it, so
it cannot go stale.
"""

import importlib.util
import json
from pathlib import Path

import pytest
import sqlalchemy as sa

_VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
_PATH = (
    _VERSIONS
    / "20260905_1500_d5f2b8c04a19_revoke_apparatus_from_retained_membership_positions.py"
)
_PREDECESSOR = (
    _VERSIONS / "20260905_1420_b6e4a0d17c93_revoke_baseline_apparatus_view.py"
)
_STANDING = _VERSIONS / "20260826_1600_c3d4e5f6a7b8_membership_positions_to_standing.py"

SLUGS = (
    "administrative_member",
    "exempt_member",
    "junior_member",
    "life_member",
    "probationary_member",
    "social_member",
)


def _load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _migration():
    return _load(_PATH, "_retained_membership_revocation")


class _Op:
    """Stands in for ``alembic.op``, which only exists inside a real upgrade.

    Loaded by path and never registered in ``sys.modules``, so replacing its
    ``op`` cannot leak into another test (CLAUDE.md pitfall #22).
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


def _insert(engine, row_id, slug, permissions, is_system=True):
    with engine.begin() as conn:
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


def _stored(engine, row_id="row"):
    with engine.connect() as conn:
        raw = conn.execute(
            sa.text("SELECT permissions FROM positions WHERE id = :id"), {"id": row_id}
        ).scalar_one()
    return json.loads(raw)


def _run(engine, module=None):
    module = module or _migration()
    with engine.begin() as conn:
        module.op = _Op(conn)
        module.upgrade()


def _revoke_row(engine, slug, permissions, is_system=True):
    _insert(engine, "row", slug, permissions, is_system=is_system)
    _run(engine)
    return _stored(engine)


#: A membership row as the old role setup wrote it, from the member template.
MEMBER_TEMPLATE_ROW = [
    "members.view",
    "apparatus.view",
    "training.view",
    "events.view",
]


class TestTheRevocation:
    @pytest.mark.parametrize("slug", SLUGS)
    def test_the_grant_is_removed(self, positions_table, slug):
        result = _revoke_row(positions_table, slug, MEMBER_TEMPLATE_ROW)

        assert "apparatus.view" not in result

    @pytest.mark.parametrize("slug", SLUGS)
    def test_it_leaves_other_grants_and_their_order_alone(self, positions_table, slug):
        result = _revoke_row(positions_table, slug, MEMBER_TEMPLATE_ROW)

        assert result == ["members.view", "training.view", "events.view"]

    @pytest.mark.parametrize("slug", SLUGS)
    @pytest.mark.parametrize(
        "form", ["apparatus.view", "apparatus.manage", "apparatus.*"]
    )
    def test_each_stored_form_is_removed(self, positions_table, slug, form):
        """A ticked Manage box stored the wildcard, and ``permission_matches``
        treats ``apparatus.*`` as satisfying ``apparatus.view``."""
        result = _revoke_row(positions_table, slug, ["members.view", form])

        assert result == ["members.view"]

    @pytest.mark.parametrize("slug", SLUGS)
    def test_a_row_without_it_is_untouched(self, positions_table, slug):
        stored = ["members.view", "events.view"]

        assert _revoke_row(positions_table, slug, stored) == stored

    @pytest.mark.parametrize("slug", SLUGS)
    def test_it_is_idempotent(self, positions_table, slug):
        once = _revoke_row(positions_table, slug, MEMBER_TEMPLATE_ROW)

        _run(positions_table)

        assert _stored(positions_table) == once


class TestWhatItMustNotTouch:
    @pytest.mark.parametrize("slug", SLUGS)
    def test_a_department_created_position_is_left_alone(self, positions_table, slug):
        stored = ["members.view", "apparatus.view"]

        assert _revoke_row(positions_table, slug, stored, is_system=False) == stored

    @pytest.mark.parametrize("slug", ["engineer", "captain", "apparatus_officer"])
    def test_it_visits_no_other_slug(self, positions_table, slug):
        stored = ["apparatus.view", "apparatus.maintenance", "members.view"]

        assert _revoke_row(positions_table, slug, stored) == stored


class TestItCoversWhatThePredecessorMissed:
    """Asserted against the predecessor module, not described in prose."""

    @pytest.mark.parametrize("slug", SLUGS)
    def test_the_predecessor_leaves_these_rows_holding_the_grant(
        self, positions_table, slug
    ):
        _insert(positions_table, "row", slug, MEMBER_TEMPLATE_ROW)

        _run(positions_table, _load(_PREDECESSOR, "_baseline_revocation"))

        assert "apparatus.view" in _stored(positions_table), (
            f"{slug} no longer needs this revision; if the predecessor covers "
            "it, this migration is doing someone else's work"
        )

    @pytest.mark.parametrize("slug", SLUGS)
    def test_the_pair_composes(self, positions_table, slug):
        _insert(positions_table, "row", slug, MEMBER_TEMPLATE_ROW)

        _run(positions_table, _load(_PREDECESSOR, "_baseline_revocation"))
        _run(positions_table)

        assert "apparatus.view" not in _stored(positions_table)

    def test_the_two_slug_sets_do_not_overlap(self):
        assert not set(_migration()._SLUGS) & set(
            _load(_PREDECESSOR, "_baseline_revocation")._SLUGS
        )


class TestItAgreesWithTheStandingMigration:
    def test_it_covers_every_position_that_migration_kept(self):
        """Read out of ``c3d4e5f6a7b8`` rather than restated, so a slug added
        there cannot silently escape this revocation."""
        kept = _load(_STANDING, "_membership_standing")._FROM_POSITION

        assert set(kept) == set(_migration()._SLUGS)

    def test_it_is_wired_into_the_migration_chain(self):
        module = _migration()

        assert module.revision == "d5f2b8c04a19"
        assert module.down_revision == "b6e4a0d17c93"
