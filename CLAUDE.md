# CLAUDE.md — Project Context for Claude Code

## IMPORTANT: Fix All Errors

**Always fix errors you encounter, even if they are pre-existing or unrelated to your current task.** Do not leave broken code, warnings, failing tests, linting violations, or type errors for later. If you discover an issue while working on something else, fix it immediately in the same PR. We never leave known errors behind.

## Pre-Commit Verification Checklist

Before committing any changes, mentally verify these items (the most frequent sources of bugs):

- [ ] **No `??` on form values** — used `||` to coerce empty strings to `undefined` for all optional API fields
- [ ] **`nullable=True` on SET NULL FKs** — every `ondelete="SET NULL"` column has `nullable=True`
- [ ] **Indexed access has fallbacks** — `arr[0] ?? ''` not bare `arr[0]` (due to `noUncheckedIndexedAccess`)
- [ ] **Schema fields match** — Pydantic `Optional` for any field the frontend may omit; enum values are lowercase
- [ ] **No `BaseHTTPMiddleware`** — new middleware uses pure ASGI `__call__(scope, receive, send)`
- [ ] **Module axios has auth** — new module axios instances include `withCredentials: true` + CSRF interceptor
- [ ] **No unused imports (frontend or backend)** — TypeScript strict mode rejects them; Python flake8 F401 catches them. Remove all unused imports before committing
- [ ] **No Python lint violations** — no F401 (unused imports), F811 (redefined unused), F821 (undefined names), E303 (excess blank lines), or W291/W293 (trailing whitespace). Run `flake8` on changed files before committing
- [ ] **Seed migrations registered** — new seed data files added to `SEED_DATA_FILES`; org_id is nullable for system records

## Project Overview

The Logbook is an open-source modular intranet platform for fire departments and emergency services. It is a monorepo with an npm workspaces structure containing a React frontend and a Python backend.

## Tech Stack

### Frontend (`/frontend`)

- **Bundler:** Vite 7.3
- **Framework:** React 19.2 (SPA, not Next.js or React Native)
- **Language:** TypeScript 5.9 (strict mode — see below)
- **Routing:** react-router-dom 6.30
- **State management:** Zustand 5.0
- **Forms:** react-hook-form 7.71 + Zod 4.3 validation
- **Styling:** Tailwind CSS 4.2 (with `tailwind-merge`, dark mode via `class` strategy)
- **HTTP client:** Axios 1.13
- **Auth (client):** httpOnly cookies (managed by backend); no client-side JWT handling
- **Icons:** lucide-react
- **PWA:** vite-plugin-pwa

### Backend (`/backend`)

- **Framework:** FastAPI 0.129 + Uvicorn
- **Language:** Python 3.13
- **ORM:** SQLAlchemy 2.0 (async via aiomysql)
- **Database:** MySQL 8.0
- **Migrations:** Alembic
- **Cache / sessions:** Redis 7
- **Auth:** PyJWT + bcrypt + Argon2 + TOTP (pyotp) + OAuth (authlib) + LDAP + SAML
- **Task queue:** Celery
- **Payments:** Stripe
- **Email:** fastapi-mail + Jinja2 templates
- **SMS:** Twilio
- **Monitoring:** Sentry SDK + Loguru

### Deployment

- Docker Compose (multi-stage builds)
- Nginx reverse proxy (production profile)
- Optional services: Elasticsearch, MinIO (S3-compatible), Mailhog

## TypeScript Strictness

Strict mode is **on** (`"strict": true` in `frontend/tsconfig.json`) with additional checks:

- `noUncheckedIndexedAccess: true`
- `noImplicitReturns: true`
- `noImplicitOverride: true`
- `allowUnreachableCode: false`
- `allowUnusedLabels: false`

All frontend source files use `.ts` / `.tsx` exclusively. Path alias `@/*` maps to `./src/*`.

## Testing

### Frontend (Vitest + Testing Library)

