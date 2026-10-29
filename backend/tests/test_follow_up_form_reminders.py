"""Follow-up forms after the link goes out: reminders, the coordinators'
notice, the answers on the Interview page, the election package and the
status-page card.

Against the real schema, like ``test_follow_up_forms.py`` whose seed this
reuses: the reminder query, the row lock and the unencrypted package snapshot
are what these check, and a mocked session evaluates none of them.

Email is patched at the EmailService senders, outside any concurrent code
(CLAUDE.md pitfall #22).
"""

import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api.v1.endpoints import membership_pipeline as endpoints
from app.models.forms import FieldType, FormField
from app.models.membership_pipeline import (
    MembershipPipeline,
    MembershipPipelineStep,
    ProspectActivityLog,
    ProspectElectionPackage,
    ProspectStatus,
)
from app.models.user import Organization
from app.services.email_service import EmailService
from app.services.follow_up_form_service import (
    MAX_REMINDERS,
    FollowUpFormService,
    display_answer,
)
from app.services.membership_pipeline_service import MembershipPipelineService
from tests.test_follow_up_forms import (
    SECRET,
    _answers,
    _arrive,
    _prospect,
    _request,
    _seed,
    _token_from,
)

pytestmark = [pytest.mark.integration]

# The link email's send time in every reminder test, at 08:00 UTC on a
# Thursday; the seeded department keeps UTC, so local and stored times agree.
SENT = datetime(2026, 10, 1, 8, 0, tzinfo=timezone.utc)


def _at(days: int, hour: int = 10) -> datetime:
    return (SENT + timedelta(days=days)).replace(hour=hour, minute=5)


@pytest.fixture
def mail():
    """Every follow-up sender, recorded; every send succeeds."""
    senders = {
        name: AsyncMock(return_value=True)
        for name in (
            "send_follow_up_form_email",
            "send_contact_changed_email",
            "send_follow_up_reminder_email",
            "send_follow_up_submitted_email",
        )
    }
    with (
        patch.object(
            EmailService,
            "send_follow_up_form_email",
            senders["send_follow_up_form_email"],
        ),
        patch.object(
            EmailService,
            "send_contact_changed_email",
            senders["send_contact_changed_email"],
        ),
        patch.object(
            EmailService,
            "send_follow_up_reminder_email",
            senders["send_follow_up_reminder_email"],
        ),
        patch.object(
            EmailService,
            "send_follow_up_submitted_email",
            senders["send_follow_up_submitted_email"],
        ),
    ):
        yield SimpleNamespace(
            link=senders["send_follow_up_form_email"],
            reminder=senders["send_follow_up_reminder_email"],
            submitted=senders["send_follow_up_submitted_email"],
        )


async def _sent_at(db, seed, stamp: datetime = SENT):
    """Arrive on the stage, then back-date the link email to ``stamp``."""
    org = await db.get(Organization, seed.org_id)
    org.timezone = "UTC"
    await db.commit()
    await _arrive(db, seed)
    request = await _request(db, seed)
    request.first_sent_at = stamp
    request.last_sent_at = stamp
    await db.commit()


async def _remind(db, now: datetime) -> dict:
    db.expire_all()
    return await FollowUpFormService(db).send_due_reminders(now=now)


