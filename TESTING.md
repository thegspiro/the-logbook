# Testing Guide for The Logbook

This guide provides instructions for testing The Logbook, with special focus on the onboarding process.

## Quick Start

```bash
# Test the onboarding flow (recommended before deployment)
docker compose exec backend pytest tests/test_onboarding_integration.py -v

# Test specific functionality (the critical MissingGreenlet fix)
docker compose exec backend pytest tests/test_onboarding_integration.py::TestOnboardingIntegration::test_admin_user_creation_with_role_assignment -v
```

## Onboarding Test Suite

### Why We Need These Tests

The onboarding process is critical - if it fails, new deployments cannot be set up. These tests validate:

1. **Admin user creation works correctly** - Especially the async role assignment
2. **MissingGreenlet fix** - Prevents the 500 error that was occurring at Step 10
3. **Role assignment** - Ensures admin users get Super Admin permissions
4. **Organization creation** - Validates basic organization setup
5. **Error handling** - Prevents duplicate users, invalid data, etc.

### Running Tests Before Deployment

**ALWAYS run these tests before deploying changes:**

```bash
# 1. Pull the latest changes
git pull origin main

# 2. Run onboarding tests WITHOUT rebuilding (fast)
docker compose exec backend pytest tests/test_onboarding_integration.py -v

# 3. If tests pass, rebuild and deploy
docker compose down
docker compose up --build
```

### Testing After Code Changes

If you've made changes to onboarding code, validate them:

```bash
# Test admin user creation (where the MissingGreenlet error was)
docker compose exec backend pytest tests/test_onboarding_integration.py::TestOnboardingIntegration::test_admin_user_creation_with_role_assignment -vv -s

# Test organization creation
docker compose exec backend pytest tests/test_onboarding_integration.py::TestOnboardingIntegration::test_create_organization -vv -s
```

### All Available Tests

```bash
# Run ALL onboarding tests
docker compose exec backend pytest tests/test_onboarding_integration.py -v

# Run with detailed output (shows print statements)
docker compose exec backend pytest tests/test_onboarding_integration.py -vv -s

# Run a specific test class
docker compose exec backend pytest tests/test_onboarding_integration.py::TestOnboardingIntegration -v

# Run a specific test method
docker compose exec backend pytest tests/test_onboarding_integration.py::TestOnboardingIntegration::test_complete_onboarding_flow -v

# Run with coverage report
docker compose exec backend pytest tests/test_onboarding_integration.py --cov=app/services/onboarding --cov-report=term-missing

# Using the convenience script
docker compose exec backend ./run_onboarding_tests.sh
docker compose exec backend ./run_onboarding_tests.sh -v
```

## Test Coverage

### Onboarding Tests (Backend)

| Test | Purpose | Status |
|------|---------|--------|
| `test_admin_user_creation_with_role_assignment` | MissingGreenlet fix validation | ✅ |
| `test_create_organization` | Organization creation | ✅ |
| `test_default_roles_creation` | Super Admin role creation | ✅ |
| `test_duplicate_admin_user_prevention` | Duplicate user protection | ✅ |
| `test_onboarding_status_tracking` | Status tracking | ✅ |

### Event Component Tests (Frontend - Added 2026-02-14)

Comprehensive frontend test coverage for the events module:

| Test File | Purpose | Lines |
|-----------|---------|-------|
| `EventForm.test.tsx` | Form validation, field interactions, submit handling | 460 |
| `EventCreatePage.test.tsx` | Event creation flow, API integration, navigation | 137 |
| `EventDetailPage.test.tsx` | Detail view, RSVP, duplication, delete | 694+82 |
| `EventEditPage.test.tsx` | Edit form pre-population, update submission | 243 |
| `EventsPage.test.tsx` | List view, filtering, search, pagination | 331 |

**Running event tests:**

```bash
# Run all event tests
cd frontend && npx vitest run src/pages/Event*.test.tsx src/components/EventForm.test.tsx

# Run a specific test file
cd frontend && npx vitest run src/pages/EventDetailPage.test.tsx

# Run with coverage
cd frontend && npx vitest run --coverage src/pages/Event*.test.tsx
```

**Total**: 1,865+ lines of test code covering all event components.

### Self-Check-In & QR Code Tests (Frontend - Added 2026-02-14)

| Test File | Purpose | Tests |
|-----------|---------|-------|
| `EventSelfCheckInPage.test.tsx` | Self-check-in flow, error handling, time window validation | 31 |
| `EventQRCodePage.test.tsx` | QR code display, auto-refresh, time validation | 25 |

**Running self-check-in tests:**

```bash
# Run self-check-in tests
cd frontend && npx vitest run src/pages/EventSelfCheckInPage.test.tsx

# Run QR code tests
cd frontend && npx vitest run src/pages/EventQRCodePage.test.tsx
```

### Backend Tests (204+ tests)

The backend test suite covers models, services, and API endpoints:

```bash
# Run all backend tests (requires MySQL)
cd backend && pytest

# Run with verbose output
cd backend && pytest -v

# Run specific test file
cd backend && pytest tests/test_onboarding_integration.py -v

# Run with coverage
cd backend && pytest --cov=app --cov-report=term-missing
```

**Note**: Some backend tests require a MySQL database connection and will show as errors if the database is unavailable. This is expected in local development without Docker.

### Running All Tests (Makefile)

```bash
# Run backend tests
make test-backend

# Run frontend tests
make test-frontend

# Run all tests
make test
```

## Understanding Test Results

### ✅ All Tests Pass

```
tests/test_onboarding_integration.py::TestOnboardingIntegration::test_admin_user_creation_with_role_assignment PASSED
tests/test_onboarding_integration.py::TestOnboardingIntegration::test_create_organization PASSED
tests/test_onboarding_integration.py::TestOnboardingIntegration::test_default_roles_creation PASSED
tests/test_onboarding_integration.py::TestOnboardingIntegration::test_duplicate_admin_user_prevention PASSED
tests/test_onboarding_integration.py::TestOnboardingIntegration::test_onboarding_status_tracking PASSED

========== 5 passed in 2.34s ==========
```

**Meaning:** Onboarding is working correctly. Safe to deploy.

### ❌ Test Failure Example

```
tests/test_onboarding_integration.py::TestOnboardingIntegration::test_admin_user_creation_with_role_assignment FAILED

E   sqlalchemy.exc.MissingGreenlet: greenlet_spawn has not been called
```

**Meaning:** There's an async database issue. Do NOT deploy until fixed.

### Common Test Failures

#### MissingGreenlet Error
```
sqlalchemy.exc.MissingGreenlet: greenlet_spawn has not been called
```
**Cause:** Accessing lazy-loaded relationship without proper async handling
**Fix:** Use `await db.refresh(user, ['roles'])` before accessing `user.roles`

#### Duplicate User Error
```
AssertionError: assert error2 is not None
```
**Cause:** Duplicate prevention not working
**Fix:** Check user creation logic and unique constraints

#### Step Order Violation
```
ValueError: Cannot create admin user before organization
```
**Cause:** Steps not completed in correct order
**Fix:** Ensure onboarding status is properly tracked

## Test Development Workflow

When fixing issues like we did with the MissingGreenlet error:

1. **Write a test that reproduces the issue** (test_admin_user_creation_with_role_assignment)
2. **Run the test and confirm it fails**
   ```bash
   docker compose exec backend pytest tests/test_onboarding_integration.py::TestOnboardingIntegration::test_admin_user_creation_with_role_assignment -v
   ```
3. **Fix the code** (add `await db.refresh(user, ['roles'])`)
4. **Run the test again and confirm it passes**
5. **Run ALL tests to ensure no regressions**
   ```bash
   docker compose exec backend pytest tests/test_onboarding_integration.py -v
   ```
6. **Deploy with confidence**

## Adding New Tests

When adding new onboarding features, add corresponding tests:

```python
# In tests/test_onboarding_integration.py

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

## Continuous Integration

These tests should be part of CI/CD:

```yaml
# Example GitHub Actions workflow
- name: Run Onboarding Tests
  run: |
    docker compose exec -T backend pytest tests/test_onboarding_integration.py -v
```

## Performance Benchmarks

Expected test execution times:

- **Single test:** < 1 second
- **Complete suite:** < 5 seconds (5 tests)
- **Database:** MySQL (same as production)

If tests are slower, check:
- MySQL container health: `docker compose ps`
- Database connection: `docker compose logs mysql | tail -20`
- Network connectivity between containers

## Troubleshooting

### Tests won't run
```bash
# Make sure container is running
docker compose ps

# Check if pytest is installed
docker compose exec backend pytest --version

# If not, install it
docker compose exec backend pip install pytest pytest-asyncio
```

### Database errors in tests
```bash
# Tests use MySQL database (same as production)
# Ensure MySQL container is healthy
docker compose ps
docker compose logs mysql | tail -20

# If database not initialized error:
# Make sure backend container is running
docker compose up -d backend
```

### Import errors
```bash
# Ensure you're in the backend directory
cd backend

# Or use full path
docker compose exec backend pytest /app/tests/test_onboarding_integration.py -v
```

## Best Practices

1. ✅ **Run tests before every deployment**
2. ✅ **Write tests when fixing bugs** (prevents regression)
3. ✅ **Keep tests fast** (< 5 seconds total)
4. ✅ **Test both success and failure cases**
5. ✅ **Use descriptive test names**
6. ✅ **Don't skip tests to make deployment faster** (you'll regret it)

## Resources

- Test documentation: `backend/tests/README.md`
- Test configuration: `backend/pytest.ini`
- Test fixtures: `backend/tests/conftest.py`
- Onboarding tests: `backend/tests/test_onboarding_integration.py`

## Summary

```bash
# The one command you need to remember:
docker compose exec backend pytest tests/test_onboarding_integration.py -v

# If this passes, your onboarding is working correctly.
# If it fails, DO NOT deploy until the issue is fixed.
```
