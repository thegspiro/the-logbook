# The Logbook - Training Documentation

Welcome to the training documentation for The Logbook. These guides are designed to help new users learn the system and serve as a reference for experienced users.

---

## Guides

| # | Guide | Description |
|---|-------|-------------|
| 0 | [Getting Started](./00-getting-started.md) | First login, navigation, dashboard, account settings |
| 1 | [Membership Management](./01-membership.md) | Member directory, profiles, prospective pipeline, status management, leave of absence, tiers |
| 2 | [Training & Certification](./02-training.md) | Courses, programs, requirements, submissions, compliance, external integrations |
| 3 | [Shifts & Scheduling](./03-scheduling.md) | Calendar, assignments, attendance, time-off, swaps, templates, platoon rotations, compliance, shift settings |
| 4 | [Events & Meetings](./04-events-meetings.md) | Events, QR check-in, meetings, minutes, action items, elections, public outreach pipeline |
| 5 | [Inventory Management](./05-inventory.md) | Items (individual & pool), variant groups, equipment kits, member size preferences, reorder requests, categories, assignments, checkout, batch operations, scanning, label printing, NFPA 1851 lifecycle, departure clearance |
| 6 | [Apparatus & Facilities](./06-apparatus-facilities.md) | Vehicles, maintenance, fuel, NFPA compliance, facilities dashboard, facility detail (sidebar nav), rooms, systems, inspections, utilities, capital projects |
| 7 | [Documents, Forms & Communications](./07-documents-forms.md) | File storage, form builder, notifications, messages, integrations |
| 8 | [Administration & Reports](./08-admin-reports.md) | Settings, roles, modules, reports, analytics, public portal, security, first-time setup |
| 9 | [Skills Testing & Psychomotor Evaluations](./09-skills-testing.md) | Skill sheet templates, NREMT-style evaluations, point-based scoring, statement criteria, practice mode, test visibility, post-completion review, test deletion, pass/fail, realistic example |
| 10 | [Mobile & PWA Usage](./10-mobile-pwa.md) | Installing the app, offline behavior, mobile features, QR scanning, version detection, troubleshooting |

---

## Quick Reference: Who Should Read What

### All Members
- [Getting Started](./00-getting-started.md) - Essential for everyone
- [Mobile & PWA Usage](./10-mobile-pwa.md) - Installing the app on your phone, QR scanning, mobile tips
- [Membership Management](./01-membership.md) - Sections 1-2 (directory, profiles)
- [Training & Certification](./02-training.md) - Sections 1-4 (My Training, submitting, courses, programs)
- [Shifts & Scheduling](./03-scheduling.md) - Sections 2-5 (calendar, my shifts, open shifts, assignments)
- [Events & Meetings](./04-events-meetings.md) - Sections 1-2, 7-8 (events, RSVP, action items, voting)
- [Inventory Management](./05-inventory.md) - Section 3 (your assignments)

### Officers and Line Officers
All of the above, plus:
- [Training & Certification](./02-training.md) - Sections 5-12 (officer dashboard, reviews, compliance, integrations)
- [Skills Testing](./09-skills-testing.md) - Template creation, test administration, scoring, results
- [Shifts & Scheduling](./03-scheduling.md) - All sections including templates, platoon rotations, and reports
- [Events & Meetings](./04-events-meetings.md) - Sections 3-6, 9-10 (QR setup, creating events, templates, minutes, outreach pipeline)
- [Inventory Management](./05-inventory.md) - All sections including NFPA 1851 lifecycle and departure clearance
- [Apparatus & Facilities](./06-apparatus-facilities.md) - All sections
- [Documents, Forms & Communications](./07-documents-forms.md) - All sections including form builder walkthrough
- [Administration & Reports](./08-admin-reports.md) - Sections 5-6 (reports, analytics)

### IT Manager / System Administrator
All guides in their entirety, with special attention to:
- [Administration & Reports](./08-admin-reports.md) - All sections, especially the first-time setup walkthrough
- [Documents, Forms & Communications](./07-documents-forms.md) - Sections 8-10 (integrations)
- [Mobile & PWA Usage](./10-mobile-pwa.md) - Understand what members experience on their devices

---

## Screenshot Placeholders

Throughout these guides you will find screenshot placeholder lines formatted as:

> **Screenshot placeholder:** or **Screenshot needed:**
> _[Description of what the screenshot should show]_

