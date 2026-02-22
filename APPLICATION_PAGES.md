# The Logbook - Application Pages & URLs

Complete reference of all pages in the application, organized by module.

---

## Public Pages (No Authentication Required)

| URL | Page | Description |
|-----|------|-------------|
| `/` | Welcome | Landing / onboarding entry point |
| `/login` | Login | User authentication |
| `/forgot-password` | Forgot Password | Password reset request |
| `/reset-password` | Reset Password | Password reset form |
| `/f/:slug` | Public Form | Public form submission (token-based) |
| `/ballot` | Ballot Voting | Public ballot voting (token-based) |
| `/display/:code` | Location Kiosk Display | QR code display for tablets in rooms (display-code-based) |

---

## Onboarding

| URL | Page | Description |
|-----|------|-------------|
| `/onboarding` | Onboarding Check | Entry point / status check |
| `/onboarding/start` | Organization Setup | Step 1 - create organization |
| `/onboarding/navigation-choice` | Navigation Choice | Choose navigation layout |
| `/onboarding/email-platform` | Email Platform | Select email provider |
| `/onboarding/email-config` | Email Configuration | Configure email settings |
| `/onboarding/file-storage` | File Storage | Choose file storage provider |
| `/onboarding/file-storage-config` | File Storage Config | Configure file storage |
| `/onboarding/authentication` | Authentication | Choose auth method |
| `/onboarding/it-team` | IT Team & Backup | IT team & backup access setup |
| `/onboarding/positions` | Position Setup | Configure positions (formerly roles) |
| `/onboarding/modules` | Module Selection | Choose which modules to enable |
| `/onboarding/modules/:moduleId/config` | Module Config | Configure individual module |
| `/onboarding/system-owner` | System Owner Creation | Create initial system owner account |
| `/onboarding/security-check` | Security Check | Security verification |

**Legacy redirects:**
- `/onboarding/department` → `/onboarding/start`
- `/onboarding/roles` → `/onboarding/positions`
- `/onboarding/admin-user` → `/onboarding/system-owner`
- `/onboarding/module-selection` → `/onboarding/modules`

---

## Dashboard

| URL | Page | Permission |
|-----|------|------------|
| `/dashboard` | Main Dashboard | Authenticated |

---

## Members

### Member-Facing Pages

| URL | Page | Permission |
|-----|------|------------|
| `/members` | Member Directory | Authenticated |
| `/members/:userId` | Member Profile | Authenticated |
| `/members/:userId/training` | Member Training History | Authenticated |

### Members Admin Hub (`/members/admin`)

Requires `members.manage` permission. Tab-based admin interface.

| Tab | Label | Additional Permission |
|-----|-------|-----------------------|
| `manage` | Member Management | — |
| `add` | Add Member | `members.create` |
| `import` | Import Members | `members.create` |

**Legacy redirects:**
- `/admin/members` → `/members/admin`
- `/members/add` → `/members/admin?tab=add`
- `/members/import` → `/members/admin?tab=import`

---

## Prospective Members

| URL | Page | Permission |
|-----|------|------------|
| `/prospective-members` | Prospective Members Pipeline | `prospective_members.manage` |
| `/prospective-members/settings` | Pipeline Settings | `prospective_members.manage` |

---

## Apparatus

| URL | Page | Permission |
|-----|------|------------|
| `/apparatus` | Apparatus List | Authenticated |
| `/apparatus/new` | Add Apparatus | Authenticated |
| `/apparatus/:id` | Apparatus Detail | Authenticated |
| `/apparatus/:id/edit` | Edit Apparatus | Authenticated |
| `/apparatus-basic` | Apparatus Basic | Authenticated |

> `/apparatus-basic` is a lightweight alternative used when the full Apparatus module is disabled.

---

## Events

### Member-Facing Pages

| URL | Page | Permission |
|-----|------|------------|
| `/events` | Events List | Authenticated |
| `/events/:id` | Event Detail | Authenticated |
| `/events/:id/qr-code` | Event QR Code | Authenticated |
| `/events/:id/check-in` | Self Check-In | Authenticated |

### Per-Event Admin Pages

| URL | Page | Permission |
|-----|------|------------|
| `/events/:id/edit` | Edit Event | `events.manage` |
| `/events/:id/monitoring` | Check-In Monitoring | `events.manage` |
| `/events/:id/analytics` | Event Analytics | `analytics.view` |

### Events Admin Hub (`/events/admin`)

Requires `events.manage` permission. Tab-based admin interface.

| Tab | Label |
|-----|-------|
| `create` | Create Event |
| `analytics` | Analytics |
| `community` | Community Engagement |

**Legacy redirects:**
- `/events/new` → `/events/admin?tab=create`

---

## Locations (when Facilities module is off)

| URL | Page | Permission |
|-----|------|------------|
| `/locations` | Locations Management | Authenticated |

