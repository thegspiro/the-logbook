"""
Historical Data Import API

An IT administrator uploads a previous system's export, says which column
means what and which columns hold which kind of hours, reviews how every row
was routed and cleaned up, and sends the shift and on-call rows on to the shift
history import as review batches. A per-row log records where each row
stands.

Mounted at ``/api/v1/integrations/historical-imports`` behind the integrations
module gate. Every route requires ``integrations.historical_import``, which no
default role holds: only the IT Manager (System Owner) has it unless a
department grants it on purpose.
"""

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import StreamingResponse

from app.api.dependencies import require_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.user import User
from app.schemas.historical_import import (
    AdminPreview,
    AdminSettingsUpdate,
    HistoricalImportDetail,
    HistoricalImportListResponse,
    HistoricalImportSettingsUpdate,
    HistoricalImportSummary,
    MemberMappingsUpdate,
    OpenBatchesDiscarded,
    ShiftBatchesCreated,
)
from app.services.historical_import_service import (
    HistoricalImportLocked,
    HistoricalImportNotFound,
    HistoricalImportNotReady,
    HistoricalImportService,
    batch_view,
    summary_view,
)
from app.services.shift_history_import_service import decode_upload
from app.services.upload_scanning import reject_if_malicious
from app.utils.csv_export import SafeCsvChunks
from app.utils.upload_limits import read_upload_limited

router = APIRouter()

# A whole department's history exported from a database runs to tens of
# megabytes; the request body cap above this is 60MB.
MAX_HISTORICAL_CSV_BYTES = 40 * 1024 * 1024


def _http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, HistoricalImportNotFound):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, (HistoricalImportLocked, HistoricalImportNotReady)):
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, ValueError):
        return HTTPException(status_code=400, detail=safe_error_detail(exc))
    return HTTPException(status_code=500, detail=safe_error_detail(exc))


@router.get("", response_model=HistoricalImportListResponse)
async def list_imports(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.historical_import")),
):
    service = HistoricalImportService(db)
    records = await service.list_imports(str(current_user.organization_id))
    return {"imports": [summary_view(r) for r in records]}


