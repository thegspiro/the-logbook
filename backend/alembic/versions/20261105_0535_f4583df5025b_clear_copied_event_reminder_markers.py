"""Clear reminder and validation markers a series save copied

Before 2026-10-04 a "This and all future events" save wrote the edited
occurrence's ``custom_fields.reminders_sent`` and
``custom_fields.validation_notification_sent`` onto every later occurrence of
the series. The save no longer does that (``EventService.
_with_own_lifecycle_markers`` keeps each row's own markers), but rows it had
already reached keep the copies, and each copy makes ``run_event_reminders`` or
``run_post_event_validation`` skip a notice that never went out. The owner
decided on 2026-11-01 to clear them with a migration, telling a copied marker
from a sent one by each row's own schedule.

**The rule.** Only rows in a recurring series are examined — a series parent
(``is_recurring``) or an occurrence (``recurrence_parent_id``) — because a
series save is the only thing that copied markers. On such a row:

- an interval ``h`` in ``reminders_sent`` is removed when the moment
  ``run_event_reminders`` would first send it for **this row's** start is still
  in the future. That task stamps an interval only once ``now`` has passed that
  moment, so for the row's current schedule the marker cannot be its own. The
  moment is computed the way the task computes it: ``h`` hours before the start
  for ``h < 24``; otherwise the department's ``default_reminder_time`` (default
  12:00) on the day ``h // 24`` days before the start, in the department's
  timezone (default America/New_York).
- ``validation_notification_sent`` is removed when the event has not ended:
  ``run_post_event_validation`` only looks at events whose end has passed.

**Never a reminder twice (CLAUDE.md Pitfall #36).** A marker whose moment is
still ahead can also be genuine: the row was moved later after its notice went
out. So a row keeps all of its ``reminders_sent`` if any ``event_reminder``
notification was ever logged for that event, and keeps
``validation_notification_sent`` if any ``event_validation`` notification was.
An interval whose moment has passed is never touched, whether copied or not —
nothing here can tell the two apart, and the cost of leaving a copy is the
status quo (one skipped notice), while the cost of a wrong clear is a
duplicate. Markers that are not numbers are left alone, as is a row whose
``custom_fields`` is not a JSON object.

**Irreversible.** Downgrade does nothing: which markers were copies is not
recorded anywhere, and putting a copy back would only suppress a notice again.
Every other key in ``custom_fields`` is preserved; a ``reminders_sent`` left
empty is removed as a key, which ``run_event_reminders`` reads the same way.

Run with the application stopped, like any migration: the scheduled tasks
write the same column.

Revision ID: f4583df5025b
Revises: e429ae62992e
Create Date: 2026-11-05 05:35:52.416093

"""

import json
from datetime import datetime, time, timedelta, timezone
from typing import Any, Optional, Sequence, Union
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f4583df5025b"
down_revision: Union[str, None] = "e429ae62992e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Module-level so the migration test can point them at scratch tables.
_EVENTS = "events"
_ORGS = "organizations"
_LOGS = "notification_logs"

# Frozen copies of run_event_reminders' defaults: a migration must keep doing
# what it did the day it ran, whatever the task later changes to.
_DEFAULT_TZ = "America/New_York"
_DEFAULT_REMINDER_TIME = time(12, 0)


def _tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _as_utc(value: Any) -> Optional[datetime]:
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value)
        except ValueError:
            return None
    if not isinstance(value, datetime):
        return None
    # Stored as UTC; MySQL hands it back naive.
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _org_schedule(tz_name: Optional[str], raw_settings: Any) -> tuple[ZoneInfo, time]:
    """The department's reminder timezone and time of day, read as the task
    reads them, falling back the same way on anything malformed."""
    try:
        tz = ZoneInfo(tz_name or _DEFAULT_TZ)
    except Exception:
        tz = ZoneInfo(_DEFAULT_TZ)

    settings = raw_settings
    if isinstance(settings, str):
        try:
            settings = json.loads(settings)
        except ValueError:
            settings = None
    if not isinstance(settings, dict):
        settings = {}
    events = settings.get("events")
    defaults = events.get("defaults") if isinstance(events, dict) else None
    raw_time = (
        defaults.get("default_reminder_time", "12:00")
        if isinstance(defaults, dict)
        else "12:00"
    )
    try:
        parts = str(raw_time).split(":")
        at = time(int(parts[0]), int(parts[1]))
    except (ValueError, IndexError):
        at = _DEFAULT_REMINDER_TIME
    return tz, at


