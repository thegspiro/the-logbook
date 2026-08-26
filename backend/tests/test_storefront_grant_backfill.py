"""The storefront backfill migration must mirror the permission registry.

``DEFAULT_POSITIONS`` is materialized into ``positions`` only at onboarding, so
a grant added to the registry afterwards reaches fresh installs and nobody
else. Migration ``a4f8c1b92d17`` writes the storefront grants onto the rows
already stored — and it carries a hand-transcribed copy of the registry's
slug-to-grant map, which is exactly the kind of copy that goes stale silently.

If this test fails, the registry and the migration disagree: either a position
gained or lost a storefront grant and the migration was not updated, or the
migration lists a slug the registry does not seed.
"""

import importlib.util
from pathlib import Path

import pytest

from app.core.permissions import DEFAULT_POSITIONS

_MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20260825_1500_a4f8c1b92d17_backfill_storefront_member_grants.py"
)

_STOREFRONT_GRANTS = ("storefront.view", "storefront.order", "storefront.manage")

# ``a4f8c1b92d17`` runs *before* this one in the chain, so a grant this later
# migration strips is still on a pristine row at the moment the backfill runs
# and must still appear in its frozen snapshot. Read from the revoking
# migration's own constants rather than restated here, so the allowance cannot
# outlive the revocation it stands for.
_REVOKED_LATER = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20260825_2015_a1f7c34e9b02_revoke_baseline_notifications_view.py"
)


def _load_migration():
    spec = importlib.util.spec_from_file_location("_backfill_storefront", _MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _load_revocation():
    spec = importlib.util.spec_from_file_location("_revoke_later", _REVOKED_LATER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _grants_revoked_after_the_backfill(slug: str) -> set[str]:
    """Grants a pristine row still carried when ``a4f8c1b92d17`` ran.

    The registry is the *current* seed set. A grant revoked by a migration
    ordered after the backfill has since left the registry but was still on the
    row the backfill had to match, so the snapshot legitimately carries it.
    """
    revocation = _load_revocation()
    if slug in revocation._SLUGS:
        return {revocation._PERMISSION}
    return set()


def _registry_grants(slug: str) -> tuple[str, ...]:
    permissions = DEFAULT_POSITIONS[slug].get("permissions") or []
    return tuple(g for g in _STOREFRONT_GRANTS if g in permissions)


def _seeded_slugs_with_storefront() -> set[str]:
    return {
        slug
        for slug, entry in DEFAULT_POSITIONS.items()
        # A wildcard position already covers every storefront grant, so the
        # migration deliberately leaves it out rather than cluttering it.
        if "*" not in (entry.get("permissions") or []) and _registry_grants(slug)
    }


def test_migration_file_exists():
    assert _MIGRATION.exists(), f"missing migration: {_MIGRATION.name}"


def test_backfill_covers_every_position_the_registry_seeds():
    backfill = _load_migration()._BACKFILL
    assert set(backfill) == _seeded_slugs_with_storefront()


@pytest.mark.parametrize("slug", sorted(_seeded_slugs_with_storefront()))
def test_backfill_grants_match_the_registry(slug):
    backfill = _load_migration()._BACKFILL
    assert backfill[slug] == _registry_grants(slug)


def test_wildcard_positions_are_left_out():
    backfill = _load_migration()._BACKFILL
    for slug, entry in DEFAULT_POSITIONS.items():
        if "*" in (entry.get("permissions") or []):
            assert slug not in backfill


def test_plain_member_is_backfilled_with_browsing_but_not_management():
    backfill = _load_migration()._BACKFILL
    assert backfill["member"] == ("storefront.view", "storefront.order")


class TestFrozenPriorDefaults:
    """The snapshot must describe a pristine row at the moment this runs.

    ``_PRIOR_DEFAULTS`` is frozen rather than imported, so it can drift from
    the registry silently — and a drifted snapshot matches nothing, which makes
    the backfill a no-op that still reports success. These assertions are the
    thing that notices.
    """

    def test_snapshot_covers_exactly_the_backfilled_slugs(self):
        module = _load_migration()
        assert set(module._PRIOR_DEFAULTS) == set(module._BACKFILL)

    @pytest.mark.parametrize("slug", sorted(_seeded_slugs_with_storefront()))
    def test_snapshot_is_the_registry_set_minus_the_added_grants(self, slug):
        module = _load_migration()
        # The registry as it stands, plus what a later migration has since
        # revoked — which together are what a pristine row held when this
        # backfill ran, and so what its snapshot must describe.
        pristine = set(DEFAULT_POSITIONS[slug]["permissions"])
        pristine |= _grants_revoked_after_the_backfill(slug)
        assert module._PRIOR_DEFAULTS[slug] == pristine - set(module._BACKFILL[slug])

    def test_the_snapshot_never_already_carries_a_grant(self):
        # If it did, a pristine row would never match and nothing would be
        # backfilled — the silent-no-op failure this guard exists to catch.
        module = _load_migration()
        for slug, grants in module._BACKFILL.items():
            assert not (module._PRIOR_DEFAULTS[slug] & set(grants)), slug
