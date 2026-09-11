# Onboarding Flow Navigation Guide

## Overview

This document describes the complete onboarding flow for The Logbook application, including all navigation paths, button actions, and API endpoints.

## Onboarding Flow Diagram

The order below is the single source of truth in
`frontend/src/modules/onboarding/config/steps.ts`; the backend mirrors it in
`OnboardingService.STEPS` and a parity test fails if the two drift. The
page-by-page sections that follow are keyed by route, not numbered, so they
cannot fall out of step with this.

```
  /  Welcome
  │      "Get Started"
  v
  /onboarding  OnboardingCheck
  │      GET /api/v1/onboarding/status
  │      needs_onboarding = false → /login
  v
  /onboarding/prepare  Setup Prerequisites
  │      Pre-flight, not a step: nothing is collected or saved.
  │      Says what the flow will ask for and what can be skipped.
  v
┌─ 1. Organization Setup ──────────────── /onboarding/start          REQUIRED
│  POST /onboarding/session/organization
│  Name, type, timezone, contact info, mailing + physical address,
│  department identifiers (FDID / State ID / Dept ID), member
│  numbering, logo.
│  COMMITS the organization, and creates the HQ Facility + Location
│  from the department address.
└─ v
┌─ 2. System Owner ────────────────────── /onboarding/system-owner   REQUIRED
│  POST /onboarding/system-owner
│  Username, email, password (12+ chars), name, membership number.
│  Sets the auth cookies — the admin is signed in from here on, so
│  every step below runs against a real account rather than an
│  anonymous session, and a lapsed session is recoverable.
└─ v
┌─ 3. Module Overview ─────────────────── /onboarding/modules
│  POST /onboarding/session/modules
│  Per module: "Enable" (in place), "Configure Later", or "Ignore".
│  Asked before positions so permissions are set against a known set.
└─ v
┌─ 4. Ranks & Positions ───────────────── /onboarding/positions
│  GET/POST/PATCH/DELETE /operational-ranks   (the rank ladder)
│  PATCH /users/{id}/profile                  (the System Owner's own rank)
│  POST /onboarding/session/roles             (the positions)
│  The department's rank ladder first — rename, reorder, remove, add, and set
│  each rank's shift eligibility — then the two-tier permission model
│  (view / manage) across position templates: leadership, officers,
│  administrative, specialized, member.
└─ v
┌─ 5. Stations ────────────────────────── /onboarding/stations
│  POST /onboarding/session/stations
│  Stations beyond HQ. Skippable — many departments have one.
│  CREATES Facility + Location per station.
└─ v
┌─ 6. Apparatus ───────────────────────── /onboarding/apparatus
│  POST /onboarding/session/apparatus
│  Unit number, type, minimum staffing, riding positions. Skippable.
│  CREATES BasicApparatus per unit.
└─ v
┌─ 7. IT Team & Backup Access ─────────── /onboarding/it-team
│  POST /onboarding/session/it-team
│  IT contacts and backup access, each with an optional operational rank.
│  Contacts become user accounts at completion, with must_change_password
│  set and the rank applied if it still resolves.
└─ v
┌─ 8. Email Platform ──────────────────── /onboarding/email-platform
│  None / Google Workspace / Microsoft 365 / SMTP / Cloudflare
│  "None" skips ahead to file storage.
└─ v
┌─ 8a. Email Configuration ────────────── /onboarding/email-config
│  POST /onboarding/session/email  (credentials encrypted server-side)
│  POST /onboarding/test/email     (verifies the connection)
└─ v
┌─ 9. File Storage Choice ─────────────── /onboarding/file-storage
│  Local / Google Drive / OneDrive / S3
└─ v
┌─ 9a. File Storage Configuration ─────── /onboarding/file-storage-config
│  POST /onboarding/session/file-storage  (secrets encrypted server-side)
│  Per-platform credential form. Skipping stores the platform choice
│  without credentials rather than discarding the step.
└─ v
┌─ 10. Authentication Choice ──────────── /onboarding/authentication
│  Local password / Google / Microsoft / Authentik
└─ v
┌─ 11. Navigation Choice ──────────────── /onboarding/navigation-choice
│  Top bar or left sidebar. Stored per-browser in localStorage
│  (see KNOWN_LIMITATIONS ONBOARD-5).
│  Last step, so this is where POST /onboarding/complete is called.
└─ v
┌─ Setup Complete ─────────────────────── /onboarding/complete
│  Summary of what was configured, plus the steps the backend's own
│  checklist reports as still outstanding (GET
│  /organization/setup-checklist) — not a fixed list.
│  Primary action → /setup (Department Setup checklist)
│  Secondary     → /dashboard
└─ done
```

> **Step ordering.** Two things drive it. The System Owner is created second,
> so everything after it runs authenticated — `create_system_owner` sets the
> auth cookies, which is what makes a setup whose 30-minute onboarding session
> lapsed recoverable rather than terminal. And the steps that need credentials
> from elsewhere (email, file storage, sign-in) sit at the end, because those
> are the ones that send an operator away mid-flow. Only steps 1 and 2 are
> required; `complete_onboarding` enforces exactly those two.

## Page-by-Page Navigation Details

### Welcome Page (`/`)

**Purpose**: First landing page with animated introduction

