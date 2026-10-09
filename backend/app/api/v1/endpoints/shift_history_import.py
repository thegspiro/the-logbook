"""
Shift History Import API

A scheduling officer uploads a spreadsheet of past shifts (one row per member
per shift), reviews how the rows were read, matched and grouped, settles what
the import could not decide on its own, and commits. The commit writes
finalized shifts with attendance — or outside-agency hours — that count toward
hours and shift compliance exactly as recorded shifts do.

A draft is stored, so a large file can be cleaned over several sittings.
A committed import is final; its shifts are corrected one at a time.

Mounted at ``/api/v1/scheduling/history-import`` behind the scheduling module
gate. Every route requires ``scheduling.manage``.
"""

import io
from typing import Any, Dict, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import StreamingResponse

from app.api.dependencies import require_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.user import User
from app.schemas.shift_history_import import (
    ShiftHistoryImportDetail,
    ShiftHistoryImportListResponse,
    ShiftHistoryImportMappingsUpdate,
    ShiftHistoryImportRowUpdate,
    ShiftHistoryImportSettingsUpdate,
    ShiftHistoryImportSummary,
)
from app.services.shift_history_import_service import (
    ImportNotDraft,
    ImportNotFound,
    ImportNotReady,
    ShiftHistoryImportService,
    decode_upload,
    summary_view,
    template_csv,
)
from app.services.upload_scanning import reject_if_malicious
from app.utils.csv_export import SafeCsvWriter
from app.utils.upload_limits import read_upload_limited

router = APIRouter()

MAX_SHIFT_HISTORY_CSV_BYTES = 10 * 1024 * 1024


def _http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, ImportNotFound):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, (ImportNotDraft, ImportNotReady)):
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, ValueError):
        return HTTPException(status_code=400, detail=safe_error_detail(exc))
    return HTTPException(status_code=500, detail=safe_error_detail(exc))


@router.get("/template")
async def download_template(
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """A CSV header row in the columns the import reads without mapping."""
    output = io.StringIO()
    writer = SafeCsvWriter(output)
    for row in template_csv():
        writer.writerow(row)
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": 'attachment; filename="shift_history_template.csv"'
        },
    )


