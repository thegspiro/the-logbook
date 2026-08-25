#!/usr/bin/env python3
"""
Migration Validation Script

Validates the Alembic migration chain for common issues:
- Duplicate revision IDs
- Broken migration chain (orphaned migrations)
- Multiple heads (branching)
- Missing down_revision references

Usage:
    python scripts/validate_migrations.py
"""

import argparse
import ast
import re
import sys
from pathlib import Path
from typing import Dict, List, Tuple

# Add the backend directory to the path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

# Revision ids used to be hand-authored as YYYYMMDD_SSSS, a per-day counter.
# Two branches open on the same day both counted from _0001 and both picked
# _0002; git merged the two files without a word because they do not overlap,
# and Alembic then refused to load an ambiguous chain. That happened four
# times. The fix is entropy: `alembic revision` generates the id, so two
# branches cannot pick the same one. The date still leads the *filename*
# (see file_template in alembic.ini), which is what keeps listings sorted.
#
# Everything already written predates the change and is left alone —
# renumbering released history would break every database that has already
# stamped those ids. So the sunset is keyed on the date the id itself carries,
# not on a position in the chain: a legacy-form id dated on or after this is
# one somebody hand-authored after the convention changed.
#
# Keying on the date rather than "descended from revision X" is deliberate. A
# revision anchor has to be bumped every time another branch lands a migration
# before this check does, and whoever forgets gets a failure that blames a
# migration written under the old rules. The date does not move.
LEGACY_ID_SUNSET = "20260817"
LEGACY_ID_FORM = re.compile(r"^(\d{8})_\d{3,4}$")


def _parse_value(raw: str) -> List[str]:
    """
    Parse the right-hand side of a revision assignment into a list of ids.

    A merge migration sets down_revision to a tuple of parents, so every
    down_revision is normalised to a list — an empty one meaning None.
    Trailing comments are stripped; several migrations carry them.
    """
    value = raw.split("#", 1)[0].strip().rstrip(",")

    if not value or value == "None":
        return []

    try:
        parsed = ast.literal_eval(value)
    except (ValueError, SyntaxError):
        # Not a literal we can evaluate (e.g. a name or an expression);
        # fall back to treating it as a bare quoted string.
        return [value.strip("'\"")]

    if isinstance(parsed, (tuple, list)):
        return [str(p) for p in parsed if p is not None]
    if parsed is None:
        return []
    return [str(parsed)]


def parse_migration_file(filepath: Path) -> Dict[str, object]:
    """Extract revision info from a migration file."""
    revision = None
    down_revisions: List[str] = []

    with open(filepath, "r") as f:
        content = f.read()

    # Parse revision
    for line in content.split("\n"):
        line = line.strip()
        if line.startswith("revision") and "=" in line:
            # Handle both: revision = 'xxx' and revision: str = 'xxx'
            parts = line.split("=", 1)
            if len(parts) == 2:
                found = _parse_value(parts[1])
                revision = found[0] if found else None
        elif line.startswith("down_revision") and "=" in line:
            parts = line.split("=", 1)
            if len(parts) == 2:
                down_revisions = _parse_value(parts[1])

    return {
        "file": filepath.name,
        "revision": revision,
        "down_revisions": down_revisions,
    }


