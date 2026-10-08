"""Move email-template attachments onto the uploads volume

Email-template attachments were written to the *relative* path
``storage/email_attachments/<org_id>/<uuid><ext>``, which resolves to
``/app/storage`` inside the backend container. No compose file mounts that
directory, so in production the files lived in the container's writable
layer: recreating the container (every upgrade does) lost them, and the
backup sidecar, which archives the uploads volume, never included them.

New uploads now go to ``/app/uploads/email-attachments/<org_id>/``. This
moves the files that still exist and points their rows at the new location.

Each file is copied to a ``.partial`` name, checksum-verified, renamed into
place and only then removed from the old location, so an interrupted run
loses nothing and a re-run finishes the job. A row is only rewritten once its
file is in the new location. Files that are already gone (lost to an earlier
container rebuild) are left alone: their rows keep the old path, which the
application still accepts on read, and the send path skips a missing file
with a warning exactly as before. A file that cannot be moved (an unwritable
volume) is logged and also left in place rather than failing the upgrade.

Only paths inside ``storage/email_attachments/<that row's org>/`` are
touched; a stored path anywhere else is not this migration's to move.

The paths are inlined rather than imported from ``app.utils.email_attachments``
because a migration must keep doing what it did on the day it ran.

``email_attachments`` is created by a migration, but the step is still skipped
when the table is absent, so a database built another way cannot fail here.

The downgrade moves files under the new root back to the legacy relative
location and restores those rows. On a production container that puts them
back in the unpersisted layer, which is the state being reverted to.

Revision ID: 2be075025403
Revises: d429a803f847
Create Date: 2026-10-08 17:58:53.759495

"""

import hashlib
import logging
import os
import shutil
from pathlib import Path
from typing import Iterable, List, Sequence, Tuple, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "2be075025403"
down_revision: Union[str, None] = "d429a803f847"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

logger = logging.getLogger("alembic.runtime.migration")

NEW_ROOT = "/app/uploads/email-attachments"
LEGACY_RELATIVE_ROOT = os.path.join("storage", "email_attachments")
# The backend directory (/app in the container): legacy relative paths were
# resolved against the process's working directory, which is this directory.
APP_ROOT = str(Path(__file__).resolve().parents[2])

_TABLE = "email_attachments"

Row = Tuple[str, str, str]  # (attachment id, storage_path, organization_id)


def _sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _within(path: str, root: str) -> bool:
    real_root = os.path.realpath(root)
    return os.path.realpath(path).startswith(real_root + os.sep)


def _move_verified(src: str, dst: str) -> bool:
    """Move *src* to *dst*, verifying the copy. True when *dst* holds the file.

    Re-runnable: a *dst* already holding identical bytes (an earlier run that
    stopped before removing *src*) is accepted, and *src* is then removed.
    """
    if not os.path.isfile(src):
        return os.path.isfile(dst)
    partial = dst + ".partial"
    try:
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if os.path.isfile(dst):
            if _sha256(dst) != _sha256(src):
                logger.warning(
                    "Email attachment relocation: %s already exists with "
                    "different contents; leaving %s in place",
                    dst,
                    src,
                )
                return False
        else:
            shutil.copy2(src, partial)
            if _sha256(partial) != _sha256(src):
                os.remove(partial)
                logger.warning(
                    "Email attachment relocation: copy of %s did not verify", src
                )
                return False
            os.replace(partial, dst)
        os.remove(src)
        return True
    except OSError as exc:
        logger.warning("Email attachment relocation could not move %s: %s", src, exc)
        try:
            if os.path.exists(partial):
                os.remove(partial)
        except OSError:
            pass
        return False


def relocate(
    rows: Iterable[Row], new_root: str, app_root: str
) -> List[Tuple[str, str]]:
    """Move each legacy file under *new_root*; return ``(id, new_path)`` updates."""
    updates: List[Tuple[str, str]] = []
    for attachment_id, storage_path, org_id in rows:
        if not storage_path or not org_id:
            continue
        src = (
            storage_path
            if os.path.isabs(storage_path)
            else os.path.join(app_root, storage_path)
        )
        legacy_org_root = os.path.join(app_root, LEGACY_RELATIVE_ROOT, str(org_id))
        if not _within(src, legacy_org_root):
            continue
        dst = os.path.join(new_root, str(org_id), os.path.basename(src))
        if os.path.isfile(src) and _move_verified(src, dst):
            updates.append((attachment_id, dst))
        elif not os.path.isfile(src) and os.path.isfile(dst):
            # An earlier run moved the file but did not get to the row.
            updates.append((attachment_id, dst))
    return updates


def restore(rows: Iterable[Row], new_root: str, app_root: str) -> List[Tuple[str, str]]:
    """Move files under *new_root* back to the legacy relative location."""
    updates: List[Tuple[str, str]] = []
    for attachment_id, storage_path, org_id in rows:
        if not storage_path or not org_id:
            continue
        if not _within(storage_path, os.path.join(new_root, str(org_id))):
            continue
        relative = os.path.join(
            LEGACY_RELATIVE_ROOT, str(org_id), os.path.basename(storage_path)
        )
        if _move_verified(storage_path, os.path.join(app_root, relative)):
            updates.append((attachment_id, relative))
    return updates


def _rows() -> List[Row]:
    bind = op.get_bind()
    result = bind.execute(
        sa.text(
            "SELECT a.id, a.storage_path, t.organization_id "
            "FROM email_attachments a "
            "JOIN email_templates t ON t.id = a.template_id"
        )
    )
    return [(str(r[0]), r[1], str(r[2]) if r[2] else "") for r in result]


def _apply(updates: List[Tuple[str, str]]) -> None:
    bind = op.get_bind()
    for attachment_id, path in updates:
        bind.execute(
            sa.text("UPDATE email_attachments SET storage_path = :p WHERE id = :i"),
            {"p": path, "i": attachment_id},
        )


def _has_tables() -> bool:
    names = set(sa.inspect(op.get_bind()).get_table_names())
    return {_TABLE, "email_templates"} <= names


def upgrade() -> None:
    if not _has_tables():
        return
    updates = relocate(_rows(), NEW_ROOT, APP_ROOT)
    _apply(updates)
    if updates:
        logger.info("Relocated %d email attachment(s) to %s", len(updates), NEW_ROOT)


def downgrade() -> None:
    if not _has_tables():
        return
    _apply(restore(_rows(), NEW_ROOT, APP_ROOT))
