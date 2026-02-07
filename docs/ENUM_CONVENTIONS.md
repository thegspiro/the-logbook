# Enum Conventions and Best Practices

## Overview

This document establishes conventions for defining and using enums across The Logbook application to prevent type mismatches and ensure consistency.

**CRITICAL**: Following these conventions prevents bugs like the `organization_type` enum case mismatch that caused organization creation failures.

---

## The Problem We're Preventing

### What Happened (2026-02-07)

A critical bug was discovered where:
- **Database enum values**: `FIRE_DEPARTMENT`, `EMS_ONLY`, `FIRE_EMS_COMBINED` (UPPERCASE)
- **Application expected**: `fire_department`, `ems_only`, `fire_ems_combined` (lowercase)
- **Result**: MySQL rejected all organization creation attempts with error:
  ```
  'fire_ems_combined' is not among the defined enum values
  ```

**Root Cause**: MySQL enums are **case-sensitive**. The database was created with the wrong case.

**Impact**: Complete failure of onboarding process - no organizations could be created.

---

## Enum Convention Rules

### Rule 1: Always Use Lowercase Values

**✅ CORRECT:**
```python
class OrganizationType(str, enum.Enum):
    FIRE_DEPARTMENT = "fire_department"  # Value is lowercase
    EMS_ONLY = "ems_only"
    FIRE_EMS_COMBINED = "fire_ems_combined"
```

**❌ WRONG:**
```python
class OrganizationType(str, enum.Enum):
    FIRE_DEPARTMENT = "FIRE_DEPARTMENT"  # Value is uppercase - WRONG!
    EMS_ONLY = "EMS_ONLY"
    FIRE_EMS_COMBINED = "FIRE_EMS_COMBINED"
```

**Why**: Lowercase is the standard convention in Python and prevents case-sensitivity issues across systems.

---

### Rule 2: Use snake_case for Multi-Word Values

**✅ CORRECT:**
```python
FIRE_EMS_COMBINED = "fire_ems_combined"  # snake_case
```

**❌ WRONG:**
```python
FIRE_EMS_COMBINED = "FireEmsCombined"    # PascalCase - WRONG!
FIRE_EMS_COMBINED = "fire-ems-combined"  # kebab-case - WRONG!
```

**Why**: snake_case is the Python standard and works well in URLs, identifiers, and database columns.

---

### Rule 3: Enum Name Should Match Value Pattern

**✅ CORRECT:**
```python
class OrganizationType(str, enum.Enum):
    FIRE_DEPARTMENT = "fire_department"  # Name is UPPERCASE, value is lowercase
```

**Pattern**: Class name = PascalCase, Attribute name = SCREAMING_SNAKE_CASE, Value = snake_case

---

### Rule 4: Database Migrations Must Use Exact Values

When creating enum columns in Alembic migrations:

**✅ CORRECT:**
```python
op.add_column('organizations', sa.Column(
    'organization_type',
    sa.Enum('fire_department', 'ems_only', 'fire_ems_combined', name='organizationtype'),
    nullable=False,
    server_default='fire_department'
))
```

**❌ WRONG:**
```python
# DO NOT use enum names - use the string values!
sa.Enum(OrganizationType.FIRE_DEPARTMENT, ...)  # This gets the value (OK)
sa.Enum('FIRE_DEPARTMENT', ...)  # This is uppercase (WRONG!)
```

**Important**: Always copy the exact string values from the Python enum definition.

---

### Rule 5: Frontend TypeScript Must Match Exactly

**Python Model:**
```python
class OrganizationType(str, enum.Enum):
    FIRE_DEPARTMENT = "fire_department"
    EMS_ONLY = "ems_only"
    FIRE_EMS_COMBINED = "fire_ems_combined"
```

**TypeScript (MUST MATCH):**
```typescript
type OrganizationType = 'fire_department' | 'ems_only' | 'fire_ems_combined';
```

**Frontend Form Values:**
```tsx
<option value="fire_department">Fire Department</option>
<option value="ems_only">EMS Only</option>
<option value="fire_ems_combined">Fire/EMS Combined</option>
```

---

## Validation & Testing

### Automated Tests

Run enum consistency tests before every release:

```bash
# Run pytest tests
cd backend
pytest tests/test_enum_consistency.py -v

# Expected output:
# ✅ test_organization_type_consistency PASSED
# ✅ test_identifier_type_consistency PASSED
# ✅ test_all_enum_values_lowercase PASSED
```

These tests verify:
- Database migration enum values match Python models
- Python models match TypeScript definitions
- All enum values are lowercase

