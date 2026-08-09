# The Logbook - Application Pages & URLs

Complete reference of all pages in the application, organized by module.

---

## Public Pages (No Authentication Required)

| URL                | Page                   | Description                                                    |
| ------------------ | ---------------------- | -------------------------------------------------------------- |
| `/`                | Welcome                | Landing / onboarding entry point                               |
| `/login`           | Login                  | User authentication                                            |
| `/forgot-password` | Forgot Password        | Password reset request                                         |
| `/reset-password`  | Reset Password         | Password reset form                                            |
| `/auth/callback`   | `OAuthCallbackPage`    | OAuth sign-in landing page (handles Google/Microsoft redirect) |
| `/f/:slug`         | Public Form            | Public form submission (token-based)                           |
| `/ballot`          | Ballot Voting          | Public ballot voting (token-based)                             |
| `/display/:code`   | Location Kiosk Display | QR code display for tablets in rooms (display-code-based)      |
| `/privacy`         | Privacy Policy         | Public privacy notice; department-configurable text            |
| `/terms`           | Terms of Service       | Public terms of use; department-configurable text              |

> **Public routes sit outside `AppLayout`** and therefore do not inherit its background. Until 2026-08-08 the public form page, ballot voting page and the prospective-member application-status page painted `bg-theme-surface-secondary` — a **translucent** token in dark mode, designed to composite over `AppLayout`'s gradient — so they rendered over the browser's bare white canvas: white-on-white labels with dark inputs. `body` now carries the themed gradient, and these pages use the same gradient utility as `LoginPage`. **Any new public route must use the gradient utility, not a surface token.** Print styles force a white body background, so printed output is unaffected.

---

## Onboarding

| URL                                    | Page                  | Description                                                                              |
| -------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------- |
| `/onboarding`                          | Onboarding Check      | Entry point / status check                                                               |
| `/onboarding/start`                    | Organization Setup    | Step 1 - create organization                                                             |
| `/onboarding/navigation-choice`        | Navigation Choice     | Choose navigation layout                                                                 |
| `/onboarding/email-platform`           | Email Platform        | Select email provider (Gmail, Microsoft 365, Self-Hosted SMTP, Cloudflare, Other/Skip)   |
| `/onboarding/email-config`             | Email Configuration   | Configure email settings (platform-specific: OAuth, SMTP, or Cloudflare API credentials) |
| `/onboarding/file-storage`             | File Storage          | Choose file storage provider                                                             |
| `/onboarding/file-storage-config`      | File Storage Config   | Configure file storage                                                                   |
| `/onboarding/authentication`           | Authentication        | Choose auth method                                                                       |
| `/onboarding/it-team`                  | IT Team & Backup      | IT team & backup access setup                                                            |
| `/onboarding/positions`                | Position Setup        | Configure positions (formerly roles)                                                     |
| `/onboarding/modules`                  | Module Selection      | Choose which modules to enable                                                           |
| `/onboarding/modules/:moduleId/config` | Module Config         | Configure individual module                                                              |
| `/onboarding/system-owner`             | System Owner Creation | Create initial system owner account                                                      |
| `/onboarding/security-check`           | Security Check        | Security verification                                                                    |

**Legacy redirects:**

- `/onboarding/department` → `/onboarding/start`
- `/onboarding/roles` → `/onboarding/positions`
- `/onboarding/admin-user` → `/onboarding/system-owner`
- `/onboarding/module-selection` → `/onboarding/modules`

---

## Dashboard

| URL          | Page           | Permission    |
| ------------ | -------------- | ------------- |
| `/dashboard` | Main Dashboard | Authenticated |

> _(2026-05-02)_ The volunteer dashboard "Now" section has been redesigned. The dashboard "Upcoming Events" stat now counts only events in the **next 30 days** (card labeled "Next 30 days") rather than all future events. The top navigation shows an **offline / pending-sync pill** indicating queued training submissions and RSVPs that will sync when connectivity returns.

---

## Members

### Member-Facing Pages

| URL                         | Page                    | Permission    |
| --------------------------- | ----------------------- | ------------- |
| `/members`                  | Member Directory        | Authenticated |
| `/members/:userId`          | Member Profile          | Authenticated |
| `/members/:userId/training` | Member Training History | Authenticated |

