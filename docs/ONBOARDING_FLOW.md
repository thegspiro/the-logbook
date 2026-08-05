# Onboarding Flow Navigation Guide

## Overview

This document describes the complete onboarding flow for The Logbook application, including all navigation paths, button actions, and API endpoints.

## Onboarding Flow Diagram

```
  /  Welcome
  │      "Get Started"
  v
  /onboarding  OnboardingCheck
  │      GET /api/v1/onboarding/status
  │      needs_onboarding = false → /login
  v
┌─ 1. Organization Setup ──────────────── /onboarding/start
│  POST /onboarding/session/organization
│  Name, type, timezone, contact info, mailing + physical address,
│  department identifiers (FDID / State ID / Dept ID), logo.
│  COMMITS the organization, and creates the HQ Facility + Location
│  from the department address.
└─ v
┌─ 2. Stations ────────────────────────── /onboarding/stations
│  POST /onboarding/session/stations
│  Stations beyond HQ. Skippable — many departments have one.
│  CREATES Facility + Location per station.
└─ v
┌─ 3. Apparatus ───────────────────────── /onboarding/apparatus
│  POST /onboarding/session/apparatus
│  Unit number, type, minimum staffing, riding positions. Skippable.
│  CREATES BasicApparatus per unit.
└─ v
┌─ 4. Navigation Choice ───────────────── /onboarding/navigation-choice
│  Top bar or left sidebar. Stored in the Zustand store.
└─ v
┌─ 5. Email Platform ──────────────────── /onboarding/email-platform
│  None / Google Workspace / Microsoft 365 / SMTP / Cloudflare
│  "None" skips ahead to file storage.
└─ v
┌─ 5a. Email Configuration ────────────── /onboarding/email-config
│  POST /onboarding/session/email  (credentials encrypted server-side)
│  POST /onboarding/test/email     (verifies the connection)
└─ v
┌─ 6. File Storage Choice ─────────────── /onboarding/file-storage
│  Local / Google Drive / OneDrive / S3
└─ v
┌─ 6a. File Storage Configuration ─────── /onboarding/file-storage-config
│  POST /onboarding/session/file-storage  (secrets encrypted server-side)
│  Per-platform credential form. Skipping stores the platform choice
│  without credentials rather than discarding the step.
└─ v
┌─ 7. Authentication Choice ───────────── /onboarding/authentication
│  Local password / Google / Microsoft / Authentik
└─ v
┌─ 8. System Owner ────────────────────── /onboarding/system-owner
│  POST /onboarding/system-owner
│  Username, email, password (12+ chars), name, membership number.
│  Sets the auth cookies — the admin is signed in from here on.
└─ v
┌─ 9. IT Team & Backup Access ─────────── /onboarding/it-team
│  POST /onboarding/session/it-team
│  IT contacts and backup access. Contacts become user accounts at
│  completion, with must_change_password set.
└─ v
┌─ 10. Positions ──────────────────────── /onboarding/positions
│  POST /onboarding/session/roles
│  Two-tier permission model (view / manage) across position templates:
│  leadership, officers, administrative, specialized, member.
└─ v
┌─ 11. Module Overview ────────────────── /onboarding/modules
│  POST /onboarding/session/modules, then POST /onboarding/complete
│  Per module: "Enable & Configure" → /onboarding/modules/{id}/config,
│  "Configure Later", or "Ignore".
└─ v
┌─ 12. Setup Complete ─────────────────── /onboarding/complete
│  Summary of what was configured, plus what still needs the
│  department's real data.
│  Primary action → /setup (Department Setup checklist)
│  Secondary     → /dashboard
└─ done
```

> **Step ordering:** the System Owner is created at step 8, right after the
> authentication choice — not at the end. The IT team, positions, and module
> steps all run against an authenticated session.


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

> **Login page guard (2026-06-25):** `/login` enforces the same check itself, so
> it can't be reached directly on an unconfigured install. On mount the login
> page calls `GET /api/v1/onboarding/status`; when `needs_onboarding = true` it
> redirects to `/onboarding` (showing a brief spinner during the check) rather
> than rendering the sign-in form. If the status endpoint can't be reached, the
> login page renders normally as a fallback.

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
- Button: "Continue" → `/onboarding/stations`

