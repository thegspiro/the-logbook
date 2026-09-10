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
from typing import Any, Iterable, Optional

from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event_request import EventRequest, EventRequestActivity
from app.models.user import Organization, User
from app.utils.outreach_roles import (
    MAX_TOTAL_SEATS,
    normalize_staffing_roles,
    role_label,
)

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


# Nested settings maps that must be merged key-by-key rather than replaced.
# A department that saved its email triggers before a new one existed has a
# stored map missing that key, and a shallow merge hands back exactly what was
# stored — so every trigger added later reads as "not configured" and its
# sender does nothing. That is the same shape as pitfall #19: absence has to
# mean "current behaviour", not "off".
#
# `tasks` is deliberately NOT in here. It is a list the department orders and
# prunes itself, so a stored one replaces the default outright — merging would
# resurrect a checklist step somebody deleted.
_MERGED_PIPELINE_MAPS = ("email_triggers",)


def get_pipeline_settings(org: Optional[Organization]) -> dict:
    """Read pipeline settings from an organization, falling back to defaults."""
    defaults = _event_settings_defaults()["request_pipeline"]
    if org is None:
        return dict(defaults)
    settings = (org.settings or {}).get("events", {})
    stored = settings.get("request_pipeline", {})
    merged = {**defaults, **stored}

    for key in _MERGED_PIPELINE_MAPS:
        default_map = defaults.get(key)
        stored_map = stored.get(key)
        if isinstance(default_map, dict) and isinstance(stored_map, dict):
            # One level deeper as well: an existing `days_before_event` entry
            # predates `notify_requester`, and without it the reminder task
            # runs, ledgers the send, and delivers nothing.
            combined = {**default_map}
            for name, value in stored_map.items():
                base = combined.get(name)
                combined[name] = (
                    {**base, **value}
                    if isinstance(base, dict) and isinstance(value, dict)
                    else value
                )
            merged[key] = combined

    return merged


def event_duration_minutes(org: Optional[Organization]) -> int:
    """The department's default event length, for a date given without an end.

    ``events.defaults.default_duration_minutes`` is the setting the events
    module already owns for exactly this question, so the request pipeline
    reads it rather than inventing a second answer (CLAUDE.md pitfall #29).

    Read defensively: the settings blob is free-form JSON, and a bad value here
    would otherwise take down every attempt to schedule a request rather than
    the one setting somebody typed wrong.
    """
    fallback = int(_event_settings_defaults()["defaults"]["default_duration_minutes"])
    if org is None:
        return fallback
    stored = ((org.settings or {}).get("events", {}) or {}).get("defaults", {})
    if not isinstance(stored, dict):
        return fallback
    try:
        minutes = int(stored.get("default_duration_minutes", fallback))
    except (TypeError, ValueError):
        return fallback
    return minutes if minutes > 0 else fallback


def public_daily_limit(pipeline: dict) -> int:
    """The department's ceiling for public event requests in a day.

    Read defensively for the same reason `get_outreach_types` is:
    ``RequestPipelineUpdate.public_daily_limit`` is ``Optional[int]`` and
    ``update_event_settings`` dumps with ``exclude_unset``, so an explicit
    ``null`` in a PATCH body is persisted and ``pipeline.get(key, 50)`` hands
    that ``None`` straight back. ``int(None)`` then raises inside the cap check
    — a 500 on the JSON endpoint, and on the forms path a submission that looks
    accepted while no request is created.

    A value that is not a usable positive integer means "nothing sensible is
    configured", which is what the shipped default is for.
    """
    default = int(_event_settings_defaults()["request_pipeline"]["public_daily_limit"])
    try:
        limit = int(pipeline.get("public_daily_limit", default))
    except (TypeError, ValueError):
        return default
    return limit if limit > 0 else default


def get_outreach_types(org: Optional[Organization]) -> list[dict[str, str]]:
    """Read outreach event types from an organization, falling back to defaults.

    Read defensively, because the stored value is free-form JSON that an
    administrator can shape (pitfall #19). ``EventSettingsUpdate`` declares
    ``outreach_event_types`` optional and ``update_event_settings`` dumps with
    ``exclude_unset``, so an explicit ``null`` in the PATCH body is written
    through as ``None`` — and ``settings.get(key, defaults)`` hands that ``None``
    back, because the key is present. Every caller then iterates it: the
    intake normalizer, the label lookup, the public ``/types/labels`` endpoint
    and ``schedule_request``'s title builder would all raise ``TypeError``,
    which is a 500 on two public surfaces.

    A non-list stored value means "nothing usable is configured", which is what
    the defaults are for. Entries that are not ``{"value": ..., "label": ...}``
    dicts are dropped rather than allowed to break the caller that reads them.
    """
    defaults = _event_settings_defaults()["outreach_event_types"]
    if org is None:
        return list(defaults)
    settings = (org.settings or {}).get("events", {})
    if not isinstance(settings, dict):
        return list(defaults)
    stored = settings.get("outreach_event_types", defaults)
    if not isinstance(stored, list):
        return list(defaults)
    # An explicitly empty list is a configuration, not an absence: the
    # department offers no outreach types, and the settings screen says so.
    # Substituting the defaults here would make `/types/labels`, intake
    # normalization and the form generator all behave as though five types
    # were configured while the screen showed none. Only a *malformed* value
    # falls back.
    return [t for t in stored if isinstance(t, dict) and t.get("value")]