**Animation**: Title appears after 300ms, body content after 800ms (quick fade-in so users aren't waiting on a blank screen).

**Navigation**:

- Button: "Get Started" → `/onboarding`

**No API calls**

---

### Onboarding Check (`/onboarding`)

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

- If `needs_onboarding = true` → `/onboarding/prepare`
- If `needs_onboarding = false` → `/login`

> **Login page guard (2026-06-25):** `/login` enforces the same check itself, so
> it can't be reached directly on an unconfigured install. On mount the login
> page calls `GET /api/v1/onboarding/status`; when `needs_onboarding = true` it
> redirects to `/onboarding` (showing a brief spinner during the check) rather
> than rendering the sign-in form. If the status endpoint can't be reached, the
> login page renders normally as a fallback.

---

### Setup Prerequisites (`/onboarding/prepare`)

**Purpose**: say what the flow will ask for, before it starts asking.

Not a step: nothing is collected, nothing is saved, and it has no entry in
`ONBOARDING_STEPS`. It exists because the health screen told an operator the
database was up but nothing told them the wizard would want SMTP credentials,
an OAuth client secret and a storage key — so they started, met a step they
could not answer, and left to go and find it. Walking away is what used to end
the install.

Its two lists are derived from `ONBOARDING_STEPS` (`optional: false` vs
`optional: true`), so a step that changes its flag changes this screen with it.

**Navigation**:

- Button: "Start setup" → `/onboarding/start`

---

### Organization Setup (`/onboarding/start`)

**Purpose**: Collect comprehensive organization information and commit to database

**Form Sections** (collapsible):

1. **Basic Information** (required):
   - Organization Name
   - URL Slug (auto-generated)
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
   - **Member numbers** — whether members carry a badge/roster number, and if
     so its prefix and where the sequence starts. Asked here rather than on a
     members screen because the counter only numbers members created after it
     is switched on: the System Owner arrives at step 9 and the IT team at step
     10, so a department that answered later ended up with its first accounts
     holding no number and the roster import starting at the number they should
     have had. Omitted from the payload when the answer is no, which leaves the
     shipped default (`enabled: false`) rather than writing an explicit one —
     so "we do not number members" and "nobody asked" stay distinguishable.

6. **Additional Information**:
   - County/Jurisdiction
   - Year Founded

7. **Organization Logo**:
   - Drag-and-drop upload
   - Supports PNG, JPG, WebP (max 5MB)

**API Call**:

```
POST /api/v1/onboarding/session/organization
Body: {
  name: string,
  slug?: string,
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
  logo?: string,  // Base64 data URL
  membership_id?: {   // omitted entirely when the department does not number members
    enabled: boolean,
    auto_generate: boolean,
    prefix: string,
    next_number: number
  }
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

- Button: "Continue" → `/onboarding/system-owner`

**Data Storage**:

- Database (organization table, plus the HQ Facility and Location)
- Zustand store (department name, logo for other components)

---

### Stations (`/onboarding/stations`)

**Purpose**: Capture stations beyond headquarters

Headquarters is already created from the department address during
Organization Setup, so this step collects the _other_ stations. Without it, a
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

### Apparatus (`/onboarding/apparatus`)

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

- Button: "Continue" → `/onboarding/it-team`
- Button: "Skip for now" → `/onboarding/it-team`

---

### Navigation Choice (`/onboarding/navigation-choice`)

**Purpose**: Choose navigation layout

**Options**:

- Top Bar Navigation (horizontal)
- Left Sidebar Navigation (vertical)

**Navigation**:

- Button: "Continue" → `/onboarding/complete` (finalizes setup first)

**Data Storage**: Zustand store (persisted to localStorage)

- `navigationLayout` = "top" | "left"

---

### Email Platform Choice (`/onboarding/email-platform`)

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

### Email Configuration (`/onboarding/email-config`)

**Purpose**: Configure selected email service

**Form Fields** (varies by platform):

**Google Workspace / Gmail**:

- From Email (the Google account that signs in to smtp.gmail.com)
- Google App Password (2-Step Verification required)

**Microsoft 365**: Authenticated SMTP must be enabled for the mailbox either
way. The step offers a choice of authentication and defaults to the app
registration, because Exchange Online disables Basic auth for SMTP AUTH by
default at the end of December 2026 and does not offer it to tenants created
after that.

- From Email (the mailbox that signs in to smtp.office365.com)
- _App registration (OAuth)_ — Directory (tenant) ID, Application (client) ID,
  Client secret. The registration needs the `SMTP.SendAsApp` application
  permission for Office 365 Exchange Online, admin consent for it, and
  `SendAs` on the sending mailbox.
- _App Password_ — Microsoft 365 App Password. Basic auth; retiring.

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
POST /api/v1/onboarding/test/email
Body: {
  platform: "gmail" | "microsoft" | "selfhosted" | "cloudflare" | "other",
  config: { ...platform-specific fields... }
}
```

**API Call** (save config):

```
POST /api/v1/onboarding/session/email
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

### File Storage Choice (`/onboarding/file-storage`)

**Purpose**: Choose file storage backend

**Options**, as the screen offers them and `save_file_storage_config` accepts
them:

- `local` — Local Storage (server filesystem)
- `googledrive` — Google Drive
- `onedrive` — OneDrive / SharePoint
- `s3` — Amazon S3, or any S3-compatible endpoint
- `other` — decide later

Azure Blob Storage and Google Cloud Storage are **not** options and never were;
`azure` and `gcs` return a 400.

> **Stored, but nothing reads it** _(2026-09-10)_: whichever platform is chosen,
> uploads do not use it. `documents.py` writes to a fixed
> `UPLOAD_DIR = "/app/uploads/documents"` and event attachments to their own
> fixed directory; no code outside the settings schema and the onboarding
> writer reads `s3_bucket_name`, `google_drive_client_id` or any other
> `FileStorageSettings` field. So a correctly keyed S3 or Drive configuration
> saves green and every file still lands on local disk — which matters most to
> a department that chose cloud storage precisely so its files would be backed
> up somewhere the server is not. This is CLAUDE.md pitfall 19, a setting whose
> only effect is being stored.

**Navigation**:

- If "Local Storage" → `/onboarding/authentication`
- If cloud service → `/onboarding/file-storage-config`

**Data Storage**: Zustand store (persisted to localStorage)

- `fileStoragePlatform` = "local" | "googledrive" | "onedrive" | "s3" | "other"

---

### File Storage Configuration (`/onboarding/file-storage-config`)

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
  config: { ... }   // platform-specific; exact camelCase keys, see below
}
```

`config` is a free dict on the schema, exactly like `/session/email`'s, and
completion maps **exact camelCase** names out of it:

| Platform      | Keys                                                                                |
| ------------- | ----------------------------------------------------------------------------------- |
| `googledrive` | `googleDriveClientId`, `googleDriveClientSecret`, `googleDriveFolderId`             |
| `onedrive`    | `oneDriveTenantId`, `oneDriveClientId`, `oneDriveClientSecret`, `sharePointSiteUrl` |
| `s3`          | `s3AccessKeyId`, `s3SecretAccessKey`, `s3BucketName`, `s3Region`, `s3EndpointUrl`   |
| `local`       | `localStoragePath`                                                                  |
| `other`       | none                                                                                |

**The backend validates none of these.** The save endpoint checks only that
`platform` is one of the five, then encrypts whatever `config` holds. At
completion `_persist_session_data_to_org()` reads the camelCase names above and
drops every key it does not recognise. A caller using the snake_case spellings
`FileStorageSettings` exposes — `s3_bucket_name`, `google_drive_client_id` —
therefore gets a success response, has its credentials encrypted into the
session, and ends up with an organization storing the platform choice and
nothing else. There is no equivalent of email's `missing_for_enabled()` here, so
no error is raised at any point.

**The wizard does validate, so this is an API-only exposure.**
`FileStorageConfiguration.tsx` marks `googleDriveClientId` and
`googleDriveClientSecret`; `oneDriveTenantId`, `oneDriveClientId` and
`oneDriveClientSecret`; and `s3BucketName`, `s3Region`, `s3AccessKeyId` and
`s3SecretAccessKey` as **required**, and its `missingRequired` check blocks
Save & Continue until each is filled, naming the ones outstanding. The rest —
`googleDriveFolderId`, `sharePointSiteUrl`, `s3EndpointUrl` and
`localStoragePath` — are optional there. On the three credential-bearing
platforms the only route through the screen with an empty configuration is the
explicit **"I'll add these later"** button, which posts `{}` deliberately so the
platform choice is recorded and Settings can show what is missing. `local` is
the exception, legitimately: its single field is optional, so saving it blank
posts `{}` through the ordinary Save & Continue — meaning "use the server's
default path", not "I have not finished". An installer following the wizard
therefore cannot save half a credential set; a caller posting to the endpoint
can.

And no error is raised later either, because **nothing reads these settings**
— see the note under step 8. Uploads go to fixed local directories whatever is
stored here, so a dropped credential has no symptom at all: it is not that the
department finds out late, it is that the correctly keyed configuration behaves
the same way as the broken one.

**Navigation**:

- Button: "Save & Continue" → `/onboarding/authentication`
- Button: "I'll add these later" → `/onboarding/authentication` (stores the
  platform choice with no credentials, so Settings shows what is missing)

---

### Authentication Choice (`/onboarding/authentication`)

**Purpose**: Choose authentication method

**Options**, as the screen offers them and the endpoint accepts them:

- `local` — Username/Password
- `google` — Google OAuth. **Link-existing only** (see "OAuth Sign-In Buttons"
  below); OAuth never creates new accounts
- `microsoft` — Microsoft Azure AD, on the same link-existing terms
- `authentik` — self-hosted Authentik SSO. **Accepted and persisted, but there
  is no sign-in flow behind it** — see the warning below

Those four strings are the contract. SAML and LDAP are **not** among them and
are not implemented (`LDAP_ENABLED` exists in config and gates nothing); a
caller sending `saml`, `ldap` or `oauth` gets a 400 naming the four the
endpoint accepts.

> **Choosing `authentik` buys nothing and costs password recovery**
> _(2026-09-10)_: it is accepted here and completion writes it to
> `settings.auth.provider`, and `AuthSettings` even carries `authentik_url` /
> `authentik_client_id` / `authentik_client_secret` — but there is no
> authorization or callback route for it. `auth.py` implements `/oauth/google`
> and `/oauth/microsoft` only, `GET /auth/oauth-config` reports just
> `googleEnabled` and `microsoftEnabled`, and the login page renders those two
> buttons. So the SSO a department selected does not exist.
>
> Signing in still works: `POST /auth/login` calls `authenticate_user()`
> without consulting `settings.auth.provider`, and the password form renders
> unconditionally. What the setting does change is recovery —
> `forgot-password` refuses a local reset for any non-local provider, so a
> member who forgets their password has no self-service way back and needs an
> administrator to reset it. Use `local` unless you are configuring Google or
> Microsoft.

**API Call**:

```
POST /api/v1/onboarding/session/auth
Body: { platform: "google" | "microsoft" | "authentik" | "local" }
```

The endpoint stores the choice and nothing else — `AuthConfigRequest` has no
`config` field. Provider credentials are **not** part of onboarding: Google and
Microsoft read `GOOGLE_*` / `AZURE_AD_*` from the server environment.

**Have that environment configuration working before completing with a
non-local provider.** `GET /auth/oauth-config` reports a provider enabled only
when the organization selected it **and** the server is configured for it
(`provider == "google" and GoogleOAuthService.is_configured()`), so an unset
environment hides the sign-in button entirely. Completion persists the provider
immediately, and `forgot-password` then refuses local resets for it — so
finishing setup with `google` or `microsoft` before the environment is ready
leaves no OAuth button and no reset link until an administrator sets the
variables and restarts. Choosing `local` and switching later avoids the window
altogether.

**Navigation**:

- Button: "Continue" → `/onboarding/navigation-choice`

**Data Storage**: Zustand store (persisted to localStorage)

- `authPlatform` = "google" | "microsoft" | "authentik" | "local"

---

### System Owner (`/onboarding/system-owner`)

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

- Button: "Continue" → `/onboarding/modules`

---

### IT Team & Backup Access (`/onboarding/it-team`)

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
  it_team: [{ name, email, phone, role, rank? }],
  backup_access: {
    email: string,
    phone: string,
    secondary_admin_email?: string
  }
}
```

**Navigation**:

- Button: "Continue" → `/onboarding/email-platform`

---

### Positions (`/onboarding/positions`)

**Purpose**: Describe the department's membership ladder, rank ladder and positions

**The membership ladder** (`MembershipLadderSection`, rendered first):

`organization.settings["membership_tiers"]` decides who is in the ballot
electorate, who may stand for office, whether a member must meet a
meeting-attendance threshold to vote, and who is graded for training — and
`run_membership_tier_advance` promotes members along it monthly (cron
`0 8 1 * *`) as
`performed_by="system"`. It shipped with a ladder (Probationary at 0 years,
Active at 1, Senior at 10, Life at 20) and **no screen anywhere**: not in setup,
not in Settings, though the API and three frontend service methods existed. A
department whose bylaws differ found out at its first election.

Setup asks it because the answer is cheap there and expensive afterwards: once
the roster holds rungs, a rung cannot be removed without moving those members
first. It renders `components/settings/MembershipTiersSection` through the
`useTierEditor` hook, the same pair that serves
**Members → Settings → Membership Tiers**.

Tier **ids** are not editable, for the reason rank codes are not: `id` is what
`User.membership_type` stores and nothing cascades a change to it, so a renamed
id is a rung emptied — `split_membership_type` refuses to guess a class for an
id it does not recognise, and those members leave the operational body and the
electorate at once. The display name, the years threshold, the order and every
benefit are all editable; the id is derived once when a tier is created.

`PUT /users/membership-tiers/config` validates through `MembershipTierSettings`
and refuses to drop a tier members hold, naming how many. `GET` reports
`member_counts` so the editor can show them and grey out an occupied rung.

**The rank ladder** (`RankLadderSection`, rendered above the positions):

`operational_ranks` is per-organization, and `seed_defaults` only ever fires
into an empty table — so whatever it wrote on day one used to be what the
department lived with, discovered later in Settings and usually after members
had been assigned to it. Loading this step seeds the agency-appropriate
defaults and lets the department rename them, reorder them, remove the ones it
does not have, add its own, and set which shift seats each rank can fill.

It renders `components/settings/RanksSettingsSection` — the same editor as
**Members → Settings → Operational Ranks** — driven by the same `useRankEditor`
hook, against the ordinary `/operational-ranks` endpoints. The ladder a
department gets on day one and the one it maintains afterwards are therefore
the same code. One thing differs: `allowCodeEdit={false}`.
A rank code is the runtime key `get_rank_default_permissions()` resolves
against, and setup is the worst place to change one, because there is no
"before" against which to notice a rank has stopped conferring anything.
Renaming here is display names only.

A rank a department adds itself carries the editor's existing
**No default permissions** badge: rank grants resolve from a code-level
registry, so an invented code confers nothing on its own and those members
need a position.

**The System Owner's own rank** is set here too, through
`PATCH /users/{id}/profile` — the ordinary endpoint, which validates the code
against the department's ladder and enforces the permission-grant ceiling. It
is here rather than on the account step because the ladder has to exist, and
be the department's own, before there is a right answer.

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

> **What a checkbox grants.** A row's two boxes usually mean `{module}.view`
> and `{module}.manage` (plus the `{module}.*` wildcard, which is what carries
> a module's action grants) — but a registry id is a _module settings_ key and
> is only usually the permission prefix as well. `_MODULE_CHECKBOX_GRANTS` in
> `app/core/permissions.py` is the one place that says otherwise, and the
> wizard reads it through the generated `MODULE_CHECKBOX_TIERS`:
>
> - **Medical Supplies** grants `inventory.view_medical` /
>   `inventory.manage_medical`. Manage grants view as well, because the route
>   and the navigation entry both gate on `view_medical` and there is no
>   manage-implies-view rule.
> - **Mobile App Access** has no permission gate at all, so it is not a row.
> - **Integrations** has no read-only console, so it has no View box.
> - **Position Management**'s manage tier is the `positions.*` wildcard;
>   `positions.manage` does not exist.
>
> A tier with no permission behind it is not rendered — a box that cannot grant
> anything is a promise the app will not keep.
> `tests/test_module_checkbox_grants.py` holds every row to permissions that
> exist.

> **A box another row already confers.** Every medical-supply route is gated
> `require_permission("inventory.view_medical", "inventory.view")` — an OR — so
> the broad Inventory grant opens the module on its own, without either medical
> grant. Every seeded position down to `member` carries `inventory.view`, and
> `facilities_manager` carries `inventory.manage`, so the editor's unticked
> Medical Supplies box was telling most of the roster something untrue.
>
> It is shown ticked and not editable while Inventory confers it, with the
> reason on the control. Nothing is written: unticking could not revoke the
> access without taking Inventory away, and a control that silently does nothing
> is worse than one that says why it is fixed. The lock is read off the grid
> being edited rather than off a stored answer, so unticking Inventory releases
> Medical Supplies in the same breath.
>
> `_CHECKBOX_CONFERRED_BY` in `app/core/permissions.py` is the authority,
> projected to the wizard as the generated `MODULE_CHECKBOX_CONFERRED_BY`.
> `tests/test_module_checkbox_grants.py` reads the medical endpoints and fails
> if a route stops accepting the broad grant, or if one starts accepting
> something the map does not describe.

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

`POST /api/v1/onboarding/session/positions` is the same submission under the
name the wizard actually uses, and its body is keyed `positions` rather than
`roles`:

```
POST /api/v1/onboarding/session/positions
Body: {
  positions: [{ ...same item shape as above }]
}
```

Copying the `roles` body to the `positions` route returns a 422:
`PositionsSetupRequest` requires the `positions` key.

**Neither list may be empty.** Both `RolesSetupRequest.roles` and
`PositionsSetupRequest.positions` declare `min_length=1` (and `max_length=200`),
so `{positions: []}` — the natural way to ask for "none of these" — is refused
by Pydantic before the handler runs, and none of the retention logic below is
reached. Unticking every configurable position is expressed by submitting the
ones that remain, not by submitting nothing; the System Owner and Member
positions are protected by the handler rather than by an empty request.

> **Unticking a position removes it** _(2026-09-09)_: `save_session_roles`
> used to delete only `is_system=False` rows, so an unticked seeded position
> survived setup and went on appearing in every picker. It is now deleted,
> except for `it_manager` (the System Owner's own), `member` (the baseline),
> and any position somebody already holds. The response names what it removed
> and the wizard's toast lists them. Reticking one puts it back with the
> registry's grants, through the create branch.

**Navigation**:

- Button: "Continue to Stations" → `/onboarding/stations`

---

### Module Overview (`/onboarding/modules`)

**Purpose**: Select and configure optional modules

**Module Categories**:

**Essential (Core)** — always on, not offered as a choice:

- Member Management
- Events & RSVP
- Documents & Files
- Custom Forms

**Operations**:

- Training & Certifications
- Inventory
- Medical Supplies
- Shift Scheduling
- Apparatus & Fleet
- Facilities Management
- Department Store

**Governance**:

- Elections & Voting
- Meeting Minutes
- Reports & Analytics

**Communication**:

- Email Notifications
- Mobile App Access

**Advanced**:

- External Integrations

**Membership**:

- Prospective Members Pipeline

The list comes from `MODULE_REGISTRY`
(`frontend/src/modules/onboarding/config/moduleRegistry.ts`), whose ids are held
to the backend's offered set by `tests/test_onboarding_module_parity.py`.
Modules the wizard deliberately does not ask about — Communications, Finance,
Grants & Fundraising, HR & Payroll, Incidents, Medical Screening, Public
Information and the Testing Checklist — are turned on later from
**Settings → Modules**.

**Per-Module Actions**:

- "Enable" → Mark as "enabled". Enabling is the whole action; it does not
  navigate. See 13a for why the per-module configuration step it used to open
  was removed
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

- Button: "Continue" → `/onboarding/positions` (after the module choices save,
  so the completion screen can link into the protected `/setup` route)

---

### Module Configuration Template — removed

`/onboarding/modules/{moduleId}/config` collected "who may manage this module"
into the wizard's Zustand store, reported **"permissions configured!"** and
submitted nothing: no API client method carried the answer and no backend field
held it. An administrator who used it to restrict a module during setup was told
the restriction was in place when it was not.

Who may manage a module is decided one step earlier, on the Positions step,
which does save to the backend (`POST /onboarding/session/roles`). A second
editor for the same decision would be a second answer to a question that already
has one, so the step was removed rather than wired up. The route remains as a
redirect to `/onboarding/modules` for a session restored from an older client.

---

### Setup Complete (`/onboarding/complete`)

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
training courses and requirements, inventory categories, medical supply
categories, department store products, custom forms, verified email delivery,
prospective-members pipeline, and integrations.

A module the wizard offers must either add an item here or be named in
`MODULES_WITHOUT_SETUP_CHECKLIST_ITEM` with the reason it needs none —
Elections and Minutes have nothing to configure ahead of time, Apparatus and
Facilities are covered by essential items whether or not their module is on.
`tests/test_setup_checklist.py` holds that partition, because turning a module
on is not the same as making it usable: the Department Store shipped
enableable and then silently empty, with nothing telling the department its
catalog was the problem.

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

### Responses

The bodies below are requests. Responses are given here as the model that
defines them, rather than copied out as JSON: a model name stays true when a
field is added, and a hand-copied example does not — which is how the wiki came
to document an organization body the route had stopped accepting.

| Endpoint                                                                 | Response                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /onboarding/status`                                                 | `OnboardingStatusResponse` — `needs_onboarding`, `is_completed`, `current_step`, `total_steps`, `steps_completed`, `organization_name`                                                                                                                                                                 |
| `POST /onboarding/start`                                                 | `StartSessionResponse` — `session_id`, `expires_at`, `csrf_token`, `message`, `current_step`, `steps`. A client cannot proceed without the first three                                                                                                                                                 |
| `GET /onboarding/system-info`                                            | `SystemInfoResponse` — `app_name`, `version`, `environment`, `database`, `security`, `features`                                                                                                                                                                                                        |
| `GET /onboarding/security-check`                                         | `SecurityCheckResponse` — `passed`, `issues`, `warnings`, `total_issues`, `total_warnings`                                                                                                                                                                                                             |
| `GET /onboarding/database-check`                                         | `DatabaseCheckResponse` — `connected`, `database`, `host`, `port`, `server_time?`, `organizations_count?`, `error?`                                                                                                                                                                                    |
| `POST /onboarding/organization`, `POST /onboarding/session/organization` | `OrganizationSetupResponse` — `id`, `name`, `slug`, `organization_type`, `timezone`, `active`, `created_at`                                                                                                                                                                                            |
| `POST /onboarding/system-owner`                                          | `SystemOwnerResponse` — `id`, `username`, `email`, `first_name`, `last_name`, `membership_number`, `status`, `authenticated`. Also sets the auth cookies; `authenticated` is the signal the frontend uses to set its `has_session` hint, since the cookies themselves are httpOnly and invisible to it |
| `POST /onboarding/modules`                                               | `{ message, modules }` — every accepted id, not only the enabled ones. The boolean is the **stored** value only for the ids the wizard asks about; for settings-only and legacy ids it echoes the request, so `finance: true` can come back with the setting untouched (see Configure Modules)         |
| `POST /onboarding/notifications`                                         | `{ message, email_enabled, sms_enabled }` — the two booleans it was given                                                                                                                                                                                                                              |
| `POST /onboarding/reset`                                                 | `{ success, message, next_step }` — **destructive**: empties the user, organization, role, facility and onboarding tables. Refused after completion, and restricted to the System Owner once one exists (see Reset Onboarding)                                                                         |
| `POST /onboarding/complete`                                              | `{ message, organization, admin_user, completed_at, next_steps }`                                                                                                                                                                                                                                      |
| `POST /onboarding/session/roles`                                         | `RolesSetupResponse`                                                                                                                                                                                                                                                                                   |
| `POST /onboarding/session/positions`                                     | `PositionsSetupResponse`                                                                                                                                                                                                                                                                               |
| `GET /onboarding/session/data`                                           | `{ session_id, expires_at, data }` — no response model; `data` is a **sanitised** subset (see Read Session Data). Unusually for a read, it requires the `X-CSRF-Token` header as well as `X-Session-ID`                                                                                                |
| `POST /onboarding/test/email`                                            | `EmailTestResponse` — `success`, `message`, `details?`. Tests the connection without saving anything, and is rate-limited on its own scope so a department retrying it while fixing an SMTP typo cannot lock itself out of `/system-owner`                                                             |
| every other `POST /onboarding/session/*`, including `/session/email`     | `SessionDataResponse` — `success`, `message`, `step`                                                                                                                                                                                                                                                   |
| `GET /organization/setup-checklist`                                      | `SetupChecklistResponse` — `items`, `completed_count`, `total_count`, `enabled_modules`                                                                                                                                                                                                                |
| `POST /organization/setup-checklist/{item_key}/acknowledge`              | `{ item_key, acknowledged }`                                                                                                                                                                                                                                                                           |

