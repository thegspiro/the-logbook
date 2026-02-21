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
import calendar
from datetime import date

from app.core.database import get_db
from app.api.dependencies import get_current_user, require_permission
from app.core.constants import TRAINING_OFFICER_ROLE_SLUGS
from app.models.user import User, UserStatus
from app.models.training import (
    TrainingRecord, TrainingStatus,
    TrainingRequirement, RequirementFrequency,
    ProgramEnrollment, RequirementProgress,
    ShiftCompletionReport, TrainingSubmission,
    SubmissionStatus,
)
from app.services.training_waiver_service import (
    fetch_user_waivers, adjust_required,
)
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

    # Check progress for each applicable requirement
    today = date.today()
    current_year = today.year
    met_count = 0
    total_progress_pct = 0.0

    for req in applicable:
        freq = req.frequency.value if hasattr(req.frequency, 'value') else str(req.frequency)

        # Determine the evaluation window based on frequency
        if freq == "one_time":
            # One-time: no date window, just check if any completed record exists
            start_date = None
            end_date = None
        elif freq == "biannual":
            # Biannual: look at all records (no date window restriction) —
            # compliance is based on having a non-expired certification
            start_date = None
            end_date = None
        elif freq == "quarterly":
            # Quarterly: current quarter
            quarter_month = ((today.month - 1) // 3) * 3 + 1
            start_date = date(current_year, quarter_month, 1)
            end_month = quarter_month + 2
            end_year = current_year
            if end_month > 12:
                end_month -= 12
                end_year += 1
            end_day = calendar.monthrange(end_year, end_month)[1]
            end_date = date(end_year, end_month, end_day)
        elif freq == "monthly":
            # Monthly: current month
            start_date = date(current_year, today.month, 1)
            end_day = calendar.monthrange(current_year, today.month)[1]
            end_date = date(current_year, today.month, end_day)
        else:
            # Annual (default)
            start_date = date(req.year, 1, 1) if req.year else date(current_year, 1, 1)
            end_date = date(req.year, 12, 31) if req.year else date(current_year, 12, 31)

        req_hours_query = (
            select(func.coalesce(func.sum(TrainingRecord.hours_completed), 0))
            .where(
                TrainingRecord.organization_id == org_id,
                TrainingRecord.user_id == user_id,
                TrainingRecord.status == TrainingStatus.COMPLETED,
            )
        )
        # Apply date window (one_time has no window)
        if start_date and end_date:
            req_hours_query = req_hours_query.where(
                TrainingRecord.completion_date >= start_date,
                TrainingRecord.completion_date <= end_date,
            )
        if req.training_type:
            req_hours_query = req_hours_query.where(
                TrainingRecord.training_type == req.training_type
            )

        req_hours_result = await db.execute(req_hours_query)
        completed_hours = float(req_hours_result.scalar() or 0)

        required = req.required_hours or 0
        # Adjust required hours for waived months
        if required > 0 and start_date and end_date and user_waivers:
            adjusted_required, _, _ = adjust_required(
                required, start_date, end_date, user_waivers, str(req.id)
            )
        else:
            adjusted_required = required

        if adjusted_required > 0:
            pct = min(completed_hours / adjusted_required * 100, 100)
        else:
            pct = 100.0

        # For biannual requirements, check if the latest cert is expired.
        # Filter by training_type when set; otherwise match by requirement name
        # to avoid picking up an unrelated cert (e.g. CPR cert satisfying EMS req).
        if freq == "biannual":
            cert_q = (
                select(TrainingRecord.expiration_date)
                .where(
                    TrainingRecord.organization_id == org_id,
                    TrainingRecord.user_id == user_id,
                    TrainingRecord.status == TrainingStatus.COMPLETED,
                    TrainingRecord.expiration_date.isnot(None),
                )
                .order_by(TrainingRecord.expiration_date.desc())
                .limit(1)
            )
            if req.training_type:
                cert_q = cert_q.where(
                    TrainingRecord.training_type == req.training_type
                )
            elif req.name:
                # Fallback: match by course_name containing the requirement name
                cert_q = cert_q.where(
                    TrainingRecord.course_name.ilike(f"%{req.name}%")
                )
            cert_r = await db.execute(cert_q)
            latest_exp = cert_r.scalar_one_or_none()
            if not latest_exp or latest_exp < today:
                pct = 0.0  # Expired or missing cert — not met

        total_progress_pct += pct
        if pct >= 100:
            met_count += 1

    total_reqs = len(applicable)
    avg_compliance = round(total_progress_pct / total_reqs, 1) if total_reqs > 0 else None

    result["requirements_summary"] = {
        "total_requirements": total_reqs,
        "met_requirements": met_count,
        "avg_compliance": avg_compliance,
    }

    # --- Detailed Requirements Breakdown (always included) ---
    requirements_detail: List[Dict[str, Any]] = []
    for req in applicable:
        freq = req.frequency.value if hasattr(req.frequency, 'value') else str(req.frequency)

        # Determine evaluation window (same logic as summary above)
        if freq == "one_time":
            r_start_date = None
            r_end_date = None
        elif freq == "biannual":
            # Biannual: no date window restriction —
            # compliance is based on having a non-expired certification
            r_start_date = None
            r_end_date = None
        elif freq == "quarterly":
            quarter_month = ((today.month - 1) // 3) * 3 + 1
            r_start_date = date(current_year, quarter_month, 1)
            end_month = quarter_month + 2
            r_end_year = current_year
            if end_month > 12:
                end_month -= 12
                r_end_year += 1
            r_end_day = calendar.monthrange(r_end_year, end_month)[1]
            r_end_date = date(r_end_year, end_month, r_end_day)
        elif freq == "monthly":
            r_start_date = date(current_year, today.month, 1)
            r_end_day = calendar.monthrange(current_year, today.month)[1]
            r_end_date = date(current_year, today.month, r_end_day)
        else:
            r_start_date = date(req.year, 1, 1) if req.year else date(current_year, 1, 1)
            r_end_date = date(req.year, 12, 31) if req.year else date(current_year, 12, 31)

        rq_hours_query = (
            select(func.coalesce(func.sum(TrainingRecord.hours_completed), 0))
            .where(
                TrainingRecord.organization_id == org_id,
                TrainingRecord.user_id == user_id,
                TrainingRecord.status == TrainingStatus.COMPLETED,
            )
        )
        if r_start_date and r_end_date:
            rq_hours_query = rq_hours_query.where(
                TrainingRecord.completion_date >= r_start_date,
                TrainingRecord.completion_date <= r_end_date,
            )
        if req.training_type:
            rq_hours_query = rq_hours_query.where(
                TrainingRecord.training_type == req.training_type
            )

        rq_hours_result = await db.execute(rq_hours_query)
        rq_completed_hours = float(rq_hours_result.scalar() or 0)
        rq_base_required = req.required_hours or 0

        # Adjust for waivers
        rq_waived = 0
        rq_active = 0
        if rq_base_required > 0 and r_start_date and r_end_date and user_waivers:
            rq_adjusted, rq_waived, rq_active = adjust_required(
                rq_base_required, r_start_date, r_end_date, user_waivers, str(req.id)
            )
        else:
            rq_adjusted = rq_base_required

        rq_pct = min(rq_completed_hours / rq_adjusted * 100, 100) if rq_adjusted > 0 else 100.0

        # For biannual requirements, determine due date from the most recent
        # matching certification record's expiration date rather than a fixed
        # calendar window.  An expired certification means the requirement is
        # immediately overdue and should block activity (e.g., shift signups).
        effective_due_date = req.due_date if req.due_date else (r_end_date if r_end_date else None)
        cert_expired = False
        blocks_activity = False

        if freq == "biannual":
            # Find the most recent matching certification record
            cert_query = (
                select(TrainingRecord)
                .where(
                    TrainingRecord.organization_id == org_id,
                    TrainingRecord.user_id == user_id,
                    TrainingRecord.status == TrainingStatus.COMPLETED,
                    TrainingRecord.expiration_date.isnot(None),
                )
                .order_by(TrainingRecord.expiration_date.desc())
                .limit(1)
            )
            if req.training_type:
                cert_query = cert_query.where(
                    TrainingRecord.training_type == req.training_type
                )
            elif req.name:
                cert_query = cert_query.where(
                    TrainingRecord.course_name.ilike(f"%{req.name}%")
                )
            cert_result = await db.execute(cert_query)
            latest_cert = cert_result.scalar_one_or_none()

            if latest_cert and latest_cert.expiration_date:
                effective_due_date = latest_cert.expiration_date
                if latest_cert.expiration_date < today:
                    cert_expired = True
                    blocks_activity = True
                    # Override progress — expired cert means requirement is not met
                    rq_pct = 0.0
            else:
                # No certification record at all — overdue immediately
                effective_due_date = today
                cert_expired = True
                blocks_activity = True
                rq_pct = 0.0

        days_until_due = (effective_due_date - today).days if effective_due_date else None

        detail_entry: Dict[str, Any] = {
            "id": str(req.id),
            "name": req.name,
            "description": req.description,
            "frequency": freq,
            "training_type": req.training_type.value if req.training_type and hasattr(req.training_type, 'value') else (str(req.training_type) if req.training_type else None),
            "required_hours": rq_adjusted,
            "original_required_hours": rq_base_required,
            "completed_hours": rq_completed_hours,
            "progress_percentage": round(rq_pct, 1),
            "is_met": rq_pct >= 100 and not cert_expired,
            "due_date": str(effective_due_date) if effective_due_date else None,
            "days_until_due": days_until_due,
            "waived_months": rq_waived,
            "active_months": rq_active,
            "cert_expired": cert_expired,
            "blocks_activity": blocks_activity,
        }
        requirements_detail.append(detail_entry)

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
