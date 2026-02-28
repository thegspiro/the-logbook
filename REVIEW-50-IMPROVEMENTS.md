# Code Review: 50 Identified Improvements

Date: 2026-02-28

---

## Security & HIPAA Compliance

### 1. `useIdleTimer.ts` bypasses global axios instance
- **File:** `frontend/src/hooks/useIdleTimer.ts:83`
- **Severity:** Critical
- Uses raw `axios.get('/api/v1/auth/session-settings')` instead of the shared `api` instance from `services/api.ts`, skipping CSRF protection, auth refresh interceptors, and cache exclusion logic.

### 2. `AppLayout.tsx` missing XSS validation on logo URL
- **File:** `frontend/src/components/layout/AppLayout.tsx:48-60`
- **Severity:** High
- Loads logo from `localStorage.getItem('logoData')` without validating URL protocol. `LoginPage.tsx` has correct validation but `AppLayout` doesn't.

### 3. `apiCache.ts` UNCACHEABLE_PREFIXES uses only prefix matching
- **File:** `frontend/src/utils/apiCache.ts`
- **Severity:** Medium
- `/messages/` is excluded but sub-routes may not be caught. No pattern/regex matching for granular exclusion.

### 4. `errorHandling.ts` may leak PHI in error details
- **File:** `frontend/src/utils/errorHandling.ts:62-65`
- **Severity:** High
- `toAppError()` includes Error stack traces in `details`, which could contain file paths or query parameters with user IDs.

### 5. Backend `organizations.py` accepts untyped `dict`
- **File:** `backend/app/api/v1/endpoints/organizations.py:880`
- **Severity:** Critical
- `update_organization_profile(updates: dict)` allows arbitrary field updates without Pydantic schema validation.

### 6. Backend IP allowlist feature is incomplete
- **File:** `backend/app/core/security_middleware.py:727,756`
- **Severity:** Medium
- `_get_allowed_ips()` returns empty set with TODO. `_log_blocked_attempt()` has bare `pass`.

### 7. Conflicting `X-Frame-Options` headers
- **File:** `infrastructure/nginx/nginx.conf:85` vs `frontend/nginx.conf`
- **Severity:** Medium
- Infrastructure sets `SAMEORIGIN`, frontend sets `DENY`. Should be consistent (`DENY` for HIPAA).

---

## Error Handling

### 8. Backend endpoints missing `safe_error_detail()` wrapping
- **Files:** `users.py:97,337,1206`, `platform_analytics.py:109,187,215`, `training.py:465,1361,1784`, `security_monitoring.py:329`
- **Severity:** High
- Bare `except Exception` blocks could leak internal error details to clients.

### 9. `useEvent.ts` uses manual error extraction
- **File:** `frontend/src/hooks/useEvent.ts:32`
- **Severity:** Low
- Inline type assertion instead of `getErrorMessage(err, 'Failed to load event')`.

### 10. `authStore.ts` `loadUser()` silently swallows all errors
- **File:** `frontend/src/stores/authStore.ts:193`
- **Severity:** Medium
- Catches all exceptions without distinguishing expected 401s from unexpected errors.

### 11. `dateFormatting.ts` doesn't validate malformed date strings
- **File:** `frontend/src/utils/dateFormatting.ts:18-76`
- **Severity:** Medium
- Passes malformed strings to `new Date()`, producing `Invalid Date` without fallback.

### 12. Inconsistent service-layer error patterns in backend
- **Files:** Multiple service files
- **Severity:** Medium
- Some services return `Tuple[Optional[T], Optional[str]]`, others raise `ValueError`. Should standardize.

---

## Floating Promises

### 13. `useIdleTimer.ts` floating promise
- **File:** `frontend/src/hooks/useIdleTimer.ts:83-93`
- **Severity:** Medium
- Axios call chain without `void` prefix.

### 14. `errorTracking.ts` floating promise
- **File:** `frontend/src/services/errorTracking.ts:161-169`
- **Severity:** Medium
- `errorLogsService.logError().catch()` missing `void` prefix.

### 15. `analytics.ts` floating promises
- **File:** `frontend/src/services/analytics.ts:134-141`
- **Severity:** Medium
- Multiple `analyticsApiService.trackEvent().catch()` calls missing `void` prefix.

### 16. `api.ts` background revalidation floating promise
- **File:** `frontend/src/services/api.ts:186-189`
- **Severity:** Medium
- Background revalidation promise chain missing `void` prefix.

