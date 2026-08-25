# Security Review — Permissions & Roles

**Prefix:** `PERM` · **Iteration:** 02 · **Reviewed:** 2026-08-25 · **PR:** #TBD

**Backend:** `app/api/dependencies.py` (381 L), `app/core/permissions.py`
(1960 L), `app/api/v1/endpoints/roles.py` (691 L) +
`app/services/role_service.py` (785 L), `app/api/v1/endpoints/operational_ranks.py`
(193 L) + `app/services/operational_rank_service.py` (263 L),
`app/api/v1/endpoints/officers.py` (140 L) + `officer_service.py`,
`app/api/v1/endpoints/org_chart.py` (235 L) + `org_chart_service.py`
**Frontend:** none touched
**Migrations:** `20260824_2330_f2a91c7d6b04_add_org_chart_nodes.py`

---

## Scope

`roles.py`/`role_service.py`/`dependencies.py`/`core/permissions.py` carry an
extremely thorough privilege-escalation history: one module audit plus four
app-review passes (`docs/module-audit/orgs-roles-users.md`,
`docs/app-review/orgs-roles-users.md`), the most recent dated 2026-08-09, with
the ceiling machinery (`_enforce_permission_grant_ceiling`,
`_enforce_role_edit_ceiling`, `_enforce_rank_grant_ceiling`) re-verified
multiple times. This iteration spot-checked that machinery still exists as
described (it does, unchanged — confirmed via git log showing zero commits to
these three files since 2026-08-09) rather than re-deriving it.

`officers.py`, `org_chart.py`, and `operational_ranks.py` are new since that
last pass — added 2026-08-21 and 2026-08-24 respectively, confirmed by git log
— and carry no prior audit. These three were read in full and given full
weight against all seven checklist dimensions.

## Route inventory

**officers.py** (3 routes, all `require_permission("settings.manage",
"organization.update_settings")`, org-scoped via `current_user.organization_id`):
`GET /`, `PUT /{office_key}`, `DELETE /{office_key}`.

**org_chart.py** (5 routes):

