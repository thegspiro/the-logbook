"""
Competency Matrix / Heat Map Service

Generates a department-wide dashboard view showing all members vs. all required
skills/certifications, color-coded by status:
- current (green): active and not expiring soon
- expiring_soon (yellow): expiring within 90 days
- expired (red): past expiration date
- not_started (gray): no record on file

Gives training officers an at-a-glance department readiness picture.
"""

import calendar
from datetime import date, timedelta
from typing import List, Dict, Optional
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from loguru import logger

from app.models.training import (
    TrainingRecord,
    TrainingRequirement,
    TrainingStatus,
    RequirementType,
    RequirementFrequency,
)
from app.models.user import User, UserStatus
from app.services.training_waiver_service import (
    WaiverPeriod, fetch_org_waivers, adjust_required,
)


class CompetencyMatrixService:
    """Generates competency matrix / heat map data."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_competency_matrix(
        self,
        organization_id: UUID,
        requirement_ids: Optional[List[str]] = None,
        user_ids: Optional[List[str]] = None,
    ) -> Dict:
        """
        Generate the competency matrix for the organization.

        Returns:
        {
            "generated_at": "2026-02-14T...",
            "requirements": [{"id": "...", "name": "...", "type": "..."}],
            "members": [
                {
                    "user_id": "...",
                    "name": "...",
                    "statuses": {
                        "<requirement_id>": {
                            "status": "current|expiring_soon|expired|not_started",
                            "expiration_date": "2026-06-01" | null,
                            "completion_date": "2025-06-01" | null,
                            "details": "EMT-B #12345"
                        }
                    }
                }
            ],
            "summary": {
                "total_members": 25,
                "total_requirements": 8,
                "current_count": 150,
                "expiring_soon_count": 12,
                "expired_count": 3,
                "not_started_count": 35,
                "readiness_percentage": 75.0
            }
        }
        """
        # Get active requirements
        req_query = (
            select(TrainingRequirement)
            .where(TrainingRequirement.organization_id == str(organization_id))
            .where(TrainingRequirement.active == True)  # noqa: E712
        )
        if requirement_ids:
            req_query = req_query.where(TrainingRequirement.id.in_(requirement_ids))
        req_result = await self.db.execute(req_query)
        requirements = list(req_result.scalars().all())

        # Get active members
        user_query = (
            select(User)
            .where(User.organization_id == str(organization_id))
            .where(User.status == UserStatus.ACTIVE)
            .where(User.deleted_at.is_(None))
        )
        if user_ids:
            user_query = user_query.where(User.id.in_(user_ids))
        user_query = user_query.order_by(User.last_name, User.first_name)
        user_result = await self.db.execute(user_query)
        members = list(user_result.scalars().all())

        # Get all completed training records for this org
        records_result = await self.db.execute(
            select(TrainingRecord)
            .where(TrainingRecord.organization_id == str(organization_id))
            .where(TrainingRecord.status == TrainingStatus.COMPLETED)
        )
        all_records = list(records_result.scalars().all())

        # Index records by user_id for fast lookup
        records_by_user: Dict[str, List[TrainingRecord]] = {}
        for record in all_records:
            uid = str(record.user_id)
            if uid not in records_by_user:
                records_by_user[uid] = []
            records_by_user[uid].append(record)

        # Batch-fetch all active waivers / leaves for the org
        waivers_by_user = await fetch_org_waivers(self.db, str(organization_id))

        today = date.today()
        expiring_threshold = today + timedelta(days=90)

        # Counters
        current_count = 0
        expiring_soon_count = 0
        expired_count = 0
        not_started_count = 0

        # Build matrix
        requirement_list = [
            {
                "id": str(req.id),
                "name": req.name,
                "type": req.requirement_type.value if req.requirement_type else None,
                "source": req.source.value if req.source else None,
                "registry_code": req.registry_code,
            }
            for req in requirements
        ]

        member_rows = []
        for member in members:
            uid = str(member.id)
            user_records = records_by_user.get(uid, [])
            member_waivers = waivers_by_user.get(uid, [])
            statuses = {}

            for req in requirements:
                rid = str(req.id)
                status_info = self._evaluate_requirement_status(
                    req, user_records, today, expiring_threshold, waivers=member_waivers
                )
                statuses[rid] = status_info

                # Count
                s = status_info["status"]
                if s == "current":
                    current_count += 1
                elif s == "expiring_soon":
                    expiring_soon_count += 1
                elif s == "expired":
                    expired_count += 1
                else:
                    not_started_count += 1

            member_rows.append({
                "user_id": uid,
                "name": member.full_name,
                "statuses": statuses,
            })

        total_cells = len(members) * len(requirements)
        readiness = (
            ((current_count + expiring_soon_count) / total_cells * 100)
            if total_cells > 0
            else 0
        )

        return {
            "generated_at": date.today().isoformat(),
            "requirements": requirement_list,
            "members": member_rows,
            "summary": {
                "total_members": len(members),
                "total_requirements": len(requirements),
                "current_count": current_count,
                "expiring_soon_count": expiring_soon_count,
                "expired_count": expired_count,
                "not_started_count": not_started_count,
                "readiness_percentage": round(readiness, 1),
            },
        }

    @staticmethod
    def _get_date_window(req, today: date):
        """Return (start_date, end_date) for a requirement's frequency window."""
        freq = req.frequency.value if hasattr(req.frequency, 'value') else str(req.frequency)
        current_year = today.year

        if freq == RequirementFrequency.ONE_TIME.value:
            return None, None
        elif freq == RequirementFrequency.BIANNUAL.value:
            base_year = req.year if req.year else current_year
            return date(base_year - 1, 1, 1), date(base_year, 12, 31)
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
            yr = req.year if req.year else current_year
            return date(yr, 1, 1), date(yr, 12, 31)

    def _evaluate_requirement_status(
        self,
        requirement: TrainingRequirement,
        user_records: List[TrainingRecord],
        today: date,
        expiring_threshold: date,
        waivers: Optional[List[WaiverPeriod]] = None,
    ) -> Dict:
        """Evaluate a single requirement for a single member using type-aware matching."""
        req_type = requirement.requirement_type.value if hasattr(requirement.requirement_type, 'value') else str(requirement.requirement_type)
        start_date, end_date = self._get_date_window(requirement, today)
        not_started = {"status": "not_started", "expiration_date": None, "completion_date": None, "details": None}
        _waivers = waivers or []

        # Filter completed records within the date window
        completed = [r for r in user_records if r.status == TrainingStatus.COMPLETED]
        if start_date and end_date:
            windowed = [
                r for r in completed
                if r.completion_date and start_date <= r.completion_date <= end_date
            ]
        else:
            windowed = completed

        # ---- HOURS requirements: sum hours by training_type within date window ----
        if req_type == RequirementType.HOURS.value:
            type_matched = windowed
            if requirement.training_type:
                type_matched = [r for r in windowed if r.training_type == requirement.training_type]

            total_hours = sum(r.hours_completed or 0 for r in type_matched)
            required = requirement.required_hours or 0

            # Adjust required hours for waived months
            if required > 0 and start_date and end_date and _waivers:
                required, _, _ = adjust_required(required, start_date, end_date, _waivers, str(requirement.id))

            most_recent = max(type_matched, key=lambda r: r.completion_date or date.min) if type_matched else None
            if not most_recent:
                return not_started

            comp_date = most_recent.completion_date
            exp_date = most_recent.expiration_date
            details = f"{total_hours:.1f}/{required:.1f} hrs"

            if required > 0 and total_hours >= required:
                status = "current"
            elif total_hours > 0:
                status = "expiring_soon"  # partial progress shown as yellow
            else:
                return not_started

            # Check expiration on most recent record
            if exp_date and exp_date < today:
                status = "expired"
            elif exp_date and exp_date <= expiring_threshold and status == "current":
                status = "expiring_soon"

            return {
                "status": status,
                "expiration_date": exp_date.isoformat() if exp_date else None,
                "completion_date": comp_date.isoformat() if comp_date else None,
                "details": details,
            }

        # ---- COURSES requirements: check required course IDs ----
        if req_type == RequirementType.COURSES.value:
            course_ids = requirement.required_courses or []
            if not course_ids:
                return not_started
            completed_course_ids = {str(r.course_id) for r in windowed if r.course_id}
            matched_count = sum(1 for cid in course_ids if cid in completed_course_ids)
            most_recent = max(windowed, key=lambda r: r.completion_date or date.min) if windowed else None

            if matched_count >= len(course_ids):
                status = "current"
            elif matched_count > 0:
                status = "expiring_soon"
            else:
                return not_started

            comp_date = most_recent.completion_date if most_recent else None
            exp_date = most_recent.expiration_date if most_recent else None
            details = f"{matched_count}/{len(course_ids)} courses"
            return {
                "status": status,
                "expiration_date": exp_date.isoformat() if exp_date else None,
                "completion_date": comp_date.isoformat() if comp_date else None,
                "details": details,
            }

        # ---- CERTIFICATION requirements ----
        if req_type == RequirementType.CERTIFICATION.value:
            matching = [
                r for r in completed
                if (
                    (requirement.training_type and r.training_type == requirement.training_type)
                    or (r.course_name and requirement.name
                        and requirement.name.lower() in r.course_name.lower())
                    or (r.certification_number and requirement.registry_code
                        and requirement.registry_code.lower() in r.certification_number.lower())
                )
            ]
            if not matching:
                return not_started

            most_recent = max(matching, key=lambda r: r.completion_date or date.min)
            exp_date = most_recent.expiration_date
            comp_date = most_recent.completion_date
            details = None
            if most_recent.certification_number:
                details = f"#{most_recent.certification_number}"
                if most_recent.issuing_agency:
                    details += f" ({most_recent.issuing_agency})"

            if exp_date:
                if exp_date < today:
                    return {"status": "expired", "expiration_date": exp_date.isoformat(),
                            "completion_date": comp_date.isoformat() if comp_date else None, "details": details}
                elif exp_date <= expiring_threshold:
                    return {"status": "expiring_soon", "expiration_date": exp_date.isoformat(),
                            "completion_date": comp_date.isoformat() if comp_date else None, "details": details}

            return {"status": "current", "expiration_date": exp_date.isoformat() if exp_date else None,
                    "completion_date": comp_date.isoformat() if comp_date else None, "details": details}

        # ---- Fallback: shifts, calls, skills_evaluation, checklist, knowledge_test ----
        matching = []
        if requirement.training_type:
            matching = [r for r in windowed if r.training_type == requirement.training_type]
        if not matching and requirement.name:
            matching = [
                r for r in windowed
                if r.course_name and requirement.name.lower() in r.course_name.lower()
            ]

        if not matching:
            return not_started

        most_recent = max(matching, key=lambda r: r.completion_date or date.min)
        exp_date = most_recent.expiration_date
        comp_date = most_recent.completion_date
        details = None
        if most_recent.certification_number:
            details = f"#{most_recent.certification_number}"
            if most_recent.issuing_agency:
                details += f" ({most_recent.issuing_agency})"

        if exp_date:
            if exp_date < today:
                return {"status": "expired", "expiration_date": exp_date.isoformat(),
                        "completion_date": comp_date.isoformat() if comp_date else None, "details": details}
            elif exp_date <= expiring_threshold:
                return {"status": "expiring_soon", "expiration_date": exp_date.isoformat(),
                        "completion_date": comp_date.isoformat() if comp_date else None, "details": details}

        return {"status": "current", "expiration_date": exp_date.isoformat() if exp_date else None,
                "completion_date": comp_date.isoformat() if comp_date else None, "details": details}
