"""
Pre-shift work sessions.

A member scanning a vehicle's QR code or tapping its NFC tag before that
shift's check-in opens can record the time as pre-shift work — the equipment
check done the afternoon before a 04:00 start, say. Each session is tied to
one upcoming shift the member is rostered on, is timed by a second scan, and
counts toward the member's hours only once an officer approves it.

Sessions live beside ``ShiftAttendance``, never in it: see the model's
docstring for why a second attendance row would break check-in and double the
member's shift count.
"""

from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.training import (
    AssignmentStatus,
    PreWorkStatus,
    Shift,
    ShiftAssignment,
    ShiftAttendance,
    ShiftPreWorkSession,
    ShiftStatus,
)
from app.models.user import Organization, User
from app.services.scheduling_service import SchedulingService, _as_utc
from app.utils.apparatus_ref import resolve_apparatus_display_map
from app.utils.member_names import format_display_name

# How far ahead a member may log pre-shift work for. Wide enough for prep the
# afternoon before an early-morning start; narrow enough that the picker on a
# phone lists tomorrow's shift rather than next week's.
PRE_WORK_LOOKAHEAD_HOURS = 48

# A single session longer than a day is a forgotten scan-out, not prep work.
MAX_PRE_WORK_MINUTES = 24 * 60

# Statuses that mean the member is still on the shift's roster. NO_SHOW is
# excluded: nobody preps for a shift they have been marked absent from.
ROSTERED_STATUSES = (
    AssignmentStatus.ASSIGNED,
    AssignmentStatus.CONFIRMED,
    AssignmentStatus.PENDING,
)


