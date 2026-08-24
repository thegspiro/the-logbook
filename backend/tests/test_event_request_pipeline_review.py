"""Community outreach request pipeline: stage config, notifications, staffing.

Covers the gaps a 2026-08-24 review of the pipeline found:

* ``min_lead_time_days`` was a stored setting with a slider and no reader, so a
  department's stated minimum notice gated nothing.
* Reassigning a coordinator fired ``on_submitted``, whose default notifies the
  *requester* — so an internal hand-off emailed a member of the public "we have
  received your request" a second time.
* The pipeline's email templates escaped ``organization_logo_img``, rendering
  the department's logo as literal ``<img …>`` text.
* Pipeline task completions accepted any task id, including ones the
  department has never configured.
* Nothing tied a confirmed date to the shift schedule, so there was no way for
  members to sign up to cover an event.
"""

import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.api.v1.endpoints.event_requests import (
    assign_request,
    open_request_staffing,
    send_template_email,
    submit_public_event_request,
    update_task_completion,
)
from app.api.v1.endpoints.events import EVENT_SETTINGS_DEFAULTS
from app.models.event_request import EventRequestStatus
from app.schemas.event_request import (
    EventRequestAssign,
    EventRequestCreate,
    EventRequestSchedule,
    EventRequestStaffingCreate,
    SendTemplateEmail,
    TaskCompletionUpdate,
)
from app.services.event_request_service import (
    build_staffing_positions,
    get_pipeline_settings,
    lead_time_error,
    open_staffing_shift,
    outreach_type_label,
    send_volunteer_call,
)

ORG_ID = "00000000-0000-0000-0000-000000000001"
USER_ID = "00000000-0000-0000-0000-0000000000aa"
REQUEST_ID = "00000000-0000-0000-0000-0000000000bb"


def _org(pipeline_overrides=None, **extra):
    return SimpleNamespace(
        id=ORG_ID,
        name="Oakville Fire Department",
        active=True,
        timezone="America/New_York",
        logo="https://cdn.example.org/logo.png",
        settings={"events": {"request_pipeline": dict(pipeline_overrides or {})}},
        **extra,
    )


def _result(value, *, kind="scalar_one_or_none"):
    """A stand-in for an ``execute`` result exposing one accessor."""
    return SimpleNamespace(**{kind: lambda: value})


def _seq_db(results):
    """A db whose successive ``execute`` calls resolve the given results."""
    db = AsyncMock()
    db.execute.side_effect = list(results)
    db.add = MagicMock()
    return db


def _request_row(**overrides):
    row = {
        "id": REQUEST_ID,
        "organization_id": ORG_ID,
        "contact_name": "Dana Reyes",
        "contact_email": "dana@example.org",
        "organization_name": "Maple Street Elementary",
        "outreach_type": "fire_safety_demo",
        "description": "Fire safety talk for a third grade class.",
        "status": EventRequestStatus.IN_PROGRESS,
        "assigned_to": None,
        "decline_reason": None,
        "event_date": None,
        "event_end_date": None,
        "staffing_shift_id": None,
        "volunteer_call_sent_at": None,
        "venue_address": None,
        "audience_size": None,
        "age_group": None,
        "task_completions": {},
    }
    row.update(overrides)
    return SimpleNamespace(**row)


def _http_request():
    return SimpleNamespace(
        headers={},
        client=SimpleNamespace(host="203.0.113.4"),
        state=SimpleNamespace(),
    )


def _payload(**overrides):
    data = {
        "contact_name": "Dana Reyes",
        "contact_email": "dana@example.org",
        "outreach_type": "fire_safety_demo",
        "description": "Fire safety talk for a third grade class of about 25.",
    }
    data.update(overrides)
    return EventRequestCreate(**data)


# ============================================
# Minimum lead time — the setting that gated nothing
# ============================================


