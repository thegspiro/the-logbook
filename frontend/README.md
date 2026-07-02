# The Logbook - Frontend

React + TypeScript + Vite frontend application for The Logbook fire department intranet.

## Features

- ⚡ **Vite** - Lightning fast build tool
- ⚛️ **React 19** - Latest React with hooks
- 📘 **TypeScript** - Type safety
- 🎨 **Tailwind CSS** - Utility-first CSS
- 🚀 **React Router** - Client-side routing
- 🔔 **React Hot Toast** - Beautiful notifications
- 📱 **PWA Ready** - Progressive Web App support
- ♿ **Accessible** - WCAG 2.1 Level AA compliant

## Getting Started

### Prerequisites

- Node.js 18.x or higher
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Start development server
npm run dev
```

The app will be available at http://localhost:3000

### Environment Variables

**For development (with Vite dev server proxy):**
```env
VITE_API_URL=/api/v1
VITE_BACKEND_URL=http://localhost:3001
```

**For production (Docker with nginx proxy):**
```env
VITE_API_URL=/api/v1
```

**Note:** The `VITE_BACKEND_URL` is only used by the Vite dev server to proxy API requests. In production, nginx handles the proxying and only `VITE_API_URL=/api/v1` is needed.

## Development

```bash
# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Run tests
npm run test

# Lint code
npm run lint

# Format code
npm run format

# Type check
npm run typecheck
```

## Project Structure

```
frontend/
├── public/              # Static assets
│   └── favicon.svg      # App icon
├── src/
│   ├── components/      # Reusable components
│   ├── pages/           # Page components
│   │   ├── Welcome.tsx          # Landing page with fade-in
│   │   └── OnboardingCheck.tsx  # Onboarding status check
│   ├── hooks/           # Custom React hooks
│   ├── utils/           # Utility functions
│   ├── types/           # TypeScript types
│   ├── styles/          # Global styles
│   │   └── index.css    # Tailwind imports
│   ├── App.tsx          # Main app component
│   ├── main.tsx         # Entry point
│   └── vite-env.d.ts    # Vite TypeScript definitions
├── index.html           # HTML template
├── vite.config.ts       # Vite configuration
├── tailwind.config.js   # Tailwind configuration
├── tsconfig.json        # TypeScript configuration
└── package.json         # Dependencies
```

## Pages

### Welcome Page (/)

The landing page with a beautiful fade-in animation:
- Blank screen for 3 seconds
- "Welcome to The Logbook" title fades in
- Description paragraph fades in after 1 second
- Security feature badges
- Auto-redirects to onboarding check after 10 seconds

### Onboarding Check (/onboarding)

Checks if the system needs onboarding:
- Calls `/api/v1/onboarding/status`
- Redirects to onboarding wizard if needed
- Redirects to login if already complete
- Shows error message if backend is unreachable

## Building for Production

```bash
# Build the app
npm run build

# The built files will be in the dist/ folder
# Serve with any static file server or use nginx
```

## Docker

```bash
# Development
docker-compose up frontend

# Production build
docker build --target production -t logbook-frontend .
docker run -p 80:80 logbook-frontend
```

## Accessibility

The frontend is built with accessibility in mind:

- ✅ Semantic HTML
- ✅ ARIA labels where needed
- ✅ Keyboard navigation
- ✅ Focus indicators
- ✅ Skip to main content link
- ✅ Screen reader friendly
- ✅ High contrast colors
- ✅ Proper heading hierarchy

## Browser Support

- Chrome/Edge (last 2 versions)
- Firefox (last 2 versions)
- Safari (last 2 versions)
- iOS Safari (last 2 versions)
- Android Chrome (last 2 versions)

## Contributing

1. Follow the existing code style
2. Write TypeScript with proper types
3. Ensure accessibility standards
4. Test on multiple browsers
5. Update documentation

## License

MIT License - see LICENSE file for details