**Data Storage**:
- Database (organization table, plus the HQ Facility and Location)
- Zustand store (department name, logo for other components)

---

### 4. Stations (`/onboarding/stations`)
**Purpose**: Capture stations beyond headquarters

Headquarters is already created from the department address during
Organization Setup, so this step collects the *other* stations. Without it, a
multi-station department has to find the Facilities module on its own after
setup.

**Form Fields** (per station, repeatable):
- Station Name (required)
- Station Number
- Street Address, City, State, ZIP Code
- Phone, Email

**API Call**:
```
POST /api/v1/onboarding/session/stations
Body: {
  stations: [{
    name: string,
    station_number?: string,
    address?: string,
    city?: string,
    state?: string,
    zip_code?: string,
    phone?: string,
    email?: string
  }]
}
```

Creates a `Facility` and a linked `Location` per station. The session records
the created facility ids, so returning to this step replaces its own rows
instead of appending duplicates.

**Navigation**:
- Button: "Continue" → `/onboarding/apparatus`
- Button: "Skip — one station only" → `/onboarding/apparatus` (clears any
  stations a previous pass created)

---

### 5. Apparatus (`/onboarding/apparatus`)
**Purpose**: Capture apparatus for shift staffing

**Form Fields** (per apparatus, repeatable):
- Unit Number (required)
- Name
- Type (engine, ladder, rescue, ambulance, tanker, brush, command, utility, other)
- Minimum Staffing (1–20)
- Riding Positions (common ones offered as one-click adds; free text allowed)

**API Call**:
```
POST /api/v1/onboarding/session/apparatus
Body: {
  apparatus: [{
    unit_number: string,
    name?: string,
    apparatus_type: string,
    min_staffing: number,
    positions: string[]
  }]
}
```

Creates `BasicApparatus` records — the lightweight shape shift scheduling
needs. Departments that enable the full Apparatus module later get maintenance
history and inventory on top of these.

**Navigation**:
- Button: "Continue" → `/onboarding/navigation-choice`
- Button: "Skip for now" → `/onboarding/navigation-choice`

---

### 6. Navigation Choice (`/onboarding/navigation-choice`)
**Purpose**: Choose navigation layout

**Options**:
- Top Bar Navigation (horizontal)
- Left Sidebar Navigation (vertical)

**Navigation**:
- Button: "Continue" → `/onboarding/email-platform`

**Data Storage**: Zustand store (persisted to localStorage)
- `navigationLayout` = "top" | "left"

---

### 7. Email Platform Choice (`/onboarding/email-platform`)
**Purpose**: Select email service provider

**Options**:
- None (Skip email integration)
- Google Workspace
- Microsoft 365
- SMTP (Generic)
- Cloudflare Email Service

**Navigation**:
- If "None" → `/onboarding/file-storage`
- If service selected → `/onboarding/email-config`

**Data Storage**: Zustand store (persisted to localStorage)
- `emailPlatform` = "none" | "gmail" | "microsoft" | "selfhosted" | "cloudflare" | "other"

---

### 7a. Email Configuration (`/onboarding/email-config`)
**Purpose**: Configure selected email service

**Form Fields** (varies by platform):

**Google Workspace**:
- Client ID
- Client Secret
- OAuth Redirect URI
- App Password (alternative to OAuth)

**Microsoft 365**:
- Tenant ID
- Client ID
- Client Secret

**SMTP (Self-Hosted)**:
- SMTP Host
- SMTP Port
- Encryption (TLS/SSL/None)
- Username
- Password
- From Email
- From Name

**Cloudflare Email Service**:
- Account ID (32-character hex string from Cloudflare dashboard)
- API Token (created with email sending permission)
- From Email
- From Name

**Common fields** (all platforms):
- From Email Address
- From Name

**API Call** (test connection):
```
POST /api/v1/onboarding/test-email
Body: {
  platform: "gmail" | "microsoft" | "selfhosted" | "cloudflare" | "other",
  config: { ...platform-specific fields... }
}
```

