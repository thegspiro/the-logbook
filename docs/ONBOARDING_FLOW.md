# Onboarding Flow Navigation Guide

## Overview

This document describes the complete onboarding flow for The Logbook application, including all navigation paths, button actions, and API endpoints.

## Onboarding Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ONBOARDING FLOW                              │
└─────────────────────────────────────────────────────────────────────┘

  Start
    │
    v
┌──────────────────────┐
│  1. Welcome Page     │
│  Route: /            │
│  Animated intro with │
│  "Get Started" button│
│                      │
└──────────┬───────────┘
           │
           │ Button: "Get Started"
           v
┌──────────────────────┐
│ 2. Onboarding Check  │
│ Route: /onboarding   │
│ API: GET             │
│ /api/v1/onboarding/  │
│ status               │
└──────────┬───────────┘
           │
           │ If needs_onboarding = true
           v
┌──────────────────────────────┐
│ 3. Organization Setup        │
│ Route: /onboarding/start     │
│ API: POST /api/v1/onboarding/│
│ session/organization         │
│ Collects (comprehensive):    │
│ - Organization name & slug   │
│ - Organization type          │
│ - Timezone                   │
│ - Contact info (phone/email) │
│ - Mailing address            │
│ - Physical address           │
│ - Department identifiers     │
│   (FDID/State ID/Dept ID)    │
│ - Logo upload (optional)     │
│ COMMITS TO DATABASE          │
└──────────┬───────────────────┘
           │
           │ Button: "Continue" → Navigate to /onboarding/navigation-choice
           v
┌──────────────────────────────┐
│ 4. Navigation Choice         │
│ Route: /onboarding/          │
│ navigation-choice            │
│ Options:                     │
│ - Top Bar Navigation         │
│ - Left Sidebar Navigation    │
└──────────┬───────────────────┘
           │
           │ Button: "Continue" → Navigate to /onboarding/email-platform
           v
┌──────────────────────────────┐
│ 5. Email Platform Choice     │
│ Route: /onboarding/          │
│ email-platform               │
│ Options:                     │
│ - None (Skip)                │
│ - Google Workspace           │
│ - Microsoft 365              │
│ - SMTP (Generic)             │
└──────────┬───────────────────┘
           │
           ├─ If "None" → Navigate to /onboarding/file-storage
           │
           └─ If service selected → Navigate to /onboarding/email-config
                │
                v
           ┌──────────────────────────────┐
           │ 5a. Email Configuration      │
           │ Route: /onboarding/          │
           │ email-config                 │
           │ Collects platform-specific   │
           │ credentials                  │
           └──────────┬───────────────────┘
                      │
                      │ Button: "Continue" → Navigate to /onboarding/file-storage
                      │ Button: "Skip" → Navigate to /onboarding/file-storage
                      v
┌──────────────────────────────┐
│ 6. File Storage Choice       │
│ Route: /onboarding/          │
│ file-storage                 │
│ Options:                     │
│ - Local Storage              │
│ - AWS S3                     │
│ - Azure Blob Storage         │
│ - Google Cloud Storage       │
└──────────┬───────────────────┘
           │
           ├─ If "Local" → Navigate to /onboarding/authentication
           │
           └─ If cloud service → Navigate to /onboarding/file-storage-config
                │                  (Placeholder page)
                │
                v
           ┌──────────────────────────────┐
           │ 6a. File Storage Config      │
           │ Route: /onboarding/          │
           │ file-storage-config          │
           │ (Under development)          │
           └──────────┬───────────────────┘
                      │
                      │ Button: "Continue" → Navigate to /onboarding/authentication
                      v
┌──────────────────────────────┐
│ 7. Authentication Choice     │
│ Route: /onboarding/          │
│ authentication               │
│ Options:                     │
│ - Local (Username/Password)  │
│ - OAuth (Google/Microsoft)   │
│ - SAML                       │
│ - LDAP                       │
└──────────┬───────────────────┘
           │
           │ Button: "Continue" → Navigate to /onboarding/it-team
           v