class TestLeadTime:
    def test_a_named_date_inside_the_minimum_is_refused(self):
        error = lead_time_error(
            {"min_lead_time_days": 21},
            "specific_dates",
            datetime.now(timezone.utc) + timedelta(days=3),
        )
        assert error is not None
        assert "21 days" in error

    def test_a_named_date_beyond_the_minimum_passes(self):
        assert (
            lead_time_error(
                {"min_lead_time_days": 21},
                "specific_dates",
                datetime.now(timezone.utc) + timedelta(days=30),
            )
            is None
        )

    def test_a_flexible_requester_has_no_date_to_be_too_soon(self):
        """ "You pick the date" cannot be short notice — there is no date yet."""
        for flexibility in ("flexible", "general_timeframe"):
            assert (
                lead_time_error(
                    {"min_lead_time_days": 21},
                    flexibility,
                    datetime.now(timezone.utc) + timedelta(days=1),
                )
                is None
            )

    def test_zero_days_accepts_anything(self):
        assert (
            lead_time_error(
                {"min_lead_time_days": 0},
                "specific_dates",
                datetime.now(timezone.utc) + timedelta(hours=1),
            )
            is None
        )

    def test_a_non_numeric_setting_does_not_take_the_pipeline_down(self):
        """Free-form settings JSON must degrade, not raise (pitfall #19)."""
        assert (
            lead_time_error(
                {"min_lead_time_days": "three weeks"},
                "specific_dates",
                datetime.now(timezone.utc) + timedelta(hours=1),
            )
            is None
        )

    @pytest.mark.asyncio
    async def test_public_intake_refuses_a_short_notice_request(self):
        org = _org({"accept_public_requests": True, "min_lead_time_days": 21})
        data = _payload(
            date_flexibility="specific_dates",
            preferred_date_start=datetime.now(timezone.utc) + timedelta(days=2),
        )
        with (
            patch(
                "app.api.v1.endpoints.event_requests.check_ip_rate_limit",
                AsyncMock(return_value=(True, 1, 10)),
            ),
            patch(
                "app.api.v1.endpoints.event_requests.daily_cap_exceeded",
                AsyncMock(return_value=False),
            ),
            patch(
                "app.api.v1.endpoints.event_requests._send_request_notification",
                AsyncMock(),
            ),
            pytest.raises(HTTPException) as exc,
        ):
            await submit_public_event_request(
                data=data,
                request=_http_request(),
                organization_id=ORG_ID,
                db=_seq_db([_result(org)]),
            )

        assert exc.value.status_code == 400
        assert "21 days" in exc.value.detail


# ============================================
# Email triggers — which stage sends what, to whom
# ============================================


