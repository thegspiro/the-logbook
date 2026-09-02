"""
Admin Hours Service

Business logic for admin hours tracking, including QR-based clock-in/clock-out,
manual entry, and approval workflows.
"""

import io
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

from loguru import logger
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload

from app.models.admin_hours import (
    AdminHoursCategory,
    AdminHoursEntry,
    AdminHoursEntryMethod,
    AdminHoursEntryStatus,
    EventHourMapping,
)
from app.models.event import Event
from app.models.user import Organization, User
from app.services.separation_of_duties import assert_different_person
from app.utils.csv_export import SafeCsvWriter
from app.utils.hours import hours_from_minutes
from app.utils.model_updates import apply_updates

# A single manual admin-hours entry cannot span more than a day — bounds the
# absurd-duration self-credit vector on client-supplied times.
MAX_MANUAL_ENTRY_MINUTES = 24 * 60


def _ensure_utc(dt: datetime) -> datetime:
    """Ensure a datetime is timezone-aware (UTC).

    MySQL/aiomysql may return naive datetimes even for DateTime(timezone=True)
    columns. This helper assumes naive values are UTC and attaches tzinfo.
    Only for DB-loaded values — client input goes through _require_utc.
    """
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _require_utc(dt: datetime, field: str) -> datetime:
    """Validate a client-supplied timestamp is timezone-aware; normalize to UTC.

    A naive value is ambiguous: the pre-2026-08 frontend sent local wall-clock
    strings, and assuming UTC would store them shifted by the org's UTC offset
    behind a success response. Reject instead of guessing (ValueError -> 400)
    so a stale client gets a clear error rather than corrupt hour records.
    """
    if dt.tzinfo is None:
        raise ValueError(
            f"{field} must include a timezone offset "
            "(UTC, e.g. 2026-08-12T14:00:00Z)"
        )
    return dt.astimezone(timezone.utc)


