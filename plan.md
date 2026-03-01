# Implementation Plan: Module Improvements

Based on the comprehensive review in `MODULES_REVIEW.md`, this plan addresses the improvements in priority order across 4 phases. Each phase is broken into discrete, independently committable tasks.

---

## Phase 1: Critical Fixes and Type Safety

### 1.1 Fix scheduling service type safety (50+ `Record<string, unknown>`)

**Files to create:**
- `frontend/src/modules/scheduling/types/index.ts` — New file containing all Create/Update/Query/Report interfaces

**Types to define (based on function signatures and backend schemas):**
- `ShiftCreate`, `ShiftUpdate` (for `createShift`, `updateShift`)
- `ShiftCallCreate`, `ShiftCallUpdate` (for `createCall`, `updateCall`)
- `AssignmentCreate`, `AssignmentUpdate` (for `createAssignment`, `updateAssignment`)
- `SwapRequestCreate`, `SwapReviewRequest` (for `createSwapRequest`, `reviewSwapRequest`)
- `TimeOffCreate`, `TimeOffReviewRequest` (for `createTimeOff`, `reviewTimeOff`)
- `ShiftTemplateCreate`, `ShiftTemplateUpdate` (for `createTemplate`, `updateTemplate`)
- `BasicApparatusCreate`, `BasicApparatusUpdate` (for `createBasicApparatus`, `updateBasicApparatus`)
- `ShiftPatternCreate`, `ShiftPatternUpdate`, `PatternGenerateRequest` (for pattern CRUD)
- `SwapRequestFilters`, `TimeOffFilters`, `AvailabilityFilters` (for query params)
- `MemberHoursReport`, `CoverageReport`, `CallVolumeReport`, `AvailabilityRecord` (for report returns)
- `ShiftSignupResponse` (for `signupForShift` return)

**Files to modify:**
- `frontend/src/modules/scheduling/services/api.ts` — Replace all `Record<string, unknown>` params/returns with the new types; also migrate from manual axios instance to `createApiClient()` (removes ~70 lines of duplicated interceptor logic and the duplicate `declare module 'axios'` augmentation)
- `frontend/src/modules/scheduling/index.ts` — Re-export types from `./types` instead of from `./services/api`

**Note:** Many return types already exist in `frontend/src/types/scheduling.ts` (`Assignment`, `SwapRequest`, `TimeOffRequest`, `ShiftPattern`, `ShiftCall`). The service just needs to reference them. Only the Create/Update input types and report response types are truly new.

### 1.2 Fix prospective-members service type safety (blanket ESLint disable)

**Files to create:**
- None — types go in the existing `frontend/src/modules/prospective-members/types/index.ts`

**Types to add to `types/index.ts`:**
- `BackendStepResponse` — shape of a single step from the backend API
- `BackendPipelineResponse` — shape of a full pipeline from the backend
- `BackendPipelineListItemResponse` — shape of a pipeline summary
- `BackendStepCreatePayload`, `BackendStepUpdatePayload` — return types for `mapStageCreate/UpdateToBackend`
- `BackendStepProgressResponse` — nested in prospect response
- `BackendProspectResponse` — shape of a single prospect from backend
- `BackendProspectListItemResponse` — shape of a prospect list item
- `BackendPipelineStatsResponse` — stats response shape
- `BackendElectionPackageResponse` — election package shape
- `BackendDocumentResponse` — document shape
- `BackendPaginatedResponse<T>` — generic paginated response wrapper

**Files to modify:**
- `frontend/src/modules/prospective-members/services/api.ts` — Replace `any` parameters with the new Backend* types on all 8 mapping functions. Remove the blanket `eslint-disable` at line 94. Replace `...data` spread in `mapProspectToApplicant` with explicit field mapping for type safety
- Move utility functions (`getEffectiveTimeoutDays`, `isSafeUrl`, `getInitials`, `isValidEmail`) from `types/index.ts` to a new `frontend/src/modules/prospective-members/utils/index.ts`

### 1.3 Fix bugs

**1.3a `useAccessLogs` infinite refetch loop:**
- File: `frontend/src/modules/public-portal/hooks/usePublicPortal.ts`
- Fix: Replace the `filters` object dependency in the `useCallback` (line 173) with `JSON.stringify(filters)` as the dependency key, and use a ref or `useMemo` to stabilize the reference

**1.3b Apparatus manual auth check:**
- File: `frontend/src/modules/apparatus/pages/ApparatusDetailPage.tsx`
- Fix: Remove the `localStorage.getItem('has_session')` check and redirect in the `useEffect` (lines 77-79). Auth is already handled by `<ProtectedRoute>` in the route definitions

