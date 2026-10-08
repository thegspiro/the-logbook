"""Send-time helpers for email-template attachments.

Attachments are stored by ``FileStorageService`` under the organization's
email-attachments area. Two older locations are still read, each only inside
the owning organization's subdirectory:

* ``/app/uploads/email-attachments/<org_id>/`` — 2026-10-08 until the
  org-first layout;
* ``storage/email_attachments/<org_id>/`` relative to the backend directory —
  before that, off the uploads volume, so recreating the container lost the
  files and backups never saw them. Migration ``2be075025403`` moved what
  still existed; a file it could not move stays sendable from there rather
  than silently dropping out of every welcome email.
"""

from typing import Any, Optional

from loguru import logger

from app.services.file_storage_service import StorageArea, resolve


def resolve_email_attachment_path(
    storage_path: Any, organization_id: Any
) -> Optional[str]:
    """Real path of a stored attachment, confined to its organization.

    Returns None for anything outside the organization's email-attachment
    storage (current or legacy), so a tampered ``storage_path`` can neither be
    attached to an outgoing email nor unlinked.
    """
    return resolve(storage_path, organization_id, StorageArea.EMAIL_ATTACHMENTS)


def confined_template_attachments(
    attachments: Any, organization_id: Any
) -> list[tuple[str, str]]:
    """``(path, filename)`` for each sendable attachment row; out-of-org rows
    are dropped.

    *filename* is the name the uploader gave the file, so the recipient sees
    ``Welcome Packet.pdf`` rather than the UUID it is stored under. A dropped
    row is logged rather than raised: one bad row must not stop the welcome
    email itself from going out.
    """
    sendable: list[tuple[str, str]] = []
    for attachment in attachments or []:
        resolved = resolve_email_attachment_path(
            getattr(attachment, "storage_path", None), organization_id
        )
        if resolved is None:
            logger.warning(
                "Skipping email attachment {}: stored path is outside the "
                "organization's attachment storage",
                getattr(attachment, "id", "?"),
            )
            continue
        sendable.append((resolved, getattr(attachment, "filename", None) or ""))
    return sendable