def configured_task_ids(org: Optional[Organization]) -> set[str]:
    """The set of pipeline task ids this department has configured."""
    tasks = get_pipeline_settings(org).get("tasks", []) or []
    return {str(t.get("id")) for t in tasks if isinstance(t, dict) and t.get("id")}


# The fixed vocabularies the requester's preference fields may hold. Unlike
# ``outreach_event_types`` and ``outreach_roles`` these are NOT per-department
# configurable: the model's comments, the generated form's <select> options and
# every reader in the admin board and the public status page are all written
# against these exact values, so a value outside them renders as a raw slug the
# coordinator has to decode.
DATE_FLEXIBILITIES = ("specific_dates", "general_timeframe", "flexible")
VENUE_PREFERENCES = ("their_location", "our_station", "either")
TIMES_OF_DAY = ("morning", "afternoon", "evening", "flexible")

# app/models/event_request.EventRequest.outreach_type is String(100). A longer
# value reaches MySQL as a DataError and surfaces to a member of the public as
# a 500 on a form they filled in correctly.
OUTREACH_TYPE_MAX_LENGTH = 100


# EventRequestCreate bounds audience_size at 1..10000; the forms path maps a
# free-text answer straight onto the column, so it needs the same bounds to
# store the same shape.
AUDIENCE_SIZE_MIN = 1
AUDIENCE_SIZE_MAX = 10000


# Column widths on app/models/event_request.EventRequest. The forms path maps
# free text straight onto these, and the generated form leaves its text fields
# at FormsService.MAX_TEXT_LENGTH (5000), so nothing between a member of the
# public and MySQL enforces them.
TEXT_FIELD_LIMITS = {
    "contact_name": 255,
    "contact_email": 255,
    "contact_phone": 50,
    "organization_name": 255,
    "outreach_type": OUTREACH_TYPE_MAX_LENGTH,
    "age_group": 100,
    "preferred_timeframe": 500,
}


def clamp_text_fields(data: dict) -> dict:
    """Trim mapped free text to what the columns can hold.

    An over-long value is a `DataError` at flush time, which the forms path
    reports as a failed integration — *after* the daily-allowance INCR has been
    spent. One 256-character `contact_name` submitted repeatedly could exhaust
    a department's whole day without storing a single request, which is the
    same defect the audience-size parse had and the same reason it moved above
    the counter.

    Truncating rather than refusing keeps the enquiry: a name that is too long
    for the column is still a name, and the coordinator can read the rest of
    the request. Only the mapped keys present are touched.
    """
    clamped = dict(data)
    for field, limit in TEXT_FIELD_LIMITS.items():
        value = clamped.get(field)
        if isinstance(value, str) and len(value) > limit:
            clamped[field] = value[:limit]
    return clamped


def parse_audience_size(value: Any) -> Optional[int]:
    """Read a requester's attendance estimate, or None when it is not a number.

    The generated public form asks this as a TEXT field, so the answer is
    whatever somebody typed. An unparseable one costs this field and nothing
    else: the coordinator still gets the request, and the requester's own words
    survive in ``description``.
    """
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        size = int(text)
    except ValueError:
        try:
            size = int(float(text))
        except (ValueError, OverflowError):
            # OverflowError as well as ValueError: "1e309", "inf" and
            # "Infinity" are all things a member of the public can type into a
            # text box, and `float()` accepts every one of them before
            # `int(inf)` raises — with a different exception type. Uncaught it
            # escaped this parser's lenient contract and failed the whole
            # integration, losing the enquiry over the one field this is
            # supposed to be able to give up on. (`float("nan")` raises
            # ValueError from `int()`, so it was already covered.)
            return None
    if size < AUDIENCE_SIZE_MIN:
        return None
    return min(size, AUDIENCE_SIZE_MAX)


def _clamp_choice(value: Any, allowed: tuple[str, ...], default: str) -> str:
    """Settle a preference field onto one of its known values."""
    text = str(value).strip().lower() if value is not None else ""
    return text if text in allowed else default