These indicate where a screenshot should be inserted. The description explains what should be captured. Lines marked **Screenshot needed:** are newly added sections that particularly require visual documentation. To add screenshots:

1. Take the screenshot as described.
2. Save it to the `docs/training/images/` directory.
3. Replace the placeholder with: `![Alt text](./images/filename.png)`

---

## Conventions Used in These Guides

- **Required Permission:** indicates a feature requires a specific role permission
- **Hint:** provides helpful tips and best practices
- **Troubleshooting** sections at the end of each guide address common issues
- **Edge Cases** call out non-obvious behavior to watch for
- Cross-references like [Module > Section](./file.md#section) link to related content

---

## Module Availability

Not all modules are enabled by default. Your department administrator controls which modules are active. If you cannot find a module in the navigation:

1. Check with your administrator.
2. They can enable it in **Settings > Organization > Modules**.
3. Enabling a module does not require any data migration -- it simply makes the module visible.

| Module | Default State |
|--------|--------------|
| Dashboard, Membership, Scheduling, Settings, Documents, Forms | **Always On** (Core, enabled by default) |
| Apparatus, Inventory, Communications | **On** (Recommended, enabled by default) |
| Training, Facilities, Prospective Pipeline, Admin Hours | **Off** (Optional, enable in Settings > Modules) |
| Incidents, HR, Grants, Public Info | **Off** (Optional, enable in Settings > Modules) |

> **Note (2026-03-19):** Equipment Check system added — structured vehicle and equipment inspections with template builder (7 check types, nested compartments, drag-and-drop), phone-first check form (photos, serial/lot tracking, expiration), auto-deficiency flagging on apparatus, failure notifications, and compliance/failure/trend reports with CSV/PDF export. Scheduling module adds position eligibility system (ranks define eligible shift positions), admin sub-pages, structured position slots with decline handling, and comprehensive timezone fixes. Elections module hardened with audit logging, race condition fixes, ballot sending reliability (`hybrid_property` fix), eligibility summary email to secretary, and election report email. Dark mode hardened across 25+ files with opaque backgrounds for floating UI. Event notifications deliver in-app. All time pickers enforce 15-minute increments. UTC timezone markers added to all API response schemas via `UTCResponseBase`.
>
> **Note (2026-03-15):** Training module now supports recurring training sessions (daily, weekly, monthly, etc.) with quarter-hour time picker, quick duration buttons, and course auto-populate. Scheduling module carries template positions to crew roster and fixes timezone display in shift editing. Inventory auto-generates size/style variants on item creation. UTC datetime display root cause fixed (SQLAlchemy `load` event listener stamps naive datetimes with UTC tzinfo). Pipeline overview report with configurable stage grouping, drag-and-drop email section reordering, email preview panel, and server-side days-in-stage calculation. Events module adds series end email reminders, check-in modal fix, and timezone-aware conflict detection. Non-dismissable modal overlays fixed across the app.
>
> **Note (2026-03-14):** New modules added: Medical Screening (health screenings, physicals, drug tests, fitness assessments), Compliance Requirements Configuration (configurable thresholds, profiles, automated reporting), and Finance (budgets, purchase requests, expenses, approval chains). The Events module has been significantly expanded with calendar view, analytics dashboard, templates management, RSVP enhancements (dietary/accessibility fields, waitlist, inline RSVP, series RSVP), event notifications panel, draft/publish workflow, CSV import, and saved filter presets. The Prospective Members Pipeline now supports auto-advance for form/document stages, stage regression (move back), and automated email sending on stage advance.
>
> **Note (2026-03-07):** Standard modules now default to enabled on fresh installations. The Settings UI has been redesigned with module cards for better visibility. If modules appear missing after an update, check **Settings > Organization > Modules**. Recent additions: Grants & Fundraising module (grant applications, campaigns, donor management), compliance officer dashboard (ISO readiness, attestations, NFPA 1401), training enhancements (recertification tracking, competency matrix, instructor management, xAPI integration), inventory improvements (variant groups, equipment kits, member size preferences, reorder requests with SMS alerts, item detail page, cost tracking, charges, return requests, quarantine, pool item size variants, mobile card views, barcode printing), facilities module rewrite (dashboard, full-page detail with sidebar nav, FacilityRoomPicker), comprehensive security audit with 25-issue remediation, test infrastructure (vitest-axe, hypothesis, schemathesis, coverage ratcheting). Mobile member ID scanning is available for inventory checkout. PWA shortcuts provide quick access to Dashboard, Events, and Scheduling from the home screen icon.
