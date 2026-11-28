"""
Training Service

Business logic for training management including courses, records, requirements, and reporting.
"""

import calendar
import copy
from datetime import date, timedelta
from typing import TYPE_CHECKING, Any, Dict, List, Mapping, Optional, Sequence, Tuple
from uuid import UUID

from sqlalchemy import func
from sqlalchemy import inspect as sa_inspect
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.training import (
    RequirementFrequency,
    TrainingRecord,
    TrainingRequirement,
    TrainingStatus,
)
from app.models.user import User
from app.schemas.training import (
    RequirementProgress,
    TrainingHoursSummary,
    TrainingReport,
    UserTrainingStats,
)
from app.services.training_waiver_service import (
    WaiverPeriod,
    adjust_required,
    excused_month_reasons,
    fetch_user_waivers,
    get_rolling_period_months,
    month_waivers,
    total_months_in_period,
)
from app.utils.hours import meets_required_hours
from app.utils.org_timezone import resolve_org_today

if TYPE_CHECKING:
    from app.services.training_compliance import EvaluationCredits, HeldSession

#: How far ahead a certification counts as "expiring soon": the member's
#: training stats count these, and the evaluation data source
#: ``certifications.expiring_soon`` lists the same window, so the two agree.
CERTIFICATION_EXPIRING_SOON_DAYS = 90

# What a requirement check reads from a completed record; the preload that
# serves a page of checks loads these and nothing else.
_PROGRESS_RECORD_COLUMNS = (
    TrainingRecord.id,
    TrainingRecord.organization_id,
    TrainingRecord.user_id,
    TrainingRecord.status,
    TrainingRecord.course_id,
    TrainingRecord.course_name,
    TrainingRecord.training_type,
    TrainingRecord.completion_date,
    TrainingRecord.expiration_date,
    TrainingRecord.hours_completed,
    TrainingRecord.certification_number,
    TrainingRecord.source_event_id,
    # Read by hours_record_counts (category scoping) and by certification
    # and fallback matching; without them the preload's rows never matched a
    # certificate by name or code.
    TrainingRecord.category_id,
    TrainingRecord.match_key,
    TrainingRecord.certification_key,
    TrainingRecord.created_at,
)


def _same_requirement_value(stored: Any, sent: Any) -> bool:
    """Whether a requirement edit leaves a field as it is.

    The edit form sends list fields (categories, member categories, courses,
    call types) on every save, as ``[]`` when nothing is selected, while rows
    written by older clients or by create hold ``NULL`` for the same state.
    Every grader treats the two alike, so a new-members-only save must too —
    otherwise a save that changes nothing creates a copy instead of being
    refused.
    """
    if stored in (None, []) and sent in (None, []):
        return True
    return bool(stored == sent)


