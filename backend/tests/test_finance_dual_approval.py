"""The dual-approval threshold: large requests need two different approvers.

Owner decision, 2026-10-09: at or above the department's threshold
(``finance.dual_approval_threshold`` in organization settings, off unless
set), a purchase request, check request or expense report is approved only
once two different people have approved it. The request waits for the second
approver rather than refusing the first.

* without a chain, the first manual approval is recorded on the request
  (``first_approved_by``) and a second, different approver completes it;
* a chain whose approvals all came from one person (or a single-step chain)
  ends with the request held, and a second approver completes it through the
  manual path; a chain approved by two people completes as before;
* nobody completes a held request they already approved, and the requester
  still cannot approve their own;
* the budget is encumbered once, on the approval that completes the request;
* the threshold is read defensively, written only through organization
  settings, and reported by ``GET /finance/settings``.
"""

from decimal import Decimal

import pytest
from pydantic import ValidationError
from sqlalchemy import select, text

from app.models.finance import (
    ApprovalChainStep,
    ApprovalEntityType,
    ApprovalStepRecord,
    ApprovalStepStatus,
    ApprovalStepType,
    ApproverType,
    Budget,
    BudgetCategory,
    CheckRequest,
    CheckRequestStatus,
    FiscalYearStatus,
    PurchaseRequest,
    PurchaseRequestStatus,
)
from app.models.user import Organization
from app.schemas.organization import FinanceSettingsUpdate, OrganizationSettingsUpdate
from app.services.finance_service import FinanceService
from app.utils.finance_settings import finance_settings_in
from tests.test_finance_budget_owners import _client, _org, _position, _user, _year

CR = ApprovalEntityType.CHECK_REQUEST
PR = ApprovalEntityType.PURCHASE_REQUEST


# ============================================
# Reading the setting, no database
# ============================================


@pytest.mark.unit
class TestReadingTheThreshold:
    def test_whole_dollars_turn_it_on(self):
        settings = {"finance": {"dual_approval_threshold": 1000}}
        assert finance_settings_in(settings).dual_approval_threshold == Decimal(1000)

    @pytest.mark.parametrize(
        "value", [None, 0, -5, True, "1000", 10.5, 10_000_000_000, [1000]]
    )
    def test_anything_else_reads_as_off(self, value):
        settings = {"finance": {"dual_approval_threshold": value}}
        assert finance_settings_in(settings).dual_approval_threshold is None

    @pytest.mark.parametrize("settings", [None, {}, {"finance": "on"}, []])
    def test_a_missing_section_reads_as_off(self, settings):
        assert finance_settings_in(settings).dual_approval_threshold is None

    def test_the_settings_update_accepts_it(self):
        update = OrganizationSettingsUpdate.model_validate(
            {"finance": {"dual_approval_threshold": 1000}}
        )
        assert update.model_dump(exclude_unset=True) == {
            "finance": {"dual_approval_threshold": 1000}
        }

    def test_null_clears_it(self):
        update = OrganizationSettingsUpdate.model_validate(
            {"finance": {"dual_approval_threshold": None}}
        )
        assert update.model_dump(exclude_unset=True) == {
            "finance": {"dual_approval_threshold": None}
        }

    @pytest.mark.parametrize("value", [0, -1, 10_000_000_000])
    def test_the_settings_update_refuses_an_unreachable_value(self, value):
        with pytest.raises(ValidationError, match="dual_approval_threshold"):
            FinanceSettingsUpdate.model_validate({"dual_approval_threshold": value})


# ============================================
# Fixtures
# ============================================


@pytest.fixture
async def dept(db_session):
    org_id = await _org(db_session, "dual")
    member_pos = await _position(db_session, org_id, "Member", ["finance.request"])
    approver_pos = await _position(
        db_session,
        org_id,
        "Officer",
        ["finance.request", "finance.view", "finance.approve"],
    )
    people = {
        "alice": await _user(db_session, org_id, "alice", [member_pos]),
        "chief": await _user(db_session, org_id, "chief", [approver_pos]),
        "captain": await _user(db_session, org_id, "captain", [approver_pos]),
    }
    year = _year(org_id, "FY2026", FiscalYearStatus.ACTIVE, people["chief"].id, 2026)
    gear = BudgetCategory(organization_id=org_id, name="Gear")
    db_session.add_all([year, gear])
    await db_session.flush()
    line = Budget(
        organization_id=org_id,
        fiscal_year_id=year.id,
        category_id=gear.id,
        amount_budgeted=Decimal("50000.00"),
        created_by=people["chief"].id,
    )
    db_session.add(line)
    org = await db_session.get(Organization, org_id)
    org.settings = {"finance": {"dual_approval_threshold": 1000}}
    await db_session.flush()
    return {"org_id": org_id, "fy_id": year.id, "budget_id": line.id, **people}


