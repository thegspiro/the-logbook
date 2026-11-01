"""
The figures an evaluation shows beside its items, measured for one member.

Each data source in :mod:`app.services.evaluation_data_sources` is computed
here, over the member's *coverage* within the review period rather than the
nominal period: coverage starts on the first full month after the member
joined (or rejoined), and the gaps between stints of membership and approved
leaves of absence are excluded.

Wherever another screen already decides a figure, this module asks that
screen's code rather than re-deriving it (CLAUDE.md pitfall #29): training
compliance uses the dashboard's grading, meeting attendance the voting
check's tally, shift hours and calls the member's own hours page. Three
sources have no existing calculation (training-session attendance, events
attended, skills tests passed); they apply the rules the neighbouring
screens apply, named at each.

A figure that cannot honestly be given is reported unavailable with a note,
never as zero or 100%: an empty denominator is "nothing to measure", not a
perfect record.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.call_tracking import CallTrackingMode
from app.models.event import Event, EventRSVP, EventType
from app.models.meeting import Meeting, MeetingAttendee, MeetingType
from app.models.skills_testing import SkillTest, SkillTestResult, SkillTestStatus
from app.models.training import TrainingRequirement
from app.models.user import (
    MemberLeaveOfAbsence,
    MemberServicePeriod,
    Position,
    User,
    user_positions,
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
from app.services.training_compliance import (
    ComplianceGrading,
    _load_compliance_config,
    evaluate_member_requirement_detail,
    load_credited_shift_dates,
    load_graded_records,
    member_join_date,
    tally_standing,
)
from app.services.training_service import TrainingService
from app.services.training_waiver_service import fetch_user_waivers
from app.utils.org_timezone import (
    local_date,
    local_day_start_utc,
    local_range_utc,
    today_in,
)

#: Bumped when the stored shape changes, so a reader can tell an old snapshot
#: from a new one rather than guessing from the keys present.
SNAPSHOT_VERSION = 1

#: Sources answered from the member's monthly shift totals.
_SHIFT_SOURCES = frozenset(
    {"shifts.hours", "shifts.count", "calls.responses", "calls.response_pct"}
)

#: Kinds of position an evaluation lists. ``system`` positions are the
#: platform's own (the baseline member position, the rank mirrors) and say
#: nothing about what the member did.
_LISTED_POSITION_KINDS = ("office", "committee")


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
        # Four sources read the same month totals; load them once.
        shift_cache: Dict[str, Dict[str, float]] = {}
        for key in keys:
            if key in DATA_SOURCES_BY_KEY:
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
            return await self._from_shifts(key, org_id, coverage, shift_cache["totals"])
        if key == "training.hours":
            return await self._training_hours(org_id, member, coverage)
        if key == "training.requirements_met_pct":
            return await self._requirements_met(org_id, member, coverage)
        if key == "training.session_attendance_pct":
            return await self._session_attendance(org_id, member, coverage, tz)
        if key == "events.meeting_attendance_pct":
            return await self._meeting_attendance(org_id, member, coverage)
        if key == "events.attended_count":
            return await self._events_attended(org_id, member, coverage, tz)
        if key == "shifts.performance_rating_avg":
            return await self._performance_rating(org_id, member, coverage)
        if key == "admin_hours.hours":
            return await self._admin_hours(org_id, member, coverage, tz)
        if key == "skills.tests_passed":
            return await self._skills_passed(org_id, member, coverage, tz)
        if key == "certifications.current":
            return await self._certifications(org_id, member, coverage)
        if key == "positions.held":
            return await self._positions(org_id, member, coverage, tz)
        raise ValueError(f"No calculation for data source '{key}'")

    async def _from_shifts(
        self, key: str, org_id: str, coverage: Coverage, totals: Dict[str, float]
    ) -> Dict[str, Any]:
        if key == "shifts.hours":
            return _value(totals["hours"], external_hours=totals["external_hours"])
        if key == "shifts.count":
            return _value(
                int(totals["shifts"]), external_shifts=int(totals["external_shifts"])
            )
        if key == "calls.responses":
            return _value(int(totals["calls"]))
        return await self._call_response(org_id, coverage, int(totals["calls"]))

    # ----------------------------------------------------------- per source

    async def _training_hours(
        self, org_id: str, member: User, coverage: Coverage
    ) -> Dict[str, Any]:
        by_type = await TrainingService(self.db).get_training_hours_by_type(
            org_id, UUID(member.id), coverage.start, coverage.end
        )
        return _value(round(sum(float(t.total_hours or 0) for t in by_type), 2))

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
        if not requirements:
            return _unavailable("The department has no active training requirements.")
        grading = ComplianceGrading.from_config(
            await _load_compliance_config(self.db, org_id)
        )
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
            ).status
            for req in member_grading.requirements
        ]
        met, total = tally_standing(statuses)
        _, pct = grading.classify(member_grading, met, total)
        if pct is None:
            return _unavailable("No training requirements apply to this member.")
        return _value(pct, met=met, total=total)

    async def _session_attendance(
        self, org_id: str, member: User, coverage: Coverage, tz: ZoneInfo
    ) -> Dict[str, Any]:
        """Training events attended out of those held.

        Attended is a check-in or an officer's after-the-fact override, the
        rule ``EventService`` applies to attendance (an override sets only
        ``override_check_in_at``). Sessions on days the member was excused
        from all training by a waiver, or outside their coverage, are dropped
        from both counts; working from id sets drops a session that is both
        exactly once, as ``tally_attendance`` does for meetings.
        """
        start_utc, end_utc = local_range_utc(coverage.start, coverage.end, tz)
        events = (
            await self.db.execute(
                select(Event.id, Event.start_datetime).where(
                    Event.organization_id == org_id,
                    Event.event_type == EventType.TRAINING,
                    Event.is_cancelled.is_(False),
                    Event.start_datetime >= start_utc,
                    Event.start_datetime < end_utc,
                )
            )
        ).all()
        waivers = [
            w
            for w in await fetch_user_waivers(self.db, org_id, member.id)
            if w.requirement_ids is None
        ]
        eligible = set()
        for event_id, starts_at in events:
            day = local_date(starts_at, tz)
            if coverage.excludes(day):
                continue
            if any(w.start_date <= day <= w.end_date for w in waivers):
                continue
            eligible.add(event_id)
        if not eligible:
            return _unavailable("No training sessions were held in the period.")
        attended = await self._attended_event_ids(org_id, member.id, eligible)
        return _value(
            _pct(len(attended), len(eligible)),
            attended=len(attended),
            held=len(eligible),
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
                        MeetingAttendee.waiver_reason.is_(None),
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

    async def _call_response(
        self, org_id: str, coverage: Coverage, calls: int
    ) -> Dict[str, Any]:
        """Shift call credit against the department's call count.

        The two come from different records (crew credit on finalized shifts,
        and the department's call log), so the ratio can exceed 100%; it is
        capped and says so. With call tracking off there is no call count to
        divide by (owner decision 2026-11-01).
        """
        settings = await CallTrackingService(self.db).get_settings(org_id)
        if settings.get("mode") == CallTrackingMode.OFF:
            return _unavailable("Call tracking is off for the department.")
        total = await CallTrackingService(self.db).department_call_count(
            org_id, coverage.start, coverage.end
        )
        if not total:
            return _unavailable("No department calls were logged in the period.")
        raw = _pct(calls, total)
        return _value(
            min(raw, 100.0), responses=calls, department_calls=total, capped=raw > 100.0
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

    async def _certifications(
        self, org_id: str, member: User, coverage: Coverage
    ) -> Dict[str, Any]:
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
        items = [
            {
                "label": qualification_label(code),
                "expires_on": expires.isoformat() if expires else None,
            }
            for code, expires in sorted(
                held.items(), key=lambda kv: qualification_label(kv[0])
            )
        ]
        return _value(items)

    async def _positions(
        self, org_id: str, member: User, coverage: Coverage, tz: ZoneInfo
    ) -> Dict[str, Any]:
        """Offices and committee seats held now and assigned by period end.

        The application keeps no history of positions: removing one deletes
        its row. A position held earlier in the period and since given up
        cannot be listed (docs/KNOWN_LIMITATIONS.md).
        """
        _, end_utc = local_range_utc(coverage.start, coverage.end, tz)
        rows = await self.db.execute(
            select(Position.name)
            .join(user_positions, user_positions.c.position_id == Position.id)
            .where(
                user_positions.c.user_id == member.id,
                Position.organization_id == org_id,
                Position.kind.in_(_LISTED_POSITION_KINDS),
                or_(
                    user_positions.c.assigned_at.is_(None),
                    user_positions.c.assigned_at < end_utc,
                ),
            )
            .order_by(Position.name)
        )
        names = [row[0] for row in rows.all()]
        return _value(
            [{"label": name} for name in names],
            note="Positions held when the figures were taken.",
        )


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