┌──────────────────────────────┐
│ 8. IT Team & Backup Access   │
│ Route: /onboarding/it-team   │
│ API: POST                    │
│ /api/v1/onboarding/...       │
│ Collects IT contact info     │
└──────────┬───────────────────┘
           │
           │ Button: "Continue" → Navigate to /onboarding/roles
           v
┌──────────────────────────────┐
│ 9. Role Setup                │
│ Route: /onboarding/roles     │
│ API: POST                    │
│ /api/v1/onboarding/          │
│ session/roles                │
│ Two-tier permission model:   │
│ - View Access (read-only)    │
│ - Manage Access (full CRUD)  │
│ Role templates by category:  │
│ - Leadership (Chief, Pres)   │
│ - Officers (Captain, Lt)     │
│ - Administrative (Sec, Trs)  │
│ - Specialized (TO, Safety)   │
│ - Member (Regular members)   │
└──────────┬───────────────────┘
           │
           │ Button: "Continue" → Navigate to /onboarding/modules
           v
┌──────────────────────────────┐
│ 10. Module Overview          │
│ Route: /onboarding/modules   │
│ API: POST                    │
│ /api/v1/onboarding/          │
│ session/modules              │
│ Priority-based selection:    │
│ - Essential (Core modules)   │
│ - Recommended (Operations)   │
│ - Optional (Advanced)        │
└──────────┬───────────────────┘
           │
           │ Per Module:
           │ - "Enable & Configure" → Navigate to /onboarding/modules/{moduleId}/config
           │ - "Configure Later" → Mark as skipped
           │ - "Ignore" → Mark as ignored
           │
           │ When all modules processed:
           │ Button: "Continue to Admin Setup" → Navigate to /onboarding/admin-user
           v
┌──────────────────────────────┐
│ 11. Admin User Creation      │
│ Route: /onboarding/          │
│ admin-user                   │
│ API: POST                    │
│ /api/v1/onboarding/          │
│ admin-user                   │
│ Collects:                    │
│ - Username                   │
│ - Email                      │
│ - Password (12+ chars)       │
│ - First/Last Name            │
│ - Badge Number (optional)    │
└──────────┬───────────────────┘
           │
           │ Button: "Create Admin & Complete Setup"
           │ API: POST /api/v1/onboarding/complete
           │
           v