class TestReminders:
    async def test_nothing_is_sent_before_seven_days(self, db_session, mail):
        seed = await _seed(db_session)
        await _sent_at(db_session, seed)

        counts = await _remind(db_session, _at(6))

        assert counts["sent"] == 0
        mail.reminder.assert_not_awaited()

    async def test_the_seventh_day_sends_the_same_link(self, db_session, mail):
        seed = await _seed(db_session)
        await _sent_at(db_session, seed)

        counts = await _remind(db_session, _at(7))

        assert counts["sent"] == 1
        kwargs = mail.reminder.await_args.kwargs
        assert kwargs["form_url"] == mail.link.await_args.kwargs["form_url"]
        assert kwargs["reminder_number"] == 1
        assert kwargs["has_draft"] is False
        request = await _request(db_session, seed)
        assert request.reminder_count == 1
        assert request.last_reminder_at is not None
        logged = (
            await db_session.execute(
                select(ProspectActivityLog).where(
                    ProspectActivityLog.prospect_id == seed.prospect_id,
                    ProspectActivityLog.action == "follow_up_form_reminder_sent",
                )
            )
        ).scalar_one()
        assert logged.details["reminder_number"] == 1

    async def test_it_waits_for_the_departments_working_day(self, db_session, mail):
        seed = await _seed(db_session)
        await _sent_at(db_session, seed)

        early = await _remind(db_session, _at(7, hour=7))
        late = await _remind(db_session, _at(7, hour=21))
        morning = await _remind(db_session, _at(7, hour=9))

        assert (early["sent"], late["sent"], morning["sent"]) == (0, 0, 1)

    async def test_the_window_is_the_departments_timezone(self, db_session, mail):
        seed = await _seed(db_session)
        await _sent_at(db_session, seed)
        org = await db_session.get(Organization, seed.org_id)
        # 13:05 UTC is 09:05 in New York (EDT) in October.
        org.timezone = "America/New_York"
        await db_session.commit()

        at_utc_ten = await _remind(db_session, _at(7, hour=10))
        at_local_nine = await _remind(db_session, _at(7, hour=13))

        assert (at_utc_ten["sent"], at_local_nine["sent"]) == (0, 1)

    async def test_running_twice_reminds_once(self, db_session, mail):
        seed = await _seed(db_session)
        await _sent_at(db_session, seed)

        await _remind(db_session, _at(7))
        await _remind(db_session, _at(7) + timedelta(minutes=30))

        assert mail.reminder.await_count == 1
        assert (await _request(db_session, seed)).reminder_count == 1

    async def test_reminders_stop_after_three(self, db_session, mail):
        seed = await _seed(db_session)
        await _sent_at(db_session, seed)

        for week in (1, 2, 3, 4, 5):
            await _remind(db_session, _at(7 * week))

        assert mail.reminder.await_count == MAX_REMINDERS
        numbers = [c.kwargs["reminder_number"] for c in mail.reminder.await_args_list]
        assert numbers == [1, 2, 3]

    async def test_a_resend_does_not_restart_the_count(self, db_session, mail):
        seed = await _seed(db_session)
        await _sent_at(db_session, seed)
        for week in (1, 2, 3):
            await _remind(db_session, _at(7 * week))

        await FollowUpFormService(db_session).send_now(
            seed.prospect_id, seed.step_ids[1], seed.org_id
        )
        request = await _request(db_session, seed)
        request.last_sent_at = _at(21)
        await db_session.commit()
        await _remind(db_session, _at(28))

        assert mail.reminder.await_count == 3

    async def test_a_resend_moves_the_next_reminder(self, db_session, mail):
        seed = await _seed(db_session)
        await _sent_at(db_session, seed)
        request = await _request(db_session, seed)
        request.last_sent_at = _at(4)
        await db_session.commit()

        at_seven = await _remind(db_session, _at(7))
        at_eleven = await _remind(db_session, _at(11))

        assert (at_seven["sent"], at_eleven["sent"]) == (0, 1)

    async def test_a_recent_draft_holds_the_reminder(self, db_session, mail):
        seed = await _seed(db_session)
        await _sent_at(db_session, seed)
        request = await _request(db_session, seed)
        request.draft_data = {seed.fields["Phone"]: "555-0199"}
        request.draft_saved_at = _at(3)
        await db_session.commit()

        at_seven = await _remind(db_session, _at(7))
        at_ten = await _remind(db_session, _at(10))

        assert (at_seven["sent"], at_ten["sent"]) == (0, 1)
        assert mail.reminder.await_args.kwargs["has_draft"] is True

    async def test_no_reminder_once_the_applicant_has_moved_on(self, db_session, mail):
        seed = await _seed(db_session)
        await _sent_at(db_session, seed)
        prospect = await _prospect(db_session, seed)
        prospect.current_step_id = seed.step_ids[2]
        await db_session.commit()

        counts = await _remind(db_session, _at(7))

        assert counts["sent"] == 0
        mail.reminder.assert_not_awaited()

    @pytest.mark.parametrize(
        ("status", "expected"),
        [
            (ProspectStatus.ON_HOLD, 1),
            (ProspectStatus.WITHDRAWN, 0),
            (ProspectStatus.REJECTED, 0),
            (ProspectStatus.INACTIVE, 0),
        ],
    )
    async def test_only_an_open_application_is_reminded(
        self, db_session, mail, status, expected
    ):
        seed = await _seed(db_session)
        await _sent_at(db_session, seed)
        prospect = await _prospect(db_session, seed)
        prospect.status = status
        await db_session.commit()

        counts = await _remind(db_session, _at(7))

        assert counts["sent"] == expected

    async def test_a_submitted_form_is_not_reminded(self, db_session, mail):
        seed = await _seed(db_session, auto_advance=False)
        await _sent_at(db_session, seed)
        await FollowUpFormService(db_session).submit(
            _token_from(mail.link), _answers(seed)
        )

        counts = await _remind(db_session, _at(7))

        assert counts["sent"] == 0

    async def test_a_failed_send_is_tried_again_next_run(self, db_session, mail):
        seed = await _seed(db_session)
        await _sent_at(db_session, seed)
        mail.reminder.return_value = False

        failed = await _remind(db_session, _at(7))
        count_after_failure = (await _request(db_session, seed)).reminder_count
        mail.reminder.return_value = True
        retried = await _remind(db_session, _at(7, hour=11))

        assert failed["failed"] == 1
        assert count_after_failure == 0
        assert retried["sent"] == 1

    async def test_a_department_switched_off_is_not_reminded(self, db_session, mail):
        seed = await _seed(db_session)
        await _sent_at(db_session, seed)
        org = await db_session.get(Organization, seed.org_id)
        org.active = False
        await db_session.commit()

        counts = await _remind(db_session, _at(7))

        assert counts["considered"] == 0


