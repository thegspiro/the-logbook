"""Owner decisions of 2026-11-01 on finance approvals, as built 2026-11-06.

KNOWN_LIMITATIONS "Finance — Purchase Requests: Named Approvers, Notices and
the Paid Amount":

* **Naming grants that step.** A member an approval chain step names may
  approve or deny that step without ``finance.approve`` — and nothing else:
  not a later step naming someone else, not another request, not a step that
  names nobody, and not an override (which still needs ``finance.approve``).
  They read the request the email sends them to, and the coverage report
  counts them.
* **Email approvers and requesters.** The members a step names are emailed
  when a request reaches it (``FINANCE_DUTIES``), the requester when it is
  approved or denied (``FINANCE_REQUESTS``); never the requester for a step,
  never someone who opted out, never twice for one step or one decision.
"""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.finance import (
    ApprovalEntityType,
    ApprovalStepStatus,
    PurchaseRequestStatus,
)
from app.services.finance_approval_notifications import (
    DECIDED,
    STEP_REACHED,
    send_approval_notices,
)
from app.services.finance_approver_matching import ApproverMismatchError
from app.services.finance_service import FinanceService
from tests.test_finance_approver_enforcement import (
    _approval,
    _client,
    _make_member,
    _make_org,
    _pending_pr,
)

pytestmark = pytest.mark.integration


class _Mailer:
    """Records each send; every address is accepted."""

    def __init__(self):
        self.sends: list[dict] = []

    def factory(self, organization=None):
        mailer = self

        class _Service:
            async def send_email(self, to_emails, subject, html_body, **kwargs):
                mailer.sends.append(
                    {
                        "to": list(to_emails),
                        "subject": subject,
                        "html": html_body,
                        "text": kwargs.get("text_body") or "",
                        "template_type": kwargs.get("template_type"),
                    }
                )
                return len(to_emails), 0

        return _Service()

    def to(self, template_type: str) -> list[str]:
        return [
            address
            for send in self.sends
            if send["template_type"] == template_type
            for address in send["to"]
        ]


@pytest.fixture
def mailer(monkeypatch):
    recorder = _Mailer()
    monkeypatch.setattr(
        "app.services.email_service.EmailService", recorder.factory, raising=True
    )
    return recorder


@pytest.fixture
async def chief_chain(db_session: AsyncSession):
    """A purchase request waiting on a Chief step, then a Treasurer step.

    The Chief holds no finance.approve — only the baseline finance.request
    every member has.
    """
    org_id = await _make_org(db_session)
    requester = await _make_member(db_session, org_id, "finance.request")
    chief = await _make_member(
        db_session, org_id, "finance.request", slug="chief", first_name="Cass"
    )
    treasurer = await _make_member(
        db_session, org_id, "finance.request", "finance.approve", slug="treasurer"
    )
    bystander = await _make_member(db_session, org_id, "finance.request")
    service = FinanceService(db_session)
    pr, chain, records = await _pending_pr(
        service,
        org_id,
        requester.id,
        [
            _approval(1, "position", "chief", name="Chief"),
            _approval(2, "position", "treasurer", name="Treasurer"),
        ],
        title="Thermal camera",
    )
    return {
        "org_id": org_id,
        "requester": requester,
        "chief": chief,
        "treasurer": treasurer,
        "bystander": bystander,
        "service": service,
        "pr": pr,
        "records": records,
    }


# ============================================
# Naming grants that step
# ============================================