- **Runner:** Vitest 4.0 with jsdom environment
- **Libraries:** @testing-library/react, @testing-library/jest-dom, @testing-library/user-event
- **E2E:** Playwright
- **Coverage:** @vitest/coverage-v8 (thresholds: 80% lines/functions/statements, 75% branches)
- **Run:** `npm run test:frontend` or `cd frontend && npm test`
- Test files are co-located with source: `src/**/*.test.ts(x)`

### Backend (pytest)

- **Runner:** pytest + pytest-asyncio
- **Coverage:** pytest-cov
- **Test data:** Faker
- **Run:** `npm run test:backend` or `cd backend && pytest`
- Test files live in `backend/tests/`
- **Config:** `asyncio_mode = auto` in `pytest.ini` — no need for `@pytest.mark.asyncio` on individual tests. Markers: `integration`, `unit`, `slow`, `docker`
- **Fixtures:** `conftest.py` provides `db_session` (auto-rolled-back transaction per test), `sample_org_data`, `sample_admin_data`, `sample_roles_data`, `sample_stations_data`

### Frontend Test Patterns

The test setup (`src/test/setup.ts`) automatically mocks `window.matchMedia`, `IntersectionObserver`, `ResizeObserver`, and `window.print`. Test utilities (`src/test/utils.tsx`) provide:

- **`renderWithRouter(ui)`** — wraps component in `BrowserRouter`
- **Mock data** — `mockEvent`, `mockUser`, `mockRSVP`, `mockQRCheckInData`
- **Mock factories** — `createMockApiResponse(data)`, `createMockApiError(msg, status)`, `createMockEventService()`
- **Navigation mocks** — `mockNavigate`, `mockUseParams`

**Component test pattern:**
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
```

**Store test pattern** (mock dependencies *before* importing the store):
```typescript
const mockLogin = vi.fn();
vi.mock('../services/api', () => ({
  authService: { login: (...args: unknown[]) => mockLogin(...args) as unknown },
}));
// Import store AFTER mocks are in place
import { useMyStore } from './myStore';

