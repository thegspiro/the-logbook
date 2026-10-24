"""Conditions of the installation itself that administrators must see.

Each notice describes a deployment choice made outside the application —
an environment variable, a missing service — that weakens what the platform
guarantees. They are not dismissible: a notice disappears when its condition
does, which is what keeps a deliberate opt-out from becoming a forgotten one.
"""

import json
from pathlib import Path

from loguru import logger

from app.core.config import settings
from app.schemas.system_notices import SystemNotice
from app.services import upload_encryption

MALWARE_SCANNING_DISABLED = "malware_scanning_disabled"
FILES_NOT_ENCRYPTED = "files_not_encrypted"
BACKUPS_NOT_ENCRYPTED = "backups_not_encrypted"
# Needs the database, so the endpoint adds it (see endpoints/system_notices.py).
KEY_CUSTODY_UNCONFIRMED = "encryption_key_custody_unconfirmed"


#: Written by scripts/backup-sidecar.sh (and backup.sh) after every run; the
#: backups volume is mounted read-only into this container for it.
BACKUP_STATUS_PATH = Path("/backups/.backup_status")


def backups_are_unencrypted() -> bool:
    """True when the last backup run says its archive was written as plaintext.

    No status file means no backup job reports here (backups handled outside
    the sidecar, or none yet), which this cannot judge, so it is not a notice.
    An unreadable file is logged and treated the same way: a notice that cannot
    be trusted would only teach administrators to ignore the banner.
    """
    try:
        raw = BACKUP_STATUS_PATH.read_text(encoding="utf-8")
    except FileNotFoundError:
        return False
    except OSError as exc:
        logger.warning("Cannot read the backup status file: {}", exc)
        return False
    try:
        status = json.loads(raw)
    except ValueError:
        logger.warning("The backup status file is not valid JSON")
        return False
    return isinstance(status, dict) and status.get("encrypted") is False


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
    if backups_are_unencrypted():
        notices.append(
            SystemNotice(
                key=BACKUPS_NOT_ENCRYPTED,
                severity="critical",
                title="Backups are not encrypted",
                detail=(
                    "The nightly backup holds every member's records and "
                    "uploaded files as readable data, on the server's disk "
                    "and anywhere it is copied. Ask whoever runs the server "
                    "to run scripts/backup-keygen.sh and store the private "
                    "key it prints somewhere other than the server (see "
                    "docs/BACKUP.md). Backups encrypt from the next run, and "
                    "existing ones are converted."
                ),
            )
        )
    return notices
