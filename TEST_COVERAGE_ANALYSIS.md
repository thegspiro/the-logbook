# Test Coverage Analysis

## Executive Summary

The Logbook has **292 backend tests** across 11 test files and **7 frontend test files** (~183 test cases) covering the Events module. While the existing tests are well-structured, test coverage is heavily concentrated in a few areas while large portions of the codebase have **zero test coverage**. The most critical gaps are in authentication/security, the API endpoint layer, and the vast majority of frontend pages and modules.

> **Updated 2026-02-22:** Added 40 inventory module tests (`test_inventory_extended.py`) covering departure clearance lifecycle, notification netting, batch operations, label generation, category management, and pool item validation.

---

## Current Coverage Inventory

### Backend Tests (292 tests across 11 files)

| Test File | Tests | Type | What It Covers |
|-----------|-------|------|----------------|
| `test_training.py` | 72 | Unit/Structural | Training models, schemas, enums, registry data |
| `test_database_schema.py` | 56 | Structural | DB schema integrity, FKs, indexes, naming |
| `test_inventory_extended.py` | 40 | Integration | Departure clearance, notification netting, batch ops, labels, categories, pool items |
| `test_docker_config.py` | 35 | Structural | Dockerfiles, compose config, health endpoints |
| `test_changelog_fixes.py` | 30 | Regression | Cross-module regression catches |
| `test_docker_integration.py` | 17 | Integration | Docker image builds, container startup |
| `test_qr_check_in.py` | 14 | Unit | QR check-in time validation, self-check-in |
| `test_alembic_migrations.py` | 10 | Structural | Migration chain integrity |
| `test_enum_consistency.py` | 7 | Structural | Cross-layer enum alignment |
| `test_enum_values.py` | 6 | Unit/Integration | Enum DB insertion and querying |
| `test_onboarding_integration.py` | 5 | Integration | Onboarding flow, admin creation |

### Frontend Tests (7 files, ~183 test cases)

| Test File | Tests | What It Covers |
|-----------|-------|----------------|
| `EventDetailPage.test.tsx` | ~45 | Event detail, RSVPs, modals, permissions |
| `EventSelfCheckInPage.test.tsx` | ~38 | Check-in flow, error states, retries |
| `EventQRCodePage.test.tsx` | ~35 | QR generation, auto-refresh, time validation |
| `EventsPage.test.tsx` | ~26 | Events list, filtering, permissions |
| `EventForm.test.tsx` | ~25 | Form rendering, validation, conditional fields |
| `EventEditPage.test.tsx` | ~10 | Edit form pre-fill, update submission |
| `EventCreatePage.test.tsx` | ~4 | Create flow, error handling |

---

## Coverage Gap Analysis

### Backend: Source Modules vs Test Coverage

| Layer | Total Files | Files With Direct Tests | Coverage |
|-------|-------------|------------------------|----------|
| API Endpoints (`api/v1/endpoints/`) | 36 | 0 | **0%** |
| Services (`services/`) | 47 | 3 (onboarding, QR check-in via event, inventory) | **~6%** |
| Models (`models/`) | 22 | 1 (training) | **~5%** |
| Schemas (`schemas/`) | 27 | 1 (training) | **~4%** |
| Core (`core/`) | 13 | 0 | **0%** |
| Utils (`utils/`) | 2 | 0 | **0%** |

### Frontend: Source Modules vs Test Coverage

| Layer | Total Files | Files With Tests | Coverage |
|-------|-------------|-----------------|----------|
| Pages (`pages/`) | 89 .tsx files | 6 (all Event*) | **~7%** |
| Components (`components/`) | 22 .tsx files | 1 (EventForm) | **~5%** |
| Hooks (`hooks/`) | 7 files | 0 | **0%** |
| Services (`services/`) | 6 files | 0 | **0%** |
| Stores (`stores/`) | 1 file | 0 | **0%** |
| Utils (`utils/`) | 4 files | 0 | **0%** |
| Modules (apparatus) | 8 source files | 0 | **0%** |
| Modules (onboarding) | 26 source files | 0 | **0%** |
| Modules (prospective-members) | 12 source files | 0 | **0%** |
| Modules (public-portal) | 8 source files | 0 | **0%** |
| Modules (membership) | 3 source files | 0 | **0%** |

