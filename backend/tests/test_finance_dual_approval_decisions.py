"""The dual-approval threshold, refined by the owner's decisions of 2026-11-01.

``test_finance_dual_approval.py`` covers the rule itself. This file covers
what the four decisions added to it:

* **per-type thresholds** — ``finance.dual_approval_thresholds`` gives each
  request type its own figure; a type left unset follows the department
  threshold, so nothing changes until a department sets one, and ``0`` turns
  the rule off for that type;
* **a named office** — ``finance.second_approver_position`` names the
  position whose holder must be one of the two approvers; an approver outside
  it is refused while the office is still owed, and a slug naming no position
  fails closed;
* **one person, however they approved** — an emailed-link approval whose
  address is a member's counts as that member, so the same person cannot give
  both approvals;
* **the notice** — when a request is first held, the members who could give
  the second approval are emailed, once.
"""

from decimal import Decimal
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError
from sqlalchemy import select

from app.api.dependencies import get_current_user
from app.api.v1.endpoints import organizations as organization_endpoints
from app.core.database import get_db
from app.models.finance import (
    ApprovalEntityType,
    ApprovalStepRecord,
    ApprovalStepStatus,
    ApprovalStepType,
    ApproverType,
    CheckRequest,
    CheckRequestStatus,
    PurchaseRequest,
    PurchaseRequestStatus,
)
from app.models.user import Organization, Position
from app.schemas.organization import FinanceSettingsUpdate
from app.services.finance_approval_notifications import send_approval_notices
from app.services.finance_service import FinanceService
from app.utils.finance_settings import finance_settings_in
from tests import test_finance_dual_approval as dual
from tests.test_finance_budget_owners import _client, _position, _user
from tests.test_finance_dual_approval import (
    _chain,
    _check,
    _detail,
    _fresh,
    _manual,
    _purchase,
    _step,
)

# The department, its approvers and its threshold, shared with the rule's own
# tests; bound here so pytest finds the fixture in this module.
dept = dual.dept

CR = ApprovalEntityType.CHECK_REQUEST
PR = ApprovalEntityType.PURCHASE_REQUEST
ER = ApprovalEntityType.EXPENSE_REPORT
SEND = "app.services.finance_second_approval._send"


# ============================================
# Reading the settings, no database
# ============================================


@pytest.mark.unit
class TestReadingPerTypeThresholds:
    def test_an_unset_type_follows_the_department_threshold(self):
        resolved = finance_settings_in({"finance": {"dual_approval_threshold": 1000}})
        for entity_type in (PR, CR, ER):
            assert resolved.threshold_for(entity_type) == Decimal(1000)

    def test_a_type_of_its_own_and_a_type_turned_off(self):
        resolved = finance_settings_in(
            {
                "finance": {
                    "dual_approval_threshold": 1000,
                    "dual_approval_thresholds": {
                        "purchase_request": 2500,
                        "check_request": 0,
                    },
                }
            }
        )
        assert resolved.threshold_for(PR) == Decimal(2500)
        assert resolved.threshold_for(CR) is None
        assert resolved.threshold_for(ER) == Decimal(1000)

    def test_a_type_can_be_on_while_the_department_figure_is_off(self):
        resolved = finance_settings_in(
            {"finance": {"dual_approval_thresholds": {"expense_report": 300}}}
        )
        assert resolved.threshold_for(ER) == Decimal(300)
        assert resolved.threshold_for(PR) is None

    @pytest.mark.parametrize("value", [None, -5, True, "2500", 10.5, [1]])
    def test_a_malformed_type_value_follows_the_department_threshold(self, value):
        resolved = finance_settings_in(
            {
                "finance": {
                    "dual_approval_threshold": 1000,
                    "dual_approval_thresholds": {"check_request": value},
                }
            }
        )
        assert resolved.threshold_for(CR) == Decimal(1000)

    @pytest.mark.parametrize("section", ["2500", [2500], None])
    def test_a_malformed_section_follows_the_department_threshold(self, section):
        resolved = finance_settings_in(
            {
                "finance": {
                    "dual_approval_threshold": 1000,
                    "dual_approval_thresholds": section,
                }
            }
        )
        assert resolved.threshold_for(PR) == Decimal(1000)

    def test_the_settings_update_accepts_per_type_values(self):
        update = FinanceSettingsUpdate.model_validate(
            {"dual_approval_thresholds": {"check_request": 0, "expense_report": 50}}
        )
        assert update.model_dump(exclude_unset=True) == {
            "dual_approval_thresholds": {"check_request": 0, "expense_report": 50}
        }

    @pytest.mark.parametrize(
        "body",
        [
            {"check_request": -1},
            {"check_request": 10_000_000_000},
            {"cheque_request": 100},
        ],
    )
    def test_the_settings_update_refuses_a_bad_per_type_value(self, body):
        with pytest.raises(ValidationError):
            FinanceSettingsUpdate.model_validate({"dual_approval_thresholds": body})