**API Call** (save config):
```
POST /api/v1/onboarding/save-email-config
Body: {
  platform: "gmail" | "microsoft" | "selfhosted" | "cloudflare" | "other",
  config: { ...platform-specific fields... }
}
```

**Data path**: Config is encrypted server-side (AES-256-GCM), stored in the onboarding session, and persisted to the organization's `settings.email_service` JSON column on completion. Secret fields (`cloudflare_api_token`, `smtp_password`, etc.) are prefixed with `enc:` before storage.

**Navigation**:
- Button: "Save & Continue" → `/onboarding/file-storage`
- Button: "Skip for Now" → `/onboarding/file-storage`

---

### 8. File Storage Choice (`/onboarding/file-storage`)
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

### 8a. File Storage Configuration (`/onboarding/file-storage-config`)
**Purpose**: Collect cloud storage credentials

Renders a per-platform credential form (Google Drive, OneDrive/SharePoint,
Amazon S3, or a local storage path). Secrets are encrypted with AES-256 before
being written to the session, and are persisted into
`Organization.settings.file_storage` at completion.

**API Call**:
```
POST /api/v1/onboarding/session/file-storage
Body: {
  platform: "googledrive" | "onedrive" | "s3" | "local" | "other",
  config: { ...platform-specific credentials }
}
```

**Navigation**:
- Button: "Save & Continue" → `/onboarding/authentication`
- Button: "I'll add these later" → `/onboarding/authentication` (stores the
  platform choice with no credentials, so Settings shows what is missing)

---

### 9. Authentication Choice (`/onboarding/authentication`)
**Purpose**: Choose authentication method

**Options**:
- Local (Username/Password)
- OAuth 2.0 (Google, Microsoft) — **link-existing only** (see
  "OAuth Sign-In Buttons" below); OAuth never creates new accounts
- SAML (Enterprise SSO)
- LDAP (Active Directory)

**Navigation**:
- Button: "Continue" → `/onboarding/it-team`

**Data Storage**: Zustand store (persisted to localStorage)
- `authPlatform` = "local" | "oauth" | "saml" | "ldap"

---

### 10. System Owner (`/onboarding/system-owner`)
**Purpose**: Create the first administrator account

This runs here — right after the authentication choice — not at the end of the
wizard. Everything after it (IT team, positions, modules, completion) executes
against an authenticated session, because this endpoint sets the auth cookies.

**Form Fields**:
- Username (required, min 3 chars)
- Email (required, valid email)
- Password (required, min 12 chars)
- Confirm Password (must match)
- First Name (required)
- Last Name (required)
- Membership Number (optional)

**Validation**:
- Username: alphanumeric, hyphens, underscores only
- Password: minimum 12 characters
- Passwords must match

**API Call**:
```
POST /api/v1/onboarding/system-owner
Body: {
  username: string,
  email: string,
  password: string,
  password_confirm: string,
  first_name: string,
  last_name: string,
  membership_number?: string
}
```

Auth tokens are set as httpOnly cookies; the response's `authenticated` flag
tells the frontend to set `has_session`.

**Navigation**:
- Button: "Continue" → `/onboarding/it-team`

---

### 11. IT Team & Backup Access (`/onboarding/it-team`)
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

### 12. Positions (`/onboarding/positions`)
**Purpose**: Configure roles and permissions using a two-tier model

**Two-Tier Permission Model**:
- **View Access**: Read-only access to module data (all members typically)
- **Manage Access**: Full CRUD operations (selected roles only)

**Role Categories** (16 system roles):
- **Leadership**: IT Administrator, Chief, President, Assistant Chief, Vice President
- **Administrative**: Secretary, Assistant Secretary, Quartermaster
- **Operational**: Officers, Training Officer, Public Outreach Coordinator, Meeting Hall Coordinator
- **Specialized**: Membership Coordinator, Communications Officer, Apparatus Manager
- **Base**: Member

**Features**:
- Pre-configured role templates by category
- Permissions auto-generated from module registry
- Custom role creation support
- Priority-based role ordering (0-100)

