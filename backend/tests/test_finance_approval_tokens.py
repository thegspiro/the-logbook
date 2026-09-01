"""Security tests for single-use external finance approval tokens."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.dialects import mysql

from app.models.finance import ApprovalStepStatus, ApproverType
from app.services.finance_service import FinanceService
from app.services.separation_of_duties import SeparationOfDutiesError


def _result(record):
    result = MagicMock()
    result.scalar_one_or_none.return_value = record
    return result


def _pending_record(step=None):
    record = MagicMock()
    record.status = ApprovalStepStatus.PENDING
    record.token_expires_at = None
    record.entity_type = MagicMock()
    record.entity_id = "entity-id"
    record.approval_token = "approval-token"
    record.step = step
    record.chain.organization_id = "token-org-id"
    return record


def _email_step(approver_value, allow_self_approval=False):
    step = MagicMock()
    step.approver_type = ApproverType.EMAIL
    step.approver_value = approver_value
    step.allow_self_approval = allow_self_approval
    return step


@pytest.mark.parametrize("action", ["approve_by_token", "deny_by_token"])
async def test_token_action_locks_and_consumes_token(action):
    record = _pending_record()
    db = MagicMock()
    db.execute = AsyncMock(return_value=_result(record))
    db.flush = AsyncMock()
    service = FinanceService(db)
    service.get_current_pending_step = AsyncMock(return_value=record)
    # The db double answers every query with the same row, so the
    # terminal-denial probe would read this record back as a denial.
    # Its own coverage is in test_finance_denied_chain_is_terminal.py.
    service._chain_is_denied = AsyncMock(return_value=False)
    service._advance_reachable_steps = AsyncMock()
    service._check_all_steps_complete = AsyncMock(return_value=False)
    service._finalize_denial = AsyncMock()

    await getattr(service, action)(record.approval_token, "reviewed")

    # The FIRST query, not the last: the token lookup is what must hold the
    # row lock. Asserting on await_args pinned this to whichever query happened
    # to run last, so it broke as soon as denial gained a follow-up query to
    # terminate the rest of the chain — while the lock it checks was untouched.
    statement = db.execute.await_args_list[0].args[0]
    sql = str(statement.compile(dialect=mysql.dialect()))
    assert sql.rstrip().endswith("FOR UPDATE")
    assert record.approval_token is None
    assert record.notes == "reviewed"
    db.flush.assert_awaited_once()
    if action == "approve_by_token":
        service._advance_reachable_steps.assert_awaited_once_with(
            record.entity_type, record.entity_id, "token-org-id"
        )
        service._check_all_steps_complete.assert_awaited_once_with(
            record.entity_type, record.entity_id, "token-org-id"
        )


@pytest.mark.parametrize("action", ["approve_by_token", "deny_by_token"])
async def test_token_action_rejects_a_later_step_out_of_order(action):
    """Every step in a chain is created PENDING up front and an EMAIL step's
    token is emailed immediately regardless of chain position, so without an
    order check whoever holds a later step's token could act before an
    earlier step resolves -- and a deny finalizes the whole entity right
    away, killing the request before earlier reviewers weighed in."""
    record = _pending_record()
    earlier_step = _pending_record()  # a different, still-pending record
    db = MagicMock()
    db.execute = AsyncMock(return_value=_result(record))
    service = FinanceService(db)
    service.get_current_pending_step = AsyncMock(return_value=earlier_step)
    # The db double answers every query with the same row, so the
    # terminal-denial probe would read this record back as a denial.
    # Its own coverage is in test_finance_denied_chain_is_terminal.py.
    service._chain_is_denied = AsyncMock(return_value=False)

    with pytest.raises(ValueError, match="earlier approval step"):
        await getattr(service, action)(record.approval_token, "too soon")

    assert record.status == ApprovalStepStatus.PENDING  # never mutated


class TestApproveByTokenSelfApprovalGuard:
    """Codex review (PR #1806): an EMAIL-type step whose approver_value is

    the requester's own email let the requester approve their own request
    via the token path, with no check at all -- contradicting
    FINANCE_MODULE.md's documented "prevents the requester from also being
    the approver at any step" invariant. approve_by_token() must reject this
    unless the step opts in via allow_self_approval.
    """

    @staticmethod
    def _service_for(record, requester_email):
        db = MagicMock()
        db.execute = AsyncMock(return_value=_result(record))
        db.flush = AsyncMock()
        service = FinanceService(db)
        service.get_current_pending_step = AsyncMock(return_value=record)
        # The db double answers every query with the same row, so the
        # terminal-denial probe would read this record back as a denial.
        # Its own coverage is in test_finance_denied_chain_is_terminal.py.
        service._chain_is_denied = AsyncMock(return_value=False)
        service._entity_creator_email = AsyncMock(return_value=requester_email)
        service._advance_reachable_steps = AsyncMock()
        service._check_all_steps_complete = AsyncMock(return_value=False)
        return service

    async def test_rejects_when_approver_email_matches_requester(self):
        record = _pending_record(step=_email_step("treasurer@dept.org"))
        service = self._service_for(record, requester_email="treasurer@dept.org")

        with pytest.raises(SeparationOfDutiesError):
            await service.approve_by_token(record.approval_token, "self-approving")

        assert record.status == ApprovalStepStatus.PENDING  # never mutated
        service._advance_reachable_steps.assert_not_awaited()

    async def test_rejects_case_insensitively(self):
        record = _pending_record(step=_email_step("Treasurer@Dept.org"))
        service = self._service_for(record, requester_email="treasurer@dept.org")

        with pytest.raises(SeparationOfDutiesError):
            await service.approve_by_token(record.approval_token)

    async def test_allows_when_allow_self_approval_is_set(self):
        record = _pending_record(
            step=_email_step("treasurer@dept.org", allow_self_approval=True)
        )
        service = self._service_for(record, requester_email="treasurer@dept.org")

        await service.approve_by_token(record.approval_token)

        assert record.status == ApprovalStepStatus.APPROVED

    async def test_allows_when_emails_differ(self):
        record = _pending_record(step=_email_step("board@dept.org"))
        service = self._service_for(record, requester_email="treasurer@dept.org")

        await service.approve_by_token(record.approval_token)

        assert record.status == ApprovalStepStatus.APPROVED

    async def test_allows_non_email_approver_types(self):
        # POSITION/PERMISSION/SPECIFIC_USER steps have no email to compare --
        # unaffected by this guard, matching the original reasoning for those
        # types (no Logbook identity resolvable from the token alone).
        step = MagicMock()
        step.approver_type = ApproverType.POSITION
        step.approver_value = "treasurer"
        step.allow_self_approval = False
        record = _pending_record(step=step)
        service = self._service_for(record, requester_email="treasurer@dept.org")

        await service.approve_by_token(record.approval_token)

        assert record.status == ApprovalStepStatus.APPROVED
