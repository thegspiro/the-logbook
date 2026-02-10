# Testing Guide for The Logbook

This guide provides instructions for testing The Logbook, with special focus on the onboarding process.

## Quick Start

```bash
# Test the complete onboarding flow (recommended before deployment)
docker compose exec backend pytest tests/test_onboarding_integration.py -v

# Test specific functionality
docker compose exec backend pytest tests/test_onboarding_integration.py::TestOnboardingIntegration::test_admin_user_role_assignment_async_handling -v
```

## Onboarding Test Suite

### Why We Need These Tests

The onboarding process is critical - if it fails, new deployments cannot be set up. These tests validate:

1. **All 10 steps work correctly** - Organization setup through admin user creation
2. **Async database operations** - Prevents errors like the MissingGreenlet issue
3. **Role assignment** - Ensures admin users get proper permissions
4. **Data persistence** - Validates database state throughout the process
5. **Error handling** - Prevents duplicate users, invalid data, etc.

### Running Tests Before Deployment

**ALWAYS run these tests before deploying changes:**

```bash
# 1. Pull the latest changes
git pull origin claude/review-frontend-pages-rb0hk

# 2. Run onboarding tests WITHOUT rebuilding (fast)
docker compose exec backend pytest tests/test_onboarding_integration.py -v

# 3. If tests pass, rebuild and deploy
docker compose down
docker compose up --build
```

### Testing After Code Changes

If you've made changes to onboarding code, validate them:

```bash
# Test the complete flow
docker compose exec backend pytest tests/test_onboarding_integration.py::TestOnboardingIntegration::test_complete_onboarding_flow -vv -s

# Test admin user creation (where the MissingGreenlet error was)
docker compose exec backend pytest tests/test_onboarding_integration.py::TestOnboardingIntegration::test_admin_user_role_assignment_async_handling -vv -s
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

Current onboarding test coverage:

| Test | Purpose | Status |
|------|---------|--------|
| `test_complete_onboarding_flow` | All 10 steps end-to-end | ✅ |
| `test_admin_user_role_assignment_async_handling` | MissingGreenlet fix validation | ✅ |
| `test_onboarding_step_order_validation` | Step sequence enforcement | ✅ |
| `test_duplicate_admin_user_prevention` | Duplicate user protection | ✅ |
| `test_onboarding_status_persistence` | Status tracking | ✅ |
| `test_role_configuration_creates_required_roles` | Super Admin role creation | ✅ |

## Understanding Test Results

### ✅ All Tests Pass

```
tests/test_onboarding_integration.py::TestOnboardingIntegration::test_complete_onboarding_flow PASSED
tests/test_onboarding_integration.py::TestOnboardingIntegration::test_admin_user_role_assignment_async_handling PASSED
...
========== 6 passed in 2.34s ==========
```

**Meaning:** Onboarding is working correctly. Safe to deploy.

### ❌ Test Failure Example

```
tests/test_onboarding_integration.py::TestOnboardingIntegration::test_admin_user_role_assignment_async_handling FAILED

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

1. **Write a test that reproduces the issue** (test_admin_user_role_assignment_async_handling)
2. **Run the test and confirm it fails**
   ```bash
   docker compose exec backend pytest tests/test_onboarding_integration.py::TestOnboardingIntegration::test_admin_user_role_assignment_async_handling -v
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
    sample_org_data,
):
    """Test description"""
    service = OnboardingService(db_session)

    # Setup
    await service.initialize_onboarding()
    await service.save_organization_info(sample_org_data)

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

- **Single test:** < 1 second (SQLite in-memory)
- **Complete suite:** < 5 seconds (6 tests)
- **With MySQL:** < 10 seconds

If tests are slower, check:
- Database connection issues
- Excessive data creation
- Missing test isolation

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
# Tests use SQLite in-memory by default
# Check backend/tests/conftest.py if issues persist
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