class AdminHoursService:
    """Service for managing admin hours categories and entries."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # =========================================================================
    # Categories
    # =========================================================================

    async def list_categories(
        self,
        organization_id: str,
        include_inactive: bool = False,
    ) -> List[AdminHoursCategory]:
        """List all admin hours categories for an organization."""
        query = select(AdminHoursCategory).where(
            AdminHoursCategory.organization_id == organization_id
        )
        if not include_inactive:
            query = query.where(AdminHoursCategory.is_active.is_(True))
        query = query.order_by(AdminHoursCategory.sort_order, AdminHoursCategory.name)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_category(
        self, category_id: str, organization_id: str
    ) -> Optional[AdminHoursCategory]:
        """Get a single category by ID."""
        result = await self.db.execute(
            select(AdminHoursCategory).where(
                AdminHoursCategory.id == category_id,
                AdminHoursCategory.organization_id == organization_id,
            )
        )
        return result.scalar_one_or_none()

    async def create_category(
        self,
        organization_id: str,
        created_by: str,
        **kwargs: object,
    ) -> AdminHoursCategory:
        """Create a new admin hours category."""
        category = AdminHoursCategory(
            organization_id=organization_id,
            created_by=created_by,
            **kwargs,
        )
        self.db.add(category)
        await self.db.flush()
        await self.db.refresh(category, ["created_at", "updated_at"])
        return category

    async def update_category(
        self,
        category_id: str,
        organization_id: str,
        updated_by: str,
        **kwargs: object,
    ) -> AdminHoursCategory:
        """Update an existing category.

        All provided kwargs are set on the model via `apply_updates`,
        including explicit None values against a nullable column (e.g.
        setting description=None clears it) — a None against a NOT NULL
        column (name, require_approval, is_active, sort_order) raises a
        clean ValueError instead of a flush-time IntegrityError. Only pass
        fields that were actually provided by the caller (use exclude_unset
        on the schema).
        """
        category = await self.get_category(category_id, organization_id)
        if not category:
            raise ValueError("Category not found")

        apply_updates(category, kwargs, skip={"organization_id", "id"})
        category.updated_by = updated_by
        await self.db.flush()
        await self.db.refresh(category, ["created_at", "updated_at"])
        return category

    async def delete_category(self, category_id: str, organization_id: str) -> None:
        """Soft-delete a category by deactivating it."""
        category = await self.get_category(category_id, organization_id)
        if not category:
            raise ValueError("Category not found")

        # Check for active sessions using this category (AH-5: org-scoped)
        active_count_result = await self.db.execute(
            select(func.count()).where(
                AdminHoursEntry.category_id == category_id,
                AdminHoursEntry.organization_id == organization_id,
                AdminHoursEntry.status == AdminHoursEntryStatus.ACTIVE,
            )
        )
        active_count = active_count_result.scalar() or 0
        if active_count > 0:
            raise ValueError(
                "Cannot delete category with active clock-in sessions. "
                "Please ensure all members have clocked out first."
            )

        category.is_active = False
        await self.db.flush()

    # =========================================================================
    # QR Code Data
    # =========================================================================

    async def get_qr_data(self, category_id: str, organization_id: str) -> Dict:
        """Get data for QR code display page."""
        category = await self.get_category(category_id, organization_id)
        if not category:
            raise ValueError("Category not found")
        if not category.is_active:
            raise ValueError("This category is no longer active")

        # Get organization name
        org_result = await self.db.execute(
            select(Organization).where(Organization.id == organization_id)
        )
        org = org_result.scalar_one_or_none()

        return {
            "category_id": category.id,
            "category_name": category.name,
            "category_description": category.description,
            "category_color": category.color,
            "organization_name": org.name if org else None,
        }

    # =========================================================================
    # Clock In / Clock Out
    # =========================================================================

    async def clock_in(
        self,
        category_id: str,
        user_id: str,
        organization_id: str,
        entry_method: AdminHoursEntryMethod = AdminHoursEntryMethod.QR_SCAN,
    ) -> AdminHoursEntry:
        """Clock a user in to an admin hours category.

        ``entry_method`` records how the session was started. It defaults to
        the QR path this was written for; a caller that is something else — the
        ID card station — must say so, or the entry claims a member scanned a
        code when an officer tapped their card.
        """
        category = await self.get_category(category_id, organization_id)
        if not category:
            raise ValueError("Category not found")
        if not category.is_active:
            raise ValueError("This category is no longer active")

        # Lock the caller's own User row (guaranteed to exist, one per user)
        # to serialize concurrent clock-ins for the same user — a double-tap
        # or two open tabs racing here could otherwise both pass the
        # active-session check and both insert an ACTIVE entry, corrupting
        # the "one active session at a time" invariant `clock_out`/
        # `get_active_session` depend on (Pitfall #27).
        await self.db.execute(
            select(User.id).where(User.id == user_id).with_for_update()
        )

        # Check for existing active session (any category) — a locking read,
        # not a plain SELECT: the User lock above doesn't by itself refresh
        # this transaction's snapshot for a different table.
        active = await self._get_active_session(
            user_id, organization_id, for_update=True
        )
        if active:
            if active.category_id == category_id:
                raise ValueError("ALREADY_CLOCKED_IN")
            raise ValueError(
                "You already have an active session. "
                "Please clock out of your current session first."
            )

        entry = AdminHoursEntry(
            organization_id=organization_id,
            user_id=user_id,
            category_id=category_id,
            clock_in_at=datetime.now(timezone.utc),
            entry_method=entry_method,
            status=AdminHoursEntryStatus.ACTIVE,
        )
        self.db.add(entry)
        await self.db.flush()
        await self.db.refresh(entry, ["created_at", "updated_at"])

        logger.info("User {} clocked in to category {}", user_id, category.name)
        return entry

    async def clock_out(
        self, entry_id: str, user_id: str, organization_id: str
    ) -> AdminHoursEntry:
        """Clock out a user from an active admin hours session.

        `user_id`-scoping alone happens to make this safe today (one org per
        user), but the query itself carried no org anchor — the same
        CLAUDE.md Pitfall #14a gap `clock_out_by_category` closed on its own
        query. Filtering explicitly costs nothing for a valid call and closes
        the gap on this query too, rather than leaving it as an implicit
        cross-method invariant.
        """
        result = await self.db.execute(
            select(AdminHoursEntry).where(
                AdminHoursEntry.id == entry_id,
                AdminHoursEntry.user_id == user_id,
                AdminHoursEntry.organization_id == str(organization_id),
                AdminHoursEntry.status == AdminHoursEntryStatus.ACTIVE,
            )
        )
        entry = result.scalar_one_or_none()
        if not entry:
            raise ValueError("No active session found")

        now = datetime.now(timezone.utc)
        entry.clock_out_at = now
        duration = now - _ensure_utc(entry.clock_in_at)
        entry.duration_minutes = int(duration.total_seconds() / 60)

        # Determine status based on category approval settings
        category = await self.get_category(entry.category_id, entry.organization_id)
        entry.status = self._determine_post_clockout_status(
            category, entry.duration_minutes
        )
        # Stamp an approval timestamp on auto-approval so the audit trail isn't
        # left with an APPROVED entry that has no approved_at (approved_by stays
        # None to denote a system/auto approval).
        if entry.status == AdminHoursEntryStatus.APPROVED:
            entry.approved_at = now

        await self.db.flush()
        await self.db.refresh(entry, ["created_at", "updated_at"])
        logger.info("User {} clocked out: {} minutes", user_id, entry.duration_minutes)
        return entry

    async def clock_out_by_category(
        self, category_id: str, user_id: str, organization_id: str
    ) -> AdminHoursEntry:
        """Clock out from a specific category (used when scanning same QR again).

        `user_id`-scoping alone happens to make this safe today (an entry's
        `category_id` is always org-consistent, since `clock_in` validates the
        category is in-org before creating it) — but the query itself carried
        no org anchor, which is the letter of CLAUDE.md Pitfall #14a regardless
        of whether today's callers exploit it. Filtering explicitly costs
        nothing for a valid call and closes the gap on the query itself.
        """
        result = await self.db.execute(
            select(AdminHoursEntry).where(
                AdminHoursEntry.category_id == category_id,
                AdminHoursEntry.user_id == user_id,
                AdminHoursEntry.organization_id == str(organization_id),
                AdminHoursEntry.status == AdminHoursEntryStatus.ACTIVE,
            )
        )
        entry = result.scalar_one_or_none()
        if not entry:
            raise ValueError("No active session found for this category")

        return await self.clock_out(entry.id, user_id, organization_id)

    async def get_active_session(
        self, user_id: str, organization_id: str
    ) -> Optional[Dict]:
        """Get the user's current active session with category info."""
        entry = await self._get_active_session(user_id, organization_id)
        if not entry:
            return None

        category = await self.db.execute(
            select(AdminHoursCategory).where(
                AdminHoursCategory.id == entry.category_id,
                AdminHoursCategory.organization_id == organization_id,
            )
        )
        cat = category.scalar_one_or_none()

        now = datetime.now(timezone.utc)
        elapsed = now - _ensure_utc(entry.clock_in_at)
        elapsed_minutes = int(elapsed.total_seconds() / 60)

        max_minutes: Optional[int] = None
        if cat and cat.max_hours_per_session:
            max_minutes = int(cat.max_hours_per_session * 60)

        return {
            "id": entry.id,
            "category_id": entry.category_id,
            "category_name": cat.name if cat else "Unknown",
            "category_color": cat.color if cat else None,
            "clock_in_at": entry.clock_in_at,
            "elapsed_minutes": elapsed_minutes,
            "max_session_minutes": max_minutes,
        }

    async def _get_active_session(
        self, user_id: str, organization_id: str, for_update: bool = False
    ) -> Optional[AdminHoursEntry]:
        """Internal: get the active entry for a user (AH-5: org-scoped).

        ``for_update``: a locking read, for `clock_in`'s race guard below —
        under REPEATABLE READ, a plain SELECT could still answer from a
        stale snapshot even with the caller's User row locked separately
        (Pitfall #27), so the check itself has to be a locking read too. The
        read path (`get_active_session`) never needs this.
        """
        query = select(AdminHoursEntry).where(
            AdminHoursEntry.user_id == user_id,
            AdminHoursEntry.organization_id == organization_id,
            AdminHoursEntry.status == AdminHoursEntryStatus.ACTIVE,
        )
        if for_update:
            query = query.with_for_update(of=AdminHoursEntry)
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    # =========================================================================
    # Active Sessions (Admin)
    # =========================================================================

    async def list_active_sessions(
        self,
        organization_id: str,
    ) -> List[Dict]:
        """List all currently active sessions across the organization (admin view).

        Returns session info with user name, category details, and elapsed time.
        """
        now = datetime.now(timezone.utc)

        result = await self.db.execute(
            select(
                AdminHoursEntry,
                AdminHoursCategory.name,
                AdminHoursCategory.color,
                AdminHoursCategory.max_hours_per_session,
                User.first_name,
                User.last_name,
            )
            .join(
                AdminHoursCategory,
                AdminHoursEntry.category_id == AdminHoursCategory.id,
            )
            .join(User, AdminHoursEntry.user_id == User.id)
            .where(
                AdminHoursEntry.organization_id == organization_id,
                AdminHoursEntry.status == AdminHoursEntryStatus.ACTIVE,
            )
            .order_by(AdminHoursEntry.clock_in_at.asc())
        )
        rows = result.all()

        sessions = []
        for entry, cat_name, cat_color, max_hours, first_name, last_name in rows:
            elapsed = now - _ensure_utc(entry.clock_in_at)
            elapsed_minutes = int(elapsed.total_seconds() / 60)

            max_minutes: Optional[int] = None
            if max_hours is not None:
                max_minutes = int(max_hours * 60)

            sessions.append(
                {
                    "id": entry.id,
                    "category_id": entry.category_id,
                    "category_name": cat_name,
                    "category_color": cat_color,
                    "user_id": entry.user_id,
                    "user_name": f"{first_name} {last_name}",
                    "clock_in_at": entry.clock_in_at,
                    "elapsed_minutes": elapsed_minutes,
                    "max_session_minutes": max_minutes,
                    "description": entry.description,
                }
            )
        return sessions

    async def admin_force_clock_out(
        self,
        entry_id: str,
        organization_id: str,
        admin_id: str,
    ) -> AdminHoursEntry:
        """Force-end an active session on behalf of a user (admin action).

        The session is clocked out at the current time. The resulting entry
        goes to pending status for review since it was force-ended.
        """
        result = await self.db.execute(
            select(AdminHoursEntry).where(
                AdminHoursEntry.id == entry_id,
                AdminHoursEntry.organization_id == organization_id,
                AdminHoursEntry.status == AdminHoursEntryStatus.ACTIVE,
            )
        )
        entry = result.scalar_one_or_none()
        if not entry:
            raise ValueError("Active session not found")

        now = datetime.now(timezone.utc)
        entry.clock_out_at = now
        duration = now - _ensure_utc(entry.clock_in_at)
        entry.duration_minutes = int(duration.total_seconds() / 60)

        # Force-ended sessions go to pending for review
        entry.description = (
            f"{entry.description + ' — ' if entry.description else ''}"
            f"Session ended by admin"
        )
        entry.status = AdminHoursEntryStatus.PENDING
        await self.db.flush()
        await self.db.refresh(entry, ["created_at", "updated_at"])

        logger.info(
            "Admin {} force-clocked-out session {} for user {} ({} min)",
            admin_id,
            entry_id,
            entry.user_id,
            entry.duration_minutes,
        )
        return entry

    # =========================================================================
    # Manual Entry
    # =========================================================================

    async def create_manual_entry(
        self,
        organization_id: str,
        user_id: str,
        category_id: str,
        clock_in_at: datetime,
        clock_out_at: datetime,
        description: Optional[str] = None,
    ) -> AdminHoursEntry:
        """Create a manual admin hours entry."""
        clock_in_at = _require_utc(clock_in_at, "clock_in_at")
        clock_out_at = _require_utc(clock_out_at, "clock_out_at")

        category = await self.get_category(category_id, organization_id)
        if not category:
            raise ValueError("Category not found")
        if not category.is_active:
            raise ValueError("This category is no longer active")

        if clock_out_at <= clock_in_at:
            raise ValueError("Clock-out time must be after clock-in time")

        # Prevent future entries — both ends must be at or before now (the times
        # are client-supplied, unlike a server-timed clock-out).
        now = datetime.now(timezone.utc)
        if clock_in_at > now:
            raise ValueError("Clock-in time cannot be in the future")
        if clock_out_at > now:
            raise ValueError("Clock-out time cannot be in the future")

        duration = clock_out_at - clock_in_at
        duration_minutes = int(duration.total_seconds() / 60)

        if duration_minutes < 1:
            raise ValueError("Duration must be at least 1 minute")
        # Sanity cap: a single admin-hours entry can't span more than a day.
        if duration_minutes > MAX_MANUAL_ENTRY_MINUTES:
            raise ValueError("A single entry cannot exceed 24 hours")

        # Check for overlapping entries
        overlap = await self._check_overlap(
            user_id, organization_id, clock_in_at, clock_out_at
        )
        if overlap:
            raise ValueError(
                "This time range overlaps with an existing entry. "
                "Please adjust the times."
            )

        # Manual entries carry fully client-supplied times, so they always
        # require officer review — never auto-approve them (that would let a
        # member self-credit fabricated/backdated time). Auto-approval remains
        # only for server-timed clock-outs.
        status = AdminHoursEntryStatus.PENDING

        entry = AdminHoursEntry(
            organization_id=organization_id,
            user_id=user_id,
            category_id=category_id,
            clock_in_at=clock_in_at,
            clock_out_at=clock_out_at,
            duration_minutes=duration_minutes,
            description=description,
            entry_method=AdminHoursEntryMethod.MANUAL,
            status=status,
        )
        self.db.add(entry)
        await self.db.flush()
        await self.db.refresh(entry, ["created_at", "updated_at"])
        return entry

    # =========================================================================
    # Entries Listing
    # =========================================================================

    async def list_my_entries(
        self,
        user_id: str,
        organization_id: str,
        status_filter: Optional[str] = None,
        category_id: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        skip: int = 0,
        limit: int = 50,
    ) -> Tuple[List[Dict], int]:
        """List entries for the current user with category info.

        Returns (entries, total_count) to support pagination.
        """
        Approver = aliased(User)
        base_where = and_(
            AdminHoursEntry.user_id == user_id,
            AdminHoursEntry.organization_id == organization_id,
        )
        query = (
            select(
                AdminHoursEntry,
                AdminHoursCategory.name,
                AdminHoursCategory.color,
                Approver.first_name,
                Approver.last_name,
                Event.title,
            )
            .join(
                AdminHoursCategory,
                AdminHoursEntry.category_id == AdminHoursCategory.id,
            )
            .outerjoin(Approver, AdminHoursEntry.approved_by == Approver.id)
            .outerjoin(Event, AdminHoursEntry.source_event_id == Event.id)
            .where(base_where)
        )
        count_query = select(func.count(AdminHoursEntry.id)).where(base_where)

        if status_filter:
            query = query.where(AdminHoursEntry.status == status_filter)
            count_query = count_query.where(AdminHoursEntry.status == status_filter)
        if category_id:
            query = query.where(AdminHoursEntry.category_id == category_id)
            count_query = count_query.where(AdminHoursEntry.category_id == category_id)
        if start_date:
            query = query.where(AdminHoursEntry.clock_in_at >= start_date)
            count_query = count_query.where(AdminHoursEntry.clock_in_at >= start_date)
        if end_date:
            query = query.where(AdminHoursEntry.clock_in_at <= end_date)
            count_query = count_query.where(AdminHoursEntry.clock_in_at <= end_date)

        total_result = await self.db.execute(count_query)
        total = total_result.scalar() or 0

        query = query.order_by(AdminHoursEntry.clock_in_at.desc())
        query = query.offset(skip).limit(limit)

        result = await self.db.execute(query)
        rows = result.all()

        entries = []
        for row in rows:
            entry, cat_name, cat_color = row[0], row[1], row[2]
            approver_first, approver_last = row[3], row[4]
            event_title = row[5]
            d = self._entry_to_dict(
                entry, cat_name, cat_color, source_event_name=event_title
            )
            if approver_first and approver_last:
                d["approver_name"] = f"{approver_first} {approver_last}"
            entries.append(d)
        return entries, total

    async def list_all_entries(
        self,
        organization_id: str,
        status_filter: Optional[str] = None,
        category_id: Optional[str] = None,
        user_id: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        skip: int = 0,
        limit: int = 50,
    ) -> Tuple[List[Dict], int]:
        """List all entries for an organization (admin view).

        Returns (entries, total_count) to support pagination.
        """
        EntryUser = aliased(User)
        Approver = aliased(User)
        base_where = AdminHoursEntry.organization_id == organization_id

        query = (
            select(
                AdminHoursEntry,
                AdminHoursCategory.name,
                AdminHoursCategory.color,
                EntryUser.first_name,
                EntryUser.last_name,
                Approver.first_name,
                Approver.last_name,
                Event.title,
            )
            .join(
                AdminHoursCategory,
                AdminHoursEntry.category_id == AdminHoursCategory.id,
            )
            .join(EntryUser, AdminHoursEntry.user_id == EntryUser.id)
            .outerjoin(Approver, AdminHoursEntry.approved_by == Approver.id)
            .outerjoin(Event, AdminHoursEntry.source_event_id == Event.id)
            .where(base_where)
        )
        count_query = select(func.count(AdminHoursEntry.id)).where(base_where)

        if status_filter:
            query = query.where(AdminHoursEntry.status == status_filter)
            count_query = count_query.where(AdminHoursEntry.status == status_filter)
        if category_id:
            query = query.where(AdminHoursEntry.category_id == category_id)
            count_query = count_query.where(AdminHoursEntry.category_id == category_id)
        if user_id:
            query = query.where(AdminHoursEntry.user_id == user_id)
            count_query = count_query.where(AdminHoursEntry.user_id == user_id)
        if start_date:
            query = query.where(AdminHoursEntry.clock_in_at >= start_date)
            count_query = count_query.where(AdminHoursEntry.clock_in_at >= start_date)
        if end_date:
            query = query.where(AdminHoursEntry.clock_in_at <= end_date)
            count_query = count_query.where(AdminHoursEntry.clock_in_at <= end_date)

        total_result = await self.db.execute(count_query)
        total = total_result.scalar() or 0

        query = query.order_by(AdminHoursEntry.clock_in_at.desc())
        query = query.offset(skip).limit(limit)

        result = await self.db.execute(query)
        rows = result.all()

        entries = []
        for row in rows:
            entry = row[0]
            cat_name = row[1]
            cat_color = row[2]
            first_name = row[3]
            last_name = row[4]
            approver_first = row[5]
            approver_last = row[6]
            event_title = row[7]
            d = self._entry_to_dict(
                entry, cat_name, cat_color, source_event_name=event_title
            )
            d["user_name"] = f"{first_name} {last_name}"
            if approver_first and approver_last:
                d["approver_name"] = f"{approver_first} {approver_last}"
            entries.append(d)
        return entries, total

    # =========================================================================
    # Edit Pending Entry (Admin)
    # =========================================================================

    async def edit_pending_entry(
        self,
        entry_id: str,
        organization_id: str,
        admin_id: str,
        clock_in_at: Optional[datetime] = None,
        clock_out_at: Optional[datetime] = None,
        description: Optional[str] = None,
        category_id: Optional[str] = None,
    ) -> AdminHoursEntry:
        """Edit a pending entry's times, description, or category.

        Only pending entries can be edited. Duration is recalculated
        from the (possibly updated) clock-in and clock-out times.
        """
        result = await self.db.execute(
            select(AdminHoursEntry).where(
                AdminHoursEntry.id == entry_id,
                AdminHoursEntry.organization_id == organization_id,
                AdminHoursEntry.status == AdminHoursEntryStatus.PENDING,
            )
        )
        entry = result.scalar_one_or_none()
        if not entry:
            raise ValueError("Pending entry not found")

        if category_id is not None:
            category = await self.get_category(category_id, organization_id)
            if not category:
                raise ValueError("Category not found")
            if not category.is_active:
                raise ValueError("Category is no longer active")
            entry.category_id = category_id

        if clock_in_at is not None:
            entry.clock_in_at = _require_utc(clock_in_at, "clock_in_at")

        if clock_out_at is not None:
            entry.clock_out_at = _require_utc(clock_out_at, "clock_out_at")

        if description is not None:
            entry.description = description

        # Validate and recalculate duration — the same guards
        # create_manual_entry applies, since an edit can move these times
        # just as freely as the original manual entry could (future-dating,
        # an unbounded span, or a new overlap with another entry).
        if entry.clock_out_at and entry.clock_in_at:
            start = _ensure_utc(entry.clock_in_at)
            end = _ensure_utc(entry.clock_out_at)
            if end <= start:
                raise ValueError("Clock-out time must be after clock-in time")

            now = datetime.now(timezone.utc)
            if start > now:
                raise ValueError("Clock-in time cannot be in the future")
            if end > now:
                raise ValueError("Clock-out time cannot be in the future")

            duration = end - start
            entry.duration_minutes = int(duration.total_seconds() / 60)
            if entry.duration_minutes < 1:
                raise ValueError("Duration must be at least 1 minute")
            if entry.duration_minutes > MAX_MANUAL_ENTRY_MINUTES:
                raise ValueError("A single entry cannot exceed 24 hours")

            overlap = await self._check_overlap(
                entry.user_id,
                organization_id,
                start,
                end,
                exclude_entry_id=entry_id,
            )
            if overlap:
                raise ValueError(
                    "This time range overlaps with an existing entry. "
                    "Please adjust the times."
                )

        await self.db.flush()
        await self.db.refresh(entry, ["created_at", "updated_at"])

        logger.info(
            "Admin {} edited pending entry {} (user {})",
            admin_id,
            entry_id,
            entry.user_id,
        )
        return entry

    # =========================================================================
    # Approval
    # =========================================================================

    async def approve_or_reject(
        self,
        entry_id: str,
        organization_id: str,
        approver_id: str,
        action: str,
        rejection_reason: Optional[str] = None,
    ) -> AdminHoursEntry:
        """Approve or reject a pending admin hours entry."""
        result = await self.db.execute(
            select(AdminHoursEntry).where(
                AdminHoursEntry.id == entry_id,
                AdminHoursEntry.organization_id == organization_id,
                AdminHoursEntry.status == AdminHoursEntryStatus.PENDING,
            )
        )
        entry = result.scalar_one_or_none()
        if not entry:
            raise ValueError("Pending entry not found")

        # SEC (AH-4): admin hours are credited service time, and officers hold
        # the approval permission for the same pool they log into. Approving
        # your own entry is the entire control. Rejection stays open — an
        # officer withdrawing their own claim is not a conflict.
        if action == "approve":
            assert_different_person(
                approver_id,
                entry.user_id,
                action="approve",
                record="administrative hours entry",
            )

        now = datetime.now(timezone.utc)

        if action == "approve":
            entry.status = AdminHoursEntryStatus.APPROVED
            entry.approved_by = approver_id
            entry.approved_at = now
        elif action == "reject":
            if not rejection_reason:
                raise ValueError("Rejection reason is required")
            entry.status = AdminHoursEntryStatus.REJECTED
            entry.approved_by = approver_id
            entry.approved_at = now
            entry.rejection_reason = rejection_reason
        else:
            raise ValueError("Action must be 'approve' or 'reject'")

        await self.db.flush()
        await self.db.refresh(entry, ["created_at", "updated_at"])
        logger.info("Entry {} {}d by {}", entry_id, action, approver_id)
        return entry

    # =========================================================================
    # Summary / Reporting
    # =========================================================================

    async def get_summary(
        self,
        organization_id: str,
        user_id: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
    ) -> Dict:
        """Get hours summary, optionally filtered by user and date range.

        Returns totals broken out by approved vs pending so the UI can
        show the distinction.
        """
        base_filter = and_(
            AdminHoursEntry.organization_id == organization_id,
            AdminHoursEntry.status.in_(
                [
                    AdminHoursEntryStatus.APPROVED,
                    AdminHoursEntryStatus.PENDING,
                ]
            ),
            AdminHoursEntry.duration_minutes.isnot(None),
        )

        if user_id:
            base_filter = and_(base_filter, AdminHoursEntry.user_id == user_id)
        if start_date:
            base_filter = and_(base_filter, AdminHoursEntry.clock_in_at >= start_date)
        if end_date:
            base_filter = and_(base_filter, AdminHoursEntry.clock_in_at <= end_date)

        # Total
        total_result = await self.db.execute(
            select(
                func.coalesce(func.sum(AdminHoursEntry.duration_minutes), 0),
                func.count(AdminHoursEntry.id),
            ).where(base_filter)
        )
        row = total_result.one()
        total_minutes = row[0]
        total_entries = row[1]

        # Approved-only totals
        approved_filter = and_(
            base_filter,
            AdminHoursEntry.status == AdminHoursEntryStatus.APPROVED,
        )
        approved_result = await self.db.execute(
            select(
                func.coalesce(func.sum(AdminHoursEntry.duration_minutes), 0),
                func.count(AdminHoursEntry.id),
            ).where(approved_filter)
        )
        approved_row = approved_result.one()
        approved_minutes = int(approved_row[0])
        approved_entries = approved_row[1]

        pending_minutes = int(total_minutes) - approved_minutes
        pending_entries = total_entries - approved_entries

        # By category
        category_result = await self.db.execute(
            select(
                AdminHoursCategory.id,
                AdminHoursCategory.name,
                AdminHoursCategory.color,
                func.coalesce(func.sum(AdminHoursEntry.duration_minutes), 0),
                func.count(AdminHoursEntry.id),
            )
            .join(
                AdminHoursCategory,
                AdminHoursEntry.category_id == AdminHoursCategory.id,
            )
            .where(base_filter)
            .group_by(
                AdminHoursCategory.id,
                AdminHoursCategory.name,
                AdminHoursCategory.color,
            )
        )
        by_category = [
            {
                "category_id": cat_id,
                "category_name": cat_name,
                "category_color": cat_color,
                "total_minutes": int(cat_minutes),
                "total_hours": hours_from_minutes(cat_minutes),
                "entry_count": cat_count,
            }
            for cat_id, cat_name, cat_color, cat_minutes, cat_count in category_result.all()
        ]

        return {
            "total_hours": hours_from_minutes(total_minutes),
            "total_entries": total_entries,
            "approved_hours": hours_from_minutes(approved_minutes),
            "approved_entries": approved_entries,
            "pending_hours": hours_from_minutes(pending_minutes),
            "pending_entries": pending_entries,
            "by_category": by_category,
            "period_start": start_date,
            "period_end": end_date,
        }

    # =========================================================================
    # Bulk Approval
    # =========================================================================

    async def bulk_approve(
        self,
        entry_ids: List[str],
        organization_id: str,
        approver_id: str,
    ) -> int:
        """Approve multiple pending entries at once. Returns count of approved entries."""
        now = datetime.now(timezone.utc)
        approved_count = 0
        skipped_self = 0

        for entry_id in entry_ids:
            result = await self.db.execute(
                select(AdminHoursEntry).where(
                    AdminHoursEntry.id == entry_id,
                    AdminHoursEntry.organization_id == organization_id,
                    AdminHoursEntry.status == AdminHoursEntryStatus.PENDING,
                )
            )
            entry = result.scalar_one_or_none()
            if not entry:
                continue
            # SEC (AH-4): the single-entry approve path forbids self-approval as
            # "the entire control" — the bulk path must honor the same
            # separation of duties, or an officer could self-credit at scale.
            # Skip self-owned entries (they stay PENDING for another approver)
            # rather than aborting the whole batch on one included id.
            if entry.user_id == approver_id:
                skipped_self += 1
                continue
            entry.status = AdminHoursEntryStatus.APPROVED
            entry.approved_by = approver_id
            entry.approved_at = now
            approved_count += 1

        await self.db.flush()
        logger.info(
            "Bulk approved {} entries by {} ({} self-owned entries skipped)",
            approved_count,
            approver_id,
            skipped_self,
        )
        return approved_count

    # =========================================================================
    # Pending Count
    # =========================================================================

    async def get_pending_count(self, organization_id: str) -> int:
        """Get the number of entries awaiting review."""
        result = await self.db.execute(
            select(func.count(AdminHoursEntry.id)).where(
                AdminHoursEntry.organization_id == organization_id,
                AdminHoursEntry.status == AdminHoursEntryStatus.PENDING,
            )
        )
        return result.scalar() or 0

    # =========================================================================
    # CSV Export
    # =========================================================================

    async def export_entries_csv(
        self,
        organization_id: str,
        status_filter: Optional[str] = None,
        category_id: Optional[str] = None,
        user_id: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
    ) -> str:
        """Export entries as a CSV string."""
        EntryUser = aliased(User)
        Approver = aliased(User)

        query = (
            select(
                AdminHoursEntry,
                AdminHoursCategory.name,
                EntryUser.first_name,
                EntryUser.last_name,
                Approver.first_name,
                Approver.last_name,
            )
            .join(
                AdminHoursCategory,
                AdminHoursEntry.category_id == AdminHoursCategory.id,
            )
            .join(EntryUser, AdminHoursEntry.user_id == EntryUser.id)
            .outerjoin(Approver, AdminHoursEntry.approved_by == Approver.id)
            .where(AdminHoursEntry.organization_id == organization_id)
        )

        if status_filter:
            query = query.where(AdminHoursEntry.status == status_filter)
        if category_id:
            query = query.where(AdminHoursEntry.category_id == category_id)
        if user_id:
            query = query.where(AdminHoursEntry.user_id == user_id)
        if start_date:
            query = query.where(AdminHoursEntry.clock_in_at >= start_date)
        if end_date:
            query = query.where(AdminHoursEntry.clock_in_at <= end_date)

        query = query.order_by(AdminHoursEntry.clock_in_at.desc())

        result = await self.db.execute(query)
        rows = result.all()

        output = io.StringIO()
        # SafeCsvWriter neutralizes spreadsheet formula injection in free-text
        # cells (member names, notes).
        writer = SafeCsvWriter(output)
        writer.writerow(
            [
                "Member",
                "Category",
                "Date",
                "Clock In",
                "Clock Out",
                "Duration (hours)",
                "Method",
                "Status",
                "Approved By",
                "Description",
            ]
        )

        for row in rows:
            entry = row[0]
            cat_name = row[1]
            user_first = row[2]
            user_last = row[3]
            approver_first = row[4]
            approver_last = row[5]

            # The export states the same figure the member read on the screen
            # it came from, so a hand-off does not have to explain why one says
            # 2.9 and the other 3.
            duration_hours = (
                hours_from_minutes(entry.duration_minutes)
                if entry.duration_minutes
                else ""
            )
            clock_in = (
                entry.clock_in_at.strftime("%Y-%m-%d %H:%M")
                if entry.clock_in_at
                else ""
            )
            clock_out = (
                entry.clock_out_at.strftime("%Y-%m-%d %H:%M")
                if entry.clock_out_at
                else ""
            )
            date_str = (
                entry.clock_in_at.strftime("%Y-%m-%d") if entry.clock_in_at else ""
            )
            approver_name = (
                f"{approver_first} {approver_last}"
                if approver_first and approver_last
                else ""
            )

            writer.writerow(
                [
                    f"{user_first} {user_last}",
                    cat_name,
                    date_str,
                    clock_in,
                    clock_out,
                    duration_hours,
                    entry.entry_method.value if entry.entry_method else "manual",
                    entry.status.value if entry.status else "",
                    approver_name,
                    entry.description or "",
                ]
            )

        return output.getvalue()

    # =========================================================================
    # Stale Session Enforcement
    # =========================================================================

    async def auto_close_stale_sessions(
        self, organization_id: Optional[str] = None
    ) -> int:
        """Auto-close sessions that exceeded their category's max_hours_per_session.

        Pass ``organization_id`` to scope to a single tenant (the per-org
        endpoint does this so an officer can't close/mutate other tenants'
        active sessions); the global scheduled task omits it to sweep all orgs.
        Returns the number of sessions auto-closed.
        """
        now = datetime.now(timezone.utc)
        query = (
            select(AdminHoursEntry, AdminHoursCategory.max_hours_per_session)
            .join(
                AdminHoursCategory,
                AdminHoursEntry.category_id == AdminHoursCategory.id,
            )
            .where(
                AdminHoursEntry.status == AdminHoursEntryStatus.ACTIVE,
                AdminHoursCategory.max_hours_per_session.isnot(None),
            )
        )
        if organization_id is not None:
            query = query.where(AdminHoursEntry.organization_id == organization_id)
        result = await self.db.execute(query)
        rows = result.all()
        closed = 0

        for entry, max_hours in rows:
            max_duration = timedelta(hours=max_hours)
            if now - _ensure_utc(entry.clock_in_at) > max_duration:
                entry.clock_out_at = _ensure_utc(entry.clock_in_at) + max_duration
                entry.duration_minutes = int(max_hours * 60)
                entry.description = (
                    f"{entry.description + ' — ' if entry.description else ''}"
                    f"Auto-closed: exceeded {max_hours}h session limit"
                )
                # Auto-closed entries go to pending for review
                entry.status = AdminHoursEntryStatus.PENDING
                closed += 1
                logger.info(
                    "Auto-closed stale session {} for user {} ({}h limit)",
                    entry.id,
                    entry.user_id,
                    max_hours,
                )

        if closed:
            await self.db.flush()
        return closed

    # =========================================================================
    # Helpers
    # =========================================================================

    async def _check_overlap(
        self,
        user_id: str,
        organization_id: str,
        clock_in_at: datetime,
        clock_out_at: datetime,
        exclude_entry_id: Optional[str] = None,
    ) -> bool:
        """Check if a time range overlaps with existing non-rejected entries."""
        query = select(func.count(AdminHoursEntry.id)).where(
            AdminHoursEntry.user_id == user_id,
            AdminHoursEntry.organization_id == organization_id,
            AdminHoursEntry.status != AdminHoursEntryStatus.REJECTED,
            AdminHoursEntry.clock_out_at.isnot(None),
            # Overlap: existing.start < new.end AND existing.end > new.start
            AdminHoursEntry.clock_in_at < clock_out_at,
            AdminHoursEntry.clock_out_at > clock_in_at,
        )
        if exclude_entry_id:
            query = query.where(AdminHoursEntry.id != exclude_entry_id)
        result = await self.db.execute(query)
        return (result.scalar() or 0) > 0

    @staticmethod
    def _determine_post_clockout_status(
        category: Optional[AdminHoursCategory],
        duration_minutes: int,
    ) -> AdminHoursEntryStatus:
        """Determine the entry status after clock-out based on category settings."""
        if not category or not category.require_approval:
            return AdminHoursEntryStatus.APPROVED

        duration_hours = duration_minutes / 60
        if (
            category.auto_approve_under_hours is not None
            and duration_hours < category.auto_approve_under_hours
        ):
            return AdminHoursEntryStatus.APPROVED

        return AdminHoursEntryStatus.PENDING

    @staticmethod
    def _entry_to_dict(
        entry: AdminHoursEntry,
        category_name: str,
        category_color: Optional[str],
        user_name: Optional[str] = None,
        source_event_name: Optional[str] = None,
    ) -> Dict:
        """Convert an entry + joined fields to a dict."""
        d: Dict = {
            "id": entry.id,
            "organization_id": entry.organization_id,
            "user_id": entry.user_id,
            "category_id": entry.category_id,
            "clock_in_at": entry.clock_in_at,
            "clock_out_at": entry.clock_out_at,
            "duration_minutes": entry.duration_minutes,
            "description": entry.description,
            "entry_method": (
                entry.entry_method.value if entry.entry_method else "manual"
            ),
            "status": entry.status.value if entry.status else "pending",
            "approved_by": entry.approved_by,
            "approved_at": entry.approved_at,
            "rejection_reason": entry.rejection_reason,
            "created_at": entry.created_at,
            "updated_at": entry.updated_at,
            "source_event_id": entry.source_event_id,
            "source_rsvp_id": entry.source_rsvp_id,
            "category_name": category_name,
            "category_color": category_color,
            "user_name": user_name,
            "approver_name": None,
            "source_event_name": source_event_name,
        }
        return d

    # =========================================================================
    # Event Hour Mappings
    # =========================================================================

    async def list_event_hour_mappings(
        self,
        organization_id: str,
        include_inactive: bool = False,
    ) -> List[Dict]:
        """List all event hour mappings for an organization."""
        query = (
            select(EventHourMapping, AdminHoursCategory)
            .join(
                AdminHoursCategory,
                EventHourMapping.admin_hours_category_id == AdminHoursCategory.id,
            )
            .where(EventHourMapping.organization_id == organization_id)
        )
        if not include_inactive:
            query = query.where(EventHourMapping.is_active.is_(True))
        query = query.order_by(
            EventHourMapping.event_type,
            EventHourMapping.custom_category,
        )
        result = await self.db.execute(query)
        rows = result.all()
        return [
            {
                "id": mapping.id,
                "organization_id": mapping.organization_id,
                "event_type": mapping.event_type,
                "custom_category": mapping.custom_category,
                "admin_hours_category_id": mapping.admin_hours_category_id,
                "admin_hours_category_name": cat.name,
                "admin_hours_category_color": cat.color,
                "percentage": mapping.percentage,
                "is_active": mapping.is_active,
                "created_at": mapping.created_at,
            }
            for mapping, cat in rows
        ]

    async def create_event_hour_mapping(
        self,
        organization_id: str,
        created_by: str,
        event_type: Optional[str],
        custom_category: Optional[str],
        admin_hours_category_id: str,
        percentage: int = 100,
    ) -> EventHourMapping:
        """Create an event-to-admin-hours mapping.

        Validates that the target category exists and that total percentage
        for the same source doesn't exceed 100%.
        """
        if not event_type and not custom_category:
            raise ValueError("Either event_type or custom_category is required")
        if event_type and custom_category:
            raise ValueError("Only one of event_type or custom_category can be set")

        # Verify target category exists in this org
        cat = await self.get_category(admin_hours_category_id, organization_id)
        if not cat:
            raise ValueError("Admin hours category not found")

        # Check total percentage for this source won't exceed 100. A locking
        # read: two concurrent creates for the same source could otherwise
        # both read a total under 100 and jointly exceed it (Pitfall #27).
        # There's no single parent row for a "source" (event_type is a
        # string, not an FK) to lock ahead of this, so a race between two
        # concurrent *first* mappings for a brand-new source is not fully
        # closed by this alone — but every case where at least one mapping
        # for the source already exists is, which is the common case once a
        # source has any allocation at all.
        existing_query = (
            select(func.coalesce(func.sum(EventHourMapping.percentage), 0))
            .where(
                EventHourMapping.organization_id == organization_id,
                EventHourMapping.is_active.is_(True),
            )
            .with_for_update(of=EventHourMapping)
        )
        if event_type:
            existing_query = existing_query.where(
                EventHourMapping.event_type == event_type
            )
        else:
            existing_query = existing_query.where(
                EventHourMapping.custom_category == custom_category
            )
        result = await self.db.execute(existing_query)
        current_total = result.scalar() or 0

        if current_total + percentage > 100:
            raise ValueError(
                f"Total percentage would be {current_total + percentage}%. "
                f"Maximum is 100% (currently {current_total}% allocated)."
            )

        mapping = EventHourMapping(
            organization_id=organization_id,
            event_type=event_type,
            custom_category=custom_category,
            admin_hours_category_id=admin_hours_category_id,
            percentage=percentage,
            created_by=created_by,
        )
        self.db.add(mapping)
        await self.db.flush()
        await self.db.refresh(mapping, ["created_at", "updated_at"])
        return mapping

    async def update_event_hour_mapping(
        self,
        mapping_id: str,
        organization_id: str,
        percentage: Optional[int] = None,
        is_active: Optional[bool] = None,
    ) -> EventHourMapping:
        """Update an event hour mapping's percentage or active status."""
        result = await self.db.execute(
            select(EventHourMapping).where(
                EventHourMapping.id == mapping_id,
                EventHourMapping.organization_id == organization_id,
            )
        )
        mapping = result.scalar_one_or_none()
        if not mapping:
            raise ValueError("Mapping not found")

        if percentage is not None:
            # Lock the complete set of mappings for this source — including
            # the target row itself — in one query, ordered consistently by
            # id, before reading or writing any of them. Locking only the
            # *other* mappings (excluding the target, as an earlier version
            # of this fix did) lets two concurrent updates for two different
            # mappings under the same source each lock the row the other is
            # about to write to, then each block writing their own row at
            # flush — a lock-order inversion InnoDB resolves by killing one
            # side as a deadlock (Codex review, PR #1903). Locking the same
            # full set in the same order on every call means the second
            # transaction to reach it simply queues behind the first, rather
            # than each holding what the other needs.
            source_query = select(EventHourMapping).where(
                EventHourMapping.organization_id == organization_id,
            )
            if mapping.event_type:
                source_query = source_query.where(
                    EventHourMapping.event_type == mapping.event_type
                )
            else:
                source_query = source_query.where(
                    EventHourMapping.custom_category == mapping.custom_category
                )
            source_query = source_query.order_by(EventHourMapping.id).with_for_update(
                of=EventHourMapping
            )
            source_result = await self.db.execute(source_query)
            source_mappings = source_result.scalars().all()

            other_total = sum(
                m.percentage
                for m in source_mappings
                if m.id != mapping_id and m.is_active
            )
            if other_total + percentage > 100:
                raise ValueError(
                    f"Total percentage would be {other_total + percentage}%. "
                    f"Maximum is 100% (currently {other_total}% allocated "
                    f"by other mappings)."
                )
            mapping.percentage = percentage

        if is_active is not None:
            mapping.is_active = is_active

        await self.db.flush()
        return mapping

    async def delete_event_hour_mapping(
        self,
        mapping_id: str,
        organization_id: str,
    ) -> None:
        """Delete an event hour mapping."""
        result = await self.db.execute(
            select(EventHourMapping).where(
                EventHourMapping.id == mapping_id,
                EventHourMapping.organization_id == organization_id,
            )
        )
        mapping = result.scalar_one_or_none()
        if not mapping:
            raise ValueError("Mapping not found")
        await self.db.delete(mapping)
        await self.db.flush()

    async def get_mappings_for_event(
        self,
        organization_id: str,
        event_type: Optional[str],
        custom_category: Optional[str],
    ) -> List[Tuple[str, int, Optional["AdminHoursCategory"]]]:
        """Get active mappings for a given event type or custom category.

        Returns list of (category_id, percentage, category) tuples.
        """
        query = (
            select(EventHourMapping, AdminHoursCategory)
            .join(
                AdminHoursCategory,
                EventHourMapping.admin_hours_category_id == AdminHoursCategory.id,
            )
            .where(
                EventHourMapping.organization_id == organization_id,
                EventHourMapping.is_active.is_(True),
                AdminHoursCategory.is_active.is_(True),
            )
        )
        if event_type:
            query = query.where(EventHourMapping.event_type == event_type)
        elif custom_category:
            query = query.where(EventHourMapping.custom_category == custom_category)
        else:
            return []

        result = await self.db.execute(query)
        return [
            (mapping.admin_hours_category_id, mapping.percentage, cat)
            for mapping, cat in result.all()
        ]

    async def get_active_mappings_by_source(
        self, organization_id: str
    ) -> Dict[Tuple[str, str], List[Tuple[int, str]]]:
        """Bulk-load active event-hour mappings, keyed by their source.

        The per-event :meth:`get_mappings_for_event` is one query per event,
        which the events list cannot afford. Keys are ``("event_type", value)``
        or ``("custom_category", value)``; values are ``(percentage, category
        name)`` pairs. Callers must resolve with the same precedence
        :meth:`get_mappings_for_event` uses — event_type first, custom_category
        only when the event has no type — so a displayed credit matches what
        :meth:`credit_event_attendance` will actually award.
        """
        result = await self.db.execute(
            select(EventHourMapping, AdminHoursCategory)
            .join(
                AdminHoursCategory,
                EventHourMapping.admin_hours_category_id == AdminHoursCategory.id,
            )
            .where(
                EventHourMapping.organization_id == organization_id,
                EventHourMapping.is_active.is_(True),
                AdminHoursCategory.is_active.is_(True),
            )
        )
        by_source: Dict[Tuple[str, str], List[Tuple[int, str]]] = {}
        for mapping, cat in result.all():
            if mapping.event_type:
                key = ("event_type", mapping.event_type)
            elif mapping.custom_category:
                key = ("custom_category", mapping.custom_category)
            else:
                continue
            by_source.setdefault(key, []).append((mapping.percentage, cat.name))
        return by_source

    async def credit_event_attendance(
        self,
        organization_id: str,
        user_id: str,
        event_id: str,
        rsvp_id: str,
        event_title: str,
        check_in_at: datetime,
        check_out_at: datetime,
        duration_minutes: int,
        event_type: Optional[str],
        custom_category: Optional[str],
        resync: bool = False,
    ) -> int:
        """Create admin hours entries from event attendance.

        Looks up active mappings for the event type/custom category and
        creates one entry per mapping with proportional duration.
        Returns the number of entries created or updated.

        ``resync`` re-runs the credit for an attendance record that was already
        credited, which is what a reopened event needs: the correction a leader
        made has to reach the ledger, and skipping an existing entry is exactly
        how the event screen and the hours ledger came to disagree. The entry is
        updated in place rather than deleted and recreated so its id, its
        approval and its audit trail survive the correction — only the numbers
        move. An entry whose method is no longer EVENT_ATTENDANCE was taken over
        by hand and is left alone.
        """
        mappings = await self.get_mappings_for_event(
            organization_id, event_type, custom_category
        )
        if not mappings:
            return 0

        # On a resync the event's type or custom category may have been
        # corrected while it was reopened, which points it at a different set
        # of categories. Entries under the categories it no longer maps to are
        # stale derivatives of this RSVP, so they go — otherwise a correction
        # from category A to B leaves the member credited under both and their
        # total silently doubles.
        if resync:
            keep = {category_id for category_id, _pct, _cat in mappings}
            stale_result = await self.db.execute(
                select(AdminHoursEntry).where(
                    AdminHoursEntry.organization_id == organization_id,
                    AdminHoursEntry.source_rsvp_id == rsvp_id,
                    AdminHoursEntry.entry_method
                    == AdminHoursEntryMethod.EVENT_ATTENDANCE,
                    AdminHoursEntry.category_id.notin_(keep),
                )
            )
            for stale in stale_result.scalars().all():
                await self.db.delete(stale)

        created_count = 0
        for category_id, percentage, category in mappings:
            # Skip if entry already exists for this RSVP + category (idempotent)
            existing = await self.db.execute(
                select(AdminHoursEntry).where(
                    AdminHoursEntry.organization_id == organization_id,
                    AdminHoursEntry.source_rsvp_id == rsvp_id,
                    AdminHoursEntry.category_id == category_id,
                )
            )
            existing_entry = existing.scalar_one_or_none()
            if existing_entry is not None:
                if not resync:
                    continue
                if (
                    existing_entry.entry_method
                    != AdminHoursEntryMethod.EVENT_ATTENDANCE
                ):
                    continue
                existing_entry.clock_in_at = _ensure_utc(check_in_at)
                existing_entry.clock_out_at = _ensure_utc(check_out_at)
                existing_entry.duration_minutes = max(
                    1, int(duration_minutes * percentage / 100)
                )
                existing_entry.description = f"Event attendance: {event_title}"
                created_count += 1
                continue

            proportional_minutes = max(1, int(duration_minutes * percentage / 100))

            status = self._determine_post_clockout_status(
                category, proportional_minutes
            )

            entry = AdminHoursEntry(
                organization_id=organization_id,
                user_id=user_id,
                category_id=category_id,
                clock_in_at=_ensure_utc(check_in_at),
                clock_out_at=_ensure_utc(check_out_at),
                duration_minutes=proportional_minutes,
                description=f"Event attendance: {event_title}",
                entry_method=AdminHoursEntryMethod.EVENT_ATTENDANCE,
                status=status,
                source_event_id=event_id,
                source_rsvp_id=rsvp_id,
            )
            if status == AdminHoursEntryStatus.APPROVED:
                entry.approved_at = _ensure_utc(check_out_at)
            self.db.add(entry)
            created_count += 1

        if created_count:
            await self.db.flush()

        return created_count

    async def delete_event_attendance_entries(
        self, rsvp_id: str, organization_id: str
    ) -> int:
        """Remove the hours credited from one attendance record.

        Called when an attendee is taken off an event. Without it the entry
        outlives the RSVP it was derived from: ``source_rsvp_id`` is an
        ``ondelete="SET NULL"`` foreign key, so the row survives with nothing
        pointing back at the attendance that justified it, and the member keeps
        credit for an event they are no longer recorded at.

        Only rows this service created from attendance are removed — an entry a
        member or officer has since taken over by hand is theirs, not a
        derivative of the RSVP.
        """
        result = await self.db.execute(
            select(AdminHoursEntry).where(
                AdminHoursEntry.organization_id == organization_id,
                AdminHoursEntry.source_rsvp_id == rsvp_id,
                AdminHoursEntry.entry_method == AdminHoursEntryMethod.EVENT_ATTENDANCE,
            )
        )
        entries = list(result.scalars().all())
        for entry in entries:
            await self.db.delete(entry)
        return len(entries)

    # =========================================================================
    # Admin Hours Compliance
    # =========================================================================

    async def get_user_hours_compliance(
        self,
        organization_id: str,
        user_id: str,
        year: int,
    ) -> List[Dict]:
        """Get a user's admin hours progress against compliance requirements.

        Returns a list of requirement progress items with hours logged vs required.
        """
        from app.models.compliance_config import ComplianceConfig, ComplianceProfile
        from app.models.user import User as UserModel

        # Get user to check membership type and roles.
        #
        # Org-scoped: the endpoint only restricts non-admin callers to their
        # own id, so an admin_hours.manage/compliance.view holder could
        # otherwise pass any user_id — including one from another organization
        # — and have this method resolve that user's membership_type/positions
        # and match them against the caller's own org's compliance profiles.
        #
        # `positions` is eager-loaded because it is read below, and a lazy load
        # inside an async session raises MissingGreenlet rather than emitting
        # the query. That failure hid behind SQLAlchemy's identity map: asking
        # for your own compliance returns the already-loaded `current_user`
        # instance, whose positions the auth dependency populated, so it only
        # ever 500ed when an officer looked at somebody else.
        user_result = await self.db.execute(
            select(UserModel)
            .options(selectinload(UserModel.positions))
            .where(
                UserModel.id == user_id,
                UserModel.organization_id == organization_id,
            )
        )
        user = user_result.scalar_one_or_none()
        if not user:
            return []

        # Get compliance config with profiles
        config_result = await self.db.execute(
            select(ComplianceConfig)
            .options(selectinload(ComplianceConfig.profiles))
            .where(ComplianceConfig.organization_id == organization_id)
        )
        config = config_result.scalars().first()
        if not config:
            return []

        # Find applicable profiles for this user
        user_membership = user.membership_type
        user_position_ids = [str(p.id) for p in (user.positions or [])]

        applicable_profiles: List[ComplianceProfile] = []
        for profile in config.profiles:
            if not profile.is_active:
                continue
            if not profile.admin_hours_requirements:
                continue

            types = profile.membership_types or []
            roles = profile.role_ids or []
            matches_type = not types or user_membership in types
            matches_role = not roles or any(r in user_position_ids for r in roles)
            if matches_type and matches_role:
                applicable_profiles.append(profile)

        if not applicable_profiles:
            return []

        # Use highest priority profile
        applicable_profiles.sort(key=lambda p: p.priority or 0, reverse=True)
        best_profile = applicable_profiles[0]
        requirements = best_profile.admin_hours_requirements or []

        # Calculate date range for the year
        year_start = datetime(year, 1, 1, tzinfo=timezone.utc)
        year_end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)

        results = []
        for req in requirements:
            cat_id = req.get("category_id", "")
            required_hours = req.get("required_hours", 0)
            frequency = req.get("frequency", "annual")

            # Get category info
            cat = await self.get_category(cat_id, organization_id)
            if not cat:
                continue

            # Determine period based on frequency
            if frequency == "quarterly":
                # Current quarter
                from datetime import date

                today = date.today()
                q_start_month = ((today.month - 1) // 3) * 3 + 1
                period_start = datetime(
                    today.year, q_start_month, 1, tzinfo=timezone.utc
                )
                if q_start_month + 3 > 12:
                    period_end = datetime(today.year + 1, 1, 1, tzinfo=timezone.utc)
                else:
                    period_end = datetime(
                        today.year, q_start_month + 3, 1, tzinfo=timezone.utc
                    )
            else:
                period_start = year_start
                period_end = year_end

            # Sum approved hours for this user + category + period
            hours_result = await self.db.execute(
                select(
                    func.coalesce(func.sum(AdminHoursEntry.duration_minutes), 0)
                ).where(
                    AdminHoursEntry.organization_id == organization_id,
                    AdminHoursEntry.user_id == user_id,
                    AdminHoursEntry.category_id == cat_id,
                    AdminHoursEntry.status == AdminHoursEntryStatus.APPROVED,
                    AdminHoursEntry.clock_in_at >= period_start,
                    AdminHoursEntry.clock_in_at < period_end,
                )
            )
            total_minutes = hours_result.scalar() or 0
            # `func.sum` hands back a Decimal on MySQL, and `required_hours`
            # comes out of the profile's JSON as a float, so dividing one by
            # the other raised TypeError -- but only once the member had
            # actually logged approved hours against the category. With none,
            # `or 0` substitutes an int and everything below is float, so the
            # endpoint answered perfectly for anybody it had nothing to report
            # about and 500ed for everybody it did.
            #
            # `hours_from_minutes` is what the five other call sites in this
            # service use; this one hand-rolled it. Grading stays on the raw
            # figure, which that module requires in as many words: rounding
            # first turns a shortfall under an eighth of an hour into zero and
            # marks a member compliant while they are short.
            raw_hours = float(total_minutes) / 60.0
            logged_hours = hours_from_minutes(total_minutes)

            status = "compliant"
            if raw_hours < required_hours:
                pct = (raw_hours / required_hours * 100) if required_hours else 0
                if pct < (
                    best_profile.at_risk_threshold_override or config.at_risk_threshold
                ):
                    status = "non_compliant"
                else:
                    status = "at_risk"

            results.append(
                {
                    "category_id": cat_id,
                    "category_name": cat.name,
                    "category_color": cat.color,
                    "required_hours": required_hours,
                    "logged_hours": logged_hours,
                    "frequency": frequency,
                    "status": status,
                    "period_start": period_start.isoformat(),
                    "period_end": period_end.isoformat(),
                }
            )

        return results
