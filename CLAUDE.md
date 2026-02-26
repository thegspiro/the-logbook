# CLAUDE.md — Project Context for Claude Code

## Project Overview

The Logbook is an open-source modular intranet platform for fire departments and emergency services. It is a monorepo with an npm workspaces structure containing a React frontend and a Python backend.

## Tech Stack

### Frontend (`/frontend`)

- **Bundler:** Vite 7.3
- **Framework:** React 18.3 (SPA, not Next.js or React Native)
- **Language:** TypeScript 5.9 (strict mode — see below)
- **Routing:** react-router-dom 6.30
- **State management:** Zustand 5.0
- **Forms:** react-hook-form 7.71 + Zod 3.24 validation
- **Styling:** Tailwind CSS 3.4 (with `tailwind-merge`, dark mode via `class` strategy)
- **HTTP client:** Axios 1.7
- **Auth (client):** jose (JWT decoding)
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

- **Runner:** Vitest 3.2 with jsdom environment
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

## Linting & Formatting

### Frontend

- ESLint 8 with @typescript-eslint (max-warnings 0)
- Prettier 3.4 with prettier-plugin-tailwindcss

### Backend

- Black (line length 120)
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

- **Components:** Functional React components, props defined as `interface`, typed with `React.FC<Props>`
- **Routing:** Critical pages imported directly; others use `lazy()` for code splitting. Module routes exported as `get{Module}Routes()` functions called in `App.tsx`
- **State:** Zustand stores define state interface + actions in one `create()` call. Async actions use `set({ isLoading: true })` / `try/catch` / `set({ isLoading: false })`
- **API calls:** Each module has a `services/api.ts` with its own axios instance (`baseURL: '/api/v1'`). Services are plain objects with async methods returning typed promises
- **Auth tokens:** Stored in `localStorage` (`access_token`, `refresh_token`). Axios request interceptor attaches `Authorization: Bearer`. Response interceptor auto-refreshes on 401
- **Styling:** Tailwind CSS with `theme-*` CSS variable classes. Dark mode via `class` strategy. Size variants as objects (`{ sm: 'max-w-md', md: 'max-w-lg' }`)
- **Types:** Defined as `interface` (not `type`) for domain objects. One file per domain in `types/`. Enums use `as const` objects with extracted types

### Backend Patterns

- **Endpoint layer** (`api/v1/endpoints/`): `APIRouter()` per file, registered in `api.py` with prefix/tags. Async handlers. Permission checks via `Depends(require_permission("resource.action"))`. Instantiate service class per request: `service = FooService(db)`
- **Service layer** (`services/`): Class initialized with `AsyncSession`. Public methods are async. Private helpers prefixed with `_`. Raises `ValueError` for validation errors, `HTTPException` for HTTP-specific errors
- **Models** (`models/`): Inherit from `Base`. String UUIDs as primary keys (`default=generate_uuid`). `DateTime(timezone=True)` for timestamps. `ForeignKey` with `ondelete="CASCADE"`. Relationships with `back_populates`
- **Schemas** (`schemas/`): Separate classes: `{Resource}Create`, `{Resource}Update`, `{Resource}Response`. Response schemas use `ConfigDict(from_attributes=True, alias_generator=to_camel, populate_by_name=True)` for camelCase serialization. `Field()` for validation
- **Permissions:** Dot-notation strings (`"apparatus.view"`, `"settings.manage"`). Wildcards supported: `"*"` (global), `"module.*"` (module-level). OR logic via `require_permission()`, AND logic via `require_all_permissions()`
- **API URL convention:** All routes under `/api/v1/`. Resources as plural nouns (`/events`, `/users`). Sub-resources nested (`/training/programs`). Actions as verbs on resource (`/{id}/archive`)

## Error Handling

### Frontend

- **`ErrorBoundary`** (`components/ErrorBoundary.tsx`): Wraps entire app in `App.tsx`. Catches React render errors. Shows user-friendly page with retry/reload/go-home buttons. Logs to `errorTracker`. Dev mode shows stack trace
- **`toAppError()` / `getErrorMessage()`** (`utils/errorHandling.ts`): Converts unknown catch values to a typed `AppError { message, code?, status?, details? }`. Type guards narrow axios errors, Error objects, strings. Use in stores and async operations:
  ```typescript
  catch (error) {
    set({ error: error instanceof Error ? error.message : 'Fallback message', isLoading: false });
  }
  ```
- **`errorTracker`** (`services/errorTracking.ts`): Singleton `ErrorTrackingService`. Maps error types to user-friendly messages + troubleshooting steps. Persists errors to backend API. Known types: `EVENT_NOT_FOUND`, `NETWORK_ERROR`, `AUTHENTICATION_REQUIRED`, etc.
- **Axios interceptors:** Response interceptor catches 401 → attempts token refresh → retries original request. On refresh failure → clears tokens → redirects to `/login`

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