class TrainingService:
    """Service for training management"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_user_training_stats(
        self, user_id: UUID, organization_id: UUID | str
    ) -> UserTrainingStats:
        """
        Get comprehensive training statistics for a user
        """
        # The department's calendar for both "this year" and the expiry
        # counts below; the UTC year turns over hours early on New Year's Eve.
        today = await resolve_org_today(self.db, organization_id)
        current_year = today.year

        # Get all completed training records
        result = await self.db.execute(
            select(TrainingRecord)
            .where(TrainingRecord.user_id == str(user_id))
            .where(TrainingRecord.organization_id == str(organization_id))
            .where(TrainingRecord.status == TrainingStatus.COMPLETED)
        )
        records = result.scalars().all()

        # Calculate total hours (guard against None values)
        total_hours = sum(r.hours_completed or 0 for r in records)

        # Calculate this year's hours
        hours_this_year = sum(
            r.hours_completed or 0
            for r in records
            if r.completion_date and r.completion_date.year == current_year
        )

        # Count certifications
        certifications = [r for r in records if r.certification_number]
        total_certifications = len(certifications)

        # Count active, expiring soon, and expired
        ninety_days = today + timedelta(days=CERTIFICATION_EXPIRING_SOON_DAYS)

        # A certificate is in force through its expiration day, as the
        # compliance grader and the evaluation data read it; this card used to
        # call it expired on that day while the matrix called it complete.
        active_certifications = sum(
            1
            for r in certifications
            if r.expiration_date and r.expiration_date >= today
        )

        expiring_soon = sum(
            1
            for r in certifications
            if r.expiration_date and today <= r.expiration_date <= ninety_days
        )

        expired = sum(
            1 for r in certifications if r.expiration_date and r.expiration_date < today
        )

        return UserTrainingStats(
            user_id=user_id,
            total_hours=total_hours,
            hours_this_year=hours_this_year,
            total_certifications=total_certifications,
            active_certifications=active_certifications,
            expiring_soon=expiring_soon,
            expired=expired,
            completed_courses=len(records),
        )

    async def get_training_hours_by_type(
        self,
        organization_id: UUID | str,
        user_id: Optional[UUID] = None,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> List[TrainingHoursSummary]:
        """
        Get training hours broken down by type
        """
        query = (
            select(
                TrainingRecord.training_type,
                func.sum(TrainingRecord.hours_completed).label("total_hours"),
                func.count(TrainingRecord.id).label("record_count"),
            )
            .where(TrainingRecord.organization_id == str(organization_id))
            .where(TrainingRecord.status == TrainingStatus.COMPLETED)
            .group_by(TrainingRecord.training_type)
        )

        if user_id:
            query = query.where(TrainingRecord.user_id == str(user_id))

        if start_date:
            query = query.where(TrainingRecord.completion_date >= start_date)

        if end_date:
            query = query.where(TrainingRecord.completion_date <= end_date)

        result = await self.db.execute(query)
        rows = result.all()

        return [
            TrainingHoursSummary(
                training_type=row.training_type,
                total_hours=float(row.total_hours or 0),
                record_count=row.record_count,
            )
            for row in rows
        ]

    async def generate_training_report(
        self,
        organization_id: UUID | str,
        start_date: date,
        end_date: date,
        user_id: Optional[UUID] = None,
    ) -> TrainingReport:
        """
        Generate a comprehensive training report
        """
        # Build query
        query = (
            select(TrainingRecord)
            .where(TrainingRecord.organization_id == str(organization_id))
            .where(TrainingRecord.status == TrainingStatus.COMPLETED)
            .where(TrainingRecord.completion_date >= start_date)
            .where(TrainingRecord.completion_date <= end_date)
        )

        if user_id:
            query = query.where(TrainingRecord.user_id == str(user_id))

        result = await self.db.execute(query)
        records = result.scalars().all()

        # Calculate total hours (guard against None values)
        total_hours = sum(r.hours_completed or 0 for r in records)

        # Get hours by type
        hours_by_type = await self.get_training_hours_by_type(
            organization_id=organization_id,
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
        )

        # Check requirement compliance
        requirements_met = []
        requirements_pending = []

        if user_id:
            # Check tier-based training exemptions
            tier_exempt = False
            tier_exempt_types: list = []
            try:
                from app.models.user import Organization as _Org
                from app.models.user import User as _User
                from app.services.membership_tier_service import (
                    MembershipTierService,
                )

                user_result = await self.db.execute(
                    select(_User).where(
                        _User.id == str(user_id),
                        _User.organization_id == str(organization_id),
                    )
                )
                _member = user_result.scalar_one_or_none()
                if _member:
                    org_result = await self.db.execute(
                        select(_Org).where(_Org.id == str(organization_id))
                    )
                    _org = org_result.scalar_one_or_none()
                    if _org:
                        _tier_cfg = (_org.settings or {}).get("membership_tiers", {})
                        _tiers = _tier_cfg.get("tiers", [])
                        _tier_def = MembershipTierService.tier_for_member(
                            _tiers, _member
                        )
                        if _tier_def:
                            _benefits = _tier_def.get("benefits", {})
                            tier_exempt = _benefits.get("training_exempt", False)
                            tier_exempt_types = _benefits.get(
                                "training_exempt_types", []
                            )
            except Exception:
                pass  # Fail open — don't block training checks if tier lookup fails

            # Only the requirements that grade this member: a member a
            # requirement exempts — by membership type, role, or because they
            # joined before its cutoff — must not see it listed as pending.
            requirements = await self.get_applicable_requirements(
                user_id, organization_id
            )
            join_date = await self._catch_up_join_date(
                user_id, organization_id, requirements
            )

            # Pre-fetch waivers once for all requirement checks
            user_waivers = await fetch_user_waivers(
                self.db,
                str(organization_id),
                str(user_id),
            )
            today = await resolve_org_today(self.db, organization_id)
            from app.services.training_compliance import (
                get_org_include_current_month,
                load_credited_shift_dates,
                load_held_sessions,
            )

            org_include_current_month = await get_org_include_current_month(
                self.db, str(organization_id)
            )
            shift_dates = (
                await load_credited_shift_dates(
                    self.db,
                    str(organization_id),
                    [str(user_id)],
                    requirements,
                    today,
                    org_include_current_month,
                    full_history=True,
                )
            ).get(str(user_id), [])
            held_sessions = await load_held_sessions(
                self.db, str(organization_id), requirements
            )

            for req in requirements:
                # Tier-based exemption: treat requirement as met
                if tier_exempt:
                    requirements_met.append(req.id)
                    continue
                if tier_exempt_types and getattr(req, "training_type", None):
                    req_type = str(
                        getattr(req.training_type, "value", req.training_type)
                    )
                    if req_type in tier_exempt_types:
                        requirements_met.append(req.id)
                        continue

                progress = await self.check_requirement_progress(
                    user_id,
                    req.id,
                    organization_id,
                    waivers=user_waivers,
                    today=today,
                    join_date=join_date,
                    shift_dates=shift_dates,
                    held_sessions=held_sessions,
                    org_include_current_month=org_include_current_month,
                )
                if progress.is_complete:
                    requirements_met.append(req.id)
                else:
                    requirements_pending.append(req.id)

        return TrainingReport(
            user_id=user_id,
            start_date=start_date,
            end_date=end_date,
            total_hours=total_hours,
            hours_by_type=hours_by_type,
            records=records,
            requirements_met=requirements_met,
            requirements_pending=requirements_pending,
        )

    @staticmethod
    def _due_date_type_str(requirement) -> Optional[str]:
        """Normalize ``due_date_type`` (enum member or bare string) to its
        string value, or ``None`` when unset."""
        due_date_type = getattr(requirement, "due_date_type", None)
        if not due_date_type:
            return None
        return (
            due_date_type.value
            if hasattr(due_date_type, "value")
            else str(due_date_type)
        )

    @staticmethod
    def _get_date_window(requirement, today: date):
        """Return (start_date, end_date) for a requirement's evaluation period.

        Handles rolling periods (``due_date_type='rolling'``), plus the
        standard frequency-based windows (annual, quarterly, monthly, etc.).
        """
        # Rolling period takes precedence over frequency-based window
        due_date_type = TrainingService._due_date_type_str(requirement)
        rolling_months = getattr(requirement, "rolling_period_months", None)

        if due_date_type == "rolling" and rolling_months:
            from app.services.training_compliance import rolling_window

            return rolling_window(today, rolling_months)

        freq = (
            requirement.frequency.value
            if hasattr(requirement.frequency, "value")
            else str(requirement.frequency)
        )
        current_year = today.year

        if freq == RequirementFrequency.ONE_TIME.value:
            return None, None
        elif freq == RequirementFrequency.BIANNUAL.value:
            from app.services.training_compliance import biannual_window

            return biannual_window(requirement, today)
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
            from app.services.training_compliance import _get_custom_annual_window

            custom = _get_custom_annual_window(requirement, today)
            if custom:
                return custom
            yr = requirement.year if requirement.year else current_year
            return date(yr, 1, 1), date(yr, 12, 31)

    @staticmethod
    def _anchor_matches(requirement, record, req_type: str) -> bool:
        """Does ``record`` count toward ``requirement``, for the purpose of
        anchoring a due-date (rolling last-completion, or
        certification-period expiration)?

        Mirrors each requirement type's own crediting criteria -- the exact
        filters ``check_requirement_progress``/``evaluate_requirement_detail``
        already apply for that type -- rather than a single blanket
        ``training_type`` check or a one-size-fits-all matcher. Both are
        wrong in opposite directions: a bare ``training_type`` check
        over-matches (any record of any type) when it's unset, even for a
        course-specific requirement; ``certification_record_matches``
        (correct for CERTIFICATION, whose match is "any of several specific
        criteria") under-matches HOURS/SHIFTS/CALLS to zero when a
        requirement legitimately has no restriction at all -- e.g. "24
        hours of *any* training every 24 months" is a valid, common
        configuration whose semantics are "unset criterion = no
        restriction", not "match nothing."
        """
        from app.models.training import RequirementType
        from app.services.training_compliance import (
            certification_record_matches,
            hours_record_counts,
            record_name_matches,
        )

        if req_type == RequirementType.CERTIFICATION.value:
            return certification_record_matches(requirement, record)

        if req_type == RequirementType.COURSES.value:
            course_ids = {str(c) for c in (requirement.required_courses or [])}
            return bool(record.course_id) and str(record.course_id) in course_ids

        if req_type == RequirementType.HOURS.value:
            return hours_record_counts(requirement, record)

        if req_type in (RequirementType.SHIFTS.value, RequirementType.CALLS.value):
            return (
                not requirement.training_type
                or record.training_type == requirement.training_type
            )

        # Fallback (skills_evaluation, checklist, etc.): training_type
        # match, or the legacy name match (record_name_matches) -- the same
        # two criteria the fallback branch itself uses.
        if requirement.training_type:
            return bool(record.training_type == requirement.training_type)
        return record_name_matches(requirement, record)

    @staticmethod
    def evaluate_requirement_detail(
        req,
        member_records,
        today: date,
        waivers=None,
        org_include_current_month: bool = True,
        join_date: Optional[date] = None,
        shift_dates: Optional[Sequence[date]] = None,
        held_sessions: Optional[Mapping[str, Sequence["HeldSession"]]] = None,
        course_catalog: Optional[Mapping[str, Tuple[str, Optional[str]]]] = None,
        evaluation_credits: Optional["EvaluationCredits"] = None,
    ) -> Dict:
        """Evaluate a member's progress on a single requirement (in-memory).

        Works with pre-fetched ``member_records`` to avoid N+1 queries.
        Returns a dict with all fields needed by the ``/my-training``
        endpoint's detailed requirements breakdown.

        ``today`` is the real current date; the effective evaluation date is
        resolved per requirement from its ``include_current_month`` override
        (falling back to ``org_include_current_month``).

        This handles every ``requirement_type``: hours, courses,
        certification, shifts, calls, and fallback.

        With *join_date*, an unmet requirement inside an existing member's
        catch-up period reports ``catch_up_deadline`` and takes it as its due
        date; callers leave such a requirement out of the met/total summary.

        *shift_dates* is the member's worked shifts
        (``training_compliance.load_credited_shift_dates``), required for a
        requirement counted from attendance (``counts_shift_attendance``).
        A rolling one anchors its due date on the latest of them, so pass
        them loaded with ``full_history=True`` when it matters.

        *held_sessions* is ``training_compliance.load_held_sessions`` for the
        requirements being evaluated, required for a SESSION_ATTENDANCE one.

        *evaluation_credits* is the member's entry in
        ``training_compliance.load_evaluation_credits``, required for an
        evaluated-shifts, transports or refusals requirement.

        *course_catalog* maps a course id to its ``(name, code)``, for the
        courses COURSES requirements name (``load_required_course_catalog``).
        With it, a COURSES requirement also reports ``course_checklist``: each
        required course and when the member last completed it in the window,
        so a screen can say which courses the count is made of. Without it the
        key is null, as it is for every other requirement type.
        """
        from app.models.training import RequirementType
        from app.services.training_compliance import (
            _grade_member_requirement,
            _require_held_sessions,
            _require_shift_dates,
            apply_recency,
            catch_up_deadline,
            certification_record_matches,
            counts_shift_attendance,
            credited_shifts_in_window,
            evaluation_credits_in_window,
            evaluation_target,
            fallback_record_matches,
            hours_record_counts,
            is_evaluation_credited,
            lapsed_biannual_certificate,
            latest_evaluation_credit,
            monthly_counts,
            monthly_hours,
            monthly_pace,
            next_window_opens,
            recency_cutoff,
            rolling_hours_has_no_deadline,
            tally_session_attendance,
        )
        from app.services.training_requirement_courses import (
            course_checklist_entries,
        )

        # The real day, captured before it is replaced by the evaluation
        # cut-off below: the catch-up deadline is a calendar date promised to
        # the member, not a period boundary.
        real_today = today
        from app.services.training_period import (
            effective_include_current_month,
            resolve_as_of_date,
        )

        req_type = (
            req.requirement_type.value
            if hasattr(req.requirement_type, "value")
            else str(req.requirement_type)
        )
        freq = (
            req.frequency.value
            if hasattr(req.frequency, "value")
            else str(req.frequency)
        )
        today = resolve_as_of_date(
            today,
            effective_include_current_month(
                getattr(req, "include_current_month", None),
                org_include_current_month,
            ),
        )
        start_date, end_date = TrainingService._get_date_window(req, today)
        _waivers = waivers or []

        # Filter completed records in the date window
        completed = [r for r in member_records if r.status == TrainingStatus.COMPLETED]
        # Freshness window narrows the pool first, so a stale completion can't
        # satisfy a requirement whose frequency window is unbounded (one_time).
        completed = apply_recency(req, completed, today)
        if start_date and end_date:
            windowed = [
                r
                for r in completed
                if r.completion_date and start_date <= r.completion_date <= end_date
            ]
        else:
            windowed = completed

        completed_value: float = 0
        base_required: float = 0
        adjusted_required: float = 0
        waived_months = 0
        active_months: float = 0
        cert_expired = False
        blocks_activity = False
        # CERTIFICATION only: the expiration date of the certificate graded,
        # so the card can say "On file (Expires ...)" or "Expired ..."
        # instead of 1/1 or 0/1. None when nothing matched or it never expires.
        certificate_expiry: Optional[date] = None
        month_breakdown: Optional[List[Dict]] = None
        count_breakdown: Optional[List[Dict]] = None
        # Dates of the shifts or calls counted, for their monthly breakdown.
        counted_dates: Optional[List[date]] = None
        course_checklist: Optional[List[Dict]] = None
        attendance_met: Optional[bool] = None
        attendance_overridden = False
        # No linked session held in the window yet: not graded at all
        # (training_compliance.NOT_YET_HELD_STATUS, workflow review W80-9).
        nothing_held = False

        # ---- HOURS ----
        if req_type == RequirementType.HOURS.value:
            type_matched = [r for r in windowed if hours_record_counts(req, r)]

            completed_value = sum(r.hours_completed or 0 for r in type_matched)
            if start_date and end_date:
                # The records counted above, month by month, so the rows add up
                # to the figure shown and a member can check it.
                month_breakdown = monthly_hours(
                    type_matched,
                    start_date,
                    min(end_date, today),
                    month_waivers(_waivers, start_date, end_date, str(req.id)),
                )
            base_required = req.required_hours or 0
            adjusted_required = base_required

            if base_required > 0 and start_date and end_date and _waivers:
                adjusted_required, waived_months, active_months = adjust_required(
                    base_required,
                    start_date,
                    end_date,
                    _waivers,
                    str(req.id),
                    period_months=get_rolling_period_months(req),
                )

            # Biannual: a lapsed certificate overrides the hours.
            if lapsed_biannual_certificate(req, type_matched, today) is not None:
                cert_expired = True
                blocks_activity = True

        # ---- COURSES ----
        elif req_type == RequirementType.COURSES.value:
            course_ids = req.required_courses or []
            completed_course_ids = {str(r.course_id) for r in windowed if r.course_id}
            matched = sum(1 for cid in course_ids if cid in completed_course_ids)
            completed_value = float(matched)
            base_required = float(len(course_ids))
            adjusted_required = base_required
            if course_catalog is not None:
                course_checklist = course_checklist_entries(
                    course_ids, windowed, course_catalog
                )
            # Biannual: a lapsed certificate overrides the count.
            if lapsed_biannual_certificate(req, windowed, today) is not None:
                cert_expired = True
                blocks_activity = True

        # ---- CERTIFICATION ----
        elif req_type == RequirementType.CERTIFICATION.value:
            matching = [r for r in completed if certification_record_matches(req, r)]
            base_required = 1
            adjusted_required = 1
            if matching:
                latest = max(matching, key=lambda r: r.completion_date or date.min)
                certificate_expiry = latest.expiration_date
                if latest.expiration_date and latest.expiration_date < today:
                    cert_expired = True
                    blocks_activity = True
                    completed_value = 0
                else:
                    completed_value = 1
            else:
                completed_value = 0
                cert_expired = True  # no cert at all
                blocks_activity = True

        # ---- SHIFTS ----
        elif req_type == RequirementType.SHIFTS.value:
            if counts_shift_attendance(req):
                counted_dates = credited_shifts_in_window(
                    req, _require_shift_dates(req, shift_dates), today
                )
                completed_value = float(len(counted_dates))
            else:
                type_matched = windowed
                if req.training_type:
                    type_matched = [
                        r for r in windowed if r.training_type == req.training_type
                    ]
                completed_value = float(len(type_matched))
                counted_dates = [r.completion_date for r in type_matched]
            base_required = float(req.required_shifts or 0)
            adjusted_required = base_required

            if base_required > 0 and start_date and end_date and _waivers:
                adjusted_required, waived_months, active_months = adjust_required(
                    base_required,
                    start_date,
                    end_date,
                    _waivers,
                    str(req.id),
                    period_months=get_rolling_period_months(req),
                    whole_units=True,
                )

        # ---- CALLS ----
        elif req_type == RequirementType.CALLS.value:
            type_matched = windowed
            if req.training_type:
                type_matched = [
                    r for r in windowed if r.training_type == req.training_type
                ]
            completed_value = float(len(type_matched))
            counted_dates = [r.completion_date for r in type_matched]
            base_required = float(req.required_calls or 0)
            adjusted_required = base_required

            if base_required > 0 and start_date and end_date and _waivers:
                adjusted_required, waived_months, active_months = adjust_required(
                    base_required,
                    start_date,
                    end_date,
                    _waivers,
                    str(req.id),
                    period_months=get_rolling_period_months(req),
                    whole_units=True,
                )

        # ---- Evaluated shifts, transports, refusals: training_compliance's
        # count of visible shift evaluations, never records ----
        elif is_evaluation_credited(req):
            evaluated = evaluation_credits_in_window(req, evaluation_credits, today)
            completed_value = float(sum(units for _, units in evaluated))
            # One date per unit, so the monthly breakdown counts transports
            # and refusals, not evaluations.
            counted_dates = [d for d, units in evaluated for _ in range(int(units))]
            base_required = evaluation_target(req)
            adjusted_required = base_required

            if base_required > 0 and start_date and end_date and _waivers:
                adjusted_required, waived_months, active_months = adjust_required(
                    base_required,
                    start_date,
                    end_date,
                    _waivers,
                    str(req.id),
                    period_months=get_rolling_period_months(req),
                    whole_units=True,
                )

        # ---- SESSION_ATTENDANCE: training_compliance's rule, not a copy ----
        elif req_type == RequirementType.SESSION_ATTENDANCE.value:
            tally = tally_session_attendance(
                req,
                member_records,
                _require_held_sessions(req, held_sessions),
                today,
                waivers=_waivers,
                join_date=join_date,
            )
            completed_value = float(tally.attended)
            adjusted_required = float(tally.needed)
            base_required = float(tally.base_needed)
            attendance_met = tally.met
            attendance_overridden = tally.overridden
            nothing_held = tally.held == 0

        # ---- Fallback ----
        else:
            matching = fallback_record_matches(req, windowed)
            base_required = 1
            adjusted_required = 1
            if matching:
                latest = max(matching, key=lambda r: r.completion_date or date.min)
                if latest.expiration_date and latest.expiration_date < today:
                    completed_value = 0
                else:
                    completed_value = 1
            else:
                completed_value = 0

        if counted_dates is not None and start_date and end_date:
            # Shifts and calls month by month, as the hours breakdown above,
            # so a member on leave sees which months were excused.
            count_breakdown = monthly_counts(
                counted_dates,
                start_date,
                min(end_date, today),
                month_waivers(_waivers, start_date, end_date, str(req.id)),
            )

        # Calculate percentage
        if adjusted_required > 0:
            pct = (
                100.0
                if meets_required_hours(completed_value, adjusted_required)
                else min(completed_value / adjusted_required * 100, 100)
            )
        elif base_required > 0:
            # A shift or call target leave rounded down to nothing: the member
            # owes nothing for the window.
            pct = 100.0
        else:
            # No positive target (an unset/misconfigured hours target, or a
            # courses requirement with no courses linked): met only if something
            # matching was actually completed. Defaulting to 100% here showed
            # members compliant for annual renewals they had never taken.
            pct = 100.0 if completed_value > 0 else 0.0

        if cert_expired:
            pct = 0.0
        if attendance_met is not None:
            # Nothing charged yet is met, as the compliance grader reads it;
            # the no-target rule above would read it as unmet.
            pct = 100.0 if attendance_met else pct

        if nothing_held:
            pct = 0.0
        # Met and expired are the shared grader's decision, not this
        # function's: the matrix, the profile card and the dashboard read
        # it, and a second set of rules here disagreed with them on biannual
        # expiries, no-target hours and never-held certificates (CLAUDE.md
        # pitfall #29, review finding 2026-11-21). The figures above stay
        # for display. Graded without the catch-up wrapper, which would hide
        # a lapse behind its own status; the catch-up rule is applied below.
        graded = _grade_member_requirement(
            req,
            member_records,
            real_today,
            waivers=_waivers,
            org_include_current_month=org_include_current_month,
            shift_dates=shift_dates,
            held_sessions=held_sessions,
            join_date=join_date,
            evaluation_credits=evaluation_credits,
        )
        is_met = graded.status == TrainingStatus.COMPLETED.value
        cert_expired = graded.status == "expired"
        blocks_activity = cert_expired
        if is_met:
            pct = 100.0
        elif cert_expired or pct >= 100:
            # A lapse, or a count the grader does not accept (a target of
            # zero): a full bar beside "not met" would contradict itself.
            pct = 0.0

        # Effective due date
        rolling_months = get_rolling_period_months(req)
        req_due_date_type = TrainingService._due_date_type_str(req)
        # A stale req.due_date can survive a switch away from "fixed_date"
        # to *any* other type: RequirementModal.tsx seeds due_date from the
        # existing row and only clears/edits it on the fixed_date screen,
        # so changing the type keeps sending the old value regardless of
        # which type it's switched to. An explicit due_date therefore only
        # means anything for "fixed_date" (or a legacy row with no
        # due_date_type at all, from before the field existed) -- never
        # calendar_period, rolling, or certification_period, all three of
        # which compute their own deadline below.
        honors_explicit_due_date = req_due_date_type in (None, "fixed_date")
        anchored_type = rolling_months or req_due_date_type == "certification_period"
        if req.due_date and honors_explicit_due_date:
            effective_due_date = req.due_date
        else:
            if anchored_type:
                # Rolling/certification-period due dates are anchored to a
                # completion, not the window end: end_date is always `today`
                # for a rolling requirement (a trailing evaluation window,
                # not a deadline), and a certification-period requirement
                # never resets on a schedule at all -- it comes due when the
                # certificate itself expires. Matching mirrors this
                # requirement type's own crediting criteria (see
                # _anchor_matches) rather than a bare training_type check,
                # so a course-specific requirement with no training_type set
                # isn't anchored on an unrelated record of any type. Uses
                # the full (recency-filtered, not window-filtered) completed
                # set so a completion older than the window -- i.e. one that
                # makes the requirement overdue -- is still found.
                anchors = [
                    r
                    for r in completed
                    if TrainingService._anchor_matches(req, r, req_type)
                ]
                if rolling_months:
                    from dateutil.relativedelta import relativedelta

                    latest_completion = max(
                        (r.completion_date for r in anchors if r.completion_date),
                        default=None,
                    )
                    if counts_shift_attendance(req):
                        # Anchored on the latest shift worked, as fresh as
                        # the freshness cutoff allows: the evidence the
                        # count reads, not a training record.
                        cutoff = recency_cutoff(req, today)
                        latest_completion = max(
                            (
                                d
                                for d in _require_shift_dates(req, shift_dates)
                                if cutoff is None or d >= cutoff
                            ),
                            default=None,
                        )
                    elif is_evaluation_credited(req):
                        # Anchored on the latest evaluation counted, for the
                        # same reason: a record never counts toward it.
                        latest_completion = latest_evaluation_credit(
                            req, evaluation_credits, today
                        )
                    effective_due_date = (
                        latest_completion + relativedelta(months=rolling_months)
                        if latest_completion
                        else None
                    )
                else:
                    # A matching record's completion_date can be unknown
                    # even when it's completed and carries a known
                    # expiration_date -- date.min is the same fallback
                    # every other certification-matching site in this file
                    # uses, rather than dropping such a record outright.
                    latest = (
                        max(anchors, key=lambda r: r.completion_date or date.min)
                        if anchors
                        else None
                    )
                    effective_due_date = latest.expiration_date if latest else None
            else:
                effective_due_date = end_date if end_date else None
        if rolling_hours_has_no_deadline(req):
            effective_due_date = None
        if attendance_met is not None:
            # Attendance is measured over the window, not anchored on a
            # completion: a calendar window falls due when it closes, and a
            # trailing one never does.
            effective_due_date = None if rolling_months else end_date
        # This legacy BIANNUAL override predates due_date_type awareness and
        # is skipped for rolling/certification-period requirements: it
        # selects the newest expiration across *any* record with a bare
        # training_type filter (not _anchor_matches), which can overwrite
        # the just-computed, correctly-anchored due date with an unrelated
        # certification's expiration -- e.g. a biannual EMT cert due in 30
        # days getting silently replaced by an unrelated cert expiring next
        # year, which would then never surface in a 90-day at-risk forecast.
        if (
            freq == RequirementFrequency.BIANNUAL.value
            and not anchored_type
            and attendance_met is None
        ):
            with_exp = [r for r in completed if r.expiration_date]
            if req.training_type:
                with_exp = [r for r in with_exp if r.training_type == req.training_type]
            if with_exp:
                newest = max(with_exp, key=lambda r: r.expiration_date)
                effective_due_date = newest.expiration_date
            elif not effective_due_date:
                effective_due_date = today

        # From the real day: a due date is a calendar promise, as the
        # catch-up deadline below is. Measured from the cut-off, a date that
        # passed this month read as upcoming with the current month excluded.
        days_until_due = (
            (effective_due_date - real_today).days if effective_due_date else None
        )

        deadline = catch_up_deadline(req, join_date, real_today)
        if deadline is not None and not is_met and not nothing_held:
            effective_due_date = deadline
            days_until_due = (deadline - real_today).days
            # Nothing is held against the member until the deadline passes,
            # so a lapsed certificate does not block them in the meantime.
            blocks_activity = False
        else:
            deadline = None

        pace = (
            monthly_pace(month_breakdown, base_required, start_date, end_date)
            if month_breakdown is not None
            else None
        )

        return {
            "id": str(req.id),
            "name": req.name,
            "description": req.description,
            "requirement_type": req_type,
            "frequency": freq,
            "training_type": (
                req.training_type.value
                if req.training_type and hasattr(req.training_type, "value")
                else (str(req.training_type) if req.training_type else None)
            ),
            "required_hours": adjusted_required,
            "original_required_hours": base_required,
            "completed_hours": completed_value,
            "progress_percentage": round(pct, 1),
            "is_met": is_met,
            # Neither met nor unmet: no linked session held yet. Callers leave
            # it out of met/total, as the compliance grader does.
            "not_applicable": nothing_held,
            # Met by a Chief's override rather than by the count.
            "overridden": attendance_overridden,
            "due_date": str(effective_due_date) if effective_due_date else None,
            "days_until_due": days_until_due,
            "waived_months": waived_months,
            **excused_month_reasons(
                _waivers if waived_months else [], start_date, end_date, str(req.id)
            ),
            "active_months": active_months,
            "cert_expired": cert_expired,
            "expiry_date": str(certificate_expiry) if certificate_expiry else None,
            "blocks_activity": blocks_activity,
            "catch_up_deadline": str(deadline) if deadline else None,
            "next_window_opens": (
                str(opens) if (opens := next_window_opens(req, real_today)) else None
            ),
            "window_start": str(start_date) if start_date else None,
            "window_end": str(end_date) if end_date else None,
            "window_months": (
                total_months_in_period(start_date, end_date)
                if start_date and end_date
                else None
            ),
            "monthly_hours": month_breakdown,
            # The same MonthlyPace the compliance matrix reports, from the
            # rows above, so the two screens print one average.
            "monthly_average": pace.average if pace else None,
            "monthly_needed": pace.needed if pace else None,
            "monthly_counts": count_breakdown,
            "course_checklist": course_checklist,
        }

    async def check_requirement_progress(
        self,
        user_id: UUID,
        requirement_id: UUID | str,
        organization_id: UUID | str,
        waivers: Optional[List[WaiverPeriod]] = None,
        requirement: Optional[TrainingRequirement] = None,
        completed_records: Optional[Sequence[Any]] = None,
        today: Optional[date] = None,
        join_date: Optional[date] = None,
        shift_dates: Optional[Sequence[date]] = None,
        held_sessions: Optional[Mapping[str, Sequence["HeldSession"]]] = None,
        evaluation_credits: Optional["EvaluationCredits"] = None,
        org_include_current_month: Optional[bool] = None,
    ) -> RequirementProgress:
        """
        Check a user's progress towards a specific requirement.

        Built from :meth:`evaluate_requirement_detail`, so met, expired, the
        window and the due date are the ones My Training and the compliance
        matrix report. *org_include_current_month* is the department's
        setting; a caller checking several requirements loads it once and
        passes it, and without it the check reads it.

        When *waivers* is provided the required hours/shifts/calls are
        adjusted proportionally for waived months.  If *waivers* is None
        the service will fetch them automatically.

        *requirement* is the already-loaded row for *requirement_id*, and
        *completed_records* the member's completed records in this
        organization (any objects carrying the record's attributes — the
        page preload passes plain rows); a caller checking a page of
        requirements passes both so the check reads nothing further.
        Without them the check queries for what it needs, as it always has.

        *join_date* is the member's ``member_join_date``; with it, an unmet
        requirement inside an existing member's catch-up period reports the
        catch-up deadline as its due date.

        *shift_dates* is the member's worked shifts, full history
        (``load_credited_shift_dates(..., full_history=True)``), for a
        requirement counted from attendance; without them the check loads
        them itself. *evaluation_credits*, the member's entry in
        ``load_evaluation_credits``, is the same for a requirement counted
        from shift evaluations.
        """
        from app.services.training_compliance import (
            counts_shift_attendance,
            get_org_include_current_month,
            is_evaluation_credited,
            is_session_attendance,
            load_credited_shift_dates,
            load_evaluation_credits,
        )

        if requirement is None or str(requirement.id) != str(requirement_id):
            result = await self.db.execute(
                select(TrainingRequirement)
                .where(TrainingRequirement.id == str(requirement_id))
                .where(TrainingRequirement.organization_id == str(organization_id))
            )
            requirement = result.scalar_one_or_none()

        if not requirement:
            raise ValueError("Requirement not found")

        # The department's date. A caller checking several requirements
        # resolves it once and passes it, so every check on the page grades
        # against the same day.
        if today is None:
            today = await resolve_org_today(self.db, organization_id)
        if is_session_attendance(requirement):
            return await self._session_attendance_progress(
                requirement,
                str(user_id),
                str(organization_id),
                today,
                waivers,
                completed_records,
                join_date,
                held_sessions,
            )
        if waivers is None:
            waivers = await fetch_user_waivers(
                self.db,
                str(organization_id),
                str(user_id),
            )
        if org_include_current_month is None:
            org_include_current_month = await get_org_include_current_month(
                self.db, str(organization_id)
            )
        if completed_records is None:
            result = await self.db.execute(
                select(*_PROGRESS_RECORD_COLUMNS).where(
                    TrainingRecord.user_id == str(user_id),
                    TrainingRecord.organization_id == str(organization_id),
                    TrainingRecord.status == TrainingStatus.COMPLETED,
                )
            )
            completed_records = list(result.all())
        if shift_dates is None and counts_shift_attendance(requirement):
            shift_dates = (
                await load_credited_shift_dates(
                    self.db,
                    str(organization_id),
                    [str(user_id)],
                    [requirement],
                    today,
                    org_include_current_month,
                    full_history=True,
                )
            ).get(str(user_id), [])
        if evaluation_credits is None and is_evaluation_credited(requirement):
            evaluation_credits = (
                await load_evaluation_credits(
                    self.db,
                    str(organization_id),
                    [str(user_id)],
                    [requirement],
                    today,
                    org_include_current_month,
                    full_history=True,
                )
            ).get(str(user_id), {})

        # A projection of the requirement detail, which takes met and
        # expired from the shared grader (CLAUDE.md pitfall #29). This used
        # to be a third copy of the grading rules, and it disagreed with the
        # matrix: it graded every requirement on the real day whatever the
        # include-current-month setting, and met a zero-hour target with any
        # hour.
        detail = self.evaluate_requirement_detail(
            requirement,
            completed_records,
            today,
            waivers=waivers,
            org_include_current_month=org_include_current_month,
            join_date=join_date,
            shift_dates=shift_dates,
            held_sessions=held_sessions,
            evaluation_credits=evaluation_credits,
        )
        due_date = detail["due_date"]
        catch_up = detail["catch_up_deadline"]
        return RequirementProgress(
            requirement_id=requirement.id,
            requirement_name=requirement.name,
            required_hours=detail["required_hours"],
            completed_hours=detail["completed_hours"],
            percentage_complete=round(detail["progress_percentage"], 2),
            is_complete=detail["is_met"],
            due_date=date.fromisoformat(due_date) if due_date else None,
            days_until_due=detail["days_until_due"],
            catch_up_deadline=date.fromisoformat(catch_up) if catch_up else None,
        )

    async def _session_attendance_progress(
        self,
        requirement: TrainingRequirement,
        user_id: str,
        organization_id: str,
        today: date,
        waivers: Optional[List[WaiverPeriod]],
        completed_records: Optional[Sequence[Any]],
        join_date: Optional[date],
        held_sessions: Optional[Mapping[str, Sequence["HeldSession"]]],
    ) -> RequirementProgress:
        """A SESSION_ATTENDANCE check, projected from ``evaluate_requirement_detail``.

        The rule lives in ``training_compliance.tally_session_attendance``;
        this only loads what it reads and reshapes the result, so this check
        and the compliance matrix cannot disagree (CLAUDE.md pitfall 29).
        """
        from app.services.training_compliance import (
            get_org_include_current_month,
            load_held_sessions,
        )

        if held_sessions is None:
            held_sessions = await load_held_sessions(
                self.db, organization_id, [requirement]
            )
        if waivers is None:
            waivers = await fetch_user_waivers(self.db, organization_id, user_id)
        if completed_records is None:
            result = await self.db.execute(
                select(TrainingRecord).where(
                    TrainingRecord.organization_id == organization_id,
                    TrainingRecord.user_id == user_id,
                    TrainingRecord.status == TrainingStatus.COMPLETED,
                    TrainingRecord.source_event_id.isnot(None),
                )
            )
            completed_records = result.scalars().all()
        detail = self.evaluate_requirement_detail(
            requirement,
            completed_records,
            today,
            waivers=waivers,
            org_include_current_month=await get_org_include_current_month(
                self.db, organization_id
            ),
            join_date=join_date,
            held_sessions=held_sessions,
        )
        due = detail["due_date"]
        deadline = detail["catch_up_deadline"]
        return RequirementProgress(
            requirement_id=requirement.id,
            requirement_name=requirement.name,
            required_hours=detail["required_hours"],
            completed_hours=detail["completed_hours"],
            percentage_complete=round(detail["progress_percentage"], 2),
            is_complete=detail["is_met"],
            due_date=date.fromisoformat(due) if due else None,
            days_until_due=detail["days_until_due"],
            catch_up_deadline=date.fromisoformat(deadline) if deadline else None,
            not_applicable=detail["not_applicable"],
        )

    async def get_all_requirements_progress(
        self, user_id: UUID, organization_id: UUID | str, year: Optional[int] = None
    ) -> List[RequirementProgress]:
        """
        Get progress for all requirements applicable to a user
        """
        applicable = await self.get_applicable_requirements(
            user_id, organization_id, year=year
        )
        return await self.get_requirements_progress_for(
            user_id, organization_id, applicable
        )

    async def get_requirements_progress_for(
        self,
        user_id: UUID,
        organization_id: UUID | str,
        requirements: List[TrainingRequirement],
    ) -> List[RequirementProgress]:
        """Progress against the given requirements, waivers fetched once.

        Callers that page a long list resolve the applicable requirements
        with ``get_applicable_requirements`` and hand over one page, so the
        per-requirement progress checks are bounded by the page size.
        """
        if not requirements:
            return []
        user_waivers = await fetch_user_waivers(
            self.db,
            str(organization_id),
            str(user_id),
        )
        join_date = await self._catch_up_join_date(
            user_id, organization_id, requirements
        )
        # One read of the member's completed records serves every
        # requirement on the page; each check then filters in memory
        # instead of issuing its own queries. Only the columns the checks
        # read are loaded (never notes or attachments), and the read is cut
        # to the union of the windows the page's requirements evaluate — a
        # page for a past year does not load the years since — unless one
        # of them judges certifications, which count however old.
        preload = select(*_PROGRESS_RECORD_COLUMNS).where(
            TrainingRecord.user_id == str(user_id),
            TrainingRecord.organization_id == str(organization_id),
            TrainingRecord.status == TrainingStatus.COMPLETED,
        )
        # One date for the preload window and every check below: resolving it
        # per check could straddle midnight and grade half the page against
        # a window the preload never read.
        today = await resolve_org_today(self.db, organization_id)
        from app.services.training_compliance import get_org_include_current_month

        org_include_current_month = await get_org_include_current_month(
            self.db, str(organization_id)
        )
        window = self._preload_window(requirements, today, org_include_current_month)
        if window is not None:
            start, end = window
            preload = preload.where(
                TrainingRecord.completion_date >= start,
                TrainingRecord.completion_date <= end,
            )
        # Plain rows, not ORM instances: the checks only read attributes,
        # and a partial entity load would collide with any full copy of the
        # same record already in the session.
        completed = list((await self.db.execute(preload)).all())
        # The member's worked shifts, for any requirement counted from
        # attendance; full history, as a rolling one anchors its due date on
        # the latest shift however old.
        from app.services.training_compliance import (
            load_credited_shift_dates,
            load_evaluation_credits,
            load_held_sessions,
        )

        shift_dates = (
            await load_credited_shift_dates(
                self.db,
                str(organization_id),
                [str(user_id)],
                requirements,
                today,
                org_include_current_month,
                full_history=True,
            )
        ).get(str(user_id), [])
        evaluation_credits = (
            await load_evaluation_credits(
                self.db,
                str(organization_id),
                [str(user_id)],
                requirements,
                today,
                org_include_current_month,
                full_history=True,
            )
        ).get(str(user_id), {})
        held_sessions = await load_held_sessions(
            self.db, str(organization_id), requirements
        )
        progress_list = []
        for req in requirements:
            progress = await self.check_requirement_progress(
                user_id,
                req.id,
                organization_id,
                waivers=user_waivers,
                requirement=req,
                completed_records=completed,
                today=today,
                join_date=join_date,
                shift_dates=shift_dates,
                held_sessions=held_sessions,
                evaluation_credits=evaluation_credits,
                org_include_current_month=org_include_current_month,
            )
            progress_list.append(progress)
        return progress_list

    @classmethod
    def _preload_window(
        cls,
        requirements: List[TrainingRequirement],
        today: date,
        org_include_current_month: bool = True,
    ) -> Optional[Tuple[date, date]]:
        """The span of completion dates any of ``requirements`` can count:
        the earliest window start to the latest window end.

        ``None`` when some requirement counts records regardless of the
        frequency window — a certification, a biannual requirement whose
        expiry-based due date looks at every record, or a
        rolling/certification-period requirement whose due-date anchor
        (in ``evaluate_requirement_detail``) must see every
        completion to find one older than the window (the overdue case a
        window-bounded search would otherwise miss) — or when a
        requirement's own window is open-ended.

        The per-requirement window is
        ``training_compliance.completion_window``, which the department-wide
        compliance load (``graded_records_clause``) also uses. The exemptions
        above are this evaluator's own: ``check_requirement_progress`` reads
        due-date anchors the compliance grader does not, so that load can
        bound cases this one cannot.
        """
        from app.models.training import RequirementType
        from app.services.training_compliance import (
            completion_window,
            requirement_as_of,
        )

        starts = []
        ends = []
        for req in requirements:
            req_type = getattr(req.requirement_type, "value", req.requirement_type)
            freq = getattr(req.frequency, "value", req.frequency)
            if (
                req_type == RequirementType.CERTIFICATION.value
                # Any biannual requirement: evaluate_requirement_detail's
                # biannual due date reads every record with an expiry.
                or freq == RequirementFrequency.BIANNUAL.value
                or get_rolling_period_months(req)
                or cls._due_date_type_str(req) == "certification_period"
            ):
                return None
            # The window the requirement is graded over, which ends last
            # month when the current month is excluded.
            as_of = requirement_as_of(req, today, org_include_current_month)
            start, end = completion_window(req, as_of)
            # A freshness cutoff on an open-ended window (the only way to get
            # a start with no end) closes it at the as-of date.
            if start is not None and end is None:
                end = as_of
            if start is None or end is None:
                return None
            starts.append(start)
            ends.append(end)
        if not starts:
            return None
        return min(starts), max(ends)

    # Columns a "new members only" copy must not inherit from its original:
    # identity, authorship and timestamps belong to the new row, and the
    # grandfathering dates are set explicitly by the split.
    _SPLIT_EXCLUDED_COLUMNS = frozenset(
        {
            "id",
            "organization_id",
            "created_by",
            "created_at",
            "updated_at",
            "new_member_cutoff_date",
            "existing_member_deadline",
            "applies_to_joined_before",
        }
    )
    # Fields a split edit may not carry. The copy's grandfathering is fixed by
    # the split itself, and deactivating is a decision about the original.
    _SPLIT_FORBIDDEN_FIELDS = frozenset(
        {"new_member_cutoff_date", "existing_member_deadline", "active"}
    )

    def split_requirement_for_new_members(
        self,
        requirement: TrainingRequirement,
        updates: Dict[str, Any],
        effective_date: date,
        created_by: Optional[str],
    ) -> TrainingRequirement:
        """Apply ``updates`` to new members only.

        The original keeps its current standard and is limited to members who
        joined before ``effective_date``; a copy carrying ``updates`` grades
        everyone who joined on or after it, and exempts everyone earlier —
        they are still graded by the original. Both rows stay active and are
        edited independently afterwards.

        Returns the copy, added to the session but not flushed. Raises
        ``ValueError`` when the split would be meaningless or contradictory;
        the caller must hold the original row locked so two concurrent splits
        cannot both succeed.

        Program links (``ProgramRequirement``) stay on the original: a
        program's enrollees are graded through their enrollment, and whether
        they take on a changed standard is decided per program when a
        requirement is added to it.
        """
        if requirement.applies_to_joined_before is not None:
            raise ValueError(
                "This requirement already holds the earlier standard for members "
                f"who joined before {requirement.applies_to_joined_before}. Edit "
                "the newer copy to change the standard for new members."
            )
        # The edit form sends every field it owns on every save, so a field is
        # refused only when the save would actually change it.
        forbidden = sorted(
            key
            for key in self._SPLIT_FORBIDDEN_FIELDS & updates.keys()
            if getattr(requirement, key) != updates[key]
        )
        if forbidden:
            raise ValueError(
                f"{', '.join(forbidden)} can't be changed in a new-members-only "
                "save. Save that change for everyone instead."
            )
        cutoff = requirement.new_member_cutoff_date
        if cutoff is not None and effective_date <= cutoff:
            raise ValueError(
                f"The effective date must be after this requirement's existing "
                f"cutoff ({cutoff}), or the earlier standard would grade nobody."
            )
        changed = {
            key: value
            for key, value in updates.items()
            if key not in self._SPLIT_FORBIDDEN_FIELDS
            and not _same_requirement_value(getattr(requirement, key), value)
        }
        if not changed:
            raise ValueError(
                "Nothing would change for new members: no field differs from the "
                "current requirement."
            )

        mapper = sa_inspect(TrainingRequirement)
        values = {
            attr.key: copy.deepcopy(getattr(requirement, attr.key))
            for attr in mapper.column_attrs
            if attr.key not in self._SPLIT_EXCLUDED_COLUMNS
        }
        values.update(copy.deepcopy(changed))
        new_requirement = TrainingRequirement(
            organization_id=requirement.organization_id,
            created_by=created_by,
            new_member_cutoff_date=effective_date,
            existing_member_deadline=None,
            applies_to_joined_before=None,
            **values,
        )
        requirement.applies_to_joined_before = effective_date
        self.db.add(new_requirement)
        return new_requirement

    async def _catch_up_join_date(
        self,
        user_id: UUID,
        organization_id: UUID | str,
        requirements: Sequence[TrainingRequirement],
    ) -> Optional[date]:
        """The member's ``member_join_date``, read without loading the row.

        Only a catch-up period needs it here — applicability was settled when
        ``requirements`` were chosen — so a page with none skips the query and
        keeps the per-page read count where it was before grandfathering.
        """
        if not any(r.existing_member_deadline for r in requirements):
            return None
        from app.services.training_compliance import join_date_from

        row = (
            await self.db.execute(
                select(User.hire_date, User.created_at).where(
                    User.id == str(user_id),
                    User.organization_id == str(organization_id),
                )
            )
        ).first()
        if row is None:
            return None
        return join_date_from(row[0], row[1])

    async def get_applicable_requirements(
        self, user_id: UUID, organization_id: UUID | str, year: Optional[int] = None
    ) -> List[TrainingRequirement]:
        """The active requirements that grade a user, in a stable order."""
        # NOTE: `year` defaults to None → the year filter below is skipped (all
        # years). A prior no-op `year or <current year>` here was dead code;
        # whether this should default to the current year is a compliance-
        # semantics decision (see docs/module-audit/training.md), left as-is.

        # The member, with the positions requirement_applies_to_user reads.
        user_result = await self.db.execute(
            select(User)
            .where(
                User.id == str(user_id),
                User.organization_id == str(organization_id),
            )
            .options(selectinload(User.positions))
        )
        user = user_result.scalar_one_or_none()
        if not user:
            return []

        # Get all active requirements. Ordered so a paged caller sees a
        # stable sequence across calls.
        query = (
            select(TrainingRequirement)
            .where(TrainingRequirement.organization_id == str(organization_id))
            .where(TrainingRequirement.active.is_(True))
            .order_by(TrainingRequirement.name, TrainingRequirement.id)
        )

        if year:
            query = query.where(
                or_(
                    TrainingRequirement.year == year,
                    TrainingRequirement.year.is_(None),
                )
            )

        result = await self.db.execute(query)
        requirements = result.scalars().all()

        # ComplianceGrading.for_member is the one definition of which
        # requirements grade a member: the matching compliance profile
        # narrows the set, then applicability by type, rank, position and
        # grandfathering dates. /my-training, the profile card, the matrix and
        # the dashboard resolve through it too, so every one of them answers
        # the same (D10). Filtering by a keep-set preserves the (name, id)
        # order a paged caller relies on; for_member returns the profile's
        # own id order instead.
        from app.services.training_compliance import (
            ComplianceGrading,
            _load_compliance_config,
        )

        grading = ComplianceGrading.from_config(
            await _load_compliance_config(self.db, str(organization_id))
        )
        keep = {
            str(r.id) for r in grading.for_member(user, list(requirements)).requirements
        }
        return [req for req in requirements if str(req.id) in keep]

    async def get_expiring_certifications(
        self,
        organization_id: UUID | str,
        days_ahead: int = 90,
        user_id: UUID | str | None = None,
    ) -> List[TrainingRecord]:
        """
        Get certifications that are expiring within the specified number of days,
        including those that have already expired.

        Pass ``user_id`` to confine the result to one member (self-service
        callers do this — these records carry certification numbers/scores that
        are not roster-public, so a non-officer must not see the whole org).
        """
        today = await resolve_org_today(self.db, organization_id)
        future_date = today + timedelta(days=days_ahead)

        query = (
            select(TrainingRecord)
            .where(TrainingRecord.organization_id == str(organization_id))
            .where(TrainingRecord.status == TrainingStatus.COMPLETED)
            .where(TrainingRecord.expiration_date.isnot(None))
            .where(TrainingRecord.expiration_date <= future_date)
            .order_by(TrainingRecord.expiration_date)
        )
        if user_id is not None:
            query = query.where(TrainingRecord.user_id == str(user_id))

        result = await self.db.execute(query)
        return list(result.scalars().all())
