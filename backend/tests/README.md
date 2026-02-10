# Onboarding Test Suite

This directory contains comprehensive tests for The Logbook's onboarding process.

## Overview

The onboarding test suite validates the complete 10-step onboarding flow, ensuring:
- All steps can be completed successfully
- Async database operations work correctly (especially the MissingGreenlet fix)
- Admin user creation with role assignment works
- Data persistence and validation
- Error handling and edge cases

## Running Tests

### Option 1: Inside Docker Container (Recommended)

This runs tests in the same environment as production:

```bash
# Run all onboarding tests
docker compose exec backend pytest tests/test_onboarding_integration.py -v

# Run with detailed output
docker compose exec backend pytest tests/test_onboarding_integration.py -vv -s

# Run a specific test
docker compose exec backend pytest tests/test_onboarding_integration.py::TestOnboardingIntegration::test_complete_onboarding_flow -v

# Run using the convenience script
docker compose exec backend ./run_onboarding_tests.sh
```

### Option 2: Local Development

If you have Python set up locally:

```bash
cd backend

# Install test dependencies
pip install -r requirements.txt
pip install pytest pytest-asyncio

# Run tests
pytest tests/test_onboarding_integration.py -v

# Or use the script
./run_onboarding_tests.sh
```

## Test Files

### `conftest.py`
Test configuration and fixtures:
- Database setup (SQLite in-memory for fast tests)
- Async session management
- Sample data fixtures
- Test isolation (each test gets a clean database)

### `test_onboarding_integration.py`
Integration tests for the complete onboarding flow:
- **test_complete_onboarding_flow**: Tests all 10 steps end-to-end
- **test_admin_user_role_assignment_async_handling**: Validates the MissingGreenlet fix
- **test_onboarding_step_order_validation**: Ensures steps are completed in order
- **test_duplicate_admin_user_prevention**: Prevents duplicate admin creation
- **test_onboarding_status_persistence**: Validates status tracking
- **test_role_configuration_creates_required_roles**: Ensures Super Admin role is created

## Key Tests

### Critical Test: Admin User Creation with Role Assignment

This test validates the fix for the SQLAlchemy MissingGreenlet error:

```python
@pytest.mark.asyncio
async def test_admin_user_role_assignment_async_handling(...)
```

**What it tests:**
- Admin user is created successfully
- Super Admin role is assigned without errors
- The `await db.refresh(user, ['roles'])` fix works correctly
- No MissingGreenlet exceptions are raised

### Complete Flow Test

Tests the entire onboarding process:

```python
@pytest.mark.asyncio
async def test_complete_onboarding_flow(...)
```

**What it tests:**
1. Initialize onboarding
2. Create organization
3. Configure roles (including Super Admin)
4. Configure departments
5. Configure stations
6. Create admin user with role assignment
7. Verify onboarding completion

## Test Database

The tests use SQLite in-memory database by default for speed. Each test gets a clean database state.

To use MySQL for more realistic tests, modify `conftest.py`:

```python
# Change this line:
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

# To:
TEST_DATABASE_URL = f"mysql+aiomysql://root:password@mysql:3306/test_db"
```

## Continuous Integration

These tests should be run:
- ✅ Before every deployment
- ✅ After any changes to onboarding code
- ✅ As part of CI/CD pipeline
- ✅ Before merging pull requests

## Adding New Tests

When adding new onboarding features:

1. Add test fixtures to `conftest.py` if needed
2. Add integration tests to `test_onboarding_integration.py`
3. Test both success and error cases
4. Ensure tests are isolated (don't depend on each other)

Example:

```python
@pytest.mark.asyncio
async def test_new_onboarding_feature(
    db_session: AsyncSession,
    sample_org_data,
):
    service = OnboardingService(db_session)

    # Setup
    await service.initialize_onboarding()

    # Test your feature
    result = await service.new_feature()

    # Assertions
    assert result is not None
```

## Troubleshooting

### Tests fail with "no such table" error
The database schema might not be created. Check `conftest.py` and ensure `Base.metadata.create_all()` is working.

### Tests fail with "greenlet_spawn" error
This is the MissingGreenlet error we fixed. Make sure you have the latest code with the `await db.refresh(user, ['roles'])` fix.

### Tests are slow
- Using SQLite in-memory should be fast (< 1 second per test)
- If using MySQL, check database connection
- Run tests with `-v` to see which test is slow

### Import errors
Make sure you're running tests from the backend directory and all dependencies are installed.

## Test Coverage

Current test coverage for onboarding:
- ✅ Complete flow (all 10 steps)
- ✅ Admin user creation with async role assignment
- ✅ Duplicate prevention
- ✅ Step order validation
- ✅ Status persistence
- ✅ Role configuration

Future test additions:
- [ ] Department configuration edge cases
- [ ] Station configuration validation
- [ ] Custom role creation
- [ ] Error recovery and rollback
- [ ] Performance tests (large datasets)
