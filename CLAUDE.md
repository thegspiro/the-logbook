# CLAUDE.md — Project Context for Claude Code

## IMPORTANT: Fix All Errors — Non-Negotiable

**Never ignore or silently pass over an error you encounter — compilation
errors, type errors, lint violations, warnings, or failing tests — regardless
of whether it is pre-existing or outside the scope of your current task. Every
error you encounter must be addressed before the task is complete. There are
exactly two acceptable responses, and silence is neither:**

1. **Fix it** at its root cause, in the same commit. This is the default and
   the strongly preferred response.
2. **Escalate it** — when, and only when, the fix genuinely exceeds the current
   scope (see "Hard Stop" below) — by stopping and reporting the complete list
   of errors before proceeding.

These two paths share one non-negotiable principle: **you never continue past a
known error without either fixing it or surfacing it.** Acknowledging an error
and moving on is a violation; describing it as context and continuing is a
violation.

### There Are No Acceptable Pre-Existing Errors

The phrase "pre-existing error" is not a valid reason to skip a fix. If an
error existed before your current task began, it still must be resolved — by
default in the same commit. If you discover it, you own it. The age or origin
of an error never downgrades your obligation to address it; it only ever
determines which of the two responses above applies.

### What "Fix" Means

Fixing an error means resolving its root cause. The following are **not** fixes:

