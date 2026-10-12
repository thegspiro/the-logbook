"""Installation-level notices for administrators (see app.services.system_notices)."""

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import require_permission
from app.core.database import get_db
from app.core.security_middleware import get_client_ip
from app.core.utils import safe_error_detail
from app.models.user import User
from app.schemas.system_notices import (
    KeyCustodyConfirm,
    KeyCustodyStatus,
    SystemNotice,
)
from app.services import key_custody_service
from app.services.system_notices import KEY_CUSTODY_UNCONFIRMED, current_notices

router = APIRouter()

_KEY_CUSTODY_NOTICE = SystemNotice(
    key=KEY_CUSTODY_UNCONFIRMED,
    severity="critical",
    title="Confirm the encryption key is stored somewhere safe",
    detail=(
        "Stored files and sensitive fields are encrypted with this server's "
        "ENCRYPTION_KEY and ENCRYPTION_SALT. If they are lost, that data "
        "cannot be recovered from any backup; if they are kept with the "
        "backups, the backups are readable by whoever holds them. Make sure "
        "whoever runs the server keeps a copy of both somewhere other than "
        "the server and its backups, then confirm it here."
    ),
    action="confirm_key_custody",
)


@router.get("", response_model=list[SystemNotice])
async def list_system_notices(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("settings.manage")),
) -> list[SystemNotice]:
    """
    Conditions of this installation that weaken what the platform guarantees,
    such as malware scanning being turned off, files stored before encryption
    at rest still unencrypted, or the encryption key's safekeeping not yet
    confirmed. Empty when there are none.

    **Requires permission: settings.manage**
    """
    notices = await asyncio.to_thread(current_notices)
    if not await key_custody_service.is_confirmed(db):
        notices.insert(0, _KEY_CUSTODY_NOTICE)
    return notices


@router.get("/encryption-key-custody", response_model=KeyCustodyStatus)
async def get_key_custody(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("settings.manage")),
) -> KeyCustodyStatus:
    """
    Whether the encryption key now in use has been confirmed as stored
    separately, and its fingerprint (never the key).

    **Requires permission: settings.manage**
    """
    record = await key_custody_service.confirmation_for_current_key(db)
    return KeyCustodyStatus(
        key_fingerprint=key_custody_service.current_fingerprint(),
        confirmed=record is not None,
        confirmed_at=record.confirmed_at if record else None,
        confirmed_via=record.confirmed_via if record else None,
    )


@router.post("/encryption-key-custody", response_model=KeyCustodyStatus)
async def confirm_key_custody(
    body: KeyCustodyConfirm,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("settings.manage")),
) -> KeyCustodyStatus:
    """
    Confirm the encryption key now in use is stored somewhere other than the
    server and its backups. Recorded with who and when, and audited.

    **Requires permission: settings.manage**
    """
    try:
        record = await key_custody_service.confirm(
            db,
            key_fingerprint=body.key_fingerprint,
            user_id=str(current_user.id),
            username=current_user.username,
            via="settings",
            ip_address=get_client_ip(request),
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=safe_error_detail(exc))
    await db.commit()
    return KeyCustodyStatus(
        key_fingerprint=record.key_fingerprint,
        confirmed=True,
        confirmed_at=record.confirmed_at,
        confirmed_via=record.confirmed_via,
    )
