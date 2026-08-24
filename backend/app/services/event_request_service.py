"""
Event Request Pipeline Service

Shared pipeline logic for the public outreach event request pipeline.

Both intake paths — the JSON endpoint at ``POST /event-requests/public`` and a
public Form carrying the ``EVENT_REQUEST`` integration — land here, so a
department gets the same lead-time gate, the same auto-assignment and the same
acknowledgement email whichever route the requester took. They did not before:
the forms path (the one the department's own "Generate public request form"
button produces) created the row and stopped, so nobody was assigned and
nobody — requester or coordinator — was told a request had arrived.
"""

import html as _html
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from loguru import logger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event_request import EventRequest, EventRequestActivity
from app.models.user import Organization, User

STATUS_LABELS = {
    "submitted": "Submitted",
    "in_progress": "In Progress",
    "scheduled": "Scheduled",
    "postponed": "Postponed",
    "completed": "Completed",
    "declined": "Declined",
    "cancelled": "Cancelled",
}


def _event_settings_defaults() -> dict:
    """Read the events-module defaults.

    Imported inside the function on purpose: the constant lives in the events
    endpoint module, and a module-level import here would make a service depend
    on an API module at import time.
    """
    from app.api.v1.endpoints.events import EVENT_SETTINGS_DEFAULTS

    return EVENT_SETTINGS_DEFAULTS


def get_pipeline_settings(org: Optional[Organization]) -> dict:
    """Read pipeline settings from an organization, falling back to defaults."""
    defaults = _event_settings_defaults()["request_pipeline"]
    if org is None:
        return dict(defaults)
    settings = (org.settings or {}).get("events", {})
    stored = settings.get("request_pipeline", {})
    return {**defaults, **stored}


def get_outreach_types(org: Optional[Organization]) -> list[dict[str, str]]:
    """Read outreach event types from an organization, falling back to defaults."""
    defaults = _event_settings_defaults()["outreach_event_types"]
    if org is None:
        return list(defaults)
    settings = (org.settings or {}).get("events", {})
    return settings.get("outreach_event_types", defaults)


def configured_task_ids(org: Optional[Organization]) -> set[str]:
    """The set of pipeline task ids this department has configured."""
    tasks = get_pipeline_settings(org).get("tasks", []) or []
    return {str(t.get("id")) for t in tasks if isinstance(t, dict) and t.get("id")}


def lead_time_error(
    pipeline: dict,
    date_flexibility: Optional[str],
    preferred_date_start: Optional[datetime],
    now: Optional[datetime] = None,
) -> Optional[str]:
    """Reject a request whose earliest requested date is inside the lead time.

    ``min_lead_time_days`` is the department's answer to "how much notice do we
    need?". It shipped as a stored setting with a slider on the settings screen
    and no code that read it, so a school could ask for a truck on Friday and
    the pipeline accepted it as readily as one asking six months out
    (see CLAUDE.md pitfall #19).

    Only a request that names a date can be too soon: ``general_timeframe`` and
    ``flexible`` requesters are asking the department to pick, so there is
    nothing to measure against and nothing to refuse.
    """
    try:
        min_days = int(pipeline.get("min_lead_time_days") or 0)
    except (TypeError, ValueError):
        return None
    if min_days <= 0:
        return None
    if date_flexibility != "specific_dates" or preferred_date_start is None:
        return None

    reference = now or datetime.now(timezone.utc)
    requested = preferred_date_start
    if requested.tzinfo is None:
        requested = requested.replace(tzinfo=timezone.utc)
    if requested >= reference + timedelta(days=min_days):
        return None

    day_word = "day" if min_days == 1 else "days"
    return (
        f"We need at least {min_days} {day_word} notice for this kind of "
        f"request. Please choose a later date, or tell us you are flexible "
        f"and we will suggest one."
    )


async def get_user_name(db: AsyncSession, user_id: str) -> Optional[str]:
    """Look up a user's display name."""
    result = await db.execute(
        select(User.first_name, User.last_name).where(User.id == user_id)
    )
    row = result.first()
    if row:
        return f"{row[0]} {row[1]}".strip()
    return None


