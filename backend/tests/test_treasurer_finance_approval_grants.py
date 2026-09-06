"""The approval chain needs a seeded position that can run it.

``finance.approve`` and ``finance.configure_approvals`` gate nine endpoints —
the approval-chain settings screen and the approve/deny/delegate actions — and
until 2026-09-06 **no seeded position held either**. Only ``it_manager``
reached them, and only through its ``*`` wildcard: the IT administrator, not a
finance role.

The half-configured state is what stranded records. With no chain,
``submit_purchase_request`` skips approval entirely; build a chain without
anybody holding ``finance.approve`` and every submitted request lands in
``PENDING_APPROVAL`` with nobody able to action it.

Two things are pinned here, and the second is the one that is easy to lose:
the registry grant (which a fresh install reads) and the migration that
carries it to a department that already onboarded. CLAUDE.md pitfall #23 —
a rank/position grant reaches the database through a stored ``positions`` row,
so the registry edit alone repairs nobody.
"""

import importlib.util
from pathlib import Path

import pytest

from app.core.permissions import (
    DEFAULT_POSITIONS,
    FINANCE_APPROVE,
    FINANCE_CONFIGURE_APPROVALS,
    FINANCE_MANAGE,
    FINANCE_VIEW,
)

pytestmark = pytest.mark.unit

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "20260906_2141_ee7390dcdf47_grant_treasurer_finance_approve_and_.py"
)

_ADDED = (FINANCE_APPROVE.name, FINANCE_CONFIGURE_APPROVALS.name)


def _migration():
    spec = importlib.util.spec_from_file_location("_treasurer_grants", _MIGRATION_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestTheRegistryGrant:
    @pytest.mark.parametrize("permission", _ADDED)
    def test_treasurer_holds_it(self, permission):
        assert permission in DEFAULT_POSITIONS["treasurer"]["permissions"]

    @pytest.mark.parametrize("permission", _ADDED)
    def test_some_seeded_position_holds_it_by_name(self, permission):
        """Named, not wildcarded.

        ``it_manager`` holds ``*``, so a reachability check that accepts a
        wildcard passes with nobody in the finance chain able to approve a
        thing. That is the state this file exists to prevent, so the grant has
        to appear literally.
        """
        holders = [
            slug
            for slug, position in DEFAULT_POSITIONS.items()
            if permission in position["permissions"]
        ]

        assert holders, f"no seeded position names {permission}"

    def test_no_other_seeded_position_gained_approval_powers(self):
        """The grant is the treasurer's, deliberately.

        Disbursement approval is the one control every set of department bylaws
        puts on spending; widening it to a second seeded position should be a
        decision somebody makes here, not a side effect of editing a nearby
        entry.
        """
        for permission in _ADDED:
            holders = {
                slug
                for slug, position in DEFAULT_POSITIONS.items()
                if permission in position["permissions"]
            }
            assert holders == {"treasurer"}, f"{permission} held by {holders}"


class TestTheMigrationGate:
    """It is an addition, so it must recognise an unrepaired seed (#23)."""

    SEED = [FINANCE_VIEW.name, FINANCE_MANAGE.name, "events.view"]

    def test_it_grants_a_row_with_exactly_the_seeded_finance_shape(self):
        updated = _migration().grant(list(self.SEED))

        assert updated is not None
        assert set(updated) == set(self.SEED) | set(_ADDED)

    def test_it_keeps_unrelated_grants_the_department_added(self):
        """The gate reads the finance subset, so a row carrying other modules'
        grants is still an unrepaired seed and keeps them."""
        updated = _migration().grant([*self.SEED, "storefront.manage"])

        assert updated is not None
        assert "storefront.manage" in updated

    @pytest.mark.parametrize(
        "permissions",
        [
            pytest.param(
                [FINANCE_VIEW.name, FINANCE_MANAGE.name, FINANCE_APPROVE.name],
                id="already-holds-approve",
            ),
            pytest.param([FINANCE_VIEW.name], id="manage-removed"),
            pytest.param(
                [FINANCE_VIEW.name, FINANCE_MANAGE.name, "finance.export"],
                id="other-finance-grant-added",
            ),
            pytest.param(["events.view"], id="no-finance-grants"),
        ],
    )
    def test_it_leaves_a_curated_row_alone(self, permissions):
        assert _migration().grant(list(permissions)) is None

    def test_the_gate_is_not_a_whole_row_snapshot(self):
        """``20260901_1320_f7b3c8d2e569`` matched whole rows and every later
        migration that touched those rows moved them out of the match. Adding a
        module anywhere else in the registry must not move a row across this
        gate."""
        assert _migration().grant([*self.SEED, "a_module_added_later.view"]) is not None

    def test_downgrade_reverses_exactly_what_upgrade_wrote(self):
        module = _migration()
        granted = module.grant(list(self.SEED))

        assert module.revoke(granted) == list(self.SEED)

    def test_downgrade_leaves_a_row_it_did_not_write(self):
        """A department that added ``finance.approve`` itself keeps it."""
        module = _migration()

        assert module.revoke(list(self.SEED)) is None
        assert module.revoke([FINANCE_VIEW.name, FINANCE_APPROVE.name]) is None

    def test_upgrade_is_idempotent(self):
        """Re-running it over an already-granted row is a no-op, because the
        row no longer matches the seeded shape."""
        module = _migration()
        granted = module.grant(list(self.SEED))

        assert module.grant(granted) is None
