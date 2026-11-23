"""
Training Enhancement Endpoints

API endpoints for recertification pathways, competency tracking,
instructor qualifications, training effectiveness, multi-agency training,
report exports, document uploads, and xAPI ingestion.
"""

from datetime import date, datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import (
    can_view_officer_training_data,
    get_current_user,
    require_permission,
)
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.schemas.training_enhancements import (
    CompetencyHeatmapResponse,
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
from app.services import file_storage_service as file_storage
from app.services import member_files
from app.services.document_provenance import preparer_label, report_number_for
from app.services.file_storage_service import (
    FileRules,
    FileStorageService,
    StorageArea,
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
from app.utils.training_attachments import new_entry_id, resolve_entry

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


@router.get("/competency/department", response_model=CompetencyHeatmapResponse)
async def get_department_competencies(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_permission("training.manage")),
):
    """Every active member's competency levels, for the readiness heat-map.

    Officer-only for the same reason as the per-member read: competency levels
    are member training PII.

    **Requires permission: training.manage**
    """
    service = CompetencyService(db)
    return await service.get_department_competencies(str(current_user.organization_id))


@router.get(
    "/competency/members/{user_id}", response_model=List[MemberCompetencyResponse]
)
async def get_member_competencies(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_permission("training.manage")),
):
    """Get competency levels for a member.

    Officer-only: competency levels are member training PII. Members read their
    own via GET /competency/me.
    """
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
    current_user=Depends(require_permission("training.view_all", "training.manage")),
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
    current_user=Depends(require_permission("training.view_all", "training.manage")),
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
    current_user=Depends(require_permission("training.view_all", "training.manage")),
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
                # Evaluations submitted by members are always self-scoped.
                "user_id": str(current_user.id),
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
    """Get training effectiveness evaluations.

    Non-officers are confined to their own submitted evaluations — these
    carry free-text comments/ratings members would not expect coworkers to
    read, the same PII class ``get_member_competencies`` gates. Holders of
    ``training.manage`` or ``training.view_all`` see the whole organization.
    """
    is_officer = can_view_officer_training_data(current_user)
    service = TrainingEffectivenessService(db)
    evals = await service.get_evaluations(
        current_user.organization_id,
        course_id=course_id,
        session_id=session_id,
        level=level,
        user_id=None if is_officer else str(current_user.id),
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
    current_user=Depends(require_permission("training.view_all", "training.manage")),
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
    except ValueError as e:
        await db.rollback()
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
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


async def _audit_training_export(
    db: AsyncSession,
    current_user,
    data: ReportExportRequest,
    report_number: Optional[str] = None,
) -> None:
    """Record who exported which training report. These files carry member
    names, contact details and certification numbers, so an export is a
    disclosure the audit trail must show. Ids and parameters only; never the
    report's content."""
    await log_audit_event(
        db=db,
        event_type="training_report_exported",
        event_category="training",
        severity="info",
        event_data={
            "report_type": data.report_type,
            "format": data.format,
            "subject_user_id": str(data.user_id) if data.user_id else None,
            "start_date": data.start_date.isoformat() if data.start_date else None,
            "end_date": data.end_date.isoformat() if data.end_date else None,
            # Printed on every page of the PDF, so a page traces back here.
            "report_number": report_number,
        },
        user_id=str(current_user.id),
        organization_id=str(current_user.organization_id),
    )


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
            report_number = await report_number_for(db, current_user.organization_id)
            prepared_by = await preparer_label(db, current_user)
            if data.report_type == "individual":
                if not data.user_id:
                    raise ValueError("user_id is required for individual reports")
                pdf_buf = await service.generate_individual_pdf(
                    str(data.user_id),
                    current_user.organization_id,
                    start_date=data.start_date,
                    end_date=data.end_date,
                    generated_by=prepared_by,
                    report_number=report_number,
                )
            elif data.report_type == "member_records":
                pdf_buf = await service.generate_bulk_pdf(
                    current_user.organization_id,
                    start_date=data.start_date,
                    end_date=data.end_date,
                    generated_by=prepared_by,
                    report_number=report_number,
                )
            elif data.report_type == "compliance":
                pdf_buf = await service.generate_compliance_pdf(
                    current_user.organization_id,
                    start_date=data.start_date,
                    end_date=data.end_date,
                    generated_by=prepared_by,
                    report_number=report_number,
                )
            else:
                raise ValueError(
                    f"PDF export is not available for report type "
                    f"'{data.report_type}'."
                )
            await _audit_training_export(db, current_user, data, report_number)
            filename = f"training_report_{data.report_type}.pdf"
            return StreamingResponse(
                pdf_buf,
                media_type="application/pdf",
                headers={"Content-Disposition": f'attachment; filename="{filename}"'},
            )

        # CSV format (default)
        if data.report_type == "compliance":
            chunks = await service.stream_compliance_csv(
                current_user.organization_id,
                start_date=data.start_date,
                end_date=data.end_date,
            )
        elif data.report_type == "individual":
            if not data.user_id:
                raise ValueError("user_id is required for individual reports")
            chunks = await service.stream_individual_csv(
                str(data.user_id),
                current_user.organization_id,
                start_date=data.start_date,
                end_date=data.end_date,
            )
        elif data.report_type == "member_records":
            chunks = await service.stream_bulk_csv(
                current_user.organization_id,
                start_date=data.start_date,
                end_date=data.end_date,
            )
        elif data.report_type == "hours_summary":
            chunks = await service.stream_hours_summary_csv(
                current_user.organization_id,
                start_date=data.start_date,
                end_date=data.end_date,
            )
        elif data.report_type == "certification":
            chunks = await service.stream_certification_csv(
                current_user.organization_id,
                end_date=data.end_date,
            )
        else:
            raise ValueError(
                f"Report type '{data.report_type}' is not supported for export."
            )

        await _audit_training_export(db, current_user, data)
        # Streamed a member (or a batch of records) at a time (AH-16); the
        # request's session stays open until the body has been sent.
        return StreamingResponse(
            chunks,
            media_type="text/csv",
            headers={
                "Content-Disposition": (
                    f'attachment; filename="training_report_{data.report_type}.csv"'
                )
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
    """Each member's compliance forecast and the department's averages.

    ``{"members": [...], "averages": {current, days_30, days_60, days_90}}``,
    each average ``{"pct", "standing"}`` classified by the department's
    thresholds (``ComplianceForecastReport``).
    """
    try:
        service = ReportExportService(db)
        return await service.generate_compliance_forecast_report(
            current_user.organization_id
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=safe_error_detail(e))


# ============================================
# Document/Certificate Upload
# ============================================


# Certificates/documents attached to a training record. Validated, malware-
# scanned and stored by FileStorageService under the organization's
# training-records area.
RECORD_ATTACHMENT_RULES = FileRules(
    allowed_types={
        "application/pdf": ".pdf",
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "application/msword": ".doc",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": (
            ".docx"
        ),
    },
    max_bytes=25 * 1024 * 1024,
    description="PDF, Word, or image files",
)


async def _load_record_for_attachment(
    db: AsyncSession, record_id: str, current_user, *, for_update: bool = False
):
    """Fetch a training record in the caller's org, enforcing attachment access.

    The record owner may manage their own attachments; everyone else needs
    ``training.manage``. ``for_update`` makes it a locking read that refreshes
    an instance already loaded, for a path that writes the list back.
    """
    from sqlalchemy import select

    from app.api.dependencies import _collect_user_permissions, _has_permission
    from app.models.training import TrainingRecord

    query = (
        select(TrainingRecord)
        .where(TrainingRecord.id == record_id)
        .where(TrainingRecord.organization_id == current_user.organization_id)
    )
    if for_update:
        query = query.with_for_update().execution_options(populate_existing=True)
    result = await db.execute(query)
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Training record not found")

    if str(record.user_id) != str(current_user.id) and not _has_permission(
        "training.manage", _collect_user_permissions(current_user)
    ):
        raise HTTPException(
            status_code=403,
            detail="Not authorized to access this record's attachments.",
        )
    return record


@router.post("/records/{record_id}/attachments")
async def upload_record_attachment(
    record_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Upload and store a document/certificate for a training record."""
    from sqlalchemy.orm.attributes import flag_modified

    record = await _load_record_for_attachment(db, record_id, current_user)

    # A void is final, as update_record holds: evidence added afterwards would
    # sit on a record the department removed, behind the member's notice.
    if record.voided_at is not None:
        raise HTTPException(
            status_code=400,
            detail="A voided training record can't take new attachments",
        )

    stored = await FileStorageService(db).store_upload(
        file,
        organization_id=current_user.organization_id,
        area=StorageArea.TRAINING_RECORDS,
        rules=RECORD_ATTACHMENT_RULES,
        user=current_user,
        record_id=record.id,
        upload_kind="training_record_attachment",
    )
    file_path = stored.path

    # Stored and scanned outside any lock. Re-read the record locked before
    # writing the list back, so a void, a retention sweep or another upload
    # committed meanwhile is seen rather than overwritten.
    record = await _load_record_for_attachment(
        db, record_id, current_user, for_update=True
    )
    if record.voided_at is not None:
        await db.rollback()
        await file_storage.delete_quietly(file_path)
        raise HTTPException(
            status_code=400,
            detail="A voided training record can't take new attachments",
        )

    attachment = {
        "id": new_entry_id(),
        "file_name": stored.original_name,
        "file_path": file_path,
        "file_type": stored.mime_type,
        "file_size": stored.size,
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "uploaded_by": str(current_user.id),
    }
    # Plain JSON column — reassign so SQLAlchemy detects the change
    # (CLAUDE.md pitfall #12).
    record.attachments = list(record.attachments or []) + [attachment]
    flag_modified(record, "attachments")

    try:
        await db.commit()
        await db.refresh(record)
    except Exception as e:
        await file_storage.delete_quietly(file_path)
        raise HTTPException(status_code=400, detail=safe_error_detail(e))

    return {
        "record_id": record_id,
        "attachments": _sanitize_attachments(record, current_user),
    }


def _holds_training_manage(user) -> bool:
    from app.api.dependencies import _collect_user_permissions, _has_permission

    return _has_permission("training.manage", _collect_user_permissions(user))


def _removal_refusal(record, entry, user) -> tuple[int, str] | None:
    """Why *user* may not remove *entry* from *record*, or None if they may.

    Owner decision 2026-11-21 (d), the one definition both the removal route
    and the list's ``can_remove`` read (pitfall #29):

    * a voided record keeps its files, as an upload to one is refused;
    * a certificate an approval copied onto the record is the evidence the
      approval rests on: it leaves with the submission's retention, or with
      anonymisation or a permanent delete, never from here. Checked first,
      because the self-reports tree is nested in the legacy records tree;
    * ``training.manage`` may remove any other file uploaded to the record;
    * the record's member may remove a file they uploaded themselves. An entry
      that predates ``uploaded_by`` is an officer's to remove.
    """
    if record.voided_at is not None:
        return 400, "A voided training record keeps its attachments."
    if member_files.confined_attachment_path(
        entry, record.organization_id, StorageArea.SELF_REPORTS
    ):
        return (
            400,
            "This certificate came with an approved self-report, and stays on "
            "the record with that approval.",
        )
    uploaded_by = entry.get("uploaded_by") if isinstance(entry, dict) else None
    if str(record.user_id) == str(user.id) and uploaded_by == str(user.id):
        return None
    if _holds_training_manage(user):
        return None
    return 403, "You can only remove a file you uploaded yourself."


def _sanitize_attachments(record, user) -> list:
    """Strip server file paths; expose only client-safe metadata, the entry's
    id, its index, and whether this caller may remove it."""
    return [
        {
            "index": i,
            "id": a.get("id") if isinstance(a, dict) else None,
            "file_name": a.get("file_name") if isinstance(a, dict) else a,
            "file_type": a.get("file_type") if isinstance(a, dict) else None,
            "file_size": a.get("file_size") if isinstance(a, dict) else None,
            "uploaded_at": a.get("uploaded_at") if isinstance(a, dict) else None,
            "can_remove": bool(
                isinstance(a, dict)
                and a.get("id")
                and _removal_refusal(record, a, user) is None
            ),
        }
        for i, a in enumerate(record.attachments or [])
    ]


@router.get("/records/{record_id}/attachments")
async def get_record_attachments(
    record_id: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """List attachments for a training record (metadata only, no file paths)."""
    record = await _load_record_for_attachment(db, record_id, current_user)
    return {
        "record_id": record_id,
        "attachments": _sanitize_attachments(record, current_user),
    }


@router.get("/records/{record_id}/attachments/{entry}/download")
async def download_record_attachment(
    record_id: str,
    entry: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Stream a stored training-record attachment.

    ``entry`` is the attachment's id, or, for clients written against the
    older route, its index (a string of digits).
    """
    record = await _load_record_for_attachment(db, record_id, current_user)
    found = resolve_entry(record.attachments, entry)
    if found is None:
        raise HTTPException(status_code=404, detail="Attachment not found")

    attachment = found[1]
    if not isinstance(attachment, dict) or not attachment.get("file_path"):
        raise HTTPException(status_code=404, detail="Attachment file unavailable")

    from app.utils import download_names

    # Confine the stored path to *this record's organization*. file_path
    # round-trips through a JSON column, and a root-level check would still
    # serve a path pointing at another organization's directory. Two areas,
    # because approving a self-reported submission copies its attachment dicts
    # onto the record verbatim, so an approved certificate lives in the
    # self-reports area.
    real_path = file_storage.resolve(
        attachment["file_path"],
        record.organization_id,
        StorageArea.TRAINING_RECORDS,
        StorageArea.SELF_REPORTS,
    )
    if not real_path:
        raise HTTPException(status_code=404, detail="Attachment file not found")

    if not await file_storage.exists(real_path):
        raise HTTPException(status_code=404, detail="Attachment file not found")

    filename = download_names.descriptive_filename(
        record.completion_date,
        await download_names.member_name_for(
            db, record.user_id, record.organization_id
        ),
        record.course_name,
        extension=download_names.stored_extension(real_path),
        fallback=download_names.original_stem(attachment.get("file_name"))
        or "certificate",
    )
    return await file_storage.file_response(
        real_path,
        media_type=attachment.get("file_type") or "application/octet-stream",
        filename=filename,
    )


@router.delete("/records/{record_id}/attachments/{entry}", status_code=204)
async def delete_record_attachment(
    record_id: str,
    entry: str,
    expected_id: Optional[str] = Query(
        default=None,
        description=(
            "With a legacy index: the id the client believes is at that "
            "index. A mismatch answers 409 and changes nothing."
        ),
    ),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Remove a file uploaded to a training record.

    Owner decision 2026-11-21: an officer holding training.manage may remove
    any file uploaded to the record, and the record's member a file they
    uploaded themselves. A certificate an approval copied onto the record, and
    any file on a voided record, stays. ``entry`` is the attachment's id;
    removing one that is no longer there answers 204 and changes nothing, so a
    retry is safe. A string of digits is a legacy index, which takes
    ``expected_id``. The file itself goes after the commit, and only if no
    other row still names it.
    """
    from sqlalchemy.orm.attributes import flag_modified

    from app.services.upload_relocation import areas_for
    from app.utils.training_attachments import (
        EntryMoved,
        parse_entry_ref,
        resolve_entry,
    )

    # Locked, so the read and the write below are one decision against an
    # upload, a void or a retention sweep committed meanwhile (pitfall #27).
    record = await _load_record_for_attachment(
        db, record_id, current_user, for_update=True
    )
    try:
        found = resolve_entry(record.attachments, entry, expected_id)
    except EntryMoved:
        raise HTTPException(
            status_code=409,
            detail="The attachment list has changed. Reload it and try again.",
        )
    if found is None:
        if parse_entry_ref(entry).index is not None:
            raise HTTPException(status_code=404, detail="Attachment not found")
        return None

    index, removed = found
    refusal = _removal_refusal(record, removed, current_user)
    if refusal is not None:
        raise HTTPException(status_code=refusal[0], detail=refusal[1])

    attachments = list(record.attachments or [])
    attachments.pop(index)
    record.attachments = attachments
    flag_modified(record, "attachments")
    await db.flush()
    # Ids only: a file name is the uploader's text and can name the member.
    await log_audit_event(
        db=db,
        event_type="training_record_attachment_removed",
        event_category="training",
        severity="info",
        event_data={
            "record_id": str(record.id),
            "entry_id": removed.get("id") if isinstance(removed, dict) else None,
            "target_user_id": str(record.user_id),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    await db.commit()

    removed_path = member_files.confined_attachment_path(
        removed, record.organization_id, StorageArea.TRAINING_RECORDS
    )
    if removed_path:
        await member_files.remove_unreferenced_files(
            db,
            str(record.organization_id),
            {removed_path},
            subject_id=f"training record {record_id}",
            areas=areas_for(StorageArea.TRAINING_RECORDS),
        )
    return None