def _minutes_between(start: datetime, end: datetime) -> int:
    start_utc = _as_utc(start) or start
    end_utc = _as_utc(end) or end
    return int((end_utc - start_utc).total_seconds() // 60)


def pre_shift_work_enabled(settings: Dict[str, Any]) -> bool:
    """Whether the department lets members record pre-shift work.

    Absent means on: the feature ships enabled, and a department turns it off
    from scheduling settings. Kept in step with
    ``ShiftEligibilityService.get_lifecycle_settings``.
    """
    return bool(
        (settings or {}).get("scheduling", {}).get("pre_shift_work_enabled", True)
    )


async def end_active_session_at_check_in(
    db: AsyncSession, user_id: str, shift_id: str, at: datetime
) -> None:
    """End a still-running session when its member checks in to the shift.

    Called from ``SchedulingService.member_check_in`` inside its transaction,
    so it does not commit. Without it a member who forgot to scan out of the
    prep would carry an open session overlapping the shift itself, and the
    officer would see both spans claiming the same hours.
    """
    session: Optional[ShiftPreWorkSession] = (
        await db.execute(
            select(ShiftPreWorkSession)
            .where(
                ShiftPreWorkSession.user_id == str(user_id),
                ShiftPreWorkSession.shift_id == str(shift_id),
                ShiftPreWorkSession.status == PreWorkStatus.ACTIVE,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if session is None:
        return
    session.ended_at = at
    session.duration_minutes = max(_minutes_between(session.started_at, at), 0)
    session.status = PreWorkStatus.PENDING


async def approved_pre_work_minutes(
    db: AsyncSession,
    *shift_filters: Any,
    group_by: Iterable[Any] = (),
) -> List[Any]:
    """Sum approved pre-shift minutes, joined to ``Shift`` for scoping.

    The one place hours readers get pre-shift time from, so every report
    credits exactly the same thing: ``approved`` sessions, at the minutes the
    officer approved. Pending, rejected and still-running sessions never count.
    Returns rows of ``(*group_by, minutes)``.
    """
    group_cols = list(group_by)
    query = (
        select(
            *group_cols,
            func.coalesce(func.sum(ShiftPreWorkSession.approved_minutes), 0).label(
                "minutes"
            ),
        )
        .select_from(ShiftPreWorkSession)
        .join(Shift, Shift.id == ShiftPreWorkSession.shift_id)
        .where(ShiftPreWorkSession.status == PreWorkStatus.APPROVED)
        .where(*shift_filters)
    )
    if group_cols:
        query = query.group_by(*group_cols)
    return list((await db.execute(query)).all())


async def approved_pre_work_minutes_by_user(
    db: AsyncSession,
    organization_id: UUID | str,
    start_date: date,
    end_date: date,
    *,
    finalized_only: bool,
    user_ids: Optional[List[str]] = None,
) -> Dict[str, int]:
    """Approved pre-shift minutes per member for shifts dated in a range."""
    filters: List[Any] = [
        Shift.organization_id == str(organization_id),
        Shift.shift_date >= start_date,
        Shift.shift_date <= end_date,
    ]
    if finalized_only:
        filters.append(Shift.is_finalized.is_(True))
    if user_ids is not None:
        if not user_ids:
            return {}
        filters.append(ShiftPreWorkSession.user_id.in_(user_ids))
    rows = await approved_pre_work_minutes(
        db, *filters, group_by=[ShiftPreWorkSession.user_id]
    )
    return {str(row[0]): int(row.minutes or 0) for row in rows}


class PreShiftWorkService:
    """Start, end, list and review pre-shift work sessions."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def _org_settings(self, organization_id: UUID | str) -> Dict[str, Any]:
        org = (
            await self.db.execute(
                select(Organization).where(Organization.id == str(organization_id))
            )
        ).scalar_one_or_none()
        return (org.settings or {}) if org else {}

    async def _rostered(self, shift_id: str, user_id: str) -> Optional[ShiftAssignment]:
        found: Optional[ShiftAssignment] = (
            await self.db.execute(
                select(ShiftAssignment)
                .where(
                    ShiftAssignment.shift_id == str(shift_id),
                    ShiftAssignment.user_id == str(user_id),
                    ShiftAssignment.assignment_status.in_(ROSTERED_STATUSES),
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        return found

    @staticmethod
    def _shift_ineligible_reason(
        shift: Shift, settings: Dict[str, Any], now: datetime
    ) -> Optional[str]:
        """Why pre-shift work cannot be logged against this shift, or None."""
        if shift.is_finalized or shift.status == ShiftStatus.CANCELLED:
            return "This shift is closed."
        start = _as_utc(shift.start_time)
        if start is None or start <= now:
            return "Pre-shift work is for a shift that has not started yet."
        if start > now + timedelta(hours=PRE_WORK_LOOKAHEAD_HOURS):
            return (
                "Pre-shift work can be logged up to "
                f"{PRE_WORK_LOOKAHEAD_HOURS} hours before a shift."
            )
        # Once check-in is open the member should simply check in; logging
        # prep on top would credit the same time twice.
        if SchedulingService._checkin_window_error(shift, settings) is None:
            return "Check-in for this shift is open — check in instead."
        return None

    # ------------------------------------------------------------------
    # Member side
    # ------------------------------------------------------------------

    async def eligible_shifts(
        self,
        user_id: str,
        organization_id: UUID | str,
        apparatus_id: Optional[str] = None,
    ) -> Tuple[bool, List[Dict[str, Any]]]:
        """Upcoming shifts the member may log pre-shift work against.

        Returns ``(enabled, shifts)``. A shift on the scanned vehicle sorts
        first so the picker preselects the obvious answer.
        """
        settings = await self._org_settings(organization_id)
        if not pre_shift_work_enabled(settings):
            return False, []

        now = datetime.now(timezone.utc)
        rows = (
            await self.db.execute(
                select(Shift, ShiftAssignment.position)
                .join(ShiftAssignment, ShiftAssignment.shift_id == Shift.id)
                .where(
                    Shift.organization_id == str(organization_id),
                    ShiftAssignment.organization_id == str(organization_id),
                    ShiftAssignment.user_id == str(user_id),
                    ShiftAssignment.assignment_status.in_(ROSTERED_STATUSES),
                    Shift.is_finalized.is_(False),
                    Shift.status != ShiftStatus.CANCELLED,
                    Shift.start_time > now,
                    Shift.start_time <= now + timedelta(hours=PRE_WORK_LOOKAHEAD_HOURS),
                )
                .order_by(Shift.start_time.asc(), Shift.id.asc())
            )
        ).all()

        seen: set[str] = set()
        shifts: List[Tuple[Shift, Optional[str]]] = []
        for shift, position in rows:
            if shift.id in seen:
                continue
            seen.add(shift.id)
            if self._shift_ineligible_reason(shift, settings, now) is None:
                shifts.append((shift, position))

        apparatus_map = await resolve_apparatus_display_map(
            self.db,
            [s.apparatus_id for s, _ in shifts if s.apparatus_id],
            organization_id,
        )
        result = []
        for shift, position in shifts:
            app = (
                apparatus_map.get(str(shift.apparatus_id))
                if shift.apparatus_id
                else None
            )
            result.append(
                {
                    "id": shift.id,
                    "shift_date": shift.shift_date,
                    "start_time": shift.start_time,
                    "end_time": shift.end_time,
                    "apparatus_id": shift.apparatus_id,
                    "apparatus_name": app.name if app else None,
                    "apparatus_unit_number": app.unit_number if app else None,
                    "position": position,
                    "on_scanned_apparatus": bool(
                        apparatus_id and shift.apparatus_id == str(apparatus_id)
                    ),
                }
            )
        result.sort(key=lambda r: not r["on_scanned_apparatus"])
        return True, result

    async def active_session(
        self, user_id: str, organization_id: UUID | str
    ) -> Optional[ShiftPreWorkSession]:
        found: Optional[ShiftPreWorkSession] = (
            await self.db.execute(
                select(ShiftPreWorkSession)
                .where(
                    ShiftPreWorkSession.organization_id == str(organization_id),
                    ShiftPreWorkSession.user_id == str(user_id),
                    ShiftPreWorkSession.status == PreWorkStatus.ACTIVE,
                )
                .order_by(ShiftPreWorkSession.started_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        return found

    async def start(
        self,
        user_id: str,
        organization_id: UUID | str,
        shift_id: str,
        apparatus_id: Optional[str] = None,
    ) -> Optional[ShiftPreWorkSession]:
        """Start a session. Returns None when the shift is not in the org.

        One running session per member. Locks the member's own row to
        serialize the check-then-insert: two taps arriving together (a bounced
        NFC read) would otherwise both see no running session and both start
        one.
        """
        settings = await self._org_settings(organization_id)
        if not pre_shift_work_enabled(settings):
            raise ValueError("Pre-shift work is turned off for your department.")

        await self.db.execute(
            select(User.id)
            .where(
                User.id == str(user_id),
                User.organization_id == str(organization_id),
            )
            .with_for_update()
        )

        shift = (
            await self.db.execute(
                select(Shift).where(
                    Shift.id == str(shift_id),
                    Shift.organization_id == str(organization_id),
                )
            )
        ).scalar_one_or_none()
        if shift is None:
            return None

        now = datetime.now(timezone.utc)
        reason = self._shift_ineligible_reason(shift, settings, now)
        if reason:
            raise ValueError(reason)
        if await self._rostered(shift.id, user_id) is None:
            raise ValueError("You are not on the roster for this shift.")

        if apparatus_id:
            found = await resolve_apparatus_display_map(
                self.db, [apparatus_id], organization_id
            )
            if str(apparatus_id) not in found:
                raise ValueError("Invalid apparatus")

        # Locking read: the user-row lock serializes us, but under REPEATABLE
        # READ a plain SELECT would still answer from the snapshot taken
        # before the lock was granted and miss a session the other request
        # just committed.
        running = (
            await self.db.execute(
                select(ShiftPreWorkSession.id)
                .where(
                    ShiftPreWorkSession.user_id == str(user_id),
                    ShiftPreWorkSession.status == PreWorkStatus.ACTIVE,
                )
                .with_for_update()
            )
        ).first()
        if running is not None:
            raise ValueError(
                "You already have pre-shift work running. End it before starting another."
            )

        session = ShiftPreWorkSession(
            organization_id=str(organization_id),
            shift_id=shift.id,
            user_id=str(user_id),
            apparatus_id=str(apparatus_id) if apparatus_id else None,
            started_at=now,
            status=PreWorkStatus.ACTIVE,
        )
        self.db.add(session)
        await self.db.commit()
        await self.db.refresh(session)
        return session

    async def end(
        self,
        user_id: str,
        organization_id: UUID | str,
        session_id: str,
        note: Optional[str] = None,
    ) -> Optional[ShiftPreWorkSession]:
        """End the member's own running session. None when not found.

        Deliberately not gated on the department setting: turning the feature
        off must not strand a session somebody already started.
        """
        session: Optional[ShiftPreWorkSession] = (
            await self.db.execute(
                select(ShiftPreWorkSession)
                .where(
                    ShiftPreWorkSession.id == str(session_id),
                    ShiftPreWorkSession.organization_id == str(organization_id),
                    ShiftPreWorkSession.user_id == str(user_id),
                )
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if session is None:
            return None
        if session.status != PreWorkStatus.ACTIVE:
            raise ValueError("This pre-shift work has already ended.")

        now = datetime.now(timezone.utc)
        minutes = _minutes_between(session.started_at, now)
        if minutes > MAX_PRE_WORK_MINUTES:
            raise ValueError(
                "This session has run for more than 24 hours. "
                "Ask an officer to record when you finished."
            )
        session.ended_at = now
        session.duration_minutes = max(minutes, 0)
        session.note = (note or "").strip() or None
        session.status = PreWorkStatus.PENDING
        await self.db.commit()
        await self.db.refresh(session)
        return session

    # ------------------------------------------------------------------
    # Officer side
    # ------------------------------------------------------------------

    async def get_session(
        self, session_id: str, organization_id: UUID | str
    ) -> Optional[ShiftPreWorkSession]:
        found: Optional[ShiftPreWorkSession] = (
            await self.db.execute(
                select(ShiftPreWorkSession).where(
                    ShiftPreWorkSession.id == str(session_id),
                    ShiftPreWorkSession.organization_id == str(organization_id),
                )
            )
        ).scalar_one_or_none()
        return found

    async def list_for_shift(
        self, shift_id: str, organization_id: UUID | str
    ) -> List[ShiftPreWorkSession]:
        return list(
            (
                await self.db.execute(
                    select(ShiftPreWorkSession)
                    .where(
                        ShiftPreWorkSession.shift_id == str(shift_id),
                        ShiftPreWorkSession.organization_id == str(organization_id),
                    )
                    .order_by(ShiftPreWorkSession.started_at.asc())
                )
            )
            .scalars()
            .all()
        )

    async def list_awaiting_review(
        self, organization_id: UUID | str
    ) -> List[ShiftPreWorkSession]:
        """Sessions an officer still has to act on.

        Pending ones, plus running ones whose shift has already started — the
        member forgot to scan out, and only an officer can now say when the
        prep ended.
        """
        now = datetime.now(timezone.utc)
        rows = (
            await self.db.execute(
                select(ShiftPreWorkSession, Shift.start_time)
                .join(Shift, Shift.id == ShiftPreWorkSession.shift_id)
                .where(
                    ShiftPreWorkSession.organization_id == str(organization_id),
                    Shift.organization_id == str(organization_id),
                    ShiftPreWorkSession.status.in_(
                        [PreWorkStatus.PENDING, PreWorkStatus.ACTIVE]
                    ),
                )
                .order_by(ShiftPreWorkSession.started_at.asc())
            )
        ).all()
        return [
            session
            for session, start_time in rows
            if session.status == PreWorkStatus.PENDING
            or (_as_utc(start_time) or now) <= now
        ]

    async def review(
        self,
        reviewer: User,
        session_id: str,
        *,
        can_manage: bool,
        approve: bool,
        approved_minutes: Optional[int] = None,
        started_at: Optional[datetime] = None,
        ended_at: Optional[datetime] = None,
        review_note: Optional[str] = None,
    ) -> Optional[ShiftPreWorkSession]:
        """Approve or reject a session. None when it is not in the org.

        Allowed for ``scheduling.manage`` or the shift's officer, except that
        a shift officer may not approve their own time — that takes
        ``scheduling.manage``. Raises ``PermissionError`` for either refusal.
        """
        organization_id = str(reviewer.organization_id)
        shift_id = (
            await self.db.execute(
                select(ShiftPreWorkSession.shift_id).where(
                    ShiftPreWorkSession.id == str(session_id),
                    ShiftPreWorkSession.organization_id == organization_id,
                )
            )
        ).scalar_one_or_none()
        if shift_id is None:
            return None
        # Shift first, then session — the order member_check_in takes them in
        # when a check-in ends a running session. The reverse order here
        # could deadlock against it. The shift lock also guards total_hours,
        # which approving after finalize rewrites and finalize itself writes.
        shift: Optional[Shift] = (
            await self.db.execute(
                select(Shift)
                .where(
                    Shift.id == str(shift_id),
                    Shift.organization_id == organization_id,
                )
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if shift is None:
            return None
        session: Optional[ShiftPreWorkSession] = (
            await self.db.execute(
                select(ShiftPreWorkSession)
                .where(
                    ShiftPreWorkSession.id == str(session_id),
                    ShiftPreWorkSession.organization_id == organization_id,
                )
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if session is None:
            return None

        is_officer = bool(shift.shift_officer_id) and str(
            shift.shift_officer_id
        ) == str(reviewer.id)
        if not (can_manage or is_officer):
            raise PermissionError("Insufficient permissions")
        if str(session.user_id) == str(reviewer.id) and not can_manage:
            raise PermissionError(
                "You can't review your own pre-shift time. "
                "Someone with scheduling management must approve it."
            )

        new_start = _as_utc(started_at) or _as_utc(session.started_at)
        new_end = _as_utc(ended_at) or _as_utc(session.ended_at)
        if new_end is None:
            raise ValueError(
                "This pre-shift work was never ended. Enter when it finished."
            )
        if new_start is None or new_end <= new_start:
            raise ValueError("Pre-shift work must end after it starts.")
        duration = _minutes_between(new_start, new_end)
        if duration > MAX_PRE_WORK_MINUTES:
            raise ValueError("A pre-shift session cannot exceed 24 hours.")

        session.started_at = new_start
        session.ended_at = new_end
        session.duration_minutes = duration
        if approve:
            credited = duration if approved_minutes is None else approved_minutes
            if credited < 1 or credited > MAX_PRE_WORK_MINUTES:
                raise ValueError("Approved minutes must be between 1 and 1440.")
            session.status = PreWorkStatus.APPROVED
            session.approved_minutes = credited
        else:
            session.status = PreWorkStatus.REJECTED
            session.approved_minutes = None
        session.reviewed_by = str(reviewer.id)
        session.reviewed_at = datetime.now(timezone.utc)
        session.review_note = (review_note or "").strip() or None

        if shift.is_finalized:
            await self.db.flush()
            shift.total_hours = await self.shift_total_hours(shift.id)

        await self.db.commit()
        await self.db.refresh(session)
        return session

    async def shift_total_hours(self, shift_id: str) -> float:
        """A shift's stored ``total_hours``: attendance plus approved prep.

        The same unrounded one-decimal snapshot ``finalize_shift`` writes.
        """
        attendance = (
            await self.db.execute(
                select(func.coalesce(func.sum(ShiftAttendance.duration_minutes), 0))
                .where(ShiftAttendance.shift_id == str(shift_id))
                .with_for_update()
            )
        ).scalar() or 0
        prep = await self.approved_minutes_for_shift(shift_id)
        total = int(attendance) + prep
        return round(float(total) / 60.0, 1) if total > 0 else 0.0

    async def approved_minutes_for_shift(self, shift_id: str) -> int:
        rows = await approved_pre_work_minutes(
            self.db, ShiftPreWorkSession.shift_id == str(shift_id)
        )
        return int(rows[0].minutes or 0) if rows else 0

    # ------------------------------------------------------------------
    # Serialization
    # ------------------------------------------------------------------

    async def to_dicts(
        self, sessions: List[ShiftPreWorkSession], organization_id: UUID | str
    ) -> List[Dict[str, Any]]:
        """Sessions as response dicts with member, reviewer and shift context."""
        if not sessions:
            return []
        user_ids = {s.user_id for s in sessions} | {
            s.reviewed_by for s in sessions if s.reviewed_by
        }
        names: Dict[str, str] = {}
        for row in (
            await self.db.execute(
                select(
                    User.id, User.first_name, User.last_name, User.preferred_name
                ).where(
                    User.id.in_(user_ids),
                    User.organization_id == str(organization_id),
                )
            )
        ).all():
            names[str(row.id)] = (
                format_display_name(row.first_name, row.last_name, row.preferred_name)
                or "Unknown"
            )
        shifts = {
            s.id: s
            for s in (
                await self.db.execute(
                    select(Shift).where(
                        Shift.id.in_({x.shift_id for x in sessions}),
                        Shift.organization_id == str(organization_id),
                    )
                )
            )
            .scalars()
            .all()
        }
        apparatus_ids = [x.apparatus_id for x in sessions if x.apparatus_id] + [
            s.apparatus_id for s in shifts.values() if s.apparatus_id
        ]
        apparatus_map = await resolve_apparatus_display_map(
            self.db, apparatus_ids, organization_id
        )

        def _app_name(aid: Optional[str]) -> Optional[str]:
            if not aid:
                return None
            app = apparatus_map.get(str(aid))
            if app is None:
                return None
            return app.name or app.unit_number

        out = []
        for s in sessions:
            shift = shifts.get(s.shift_id)
            out.append(
                {
                    "id": s.id,
                    "shift_id": s.shift_id,
                    "user_id": s.user_id,
                    "user_name": names.get(str(s.user_id)),
                    "apparatus_id": s.apparatus_id,
                    "apparatus_name": _app_name(s.apparatus_id),
                    "started_at": s.started_at,
                    "ended_at": s.ended_at,
                    "duration_minutes": s.duration_minutes,
                    "note": s.note,
                    "status": (
                        s.status.value if hasattr(s.status, "value") else s.status
                    ),
                    "approved_minutes": s.approved_minutes,
                    "reviewed_by": s.reviewed_by,
                    "reviewed_by_name": (
                        names.get(str(s.reviewed_by)) if s.reviewed_by else None
                    ),
                    "reviewed_at": s.reviewed_at,
                    "review_note": s.review_note,
                    "created_at": s.created_at,
                    "shift_date": shift.shift_date if shift else None,
                    "shift_start_time": shift.start_time if shift else None,
                    "shift_end_time": shift.end_time if shift else None,
                    "shift_apparatus_name": (
                        _app_name(shift.apparatus_id) if shift else None
                    ),
                    "shift_officer_id": shift.shift_officer_id if shift else None,
                    "shift_is_finalized": bool(shift.is_finalized) if shift else False,
                }
            )
        return out