**1.3c Scheduling localStorage settings:**
- This is a larger change (needs a backend endpoint). Defer to Phase 4 and document as tech debt

### 1.4 Unify error handling across all stores

**File to create:**
- `frontend/src/utils/storeHelpers.ts` — Export `handleStoreError(err: unknown, fallback: string): string` wrapping `getErrorMessage()`

**Files to modify (replace `error instanceof Error ? error.message : 'fallback'` pattern):**
- `frontend/src/modules/admin-hours/store/adminHoursStore.ts` (~15 occurrences)
- `frontend/src/modules/apparatus/store/apparatusStore.ts` (~8 occurrences)
- `frontend/src/modules/membership/store/membershipStore.ts` (~3 occurrences)
- `frontend/src/modules/prospective-members/store/prospectiveMembersStore.ts` (~20 occurrences)
- `frontend/src/modules/scheduling/store/schedulingStore.ts` (already uses `getErrorMessage` in some places — standardize the rest)

---

## Phase 2: Component Decomposition

### 2.1 Decompose `AdminHoursManagePage.tsx` (1,150+ lines)

**Files to create inside `frontend/src/modules/admin-hours/components/`:**
- `CategoriesTab.tsx` — Category list + inline create/edit form (lines 370-555)
- `CategoryForm.tsx` — Category create/edit form extracted from CategoriesTab (lines 394-487)
- `ActiveSessionsTab.tsx` — Active clock-in sessions admin view (lines 558-656)
- `PendingReviewTab.tsx` — Pending entry review with inline edit and bulk approve (lines 659-881)
- `AllEntriesTab.tsx` — All entries list with filters and CSV export (lines 884-1003)
- `SummaryTab.tsx` — Hours summary display (lines 1006-1049)

**Shared utility to extract:**
- `frontend/src/modules/admin-hours/utils/formatDuration.ts` — The `formatDuration(minutes)` helper used by multiple tabs

**Parent component retains:** Active tab state, store subscription (or each child subscribes via Zustand selectors), `loadData()` orchestration, error toast effect.

**Also fix:** Replace hardcoded `PAGE_SIZE = 20` with `DEFAULT_PAGE_SIZE` from `constants/config.ts`.

### 2.2 Decompose `ShiftSettingsPanel.tsx` (932 lines)

**Files to create:**
- `frontend/src/modules/scheduling/types/shiftSettings.ts` — Move the 5 interfaces and constants (lines 22-125): `ApparatusTypeDefaults`, `CustomPosition`, `ResourceTypeDefaults`, `ShiftSettings`, `BUILTIN_POSITIONS`, `DEFAULT_APPARATUS_TYPE_POSITIONS`, `DEFAULT_RESOURCE_TYPE_POSITIONS`, `DEFAULT_SETTINGS`
- `frontend/src/modules/scheduling/components/TemplatesOverviewCard.tsx` (lines 270-342)
- `frontend/src/modules/scheduling/components/ApparatusTypeDefaultsCard.tsx` (lines 344-503)
- `frontend/src/modules/scheduling/components/ResourceTypeDefaultsCard.tsx` (lines 505-653)
- `frontend/src/modules/scheduling/components/DepartmentDefaultsCard.tsx` (lines 699-779)
- `frontend/src/modules/scheduling/components/PositionNamesCard.tsx` (lines 781-900)
- `frontend/src/modules/scheduling/components/index.ts` — Barrel export for all components

**Shared sub-component opportunity:** The position list editor pattern (inline select + add/remove) is duplicated between `ApparatusTypeDefaultsCard` and `ResourceTypeDefaultsCard`. Extract as `PositionListEditor.tsx`.

**Parent retains:** The `settings` state object, `handleSave`/`handleReset`, and passes slices to each card via props.

### 2.3 Decompose `ApparatusDetailPage.tsx` (756 lines)

**Files to create inside `frontend/src/modules/apparatus/components/`:**
- `ApparatusDetailHeader.tsx` — Back button, title, status badge, edit/archive actions (lines 183-232)
- `ApparatusOverviewTab.tsx` — The overview tab with all info cards (lines 271-497). Can be further split into `VehicleDetailsCard`, `SpecificationsCard`, `FinancialInfoCard`, `QuickStatsCard`, `ImportantDatesCard` if desired
- `MaintenanceTab.tsx` (lines 500-560)
- `FuelLogsTab.tsx` (lines 563-612)
- `OperatorsTab.tsx` (lines 615-664)
- `EquipmentTab.tsx` (lines 667-724)
- `DocumentsTab.tsx` (lines 727-749)