@router.post(
    "",
    response_model=HistoricalImportSummary,
    status_code=status.HTTP_201_CREATED,
)
async def upload_import(
    file: UploadFile = File(...),
    source_system: str = Form(..., min_length=1, max_length=100),
    timezone: Optional[str] = Form(None, max_length=64),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.historical_import")),
):
    """Store an uploaded export. Nothing is written anywhere else.

    ``source_system`` names the system the file came from; re-importing the
    same system's export later must use the same name, so its rows are
    recognised. ``timezone`` defaults to the department's.
    """
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are accepted")
    try:
        contents = await read_upload_limited(file, MAX_HISTORICAL_CSV_BYTES)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="CSV file exceeds the 40MB limit.",
        )
    await reject_if_malicious(
        db,
        contents,
        upload_kind="historical_import",
        detected_mime=None,
        user=current_user,
    )
    service = HistoricalImportService(db)
    try:
        record = await service.create(
            str(current_user.organization_id),
            str(current_user.id),
            file.filename,
            decode_upload(contents),
            source_system,
            timezone,
        )
    except Exception as exc:
        raise _http_error(exc)
    await log_audit_event(
        db=db,
        event_type="historical_import_uploaded",
        event_category="integrations",
        severity="INFO",
        event_data={
            "organization_id": str(current_user.organization_id),
            "import_id": record.id,
            "filename": record.source_filename,
            "source_system": record.source_system,
            "row_count": record.row_count,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return summary_view(record)


@router.get(
    "/{import_id}",
    response_model=HistoricalImportDetail,
    response_model_by_alias=True,
)
async def get_import(
    import_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.historical_import")),
):
    """The import with its settings, how its rows route, and its batches."""
    service = HistoricalImportService(db)
    try:
        record = await service.get(str(current_user.organization_id), str(import_id))
        return await service.detail(record)
    except Exception as exc:
        raise _http_error(exc)


@router.patch(
    "/{import_id}",
    response_model=HistoricalImportDetail,
    response_model_by_alias=True,
)
async def update_import_settings(
    import_id: UUID,
    payload: HistoricalImportSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.historical_import")),
):
    """Change the source system name, time zone, or how columns are read."""
    org = str(current_user.organization_id)
    service = HistoricalImportService(db)
    try:
        record = await service.get(org, str(import_id), for_update=True)
        await service.update_settings(
            record,
            source_system=payload.source_system,
            timezone_name=payload.timezone,
            column_mapping=payload.column_mapping,
            hour_columns=payload.hour_columns,
            call_columns=payload.call_columns,
        )
        record = await service.get(org, str(import_id))
        return await service.detail(record)
    except Exception as exc:
        raise _http_error(exc)


@router.post(
    "/{import_id}/shift-batches",
    response_model=ShiftBatchesCreated,
    status_code=status.HTTP_201_CREATED,
)
async def create_shift_batches(
    import_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.historical_import")),
):
    """Send the shift and on-call rows to shift review, in month batches.

    Nothing is written to the schedule until each batch is committed on the
    shift history import screen.
    """
    org = str(current_user.organization_id)
    service = HistoricalImportService(db)
    try:
        batches = await service.create_shift_batches(
            org, str(import_id), str(current_user.id)
        )
    except Exception as exc:
        raise _http_error(exc)
    await log_audit_event(
        db=db,
        event_type="historical_import_shift_batches_created",
        event_category="integrations",
        severity="INFO",
        event_data={
            "organization_id": org,
            "import_id": str(import_id),
            "batch_ids": [b.id for b in batches],
            "row_count": sum(b.row_count for b in batches),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return {"batches": [batch_view(b) for b in batches]}


@router.delete("/{import_id}/shift-batches", response_model=OpenBatchesDiscarded)
async def discard_open_shift_batches(
    import_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.historical_import")),
):
    """Throw away the shift batches still in review. Committed batches stay."""
    org = str(current_user.organization_id)
    service = HistoricalImportService(db)
    try:
        discarded = await service.discard_open_batches(org, str(import_id))
    except Exception as exc:
        raise _http_error(exc)
    await log_audit_event(
        db=db,
        event_type="historical_import_shift_batches_discarded",
        event_category="integrations",
        severity="INFO",
        event_data={
            "organization_id": org,
            "import_id": str(import_id),
            "discarded": discarded,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return {"discarded": discarded}


@router.get("/{import_id}/log")
async def download_log(
    import_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.historical_import")),
):
    """A CSV with one line per record each row became, and where it stands."""
    service = HistoricalImportService(db)
    try:
        record = await service.get(str(current_user.organization_id), str(import_id))
        lines = await service.log_rows(record)
    except Exception as exc:
        raise _http_error(exc)

    def stream():
        chunks = SafeCsvChunks()
        for count, line in enumerate(lines, start=1):
            chunks.writerow(line)
            if count % 1000 == 0:
                yield chunks.drain()
        yield chunks.drain()

    return StreamingResponse(
        stream(),
        media_type="text/csv",
        headers={
            "Content-Disposition": 'attachment; filename="historical_import_log.csv"'
        },
    )


@router.delete("/{import_id}", status_code=status.HTTP_204_NO_CONTENT)
async def discard_import(
    import_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.historical_import")),
):
    """Delete the import and its batches still in review.

    Batches already committed are kept, and so is the ledger of the rows they
    wrote: what they imported is ordinary data now.
    """
    org = str(current_user.organization_id)
    service = HistoricalImportService(db)
    try:
        discarded = await service.discard(org, str(import_id))
    except Exception as exc:
        raise _http_error(exc)
    await log_audit_event(
        db=db,
        event_type="historical_import_discarded",
        event_category="integrations",
        severity="INFO",
        event_data={
            "organization_id": org,
            "import_id": str(import_id),
            "open_batches_discarded": discarded,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )


@router.get("/{import_id}/admin", response_model=AdminPreview)
async def get_admin_preview(
    import_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.historical_import")),
):
    """What committing the administrative rows would write, and what stops it."""
    service = HistoricalImportService(db)
    try:
        record = await service.get(str(current_user.organization_id), str(import_id))
        return await service.admin_preview(record)
    except Exception as exc:
        raise _http_error(exc)


@router.put("/{import_id}/admin-settings", response_model=AdminPreview)
async def update_admin_settings(
    import_id: UUID,
    payload: AdminSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.historical_import")),
):
    """Set which columns describe an entry and which category each row takes."""
    org = str(current_user.organization_id)
    service = HistoricalImportService(db)
    try:
        record = await service.get(org, str(import_id), for_update=True)
        await service.update_admin_settings(record, payload.model_dump())
        return await service.admin_preview(await service.get(org, str(import_id)))
    except Exception as exc:
        raise _http_error(exc)


@router.put("/{import_id}/members", response_model=AdminPreview)
async def update_member_mappings(
    import_id: UUID,
    payload: MemberMappingsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.historical_import")),
):
    """Decide who a member is, or create them as an archived former member."""
    org = str(current_user.organization_id)
    service = HistoricalImportService(db)
    members = {
        key: (value.model_dump(exclude_none=True) if value is not None else None)
        for key, value in payload.members.items()
    }
    try:
        record = await service.get(org, str(import_id), for_update=True)
        await service.update_member_mappings(record, members)
        return await service.admin_preview(await service.get(org, str(import_id)))
    except Exception as exc:
        raise _http_error(exc)


@router.post("/{import_id}/admin/commit", response_model=AdminPreview)
async def commit_admin_hours(
    import_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("integrations.historical_import")),
):
    """Write the administrative rows as approved Admin Hours entries. Rows
    already imported are skipped; there is no batch undo."""
    org = str(current_user.organization_id)
    service = HistoricalImportService(db)
    try:
        counts = await service.commit_admin(org, str(import_id), str(current_user.id))
    except Exception as exc:
        raise _http_error(exc)
    await log_audit_event(
        db=db,
        event_type="historical_import_admin_hours_committed",
        event_category="integrations",
        severity="INFO",
        event_data={"organization_id": org, "import_id": str(import_id), **counts},
        user_id=str(current_user.id),
        username=current_user.username,
    )
    try:
        return await service.admin_preview(await service.get(org, str(import_id)))
    except Exception as exc:
        raise _http_error(exc)