async def _check(db, dept, amount="1000.00") -> CheckRequest:
    service = FinanceService(db)
    cr = await service.create_check_request(
        org_id=dept["org_id"],
        requested_by=dept["alice"].id,
        fiscal_year_id=dept["fy_id"],
        payee_name="Hose Supply Co",
        amount=float(amount),
    )
    return await service.submit_check_request(cr.id, dept["org_id"])


async def _purchase(db, dept, amount="1200.00") -> PurchaseRequest:
    service = FinanceService(db)
    pr = await service.create_purchase_request(
        org_id=dept["org_id"],
        requested_by=dept["alice"].id,
        fiscal_year_id=dept["fy_id"],
        budget_id=dept["budget_id"],
        title="Turnout gear",
        estimated_amount=float(amount),
    )
    return await service.submit_purchase_request(pr.id, dept["org_id"])


async def _chain(db, dept, steps: int):
    await FinanceService(db).create_approval_chain(
        org_id=dept["org_id"],
        created_by=dept["chief"].id,
        name="Officer review",
        applies_to=CR,
        min_amount=0,
        is_default=True,
        steps=[
            {
                "step_order": n,
                "name": f"Review {n}",
                "step_type": ApprovalStepType.APPROVAL,
                "approver_type": ApproverType.PERMISSION,
                "approver_value": "finance.approve",
            }
            for n in range(1, steps + 1)
        ],
    )


async def _manual(db, user, entity_type, entity_id, action="approve", body=None):
    async with _client(db, user) as client:
        return await client.post(
            f"/finance/approvals/manual/{entity_type.value}/{entity_id}/{action}",
            json=body if body is not None else {},
        )


async def _step(db, user, entity_id):
    """Approve the request's first pending step as ``user``."""
    result = await db.execute(
        select(ApprovalStepRecord)
        .join(ApprovalChainStep, ApprovalChainStep.id == ApprovalStepRecord.step_id)
        .where(
            ApprovalStepRecord.entity_id == entity_id,
            ApprovalStepRecord.status == ApprovalStepStatus.PENDING,
        )
        # Chain position: records for one request are created in the same
        # instant, so their timestamps and random ids say nothing of order.
        .order_by(ApprovalChainStep.step_order)
        .execution_options(populate_existing=True)
    )
    record = result.scalars().first()
    assert record is not None
    async with _client(db, user) as client:
        resp = await client.post(f"/finance/approvals/{record.id}/approve", json={})
    assert resp.status_code == 200, resp.text
    return resp