// Access state via getState(), reset in beforeEach:
beforeEach(() => {
  useMyStore.setState({ /* initial state */ });
  vi.clearAllMocks();
});
```

## Linting & Formatting

### Frontend

- ESLint 9 with @typescript-eslint (max-warnings 10)
- Prettier 3.4 with prettier-plugin-tailwindcss

### Backend

- Black (line length 88, the default)
- flake8
- isort
- mypy
- pylint

### Git Hooks

- Husky + lint-staged (pre-commit runs ESLint/Prettier on TS/JS, Black/flake8/isort on Python)

## Common Commands

```bash
npm run dev              # Start both frontend + backend dev servers
npm run test             # Run all tests (backend + frontend)
npm run lint             # Lint everything
npm run format           # Format everything
npm run build            # Build both
npm run db:migrate       # Run Alembic migrations
npm run db:seed          # Seed database
npm run docker:up        # Start Docker Compose stack
```

## Package Manager

npm (with workspaces). Node >= 18 required at root level, >= 22 for the frontend.

## Architecture & Conventions

### Frontend Directory Structure

```
frontend/src/
├── App.tsx                    # Root routing with lazy-loaded pages
├── main.tsx                   # Entry point
├── components/                # Shared UI (ErrorBoundary, Modal, ProtectedRoute, etc.)
├── pages/                     # Top-level page components (Dashboard, EventsPage, etc.)
├── modules/                   # Feature modules (self-contained)
│   └── <module>/
│       ├── index.ts           # Barrel export (routes, pages, components, types)
│       ├── routes.tsx          # Route definitions (returns React.Fragment of <Route>s)
│       ├── pages/             # Module-specific pages
│       ├── components/        # Module-specific components
│       ├── services/          # Module-specific API service (local axios instance)
│       ├── store/             # Module-specific Zustand store
│       └── types/             # Module-specific TypeScript types
├── stores/                    # Global Zustand stores (authStore.ts, etc.)
├── services/                  # Global API service layer (api.ts, errorTracking.ts)
├── hooks/                     # Custom React hooks (use*.ts)
├── contexts/                  # React contexts (ThemeContext)
├── types/                     # Global TypeScript types (auth.ts, event.ts, etc.)
├── constants/                 # App constants (config.ts, enums.ts)
├── utils/                     # Utility functions (errorHandling.ts, dateFormatting.ts)
├── styles/                    # Global styles/themes
├── test/                      # Test utilities
└── e2e/                       # Playwright E2E tests
```

### Backend Directory Structure

```
backend/app/
├── api/
│   ├── v1/
│   │   ├── api.py             # APIRouter combining all endpoints
│   │   └── endpoints/         # One file per resource (apparatus.py, events.py, etc.)
│   ├── public/                # Public endpoints (no auth required)
│   └── dependencies.py        # DI: get_current_user, require_permission, etc.
├── core/                      # Config, database, security, middleware, permissions
├── models/                    # SQLAlchemy ORM models (one file per domain)
├── schemas/                   # Pydantic request/response schemas (one file per domain)
├── services/                  # Business logic classes ({feature}_service.py)
└── utils/                     # Shared utilities
```

### Naming Conventions

| Item | Frontend | Backend |
|------|----------|---------|
| Components / Pages | `PascalCase.tsx` | N/A |
| Hooks | `useCamelCase.ts` | N/A |
| Stores | `camelCaseStore.ts` | N/A |
| Services | `camelCase.ts` | `snake_case_service.py` |
| Types | `PascalCase` (interfaces) | `PascalCase` (Pydantic/Enum classes) |
| Utilities | `camelCase.ts` | `snake_case.py` |
| DB tables | N/A | `plural_snake_case` |
| DB columns | N/A | `snake_case` |
| API endpoints | N/A | `snake_case` functions, `/kebab-case` URLs |
| Constants | `SCREAMING_SNAKE` | `SCREAMING_SNAKE` |
| Enums (frontend) | `as const` objects + extracted type | N/A |

### Frontend Patterns

- **Components:** Functional React components, props defined as `interface`, typed with `React.FC<Props>`. Route-level permission gating via `<ProtectedRoute requiredPermission="resource.action">` or `requiredRole="admin"`
- **Routing:** Critical pages (Dashboard, Login) imported directly; others use `lazyWithRetry()` (`utils/lazyWithRetry.ts`) instead of bare `React.lazy()` — this retries chunk loads after deployments. Module routes exported as `get{Module}Routes()` functions called in `App.tsx`
- **State:** Zustand stores define state interface + actions in one `create()` call. Async actions use `set({ isLoading: true })` / `try/catch` / `set({ isLoading: false })`
- **API calls:** The global `services/api.ts` creates a shared axios instance (`baseURL: '/api/v1'`, `withCredentials: true`) with request/response interceptors for caching, CSRF, and auth refresh. Each module also has a `services/api.ts` with its own axios instance. Services are plain objects with async methods returning typed promises
- **API response caching:** The global axios instance includes an in-memory stale-while-revalidate cache (`utils/apiCache.ts`). GET responses are cached with a 30s fresh / 90s stale window. Mutations (POST/PUT/PATCH/DELETE) auto-invalidate related cache entries by URL prefix. HIPAA-sensitive endpoints (`/auth/`, `/users/`, `/security/`, etc.) are excluded from caching via `UNCACHEABLE_PREFIXES`. When adding new sensitive endpoints, add them to this list
- **Auth (httpOnly cookies):** Auth tokens are stored exclusively in **httpOnly cookies** set by the backend — never in `localStorage`. The global axios instance uses `withCredentials: true` so cookies are sent automatically. A lightweight `has_session` flag in `localStorage` tells `loadUser()` whether to attempt an API call on page refresh. **Never store tokens in localStorage or send `Authorization` headers.** CSRF protection: state-changing requests (POST/PUT/PATCH/DELETE) read a `csrf_token` cookie and attach it as an `X-CSRF-Token` header (double-submit pattern). Response interceptor catches 401 → attempts cookie-based refresh via `POST /auth/refresh` → retries original request. A shared `refreshPromise` prevents concurrent refresh races (token rotation).
- **Toast notifications:** `react-hot-toast` — use `toast.success()`, `toast.error()` for user feedback. `<Toaster>` is mounted in `App.tsx`
- **Styling:** Tailwind CSS with `theme-*` CSS variable classes defined in `styles/index.css` (e.g., `bg-theme-surface`, `text-theme-text-primary`, `border-theme-surface-border`). Dark mode via `class` strategy. High-contrast mode also supported (`ThemeContext` handles `'light' | 'dark' | 'system' | 'high-contrast'`). Size variants as objects (`{ sm: 'max-w-md', md: 'max-w-lg' }`)
- **UX component library:** Reusable components in `components/ux/` — use these before building custom UI: `Skeleton`/`SkeletonCard`/`SkeletonPage` (loading states), `Pagination`, `EmptyState`, `ConfirmDialog`, `Tooltip`, `CommandPalette`, `SortableHeader`, `Breadcrumbs`, `ProgressSteps`, `Collapsible`, `DateRangePicker`, `FileDropzone`, `InlineEdit`, `PageTransition`
- **Form input classes:** Forms define shared Tailwind class constants (`inputClass`, `selectClass`, `labelClass`, `checkboxClass`) for consistency. Reuse these patterns in new forms
- **Types:** Defined as `interface` (not `type`) for domain objects. One file per domain in `types/`. Enums use `as const` objects with an extracted type of the same name (value union pattern):
  ```typescript
  export const EventType = {
    BUSINESS_MEETING: 'business_meeting',
    TRAINING: 'training',
  } as const;
  export type EventType = (typeof EventType)[keyof typeof EventType];
  ```
  All enums live in `constants/enums.ts` — use these constants instead of string literals. Status badge color mappings are also defined here as `Record<string, string>` with Tailwind classes
- **Floating promises:** Use `void` prefix for intentionally unhandled promises to satisfy `@typescript-eslint/no-floating-promises`: `void fetchData()`, `void handleSubmit()`
- **Date/time handling:** All dates and times are stored as **UTC** in the database and API layer. They must always be displayed to the user in their **local timezone** (or the organization's configured timezone). Use `utils/dateFormatting.ts` utilities (which use `date-fns` internally) — all formatters accept an optional `timezone` parameter for IANA timezone support. Never display raw UTC values in the UI
- **Constants:** Magic numbers and config values are centralized in `constants/config.ts` (`API_TIMEOUT_MS`, `DEFAULT_PAGE_SIZE`, `PAGE_SIZE_OPTIONS`, `AUTO_SAVE_INTERVAL_MS`, etc.). Use these instead of inline values

### Backend Patterns

- **Endpoint layer** (`api/v1/endpoints/`): `APIRouter()` per file, registered in `api.py` with prefix/tags. Async handlers. Permission checks via `Depends(require_permission("resource.action"))`. Instantiate service class per request: `service = FooService(db)`. Audit-sensitive operations should call `log_audit_event()` from `core/audit.py`
- **Service layer** (`services/`): Class initialized with `AsyncSession`. Public methods are async. Private helpers prefixed with `_`. Raises `ValueError` for validation errors, `HTTPException` for HTTP-specific errors
- **Models** (`models/`): Inherit from `Base`. String UUIDs as primary keys (`default=generate_uuid`). `DateTime(timezone=True)` for timestamps — all datetimes are stored as **UTC**; conversion to the user's local timezone happens only in the frontend. `ForeignKey` with `ondelete="CASCADE"`. Relationships with `back_populates`. **Enums** inherit from `(str, Enum)` so they serialize cleanly:
  ```python
  class EventType(str, Enum):
      BUSINESS_MEETING = "business_meeting"
      TRAINING = "training"
  ```
- **Schemas** (`schemas/`): Separate classes: `{Resource}Base` (shared fields), `{Resource}Create`, `{Resource}Update`, `{Resource}Response`. Use `@model_validator(mode="after")` for cross-field validation. Response schemas use `ConfigDict(from_attributes=True, alias_generator=to_camel, populate_by_name=True)` for camelCase serialization. `Field()` for validation
- **Permissions:** Dot-notation strings (`"apparatus.view"`, `"settings.manage"`). Wildcards supported: `"*"` (global), `"module.*"` (module-level). OR logic via `require_permission()`, AND logic via `require_all_permissions()`
- **API URL convention:** All routes under `/api/v1/`. Resources as plural nouns (`/events`, `/users`). Sub-resources nested (`/training/programs`). Actions as verbs on resource (`/{id}/archive`)

## Error Handling

### Frontend

- **`ErrorBoundary`** (`components/ErrorBoundary.tsx`): Wraps entire app in `App.tsx`. Catches React render errors. Shows user-friendly page with retry/reload/go-home buttons. Logs to `errorTracker`. Dev mode shows stack trace
- **`toAppError()` / `getErrorMessage()`** (`utils/errorHandling.ts`): Converts unknown catch values to a typed `AppError { message, code?, status?, details? }`. Type guards narrow axios errors, Error objects, strings. Use in stores and async operations:
  ```typescript
  catch (err: unknown) {
    const appError = toAppError(err);
    set({
      isLoading: false,
      error: getErrorMessage(err, 'Fallback message'),
    });
    throw Object.assign(new Error(appError.message), appError);
  }
  ```
- **`errorTracker`** (`services/errorTracking.ts`): Singleton `ErrorTrackingService`. Maps error types to user-friendly messages + troubleshooting steps. Persists errors to backend API. Known types: `EVENT_NOT_FOUND`, `NETWORK_ERROR`, `AUTHENTICATION_REQUIRED`, etc.
- **Axios interceptors:** Response interceptor catches 401 → attempts cookie-based refresh via `POST /auth/refresh` → retries original request. Uses a shared `refreshPromise` to prevent concurrent refresh races. On refresh failure → clears `has_session` flag → redirects to `/login`

### Backend

- **`HTTPException`:** Raised in endpoint handlers and dependencies for HTTP errors (401, 403, 404, etc.)
- **`safe_error_detail()`** (`core/utils.py`): Sanitizes exception messages before returning to client. Passes through `ValueError`/`PermissionError` messages if they don't contain SQL, file paths, or tracebacks. All other exceptions return generic `"An unexpected error occurred"`. Always logs the real error at ERROR level
- **Pattern in endpoints:**
  ```python
  try:
      result = await service.do_something(...)
  except ValueError as e:
      raise HTTPException(status_code=400, detail=safe_error_detail(e))
  except Exception as e:
      raise HTTPException(status_code=500, detail=safe_error_detail(e))
  ```
- **Service-layer validation:** Raise `ValueError` with descriptive messages for business rule violations. These get passed through `safe_error_detail()` to the client
- **Audit logging:** Use `log_audit_event()` from `core/audit.py` in endpoint handlers for security-sensitive operations (login, permission changes, data access). Import and call after the action succeeds

## HIPAA Compliance & Security

This application handles protected health information (PHI) and must maintain HIPAA compliance. These patterns are enforced across the stack:

- **Auth tokens in httpOnly cookies only** — never in localStorage, sessionStorage, or JS-accessible state. See auth patterns above
- **CSRF double-submit** — state-changing requests include `X-CSRF-Token` header read from a non-httpOnly `csrf_token` cookie
- **API cache exclusions** — endpoints carrying PII/PHI are listed in `UNCACHEABLE_PREFIXES` in `utils/apiCache.ts` and must never be cached. When adding endpoints that return PII (user profiles, medical waivers, emergency contacts), add them to this list
- **PWA service worker** — configured with `NetworkOnly` for all `/api/` routes to prevent caching sensitive API responses in the service worker cache (`vite.config.ts`)
- **Source maps disabled in production** — `sourcemap: false` in vite build config to prevent source code exposure
- **`safe_error_detail()`** — sanitizes exception messages server-side to prevent leaking SQL, file paths, or stack traces to clients
- **Encryption at rest** — `ENCRYPTION_KEY` + `ENCRYPTION_SALT` env vars used for AES-256 encryption of sensitive fields

## Common Pitfalls & Prevention

These are recurring errors identified from the project's change history. Follow these rules to avoid re-introducing them.

### 1. Empty Strings: Always Use `||`, Never `??` for Form Values

**The #1 most common bug in this project.** React form fields initialize as empty strings (`""`). The nullish coalescing operator (`??`) only filters `null`/`undefined` — it does NOT filter `""`. This causes empty strings to be sent to the backend, where Pydantic validators reject them with 422 errors.

```typescript
// WRONG — empty string passes through ??
const phone = formData.phone?.trim() ?? undefined;  // '' ?? undefined === ''

