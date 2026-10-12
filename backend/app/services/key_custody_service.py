"""Whether an administrator has confirmed the encryption key is kept safe.

Owner decision 25 (docs/FILE_STORAGE_HARDENING.md): stored files and
encrypted fields are unreadable without ENCRYPTION_KEY and ENCRYPTION_SALT,
and readable by anyone who has them. A backup is therefore only as good as
the copy of the key kept somewhere else, and only as private as the key is
kept away from it. New installations confirm this during onboarding; an
existing one shows administrators a notice until somebody holding
settings.manage confirms it. A rotated key is a different key and is
confirmed again.
"""

from datetime import datetime, timezone
from typing import Literal, Optional

from loguru import logger
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import file_encryption
from app.core.audit import log_audit_event
from app.models.onboarding import EncryptionKeyCustody

ConfirmedVia = Literal["onboarding", "settings"]


def current_fingerprint() -> str:
    return file_encryption.current_key_fingerprint()


async def confirmation_for_current_key(
    db: AsyncSession,
) -> Optional[EncryptionKeyCustody]:
    result = await db.execute(
        select(EncryptionKeyCustody).where(
            EncryptionKeyCustody.key_fingerprint == current_fingerprint()
        )
    )
    return result.scalar_one_or_none()


async def is_confirmed(db: AsyncSession) -> bool:
    return await confirmation_for_current_key(db) is not None


async def confirm(
    db: AsyncSession,
    *,
    key_fingerprint: str,
    user_id: Optional[str],
    username: Optional[str],
    via: ConfirmedVia,
    ip_address: Optional[str] = None,
) -> EncryptionKeyCustody:
    """Record the confirmation for the key now in use.

    ``key_fingerprint`` is the one the administrator was shown. If the
    server's key changed in between, they confirmed a different key, so the
    request is refused rather than recorded against the new one.
    Confirming twice is harmless: the first record stands.
    """
    fingerprint = current_fingerprint()
    if key_fingerprint != fingerprint:
        raise ValueError(
            "The server's encryption key has changed since this page was "
            "loaded. Reload it and confirm the key now in use."
        )
    existing = await confirmation_for_current_key(db)
    if existing is not None:
        return existing
    record = EncryptionKeyCustody(
        key_fingerprint=fingerprint,
        confirmed_by=user_id,
        confirmed_via=via,
        # Set here rather than left to the server default, so the caller can
        # read it without a refresh.
        confirmed_at=datetime.now(timezone.utc),
    )
    try:
        async with db.begin_nested():
            db.add(record)
    except IntegrityError:
        # Two administrators confirmed at once; the other one's row stands.
        raced = await confirmation_for_current_key(db)
        if raced is None:
            raise
        return raced
    await log_audit_event(
        db=db,
        event_type="encryption_key.custody_confirmed",
        event_category="security",
        severity="INFO",
        event_data={"key_fingerprint": fingerprint, "confirmed_via": via},
        user_id=user_id,
        username=username,
        ip_address=ip_address,
    )
    logger.info(
        f"Encryption key {fingerprint} confirmed as stored separately "
        f"(via {via}, user {user_id})"
    )
    return record