class TestCoordinatorNotice:
    @pytest.fixture
    def coordinators(self):
        people = [
            SimpleNamespace(
                email="coord@example.org",
                full_name="Maria Lopez",
                notification_preferences=None,
            ),
            SimpleNamespace(
                email="assist@example.org",
                full_name="Sam Reed",
                notification_preferences=None,
            ),
        ]
        with patch.object(
            MembershipPipelineService,
            "_withdrawal_notice_recipients",
            AsyncMock(return_value=people),
        ):
            yield people

    async def test_each_coordinator_gets_a_link_and_no_answers(
        self, db_session, mail, coordinators
    ):
        seed = await _seed(db_session)
        await _arrive(db_session, seed)

        await FollowUpFormService(db_session).submit(
            _token_from(mail.link), _answers(seed, Phone="555-0177")
        )

        sent_to = [c.kwargs["to_email"] for c in mail.submitted.await_args_list]
        assert sent_to == ["coord@example.org", "assist@example.org"]
        kwargs = mail.submitted.await_args.kwargs
        assert kwargs["applicant_url"].endswith(
            f"/prospective-members/{seed.prospect_id}/interview"
        )
        assert kwargs["form_name"] == "Background Questionnaire"
        assert kwargs["contact_changed"] is True
        everything_sent = json.dumps(
            [c.kwargs for c in mail.submitted.await_args_list], default=str
        )
        assert SECRET not in everything_sent
        assert "555-0177" not in everything_sent

    async def test_an_unchanged_contact_is_not_called_out(
        self, db_session, mail, coordinators
    ):
        seed = await _seed(db_session)
        await _arrive(db_session, seed)

        await FollowUpFormService(db_session).submit(
            _token_from(mail.link), _answers(seed)
        )

        assert mail.submitted.await_args.kwargs["contact_changed"] is False

    async def test_a_mail_failure_does_not_undo_the_submission(
        self, db_session, mail, coordinators
    ):
        seed = await _seed(db_session)
        await _arrive(db_session, seed)
        mail.submitted.side_effect = RuntimeError("SMTP down")

        await FollowUpFormService(db_session).submit(
            _token_from(mail.link), _answers(seed)
        )

        submitted_at = (await _request(db_session, seed)).submitted_at
        current_step_id = (await _prospect(db_session, seed)).current_step_id
        assert submitted_at is not None
        assert str(current_step_id) == seed.step_ids[2]