---

## Priority Recommendations

The recommendations below are ordered by risk and impact. Each area includes why it matters, what to test, and the approximate scope.

### Priority 1: Authentication & Security (Backend) -- CRITICAL

**Why:** The auth and security layer is the most sensitive code in the application. A bug here could expose user data, allow privilege escalation, or enable unauthorized access. There are currently **zero tests** for these 6,428 lines of security code.

**Untested files:**
- `core/security.py` (629 lines) -- JWT token creation/validation, password hashing, CSRF
- `core/permissions.py` (1,306 lines) -- Permission checking, role-based access control
- `core/security_middleware.py` (922 lines) -- Rate limiting, IP blocking, request validation
- `services/auth_service.py` (715 lines) -- Login, registration, password reset, token refresh
- `services/ip_security_service.py` (667 lines) -- IP allowlisting/blocklisting, geo-fencing
- `services/security_monitoring.py` (753 lines) -- Intrusion detection, audit logging
- `core/public_portal_security.py` (452 lines) -- API key validation, public access controls
- `api/v1/endpoints/auth.py` (623 lines) -- Auth HTTP endpoints

**Recommended tests:**
- JWT token generation and validation (expiry, tampering, refresh)
- Password hashing and verification
- Login flow: success, wrong password, locked account, rate limiting
- Registration: valid data, duplicate email, weak password
- Permission checker: role hierarchy, permission inheritance, org isolation
- CSRF token validation
- Rate limiter: request counting, window expiry, per-IP limits
- IP security: block/allow lists, geo-IP enforcement
- Session management: token refresh, logout, concurrent sessions

---

### Priority 2: API Endpoint Tests (Backend) -- HIGH

**Why:** None of the 36 API endpoint files have HTTP-level tests. The endpoints are the boundary between the frontend and backend -- input validation, error responses, auth enforcement, and multi-tenancy isolation all happen here. The existing tests exercise models and services in isolation but never test the full request/response cycle.

**Largest untested endpoint files:**
- `endpoints/facilities.py` (95,305 bytes) -- Facility management CRUD
- `endpoints/apparatus.py` (77,418 bytes) -- Apparatus tracking
- `endpoints/training.py` (68,660 bytes) -- Training records and courses
- `endpoints/elections.py` (55,040 bytes) -- Voting and ballot management
- `endpoints/events.py` (50,205 bytes) -- Event management
- `endpoints/scheduling.py` (42,617 bytes) -- Shift scheduling
- `endpoints/inventory.py` (38,774 bytes) -- Equipment inventory
- `endpoints/users.py` (35,890 bytes) -- User management
- `endpoints/external_training.py` (33,378 bytes) -- External training integration
- `endpoints/minutes.py` (31,240 bytes) -- Meeting minutes

**Recommended approach:**
- Use FastAPI's `TestClient` (or `httpx.AsyncClient` with `ASGITransport`) to test endpoints
- Verify auth enforcement: unauthenticated requests return 401, unauthorized return 403
- Verify input validation: malformed data returns 422 with proper error messages
- Verify multi-tenant isolation: users in org A cannot access org B's resources
- Verify proper HTTP status codes for CRUD operations (201 on create, 404 on missing, etc.)

---

### Priority 3: Auth Store & Frontend Services -- HIGH

**Why:** The `authStore` manages authentication state (login, logout, token storage, permission checks) and is used by nearly every page. The `api.ts` service file is the central API client. Bugs here affect the entire application.

**Untested files:**
- `stores/authStore.ts` -- Login/logout flow, token persistence, permission checks
- `services/api.ts` -- API client, request interceptors, error handling
- `utils/errorHandling.ts` -- Error normalization (partially validated by `test_changelog_fixes.py` but no JS-level tests)
- `utils/passwordValidation.ts` -- Password strength rules
- `utils/dateFormatting.ts` -- Date display logic
- `utils/eventHelpers.ts` -- Event utility functions