> _(2026-08-04)_ **Member Profile** is authenticated-only, but two of its fields are not. Date of birth and emergency contacts are served only to `members.manage` holders and to the member themselves; the page hides the emergency-contacts section entirely for everyone else rather than rendering it empty. No organization setting can publish them — `contact_info_visibility` (email/phone/mobile) has no flag for either. The rest of the contact block is redacted against that setting, on the same terms as the member directory.

### Members Admin Hub (`/members/admin`)

Requires `members.manage` permission. Tab-based admin interface.

| Tab      | Label             | Additional Permission |
| -------- | ----------------- | --------------------- |
| `manage` | Member Management | —                     |
| `add`    | Add Member        | `members.create`      |
| `import` | Import Members    | `members.create`      |

### Members Admin Pages

| URL                              | Page                 | Permission       |
| -------------------------------- | -------------------- | ---------------- |
| `/members/admin/edit/:userId`    | Admin Member Edit    | `members.manage` |
| `/members/admin/history/:userId` | Member Audit History | `members.manage` |
| `/members/admin/waivers`         | Waiver Management    | `members.manage` |

> **Admin Edit** provides full member editing (all fields, rank/station dropdowns, status, roles). **Audit History** shows timestamped change log. **Waiver Management** is a unified page covering training, meeting, and shift waivers with Active/Create/History tabs.

**Legacy redirects:**

- `/admin/members` → `/members/admin`
- `/members/add` → `/members/admin?tab=add`
- `/members/import` → `/members/admin?tab=import`

---

## Prospective Members

| URL                             | Page                         | Permission                                           |
| ------------------------------- | ---------------------------- | ---------------------------------------------------- |
| `/prospective-members`          | Prospective Members Pipeline | `prospective_members.manage`                         |
| `/prospective-members/settings` | Pipeline Settings            | `prospective_members.manage`                         |
| `/application-status/:token`    | Public Application Status    | None (token-based; see the public-routes note above) |