async def apply_default_assignee(
    db: AsyncSession, event_request: EventRequest, pipeline: dict
) -> Optional[str]:
    """Auto-assign the department's default coordinator and log the action.

    Returns the assigned user id, or None when the department has not named a
    default coordinator. The caller is expected to have flushed the request so
    the activity row has an id to point at.
    """
    default_assignee = pipeline.get("default_assignee_id")
    if not default_assignee:
        return None
    if not await db.scalar(
        select(User.id).where(
            User.id == default_assignee,
            User.organization_id == str(event_request.organization_id),
        )
    ):
        # The coordinator left the department (or the setting predates their
        # transfer). Leave the request unassigned rather than pointing it at
        # somebody who is no longer there — an unassigned request is visible
        # in the queue, one assigned to a departed member is not.
        logger.warning(
            "Default event-request coordinator {} is not in org {}; "
            "leaving request unassigned",
            default_assignee,
            event_request.organization_id,
        )
        return None

    event_request.assigned_to = default_assignee
    assignee_name = await get_user_name(db, default_assignee)
    db.add(
        EventRequestActivity(
            request_id=event_request.id,
            action="auto_assigned",
            notes=f"Auto-assigned to {assignee_name or 'default coordinator'}",
            details={"assigned_to": default_assignee},
        )
    )
    return default_assignee


async def send_request_notification(
    db: AsyncSession,
    event_request: EventRequest,
    trigger_key: str,
    org: Organization,
    extra_context: Optional[dict] = None,
) -> None:
    """
    Send email notification based on pipeline trigger settings.

    Reads trigger config from org settings, sends to requester and/or assignee
    as configured. Failures are logged but do not block the request.
    """
    try:
        from app.services.email_service import EmailService
        from app.services.notifications_service import NotificationsService

        pipeline = get_pipeline_settings(org)
        triggers = pipeline.get("email_triggers", {})
        trigger_config = triggers.get(trigger_key, {})

        if not trigger_config.get("enabled", False):
            return

        email_service = EmailService(organization=org)
        notifications_service = NotificationsService(db)

        status_value = (
            event_request.status.value
            if hasattr(event_request.status, "value")
            else str(event_request.status)
        )
        status_label = STATUS_LABELS.get(status_value, status_value)

        # Notify the requester
        if trigger_config.get("notify_requester", False):
            from app.models.email_template import EmailTemplateType
            from app.services.email_template_service import (
                DEFAULT_EVENT_REQUEST_STATUS_HTML,
                DEFAULT_EVENT_REQUEST_STATUS_SUBJECT,
                DEFAULT_EVENT_REQUEST_STATUS_TEXT,
            )

            org_name = org.name if org else "Department"
            event_date = (
                event_request.event_date.strftime("%B %d, %Y at %I:%M %p")
                if event_request.event_date
                else ""
            )
            decline_reason = event_request.decline_reason or ""
            message = extra_context.get("message", "") if extra_context else ""

            # Build the optional blocks here rather than labelling them in the
            # template: a scheduled request has a date and no decline reason,
            # a declined one the reverse, and the recipient is a member of the
            # public who should not receive a bare "Reason:" with nothing after
            # it. Escaped at the point of assembly — every value below is
            # either department-entered or public-supplied.
            detail_rows = []
            detail_lines = []
            if event_date:
                detail_rows.append(
                    f"<p><strong>Scheduled Date:</strong> {_html.escape(event_date)}</p>"
                )
                detail_lines.append(f"Scheduled Date: {event_date}")
            if decline_reason:
                detail_rows.append(
                    f"<p><strong>Reason:</strong> {_html.escape(decline_reason)}</p>"
                )
                detail_lines.append(f"Reason: {decline_reason}")

            context = {
                "contact_name": event_request.contact_name or "",
                "status_label": status_label,
                "event_date": event_date,
                "decline_reason": decline_reason,
                "message": message,
                "details_html": (
                    f'<div class="details">{"".join(detail_rows)}</div>'
                    if detail_rows
                    else ""
                ),
                "details_text": "\n".join(detail_lines),
                "message_html": (
                    f'<p style="white-space:pre-line;">{_html.escape(message)}</p>'
                    if message
                    else ""
                ),
                "organization_name": org_name,
            }

            # _render_with_fallback loads the department's template and falls
            # back to the built-in default, escaping each destination the way
            # it needs. Hand-rolling that here previously fed each value to
            # re.sub as a replacement string, so a backslash in a public
            # contact name was read as a group reference.
            subject, html_body, text_body = await email_service._render_with_fallback(
                template_type=EmailTemplateType.EVENT_REQUEST_STATUS,
                context=context,
                db=db,
                organization_id=str(org.id) if org else None,
                default_subject=DEFAULT_EVENT_REQUEST_STATUS_SUBJECT,
                default_html=DEFAULT_EVENT_REQUEST_STATUS_HTML,
                default_text=DEFAULT_EVENT_REQUEST_STATUS_TEXT,
            )

            await email_service.send_email(
                to_emails=[event_request.contact_email],
                subject=subject,
                html_body=html_body,
                text_body=text_body,
                db=db,
                template_type=EmailTemplateType.EVENT_REQUEST_STATUS.value,
            )

        # Notify the assigned coordinator
        if trigger_config.get("notify_assignee", False) and event_request.assigned_to:
            assignee_result = await db.execute(
                select(User).where(User.id == event_request.assigned_to)
            )
            assignee = assignee_result.scalar_one_or_none()
            if assignee and assignee.email:
                from app.services.email_service import build_email_logo_html

                outreach_label = event_request.outreach_type.replace("_", " ").title()
                e_assignee = _html.escape(assignee.first_name or "")
                e_contact = _html.escape(event_request.contact_name or "")
                e_outreach = _html.escape(outreach_label)
                e_org_name = _html.escape(event_request.organization_name or "N/A")
                _logo = build_email_logo_html(org)
                subject = f"New Event Request Assigned — {outreach_label}"
                body = f"""<div style="font-family:Arial,sans-serif;max-width:600px;">
{_logo}
<p>Hello {e_assignee},</p>
<p>A new event request has been assigned to you:</p>
<ul>
<li><strong>Contact:</strong> {e_contact}</li>
<li><strong>Type:</strong> {e_outreach}</li>
<li><strong>Organization:</strong> {e_org_name}</li>
</ul>
<p>Please review and begin processing this request.</p>
</div>"""

                await email_service.send_email(
                    to_emails=[assignee.email],
                    subject=subject,
                    html_body=body,
                )

                await notifications_service.log_notification(
                    organization_id=org.id,
                    log_data={
                        "recipient_id": assignee.id,
                        "channel": "email",
                        "category": "events",
                        "trigger": "event_reminder",
                        "subject": subject,
                        "body": f"New event request from {event_request.contact_name}",
                    },
                )
    except Exception as e:
        # A failed notification must not roll back an event request the public
        # already submitted — but swallowing it without a trace meant nobody
        # could tell "no assignee was notified" from "no request came in".
        logger.warning(
            "Event request notification ({}) failed for org {}: {}",
            trigger_key,
            getattr(org, "id", None),
            e,
        )


