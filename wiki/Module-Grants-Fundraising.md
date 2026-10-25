# Grants & Fundraising Module

The Grants & Fundraising module tracks a department's outside funding in one
place: a library of grant opportunities, grant applications from research
through closeout (with a budget, expenditures, compliance tasks and notes on
each), and the fundraising side — campaigns, donors, donations, pledges and
fundraising events — with dashboards and date-ranged reports for both.

It is an optional module, enabled per organization (module id `grants`). Every
page and every endpoint is gated on the module being enabled for the caller's
organization as well as on the permissions below.

---

## Key Features

- **Grant opportunity library** — funding programs the department may apply
  to (agency, award range, match requirement, deadline type and date, category,
  required documents, federal program code), filterable by category and
  active/inactive. A program is edited from its card and retired (set
  inactive, never deleted) when it closes, so applications started from it
  keep their program; **Show retired** lists retired ones to reinstate.
- **Application pipeline** — each application moves through a fixed lifecycle
  (see [Application lifecycle](#application-lifecycle)); the applications page
  has a pipeline (one column per status) and a server-paged, server-sorted
  table view with search.
- **Budget and expenditures** — budget line items per application with
  federal share / local match split; expenditures are recorded against the
  application and optionally a budget line, which keeps the line's spent and
  remaining amounts current.
- **Overspend warnings** — spending past the award, or past a budget line,
  is accepted but flagged: create/update expenditure responses carry
  `warnings`, the write is audited as `grant_overspend_recorded`, and the
  application page shows a standing warning while spending exceeds the award.
- **Compliance tasks** — performance reports, financial reports, site visits,
  audits, equipment inventories, NFIRS submissions and closeout reports, with
  due dates, status and assignee. A standard set is generated automatically the
  first time an application becomes **Awarded** (see
  [Auto-generated compliance tasks](#auto-generated-compliance-tasks)).
- **Notes** — a per-application timeline of typed notes; status changes and
  compliance-task generation add notes automatically.
- **Fundraising campaigns** — goal, running total, dates, type, and an optional
  restriction purpose for restricted funds. A grant application can link to a
  campaign that raises its local match.
- **Donor records** — contact details, donor type, giving totals (total
  donated, donation count, first and last donation date, kept current as
  donations are recorded), tags and communication preferences.
- **Donations and pledges** — donations with payment method and status,
  recurring flag, dedications (in honor / in memory), receipt and thank-you
  tracking; pledges with fulfilled amount, due date and status.
- **Fundraising events** — dinners, galas, auctions, raffles, golf outings and
  walkathons, with ticketing, attendance, revenue goal, actual revenue and
  expenses; optionally linked to a calendar event.
- **Dashboard and reports** — the dashboard combines grant and fundraising
  figures; the reports page has **Grants** and **Fundraising** tabs over a date
  range.

### Anonymous donors

A donation or donor marked anonymous is shown in full only to callers holding
`fundraising.manage` (who need the identity for receipting). For a caller with
only `fundraising.view`, an anonymous donation's donor name, email and donor id
are cleared, and an anonymous donor reads as "Anonymous donor" with contact
details, company, notes and linked user cleared. A view-only donor search does
not match anonymous donors. Amounts, dates, campaign and payment fields stay
visible, since the totals are built from them. The logic lives in
`app/services/donor_privacy.py`.

### Dates

The dashboards' "today", the default due date of a generated equipment
inventory task, and a compliance task's `completed_date` use the organization's
calendar day (`resolve_org_today`, `America/New_York` when the organization has
no timezone). A donor's first and last donation dates are the organization's
calendar day of the donation timestamp. Report date ranges are interpreted in
the organization's timezone, falling back to UTC when none is set
(`app/utils/org_timezone.py`).

---

## Pages

Every page requires the `grants` module to be enabled.

| URL                              | Page                                | Permission           |
| -------------------------------- | ----------------------------------- | -------------------- |
| `/grants`                        | Grants & Fundraising home           | `fundraising.view`   |
| `/grants/opportunities`          | Grant opportunities                 | `fundraising.view`   |
| `/grants/opportunities/new`      | New grant opportunity               | `fundraising.manage` |
| `/grants/opportunities/:id/edit` | Edit grant opportunity              | `fundraising.manage` |
| `/grants/applications`           | Grant applications                  | `fundraising.view`   |
| `/grants/applications/new`       | New grant application               | `fundraising.manage` |
| `/grants/applications/:id`       | Grant application detail            | `fundraising.view`   |
| `/grants/applications/:id/edit`  | Edit grant application              | `fundraising.manage` |
| `/grants/campaigns`              | Fundraising campaigns               | `fundraising.view`   |
| `/grants/donors`                 | Donors                              | `fundraising.view`   |
| `/grants/donations`              | Donations                           | `fundraising.view`   |
| `/grants/donations/new`          | Record a donation                   | `fundraising.manage` |
| `/grants/pledges`                | Pledges                             | `fundraising.view`   |
| `/grants/events`                 | Fundraising events                  | `fundraising.view`   |
| `/grants/reports`                | Reports (Grants / Fundraising tabs) | `fundraising.view`   |

Campaigns, donors, pledges and fundraising events have no separate detail
routes; they are created and edited in dialogs on their list pages, which offer
those actions only to `fundraising.manage`. The applications page accepts
`?status=<status>` or `?group=active|pending|funded` (the dashboard's KPI cards
link with `group`).

Routes are defined in `frontend/src/modules/grants-fundraising/routes.tsx`.

---

## API Endpoints

All endpoints are under `/api/v1/grants`, gated on the `grants` module. Reads
require `fundraising.view`; every create, update and delete requires
`fundraising.manage`. Updates use `PUT`. Request and response bodies are
camelCase (`alias_generator=to_camel` in `app/schemas/grant.py`).

```
# Grant opportunities
GET    /grants                                          # List (category, active_only)
POST   /grants                                          # Create
GET    /grants/{opportunity_id}                         # Get
PUT    /grants/{opportunity_id}                         # Update
DELETE /grants/{opportunity_id}                         # Delete

# Grant applications
GET    /grants/applications                             # List; X-Total-Count header
POST   /grants/applications                             # Create
GET    /grants/applications/{application_id}            # Get (includes allowedNextStatuses)
PUT    /grants/applications/{application_id}            # Update
DELETE /grants/applications/{application_id}            # Delete

# Budget items
GET    /grants/applications/{app_id}/budget-items       # List for an application
POST   /grants/applications/{app_id}/budget-items       # Create
PUT    /grants/budget-items/{item_id}                   # Update
DELETE /grants/budget-items/{item_id}                   # Delete

# Expenditures
GET    /grants/applications/{app_id}/expenditures       # List for an application
POST   /grants/applications/{app_id}/expenditures       # Create (may return warnings)
PUT    /grants/expenditures/{expenditure_id}            # Update (may return warnings)
DELETE /grants/expenditures/{expenditure_id}            # Delete

# Compliance tasks
GET    /grants/compliance-tasks                         # List (application_id, status, due_before)
POST   /grants/applications/{app_id}/compliance-tasks   # Create
PUT    /grants/compliance-tasks/{task_id}               # Update
DELETE /grants/compliance-tasks/{task_id}               # Delete

# Notes
GET    /grants/applications/{app_id}/notes              # List
POST   /grants/applications/{app_id}/notes              # Add

# Campaigns
GET    /grants/campaigns                                # List (status)
POST   /grants/campaigns                                # Create
GET    /grants/campaigns/{campaign_id}                  # Get
PUT    /grants/campaigns/{campaign_id}                  # Update
DELETE /grants/campaigns/{campaign_id}                  # Delete

# Donors
GET    /grants/donors                                   # List (search)
POST   /grants/donors                                   # Create
GET    /grants/donors/{donor_id}                        # Get
PUT    /grants/donors/{donor_id}                        # Update

# Donations
GET    /grants/donations                                # List (campaign_id, donor_id, dates)
POST   /grants/donations                                # Record
PUT    /grants/donations/{donation_id}                  # Update

# Pledges
GET    /grants/pledges                                  # List (status)
POST   /grants/pledges                                  # Create
PUT    /grants/pledges/{pledge_id}                      # Update

# Fundraising events
GET    /grants/fundraising-events                       # List (campaign_id, status)
POST   /grants/fundraising-events                       # Create
PUT    /grants/fundraising-events/{event_id}            # Update

# Dashboard and reports
GET    /grants/dashboard                                # Combined grant + fundraising dashboard
GET    /grants/reports/grants                           # Grant report (start_date, end_date)
GET    /grants/reports/fundraising                      # Fundraising report (start_date, end_date)
```

Donors, donations, pledges and fundraising events have no delete endpoint.
`GET /grants/applications` takes `status`, `status_group`
(`active` / `pending` / `funded`; an unknown group is a 400), `priority`,
`assigned_to`, `search` (program name or agency), `sort`, `order`, `skip` and
`limit`. Every list endpoint pages in the database query.

Endpoints are defined in `backend/app/api/v1/endpoints/grants.py`; business
logic is in `app/services/grant_service.py` and
`app/services/fundraising_service.py`.

---

## Application lifecycle

`application_status` takes one of: `researching`, `preparing`,
`internal_review`, `submitted`, `under_review`, `awarded`, `denied`, `active`,
`reporting`, `closed`.

A new application may start at any status. After that, a status change must be
a step in `APPLICATION_STATUS_TRANSITIONS` (`app/models/grant.py`); any other
change is refused with a 400 that names the allowed next statuses, before
anything is written. The edit form's status picker offers only the allowed
next statuses plus the current one.

| From                                          | May move to                         |
| --------------------------------------------- | ----------------------------------- |
| `researching`, `preparing`, `internal_review` | each other, or `submitted`          |
| `submitted`                                   | `under_review`, `awarded`, `denied` |
| `under_review`                                | `submitted`, `awarded`, `denied`    |
| `awarded`                                     | `active`, `closed`                  |
| `denied`                                      | `researching`                       |
| `active`                                      | `reporting`, `closed`               |
| `reporting`                                   | `active`, `closed`                  |
| `closed`                                      | `reporting`                         |

The lifecycle governs status only; other fields of a closed application remain
editable. The dashboard's status groups are `active` (active, reporting),
`pending` (researching through under_review) and `funded` (awarded, active,
reporting, closed), defined once in `APPLICATION_STATUS_GROUPS`.

### Auto-generated compliance tasks

The first time an application becomes `awarded`, the service creates (once —
guarded by the application's `compliance_tasks_generated` flag):

- a **Performance Report #n** for each reporting period between the grant start
  and end dates, at the application's `reporting_frequency`
  (monthly / quarterly / semi-annual / annual);
- a **Grant Closeout Report** due 90 days after the grant end date;
- a **Grant-Funded Equipment Inventory** task when the linked opportunity's
  category is `equipment` or `vehicles`.

### Reminders

The daily `grant_reminders` scheduled task
(`app/services/grant_reminder_notifications.py`) sends two email-only
reminders, under the optional `fundraising_duties` email kind:

- **Compliance tasks** that are not completed or waived: once from
  `reminder_days_before` days before the due date, and once on the due date
  (or, if missed, up to 7 days after). It goes to the task's `assigned_to`
  when that member is active in the department and holds `fundraising.view` or
  `fundraising.manage`, otherwise to the active `fundraising.manage` holders.
- **Pledges** with `reminder_enabled`, a due date, a status of pending,
  partial or overdue, and a balance still owed: 14 days and 1 day before the
  due date, to the active `fundraising.manage` holders. The donor is never
  emailed.

Each send is recorded in `notification_logs`, keyed on the task or pledge,
its due date and the reminder, so a restart or second run sends nothing and a
moved due date starts afresh. `last_reminder_sent` is stamped on the row.
Departments with the module switched off are skipped.

---

## Data Model

Eleven tables, all in `backend/app/models/grant.py`. Tables carrying
`organization_id` are org-scoped directly; budget items, expenditures,
compliance tasks and notes are scoped through their application.

| Table                    | Purpose                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| `grant_opportunities`    | Funding programs: agency, award range, match requirement, deadline, category, documents            |
| `grant_applications`     | Applications: status, amounts requested/awarded/match, dates, reporting, assignee, linked campaign |
| `grant_budget_items`     | Budget lines per application: category, budgeted/spent/remaining, federal share, local match       |
| `grant_expenditures`     | Spending per application, optionally against a budget line; vendor, invoice, approval              |
| `grant_compliance_tasks` | Reporting and compliance obligations per application                                               |
| `grant_notes`            | Typed timeline notes per application                                                               |
| `fundraising_campaigns`  | Campaigns: goal, current amount, dates, status, restriction                                        |
| `donors`                 | Donor records and giving totals; optionally linked to a member (`user_id`)                         |
| `donations`              | Gifts, optionally linked to a campaign and a donor                                                 |
| `pledges`                | Pledged amounts, optionally linked to a campaign and a donor                                       |
| `fundraising_events`     | Fundraising events per campaign, optionally linked to a calendar `events` row                      |

The full column list for each table is in the generated
[database schema reference](https://github.com/thegspiro/the-logbook/blob/main/docs/DATABASE_SCHEMA.md).

### Enums

| Enum                     | Values                                                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `ApplicationStatus`      | researching, preparing, internal_review, submitted, under_review, awarded, denied, active, reporting, closed                            |
| `GrantCategory`          | equipment, staffing, training, prevention, facilities, vehicles, wellness, community, other                                             |
| `DeadlineType`           | fixed, recurring, rolling                                                                                                               |
| `GrantPriority`          | low, medium, high, critical                                                                                                             |
| `ReportingFrequency`     | monthly, quarterly, semi_annual, annual                                                                                                 |
| `BudgetItemCategory`     | equipment, personnel, training, contractual, supplies, travel, construction, indirect, other                                            |
| `ComplianceTaskType`     | performance_report, financial_report, progress_update, site_visit, audit, equipment_inventory, nfirs_submission, closeout_report, other |
| `ComplianceTaskStatus`   | pending, in_progress, completed, overdue, waived                                                                                        |
| `GrantNoteType`          | general, status_change, document_added, contact_made, milestone, financial, compliance                                                  |
| `CampaignType`           | general, equipment, training, community, memorial, event, other                                                                         |
| `CampaignStatus`         | draft, active, paused, completed, cancelled                                                                                             |
| `DonorType`              | individual, business, foundation, government, other                                                                                     |
| `PaymentMethod`          | cash, check, credit_card, bank_transfer, paypal, venmo, other                                                                           |
| `PaymentStatus`          | pending, completed, failed, refunded, cancelled                                                                                         |
| `RecurringFrequency`     | weekly, monthly, quarterly, annually                                                                                                    |
| `DedicationType`         | in_honor, in_memory                                                                                                                     |
| `PledgeStatus`           | pending, partial, fulfilled, cancelled, overdue                                                                                         |
| `FundraisingEventType`   | dinner, gala, auction, raffle, golf_outing, walkathon, other                                                                            |
| `FundraisingEventStatus` | planning, open, sold_out, completed, cancelled                                                                                          |

### Implementation notes

- **`grant_notes.note_metadata`** — the column cannot be named `metadata`
  (it would shadow SQLAlchemy's `Base.metadata`). The API reads and writes it
  as `metadata` via a validation/serialization alias.
- **Running totals** — a campaign's `current_amount` and a donor's giving
  totals, and a budget line's `amount_spent`, are recomputed by the service when
  donations or expenditures change, under a row lock on the campaign, donor or
  budget line so concurrent writes do not lose an update.

---

## Permissions

| Permission           | Grants                                                                       |
| -------------------- | ---------------------------------------------------------------------------- |
| `fundraising.view`   | Every page and every read endpoint; anonymous donor identities stay hidden   |
| `fundraising.manage` | Create, edit and delete across the module; sees anonymous donors' identities |

Among the default positions, `fundraising.view` is held by the Chief, Deputy
Chief, Assistant Chief, Captain, Lieutenant, President, Vice President,
Treasurer, Board of Directors and Fundraising Chair; `fundraising.manage` by the
Chief, Deputy Chief, President, Vice President, Treasurer and Fundraising Chair
(the IT Manager holds `*`). See [Role System](Role-System).

---

## Enabling the module

Enable it per organization via **Settings > Organization > Modules** (stored in
the organization's `enabled_modules` setting). There is no deployment-level
environment flag.

---

**See also:** [Original design research](../docs/GRANTS_FUNDRAISING_MODULE.md) ·
[Security review GF-22](../docs/security-review/GF-22-grants-fundraising.md) ·
[Troubleshooting](../docs/TROUBLESHOOTING.md#grants-module-serialization-issues)
