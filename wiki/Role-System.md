# Role-Based Access Control (RBAC) System

> **Published copy — not the canonical source.** The maintained original is
> [`ROLE_SYSTEM_README.md`](https://github.com/thegspiro/the-logbook/blob/main/ROLE_SYSTEM_README.md)
> in the repository root, and this page may lag behind it. Make content changes
> there first, then mirror them here.

This document describes the comprehensive Role-Based Access Control system implemented in The Logbook.

## Overview

The RBAC system allows fine-grained control over what users can see and do within the platform. It includes:

- **Default System Roles**: Pre-configured roles for fire department leadership
- **Custom Roles**: Create organization-specific roles with custom permissions
- **Permission System**: Granular permissions organized by category
- **Member Administration**: Assign roles to members through an intuitive UI

## Default System Roles

The following roles are automatically created for each organization:

### Leadership Roles

1. **IT Administrator** (Priority: 100)
   - Full system access
   - All permissions enabled
   - Cannot be deleted

2. **Chief** (Priority: 95)
   - Full administrative access (equal authority to President)
   - Can manage all aspects except IT-specific tasks
   - Can create and manage roles
   - Can manage all modules including training, compliance, scheduling, inventory
   - Cannot be deleted

3. **President** (Priority: 95)
   - Full administrative access (equal authority to Chief)
   - Can manage all aspects except IT-specific tasks
   - Can create and manage roles
   - Can manage all modules including training, compliance, scheduling, inventory
   - Cannot be deleted

4. **Assistant Chief** (Priority: 90)
   - Broad administrative access
   - Can manage members and most modules
   - Cannot create roles
   - Cannot be deleted

5. **Vice President** (Priority: 80)
   - Similar to President but cannot edit organization settings
   - Cannot be deleted

6. **Secretary** (Priority: 75)
   - Record-keeping access
   - Can manage contact information visibility
   - Can manage meetings and compliance records
   - Cannot be deleted

7. **Assistant Secretary** (Priority: 70)
   - Assists the secretary
   - View-only for most areas
   - Can manage meetings
   - Cannot be deleted

8. **Member** (Priority: 10)
   - Basic member access
   - Can view members, training, compliance, schedules
   - Cannot modify most settings
   - Cannot be deleted

> **Role rename (2026-05-29):** The system position **"Membership Committee
> Chair"** was renamed to **"Membership Coordinator"** (slug
> `membership_committee_chair` → `membership_coordinator`). The rename is applied
> in place by migration `20260528_0001` via an `UPDATE` of the existing position
> row, so the UUID-keyed `user_positions` assignments are preserved. The
> permission set is unchanged — it still carries `prospective_members.manage`
> (view/upload/delete of prospect documents).

## Permission Categories

Permissions are organized into the following categories:

### Users & Members

- `users.view` - View user list
- `users.create` - Create new users
- `users.edit` - Edit user information
- `users.delete` - Delete users
- `users.view_contact` - View contact information
- `members.view` - View member list
- `members.manage` - Manage member profiles
- `members.assign_roles` - Assign roles to members

### Roles

- `roles.view` - View roles
- `roles.create` - Create new roles
- `roles.edit` - Edit roles
- `roles.delete` - Delete custom roles
- `roles.manage_permissions` - Manage role permissions

### Organization & Settings

- `organization.view` - View organization info
- `organization.edit` - Edit organization info
- `settings.view` - View settings
- `settings.edit` - Edit settings
- `settings.manage_contact_visibility` - Control contact info display
- `legal.propose` - View the public privacy notice / terms and propose revisions
- `legal.publish` - Publish a legal-document revision to the public pages

### Modules

Each module has view and manage permissions:

- Training (`training.view`, `training.manage`)
- Compliance (`compliance.view`, `compliance.manage`)
- Scheduling (`scheduling.view`, `scheduling.manage`)
- Inventory (`inventory.view`, `inventory.manage`)
- Meetings (`meetings.view`, `meetings.manage`)
- Elections (`elections.view`, `elections.manage`)
- Fundraising (`fundraising.view`, `fundraising.manage`)
- Audit (`audit.view`, `audit.export`)

### Grant movements on seeded positions _(2026-08-24 → 08-31)_

Six upgrade steps in this window **move grants on seeded (`is_system`)
positions**. A department's own customized positions are left alone. Nothing
revoked here is granted back automatically — re-grant it on a position that is
meant to carry it.