> Manages stations, addresses, and rooms for use by events, training, QR code check-in, and other modules. Each room gets a unique kiosk display code for tablet-based QR check-in.

---

## Facilities (when Facilities module is on)

| URL | Page | Permission |
|-----|------|------------|
| `/facilities` | Facilities Management | `facilities.view` |

Tab-based interface with the following views:

| Tab | Label |
|-----|-------|
| `facilities` | Facilities |
| `maintenance` | Maintenance |
| `inspections` | Inspections |

> Full building management including maintenance scheduling, utility tracking, inspections, key management, compliance, and capital projects. Replaces the Locations page when enabled. Locations created through either module are linked via `facility_id` so all event/training location references remain consistent.

---

## Training

### Member-Facing Pages

| URL | Page | Permission |
|-----|------|------------|
| `/training` | My Training | Authenticated |
| `/training/my-training` | My Training | Authenticated |
| `/training/submit` | Submit Training | Authenticated |
| `/training/courses` | Course Library | Authenticated |
| `/training/programs` | Training Programs | Authenticated |
| `/training/programs/:programId` | Program Detail | Authenticated |

### Training Admin Hub (`/training/admin`)

Requires `training.manage` permission. Tab-based admin interface.

| Tab | Label |
|-----|-------|
| `dashboard` | Officer Dashboard |
| `submissions` | Review Submissions |
| `requirements` | Requirements |
| `sessions` | Create Session |
| `compliance` | Compliance Matrix |
| `expiring-certs` | Expiring Certs |
| `pipelines` | Pipelines |
| `shift-reports` | Shift Reports |
| `integrations` | Integrations |
| `import` | Import History |

**Legacy redirects:**
- `/training/officer` → `/training/admin?tab=dashboard`
- `/training/submissions` → `/training/admin?tab=submissions`
- `/training/requirements` → `/training/admin?tab=requirements`
- `/training/sessions/new` → `/training/admin?tab=sessions`
- `/training/programs/new` → `/training/admin?tab=pipelines`
- `/training/shift-reports` → `/training/admin?tab=shift-reports`
- `/training/integrations` → `/training/admin?tab=integrations`

---

## Documents

| URL | Page | Permission |
|-----|------|------------|
| `/documents` | Documents | Authenticated |

---

## Inventory

### Member-Facing Pages

| URL | Page | Permission |
|-----|------|------------|
| `/inventory` | Inventory Browse | Authenticated |

### Inventory Admin Hub (`/inventory/admin`)

Requires `inventory.manage` permission. Tab-based admin interface.

| Tab | Label |
|-----|-------|
| `manage` | Manage Inventory |
| `members` | Members |

> The Manage Inventory tab provides full item/category CRUD. The Members tab shows per-member inventory assignments with barcode check-out/return capability.

---

## Scheduling

| URL | Page | Permission |
|-----|------|------------|
| `/scheduling` | Scheduling | Authenticated |

Tab-based interface with the following views:

| Tab | Label | Admin Only |
|-----|-------|------------|
| `schedule` | Schedule | No |
| `my-shifts` | My Shifts | No |
| `open-shifts` | Open Shifts | No |
| `requests` | Requests | No |
| `templates` | Templates | Yes |
| `reports` | Reports | Yes |
| `settings` | Settings | Yes |

---

## Elections

| URL | Page | Permission |
|-----|------|------------|
| `/elections` | Elections List | Authenticated |
| `/elections/:id` | Election Detail | Authenticated |

---

## Minutes

| URL | Page | Permission |
|-----|------|------------|
| `/minutes` | Minutes List | Authenticated |
| `/minutes/:minutesId` | Minutes Detail | Authenticated |

---

## Action Items

| URL | Page | Permission |
|-----|------|------------|
| `/action-items` | Action Items | Authenticated |

> Unified cross-module action items view.

---

## Forms

| URL | Page | Permission |
|-----|------|------------|
| `/forms` | Forms Management | Authenticated |

---

## Notifications

| URL | Page | Permission |
|-----|------|------------|
| `/notifications` | Notifications | Authenticated |

---

## Reports

| URL | Page | Permission |
|-----|------|------------|
| `/reports` | Reports | Authenticated |

---

## Integrations

| URL | Page | Permission |
|-----|------|------------|
| `/integrations` | Integrations | Authenticated |

---

## User Account

| URL | Page | Permission |
|-----|------|------------|
| `/account` | User Account Settings | Authenticated |

## Settings & Administration

| URL | Page | Permission |
|-----|------|------------|
| `/settings` | Organization Settings | `settings.manage` |
| `/settings/roles` | Role Management | `positions.manage_permissions` |
| `/setup` | Department Setup | `settings.manage` |
| `/admin/errors` | Error Monitoring | `settings.manage` |
| `/admin/analytics` | Analytics Dashboard | `analytics.view` |
| `/admin/public-portal` | Public Portal Admin | `settings.manage` |

---

**Total: ~75 direct routes + 25 admin hub tabs across 16 modules**