**Shared utility to extract:**
- `frontend/src/modules/apparatus/utils/formatCurrency.ts` — The `formatCurrency(amount)` helper

**Also fix:** Remove the manual `localStorage.getItem('has_session')` auth check (covered in 1.3b). Replace hardcoded gradient backgrounds with theme CSS variables.

---

## Phase 3: Structural Standardization

### 3.1 Complete `public-portal` module structure

**Files to create:**
- `frontend/src/modules/public-portal/index.ts` — Barrel export
- `frontend/src/modules/public-portal/routes.tsx` — `getPublicPortalRoutes()` with `lazyWithRetry` and `requiredPermission="settings.manage"`
- Rename `publicPortalApi.ts` → `api.ts` for naming consistency

**Files to modify:**
- `frontend/src/App.tsx` — Replace inline `PublicPortalAdmin` route (line 589) with `{getPublicPortalRoutes()}`

### 3.2 Complete `scheduling` module structure

**Files to create:**
- `frontend/src/modules/scheduling/routes.tsx` — `getSchedulingRoutes()` using `lazyWithRetry`
- Move `frontend/src/pages/SchedulingPage.tsx` → `frontend/src/modules/scheduling/pages/SchedulingPage.tsx`
- `frontend/src/modules/scheduling/pages/index.ts` — Barrel export

**Files to modify:**
- `frontend/src/App.tsx` — Replace inline scheduling route with `{getSchedulingRoutes()}`
- `frontend/src/modules/scheduling/index.ts` — Add route export

### 3.3 Standardize lazy loading in all module routes

**Files to modify:**
- `frontend/src/modules/admin-hours/routes.tsx` — Replace direct page imports with `lazyWithRetry()` + `Suspense`
- `frontend/src/modules/apparatus/routes.tsx` — Same
- `frontend/src/modules/onboarding/routes.tsx` — Same (lower priority since onboarding runs once)
- `frontend/src/modules/prospective-members/routes.tsx` — Same

### 3.4 Extract Events routes from App.tsx

**Files to create:**
- `frontend/src/modules/events/index.ts` — Barrel export
- `frontend/src/modules/events/routes.tsx` — `getEventsRoutes()` + `getEventsPublicRoutes()` containing:
  - `/events` → `EventsPage`
  - `/events/:id` → `EventDetailPage`
  - `/events/:id/qr-code` → `EventQRCodePage`
  - `/events/:id/check-in` → `EventSelfCheckInPage`
  - `/events/admin` → `EventsAdminHub` (requires `events.manage`)
  - `/events/:id/edit` → `EventEditPage` (requires `events.manage`)
  - `/events/:id/monitoring` → `EventCheckInMonitoringPage` (requires `events.manage`)
  - `/events/:id/analytics` → `AnalyticsDashboardPage` (requires `analytics.view`)
  - `/events/new` → Redirect to `/events/admin?tab=create`
  - Public: `/event-request/status/:token` → `EventRequestStatusPage`

**Files to modify:**
- `frontend/src/App.tsx` — Remove 12+ lines of Events route definitions, replace with `{getEventsRoutes()}` and `{getEventsPublicRoutes()}`

**Note:** `AnalyticsDashboardPage` is shared between Events (`/events/:id/analytics`) and Admin (`/admin/analytics`). The import stays in both route files since `lazyWithRetry` handles deduplication via webpack chunks.

### 3.5 Extract Training routes from App.tsx

**Files to create:**
- `frontend/src/modules/training/index.ts` — Barrel export
- `frontend/src/modules/training/routes.tsx` — `getTrainingRoutes()` containing:
  - `/training` → `MyTrainingPage`
  - `/training/my-training` → `MyTrainingPage`
  - `/training/submit` → `SubmitTrainingPage`
  - `/training/courses` → `CourseLibraryPage`
  - `/training/programs` → `TrainingProgramsPage`
  - `/training/programs/:programId` → `PipelineDetailPage`
  - `/training/admin` → `TrainingAdminPage` (requires `training.manage`)
  - `/training/skills-testing` → `SkillsTestingPage`
  - `/training/skills-testing/templates/new` → `SkillTemplateBuilderPage` (requires `training.manage`)
  - `/training/skills-testing/templates/:id` → `SkillTemplateBuilderPage` (requires `training.manage`)
  - `/training/skills-testing/templates/:id/edit` → `SkillTemplateBuilderPage` (requires `training.manage`)
  - `/training/skills-testing/test/new` → `StartSkillTestPage`
  - `/training/skills-testing/test/:testId` → `ActiveSkillTestPage`
  - `/training/skills-testing/test/:testId/active` → `ActiveSkillTestPage`
  - 7 legacy redirects (officer, submissions, requirements, sessions/new, programs/new, shift-reports, integrations)

