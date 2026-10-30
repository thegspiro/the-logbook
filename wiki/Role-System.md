# Role-Based Access Control (RBAC) System

This page is the reference for how The Logbook decides what a member can see
and do: positions, operational ranks, the permission registry, and the screens
and endpoints that manage them. The registry itself is
`backend/app/core/permissions.py` — when this page and that file disagree, the
file wins.

## Overview

A member's **effective permissions** are the union of:

1. the permissions stored on every **position** assigned to them (the
   `positions` table, linked through `user_positions`);
2. the default permissions of their **operational rank**, if they have one
   (`users.rank`, resolved through `OPERATIONAL_RANKS`);
3. the current names of any retired permission strings found in either (see
   [Legacy permission names](#legacy-permission-names)).

This is computed in one place, `_collect_user_permissions` in
`backend/app/api/dependencies.py`, and every server-side check goes through it.
Permissions are additive — there are no deny rules.

> **Positions are what the API calls "roles".** The model was renamed from
> roles to positions; the endpoints are still under `/api/v1/roles` and
> `/api/v1/users/{id}/roles`, and the settings screen is at `/settings/roles`.
> Both words refer to the same rows.

### How a permission is matched

`permission_matches` in `permissions.py` is the single matching rule:

- `*` grants everything (held by the IT Manager position);
- an exact string matches itself (`settings.edit`);
- a module wildcard matches every permission in that module (`inventory.*`
  satisfies `inventory.check_manage`).

Endpoints declare their requirement with `require_permission(...)` (any one of
the listed permissions suffices) or `require_all_permissions(...)` (all are
needed). A permission check only says the caller holds the permission in their
own organization; it never scopes the record being touched, which every
endpoint resolves through an organization-scoped query (CLAUDE.md pitfall #14).

## Default positions

Each organization is seeded at onboarding from `DEFAULT_POSITIONS`, narrowed by
agency type: the discipline positions (Engineer, Firefighter, EMT) are seeded
only where the agency has that discipline — an EMS-only service gets no
Firefighter, and its Engineer is labelled **Driver / Operator**. During the
onboarding position step the person setting up the platform chooses which
positions to keep. All seeded positions are system positions
(`is_system = true`).

Every member also holds the baseline **Member** position. Higher priority means
more authority; priority orders positions in lists and is not itself a
permission.

**Every position has a `kind`** _(2026-10-29)_: `office` (a permission-bearing
job), `committee` (a group a member serves on, granting nothing of its own) or
`system` (the baseline `member`, the `it_manager` owner and the rank mirrors).
`POSITION_KINDS` in `app/core/permissions.py` is the vocabulary; every
`DEFAULT_POSITIONS` entry states its kind, and `position_kind_for(slug)`
answers for a seeded slug. The member profile groups a member's positions by
it, and the positions editor asks for it when a position is created. A client
may create or change a position as `office` or `committee`; `system` is
reserved and refused, and a seeded position keeps the kind the registry gives
it. Four committees are seeded to every agency type — `community_outreach_team`,
`history_committee`, `fundraising_committee`, `membership_committee` — each
carrying a _copy_ of the baseline `member` list (never the same list object:
CLAUDE.md pitfall #23), so a member whose only position is a committee still
reaches the member screens; `tests/test_baseline_member_grants.py` holds the
four to the baseline.

| Position (slug)                                                           | Priority | What it manages beyond the baseline                                                                                                                                                       |
| ------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IT Manager** (`it_manager`)                                             | 100      | `*` — every permission. The System Owner position held by whoever sets up the platform                                                                                                    |
| **Chief** (`fire_chief`)                                                  | 95       | Full operational and administrative authority: members, positions, organization settings, security, every module                                                                          |
| **President** (`president`)                                               | 95       | Full administrative authority: members, positions, organization settings, security, every module                                                                                          |
| **Deputy Chief** (`deputy_chief`)                                         | 90       | Members and position assignment, training, compliance, scheduling, inventory, apparatus, facilities, events, elections, fundraising, integrations; not positions or organization settings |
| **Assistant Chief** (`assistant_chief`)                                   | 85       | As Deputy Chief, without elections, fundraising, integrations or deletes on apparatus, facilities, events and locations                                                                   |
| **Quartermaster** (`quartermaster`)                                       | 85       | Gear, uniforms, medical supplies, equipment checklists, storefront                                                                                                                        |
| **Vice President** (`vice_president`)                                     | 80       | Members and position assignment, meetings, minutes, elections, compliance, fundraising, reports, the NFC tag grants                                                                       |
| **Secretary** (`secretary`)                                               | 75       | Members (create, manage, assign positions, ID cards), meetings, minutes, elections, events, forms, documents, compliance, reports, contact visibility                                     |
| **Treasurer** (`treasurer`)                                               | 75       | Finance (manage, approve, approval chains), fundraising, documents, reports                                                                                                               |
| **Captain** (`captain`)                                                   | 70       | Members, training, compliance, scheduling, equipment checklists, events, apparatus maintenance                                                                                            |
| **Board of Directors** (`board_of_directors`)                             | 70       | Leadership read access plus `reports.manage`                                                                                                                                              |
| **Assistant Secretary** (`assistant_secretary`)                           | 70       | Members (manage, ID cards, check-in), meetings, minutes, documents                                                                                                                        |
| **Safety Officer** (`safety_officer`)                                     | 65       | Compliance, training, documents, forms, reports, events                                                                                                                                   |
| **Training Officer** (`training_officer`)                                 | 65       | Training (including department analytics), compliance, events, locations, reports                                                                                                         |
| **Lieutenant** (`lieutenant`)                                             | 60       | Training, scheduling, equipment checklists, events, apparatus maintenance                                                                                                                 |
| **Compliance Officer** (`compliance_officer`)                             | 60       | Compliance, training, documents, reports                                                                                                                                                  |
| **Meeting Hall Coordinator** (`meeting_hall_coordinator`)                 | 60       | Events and locations                                                                                                                                                                      |
| **EMS Supply Officer** (`ems_supply_officer`)                             | 55       | Medical supplies and equipment checklists — no gear or uniforms                                                                                                                           |
| **Public Outreach** (`public_outreach`)                                   | 55       | Events, locations, the photo-use consent roster                                                                                                                                           |
| **Communications Officer / PIO** (`communications_officer`)               | 55       | Events, notification rules, suggestion boxes, the photo-use consent roster                                                                                                                |
| **Membership Coordinator** (`membership_coordinator`)                     | 55       | Member records (create, edit, manage, assign positions, ID cards), the applicant pipeline                                                                                                 |
| **Fundraising Chair** (`fundraising_chair`)                               | 55       | Fundraising, events, reports                                                                                                                                                              |
| **Scheduling Officer** (`scheduling_officer`)                             | 55       | Scheduling and equipment checklists                                                                                                                                                       |
| **Apparatus Officer** (`apparatus_officer`)                               | 50       | Apparatus records and maintenance, apparatus NFC tags, inventory including medical supplies, equipment checklists, storefront                                                             |
| **Assistant Membership Coordinator** (`assistant_membership_coordinator`) | 50       | The applicant pipeline and member ID cards, with a read-only roster                                                                                                                       |
| **Historian** (`historian`)                                               | 50       | Documents and the photo-use consent roster                                                                                                                                                |
| **Facilities Manager** (`facilities_manager`)                             | 50       | Facilities, room NFC tags, inventory, storefront                                                                                                                                          |
| **Engineer / Driver Operator** (`engineer`)                               | 40       | Apparatus maintenance                                                                                                                                                                     |
| **Firefighter** (`firefighter`)                                           | 15       | Baseline only                                                                                                                                                                             |
| **EMT** (`emt`)                                                           | 12       | Baseline only                                                                                                                                                                             |
| **Member** (`member`)                                                     | 10       | The baseline every member holds (below)                                                                                                                                                   |
| **Community Education / Outreach Team** (`community_outreach_team`)       | 10       | A committee: nothing beyond the baseline                                                                                                                                                  |
| **History Committee** (`history_committee`)                               | 10       | A committee: nothing beyond the baseline                                                                                                                                                  |
| **Fundraising Committee** (`fundraising_committee`)                       | 10       | A committee: nothing beyond the baseline                                                                                                                                                  |
| **Membership Committee** (`membership_committee`)                         | 10       | A committee: nothing beyond the baseline                                                                                                                                                  |

The **baseline** (the Member position) is read access to the member directory,
organization, training, scheduling, inventory, storefront, meetings, elections,
events, forms, minutes, documents and locations, plus `scheduling.swap`,
`inventory.check_submit`, `storefront.order` and `finance.request`.

The summaries above are a guide; the exact grant list for each position is the
`permissions` entry in `DEFAULT_POSITIONS`. A department can change any
position's permissions after onboarding, so what an installation actually
grants is what its **Role Management** screen shows.

## Operational ranks

An operational rank is a chain-of-command rung stored on the member
(`users.rank`). Its default permissions are unioned into the member's effective
set, on top of their positions.

| Rank (code)                         | Priority |
| ----------------------------------- | -------- |
| Chief (`fire_chief`)                | 95       |
| Deputy Chief (`deputy_chief`)       | 90       |
| Assistant Chief (`assistant_chief`) | 85       |
| Captain (`captain`)                 | 70       |
| Lieutenant (`lieutenant`)           | 60       |
| Engineer (`engineer`)               | 40       |
| Firefighter (`firefighter`)         | 10       |
| EMT (`emt`)                         | 5        |

Each rank's default permissions are the same list as the matching position's in
`DEFAULT_POSITIONS` — the registry entries share one list object. The
`operational_ranks` table has no permissions column, but the grants still reach
the database through the seeded positions, so **changing a seeded grant needs a
migration, not just a registry edit**: see
[docs/rules/migrations.md](https://github.com/thegspiro/the-logbook/blob/main/docs/rules/migrations.md#a-seeded-rank-grant-reaches-the-database-through-a-position).

## Permission catalogue

The registry (`ALL_PERMISSIONS`) holds 120 permissions. The categories are the
groups the Role Management screen shows.

| Category                                   | Permission                           | Description                                                                                  |
| ------------------------------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------- |
| Users                                      | `users.view`                         | View user list                                                                               |
|                                            | `users.create`                       | Create new users                                                                             |
|                                            | `users.edit`                         | Edit user information                                                                        |
|                                            | `users.delete`                       | Delete users                                                                                 |
|                                            | `users.view_contact`                 | View user contact information                                                                |
|                                            | `users.view_consents`                | View member privacy consent records                                                          |
|                                            | `users.update_positions`             | Update user positions                                                                        |
| Members                                    | `members.view`                       | View member list                                                                             |
|                                            | `members.manage`                     | Manage member profiles                                                                       |
|                                            | `members.assign_positions`           | Assign positions to members                                                                  |
|                                            | `members.manage_id_cards`            | Issue and revoke member ID card (NFC) credentials                                            |
|                                            | `members.check_in`                   | Check members in at an ID card check-in station                                              |
|                                            | `members.create`                     | Add prospective members to the recruitment pipeline                                          |
| Positions                                  | `positions.view`                     | View positions                                                                               |
|                                            | `positions.create`                   | Create new positions                                                                         |
|                                            | `positions.edit`                     | Edit positions                                                                               |
|                                            | `positions.update`                   | Update positions                                                                             |
|                                            | `positions.delete`                   | Delete positions                                                                             |
|                                            | `positions.manage_permissions`       | Manage position permissions                                                                  |
| Organization                               | `organization.view`                  | View organization info                                                                       |
|                                            | `organization.edit`                  | Edit organization info                                                                       |
|                                            | `organization.update_settings`       | Update organization settings                                                                 |
|                                            | `organization.template.manage`       | Export and import department configuration templates                                         |
|                                            | `orgchart.manage`                    | Maintain the department organizational chart                                                 |
| Settings and legal                         | `settings.view`                      | View settings                                                                                |
|                                            | `settings.edit`                      | Edit settings                                                                                |
|                                            | `settings.manage`                    | Full settings and admin management                                                           |
|                                            | `settings.manage_contact_visibility` | Manage contact info visibility                                                               |
|                                            | `legal.propose`                      | View legal documents and propose revisions                                                   |
|                                            | `legal.publish`                      | Publish legal document revisions to the public pages                                         |
| Security                                   | `security.manage`                    | Manage IP security and access controls                                                       |
| Training                                   | `training.view`                      | View training records                                                                        |
|                                            | `training.manage`                    | Manage training records                                                                      |
|                                            | `training.configure`                 | Configure training module settings                                                           |
|                                            | `training.view_all`                  | View all training records across organization                                                |
|                                            | `training.view_analytics`            | View department-wide shift report analytics                                                  |
| Compliance and medical screening           | `compliance.view`                    | View compliance records                                                                      |
|                                            | `compliance.manage`                  | Manage compliance records                                                                    |
|                                            | `medical_screening.view`             | View member medical screenings                                                               |
|                                            | `medical_screening.manage`           | Manage member medical screenings                                                             |
| Scheduling                                 | `scheduling.view`                    | View schedules                                                                               |
|                                            | `scheduling.manage`                  | Manage schedules                                                                             |
|                                            | `scheduling.assign`                  | Assign members to shifts                                                                     |
|                                            | `scheduling.swap`                    | Request and manage shift swaps                                                               |
|                                            | `scheduling.report`                  | View shift reports and analytics                                                             |
| Inventory, equipment checks and storefront | `inventory.view`                     | View gear, uniforms and equipment                                                            |
|                                            | `inventory.manage`                   | Manage gear, uniforms and equipment                                                          |
|                                            | `inventory.view_medical`             | View medical supplies                                                                        |
|                                            | `inventory.manage_medical`           | Manage medical supplies, stock lots, and expiration tracking                                 |
|                                            | `inventory.check_view`               | View equipment check templates and results                                                   |
|                                            | `inventory.check_manage`             | Create and edit equipment check templates                                                    |
|                                            | `inventory.check_submit`             | Submit equipment checks on shifts                                                            |
|                                            | `inventory.kiosk`                    | Open self-service checkout kiosk mode                                                        |
|                                            | `storefront.view`                    | Browse the department store and track your own orders                                        |
|                                            | `storefront.order`                   | Place store orders                                                                           |
|                                            | `storefront.manage`                  | Manage the store catalog, order windows, orders, and payments                                |
| Meetings                                   | `meetings.view`                      | View meetings                                                                                |
|                                            | `meetings.manage`                    | Manage meetings                                                                              |
| Elections                                  | `elections.view`                     | View elections                                                                               |
|                                            | `elections.manage`                   | Manage elections                                                                             |
| Fundraising                                | `fundraising.view`                   | View fundraising data                                                                        |
|                                            | `fundraising.manage`                 | Manage fundraising                                                                           |
| Audit                                      | `audit.view`                         | View audit logs                                                                              |
|                                            | `audit.export`                       | Export audit logs                                                                            |
|                                            | `audit.manage`                       | Manage and clear diagnostic error logs                                                       |
| Events                                     | `events.view`                        | View events                                                                                  |
|                                            | `events.create`                      | Create events                                                                                |
|                                            | `events.edit`                        | Edit events                                                                                  |
|                                            | `events.delete`                      | Delete events                                                                                |
|                                            | `events.manage`                      | Manage all events                                                                            |
|                                            | `events.reopen_attendance`           | Reopen finalized event attendance                                                            |
| Locations                                  | `locations.view`                     | View locations                                                                               |
|                                            | `locations.create`                   | Create locations                                                                             |
|                                            | `locations.edit`                     | Edit locations                                                                               |
|                                            | `locations.delete`                   | Delete locations                                                                             |
|                                            | `locations.manage`                   | Manage all locations                                                                         |
|                                            | `locations.manage_nfc_tags`          | Write NFC check-in tags for rooms                                                            |
| Forms                                      | `forms.view`                         | View forms and submissions                                                                   |
|                                            | `forms.manage`                       | Create, edit, and manage forms                                                               |
| Administration and system                  | `admin.access`                       | Full administrative access                                                                   |
|                                            | `system.run_tasks`                   | Trigger platform-wide background tasks                                                       |
|                                            | `system.manage_link_domain`          | Change the address links in outgoing email use                                               |
| Minutes                                    | `minutes.view`                       | View meeting minutes                                                                         |
|                                            | `minutes.manage`                     | Create, edit, and manage meeting minutes                                                     |
| Documents                                  | `documents.view`                     | View documents                                                                               |
|                                            | `documents.manage`                   | Manage documents and folders                                                                 |
| Apparatus                                  | `apparatus.view`                     | View apparatus and fleet information                                                         |
|                                            | `apparatus.create`                   | Create new apparatus records                                                                 |
|                                            | `apparatus.edit`                     | Edit apparatus records                                                                       |
|                                            | `apparatus.delete`                   | Delete apparatus records                                                                     |
|                                            | `apparatus.maintenance`              | Log and manage maintenance records                                                           |
|                                            | `apparatus.manage`                   | Full apparatus and fleet management                                                          |
|                                            | `apparatus.approve_driver_exception` | Approve exceptions to the EVOC driving requirement                                           |
|                                            | `apparatus.manage_nfc_tags`          | Write NFC shift check-in tags for apparatus                                                  |
| Facilities                                 | `facilities.view`                    | View facilities and buildings                                                                |
|                                            | `facilities.view_sensitive`          | View sensitive facility data (access codes, utility accounts, insurance, budgets, occupants) |
|                                            | `facilities.create`                  | Create new facility records                                                                  |
|                                            | `facilities.edit`                    | Edit facility records                                                                        |
|                                            | `facilities.delete`                  | Delete facility records                                                                      |
|                                            | `facilities.maintenance`             | Log and manage facility maintenance                                                          |
|                                            | `facilities.manage`                  | Full facility management                                                                     |
| Analytics                                  | `analytics.view`                     | View analytics and dashboards                                                                |
| Integrations                               | `integrations.manage`                | Manage third-party integrations                                                              |
|                                            | `integrations.mcp_keys`              | Issue and revoke Claude MCP service keys                                                     |
| Notifications                              | `notifications.view`                 | View notifications                                                                           |
|                                            | `notifications.manage`               | Manage notification rules                                                                    |
| Suggestions                                | `suggestions.manage`                 | Create and configure suggestion boxes and their reviewers                                    |
| Reports                                    | `reports.view`                       | View and generate reports                                                                    |
|                                            | `reports.manage`                     | Create, edit, and delete saved reports                                                       |
| Admin hours                                | `admin_hours.view`                   | View own admin hours                                                                         |
|                                            | `admin_hours.log`                    | Log admin hours (clock in/out, manual entry)                                                 |
|                                            | `admin_hours.manage`                 | Manage admin hours categories, approve/reject entries, view all members                      |
| Finance                                    | `finance.view`                       | View financial data and budgets                                                              |
|                                            | `finance.manage`                     | Manage budgets, fiscal years, categories, and process payments                               |
|                                            | `finance.approve`                    | Approve purchase requests, expenses, and check requests                                      |
|                                            | `finance.configure_approvals`        | Manage approval chains and routing configuration                                             |
|                                            | `finance.request`                    | Create, submit and track your own purchase requests, expense reports and check requests      |
|                                            | `finance.budget_review`              | Adjust next year's budget requests during leadership review                                  |
| Prospective members                        | `prospective_members.view`           | View prospective member pipeline                                                             |
|                                            | `prospective_members.manage`         | Manage prospective members and pipeline                                                      |

### Grants worth knowing

- **`members.view`** is the redacted member directory. The ID-card scanner
  (`/members/scan`) needs `users.view` or `members.manage`.
- **Another member's ID card page** needs `members.manage` or
  `members.manage_id_cards`; every member can open their own.
- **`training.configure`** lets an officer set the training module's
  member-disclosure policy (`PUT /api/v1/training/module-config/config` accepts it for that
  setting only; the rest still need `training.manage`) and read the skill
  evaluation list, without the power to edit training records.
- **`training.view_analytics`** is the department-wide view of shift reports;
  without it a training officer sees only their own.
- **`suggestions.manage`** creates and configures suggestion boxes and chooses
  their reviewers. It reads nothing: only a box's reviewers read its
  submissions.
- **`apparatus.manage_nfc_tags`** and **`locations.manage_nfc_tags`** decide
  who the app offers the NFC tag writer to. A tag carries no secret.
- **`integrations.mcp_keys`** (issuing and revoking the Claude MCP service key)
  and **`system.manage_link_domain`** (the address emailed links use) are held
  by no default position; only the IT Manager's `*` matches them.
- **`compliance.view`** is accepted, alongside `training.manage` and
  `reports.view`, by `GET /api/v1/compliance/contributed-hours`.
- **A module wildcard covers the whole module.** `inventory.*` includes the
  three equipment-checklist permissions (`inventory.check_*`). No seeded
  position grants a module wildcard; the onboarding position editor saves one
  when a module is given **Manage**.

### Legacy permission names

- **`equipment_check.view` / `.manage` / `.submit` / `.*`** are retired names
  of `inventory.check_view` / `check_manage` / `check_submit`
  (`LEGACY_PERMISSION_ALIASES`). A stored grant under the old name is expanded
  to the new one whenever permissions are collected, so it keeps working.
- **`roles.*`, `members.assign_roles` and `users.update_roles`** are the
  pre-rename names of `positions.*`, `members.assign_positions` and
  `users.update_positions`. They are **not** in the registry — the Role
  Management screen does not offer them and they are not expanded like the
  aliases above — but the position endpoints (`/api/v1/roles…`) and the
  position-assignment endpoints (`/api/v1/users/{id}/roles…`) still list them
  as accepted alternatives, as does the admin-access check
  (`GET /api/v1/roles/admin-access/check`). A position that still stores one
  keeps that access on those endpoints only. Grant the `positions.*` names.

## Using the system

### Screens

| Screen                | Route             | Gate                           | What it does                                                    |
| --------------------- | ----------------- | ------------------------------ | --------------------------------------------------------------- |
| **Role Management**   | `/settings/roles` | `positions.manage_permissions` | Create, edit, clone and delete positions; edit permission lists |
| **Members admin hub** | `/members/admin`  | `members.manage`               | Member list; **Manage Positions** assigns positions to a member |

`/admin/members` redirects to `/members/admin`.

### Assigning positions

In the members admin hub, open a member's **Manage Positions** dialog, tick
the positions to hold (offices are listed first, then committees) and save. A member may hold several positions; their
permissions are the union. The server refuses an assignment that would give a
position carrying permissions the person saving does not hold (the grant
ceiling); positions the member already held are not re-checked. The baseline
Member position can be removed only from an archived member.

### Editing positions

- **System positions cannot be deleted**, and cannot be renamed — except the
  baseline `member` position, whose display name a department may change.
  No position's slug can be changed. A system position's priority and kind are
  fixed; a department's own position may be switched between office and
  committee.
- **Permissions on any position can be edited**, subject to the grant ceiling:
  you cannot add permissions you do not hold, and you cannot edit a position
  whose current permissions already exceed yours.
- **The organization always keeps an administrator.** Any change that would
  leave no active member holding `members.manage` — a status change, archive,
  deletion, position removal, or a position permission edit — is refused
  (`app/services/admin_continuity_service.py`). A position change may also not
  take `*` from the organization's only active holder. Keep at least two people
  holding `members.manage`: recovering from a lock-out needs direct database
  access.

## Backend API

All under `/api/v1`. Alternatives in parentheses are the legacy names
described above.

**Positions** (`app/api/v1/endpoints/roles.py`):

| Method and path                         | Permission (any one)                                                                                |
| --------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `GET /roles/permissions`                | any signed-in member                                                                                |
| `GET /roles/permissions/by-category`    | any signed-in member                                                                                |
| `GET /roles`                            | `positions.view` (`roles.view`)                                                                     |
| `POST /roles`                           | `positions.create`, `positions.manage_permissions` (`roles.create`)                                 |
| `GET /roles/{id}`                       | `positions.view` (`roles.view`)                                                                     |
| `PATCH /roles/{id}`                     | `positions.edit`, `positions.update`, `positions.manage_permissions` (`roles.edit`, `roles.update`) |
| `DELETE /roles/{id}`                    | `positions.delete`, `positions.manage_permissions` (`roles.delete`)                                 |
| `POST /roles/{id}/clone`                | `positions.create`, `positions.manage_permissions` (`roles.create`)                                 |
| `GET /roles/{id}/users`                 | `positions.view`, `users.view` (`roles.view`)                                                       |
| `GET /roles/user/{user_id}/permissions` | `users.view`, `positions.view` (`roles.view`)                                                       |
| `GET /roles/my/roles`                   | any signed-in member                                                                                |
| `GET /roles/my/permissions`             | any signed-in member                                                                                |
| `GET /roles/admin-access/check`         | any signed-in member                                                                                |

**Position assignment** (`app/api/v1/endpoints/users.py`) — each needs
`members.assign_positions` or `users.update_positions`
(`members.assign_roles`, `users.update_roles`):

| Method and path                           | Effect                         |
| ----------------------------------------- | ------------------------------ |
| `PUT /users/{user_id}/roles`              | Replace the member's positions |
| `POST /users/{user_id}/roles/{role_id}`   | Add one position               |
| `DELETE /users/{user_id}/roles/{role_id}` | Remove one position            |

`GET /users/with-roles` and `GET /users/{user_id}/roles` list members with
their positions.

## Extending the system

1. Add a `Permission(...)` constant in `backend/app/core/permissions.py` and
   add it to `ALL_PERMISSIONS`.
2. Grant it to the positions that should hold it in `DEFAULT_POSITIONS`. This
   only reaches organizations onboarded afterwards; existing installations need
   a migration that writes the grant onto their stored positions, gated per
   [docs/rules/migrations.md](https://github.com/thegspiro/the-logbook/blob/main/docs/rules/migrations.md#a-seeded-rank-grant-reaches-the-database-through-a-position).
3. Gate the endpoints with `require_permission(...)` and the frontend routes
   with `ProtectedRoute requiredPermission=...`.

For local development, `python -m app.core.seed` (from `backend/`) creates a
test organization and its default positions; real organizations are seeded by
onboarding.

ROLE_SYSTEM_README.md in the repository root is a short pointer to this page.