**`/system-info`, `/security-check` and `/database-check` need `X-Session-ID`
too.** They read as unauthenticated preflight checks and are not: each calls
`validate_session(request, db, require_csrf=False)`, so a caller without the
header gets a 401 and one with a session but no CSRF token succeeds. That is the
opposite pairing from `/session/data`, which requires both — the three checks
are reads a client makes before it has done anything, while `/session/data`
reads back what was saved.

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

### Read Session Data

```
GET /api/v1/onboarding/session/data
```

Returns what a resumable session already holds. It is the router's only GET over
session state — the other four read system, security and database status.

**Nothing in the frontend calls it.** A repo-wide search of
`frontend/src/modules/onboarding/` finds no reference to the path and no
`getSessionData` on the API client; the wizard restores a refreshed step from its
persisted Zustand store instead. So this route exists for API consumers, and its
behaviour is not exercised by the screens.

**It requires `X-CSRF-Token` as well as `X-Session-ID`**, which is unusual for a
GET and easy to miss: `get_session_data` calls `validate_session(request, db)`
without overriding `require_csrf`, whose default is `True`. A caller who sends
only the session id gets a 403 (`AUTH_CSRF_INVALID`), not a 401, so the error
does not point at the missing header.

There is no response model. The shape is:

```json
{
  "session_id": "...",
  "expires_at": "2026-09-10T19:30:00+00:00",
  "data": {
    "department": {
      "name": "...",
      "logo": "...",
      "navigation_layout": "...",
      "saved_at": "..."
    },
    "email": { "platform": "gmail", "configured": true },
    "file_storage": { "platform": "s3", "configured": true },
    "auth": { "platform": "local", "saved_at": "..." },
    "it_team": { "members_count": 2, "has_backup_access": true },
    "modules": { "enabled": ["events", "inventory"], "saved_at": "..." }
  }
}
```

