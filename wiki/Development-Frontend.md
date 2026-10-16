# Frontend Development

Guide to developing the React/TypeScript frontend for The Logbook.

---

## Technology Stack

| Technology      | Version | Purpose                                           |
| --------------- | ------- | ------------------------------------------------- |
| React           | 19      | UI framework                                      |
| TypeScript      | 7.0     | Compiler (`tsc-native`); 5.9 for type-aware lint  |
| Vite            | 8.3     | Build tool and dev server                         |
| Vitest          | 5       | Unit/integration testing                          |
| Tailwind CSS    | 4.x     | Utility-first CSS                                 |
| Zod             | 4       | Schema validation                                 |
| ESLint          | 10      | Linting (flat config)                             |
| React Router    | 8.4     | Client-side routing (core `react-router` package) |
| React Hook Form | 7.89    | Form management                                   |
| Lucide React    | 1.x     | Icons                                             |
| React Hot Toast | —       | Toast notifications                               |
| DOMPurify       | —       | XSS sanitization                                  |

---

## Getting Started

### Prerequisites

- Node.js 22.22.1+
- npm 10+ (the `engines` floor in `package.json` and `frontend/package.json`)

### Setup

```bash
# Install from the repo root — the workspace uses a single root lockfile.
# Do not run npm install inside frontend/ (see "No nested
# frontend/package-lock.json" in docs/KNOWN_LIMITATIONS.md).
npm install
cd frontend
cp .env.example .env
# Edit .env if needed
npm run dev
```

The dev server starts at `http://localhost:3000` with hot module replacement
(`server.port` in `vite.config.ts`), and proxies `/api` to the backend on
`VITE_BACKEND_URL` (default `http://localhost:3001`).

### Environment Variables

```bash
# Development
VITE_API_URL=/api/v1
VITE_BACKEND_URL=http://localhost:3001  # Only for Vite dev server proxy

# Production (build-time only)
VITE_API_URL=/api/v1
```

> **Critical:** Vite replaces `import.meta.env.VITE_*` at build time. These cannot be changed after building.

---

## Commands

```bash
npm run dev              # Start dev server (port 3000)
npm run build            # Typecheck (tsc-native), then production build
npm run preview          # Preview production build
npm run test             # Run tests (Vitest)
npm run lint             # Lint code
npm run lint:fix         # Lint and auto-fix
npm run format           # Format code
npm run typecheck        # TypeScript type checking (application code)
npm run typecheck:tests  # TypeScript type checking (test files)
```

---

## Project Structure

```
frontend/src/
├── components/        # Reusable UI components
│   ├── layout/        # Layout components (AppLayout, navigation, etc.)
│   ├── settings/      # SettingsLayout and the settings sections
│   ├── ux/            # UX components (Skeleton, Breadcrumbs, Pagination, etc.)
│   ├── <feature>/     # Shared feature folders (events, members, training, ...)
│   └── *.tsx          # Shared top-level components (Modal, ErrorBoundary,
│                      #   ProtectedRoute, ...)
├── constants/         # Centralized constants (config.ts, enums.ts)
├── pages/             # Page components (one per route)
├── modules/           # Feature modules (self-contained)
│   ├── action-items/        # Action items from meetings
│   ├── admin/               # Admin pages routes
│   ├── admin-hours/         # Admin hours tracking
│   ├── apparatus/           # Apparatus/vehicle management
│   ├── communications/      # Email templates & messaging
│   ├── documents/           # Document management routes
│   ├── elections/           # Elections & voting
│   ├── events/              # Event management routes
│   ├── facilities/          # Facilities management routes
│   ├── finance/             # Budgets, purchase requests, dues, approvals
│   ├── forms/               # Custom forms routes
│   ├── governance/          # Legal documents and org chart
│   ├── grants-fundraising/  # Grants, campaigns, donors
│   ├── integrations/        # Integration routes
│   ├── inventory/           # Inventory routes
│   ├── ip-security/         # IP exceptions and blocked-access review
│   ├── medical-screening/   # Medical screening requirements and records
│   ├── medical-supplies/    # EMS stock, separate from gear and uniforms
│   ├── membership/          # Membership management
│   ├── minutes/             # Meeting minutes routes
│   ├── notifications/       # Notification routes
│   ├── onboarding/          # Onboarding wizard
│   ├── prospective-members/ # Applicant pipeline
│   ├── public-portal/       # Public portal
│   ├── reports/             # Departmental reports and exports
│   ├── scheduling/          # Scheduling module
│   ├── settings/            # Settings routes
│   ├── storefront/          # Department store and order windows
│   ├── testing/             # In-app testing checklist (testingRegistry.ts)
│   └── training/            # Training module
├── hooks/             # Custom React hooks
├── services/          # Global API services, one file per domain
│   ├── api.ts                 # Barrel re-export of the domain services
│   ├── apiClient.ts           # Shared axios instance with interceptors
│   ├── authService.ts         # Authentication API
│   ├── userServices.ts        # User management API
│   ├── eventServices.ts       # Event management API
│   ├── trainingServices.ts    # Training API
│   ├── inventoryService.ts    # Inventory API
│   ├── electionService.ts     # Elections API
│   ├── communicationsServices.ts  # Communications API
│   ├── documentsService.ts    # Documents API
│   ├── formsServices.ts       # Forms API
│   ├── adminServices.ts       # Admin API
│   ├── facilitiesServices.ts  # Facilities API
│   ├── meetingsServices.ts    # Meetings API
│   └── ...                    # Further domain services
├── stores/            # State management
├── types/             # TypeScript type definitions
├── utils/             # Utility functions
└── styles/            # Global styles and CSS variables
```

