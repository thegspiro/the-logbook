"""A member is told when their equipment request is approved, declined or issued.

Before this, the decision reached the member only as a badge on My Equipment,
and the quartermaster's note — for a decline, usually the reason — reached
nobody at all.
"""

import uuid
from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints import inventory as inventory_endpoints
from app.models.inventory import EquipmentRequest
from app.models.notification import (
    NotificationChannel,
    NotificationLog,
    NotificationRule,
    NotificationTrigger,
)
from app.schemas.inventory import EquipmentRequestReview
from app.services.email_policy import (
    EMAIL_POLICIES,
    EmailKind,
    EmailPolicy,
    member_receives_email,
)
from app.services.equipment_request_notifications import (
    build_notice,
    send_equipment_request_notice,
)


def _uid() -> str:
    return str(uuid.uuid4())


def _request(**overrides) -> EquipmentRequest:
    values = {
        "id": _uid(),
        "organization_id": _uid(),
        "requester_id": _uid(),
        "item_name": "Short Sleeve",
        "quantity": 1,
        "requested_size": None,
        "review_notes": None,
        "fulfillment_type": None,
    }
    values.update(overrides)
    return EquipmentRequest(**values)


@pytest.mark.unit
class TestEmailPolicy:
    def test_an_optional_kind_is_sent_by_default(self):
        assert member_receives_email(None, EmailKind.EQUIPMENT_REQUEST_UPDATE)
        assert member_receives_email({}, EmailKind.EQUIPMENT_REQUEST_UPDATE)

    def test_the_global_email_switch_does_not_yet_govern_it(self):
        # The member-facing opt-out is deliberately not built yet; until it
        # is, the old all-or-nothing switch does not silence this notice.
        prefs = {"email_notifications": False}
        assert member_receives_email(prefs, EmailKind.EQUIPMENT_REQUEST_UPDATE)

    def test_an_explicit_choice_for_the_kind_is_honoured(self):
        prefs = {"email_kinds": {"equipment_request_update": False}}
        assert not member_receives_email(prefs, EmailKind.EQUIPMENT_REQUEST_UPDATE)

    @pytest.mark.parametrize(
        "prefs",
        [
            {"email_kinds": "off"},
            {"email_kinds": {"equipment_request_update": "no"}},
            {"email_kinds": {"equipment_request_update": None}},
        ],
    )
    def test_a_malformed_choice_falls_back_to_the_default(self, prefs):
        assert member_receives_email(prefs, EmailKind.EQUIPMENT_REQUEST_UPDATE)

    def test_a_required_kind_ignores_the_members_choice(self, monkeypatch):
        monkeypatch.setitem(
            EMAIL_POLICIES,
            EmailKind.EQUIPMENT_REQUEST_UPDATE,
            EmailPolicy(label="Test", required=True),
        )
        prefs = {"email_kinds": {"equipment_request_update": False}}
        assert member_receives_email(prefs, EmailKind.EQUIPMENT_REQUEST_UPDATE)

    def test_every_kind_is_classified(self):
        assert set(EMAIL_POLICIES) == set(EmailKind)