@pytest.mark.unit
class TestReadingTheOffice:
    def test_absent_means_any_approver(self):
        assert finance_settings_in({}).second_approver_position is None

    @pytest.mark.parametrize("value", ["", "   ", 7, None])
    def test_blank_or_malformed_means_any_approver(self, value):
        settings = {"finance": {"second_approver_position": value}}
        assert finance_settings_in(settings).second_approver_position is None

    def test_a_slug_is_read(self):
        settings = {"finance": {"second_approver_position": " chief "}}
        assert finance_settings_in(settings).second_approver_position == "chief"


# ============================================
# Helpers
# ============================================


async def _settings(db, dept, **finance):
    org = await db.get(Organization, dept["org_id"])
    org.settings = {"finance": {"dual_approval_threshold": 1000, **finance}}
    await db.flush()


async def _treasurer(db, dept):
    """A finance approver holding the Treasurer position; returns (user, slug)."""
    position_id = await _position(
        db,
        dept["org_id"],
        "Treasurer",
        ["finance.request", "finance.view", "finance.approve"],
    )
    user = await _user(db, dept["org_id"], "treasurer", [position_id])
    slug = (
        await db.execute(select(Position.slug).where(Position.id == position_id))
    ).scalar_one()
    return user, slug


async def _email_chain(db, dept, address):
    await FinanceService(db).create_approval_chain(
        org_id=dept["org_id"],
        created_by=dept["chief"].id,
        name="Emailed approver",
        applies_to=CR,
        min_amount=0,
        is_default=True,
        steps=[
            {
                "step_order": 1,
                "name": "Emailed approver",
                "step_type": ApprovalStepType.APPROVAL,
                "approver_type": ApproverType.EMAIL,
                "approver_value": address,
            }
        ],
    )


async def _approve_by_link(db, entity_id):
    """Leave the request's step as approve_by_token does: no member recorded."""
    record = (
        await db.execute(
            select(ApprovalStepRecord).where(ApprovalStepRecord.entity_id == entity_id)
        )
    ).scalar_one()
    record.status = ApprovalStepStatus.APPROVED
    await db.flush()


def _settings_client(db, user) -> AsyncClient:
    app = FastAPI()
    app.include_router(organization_endpoints.router, prefix="/organization")
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: db
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


# ============================================
# Per-type thresholds
# ============================================


@pytest.mark.integration
class TestPerTypeThresholds:
    async def test_a_type_with_a_higher_figure_completes_on_one_approval(
        self, db_session, dept
    ):
        await _settings(
            db_session, dept, dual_approval_thresholds={"check_request": 5000}
        )
        cr = await _check(db_session, dept, amount="1000.00")
        pr = await _purchase(db_session, dept, amount="1200.00")

        await _manual(db_session, dept["chief"], CR, cr.id)
        await _manual(db_session, dept["chief"], PR, pr.id)

        assert (await _fresh(db_session, CheckRequest, cr.id)).status == (
            CheckRequestStatus.APPROVED
        )
        assert (await _fresh(db_session, PurchaseRequest, pr.id)).status == (
            PurchaseRequestStatus.PENDING_APPROVAL
        )

    async def test_a_type_turned_off_completes_on_one_approval(self, db_session, dept):
        await _settings(db_session, dept, dual_approval_thresholds={"check_request": 0})
        cr = await _check(db_session, dept, amount="9000.00")

        await _manual(db_session, dept["chief"], CR, cr.id)

        assert (await _fresh(db_session, CheckRequest, cr.id)).status == (
            CheckRequestStatus.APPROVED
        )

    async def test_a_lower_type_figure_holds_a_smaller_request(self, db_session, dept):
        org = await db_session.get(Organization, dept["org_id"])
        org.settings = {"finance": {"dual_approval_thresholds": {"check_request": 500}}}
        await db_session.flush()
        cr = await _check(db_session, dept, amount="600.00")

        await _manual(db_session, dept["chief"], CR, cr.id)

        assert (await _fresh(db_session, CheckRequest, cr.id)).status == (
            CheckRequestStatus.PENDING_APPROVAL
        )

    async def test_the_route_preview_reads_the_type_figure(self, db_session, dept):
        await _settings(
            db_session, dept, dual_approval_thresholds={"check_request": 5000}
        )
        service = FinanceService(db_session)

        check = await service.preview_request_route(
            dept["org_id"], CR.value, Decimal("1000")
        )
        purchase = await service.preview_request_route(
            dept["org_id"], PR.value, Decimal("1000")
        )

        assert check["second_approver_required"] is False
        assert purchase["second_approver_required"] is True

    async def test_the_settings_endpoint_reports_each_type(self, db_session, dept):
        await _settings(
            db_session,
            dept,
            dual_approval_thresholds={"check_request": 0, "expense_report": 250},
        )
        async with _client(db_session, dept["chief"]) as client:
            body = (await client.get("/finance/settings")).json()

        rows = {r["entityType"]: r for r in body["dualApprovalThresholds"]}
        assert [r["entityType"] for r in body["dualApprovalThresholds"]] == [
            "purchase_request",
            "check_request",
            "expense_report",
        ]
        assert Decimal(rows["purchase_request"]["threshold"]) == Decimal(1000)
        assert rows["purchase_request"]["followsDefault"] is True
        assert rows["check_request"]["threshold"] is None
        assert rows["check_request"]["followsDefault"] is False
        assert Decimal(rows["expense_report"]["threshold"]) == Decimal(250)
        assert rows["expense_report"]["followsDefault"] is False


