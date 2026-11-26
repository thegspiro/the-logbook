"""Feedback from the public on a completed outreach request.

A department chooses one of its own forms from Forms as the feedback form, so
it writes its own questions and branches between them; the requester answers
once, through their status link, after the request is Completed. These tests
pin who can answer and when, that the Forms module's branching is enforced on
the server, that a response is final, and where the rating goes, against real
rows.
"""

import copy
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.api.v1.endpoints.events import update_event_settings
from app.models.event_request import (
    EventRequest,
    EventRequestActivity,
    EventRequestFeedback,
    EventRequestStatus,
    generate_status_token,
)
from app.models.forms import (
    FieldType,
    Form,
    FormCategory,
    FormField,
    FormStatus,
    FormSubmission,
)
from app.models.user import Organization, User, UserStatus
from app.schemas.event import EventSettingsUpdate
from app.services import outreach_feedback_service
from app.services.community_engagement_service import CommunityEngagementService
from app.services.email_service import EmailService
from app.services.event_request_service import (
    feedback_link,
    send_request_notification,
)
from app.services.outreach_feedback_service import (
    STARTER_FORM_NAME,
    FeedbackAlreadySent,
    FeedbackError,
    OutreachFeedbackService,
)

pytestmark = pytest.mark.integration

TZ = "America/New_York"


async def _org(db_session, label="Reach"):
    org = Organization(
        name=f"{label} FD", slug=f"{label.lower()}-{uuid.uuid4().hex[:10]}", timezone=TZ
    )
    db_session.add(org)
    await db_session.flush()
    officer = User(
        organization_id=org.id,
        username=f"{label.lower()}-{org.id[:8]}",
        email=f"{label.lower()}-{org.id[:8]}@example.test",
        first_name="Pat",
        last_name="Officer",
        status=UserStatus.ACTIVE,
    )
    db_session.add(officer)
    await db_session.flush()
    return org, officer


@pytest.fixture
async def dept(db_session):
    return await _org(db_session)


async def _request(db_session, org, status=EventRequestStatus.COMPLETED):
    token = generate_status_token()
    req = EventRequest(
        organization_id=org.id,
        contact_name="Pat Requester",
        contact_email="pat@example.test",
        description="A station tour for a scout troop",
        status=status,
        status_token=token,
    )
    db_session.add(req)
    await db_session.flush()
    return req, token


async def _starter(db_session, org, officer):
    return await OutreachFeedbackService(db_session).create_starter_form(
        org, str(officer.id)
    )


def _fields(form):
    by_label = {f.label: f for f in form.fields}
    return (
        by_label["How did the visit go?"],
        by_label["What went well?"],
        by_label["What could we do better?"],
    )


async def _own_form(
    db_session, org, *, status=FormStatus.PUBLISHED, required_branch=True
):
    """A department's own form: a 1-5 radio rating, and a question required
    only when the rating is 2."""
    form = Form(
        organization_id=org.id,
        name="Our questions",
        category=FormCategory.OTHER,
        status=status,
    )
    db_session.add(form)
    await db_session.flush()
    rating = FormField(
        form_id=form.id,
        label="Score",
        field_type=FieldType.RADIO,
        required=True,
        options=[{"value": str(n), "label": str(n)} for n in range(1, 6)],
        sort_order=0,
    )
    db_session.add(rating)
    await db_session.flush()
    why = FormField(
        form_id=form.id,
        label="What went wrong?",
        field_type=FieldType.TEXTAREA,
        required=required_branch,
        sort_order=1,
        condition_field_id=str(rating.id),
        condition_operator="equals",
        condition_value="2",
    )
    note = FormField(
        form_id=form.id, label="Anything else?", field_type=FieldType.TEXT, sort_order=2
    )
    db_session.add_all([why, note])
    await db_session.flush()
    return form, rating, why, note


async def _use(db_session, org, form, rating):
    current = dict(org.settings or {})
    events = dict(current.get("events") or {})
    pipeline = dict(events.get("request_pipeline") or {})
    pipeline["feedback_form_id"] = str(form.id)
    pipeline["feedback_rating_field_id"] = str(rating.id) if rating else None
    events["request_pipeline"] = pipeline
    current["events"] = events
    org.settings = current
    await db_session.flush()