| Method | Path               | Auth dependency      | Permission                             | Org-scoped | Notes                           |
| ------ | ------------------ | -------------------- | -------------------------------------- | ---------- | ------------------------------- |
| GET    | ``                 | `get_current_user`   | none (deliberate, docstring'd)         | yes        | published-only for non-managers |
| POST   | `/nodes`           | `require_permission` | `orgchart.manage` OR `settings.manage` | yes        | FK validated in-org             |
| PUT    | `/nodes/{id}`      | `require_permission` | same                                   | yes        | `_require_node` org-scopes      |
| POST   | `/nodes/{id}/move` | `require_permission` | same                                   | yes        | cycle + depth-cap guarded       |
| DELETE | `/nodes/{id}`      | `require_permission` | same                                   | yes        | reparents children, renumbers   |

**operational_ranks.py** (7 routes): `GET /`, `GET /validate`, `GET /{id}` are
auth-only (config-labels, low sensitivity by design — except `/validate`, see
PERM-1); `POST /`, `PATCH /{id}`, `DELETE /{id}`, `POST /reorder` all require
`settings.manage`.

## Verified good ✅

- **Ceiling machinery unchanged and intact.** `_enforce_permission_grant_ceiling`
  / `_enforce_role_edit_ceiling` (`roles.py:51,87`, call sites at 231/318/333/464)
  and `_enforce_rank_grant_ceiling` (`users.py:677,713`, wired at `create_member`
  and the rank-change branch of `update_user_profile`) are present exactly as
  the prior passes describe — zero commits touched `roles.py`, `role_service.py`,
  or `dependencies.py` since the 2026-08-09 pass (git log confirmed).
  `_collect_user_permissions` (`dependencies.py:52-69`) still unions position
  and operational-rank-default permissions verbatim.
- **officers.py — XC-1/XC-3 clean.** `set_officer` validates the client-supplied
  `user_id` belongs to the org before storing it (`officer_service.py:336-344`);
  `organization_officers.user_id` is `ondelete="SET NULL"` + `nullable=True`
  (Pitfall #2 compliant, `models/organization_officer.py:47-49`). JSON mutation
  uses `copy.deepcopy()` before reassigning `organization.settings`
  (`officer_service.py:315-317`) — Pitfall #12 compliant. The `settings.manage`
  / `organization.update_settings` OR-gate is not seeded to `member` or
  `firefighter`.
- **org_chart.py — XC-1/XC-3 clean, and DoS-hardened.** Every by-id fetch goes
  through `_get_node`/`_require_node`, which filters `organization_id`
  (`org_chart_service.py:53-69`); both client-supplied FKs (`parent_id`,
  `user_id`) are validated in-org via `assert_in_org` before create/update/move
  (`org_chart_service.py:159-181,262-264,299-302,333-340`). `orgchart.manage`
  is seeded only to the `fire_chief` rank and its mirroring position, not to
  `member`/`firefighter`. **Cycle prevention is real and layered**: `move_node`
  rejects `parent_id == node_id` and checks `_is_descendant` before
  re-parenting; `_is_descendant` treats a pre-existing loop as "is a
  descendant" (fails safe) rather than looping forever
  (`org_chart_service.py:341-346,419-437`); both `_depth_of` and the chart-walk
  cap at `MAX_DEPTH=8` with a `visited` set, so even a row written outside the
  service degrades rather than hanging a request
  (`org_chart_service.py:123-137,204-220`); `MAX_NODES=500` bounds tree size.
  Migration `f2a91c7d6b04` correctly guards its `positions`-table backfill on
  the table's existence (Pitfall #26) and all three new FKs are
  `ondelete="SET NULL"` + `nullable=True` (Pitfall #2). This surface already
  went through its own PR review (`cc58cfcf`, 2026-08-25) that fixed 5 issues
  before this pass — verified those fixes are present in the code read here
  (deleted-member filter, both-sides renumber on delete, required-but-nullable
  `parent_id` schema, and a move-audit trail).
- **operational_ranks.py — XC-3 clean, no XC-1 surface** (no FK besides
  `organization_id` itself). Confirmed the per-org `operational_ranks` DB table
  (labels + eligible positions, no permissions column) is a distinct concept
  from the static `OPERATIONAL_RANKS` catalog in `core/permissions.py` that
  `get_rank_default_permissions()` reads by `User.rank` string — CRUD here
  cannot be used to bypass the `_enforce_rank_grant_ceiling` machinery, since an
  unrecognized `rank_code` resolves to `[]` permissions.
- **No injection surface anywhere in the 6 files** — zero raw SQL, zero
  `.like()`/`.ilike()` (grep-confirmed), no CSV export.
- **No unbounded in-memory caches** (Pitfall #9 n/a — none of these 6 files
  define one).

## Findings

### PERM-1 — LOW — `GET /operational-ranks/validate` had no permission gate matching the screen it backs — ✅ FIXED

**What:** the route depended on `get_current_user` only, while its four CRUD
siblings in the same router (`POST`, `PATCH`, `DELETE`, `/reorder`) all require
`settings.manage`.

**Where:** `app/api/v1/endpoints/operational_ranks.py:92-107` (pre-fix).

**Failure scenario:** the only frontend caller is `SettingsPage`'s rank
section, and that page's route is gated `requiredPermission="settings.manage"`
(`frontend/src/modules/settings/routes.tsx:38`) — but that gate is
client-side only. Any authenticated member (any position, any rank) could call
`GET /operational-ranks/validate` directly and receive the name and current
(misconfigured) rank code of every active member whose rank doesn't match a
configured code for the org — a diagnostic/admin-facing list with no
`settings.manage` or `members.view` check enforced server-side.

**Impact:** LOW — the disclosed data is a member name plus a rank-code
mismatch flag (roster names are already broadly visible in this app per the
2026-08-04 ORU-8 PII-gate work), but it is still admin diagnostic tooling
leaking past its intended audience via a missing server-side check — exactly
the client-side-only gate pattern the checklist's dimension 2 flags.

**Fix:** changed the dependency to `require_permission("settings.manage")`,
matching its siblings and the frontend's actual (gated) usage. No legitimate
caller is affected — the only caller already requires that permission to reach
the page that calls it.

**Guard test:** `TestValidateRouteGate::test_validate_route_requires_settings_manage`
in `tests/test_operational_rank_service.py` — inspects the route's `Depends`
default and asserts `settings.manage` is in `required_permissions`, following
the existing pattern in `tests/test_read_permission_gates.py`.

### PERM-2 — LOW — `seed_defaults` had a narrow concurrent-first-load race that surfaced as an uncaught 500 — ✅ FIXED

**What:** `OperationalRankService.seed_defaults` checked `count == 0` then
inserted the 8 default ranks with no lock or exception handling around the
insert.

**Where:** `app/services/operational_rank_service.py:73-102` (pre-fix).

**Failure scenario:** two concurrent first-loads of a brand-new organization's
rank list (e.g., two admins opening Settings at once right after onboarding)
can both pass the `count == 0` check before either commits. The
`UniqueConstraint("organization_id", "rank_code")` prevents duplicate rows, but
the losing request's `flush()` then raised an unhandled `IntegrityError`,
surfacing to the caller as a generic 500 instead of the ranks simply loading
(which is what happens on every subsequent request once seeded). Not
exploitable for privilege gain — a narrow reliability defect, not a tenant- or
permission-boundary issue.

**Fix:** wrapped the flush in `try/except IntegrityError`, rolling back and
returning `[]` (the same return value as the already-existing
skip-when-ranks-exist branch) — the subsequent `list_ranks` call in the
endpoint then reads the winning request's rows normally.

**Guard test:**
`TestSeedDefaults::test_concurrent_first_seed_rolls_back_instead_of_500` —
forces `db.flush` to raise `IntegrityError` and asserts a rollback plus `[]`
return instead of the exception propagating.

## Schema & migration notes

`organization_officers.user_id` and all three new `org_chart_nodes` FKs
(`parent_id`, `user_id`, `updated_by`) are `ondelete="SET NULL"` +
`nullable=True` — Pitfall #2 compliant. `operational_ranks.organization_id` is
`ondelete="CASCADE"` + `nullable=False` — correct, CASCADE doesn't require
nullable. Migration `f2a91c7d6b04` guards its `positions`-table backfill and
its own `org_chart_nodes` creation on table existence — Pitfall #26 compliant.
No drift found between any of these 6 files' models and their migrations.

## Guard tests added

- `test_validate_route_requires_settings_manage` — fails if `GET /validate`
  ever loses its permission gate.
- `test_concurrent_first_seed_rolls_back_instead_of_500` — fails if the
  IntegrityError handling regresses.

## Completion gate

| Check                                                          | Result                                                                                                                  |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                  | ✅ 0 violations                                                                                                         |
| `black --check app/ tests/ alembic/`                           | ✅ unchanged                                                                                                            |
| `isort --check-only app/ tests/ alembic/`                      | ✅ clean                                                                                                                |
| `validate_migrations.py --strict`                              | ✅ single head                                                                                                          |
| backend tests (scoped: rank/permission/role/officer/org_chart) | ✅ 488 passed, 3 skipped (environment-only: py_vapid not installed, 2 schema tests needing tables outside this feature) |
| `tsc --noEmit`                                                 | ✅ 0 errors (no frontend files touched)                                                                                 |
| `eslint .`                                                     | n/a — no frontend files touched                                                                                         |
