"""
History import endpoints (``/api/v1/history/imports``, gated on the module).

A roster file becomes a draft, the Historian decides what each row is, and a
commit writes the records. Everything here needs ``history.manage``. Every
lookup resolves inside the caller's department, and every id a decision names
is checked against it before it is stored.

Audit entries carry ids and counts, never names: a roster is personal data.
"""

import io

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import handle_service_errors
from app.models.user import User
from app.schemas.history import (
    AcceptSuggestionsResult,
    HistoryImportDetail,
    HistoryImportSummary,
    ImportRowUpdate,
    ImportTitlesUpdate,
    RemoveRecordsResult,
)
from app.services import history_import_engine as engine
from app.services.history_import_service import (
    HistoryImportService,
    ImportNotDraft,
    ImportNotFound,
)
from app.services.upload_scanning import reject_if_malicious
from app.utils.csv_export import SafeCsvWriter
from app.utils.upload_limits import read_upload_limited

router = APIRouter()


async def _audit(db: AsyncSession, user: User, event_type: str, data: dict) -> None:
    await log_audit_event(
        db=db,
        event_type=event_type,
        event_category="history",
        severity="info",
        event_data={"organization_id": str(user.organization_id), **data},
        user_id=str(user.id),
        username=user.username,
    )


def _lookup_errors(exc: Exception) -> HTTPException:
    if isinstance(exc, ImportNotFound):
        return HTTPException(status_code=404, detail=str(exc))
    return HTTPException(status_code=409, detail=str(exc))