**Recommended tests:**
- authStore: login sets tokens in localStorage, logout clears them, loadUser parses JWT, checkPermission works correctly, error states set properly
- api.ts: request interceptor attaches auth header, 401 response triggers logout, error responses are normalized
- passwordValidation: strength rules match backend requirements
- dateFormatting: edge cases (null dates, timezone handling, relative dates)

---

### Priority 4: Core Business Services (Backend) -- HIGH

**Why:** The largest and most complex business logic lives in the service layer. Only 2 of 47 service files have any tests at all. Bugs in services like elections (ballot integrity), scheduling (shift coverage), or membership pipeline (applicant tracking) directly impact users.

**Largest untested services (by line count):**
- `election_service.py` (2,925 lines) -- Ballot creation, vote casting, result tallying
- `facilities_service.py` (2,466 lines) -- Facility inspections, maintenance tracking
- `apparatus_service.py` (2,259 lines) -- Apparatus checks, maintenance, assignments
- `scheduling_service.py` (1,701 lines) -- Shift templates, assignments, swap requests
- `membership_pipeline_service.py` (1,486 lines) -- Applicant stages, conversions
- `event_service.py` (1,406 lines) -- Event CRUD, attendance, RSVPs
- `inventory_service.py` (1,415 lines) -- Item tracking, checkouts, notifications
- `email_service.py` (677 lines) -- Email sending, template rendering
- `role_service.py` (611 lines) -- Role CRUD, permission assignment
- `auth_service.py` (715 lines) -- (also Priority 1)

**Recommended tests:**
- Election service: ballot integrity, vote deduplication, result accuracy, edge cases in ranked-choice
- Scheduling service: shift conflict detection, swap approval logic, coverage calculations
- Event service: RSVP limits, time window enforcement, cancellation cascades
- Inventory service: checkout/return tracking, overdue notifications, org isolation

---

### Priority 5: Frontend Feature Modules -- MEDIUM

**Why:** Five feature modules (apparatus, onboarding, prospective-members, public-portal, membership) contain 57 source files with zero test coverage. The onboarding module is especially important since it's the entry point for new deployments.

**Untested modules:**
- **Onboarding** (26 files) -- 15 wizard pages, hooks for auto-save/session/storage, security init, validation utils
- **Prospective Members** (12 files) -- Pipeline kanban, applicant cards, stage configuration
- **Apparatus** (8 files) -- Vehicle/equipment detail, form, list pages
- **Public Portal** (8 files) -- API keys, access logs, configuration, data whitelist
- **Membership** (3 files) -- Membership store and routing

**Recommended tests:**
- Onboarding wizard: step navigation, validation per step, auto-save, session recovery
- Prospective members: kanban drag-and-drop, stage transitions, applicant conversion
- Apparatus: form validation, status badge rendering, detail page data display

---

### Priority 6: Frontend Pages (Non-Event) -- MEDIUM

**Why:** 83 of 89 page files have no tests. While not all pages are equally critical, key pages like Login, Dashboard, Members, Training, and Scheduling are used daily.

**High-value untested pages:**
- `LoginPage.tsx`, `RegisterPage.tsx`, `ForgotPasswordPage.tsx`, `ResetPasswordPage.tsx` -- Auth flows
- `Dashboard.tsx` -- Primary landing page, data aggregation
- `Members.tsx`, `MemberProfilePage.tsx`, `MemberListPage.tsx` -- Core member management
- `TrainingDashboardPage.tsx`, `TrainingAdminPage.tsx`, `MyTrainingPage.tsx` -- Training workflows
- `SchedulingPage.tsx`, `ShiftAssignmentsPage.tsx`, `ShiftTemplatesPage.tsx` -- Scheduling
- `ElectionsPage.tsx`, `ElectionDetailPage.tsx`, `BallotVotingPage.tsx` -- Election voting
- `InventoryPage.tsx`, `InventoryCheckoutsPage.tsx` -- Equipment tracking
- `RoleManagementPage.tsx`, `UserPermissionsPage.tsx` -- Access control UI

