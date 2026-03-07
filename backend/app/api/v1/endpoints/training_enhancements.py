"""
Training Enhancement Endpoints

API endpoints for recertification pathways, competency tracking,
instructor qualifications, training effectiveness, multi-agency training,
report exports, document uploads, and xAPI ingestion.
"""

from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_current_user, require_permission
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.schemas.training_enhancements import (
    CompetencyMatrixCreate,
    CompetencyMatrixResponse,
    CompetencyMatrixUpdate,
    InstructorQualificationCreate,
    InstructorQualificationResponse,
    InstructorQualificationUpdate,
    MemberCompetencyResponse,
    MultiAgencyTrainingCreate,
    MultiAgencyTrainingResponse,
    MultiAgencyTrainingUpdate,
    RecertificationPathwayCreate,
    RecertificationPathwayResponse,
    RecertificationPathwayUpdate,
    RenewalTaskResponse,
    ReportExportRequest,
    TrainingEffectivenessCreate,
    TrainingEffectivenessResponse,
    XAPIBatchCreate,
    XAPIBatchResponse,
    XAPIStatementCreate,
    XAPIStatementResponse,
)
from app.services.training_enhancement_service import (
    CompetencyService,
    InstructorQualificationService,
    MultiAgencyService,
    RecertificationService,
    ReportExportService,
    TrainingEffectivenessService,
    XAPIService,
)

router = APIRouter()


# ============================================
# Recertification Pathways
# ============================================


@router.get(
    "/recertification/pathways", response_model=List[RecertificationPathwayResponse]
)
async def get_recertification_pathways(
    active_only: bool = Query(True),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Get all recertification pathways for the organization"""
    service = RecertificationService(db)
    pathways = await service.get_pathways(
        current_user.organization_id, active_only=active_only
    )
    return pathways


@router.post("/recertification/pathways", response_model=RecertificationPathwayResponse)
async def create_recertification_pathway(
    data: RecertificationPathwayCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_permission("training.manage")),
):
    """Create a new recertification pathway"""
    try:
        service = RecertificationService(db)
        pathway = await service.create_pathway(
            current_user.organization_id,
            data.model_dump(exclude_unset=True),
            str(current_user.id),
        )
        await db.commit()
        return pathway
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.patch(
    "/recertification/pathways/{pathway_id}",
    response_model=RecertificationPathwayResponse,
)
async def update_recertification_pathway(
    pathway_id: str,
    data: RecertificationPathwayUpdate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_permission("training.manage")),
):
    """Update a recertification pathway"""
    try:
        service = RecertificationService(db)
        pathway = await service.update_pathway(
            pathway_id,
            current_user.organization_id,
            data.model_dump(exclude_unset=True),
        )
        await db.commit()
        return pathway
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.get("/recertification/tasks/me", response_model=List[RenewalTaskResponse])
async def get_my_renewal_tasks(
    status: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Get renewal tasks for the current user"""
    service = RecertificationService(db)
    tasks = await service.get_user_renewal_tasks(
        str(current_user.id), current_user.organization_id, status=status
    )
    return tasks


@router.post("/recertification/generate-tasks")
async def generate_renewal_tasks(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_permission("training.manage")),
):
    """Scan for expiring certs and generate renewal tasks"""
    try:
        service = RecertificationService(db)
        count = await service.generate_renewal_tasks(current_user.organization_id)
        await db.commit()
        return {"tasks_created": count}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


# ============================================
# Competency Tracking
# ============================================