┌──────────────────────────────┐
│ 12. Dashboard                │
│ Route: /dashboard            │
│ Onboarding Complete!         │
└──────────────────────────────┘
```

## Page-by-Page Navigation Details

### 1. Welcome Page (`/`)
**Purpose**: First landing page with animated introduction

**Animation**: Title appears after 300ms, body content after 800ms (quick fade-in so users aren't waiting on a blank screen).

**Navigation**:
- Button: "Get Started" → `/onboarding`

**No API calls**

---

### 2. Onboarding Check (`/onboarding`)
**Purpose**: Checks if onboarding is needed

**API Call**:
```
GET /api/v1/onboarding/status
Response: {
  needs_onboarding: boolean,
  is_completed: boolean,
  current_step: number,
  total_steps: number
}
```

**Navigation**:
- If `needs_onboarding = true` → `/onboarding/start`
- If `needs_onboarding = false` → `/login`

---

### 3. Organization Setup (`/onboarding/start`)
**Purpose**: Collect comprehensive organization information and commit to database

**Form Sections** (collapsible):

1. **Basic Information** (required):
   - Organization Name
   - URL Slug (auto-generated)
   - Description (optional)
   - Organization Type: `fire_department`, `ems_only`, `fire_ems_combined`
   - Timezone

2. **Contact Information**:
   - Phone Number
   - Fax Number
   - Email Address
   - Website URL

3. **Mailing Address** (required):
   - Street Address (line 1 & 2)
   - City, State, ZIP Code
   - Country

4. **Physical Address**:
   - Checkbox: "Same as mailing address"
   - If different: Full address fields

5. **Department Identifiers**:
   - Identifier Type: `FDID`, `State ID`, or `Department ID`
   - Corresponding ID field based on selection

6. **Additional Information**:
   - County/Jurisdiction
   - Year Founded
   - Tax ID (EIN)

7. **Organization Logo**:
   - Drag-and-drop upload
   - Supports PNG, JPG, WebP (max 5MB)

**API Call**:
```
POST /api/v1/onboarding/session/organization
Body: {
  name: string,
  slug?: string,
  description?: string,
  organization_type: "fire_department" | "ems_only" | "fire_ems_combined",
  timezone: string,
  phone?: string,
  fax?: string,
  email?: string,
  website?: string,
  mailing_address: {
    line1: string,
    line2?: string,
    city: string,
    state: string,
    zip_code: string,
    country?: string
  },
  physical_address_same: boolean,
  physical_address?: { ... },  // Same structure as mailing_address
  identifier_type: "fdid" | "state_id" | "department_id",
  fdid?: string,
  state_id?: string,
  department_id?: string,
  county?: string,
  founded_year?: number,
  tax_id?: string,
  logo?: string  // Base64 data URL
}
Response: {
  id: string,
  name: string,
  slug: string,
  organization_type: string,
  timezone: string,
  active: boolean,
  created_at: string
}
```

**Important**: Organization is committed to database at this step (Step 1 of backend flow).

**Navigation**:
- Button: "Continue" → `/onboarding/navigation-choice`

**Data Storage**:
- Database (organization table)
- Zustand store (department name, logo for other components)

---

### 4. Navigation Choice (`/onboarding/navigation-choice`)
**Purpose**: Choose navigation layout

**Options**:
- Top Bar Navigation (horizontal)
- Left Sidebar Navigation (vertical)

**Navigation**:
- Button: "Continue" → `/onboarding/email-platform`

**Data Storage**: Zustand store (persisted to localStorage)
- `navigationLayout` = "top" | "left"

---

### 5. Email Platform Choice (`/onboarding/email-platform`)
**Purpose**: Select email service provider

**Options**:
- None (Skip email integration)
- Google Workspace
- Microsoft 365
- SMTP (Generic)

**Navigation**:
- If "None" → `/onboarding/file-storage`
- If service selected → `/onboarding/email-config`

**Data Storage**: Zustand store (persisted to localStorage)
- `emailPlatform` = "none" | "google" | "microsoft" | "smtp"

---

### 5a. Email Configuration (`/onboarding/email-config`)
**Purpose**: Configure selected email service

**Form Fields** (varies by platform):

**Google Workspace**:
- Client ID
- Client Secret
- OAuth Redirect URI

**Microsoft 365**:
- Tenant ID
- Client ID
- Client Secret

**SMTP**:
- SMTP Host
- SMTP Port
- Username
- Password
- From Email
- Use TLS/SSL

**API Call**:
```
POST /api/v1/onboarding/notifications
Body: {
  email_enabled: boolean,
  smtp_host?: string,
  smtp_port?: number,
  smtp_user?: string,
  smtp_from_email?: string
}
```

**Navigation**:
- Button: "Save & Continue" → `/onboarding/file-storage`
- Button: "Skip for Now" → `/onboarding/file-storage`

---

### 6. File Storage Choice (`/onboarding/file-storage`)
**Purpose**: Choose file storage backend

**Options**:
- Local Storage (server filesystem)
- AWS S3
- Azure Blob Storage
- Google Cloud Storage

**Navigation**:
- If "Local Storage" → `/onboarding/authentication`
- If cloud service → `/onboarding/file-storage-config`

**Data Storage**: Zustand store (persisted to localStorage)
- `fileStoragePlatform` = "local" | "s3" | "azure" | "gcs"

---

### 6a. File Storage Configuration (`/onboarding/file-storage-config`)
**Purpose**: Configure cloud storage credentials

**Status**: Placeholder page (under development)

**Navigation**:
- Button: "Continue to Authentication" → `/onboarding/authentication`

---

### 7. Authentication Choice (`/onboarding/authentication`)
**Purpose**: Choose authentication method

**Options**:
- Local (Username/Password)
- OAuth 2.0 (Google, Microsoft)
- SAML (Enterprise SSO)
- LDAP (Active Directory)

**Navigation**:
- Button: "Continue" → `/onboarding/it-team`

**Data Storage**: Zustand store (persisted to localStorage)
- `authPlatform` = "local" | "oauth" | "saml" | "ldap"

---

### 8. IT Team & Backup Access (`/onboarding/it-team`)
**Purpose**: Configure IT team contact and backup access

**Form Fields**:
- IT Contact Email (optional)
- IT Contact Phone (optional)
- Enable Backup Access (checkbox)
- Backup Access Email (if enabled)

**API Call**:
```
POST /api/v1/onboarding/session/it-team
Body: {
  it_team: [{ name, email, phone, role }],
  backup_access: {
    email: string,
    phone: string,
    secondary_admin_email?: string
  }
}
```

**Navigation**:
- Button: "Continue" → `/onboarding/roles`

---

### 9. Role Setup (`/onboarding/roles`)
**Purpose**: Configure roles and permissions using a two-tier model

**Two-Tier Permission Model**:
- **View Access**: Read-only access to module data (all members typically)
- **Manage Access**: Full CRUD operations (selected roles only)

**Role Categories**:
- **Leadership**: Chief, President, Assistant Chief, Vice President
- **Officers**: Captain, Lieutenant
- **Administrative**: Secretary, Treasurer
- **Specialized**: Training Officer, Safety Officer, Quartermaster
- **Member**: Regular member access

**Features**:
- Pre-configured role templates by category
- Permissions auto-generated from module registry
- Custom role creation support
- Priority-based role ordering (0-100)

**API Call**:
```
POST /api/v1/onboarding/session/roles
Body: {
  roles: [{
    id: string,
    name: string,
    description?: string,
    priority: number,
    permissions: Record<string, { view: boolean, manage: boolean }>,
    is_custom?: boolean
  }]
}
```

**Navigation**:
- Button: "Continue to Module Selection" → `/onboarding/modules`

---

### 10. Module Overview (`/onboarding/modules`)
**Purpose**: Select and configure optional modules

**Module Categories**:

**Essential (Core)**:
- Member Management
- Events & RSVP
- Documents & Files

**Recommended (Operations)**:
- Training & Certifications
- Equipment & Inventory
- Scheduling & Shifts

**Recommended (Governance)**:
- Elections & Voting
- Compliance & Auditing

**Optional (Communication)**:
- Notifications & Alerts
- Mobile App
- Forms & Surveys
- Integrations

**Per-Module Actions**:
- "Enable & Configure" → `/onboarding/modules/{moduleId}/config`
- "Configure Later" → Mark as "skipped"
- "Ignore" → Mark as "ignored"

**API Call**:
```
POST /api/v1/onboarding/modules
Body: {
  enabled_modules: string[]
}
```

**Navigation**:
- Button: "Continue to Admin Setup" → `/onboarding/admin-user`

---

### 10a. Module Configuration Template (`/onboarding/modules/{moduleId}/config`)
**Purpose**: Configure individual module settings with two-tier permissions

**Features**:
- View Access configuration (typically all members)
- Manage Access role selection
- Module-specific permission descriptions
- Auto-populated from module registry

**Navigation**:
- Button: "Save Configuration" → `/onboarding/modules`
- Button: "Skip Configuration" → `/onboarding/modules`

---

### 11. Admin User Creation (`/onboarding/admin-user`)
**Purpose**: Create the first administrator account

**Form Fields**:
- Username (required, min 3 chars)
- Email (required, valid email)
- Password (required, min 12 chars)
- Confirm Password (must match)
- First Name (required)
- Last Name (required)
- Badge Number (optional)

**Validation**:
- Username: alphanumeric, hyphens, underscores only
- Password: minimum 12 characters
- Passwords must match

**API Calls**:
```
1. POST /api/v1/onboarding/organization
   (if not already created)