# ============================================
# Volunteer staffing — the tie-in to the shift schedule
# ============================================

# One entry per seat, the canonical stored shape for a positions column
# (CLAUDE.md pitfall #20). Outreach seats are `volunteer`: an open-to-all shift
# returns exactly the positions it defines as eligible, so a member signing up
# is not gated behind an operational rank they do not need to run a station
# tour.
_OUTREACH_SEAT = "volunteer"
_OUTREACH_OFFICER_SEAT = "officer"
# Distinguishes an outreach signup sheet from a duty shift at a glance on the
# calendar. Amber, matching the outreach badge on the requests board.
_OUTREACH_SHIFT_COLOR = "#b45309"


def _org_timezone(org: Optional[Organization]):
    """The organization's tzinfo, falling back to UTC."""
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    name = getattr(org, "timezone", None) or "UTC"
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return timezone.utc


def outreach_type_label(org: Optional[Organization], outreach_type: str) -> str:
    """The department's own label for an outreach type, or a humanized fallback."""
    for entry in get_outreach_types(org):
        if isinstance(entry, dict) and entry.get("value") == outreach_type:
            return str(entry.get("label") or outreach_type)
    return outreach_type.replace("_", " ").title()


def build_staffing_positions(volunteer_slots: int, include_officer: bool) -> list[dict]:
    """Build the canonical seat list for an outreach signup sheet."""
    seats: list[dict] = []
    if include_officer:
        seats.append({"position": _OUTREACH_OFFICER_SEAT, "required": True})
    seats.extend(
        {"position": _OUTREACH_SEAT, "required": True} for _ in range(volunteer_slots)
    )
    return seats


