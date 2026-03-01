# Modules Review: Improvements, Expansion, and Iteration

**Date:** 2026-03-01
**Scope:** All 8 frontend modules + backend counterparts + module system infrastructure

---

## Executive Summary

The Logbook has 8 frontend modules (`admin-hours`, `apparatus`, `communications`, `membership`, `onboarding`, `prospective-members`, `public-portal`, `scheduling`) with significant variation in structural completeness, test coverage, and adherence to project conventions. Beyond per-module issues, the module system itself has architectural gaps: a 706-line `App.tsx` with inline routes for major features (Events, Training, Inventory, etc.) that should be modularized, a module registry (`AVAILABLE_MODULES`) out of sync with reality, and inconsistent lazy-loading patterns.

This review is organized into three tiers:

1. **Per-module findings** -- structural gaps, code quality, and specific improvement opportunities
2. **Cross-cutting architectural issues** -- patterns that affect all modules
3. **Expansion opportunities** -- new modules and features that the backend already supports but lack frontend implementation

---

## 1. Per-Module Review

### 1.1 admin-hours

**Structure:** Complete (index.ts, routes.tsx, 4 pages, services, store, types). No components beyond an empty barrel export.

**Strengths:**
- Well-organized store with granular loading states per concern (categories, entries, active session, admin sessions)
- Comprehensive API service split into three sub-services (category, clock, entry)
- Good type coverage (14 interfaces)
- Server-side pagination on entries, proper filter/sort support

**Improvements:**
- **No tests** -- zero frontend and zero backend test coverage. The clock-in/clock-out flow is business-critical and needs tests
- **`AdminHoursManagePage.tsx` is 1,150+ lines** -- a massive monolith containing category management, entry review, active session management, summary display, and bulk operations all in one component. Each tab (categories, active sessions, pending, all entries, summary) should be extracted into separate components
- **No reusable components** -- the `components/index.ts` is an empty placeholder. Common UI (clock display timer, hours summary card, entry status badge) should be extracted from pages into reusable components
- **Routes are eagerly loaded** -- should use `lazyWithRetry()` like other modules
- **Error handling uses raw `instanceof Error`** instead of the project standard `toAppError()` / `getErrorMessage()` from `utils/errorHandling.ts`
- **Hardcoded `PAGE_SIZE = 20`** instead of using `DEFAULT_PAGE_SIZE` from `constants/config.ts`
- **Missing QR code page permissions** -- `AdminHoursQRCodePage` should likely be permission-gated with `admin_hours.manage`
- **`AdminHoursClockInPage.tsx`** uses `eslint-disable-next-line react-hooks/exhaustive-deps` to suppress a legitimate `useEffect` dependency warning

### 1.2 apparatus

**Structure:** Complete (index.ts, routes.tsx, 3 pages, 2 components, services, store, types). Types are particularly comprehensive (750+ lines).

**Strengths:**
- Excellent type definitions covering apparatus, types, statuses, maintenance, inspections, fleet summary
- Well-structured store with separate loading states for types, statuses, and summary data
- Clean component extraction (StatusBadge, ApparatusTypeBadge)
- Server-side pagination with filter support

**Improvements:**
- **No tests** -- zero frontend and zero backend test coverage
- **`ApparatusDetailPage.tsx` is 756 lines** -- tab content (maintenance, fuel, operators, equipment, documents) should be extracted into separate components
- **Manual auth check in `ApparatusDetailPage`** -- checks `localStorage.getItem('has_session')` and redirects to `/login`, duplicating `ProtectedRoute` functionality. This should be removed
- **Hardcoded gradient background** (`bg-gradient-to-br from-slate-900 via-red-900 to-slate-900`) appears multiple times instead of using theme CSS variables
- **Routes are eagerly loaded** -- should use `lazyWithRetry()`
- **Error handling pattern** -- same `instanceof Error` issue as admin-hours; should use `toAppError()`
- **Missing CRUD actions in store** -- the store has fetch actions but no create/update/delete. These operations are likely handled directly in page components, breaking the store-as-single-source-of-truth pattern
- **Fleet summary is admin-only data** but lacks permission gating in the store's `fetchFleetSummary` action

