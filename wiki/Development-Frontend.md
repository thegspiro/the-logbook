# Frontend Development

Guide to developing the React/TypeScript frontend for The Logbook.

---

## Technology Stack

| Technology | Version | Purpose |
|-----------|---------|---------|
| React | 19 | UI framework |
| TypeScript | 5.9 | Type-safe JavaScript |
| Vite | 7.3 | Build tool and dev server |
| Vitest | 4 | Unit/integration testing |
| Tailwind CSS | 4.2 | Utility-first CSS |
| Zod | 4 | Schema validation |
| ESLint | 9 | Linting (flat config) |
| React Router | 6.x | Client-side routing |
| React Hook Form | 7.71 | Form management |
| Lucide React | 0.575+ | Icons |
| React Hot Toast | — | Toast notifications |
| DOMPurify | — | XSS sanitization |

---

## Getting Started

### Prerequisites
- Node.js 18.x+
- npm 9+

### Setup

```bash
cd frontend
npm install
cp .env.example .env
# Edit .env if needed
npm run dev
```

The dev server starts at `http://localhost:5173` with hot module replacement.

### Environment Variables

```bash
# Development
VITE_API_URL=/api/v1
VITE_BACKEND_URL=http://localhost:3001  # Only for Vite dev server proxy

# Production (build-time only)
VITE_API_URL=/api/v1
VITE_ENV=production
VITE_ENABLE_PWA=true
```

> **Critical:** Vite replaces `import.meta.env.VITE_*` at build time. These cannot be changed after building.

---

## Commands

```bash
npm run dev        # Start dev server (port 5173)
npm run build      # Production build
npm run preview    # Preview production build
npm run test       # Run tests
npm run lint       # Lint code
npm run format     # Format code
npm run typecheck  # TypeScript type checking
```

---

## Project Structure

```
frontend/src/
├── components/        # Reusable UI components
│   ├── common/        # Shared components (Modal, Button, Table, etc.)
│   ├── layout/        # Layout components (Sidebar, Header, etc.)
│   ├── modules/       # Module-specific components
│   └── ux/            # UX components (Skeleton, Breadcrumbs, Pagination, etc.)
├── constants/         # Centralized constants (config.ts, enums.ts)
├── pages/             # Page components (one per route)
├── modules/           # Feature modules (self-contained)
│   ├── action-items/  # Action items from meetings
│   ├── admin/         # Admin pages routes
│   ├── admin-hours/   # Admin hours tracking
│   ├── apparatus/     # Apparatus/vehicle management
│   ├── communications/# Email templates & messaging
│   ├── documents/     # Document management routes
│   ├── elections/     # Elections & voting
│   ├── events/        # Event management routes
│   ├── facilities/    # Facilities management routes
│   ├── forms/         # Custom forms routes
│   ├── integrations/  # Integration routes
│   ├── inventory/     # Inventory routes
│   ├── membership/    # Membership management
│   ├── minutes/       # Meeting minutes routes
│   ├── notifications/ # Notification routes
│   ├── onboarding/    # Onboarding wizard
│   ├── public-portal/ # Public portal
│   ├── scheduling/    # Scheduling module
│   ├── settings/      # Settings routes
│   └── training/      # Training module
├── hooks/             # Custom React hooks
├── services/          # API service functions (split into 13 domain files)
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
│   └── meetingsServices.ts    # Meetings API
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
- **CSS Variables** — Use `--theme-*` variables for theming
- **Dark mode** — Use `bg-theme-surface-modal` for modal backgrounds
- **Responsive** — Mobile-first responsive design

### ESLint

- **ESLint v9** with flat config (`eslint.config.js`, not `.eslintrc.json`)
- **@typescript-eslint** plugins for TypeScript-specific rules
- Run `npx eslint --fix frontend/src/` to auto-fix issues

---

## Theming

The application supports light and dark themes via CSS variables:

```css
/* Light theme */
--theme-bg: #ffffff;
--theme-text: #1a1a1a;
--theme-surface: #f5f5f5;
--theme-surface-modal: #ffffff;

/* Dark theme */
--theme-bg: #1a1a1a;
--theme-text: #e0e0e0;
--theme-surface: #2a2a2a;
--theme-surface-modal: #333333;
```

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

API calls are organized into 13 domain-specific service files in `src/services/`. Each service uses a shared `apiClient` with consistent interceptors:

```typescript
// Example: fetch members
import { userService } from '@/services/userServices';

const users = await userService.getUsers();

// Or use the raw API client
import { apiClient } from '@/services/apiClient';
const response = await apiClient.get('/users');
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
1. **Build stage** — npm install + npm run build (with VITE_* build args)
2. **Runtime stage** — Nginx serving static files + API proxy

---

## Browser Support

| Browser | Support |
|---------|---------|
| Chrome / Edge | Last 2 versions |
| Firefox | Last 2 versions |
| Safari | Last 2 versions |
| iOS Safari | Last 2 versions |
| Android Chrome | Last 2 versions |

---

**See also:** [Backend Development](Development-Backend) | [Technology Stack](Technology-Stack) | [Contributing](Contributing)
