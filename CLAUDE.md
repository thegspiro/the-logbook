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
