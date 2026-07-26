#!/usr/bin/env python3
"""
Re-encrypt at-rest encrypted fields from legacy Fernet (AES-128-CBC + HMAC) to
AES-256-GCM.

Context
-------
`app.core.security.encrypt_data` now writes AES-256-GCM (version-marked with the
`$gcm1$` prefix), and `decrypt_data` transparently reads BOTH the new GCM format
and legacy Fernet tokens. So the application is correct WITHOUT running this
script — existing Fernet ciphertext stays readable indefinitely. This script is
the optional Phase-2 backfill: it rewrites every legacy value as AES-256-GCM so
that, once complete, Fernet read-support can eventually be retired.

It also upgrades any *legacy plaintext* value found in an encrypted column (rows
written before encryption was added) to AES-256-GCM.

What it covers
--------------
- Plain single-value ciphertext columns:
    shift_completion_reports: areas_of_strength, areas_for_improvement,
                              officer_narrative, reviewer_notes
    users:                    mfa_secret
    integrations:             encrypted_config
    external_training_providers: api_key, api_secret, client_secret
- JSON list of ciphertext strings:
    users.mfa_backup_codes
- Nested `enc:`-prefixed secrets anywhere inside:
    organizations.settings

Safety
------
- Idempotent: values already in `$gcm1$` form are skipped.
- Dry-run by DEFAULT — pass --commit to persist.
- **Untested against a live database in the authoring environment.** Take a DB
  backup and run against staging first, then production. Values are only ever
  rewritten to a form that `decrypt_data` can read, so a partial run is safe to
  resume.

    # Report what would change (no writes):
    docker exec -it intranet-backend python scripts/reencrypt_to_aesgcm.py
    # Apply:
    docker exec -it intranet-backend python scripts/reencrypt_to_aesgcm.py --commit

Full operator runbook (pre-flight, verification, rollback):
docs/AES256_GCM_BACKFILL_RUNBOOK.md
"""

import argparse
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from cryptography.fernet import InvalidToken  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core.database import async_session_factory, database_manager  # noqa: E402
from app.core.security import (  # noqa: E402
    _GCM_PREFIX,
    decrypt_data,
    encrypt_data,
)

_ENC_PREFIX = "enc:"

# (table, pk_column, [ciphertext columns])
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
    ("external_training_providers", "id", ["api_key", "api_secret", "client_secret"]),
]


def _needs_migration(raw) -> bool:
    """True if `raw` is a non-empty value not already in AES-256-GCM form."""
    return isinstance(raw, str) and raw != "" and not raw.startswith(_GCM_PREFIX)


def _reencrypt(raw: str) -> str:
    """Return an AES-256-GCM ciphertext for a legacy Fernet token or plaintext."""
    try:
        plaintext = decrypt_data(raw)
    except InvalidToken:
        # Legacy plaintext written before encryption existed — encrypt it as-is.
        plaintext = raw
    return encrypt_data(plaintext)


async def _migrate_plain(db, commit: bool) -> tuple[int, int]:
    scanned = migrated = 0
    for table, pk, columns in _PLAIN_COLUMNS:
        col_list = ", ".join(columns)
        rows = (
            await db.execute(text(f"SELECT {pk}, {col_list} FROM {table}"))
        ).all()
        for row in rows:
            row_id = row[0]
            updates = {}
            for i, col in enumerate(columns, start=1):
                raw = row[i]
                scanned += 1
                if _needs_migration(raw):
                    updates[col] = _reencrypt(raw)
            if updates:
                migrated += len(updates)
                if commit:
                    set_clause = ", ".join(f"{c} = :{c}" for c in updates)
                    await db.execute(
                        text(f"UPDATE {table} SET {set_clause} WHERE {pk} = :pk"),
                        {**updates, "pk": row_id},
                    )
        print(f"  {table}: scanned {len(rows)} row(s)")
    return scanned, migrated


async def _migrate_mfa_backup_codes(db, commit: bool) -> tuple[int, int]:
    scanned = migrated = 0
    rows = (
        await db.execute(
            text(
                "SELECT id, mfa_backup_codes FROM users "
                "WHERE mfa_backup_codes IS NOT NULL"
            )
        )
    ).all()
    for row_id, raw_json in rows:
        codes = raw_json if isinstance(raw_json, list) else json.loads(raw_json or "[]")
        if not isinstance(codes, list):
            continue
        scanned += len(codes)
        new_codes = [
            _reencrypt(c) if _needs_migration(c) else c for c in codes
        ]
        if new_codes != codes:
            changed = sum(1 for a, b in zip(codes, new_codes) if a != b)
            migrated += changed
            if commit:
                await db.execute(
                    text("UPDATE users SET mfa_backup_codes = :v WHERE id = :pk"),
                    {"v": json.dumps(new_codes), "pk": row_id},
                )
    print(f"  users.mfa_backup_codes: scanned {len(rows)} row(s)")
    return scanned, migrated


def _reencrypt_enc_fields(node) -> int:
    """Recursively re-encrypt every `enc:`-prefixed string in a settings tree.

    Mutates `node` in place. Returns the number of values migrated.
    """
    count = 0
    if isinstance(node, dict):
        for key, val in node.items():
            if (
                isinstance(val, str)
                and val.startswith(_ENC_PREFIX)
                and _needs_migration(val[len(_ENC_PREFIX):])
            ):
                node[key] = _ENC_PREFIX + _reencrypt(val[len(_ENC_PREFIX):])
                count += 1
            else:
                count += _reencrypt_enc_fields(val)
    elif isinstance(node, list):
        for item in node:
            count += _reencrypt_enc_fields(item)
    return count


async def _migrate_org_settings(db, commit: bool) -> tuple[int, int]:
    rows = (
        await db.execute(
            text("SELECT id, settings FROM organizations WHERE settings IS NOT NULL")
        )
    ).all()
    migrated = 0
    for row_id, raw_json in rows:
        settings = raw_json if isinstance(raw_json, dict) else json.loads(raw_json or "{}")
        changed = _reencrypt_enc_fields(settings)
        if changed:
            migrated += changed
            if commit:
                await db.execute(
                    text("UPDATE organizations SET settings = :v WHERE id = :pk"),
                    {"v": json.dumps(settings), "pk": row_id},
                )
    print(f"  organizations.settings: scanned {len(rows)} row(s)")
    return len(rows), migrated


async def _run(commit: bool) -> int:
    total_migrated = 0
    async with async_session_factory() as db:
        print("Scanning encrypted fields...")
        for coro in (
            _migrate_plain,
            _migrate_mfa_backup_codes,
            _migrate_org_settings,
        ):
            _, migrated = await coro(db, commit)
            total_migrated += migrated
        if commit:
            await db.commit()

    verb = "Re-encrypted" if commit else "Would re-encrypt"
    print(f"\n{verb} {total_migrated} value(s) to AES-256-GCM.")
    if not commit and total_migrated:
        print("Run again with --commit to apply.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Re-encrypt at-rest fields from legacy Fernet to AES-256-GCM."
    )
    parser.add_argument(
        "--commit",
        action="store_true",
        help="Persist the re-encrypted values (default: dry-run, no writes).",
    )
    args = parser.parse_args()

    async def _main() -> int:
        await database_manager.connect()
        try:
            return await _run(args.commit)
        finally:
            await database_manager.disconnect()

    return asyncio.run(_main())


if __name__ == "__main__":
    raise SystemExit(main())