// CORRECT — empty string is converted to undefined by ||
const phone = formData.phone?.trim() || undefined;   // '' || undefined === undefined
```

**Rule:** When converting form values to send to the API, always use `||` (logical OR), never `??` (nullish coalescing), to coerce empty strings to `undefined` so they are omitted from the JSON payload. This applies to all optional string fields in forms, onboarding flows, modals, and CSV exports.

### 2. Database Models: `ondelete="SET NULL"` Requires `nullable=True`

Every foreign key column with `ondelete="SET NULL"` **must** also have `nullable=True`. MySQL error 1830 rejects SET NULL on NOT NULL columns. This has caused multiple container startup failures.

```python
# WRONG — will crash on deletion of referenced row
organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="SET NULL"))

# CORRECT
organization_id = Column(String(36), ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True)
```

**Rule:** When writing or reviewing any model with `ondelete="SET NULL"`, always verify the column is `nullable=True`. Also verify this when adding seed/lookup tables that may hold system-level (org-agnostic) records with NULL org references.

### 3. TypeScript: `noUncheckedIndexedAccess` Pitfalls

With `noUncheckedIndexedAccess: true`, array indexing and `.split()` results return `T | undefined`. This causes TS2322 build errors.

```typescript
// WRONG — TS error: string | undefined is not assignable to string
const datePart = isoString.split('T')[0];