async def open_staffing_shift(
    db: AsyncSession,
    event_request: EventRequest,
    org: Optional[Organization],
    volunteer_slots: int,
    include_officer: bool,
    actor_id: str,
    notes: Optional[str] = None,
):
    """Create the shift members sign up on to cover a scheduled request.

    Returns ``(shift, error)``. The shift is ``open_to_all_members`` so the
    eligibility service returns its seats to every member — an outreach event
    is staffed by whoever can come, not by operational rank — and self-signup
    capacity is what caps it at the number of seats requested.
    """
    from app.services.scheduling_service import SchedulingService

    if not event_request.event_date:
        return None, "Confirm a date before opening volunteer signups."

    tz = _org_timezone(org)
    start = event_request.event_date
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    end = event_request.event_end_date or (start + timedelta(hours=2))
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)

    label = outreach_type_label(org, event_request.outreach_type)
    who = event_request.organization_name or event_request.contact_name
    note_lines = [f"Community outreach: {label} for {who}."]
    if notes:
        note_lines.append(notes)
    if event_request.venue_address:
        note_lines.append(f"Location: {event_request.venue_address}")

    service = SchedulingService(db)
    shift, error = await service.create_shift(
        event_request.organization_id,
        {
            # Stored as the calendar date in the department's own timezone: an
            # evening event stamped from a UTC date lands on the following day
            # on the schedule for every negative-offset department.
            "shift_date": start.astimezone(tz).date(),
            "start_time": start,
            "end_time": end,
            "positions": build_staffing_positions(volunteer_slots, include_officer),
            "min_staffing": volunteer_slots,
            "open_to_all_members": True,
            "is_outreach": True,
            "color": _OUTREACH_SHIFT_COLOR,
            "notes": "\n".join(note_lines),
        },
        actor_id,
    )
    if error or shift is None:
        return None, error or "Unable to create the volunteer signup shift."

    event_request.staffing_shift_id = shift.id
    db.add(
        EventRequestActivity(
            request_id=event_request.id,
            action="staffing_opened",
            notes=(
                f"Opened volunteer signups for {volunteer_slots} "
                f"{'member' if volunteer_slots == 1 else 'members'}"
            ),
            details={
                "shift_id": shift.id,
                "volunteer_slots": volunteer_slots,
                "include_officer": include_officer,
            },
            performed_by=actor_id,
        )
    )
    return shift, None


async def get_staffing_state(
    db: AsyncSession, event_request: EventRequest
) -> dict[str, Any]:
    """Who has signed up to cover this request, and how many seats remain."""
    from app.models.training import AssignmentStatus, Shift, ShiftAssignment

    empty = {
        "shift_id": None,
        "shift_date": None,
        "slots_total": 0,
        "slots_filled": 0,
        "volunteers": [],
        "volunteer_call_sent_at": event_request.volunteer_call_sent_at,
    }
    if not event_request.staffing_shift_id:
        return empty

    shift = await db.scalar(
        select(Shift).where(
            Shift.id == event_request.staffing_shift_id,
            Shift.organization_id == str(event_request.organization_id),
        )
    )
    if shift is None:
        # The shift was deleted; the FK is SET NULL so this is only reachable
        # in-flight, but answering "no sheet" beats raising at the coordinator.
        return empty

    rows = await db.execute(
        select(ShiftAssignment, User)
        .join(User, User.id == ShiftAssignment.user_id)
        .where(
            ShiftAssignment.shift_id == shift.id,
            ShiftAssignment.organization_id == str(event_request.organization_id),
            ShiftAssignment.assignment_status.notin_(
                [AssignmentStatus.CANCELLED, AssignmentStatus.DECLINED]
            ),
        )
        .order_by(ShiftAssignment.created_at)
    )

    volunteers = []
    for assignment, member in rows.all():
        position = assignment.position
        status_value = assignment.assignment_status
        volunteers.append(
            {
                "user_id": assignment.user_id,
                "member_name": f"{member.first_name} {member.last_name}".strip(),
                "position": getattr(position, "value", str(position)),
                "status": getattr(status_value, "value", str(status_value)),
                "assigned_at": assignment.created_at,
            }
        )

    positions = shift.positions if isinstance(shift.positions, list) else []
    return {
        "shift_id": shift.id,
        "shift_date": shift.start_time,
        "slots_total": len(positions),
        "slots_filled": len(volunteers),
        "volunteers": volunteers,
        "volunteer_call_sent_at": event_request.volunteer_call_sent_at,
    }