class TestAnswers:
    async def _submitted(self, db, mail):
        seed = await _seed(db)
        await _arrive(db, seed)
        await FollowUpFormService(db).submit(
            _token_from(mail.link), _answers(seed, Last_Name="O'Brien-Hall")
        )
        return seed, await _request(db, seed)

    async def _call(self, db, seed, request_id, *, can_view_sensitive: bool):
        user = SimpleNamespace(
            id="viewer-1", username="viewer", organization_id=seed.org_id
        )
        audit = AsyncMock()
        with (
            patch.object(
                endpoints, "user_has_permission", return_value=can_view_sensitive
            ),
            patch.object(endpoints, "log_audit_event", audit),
        ):
            result = await endpoints.get_follow_up_form_answers(
                prospect_id=seed.prospect_id,
                request_id=request_id,
                db=db,
                current_user=user,
            )
        return result, audit

    async def test_answers_come_back_in_form_order_and_readable(self, db_session, mail):
        seed, request = await self._submitted(db_session, mail)

        result = await FollowUpFormService(db_session).submitted_answers(
            seed.prospect_id, request.id, seed.org_id
        )

        labels = [a["label"] for a in result["answers"]]
        assert labels == [
            "Last Name",
            "Email",
            "Street Address",
            "Phone",
            "Criminal history",
            "Why now?",
        ]
        by_label = {a["label"]: a for a in result["answers"]}
        # Stored escaped; shown as typed.
        assert by_label["Last Name"]["answer"] == "O'Brien-Hall"
        assert by_label["Criminal history"]["is_sensitive"] is True
        assert result["step_name"] == "Stage 2"

    async def test_a_viewer_without_the_permission_sees_it_withheld(
        self, db_session, mail
    ):
        seed, request = await self._submitted(db_session, mail)

        result, audit = await self._call(
            db_session, seed, request.id, can_view_sensitive=False
        )

        secret = next(a for a in result["answers"] if a["label"] == "Criminal history")
        assert secret["answer"] is None
        assert secret["withheld"] is True
        assert SECRET not in json.dumps(result, default=str)
        audit.assert_not_awaited()

    async def test_a_reveal_is_audited(self, db_session, mail):
        seed, request = await self._submitted(db_session, mail)

        result, audit = await self._call(
            db_session, seed, request.id, can_view_sensitive=True
        )

        secret = next(a for a in result["answers"] if a["label"] == "Criminal history")
        assert secret["answer"] == SECRET
        audit.assert_awaited_once()
        assert audit.await_args.kwargs["event_type"] == "form_sensitive_answers_viewed"
        assert audit.await_args.kwargs["event_data"]["follow_up_request_id"] == str(
            request.id
        )

    async def test_an_unsubmitted_form_is_409(self, db_session, mail):
        seed = await _seed(db_session)
        await _arrive(db_session, seed)
        request = await _request(db_session, seed)

        with pytest.raises(HTTPException) as raised:
            await self._call(db_session, seed, request.id, can_view_sensitive=False)

        assert raised.value.status_code == 409

    async def test_another_department_gets_404(self, db_session, mail):
        seed, request = await self._submitted(db_session, mail)
        other = await _seed(db_session)
        outsider = SimpleNamespace(prospect_id=seed.prospect_id, org_id=other.org_id)

        with pytest.raises(HTTPException) as raised:
            await self._call(db_session, outsider, request.id, can_view_sensitive=True)

        assert raised.value.status_code == 404


class TestDisplayAnswer:
    def _field(self, field_type, options=None):
        return FormField(label="Q", field_type=field_type, options=options)

    def test_a_choice_shows_its_label(self):
        field = self._field(
            FieldType.RADIO,
            [{"value": "yes", "label": "Yes, I do"}, {"value": "no", "label": "No"}],
        )

        assert display_answer(field, "yes") == "Yes, I do"

    def test_several_choices_show_their_labels(self):
        field = self._field(
            FieldType.CHECKBOX,
            [{"value": "ems", "label": "EMS"}, {"value": "fire", "label": "Fire"}],
        )

        assert display_answer(field, "ems,fire") == "EMS, Fire"

    def test_a_signature_is_not_shown_as_its_image(self):
        field = self._field(FieldType.SIGNATURE)

        assert display_answer(field, "data:image/png;base64,AAAA") == "Signed"

    def test_text_is_unescaped(self):
        field = self._field(FieldType.TEXT)

        assert display_answer(field, "O&#x27;Brien &amp; Sons") == "O'Brien & Sons"


