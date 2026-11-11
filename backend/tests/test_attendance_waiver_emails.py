"""Attendance waiver emails: who is told, what they are told, and only once.

Pins, against a real database:

* submitting emails each routed approver (never the requester) the
  *requested* notice with Approve and Deny buttons, and says only whether a
  reason was given — the reason itself is in no email;
* a decision emails the member the outcome, the decider and their note; a
  Chief's override says so;
* withdrawing emails the approvers the request email reached;
* an approver who switched training duties email off is not emailed;
* a template's CC gets a separate copy without the buttons, the category or
  the note;
* a second run for the same log row sends nothing (CLAUDE.md pitfall #36),
  a claim in flight blocks a racing worker, and a failed send is released so
  a retry can send it.

The transport is patched at ``EmailService.send_attendance_waiver_notice``
for the routing tests; the rendering tests run the real renderer on the
shipped defaults.
"""

from datetime import date
from types import SimpleNamespace
from typing import Any, Dict, List
from unittest.mock import patch

import pytest
from sqlalchemy import select, text

from app.models.attendance_waiver import (
    AttendanceWaiverAction,
    AttendanceWaiverEmailSend,
    AttendanceWaiverRequestAction,
)
from app.models.email_template import EmailTemplate, EmailTemplateType
from app.services import attendance_waiver_service as engine
from app.services.attendance_waiver_email_service import (
    NOT_IN_COPY,
    AttendanceWaiverEmails,
    _Recipient,
    review_buttons_html,
    user_key,
)
from app.services.attendance_waiver_service import AttendanceWaiverService
from app.services.email_service import EmailService
from app.services.email_templates_attendance_waivers import DEFAULT_TEMPLATE_DEFS
from tests.waiver_request_support import (
    assign,
    load,
    make_member,
    make_org,
    make_position,
    make_requirement,
    make_session,
    set_policy,
    uid,
    utc,
)

NOW = utc(2026, 11, 10, 12)
DRILL = utc(2026, 11, 20, 23)
REASON = "Recovering from knee surgery"


class _Outbox:
    """Stands in for one waiver notice to one address."""

    def __init__(self, ok: bool = True) -> None:
        self.ok = ok
        self.sent: List[SimpleNamespace] = []

    async def __call__(
        self, template_type, to_email, context, db=None, organization_id=None
    ) -> bool:
        if self.ok:
            self.sent.append(
                SimpleNamespace(type=template_type, to=to_email, context=dict(context))
            )
        return self.ok

    def to(self, address: str) -> List[SimpleNamespace]:
        return [m for m in self.sent if m.to == address]


@pytest.fixture(autouse=True)
def _clock(monkeypatch):
    monkeypatch.setattr(engine, "_now", lambda: NOW)


@pytest.fixture
def outbox():
    box = _Outbox()
    with patch.object(EmailService, "send_attendance_waiver_notice", box):
        yield box


@pytest.fixture
async def dept(db_session):
    org_id = await make_org(db_session)
    officer_pos = await make_position(db_session, org_id, "Training Officer")
    chief_pos = await make_position(db_session, org_id, "Chief", slug="fire_chief")
    secretary_pos = await make_position(db_session, org_id, "Secretary")
    member = await make_member(db_session, org_id, "Sam")
    officer = await make_member(db_session, org_id, "Tina")
    chief = await make_member(db_session, org_id, "Cal")
    secretary = await make_member(db_session, org_id, "Sue")
    await assign(db_session, officer, officer_pos)
    await assign(db_session, chief, chief_pos)
    await assign(db_session, secretary, secretary_pos)
    await set_policy(
        db_session,
        org_id,
        approver_position_ids=[officer_pos],
        categories=["Medical", "Work"],
        reason_text="optional",
    )
    requirement = await make_requirement(db_session, org_id)
    drill = await make_session(db_session, org_id, DRILL, link=[requirement])
    await db_session.flush()
    return SimpleNamespace(
        org=org_id,
        secretary_pos=secretary_pos,
        member=await load(db_session, member),
        officer=await load(db_session, officer),
        chief=await load(db_session, chief),
        secretary=await load(db_session, secretary),
        drill=drill,
    )


