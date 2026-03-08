"""
Compliance Officer Services

Provides ISO readiness scoring, formal compliance attestation,
annual compliance report generation, and NFPA 1401 record completeness
validation for the compliance officer dashboard.
"""

import logging
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit_event
from app.core.utils import generate_uuid
from app.models.audit import AuditLog
from app.models.training import (
    InstructorQualification,
    MultiAgencyTraining,
    RecertificationPathway,
    RenewalTask,
    RenewalTaskStatus,
    TrainingEffectivenessEvaluation,
    TrainingRecord,
    TrainingRequirement,
    TrainingStatus,
)
from app.models.user import User, UserStatus
from app.services.training_compliance import evaluate_member_requirement
from app.services.training_waiver_service import fetch_org_waivers

logger = logging.getLogger(__name__)

# ISO/FSRS training hour requirements per category (annual, per member)
ISO_CATEGORIES = [
    {
        "name": "Company Training",
        "nfpa_standard": "NFPA 1001",
        "required_hours": 192,
        "training_types": [
            "fire_training",
            "structural_fire",
            "live_fire",
            "company_training",
            "fire_suppression",
            "search_and_rescue",
            "ventilation",
            "ladders",
            "hose_operations",
        ],
    },
    {
        "name": "Driver/Operator Training",
        "nfpa_standard": "NFPA 1002",
        "required_hours": 12,
        "training_types": [
            "driver_training",
            "apparatus_operations",
            "driver_operator",
            "emergency_vehicle_operations",
            "pump_operations",
        ],
    },
    {
        "name": "Officer Training",
        "nfpa_standard": "NFPA 1021",
        "required_hours": 12,
        "training_types": [
            "officer_development",
            "leadership",
            "officer_training",
            "command_training",
            "incident_command",
        ],
    },
    {
        "name": "Hazardous Materials",
        "nfpa_standard": "NFPA 472",
        "required_hours": 6,
        "training_types": [
            "hazmat",
            "hazardous_materials",
            "hazmat_awareness",
            "hazmat_operations",
        ],
    },
    {
        "name": "New Driver Training",
        "nfpa_standard": "NFPA 1451",
        "required_hours": 60,
        "training_types": [
            "new_driver",
        ],
    },
]


