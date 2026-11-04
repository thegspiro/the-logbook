"""
Shift hours members worked outside the department's own schedule.

A member logs the shift themselves and, by default, it counts immediately. A
department that switches on ``external_shifts_require_approval`` (Scheduling
Settings; owner decision 2026-11-01) has each new entry logged ``pending``
instead: it counts toward nothing until an officer with ``scheduling.manage``
approves it, and the officers are told one is waiting. Either way an officer
who finds an entry wrong rejects it, which takes it out of every total while
keeping the member's claim on record, and can restore it the same way.

Every reader counts ``status == counted`` and nothing else, so "pending does
not count" is the same rule as "rejected does not count" and needs no second
definition (pitfall #29).

The aggregate helpers here are the one definition of "counted external
hours" that the hours report, the member's own history and the shift
compliance report all read, so the three cannot disagree about which rows
count.
"""

import html as _html
from datetime import date, datetime, timezone
from typing import TYPE_CHECKING, Any, Dict, List, Mapping, Optional, Sequence, Tuple

from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload

from app.models.external_shift_hours import (
    ExternalShiftHours,
    ExternalShiftHoursStatus,
)
from app.models.user import ACTIVE_ACCOUNT_STATUSES, Organization, User
from app.services.external_apparatus_service import ExternalApparatusService
from app.utils.hours import hours_from_minutes
from app.utils.model_updates import apply_updates
from app.utils.org_timezone import resolve_scheduling_timezone

if TYPE_CHECKING:
    from app.services.shift_evaluation_service import ShiftEvaluationService

_PENDING = ExternalShiftHoursStatus.PENDING.value
_COUNTED = ExternalShiftHoursStatus.COUNTED.value
_REJECTED = ExternalShiftHoursStatus.REJECTED.value

# Changing any of these changes which hours an approval vouched for, so with
# approval required an edit to one sends a counted entry back for review.
_COUNTED_FIELDS = (
    "shift_date",
    "duration_minutes",
    "start_at",
    "end_at",
    "external_apparatus_id",
)

#: Where the officers' notice sends them: the member-hours report, whose
#: outside-shifts table carries the approve and reject controls.
REVIEW_PATH = "/scheduling/admin/reports"
NOTICE_CATEGORY = "external_shift_approval"


def _whole_minutes(minutes: float) -> int:
    """Minutes as stored, refused when they round to nothing.

    The table's CHECK constraint requires at least one minute. The schema only
    asks for hours above zero, so 0.005 hours, or a start and end a few seconds
    apart, rounded to 0 and failed the constraint at commit — a 500 rather than
    a refusal the member could act on.
    """
    rounded = int(round(minutes))
    if rounded < 1:
        raise ValueError("A shift must be at least one minute long")
    return rounded


def minutes_from_hours(hours: float) -> int:
    return _whole_minutes(float(hours) * 60)


def external_shifts_require_approval(org_settings: Optional[Mapping[str, Any]]) -> bool:
    """Whether the department asks an officer to approve each outside shift.

    Owner decision 2026-11-01 ("optional approval setting"). Absent, or
    anything but an explicit ``true``, means off: an entry counts as soon as
    it is logged, which is what every department had before the setting
    existed (pitfall #19). Read defensively because ``settings`` is JSON an
    admin can hand-edit; a stray value must not hold every member's hours.
    """
    scheduling = (org_settings or {}).get("scheduling")
    if not isinstance(scheduling, Mapping):
        return False
    return scheduling.get("external_shifts_require_approval") is True


