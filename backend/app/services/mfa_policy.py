"""Who must use MFA, and when the grace period for them ends.

Separate from the org-wide ``security.mfa_required`` switch, which stays: this
adds a floor for the members whose accounts can change security settings or
read health records, whatever the organization chose for everyone else.

The privileged set is a list of permissions, not of positions, so it follows
role changes: grant someone ``audit.export`` and they are privileged from the
next request. Wildcards count (``*``, ``settings.*``), because a wildcard
holder can do everything the named permission can.
"""

from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional

from app.core.config import settings
from app.core.permissions import permission_matches

#: Permissions that make a member privileged. Chosen to cover administration
#: of accounts and security, and the health-record views, without reaching every
#: officer who merely manages a module. Deliberately absent: ``audit.view`` and
#: ``members.manage`` (held by captains, lieutenants and the treasurer in the
#: seeded positions) and the inventory medical permissions (item and drug
#: expiry only, no patient data). ``tests/test_mfa_policy.py`` pins which
#: seeded positions land in the set.
PRIVILEGED_PERMISSIONS: tuple[str, ...] = (
    "*",
    "settings.manage",
    "security.manage",
    "integrations.manage",
    "users.create",
    "users.edit",
    "users.delete",
    "users.update_positions",
    "audit.export",
    "audit.manage",
    "medical_screening.view",
    "medical_screening.manage",
)


def is_privileged(user_permissions: Iterable[str]) -> bool:
    """Whether a member holding ``user_permissions`` must use MFA."""
    granted = set(user_permissions)
    return any(permission_matches(p, granted) for p in PRIVILEGED_PERMISSIONS)


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def grace_ends_at(started_at: datetime) -> datetime:
    """When the grace period that began at ``started_at`` runs out."""
    return _as_utc(started_at) + timedelta(days=settings.MFA_GRACE_DAYS)


def grace_expired(started_at: Optional[datetime], now: datetime) -> bool:
    """True once the grace period is over.

    An unstarted clock (``None``) is not expired: the caller is about to start
    it, and treating "never seen" as "out of time" would lock a member out on
    the first request after an upgrade.
    """
    if started_at is None:
        return settings.MFA_GRACE_DAYS == 0
    return now >= grace_ends_at(started_at)
