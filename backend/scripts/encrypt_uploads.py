#!/usr/bin/env python3
"""
Encrypt files stored before encryption at rest.

New uploads are encrypted as they are written. Files uploaded earlier stay
readable as plaintext — downloads accept both — until this script encrypts
them, and administrators see a notice until then. See
``app/services/upload_encryption.py`` for exactly what each step does.

Three steps, each safe to interrupt and re-run:

    # 1. See what would change (default — writes nothing):
    docker exec -it intranet-backend python scripts/encrypt_uploads.py

    # 2. Encrypt each file in place, verifying it decrypts back to the
    #    original first. Originals are KEPT as hidden .<name>.plaintext copies;
    #    a manifest is written to /app/uploads/.encryption/, and the run ends
    #    by printing the exact rollback and finalize commands for it:
    docker exec -it intranet-backend python scripts/encrypt_uploads.py --apply

    #    Changed your mind? Put the originals back, naming the manifest the
    #    --apply run printed:
    docker exec -it intranet-backend python scripts/encrypt_uploads.py \\
        --rollback /app/uploads/.encryption/encryption-20261013T224204Z.json

    # 3. Once satisfied, delete the kept originals (each file re-verified
    #    first). Until this runs, plaintext copies are still on disk:
    docker exec -it intranet-backend python scripts/encrypt_uploads.py \\
        --finalize /app/uploads/.encryption/encryption-20261013T224204Z.json

The container is ``intranet-backend`` in the standard compose file and
``logbook-backend`` on Unraid.

After rotating ENCRYPTION_KEY (docs/KEY_ROTATION.md), move files to the new
key so the old one can leave ENCRYPTION_KEYS_LEGACY. This covers the uploads
volume and the files in departments' own S3 buckets:

    docker exec -it intranet-backend python scripts/encrypt_uploads.py --rewrap
    docker exec -it intranet-backend python scripts/encrypt_uploads.py \\
        --rewrap --apply

Exit codes:
    0 — success
    1 — some files could not be read, encrypted or verified (details printed)
    2 — bad arguments or unhandled exception
"""

import argparse
import asyncio
import json
import os
import shlex
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import upload_encryption  # noqa: E402


def next_steps(manifest_path: str) -> str:
    """The rollback and finalize commands for one --apply run, ready to paste.

    Printed rather than left to the docs because the docs can only show a
    placeholder for the manifest's name, and the obvious one, ``<stamp>``, is
    a shell redirect: pasted as written it fails before the script starts.
    """
    script = "python scripts/encrypt_uploads.py"
    manifest = shlex.quote(manifest_path)
    return "\n".join(
        [
            "Next: open a few stored files in the app to check they download.",
            "Then delete the kept plaintext originals:",
            f"  {script} --finalize {manifest}",
            "Or, to undo this run instead:",
            f"  {script} --rollback {manifest}",
            "From the host, put 'docker exec -it <backend container>' in front:",
            "intranet-backend in the standard compose file, logbook-backend on"
            " Unraid.",
        ]
    )


async def _rewrap_buckets(*, dry_run: bool) -> dict:
    """Objects in departments' own buckets are found through the rows that
    reference them, so this part needs the database."""
    from app.core.database import async_session_factory, database_manager
    from app.services import remote_migration

    await database_manager.connect()
    try:
        async with async_session_factory() as db:
            return await remote_migration.rewrap_bucket_objects(db, dry_run=dry_run)
    finally:
        await database_manager.disconnect()


def _run(args: argparse.Namespace) -> int:
    if args.finalize:
        result = upload_encryption.finalize(args.finalize)
        print(json.dumps(result, indent=2))
        return 1 if result["kept_unverified"] else 0
    if args.rollback:
        result = upload_encryption.rollback(args.rollback)
        print(json.dumps(result, indent=2))
        return 1 if result["originals_missing"] else 0
    if args.rewrap:
        result = upload_encryption.rewrap_all(dry_run=not args.apply)
        buckets = asyncio.run(_rewrap_buckets(dry_run=not args.apply))
        print(json.dumps({"uploads_volume": result, "buckets": buckets}, indent=2))
        waiting = result.get("under_a_retired_key") or buckets.get(
            "bucket_objects_under_a_retired_key"
        )
        if not args.apply and waiting:
            print("Dry run: nothing was changed. Re-run with --rewrap --apply.")
        return (
            1
            if result.get("failed")
            or buckets.get("failed")
            or buckets.get("bucket_unreachable")
            else 0
        )

    report = upload_encryption.apply(dry_run=not args.apply)
    print(json.dumps(report.summary(), indent=2))
    for path in report.survey.unreadable:
        print(f"unreadable (left alone): {path}")
    for path in report.failed:
        print(f"could not encrypt (left as it was): {path}")
    if not args.apply and report.survey.plain:
        print("Dry run: nothing was changed. Re-run with --apply.")
    if report.manifest_path:
        print(next_steps(report.manifest_path))
    return 1 if (report.survey.unreadable or report.failed) else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[1])
    parser.add_argument(
        "--apply", action="store_true", help="Encrypt (or, with --rewrap, rewrap)"
    )
    parser.add_argument("--rollback", metavar="MANIFEST", help="Undo an --apply run")
    parser.add_argument(
        "--finalize", metavar="MANIFEST", help="Delete the kept originals of a run"
    )
    parser.add_argument(
        "--rewrap",
        action="store_true",
        help="Move files under a retired key to the current ENCRYPTION_KEY",
    )
    args = parser.parse_args()

    if args.rollback and args.finalize:
        parser.error("choose one of --rollback or --finalize")
    if (args.rollback or args.finalize) and (args.apply or args.rewrap):
        parser.error("--rollback and --finalize take no other option")

    try:
        return _run(args)
    except Exception as exc:  # reported, not swallowed: exit code 2
        print(f"encryption failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