# ============================================
# The emailed approver who is also a member
# ============================================


@pytest.mark.integration
class TestOnePersonByEmail:
    async def test_a_link_approval_from_a_members_address_counts_as_the_member(
        self, db_session, dept
    ):
        chief = dept["chief"]
        await _email_chain(db_session, dept, chief.email.upper())
        cr = await _check(db_session, dept)
        await _approve_by_link(db_session, cr.id)

        held = await _fresh(db_session, CheckRequest, cr.id)
        people = await FinanceService(db_session)._approvers_so_far(
            CR, held, dept["org_id"]
        )
        again = await _manual(db_session, chief, CR, cr.id)

        assert people == {chief.id}
        assert again.status_code == 400
        assert "already approved" in again.json()["detail"]
        assert (await _fresh(db_session, CheckRequest, cr.id)).status == (
            CheckRequestStatus.PENDING_APPROVAL
        )

        second = await _manual(db_session, dept["captain"], CR, cr.id)

        assert second.status_code == 204, second.text
        assert (await _fresh(db_session, CheckRequest, cr.id)).status == (
            CheckRequestStatus.APPROVED
        )


# ============================================
# The named office
# ============================================


@pytest.mark.integration
class TestNamedOffice:
    async def test_an_approver_outside_the_office_cannot_give_the_second(
        self, db_session, dept
    ):
        treasurer, slug = await _treasurer(db_session, dept)
        await _settings(db_session, dept, second_approver_position=slug)
        cr = await _check(db_session, dept)
        await _manual(db_session, dept["chief"], CR, cr.id)

        refused = await _manual(db_session, dept["captain"], CR, cr.id)

        assert refused.status_code == 400
        assert "Treasurer position" in refused.json()["detail"]
        assert (await _fresh(db_session, CheckRequest, cr.id)).status == (
            CheckRequestStatus.PENDING_APPROVAL
        )

        done = await _manual(db_session, treasurer, CR, cr.id)

        assert done.status_code == 204, done.text
        assert (await _fresh(db_session, CheckRequest, cr.id)).status == (
            CheckRequestStatus.APPROVED
        )

    async def test_once_the_office_has_approved_anyone_else_completes_it(
        self, db_session, dept
    ):
        treasurer, slug = await _treasurer(db_session, dept)
        await _settings(db_session, dept, second_approver_position=slug)
        cr = await _check(db_session, dept)

        await _manual(db_session, treasurer, CR, cr.id)
        done = await _manual(db_session, dept["captain"], CR, cr.id)

        assert done.status_code == 204, done.text
        assert (await _fresh(db_session, CheckRequest, cr.id)).status == (
            CheckRequestStatus.APPROVED
        )

    async def test_a_chain_approved_by_two_others_waits_for_the_office(
        self, db_session, dept
    ):
        treasurer, slug = await _treasurer(db_session, dept)
        await _settings(db_session, dept, second_approver_position=slug)
        await _chain(db_session, dept, steps=2)
        cr = await _check(db_session, dept)

        await _step(db_session, dept["chief"], cr.id)
        await _step(db_session, dept["captain"], cr.id)

        assert (await _fresh(db_session, CheckRequest, cr.id)).status == (
            CheckRequestStatus.PENDING_APPROVAL
        )
        assert (await _detail(db_session, dept["chief"], cr.id))[
            "awaitingSecondApproval"
        ] is True

        done = await _manual(db_session, treasurer, CR, cr.id)

        assert done.status_code == 204, done.text
        assert (await _fresh(db_session, CheckRequest, cr.id)).status == (
            CheckRequestStatus.APPROVED
        )

    async def test_a_position_that_no_longer_exists_fails_closed(
        self, db_session, dept
    ):
        await _settings(db_session, dept, second_approver_position="gone-office")
        cr = await _check(db_session, dept)
        await _manual(db_session, dept["chief"], CR, cr.id)

        refused = await _manual(db_session, dept["captain"], CR, cr.id)

        assert refused.status_code == 400
        assert "no longer exists" in refused.json()["detail"]
        assert (await _fresh(db_session, CheckRequest, cr.id)).status == (
            CheckRequestStatus.PENDING_APPROVAL
        )

    async def test_below_the_threshold_the_office_is_not_asked_for(
        self, db_session, dept
    ):
        _treasurer_user, slug = await _treasurer(db_session, dept)
        await _settings(db_session, dept, second_approver_position=slug)
        cr = await _check(db_session, dept, amount="10.00")

        resp = await _manual(db_session, dept["captain"], CR, cr.id)

        assert resp.status_code == 204, resp.text
        assert (await _fresh(db_session, CheckRequest, cr.id)).status == (
            CheckRequestStatus.APPROVED
        )

    async def test_the_settings_endpoint_names_the_office(self, db_session, dept):
        _treasurer_user, slug = await _treasurer(db_session, dept)
        await _settings(db_session, dept, second_approver_position=slug)

        async with _client(db_session, dept["chief"]) as client:
            body = (await client.get("/finance/settings")).json()

        assert body["secondApproverPosition"] == slug
        assert body["secondApproverPositionName"] == "Treasurer"