---

### Database Verification Script

Verify database enum values match models:

```bash
cd backend
python scripts/verify_database_enums.py

# Expected output:
# ✅ OrganizationType: Database matches model
# ✅ IdentifierType: Database matches model
# ✅ ALL ENUMS VERIFIED
```

Run this:
- After running migrations
- Before deploying to production
- When debugging enum-related errors

---

### Startup Validation (Automatic)

The application automatically validates enums on startup:

```
2026-02-07 10:00:00 | INFO     | Validating database enum consistency...
2026-02-07 10:00:00 | INFO     | ✅ Enum consistency check passed
```

If there's a mismatch, you'll see:

```
2026-02-07 10:00:00 | WARNING  | ⚠️  Enum consistency check failed
2026-02-07 10:00:00 | WARNING  | OrganizationType: Database enum values don't match model!
2026-02-07 10:00:00 | WARNING  | Expected: ['fire_department', 'ems_only', 'fire_ems_combined']
2026-02-07 10:00:00 | WARNING  | Got: ['FIRE_DEPARTMENT', 'EMS_ONLY', 'FIRE_EMS_COMBINED']
```

**Location**: `backend/app/utils/startup_validators.py`

---

## Step-by-Step: Adding a New Enum

Follow this checklist when adding a new enum to the application:

### Step 1: Define Python Enum (Backend)

**File**: `backend/app/models/<module>.py`

```python
class MyNewEnum(str, enum.Enum):
    """Description of what this enum represents"""
    OPTION_ONE = "option_one"      # ✅ lowercase, snake_case
    OPTION_TWO = "option_two"
    OPTION_THREE = "option_three"
```

---

### Step 2: Create Pydantic Schema Enum (If Needed)

**File**: `backend/app/schemas/<module>.py`

```python
class MyNewEnumSchema(str, Enum):
    """Schema enum for API validation"""
    OPTION_ONE = "option_one"
    OPTION_TWO = "option_two"
    OPTION_THREE = "option_three"
```

**Note**: Keep values identical to the model enum.

---

### Step 3: Create Database Migration

```bash
cd backend
alembic revision -m "add_mynew_enum_column"
```

**File**: `backend/alembic/versions/YYYYMMDD_HHMM_add_mynew_enum_column.py`

```python
def upgrade() -> None:
    op.add_column('my_table', sa.Column(
        'my_column',
        sa.Enum('option_one', 'option_two', 'option_three', name='mynewenumtype'),
        nullable=False,
        server_default='option_one'  # ✅ Use lowercase default
    ))

def downgrade() -> None:
    op.drop_column('my_table', 'my_column')
    # MySQL: Enum is dropped with the column
```

**Critical**: Copy the exact lowercase values from your Python enum.

---

### Step 4: Define TypeScript Type (Frontend)

**File**: `frontend/src/types/models.ts` (or appropriate location)

```typescript
/**
 * My new enum type
 * IMPORTANT: Values must match backend exactly
 */
export type MyNewEnum = 'option_one' | 'option_two' | 'option_three';
```

---

### Step 5: Use in Frontend Forms

```tsx
const MY_NEW_ENUM_OPTIONS = [
  { value: 'option_one', label: 'Option One' },
  { value: 'option_two', label: 'Option Two' },
  { value: 'option_three', label: 'Option Three' },
];

// In your component:
<select value={formData.myNewEnum}>
  {MY_NEW_ENUM_OPTIONS.map(opt => (
    <option key={opt.value} value={opt.value}>
      {opt.label}
    </option>
  ))}
</select>
```

---

### Step 6: Add to Validation Tests

**File**: `backend/tests/test_enum_consistency.py`

Add a new test method:

```python
def test_mynew_enum_consistency(self, migration_enums, model_enums, frontend_enums):
    """Test that MyNewEnum values match across all layers"""
    db_values = set(migration_enums.get('mynewenumtype', []))
    backend_values = set(model_enums.get('MyNewEnum', []))
    frontend_values = set(frontend_enums.get('MyNewEnum', []))

    assert db_values == backend_values, f"Database vs Backend mismatch"
    assert backend_values == frontend_values, f"Backend vs Frontend mismatch"
```

---

### Step 7: Run Tests and Verification

```bash
# 1. Run migrations
cd backend
alembic upgrade head

# 2. Run enum consistency tests
pytest tests/test_enum_consistency.py::TestEnumConsistency::test_mynew_enum_consistency -v

# 3. Verify database
python scripts/verify_database_enums.py

# 4. Start application and check logs for startup validation
docker-compose up backend
# Look for: "✅ Enum consistency check passed"
```