class TestEmailTriggers:
    def test_assignment_has_its_own_trigger_and_spares_the_requester(self):
        """An internal hand-off is not news for a member of the public."""
        trigger = EVENT_SETTINGS_DEFAULTS["request_pipeline"]["email_triggers"][
            "on_assigned"
        ]
        assert trigger["notify_assignee"] is True
        assert trigger["notify_requester"] is False

    def test_the_pre_event_reminder_actually_names_a_recipient(self):
        """``enabled`` alone sends nothing — the sender needs notify_requester."""
        trigger = EVENT_SETTINGS_DEFAULTS["request_pipeline"]["email_triggers"][
            "days_before_event"
        ]
        assert trigger["enabled"] is True
        assert trigger["notify_requester"] is True
        assert trigger["days"]

    def test_every_trigger_the_code_sends_is_configurable(self):
        """The wired set, asserted (pitfall #19).

        A trigger key sent from code but absent from the defaults reads as
        disabled forever; one in the defaults with no sender is a switch that
        does nothing. Both have shipped here before.
        """
        configured = set(EVENT_SETTINGS_DEFAULTS["request_pipeline"]["email_triggers"])

        backend = Path(__file__).resolve().parents[1] / "app"
        sources = [
            backend / "api" / "v1" / "endpoints" / "event_requests.py",
            backend / "services" / "scheduled_tasks.py",
        ]
        sent = set()
        dynamic_status_send = False
        for source in sources:
            text = source.read_text()
            sent.update(
                re.findall(
                    r'_?send_request_notification\([^)]*?"([a-z_]+)"',
                    text,
                    re.S,
                )
            )
            # The status endpoint sends f"on_{new_status.value}", which covers
            # every member of the status enum in one call site.
            if 'f"on_{new_status.value}"' in text:
                dynamic_status_send = True

        assert sent, "trigger literals should be discoverable in the sources"
        if dynamic_status_send:
            sent.update(f"on_{s.value}" for s in EventRequestStatus)
        assert sent <= configured, (
            "Trigger(s) sent from code but missing from EVENT_SETTINGS_DEFAULTS "
            f"(they can never be enabled): {sorted(sent - configured)}"
        )
        # volunteer_call is gated by send_volunteer_call rather than by
        # _send_request_notification, so it is named explicitly here.
        unread = configured - sent - {"volunteer_call"}
        assert not unread, (
            "Configurable trigger(s) with no sender — a switch wired to "
            f"nothing: {sorted(unread)}"
        )

    def test_status_transitions_all_have_a_trigger(self):
        """Every status a request can reach can be announced."""
        configured = set(EVENT_SETTINGS_DEFAULTS["request_pipeline"]["email_triggers"])
        for status in EventRequestStatus:
            assert f"on_{status.value}" in configured

    @pytest.mark.asyncio
    async def test_reassignment_does_not_re_announce_submission(self):
        org = _org()
        event_request = _request_row()
        assignee = SimpleNamespace(
            id=USER_ID,
            first_name="Sam",
            last_name="Ortiz",
            email="sam@fire.example.org",
        )
        db = _seq_db([_result(event_request), _result(assignee), _result(org)])
        current_user = SimpleNamespace(id=USER_ID, organization_id=ORG_ID)

        with patch(
            "app.api.v1.endpoints.event_requests._send_request_notification",
            AsyncMock(),
        ) as notify:
            await assign_request(
                request_id=REQUEST_ID,
                data=EventRequestAssign(assigned_to=USER_ID),
                db=db,
                current_user=current_user,
            )

        assert notify.await_args.args[2] == "on_assigned"


# ============================================
# Template email rendering
# ============================================


class TestTemplateEmail:
    @pytest.mark.asyncio
    async def test_the_department_logo_is_not_escaped_into_visible_markup(self):
        """``organization_logo_img`` is markup this module built, not text."""
        org = _org()
        event_request = _request_row()
        template = SimpleNamespace(
            id="tpl-1",
            name="Directions to the station",
            subject="Directions for {{contact_name}}",
            body_html="{{organization_logo_img}}<p>Hi {{contact_name}}</p>",
            body_text="Hi",
        )
        db = _seq_db([_result(event_request), _result(template), _result(org)])
        email_service = MagicMock()
        email_service.send_email = AsyncMock()

        with (
            patch(
                "app.services.email_service.EmailService",
                MagicMock(return_value=email_service),
            ),
            patch(
                "app.services.email_service.build_email_logo_img",
                MagicMock(return_value='<img src="https://cdn.example.org/logo.png">'),
            ),
        ):
            await send_template_email(
                request_id=REQUEST_ID,
                data=SendTemplateEmail(template_id="tpl-1"),
                db=db,
                current_user=SimpleNamespace(id=USER_ID, organization_id=ORG_ID),
            )

        body = email_service.send_email.await_args.kwargs["html_body"]
        assert '<img src="https://cdn.example.org/logo.png">' in body
        assert "&lt;img" not in body

    @pytest.mark.asyncio
    async def test_requester_supplied_values_are_still_escaped(self):
        """Only the logo is exempt — public text stays escaped."""
        org = _org()
        event_request = _request_row(contact_name='Dana "<script>" Reyes')
        template = SimpleNamespace(
            id="tpl-1",
            name="Welcome",
            subject="Hello",
            body_html="<p>Hi {{contact_name}}</p>",
            body_text=None,
        )
        db = _seq_db([_result(event_request), _result(template), _result(org)])
        email_service = MagicMock()
        email_service.send_email = AsyncMock()

        with (
            patch(
                "app.services.email_service.EmailService",
                MagicMock(return_value=email_service),
            ),
            patch(
                "app.services.email_service.build_email_logo_img",
                MagicMock(return_value=""),
            ),
        ):
            await send_template_email(
                request_id=REQUEST_ID,
                data=SendTemplateEmail(template_id="tpl-1"),
                db=db,
                current_user=SimpleNamespace(id=USER_ID, organization_id=ORG_ID),
            )

        body = email_service.send_email.await_args.kwargs["html_body"]
        assert "<script>" not in body
        assert "&lt;script&gt;" in body


