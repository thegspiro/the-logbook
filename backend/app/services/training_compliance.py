"""
Training Compliance Utilities

Shared functions for evaluating training requirement compliance.
Used by both the dashboard admin-summary and the training compliance-matrix endpoints.
"""

import calendar
import math
from dataclasses import dataclass, field, replace
from datetime import date, datetime, timedelta
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from sqlalchemy import ColumnElement, and_, false, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.compliance_config import ComplianceConfig, ComplianceProfile
from app.models.training import (
    RequirementFrequency,
    RequirementType,
    TrainingRecord,
    TrainingRequirement,
    TrainingSession,
    TrainingSessionRequirement,
    TrainingStatus,
)
from app.models.user import ACTIVE_ACCOUNT_STATUSES, User
from app.services.shift_evaluation_rules import (
    EVALUATION_REQUIREMENT_TARGETS,
    credit_units,
    evaluation_visible,
)
from app.services.training_period import (
    effective_include_current_month,
    resolve_as_of_date,
)
from app.services.training_waiver_service import (
    SOURCE_LEAVE,
    SOURCE_OVERRIDE,
    SOURCE_SESSION_EXCUSAL,
    SOURCE_WAIVER,
    MonthWaiver,
    WaiverPeriod,
    adjust_required,
    excused_month_reasons,
    fetch_org_waivers,
    get_rolling_period_months,
    month_waivers,
    override_covers,
    total_months_in_period,
)
from app.utils.compliance_profiles import ordered_profiles
from app.utils.duty_shifts import duty_shifts_only
from app.utils.hours import meets_required_hours
from app.utils.membership import MemberStatus, canonical_member_status
from app.utils.org_timezone import (
    local_date,
    resolve_org_today,
    resolve_scheduling_timezone,
)
from app.utils.shift_seats import SeatedDate, dates_in_seat, member_seat_on_shift
from app.utils.sql_search import LIKE_ESCAPE_CHAR, like_pattern
from app.utils.training_match_key import training_match_key


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


def next_window_opens(req, today: date) -> Optional[date]:
    """When the next completion window of a year-crossing requirement opens.

    A requirement configured November to January keeps last winter's window
    open through the following October (see ``_get_custom_annual_window``), so
    a member who took it early reads as complete for the whole year. This is
    the date the *next* window starts, which is when they can take it again
    for the coming year. ``None`` for every requirement without such a window,
    and while a window is already open.
    """
    if not getattr(req, "period_end_month", None):
        return None
    start_month = getattr(req, "period_start_month", None) or 1
    if start_month <= req.period_end_month:
        return None
    start_day = getattr(req, "period_start_day", None) or 1
    end_day = (
        getattr(req, "period_end_day", None)
        or calendar.monthrange(today.year, req.period_end_month)[1]
    )
    if today <= date(today.year, req.period_end_month, end_day):
        return None
    opens = date(today.year, start_month, start_day)
    return opens if today < opens else None


def rolling_window(as_of: date, months: int) -> tuple[date, date]:
    """The whole calendar months a rolling requirement counts, as of ``as_of``.

    The ``months`` calendar months ending with the one ``as_of`` falls in, so a
    12-month window on 2026-10-13 starts on 2025-11-01, not 2025-10-13. A
    department reads "the last 12 months" as November through this October; a
    window cut on the day-of-month leaves a member's October hours counted on
    some screens and a month that is mostly gone on others, and no month
    breakdown can add up to it. This is the one definition: grading, due dates
    and the monthly breakdown all call it.
    """
    from dateutil.relativedelta import relativedelta

    return as_of.replace(day=1) - relativedelta(months=months - 1), as_of


def rolling_hours_has_no_deadline(req) -> bool:
    """Whether HOURS requirement ``req`` is a continuous rolling count.

    "72 hours in any 12 months" has no date it comes due: it is met or short on
    every day, and "last class plus 12 months" is a recertification interval
    that moves forward with every class logged. Rolling requirements of other
    types (a certification, a course) keep their anchored due date.
    """
    req_type = getattr(req, "requirement_type", None)
    req_type = getattr(req_type, "value", req_type)
    return req_type == RequirementType.HOURS.value and bool(
        get_rolling_period_months(req)
    )


def monthly_hours(
    records: Iterable,
    start: date,
    end: date,
    excused: Optional[Dict[Tuple[int, int], MonthWaiver]] = None,
) -> List[Dict]:
    """Hours per calendar month from ``start`` through ``end``, zeros included.

    ``records`` are the records already counted toward the requirement, so the
    months add up to the figure the requirement reports. A month with nothing
    in it is listed, not skipped: the gap is what a member is checking for.

    ``excused`` is what leave and waivers excused, by ``(year, month)``
    (``month_waivers``). Those months are flagged, with the share excused and
    whether a leave of absence or a training waiver was the reason, so a month
    a member was excused from is not read as a month they fell short, and the
    requirement's prorated target is the same one these rows are measured
    against. Hours earned in such a month still count and are still listed.
    """
    totals: Dict[Tuple[int, int], float] = {}
    for record in records:
        when = getattr(record, "completion_date", None)
        if when is None or not start <= when <= end:
            continue
        key = (when.year, when.month)
        totals[key] = totals.get(key, 0.0) + float(record.hours_completed or 0)
    return _month_rows(totals, start, end, excused, "hours")


@dataclass(frozen=True)
class MonthlyPace:
    """A member's average hours a month against the department's monthly pace.

    ``average`` is the member's pace while active: each month weighs its
    unexcused share (``1 - waived_share``), so a month half excused counts as
    half a month and its hours, and a fully excused month and its hours are
    left out; None when every month so far was fully excused. Hours earned on
    leave still count toward the requirement's total. A fully excused month's
    are left out here because dividing 26 hours, 23 of them earned on leave,
    by the active months alone would read as 13 a month for a member who
    logged 3. A partly excused month's hours cannot be split by the day they
    were earned, so all of them count against its active share. Dropping
    every month with any excused share, as this once did, let a few days'
    leave remove a whole month of work from the figure.

    ``needed`` is the requirement's unadjusted level over the months in its
    whole window (72 over 12 is 6). Leave lowers what a member owes, not the
    pace the department set, so the waiver-prorated target is not used.

    Shown beside the total, never instead of it as the grade: compliance is
    still decided on the total (owner decision, 2026-11-20).
    """

    average: Optional[float]
    needed: Optional[float]


def monthly_pace(
    rows: Sequence[Mapping[str, Any]],
    base_required: float,
    window_start: Optional[date],
    window_end: Optional[date],
) -> MonthlyPace:
    """The :class:`MonthlyPace` for the rows ``monthly_hours`` produced.

    The one definition: the compliance matrix and My Training both report it,
    so the two screens cannot print different averages for the same member.
    """
    hours = 0.0
    active_months = 0.0
    for row in rows:
        # A row flagged waived without a share predates the share: whole month.
        if not row.get("waived"):
            share = 0.0
        elif row.get("waived_share") is None:
            share = 1.0
        else:
            share = float(row["waived_share"])
        weight = 1.0 - min(max(share, 0.0), 1.0)
        if weight <= 0:
            continue
        hours += float(row.get("hours") or 0)
        active_months += weight
    average = round(hours / active_months, 2) if active_months > 0 else None
    months = (
        total_months_in_period(window_start, window_end)
        if window_start and window_end
        else 0
    )
    needed = round(base_required / months, 2) if base_required > 0 and months else None
    return MonthlyPace(average=average, needed=needed)


def monthly_counts(
    dates: Iterable[date],
    start: date,
    end: date,
    excused: Optional[Dict[Tuple[int, int], MonthWaiver]] = None,
) -> List[Dict]:
    """Shifts or calls per calendar month, ``monthly_hours``' counterpart.

    ``dates`` are the shifts worked or records already counted toward the
    requirement, one date each, so the months add up to the count it reports.
    Each row carries ``count`` in place of ``hours`` and the same leave fields.
    """
    totals: Dict[Tuple[int, int], float] = {}
    for when in dates:
        if when is None or not start <= when <= end:
            continue
        key = (when.year, when.month)
        totals[key] = totals.get(key, 0) + 1
    return _month_rows(totals, start, end, excused, "count")


def _month_rows(
    totals: Dict[Tuple[int, int], float],
    start: date,
    end: date,
    excused: Optional[Dict[Tuple[int, int], MonthWaiver]],
    value_key: str,
) -> List[Dict]:
    months: List[Dict] = []
    year, month = start.year, start.month
    while (year, month) <= (end.year, end.month):
        mw = (excused or {}).get((year, month))
        months.append(
            {
                "month": f"{year:04d}-{month:02d}",
                value_key: totals.get(
                    (year, month), 0.0 if value_key == "hours" else 0
                ),
                "waived": mw is not None,
                "waived_share": round(mw.share, 4) if mw else 0.0,
                "on_leave": bool(mw and SOURCE_LEAVE in mw.sources),
                "on_waiver": bool(mw and SOURCE_WAIVER in mw.sources),
            }
        )
        month += 1
        if month > 12:
            year, month = year + 1, 1
    return months