class ISOReadinessService:
    """Tracks department training hours against ISO/FSRS categories."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_iso_readiness(
        self, organization_id: str, year: Optional[int] = None
    ) -> Dict[str, Any]:
        """Assess ISO readiness based on training hours by category.

        Queries all completed TrainingRecords for the year, maps training_type
        values to ISO/FSRS categories, sums hours per category per member,
        and returns department averages and compliance percentages.
        """
        if year is None:
            year = date.today().year

        start_date = date(year, 1, 1)
        end_date = date(year, 12, 31)

        # Get active members (exclude compliance-exempt)
        members_result = await self.db.execute(
            select(User).where(
                User.organization_id == organization_id,
                User.status == UserStatus.ACTIVE,
                User.compliance_exempt == False,  # noqa: E712
                User.deleted_at.is_(None),
            )
        )
        members = members_result.scalars().all()
        total_members = len(members)

        if total_members == 0:
            return {
                "year": year,
                "categories": [],
                "overall_readiness_pct": 0.0,
                "iso_class_estimate": 10,
            }

        member_ids = {str(m.id) for m in members}

        # Get all completed training records for the year
        records_result = await self.db.execute(
            select(TrainingRecord).where(
                TrainingRecord.organization_id == organization_id,
                TrainingRecord.status == TrainingStatus.COMPLETED,
                TrainingRecord.completion_date >= start_date,
                TrainingRecord.completion_date <= end_date,
            )
        )
        records = records_result.scalars().all()

        # Build per-member, per-category hour totals
        categories_result: List[Dict[str, Any]] = []
        category_compliance_pcts: List[float] = []

        for cat in ISO_CATEGORIES:
            # Hours per member for this category
            member_hours: Dict[str, float] = {mid: 0.0 for mid in member_ids}

            for record in records:
                if record.user_id not in member_ids:
                    continue
                training_type = (
                    record.training_type.value
                    if hasattr(record.training_type, "value")
                    else str(record.training_type or "")
                )
                if training_type in cat["training_types"]:
                    member_hours[record.user_id] += record.hours_completed or 0

            total_hours = sum(member_hours.values())
            avg_hours = total_hours / total_members
            members_meeting = sum(
                1 for h in member_hours.values() if h >= cat["required_hours"]
            )
            compliance_pct = round(members_meeting / total_members * 100, 1)
            category_compliance_pcts.append(compliance_pct)

            categories_result.append(
                {
                    "name": cat["name"],
                    "nfpa_standard": cat["nfpa_standard"],
                    "required_hours": cat["required_hours"],
                    "avg_hours_completed": round(avg_hours, 1),
                    "members_meeting_requirement": members_meeting,
                    "total_members": total_members,
                    "compliance_pct": compliance_pct,
                }
            )

        # Overall readiness is average of category compliances
        overall_pct = (
            round(
                sum(category_compliance_pcts) / len(category_compliance_pcts),
                1,
            )
            if category_compliance_pcts
            else 0.0
        )

        # ISO class estimate based on overall readiness
        iso_class = self._estimate_iso_class(overall_pct)

        return {
            "year": year,
            "categories": categories_result,
            "overall_readiness_pct": overall_pct,
            "iso_class_estimate": iso_class,
        }

    @staticmethod
    def _estimate_iso_class(readiness_pct: float) -> int:
        """Estimate ISO Public Protection Classification (1-10) from readiness %.

        >95% = Class 1, >90% = Class 2, >80% = Class 3, >70% = Class 4, etc.
        """
        if readiness_pct >= 95:
            return 1
        elif readiness_pct >= 90:
            return 2
        elif readiness_pct >= 80:
            return 3
        elif readiness_pct >= 70:
            return 4
        elif readiness_pct >= 60:
            return 5
        elif readiness_pct >= 50:
            return 6
        elif readiness_pct >= 40:
            return 7
        elif readiness_pct >= 30:
            return 8
        elif readiness_pct >= 20:
            return 9
        else:
            return 10


class ComplianceAttestationService:
    """Manages formal compliance sign-off workflow via the audit log."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_attestation(
        self,
        organization_id: str,
        attestation_data: Dict[str, Any],
        attested_by: str,
    ) -> Dict[str, Any]:
        """Create a formal compliance attestation record via audit log.

        Parameters
        ----------
        organization_id : str
            The organization being attested.
        attestation_data : dict
            Must contain: period_type (annual|quarterly), period_year,
            compliance_percentage.
            Optional: period_quarter, notes, areas_reviewed (list[str]),
            exceptions (list[dict] with requirement_name, reason, mitigation).
        attested_by : str
            User ID of the attesting compliance officer.

        Raises
        ------
        ValueError
            If required fields are missing or invalid.
        """
        period_type = attestation_data.get("period_type")
        if period_type not in ("annual", "quarterly"):
            raise ValueError("period_type must be 'annual' or 'quarterly'")

        period_year = attestation_data.get("period_year")
        if not period_year:
            raise ValueError("period_year is required")

        if period_type == "quarterly":
            period_quarter = attestation_data.get("period_quarter")
            if period_quarter not in (1, 2, 3, 4):
                raise ValueError(
                    "period_quarter must be 1, 2, 3, or 4 for quarterly attestations"
                )

        compliance_pct = attestation_data.get("compliance_percentage")
        if compliance_pct is None:
            raise ValueError("compliance_percentage is required")

        attestation_id = generate_uuid()
        now = datetime.now(timezone.utc)

        event_data: Dict[str, Any] = {
            "attestation_id": attestation_id,
            "organization_id": organization_id,
            "period_type": period_type,
            "period_year": period_year,
            "period_quarter": attestation_data.get("period_quarter"),
            "compliance_percentage": compliance_pct,
            "notes": attestation_data.get("notes", ""),
            "areas_reviewed": attestation_data.get("areas_reviewed", []),
            "exceptions": attestation_data.get("exceptions", []),
            "attested_at": now.isoformat(),
            "attested_by": attested_by,
        }

        await log_audit_event(
            db=self.db,
            event_type="compliance_attestation",
            event_category="compliance",
            severity="info",
            event_data=event_data,
            user_id=attested_by,
        )

        return {
            "attestation_id": attestation_id,
            "created_at": now.isoformat(),
            **event_data,
        }

    async def get_attestation_history(
        self, organization_id: str, limit: int = 20
    ) -> List[Dict[str, Any]]:
        """Retrieve past compliance attestations from audit log.

        Since AuditLog does not have an organization_id column, we query by
        event_type and filter by organization_id stored inside event_data.
        """
        result = await self.db.execute(
            select(AuditLog)
            .where(AuditLog.event_type == "compliance_attestation")
            .order_by(AuditLog.timestamp.desc())
            .limit(limit * 5)  # over-fetch to allow org filtering in Python
        )
        logs = result.scalars().all()

        attestations: List[Dict[str, Any]] = []
        for log_entry in logs:
            data = log_entry.event_data or {}
            if data.get("organization_id") != organization_id:
                continue
            data["audit_log_id"] = log_entry.id
            data["timestamp"] = (
                log_entry.timestamp.isoformat() if log_entry.timestamp else None
            )
            attestations.append(data)
            if len(attestations) >= limit:
                break

        return attestations