async def _submit(db, dept, reason=REASON, category="Medical"):
    return await AttendanceWaiverService(db).submit(
        dept.org, dept.member, dept.drill, category, reason
    )


async def _action_id(db, request_id: str, action: AttendanceWaiverAction) -> str:
    return (
        await db.execute(
            select(AttendanceWaiverRequestAction.id).where(
                AttendanceWaiverRequestAction.request_id == request_id,
                AttendanceWaiverRequestAction.action == action,
            )
        )
    ).scalar_one()


async def _stamps(db, request_id: str) -> List[AttendanceWaiverEmailSend]:
    return list(
        (
            await db.execute(
                select(AttendanceWaiverEmailSend).where(
                    AttendanceWaiverEmailSend.request_id == request_id
                )
            )
        )
        .scalars()
        .all()
    )


def _values(message: SimpleNamespace) -> str:
    return " ".join(str(v) for v in message.context.values())


# ---------------------------------------------------------------------------
# Who is told
# ---------------------------------------------------------------------------


@pytest.mark.integration
class TestSubmitting:
    async def test_each_approver_gets_buttons_and_the_requester_nothing(
        self, db_session, dept, outbox
    ):
        request = await _submit(db_session, dept)

        assert [m.to for m in outbox.sent] == [dept.officer.email]
        (message,) = outbox.sent
        assert message.type == EmailTemplateType.SESSION_WAIVER_REQUESTED
        assert f"/attendance-waivers/{request.id}?action=approve" in (
            message.context["review_buttons_html"]
        )
        assert f"/attendance-waivers/{request.id}?action=deny" in (
            message.context["review_buttons_html"]
        )
        assert message.context["category"] == "Medical"
        assert message.context["reason_provided"] == "Yes"
        assert not outbox.to(dept.member.email)

    async def test_the_reason_is_in_no_email(self, db_session, dept, outbox):
        await _submit(db_session, dept)

        assert outbox.sent
        assert all(REASON not in _values(m) for m in outbox.sent)

    async def test_no_reason_says_so(self, db_session, dept, outbox):
        await _submit(db_session, dept, reason=None)

        (message,) = outbox.sent
        assert message.context["reason_provided"] == "No"

    async def test_the_fallback_reaches_the_chief(self, db_session, dept, outbox):
        await db_session.execute(
            text("DELETE FROM user_positions WHERE user_id = :u"),
            {"u": dept.officer.id},
        )
        await db_session.flush()

        await _submit(db_session, dept)

        assert [m.to for m in outbox.sent] == [dept.chief.email]

    async def test_an_approver_who_opted_out_is_not_emailed(
        self, db_session, dept, outbox
    ):
        dept.officer.notification_preferences = {
            "email_kinds": {"training_duties": False}
        }
        await db_session.flush()

        await _submit(db_session, dept)

        assert outbox.sent == []


@pytest.mark.integration
class TestDeciding:
    async def test_the_member_is_told_the_outcome_and_the_note(
        self, db_session, dept, outbox
    ):
        request = await _submit(db_session, dept)
        outbox.sent.clear()

        await AttendanceWaiverService(db_session).deny(
            dept.org, dept.officer, request.id, "Drill is mandatory this month"
        )

        (message,) = outbox.sent
        assert message.to == dept.member.email
        assert message.type == EmailTemplateType.SESSION_WAIVER_DECIDED
        assert message.context["outcome"] == "Denied"
        assert message.context["decided_by"] == dept.officer.display_name
        assert message.context["decision_note"] == "Drill is mandatory this month"
        assert REASON not in _values(message)

    async def test_a_chief_override_says_so(self, db_session, dept, outbox):
        request = await _submit(db_session, dept)
        await AttendanceWaiverService(db_session).deny(
            dept.org, dept.officer, request.id, None
        )
        outbox.sent.clear()

        await AttendanceWaiverService(db_session).chief_override(
            dept.org, dept.chief, request.id, "Documented injury"
        )

        (message,) = outbox.sent
        assert message.to == dept.member.email
        assert message.context["outcome"] == "Approved on the Chief's override"
        assert message.context["decided_by"] == dept.chief.display_name

    async def test_the_decision_ignores_the_members_opt_out(
        self, db_session, dept, outbox
    ):
        """It changes how their attendance is graded: always sent."""
        dept.member.notification_preferences = {"email_notifications": False}
        await db_session.flush()
        request = await _submit(db_session, dept)
        outbox.sent.clear()

        await AttendanceWaiverService(db_session).approve(
            dept.org, dept.officer, request.id
        )

        assert [m.to for m in outbox.sent] == [dept.member.email]


