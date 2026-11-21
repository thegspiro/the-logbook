"""Who a coordinator's "email the members" goes to.

Two senders share this: the apparatus-event open-seat email and the public
request pipeline's volunteer call. Both let the coordinator narrow the
membership by three independent filters:

- **member class** (operational / administrative / social)
- **membership status** (probationary, regular, life ... and the department's
  own tiers, which ``member_status`` also stores)
- **positions** held

Within one filter any match counts (Regular *or* Life); across filters every
filter must match (Regular *and* Lieutenant). An empty filter does not narrow.

Whatever the filters say, only current members are emailed
(``ACTIVE_ACCOUNT_STATUSES``, pitfall #32), only those with an address, and
only those whose Volunteer calls preference lets the email through — the owner
chose to reuse that preference rather than add a new one (2026-11-20).

Class and status are read the way the rest of the app reads them, not off the
raw columns: a row written before ``member_class`` / ``member_status`` existed
still carries both fused into ``membership_type``, and a member with nothing
recorded stands on the regular rung (``tier_for_member``). Filtering the raw
columns in SQL would silently drop exactly those members.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable, List, Optional, Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.user import ACTIVE_ACCOUNT_STATUSES, Position, User
from app.services.email_policy import (
    EmailKind,
    department_required_kinds,
    member_receives_email,
)
from app.utils.membership import (
    MemberClass,
    MemberStatus,
    canonical_member_status,
    configured_tiers,
    effective_member_class,
    member_standing,
)

# Prospects live in their own table and never hold an account, so offering
# "prospective" would always match nobody.
_OFFERED_STATUSES = tuple(s for s in MemberStatus.ALL if s != MemberStatus.PROSPECTIVE)


@dataclass(frozen=True)
class AudienceFilter:
    """The coordinator's choice. Empty lists mean "do not narrow by this"."""

    member_classes: Sequence[str] = ()
    member_statuses: Sequence[str] = ()
    position_ids: Sequence[str] = ()
    # The request pipeline's original filter on the legacy combined field,
    # kept so callers of its API keep working.
    legacy_membership_types: Sequence[str] = ()

    def as_record(self) -> dict[str, list[str]]:
        """The filter as stored beside a send, for the audit trail."""
        record = {
            "member_classes": list(self.member_classes),
            "member_statuses": list(self.member_statuses),
            "position_ids": list(self.position_ids),
        }
        if self.legacy_membership_types:
            record["membership_types"] = list(self.legacy_membership_types)
        return record


@dataclass
class Audience:
    """The resolved recipients."""

    emails: List[str] = field(default_factory=list)
    skipped_opted_out: int = 0


def _clean(values: Iterable[Any]) -> set[str]:
    return {str(v).strip().lower() for v in values if str(v or "").strip()}


async def validate_filter(
    db: AsyncSession, organization_id: str, audience: AudienceFilter
) -> None:
    """Refuse a filter naming a class, or a position, the department lacks.

    Statuses are not checked against a fixed list: ``member_status`` holds the
    department's own tier ids too, and an unknown one simply matches nobody.
    """
    unknown_classes = _clean(audience.member_classes) - set(MemberClass.ALL)
    if unknown_classes:
        raise ValueError("Choose member classes from the list.")
    wanted = {str(p) for p in audience.position_ids if p}
    if wanted:
        found = (
            (
                await db.execute(
                    select(Position.id).where(
                        Position.organization_id == organization_id,
                        Position.id.in_(wanted),
                    )
                )
            )
            .scalars()
            .all()
        )
        if set(found) != wanted:
            raise ValueError("One of the chosen positions is not in this department.")


async def resolve_audience(
    db: AsyncSession,
    organization: Any,
    organization_id: str,
    audience: AudienceFilter,
) -> Audience:
    """The members a send with *audience* reaches, and how many opted out."""
    await validate_filter(db, organization_id, audience)

    query = (
        select(User)
        .where(
            User.organization_id == organization_id,
            User.status.in_(ACTIVE_ACCOUNT_STATUSES),
            User.deleted_at.is_(None),
            User.email.isnot(None),
        )
        .options(selectinload(User.positions))
    )
    legacy = _clean(audience.legacy_membership_types)
    if legacy:
        query = query.where(User.membership_type.in_(legacy))
    members = (await db.execute(query)).scalars().all()

    classes = _clean(audience.member_classes)
    statuses = {canonical_member_status(s) for s in audience.member_statuses}
    statuses.discard(None)
    positions = {str(p) for p in audience.position_ids if p}
    required = department_required_kinds(organization)

    result = Audience()
    seen: set[str] = set()
    for member in members:
        email = (member.email or "").strip()
        if not email:
            continue
        if classes and (
            effective_member_class(member.member_class, member.membership_type)
            not in classes
        ):
            continue
        if statuses and (
            canonical_member_status(member_standing(member) or MemberStatus.REGULAR)
            not in statuses
        ):
            continue
        if positions and not positions.intersection(
            str(p.id) for p in member.positions
        ):
            continue
        if not member_receives_email(
            member.notification_preferences, EmailKind.VOLUNTEER_CALLS, required
        ):
            result.skipped_opted_out += 1
            continue
        key = email.lower()
        if key in seen:
            continue
        seen.add(key)
        result.emails.append(email)
    return result


async def audience_options(
    db: AsyncSession, organization: Any, organization_id: str
) -> dict[str, Any]:
    """What the picker offers: classes, statuses (with the department's own
    tiers), and positions."""
    statuses: list[dict[str, Optional[str]]] = [
        {"value": s, "label": None} for s in _OFFERED_STATUSES
    ]
    offered = set(_OFFERED_STATUSES)
    for tier in configured_tiers(getattr(organization, "settings", None)):
        value = canonical_member_status(tier.get("id"))
        if not value or value in offered:
            continue
        offered.add(value)
        name = tier.get("name")
        statuses.append(
            {"value": value, "label": name if isinstance(name, str) else value}
        )

    rows = (
        await db.execute(
            select(Position.id, Position.name)
            .where(Position.organization_id == organization_id)
            .order_by(Position.name)
        )
    ).all()
    return {
        "member_classes": list(MemberClass.ALL),
        "member_statuses": statuses,
        "positions": [{"id": str(pid), "name": name} for pid, name in rows],
    }
