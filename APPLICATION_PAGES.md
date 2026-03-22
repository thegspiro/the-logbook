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

### Members Admin Pages

| URL | Page | Permission |
|-----|------|------------|
| `/members/admin/edit/:userId` | Admin Member Edit | `members.manage` |
| `/members/admin/history/:userId` | Member Audit History | `members.manage` |
| `/members/admin/waivers` | Waiver Management | `members.manage` |

> **Admin Edit** provides full member editing (all fields, rank/station dropdowns, status, roles). **Audit History** shows timestamped change log. **Waiver Management** is a unified page covering training, meeting, and shift waivers with Active/Create/History tabs.

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

### Events Module Pages (2026-03-13)

| URL | Page | Permission |
|-----|------|------------|
| `/events/analytics` | Event Analytics Dashboard | `analytics.view` |
| `/events/templates` | Event Templates Management | `events.manage` |

> **Event Analytics Dashboard** shows summary cards (total events, RSVPs, check-ins, attendance rate), event type distribution chart, monthly trends chart, top events table, and date range filtering. **Event Templates Management** lists all templates with create/edit/toggle/delete actions.

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
| `/facilities` | Facilities Dashboard | `facilities.view` |
| `/facilities/:id` | Facility Detail | `facilities.view` |
| `/facilities/maintenance` | Cross-Facility Maintenance | `facilities.view` |
| `/facilities/inspections` | Cross-Facility Inspections | `facilities.view` |

> The **Dashboard** shows summary statistics (total facilities, pending maintenance, upcoming inspections), a recent activity feed, and a searchable facility card grid. The **Facility Detail** page uses sidebar navigation to sections: overview, rooms, building systems, maintenance, inspections, utilities, emergency contacts, access keys, shutoff locations, capital projects, insurance, occupants, and compliance checklists. Rooms auto-sync linked Location records for Events and QR check-in. Cross-facility **Maintenance** and **Inspections** pages provide department-wide views. Replaces the Locations page when enabled. Locations created through either module are linked via `facility_id` so all event/training location references remain consistent.

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
| `waivers` | Training Waivers |
| `submissions` | Review Submissions |
| `requirements` | Requirements |
| `sessions` | Create Session |
| `compliance` | Compliance Matrix |
| `expiring-certs` | Expiring Certs |
| `pipelines` | Pipelines |
| `shift-reports` | Shift Reports |
| `integrations` | Integrations |
| `import` | Import History |

> The **Training Waivers** tab (within Officer Dashboard) shows all training waivers with summary cards, status filtering, and source tracking (Auto LOA vs Manual).

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
| `/inventory` | Inventory Items List | Authenticated |
| `/inventory/my-equipment` | My Equipment | Authenticated |
| `/inventory/items/:id` | Item Detail | Authenticated |
| `/inventory/storage-areas` | Storage Areas | Authenticated |

### Inventory Admin Hub (`/inventory/admin`)

Requires `inventory.manage` permission. Dashboard with summary stats (total items, low stock, overdue checkouts, pending requests) and navigation to admin sub-pages.

### Inventory Admin Pages

| URL | Page | Permission |
|-----|------|------------|
| `/inventory/admin` | Admin Dashboard | `inventory.manage` |
| `/inventory/admin/items` | Manage Items | `inventory.manage` |
| `/inventory/admin/pool` | Pool Items | `inventory.manage` |
| `/inventory/admin/categories` | Categories | `inventory.manage` |
| `/inventory/admin/maintenance` | Maintenance Records | `inventory.manage` |
| `/inventory/admin/members` | Members Inventory | `inventory.manage` |
| `/inventory/admin/charges` | Charges & Fees | `inventory.manage` |
| `/inventory/admin/returns` | Return Requests | `inventory.manage` |
| `/inventory/admin/requests` | Equipment Requests | `inventory.manage` |
| `/inventory/admin/write-offs` | Write-Off Requests | `inventory.manage` |
| `/inventory/admin/reorder` | Reorder Requests | `inventory.manage` |
| `/inventory/checkouts` | Active Checkouts | `inventory.manage` |
| `/inventory/import` | CSV Import | `inventory.manage` |
| `/inventory/admin/kits` | Equipment Kits | `inventory.manage` |
| `/inventory/admin/variant-groups` | Variant Groups | `inventory.manage` |
| `/inventory/print-labels` | Barcode Label Printing | Authenticated |