---

### Priority 7: Backend Schemas & Model Validation -- LOW-MEDIUM

**Why:** Only the training module's schemas and models have unit tests. Pydantic schemas are the input validation boundary for all API endpoints. If schemas allow invalid data through, the database or business logic may fail unpredictably.

**Untested schemas (27 files):**
- `auth.py`, `user.py` -- User registration/update validation
- `election.py` -- Ballot and vote data validation
- `scheduling.py` -- Shift and schedule data validation
- `facilities.py` -- Facility and inspection data validation
- `inventory.py` -- Item and checkout data validation
- All other schema files

**Recommended tests:**
- Valid data passes schema validation
- Invalid data (missing required fields, wrong types, out-of-range values) raises `ValidationError`
- Edge cases: empty strings, extremely long strings, special characters, boundary values

---

### Priority 8: Backend Utilities & Image Validator -- LOW-MEDIUM

**Why:** `image_validator.py` (361 lines) handles file upload validation -- a common attack vector for web applications. `startup_validators.py` validates configuration at boot time.

**Recommended tests:**
- Image validator: rejects non-image files, rejects oversized files, rejects files with malicious headers, accepts valid images
- Startup validators: missing env vars detected, invalid configuration caught

---

## Structural Observations

### What the Existing Tests Do Well

1. **Schema integrity testing** -- The database schema tests (`test_database_schema.py`, 56 tests) thoroughly validate FK integrity, indexing, naming conventions, and multi-tenancy enforcement. This catches drift between models and migrations.
2. **Cross-layer consistency** -- Enum consistency tests ensure backend Python enums, database ENUM columns, and frontend TypeScript enums stay aligned.
3. **Regression prevention** -- `test_changelog_fixes.py` encodes specific past bugs as regression tests.
4. **Infrastructure validation** -- Docker and migration chain tests catch deployment issues before they reach production.
5. **Event module frontend** -- The event tests are comprehensive and well-patterned with proper mocking, permission testing, and accessibility checks.

### What's Missing Structurally

1. **No API-level tests** -- There are no tests that send HTTP requests to endpoints. The `TestClient` / `httpx.AsyncClient` pattern is not used anywhere.
2. **No service-level unit tests with mocked dependencies** -- The only service tests use real database sessions or mock the entire session. There are no tests that mock specific repository calls to test business logic in isolation.
3. **No frontend integration/E2E tests** -- Playwright is configured (`playwright.config.ts` exists) but there are no Playwright test files in the repository.
4. **No CI pipeline** -- No `.github/workflows/` directory exists. Tests must be run manually.
5. **Coverage thresholds are configured but likely unmet** -- The frontend `vitest.config.ts` sets thresholds at 80% lines / 80% functions / 75% branches / 80% statements, but with only 7 test files covering the Events module, these thresholds are almost certainly not passing.

---

## Recommended Implementation Order

For maximum risk reduction with minimal effort:

1. **Auth service + security unit tests** -- These protect against the highest-impact bugs (unauthorized access, data exposure). Write tests for `auth_service.py`, `security.py`, and `permissions.py` using mocked database sessions.

2. **API endpoint smoke tests** -- Create a `test_api_auth.py` that tests the auth endpoints with `TestClient`. Then expand to cover the top 5-6 most-used endpoint files. Focus on auth enforcement (401/403) and input validation (422).

3. **authStore and errorHandling frontend tests** -- These are pure logic with minimal UI, making them fast to test and high-value since they're used everywhere.

4. **Election and scheduling service tests** -- These are the most complex business logic modules and have the highest consequence of bugs (election integrity, shift coverage gaps).

5. **Frontend Login/Dashboard page tests** -- Follow the existing Event test patterns to cover the most-used pages.

6. **Set up CI** -- Add a GitHub Actions workflow to run `pytest` and `vitest` on pull requests. Without CI, test coverage will erode over time.
