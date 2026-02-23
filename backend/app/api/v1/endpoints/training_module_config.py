"""
Training Module Configuration API Endpoints

GET  /config          - Any authenticated member can read the visibility settings
PUT  /config          - Training officers can update the visibility settings
GET  /my-training     - Member's aggregated training data (respects visibility config)
"""

from fastapi import APIRouter, Depends, HTTPException
from loguru import logger
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from typing import Optional, Dict, Any, List
from datetime import date

from app.core.database import get_db
from app.api.dependencies import get_current_user, require_permission
from app.core.constants import TRAINING_OFFICER_ROLE_SLUGS
from app.models.user import User, UserStatus
from app.models.training import (
    TrainingRecord, TrainingStatus,
    TrainingRequirement,
    ProgramEnrollment, RequirementProgress,
    ShiftCompletionReport, TrainingSubmission,
    SubmissionStatus,
)
from app.services.training_waiver_service import fetch_user_waivers
from app.services.training_service import TrainingService
from app.schemas.training_module_config import (
    TrainingModuleConfigResponse,
    TrainingModuleConfigUpdate,
    MemberVisibilityResponse,
)
from app.services.training_module_config_service import TrainingModuleConfigService

router = APIRouter()


@router.get("/config", response_model=TrainingModuleConfigResponse)
async def get_training_module_config(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get training module configuration (any member)."""
    service = TrainingModuleConfigService(db)
    config = await service.get_config(current_user.organization_id)
    return config


@router.put("/config", response_model=TrainingModuleConfigResponse)
async def update_training_module_config(
    updates: TrainingModuleConfigUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("training.manage")),
):
    """Update training module configuration (training officers only)."""
    service = TrainingModuleConfigService(db)
    config = await service.update_config(
        organization_id=current_user.organization_id,
        updated_by=str(current_user.id),
        **updates.model_dump(exclude_unset=True),
    )
    return config


@router.get("/visibility", response_model=MemberVisibilityResponse)
async def get_member_visibility(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the member visibility flags (lightweight endpoint for frontend)."""
    service = TrainingModuleConfigService(db)
    visibility = await service.get_member_visibility(current_user.organization_id)
    return visibility


@router.get("/my-training")
async def get_my_training_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get the current member's aggregated training data.
    Respects the organization's visibility configuration.
    Officers always get the full dataset.
    """
    config_service = TrainingModuleConfigService(db)
    visibility = await config_service.get_member_visibility(current_user.organization_id)

    # Officers see everything — eagerly load roles to avoid MissingGreenlet
    is_officer = False
    user_with_roles = None
    try:
        user_result = await db.execute(
            select(User)
            .where(User.id == current_user.id)
            .options(selectinload(User.roles))
        )
        user_with_roles = user_result.scalar_one_or_none()
        if user_with_roles and user_with_roles.roles:
            role_names = [r.name for r in user_with_roles.roles]
            is_officer = any(r in role_names for r in TRAINING_OFFICER_ROLE_SLUGS)
    except Exception as e:
        logger.warning(f"Failed to check training officer role for user {current_user.id}: {e}")

    org_id = str(current_user.organization_id)
    user_id = str(current_user.id)
    result: Dict[str, Any] = {"visibility": visibility}

    # --- Training History ---
    if is_officer or visibility.get("show_training_history", True):
        records_result = await db.execute(
            select(TrainingRecord)
            .where(TrainingRecord.organization_id == str(org_id), TrainingRecord.user_id == str(user_id))
            .order_by(TrainingRecord.completion_date.desc())
            .limit(100)
        )
        records = records_result.scalars().all()

        result["training_records"] = [
            {
                "id": str(r.id),
                "course_name": r.course_name,
                "course_code": r.course_code,
                "training_type": r.training_type.value if hasattr(r.training_type, 'value') else str(r.training_type),
                "status": r.status.value if hasattr(r.status, 'value') else str(r.status),
                "completion_date": str(r.completion_date) if r.completion_date else None,
                "hours_completed": float(r.hours_completed) if r.hours_completed else 0,
                "expiration_date": str(r.expiration_date) if r.expiration_date else None,
                "instructor": r.instructor,
            }
            for r in records
        ]

    # --- Training Hours Summary (always returned for core stats) ---
    hours_result = await db.execute(
        select(
            func.count(TrainingRecord.id),
            func.coalesce(func.sum(TrainingRecord.hours_completed), 0),
        )
        .where(
            TrainingRecord.organization_id == org_id,
            TrainingRecord.user_id == user_id,
            TrainingRecord.status == TrainingStatus.COMPLETED,
        )
    )
    row = hours_result.one()
    result["hours_summary"] = {
        "total_records": row[0],
        "total_hours": float(row[1]),
        "completed_courses": row[0],
    }

    # --- Requirements Summary (always returned for core stats) ---
    # Include ALL active requirements, not just annual
    req_result = await db.execute(
        select(TrainingRequirement)
        .where(
            TrainingRequirement.organization_id == org_id,
            TrainingRequirement.active == True,  # noqa: E712
        )
    )
    all_requirements = req_result.scalars().all()

    # Filter to requirements applicable to this user (use eagerly-loaded roles)
    user_role_ids: List[str] = []
    try:
        if user_with_roles and user_with_roles.roles:
            user_role_ids = [str(r.id) for r in user_with_roles.roles]
    except Exception as e:
        logger.warning(f"Failed to load user role IDs for user {current_user.id}: {e}")

    applicable: List[Any] = []
    for req in all_requirements:
        if req.applies_to_all:
            applicable.append(req)
        elif req.required_roles and any(rid in user_role_ids for rid in req.required_roles):
            applicable.append(req)

    # --- Fetch active waivers + leaves of absence for this user ---
    user_waivers = await fetch_user_waivers(db, org_id, user_id)

    # --- Pre-fetch all training records for this user (no date filter —
    # the shared evaluator handles date windowing per requirement) ---
    all_records_result = await db.execute(
        select(TrainingRecord)
        .where(
            TrainingRecord.organization_id == org_id,
            TrainingRecord.user_id == user_id,
        )
    )
    member_records = list(all_records_result.scalars().all())

    # Evaluate every applicable requirement using the shared helper which
    # handles all requirement types (hours, courses, certification,
    # shifts, calls, fallback) and rolling period windows.
    today = date.today()
    met_count = 0
    total_progress_pct = 0.0
    requirements_detail: List[Dict[str, Any]] = []

    for req in applicable:
        detail = TrainingService.evaluate_requirement_detail(
            req, member_records, today, waivers=user_waivers,
        )
        pct = detail["progress_percentage"]
        total_progress_pct += pct
        if detail["is_met"]:
            met_count += 1
        requirements_detail.append(detail)

    total_reqs = len(applicable)
    avg_compliance = round(total_progress_pct / total_reqs, 1) if total_reqs > 0 else None

    result["requirements_summary"] = {
        "total_requirements": total_reqs,
        "met_requirements": met_count,
        "avg_compliance": avg_compliance,
    }

    result["requirements_detail"] = requirements_detail

    # --- Certification Status ---
    if is_officer or visibility.get("show_certification_status", True):
        cert_result = await db.execute(
            select(TrainingRecord)
            .where(
                TrainingRecord.organization_id == org_id,
                TrainingRecord.user_id == user_id,
                TrainingRecord.expiration_date.isnot(None),
            )
            .order_by(TrainingRecord.expiration_date.asc())
        )
        certs = cert_result.scalars().all()
        today = date.today()
        result["certifications"] = [
            {
                "id": str(c.id),
                "course_name": c.course_name,
                "certification_number": c.certification_number,
                "expiration_date": str(c.expiration_date) if c.expiration_date else None,
                "is_expired": c.expiration_date < today if c.expiration_date else False,
                "days_until_expiry": (c.expiration_date - today).days if c.expiration_date else None,
            }
            for c in certs
        ]

    # --- Pipeline Progress ---
    if is_officer or visibility.get("show_pipeline_progress", True):
        enrollments_result = await db.execute(
            select(ProgramEnrollment)
            .where(ProgramEnrollment.user_id == str(user_id))
            .order_by(ProgramEnrollment.enrolled_at.desc())
        )
        enrollments = enrollments_result.scalars().all()

        enrollment_list: List[Dict[str, Any]] = []
        for e in enrollments:
            entry: Dict[str, Any] = {
                "id": str(e.id),
                "program_id": str(e.program_id),
                "status": e.status.value if hasattr(e.status, 'value') else str(e.status),
                "progress_percentage": float(e.progress_percentage or 0),
                "enrolled_at": e.enrolled_at.isoformat() if e.enrolled_at else None,
                "target_completion_date": str(e.target_completion_date) if e.target_completion_date else None,
                "completed_at": e.completed_at.isoformat() if e.completed_at else None,
            }

            # Requirement details (if allowed)
            if is_officer or visibility.get("show_requirement_details", True):
                rp_result = await db.execute(
                    select(RequirementProgress).where(RequirementProgress.enrollment_id == str(e.id))
                )
                rps = rp_result.scalars().all()

                # Batch-fetch requirement names
                req_ids = [str(rp.requirement_id) for rp in rps]
                name_map: Dict[str, str] = {}
                if req_ids:
                    names_result = await db.execute(
                        select(TrainingRequirement.id, TrainingRequirement.name)
                        .where(TrainingRequirement.id.in_(req_ids))
                    )
                    name_map = {str(row[0]): row[1] for row in names_result.all()}

                entry["requirements"] = [
                    {
                        "id": str(rp.id),
                        "requirement_id": str(rp.requirement_id),
                        "requirement_name": name_map.get(str(rp.requirement_id), ""),
                        "status": rp.status.value if hasattr(rp.status, 'value') else str(rp.status),
                        "progress_value": float(rp.progress_value or 0),
                        "progress_percentage": float(rp.progress_percentage or 0),
                        "completed_at": rp.completed_at.isoformat() if rp.completed_at else None,
                    }
                    for rp in rps
                ]

            enrollment_list.append(entry)

        result["enrollments"] = enrollment_list

    # --- Shift Reports ---
    if is_officer or visibility.get("show_shift_reports", True):
        sr_result = await db.execute(
            select(ShiftCompletionReport)
            .where(
                ShiftCompletionReport.organization_id == org_id,
                ShiftCompletionReport.trainee_id == user_id,
            )
            .order_by(ShiftCompletionReport.shift_date.desc())
            .limit(50)
        )
        shift_reports = sr_result.scalars().all()

        sr_list = []
        for sr in shift_reports:
            entry: Dict[str, Any] = {
                "id": str(sr.id),
                "shift_date": str(sr.shift_date),
                "hours_on_shift": float(sr.hours_on_shift),
                "calls_responded": sr.calls_responded,
                "call_types": sr.call_types,
                "tasks_performed": sr.tasks_performed,
                "trainee_acknowledged": sr.trainee_acknowledged,
            }

            if is_officer or visibility.get("show_performance_rating", True):
                entry["performance_rating"] = sr.performance_rating
            if is_officer or visibility.get("show_areas_of_strength", True):
                entry["areas_of_strength"] = sr.areas_of_strength
            if is_officer or visibility.get("show_areas_for_improvement", True):
                entry["areas_for_improvement"] = sr.areas_for_improvement
            if is_officer or visibility.get("show_officer_narrative", True):
                entry["officer_narrative"] = sr.officer_narrative
            if is_officer or visibility.get("show_skills_observed", True):
                entry["skills_observed"] = sr.skills_observed

            sr_list.append(entry)

        result["shift_reports"] = sr_list

    # --- Shift Stats ---
    if is_officer or visibility.get("show_shift_stats", True):
        stats_result = await db.execute(
            select(
                func.count(ShiftCompletionReport.id),
                func.coalesce(func.sum(ShiftCompletionReport.hours_on_shift), 0),
                func.coalesce(func.sum(ShiftCompletionReport.calls_responded), 0),
                func.avg(ShiftCompletionReport.performance_rating),
            )
            .where(
                ShiftCompletionReport.organization_id == org_id,
                ShiftCompletionReport.trainee_id == user_id,
            )
        )
        srow = stats_result.one()
        result["shift_stats"] = {
            "total_shifts": srow[0],
            "total_hours": float(srow[1]),
            "total_calls": int(srow[2]),
            "avg_rating": round(float(srow[3]), 1) if srow[3] else None,
        }

    # --- Submission History ---
    if is_officer or visibility.get("show_submission_history", True):
        sub_result = await db.execute(
            select(TrainingSubmission)
            .where(
                TrainingSubmission.organization_id == org_id,
                TrainingSubmission.submitted_by == user_id,
            )
            .order_by(TrainingSubmission.submitted_at.desc())
            .limit(50)
        )
        submissions = sub_result.scalars().all()
        result["submissions"] = [
            {
                "id": str(s.id),
                "course_name": s.course_name,
                "training_type": s.training_type.value if hasattr(s.training_type, 'value') else str(s.training_type),
                "completion_date": str(s.completion_date) if s.completion_date else None,
                "hours_completed": float(s.hours_completed) if s.hours_completed else 0,
                "status": s.status.value if hasattr(s.status, 'value') else str(s.status),
                "submitted_at": s.submitted_at.isoformat() if s.submitted_at else None,
                "reviewed_at": s.reviewed_at.isoformat() if s.reviewed_at else None,
            }
            for s in submissions
        ]

    return result
