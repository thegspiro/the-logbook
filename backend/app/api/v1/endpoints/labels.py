"""
Cross-module barcode-label endpoints.

A single generic API that any module can use to (a) read/save the
per-position label-printer preset for that module, (b) generate a label PDF
for a set of that module's records, and (c) send those labels straight to a
network label printer as ZPL. The module-specific view permission is enforced
dynamically (see ``MODULE_LABELS`` in the label service).

Printer *configuration* is organization-wide and sits behind
``settings.manage``; printing to an already-configured printer is gated on the
module's own permission, since a label exposes nothing the PDF does not.

A registered printer declares the language it speaks — ZPL (Zebra, and the
many printers with a ZPL emulation mode) or ESC/POS (receipt-class thermal
printers). The renderer, the stock sizes on offer, and the status query all
branch on it.
"""

from typing import Annotated, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from loguru import logger
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import (
    _collect_user_permissions,
    _has_permission,
    get_current_user,
    require_permission,
)
from app.api.prospect_privacy import get_hidden_prospect_ids
from app.core.audit import log_audit_event
from app.core.database import get_db
from app.core.utils import safe_error_detail
from app.models.user import User
from app.services.label_printer_service import LANGUAGE_ZPL, LabelPrinterService
from app.services.label_service import (
    UNSET,
    LabelService,
    required_permissions_for_module,
)
from app.utils.label_renderer import SYMBOLOGY_CODE128
from app.utils.printer_transport import PrinterUnreachableError

router = APIRouter()

# Each entry is a field key ("location", "category", "condition") or a
# "custom:<text>" annotation the caller supplies verbatim — bound the text
# half too, or `custom:` lets a caller join up to 20 unbounded strings per
# label spec across up to 2000 ids (LBL-29-3).
ExtraLine = Annotated[str, StringConstraints(max_length=100)]

# Modules whose labels carry PII/credential-adjacent data worth an audit
# trail: a prospect label embeds the applicant's public status-check token
# (label_service.py) and a membership label embeds membership_number.
# Printer *configuration* changes are already audited below; this covers
# actually generating/printing the labels themselves.
_AUDITED_LABEL_MODULES = frozenset({"prospective_members", "membership"})


def _authorize_module(current_user: User, module: str) -> None:
    """404 for unknown modules, 403 when the caller holds none of the module's
    accepted permissions (view or manage — OR logic, like module endpoints)."""
    permissions = required_permissions_for_module(module)
    if permissions is None:
        raise HTTPException(
            status_code=404, detail=f"Labels are not available for module: {module}"
        )
    user_permissions = _collect_user_permissions(current_user)
    if not any(_has_permission(p, user_permissions) for p in permissions):
        raise HTTPException(status_code=403, detail="Insufficient permissions")


class LabelPresetBody(BaseModel):
    preset: str = Field(min_length=1, max_length=50)
    printer_id: Optional[str] = Field(None, min_length=1, max_length=36)
    custom_width: Optional[float] = Field(None, ge=0.5, le=8)
    custom_height: Optional[float] = Field(None, ge=0.5, le=11)
    symbology: str = Field(SYMBOLOGY_CODE128, max_length=20)


class LabelGenerateBody(BaseModel):
    module: str = Field(min_length=1, max_length=50)
    ids: List[str] = Field(min_length=1, max_length=2000)
    label_format: str = Field("letter", max_length=50)
    custom_width: Optional[float] = Field(None, ge=0.5, le=8)
    custom_height: Optional[float] = Field(None, ge=0.5, le=11)
    auto_rotate: Optional[bool] = None
    extra_lines: Optional[List[ExtraLine]] = Field(None, max_length=20)
    symbology: str = Field(SYMBOLOGY_CODE128, max_length=20)


class LabelPreviewBody(BaseModel):
    module: str = Field(min_length=1, max_length=50)
    ids: List[str] = Field(min_length=1, max_length=2000)