def normalize_request_preferences(
    org: Optional[Organization],
    data: dict,
    form_outreach_types: Optional[Iterable[str]] = None,
) -> dict:
    """Settle a requester's answers onto the pipeline's canonical shapes.

    Applied on **every** write path (CLAUDE.md pitfall #20): the JSON endpoint
    validates against ``EventRequestCreate``, but the forms path maps whatever
    a department typed into its own form options straight onto the model, so
    without a shared write-side authority the two intakes store different
    vocabularies for the same four questions and every reader has to tell them
    apart.

    Returns a new dict with ``outreach_type``, ``date_flexibility``,
    ``venue_preference`` and ``preferred_time_of_day`` settled. Nothing is
    dropped and nothing raises — a public submission is never worth losing over
    a preference field, and the description the requester actually wrote is the
    part the coordinator reads.
    """
    settled = dict(data)

    outreach_type = str(settled.get("outreach_type") or "").strip()
    configured = {t["value"] for t in get_outreach_types(org)}
    # A published form keeps the options it was generated with, so a department
    # that retires or renames a type leaves a live form still offering the old
    # value — and a requester who picks it has answered the question the
    # department asked. `form_outreach_types` is that form's own `<select>`
    # vocabulary, which `submit_form` has already validated the answer against,
    # so it is bounded rather than free text. Preserving it matches the
    # accompanying migration, which leaves historical `outreach_type` values
    # alone for this same retired-type case; rewriting it here would tell the
    # coordinator "Other" about a request that named a real event.
    if form_outreach_types:
        configured |= {str(v) for v in form_outreach_types if v}
    if outreach_type not in configured:
        # Falling back rather than storing the unknown value keeps the board's
        # type filter and the acknowledgement email's subject meaningful. The
        # requester's own words survive in `description`.
        outreach_type = "other"
    settled["outreach_type"] = outreach_type[:OUTREACH_TYPE_MAX_LENGTH]

    flexibility = _clamp_choice(
        settled.get("date_flexibility"), DATE_FLEXIBILITIES, "flexible"
    )
    # "I have specific dates" with no date is not a specific request, and
    # calling it one defeats `lead_time_error`, which only measures a request
    # that names a date: claiming specific_dates and omitting the date walked
    # straight past the department's minimum notice. Downgrading rather than
    # refusing keeps a real enquiry — a requester who picked the option and
    # then left the picker alone is asking the department to suggest a date,
    # which is exactly what general_timeframe means.
    if flexibility == "specific_dates" and not settled.get("preferred_date_start"):
        flexibility = "general_timeframe"
    settled["date_flexibility"] = flexibility

    settled["venue_preference"] = _clamp_choice(
        settled.get("venue_preference"), VENUE_PREFERENCES, "their_location"
    )
    settled["preferred_time_of_day"] = _clamp_choice(
        settled.get("preferred_time_of_day"), TIMES_OF_DAY, "flexible"
    )
    return settled


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


def render_request_template(
    template: Any, event_request: EventRequest, org: Optional[Organization]
) -> tuple[str, str, Optional[str]]:
    """Fill a department's email template for one request.

    Returns ``(subject, html_body, text_body)``. Shared by the manual send and
    the scheduled reminder so a template renders identically either way.
    """
    from app.services.email_service import build_email_logo_img

    # organization_logo_img is markup this module builds (and has already
    # escaped the url and alt text inside). Escaping it again renders the tag
    # as literal "<img ...>" text at the top of every template email.
    raw_html_keys = {"organization_logo_img"}

    context = {
        "contact_name": event_request.contact_name,
        "outreach_type": outreach_type_label(org, event_request.outreach_type),
        "organization_name": event_request.organization_name or "",
        "organization_logo_img": build_email_logo_img(org),
        "event_date": (
            event_request.event_date.strftime("%B %d, %Y at %I:%M %p")
            if event_request.event_date
            else "TBD"
        ),
    }

    subject = template.subject
    body = template.body_html
    for key, value in context.items():
        # EV-7: coerce to str before replace/escape — a None base-context value
        # would otherwise raise TypeError -> 500.
        safe_value = "" if value is None else str(value)
        subject = subject.replace(f"{{{{{key}}}}}", safe_value)
        body = body.replace(
            f"{{{{{key}}}}}",
            safe_value if key in raw_html_keys else _html.escape(safe_value),
        )
    return subject, body, template.body_text


