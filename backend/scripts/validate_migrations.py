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

import ast
import sys
from pathlib import Path
from typing import Dict, List, Tuple

# Add the backend directory to the path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))


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


def validate_migrations(versions_dir: Path) -> Tuple[bool, List[str]]:
    """
    Validate the migration chain.

    Returns:
        Tuple of (is_valid, list of error messages)
    """
    errors = []
    warnings = []

    # Find all migration files
    migration_files = list(versions_dir.glob("*.py"))
    migration_files = [f for f in migration_files if not f.name.startswith("__")]

    if not migration_files:
        errors.append("No migration files found!")
        return False, errors

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

    # Check for multiple heads (migrations that nothing depends on)
    head_revisions = all_revisions - referenced_revisions
    if len(head_revisions) > 1:
        head_files = []
        for m in migrations:
            if m["revision"] in head_revisions:
                head_files.append(f"{m['file']} ({m['revision']})")
        warnings.append(f"Multiple heads detected (branching): {', '.join(head_files)}")

    # Print results
    print("\n" + "=" * 60)
    print("ALEMBIC MIGRATION VALIDATION REPORT")
    print("=" * 60)
    print(f"\nMigrations found: {len(migrations)}")
    print(
        f"Base migration: {base_migrations[0]['file'] if base_migrations else 'NONE'}"
    )
    print(f"Head revisions: {len(head_revisions)}")

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
        return False, errors

    print("\n" + "=" * 60)
    print("VALIDATION PASSED")
    print("=" * 60 + "\n")
    return True, []


def main():
    """Main entry point."""
    versions_dir = backend_dir / "alembic" / "versions"

    if not versions_dir.exists():
        print(f"Error: Versions directory not found: {versions_dir}")
        sys.exit(1)

    is_valid, errors = validate_migrations(versions_dir)
    sys.exit(0 if is_valid else 1)


if __name__ == "__main__":
    main()
