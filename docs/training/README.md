# The Logbook - Training Documentation

Welcome to the training documentation for The Logbook. These guides are designed to help new users learn the system and serve as a reference for experienced users.

---

## Guides

| # | Guide | Description |
|---|-------|-------------|
| 0 | [Getting Started](./00-getting-started.md) | First login, navigation, dashboard, account settings |
| 1 | [Membership Management](./01-membership.md) | Member directory, profiles, prospective pipeline, status management, leave of absence, tiers |
| 2 | [Training & Certification](./02-training.md) | Courses, programs, requirements, submissions, compliance, external integrations |
| 3 | [Shifts & Scheduling](./03-scheduling.md) | Calendar, assignments, attendance, time-off, swaps, templates, patterns, compliance |
| 4 | [Events & Meetings](./04-events-meetings.md) | Events, QR check-in, meetings, minutes, action items, elections |
| 5 | [Inventory Management](./05-inventory.md) | Items, categories, assignments, checkout, scanning, maintenance, departure clearance |
| 6 | [Apparatus & Facilities](./06-apparatus-facilities.md) | Vehicles, maintenance, fuel, NFPA compliance, stations, inspections, utilities |
| 7 | [Documents, Forms & Communications](./07-documents-forms.md) | File storage, form builder, notifications, messages, integrations |
| 8 | [Administration & Reports](./08-admin-reports.md) | Settings, roles, modules, reports, analytics, public portal, security |

---

## Quick Reference: Who Should Read What

### All Members
- [Getting Started](./00-getting-started.md) - Essential for everyone
- [Membership Management](./01-membership.md) - Sections 1-2 (directory, profiles)
- [Training & Certification](./02-training.md) - Sections 1-4 (My Training, submitting, courses, programs)
- [Shifts & Scheduling](./03-scheduling.md) - Sections 2-5 (calendar, my shifts, open shifts, assignments)
- [Events & Meetings](./04-events-meetings.md) - Sections 1-2, 7-8 (events, RSVP, action items, voting)
- [Inventory Management](./05-inventory.md) - Section 3 (your assignments)

### Officers and Line Officers
All of the above, plus:
- [Training & Certification](./02-training.md) - Sections 5-12 (officer dashboard, reviews, compliance, integrations)
- [Shifts & Scheduling](./03-scheduling.md) - All sections including templates, patterns, and reports
- [Events & Meetings](./04-events-meetings.md) - Sections 3-6 (QR setup, creating events, templates, minutes)
- [Inventory Management](./05-inventory.md) - All sections
- [Apparatus & Facilities](./06-apparatus-facilities.md) - All sections
- [Documents, Forms & Communications](./07-documents-forms.md) - All sections
- [Administration & Reports](./08-admin-reports.md) - Sections 5-6 (reports, analytics)

### IT Manager / System Administrator
All guides in their entirety, with special attention to:
- [Administration & Reports](./08-admin-reports.md) - All sections
- [Documents, Forms & Communications](./07-documents-forms.md) - Sections 8-10 (integrations)

---

## Screenshot Placeholders

Throughout these guides you will find screenshot placeholder lines formatted as:

> **Screenshot placeholder:**
> _[Description of what the screenshot should show]_

These indicate where a screenshot should be inserted. The description explains what should be captured. To add screenshots:

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
| Dashboard, Membership, Scheduling, Settings, Documents, Forms | **Always On** (Core) |
| Apparatus, Inventory, Communications | **On** (Recommended) |
| Training, Facilities, Prospective Pipeline | **Off** (Optional) |
| Incidents, HR, Grants, Public Info | **Off** (Optional) |