async def send_request_notification(
    db: AsyncSession,
    event_request: EventRequest,
    trigger_key: str,
    org: Organization,
    extra_context: Optional[dict] = None,
    template: Any = None,
) -> bool:
    """
    Send email notification based on pipeline trigger settings.

    Reads trigger config from org settings, sends to requester and/or assignee
    as configured. ``template``, when given, is a department's own
    EventRequestEmailTemplate and is sent as itself in place of the generic
    status email.

    Returns True when the configured work completed — including "the trigger is
    switched off, so there was nothing to send". Returns False only when
    delivery raised, which is what lets the scheduled reminder tell a real send
    apart from a failed one before it writes its ledger entry: a failure
    recorded as a send retires that reminder permanently.
    """
    try:
        from app.services.email_service import EmailService
        from app.services.notifications_service import NotificationsService

        pipeline = get_pipeline_settings(org)
        triggers = pipeline.get("email_triggers", {})
        trigger_config = triggers.get(trigger_key, {})

        if not trigger_config.get("enabled", False):
            return True

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

            if template is not None:
                # The department attached this template to the trigger, so it
                # is the message — subject and HTML body included. Pouring only
                # its body_text into the generic status email discarded
                # everything an administrator actually wrote.
                subject, html_body, text_body = render_request_template(
                    template, event_request, org
                )
            else:
                # _render_with_fallback loads the department's template and
                # falls back to the built-in default, escaping each destination
                # the way it needs. Hand-rolling that here previously fed each
                # value to re.sub as a replacement string, so a backslash in a
                # public contact name was read as a group reference.
                (
                    subject,
                    html_body,
                    text_body,
                ) = await email_service._render_with_fallback(
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
        return True
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
        return False


# ============================================
# Volunteer staffing — the tie-in to the shift schedule
# ============================================

# One entry per seat, the canonical stored shape for a positions column
# (CLAUDE.md pitfall #20). Every outreach seat is a plain `volunteer`: an
# open-to-all shift returns exactly the positions it defines as eligible, so a
# member signing up is not gated behind an operational rank they do not need to
# run a station tour, and capacity, coverage and the calendar read the sheet as
# the ordinary open shift it is.
#
# What the seat is *for* — tour guide, educator, facilitator — is not stored
# here. It lives on `event_requests.staffing_roles` (what the day needs) and
# `shift_assignments.outreach_role` (what one member took), because
# `shift_assignments.position` is a MySQL ENUM whose labels are rewritten to
# the ShiftPosition values at every startup.
OUTREACH_SEAT_POSITION = "volunteer"
# Distinguishes an outreach signup sheet from a duty shift at a glance on the
# calendar. Amber, matching the outreach badge on the requests board.
_OUTREACH_SHIFT_COLOR = "#b45309"


def get_outreach_roles(org: Optional[Organization]) -> list[dict[str, str]]:
    """Read the department's outreach role vocabulary, falling back to defaults."""
    defaults = _event_settings_defaults()["outreach_roles"]
    if org is None:
        return list(defaults)
    settings = (org.settings or {}).get("events", {})
    return settings.get("outreach_roles", defaults)


def outreach_role_label(org: Optional[Organization], role: Optional[str]) -> str:
    """The department's label for a role, or a humanized fallback."""
    return role_label(get_outreach_roles(org), role)


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


def build_staffing_positions(seat_count: int) -> list[dict]:
    """Build the canonical seat list backing an outreach signup sheet."""
    return [
        {"position": OUTREACH_SEAT_POSITION, "required": True}
        for _ in range(seat_count)
    ]


def validate_staffing_roles(
    org: Optional[Organization], roles: Any
) -> list[dict[str, Any]]:
    """Normalize requested staffing roles and check them against the department's.

    Raises ``ValueError`` for a role the department has not configured: a
    sheet asking for a "Puppeteer" nobody can select is a seat that never
    fills, and silently dropping it would understate what the day needs.
    """
    normalized = normalize_staffing_roles(roles)
    if not normalized:
        raise ValueError("Name at least one role you need help with.")

    known = {entry["value"] for entry in get_outreach_roles(org) if entry.get("value")}
    unknown = sorted({entry["role"] for entry in normalized} - known)
    if unknown:
        raise ValueError(f"Unknown outreach role(s): {', '.join(unknown)}")

    seats = sum(entry["count"] for entry in normalized)
    if seats > MAX_TOTAL_SEATS:
        raise ValueError(f"A signup sheet holds at most {MAX_TOTAL_SEATS} people.")
    return normalized


async def open_staffing_shift(
    db: AsyncSession,
    event_request: EventRequest,
    org: Optional[Organization],
    staffing_roles: Any,
    actor_id: str,
    notes: Optional[str] = None,
):
    """Create the shift members sign up on to cover a scheduled request.

    Returns ``(shift, error)``. The shift is ``open_to_all_members`` so the
    eligibility service returns its seats to every member — an outreach event
    is staffed by whoever can come, not by operational rank — and self-signup
    capacity is what caps it at the number of seats requested.

    ``staffing_roles`` says what the day needs by job ("2 tour guides, 1
    educator"). It is stored on the request; the shift gets one plain
    ``volunteer`` seat per person so every operational reader still
    understands it.
    """
    from app.services.scheduling_service import SchedulingService

    if not event_request.event_date:
        return None, "Confirm a date before opening volunteer signups."

    try:
        roles = validate_staffing_roles(org, staffing_roles)
    except ValueError as e:
        return None, str(e)
    seat_count = sum(entry["count"] for entry in roles)

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
    note_lines.append("Roles needed: " + describe_roles(org, roles))
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
            "positions": build_staffing_positions(seat_count),
            "min_staffing": seat_count,
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
    event_request.staffing_roles = roles
    db.add(
        EventRequestActivity(
            request_id=event_request.id,
            action="staffing_opened",
            notes=f"Opened volunteer signups — {describe_roles(org, roles)}",
            details={
                "shift_id": shift.id,
                "staffing_roles": roles,
                "seat_count": seat_count,
            },
            performed_by=actor_id,
        )
    )
    return shift, None


def describe_roles(org: Optional[Organization], roles: Any) -> str:
    """Render staffing needs for a human: "2 x Tour Guide, 1 x Educator"."""
    labels = get_outreach_roles(org)
    return ", ".join(
        f"{entry['count']} x {role_label(labels, entry['role'])}"
        for entry in normalize_staffing_roles(roles)
    )


async def get_staffing_state(
    db: AsyncSession,
    event_request: EventRequest,
    org: Optional[Organization] = None,
) -> dict[str, Any]:
    """Who has signed up to cover this request, and which roles are still open."""
    from app.models.training import AssignmentStatus, ShiftAssignment

    empty = {
        "shift_id": None,
        "shift_date": None,
        "slots_total": 0,
        "slots_filled": 0,
        "roles": [],
        "volunteers": [],
        "volunteer_call_sent_at": event_request.volunteer_call_sent_at,
    }
    if not event_request.staffing_shift_id:
        return empty

    # A cancelled sheet is reported as absent, the same rule
    # `open_request_staffing` and `sync_staffing_shift_date` apply. The read has
    # to agree with them or the write is unreachable: `EventRequestsTab` offers
    # "Open Signups" only while `shift_id` is null and otherwise renders the
    # sheet, so a non-null id for a cancelled shift left the coordinator looking
    # at a stood-down sheet with no way to open a replacement.
    #
    # A deleted shift answers "no sheet" for the same reason — the FK is SET
    # NULL so it is only reachable in-flight, but answering beats raising at the
    # coordinator.
    shift = await get_live_staffing_shift(db, event_request)
    if shift is None:
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

    configured = get_outreach_roles(org)
    volunteers = []
    filled_by_role: dict[str, int] = {}
    for assignment, member in rows.all():
        position = assignment.position
        status_value = assignment.assignment_status
        role = assignment.outreach_role
        if role:
            filled_by_role[role] = filled_by_role.get(role, 0) + 1
        volunteers.append(
            {
                "user_id": assignment.user_id,
                "member_name": f"{member.first_name} {member.last_name}".strip(),
                "position": getattr(position, "value", str(position)),
                "outreach_role": role,
                "outreach_role_label": role_label(configured, role),
                "status": getattr(status_value, "value", str(status_value)),
                "assigned_at": assignment.created_at,
            }
        )

    needed = normalize_staffing_roles(event_request.staffing_roles)
    roles = [
        {
            "role": entry["role"],
            "label": role_label(configured, entry["role"]),
            "total": entry["count"],
            "filled": min(filled_by_role.get(entry["role"], 0), entry["count"]),
            "remaining": max(entry["count"] - filled_by_role.get(entry["role"], 0), 0),
        }
        for entry in needed
    ]
    # A role somebody holds that the sheet no longer asks for — the composition
    # was edited, or the role was dropped from settings after they signed up.
    # Reported with a total of zero rather than hidden, so the coordinator can
    # see the person is still coming and doing something.
    for role_value, count in filled_by_role.items():
        if any(entry["role"] == role_value for entry in needed):
            continue
        roles.append(
            {
                "role": role_value,
                "label": role_label(configured, role_value),
                "total": 0,
                "filled": count,
                "remaining": 0,
            }
        )

    positions = shift.positions if isinstance(shift.positions, list) else []
    return {
        "shift_id": shift.id,
        "shift_date": shift.start_time,
        "slots_total": len(positions),
        "slots_filled": len(volunteers),
        "roles": roles,
        "volunteers": volunteers,
        "volunteer_call_sent_at": event_request.volunteer_call_sent_at,
    }


async def _roles_still_needed(
    db: AsyncSession,
    event_request: EventRequest,
    org: Optional[Organization],
) -> str:
    """The unfilled roles on this request's sheet, rendered for an email.

    Empty when no sheet has been opened, and when every seat is already
    taken — a call for help that lists nothing still needed reads as a mistake.
    """
    if not event_request.staffing_shift_id:
        return describe_roles(org, event_request.staffing_roles)
    state = await get_staffing_state(db, event_request, org)
    labels = get_outreach_roles(org)
    return ", ".join(
        f"{entry['remaining']} x {role_label(labels, entry['role'])}"
        for entry in state["roles"]
        if entry["remaining"] > 0
    )


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
    # What we are asking of them, in the words a member can picture themselves
    # doing. "We need two people" tells them nothing; "2 x Tour Guide, 1 x
    # Educator" tells them whether it is a job they can do.
    still_needed = await _roles_still_needed(db, event_request, org)
    if still_needed:
        detail_rows.append(("Roles needed", still_needed))
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


async def resolve_outreach_signup_role(
    db: AsyncSession,
    shift: Any,
    requested_role: Optional[str],
    organization_id: str,
) -> str:
    """Check a member's chosen role against the sheet, or explain why not.

    Raises ``ValueError`` — the caller turns it into a 400. The role is
    required on an outreach shift and validated against the *request's*
    staffing needs rather than the department's whole vocabulary: the sheet
    asked for two tour guides and an educator, and a member taking a fourth
    seat as something nobody asked for leaves a real role unfilled.
    """
    from app.models.training import AssignmentStatus, ShiftAssignment

    # FOR UPDATE: the count below and the insert the caller makes afterwards
    # are a read-then-write. Two members claiming the last Educator seat at the
    # same time both read "0 taken" and both get in, which overfills that role
    # and — because the shift's generic capacity is shared across roles — can
    # leave another role with no seat left to fill. Serializing on the request
    # row makes the pair atomic; every claim for one sheet contends on one row.
    event_request = await db.scalar(
        select(EventRequest)
        .where(
            EventRequest.staffing_shift_id == str(shift.id),
            EventRequest.organization_id == str(organization_id),
        )
        .with_for_update()
    )
    needed = normalize_staffing_roles(
        event_request.staffing_roles if event_request else None
    )
    if not needed:
        # A sheet opened before roles existed, or whose request has since been
        # unlinked. Those seats are plain volunteer seats and the generic
        # capacity check already covers them.
        return ""

    org = await db.scalar(
        select(Organization).where(Organization.id == str(organization_id))
    )
    wanted = {entry["role"]: entry["count"] for entry in needed}
    labels = get_outreach_roles(org)

    if not requested_role:
        options = ", ".join(role_label(labels, name) for name in wanted)
        raise ValueError(f"Choose what you would like to do: {options}.")
    if requested_role not in wanted:
        raise ValueError(
            f"{role_label(labels, requested_role)} is not one of the roles "
            f"needed for this event."
        )

    taken = (
        await db.execute(
            select(func.count())
            .select_from(ShiftAssignment)
            .where(
                ShiftAssignment.shift_id == str(shift.id),
                ShiftAssignment.organization_id == str(organization_id),
                ShiftAssignment.outreach_role == requested_role,
                ShiftAssignment.assignment_status.notin_(
                    [AssignmentStatus.CANCELLED, AssignmentStatus.DECLINED]
                ),
            )
            # Locking read. The request row lock above serializes the decision
            # but leaves this transaction's REPEATABLE READ snapshot in place,
            # so a plain count would still report the seats as they stood
            # before the volunteer who beat us to one committed.
            .with_for_update()
        )
    ).scalar() or 0
    if taken >= wanted[requested_role]:
        raise ValueError(
            f"The last {role_label(labels, requested_role)} seat was just claimed."
        )
    return requested_role


async def sync_staffing_shift_cancelled(
    db: AsyncSession,
    event_request: EventRequest,
    actor_id: Optional[str],
    reason: Optional[str] = None,
) -> None:
    """Cancel the signup sheet when its request is called off.

    Without this the shift stays on the schedule at its original time and keeps
    taking signups, so members can turn out for an event that no longer exists.
    ``cancel_shift`` also cancels the existing assignments and tells the crew,
    which is the part that matters to somebody who already volunteered.

    Never raises into the caller: the request has already been cancelled, and
    failing that write to report a scheduling problem would leave the pipeline
    in a worse state than the stale shift does.
    """
    if not event_request.staffing_shift_id:
        return
    from app.services.scheduling_service import SchedulingService

    try:
        _shift, error = await SchedulingService(db).cancel_shift(
            event_request.staffing_shift_id,
            event_request.organization_id,
            cancelled_by_user_id=actor_id,
            reason=reason or "The outreach event this covered was cancelled.",
        )
        if error:
            logger.warning(
                "Could not cancel staffing shift {} for request {}: {}",
                event_request.staffing_shift_id,
                event_request.id,
                error,
            )
            return
        db.add(
            EventRequestActivity(
                request_id=event_request.id,
                action="staffing_cancelled",
                notes="Cancelled the volunteer signup sheet and told the crew",
                details={"shift_id": event_request.staffing_shift_id},
                performed_by=actor_id,
            )
        )
    except Exception as e:
        logger.warning(
            "Could not cancel staffing shift {} for request {}: {}",
            event_request.staffing_shift_id,
            event_request.id,
            e,
        )


async def get_live_staffing_shift(
    db: AsyncSession, event_request: EventRequest
) -> Optional[Any]:
    """The signup sheet this request is linked to, when it is still standing.

    A **cancelled** sheet is reported as absent, for the same reason
    ``schedule_request`` treats a cancelled calendar entry as absent: its
    assignments were cancelled and the crew told, and members can no longer see
    or join it. Reporting it as present is what tied a rescheduled request to a
    sheet nobody could sign up for — ``sync_staffing_shift_date`` moved the
    cancelled shift's dates without restoring its status, and
    ``open_request_staffing`` then refused to open a replacement because the
    link was non-null.
    """
    if not event_request.staffing_shift_id:
        return None
    from app.models.training import Shift, ShiftStatus

    shift = await db.scalar(
        select(Shift).where(
            Shift.id == event_request.staffing_shift_id,
            Shift.organization_id == str(event_request.organization_id),
        )
    )
    if shift is None or shift.status == ShiftStatus.CANCELLED:
        return None
    return shift


async def sync_staffing_shift_date(
    db: AsyncSession,
    event_request: EventRequest,
    org: Optional[Organization],
    actor_id: Optional[str],
) -> None:
    """Move the signup sheet when its request's confirmed date changes.

    A postponed-and-rescheduled request whose shift stayed put is worse than no
    sheet at all: the crew that signed up is booked for the old time and the new
    one has nobody. Members keep their seats — the event moved, not the roster.

    A sheet that was stood down is left alone: moving a cancelled shift's dates
    would not bring it or its assignments back, and the coordinator opens a
    fresh one instead.
    """
    if not event_request.staffing_shift_id or not event_request.event_date:
        return

    try:
        shift = await get_live_staffing_shift(db, event_request)
        if shift is None or shift.is_finalized:
            return

        tz = _org_timezone(org)
        start = event_request.event_date
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        end = event_request.event_end_date or (start + timedelta(hours=2))
        if end.tzinfo is None:
            end = end.replace(tzinfo=timezone.utc)

        if shift.start_time == start and shift.end_time == end:
            return

        shift.shift_date = start.astimezone(tz).date()
        shift.start_time = start
        shift.end_time = end
        db.add(
            EventRequestActivity(
                request_id=event_request.id,
                action="staffing_rescheduled",
                notes="Moved the volunteer signup sheet to the new date",
                details={
                    "shift_id": event_request.staffing_shift_id,
                    "start_time": start.isoformat(),
                },
                performed_by=actor_id,
            )
        )
    except Exception as e:
        logger.warning(
            "Could not move staffing shift {} for request {}: {}",
            event_request.staffing_shift_id,
            event_request.id,
            e,
        )


# ============================================
# Calendar event — the tie-in to the events module
# ============================================


async def get_linked_calendar_event(
    db: AsyncSession, event_request: EventRequest
) -> Optional[Any]:
    """The calendar Event this request is linked to, if there is one.

    Returned whatever its state; a caller that needs a *live* entry checks
    ``is_cancelled`` itself, because "there is no entry" and "the entry was
    stood down" lead to different decisions at every call site.

    Org-scoped even though the id was stored by this pipeline: a request row
    edited by any other path must not be able to reach another department's
    event through the link (CLAUDE.md pitfall #14a).
    """
    if not event_request.event_id:
        return None
    from app.models.event import Event

    return await db.scalar(
        select(Event).where(
            Event.id == str(event_request.event_id),
            Event.organization_id == str(event_request.organization_id),
        )
    )


def resolve_confirmed_end(
    start: datetime,
    explicit_end: Optional[datetime],
    existing_event: Optional[Any],
    org: Optional[Organization],
) -> datetime:
    """The confirmed end for a date the coordinator just set.

    Four surfaces read a request's end — the calendar entry, the volunteer
    signup sheet, the reminder emails and the public status page — and three of
    them have their own fallback when the request carries none:
    ``open_staffing_shift`` and ``sync_staffing_shift_date`` assume two hours,
    ``sync_calendar_event_date`` preserves the linked event's own span. Left to
    themselves they answer differently for the same outreach event, so every
    path that sets a confirmed date resolves the end **here** and stores it,
    making the request the one authority (CLAUDE.md pitfall #29).

    Precedence: what the coordinator typed, then the length the linked calendar
    entry already had, then the department's default event length.
    """
    if explicit_end:
        return explicit_end
    if existing_event is not None and not getattr(
        existing_event, "is_cancelled", False
    ):
        span = existing_event.end_datetime - existing_event.start_datetime
        if span > timedelta(0):
            return start + span
    return start + timedelta(minutes=event_duration_minutes(org))


async def sync_calendar_event_date(
    db: AsyncSession,
    event_request: EventRequest,
    actor_id: Optional[str],
    location_id: Optional[str] = None,
) -> Optional[str]:
    """Move the calendar event when its request's confirmed date changes.

    ``schedule_request`` puts the outreach event on the department calendar and
    nothing moved it afterwards, so a request postponed and rescheduled left the
    crew reading the old date off the calendar while the pipeline, the requester's
    email and the staffing shift all carried the new one. The calendar is the
    surface most members actually look at, which makes it the worst of the four
    to leave stale.

    Never raises into the caller, for the same reason ``sync_staffing_shift_date``
    does not: the request has already been rescheduled, and failing that write to
    report a calendar problem leaves the pipeline in a worse state than the stale
    entry does.

    **Returns a reason string when the move was refused for a reason the
    coordinator can act on**, and ``None`` when it moved or there was nothing to
    move. ``EventService.update_event`` raises ``ValueError`` for a room
    double-booking and for a finalized event — decisions, not faults — and
    swallowing those as a log line is what let a postponement commit a new date,
    move the signup sheet, and report success while the calendar stayed where it
    was. An infrastructure failure is still only logged; a caller that can turn a
    refusal into a 409 should.
    """
    if not event_request.event_id or not event_request.event_date:
        return None
    from uuid import UUID

    from app.schemas.event import EventUpdate
    from app.services.event_service import EventService

    try:
        event = await get_linked_calendar_event(db, event_request)
        if event is None or event.is_cancelled:
            return None

        start = event_request.event_date
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        end = event_request.event_end_date
        if end is None:
            # The coordinator set this entry's length once; moving it to another
            # date is not a reason to change it. `EventUpdate` refuses an end at
            # or before the start, so a degenerate stored window (which the
            # pre-2026-09-09 create path could produce) falls back to the
            # shipped default length rather than failing the move — the
            # organization is not loaded on this path, and a fallback for a
            # window that should not exist does not justify a query for it.
            span = event.end_datetime - event.start_datetime
            if span <= timedelta(0):
                span = timedelta(minutes=event_duration_minutes(None))
            end = start + span
        if end.tzinfo is None:
            end = end.replace(tzinfo=timezone.utc)

        # A room the coordinator picked on this save counts as a change even
        # when the times did not move: `schedule_request` stores the new
        # `event_location_id` on the request before reaching here, so returning
        # early would leave the request and its activity row naming one room
        # and the calendar entry still sitting in the old one.
        room_move = bool(location_id) and str(
            getattr(event, "location_id", None) or ""
        ) != str(location_id)
        if (
            event.start_datetime == start
            and event.end_datetime == end
            and not room_move
        ):
            return None

        # Built before the try below, not inside it: argument evaluation
        # counts as being in the block, so a malformed id would raise the same
        # ValueError the room-conflict handler is looking for and be reported
        # to the coordinator as a conflict they could act on.
        event_uuid = UUID(str(event_request.event_id))
        org_uuid = UUID(str(event_request.organization_id))
        actor_uuid = UUID(actor_id) if actor_id else None
        update_fields: dict = {"start_datetime": start, "end_datetime": end}
        # Omitted rather than sent as None when the caller named no room: an
        # update payload's absent key means "leave this alone" (CLAUDE.md
        # pitfall #1), and a postponement must not clear the room the entry
        # already had.
        if location_id:
            update_fields["location_id"] = str(location_id)
        try:
            await EventService(db).update_event(
                event_id=event_uuid,
                organization_id=org_uuid,
                event_data=EventUpdate(**update_fields),
                updated_by=actor_uuid,
            )
        except ValueError as refusal:
            # Scoped to this call on purpose. A blanket `except ValueError`
            # around the whole body would also catch, say, a malformed id from
            # `UUID(...)` and report an internal fault to the coordinator as a
            # room conflict they could act on.
            logger.info(
                "Calendar event {} refused the move for request {}: {}",
                event_request.event_id,
                event_request.id,
                refusal,
            )
            return str(refusal)
        db.add(
            EventRequestActivity(
                request_id=event_request.id,
                action="calendar_event_rescheduled",
                notes=(
                    "Moved the calendar event to the new room"
                    if room_move and event.start_datetime == start
                    else "Moved the calendar event to the new date"
                ),
                details={
                    "event_id": str(event_request.event_id),
                    "start_datetime": start.isoformat(),
                    "location_id": str(location_id) if location_id else None,
                },
                performed_by=actor_id,
            )
        )
        return None
    except Exception as e:
        logger.warning(
            "Could not move calendar event {} for request {}: {}",
            event_request.event_id,
            event_request.id,
            e,
        )
        return None


async def sync_calendar_event_cancelled(
    db: AsyncSession,
    event_request: EventRequest,
    actor_id: Optional[str],
    reason: Optional[str] = None,
) -> None:
    """Cancel the calendar event when its request is called off or loses its date.

    Declining, cancelling, or postponing to a date TBD already stands the
    staffing shift down; the calendar entry stayed, so the department kept an
    outreach event on its schedule for something nobody was running. The link is
    deliberately left in place afterwards — a coordinator asking "what happened
    to that school visit" is served by the cancelled event and its reason, not by
    a dangling reference to nothing.

    Never raises into the caller, matching ``sync_staffing_shift_cancelled``.
    """
    if not event_request.event_id:
        return
    from uuid import UUID

    from app.services.event_service import EventService

    try:
        event = await get_linked_calendar_event(db, event_request)
        if event is None or event.is_cancelled:
            return

        await EventService(db).cancel_event(
            event_id=UUID(str(event_request.event_id)),
            organization_id=UUID(str(event_request.organization_id)),
            reason=reason or "The outreach event this covered was cancelled.",
            send_notifications=True,
        )
        db.add(
            EventRequestActivity(
                request_id=event_request.id,
                action="calendar_event_cancelled",
                notes="Cancelled the calendar event",
                details={"event_id": str(event_request.event_id)},
                performed_by=actor_id,
            )
        )
    except Exception as e:
        # An event whose attendance is already finalized refuses cancellation —
        # it happened and credited hours. Leaving it standing is correct there.
        logger.warning(
            "Could not cancel calendar event {} for request {}: {}",
            event_request.event_id,
            event_request.id,
            e,
        )
