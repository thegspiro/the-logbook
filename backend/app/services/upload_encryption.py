"""Encrypting files stored before encryption at rest (scripts/encrypt_uploads.py).

New uploads are encrypted as they are written. Files already on disk stay
readable as plaintext until this runs (owner decision 24). Three steps, the
same shape as the Phase 2 relocation:

``apply``
    Encrypt each plain file in place. The ciphertext is written beside the
    original, decrypted again and compared with the original before it is
    swapped in; the original is kept as a hidden ``.<name>.plaintext`` copy
    and recorded in a manifest under ``/app/uploads/.encryption/``.
``rollback``
    Put the kept originals back.
``finalize``
    Re-verify each encrypted file against the recorded checksum, then delete
    the kept original. After this there is nothing to roll back to.

``rewrap`` moves files written under a retired key (one now only in
``ENCRYPTION_KEYS_LEGACY``) to the current key, so the old key can be dropped.

Database rows are never touched: paths do not change, only the bytes behind
them.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Iterator, Optional

from loguru import logger

from app.core import file_encryption
from app.services import file_storage_service as file_storage

_MANIFEST_VERSION = 1
_BACKUP_SUFFIX = ".plaintext"
_PARTIAL_SUFFIX = ".encrypting"
_STATE_FILE = "state.json"
# Housekeeping directories under the uploads root: manifests, not uploads.
_SKIP_DIRS = {".relocation", ".encryption"}


def _state_dir() -> str:
    return os.path.join(file_storage.UPLOADS_ROOT, ".encryption")


def _roots() -> list[str]:
    roots = [file_storage.UPLOADS_ROOT]
    if os.path.isdir(file_storage.LEGACY_EMAIL_ATTACHMENT_DIR):
        roots.append(file_storage.LEGACY_EMAIL_ATTACHMENT_DIR)
    return roots


def iter_stored_files() -> Iterator[str]:
    """Every stored file: hidden names (partials, kept originals) and
    housekeeping directories excluded, symlinks never followed."""
    for root in _roots():
        if not os.path.isdir(root):
            continue
        for directory, dirnames, filenames in os.walk(root, followlinks=False):
            dirnames[:] = [
                d for d in dirnames if d not in _SKIP_DIRS and not d.startswith(".")
            ]
            for name in filenames:
                if name.startswith("."):
                    continue
                path = os.path.join(directory, name)
                if os.path.islink(path) or not os.path.isfile(path):
                    continue
                yield path


def _backup_path(path: str) -> str:
    directory, name = os.path.split(path)
    return os.path.join(directory, f".{name}{_BACKUP_SUFFIX}")


def _kept_originals() -> Iterator[str]:
    for root in _roots():
        if not os.path.isdir(root):
            continue
        for directory, dirnames, filenames in os.walk(root, followlinks=False):
            dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS]
            for name in filenames:
                if name.startswith(".") and name.endswith(_BACKUP_SUFFIX):
                    yield os.path.join(directory, name)


def _sha256_plain(path: str) -> str:
    digest = hashlib.sha256()
    for chunk in file_encryption.iter_plaintext(path):
        digest.update(chunk)
    return digest.hexdigest()


@dataclass
class Survey:
    plain: list[str] = field(default_factory=list)
    encrypted: int = 0
    old_key: int = 0
    unreadable: list[str] = field(default_factory=list)
    kept_originals: int = 0

    def summary(self) -> dict:
        return {
            "plain_files": len(self.plain),
            "encrypted_files": self.encrypted,
            "under_a_retired_key": self.old_key,
            "unreadable": len(self.unreadable),
            "unencrypted_copies_awaiting_finalize": self.kept_originals,
        }


def survey() -> Survey:
    current = bytes.fromhex(file_encryption.current_key_fingerprint())
    result = Survey()
    for path in iter_stored_files():
        try:
            key_id = file_encryption.key_id_of(path)
        except (OSError, file_encryption.FileDecryptionError):
            result.unreadable.append(path)
            continue
        if key_id is None:
            result.plain.append(path)
        else:
            result.encrypted += 1
            if key_id != current:
                result.old_key += 1
    result.kept_originals = sum(1 for _ in _kept_originals())
    return result


def _encrypt_in_place(path: str) -> dict:
    """Encrypt one plain file; the original survives as its kept copy."""
    with open(path, "rb") as handle:
        original = handle.read()
    stat = os.stat(path)
    sealed = file_encryption.encrypt_bytes(original)
    if file_encryption.decrypt_bytes(sealed) != original:
        raise file_encryption.FileDecryptionError(
            f"Round trip did not reproduce {path}"
        )
    directory, name = os.path.split(path)
    partial = os.path.join(directory, f".{name}{_PARTIAL_SUFFIX}")
    backup = _backup_path(path)
    fd = os.open(partial, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o640)
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(sealed)
            out.flush()
            os.fsync(out.fileno())
        # Keep the original under a second name before the swap, so there is
        # never a moment with neither copy on disk.
        if os.path.exists(backup):
            os.remove(backup)
        try:
            os.link(path, backup)
        except OSError:
            # A filesystem without hard links: an ordinary copy.
            shutil.copy2(path, backup)
        os.replace(partial, path)
    except BaseException:
        if os.path.exists(partial):
            os.remove(partial)
        raise
    # Keep the timestamp: anonymous suggestion screenshots carry a rounded
    # mtime on purpose (suggestion_service._write_screenshot).
    os.utime(path, (stat.st_atime, stat.st_mtime))
    return {
        "path": path,
        "backup": backup,
        "sha256": hashlib.sha256(original).hexdigest(),
        "size": len(original),
    }


@dataclass
class ApplyReport:
    dry_run: bool
    survey: Survey
    encrypted: list[dict] = field(default_factory=list)
    failed: list[str] = field(default_factory=list)
    manifest_path: Optional[str] = None

    def summary(self) -> dict:
        return {
            "dry_run": self.dry_run,
            **self.survey.summary(),
            "encrypted_now": len(self.encrypted),
            "failed": len(self.failed),
            "manifest": self.manifest_path,
        }


def _write_manifest(kind: str, entries: list[dict]) -> str:
    os.makedirs(_state_dir(), mode=0o700, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = os.path.join(_state_dir(), f"{kind}-{stamp}.json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(
            {
                "version": _MANIFEST_VERSION,
                "kind": kind,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "finalized": False,
                "rolled_back": False,
                "files": entries,
            },
            handle,
            indent=2,
        )
    return path


def _load_manifest(path: str) -> dict:
    with open(path, encoding="utf-8") as handle:
        manifest: dict = json.load(handle)
    if manifest.get("version") != _MANIFEST_VERSION or manifest.get("kind") != (
        "encryption"
    ):
        raise ValueError(f"{path} is not an encryption manifest")
    return manifest


def _save_manifest(path: str, manifest: dict) -> None:
    partial = f"{path}.partial"
    with open(partial, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2)
    os.replace(partial, path)


def apply(*, dry_run: bool = True) -> ApplyReport:
    found = survey()
    report = ApplyReport(dry_run=dry_run, survey=found)
    if dry_run or not found.plain:
        if not dry_run:
            mark_complete_if_done()
        return report
    for path in found.plain:
        try:
            report.encrypted.append(_encrypt_in_place(path))
        except (OSError, file_encryption.FileDecryptionError) as exc:
            logger.error(f"Could not encrypt {path}: {exc}")
            report.failed.append(path)
    report.manifest_path = _write_manifest("encryption", report.encrypted)
    return report


def rollback(manifest_path: str) -> dict:
    manifest = _load_manifest(manifest_path)
    if manifest["finalized"]:
        raise ValueError("This run was finalized; its originals are gone")
    restored = missing = 0
    for entry in manifest["files"]:
        if os.path.exists(entry["backup"]):
            os.replace(entry["backup"], entry["path"])
            restored += 1
        else:
            missing += 1
    manifest["rolled_back"] = True
    _save_manifest(manifest_path, manifest)
    _forget_state()
    return {"restored": restored, "originals_missing": missing}


def finalize(manifest_path: str) -> dict:
    manifest = _load_manifest(manifest_path)
    if manifest["rolled_back"]:
        raise ValueError("This run was rolled back; there is nothing to finalize")
    removed = kept = 0
    for entry in manifest["files"]:
        backup = entry["backup"]
        if not os.path.exists(backup):
            continue
        try:
            verified = (
                file_encryption.is_encrypted(entry["path"])
                and _sha256_plain(entry["path"]) == entry["sha256"]
            )
        except (OSError, file_encryption.FileDecryptionError):
            verified = False
        if verified:
            os.remove(backup)
            removed += 1
        else:
            logger.error(f"Kept the original of {entry['path']}: it did not verify")
            kept += 1
    manifest["finalized"] = True
    _save_manifest(manifest_path, manifest)
    mark_complete_if_done()
    return {"originals_removed": removed, "kept_unverified": kept}


def rewrap_all(*, dry_run: bool = True) -> dict:
    """Move files under a retired key to the current one."""
    found = survey()
    if dry_run:
        return {"dry_run": True, "under_a_retired_key": found.old_key}
    moved = failed = 0
    for path in iter_stored_files():
        try:
            if file_encryption.rewrap(path):
                moved += 1
        except (OSError, file_encryption.FileDecryptionError) as exc:
            logger.error(f"Could not rewrap {path}: {exc}")
            failed += 1
    return {"dry_run": False, "rewrapped": moved, "failed": failed}


# ----------------------------------------------------------------------------
# "Are there still plaintext files?" — for the administrators' notice
# ----------------------------------------------------------------------------

_CHECK_INTERVAL_SECONDS = 3600
_cache: dict[str, float | bool] = {}


def _forget_state() -> None:
    _cache.clear()
    try:
        os.remove(os.path.join(_state_dir(), _STATE_FILE))
    except OSError:
        pass


def mark_complete_if_done() -> bool:
    """Record that nothing plain is left, once that is true."""
    if any(True for _ in _kept_originals()):
        return False
    for path in iter_stored_files():
        try:
            if not file_encryption.is_encrypted(path):
                return False
        except OSError:
            continue
    if not os.path.isdir(file_storage.UPLOADS_ROOT):
        # Nothing has ever been stored, and there is nowhere to record it.
        return True
    try:
        os.makedirs(_state_dir(), mode=0o700, exist_ok=True)
        with open(
            os.path.join(_state_dir(), _STATE_FILE), "w", encoding="utf-8"
        ) as handle:
            json.dump(
                {
                    "complete": True,
                    "checked_at": datetime.now(timezone.utc).isoformat(),
                },
                handle,
            )
    except OSError as exc:
        # The answer stands; only the shortcut for next time is lost, and an
        # administrator's notice must not fail over it.
        logger.warning(f"Could not record that every stored file is encrypted: {exc}")
    return True


def plaintext_remains() -> bool:
    """Whether any file is still stored unencrypted, kept originals included.

    Once a check finds none it records that, and every later upload is
    encrypted, so the walk stops being repeated. Otherwise the answer is
    cached for an hour: the notice should not cost a directory walk per page.
    """
    if os.path.exists(os.path.join(_state_dir(), _STATE_FILE)):
        return False
    now = time.monotonic()
    checked = _cache.get("checked")
    if isinstance(checked, float) and now - checked < _CHECK_INTERVAL_SECONDS:
        return bool(_cache.get("remains"))
    remains = not mark_complete_if_done()
    _cache["checked"] = now
    _cache["remains"] = remains
    return remains
