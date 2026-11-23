#!/usr/bin/env python3
"""
Find, and on request remove, member files that no record names any more.

Covers the three member-owned storage areas: self-report certificates,
training-record uploads and attendance-waiver documents, in the current and
the legacy layouts. A file counts as orphaned only when no row in its
department names it and it is at least --min-age-days old (measured from the
later of its modification and change times). See
``app/services/orphaned_member_files.py`` for the full rules. Safe to re-run.

    # 1. See what would go (default — changes nothing, prints counts only):
    docker exec -it intranet-backend python scripts/sweep_orphaned_member_files.py

    # 2. Delete them. Each department's removal is audited with counts only:
    docker exec -it intranet-backend python scripts/sweep_orphaned_member_files.py --apply

Add ``--org <organization id>`` for one department, and
``--min-age-days N`` (default 30, at least 1) to change the age floor.

It refuses to run while an upload relocation or remote migration is not
finalized (a manifest under /app/uploads/.relocation/ or
/app/uploads/.s3-migration/ without "finalized": true): finalize it first.
Only the uploads volume is swept; files a department keeps on a remote store
are not reached, and the output counts the remote references it saw.
Deleting a file does not remove it from backups taken earlier.

Exit codes:
    0 — success
    1 — some files could not be deleted, or a department's references could
        not be re-read (nothing was deleted for that department)
    2 — refused (an unfinalized relocation or migration), database error,
        bad arguments or unhandled exception
"""

import argparse
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.core.database import (  # noqa: E402
    async_session_factory,
    database_manager,
)
from app.services import orphaned_member_files  # noqa: E402


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n\n")[1])
    parser.add_argument("--org", help="Only this organization id")
    parser.add_argument(
        "--apply", action="store_true", help="Delete the orphaned files"
    )
    parser.add_argument(
        "--min-age-days",
        type=int,
        default=orphaned_member_files.DEFAULT_MIN_AGE_DAYS,
        help="Skip files younger than this many days (default 30, at least 1)",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    if args.min_age_days < 1:
        parser.error("--min-age-days must be at least 1")

    async def _main() -> int:
        await database_manager.connect()
        try:
            async with async_session_factory() as db:
                report = await orphaned_member_files.sweep(
                    db,
                    apply=args.apply,
                    org_id=args.org,
                    min_age_days=args.min_age_days,
                )
        finally:
            await database_manager.disconnect()
        print(json.dumps(report.as_dict(), indent=2))
        if not args.apply:
            print("Dry run: nothing was changed. Re-run with --apply to delete.")
        problems = any(
            org.failed or org.errors for org in report.organizations.values()
        )
        return 1 if problems else 0

    try:
        return asyncio.run(_main())
    except orphaned_member_files.UnfinalisedManifestError as exc:
        print(f"refused: {exc}", file=sys.stderr)
        for manifest in exc.manifests:
            print(f"  not finalized: {os.path.basename(manifest)}", file=sys.stderr)
        return 2
    except Exception as exc:  # reported, not swallowed: exit code 2
        print(f"sweep failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
