#!/usr/bin/env python3
"""
Move stored files into the organization-first layout.

New uploads are written to ``/app/uploads/<org>/<area>/<record>/``. Files
uploaded before that change stay where they were and keep working — reads
accept both layouts — until this script moves them. See
``app/services/upload_relocation.py`` for exactly what each step does.

Three steps, each safe to interrupt and re-run:

    # 1. See what would move (default — writes nothing):
    docker exec -it intranet-backend python scripts/relocate_uploads.py

    # 2. Copy, verify and repoint. Old files are KEPT; a manifest is written
    #    to /app/uploads/.relocation/ and its path printed:
    docker exec -it intranet-backend python scripts/relocate_uploads.py --apply

    #    Changed your mind? Point everything back and drop the new copies:
    docker exec -it intranet-backend python scripts/relocate_uploads.py \\
        --rollback /app/uploads/.relocation/relocation-<stamp>.json

    # 3. Once satisfied, delete the old copies (each re-verified first).
    #    After this there is nothing to roll back to:
    docker exec -it intranet-backend python scripts/relocate_uploads.py \\
        --finalize /app/uploads/.relocation/relocation-<stamp>.json

Add ``--org <organization id>`` to steps 1 and 2 to do one department at a
time. Run it at a quiet time: rows are re-read under a lock before they are
rewritten, but an upload made mid-run simply stays in the layout it was
written in.

Exit codes:
    0 — success
    1 — some files were reported missing, outside their organization's
        storage, or could not be verified (details are printed)
    2 — database connection error, bad arguments or unhandled exception
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
from app.services import upload_relocation  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[1])
    parser.add_argument("--org", help="Only this organization id")
    parser.add_argument(
        "--apply", action="store_true", help="Copy, verify and repoint files"
    )
    parser.add_argument("--rollback", metavar="MANIFEST", help="Undo an --apply run")
    parser.add_argument(
        "--finalize", metavar="MANIFEST", help="Delete the old copies of a run"
    )
    args = parser.parse_args()

    if sum(bool(x) for x in (args.apply, args.rollback, args.finalize)) > 1:
        parser.error("choose one of --apply, --rollback or --finalize")
    if args.org and (args.rollback or args.finalize):
        parser.error("--org applies to a dry run or --apply only")

    if args.finalize:
        result = upload_relocation.finalize(args.finalize)
        print(json.dumps(result, indent=2))
        return 1 if result["kept_unverified"] else 0

    async def _main() -> int:
        await database_manager.connect()
        try:
            async with async_session_factory() as db:
                if args.rollback:
                    result = await upload_relocation.rollback(db, args.rollback)
                    print(json.dumps(result, indent=2))
                    return 0
                report = await upload_relocation.apply(
                    db, organization_id=args.org, dry_run=not args.apply
                )
                print(json.dumps(report.summary(), indent=2))
                for path in report.missing:
                    print(f"missing on disk: {path}")
                for path in report.outside_storage:
                    print(f"outside its organization's storage (left alone): {path}")
                if not args.apply and report.moves:
                    print("Dry run: nothing was changed. Re-run with --apply.")
                return 1 if (report.missing or report.outside_storage) else 0
        finally:
            await database_manager.disconnect()

    try:
        return asyncio.run(_main())
    except Exception as exc:  # reported, not swallowed: exit code 2
        print(f"relocation failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