### 1.3 communications

**Structure:** Complete with tests. Best-structured module overall.

**Strengths:**
- 4 test files (3 component tests + 1 store test) with 29 test cases following project conventions
- Lazy-loaded routes via `lazyWithRetry()`
- Two stores for distinct concerns (emailTemplatesStore, scheduledEmailsStore)
- Clean component separation (TemplateList, TemplateEditor, TemplatePreview, ScheduleEmailForm, ScheduledEmailList)

**Improvements:**
- **Partial test coverage** -- `ScheduleEmailForm`, `ScheduledEmailList`, `EmailTemplatesPage`, and `scheduledEmailsStore` lack tests
- **No backend tests** for email templates endpoints
- **Types re-exported from global `services/api.ts`** instead of having module-local type definitions. This creates a coupling to the global service layer
- **Only one page** (EmailTemplatesPage). The module's `AVAILABLE_MODULES` description mentions "direct messaging", "group discussions", "emergency notifications", and "mobile push notifications" -- none of which are implemented yet. This module is the smallest gap between current state and advertised capabilities

### 1.4 membership

**Structure:** Minimal -- only 4 files (index.ts, routes.tsx, store, types). Pages are external.

**Strengths:**
- Routes file is well-documented with clear comments for member-facing vs admin sections
- Uses `lazyWithRetry()` correctly for lazy loading
- Proper permission gating on admin routes (`members.manage`)
- Legacy redirects handled cleanly

**Improvements:**
- **Pages live outside the module** in `../../pages/` -- this defeats the purpose of modular architecture. Members, MemberProfilePage, MembersAdminHub, MemberAdminEditPage, MemberAuditHistoryPage, MemberIdCardPage, MemberScanPage, and WaiverManagementPage should all be migrated into `modules/membership/pages/`
- **No module-local components** -- shared member UI (member cards, status badges, etc.) should be extracted into `modules/membership/components/`
- **No module-local services** -- uses the global `userService` directly from `services/api.ts`. A dedicated `memberService` would improve encapsulation
- **Client-side filtering and pagination** in the store (`fetchMembers` fetches ALL members then filters/paginates in-memory). This will not scale. Needs server-side pagination
- **No tests** at all
- **`expiringCertifications` is hardcoded to 0** in stats -- this is a stub that was never connected to the backend
- **Store error handling** uses raw `instanceof Error` pattern

### 1.5 onboarding

**Structure:** Extended (52 files) with config, hooks, utils, security, and documentation. The most complex module.

**Strengths:**
- Self-contained with its own hooks (useApiRequest, useAutoSave, useOnboardingSession, useOnboardingStorage, useUnsavedChanges)
- Dedicated utilities (storage, validation, security, errorHandler)
- Module registry system (`config/moduleRegistry.ts`) for configuring which modules to enable during setup
- Backend has integration tests (`test_onboarding_integration.py`)
- Security documentation and initialization

