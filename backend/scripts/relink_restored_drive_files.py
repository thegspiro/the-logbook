#!/usr/bin/env python3
"""
Repoint records at Google Shared Drive files put back from a copy.

The Logbook finds a Drive file by its id. A file restored from the drive's
own trash keeps its id and needs nothing; a file uploaded again from a copy
kept elsewhere is a new file with a new id, and its records still name the
old one. Each stored file is named after its storage path, and this matches
restored files to their records by that name. See
``app/services/drive_restore_relink.py`` for exactly what it decides.

Two steps, each safe to interrupt and re-run:

    # 1. See what would be repointed (default — writes nothing):
    docker exec -it intranet-backend python scripts/relink_restored_drive_files.py

    # 2. Repoint the records. A record whose file is already there is left
    #    alone, so running this again changes nothing:
    docker exec -it intranet-backend python scripts/relink_restored_drive_files.py --apply

``--org ID`` limits either step to one department, which must have Google
Drive settings saved. Put the restored files back in the department's
configured Shared Drive first, in any folder, without renaming them.

The container is ``intranet-backend`` in the standard compose file and
``logbook-backend`` on Unraid.

Exit codes:
    0 — success
    1 — some references had no matching file, more than one, a match that
        did not read back, or a path outside their organization (details
        printed; those records were left as they are)
    2 — bad arguments or unhandled exception
"""

import argparse
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


async def _run(args: argparse.Namespace) -> int:
    # Imported here, after the path insert above: the script runs from any
    # working directory, and the application package is found through it.
    from app.core.database import async_session_factory, database_manager
    from app.services import drive_restore_relink

    await database_manager.connect()
    try:
        async with async_session_factory() as db:
            report = await drive_restore_relink.apply(
                db, organization_id=args.org, dry_run=not args.apply
            )
    finally:
        await database_manager.disconnect()

    print(json.dumps(report.summary(), indent=2))
    for relink in report.relinks:
        verb = "repointed" if args.apply else "would repoint"
        print(f"{verb}: {relink.old_ref} -> {relink.new_ref}")
    for path in report.not_found:
        print(f"no file of that name in the drive: {path}")
    for path in report.ambiguous:
        print(f"more than one file of that name (left alone): {path}")
    for path in report.unreadable:
        print(f"the matching file did not read back (left alone): {path}")
    for path in report.outside_storage:
        print(f"outside its organization's storage (left alone): {path}")
    if not args.apply and report.relinks:
        print("Dry run: nothing was changed. Re-run with --apply.")
    return 1 if report.problems else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[1])
    parser.add_argument("--org", help="Only this organization id")
    parser.add_argument(
        "--apply", action="store_true", help="Repoint the records at the restored files"
    )
    args = parser.parse_args()
    try:
        return asyncio.run(_run(args))
    except Exception as exc:  # reported, not swallowed: exit code 2
        print(f"Drive relink failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
