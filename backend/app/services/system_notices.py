"""Conditions of the installation itself that administrators must see.

Each notice describes a deployment choice made outside the application —
an environment variable, a missing service — that weakens what the platform
guarantees. They are not dismissible: a notice disappears when its condition
does, which is what keeps a deliberate opt-out from becoming a forgotten one.
"""

from app.core.config import settings
from app.schemas.system_notices import SystemNotice
from app.services import upload_encryption

MALWARE_SCANNING_DISABLED = "malware_scanning_disabled"
FILES_NOT_ENCRYPTED = "files_not_encrypted"


def current_notices() -> list[SystemNotice]:
    notices: list[SystemNotice] = []
    if not settings.CLAMAV_ENABLED:
        notices.append(
            SystemNotice(
                key=MALWARE_SCANNING_DISABLED,
                severity="critical",
                title="Uploaded files are not being scanned for malware",
                detail=(
                    "Malware scanning is turned off on this server "
                    "(CLAMAV_ENABLED=false), so documents, certificates, "
                    "applicant files, attachments, images and imports are "
                    "accepted without a scan. Ask whoever runs the server to "
                    "turn it back on and start the clamav service."
                ),
            )
        )
    # Walks the uploads directory at most hourly (see plaintext_remains), so
    # callers on the event loop run this in a thread.
    if upload_encryption.plaintext_remains():
        notices.append(
            SystemNotice(
                key=FILES_NOT_ENCRYPTED,
                severity="warning",
                title="Some stored files are not yet encrypted",
                detail=(
                    "Files uploaded before encryption at rest was introduced "
                    "are still stored as readable plaintext on the server's "
                    "disk. New uploads are encrypted. Ask whoever runs the "
                    "server to run scripts/encrypt_uploads.py (see "
                    "docs/UPGRADING.md), then finalize the run."
                ),
            )
        )
    return notices