### 17. `useAppUpdate.ts` floating promise in `dismiss()`
- **File:** `frontend/src/hooks/useAppUpdate.ts:122`
- **Severity:** Low
- `fetch('/version.json')` chain missing `void` prefix.

---

## Accessibility

### 18. `ProtectedRoute.tsx` loading spinners lack a11y attributes
- **File:** `frontend/src/components/ProtectedRoute.tsx:39,52`
- **Severity:** High
- Missing `role="status"`, `aria-live`, `aria-label` on spinner divs. Existing `LoadingSpinner.tsx` has these correctly.

### 19. `EventsAdminHub.tsx` uses wrong ARIA tab pattern
- **File:** `frontend/src/pages/EventsAdminHub.tsx:90`
- **Severity:** Medium
- Uses `aria-current="page"` instead of `role="tab"` + `aria-selected` + `role="tablist"`.

### 20. Missing ARIA labels on interactive elements in modules
- **Files:** `AdminHoursPage.tsx`, `AdminHoursManagePage.tsx:505`
- **Severity:** Medium
- Clock-out button, "Select All" checkbox, and color picker buttons lack `aria-label`.

### 21. Form errors not linked to inputs via `aria-describedby`
- **File:** `frontend/src/modules/admin-hours/pages/AdminHoursPage.tsx:327-329`
- **Severity:** Medium
- Error messages rendered as siblings without `aria-describedby` on the input.

### 22. `LoginPage.tsx` errors missing `aria-live="assertive"`
- **File:** `frontend/src/pages/LoginPage.tsx:230-241`
- **Severity:** Low
- Uses `role="alert"` without `aria-live` for immediate announcement.

### 23. `Modal.tsx` focus management issue
- **File:** `frontend/src/components/Modal.tsx:59,138`
- **Severity:** Medium
- Attempts `modalRef.current?.focus()` on a `tabIndex={-1}` div. Should focus the first focusable child.

---

## Theming & Styling Consistency

### 24. Hardcoded `indigo-*` colors throughout
- **Files:** `ProtectedRoute.tsx:81,101`, `LoginPage.tsx:272-304`, `BallotBuilder.tsx:199,207,232,250`
- **Severity:** High
- Should use `btn-primary` class (`bg-red-600`) or theme CSS variables.

### 25. Inconsistent focus ring colors
- **Files:** `LoginPage.tsx` (`ring-indigo-500`), `EventsAdminHub.tsx` (`ring-red-500`)
- **Severity:** Medium
- Global `index.css:601-604` defines `ring-red-500` as standard.

### 26. "Access Denied" buttons use `<a href>` instead of `<Link>`
- **File:** `frontend/src/components/ProtectedRoute.tsx:79-84,99-104`
- **Severity:** Low
- Raw anchor tags cause full page reload instead of SPA navigation.

### 27. `LoadingSpinner.tsx` redundant ternary
- **File:** `frontend/src/components/LoadingSpinner.tsx:34`
- **Severity:** Low
- Both branches of `fullScreen ? 'text-theme-text-secondary' : 'text-theme-text-secondary'` are identical.

---

## Code Duplication

### 28. CSRF/auth interceptor logic duplicated across 4+ module services
- **Files:** `admin-hours/services/api.ts`, `apparatus/services/api.ts`, `public-portal/services/publicPortalApi.ts`, `prospective-members/services/api.ts`
- **Severity:** High
- Identical `getCookie()`, CSRF injection, 401 refresh, and localStorage cleanup. Should extract to `createAuthenticatedAxiosClient()` factory.

### 29. Form input class constants duplicated across components
- **Files:** `EventForm.tsx:68-78` and others
- **Severity:** Low
- CSS already defines `.form-input` in `index.css:326-329`.

### 30. Error handling pattern duplicated in every Zustand store
- **Files:** All module store files
- **Severity:** Low
- Same `error instanceof Error ? error.message : 'Failed to ...'` pattern. Should extract utility.

### 31. Pagination calculation repeated across pages
- **Files:** Multiple page files
- **Severity:** Low
- `Math.ceil(total / PAGE_SIZE)` repeated. Should be a utility.

---

## Performance

### 32. `get_setup_checklist()` makes 16+ sequential DB queries
- **File:** `backend/app/api/v1/endpoints/organizations.py:515-607`
- **Severity:** High
- Separate `func.count()` queries for each entity. Should combine into single aggregation.