@router.get("/imports/template")
async def download_template(
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    The CSV template: every column the import reads, with one example row.

    **Requires permission: history.manage**
    """
    buffer = io.StringIO()
    writer = SafeCsvWriter(buffer)
    writer.writerow(engine.TEMPLATE_HEADERS)
    writer.writerow(engine.TEMPLATE_EXAMPLE)
    return Response(
        content=buffer.getvalue(),
        media_type="text/csv",
        headers={
            "Content-Disposition": 'attachment; filename="history-roster-template.csv"'
        },
    )


@router.get("/imports", response_model=list[HistoryImportSummary])
async def list_imports(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Drafts in progress and committed imports, newest first.

    **Requires permission: history.manage**
    """
    service = HistoryImportService(db)
    drafts = await service.list_imports(str(current_user.organization_id))
    return [service.summary_view(d) for d in drafts]


@router.post("/imports", response_model=HistoryImportDetail, status_code=201)
async def upload_import(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Store an uploaded roster CSV as a draft and suggest what each row is.
    Nothing is written to the archive until the draft is committed.

    **Requires permission: history.manage**
    """
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are accepted")
    try:
        contents = await read_upload_limited(file, engine.MAX_IMPORT_BYTES)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="The file is over the 5 MB limit",
        )
    await reject_if_malicious(
        db,
        contents,
        upload_kind="history_import",
        detected_mime=None,
        user=current_user,
    )
    service = HistoryImportService(db)
    async with handle_service_errors("Could not read this file"):
        draft = await service.create_draft(
            str(current_user.organization_id),
            str(current_user.id),
            file.filename,
            engine.decode_upload(contents),
        )
    await db.commit()
    await _audit(
        db,
        current_user,
        "history_import_uploaded",
        {"import_id": draft.id, "row_count": draft.row_count},
    )
    return await service.detail(draft)


@router.get("/imports/{import_id}", response_model=HistoryImportDetail)
async def get_import(
    import_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    A draft with every row, its suggestions and problems, and the titles the
    file uses; or a committed import's record.

    **Requires permission: history.manage**
    """
    service = HistoryImportService(db)
    try:
        draft = await service.get_import(str(current_user.organization_id), import_id)
    except ImportNotFound as exc:
        raise _lookup_errors(exc)
    detail = await service.detail(draft)
    await db.commit()
    return detail


@router.patch("/imports/{import_id}/rows/{row_id}", response_model=HistoryImportDetail)
async def update_row(
    import_id: str,
    row_id: str,
    payload: ImportRowUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Correct a row's values, decide what it is, or both.

    **Requires permission: history.manage**
    """
    service = HistoryImportService(db)
    org_id = str(current_user.organization_id)
    try:
        async with handle_service_errors("Could not save this row"):
            await service.update_row(
                org_id, import_id, row_id, payload.model_dump(exclude_unset=True)
            )
    except (ImportNotFound, ImportNotDraft) as exc:
        raise _lookup_errors(exc)
    await db.commit()
    return await service.detail(await service.get_import(org_id, import_id))


@router.post(
    "/imports/{import_id}/accept-suggestions", response_model=AcceptSuggestionsResult
)
async def accept_suggestions(
    import_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Decide every undecided row the suggestions settle: one suggestion is
    taken, none means a new record, and a row with several is left alone.

    **Requires permission: history.manage**
    """
    service = HistoryImportService(db)
    try:
        decided = await service.accept_suggestions(
            str(current_user.organization_id), import_id
        )
    except (ImportNotFound, ImportNotDraft) as exc:
        raise _lookup_errors(exc)
    await db.commit()
    return AcceptSuggestionsResult(decided=decided)


@router.put("/imports/{import_id}/titles", response_model=HistoryImportDetail)
async def set_titles(
    import_id: str,
    payload: ImportTitlesUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Answer what each unfamiliar title in the file is: an existing title, a
    new one, or dropped. The answers are remembered for later imports.

    **Requires permission: history.manage**
    """
    service = HistoryImportService(db)
    org_id = str(current_user.organization_id)
    try:
        async with handle_service_errors("Could not save these titles"):
            await service.set_titles(
                org_id,
                import_id,
                [c.model_dump() for c in payload.choices],
                str(current_user.id),
            )
    except (ImportNotFound, ImportNotDraft) as exc:
        raise _lookup_errors(exc)
    await db.commit()
    return await service.detail(await service.get_import(org_id, import_id))


@router.post("/imports/{import_id}/commit", response_model=HistoryImportSummary)
async def commit_import(
    import_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Write the records. Refused (409) once the import is no longer a draft, so a
    repeated request cannot import twice.

    **Requires permission: history.manage**
    """
    service = HistoryImportService(db)
    try:
        async with handle_service_errors("Could not import this file"):
            draft = await service.commit(
                str(current_user.organization_id), import_id, str(current_user.id)
            )
    except (ImportNotFound, ImportNotDraft) as exc:
        raise _lookup_errors(exc)
    await db.commit()
    await _audit(
        db,
        current_user,
        "history_import_committed",
        {"import_id": draft.id, **(draft.summary or {})},
    )
    return service.summary_view(draft)


@router.delete("/imports/{import_id}", status_code=204)
async def discard_import(
    import_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Discard a draft and delete its rows. Nothing was written to the archive.

    **Requires permission: history.manage**
    """
    service = HistoryImportService(db)
    try:
        draft = await service.discard(str(current_user.organization_id), import_id)
    except (ImportNotFound, ImportNotDraft) as exc:
        raise _lookup_errors(exc)
    await db.commit()
    await _audit(db, current_user, "history_import_discarded", {"import_id": draft.id})


@router.post("/imports/{import_id}/remove-records", response_model=RemoveRecordsResult)
async def remove_import_records(
    import_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("history.manage")),
):
    """
    Delete the records this import created that are still unpublished and
    untouched since. Records it only added to are left alone; the response
    names every record kept and why.

    **Requires permission: history.manage**
    """
    service = HistoryImportService(db)
    try:
        async with handle_service_errors("Could not remove these records"):
            result = await service.remove_records(
                str(current_user.organization_id), import_id
            )
    except ImportNotFound as exc:
        raise _lookup_errors(exc)
    await db.commit()
    await _audit(
        db,
        current_user,
        "history_import_records_removed",
        {
            "import_id": import_id,
            "removed": result["removed"],
            "kept": len(result["kept"]),
        },
    )
    return RemoveRecordsResult(**result)
