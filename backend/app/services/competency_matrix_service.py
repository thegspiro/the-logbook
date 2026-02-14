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
)
from app.models.user import User, UserStatus


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
            .where(TrainingRequirement.organization_id == organization_id)
            .where(TrainingRequirement.active == True)
        )
        if requirement_ids:
            req_query = req_query.where(TrainingRequirement.id.in_(requirement_ids))
        req_result = await self.db.execute(req_query)
        requirements = list(req_result.scalars().all())

        # Get active members
        user_query = (
            select(User)
            .where(User.organization_id == organization_id)
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
            .where(TrainingRecord.organization_id == organization_id)
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
            statuses = {}

            for req in requirements:
                rid = str(req.id)
                status_info = self._evaluate_requirement_status(
                    req, user_records, today, expiring_threshold
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

    def _evaluate_requirement_status(
        self,
        requirement: TrainingRequirement,
        user_records: List[TrainingRecord],
        today: date,
        expiring_threshold: date,
    ) -> Dict:
        """Evaluate a single requirement for a single member."""

        # For certification requirements, look for matching records
        if requirement.requirement_type == RequirementType.CERTIFICATION:
            matching = [
                r for r in user_records
                if r.course_name and requirement.name
                and (
                    requirement.name.lower() in r.course_name.lower()
                    or (r.certification_number and requirement.registry_code
                        and requirement.registry_code.lower() in r.course_name.lower())
                )
            ]
        elif requirement.requirement_type == RequirementType.COURSES:
            course_ids = requirement.required_courses or []
            matching = [r for r in user_records if str(r.course_id) in course_ids]
        else:
            # For hours, shifts, calls — match by training type or category
            matching = [
                r for r in user_records
                if (requirement.training_type and r.training_type == requirement.training_type)
                or (r.course_name and requirement.name
                    and requirement.name.lower() in r.course_name.lower())
            ]

        if not matching:
            return {"status": "not_started", "expiration_date": None, "completion_date": None, "details": None}

        # Get most recent
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
                return {
                    "status": "expired",
                    "expiration_date": exp_date.isoformat(),
                    "completion_date": comp_date.isoformat() if comp_date else None,
                    "details": details,
                }
            elif exp_date <= expiring_threshold:
                return {
                    "status": "expiring_soon",
                    "expiration_date": exp_date.isoformat(),
                    "completion_date": comp_date.isoformat() if comp_date else None,
                    "details": details,
                }

        return {
            "status": "current",
            "expiration_date": exp_date.isoformat() if exp_date else None,
            "completion_date": comp_date.isoformat() if comp_date else None,
            "details": details,
        }