@pytest.mark.unit
class TestBuildNotice:
    def test_a_decline_carries_the_quartermasters_note(self):
        notice = build_notice(
            _request(review_notes="We don't carry XS; one is on order."), "denied"
        )
        assert notice["subject"] == "Your equipment request was declined: Short Sleeve"
        assert "declined your request for Short Sleeve" in notice["message"]
        assert "We don't carry XS" in notice["message"]
        ctx = notice["email_context"]
        assert ctx["status_label"] == "declined"
        assert "We don&#x27;t carry XS" in ctx["notes_html"]
        assert ctx["review_notes"].startswith("From the quartermaster:")

    def test_no_note_leaves_nothing_behind(self):
        ctx = build_notice(_request(), "approved")["email_context"]
        assert ctx["notes_html"] == ""
        assert ctx["review_notes"] == ""
        assert ctx["details_html"] == ""
        assert ctx["details_text"] == ""

    def test_approval_says_another_notice_follows(self):
        notice = build_notice(_request(), "approved")
        assert notice["subject"] == "Your equipment request was approved: Short Sleeve"
        assert "another notice when it has been issued" in notice["message"]

    @pytest.mark.parametrize(
        ("fulfillment_type", "phrase", "label"),
        [
            ("checkout", "loaned to you", "Loaned (to be returned)"),
            ("assignment", "assigned to you as your gear", "Assigned to you"),
            ("issuance", "issued to you from stock", "Issued from stock"),
        ],
    )
    def test_issued_says_how(self, fulfillment_type, phrase, label):
        notice = build_notice(_request(fulfillment_type=fulfillment_type), "fulfilled")
        assert notice["subject"] == "Your equipment request was issued: Short Sleeve"
        assert phrase in notice["message"]
        assert f"How it was issued: {label}" in notice["email_context"]["details_text"]

    def test_size_and_quantity_are_listed(self):
        ctx = build_notice(_request(requested_size="xxxl", quantity=2), "approved")[
            "email_context"
        ]
        assert ctx["details_text"] == "Size: 3XL\nQuantity: 2"
        assert "3XL" in ctx["details_html"]

    def test_member_supplied_text_is_escaped_in_the_html(self):
        ctx = build_notice(
            _request(requested_size="<b>", review_notes="<script>x</script>"),
            "denied",
        )["email_context"]
        assert "<script>" not in ctx["notes_html"]
        assert "&lt;script&gt;" in ctx["notes_html"]
        assert "<B>" not in ctx["details_html"]

    def test_a_line_break_in_the_item_name_cannot_split_the_subject(self):
        notice = build_notice(_request(item_name="Short\r\nBcc: x"), "denied")
        assert "\n" not in notice["subject"]
        assert "\r" not in notice["subject"]

    def test_an_unknown_outcome_is_refused(self):
        with pytest.raises(ValueError, match="Unknown equipment request outcome"):
            build_notice(_request(), "pending")


# ---------------------------------------------------------------------------
# Delivery, against the database
# ---------------------------------------------------------------------------


@pytest.fixture
async def dept(db_session: AsyncSession):
    org_id, member_id = _uid(), _uid()
    await db_session.execute(
        text(
            "INSERT INTO organizations (id, name, organization_type, slug, timezone) "
            "VALUES (:id, 'Notice Dept', 'fire_department', :s, 'UTC')"
        ),
        {"id": org_id, "s": f"eqn-{org_id[:8]}"},
    )
    await db_session.execute(
        text(
            "INSERT INTO users (id, organization_id, username, first_name, "
            "last_name, email, password_hash, status) "
            "VALUES (:id, :o, :u, 'Sam', 'Reyes', :e, 'hashed', 'active')"
        ),
        {
            "id": member_id,
            "o": org_id,
            "u": f"sam{member_id[:6]}",
            "e": f"sam{member_id[:6]}@test.com",
        },
    )
    req = EquipmentRequest(
        id=_uid(),
        organization_id=org_id,
        requester_id=member_id,
        item_name="Short Sleeve",
        quantity=1,
        requested_duration="ongoing",
        requested_size="xs",
    )
    db_session.add(req)
    await db_session.flush()
    return {"org": org_id, "member": member_id, "request": req}


@pytest.fixture
def delivered(db_session, monkeypatch):
    """Run the notice on the test's session and record every email it hands
    to the transport."""
    from app.core.database import database_manager
    from app.services.email_service import EmailService

    async def _session():
        yield db_session

    monkeypatch.setattr(database_manager, "get_session", _session)
    emails = []

    async def _send_email(self, to_emails, subject, html_body, **kwargs):
        emails.append({"to": list(to_emails), "subject": subject, "html": html_body})
        return len(to_emails), 0

    monkeypatch.setattr(EmailService, "send_email", _send_email)
    return emails


async def _bell_entries(db_session, member_id):
    result = await db_session.execute(
        select(NotificationLog).where(
            NotificationLog.recipient_id == member_id,
            NotificationLog.channel == NotificationChannel.IN_APP,
        )
    )
    return list(result.scalars().all())


