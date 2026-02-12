# Changelog

All notable changes to The Logbook project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
