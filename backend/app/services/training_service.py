"""
Training Service

Business logic for training management including courses, records, requirements, and reporting.
"""

import calendar
from typing import List, Optional, Dict, Tuple
from datetime import datetime, date, timedelta, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import selectinload
from uuid import UUID

from app.models.training import (
    TrainingCourse,
    TrainingRecord,
    TrainingRequirement,
    TrainingStatus,
    TrainingType,
    RequirementFrequency,
)
from app.models.user import User
from app.schemas.training import (
    UserTrainingStats,
    TrainingHoursSummary,
    TrainingReport,
    RequirementProgress,
)
from app.services.training_waiver_service import (
    WaiverPeriod, fetch_user_waivers, adjust_required, get_rolling_period_months,
)


class TrainingService:
    """Service for training management"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_user_training_stats(
        self, user_id: UUID, organization_id: UUID
    ) -> UserTrainingStats:
        """
        Get comprehensive training statistics for a user
        """
        current_year = datetime.now(timezone.utc).year

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
        today = date.today()
        ninety_days = today + timedelta(days=90)

        active_certifications = sum(
            1
            for r in certifications
            if r.expiration_date and r.expiration_date > today
        )

        expiring_soon = sum(
            1
            for r in certifications
            if r.expiration_date
            and today < r.expiration_date <= ninety_days
        )

        expired = sum(
            1
            for r in certifications
            if r.expiration_date and r.expiration_date <= today
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
        organization_id: UUID,
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
        organization_id: UUID,
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
                from app.models.user import User as _User, Organization as _Org
                user_result = await self.db.execute(
                    select(_User).where(_User.id == str(user_id))
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
                        _member_tier_id = getattr(_member, "membership_type", None) or "active"
                        _tier_def = next((t for t in _tiers if t.get("id") == _member_tier_id), None)
                        if _tier_def:
                            _benefits = _tier_def.get("benefits", {})
                            tier_exempt = _benefits.get("training_exempt", False)
                            tier_exempt_types = _benefits.get("training_exempt_types", [])
            except Exception:
                pass  # Fail open — don't block training checks if tier lookup fails

            # Get all active requirements
            req_result = await self.db.execute(
                select(TrainingRequirement)
                .where(TrainingRequirement.organization_id == str(organization_id))
                .where(TrainingRequirement.active == True)  # noqa: E712
            )
            requirements = req_result.scalars().all()

            # Pre-fetch waivers once for all requirement checks
            user_waivers = await fetch_user_waivers(
                self.db, str(organization_id), str(user_id),
            )

            for req in requirements:
                # Tier-based exemption: treat requirement as met
                if tier_exempt:
                    requirements_met.append(req.id)
                    continue
                if tier_exempt_types and getattr(req, "training_type", None):
                    req_type = req.training_type.value if hasattr(req.training_type, "value") else str(req.training_type)
                    if req_type in tier_exempt_types:
                        requirements_met.append(req.id)
                        continue

                progress = await self.check_requirement_progress(
                    user_id, req.id, organization_id, waivers=user_waivers
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
    def _get_date_window(requirement, today: date):
        """Return (start_date, end_date) for a requirement's evaluation period.

        Handles rolling periods (``due_date_type='rolling'``), plus the
        standard frequency-based windows (annual, quarterly, monthly, etc.).
        """
        # Rolling period takes precedence over frequency-based window
        due_date_type = getattr(requirement, 'due_date_type', None)
        if due_date_type:
            due_date_type = due_date_type.value if hasattr(due_date_type, 'value') else str(due_date_type)
        rolling_months = getattr(requirement, 'rolling_period_months', None)

        if due_date_type == 'rolling' and rolling_months:
            from dateutil.relativedelta import relativedelta
            return today - relativedelta(months=rolling_months), today

        freq = requirement.frequency.value if hasattr(requirement.frequency, 'value') else str(requirement.frequency)
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
            # Annual (default)
            yr = requirement.year if requirement.year else current_year
            return date(yr, 1, 1), date(yr, 12, 31)

    @staticmethod
    def evaluate_requirement_detail(
        req, member_records, today: date, waivers=None,
    ) -> Dict:
        """Evaluate a member's progress on a single requirement (in-memory).

        Works with pre-fetched ``member_records`` to avoid N+1 queries.
        Returns a dict with all fields needed by the ``/my-training``
        endpoint's detailed requirements breakdown.

        This handles every ``requirement_type``: hours, courses,
        certification, shifts, calls, and fallback.
        """
        from app.models.training import RequirementType

        req_type = req.requirement_type.value if hasattr(req.requirement_type, 'value') else str(req.requirement_type)
        freq = req.frequency.value if hasattr(req.frequency, 'value') else str(req.frequency)
        start_date, end_date = TrainingService._get_date_window(req, today)
        _waivers = waivers or []

        # Filter completed records in the date window
        completed = [r for r in member_records if r.status == TrainingStatus.COMPLETED]
        if start_date and end_date:
            windowed = [
                r for r in completed
                if r.completion_date and start_date <= r.completion_date <= end_date
            ]
        else:
            windowed = completed

        completed_value: float = 0
        base_required: float = 0
        adjusted_required: float = 0
        waived_months = 0
        active_months = 0
        cert_expired = False
        blocks_activity = False

        # ---- HOURS ----
        if req_type == RequirementType.HOURS.value:
            type_matched = windowed
            if req.training_type:
                type_matched = [r for r in windowed if r.training_type == req.training_type]
            if req.required_courses:
                req_courses = set(req.required_courses)
                type_matched = [r for r in type_matched if r.course_id and str(r.course_id) in req_courses]

            completed_value = sum(r.hours_completed or 0 for r in type_matched)
            base_required = req.required_hours or 0
            adjusted_required = base_required

            if base_required > 0 and start_date and end_date and _waivers:
                adjusted_required, waived_months, active_months = adjust_required(
                    base_required, start_date, end_date, _waivers, str(req.id),
                    period_months=get_rolling_period_months(req),
                )

            # Biannual: expired cert overrides hours
            if freq == RequirementFrequency.BIANNUAL.value:
                with_exp = [r for r in completed if r.expiration_date]
                if req.training_type:
                    with_exp = [r for r in with_exp if r.training_type == req.training_type]
                if with_exp:
                    newest = max(with_exp, key=lambda r: r.expiration_date)
                    if newest.expiration_date < today:
                        cert_expired = True
                        blocks_activity = True
                elif req.name:
                    # No cert records at all with expiration — check by name
                    pass

        # ---- COURSES ----
        elif req_type == RequirementType.COURSES.value:
            course_ids = req.required_courses or []
            completed_course_ids = {str(r.course_id) for r in windowed if r.course_id}
            matched = sum(1 for cid in course_ids if cid in completed_course_ids)
            completed_value = float(matched)
            base_required = float(len(course_ids))
            adjusted_required = base_required

        # ---- CERTIFICATION ----
        elif req_type == RequirementType.CERTIFICATION.value:
            matching = [
                r for r in completed
                if (
                    (req.training_type and r.training_type == req.training_type)
                    or (r.course_name and req.name and req.name.lower() in r.course_name.lower())
                    or (r.certification_number and getattr(req, 'registry_code', None)
                        and req.registry_code.lower() in r.certification_number.lower())
                )
            ]
            base_required = 1
            adjusted_required = 1
            if matching:
                latest = max(matching, key=lambda r: r.completion_date or date.min)
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
            type_matched = windowed
            if req.training_type:
                type_matched = [r for r in windowed if r.training_type == req.training_type]
            completed_value = float(len(type_matched))
            base_required = float(req.required_shifts or 0)
            adjusted_required = base_required

            if base_required > 0 and start_date and end_date and _waivers:
                adjusted_required, waived_months, active_months = adjust_required(
                    base_required, start_date, end_date, _waivers, str(req.id),
                    period_months=get_rolling_period_months(req),
                )

        # ---- CALLS ----
        elif req_type == RequirementType.CALLS.value:
            type_matched = windowed
            if req.training_type:
                type_matched = [r for r in windowed if r.training_type == req.training_type]
            completed_value = float(len(type_matched))
            base_required = float(req.required_calls or 0)
            adjusted_required = base_required

            if base_required > 0 and start_date and end_date and _waivers:
                adjusted_required, waived_months, active_months = adjust_required(
                    base_required, start_date, end_date, _waivers, str(req.id),
                    period_months=get_rolling_period_months(req),
                )

        # ---- Fallback ----
        else:
            matching = []
            if req.training_type:
                matching = [r for r in windowed if r.training_type == req.training_type]
            if not matching and req.name:
                matching = [
                    r for r in windowed
                    if r.course_name and req.name.lower() in r.course_name.lower()
                ]
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

        # Calculate percentage
        if adjusted_required > 0:
            pct = min(completed_value / adjusted_required * 100, 100)
        else:
            pct = 100.0

        if cert_expired:
            pct = 0.0

        is_met = pct >= 100 and not cert_expired

        # Effective due date
        effective_due_date = req.due_date if req.due_date else (end_date if end_date else None)
        if freq == RequirementFrequency.BIANNUAL.value:
            with_exp = [r for r in completed if r.expiration_date]
            if req.training_type:
                with_exp = [r for r in with_exp if r.training_type == req.training_type]
            if with_exp:
                newest = max(with_exp, key=lambda r: r.expiration_date)
                effective_due_date = newest.expiration_date
            elif not effective_due_date:
                effective_due_date = today

        days_until_due = (effective_due_date - today).days if effective_due_date else None

        return {
            "id": str(req.id),
            "name": req.name,
            "description": req.description,
            "requirement_type": req_type,
            "frequency": freq,
            "training_type": req.training_type.value if req.training_type and hasattr(req.training_type, 'value') else (str(req.training_type) if req.training_type else None),
            "required_hours": adjusted_required,
            "original_required_hours": base_required,
            "completed_hours": completed_value,
            "progress_percentage": round(pct, 1),
            "is_met": is_met,
            "due_date": str(effective_due_date) if effective_due_date else None,
            "days_until_due": days_until_due,
            "waived_months": waived_months,
            "active_months": active_months,
            "cert_expired": cert_expired,
            "blocks_activity": blocks_activity,
        }

    async def check_requirement_progress(
        self, user_id: UUID, requirement_id: UUID, organization_id: UUID,
        waivers: Optional[List[WaiverPeriod]] = None,
    ) -> RequirementProgress:
        """
        Check a user's progress towards a specific requirement.

        Handles all requirement types: hours, courses, certification,
        shifts, calls, and fallback.

        When *waivers* is provided the required hours/shifts/calls are
        adjusted proportionally for waived months.  If *waivers* is None
        the service will fetch them automatically.
        """
        from app.models.training import RequirementType

        # Get the requirement
        result = await self.db.execute(
            select(TrainingRequirement)
            .where(TrainingRequirement.id == str(requirement_id))
            .where(TrainingRequirement.organization_id == str(organization_id))
        )
        requirement = result.scalar_one_or_none()

        if not requirement:
            raise ValueError("Requirement not found")

        today = date.today()
        start_date, end_date = self._get_date_window(requirement, today)
        req_type = requirement.requirement_type.value if hasattr(requirement.requirement_type, 'value') else str(requirement.requirement_type)
        freq = requirement.frequency.value if hasattr(requirement.frequency, 'value') else str(requirement.frequency)

        # Fetch waivers if not pre-loaded
        if waivers is None:
            waivers = await fetch_user_waivers(
                self.db, str(organization_id), str(user_id),
            )

        # Base query for completed records in the evaluation window
        def _base_query():
            q = (
                select(TrainingRecord)
                .where(TrainingRecord.user_id == str(user_id))
                .where(TrainingRecord.organization_id == str(organization_id))
                .where(TrainingRecord.status == TrainingStatus.COMPLETED)
            )
            if start_date and end_date:
                q = q.where(
                    TrainingRecord.completion_date >= start_date,
                    TrainingRecord.completion_date <= end_date,
                )
            return q

        completed_value: float = 0
        required_value: float = 0
        is_complete = False

        # ---- HOURS requirements ----
        if req_type == RequirementType.HOURS.value:
            hours_q = (
                select(func.sum(TrainingRecord.hours_completed))
                .where(TrainingRecord.user_id == str(user_id))
                .where(TrainingRecord.organization_id == str(organization_id))
                .where(TrainingRecord.status == TrainingStatus.COMPLETED)
            )
            if start_date and end_date:
                hours_q = hours_q.where(
                    TrainingRecord.completion_date >= start_date,
                    TrainingRecord.completion_date <= end_date,
                )
            if requirement.training_type:
                hours_q = hours_q.where(TrainingRecord.training_type == requirement.training_type)
            if requirement.required_courses:
                hours_q = hours_q.where(TrainingRecord.course_id.in_(requirement.required_courses))

            result = await self.db.execute(hours_q)
            completed_value = float(result.scalar() or 0)
            required_value = requirement.required_hours or 0

            # Adjust for waivers
            if required_value > 0 and start_date and end_date and waivers:
                required_value, _, _ = adjust_required(
                    required_value, start_date, end_date, waivers, str(requirement.id),
                    period_months=get_rolling_period_months(requirement),
                )

            # Biannual: expired cert overrides hours
            if freq == RequirementFrequency.BIANNUAL.value:
                cert_q = (
                    select(TrainingRecord.expiration_date)
                    .where(
                        TrainingRecord.user_id == str(user_id),
                        TrainingRecord.organization_id == str(organization_id),
                        TrainingRecord.status == TrainingStatus.COMPLETED,
                        TrainingRecord.expiration_date.isnot(None),
                    )
                    .order_by(TrainingRecord.expiration_date.desc())
                    .limit(1)
                )
                if requirement.training_type:
                    cert_q = cert_q.where(TrainingRecord.training_type == requirement.training_type)
                cert_result = await self.db.execute(cert_q)
                latest_exp = cert_result.scalar_one_or_none()
                if latest_exp and latest_exp < today:
                    # Expired cert — requirement is not met
                    is_complete = False
                    completed_value = 0
                    required_value = requirement.required_hours or 0
                    return RequirementProgress(
                        requirement_id=requirement.id,
                        requirement_name=requirement.name,
                        required_hours=required_value,
                        completed_hours=completed_value,
                        percentage_complete=0.0,
                        is_complete=False,
                        due_date=requirement.due_date,
                    )

            is_complete = completed_value >= required_value if required_value > 0 else True

        # ---- COURSES requirements ----
        elif req_type == RequirementType.COURSES.value:
            course_ids = requirement.required_courses or []
            if not course_ids:
                return RequirementProgress(
                    requirement_id=requirement.id,
                    requirement_name=requirement.name,
                    required_hours=0,
                    completed_hours=0,
                    percentage_complete=100.0,
                    is_complete=True,
                    due_date=requirement.due_date,
                )

            records_result = await self.db.execute(_base_query())
            records = records_result.scalars().all()
            completed_course_ids = {str(r.course_id) for r in records if r.course_id}
            matched = sum(1 for cid in course_ids if cid in completed_course_ids)

            required_value = float(len(course_ids))
            completed_value = float(matched)
            is_complete = matched >= len(course_ids)

        # ---- CERTIFICATION requirements ----
        elif req_type == RequirementType.CERTIFICATION.value:
            cert_q = (
                select(TrainingRecord)
                .where(
                    TrainingRecord.user_id == str(user_id),
                    TrainingRecord.organization_id == str(organization_id),
                    TrainingRecord.status == TrainingStatus.COMPLETED,
                )
            )
            cert_result = await self.db.execute(cert_q)
            all_completed = cert_result.scalars().all()

            # Match by training_type, name substring, or registry_code
            matching = [
                r for r in all_completed
                if (
                    (requirement.training_type and r.training_type == requirement.training_type)
                    or (r.course_name and requirement.name and requirement.name.lower() in r.course_name.lower())
                    or (r.certification_number and requirement.registry_code
                        and requirement.registry_code.lower() in r.certification_number.lower())
                )
            ]

            if matching:
                latest = max(matching, key=lambda r: r.completion_date or date.min)
                if latest.expiration_date and latest.expiration_date < today:
                    # Expired certification
                    is_complete = False
                    completed_value = 0
                    required_value = 1
                else:
                    is_complete = True
                    completed_value = 1
                    required_value = 1
            else:
                is_complete = False
                completed_value = 0
                required_value = 1

        # ---- SHIFTS requirements ----
        elif req_type == RequirementType.SHIFTS.value:
            records_result = await self.db.execute(_base_query())
            records = records_result.scalars().all()
            type_matched = records
            if requirement.training_type:
                type_matched = [r for r in records if r.training_type == requirement.training_type]

            completed_value = float(len(type_matched))
            required_value = float(requirement.required_shifts or 0)

            # Adjust for waivers
            if required_value > 0 and start_date and end_date and waivers:
                required_value, _, _ = adjust_required(
                    required_value, start_date, end_date, waivers, str(requirement.id),
                    period_months=get_rolling_period_months(requirement),
                )

            is_complete = completed_value >= required_value if required_value > 0 else True

        # ---- CALLS requirements ----
        elif req_type == RequirementType.CALLS.value:
            records_result = await self.db.execute(_base_query())
            records = records_result.scalars().all()
            type_matched = records
            if requirement.training_type:
                type_matched = [r for r in records if r.training_type == requirement.training_type]

            completed_value = float(len(type_matched))
            required_value = float(requirement.required_calls or 0)

            # Adjust for waivers
            if required_value > 0 and start_date and end_date and waivers:
                required_value, _, _ = adjust_required(
                    required_value, start_date, end_date, waivers, str(requirement.id),
                    period_months=get_rolling_period_months(requirement),
                )

            is_complete = completed_value >= required_value if required_value > 0 else True

        # ---- Fallback (skills_evaluation, checklist, etc.) ----
        else:
            records_result = await self.db.execute(_base_query())
            records = records_result.scalars().all()
            matching = []
            if requirement.training_type:
                matching = [r for r in records if r.training_type == requirement.training_type]
            if not matching and requirement.name:
                matching = [
                    r for r in records
                    if r.course_name and requirement.name.lower() in r.course_name.lower()
                ]

            if matching:
                latest = max(matching, key=lambda r: r.completion_date or date.min)
                if latest.expiration_date and latest.expiration_date < today:
                    is_complete = False
                    completed_value = 0
                    required_value = 1
                else:
                    is_complete = True
                    completed_value = 1
                    required_value = 1
            else:
                is_complete = False
                completed_value = 0
                required_value = 1

        percentage = (completed_value / required_value * 100) if required_value > 0 else 100
        percentage = min(percentage, 100.0)

        return RequirementProgress(
            requirement_id=requirement.id,
            requirement_name=requirement.name,
            required_hours=required_value,
            completed_hours=completed_value,
            percentage_complete=round(percentage, 2),
            is_complete=is_complete,
            due_date=requirement.due_date,
        )

    async def get_all_requirements_progress(
        self, user_id: UUID, organization_id: UUID, year: Optional[int] = None
    ) -> List[RequirementProgress]:
        """
        Get progress for all requirements applicable to a user
        """
        current_year = year or datetime.now(timezone.utc).year

        # Get user's roles
        user_result = await self.db.execute(
            select(User)
            .where(User.id == str(user_id))
            .options(selectinload(User.roles))
        )
        user = user_result.scalar_one_or_none()
        if not user:
            return []

        user_role_ids = [str(role.id) for role in user.roles]

        # Get all active requirements
        query = (
            select(TrainingRequirement)
            .where(TrainingRequirement.organization_id == str(organization_id))
            .where(TrainingRequirement.active == True)  # noqa: E712
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

        # Filter requirements applicable to this user
        applicable_requirements = []
        for req in requirements:
            if req.applies_to_all:
                applicable_requirements.append(req)
            elif req.required_roles:
                # Check if user has any of the required roles
                if any(role_id in user_role_ids for role_id in req.required_roles):
                    applicable_requirements.append(req)

        # Pre-fetch waivers once for all requirement checks
        user_waivers = await fetch_user_waivers(
            self.db, str(organization_id), str(user_id),
        )

        # Get progress for each requirement
        progress_list = []
        for req in applicable_requirements:
            progress = await self.check_requirement_progress(
                user_id, req.id, organization_id, waivers=user_waivers
            )
            progress_list.append(progress)

        return progress_list

    async def get_expiring_certifications(
        self, organization_id: UUID, days_ahead: int = 90
    ) -> List[TrainingRecord]:
        """
        Get certifications that are expiring within the specified number of days,
        including those that have already expired.
        """
        today = date.today()
        future_date = today + timedelta(days=days_ahead)

        result = await self.db.execute(
            select(TrainingRecord)
            .where(TrainingRecord.organization_id == str(organization_id))
            .where(TrainingRecord.status == TrainingStatus.COMPLETED)
            .where(TrainingRecord.expiration_date.isnot(None))
            .where(TrainingRecord.expiration_date <= future_date)
            .order_by(TrainingRecord.expiration_date)
        )

        return result.scalars().all()