# ============================================
# Pipeline tasks
# ============================================


class TestPipelineTasks:
    @pytest.mark.asyncio
    async def test_an_unconfigured_task_id_is_refused(self):
        org = _org()
        event_request = _request_row()
        db = _seq_db([_result(event_request), _result(org)])

        with pytest.raises(HTTPException) as exc:
            await update_task_completion(
                request_id=REQUEST_ID,
                update=TaskCompletionUpdate(task_id="not_a_task", completed=True),
                db=db,
                current_user=SimpleNamespace(id=USER_ID, organization_id=ORG_ID),
            )

        assert exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_a_configured_task_completes_and_starts_the_work(self):
        org = _org()
        event_request = _request_row(status=EventRequestStatus.SUBMITTED)
        db = _seq_db([_result(event_request), _result(org)])

        result = await update_task_completion(
            request_id=REQUEST_ID,
            update=TaskCompletionUpdate(task_id="review_request", completed=True),
            db=db,
            current_user=SimpleNamespace(id=USER_ID, organization_id=ORG_ID),
        )

        assert result["task_completions"]["review_request"]["completed"] is True
        assert result["status"] == EventRequestStatus.IN_PROGRESS.value

    @pytest.mark.asyncio
    async def test_clearing_a_stale_task_id_is_still_allowed(self):
        """A task removed from settings must remain removable from a request."""
        org = _org()
        event_request = _request_row(
            task_completions={"retired_task": {"completed": True}}
        )
        db = _seq_db([_result(event_request), _result(org)])

        result = await update_task_completion(
            request_id=REQUEST_ID,
            update=TaskCompletionUpdate(task_id="retired_task", completed=False),
            db=db,
            current_user=SimpleNamespace(id=USER_ID, organization_id=ORG_ID),
        )

        assert "retired_task" not in result["task_completions"]


# ============================================
# Scheduling and volunteer staffing
# ============================================


class TestScheduling:
    def test_an_end_before_the_start_is_rejected(self):
        """A reversed window overlaps nothing, so the room conflict check passes."""
        start = datetime.now(timezone.utc) + timedelta(days=30)
        with pytest.raises(ValidationError):
            EventRequestSchedule(
                event_date=start, event_end_date=start - timedelta(hours=2)
            )

    def test_an_equal_end_is_allowed(self):
        start = datetime.now(timezone.utc) + timedelta(days=30)
        assert EventRequestSchedule(event_date=start, event_end_date=start)


class TestStaffing:
    def test_seats_are_the_canonical_stored_shape(self):
        """One entry per seat, ``{"position", "required"}`` (pitfall #20)."""
        seats = build_staffing_positions(3, include_officer=False)
        assert seats == [{"position": "volunteer", "required": True}] * 3

    def test_the_officer_seat_leads_the_list(self):
        seats = build_staffing_positions(2, include_officer=True)
        assert seats[0] == {"position": "officer", "required": True}
        assert len(seats) == 3

    def test_outreach_labels_come_from_the_department(self):
        org = _org()
        org.settings["events"]["outreach_event_types"] = [
            {"value": "fire_safety_demo", "label": "School Visit"}
        ]
        assert outreach_type_label(org, "fire_safety_demo") == "School Visit"

    def test_an_unknown_outreach_type_is_humanized_not_blank(self):
        assert outreach_type_label(_org(), "smoke_trailer") == "Smoke Trailer"


