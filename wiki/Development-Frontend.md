# Frontend Development

Guide to developing the React/TypeScript frontend for The Logbook.

---

## Technology Stack

| Technology | Version | Purpose |
|-----------|---------|---------|
| React | 18.3 | UI framework |
| TypeScript | 5.9 | Type-safe JavaScript |
| Vite | 7.3 | Build tool and dev server |
| Vitest | 3.2 | Unit/integration testing |
| Tailwind CSS | 3.x | Utility-first CSS |
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
├── modules/           # Feature modules
│   ├── onboarding/    # Onboarding wizard
│   ├── training/      # Training module
│   ├── scheduling/    # Scheduling module
│   └── ...
├── hooks/             # Custom React hooks
├── services/          # API service functions
├── stores/            # State management
├── types/             # TypeScript type definitions
├── utils/             # Utility functions
└── styles/            # Global styles and CSS variables
```

---

## Coding Standards

### TypeScript

- **No `as any`** — Use proper types. All `as any` assertions have been removed.
- **Interface over Type** — Prefer `interface` for object shapes
- **Strict mode** — TypeScript strict mode is enabled
- **Explicit return types** — On exported functions

### React

- **Functional components** — No class components
- **Hooks** — Use React hooks for state and lifecycle
- **Memoization** — Use `useMemo` and `useCallback` for expensive operations
- **Error boundaries** — Wrap module-level components

### CSS

- **Tailwind CSS** — Use utility classes for styling
- **CSS Variables** — Use `--theme-*` variables for theming
- **Dark mode** — Use `bg-theme-surface-modal` for modal backgrounds
- **Responsive** — Mobile-first responsive design

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

API calls use service functions in `src/services/`:

```typescript
// Example: fetch members
import { apiClient } from '../services/apiClient';

const response = await apiClient.get('/api/v1/users');
```

The API client automatically:
- Adds JWT `Authorization` header
- Handles token refresh on 401 responses
- Translates technical errors to user-friendly messages

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