@pytest.mark.integration
class TestWithdrawing:
    async def test_the_approvers_who_were_asked_are_told(
        self, db_session, dept, outbox
    ):
        request = await _submit(db_session, dept)
        outbox.sent.clear()

        await AttendanceWaiverService(db_session).withdraw(
            dept.org, dept.member, request.id
        )

        (message,) = outbox.sent
        assert message.to == dept.officer.email
        assert message.type == EmailTemplateType.SESSION_WAIVER_WITHDRAWN

    async def test_nobody_is_told_who_was_never_asked(self, db_session, dept):
        failing = _Outbox(ok=False)
        with patch.object(EmailService, "send_attendance_waiver_notice", failing):
            request = await _submit(db_session, dept)
        box = _Outbox()
        with patch.object(EmailService, "send_attendance_waiver_notice", box):
            await AttendanceWaiverService(db_session).withdraw(
                dept.org, dept.member, request.id
            )

        assert box.sent == []


# ---------------------------------------------------------------------------
# Copies
# ---------------------------------------------------------------------------


@pytest.mark.integration
class TestCopies:
    async def _cc(self, db_session, dept, **fields) -> None:
        db_session.add(
            EmailTemplate(
                organization_id=dept.org,
                template_type=EmailTemplateType.SESSION_WAIVER_REQUESTED,
                name="Training Waiver Requested",
                subject="s",
                html_body="<p>x</p>",
                is_active=True,
                **fields,
            )
        )
        await db_session.flush()

    async def test_a_cc_gets_its_own_copy_without_buttons_or_category(
        self, db_session, dept, outbox
    ):
        await self._cc(
            db_session,
            dept,
            default_cc=["records@dept.example"],
            default_cc_position_ids=[dept.secretary_pos],
        )

        await _submit(db_session, dept)

        assert sorted(m.to for m in outbox.sent) == sorted(
            [dept.officer.email, "records@dept.example", dept.secretary.email]
        )
        for address in ("records@dept.example", dept.secretary.email):
            (copy,) = outbox.to(address)
            assert copy.context["review_buttons_html"] == ""
            assert "action=approve" not in _values(copy)
            assert copy.context["category"] == NOT_IN_COPY
            assert REASON not in _values(copy)
            assert "copy" in copy.context["summary"]
        (original,) = outbox.to(dept.officer.email)
        assert "action=approve" in original.context["review_buttons_html"]

    async def test_an_approver_also_on_the_cc_list_gets_one_email(
        self, db_session, dept, outbox
    ):
        await self._cc(db_session, dept, default_cc=[dept.officer.email.upper()])

        await _submit(db_session, dept)

        assert [m.to for m in outbox.sent] == [dept.officer.email]

    async def test_a_decision_copy_leaves_the_note_out(self, db_session, dept, outbox):
        db_session.add(
            EmailTemplate(
                organization_id=dept.org,
                template_type=EmailTemplateType.SESSION_WAIVER_DECIDED,
                name="Training Waiver Decided",
                subject="s",
                html_body="<p>x</p>",
                is_active=True,
                default_bcc=["records@dept.example"],
            )
        )
        await db_session.flush()
        request = await _submit(db_session, dept)
        outbox.sent.clear()

        await AttendanceWaiverService(db_session).approve(
            dept.org, dept.officer, request.id, "Noted, feel better"
        )

        (copy,) = outbox.to("records@dept.example")
        assert copy.context["decision_note"] == NOT_IN_COPY
        assert "Noted, feel better" not in _values(copy)