@pytest.mark.integration
class TestDelivery:
    async def test_a_decline_reaches_the_bell_and_the_inbox(
        self, db_session, dept, delivered
    ):
        req = dept["request"]
        req.status = "denied"
        req.review_notes = "We don't carry XS."
        await db_session.flush()

        await send_equipment_request_notice(dept["org"], req.id, "denied")

        [entry] = await _bell_entries(db_session, dept["member"])
        assert entry.category == "inventory"
        assert entry.action_url == "/inventory/my-equipment"
        assert entry.subject == "Your equipment request was declined: Short Sleeve"
        assert "We don't carry XS." in entry.message

        [email] = delivered
        assert email["to"] == [f"sam{dept['member'][:6]}@test.com"]
        assert email["subject"] == "Your equipment request was declined: Short Sleeve"
        assert "Hello Sam Reyes" in email["html"]
        assert "XS" in email["html"]
        assert "{{" not in email["html"]

    async def test_a_department_can_switch_it_off(self, db_session, dept, delivered):
        db_session.add(
            NotificationRule(
                id=_uid(),
                organization_id=dept["org"],
                name="Equipment request updates",
                trigger=NotificationTrigger.EQUIPMENT_REQUEST_UPDATE,
                category="general",
                enabled=False,
            )
        )
        await db_session.flush()

        await send_equipment_request_notice(dept["org"], dept["request"].id, "approved")

        assert await _bell_entries(db_session, dept["member"]) == []
        assert delivered == []

    async def test_a_member_who_turned_the_email_off_still_gets_the_bell(
        self, db_session, dept, delivered
    ):
        request_id = dept["request"].id
        await db_session.execute(
            text("UPDATE users SET notification_preferences = :p WHERE id = :id"),
            {
                "p": '{"email_kinds": {"equipment_request_update": false}}',
                "id": dept["member"],
            },
        )
        await db_session.flush()
        # The sender must read the stored preference, not a cached row.
        db_session.expire_all()

        await send_equipment_request_notice(dept["org"], request_id, "approved")

        assert len(await _bell_entries(db_session, dept["member"])) == 1
        assert delivered == []

    async def test_another_departments_request_is_not_delivered(
        self, db_session, dept, delivered
    ):
        await send_equipment_request_notice(_uid(), dept["request"].id, "approved")

        assert await _bell_entries(db_session, dept["member"]) == []
        assert delivered == []

    async def test_a_failing_mail_server_does_not_raise(
        self, db_session, dept, delivered, monkeypatch
    ):
        from app.services.email_service import EmailService

        async def _broken(self, *args, **kwargs):
            raise RuntimeError("SMTP down")

        monkeypatch.setattr(EmailService, "send_email", _broken)

        await send_equipment_request_notice(dept["org"], dept["request"].id, "approved")

        assert len(await _bell_entries(db_session, dept["member"])) == 1


@pytest.mark.integration
class TestReviewEndpoint:
    async def _review(self, db_session, dept, **body):
        tasks = BackgroundTasks()
        reviewer = SimpleNamespace(
            id=dept["member"], organization_id=dept["org"], username="qm"
        )
        await inventory_endpoints.review_equipment_request(
            request_id=uuid.UUID(dept["request"].id),
            review_data=EquipmentRequestReview(**body),
            background_tasks=tasks,
            db=db_session,
            current_user=reviewer,
        )
        return tasks.tasks

    async def test_a_decision_queues_the_notice(self, db_session, dept):
        [task] = await self._review(db_session, dept, status="denied")
        assert task.func is send_equipment_request_notice
        assert task.args == (dept["org"], dept["request"].id, "denied")

    async def test_approve_and_fulfil_queues_nothing_at_approval(
        self, db_session, dept
    ):
        # The issued notice follows seconds later; the member hears once.
        tasks = await self._review(
            db_session, dept, status="approved", notify_member=False
        )
        assert tasks == []
