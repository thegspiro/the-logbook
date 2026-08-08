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
so the models _are_ the schema a new deployment gets.

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

## Data Integrity

### `find_unlinked_course_requirements.py`

Finds training requirements whose `required_courses` entries do not resolve to a
course in that organization's library.

**Purpose**: `required_courses` holds **course ids** — every compliance
evaluator asks "is this member's record for one of these course ids?". Until the
course picker landed, the department Requirements page collected the field as
free text, one course _name_ per line. A name never matches a record, so those
requirements can never be completed. The picker stops new ones; this finds the
existing ones so they can be re-linked.

Read-only. Which library course a given name meant is an officer's call, so the
script suggests and does not edit.

**Usage:**

```bash
docker exec -it intranet-backend python scripts/find_unlinked_course_requirements.py
docker exec -it intranet-backend python scripts/find_unlinked_course_requirements.py --org "Falls Church"
docker exec -it intranet-backend python scripts/find_unlinked_course_requirements.py --active-only
docker exec -it intranet-backend python scripts/find_unlinked_course_requirements.py --json
```

**Example Output:**

```
Falls Church  (0f9c…)
------------------------------------------------------------------------------

  [BLOCKING] NIMS/ICS Initial Certification
      id=4b2a…  type=courses  4/4 unresolved
      - typed-in name: 'ICS-100: Introduction to the Incident Command System'
          -> likely ICS-100 [ICS100]  id=22222222-…  (partial)
      - typed-in name: 'IS-800: National Response Framework, An Introduction'
          -> no confident match in the course library

  [degraded] CPR Certification
      id=7e11…  type=certification  1/1 unresolved
      - typed-in name: 'CPR'
          -> likely CPR / BLS [CPR]  id=11111111-…  (exact)
```

`BLOCKING` marks a `courses` requirement, which needs _every_ linked course —
one unresolved entry means it can never reach 100%. `degraded` marks a
`certification` requirement, which still falls back to matching records by name,
training type and registry code.

Entries are classified as a **typed-in name** (not a UUID — the old free-text
field) or a **dangling id** (a well-formed UUID absent from this org's library:
either removed, or belonging to another organization). Courses are soft-deleted,
so a resolvable-but-archived course is reported as a note rather than a fault.

**Exit Codes:**

- `0`: Every entry resolves, or there were none to check
- `1`: At least one unresolved entry found
- `2`: Connection error or exception

**Requirements:**

- Database must be running
- SQLAlchemy models must be importable

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