@router.get("/competency/matrices", response_model=List[CompetencyMatrixResponse])
async def get_competency_matrices(
    position: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Get competency matrices"""
    service = CompetencyService(db)
    matrices = await service.get_matrices(
        current_user.organization_id, position=position
    )
    return matrices


@router.post("/competency/matrices", response_model=CompetencyMatrixResponse)
async def create_competency_matrix(
    data: CompetencyMatrixCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_permission("training.manage")),
):
    """Create a competency matrix"""
    try:
        service = CompetencyService(db)
        matrix = await service.create_matrix(
            current_user.organization_id,
            data.model_dump(exclude_unset=True),
            str(current_user.id),
        )
        await db.commit()
        return matrix
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.patch(
    "/competency/matrices/{matrix_id}", response_model=CompetencyMatrixResponse
)
async def update_competency_matrix(
    matrix_id: str,
    data: CompetencyMatrixUpdate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_permission("training.manage")),
):
    """Update a competency matrix"""
    try:
        service = CompetencyService(db)
        matrix = await service.update_matrix(
            matrix_id,
            current_user.organization_id,
            data.model_dump(exclude_unset=True),
        )
        await db.commit()
        return matrix
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.get(
    "/competency/members/{user_id}", response_model=List[MemberCompetencyResponse]
)
async def get_member_competencies(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Get competency levels for a member"""
    service = CompetencyService(db)
    competencies = await service.get_member_competencies(
        user_id, current_user.organization_id
    )
    return competencies


@router.get("/competency/me", response_model=List[MemberCompetencyResponse])
async def get_my_competencies(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Get competency levels for the current user"""
    service = CompetencyService(db)
    competencies = await service.get_member_competencies(
        str(current_user.id), current_user.organization_id
    )
    return competencies


# ============================================
# Instructor Qualifications
# ============================================


@router.get(
    "/instructors/qualifications", response_model=List[InstructorQualificationResponse]
)
async def get_instructor_qualifications(
    user_id: Optional[str] = Query(None),
    course_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Get instructor qualifications"""
    service = InstructorQualificationService(db)
    quals = await service.get_qualifications(
        current_user.organization_id, user_id=user_id, course_id=course_id
    )
    return quals


@router.post(
    "/instructors/qualifications", response_model=InstructorQualificationResponse
)
async def create_instructor_qualification(
    data: InstructorQualificationCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_permission("training.manage")),
):
    """Create an instructor qualification"""
    try:
        service = InstructorQualificationService(db)
        qual = await service.create_qualification(
            current_user.organization_id,
            data.model_dump(exclude_unset=True),
            str(current_user.id),
        )
        await db.commit()
        return qual
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.patch(
    "/instructors/qualifications/{qual_id}",
    response_model=InstructorQualificationResponse,
)
async def update_instructor_qualification(
    qual_id: str,
    data: InstructorQualificationUpdate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_permission("training.manage")),
):
    """Update an instructor qualification"""
    try:
        service = InstructorQualificationService(db)
        qual = await service.update_qualification(
            qual_id,
            current_user.organization_id,
            data.model_dump(exclude_unset=True),
        )
        await db.commit()
        return qual
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.get(
    "/instructors/qualifications/{course_id}/qualified",
    response_model=List[InstructorQualificationResponse],
)
async def get_qualified_instructors(
    course_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Get all qualified instructors for a specific course"""
    service = InstructorQualificationService(db)
    quals = await service.get_qualified_instructors(
        course_id, current_user.organization_id
    )
    return quals


@router.get("/instructors/validate/{user_id}/{course_id}")
async def validate_instructor(
    user_id: str,
    course_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Check if a user is qualified to instruct a course"""
    service = InstructorQualificationService(db)
    is_qualified = await service.validate_instructor_for_session(
        user_id, course_id, current_user.organization_id
    )
    return {"user_id": user_id, "course_id": course_id, "is_qualified": is_qualified}


# ============================================
# Training Effectiveness
# ============================================


@router.post("/effectiveness/evaluations", response_model=TrainingEffectivenessResponse)
async def create_effectiveness_evaluation(
    data: TrainingEffectivenessCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Submit a training effectiveness evaluation"""
    try:
        service = TrainingEffectivenessService(db)
        evaluation = await service.create_evaluation(
            current_user.organization_id,
            {
                **data.model_dump(exclude_unset=True),
                "evaluated_by": str(current_user.id),
            },
        )
        await db.commit()
        return evaluation
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.get(
    "/effectiveness/evaluations", response_model=List[TrainingEffectivenessResponse]
)
async def get_effectiveness_evaluations(
    course_id: Optional[str] = Query(None),
    session_id: Optional[str] = Query(None),
    level: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Get training effectiveness evaluations"""
    service = TrainingEffectivenessService(db)
    evals = await service.get_evaluations(
        current_user.organization_id,
        course_id=course_id,
        session_id=session_id,
        level=level,
    )
    return evals


@router.get("/effectiveness/summary/{course_id}")
async def get_effectiveness_summary(
    course_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Get aggregate effectiveness metrics for a course"""
    service = TrainingEffectivenessService(db)
    summary = await service.get_course_effectiveness_summary(
        course_id, current_user.organization_id
    )
    return summary


# ============================================
# Multi-Agency Training
# ============================================


@router.get("/multi-agency", response_model=List[MultiAgencyTrainingResponse])
async def get_multi_agency_exercises(
    start_date: Optional[date] = Query(None),
    end_date: Optional[date] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Get multi-agency training exercises"""
    service = MultiAgencyService(db)
    exercises = await service.get_exercises(
        current_user.organization_id,
        start_date=start_date,
        end_date=end_date,
    )
    return exercises


@router.post("/multi-agency", response_model=MultiAgencyTrainingResponse)
async def create_multi_agency_exercise(
    data: MultiAgencyTrainingCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_permission("training.manage")),
):
    """Create a multi-agency training record"""
    try:
        service = MultiAgencyService(db)
        exercise = await service.create_exercise(
            current_user.organization_id,
            data.model_dump(exclude_unset=True),
            str(current_user.id),
        )
        await db.commit()
        return exercise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.patch("/multi-agency/{exercise_id}", response_model=MultiAgencyTrainingResponse)
async def update_multi_agency_exercise(
    exercise_id: str,
    data: MultiAgencyTrainingUpdate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_permission("training.manage")),
):
    """Update a multi-agency training record"""
    try:
        service = MultiAgencyService(db)
        exercise = await service.update_exercise(
            exercise_id,
            current_user.organization_id,
            data.model_dump(exclude_unset=True),
        )
        await db.commit()
        return exercise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


# ============================================
# xAPI / SCORM Ingestion
# ============================================


@router.post("/xapi/statements", response_model=XAPIStatementResponse)
async def ingest_xapi_statement(
    data: XAPIStatementCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_permission("training.manage")),
):
    """Ingest a single xAPI statement"""
    try:
        service = XAPIService(db)
        statement = await service.ingest_statement(
            current_user.organization_id,
            data.raw_statement,
            source_provider_id=(
                str(data.source_provider_id) if data.source_provider_id else None
            ),
        )
        await db.commit()
        return statement
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.post("/xapi/statements/batch", response_model=XAPIBatchResponse)
async def ingest_xapi_batch(
    data: XAPIBatchCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_permission("training.manage")),
):
    """Ingest a batch of xAPI statements"""
    try:
        service = XAPIService(db)
        result = await service.ingest_batch(
            current_user.organization_id,
            data.statements,
            source_provider_id=(
                str(data.source_provider_id) if data.source_provider_id else None
            ),
        )
        await db.commit()
        return result
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.post("/xapi/process")
async def process_xapi_statements(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_permission("training.manage")),
):
    """Process unprocessed xAPI statements into training records"""
    try:
        service = XAPIService(db)
        count = await service.process_unprocessed(current_user.organization_id)
        await db.commit()
        return {"processed": count}
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