class TestPipelineSettings:
    def test_stored_settings_layer_over_defaults(self):
        pipeline = get_pipeline_settings(_org({"min_lead_time_days": 7}))
        assert pipeline["min_lead_time_days"] == 7
        # Untouched keys still come from the defaults.
        assert pipeline["tasks"] == EVENT_SETTINGS_DEFAULTS["request_pipeline"]["tasks"]

    def test_a_department_with_no_settings_reads_the_defaults(self):
        assert (
            get_pipeline_settings(None) == EVENT_SETTINGS_DEFAULTS["request_pipeline"]
        )


# ============================================
# The tie-in: signups on the shift schedule, and the call for help
# ============================================


def _scalars_result(rows):
    """An ``execute`` result exposing ``.scalars().all()``."""
    return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: list(rows)))


def _member(first, email, *, prefs=None, membership_type="active"):
    return SimpleNamespace(
        id=f"user-{first.lower()}",
        first_name=first,
        last_name="Ortiz",
        email=email,
        membership_type=membership_type,
        notification_preferences=prefs,
    )


class TestStaffingEndpoint:
    @pytest.mark.asyncio
    async def test_signups_cannot_open_before_a_date_is_agreed(self):
        """The whole point is a confirmed date to sign up for."""
        db = _seq_db([_result(_request_row(status=EventRequestStatus.IN_PROGRESS))])

        with pytest.raises(HTTPException) as exc:
            await open_request_staffing(
                request_id=REQUEST_ID,
                data=EventRequestStaffingCreate(volunteer_slots=2),
                db=db,
                current_user=SimpleNamespace(id=USER_ID, organization_id=ORG_ID),
            )

        assert exc.value.status_code == 400

    @pytest.mark.asyncio
    async def test_a_second_signup_sheet_is_refused(self):
        """Two sheets split the crew across two shifts nobody reconciles."""
        db = _seq_db(
            [
                _result(
                    _request_row(
                        status=EventRequestStatus.SCHEDULED,
                        event_date=datetime.now(timezone.utc) + timedelta(days=30),
                        staffing_shift_id="shift-1",
                    )
                )
            ]
        )

        with pytest.raises(HTTPException) as exc:
            await open_request_staffing(
                request_id=REQUEST_ID,
                data=EventRequestStaffingCreate(volunteer_slots=2),
                db=db,
                current_user=SimpleNamespace(id=USER_ID, organization_id=ORG_ID),
            )

        assert exc.value.status_code == 409

    @pytest.mark.asyncio
    async def test_opening_signups_creates_the_shift_and_reports_the_seats(self):
        event_request = _request_row(
            status=EventRequestStatus.SCHEDULED,
            event_date=datetime.now(timezone.utc) + timedelta(days=30),
        )
        db = _seq_db([_result(event_request), _result(_org())])
        db.refresh = AsyncMock()

        with (
            patch(
                "app.api.v1.endpoints.event_requests.open_staffing_shift",
                AsyncMock(return_value=(SimpleNamespace(id="shift-9"), None)),
            ) as opener,
            patch(
                "app.api.v1.endpoints.event_requests.get_staffing_state",
                AsyncMock(
                    return_value={
                        "shift_id": "shift-9",
                        "shift_date": None,
                        "slots_total": 3,
                        "slots_filled": 0,
                        "volunteers": [],
                        "volunteer_call_sent_at": None,
                    }
                ),
            ),
        ):
            response = await open_request_staffing(
                request_id=REQUEST_ID,
                data=EventRequestStaffingCreate(
                    volunteer_slots=3, include_officer_slot=False
                ),
                db=db,
                current_user=SimpleNamespace(id=USER_ID, organization_id=ORG_ID),
            )

        assert response.shift_id == "shift-9"
        assert response.slots_total == 3
        assert opener.await_args.kwargs["volunteer_slots"] == 3