> **Board view fetch size** _(2026-08-08)_: the kanban view requests `KANBAN_PAGE_SIZE` (**200**, the list endpoint's ceiling), not `DEFAULT_PAGE_SIZE` (25) — it groups applicants into stage columns client-side, so a page of 25 produced a board silently assembled from a fraction of the pipeline. Switching between board and table **refetches** rather than inheriting the other view's page. Past 200 the board renders a truncation notice naming the real total. Column headers count only the cards that loaded, so a stage on a truncated board can read low — the table view is the accurate one at that size.
>
> **Board cards carry the prospect-list projection only** _(2026-08-08)_. The kanban endpoint previously declared no response model, so FastAPI serialized every `ProspectiveMember` column — including `status_token` (the credential behind the public application-status page), coordinator notes, date of birth and home address — to anyone holding `prospective_members.view`. The list and kanban endpoints now share one mapper.
>
> **Bulk actions are server-side** _(2026-08-08)_: `POST /membership-pipeline/prospects/bulk-advance` and `/bulk-status`, capped at 200 ids, returning a per-applicant outcome. The UI previously looped one request per applicant and discarded every error.

---

## Apparatus

| URL                   | Page             | Permission    |
| --------------------- | ---------------- | ------------- |
| `/apparatus`          | Apparatus List   | Authenticated |
| `/apparatus/new`      | Add Apparatus    | Authenticated |
| `/apparatus/:id`      | Apparatus Detail | Authenticated |
| `/apparatus/:id/edit` | Edit Apparatus   | Authenticated |
| `/apparatus-basic`    | Apparatus Basic  | Authenticated |

> `/apparatus-basic` is a lightweight alternative used when the full Apparatus module is disabled.

---

## Events

### Member-Facing Pages

| URL                    | Page          | Permission    |
| ---------------------- | ------------- | ------------- |
| `/events`              | Events List   | Authenticated |
| `/events/:id`          | Event Detail  | Authenticated |
| `/events/:id/qr-code`  | Event QR Code | Authenticated |
| `/events/:id/check-in` | Self Check-In | Authenticated |

### Per-Event Admin Pages

| URL                      | Page                | Permission       |
| ------------------------ | ------------------- | ---------------- |
| `/events/:id/edit`       | Edit Event          | `events.manage`  |
| `/events/:id/monitoring` | Check-In Monitoring | `events.manage`  |
| `/events/:id/analytics`  | Event Analytics     | `analytics.view` |

### Events Module Pages (2026-03-13)

| URL                 | Page                       | Permission       |
| ------------------- | -------------------------- | ---------------- |
| `/events/analytics` | Event Analytics Dashboard  | `analytics.view` |
| `/events/templates` | Event Templates Management | `events.manage`  |

> **Event Analytics Dashboard** shows summary cards (total events, RSVPs, check-ins, attendance rate), event type distribution chart, monthly trends chart, top events table, and date range filtering. **Event Templates Management** lists all templates with create/edit/toggle/delete actions.

### Events Admin Hub (`/events/admin`)

Requires `events.manage` permission. Tab-based admin interface.

| Tab         | Label                |
| ----------- | -------------------- |
| `create`    | Create Event         |
| `analytics` | Analytics            |
| `community` | Community Engagement |

**Legacy redirects:**

- `/events/new` → `/events/admin?tab=create`

---

## Locations (when Facilities module is off)

| URL          | Page                 | Permission    |
| ------------ | -------------------- | ------------- |
| `/locations` | Locations Management | Authenticated |

> Manages stations, addresses, and rooms for use by events, training, QR code check-in, and other modules. Each room gets a unique kiosk display code for tablet-based QR check-in.

---

## Facilities (when Facilities module is on)

| URL                       | Page                       | Permission        |
| ------------------------- | -------------------------- | ----------------- |
| `/facilities`             | Facilities Dashboard       | `facilities.view` |
| `/facilities/:id`         | Facility Detail            | `facilities.view` |
| `/facilities/maintenance` | Cross-Facility Maintenance | `facilities.view` |
| `/facilities/inspections` | Cross-Facility Inspections | `facilities.view` |

> The **Dashboard** shows summary statistics (total facilities, pending maintenance, upcoming inspections), a recent activity feed, and a searchable facility card grid. The **Facility Detail** page uses sidebar navigation to sections: overview, rooms, building systems, maintenance, inspections, utilities, emergency contacts, access keys, shutoff locations, capital projects, insurance, occupants, and compliance checklists. Rooms auto-sync linked Location records for Events and QR check-in. Cross-facility **Maintenance** and **Inspections** pages provide department-wide views. Replaces the Locations page when enabled. Locations created through either module are linked via `facility_id` so all event/training location references remain consistent.

---

## Training

### Member-Facing Pages

| URL                                | Page                                    | Permission        |
| ---------------------------------- | --------------------------------------- | ----------------- |
| `/training`                        | My Training                             | Authenticated     |
| `/training/my-training`            | My Training                             | Authenticated     |
| `/training/submit`                 | Submit Training                         | Authenticated     |
| `/training/courses`                | Course Library                          | Authenticated     |
| `/training/programs`               | Training Programs                       | Authenticated     |
| `/training/programs/:programId`    | Program Detail                          | Authenticated     |
| `/training/cohorts`                | Course Cohorts                          | `training.manage` |
| `/training/cohorts/:cohortId`      | Cohort Detail (class timeline + roster) | `training.manage` |
| `/training/my-skill-tests/:testId` | My Skill Test Result (read-only)        | Authenticated     |

### Skills Testing _(permissions revised 2026-08-08)_

| URL                                            | Page                                                              | Permission        |
| ---------------------------------------------- | ----------------------------------------------------------------- | ----------------- |
| `/training/skills-testing`                     | Skills Testing — **member-facing** (Available Tests / My Results) | **Authenticated** |
| `/training/skills-testing/templates/new`       | Skill Template Builder                                            | `training.manage` |
| `/training/skills-testing/templates/:id`       | Skill Template Detail                                             | `training.manage` |
| `/training/skills-testing/templates/:id/edit`  | Skill Template Builder (edit)                                     | `training.manage` |
| `/training/skills-testing/test/new`            | Start Skill Test                                                  | **Authenticated** |
| `/training/skills-testing/test/:testId`        | Active Skill Test (review)                                        | **Authenticated** |
| `/training/skills-testing/test/:testId/active` | Active Skill Test (scoring)                                       | **Authenticated** |

> **`/training/skills-testing` is the member's entry point, not the officer console** _(2026-08-08)_. When skills testing opened to members, this page became **Available Tests / My Results** — a member browses published sheets and reads their own results. The officer-facing **Templates** and **Test Records** tabs live under the Training Admin hub (`/training/admin?tab=templates` and `?tab=tests`), which is where validating, voiding and releasing happen.
>
> **Running a test no longer needs `training.manage`** _(2026-08-08)_. Departments routinely use senior members as evaluators, so any member may start, score and complete an official test. The officer's authority moved to a separate **validation** step (`POST /training/skills-testing/tests/{id}/validate`), which does still require `training.manage`. Template authoring is unchanged.
>
> Route guards are deliberately thin here — **per-record read access is enforced by the API**, so a member opening a test they are not party to receives a `404` from the API rather than being blocked at the route. A withheld result reads as absent, never as forbidden.
>
> Officer-only controls rendered _within_ these pages: **Validate** and **Void** on the Test Records tab, the **Release** action, the per-template **Result Disclosure** editor in the template builder, and the **TestViewersPanel** on the active test screen.

### Training Admin Hub (`/training/admin`)

Requires `training.manage` permission. Tab-based admin interface.

| Tab              | Label                         |
| ---------------- | ----------------------------- |
| `dashboard`      | Officer Dashboard             |
| `waivers`        | Training Waivers              |
| `submissions`    | Review Submissions            |
| `requirements`   | Requirements                  |
| `sessions`       | Create Session                |
| `cohorts`        | Course Cohorts                |
| `templates`      | Templates (Skills Testing)    |
| `tests`          | Test Records (Skills Testing) |
| `compliance`     | Compliance Matrix             |
| `expiring-certs` | Expiring Certs                |
| `pipelines`      | Pipelines                     |
| `shift-reports`  | Shift Reports                 |
| `integrations`   | Integrations                  |
| `import`         | Import History                |
| `enhancements`   | Enhancements                  |

> The two **Skills Testing** tabs were missing from this list. `templates` is the skill-sheet library (create, edit, publish, archive, and the per-template result-disclosure override); `tests` is the records tab, which is where an officer **validates**, **voids**, **releases** and **cancels** results, and where the "awaiting validation" filter lives. Both are officer-only, unlike `/training/skills-testing`, which is the member's entry point.

> The **Training Waivers** tab (within Officer Dashboard) shows all training waivers with summary cards, status filtering, and source tracking (Auto LOA vs Manual).
>
> The **Shift Reports** tab contains sub-views: My Reports (trainee), Filed by Me (officer), Pending Review, Flagged _(2026-04-07)_, Drafts, and Create. The Flagged sub-view shows reports flagged by reviewers with re-review capability. Batch review (approve/flag up to 100 at once) is available in the Pending Review and Flagged sub-views _(2026-04-07)_.
>
> The **Enhancements** tab provides access to recertification pathway management, instructor qualification tracking, training effectiveness evaluations (Kirkpatrick model), multi-agency session coordination, and compliance officer tools.

### Manual Shift Report _(2026-04-11)_

| URL                             | Page                | Permission        |
| ------------------------------- | ------------------- | ----------------- |
| `/training/manual-shift-report` | Manual Shift Report | `training.manage` |

> For departments without the Scheduling module enabled. Officers can file shift completion reports by manually entering shift date, start/end times, apparatus, crew members, and trainee evaluations. Supports apparatus-specific skill/task auto-population and save-as-draft. Admin configuration via the **ManualEntrySettingsPanel** on the Training Admin page controls whether manual entry is enabled, which apparatus types are available, and default shift times.

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

| URL          | Page      | Permission    |
| ------------ | --------- | ------------- |
| `/documents` | Documents | Authenticated |

---

## Inventory

### Member-Facing Pages

| URL                        | Page                 | Permission    |
| -------------------------- | -------------------- | ------------- |
| `/inventory`               | Inventory Items List | Authenticated |
| `/inventory/my-equipment`  | My Equipment         | Authenticated |
| `/inventory/items/:id`     | Item Detail          | Authenticated |
| `/inventory/storage-areas` | Storage Areas        | Authenticated |

### Inventory Admin Hub (`/inventory/admin`)

Requires `inventory.manage` permission. Dashboard with summary stats (total items, low stock, overdue checkouts, pending requests) and navigation to admin sub-pages.

### Inventory Admin Pages

| URL                               | Page                      | Permission         |
| --------------------------------- | ------------------------- | ------------------ |
| `/inventory/admin`                | Admin Dashboard           | `inventory.manage` |
| `/inventory/admin/items`          | Manage Items              | `inventory.manage` |
| `/inventory/admin/pool`           | Pool Items                | `inventory.manage` |
| `/inventory/admin/categories`     | Categories                | `inventory.manage` |
| `/inventory/admin/maintenance`    | Maintenance Records       | `inventory.manage` |
| `/inventory/admin/members`        | Members Inventory         | `inventory.manage` |
| `/inventory/admin/charges`        | Charges & Fees            | `inventory.manage` |
| `/inventory/admin/returns`        | Return Requests           | `inventory.manage` |
| `/inventory/admin/requests`       | Equipment Requests        | `inventory.manage` |
| `/inventory/admin/write-offs`     | Write-Off Requests        | `inventory.manage` |
| `/inventory/admin/reorder`        | Reorder Requests          | `inventory.manage` |
| `/inventory/admin/allowances`     | Issuance Allowances       | `inventory.manage` |
| `/inventory/admin/impact-planner` | Impact Planner            | `inventory.manage` |
| `/inventory/admin/kits`           | Equipment Kits Management | `inventory.manage` |
| `/inventory/admin/variant-groups` | Variant Groups Management | `inventory.manage` |
| `/inventory/checkouts`            | Active Checkouts          | `inventory.manage` |
| `/inventory/import`               | CSV Import                | `inventory.manage` |
| `/inventory/admin/kits`           | Equipment Kits            | `inventory.manage` |
| `/inventory/admin/variant-groups` | Variant Groups            | `inventory.manage` |
| `/inventory/print-labels`         | Barcode Label Printing    | Authenticated      |

> The admin dashboard provides summary statistics and quick-link navigation with grouped card sections. Individual sub-pages handle items, pool items, categories, maintenance, members, charges, return/equipment/write-off/reorder requests, equipment kits, and variant groups. The **Issuance Allowances** page (`/inventory/admin/allowances`) configures per-category issue limits by role and period (annual/career/one-time). The **Impact Planner** (`/inventory/admin/impact-planner`) scopes a prospective new issue: filter the roster to see who is impacted and the sizes needed, net demand against on-hand stock for the quantity to buy, estimate cost, then act on it (draft reorders, bulk-issue stock, request missing sizes, export PDF/CSV, save named plans). Member uniform/PPE sizing is captured via the **Size Preferences** modal — members edit their own (`/inventory/my/size-preferences`) and quartermasters edit any member's (`/inventory/members/{user_id}/size-preferences`). The Item Detail page (`/inventory/items/:id`) has a two-column layout with barcode sidebar and tabbed content (overview, history, maintenance, NFPA compliance). Non-admin users see only their own assigned equipment on the inventory dashboard.

---

## Scheduling

| URL                     | Page                   | Permission    |
| ----------------------- | ---------------------- | ------------- |
| `/scheduling`           | Scheduling             | Authenticated |
| `/scheduling?tab=<tab>` | Scheduling (deep-link) | Authenticated |

Supports `?tab=` query parameter for deep-linking to specific tabs: `schedule`, `my-shifts`, `open-shifts`, `requests`, `equipment-checks`. Shift notifications deep-link to the scheduling page with the relevant shift pre-selected.

Tab-based interface with the following views:

| Tab                | Label            | Admin Only |
| ------------------ | ---------------- | ---------- |
| `schedule`         | Schedule         | No         |
| `my-shifts`        | My Shifts        | No         |
| `open-shifts`      | Open Shifts      | No         |
| `requests`         | Requests         | No         |
| `equipment-checks` | Equipment Checks | No         |
| `templates`        | Templates        | Yes        |
| `reports`          | Reports          | Yes        |
| `settings`         | Settings         | Yes        |

### Scheduling Admin Pages (2026-03-19)

| URL                     | Page                       | Permission          |
| ----------------------- | -------------------------- | ------------------- |
| `/scheduling/templates` | Shift Templates Management | `scheduling.manage` |
| `/scheduling/patterns`  | Shift Pattern Management   | `scheduling.manage` |
| `/scheduling/reports`   | Scheduling Reports         | `scheduling.manage` |
| `/scheduling/settings`  | Scheduling Settings        | `scheduling.manage` |

> Admin tabs have been extracted into dedicated routed pages with back navigation. The tab-based interface remains functional but links navigate to full pages.

### Scheduling Settings Sub-Tabs _(2026-04-04)_

The Scheduling Settings page uses a tabbed sub-navigation:

| Sub-Tab        | Description                                                                                                                                                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shift Settings | Default durations, positions, apparatus type defaults, staffing rules                                                                                                                                                                   |
| Notifications  | Email recipients and notification preferences for shift events                                                                                                                                                                          |
| Shift Reports  | Checklist timing windows, post-shift validation, officer report requirements, training module defaults (call types, skills, tasks), per-apparatus-type skill/task mappings, rating scale customization, and report form section toggles |

> The **Shift Reports** settings tab links to the Training Module Configuration for defaults (call types, skills, tasks) and provides an inline UI for managing per-apparatus-type skill and task mappings. Changes to form section toggles control which sections officers see when filing shift completion reports.

### Equipment Check Pages (2026-03-19)

| URL                                                 | Page                             | Permission               |
| --------------------------------------------------- | -------------------------------- | ------------------------ |
| `/scheduling/equipment-check-templates/new`         | Equipment Check Template Builder | `equipment_check.manage` |
| `/scheduling/equipment-check-templates/:templateId` | Edit Equipment Check Template    | `equipment_check.manage` |
| `/scheduling/equipment-check-reports`               | Equipment Check Reports          | `equipment_check.manage` |

> The **Template Builder** provides a drag-and-drop interface for creating structured checklists with nested compartments and multiple check types (pass/fail, quantity, level, date/lot, reading). The **Reports** page has three tabs: Compliance Dashboard, Failure/Deficiency Log, and Item Trend History with CSV and PDF export.

---

## Elections

| URL              | Page            | Permission    |
| ---------------- | --------------- | ------------- |
| `/elections`     | Elections List  | Authenticated |
| `/elections/:id` | Election Detail | Authenticated |

---

## Minutes

| URL                   | Page           | Permission    |
| --------------------- | -------------- | ------------- |
| `/minutes`            | Minutes List   | Authenticated |
| `/minutes/:minutesId` | Minutes Detail | Authenticated |

---

## Medical Screening (2026-03-13)

| URL                  | Page              | Permission               |
| -------------------- | ----------------- | ------------------------ |
| `/medical-screening` | Medical Screening | `medical_screening.view` |

> Compliance dashboard for tracking member and prospect medical screenings (physicals, drug tests, fitness assessments, psychological evaluations). Includes screening requirements configuration, individual records management, compliance status per member, and expiring screenings alerts. Availability is controlled per organization via the `enabled_modules` setting in Organization/Admin Settings.

---

## Compliance Requirements Configuration (2026-03-13)

| URL                  | Page                           | Permission        |
| -------------------- | ------------------------------ | ----------------- |
| `/compliance/config` | Compliance Requirements Config | `settings.manage` |

> Configure organization-wide compliance thresholds (percentage or all-required), create compliance profiles targeting specific membership types and roles, schedule automated compliance reports (monthly, quarterly, yearly) with email delivery, and generate on-demand reports. Linked from the compliance officer dashboard.

---

## Action Items

| URL             | Page         | Permission    |
| --------------- | ------------ | ------------- |
| `/action-items` | Action Items | Authenticated |

> Unified cross-module action items view.

---

## Forms

| URL      | Page             | Permission    |
| -------- | ---------------- | ------------- |
| `/forms` | Forms Management | Authenticated |

---

## Notifications

| URL              | Page                      | Permission    |
| ---------------- | ------------------------- | ------------- |
| `/notifications` | Notification Rules & Logs | Authenticated |

> Three-tab interface: **Notification Rules** (list, create, enable/disable rules with trigger/category/channel configuration), **Email Templates** (link to template management), and **Send Log** (table view with channel filter: All / Email / In-App, mark-all-read, status indicators). Summary statistics cards show total rules, active rules, and combined send count.

> The Notifications page includes a **channel filter** (email, in-app, SMS) for filtering by delivery method. Dashboard notification cards include **clear/dismiss buttons**. Administrators can create **persistent department messages** that only admins can clear.

---

## Reports

| URL        | Page    | Permission    |
| ---------- | ------- | ------------- |
| `/reports` | Reports | Authenticated |

---

## Integrations

| URL             | Page         | Permission    |
| --------------- | ------------ | ------------- |
| `/integrations` | Integrations | Authenticated |

> _(2026-04-11)_ The Integrations page now includes **Salesforce CRM** as a connectable integration. Configuration requires `integrations.manage` permission. Features: OAuth 2.0 connection, bidirectional sync (members↔contacts, training→tasks, events→events), configurable field mappings, webhook-based real-time updates, and sync history dashboard. Supports both production and sandbox Salesforce environments.

---

## User Account

| URL        | Page                  | Permission    |
| ---------- | --------------------- | ------------- |
| `/account` | User Account Settings | Authenticated |

## Settings & Administration

| URL                    | Page                  | Permission                     |
| ---------------------- | --------------------- | ------------------------------ |
| `/settings`            | Organization Settings | `settings.manage`              |
| `/settings/roles`      | Role Management       | `positions.manage_permissions` |
| `/setup`               | Department Setup      | `settings.manage`              |
| `/admin/errors`        | Error Monitoring      | `settings.manage`              |
| `/admin/analytics`     | Analytics Dashboard   | `analytics.view`               |
| `/admin/audit-log`     | `AuditLogPage`        | `audit.view`                   |
| `/admin/public-portal` | Public Portal Admin   | `settings.manage`              |
| `/account`             | User Account Settings | Any authenticated user         |

> **Organization Settings** includes the **records-retention schedule**
> (`GET/PUT /organizations/retention-policy`) — per-record-class retention
> with safe defaults and minimum floors, enforced daily. Documents and
> meeting minutes are deliberately excluded from automatic deletion.

> **User Account Settings → Security** carries each member's privacy
> controls: **Privacy Choices** (photo use, public roster listing, SMS
> notifications — never-asked is treated as "no") and **Your Data**
> (download a full personal-data export as JSON).

---

## Prospective Members — Reports

| URL                             | Page                         | Permission                   |
| ------------------------------- | ---------------------------- | ---------------------------- |
| `/prospective-members`          | Prospective Members Pipeline | `prospective_members.manage` |
| `/prospective-members/settings` | Pipeline Settings            | `prospective_members.manage` |

> The **Pipeline Settings** page includes a **Report Stage Groups Editor** for configuring how pipeline stages are grouped in the pipeline overview report (e.g., combining Application + Interview into "Early Stages").

---

**Total: ~110 direct routes + 25 admin hub tabs across 18 modules**

> **Note (2026-03-26):** Notification cards redesigned with expand/collapse, pinned-first sorting, contextual CTAs, and mark-as-read on collapse. Notification metadata column added for rich card rendering. Scheduling page supports `?tab=` deep-linking (schedule, my-shifts, open-shifts, requests, equipment-checks). Shift notifications deep-link to scheduling with shift pre-selected. In-process scheduled task runner replaces external cron. Standalone equipment checks (not tied to shifts). Flat scrollable check form with inline compartments and section headers. Text check type changed to read-only statement. Critical minimum quantity threshold on check items. Template clone preserves is_header and critical_minimum_quantity. EVOC certification levels integrated across training, apparatus, and scheduling. Training record category tracking. Virginia NCCR recertification standards. Event attendees importable into election ballot lists. Linked elections displayed on event and minutes detail pages. Apparatus type/status badges render actual icons. navigate(-1) replaced with hardcoded back paths and breadcrumbs. Chrome label printing fixed via iframe-based approach. App startup handles MySQL not ready with retry backoff.
>
> **Note (2026-03-24):** Module availability depends on feature flags (`MODULE_*_ENABLED` in backend config). Disabled modules hide their navigation items and return 403 from API endpoints. The onboarding flow (`/onboarding/modules`) lets organizations choose which modules to enable during initial setup.
