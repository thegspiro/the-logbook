"""
Training Compliance Utilities

Shared functions for evaluating training requirement compliance.
Used by both the dashboard admin-summary and the training compliance-matrix endpoints.
"""

import calendar
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from sqlalchemy import ColumnElement, and_, false, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.compliance_config import ComplianceConfig, ComplianceProfile
from app.models.training import (
    RequirementFrequency,
    RequirementType,
    TrainingRecord,
    TrainingRequirement,
    TrainingStatus,
)
from app.models.user import User, UserStatus
from app.services.training_period import (
    effective_include_current_month,
    resolve_as_of_date,
)
from app.services.training_waiver_service import (
    adjust_required,
    fetch_org_waivers,
    get_rolling_period_months,
)
from app.utils.org_timezone import resolve_org_today


def _get_custom_annual_window(req, today: date):
    """Compute a custom annual compliance window from period_start/end fields.

    Supports cross-year windows (e.g. Nov 1 -> Jan 31) where
    ``period_start_month`` > ``period_end_month``.  In that case the window
    spans from the *previous* year's start month to the current year's end
    month.  The function determines which cycle ``today`` falls in and
    returns the appropriate (start_date, end_date) pair, or *None* if no
    custom period end is configured so the caller can fall back to the
    default Jan 1 – Dec 31 window.
    """
    end_month = getattr(req, "period_end_month", None)
    if not end_month:
        return None

    start_month = getattr(req, "period_start_month", None) or 1
    start_day = getattr(req, "period_start_day", None) or 1
    end_day = getattr(req, "period_end_day", None)
    if not end_day:
        end_day = calendar.monthrange(today.year, end_month)[1]

    crosses_year = start_month > end_month

    if crosses_year:
        # Example: start_month=11 (Nov), end_month=1 (Jan)
        # Two candidate cycles:
        #   Cycle A: Nov <year-1> -> Jan <year>
        #   Cycle B: Nov <year>   -> Jan <year+1>
        cycle_end_a = date(today.year, end_month, end_day)
        cycle_start_a = date(today.year - 1, start_month, start_day)
        cycle_end_b = date(today.year + 1, end_month, end_day)
        cycle_start_b = date(today.year, start_month, start_day)

        if cycle_start_a <= today <= cycle_end_a:
            return cycle_start_a, cycle_end_a
        if cycle_start_b <= today <= cycle_end_b:
            return cycle_start_b, cycle_end_b

        # Gap between cycles (e.g. Feb-Oct for a Nov-Jan window).
        # Extend the most recently ended cycle through the gap so that
        # late completions still satisfy the current year's requirement.
        gap_end = cycle_start_b - timedelta(days=1)
        return cycle_start_a, gap_end
    else:
        # Same-year window (e.g. Mar 1 -> Jun 30)
        yr = req.year if req.year else today.year
        return date(yr, start_month, start_day), date(yr, end_month, end_day)


def biannual_window(req, today: date) -> tuple[date, date]:
    """The window a BIANNUAL ("Every 2 Years") requirement is graded over.

    The requirement's year and the calendar year before it, or the current
    and previous years when it names none. This is the one definition: the
    compliance evaluators, the training service, the competency matrix and
    the scheduling compliance report all call it. BIANNUAL used to have no
    window here, so hours, shifts and calls counted from a member's whole
    history (owner decision BIANNUAL-window, 2026-10-05).
    """
    base_year = getattr(req, "year", None) or today.year
    return date(base_year - 1, 1, 1), date(base_year, 12, 31)