def _threshold(start: datetime, hours: float, tz: ZoneInfo, at: time) -> datetime:
    """When run_event_reminders first sends interval ``hours`` for ``start``."""
    start = start if start.tzinfo else start.replace(tzinfo=timezone.utc)
    if hours >= 24:
        days_before = int(hours // 24)
        reminder_date = (start.astimezone(tz) - timedelta(days=days_before)).date()
        local = datetime.combine(reminder_date, at, tzinfo=tz)
        return local.astimezone(timezone.utc)
    return start - timedelta(hours=hours)


def _is_interval(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _logged(conn, has_logs: bool, category: str, event_id: str) -> bool:
    if not has_logs:
        return False
    # The reminder's link was absolute in older releases and is relative now;
    # an event id is a UUID, which holds no LIKE wildcard.
    return (
        conn.execute(
            sa.text(
                f"SELECT 1 FROM {_LOGS} WHERE category = :cat "
                "AND action_url LIKE :url LIMIT 1"
            ),
            {"cat": category, "url": f"%/events/{event_id}"},
        ).first()
        is not None
    )


def upgrade() -> None:
    tables = _tables()
    if _EVENTS not in tables or _ORGS not in tables:
        return
    has_logs = _LOGS in tables

    conn = op.get_bind()
    now = datetime.now(timezone.utc)
    rows = conn.execute(
        sa.text(
            f"SELECT e.id, e.start_datetime, e.end_datetime, e.custom_fields, "
            f"o.timezone, o.settings FROM {_EVENTS} e "
            f"JOIN {_ORGS} o ON o.id = e.organization_id "
            "WHERE (e.recurrence_parent_id IS NOT NULL OR e.is_recurring = :yes) "
            "AND e.custom_fields IS NOT NULL AND e.end_datetime > :now"
        ).bindparams(sa.bindparam("now", type_=sa.DateTime())),
        # A naive UTC bound compares the same way on every dialect.
        {"yes": True, "now": now.replace(tzinfo=None)},
    ).fetchall()

    for event_id, start_raw, end_raw, custom_raw, tz_name, org_settings in rows:
        custom = custom_raw
        if isinstance(custom, str):
            try:
                custom = json.loads(custom)
            except ValueError:
                continue
        if not isinstance(custom, dict):
            continue
        start, end = _as_utc(start_raw), _as_utc(end_raw)
        if start is None or end is None:
            continue

        changed = False

        sent = custom.get("reminders_sent")
        if (
            isinstance(sent, list)
            and sent
            and not _logged(conn, has_logs, "event_reminder", event_id)
        ):
            tz, at = _org_schedule(tz_name, org_settings)
            kept = [
                h
                for h in sent
                if not (_is_interval(h) and _threshold(start, h, tz, at) > now)
            ]
            if kept != sent:
                changed = True
                if kept:
                    custom["reminders_sent"] = kept
                else:
                    custom.pop("reminders_sent")

        if (
            custom.get("validation_notification_sent")
            and end > now
            and not _logged(conn, has_logs, "event_validation", event_id)
        ):
            custom.pop("validation_notification_sent")
            changed = True

        if changed:
            conn.execute(
                sa.text(f"UPDATE {_EVENTS} SET custom_fields = :cf WHERE id = :id"),
                {"cf": json.dumps(custom), "id": event_id},
            )


def downgrade() -> None:
    """Irreversible data cleanup; see the module docstring.

    Which markers were copies is recorded nowhere, and restoring one would only
    suppress the notice it wrongly claimed was sent, so the rows are left as
    they are.
    """
    return