Every key inside `data` is omitted when the corresponding step has not been
saved, so an early-stage session returns `"data": {}`.

**`data` is sanitised, but not uniformly — each section is treated differently.** For
`email` and `file_storage` only the platform name is returned, plus a
`configured: true` that reports the section's _presence_ rather than its
validity — a skipped file-storage step stores `{}` and still comes back
`configured: true`. `auth` and `modules` are returned in full; that is safe
because `save_auth_config` stores only `{platform, saved_at}` and never the
Authentik or OAuth secrets. `department`, including the base64 logo, is returned
in full. The IT team is reduced to a count and a boolean, so the contact details
`/complete` later persists are never readable back.

It reads `session.data` and nothing else, so what it reports is the session blob,
not the state of any row a step may also have written.

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

Two routes accept this, and they take the **same** body — both bind
`OrganizationSetupCreate`:

- `POST /api/v1/onboarding/session/organization` — what the wizard calls. Also
  associates the new organization with the onboarding session.
- `POST /api/v1/onboarding/organization` — the same creation without that
  association. It was once a five-field "simple" variant and this document
  described it that way until 2026-09-10; it has taken the full schema for some
  time, so the old minimal body now fails validation with a 422.

**Use the session route.** The direct one validates the session and then
discards it — it never writes `session.data["department"]`. `/session/stations`
and `/session/apparatus` read `session.data["department"]["organization_id"]`
and nothing else, so after the direct route they answer
`400 Organization must be created before adding stations` even though the
organization row exists and is otherwise complete. A caller who takes the
direct route gets an organization it cannot then attach stations or apparatus
to, and no error names the reason.

