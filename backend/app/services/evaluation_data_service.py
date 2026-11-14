"""
The figures an evaluation shows beside its items, measured for one member.

Each data source in :mod:`app.services.evaluation_data_sources` is computed
here, over the member's *coverage* within the review period rather than the
nominal period: coverage starts on the first full month after the member
joined (or rejoined), and the gaps between stints of membership and approved
leaves of absence are excluded.

Wherever another screen already decides a figure, this module asks that
screen's code rather than re-deriving it (CLAUDE.md pitfall #29): training
compliance uses the dashboard's grading, training-session attendance the
session-attendance requirement's tally, meeting attendance the voting
check's tally, shift hours and calls the member's own hours page. Two
sources have no existing calculation (events attended, skills tests
passed); they apply the rules the neighbouring screens apply, named at
each.

A figure that cannot honestly be given is reported unavailable with a note,
never as zero or 100%: an empty denominator is "nothing to measure", not a
perfect record.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.attendance_waiver import (
    AttendanceWaiverAction,
    AttendanceWaiverRequest,
    AttendanceWaiverRequestAction,
    AttendanceWaiverStatus,
    AttendanceWaiverWorkflow,
)
from app.models.call_tracking import CallTrackingMode
from app.models.event import Event, EventRSVP
from app.models.meeting import Meeting, MeetingAttendee, MeetingType
from app.models.member_position_term import MemberPositionTerm
from app.models.skills_testing import SkillTest, SkillTestResult, SkillTestStatus
from app.models.training import TrainingRecord, TrainingRequirement
from app.models.user import (
    MemberLeaveOfAbsence,
    MemberServicePeriod,
    Position,
    User,
)
from app.schemas.evaluation import TemplateDefinition
from app.services.admin_hours_service import AdminHoursService
from app.services.call_tracking_service import CallTrackingService
from app.services.evaluation_data_sources import DATA_SOURCES, DATA_SOURCES_BY_KEY
from app.services.member_service_history_service import (
    MemberServiceHistoryService,
    implicit_separation_date,
    is_separated,
)
from app.services.membership_tier_service import tally_attendance
from app.services.qualification_service import (
    QualificationService,
    qualification_label,
)
from app.services.scheduling_service import SchedulingService
from app.services.shift_completion_service import ShiftCompletionService
from app.services.shift_evaluation_service import ShiftEvaluationService
from app.services.training_compliance import (
    ComplianceGrading,
    _load_compliance_config,
    evaluate_member_requirement_detail,
    governing_attendance_requirement,
    load_credited_shift_dates,
    load_graded_records,
    load_held_sessions,
    member_join_date,
    tally_session_attendance,
    tally_standing,
)
from app.services.training_service import (
    CERTIFICATION_EXPIRING_SOON_DAYS,
    TrainingService,
)
from app.services.training_waiver_service import fetch_user_waivers
from app.utils.org_timezone import (
    local_date,
    local_day_start_utc,
    local_range_utc,
    today_in,
)

#: Bumped when the stored shape changes, so a reader can tell an old snapshot
#: from a new one rather than guessing from the keys present.
#: 2: ``training.session_attendance_pct`` is graded by the member's
#: session-attendance requirement (designated sessions, finalized attendance,
#: every waiver) instead of counting every training event's check-ins, and
#: its extras changed. A version-1 snapshot holds the old figure.
SNAPSHOT_VERSION = 2

#: Sources answered from the member's monthly shift totals over the whole
#: coverage. ``calls.response_pct`` reads them too, but only for the days the
#: member was expected to respond, so it loads its own.
_SHIFT_SOURCES = frozenset({"shifts.hours", "shifts.count", "calls.responses"})

#: Kinds of position an evaluation lists. ``system`` positions are the
#: platform's own (the baseline member position, the rank mirrors) and say
#: nothing about what the member did.
_LISTED_POSITION_KINDS = ("office", "committee")

#: The waiver-request sources, each to the workflow whose requests it reads.
#: A summary and a history of the same workflow read the same rows, once.
_WAIVER_SUMMARY_SOURCES = {
    "training.session_waivers_summary": AttendanceWaiverWorkflow.TRAINING_SESSION,
    "meetings.waivers_summary": AttendanceWaiverWorkflow.BUSINESS_MEETING,
}
_WAIVER_HISTORY_SOURCES = {
    "training.session_waiver_history": AttendanceWaiverWorkflow.TRAINING_SESSION,
    "meetings.waiver_history": AttendanceWaiverWorkflow.BUSINESS_MEETING,
}

#: How each logged action reads in a request's outcome history.
_WAIVER_ACTION_TEXT = {
    AttendanceWaiverAction.WITHDRAWN: "withdrawn",
    AttendanceWaiverAction.APPROVED: "approved",
    AttendanceWaiverAction.DENIED: "denied",
    AttendanceWaiverAction.CHIEF_OVERRIDE: "approved on the Chief's override",
    AttendanceWaiverAction.VOIDED: "voided",
    AttendanceWaiverAction.INFO_REQUESTED: "more information asked for",
    AttendanceWaiverAction.MEMBER_RESPONDED: "answered",
    AttendanceWaiverAction.EXPIRED: "expired undecided",
    AttendanceWaiverAction.RESCHEDULED: "session rescheduled",
    AttendanceWaiverAction.MEMBER_CONFIRMED: "new date confirmed",
}

#: Where each action falls in a request's life, to order a log whose times
#: tie (DATETIME keeps whole seconds). The request screens order it the same
#: way (``attendance_waiver_service._ACTION_ORDER``).
_WAIVER_ACTION_ORDER = {
    AttendanceWaiverAction.SUBMITTED: 0,
    AttendanceWaiverAction.WITHDRAWN: 1,
    AttendanceWaiverAction.APPROVED: 1,
    AttendanceWaiverAction.DENIED: 1,
    AttendanceWaiverAction.CHIEF_OVERRIDE: 2,
    AttendanceWaiverAction.VOIDED: 3,
    AttendanceWaiverAction.INFO_REQUESTED: 1,
    AttendanceWaiverAction.MEMBER_RESPONDED: 1,
    AttendanceWaiverAction.RESCHEDULED: 1,
    AttendanceWaiverAction.MEMBER_CONFIRMED: 1,
    AttendanceWaiverAction.EXPIRED: 3,
}


@dataclass(frozen=True)
class _WaiverRow:
    """One waiver request as the evaluation may show it.

    Deliberately has no reason and no decider's note: an evaluation is
    permanent and the member reads it, and either may be medical (owner
    decision, 2026-11-10). The rows are loaded column by column so neither
    is ever read from the database here.
    """

    id: str
    session_date: date
    event_title: str
    status: AttendanceWaiverStatus
    category: Optional[str]
    decided_by: Optional[str]
    chief_override: bool


# ------------------------------------------------------------------ coverage


@dataclass(frozen=True)
class ExcludedRange:
    start: date
    end: date
    reason: str  # "leave" | "separation"


@dataclass(frozen=True)
class Coverage:
    """The part of a review period a member is measured over."""

    start: date
    end: date
    excluded: Tuple[ExcludedRange, ...]

    def excludes(self, day: date) -> bool:
        return any(r.start <= day <= r.end for r in self.excluded)

    def separated_on(self, day: date) -> bool:
        """Whether ``day`` falls in a gap between stints of membership.

        Narrower than :meth:`excludes`, which also covers leaves: a source
        whose own rule already excuses leave, and credits a member who came
        in anyway, drops only the days they were not a member at all.
        """
        return any(
            r.reason == "separation" and r.start <= day <= r.end for r in self.excluded
        )

    def included(self) -> List[Tuple[date, date]]:
        """The stretches of coverage no excluded range touches, oldest first.

        Excluded ranges may overlap (a leave that runs into a gap in
        membership, or two leaves recorded over each other), so they are
        merged before being cut out.
        """
        stretches: List[Tuple[date, date]] = []
        cursor = self.start
        for gap in sorted(self.excluded, key=lambda r: (r.start, r.end)):
            if gap.start > cursor:
                stretches.append((cursor, min(gap.start - timedelta(days=1), self.end)))
            cursor = max(cursor, gap.end + timedelta(days=1))
            if cursor > self.end:
                break
        if cursor <= self.end:
            stretches.append((cursor, self.end))
        return stretches

    def as_json(self) -> Dict[str, Any]:
        return {
            "start": self.start.isoformat(),
            "end": self.end.isoformat(),
            "excluded": [
                {
                    "start": r.start.isoformat(),
                    "end": r.end.isoformat(),
                    "reason": r.reason,
                }
                for r in self.excluded
            ],
        }


def first_full_month(day: date) -> date:
    """The first day of the first calendar month the member served all of.

    A member who joins on the 1st served that whole month; one who joins on
    the 14th is first measured from the 1st of the next (owner decision
    2026-10-31: "a member who joins in November should only be reviewed for
    December requirements").
    """
    if day.day == 1:
        return day
    return (day.replace(day=28) + timedelta(days=4)).replace(day=1)


def served_intervals(
    member: Any,
    periods: Sequence[MemberServicePeriod],
    today: date,
    tz: ZoneInfo,
) -> List[Tuple[Optional[date], Optional[date]]]:
    """The member's stints of membership, oldest first; an open end is None.

    With no recorded stints the member has never separated, unless their
    status says they have, in which case the separation date is the
    service-history module's own estimate.
    """
    hire = member_join_date(member)
    if periods:
        return [(p.start_date or hire, p.end_date) for p in periods]
    end = (
        implicit_separation_date(member, today, tz)
        if is_separated(getattr(member, "status", None))
        else None
    )
    return [(hire, end)]


def compute_coverage(
    period_start: date,
    period_end: date,
    intervals: Sequence[Tuple[Optional[date], Optional[date]]],
    leaves: Iterable[Any],
) -> Optional[Coverage]:
    """Coverage within ``[period_start, period_end]``, or None if the member
    served no full month of it."""
    clipped: List[Tuple[date, date]] = []
    for start, end in intervals:
        if start is None:
            continue
        begin = max(first_full_month(start), period_start)
        finish = min(end, period_end) if end is not None else period_end
        if begin <= finish:
            clipped.append((begin, finish))
    if not clipped:
        return None
    clipped.sort()

    excluded: List[ExcludedRange] = []
    for (_, prev_end), (next_start, _) in zip(clipped, clipped[1:]):
        if next_start > prev_end + timedelta(days=1):
            excluded.append(
                ExcludedRange(
                    prev_end + timedelta(days=1),
                    next_start - timedelta(days=1),
                    "separation",
                )
            )
    start, end = clipped[0][0], max(e for _, e in clipped)
    for leave in leaves:
        leave_end = leave.end_date or end
        lo, hi = max(leave.start_date, start), min(leave_end, end)
        if lo <= hi:
            excluded.append(ExcludedRange(lo, hi, "leave"))
    excluded.sort(key=lambda r: (r.start, r.end))
    return Coverage(start, end, tuple(excluded))


# ------------------------------------------------------------------- values


def _value(value: Any, **extra: Any) -> Dict[str, Any]:
    return {"available": True, "value": value, **extra}


def _unavailable(note: str) -> Dict[str, Any]:
    return {"available": False, "value": None, "note": note}


def _pct(numerator: int, denominator: int) -> float:
    return round(numerator / denominator * 100, 1)


def suggested_score(rule: Optional[Dict[str, Any]], value: Any) -> Optional[int]:
    """The score a data block's rule gives ``value``, or None.

    Bands are ``min`` inclusive and ``max`` exclusive, so a value on a
    boundary lands in the higher band.
    """
    if not rule or not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    for band in rule.get("bands", []):
        upper = band.get("max")
        if value >= band["min"] and (upper is None or value < upper):
            return int(band["score"])
    return None


def sources_used(definition: TemplateDefinition, officer: bool) -> List[str]:
    """The data sources a template's items show, in catalog order."""
    used = {
        item.data_block.source
        for section in definition.sections
        if officer or not section.officer_only
        for item in section.items
        if item.data_block is not None
    }
    return [s.key for s in DATA_SOURCES if s.key in used]


class EvaluationDataService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # -------------------------------------------------------------- coverage

    async def coverage_for(
        self,
        organization_id: str,
        member: User,
        period_start: date,
        period_end: date,
        tz: ZoneInfo,
    ) -> Optional[Coverage]:
        periods = await MemberServiceHistoryService(self.db).list_periods(
            organization_id, member.id
        )
        leaves = (
            (
                await self.db.execute(
                    select(MemberLeaveOfAbsence).where(
                        MemberLeaveOfAbsence.organization_id == organization_id,
                        MemberLeaveOfAbsence.user_id == member.id,
                        MemberLeaveOfAbsence.active.is_(True),
                        MemberLeaveOfAbsence.start_date <= period_end,
                        or_(
                            MemberLeaveOfAbsence.end_date.is_(None),
                            MemberLeaveOfAbsence.end_date >= period_start,
                        ),
                    )
                )
            )
            .scalars()
            .all()
        )
        intervals = served_intervals(member, periods, today_in(tz), tz)
        return compute_coverage(period_start, period_end, intervals, leaves)

    # -------------------------------------------------------------- snapshot

    async def compute(
        self,
        organization_id: str,
        member: User,
        coverage: Coverage,
        keys: Sequence[str],
        tz: ZoneInfo,
    ) -> Dict[str, Dict[str, Any]]:
        """``{source_key: entry}`` for each requested source.

        Each entry is ``{"available", "value", ...}``; an unavailable one
        carries a ``note`` the evaluator and member read.
        """
        values: Dict[str, Dict[str, Any]] = {}
        # Three sources read the same month totals; load them once.
        shift_cache: Dict[str, Dict[str, float]] = {}
        waiver_cache: Dict[AttendanceWaiverWorkflow, List[_WaiverRow]] = {}
        for key in keys:
            if key not in DATA_SOURCES_BY_KEY:
                continue
            if key in _WAIVER_SUMMARY_SOURCES or key in _WAIVER_HISTORY_SOURCES:
                values[key] = await self._compute_waiver_source(
                    key, organization_id, member, coverage, tz, waiver_cache
                )
                continue
            values[key] = await self._compute_one(
                key, organization_id, member, coverage, tz, shift_cache
            )
        return values

    async def _compute_one(
        self,
        key: str,
        org_id: str,
        member: User,
        coverage: Coverage,
        tz: ZoneInfo,
        shift_cache: Dict[str, Dict[str, float]],
    ) -> Dict[str, Any]:
        if key in _SHIFT_SOURCES:
            if "totals" not in shift_cache:
                shift_cache["totals"] = await self._shift_totals(
                    org_id, member, coverage
                )
            return self._from_shifts(key, shift_cache["totals"])
        if key == "calls.response_pct":
            return await self._call_response(org_id, member, coverage)
        if key == "training.hours":
            return await self._training_hours(org_id, member, coverage)
        if key == "training.requirements_met_pct":
            return await self._requirements_met(org_id, member, coverage)
        if key == "training.session_attendance_pct":
            return await self._session_attendance(org_id, member, coverage)
        if key == "events.meeting_attendance_pct":
            return await self._meeting_attendance(org_id, member, coverage)
        if key == "events.attended_count":
            return await self._events_attended(org_id, member, coverage, tz)
        if key == "shifts.performance_rating_avg":
            return await self._performance_rating(org_id, member, coverage)
        if key == "shifts.field_evaluation_averages":
            return await self._field_evaluation_averages(org_id, member, coverage)
        if key == "admin_hours.hours":
            return await self._admin_hours(org_id, member, coverage, tz)
        if key == "skills.tests_passed":
            return await self._skills_passed(org_id, member, coverage, tz)
        if key == "certifications.current":
            return await self._certifications(org_id, member, coverage)
        if key == "certifications.expiring_soon":
            return await self._certifications_expiring(org_id, member, coverage)
        if key == "positions.held":
            return await self._positions(org_id, member, coverage, tz)
        raise ValueError(f"No calculation for data source '{key}'")

    @staticmethod
    def _from_shifts(key: str, totals: Dict[str, float]) -> Dict[str, Any]:
        if key == "shifts.hours":
            return _value(totals["hours"], external_hours=totals["external_hours"])
        if key == "shifts.count":
            return _value(
                int(totals["shifts"]), external_shifts=int(totals["external_shifts"])
            )
        return _value(int(totals["calls"]))

    # ----------------------------------------------------------- per source

    async def _training_hours(
        self, org_id: str, member: User, coverage: Coverage
    ) -> Dict[str, Any]:
        by_type = await TrainingService(self.db).get_training_hours_by_type(
            org_id, UUID(member.id), coverage.start, coverage.end
        )
        return _value(round(sum(float(t.total_hours or 0) for t in by_type), 2))

    async def _grading_inputs(
        self, org_id: str, member: User
    ) -> Tuple[User, List[TrainingRequirement], ComplianceGrading]:
        """The member (positions loaded), the department's active requirements
        and its grading config: what ``ComplianceGrading.for_member`` needs.

        Shared by both training sources so they decide which requirements
        grade the member the same way.
        """
        loaded = (
            await self.db.execute(
                select(User)
                .options(selectinload(User.positions))
                .where(User.id == member.id, User.organization_id == org_id)
            )
        ).scalar_one()
        requirements = list(
            (
                await self.db.execute(
                    select(TrainingRequirement).where(
                        TrainingRequirement.organization_id == org_id,
                        TrainingRequirement.active.is_(True),
                    )
                )
            )
            .scalars()
            .all()
        )
        grading = ComplianceGrading.from_config(
            await _load_compliance_config(self.db, org_id)
        )
        return loaded, requirements, grading

    async def _requirements_met(
        self, org_id: str, member: User, coverage: Coverage
    ) -> Dict[str, Any]:
        """The compliance dashboard's percentage, graded as of coverage end.

        The same steps as ``grade_org_members`` for one member: the
        department's grading config and profiles, its records, credited
        shifts and waivers, each requirement's own window ending on
        ``coverage.end``.
        """
        if member.compliance_exempt:
            return _unavailable("Exempt from training requirements.")
        loaded, requirements, grading = await self._grading_inputs(org_id, member)
        if not requirements:
            return _unavailable("The department has no active training requirements.")
        as_of = coverage.end
        records = await load_graded_records(
            self.db,
            org_id,
            [loaded.id],
            requirements,
            as_of,
            grading.include_current_month,
        )
        shift_dates = await load_credited_shift_dates(
            self.db,
            org_id,
            [loaded.id],
            requirements,
            as_of,
            grading.include_current_month,
        )
        held_sessions = await load_held_sessions(self.db, str(org_id), requirements)
        waivers = await fetch_user_waivers(self.db, org_id, loaded.id)
        member_grading = grading.for_member(loaded, requirements)
        statuses = [
            evaluate_member_requirement_detail(
                req,
                records,
                as_of,
                waivers=waivers,
                org_include_current_month=grading.include_current_month,
                join_date=member_join_date(loaded),
                shift_dates=shift_dates.get(str(loaded.id), []),
                held_sessions=held_sessions,
            ).status
            for req in member_grading.requirements
        ]
        met, total = tally_standing(statuses)
        _, pct = grading.classify(member_grading, met, total)
        if pct is None:
            return _unavailable("No training requirements apply to this member.")
        return _value(pct, met=met, total=total)

    async def _session_attendance(
        self, org_id: str, member: User, coverage: Coverage
    ) -> Dict[str, Any]:
        """Attendance at the sessions the member's requirement counts.

        The requirement's own rule, ``tally_session_attendance`` (CLAUDE.md
        pitfall #29), over the review period rather than the requirement's
        window (owner decision, 2026-11-10). Only the sessions
        linked to the member's session-attendance requirement are counted, a
        member attended one when finalizing it wrote their record, and every
        waiver and leave the training screens apply excuses a session the
        member missed, as does an approved request to be excused from that one
        session, while one they came to anyway still counts. The
        requirement is the one for the member's membership type when several
        apply, and none is guessed at when that does not decide.

        The figure is the counts, not a pass or fail: whether the requirement
        is met is the dashboard's question, answered by
        ``training.requirements_met_pct``, and a Chief's override is judged on
        one cut-off day, which says nothing about a whole review period.

        Days between stints of membership are dropped: the member owed
        nothing then. Leave is not dropped here; the tally excuses it.
        """
        if member.compliance_exempt:
            return _unavailable("Exempt from training requirements.")
        loaded, requirements, grading = await self._grading_inputs(org_id, member)
        choice = governing_attendance_requirement(
            loaded, grading.for_member(loaded, requirements).requirements
        )
        if choice.ambiguous:
            return _unavailable(
                "More than one session-attendance requirement applies to this "
                "member, and their membership type does not single one out."
            )
        req = choice.requirement
        if req is None:
            return _unavailable(
                "No session-attendance requirement applies to this member."
            )
        held = [
            session
            for session in (await load_held_sessions(self.db, str(org_id), [req])).get(
                str(req.id), []
            )
            if not coverage.separated_on(session.held_on)
        ]
        records = (
            (
                await self.db.execute(
                    select(TrainingRecord).where(
                        TrainingRecord.organization_id == org_id,
                        TrainingRecord.user_id == loaded.id,
                        TrainingRecord.source_event_id.in_(
                            [session.event_id for session in held]
                        ),
                    )
                )
            )
            .scalars()
            .all()
            if held
            else []
        )
        tally = tally_session_attendance(
            req,
            records,
            held,
            coverage.end,
            waivers=await fetch_user_waivers(self.db, org_id, loaded.id),
            join_date=member_join_date(loaded),
            window=(coverage.start, coverage.end),
        )
        if tally.held == 0:
            return _unavailable(
                f"No sessions counting toward {req.name} were held in the period."
            )
        # Excused from all of them is nothing to measure, not a perfect record.
        if tally.charged == 0:
            return _unavailable(
                f"Excused from every session counting toward {req.name} "
                "in the period."
            )
        return _value(
            _pct(tally.attended, tally.charged),
            attended=tally.attended,
            held=tally.held,
            excused=tally.held - tally.charged,
            required_pct=float(req.required_attendance_pct or 0),
            requirement=req.name,
        )

    async def _attended_event_ids(
        self, org_id: str, user_id: str, event_ids: Iterable[str]
    ) -> set:
        ids = list(event_ids)
        if not ids:
            return set()
        rows = await self.db.execute(
            select(EventRSVP.event_id).where(
                EventRSVP.organization_id == org_id,
                EventRSVP.user_id == user_id,
                EventRSVP.event_id.in_(ids),
                or_(
                    EventRSVP.checked_in.is_(True),
                    EventRSVP.override_check_in_at.isnot(None),
                ),
            )
        )
        return {row[0] for row in rows.all()}

    async def _meeting_attendance(
        self, org_id: str, member: User, coverage: Coverage
    ) -> Dict[str, Any]:
        """Business meetings attended, through the voting check's own tally.

        The inputs mirror ``MembershipTierService._load_attendance`` with the
        coverage as the window; excluded ranges are passed as leaves so a
        meeting during a gap in membership is dropped like one during a leave.
        """
        filters = [
            Meeting.organization_id == org_id,
            Meeting.meeting_date >= coverage.start,
            Meeting.meeting_date <= coverage.end,
            Meeting.meeting_type == MeetingType.BUSINESS,
        ]
        meetings = [
            (row[0], row[1])
            for row in (
                await self.db.execute(
                    select(Meeting.id, Meeting.meeting_date).where(*filters)
                )
            ).all()
        ]
        in_window = select(Meeting.id).where(*filters)
        waived = {
            row[0]
            for row in (
                await self.db.execute(
                    select(MeetingAttendee.meeting_id).where(
                        MeetingAttendee.user_id == member.id,
                        MeetingAttendee.waiver_reason.isnot(None),
                        MeetingAttendee.meeting_id.in_(in_window),
                    )
                )
            ).all()
        }
        present = {
            row[0]
            for row in (
                await self.db.execute(
                    select(MeetingAttendee.meeting_id).where(
                        MeetingAttendee.user_id == member.id,
                        MeetingAttendee.present.is_(True),
                        MeetingAttendee.meeting_id.in_(in_window),
                    )
                )
            ).all()
        }
        tally = tally_attendance(
            meetings,
            (coverage.start, coverage.end),
            waived,
            present,
            [_Span(r.start, r.end) for r in coverage.excluded],
        )
        # The voting check reads no eligible meetings as 100% so a member is
        # not barred from voting for want of meetings; an evaluation must not
        # present that as a perfect record.
        if not tally.eligible:
            return _unavailable("No business meetings were held in the period.")
        return _value(tally.pct, attended=len(tally.attended), held=len(tally.eligible))

    async def _events_attended(
        self, org_id: str, member: User, coverage: Coverage, tz: ZoneInfo
    ) -> Dict[str, Any]:
        start_utc, end_utc = local_range_utc(coverage.start, coverage.end, tz)
        events = (
            await self.db.execute(
                select(Event.id, Event.start_datetime).where(
                    Event.organization_id == org_id,
                    Event.is_cancelled.is_(False),
                    Event.start_datetime >= start_utc,
                    Event.start_datetime < end_utc,
                )
            )
        ).all()
        in_coverage = [
            eid for eid, at in events if not coverage.excludes(local_date(at, tz))
        ]
        return _value(
            len(await self._attended_event_ids(org_id, member.id, in_coverage))
        )

    async def _shift_totals(
        self, org_id: str, member: User, coverage: Coverage
    ) -> Dict[str, float]:
        """Finalized shift credit from the member's own hours page.

        External hours (worked for another agency) are kept beside the
        department's figure, never added to it (owner decision 2026-11-01).
        """
        months = await SchedulingService(self.db).get_member_month_totals(
            member.id, org_id, coverage.start, coverage.end
        )
        totals = {
            "hours": 0.0,
            "shifts": 0.0,
            "calls": 0.0,
            "external_hours": 0.0,
            "external_shifts": 0.0,
        }
        for entry in months.values():
            for field in totals:
                totals[field] += float(entry.get(field) or 0)
        totals["hours"] = round(totals["hours"], 2)
        totals["external_hours"] = round(totals["external_hours"], 2)
        return totals

    async def _performance_rating(
        self, org_id: str, member: User, coverage: Coverage
    ) -> Dict[str, Any]:
        # Released reports only: the member can read this figure, and a
        # report still in review is not yet theirs to see.
        stats = await ShiftCompletionService(self.db).get_trainee_stats(
            org_id, member.id, coverage.start, coverage.end, released_only=True
        )
        avg = stats.get("avg_rating")
        if avg is None:
            return _unavailable("No rated shift reports in the period.")
        return _value(avg)

    async def _field_evaluation_averages(
        self, org_id: str, member: User, coverage: Coverage
    ) -> Dict[str, Any]:
        """The shift-evaluation screens' own per-form averages
        (``ShiftEvaluationService.averages_by_form``, CLAUDE.md pitfall #29),
        over the coverage and limited to evaluations the member can see, as on
        their own training page: the member reads this figure.
        """
        averages = await ShiftEvaluationService(self.db).averages_by_form(
            member.id,
            org_id,
            start_date=coverage.start,
            end_date=coverage.end,
            member_view=True,
        )
        if not averages:
            return _unavailable("No field shift evaluations in the period.")
        return _value(
            [
                {
                    "label": (
                        f"{a['form_name']}: {a['average']:g} / {a['scale_max']} "
                        f"({a['evaluations']} "
                        f"{'evaluation' if a['evaluations'] == 1 else 'evaluations'})"
                    ),
                    "form_name": a["form_name"],
                    "average": a["average"],
                    "scale_max": a["scale_max"],
                    "evaluations": a["evaluations"],
                }
                for a in averages
            ]
        )

    async def _call_response(
        self, org_id: str, member: User, coverage: Coverage
    ) -> Dict[str, Any]:
        """Shift call credit against the department's call count.

        The two come from different records (crew credit on finalized shifts,
        and the department's call log), so the ratio can exceed 100%; it is
        capped and says so. With call tracking off there is no call count to
        divide by (owner decision 2026-11-01).

        Unlike the call count beside it, the rate is measured only over the
        days the member was expected to respond: calls the department ran
        while the member was on leave, or not a member at all, would otherwise
        count against them as calls missed. Both sides of the ratio drop those
        days, so a call answered during a leave neither helps nor hurts.
        """
        tracking = CallTrackingService(self.db)
        settings = await tracking.get_settings(org_id)
        if settings.get("mode") == CallTrackingMode.OFF:
            return _unavailable("Call tracking is off for the department.")
        stretches = coverage.included()
        total = 0
        for start, end in stretches:
            total += await tracking.department_call_count(org_id, start, end)
        if not total:
            return _unavailable(
                "No department calls were logged while the member was "
                "expected to respond."
                if coverage.excluded
                else "No department calls were logged in the period."
            )
        calls = 0
        scheduling = SchedulingService(self.db)
        for start, end in stretches:
            months = await scheduling.get_member_month_totals(
                member.id, org_id, start, end
            )
            calls += sum(int(entry.get("calls") or 0) for entry in months.values())
        raw = _pct(calls, total)
        return _value(
            min(raw, 100.0),
            responses=calls,
            department_calls=total,
            capped=raw > 100.0,
        )

    async def _admin_hours(
        self, org_id: str, member: User, coverage: Coverage, tz: ZoneInfo
    ) -> Dict[str, Any]:
        start_utc = local_day_start_utc(coverage.start, tz)
        end_utc = local_day_start_utc(coverage.end + timedelta(days=1), tz)
        # get_summary compares the end with <=, so stop an instant before the
        # next local midnight rather than on it.
        summary = await AdminHoursService(self.db).get_summary(
            org_id, member.id, start_utc, end_utc - timedelta(microseconds=1)
        )
        return _value(float(summary.get("approved_hours") or 0))

    async def _skills_passed(
        self, org_id: str, member: User, coverage: Coverage, tz: ZoneInfo
    ) -> Dict[str, Any]:
        """Official, validated passes; the filter ``member_skill_expirations``
        applies, without its expiry-tracking condition."""
        start_utc, end_utc = local_range_utc(coverage.start, coverage.end, tz)
        count = await self.db.scalar(
            select(func.count(SkillTest.id)).where(
                SkillTest.organization_id == org_id,
                SkillTest.candidate_id == member.id,
                SkillTest.is_practice.is_(False),
                SkillTest.status == SkillTestStatus.COMPLETED.value,
                SkillTest.result == SkillTestResult.PASS.value,
                SkillTest.voided_at.is_(None),
                SkillTest.validated_at.isnot(None),
                SkillTest.completed_at >= start_utc,
                SkillTest.completed_at < end_utc,
            )
        )
        return _value(int(count or 0))

    async def _held_certifications(
        self, org_id: str, member: User, coverage: Coverage
    ) -> List[Tuple[str, Optional[date]]]:
        """``(code, expires_on)`` for each qualification in force at coverage
        end, sorted by label. Shared by both certification sources so they
        cannot disagree on what the member held."""
        windows = await QualificationService(self.db).get_member_code_windows(
            member.id, org_id
        )
        in_force = set(QualificationService.codes_in_force(windows, coverage.end))
        held: Dict[str, Optional[date]] = {}
        for code, _granted, expires in windows:
            if code in in_force:
                current = held.get(code)
                # The latest expiry among overlapping grants is the one that
                # decides when the member lapses.
                if code not in held or (
                    current is not None and (expires is None or expires > current)
                ):
                    held[code] = expires
        return sorted(held.items(), key=lambda kv: qualification_label(kv[0]))

    async def _certifications(
        self, org_id: str, member: User, coverage: Coverage
    ) -> Dict[str, Any]:
        held = await self._held_certifications(org_id, member, coverage)
        return _value(
            [
                {
                    "label": qualification_label(code),
                    "expires_on": expires.isoformat() if expires else None,
                }
                for code, expires in held
            ]
        )

    async def _certifications_expiring(
        self, org_id: str, member: User, coverage: Coverage
    ) -> Dict[str, Any]:
        """Qualifications held at coverage end that lapse within
        ``CERTIFICATION_EXPIRING_SOON_DAYS`` after it (owner decision,
        2026-11-14: the training stats' window, counted from the end of the
        period, so the figure reads the same whenever it is opened). One
        expiring on the last day itself is included: it was in force that
        day and lapses the next."""
        horizon = coverage.end + timedelta(days=CERTIFICATION_EXPIRING_SOON_DAYS)
        held = await self._held_certifications(org_id, member, coverage)
        return _value(
            [
                {
                    "label": qualification_label(code),
                    "expires_on": expires.isoformat(),
                }
                for code, expires in held
                if expires is not None and expires <= horizon
            ]
        )

    async def _positions(
        self, org_id: str, member: User, coverage: Coverage, tz: ZoneInfo
    ) -> Dict[str, Any]:
        """Offices and committee seats held at any time during the period.

        Read from ``member_position_terms`` (owner decision 2026-11-06): a term
        counts when ``[started_at, ended_at)`` overlaps the period's
        ``[start, end)``, so a seat given up mid-period is listed and one taken
        after it ended is not. A position held twice in the period is listed
        once. The position's current name is shown, or the name it had when it
        was held if it has since been deleted. History starts when the terms
        table was created: a position given up before then is not known
        (docs/KNOWN_LIMITATIONS.md).
        """
        start_utc, end_utc = local_range_utc(coverage.start, coverage.end, tz)
        name = func.coalesce(Position.name, MemberPositionTerm.position_name)
        kind = func.coalesce(Position.kind, MemberPositionTerm.position_kind)
        query = (
            select(name)
            .select_from(MemberPositionTerm)
            .outerjoin(Position, Position.id == MemberPositionTerm.position_id)
            .where(
                MemberPositionTerm.user_id == member.id,
                MemberPositionTerm.organization_id == org_id,
                kind.in_(_LISTED_POSITION_KINDS),
            )
            .distinct()
            .order_by(name)
        )
        if end_utc is not None:
            query = query.where(MemberPositionTerm.started_at < end_utc)
        if start_utc is not None:
            query = query.where(
                or_(
                    MemberPositionTerm.ended_at.is_(None),
                    MemberPositionTerm.ended_at > start_utc,
                )
            )
        rows = await self.db.execute(query)
        names = [row[0] for row in rows.all()]
        return _value(
            [{"label": label} for label in names],
            note="Positions held at any time during the period.",
        )

    # ------------------------------------------------------- waiver requests

    async def _compute_waiver_source(
        self,
        key: str,
        org_id: str,
        member: User,
        coverage: Coverage,
        tz: ZoneInfo,
        cache: Dict[AttendanceWaiverWorkflow, List[_WaiverRow]],
    ) -> Dict[str, Any]:
        workflow = _WAIVER_SUMMARY_SOURCES.get(key) or _WAIVER_HISTORY_SOURCES[key]
        if workflow not in cache:
            cache[workflow] = await self._waiver_rows(
                org_id, member, coverage, workflow
            )
        rows = cache[workflow]
        if key in _WAIVER_SUMMARY_SOURCES:
            return _waiver_summary(rows)
        return await self._waiver_history(org_id, rows, tz)

    async def _waiver_rows(
        self,
        org_id: str,
        member: User,
        coverage: Coverage,
        workflow: AttendanceWaiverWorkflow,
    ) -> List[_WaiverRow]:
        """The member's requests in ``workflow`` for sessions held in the
        review period, oldest session first.

        Measured by the session's date, not by when the member asked (owner
        decision, 2026-11-10: "use the evaluation period"), so a request made
        in December for a January drill belongs to January's review. Sessions
        held between stints of membership are dropped, as the attendance
        figure drops them; a session during a leave is kept, because the
        member still asked and someone still decided.
        """
        result = await self.db.execute(
            select(
                AttendanceWaiverRequest.id,
                AttendanceWaiverRequest.session_date,
                AttendanceWaiverRequest.event_title_snapshot,
                AttendanceWaiverRequest.status,
                AttendanceWaiverRequest.category,
                AttendanceWaiverRequest.decided_by,
                AttendanceWaiverRequest.chief_override,
            )
            .where(
                AttendanceWaiverRequest.organization_id == org_id,
                AttendanceWaiverRequest.user_id == member.id,
                AttendanceWaiverRequest.workflow == workflow,
                AttendanceWaiverRequest.session_date >= coverage.start,
                AttendanceWaiverRequest.session_date <= coverage.end,
            )
            .order_by(
                AttendanceWaiverRequest.session_date,
                AttendanceWaiverRequest.submitted_at,
                AttendanceWaiverRequest.id,
            )
        )
        return [
            _WaiverRow(
                id=str(row.id),
                session_date=row.session_date,
                event_title=row.event_title_snapshot,
                status=row.status,
                category=row.category,
                decided_by=str(row.decided_by) if row.decided_by else None,
                chief_override=bool(row.chief_override),
            )
            for row in result.all()
            if not coverage.separated_on(row.session_date)
        ]

    async def _waiver_history(
        self, org_id: str, rows: Sequence[_WaiverRow], tz: ZoneInfo
    ) -> Dict[str, Any]:
        """One line per request, with each step of its decision log.

        The log's notes are not read: they are the deciders' own words and
        may repeat the member's reason.
        """
        log: Dict[str, List[Tuple[AttendanceWaiverAction, Optional[str], datetime]]]
        log = {row.id: [] for row in rows}
        if rows:
            result = await self.db.execute(
                select(
                    AttendanceWaiverRequestAction.request_id,
                    AttendanceWaiverRequestAction.action,
                    AttendanceWaiverRequestAction.actor_id,
                    AttendanceWaiverRequestAction.created_at,
                ).where(
                    AttendanceWaiverRequestAction.organization_id == org_id,
                    AttendanceWaiverRequestAction.request_id.in_(list(log)),
                )
            )
            for request_id, action, actor_id, at in result.all():
                log[str(request_id)].append(
                    (action, str(actor_id) if actor_id else None, at)
                )
            for steps in log.values():
                steps.sort(key=lambda s: (_as_utc(s[2]), _WAIVER_ACTION_ORDER[s[0]]))
        names = await self._member_names(
            org_id,
            [row.decided_by for row in rows if row.decided_by]
            + [actor for steps in log.values() for _, actor, _ in steps if actor],
        )
        attached = await self._waiver_attachments_on_file(
            org_id, [row.id for row in rows]
        )

        def name_of(user_id: Optional[str]) -> Optional[str]:
            # An actor whose account is gone (the FK is SET NULL) or who is
            # not in this department reads as such rather than as nobody.
            if user_id is None:
                return None
            return names.get(user_id, "a former member")

        items: List[Dict[str, Any]] = []
        for row in rows:
            history = [
                {
                    "action": action.value,
                    "on": local_date(at, tz).isoformat(),
                    "by": name_of(actor),
                }
                for action, actor, at in log[row.id]
            ]
            outcome = _waiver_outcome(row, log[row.id], name_of)
            on_file = row.id in attached
            label = f"{row.session_date.isoformat()} {row.event_title}: {outcome}"
            if row.category:
                label += f" (category: {row.category})"
            if on_file:
                label += "; attachment on file"
            items.append(
                {
                    "label": label,
                    "session_date": row.session_date.isoformat(),
                    "event_title": row.event_title,
                    "status": row.status.value,
                    "outcome": outcome,
                    "category": row.category,
                    "decided_by": name_of(row.decided_by),
                    "chief_override": row.chief_override,
                    "attachment_on_file": on_file,
                    "history": history,
                }
            )
        return _value(items)

    async def _member_names(
        self, org_id: str, user_ids: Iterable[str]
    ) -> Dict[str, str]:
        ids = sorted({u for u in user_ids if u})
        if not ids:
            return {}
        result = await self.db.execute(
            select(User).where(User.id.in_(ids), User.organization_id == org_id)
        )
        return {str(u.id): u.display_name for u in result.scalars().all()}

    async def _waiver_attachments_on_file(
        self, org_id: str, request_ids: Sequence[str]
    ) -> set:
        """The requests with at least one attachment on file.

        Attachments are being added by a separate change and have no table on
        this branch, so nothing is on file yet and every line reads no. When
        that table lands, return the ids of ``request_ids`` with a row in it
        for ``org_id``. Only the fact is reported, never the file or its
        name: an attachment is the member's evidence, often medical.
        """
        return set()


def _as_utc(value: datetime) -> datetime:
    """MySQL hands back naive DATETIMEs; they are stored in UTC."""
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _waiver_summary(rows: Sequence[_WaiverRow]) -> Dict[str, Any]:
    """How many requests were made in the period, and what became of them.

    ``approved`` is what counts toward the department's cap: approved
    requests, a Chief's override of a denial included (owner decision,
    2026-11-10). ``overridden`` is the part of ``approved`` that came by the
    override, and ``denied`` is denials still standing.
    """
    statuses = [row.status for row in rows]
    approved = statuses.count(AttendanceWaiverStatus.APPROVED)
    overridden = sum(
        1
        for row in rows
        if row.chief_override and row.status == AttendanceWaiverStatus.APPROVED
    )
    counts = {
        "requested": len(rows),
        "approved": approved,
        "overridden": overridden,
        "denied": statuses.count(AttendanceWaiverStatus.DENIED),
        "withdrawn": statuses.count(AttendanceWaiverStatus.WITHDRAWN),
        "pending": statuses.count(AttendanceWaiverStatus.PENDING),
        "voided": statuses.count(AttendanceWaiverStatus.VOIDED),
        # Closed undecided seven days after the session (owner decision,
        # 2026-11-13): an absence, and not a denial, so its own figure.
        "expired": statuses.count(AttendanceWaiverStatus.EXPIRED),
    }
    approved_text = f"{approved} approved"
    if overridden:
        approved_text += f" ({overridden} on the Chief's override)"
    parts = [approved_text] + [
        f"{counts[field]} {field}"
        for field in ("denied", "withdrawn", "pending", "voided", "expired")
        if counts[field] or field in ("denied", "withdrawn")
    ]
    return _value(len(rows), **counts, breakdown=", ".join(parts))


def _waiver_outcome(
    row: _WaiverRow,
    steps: Sequence[Tuple[AttendanceWaiverAction, Optional[str], datetime]],
    name_of: Callable[[Optional[str]], Optional[str]],
) -> str:
    """What happened to a request, in order: "denied by A, then approved on
    the Chief's override by B"."""
    parts = []
    for action, actor, _ in steps:
        text = _WAIVER_ACTION_TEXT.get(action)
        if text is None:
            continue
        # A withdrawal is always the member's own; naming them adds nothing.
        who = name_of(actor) if action != AttendanceWaiverAction.WITHDRAWN else None
        parts.append(f"{text} by {who}" if who else text)
    if not parts:
        return (
            "pending"
            if row.status == AttendanceWaiverStatus.PENDING
            else row.status.value
        )
    if row.status == AttendanceWaiverStatus.PENDING:
        parts.append("pending")
    return ", then ".join(parts)


@dataclass(frozen=True)
class _Span:
    """A leave-shaped range for ``tally_attendance``."""

    start_date: date
    end_date: Optional[date]


def build_snapshot(
    coverage: Coverage,
    values: Dict[str, Dict[str, Any]],
    definition: TemplateDefinition,
    officer: bool,
    taken_at: Optional[datetime] = None,
) -> Dict[str, Any]:
    """The stored snapshot: coverage, each source's entry, and the score each
    scored item's data block suggests."""
    suggested: Dict[str, int] = {}
    for section in definition.sections:
        if section.officer_only and not officer:
            continue
        for item in section.items:
            block = item.data_block
            if block is None or block.scoring_rule is None:
                continue
            entry = values.get(block.source)
            if not entry or not entry.get("available"):
                continue
            score = suggested_score(block.scoring_rule.model_dump(), entry.get("value"))
            if score is not None:
                suggested[item.key] = score
    return {
        "version": SNAPSHOT_VERSION,
        "taken_at": (taken_at or datetime.now(timezone.utc)).isoformat(),
        "coverage": coverage.as_json(),
        "values": values,
        "suggested_scores": suggested,
    }