class TestTheStarterForm:
    async def test_it_branches_on_the_rating_and_becomes_the_departments(
        self, db_session, dept
    ):
        org, officer = dept

        form = await _starter(db_session, org, officer)

        assert form.name == STARTER_FORM_NAME
        assert form.status == FormStatus.PUBLISHED
        assert form.is_public is False
        rating, well, better = _fields(form)
        assert (rating.field_type, rating.min_value, rating.max_value) == (
            FieldType.NUMBER,
            1,
            5,
        )
        assert well.condition_field_id is None
        assert (better.condition_field_id, better.condition_operator) == (
            str(rating.id),
            "at_most",
        )
        assert better.condition_value == "3"
        pipeline = org.settings["events"]["request_pipeline"]
        assert pipeline["feedback_form_id"] == str(form.id)
        assert pipeline["feedback_rating_field_id"] == str(rating.id)

    async def test_asking_twice_makes_one_form(self, db_session, dept):
        org, officer = dept

        first = await _starter(db_session, org, officer)
        second = await _starter(db_session, org, officer)

        assert second.id == first.id
        count = await db_session.scalar(
            select(func.count(Form.id)).where(
                Form.organization_id == org.id, Form.name == STARTER_FORM_NAME
            )
        )
        assert count == 1


class TestWhenFeedbackIsOffered:
    async def test_only_once_the_request_is_completed_and_a_form_is_set(
        self, db_session, dept
    ):
        org, officer = dept
        service = OutreachFeedbackService(db_session)
        open_req, open_token = await _request(
            db_session, org, EventRequestStatus.SCHEDULED
        )
        done, done_token = await _request(db_session, org)

        assert await service.status_flags(done, org) == (False, False)
        assert await service.public_view(done_token) is None

        await _starter(db_session, org, officer)

        assert await service.status_flags(open_req, org) == (False, False)
        assert await service.public_view(open_token) is None
        assert await service.status_flags(done, org) == (True, False)
        view = await service.public_view(done_token)
        assert view["form_name"] == STARTER_FORM_NAME
        assert [f.label for f in view["fields"]] == [
            "How did the visit go?",
            "What went well?",
            "What could we do better?",
        ]

    async def test_an_unknown_token_finds_nothing(self, db_session, dept):
        org, officer = dept
        await _starter(db_session, org, officer)

        assert await OutreachFeedbackService(db_session).public_view("nope") is None

    async def test_an_unpublished_form_is_not_offered(self, db_session, dept):
        org, _officer = dept
        form, rating, _why, _note = await _own_form(
            db_session, org, status=FormStatus.DRAFT
        )
        await _use(db_session, org, form, rating)
        _req, token = await _request(db_session, org)

        assert await OutreachFeedbackService(db_session).public_view(token) is None


