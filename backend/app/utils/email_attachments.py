"""Where email-template attachments live, and the containment rule for them.

Attachments were originally written to the *relative* path
``storage/email_attachments/<org_id>/``, which resolves to ``/app/storage`` in
the container. No compose file mounts that directory, so in production the
files lived in the container's writable layer: recreating the container lost
every one of them, and the backup sidecar (which archives the uploads volume)
never saw them. New uploads go to the uploads volume instead, and migration
``relocate_email_attachments`` moves the existing files across.

The legacy root is still accepted on read. A file the migration could not move
(an unwritable volume, say) keeps its old path and must stay sendable rather
than silently dropping out of every welcome email.
"""

import os
from pathlib import Path
from typing import Any, Optional

from loguru import logger

from app.utils.upload_paths import resolve_in_any_org_root

EMAIL_ATTACHMENT_DIR = "/app/uploads/email-attachments"

# The backend's own directory (``/app`` in the container). Legacy relative
# paths were resolved against the process's working directory, which is this
# directory in every deployment; anchoring on it explicitly keeps a resolver
# run from another cwd (a script, a test) pointing at the same place.
APP_ROOT = str(Path(__file__).resolve().parents[2])
LEGACY_EMAIL_ATTACHMENT_DIR = os.path.join(APP_ROOT, "storage", "email_attachments")


def resolve_email_attachment_path(
    storage_path: Any, organization_id: Any
) -> Optional[str]:
    """Real path of a stored attachment, confined to its organization.

    Accepts the current root and the legacy one, each only within
    ``<root>/<organization_id>/``. Returns None for anything else, so a
    tampered ``storage_path`` can neither be attached to an outgoing email
    nor unlinked.
    """
    if not isinstance(storage_path, str) or not storage_path:
        return None
    path = (
        storage_path
        if os.path.isabs(storage_path)
        else os.path.join(APP_ROOT, storage_path)
    )
    return resolve_in_any_org_root(
        path, (EMAIL_ATTACHMENT_DIR, LEGACY_EMAIL_ATTACHMENT_DIR), organization_id
    )


def confined_template_attachment_paths(
    attachments: Any, organization_id: Any
) -> list[str]:
    """Sendable paths for a template's attachment rows, out-of-org ones dropped.

    A dropped row is logged rather than raised: one bad row must not stop the
    welcome email itself from going out.
    """
    paths: list[str] = []
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
        paths.append(resolved)
    return paths