**The wizard loses the same id at step 6, and this one is reachable from the
UI.** `save_department_info` replaces `session.data["department"]` wholesale —
`{name, logo, navigation_layout, saved_at}` — and `organization_id` is not
among the keys it writes back. Navigation Choice is step 6, straight after
Stations (4) and Apparatus (5), so the normal forward path stores the id at
step 3, uses it twice, then drops it. Every later save to `/session/stations`
or `/session/apparatus` answers
`400 Organization must be created before adding stations`, and the wizard has
Back buttons that lead there. Re-saving Organization Setup restores the id,
because `save_session_organization` writes the block again — but nothing tells
an installer that, and the error points at the organization rather than at the
step that erased the reference to it.

```
POST /api/v1/onboarding/session/organization
Body: {
  name: string,
  slug?: string,
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
  logo?: string,
  membership_id?: {   // omitted entirely when the department does not number members
    enabled: boolean,
    auto_generate: boolean,
    prefix: string,
    next_number: number
  }
}
```

Creates the organization with its addresses and identifiers, commits
immediately, and creates the headquarters facility and location from the
department address.

It also seeds the department's **positions** — `_create_default_roles`, despite
the name — from `DEFAULT_POSITIONS` in `permissions.py`, narrowed to what the
agency type actually has: an EMS-only service gets no Firefighter, and its chief
is a Chief rather than a Fire Chief. `it_manager` (priority 100, all
permissions) is the System Owner's position. This runs once per install, and
the Positions step later lets the department keep or drop what was seeded, and
add positions of its own. It does **not** rename a seeded one:
`save_session_roles` updates an existing position's permissions, priority and
description, and never assigns the submitted `name`. The response is actively
misleading about it: the handler appends `role_data.name` — the name that was
**submitted** — to `updated`, so a caller who renames a seeded position gets it
back in the `updated` list under the new name while the stored row keeps the
old one. Do not read that list as confirmation the rename persisted. The wizard
exposes no rename control for them either.

> The wiki described this as "creates 6 default roles: Super Admin, Admin,
> Chief, Officer, Member, Probationary" until 2026-09-10. That list was stale in
> both its contents and its vocabulary: they are positions, not roles, and a
> rank is the separate thing — a rank says where somebody sits, a position says
> what they may do.

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

Creates the administrator, hashes the password with Argon2id, gives them the
System Owner position, and writes an audit-log entry.

`password` is checked by `validate_password_strength()`, which every path into
`AuthService.register_user()` runs. A caller that meets only the length rule
still receives a 400, so the full contract is:

- **at least 12 characters on this endpoint**, whatever `PASSWORD_MIN_LENGTH`
  says, and no more than `PASSWORD_MAX_LENGTH` (128). `SystemOwnerCreate`
  hard-codes `min_length=12` on `password` and `password_confirm`, so the
  effective floor is `max(12, PASSWORD_MIN_LENGTH)`. A deployment that lowers
  the setting — which config permits, with only a warning from the security
  check — still gets a schema-level 422 here, raised by Pydantic before
  `validate_password_strength()` runs, so none of the rules below are reported
  with it
- at least one uppercase letter, one lowercase letter, one number and one
  special character — each class is separately configurable
  (`PASSWORD_REQUIRE_UPPERCASE` and its three siblings) and all four are on by
  default
- no three sequential characters anywhere in it (`123`, `abc`, …) and no
  character repeated three times in a row
- no keyboard pattern anywhere in it: `qwerty`, `asdfgh`, `zxcvbn`, `qazwsx`,
  `qweasd`, `!@#$%^`, `1qaz2wsx`, `1234qwer`, `asdf1234`