2. POST /api/v1/onboarding/admin-user
   Body: {
     username: string,
     email: string,
     password: string,
     password_confirm: string,
     first_name: string,
     last_name: string,
     badge_number?: string
   }

3. POST /api/v1/onboarding/complete
   Body: {
     notes?: string
   }
```

**Navigation**:
- Button: "Create Admin & Complete Setup" → `/dashboard`

---

### 12. Dashboard (`/dashboard`)
**Purpose**: Main application dashboard

**Status**: Onboarding complete!

**Features Available**:
- All enabled modules
- User profile
- Settings (Organization, Role Management, Member Admin)
- Full application access

**Post-Onboarding Settings Navigation**:
- `/settings` - Organization settings
- `/settings/roles` - Role management (create/edit/delete roles)
- `/admin/members` - Member administration (assign roles)

---

## Backend API Endpoints

### Onboarding Status
```
GET /api/v1/onboarding/status
```
Returns current onboarding status and progress.

### Start Onboarding
```
POST /api/v1/onboarding/start
```
Initializes onboarding tracking.

### System Information
```
GET /api/v1/onboarding/system-info
```
Returns app version, security features, configuration.

### Security Check
```
GET /api/v1/onboarding/security-check
```
Verifies security configuration (SECRET_KEY, ENCRYPTION_KEY, etc.).

### Database Check
```
GET /api/v1/onboarding/database-check
```
Tests database connectivity.

### Create Organization (Legacy)
```
POST /api/v1/onboarding/organization
Body: {
  name: string,
  slug: string,
  organization_type: string,
  timezone: string,
  description?: string
}
```
Creates the first organization with default roles (simple version).

### Create Organization (Comprehensive - Step 1)
```
POST /api/v1/onboarding/session/organization
Body: {
  name: string,
  slug?: string,
  description?: string,
  organization_type: "fire_department" | "ems_only" | "fire_ems_combined",
  timezone: string,
  phone?: string,
  fax?: string,
  email?: string,
  website?: string,
  mailing_address: { line1, line2?, city, state, zip_code, country? },
  physical_address_same: boolean,
  physical_address?: { ... },
  identifier_type: "fdid" | "state_id" | "department_id",
  fdid?: string,
  state_id?: string,
  department_id?: string,
  county?: string,
  founded_year?: number,
  tax_id?: string,
  logo?: string
}
```
Creates organization with comprehensive details and commits to database immediately.

### Create Admin User
```
POST /api/v1/onboarding/admin-user
Body: {
  username: string,
  email: string,
  password: string,
  password_confirm: string,
  first_name: string,
  last_name: string,
  badge_number?: string
}
```
Creates administrator user with Super Admin role.

### Configure Modules
```
POST /api/v1/onboarding/session/modules
Body: {
  modules: string[]
}
```
Saves enabled module configuration.

### Configure Roles
```
POST /api/v1/onboarding/session/roles
Body: {
  roles: [{
    id: string,
    name: string,
    description?: string,
    priority: number,
    permissions: Record<string, { view: boolean, manage: boolean }>,
    is_custom?: boolean
  }]
}
```
Configures roles with two-tier permissions during onboarding.

### Configure Notifications
```
POST /api/v1/onboarding/notifications
Body: {
  email_enabled: boolean,
  smtp_host?: string,
  smtp_port?: number,
  smtp_user?: string,
  smtp_from_email?: string,
  sms_enabled: boolean,
  twilio_account_sid?: string,
  twilio_phone_number?: string
}
```
Configures email and SMS settings.

### Complete Onboarding
```
POST /api/v1/onboarding/complete
Body: {
  notes?: string
}
```
Marks onboarding as finished.

### Post-Onboarding Checklist
```
GET /api/v1/onboarding/checklist
```
Returns recommended tasks after onboarding.

### Mark Checklist Item Complete
```
PATCH /api/v1/onboarding/checklist/{item_id}/complete
```
Marks a checklist item as done.

---

## Client-Side Data Persistence

The onboarding flow uses a **Zustand store** persisted to `localStorage` (key: `onboarding-storage`). This replaced the earlier `sessionStorage` approach to support persistence across tabs and page refreshes.

**Persisted state** (in localStorage under `onboarding-storage`):
```javascript
{
  "state": {
    // Department Info
    "departmentName": "Fire Department Name",
    "logoData": "data:image/png;base64,...",   // or null
    "navigationLayout": "top",                  // "top" | "left"

    // Email
    "emailPlatform": "gmail",                   // "gmail" | "microsoft" | "selfhosted" | "other" | null
    "emailConfigured": false,

    // File Storage
    "fileStoragePlatform": "local",             // "local" | "s3" | "azure" | "gcs" | null

    // Authentication
    "authPlatform": "local",                    // "local" | "oauth" | "saml" | "ldap" | null

    // IT Team
    "itTeamConfigured": false,
    "itTeamMembers": [{ "id": "1", "name": "", "email": "", "phone": "", "role": "Primary IT Contact" }],
    "backupEmail": "",
    "backupPhone": "",
    "secondaryAdminEmail": "",

    // Modules
    "selectedModules": ["members", "events"],
    "moduleStatuses": { "members": "enabled", "training": "skipped" },

    // Progress
    "currentStep": 1,
    "completedSteps": ["organization"],
    "lastSaved": "2026-02-06T12:00:00.000Z"
  }
}
```

**Not persisted** (excluded from localStorage for security):
- `sessionId` — stored separately in localStorage as `onboarding_session_id`
- `csrfToken` — stored separately in localStorage as `csrf_token`
- `errors` — only kept in memory

**Legacy compatibility**: The `syncWithSessionStorage()` function in the store reads from `sessionStorage` on first load if the Zustand store is empty, migrating any data from the older approach.

---

## Error Handling

All onboarding pages include:
- Form validation with clear error messages
- API error handling with toast notifications
- Redirect to `/onboarding/start` if department info is missing
- Graceful fallbacks for API failures

### API Error Messages
The API client maps HTTP status codes to user-friendly messages:
- **429**: "Too many requests. Please wait a moment before trying again."
- **403**: "Security validation failed. Please refresh the page and try again."
- **422**: Shows the server's validation detail, or "Invalid data submitted. Please check your input and try again."
- **409**: Shows server detail, or "This record already exists. Please check for duplicates."
- **500**: "A server error occurred. Please try again or check the server logs."
- **503**: "The server is temporarily unavailable. It may still be starting up — please try again shortly."
- **Network errors**: "Unable to reach the server. Please verify the backend is running and check your network connection."
- **Email test timeout**: "Email connection test timed out after 30 seconds." (returned when mail server is unreachable)

### Backend Security Notes

The following middleware and security features affect onboarding:

**Access & Network:**
- **GeoIP Blocking**: The `IPBlockingMiddleware` blocks requests from countries in the `BLOCKED_COUNTRIES` configuration. Onboarding endpoints (`/api/v1/onboarding/*`) are **exempt** from geo-blocking since first-time setup must be accessible before any configuration exists. Other API endpoints remain subject to geo-blocking.
- **CSRF Protection**: Session endpoints require a valid `X-CSRF-Token` header that matches the token stored in the server-side session. The token is generated during `POST /start` and returned in the response header.
- **Reset Protection**: The `POST /reset` endpoint is blocked after onboarding completes. It only works while onboarding is still in progress (`needs_onboarding` returns `True`).
- **Email Test Timeout**: SMTP connection tests have a 30-second timeout to prevent indefinite hangs if a mail server is unreachable or firewalled.

**Data Protection:**
- **Sensitive Data Encryption**: Email passwords, API keys, and file storage credentials submitted during onboarding are encrypted (AES-256 via Fernet) before being stored in the session database. Only the platform type is stored in plain text.
- **No Passwords in Logs**: Temporary passwords are never written to application logs. The `users.py` endpoint only logs that a welcome email was requested.
- **Sanitized Error Responses**: API 500 errors return generic messages (`"Please check the server logs"`) instead of raw exception strings. This prevents leaking database schema, SQL queries, or internal paths to clients.
- **Health Endpoint Sanitized**: The `/health` endpoint reports service status (`"connected"`, `"disconnected"`, `"error"`) without exposing raw error messages or infrastructure details.

**Authentication Hardening:**
- **Uniform Auth Failure Messages**: Authentication failure logs do not reveal whether the failure was due to "user not found", "invalid password", or "no password set". All pre-verification failures log `"Authentication failed for login attempt"` and post-verification failures log `"Authentication failed: invalid credentials"`. This prevents username enumeration via log analysis.
- **Account lockout events** still log the username (needed for security incident response).

**Frontend Security:**
- **Production Console Logging**: The onboarding store's error logging is restricted in production — only the step name and error message are logged. Full details (error context, user information) are only visible in development mode (`import.meta.env.DEV`).
- **Per-Session Obfuscation Key**: The frontend obfuscation utility generates a random per-session key via `crypto.getRandomValues()` instead of using a hardcoded default. This ensures each browser session has a unique key.
- **Environment File Protection**: `.env` files are excluded from version control via `.gitignore`.

---

## Navigation Consistency

✅ **All "Next" buttons verified**:
- Each page properly navigates to the next step
- No broken links or undefined routes
- Proper state validation before proceeding

✅ **All API endpoints verified**:
- Backend has comprehensive onboarding API
- Pydantic validation for all request bodies
- Proper error responses with detailed messages

✅ **All data persistence verified**:
- Zustand store (localStorage) for frontend state
- Database for backend data (organization committed at Step 1)
- Proper cleanup after onboarding complete

---

## Testing the Flow

To test the complete onboarding flow:

1. **Start fresh**:
   ```bash
   # Clear onboarding data in browser console
   localStorage.removeItem('onboarding-storage')
   localStorage.removeItem('onboarding_session_id')
   localStorage.removeItem('csrf_token')

   # Reset database (if testing backend)
   alembic downgrade base
   alembic upgrade head
   ```

2. **Navigate to** `http://localhost:5173/`

3. **Follow the flow**:
   - Welcome → Onboarding Check → Department Info → ...
   - Verify each "Continue" button works
   - Verify data persists between pages
   - Verify API calls succeed

4. **Complete setup**:
   - Create admin user
   - Verify redirect to dashboard
   - Verify onboarding status = completed

---

## Production Checklist

Before deploying to production:

- [ ] Update `VITE_SESSION_KEY` to random 32-character string
- [ ] Update `SECRET_KEY` in backend .env
- [ ] Update `ENCRYPTION_KEY` in backend .env
- [ ] Configure production database credentials
- [ ] Enable HTTPS (onboarding checks for secure context)
- [ ] Test complete flow end-to-end
- [ ] Verify all API endpoints are secure
- [ ] Review CORS settings
- [ ] Enable rate limiting
- [ ] Configure backup and disaster recovery

---

**Last Updated**: February 6, 2026 (Updated storage references, error handling, Welcome page timing, security check details)