### 33. `apiCache.ts` has no size limit
- **File:** `frontend/src/utils/apiCache.ts`
- **Severity:** Medium
- Unbounded `Map` growth. Should implement LRU eviction.

### 34. `useRelativeTime` creates per-instance timers
- **File:** `frontend/src/hooks/useRelativeTime.ts:55`
- **Severity:** Medium
- 100+ timestamps = 100 independent `setInterval` timers. Should centralize.

### 35. `useKeyboardShortcuts` memoization defeated
- **File:** `frontend/src/hooks/useKeyboardShortcuts.ts:49`
- **Severity:** Low
- Inline `shortcuts` array recreated each render defeats `useCallback`.

### 36. Missing eager loading in backend list endpoints
- **Files:** Multiple endpoint files
- **Severity:** Medium
- Only ~10 files use `selectinload`/`joinedload`. Likely N+1 queries in list endpoints.

---

## Missing Audit Logging

### 37. `admin_hours.py` missing audit logging
- **File:** `backend/app/api/v1/endpoints/admin_hours.py:65-82,89-102`
- **Severity:** High
- `create_category()` and `update_category()` have no `log_audit_event()`.

### 38. `facilities.py` missing audit logging
- **File:** `backend/app/api/v1/endpoints/facilities.py:137-152`
- **Severity:** High
- Facility type CRUD missing audit trails.

### 39. `forms.py` missing audit logging
- **File:** `backend/app/api/v1/endpoints/forms.py`
- **Severity:** Medium
- Form CRUD operations lack audit logging despite collecting sensitive member data.

---

## Backend Schema & API Issues

### 40. Response schemas missing camelCase `ConfigDict`
- **Files:** `schemas/user.py`, `schemas/auth.py`, and 10-15 others
- **Severity:** High
- Missing `ConfigDict(alias_generator=to_camel, populate_by_name=True)` causing snake_case responses.

### 41. `organizations.py` dead logic
- **File:** `backend/app/api/v1/endpoints/organizations.py:769`
- **Severity:** Low
- `"prospective_members" in enabled_modules or True` always evaluates to `True`.

### 42. Admin-hours types mix snake_case and camelCase
- **File:** `frontend/src/modules/admin-hours/types/index.ts`
- **Severity:** Low
- Create interfaces use snake_case, Response interfaces use camelCase. Should be consistent.

---

## Module Structure

### 43. Membership module breaks encapsulation
- **File:** `frontend/src/modules/membership/routes.tsx`
- **Severity:** Medium
- Imports page components from `../../pages/` (outside the module boundary).

### 44. Public portal module missing `pages/` directory
- **File:** `frontend/src/modules/public-portal/`
- **Severity:** Low
- Has `components/`, `hooks/`, `services/`, `types/` but no `pages/`.

### 45. `admin-hours/components/index.ts` is empty barrel export
- **File:** `frontend/src/modules/admin-hours/components/index.ts`
- **Severity:** Low
- Contains only `export {}` placeholder.

---

## Test Coverage Gaps

### 46. Frontend services have 0% test coverage
- **Files:** `services/api.ts`, `services/errorTracking.ts`, `services/analytics.ts`
- **Severity:** Critical
- `api.ts` (CSRF, auth refresh, interceptors) is critical for HIPAA compliance verification.

### 47. Frontend hooks have ~7% test coverage
- **Files:** 14 of 15 hooks untested
- **Severity:** High
- Critical untested: `useIdleTimer`, `useFocusTrap`, `useInventoryWebSocket`, `useOptimisticUpdate`.

### 48. Backend auth and user services have no tests
- **Files:** `auth_service.py`, `user_service.py`
- **Severity:** Critical
- Authentication, MFA, TOTP, and user management are security-critical and untested.

---

## Configuration

### 49. Missing Prettier configuration file
- **Location:** `frontend/`
- **Severity:** Medium
- No `.prettierrc.json`. Prettier defaults to 80-char lines, conflicting with Tailwind class strings. Should set `printWidth: 120` and include `prettier-plugin-tailwindcss`.

### 50. CI pipeline missing coverage enforcement and E2E
- **File:** `.github/workflows/ci.yml`
- **Severity:** High
- No `--coverage` flags, no threshold enforcement, 3 integration tests skipped without explanation, no E2E step despite Playwright tests existing.
