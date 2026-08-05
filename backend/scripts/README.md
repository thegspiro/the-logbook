# Backend Utility Scripts

This directory contains utility scripts for database verification, maintenance, and development tasks.

---

## Enum Verification

### `verify_database_enums.py`

Verifies that enum values in the database match the expected values defined in Python models.

**Purpose**: Prevent case mismatch bugs like the critical `organization_type` enum issue where the database had UPPERCASE values but the application expected lowercase.

**Usage:**
```bash
cd backend
python scripts/verify_database_enums.py
```

**Expected Output (Success):**
```
======================================================================
DATABASE ENUM VERIFICATION
======================================================================

✅ OrganizationType (organizations.organization_type): Database matches model

✅ IdentifierType (organizations.identifier_type): Database matches model

======================================================================
✅ ALL ENUMS VERIFIED - Database matches models
======================================================================
```

**Output on Mismatch:**
```
======================================================================
DATABASE ENUM VERIFICATION
======================================================================

❌ OrganizationType (organizations.organization_type): MISMATCH DETECTED
   Expected (from model): ['fire_department', 'ems_only', 'fire_ems_combined']
   Actual (from database): ['FIRE_DEPARTMENT', 'EMS_ONLY', 'FIRE_EMS_COMBINED']
   Missing in database: ['fire_department', 'ems_only', 'fire_ems_combined']
   Extra in database: ['FIRE_DEPARTMENT', 'EMS_ONLY', 'FIRE_EMS_COMBINED']

======================================================================
❌ VERIFICATION FAILED - Mismatches detected

RECOMMENDED ACTIONS:
1. Check if a migration needs to be run: alembic upgrade head
2. If migration is current, create a new migration to fix enum values
3. Review migration files for case mismatches
======================================================================
```

**When to Run:**
- After running database migrations
- Before deploying to production
- When debugging enum-related errors
- As part of CI/CD pipeline

**Exit Codes:**
- `0`: All enums verified successfully
- `1`: Mismatch detected
- `2`: Connection error or exception

**Requirements:**
- Database must be running
- `DATABASE_URL` environment variable must be set
- SQLAlchemy models must be importable

---

## Schema Documentation

### `generate_schema_docs.py`

Renders `docs/DATABASE_SCHEMA.md` from `Base.metadata` — every table, column,
type, key, index and constraint, plus a full foreign key map and the list of
tables that are not directly org-scoped.

The models are the right source rather than a live database: `main.py`'s
`_fast_path_init()` builds a fresh install with `Base.metadata.create_all()`,
so the models *are* the schema a new deployment gets.

**Usage:**

```bash
cd backend
python scripts/generate_schema_docs.py            # regenerate the doc
python scripts/generate_schema_docs.py --check    # CI: fail if stale
```

**Exit Codes:**
- `0`: Doc written, or (with `--check`) doc matches the models
- `1`: With `--check`, the committed doc is out of date

**Requirements:**
- No database needed — reads model metadata only
- SQLAlchemy models must be importable

Run `--check` in CI so a change under `app/models/` cannot land without the
schema reference being regenerated. That makes every schema change visible in
review, which is where "does this need a migration too?" is cheapest to ask.
See [DATABASE_SCHEMA_DRIFT.md](../../docs/DATABASE_SCHEMA_DRIFT.md) for what
happens when that question goes unasked.

---

## Adding New Scripts

When adding new utility scripts to this directory:

1. Add execute permissions: `chmod +x scripts/your_script.py`
2. Include shebang: `#!/usr/bin/env python3`
3. Add documentation to this README
4. Include usage examples and exit codes
5. Handle errors gracefully with clear messages

---

## Related Documentation

- [Enum Conventions Guide](../../docs/ENUM_CONVENTIONS.md)
- [Enum Consistency Tests](../tests/test_enum_consistency.py)