# ============================================
# Report Exports
# ============================================


@router.post("/reports/export")
async def export_report(
    data: ReportExportRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_permission("training.manage")),
):
    """Generate and download a training report as CSV or PDF"""
    from fastapi.responses import StreamingResponse

    try:
        service = ReportExportService(db)

        if data.format == "pdf":
            if data.report_type == "individual":
                if not data.user_id:
                    raise ValueError(
                        "user_id is required for individual reports"
                    )
                pdf_buf = await service.generate_individual_pdf(
                    str(data.user_id),
                    current_user.organization_id,
                    start_date=data.start_date,
                    end_date=data.end_date,
                )
            else:
                pdf_buf = await service.generate_compliance_pdf(
                    current_user.organization_id,
                    start_date=data.start_date,
                    end_date=data.end_date,
                )
            filename = f"training_report_{data.report_type}.pdf"
            return StreamingResponse(
                pdf_buf,
                media_type="application/pdf",
                headers={
                    "Content-Disposition": f"attachment; filename={filename}"
                },
            )

        # CSV format (default)
        if data.report_type == "compliance":
            csv_content = await service.generate_compliance_csv(
                current_user.organization_id,
                start_date=data.start_date,
                end_date=data.end_date,
            )
        elif data.report_type == "individual":
            if not data.user_id:
                raise ValueError("user_id is required for individual reports")
            csv_content = await service.generate_individual_csv(
                str(data.user_id),
                current_user.organization_id,
                start_date=data.start_date,
                end_date=data.end_date,
            )
        else:
            # Default to compliance report for other types
            csv_content = await service.generate_compliance_csv(
                current_user.organization_id,
                start_date=data.start_date,
                end_date=data.end_date,
            )

        return Response(
            content=csv_content,
            media_type="text/csv",
            headers={
                "Content-Disposition": f"attachment; filename=training_report_{data.report_type}.csv"
            },
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


@router.get("/reports/compliance-forecast")
async def get_compliance_forecast(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_permission("training.manage")),
):
    """Get predictive compliance forecast for all members"""
    try:
        service = ReportExportService(db)
        forecasts = await service.generate_compliance_forecast(
            current_user.organization_id
        )
        return forecasts
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


# ============================================
# Document/Certificate Upload
# ============================================


@router.post("/records/{record_id}/attachments")
async def upload_record_attachment(
    record_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Upload a document/certificate for a training record.

    Note: This endpoint currently stores attachment metadata.
    Full file upload integration with MinIO/S3 should be configured
    in the deployment environment.
    """
    from sqlalchemy import select

    from app.models.training import TrainingRecord

    result = await db.execute(
        select(TrainingRecord)
        .where(TrainingRecord.id == record_id)
        .where(TrainingRecord.organization_id == current_user.organization_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Training record not found")

    # Placeholder: In production, this would accept multipart file upload
    # and store to MinIO/S3, returning the file URL
    return {
        "message": "Attachment endpoint ready. Configure MinIO/S3 for file storage.",
        "record_id": record_id,
        "current_attachments": record.attachments or [],
    }


@router.get("/records/{record_id}/attachments")
async def get_record_attachments(
    record_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Get attachments for a training record"""
    from sqlalchemy import select

    from app.models.training import TrainingRecord

    result = await db.execute(
        select(TrainingRecord)
        .where(TrainingRecord.id == record_id)
        .where(TrainingRecord.organization_id == current_user.organization_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Training record not found")

    return {"record_id": record_id, "attachments": record.attachments or []}
