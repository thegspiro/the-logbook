"""
Training Compliance Utilities

Shared functions for evaluating training requirement compliance.
Used by both the dashboard admin-summary and the training compliance-matrix endpoints.
"""

import calendar
from datetime import date, timedelta

from typing import Dict, List, Optional, Tuple

from sqlalchemy import select
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
from app.services.training_waiver_service import (
    adjust_required,
    fetch_org_waivers,
    get_rolling_period_months,
)


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


def evaluate_member_requirement(req, member_records, today: date, waivers=None):
    """
    Evaluate a single member's status for a single requirement.

    Returns (status, latest_completion_date, latest_expiry_date).

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
    start_date, end_date = get_requirement_date_window(req, today)
    _waivers = waivers or []

    # Filter completed records within the date window
    completed = [r for r in member_records if r.status == TrainingStatus.COMPLETED]
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
                r for r in type_matched
                if r.category_id and r.category_id in cat_set
            ]

        total_hours = sum(r.hours_completed or 0 for r in type_matched)
        required = req.required_hours or 0

        if required > 0 and start_date and end_date and _waivers:
            required, _, _ = adjust_required(
                required,
                start_date,
                end_date,
                _waivers,
                str(req.id),
                period_months=get_rolling_period_months(req),
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
                    return "expired", exp_comp, exp_exp

        if required > 0 and total_hours >= required:
            return "completed", latest_comp, latest_exp
        elif total_hours > 0:
            return "in_progress", latest_comp, latest_exp
        else:
            return "not_started", None, None

    # ---- COURSES requirements: check required course IDs ----
    if req_type == RequirementType.COURSES.value:
        course_ids = req.required_courses or []
        if not course_ids:
            return "not_started", None, None

        completed_course_ids = {str(r.course_id) for r in windowed if r.course_id}
        matched_count = sum(1 for cid in course_ids if cid in completed_course_ids)

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
                    return "expired", exp_comp, exp_exp

        if matched_count >= len(course_ids):
            return "completed", latest_comp, latest_exp
        elif matched_count > 0:
            return "in_progress", latest_comp, latest_exp
        else:
            return "not_started", None, None

    # ---- CERTIFICATION requirements: match by name, training_type, or cert number ----
    if req_type == RequirementType.CERTIFICATION.value:
        matching = [
            r
            for r in completed
            if (
                (req.training_type and r.training_type == req.training_type)
                or (
                    r.course_name
                    and req.name
                    and req.name.lower() in r.course_name.lower()
                )
                or (
                    r.certification_number
                    and req.registry_code
                    and req.registry_code.lower() in r.certification_number.lower()
                )
            )
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
                return "expired", latest_comp, latest_exp
            return "completed", latest_comp, latest_exp
        return "not_started", None, None

    # ---- SHIFTS requirements ----
    if req_type == RequirementType.SHIFTS.value:
        type_matched = windowed
        if req.training_type:
            type_matched = [r for r in windowed if r.training_type == req.training_type]
        count = len(type_matched)
        required = req.required_shifts or 0

        if required > 0 and start_date and end_date and _waivers:
            required, _, _ = adjust_required(
                required,
                start_date,
                end_date,
                _waivers,
                str(req.id),
                period_months=get_rolling_period_months(req),
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
        latest_exp = None

        if required > 0 and count >= required:
            return "completed", latest_comp, latest_exp
        elif count > 0:
            return "in_progress", latest_comp, latest_exp
        return "not_started", None, None

    # ---- CALLS requirements ----
    if req_type == RequirementType.CALLS.value:
        type_matched = windowed
        if req.training_type:
            type_matched = [r for r in windowed if r.training_type == req.training_type]
        count = len(type_matched)
        required = req.required_calls or 0

        if required > 0 and start_date and end_date and _waivers:
            required, _, _ = adjust_required(
                required,
                start_date,
                end_date,
                _waivers,
                str(req.id),
                period_months=get_rolling_period_months(req),
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
        latest_exp = None

        if required > 0 and count >= required:
            return "completed", latest_comp, latest_exp
        elif count > 0:
            return "in_progress", latest_comp, latest_exp
        return "not_started", None, None

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
            return "expired", latest_comp, latest_exp
        return "completed", latest_comp, latest_exp
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
            return "in_progress", None, None
    return "not_started", None, None


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
    member_role_ids: List[str] = []
    if hasattr(member, "positions") and member.positions:
        for pos in member.positions:
            role_id = getattr(pos, "role_id", None)
            if role_id:
                member_role_ids.append(str(role_id))

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


def _evaluate_member_compliance(
    member_reqs: list,
    member_records: list,
    today: date,
    waivers: list,
    compliant_threshold: float,
    at_risk_threshold: float,
    threshold_type: str,
) -> Tuple[str, float]:
    """Evaluate a member's compliance status against a set of requirements.

    Returns (status, compliance_pct) where status is one of:
    "compliant", "at_risk", "non_compliant".
    """
    if not member_reqs:
        return "compliant", 100.0

    completed_count = 0
    for req in member_reqs:
        req_status, _, _ = evaluate_member_requirement(
            req, member_records, today, waivers=waivers
        )
        if req_status == TrainingStatus.COMPLETED.value:
            completed_count += 1

    pct = round(completed_count / len(member_reqs) * 100, 1)

    if threshold_type == "all_required":
        if completed_count >= len(member_reqs):
            return "compliant", pct
        elif pct >= at_risk_threshold:
            return "at_risk", pct
        else:
            return "non_compliant", pct
    else:
        # percentage mode
        if pct >= compliant_threshold:
            return "compliant", pct
        elif pct >= at_risk_threshold:
            return "at_risk", pct
        else:
            return "non_compliant", pct


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


async def compute_org_compliance_pct(db: AsyncSession, org_id: str) -> float:
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
    members_result = await db.execute(
        select(User).where(
            User.organization_id == org_id,
            User.status == UserStatus.ACTIVE,
            User.compliance_exempt == False,  # noqa: E712
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
            TrainingRequirement.active == True,  # noqa: E712
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

    today = date.today()
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
            if profile and profile.required_requirement_ids:
                # Use only the requirements specified in the profile
                member_reqs = [
                    reqs_by_id[rid]
                    for rid in profile.required_requirement_ids
                    if rid in reqs_by_id
                ]
                # Use profile threshold overrides if set
                if profile.compliant_threshold_override is not None:
                    member_compliant_threshold = profile.compliant_threshold_override
                if profile.at_risk_threshold_override is not None:
                    member_at_risk_threshold = profile.at_risk_threshold_override

        status, _ = _evaluate_member_compliance(
            member_reqs,
            member_records,
            today,
            member_waivers,
            member_compliant_threshold,
            member_at_risk_threshold,
            threshold_type,
        )
        if status == "compliant":
            compliant_count += 1

    return round(compliant_count / len(members) * 100, 1)