async def _fresh(db, model, entity_id):
    return (
        await db.execute(
            select(model)
            .where(model.id == entity_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


async def _detail(db, user, entity_id):
    async with _client(db, user) as client:
        resp = await client.get(f"/finance/check-requests/{entity_id}")
    assert resp.status_code == 200, resp.text
    return resp.json()


# ============================================
# No approval chain
# ============================================


@pytest.mark.integration
class TestWithoutAChain:
    async def test_below_the_threshold_one_approval_is_enough(self, db_session, dept):
        cr = await _check(db_session, dept, amount="999.99")

        resp = await _manual(db_session, dept["chief"], CR, cr.id)

        assert resp.status_code == 204, resp.text
        cr = await _fresh(db_session, CheckRequest, cr.id)
        assert cr.status == CheckRequestStatus.APPROVED
        assert cr.first_approved_by is None

    async def test_at_the_threshold_the_first_approval_waits_for_a_second(
        self, db_session, dept
    ):
        cr = await _check(db_session, dept)

        first = await _manual(db_session, dept["chief"], CR, cr.id)

        assert first.status_code == 204, first.text
        held = await _fresh(db_session, CheckRequest, cr.id)
        assert held.status == CheckRequestStatus.PENDING_APPROVAL
        assert held.first_approved_by == dept["chief"].id
        assert held.first_approved_at is not None
        assert held.approved_by is None
        body = await _detail(db_session, dept["chief"], cr.id)
        assert body["awaitingSecondApproval"] is True
        assert body["firstApprovedBy"] == dept["chief"].id

        second = await _manual(db_session, dept["captain"], CR, cr.id)

        assert second.status_code == 204, second.text
        done = await _fresh(db_session, CheckRequest, cr.id)
        assert done.status == CheckRequestStatus.APPROVED
        assert done.approved_by == dept["captain"].id
        assert done.first_approved_by == dept["chief"].id
        assert (await _detail(db_session, dept["chief"], cr.id))[
            "awaitingSecondApproval"
        ] is False

    async def test_the_first_approver_cannot_give_the_second(self, db_session, dept):
        cr = await _check(db_session, dept)
        await _manual(db_session, dept["chief"], CR, cr.id)

        again = await _manual(db_session, dept["chief"], CR, cr.id)

        assert again.status_code == 400
        assert "already approved" in again.json()["detail"]
        assert (await _fresh(db_session, CheckRequest, cr.id)).status == (
            CheckRequestStatus.PENDING_APPROVAL
        )

    async def test_the_requester_still_cannot_approve(self, db_session, dept):
        cr = await _check(db_session, dept)
        await _manual(db_session, dept["chief"], CR, cr.id)
        alice_pos = await _position(
            db_session,
            dept["org_id"],
            "Treasurer",
            ["finance.request", "finance.approve"],
        )
        await db_session.flush()
        alice = dept["alice"]
        await db_session.execute(
            text("INSERT INTO user_positions (user_id, position_id) VALUES (:u, :p)"),
            {"u": alice.id, "p": alice_pos},
        )
        await db_session.refresh(alice, ["positions"])

        resp = await _manual(db_session, alice, CR, cr.id)

        assert resp.status_code == 400
        assert "your own" in resp.json()["detail"]

    async def test_a_held_request_can_still_be_denied(self, db_session, dept):
        cr = await _check(db_session, dept)
        await _manual(db_session, dept["chief"], CR, cr.id)

        resp = await _manual(
            db_session, dept["captain"], CR, cr.id, "deny", {"reason": "Over budget"}
        )

        assert resp.status_code == 204, resp.text
        assert (await _fresh(db_session, CheckRequest, cr.id)).status == (
            CheckRequestStatus.DENIED
        )

    async def test_with_the_threshold_off_one_approval_is_enough(
        self, db_session, dept
    ):
        org = await db_session.get(Organization, dept["org_id"])
        org.settings = {"finance": {"dual_approval_threshold": None}}
        await db_session.flush()
        cr = await _check(db_session, dept, amount="5000.00")

        await _manual(db_session, dept["chief"], CR, cr.id)

        assert (await _fresh(db_session, CheckRequest, cr.id)).status == (
            CheckRequestStatus.APPROVED
        )

    async def test_the_budget_is_encumbered_once_on_the_completing_approval(
        self, db_session, dept
    ):
        pr = await _purchase(db_session, dept)

        await _manual(db_session, dept["chief"], PR, pr.id)
        after_first = await _fresh(db_session, Budget, dept["budget_id"])
        assert after_first.amount_encumbered == Decimal("0.00")

        await _manual(db_session, dept["captain"], PR, pr.id)
        after_second = await _fresh(db_session, Budget, dept["budget_id"])
        assert after_second.amount_encumbered == Decimal("1200.00")
        assert (await _fresh(db_session, PurchaseRequest, pr.id)).status == (
            PurchaseRequestStatus.APPROVED
        )

    async def test_the_unrouted_list_marks_a_held_request(self, db_session, dept):
        held = await _check(db_session, dept)
        plain = await _check(db_session, dept, amount="2000.00")
        await _manual(db_session, dept["chief"], CR, held.id)

        async with _client(db_session, dept["captain"]) as client:
            rows = {
                r["entityId"]: r
                for r in (await client.get("/finance/approvals/unrouted")).json()
            }

        assert rows[held.id]["awaitingSecondApproval"] is True
        assert rows[held.id]["firstApprovedBy"] == dept["chief"].id
        assert rows[plain.id]["awaitingSecondApproval"] is False


# ============================================
# Through an approval chain
# ============================================


@pytest.mark.integration
class TestThroughAChain:
    async def test_a_single_step_chain_holds_the_request(self, db_session, dept):
        await _chain(db_session, dept, steps=1)
        cr = await _check(db_session, dept)

        resp = await _step(db_session, dept["chief"], cr.id)

        assert resp.status_code == 200, resp.text
        held = await _fresh(db_session, CheckRequest, cr.id)
        assert held.status == CheckRequestStatus.PENDING_APPROVAL
        assert held.first_approved_by == dept["chief"].id
        assert (await _detail(db_session, dept["captain"], cr.id))[
            "awaitingSecondApproval"
        ] is True

        again = await _manual(db_session, dept["chief"], CR, cr.id)
        second = await _manual(db_session, dept["captain"], CR, cr.id)

        assert again.status_code == 400
        assert second.status_code == 204, second.text
        assert (await _fresh(db_session, CheckRequest, cr.id)).status == (
            CheckRequestStatus.APPROVED
        )

    async def test_two_people_approving_the_chain_complete_it(self, db_session, dept):
        await _chain(db_session, dept, steps=2)
        cr = await _check(db_session, dept)

        await _step(db_session, dept["chief"], cr.id)
        await _step(db_session, dept["captain"], cr.id)

        done = await _fresh(db_session, CheckRequest, cr.id)
        assert done.status == CheckRequestStatus.APPROVED
        assert done.first_approved_by is None

    async def test_one_person_approving_every_step_is_held(self, db_session, dept):
        await _chain(db_session, dept, steps=2)
        cr = await _check(db_session, dept)

        await _step(db_session, dept["chief"], cr.id)
        await _step(db_session, dept["chief"], cr.id)

        assert (await _fresh(db_session, CheckRequest, cr.id)).status == (
            CheckRequestStatus.PENDING_APPROVAL
        )

    async def test_a_running_chain_is_not_approved_manually(self, db_session, dept):
        await _chain(db_session, dept, steps=2)
        cr = await _check(db_session, dept)
        await _step(db_session, dept["chief"], cr.id)

        resp = await _manual(db_session, dept["captain"], CR, cr.id)

        assert resp.status_code == 409
        assert (await _detail(db_session, dept["captain"], cr.id))[
            "awaitingSecondApproval"
        ] is False


# ============================================
# The settings endpoint
# ============================================


@pytest.mark.integration
class TestSettingsEndpoint:
    async def test_it_reports_the_threshold_in_force(self, db_session, dept):
        async with _client(db_session, dept["chief"]) as client:
            on = (await client.get("/finance/settings")).json()
        org = await db_session.get(Organization, dept["org_id"])
        org.settings = {"finance": {"dual_approval_threshold": "lots"}}
        await db_session.flush()
        async with _client(db_session, dept["chief"]) as client:
            off = (await client.get("/finance/settings")).json()

        assert Decimal(on["dualApprovalThreshold"]) == Decimal("1000")
        assert off["dualApprovalThreshold"] is None

    async def test_a_member_without_a_finance_permission_cannot_read_it(
        self, db_session, dept
    ):
        # finance.request reads it (the expense form warns about the
        # substantiation deadline from it); holding no finance permission does
        # not.
        nobody = await _user(
            db_session,
            dept["org_id"],
            "visitor",
            [await _position(db_session, dept["org_id"], "Visitor", ["events.view"])],
        )
        async with _client(db_session, nobody) as client:
            resp = await client.get("/finance/settings")

        assert resp.status_code == 403

    async def test_an_emailed_approver_counts_as_a_different_person(
        self, db_session, dept
    ):
        await FinanceService(db_session).create_approval_chain(
            org_id=dept["org_id"],
            created_by=dept["chief"].id,
            name="Board treasurer",
            applies_to=CR,
            min_amount=0,
            is_default=True,
            steps=[
                {
                    "step_order": 1,
                    "name": "Board treasurer",
                    "step_type": ApprovalStepType.APPROVAL,
                    "approver_type": ApproverType.EMAIL,
                    "approver_value": "Treasurer@Board.example",
                }
            ],
        )
        cr = await _check(db_session, dept)
        record = (
            await db_session.execute(
                select(ApprovalStepRecord).where(ApprovalStepRecord.entity_id == cr.id)
            )
        ).scalar_one()
        # As approve_by_token leaves it: approved, with no member recorded.
        record.status = ApprovalStepStatus.APPROVED
        await db_session.flush()

        service = FinanceService(db_session)
        held = await _fresh(db_session, CheckRequest, cr.id)
        people = await service._approvers_so_far(CR, held, dept["org_id"])
        resp = await _manual(db_session, dept["chief"], CR, cr.id)

        assert people == {"email:treasurer@board.example"}
        assert resp.status_code == 204, resp.text
        assert (await _fresh(db_session, CheckRequest, cr.id)).status == (
            CheckRequestStatus.APPROVED
        )