async def send_volunteer_call(
    db: AsyncSession,
    event_request: EventRequest,
    org: Optional[Organization],
    actor: User,
    message: Optional[str] = None,
    membership_types: Optional[list[str]] = None,
) -> dict[str, Any]:
    """Email the membership asking who can help cover a scheduled request.

    Email only, deliberately. This is a routine call for help a member acts on
    during the week, not one of the alerts in ``SmsAlert`` — see CLAUDE.md
    pitfall #18. It is also additive: it does not replace the coordinator's
    own conversations, it gives everyone the same details at once.
    """
    from app.core.config import settings
    from app.services.email_service import EmailService, wrap_email_body

    pipeline = get_pipeline_settings(org)
    trigger = (pipeline.get("email_triggers", {}) or {}).get("volunteer_call", {})
    if not trigger.get("enabled", True):
        raise ValueError("Volunteer call emails are turned off for this department.")
    if not event_request.event_date:
        raise ValueError("Confirm a date before asking the membership for help.")

    query = select(User).where(
        User.organization_id == str(event_request.organization_id),
        User.is_active,
        User.email.isnot(None),
    )
    if membership_types:
        query = query.where(User.membership_type.in_(membership_types))
    members = list((await db.execute(query)).scalars().all())

    recipients: list[str] = []
    skipped = 0
    for member in members:
        if not member.email:
            continue
        prefs = member.notification_preferences or {}
        if not prefs.get("email_notifications", True):
            skipped += 1
            continue
        recipients.append(member.email)

    if not recipients:
        raise ValueError("No members are available to email about this event.")

    tz = _org_timezone(org)
    start = event_request.event_date
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    when = start.astimezone(tz).strftime("%A, %B %d, %Y at %I:%M %p")

    label = outreach_type_label(org, event_request.outreach_type)
    who = event_request.organization_name or event_request.contact_name
    signup_url = f"{settings.FRONTEND_URL}/scheduling?tab=open-shifts"

    detail_rows = [
        ("What", label),
        ("For", who),
        ("When", when),
    ]
    if event_request.venue_address:
        detail_rows.append(("Where", event_request.venue_address))
    if event_request.audience_size:
        detail_rows.append(("Expected attendance", str(event_request.audience_size)))
    if event_request.age_group:
        detail_rows.append(("Audience", event_request.age_group))

    details_html = "".join(
        f"<p><strong>{_html.escape(k)}:</strong> {_html.escape(v)}</p>"
        for k, v in detail_rows
    )
    note_html = (
        f'<p style="white-space:pre-line;">{_html.escape(message)}</p>'
        if message
        else ""
    )
    # A member cannot sign up for a sheet that was never opened, so say what to
    # do instead of pointing them at an Open Shifts tab with nothing on it.
    action_html = (
        f'<p style="text-align:center;">'
        f'<a href="{_html.escape(signup_url)}" class="button" role="link">'
        f"Sign Up on the Schedule</a></p>"
        if event_request.staffing_shift_id
        else (
            "<p>Reply to this email or contact the coordinator if you can help "
            "— signups will open on the schedule shortly.</p>"
        )
    )

    subject = f"Can you help? {label} — {when}"
    html_body = wrap_email_body(
        org,
        "We need help covering an outreach event",
        f"<p>The department has committed to the following community event and "
        f"is looking for members to cover it.</p>"
        f"{details_html}{note_html}{action_html}",
    )
    text_lines = [
        "The department has committed to a community event and needs help "
        "covering it.",
        "",
    ]
    text_lines += [f"{k}: {v}" for k, v in detail_rows]
    if message:
        text_lines += ["", message]
    if event_request.staffing_shift_id:
        text_lines += ["", f"Sign up on the schedule: {signup_url}"]
    else:
        text_lines += [
            "",
            "Contact the coordinator if you can help — signups will open on "
            "the schedule shortly.",
        ]

    email_service = EmailService(organization=org)
    await email_service.send_email(
        to_emails=recipients,
        subject=subject,
        html_body=html_body,
        text_body="\n".join(text_lines),
        db=db,
        template_type="event_request_volunteer_call",
    )

    sent_at = datetime.now(timezone.utc)
    event_request.volunteer_call_sent_at = sent_at
    db.add(
        EventRequestActivity(
            request_id=event_request.id,
            action="volunteer_call_sent",
            notes=(
                f"Emailed {len(recipients)} "
                f"{'member' if len(recipients) == 1 else 'members'} asking for help"
            ),
            details={
                "recipients": len(recipients),
                "skipped_opted_out": skipped,
                "membership_types": membership_types,
            },
            performed_by=str(actor.id),
        )
    )
    return {
        "message": f"Volunteer call emailed to {len(recipients)} members.",
        "recipients": len(recipients),
        "skipped_opted_out": skipped,
        "volunteer_call_sent_at": sent_at,
    }
