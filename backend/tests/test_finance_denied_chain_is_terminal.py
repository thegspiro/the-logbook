"""A denied approval chain stays denied.

``_terminate_pending_steps`` closes the rest of the chain the moment a step
denies the entity — but only from the release that added it. A department's
database can already hold the shape it exists to prevent: a ``DENIED`` step
followed by one or more ``PENDING`` ones, created before that code existed.

Those rows are not inert. The next ``PENDING`` record becomes the entity's
"current" step, so a refused purchase request keeps appearing as awaiting
approval — and approving the last of them makes ``_check_all_steps_complete()``
true, which reverses the denial and encumbers budget against a request the
department said no to.

Two halves, and each is asserted here: the runtime guard, which holds for rows
already in the database, and the backfill migration, which takes them out of
the pending listings and revokes any live email tokens.

DB mocked; no MySQL.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.models.finance import ApprovalStepStatus
from app.services.finance_service import FinanceService


def _record(status=ApprovalStepStatus.PENDING):
    record = MagicMock()
    record.status = status
    record.entity_type = MagicMock()
    record.entity_id = "entity-id"
    record.token_expires_at = None
    record.approval_token = "tok"
    record.chain.organization_id = "org-1"
    return record


def _service(record, denied: bool):
    db = MagicMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = record
    db.execute = AsyncMock(return_value=result)
    db.flush = AsyncMock()
    service = FinanceService(db)
    service._chain_is_denied = AsyncMock(return_value=denied)
    service.get_current_pending_step = AsyncMock(return_value=record)
    service._advance_reachable_steps = AsyncMock()
    service._check_all_steps_complete = AsyncMock(return_value=False)
    service._finalize_denial = AsyncMock()
    service._terminate_pending_steps = AsyncMock()
    service.assert_different_person = AsyncMock()
    return service


class TestApprovingAfterADenialIsRefused:
    async def test_approve_step_refuses_a_chain_that_carries_a_denial(self):
        record = _record()
        service = _service(record, denied=True)

        with pytest.raises(ValueError, match="already been denied"):
            await service.approve_step("rec-1", "approver-1", org_id="org-1")

        assert record.status == ApprovalStepStatus.PENDING
        service._check_all_steps_complete.assert_not_awaited()

    async def test_deny_step_refuses_it_too(self):
        """Re-denying would re-run the entity finalization for no reason."""
        record = _record()
        service = _service(record, denied=True)

        with pytest.raises(ValueError, match="already been denied"):
            await service.deny_step("rec-1", "denier-1", org_id="org-1")

        service._finalize_denial.assert_not_awaited()

    async def test_a_clean_chain_is_unaffected(self):
        record = _record()
        service = _service(record, denied=False)

        await service.approve_step("rec-1", "approver-1", org_id="org-1")

        assert record.status == ApprovalStepStatus.APPROVED


class TestTheBackfillClosesThoseChains:
    """The runtime guard cannot take a row out of a listing or revoke a token;
    only the migration can."""

    def test_the_migration_skips_pending_steps_on_a_denied_entity(self):
        from pathlib import Path

        source = (
            Path(__file__).resolve().parents[1]
            / "alembic"
            / "versions"
            / "20260901_1300_d5e1f6a8b037_close_denied_approval_chains.py"
        ).read_text()

        assert "status = 'denied'" in source
        assert "r.status = 'skipped'" in source
        # The live email link for a later step has to die with the chain.
        assert "r.approval_token = NULL" in source
        assert "r.token_expires_at = NULL" in source
        assert "WHERE r.status = 'pending'" in source
