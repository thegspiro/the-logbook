"""Malware scanning for every file that enters the platform.

Every upload — stored on disk, stored in the database, or parsed in memory
and discarded — passes through :func:`reject_if_malicious` before anything
else happens to it. Scanning is on by default (``CLAMAV_ENABLED``) and fails
closed: a scanner that cannot give a verdict refuses the upload, because
accepting unscanned files during an outage is exactly the state an attacker
wants (the same reasoning as CAPTCHA).

An operator can turn scanning off. Files are then accepted unscanned, and the
platform says so loudly rather than quietly — see
``app.core.startup_diagnostics`` and the system-notices endpoint.
"""

import asyncio
import hashlib
from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import log_audit_event
from app.core.error_codes import CodedHTTPException, ErrorCode
from app.services.malware_scan_service import (
    MalwareScanUnavailable,
    is_malware_scan_enabled,
    scan_bytes,
)
from app.utils.image_validator import (
    ImageValidationError,
    decode_logo_base64,
    validate_logo_image,
)


async def reject_if_malicious(
    db: Optional[AsyncSession],
    content: bytes,
    *,
    upload_kind: str,
    detected_mime: Optional[str],
    user: Any,
) -> None:
    """Scan *content* and raise unless clamd reports it clean.

    Call this **before** anything touches the disk or the session: an infected
    file must never be written, and on a detection the audit row is committed
    immediately (the request then ends in an error, whose rollback would
    otherwise take the audit row with it). Callers have nothing pending at
    that point; one that did would have it committed early.

    *upload_kind* names the upload path in the audit record
    (``"document"``, ``"event_attachment"``, ...). Nothing from the file
    itself is recorded beyond its size, detected type and SHA-256.
    """
    if not is_malware_scan_enabled():
        return

    try:
        result = await scan_bytes(content)
    except MalwareScanUnavailable:
        raise CodedHTTPException(
            status_code=503,
            detail=(
                "Files cannot be checked for malware right now, so this one "
                "was not accepted. Please try again in a few minutes."
            ),
            error_code=ErrorCode.UPLD_SCAN_UNAVAILABLE,
            headers={"Retry-After": "60"},
        )

    if not result.infected:
        return

    if db is not None:
        await log_audit_event(
            db=db,
            event_type="upload_malware_detected",
            event_category="security",
            severity="warning",
            event_data={
                "upload": upload_kind,
                "signature": result.signature,
                "file_type": detected_mime,
                "file_size": len(content),
                "sha256": hashlib.sha256(content).hexdigest(),
            },
            user_id=str(user.id) if user is not None else None,
            username=getattr(user, "username", None),
        )
        await db.commit()
    raise CodedHTTPException(
        status_code=400,
        detail=(
            "This file was flagged as malicious by the malware scan and was "
            "not uploaded. Please obtain a fresh copy of the file and try "
            "again."
        ),
        error_code=ErrorCode.UPLD_MALWARE_DETECTED,
    )


async def scan_and_validate_logo(
    db: Optional[AsyncSession], base64_data: Optional[str], *, user: Any
) -> Optional[str]:
    """Malware-scan a base64 logo, then validate and re-encode it.

    Logos arrive as base64 text inside JSON rather than as a multipart upload,
    but they are files all the same. Undecodable input is left to
    ``validate_logo_image``, which refuses it with its own 400.
    """
    if not base64_data:
        return None
    try:
        raw = decode_logo_base64(base64_data)
    except ImageValidationError:
        raw = None
    if raw:
        await reject_if_malicious(
            db, raw, upload_kind="organization_logo", detected_mime=None, user=user
        )
    return await asyncio.to_thread(validate_logo_image, base64_data)
