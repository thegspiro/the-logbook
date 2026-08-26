"""
Training Module Configuration API Endpoints

GET  /config          - Any authenticated member can read the visibility settings
PUT  /config          - training.configure (or training.manage) to update them
GET  /my-training     - Member's aggregated training data (respects visibility config)
"""

from datetime import date, datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import StreamingResponse
from loguru import logger
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.dependencies import (
    get_current_user,
    require_permission,
    user_has_permission,
)
from app.core.constants import TRAINING_OFFICER_ROLE_SLUGS
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.training import (
    ProgramEnrollment,
    RequirementProgress,
    ShiftCompletionReport,
    SkillEvaluation,
    TrainingRecord,
    TrainingRequirement,
    TrainingStatus,
    TrainingSubmission,
)
from app.models.user import User
from app.schemas.training_module_config import (
    MEMBER_DISCLOSURE_FIELDS,
    MemberVisibilityResponse,
    TrainingModuleConfigResponse,
    TrainingModuleConfigUpdate,
)
from app.services.training_compliance import get_org_include_current_month
from app.services.training_module_config_service import TrainingModuleConfigService
from app.services.training_service import TrainingService
from app.services.training_waiver_service import fetch_user_waivers

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
    current_user: User = Depends(
        require_permission("training.configure", "training.manage")
    ),
):
    """Update training module configuration.

    ``training.configure`` is the grant this panel is really about — setting
    how much of an officer's assessment the assessed member may read. It is
    accepted alongside ``training.manage`` rather than replacing it so that a
    department's own customized position keeps the access it already had.

    It does **not** carry the rest of this schema. The same payload can switch
    shift reports off, rewrite the officer's report form, remap apparatus
    skills and change the review workflow — a Membership Coordinator holding
    only ``training.configure`` would otherwise be able to disable a system
    they deliberately do not administer.
    """
    requested = updates.model_dump(exclude_unset=True)
    beyond_disclosure = sorted(set(requested) - MEMBER_DISCLOSURE_FIELDS)
    if beyond_disclosure and not user_has_permission(current_user, "training.manage"):
        raise HTTPException(
            status_code=403,
            detail=(
                "training.manage is required to change these settings: "
                + ", ".join(beyond_disclosure)
            ),
        )

    service = TrainingModuleConfigService(db)
    config = await service.update_config(
        organization_id=current_user.organization_id,
        updated_by=str(current_user.id),
        **requested,
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
    visibility = await config_service.get_member_visibility(
        current_user.organization_id
    )

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
            # Slugs, not names. This compared TRAINING_OFFICER_ROLE_SLUGS
            # against Position.name until 2026-08-26 — the seeded names are
            # "Training Officer" and "Fire Chief", so the check was
            # unconditionally False on every installation and a training
            # officer opening /my-training got the plain member's visibility
            # policy: their own history, hours and narrative hidden from them.
            role_slugs = [r.slug for r in user_with_roles.roles]
            is_officer = any(r in role_slugs for r in TRAINING_OFFICER_ROLE_SLUGS)
    except Exception as e:
        logger.warning(
            f"Failed to check training officer role for user {current_user.id}: {e}"
        )

    # Report what this caller may actually see, not the raw org policy. Every
    # branch below reads `is_officer or flag`, and the page then re-applies
    # the same flags client-side — so an officer, exempt on the server, still
    # had the sections hidden from them. One source of truth instead: the
    # officer exemption is folded in here and the page just honours what it
    # receives.
    #
    # `allow_member_report_export` is deliberately not folded in: the export
    # endpoint has no officer exemption either (officers export through the
    # reports screen), so flipping it would offer a button that 403s.
    if is_officer:
        visibility = {
            key: (True if key.startswith("show_") else value)
            for key, value in visibility.items()
        }

    org_id = str(current_user.organization_id)
    user_id = str(current_user.id)
    result: dict[str, Any] = {"visibility": visibility}

    # --- Training History ---
    if is_officer or visibility.get("show_training_history", True):
        records_result = await db.execute(
            select(TrainingRecord)
            .where(
                TrainingRecord.organization_id == str(org_id),
                TrainingRecord.user_id == str(user_id),
            )
            .order_by(TrainingRecord.completion_date.desc())
            .limit(100)
        )
        records = records_result.scalars().all()

        result["training_records"] = [
            {
                "id": str(r.id),
                "course_name": r.course_name,
                "course_code": r.course_code,
                "training_type": (
                    r.training_type.value
                    if hasattr(r.training_type, "value")
                    else str(r.training_type)
                ),
                "status": (
                    r.status.value if hasattr(r.status, "value") else str(r.status)
                ),
                "completion_date": (
                    str(r.completion_date) if r.completion_date else None
                ),
                "hours_completed": float(r.hours_completed) if r.hours_completed else 0,
                "expiration_date": (
                    str(r.expiration_date) if r.expiration_date else None
                ),
                "instructor": r.instructor,
            }
            for r in records
        ]

    # --- Training Hours Summary (always returned for core stats) ---
    hours_result = await db.execute(
        select(
            func.count(TrainingRecord.id),
            func.coalesce(func.sum(TrainingRecord.hours_completed), 0),
        ).where(
            TrainingRecord.organization_id == org_id,
            TrainingRecord.user_id == user_id,
            TrainingRecord.status == TrainingStatus.COMPLETED,
        )
    )
    row = hours_result.one()

    # Month-to-date alongside the lifetime figure. The dashboard's hours
    # summary is labelled "This month" and adds training to standby and
    # administrative hours; without this it had only the lifetime total to
    # use, so the headline number summed a lifetime figure with two monthly
    # ones and meant nothing. `total_hours` stays lifetime — that is the right
    # reading for "my training record", which is what this endpoint is.
    month_start = datetime.now(timezone.utc).replace(
        day=1, hour=0, minute=0, second=0, microsecond=0
    )
    month_result = await db.execute(
        select(
            func.coalesce(func.sum(TrainingRecord.hours_completed), 0),
        ).where(
            TrainingRecord.organization_id == org_id,
            TrainingRecord.user_id == user_id,
            TrainingRecord.status == TrainingStatus.COMPLETED,
            TrainingRecord.completion_date >= month_start.date(),
        )
    )
    # The counts stay regardless — "how many courses have I completed" is
    # history, not hours, and the page's core stat row needs it. Only the two
    # hour figures answer to ``show_training_hours``; a department that hides
    # them must not have them handed back through the same payload.
    hours_summary: dict[str, Any] = {
        "total_records": row[0],
        "completed_courses": row[0],
    }
    if is_officer or visibility.get("show_training_hours", True):
        hours_summary["total_hours"] = float(row[1])
        hours_summary["hours_this_month"] = float(month_result.scalar() or 0)
    result["hours_summary"] = hours_summary

    # --- Requirements Summary (always returned for core stats) ---
    # Include ALL active requirements, not just annual
    req_result = await db.execute(
        select(TrainingRequirement).where(
            TrainingRequirement.organization_id == org_id,
            TrainingRequirement.active == True,  # noqa: E712
        )
    )
    all_requirements = req_result.scalars().all()

    # Filter to requirements applicable to this user (use eagerly-loaded roles)
    user_role_ids: list[str] = []
    try:
        if user_with_roles and user_with_roles.roles:
            user_role_ids = [str(r.id) for r in user_with_roles.roles]
    except Exception as e:
        logger.warning(f"Failed to load user role IDs for user {current_user.id}: {e}")

    user_membership_type = getattr(current_user, "membership_type", None) or "active"
    applicable: list[Any] = []
    for req in all_requirements:
        if req.applies_to_all:
            applicable.append(req)
        elif (
            req.required_membership_types
            and user_membership_type in req.required_membership_types
        ):
            applicable.append(req)
        elif req.required_roles and any(
            rid in user_role_ids for rid in req.required_roles
        ):
            applicable.append(req)

    # --- Fetch active waivers + leaves of absence for this user ---
    user_waivers = await fetch_user_waivers(db, org_id, user_id)

    # --- Pre-fetch all training records for this user (no date filter —
    # the shared evaluator handles date windowing per requirement) ---
    all_records_result = await db.execute(
        select(TrainingRecord).where(
            TrainingRecord.organization_id == org_id,
            TrainingRecord.user_id == user_id,
        )
    )
    member_records = list(all_records_result.scalars().all())

    # Evaluate every applicable requirement using the shared helper which
    # handles all requirement types (hours, courses, certification,
    # shifts, calls, fallback) and rolling period windows.
    today = date.today()
    org_include_current = await get_org_include_current_month(db, str(org_id))
    met_count = 0
    total_progress_pct = 0.0
    requirements_detail: list[dict[str, Any]] = []

    for req in applicable:
        detail = TrainingService.evaluate_requirement_detail(
            req,
            member_records,
            today,
            waivers=user_waivers,
            org_include_current_month=org_include_current,
        )
        pct = detail["progress_percentage"]
        total_progress_pct += pct
        if detail["is_met"]:
            met_count += 1
        requirements_detail.append(detail)

    total_reqs = len(applicable)
    avg_compliance = (
        round(total_progress_pct / total_reqs, 1) if total_reqs > 0 else None
    )

    result["requirements_summary"] = {
        "total_requirements": total_reqs,
        "met_requirements": met_count,
        "avg_compliance": avg_compliance,
    }

    # ``cert_expired`` and ``blocks_activity`` exist only to surface a lapsed
    # certification, so hiding certification status has to hide them too —
    # otherwise the requirements list keeps rendering "Certification expired —
    # renew ASAP" for a department that switched certification status off.
    # The requirement still reports itself as unmet, with its progress bar, so
    # what the member loses is the reason rather than the fact.
    if not is_officer and not visibility.get("show_certification_status", True):
        for detail in requirements_detail:
            detail.pop("cert_expired", None)
            detail.pop("blocks_activity", None)

    # The *summary* (an average compliance percentage) is the core stat and
    # always goes back. The per-requirement breakdown is what
    # ``show_requirement_details`` names, and until now only the copy nested
    # inside Pipeline Progress honoured it while this one — hours, due dates,
    # overdue-by-N-days — was returned to everybody.
    if is_officer or visibility.get("show_requirement_details", True):
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
                "expiration_date": (
                    str(c.expiration_date) if c.expiration_date else None
                ),
                "is_expired": c.expiration_date < today if c.expiration_date else False,
                "days_until_expiry": (
                    (c.expiration_date - today).days if c.expiration_date else None
                ),
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

        enrollment_list: list[dict[str, Any]] = []
        for e in enrollments:
            entry: dict[str, Any] = {
                "id": str(e.id),
                "program_id": str(e.program_id),
                "status": (
                    e.status.value if hasattr(e.status, "value") else str(e.status)
                ),
                "progress_percentage": float(e.progress_percentage or 0),
                "enrolled_at": e.enrolled_at.isoformat() if e.enrolled_at else None,
                "target_completion_date": (
                    str(e.target_completion_date) if e.target_completion_date else None
                ),
                "completed_at": e.completed_at.isoformat() if e.completed_at else None,
            }

            # Requirement details (if allowed)
            if is_officer or visibility.get("show_requirement_details", True):
                rp_result = await db.execute(
                    select(RequirementProgress).where(
                        RequirementProgress.enrollment_id == str(e.id)
                    )
                )
                rps = rp_result.scalars().all()

                # Batch-fetch requirement names
                req_ids = [str(rp.requirement_id) for rp in rps]
                name_map: dict[str, str] = {}
                if req_ids:
                    names_result = await db.execute(
                        select(TrainingRequirement.id, TrainingRequirement.name).where(
                            TrainingRequirement.id.in_(req_ids)
                        )
                    )
                    name_map = {str(row[0]): row[1] for row in names_result.all()}

                entry["requirements"] = [
                    {
                        "id": str(rp.id),
                        "requirement_id": str(rp.requirement_id),
                        "requirement_name": name_map.get(str(rp.requirement_id), ""),
                        "status": (
                            rp.status.value
                            if hasattr(rp.status, "value")
                            else str(rp.status)
                        ),
                        "progress_value": float(rp.progress_value or 0),
                        "progress_percentage": float(rp.progress_percentage or 0),
                        "completed_at": (
                            rp.completed_at.isoformat() if rp.completed_at else None
                        ),
                    }
                    for rp in rps
                ]

            enrollment_list.append(entry)

        result["enrollments"] = enrollment_list

    # A report is visible to its trainee only once it is approved. The other
    # member-facing reader of this data — ``/shift-completion/my-*`` — passes
    # ``released_only=True`` for exactly this reason; these two queries did
    # not, so a department running ``report_review_required`` showed the
    # trainee draft, pending and flagged reports anyway. ``review_status``
    # defaults to "approved", so a department not using review is unaffected.
    released_only = (
        [] if is_officer else [ShiftCompletionReport.review_status == "approved"]
    )

    # --- Shift Reports ---
    if is_officer or visibility.get("show_shift_reports", True):
        sr_result = await db.execute(
            select(ShiftCompletionReport)
            .where(
                ShiftCompletionReport.organization_id == org_id,
                ShiftCompletionReport.trainee_id == user_id,
                *released_only,
            )
            .order_by(ShiftCompletionReport.shift_date.desc())
            .limit(50)
        )
        shift_reports = sr_result.scalars().all()

        sr_list = []
        for sr in shift_reports:
            entry: dict[str, Any] = {
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
            # Alone among these, the narrative's column default is False —
            # candid officer prose is opt-in, so the fallback has to match.
            if is_officer or visibility.get("show_officer_narrative", False):
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
            ).where(
                ShiftCompletionReport.organization_id == org_id,
                ShiftCompletionReport.trainee_id == user_id,
                *released_only,
            )
        )
        srow = stats_result.one()
        # Counted from ShiftCompletionReport, so these are shifts actually
        # worked and hours actually reported — not the scheduled figures the
        # scheduling module reports under similar names.
        result["shift_stats"] = {
            "shifts_completed": srow[0],
            "hours_reported": float(srow[1]),
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
                "training_type": (
                    s.training_type.value
                    if hasattr(s.training_type, "value")
                    else str(s.training_type)
                ),
                "completion_date": (
                    str(s.completion_date) if s.completion_date else None
                ),
                "hours_completed": float(s.hours_completed) if s.hours_completed else 0,
                "status": (
                    s.status.value if hasattr(s.status, "value") else str(s.status)
                ),
                "submitted_at": s.submitted_at.isoformat() if s.submitted_at else None,
                "reviewed_at": s.reviewed_at.isoformat() if s.reviewed_at else None,
            }
            for s in submissions
        ]

    return result


