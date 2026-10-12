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
    #    a manifest is written to /app/uploads/.encryption/ and its path printed:
    docker exec -it intranet-backend python scripts/encrypt_uploads.py --apply

    #    Changed your mind? Put the originals back:
    docker exec -it intranet-backend python scripts/encrypt_uploads.py \\
        --rollback /app/uploads/.encryption/encryption-<stamp>.json

    # 3. Once satisfied, delete the kept originals (each file re-verified
    #    first). Until this runs, plaintext copies are still on disk:
    docker exec -it intranet-backend python scripts/encrypt_uploads.py \\
        --finalize /app/uploads/.encryption/encryption-<stamp>.json

After rotating ENCRYPTION_KEY (docs/KEY_ROTATION.md), move files to the new
key so the old one can leave ENCRYPTION_KEYS_LEGACY:

    docker exec -it intranet-backend python scripts/encrypt_uploads.py --rewrap
    docker exec -it intranet-backend python scripts/encrypt_uploads.py \\
        --rewrap --apply

Exit codes:
    0 — success
    1 — some files could not be read, encrypted or verified (details printed)
    2 — bad arguments or unhandled exception
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services import upload_encryption  # noqa: E402


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
        print(json.dumps(result, indent=2))
        if not args.apply and result["under_a_retired_key"]:
            print("Dry run: nothing was changed. Re-run with --rewrap --apply.")
        return 1 if result.get("failed") else 0

    report = upload_encryption.apply(dry_run=not args.apply)
    print(json.dumps(report.summary(), indent=2))
    for path in report.survey.unreadable:
        print(f"unreadable (left alone): {path}")
    for path in report.failed:
        print(f"could not encrypt (left as it was): {path}")
    if not args.apply and report.survey.plain:
        print("Dry run: nothing was changed. Re-run with --apply.")
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