class TestElectionPackage:
    async def _with_election_stage(self, db, seed, package_fields):
        svc = MembershipPipelineService(db)
        prospect = await _prospect(db, seed)
        step = await svc.add_step(
            str(prospect.pipeline_id),
            seed.org_id,
            {
                "name": "Membership Vote",
                "step_type": "election_vote",
                "required": False,
                "config": (
                    {"package_fields": package_fields}
                    if package_fields is not None
                    else {}
                ),
            },
        )
        await db.commit()
        return str(step.id)

    async def _package(self, db, seed, step_id):
        pkg = await MembershipPipelineService(db).create_election_package(
            seed.prospect_id, seed.org_id, step_id=step_id
        )
        package_id = pkg.id
        await db.commit()
        db.expire_all()
        return await db.get(ProspectElectionPackage, package_id)

    async def _submitted(self, db, mail):
        seed = await _seed(db, auto_advance=False)
        await _arrive(db, seed)
        await FollowUpFormService(db).submit(_token_from(mail.link), _answers(seed))
        return seed

    async def test_answers_are_included_without_the_sensitive_one(
        self, db_session, mail
    ):
        seed = await self._submitted(db_session, mail)
        step_id = await self._with_election_stage(
            db_session, seed, {"include_follow_up_answers": True}
        )

        pkg = await self._package(db_session, seed, step_id)

        forms = pkg.applicant_snapshot["follow_up_forms"]
        assert [f["form_name"] for f in forms] == ["Background Questionnaire"]
        labels = [a["label"] for a in forms[0]["answers"]]
        assert "Why now?" in labels
        assert "Criminal history" not in labels
        assert SECRET not in json.dumps(pkg.applicant_snapshot)

    async def test_off_by_default(self, db_session, mail):
        seed = await self._submitted(db_session, mail)
        step_id = await self._with_election_stage(
            db_session, seed, {"include_email": True}
        )

        pkg = await self._package(db_session, seed, step_id)

        assert "follow_up_forms" not in pkg.applicant_snapshot

    async def test_a_stage_with_no_package_settings_leaves_them_out(
        self, db_session, mail
    ):
        seed = await self._submitted(db_session, mail)
        step_id = await self._with_election_stage(db_session, seed, None)

        pkg = await self._package(db_session, seed, step_id)

        assert "follow_up_forms" not in pkg.applicant_snapshot


class TestStatusPageCard:
    async def _public(self, db, seed):
        prospect = await _prospect(db, seed)
        pipeline = await db.get(MembershipPipeline, prospect.pipeline_id)
        pipeline.public_status_enabled = True
        for step_id in seed.step_ids:
            step = await db.get(MembershipPipelineStep, step_id)
            step.public_visible = True
        prospect.status_token = "status-token-" + seed.prospect_id[:8]
        await db.commit()
        return prospect.status_token

    async def _card(self, db, token):
        db.expire_all()
        page = await MembershipPipelineService(db).get_prospect_by_token(token)
        return page["current_stage_action"]

    async def test_the_card_opens_the_applicants_form(self, db_session, mail):
        seed = await _seed(db_session)
        await _arrive(db_session, seed)
        token = await self._public(db_session, seed)

        card = await self._card(db_session, token)

        assert card["type"] == "follow_up_form"
        assert card["label"] == "Complete your form: Background Questionnaire"
        assert card["url"] == mail.link.await_args.kwargs["form_url"]

    async def test_the_card_mentions_a_saved_draft(self, db_session, mail):
        seed = await _seed(db_session)
        await _arrive(db_session, seed)
        await FollowUpFormService(db_session).save_draft(
            _token_from(mail.link), {seed.fields["Phone"]: "555-0101"}
        )
        token = await self._public(db_session, seed)

        card = await self._card(db_session, token)

        assert "saved" in card["message"]

    async def test_no_card_once_submitted(self, db_session, mail):
        seed = await _seed(db_session, auto_advance=False)
        await _arrive(db_session, seed)
        await FollowUpFormService(db_session).submit(
            _token_from(mail.link), _answers(seed)
        )
        token = await self._public(db_session, seed)

        assert await self._card(db_session, token) is None

    async def test_no_card_when_the_stage_is_hidden(self, db_session, mail):
        seed = await _seed(db_session)
        await _arrive(db_session, seed)
        token = await self._public(db_session, seed)
        step = await db_session.get(MembershipPipelineStep, seed.step_ids[1])
        step.public_visible = False
        await db_session.commit()

        assert await self._card(db_session, token) is None
