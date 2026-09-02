"""Every seeded position can reach the store.

The store is a member amenity, not an officer tool: whoever holds a position
can buy a job shirt. Thirteen corporate positions carried no storefront grant
at all, and the omission hid because permissions union across positions and
every operational rank grants the store — so it only bit a member whose *only*
position was one of these and who had no rank recorded.
"""

import importlib.util
from pathlib import Path

import pytest

from app.core.permissions import (
    DEFAULT_POSITIONS,
    LEGACY_PERMISSION_ALIASES,
    OPERATIONAL_RANKS,
)

# Current name -> the name a migration frozen before the rename would have
# written. Built from the alias map so it cannot fall out of step with it.
_RENAMED_SINCE: dict[str, str] = {
    new: legacy
    for legacy, replacements in LEGACY_PERMISSION_ALIASES.items()
    if not legacy.endswith(".*")
    for new in replacements
}


def _as_frozen(permissions: set[str]) -> set[str]:
    """Spell *permissions* the way a migration older than the rename would.

    A migration's snapshot is frozen: it has to keep matching the rows it will
    actually meet, and this one runs before the equipment_check -> inventory
    rename, so the rows it reads still carry the old names (CLAUDE.md pitfall
    #20). Translating the live registry back is therefore the correct
    comparison — updating the snapshot to today's names would leave it matching
    nothing and turn the backfill into a silent no-op, which is the exact
    failure these tests exist to catch.
    """
    return {_RENAMED_SINCE.get(p, p) for p in permissions}


_MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20260826_0345_b3e8d1f45a27_grant_corporate_storefront_access.py"
)


def _load_migration():
    spec = importlib.util.spec_from_file_location("_corp_storefront", _MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _granted(slug: str) -> set[str]:
    permissions = set(DEFAULT_POSITIONS[slug]["permissions"])
    return {"*"} if "*" in permissions else permissions


class TestEverySeededPositionReachesTheStore:
    @pytest.mark.parametrize("slug", sorted(DEFAULT_POSITIONS))
    def test_position_can_browse_and_order(self, slug):
        permissions = _granted(slug)
        if "*" in permissions:
            return
        assert "storefront.view" in permissions, f"{slug} cannot open /store"
        # view without order is the worse dead end: browse, fill a cart, reach
        # checkout, then fail on submit.
        assert "storefront.order" in permissions, f"{slug} cannot submit an order"

    @pytest.mark.parametrize("rank", sorted(OPERATIONAL_RANKS))
    def test_every_rank_still_reaches_the_store(self, rank):
        defaults = set(OPERATIONAL_RANKS[rank]["default_permissions"])
        assert "storefront.view" in defaults
        assert "storefront.order" in defaults

    def test_managing_the_store_stays_restricted(self):
        # The admin console is catalog, pricing, other members' orders and
        # payment reconciliation — not something a grant sweep should widen.
        managers = {
            slug
            for slug in DEFAULT_POSITIONS
            if "storefront.manage" in _granted(slug) or "*" in _granted(slug)
        }
        assert managers == {
            "fire_chief",
            "deputy_chief",
            "assistant_chief",
            "it_manager",
            "president",
            "quartermaster",
            "apparatus_officer",
            "facilities_manager",
        }


class TestBackfillMirrorsTheRegistry:
    """The frozen snapshot is matched against real stored rows.

    A snapshot that has drifted matches nothing, which makes the backfill a
    no-op that still reports success — so the drift is what this checks.
    """

    def test_migration_file_exists(self):
        assert _MIGRATION.exists(), f"missing migration: {_MIGRATION.name}"

    def test_it_adds_browsing_but_never_management(self):
        assert _load_migration()._GRANTS == ("storefront.view", "storefront.order")

    @pytest.mark.parametrize(
        "slug",
        sorted(_load_migration()._PRIOR_DEFAULTS),
    )
    def test_snapshot_is_the_registry_set_minus_the_added_grants(self, slug):
        module = _load_migration()
        registry = _as_frozen(set(DEFAULT_POSITIONS[slug]["permissions"]))
        assert module._PRIOR_DEFAULTS[slug] == registry - set(module._GRANTS)

    def test_snapshot_never_already_carries_a_grant(self):
        # If it did, a pristine row would never match and nothing would be
        # backfilled — the silent-no-op this guard exists to catch.
        module = _load_migration()
        for slug, prior in module._PRIOR_DEFAULTS.items():
            assert not (prior & set(module._GRANTS)), slug

    def test_downgrade_does_not_revoke(self):
        module = _load_migration()
        body = _MIGRATION.read_text()
        downgrade = body[body.index("def downgrade() -> None:") :]
        assert "UPDATE positions" not in downgrade
        assert module.downgrade() is None
