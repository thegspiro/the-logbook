# Changelog

All notable changes to The Logbook project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added - Location Kiosk Display for Tablets (2026-02-18)

#### Public Kiosk Display System
- **New page: Location Kiosk Display (`/display/:code`)**: Public, unauthenticated page designed for tablets left in rooms. Automatically shows the current event's QR code for member check-in and cycles to the next event when it starts.
- **Display codes**: Each location gets a unique, non-guessable 8-character display code (alphanumeric, ambiguous chars removed). Codes are auto-generated on location creation and backfilled for existing locations.
- **Auto-refresh**: Kiosk page polls the backend every 30 seconds for event updates. Shows connection status indicator and live clock.
- **Multi-event support**: When multiple events overlap in the same room, the display auto-rotates between them every 10 seconds with dot indicators.
- **Idle state**: When no events are active, shows a clean "No Active Events" screen with messaging that QR codes will appear automatically.
- **New public API endpoint**: `GET /api/public/v1/display/{code}` — returns location name and current events with QR check-in data. No authentication required. Only exposes non-sensitive data (event name, type, time — no descriptions or member data).
- **Kiosk URL on Locations page**: Each room card now shows its kiosk display URL (`/display/{code}`) with one-click copy to clipboard.

#### Security Model
- The display page is intentionally public — it shows the same information you'd see on a printed flyer taped to a door (event name, room, time, QR code).
- Authentication happens on the **scanning member's device** when they check in via `POST /events/{id}/self-check-in`.
- Display codes use `secrets.choice()` for cryptographic randomness. The 8-character code space (32^8 = ~1.1 trillion combinations) makes brute-force enumeration impractical.

### Added - Unified Location Architecture (2026-02-18)

#### Location ↔ Facility Bridge
- **`facility_id` FK on Location model**: When the Facilities module is enabled, each Location record can optionally reference a Facility for deep building management data (maintenance, inspections, utilities, etc.). The `locations` table becomes the universal "place picker" for all modules regardless of which module is active.
- **Locations as single source of truth**: Events, Training, and Meetings all reference `locations.id` — turning Facilities on or off doesn't break any location references.

#### Training Location Integration
- **`location_id` FK on TrainingRecord model**: Training records can now reference wizard-created locations instead of relying on free-text strings. The existing `location` text field is preserved as a fallback for "Other Location" entries.
- **Location dropdown on Create Training Session page**: Replaces the free-text location input with a proper dropdown that loads from `locationsService.getLocations()`, matching the pattern used by EventForm. Includes "Other (off-site / enter manually)" option for non-standard venues.
- **Selected location details**: When a location is selected, shows address, building, floor, and capacity information below the dropdown.
- **Review step updated**: The training session review step now shows the selected location name from the dropdown instead of raw text.

#### Location Setup Wizard Enhancement
- **Address fields in list endpoint**: The `GET /locations` API now returns `address`, `city`, `state`, `zip`, and `facility_id` in the list response, enabling richer display in dropdowns and cards.

### Fixed - Training Admin Dashboard Disconnect (2026-02-18)