| Permission            | Movement                                                                             | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compliance.view`     | **Revoked** from the system **Member** position                                      | It reads as an innocuous view grant, but it is an accepted alternative on two officer-grade checks, including `GET /compliance-officer/contributed-hours`                                                                                                                                                                                                                                                                                                                                                                                           |
| `notifications.view`  | **Revoked** from the baseline member and junior-rank positions                       | It gates the department's notification rules. It also gated the Send Log, which was filtered on `organization_id` and nothing else; that endpoint now defaults to `scope=mine` and every member reaches their own send log without this grant                                                                                                                                                                                                                                                                                                       |
| `facilities.view`     | **Revoked** from regular members, then from the shared operational officer positions | The facilities workspace is leadership and facility managers. Line officers who used it will lose it                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `training.configure`  | **New**, granted to the positions that configure training                            | Grants the **member-disclosure policy only** — how much of an officer's written assessment the assessed member may read. `PUT /training-module/config` still returns 403 for any other field unless the caller also holds `training.manage`, so shift reports, the report form, apparatus mapping, the rating scale and the review workflow are **not** included. That policy was previously behind `training.manage`, which also carries the power to edit anybody's training records; a Membership Coordinator needs the first without the second |
| `users.view_consents` | **New**, granted to the Historian and PIO positions                                  | Accepted by the photo-use consent roster. Registry changes only reach organizations onboarded _after_ a deploy, so a migration covers the rows already stored                                                                                                                                                                                                                                                                                                                                                                                       |

**Separately:** `User.rank` is **cleared on every administrative member**. An
operational rank is a chain-of-command position and
`_collect_user_permissions` unions its default permissions into a member's
effective set, so an administrative member holding one held grants that role
was never meant to have. This does not reverse — nothing records which ranks
were cleared, so restoring them would also restore ranks an officer cleared
deliberately.

> **Changing a seeded grant needs a migration, not just a registry edit.**
> Onboarding copies the registry's permission list into a stored `positions`
> row, so an installation already past onboarding keeps whatever was copied on
> the day it ran. See Pitfall #23 in `CLAUDE.md`.

## Using the System

### Accessing Admin Pages

The following pages are automatically visible to users with admin roles:

- **Members Admin** (`/admin/members`)
  - Assign roles to members
  - View all members with their current roles
  - Accessible to: IT Admin, Chief, Assistant Chief, President, Vice President, Secretary, Assistant Secretary

- **Role Management** (`/admin/roles`)
  - Create custom roles
  - Edit role permissions
  - Delete custom roles (system roles cannot be deleted)
  - Accessible to: IT Admin, Chief, President (roles with `roles.create` permission)

### Creating Custom Roles

1. Navigate to **Role Management**
2. Click "Create Custom Role"
3. Fill in:
   - **Name**: Display name for the role
   - **Slug**: Unique identifier (lowercase, underscores)
   - **Description**: What this role is for
   - **Priority**: 0-100 (higher = more authority)
   - **Permissions**: Select from available permissions by category
4. Click "Create Role"

### Assigning Roles to Members

1. Navigate to **Members Admin**
2. Find the member in the list
3. Click "Manage Roles"
4. Check/uncheck roles to assign
5. Click "Save Changes"

**Note**: A user can have multiple roles. Their effective permissions are the union of all their roles' permissions.

### Editing System Roles

System roles (indicated by a blue "System Role" badge) have restrictions:

- **Name and priority cannot be changed**
- **Permissions can be modified** to suit your organization
- **Cannot be deleted**

This allows you to customize permissions while maintaining the core role structure.

## Backend API

### Endpoints

**Roles**:

- `GET /api/v1/roles` - List all roles
- `GET /api/v1/roles/{id}` - Get specific role
- `POST /api/v1/roles` - Create custom role
- `PATCH /api/v1/roles/{id}` - Update role
- `DELETE /api/v1/roles/{id}` - Delete custom role
- `GET /api/v1/roles/permissions` - List all permissions
- `GET /api/v1/roles/permissions/by-category` - Permissions grouped by category

**User Roles**:

- `GET /api/v1/users/with-roles` - List users with roles
- `GET /api/v1/users/{id}/roles` - Get user's roles
- `PUT /api/v1/users/{id}/roles` - Assign roles (replaces all)
- `POST /api/v1/users/{id}/roles/{role_id}` - Add single role
- `DELETE /api/v1/users/{id}/roles/{role_id}` - Remove single role

### Database Seeding

To seed the database with default roles:

```bash
cd backend
python -m app.core.seed
```

This will:

1. Create a test organization (if it doesn't exist)
2. Create all default system roles with proper permissions

## Permission Checking (Future Enhancement)

Once authentication is implemented, the system will enforce permissions using dependency injection:

```python
from app.api.dependencies import require_permission

@router.get("/admin/users")
async def admin_route(
    user: User = Depends(require_permission("users.manage"))
):
    # Only users with users.manage permission can access
    ...
