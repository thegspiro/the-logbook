#!/usr/bin/env python3
"""
Verify the audit-log hash chain and report whether it is intact.

Backs `make verify-integrity`. Read-only with respect to the audited data: it
recomputes each entry's hash from the row as stored and checks that every link
points at its predecessor. Nothing is repaired — see
``rehash_audit_chain.py --repair`` for that, and read its warning first, because
rehashing a genuinely tampered row makes the chain self-consistent *around the
alteration* and destroys the evidence.

    # Verify the whole chain (what you almost always want):
    cd backend && python scripts/verify_audit_integrity.py

    # In a running container:
    docker exec -it intranet-backend python scripts/verify_audit_integrity.py

Exit status is the machine-readable answer, so this can drive a scheduled check:

    0  chain intact
    1  integrity violations found — investigate, do not rehash
    2  the check could not be completed (database unreachable, bad arguments)

1 and 2 are deliberately distinct: an outage must not read as a clean bill of
health. Two caveats on reading that status:

  * `make verify-integrity` reports **2** for violations, not 1 — make returns
    its own failure code and does not forward the recipe's. Call this script
    directly if you need to tell "tampered" from "could not check".
  * An unreachable database is retried `DB_CONNECT_RETRIES` times (40 by
    default) before 2 is returned, because this borrows the application's
    connect helper, which is built to wait out a database container still
    starting. A cron caller that wants to fail fast should lower that setting
    rather than have this script keep a second, competing definition of how
    long is too long.

**A windowed check is a weaker check.** Two of the tamper detections are
deliberately gated on verifying the *whole* chain, because each one is about
entries that are no longer there to be examined:

  --start-id  disables the genesis anchor. Deleting entries from the HEAD of
              the chain leaves a tail that is internally consistent and still
              "verifies"; only a run that starts at the beginning notices the
              first row no longer links to genesis.
  --end-id    disables the tail-truncation check. Deleting the NEWEST entries
              leaves a chain that is consistent and anchored to genesis; only a
              run with no end bound compares the chain's last id against the
              latest checkpoint's attested one.

So a clean windowed result does not mean the chain is intact — it means the
window is. The flags exist for narrowing an investigation once a full run has
already failed, and the script says so at runtime rather than leaving the
distinction in this docstring.
"""

import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.core.audit import verify_audit_log_integrity  # noqa: E402
from app.core.database import async_session_factory, database_manager  # noqa: E402

# Enough detail to start an investigation without scrolling a tampered chain
# past the operator; the exit status is what a scheduled caller reads anyway.
_MAX_ERRORS_SHOWN = 20


async def _run(start_id: int | None, end_id: int | None) -> int:
    windowed = start_id is not None or end_id is not None

    async with async_session_factory() as db:
        result = await verify_audit_log_integrity(db, start_id, end_id)

        # verify_audit_log_integrity records the check itself as an
        # `audit_integrity_check` entry. Commit so that record survives — a
        # verification nobody can later prove happened is worth less, and the
        # rollback is silent.
        await db.commit()

        checked = result.get("total_checked", 0)
        errors = result.get("errors", [])
        verified = bool(result.get("verified"))

        scope = "window" if windowed else "full chain"
        print(f"Scope                     : {scope}")
        print(f"Audit log entries checked : {checked}")
        if result.get("first_id") is not None:
            print(
                f"Entry id range            : {result['first_id']}–{result['last_id']}"
            )
        print(f"Integrity verified        : {verified}")
        print(f"Violations                : {len(errors)}")

        for e in errors[:_MAX_ERRORS_SHOWN]:
            print(f"  - log_id={e.get('log_id')}: {e.get('error')}")
        if len(errors) > _MAX_ERRORS_SHOWN:
            print(f"  ... and {len(errors) - _MAX_ERRORS_SHOWN} more")

        if verified:
            if windowed:
                print(
                    "\nThe requested window is intact. This is NOT a statement "
                    "about the whole chain: a window skips the genesis anchor "
                    "and/or the tail-truncation check, so entries deleted from "
                    "either end would not show up here. Re-run with no --start-id "
                    "and no --end-id for that."
                )
            else:
                print("\nChain is intact.")
            return 0

        print(
            "\nIntegrity violations detected. Treat the audit log as suspect "
            "until this is explained. Do NOT run rehash_audit_chain.py --repair "
            "to clear it: rehashing recomputes hashes from the current row "
            "contents, so it would make the chain self-consistent around any "
            "alteration and remove the evidence that there was one."
        )
        return 1


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Verify the audit-log hash chain (read-only; never repairs).",
    )
    parser.add_argument(
        "--start-id",
        type=int,
        default=None,
        help=(
            "Verify from this entry id. WEAKENS THE CHECK: skips the genesis "
            "anchor, so entries deleted from the start of the chain are not "
            "detected."
        ),
    )
    parser.add_argument(
        "--end-id",
        type=int,
        default=None,
        help=(
            "Verify up to this entry id. WEAKENS THE CHECK: skips the "
            "tail-truncation check, so newly deleted entries are not detected."
        ),
    )
    args = parser.parse_args()

    if args.start_id is not None and args.end_id is not None:
        if args.start_id > args.end_id:
            print(
                f"--start-id ({args.start_id}) is after --end-id ({args.end_id}); "
                "that range is empty and would report a vacuous pass.",
                file=sys.stderr,
            )
            return 2

    async def _main() -> int:
        try:
            await database_manager.connect()
        except Exception as exc:  # noqa: BLE001 - reported, not swallowed
            print(f"Could not connect to the database: {exc}", file=sys.stderr)
            return 2
        try:
            return await _run(args.start_id, args.end_id)
        except Exception as exc:  # noqa: BLE001 - reported, not swallowed
            # Distinct from exit 1: the chain was not found to be broken, the
            # check simply did not complete. Conflating the two would let an
            # outage read as a clean bill of health.
            print(f"Integrity check did not complete: {exc}", file=sys.stderr)
            return 2
        finally:
            await database_manager.disconnect()

    return asyncio.run(_main())


if __name__ == "__main__":
    raise SystemExit(main())
