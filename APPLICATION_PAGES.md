# The Logbook - Application Pages & URLs

Complete reference of all pages in the application, organized by module.

---

## Public Pages (No Authentication Required)

| URL                                    | Page                   | Description                                                                                          |
| -------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `/`                                    | Welcome                | Landing / onboarding entry point                                                                     |
| `/login`                               | Login                  | User authentication                                                                                  |
| `/forgot-password`                     | Forgot Password        | Password reset request                                                                               |
| `/reset-password`                      | Reset Password         | Password reset form                                                                                  |
| `/auth/callback`                       | `OAuthCallbackPage`    | OAuth sign-in landing page (handles Google/Microsoft redirect)                                       |
| `/f/:slug`                             | Public Form            | Public form submission (token-based)                                                                 |
| `/ballot`                              | Ballot Voting          | Public ballot voting (token-based)                                                                   |
| `/display/:code`                       | Location Kiosk Display | QR code display for tablets in rooms (display-code-based)                                            |
| `/display/:code/events/:eventId/guest` | `GuestCheckInPage`     | Guest (non-member) sign-in for an event held in that room _(2026-08-09)_                             |
| `/privacy`                             | Privacy Policy         | Public privacy notice; department control + status-based access, dated; department-configurable text |
| `/terms`                               | Terms of Service       | Public terms of use; department control + status-based access, dated; department-configurable text   |

> **The guest check-in page is addressed through the room's display code**, not
> through the event alone, so the backend can resolve the department without a
> session — the event id by itself would leave the organization to be taken from
> the request. It renders outside `AppLayout` and uses bare `fetch`, not the
> shared axios instance, because that instance's 401 interceptor would redirect
> the very visitors this page exists for. The route only produces a working page
> when the event has `allow_guest_check_in` set and is actually held in that
> room; otherwise it renders a "sign-in is not available" state. See
> **Events → Check-In Settings** below.

> **Public routes sit outside `AppLayout`** and therefore do not inherit its background. Until 2026-08-08 the public form page, ballot voting page and the prospective-member application-status page painted `bg-theme-surface-secondary` — a **translucent** token in dark mode, designed to composite over `AppLayout`'s gradient — so they rendered over the browser's bare white canvas: white-on-white labels with dark inputs. The **root element (`html`)** now carries the themed gradient — moved there from `body` on 2026-08-15 so it also covers the browser's stable scrollbar gutter — and these pages use the same gradient utility as `LoginPage`. **Any new public route must use the gradient utility, not a surface token.** Print styles force a white background on `html` and `body`, so printed output is unaffected.

---

## Onboarding

| URL                                    | Page                     | Description                                                                                    |
| -------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------- |
| `/onboarding`                          | Onboarding Check         | Entry point / status check                                                                     |
| `/onboarding/start`                    | Organization Setup       | Step 1 - create organization                                                                   |
| `/onboarding/navigation-choice`        | Navigation Choice        | Choose navigation layout                                                                       |
| `/onboarding/email-platform`           | Email Platform           | Select email provider (Gmail, Microsoft 365, Self-Hosted SMTP, Cloudflare, Other/Skip)         |
| `/onboarding/email-config`             | Email Configuration      | Configure email settings (platform-specific: OAuth, SMTP, or Cloudflare API credentials)       |
| `/onboarding/file-storage`             | File Storage             | Choose file storage provider                                                                   |
| `/onboarding/file-storage-config`      | File Storage Config      | Configure file storage                                                                         |
| `/onboarding/authentication`           | Authentication           | Choose auth method                                                                             |
| `/onboarding/it-team`                  | IT Team & Backup         | IT team & backup access setup                                                                  |
| `/onboarding/positions`                | Position Setup           | Configure positions (formerly roles)                                                           |
| `/onboarding/modules`                  | Module Selection         | Choose which modules to enable                                                                 |
| `/onboarding/module-selection`         | Module Selection (alias) | Renders the same page as `/onboarding/modules` — **not** a redirect, so the URL stays as typed |
| `/onboarding/modules/:moduleId/config` | Module Config            | Configure individual module                                                                    |
| `/onboarding/system-owner`             | System Owner Creation    | Create initial system owner account                                                            |
| `/onboarding/security-check`           | Security Check           | Security verification                                                                          |
| `/onboarding/stations`                 | Station Setup            | Create the department's stations                                                               |
| `/onboarding/apparatus`                | Apparatus Setup          | Create the department's apparatus                                                              |
| `/onboarding/complete`                 | Setup Complete           | Confirmation / hand-off into the app                                                           |

> **Completed setup cannot be replayed** _(2026-08-08)_. Once onboarding is
> finished, the station and apparatus setup endpoints refuse further writes, so a
> retained link cannot be used to add stations or apparatus after the fact.

> **`/onboarding/module-selection` is an alias, not a redirect**
> _(corrected 2026-08-16)_. It was listed below as redirecting to
> `/onboarding/modules`; in fact both routes render `<ModuleOverview />`
> directly, so a member who follows an old link stays on the old URL rather than
> being moved to the current one. Found by
> `scripts/check_route_permissions.py`.

**Legacy redirects:**

- `/onboarding/department` → `/onboarding/start`
- `/onboarding/roles` → `/onboarding/positions`
- `/onboarding/admin-user` → `/onboarding/system-owner`

---

## Dashboard

| URL                 | Page            | Permission    |
| ------------------- | --------------- | ------------- |
| `/dashboard`        | Main Dashboard  | Authenticated |
| `/learning`         | Learning Center | Authenticated |
| `/learning/:pathId` | Learning lesson | Authenticated |

> **Learning Center (`/learning`)** _(added 2026-08-11)_. The in-app guide index, sitting beside the dashboard inside `AppLayout`. Authenticated-only by design — it teaches the application rather than exposing any department record, so gating it on a permission would hide the help from the members most likely to need it.

> **Learning lessons (`/learning/:pathId`)** _(added 2026-08-24)_. The lesson itself, taught in the app: per step, why it matters, how to do it against the current screens, and what proves it is done. The step content lives in `frontend/src/pages/learning/learningPaths.ts` rather than being rendered from `docs/training/*.md` — the frontend image copies only `frontend/`, so the guide library is not in its build context, and precaching ~25,000 lines plus 97MB of screenshots would be the cost of keeping help available offline. The external reference guide stays linked at the foot of each lesson for anyone who wants the full manual. Progress is stored per member in `localStorage` (`logbook.learning-progress.v2.<userId>`); the unnamespaced v1 key was shared by every member of a station browser and is discarded rather than migrated, since nothing records who entered it. Week-one coverage is Getting Started, the phone/PWA lesson, Events, Training, Scheduling and Issued Gear, module-gated where the module can be switched off. A dashboard prompt (`DashboardOrientation`) is the entry point and hides once orientation is complete or dismissed.

> _(2026-05-02)_ The volunteer dashboard "Now" section has been redesigned. The dashboard "Upcoming Events" stat now counts only events in the **next 30 days** (card labeled "Next 30 days") rather than all future events. The top navigation shows an **offline / pending-sync pill** indicating queued training submissions and RSVPs that will sync when connectivity returns.

---

## Testing Home

| URL                     | Page                   | Permission    | Module    |
| ----------------------- | ---------------------- | ------------- | --------- |
| `/testing`              | Testing Home           | Authenticated | `testing` |
| `/testing/report/print` | Testing Report (print) | Authenticated | `testing` |