---

## Troubleshooting Enum Issues

### Symptom: "X is not among the defined enum values"

**Error Message:**
```
'fire_ems_combined' is not among the defined enum values.
Enum name: organizationtype. Possible values: FIRE_DEPART.., EMS_ONLY, FIRE_EMS_CO..
```

**Diagnosis:**
1. Check database enum values:
   ```bash
   python scripts/verify_database_enums.py
   ```

2. Check migration files:
   ```bash
   grep -r "sa.Enum.*organizationtype" backend/alembic/versions/
   ```

3. Check model definition:
   ```python
   # In backend/app/models/user.py
   class OrganizationType(str, enum.Enum):
       FIRE_DEPARTMENT = "fire_department"  # Check this value
   ```

**Solution:**
- If database has wrong values, create a migration to fix them
- See `backend/alembic/versions/20260207_0500_fix_organization_type_enum_case.py` for example

---

### Symptom: Test Failures on Enum Consistency

**Error:**
```
AssertionError: Organization type mismatch between database and backend:
Database: ['FIRE_DEPARTMENT', 'EMS_ONLY', 'FIRE_EMS_COMBINED']
Backend:  ['fire_department', 'ems_only', 'fire_ems_combined']
```

**Solution:**
1. Check which layer has the wrong case
2. Update the incorrect layer to use lowercase
3. If database is wrong, create a migration to fix it
4. Re-run tests to verify

---

### Symptom: Startup Warning About Enum Mismatch

**Warning:**
```
WARNING  | ⚠️  Enum consistency check failed
WARNING  | OrganizationType: Database enum values don't match model!
```

**Solution:**
1. Run verification script to see exact mismatch:
   ```bash
   python scripts/verify_database_enums.py
   ```

2. Create migration to fix database enum values
3. Run migration: `alembic upgrade head`
4. Restart application and verify warning is gone

---

## Migration Pattern: Fixing Enum Case

If you need to change enum values from UPPERCASE to lowercase:

```python
def upgrade() -> None:
    """Fix enum case mismatch"""
    # Step 1: Convert to VARCHAR temporarily
    op.alter_column(
        'my_table',
        'my_column',
        type_=sa.String(50),
        existing_nullable=False,
        existing_server_default='old_default'
    )

    # Step 2: Convert back to ENUM with correct lowercase values
    op.alter_column(
        'my_table',
        'my_column',
        type_=sa.Enum('option_one', 'option_two', 'option_three', name='myenumtype'),
        existing_nullable=False,
        existing_server_default='option_one'  # lowercase!
    )
```

**Note**: This preserves existing data while fixing the enum values.

---

## CI/CD Integration

### Pre-Commit Hooks

Add to `.git/hooks/pre-commit`:

```bash
#!/bin/bash
# Run enum consistency tests before allowing commit
cd backend
pytest tests/test_enum_consistency.py -q

if [ $? -ne 0 ]; then
    echo "❌ Enum consistency tests failed. Fix before committing."
    exit 1
fi
```

### GitHub Actions

Add to `.github/workflows/tests.yml`:

```yaml
- name: Test Enum Consistency
  run: |
    cd backend
    pytest tests/test_enum_consistency.py -v
```

---

## Summary Checklist

When working with enums, always:

- ✅ Use lowercase values (`"fire_department"` not `"FIRE_DEPARTMENT"`)
- ✅ Use snake_case for multi-word values (`"fire_ems_combined"`)
- ✅ Keep database, backend, and frontend values identical
- ✅ Run enum consistency tests before committing
- ✅ Verify database after running migrations
- ✅ Check startup logs for validation warnings
- ✅ Document new enums in this guide

**Remember**: MySQL enums are case-sensitive. Always use lowercase to prevent bugs.

---

## Related Documentation

- [Error Messages Complete Guide](./ERROR_MESSAGES_COMPLETE.md)
- [Migration 20260207_0500: Organization Type Enum Fix](../backend/alembic/versions/20260207_0500_fix_organization_type_enum_case.py)
- [Enum Consistency Tests](../backend/tests/test_enum_consistency.py)
- [Database Enum Verification Script](../backend/scripts/verify_database_enums.py)
- [Startup Validators](../backend/app/utils/startup_validators.py)

---

**Document Version**: 1.0
**Last Updated**: 2026-02-07
**Author**: Claude (Sonnet 4.5)
**Status**: Official Convention
