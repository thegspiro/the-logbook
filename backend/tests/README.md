# Onboarding Test Suite

This directory contains comprehensive tests for The Logbook's onboarding process.

## Overview

The onboarding test suite validates the critical admin user creation and onboarding flow, ensuring:
- Admin user creation with async role assignment works correctly
- The MissingGreenlet fix (`await db.refresh(user, ['roles'])`) is validated
- Organization and role creation functions properly
- Error handling and edge cases are covered

## Running Tests

### Quick Start (Docker - Recommended)

```bash
# Run all onboarding tests
docker compose exec backend pytest tests/test_onboarding_integration.py -v

# Run with detailed output
docker compose exec backend pytest tests/test_onboarding_integration.py -vv -s

# Run a specific test
docker compose exec backend pytest tests/test_onboarding_integration.py::TestOnboardingIntegration::test_admin_user_creation_with_role_assignment -v

# Run using the convenience script
docker compose exec backend ./run_onboarding_tests.sh
```

### Local Development

If you have Python set up locally:

```bash
cd backend

# Install test dependencies (already in requirements.txt)
pip install -r requirements.txt

# Run tests
pytest tests/test_onboarding_integration.py -v
```

## Test Files

### `conftest.py`
Test configuration and fixtures:
- **Database connection**: Automatically initializes MySQL connection for test session
- **Session fixtures**: Provides clean database sessions for each test
- **Sample data**: Pre-configured test data for organizations, users, roles, etc.
- **Test isolation**: Each test runs in a transaction that's automatically rolled back

Key fixtures:
```python
@pytest.fixture(scope="session")
async def initialize_database():
    """Connects to database once per test session"""

@pytest.fixture(scope="function")
async def db_session():
    """Provides isolated database session per test"""
```

### `test_onboarding_integration.py`
Integration tests for the onboarding flow:

| Test | Purpose | Critical? |
|------|---------|-----------|
| `test_admin_user_creation_with_role_assignment` | Validates MissingGreenlet fix | ⭐ YES |
| `test_create_organization` | Organization creation | ✅ |
| `test_default_roles_creation` | Super Admin role creation | ✅ |
| `test_duplicate_admin_user_prevention` | Prevents duplicate admins | ✅ |
| `test_onboarding_status_tracking` | Status tracking | ✅ |

## Key Tests

### Critical Test: Admin User Creation with Role Assignment

```python
@pytest.mark.asyncio
async def test_admin_user_creation_with_role_assignment(...)
```

**What it tests:**
- Admin user is created successfully
- Super Admin role is assigned without errors
- The `await db.refresh(user, ['roles'])` fix works correctly
- No MissingGreenlet exceptions are raised

**Why it's critical:**
This test validates the fix for the SQLAlchemy async/lazy-loading issue that was causing 500 errors during Step 10 of onboarding.

### Organization Creation Test

```python
@pytest.mark.asyncio
async def test_create_organization(...)
```

**What it tests:**
- Organization can be created with valid data
- Organization is persisted to database
- Required fields are validated

## Test Database

The tests use the actual **MySQL database** configured in your Docker environment:
- ✅ Tests run against real MySQL engine (production-realistic)
- ✅ Same database configuration as production
- ✅ Each test runs in an isolated transaction
- ✅ Transactions are automatically rolled back after each test
- ✅ No permanent changes to your database

### How Test Isolation Works

```python
# Each test gets a fresh session
async with async_session_factory() as session:
    async with session.begin():
        yield session
        # Transaction automatically rolls back here
```

This means:
- Tests don't affect each other
- Your actual database data is never modified
- Tests are fast and reliable
- You can run tests while the app is running

## Test Fixtures

Available fixtures for writing tests:

```python
@pytest.fixture
async def db_session():
    """Provides an isolated database session"""

@pytest.fixture
def sample_org_data():
    """Sample organization data for creating test orgs"""

@pytest.fixture
def sample_admin_data():
    """Sample admin user data for creating test users"""
```

## Running Tests Before Deployment

**ALWAYS run these tests before deploying changes:**

```bash
# 1. Pull latest changes
git pull origin claude/review-frontend-pages-rb0hk

# 2. Run tests WITHOUT rebuilding (fast validation - takes ~5 seconds)
docker compose exec backend pytest tests/test_onboarding_integration.py -v

# 3. If tests pass, safe to rebuild and deploy
docker compose down
docker compose up --build
```

This workflow saves time by catching errors **before** wasting 10-30 minutes rebuilding containers!

## Expected Output

### ✅ Success

```
tests/test_onboarding_integration.py::TestOnboardingIntegration::test_admin_user_creation_with_role_assignment PASSED
tests/test_onboarding_integration.py::TestOnboardingIntegration::test_create_organization PASSED
tests/test_onboarding_integration.py::TestOnboardingIntegration::test_default_roles_creation PASSED
tests/test_onboarding_integration.py::TestOnboardingIntegration::test_duplicate_admin_user_prevention PASSED
tests/test_onboarding_integration.py::TestOnboardingIntegration::test_onboarding_status_tracking PASSED

========== 5 passed in 2.34s ==========
```