def get_requirement_date_window(req, today: date):
    """Return (start_date, end_date) for evaluating a requirement's compliance window.

    Handles rolling periods: when ``due_date_type`` is ``rolling`` and
    ``rolling_period_months`` is set, the window spans from
    ``today - rolling_period_months`` to ``today``.

    For annual requirements with ``period_end_month`` set, supports custom
    completion windows — including cross-year windows where
    ``period_start_month`` > ``period_end_month`` (e.g. November to January).
    """
    # Check for rolling period first (overrides frequency-based window)
    due_date_type = getattr(req, "due_date_type", None)
    if due_date_type:
        due_date_type = (
            due_date_type.value
            if hasattr(due_date_type, "value")
            else str(due_date_type)
        )
    rolling_months = getattr(req, "rolling_period_months", None)

    if due_date_type == "rolling" and rolling_months:
        from dateutil.relativedelta import relativedelta

        return today - relativedelta(months=rolling_months), today

    freq = (
        req.frequency.value if hasattr(req.frequency, "value") else str(req.frequency)
    )
    current_year = today.year

    if freq == RequirementFrequency.ONE_TIME.value:
        return None, None
    elif freq == RequirementFrequency.BIANNUAL.value:
        return biannual_window(req, today)
    elif freq == RequirementFrequency.QUARTERLY.value:
        quarter_month = ((today.month - 1) // 3) * 3 + 1
        start_date = date(current_year, quarter_month, 1)
        end_month = quarter_month + 2
        end_year = current_year
        if end_month > 12:
            end_month -= 12
            end_year += 1
        end_day = calendar.monthrange(end_year, end_month)[1]
        return start_date, date(end_year, end_month, end_day)
    elif freq == RequirementFrequency.MONTHLY.value:
        start_date = date(current_year, today.month, 1)
        end_day = calendar.monthrange(current_year, today.month)[1]
        return start_date, date(current_year, today.month, end_day)
    else:
        # Annual (default) — check for custom period window first
        custom = _get_custom_annual_window(req, today)
        if custom:
            return custom
        yr = req.year if req.year else current_year
        return date(yr, 1, 1), date(yr, 12, 31)


def requirement_as_of(req, today: date, org_include_current_month: bool) -> date:
    """The date ``req`` is graded as of: ``today``, or the end of last month.

    The requirement's own ``include_current_month`` overrides the org default.
    The grader and :func:`graded_records_clause` both resolve it here, so the
    records loaded are the records the grader's windows were computed from.
    """
    return resolve_as_of_date(
        today,
        effective_include_current_month(
            getattr(req, "include_current_month", None),
            org_include_current_month,
        ),
    )


def recency_cutoff(req, today: date) -> Optional[date]:
    """Earliest completion date still fresh enough to count, or None.

    ``recency_days`` is a validity window on the completion itself: a recruit
    school can demand CPR taken within the last 180 days even though the
    department's own CPR requirement is a one-time item that never expires.
    None means no freshness constraint — any completion counts however old.
    """
    days = getattr(req, "recency_days", None)
    if not days or days <= 0:
        return None
    return today - timedelta(days=int(days))


def is_recent_enough(req, record, today: date) -> bool:
    """Is ``record``'s completion inside the requirement's freshness window?

    A record with no completion date is treated as *not* fresh whenever a window
    is set: the window can't be verified, and silently counting it would let
    exactly the stale completions the officer meant to exclude through.
    """
    cutoff = recency_cutoff(req, today)
    if cutoff is None:
        return True
    completion = getattr(record, "completion_date", None)
    return completion is not None and completion >= cutoff


def apply_recency(req, records, today: date):
    """Drop records that fall outside the requirement's freshness window.

    Applied *on top of* the frequency date window rather than replacing it, so
    the narrower of the two always wins and this can only ever remove records
    from consideration.
    """
    if recency_cutoff(req, today) is None:
        return records
    return [r for r in records if is_recent_enough(req, r, today)]


def completion_window(req, as_of: date) -> Tuple[Optional[date], Optional[date]]:
    """The completion dates a windowed requirement can count, as of ``as_of``.

    The frequency window (:func:`get_requirement_date_window`) narrowed by the
    freshness cutoff (:func:`recency_cutoff`). ``(start, None)`` means
    "``start`` or later", which only a freshness cutoff on an otherwise
    unbounded (one-time) requirement produces; ``(None, None)`` means any
    completion date, including none at all.

    This is the window, not the certification rule: a CERTIFICATION
    requirement ignores its frequency window, so callers handle that type
    before asking. Shared by :func:`graded_records_clause` and
    ``TrainingService._preload_window``.
    """
    start, end = get_requirement_date_window(req, as_of)
    if not (start and end):
        start, end = None, None
    cutoff = recency_cutoff(req, as_of)
    if cutoff is not None:
        start = cutoff if start is None else max(start, cutoff)
    return start, end


def hours_record_counts(req, record) -> bool:
    """Whether ``record`` counts toward HOURS requirement ``req``.

    The one definition (CLAUDE.md pitfall 29). My Training and the compliance
    screens used to apply different halves of it: one narrowed by course and
    ignored the requirement's categories, the other the reverse, so a member
    could read "met" on one and "not met" on the other. Each criterion the
    requirement sets narrows the pool; one it leaves unset restricts nothing,
    so "24 hours of any training" still counts every record.

    ``TrainingService._record_satisfies_requirement`` and both HOURS branches
    of ``TrainingService`` call this; the SQL-sum path in
    ``check_requirement_progress`` applies the same three filters in SQL.
    """
    if req.training_type and record.training_type != req.training_type:
        return False
    category_ids = getattr(req, "category_ids", None)
    if category_ids:
        if not record.category_id or str(record.category_id) not in {
            str(c) for c in category_ids
        }:
            return False
    required_courses = getattr(req, "required_courses", None)
    if required_courses:
        if not record.course_id or str(record.course_id) not in {
            str(c) for c in required_courses
        }:
            return False
    return True


def certification_record_matches(req, record) -> bool:
    """Does ``record`` satisfy the CERTIFICATION requirement ``req``?

    A certification requirement is satisfied by any completed training record
    that ties back to it. The tie can be made four ways, in descending order of
    precision:

    1. An explicit catalog course linked on the requirement
       (``required_courses``). This is the only exact match — the officer picked
       the course out of the library, so a record for that course is
       unambiguously the certification in question.
    2. The requirement's ``training_type``.
    3. The requirement name appearing in the record's course name — for
       legacy records only (see below).
    4. The requirement's registry code appearing in the certification number.

    Matches 2–4 are heuristics kept for requirements created before the library
    link existed (and for imported records that carry no course id), which is
    why linking a course *widens* the match rather than replacing it: an
    existing "CPR" requirement must keep crediting the records it already
    credited when an officer links the CPR course to it.

    The name match let any course containing the requirement's name satisfy
    it — a "CPR Refresher" event credited a "CPR" certification. The owner
    chose to keep it for legacy records only rather than drop it (which would
    have changed published compliance overnight): it applies to a record
    completed on or before the requirement's ``name_match_until``, the day
    this installation's rule changed (see :func:`_name_match_is_legacy`).
    Requirements created since carry no cut-off and never match by name.

    Shared by the compliance matrix, the member compliance summary, and the
    competency matrix so all three agree on what counts.
    """
    linked_courses = getattr(req, "required_courses", None) or []
    if linked_courses:
        course_id = getattr(record, "course_id", None)
        if course_id and str(course_id) in {str(c) for c in linked_courses}:
            return True

    req_training_type = getattr(req, "training_type", None)
    if req_training_type and record.training_type == req_training_type:
        return True

    req_name = getattr(req, "name", None)
    if (
        record.course_name
        and req_name
        and req_name.lower() in record.course_name.lower()
        and _name_match_is_legacy(req, record)
    ):
        return True

    registry_code = getattr(req, "registry_code", None)
    if (
        record.certification_number
        and registry_code
        and registry_code.lower() in record.certification_number.lower()
    ):
        return True

    return False


def _name_match_is_legacy(req, record) -> bool:
    """Whether ``record`` predates ``req``'s name-match cut-off.

    Dated by its completion date. A completed record with none is dated by
    when it was entered, so an undated record written after the cut-off
    cannot borrow the legacy rule; one with neither date is not legacy.
    """
    until = getattr(req, "name_match_until", None)
    if until is None:
        return False
    when = getattr(record, "completion_date", None)
    if when is None:
        created_at = getattr(record, "created_at", None)
        when = created_at.date() if created_at is not None else None
    return when is not None and when <= until


def counts_shift_attendance(req) -> bool:
    """Whether SHIFTS requirement ``req`` is counted from shifts worked.

    The owner's decision (shifts-three-sources): a "shifts completed"
    requirement is counted from ``ShiftAttendance`` — the measured figure the
    hours reports already use — on every screen, not from training records on
    some and attendance on others. ``shift_credited`` ("may shift attendance
    satisfy this requirement?") defaults on for SHIFTS; an officer who turns it
    off keeps the requirement on training records everywhere instead, and the
    scheduling Shift Compliance report leaves it out, as it always has.

    ``is True`` rather than truthiness: only a real column value opts in.
    """
    req_type = getattr(req, "requirement_type", None)
    req_type = getattr(req_type, "value", req_type)
    return (
        req_type == RequirementType.SHIFTS.value
        and getattr(req, "shift_credited", False) is True
    )


def credited_shifts_in_window(
    req, shift_dates: Sequence[date], as_of: date
) -> List[date]:
    """The worked shifts that count toward ``req`` as of ``as_of``.

    ``shift_dates`` is one date per shift worked (see
    :func:`load_credited_shift_dates`). The window is the one a training
    record is held to — :func:`completion_window`, the frequency window
    narrowed by any freshness cutoff — so moving a SHIFTS requirement from
    records to attendance changes what is counted, never the period.
    """
    start, end = completion_window(req, as_of)
    return [
        d
        for d in shift_dates
        if (start is None or d >= start) and (end is None or d <= end)
    ]


def _require_shift_dates(req, shift_dates: Optional[Sequence[date]]):
    """``shift_dates``, or a loud failure when a caller did not load them.

    Grading an attendance-counted requirement without the member's shifts
    would read zero for everybody, a plausible number nobody would question.
    """
    if shift_dates is None:
        raise ValueError(
            f"Requirement {getattr(req, 'id', '?')} counts shifts worked; "
            "pass the member's shift_dates (load_credited_shift_dates)"
        )
    return shift_dates


@dataclass(frozen=True)
class RequirementEvaluation:
    """A single member's standing against a single requirement.

    Carries the numbers the evaluator already computes internally so callers
    can render "9 of 12 hours" rather than re-deriving it from raw records —
    notably the compliance matrix, which has to show *why* a member is short.

    ``progress_required`` is the target after waiver adjustment;
    ``base_required`` is what it would have been without a waiver. They differ
    only when ``waived_months`` is non-zero, which is the signal a UI needs to
    explain a reduced target to the person reading it.
    """

    status: str
    completion_date: Optional[str] = None
    expiry_date: Optional[str] = None
    progress_current: Optional[float] = None
    progress_required: Optional[float] = None
    progress_unit: Optional[str] = None
    base_required: Optional[float] = None
    waived_months: int = 0
    window_start: Optional[str] = None
    window_end: Optional[str] = None
    as_of: Optional[str] = None
    catch_up_deadline: Optional[str] = None


def evaluate_member_requirement_detail(
    req,
    member_records,
    today: date,
    waivers=None,
    org_include_current_month: bool = True,
    join_date: Optional[date] = None,
    shift_dates: Optional[Sequence[date]] = None,
) -> RequirementEvaluation:
    """Evaluate one member against one requirement, honouring a catch-up period.

    The grading itself lives in :func:`_grade_member_requirement`; this adds
    the one member-specific rule that grading cannot see: an existing member
    inside the requirement's catch-up period (see :func:`catch_up_deadline`)
    whose requirement is not yet met is reported as ``catch_up`` rather than
    unmet, carrying the deadline. ``join_date`` is the member's
    :func:`member_join_date`; omitting it skips the rule.

    ``shift_dates`` is the member's worked shifts from
    :func:`load_credited_shift_dates`, required whenever ``req`` is counted
    from attendance (:func:`counts_shift_attendance`).
    """
    ev = _grade_member_requirement(
        req,
        member_records,
        today,
        waivers=waivers,
        org_include_current_month=org_include_current_month,
        shift_dates=shift_dates,
    )
    # Measured against the real day rather than the evaluation cut-off: the
    # deadline is a calendar promise to the member, not a period boundary.
    deadline = catch_up_deadline(req, join_date, today)
    if deadline is not None and ev.status != TrainingStatus.COMPLETED.value:
        return replace(
            ev, status=CATCH_UP_STATUS, catch_up_deadline=deadline.isoformat()
        )
    return ev


def _grade_member_requirement(
    req,
    member_records,
    today: date,
    waivers=None,
    org_include_current_month: bool = True,
    shift_dates: Optional[Sequence[date]] = None,
) -> RequirementEvaluation:
    """
    Evaluate a single member's status for a single requirement.

    Returns a :class:`RequirementEvaluation`. ``evaluate_member_requirement``
    wraps this and returns only the (status, completion, expiry) triple that
    predates it; the two must stay in lockstep on status, so keep the decision
    logic here and never branch on which caller is asking.

    ``today`` is the real current date; the effective evaluation date is
    resolved per requirement from its ``include_current_month`` override
    (falling back to ``org_include_current_month``). When a requirement opts
    to stop at the previous month, the in-progress month is excluded from the
    window, proration, and overdue checks.

    When *waivers* is provided, required hours/shifts/calls are adjusted
    for waived months so members on leave are not penalised.

    Matching strategy depends on requirement_type:
    - HOURS:          Sum hours of completed records matching training_type within date window
    - COURSES:        Check if required course IDs are all completed
    - CERTIFICATION:  Check for matching records (see certification_record_matches)
    - SHIFTS:         Count shifts worked within the window
                      (:func:`counts_shift_attendance`), or matching records
                      when the requirement is not shift-credited
    - CALLS:          Count matching records within date window
    - Others:         Match by training_type or name
    """
    req_type = (
        req.requirement_type.value
        if hasattr(req.requirement_type, "value")
        else str(req.requirement_type)
    )
    freq = (
        req.frequency.value if hasattr(req.frequency, "value") else str(req.frequency)
    )
    # Resolve the effective evaluation date for this requirement (per-requirement
    # override inherits the org default). Everything below — window, proration,
    # and expiry/overdue checks — keys off this date.
    today = requirement_as_of(req, today, org_include_current_month)
    start_date, end_date = get_requirement_date_window(req, today)
    _waivers = waivers or []

    def _ev(
        status,
        comp=None,
        exp=None,
        *,
        current=None,
        required=None,
        unit=None,
        base=None,
        waived=0,
    ) -> RequirementEvaluation:
        return RequirementEvaluation(
            status=status,
            completion_date=comp,
            expiry_date=exp,
            progress_current=current,
            progress_required=required,
            progress_unit=unit,
            base_required=base,
            waived_months=waived,
            window_start=start_date.isoformat() if start_date else None,
            window_end=end_date.isoformat() if end_date else None,
            as_of=today.isoformat(),
        )

    # Filter completed records within the date window. Which records each
    # branch below reads is mirrored by graded_records_clause, which bounds
    # the load feeding this function — change one, change the other.
    completed = [r for r in member_records if r.status == TrainingStatus.COMPLETED]
    # A freshness window narrows the pool for every requirement type before the
    # frequency window is applied, so a stale completion can't satisfy anything
    # — including a one_time requirement, whose frequency window is unbounded.
    completed = apply_recency(req, completed, today)
    if start_date and end_date:
        windowed = [
            r
            for r in completed
            if r.completion_date and start_date <= r.completion_date <= end_date
        ]
    else:
        windowed = completed

    # ---- HOURS requirements: sum hours of the records that count ----
    if req_type == RequirementType.HOURS.value:
        type_matched = [r for r in windowed if hours_record_counts(req, r)]

        total_hours = sum(r.hours_completed or 0 for r in type_matched)
        required = req.required_hours or 0
        base_required = required
        waived_months = 0

        if required > 0 and start_date and end_date and _waivers:
            required, waived_months, _ = adjust_required(
                required,
                start_date,
                end_date,
                _waivers,
                str(req.id),
                period_months=get_rolling_period_months(req),
            )

        progress = {
            "current": total_hours,
            "required": required,
            "unit": "hours",
            "base": base_required,
            "waived": waived_months,
        }

        latest = (
            max(type_matched, key=lambda r: r.completion_date or date.min)
            if type_matched
            else None
        )
        latest_comp = (
            latest.completion_date.isoformat()
            if latest and latest.completion_date
            else None
        )
        latest_exp = (
            latest.expiration_date.isoformat()
            if latest and latest.expiration_date
            else None
        )

        if freq == RequirementFrequency.BIANNUAL.value and type_matched:
            with_exp = [r for r in type_matched if r.expiration_date]
            if with_exp:
                newest_cert = max(with_exp, key=lambda r: r.expiration_date)
                if newest_cert.expiration_date < today:
                    exp_comp = (
                        newest_cert.completion_date.isoformat()
                        if newest_cert.completion_date
                        else latest_comp
                    )
                    exp_exp = newest_cert.expiration_date.isoformat()
                    return _ev("expired", exp_comp, exp_exp, **progress)

        if required > 0 and total_hours >= required:
            return _ev("completed", latest_comp, latest_exp, **progress)
        elif total_hours > 0:
            return _ev("in_progress", latest_comp, latest_exp, **progress)
        else:
            return _ev("not_started", None, None, **progress)

    # ---- COURSES requirements: check required course IDs ----
    if req_type == RequirementType.COURSES.value:
        course_ids = req.required_courses or []
        if not course_ids:
            return _ev("not_started", None, None)

        completed_course_ids = {str(r.course_id) for r in windowed if r.course_id}
        matched_count = sum(1 for cid in course_ids if cid in completed_course_ids)

        progress = {
            "current": matched_count,
            "required": len(course_ids),
            "unit": "courses",
            "base": len(course_ids),
        }

        latest = (
            max(windowed, key=lambda r: r.completion_date or date.min)
            if windowed
            else None
        )
        latest_comp = (
            latest.completion_date.isoformat()
            if latest and latest.completion_date
            else None
        )
        latest_exp = (
            latest.expiration_date.isoformat()
            if latest and latest.expiration_date
            else None
        )

        if freq == RequirementFrequency.BIANNUAL.value and windowed:
            with_exp = [r for r in windowed if r.expiration_date]
            if with_exp:
                newest_cert = max(with_exp, key=lambda r: r.expiration_date)
                if newest_cert.expiration_date < today:
                    exp_comp = (
                        newest_cert.completion_date.isoformat()
                        if newest_cert.completion_date
                        else latest_comp
                    )
                    exp_exp = newest_cert.expiration_date.isoformat()
                    return _ev("expired", exp_comp, exp_exp, **progress)

        if matched_count >= len(course_ids):
            return _ev("completed", latest_comp, latest_exp, **progress)
        elif matched_count > 0:
            return _ev("in_progress", latest_comp, latest_exp, **progress)
        else:
            return _ev("not_started", None, None, **progress)

    # ---- CERTIFICATION requirements: match by linked course, name, type, or
    # cert number (see certification_record_matches) ----
    if req_type == RequirementType.CERTIFICATION.value:
        matching = [r for r in completed if certification_record_matches(req, r)]
        if matching:
            latest = max(matching, key=lambda r: r.completion_date or date.min)
            latest_comp = (
                latest.completion_date.isoformat() if latest.completion_date else None
            )
            latest_exp = (
                latest.expiration_date.isoformat() if latest.expiration_date else None
            )
            if latest.expiration_date and latest.expiration_date < today:
                return _ev("expired", latest_comp, latest_exp)
            return _ev("completed", latest_comp, latest_exp)
        return _ev("not_started", None, None)

    # ---- SHIFTS requirements ----
    if req_type == RequirementType.SHIFTS.value:
        latest_shift: Optional[date] = None
        if counts_shift_attendance(req):
            worked = credited_shifts_in_window(
                req, _require_shift_dates(req, shift_dates), today
            )
            count = len(worked)
            latest_shift = max(worked, default=None)
            type_matched = []
        else:
            type_matched = windowed
            if req.training_type:
                type_matched = [
                    r for r in windowed if r.training_type == req.training_type
                ]
            count = len(type_matched)
        required = req.required_shifts or 0
        base_required = required
        waived_months = 0

        if required > 0 and start_date and end_date and _waivers:
            required, waived_months, _ = adjust_required(
                required,
                start_date,
                end_date,
                _waivers,
                str(req.id),
                period_months=get_rolling_period_months(req),
            )

        progress = {
            "current": count,
            "required": required,
            "unit": "shifts",
            "base": base_required,
            "waived": waived_months,
        }

        latest = (
            max(type_matched, key=lambda r: r.completion_date or date.min)
            if type_matched
            else None
        )
        latest_comp = (
            latest.completion_date.isoformat()
            if latest and latest.completion_date
            else None
        )
        if latest_shift is not None:
            latest_comp = latest_shift.isoformat()
        latest_exp = None

        if required > 0 and count >= required:
            return _ev("completed", latest_comp, latest_exp, **progress)
        elif count > 0:
            return _ev("in_progress", latest_comp, latest_exp, **progress)
        return _ev("not_started", None, None, **progress)

    # ---- CALLS requirements ----
    if req_type == RequirementType.CALLS.value:
        type_matched = windowed
        if req.training_type:
            type_matched = [r for r in windowed if r.training_type == req.training_type]
        count = len(type_matched)
        required = req.required_calls or 0
        base_required = required
        waived_months = 0

        if required > 0 and start_date and end_date and _waivers:
            required, waived_months, _ = adjust_required(
                required,
                start_date,
                end_date,
                _waivers,
                str(req.id),
                period_months=get_rolling_period_months(req),
            )

        progress = {
            "current": count,
            "required": required,
            "unit": "calls",
            "base": base_required,
            "waived": waived_months,
        }

        latest = (
            max(type_matched, key=lambda r: r.completion_date or date.min)
            if type_matched
            else None
        )
        latest_comp = (
            latest.completion_date.isoformat()
            if latest and latest.completion_date
            else None
        )
        latest_exp = None

        if required > 0 and count >= required:
            return _ev("completed", latest_comp, latest_exp, **progress)
        elif count > 0:
            return _ev("in_progress", latest_comp, latest_exp, **progress)
        return _ev("not_started", None, None, **progress)

    # ---- Fallback (skills_evaluation, checklist, knowledge_test, etc.) ----
    matching = []
    if req.training_type:
        matching = [r for r in windowed if r.training_type == req.training_type]
    if not matching and req.name:
        matching = [
            r
            for r in windowed
            if r.course_name and req.name.lower() in r.course_name.lower()
        ]

    if matching:
        latest = max(matching, key=lambda r: r.completion_date or date.min)
        latest_comp = (
            latest.completion_date.isoformat() if latest.completion_date else None
        )
        latest_exp = (
            latest.expiration_date.isoformat() if latest.expiration_date else None
        )
        if latest.expiration_date and latest.expiration_date < today:
            return _ev("expired", latest_comp, latest_exp)
        return _ev("completed", latest_comp, latest_exp)
    else:
        in_progress = [
            r for r in member_records if r.status == TrainingStatus.IN_PROGRESS
        ]
        ip_matching = []
        if req.training_type:
            ip_matching = [
                r for r in in_progress if r.training_type == req.training_type
            ]
        if not ip_matching and req.name:
            ip_matching = [
                r
                for r in in_progress
                if r.course_name and req.name.lower() in r.course_name.lower()
            ]
        if ip_matching:
            return _ev("in_progress", None, None)
    return _ev("not_started", None, None)


def evaluate_member_requirement(
    req,
    member_records,
    today: date,
    waivers=None,
    org_include_current_month: bool = True,
    join_date: Optional[date] = None,
    shift_dates: Optional[Sequence[date]] = None,
):
    """
    Evaluate a single member's status for a single requirement.

    Returns (status, latest_completion_date, latest_expiry_date).

    Thin wrapper over :func:`evaluate_member_requirement_detail`, which is
    where the logic lives. Kept because four call sites and a large test suite
    depend on this exact triple; callers that need the underlying counts
    (hours logged against hours required, waived months) should call the
    detail function directly rather than widening this one.
    """
    ev = evaluate_member_requirement_detail(
        req,
        member_records,
        today,
        waivers=waivers,
        org_include_current_month=org_include_current_month,
        join_date=join_date,
        shift_dates=shift_dates,
    )
    return ev.status, ev.completion_date, ev.expiry_date


# The requirement types _grade_member_requirement grades in a typed branch.
# Every other type falls through to its last branch, the only place a record
# that is not COMPLETED is read.
_TYPED_BRANCH_TYPES = frozenset(
    {
        RequirementType.HOURS.value,
        RequirementType.COURSES.value,
        RequirementType.CERTIFICATION.value,
        RequirementType.SHIFTS.value,
        RequirementType.CALLS.value,
    }
)


def graded_records_clause(
    requirements: Iterable[TrainingRequirement],
    today: date,
    org_include_current_month: bool,
) -> ColumnElement[bool]:
    """Every ``TrainingRecord`` the grader can read for any of ``requirements``.

    A filter for the record load that feeds :func:`evaluate_member_requirement`
    across a whole department (TR2-4, TR4-2), which used to read every record
    each member ever had. It is exact, not an approximation: grading the
    records it selects gives the same result as grading all of them, because
    it selects a superset of what :func:`_grade_member_requirement` reads,
    branch by branch, for each requirement:

    - **Windowed types** (hours, courses, shifts, calls, and the fallback
      types) read COMPLETED records with a completion date inside
      :func:`completion_window`. Every frequency now has a bounded window
      except ONE_TIME, and so does every rolling requirement, so this is a
      date range — including biannual hours, whose expired-certificate
      override reads only the windowed records. A certification-period due
      date changes nothing here: the grader never reads one.
    - **ONE_TIME without a freshness cutoff** has no window. The grader reads
      every COMPLETED record, including one with no completion date, so all
      of them are selected — that requirement still costs the member's full
      completed history.
    - **CERTIFICATION** ignores the frequency window and reads every COMPLETED
      record :func:`certification_record_matches` accepts. With a freshness
      cutoff that is "completed on or after the cutoff". Without one it is
      the member's full completed history: the match is partly a
      case-insensitive substring test (requirement name in course name,
      registry code in certification number), and SQL's ``LIKE`` folds case
      by the column collation, not by Python's ``str.lower``, so pushing it
      into the query could drop a record the grader would have counted. The
      name test applies only to records up to ``name_match_until``, but the
      registry-code test and the course and type matches have no date bound,
      so a certification still selects every completed record; the cut-off
      narrows what the grader accepts, never what it needs loaded.
    - **Fallback types** (skills evaluation, checklist, knowledge test) also
      read IN_PROGRESS records of any date when nothing completed matches,
      so every IN_PROGRESS record is selected while one is active.

    SCHEDULED, CANCELLED and FAILED records are never read and never loaded.
    Grandfathering, catch-up deadlines and waivers read the member and the
    waiver tables, not records, so they widen nothing.

    ``today`` and ``org_include_current_month`` must be the values the
    caller grades with: windows are resolved per requirement through
    :func:`requirement_as_of`, as the grader resolves them.
    """
    spans: List[Tuple[date, Optional[date]]] = []
    all_completed = False
    in_progress = False
    for req in requirements:
        as_of = requirement_as_of(req, today, org_include_current_month)
        req_type = getattr(req.requirement_type, "value", req.requirement_type)
        if req_type not in _TYPED_BRANCH_TYPES:
            in_progress = True
        if req_type == RequirementType.CERTIFICATION.value:
            start, end = recency_cutoff(req, as_of), None
        else:
            start, end = completion_window(req, as_of)
        if start is None:
            all_completed = True
        elif end is None or start <= end:
            # start > end: the freshness cutoff falls after the window closes,
            # so the grader's windowed pool is empty and nothing is needed.
            spans.append((start, end))

    clauses: List[ColumnElement[bool]] = []
    completed = TrainingRecord.status == TrainingStatus.COMPLETED
    if all_completed:
        clauses.append(completed)
    elif spans:
        clauses.append(
            and_(
                completed,
                or_(
                    *(
                        (
                            TrainingRecord.completion_date >= start
                            if end is None
                            else TrainingRecord.completion_date.between(start, end)
                        )
                        for start, end in _merge_spans(spans)
                    )
                ),
            )
        )
    if in_progress:
        clauses.append(TrainingRecord.status == TrainingStatus.IN_PROGRESS)
    return or_(*clauses) if clauses else false()


def _merge_spans(
    spans: List[Tuple[date, Optional[date]]],
) -> List[Tuple[date, Optional[date]]]:
    """Coalesce overlapping or adjacent date ranges (``None`` end = open)."""
    merged: List[Tuple[date, Optional[date]]] = []
    for start, end in sorted(spans, key=lambda s: s[0]):
        if merged:
            last_start, last_end = merged[-1]
            if last_end is None or start <= last_end + timedelta(days=1):
                merged[-1] = (
                    last_start,
                    None if last_end is None or end is None else max(last_end, end),
                )
                continue
        merged.append((start, end))
    return merged


async def load_graded_records(
    db: AsyncSession,
    org_id: str,
    member_ids: Sequence[str],
    requirements: Iterable[TrainingRequirement],
    today: date,
    org_include_current_month: bool,
    *,
    also: Sequence[ColumnElement[bool]] = (),
) -> List[TrainingRecord]:
    """The records needed to grade ``member_ids`` against ``requirements``.

    Bounded by :func:`graded_records_clause`. ``also`` widens the load for
    whatever else the caller reads from the same rows (the dashboard's
    expiring and recent lists, a report's certificate count); each is OR'd in,
    so it can only add records.

    Ordered by id so the grader's ties (``max`` over equal completion dates)
    and any caller's ``[:5]`` resolve the same way whatever subset is loaded.
    """
    if not member_ids:
        return []
    result = await db.execute(
        select(TrainingRecord)
        .where(
            TrainingRecord.organization_id == org_id,
            TrainingRecord.user_id.in_([str(m) for m in member_ids]),
            or_(
                graded_records_clause(requirements, today, org_include_current_month),
                *also,
            ),
        )
        .order_by(TrainingRecord.id)
    )
    return list(result.scalars().all())


async def load_credited_shift_dates(
    db: AsyncSession,
    org_id: str,
    member_ids: Sequence[str],
    requirements: Iterable[TrainingRequirement],
    today: date,
    org_include_current_month: bool,
    *,
    full_history: bool = False,
) -> Dict[str, List[date]]:
    """Each member's worked shifts, one date per shift, for SHIFTS grading.

    The one definition of "a shift completed" (shifts-three-sources):

    - an attendance row on one of this organization's shifts that has been
      **finalized** — the rule the member hours report and My Hours apply
      to credited hours, so pending, member-controlled attendance is not
      credit until an officer closes the shift out; and
    - a **counted** external shift entry (another jurisdiction's
      apparatus), which the Shift Compliance report has always counted as a
      shift worked here.

    Dated by the shift's date. Scoped through ``Shift.organization_id`` —
    ``shift_attendance`` carries no org column of its own.

    Loaded only when one of ``requirements`` is counted from attendance
    (:func:`counts_shift_attendance`); otherwise ``{}``, and callers pass
    ``.get(member_id, [])``. Bounded, like :func:`load_graded_records`, by
    the union of those requirements' :func:`completion_window` as of their
    own cut-off. ``full_history`` lifts the bound when one of them is
    rolling: a caller deriving a rolling due date from the latest shift
    needs the shifts older than the window.
    Grouped by member and date in SQL, so the rows returned scale with days
    worked, not with attendance rows.
    """
    from app.models.external_shift_hours import (
        ExternalShiftHours,
        ExternalShiftHoursStatus,
    )
    from app.models.training import Shift, ShiftAttendance

    counted = [r for r in requirements if counts_shift_attendance(r)]
    if not counted or not member_ids:
        return {}

    spans: List[Tuple[date, Optional[date]]] = []
    # Only a rolling requirement reads a shift older than its window.
    unbounded = full_history and any(get_rolling_period_months(r) for r in counted)
    for req in counted:
        start, end = completion_window(
            req, requirement_as_of(req, today, org_include_current_month)
        )
        if start is None:
            unbounded = True
        elif end is None or start <= end:
            spans.append((start, end))
    if not unbounded and not spans:
        return {}

    def _dated(column) -> List[ColumnElement[bool]]:
        if unbounded:
            return []
        return [
            or_(
                *(
                    column >= start if end is None else column.between(start, end)
                    for start, end in _merge_spans(spans)
                )
            )
        ]

    ids = [str(m) for m in member_ids]
    by_user: Dict[str, List[date]] = {}
    attendance = await db.execute(
        select(
            ShiftAttendance.user_id,
            Shift.shift_date,
            func.count(ShiftAttendance.id),
        )
        .join(Shift, ShiftAttendance.shift_id == Shift.id)
        .where(
            Shift.organization_id == str(org_id),
            Shift.is_finalized.is_(True),
            ShiftAttendance.user_id.in_(ids),
            *_dated(Shift.shift_date),
        )
        .group_by(ShiftAttendance.user_id, Shift.shift_date)
    )
    external = await db.execute(
        select(
            ExternalShiftHours.user_id,
            ExternalShiftHours.shift_date,
            func.count(ExternalShiftHours.id),
        )
        .where(
            ExternalShiftHours.organization_id == str(org_id),
            ExternalShiftHours.status == ExternalShiftHoursStatus.COUNTED.value,
            ExternalShiftHours.user_id.in_(ids),
            *_dated(ExternalShiftHours.shift_date),
        )
        .group_by(ExternalShiftHours.user_id, ExternalShiftHours.shift_date)
    )
    for user_id, shift_date, n in [*attendance.all(), *external.all()]:
        by_user.setdefault(str(user_id), []).extend([shift_date] * int(n or 0))
    for dates in by_user.values():
        dates.sort()
    return by_user


def _find_matching_profile(
    member: User,
    profiles: List[ComplianceProfile],
) -> Optional[ComplianceProfile]:
    """Find the highest-priority active profile that matches a member.

    Matches by membership_type and/or role_ids. A profile with no
    membership_types and no role_ids matches all members. Returns None
    if no profile matches.
    """
    member_type = getattr(member, "membership_type", None)
    # A profile's "role_ids" hold *position* ids: User.roles is a synonym for
    # User.positions, and PUT /users/{id}/roles writes position ids under that
    # name. Position has no `role_id` column, so reading one collected nothing
    # and every profile carrying role_ids failed to match anybody — silently,
    # since an unmatched profile just falls back to the org-wide settings.
    member_role_ids: List[str] = []
    if hasattr(member, "positions") and member.positions:
        for pos in member.positions:
            position_id = getattr(pos, "id", None)
            if position_id:
                member_role_ids.append(str(position_id))

    for profile in profiles:
        if not profile.is_active:
            continue

        type_match = True
        role_match = True

        if profile.membership_types:
            type_match = member_type in profile.membership_types

        if profile.role_ids:
            role_match = bool(set(member_role_ids) & set(profile.role_ids))

        if type_match and role_match:
            return profile

    return None


# Status reported for an existing member's unmet requirement while its
# catch-up period runs. Not a TrainingStatus: it describes the member's
# obligation, not a training record, and it never counts against standing.
CATCH_UP_STATUS = "catch_up"


def member_join_date(member) -> Optional[date]:
    """The date a member joined the department, for grandfathering.

    ``hire_date`` when the department recorded one, otherwise the date the
    member's account was created. ``hire_date`` is optional and the membership
    pipeline does not always set it, so without the fallback a member with no
    hire date could be neither "existing" nor "new". The fallback reads the
    account's UTC creation date; a day's skew at the cutoff is the accepted
    cost of not loading the org timezone for every member.
    """
    return join_date_from(
        getattr(member, "hire_date", None), getattr(member, "created_at", None)
    )


def join_date_from(hire_date, created_at) -> Optional[date]:
    """:func:`member_join_date` for a caller holding the two columns, not a row."""
    for value in (hire_date, created_at):
        if value:
            return value.date() if isinstance(value, datetime) else value
    return None


def requirement_applies_by_join_date(req, join_date: Optional[date]) -> bool:
    """Whether a requirement's grandfathering dates include this member.

    - ``applies_to_joined_before``: members who joined on or after it are
      graded by the newer copy instead, so this one does not apply.
    - ``new_member_cutoff_date`` with no ``existing_member_deadline``: members
      who joined before the cutoff are exempt.
    - With a deadline, existing members are still included — the catch-up
      period is handled by :func:`catch_up_deadline`, not by exclusion.

    An unknown join date (only an unsaved member has neither a hire date nor a
    creation date) is held to the requirement: never drop one silently.
    """
    if join_date is None:
        return True
    joined_before = getattr(req, "applies_to_joined_before", None)
    if joined_before and join_date >= joined_before:
        return False
    cutoff = getattr(req, "new_member_cutoff_date", None)
    if (
        cutoff
        and join_date < cutoff
        and getattr(req, "existing_member_deadline", None) is None
    ):
        return False
    return True


def catch_up_deadline(req, join_date: Optional[date], today: date) -> Optional[date]:
    """The deadline still protecting an existing member, or None.

    Non-None only while today is on or before ``existing_member_deadline`` for
    a member who joined before ``new_member_cutoff_date``. After the deadline,
    and for every new member, the requirement is graded normally.
    """
    cutoff = getattr(req, "new_member_cutoff_date", None)
    deadline = getattr(req, "existing_member_deadline", None)
    if not (cutoff and deadline and join_date):
        return None
    if join_date < cutoff and today <= deadline:
        return deadline
    return None


def tally_standing(statuses: Iterable[str]) -> Tuple[int, int]:
    """(met, total) over a member's requirement statuses.

    A requirement in its catch-up period is left out of both counts: it is
    neither met nor held against the member until the deadline passes. Every
    screen that turns statuses into a standing goes through this so a
    grandfathered member reads the same on the dashboard, the matrix and the
    profile card.
    """
    met = 0
    total = 0
    for status in statuses:
        if status == CATCH_UP_STATUS:
            continue
        total += 1
        if status == TrainingStatus.COMPLETED.value:
            met += 1
    return met, total


def requirement_applies_to_member(
    req,
    membership_type: str,
    rank: Optional[str] = None,
    join_date: Optional[date] = None,
    position_slugs: Optional[List[str]] = None,
) -> bool:
    """Whether a requirement applies to a member.

    Matches ``TrainingService.get_applicable_requirements`` (the
    member-facing ``/my-training`` path) precedence exactly:
    ``applies_to_all`` wins outright; otherwise ``required_membership_types``
    is checked; otherwise the member matches if their rank is named in
    ``required_roles`` or they hold a position named in
    ``required_positions`` (both by slug). A requirement naming none of these
    applies to nobody.

    ``required_roles`` holds *rank* slugs (``User.rank``, e.g. ``"captain"``):
    the model's column comment, the training-program requirements schema and
    every writer say so, and the scheduling shift-compliance report matched
    it that way all along. Every grader here compared it against position
    ids instead, which nothing ever writes there, so a requirement scoped
    only by rank applied to nobody on /my-training, the matrix, the
    dashboard percentage, the period roster, the profile card or the annual
    report (CMP4-5; the owner chose rank matching over migrating the column).

    ``required_positions`` holds position *slugs*, written by the training
    program requirements API. Before CMP4-2 nothing here read it, so a
    requirement scoped only that way graded nobody anywhere this helper is
    called. Roles and positions are OR'd, as the scheduling compliance
    report already does.

    Extracted after this exact precedence check was independently
    reimplemented, incompletely, at four call sites
    (``get_compliance_matrix``, ``compute_org_compliance_pct``,
    ``get_member_period_status``, ``get_compliance_summary``) — three of
    which never considered ``applies_to_all`` at all, so a requirement
    created as "applies to all" and later scoped down without also
    clearing ``applies_to_all`` (a reachable state: the two fields are
    independent and unvalidated) silently stopped applying to anyone,
    contradicting what ``/my-training`` told that same member. One
    definition, called from everywhere that needs it, is what keeps a
    fifth reimplementation from drifting the same way.

    ``join_date`` (the member's :func:`member_join_date`) applies the
    requirement's grandfathering dates before any of the above. Every caller
    in ``app/`` passes it — ``tests/test_requirement_grandfathering.py``
    sweeps for one that does not.
    """
    if not requirement_applies_by_join_date(req, join_date):
        return False
    if req.applies_to_all:
        return True
    if req.required_membership_types:
        return membership_type in req.required_membership_types
    if req.required_roles and rank:
        if rank in req.required_roles:
            return True
    if req.required_positions and position_slugs:
        if any(slug in position_slugs for slug in req.required_positions):
            return True
    return False


def member_position_slugs(member) -> List[str]:
    """The slugs ``required_positions`` is matched against.

    ``User.positions`` is lazy, so a caller loading members in bulk must
    ``selectinload(User.positions)`` first — touching it unloaded on an
    AsyncSession raises MissingGreenlet.
    """
    positions = getattr(member, "positions", None) or []
    return [str(p.slug) for p in positions if getattr(p, "slug", None)]


def requirement_applies_to_user(req, member) -> bool:
    """:func:`requirement_applies_to_member` with every input read off ``member``.

    The form a bulk caller should use: it cannot forget the rank, the
    position slugs or the join date, which is how the dashboard percentage and
    the compliance matrix came to ignore scoped requirements that
    ``/my-training`` and the profile card enforced.
    """
    return requirement_applies_to_member(
        req,
        getattr(member, "membership_type", None) or "active",
        getattr(member, "rank", None),
        join_date=member_join_date(member),
        position_slugs=member_position_slugs(member),
    )


# The standing of a member nothing grades: no requirement applies to them, or
# every one that does is still inside its catch-up period. Not "compliant" —
# a denominator of nothing is not a pass — and never counted in any
# percentage's population, numerator or denominator.
STANDING_NOT_APPLICABLE = "not_applicable"


def classify_standing(
    completed_count: int,
    total_count: int,
    compliant_threshold: float = 100.0,
    at_risk_threshold: float = 75.0,
    threshold_type: str = "percentage",
) -> Tuple[str, Optional[float]]:
    """Turn a met/total tally into a standing plus its percentage.

    Returns (status, compliance_pct) where status is one of:
    "compliant", "at_risk", "non_compliant", or "not_applicable" — the last
    with a ``None`` percentage, when ``total_count`` is zero.

    Split out of ``_evaluate_member_compliance`` so the compliance matrix can
    label a member without evaluating every requirement a second time. Both
    paths must agree — a member shown as "at risk" on the matrix and
    "non-compliant" on the dashboard is a support call — so the thresholds are
    applied here and nowhere else.

    An empty tally used to read ``("compliant", 100.0)``, which counted a
    member nothing measures toward every department percentage. The
    department decided such a member is excluded from those percentages
    entirely and shown as not applicable (TR4-4).
    """
    if total_count <= 0:
        return STANDING_NOT_APPLICABLE, None

    pct = round(completed_count / total_count * 100, 1)

    if threshold_type == "all_required":
        if completed_count >= total_count:
            return "compliant", pct
    elif pct >= compliant_threshold:
        return "compliant", pct

    if pct >= at_risk_threshold:
        return "at_risk", pct
    return "non_compliant", pct


def _evaluate_member_compliance(
    member_reqs: list,
    member_records: list,
    today: date,
    waivers: list,
    compliant_threshold: float,
    at_risk_threshold: float,
    threshold_type: str,
    org_include_current_month: bool = True,
    join_date: Optional[date] = None,
    shift_dates: Optional[Sequence[date]] = None,
) -> Tuple[str, Optional[float]]:
    """Evaluate a member's compliance status against a set of requirements.

    Returns :func:`classify_standing`'s (status, compliance_pct); an empty
    ``member_reqs`` is "not_applicable" with no percentage.
    """
    statuses = []
    for req in member_reqs:
        req_status, _, _ = evaluate_member_requirement(
            req,
            member_records,
            today,
            waivers=waivers,
            org_include_current_month=org_include_current_month,
            join_date=join_date,
            shift_dates=shift_dates,
        )
        statuses.append(req_status)
    completed_count, total_count = tally_standing(statuses)

    return classify_standing(
        completed_count,
        total_count,
        compliant_threshold,
        at_risk_threshold,
        threshold_type,
    )


async def _load_compliance_config(
    db: AsyncSession,
    org_id: str,
) -> Optional[ComplianceConfig]:
    """Load compliance config with profiles for an organization."""
    result = await db.execute(
        select(ComplianceConfig)
        .options(selectinload(ComplianceConfig.profiles))
        .where(ComplianceConfig.organization_id == org_id)
    )
    return result.scalars().first()


@dataclass(frozen=True)
class MemberGrading:
    """What grades one member: their requirements and pass bars."""

    requirements: List[TrainingRequirement]
    compliant_threshold: float
    at_risk_threshold: float


@dataclass(frozen=True)
class ComplianceGrading:
    """An organization's compliance configuration, resolved once per request.

    The one definition of which requirements grade a member and against
    which thresholds. ``compute_org_compliance_tally`` (the dashboard and hub
    percentage), ``get_compliance_matrix`` and the dashboard's "Department
    Compliance" card all resolve members through :meth:`for_member` and
    classify through :func:`classify_standing`. The card used to grade every
    applicable requirement at a fixed 100% instead, and read differently
    from the matrix it links to for any org using profiles (TR4-3).
    """

    compliant_threshold: float = 100.0
    at_risk_threshold: float = 75.0
    threshold_type: str = "percentage"
    include_current_month: bool = True
    # Highest priority first: _find_matching_profile takes the first match.
    profiles: Tuple[ComplianceProfile, ...] = ()

    @classmethod
    def from_config(cls, config: Optional[ComplianceConfig]) -> "ComplianceGrading":
        """Defaults when the org has configured nothing (legacy behaviour)."""
        if config is None:
            return cls()
        return cls(
            compliant_threshold=config.compliant_threshold,
            at_risk_threshold=config.at_risk_threshold,
            threshold_type=config.threshold_type or "percentage",
            include_current_month=bool(config.include_current_month),
            profiles=tuple(
                sorted(config.profiles or [], key=lambda p: p.priority, reverse=True)
            ),
        )

    def for_member(
        self, member: User, requirements: List[TrainingRequirement]
    ) -> MemberGrading:
        """The requirements that grade ``member``, and their thresholds.

        A matching profile narrows the requirement list and may override the
        thresholds; then every requirement that does not apply to the member
        (``requirement_applies_to_user``) is dropped. ``member.positions``
        must be loaded when any profile exists.
        """
        member_reqs = list(requirements)
        compliant_threshold = self.compliant_threshold
        at_risk_threshold = self.at_risk_threshold
        profile = (
            _find_matching_profile(member, list(self.profiles))
            if self.profiles
            else None
        )
        if profile:
            # `is not None`, not truthy: a profile that explicitly selects zero
            # required requirements (`[]`, "nothing is required for this
            # group") must not fall through to grading against every org-wide
            # requirement — `[]` and "never set" (`None`) differ. See CMP2-3.
            if profile.required_requirement_ids is not None:
                by_id = {str(r.id): r for r in requirements}
                member_reqs = [
                    by_id[rid]
                    for rid in profile.required_requirement_ids
                    if rid in by_id
                ]
            # Threshold overrides apply whenever the profile matched,
            # independent of whether it also narrows the list (CMP2-3).
            if profile.compliant_threshold_override is not None:
                compliant_threshold = profile.compliant_threshold_override
            if profile.at_risk_threshold_override is not None:
                at_risk_threshold = profile.at_risk_threshold_override
        # A requirement that does not apply to the member is not in their
        # denominator. See requirement_applies_to_member's docstring for why
        # this is one shared check rather than a reimplementation per screen.
        return MemberGrading(
            requirements=[
                req for req in member_reqs if requirement_applies_to_user(req, member)
            ],
            compliant_threshold=compliant_threshold,
            at_risk_threshold=at_risk_threshold,
        )

    def classify(
        self, grading: MemberGrading, met: int, total: int
    ) -> Tuple[str, Optional[float]]:
        """:func:`classify_standing` with this member's thresholds."""
        return classify_standing(
            met,
            total,
            grading.compliant_threshold,
            grading.at_risk_threshold,
            self.threshold_type,
        )


async def get_org_include_current_month(db: AsyncSession, org_id: str) -> bool:
    """Return the org-wide "count the in-progress month" compliance default.

    Per-requirement overrides are applied inside ``evaluate_member_requirement``;
    this is only the fallback used when a requirement does not set its own value.
    When no compliance config exists the current month is included (preserves
    legacy behaviour).
    """
    config = await _load_compliance_config(db, org_id)
    return True if config is None else bool(config.include_current_month)


async def count_active_requirements(db: AsyncSession, org_id: str) -> int:
    """Number of active training requirements the organization has defined.

    ``compute_org_compliance_pct`` reports 100 when this is zero, which is
    arithmetically true and reads as "everyone is current" on a department
    that has not set anything up. Screens showing that figure check this
    first and say "not set up" instead.
    """
    count = await db.scalar(
        select(func.count(TrainingRequirement.id)).where(
            TrainingRequirement.organization_id == org_id,
            TrainingRequirement.active.is_(True),
        )
    )
    return int(count or 0)


@dataclass(frozen=True)
class OrgComplianceTally:
    """Who a department compliance percentage counts, and who passes.

    ``graded`` is the percentage's denominator: members at least one
    requirement grades. A member with nothing applicable is counted in
    ``not_applicable`` and in neither side of the percentage (TR4-4).
    """

    compliant: int
    graded: int
    not_applicable: int
    active_requirements: int

    @property
    def members(self) -> int:
        return self.graded + self.not_applicable

    @property
    def pct(self) -> Optional[float]:
        """Share of graded members who are compliant; None when nobody is."""
        if self.graded == 0:
            return None
        return round(self.compliant / self.graded * 100, 1)


async def compute_org_compliance_pct(
    db: AsyncSession, org_id: str, today: Optional[date] = None
) -> Optional[float]:
    """Compute organization-wide training compliance percentage.

    The percentage of *graded* members — those at least one requirement
    applies to — who are compliant; see :func:`compute_org_compliance_tally`.

    If there are no active requirements, returns 100.0 (callers check
    :func:`count_active_requirements` first and say "not set up").
    If there are no active members, returns 0.0.
    If requirements exist but none applies to any member, returns None: there
    is nothing measured to report, and callers show it as not applicable
    rather than as a vacuous 100%.
    """
    tally = await compute_org_compliance_tally(db, org_id, today)
    if tally.members == 0:
        return 0.0
    if tally.active_requirements == 0:
        return 100.0
    return tally.pct


async def compute_org_compliance_tally(
    db: AsyncSession, org_id: str, today: Optional[date] = None
) -> OrgComplianceTally:
    """Grade every active, non-exempt member and count the standings.

    When a compliance configuration exists with profiles, each member is
    matched to a profile (by membership type / role). The profile's
    ``required_requirement_ids`` determines which training requirements
    count, and the configured thresholds determine compliant vs not.

    Without a compliance config, falls back to the legacy behaviour:
    evaluate every active training requirement for every member.
    """
    # Get active members (exclude compliance-exempt members)
    # positions is eager-loaded because _find_matching_profile reads it for
    # every member below, and it is a lazy relationship: touching it unloaded
    # on an AsyncSession raises MissingGreenlet. Only the *caller* arrives with
    # positions warmed by the auth dependency, so an org that configures any
    # compliance profile raised on the first member who was not the caller —
    # which is to say, on every real request.
    members_result = await db.execute(
        select(User)
        .options(selectinload(User.positions))
        .where(
            User.organization_id == org_id,
            User.status == UserStatus.ACTIVE,
            User.compliance_exempt.is_(False),
            User.deleted_at.is_(None),
        )
    )
    members = members_result.scalars().all()

    if not members:
        return OrgComplianceTally(0, 0, 0, 0)

    # Get active requirements
    reqs_result = await db.execute(
        select(TrainingRequirement).where(
            TrainingRequirement.organization_id == org_id,
            TrainingRequirement.active.is_(True),
        )
    )
    requirements = reqs_result.scalars().all()

    if not requirements:
        return OrgComplianceTally(0, 0, len(members), 0)

    grading = ComplianceGrading.from_config(await _load_compliance_config(db, org_id))

    # The department's date, as every other compliance view uses: the dashboard
    # percentage and the matrix it links to must grade against the same day.
    # Resolved before the record load, which is bounded by the windows it sets.
    if today is None:
        today = await resolve_org_today(db, org_id)

    records_by_user: Dict[str, list] = {}
    for r in await load_graded_records(
        db,
        org_id,
        [m.id for m in members],
        requirements,
        today,
        grading.include_current_month,
    ):
        records_by_user.setdefault(r.user_id, []).append(r)
    shifts_by_user = await load_credited_shift_dates(
        db,
        org_id,
        [m.id for m in members],
        requirements,
        today,
        grading.include_current_month,
    )

    # Fetch waivers
    waivers_by_user = await fetch_org_waivers(db, str(org_id))

    compliant_count = 0
    not_applicable_count = 0

    for member in members:
        member_records = records_by_user.get(member.id, [])
        member_waivers = waivers_by_user.get(str(member.id), [])

        member_grading = grading.for_member(member, list(requirements))
        status, _ = _evaluate_member_compliance(
            member_grading.requirements,
            member_records,
            today,
            member_waivers,
            member_grading.compliant_threshold,
            member_grading.at_risk_threshold,
            grading.threshold_type,
            org_include_current_month=grading.include_current_month,
            join_date=member_join_date(member),
            shift_dates=shifts_by_user.get(str(member.id), []),
        )
        if status == STANDING_NOT_APPLICABLE:
            not_applicable_count += 1
        elif status == "compliant":
            compliant_count += 1

    return OrgComplianceTally(
        compliant=compliant_count,
        graded=len(members) - not_applicable_count,
        not_applicable=not_applicable_count,
        active_requirements=len(requirements),
    )