@router.post("/labels/preview")
async def preview_labels(
    data: LabelPreviewBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    hidden_prospect_ids: set[str] = Depends(get_hidden_prospect_ids),
):
    """Read-only preview data (name, barcode value, subtitle) for *module*."""
    _authorize_module(current_user, data.module)
    try:
        items = await LabelService(db).preview(
            current_user.organization_id,
            data.module,
            data.ids,
            exclude_ids=hidden_prospect_ids,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    return {"items": items}


@router.get("/label-preset/{module}")
async def get_label_preset(
    module: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Label-printer preset for the caller's position in *module*.

    **Authentication required** · requires the module's view permission.
    """
    _authorize_module(current_user, module)
    return await LabelService(db).get_preset(
        user_id=UUID(current_user.id),
        organization_id=current_user.organization_id,
        module=module,
    )


@router.put("/label-preset/{module}")
async def set_label_preset(
    module: str,
    data: LabelPresetBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Save the label-printer preset for the caller's position in *module*."""
    _authorize_module(current_user, module)
    try:
        if data.printer_id is not None:
            # A remembered destination is a client-supplied foreign key. Check
            # it against the caller's organization before putting it in the
            # position JSON, just as the eventual print path does.
            await LabelPrinterService(db).get_printer(
                data.printer_id, current_user.organization_id
            )
        result = await LabelService(db).set_preset(
            user_id=UUID(current_user.id),
            organization_id=current_user.organization_id,
            module=module,
            preset=data.preset,
            # Absent means "leave the remembered destination alone"; an
            # explicit null clears it. Passing data.printer_id unconditionally
            # made a save that never mentioned a printer erase one.
            printer_id=(
                data.printer_id if "printer_id" in data.model_fields_set else UNSET
            ),
            custom_width=data.custom_width,
            custom_height=data.custom_height,
            symbology=data.symbology,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    await db.commit()
    return result


@router.post("/labels/generate")
async def generate_labels(
    data: LabelGenerateBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    hidden_prospect_ids: set[str] = Depends(get_hidden_prospect_ids),
):
    """Generate a barcode-label PDF for records in *module*.

    A prospect label carries the applicant's public status-check token, so
    the caller's own application is filtered out of the id list here too.

    **Authentication required** · requires the module's view permission.
    """
    _authorize_module(current_user, data.module)
    try:
        pdf, auto_populated, label_count = await LabelService(db).generate(
            organization_id=current_user.organization_id,
            module=data.module,
            ids=data.ids,
            label_format=data.label_format,
            custom_width=data.custom_width,
            custom_height=data.custom_height,
            auto_rotate=data.auto_rotate,
            extra_lines=data.extra_lines,
            exclude_ids=hidden_prospect_ids,
            symbology=data.symbology,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    if data.module in _AUDITED_LABEL_MODULES:
        # label_count is the specs actually rendered — filtered/nonexistent
        # ids in data.ids produce no label and must not inflate this count.
        await log_audit_event(
            db=db,
            event_type="labels_generated",
            event_category="data_access",
            severity="info",
            event_data={"module": data.module, "count": label_count},
            user_id=str(current_user.id),
            username=current_user.username,
        )
    await db.commit()
    return Response(
        content=pdf.getvalue(),
        media_type="application/pdf",
        headers={
            "X-Barcodes-Auto-Populated": str(auto_populated),
            "Content-Disposition": "attachment; filename=labels.pdf",
        },
    )


# ----------------------------------------------------------------------
# Network label printers (direct ZPL printing)
# ----------------------------------------------------------------------


class LabelPrinterBody(BaseModel):
    """Create payload. Optional fields fall back to the model defaults."""

    name: str = Field(min_length=1, max_length=100)
    host: str = Field(min_length=1, max_length=255)
    port: int = Field(9100, ge=1, le=65535)
    language: str = Field(LANGUAGE_ZPL, max_length=20)
    dpi: int = Field(203)
    label_format: Optional[str] = Field(None, max_length=50)
    location: Optional[str] = Field(None, max_length=200)
    custom_width: Optional[float] = Field(None, ge=0.5, le=8)
    custom_height: Optional[float] = Field(None, ge=0.5, le=11)
    darkness: Optional[int] = Field(None, ge=-30, le=30)
    is_default: bool = False


class LabelPrinterUpdateBody(BaseModel):
    """Update payload. Every field is optional; `exclude_unset` on the service
    side distinguishes "not sent" from an explicit null (CLAUDE.md pitfall 1)."""

    name: Optional[str] = Field(None, min_length=1, max_length=100)
    host: Optional[str] = Field(None, min_length=1, max_length=255)
    port: Optional[int] = Field(None, ge=1, le=65535)
    language: Optional[str] = Field(None, max_length=20)
    dpi: Optional[int] = None
    label_format: Optional[str] = Field(None, max_length=50)
    location: Optional[str] = Field(None, max_length=200)
    custom_width: Optional[float] = Field(None, ge=0.5, le=8)
    custom_height: Optional[float] = Field(None, ge=0.5, le=11)
    darkness: Optional[int] = Field(None, ge=-30, le=30)
    is_default: Optional[bool] = None
    is_active: Optional[bool] = None


class PrinterProbeBody(BaseModel):
    host: str = Field(min_length=1, max_length=255)
    port: int = Field(9100, ge=1, le=65535)
    language: str = Field(LANGUAGE_ZPL, max_length=20)


class LabelPrintBody(BaseModel):
    module: str = Field(min_length=1, max_length=50)
    ids: List[str] = Field(min_length=1, max_length=2000)
    printer_id: Optional[str] = None
    label_format: Optional[str] = Field(None, max_length=50)
    custom_width: Optional[float] = Field(None, ge=0.5, le=8)
    custom_height: Optional[float] = Field(None, ge=0.5, le=11)
    copies: int = Field(1, ge=1, le=50)
    extra_lines: Optional[List[ExtraLine]] = Field(None, max_length=20)
    symbology: str = Field(SYMBOLOGY_CODE128, max_length=20)


def _printer_response(printer) -> dict:
    """Serialize a printer for the API.

    Hand-built rather than a `from_attributes` schema because the frontend
    reads these keys as-is; the label endpoints in this file predate the
    camelCase alias convention and stay consistent with it.
    """
    return {
        "id": printer.id,
        "name": printer.name,
        "location": printer.location,
        "host": printer.host,
        "port": printer.port,
        "language": getattr(printer, "language", None) or LANGUAGE_ZPL,
        "dpi": printer.dpi,
        "label_format": printer.label_format,
        "custom_width": printer.custom_width,
        "custom_height": printer.custom_height,
        "darkness": printer.darkness,
        "is_default": printer.is_default,
        "is_active": printer.is_active,
    }


@router.get("/label-printers")
async def list_label_printers(
    include_inactive: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List the organization's configured label printers.

    Readable by any authenticated member: the print page needs the list to
    offer a destination, and a printer's name and host are not sensitive.
    Changing them requires ``settings.manage``.
    """
    printers = await LabelPrinterService(db).list_printers(
        current_user.organization_id, include_inactive=include_inactive
    )
    return {"printers": [_printer_response(p) for p in printers]}


@router.post("/label-printers", status_code=201)
async def create_label_printer(
    data: LabelPrinterBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("settings.manage", "organization.update_settings")
    ),
):
    """Register a network label printer."""
    try:
        printer = await LabelPrinterService(db).create_printer(
            current_user.organization_id,
            str(current_user.id),
            data.model_dump(),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    await log_audit_event(
        db=db,
        event_type="label_printer_created",
        event_category="settings",
        severity="info",
        event_data={
            "printer_id": printer.id,
            "printer_name": printer.name,
            "host": f"{printer.host}:{printer.port}",
        },
        user_id=str(current_user.id),
        username=current_user.username,
    )
    await db.commit()
    return _printer_response(printer)


@router.put("/label-printers/{printer_id}")
async def update_label_printer(
    printer_id: str,
    data: LabelPrinterUpdateBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("settings.manage", "organization.update_settings")
    ),
):
    """Update a label printer. Org-scoped: `settings.manage` in one
    organization does not reach another's printer (CLAUDE.md pitfall 14b)."""
    updates = data.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    try:
        printer = await LabelPrinterService(db).update_printer(
            printer_id, current_user.organization_id, updates
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    await log_audit_event(
        db=db,
        event_type="label_printer_updated",
        event_category="settings",
        severity="info",
        event_data={"printer_id": printer_id, "fields_updated": list(updates.keys())},
        user_id=str(current_user.id),
        username=current_user.username,
    )
    await db.commit()
    return _printer_response(printer)


@router.delete("/label-printers/{printer_id}", status_code=204)
async def delete_label_printer(
    printer_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("settings.manage", "organization.update_settings")
    ),
):
    """Remove a label printer."""
    try:
        await LabelPrinterService(db).delete_printer(
            printer_id, current_user.organization_id
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=safe_error_detail(e))
    await log_audit_event(
        db=db,
        event_type="label_printer_deleted",
        event_category="settings",
        severity="info",
        event_data={"printer_id": printer_id},
        user_id=str(current_user.id),
        username=current_user.username,
    )
    await db.commit()
    return Response(status_code=204)


@router.post("/label-printers/{printer_id}/test")
async def send_test_label(
    printer_id: str,
    symbology: str = SYMBOLOGY_CODE128,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("settings.manage", "organization.update_settings")
    ),
):
    """Send one test label, to confirm the printer is reachable and aligned."""
    try:
        result = await LabelPrinterService(db).print_test_label(
            printer_id, current_user.organization_id, symbology=symbology
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except PrinterUnreachableError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return result


@router.get("/label-printers/{printer_id}/status")
async def get_label_printer_status(
    printer_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("settings.manage", "organization.update_settings")
    ),
):
    """Ask a saved printer to identify itself and report any faults.

    A TCP connection to port 9100 succeeds against a printer that is out of
    labels, against a laptop that inherited the printer's DHCP lease, and
    against anything else listening — so "reachable" on its own is not worth
    reporting. This asks the device to prove it is a ZPL printer and say
    whether it can print right now.
    """
    try:
        return await LabelPrinterService(db).get_status(
            printer_id, current_user.organization_id
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except PrinterUnreachableError as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/label-printers/probe")
async def probe_label_printer(
    data: PrinterProbeBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission("settings.manage", "organization.update_settings")
    ),
):
    """Check an address before it is saved as a printer.

    Same guards as every other path (port allowlist, address classes); this
    only removes the save-discover-edit loop from setting a printer up.
    """
    try:
        return await LabelPrinterService(db).probe_target(
            data.host, data.port, data.language
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except PrinterUnreachableError as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/labels/print")
async def print_labels(
    data: LabelPrintBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    hidden_prospect_ids: set[str] = Depends(get_hidden_prospect_ids),
):
    """Send labels for *module* records straight to a network label printer.

    Gated on the module's own view/manage permission, exactly like the PDF
    path — printing a label reveals nothing the PDF does not.

    **Authentication required** · requires the module's view permission.
    """
    _authorize_module(current_user, data.module)
    try:
        result = await LabelPrinterService(db).print_labels(
            organization_id=current_user.organization_id,
            module=data.module,
            ids=data.ids,
            printer_id=data.printer_id,
            label_format=data.label_format,
            custom_width=data.custom_width,
            custom_height=data.custom_height,
            copies=data.copies,
            extra_lines=data.extra_lines,
            exclude_ids=hidden_prospect_ids,
            symbology=data.symbology,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    except PrinterUnreachableError as e:
        # 502, not 500: the application worked and a downstream device did not,
        # which is the difference between "try again" and "call support". But
        # unlike the settings.manage-gated test/status/probe routes above,
        # this endpoint is reachable by anyone holding the module's own
        # .view permission — the transport's message embeds the printer's
        # configured host/IP/port, which those callers have no business
        # learning (the station-document print path fixed the identical
        # leak the same way). Log the real error, return a generic one.
        logger.error(f"Label print failed for module {data.module}: {e}")
        raise HTTPException(
            status_code=502,
            detail="The printer could not be reached. Contact whoever manages "
            "the label printer.",
        )
    if data.module in _AUDITED_LABEL_MODULES:
        # result["labels_sent"] is the authoritative count (specs actually
        # rendered * copies) — len(data.ids) over/under-counts whenever a
        # requested id is filtered/missing, or copies != 1.
        await log_audit_event(
            db=db,
            event_type="labels_printed",
            event_category="data_access",
            severity="info",
            event_data={
                "module": data.module,
                "count": result.get("labels_sent", len(data.ids)),
            },
            user_id=str(current_user.id),
            username=current_user.username,
        )
    await db.commit()
    return result