> The admin dashboard provides summary statistics and quick-link navigation with grouped card sections. Individual sub-pages handle items, pool items, categories, maintenance, members, charges, return/equipment/write-off/reorder requests, equipment kits, and variant groups. The Item Detail page (`/inventory/items/:id`) has a two-column layout with barcode sidebar and tabbed content (overview, history, maintenance, NFPA compliance). Non-admin users see only their own assigned equipment on the inventory dashboard.

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

### Scheduling Admin Pages (2026-03-19)

| URL | Page | Permission |
|-----|------|------------|
| `/scheduling/templates` | Shift Templates Management | `scheduling.manage` |
| `/scheduling/patterns` | Shift Pattern Management | `scheduling.manage` |
| `/scheduling/reports` | Scheduling Reports | `scheduling.manage` |
| `/scheduling/settings` | Scheduling Settings | `scheduling.manage` |

> Admin tabs have been extracted into dedicated routed pages with back navigation. The tab-based interface remains functional but links navigate to full pages.

### Equipment Check Pages (2026-03-19)

| URL | Page | Permission |
|-----|------|------------|
| `/scheduling/equipment-check-templates/new` | Equipment Check Template Builder | `equipment_check.manage` |
| `/scheduling/equipment-check-templates/:templateId` | Edit Equipment Check Template | `equipment_check.manage` |
| `/scheduling/equipment-check-reports` | Equipment Check Reports | `equipment_check.manage` |

> The **Template Builder** provides a drag-and-drop interface for creating structured checklists with nested compartments and multiple check types (pass/fail, quantity, level, date/lot, reading). The **Reports** page has three tabs: Compliance Dashboard, Failure/Deficiency Log, and Item Trend History with CSV and PDF export.

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

## Medical Screening (2026-03-13)

| URL | Page | Permission |
|-----|------|------------|
| `/medical-screening` | Medical Screening | `medical_screening.view` |

> Compliance dashboard for tracking member and prospect medical screenings (physicals, drug tests, fitness assessments, psychological evaluations). Includes screening requirements configuration, individual records management, compliance status per member, and expiring screenings alerts. Feature flag: `MODULE_MEDICAL_SCREENING_ENABLED`.

---

## Compliance Requirements Configuration (2026-03-13)

| URL | Page | Permission |
|-----|------|------------|
| `/compliance/config` | Compliance Requirements Config | `settings.manage` |

> Configure organization-wide compliance thresholds (percentage or all-required), create compliance profiles targeting specific membership types and roles, schedule automated compliance reports (monthly, quarterly, yearly) with email delivery, and generate on-demand reports. Linked from the compliance officer dashboard.

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

> The Notifications page includes a **channel filter** (email, in-app, SMS) for filtering by delivery method. Dashboard notification cards include **clear/dismiss buttons**. Administrators can create **persistent department messages** that only admins can clear.

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

## Prospective Members — Reports

| URL | Page | Permission |
|-----|------|------------|
| `/prospective-members` | Prospective Members Pipeline | `prospective_members.manage` |
| `/prospective-members/settings` | Pipeline Settings | `prospective_members.manage` |

> The **Pipeline Settings** page includes a **Report Stage Groups Editor** for configuring how pipeline stages are grouped in the pipeline overview report (e.g., combining Application + Interview into "Early Stages").

---

**Total: ~108 direct routes + 25 admin hub tabs across 18 modules**
