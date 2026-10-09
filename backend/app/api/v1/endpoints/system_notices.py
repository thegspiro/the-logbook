"""Installation-level notices for administrators (see app.services.system_notices)."""

import asyncio

from fastapi import APIRouter, Depends

from app.api.dependencies import require_permission
from app.models.user import User
from app.schemas.system_notices import SystemNotice
from app.services.system_notices import current_notices

router = APIRouter()


@router.get("", response_model=list[SystemNotice])
async def list_system_notices(
    current_user: User = Depends(require_permission("settings.manage")),
) -> list[SystemNotice]:
    """
    Conditions of this installation that weaken what the platform guarantees,
    such as malware scanning being turned off or files stored
    before encryption at rest still unencrypted. Empty when there are none.

    **Requires permission: settings.manage**
    """
    return await asyncio.to_thread(current_notices)
