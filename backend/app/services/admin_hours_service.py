"""
Admin Hours Service

Business logic for admin hours tracking, including QR-based clock-in/clock-out,
manual entry, and approval workflows.
"""

import csv
import io
import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.models.admin_hours import (
    AdminHoursCategory,
    AdminHoursEntry,
    AdminHoursEntryMethod,
    AdminHoursEntryStatus,
)
from app.models.user import Organization, User

logger = logging.getLogger(__name__)


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
        query = query.order_by(
            AdminHoursCategory.sort_order, AdminHoursCategory.name
        )
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

        All provided kwargs are set on the model, including explicit None values
        (e.g. setting description=None clears it). Only pass fields that were
        actually provided by the caller (use exclude_unset on the schema).
        """
        category = await self.get_category(category_id, organization_id)
        if not category:
            raise ValueError("Category not found")

        for key, value in kwargs.items():
            setattr(category, key, value)
        category.updated_by = updated_by
        await self.db.flush()
        await self.db.refresh(category, ["created_at", "updated_at"])
        return category

    async def delete_category(
        self, category_id: str, organization_id: str
    ) -> None:
        """Soft-delete a category by deactivating it."""
        category = await self.get_category(category_id, organization_id)
        if not category:
            raise ValueError("Category not found")

        # Check for active sessions using this category
        active_count_result = await self.db.execute(
            select(func.count()).where(
                AdminHoursEntry.category_id == category_id,
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

    async def get_qr_data(
        self, category_id: str, organization_id: str
    ) -> Dict:
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
    ) -> AdminHoursEntry:
        """Clock in a user to an admin hours category via QR scan."""
        category = await self.get_category(category_id, organization_id)
        if not category:
            raise ValueError("Category not found")
        if not category.is_active:
            raise ValueError("This category is no longer active")

        # Check for existing active session (any category)
        active = await self._get_active_session(user_id)
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
            entry_method=AdminHoursEntryMethod.QR_SCAN,
            status=AdminHoursEntryStatus.ACTIVE,
        )
        self.db.add(entry)
        await self.db.flush()
        await self.db.refresh(entry, ["created_at", "updated_at"])

        logger.info("User %s clocked in to category %s", user_id, category.name)
        return entry

    async def clock_out(
        self, entry_id: str, user_id: str
    ) -> AdminHoursEntry:
        """Clock out a user from an active admin hours session."""
        result = await self.db.execute(
            select(AdminHoursEntry).where(
                AdminHoursEntry.id == entry_id,
                AdminHoursEntry.user_id == user_id,
                AdminHoursEntry.status == AdminHoursEntryStatus.ACTIVE,
            )
        )
        entry = result.scalar_one_or_none()
        if not entry:
            raise ValueError("No active session found")

        now = datetime.now(timezone.utc)
        entry.clock_out_at = now
        duration = now - entry.clock_in_at
        entry.duration_minutes = int(duration.total_seconds() / 60)

        # Determine status based on category approval settings
        category = await self.get_category(
            entry.category_id, entry.organization_id
        )
        entry.status = self._determine_post_clockout_status(
            category, entry.duration_minutes
        )

        await self.db.flush()
        logger.info(
            "User %s clocked out: %d minutes", user_id, entry.duration_minutes
        )
        return entry

    async def clock_out_by_category(
        self, category_id: str, user_id: str
    ) -> AdminHoursEntry:
        """Clock out from a specific category (used when scanning same QR again)."""
        result = await self.db.execute(
            select(AdminHoursEntry).where(
                AdminHoursEntry.category_id == category_id,
                AdminHoursEntry.user_id == user_id,
                AdminHoursEntry.status == AdminHoursEntryStatus.ACTIVE,
            )
        )
        entry = result.scalar_one_or_none()
        if not entry:
            raise ValueError("No active session found for this category")

        return await self.clock_out(entry.id, user_id)

    async def get_active_session(
        self, user_id: str
    ) -> Optional[Dict]:
        """Get the user's current active session with category info."""
        entry = await self._get_active_session(user_id)
        if not entry:
            return None

        category = await self.db.execute(
            select(AdminHoursCategory).where(
                AdminHoursCategory.id == entry.category_id
            )
        )
        cat = category.scalar_one_or_none()

        now = datetime.now(timezone.utc)
        elapsed = now - entry.clock_in_at
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
        self, user_id: str
    ) -> Optional[AdminHoursEntry]:
        """Internal: get the active entry for a user."""
        result = await self.db.execute(
            select(AdminHoursEntry).where(
                AdminHoursEntry.user_id == user_id,
                AdminHoursEntry.status == AdminHoursEntryStatus.ACTIVE,
            )
        )
        return result.scalar_one_or_none()

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
        category = await self.get_category(category_id, organization_id)
        if not category:
            raise ValueError("Category not found")
        if not category.is_active:
            raise ValueError("This category is no longer active")

        if clock_out_at <= clock_in_at:
            raise ValueError("Clock-out time must be after clock-in time")

        # Prevent future entries
        now = datetime.now(timezone.utc)
        if clock_in_at > now:
            raise ValueError("Clock-in time cannot be in the future")

        duration = clock_out_at - clock_in_at
        duration_minutes = int(duration.total_seconds() / 60)

        if duration_minutes < 1:
            raise ValueError("Duration must be at least 1 minute")

        # Check for overlapping entries
        overlap = await self._check_overlap(
            user_id, clock_in_at, clock_out_at
        )
        if overlap:
            raise ValueError(
                "This time range overlaps with an existing entry. "
                "Please adjust the times."
            )

        status = self._determine_post_clockout_status(category, duration_minutes)

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
            )
            .join(
                AdminHoursCategory,
                AdminHoursEntry.category_id == AdminHoursCategory.id,
            )
            .outerjoin(Approver, AdminHoursEntry.approved_by == Approver.id)
            .where(base_where)
        )
        count_query = (
            select(func.count(AdminHoursEntry.id)).where(base_where)
        )

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
        for entry, cat_name, cat_color, approver_first, approver_last in rows:
            d = self._entry_to_dict(entry, cat_name, cat_color)
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
            )
            .join(
                AdminHoursCategory,
                AdminHoursEntry.category_id == AdminHoursCategory.id,
            )
            .join(EntryUser, AdminHoursEntry.user_id == EntryUser.id)
            .outerjoin(Approver, AdminHoursEntry.approved_by == Approver.id)
            .where(base_where)
        )
        count_query = (
            select(func.count(AdminHoursEntry.id)).where(base_where)
        )

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
            d = self._entry_to_dict(entry, cat_name, cat_color)
            d["user_name"] = f"{first_name} {last_name}"
            if approver_first and approver_last:
                d["approver_name"] = f"{approver_first} {approver_last}"
            entries.append(d)
        return entries, total

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
        logger.info(
            "Entry %s %sd by %s", entry_id, action, approver_id
        )
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
            AdminHoursEntry.status.in_([
                AdminHoursEntryStatus.APPROVED,
                AdminHoursEntryStatus.PENDING,
            ]),
            AdminHoursEntry.duration_minutes.isnot(None),
        )

        if user_id:
            base_filter = and_(base_filter, AdminHoursEntry.user_id == user_id)
        if start_date:
            base_filter = and_(
                base_filter, AdminHoursEntry.clock_in_at >= start_date
            )
        if end_date:
            base_filter = and_(
                base_filter, AdminHoursEntry.clock_in_at <= end_date
            )

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
                "total_hours": round(int(cat_minutes) / 60, 2),
                "entry_count": cat_count,
            }
            for cat_id, cat_name, cat_color, cat_minutes, cat_count in category_result.all()
        ]

        return {
            "total_hours": round(int(total_minutes) / 60, 2),
            "total_entries": total_entries,
            "approved_hours": round(approved_minutes / 60, 2),
            "approved_entries": approved_entries,
            "pending_hours": round(pending_minutes / 60, 2),
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

        for entry_id in entry_ids:
            result = await self.db.execute(
                select(AdminHoursEntry).where(
                    AdminHoursEntry.id == entry_id,
                    AdminHoursEntry.organization_id == organization_id,
                    AdminHoursEntry.status == AdminHoursEntryStatus.PENDING,
                )
            )
            entry = result.scalar_one_or_none()
            if entry:
                entry.status = AdminHoursEntryStatus.APPROVED
                entry.approved_by = approver_id
                entry.approved_at = now
                approved_count += 1

        await self.db.flush()
        logger.info(
            "Bulk approved %d entries by %s", approved_count, approver_id
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
        writer = csv.writer(output)
        writer.writerow([
            "Member", "Category", "Date", "Clock In", "Clock Out",
            "Duration (hours)", "Method", "Status", "Approved By", "Description",
        ])

        for row in rows:
            entry = row[0]
            cat_name = row[1]
            user_first = row[2]
            user_last = row[3]
            approver_first = row[4]
            approver_last = row[5]

            duration_hours = (
                round(entry.duration_minutes / 60, 2) if entry.duration_minutes else ""
            )
            clock_in = entry.clock_in_at.strftime("%Y-%m-%d %H:%M") if entry.clock_in_at else ""
            clock_out = entry.clock_out_at.strftime("%Y-%m-%d %H:%M") if entry.clock_out_at else ""
            date_str = entry.clock_in_at.strftime("%Y-%m-%d") if entry.clock_in_at else ""
            approver_name = (
                f"{approver_first} {approver_last}"
                if approver_first and approver_last
                else ""
            )

            writer.writerow([
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
            ])

        return output.getvalue()

    # =========================================================================
    # Stale Session Enforcement
    # =========================================================================

    async def auto_close_stale_sessions(self) -> int:
        """Auto-close sessions that exceeded their category's max_hours_per_session.

        Returns the number of sessions auto-closed.
        """
        now = datetime.now(timezone.utc)
        result = await self.db.execute(
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
        rows = result.all()
        closed = 0

        for entry, max_hours in rows:
            max_duration = timedelta(hours=max_hours)
            if now - entry.clock_in_at > max_duration:
                entry.clock_out_at = entry.clock_in_at + max_duration
                entry.duration_minutes = int(max_hours * 60)
                entry.description = (
                    f"{entry.description + ' — ' if entry.description else ''}"
                    f"Auto-closed: exceeded {max_hours}h session limit"
                )
                # Auto-closed entries go to pending for review
                entry.status = AdminHoursEntryStatus.PENDING
                closed += 1
                logger.info(
                    "Auto-closed stale session %s for user %s (%.1fh limit)",
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
        clock_in_at: datetime,
        clock_out_at: datetime,
        exclude_entry_id: Optional[str] = None,
    ) -> bool:
        """Check if a time range overlaps with existing non-rejected entries."""
        query = select(func.count(AdminHoursEntry.id)).where(
            AdminHoursEntry.user_id == user_id,
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
            "entry_method": entry.entry_method.value if entry.entry_method else "manual",
            "status": entry.status.value if entry.status else "pending",
            "approved_by": entry.approved_by,
            "approved_at": entry.approved_at,
            "rejection_reason": entry.rejection_reason,
            "created_at": entry.created_at,
            "updated_at": entry.updated_at,
            "category_name": category_name,
            "category_color": category_color,
            "user_name": user_name,
            "approver_name": None,
        }
        return d
