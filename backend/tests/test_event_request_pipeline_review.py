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
    StaffingRoleNeed,
    TaskCompletionUpdate,
)
from app.services.event_request_service import (
    build_staffing_positions,
    describe_roles,
    get_pipeline_settings,
    lead_time_error,
    open_staffing_shift,
    outreach_role_label,
    outreach_type_label,
    resolve_outreach_signup_role,
    send_volunteer_call,
    validate_staffing_roles,
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
        "staffing_roles": None,
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
        seats = build_staffing_positions(3)
        assert seats == [{"position": "volunteer", "required": True}] * 3

    def test_every_seat_is_a_plain_volunteer_seat(self):
        """The crew-position vocabulary stays out of an outreach sheet.

        ``shift_assignments.position`` is a MySQL ENUM whose labels are
        rewritten to the ShiftPosition values at startup, so a role stored
        there would be rejected or erased. The role lives on its own column;
        the seat itself is deliberately unremarkable.
        """
        assert {seat["position"] for seat in build_staffing_positions(4)} == {
            "volunteer"
        }

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


def _rows_result(rows):
    """An ``execute`` result exposing ``.all()`` — the (assignment, user) join."""
    return SimpleNamespace(all=lambda: list(rows))


def _shift(positions=None):
    return SimpleNamespace(
        id="shift-9",
        start_time=datetime.now(timezone.utc),
        positions=(
            positions
            if positions is not None
            else [{"position": "volunteer", "required": True}] * 2
        ),
    )


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
                data=EventRequestStaffingCreate(
                    roles=[StaffingRoleNeed(role="tour_guide", count=2)]
                ),
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
                data=EventRequestStaffingCreate(
                    roles=[StaffingRoleNeed(role="tour_guide", count=2)]
                ),
                db=db,
                current_user=SimpleNamespace(id=USER_ID, organization_id=ORG_ID),
            )

        assert exc.value.status_code == 409

    @pytest.mark.asyncio
    async def test_opening_signups_creates_the_shift_and_reports_the_roles(self):
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
                        "roles": [
                            {
                                "role": "tour_guide",
                                "label": "Tour Guide",
                                "total": 2,
                                "filled": 0,
                                "remaining": 2,
                            },
                            {
                                "role": "educator",
                                "label": "Educator",
                                "total": 1,
                                "filled": 0,
                                "remaining": 1,
                            },
                        ],
                        "volunteers": [],
                        "volunteer_call_sent_at": None,
                    }
                ),
            ),
        ):
            response = await open_request_staffing(
                request_id=REQUEST_ID,
                data=EventRequestStaffingCreate(
                    roles=[
                        StaffingRoleNeed(role="tour_guide", count=2),
                        StaffingRoleNeed(role="educator", count=1),
                    ]
                ),
                db=db,
                current_user=SimpleNamespace(id=USER_ID, organization_id=ORG_ID),
            )

        assert response.shift_id == "shift-9"
        assert [r.label for r in response.roles] == ["Tour Guide", "Educator"]
        assert opener.await_args.kwargs["staffing_roles"] == [
            {"role": "tour_guide", "count": 2},
            {"role": "educator", "count": 1},
        ]


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
        db = _seq_db([_scalars_result(members), _rows_result([])])
        db.scalar = AsyncMock(return_value=_shift())
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
            staffing_roles=[{"role": "tour_guide", "count": 2}],
            venue_address="12 Maple Street",
            audience_size=60,
            age_group="Grades 2-3",
        )
        db = _seq_db(
            [
                _scalars_result([_member("Sam", "sam@fire.example.org")]),
                _rows_result([]),
            ]
        )
        db.scalar = AsyncMock(return_value=_shift())
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
        # The ask, in words a member can picture themselves doing.
        assert "Roles needed" in body
        assert "2 x Tour Guide" in body

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
                db,
                event_request,
                org,
                [{"role": "tour_guide", "count": 2}, {"role": "educator", "count": 1}],
                actor_id=USER_ID,
            )

        assert error is None
        assert shift.id == "shift-9"
        shift_data = scheduling.create_shift.await_args.args[1]
        assert shift_data["is_outreach"] is True
        assert shift_data["open_to_all_members"] is True
        # Three people needed, three plain seats. The jobs are on the request.
        assert (
            shift_data["positions"] == [{"position": "volunteer", "required": True}] * 3
        )
        assert shift_data["min_staffing"] == 3
        # 14:00 UTC is 10am in America/New_York — the same calendar day. The
        # date is taken in the department's timezone so an evening event does
        # not land on the following day for a negative-offset department.
        assert shift_data["shift_date"] == date(2026, 9, 12)
        assert event_request.staffing_shift_id == "shift-9"
        assert event_request.staffing_roles == [
            {"role": "tour_guide", "count": 2},
            {"role": "educator", "count": 1},
        ]

    @pytest.mark.asyncio
    async def test_the_shift_notes_name_the_roles(self):
        """A member reading the shift on the calendar sees what the job is."""
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
            await open_staffing_shift(
                db,
                event_request,
                org,
                [{"role": "tour_guide", "count": 2}],
                actor_id=USER_ID,
            )

        notes = scheduling.create_shift.await_args.args[1]["notes"]
        assert "2 x Tour Guide" in notes

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
                db,
                event_request,
                org,
                [{"role": "educator", "count": 1}],
                actor_id=USER_ID,
            )

        assert scheduling.create_shift.await_args.args[1]["shift_date"] == date(
            2026, 9, 12
        )

    @pytest.mark.asyncio
    async def test_a_request_with_no_date_cannot_open_a_sheet(self):
        shift, error = await open_staffing_shift(
            AsyncMock(),
            _request_row(),
            _org(),
            [{"role": "educator", "count": 1}],
            USER_ID,
        )
        assert shift is None
        assert error is not None