```

## Best Practices

1. **Start with System Roles**: Assign system roles that closely match user responsibilities
2. **Create Custom Roles Sparingly**: Only create custom roles for unique organizational needs
3. **Use Priority Wisely**: Keep priority differences meaningful (e.g., 10-point increments)
4. **Document Custom Roles**: Add clear descriptions to custom roles
5. **Regular Audits**: Periodically review role assignments
6. **Principle of Least Privilege**: Give users only the permissions they need
7. **Keep a Second Administrator**: The system refuses any change that would
   leave the organization with no active member holding `members.manage` —
   status changes, archiving, deletion, position removal, and editing a
   position's permission list are all guarded. Recovering from that state
   needs direct database access, because every restore path is itself behind
   that permission. Departments should keep at least two people holding it so
   the guard never has to fire. _(2026-08-01)_

## Extending the System

### Adding New Permissions

1. Add permission constant in `backend/app/core/permissions.py`:

```python
MY_NEW_PERMISSION = Permission(
    "module.action",
    "Description of what this allows",
    PermissionCategory.MODULE
)
```

2. Add to `ALL_PERMISSIONS` list

3. Optionally add to default roles in `DEFAULT_ROLES`

### Adding New Modules

When adding new modules:

1. Create view and manage permissions
2. Add to permission categories
3. Update default roles to include appropriate permissions
4. Update frontend to check permissions before showing module UI

## Technical Architecture

- **Backend**: Python/FastAPI with SQLAlchemy
- **Database**: MySQL 8.0+ with JSON columns for flexible permission storage
- **Frontend**: React/TypeScript with Tailwind CSS
- **Permission Model**: Role-based with additive permissions (union of all assigned roles)

## Future Enhancements

- [ ] Permission groups (collections of related permissions)
- [ ] Temporary role assignments with expiration
- [ ] Role assignment audit trail
- [ ] Bulk role assignment
- [ ] Permission delegation (users granting temporary permissions)
- [ ] Role templates for quick setup

## Directory versus scanner access (August 14, 2026)

`members.view` grants the redacted member directory/profile. The ID-card scanner
is an elevated lookup and requires either `users.view` or `members.manage`.
Navigation and direct-route protection use the same OR rule; granting only
`members.view` must not surface the scanner.

## Permission movements, August 31 – September 6, 2026

Eleven migrations moved grants on **seeded** positions in this window. They are
not eleven independent decisions — nine of them trace to one root cause.

### The root cause: the onboarding wizard overwrote the registry

The old onboarding position editor did not read `DEFAULT_POSITIONS`. It derived
its two-checkbox-per-module defaults from a heuristic — _"a member views every
module whose category is not System"_, _"a leader manages everything but
settings"_ — and **its first Continue saved that output over the seeded rows
wholesale.**

Because `dependencies.py` unions every assigned position's stored permissions,
the heuristic's answer became **live grants** on every department that
onboarded under that code. This is CLAUDE.md pitfall #23 in its most expensive
form: the registry said one thing and the database said another, and the
database wins.

That is why a rank-and-file member could open Administration → Reports. The
registry seeds `reports.view` to no rank-and-file position, but Reports is its
own module category, so the heuristic ticked it — and holding it also opened
the Administration section itself.

**Four migrations chased this before one worked.** The first three repaired
only a row matching the heuristic's output _in full_, and four other migrations
edit those same rows first — so a department that onboarded early was a
permission or two off, its row was skipped, and every discrepancy survived. The
working one removes and restores **one permission at a time**, which does not
depend on the rest of the row.

**New departments no longer create the problem.** Setting up a position now
starts from the registry on both the create and the update path, and EMT —
which the wizard offered to every agency type with nothing seeded behind it —
is registered alongside Firefighter and Engineer.

### Revocations

| Revision       | Grant                                                                                                                                                                                                                                                                                     | Off which positions                                                                                       | Why                                                                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `c9a5e21f7b04` | `reports.view`                                                                                                                                                                                                                                                                            | Baseline member, Firefighter                                                                              | Opens the report catalog, generation and every saved report — all of which **aggregate across the whole department** rather than scoping to the holder  |
| `f3b8d0c26a17` | `integrations.view`, `medical_supplies.view`, `mobile.view`, `prospective_members.view` (and their `.manage` / module-wildcard forms); Engineer also loses `positions.view`, `reports.view`, `settings.view`, and its `apparatus.*` narrows to `apparatus.view` + `apparatus.maintenance` | Member, Firefighter, Engineer, EMT                                                                        | The wizard's over-grants, removed **unconditionally** — see the warning below                                                                           |
| `b6e4a0d17c93` | `apparatus.view`                                                                                                                                                                                                                                                                          | Seeded rank-and-file                                                                                      | The apparatus pages are a maintenance and compliance workspace — inspection expirations, out-of-service status, deficiency flags, driver qualifications |
| `d5f2b8c04a19` | `apparatus.view`                                                                                                                                                                                                                                                                          | The membership positions `c3d4e5f6a7b8` kept (Probationary, Junior, Life, Administrative, Social, Exempt) | Rows a department accumulated under the old role setup, missed by the revision above                                                                    |
| `a2e9f6b04c71` | The heuristic's over-grants                                                                                                                                                                                                                                                               | Every seeded EMT row                                                                                      | Until the registry gained an `emt` entry, `save_session_roles` took its **create** branch and stored the checkbox expansion verbatim                    |
| `9d2b4492faba` | Skills-testing viewer grants naming a test's own examiner                                                                                                                                                                                                                                 | —                                                                                                         | The examiner already holds full disclosure on their own scoring, so the grant was a no-op the officer could not tell had done nothing                   |

> **⚠️ `f3b8d0c26a17` revokes unconditionally, including where a department
> granted deliberately.** The earlier attempts gated on a "wizard fingerprint"
> — the row still carrying one of `integrations.view`, `medical_supplies.view`,
> `mobile.view` or `prospective_members.view` — so a deliberate grant would
> survive. **That gate missed every department that had switched those modules
> off during setup**, leaving the original problem in place for exactly the
> smaller departments least likely to notice.
>
> Nothing in a stored row distinguishes a grant the heuristic wrote from one an
> administrator chose, and a built-in position stays marked built-in after an
> administrator edits it. Because these grants expose other members' aggregated
> hours, training and roster data, they are removed wherever they are found.
> **A department that deliberately gave its members Reports must grant it again
> on the positions screen.** A position the department created itself is not
> touched at all.

### Restores

| Revision                                    | Grant                                                                     | Onto                      | Gate                                                                                                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `b4d1c8e37f52`, broadened by `c7a4e91d3b68` | `locations.view`, `meetings.view`, `organization.view`, `scheduling.swap` | Seeded EMT rows           | Only where the row holds **none of the four** — no checkbox in any version of the setup screen can produce them, so their absence is the mark of a row the screen built. A department that removed some keeps that choice |
| `f7b3c8d2e569`, `d1c7f4a92e63`              | The registry's seeded grants                                              | Rows the wizard overwrote | Superseded in part by `f3b8d0c26a17`; retained because a department already past them would never execute a rewritten version                                                                                             |
| `e8a1c04f6b27`                              | `inventory.check_submit`                                                  | Default Member position   | One of three repairs that had silently never run — those members had **lost the checklist on upgrade**                                                                                                                    |

**Restores are gated; revocations are not.** That asymmetry follows pitfall
#23: an unconditional _add_ would override a department that removed a grant on
purpose, and a missing benign grant discloses nothing — whereas leaving a
disclosing grant in place on an unrecognized row keeps the disclosure open.

`c7a4e91d3b68` is worth reading as a worked example of the other half of that
pitfall. `b4d1c8e37f52` identified a row by comparing its **whole** permission
list against a frozen snapshot of the editor's output — the strategy pitfall
#23 bans by name — and it failed exactly as predicted, because the snapshot is
pinned to one build's module list. It was **superseded by a child revision
rather than edited**, since an installation that already stamped the narrow
version would never execute a rewritten body.

### Renamed: `equipment_check.*` → `inventory.check_*`

Equipment checklists moved from Scheduling to Inventory on 2026-08-31, and the
permission strings moved with them (`ff8076f4987a`). Every position keeps
exactly the authority it had — the migration rewrites the stored grants, and
the old names keep working for any row it cannot reach.

> **⚠️ One consequence to check: a position holding `inventory.*` now grants
> the three checklist permissions.** A module wildcard covers everything in its
> module, and these are now in Inventory. **No seeded position or rank grants
> `inventory.*`**, so this reaches only positions a department built for itself
> — typically a quartermaster, who can now author and submit equipment
> checklists. The behaviour is deliberate (a checklist is a list of inventory
> items) and is pinned by a test. If it is wider than intended, replace the
> wildcard with the specific `inventory.` grants you want.

### New permission

| Permission              | Held by default | Gates                                           |
| ----------------------- | --------------- | ----------------------------------------------- |
| `integrations.mcp_keys` | IT Manager only | Issuing and revoking the Claude MCP service key |

### Narrowed endpoint

`GET /scheduling/eligibility/roster` accepted `training.view_all` /
`training.manage` as well as the scheduling grants. It now requires
**`scheduling.manage`**, matching the page above it. Narrowing only the page
would have revoked nothing: a client gate is not a gate, and a training officer
refused by the screen could still pull the whole roster — member eligibility
and EVOC standing — straight from the API. The endpoint's documented permission
was also wrong, claiming `scheduling.view`, which it never accepted.
