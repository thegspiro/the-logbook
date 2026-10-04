"""
Training Compliance Utilities

Shared functions for evaluating training requirement compliance.
Used by both the dashboard admin-summary and the training compliance-matrix endpoints.
"""

import calendar
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta
from typing import Dict, Iterable, List, Optional, Tuple

from sqlalchemy import func, select
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
        return None, None
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
    3. The requirement name appearing in the record's course name.
    4. The requirement's registry code appearing in the certification number.

    Matches 2–4 are heuristics kept for requirements created before the library
    link existed (and for imported records that carry no course id), which is
    why linking a course *widens* the match rather than replacing it: an
    existing "CPR" requirement must keep crediting the records it already
    credited when an officer links the CPR course to it.

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
) -> RequirementEvaluation:
    """Evaluate one member against one requirement, honouring a catch-up period.

    The grading itself lives in :func:`_grade_member_requirement`; this adds
    the one member-specific rule that grading cannot see: an existing member
    inside the requirement's catch-up period (see :func:`catch_up_deadline`)
    whose requirement is not yet met is reported as ``catch_up`` rather than
    unmet, carrying the deadline. ``join_date`` is the member's
    :func:`member_join_date`; omitting it skips the rule.
    """
    ev = _grade_member_requirement(
        req,
        member_records,
        today,
        waivers=waivers,
        org_include_current_month=org_include_current_month,
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
    - CERTIFICATION:  Check for matching certification records (by name or training_type)
    - SHIFTS/CALLS:   Count matching records within date window
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
    today = resolve_as_of_date(
        today,
        effective_include_current_month(
            getattr(req, "include_current_month", None),
            org_include_current_month,
        ),
    )
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

    # Filter completed records within the date window
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

    # ---- HOURS requirements: sum hours by training_type and/or category ----
    if req_type == RequirementType.HOURS.value:
        type_matched = windowed
        if req.training_type:
            type_matched = [r for r in windowed if r.training_type == req.training_type]
        if req.category_ids:
            cat_set = set(req.category_ids)
            type_matched = [
                r for r in type_matched if r.category_id and r.category_id in cat_set
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
        type_matched = windowed
        if req.training_type:
            type_matched = [r for r in windowed if r.training_type == req.training_type]
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
    )
    return ev.status, ev.completion_date, ev.expiry_date


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
    role_ids: Optional[List[str]] = None,
    join_date: Optional[date] = None,
    position_slugs: Optional[List[str]] = None,
) -> bool:
    """Whether a requirement applies to a member.

    Matches ``TrainingService.get_applicable_requirements`` (the
    member-facing ``/my-training`` path) precedence exactly:
    ``applies_to_all`` wins outright; otherwise ``required_membership_types``
    is checked; otherwise the member matches if they hold any position named
    in ``required_roles`` (by id) or in ``required_positions`` (by slug). A
    requirement naming none of these applies to nobody.

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
    if req.required_roles and role_ids:
        if any(rid in role_ids for rid in req.required_roles):
            return True
    if req.required_positions and position_slugs:
        if any(slug in position_slugs for slug in req.required_positions):
            return True
    return False


def member_role_ids(member) -> List[str]:
    """The ids ``required_roles`` is matched against: the member's positions.

    ``User.roles`` is a synonym for ``User.positions``, and both the requirement
    form and ``get_applicable_requirements`` store and compare position ids.
    The relationship is lazy, so a caller loading members in bulk must
    ``selectinload(User.positions)`` first — touching it unloaded on an
    AsyncSession raises MissingGreenlet.
    """
    positions = getattr(member, "positions", None) or []
    return [str(p.id) for p in positions if getattr(p, "id", None)]


def member_position_slugs(member) -> List[str]:
    """The slugs ``required_positions`` is matched against.

    Same relationship as :func:`member_role_ids`, so the same
    ``selectinload(User.positions)`` requirement applies.
    """
    positions = getattr(member, "positions", None) or []
    return [str(p.slug) for p in positions if getattr(p, "slug", None)]


def requirement_applies_to_user(req, member) -> bool:
    """:func:`requirement_applies_to_member` with every input read off ``member``.

    The form a bulk caller should use: it cannot forget the role ids or the
    join date, which is how the dashboard percentage and the compliance matrix
    came to ignore role-scoped requirements that ``/my-training`` and the
    profile card enforced.
    """
    return requirement_applies_to_member(
        req,
        getattr(member, "membership_type", None) or "active",
        member_role_ids(member),
        join_date=member_join_date(member),
        position_slugs=member_position_slugs(member),
    )


def classify_standing(
    completed_count: int,
    total_count: int,
    compliant_threshold: float = 100.0,
    at_risk_threshold: float = 75.0,
    threshold_type: str = "percentage",
) -> Tuple[str, float]:
    """Turn a met/total tally into a standing plus its percentage.

    Returns (status, compliance_pct) where status is one of:
    "compliant", "at_risk", "non_compliant".

    Split out of ``_evaluate_member_compliance`` so the compliance matrix can
    label a member without evaluating every requirement a second time. Both
    paths must agree — a member shown as "at risk" on the matrix and
    "non-compliant" on the dashboard is a support call — so the thresholds are
    applied here and nowhere else.
    """
    if total_count <= 0:
        return "compliant", 100.0

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
) -> Tuple[str, float]:
    """Evaluate a member's compliance status against a set of requirements.

    Returns (status, compliance_pct) where status is one of:
    "compliant", "at_risk", "non_compliant".
    """
    if not member_reqs:
        return "compliant", 100.0

    statuses = []
    for req in member_reqs:
        req_status, _, _ = evaluate_member_requirement(
            req,
            member_records,
            today,
            waivers=waivers,
            org_include_current_month=org_include_current_month,
            join_date=join_date,
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


async def compute_org_compliance_pct(
    db: AsyncSession, org_id: str, today: Optional[date] = None
) -> float:
    """Compute organization-wide training compliance percentage.

    When a compliance configuration exists with profiles, each member is
    matched to a profile (by membership type / role). The profile's
    ``required_requirement_ids`` determines which training requirements
    count, and the configured thresholds determine compliant vs not.

    Without a compliance config, falls back to the legacy behaviour:
    evaluate every active training requirement for every member.

    Returns the percentage of members who are fully compliant.
    If there are no active requirements, returns 100.0.
    If there are no active members, returns 0.0.
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
        return 0.0

    # Get active requirements
    reqs_result = await db.execute(
        select(TrainingRequirement).where(
            TrainingRequirement.organization_id == org_id,
            TrainingRequirement.active.is_(True),
        )
    )
    requirements = reqs_result.scalars().all()

    if not requirements:
        return 100.0  # No requirements = fully compliant

    # Build requirements lookup by ID
    reqs_by_id: Dict[str, TrainingRequirement] = {str(r.id): r for r in requirements}

    # Load compliance config (if configured)
    config = await _load_compliance_config(db, org_id)
    profiles: List[ComplianceProfile] = []
    if config and config.profiles:
        # Sort by priority descending (higher priority first)
        profiles = sorted(
            config.profiles,
            key=lambda p: p.priority,
            reverse=True,
        )

    # Default thresholds
    compliant_threshold = 100.0
    at_risk_threshold = 75.0
    threshold_type = "percentage"
    if config:
        compliant_threshold = config.compliant_threshold
        at_risk_threshold = config.at_risk_threshold
        threshold_type = config.threshold_type or "percentage"

    # Get all training records for these members
    records_result = await db.execute(
        select(TrainingRecord).where(
            TrainingRecord.organization_id == org_id,
            TrainingRecord.user_id.in_([m.id for m in members]),
        )
    )
    all_records = records_result.scalars().all()

    # Build lookup: user_id -> [records]
    records_by_user: Dict[str, list] = {}
    for r in all_records:
        records_by_user.setdefault(r.user_id, []).append(r)

    # Fetch waivers
    waivers_by_user = await fetch_org_waivers(db, str(org_id))

    # Org-wide evaluation-period default; per-requirement overrides are applied
    # inside the evaluator. Config is already loaded above.
    org_include_current = True if config is None else bool(config.include_current_month)
    # The department's date, as every other compliance view uses: the dashboard
    # percentage and the matrix it links to must grade against the same day.
    if today is None:
        today = await resolve_org_today(db, org_id)
    compliant_count = 0

    for member in members:
        member_records = records_by_user.get(member.id, [])
        member_waivers = waivers_by_user.get(str(member.id), [])

        # Determine which requirements apply to this member
        member_reqs = list(requirements)  # default: all requirements
        member_compliant_threshold = compliant_threshold
        member_at_risk_threshold = at_risk_threshold

        if profiles:
            profile = _find_matching_profile(member, profiles)
            if profile:
                # `is not None`, not truthy: a profile that explicitly selects
                # zero required requirements (`[]`, meaning "nothing is
                # required for this group") must not fall through to grading
                # against every org-wide requirement, which `if
                # profile.required_requirement_ids:` did — `[]` and "never
                # set" (`None`) were indistinguishable. See CMP2-3.
                if profile.required_requirement_ids is not None:
                    # Use only the requirements specified in the profile
                    member_reqs = [
                        reqs_by_id[rid]
                        for rid in profile.required_requirement_ids
                        if rid in reqs_by_id
                    ]
                # Threshold overrides apply whenever this profile matched,
                # independent of whether it also overrides the requirement
                # list — these were previously nested inside the same `if`
                # above and so silently skipped for a profile with an empty
                # required list (CMP2-3).
                if profile.compliant_threshold_override is not None:
                    member_compliant_threshold = profile.compliant_threshold_override
                if profile.at_risk_threshold_override is not None:
                    member_at_risk_threshold = profile.at_risk_threshold_override

        # A requirement that doesn't apply to this member is not in their
        # denominator. get_compliance_matrix (training.py) already applies
        # this same exclusion per-member; without it here, a member holding
        # a requirement that was never meant to apply to them was graded
        # against it anyway — evaluate_member_requirement almost always
        # reports "not_started" for such a requirement, so this dashboard
        # percentage could disagree with the matrix for the exact
        # member/requirement pair it's supposed to describe the same way.
        # See requirement_applies_to_member's own docstring for why this is
        # a shared helper rather than a fourth ad-hoc reimplementation.
        member_reqs = [
            req for req in member_reqs if requirement_applies_to_user(req, member)
        ]

        status, _ = _evaluate_member_compliance(
            member_reqs,
            member_records,
            today,
            member_waivers,
            member_compliant_threshold,
            member_at_risk_threshold,
            threshold_type,
            org_include_current_month=org_include_current,
            join_date=member_join_date(member),
        )
        if status == "compliant":
            compliant_count += 1

    return round(compliant_count / len(members) * 100, 1)
