"""
NFC Card Admin Service

The department-wide view behind the Member ID Cards page: which members have no
working card, which cards nobody uses, which are still held by people who have
left, the tap log, bulk status changes, and the tap-log retention setting.

Card issuing and the station itself stay in ``nfc_tag_service``; this module
only reads across the organization and drives that service's ``update_tag`` for
bulk changes, so every lifecycle rule (a lost card never comes back) applies to
a bulk change exactly as it does to a single one.
"""

import copy
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

from dateutil.relativedelta import relativedelta
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.location import Location
from app.models.nfc_tag import (
    NfcCardTap,
    NfcCheckInStatus,
    NfcTag,
    NfcTagStatus,
    NfcTapSource,
)
from app.models.user import ACTIVE_ACCOUNT_STATUSES, Organization, User
from app.services.nfc_card_status_sync import BLOCKED_MEMBER_STATUSES
from app.services.nfc_tag_service import NfcTagService
from app.utils.member_names import format_display_name
from app.utils.sql_results import rows_affected

SETTINGS_KEY = "nfc_id_cards"

# The owner's choice (2026-10-23): a department that never sets it keeps two
# years of taps, and may choose anywhere from a quarter to seven years.
DEFAULT_TAP_RETENTION_MONTHS = 24
MIN_TAP_RETENTION_MONTHS = 3
MAX_TAP_RETENTION_MONTHS = 84

DEFAULT_UNUSED_DAYS = 180

# One bulk request touches at most this many cards. A department retiring a
# whole batch of lost cards is well under it; it keeps one request from
# writing thousands of audit rows in a single transaction.
MAX_BULK_CARDS = 200

# Coverage lists and the CSV are capped so one request stays bounded on any
# roster. Each list reports its true total, so a capped list says so.
MAX_COVERAGE_ROWS = 1000
MAX_EXPORT_ROWS = 10000

# Short enough to read aloud ("unknown card 3f9a1c2b"), long enough that two
# strangers' cards will not share one in a department's lifetime.
_UNKNOWN_KEY_LENGTH = 8


def tap_retention_months_in(settings: Any) -> int:
    """The stored retention period, or the default for anything unusable.

    ``organization.settings`` is free-form JSON. A value that is missing, of
    the wrong type or out of range degrades to the default rather than
    raising, because this is read inside the nightly purge, and an exception
    there would skip the purge for the whole organization (Pitfall #19).
    """
    section = settings.get(SETTINGS_KEY) if isinstance(settings, dict) else None
    value = section.get("tap_retention_months") if isinstance(section, dict) else None
    if (
        isinstance(value, int)
        and not isinstance(value, bool)
        and MIN_TAP_RETENTION_MONTHS <= value <= MAX_TAP_RETENTION_MONTHS
    ):
        return value
    return DEFAULT_TAP_RETENTION_MONTHS


def _as_utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