class RecordCompletenessService:
    """NFPA 1401 training record completeness evaluation."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def evaluate_record_completeness(
        self,
        organization_id: str,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None,
    ) -> Dict[str, Any]:
        """Evaluate training record completeness per NFPA 1401.

        For each completed record in the date range, checks whether critical
        fields are populated: course_name, training_type, completion_date,
        hours_completed, instructor, location.

        Returns per-field fill rates, an overall completeness score, and
        whether the NFPA 1401 threshold (>=90%) is met.
        """
        if not end_date:
            end_date = date.today()
        if not start_date:
            start_date = date(end_date.year, 1, 1)

        records_result = await self.db.execute(
            select(TrainingRecord).where(
                TrainingRecord.organization_id == organization_id,
                TrainingRecord.status == TrainingStatus.COMPLETED,
                TrainingRecord.completion_date >= start_date,
                TrainingRecord.completion_date <= end_date,
            )
        )
        records = records_result.scalars().all()
        total = len(records)

        if total == 0:
            return {
                "total_records": 0,
                "fields": [],
                "overall_completeness_pct": 0.0,
                "nfpa_1401_compliant": False,
                "period_start": start_date.isoformat(),
                "period_end": end_date.isoformat(),
            }

        # Check each field -- location accepts either free-text or FK
        field_checks = [
            ("course_name", lambda r: bool(r.course_name)),
            ("training_type", lambda r: r.training_type is not None),
            ("completion_date", lambda r: r.completion_date is not None),
            (
                "hours_completed",
                lambda r: r.hours_completed is not None and r.hours_completed > 0,
            ),
            ("instructor", lambda r: bool(r.instructor)),
            ("location", lambda r: bool(r.location) or bool(r.location_id)),
        ]

        fields_result: List[Dict[str, Any]] = []
        fill_rates: List[float] = []

        for field_name, check_fn in field_checks:
            count = sum(1 for r in records if check_fn(r))
            fill_rate = round(count / total * 100, 1)
            fill_rates.append(fill_rate)
            fields_result.append(
                {
                    "field_name": field_name,
                    "records_with_value": count,
                    "fill_rate_pct": fill_rate,
                }
            )

        overall = round(sum(fill_rates) / len(fill_rates), 1) if fill_rates else 0.0

        return {
            "total_records": total,
            "fields": fields_result,
            "overall_completeness_pct": overall,
            "nfpa_1401_compliant": overall >= 90.0,
            "period_start": start_date.isoformat(),
            "period_end": end_date.isoformat(),
        }

    async def get_incomplete_records(
        self, organization_id: str, limit: int = 50
    ) -> List[Dict[str, Any]]:
        """Find training records missing critical fields (instructor, location, or hours).

        Returns list of dicts with record id, course_name, user_id, and
        missing_fields list.
        """
        records_result = await self.db.execute(
            select(TrainingRecord)
            .where(
                TrainingRecord.organization_id == organization_id,
                TrainingRecord.status == TrainingStatus.COMPLETED,
            )
            .order_by(TrainingRecord.completion_date.desc())
            .limit(500)  # Fetch more than limit to allow filtering
        )
        records = records_result.scalars().all()

        incomplete: List[Dict[str, Any]] = []
        for r in records:
            missing: List[str] = []
            if not r.instructor:
                missing.append("instructor")
            if not r.location and not r.location_id:
                missing.append("location")
            if not r.hours_completed or r.hours_completed <= 0:
                missing.append("hours_completed")
            if not r.course_name:
                missing.append("course_name")

            if missing:
                incomplete.append(
                    {
                        "id": str(r.id),
                        "course_name": r.course_name or "Unknown",
                        "user_id": str(r.user_id),
                        "completion_date": (
                            r.completion_date.isoformat() if r.completion_date else None
                        ),
                        "missing_fields": missing,
                    }
                )
                if len(incomplete) >= limit:
                    break

        return incomplete


class AnnualComplianceReportService:
    """Generates comprehensive annual compliance reports."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def generate_annual_report(
        self, organization_id: str, year: int
    ) -> Dict[str, Any]:
        """Collect all compliance data for *year* into one comprehensive report.

        Queries users, requirements, training records, recertification
        pathways/tasks, instructor qualifications, multi-agency exercises,
        and effectiveness evaluations.
        """
        start_date = date(year, 1, 1)
        end_date = date(year, 12, 31)
        today = date.today()

        # Get active members (exclude compliance-exempt)
        members_result = await self.db.execute(
            select(User).where(
                User.organization_id == organization_id,
                User.status == UserStatus.ACTIVE,
                User.compliance_exempt == False,  # noqa: E712
                User.deleted_at.is_(None),
            )
        )
        members = members_result.scalars().all()
        total_members = len(members)
        member_ids = [m.id for m in members]

        # Get active requirements
        reqs_result = await self.db.execute(
            select(TrainingRequirement).where(
                TrainingRequirement.organization_id == organization_id,
                TrainingRequirement.active == True,  # noqa: E712
            )
        )
        requirements = reqs_result.scalars().all()

        # Get completed training records for the year
        if member_ids:
            records_result = await self.db.execute(
                select(TrainingRecord).where(
                    TrainingRecord.organization_id == organization_id,
                    TrainingRecord.status == TrainingStatus.COMPLETED,
                    TrainingRecord.completion_date >= start_date,
                    TrainingRecord.completion_date <= end_date,
                    TrainingRecord.user_id.in_(member_ids),
                )
            )
            year_records = records_result.scalars().all()

            # All records (for compliance evaluation -- not date-filtered)
            all_records_result = await self.db.execute(
                select(TrainingRecord).where(
                    TrainingRecord.organization_id == organization_id,
                    TrainingRecord.user_id.in_(member_ids),
                )
            )
            all_records = all_records_result.scalars().all()
        else:
            year_records = []
            all_records = []

        # Build per-user record lookup
        records_by_user: Dict[str, list] = defaultdict(list)
        for r in all_records:
            records_by_user[r.user_id].append(r)

        year_records_by_user: Dict[str, list] = defaultdict(list)
        for r in year_records:
            year_records_by_user[r.user_id].append(r)

        # Fetch waivers
        waivers_by_user = await fetch_org_waivers(self.db, organization_id)

        # Evaluate member compliance
        fully_compliant = 0
        member_compliance: List[Dict[str, Any]] = []
        total_hours = 0.0
        total_certs_active = 0
        total_certs_expired = 0

        for member in members:
            user_records = records_by_user.get(member.id, [])
            user_year_records = year_records_by_user.get(member.id, [])
            user_waivers = waivers_by_user.get(str(member.id), [])

            hours = sum(r.hours_completed or 0 for r in user_year_records)
            total_hours += hours

            met_count = 0
            req_total = len(requirements)
            for req in requirements:
                status, _, _ = evaluate_member_requirement(
                    req, user_records, today, waivers=user_waivers
                )
                if status == "completed":
                    met_count += 1

            compliance_pct = (
                round(met_count / req_total * 100, 1) if req_total > 0 else 100.0
            )

            # Count certifications (active vs expired)
            certs = [
                r
                for r in user_records
                if r.certification_number and r.status == TrainingStatus.COMPLETED
            ]
            expired = sum(
                1 for r in certs if r.expiration_date and r.expiration_date < today
            )
            active = len(certs) - expired
            total_certs_active += active
            total_certs_expired += expired

            if met_count >= req_total and req_total > 0:
                fully_compliant += 1
                member_status = "compliant"
            elif compliance_pct >= 75:
                member_status = "at_risk"
            else:
                member_status = "non_compliant"

            name = (
                f"{member.first_name or ''} {member.last_name or ''}".strip()
                or "Unknown"
            )

            member_compliance.append(
                {
                    "user_id": str(member.id),
                    "name": name,
                    "compliance_pct": compliance_pct,
                    "hours_completed": round(hours, 1),
                    "requirements_met": met_count,
                    "requirements_total": req_total,
                    "expired_certifications": expired,
                    "status": member_status,
                }
            )

        overall_compliance_pct = (
            round(fully_compliant / total_members * 100, 1)
            if total_members > 0
            else 0.0
        )

        # Requirement analysis
        requirement_analysis: List[Dict[str, Any]] = []
        for req in requirements:
            req_compliant = 0
            for member in members:
                user_records = records_by_user.get(member.id, [])
                user_waivers = waivers_by_user.get(str(member.id), [])
                status, _, _ = evaluate_member_requirement(
                    req, user_records, today, waivers=user_waivers
                )
                if status == "completed":
                    req_compliant += 1

            req_type = (
                req.requirement_type.value
                if hasattr(req.requirement_type, "value")
                else str(req.requirement_type)
            )
            requirement_analysis.append(
                {
                    "requirement_id": str(req.id),
                    "name": req.name,
                    "type": req_type,
                    "members_compliant": req_compliant,
                    "members_total": total_members,
                    "compliance_pct": (
                        round(req_compliant / total_members * 100, 1)
                        if total_members > 0
                        else 0.0
                    ),
                }
            )

        # Recertification summary
        recert_summary = await self._get_recertification_summary(organization_id)

        # Instructor summary
        instructor_summary = await self._get_instructor_summary(organization_id, today)

        # Multi-agency summary
        multi_agency_summary = await self._get_multi_agency_summary(
            organization_id, start_date, end_date
        )

        # Effectiveness summary (scoped to the report year)
        effectiveness_summary = await self._get_effectiveness_summary(
            organization_id, year
        )

        # Record completeness (NFPA 1401)
        completeness_service = RecordCompletenessService(self.db)
        record_completeness = await completeness_service.evaluate_record_completeness(
            organization_id, start_date, end_date
        )

        # ISO readiness
        iso_service = ISOReadinessService(self.db)
        iso_data = await iso_service.get_iso_readiness(organization_id, year)

        # Extract per-field counts for the record_completeness section
        field_lookup: Dict[str, int] = {}
        for f in record_completeness.get("fields", []):
            field_lookup[f["field_name"]] = f["records_with_value"]

        return {
            "report_type": "annual_compliance",
            "organization_id": organization_id,
            "year": year,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "executive_summary": {
                "overall_compliance_pct": overall_compliance_pct,
                "total_members": total_members,
                "fully_compliant_members": fully_compliant,
                "total_training_hours": round(total_hours, 1),
                "total_certifications_active": total_certs_active,
                "total_certifications_expired": total_certs_expired,
                "iso_readiness_pct": iso_data.get("overall_readiness_pct", 0.0),
            },
            "member_compliance": member_compliance,
            "requirement_analysis": requirement_analysis,
            "recertification_summary": recert_summary,
            "instructor_summary": instructor_summary,
            "multi_agency_summary": multi_agency_summary,
            "effectiveness_summary": effectiveness_summary,
            "record_completeness": {
                "total_records": record_completeness["total_records"],
                "records_with_instructor": field_lookup.get("instructor", 0),
                "records_with_location": field_lookup.get("location", 0),
                "records_with_hours": field_lookup.get("hours_completed", 0),
                "records_with_certification": field_lookup.get("course_name", 0),
                "completeness_pct": record_completeness["overall_completeness_pct"],
            },
        }

    async def _get_recertification_summary(
        self, organization_id: str
    ) -> Dict[str, Any]:
        """Get recertification pathway and renewal task summary."""
        pathways_result = await self.db.execute(
            select(func.count()).where(
                RecertificationPathway.organization_id == organization_id,
                RecertificationPathway.active == True,  # noqa: E712
            )
        )
        active_pathways = pathways_result.scalar() or 0

        tasks_result = await self.db.execute(
            select(RenewalTask.status, func.count())
            .where(RenewalTask.organization_id == organization_id)
            .group_by(RenewalTask.status)
        )
        task_counts: Dict[str, int] = {}
        for row in tasks_result:
            status_val = row[0].value if hasattr(row[0], "value") else str(row[0])
            task_counts[status_val] = row[1]

        return {
            "active_pathways": active_pathways,
            "tasks_completed": task_counts.get(RenewalTaskStatus.COMPLETED.value, 0),
            "tasks_pending": task_counts.get(RenewalTaskStatus.PENDING.value, 0)
            + task_counts.get(RenewalTaskStatus.IN_PROGRESS.value, 0),
            "tasks_expired": task_counts.get(RenewalTaskStatus.EXPIRED.value, 0)
            + task_counts.get(RenewalTaskStatus.LAPSED.value, 0),
        }

    async def _get_instructor_summary(
        self, organization_id: str, today: date
    ) -> Dict[str, Any]:
        """Get instructor qualification summary."""
        quals_result = await self.db.execute(
            select(InstructorQualification).where(
                InstructorQualification.organization_id == organization_id,
            )
        )
        quals = quals_result.scalars().all()

        total_qualified = len(quals)
        active_instructors = sum(1 for q in quals if q.active)
        expiring = sum(
            1
            for q in quals
            if q.active
            and q.expiration_date
            and today <= q.expiration_date <= today + timedelta(days=90)
        )

        return {
            "total_qualified": total_qualified,
            "active_instructors": active_instructors,
            "expiring_qualifications": expiring,
        }

    async def _get_multi_agency_summary(
        self,
        organization_id: str,
        start_date: date,
        end_date: date,
    ) -> Dict[str, Any]:
        """Get multi-agency training exercise summary for the date range."""
        exercises_result = await self.db.execute(
            select(MultiAgencyTraining).where(
                MultiAgencyTraining.organization_id == organization_id,
                MultiAgencyTraining.exercise_date >= start_date,
                MultiAgencyTraining.exercise_date <= end_date,
            )
        )
        exercises = exercises_result.scalars().all()

        nims = sum(1 for e in exercises if e.nims_compliant)
        total_participants = sum(e.total_participants or 0 for e in exercises)

        return {
            "total_exercises": len(exercises),
            "nims_compliant_exercises": nims,
            "total_participants": total_participants,
        }

    async def _get_effectiveness_summary(
        self, organization_id: str, year: int
    ) -> Dict[str, Any]:
        """Get training effectiveness evaluation summary for the given year."""
        year_start = datetime(year, 1, 1, tzinfo=timezone.utc)
        year_end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)

        evals_result = await self.db.execute(
            select(TrainingEffectivenessEvaluation).where(
                TrainingEffectivenessEvaluation.organization_id == organization_id,
                TrainingEffectivenessEvaluation.created_at >= year_start,
                TrainingEffectivenessEvaluation.created_at < year_end,
            )
        )
        evals = evals_result.scalars().all()

        ratings = [e.overall_rating for e in evals if e.overall_rating is not None]
        gains = [
            e.knowledge_gain_percentage
            for e in evals
            if e.knowledge_gain_percentage is not None
        ]

        return {
            "total_evaluations": len(evals),
            "avg_reaction_rating": (
                round(sum(ratings) / len(ratings), 2) if ratings else None
            ),
            "avg_knowledge_gain": (
                round(sum(gains) / len(gains), 2) if gains else None
            ),
        }
