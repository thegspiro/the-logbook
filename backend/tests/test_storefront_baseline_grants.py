"""The department store is baseline access, and the seeded rows must say so.

``/store`` requires ``storefront.view``. The permission reaches a volunteer two
ways — the ``member``/``firefighter`` positions written at onboarding, and the
operational rank resolved at runtime — and only the second one was ever true
for a department seeded before the storefront module shipped. A member with no
rank recorded therefore got Access Denied from a store the navigation was
still advertising, which is what ``20260825_2000_c4f8a2e70d19`` backfills.
"""

import importlib.util
from pathlib import Path

import pytest

from app.core.permissions import DEFAULT_POSITIONS
from tests.test_baseline_member_grants import BASELINE_SOURCES

STOREFRONT_BASELINE = ("storefront.view", "storefront.order")

_MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20260825_2000_c4f8a2e70d19_backfill_storefront_member_grants.py"
)


def _load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _load_migration():
    return _load_module(_MIGRATION, "_storefront_backfill")


@pytest.mark.parametrize("permission", STOREFRONT_BASELINE)
def test_storefront_access_is_seeded_to_every_volunteer(permission: str):
    """Browsing and ordering from the store is day-one access, not an officer
    grant — the catalogue is the department's own merchandise."""
    for label, registry, slug, field in BASELINE_SOURCES:
        assert permission in registry[slug][field], (
            f"the seeded {label} no longer carries {permission}; /store "
            "requires it, so members would land on Access Denied"
        )


def test_backfill_covers_every_seeded_position_holding_the_grants():
    """The migration's slug list must track the registry.

    A position added to ``DEFAULT_POSITIONS`` with the storefront grants but
    missing from the backfill repeats the original bug for that position:
    fresh installs get it, every existing department does not.

    ``emt`` is the exception, and only because that premise does not hold for
    it. The registry had no EMT position until 2026-09-05, so every stored EMT
    row was written by the onboarding editor's create branch rather than by the
    seed — and ``expand_module_checkboxes`` emits ``storefront.order`` beside
    ``storefront.view`` for a ticked View box, so those rows already carry both
    grants. There is nothing for this frozen migration to repair, and it could
    not be widened to cover it anyway (CLAUDE.md pitfall #20).
    """
    # Thirteen corporate positions gained the grants in a later revision, which
    # carries its own backfill — they are not this migration's to cover.
    later = set(
        _load_module(
            (
                Path(__file__).resolve().parents[1]
                / "alembic"
                / "versions"
                / "20260826_0345_b3e8d1f45a27_grant_corporate_storefront_access.py"
            ),
            "_corp_storefront",
        )._PRIOR_DEFAULTS
    )
    expected = {
        slug
        for slug, definition in DEFAULT_POSITIONS.items()
        if slug not in later
        and slug != "emt"  # registered after this migration — see the docstring
        and "storefront.view" in definition["permissions"]
        # A wildcard row already covers the grants and the backfill skips it.
        and "*" not in definition["permissions"]
    }
    assert set(_load_migration()._SLUGS) == expected