**Files to modify:**
- `frontend/src/App.tsx` — Remove ~30 lines of Training/Skills Testing route definitions

### 3.6 Extract Inventory routes from App.tsx

**Files to create:**
- `frontend/src/modules/inventory/index.ts`
- `frontend/src/modules/inventory/routes.tsx` — `getInventoryRoutes()` (5 routes)

### 3.7 Extract remaining route groups from App.tsx

**Files to create (smaller modules, 1-3 routes each):**
- `frontend/src/modules/elections/routes.tsx` — `getElectionsRoutes()` + `getElectionsPublicRoutes()` (2 protected + 1 public ballot route)
- `frontend/src/modules/minutes/routes.tsx` — `getMinutesRoutes()` (2 routes)
- `frontend/src/modules/facilities/routes.tsx` — `getFacilitiesRoutes()` + `getFacilitiesPublicRoutes()` (2 protected + 1 public kiosk route)

**Not extracting (too heterogeneous or too small):**
- Settings/Admin routes — these span many unrelated features. Keep inline in App.tsx until a proper admin module is designed
- Dashboard — single critical route, stays inline
- Documents, Notifications, Action Items, Reports — single routes, low value to extract

### 3.8 Update module registry

**File to modify:** `frontend/src/types/modules.ts`

Changes to `AVAILABLE_MODULES`:
- **Add missing modules:** `events`, `admin-hours`, `minutes`, `notifications`, `skills-testing`, `onboarding`
- **Fix route mismatches:** `personal-settings` route → `/account`, `system-settings` route → `/settings`
- **Fix naming mismatch:** `public-info` → either rename to `public-portal` or keep both as separate concepts (public-facing info vs API portal admin)
- **Mark unimplemented modules:** Add a `comingSoon?: boolean` field to the `Module` interface and set it on `incidents`, `hr-payroll`, `grants`, `mobile`
- **Sync with backend flags:** Add `backendFlag?: string` field mapping each module to its `MODULE_*_ENABLED` backend config key

---

## Phase 4: Architecture Improvements (Deferred)

These are important but larger-scope changes that should be tackled after Phases 1-3:

- **4.1** Migrate onboarding `SecureApiClient` to `createApiClient()` with custom interceptors for session management (complex — the onboarding client has legitimate pre-auth differences including custom session IDs, different 401 recovery, and non-throwing error model)
- **4.2** Server-side pagination for membership store (requires backend API changes to support `?page=&pageSize=&search=&status=` query params on the users endpoint)
- **4.3** Split `prospectiveMembersStore` (665 lines) into `pipelineStore`, `applicantStore`, `inactivityStore` using Zustand slice pattern
- **4.4** Migrate membership pages from global `pages/` into `modules/membership/pages/`
- **4.5** Create backend endpoint for scheduling settings (replace localStorage persistence)
- **4.6** Add backend feature flag consumption on frontend (fetch `GET /api/v1/modules/status` at init, conditionally register routes)
- **4.7** Migrate public-portal from hooks to Zustand store for consistency
- **4.8** Add optimistic updates for pipeline stage transitions and clock-in/out

---

## Execution Order

The phases are ordered by risk and impact:

1. **Phase 1** (critical fixes) — Can be done file-by-file with no cross-module dependencies. Each task is independently testable
2. **Phase 2** (decomposition) — Pure refactoring with no behavior changes. Existing tests (communications, scheduling store) should continue passing
3. **Phase 3** (structural) — Route extraction is mechanical but touches App.tsx repeatedly. Do these in sequence, committing after each extraction
4. **Phase 4** (architecture) — Each item is independent and can be tackled opportunistically

Within Phase 1, the order should be: 1.3 (bug fixes) → 1.4 (error handling helper) → 1.1 (scheduling types) → 1.2 (prospective-members types).

Within Phase 3, the order should be: 3.1-3.2 (complete existing modules) → 3.3 (lazy loading) → 3.4-3.7 (extract routes, largest first) → 3.8 (registry update, last since it depends on knowing all module IDs).