def lapsed_biannual_certificate(req, counted, as_of: date):
    """For a BIANNUAL hours or courses requirement, the lapsed certificate that
    overrides its count, or None.

    An "every 2 years" hours or courses requirement is often a recertification,
    so a certificate that has lapsed fails it whatever the count says. The
    certificate read is the one expiring last among ``counted``, the records
    the requirement's own branch counts: the hours records
    :func:`hours_record_counts` accepts in the window, or a courses
    requirement's windowed completions. It is returned when its expiration
    date is before ``as_of``.

    This is the one definition. The compliance grader, My Training
    (``TrainingService.evaluate_requirement_detail``) and
    ``TrainingService.check_requirement_progress`` all call it. My Training
    used to read every completed record of the training type, in or out of
    the window, for hours, and had no check at all for courses, so a member
    could read met on one screen and expired on the other (CLAUDE.md
    pitfall 29). Only windowed records are loaded for the grader
    (:func:`graded_records_clause`), so the counted records are the set every
    caller can read.
    """
    freq = getattr(req.frequency, "value", req.frequency)
    if freq != RequirementFrequency.BIANNUAL.value:
        return None
    dated = [r for r in counted if r.expiration_date]
    if not dated:
        return None
    newest = max(dated, key=lambda r: r.expiration_date)
    return newest if newest.expiration_date < as_of else None


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
    ``rolling_period_months`` is set, the window is the whole calendar months
    from :func:`rolling_window` through ``today``.

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
        return rolling_window(today, rolling_months)

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
    3. The requirement's name, for legacy records only
       (:func:`record_name_matches`).
    4. The requirement's registry code, which the record's certification
       number begins with (:func:`registry_code_matches`).

    Matches 2–4 are heuristics kept for requirements created before the library
    link existed (and for imported records that carry no course id), which is
    why linking a course *widens* the match rather than replacing it: an
    existing "CPR" requirement must keep crediting the records it already
    credited when an officer links the CPR course to it.

    3 and 4 compare stored keys, not text (owner decision 2026-11-01, "stored
    match key"), so :func:`graded_records_clause` can ask SQL for exactly the
    records they can accept instead of loading every completed record.

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

    return record_name_matches(req, record) or registry_code_matches(req, record)


def record_name_matches(req, record) -> bool:
    """Whether ``record`` satisfies ``req`` by name: the legacy rule.

    The record's stored ``match_key`` must equal the key of the requirement's
    name, and the record must predate the requirement's ``name_match_until``
    (:func:`_name_match_is_legacy`). Used by CERTIFICATION and by every type
    the grader's fallback branch handles (skills evaluation, checklist,
    knowledge test, ...).

    The rule used to be "the requirement's name appears anywhere in the
    course name", so a "CPR Refresher" event credited a "CPR" certification.
    The owner kept name matching for legacy records only — for certifications
    on 2026-10-05, extended to the fallback types on 2026-11-01 — and on
    2026-11-01 replaced the substring test with the key, which ignores case,
    spacing and punctuation but not words: "c.p.r." matches "CPR", "CPR
    Refresher" does not. A record with no stored key never matches by name.
    """
    if getattr(req, "name_match_until", None) is None:
        return False
    key = training_match_key(getattr(req, "name", None))
    return (
        key is not None
        and getattr(record, "match_key", None) == key
        and _name_match_is_legacy(req, record)
    )


def registry_code_matches(req, record) -> bool:
    """Whether ``record``'s certification number begins with ``req``'s registry code.

    Compared by key (:func:`training_match_key`), so "NFPA 1001" matches
    "nfpa-1001-0042". A code in the middle of the number ("TX-NFPA-1001") no
    longer matches: a prefix is what SQL can find through the index, and it is
    how registry-issued numbers are written. No cut-off — this match was
    never date-limited.
    """
    code = training_match_key(getattr(req, "registry_code", None))
    cert = getattr(record, "certification_key", None)
    return bool(code and cert and cert.startswith(code))


def _name_match_is_legacy(req, record) -> bool:
    """Whether ``record`` predates ``req``'s name-match cut-off.

    Dated by its completion date. A record with none is dated by when it was
    entered, so an undated record written after the cut-off cannot borrow the
    legacy rule; one with neither date is not legacy.
    """
    until = getattr(req, "name_match_until", None)
    if until is None:
        return False
    when = getattr(record, "completion_date", None)
    if when is None:
        created_at = getattr(record, "created_at", None)
        when = created_at.date() if created_at is not None else None
    return when is not None and when <= until


def fallback_record_matches(req, records) -> list:
    """The records the fallback branch credits ``req`` with.

    By training type when the requirement names one and any record has it;
    otherwise by name (:func:`record_name_matches`). One definition for every
    grader that has a fallback branch (CLAUDE.md pitfall #29).
    """
    matching = []
    if req.training_type:
        matching = [r for r in records if r.training_type == req.training_type]
    if not matching:
        matching = [r for r in records if record_name_matches(req, r)]
    return matching


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
    # Every reader of a member's shifts for one requirement comes through
    # here, so this is where a requirement limited to one seat drops the
    # shifts worked in any other seat, with no seat recorded, or on another
    # agency's apparatus (owner decisions, 2026-11-26).
    return dates_in_seat(list(shift_dates), getattr(req, "credited_seat", None))


# A member's shift-evaluation credit, by requirement id: one (shift date,
# units) per visible evaluation that is worth something toward it. See
# load_evaluation_credits.
EvaluationCredits = Mapping[str, Sequence[Tuple[date, float]]]


@dataclass(frozen=True)
class CreditedHours:
    """Hours credited to an HOURS requirement from somewhere other than a
    training record: one member's shift hours on one date.

    Shaped like the record attributes the HOURS branch of the grader reads
    (``completion_date``, ``hours_completed``, ``expiration_date``), so the
    window, freshness cut-off and monthly breakdown treat them exactly as they
    treat records. Only the scheduling Shift Compliance report passes these;
    every training screen grades HOURS from training records.
    """

    completion_date: date
    hours_completed: float
    expiration_date: Optional[date] = None


_EVALUATION_TYPE_UNITS = {
    RequirementType.EVALUATED_SHIFTS.value: "evaluated shifts",
    RequirementType.TRANSPORTS.value: "transports",
    RequirementType.REFUSALS.value: "refusals",
    RequirementType.EVALUATED_CALLS.value: "evaluated calls",
}


def is_evaluation_credited(req) -> bool:
    """Whether ``req`` is counted from the member's shift evaluations.

    Owner decision (2026-11-14): evaluated shifts and calls, transports and
    refusals are credited only by submitted evaluations the member can see,
    whether the requirement is a program's own (the credit ledger) or the
    department's (this grader). A training record never stands in for one.
    """
    req_type = getattr(req, "requirement_type", None)
    req_type = getattr(req_type, "value", req_type)
    return req_type in _EVALUATION_TYPE_UNITS


def _require_evaluation_credits(
    req, evaluation_credits: Optional[EvaluationCredits]
) -> EvaluationCredits:
    """``evaluation_credits``, or a loud failure when a caller did not load them.

    As with shift dates: grading without them would read zero for everybody.
    """
    if evaluation_credits is None:
        raise ValueError(
            f"Requirement {getattr(req, 'id', '?')} counts shift evaluations; "
            "pass the member's evaluation_credits (load_evaluation_credits)"
        )
    return evaluation_credits


def evaluation_target(req) -> float:
    """The count an evaluation-credited requirement asks for (0 when unset)."""
    req_type = getattr(req.requirement_type, "value", req.requirement_type)
    column = next(
        column
        for rtype, column in EVALUATION_REQUIREMENT_TARGETS.items()
        if rtype.value == req_type
    )
    return float(getattr(req, column, None) or 0)


def evaluation_credits_in_window(
    req, evaluation_credits: Optional[EvaluationCredits], as_of: date
) -> List[Tuple[date, float]]:
    """The member's evaluation credit toward ``req`` as of ``as_of``.

    Windowed as :func:`credited_shifts_in_window` windows shifts worked —
    :func:`completion_window`, the frequency window narrowed by any
    freshness cutoff — so an evaluated shift counts in the same period a
    shift worked does. Every grader of these types goes through here.
    """
    start, end = completion_window(req, as_of)
    return [
        (d, units)
        for d, units in _require_evaluation_credits(req, evaluation_credits).get(
            str(req.id), []
        )
        if (start is None or d >= start) and (end is None or d <= end)
    ]


def latest_evaluation_credit(
    req, evaluation_credits: Optional[EvaluationCredits], as_of: date
) -> Optional[date]:
    """The date of the member's latest evaluation counted toward ``req``.

    What a rolling evaluation-credited requirement falls due from (owner
    decision, 2026-11-16), as a rolling shifts-worked one falls due from the
    latest shift: the evidence the count reads, never a training record. Not
    bounded by the window, so an evaluation older than it still dates the
    requirement overdue, but bounded by any freshness cutoff. Shared by
    ``TrainingService.evaluate_requirement_detail`` and
    ``check_requirement_progress`` so the two due dates agree.
    """
    cutoff = recency_cutoff(req, as_of)
    return max(
        (
            d
            for d, units in _require_evaluation_credits(req, evaluation_credits).get(
                str(req.id), []
            )
            if units > 0 and (cutoff is None or d >= cutoff)
        ),
        default=None,
    )


def is_session_attendance(req) -> bool:
    """Whether ``req`` is graded on attendance at its linked sessions."""
    req_type = getattr(req, "requirement_type", None)
    req_type = getattr(req_type, "value", req_type)
    return req_type == RequirementType.SESSION_ATTENDANCE.value


@dataclass(frozen=True)
class GoverningRequirement:
    """The session-attendance requirement that speaks for one member.

    ``requirement`` is None when none applies, or when ``ambiguous``: more
    than one applies and nothing decides between them.
    """

    requirement: Optional[TrainingRequirement]
    ambiguous: bool = False


def governing_attendance_requirement(
    member, member_requirements: Iterable
) -> GoverningRequirement:
    """Which session-attendance requirement a member's attendance is read against.

    ``member_requirements`` are the requirements that already grade the
    member (``ComplianceGrading.for_member(...).requirements``), so profiles,
    scoping and grandfathering have been applied. Of the session-attendance
    ones, a single one is used as is. Several are narrowed to the ones naming
    the member's membership type (owner decision, 2026-11-10: "the one
    related to their membership type"); if that does not leave exactly one,
    the answer is ambiguous rather than a guess, because two requirements can
    link different sessions at different percentages and either pick would
    report a figure the other contradicts.
    """
    candidates = [r for r in member_requirements if is_session_attendance(r)]
    if len(candidates) <= 1:
        return GoverningRequirement(candidates[0] if candidates else None)
    # requirement_applies_to_user reads a missing type as "active"; so does this.
    membership_type = getattr(member, "membership_type", None) or "active"
    named = [
        r
        for r in candidates
        if membership_type in (getattr(r, "required_membership_types", None) or [])
    ]
    if len(named) == 1:
        return GoverningRequirement(named[0])
    return GoverningRequirement(None, ambiguous=True)


@dataclass(frozen=True)
class HeldSession:
    """A session linked to an attendance requirement that has been held.

    ``held_on`` is the session's day on the department's calendar, the date
    its attendance records carry (see ``TrainingSessionService`` finalize).
    """

    event_id: str
    held_on: date


@dataclass(frozen=True)
class AttendanceTally:
    """One member's standing on one SESSION_ATTENDANCE requirement.

    ``held`` counts the linked sessions held in the window since the member
    joined; ``charged`` is those minus the ones a waiver, a leave or an
    approved waiver request excused (a session the member attended anyway
    stays charged, and counts);
    ``needed`` is how many of ``charged`` the percentage asks for, and
    ``base_needed`` what it would ask of ``held``.
    """

    attended: int
    charged: int
    held: int
    needed: int
    base_needed: int
    latest_attended: Optional[date]
    # A Chief's override covers the cut-off of a member short of the count
    # (TrainingRequirementOverride): met, with the count reported as it is.
    overridden: bool = False

    @property
    def met(self) -> bool:
        return self.overridden or self.attended >= self.needed


def _sessions_needed(pct: float, count: int) -> int:
    # The tolerance keeps 60% of 5 at 3: 0.6 * 5 is 3.0000000000000004.
    return max(0, math.ceil(pct * count / 100 - 1e-9))


def _waiver_excuses(waiver: WaiverPeriod, req_id: str, session: HeldSession) -> bool:
    # An override excuses no session; it decides the result instead.
    if waiver.source == SOURCE_OVERRIDE:
        return False
    # An approved waiver request excuses its own session and no other, for
    # every requirement the session counts toward (owner decision,
    # 2026-11-10). Matched on the event rather than the day, so another
    # session that day stays charged and a requirement linked after the
    # approval is covered too.
    if waiver.source == SOURCE_SESSION_EXCUSAL:
        return waiver.event_id is not None and waiver.event_id == session.event_id
    # The same reading of requirement_ids as excused_month_reasons: an
    # empty or missing list is a blanket waiver.
    if waiver.requirement_ids and req_id not in [
        str(r) for r in waiver.requirement_ids
    ]:
        return False
    return waiver.start_date <= session.held_on <= waiver.end_date


def tally_session_attendance(
    req,
    member_records,
    held_sessions: Sequence[HeldSession],
    as_of: date,
    waivers=None,
    join_date: Optional[date] = None,
    window: Optional[Tuple[date, date]] = None,
) -> AttendanceTally:
    """Count a member's attendance at ``req``'s sessions as of ``as_of``.

    The one definition of the rule, read by every grader. ``as_of`` is the
    requirement's evaluation cut-off (:func:`requirement_as_of`). A session
    counts when it falls in :func:`completion_window`, on or before the
    cut-off and on or after ``join_date``; a member is not charged with a
    drill held before they joined. A member attended it when they hold a
    COMPLETED record whose ``source_event_id`` is the session's event, the
    record finalizing the session writes. A Chief's override covering
    ``as_of`` makes the tally met; the counts stay as they are.

    ``window`` replaces the requirement's own window with an explicit
    ``(first, last)`` day range, for a reader whose period is not the
    requirement's: the annual evaluation measures over its review period
    (owner decision, 2026-11-10), where a monthly requirement's own window
    would show only the final month. What is held, attended and excused is
    decided the same way either way. ``met`` and ``overridden`` are not: an
    override is checked on ``as_of`` alone, so over a replaced window they
    describe the cut-off, not the range, and a windowed reader should report
    the counts.
    """
    if window is None:
        start, end = completion_window(req, as_of)
    else:
        start, end = window
    last = as_of if end is None else min(end, as_of)
    req_id = str(req.id)
    attended_events = {
        str(r.source_event_id)
        for r in member_records
        if r.status == TrainingStatus.COMPLETED and getattr(r, "source_event_id", None)
    }
    in_window = [
        s
        for s in held_sessions
        if (start is None or s.held_on >= start)
        and s.held_on <= last
        and (join_date is None or s.held_on >= join_date)
    ]
    charged = [
        s
        for s in in_window
        if s.event_id in attended_events
        or not any(_waiver_excuses(w, req_id, s) for w in waivers or [])
    ]
    attended = [s for s in charged if s.event_id in attended_events]
    pct = float(req.required_attendance_pct or 0)
    needed = _sessions_needed(pct, len(charged))
    return AttendanceTally(
        attended=len(attended),
        charged=len(charged),
        held=len(in_window),
        needed=needed,
        base_needed=_sessions_needed(pct, len(in_window)),
        latest_attended=max((s.held_on for s in attended), default=None),
        # Only for a member who would otherwise fall short, so "met by
        # override" never labels one who met it, and only while the
        # requirement still accepts overrides: switching the setting off
        # suspends every override on it without erasing them.
        overridden=len(attended) < needed
        and bool(getattr(req, "allows_chief_override", False))
        and override_covers(waivers, req_id, as_of),
    )


def _require_held_sessions(
    req, held_sessions: Optional[Mapping[str, Sequence[HeldSession]]]
) -> Sequence[HeldSession]:
    """``req``'s held sessions, or a loud failure when a caller did not load them.

    Grading without them would read every member as owing nothing, which
    looks like full compliance.
    """
    if held_sessions is None:
        raise ValueError(
            f"Requirement {getattr(req, 'id', '?')} counts session attendance; "
            "pass held_sessions (load_held_sessions)"
        )
    return held_sessions.get(str(req.id), [])


async def load_held_sessions(
    db: AsyncSession,
    org_id: str,
    requirements: Iterable[TrainingRequirement],
) -> Dict[str, List[HeldSession]]:
    """The held sessions of each SESSION_ATTENDANCE requirement, by requirement id.

    A session is held once it is finalized and its event was not cancelled,
    the point at which finalizing writes its attendance records. Counting a
    session before that would charge every member who attended it as absent
    until an officer closed it out (the same reason SHIFTS counts only
    finalized shifts). ``{}`` when none of ``requirements`` is of the type,
    and callers pass the mapping whole.

    A session that requires completion confirmation is not held while its
    newest approval is pending: finalizing it writes IN_PROGRESS records
    only, and a member counts as attended only on a COMPLETED one, so
    counting it from finalize charged every attendee with a session they
    were not yet credited for, for as long as the sign-off waited. The
    approval decides it either way — approved, the records complete and it
    is attended; rejected, it is held and charged as any other. Only the
    newest approval counts: a re-finalize leaves the earlier one PENDING with
    its link killed ("newest" is by a one-second ``created_at``, so a reopen
    and re-finalize inside the same second ties, and a tie with a pending
    approval reads as pending). Every grader and the waiver checks read this
    function, so the rule lives here once (pitfall #29).
    """
    from sqlalchemy.orm import aliased

    from app.models.event import Event
    from app.models.training import ApprovalStatus, TrainingApproval

    ids = [str(r.id) for r in requirements if is_session_attendance(r)]
    if not ids:
        return {}
    pending = aliased(TrainingApproval)
    newer = aliased(TrainingApproval)
    awaiting_sign_off = (
        select(pending.id)
        .where(
            pending.training_session_id == TrainingSession.id,
            pending.organization_id == str(org_id),
            pending.status == ApprovalStatus.PENDING,
            ~select(newer.id)
            .where(
                newer.training_session_id == pending.training_session_id,
                newer.created_at > pending.created_at,
            )
            .exists(),
        )
        .exists()
    )
    rows = await db.execute(
        select(
            TrainingSessionRequirement.requirement_id,
            Event.id,
            Event.start_datetime,
        )
        .join(
            TrainingSession,
            TrainingSession.id == TrainingSessionRequirement.session_id,
        )
        .join(Event, Event.id == TrainingSession.event_id)
        .where(
            TrainingSessionRequirement.organization_id == str(org_id),
            TrainingSessionRequirement.requirement_id.in_(ids),
            TrainingSession.organization_id == str(org_id),
            TrainingSession.is_finalized.is_(True),
            Event.is_cancelled.is_(False),
            ~awaiting_sign_off,
        )
    )
    tz = await resolve_scheduling_timezone(db, org_id)
    by_req: Dict[str, List[HeldSession]] = {rid: [] for rid in ids}
    for req_id, event_id, start in rows.all():
        by_req[str(req_id)].append(HeldSession(str(event_id), local_date(start, tz)))
    for sessions in by_req.values():
        sessions.sort(key=lambda s: s.held_on)
    return by_req


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
    # Of waived_months, how many a leave of absence and how many a training
    # waiver excused; a month both touched counts in both, so these can sum
    # to more than waived_months.
    leave_months: int = 0
    waiver_months: int = 0
    window_start: Optional[str] = None
    window_end: Optional[str] = None
    as_of: Optional[str] = None
    catch_up_deadline: Optional[str] = None
    # Met by a Chief's override rather than by the count (SESSION_ATTENDANCE).
    overridden: bool = False
    # HOURS only: the member's average a month and the department's monthly
    # pace (MonthlyPace). Displayed beside the total; never graded on.
    monthly_average: Optional[float] = None
    monthly_needed: Optional[float] = None


def evaluate_member_requirement_detail(
    req,
    member_records,
    today: date,
    waivers=None,
    org_include_current_month: bool = True,
    join_date: Optional[date] = None,
    shift_dates: Optional[Sequence[date]] = None,
    held_sessions: Optional[Mapping[str, Sequence[HeldSession]]] = None,
    evaluation_credits: Optional[EvaluationCredits] = None,
    credited_hours: Optional[Sequence[CreditedHours]] = None,
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

    ``held_sessions`` is :func:`load_held_sessions` for the requirements being
    graded, required whenever ``req`` is a SESSION_ATTENDANCE requirement.

    ``evaluation_credits`` is the member's entry in
    :func:`load_evaluation_credits`, required whenever ``req`` is counted from
    shift evaluations (:func:`is_evaluation_credited`).

    ``credited_hours``, when given, is what an HOURS requirement counts in
    place of training records: the Shift Compliance report's shift hours for
    a shift-credited requirement. Everything else about the grade (window,
    freshness, waiver proration, cut-off, catch-up) is unchanged, which is
    the point: the report and the training screens prorate alike.
    """
    ev = _grade_member_requirement(
        req,
        member_records,
        today,
        waivers=waivers,
        org_include_current_month=org_include_current_month,
        shift_dates=shift_dates,
        held_sessions=held_sessions,
        join_date=join_date,
        evaluation_credits=evaluation_credits,
        credited_hours=credited_hours,
    )
    # Measured against the real day rather than the evaluation cut-off: the
    # deadline is a calendar promise to the member, not a period boundary.
    deadline = catch_up_deadline(req, join_date, today)
    if deadline is not None and ev.status not in (
        TrainingStatus.COMPLETED.value,
        NOT_YET_HELD_STATUS,
    ):
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
    held_sessions: Optional[Mapping[str, Sequence[HeldSession]]] = None,
    join_date: Optional[date] = None,
    evaluation_credits: Optional[EvaluationCredits] = None,
    credited_hours: Optional[Sequence[CreditedHours]] = None,
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
    - EVALUATED_SHIFTS, TRANSPORTS, REFUSALS, EVALUATED_CALLS:
                      Sum the units of the member's visible shift
                      evaluations within the window
                      (:func:`load_evaluation_credits`); never records
    - SESSION_ATTENDANCE: Share of the linked sessions held since
                      ``join_date`` the member attended
                      (:func:`tally_session_attendance`)
    - Others:         Match by training_type, or by name for legacy records
                      (see fallback_record_matches)
    """
    req_type = (
        req.requirement_type.value
        if hasattr(req.requirement_type, "value")
        else str(req.requirement_type)
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
        pace: Optional[MonthlyPace] = None,
    ) -> RequirementEvaluation:
        # The months adjust_required prorated by, split by reason.
        reasons = excused_month_reasons(
            _waivers if waived else [], start_date, end_date, str(req.id)
        )
        return RequirementEvaluation(
            status=status,
            completion_date=comp,
            expiry_date=exp,
            progress_current=current,
            progress_required=required,
            progress_unit=unit,
            base_required=base,
            waived_months=waived,
            leave_months=reasons["leave_months"],
            waiver_months=reasons["waiver_months"],
            window_start=start_date.isoformat() if start_date else None,
            window_end=end_date.isoformat() if end_date else None,
            as_of=today.isoformat(),
            monthly_average=pace.average if pace else None,
            monthly_needed=pace.needed if pace else None,
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
        if credited_hours is None:
            type_matched = [r for r in windowed if hours_record_counts(req, r)]
        else:
            # Shift hours are not training: no category, course or type to
            # match, so the window and freshness cut-off alone decide.
            type_matched = [
                h
                for h in apply_recency(req, list(credited_hours), today)
                if not (start_date and end_date)
                or start_date <= h.completion_date <= end_date
            ]

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

        progress: Dict[str, Any] = {
            "current": total_hours,
            "required": required,
            "unit": "hours",
            "base": base_required,
            "waived": waived_months,
        }
        if start_date and end_date:
            # Measured on the same month rows My Training's breakdown lists,
            # through the evaluation date rather than the window's far end.
            progress["pace"] = monthly_pace(
                monthly_hours(
                    type_matched,
                    start_date,
                    min(end_date, today),
                    month_waivers(_waivers, start_date, end_date, str(req.id)),
                ),
                base_required,
                start_date,
                end_date,
            )

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

        lapsed = lapsed_biannual_certificate(req, type_matched, today)
        if lapsed is not None:
            exp_comp = (
                lapsed.completion_date.isoformat()
                if lapsed.completion_date
                else latest_comp
            )
            return _ev(
                "expired", exp_comp, lapsed.expiration_date.isoformat(), **progress
            )

        if required > 0 and meets_required_hours(total_hours, required):
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

        lapsed = lapsed_biannual_certificate(req, windowed, today)
        if lapsed is not None:
            exp_comp = (
                lapsed.completion_date.isoformat()
                if lapsed.completion_date
                else latest_comp
            )
            return _ev(
                "expired", exp_comp, lapsed.expiration_date.isoformat(), **progress
            )

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
                whole_units=True,
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

        # A base target that leave prorated down to zero is met: the member
        # owes nothing for the window.
        if (required > 0 or base_required > 0) and count >= required:
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
                whole_units=True,
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

        # A base target that leave prorated down to zero is met: the member
        # owes nothing for the window.
        if (required > 0 or base_required > 0) and count >= required:
            return _ev("completed", latest_comp, latest_exp, **progress)
        elif count > 0:
            return _ev("in_progress", latest_comp, latest_exp, **progress)
        return _ev("not_started", None, None, **progress)

    # ---- Shift-evaluation requirements (evaluated shifts, transports,
    # refusals): counted like attendance-credited SHIFTS — the same window,
    # the same whole-unit waiver proration — from evaluations, not records.
    if req_type in _EVALUATION_TYPE_UNITS:
        counted = evaluation_credits_in_window(req, evaluation_credits, today)
        earned = float(sum(units for _, units in counted))
        required = evaluation_target(req)
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
                whole_units=True,
            )

        progress = {
            "current": earned,
            "required": required,
            "unit": _EVALUATION_TYPE_UNITS[req_type],
            "base": base_required,
            "waived": waived_months,
        }
        latest_evaluated = max((d for d, _ in counted), default=None)
        latest_comp = latest_evaluated.isoformat() if latest_evaluated else None

        # A base target that leave prorated down to zero is met, as for
        # shifts and calls.
        if (required > 0 or base_required > 0) and earned >= required:
            return _ev("completed", latest_comp, None, **progress)
        elif earned > 0:
            return _ev("in_progress", latest_comp, None, **progress)
        return _ev("not_started", None, None, **progress)

    # ---- SESSION_ATTENDANCE requirements ----
    if req_type == RequirementType.SESSION_ATTENDANCE.value:
        tally = tally_session_attendance(
            req,
            member_records,
            _require_held_sessions(req, held_sessions),
            today,
            waivers=_waivers,
            join_date=join_date,
        )
        progress = {
            "current": tally.attended,
            "required": tally.needed,
            "unit": "sessions",
            "base": tally.base_needed,
        }
        latest_comp = (
            tally.latest_attended.isoformat() if tally.latest_attended else None
        )
        # Nothing held yet: nothing to have attended, so not graded at all.
        # Held but every one excused is different: the member was excused and
        # owes nothing, as a target prorated to zero is for shifts and calls,
        # and that is met.
        if tally.held == 0:
            return _ev(NOT_YET_HELD_STATUS, None, None, **progress)
        if tally.met:
            return replace(
                _ev("completed", latest_comp, None, **progress),
                overridden=tally.overridden,
            )
        if tally.attended > 0:
            return _ev("in_progress", latest_comp, None, **progress)
        return _ev("not_started", None, None, **progress)

    # ---- Fallback (skills_evaluation, checklist, knowledge_test, etc.) ----
    matching = fallback_record_matches(req, windowed)

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
        if fallback_record_matches(req, in_progress):
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
    held_sessions: Optional[Mapping[str, Sequence[HeldSession]]] = None,
    evaluation_credits: Optional[EvaluationCredits] = None,
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
        held_sessions=held_sessions,
        evaluation_credits=evaluation_credits,
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
        RequirementType.SESSION_ATTENDANCE.value,
        *_EVALUATION_TYPE_UNITS,
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

    - **Windowed types** (hours, courses, shifts and calls) read COMPLETED
      records with a completion date inside
      :func:`completion_window`. Every frequency now has a bounded window
      except ONE_TIME, and so does every rolling requirement, so this is a
      date range — including biannual hours, whose expired-certificate
      override reads only the windowed records. A certification-period due
      date changes nothing here: the grader never reads one.
    - **ONE_TIME without a freshness cutoff** has no window. The grader reads
      every COMPLETED record, including one with no completion date, so all
      of them are selected — a one-time hours, courses, shifts or calls
      requirement still costs the member's full completed history.
    - **CERTIFICATION** ignores the frequency window and reads the COMPLETED
      records :func:`certification_record_matches` can accept — on or after
      the freshness cutoff when there is one, of any date otherwise. Since
      the name and registry-code matches compare stored keys
      (:func:`record_name_matches`, :func:`registry_code_matches`), that is a
      filter SQL can apply: a linked course, the training type, the name's key
      (only while the requirement has a ``name_match_until``) or a
      certification key beginning with the code's.
    - **Fallback types** (skills evaluation, checklist, knowledge test) read
      the COMPLETED records in :func:`completion_window` (any date for
      ONE_TIME without a cutoff), and IN_PROGRESS records of any date when
      nothing completed matches — in both cases only those of the
      requirement's training type or, while it has a ``name_match_until``,
      its name's key (:func:`fallback_record_matches`).

    A key filter can only over-select, never miss: equal keys are equal
    strings, which every collation compares equal, and a string beginning
    with another matches it as a ``LIKE`` prefix. Whatever extra a collation
    lets through is dropped by the grader, which compares the stored keys in
    Python. A record is never loaded for text its key does not carry.

    - **Shift-evaluation types** (evaluated shifts, transports, refusals)
      read no records: :func:`load_evaluation_credits` feeds them.
    - **SESSION_ATTENDANCE** reads COMPLETED records by ``source_event_id``,
      not by date, so the records of every session linked to one are
      selected whatever their completion date.

    SCHEDULED, CANCELLED and FAILED records are never read and never loaded.
    Grandfathering, catch-up deadlines and waivers read the member and the
    waiver tables, not records, so they widen nothing.

    ``today`` and ``org_include_current_month`` must be the values the
    caller grades with: windows are resolved per requirement through
    :func:`requirement_as_of`, as the grader resolves them.
    """
    spans: List[Tuple[date, Optional[date]]] = []
    all_completed = False
    completed = TrainingRecord.status == TrainingStatus.COMPLETED
    # Clauses for the requirements whose records are found by what they match
    # (certification and fallback types) rather than by date alone.
    matched: List[ColumnElement[bool]] = []
    attendance_ids: List[str] = []
    for req in requirements:
        if is_session_attendance(req):
            attendance_ids.append(str(req.id))
        if is_evaluation_credited(req):
            # Counted from shift evaluations; reads no record at all.
            continue
        as_of = requirement_as_of(req, today, org_include_current_month)
        req_type = getattr(req.requirement_type, "value", req.requirement_type)
        if req_type == RequirementType.CERTIFICATION.value:
            match = _record_match_clause(req, certification=True)
            if match is not None:
                cutoff = recency_cutoff(req, as_of)
                dated = (
                    [] if cutoff is None else [TrainingRecord.completion_date >= cutoff]
                )
                matched.append(and_(completed, match, *dated))
            continue
        start, end = completion_window(req, as_of)
        if req_type not in _TYPED_BRANCH_TYPES:
            match = _record_match_clause(req, certification=False)
            if match is None:
                continue
            matched.append(
                and_(TrainingRecord.status == TrainingStatus.IN_PROGRESS, match)
            )
            if start is None:
                matched.append(and_(completed, match))
            elif end is None:
                matched.append(
                    and_(completed, match, TrainingRecord.completion_date >= start)
                )
            elif start <= end:
                matched.append(
                    and_(
                        completed,
                        match,
                        TrainingRecord.completion_date.between(start, end),
                    )
                )
            continue
        if start is None:
            all_completed = True
        elif end is None or start <= end:
            # start > end: the freshness cutoff falls after the window closes,
            # so the grader's windowed pool is empty and nothing is needed.
            spans.append((start, end))

    clauses: List[ColumnElement[bool]] = []
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
    clauses.extend(matched)
    if attendance_ids:
        clauses.append(
            and_(
                completed,
                TrainingRecord.source_event_id.in_(
                    select(TrainingSession.event_id)
                    .join(
                        TrainingSessionRequirement,
                        TrainingSessionRequirement.session_id == TrainingSession.id,
                    )
                    .where(
                        TrainingSessionRequirement.requirement_id.in_(attendance_ids)
                    )
                ),
            )
        )
    return or_(*clauses) if clauses else false()


def _record_match_clause(req, *, certification: bool) -> Optional[ColumnElement[bool]]:
    """SQL for the records ``req`` can match by course, type, name or code.

    The query side of :func:`certification_record_matches`
    (``certification=True``) and :func:`fallback_record_matches`. ``None`` when the
    requirement can match nothing at all.
    """
    clauses: List[ColumnElement[bool]] = []
    if certification:
        linked = [str(c) for c in (getattr(req, "required_courses", None) or [])]
        if linked:
            clauses.append(TrainingRecord.course_id.in_(linked))
    if req.training_type:
        clauses.append(TrainingRecord.training_type == req.training_type)
    name_key = training_match_key(req.name)
    if name_key and getattr(req, "name_match_until", None) is not None:
        clauses.append(TrainingRecord.match_key == name_key)
    if certification:
        code_key = training_match_key(getattr(req, "registry_code", None))
        if code_key:
            clauses.append(
                TrainingRecord.certification_key.like(
                    like_pattern(code_key, prefix=True), escape=LIKE_ESCAPE_CHAR
                )
            )
    return or_(*clauses) if clauses else None


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
    from app.models.training import Shift, ShiftAssignment, ShiftAttendance

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
    # Each date carries the seat held that shift (SeatedDate), for a
    # requirement limited to one seat; every other reader sees plain dates.
    seats = member_seat_on_shift(ShiftAssignment.user_id.in_(ids))
    attendance = await db.execute(
        select(
            ShiftAttendance.user_id,
            Shift.shift_date,
            seats.c.position,
            func.count(ShiftAttendance.id),
        )
        .join(Shift, ShiftAttendance.shift_id == Shift.id)
        .outerjoin(
            seats,
            and_(
                seats.c.shift_id == Shift.id,
                seats.c.user_id == ShiftAttendance.user_id,
            ),
        )
        .where(
            Shift.organization_id == str(org_id),
            Shift.is_finalized.is_(True),
            # A station tour is not a shift worked toward a shift requirement.
            duty_shifts_only(),
            ShiftAttendance.user_id.in_(ids),
            *_dated(Shift.shift_date),
        )
        .group_by(ShiftAttendance.user_id, Shift.shift_date, seats.c.position)
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
    for user_id, shift_date, seat, n in attendance.all():
        by_user.setdefault(str(user_id), []).extend(
            [SeatedDate(shift_date, seat)] * int(n or 0)
        )
    # Another agency's apparatus: a shift worked, in no seat of ours.
    for user_id, shift_date, n in external.all():
        by_user.setdefault(str(user_id), []).extend(
            [SeatedDate(shift_date, None)] * int(n or 0)
        )
    for dates in by_user.values():
        dates.sort()
    return by_user


async def load_evaluation_credits(
    db: AsyncSession,
    org_id: str,
    member_ids: Sequence[str],
    requirements: Iterable[TrainingRequirement],
    today: date,
    org_include_current_month: bool,
    *,
    full_history: bool = False,
) -> Dict[str, Dict[str, List[Tuple[date, float]]]]:
    """Each member's shift-evaluation credit, by requirement id.

    Owner decision (2026-11-14): a department requirement of an evaluation
    type — linked into a program or not — is credited by the same
    evaluations, worth the same units, as a program's own is through
    ``ShiftEvaluationService.sync_credit``. Both read the shared rules in
    ``shift_evaluation_rules``: an evaluation counts once the member can see
    it (:func:`evaluation_visible`, the batched form of
    ``ShiftEvaluationService.visible_to_member``) and is worth
    :func:`credit_units` toward each requirement. One evaluation scoped to
    several programs is one evaluation here: the department requirement is
    the member's, not any one enrollment's.

    Dated by the shift's date, so the grader windows it as it windows shifts
    worked. Loaded only when one of ``requirements`` is evaluation-credited;
    otherwise ``{}``, and callers pass ``.get(member_id, {})``. Bounded by the
    earliest start of those requirements' :func:`completion_window`.
    ``full_history`` lifts the bound when one of them is rolling: a caller
    deriving a rolling due date from the latest evaluation
    (:func:`latest_evaluation_credit`) needs the evaluations older than the
    window, as :func:`load_credited_shift_dates` does for shifts.
    """
    from app.models.external_shift_hours import ExternalShiftHours
    from app.models.shift_evaluation import EXTERNAL_OCCASION, ShiftEvaluation
    from app.models.training import (
        Shift,
        ShiftCompletionReport,
        TrainingModuleConfig,
    )

    credited = [r for r in requirements if is_evaluation_credited(r)]
    if not credited or not member_ids:
        return {}

    starts = [
        completion_window(
            req, requirement_as_of(req, today, org_include_current_month)
        )[0]
        for req in credited
    ]
    # One unbounded requirement (ONE_TIME without a cutoff) reads them all.
    bounded = [s for s in starts if s is not None]
    earliest = min(bounded) if len(bounded) == len(starts) else None
    if full_history and any(get_rolling_period_months(r) for r in credited):
        earliest = None

    org = str(org_id)
    ids = [str(m) for m in member_ids]
    query = select(ShiftEvaluation).where(
        ShiftEvaluation.organization_id == org,
        ShiftEvaluation.member_id.in_(ids),
        ShiftEvaluation.status == "submitted",
    )
    if earliest is not None:
        query = query.where(ShiftEvaluation.shift_date >= earliest)
    evaluations = list((await db.execute(query)).scalars().all())
    if not evaluations:
        return {}

    review_required = bool(
        (
            await db.execute(
                select(TrainingModuleConfig.report_review_required).where(
                    TrainingModuleConfig.organization_id == org
                )
            )
        )
        .scalars()
        .first()
    )
    on_shift = [
        e
        for e in evaluations
        if (e.occasion or "") != EXTERNAL_OCCASION and e.shift_id is not None
    ]
    shift_ids = list({str(e.shift_id) for e in on_shift})
    reports: Dict[Tuple[str, str], Optional[str]] = {}
    finalized: set = set()
    if review_required and shift_ids:
        for shift_id, trainee_id, status in (
            await db.execute(
                select(
                    ShiftCompletionReport.shift_id,
                    ShiftCompletionReport.trainee_id,
                    ShiftCompletionReport.review_status,
                ).where(
                    ShiftCompletionReport.organization_id == org,
                    ShiftCompletionReport.shift_id.in_(shift_ids),
                    ShiftCompletionReport.trainee_id.in_(ids),
                )
            )
        ).all():
            reports[(str(shift_id), str(trainee_id))] = status
        finalized = {
            str(i)
            for i in (
                await db.execute(
                    select(Shift.id).where(
                        Shift.organization_id == org,
                        Shift.id.in_(shift_ids),
                        Shift.is_finalized.is_(True),
                    )
                )
            ).scalars()
        }
    entry_ids = list(
        {
            str(e.external_shift_id)
            for e in evaluations
            if (e.occasion or "") == EXTERNAL_OCCASION and e.external_shift_id
        }
    )
    entry_statuses: Dict[str, str] = {}
    if entry_ids:
        entry_statuses = {
            str(entry_id): status
            for entry_id, status in (
                await db.execute(
                    select(ExternalShiftHours.id, ExternalShiftHours.status).where(
                        ExternalShiftHours.organization_id == org,
                        ExternalShiftHours.id.in_(entry_ids),
                    )
                )
            ).all()
        }

    by_user: Dict[str, Dict[str, List[Tuple[date, float]]]] = {}
    for evaluation in evaluations:
        key = (str(evaluation.shift_id), str(evaluation.member_id))
        if not evaluation_visible(
            evaluation,
            review_required=review_required,
            report_status=reports.get(key),
            has_report=key in reports,
            shift_finalized=str(evaluation.shift_id) in finalized,
            entry_status=entry_statuses.get(str(evaluation.external_shift_id)),
        ):
            continue
        for req in credited:
            units = credit_units(evaluation, req)
            if units > 0:
                by_user.setdefault(str(evaluation.member_id), {}).setdefault(
                    str(req.id), []
                ).append((evaluation.shift_date, units))
    return by_user


def matching_profiles(
    member: User,
    profiles: Sequence[ComplianceProfile],
) -> List[ComplianceProfile]:
    """Every active profile that matches a member, in resolution order.

    The order is :func:`app.utils.compliance_profiles.ordered_profiles`:
    higher priority first, then the older profile, then the smaller id, so a
    caller may pass profiles in any order. Matches by membership_type and/or
    role_ids. A profile with no membership_types and no role_ids matches all
    members. The first entry is the profile that grades the member
    (:func:`_find_matching_profile`); :func:`admin_hours_profile` reads further
    down the list. One matching rule for both, so a member never sits under
    one profile for training and another for admin hours by accident.
    """
    member_types = {getattr(member, "membership_type", None)}
    # The legacy membership_type has no word for a junior member (it derives
    # to "probationary"), so the profile form's "junior" chip is matched on
    # the status itself. Every other chip keeps matching the legacy value.
    if (
        canonical_member_status(getattr(member, "member_status", None))
        == MemberStatus.JUNIOR
    ):
        member_types.add(MemberStatus.JUNIOR)
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

    matched: List[ComplianceProfile] = []
    for profile in ordered_profiles(list(profiles)):
        if not profile.is_active:
            continue

        type_match = True
        role_match = True

        if profile.membership_types:
            type_match = bool(member_types & set(profile.membership_types))

        if profile.role_ids:
            role_match = bool(set(member_role_ids) & set(profile.role_ids))

        if type_match and role_match:
            matched.append(profile)

    return matched


def _find_matching_profile(
    member: User,
    profiles: List[ComplianceProfile],
) -> Optional[ComplianceProfile]:
    """The profile that grades a member: the first of
    :func:`matching_profiles`, or None if no profile matches."""
    matched = matching_profiles(member, profiles)
    return matched[0] if matched else None


def admin_hours_profile(
    member: User,
    profiles: Sequence[ComplianceProfile],
) -> Optional[ComplianceProfile]:
    """The profile a member's admin-hours targets come from.

    Owner decision 2026-11-23: the profile that grades the member's training
    (:func:`_find_matching_profile`, the one ``ComplianceGrading.for_member``
    reads), when it sets admin hours. When it sets none, the highest-priority
    matching profile that does, which is the rule admin hours followed before.
    Both come from :func:`matching_profiles`, so the tie-break and the
    "junior" chip are grading's own. ``member.positions`` must be loaded.
    """
    matched = matching_profiles(member, profiles)
    if matched and matched[0].admin_hours_requirements:
        return matched[0]
    return next((p for p in matched if p.admin_hours_requirements), None)


# Status reported for an existing member's unmet requirement while its
# catch-up period runs. Not a TrainingStatus: it describes the member's
# obligation, not a training record, and it never counts against standing.
CATCH_UP_STATUS = "catch_up"

# Status for a session-attendance requirement with no linked session held in
# the member's window yet. There is nothing to have attended, so it is neither
# met nor unmet: it used to read "0/0 sessions - Complete" and count as met,
# the empty denominator CLAUDE.md pitfall #29 warns of (workflow review W80-9,
# owner decision 2026-11-08). The same value the competency matrix uses for a
# requirement that does not apply to a member, and graded the same way.
NOT_YET_HELD_STATUS = "not_applicable"

# Statuses that count neither for nor against a member's standing.
UNGRADED_STATUSES = frozenset({CATCH_UP_STATUS, NOT_YET_HELD_STATUS})


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
    deadline: Optional[date] = getattr(req, "existing_member_deadline", None)
    if not (cutoff and deadline and join_date):
        return None
    if join_date < cutoff and today <= deadline:
        return deadline
    return None


def tally_standing(statuses: Iterable[str]) -> Tuple[int, int]:
    """(met, total) over a member's requirement statuses.

    A requirement in its catch-up period is left out of both counts: it is
    neither met nor held against the member until the deadline passes. So is
    a session-attendance requirement no session of which has been held yet
    (:data:`NOT_YET_HELD_STATUS`). Every screen that turns statuses into a
    standing goes through this so a member reads the same on the dashboard,
    the matrix and the profile card.
    """
    met = 0
    total = 0
    for status in statuses:
        if status in UNGRADED_STATUSES:
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

    The precedence every grader applies after a member's compliance profile
    (``ComplianceGrading.for_member``) has narrowed the set:
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

    :func:`mandatory_tiers_for_requirements` projects this same precedence
    onto an event's "Mandatory for" tiers; a change here belongs there too.
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


# Membership words that name a member class rather than a rung: an
# administrative member stands on whatever rung their status puts them, so no
# tier stands for "administrative", and "honorary" is the social class.
_CLASS_MEMBERSHIP_WORDS = frozenset({"administrative", "honorary"})


@dataclass(frozen=True)
class UnmappedRequirement:
    requirement_id: str
    name: str
    # Shown to the officer as written, after the requirement's name, so it is
    # plain language: no "tier" or "member class".
    reason: str
    # It grades no member at all, so it adds no one to "Mandatory for". The
    # others grade members no tier stands for, and the form offers All
    # members for them; it tells the two apart by this, not by the wording.
    applies_to_no_one: bool = False


@dataclass(frozen=True)
class MandatoryTiers:
    """Who an event counting toward some requirements is mandatory for."""

    everyone: bool
    tier_ids: List[str]
    unmapped: List[UnmappedRequirement]
    # The requirements the suggestion comes from, in the order given: those
    # that contributed a tier, or with ``everyone`` every one that grades
    # someone. A requirement can be both a source and in ``unmapped`` (one
    # member type on a tier, another not), so the form names its sources from
    # here rather than from what ``unmapped`` leaves out.
    source_ids: List[str] = field(default_factory=list)


def _applies_to_no_one(req_id: str, name: str) -> UnmappedRequirement:
    return UnmappedRequirement(
        req_id,
        name,
        "It applies to no members, since no member categories, ranks or "
        "positions are set",
        applies_to_no_one=True,
    )


def mandatory_tiers_for_requirements(
    requirements: Sequence[Any], ladder: Sequence[str]
) -> MandatoryTiers:
    """Project who ``requirements`` grade onto an event's "Mandatory for".

    The pre-fill for an event that counts toward attendance requirements: the
    membership tiers (ids on ``ladder``, in ladder order) whose members those
    requirements apply to. It reads the same fields in the same precedence as
    :func:`requirement_applies_to_member`, which decides who a requirement
    actually grades; keep the two in step (pitfall #29).

    - ``applies_to_all`` means everyone, which covers every other requirement
      that grades someone; one that grades no one (below) is still reported.
    - Each ``required_membership_types`` word becomes the tiers it canonically
      stands on. ``probationary`` also takes a ``junior`` tier, because a
      junior member's legacy membership type derives to probationary.
    - A class word (administrative, honorary), a word with no tier on this
      ladder, or a requirement scoped only by rank or position is reported
      unmapped rather than guessed at.
    - A requirement naming nobody grades no member, so it suggests no tier
      and is reported unmapped, saying so, rather than read as a source of
      the tiers the others suggest. The Counts toward attendance checklist
      says the same of it.
    - So does one no longer active, whatever its scope: an edited session
      keeps its link to a requirement since deactivated, and nothing grades
      through that requirement any more.

    Grandfathering and compliance profiles are ignored: they decide which
    members a requirement grades, not which tiers an event is mandatory for.
    ``training_exempt`` tiers are not left out, because the requirement rule
    does not leave them out either.
    """
    tiers: List[str] = []
    unmapped: List[UnmappedRequirement] = []
    contributed: List[str] = []
    everyone = False
    by_standing: Dict[str, List[str]] = {}
    for tier_id in ladder:
        standing = canonical_member_status(tier_id)
        if standing:
            by_standing.setdefault(standing, []).append(tier_id)

    for req in requirements:
        req_id, name = str(req.id), str(req.name)
        if getattr(req, "active", True) is False:
            # Only the fact, as the no-scope reason gives only its "since":
            # the form adds what follows from it ("so it adds no one").
            unmapped.append(
                UnmappedRequirement(
                    req_id, name, "It is no longer active", applies_to_no_one=True
                )
            )
            continue
        if req.applies_to_all:
            everyone = True
            contributed.append(req_id)
            continue
        if req.required_membership_types:
            words = [
                key
                for key in (
                    (w or "").strip().lower() for w in req.required_membership_types
                )
                if key
            ]
            if not words:
                # Blank words match no member's type, and the grader does not
                # go on to ranks or positions once the list is non-empty.
                unmapped.append(_applies_to_no_one(req_id, name))
            for key in words:
                if key in _CLASS_MEMBERSHIP_WORDS:
                    unmapped.append(
                        UnmappedRequirement(
                            req_id,
                            name,
                            f"{key.capitalize()} members can't be chosen "
                            "by member type",
                        )
                    )
                    continue
                matched = list(by_standing.get(canonical_member_status(key) or "", []))
                if key == "probationary":
                    matched += by_standing.get(MemberStatus.JUNIOR, [])
                if not matched:
                    unmapped.append(
                        UnmappedRequirement(
                            req_id,
                            name,
                            f"No member type here stands for {key} members",
                        )
                    )
                tiers.extend(matched)
                if matched and req_id not in contributed:
                    contributed.append(req_id)
        elif req.required_roles or req.required_positions:
            unmapped.append(
                UnmappedRequirement(
                    req_id,
                    name,
                    "It applies by rank or position, which can't be chosen "
                    "as a member type",
                )
            )
        else:
            unmapped.append(_applies_to_no_one(req_id, name))

    if everyone:
        # All members covers every requirement that grades someone, whether or
        # not a tier stands for them; one that grades no one is still named,
        # or the form would list it as a source of All members. The loop runs
        # to the end for it, whatever the order.
        no_one = [u for u in unmapped if u.applies_to_no_one]
        graded_by_no_one = {u.requirement_id for u in no_one}
        return MandatoryTiers(
            everyone=True,
            tier_ids=[],
            unmapped=no_one,
            source_ids=[
                req_id
                for req_id in dict.fromkeys(str(req.id) for req in requirements)
                if req_id not in graded_by_no_one
            ],
        )
    picked = set(tiers)
    return MandatoryTiers(
        everyone=False,
        tier_ids=[tier_id for tier_id in ladder if tier_id in picked],
        unmapped=unmapped,
        source_ids=contributed,
    )


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

# The standing of a member who has left: their account status is not one of
# ACTIVE_ACCOUNT_STATUSES (CLAUDE.md pitfall 32). The compliance matrix lists
# only current members, so a grade on the profile card or the officer's member
# view would be a colour no matrix row agrees with (pitfall 29). Those screens
# report this instead of grading.
STANDING_NOT_CURRENT_MEMBER = "not_current_member"
STANDING_NOT_CURRENT_MEMBER_LABEL = "Not a Current Member"


def is_current_member(member: Any) -> bool:
    """Whether the matrix would list this member: a current account, not deleted."""
    return (
        getattr(member, "status", None) in ACTIVE_ACCOUNT_STATUSES
        and getattr(member, "deleted_at", None) is None
    )


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
    return (
        _standing_for_pct(
            pct,
            completed_count >= total_count,
            compliant_threshold,
            at_risk_threshold,
            threshold_type,
        ),
        pct,
    )


def _standing_for_pct(
    pct: float,
    all_met: bool,
    compliant_threshold: float,
    at_risk_threshold: float,
    threshold_type: str,
) -> str:
    """The threshold ladder, the one place it is written.

    ``pct`` is the rounded figure the screen shows, so a displayed 75.0 never
    reads below a 75 bar. Under ``all_required`` only ``all_met`` is
    compliant, however close ``pct`` rounds to 100. Shared by
    :func:`classify_standing` (a member) and
    :meth:`ComplianceGrading.classify_average` (a department average).
    """
    if threshold_type == "all_required":
        if all_met:
            return "compliant"
    elif pct >= compliant_threshold:
        return "compliant"
    if pct >= at_risk_threshold:
        return "at_risk"
    return "non_compliant"


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
    held_sessions: Optional[Mapping[str, Sequence[HeldSession]]] = None,
    evaluation_credits: Optional[EvaluationCredits] = None,
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
            held_sessions=held_sessions,
            evaluation_credits=evaluation_credits,
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
    compliance_config: Optional[ComplianceConfig] = result.scalars().first()
    return compliance_config


@dataclass(frozen=True)
class MemberGrading:
    """What grades one member: their requirements and pass bars."""

    requirements: List[TrainingRequirement]
    compliant_threshold: float
    at_risk_threshold: float
    # The matched profile's optional requirements that apply to the member:
    # listed on the member's training page, never graded (owner decision
    # 2026-11-21). Kept beside ``requirements`` rather than inside it so no
    # tally, notice, export or matrix that reads ``requirements`` can count
    # one by accident.
    optional_requirements: List[TrainingRequirement] = field(default_factory=list)


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
    # In resolution order (ordered_profiles); _find_matching_profile takes
    # the first match and re-applies the order for callers that do not.
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
            profiles=tuple(ordered_profiles(config.profiles or [])),
        )

    def for_member(
        self, member: User, requirements: List[TrainingRequirement]
    ) -> MemberGrading:
        """The requirements that grade ``member``, and their thresholds.

        A matching profile narrows the requirement list and may override the
        thresholds; then every requirement that does not apply to the member
        (``requirement_applies_to_user``) is dropped. The profile's optional
        requirements are resolved the same way into ``optional_requirements``
        and never graded; with no required list set, they are also left out
        of the graded set. ``member.positions``
        must be loaded when any profile exists.
        """
        member_reqs = list(requirements)
        optional_reqs: List[TrainingRequirement] = []
        compliant_threshold = self.compliant_threshold
        at_risk_threshold = self.at_risk_threshold
        profile = (
            _find_matching_profile(member, list(self.profiles))
            if self.profiles
            else None
        )
        if profile:
            by_id = {str(r.id): r for r in requirements}
            required_ids = profile.required_requirement_ids
            # Required wins when an id is in both lists; an id for a deleted
            # or inactive requirement is not in by_id and drops out.
            required_set = set(required_ids or [])
            optional_ids = [
                rid
                for rid in (profile.optional_requirement_ids or [])
                if rid in by_id and rid not in required_set
            ]
            optional_reqs = [by_id[rid] for rid in optional_ids]
            # `is not None`, not truthy: a profile that explicitly selects zero
            # required requirements (`[]`, "nothing is required for this
            # group") must not fall through to grading against every org-wide
            # requirement — `[]` and "never set" (`None`) differ. See CMP2-3.
            if required_ids is not None:
                member_reqs = [by_id[rid] for rid in required_ids if rid in by_id]
            elif optional_ids:
                # Never set grades every requirement except the ones the
                # profile calls optional, as the editor and guides promise.
                optional_set = set(optional_ids)
                member_reqs = [r for r in requirements if str(r.id) not in optional_set]
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
            optional_requirements=[
                req for req in optional_reqs if requirement_applies_to_user(req, member)
            ],
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

    def classify_average(
        self, figures: Iterable[Tuple[Optional[float], str]]
    ) -> Tuple[str, Optional[float]]:
        """A department average of member figures, and its standing.

        ``figures`` is each member's ``(pct, standing)`` at one horizon, as
        :meth:`classify` returned it; members nothing grades (``None``) are
        left out. The mean, rounded to one decimal, is classified by the
        department's thresholds and threshold type, not a profile's (owner
        direction 2026-11-21). Under ``all_required`` the average is
        compliant only when every graded member is: the exact form of "the
        average is 100%", which a rounded mean can fake.
        """
        graded = [(pct, standing) for pct, standing in figures if pct is not None]
        if not graded:
            return STANDING_NOT_APPLICABLE, None
        mean = round(sum(pct for pct, _ in graded) / len(graded), 1)
        all_met = all(standing == "compliant" for _, standing in graded)
        return (
            _standing_for_pct(
                mean,
                all_met,
                self.compliant_threshold,
                self.at_risk_threshold,
                self.threshold_type,
            ),
            mean,
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
            User.status.in_(ACTIVE_ACCOUNT_STATUSES),
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
    evaluations_by_user = await load_evaluation_credits(
        db,
        org_id,
        [m.id for m in members],
        requirements,
        today,
        grading.include_current_month,
    )
    held_sessions = await load_held_sessions(db, str(org_id), requirements)

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
            held_sessions=held_sessions,
            evaluation_credits=evaluations_by_user.get(str(member.id), {}),
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


@dataclass(frozen=True)
class MemberCompliance:
    """One member's standing and the per-requirement evaluations behind it."""

    member: User
    standing: str
    pct: Optional[float]
    evaluations: Tuple[Tuple[TrainingRequirement, RequirementEvaluation], ...]


async def grade_org_members(
    db: AsyncSession,
    org_id: str,
    today: date,
    config: Optional[ComplianceConfig] = None,
) -> List[MemberCompliance]:
    """Grade every active, non-exempt member, keeping each requirement's detail.

    The same population, configuration, record load and rules as
    :func:`compute_org_compliance_tally` -- ``ComplianceGrading.for_member``,
    :func:`evaluate_member_requirement_detail`, :func:`tally_standing` and the
    member's thresholds -- for a caller that needs to know *which*
    requirements are unmet and when they fall due, not only the count (the
    member compliance notices, CMP2-1). ``config`` is the org's
    ``ComplianceConfig`` with profiles loaded, when the caller already has it.
    """
    members_result = await db.execute(
        select(User)
        .options(selectinload(User.positions))
        .where(
            User.organization_id == org_id,
            User.status.in_(ACTIVE_ACCOUNT_STATUSES),
            User.compliance_exempt.is_(False),
            User.deleted_at.is_(None),
        )
    )
    members = members_result.scalars().all()
    if not members:
        return []
    reqs_result = await db.execute(
        select(TrainingRequirement).where(
            TrainingRequirement.organization_id == org_id,
            TrainingRequirement.active.is_(True),
        )
    )
    requirements = list(reqs_result.scalars().all())
    if not requirements:
        return []

    if config is None:
        config = await _load_compliance_config(db, org_id)
    return await grade_members(
        db,
        org_id,
        members,
        requirements,
        today,
        ComplianceGrading.from_config(config),
        waivers_by_user=await fetch_org_waivers(db, str(org_id)),
        held_sessions=await load_held_sessions(db, str(org_id), requirements),
    )


async def grade_members(
    db: AsyncSession,
    org_id: str,
    members: Sequence[User],
    requirements: Sequence[TrainingRequirement],
    today: date,
    grading: ComplianceGrading,
    *,
    waivers_by_user: Mapping[str, Sequence[WaiverPeriod]],
    held_sessions: Mapping[str, Sequence[HeldSession]],
) -> List[MemberCompliance]:
    """Grade ``members`` against ``requirements``, in the order given.

    The one grading loop behind the compliance matrix
    (``get_compliance_matrix``), :func:`grade_org_members`, and the compliance
    CSV, PDF and forecast (``ReportExportService``), so none of them can read a
    member differently from the others (CLAUDE.md pitfall 29). It loads the
    records, credited shifts and evaluation credits for exactly these members;
    the org-wide waivers and held sessions are passed in, so a caller grading
    in batches loads them once. ``members`` need ``positions`` loaded: a
    compliance profile can match on them.
    """
    if not members or not requirements:
        return []
    requirements = list(requirements)
    member_ids = [m.id for m in members]
    records_by_user: Dict[str, list] = {}
    for r in await load_graded_records(
        db, org_id, member_ids, requirements, today, grading.include_current_month
    ):
        records_by_user.setdefault(r.user_id, []).append(r)
    shifts_by_user = await load_credited_shift_dates(
        db, org_id, member_ids, requirements, today, grading.include_current_month
    )
    evaluations_by_user = await load_evaluation_credits(
        db, org_id, member_ids, requirements, today, grading.include_current_month
    )

    graded: List[MemberCompliance] = []
    for member in members:
        member_grading = grading.for_member(member, requirements)
        join_date = member_join_date(member)
        evaluations = tuple(
            (
                req,
                evaluate_member_requirement_detail(
                    req,
                    records_by_user.get(member.id, []),
                    today,
                    waivers=waivers_by_user.get(str(member.id), []),
                    org_include_current_month=grading.include_current_month,
                    join_date=join_date,
                    shift_dates=shifts_by_user.get(str(member.id), []),
                    held_sessions=held_sessions,
                    evaluation_credits=evaluations_by_user.get(str(member.id), {}),
                ),
            )
            for req in member_grading.requirements
        )
        met, total = tally_standing(ev.status for _, ev in evaluations)
        standing, pct = grading.classify(member_grading, met, total)
        graded.append(MemberCompliance(member, standing, pct, evaluations))
    return graded