- not a common password. This one is an **exact match** against a fixed list,
  not a substring test like the two above, and the list includes
  department-flavoured entries (`firefighter`, `station`, `medic`, `ambulance`)
  alongside the usual ones
- where the breached-password check is configured, not present in the breach
  corpus. That check **fails open** — an outage skips it rather than blocking a
  password change (see the Attack Protection table in CLAUDE.md)

The rules above are aggregated: a password breaking more than one comes back as
`Password requirements not met (N issues): …` with the whole list. Two things
sit outside that aggregation, so a caller can be rejected twice for one
password:

- **Over `PASSWORD_MAX_LENGTH` returns immediately**, reporting only the length.
  Nothing else is evaluated — the ceiling exists to keep an unbounded input out
  of Argon2, so the check runs before any work is done on the value.
- **The breach check runs only after every local rule passes.**
  `AuthService.register_user()` calls `validate_password_strength()` first and
  `check_password_not_breached()` after it, so a password that is both weak and
  breached reports the local failures, and only reveals the breach hit once
  those are fixed.

This is the one bootstrap call that creates the administrator, so a rejection
here has no signed-in user to retry it.

### Configure Modules

```
POST /api/v1/onboarding/session/modules
Body: {
  modules: string[]
}
```

Saves enabled module configuration.

### Configure Modules (Direct)

```
POST /api/v1/onboarding/modules
Body: {
  enabled_modules: string[]   // e.g. ["training", "inventory", "scheduling"]
}
```

The non-session counterpart. It validates the onboarding session and refuses
once onboarding is complete, so a still-valid session cannot be replayed to
change module settings after setup. The response reports every module with its
resulting boolean, not only the ones enabled — with the caveat below.

Only the ids the wizard asks about are applied to the organization —
`ONBOARDING_CORE_MODULES` (`members`, `events`, `documents`, `forms`) and
`ONBOARDING_OFFERED_MODULES` (`training`, `inventory`, `medical_supplies`,
`scheduling`, `apparatus`, `facilities`, `storefront`, `elections`, `minutes`,
`reports`, `notifications`, `mobile`, `integrations`, `prospective_members`). Two other groups are accepted by validation and go nowhere:

- **Settings-only** (`communications`, `finance`, `grants`, `hr_payroll`,
  `incidents`, `medical_screening`, `public_info`, `testing`) — real
  `ModuleSettings` fields, but `configure_modules` writes
  `key in normalized if key in asked_about else <default>`, so these keep their
  default. **The response disagrees with what is stored**: it is built as
  `{module: module in final_modules}` over every accepted id, so submitting
  `finance` returns `finance: true` while `settings.modules.finance` stays at
  its default. Turn these on from Settings → Modules after setup.
- **Legacy** (`compliance`, `meetings`, `fundraising`, `equipment`, `vehicles`,
  `budget`) — accepted so an older saved session still loads, but not
  `ModuleSettings` fields at all: recorded on `OnboardingStatus` and no further.

**A sixth spelling group: hyphenated aliases.** `ONBOARDING_ACCEPTED_MODULE_IDS`
runs every id through `_with_hyphenated()`, so wherever an underscored id is
accepted its hyphenated twin is too — `medical-supplies`,
`prospective-members`, `hr-payroll`, `medical-screening` and `public-info`.
They exist because saved sessions carry both spellings and the wizard's own
config routes were hyphenated.

Persistence normalizes them (`mid.replace("-", "_")`), so submitting
`medical-supplies` correctly stores `medical_supplies: true`. **The response
does not normalize.** It is keyed off `available_modules`, which holds both
spellings, and tested against `final_modules`, which holds the literal id you
sent — so the same response carries `"medical-supplies": true` _and_
`"medical_supplies": false`, describing one module twice with opposite answers.
The underscored key is the one that is wrong. Prefer the underscored spelling
on the way in and the stored settings on the way out.

So the response reports the resulting boolean **for the asked-about ids only**;
for the other two groups it echoes the request, and for a hyphenated alias it
answers under a key nothing reads.

**The wizard's own path does not behave this way.** The screens call
`POST /onboarding/session/modules`, and completion rebuilds the whole map as
`{k: k in normalized for k in ModuleSettings.model_fields}` — with no
`else <default>` branch. Every settings-only module is therefore written
`false` by finishing setup, rather than keeping its default. Exactly one is
affected today, and it is a live regression rather than a hypothetical:
`public_info` defaults to **true** and the wizard never offers it, so
completing onboarding turns the Public Information module off. The other seven
default to false, so the two paths agree on them by coincidence.

That holds only when something was submitted. `_persist_session_data_to_org()`
guards the rebuild with `if modules_data and modules_data.get("enabled")`, and
an empty list is falsy — so a caller who posts `{modules: []}` to
`/session/modules` has it stored, and completion then skips the whole block.
`Organization.settings.modules` is never written, every declared default
survives, and `public_info` stays **true**. Selecting nothing and selecting
everything-but therefore diverge sharply, and the empty case is the one that
leaves defaults intact.

Both halves of this are worth knowing before relying on either route: the
direct route preserves defaults and misreports the result, the session route
reports nothing per-module and silently overwrites defaults.

### Save Department Info

```
POST /api/v1/onboarding/session/department
Body: {
  name: string,                        // 3-100 characters
  logo?: string,                       // base64-encoded image
  navigation_layout: "top" | "left"    // required; anything else is a 422
}
```

What the Navigation Choice step submits. `navigation_layout` is validated
against exactly those two literals by a `field_validator`, so a plausible
guess (`sidebar`, `horizontal`) is refused.

This is the one session group `/complete` does **not** copy into
`Organization.settings` — see Complete Onboarding — so the layout choice and
the name recorded here stay on the session row. The organization's own name and
logo come from the organization routes, not from this call.

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

### Save Email Configuration

```
POST /api/v1/onboarding/session/email
Body: {
  platform: "gmail" | "microsoft" | "selfhosted" | "cloudflare" | "other",
  config: { ... }   // platform-specific; see the key table below
}
```

`config` is typed as a free dict by the schema, so nothing validates its keys on
the way in. `_email_settings_from_onboarding()` maps **exact camelCase** names;
anything it does not recognise — a snake_case guess, say — is dropped silently.
On `gmail`, `microsoft` and `selfhosted` the write is then rejected for a field
the caller believes it sent; on `cloudflare` it is not (see below).

| Platform     | Keys                                                                                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| all          | `fromEmail`, `fromName`                                                                                                                                                           |
| `gmail`      | `googleAppPassword`                                                                                                                                                               |
| `microsoft`  | `microsoftAuthMethod` (`"app_password"` or `"oauth"`), and for OAuth `microsoftTenantId`, `microsoftClientId`, `microsoftClientSecret`; for `app_password` `microsoftAppPassword` |
| `selfhosted` | `smtpHost`, `smtpPort`, `smtpUsername`, `smtpPassword`, `smtpEncryption`                                                                                                          |
| `other`      | none — see below                                                                                                                                                                  |
| `cloudflare` | `cloudflareAccountId`, `cloudflareApiToken`                                                                                                                                       |

Do **not** put `enabled` or `platform` inside `config`. The mapper never reads
them: `platform` is the top-level field, and enablement is derived as
`platform != "other" and bool(config)`. A caller who sets `config.enabled: false`
alongside valid credentials gets a success response and a configuration stored
**enabled**.

`other` is the configure-later choice, not a custom-SMTP one: it forces
`enabled` to false whatever `config` holds, so SMTP fields sent with it are
stored disabled. Custom SMTP goes under `selfhosted`.