def validate_migrations(versions_dir: Path) -> Tuple[bool, List[str], List[str]]:
    """
    Validate the migration chain.

    Returns:
        Tuple of (is_valid, error messages, warning messages).

        Warnings are returned rather than only printed so ``--strict``
        can fail on them; a forked chain is reported as a warning
        because it is legal mid-merge, and fatal by the time it lands.
    """
    errors = []
    warnings = []

    # Find all migration files
    migration_files = list(versions_dir.glob("*.py"))
    migration_files = [f for f in migration_files if not f.name.startswith("__")]

    if not migration_files:
        errors.append("No migration files found!")
        return False, errors, warnings

    # Parse all migrations
    migrations = []
    for filepath in migration_files:
        try:
            info = parse_migration_file(filepath)
            if info["revision"]:
                migrations.append(info)
        except Exception as e:
            errors.append(f"Failed to parse {filepath.name}: {e}")

    # Check for duplicate revision IDs
    revision_ids: Dict[str, List[str]] = {}
    for m in migrations:
        rev = m["revision"]
        if rev not in revision_ids:
            revision_ids[rev] = []
        revision_ids[rev].append(m["file"])

    for rev, files in revision_ids.items():
        if len(files) > 1:
            errors.append(f"DUPLICATE REVISION ID '{rev}' found in: {', '.join(files)}")

    # Check for broken chain (orphaned migrations)
    all_revisions = set(revision_ids.keys())
    referenced_revisions = set()

    for m in migrations:
        referenced_revisions.update(m["down_revisions"])

    # Find the base migration (down_revision is None)
    base_migrations = [m for m in migrations if not m["down_revisions"]]
    if len(base_migrations) == 0:
        errors.append(
            "No base migration found (missing initial migration with down_revision=None)"
        )
    elif len(base_migrations) > 1:
        files = [m["file"] for m in base_migrations]
        errors.append(f"Multiple base migrations found: {', '.join(files)}")

    # Check for orphaned references (down_revision points to non-existent revision)
    for m in migrations:
        for parent in m["down_revisions"]:
            if parent not in all_revisions:
                errors.append(
                    f"Orphaned migration {m['file']}: references non-existent revision '{parent}'"
                )

    # Hand-authored ids are how the same-day collisions happened, so anything
    # written since the convention changed has to carry a generated one.
    for rev in sorted(all_revisions):
        match = LEGACY_ID_FORM.match(rev)
        if match and match.group(1) >= LEGACY_ID_SUNSET:
            errors.append(
                f"HAND-AUTHORED REVISION ID '{rev}' in {revision_ids[rev][0]}: "
                f'run `alembic revision -m "..."` and keep the id it writes. '
                f"The YYYYMMDD_SSSS form collides when two branches are open "
                f"on the same day, which is how the chain broke four times."
            )

    # Check for multiple heads (migrations that nothing depends on)
    head_revisions = all_revisions - referenced_revisions
    if len(head_revisions) > 1:
        head_files = []
        for m in migrations:
            if m["revision"] in head_revisions:
                head_files.append(f"{m['file']} ({m['revision']})")
        # An ERROR, not a warning. This script is the dedicated gate for the
        # chain and CI runs it on every push, but a fork only ever produced a
        # warning — so it exited 0 and the gate passed while `alembic upgrade
        # head` was already broken with "Multiple head revisions". The thing
        # that actually caught the two forks of 2026-08-24 was a pytest case
        # in test_alembic_migrations.py, which means the general-purpose test
        # suite was stricter than the check written for this exact problem.
        #
        # A fork is not a style preference: every deployment that runs
        # `alembic upgrade head` fails outright until somebody resolves it, and
        # on a repo where main merges several times an hour it happens to any
        # branch carrying a migration.
        errors.append(
            f"Multiple heads detected (branching): {', '.join(head_files)}. "
            f"`alembic upgrade head` fails until this is resolved — repoint "
            f"the newer migration onto the other head, or merge them."
        )

    # Print results
    print("\n" + "=" * 60)
    print("ALEMBIC MIGRATION VALIDATION REPORT")
    print("=" * 60)
    print(f"\nMigrations found: {len(migrations)}")
    print(
        f"Base migration: {base_migrations[0]['file'] if base_migrations else 'NONE'}"
    )
    print(f"Head revisions: {len(head_revisions)}")

    # Printed so nobody has to record it by hand. ALEMBIC_MIGRATIONS.md used to
    # carry a "Current Head" section that every migration PR edited — the same
    # lines every time, so it conflicted constantly and went stale whenever
    # someone forgot. Ask the chain instead.
    for head in sorted(head_revisions):
        print(f"  head -> {head}  ({revision_ids[head][0]})")

    # Only sound advice when there is one head. Told to pick a parent while the
    # chain is forked, a reader extends one branch and leaves the fork — and
    # the instruction was printed once per head, so it named two parents that
    # cannot both be right.
    if len(head_revisions) == 1:
        head = next(iter(head_revisions))
        print(f'  new migrations set down_revision = "{head}"')
    elif len(head_revisions) > 1:
        joined = ", ".join(f'"{h}"' for h in sorted(head_revisions))
        print("  the chain is FORKED — do not extend either head on its own.")
        print(
            f"  merge first: alembic merge -m \"merge heads\" {' '.join(sorted(head_revisions))}"
        )
        print(f"  (a merge revision sets down_revision = ({joined}))")

    if warnings:
        print("\n" + "-" * 40)
        print("WARNINGS:")
        for w in warnings:
            print(f"  - {w}")

    if errors:
        print("\n" + "-" * 40)
        print("ERRORS:")
        for e in errors:
            print(f"  - {e}")
        print("\n" + "=" * 60)
        print("VALIDATION FAILED")
        print("=" * 60 + "\n")
        return False, errors, warnings

    print("\n" + "=" * 60)
    print("VALIDATION PASSED")
    print("=" * 60 + "\n")
    return True, [], warnings


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description=(
            "Validate the Alembic revision chain: duplicate ids, orphaned "
            "down_revisions, multiple bases, and a forked chain."
        )
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help=(
            "Fail on warnings too. A forked chain is the only warning this "
            "script reports, and it is what breaks `alembic upgrade head` "
            "for everyone once the second branch merges — so CI runs strict."
        ),
    )
    args = parser.parse_args()

    versions_dir = backend_dir / "alembic" / "versions"

    if not versions_dir.exists():
        print(f"Error: Versions directory not found: {versions_dir}")
        sys.exit(1)

    is_valid, _errors, warnings = validate_migrations(versions_dir)
    if args.strict and warnings:
        print("Strict mode: warnings above are treated as failures.")
        sys.exit(1)
    sys.exit(0 if is_valid else 1)


if __name__ == "__main__":
    main()
