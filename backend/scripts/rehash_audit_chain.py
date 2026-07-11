#!/usr/bin/env python3
"""
Verify and (optionally) repair the audit-log hash chain.

Historically the audit-log hash included the entry timestamp formatted with
microseconds, but the DB column is DATETIME(0) and truncates fractional seconds
on store. So the hash computed at write (…:56.123456) never matched the value
read back at verify (…:56.000000), and the archival task logged a spurious

    CRITICAL - AUDIT LOG INTEGRITY FAILURE: N issues detected
      - Log ID x: Hash mismatch - log entry has been tampered with

That serialization bug is fixed in code (timestamps are now hashed at
whole-second precision), so no NEW rows drift. This script repairs the rows that
were written before the fix by recomputing their stored hashes from the
unchanged row data — the entries themselves are not modified, only their hash
columns.

The startup auto-rehash is gated to ENVIRONMENT=production, so on dev/staging
run this once after deploying the fix.

    # Verify only (no changes) — shows how many rows mismatch:
    docker exec -it intranet-backend python scripts/rehash_audit_chain.py

    # Repair the chain (recompute + persist hashes):
    docker exec -it intranet-backend python scripts/rehash_audit_chain.py --repair

Note: rehashing recomputes hashes from current row content. If a row had been
genuinely tampered with, this would make the chain self-consistent around the
altered data — so only repair when the mismatches are understood to be the
serialization drift above, not suspected tampering.
"""

import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.core.audit import audit_logger, verify_audit_log_integrity  # noqa: E402
from app.core.database import async_session_factory, database_manager  # noqa: E402


async def _run(repair: bool) -> int:
    async with async_session_factory() as db:
        result = await verify_audit_log_integrity(db)
        checked = result.get("total_checked", 0)
        errors = result.get("errors", [])

        print(f"Audit log entries checked : {checked}")
        print(f"Integrity verified        : {result.get('verified')}")
        print(f"Mismatches                : {len(errors)}")
        for e in errors[:20]:
            print(f"  - log_id={e.get('log_id')}: {e.get('error')}")
        if len(errors) > 20:
            print(f"  ... and {len(errors) - 20} more")

        if result.get("verified"):
            print("\nChain is intact — nothing to repair.")
            return 0

        if not repair:
            print(
                "\nRun again with --repair to recompute and persist correct "
                "hashes for these entries."
            )
            return 1

        rehashed = await audit_logger.rehash_chain(db)
        await db.commit()
        print(f"\nRehashed {rehashed} entrie(s).")

        recheck = await verify_audit_log_integrity(db)
        if recheck.get("verified"):
            print("Chain is now consistent. ✓")
            return 0
        print(
            f"Still {len(recheck.get('errors', []))} mismatch(es) after rehash — "
            "these may not be timestamp drift; investigate before trusting them."
        )
        return 1


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Verify/repair the audit-log hash chain."
    )
    parser.add_argument(
        "--repair",
        action="store_true",
        help="Recompute and persist correct hashes (default: verify only)",
    )
    args = parser.parse_args()

    async def _main() -> int:
        await database_manager.connect()
        try:
            return await _run(args.repair)
        finally:
            await database_manager.disconnect()

    return asyncio.run(_main())


if __name__ == "__main__":
    raise SystemExit(main())