#### Compliance Matrix Rewrite
- **Root cause**: The compliance matrix endpoint used broken matching logic — it tried to match training records to requirements by `course_id` (which doesn't exist on requirements) or exact `course_name == requirement.name` (which never matches for hours-based requirements like "Annual Training Requirement")
- **Requirement-type-aware matching**: The compliance matrix now evaluates each member × requirement using the correct strategy per requirement type:
  - **HOURS**: Sums completed training hours matching `training_type` within the frequency date window, compares to `required_hours`
  - **COURSES**: Checks if all required `course_id`s have completed records
  - **CERTIFICATION**: Matches by `training_type`, name substring, or certification number
  - **SHIFTS/CALLS**: Counts matching records within the date window
  - **Others**: Falls back to `training_type` or name-based matching
- **Frequency-aware date windows**: All compliance evaluations now use proper date windows (annual, biannual, quarterly, monthly, one-time) instead of ignoring the requirement's frequency
- **Active-only filtering**: The compliance matrix now only shows active requirements (previously showed all, including inactive ones)

#### Competency Matrix (Heat Map) Fix
- **Same fixes applied**: The competency matrix service (`CompetencyMatrixService`) now uses the same frequency-aware, type-aware evaluation logic
- **Hours requirements properly evaluated**: Previously just checked for any matching record; now sums hours and compares to `required_hours`

#### Training Service Consistency
- **`check_requirement_progress()` fixed**: Now uses proper frequency-aware date windows for biannual, quarterly, monthly, and one-time requirements (previously fell back to `start_date`/`due_date` which may not be set)

#### Officer Dashboard Compliance
- **Improved compliance calculation**: The Training Officer Dashboard now calculates member compliance based on actual requirement completion (hours against requirements) rather than only checking for expired certifications

### Fixed - My Training Page & Build Errors (2026-02-18)

#### My Training Page Cleanup
- **Removed "Average Rating" stat card**: The Avg Rating box on the My Training overview was not useful for members and has been removed
- **Removed "Shifts" stat card**: The Shifts count (shift completion reports) was not relevant to the My Training overview and has been removed
- **Renamed "Annual Requirements" to "Requirements"**: Label is now generic since the system supports all requirement frequencies

#### Requirements Compliance Fix
- **Fixed requirements showing N/A**: The My Training requirements compliance calculation was filtering to annual-frequency requirements only. Biannual, quarterly, monthly, and one-time requirements were excluded, causing the stat to show "N/A" when only non-annual requirements existed
- **All frequencies now included**: The backend requirements query now includes all active requirements with frequency-appropriate evaluation windows (annual=calendar year, biannual=2-year window, quarterly=current quarter, monthly=current month, one-time=all-time)

#### Rank Permission Restriction
- **Rank changes restricted**: Member rank can now only be changed by users with `members.manage` permission (Chief, membership coordinator) or admin wildcard. Regular members can no longer change their own rank through profile editing
- **Added `rank` field to User type**: The frontend `User` interface was missing the `rank` field, causing TypeScript build errors in `CreateTrainingSessionPage.tsx`

#### Additional Build Fixes
- **Missing `BookOpen` import**: Added missing `BookOpen` lucide-react icon import in `MinutesPage.tsx` that caused TypeScript build failure

### Fixed - TypeScript Build Errors (2026-02-18)

#### API Service Layer Completeness
- **Missing scheduling methods**: Added 30+ methods to `schedulingService` including shift calls (CRUD), shift assignments (CRUD + confirm), swap requests (CRUD + review), time-off requests (CRUD + review), shift attendance (get/update/delete), templates (CRUD), patterns (CRUD + generate), and reports (member hours, coverage, call volume, availability)
- **Missing event settings methods**: Added `getModuleSettings()` and `updateModuleSettings()` to `eventService` for the Events Settings page
- **Missing OAuth methods**: Added `getGoogleOAuthUrl()` and `getMicrosoftOAuthUrl()` to `authService` for SSO login flows
- **Missing organization method**: Added `previewNextMembershipId()` to `organizationService` for membership ID preview during member creation
- **Missing role method**: Added `getUserPermissions()` to `roleService` for the User Permissions page
- **Missing training approval methods**: Added `getApprovalData()` and `submitApproval()` to `trainingSessionService`
- **Missing member creation field**: Added `membership_id` to `createMember` type parameter
- **New service exports**: Added `memberStatusService` (archived members, property returns, tier management), `prospectiveMemberService` (pipelines, prospects, election packages), and `scheduledTasksService` (list/run background tasks) with `ScheduledTask` type

#### Type Definitions
- **Missing user types**: Added `ArchivedMember`, `OverdueMember`, `MembershipTier`, `MembershipTierBenefits`, `MembershipTierConfig`, `PropertyReturnReport` to `types/user.ts`
- **Missing user field**: Added `membership_number` to `User` interface for member list display

### Fixed - CSS Accessibility & Theme Consistency (2026-02-17)

#### Onboarding Module Theme Migration
- **23 onboarding files refactored**: Converted all hardcoded Tailwind color classes to CSS theme variables across the entire onboarding module
- **Converted patterns**: `bg-slate-900` → `bg-theme-bg-from`, `text-white` → `text-theme-text-primary`, `bg-white/10` → `bg-theme-surface`, `border-white/20` → `border-theme-surface-border`, `text-slate-300` → `text-theme-text-secondary`, `text-slate-400` → `text-theme-text-muted`, `bg-slate-800/50` → `bg-theme-surface-secondary`, input styling standardized to `bg-theme-input-bg border-theme-input-border`
- **Preserved semantic colors**: All accent/status colors (red, green, blue, purple, amber, etc.) for buttons, badges, alerts, and interactive states left intentionally unchanged

### Added - New Application Pages (2026-02-17)

#### Scheduling Module
- **ShiftCallsPanel**: Component for managing calls attached to shifts with create/update/delete
- **ShiftAssignmentsPage**: Full shift assignment management with swap requests and time-off handling
- **ShiftAttendancePage**: Shift attendance tracking with bulk update support
- **ShiftTemplatesPage**: Shift template and pattern management with auto-generation from patterns
- **SchedulingReportsPage**: Scheduling reports including member hours, coverage, call volume, and availability

#### Member & Admin Pages
- **MemberLifecyclePage**: Archived member management, overdue property returns, membership tier configuration, and property return report previews
- **EventsSettingsPage**: Event module configuration (event types, defaults, QR codes, cancellation policies)
- **UserPermissionsPage**: Individual user permission and role assignment viewer
- **TrainingApprovalPage**: Token-based training session approval workflow
- **ScheduledTasksPage**: View and manually trigger scheduled background tasks
- **ProspectiveMembersPage** (standalone): Pipeline management, prospect creation, election packages

### Changed - Navigation & Structure (2026-02-17)
- **Module restructuring**: Admin hubs with clean member/admin navigation separation
- **User profile editing**: Self-service and admin profile editing capabilities
- **Training navigation**: Training sub-items added to sidebar and top navigation; `/training` routes to `MyTrainingPage`
- **Pipeline settings nav**: Added Pipeline Settings entry for prospective members
- **Full nav coverage**: All missing pages added to navigation menus
- **Membership ID settings**: Added Membership ID Number settings to Organization Settings
- **Department timezone**: All date/time displays now use department's local timezone instead of UTC
- **Dashboard training hours**: Fixed Dashboard showing 0 training hours despite completed courses
- **Role assignment fix**: Fixed role assignment permissions for Officers and Vice President roles
- **Training pipeline fix**: Fixed save error, added knowledge tests and milestone reorder

### Added - System-Wide Theme Support (2026-02-15)

#### Theme System
- **ThemeProvider context**: New `ThemeContext` with support for light, dark, and system (auto-detect) themes
- **CSS custom properties**: Theme colors defined as CSS variables in `:root` (light) and `.dark` (dark), enabling centralized theme management instead of per-component hardcoding
- **Tailwind dark mode**: Configured `darkMode: 'class'` with custom `theme-*` color utilities that reference CSS variables
- **Theme toggle**: Added theme cycle button (Dark → Light → System) to both TopNavigation and SideNavigation
- **Theme persistence**: Saves preference to `localStorage`, defaults to dark mode, respects `prefers-color-scheme` in system mode
- **AppLayout**: Background gradient now uses CSS variables, automatically adapting to the selected theme

#### Dashboard Redesign
- **Member-focused dashboard**: Replaced admin-oriented dashboard (setup status, getting started guide) with member-focused content
- **Hours tracking cards**: Shows total, training, standby, and administrative hours for the current month
- **Notifications widget**: Displays recent notifications with unread indicators and mark-as-read functionality
- **Upcoming shifts widget**: Shows the member's upcoming shifts for the next 30 days with date, time, and officer info
- **Training progress**: Retained training enrollment progress with deadlines and next steps
- **Added API methods**: `schedulingService.getMyShifts()` and `schedulingService.getMyAssignments()` for member-specific shift data

### Fixed - UI Issues (2026-02-15)

#### Footer & Layout
- **Dashboard footer**: Fixed footer floating mid-page by using flexbox sticky footer pattern (`flex-col` + `flex-1` + `mt-auto`)

#### Election Module Dark Theme
- **CandidateManagement**: Converted from invisible light theme to dark theme with proper contrast
- **BallotBuilder**: Converted secretary ballot creation interface to dark theme
- **ElectionBallot**: Converted voter-facing ballot interface to dark theme
- **ElectionResults**: Converted results display to dark theme
- **MeetingAttendance**: Converted attendance tracker to dark theme

#### Election Timezone Handling
- **Frontend**: Replaced `.toISOString().slice(0,16)` with local datetime formatting helper to prevent UTC conversion of `datetime-local` input values
- **Backend**: Changed `datetime.utcnow()` to `datetime.now()` in election service comparisons to match user-entered naive datetimes

### Fixed - Duplicate Index Definitions Crashing Startup (2026-02-15)

#### Database Model Fixes
- **Location model crash fix**: Removed duplicate `ix_locations_organization_id` index that crashed `Base.metadata.create_all()` on MySQL — the `organization_id` column had both `index=True` (auto-generating the index) and an explicit `Index("ix_locations_organization_id", ...)` in `__table_args__` with the same name, causing a `Duplicate key name` error on every fresh database initialization
- **VotingToken model crash fix**: Same issue — `token` column had `index=True` plus an explicit `Index("ix_voting_tokens_token", ...)` in `__table_args__`, causing startup failure after locations table was fixed
- **Redundant index cleanup**: Removed `index=True` from 5 additional columns across `apparatus.py`, `facilities.py`, `inventory.py`, `ip_security.py`, and `public_portal.py` that had redundant (but differently-named) explicit indexes in `__table_args__`, preventing double-indexing
- **Fast-path init log accuracy**: Fixed dropped table count in `_fast_path_init()` to exclude the skipped `alembic_version` table
### Fixed - Docker & Deployment (2026-02-15)

#### Database Consistency
- **Unified database engine**: All standard deployments (main, Unraid, build-from-source) now use MySQL 8.0. MariaDB is reserved exclusively for ARM/Raspberry Pi via the `docker-compose.arm.yml` override
- **Unraid compose files**: Changed `unraid/docker-compose-unraid.yml` and `unraid/docker-compose-build-from-source.yml` from `mariadb:10.11` to `mysql:8.0` with proper MySQL 8.0 healthchecks and command flags
- **Minimal profile**: Removed MariaDB image override from `docker-compose.minimal.yml` — now uses the base MySQL image with resource-constrained settings
- **Healthcheck improvements**: Unraid compose files now use robust two-step healthcheck (ping + SELECT 1) with `start_period: 60s` matching the main compose pattern

#### Unraid Deployment
- **Updated all Unraid documentation** (UNRAID-INSTALLATION.md, README.md, QUICK-START-UPDATED.md, DOCKER-COMPOSE-SETUP.md, BUILD-FROM-SOURCE-ON-UNRAID.md): Replaced MariaDB references with MySQL, corrected container names to `logbook-db`
- **XML template**: Updated `the-logbook.xml` to reference MySQL, removed hardcoded 192.168.1.10 IP addresses from DB_HOST and REDIS_HOST defaults
- **Build-from-source**: Fixed frontend `VITE_API_URL` from absolute URL to `/api/v1` for proper nginx proxying

#### Wiki Documentation
- **Updated 8 wiki files**: Replaced MariaDB references with MySQL 8.0 across Deployment-Guide, Deployment-Unraid, Development-Backend, Home, Installation, Quick-Reference, Troubleshooting, and Unraid-Quick-Start wiki pages

#### New Features
- **AWS deployment guide** (`docs/deployment/aws.md`): Comprehensive guide covering EC2 simple deployment, EC2 + RDS + ElastiCache production setup, security groups, VPC networking, S3 backups, CloudWatch monitoring, cost estimation, and troubleshooting
- **Docker build verification script** (`scripts/verify-docker-build.sh`): 40-check validation covering Docker Compose config, Dockerfile validation, TypeScript compilation, Python syntax, database consistency, environment config, and service naming
- **Proxmox deployment guide** (`docs/deployment/proxmox.md`): Complete guide for LXC and VM deployment on Proxmox VE with Docker, including networking, backups, reverse proxy, and migration from Unraid
- **Synology NAS deployment guide** (`docs/deployment/synology.md`): Complete guide for deploying on Synology NAS via Docker Compose SSH or Container Manager UI, including DSM reverse proxy with SSL, Hyper Backup integration, port conflict resolution, and resource management
- **Fixed dangling references**: Removed references to non-existent `deploy/aws/` CloudFormation templates and `infrastructure/terraform/providers/aws/` directory, replaced with links to the new AWS deployment guide

### Fixed - TypeScript Build Errors (2026-02-15)

- **useTraining.ts**: Fixed `getStatistics` and `getProgress` method names to match actual `trainingService` API (`getUserStats`, `getRequirementProgress`)
- **PipelineDetailPage.tsx**: Extended `ProgramDetails` interface to accept `ProgramWithDetails` fields
- **ReportsPage.tsx**: Fixed `unknown` not assignable to `ReactNode` by using `!!` boolean coercion
- **ShiftReportPage.tsx**: Fixed `program_name` property access to `program?.name`
- **DocumentsPage.tsx**: Added missing `Upload` import from lucide-react
- **membership/types/index.ts**: Removed duplicate `User` import
- **election.ts**: Removed duplicate `ballot_items` property from `ElectionUpdate` interface
- Full `tsc --noEmit` now passes clean with zero errors

### Fixed - Codebase Quality & Error Handling (2026-02-15)

#### Error Handling Improvements
- **Type-safe error handling**: Replaced all `catch (err: any)` with `catch (err: unknown)` across 40+ frontend files, using `getErrorMessage()` and `toAppError()` utilities from `utils/errorHandling.ts`
- **`toAppError()` check ordering**: Fixed check order to evaluate Axios/HTTP errors (with `.response`) before `Error` instances and plain `AppError` objects, ensuring HTTP status codes and API detail messages are correctly extracted
- **Silent exception handlers**: Added proper logging to previously empty `catch` blocks in `backend/app/utils/cache.py` and `backend/app/api/v1/endpoints/events.py`
- **`createMockApiError()` test utility**: Fixed to return error object directly instead of a Promise, so `mockRejectedValue()` works correctly in tests

#### Unused Code & Import Cleanup
- **Removed unused imports/variables** in `ImportMembers.tsx` (`_XCircle`, `_AlertTriangle`, `_X`), `CreateTrainingSessionPage.tsx` (unused setter), `EventSelfCheckInPage.tsx` (`_alreadyCheckedIn`), `EventDetailPage.tsx` (`user: _user`), `TrainingOfficerDashboard.tsx` (duplicate `FileTextIcon`)
- **Removed `console.log`/`console.error` statements** across 40+ frontend files for production readiness

#### Backend Fixes
- **Makefile**: Fixed all backend targets to use `pip`/`pytest`/`alembic` instead of incorrect `npm` commands
- **Documents service**: Consolidated duplicate service pattern — all methods now return objects directly or raise `HTTPException`, eliminating inconsistent `(result, error)` tuple returns
- **Documents endpoint**: Updated to match new service API (no more tuple unpacking)
- **Public portal endpoints**: Implemented real database queries for `/api/public/v1/organization/stats` (active member count, apparatus count) and `/api/public/v1/events/public` (future public education events)
- **Duplicate dependency**: Removed duplicate `redis==5.2.1` entry from `requirements.txt`
- **Dockerfile healthcheck**: Fixed to validate HTTP response status

#### Frontend Fixes
- **ExternalTrainingPage**: Implemented `EditProviderModal` with full form fields (name, API URL, API key, description, sync settings)
- **ErrorBoundary**: Integrated with `errorTracker` service for error reporting
- **LoginPage**: Replaced OAuth TODO placeholder with actual API call to `/api/v1/auth/oauth-config`
- **EventSelfCheckInPage**: Simplified check-in flow to always treat successful `selfCheckIn` response as success; fixed "Check-In" → "Check-in" case mismatch

#### Configuration & Tooling
- **Backend linting**: Added `.flake8` (max-line-length=120, excludes alembic) and `mypy.ini` (python 3.11, ignore missing imports)
- **ESLint**: Changed 5 `no-unsafe-*` rules from `"off"` to `"warn"` in `.eslintrc.json`
- **`package.json`**: Removed non-existent `"mobile"` workspace

### Fixed - Members Page & Dark Theme Unification (2026-02-15)

#### Members Page
- **Zero-count bug**: Fixed `/api/v1/users` endpoint to handle missing organization settings gracefully; dashboard stats fallback changed from hardcoded 1 to 0

#### Dark Theme Unification
- **Centralized dark gradient**: Moved background gradient from per-page declarations to `AppLayout`, eliminating duplicate gradient CSS across 23 pages
- **17 light-themed pages converted**: Converted all remaining light-themed authenticated pages to consistent dark theme (white text, translucent cards, dark form inputs)
- **48 pages updated**: Unified dark theme across all authenticated pages for consistent visual experience

### Fixed - Role Sync & Onboarding Bugs (2026-02-15)

#### Role System
- **Frontend-backend role sync**: Added Administrator, Treasurer, Safety Officer to backend `DEFAULT_ROLES`; added Assistant Secretary, Meeting Hall Coordinator, Facilities Manager to frontend `RoleSetup.tsx`
- **Removed membership-tier entries from onboarding**: Tier roles (probationary, active, senior, life) removed from onboarding role selection as they are membership stages, not assignable roles

#### Onboarding Fixes
- **Prospective members module**: Added `prospective_members` to available modules list in onboarding
- **SQLAlchemy JSON mutation detection**: Fixed `_mark_step_completed()` dict mutation being silently lost by SQLAlchemy (in-place dict modification not tracked); now creates new dict to trigger change detection
- **Prospective members route prefix**: Fixed API route prefix mismatch preventing module endpoints from loading

### Improved - Database Startup Reliability (2026-02-15)

#### Fast-Path Initialization Hardening
- **Self-healing database startup**: Added three recovery mechanisms — fast-path retry after 2s on failure, schema repair via `create_all(checkfirst=True)` if validation finds missing tables, and `FK_CHECKS` re-enabled in `finally` block to prevent stuck states
- **Resource-constrained environment optimizations**: Single connection for all DDL, batched `DROP TABLE`, `checkfirst=False` on `create_all()`, `NullPool` for migration engine, and MySQL DDL flags (`innodb_autoinc_lock_mode=2`, `innodb_file_per_table=1`)
- **Slimmed init SQL**: Reduced `001_initial_schema.sql` to only create `alembic_version` table (removed 7 redundant tables that are now created by `create_all()`)
- **Dynamic schema validation**: `validate_schema()` now dynamically checks all 127+ expected tables from SQLAlchemy metadata instead of hardcoding 5 table names
- **Progress logging**: Logs progress every 25 tables during `create_all()` for visibility on slow environments
- **Init timeout increased**: Raised `create_all()` timeout from 600s to 1200s with `checkfirst=False` and `SET FOREIGN_KEY_CHECKS=0` for slow environments
- **Leftover table cleanup**: `_fast_path_init()` now dynamically discovers and drops ALL tables (except `alembic_version`) before `create_all()`, preventing "Duplicate key name" errors from partial previous boots

#### Docker & Health Check Fixes
- **MySQL health check false-positive fix**: Changed healthcheck from `-h localhost` (Unix socket, which connects to temporary init server on port 0) to `-h 127.0.0.1 --port=3306` (TCP), preventing premature "healthy" status during MySQL initialization
- **Backend start_period**: Increased to 600s with 10 retries to accommodate slow first-boot scenarios
- **Connection retries**: Increased from 20 (~4 min) to 40 (~10 min) to exceed MySQL first-time init duration (~6 min)
- **Startup reliability**: Six fixes — health check `start_period` 5s→300s, Docker dependency changed to `service_healthy`, schema validation raises `RuntimeError` instead of silently continuing, onboarding endpoints handle missing tables gracefully, nginx proxy timeouts added, `50x.html` auto-retry error page added

#### Backend Startup Fixes
- **Silent migration failure**: Moved `_fast_path_init()` outside forgiving try/except that swallowed all exceptions, added schema validation after fast-path, made validation failures crash the app
- **Fast-path timeout**: Added 10-minute timeout to `_fast_path_init()` to prevent hung `create_all()` from freezing the backend forever
- **Axios client timeout**: Added 30-second timeout to frontend Axios API client
- **Duplicate Alembic revision IDs**: Fixed two pairs of migrations sharing the same revision IDs (20260212_0300 and 20260212_0400), causing Alembic to crash with "overlaps with other requested revisions"
- **Backend crash on cold MySQL init**: Increased connection retries to cover MySQL's ~6 min first-time initialization
- **NameError fix**: Moved `get_current_user` above `PermissionChecker` classes in `dependencies.py` — function was defined after classes that reference it in `Depends()` default arguments

### Added - Hierarchical Document Folder System (2026-02-15)

#### Per-Member Document Folders
- **Folder access control**: Added `FolderVisibility` enum (organization/leadership/owner) and access control columns (`visibility`, `owner_user_id`, `allowed_roles`) to `DocumentFolder`
- **Member Files system folder**: Auto-creates per-member subfolders on first access; members can only see their own folder
- **My folder endpoint**: `GET /documents/my-folder` returns the current user's personal folder
- **Access enforcement**: Folder visibility checks enforced on list, view, upload, and download endpoints

#### Per-Apparatus Document Folders
- **Apparatus file organization**: "Apparatus Files" system folder with per-vehicle subfolders named by unit number
- **Categorized sub-folders**: Photos, Registration & Insurance, Maintenance Records, Inspection & Compliance, Manuals & References
- **Lazy creation**: Folder hierarchy created on first access via `GET /apparatus/{id}/folders`

#### Per-Facility & Per-Event Document Folders
- **Facility folders**: Per-facility folders with Photos, Blueprints & Permits, Maintenance Records, Inspection Reports, Insurance & Leases, Capital Projects sub-folders
- **Event folders**: Per-event folders created automatically for file attachments
- **New endpoints**: `GET /facilities/{id}/folders` and `GET /events/{id}/folder`
- **Migration**: Seeds all three new system folders for existing organizations

### Added - Form & Security Enhancements (2026-02-15)

#### Forms Module
- **File upload field**: Drag-and-drop file upload support in `FieldRenderer` for form fields of type `file`
- **Signature capture pad**: Canvas-based signature input with mouse and touch support for form fields of type `signature`

#### Security Improvements
- **Password rehashing on login**: Automatically rehashes password when argon2 parameters change, keeping passwords up to date with latest security settings
- **Async database audit logging**: Blocked IP security events now logged asynchronously to the database instead of only to file logs
- **Training enrollment permission check**: Added `training.view_all` permission check to enrollment endpoint
- **TypeScript type safety**: Fixed `any` types in `AccessLogsTab` and `APIKeysTab` with proper TypeScript interfaces

### Added - Testing & Quality (2026-02-15)

#### New Test Suites
- **Alembic migration chain tests**: 9 tests validating no duplicate revision IDs, no forked chains, single base/head, no orphan migrations, and valid `down_revision` references (`test_alembic_migrations.py`)
- **Changelog regression tests**: 29-test suite (`test_changelog_fixes.py`) covering duplicate index detection, dependency ordering, documents service API, public portal queries, fast-path init logic, frontend error handling, Makefile correctness, migration chain integrity, and model import completeness

#### Bug Fixes Found During Testing
- **Missing facilities model import**: Fixed `models/__init__.py` to include facilities models — without this fix, `create_all()` would silently skip 20 facility tables
- **pytest-asyncio scope mismatch**: Fixed `asyncio_default_fixture_loop_scope` from "function" to "session" in `pytest.ini` to match session-scoped async fixtures
- **Standalone enum verification function**: Added `verify_enum_consistency()` to `test_enum_consistency.py` for CI/pre-commit integration

### Added - Shift Module Enhancement: Full Scheduling System (2026-02-14)

#### Shift Templates & Recurring Patterns
- **Shift templates**: `POST /api/v1/scheduling/templates` — define reusable shift definitions (Day Shift, Night Shift, Weekend Duty) with start/end times, duration, positions, min staffing, and calendar color
- **Shift patterns**: `POST /api/v1/scheduling/patterns` — create recurring schedules with support for four pattern types: `daily`, `weekly`, `platoon` (A/B/C rotation), and `custom`
- **Auto-generation**: `POST /api/v1/scheduling/patterns/{id}/generate` — generates shifts for a date range from a pattern template, with automatic assignment creation for pre-assigned members
- **Template CRUD**: Full create/read/update/delete for shift templates with active/inactive toggle

#### Duty Roster & Shift Assignments
- **Assign members**: `POST /api/v1/scheduling/shifts/{id}/assignments` — assign members to shifts with position designation (officer, driver, firefighter, EMS, captain, lieutenant, probationary, volunteer)
- **Confirm/decline**: `POST /api/v1/scheduling/assignments/{id}/confirm` — members confirm their own shift assignments
- **Assignment statuses**: `assigned`, `confirmed`, `declined`, `no_show`
- **My assignments**: `GET /api/v1/scheduling/my-assignments` — personal view of upcoming shift assignments

#### Shift Swap Requests
- **Request swap**: `POST /api/v1/scheduling/swap-requests` — members request to swap shifts, optionally targeting a specific shift or member
- **Officer review**: `POST /api/v1/scheduling/swap-requests/{id}/review` — approve or deny swap requests with notes
- **Cancel request**: `POST /api/v1/scheduling/swap-requests/{id}/cancel` — requestor can cancel pending requests
- **Status tracking**: `pending`, `approved`, `denied`, `cancelled` with full audit trail

#### Time-Off / Unavailability
- **Request time off**: `POST /api/v1/scheduling/time-off` — members submit time-off requests with date range and reason
- **Officer review**: `POST /api/v1/scheduling/time-off/{id}/review` — approve or deny with notes
- **Availability check**: `GET /api/v1/scheduling/availability` — view which members have approved time off in a date range, for scheduling decisions
- **Cancel request**: `POST /api/v1/scheduling/time-off/{id}/cancel` — cancel pending requests

#### Shift Call Recording
- **Record calls**: `POST /api/v1/scheduling/shifts/{id}/calls` — log incidents/calls during shifts with incident number, type, dispatch/on-scene/cleared times, responding members
- **Call details**: Track `cancelled_en_route`, `medical_refusal`, and per-call responding member list
- **Call CRUD**: Full create/read/update/delete for shift call records

#### Shift Reporting & Analytics
- **Member hours report**: `GET /api/v1/scheduling/reports/member-hours` — per-member shift count and total hours for a date range
- **Coverage report**: `GET /api/v1/scheduling/reports/coverage` — daily staffing levels showing assigned vs. confirmed vs. minimum required
- **Call volume report**: `GET /api/v1/scheduling/reports/call-volume` — call counts by type with average response times, groupable by day/week/month
- **My shifts**: `GET /api/v1/scheduling/my-shifts` — personal shift history and upcoming assignments

#### New Permissions & Roles
- **`scheduling.assign`**: Assign members to shifts (officers and above)
- **`scheduling.swap`**: Request and manage shift swaps (all members)
- **`scheduling.report`**: View shift reports and analytics (officers and above)
- **Scheduling Officer role**: New system role with full scheduling permissions for dedicated scheduling coordinators

#### New Models
- `ShiftTemplate` — reusable shift definitions with positions and min staffing
- `ShiftPattern` — recurring schedule definitions with platoon rotation support
- `ShiftAssignment` — duty roster assignments with position and confirmation status
- `ShiftSwapRequest` — swap request workflow with officer review
- `ShiftTimeOff` — time-off request workflow with approval
- **Migration**: `20260214_2200` creates 5 new tables with indexes

### Added - Facilities Module: Building & Property Management (2026-02-14)

#### Core Facilities Management
- **Facility CRUD**: Create, edit, archive facilities with types, statuses, addresses, GPS coordinates, year built, square footage
- **Facility types**: 10 default types (Fire Station, EMS Station, Training Center, Administrative Office, Meeting Hall, Storage Building, Maintenance Shop, Communications Center, Community Center, Other)
- **Facility statuses**: 6 default statuses with color coding (Operational, Under Renovation, Under Construction, Temporarily Closed, Decommissioned, Other)
- **Photos & documents**: Attach photos and documents to facilities with metadata
- **Systems tracking**: Track building systems (HVAC, electrical, plumbing, etc.) with install dates and warranty info

#### Facility Maintenance
- **Maintenance scheduling**: `POST /api/v1/facilities/{id}/maintenance` — log maintenance records with type, priority, scheduling, and cost tracking
- **20 default maintenance types**: HVAC, Generator, Fire Alarm, Sprinkler, Roof, Elevator, Bay Door, Pest Control, and more with recommended frequencies
- **Inspections**: Track facility inspections with pass/fail, findings, and follow-up

#### Extended Facilities Features
- **Utility tracking**: Track utility accounts (electric, gas, water, sewer, internet, phone, trash) with billing cycles and meter readings
- **Key & access management**: Track physical keys, key fobs, access cards, codes, and gate remotes with assignment to members
- **Room/space inventory**: Catalog rooms with type, capacity, equipment, and availability
- **Emergency contacts & shutoffs**: Record emergency contacts by type (fire, police, utility, building) and shutoff locations (water, gas, electric, HVAC, sprinkler)
- **Capital improvement projects**: Track renovation/construction/equipment projects with budget, timeline, and contractor info
- **Insurance policies**: Manage building, liability, flood, earthquake, and equipment policies with coverage amounts and renewal dates
- **Occupant/unit assignments**: Track tenant/unit assignments for multi-use facilities
- **ADA/compliance checklists**: Create compliance checklists (ADA, fire code, building code, OSHA, environmental) with individual checklist items and due dates

#### Permissions & Roles
- **6 permissions**: `facilities.view`, `facilities.create`, `facilities.edit`, `facilities.delete`, `facilities.maintenance`, `facilities.manage`
- **Facilities Manager role**: System role with VIEW, CREATE, EDIT, MAINTENANCE permissions for day-to-day building management
- **Onboarding integration**: Facilities module added to onboarding available modules list

#### Seed Data & Migration
- **Migration**: `20260214_1900` creates 9 core facility tables; `20260214_2100` creates 11 extended feature tables
- **Seed migration**: `20260214_2000` seeds default facility types, statuses, and maintenance types

### Added - Apparatus Module Hardening (2026-02-14)

#### Security & Quality Improvements
- **Tenant isolation**: All queries filter by `organization_id` — no cross-organization data leakage
- **Pagination**: All list endpoints support `skip`/`limit` with total count
- **Error handling**: Consistent error responses with proper HTTP status codes
- **Soft-delete**: `is_archived`/`archived_at`/`archived_by` pattern for apparatus records
- **Historic repair entries**: Maintenance records support attachments and repair history

### Added - Secretary Attendance Dashboard & Meeting Waivers (2026-02-14)

#### Secretary Attendance Dashboard
- **Attendance dashboard**: `GET /api/v1/meetings/attendance/dashboard` — secretary/leadership view showing every active member's meeting attendance %, meetings attended, waived, absent, membership tier, and voting eligibility
- **Period filtering**: `period_months` parameter for configurable look-back window (default 12 months)
- **Meeting type filter**: Optionally filter by meeting type (e.g. `business` only)
- **Voting eligibility**: Shows whether each member is eligible to vote and the reason if blocked (tier restrictions or attendance below minimum)

#### Meeting Attendance Waivers
- **Grant waiver**: `POST /api/v1/meetings/{meeting_id}/attendance-waiver` — secretary, president, or chief excuses a member from a meeting
- **Waiver effect**: The member cannot vote in this meeting, but their attendance percentage is not penalized
- **Attendance calculation updated**: Waived meetings are excluded from both numerator and denominator of the attendance percentage
- **List waivers**: `GET /api/v1/meetings/{meeting_id}/attendance-waivers` — view all waivers for a meeting
- **Audit trail**: Every waiver is logged as `meeting_attendance_waiver_granted` with `warning` severity
- **Migration**: `20260214_1300` adds `waiver_reason`, `waiver_granted_by`, `waiver_granted_at` to meeting_attendees

### Added - Auto-Enrollment on Prospective Member Conversion (2026-02-14)

#### Probationary Training Pipeline Auto-Enrollment
- **Auto-enroll on transfer**: When a prospective member is converted to a full member, they are automatically enrolled in the organization's default probationary training program
- **Program detection**: Looks for `settings.training.auto_enroll_program_id` first, then falls back to any active program with "probationary" in the name
- **Manual enrollment**: `POST /api/v1/training/enrollments` — training officer can enroll any member into any training pipeline (probationary, driver training, AIC, etc.)
- **Administrative conversion**: Works for both prospective→operational and administrative→operational conversions
- **Transfer response**: Includes `auto_enrollment` field showing the program enrolled into

### Added - Incident-Based Training Progress Tracking (2026-02-14)

#### Call Type Tracking in Shift Completion Reports
- **Call type matching**: When a requirement specifies `required_call_types` (e.g. `["transport", "cardiac"]`), shift completion reports now count only calls matching those types
- **Call type running totals**: `progress_notes.call_type_totals` tracks per-type counts (e.g. `{"transport": 8, "cardiac": 3}`)
- **Call type history**: `progress_notes.call_type_history` records each shift report's matching types and counts
- **Customizable by training officer**: Requirements can specify minimum calls by type (e.g. 15 total calls, 10 transports, 5 shifts) via `required_calls`, `required_call_types`, `required_shifts`, `required_hours` on `TrainingRequirement`

### Added - Scheduled Tasks / Cron Configuration (2026-02-14)

#### Cron Task Runner
- **List tasks**: `GET /api/v1/scheduled/tasks` — lists all available scheduled tasks with recommended cron schedules
- **Run task**: `POST /api/v1/scheduled/run-task?task={task_id}` — manually trigger any scheduled task
- **Recommended schedule**:
  - **Daily 6:00 AM**: `cert_expiration_alerts` — tiered certification expiration reminders
  - **Weekly Monday 7:00 AM**: `struggling_member_check` — detect members falling behind
  - **Weekly Monday 7:30 AM**: `enrollment_deadline_warnings` — warn approaching deadlines
  - **Monthly 1st 8:00 AM**: `membership_tier_advance` — auto-advance membership tiers

### Added - Struggling Member Detection & Notifications (2026-02-14)

#### Pipeline Progress Monitoring
- **Behind-pace detection**: Flags members who have used >50% of their enrollment time but completed <25% of requirements
- **Deadline approaching**: Flags members within 30 days of deadline at <75% completion (critical if within 7 days)
- **Stalled requirements**: Detects requirements with no progress updates in 30+ days
- **Auto-notification**: Training officers receive in-app alerts about struggling members (critical/warning severity)
- **Deadline warnings**: Automatic warnings at 30, 14, and 7 days before enrollment deadline
- **Large department support**: Proactively surfaces struggling members who might otherwise go unnoticed

### Added - Membership Stage Requirements Editor (2026-02-14)

#### Tier Configuration Management
- **Get config**: `GET /api/v1/users/membership-tiers/config` — view current tier configuration
- **Update config**: `PUT /api/v1/users/membership-tiers/config` — training/compliance/secretary can edit membership requirements for each stage
- **Configurable per-tier settings**: voting eligibility, meeting attendance % required for voting, training exemptions, office-holding eligibility, years-of-service for auto-advancement
- **Validation**: Ensures all tiers have `id` and `name`, attendance percentages are 0-100
- **Audit trail**: Config changes logged as `membership_tier_config_updated` with `warning` severity

### Added - Training Calendar Integration & Double-Booking Prevention (2026-02-14)

#### Training Session Calendar View
- **Calendar endpoint**: `GET /api/v1/training-sessions/calendar` — returns training sessions with linked Event data (dates, times, locations, training metadata) for calendar display
- **Date range filtering**: `start_after` / `start_before` query parameters for fetching sessions in a date window
- **Training type filter**: Filter calendar by `training_type` (certification, continuing_education, etc.)
- **Double-booking prevention**: Training sessions with a `location_id` are checked against the organization's event calendar — prevents scheduling a training session at a location already booked by another event
- **Shared calendar**: Training events appear on the organization-wide event calendar alongside all other events
- **Hall coordinator filtering**: `GET /api/v1/events?exclude_event_types=training` — hall coordinators can hide training events from their view while double-booking prevention still applies across all event types
- **`location_id` field**: Added to `TrainingSessionCreate` schema for location-aware training sessions
- **Event relationship**: Explicit `event` and `course` relationships added to `TrainingSession` model for eager loading

### Added - Competency Matrix / Heat Map Dashboard (2026-02-14)

#### Department Readiness Dashboard
- **Competency matrix**: `GET /api/v1/training/competency-matrix` — generates a member vs. requirement matrix showing certification/training status for every member
- **Color-coded statuses**: `current` (green), `expiring_soon` (yellow, within 90 days), `expired` (red), `not_started` (gray)
- **Readiness percentage**: Summary block with total members, requirements, and overall department readiness score
- **Filterable**: Optional `requirement_ids` and `user_ids` query parameters to focus on specific requirements or members
- **Gap identification**: Helps training officers identify where gaps exist and create targeted training plans

### Added - Certification Expiration Alert Pipeline (2026-02-14)

#### Tiered Expiration Reminders
- **Process alerts**: `POST /api/v1/training/certifications/process-alerts` — scans all certification records and sends tiered reminders
- **Four tiers**: 90-day, 60-day, 30-day, and 7-day warnings before expiration
- **Escalation**: Expired certifications trigger an escalation email CC'd to training officer, compliance officer, and chief
- **CC on escalation**: 30-day → training officers CC'd; 7-day → training + compliance officers; expired → + chief officer
- **Idempotent**: Each tier is tracked per-record (`alert_90_sent_at`, `alert_60_sent_at`, etc.) — will not re-send
- **Alert tracking columns**: `alert_90_sent_at`, `alert_60_sent_at`, `alert_30_sent_at`, `alert_7_sent_at`, `escalation_sent_at` on training_records

### Added - Peer Skill Evaluation Sign-Offs (2026-02-14)

#### Configurable Evaluator Permissions
- **Check evaluator**: `POST /api/v1/training/skill-evaluations/{skill_id}/check-evaluator` — verifies whether the current user is authorized to sign off on a skill
- **Role-based**: `allowed_evaluators.type = "roles"` — e.g. only `shift_leader` can sign off on AIC skills, `driver_trainer` for driver trainees
- **User-specific**: `allowed_evaluators.type = "specific_users"` — explicitly named users who may evaluate
- **Default fallback**: `null` → any user with `training.manage` permission can sign off
- **Training officer configurable**: Training officer or chief sets the `allowed_evaluators` JSON on each `SkillEvaluation` record
- **`allowed_evaluators` column**: New JSON column on skill_evaluations table

### Added - Meeting Quorum Enforcement (2026-02-14)

#### Organization-Configurable Quorum
- **Get quorum status**: `GET /api/v1/minutes/{minutes_id}/quorum` — calculates and returns current quorum status for a meeting
- **Configure quorum**: `PATCH /api/v1/minutes/{minutes_id}/quorum-config` — set per-meeting quorum type and threshold
- **Organization defaults**: `organization.settings.quorum_config` — default quorum rules applied to all meetings (type: "count" or "percentage", threshold value)
- **Check-in driven**: Quorum is calculated from attendees marked `present: true` in the meeting's attendee list
- **Per-meeting override**: Individual meetings can override the org default with `quorum_type` and `quorum_threshold` columns
- **Auto-update**: `update_quorum_on_checkin()` recalculates quorum each time an attendee checks in or is removed
- **`quorum_threshold`/`quorum_type` columns**: New columns on meeting_minutes table

### Added - Bulk Voter Override for Elections (2026-02-14)

#### Secretary Bulk Override
- **Bulk override**: `POST /api/v1/elections/{election_id}/voter-overrides/bulk` — secretary can grant voting overrides to multiple members in a single request
- **Reason required**: A reason (10–500 characters) is required for every bulk override
- **Enhanced audit logging**: Each override is individually logged with `warning` severity, and a summary audit event captures the full batch with all user IDs
- **Existing override protection**: Members who already have an override are skipped (not duplicated)

### Added - Migration 20260214_1200 (2026-02-14)

#### Schema Changes
- `meeting_minutes.quorum_threshold` (Float, nullable) — configurable quorum threshold per meeting
- `meeting_minutes.quorum_type` (String(20), nullable) — "count" or "percentage"
- `skill_evaluations.allowed_evaluators` (JSON, nullable) — configurable evaluator permissions
- `training_records.alert_90_sent_at` through `alert_7_sent_at` (DateTime, nullable) — certification alert tracking
- `training_records.escalation_sent_at` (DateTime, nullable) — escalation alert tracking

### Added - Proxy Voting for Elections (2026-02-14)

#### Proxy Voting System
- **Organization opt-in**: Proxy voting is a department choice — enabled via `organization.settings.proxy_voting.enabled`; disabled by default
- **Authorize a proxy**: `POST /api/v1/elections/{election_id}/proxy-authorizations` — secretary designates one member to vote on behalf of another, with a reason
- **Proxy types**: `single_election` (one-time for this election) or `regular` (standing proxy, noted for reference)
- **Cast proxy vote**: `POST /api/v1/elections/{election_id}/proxy-vote` — the designated proxy casts a vote; eligibility and double-vote prevention apply to the *delegating* (absent) member
- **Hash trail**: Each proxy vote records `is_proxy_vote=true`, `proxy_voter_id` (who physically voted), `proxy_delegating_user_id` (on whose behalf), and `proxy_authorization_id`; the `voter_hash` identifies the delegating member so the audit trail shows who voted on whose behalf
- **Ballot email CC**: When ballot emails are sent, the proxy holder is automatically CC'd on the delegating member's ballot notification
- **List authorizations**: `GET /api/v1/elections/{election_id}/proxy-authorizations` — view all active and revoked authorizations
- **Revoke authorization**: `DELETE /api/v1/elections/{election_id}/proxy-authorizations/{id}` — revoke before the proxy votes; cannot revoke after the vote is cast
- **Forensics integration**: The election forensics report includes a `proxy_voting` section with all authorizations and proxy votes cast
- **Full audit trail**: `proxy_authorization_granted`, `proxy_authorization_revoked`, `proxy_vote_cast`, and `proxy_vote_double_attempt` audit events
- **`proxy_authorizations` column**: New JSON column on the elections table
- **Vote columns**: `is_proxy_vote`, `proxy_voter_id`, `proxy_authorization_id`, `proxy_delegating_user_id` added to votes table
- **Migration**: `20260214_1100` adds proxy voting columns

### Added - Secretary Voter Override for Elections (2026-02-14)

#### Voter Eligibility Overrides
- **Secretary override**: `POST /api/v1/elections/{election_id}/voter-overrides` — grants a member voting rights for a specific election, bypassing tier-based and meeting attendance restrictions
- **Reason required**: Every override must include a reason (e.g. "Excused absence approved by board vote")
- **Full audit trail**: Each override records the member, reason, granting officer name, and timestamp; logged as a `voter_override_granted` audit event with `warning` severity
- **List overrides**: `GET /api/v1/elections/{election_id}/voter-overrides` — view all overrides for an election
- **Remove override**: `DELETE /api/v1/elections/{election_id}/voter-overrides/{user_id}` — revoke an override before the member votes
- **Scope**: Overrides skip tier voting eligibility and attendance percentage checks only; they do NOT bypass election-level eligible_voters lists, position-specific role requirements, or double-vote prevention
- **`voter_overrides` column**: New JSON column on the elections table
- **Migration**: `20260214_1000` adds `voter_overrides` column to elections table

### Added - Membership Tiers, Voting Attendance Rules & Training Exemptions (2026-02-14)

#### Membership Tier System
- **Configurable membership tiers**: Organization settings > `membership_tiers` defines an ordered list of tiers (default: Probationary, Active, Senior, Life) with years-of-service thresholds
- **Tier benefits per level**: Each tier can grant `training_exempt`, selective `training_exempt_types`, `voting_eligible`, `voting_requires_meeting_attendance` with configurable `voting_min_attendance_pct` and look-back `voting_attendance_period_months`, `can_hold_office`, and extensible `custom_benefits`
- **`membership_type` field on User**: Stores the member's current tier (e.g. `"probationary"`, `"life"`); defaults to `"active"`
- **Manual tier change**: `PATCH /api/v1/users/{user_id}/membership-type` — leadership can promote/adjust a member's tier with a reason
- **Auto-advancement**: `POST /api/v1/users/advance-membership-tiers` — batch-advance all eligible members based on years of service from `hire_date`; idempotent, designed for periodic triggering

#### Voting Eligibility — Meeting Attendance
- **Tier-based voting rules**: The election system now checks the member's tier benefits before allowing votes; probationary members (default config) cannot vote
- **Attendance-gated voting**: If a tier has `voting_requires_meeting_attendance: true`, the system calculates the member's meeting attendance percentage over the configured look-back period and rejects the vote if below the minimum (e.g. 50% over 12 months)
- **Attendance calculation**: Uses the `MeetingAttendee` model — counts meetings marked present vs. total meetings in the organization during the period

#### Training Exemptions
- **Tier-based exemptions**: Members at a tier with `training_exempt: true` (e.g. Life Members) have all requirements treated as met in compliance checks
- **Selective exemptions**: `training_exempt_types` allows exempting only specific requirement types (e.g. `["continuing_education"]`) while keeping others enforced

#### Migration
- `20260214_0900` adds `membership_type` (VARCHAR 50, default "active") and `membership_type_changed_at` columns to users table

### Added - Configurable Drop Notification Messages (2026-02-14)

#### Email Template & Recipient Configuration
- **Default MEMBER_DROPPED email template**: Auto-created for each organization with template variables (`{{member_name}}`, `{{reason}}`, `{{item_count}}`, etc.) — fully editable via the Email Templates settings page
- **CC/BCC support**: `EmailService.send_email()` now supports `cc_emails` and `bcc_emails` parameters
- **Configurable CC recipients**: Organization settings > `member_drop_notifications.cc_roles` controls which roles are CC'd (default: admin, quartermaster, chief)
- **Static CC emails**: `member_drop_notifications.cc_emails` allows adding extra email addresses always CC'd on drop notifications
- **Personal email support**: New `personal_email` field on user profiles for post-separation contact; `member_drop_notifications.include_personal_email` controls whether it receives the drop notification (default: true)
- **Template variable reference**: 10 available variables for the member_dropped template type, documented in the template editor
- **Migration**: `20260214_0800` adds `personal_email` column to users table

### Added - Member Archive & Reactivation (2026-02-14)

#### Member Archiving Lifecycle
- **New `archived` status**: Added to UserStatus enum — represents a dropped member who has returned all property
- **Auto-archive on last item return**: When a dropped member returns their last assigned/checked-out item, they are automatically transitioned to `archived` status
- **Manual archive endpoint**: `POST /api/v1/users/{user_id}/archive` — allows leadership to archive a dropped member manually (e.g. items written off)
- **Reactivation endpoint**: `POST /api/v1/users/{user_id}/reactivate` — restores an archived member to `active` status when they rejoin the department
- **Archived members list**: `GET /api/v1/users/archived` — lists all archived members for legal requests or reactivation lookup
- **Audit trail**: All archive/reactivation events logged with full event data
- **Admin notification**: Admins, quartermasters, and chiefs notified by email when auto-archive occurs
- **`archived_at` column**: Tracks the exact timestamp of archiving on the user record
- **Profile preservation**: Archived members' full profile, training history, and inventory records remain accessible
- **Migration**: `20260214_0700` adds `archived` enum value and `archived_at` column

#### Duplicate Member Prevention
- **Prospect creation check**: Creating a prospect with an email matching an archived member returns 409 with reactivation guidance
- **Prospect transfer check**: Transferring a prospect to membership is blocked if email matches any existing user (archived or active), with clear messaging about reactivation
- **Admin user creation check**: Creating a member via admin endpoint returns 409 with match details and reactivation URL if email matches an archived member
- **Pre-submission lookup**: `POST /api/v1/membership-pipeline/prospects/check-existing` — checks email and name against all existing members before prospect entry
- **Match types**: Cross-references by email (exact) and by first+last name (case-insensitive)

### Added - Property Return Report & Member Drop Statuses (2026-02-14)

#### Member Drop Statuses
- **New UserStatus values**: `dropped_voluntary` and `dropped_involuntary` added to the UserStatus enum
- **Status change endpoint**: `PATCH /api/v1/users/{user_id}/status` with `members.manage` permission
- **Drop reason in notification**: The `reason` field provided by leadership is now included in the property return letter sent to the dropped member (both HTML and plain text versions)
- **Audit logging**: All status changes logged with severity `warning` for drops
- **Migration**: `20260214_0500` adds new enum values to users, email_templates, and notification_rules tables

#### Property Return Report (Auto-Generated)
- **Automatic trigger**: When a member status changes to dropped, a formal property-return letter is generated
- **Printable HTML letter**: Professional letterhead format with department name, member address block (window-envelope compatible), and formal language
- **Item inventory table**: Lists every assigned and checked-out item with serial number, asset tag, condition, type (assigned/checked out), and dollar value
- **Total assessed value**: Summed from `current_value` or `purchase_price` of all items
- **Return instructions**: Three methods documented (in person, by appointment, by mail/courier) with tracking advice
- **Involuntary notice**: Additional legal-recovery paragraph automatically included for involuntary drops
- **Configurable deadline**: Return deadline in days (1-90, default 14) set per status change
- **Custom instructions**: Optional extra paragraph for department-specific notes
- **Document storage**: Report automatically saved to the Documents module (Reports folder) as a generated document
- **Email delivery**: Report emailed to the member's address on file (toggleable via `send_property_return_email`)
- **Plain text fallback**: Text version included for email clients that don't render HTML
- **Preview endpoint**: `GET /api/v1/users/{user_id}/property-return-report` to preview before dropping a member

#### Property Return Reminders (30-Day / 90-Day)
- **Automatic reminders**: 30-day and 90-day reminders sent to dropped members who still have outstanding items
- **Dual notification**: Reminder emailed to the member AND a summary sent to admin/quartermaster/chief users
- **Duplicate prevention**: Each reminder type (30-day, 90-day) sent only once per member via `property_return_reminders` tracking table
- **Escalation language**: 90-day reminder includes a "FINAL NOTICE" with recovery action warning
- **Process endpoint**: `POST /api/v1/users/property-return-reminders/process` — designed for daily cron/scheduler or manual trigger
- **Overdue dashboard**: `GET /api/v1/users/property-return-reminders/overdue` — lists all dropped members with outstanding items, days since drop, item details, and which reminders have been sent
- **Status tracking**: `status_changed_at` and `status_change_reason` columns added to users table for accurate drop-date tracking
- **Migration**: `20260214_0600` adds user columns and `property_return_reminders` table

#### Notification & Email Template Support
- **MEMBER_DROPPED trigger**: Added to NotificationTrigger enum for notification rules
- **MEMBER_DROPPED template type**: Added to EmailTemplateType for admin-customizable templates

### Added - Training Module Expansion (2026-02-14)

#### Self-Reported Training
- **Member Submission Page**: Members can submit external training for officer review at `/training/submit`
- **Officer Review Page**: Training officers review, approve, reject, or request revisions at `/training/submissions`
- **Configurable Approval Workflow**: Auto-approve under X hours, require manual approval, set review deadlines
- **Customizable Form Fields**: Per-field visibility, required flags, and custom labels (14 configurable fields)
- **Notification Settings**: Configurable notifications for submission and decision events
- **TrainingRecord Auto-Creation**: Approved submissions automatically create official training records
- **Database**: `self_report_configs` and `training_submissions` tables with migration `20260214_0200`

#### Shift Completion Reports
- **Shift Report Form**: Officers file detailed reports on trainee shift experiences at `/training/shift-reports`
- **Performance Tracking**: 1-5 star rating, areas of strength, areas for improvement, officer narrative
- **Skills Observed**: Track specific skills with demonstrated/not-demonstrated status
- **Auto-Pipeline Progress**: Reports linked to enrollments automatically update requirement progress for SHIFTS, CALLS, and HOURS requirement types
- **Trainee Acknowledgment**: Trainees can review and acknowledge reports with comments
- **Three-Tab Interface**: New Report, Filed Reports (by officer), My Reports (received as trainee)
- **Database**: `shift_completion_reports` table with migration `20260214_0300`
- **API**: 9 endpoints under `/api/v1/training/shift-reports/`

#### Training Reports
- **Training Progress Report**: Pipeline enrollment progress, requirement completion rates, member advancement status
- **Annual Training Report**: Comprehensive annual breakdown of training hours, shift hours, courses, calls, performance ratings, training by type
- **Date Range Picker**: Customizable reporting periods with preset buttons (This Year, Last Year, Last 90 Days, Custom) and date inputs
- **Report Period Display**: Selected period shown in report results modal header

#### Member Training Page ("My Training")
- **Personal Training Page** at `/training/my-training`: Aggregated view of all training data for each member
- **Collapsible Sections**: Training hours summary, certifications, pipeline progress, shift reports, training history, submissions
- **Stat Cards**: Total hours, records, shifts, average rating at a glance
- **Certification Alerts**: Expired and expiring-soon badges with days-until-expiry
- **Navigation**: Quick action links from Training Dashboard and member profile

#### Member Visibility Configuration
- **TrainingModuleConfig Model**: 14 boolean visibility toggles per organization controlling what members see
- **Officer Settings Tab**: Officers can toggle each data category on/off from the My Training page
- **Granular Control**: Independently control training history, hours, certifications, pipeline progress, requirement details, shift reports, shift stats, performance ratings, strengths, improvement areas, skills observed, officer narrative, submission history, and report export
- **Default-Off Fields**: Officer narrative and report export are hidden from members by default
- **Officer Override**: Officers and administrators always see the full dataset regardless of settings
- **Database**: `training_module_configs` table with migration `20260214_0400`
- **API**: 4 endpoints under `/api/v1/training/module-config/`

#### Documentation Updates
- **TRAINING_PROGRAMS.md**: Added sections for self-reported training, shift completion reports, member training page, member visibility configuration, training reports, and new database schemas
- **TROUBLESHOOTING.md**: Added Training Module section with 7 troubleshooting scenarios covering self-reported training, shift reports, my training page, visibility settings, and training reports
- **CHANGELOG.md**: Comprehensive changelog entry for all training module features

### Added - Events Module Enhancements (2026-02-14)

#### Recurring Events & Templates
- **Recurrence Patterns**: Support for daily, weekly, monthly, and yearly recurrence with configurable intervals, end dates, and occurrence limits
- **Event Templates**: Create and apply reusable event templates for common event configurations
- **Recurrence Pattern Models**: `EventRecurrence` and `EventTemplate` database models with full schema support
- **Frontend Types**: Complete TypeScript types for recurrence patterns, templates, and event duplication

#### Event Creation & Editing
- **Dedicated EventCreatePage**: Full-featured event creation page with `EventForm` component (extracted from EventsPage for better code organization)
- **Event Edit/Delete UI**: `EventEditPage` with pre-populated form, delete confirmation, and cancel notifications
- **Event Duplication**: Duplicate existing events from the detail page with all settings carried over
- **EventForm Component**: Reusable form component with all event fields, validation, and type safety

#### Event Attachments
- **Upload Endpoint**: `POST /events/{id}/attachments` for file uploads with metadata
- **Download Endpoint**: `GET /events/{id}/attachments/{attachment_id}` for file retrieval
- **Delete Endpoint**: `DELETE /events/{id}/attachments/{attachment_id}` for file removal

#### Event Operations
- **Booking Prevention**: Prevent double-booking of locations for overlapping event times
- **RSVP Overrides**: Admin override for RSVP limits and deadline enforcement
- **Event Notifications**: Cancel notifications sent when events are deleted
- **Organization Timezone**: Timezone support added to auth flow and date formatting utilities

#### Test Coverage
- **5 Test Files**: Comprehensive test coverage for `EventForm`, `EventCreatePage`, `EventDetailPage`, `EventEditPage`, and `EventsPage`
- **1,865+ Test Lines**: Full component testing with mock API responses, form interactions, and edge cases

### Fixed - TypeScript & Backend Quality (2026-02-14)

#### TypeScript Build Fixes
- **All Build Errors Resolved**: Fixed all TypeScript compilation errors across the entire frontend codebase
- **17 'as any' Assertions Removed**: Replaced all unsafe `as any` type assertions with proper typing across 7 files (apparatus API, AddMember, EventDetailPage, EventQRCodePage tests, MinutesDetailPage, test setup, errorHandling utility)
- **Broken JSX Fixed**: Repaired broken JSX in `DocumentsPage` and `MinutesPage` caused by merged duplicate code blocks
- **Duplicate Type Identifier Fixed**: Resolved duplicate `User` type export in membership types

#### Backend Quality Fixes
- **Python Backend Incongruities**: Fixed broken dependency injection, duplicate models, and missing permissions across 29 files
  - Fixed `models/__init__.py` with unified model registry
  - Added `core/permissions.py` with comprehensive permission definitions
  - Fixed meetings and minutes endpoints with correct DI patterns
  - Fixed document service and schemas
- **Mutable Default Arguments**: Fixed mutable default values (`[]`, `{}`) across all backend models (analytics, apparatus, email_template, error_log, integration, membership_pipeline, user) using `default_factory`
- **Documents Schema**: Made `file_name` optional and added missing folder fields in document schemas

#### Startup & Runtime Fixes
- **Polling Loop Fix**: Fixed infinite polling loop in onboarding check page
- **Type Safety**: Fixed type safety issues in onboarding hooks (`useApiRequest`) and `OnboardingCheck` page
- **API Client**: Fixed onboarding API client service method signatures

#### Events Module Bug Fixes
- **Runtime Crashes**: Fixed critical events module bugs causing runtime crashes and missing data
- **Event Endpoints**: Simplified and fixed event API endpoints (reduced broken logic)
- **Location Model**: Fixed location model relationship definitions
- **Event Service**: Fixed event service with proper error handling and data loading

#### Code Cleanup
- **Events Module Deduplication**: Removed duplicate code in `EventCheckInMonitoringPage` and `EventsPage`, extracted shared types to `event.ts`
- **Minute Model**: Added missing relationship for event linking

### Added - Meeting Minutes & Documents Module (2026-02-13)

#### Meeting Minutes Backend
- **Database Models**: `MeetingMinutes`, `MinutesTemplate`, `MinutesSection` with UUID primary keys, organization scoping, and foreign keys to events
- **8 Meeting Types**: `business`, `special`, `committee`, `board`, `trustee`, `executive`, `annual`, `other` — each with tailored default section templates
- **Dynamic Sections System**: Minutes use a flexible JSON sections array (`order`, `key`, `title`, `content`) replacing hardcoded content fields — sections can be added, removed, and reordered
- **Template System**: `MinutesTemplate` model with configurable sections, header/footer configs, meeting type defaults, and `is_default` flag per type
- **Default Section Presets**:
  - Business (9 sections): call to order, roll call, approval of previous, treasurer report, old/new business, etc.
  - Trustee (11 sections): adds financial review, trust fund report, audit report, legal matters
  - Executive (11 sections): adds officers' reports, strategic planning, personnel matters, executive session
  - Annual (12 sections): adds annual report, election results, awards & recognition
- **Minutes Lifecycle**: `draft` → `review` → `approved` status progression with edit protection for approved minutes
- **Publish Workflow**: Approved minutes can be published to the Documents module as styled HTML with organization branding
- **Event Linking**: Minutes can be linked to events via `event_id` foreign key
- **Search**: Full-text search across title and section content with SQL LIKE injection protection

#### Documents Backend
- **Document Management**: `Document` and `DocumentFolder` models with folder hierarchy, tagging, and file metadata
- **7 System Folders**: SOPs, Policies, Forms & Templates, Reports, Training Materials, Meeting Minutes, General Documents — auto-created on first access, non-deletable
- **Custom Folders**: Users can create, update, and delete custom folders alongside system folders
- **Document Types**: `policy`, `procedure`, `form`, `report`, `minutes`, `training`, `certificate`, `general`
- **Source Tracking**: Documents track their origin (`upload`, `generated`, `linked`) and source reference ID

#### API Endpoints
- **Minutes**: 10 endpoints — CRUD, list, search, templates CRUD, publish
- **Documents**: 5 endpoints — folders CRUD, document list/get/delete
- **Permissions**: `meetings.view` for read access, `meetings.manage` for write operations

#### Frontend Pages
- **MinutesPage.tsx**: Meeting type filtering with color-coded badges, template selector in create modal (auto-selects default template per meeting type), search, quick stats dashboard
- **MinutesDetailPage.tsx**: Dynamic section editor with rich text, section reordering (up/down), add/delete sections, publish button for approved minutes, "View in Documents" link for published minutes
- **DocumentsPage.tsx**: Folder-based browsing, document viewer modal with server-rendered HTML, grid/list view toggle, custom folder management, document count badges

#### Database Migrations
- Migration `add_meeting_minutes`: Creates `meeting_minutes` table with all fields and indexes
- Migration `20260213_0800`: Adds `minutes_templates`, `document_folders`, `documents` tables with dynamic sections support
- Migration `a7f3e2d91b04`: Extends MeetingType ENUM with `trustee`, `executive`, `annual` on both tables

### Security - Meeting Minutes Module Review (2026-02-13)

#### Fixes Applied
- **HIGH: Audit log parameter mismatch** — 6 audit log calls in minutes and documents endpoints used wrong parameter names (`action=`, `details=` instead of `event_type=`, `event_data=`), causing silent `TypeError` at runtime. Fixed all calls to use correct `log_audit_event()` signature
- **MEDIUM: SQL LIKE pattern injection** — Search inputs in `minute_service.py` (2 methods) and `document_service.py` (1 method) passed directly into `%{search}%` without escaping `%` and `_` wildcards. Fixed by escaping all three special characters before interpolation
- **LOW: Unbounded query limits** — List and search endpoints accepted arbitrary `limit` values. Added `min(limit, 100)` for list endpoints and `min(limit, 50)` for search

#### Verified Secure
- Multi-tenancy via `organization_id` scoping on all queries
- Permission checks (`meetings.view`/`meetings.manage`) on all endpoints
- Status-based edit protection (approved minutes cannot be modified)
- HTML generation uses `html.escape()` for all user content
- System folder protection (cannot delete system folders)
- Pydantic validation on all request schemas

### Fixed - Migration Chain Integrity (2026-02-13)

- **Broken Alembic migration chain**: Three minutes/documents migrations had incorrect `down_revision` values creating orphaned migration heads
  - `add_meeting_minutes`: Fixed `down_revision` from `None` to `'20260212_0400'`
  - `20260213_0800`: Fixed `down_revision` from `'20260212_1200'` (wrong revision ID) to `'add_meeting_minutes'`
  - `a7f3e2d91b04`: Fixed `down_revision` from `None` to `'20260213_0800'`

### Enhanced - Email Ballot Voting Page (2026-02-12)

#### Token-Based Ballot Page (`BallotVotingPage.tsx`)
- **Public ballot page** at `/ballot?token=xxx` — no authentication required, accessed via "Vote Now" link in email
- **Full ballot display**: Shows all ballot items with item numbers, titles, descriptions
- **Voting options per item**: Approve/Deny for approval items, candidate selection for elections, write-in for custom entries, or abstain
- **Submit Ballot button** at bottom of page with review prompt
- **Confirmation modal**: Shows summary of all choices (item title + selected option) before final submission
- **"Change Ballot" / "Cast Ballot"** options in confirmation — member can go back and modify or confirm
- **Success confirmation**: Green checkmark with submission summary (votes cast, abstentions)
- **Error handling**: Clear messages for expired tokens, already-submitted ballots, invalid links

#### Backend: Bulk Ballot Submission
- **`POST /ballot/vote/bulk?token=xxx`** endpoint: Submits all ballot item votes atomically in one transaction
- **Write-in support**: Creates write-in candidates on the fly when member enters a custom name
- **Approve/Deny candidates**: Auto-created for approval-type ballot items
- **Abstain handling**: Items marked as abstain are skipped (no vote recorded)
- **Token lifecycle**: Token marked as used after full ballot submission, preventing reuse
- **HMAC-SHA256 signatures** on every vote for tamper detection
- **Audit logging**: Full ballot submission logged with vote count and abstention count

#### Email Template Updates
- **"Vote Now" button** (was "Cast Your Vote") — centered, prominent blue button
- **Ballot URL** now points to frontend `/ballot` page instead of API endpoint

### Enhanced - Ballot Builder, Meeting Attendance & Member Class Eligibility (2026-02-12)

#### Meeting Attendance Tracking
- **Attendance management endpoints**: `POST /elections/{id}/attendees` (check in), `DELETE /elections/{id}/attendees/{user_id}` (remove), `GET /elections/{id}/attendees` (list)
- **`attendees` JSON column** on Election model to track who is present at meetings
- **Audit logging**: All attendance check-ins and removals are logged to the tamper-proof audit trail

#### Member Class Eligibility System
- **Extended `_user_has_role_type()`** with member class categories: `regular` (active non-probationary), `life` (life_member role), `probationary` (probationary status)
- **Per-ballot-item eligibility**: Each ballot item can specify which member classes may vote (e.g., only regular + life members for membership approvals)
- **Attendance requirement**: Ballot items can require meeting attendance (`require_attendance` flag) — voters must be checked in to participate
- **Combined checks**: Voting eligibility now evaluates both member class AND attendance for each ballot item

#### Ballot Templates API
- **7 pre-configured templates**: Probationary to Regular, Admin Member Acceptance, Officer Election, Board Election, General Resolution, Bylaw Amendment, Budget Approval
- **`GET /elections/templates/ballot-items`** endpoint returns templates with title/description placeholders
- **One-click creation**: Secretary selects a template, fills in the name/topic, and the ballot item is created with correct eligibility rules

#### Ballot Builder UI (`BallotBuilder.tsx`)
- **Template picker**: Visual grid of available templates with eligibility badges
- **Custom item form**: Create custom ballot items with configurable type, vote type, voter eligibility, and attendance requirements
- **Reorder and remove**: Drag items up/down, remove unwanted items
- **Live preview**: Shows title preview as secretary types the name/topic

#### Meeting Attendance UI (`MeetingAttendance.tsx`)
- **Check-in interface**: Search members by name or badge number, one-click check-in
- **Attendance display**: Green pills showing checked-in members with timestamps
- **Attendance percentage**: Shows percentage of organization members present
- **Remove capability**: Remove accidentally checked-in members

#### Database Migration
- Migration `20260212_0400`: Adds `attendees` JSON column to elections table

### Enhanced - Elections Audit Logging & Ballot Forensics (2026-02-12)

#### Tamper-Proof Audit Logging
- **Full audit trail integration**: All election operations now log to the tamper-proof `audit_logs` table with blockchain-style hash chains
- **14 event types**: `election_created`, `election_opened`, `election_closed`, `election_deleted`, `election_rollback`, `vote_cast`, `vote_cast_token`, `vote_double_attempt`, `vote_double_attempt_token`, `vote_soft_deleted`, `vote_integrity_check`, `ballot_emails_sent`, `runoff_election_created`, `forensics_report_generated`
- **Loguru structured logging**: All election operations emit structured log messages with election IDs, positions, and outcomes for operational monitoring

#### Ballot Forensics
- **Forensics aggregation endpoint** (`GET /elections/{id}/forensics`): Single API call returning vote integrity, deleted votes, rollback history, token access logs, audit trail, anomaly detection (suspicious IPs), and voting timeline
- **Anomaly detection**: Flags IP addresses with suspiciously high vote counts; provides per-hour voting timeline for detecting ballot stuffing patterns
- **BALLOT_FORENSICS_GUIDE.md**: Step-by-step playbook for investigating disputed elections with 5 scenario walkthroughs, complete API reference, and audit event reference table

### Enhanced - Elections Module Low-Priority Improvements (2026-02-12)

#### Vote Integrity & Audit Trail
- **Vote Signatures**: HMAC-SHA256 cryptographic signatures on every vote for tampering detection. New `verify_vote_integrity()` endpoint validates all signatures and reports any anomalies
- **Soft-Delete for Votes**: Votes are never hard-deleted — `deleted_at`, `deleted_by`, and `deletion_reason` columns maintain full audit trail. All queries filter out soft-deleted votes
- **Vote Integrity Verification Endpoint**: `GET /elections/{id}/integrity` returns signature validation results (PASS/FAIL, tampered vote IDs)
- **Soft-Delete Vote Endpoint**: `DELETE /elections/{id}/votes/{vote_id}` marks votes as deleted with reason, preserving audit trail

#### Voting Methods
- **Ranked-Choice (Instant-Runoff) Voting**: Full IRV implementation with iterative elimination rounds. Voters rank candidates; lowest-ranked candidate eliminated each round until majority winner found
- **Approval Voting**: Voters can approve multiple candidates; percentages calculated based on unique voters rather than total ballot count
- **Vote Rank Support**: `vote_rank` field on votes (schema, model, migration) for ranked-choice ballots

#### Bulk & Multi-Position Improvements
- **Atomic Bulk Voting**: `POST /elections/{id}/vote/bulk` now uses database savepoints — either all votes succeed or none are committed
- **Multi-Position Token Tracking**: Token-based voting tracks `positions_voted` per token; tokens are only marked as "used" when all positions are voted on

#### Frontend Components
- **Voter-Facing Ballot UI** (`ElectionBallot.tsx`): Full voting interface supporting simple, ranked-choice, and approval voting methods. Shows eligibility status, per-position voting, and confirmation
- **Candidate Management UI** (`CandidateManagement.tsx`): Admin interface for adding, editing, accepting/declining, and removing candidates with position grouping and write-in support
- **ElectionDetailPage Integration**: Ballot and candidate management sections embedded in the election detail page

#### Database Migration
- Migration `20260212_0300`: Adds `vote_signature`, `deleted_at`, `deleted_by`, `deletion_reason`, `vote_rank` to votes table; `positions_voted` to voting_tokens table; `ix_votes_deleted_at` index

### Security - Elections Module Deep Review (2026-02-12)

#### Critical Fixes (4)
- **SEC-C1: Remove status from ElectionUpdate** — Prevents bypassing `/open`, `/close`, `/rollback` validation logic by directly PATCHing the status field on DRAFT elections
- **SEC-C2: Add IntegrityError handling to `cast_vote_with_token()`** — Token-based anonymous voting now catches database constraint violations instead of returning 500 errors
- **SEC-C3: Fix anonymous vote eligibility check** — `check_voter_eligibility()`, `_get_user_votes()`, and `has_user_voted()` now query by `voter_hash` for anonymous elections instead of `voter_id` (which is NULL)
- **SEC-C4: Fix `datetime.now()` to `datetime.utcnow()`** — Results visibility check now uses consistent UTC time, preventing timezone-dependent early/late result disclosure

#### Medium Fixes (6)
- **SEC-M3: Add enum validation** — `voting_method`, `victory_condition`, and `runoff_type` are now validated against allowed values via Pydantic field validators
- **SEC-M4: Validate candidate positions** — Candidate creation now rejects positions not defined in the election's positions list
- **SEC-M5: HTML-escape rollback email content** — Election titles, performer names, reasons, and user names are HTML-escaped in rollback notification emails
- **SEC-M6: Block results visibility toggle for OPEN elections** — `results_visible_immediately` can no longer be toggled while voting is active, preventing strategic voting via live result disclosure
- **Guard `close_election()` to require OPEN status** — Prevents closing DRAFT or CANCELLED elections that were never opened
- **Frontend: Hide results visibility toggle for open elections** — Matches backend restriction

#### Updated
- **ELECTION_SECURITY_AUDIT.md** — Updated scores (7.1/10 → 9.0/10), marked all critical/high items as fixed, added new test recommendations, added audit history

### Added - Prospective Members: Withdraw & Election Package Integration (2026-02-12)

#### Withdraw / Archive Feature
- **Withdraw Action**: Active or on-hold applicants can be voluntarily withdrawn from the pipeline with an optional reason
- **Withdrawn Tab**: New tab on the main page showing all withdrawn applications with date, reason, and reactivate option
- **Withdrawn Stats Card**: Stats bar shows withdrawn count when greater than zero
- **Reactivation from Withdrawn**: Coordinators can reactivate withdrawn applications back to their previous pipeline stage
- **Confirmation Dialogs**: Withdraw action requires confirmation in both the detail drawer and table action menu

#### Election Package Integration
- **Auto-Created Packages**: When an applicant advances to an `election_vote` stage, the system automatically creates an election package bundling their data
- **Configurable Package Fields**: Stage config lets coordinators choose what applicant data to include (email, phone, address, DOB, documents, stage history)
- **Package Review UI**: Election package section in the applicant detail drawer with status badge, applicant snapshot, and editable fields
- **Coordinator Notes**: Draft packages can be edited with coordinator notes and a supporting statement for voters
- **Submit for Ballot**: "Mark Ready for Ballot" button transitions package from draft to ready for the secretary
- **Cross-Module Query**: `electionPackageService` provides endpoints for the Elections module to discover ready packages
- **Recommended Ballot Item**: Each package includes pre-configured ballot item settings from the stage's election config (voting method, victory condition, anonymous voting)
- **Package Status Tracking**: Five statuses (draft, ready, added_to_ballot, elected, not_elected) with appropriate UI for each

### Added - Prospective Members Module (2026-02-12)

#### Pipeline Management
- **Configurable Pipeline Builder**: Drag-and-drop stage builder with four stage types (form submission, document upload, election/vote, manual approval)
- **Pipeline Stages**: Each stage has a name, description, type, and optional per-stage inactivity timeout override
- **Dual View Modes**: Toggle between kanban board (drag-and-drop columns) and table view (sortable, paginated) for managing applicants
- **Server-Side Pagination**: Efficient pagination for large applicant lists with configurable page sizes
- **Bulk Actions**: Select multiple applicants to advance, hold, or reject in batch

#### Applicant Lifecycle
- **Status Tracking**: Six applicant statuses — active, on_hold, withdrawn, converted, rejected, inactive
- **Stage Progression**: Advance applicants through pipeline stages with action menu or drag-and-drop
- **Detail Drawer**: Slide-out panel showing full applicant details, notes, stage history, and activity timestamps
- **Conversion Flow**: Convert successful applicants to administrative member or probationary member via conversion modal

#### Inactivity Timeout System
- **Configurable Timeouts**: Pipeline-level default timeout with presets (3 months, 6 months, 1 year, never) or custom days
- **Per-Stage Overrides**: Individual stages can override the pipeline default for stages that naturally take longer (e.g., background checks)
- **Two-Phase Warnings**: Visual indicators at configurable warning threshold (amber at warning %, red at critical/approaching timeout)
- **Automatic Deactivation**: Applications automatically marked inactive when no action occurs within the timeout period
- **Notification Controls**: Toggle notifications for coordinators and/or applicants when approaching timeout
- **Active/Inactive Tabs**: Main page splits into Active and Inactive tabs with badge counts
- **Reactivation**: Coordinators can reactivate inactive applications; applicants can self-reactivate by resubmitting interest form
- **Auto-Purge**: Optional automatic purging of inactive applications after configurable period (default 365 days) to reduce stored private data
- **Manual Purge**: Bulk purge with confirmation modal and security messaging about permanent data deletion
- **Stats Annotations**: Statistics explicitly note what is included/excluded (active applicants only; inactive, rejected, withdrawn excluded from conversion rates)

#### Cross-Module Integration
- **Forms Integration**: Pipeline stages of type `form_submission` link to the Forms module for structured data collection
- **Elections Integration**: Pipeline stages of type `election_vote` link to the Elections module for membership votes
- **Notifications Integration**: Configurable alerts for stage changes, inactivity warnings, and timeout events

#### Onboarding & Permissions
- **Optional Module**: Added to onboarding module registry as optional, Core category module
- **Role Permissions**: Secretary and Membership Coordinator roles granted manage permissions by default
- **RBAC Integration**: `prospective_members.view` and `prospective_members.manage` permissions

#### Frontend Architecture
- **Module Structure**: Full standalone module at `frontend/src/modules/prospective-members/` with types, services, store, components, and pages
- **Zustand Store**: Comprehensive state management with server-side pagination, active/inactive tabs, loading states, and all CRUD operations
- **Route Encapsulation**: `getProspectiveMembersRoutes()` registered in App.tsx with lazy-loaded pages
- **7 Components**: PipelineBuilder, PipelineKanban, PipelineTable, ApplicantCard, ApplicantDetailDrawer, ConversionModal, StageConfigModal

### Added - Forms Module (2026-02-12)

#### Custom Forms Engine
- **Form Builder**: Full form management with 15+ field types (text, textarea, email, phone, number, date, time, datetime, select, multiselect, checkbox, radio, file, signature, section_header, member_lookup)
- **Form Lifecycle**: Draft, Published, and Archived states with publish/archive workflows
- **Starter Templates**: Pre-built templates for Membership Interest Form and Equipment Assignment Form
- **Field Configuration**: Labels, placeholders, help text, validation patterns, min/max constraints, required flags, field width (full/half/third)
- **Field Reordering**: Drag-and-drop field ordering via reorder endpoint
- **Submission Management**: View, filter, and delete submissions with pagination

#### Public-Facing Forms
- **Public Form URLs**: Each form gets a unique 12-character hex slug for public access (`/f/:slug`)
- **No-Auth Submission**: Public forms accept submissions without authentication
- **Public Form Page**: Clean, light-themed form page for external visitors with all field types rendered
- **QR Code Generation**: Downloadable QR codes (PNG/SVG) in the sharing modal for printing and placing in physical locations
- **Organization Branding**: Public forms display the organization name and form description

#### Cross-Module Integrations
- **Membership Integration**: Public form submissions can feed into the membership module for admin review
- **Inventory Integration**: Internal forms with member lookup can assign equipment via the inventory module
- **Field Mappings**: Configurable JSON field mappings between form fields and target module fields
- **Integration Management UI**: Add, view, and delete integrations per form in the admin interface

#### Form Security
- **Input Sanitization**: All form submission data is HTML-escaped, null-byte stripped, and length-limited before storage
- **Type Validation**: Email format + header injection check, phone character validation, number range validation
- **Option Validation**: Select/radio/checkbox values validated against allowed options (prevents arbitrary value injection)
- **Rate Limiting**: Public form views (60/min/IP) and submissions (10/min/IP) with lockout periods
- **Honeypot Bot Detection**: Hidden field in public forms silently rejects bot submissions with fake success response
- **Slug Validation**: Form slugs validated against strict hex pattern to prevent path traversal
- **DOMPurify**: Frontend sanitization of all server-provided text content for defense-in-depth XSS protection

#### Backend Architecture
- **Database Models**: Form, FormField, FormSubmission, FormIntegration with UUID primary keys
- **Alembic Migrations**: Two migrations for forms tables and public form extensions
- **FormsService**: Comprehensive service layer with sanitization, validation, integration processing
- **API Endpoints**: 16+ REST endpoints for form CRUD, field management, submissions, integrations, member lookup
- **Public API**: Separate `/api/public/v1/forms/` router with no authentication
- **Permissions**: `forms.view` and `forms.manage` integrated with RBAC system

### Added - Module UIs (2026-02-11)

#### Fully-Built Module Pages
- **Events Page**: Full event management with create/edit modals, event type filtering (business meeting, public education, training, social, fundraiser, ceremony), RSVP settings, reminders, QR code check-in links
- **Inventory Page**: Tabbed items/categories management with CRUD modals, item types (uniform, PPE, tool, equipment, vehicle, electronics, consumable), status tracking (available, assigned, checked out, in maintenance, lost, retired), condition tracking, search and filtering
- **Training Dashboard**: Three-tab layout (courses, requirements, certifications), expiring certification alerts (90-day window), links to officer dashboard, requirements management, programs, and session creation
- **Documents Page**: Folder-based document management with 6 default categories (SOPs, Policies, Forms & Templates, Reports, Training Materials, General Documents), grid/list view toggle, upload and folder creation modals
- **Scheduling Page**: Week/month calendar views, shift templates (day, night, morning), calendar navigation, shift creation with date ranges and staffing requirements
- **Reports Page**: Reports catalog with categories (member, training, event, compliance), report cards with descriptions and availability status
- **Minutes Page**: Meeting minutes management with type filtering (business, special, committee, board), quick stats dashboard, create modal, search and filter
- **Elections Page**: Election management with detail view sub-page

#### Navigation System
- **Persistent Side Navigation**: Fixed 256px sidebar (collapsible to 64px) with submenu support for Operations, Governance, Communication, and Settings sections
- **Top Navigation**: Horizontal header bar alternative with responsive mobile hamburger menu
- **Configurable Layout**: Users choose between top or left sidebar navigation during onboarding; preference stored in sessionStorage
- **Accessibility**: ARIA labels, focus traps for mobile menu, "Skip to main content" link, keyboard navigation

#### Dashboard
- **Stats Dashboard**: Displays total members, active members, documents count, setup percentage, recent events, and pending tasks
- **Dashboard Stats API**: `GET /api/v1/dashboard/stats` endpoint returns organization statistics
- **Training Widget**: Shows top 3 active training enrollments with progress

### Added - Roles & Permissions (2026-02-10)

#### New System Roles (8 additional roles)
- **Officers** (Priority 70): General officer role with broad operational access — scheduling, inventory, events, forms management
- **Quartermaster** (Priority 85): Department inventory, equipment, and gear assignment management
- **Training Officer** (Priority 65): Training programs, sessions, certifications, and related event management
- **Public Outreach Coordinator** (Priority 65): Public education and outreach event management
- **Meeting Hall Coordinator** (Priority 60): Meeting hall and location booking management
- **Membership Coordinator** (Priority 55): Member records, applications, onboarding/offboarding, role assignment
- **Communications Officer** (Priority 55): Website, social media, newsletters, and notification management
- **Apparatus Manager** (Priority 50): Fleet tracking, maintenance logging, and equipment checks

#### Role System Improvements
- **Unified Role Initialization**: `DEFAULT_ROLES` in `permissions.py` is now the single source of truth for all role definitions, replacing scattered role creation logic
- **Wildcard Permission Fix**: Permission check now correctly handles wildcard (`*`) permissions for IT Administrator role

### Fixed - Onboarding (2026-02-09)

#### State Persistence
- **Role Permissions Persistence**: Role permission customizations now persist across page navigation via Zustand store with localStorage; previously, navigating away from the Role Setup page reset all permissions to defaults
- **Module Configuration Persistence**: Module permission configs (`modulePermissionConfigs`) now save to the Zustand store instead of using a fake setTimeout; available roles are dynamically read from `rolesConfig` instead of being hardcoded
- **Orphaned Role ID Filtering**: When restoring module permission configs, role IDs are now validated against available roles — prevents "undefined" display when a previously-configured role is removed in the Role Setup step
- **Icon Serialization**: Role icons are serialized to string names for localStorage storage and deserialized back to React components on restore via `ICON_MAP`

#### Authentication & Navigation
- **Auth Token Key Fix**: Fixed critical redirect loop caused by AppLayout checking `localStorage.getItem('auth_token')` instead of the correct `'access_token'` key — this caused hundreds of API requests per second as the app bounced between login and dashboard
- **Branding Persistence**: Organization name and logo now transfer correctly from onboarding to the main application layout via sessionStorage

### Fixed - Infrastructure (2026-02-09)

#### Docker Graceful Shutdown
- **Exec Form CMD**: Backend Dockerfile and all Docker Compose files now use exec form (`["uvicorn", ...]`) instead of shell form, ensuring uvicorn receives SIGTERM signals directly
- **Stop Grace Period**: Added `stop_grace_period: 15s` to all Docker Compose configurations (main, minimal, Unraid) to allow in-flight requests to complete
- **Init Process**: Added `init: true` to backend services as a signal-forwarding safety net
- **Unraid Compose Files**: Updated both `docker-compose-unraid.yml` and `docker-compose-build-from-source.yml` with graceful shutdown settings

#### Backend Fixes
- **Apparatus Module Whitelist**: Fixed module slug mismatch for apparatus/public outreach in the module configuration whitelist

### Fixed - Authentication & Login (2026-02-11)

#### Login Flow
- **Login 401 Fix**: `get_user_from_token()` compared a UUID object against a `String(36)` database column causing type mismatch in aiomysql — fixed to query by token string only
- **Account Lockout Persistence**: Failed login counter was flushed but rolled back when HTTPException was raised — changed to explicit `commit()` so lockout increments persist
- **Token Refresh Type Mismatch**: `UUID(payload["sub"])` didn't match `String(36)` column — kept as string for correct comparison
- **Session Revocation Fix**: Same UUID-vs-String mismatch in session revocation resolved
- **Session Creation**: Onboarding endpoint created bare JWT with no UserSession row — now uses `create_user_tokens()` which creates the session record
- **Login Redirect**: Login page now redirects to `/dashboard` instead of `/` for authenticated users
- **ProtectedRoute Race Condition**: Route component now checks localStorage first and shows spinner while validating token, preventing flash of login page

#### Auth UX
- **Concurrent Token Refresh**: Multiple simultaneous 401 responses now share a single refresh promise instead of each triggering independent refresh calls — prevents replay detection from logging users out
- **Welcome Page Detection**: Welcome page now detects when onboarding is already completed and redirects appropriately
- **Logout Confirmation Modal**: New modal with ARIA attributes, Escape key support, and background scroll lock warns about unsaved changes before logging out

### Added - Login Page (2026-02-11)

- **Organization Branding**: Unauthenticated `GET /auth/branding` endpoint returns org name and logo; login page displays logo with "Sign in to [Org Name]" heading
- **Footer**: Copyright footer with org name and "Powered by The Logbook" text matching onboarding style
- **Logo Shape**: Updated logo container from circular to rounded square

### Added - Startup Optimization (2026-02-11)

- **Fast-Path Database Initialization**: Fresh databases now use `create_all()` instead of running 39+ Alembic migrations sequentially, reducing first-boot time from ~20 minutes to seconds
- **Onboarding Completion Fix**: Added explicit `await db.commit()` in admin-user endpoint — previously relied on auto-commit but frontend immediately called `/complete`
- **Audit Logger Savepoint**: Onboarding `/complete` endpoint was failing with 500 error due to audit logger commit conflicts — added savepoint isolation
- **End-to-End Test Script**: Comprehensive bash script (`test_onboarding_e2e.sh`) validating complete onboarding flow: startup, session management, organization creation, admin user setup, login/auth, and database verification

### Security - Election System (2026-02-10)

- **Double-Voting Prevention**: Added 4 partial unique indexes on the votes table to prevent duplicate votes at the database level — guards against race conditions and direct DB manipulation
- **Election Results Timing**: Results now require both `status=CLOSED` AND `end_date` to have passed before revealing vote counts — prevents premature result leaks during active elections
- **Integrity Error Handling**: `cast_vote()` now catches `IntegrityError` with a user-friendly message instead of a 500 error
- **Security Audit**: Comprehensive election security audit documented in `ELECTION_SECURITY_AUDIT.md` (rating: 7.1/10) — identified and resolved critical double-voting gap, catalogued anonymous voting strengths (HMAC-SHA256)

### Added - UX Improvements (2026-02-10)

#### Week 1: Core Usability
- **Password Reset Flow**: New Forgot Password and Reset Password pages
- **Live Dashboard Stats**: Replaced hardcoded dashboard values with live API data and skeleton loaders
- **User Settings Page**: Full settings page with account, password, and notification tabs
- **Dead Navigation Links Fixed**: Reports and Settings links now route correctly

#### Week 2: Safety
- **Logout Confirmation**: Modal warns about unsaved changes before logging out

#### Week 3: Onboarding Polish
- **Module Features Visible**: Module cards now display the first 3 features upfront with "+ X more" hint instead of hiding behind "More info" button
- **Breadcrumb Progress Indicator**: Step names with green checkmarks replace the simple step counter
- **Simplified Organization Setup**: Relaxed ZIP validation, form sections expanded by default
- **Focus Trap Hook**: Reusable `useFocusTrap` hook for WCAG-compliant mobile menus

#### Week 4: Contextual Help
- **Help Link Component**: Reusable `HelpLink` with 3 variants (icon/button/inline), tooltip support, configurable positioning
- **Integrated Help Tooltips**: Added to Dashboard, Organization Setup, and Reports pages

#### Additional UX Fixes
- **Membership Type Field**: Dropdown (prospective/probationary/regular/life/administrative) in admin user creation with prospective member warning banner
- **Administrator Terminology**: Clarified distinction between IT Administrator (system admin) and Administrative Member (membership type)
- **Validation Toast Fix**: `validateForm()` now returns errors directly instead of reading stale state, fixing "0 errors" toast message

### Fixed - Backend (2026-02-10)

#### SQLAlchemy Async Fixes
- **Organization Creation Greenlet Error**: Added `await db.refresh(org)` after flush to prevent lazy-loading of `organization_type.value` in async context
- **Admin User Creation Greenlet Error**: Eagerly loaded `roles` relationship before appending to avoid lazy loading in async context
- **Migration Dependency Chain**: Fixed `down_revision` pointer in vote constraints migration from non-existent ID to correct parent
- **Tax ID Field**: Added `tax_id` to onboarding Pydantic schema, service method, and API endpoint — frontend was sending it but backend rejected it with 422

#### Test Infrastructure
- **MySQL Test Database**: Tests now use actual MySQL database instead of SQLite for realistic testing
- **Transaction Management**: Replaced `commit()` calls with `flush()` for test compatibility; fixed audit logger transaction management
- **Comprehensive Onboarding Test Suite**: Full integration test coverage for onboarding flow
- **Database Initialization Fixture**: Shared test fixture for consistent database state
- **Async SQLAlchemy Review**: Full codebase audit of 32 `flush()` calls documented in `ASYNC_SQLALCHEMY_REVIEW.md` — 87.5% safe, 0 critical issues

### Added - Frontend (2026-02-08)

#### Onboarding UX Improvements
- **Unsaved Changes Warning**: Added `useUnsavedChanges` and `useFormChanged` hooks to prevent accidental data loss during navigation
  - Warns before browser refresh/close with unsaved changes
  - Blocks in-app navigation with confirmation dialog
  - Location: `frontend/src/modules/onboarding/hooks/useUnsavedChanges.ts`

- **Password Requirements Always Visible**: Password requirements now display before user starts typing
  - Shows all requirements (length, uppercase, lowercase, numbers, special characters)
  - Initially displays with unchecked indicators
  - Updates in real-time as user types
  - Location: `frontend/src/modules/onboarding/pages/AdminUserCreation.tsx`

- **Section Completion Checkmarks**: Organization setup form now shows visual completion status
  - Green checkmarks appear when required fields are filled
  - Red asterisks removed when section is complete
  - Provides instant feedback on form progress
  - Location: `frontend/src/modules/onboarding/pages/OrganizationSetup.tsx`

- **Sticky Continue Button (Mobile)**: Continue button stays visible at bottom on mobile devices
  - Uses responsive Tailwind classes (`sticky bottom-0 md:relative`)
  - Improves UX on long forms by keeping primary action visible
  - Applied to NavigationChoice and OrganizationSetup pages

#### Onboarding Validation Enhancements
- **Inline Address Validation**: Error messages now appear directly under address form fields
  - Previously only showed summary errors at bottom
  - Improves user experience by showing exactly which field has an issue
  - Location: `frontend/src/modules/onboarding/pages/OrganizationSetup.tsx`

- **URL Auto-HTTPS**: Website URLs automatically prepend `https://` if no protocol specified
  - Triggers on blur event
  - Prevents common user error of omitting protocol
  - Location: `frontend/src/modules/onboarding/pages/OrganizationSetup.tsx`

- **Improved ZIP Code Error Message**: Now shows expected format
  - Old: "Invalid ZIP code"
  - New: "Invalid ZIP code format. Expected: 12345 or 12345-6789"

#### Onboarding Progress & Consistency
- **Standardized Progress Indicators**: All onboarding pages now show consistent "Step X of 10"
  - Updated DepartmentInfo, ModuleSelection, NavigationChoice pages
  - Provides clear expectation of onboarding length

- **Enhanced Database Initialization Messaging**: Onboarding check page now explains 1-3 minute startup delay
  - Shows database connection retry attempts during MySQL initialization
  - Displays migration count and progress
  - Explains which tables are being created (users, training, events, elections, inventory, etc.)
  - Provides context for first-time startup delays
  - Location: `frontend/src/modules/onboarding/pages/OnboardingCheck.tsx`

### Removed - Frontend (2026-02-08)

- **Auto-save Notification**: Removed misleading auto-save indicators from OrganizationSetup page
  - Zustand state changes are not true "auto-saves" to backend
  - Prevents user confusion about when data is actually persisted

- **Redundant Session Storage Calls**: Removed unnecessary `sessionStorage` writes in DepartmentInfo
  - Data already persisted via Zustand store with localStorage
  - Simplified state management approach

### Fixed - Backend (2026-02-08)

#### Configuration Errors
- **Fixed Settings Configuration Reference** (`backend/app/utils/startup_validators.py`)
  - Changed `settings.MYSQL_DATABASE` → `settings.DB_NAME` (lines 64, 199)
  - Resolves error: `'Settings' object has no attribute 'MYSQL_DATABASE'`
  - Enum validation now works correctly on startup

#### Migration Errors
- **Fixed Duplicate Migration** (`backend/alembic/versions/20260206_0301_add_missing_training_tables.py`)
  - Migration was creating tables (`skill_evaluations`, `skill_checkoffs`, `shifts`, etc.) already created in migration `20260122_0015`
  - Converted to conditional migration that checks if tables exist before creating
  - Prevents error: `(1050, "Table 'skill_evaluations' already exists")`
  - Maintains backwards compatibility with existing deployments

#### API Errors
- **Fixed Organization Creation Error** (`backend/app/api/v1/onboarding.py`)
  - Endpoint was accessing `data.description` but `OrganizationSetupCreate` schema doesn't have that field
  - Changed `description=data.description` → `description=None` (line 1322)
  - Resolves error: `'OrganizationSetupCreate' object has no attribute 'description'`

### Technical Improvements

#### New Hooks & Utilities
- `useUnsavedChanges(options)`: Warns before leaving page with unsaved changes
- `useFormChanged(currentData, initialData)`: Detects if form data has changed from initial values

#### Migration System
- Improved migration error handling with conditional table creation
- Better backwards compatibility for existing installations

#### State Management
- Cleaned up redundant storage operations
- Improved consistency between Zustand store and backend persistence

## [1.0.0] - 2026-02-06

### Initial Release
- Full onboarding flow (10 steps)
- Organization setup with comprehensive fields
- Admin user creation
- Module selection system
- Role-based permission system
- Training module
- Events & RSVP module
- Elections & voting module
- Inventory management
- And more...

---

## Release Notes Format

Each release includes:
- **Added**: New features
- **Changed**: Changes in existing functionality
- **Deprecated**: Soon-to-be removed features
- **Removed**: Removed features
- **Fixed**: Bug fixes
- **Security**: Vulnerability patches

For full details on any release, see the commit history in the Git repository.
