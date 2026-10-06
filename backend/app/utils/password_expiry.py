"""
When a member's password expires, and when that starts to refuse requests.

``HIPAA_MAXIMUM_PASSWORD_AGE_DAYS`` used to be enforced only by the browser,
which routes an expired member to the change-password screen; an API client
got a full session regardless (security review AUTH-15). The server now
refuses such a client too, but not from the moment the password expired: on
an installation that never enforced this, every member past the age would be
locked out on the day it deployed, administrators included. The grace clock
starts when the member is first told — by the daily notice, or by the first
authenticated request after expiry, whichever comes first — and the gate
closes ``HIPAA_PASSWORD_EXPIRY_GRACE_DAYS`` after that.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from app.core.config import settings


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def password_expires_at(user: Any) -> datetime | None:
    """When the member's password expires, or ``None`` if it never does.

    ``None`` when the age limit is off, and for an account with no recorded
    change (an OAuth-only member has no password to age).
    """
    max_age_days = settings.HIPAA_MAXIMUM_PASSWORD_AGE_DAYS
    changed = getattr(user, "password_changed_at", None)
    if max_age_days <= 0 or changed is None:
        return None
    return _aware(changed) + timedelta(days=max_age_days)


def is_password_expired(user: Any, now: datetime | None = None) -> bool:
    expires = password_expires_at(user)
    return expires is not None and (now or datetime.now(timezone.utc)) >= expires


def password_change_deadline(user: Any) -> datetime | None:
    """When an expired password stops being accepted, once the member was told."""
    notified = getattr(user, "password_expiry_notified_at", None)
    if notified is None or password_expires_at(user) is None:
        return None
    return _aware(notified) + timedelta(days=settings.HIPAA_PASSWORD_EXPIRY_GRACE_DAYS)


def is_past_grace(user: Any, now: datetime | None = None) -> bool:
    """Whether an expired password must now be changed before anything else."""
    now = now or datetime.now(timezone.utc)
    if not is_password_expired(user, now):
        return False
    deadline = password_change_deadline(user)
    return deadline is not None and now >= deadline