class TestVolunteerCall:
    @pytest.mark.asyncio
    async def test_members_who_muted_email_are_skipped_and_counted(self):
        org = _org()
        event_request = _request_row(
            status=EventRequestStatus.SCHEDULED,
            event_date=datetime.now(timezone.utc) + timedelta(days=14),
            staffing_shift_id="shift-9",
        )
        members = [
            _member("Sam", "sam@fire.example.org"),
            _member(
                "Kit", "kit@fire.example.org", prefs={"email_notifications": False}
            ),
            _member("Lee", "lee@fire.example.org", prefs={"email_notifications": True}),
        ]
        db = _seq_db([_scalars_result(members)])
        email_service = MagicMock()
        email_service.send_email = AsyncMock()

        with patch(
            "app.services.email_service.EmailService",
            MagicMock(return_value=email_service),
        ):
            result = await send_volunteer_call(
                db,
                event_request,
                org,
                actor=SimpleNamespace(id=USER_ID),
                message="Bring the smoke trailer.",
            )

        assert result["recipients"] == 2
        assert result["skipped_opted_out"] == 1
        recipients = email_service.send_email.await_args.kwargs["to_emails"]
        assert "kit@fire.example.org" not in recipients
        assert event_request.volunteer_call_sent_at is not None

    @pytest.mark.asyncio
    async def test_the_call_carries_the_details_and_the_signup_link(self):
        org = _org()
        event_request = _request_row(
            status=EventRequestStatus.SCHEDULED,
            event_date=datetime.now(timezone.utc) + timedelta(days=14),
            staffing_shift_id="shift-9",
            venue_address="12 Maple Street",
            audience_size=60,
            age_group="Grades 2-3",
        )
        db = _seq_db([_scalars_result([_member("Sam", "sam@fire.example.org")])])
        email_service = MagicMock()
        email_service.send_email = AsyncMock()

        with patch(
            "app.services.email_service.EmailService",
            MagicMock(return_value=email_service),
        ):
            await send_volunteer_call(
                db, event_request, org, actor=SimpleNamespace(id=USER_ID)
            )

        body = email_service.send_email.await_args.kwargs["html_body"]
        assert "12 Maple Street" in body
        assert "60" in body
        assert "tab=open-shifts" in body

    @pytest.mark.asyncio
    async def test_without_a_signup_sheet_the_email_says_what_to_do_instead(self):
        """Pointing at an Open Shifts tab with nothing on it helps nobody."""
        org = _org()
        event_request = _request_row(
            status=EventRequestStatus.SCHEDULED,
            event_date=datetime.now(timezone.utc) + timedelta(days=14),
        )
        db = _seq_db([_scalars_result([_member("Sam", "sam@fire.example.org")])])
        email_service = MagicMock()
        email_service.send_email = AsyncMock()

        with patch(
            "app.services.email_service.EmailService",
            MagicMock(return_value=email_service),
        ):
            await send_volunteer_call(
                db, event_request, org, actor=SimpleNamespace(id=USER_ID)
            )

        body = email_service.send_email.await_args.kwargs["html_body"]
        assert "tab=open-shifts" not in body
        assert "coordinator" in body

    @pytest.mark.asyncio
    async def test_a_request_with_no_date_has_nothing_to_ask_for(self):
        with pytest.raises(ValueError, match="Confirm a date"):
            await send_volunteer_call(
                _seq_db([]),
                _request_row(),
                _org(),
                actor=SimpleNamespace(id=USER_ID),
            )

    @pytest.mark.asyncio
    async def test_a_department_can_turn_the_call_off(self):
        org = _org({"email_triggers": {"volunteer_call": {"enabled": False}}})
        event_request = _request_row(
            status=EventRequestStatus.SCHEDULED,
            event_date=datetime.now(timezone.utc) + timedelta(days=14),
        )
        with pytest.raises(ValueError, match="turned off"):
            await send_volunteer_call(
                _seq_db([]), event_request, org, actor=SimpleNamespace(id=USER_ID)
            )

    @pytest.mark.asyncio
    async def test_an_empty_roster_is_reported_not_silently_successful(self):
        org = _org()
        event_request = _request_row(
            status=EventRequestStatus.SCHEDULED,
            event_date=datetime.now(timezone.utc) + timedelta(days=14),
        )
        with pytest.raises(ValueError, match="No members"):
            await send_volunteer_call(
                _seq_db([_scalars_result([])]),
                event_request,
                org,
                actor=SimpleNamespace(id=USER_ID),
            )