@router.get("/my-training/export")
async def export_my_training(
    format: str = Query("csv", pattern=r"^(csv|pdf)$"),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Download the current member's own training history as CSV or PDF.

    Gated by the organization's ``allow_member_report_export`` setting so that
    officers control whether members may export their own records, and by the
    same visibility flags the page honours — an export is not a way around
    them. Omitting ``start_date`` returns the member's entire history (e.g.
    for an outside audit or a prospective employer).
    """
    config_service = TrainingModuleConfigService(db)
    config = await config_service.get_config(current_user.organization_id)
    if not config.allow_member_report_export:
        raise HTTPException(
            status_code=403,
            detail="Member training export is disabled for this organization.",
        )

    # The export is the training history, so it has to answer to the same
    # flags the page does — otherwise enabling export hands back in a CSV
    # exactly what ``show_training_history`` was set to withhold.
    if not config.show_training_history:
        raise HTTPException(
            status_code=403,
            detail=(
                "Your department does not make training history visible to "
                "members, so it cannot be exported."
            ),
        )

    from app.services.training_enhancement_service import ReportExportService

    export_service = ReportExportService(db)
    user_id = str(current_user.id)
    include_certifications = bool(config.show_certification_status)

    try:
        if format == "pdf":
            pdf_buf = await export_service.generate_individual_pdf(
                user_id,
                current_user.organization_id,
                start_date=start_date,
                end_date=end_date,
                include_certifications=include_certifications,
            )
            return StreamingResponse(
                pdf_buf,
                media_type="application/pdf",
                headers={
                    "Content-Disposition": (
                        "attachment; filename=my_training_record.pdf"
                    )
                },
            )

        csv_content = await export_service.generate_individual_csv(
            user_id,
            current_user.organization_id,
            start_date=start_date,
            end_date=end_date,
            include_certifications=include_certifications,
        )
        return Response(
            content=csv_content,
            media_type="text/csv",
            headers={
                "Content-Disposition": ("attachment; filename=my_training_record.csv")
            },
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.get("/skill-names")
async def get_skill_evaluation_names(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("training.configure", "training.manage")
    ),
):
    """Return a list of active SkillEvaluation names.

    Used by the settings panel to show which apparatus-type
    skill names match formal SkillEvaluation records.
    """
    result = await db.execute(
        select(
            SkillEvaluation.id,
            SkillEvaluation.name,
            SkillEvaluation.category,
        )
        .where(
            SkillEvaluation.organization_id == str(current_user.organization_id),
            SkillEvaluation.active == True,  # noqa: E712
        )
        .order_by(SkillEvaluation.name)
    )
    return [
        {
            "id": row.id,
            "name": row.name,
            "category": row.category,
        }
        for row in result.all()
    ]