@pytest.mark.integration
class TestSavingTheOffice:
    async def _admin(self, db, dept):
        position_id = await _position(
            db, dept["org_id"], "Settings Admin", ["settings.manage"]
        )
        return await _user(db, dept["org_id"], "admin", [position_id])

    async def test_an_unknown_position_is_refused(self, db_session, dept):
        admin = await self._admin(db_session, dept)
        async with _settings_client(db_session, admin) as client:
            resp = await client.patch(
                "/organization/settings",
                json={"finance": {"second_approver_position": "no-such-office"}},
            )

        assert resp.status_code == 400, resp.text
        org = await db_session.get(Organization, dept["org_id"])
        await db_session.refresh(org)
        assert "second_approver_position" not in (org.settings or {}).get("finance", {})

    async def test_a_known_position_is_stored_as_its_slug(self, db_session, dept):
        admin = await self._admin(db_session, dept)
        _treasurer_user, slug = await _treasurer(db_session, dept)
        org = await db_session.get(Organization, dept["org_id"])
        async with _settings_client(db_session, admin) as client:
            resp = await client.patch(
                "/organization/settings",
                json={"finance": {"second_approver_position": slug.upper()}},
            )
            await db_session.refresh(org)
            saved = org.settings["finance"]["second_approver_position"]
            cleared = await client.patch(
                "/organization/settings",
                json={"finance": {"second_approver_position": "  "}},
            )
            await db_session.refresh(org)

        assert resp.status_code == 200, resp.text
        assert saved == slug
        assert cleared.status_code == 200, cleared.text
        assert org.settings["finance"]["second_approver_position"] is None
        # The threshold the dept fixture set is untouched by either save.
        assert org.settings["finance"]["dual_approval_threshold"] == 1000


# ============================================
# The notice
# ============================================