# ---------------------------------------------------------------------------
# Once
# ---------------------------------------------------------------------------


@pytest.mark.integration
class TestASecondRunSendsNothing:
    async def test_a_redelivered_action_is_not_sent_twice(
        self, db_session, dept, outbox
    ):
        request = await _submit(db_session, dept)
        submitted = await _action_id(
            db_session, request.id, AttendanceWaiverAction.SUBMITTED
        )
        assert len(outbox.sent) == 1

        again = await AttendanceWaiverEmails(db_session).send_for_action(
            dept.org, submitted
        )

        assert again == 0
        assert len(outbox.sent) == 1
        (stamp,) = await _stamps(db_session, request.id)
        assert stamp.recipient_key == user_key(str(dept.officer.id))
        assert stamp.sent_at is not None

    async def test_a_claim_in_flight_blocks_a_racing_worker(self, db_session, dept):
        failing = _Outbox(ok=False)
        with patch.object(EmailService, "send_attendance_waiver_notice", failing):
            request = await _submit(db_session, dept)
        submitted = await _action_id(
            db_session, request.id, AttendanceWaiverAction.SUBMITTED
        )
        # Another worker has claimed the officer's email and not finished.
        db_session.add(
            AttendanceWaiverEmailSend(
                id=uid(),
                organization_id=dept.org,
                request_id=request.id,
                action_id=submitted,
                recipient_key=user_key(str(dept.officer.id)),
            )
        )
        await db_session.flush()
        box = _Outbox()
        with patch.object(EmailService, "send_attendance_waiver_notice", box):
            sent = await AttendanceWaiverEmails(db_session).send_for_action(
                dept.org, submitted
            )

        assert sent == 0
        assert box.sent == []

    async def test_a_failed_send_is_released_for_a_retry(self, db_session, dept):
        failing = _Outbox(ok=False)
        with patch.object(EmailService, "send_attendance_waiver_notice", failing):
            request = await _submit(db_session, dept)
        assert await _stamps(db_session, request.id) == []
        submitted = await _action_id(
            db_session, request.id, AttendanceWaiverAction.SUBMITTED
        )

        box = _Outbox()
        with patch.object(EmailService, "send_attendance_waiver_notice", box):
            sent = await AttendanceWaiverEmails(db_session).send_for_action(
                dept.org, submitted
            )

        assert sent == 1
        assert [m.to for m in box.sent] == [dept.officer.email]

    async def test_another_departments_action_sends_nothing(
        self, db_session, dept, outbox
    ):
        request = await _submit(db_session, dept)
        submitted = await _action_id(
            db_session, request.id, AttendanceWaiverAction.SUBMITTED
        )
        other = await make_org(db_session)
        outbox.sent.clear()
        await db_session.execute(
            text("DELETE FROM attendance_waiver_email_sends WHERE request_id = :r"),
            {"r": request.id},
        )

        assert (
            await AttendanceWaiverEmails(db_session).send_for_action(other, submitted)
            == 0
        )
        assert outbox.sent == []


# ---------------------------------------------------------------------------
# What the rendered email says
# ---------------------------------------------------------------------------


def _default(template_type: EmailTemplateType) -> Dict[str, Any]:
    return next(d for d in DEFAULT_TEMPLATE_DEFS if d["type"] == template_type)


async def _render(template_type: EmailTemplateType, context: Dict[str, str]):
    default = _default(template_type)
    return await EmailService(None)._render_with_fallback(
        template_type=template_type,
        context=dict(context),
        default_subject=default["subject"],
        default_html=default["html"],
        default_text=default["text"],
    )