class ExternalShiftHoursService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ------------------------------------------------------------------
    # Member self-service
    # ------------------------------------------------------------------

    async def _assert_not_future(self, organization_id: str, shift_date: date) -> None:
        # Judged against the department's local date: a member logging a
        # night shift just after midnight UTC must not be refused for a date
        # that is still today where they worked.
        tz = await resolve_scheduling_timezone(self.db, organization_id)
        if shift_date > datetime.now(tz).date():
            raise ValueError("Shift date cannot be in the future")

    async def _apparatus_snapshot(
        self, organization_id: str, apparatus_id: Any
    ) -> Dict[str, str]:
        """The list entry a member picked, resolved in-org and still active.

        The names are copied onto the shift here so that renaming,
        deactivating or deleting the unit later leaves what was logged
        readable as it was logged.
        """
        found = await ExternalApparatusService(self.db).get_pickable_apparatus(
            organization_id, str(apparatus_id)
        )
        if found is None:
            raise ValueError(
                "Pick an apparatus from the list. If it isn't there, ask a "
                "scheduling officer to add it."
            )
        unit, agency = found
        return {
            "external_apparatus_id": unit.id,
            "agency_name": agency.name,
            "apparatus_name": unit.name,
        }

    async def _span(
        self, organization_id: str, start_at: datetime, end_at: datetime
    ) -> Dict[str, Any]:
        """The columns a start and end fill in.

        The date is the start's calendar date where the department is, so a
        night shift that begins at 19:00 counts on the day it began even
        though it is already the next day in UTC.
        """
        tz = await resolve_scheduling_timezone(self.db, organization_id)
        return {
            "start_at": start_at,
            "end_at": end_at,
            "shift_date": start_at.astimezone(tz).date(),
            "duration_minutes": _whole_minutes(
                (end_at - start_at).total_seconds() / 60
            ),
        }

    async def create(
        self, organization_id: str, user_id: str, payload: Mapping[str, Any]
    ) -> ExternalShiftHours:
        if payload.get("start_at") is not None and payload.get("end_at") is not None:
            timing = await self._span(
                organization_id, payload["start_at"], payload["end_at"]
            )
        else:
            timing = {
                "shift_date": payload["shift_date"],
                "duration_minutes": minutes_from_hours(payload["hours"]),
            }
        await self._assert_not_future(organization_id, timing["shift_date"])
        snapshot = await self._apparatus_snapshot(
            organization_id, payload["external_apparatus_id"]
        )
        org = await self._org(organization_id)
        needs_approval = external_shifts_require_approval(org.settings if org else None)
        entry = ExternalShiftHours(
            organization_id=str(organization_id),
            user_id=str(user_id),
            **timing,
            **snapshot,
            role=payload.get("role"),
            notes=payload.get("notes"),
            status=_PENDING if needs_approval else _COUNTED,
        )
        self.db.add(entry)
        await self.db.commit()
        await self.db.refresh(entry)
        if needs_approval:
            await self.notify_officers_awaiting_approval(entry)
        return entry

    async def _org(self, organization_id: str) -> Optional[Organization]:
        result = await self.db.execute(
            select(Organization).where(Organization.id == str(organization_id))
        )
        org: Optional[Organization] = result.scalar_one_or_none()
        return org

    async def notify_officers_awaiting_approval(
        self, entry: ExternalShiftHours
    ) -> None:
        """Tell every ``scheduling.manage`` holder an outside shift awaits them.

        Email is the channel of record (pitfall #18), under the "Scheduling
        officer duties" kind each officer may turn off; the bell entry goes to
        every officer regardless, so turning the email off never hides the
        task. The member who logged it is left out even when they are an
        officer themselves — they know. One notice per entry put in the queue:
        this runs from the create and from the edit that sends an entry back,
        never from a scheduled task, so there is no rerun to guard against.
        A notice that fails is logged and never undoes the entry.
        """
        try:
            await self._send_awaiting_approval_notice(entry)
        except Exception as e:
            logger.warning(
                "External shift approval notice failed for entry {}: {}",
                entry.id,
                e,
            )
            await self.db.rollback()

    async def _send_awaiting_approval_notice(self, entry: ExternalShiftHours) -> None:
        from app.api.dependencies import user_has_permission
        from app.core.config import settings
        from app.services.email_policy import (
            EmailKind,
            department_required_kinds,
            member_receives_email,
        )
        from app.services.email_service import EmailService, wrap_email_body
        from app.services.officer_alert_copies import add_in_app_copies

        organization_id = str(entry.organization_id)
        org = await self._org(organization_id)
        if org is None:
            return
        members = (
            await self.db.execute(
                select(User)
                .where(User.organization_id == organization_id)
                .where(User.status.in_(ACTIVE_ACCOUNT_STATUSES))
                .where(User.deleted_at.is_(None))
                .options(selectinload(User.positions))
            )
        ).scalars()
        officers = [
            m
            for m in members
            if str(m.id) != str(entry.user_id)
            and user_has_permission(m, "scheduling.manage")
        ]
        if not officers:
            return

        logged_by = (
            await self.db.execute(
                select(User).where(
                    User.id == str(entry.user_id),
                    User.organization_id == organization_id,
                )
            )
        ).scalar_one_or_none()
        name = (logged_by.display_name if logged_by else None) or "A member"
        hours = hours_from_minutes(entry.duration_minutes or 0)
        subject = "An outside shift is waiting for approval"
        message = (
            f"{name} logged {hours:g} hours with {entry.agency_name} "
            f"({entry.apparatus_name}) on {entry.shift_date.isoformat()}. "
            "It counts toward their hours once a scheduling officer approves it."
        )

        await add_in_app_copies(
            self.db,
            organization_id=organization_id,
            recipient_ids=[str(o.id) for o in officers],
            category=NOTICE_CATEGORY,
            subject=subject,
            message=message,
            action_url=REVIEW_PATH,
            metadata={"external_shift_id": str(entry.id)},
        )
        await self.db.commit()

        required = department_required_kinds(org)
        emails = [
            o.email
            for o in officers
            if o.email
            and member_receives_email(
                o.notification_preferences, EmailKind.SCHEDULING_DUTIES, required
            )
        ]
        if not emails:
            return
        url = f"{settings.FRONTEND_URL}{REVIEW_PATH}"
        html_body = wrap_email_body(
            org,
            subject,
            f"<p>{_html.escape(message)}</p>"
            f'<p style="text-align: center;"><a href="{_html.escape(url)}" '
            'class="button" role="link">Review outside shifts</a></p>',
        )
        text_body = f"{message}\n\nReview: {url}\n"
        email_service = EmailService(organization=org)
        # One message per officer: a shared To line would show every
        # officer's address to the others.
        for address in emails:
            await email_service.send_email(
                to_emails=[address],
                subject=subject,
                html_body=html_body,
                text_body=text_body,
            )

    def _evaluations(self) -> "ShiftEvaluationService":
        # Imported here: the evaluation service reaches the training program
        # service, which this scheduling module does not otherwise load.
        from app.services.shift_evaluation_service import ShiftEvaluationService

        return ShiftEvaluationService(self.db)

    async def get(
        self, organization_id: str, entry_id: str, *, user_id: Optional[str] = None
    ) -> Optional[ExternalShiftHours]:
        query = select(ExternalShiftHours).where(
            ExternalShiftHours.id == str(entry_id),
            ExternalShiftHours.organization_id == str(organization_id),
        )
        if user_id is not None:
            query = query.where(ExternalShiftHours.user_id == str(user_id))
        result = await self.db.execute(query)
        entry: Optional[ExternalShiftHours] = result.scalar_one_or_none()
        return entry

    async def update_own(
        self,
        organization_id: str,
        user_id: str,
        entry_id: str,
        updates: Mapping[str, Any],
    ) -> Optional[ExternalShiftHours]:
        entry = await self.get(organization_id, entry_id, user_id=user_id)
        if entry is None:
            return None
        if entry.status == _REJECTED:
            # Editing a rejected entry would let a member quietly change the
            # claim an officer ruled on while it stays rejected, so the
            # record of what was reviewed and what it said drifts apart.
            raise ValueError("A rejected entry cannot be edited")

        changes = dict(updates)
        if "start_at" in changes or "end_at" in changes:
            start_at = changes.pop("start_at", None)
            end_at = changes.pop("end_at", None)
            if start_at is None or end_at is None:
                raise ValueError("Send both a start and an end time")
            if "hours" in changes or "shift_date" in changes:
                raise ValueError(
                    "Send either start and end times, or a date and hours, not both"
                )
            changes.update(await self._span(organization_id, start_at, end_at))
        elif "hours" in changes or "shift_date" in changes:
            # A date or hours corrected on their own leave any recorded times
            # describing a different shift than the one that counts, so they
            # go rather than contradict it.
            changes["start_at"] = None
            changes["end_at"] = None
        if "hours" in changes:
            hours = changes.pop("hours")
            if hours is None:
                raise ValueError("Hours are required")
            changes["duration_minutes"] = minutes_from_hours(hours)
        if changes.get("shift_date") is not None:
            await self._assert_not_future(organization_id, changes["shift_date"])
        if "external_apparatus_id" in changes:
            picked = changes.pop("external_apparatus_id")
            if picked is None:
                raise ValueError("An apparatus is required")
            # Re-sending the unit already on the entry keeps its snapshot, so
            # a shift whose unit was since deactivated can still have its
            # date or hours corrected without being forced onto another one.
            if str(picked) != (entry.external_apparatus_id or ""):
                changes.update(await self._apparatus_snapshot(organization_id, picked))

        before = {field: getattr(entry, field) for field in _COUNTED_FIELDS}
        apply_updates(
            entry,
            changes,
            skip={
                "id",
                "organization_id",
                "user_id",
                "status",
                "reviewed_by",
                "reviewed_at",
                "rejection_reason",
                "created_at",
                "updated_at",
            },
        )
        # An approval vouched for a date, a length and a unit. With approval
        # required, changing one of those after the fact would credit hours no
        # officer saw, so the entry goes back to the queue. A note or role
        # correction leaves it counted.
        sent_back = False
        if entry.status == _COUNTED and any(
            getattr(entry, field) != value for field, value in before.items()
        ):
            org = await self._org(organization_id)
            if external_shifts_require_approval(org.settings if org else None):
                entry.status = _PENDING
                entry.reviewed_by = None
                entry.reviewed_at = None
                sent_back = True
        await self.db.commit()
        await self.db.refresh(entry)
        if sent_back:
            # It stopped counting, so an evaluation of it stops crediting.
            await self._evaluations().sync_credit_for_entry(entry.id, organization_id)
            await self.db.refresh(entry)
            await self.notify_officers_awaiting_approval(entry)
        return entry

    async def delete_own(
        self, organization_id: str, user_id: str, entry_id: str
    ) -> Optional[ExternalShiftHours]:
        entry = await self.get(organization_id, entry_id, user_id=user_id)
        if entry is None:
            return None
        if entry.status == _REJECTED:
            # The rejection is the officer's record; a member removing it
            # would erase the review along with the claim.
            raise ValueError("A rejected entry cannot be deleted")
        evaluations = self._evaluations()
        # Read first: the foreign key nulls the link on delete, after which
        # the evaluations no longer say which entry they described.
        evaluation_ids = await evaluations.submitted_ids_for_entry(
            entry.id, organization_id
        )
        await self.db.delete(entry)
        await self.db.commit()
        # An evaluation of a shift that no longer counts stops crediting it.
        await evaluations._sync_ids(evaluation_ids, organization_id)
        return entry

    # ------------------------------------------------------------------
    # Listing
    # ------------------------------------------------------------------

    async def list_entries(
        self,
        organization_id: str,
        *,
        entry_id: Optional[str] = None,
        user_id: Optional[str] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
        status: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> Tuple[List[Dict[str, Any]], int]:
        member = aliased(User)
        reviewer = aliased(User)

        filters = [ExternalShiftHours.organization_id == str(organization_id)]
        if entry_id is not None:
            filters.append(ExternalShiftHours.id == str(entry_id))
        if user_id is not None:
            filters.append(ExternalShiftHours.user_id == str(user_id))
        if start_date is not None:
            filters.append(ExternalShiftHours.shift_date >= start_date)
        if end_date is not None:
            filters.append(ExternalShiftHours.shift_date <= end_date)
        if status is not None:
            filters.append(ExternalShiftHours.status == status)

        total = (
            await self.db.execute(
                select(func.count(ExternalShiftHours.id)).where(*filters)
            )
        ).scalar_one()

        # The member join is constrained to the org as well: the row's
        # user_id is org-stamped at write, but the name shown beside it
        # must never be resolved from another tenant.
        rows = (
            await self.db.execute(
                select(ExternalShiftHours, member, reviewer)
                .outerjoin(
                    member,
                    (member.id == ExternalShiftHours.user_id)
                    & (member.organization_id == str(organization_id)),
                )
                .outerjoin(
                    reviewer,
                    (reviewer.id == ExternalShiftHours.reviewed_by)
                    & (reviewer.organization_id == str(organization_id)),
                )
                .where(*filters)
                .order_by(
                    ExternalShiftHours.shift_date.desc(),
                    ExternalShiftHours.created_at.desc(),
                )
                .limit(limit)
                .offset(offset)
            )
        ).all()

        statuses = await self._evaluations().entry_statuses(
            [entry for entry, _, _ in rows], organization_id
        )
        items = []
        for entry, m, r in rows:
            item = self.serialize(entry, member=m, reviewer=r)
            item["evaluation_status"] = statuses.get(str(entry.id))
            items.append(item)
        return items, int(total)

    @staticmethod
    def serialize(
        entry: ExternalShiftHours,
        *,
        member: Optional[User] = None,
        reviewer: Optional[User] = None,
    ) -> Dict[str, Any]:
        return {
            "id": entry.id,
            "user_id": entry.user_id,
            "member_name": member.display_name if member is not None else None,
            "shift_date": entry.shift_date,
            "hours": round((entry.duration_minutes or 0) / 60, 2),
            "start_at": entry.start_at,
            "end_at": entry.end_at,
            "external_apparatus_id": entry.external_apparatus_id,
            "agency_name": entry.agency_name,
            "apparatus_name": entry.apparatus_name,
            "role": entry.role,
            "notes": entry.notes,
            "status": entry.status,
            "reviewed_by": entry.reviewed_by,
            "reviewer_name": reviewer.display_name if reviewer is not None else None,
            "reviewed_at": entry.reviewed_at,
            "rejection_reason": entry.rejection_reason,
            "created_at": entry.created_at,
            "updated_at": entry.updated_at,
        }

    # ------------------------------------------------------------------
    # Officer review
    # ------------------------------------------------------------------

    async def reject(
        self, organization_id: str, entry_id: str, reviewer_id: str, reason: str
    ) -> Optional[ExternalShiftHours]:
        entry = await self.get(organization_id, entry_id)
        if entry is None:
            return None
        entry.status = _REJECTED
        entry.reviewed_by = str(reviewer_id)
        entry.reviewed_at = datetime.now(timezone.utc)
        entry.rejection_reason = reason
        await self.db.commit()
        # A rejected shift no longer counts, so its evaluation stops crediting
        # the member's program; restoring it gives the credit back.
        await self._evaluations().sync_credit_for_entry(entry.id, organization_id)
        await self.db.refresh(entry)
        return entry

    async def approve(
        self, organization_id: str, entry_id: str, reviewer_id: str
    ) -> Optional[ExternalShiftHours]:
        """Let a pending entry count. ``ValueError`` unless it is pending.

        Locked so two officers approving at once serialize: the second finds
        it already counted and is told so, rather than re-stamping the review.
        """
        result = await self.db.execute(
            select(ExternalShiftHours)
            .where(
                ExternalShiftHours.id == str(entry_id),
                ExternalShiftHours.organization_id == str(organization_id),
            )
            .with_for_update()
        )
        entry: Optional[ExternalShiftHours] = result.scalar_one_or_none()
        if entry is None:
            return None
        if entry.status != _PENDING:
            await self.db.rollback()
            raise ValueError("This shift is not waiting for approval")
        entry.status = _COUNTED
        entry.reviewed_by = str(reviewer_id)
        entry.reviewed_at = datetime.now(timezone.utc)
        entry.rejection_reason = None
        await self.db.commit()
        # It counts now, so an evaluation already submitted for it credits
        # the member's program from here on.
        await self._evaluations().sync_credit_for_entry(entry.id, organization_id)
        await self.db.refresh(entry)
        return entry

    async def restore(
        self, organization_id: str, entry_id: str, reviewer_id: str
    ) -> Optional[ExternalShiftHours]:
        entry = await self.get(organization_id, entry_id)
        if entry is None:
            return None
        entry.status = _COUNTED
        entry.reviewed_by = str(reviewer_id)
        entry.reviewed_at = datetime.now(timezone.utc)
        entry.rejection_reason = None
        await self.db.commit()
        await self._evaluations().sync_credit_for_entry(entry.id, organization_id)
        await self.db.refresh(entry)
        return entry

    # ------------------------------------------------------------------
    # Aggregates read by the scheduling reports
    # ------------------------------------------------------------------

    async def counted_totals_by_user(
        self,
        organization_id: str,
        start_date: date,
        end_date: date,
        user_ids: Optional[Sequence[str]] = None,
    ) -> Dict[str, Dict[str, int]]:
        """``{user_id: {"shift_count", "minutes"}}`` of counted entries."""
        query = (
            select(
                ExternalShiftHours.user_id,
                func.count(ExternalShiftHours.id).label("shift_count"),
                func.coalesce(func.sum(ExternalShiftHours.duration_minutes), 0).label(
                    "minutes"
                ),
            )
            .where(ExternalShiftHours.organization_id == str(organization_id))
            .where(ExternalShiftHours.status == _COUNTED)
            .where(ExternalShiftHours.shift_date >= start_date)
            .where(ExternalShiftHours.shift_date <= end_date)
            .group_by(ExternalShiftHours.user_id)
        )
        if user_ids is not None:
            if not user_ids:
                return {}
            query = query.where(ExternalShiftHours.user_id.in_(list(user_ids)))
        result = await self.db.execute(query)
        return {
            row.user_id: {
                "shift_count": int(row.shift_count or 0),
                "minutes": int(row.minutes or 0),
            }
            for row in result.all()
        }

    async def counted_totals_by_month(
        self,
        organization_id: str,
        user_id: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> Dict[Tuple[int, int], Dict[str, int]]:
        """``{(year, month): {"shift_count", "minutes"}}`` for one member."""
        year_col = func.year(ExternalShiftHours.shift_date)
        month_col = func.month(ExternalShiftHours.shift_date)
        query = (
            select(
                year_col.label("year"),
                month_col.label("month"),
                func.count(ExternalShiftHours.id).label("shift_count"),
                func.coalesce(func.sum(ExternalShiftHours.duration_minutes), 0).label(
                    "minutes"
                ),
            )
            .where(ExternalShiftHours.organization_id == str(organization_id))
            .where(ExternalShiftHours.user_id == str(user_id))
            .where(ExternalShiftHours.status == _COUNTED)
        )
        if start_date is not None:
            query = query.where(ExternalShiftHours.shift_date >= start_date)
        if end_date is not None:
            query = query.where(ExternalShiftHours.shift_date <= end_date)
        result = await self.db.execute(query.group_by(year_col, month_col))
        return {
            (int(row.year), int(row.month)): {
                "shift_count": int(row.shift_count or 0),
                "minutes": int(row.minutes or 0),
            }
            for row in result.all()
        }

    async def apparatus_summary(
        self, organization_id: str, start_date: date, end_date: date
    ) -> List[Dict[str, Any]]:
        """Counted outside shifts per agency and apparatus, most hours first.

        Grouped by the list entry where the shift still references one, so a
        unit renamed after shifts were logged on it reads as one row under its
        current name. A shift whose unit was since deleted from the list
        falls back to the names snapshotted when it was logged.
        """
        group_key = func.coalesce(
            ExternalShiftHours.external_apparatus_id,
            func.concat(
                ExternalShiftHours.agency_name,
                "\x1f",
                ExternalShiftHours.apparatus_name,
            ),
        )
        rows = (
            await self.db.execute(
                select(
                    group_key.label("key"),
                    func.max(ExternalShiftHours.external_apparatus_id).label(
                        "apparatus_id"
                    ),
                    func.max(ExternalShiftHours.agency_name).label("agency_name"),
                    func.max(ExternalShiftHours.apparatus_name).label("apparatus_name"),
                    func.count(ExternalShiftHours.id).label("shifts"),
                    func.coalesce(
                        func.sum(ExternalShiftHours.duration_minutes), 0
                    ).label("minutes"),
                    func.count(func.distinct(ExternalShiftHours.user_id)).label(
                        "members"
                    ),
                )
                .where(ExternalShiftHours.organization_id == str(organization_id))
                .where(ExternalShiftHours.status == _COUNTED)
                .where(ExternalShiftHours.shift_date >= start_date)
                .where(ExternalShiftHours.shift_date <= end_date)
                .group_by(group_key)
            )
        ).all()

        # Current names for units still on the list, so a rename shows once.
        listed = await ExternalApparatusService(self.db).list_agencies(organization_id)
        current: Dict[str, Dict[str, Any]] = {}
        for agency in listed:
            for unit in agency["apparatus"]:
                current[unit["id"]] = {
                    "agency_name": agency["name"],
                    "apparatus_name": unit["name"],
                    "apparatus_type": unit["apparatus_type"],
                }

        summary = []
        for row in rows:
            names = current.get(row.apparatus_id or "", {})
            summary.append(
                {
                    "external_apparatus_id": row.apparatus_id,
                    "agency_name": names.get("agency_name", row.agency_name),
                    "apparatus_name": names.get("apparatus_name", row.apparatus_name),
                    "apparatus_type": names.get("apparatus_type"),
                    "shifts": int(row.shifts or 0),
                    "minutes": int(row.minutes or 0),
                    "hours": hours_from_minutes(row.minutes or 0),
                    "members": int(row.members or 0),
                }
            )
        summary.sort(
            key=lambda r: (-r["minutes"], r["agency_name"], r["apparatus_name"])
        )
        return summary