class TestSending:
    async def test_the_response_is_stored_with_its_rating(self, db_session, dept):
        org, officer = dept
        form = await _starter(db_session, org, officer)
        rating, well, better = _fields(form)
        req, token = await _request(db_session, org)

        stamp = await OutreachFeedbackService(db_session).submit(
            token, {str(rating.id): "2", str(better.id): "Arrive earlier"}
        )

        assert stamp is not None
        response = (
            await db_session.execute(
                select(EventRequestFeedback).where(
                    EventRequestFeedback.request_id == req.id
                )
            )
        ).scalar_one()
        assert response.rating == 2
        assert response.form_id == form.id
        submission = await db_session.get(FormSubmission, response.form_submission_id)
        assert submission.form_id == form.id
        assert submission.data[str(better.id)] == "Arrive earlier"
        assert submission.submitter_name == "Pat Requester"
        logged = await db_session.scalar(
            select(func.count(EventRequestActivity.id)).where(
                EventRequestActivity.request_id == req.id,
                EventRequestActivity.action == "feedback_received",
            )
        )
        assert logged == 1

    async def test_a_required_rating_must_be_answered(self, db_session, dept):
        org, officer = dept
        form = await _starter(db_session, org, officer)
        _rating, well, _better = _fields(form)
        _req, token = await _request(db_session, org)

        with pytest.raises(FeedbackError, match="How did the visit go"):
            await OutreachFeedbackService(db_session).submit(
                token, {str(well.id): "Great"}
            )

    async def test_a_branch_is_required_only_while_it_is_showing(
        self, db_session, dept
    ):
        org, _officer = dept
        form, rating, why, _note = await _own_form(db_session, org)
        await _use(db_session, org, form, rating)
        _low, low_token = await _request(db_session, org)
        _high, high_token = await _request(db_session, org)
        service = OutreachFeedbackService(db_session)

        with pytest.raises(FeedbackError, match="What went wrong"):
            await service.submit(low_token, {str(rating.id): "2"})
        assert await service.submit(high_token, {str(rating.id): "5"}) is not None

    async def test_a_second_send_is_refused_and_leaves_one_response(
        self, db_session, dept
    ):
        org, officer = dept
        form = await _starter(db_session, org, officer)
        rating, _well, _better = _fields(form)
        req, token = await _request(db_session, org)
        service = OutreachFeedbackService(db_session)

        await service.submit(token, {str(rating.id): "5"})
        with pytest.raises(FeedbackAlreadySent):
            await service.submit(token, {str(rating.id): "1"})
        with pytest.raises(FeedbackAlreadySent):
            await service.public_view(token)

        rows = (
            (
                await db_session.execute(
                    select(EventRequestFeedback).where(
                        EventRequestFeedback.request_id == req.id
                    )
                )
            )
            .scalars()
            .all()
        )
        assert [r.rating for r in rows] == [5]
        assert await service.status_flags(req, org) == (False, True)

    async def test_without_a_rating_question_the_survey_still_runs(
        self, db_session, dept
    ):
        org, _officer = dept
        form, rating, _why, note = await _own_form(db_session, org)
        await _use(db_session, org, form, None)
        req, token = await _request(db_session, org)

        await OutreachFeedbackService(db_session).submit(
            token, {str(rating.id): "4", str(note.id): "Thanks"}
        )

        response = (
            await db_session.execute(
                select(EventRequestFeedback).where(
                    EventRequestFeedback.request_id == req.id
                )
            )
        ).scalar_one()
        assert response.rating is None


class TestTheOfficersRead:
    async def test_answers_read_question_by_question_in_their_department(
        self, db_session, dept
    ):
        org, officer = dept
        other, _ = await _org(db_session, "Other")
        form = await _starter(db_session, org, officer)
        rating, well, _better = _fields(form)
        req, token = await _request(db_session, org)
        service = OutreachFeedbackService(db_session)
        await service.submit(token, {str(rating.id): "5", str(well.id): "The truck"})

        read = await service.for_request(str(org.id), str(req.id))

        assert read["rating"] == 5
        assert read["answers"] == [
            {"question": "How did the visit go?", "answer": "5"},
            {"question": "What went well?", "answer": "The truck"},
        ]
        assert await service.for_request(str(other.id), str(req.id)) is None


class TestTheSetting:
    async def test_another_departments_form_is_refused(self, db_session, dept):
        org, officer = dept
        other, _ = await _org(db_session, "Other")
        foreign, rating, _why, _note = await _own_form(db_session, other)

        with pytest.raises(HTTPException) as refused:
            await update_event_settings(
                EventSettingsUpdate(
                    request_pipeline={"feedback_form_id": str(foreign.id)}
                ),
                db=db_session,
                current_user=officer,
            )
        assert refused.value.status_code == 400

    async def test_a_question_that_cannot_be_averaged_is_refused_as_the_rating(
        self, db_session, dept
    ):
        org, _officer = dept
        form, _rating, _why, note = await _own_form(db_session, org)

        with pytest.raises(ValueError, match="whole numbers"):
            await OutreachFeedbackService(db_session).validate_settings(
                str(org.id), str(form.id), str(note.id)
            )

    async def test_choosing_another_form_drops_the_old_rating_question(
        self, db_session, dept
    ):
        org, officer = dept
        await _starter(db_session, org, officer)
        mine, _rating, _why, _note = await _own_form(db_session, org)

        merged = await update_event_settings(
            EventSettingsUpdate(request_pipeline={"feedback_form_id": str(mine.id)}),
            db=db_session,
            current_user=officer,
        )

        pipeline = merged["request_pipeline"]
        assert pipeline["feedback_form_id"] == str(mine.id)
        assert pipeline["feedback_rating_field_id"] is None

    async def test_an_unrelated_save_does_not_fail_on_a_form_unpublished_since(
        self, db_session, dept
    ):
        org, officer = dept
        form = await _starter(db_session, org, officer)
        form.status = FormStatus.ARCHIVED
        await db_session.flush()
        pipeline = dict(org.settings["events"]["request_pipeline"])

        merged = await update_event_settings(
            EventSettingsUpdate(
                request_pipeline={**pipeline, "public_progress_visible": True}
            ),
            db=db_session,
            current_user=officer,
        )

        assert merged["request_pipeline"]["public_progress_visible"] is True