// CORRECT — provide a fallback
const datePart = isoString.split('T')[0] ?? '';
```

**Rule:** Always add `?? defaultValue` after indexed access (`arr[0]`, `.split()[n]`, `Object.keys()[n]`). Never use non-null assertions (`!`) as a workaround — use safe fallbacks instead.

### 4. Backend Middleware: Use Pure ASGI, Not `BaseHTTPMiddleware`

Starlette's `BaseHTTPMiddleware` has known issues: it can strip `Set-Cookie` headers when multiple middleware layers are stacked, and it wraps the response body in ways that break streaming. This caused the post-login auth cookie loss that took 7 commits to debug.

```python
# WRONG — BaseHTTPMiddleware can strip headers
class MyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        return response

# CORRECT — Pure ASGI middleware preserves all headers
class MyMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        # Custom logic here, then:
        await self.app(scope, receive, send)
```

**Rule:** All new middleware must use the pure ASGI pattern (`__call__` with scope/receive/send). Never use `BaseHTTPMiddleware`. When the ASGI `receive` callable is wrapped or replaced, it **must** be `async`.

### 5. Frontend-Backend Schema Contract

Mismatches between Pydantic schemas and frontend TypeScript types cause 422 errors and broken UI. Common sub-issues:

- **Required vs optional fields:** If a frontend form field is optional, the corresponding Pydantic schema field must be `Optional[T] = None`. Do not mark fields as required in the schema if the frontend can omit them.
- **Enum casing:** Backend `(str, Enum)` values must be **lowercase** (`routine`, not `ROUTINE`). If the frontend sends uppercase, add `.lower()` conversion or a `@field_validator`.
- **Response shape:** Backend response schemas use `alias_generator=to_camel` for camelCase serialization. If a frontend component destructures a specific field name, verify it matches the camelCase alias, not the snake_case Python attribute.
- **422 error display:** FastAPI returns 422 errors as `{"detail": [{"loc": [...], "msg": "..."}]}` — an array, not a string. The `toAppError()` utility handles this, but any custom error handling must also check for array-format details.

**Rule:** When adding or modifying an API endpoint, verify the Pydantic schema field requirements match what the frontend actually sends. When adding new fields to a response schema, verify the frontend type interface includes the camelCase version.

### 6. Cookie Path Matching

Cookie `path` attributes must match the request URL exactly, including trailing slashes. A cookie set with `path=/api/v1/auth` will NOT be sent to `/api/v1/auth/refresh` on all browsers.

**Rule:** When setting cookies with a path restriction, always include a trailing slash (`path=/api/v1/auth/`) or use the broadest appropriate path.

### 7. Module Axios Instances and Auth

Each module in `modules/*/services/api.ts` creates its own axios instance. These instances must include the same auth configuration as the global instance (`withCredentials: true`, CSRF header interceptor, Bearer token bridge if applicable). Missing auth headers on module-specific axios instances causes 401/403 errors that only appear in specific modules.

**Rule:** When creating a new module with its own axios instance, copy the auth interceptor setup from the global `services/api.ts` or import a shared interceptor factory.

### 8. Alembic Migrations: Seed Data and Ordering

Seed data migrations that insert system-level records (default facility types, status codes, etc.) must handle the case where the target table has `nullable=True` on `organization_id`. If seed data is inserted before the column is made nullable, or if the migration file isn't registered in `SEED_DATA_FILES`, fresh installs will have missing seed data and crash when code queries for expected defaults.

**Rule:** When adding seed/lookup data: (1) ensure the migration makes org_id nullable first, (2) register the seed migration in `SEED_DATA_FILES`, (3) add fallback logic in service code for when expected defaults are missing (auto-create or raise a clear error).

### 9. Unbounded In-Memory Caches

Backend middleware and services that track request state (rate limiting, security monitoring, IP logging) must have size limits and periodic eviction. Without these, tracking dicts grow unboundedly and cause memory exhaustion in long-running processes.

**Rule:** Any in-memory dict/set used for tracking must have: (1) a maximum size cap, (2) periodic eviction of stale entries, (3) a fallback behavior when the cap is reached.

### 10. Python Lint Violations: Never Ignore flake8 Errors

Python lint violations (flake8) must be fixed immediately, never suppressed with `# noqa` or left for later. These are the most common recurring violations:

- **F401 (unused import):** Remove any `import` that is not used in the file. Do not keep imports "for later" or "just in case."
- **F811 (redefined unused name):** A name was imported or defined but then redefined without being used. Remove the duplicate.
- **F821 (undefined name):** A variable or class is referenced but never imported or defined. Add the missing import or fix the typo.
- **E303 (too many blank lines):** Python allows at most 2 blank lines between top-level definitions and 1 inside a class/function. Remove excess blank lines.
- **W291/W293 (trailing whitespace):** Remove trailing spaces/tabs from lines. Formatters (Black) handle this automatically.
- **E302/E303 (blank line formatting):** Ensure exactly 2 blank lines before top-level function/class definitions, 1 blank line before methods.

```python
# WRONG — unused import (F401)
from app.models.user import User  # never referenced below

# WRONG — undefined name (F821)
result = await some_service.process(data)  # some_service never imported

# WRONG — too many blank lines (E303)
def foo():
    pass



    # three blank lines inside a function
```

**Rule:** Run `flake8` on all modified Python files before committing. Fix every violation — do not use `# noqa` comments to suppress errors unless there is a documented, unavoidable reason (e.g., a re-export in `__init__.py`, which should use `# noqa: F401` with the specific code). When you encounter pre-existing flake8 violations in files you are editing, fix them in the same commit. Zero flake8 errors is the standard.

### 11. Verify After Creating — Fetch Full Records

When creating a record (facility, ballot item, candidate, etc.) and immediately displaying it in a detail view, always fetch the full record from the API after creation. Do not rely on the creation response or list-item data, which may lack nested relationships or computed fields needed by the detail view.

**Rule:** After a successful create/update, re-fetch the full record via its detail endpoint before populating the UI. This also applies when selecting an item from a list view to show in a detail panel.

## Environment Variables

Reference files: `.env.example` (quick start), `.env.example.full` (all options), `frontend/.env.example`.

### Required (Production)

| Variable | Purpose |
|----------|---------|
| `SECRET_KEY` | JWT signing key (64+ chars) |
| `ENCRYPTION_KEY` | AES-256 key (64-char hex) |
| `ENCRYPTION_SALT` | Key derivation salt (32-char hex) |
| `DB_PASSWORD` | MySQL user password |
| `MYSQL_ROOT_PASSWORD` | MySQL root password |
| `REDIS_PASSWORD` | Redis auth password |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins |

Generate secrets:
```bash
python3 -c "import secrets; print(secrets.token_urlsafe(64))"   # SECRET_KEY
python3 -c "import secrets; print(secrets.token_hex(32))"        # ENCRYPTION_KEY
python3 -c "import secrets; print(secrets.token_hex(16))"        # ENCRYPTION_SALT
```

### Core Application

| Variable | Default | Purpose |
|----------|---------|---------|
| `ENVIRONMENT` | `development` | `development`, `staging`, or `production` |
| `DEBUG` | `false` | Never `true` in production |
| `DB_HOST` | `localhost` | MySQL hostname (`mysql` in Docker) |
| `DB_PORT` | `3306` | MySQL port |
| `DB_NAME` | `intranet_db` | Database name |
| `DB_USER` | `intranet_user` | Database user |
| `REDIS_HOST` | `localhost` | Redis hostname (`redis` in Docker) |
| `REDIS_PORT` | `6379` | Redis port |
| `FRONTEND_PORT` | `3000` | Frontend exposed port |
| `BACKEND_PORT` | `3001` | Backend exposed port |
| `LOG_LEVEL` | `INFO` | Logging level |
| `ENABLE_DOCS` | `true` | API docs at `/docs` (disable in prod) |

### Frontend (Vite)

| Variable | Default | Purpose |
|----------|---------|---------|
| `VITE_API_URL` | `/api/v1` | API base URL |
| `VITE_BACKEND_URL` | `http://localhost:3001` | Backend URL for Vite dev proxy |
| `VITE_WS_URL` | `ws://localhost:3001` | WebSocket URL |
| `VITE_ENABLE_PWA` | `true` | PWA support |

### Optional Services

Enable with `*_ENABLED=true`: `EMAIL_ENABLED`, `TWILIO_ENABLED`, `SENTRY_ENABLED`, `AZURE_AD_ENABLED`, `GOOGLE_OAUTH_ENABLED`, `LDAP_ENABLED`. Each requires additional config vars — see `.env.example.full`.

### Module Feature Flags

All `MODULE_*_ENABLED` variables (`MODULE_TRAINING_ENABLED`, `MODULE_ELECTIONS_ENABLED`, etc.) toggle features without code changes. See `backend/app/core/config.py` for the full list.