> An index of every route in this document, as boxes that open the page and
> record Pass/Fail/Blocked plus a note. The run is stored per department, one
> row per tester per page (`/api/v1/testing-checklist`), so a member testing
> from their own account and an officer testing from theirs contribute to the
> same list.
>
> Each box also shows the gate its route enforces and whether the signed-in
> account satisfies it, which is how the permission gates are tested from the
> outside — so the route is deliberately **authenticated-only**: a page a
> firefighter could not open would be useless for checking what a firefighter
> is refused. The navigation entry is gated on `settings.manage`; the URL is
> not.
>
> The module is **off by default** and is not offered during onboarding — a
> department turns **Testing Checklist** on under Settings → Modules when it
> wants it. While it is off the nav entry, the route and `/api/v1/testing-checklist`
> all refuse; recorded marks are kept and return when it is switched back on.
>
> Marks belong to a **run** — one named pass over the checklist. The newest run
> is the current one, so starting a run archives the previous one; earlier runs
> stay readable and exportable from the picker. Each mark also records the build
> it was made against and what the app predicted that account would meet, which
> is what turns "this page opened for a firefighter" into a reported finding
> rather than a pass. Exports: CSV, a page-by-tester permission matrix, the
> printable report at `/testing/report/print`, and Markdown.
>
> `settings.manage` (which the System Owner's `*` covers) additionally opens
> **every tester's** marks: each box lists what other accounts found and the
> position they held, and the same grant unlocks clearing the department's
> whole run — an audited, irreversible action. Without it a tester reads and
> clears only their own. See TESTING_CHECKLIST.md → "How to work through this".

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

| URL                              | Page                 | Permission         |
| -------------------------------- | -------------------- | ------------------ |
| `/members/admin/edit/:userId`    | Admin Member Edit    | `members.manage`   |
| `/members/admin/history/:userId` | Member Audit History | `members.manage`   |
| `/members/admin/waivers`         | Waiver Management    | `members.manage`   |
| `/members/check-in-station`      | Check-In Station     | `members.check_in` |

> **Admin Edit** provides full member editing (all fields, rank/station dropdowns, status, roles). **Audit History** shows timestamped change log. **Waiver Management** is a unified page covering training, meeting, and shift waivers with Active/Create/History tabs.

> _(2026-08-23)_ **Check-In Station** turns a phone, tablet or front-desk PC into an attendance reader: pick a shift, an event or meeting, or an admin hours category, arm the reader, and members tap the NFC tag inside their ID card to be checked in. Reads either through Web NFC (Chrome on Android, over HTTPS) or a USB reader that types the serial like a keyboard, so a department is not obliged to buy either. `members.check_in` is deliberately narrower than `events.manage` / `scheduling.manage`: running the station records attendance for other members but confers no ability to edit the shift or event it writes to.

> **ID cards are issued by officers only.** The **ID Cards** section on a member's profile (`members.manage_id_cards`) is where a card is bound — either by writing a generated code to a blank NFC tag, or by recording the serial of an already-printed card — and where it is suspended, reported lost or removed. There is no self-service view and no member-facing route: a card records attendance on the member's behalf, so it is issued the way a key is. The whole feature is gated by the **NFC ID Cards** integration (Settings → Integrations); while it is off, the page, the profile section and the navigation entries are all absent and every `/nfc-tags` endpoint refuses.

**Legacy redirects:**

- `/admin/members` → `/members/admin`
- `/members/add` → `/members/admin?tab=add`
- `/members/import` → `/members/admin?tab=import`

---

## Prospective Members

| URL                                           | Page                         | Permission                                           |
| --------------------------------------------- | ---------------------------- | ---------------------------------------------------- |
| `/prospective-members`                        | Prospective Members Pipeline | `prospective_members.manage`                         |
| `/prospective-members/settings`               | Pipeline Settings            | `prospective_members.manage`                         |
| `/prospective-members/:applicantId/interview` | Applicant Interview          | `prospective_members.manage`                         |
| `/application-status/:token`                  | Public Application Status    | None (token-based; see the public-routes note above) |

> **Board view fetch size** _(2026-08-08)_: the kanban view requests `KANBAN_PAGE_SIZE` (**200**, the list endpoint's ceiling), not `DEFAULT_PAGE_SIZE` (25) — it groups applicants into stage columns client-side, so a page of 25 produced a board silently assembled from a fraction of the pipeline. Switching between board and table **refetches** rather than inheriting the other view's page. Past 200 the board renders a truncation notice naming the real total. Column headers count only the cards that loaded, so a stage on a truncated board can read low — the table view is the accurate one at that size.
>
> **Board cards carry the prospect-list projection only** _(2026-08-08)_. The kanban endpoint previously declared no response model, so FastAPI serialized every `ProspectiveMember` column — including `status_token` (the credential behind the public application-status page), coordinator notes, date of birth and home address — to anyone holding `prospective_members.view`. The list and kanban endpoints now share one mapper.
>
> **Bulk actions are server-side** _(2026-08-08)_: `POST /membership-pipeline/prospects/bulk-advance` and `/bulk-status`, capped at 200 ids, returning a per-applicant outcome. The UI previously looped one request per applicant and discarded every error.

---

## Apparatus

| URL                   | Page             | Permission                                   |
| --------------------- | ---------------- | -------------------------------------------- |
| `/apparatus`          | Apparatus List   | `apparatus.view` **OR** `apparatus.manage`   |
| `/apparatus/new`      | Add Apparatus    | `apparatus.create` **OR** `apparatus.manage` |
| `/apparatus/:id`      | Apparatus Detail | `apparatus.view` **OR** `apparatus.manage`   |
| `/apparatus/:id/edit` | Edit Apparatus   | `apparatus.edit` **OR** `apparatus.manage`   |
| `/apparatus-basic`    | Apparatus Basic  | Authenticated                                |

> `/apparatus-basic` is a lightweight alternative used when the full Apparatus module is disabled.

---

## Events

### Member-Facing Pages

| URL                            | Page                 | Permission                |
| ------------------------------ | -------------------- | ------------------------- |
| `/events`                      | Events List          | Authenticated             |
| `/events/:id`                  | Event Detail         | Authenticated             |
| `/events/:id/qr-code`          | Event QR Code        | Authenticated             |
| `/events/:id/check-in`         | Self Check-In        | Authenticated             |
| `/event-request/status/:token` | Event Request Status | Token-based (public link) |

### Per-Event Admin Pages

| URL                      | Page                | Permission       |
| ------------------------ | ------------------- | ---------------- |
| `/events/:id/edit`       | Edit Event          | `events.manage`  |
| `/events/:id/monitoring` | Check-In Monitoring | `events.manage`  |
| `/events/:id/analytics`  | Event Analytics     | `analytics.view` |

> _(2026-08-23)_ **Check-In Monitoring** also lists members whose check-in landed before the event's scheduled start, with how early each one was. Their attendance is already credited from the scheduled start rather than from the tap, so the list is not a correction queue — it exists so an organizer can spot the member who really was working beforehand and set their check-in time by hand, which is credited verbatim. Members already given an explicit check-in time drop off the list.

### Events Module Pages (2026-03-13)

| URL                 | Page                       | Permission       |
| ------------------- | -------------------------- | ---------------- |
| `/events/analytics` | Event Analytics Dashboard  | `analytics.view` |
| `/events/templates` | Event Templates Management | `events.manage`  |

### Check-In Settings _(2026-08-09)_

Set per event on **Edit Event → Check-In Settings**. Both default to off.

| Setting                                     | Field                             | Effect                                                                                            |
| ------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------- |
| Allow guest check-in                        | `allow_guest_check_in`            | Adds a second, guest QR code to the room display and opens `/display/:code/events/:eventId/guest` |
| Create a prospective member from each guest | `guest_check_in_creates_prospect` | Also opens a pipeline record for each guest who supplies an email, linked to the event            |

> **Turning on guest check-in exposes an unauthenticated write path.** It is for
> outreach events — volunteer interest nights, open houses — and should stay off
> for business meetings and training sessions, whose attendance drives records
> that only apply to members. The room display renders both QR codes side by side
> when the event opts in; the member code (`/events/:id/check-in`) is unchanged,
> and check-out remains member-only.

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

| URL                   | Page                 | Permission                                                            |
| --------------------- | -------------------- | --------------------------------------------------------------------- |
| `/locations`          | Locations Management | Authenticated                                                         |
| `/locations/qr-codes` | Check-In QR Codes    | `locations.manage` **OR** `facilities.manage` **OR** `apparatus.view` |

> Manages stations, addresses, and rooms for use by events, training, QR code check-in, and other modules. Each room gets a unique kiosk display code for tablet-based QR check-in. The Check-In QR Codes page is a printable directory of every kiosk QR code, grouped by station/facility (available in both Locations and Facilities modes), plus apparatus shift check-in codes when the Scheduling module is enabled.

> **Name check:** the page's on-screen heading is **"Check-In QR Codes"** — that is what a reader will see and what the command palette calls it. "Room QR Codes" is the component's filename (`RoomQRCodesPage.tsx`) and appears in some engineering notes; it is not a user-facing label. Documentation should use the heading.

> **The QR directory is restricted, unlike the rest of Locations** _(corrected 2026-08-16)_. This page was previously listed here as Authenticated; it is not. The route is registered by the Facilities module (so it resolves in both Locations and Facilities modes) behind `locations.manage` **OR** `facilities.manage`. The restriction is the point: a kiosk display code is a check-in credential, so a bulk directory of every room's code is a different object from any one room's QR. Regenerating a display code invalidates the previous one, and codes are tenant-bound.

> **`apparatus.view` also opens it** _(documented 2026-08-18)_. The page carries apparatus shift check-in codes as well as room kiosk codes, and an apparatus code is a permanent id-based URL rather than a bearer credential — there is nothing in it to leak. Room kiosk codes are redacted by the backend for anyone without `locations.manage` or `facilities.manage`, so those cards simply do not render for an apparatus-only viewer.

---

## Facilities (when Facilities module is on)

| URL                       | Page                       | Permission                                   |
| ------------------------- | -------------------------- | -------------------------------------------- |
| `/facilities`             | Facilities Dashboard       | `facilities.view` **OR** `facilities.manage` |
| `/facilities/:id`         | Facility Detail            | `facilities.view` **OR** `facilities.manage` |
| `/facilities/maintenance` | Cross-Facility Maintenance | `facilities.view` **OR** `facilities.manage` |
| `/facilities/inspections` | Cross-Facility Inspections | `facilities.view` **OR** `facilities.manage` |
| `/facilities/settings`    | Facility Settings          | `facilities.manage`                          |

> The **Dashboard** shows summary statistics (total facilities, pending maintenance, upcoming inspections), recent maintenance completions, and a searchable facility card grid. The **Facility Detail** page uses sidebar navigation to sections: overview, rooms, building systems, maintenance, inspections, utilities, emergency contacts, access keys, shutoff locations, capital projects, insurance, occupants, and compliance checklists. The utilities, access keys, capital projects, insurance, and occupants sections carry sensitive data (door/alarm codes, account numbers, budgets, lease terms) and require `facilities.view_sensitive`, `facilities.edit`, or `facilities.manage` — they are hidden from members who only hold `facilities.view`, and the API enforces the same restriction. `facilities.view_sensitive` is a read-only, organization-wide grant; the default position templates give it to Vice President and Treasurer, while chief officers, President, and Facilities Manager see everything through `facilities.manage`. Station-specific ranks such as Captain are not granted organization-wide sensitive access by default. Rooms created in Facilities own and automatically synchronize linked Location records for Events and QR check-in; standalone Locations may reference a Facility but do not create or update Facility Rooms. **Rooms can be nested inside other rooms** _(2026-08-16)_: the Rooms section renders the containment tree with per-room sub-room counts and an add-a-room-inside action, the room form offers a "Located inside" picker (same facility only, no cycles, five levels max), and deleting a room re-parents its sub-rooms one level up rather than deleting them. A nested room's linked Location carries the full containment path (e.g. "Quartermaster's Storage — Volunteer Office — Station 1"), and the cross-module room picker in Events, Training, and Scheduling indents sub-rooms under their container. Cross-facility **Maintenance** and **Inspections** pages provide department-wide views. The module replaces the standalone Locations page when enabled.

---

## Training

### Member-Facing Pages

| URL                                   | Page                                    | Permission        |
| ------------------------------------- | --------------------------------------- | ----------------- |
| `/training`                           | My Training                             | Authenticated     |
| `/training/my-training`               | My Training                             | Authenticated     |
| `/training/submit`                    | Submit Training                         | Authenticated     |
| `/training/courses`                   | Course Library                          | Authenticated     |
| `/training/programs`                  | Training Programs                       | Authenticated     |
| `/training/programs/:programId`       | Program Detail                          | Authenticated     |
| `/training/cohorts`                   | Course Cohorts                          | `training.manage` |
| `/training/cohorts/:cohortId`         | Cohort Detail (class timeline + roster) | `training.manage` |
| `/training/my-skill-tests/:testId`    | My Skill Test Result (read-only)        | Authenticated     |
| `/training/my-progress/:enrollmentId` | My Program Progress                     | Authenticated     |

> **`/training/my-progress/:enrollmentId` is where every training notification
> now lands** _(2026-08-09)_. All eight `action_url`s previously pointed at
> `/training/programs/{id}/progress` or `.../enrollments`, neither of which is a
> route — the router's catch-all bounced the member to the dashboard. They point
> here and at `/training/programs?tab=enrollments` instead.

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
| `/training/skills-testing/print/template`      | Blank skill sheet (print)                                         | **Authenticated** |
| `/training/skills-testing/print/scorecard`     | Completed scorecard (print)                                       | **Authenticated** |

> **The two print pages are authenticated-only, and that is not an oversight** _(added 2026-08-11)_. A **blank skill sheet** carries no member data — it is the empty form, and the templates list that links to it already applies the template's own visibility rules; the backend's template fetch enforces visibility and org scoping. A **completed scorecard** is redacted by the backend to the reader's disclosure level _before the data leaves the server_, which is why the route is not gated on `training.manage`: doing so would stop a member printing a result they are already allowed to read, without withholding anything from anyone else. Same principle as the route guards below — the API decides what the page can contain.

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

| URL                           | Page                           | Permission                                   |
| ----------------------------- | ------------------------------ | -------------------------------------------- |
| `/training/log-shift`         | Log Shift                      | `training.manage`                            |
| `/training/compliance-config` | Compliance Requirements Config | `compliance.manage` **OR** `settings.manage` |

> **`/training/manual-shift-report` was listed here and does not exist**
> _(corrected 2026-08-16)_. No route declares it; `/training/log-shift` is the
> page that logs a shift manually. Found by
> `scripts/check_route_permissions.py`.

> **Manual entry settings look empty when the feature is off** — everything below
> the enable checkbox on the **ManualEntrySettingsPanel** is conditional on it.
> A single-checkbox panel is the feature switched off, not a broken page.

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

| URL                        | Page                         | Permission         |
| -------------------------- | ---------------------------- | ------------------ |
| `/inventory`               | Inventory Items List         | `inventory.manage` |
| `/inventory/items`         | Inventory Items List (alias) | `inventory.manage` |
| `/inventory/my-equipment`  | My Equipment                 | Authenticated      |
| `/inventory/items/:id`     | Item Detail                  | Authenticated      |
| `/inventory/storage-areas` | Storage Areas                | `inventory.manage` |

> **The catalogue is manager-only; a member's own kit is not.** The two items-list
> routes show the whole department's gear and gate on `inventory.manage`. A member's
> business with inventory is their own issued items and the request or return they
> raise against one — all of which live on `/inventory/my-equipment`, which stays
> open to any authenticated member, as does the detail page for an item they hold.
>
> `inventory.view` is deliberately **not** the gate on the list. The seeded `member`
> and `firefighter` roles hold it and need it: the request picker on My Issued Gear
> searches `GET /items` to find something to ask for, and item detail reads
> `GET /items/{id}`. Gating the list on `inventory.view` would have gated nothing.

### Inventory Admin Hub (`/inventory/admin`)

Requires `inventory.manage` permission. Dashboard with summary stats (total items, low stock, overdue checkouts, pending requests) and navigation to admin sub-pages.

### Inventory Admin Pages

| URL                               | Page                      | Permission         |
| --------------------------------- | ------------------------- | ------------------ |
| `/inventory/admin`                | Admin Dashboard           | `inventory.manage` |
| `/inventory/admin/setup`          | Inventory Setup           | `inventory.manage` |
| `/inventory/admin/items`          | Manage Items              | `inventory.manage` |
| `/inventory/admin/pool`           | Pool Items                | `inventory.manage` |
| `/inventory/admin/categories`     | Categories                | `inventory.manage` |
| `/inventory/admin/maintenance`    | Maintenance Records       | `inventory.manage` |
| `/inventory/admin/members`        | Members Inventory         | `inventory.manage` |
| `/inventory/admin/charges`        | Charges & Fees            | `inventory.manage` |
| `/inventory/admin/vendors`        | Vendors                   | `inventory.manage` |
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
| `/inventory/print-labels`         | Barcode Label Printing    | `inventory.manage` |

> **Receiving a delivery and stocking the catalog are both one-pass jobs now** _(2026-08-10)_. Two modals open from the items list (`/inventory`, and the same screen at `/inventory/admin/items`):
>
> | Modal             | What it does                                                                                                                                                                                                                                                                                                                                                    |
> | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | **Receive Stock** | One dated lot per line — item, lot number, expiration, quantity — with a single received date for the whole delivery. Posts to `POST /inventory/lots/bulk`, which **applies all lines or none**: a partly applied delivery is worse than a rejected one, because the officer cannot tell which lines landed and re-entering it would double-count whatever did. |
> | **Add Several**   | Paste a list of catalog items. Names already in the catalog are **skipped and reported, not rejected**, so a list can be re-pasted after it grows. Any validation failure writes nothing.                                                                                                                                                                       |
>
> The CSV import at `/inventory/import` was built and routed but unreachable from the items page; an **Import CSV** button now sits beside these two.
>
> **The Qty column reads from in-date lots** for any item that has them, labelled "in-date lots" so it is not mistaken for the pool figure beside it, and the CSV export carries the same number in a **Ready Lot Stock** column. `InventoryItem.quantity` is not maintained for lot-stocked consumables — receiving a lot does not touch it and an equipment-check swap decrements only the lot — so the grid used to report whatever the number happened to be when the item was created. An item whose lots have all expired reads as **zero**, not as its stale quantity.

> **Inventory Setup** (`/inventory/admin/setup`) _(documented 2026-08-18)_ is the
> guided first-run workflow. Adding an item usefully requires four things to
> exist first, in order — a room, a storage area inside it, a category (which
> decides what fields the item form shows), and only then the item — and
> nothing on the admin hub said so. A new quartermaster met the item form
> first, found three empty dropdowns, and left them empty; the resulting record
> cannot be found on a shelf, never appears in a low-stock alert, and has no
> inspection cycle. This page puts the four steps in dependency order on one
> screen and carries each answer into the next. Any step can be skipped — a
> department that already has rooms is not made to re-declare them — and each
> step links to its full admin page, which remains the place to do the work at
> volume.

> The admin dashboard provides summary statistics and quick-link navigation with grouped card sections. Individual sub-pages handle items, pool items, categories, maintenance, members, charges, return/equipment/write-off/reorder requests, equipment kits, and variant groups. The **Issuance Allowances** page (`/inventory/admin/allowances`) configures per-category issue limits by role and period (annual/career/one-time). The **Impact Planner** (`/inventory/admin/impact-planner`) scopes a prospective new issue: filter the roster to see who is impacted and the sizes needed, net demand against on-hand stock for the quantity to buy, estimate cost, then act on it (draft reorders, bulk-issue stock, request missing sizes, export PDF/CSV, save named plans). Member uniform/PPE sizing is captured via the **Size Preferences** modal — members edit their own (`/inventory/my/size-preferences`) and quartermasters edit any member's (`/inventory/members/{user_id}/size-preferences`). The Item Detail page (`/inventory/items/:id`) has a two-column layout with barcode sidebar and tabbed content (overview, history, maintenance, NFPA compliance). Non-admin users see only their own assigned equipment on the inventory dashboard.

---

## Medical Supplies _(documented 2026-08-18)_

| URL                            | Page                      | Permission                                       |
| ------------------------------ | ------------------------- | ------------------------------------------------ |
| `/medical-supplies`            | Medical Supplies          | `inventory.view_medical` **OR** `inventory.view` |
| `/medical-supplies/categories` | Medical Supply Categories | `inventory.view_medical` **OR** `inventory.view` |

> The EMS side of the department's stock, on its own pages so it can be run by
> its own officer. Gear and uniforms live under **Inventory** and never appear
> here. The list opens on what expires rather than on a full item count: dated
> stock is what goes wrong quietly, and an officer checking in wants to know
> what is about to lapse before they want an inventory figure.

> **An item is medical because of its category** — there is no item-type field.
> That is why `/medical-supplies/categories` exists as a page of its own and why
> it has no type picker: everything created there is medical by construction.

> **Both grants open these pages, and that is deliberate.** The route mirrors
> the API's OR check rather than gating on the narrow permission alone. A
> department that runs one supply line grants `inventory.view`; one that
> appointed an EMS supply officer grants only `inventory.view_medical`. Gating
> on the narrow permission by itself would bounce the first group off a page the
> API would have served them — a redirect to the dashboard with no explanation.
> The shared list lives in `MEDICAL_VIEW_PERMISSIONS` in the module's
> `routes.tsx` so the two routes cannot drift apart.

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

| URL                           | Page                          | Permission                                                                  |
| ----------------------------- | ----------------------------- | --------------------------------------------------------------------------- |
| `/scheduling/templates`       | Shift Templates Management    | `scheduling.manage`                                                         |
| `/scheduling/patterns`        | Shift Pattern Management      | `scheduling.manage`                                                         |
| `/scheduling/reports`         | Scheduling Reports            | `scheduling.manage`                                                         |
| `/scheduling/settings`        | Scheduling Settings           | `scheduling.manage`                                                         |
| `/scheduling/platoons`        | Platoon Management            | `scheduling.manage`                                                         |
| `/scheduling/qualifications`  | Position Qualification Roster | any of `scheduling.manage`, `training.view_all`, `training.manage`          |
| `/scheduling/checkin`         | Shift Check-In                | Authenticated                                                               |
| `/scheduling/supply/expiring` | Expiring Supply Items         | `equipment_check.view` **OR** `inventory.manage` **OR** `scheduling.manage` |

> Admin tabs have been extracted into dedicated routed pages with back navigation. The tab-based interface remains functional but links navigate to full pages.

> **`/scheduling/checkin` accepts `?shift=<id>` or `?apparatus=<id>`**
> _(2026-08-18)_. Prefer the **apparatus** form for anything physically mounted:
> it resolves at scan/tap time rather than naming a shift, so one sticker on the
> truck serves every shift. A shift-keyed URL is dead the moment that shift
> ends. **`get_active_shift_for_apparatus` is not a "currently running"
> lookup**: it takes the _earliest-starting_ non-finalized shift dated today,
> else one whose `end_time` is within the last two hours, else the next
> upcoming — with no start/end window check and no `status == cancelled`
> exclusion. Two shifts on one apparatus in a day, or a stale un-finalized row,
> therefore resolve to the wrong shift; `ShiftCheckInPage` names the unit, date
> and hours before the member confirms. `buildShiftCheckInUrl`
> takes `{ apparatusId }` or `{ shiftId }` so the choice is explicit at the call
> site; `shift` is read first when both are present.

#### Position Qualification Roster (`/scheduling/qualifications`) _(documented 2026-08-18)_

Answers "who is cleared to drive?" in one screen rather than one apparatus
operator tab at a time. Shift-position eligibility is OR'd from three
independent sources — rank, completed training, and the organization's
open-position list — so a member can hold a position for a reason their
profile does not show; the roster names the source next to each member. A
second tab lists **driver exceptions**: members whose rank alone clears them
to sign up as a driver with no EVOC certification behind it.

> **Training permissions open it, not just scheduling ones.** The screen is a
> training-compliance view as much as a scheduling one, so `training.view_all`
> and `training.manage` admit a training officer who holds no scheduling
> grant.

> **Tab clicks now write `?tab=`** _(2026-08-09)_. Until this was fixed, clicking
> any tab on `/scheduling` selected it and immediately snapped back to
> **Schedule**, so Equipment Checks and every other tab could only be reached by
> deep link. Selecting **Schedule** removes the param, so the default URL stays
> clean.

### Scheduling Settings Sections _(rebuilt 2026-08-09)_

`/scheduling/settings` now uses the **shared settings layout**
(`components/settings/SettingsLayout.tsx`) — the same shell as Organization
Settings and Event Settings: a section sidebar with descriptions on desktop, a
scrollable tab strip on phones, and the section body in a surface card under a
single header. It replaces the pill/segmented tab bar and the two stacked titles
("Scheduling Settings" from the page, then "Shift Settings" from the panel) it
had before.

Sections are defined in
`modules/scheduling/components/schedulingSettingsSections.ts`:

| Section (`?tab=`) | Label         | Description                             | Saved by footer |
| ----------------- | ------------- | --------------------------------------- | --------------- |
| `general`         | General       | Shift defaults, overtime, and close-out | Yes             |
| `apparatus`       | Apparatus     | Apparatus and resource type defaults    | Yes             |
| `platoons`        | Platoons      | Platoon rosters and assignments         | No              |
| `eligibility`     | Eligibility   | Who may sign up for a shift             | No              |
| `notifications`   | Notifications | Shift reminders and alerts              | No              |
| `equipment`       | Equipment     | Check requirements and templates        | Yes             |
| `shift-reports`   | Shift Reports | End-of-shift reporting options          | No              |

> **The Save/Reset footer appears only on the three sections it actually
> writes** (`LOCALLY_SAVED_SECTIONS`). It used to be shown on all seven while
> saving three, so Notifications and Shift Reports offered a Save button that
> flashed "Settings saved" without touching their values. Every other section
> owns its own save control.

> **Selecting a section writes `?tab=`**, as the other settings screens do, so a
> section can be linked to, refreshed into, and reached with the back button.
> The page previously read the param on mount but never wrote it. A deep link to
> **Platoons** while the department has that feature switched off falls back to
> General by derivation rather than by resetting state, so the link still lands
> once the feature flag loads.

> **Eligibility here is not the same screen as rank eligibility.**
> **Scheduling → Settings → Eligibility** governs which _membership types_ may
> self-sign-up for a shift; per-rank shift-**position** eligibility is set on
> **Settings → Ranks**.

> The **Shift Reports** section links to the Training Module Configuration for defaults (call types, skills, tasks) and provides an inline UI for managing per-apparatus-type skill and task mappings. Changes to form section toggles control which sections officers see when filing shift completion reports. It is a section navigator of its own eight sections, not a page of three cards.

#### Shift Close-Out — two different screens _(2026-08-19)_

Close-out is reached the same way in both cases — **Close out shift** on the
shift detail panel, visible to `scheduling.manage` or the shift's own officer,
on a past shift that is neither finalized nor cancelled. What opens depends on
one organization setting, **Scheduling → Settings → General → Shift close-out
rules → Record a call count at close-out**
(`scheduling.call_tracking.mode`):

| Mode                 | What opens                                      | Notes                                                                     |
| -------------------- | ----------------------------------------------- | ------------------------------------------------------------------------- |
| `detailed` (default) | The single finalize checklist, unchanged        | Calls are logged per incident as `ShiftCall` rows                         |
| `count_only`         | The three-step **close-out wizard**             | The officer reports a number; no incident detail is collected or accepted |
| `off`                | The single finalize checklist, no call question |                                                                           |

The wizard's three steps each save as they advance, so an interrupted close-out
resumes rather than restarting:

| Step | Question                              | Writes                                                                                                          |
| ---- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1    | When was each member actually on?     | `PATCH /scheduling/shifts/{id}/closeout/attendance` → `ShiftAttendance` times; `shifts.closeout_step = 1`       |
| 2    | How many calls did the apparatus run? | `PATCH /scheduling/shifts/{id}/closeout/calls` → `org_calls` + `org_call_responses`; `shifts.closeout_step = 2` |
| 3    | Confirm each member's credit          | `POST /scheduling/shifts/{id}/finalize` → `ShiftAttendance.call_count`, `shifts.call_count`                     |

> **The wizard replaces the checklist, so it carries everything the checklist
> could do** — the end-of-shift-check override (still gated on a logged reason,
> still audited as `shift_finalized_check_override`) and pass-down notes. Without
> them a count-only department that enforces equipment checks could never close a
> shift at all.

> **The total on step 2 is derived from the per-type rows and is read-only.**
> There is exactly one source for the number. A design with both a total field
> and a breakdown needs a reconciliation rule per direction, and the downward one
> was missing — revising a count down left the old total on screen, and that is
> what got saved.

> **Reopening a finalized shift restarts the wizard at step 1.**
> `shifts.closeout_step` is cleared on finalize, and a finalized shift reports
> step 0 regardless.

### Equipment Check Pages (2026-03-19)

| URL                                                 | Page                             | Permission                                                                   |
| --------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------- |
| `/scheduling/equipment-check-templates/new`         | Equipment Check Template Builder | `scheduling.manage`                                                          |
| `/scheduling/equipment-check-templates/:templateId` | Edit Equipment Check Template    | `scheduling.manage`                                                          |
| `/scheduling/equipment-check-reports`               | Equipment Check Reports          | `scheduling.manage`                                                          |
| `/scheduling?tab=equipment-checks`                  | My Equipment Checklists          | Authenticated                                                                |
| `/scheduling/supply/expiring`                       | Expiring on Apparatus            | any of `scheduling.manage`, `equipment_check.view`, `inventory.manage`       |
| `/scheduling/apparatus-inventory`                   | Apparatus Inventory              | any of `equipment_check.submit`, `equipment_check.view`, `inventory.view`    |
| `/scheduling/equipment`                             | Fleet Board                      | any of `equipment_check.view`, `scheduling.manage`                           |
| `/scheduling/equipment/checks`                      | Check Log                        | any of `equipment_check.submit`, `equipment_check.view`, `scheduling.manage` |
| `/scheduling/equipment/:apparatusId`                | Apparatus Detail                 | any of `equipment_check.view`, `scheduling.manage`                           |

> The **Template Builder** provides a drag-and-drop interface for creating structured checklists with nested compartments and multiple check types (pass/fail, quantity, level, date/lot, reading). Its quick-add bar searches the inventory catalog as you type, so **adding a position and linking it to a catalog item are one act** _(2026-08-10)_ — and the toolbar carries a linked/unlinked count, because everything the supply screens can do hangs off `inventory_item_id`. For checklists that already exist there is a reviewed bulk pass that proposes a catalog item for every unlinked position; **only exact name matches are pre-selected**, since "Oxygen Mask" scores high against both the adult and the pediatric mask. The **Reports** page has three tabs: Compliance Dashboard, Failure/Deficiency Log, and Item Trend History with CSV and PDF export.

#### Fleet Board (`/scheduling/equipment`) _(documented 2026-08-18)_

The front door for equipment checks, organised around the apparatus rather than
the checklist assignment — "is E-1 good?" is the question an officer arrives
with, and the older checklist grid could not answer it because one truck's state
was spread across several cards, a separate inventory page, and an admin-only
report. A member's own due checks stay on the page as a strip at the top, ranked
so an overdue check cannot read as one due next Tuesday.

#### Apparatus Detail (`/scheduling/equipment/:apparatusId`) _(documented 2026-08-18)_

One rig, four tabs, each of which used to be a different page: today's checks,
what it carries (Apparatus Inventory), what is wrong or expiring with it
(Supply, plus a failure log only admins could reach), and whether it has been
getting checked at all. Nothing new is added here — the existing surfaces are
gathered behind the apparatus they were always about.

#### Check Log (`/scheduling/equipment/checks`) _(documented 2026-08-18)_

Expected-versus-actual check history, in two views over one dataset: a **grid**
of apparatus against duty days, read by colour, for "is the pattern okay?"; and
a chronological **log** for "what happened on that one?". Rows for checks that
_did not happen_ are the reason the page exists — the stored checks alone can
only ever report 100% completion, so the server reconstructs the expected side
and a missed check arrives as an entry with no check id. The same component runs
scoped to a single apparatus as the Check log tab of Apparatus Detail.

> **Crew-level, unlike the rest of the fleet pages.** `equipment_check.submit`
> opens the Check Log because the server narrows a member without
> `equipment_check.view` to their own checks rather than returning 403 — the
> route matches what the API will actually serve.

#### Expiring on Apparatus (`/scheduling/supply/expiring`) _(documented 2026-08-10)_

The supply officer's worklist. Reached from **Scheduling → Supply** (the tile
carries a count badge) and from the **Inventory Admin Hub**. Lists checklist
positions that are expiring, expired, short of target, or reported used, each with
the ready replacement stock behind it.

| Control    | Options                                       |
| ---------- | --------------------------------------------- |
| Look-ahead | 30 / 60 / 90 days                             |
| Filter     | All · Needs restock · Used or short · Expired |
| Sort       | Soonest expiry · By apparatus                 |

Summary pills count rows needing attention, rows with ready stock, and rows that
need ordering. **Expired shelf stock is struck through and cannot be swapped** —
offering it would put expired supplies in service and fail the item on the next
check.

#### Apparatus Inventory (`/scheduling/apparatus-inventory`) _(added 2026-08-10)_

The standing view of one truck, outside any check. Reached from **My Equipment
Checklists → Apparatus Inventory**. Pick an apparatus and see its tracked
positions compartment by compartment: what is aboard, the lots and dates on each
position, and the ready stock behind it.

**Reporting usage is deliberately crew-level.** An equipment check is a
scheduled, signed pass over a whole apparatus that produces a report; a crew
that used the last of something at 03:00 needs somewhere to put that fact
_now_, not at the next morning's check. So reporting an item used accepts
`equipment_check.submit` — the default member position — as well as the manage
permissions. **Corrections of record are not** _(2026-08-11)_: withdrawing a
restock report, swapping a lot onto the apparatus, and rewriting a deployed
lot's number or expiration date require `equipment_check.manage` or
`inventory.manage`.

| Action on a position | What it means                                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **−**                | Consumption. The count drops and a restock report goes up with it, drawing soonest-expiring-first                                 |
| **+**                | A hand restock                                                                                                                    |
| **Swap**             | Draws N units off a shelf lot onto the truck; defaults to the shortfall                                                           |
| **Flag**             | Damaged, contaminated or missing — on a counted position, where **−** already records use                                         |
| **Lots**             | A position carrying lots opens them rather than offering a stepper: two units with two dates cannot be moved by one plus or minus |

> **Headers and free-text lines do not appear here.** They are checklist
> scaffolding, not things anyone stocks.

---

## Elections

| URL                   | Page              | Permission         |
| --------------------- | ----------------- | ------------------ |
| `/elections`          | Elections List    | Authenticated      |
| `/elections/:id`      | Election Detail   | Authenticated      |
| `/elections/settings` | Election Settings | `elections.manage` |

> **Voiding a paper-ballot batch** used to ask for its reason with
> `window.prompt`, which a browser may suppress — and which silently dropped any
> reason shorter than three characters. It now uses an in-app dialog that shows
> the validation message _(2026-08-09)_.

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

| URL                           | Page                           | Permission                                   |
| ----------------------------- | ------------------------------ | -------------------------------------------- |
| `/training/compliance-config` | Compliance Requirements Config | `compliance.manage` **OR** `settings.manage` |

> **This was listed as `/compliance/config`, which is the API path, not a page**
> _(corrected 2026-08-16)_. `GET`/`PUT /compliance/config` is what the screen
> calls; the screen itself is `/training/compliance-config`. Found by
> `scripts/check_route_permissions.py`.

> Configure organization-wide compliance thresholds (percentage or all-required), create compliance profiles targeting specific membership types and roles, schedule automated compliance reports (monthly, quarterly, yearly) with email delivery, and generate on-demand reports. Linked from the compliance officer dashboard.

---

## Action Items

| URL             | Page         | Permission    |
| --------------- | ------------ | ------------- |
| `/action-items` | Action Items | Authenticated |

> Unified cross-module action items view.

---

## Organizational Chart (Governance)

| URL                     | Page                 | Permission                                    |
| ----------------------- | -------------------- | --------------------------------------------- |
| `/governance/org-chart` | Organizational Chart | Any signed-in member (read)                   |
|                         |                      | `orgchart.manage` or `settings.manage` (edit) |

> The department's real chain of command: who holds each position, what area they are in charge of, and who they report to. Deliberately hand-curated rather than generated from positions or permissions — those describe what someone may do in this application, and the two hierarchies genuinely disagree (the IT Manager holds the wildcard grant and sits at the top of the permission tree while reporting to the Chief in real life). A position's title is free text and needs no matching Position or role in the software, its holder can be somebody with no account here at all (a board member, a chaplain, an auxiliary officer), and its reporting line is whatever leadership picks — the only structural rule is that a position cannot be listed under one of its own subordinates. Reading is open to every member, because the screen exists so a member can find the right person without asking around. Editing is a separate grant so a secretary or adjutant can maintain the chart without full settings access. A position can be hidden while a reorganisation is built out, which hides everyone reporting to it too. Published contact details belong to the position (`training@department.org`), never copied from the holder's member record — those stay governed by the organization's contact-visibility setting. Not gated on a module flag.

---

## Legal Documents (Governance)

| URL                 | Page            | Permission                                            |
| ------------------- | --------------- | ----------------------------------------------------- |
| `/governance/legal` | Legal Documents | `legal.propose`, `legal.publish` or `settings.manage` |

> Where the secretary and department leaders read the wording currently published on `/privacy` and `/terms` and propose alternatives that fit local bylaws, SOPs, and law. Proposing and publishing are separate grants: a proposal is a draft that changes nothing until somebody with `legal.publish` (Chief, President, IT Manager by default) publishes it. Publishing archives the previous version rather than deleting it, so the department can answer what a member was shown on a given date. Regular members hold neither grant and never see the screen. Not gated on a module flag — every deployment publishes the two public pages.

---

## Forms

| URL      | Page             | Permission     |
| -------- | ---------------- | -------------- |
| `/forms` | Forms Management | `forms.manage` |

---

## Notifications

| URL              | Page                      | Permission    |
| ---------------- | ------------------------- | ------------- |
| `/notifications` | Notification Rules & Logs | Authenticated |

> **Deep-linkable tabs** _(fixed 2026-08-10)_: `?tab=inbox`, `?tab=rules`,
> `?tab=templates`, `?tab=log`. Previously only one of the four was
> addressable — the rest fell through to the rules tab, and switching tabs
> deleted the parameter rather than updating it, so the Send Log (the one screen
> anyone has cause to send a colleague a link to) could not be linked at all. All
> four now round-trip, still gated on the permission that shows them.

> Three-tab interface: **Notification Rules** (list, create, enable/disable rules with trigger/category/channel configuration), **Email Templates** (link to template management), and **Send Log** (table view with channel filter: All / Email / In-App, mark-all-read, status indicators). Summary statistics cards show total rules, active rules, and combined send count.

> The Notifications page includes a **channel filter** (email, in-app, SMS) for filtering by delivery method. Dashboard notification cards include **clear/dismiss buttons**. Administrators can create **persistent department messages** that only admins can clear.

---

## Reports

| URL        | Page    | Permission     |
| ---------- | ------- | -------------- |
| `/reports` | Reports | `reports.view` |

---

## Integrations

| URL             | Page         | Permission        |
| --------------- | ------------ | ----------------- |
| `/integrations` | Integrations | `settings.manage` |

> _(2026-04-11)_ The Integrations page now includes **Salesforce CRM** as a connectable integration. Configuration requires `integrations.manage` permission. Features: OAuth 2.0 connection, bidirectional sync (members↔contacts, training→tasks, events→events), configurable field mappings, webhook-based real-time updates, and sync history dashboard. Supports both production and sandbox Salesforce environments.

---

## Finance _(documented 2026-08-10)_

| URL                                   | Page                       | Permission                    |
| ------------------------------------- | -------------------------- | ----------------------------- |
| `/finance`                            | Finance Dashboard          | `finance.view`                |
| `/finance/budgets`                    | Budgets                    | `finance.view`                |
| `/finance/budgets/:id`                | Budget Detail              | `finance.view`                |
| `/finance/purchase-requests`          | Purchase Requests          | `finance.view`                |
| `/finance/purchase-requests/new`      | New Purchase Request       | `finance.view`                |
| `/finance/purchase-requests/:id`      | Purchase Request Detail    | `finance.view`                |
| `/finance/purchase-requests/:id/edit` | Edit Purchase Request      | `finance.view`                |
| `/finance/expenses`                   | Expense Reports            | `finance.view`                |
| `/finance/expenses/new`               | New Expense Report         | `finance.view`                |
| `/finance/expenses/:id`               | Expense Report Detail      | `finance.view`                |
| `/finance/check-requests`             | Check Requests             | `finance.view`                |
| `/finance/check-requests/new`         | New Check Request          | `finance.view`                |
| `/finance/check-requests/:id`         | Check Request Detail       | `finance.view`                |
| `/finance/dues`                       | Dues                       | `finance.view`                |
| `/finance/settings`                   | Finance Settings           | `finance.manage`              |
| `/finance/settings/approval-chains`   | Approval Chains            | `finance.configure_approvals` |
| `/finance/approvals/:token`           | Tokenized Approval Landing | Token-based                   |

> **Separation of duties on money out** _(2026-08-09)_. The member who
> **disburses** may not be the member the record is **about**. Enforced
> server-side — not merely hidden in the UI — so a direct API call is refused
> with a `400` too:
>
> | Action                                      | Actor must differ from  |
> | ------------------------------------------- | ----------------------- |
> | Mark a purchase request paid                | the request's requester |
> | Mark an expense report paid                 | the report's requester  |
> | Issue a check                               | the request's requester |
> | Waive dues                                  | the dues member         |
> | Mark a store order paid / waive / refund it | the order's member      |
>
> **Edge case:** the out-of-band reconciliation path runs with no actor id and is
> exempt — the guard no-ops on a missing id, so an automated bank
> reconciliation is not blocked by a rule about people. A treasurer paying out
> their own reimbursement needs a second officer to record the payment.

> **Read-permission gates** _(2026-08-09)_. Reimbursement detail now requires the
> read permission rather than being reachable by any authenticated member
> (FIN-5).

---

## Grants & Fundraising _(documented 2026-08-10)_

| URL                             | Page                | Permission           |
| ------------------------------- | ------------------- | -------------------- |
| `/grants`                       | Grants Dashboard    | `fundraising.view`   |
| `/grants/opportunities`         | Grant Opportunities | `fundraising.view`   |
| `/grants/applications`          | Grant Applications  | `fundraising.view`   |
| `/grants/applications/new`      | New Application     | `fundraising.manage` |
| `/grants/applications/:id`      | Grant Detail        | `fundraising.view`   |
| `/grants/applications/:id/edit` | Edit Application    | `fundraising.manage` |
| `/grants/campaigns`             | Campaigns           | `fundraising.view`   |
| `/grants/donors`                | Donors              | `fundraising.view`   |
| `/grants/donations`             | Donations           | `fundraising.view`   |
| `/grants/reports`               | Fundraising Reports | `fundraising.view`   |

---

## Storefront _(documented 2026-08-10)_

| URL               | Page                 | Permission          |
| ----------------- | -------------------- | ------------------- |
| `/store`          | Department Store     | `storefront.view`   |
| `/store/checkout` | Review Your Order    | `storefront.view`   |
| `/store/orders`   | My Orders            | `storefront.view`   |
| `/store/admin`    | Store Administration | `storefront.manage` |

> Recording an order payment is subject to the same separation-of-duties rule as
> finance disbursement — see **Finance** above.

---

## Administrative Hours _(documented 2026-08-10)_

| URL                                           | Page                      | Permission           |
| --------------------------------------------- | ------------------------- | -------------------- |
| `/admin-hours`                                | Administrative Hours      | Authenticated        |
| `/admin-hours/:categoryId/clock-in`           | Clock In / Out            | Authenticated        |
| `/admin-hours/categories/:categoryId/qr-code` | Category QR Code          | Authenticated        |
| `/admin-hours/manage`                         | Manage Categories & Hours | `admin_hours.manage` |

> **Bulk approval cannot be used to approve your own hours** _(2026-08-08)_, and
> **deactivating a category leaves already-logged hours alone** — the confirmation
> dialog now says so _(2026-08-09)_.

---

## Communications & Messaging _(documented 2026-08-10)_

| URL                                 | Page                      | Permission                                                                           |
| ----------------------------------- | ------------------------- | ------------------------------------------------------------------------------------ |
| `/messages`                         | Messages                  | Authenticated                                                                        |
| `/messages/:messageId`              | Message Detail            | Authenticated _(2026-08-26)_                                                         |
| `/communications/messages`          | Message Administration    | `notifications.manage`                                                               |
| `/communications/email-templates`   | Email Template Management | `settings.manage`                                                                    |
| `/communications/photo-use-consent` | Photo Use Consent         | any of `users.view_consents`, `notifications.manage`, `members.manage`, `users.edit` |

> **Photo Use Consent** _(2026-08-25)_ lists every member's answer to the
> photo-use privacy choice they set in User Settings, so the PIO can check the
> whole roster before a newsletter or social post rather than one member at a
> time. Read-only: consent recorded by somebody else is not consent, so there is
> no admin write counterpart — matching `/users/{user_id}/consents`.
>
> **"Not answered" is counted separately from "Declined" and means the same
> thing.** Both are "do not publish"; they are split because only one of them
> describes a member who can still be asked. Inactive members are hidden by
> default (a retiree's photo can still be in the archive, so the toggle exists).
>
> **Permission: `notifications.manage`, `members.manage`, or `users.edit`.**
> `users.view` was the first choice and was wrong _(corrected in review)_: it
> reads as a narrow grant but 25 of the 30 default positions carry it — the EMS
> Supply Officer and Apparatus Officer among them — which would have made a
> whole-department list a **weaker** gate than reading one member's consent via
> `/users/{user_id}/consents` (`users.edit` or `members.manage`).
> `notifications.manage` is what puts the PIO here: it is the grant that
> distinguishes the Communications Officer, and it already gates this page's
> neighbours under Forms & Comms.
>
> **`users.view_consents` was added for the Historian and Public Outreach
> positions** _(2026-08-25)_, who have a real claim on the page — a historian
> curates the photo archive — but who share nothing with each other beyond
> broad grants (`users.view`, `members.view`, `events.view`). Widening to any
> of those would have reopened what the paragraph above closed, so the grant
> had to be one that means only this. It is seeded to those two positions plus
> the Communications Officer, and backfilled onto existing installations by
> `20260825_1900_c4a91b7e2f08` — a registry change alone reaches new
> departments only (CLAUDE.md pitfall 23).
>
> That backfill rewrites a stored position **only when its permission set still
> equals the pre-change default**, not merely when `is_system` is true:
> `RoleService.update_role` edits a system position's permissions in place, so
> the flag stays true on one a department has customized. A department that has
> changed its Historian keeps its own set and grants the permission itself in
> Role Management if it wants the page.
>
> The response deliberately carries **no contact fields**. The member directory
> gates email behind the organization's contact-visibility setting, and a second
> list carrying it unconditionally would quietly undo that — so the roster
> returns only what identifies somebody on a photo call sheet: name, rank,
> station, membership number.

> The Email Templates page has a **Footers** tab _(2026-08-10)_. The footer used
> to be copy-pasted into all 35 default bodies; it is now a named library on the
> organization, and each template names the footer it closes with. Three are
> seeded — **Internal** (members, the default), **Public** (outside the
> department: invites a reply and carries the mailing address) and **Official
> notice** (on the record: separations, property return, election results) — and
> a department can rename, reword, add and delete them.
>
> **Edge cases:** a template's `footer_key` of NULL means "the one marked
> default", so changing the default reaches every template that has not
> overridden it. An **unrecognised key resolves to the default rather than to
> nothing** — deleting a footer should cost the templates naming it their
> _choice_, not their footer — and the screen says how many templates use each
> one before you delete it. The library **saves whole**, because a per-footer
> save could leave `default_key` naming a footer the same request deleted.
>
> Permission: `settings.manage` **or** `organization.update_settings`.
>
> **Deep-linkable tabs** _(2026-08-11)_: `?tab=templates`, `?tab=footers`,
> `?tab=officers`, `?tab=scheduled`, `?tab=history`. The page held its tab in
> plain state, so none of the five could be linked — a secretary could not send
> a colleague a link to the footer library, and the screenshot harness could
> only ever capture the default. Same fix, and the same reason, as the
> Notifications page took on 2026-08-10.

---

## IP Security _(documented 2026-08-10)_

| URL                        | Page                       | Permission                                  |
| -------------------------- | -------------------------- | ------------------------------------------- |
| `/ip-security`             | IP Security Administration | any of `security.manage`, `settings.manage` |
| `/ip-security/my-requests` | My Access Requests         | Authenticated                               |

---

## Label, Badge & Print Routes _(documented 2026-08-10)_

Print-optimized routes. They render a print layout rather than an app screen, and
are opened from the corresponding module's list view.

| URL                                 | Prints                  | Permission                                   |
| ----------------------------------- | ----------------------- | -------------------------------------------- |
| `/members/print-labels`             | Member labels           | `members.view`                               |
| `/members/:userId/id-card`          | Member ID card          | Authenticated                                |
| `/members/scan`                     | Member badge scanner    | `users.view` **OR** `members.manage`         |
| `/prospective-members/print-labels` | Applicant badges        | `prospective_members.view`                   |
| `/inventory/print-labels`           | Inventory labels        | `inventory.manage`                           |
| `/apparatus/print-labels`           | Apparatus labels        | `apparatus.view` **OR** `apparatus.manage`   |
| `/facilities/print-labels`          | Facility / room labels  | `facilities.view` **OR** `facilities.manage` |
| `/training/print/member`            | Member training history | Authenticated                                |
| `/training/print/program`           | Training program        | Authenticated                                |
| `/training/print/compliance`        | Compliance matrix       | `training.manage`                            |
| `/scheduling/checkin/print`         | Shift check-in sheet    | Authenticated                                |
| `/scheduling/shift-reports/print`   | Shift report            | Authenticated                                |

---

## NFC Tags — a cross-module surface _(2026-08-18)_

Not a page. NFC is a second way in to a check-in that already has a QR code, so
it appears **on the QR pages** rather than getting screens of its own. A station
can mount one reusable sticker instead of reprinting a sheet per event, and a
member taps it — no camera, which is the part that fails in a dark apparatus bay
or with gloves on.

### Where the writer appears

| Page                                    | Writes a tag pointing at             | Component                                     |
| --------------------------------------- | ------------------------------------ | --------------------------------------------- |
| `/events/:id/qr-code`                   | `/events/:id/check-in`               | `NfcTagWriter`                                |
| `/admin-hours/categories/:id/qr-code`   | that category's clock-in URL         | `NfcTagWriter`                                |
| Shift detail panel → QR block           | `/scheduling/checkin?apparatus=<id>` | `NfcTagWriter`                                |
| `/locations/qr-codes` (apparatus cards) | `/scheduling/checkin?apparatus=<id>` | `NfcTagWriteButton` (compact, toast feedback) |

### Where the reader appears

**Tap Tag** (`NfcTapButton`) reads a tag while the app is already open, and
routes by what the tag _says_ rather than by where the button lives. It is on
the **Events** page, **My Admin Hours**, and the **scheduling calendar**. It
exists for the case Android does not cover on its own: with the app in the
foreground the OS does not hand a URL tag off to the browser, so a member
holding a phone they are already using would otherwise have to close the app to
use the tag.

### What a tag may point at

`TAG_TARGETS` in `constants/nfc.ts`, keyed by `NfcTagTarget` in
`constants/enums.ts`, is the whole reachable surface — adding a module means
adding one spec, not another parser, and what a tag may point at stays
reviewable in one place.

> **A tag is untrusted input.** Anyone with a phone can write one, so the
> payload is on par with a scanned QR code rather than with configuration.
> `parseNfcTagPath` resolves it against the app's own origin and rejects
> anything that does not land back on that exact origin — which also disposes of
> `javascript:` and `data:`, whose origin parses as `"null"`. It returns the
> **rebuilt** route, never the raw string, so a tap hands react-router a
> fixed-shape path instead of assigning an attacker-supplied URL to
> `window.location`. An unrecognized tag leaves the scan armed and says so
> rather than navigating somewhere unintended.

> **Only spec-named query parameters may carry an id.** Shift check-in is
> `?shift=` or `?apparatus=`, so refusing every query parameter would have made
> it untaggable. Each named value is validated against the same id pattern as a
> path segment, only the first valid one survives, and the route is rebuilt from
> those pieces — a tag cannot smuggle `?next=` past the parser by hanging it off
> an otherwise legitimate route.

> **`/display/:code` is deliberately not taggable.** It is a public,
> unauthenticated kiosk screen keyed by a non-guessable code. Writing that code
> to a tag anyone can read hands it to whoever walks past, and sending a member's
> phone to a wall display is not a check-in. A test asserts it stays rejected,
> and the same rule hides the **Write NFC tag** button on room kiosk cards while
> showing it on the apparatus cards beside them.

> **Web NFC is Android-Chromium only, and requires a secure context.** The two
> compact controls — **Tap Tag** and the `/locations/qr-codes` **Write NFC tag**
> button — render nothing where the API is absent, rather than offering a
> control that cannot work. The full `NfcTagWriter` panel instead prints _why_,
> because two very different failures present identically as a missing
> `NDEFReader`: an insecure origin (plain HTTP over a LAN IP — browsers expose
> Web NFC only in a secure context) versus a browser that never shipped the API.
> Without that split an iPhone user and an admin on `http://` both see "NFC
> unavailable" and neither learns what to do about it. QR remains the universal
> path; NFC is strictly an addition.

---

## Platform Administration

| URL                         | Page               | Permission        |
| --------------------------- | ------------------ | ----------------- |
| `/admin/platform-analytics` | Platform Analytics | `settings.manage` |

---

## User Account

| URL                 | Page                  | Permission    |
| ------------------- | --------------------- | ------------- |
| `/account`          | User Account Settings | Authenticated |
| `/settings/account` | Redirect → `/account` | Authenticated |

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

**Total: 203 declared routes + 25 admin hub tabs across 18 modules** _(counted
2026-08-10 from `App.tsx` and every `modules/*/routes.tsx`; the previous
"~110" predated the Finance, Grants, Storefront, Admin Hours, Communications,
IP Security and print/label routes, all of which are now listed above.)_

> **Note (2026-03-26):** Notification cards redesigned with expand/collapse, pinned-first sorting, contextual CTAs, and mark-as-read on collapse. Notification metadata column added for rich card rendering. Scheduling page supports `?tab=` deep-linking (schedule, my-shifts, open-shifts, requests, equipment-checks). Shift notifications deep-link to scheduling with shift pre-selected. In-process scheduled task runner replaces external cron. Standalone equipment checks (not tied to shifts). Flat scrollable check form with inline compartments and section headers. Text check type changed to read-only statement. Critical minimum quantity threshold on check items. Template clone preserves is_header and critical_minimum_quantity. EVOC certification levels integrated across training, apparatus, and scheduling. Training record category tracking. Virginia NCCR recertification standards. Event attendees importable into election ballot lists. Linked elections displayed on event and minutes detail pages. Apparatus type/status badges render actual icons. navigate(-1) replaced with hardcoded back paths and breadcrumbs. Chrome label printing fixed via iframe-based approach. App startup handles MySQL not ready with retry backoff.
>
> **Note (2026-03-24, corrected 2026-08-10):** Module availability is **per
> organization**, held in the organization's `enabled_modules` setting and
> consumed by the frontend navigation. The onboarding flow
> (`/onboarding/modules`) is where an organization chooses them, and they are
> editable afterwards in Organization Settings. There are **no deployment-level
> `MODULE_*_ENABLED` environment flags** — those were removed because they gated
> nothing (every router registers unconditionally) and merely duplicated the
> per-org mechanism. A module switched off hides its navigation; it does not by
> itself return 403 from the API.
