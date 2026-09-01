# Security Review — Permissions & Roles

**Prefix:** `PERM` · **Iteration:** 02 · **Reviewed:** 2026-08-25 (pass 1), 2026-08-27 (pass 2), 2026-09-01 (pass 3) · **PR:** #1805 (pass 1)

---

## Pass 3 (2026-09-01) — re-verified, no new findings

**Scope of this pass.** `git log --since=2026-08-27` (pass 2's merge date) against
all six feature files (`dependencies.py`, `core/permissions.py`, `roles.py`,
`role_service.py`, `operational_ranks.py`, `operational_rank_service.py`,
`officers.py`, `officer_service.py`, `org_chart.py`, `org_chart_service.py`)
shows exactly three commits touched any of them since pass 2 merged
(PR #1931): `cf033864` (permission rename), `9f6e7a7a` (member display-name
update), and `a518957e` (module-gate exception handling, landed the same day
as pass 2 as a Codex follow-up on PR #1948). `officers.py`, `officer_service.py`,
`org_chart.py`, `org_chart_service.py`, `operational_ranks.py`, and
`operational_rank_service.py` are **byte-identical to pass 2** — zero commits,
confirmed via git log — so pass 2's "Verified good" write-up for those four
files stands without re-derivation, per this rotation's own rule not to
re-read what a prior pass already settled.

All three changed commits reviewed in full against the checklist:

- **`cf033864` — rename `equipment_check.*` → `inventory.check_*`.**
  Authority-preserving: `LEGACY_PERMISSION_ALIASES` is additive (old string
  stays in the granted set, so a raw-grants report still shows what's
  actually stored) and is expanded at the one choke point every permission
  check funnels through (`_collect_user_permissions` in `dependencies.py`,
  which `permission_matches` also expands defensively — redundant but
  harmless, since expansion is idempotent). The accompanying migration
  (`ff8076f4987a`) rewrites **every** `positions.permissions` row, system and
  custom alike — correctly not scoped to `is_system=1`, since a _rename_
  (unlike a grant removal) would otherwise silently drop a grant a
  department deliberately gave itself (Pitfall #23's removal-scoping rule
  doesn't apply to a pure rename). Guarded on `positions` existing per
  Pitfall #26, and confirmed as a defensive-only guard since `positions` is
  created by the migration chain (rename ancestor `20260805_0008`), matching
  the corrected understanding in Pitfall #26 itself. No permission gained or
  lost by any rank or position — verified by diffing every `OPERATIONAL_RANKS`
  / `DEFAULT_POSITIONS` entry touched: each `EQUIPMENT_CHECK_*` reference was
  replaced 1:1 (or the wildcard 1:3) with its `INVENTORY_CHECK_*` equivalent,
  nothing added or dropped.
- **`9f6e7a7a` — allow the `member` position's display name to be edited.**
  Scoped correctly: `role_service.update_role` raises `ValueError` for any
  system position other than the `member` slug (`role.slug != "member"`),
  the slug itself is never written, and the existing permission-ceiling
  checks (`_enforce_permission_grant_ceiling` / `_enforce_role_edit_ceiling`)
  are untouched by this diff and still run unconditionally on a permissions
  change. A name-only update does not touch permissions at all, so the
  ceiling functions are irrelevant to this diff and correctly not invoked
  for that case. Org-scoped via the existing `get_role(role_id,
organization_id)` lookup. Guard tests
  (`test_member_system_position_display_name_can_change`,
  `test_other_system_position_name_update_is_rejected`) cover both the
  allowed and rejected paths.
- **`a518957e` — `get_request_enabled_modules` catches an invalid-credential
  `HTTPException` instead of letting it propagate.** Re-verified this
  doesn't weaken authentication: the function only resolves whether a
  _module_ is enabled for gating purposes, never whether the caller is
  authenticated — any endpoint requiring a real session still declares its
  own independent `Depends(get_current_user)`, unaffected by this catch.
  Confirmed by grep that `get_request_enabled_modules` is never itself used
  as an auth dependency anywhere (`require_module` only reads the resolved
  module set, not identity). The one behavior change — a caller with a
  stale/invalid session cookie who hits a token-authorized public route
  (e.g. an emailed ballot link) is now treated as anonymous for the
  module-gate check instead of getting an unrelated 401 — matches the
  scenario the commit documents (already reviewed once as a Codex follow-up
  on PR #1948; re-confirmed here since it touches a PERM-02 file).

**Re-verified still present:** the ceiling machinery
(`_enforce_permission_grant_ceiling`, `_enforce_role_edit_ceiling` in
`roles.py`; `_enforce_rank_grant_ceiling` in `users.py`, wired at
`create_member`, `update_user_profile`'s rank-change branch, and — per
PERM-3/PERM-4 above — `transfer_prospect` and `update_rank`), PERM-1's
`settings.manage` gate on `GET /operational-ranks/validate`, and PERM-2's
savepoint-based `seed_defaults` race fix. All four `roles.py` route additions
since pass 1 (`/permissions`, `/permissions/by-category`, admin-access/check,
etc.) re-enumerated: 13 routes total, every by-id fetch org-scoped via
`get_role(role_id, organization_id)`, and the two routes that call
`role_service.get_user_roles`/`get_user_permissions` with a _different_
user's id (`GET /user/{user_id}/permissions`) resolve that id through an
explicit org-scoped existence check first — the two service methods
themselves take no `organization_id` parameter, which is correct only
because every call site already validated the id in-org (confirmed via grep
of every call site: the other five call `get_user_roles`/`get_user_permissions`
with `current_user.id`, which is trivially self-scoped).

**No new findings.** Nothing in this pass's checklist coverage — the three
changed commits, plus the four unchanged files' pass-2 conclusions — surfaced
an authentication, authorization, tenant-isolation, injection, exposure,
abuse-resistance, or schema/migration defect.

**Completion gate:** no backend or frontend source file was modified this
pass (documentation only), so the code-level gates (flake8/black/isort,
pytest, tsc, eslint) have nothing new to validate — the baseline they'd
check was already confirmed green by PR #2133 (feature 01, merged
immediately prior) and this pass introduced no further code changes.
`python3 scripts/validate_migrations.py --strict` re-run for the schema
dimension: single head, no changes.

---

## Pass 2 (2026-08-27)

Unlike feature 01, this feature's files grew substantially since pass 1
(`git diff 33f8f8ec HEAD`, the PR #1805 merge commit): `dependencies.py` +108
net, `core/permissions.py` +240 net, `role_service.py` +270 net,
`operational_rank_service.py` +271 net, `org_chart_service.py` +450 net,
`roles.py` +50, `org_chart.py` +21, `operational_ranks.py` +3.
`officers.py`/`officer_service.py` are unchanged. Three parallel background
agents reviewed org_chart, roles/role_service, and operational_ranks against
the full diff and current file content; I reviewed `dependencies.py` and the
`core/permissions.py` registry churn directly.

### Verified good ✅ (new since pass 1)

- **`dependencies.py`'s new per-request auth/module-enablement caching**
  (`request.state.authenticated_user`, `get_request_enabled_modules`) —
  the auth cache is populated only after every rejection check in
  `get_current_user` passes, so a second resolution within the same request
  can only replay an already-granted result, never short-circuit a refusal
  into an approval. `require_module`'s pass-through for a sessionless caller
  is deliberately scoped to `get_optional_current_user`, which itself still
  fails closed on a present-but-invalid credential (delegates to the
  mandatory `get_current_user`) — only a genuinely absent credential
  resolves to `None`. Confirmed the one place this matters in practice
  (`salesforce_sync.router`'s public OAuth callback, gated by
  `module_gate("integrations", ...)`) is exactly the case the function's
  own docstring names.
- **New `EMT` rank and `_LINE_MEMBER_PERMISSIONS` extraction** — a real bug
  fix (EMT-only members previously resolved to zero default permissions,
  per the code comment referencing #1833) rather than a new gap: rank
  defaults are computed at request time by `get_rank_default_permissions()`,
  never persisted, so there is no Pitfall #23 staleness to backfill — unlike
  `firefighter`, `emt` has no mirroring `DEFAULT_POSITIONS` entry, confirmed
  by grep.
- **New `training.configure` permission**, added to several officer ranks'
  `default_permissions` and to matching `DEFAULT_POSITIONS` entries — the
  migration `20260825_1400_e3b7c25f9a41_grant_training_configure.py`
  backfills exactly the seeded rows Pitfall #23 requires, and goes further:
  it only re-grants a position that still holds the permission
  (`training.manage`) it's mirroring, so a department that already
  deliberately stripped `training.manage` from a customized position isn't
  silently re-granted the sibling capability.
- **`org_chart_service.py`'s multi-holder rework** (new `position_id`/
  `rank_code`/`holders[]` on a node) — every new client-supplied reference
  is validated in-org before persisting (`assert_in_org` for `position_id`/
  holder `user_id`, an explicit org-scoped query for `rank_code`), every new
  read path re-derives holder identity through an org-filtered query, and
  the new `MAX_HOLDERS_PER_NODE = 25` is enforced in both the schema and the
  service. New FK `position_id` is `SET NULL` + `nullable=True`. No findings.
- **`role_service.py`'s transactional-audit rework** — the ceiling
  machinery (`_enforce_permission_grant_ceiling`, `_enforce_role_edit_ceiling`)
  is byte-for-byte unchanged; the diff only makes an audit-write failure roll
  back its role mutation instead of leaving them inconsistent. One
  LOW/informational note: `set_user_roles`/`assign_role_to_user` enforce only
  the administrator-retention guard, not the grant ceiling — inert today
  (confirmed via grep: no endpoint calls either), a trap only if a future
  bulk-assignment endpoint calls them directly without its own ceiling check.

### Findings

### PERM-3 — HIGH — Prospect-to-member transfer could mint an admin via a client-supplied rank — ✅ FIXED

**What:** `POST /prospects/{id}/transfer` creates a full `User` account
(active, password set) with a client-supplied `rank`, validated only for
"is this rank configured" (`OperationalRankService.resolve_rank_code`), never
for whether the caller's own permissions cover what that rank grants.
`_enforce_rank_grant_ceiling` exists specifically to close this class —
its own docstring names the exact scenario — but was never wired into this
path.

**Where:** `backend/app/api/v1/endpoints/membership_pipeline.py`
(`transfer_prospect`, pre-fix); `backend/app/services/membership_pipeline_service.py`
(`_do_transfer`).

**Failure scenario:** the endpoint is gated on `members.manage` OR
`prospective_members.manage` — neither implies `settings.manage` or
`security.manage`. A caller holding only one of those two (e.g. a Membership
Coordinator position) transfers a prospect in with `rank="fire_chief"` in the
request body. `resolve_rank_code` confirms `fire_chief` is a configured rank
and lets it through; the new `User` row is created with that rank and a
generated password, live immediately. `get_rank_default_permissions()`
resolves rank grants purely by code string at request time, so the new
account — or the caller's own account, if they transfer themselves in as a
"prospect" — now carries `security.manage`, `users.delete`, and every other
`fire_chief` default, gained through a parallel, previously-unguarded
permission source. Exactly the escalation `_enforce_rank_grant_ceiling`'s
docstring on `users.py` describes for `create_member`, reachable through a
second, un-audited door.

**Impact:** HIGH — full tenant-admin-equivalent privilege escalation from a
comparatively low, plausibly-held permission pair, requiring only a form
submission (no code execution, no existing admin cooperation).

**Fix:** `transfer_prospect` now resolves the canonical rank and enforces
`_enforce_rank_grant_ceiling` (the same helper `create_member` and
`update_user_profile` already use) before calling the service — no
duplicated ceiling logic, one owner. The already-canonicalized rank is
passed through to the service so its own redundant resolution is a no-op.

**Guard test:** `test_transfer_prospect_calls_rank_ceiling` in
`test_privilege_ceiling_wiring.py` — source-inspects `transfer_prospect`,
asserting the ceiling call is present and appears before
`service.transfer_to_membership(...)` in source order. Verified to fail
against the pre-fix endpoint.

**Correction (Codex review on PR #1931):** the fix above still let a caller
generate a **committed CRITICAL privilege-escalation alert**
(`report_privilege_escalation_attempt` inside `_enforce_rank_grant_ceiling`
commits on denial) for a prospect id that could never have been transferred
regardless of rank — nonexistent, wrong-org, or already
`ProspectStatus.TRANSFERRED` — since the ceiling check ran before the service
resolved and validated the prospect. Not a privilege-escalation gap (the
escalation itself was still correctly blocked), but real alert-noise: a
caller could spam garbage prospect ids alongside `rank="fire_chief"` to
generate CRITICAL alerts for requests that could never succeed, degrading
the signal value of that monitoring channel. Fixed by resolving the prospect
via `service.get_prospect(...)` and checking existence + transferred-status
**before** the ceiling check — same 404/400 responses the service would
eventually have produced, just returned before the alert-generating check
runs. Guard test:
`test_transfer_unknown_prospect_does_not_report_privilege_escalation` in
`test_prospect_create_privacy.py` — patches `_enforce_rank_grant_ceiling` to
raise if called, asserts a 404 for a `get_prospect() -> None` case. Verified
to fail against the pre-correction ordering.

### PERM-4 — HIGH — Renaming a rank's code could escalate every member currently holding it — ✅ FIXED

**What:** `OperationalRankService.update_rank` bulk-rewrites
`User.rank` for every member currently holding the rank's old code when the
`rank_code` field is changed (`update(User).where(User.rank == old_rank_code)
.values(rank=new_rank_code)`), with no check on what permissions the new code
grants versus the caller's own. The endpoint requires only `settings.manage`.

**Where:** `backend/app/services/operational_rank_service.py:322-329`
(pre-fix, unchanged this pass); `backend/app/api/v1/endpoints/operational_ranks.py`
(`update_rank`, pre-fix).

**Failure scenario:** a caller holding `settings.manage` but not
`security.manage` renames any rank currently held by one or more members
(including, if applicable, themselves) — e.g. a low-privilege "Probationary"
rank — to the reserved code `fire_chief`. `get_rank_default_permissions()`
resolves by code string with no notion of "this row was renamed rather than
created", so every member who held the old code instantly carries every
`fire_chief` default permission the next time their permissions are computed.
Same underlying threat model as `_enforce_rank_grant_ceiling` protects
against, reached through a rename instead of a direct grant.

**Impact:** HIGH — same class as PERM-3, and here it retroactively escalates
every existing holder of the renamed code at once, not just one new account.

**Fix:** the endpoint now fetches the existing rank, and — only when
`rank_code` is actually changing — calls `_enforce_rank_grant_ceiling` with
the new code before invoking `service.update_rank`. A rename to an
unrecognized/custom code (the common case — most departments' ranks aren't
reserved words) resolves to `get_rank_default_permissions() == []` and
passes trivially, so this does not block ordinary rank renames.

**Guard test:** `test_update_rank_calls_rank_ceiling_before_renaming` in
`test_privilege_ceiling_wiring.py` — source-inspects `update_rank`, asserting
the ceiling call precedes `service.update_rank(...)`. Verified to fail
against the pre-fix endpoint. The existing
`test_update_endpoint_returns_renamed_rank_after_member_migration` (renaming
to a non-reserved code) continues to pass unmodified in behavior, confirming
the fix doesn't block legitimate renames — it needed only a mock-sequencing
update for the endpoint's one added `get_rank` lookup.

**Completion gate (pass 2, after the Codex correction):** flake8/black/isort
clean on `app/ tests/ alembic/`; `validate_migrations.py --strict` passed
(381 revisions, single head); scoped tests (`-k "rank or permission or role
or membership_pipeline or transfer or org_chart or officer or prospect"`)
946 passed, 2 skipped (pre-existing); full backend suite 9039 passed, 22
skipped (pre-existing), 0 failed (pre-correction baseline — the correction
itself is covered by the scoped run above). No frontend files touched.

---

## Pass 1 (2026-08-25)

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

**Fix (revised after review):** the losing insert now runs inside a SAVEPOINT
(`async with self.db.begin_nested():`), and only that savepoint is rolled back
on `IntegrityError`, returning `[]` (the same value as the existing
skip-when-ranks-exist branch). **The first version of this fix called a plain
`self.db.rollback()`, which was itself a regression** — caught by an automated
Codex review comment on the PR before merge. Verified empirically against a
real MariaDB connection (not just by reasoning about it): a full-session
`rollback()` expires every object in the request's identity map
(`SessionTransaction._restore_snapshot(dirty_only=False)` in SQLAlchemy's
source), including `current_user`, loaded earlier by `get_current_user` on the
same request-scoped session. The endpoint's next access to
`current_user.organization_id` (to call `list_ranks` right after
`seed_defaults` returns) would then need an implicit refresh outside the async
greenlet context and raise `MissingGreenlet` — reproduced directly against a
real DB connection: the plain-rollback path raised
`MissingGreenlet("greenlet_spawn has not been called...")` on the next
attribute access, while the savepoint path did not. This is the same bug class
as the `reopen_event_attendance` 500 (CHANGELOG 2026-08-25) — a lazy
attribute/relationship load outside the greenlet context. A SAVEPOINT rollback
only expires objects modified within it (`dirty_only=True` in the same
SQLAlchemy method), leaving `current_user` untouched.

**Guard tests:**
`TestSeedDefaults::test_concurrent_first_seed_rolls_back_instead_of_500` —
forces `db.flush` to raise `IntegrityError` and asserts `[]` instead of the
exception propagating.
`TestSeedDefaults::test_concurrent_first_seed_uses_savepoint_not_full_rollback`
— asserts `begin_nested()` was used and the full-session `rollback()` was
**not** called, so a regression back to the plain-rollback form fails this
test even though the mock-level behavior of the first test alone couldn't
distinguish the two (mocks don't model SQLAlchemy's real expiration
semantics — this is why the fix was verified against a real DB connection
before being written up here, not just left to the mocked test suite).

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
| backend tests (scoped: rank/permission/role/officer/org_chart) | ✅ 489 passed, 3 skipped (environment-only: py_vapid not installed, 2 schema tests needing tables outside this feature) |
| `tsc --noEmit`                                                 | ✅ 0 errors (no frontend files touched)                                                                                 |
| `eslint .`                                                     | n/a — no frontend files touched                                                                                         |