> **Operational Ranks group (EMT added 2026-06-25):** The position templates
> include an **Operational Ranks** group — Fire Chief, Deputy Chief, Assistant
> Chief, Captain, Lieutenant, Engineer/Driver Operator, Firefighter, and **EMT** —
> mirroring the default operational ranks seeded for the organization. EMT was
> previously absent from this list even though the backend already seeded it as a
> default rank.

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

### 13. Module Overview (`/onboarding/modules`)
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

> **Enabled-state visibility (2026-06-25):** Once an optional module is enabled,
> its action button turns solid green with a checkmark and reads **"Enabled"**,
> and the module card gains a green border/ring — so it's obvious which optional
> modules are active rather than relying on a small status icon. The control
> exposes `aria-pressed` for screen readers.

**API Calls**:
```
1. POST /api/v1/onboarding/session/modules
   Body: { modules: string[] }

2. POST /api/v1/onboarding/complete
   Body: { notes?: string }
```

This is where onboarding is finalized. `/complete` persists the session's IT
team, email, file storage, auth, and module settings into
`Organization.settings`, seeds default data, and marks setup done.

**Navigation**:
- Button: "Continue" → `/onboarding/complete` (after the auth store reloads,
  so the completion screen can link into the protected `/setup` route)

---

### 13a. Module Configuration Template (`/onboarding/modules/{moduleId}/config`)
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

### 14. Setup Complete (`/onboarding/complete`)
**Purpose**: Close the wizard and hand off to the department setup checklist

Reached after `POST /api/v1/onboarding/complete` succeeds. The wizard used to
navigate straight to `/dashboard`, which for a brand-new department is an empty
page — no members, no stations, no events — with nothing explaining what to do
next.

**Shows**:
- What was configured: modules enabled, positions defined, sign-in method,
  email platform, file storage, IT contacts
- What is left: roster and member sign-ins, stations and apparatus, SOPs and
  policies, first event

**Navigation**:
- Primary: "Go to Department Setup" → `/setup`
- Secondary: "Skip to Dashboard" → `/dashboard`

---

### Department Setup (`/setup`)
**Purpose**: Track the remaining setup work after the wizard

Backed by `GET /api/v1/organization/setup-checklist`, which derives completion
from live entity counts rather than a static list. Reachable from both
navigation components and surfaced as a progress card on the admin dashboard
while any step is outstanding.

**Essential items**: members, roles, apparatus, stations/locations,
organization settings, enabled modules, member sign-ins, SOPs and policies,
first event, and MFA.

**Module items** appear only when the module is enabled: shift templates,
training courses and requirements, inventory categories, custom forms, verified
email delivery, prospective-members pipeline, and integrations.

Items are either `kind: "auto"` (derived from entity counts) or `kind:
"review"` (`org_settings`, `modules` — no measurable signal, completed by the
admin acknowledging them via
`POST /api/v1/organization/setup-checklist/{item_key}/acknowledge`).

