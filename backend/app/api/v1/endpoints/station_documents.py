"""
Printable station documents — shift rosters and apparatus check sheets.

Separate from ``/documents``, which is the file store. These are built from
live records on request and printed on a receipt printer at the watch desk;
nothing is stored.

Each document declares the permissions accepted to print it (see
``MODULE_DOCUMENTS``), and the check is the same one the label endpoints make:
printing a roster reveals exactly what the scheduling screen already shows to
the same person, so it is gated on that module's own permission rather than on
anything to do with printers.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import (
    _collect_user_permissions,
    _has_permission,
    get_current_user,
)
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.user import User
from app.services.print_document_service import (
    PrintDocumentService,
    required_permissions_for_document,
)
from app.utils.printer_transport import PrinterUnreachableError

router = APIRouter()


def _authorize_document(current_user: User, document: str) -> None:
    """404 for an unknown document, 403 without one of its permissions."""
    permissions = required_permissions_for_document(document)
    if permissions is None:
        raise HTTPException(status_code=404, detail=f"Unknown document: {document}")
    user_permissions = _collect_user_permissions(current_user)
    if not any(_has_permission(p, user_permissions) for p in permissions):
        raise HTTPException(status_code=403, detail="Insufficient permissions")


class DocumentBody(BaseModel):
    document: str = Field(min_length=1, max_length=50)
    record_id: str = Field(min_length=1, max_length=36)


class DocumentPrintBody(DocumentBody):
    printer_id: Optional[str] = None


@router.post("/station-documents/preview")
async def preview_station_document(
    data: DocumentBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """The document as it will print, for an on-screen preview.

    Reads the same structure the renderer does, so what someone checks before
    printing is what comes out — not a second rendering free to disagree.
    """
    _authorize_document(current_user, data.document)
    try:
        return await PrintDocumentService(db).preview(
            current_user.organization_id, data.document, data.record_id
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))


@router.post("/station-documents/print")
async def print_station_document(
    data: DocumentPrintBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Send the document to a receipt printer."""
    _authorize_document(current_user, data.document)
    try:
        return await PrintDocumentService(db).print_document(
            current_user.organization_id,
            data.document,
            data.record_id,
            data.printer_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except PrinterUnreachableError as e:
        # 502: the application worked and a downstream device did not.
        raise HTTPException(status_code=502, detail=str(e))
