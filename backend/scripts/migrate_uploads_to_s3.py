#!/usr/bin/env python3
"""
Move a department's existing files from the uploads volume into its own bucket.

Once a department's "Test and switch to S3" passes, its new uploads go to the
bucket; files written before that stay on the volume, and keep working, until
this moves them. See ``app/services/s3_migration.py`` for exactly what each
step does.

Three steps, each safe to interrupt and re-run:

    # 1. See what would move (default — writes nothing):
    docker exec -it intranet-backend python scripts/migrate_uploads_to_s3.py

    # 2. Copy each file into its department's bucket, verify the copy reads
    #    back, and point the rows at it. The copies on disk are KEPT; a
    #    manifest is written to /app/uploads/.s3-migration/, and the run ends
    #    by printing the exact rollback and finalize commands for it:
    docker exec -it intranet-backend python scripts/migrate_uploads_to_s3.py --apply

    #    Changed your mind? Point the rows back at the copies on disk and
    #    remove the bucket copies, naming the manifest --apply printed:
    docker exec -it intranet-backend python scripts/migrate_uploads_to_s3.py \\
        --rollback /app/uploads/.s3-migration/s3-migration-20261022T120000Z-1a2b3c4d.json

    # 3. Once satisfied, delete the copies on disk (each bucket copy is
    #    verified again first). After this there is nothing to roll back to:
    docker exec -it intranet-backend python scripts/migrate_uploads_to_s3.py \\
        --finalize /app/uploads/.s3-migration/s3-migration-20261022T120000Z-1a2b3c4d.json

    # Which departments keep files in which bucket (scripts/backup.sh uses
    # this to say what an uploads backup does not contain):
    docker exec -it intranet-backend python scripts/migrate_uploads_to_s3.py --buckets

``--org ID`` limits a dry run or --apply to one department, which must already
have switched to S3. A file still in a module's pre-2026-10 folder is reported;
run ``scripts/relocate_uploads.py`` first and it moves on the next run.

The container is ``intranet-backend`` in the standard compose file and
``logbook-backend`` on Unraid.

Exit codes:
    0 — success
    1 — some files were missing, outside their storage, waiting on relocation,
        or could not be copied or verified (details printed)
    2 — bad arguments or unhandled exception
"""

import argparse
import asyncio
import json
import os
import shlex
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def next_steps(manifest_path: str) -> str:
    """The rollback and finalize commands for one --apply run, ready to paste.
    Printed because the docs can only show a placeholder manifest name."""
    script = "python scripts/migrate_uploads_to_s3.py"
    manifest = shlex.quote(manifest_path)
    return "\n".join(
        [
            "Next: open a few moved files in the app to check they download.",
            "Then delete the copies still on disk:",
            f"  {script} --finalize {manifest}",
            "Or, to undo this run instead:",
            f"  {script} --rollback {manifest}",
            "From the host, put 'docker exec -it <backend container>' in front:",
            "intranet-backend in the standard compose file, logbook-backend on"
            " Unraid.",
        ]
    )


async def _run(args: argparse.Namespace) -> int:
    # Imported here, after the path insert above: the script runs from any
    # working directory, and the application package is found through it.
    from app.core.database import async_session_factory, database_manager
    from app.services import s3_migration

    await database_manager.connect()
    try:
        async with async_session_factory() as db:
            if args.buckets:
                print(json.dumps(await s3_migration.bucket_inventory(db), indent=2))
                return 0
            if args.rollback:
                result = await s3_migration.rollback(db, args.rollback)
                print(json.dumps(result, indent=2))
                return 1 if result["bucket_copies_kept"] else 0
            if args.finalize:
                result = await s3_migration.finalize(db, args.finalize)
                print(json.dumps(result, indent=2))
                return 1 if result["kept_unverified"] else 0
            report = await s3_migration.apply(
                db, organization_id=args.org, dry_run=not args.apply
            )
    finally:
        await database_manager.disconnect()

    print(json.dumps(report.summary(), indent=2))
    for path in report.needs_relocation:
        print(f"in a pre-2026-10 folder (run relocate_uploads.py first): {path}")
    for path in report.missing:
        print(f"missing on disk: {path}")
    for path in report.outside_storage:
        print(f"outside its organization's storage (left alone): {path}")
    for path in report.failed:
        print(f"could not copy or verify (left on disk): {path}")
    if not args.apply and report.copies:
        print("Dry run: nothing was changed. Re-run with --apply.")
    if report.manifest_path:
        print(next_steps(report.manifest_path))
    problems = (
        report.needs_relocation
        or report.missing
        or report.outside_storage
        or report.failed
    )
    return 1 if problems else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[1])
    parser.add_argument("--org", help="Only this organization id")
    parser.add_argument(
        "--apply", action="store_true", help="Copy, verify and repoint files"
    )
    parser.add_argument("--rollback", metavar="MANIFEST", help="Undo an --apply run")
    parser.add_argument(
        "--finalize", metavar="MANIFEST", help="Delete the copies on disk of a run"
    )
    parser.add_argument(
        "--buckets",
        action="store_true",
        help="List which departments keep files in which bucket",
    )
    args = parser.parse_args()

    chosen = (args.apply, args.rollback, args.finalize, args.buckets)
    if sum(bool(x) for x in chosen) > 1:
        parser.error("choose one of --apply, --rollback, --finalize or --buckets")
    if args.org and (args.rollback or args.finalize or args.buckets):
        parser.error("--org applies to a dry run or --apply only")

    try:
        return asyncio.run(_run(args))
    except Exception as exc:  # reported, not swallowed: exit code 2
        print(f"S3 migration failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