def _request(**fields) -> SimpleNamespace:
    values = dict(
        id="req-1",
        event_title_snapshot="Hose & Ladder Drill",
        session_date=date(2026, 11, 20),
        reason=REASON,
        category="Medical",
    )
    values.update(fields)
    return SimpleNamespace(**values)


def _action(kind: AttendanceWaiverAction, note=None) -> SimpleNamespace:
    return SimpleNamespace(id="act-1", action=kind, actor_id="u-officer", note=note)


_APPROVER = _Recipient("user:u-officer", "tina@dept.example", "Tina Officer", False)
_COPY = _Recipient("addr:x", "records@dept.example", "", True)


@pytest.mark.unit
class TestTheRenderedEmail:
    @pytest.mark.parametrize(
        "template_type",
        [
            EmailTemplateType.SESSION_WAIVER_REQUESTED,
            EmailTemplateType.MEETING_WAIVER_REQUESTED,
        ],
    )
    async def test_the_approvers_email_has_buttons_and_no_reason(self, template_type):
        context = AttendanceWaiverEmails._context(
            "requested",
            _request(),
            _action(AttendanceWaiverAction.SUBMITTED),
            _APPROVER,
            "Sam Member",
            {},
        )
        subject, html, text_body = await _render(template_type, context)

        assert "Sam Member" in subject
        assert "?action=approve" in html
        assert "?action=deny" in html
        assert ">Approve</a>" in html
        assert "Medical" in html
        assert "Hose &amp; Ladder Drill" in html
        assert REASON not in html
        assert REASON not in (text_body or "")
        assert "?action=approve" in (text_body or "")

    async def test_the_copy_has_no_buttons_category_or_reason(self):
        context = AttendanceWaiverEmails._context(
            "requested",
            _request(),
            _action(AttendanceWaiverAction.SUBMITTED),
            _COPY,
            "Sam Member",
            {},
        )
        _subject, html, text_body = await _render(
            EmailTemplateType.SESSION_WAIVER_REQUESTED, context
        )

        assert "action=" not in html
        assert "action=" not in (text_body or "")
        assert ">Approve</a>" not in html
        assert "Medical" not in html
        assert REASON not in html
        assert NOT_IN_COPY in html
        assert "Hello there," in html

    @pytest.mark.parametrize(
        ("kind", "outcome"),
        [
            (AttendanceWaiverAction.APPROVED, "Approved"),
            (AttendanceWaiverAction.DENIED, "Denied"),
            (AttendanceWaiverAction.CHIEF_OVERRIDE, "Approved on the Chief"),
        ],
    )
    async def test_the_decision_renders_each_outcome(self, kind, outcome):
        context = AttendanceWaiverEmails._context(
            "decided",
            _request(),
            _action(kind, note="See me Monday"),
            _Recipient("user:u-sam", "sam@dept.example", "Sam Member", False),
            "Sam Member",
            {"u-officer": "Tina Officer"},
        )
        subject, html, _text = await _render(
            EmailTemplateType.SESSION_WAIVER_DECIDED, context
        )

        assert outcome in html
        assert "Tina Officer" in html
        assert "See me Monday" in html
        assert "/attendance-waivers/req-1" in html
        assert "?action=" not in html
        assert subject.startswith("Waiver request ")

    async def test_the_withdrawal_renders(self):
        context = AttendanceWaiverEmails._context(
            "withdrawn",
            _request(),
            _action(AttendanceWaiverAction.WITHDRAWN),
            _APPROVER,
            "Sam Member",
            {},
        )
        subject, html, _text = await _render(
            EmailTemplateType.SESSION_WAIVER_WITHDRAWN, context
        )

        assert "withdrew" in html
        assert "Sam Member" in subject
        assert "?action=" not in html

    def test_the_buttons_escape_their_urls(self):
        markup = review_buttons_html('a"><script>x</script>')

        assert "<script>" not in markup
        assert "&quot;" in markup