**Improvements:**
- **Zero frontend tests** despite being the largest module (~30 source files). The multi-step wizard flow with auto-save, session management, and validation is the most critical path to test
- **Routes are eagerly loaded** -- 12+ page components all imported synchronously
- **Custom `SecureApiClient` uses raw `fetch()` instead of axios** -- a major consistency issue. The class manages its own session ID in `localStorage`, CSRF tokens in `localStorage` (inconsistent with the project's double-submit cookie pattern), and has its own error handling. Should be migrated to `createApiClient()`
- **Multiple `any` types** across the module: `services/api-client.ts` uses `data as T` assertions, `utils/storage.ts` has 3 `any` occurrences, `security-init.ts` has 2, `hooks/useApiRequest.ts` has 1, and `components/ErrorAlert.tsx` has an `@typescript-eslint/no-explicit-any` suppression
- **Security concern:** `createSystemOwner` tries to "clear password from memory" by setting `data.password = ''`, but JavaScript strings are immutable -- the original value may persist in memory until garbage collected
- **4 markdown documentation files** (`README.md`, `SECURITY_BEST_PRACTICES.md`, `SECURITY_INTEGRATION.md`, `SECURITY_WARNINGS.md`) checked into the module. These add maintenance burden and may drift out of sync
- **Deprecated page** -- `DepartmentInfo.tsx` is noted as deprecated but still present. Should be removed
- **`PlaceholderPages.tsx`** contains stub components -- these should either be implemented or removed
- **`ProgressIndicator` and `ProgressIndicatorEnhanced`** -- two progress indicator components exist. The non-enhanced one should be removed if superseded

### 1.6 prospective-members

**Structure:** Complete (index.ts, routes.tsx, 3 pages, 7 components, services, store, types). Well-architected.

**Strengths:**
- Rich component library (PipelineBuilder, PipelineKanban, PipelineTable, ApplicantCard, ApplicantDetailDrawer, ConversionModal, StageConfigModal)
- Both authenticated and public route exports (separate functions)
- Comprehensive store with per-action loading states (isAdvancing, isRejecting, isHolding, isResuming, isWithdrawing, etc.)
- Election package integration
- Inactivity management (reactivation, purge, settings)

**Improvements:**
- **No tests** at all -- neither frontend nor backend. The pipeline advancement logic (including auto-creating election packages on election_vote stages) is complex and business-critical
- **Blanket ESLint disable in `services/api.ts`** -- disables 6 TypeScript safety rules (`@typescript-eslint/no-explicit-any`, `no-unsafe-argument`, `no-unsafe-assignment`, `no-unsafe-call`, `no-unsafe-member-access`, `no-unsafe-return`) for ~720 lines. The backend-to-frontend mapping functions (`mapStepToStage`, `mapPipelineResponse`, `mapProspectToApplicant`, etc.) all use `any` parameter types. These should define proper intermediate types for backend response shapes
- **Types file contains utility functions** (`getEffectiveTimeoutDays`, `isSafeUrl`, `getInitials`, `isValidEmail`) that belong in a `utils/` directory, not alongside type definitions
- **Hardcoded computed values** -- `mapProspectListToApplicantList` hardcodes `days_in_stage: 0`, `days_in_pipeline: 0`, `days_since_activity: 0` instead of computing from backend data
- **Routes are eagerly loaded** -- should use `lazyWithRetry()`
- **Store is very large** (~665 lines) -- consider splitting into sub-stores (pipelineStore, applicantStore, inactivityStore) using Zustand's slice pattern
- **Repetitive error handling** -- every action has the same `instanceof Error ? error.message : 'Failed to...'` pattern. This should use a shared helper
- **Repetitive post-action refresh pattern** -- most mutation actions end with fetching the updated applicant, refreshing the list, and refreshing stats. This could be extracted into a helper
- **Missing optimistic updates** -- pipeline stage transitions would benefit from optimistic UI updates for better perceived performance (the `useOptimisticUpdate` hook exists globally but isn't used)

### 1.7 public-portal

**Structure:** Incomplete -- missing `index.ts` barrel, `routes.tsx`, and `store/`. Uses custom hooks instead of Zustand store.

**Strengths:**
- Clean hook-based data fetching pattern (`usePortalConfig`, `useAPIKeys`, `useAccessLogs`, `useUsageStats`, `useDataWhitelist`)
- Good error handling using `getErrorMessage()` from utils
- Well-separated tab components (Configuration, APIKeys, AccessLogs, UsageStats, DataWhitelist)

**Improvements:**
- **Missing module boilerplate** -- no `index.ts`, no `routes.tsx`. The route is defined inline in `App.tsx` (line 589). This is the only module directory missing a barrel export
- **Inconsistent state management pattern** -- uses React hooks with `useState`/`useEffect`/`useCallback` instead of Zustand stores, which is inconsistent with every other module. While the hook approach works, it means state isn't shared between components and is refetched on every mount
- **No tests** at all
- **Security-sensitive module without adequate testing** -- this module manages API keys, access logs, and data whitelists. It particularly needs tests
- **`useAccessLogs` has a dependency bug** -- the `filters` object is passed as a `useCallback` dependency. If the parent re-renders with a new object reference (even with the same values), it will trigger an infinite refetch loop. Needs `useMemo` on the filters or a deep comparison
- **Hardcoded light-mode colors** in warning banner (`bg-yellow-50`, `text-yellow-800`) that won't adapt to dark mode; should use theme CSS variables
- **Name mismatch with module registry** -- registered as `public-info` (route `/public`) in `AVAILABLE_MODULES` but implemented as `public-portal` (route `/admin/public-portal`). These represent different concepts that need reconciliation
- **No pages barrel export** -- `pages/PublicPortalAdmin.tsx` is imported directly in `App.tsx`

### 1.8 scheduling

**Structure:** Minimal -- only index.ts, 2 components, services, and store. No routes, pages, or types directory.

**Strengths:**
- Store has a test file (`schedulingStore.test.ts`) with 12 well-written test cases
- Loading guards prevent duplicate fetches
- Backend has excellent test coverage (3 test files with comprehensive integration tests)

**Improvements:**
- **50+ `Record<string, unknown>` usages in `services/api.ts`** -- functions like `createShift(data: Record<string, unknown>)`, `updateShift(shiftId: string, data: Record<string, unknown>)`, `createCall(shiftId: string, data: Record<string, unknown>)` all lack proper type definitions. This essentially defeats TypeScript's type system for the entire service layer. This is the worst type safety of any module
- **Duplicated axios interceptor logic** -- `services/api.ts` creates its own axios instance with copy-pasted CSRF and auth refresh interceptors (~50 lines) instead of using `createApiClient()`. Also declares a duplicate `InternalAxiosRequestConfig._retry` module augmentation that could conflict
- **`ShiftSettingsPanel.tsx` is 932 lines** -- the positions editor, apparatus type defaults editor, resource type defaults editor, and department defaults should each be separate components
- **`ShiftSettingsPanel` saves settings to `localStorage`** instead of persisting to the backend API, meaning settings are browser-local and lost on device switch
- **No `routes.tsx`** -- the scheduling route is defined inline in `App.tsx` and the page lives in the top-level `pages/SchedulingPage.tsx`, not inside the module
- **No `pages/` directory** -- the main scheduling page should live inside the module
- **Types exported from `services/api.ts`** instead of a dedicated `types/` directory. This conflates service layer with type definitions
- **No `components/index.ts` barrel** -- components are exported individually from the module barrel
- **Only settings/notification components** exist in the module -- the primary scheduling UI (calendar, shift views, member assignment) is in the top-level pages directory
- **Missing component tests** for `ShiftSettingsPanel` and `SchedulingNotificationsPanel`

---

## 2. Cross-Cutting Architectural Issues

### 2.1 App.tsx is a 706-line routing monolith

`App.tsx` contains inline route definitions for Events (8+ routes), Training (12+ routes including legacy redirects), Skills Testing (6 routes), Inventory (5 routes), Facilities, Elections, Minutes, Documents, Forms, Notifications, Integrations, Settings, and Reports. These should all be extracted into module `routes.tsx` files, reducing `App.tsx` to ~100 lines of module route imports.

**Recommendation:** Create modules for `events`, `training`, `skills-testing`, `inventory`, `facilities`, `elections`, `minutes`, and `reports`. Move their pages from `pages/` into module directories and extract routes from `App.tsx`.

### 2.2 Module registry is out of sync

`AVAILABLE_MODULES` in `types/modules.ts` lists modules that don't exist (`incidents`, `hr-payroll`, `grants`, `mobile`) and omits modules that do exist (`events`, `admin-hours`, `minutes`, `notifications`, `skills-testing`, `integrations`). Route paths in the registry don't match actual routes (`personal-settings` lists `/settings/personal` but actual route is `/account`; `system-settings` lists `/settings/system` but actual route is `/settings`).

**Recommendation:** Audit and update `AVAILABLE_MODULES` to reflect the actual state of the application. Add missing modules, remove or clearly mark unimplemented ones as `comingSoon`, and fix route mismatches.

### 2.3 Inconsistent lazy loading

Only 2 of 6 module route files use `lazyWithRetry()` (communications, membership). The other 4 (admin-hours, apparatus, onboarding, prospective-members) eagerly import all page components, which increases the initial bundle size.

**Recommendation:** Standardize all module route files to use `lazyWithRetry()` for page imports. Only critical pages (Dashboard, Login) should be eagerly loaded.

### 2.4 Critical type safety violations

Two modules have severe TypeScript safety issues that undermine the project's strict mode configuration:

**Scheduling service** (`modules/scheduling/services/api.ts`): 50+ functions use `Record<string, unknown>` for both input parameters and return types. This means callers get zero type checking on the data they pass to create/update endpoints. Every mutation function (createShift, updateShift, createCall, etc.) accepts untyped data.

**Prospective-members service** (`modules/prospective-members/services/api.ts`): A blanket `eslint-disable` disables 6 TypeScript safety rules for ~720 lines of the backend-to-frontend mapping layer. All mapping functions use `any` as parameter types.

Both modules need proper typed interfaces for their API request/response shapes.

### 2.5 Monolithic page components

Three components far exceed reasonable size and should be decomposed:

| Component | Lines | Module | Contains |
|-----------|-------|--------|----------|
| `AdminHoursManagePage.tsx` | 1,150+ | admin-hours | 5 tab panels (categories, active sessions, pending, all entries, summary) |
| `ShiftSettingsPanel.tsx` | 932 | scheduling | 4 editors (positions, apparatus defaults, resource defaults, department defaults) |
| `ApparatusDetailPage.tsx` | 756 | apparatus | 5 tab panels (maintenance, fuel, operators, equipment, documents) |

Each tab or editor section should be extracted into its own component file.

### 2.6 Inconsistent API client patterns

Three different patterns are used to create API clients:

1. **`createApiClient()` factory** (correct pattern) -- used by admin-hours, apparatus, communications, prospective-members, public-portal
2. **Custom `SecureApiClient` with raw `fetch()`** -- used only by onboarding, bypassing axios entirely and managing its own CSRF/session handling
3. **Manual axios instance with copy-pasted interceptors** -- used only by scheduling, duplicating ~50 lines from `createApiClient.ts`

Both deviations should be migrated to `createApiClient()` for consistency and to avoid duplicated security logic.

### 2.7 Inconsistent error handling in stores

Every store uses `error instanceof Error ? error.message : 'Failed to...'` instead of the project's `toAppError()` / `getErrorMessage()` utilities from `utils/errorHandling.ts`. This is repeated 50+ times across all stores.

**Recommendation:** Create a store error handling helper:
```typescript
// utils/storeHelpers.ts
import { getErrorMessage } from './errorHandling';
export const handleStoreError = (err: unknown, fallback: string) => getErrorMessage(err, fallback);
```
Refactor all stores to use it, reducing boilerplate and ensuring consistent error normalization.

### 2.8 Test coverage is critically low

| Module | Frontend Tests | Backend Tests |
|--------|---------------|---------------|
| admin-hours | 0 | 0 |
| apparatus | 0 | 0 |
| communications | 29 tests (4 files) | 0 |
| membership | 0 | 0 |
| onboarding | 0 | 5 tests (1 file) |
| prospective-members | 0 | 0 |
| public-portal | 0 | 0 |
| scheduling | 12 tests (1 file) | Extensive (3 files) |

**6 of 8 modules have zero frontend tests. 6 of 8 modules have zero backend tests.** The project's coverage threshold is 80% lines/functions/statements, which suggests these thresholds are either not enforced or are met only by the non-module code.

**Recommendation (priority order):**
1. **onboarding** -- largest module, zero frontend tests, critical user journey
2. **public-portal** -- security-sensitive (API keys, access logs), zero tests
3. **admin-hours** -- business-critical clock-in/out, zero tests everywhere
4. **prospective-members** -- complex pipeline logic, zero tests
5. **apparatus** -- moderate complexity, zero tests
6. **membership** -- store has a scalability bug (client-side pagination), needs tests to support refactoring

### 2.9 Backend feature flags not enforced on frontend

The backend has `MODULE_*_ENABLED` feature flags (e.g., `MODULE_TRAINING_ENABLED`, `MODULE_ELECTIONS_ENABLED`), but the frontend doesn't consume these flags to conditionally render module routes or navigation items. A disabled module's routes are still accessible in the frontend.

**Recommendation:** Fetch module enablement status from a backend endpoint (e.g., `GET /api/v1/modules/status`) during app initialization and use it to conditionally register routes and hide navigation items.

---

## 3. Expansion Opportunities

### 3.1 Major features lacking module structure

These features have full backend support (endpoints, services, models, schemas) and frontend pages but are NOT organized as modules:

| Feature | Backend Files | Frontend Pages | Routes in App.tsx |
|---------|--------------|----------------|-------------------|
| **Events** | event_service.py, events.py, event.py model | EventsPage, CreateEvent, EventDetail, EventAdmin, etc. | 8+ routes |
| **Training** | 8 service files, 6 endpoint files | TrainingPage, TrainingAdmin, TrainingPrograms, etc. | 12+ routes |
| **Inventory** | inventory_service.py, inventory.py | InventoryPage, InventoryAdmin, MyEquipment, etc. | 5 routes |
| **Skills Testing** | skills_testing_service.py, skills_testing.py | SkillsTestingPage, SkillsTestingAdmin, etc. | 6 routes |

**Recommendation:** Create full module directories for these features following the established pattern (index.ts, routes.tsx, pages/, components/, services/, store/, types/).

### 3.2 Registered but unimplemented modules

`AVAILABLE_MODULES` advertises these modules with zero implementation:

- **Incidents & Reports** (`incidents`) -- Incident logging, run reports, NFIRS reporting. This is a core fire department need
- **HR & Payroll** (`hr-payroll`) -- Time tracking, benefits, payroll processing
- **Grants & Fundraising** (`grants`) -- Grant tracking, fundraising campaigns, budget management
- **Mobile App Access** (`mobile`) -- Mobile optimization, push notifications, offline access

**Recommendation:** Either implement these modules or remove them from `AVAILABLE_MODULES` to avoid misleading the onboarding flow. At minimum, the `incidents` module should be prioritized as it's fundamental to fire department operations.

### 3.3 Backend services without frontend representation

These backend services exist but have no corresponding frontend module or page:

| Backend Service | Purpose | Frontend Status |
|----------------|---------|-----------------|
| `struggling_member_service.py` | Detects members at risk of disengagement | No UI |
| `competency_matrix_service.py` | Skills/competency tracking matrix | No UI |
| `cert_alert_service.py` | Certification expiry alerting | No UI (alerts only) |
| `departure_clearance_service.py` | Exit procedure checklist for departing members | No UI |
| `property_return_service.py` / `property_return_reminder_service.py` | Track department property returns | No UI |
| `quorum_service.py` | Meeting quorum calculation | No UI |
| `member_archive_service.py` | Inactive member archival | No UI |
| `attendance_dashboard_service.py` | Attendance analytics dashboard | No dedicated UI |

**Recommendation:** These represent completed backend work waiting for frontend exposure. Prioritize:
1. **Competency matrix** -- valuable for training compliance visualization
2. **Struggling member alerts** -- proactive member engagement
3. **Departure clearance** -- important for property accountability
4. **Quorum tracking** -- useful for meetings module

### 3.4 Communications module expansion

The communications module currently only manages email templates and scheduled emails. Its `AVAILABLE_MODULES` entry advertises:
- Department announcements
- Direct messaging
- Group discussions
- Emergency notifications
- Email integration (partially done)
- Mobile push notifications

The backend has `messaging_service.py` and `messages.py` endpoint, as well as a `notifications_service.py`. These should be surfaced in the communications module.

### 3.5 Meetings module

The backend has `meetings_service.py`, `minute_service.py`, and `quorum_service.py` with full CRUD. The frontend has standalone pages (`MeetingsPage`, `MinutesPage`) but no module directory. This should be a proper module with:
- Meeting creation and scheduling
- Agenda management
- Minutes editing with action item tracking
- Attendance tracking with quorum calculation
- Integration with the scheduling module for calendar views

---

## 4. Recommended Iteration Roadmap

### Phase 1: Structural consolidation and critical fixes (low risk, high impact)

1. **Fix type safety violations** -- replace 50+ `Record<string, unknown>` in scheduling service with proper interfaces; add typed backend response interfaces to prospective-members service to remove blanket ESLint disable
2. **Decompose monolithic components** -- split `AdminHoursManagePage` (1,150 lines), `ShiftSettingsPanel` (932 lines), and `ApparatusDetailPage` (756 lines) into tab/section components
3. **Unify API clients** -- migrate onboarding's custom `SecureApiClient` and scheduling's manual axios instance to use `createApiClient()`
4. **Standardize module boilerplate** -- add missing `index.ts`, `routes.tsx`, and types directories to `public-portal` and `scheduling`
5. **Migrate inline routes out of App.tsx** -- start with Events and Training (the two largest)
6. **Standardize lazy loading** -- convert all module route files to use `lazyWithRetry()`
7. **Fix module registry** -- update `AVAILABLE_MODULES` to match reality
8. **Unify error handling** -- replace `instanceof Error` pattern with `toAppError()` across all stores
9. **Fix bugs** -- `useAccessLogs` infinite refetch loop, apparatus manual auth check, scheduling localStorage settings

### Phase 2: Test coverage (medium effort, critical for quality)

1. Add store tests for all modules (following the communications and scheduling test patterns)
2. Add component tests for business-critical UI (pipeline kanban, clock-in flow, apparatus forms)
3. Add backend endpoint tests for admin-hours, apparatus, membership-pipeline, and public-portal
4. Add onboarding flow E2E test with Playwright

### Phase 3: Feature expansion (high effort, high value)

1. **Events module** -- extract from App.tsx + pages/ into a proper module
2. **Training module** -- extract into module; add competency matrix UI
3. **Inventory module** -- extract into module
4. **Meetings module** -- create module combining meetings, minutes, and quorum
5. **Communications expansion** -- add messaging UI, announcement board, notification preferences
6. **Incidents module** -- new implementation using backend stubs

### Phase 4: Architecture improvements (ongoing)

1. **Server-side pagination for membership** -- replace client-side filtering
2. **Module feature flag enforcement** -- conditionally register routes based on backend flags
3. **Split large stores** -- prospective-members store (665 lines) into sub-stores
4. **Migrate membership pages** into the module directory
5. **Add optimistic updates** for pipeline stage transitions and clock-in/out operations
6. **Unify public-portal state management** to Zustand for consistency

---

## Appendix: Module Completeness Matrix

| Module | index.ts | routes.tsx | pages/ | components/ | services/ | store/ | types/ | tests |
|--------|----------|------------|--------|-------------|-----------|--------|--------|-------|
| admin-hours | Y | Y | Y (4) | Empty | Y | Y | Y | None |
| apparatus | Y | Y | Y (3) | Y (2) | Y | Y | Y | None |
| communications | Y | Y | Y (1) | Y (5) | Y | Y (2) | Re-exports | 4 files |
| membership | Y | Y | External | None | None | Y | Re-exports | None |
| onboarding | Y | Y | Y (12) | Y (11) | Y | Y | Y | None |
| prospective-members | Y | Y | Y (3) | Y (7) | Y | Y | Y | None |
| public-portal | **None** | **None** | Y (1) | Y (5) | Y | **None** | Y | None |
| scheduling | Y | **None** | **None** | Y (2) | Y | Y | **None** | 1 file |