class TestNamingGrantsThatStep:
    async def test_a_named_member_without_finance_approve_approves_their_step(
        self, db_session, chief_chain
    ):
        s = chief_chain
        first, _second = s["records"]
        async with _client(db_session, s["chief"]) as client:
            response = await client.post(
                f"/finance/approvals/{first.id}/approve", json={"notes": "ok"}
            )
        assert response.status_code == 200, response.text
        assert first.status == ApprovalStepStatus.APPROVED
        assert first.acted_by == s["chief"].id

    async def test_a_named_member_may_deny_their_step(self, db_session, chief_chain):
        s = chief_chain
        first, _second = s["records"]
        async with _client(db_session, s["chief"]) as client:
            response = await client.post(
                f"/finance/approvals/{first.id}/deny", json={"notes": "no"}
            )
        assert response.status_code == 200, response.text
        assert s["pr"].status == PurchaseRequestStatus.DENIED

    async def test_they_cannot_act_on_the_next_step_naming_someone_else(
        self, db_session, chief_chain
    ):
        s = chief_chain
        first, second = s["records"]
        await s["service"].approve_step(first.id, s["chief"], org_id=s["org_id"])
        async with _client(db_session, s["chief"]) as client:
            approve = await client.post(
                f"/finance/approvals/{second.id}/approve", json={}
            )
            deny = await client.post(f"/finance/approvals/{second.id}/deny", json={})
        assert approve.status_code == 403
        assert deny.status_code == 403
        assert approve.json()["detail"] == (
            "Only the approver this step names can act on it."
        )
        assert second.status == ApprovalStepStatus.PENDING

    async def test_they_cannot_act_on_another_request(self, db_session, chief_chain):
        s = chief_chain
        _pr, _chain, others = await _pending_pr(
            s["service"],
            s["org_id"],
            s["requester"].id,
            [_approval(1, "position", "treasurer", name="Treasurer")],
            title="Hose",
        )
        with pytest.raises(ApproverMismatchError, match="names can act"):
            await s["service"].approve_step(
                others[0].id, s["chief"], org_id=s["org_id"]
            )
        assert others[0].status == ApprovalStepStatus.PENDING

    async def test_a_step_naming_nobody_still_needs_finance_approve(
        self, db_session, chief_chain
    ):
        s = chief_chain
        _pr, _chain, others = await _pending_pr(
            s["service"], s["org_id"], s["requester"].id, [_approval(1)]
        )
        with pytest.raises(ApproverMismatchError):
            await s["service"].approve_step(
                others[0].id, s["chief"], org_id=s["org_id"]
            )

    async def test_a_member_nobody_named_learns_nothing_about_the_step(
        self, db_session, chief_chain
    ):
        # The second step is not current: a finance approver would be told
        # an earlier step is pending. A member it does not name is refused
        # before that is looked at.
        s = chief_chain
        _first, second = s["records"]
        async with _client(db_session, s["bystander"]) as client:
            response = await client.post(
                f"/finance/approvals/{second.id}/approve", json={}
            )
        assert response.status_code == 403
        assert "earlier" not in response.json()["detail"]

    async def test_configure_approvals_alone_does_not_override(
        self, db_session, chief_chain
    ):
        s = chief_chain
        admin = await _make_member(
            db_session, s["org_id"], "finance.configure_approvals"
        )
        first, _second = s["records"]
        with pytest.raises(ApproverMismatchError):
            await s["service"].approve_step(
                first.id, admin, org_id=s["org_id"], override_reason="urgent"
            )
        assert first.status == ApprovalStepStatus.PENDING

    async def test_they_read_the_request_and_are_offered_the_step(
        self, db_session, chief_chain
    ):
        s = chief_chain
        async with _client(db_session, s["chief"]) as client:
            named = await client.get(f"/finance/purchase-requests/{s['pr'].id}")
        async with _client(db_session, s["bystander"]) as client:
            other = await client.get(f"/finance/purchase-requests/{s['pr'].id}")
        assert named.status_code == 200, named.text
        steps = named.json()["approvalSteps"]
        assert steps[0]["canAct"] is True
        assert steps[1]["canAct"] is False
        assert other.status_code == 404


# ============================================
# Email approvers and requesters
# ============================================


