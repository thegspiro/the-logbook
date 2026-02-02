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
│  Auto-redirects to   │
│  /onboarding after   │
│  10 seconds          │
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
│ 3. Department Info           │
│ Route: /onboarding/start     │
│ Collects:                    │
│ - Department name            │
│ - Logo upload (optional)     │
│ - Organization type          │
│ - Timezone                   │
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

**Navigation**:
- Auto-redirects to `/onboarding` after 10 seconds
- Manual button: "Get Started" → `/onboarding`

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

### 3. Department Info (`/onboarding/start`)
**Purpose**: Collect basic department information

**Form Fields**:
- Department Name (required)
- Logo Upload (optional)
- Organization Type (dropdown)
- Timezone (dropdown)

**API Call**:
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

**Navigation**:
- Button: "Continue" → `/onboarding/navigation-choice`

**Data Storage**: SessionStorage
- `departmentName`
- `hasLogo` (boolean)
- `organizationType`
- `timezone`

---

### 4. Navigation Choice (`/onboarding/navigation-choice`)
**Purpose**: Choose navigation layout

**Options**:
- Top Bar Navigation (horizontal)
- Left Sidebar Navigation (vertical)

**Navigation**:
- Button: "Continue" → `/onboarding/email-platform`

**Data Storage**: SessionStorage
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

**Data Storage**: SessionStorage
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

**Data Storage**: SessionStorage
- `fileStorage` = "local" | "s3" | "azure" | "gcs"

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

**Data Storage**: SessionStorage
- `authenticationMethod` = "local" | "oauth" | "saml" | "ldap"

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

### Create Organization
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
Creates the first organization with default roles.

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

## SessionStorage Data

The onboarding flow uses `sessionStorage` to persist data between pages:

```javascript
{
  // Department Info
  "departmentName": "Fire Department Name",
  "hasLogo": "true",
  "organizationType": "fire_department",
  "timezone": "America/New_York",

  // Navigation Choice
  "navigationLayout": "top", // or "left"

  // Email Platform
  "emailPlatform": "google", // or "microsoft", "smtp", "none"

  // File Storage
  "fileStorage": "local", // or "s3", "azure", "gcs"

  // Authentication
  "authenticationMethod": "local", // or "oauth", "saml", "ldap"

  // Module Status
  "moduleStatus_members": "enabled",
  "moduleStatus_training": "skipped",
  "moduleStatus_elections": "ignored"
}
```

---

## Error Handling

All onboarding pages include:
- Form validation with clear error messages
- API error handling with toast notifications
- Redirect to `/onboarding/start` if department info is missing
- Graceful fallbacks for API failures

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
- SessionStorage for frontend state
- Database for backend data
- Proper cleanup after onboarding complete

---

## Testing the Flow

To test the complete onboarding flow:

1. **Start fresh**:
   ```bash
   # Clear sessionStorage in browser console
   sessionStorage.clear()

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

**Last Updated**: February 2, 2026
