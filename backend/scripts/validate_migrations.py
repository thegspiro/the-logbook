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

import sys
import os
from pathlib import Path
from typing import Dict, List, Set, Tuple

# Add the backend directory to the path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))


def parse_migration_file(filepath: Path) -> Dict[str, str]:
    """Extract revision info from a migration file."""
    revision = None
    down_revision = None

    with open(filepath, 'r') as f:
        content = f.read()

    # Parse revision
    for line in content.split('\n'):
        line = line.strip()
        if line.startswith('revision') and '=' in line:
            # Handle both: revision = 'xxx' and revision: str = 'xxx'
            parts = line.split('=', 1)
            if len(parts) == 2:
                revision = parts[1].strip().strip("'\"")
        elif line.startswith('down_revision') and '=' in line:
            parts = line.split('=', 1)
            if len(parts) == 2:
                value = parts[1].strip()
                if value == 'None' or value == "None":
                    down_revision = None
                else:
                    down_revision = value.strip("'\"")

    return {
        'file': filepath.name,
        'revision': revision,
        'down_revision': down_revision,
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
    migration_files = list(versions_dir.glob('*.py'))
    migration_files = [f for f in migration_files if not f.name.startswith('__')]

    if not migration_files:
        errors.append("No migration files found!")
        return False, errors

    # Parse all migrations
    migrations = []
    for filepath in migration_files:
        try:
            info = parse_migration_file(filepath)
            if info['revision']:
                migrations.append(info)
        except Exception as e:
            errors.append(f"Failed to parse {filepath.name}: {e}")

    # Check for duplicate revision IDs
    revision_ids: Dict[str, List[str]] = {}
    for m in migrations:
        rev = m['revision']
        if rev not in revision_ids:
            revision_ids[rev] = []
        revision_ids[rev].append(m['file'])

    for rev, files in revision_ids.items():
        if len(files) > 1:
            errors.append(f"DUPLICATE REVISION ID '{rev}' found in: {', '.join(files)}")

    # Check for broken chain (orphaned migrations)
    all_revisions = set(revision_ids.keys())
    referenced_revisions = set()

    for m in migrations:
        if m['down_revision']:
            referenced_revisions.add(m['down_revision'])

    # Find the base migration (down_revision is None)
    base_migrations = [m for m in migrations if m['down_revision'] is None]
    if len(base_migrations) == 0:
        errors.append("No base migration found (missing initial migration with down_revision=None)")
    elif len(base_migrations) > 1:
        files = [m['file'] for m in base_migrations]
        errors.append(f"Multiple base migrations found: {', '.join(files)}")

    # Check for orphaned references (down_revision points to non-existent revision)
    for m in migrations:
        if m['down_revision'] and m['down_revision'] not in all_revisions:
            errors.append(f"Orphaned migration {m['file']}: references non-existent revision '{m['down_revision']}'")

    # Check for multiple heads (migrations that nothing depends on)
    head_revisions = all_revisions - referenced_revisions
    if len(head_revisions) > 1:
        head_files = []
        for m in migrations:
            if m['revision'] in head_revisions:
                head_files.append(f"{m['file']} ({m['revision']})")
        warnings.append(f"Multiple heads detected (branching): {', '.join(head_files)}")

    # Print results
    print("\n" + "=" * 60)
    print("ALEMBIC MIGRATION VALIDATION REPORT")
    print("=" * 60)
    print(f"\nMigrations found: {len(migrations)}")
    print(f"Base migration: {base_migrations[0]['file'] if base_migrations else 'NONE'}")
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
    versions_dir = backend_dir / 'alembic' / 'versions'

    if not versions_dir.exists():
        print(f"Error: Versions directory not found: {versions_dir}")
        sys.exit(1)

    is_valid, errors = validate_migrations(versions_dir)
    sys.exit(0 if is_valid else 1)


if __name__ == '__main__':
    main()