**Branding Transfer**: Organization name and logo are passed from onboarding to
the main application layout via sessionStorage keys `departmentName` and
`logoData`. The AppLayout component reads these on mount, with a fallback to
`GET /api/v1/auth/branding` if not cached.

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
POST /api/v1/onboarding/system-owner
Body: {
  username: string,
  email: string,
  password: string,
  password_confirm: string,
  first_name: string,
  last_name: string,
  membership_number?: string
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

### Configure Stations
```
POST /api/v1/onboarding/session/stations
Body: {
  stations: [{
    name: string,
    station_number?: string,
    address?: string,
    city?: string,
    state?: string,
    zip_code?: string,
    phone?: string,
    email?: string
  }]
}
```
Creates Facility + Location records for stations beyond headquarters.
Re-submitting replaces the rows this step created rather than appending.

### Configure Apparatus
```
POST /api/v1/onboarding/session/apparatus
Body: {
  apparatus: [{
    unit_number: string,
    name?: string,
    apparatus_type: string,
    min_staffing: number,
    positions: string[]
  }]
}
```
Creates BasicApparatus records for shift staffing. Same replace-my-own-rows
behavior as stations.

### Department Setup Checklist (post-onboarding)
```
GET  /api/v1/organization/setup-checklist
POST /api/v1/organization/setup-checklist/{item_key}/acknowledge?acknowledged=true
```
Lives in the organization API, not onboarding. Completion is derived from live
entity counts; the `acknowledge` endpoint only accepts `kind: "review"` items
(`org_settings`, `modules`), which have no measurable signal.

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
    "emailPlatform": "gmail",                   // "gmail" | "microsoft" | "selfhosted" | "cloudflare" | "other" | null
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

    // Roles (persisted across navigation)
    "rolesConfig": {
      "role-id": {
        "id": "role-id",
        "name": "Chief",
        "slug": "chief",
        "description": "...",
        "priority": 95,
        "icon": "Shield",             // Serialized icon name (not React component)
        "permissions": { "members": { "view": true, "manage": true }, ... },
        "isSystem": true,
        "isEnabled": true
      }
    },

    // Module Permission Configs (persisted across navigation)
    "modulePermissionConfigs": {
      "training": ["chief-id", "training_officer-id"],   // Role IDs that can manage each module
      "inventory": ["chief-id", "quartermaster-id"]
    },

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

#### Role Config Persistence

The `rolesConfig` field stores all role configurations (system and custom) so that navigating away from the Role Setup page and back does not reset permissions to defaults. Key implementation details:

- **Icon Serialization**: React icon components (e.g., `Shield`, `UserCog`) cannot be stored in localStorage. An `ICON_MAP` maps string names to components, and `getIconName()` serializes components back to strings.
- **Auto-save**: Every change calls `triggerAutoSave()` which updates the `lastSaved` timestamp and syncs to localStorage.
- **Restore**: On remount, `RoleSetup.tsx` reads from `rolesConfig` in the store and deserializes icons back to components.

#### Module Permission Config Persistence

The `modulePermissionConfigs` field stores which roles can manage each module. When a user navigates to a module config page (`/onboarding/modules/{moduleId}/config`):

1. Available roles are dynamically read from `rolesConfig` (not hardcoded)
2. Previously saved manage roles for the module are restored from `modulePermissionConfigs`
3. On save, `setModulePermissionConfig(moduleId, manageRoles)` persists to the store
4. **Orphaned role filtering**: When restoring, role IDs are validated against current `availableRoles` — if a role was removed in the Role Setup step, its ID is filtered out to prevent "undefined" display

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
- **Sensitive Data Encryption**: Email passwords, API keys, and file storage credentials submitted during onboarding are encrypted with **AES-256-GCM** authenticated encryption before being stored in the session database (values written under the legacy Fernet scheme remain readable). Only the platform type is stored in plain text.
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

---

## Recent UX Improvements (February 8, 2026)

### Data Loss Prevention
- **Unsaved Changes Warning**: Users are now warned before navigating away from forms with unsaved data
  - Browser refresh/close triggers confirmation dialog
  - In-app navigation blocked with user confirmation
  - Implemented via `useUnsavedChanges` hook

### Enhanced Form Experience
- **Password Requirements Always Visible**: Requirements shown before user starts typing (AdminUserCreation page)
  - Eliminates confusion about password criteria
  - Real-time validation feedback with checkmarks

- **Section Completion Indicators**: Organization setup form shows green checkmarks when sections are complete
  - Visual feedback helps users track progress through long forms
  - Red asterisks removed when section requirements are met

- **Inline Address Validation**: Error messages appear directly under problematic fields
  - Previously only showed errors at form bottom
  - Reduces user frustration by pinpointing exact issues

### Mobile Optimizations
- **Sticky Continue Button**: Primary action button stays visible at bottom on mobile devices
  - Applied to NavigationChoice and OrganizationSetup pages
  - Improves mobile usability on long forms

### Input Enhancements
- **URL Auto-HTTPS**: Website URLs automatically prepended with `https://` if protocol omitted
  - Prevents common user error
  - Triggers on field blur

- **Improved ZIP Code Errors**: Now shows expected format ("12345 or 12345-6789")

### Progress Standardization
- **Consistent Step Indicators**: All pages now show "Step X of 10" format
  - Sets clear expectations about onboarding length
  - Previously had inconsistent numbering

### Startup Experience
- **Enhanced Initialization Messaging**: OnboardingCheck page now explains 25-30 minute first-time startup (10-30 seconds on subsequent restarts)
  - Shows database connection retry attempts (up to 20 attempts)
  - Displays migration progress with detailed count (38 migrations)
  - Explains what features are being set up (membership, training, events, elections, inventory, audit logs)
  - Educational tips rotate every 15 seconds while waiting
  - Accurate timeline breakdown: ~6 min MySQL init + ~23 min migrations
  - Reduces user anxiety during comprehensive database initialization
  - **Migration timeout protection**: 30-minute timeout prevents infinite hangs

### State Management Cleanup
- **Removed Misleading Auto-save Indicators**: OrganizationSetup no longer shows "Last saved" timestamps
  - Zustand state changes aren't true backend saves
  - Prevents confusion about when data is actually persisted

- **Removed Redundant Storage Operations**: Cleaned up duplicate sessionStorage writes

---

## Recent Fixes (February 9-12, 2026)

### Onboarding State Persistence
- **Role Permissions Persistence**: `rolesConfig` added to Zustand store with localStorage persistence; icon serialization via `ICON_MAP` enables storing React components
- **Module Permission Config Persistence**: `modulePermissionConfigs` replaces hardcoded role lists and fake save handlers with real store persistence
- **Orphaned Role ID Filtering**: Role IDs validated against `availableRoles` on restore to prevent undefined entries when roles are removed
- **Unified Role Initialization**: `DEFAULT_ROLES` in `permissions.py` is the single source of truth for all 16 system roles

### Authentication & Navigation Fixes
- **Auth Token Key Fix**: AppLayout now checks `access_token` (not `auth_token`) in localStorage, fixing a critical redirect loop that caused hundreds of API requests per second
- **Branding Transfer**: Organization name and logo transfer from onboarding to main app via sessionStorage, with API fallback
- **Persistent Navigation**: Side and top navigation components added to all protected pages with submenu support

### Infrastructure
- **Docker Graceful Shutdown**: Exec form CMD, `stop_grace_period: 15s`, and `init: true` across all Docker Compose configurations
- **Apparatus Module Fix**: Fixed module slug mismatch for apparatus/public outreach in configuration whitelist

### New System Roles
Eight new roles added to the default role set (total: 16 system roles):
- Officers, Quartermaster, Training Officer, Public Outreach Coordinator, Meeting Hall Coordinator, Membership Coordinator, Communications Officer, Apparatus Manager

### Module UIs
Fully built frontend pages for: Events, Inventory, Training, Documents, Scheduling, Reports, Minutes, Elections, with dashboard stats endpoint

---

## UX Improvements (February 10, 2026)

### Week 1: Core Usability
- **Password Reset Flow**: New Forgot Password and Reset Password pages
- **Live Dashboard Stats**: Dashboard values from API with skeleton loaders
- **User Settings Page**: Account, password, and notification tabs
- **Dead Navigation Links Fixed**: Reports and Settings links now route correctly

### Week 2: Safety
- **Logout Confirmation Modal**: ARIA-compliant modal with Escape key, scroll lock, and unsaved changes warning

### Week 3: Onboarding Polish
- **Module Features Visible**: First 3 features shown upfront on module cards with "+ X more" hint
- **Breadcrumb Progress**: Step names with green checkmarks replace simple step counter
- **Simplified Organization Setup**: Relaxed ZIP validation, sections expanded by default
- **Focus Trap Hook**: Reusable `useFocusTrap` for WCAG-compliant mobile menus

### Week 4: Contextual Help
- **Help Link Component**: 3 variants (icon/button/inline) with tooltip support
- **Integrated Help Tooltips**: Dashboard, Organization Setup, and Reports pages

### Additional
- **Membership Type Field**: Dropdown in admin user creation (prospective/probationary/regular/life/administrative)
- **Administrator Terminology**: Clarified IT Administrator vs Administrative Member
- **Validation Toast Fix**: `validateForm()` returns errors directly instead of reading stale state

---

## Authentication & Login (February 10-11, 2026)

### Login Flow Fixes
- **Token Type Mismatch**: `get_user_from_token()` compared UUID object against String(36) column — fixed to query by string
- **Account Lockout Persistence**: Failed login counter now commits correctly (was being rolled back on HTTPException)
- **Session Creation**: Onboarding endpoint now uses `create_user_tokens()` which creates a proper UserSession row
- **Login Redirect**: Authenticated users on login page redirect to `/dashboard`
- **ProtectedRoute Race Condition**: Checks localStorage first, shows spinner while validating

### Auth UX
- **Concurrent Token Refresh**: Multiple 401 responses share a single refresh promise — prevents replay detection logout
- **Welcome Page Detection**: Redirects when onboarding is already completed
- **Organization Branding**: `GET /auth/branding` endpoint (unauthenticated) serves org name and logo to login page

### Login Page Enhancements
- Organization logo display with "Sign in to [Org Name]"
- Rounded square logo shape (was circular)
- Footer matching onboarding style

---

## Startup Optimization (February 11, 2026)

- **Fast-Path Initialization**: Fresh databases use `create_all()` instead of running 39+ Alembic migrations — first-boot reduced from ~20 minutes to seconds
- **Onboarding Completion Fix**: Explicit `commit()` in admin-user endpoint before frontend calls `/complete`
- **Audit Logger Savepoint**: Savepoint isolation prevents 500 errors in `/complete` endpoint
- **Auth Session Commit**: `create_user_tokens()` now commits the session record immediately
- **E2E Test Script**: `test_onboarding_e2e.sh` validates the complete onboarding flow

---

## Election Security (February 10, 2026)

- **Double-Voting Prevention**: 4 partial unique indexes on votes table prevent duplicate votes at the database level
- **Results Timing**: Requires `status=CLOSED` AND `end_date` passed before revealing vote counts
- **IntegrityError Handling**: `cast_vote()` returns user-friendly error instead of 500
- **Security Audit**: Full review documented in [ELECTION_SECURITY_AUDIT.md](./module-audit/elections.md) (rating: 7.1/10)

---

## OAuth Sign-In Buttons (2026-05-28)

The login page can show "Sign in with Google" and "Sign in with Microsoft"
buttons, but they appear **only** when both conditions hold:

1. **Org auth provider is set to the matching provider** — the active org's
   `settings["auth"]["provider"]` is `"google"` or `"microsoft"` (chosen on the
   Authentication Choice onboarding page).
2. **The server is fully configured for that provider** — the required env vars
   are present, verified server-side by `GoogleOAuthService.is_configured()` /
   `MicrosoftOAuthService.is_configured()` (client ID/secret **and** the redirect
   URI).

The login page reads this from `GET /api/v1/auth/oauth-config`, which returns
`{ "googleEnabled": bool, "microsoftEnabled": bool }`. Each flag is `true` only
when the provider is selected **and** configured, so a button can never be shown
that would 404 on click (`backend/app/api/v1/endpoints/auth.py`,
`frontend/src/pages/LoginPage.tsx`).

### Operational notes

- **Redirect URI must match the IdP console.** `GOOGLE_REDIRECT_URI` /
  `AZURE_AD_REDIRECT_URI` must exactly match the authorized redirect URI
  registered in the Google Cloud / Azure AD app registration, or the provider
  rejects the callback. The provider is treated as "not configured" (button
  hidden) if its redirect URI env var is unset.
- **Link-existing only.** OAuth sign-in **never creates a new account**. It links
  to an existing local user matched by the verified email; if no local account
  matches, login fails with a `no_account` error ("No account matches that
  Google email. Contact your administrator for access."). The user record gains
  `oauth_provider` / `oauth_subject` columns (migration `20260528_0002`) so a
  subject mismatch on a later login is also rejected.
- Google sign-in can additionally be restricted by allowed email domain.

---

**Last Updated**: May 29, 2026 (Added OAuth sign-in button gating: provider selection + server configuration, link-existing-only policy, redirect-URI requirement)
**Previously**: February 12, 2026 (role/module config persistence, dashboard stats API, auth token handling, 16 system roles, orphaned role filtering, branding transfer mechanism)