class TestOutreachShiftIsNotDutyCoverage:
    """A signup sheet must not be captured by a standing duty claim.

    A standing claim with no apparatus means "whichever shift runs in that
    window" — which, without this guard, includes a Saturday fire safety demo.
    It would both commit a member to an event they never chose and spend one
    of the sheet's counted seats doing it.
    """

    def test_standing_claims_skip_an_outreach_sheet(self):
        from app.models.training import ShiftStatus
        from app.services.standing_shift_service import StandingShiftService

        service = StandingShiftService(AsyncMock())
        sheet = SimpleNamespace(
            status=ShiftStatus.SCHEDULED,
            is_finalized=False,
            is_outreach=True,
            apparatus_id=None,
        )

        assert service._matches(sheet, "day", None, timezone.utc) is False

    @pytest.mark.asyncio
    async def test_the_sheet_is_created_as_an_open_outreach_shift(self):
        org = _org()
        event_request = _request_row(
            status=EventRequestStatus.SCHEDULED,
            event_date=datetime(2026, 9, 12, 14, 0, tzinfo=timezone.utc),
        )
        scheduling = MagicMock()
        scheduling.create_shift = AsyncMock(
            return_value=(SimpleNamespace(id="shift-9"), None)
        )
        db = AsyncMock()
        db.add = MagicMock()

        with patch(
            "app.services.scheduling_service.SchedulingService",
            MagicMock(return_value=scheduling),
        ):
            shift, error = await open_staffing_shift(
                db, event_request, org, 2, include_officer=True, actor_id=USER_ID
            )

        assert error is None
        assert shift.id == "shift-9"
        shift_data = scheduling.create_shift.await_args.args[1]
        assert shift_data["is_outreach"] is True
        assert shift_data["open_to_all_members"] is True
        assert shift_data["positions"] == [
            {"position": "officer", "required": True},
            {"position": "volunteer", "required": True},
            {"position": "volunteer", "required": True},
        ]
        # 14:00 UTC is 10am in America/New_York — the same calendar day. The
        # date is taken in the department's timezone so an evening event does
        # not land on the following day for a negative-offset department.
        assert shift_data["shift_date"] == date(2026, 9, 12)
        assert event_request.staffing_shift_id == "shift-9"

    @pytest.mark.asyncio
    async def test_an_evening_event_keeps_the_departments_calendar_date(self):
        org = _org()
        event_request = _request_row(
            status=EventRequestStatus.SCHEDULED,
            # 01:00 UTC on the 13th is 9pm on the 12th in America/New_York.
            event_date=datetime(2026, 9, 13, 1, 0, tzinfo=timezone.utc),
        )
        scheduling = MagicMock()
        scheduling.create_shift = AsyncMock(
            return_value=(SimpleNamespace(id="shift-9"), None)
        )
        db = AsyncMock()
        db.add = MagicMock()

        with patch(
            "app.services.scheduling_service.SchedulingService",
            MagicMock(return_value=scheduling),
        ):
            await open_staffing_shift(
                db, event_request, org, 1, include_officer=False, actor_id=USER_ID
            )

        assert scheduling.create_shift.await_args.args[1]["shift_date"] == date(
            2026, 9, 12
        )

    @pytest.mark.asyncio
    async def test_a_request_with_no_date_cannot_open_a_sheet(self):
        shift, error = await open_staffing_shift(
            AsyncMock(), _request_row(), _org(), 2, False, USER_ID
        )
        assert shift is None
        assert error is not None