# ============================================
# Outreach roles — a vocabulary for people who are not riding a truck
# ============================================


class TestOutreachRoles:
    """The seats at a school visit are jobs, not crew positions.

    "Firefighter / Driver / Officer" describes who is riding which seat on an
    apparatus. It tells a member nothing about a station tour, and asking them
    to sign up as "Driver" for a classroom talk is how a sheet stays empty.
    """

    def test_the_default_vocabulary_is_outreach_work(self):
        roles = {r["value"] for r in EVENT_SETTINGS_DEFAULTS["outreach_roles"]}
        assert {"tour_guide", "educator", "facilitator"} <= roles
        # And explicitly not the crew positions.
        assert not roles & {"firefighter", "driver", "officer", "captain"}

    def test_a_department_can_replace_the_vocabulary(self):
        """Departments run different programmes; a fixed list cannot hold them."""
        org = _org()
        org.settings["events"]["outreach_roles"] = [
            {"value": "smoke_trailer_operator", "label": "Smoke Trailer Operator"}
        ]
        assert outreach_role_label(org, "smoke_trailer_operator") == (
            "Smoke Trailer Operator"
        )

    def test_a_role_dropped_from_settings_still_renders(self):
        """Somebody already signed up as it — showing the raw value is worse."""
        assert outreach_role_label(_org(), "puppet_show") == "Puppet Show"

    def test_a_role_the_department_has_not_configured_is_refused(self):
        """A seat nobody can select never fills, and silently dropping it
        would understate what the day needs."""
        with pytest.raises(ValueError, match="Unknown outreach role"):
            validate_staffing_roles(_org(), [{"role": "puppeteer", "count": 1}])

    def test_an_empty_sheet_is_refused(self):
        with pytest.raises(ValueError, match="at least one role"):
            validate_staffing_roles(_org(), [])

    def test_repeated_roles_are_summed_into_the_seats_meant(self):
        roles = validate_staffing_roles(
            _org(),
            [
                {"role": "tour_guide", "count": 2},
                {"role": "tour_guide", "count": 1},
            ],
        )
        assert roles == [{"role": "tour_guide", "count": 3}]

    def test_needs_render_for_a_human(self):
        assert describe_roles(
            _org(),
            [{"role": "tour_guide", "count": 2}, {"role": "educator", "count": 1}],
        ) == ("2 x Tour Guide, 1 x Educator")


class TestOutreachSignupRole:
    """Signing up for an outreach sheet means choosing a job."""

    @staticmethod
    def _db(event_request, org, taken=0):
        db = AsyncMock()
        db.scalar = AsyncMock(side_effect=[event_request, org])
        db.execute = AsyncMock(return_value=SimpleNamespace(scalar=lambda: taken))
        return db

    @pytest.mark.asyncio
    async def test_a_member_must_say_what_they_will_do(self):
        request = _request_row(staffing_roles=[{"role": "tour_guide", "count": 2}])
        db = self._db(request, _org())

        with pytest.raises(ValueError, match="Choose what you would like to do"):
            await resolve_outreach_signup_role(
                db, SimpleNamespace(id="shift-9"), None, ORG_ID
            )

    @pytest.mark.asyncio
    async def test_a_role_the_event_does_not_need_is_refused(self):
        """Taking a seat as something nobody asked for leaves a real role open."""
        request = _request_row(staffing_roles=[{"role": "tour_guide", "count": 2}])
        db = self._db(request, _org())

        with pytest.raises(ValueError, match="not one of the roles"):
            await resolve_outreach_signup_role(
                db, SimpleNamespace(id="shift-9"), "educator", ORG_ID
            )

    @pytest.mark.asyncio
    async def test_a_full_role_is_refused_even_with_seats_left_elsewhere(self):
        request = _request_row(
            staffing_roles=[
                {"role": "tour_guide", "count": 1},
                {"role": "educator", "count": 3},
            ]
        )
        db = self._db(request, _org(), taken=1)

        with pytest.raises(ValueError, match="last Tour Guide seat"):
            await resolve_outreach_signup_role(
                db, SimpleNamespace(id="shift-9"), "tour_guide", ORG_ID
            )

    @pytest.mark.asyncio
    async def test_an_open_role_is_accepted(self):
        request = _request_row(staffing_roles=[{"role": "tour_guide", "count": 2}])
        db = self._db(request, _org(), taken=1)

        assert (
            await resolve_outreach_signup_role(
                db, SimpleNamespace(id="shift-9"), "tour_guide", ORG_ID
            )
            == "tour_guide"
        )

    @pytest.mark.asyncio
    async def test_a_sheet_with_no_roles_falls_back_to_plain_seats(self):
        """A sheet opened before roles existed still has to be signable.

        Its seats are ordinary volunteer seats and the generic capacity check
        already covers them, so no role is demanded.
        """
        db = self._db(_request_row(staffing_roles=None), _org())

        assert (
            await resolve_outreach_signup_role(
                db, SimpleNamespace(id="shift-9"), None, ORG_ID
            )
            == ""
        )