@pytest.mark.integration
class TestSecondApprovalNotice:
    async def test_the_eligible_approvers_are_emailed_once(self, db_session, dept):
        treasurer, _slug = await _treasurer(db_session, dept)
        cr = await _check(db_session, dept)
        send = AsyncMock(side_effect=lambda db, org, users, **kw: list(users))

        with patch(SEND, send):
            await _manual(db_session, dept["chief"], CR, cr.id)
            held = await _fresh(db_session, CheckRequest, cr.id)
            # A second evaluation of the same hold (a retried or repeated
            # call) finds the claim taken and queues nothing.
            service = FinanceService(db_session)
            again = await service._held_for_second_approver(
                CR, held, dept["chief"].id, dept["org_id"]
            )

        assert again is True
        assert service.take_approval_notices() == []
        assert send.await_count == 1
        recipients = {u.id for u in send.await_args.args[2]}
        assert recipients == {dept["captain"].id, treasurer.id}
        assert send.await_args.kwargs["template_type"] == (
            "finance_second_approval_needed"
        )
        assert held.second_approval_requested_at is not None

    async def test_only_the_office_is_emailed_while_it_is_owed(self, db_session, dept):
        treasurer, slug = await _treasurer(db_session, dept)
        await _settings(db_session, dept, second_approver_position=slug)
        cr = await _check(db_session, dept)
        send = AsyncMock(side_effect=lambda db, org, users, **kw: list(users))

        with patch(SEND, send):
            await _manual(db_session, dept["chief"], CR, cr.id)

        assert send.await_count == 1
        assert {u.id for u in send.await_args.args[2]} == {treasurer.id}

    async def test_a_chain_hold_emails_the_others(self, db_session, dept):
        await _chain(db_session, dept, steps=1)
        cr = await _check(db_session, dept)
        send = AsyncMock(side_effect=lambda db, org, users, **kw: list(users))

        with patch(SEND, send):
            await _step(db_session, dept["chief"], cr.id)

        assert send.await_count == 1
        assert {u.id for u in send.await_args.args[2]} == {dept["captain"].id}

    async def test_nothing_is_sent_when_one_approval_completes_it(
        self, db_session, dept
    ):
        cr = await _check(db_session, dept, amount="10.00")
        send = AsyncMock(side_effect=lambda db, org, users, **kw: list(users))

        with patch(SEND, send):
            await _manual(db_session, dept["chief"], CR, cr.id)

        assert send.await_count == 0
        assert (
            await _fresh(db_session, CheckRequest, cr.id)
        ).second_approval_requested_at is None

    async def test_a_failing_mailer_does_not_fail_the_approval(self, db_session, dept):
        cr = await _check(db_session, dept)

        with patch(SEND, AsyncMock(side_effect=RuntimeError("smtp down"))):
            resp = await _manual(db_session, dept["chief"], CR, cr.id)

        assert resp.status_code == 204, resp.text
        assert (await _fresh(db_session, CheckRequest, cr.id)).first_approved_by == (
            dept["chief"].id
        )

    async def test_nothing_is_sent_for_a_hold_that_rolls_back(self, db_session, dept):
        cr = await _check(db_session, dept)
        # Plain values: the rollback expires every loaded object.
        cr_id, chief_id = cr.id, dept["chief"].id
        send = AsyncMock(side_effect=lambda db, org, users, **kw: list(users))

        with patch(SEND, send):
            savepoint = await db_session.begin_nested()
            service = FinanceService(db_session)
            await service.manual_approve(CR, cr_id, chief_id, org_id=dept["org_id"])
            # Queued for after the commit, and nothing sent yet.
            assert [n.kind for n in service.approval_notices] == ["second_approval"]
            assert send.await_count == 0
            # The transaction fails before the endpoint commits: the claim
            # and the hold go with it, and the queue is never sent.
            await savepoint.rollback()
            rolled_back = await _fresh(db_session, CheckRequest, cr_id)

            assert send.await_count == 0
            assert rolled_back.second_approval_requested_at is None
            assert rolled_back.first_approved_by is None

            # The retried approval holds it again, commits, and sends once.
            chief = dept["chief"]
            await db_session.refresh(chief)
            await db_session.refresh(chief, ["positions"])
            resp = await _manual(db_session, chief, CR, cr_id)

        assert resp.status_code == 204, resp.text
        assert send.await_count == 1
        assert (
            await _fresh(db_session, CheckRequest, cr_id)
        ).second_approval_requested_at is not None

    async def test_a_failure_before_the_commit_sends_nothing(self, db_session, dept):
        cr = await _check(db_session, dept)
        send = AsyncMock(side_effect=lambda db, org, users, **kw: list(users))

        with (
            patch(SEND, send),
            patch(
                "app.api.v1.endpoints.finance.log_audit_event",
                AsyncMock(side_effect=RuntimeError("audit down")),
            ),
        ):
            resp = await _manual(db_session, dept["chief"], CR, cr.id)

        assert resp.status_code >= 400
        assert send.await_count == 0

    async def test_a_request_decided_before_the_send_is_not_announced(
        self, db_session, dept
    ):
        cr = await _check(db_session, dept)
        send = AsyncMock(side_effect=lambda db, org, users, **kw: list(users))
        service = FinanceService(db_session)
        await service.manual_approve(CR, cr.id, dept["chief"].id, org_id=dept["org_id"])
        notices = service.take_approval_notices()
        await FinanceService(db_session).manual_approve(
            CR, cr.id, dept["captain"].id, org_id=dept["org_id"]
        )

        with patch(SEND, send):
            sent = await send_approval_notices(db_session, notices)

        assert sent == 0
        assert send.await_count == 0