class NfcCardAdminService:
    """Organization-wide ID card administration."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self._cards = NfcTagService(db)

    # =========================================================================
    # Coverage
    # =========================================================================

    async def coverage(
        self, organization_id: str, *, unused_days: int = DEFAULT_UNUSED_DAYS
    ) -> Dict[str, Any]:
        """Three lists an officer works through, plus the headline counts."""
        org_id = str(organization_id)

        has_active_card = (
            select(NfcTag.id)
            .where(
                NfcTag.organization_id == org_id,
                NfcTag.user_id == User.id,
                NfcTag.status == NfcTagStatus.ACTIVE,
            )
            .exists()
        )
        current_members = (
            User.organization_id == org_id,
            User.deleted_at.is_(None),
            User.status.in_(ACTIVE_ACCOUNT_STATUSES),
        )

        without_total = (
            await self.db.execute(
                select(func.count())
                .select_from(User)
                .where(*current_members, ~has_active_card)
            )
        ).scalar_one()
        without_rows = (
            await self.db.execute(
                select(
                    User.id,
                    User.first_name,
                    User.last_name,
                    User.preferred_name,
                    User.membership_number,
                    User.status,
                )
                .where(*current_members, ~has_active_card)
                .order_by(User.last_name, User.first_name)
                .limit(MAX_COVERAGE_ROWS)
            )
        ).all()
        members_without_card = [
            {
                "user_id": row.id,
                "member_name": format_display_name(
                    row.first_name, row.last_name, row.preferred_name
                ),
                "membership_number": row.membership_number,
                "member_status": row.status,
            }
            for row in without_rows
        ]

        current_member_total = (
            await self.db.execute(
                select(func.count()).select_from(User).where(*current_members)
            )
        ).scalar_one()

        # A card issued and never tapped counts as unused from its issue date,
        # so a card handed out yesterday is not reported the same day.
        cutoff = datetime.now(timezone.utc) - timedelta(days=unused_days)
        unused_filter = (
            NfcTag.organization_id == org_id,
            NfcTag.status == NfcTagStatus.ACTIVE,
            func.coalesce(NfcTag.last_used_at, NfcTag.issued_at) < cutoff,
        )
        unused_total, unused_cards = await self._card_list(unused_filter)

        # Non-terminal cards held by someone whose taps are refused anyway. The
        # automatic suspension covers status changes made after it shipped;
        # this catches whatever it could not — a deleted member, a card an
        # officer reactivated by hand.
        former_filter = (
            NfcTag.organization_id == org_id,
            NfcTag.status.in_([NfcTagStatus.ACTIVE, NfcTagStatus.SUSPENDED]),
            NfcTag.user_id.in_(
                select(User.id).where(
                    User.organization_id == org_id,
                    or_(
                        User.deleted_at.is_not(None),
                        User.status.in_(BLOCKED_MEMBER_STATUSES),
                    ),
                )
            ),
        )
        former_total, former_cards = await self._card_list(former_filter)

        status_counts = {
            row[0]: row[1]
            for row in (
                await self.db.execute(
                    select(NfcTag.status, func.count())
                    .where(NfcTag.organization_id == org_id)
                    .group_by(NfcTag.status)
                )
            ).all()
        }

        return {
            "unused_days": unused_days,
            "current_member_count": current_member_total,
            "card_counts": {
                status.value: status_counts.get(status, 0) for status in NfcTagStatus
            },
            "members_without_card": members_without_card,
            "members_without_card_total": without_total,
            "unused_cards": unused_cards,
            "unused_cards_total": unused_total,
            "former_member_cards": former_cards,
            "former_member_cards_total": former_total,
        }

    async def _card_list(
        self, filters: Sequence[Any]
    ) -> Tuple[int, List[Dict[str, Any]]]:
        total = (
            await self.db.execute(
                select(func.count()).select_from(NfcTag).where(*filters)
            )
        ).scalar_one()
        tags = list(
            (
                await self.db.execute(
                    select(NfcTag)
                    .where(*filters)
                    .order_by(
                        func.coalesce(NfcTag.last_used_at, NfcTag.issued_at).asc()
                    )
                    .limit(MAX_COVERAGE_ROWS)
                )
            )
            .scalars()
            .all()
        )
        if not tags:
            return total, []
        org_id = tags[0].organization_id
        names = await self._cards._name_map(
            org_id,
            {t.user_id for t in tags} | {t.issued_by for t in tags if t.issued_by},
        )
        statuses = dict(
            (
                await self.db.execute(
                    select(User.id, User.status).where(
                        User.organization_id == org_id,
                        User.id.in_({t.user_id for t in tags}),
                    )
                )
            ).all()
        )
        items = []
        for tag in tags:
            item = self._cards._to_dict(tag, names)
            item["member_status"] = statuses.get(tag.user_id)
            items.append(item)
        return total, items

    # =========================================================================
    # Tap log
    # =========================================================================

    async def list_taps(
        self,
        organization_id: str,
        *,
        tag_id: Optional[str] = None,
        user_id: Optional[str] = None,
        outcome: Optional[NfcCheckInStatus] = None,
        source: Optional[NfcTapSource] = None,
        since: Optional[datetime] = None,
        until: Optional[datetime] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> Tuple[List[Dict[str, Any]], int]:
        """Taps newest first, filtered, with names and card details attached.

        Every filter value is compared against rows already constrained to the
        caller's organization, so a tag or member id from another department
        simply matches nothing.
        """
        filters = [NfcCardTap.organization_id == str(organization_id)]
        if tag_id:
            filters.append(NfcCardTap.tag_id == str(tag_id))
        if user_id:
            filters.append(NfcCardTap.user_id == str(user_id))
        if outcome:
            filters.append(NfcCardTap.outcome == outcome)
        if source:
            filters.append(NfcCardTap.source == source)
        if since:
            filters.append(NfcCardTap.tapped_at >= _as_utc(since))
        if until:
            filters.append(NfcCardTap.tapped_at < _as_utc(until))

        total = (
            await self.db.execute(
                select(func.count()).select_from(NfcCardTap).where(*filters)
            )
        ).scalar_one()

        rows = (
            await self.db.execute(
                select(
                    NfcCardTap,
                    NfcTag.uid_preview,
                    NfcTag.label,
                    Location.name,
                )
                .outerjoin(
                    NfcTag,
                    (NfcTag.id == NfcCardTap.tag_id)
                    & (NfcTag.organization_id == NfcCardTap.organization_id),
                )
                .outerjoin(
                    Location,
                    (Location.id == NfcCardTap.location_id)
                    & (Location.organization_id == NfcCardTap.organization_id),
                )
                .where(*filters)
                .order_by(NfcCardTap.tapped_at.desc(), NfcCardTap.id.desc())
                .limit(limit)
                .offset(offset)
            )
        ).all()

        taps = [row[0] for row in rows]
        names = await self._cards._name_map(
            str(organization_id),
            {t.user_id for t in taps if t.user_id}
            | {t.operator_id for t in taps if t.operator_id},
        )
        items = []
        for tap, preview, label, location_name in rows:
            items.append(
                {
                    "id": tap.id,
                    "tapped_at": tap.tapped_at,
                    "outcome": tap.outcome,
                    "source": tap.source,
                    "tag_id": tap.tag_id,
                    "card_uid_preview": preview,
                    "card_label": label,
                    "unknown_card_key": (
                        tap.unknown_uid_hash[:_UNKNOWN_KEY_LENGTH]
                        if tap.unknown_uid_hash
                        else None
                    ),
                    "user_id": tap.user_id,
                    "member_name": names.get(tap.user_id) if tap.user_id else None,
                    "location_id": tap.location_id,
                    "location_name": location_name,
                    "operator_id": tap.operator_id,
                    "operator_name": (
                        names.get(tap.operator_id) if tap.operator_id else None
                    ),
                    "target_type": tap.target_type,
                    "target_id": tap.target_id,
                    "target_name": tap.target_name,
                }
            )
        return items, total

    # =========================================================================
    # Bulk status
    # =========================================================================

    async def bulk_update_status(
        self,
        organization_id: str,
        tag_ids: Sequence[str],
        status: NfcTagStatus,
        revoked_reason: Optional[str],
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, str]]]:
        """Apply one status to many cards, card by card.

        A card the rules refuse (a lost card being reactivated, an id that is
        not this organization's) is reported and skipped; the rest still
        change. ``update_tag`` raises before it modifies anything, so a refused
        card leaves nothing half-written in the shared transaction.
        """
        updated: List[Dict[str, Any]] = []
        failed: List[Dict[str, str]] = []
        updates: Dict[str, Any] = {"status": status, "revoked_reason": revoked_reason}
        for tag_id in dict.fromkeys(str(t) for t in tag_ids):
            try:
                card = await self._cards.update_tag(
                    tag_id, str(organization_id), dict(updates)
                )
            except ValueError as e:
                failed.append({"id": tag_id, "detail": str(e)})
                continue
            updated.append(card)
        return updated, failed

    # =========================================================================
    # Settings and retention
    # =========================================================================

    async def get_settings(self, organization_id: str) -> Dict[str, Any]:
        org = await self._org(organization_id)
        return {"tap_retention_months": tap_retention_months_in(org.settings)}

    async def update_settings(
        self, organization_id: str, *, tap_retention_months: int
    ) -> Dict[str, Any]:
        org = await self._org(organization_id)
        # Deep copy, then reassign and flag: the section is a nested dict, and
        # a shallow copy would share it with SQLAlchemy's committed state and
        # turn the write into a silent no-op (Pitfall #12).
        settings = copy.deepcopy(org.settings) if isinstance(org.settings, dict) else {}
        section = settings.get(SETTINGS_KEY)
        section = section if isinstance(section, dict) else {}
        section["tap_retention_months"] = tap_retention_months
        settings[SETTINGS_KEY] = section
        org.settings = settings
        flag_modified(org, "settings")
        await self.db.flush()
        return {"tap_retention_months": tap_retention_months}

    async def purge_expired_taps(
        self, organization: Organization, *, now: Optional[datetime] = None
    ) -> int:
        """Delete this organization's taps older than its retention period.

        Calendar months, so "24 months" ends on the same day of the month two
        years back rather than drifting by the length of the months between.
        """
        months = tap_retention_months_in(organization.settings)
        cutoff = (now or datetime.now(timezone.utc)) - relativedelta(months=months)
        result = await self.db.execute(
            delete(NfcCardTap).where(
                NfcCardTap.organization_id == str(organization.id),
                NfcCardTap.tapped_at < cutoff,
            )
        )
        return rows_affected(result)

    async def _org(self, organization_id: str) -> Organization:
        org = (
            await self.db.execute(
                select(Organization).where(Organization.id == str(organization_id))
            )
        ).scalar_one_or_none()
        if org is None:
            raise ValueError("Organization not found")
        return org