**Disabled here does not mean the installation sends no mail.**
`EmailService._get_smtp_config()` takes the organization's section only when it
is `enabled`, and otherwise falls through to the deployment's `SMTP_*` settings.
So on a deployment with a global relay configured, choosing `other` leaves
transactional mail going out through that relay; what it disables is the
configuration onboarding collected, not outbound email.

`fromEmail` is required on `gmail`, `microsoft` and `selfhosted`. On the two
presets it doubles as the SMTP login — `resolve_smtp_settings()` returns
`user: from_email` for them, because an App Password is issued per account, so
the account that logs in is the account the mail is sent from and one field
covers both; a malformed address there fails authentication rather than merely
delivery. **On `selfhosted` it does not**: that branch returns
`user: smtp_user`, so the sending address and the login are independent fields
and `fromEmail` alone authenticates nothing. The provider password field is
required on `gmail`; all three Microsoft OAuth fields are required together. **`cloudflare` is checked for none of this** —
`missing_for_enabled()` handles the two presets and `selfhosted` and falls
through for it — so a Cloudflare payload with no `fromEmail` is accepted and
stored enabled, and nothing downstream supplies the address it lacks.
`EmailService._get_smtp_config()` short-circuits on the organization's own
`enabled` flag, so it returns the org section with `from_email: None` rather
than falling back to `SMTP_FROM_EMAIL`; `_get_cloudflare_config()` then resolves
`org_email["from_email"] or self._smtp_config["from_email"]`, which is `None` on
both sides. **A globally configured sender does not rescue this payload** — the
write succeeds and every send builds an invalid From address. Same gap as the
account-ID and token one below, from the same missing branch.

On `selfhosted` **the backend** requires only `smtpHost` and `fromEmail`.
`smtpUsername` and `smtpPassword` are a pair there: an anonymous relay with
neither is a complete configuration, while a username without a password is
rejected — that combination means a credential was not restored rather than one
that was never needed. Because the sending address is not the login on this
platform, omitting both leaves the connection unauthenticated: that is correct
for an internal relay that authorises by network, and silently wrong for any
server that expects credentials, where the write succeeds and delivery fails
later. Send `smtpUsername` and `smtpPassword` unless the relay genuinely takes
neither.

**The wizard is stricter, so an anonymous relay is an API-only configuration.**
`EmailConfiguration.tsx` adds Server Address, Port, Username _and_ Password to
its missing-fields list for `selfhosted`, in both `handleTestConnection` and
`handleContinue`, so the screen refuses before it calls either endpoint. An
installer cannot set up a relay that needs no credentials; a caller posting to
`/session/email` can.

`microsoftAuthMethod` takes exactly `"app_password"` or `"oauth"`. Omitting it
means App Password — every Microsoft row written before OAuth existed carries no
method, so absence has to keep authenticating the way it always did. Any other
value is refused with a 400 rather than stored, because every reader treats an
unrecognised method as App Password and the settings schema each read rebuilds
through rejects it, which would lock the organization out of the screen that
could fix it.

**`cloudflare` is not checked at all.** `missing_for_enabled()` covers the
preset platforms (`gmail`, `microsoft`) and `selfhosted`; `cloudflare` falls
through it and returns nothing missing. So a non-empty `cloudflare` config whose
keys were all dropped — snake_case guesses, or a typo — is accepted, reported as
saved, and persisted **enabled** with no account ID and no API token. Nothing
surfaces until mail fails to send. `invalid_for_enabled()` is narrower still: it
only judges the Microsoft OAuth tenant and client IDs.

**The 400 does not name a key in either spelling.** `save_email_config` passes
the field `missing_for_enabled()` returns through `required_field_message()`,
which renders it as prose from a label table — `smtp_host` becomes
`Enabling selfhosted email requires an SMTP host. Enter it, or leave email
disabled.` A caller who guessed snake_case therefore gets a message that names
neither `smtpHost` nor `smtp_host`, so nothing in the response points at the key
they should have sent. Match the label back to the table above to find it.

What actually stores mail settings. Passwords and API keys inside `config` are
encrypted with AES-256 before they are written; only `platform` is kept in plain
text. `POST /onboarding/complete` later persists the result into the
organization's settings. Rejected once onboarding is complete, so a still-valid
session cannot keep rewriting a finished organization's data.

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

**Records that the step happened; it does not store credentials.** The handler
sets `email_configured` from `email_enabled`, marks the `email_config` step
complete, and returns the two booleans it was given. Every other field in the
body — the SMTP host, user and from-address, the Twilio SID and number — is
discarded. A caller that sends credentials here gets a success response and has
configured nothing; **Save Email Configuration** above is the endpoint that
stores them.

### Reset Onboarding

```
POST /api/v1/onboarding/reset
Body: none
```

**Destructive and irreversible.** It empties the tables outright —
`OnboardingSession`, `OnboardingStatus`, `Location`, `Facility`, `User`, `Role`
and `Organization` among them — rather than deleting a single organization's
rows. There is no undo and no confirmation beyond the two guards below. The
wizard reaches it from `ResetProgressButton`.

Two guards, and the second is the one an API caller will not expect:

- **Refused after completion** — `Cannot reset after onboarding is completed.
Use the admin panel to manage settings.` So it is a bootstrap-only escape
  hatch, not a factory reset.
- **Once a System Owner exists, only that user may call it.** The owner is
  identified by the wildcard position `create_system_owner` grants, and the
  caller must be authenticated as them; anyone else gets
  `System-owner authentication is required to reset onboarding.` Before a
  System Owner exists no **user** authentication is required, which is what
  makes an abandoned half-finished setup recoverable — but the call is not
  open: `reset_onboarding` runs `validate_session` first, so a live
  `X-Session-ID` and its matching `X-CSRF-Token` are needed either way. A
  recovery client without those gets a 401 or 403 before any of the checks
  below are reached. If the system-owner position is
  missing entirely the reset is refused rather than allowed —
  `System-owner role is missing; onboarding cannot be reset safely.` — failing
  closed on the one operation where failing open would be unrecoverable.

Returns `{ success, message, next_step }`, where `next_step` is
`"Navigate to /onboarding/start to begin again"` — the only pointer a caller
gets back after an operation that has just deleted the users, organization
and session it was working with. Rate-limited on its own scope, like
`/test/email`.

### Complete Onboarding

```
POST /api/v1/onboarding/complete
Body: {
  notes?: string
}
```

Marks onboarding as finished, and does three further things worth knowing:

- **Persists five settings groups** into `Organization.settings`: IT team,
  email configuration, file storage, auth choice and module selections. Those
  are held in the session until now and reach the organization here.

  **What happens when one of them fails differs per group, and the differences
  matter more than the similarity.** Take the case of an `ENCRYPTION_KEY`
  rotated without the previous key, so no stored ciphertext decrypts:

  | Group        | On failure                                                                                                                                                                                               |
  | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Email        | **Completion is refused.** `_incomplete_session_email()` runs _before_ anything is persisted and returns 400                                                                                             |
  | File storage | **Silent.** Its whole block is a `try/except Exception` that logs a warning and continues                                                                                                                |
  | IT team      | Contacts persist regardless — the settings assignment is outside any `try`. Only `create_it_team_users()` is wrapped, so the contacts are recorded while their **login accounts** may silently not exist |
  | Auth         | Not wrapped; a plain assignment that cannot fail this way                                                                                                                                                |
  | Modules      | Not wrapped; likewise                                                                                                                                                                                    |

  So file storage is the group that leaves a department complete with no
  platform and no credentials recorded, having seen nothing but a success
  screen; a log warning is the only trace. Email is the opposite — it blocks
  completion with an error naming the step to return to. The email block inside
  `_persist_session_data_to_org()` has its own `try/except` as well, but it
  covers what happens _after_ that pre-check has already decrypted the section
  successfully, such as re-encryption failing.

  This is **not** true of `/session/*` generally, and assuming it is gets the
  picture backwards in both directions. `/session/organization`,
  `/session/stations`, `/session/apparatus`, `/session/roles` and
  `/session/positions` commit their rows when they are called, so those writes
  are already durable before `/complete` runs. What the session keeps
  afterwards differs by step: `/session/stations` and `/session/apparatus`
  record only `facility_ids` / `apparatus_ids` and a count, while
  `/session/roles` — and `/session/positions`, which delegates to it — record
  `{id, name, priority}` for every submitted role. Descriptions and permission
  lists are written to the `Role` rows and are **not** copied into the session. In the other direction, `/session/department` is never
  copied into settings at all: `_persist_session_data_to_org()` reads
  `it_team`, `email`, `file_storage`, `auth` and `modules` and nothing else,
  so the department block never reaches the organization.

  It does not follow that it goes away. **A completed session's row is never
  deleted.** Neither `/complete` nor `OnboardingService.complete_onboarding()`
  removes it, no scheduled job reaps expired rows, and the only statement in
  the backend that deletes from this table is inside `/onboarding/reset` —
  which is refused once onboarding is complete. Expiry (`expires_at`) stops
  the row validating; it does not remove it.

  So every finished installation keeps its onboarding session indefinitely,
  holding the encrypted email and file-storage credentials plus, as plain JSON
  rather than encrypted: the IT-team members and backup-access contact details,
  the department name, its uploaded logo (base64 or a URL, as validated at save
  time) and the navigation choice, the created facility and apparatus ids, the
  id, name and priority of every position the department configured, the chosen
  auth provider, the module selections, and the email and file-storage platform
  names. The row itself also carries the `session_id`, the **`ip_address`** the
  setup was run from and the **`user_agent`** of the browser that ran it — both
  columns on `onboarding_sessions`, written at creation for security tracking —
  and `data["csrf_token"]`. Retained with them is the activity metadata a
  retention review has to count as well: the row's `id`, `expires_at`,
  `created_at` and `updated_at` columns, and the plaintext `saved_at` stamped
  into every section as it is written, which together record when the setup was
  run and how long it took. Position descriptions and permission lists are
  **not** among them — those live on the `Role` rows. `/complete` clears the browser's copy
  thoroughly — a successful `completeOnboarding()` calls
  `clearSession({ preserveAuth: true })`, which removes the session and CSRF
  identifiers **and** `onboarding_data` and the whole persisted
  `onboarding-storage` wizard state, so the names, logos and answers held
  client-side do go (the in-memory Zustand state survives until reload). It is
  the server row that stays.
  Worth knowing for a retention review, and worth stating here because
  "session" invites the assumption that it is transient.

- **Seeds default data**: `_seed_default_data()` creates the standard admin
  hours categories and event mappings so hour tracking works immediately after
  setup. It attributes them to the oldest organization and to **whichever user
  the database returns first** — the query is `select(User).limit(1)` with no
  `order_by`, so `created_by` is not guaranteed to be the System Owner. When
  onboarding also created IT-team accounts, one of those ordinary members can
  be recorded as the creator. Treat `created_by` on a seeded category as
  unspecified rather than meaningful.

  It is also **best-effort** — the whole body is wrapped in `try/except` and a
  failure is logged as `Non-critical: failed to seed admin hours defaults`
  while completion continues. So an installation can complete successfully and
  still lack these defaults, and the only trace is that warning. Worth knowing
  before concluding the categories were deleted.

- **Writes an audit entry** — `onboarding.completed`, recording the
  organization name, admin username and enabled modules.

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
    "fileStoragePlatform": "local",             // "googledrive" | "onedrive" | "s3" | "local" | "other" | null

    // Authentication
    "authPlatform": "local",                    // "google" | "microsoft" | "authentik" | "local" | null

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

**Not persisted** (excluded from localStorage for security):

- `sessionId` — stored in `sessionStorage` as `onboarding_session_id`, limiting the
  short-lived bearer identifier to the current tab and browser session
- `csrfToken` — stored in **`sessionStorage`** as `onboarding_csrf_token`,
  and sent explicitly as the `X-CSRF-Token` header on every protected
  onboarding mutation. It is **not** a cookie: nothing in the backend sets
  `onboarding_csrf_token`, and the client reads a cookie of that name only to
  migrate a value an older build left, after which it deletes it. A client
  written against the cookie contract sends no header and takes a 403 on every
  mutation. This differs from the main app, where CSRF _is_ a double-submit
  cookie — the onboarding client is tab-scoped by design, matching the session
  identifier beside it.
- `errors` — only kept in memory

**Legacy compatibility**: The `syncWithSessionStorage()` function in the store reads from `sessionStorage` on first load if the Zustand store is empty, migrating any data from the older approach. Separately, `loadSession()` and `clearSession()` in the API client delete any `onboarding_session_id` left in `localStorage` by a client built before 2026-08-15, so a stale identifier is dropped rather than presented.

#### The two stores have different lifetimes — and that is user-visible

The wizard's answers and the wizard's credential do not expire together, which
produces the one confusing state in this flow:

|                        | Wizard answers                       | Session identifier                                      |
| ---------------------- | ------------------------------------ | ------------------------------------------------------- |
| Key                    | `localStorage['onboarding-storage']` | `sessionStorage['onboarding_session_id']`               |
| Survives a tab close   | **Yes**                              | No                                                      |
| Visible to another tab | **Yes**                              | No                                                      |
| Server-side lifetime   | n/a                                  | 30-minute sliding expiry (`SESSION_EXPIRY_HOURS = 0.5`) |

So reopening `/onboarding` after a browser restart **repaints every answer already
typed while the server session behind them is gone.** The wizard looks resumable
and is not. The failure surfaces at the next mutating step as `401` /
`ONBD_SESSION_INVALID`, not at the repaint — which is the wrong moment for the
user to learn about it, and the reason the guides and script 02 carry this
explicitly.

The obvious tightening — clearing `onboarding-storage` whenever the identifier is
missing — was deliberately **not** done, because it would discard a part-finished
department profile every time an installer glanced at another tab and came back.
See [`KNOWN_LIMITATIONS.md`](./KNOWN_LIMITATIONS.md) → "Onboarding Cannot Be
Resumed Across a Browser Restart" for the open decision.

**Edge cases:**

- **A new tab does not inherit the run** and starts its own session. A
  _duplicated_ tab does carry the identifier — Chrome and Firefox copy
  `sessionStorage` into duplicates — but that is browser behavior, not a
  supported resume path, and must not be documented as one.
- **`403` / `ONBD_ALREADY_COMPLETED` is a different condition entirely**: an
  organization row already exists, so `get_or_create_session()` refuses to open a
  new session. The installer should sign in, not restart setup.
- **`ResetProgressButton` calls `sessionStorage.clear()`**, so it discards the
  identifier by construction.

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
   sessionStorage.removeItem('onboarding_session_id')
   document.cookie = 'onboarding_csrf_token=; path=/; max-age=0'

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
- **Module Permission Config Persistence**: `modulePermissionConfigs` replaces hardcoded role lists and fake save handlers with real store persistence _(the step it persisted for has since been removed — see 13a; the store field went with it)_
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
