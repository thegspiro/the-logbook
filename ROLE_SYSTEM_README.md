# Role-Based Access Control (RBAC) System

The full reference — default positions and their priorities, operational
ranks, the permission catalogue, the Role Management and member-administration
screens, the API, and how to add a permission — is the wiki page
[**Role System**](wiki/Role-System.md). This file is a short orientation and
does not repeat the catalogue, so there is one list to keep correct.

The source of truth for every permission and default grant is
[`backend/app/core/permissions.py`](backend/app/core/permissions.py):
`ALL_PERMISSIONS` (the registry), `DEFAULT_POSITIONS` (positions seeded at
onboarding) and `OPERATIONAL_RANKS` (rank default grants).

## In brief

- A member's effective permissions are the union of their **positions'**
  permissions and their **operational rank's** default permissions, computed by
  `_collect_user_permissions` in `backend/app/api/dependencies.py`. There are no
  deny rules.
- Permissions are `module.action` strings. `*` grants everything (the IT
  Manager position); `module.*` grants a whole module.
- Positions are what the API calls "roles": the endpoints are under
  `/api/v1/roles` and `/api/v1/users/{id}/roles`, and the management screen is
  `/settings/roles`. The permissions that govern them are `positions.view`,
  `positions.create`, `positions.edit`, `positions.update`, `positions.delete`
  and `positions.manage_permissions`; assigning positions to members is
  `members.assign_positions` or `users.update_positions`.
- `roles.*`, `members.assign_roles` and `users.update_roles` are the
  pre-rename names. They are not in the registry and cannot be granted from the
  Role Management screen, but the position and position-assignment endpoints
  (and `GET /api/v1/roles/admin-access/check`) still accept them as
  alternatives, so a position that still stores one keeps that access there.
- Changing a seeded grant needs a migration as well as a registry edit — see
  [docs/rules/migrations.md](docs/rules/migrations.md#a-seeded-rank-grant-reaches-the-database-through-a-position).
