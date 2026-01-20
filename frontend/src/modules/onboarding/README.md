# Onboarding Module

The Onboarding Module handles the first-time setup wizard for The Logbook fire department intranet. It guides new users through configuring their department information, preferences, and creating the initial admin account.

## Features

- **7-Step Setup Wizard**:
  1. Welcome screen with animated introduction
  2. Department name and logo collection
  3. Navigation layout selection (top bar vs. left sidebar)
  4. Email platform configuration (Gmail, Microsoft 365, self-hosted SMTP, or skip)
  5. Email credentials setup
  6. Admin user account creation
  7. Security verification and completion

- **Modular Architecture**: Entire module can be enabled/disabled with a single line
- **Session Storage**: Maintains state across wizard steps
- **Comprehensive Validation**: Real-time field validation and password strength checking
- **Accessible**: WCAG 2.1 Level AA compliant with ARIA labels
- **Responsive**: Works on all screen sizes

## Directory Structure

```
onboarding/
├── components/           # Shared UI components
│   ├── OnboardingHeader.tsx
│   ├── OnboardingFooter.tsx
│   ├── ProgressIndicator.tsx
│   └── index.ts
├── hooks/               # Custom React hooks
│   ├── useOnboardingStorage.ts
│   └── index.ts
├── pages/               # Wizard page components
│   ├── Welcome.tsx
│   ├── OnboardingCheck.tsx
│   ├── DepartmentInfo.tsx
│   ├── NavigationChoice.tsx
│   ├── EmailPlatformChoice.tsx
│   ├── EmailConfiguration.tsx
│   ├── AdminUserCreation.tsx
│   └── index.ts
├── types/               # TypeScript type definitions
│   └── index.ts
├── utils/               # Utility functions
│   ├── storage.ts       # Session storage helpers
│   ├── validation.ts    # Form validation
│   └── index.ts
├── routes.tsx           # Route definitions
├── index.ts             # Main module export
└── README.md            # This file
```

## Usage

### Enabling the Module

In `App.tsx`, include the OnboardingRoutes component:

```tsx
import { OnboardingRoutes } from './modules/onboarding';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <OnboardingRoutes />
        {/* Other routes */}
      </Routes>
    </BrowserRouter>
  );
}
```

### Disabling the Module

To disable the onboarding module, simply comment out or remove the `<OnboardingRoutes />` line in `App.tsx`:

```tsx
function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* <OnboardingRoutes /> */}  {/* ONBOARDING DISABLED */}
        {/* Other routes */}
      </Routes>
    </BrowserRouter>
  );
}
```

## Components

### OnboardingHeader

Displays the department logo and name at the top of each wizard page.

```tsx
import { OnboardingHeader } from './modules/onboarding';

<OnboardingHeader
  departmentName="Springfield Fire Department"
  logoPreview="/path/to/logo.png"
  icon={<CustomIcon />}
/>
```

### OnboardingFooter

Displays copyright information and branding.

```tsx
import { OnboardingFooter } from './modules/onboarding';

<OnboardingFooter departmentName="Springfield Fire Department" />
```

### ProgressIndicator

Shows setup progress through the wizard.

```tsx
import { ProgressIndicator } from './modules/onboarding';

<ProgressIndicator currentStep={3} totalSteps={7} />
```

## Hooks

### useOnboardingStorage

Access onboarding data from session storage:

```tsx
import { useOnboardingStorage } from './modules/onboarding';

function MyComponent() {
  const { onboardingData, departmentName, logoPreview, refreshData } = useOnboardingStorage();

  return (
    <div>
      <h1>{departmentName}</h1>
      <img src={logoPreview} alt="Logo" />
    </div>
  );
}
```

## Utilities

### Storage Functions

```tsx
import {
  saveDepartmentInfo,
  saveNavigationLayout,
  saveEmailPlatform,
  saveEmailConfig,
  saveAdminUser,
  getOnboardingData,
  clearOnboardingData,
} from './modules/onboarding';

// Save department info
saveDepartmentInfo('Springfield Fire Dept', 'data:image/png;base64,...');

// Get all onboarding data
const data = getOnboardingData();

// Clear all onboarding data
clearOnboardingData();
```

### Validation Functions

```tsx
import {
  checkPasswordStrength,
  isValidEmail,
  isValidUsername,
  isValidImageFile,
  isValidPort,
  isValidHost,
} from './modules/onboarding';

// Check password strength
const strength = checkPasswordStrength('MyP@ssw0rd123');
// Returns: { checks: {...}, passedChecks: 5 }

// Validate email
const valid = isValidEmail('user@example.com'); // true

// Validate image
const result = isValidImageFile(file);
// Returns: { valid: true } or { valid: false, error: 'message' }
```

## Types

```tsx
import {
  OnboardingData,
  EmailConfig,
  AdminUser,
  OnboardingStatus,
  OnboardingStep,
  PasswordStrength,
} from './modules/onboarding';
```

## Session Storage Keys

The module uses the following session storage keys:

- `departmentName`: Department name
- `hasLogo`: Boolean indicating if logo was uploaded
- `logoData`: Base64-encoded logo image
- `navigationLayout`: Layout choice ('top' or 'left')
- `emailPlatform`: Email platform choice
- `emailConfig`: JSON-encoded email configuration
- `emailConfigMethod`: Email auth method ('oauth' or 'apppassword')
- `adminUser`: JSON-encoded admin user data

## API Integration

The onboarding wizard is designed to work with the backend API endpoints:

- `GET /api/v1/onboarding/status` - Check onboarding status
- `GET /api/v1/onboarding/security-check` - Verify security configuration
- `POST /api/v1/onboarding/organization` - Create organization
- `POST /api/v1/onboarding/admin-user` - Create admin user
- `POST /api/v1/onboarding/complete` - Complete onboarding

## Customization

### Adding New Steps

1. Create a new page component in `pages/`
2. Add the route in `routes.tsx`
3. Update the progress indicators
4. Add storage/validation utilities as needed

### Styling

The module uses Tailwind CSS with a consistent color scheme:

- Primary: Red/Orange gradient (`from-red-600 to-orange-600`)
- Background: Slate with red accent (`from-slate-900 via-red-900`)
- Borders: White with opacity (`border-white/20`)

### Icons

Icons are from Lucide React. To change:

```tsx
import { YourIcon } from 'lucide-react';

<OnboardingHeader icon={<YourIcon className="w-6 h-6 text-white" />} />
```

## Security Considerations

- Passwords are validated but NOT hashed client-side (hashing happens on backend)
- Session storage is cleared after successful onboarding
- Email credentials are sent over HTTPS to backend
- No sensitive data is logged to console in production

## Accessibility

- All forms have proper labels and ARIA attributes
- Color contrast meets WCAG AA standards
- Keyboard navigation supported throughout
- Screen reader friendly
- Focus indicators visible on all interactive elements

## Testing

To test the onboarding flow:

1. Clear session storage: `sessionStorage.clear()`
2. Navigate to `/`
3. Follow the wizard through all steps
4. Check that data persists across page reloads
5. Verify validation works correctly

## License

MIT License - Part of The Logbook project