- Adding `// @ts-ignore`, `// eslint-disable`, or `# noqa` to silence a
  violation (see Pitfall #10 "Python Lint Violations" for the narrow `# noqa: F401` exception)
- Casting to `any` or `unknown` to suppress a type error
- Wrapping a broken call in a try/catch to hide a runtime failure
- Deleting a test that is failing

### Hard Stop Before Continuing

This is the escalation path from response #2 above — the _only_ sanctioned
alternative to fixing an error, never a license to ignore one. If fixing a
discovered error would genuinely exceed the scope of the current task (e.g.,
hundreds of strict-mode violations across unrelated files), **stop and report
the full list of errors before proceeding.** A complete inventory with no
action taken is acceptable; silently continuing past a known error is not.

### Completion Gate

A task is not complete if any of the following are true after your changes:

- `tsc --noEmit` reports errors in any file (not just files you touched)
- `flake8` reports violations in any modified Python file
- `npm run lint` exits non-zero
- Any existing test is newly failing

## Code Comments & Documentation

Comments exist to explain **why**, not **what**. Experienced developers can read
the code. A comment that restates the syntax it sits next to adds noise and
becomes a maintenance liability the moment the code changes. Delete it.

### What Belongs in a Comment

Write a comment when the code alone cannot communicate:

- **Business rules and domain constraints** — e.g., why a specific status
  transition is prohibited, or why a field has a seemingly arbitrary length limit
- **Non-obvious technical decisions** — e.g., why a query is structured to avoid
  a MySQL optimizer pitfall, or why a particular async pattern was chosen over a
  simpler one
- **External dependencies and their quirks** — e.g., a third-party API behavior,
  a browser inconsistency, or a known library bug being worked around
- **Safety-critical invariants** — e.g., a condition that must remain true to
  prevent a security or data integrity issue, where a casual refactor could
  silently break it
- **Intentional departures from convention** — if code deliberately does
  something that looks wrong but is correct for a specific reason, say so

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
- [ ] **JSON column deep copy** — code modifying nested keys in JSON columns uses `copy.deepcopy()` or `flag_modified()`, never `dict()` shallow copy

## Project Overview

The Logbook is an open-source modular intranet platform for fire departments and emergency services. It is a monorepo with an npm workspaces structure containing a React frontend and a Python backend.

## Tech Stack

### Frontend (`/frontend`)

- **Bundler:** Vite 7.3
- **Framework:** React 19.2 (SPA, not Next.js or React Native)
- **Language:** TypeScript 5.9 (strict mode — see below)
- **Routing:** react-router 8.3 (core package; react-router-dom was retired with v7)
- **State management:** Zustand 5.0
- **Forms:** react-hook-form 7.71 + Zod 4.3 validation
- **Styling:** Tailwind CSS 4.2 (with `tailwind-merge`, dark mode via `class` strategy)
- **HTTP client:** Axios 1.13
- **Auth (client):** httpOnly cookies (managed by backend); no client-side JWT handling
- **Icons:** lucide-react
- **PWA:** vite-plugin-pwa

### Backend (`/backend`)

- **Framework:** FastAPI 0.141 (starlette 1.x) + Uvicorn
- **Language:** Python 3.13
- **ORM:** SQLAlchemy 2.0 (async via aiomysql)
- **Database:** MySQL 8.0
- **Migrations:** Alembic
- **Cache / sessions:** Redis 7
- **Auth:** PyJWT + bcrypt + Argon2 + TOTP (pyotp) + OAuth/OIDC via authlib (Google, Microsoft Azure AD); SAML/LDAP not implemented
- **Task queue:** Celery
- **Payments:** Stripe
- **Email:** built-in SMTP/provider service + Jinja2 templates
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
- `noUnusedLocals: true` / `noUnusedParameters: true` — the mechanism behind the "no unused imports" rule repeated throughout this doc
- `noFallthroughCasesInSwitch: true`
- `exactOptionalPropertyTypes: true` — **important gotcha.** Assigning `undefined` to an optional property is only legal if that property's type explicitly includes `| undefined`. This interacts directly with Pitfall #1: the `|| undefined` form-value coercion compiles only when the optional field is typed `field?: T | undefined` (or the payload type allows it). If you hit a TS error coercing a form value to `undefined`, widen the target type rather than casting.

All frontend source files use `.ts` / `.tsx` exclusively. Path alias `@/*` maps to `./src/*`.

### Two TypeScript installs — do not "tidy" this away

Two TypeScripts are resolved, on purpose, and **both halves are declared** —
neither depends on npm choosing to auto-install anything.

**What `frontend/package.json` declares:**

| Declared as                                     | Version | Used by                                            |
| ----------------------------------------------- | ------- | -------------------------------------------------- |
| `typescript`                                    | 5.9.3   | typescript-eslint — i.e. type-aware `npm run lint` |
| `typescript-native` (npm alias of `typescript`) | 7.0.2   | `npm run typecheck`, `npm run build`, the editor   |

**What resolves in `package-lock.json`:**

| Lock path                        | Version | Why it is there                         |
| -------------------------------- | ------- | --------------------------------------- |
| `node_modules/typescript`        | 5.9.3   | The frontend's own declaration, hoisted |
| `node_modules/typescript-native` | 7.0.2   | The aliased compiler, hoisted           |

Nothing nests under `frontend/node_modules/` any more: with no version
conflict left to work around, both hoist to the root.

**typescript-eslint cannot run on TypeScript 7.** It throws
`typescript-eslint does not support TS 7.0` from a hard version guard, and
every published version — including the `^8.67.0` this repo uses — caps its
peer range at `>=4.8.4 <6.1.0` (typescript-eslint#10940 tracks TS >=7.1
support). A workspace can only declare one package named `typescript`, so the
plain name is the version the linter needs and the compiler the project builds
with is the same package installed again under an alias.

This is not cosmetic. It is what keeps the lockfile regenerable: with
`typescript` declared at 7.0.2, `rm package-lock.json && npm install` failed
outright with ERESOLVE against typescript-eslint's peer range, so the lockfile
could not be rebuilt and any bump of typescript-eslint broke the install.

Consequences worth knowing:

- `npm run typecheck` / `npm run build` go through `frontend/scripts/tsc-native.mjs`,
  which resolves the aliased compiler explicitly. Keep it that way — the
  wrapper is what makes "which compiler ran" a fact rather than a hoisting
  outcome. Bare `tsc` resolves to 5.9.3, because both installs ship a `tsc`
  bin and npm links only one into `node_modules/.bin`.
- **Point your editor at the aliased compiler.** In VS Code, set this in your
  local `.vscode/settings.json` (the directory is gitignored, so this cannot
  be committed for you):

  ```json
  "typescript.tsdk": "node_modules/typescript-native/lib"
  ```

- Type-aware lint runs against 5.9.3 while the build uses 7.0.2. That gap is
  forced by upstream, not chosen. **When typescript-eslint ships TS 7 support,
  collapse this to a single `typescript` dependency** and delete the alias, the
  wrapper script, and this section.
- **A Dependabot bump of `typescript` will reopen this.** Raising the plain
  `typescript` past typescript-eslint's `<6.1.0` cap is what broke the
  arrangement on 2026-08-17: it left the linter running on a 5.9.3 that no
  manifest asked for, surviving only as an npm-auto-installed peer, and made
  the lockfile unregenerable. Bump `typescript-native` for a newer compiler;
  the plain `typescript` moves only when the linter's cap does.

## Testing

### Frontend (Vitest + Testing Library)

- **Runner:** Vitest 4.0 with jsdom environment
- **Libraries:** @testing-library/react, @testing-library/jest-dom, @testing-library/user-event
- **E2E:** Playwright
- **Coverage:** @vitest/coverage-v8. Thresholds are a **ratchet floor** set a couple of points under current measured coverage (see `frontend/vitest.config.ts`) — they block regressions rather than demanding an aspirational number. Raise them as coverage grows; don't lower them
- **Run:** `npm run test:frontend` or `cd frontend && npm test`
- Test files are co-located with source: `src/**/*.test.ts(x)`

### Backend (pytest)

- **Runner:** pytest + pytest-asyncio
- **Coverage:** pytest-cov
- **Test data:** Faker
- **Run:** `npm run test:backend` or `cd backend && pytest`
- Test files live in `backend/tests/`
- **Config:** `asyncio_mode = auto` in `pytest.ini` — no need for `@pytest.mark.asyncio` on individual tests. `addopts` enables `--strict-markers` and `--strict-config` (an undefined marker fails the run, so register new markers in `pytest.ini` before using them) and `--timeout=30` (each test has a 30s timeout; mark genuinely long tests with `slow`). Registered markers: `asyncio`, `integration`, `unit`, `slow`, `onboarding`, `docker`
- **Fixtures:** `conftest.py` provides `db_session` (auto-rolled-back transaction per test), `sample_org_data`, `sample_admin_data`, `sample_roles_data`, `sample_stations_data`

### Frontend Test Patterns

The test setup (`src/test/setup.ts`) automatically mocks `window.matchMedia`, `IntersectionObserver`, `ResizeObserver`, and `window.print`. Test utilities (`src/test/utils.tsx`) provide:

- **`renderWithRouter(ui)`** — wraps component in `BrowserRouter`
- **Mock data** — `mockEvent`, `mockUser`, `mockRSVP`, `mockQRCheckInData`
- **Mock factories** — `createMockApiResponse(data)`, `createMockApiError(msg, status)`, `createMockEventService()`
- **Navigation mocks** — `mockNavigate`, `mockUseParams`

**Component test pattern:**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
```

**Store test pattern** (mock dependencies _before_ importing the store):

```typescript
const mockLogin = vi.fn();
vi.mock("../services/api", () => ({
  authService: { login: (...args: unknown[]) => mockLogin(...args) as unknown },
}));
// Import store AFTER mocks are in place
import { useMyStore } from "./myStore";

// Access state via getState(), reset in beforeEach:
beforeEach(() => {
  useMyStore.setState({/* initial state */});
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
npm run build            # Build frontend (backend build is a no-op)
npm run db:migrate       # Run Alembic migrations (also applies seed data via SEED_DATA_FILES)
npm run db:seed          # No-op notice; seed data is applied by db:migrate
npm run docker:up        # Start Docker Compose stack
```

## Package Manager

npm (with workspaces). Node >= 22 — the root install builds the frontend
workspace, so the frontend's floor is the real floor; the old root `>= 18` / npm
`>= 9` range understated it. Run `npm install` from the repo root only: the root
`package-lock.json` is the single lockfile (see "No nested
`frontend/package-lock.json`" in KNOWN_LIMITATIONS.md).

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

| Item               | Frontend                            | Backend                                    |
| ------------------ | ----------------------------------- | ------------------------------------------ |
| Components / Pages | `PascalCase.tsx`                    | N/A                                        |
| Hooks              | `useCamelCase.ts`                   | N/A                                        |
| Stores             | `camelCaseStore.ts`                 | N/A                                        |
| Services           | `camelCase.ts`                      | `snake_case_service.py`                    |
| Types              | `PascalCase` (interfaces)           | `PascalCase` (Pydantic/Enum classes)       |
| Utilities          | `camelCase.ts`                      | `snake_case.py`                            |
| DB tables          | N/A                                 | `plural_snake_case`                        |
| DB columns         | N/A                                 | `snake_case`                               |
| API endpoints      | N/A                                 | `snake_case` functions, `/kebab-case` URLs |
| Constants          | `SCREAMING_SNAKE`                   | `SCREAMING_SNAKE`                          |
| Enums (frontend)   | `as const` objects + extracted type | N/A                                        |

### Frontend Patterns

- **Components:** Functional React components, props defined as `interface`, typed with `React.FC<Props>`. Route-level permission gating via `<ProtectedRoute requiredPermission="resource.action">` or `requiredRole="admin"`
- **Routing:** Critical pages (Dashboard, Login) imported directly; others use `lazyWithRetry()` (`utils/lazyWithRetry.ts`) instead of bare `React.lazy()` — this retries chunk loads after deployments. Module routes exported as `get{Module}Routes()` functions called in `App.tsx`
- **State:** Zustand stores define state interface + actions in one `create()` call. Async actions use `set({ isLoading: true })` / `try/catch` / `set({ isLoading: false })`
- **API calls:** The global `services/api.ts` creates a shared axios instance (`baseURL: '/api/v1'`, `withCredentials: true`) with request/response interceptors for caching, CSRF, and auth refresh. Each module also has a `services/api.ts` with its own axios instance. Services are plain objects with async methods returning typed promises
- **API response caching:** The global axios instance includes an in-memory stale-while-revalidate cache (`utils/apiCache.ts`). GET responses are cached with a 30s fresh / 90s stale window. Mutations (POST/PUT/PATCH/DELETE) auto-invalidate related cache entries by URL prefix. HIPAA-sensitive endpoints (`/auth/`, `/users/`, `/security/`, etc.) are excluded from caching via `UNCACHEABLE_PREFIXES`. When adding new sensitive endpoints, add them to this list
- **Auth (httpOnly cookies):** Auth tokens are stored exclusively in **httpOnly cookies** set by the backend — never in `localStorage`. The global axios instance uses `withCredentials: true` so cookies are sent automatically. A lightweight `has_session` flag in `localStorage` tells `loadUser()` whether to attempt an API call on page refresh. **Never store tokens in localStorage or send `Authorization` headers.** CSRF protection: state-changing requests (POST/PUT/PATCH/DELETE) read a `csrf_token` cookie and attach it as an `X-CSRF-Token` header (double-submit pattern). Response interceptor catches 401 → attempts cookie-based refresh via `POST /auth/refresh` → retries original request. A shared `refreshPromise` prevents concurrent refresh races (token rotation).
- **Toast notifications:** `react-hot-toast` — use `toast.success()`, `toast.error()` for user feedback. `<Toaster>` is mounted in `App.tsx`
- **Styling:** Tailwind CSS with `theme-*` CSS variable classes defined in `styles/index.css` (e.g., `bg-theme-surface`, `text-theme-text-primary`, `border-theme-surface-border`). Dark mode via `class` strategy. High-contrast mode also supported (`ThemeContext` handles `'light' | 'dark' | 'system' | 'high-contrast'`). Size variants as objects (`{ sm: 'max-w-md', md: 'max-w-lg' }`)
- **Contrast is AAA, and the palette is one decision** _(2026-08-23)_: the primary fill is **red-800** (`#991b1b`), not red-600 — white on red-600 measures 4.83:1, which is AA for large text only, and a button label is not large text. The light text tiers are slate-700 / slate-600, and in dark mode `--text-primary`, `--text-secondary` and `--text-muted` are **all `#ffffff`**: no tint of grey clears 7:1 against a 6% surface on this gradient, so dark-mode hierarchy comes from size and weight, never colour. Do not reintroduce a grey text tier in `.dark`, and do not add a red-600 primary fill — a mixed palette is worse than either choice, which is why the uplift was applied to every call site at once rather than screen by screen.
- **Shared component/mobile utilities:** `styles/index.css` defines reusable `@utility` classes (grouped and documented in that file) — prefer these over repeating inline class strings or hand-rolling arbitrary values. Component utilities: `form-input`/`form-label`, `card`/`card-secondary`, `btn-primary`/`btn-icon` (44px touch target), `alert-*`, `badge`, `modal-body`. Mobile utilities: `tab-scroll` (scrollable bordered tab bar) and `hscroll` (scrollable strip) for tab/pill rows that would overflow a phone; `mobile-touch-target` (44px); `pb-safe` / `action-bar-safe` for bottom bars that must clear the iPhone home indicator; `rwd-table` for tables that reflow to stacked cards under 768px. When adding a new shared pattern, define it as an `@utility` under the matching group header rather than scattering arbitrary values
- **UX component library:** Reusable components in `components/ux/` — use these before building custom UI: `Skeleton`/`SkeletonCard`/`SkeletonPage` (loading states), `Pagination`, `EmptyState`, `ConfirmDialog`, `PromptDialog` (single typed value), `Tooltip`, `CommandPalette`, `SortableHeader`, `Breadcrumbs`, `ProgressSteps`, `Collapsible`, `DateRangePicker`, `FileDropzone`, `InlineEdit`, `PageTransition`, `ScanSuccessFlash`/`FlashlightToggle` (barcode-scanner overlays). **Confirmations go through `useConfirm()`**, whose dialog is mounted once by `ConfirmProvider` at the app root — see Pitfall #16
- **Settings screens:** All three (Organization, Events, Scheduling) render through `components/settings/SettingsLayout.tsx` — section sidebar with descriptions on desktop, scrollable tab strip on phones, body in a surface card, `aria-current` on the active section, and the selected section mirrored into `?tab=`. A new settings screen uses this rather than a fourth design; the section list is a `SettingsSection[]` declared beside the screen (see `modules/scheduling/components/schedulingSettingsSections.ts`). Show a Save/Reset footer **only** on sections the footer actually writes
- **Barcode scanning & pull-to-refresh:** Camera scanning goes through the `useHtml5Scanner` hook (rear-camera constraint, secure-context guard, responsive scan box, flashlight support); pair it with `useScanFeedback` + `ScanSuccessFlash` for capture confirmation. App-wide pull-to-refresh is layout-level: a page opts in by calling `useRegisterPullToRefresh(handler)` (the gesture + indicator are mounted once in `AppLayout` via `PullToRefreshProvider`)
- **Form input classes:** Forms define shared Tailwind class constants (`inputClass`, `selectClass`, `labelClass`, `checkboxClass`) for consistency. Reuse these patterns in new forms
- **Types:** Defined as `interface` (not `type`) for domain objects. One file per domain in `types/`. Enums use `as const` objects with an extracted type of the same name (value union pattern):
  ```typescript
  export const EventType = {
    BUSINESS_MEETING: "business_meeting",
    TRAINING: "training",
  } as const;
  export type EventType = (typeof EventType)[keyof typeof EventType];
  ```
  All enums live in `constants/enums.ts` — use these constants instead of string literals. Status badge color mappings are also defined here as `Record<string, string>` with Tailwind classes
- **Floating promises:** Use `void` prefix for intentionally unhandled promises to satisfy `@typescript-eslint/no-floating-promises`: `void fetchData()`, `void handleSubmit()`
- **Date/time handling (ESLint-enforced):** All dates and times are stored as **UTC** in the database and API layer. They must always be displayed to the user in their **local timezone** (or the organization's configured timezone). Use `utils/dateFormatting.ts` utilities (which use `Intl.DateTimeFormat` internally) — all formatters accept an optional `timezone` parameter for IANA timezone support. Never display raw UTC values in the UI. **The following are banned by ESLint and will fail CI:**
  - `.toLocaleString()` — use `formatDateTime()` for dates or `formatNumber()` for numbers
  - `.toLocaleDateString()` — use `formatDate()` or `formatDateCustom()`
  - `.toLocaleTimeString()` — use `formatTime()`
  - `import { ... } from 'date-fns'` — use wrappers in `dateFormatting.ts` instead
  - `new Date().toISOString().slice(0,10)` — use `getTodayLocalDate(tz)` or `toLocalISODate()`
  - Always obtain `tz` via `const tz = useTimezone()` from `hooks/useTimezone` and pass it to every formatting call
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
const phone = formData.phone?.trim() ?? undefined; // '' ?? undefined === ''

// CORRECT — empty string is converted to undefined by ||
const phone = formData.phone?.trim() || undefined; // '' || undefined === undefined
```

**Rule:** When converting form values to send to the API, always use `||` (logical OR), never `??` (nullish coalescing), to coerce empty strings to `undefined` so they are omitted from the JSON payload. This applies to all optional string fields in forms, onboarding flows, modals, and CSV exports.

#### …on **create**. On **update**, omitting the key is the bug _(2026-08-09)_

`|| undefined` is right on a create payload and **wrong on an update payload**.
Update payloads are `model_dump(exclude_unset=True)` on the backend, so an
**omitted key means "leave this alone"** — the user emptied the box, the key
never left the browser, and the old value survives behind a success toast.

Three states, three distinct wire values:

| Intent                | Send             | Backend reads it as |
| --------------------- | ---------------- | ------------------- |
| Leave the field alone | **omit the key** | untouched           |
| Clear the field       | **`null`**       | write NULL          |
| Set a value           | the value        | write the value     |

```typescript
// CREATE — omit blanks so "" never reaches a Pydantic validator
const phone = formData.phone?.trim() || undefined;

// UPDATE — send an explicit null so the clear actually persists
import { blankToNull, numberOrNull } from "@/utils/formValues";
const phone = blankToNull(formData.phone); // '' -> null
const hours = numberOrNull(formData.requiredHours); // '' -> null
```

On the backend, never write the mirror-image bug:

```python
# WRONG — drops the explicit null; acknowledges the write with a 200 and
# leaves the old value in the database
for key, value in updates.items():
    if value is not None:
        setattr(instance, key, value)

# CORRECT
from app.utils.model_updates import apply_updates
apply_updates(instance, updates, skip={"organization_id", "id"})
```

`apply_updates` clears on an explicit null, raises `ValueError` (→ 400) for a
null against a `NOT NULL` column rather than failing at flush time, and reports
a field the model does not have instead of dropping it. Protected columns —
tenancy and identity — go in `skip`, not in a hand-rolled per-field guard. Also
do not dump update payloads with `exclude_none`: it strips the nulls a layer
earlier, for the same result.

**Rule:** On an update path, use `blankToNull` / `numberOrNull` on the frontend
and `apply_updates` on the backend. Send **every** field the form owns on every
save — a requirement switched from hours to shifts kept grading against its stale
`required_hours` precisely because the payload omitted the field it no longer
used.

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
const datePart = isoString.split("T")[0];

// CORRECT — provide a fallback
const datePart = isoString.split("T")[0] ?? "";
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

Seed data migrations that insert system-level records (default facility types, status codes, etc.) must handle the case where the target table has `nullable=True` on `organization_id`. If seed data is inserted before the column is made nullable, or if the migration file isn't registered in `SEED_DATA_FILES` (defined in `backend/main.py`), fresh installs will have missing seed data and crash when code queries for expected defaults.

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

### 12. SQLAlchemy JSON Columns: Never Mutate via Shared References

Plain `Column(JSON)` does not track in-place mutations. If you read `org.settings`, shallow-copy it with `dict()`, modify a nested dict, and reassign `org.settings = new_dict`, SQLAlchemy may see old == new (because the shallow copy shares nested references that were mutated in both) and **skip the UPDATE entirely**. The change appears to work in-memory but is never written to the database.

```python
# WRONG — shallow copy shares nested dicts with SQLAlchemy's committed state
current_settings = dict(org.settings or {})
current_settings["events"]["visible"] = True  # also mutates org.settings["events"]!
org.settings = current_settings  # SQLAlchemy sees no change → silent no-op

# CORRECT (option A) — deep copy breaks shared references
import copy
current_settings = copy.deepcopy(org.settings or {})
current_settings["events"]["visible"] = True
org.settings = current_settings  # new value ≠ committed state → UPDATE issued

# CORRECT (option B) — flag_modified forces the UPDATE
from sqlalchemy.orm.attributes import flag_modified
org.settings["events"]["visible"] = True
flag_modified(org, "settings")  # tells SQLAlchemy the column changed
```

The `Organization.settings` column uses `MutableDict.as_mutable(JSON)` which auto-detects **top-level** key changes, but nested mutations still require `copy.deepcopy()` or `flag_modified()`. When modifying nested keys inside any JSON column, always use one of the two correct patterns above.

**Rule:** Never use `dict(obj.json_column)` (shallow copy) when you intend to modify nested values and reassign. Use `copy.deepcopy()` to create a fully independent copy, or use `flag_modified()` after in-place mutation.

### 13. Test Assertions: Never Use Bare `toHaveBeenCalledWith()`

`expect(mock).toHaveBeenCalledWith()` asserts the mock was called with **zero arguments**. This is almost never the intent — most service calls receive parameters (filter objects, IDs, `undefined` for optional args). This was the #1 source of test failures in this project (34 of 46 broken tests).

```typescript
// WRONG — asserts zero arguments; fails when store passes { active_only: false }
expect(mockGetRequirements).toHaveBeenCalledWith();

// CORRECT — assert the actual arguments
expect(mockGetRequirements).toHaveBeenCalledWith({ active_only: false });

// CORRECT — when you don't care about arguments, just that it was called
expect(mockGetRequirements).toHaveBeenCalled();

// CORRECT — for optional params that pass undefined
expect(mockGetTemplates).toHaveBeenCalledWith(undefined);
```

**Rule:** Never write bare `toHaveBeenCalledWith()` when you mean "called with
_something_". Use `toHaveBeenCalled()` if you don't care about arguments, or
specify the expected arguments explicitly.

**The tooling was the cause, not the cure.** An earlier version of this section
claimed `vitest/prefer-called-with` enforced this rule at `error` level. The
opposite was true: that rule is what _created_ these assertions.

`vitest/prefer-called-with` is auto-fixable. It rewrites
`expect(m).toHaveBeenCalled()` into `expect(m).toHaveBeenCalledWith()` — the
zero-argument form — without inspecting how the mock was actually called. The
pre-commit hook runs `eslint --fix`, so the rewrite happened silently on the way
into every commit, and for any mock called with arguments it converts a passing
assertion into a failing one:

```ts
const m = vi.fn();
m(1, 2);
expect(m).toHaveBeenCalled(); // passes
// -- eslint --fix -->
expect(m).toHaveBeenCalledWith(); // FAILS: expected call with []
```

That is the mechanism behind "34 of 46 broken tests". It was never developers
choosing the wrong matcher. It also made the rule above impossible to follow:
the advice is to use `toHaveBeenCalled()` when arguments are not the point, and
the hook rewrote exactly that.

**The rule is now `off` in `eslint.config.js` and must stay off.** With it
disabled, `toHaveBeenCalled()` survives a commit and the guidance above works.
Nothing now flags a hand-written zero-argument `toHaveBeenCalledWith()`, so that
part remains review discipline.

A lint rule banning the zero-argument form outright was tried and rejected: of
the 53 instances in the suite, at least 35 assert against genuinely zero-arity
functions, where `toHaveBeenCalledWith()` is the _stronger_ and correct
assertion — it proves no stray argument was passed. A blanket ban would delete
precision from correct tests, and no static selector can distinguish "asserts
zero args on purpose" from "meant to assert some args". Check it in review.

### 14. Multi-Tenant Isolation: Every By-Id Query and FK Must Be Org-Scoped

This is the dominant class of finding in the 2026-07 security audit (see
`docs/module-audit/`). Three distinct sub-rules, all about `organization_id`:

**14a — Every by-id read/update/delete filters `organization_id`.** A query that
fetches a row by its primary key (or any client-supplied id) MUST also filter
`organization_id == caller's org`, or resolve the row through a parent that was
already org-scoped. A bare `select(Model).where(Model.id == x)` on a
client-supplied id is an IDOR / cross-tenant leak.

```python
# WRONG — any org can read/mutate this row by guessing/knowing the id
result = await db.execute(select(Candidate).where(Candidate.id == candidate_id))

# CORRECT — scope to the caller's org (or resolve via an org-scoped parent)
result = await db.execute(
    select(Candidate).where(
        Candidate.id == candidate_id,
        Candidate.organization_id == organization_id,
    )
)
```

**14b — `require_permission(...)` does NOT scope the object (XC-3).** A permission
dependency only asserts the caller holds the permission _in their own org_. An
admin update/delete that then fetches the target by a path/body id without an org
filter lets an org-A admin mutate an org-B row. Always resolve the target through
an org-scoped fetch (e.g. `get_election(id, current_user.organization_id)`)
before mutating it — the permission check is not enough.

**14c — Validate client-supplied FK ids belong to the org on create/update
(XC-1).** When a create/update stores a client-supplied foreign key
(`user_id`, `category_id`, `apparatus_id`, `template_id`, `pipeline_id`,
`assignee_id`, …), verify that referenced row is in the caller's org before
storing it. Even when the write is org-stamped (so it can't be _read_
cross-tenant), an unvalidated FK persists a dangling/mis-attributed reference —
and in some cases (e.g. an eager-loaded template relationship with no org filter
on the join) it leaks the other org's data back in the response. Prefer a shared
`assert_in_org(db, Model, id, org_id)` helper over ad-hoc checks.

**Rule:** When writing or reviewing any endpoint/service that takes an id or FK
from the client: (1) org-scope every by-id query, (2) resolve mutation targets
through an org-scoped fetch even behind `require_permission`, (3) validate
client-supplied FK ids are in-org before persisting them. Also fail _closed_ in
access-control helpers — if a referenced folder/parent can't be resolved, deny,
don't grant.

### 15. CSV / Spreadsheet Exports: Always Use `SafeCsvWriter`, Never Raw `csv.writer`

Exported CSVs are opened in Excel / Google Sheets, which **execute** any cell
whose value begins with `=`, `+`, `-`, `@` (or a leading tab/CR) as a formula.
Free-text fields written to an export — member names, notes, item descriptions,
memos — are attacker-influenceable, so a member named `=cmd|…` runs a formula on
whatever staff member opens the export (formula/CSV injection). The
2026-07 module audit found this live in six separate exporters that used raw
`csv.writer`.

```python
# WRONG — a cell starting with = / + / - / @ executes in Excel/Sheets
import csv
writer = csv.writer(output)

# CORRECT — SafeCsvWriter neutralizes every cell (drop-in, same interface)
from app.utils.csv_export import SafeCsvWriter
writer = SafeCsvWriter(output)
```

**Rule:** Any CSV that leaves the system (member exports, compliance reports,
finance/QuickBooks exports, audit hand-offs) MUST be written with
`SafeCsvWriter` from `app/utils/csv_export.py` — never bare `csv.writer`. It
prefixes formula-trigger cells with a `'`, transparent to the reader. The same
applies to any other spreadsheet-bound output.

### 16. Never Use `window.confirm` / `window.alert` / `window.prompt` _(2026-08-09)_

**A browser may suppress them, and a suppressed dialog is indistinguishable from
Cancel.** Chrome suppresses repeated dialogs and dialogs inside cross-origin
frames; iOS and Firefox offer the user a "prevent this page from creating further
dialogs" checkbox. `window.confirm` then returns `false` and `window.prompt`
returns `null` — the same values as pressing Cancel — so the action silently does
nothing, with no error and no clue as to why.

```typescript
// WRONG — suppressible, and indistinguishable from Cancel when it is
if (!window.confirm("Delete this?")) return;
const reason = window.prompt("Reason?");

// CORRECT — same control flow, promise-based
const confirm = useConfirm();
if (!(await confirm({ message: "Delete this?", confirmLabel: "Delete" })))
  return;
```

- `useConfirm()` returns **only** `confirm()`. The dialog is rendered once by
  `ConfirmProvider` at the app root, above the router so public routes get one
  too — there is nothing for a consumer to render and so nothing to forget.
- **Without a provider the hook throws.** Neither default is safe: `true` carries
  out a deletion nobody agreed to, `false` swallows the action without a word. A
  missing provider is a wiring mistake and should fail loudly at the call, not
  quietly at the consequence. `renderWithRouter` wraps in the provider, matching
  the app shell.
- For a single typed value, use `PromptDialog` from `components/ux` — validation
  is shown rather than swallowed, and the field resets on each open so a reason
  typed for one record cannot be filed against the next.
- **Name the decision on the buttons** ("Keep it" / "Delete", "Stay here" /
  "Discard changes"), and state the consequence a native one-liner had no room
  for.

**Rule:** No new `window.confirm` / `window.alert` / `window.prompt` anywhere in
the frontend. A `.ts` hook that cannot render JSX does not need to — it calls
`useConfirm()` like everything else.

### 17. Form Controls: Use the `form-*` Utilities, Not a Hand-Rolled Box _(2026-08-10)_

`form-input`, `form-input-sm`, `form-checkbox`, `form-label`, `toggle-track` /
`toggle-track-sm` / `toggle-track-md` and `toggle-knob` are defined in
`styles/index.css` and are the app's standard at 800+ call sites. A hand-typed
class string drifts: the 2026-08-10 sweep found **169 distinct strings for what
is one control**, several of which had lost the 44px touch minimum or replaced
the theme focus-ring token with a raw palette colour.

```tsx
// WRONG — re-typed box; drifts, and loses the mobile touch minimum
<input className="w-full rounded-md border border-theme-surface-border px-3 py-2 focus:ring-1 focus:ring-violet-500" />

// CORRECT — width and other per-call-site concerns still go on the element
<input className="form-input w-28" />
```

Widths, icon padding, alignment, responsive sizes, disabled states and shadows
stay at the call site — their standalone rules are emitted **after** the
composite utility, so they still win.

**Rule:** Reach for the utility first. If a new shared pattern is needed, define
it as an `@utility` under the matching group header in `styles/index.css` rather
than assembling it at the call site — that is what left `toggle-knob` in the
sheet with no matching track and fifteen hand-built switches around it.

### 18. Notifications Are Email-First; SMS Is an Add-On Behind an Allowlist _(2026-08-16)_

Email is the primary channel and the channel of record. The in-app bell, web
push and SMS are additions layered on top of an email that still goes out —
never substitutes for it. A member who reads only their inbox must not miss
anything, because email is the only channel the department can prove reached
them.

SMS costs money per message, arrives outside working hours, and is legally
constrained (US TCPA requires express prior consent). So it is limited to the
alerts named in `SmsAlert` in `app/services/notification_channels.py`, and that
list is exhaustive. **Operational and administrative notices are email-only** —
low-stock and reorder alerts, overdue-property digests, renewal and deadline
reminders, anything whose recipient acts on it during business hours. A
quartermaster does not need a 2am text to learn the department is low on gloves,
and a text can carry neither the item list nor the quantities the email does.

```python
# WRONG — a hand-rolled filter at the call site, for a routine notice
sms_svc = SMSService()
if sms_svc.enabled:
    phones = [a.phone for a in admins if a.phone and str(a.id) in consented]
    await sms_svc.send_bulk_sms(phones, "Low Stock Alert: ...")

# CORRECT — the allowlist decides, and it resolves both opt-in gates
from app.services.notification_channels import SmsAlert, resolve_sms_recipients
numbers = await resolve_sms_recipients(db, recipients, SmsAlert.URGENT_DEPARTMENT_MESSAGE)
```

`resolve_sms_recipients` applies Twilio configuration, the recorded TCPA consent
(fails closed — a member never asked counts as having refused) and the member's
own `sms_notifications` preference, which mutes texts without touching the
emails they keep receiving.

**Rule:** Never call `SMSService` directly from a feature. Route through
`resolve_sms_recipients`, and give a notification a text only by adding a member
to `SmsAlert` — a visible, reviewable change rather than a call site nobody
sees. Whatever the SMS gates decide, send the email unconditionally.

### 19. A Config Switch Must Have a Reader Before It Has a UI _(2026-08-16)_

`notification_rules` shipped with a model, CRUD endpoints, an admin screen, a
create modal and an enable/disable toggle — and **no code that read the table**.
A chief could create "Event reminders", see it listed as _Active_, toggle it
off, and the reminders kept going out. A switch wired to nothing is worse than
no switch: it invites somebody to believe a notification is off when it is not,
and nothing about the UI says otherwise.

When adding org-level configuration, the reader comes first, and the UI only
ever offers what a reader consults:

- **Name the wired set in code, on the backend.** `ENFORCED_TRIGGERS` in
  `models/notification.py` is the authority; `NotificationRuleResponse` reports
  `enforced` per rule so the screen can label a stored-but-inert one instead of
  badging it Active. The frontend dropdown offers only the wired values.
- **Absence must mean "current behaviour", never "off".** A resolver that
  defaults to disabled when a table is empty silently kills every existing
  installation's notifications on upgrade, and nobody connects the missed drill
  notice to the deploy. `NotificationRuleResolver` returns
  `enabled=True` plus the sender's previous built-in defaults when an org has no
  rule.
- **Read free-form JSON config defensively.** `rule.config` is unvalidated JSON;
  `reminder_schedule_from` degrades a bad value to the built-in default rather
  than raising, because an exception inside a scheduled task takes out the whole
  organization's reminders rather than the one setting somebody typed wrong.

**Rule:** Do not ship a setting whose only effect is being stored. Either wire a
reader in the same change, or mark it in the UI as not yet in effect — and add a
test asserting the wired set, so the next trigger cannot be added to the list
without a sender that reads it.

### 20. Untyped JSON Columns Get One Canonical Shape, Settled at the Write _(2026-08-19)_

`shifts.positions`, `shift_templates.positions` and `basic_apparatus.positions`
are untyped JSON, and three writers filled them three different ways: bare
strings from onboarding and the pre-2026-08 UI, `{"position", "required"}`
objects from the current template form, and — on templates only — an
event-metadata dict that is not a seat list at all. Every reader then had to
tell those apart, and the templates screen did not: it rendered an entry
straight into a span and took the page down with React error #31.

The frontend types said `string[]`. The column had held objects for months.

**Rule:** a JSON column gets exactly one canonical stored shape, normalized on
every write path, plus a migration that settles the rows already there. A
reader-side conversion is a stopgap: it fixes the screen you are looking at and
leaves the next reader to rediscover the problem.

Seat lists are `[{"position": str, "required": bool}]`, one entry per seat.
`app/utils/positions.normalize_stored_positions` is the write-side authority.

**The four normalizers are deliberate, not duplication to tidy away:**

| Where                                   | Why it exists                                                                                                                       |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `app/utils/positions.py`                | write side — settles a flat list, passes a dict (event metadata) through untouched                                                  |
| `SchedulingService.normalize_positions` | display side — _flattens_ event metadata into seats, which is right for rendering and destructive as a value to save                |
| `frontend .../services/api.ts`          | read boundary — the API can still serve rows written before the migration                                                           |
| the migration's inlined `_normalize`    | frozen — a migration must keep transforming rows the way it did the day it ran, so it cannot import a helper that is free to change |

Collapsing the first two is the specific mistake to avoid: saving the display
normalizer's output turns an event template's resources into a flat seat list
and loses the structure the event screens read.

**Also:** a backfill that cannot be reversed needs its irreversibility stated in
the migration docstring and needs to preserve information the old shape carried
implicitly. `20260819_2037_1eeb053d59b7` expands a legacy `count` into that many
seats for exactly this reason — collapsing it would have cut a three-firefighter
template to one, permanently, with no downgrade to undo it.

### 21. A Fixed, Flex-Centred Dialog Needs the Height Cap on the PANEL _(2026-08-20)_

A panel centred by `fixed inset-0 flex items-center` and given no height cap
overflows that container in **both** directions once it is taller than the
viewport. Neither end can be reached: the title sits above the top of the
screen, the action row below the bottom, and no scrollbar appears anywhere
because the fixed container itself never overflows. What the user reports is a
box they cannot interact with — not a layout complaint, because nothing looks
broken, it just refuses to take a tap.

A sweep on 2026-08-20 found this at 38 sites. A phone in landscape is 390px
tall, so it bites dialogs that are comfortable in portrait, and `items-end`
sheets overflow upward the same way.

```tsx
// WRONG — the panel grows past the viewport and neither end is reachable
<div className="modal-overlay z-50 flex items-center justify-center p-4">
  <DialogPanel onClose={onClose} className="w-full max-w-md">

// CORRECT
<div className="modal-overlay z-50 flex items-center justify-center p-4">
  <DialogPanel onClose={onClose} className="modal-panel-scroll w-full max-w-md">
```

**The cap has to be on the panel, not the container.** Adding `overflow-y-auto`
to the container looks like the fix and is not: `align-items: center` still
pushes the panel's top edge into the negative-scroll region, which no scrollbar
reaches. (`components/Modal.tsx` and `Modal`'s own `modal-body` already do this
correctly — the defect is confined to hand-rolled shells.)

`src/dialogScrollIntegrity.test.ts` walks the source and fails on a new
uncapped panel, in the manner of `routeIntegrity.test.ts`.

**Related, same symptom, different cause:** a fixed element pinned near the
bottom of the viewport must add `var(--bottom-nav-height, 0px)` to its offset.
The mobile bottom bar is 56px tall at `z-50` and renders after the page, so it
paints over anything at `bottom-0` or `bottom-6` and swallows its taps — that
is what buried the FAB's lower half, the update banner's "Reload now" and the
events bulk-action bar. `pb-safe` and `action-bar-safe` already fold the
allowance in; a hand-written `bottom-*` does not. Dialogs get out of this by
registering with `useOverlaySurface` (which `useDialog` does for you), which
hides the bar outright.

### 22. Never Hold One `patch()` Open in Two Coroutines at Once _(2026-08-23)_

`unittest.mock.patch` saves whatever it finds as "the original" when it enters.
Two patches of the **same** target open at the same time therefore record each
other, and the second exit reinstalls the first one's mock permanently:

```
A enters -> saves the real function, installs mock A
B enters -> saves *mock A*, installs mock B
A exits  -> restores the real function
B exits  -> restores *mock A*      <- the module keeps a mock for the session
```

This is not a hypothetical ordering. `TestConcurrentShiftTemplateSubmission`
drove two `submit_check` calls through `asyncio.gather`, and each coroutine
entered the same `patch("...equipment_check_service.resolve_apparatus_ref", ...)`.
The `AsyncMock` it stranded returned a `SimpleNamespace` with no `full`
attribute, so every later test reaching `if ref.full is not None` raised — and
with `pytest-randomly` reshuffling module order each run, the victims changed
run to run. The same commit passed and failed on alternate CI runs for a day,
always failing in a file unrelated to the one at fault.

```python
# WRONG — both coroutines patch the same module attribute
async def run(service):
    with patch("app.services.equipment_check_service.resolve_apparatus_ref", AsyncMock(...)):
        return await service.submit_check(...)

await asyncio.gather(run(a), run(b))

# CORRECT — patch once, outside the concurrent section
with patch("app.services.equipment_check_service.resolve_apparatus_ref", AsyncMock(...)):
    await asyncio.gather(run(a), run(b))
```

`patch.object(instance, ...)` against a per-coroutine object is fine — each
targets a different object, and an instance built inside a test cannot outlive
it. Only shared targets (modules, classes) collide.

**Rule:** never enter the same `patch()` from concurrently running coroutines.
Hoist it above the `gather`, or patch each instance separately.
`tests/conftest.py` enforces this: an autouse guard records every module- and
class-level patch target and fails the test that leaves a mock behind, naming
the attribute and restoring the original. If you see that failure, the fix is
this rule, not a re-run.

### 23. A Seeded Rank Grant Reaches the Database Through a Position _(2026-08-24)_

`operational_ranks` has no `permissions` column. Rank defaults resolve at
runtime from `OPERATIONAL_RANKS` via `get_rank_default_permissions`, which
makes "removing a grant from a rank needs no data migration" sound obviously
true. It is false, and the reason is one line of aliasing:

```python
# permissions.py — DEFAULT_POSITIONS
"firefighter": {
    ...
    "permissions": OPERATIONAL_RANKS["firefighter"]["default_permissions"],
},
```

`DEFAULT_POSITIONS["firefighter"]["permissions"]` **is** the rank's list — the
same object. Onboarding creates a system _position_ with slug `firefighter`
carrying a copy of it, and `dependencies.py` unions every assigned position's
stored permissions. So the rank's grants do reach the database, by way of a
position, and an installation that already ran onboarding keeps them until a
migration rewrites that row.

This cost a review round on #1795: `compliance.view` was revoked from the
`member` position only, and would have stayed live for everyone holding the
Firefighter position on every existing department.

It also defeats naive analysis. A survey that reads each role's body looking
for `SOMETHING.name` literals sees an empty list under `firefighter`, because
the entry is a reference — which is how the gap was missed in the first place.

**Rule:** changing a seeded grant means changing the registry **and** writing a
migration that covers every stored `positions` row carrying it — for a rank
grant, both the `member`-style position and the rank-mirroring one. Scope the
`UPDATE` to `is_system = True`: a department's own customized position is
theirs. Verify the migration by running it against a real table rather than by
reading it; `20260824_2140_31e2816df7c3` and its precedent
`20260814_0004` are the shape to copy. `tests/test_baseline_member_grants.py`
asserts the day-one grant set on all three registry entries by name, aliasing
or not, so the persisted path is covered rather than inferred.

### 24. Do Not Reuse a Branch Name After Its Pull Request Merges _(2026-08-24)_

Start follow-up work on a new branch. Reusing the name of a branch whose PR has
merged (and whose remote ref was deleted) is correlated with GitHub not firing
`pull_request` workflows at all for the new PR: on #1795, no workflow of any
kind ran for the first two commits over 45 minutes, while `main` kept building
normally, and CI only started once a `main` merge produced a fresh head. GitHub
also back-associates the _old_ branch's runs with the new PR, so the checks tab
looks populated while nothing has actually run the new code — which is the part
that can get a change merged unverified.

Causation was never proven, and a stuck trigger is not reproducible on demand.
A distinct branch name costs nothing, so it is not worth diagnosing twice.

**If CI has not started within a few minutes of opening a PR**, check
`actions_list` for runs against the head SHA specifically — a green checks tab
can be entirely inherited. The fix is a substantive push (merging the base
branch in, which the PR usually needs anyway). Never an empty commit, and never
a close-and-reopen.

### 25. A Migration Must Tolerate a Table Only `create_all` Builds _(2026-08-25)_

**39 of this schema's 254 tables are never created by any migration.**
`event_requests`, `prospects`, `positions`, the whole finance-approval set and
more come into being when `main.py`'s `_fast_path_init()` calls `create_all()`
and stamps Alembic at head — the deployment model
`app/utils/enum_normalization` documents.

That is deliberate, and it is also a trap, because **CI runs `alembic upgrade
head` against an empty database** in the integration and contract jobs, before
anything calls `create_all`. Reflecting a column on a table that is not there
raises `NoSuchTableError`, and that kills the entire upgrade — not just the one
step:

```python
# WRONG — dies on any database that has not started the app yet
def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column in {c["name"] for c in inspector.get_columns(table)}

if not _has_column("event_requests", "staffing_shift_id"):
    op.add_column("event_requests", sa.Column(...))

# CORRECT — require the table as well as the absent column
def _has_table(table: str) -> bool:
    return table in sa.inspect(op.get_bind()).get_table_names()

if _has_table("event_requests") and not _has_column("event_requests", "..."):
    op.add_column("event_requests", sa.Column(...))
```

**Skipping is correct, not merely safe.** A table `create_all` builds later is
built from the models, which already declare the new column.

This was live on 2026-08-24: two migrations adding columns to `event_requests`
failed on every fresh database, which is four red matrix jobs (MySQL 8.0 and
MariaDB 10.11 × integration and contract), not one. Fifteen of the sixteen
existing migrations that touch such a table already guarded; the pattern was
simply undocumented.

**Rule:** before altering a table in a migration, check whether any migration
creates it. If none does, guard the step on the table's existence.
`tests/test_migration_create_all_tables.py` enforces this and was clean when
written, so any failure is new.

**Related, same root:** `alembic upgrade head` alone does not produce a working
schema. On a freshly migrated database `scripts/repair_schema.py` still adds a
dozen columns the models declare and no migration creates. Treat the models as
the schema of record and migrations as alterations on top — not the reverse.

### 26. A Capacity Check Is a Read-Then-Write, and Needs the Row Locked _(2026-08-25)_

Anything with a limit — seats on a shift, `max_attendees` on an event, a role
on an outreach signup sheet — is enforced by counting what is already there and
then inserting. Two requests arriving together both read the count before
either commits, both decide there is room, and the limit is exceeded by exactly
the number of people who tapped at once. It is invisible in testing, because
one request never races itself.

`event_service` already gets this right, and is the pattern to copy: it locks
the **event row** before counting "going" RSVPs, so no other transaction can
commit an RSVP for that event until the decision is made.

```python
# WRONG — two members both see the last seat
shift = await self.get_shift_by_id(shift_id, organization_id)
occupied = await self.db.execute(select(func.count()).where(...))
if occupied >= len(slots):
    return None, "Position was filled"
self.db.add(ShiftAssignment(...))

# CORRECT — serialize the pair on the row everyone contends for
shift = await self.get_shift_by_id(shift_id, organization_id, for_update=True)
```

**Lock the parent, not the rows being counted.** The seats that would conflict
do not exist yet, so there is nothing to lock; the shift/event/request row is
the one thing both transactions already share.

**Lock only where the limit is actually enforced.** Shift assignment locks for
self-signup and not for an officer-made one, because an officer overfilling a
crew is a call they are allowed to make on a busy night — serializing those
would buy nothing and cost concurrency.

Found on 2026-08-24 in the outreach role seats and the outreach signup sheet
(two coordinators each creating a shift, one orphaned), and on 2026-08-25 in
generic shift seat capacity, which had the same shape since it was written.

**Rule:** when adding a feature with a cap, a quota, or a one-per-thing
invariant, ask what happens if two requests arrive in the same millisecond. If
the answer involves a count followed by an insert, lock the parent row.

## Environment Variables

Reference files: `.env.example` (quick start), `.env.example.full` (all options), `frontend/.env.example`.

### Required (Production)

| Variable              | Purpose                           |
| --------------------- | --------------------------------- |
| `SECRET_KEY`          | JWT signing key (64+ chars)       |
| `ENCRYPTION_KEY`      | AES-256 key (64-char hex)         |
| `ENCRYPTION_SALT`     | Key derivation salt (32-char hex) |
| `DB_PASSWORD`         | MySQL user password               |
| `MYSQL_ROOT_PASSWORD` | MySQL root password               |
| `REDIS_PASSWORD`      | Redis auth password               |
| `ALLOWED_ORIGINS`     | Comma-separated CORS origins      |

Generate secrets:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(64))"   # SECRET_KEY
python3 -c "import secrets; print(secrets.token_hex(32))"        # ENCRYPTION_KEY
python3 -c "import secrets; print(secrets.token_hex(16))"        # ENCRYPTION_SALT
```

### Core Application

| Variable        | Default         | Purpose                                   |
| --------------- | --------------- | ----------------------------------------- |
| `ENVIRONMENT`   | `development`   | `development`, `staging`, or `production` |
| `DEBUG`         | `false`         | Never `true` in production                |
| `DB_HOST`       | `localhost`     | MySQL hostname (`mysql` in Docker)        |
| `DB_PORT`       | `3306`          | MySQL port                                |
| `DB_NAME`       | `intranet_db`   | Database name                             |
| `DB_USER`       | `intranet_user` | Database user                             |
| `REDIS_HOST`    | `localhost`     | Redis hostname (`redis` in Docker)        |
| `REDIS_PORT`    | `6379`          | Redis port                                |
| `FRONTEND_PORT` | `3000`          | Frontend exposed port                     |
| `BACKEND_PORT`  | `3001`          | Backend exposed port                      |
| `LOG_LEVEL`     | `INFO`          | Logging level                             |
| `ENABLE_DOCS`   | `true`          | API docs at `/docs` (disable in prod)     |

### Frontend (Vite)

| Variable           | Default                 | Purpose                                                                |
| ------------------ | ----------------------- | ---------------------------------------------------------------------- |
| `VITE_API_URL`     | `/api/v1`               | API base URL                                                           |
| `VITE_BACKEND_URL` | `http://localhost:3001` | Backend URL for Vite dev proxy                                         |
| `VITE_SESSION_KEY` | (random per session)    | Onboarding session encryption key — set a 32+ char value in production |

### Optional Services

Enable with `*_ENABLED=true`: `EMAIL_ENABLED`, `TWILIO_ENABLED`, `SENTRY_ENABLED`, `AZURE_AD_ENABLED`, `GOOGLE_OAUTH_ENABLED`, `PUSH_ENABLED` (Web Push; also needs `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` and the optional `pywebpush` dependency). Each requires additional config vars — see `.env.example.full`. (`LDAP_ENABLED` exists in config but gates nothing — LDAP is not implemented.)

### Attack Protection

Four brute-force controls layer on top of each other; when changing one, know which gap it covers so you do not collapse two into one:

| Control                | Counts                           | Keyed on             | On provider/Redis failure |
| ---------------------- | -------------------------------- | -------------------- | ------------------------- |
| `check_rate_limit`     | all attempts, short window       | IP + scope           | falls back to in-memory   |
| Account lockout        | consecutive failures             | user                 | n/a (database)            |
| Suspicious-IP throttle | **failed** attempts, long window | IP, **all** accounts | falls back to in-memory   |
| Breached password      | breach-corpus appearances        | password hash prefix | **fails open**            |
| CAPTCHA                | human challenge                  | request              | **fails closed**          |

The two failure directions are deliberate and opposite. Breached-password detection is supplementary — complexity rules, password history, MFA, and lockout still apply if the lookup is skipped — so an outage must not block password changes. CAPTCHA has no fallback control behind it, so accepting unverified traffic during an outage is the state an attacker wants; it rejects instead. Preserve both directions when touching either.

Two invariants in `app/core/suspicious_ip.py` that are load-bearing: a successful sign-in clears an IP's counter **only after full authentication** (never on a correct password alone, or an attacker holding one leaked password for an MFA-protected account could zero the tally at will), and clearing **never lifts an active block**.

Enabling `CAPTCHA_ENABLED` also widens the CSP in `SecurityHeadersMiddleware` for the configured provider's widget origins — a hardcoded `script-src 'self'` silently blocks the widget, which presents as "the challenge never appears" rather than as a CSP error. New providers need an entry in both `_VERIFY_URLS` and `_WIDGET_ORIGINS`.

### Module Enablement

Module availability is controlled **per organization** at runtime via the organization settings (`enabled_modules`), which the frontend navigation consumes. There are no deployment-level `MODULE_*_ENABLED` environment flags — they were removed because they gated nothing (all routers register unconditionally) and merely duplicated the per-org mechanism.