**Meaning:** Onboarding is working correctly. Safe to deploy! ✅

### ❌ Failure Example

```
tests/test_onboarding_integration.py::TestOnboardingIntegration::test_admin_user_creation_with_role_assignment FAILED

E   sqlalchemy.exc.MissingGreenlet: greenlet_spawn has not been called
```

**Meaning:** There's an async database issue. Do NOT deploy until fixed. ❌

## Troubleshooting

### Database Connection Error

```
RuntimeError: Database not initialized
```

**Solution:** The backend container must be running and database must be healthy:
```bash
docker compose ps  # Check all containers are running
docker compose up -d  # Start containers if needed
docker compose exec backend pytest tests/test_onboarding_integration.py -v
```

### Tests Are Slow

Expected performance:
- Single test: < 1 second
- Complete suite (5 tests): < 5 seconds

If slower:
- Check MySQL container is healthy: `docker compose ps`
- Check database connection: `docker compose logs mysql | tail -20`
- Verify network connectivity between containers

### Import Errors

```bash
# Ensure backend container is running
docker compose up -d backend

# Check pytest is installed
docker compose exec backend pytest --version

# If needed, install dependencies
docker compose exec backend pip install -r requirements.txt
```

### Transaction Rollback Issues

If tests seem to affect each other:
- Verify each test uses the `db_session` fixture
- Check that tests aren't committing manually
- Ensure transactions are properly isolated

## Adding New Tests

When adding new onboarding features:

```python
@pytest.mark.asyncio
async def test_your_new_feature(
    self,
    db_session: AsyncSession,
):
    """Test description"""
    service = OnboardingService(db_session)

    # Create organization first (most tests need this)
    org_data = {
        "name": "Test Fire Department",
        "type": "fire_department",
        "identifier_type": "fdid",
        "identifier_value": "12345",
        "street_address": "123 Test St",
        "city": "Test City",
        "state": "NY",
        "zip_code": "12345",
        "country": "USA",
        "phone": "555-0100",
        "email": "test@example.com",
        "timezone": "America/New_York",
    }
    org, error = await service.create_organization(**org_data)
    assert error is None

    # Test your feature
    result = await service.your_new_feature()

    # Verify
    assert result is not None
    assert result.property == expected_value
```

## Best Practices

1. ✅ **Run tests before every deployment**
2. ✅ **Write tests when fixing bugs** (prevents regression)
3. ✅ **Keep tests fast** (< 5 seconds total)
4. ✅ **Test both success and failure cases**
5. ✅ **Use descriptive test names**
6. ✅ **Use fixtures for common test data**
7. ❌ **Don't skip tests to make deployment faster**
8. ❌ **Don't manually commit/rollback in tests**

## Continuous Integration

These tests should be part of your CI/CD pipeline:

```yaml
# Example GitHub Actions workflow
- name: Start Services
  run: docker compose up -d

- name: Wait for MySQL
  run: docker compose exec -T backend python -c "import time; time.sleep(10)"

- name: Run Onboarding Tests
  run: docker compose exec -T backend pytest tests/test_onboarding_integration.py -v

- name: Clean Up
  run: docker compose down
```

## Test Coverage

Current coverage:
- ✅ Admin user creation with async role assignment (MissingGreenlet fix)
- ✅ Organization creation
- ✅ Default role creation (including Super Admin)
- ✅ Duplicate user prevention
- ✅ Onboarding status tracking

Future additions:
- [ ] Complete 10-step onboarding flow validation
- [ ] Module configuration tests
- [ ] Email/authentication setup validation
- [ ] Error recovery and rollback scenarios
- [ ] Performance tests (large datasets)
- [ ] Concurrent onboarding attempts

## Development Workflow

### Before Making Changes

```bash
# Ensure tests pass with current code
docker compose exec backend pytest tests/test_onboarding_integration.py -v
```

### After Making Changes

```bash
# Run tests to verify your changes
docker compose exec backend pytest tests/test_onboarding_integration.py -v

# If tests fail, fix the issue before committing
# If tests pass, commit and push
git add .
git commit -m "Your changes"
git push
```

### When Fixing Bugs

1. Write a test that reproduces the bug (it should fail)
2. Fix the bug
3. Run the test again (it should pass)
4. Run all tests to ensure no regressions
5. Commit both the test and the fix

## Summary

```bash
# The one command you need to remember:
docker compose exec backend pytest tests/test_onboarding_integration.py -v

# If this passes, your onboarding is working correctly.
# If it fails, DO NOT deploy until the issue is fixed.
```

The tests will catch issues like the MissingGreenlet error **before** you waste time rebuilding containers! 🎉

## Related Documentation

- Main testing guide: `/TESTING.md` (in project root)
- pytest configuration: `/backend/pytest.ini`
- Test runner script: `/backend/run_onboarding_tests.sh`
