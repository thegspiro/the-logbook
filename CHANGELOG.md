# Changelog

All notable changes to The Logbook project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