### Module Structure

Each module follows a consistent structure:

```
modules/<module>/
├── index.ts           # Barrel export
├── routes.tsx         # Route definitions with lazyWithRetry()
├── pages/             # Module-specific page components
├── components/        # Module-specific components
├── services/          # Module-specific API service
├── store/             # Module-specific Zustand store
└── types/             # Module-specific TypeScript types
```

---

## Coding Standards

### TypeScript

- **No `as any`** — Use proper types. All `as any` assertions have been removed.
- **Interface over Type** — Prefer `interface` for object shapes
- **Strict mode** — TypeScript strict mode is enabled with additional checks: `exactOptionalPropertyTypes`, `noImplicitReturns`, `noImplicitOverride`, `allowUnreachableCode: false`, `allowUnusedLabels: false`
- **exactOptionalPropertyTypes** — Do not assign `undefined` to optional properties; omit them instead
- **Explicit return types** — On exported functions

### React

- **Functional components** — No class components
- **Hooks** — Use React hooks for state and lifecycle
- **Memoization** — Use `useMemo` and `useCallback` for expensive operations
- **Error boundaries** — Wrap module-level components

### CSS

- **Tailwind CSS v4** — Use utility classes for styling; configuration via `@theme` directives in CSS (not `tailwind.config.js`)
- **Theme tokens** — Use the `theme-*` utility classes (`bg-theme-surface`, `text-theme-text-primary`), which read the CSS variables below
- **Dark mode** — Use `bg-theme-surface-modal` for modal backgrounds
- **Responsive** — Mobile-first responsive design

### ESLint

- **ESLint v10** with flat config (`eslint.config.js`, not `.eslintrc.json`)
- **@typescript-eslint** plugins for TypeScript-specific rules
- Run `npm run lint:fix --workspace frontend` from the repo root to auto-fix issues

---

## Theming

The application supports light, dark and high-contrast themes via CSS
variables in `src/styles/index.css`. `:root` holds the light values, and the
`.dark` and `.high-contrast` classes override them:

```css
:root {
  --surface-bg: #ffffff;
  --surface-modal: #ffffff;
  --surface-border: #e2e8f0;
  --text-primary: #0f172a;
  --text-secondary: #334155;
  --text-muted: #475569;
}

.dark {
  --surface-bg: rgba(255, 255, 255, 0.06);
  --surface-modal: #1e293b;
  --surface-border: rgba(255, 255, 255, 0.2);
  --text-primary: #ffffff;
  --text-secondary: #ffffff;
  --text-muted: #ffffff;
}
```

The `@theme` block maps them to Tailwind colors (for example
`--color-theme-surface: var(--surface-bg)`), which is what makes classes such
as `bg-theme-surface` and `text-theme-text-primary` available.

---

## Accessibility

The application targets WCAG 2.1 Level AA:

- Semantic HTML elements
- ARIA labels on interactive elements
- `aria-describedby` linking form validation errors to inputs
- Keyboard navigation support (including G/E/M shortcuts)
- Focus indicators on all interactive elements (`focus-visible` styles)
- Skip-to-main-content links (targeting correct element inside React root)
- High contrast ratios (4.5:1 body text, 3:1 large text)
- High-contrast accessibility theme option (pure black/white, yellow focus rings)
- Screen reader friendly
- Zoom to 200% without horizontal scroll
- Print-optimized CSS (`@media print` hides nav, resets backgrounds, shows link URLs)

---

## API Integration

API calls are organized into domain-specific service files in `src/services/`. Each service uses the shared axios instance from `apiClient.ts`, with consistent interceptors:

```typescript
// Example: fetch members
import { userService } from "@/services/userServices";

const users = await userService.getUsers();

// Or use the raw API client (the module's default export)
import api from "@/services/apiClient";
const response = await api.get("/users");
```

The shared API client automatically:

- Sends httpOnly cookies with `withCredentials: true`
- Attaches CSRF token on state-changing requests
- Handles 401 → refresh → retry flow
- Includes stale-while-revalidate caching for GET requests
- Translates technical errors to user-friendly messages

Module-scoped services (e.g., `modules/scheduling/services/api.ts`) use `createApiClient()` for the same interceptor setup.

---

## Building for Production

```bash
npm run build
# Output: frontend/dist/
```

The Docker build uses a multi-stage Dockerfile:

1. **Build stage** — npm install + npm run build (with VITE\_\* build args)
2. **Runtime stage** — Nginx serving static files + API proxy

---

## Browser Support

| Browser        | Support         |
| -------------- | --------------- |
| Chrome / Edge  | Last 2 versions |
| Firefox        | Last 2 versions |
| Safari         | Last 2 versions |
| iOS Safari     | Last 2 versions |
| Android Chrome | Last 2 versions |

---

**See also:** [Backend Development](Development-Backend) | [Technology Stack](Technology-Stack) | [Contributing](Contributing)