@router.get("", response_model=ShiftHistoryImportListResponse)
async def list_imports(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    service = ShiftHistoryImportService(db)
    drafts = await service.list_imports(str(current_user.organization_id))
    return {"imports": [summary_view(d) for d in drafts]}


@router.post(
    "",
    response_model=ShiftHistoryImportSummary,
    status_code=status.HTTP_201_CREATED,
)
async def upload_import(
    file: UploadFile = File(...),
    timezone: Optional[str] = Form(None, max_length=64),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Store an uploaded CSV as a draft. Nothing is written to the schedule.

    ``timezone`` is the IANA zone the file's times are in; it defaults to the
    department's.
    """
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are accepted")
    try:
        contents = await read_upload_limited(file, MAX_SHIFT_HISTORY_CSV_BYTES)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="CSV file exceeds the 10MB limit.",
        )
    # Stored as parsed text rather than as a file, but a file entering the
    # platform all the same: scanned before it is read.
    await reject_if_malicious(
        db,
        contents,
        upload_kind="shift_history_import",
        detected_mime=None,
        user=current_user,
    )
    service = ShiftHistoryImportService(db)
    try:
        draft = await service.create_draft(
            str(current_user.organization_id),
            str(current_user.id),
            file.filename,
            decode_upload(contents),
            timezone,
        )
    except Exception as exc:
        raise _http_error(exc)
    await log_audit_event(
        db=db,
        event_type="shift_history_import_uploaded",
        event_category="scheduling",
        severity="INFO",
        event_data={
            "organization_id": str(current_user.organization_id),
            "import_id": draft.id,
            "filename": draft.source_filename,
            "row_count": draft.row_count,
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return summary_view(draft)


@router.get(
    "/{import_id}",
    response_model=ShiftHistoryImportDetail,
    response_model_by_alias=True,
)
async def get_import(
    import_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """A draft with its full analysis, or a committed import's record."""
    service = ShiftHistoryImportService(db)
    try:
        draft = await service.get_import(
            str(current_user.organization_id), str(import_id)
        )
        return await service.detail(draft)
    except Exception as exc:
        raise _http_error(exc)


async def _detail_after(
    service: ShiftHistoryImportService, organization_id: str, import_id: str
) -> Dict[str, Any]:
    draft = await service.get_import(organization_id, import_id)
    return await service.detail(draft)


@router.patch(
    "/{import_id}",
    response_model=ShiftHistoryImportDetail,
    response_model_by_alias=True,
)
async def update_import_settings(
    import_id: UUID,
    payload: ShiftHistoryImportSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Change the time zone the file is read in, or the column mapping."""
    org = str(current_user.organization_id)
    service = ShiftHistoryImportService(db)
    try:
        draft = await service.get_draft(org, str(import_id))
        await service.update_settings(
            draft,
            timezone_name=payload.timezone,
            column_mapping=payload.column_mapping,
        )
        return await _detail_after(service, org, str(import_id))
    except Exception as exc:
        raise _http_error(exc)


@router.patch(
    "/{import_id}/rows/{row_id}",
    response_model=ShiftHistoryImportDetail,
    response_model_by_alias=True,
)
async def update_import_row(
    import_id: UUID,
    row_id: UUID,
    payload: ShiftHistoryImportRowUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Correct a row's values, exclude or restore it, or answer a probable
    match it raised."""
    org = str(current_user.organization_id)
    service = ShiftHistoryImportService(db)
    try:
        draft = await service.get_draft(org, str(import_id))
        await service.update_row(
            draft,
            str(row_id),
            edits=payload.edits,
            excluded=payload.excluded,
            match_decision=payload.match_decision,
            clear_match_decision=(
                "match_decision" in payload.model_fields_set
                and payload.match_decision is None
            ),
        )
        return await _detail_after(service, org, str(import_id))
    except Exception as exc:
        raise _http_error(exc)


@router.put(
    "/{import_id}/mappings",
    response_model=ShiftHistoryImportDetail,
    response_model_by_alias=True,
)
async def update_import_mappings(
    import_id: UUID,
    payload: ShiftHistoryImportMappingsUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Decide who a name is, which unit a vehicle name means, which seat a
    position names, and whether a proposed shift is one already scheduled.

    Each decision is merged into the draft by key; ``null`` removes one.
    """
    org = str(current_user.organization_id)
    service = ShiftHistoryImportService(db)

    def dump(values: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if values is None:
            return None
        return {
            k: (v.model_dump(exclude_none=True) if v is not None else None)
            for k, v in values.items()
        }

    try:
        draft = await service.get_draft(org, str(import_id))
        await service.update_mappings(
            draft,
            members=dump(payload.members),
            units=dump(payload.units),
            positions=dump(payload.positions),
            existing_shifts=payload.existing_shifts,
        )
        return await _detail_after(service, org, str(import_id))
    except Exception as exc:
        raise _http_error(exc)


@router.post(
    "/{import_id}/commit",
    response_model=ShiftHistoryImportSummary,
)
async def commit_import(
    import_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Write the reviewed import to the schedule. Final: there is no undo."""
    org = str(current_user.organization_id)
    service = ShiftHistoryImportService(db)
    try:
        draft = await service.commit(org, str(import_id), str(current_user.id))
    except Exception as exc:
        # get_db rolls the session back on the way out, which releases the
        # draft's row lock and discards anything the commit had flushed.
        raise _http_error(exc)
    await log_audit_event(
        db=db,
        event_type="shift_history_import_committed",
        event_category="scheduling",
        severity="INFO",
        event_data={
            "organization_id": org,
            "import_id": draft.id,
            "filename": draft.source_filename,
            "timezone": draft.timezone,
            **(draft.summary or {}),
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    return summary_view(draft)


@router.delete("/{import_id}", status_code=status.HTTP_204_NO_CONTENT)
async def discard_import(
    import_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("scheduling.manage")),
):
    """Throw away a draft. A committed import cannot be discarded."""
    service = ShiftHistoryImportService(db)
    try:
        await service.discard(str(current_user.organization_id), str(import_id))
    except Exception as exc:
        raise _http_error(exc)
