#!/usr/bin/env python3
"""
Re-encrypt all at-rest encrypted fields under the CURRENT ENCRYPTION_KEY.

This is the drain step of a key rotation (full runbook:
docs/KEY_ROTATION.md):

1. Move the old key into ENCRYPTION_KEYS_LEGACY and set a new
   ENCRYPTION_KEY. The application keeps working immediately — decryption
   tries the current key first, then each legacy key.
2. Run this script (--commit) to rewrite every value that still depends on
   a legacy key so it is encrypted under the current key.
3. When a run reports zero remaining legacy-key values, remove the drained
   key from ENCRYPTION_KEYS_LEGACY.

Covers the same encrypted-field inventory as reencrypt_to_aesgcm.py:
single-value ciphertext columns, the users.mfa_backup_codes JSON list, and
`enc:`-prefixed secrets nested in organizations.settings.

Safety:
- Idempotent: values already readable with the current key are skipped.
- Dry-run by DEFAULT — pass --commit to persist.
- A value that decrypts with NO configured key is reported and left
  untouched (never destroy data the ring can't read).

    # Report what would change (no writes):
    docker exec -it intranet-backend python scripts/rotate_encryption_key.py
    # Apply:
    docker exec -it intranet-backend python scripts/rotate_encryption_key.py --commit
"""

import argparse
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from cryptography.exceptions import InvalidTag  # noqa: E402
from cryptography.fernet import InvalidToken  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core.database import async_session_factory, database_manager  # noqa: E402
from app.core.security import (  # noqa: E402
    decrypt_data,
    decrypts_with_current_key,
    encrypt_data,
)

_ENC_PREFIX = "enc:"

# (table, pk_column, [ciphertext columns]) — keep in sync with
# reencrypt_to_aesgcm.py and the EncryptedText columns in app/models/.
_PLAIN_COLUMNS = [
    (
        "shift_completion_reports",
        "id",
        [
            "areas_of_strength",
            "areas_for_improvement",
            "officer_narrative",
            "reviewer_notes",
        ],
    ),
    ("users", "id", ["mfa_secret"]),
    ("integrations", "id", ["encrypted_config"]),
    (
        "external_training_providers",
        "id",
        ["api_key", "api_secret", "client_secret"],
    ),
]


def _rotate_value(value: str, stats: dict) -> str | None:
    """Return the re-encrypted value, or None when no rewrite is needed."""
    if not value:
        return None
    if decrypts_with_current_key(value):
        stats["current"] += 1
        return None
    try:
        plaintext = decrypt_data(value)  # ring: legacy keys
    except (InvalidTag, InvalidToken, ValueError):
        stats["unreadable"] += 1
        return None
    stats["rotated"] += 1
    return encrypt_data(plaintext)


async def _rotate_plain_columns(session, stats, commit: bool) -> None:
    for table, pk, columns in _PLAIN_COLUMNS:
        col_list = ", ".join([pk] + columns)
        rows = (
            (await session.execute(text(f"SELECT {col_list} FROM {table}")))
            .mappings()
            .all()
        )
        for row in rows:
            updates = {}
            for column in columns:
                rotated = _rotate_value(row[column], stats)
                if rotated is not None:
                    updates[column] = rotated
            if updates and commit:
                sets = ", ".join(f"{c} = :{c}" for c in updates)
                await session.execute(
                    text(f"UPDATE {table} SET {sets} WHERE {pk} = :pk"),
                    {**updates, "pk": row[pk]},
                )


async def _rotate_backup_codes(session, stats, commit: bool) -> None:
    rows = (
        (
            await session.execute(
                text(
                    "SELECT id, mfa_backup_codes FROM users "
                    "WHERE mfa_backup_codes IS NOT NULL"
                )
            )
        )
        .mappings()
        .all()
    )
    for row in rows:
        codes = row["mfa_backup_codes"]
        if isinstance(codes, str):
            codes = json.loads(codes)
        if not isinstance(codes, list):
            continue
        changed = False
        rotated_codes = []
        for code in codes:
            rotated = _rotate_value(code, stats) if isinstance(code, str) else None
            if rotated is not None:
                changed = True
                rotated_codes.append(rotated)
            else:
                rotated_codes.append(code)
        if changed and commit:
            await session.execute(
                text("UPDATE users SET mfa_backup_codes = :codes WHERE id = :pk"),
                {"codes": json.dumps(rotated_codes), "pk": row["id"]},
            )


def _rotate_nested(obj, stats: dict):
    """Recursively rotate `enc:`-prefixed strings inside a JSON structure."""
    changed = False
    if isinstance(obj, dict):
        for key, value in obj.items():
            if isinstance(value, str) and value.startswith(_ENC_PREFIX):
                rotated = _rotate_value(value[len(_ENC_PREFIX) :], stats)
                if rotated is not None:
                    obj[key] = _ENC_PREFIX + rotated
                    changed = True
            elif isinstance(value, (dict, list)):
                changed = _rotate_nested(value, stats) or changed
    elif isinstance(obj, list):
        for item in obj:
            if isinstance(item, (dict, list)):
                changed = _rotate_nested(item, stats) or changed
    return changed


async def _rotate_org_settings(session, stats, commit: bool) -> None:
    rows = (
        (
            await session.execute(
                text(
                    "SELECT id, settings FROM organizations "
                    "WHERE settings IS NOT NULL"
                )
            )
        )
        .mappings()
        .all()
    )
    for row in rows:
        settings_json = row["settings"]
        if isinstance(settings_json, str):
            settings_json = json.loads(settings_json)
        if not isinstance(settings_json, dict):
            continue
        if _rotate_nested(settings_json, stats) and commit:
            await session.execute(
                text("UPDATE organizations SET settings = :s WHERE id = :pk"),
                {"s": json.dumps(settings_json), "pk": row["id"]},
            )


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--commit",
        action="store_true",
        help="Persist rewrites (default is a dry-run report)",
    )
    args = parser.parse_args()

    stats = {"current": 0, "rotated": 0, "unreadable": 0}
    await database_manager.connect()
    try:
        async with async_session_factory() as session:
            await _rotate_plain_columns(session, stats, args.commit)
            await _rotate_backup_codes(session, stats, args.commit)
            await _rotate_org_settings(session, stats, args.commit)
            if args.commit:
                await session.commit()
    finally:
        await database_manager.disconnect()

    mode = "APPLIED" if args.commit else "DRY-RUN (pass --commit to apply)"
    print(f"[{mode}]")
    print(f"  already under current key: {stats['current']}")
    print(f"  rotated to current key:    {stats['rotated']}")
    print(f"  unreadable with any key:   {stats['unreadable']}")
    if stats["unreadable"]:
        print(
            "  WARNING: unreadable values were left untouched — is the "
            "right old key present in ENCRYPTION_KEYS_LEGACY?"
        )
        return 1
    if args.commit and stats["rotated"] == 0:
        print(
            "  Rotation drained: legacy keys can be removed from "
            "ENCRYPTION_KEYS_LEGACY."
        )
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