class TestApprovalNotices:
    async def test_reaching_a_step_emails_the_members_it_names(
        self, db_session, chief_chain, mailer
    ):
        s = chief_chain
        notices = s["service"].take_approval_notices()
        assert [n.kind for n in notices] == [STEP_REACHED]
        await send_approval_notices(db_session, notices)

        assert mailer.to("finance_approval_step_reached") == [s["chief"].email]
        send = mailer.sends[0]
        assert "Thermal camera" in send["subject"]
        assert "$1,000.00" in send["subject"]
        assert f"/finance/purchase-requests/{s['pr'].id}" in send["text"]
        assert "Chief" in send["text"]

    async def test_approving_moves_the_notice_to_the_next_step(
        self, db_session, chief_chain, mailer
    ):
        s = chief_chain
        first, _second = s["records"]
        s["service"].take_approval_notices()
        await s["service"].approve_step(first.id, s["chief"], org_id=s["org_id"])
        await send_approval_notices(db_session, s["service"].take_approval_notices())

        assert mailer.to("finance_approval_step_reached") == [s["treasurer"].email]
        assert mailer.to("finance_request_approved") == []

    async def test_the_final_approval_emails_the_requester(
        self, db_session, chief_chain, mailer
    ):
        s = chief_chain
        first, second = s["records"]
        s["service"].take_approval_notices()
        await s["service"].approve_step(first.id, s["chief"], org_id=s["org_id"])
        await s["service"].approve_step(second.id, s["treasurer"], org_id=s["org_id"])
        notices = s["service"].take_approval_notices()
        assert [n.kind for n in notices] == [STEP_REACHED, DECIDED]
        await send_approval_notices(db_session, notices)

        assert mailer.to("finance_request_approved") == [s["requester"].email]
        send = next(
            x for x in mailer.sends if x["template_type"] == "finance_request_approved"
        )
        assert send["subject"] == "Purchase request approved: Thermal camera"

    async def test_a_denial_emails_the_requester_the_reason_escaped(
        self, db_session, chief_chain, mailer
    ):
        s = chief_chain
        first, _second = s["records"]
        s["service"].take_approval_notices()
        await s["service"].deny_step(
            first.id, s["chief"], "Over <b>budget</b>", org_id=s["org_id"]
        )
        await send_approval_notices(db_session, s["service"].take_approval_notices())

        assert mailer.to("finance_request_denied") == [s["requester"].email]
        send = mailer.sends[0]
        assert "Over &lt;b&gt;budget&lt;/b&gt;" in send["html"]
        assert "Over <b>budget</b>" in send["text"]

    async def test_a_requester_withdrawing_their_own_request_is_not_emailed(
        self, db_session, mailer
    ):
        org_id = await _make_org(db_session)
        treasurer = await _make_member(
            db_session, org_id, "finance.approve", slug="treasurer"
        )
        service = FinanceService(db_session)
        _pr, _chain, records = await _pending_pr(
            service,
            org_id,
            treasurer.id,
            [_approval(1, "position", "treasurer")],
        )
        service.take_approval_notices()
        await service.deny_step(records[0].id, treasurer, "withdrawn", org_id=org_id)
        await send_approval_notices(db_session, service.take_approval_notices())
        assert mailer.sends == []

    async def test_the_requester_is_never_emailed_to_approve_their_own_request(
        self, db_session, mailer
    ):
        org_id = await _make_org(db_session)
        treasurer = await _make_member(
            db_session, org_id, "finance.approve", slug="treasurer"
        )
        other = await _make_member(
            db_session, org_id, "finance.approve", slug="treasurer"
        )
        service = FinanceService(db_session)
        await _pending_pr(
            service, org_id, treasurer.id, [_approval(1, "position", "treasurer")]
        )
        await send_approval_notices(db_session, service.take_approval_notices())
        assert mailer.to("finance_approval_step_reached") == [other.email]

    async def test_opted_out_members_are_not_emailed(
        self, db_session, chief_chain, mailer
    ):
        s = chief_chain
        s["chief"].notification_preferences = {"email_kinds": {"finance_duties": False}}
        s["requester"].notification_preferences = {
            "email_kinds": {"finance_requests": False}
        }
        first, _second = s["records"]
        notices = s["service"].take_approval_notices()
        await s["service"].deny_step(first.id, s["chief"], "no", org_id=s["org_id"])
        notices += s["service"].take_approval_notices()
        await send_approval_notices(db_session, notices)
        assert mailer.sends == []

    async def test_an_emailed_link_step_is_not_sent_a_second_notice(
        self, db_session, mailer
    ):
        org_id = await _make_org(db_session)
        requester = await _make_member(db_session, org_id, "finance.request")
        service = FinanceService(db_session)
        _pr, _chain, records = await _pending_pr(
            service,
            org_id,
            requester.id,
            [_approval(1, "email", "board@example.com")],
        )
        assert service.take_approval_notices() == []
        assert records[0].approvers_notified_at is None
        # The approval link itself went out, through the existing path.
        assert mailer.to("finance_approval_request") == ["board@example.com"]


class TestNoticesAreSentOnce:
    async def test_a_re_run_advance_queues_nothing_new(self, db_session, chief_chain):
        s = chief_chain
        first, _second = s["records"]
        assert len(s["service"].take_approval_notices()) == 1
        assert first.approvers_notified_at is not None

        await s["service"]._advance_reachable_steps(
            ApprovalEntityType.PURCHASE_REQUEST, s["pr"].id, s["org_id"]
        )
        assert s["service"].take_approval_notices() == []

    async def test_a_retried_approval_emails_nobody_twice(
        self, db_session, chief_chain, mailer
    ):
        s = chief_chain
        first, second = s["records"]
        s["service"].take_approval_notices()
        await s["service"].approve_step(first.id, s["chief"], org_id=s["org_id"])
        s["service"].take_approval_notices()
        async with _client(db_session, s["treasurer"]) as client:
            once = await client.post(f"/finance/approvals/{second.id}/approve", json={})
            again = await client.post(
                f"/finance/approvals/{second.id}/approve", json={}
            )
        assert once.status_code == 200, once.text
        assert again.status_code == 400
        assert mailer.to("finance_request_approved") == [s["requester"].email]

    async def test_a_notice_for_a_step_already_decided_is_dropped(
        self, db_session, chief_chain, mailer
    ):
        # Sent after the commit: if the step was acted on in between, telling
        # its approvers it waits on them would be wrong.
        s = chief_chain
        first, _second = s["records"]
        notices = s["service"].take_approval_notices()
        await s["service"].deny_step(first.id, s["chief"], "no", org_id=s["org_id"])
        await send_approval_notices(db_session, notices)
        assert mailer.to("finance_approval_step_reached") == []


async def test_another_departments_member_holding_the_slug_is_not_emailed(
    db_session, mailer
):
    org_id = await _make_org(db_session)
    other_org = await _make_org(db_session)
    requester = await _make_member(db_session, org_id, "finance.request")
    chief = await _make_member(db_session, org_id, slug="chief")
    await _make_member(db_session, other_org, slug="chief")
    service = FinanceService(db_session)
    await _pending_pr(
        service, org_id, requester.id, [_approval(1, "position", "chief")]
    )
    await send_approval_notices(db_session, service.take_approval_notices())
    assert mailer.to("finance_approval_step_reached") == [chief.email]