class TestTheReport:
    async def test_responses_and_their_average_count_in_their_period(
        self, db_session, dept
    ):
        org, officer = dept
        form = await _starter(db_session, org, officer)
        rating, _well, _better = _fields(form)
        service = OutreachFeedbackService(db_session)
        for score in ("5", "4"):
            _req, token = await _request(db_session, org)
            await service.submit(token, {str(rating.id): score})
        old, old_token = await _request(db_session, org)
        await service.submit(old_token, {str(rating.id): "1"})
        # Received two years ago: outside this year and the previous one.
        stale = (
            await db_session.execute(
                select(EventRequestFeedback).where(
                    EventRequestFeedback.request_id == old.id
                )
            )
        ).scalar_one()
        stale.submitted_at = datetime.now(timezone.utc) - timedelta(days=800)
        await db_session.flush()

        data = await CommunityEngagementService(db_session).report(
            str(org.id), "rolling_12"
        )

        assert data["current"]["feedback_responses"] == 2
        assert data["current"]["average_rating"] == 4.5
        assert data["previous"]["feedback_responses"] == 0
        assert data["previous"]["average_rating"] is None
        assert data["rating_scale_max"] == 5

    def test_a_response_is_stamped_in_whole_seconds(self, monkeypatch):
        # MySQL 8 rounds a fraction on a DATETIME(0) column, so a stamp of
        # :52.7 is stored as :53 and lands after the report's "now" — the
        # period then misses a response received a moment earlier. MariaDB
        # truncates instead, which is why the report test above failed only
        # on MySQL, and why this checks the stamp the service writes rather
        # than the one a MariaDB reads back.
        moment = datetime(2026, 11, 23, 12, 0, 0, 700000, tzinfo=timezone.utc)

        class _Clock(datetime):
            @classmethod
            def now(cls, tz=None):
                return moment

        monkeypatch.setattr(outreach_feedback_service, "datetime", _Clock)

        assert outreach_feedback_service._now() == moment.replace(microsecond=0)


class TestTheCompletedEmail:
    async def test_it_links_to_feedback_until_feedback_arrives(self, db_session, dept):
        org, officer = dept
        form = await _starter(db_session, org, officer)
        rating, _well, _better = _fields(form)
        req, token = await _request(db_session, org)

        link = await feedback_link(db_session, req, org)
        assert link is not None
        assert link.endswith(f"/event-request/status/{token}")

        await OutreachFeedbackService(db_session).submit(token, {str(rating.id): "5"})
        assert await feedback_link(db_session, req, org) is None

    async def test_no_link_before_completion_or_without_a_form(self, db_session, dept):
        org, officer = dept
        done, _ = await _request(db_session, org)
        assert await feedback_link(db_session, done, org) is None

        await _starter(db_session, org, officer)
        scheduled, _ = await _request(db_session, org, EventRequestStatus.SCHEDULED)
        assert await feedback_link(db_session, scheduled, org) is None

    async def test_a_departments_own_completed_template_can_carry_the_link(
        self, db_session, dept
    ):
        org, officer = dept
        await _starter(db_session, org, officer)
        settings = copy.deepcopy(org.settings)
        settings["events"]["request_pipeline"]["email_triggers"] = {
            "on_completed": {"enabled": True, "notify_requester": True}
        }
        org.settings = settings
        await db_session.flush()
        req, token = await _request(db_session, org)
        template = SimpleNamespace(
            subject="Thank you",
            body_html="<p>Thanks for having us.</p>{{feedback_link}}",
            body_text="Thanks.\n{{feedback_url}}",
        )
        send = AsyncMock(return_value=(1, 0))

        with patch.object(EmailService, "send_email", send):
            await send_request_notification(
                db_session, req, "on_completed", org, template=template
            )

        sent = send.await_args.kwargs
        assert "share your feedback</a>" in sent["html_body"]
        assert f"/event-request/status/{token}" in sent["html_body"]
        assert sent["text_body"].endswith(f"/event-request/status/{token}")
