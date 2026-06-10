"""
Cross-module barcode-label endpoints.

A single generic API that any module can use to (a) read/save the
per-position label-printer preset for that module, and (b) generate a label
PDF for a set of that module's records. The module-specific view permission is
enforced dynamically (see ``MODULE_LABELS`` in the label service).
"""

from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
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
from app.services.label_service import LabelService, required_permission_for_module

router = APIRouter()


def _authorize_module(current_user: User, module: str) -> None:
    """404 for unknown modules, 403 when the caller lacks the module's view
    permission."""
    permission = required_permission_for_module(module)
    if permission is None:
        raise HTTPException(
            status_code=404, detail=f"Labels are not available for module: {module}"
        )
    if not _has_permission(permission, _collect_user_permissions(current_user)):
        raise HTTPException(status_code=403, detail="Insufficient permissions")


class LabelPresetBody(BaseModel):
    preset: str = Field(min_length=1, max_length=50)
    custom_width: Optional[float] = Field(None, ge=0.5, le=8)
    custom_height: Optional[float] = Field(None, ge=0.5, le=11)


class LabelGenerateBody(BaseModel):
    module: str = Field(min_length=1, max_length=50)
    ids: List[str] = Field(min_length=1, max_length=2000)
    label_format: str = Field("letter", max_length=50)
    custom_width: Optional[float] = Field(None, ge=0.5, le=8)
    custom_height: Optional[float] = Field(None, ge=0.5, le=11)
    auto_rotate: Optional[bool] = None
    extra_lines: Optional[List[str]] = None


class LabelPreviewBody(BaseModel):
    module: str = Field(min_length=1, max_length=50)
    ids: List[str] = Field(min_length=1, max_length=2000)


@router.post("/labels/preview")
async def preview_labels(
    data: LabelPreviewBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Read-only preview data (name, barcode value, subtitle) for *module*."""
    _authorize_module(current_user, data.module)
    try:
        items = await LabelService(db).preview(
            current_user.organization_id, data.module, data.ids
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
        result = await LabelService(db).set_preset(
            user_id=UUID(current_user.id),
            organization_id=current_user.organization_id,
            module=module,
            preset=data.preset,
            custom_width=data.custom_width,
            custom_height=data.custom_height,
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
):
    """Generate a barcode-label PDF for records in *module*.

    **Authentication required** · requires the module's view permission.
    """
    _authorize_module(current_user, data.module)
    try:
        pdf, auto_populated = await LabelService(db).generate(
            organization_id=current_user.organization_id,
            module=data.module,
            ids=data.ids,
            label_format=data.label_format,
            custom_width=data.custom_width,
            custom_height=data.custom_height,
            auto_rotate=data.auto_rotate,
            extra_lines=data.extra_lines,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=safe_error_detail(e))
    await db.commit()
    return Response(
        content=pdf.getvalue(),
        media_type="application/pdf",
        headers={
            "X-Barcodes-Auto-Populated": str(auto_populated),
            "Content-Disposition": "attachment; filename=labels.pdf",
        },
    )
