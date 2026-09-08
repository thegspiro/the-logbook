# Security Review — Permissions & Roles

**Prefix:** `PERM` · **Iteration:** 02 · **Reviewed:** 2026-08-25 (pass 1), 2026-08-27 (pass 2), 2026-09-01 (pass 3), 2026-09-08 (pass 4) · **PR:** #1805 (pass 1), #2136 (pass 3), #PENDING (pass 4)

Passes are recorded in this one file rather than a new `PERM<n>-02-*.md` per
lap, matching what passes 2 and 3 already did here. Newest pass first.

---

## Pass 4 (2026-09-08)

**Backend:** `app/api/dependencies.py` (537 L), `app/core/permissions.py`
(2353 L), `app/api/v1/endpoints/roles.py` (679 L, **13 routes**) +
`app/services/role_service.py` (943 L),
`app/api/v1/endpoints/operational_ranks.py` (214 L, **7 routes**) +
`app/services/operational_rank_service.py` (512 L),
`app/api/v1/endpoints/officers.py` (140 L, **3 routes**) +
`app/services/officer_service.py` (391 L),
`app/api/v1/endpoints/org_chart.py` (240 L, **5 routes**) +
`app/services/org_chart_service.py` (844 L). Also read, because this feature's
invariants are enforced there and nowhere else:
`app/services/admin_continuity_service.py` (216 L) and the six
position/rank-assignment handlers in `app/api/v1/endpoints/users.py`.
**Frontend:** `components/ProtectedRoute.tsx`, `stores/authStore.ts`'s
`checkPermission`, `utils/apiCache.ts`, `utils/createApiClient.ts` — read, not
modified.
**Migrations:** none written this pass; 438 revisions, single head
`1603bd9c59e7`.

### Scope

**The diff range is real this time and is stated as such.** Pass 3 established
that a date cutoff is the wrong query and that
`git log <prior-pass-merge-sha>..HEAD` is the right one; the repository this
session started from was a shallow clone whose history began after pass 3, so
the range could not be computed until the clone was deepened
(`git fetch --deepen=1500`, 9 359 commits). Pass 3's merge is
`074f6a79` (PR #2136, 2026-09-01), and
`git diff 074f6a79..HEAD -- <the ten feature files>` reports **three** files
changed and seven unchanged:

| File                       |  Δ  | Commits                                                                        |
| -------------------------- | :-: | ------------------------------------------------------------------------------ |
| `core/permissions.py`      | +89 | `bfe7c038`, `54e60202`, `7ff18d0c`, `f8ea3f66`, `ceb36a36`, `b311154f`         |
| `services/role_service.py` | +41 | `a9063055`                                                                     |
| `api/dependencies.py`      | +14 | `8fac5ed4` (feature 01's pass-4 AUTH-14 fix, reviewed there)                   |
| the other seven            |  0  | byte-identical to pass 3, whose verdicts therefore stand without re-derivation |

Despite that, **all ten files plus the four routers were read in full this
pass**, not diffed — the escalation questions this iteration is asked (can a
caller grant, or take, authority they do not hold?) are answered by the
interaction between files, not by any one diff, and PERM-5 below is a defect
that has been there since long before pass 3 and that three passes of
diff-scoped reading did not reach.

**Not read:** `users.py` outside its position/rank-assignment handlers and the
three ceiling helpers (that is feature 07); `app/mcp/*` and
`endpoints/mcp_keys.py` beyond confirming what the new
`integrations.mcp_keys` permission gates (feature 27);
`onboarding.py`'s `save_session_roles` (feature 30).

### Route inventory

28 routes across the four routers this feature owns. Every one carries an auth
dependency; the machine check behind that claim is
`tests/test_endpoint_auth_coverage.py`, which lists 24 unauthenticated
handlers under `app/api/v1/endpoints/` and none of them is in this feature.

**`roles.py` — 13 routes.** Every by-id fetch goes through
`role_service.get_role(role_id, organization_id)`, which filters both columns.

| Method | Path                          | Permission                                                              | Org-scoped | Notes                                                       |
| ------ | ----------------------------- | ----------------------------------------------------------------------- | ---------- | ----------------------------------------------------------- |
| GET    | `/permissions`                | authenticated only                                                      | n/a        | static catalog; no org or member data                       |
| GET    | `/permissions/by-category`    | authenticated only                                                      | n/a        | same catalog, grouped                                       |
| GET    | ``                            | `positions.view` OR `roles.view`                                        | org        | `list_roles(organization_id=…)`                             |
| POST   | ``                            | `positions.create` OR `positions.manage_permissions` OR `roles.create`  | org        | `_enforce_permission_grant_ceiling` before the service call |
| GET    | `/{role_id}`                  | `positions.view` OR `roles.view`                                        | org        | `get_role(id, org)`                                         |
| PATCH  | `/{role_id}`                  | `positions.edit`/`update`/`manage_permissions` OR `roles.edit`/`update` | org        | grant ceiling **and** `_enforce_role_edit_ceiling` (ORU-7)  |
| DELETE | `/{role_id}`                  | `positions.delete` OR `positions.manage_permissions` OR `roles.delete`  | org        | refuses `is_system`; last-admin guard in the service        |
| POST   | `/{role_id}/clone`            | `positions.create` OR `positions.manage_permissions` OR `roles.create`  | org        | ceiling runs against the **source** role's permissions      |
| GET    | `/{role_id}/users`            | `positions.view` OR `roles.view` OR `users.view`                        | org        | role resolved in-org, then `get_users_with_role(id, org)`   |
| GET    | `/user/{user_id}/permissions` | `users.view` OR `positions.view` OR `roles.view`                        | org        | target user resolved in-org **before** the unscoped lookups |
| GET    | `/my/roles`                   | authenticated only                                                      | self       | `current_user.id`                                           |
| GET    | `/my/permissions`             | authenticated only                                                      | self       | `current_user.id`                                           |
| GET    | `/admin-access/check`         | authenticated only                                                      | self       | reports the caller's own admin status                       |

The nine unregistered strings in that column (`roles.view`, `roles.create`,
`roles.edit`, `roles.update`, `roles.delete`) are the pre-rename names. None
of them is in `get_all_permissions()`, so no position can be created holding
one, and each is OR'd with a registered equivalent —
`tests/test_require_permission_registry.py` asserts exactly that, in both
directions. Re-derived here rather than trusted: an AST-ish sweep of every
`require_permission` / `require_all_permissions` call in `app/api/` found 15
unregistered strings in total, all of them from this legacy set, and **zero**
`require_all_permissions` calls with an unresolvable member (which would be
the fail-closed twin the registry test's `any()` cannot see).

**`operational_ranks.py` — 7 routes.**

| Method | Path         | Permission         | Org-scoped | Notes                                                          |
| ------ | ------------ | ------------------ | ---------- | -------------------------------------------------------------- |
| GET    | ``           | authenticated only | org        | seeds defaults on first load (PERM-2's savepoint)              |
| POST   | ``           | `settings.manage`  | org        | duplicate `rank_code` refused per org                          |
| GET    | `/validate`  | `settings.manage`  | org        | PERM-1's fix, still in place                                   |
| GET    | `/{rank_id}` | authenticated only | org        | `get_rank(id, org)`                                            |
| PATCH  | `/{rank_id}` | `settings.manage`  | org        | `_enforce_rank_grant_ceiling` on a `rank_code` change (PERM-4) |
| DELETE | `/{rank_id}` | `settings.manage`  | org        | refuses while any member (incl. archived) holds the code       |
| POST   | `/reorder`   | `settings.manage`  | org        | each item resolved by `get_rank(id, org)` — see PERM-8         |

**`officers.py` — 3 routes**, all `settings.manage` OR
`organization.update_settings`: `GET ``, `PUT /{office_key}`,
`DELETE /{office_key}`. `office_key`is validated against`OFFICE_KEYS`before it is used as a settings-dict key, and`set_officer`validates the
client-supplied`user_id` in-org before storing it.

**`org_chart.py` — 5 routes.** `GET ``: authenticated only, deliberately
(published seats only for a non-manager, decided by `_can_manage`). The four
mutations (`POST /nodes`, `PUT /nodes/{id}`, `POST /nodes/{id}/move`,
`DELETE /nodes/{id}`) all require `orgchart.manage`OR`settings.manage`, all
resolve the node through `_require_node(organization_id, node_id)`, and all
route their client-supplied FKs (`parent_id`, `position_id`, holder
`user_id`) through `_validate_references`, which uses `assert_in_org`; a
`rank_code` is resolved by an explicit org-filtered query.

### Verified good ✅

- **Every one of the 28 routes carries an auth dependency, and 22 carry a
  permission dependency.** Mechanism: the inventory above, cross-checked
  against `tests/test_endpoint_auth_coverage.py` (which fails in both
  directions) and `tests/test_require_permission_registry.py`.
- **The three ceiling helpers are all still present and all still wired.**
  Mechanism: `_enforce_permission_grant_ceiling` / `_enforce_role_edit_ceiling`
  (`roles.py:51,87`; call sites at 231, 329, 339, 452),
  `_enforce_role_grant_ceiling` (`users.py:775`; call sites at 321,
  `assign_user_roles` and `add_role_to_user`), and
  `_enforce_rank_grant_ceiling` (`users.py:848`; four call sites, verified by
  grep: `create_member`, `update_user_profile`'s rank branch,
  `membership_pipeline.transfer_prospect` (PERM-3) and
  `operational_ranks.update_rank` (PERM-4)).
  `tests/test_privilege_ceiling_wiring.py` pins the last two by source order.
- **`User.rank` has exactly one widening write path.** Mechanism: grep for
  every assignment to `.rank` outside the rank service — the only other two
  (`membership_tier_service.py:303`, `member_status.py:856`) set it to `None`,
  which can only narrow. So the four ceiling call sites above are the complete
  set, not a sample.
- **A rank the caller invents grants nothing.** Mechanism:
  `get_rank_default_permissions()` resolves against the static
  `OPERATIONAL_RANKS` catalog by code string, and the per-org
  `operational_ranks` table has no permissions column — so `POST
/operational-ranks` with `rank_code="fire_chief"` creates a label, not an
  authority, and assigning it still has to clear
  `_enforce_rank_grant_ceiling`.
- **`*` is not reachable through role CRUD.** Mechanism: `create_role` and
  `update_role` reject any permission outside `get_all_permissions()`, and
  that list contains no wildcard of any kind. The only `*` in the whole
  registry is the seeded `it_manager` position.
- **The three seeded-grant changes since pass 3 each shipped the migration
  Pitfall #23 requires**, and the direction of each was checked separately
  because the rules differ: `bfe7c038` **revokes** `apparatus.view` from
  `_LINE_MEMBER_PERMISSIONS` and `DEFAULT_POSITIONS['member']`, backed by
  `b6e4a0d17c93`, unconditional and scoped to `is_system = True` (correct for
  a revocation — a department's own customized row is left alone);
  `54e60202` **adds** `finance.approve` + `finance.configure_approvals` to the
  seeded treasurer, backed by a migration gated on positive evidence the row
  is an unrepaired seed (correct for an addition — the scoped-subset match,
  not a whole-row snapshot, for the reason its own message gives); `7ff18d0c`
  registers the missing `emt` **position** so onboarding stops re-creating the
  rows `f3b8d0c26a17` had just cleaned, and aliases the rank's list object
  rather than copying it, which is what keeps the two in step.
- **The frontend's `checkPermission` cannot disagree with the backend about a
  renamed permission.** Mechanism: `_build_current_user_dict` runs
  `expand_legacy_permissions` before serializing, so the literal list the
  client compares against already carries the canonical names — the frontend
  matcher deliberately implements only `*` / exact / `module.*`, and does not
  need the alias map.
- **`GET /org-chart` is not reachable by the response cache**, despite
  returning member names, emails and phone numbers and not being in
  `UNCACHEABLE_PREFIXES`. Mechanism: the governance module builds its client
  with `createApiClient()`, which has no cache interceptor;
  `getCached`/`setCacheIfCurrent`/`isCacheable` are still imported by exactly
  one file, `services/apiClient.ts`. This is the same "no-op today" shape PR
  #2381 recorded for three routes rather than excluding them, and it is
  recorded the same way here so the next pass does not rediscover it — the
  moment governance moves to the cached client, `/org-chart` needs a denylist
  entry.
- **No injection surface in any of the ten files.** Mechanism: grep — zero raw
  SQL, zero `.like(`/`.ilike(`, zero `csv.writer`. `tests/test_like_escaping.py`
  and `tests/test_csv_writer_sweep.py` cover the whole tree anyway.
- **No unbounded in-memory tracker in any of the ten files** (Pitfall #9 n/a —
  none of them defines one; the per-request caches in `dependencies.py` live on
  `request.state`, which its own comment names as the reason).

### Findings

### PERM-5 — MED — Nothing stops a low-privileged position manager from permanently demoting a higher one — 🚩 FLAGGED

**What:** the three user↔position assignment routes are gated on
`users.update_positions` OR `members.assign_positions` (OR two legacy names),
and carry exactly two guards: `_enforce_role_grant_ceiling`, which walks the
**incoming** roles and so is a no-op on a removal, and
`assert_positions_retain_administrator`, which only asks whether _somebody_ in
the organization would still hold `members.manage`. Neither asks whether the
caller's own authority covers what the target currently holds. That question
is asked on the two neighbouring paths — `_enforce_role_edit_ceiling` on a
position's permission list (ORU-7), `_enforce_account_reset_ceiling` on a
credential reset — and not on this one.

**Where:** `app/api/v1/endpoints/users.py:931` (`assign_user_roles`, replaces
the whole set, including with `[]`), `:1167` (`remove_role_from_user`);
`app/services/admin_continuity_service.py:194`
(`assert_positions_retain_administrator`, whose whole contract is the count,
not the comparison).

**Failure scenario:** the seeded **Secretary** and **Membership Coordinator**
positions hold `members.assign_positions`, `users.update_positions` and
`members.manage`, and hold none of `settings.manage`, `security.manage` or
`positions.*` (verified against `DEFAULT_POSITIONS`). The Secretary sends
`PUT /users/{it_manager_id}/roles` with `{"role_ids": []}`. The grant ceiling
iterates an empty list and returns. The continuity guard finds two
administrators — the target and the Secretary themselves — so it returns too.
The wildcard `it_manager` position is removed and the department's only `*`
holder becomes an ordinary member. Reproduced against the real helpers, not
reasoned from the signatures: both guards were driven directly with this
state and both passed.

**And it cannot be undone through the API.** Re-granting the position runs
`_enforce_role_grant_ceiling`, which requires the caller to already hold `*`
— nobody does any more — and minting a replacement is impossible because
`create_role`/`update_role` validate against `get_all_permissions()`, which
contains no wildcard. Verified: `permission_matches("*", secretary_perms)` and
the same for the seeded President are both `False`, and `"*" not in
get_all_permissions()`. `admin_continuity_service`'s own module docstring
says recovery from an administrator-less state "needs a database
administrator"; this reaches the same place by a door that module does not
watch.

**Impact:** MED. No confidentiality gain and no privilege gain — this is
sabotage and self-inflicted lockout, reachable by an in-org member holding a
grant departments routinely delegate, and irreversible without database
access. It is the removal-direction twin of the escalation class this feature
otherwise guards thoroughly.

**Fix — flagged, not implemented.** The obvious guard ("you may not change the
positions of a member whose effective permissions exceed your own") is a
product decision, not a mechanical one: it would also block the legitimate
case a Membership Coordinator exists for, offboarding a departing chief, and
the department that most needs the guard is the one whose chief has left. The
options are not equivalent and the owner should pick:

1. **A demotion ceiling**, mirroring `_enforce_account_reset_ceiling` — refuse
   when the target holds anything the caller does not. Safest, most
   restrictive, and changes an existing workflow.
2. **Protect the wildcard only** — refuse to remove a position carrying `*`
   from its last holder, the way `assert_not_last_administrator` protects
   `members.manage`. Narrow, cheap, closes the irreversible case and nothing
   else.
3. **Accept it and make it recoverable** — leave the removal allowed but give
   `*` a restore path that does not require already holding it.

Mirrored into `docs/KNOWN_LIMITATIONS.md`.

### PERM-6 — LOW — Two read-only permissions were classified as write-tier — ✅ FIXED

**What:** `is_read_only_permission` decided a permission's tier from its
action word with `action == "view" or action.startswith("view_")`. Two grants
in the catalog read but do not match that shape: `inventory.check_view`
(action `check_view` — a `view` the prefix test cannot see, because the
convention also produces two-word actions on a nested resource) and
`scheduling.report` ("View shift reports and analytics"). Both were filed as
writes.

**Where:** `app/core/permissions.py:835` (pre-fix), consumed by
`permission_matches_any_write` at `:847` and, through it, by
`documents_service._folder_admits_user(require_write=True)` at
`app/services/documents_service.py:298`.

**Failure scenario:** `permission_matches_any_write` authorizes a mutation by
keeping only the entries of a folder's `required_permissions` that it believes
are writes. A read filed as a write is therefore handed to the caller as proof
of write authority: a folder whose ACL named `inventory.check_view` would let
a holder of that read-only grant rename it, delete it, or move documents in
and out — the exact defect the helper was added to close, one permission
family over.

**Impact:** LOW, and **latent rather than live** — verified, not assumed. The
only writer of `DocumentFolder.required_permissions` anywhere in `app/` is
`documents_service`'s facility-folder path, which stores
`FACILITY_SENSITIVE_PERMISSIONS` (`facilities.view_sensitive`,
`facilities.edit`, `facilities.manage`); all three are classified correctly,
and no request schema exposes the column. So nothing is exploitable today, and
the finding is that the classifier is wrong for the next ACL somebody writes.

**Fix:** `view` is now matched as a **word** in the action
(`"view" in action.split("_")`), which covers `check_view` and any future
`<resource>_view`, plus a named `_READ_ONLY_PERMISSION_EXCEPTIONS` set for the
one grant no naming rule can express (`scheduling.report`). The docstring
records the asymmetry that makes this worth getting right: under-detecting a
read weakens a write check, while over-detecting only withholds a write, which
fails closed.

**Guard test:** `tests/test_permission_read_write_tiers.py`. It checks the
classifier against an **independent** signal the same file already carries —
each `Permission`'s hand-written `description` — so it fails on a new
permission whose name and prose disagree, rather than restating the
implementation. Two documented disagreements are pinned by name with the exact
prose they were written for, so a stale exception fails too. Verified red
against the pre-fix implementation (4 of 11 tests fail, including the
end-to-end `permission_matches_any_write` assertion) and green after.

### PERM-7 — LOW — The two remaining unscoped role-assignment helpers — ✅ FIXED

**What:** `a9063055` gave `RoleManagementService.set_user_roles` a required,
keyword-only `organization_id` because it had none and no caller in `app/` —
"an unreachable bulk role-replacement that would have crossed tenants the
moment an endpoint wired it up", as its new docstring puts it. Its two
siblings on the same service, `assign_role_to_user` and
`remove_role_from_user`, are the same shape and were left as they were: no org
parameter, no in-org check on either the client-supplied `user_id` or
`role_id`, and zero callers in `app/`.

**Where:** `app/services/role_service.py:536` and `:600` (pre-fix). Confirmed
by grep that the only `remove_role_from_user` with a caller is the
identically-named _endpoint_ in `users.py`, which is a separate function and
does resolve both ids in-org.

**Failure scenario:** not reachable today — that is the point. This is the
landmine shape AUTH-6 and AUTH-16 named: a plausible-looking service method
sitting under the obvious name, so the endpoint that eventually calls it
crosses tenants in a one-line diff whose reviewer sees a service call and
nothing else. `assign_role_to_user` would pin an arbitrary position onto an
arbitrary member id, across organizations, and positions carry permissions.

**Impact:** LOW today, and the impact of the class it belongs to when it fires.

**Fix:** both now take a required keyword-only `organization_id` and run
`assert_in_org` over the member and the position before any write, matching
`set_user_roles` exactly. Their docstrings state what they do **not** enforce
— the grant ceiling on assignment, the administrator-continuity guard on
removal — and name the live endpoints that do, so a future caller inherits the
list rather than the surprise.

**Guard tests:** `TestSingleAssignmentOrgScoping` in `tests/test_role_service.py`
— four tests driving a foreign member id and a foreign position id through
each method and asserting `ValueError` before any commit, plus a parametrized
signature test asserting `organization_id` is keyword-only and has no default
on all three methods (so a future edit cannot quietly reintroduce an unscoped
default).

### PERM-8 — LOW — A rank reorder issued one query per submitted item, with no cap on items — ✅ FIXED

**What:** `RankReorderRequest.ranks` carried `min_length=1` and no
`max_length`, and `OperationalRankService.reorder_ranks` resolves each item
with its own org-scoped `get_rank` query. The list length was therefore a
query count bounded only by `MAX_REQUEST_BODY_SIZE` (60 MB) against roughly 60
bytes per item — on the order of a million sequential round-trips holding one
worker and one database connection for the duration of a single request.

**Where:** `app/schemas/operational_rank.py:96` (pre-fix);
`app/services/operational_rank_service.py:376` (the per-item loop).

**Failure scenario:** a `settings.manage` holder — or anything that has taken
over such a session — posts `/operational-ranks/reorder` with a large
generated list and ties up a worker. Checklist §6: "no N+1 loop issuing a
query per row".

**Impact:** LOW. Authenticated, org-admin-gated, org-scoped, and the loop
already refuses ids outside the caller's organization, so this is availability
only and only from an insider or a compromised admin session.

**Fix:** `MAX_RANKS_PER_REORDER = 500` on the schema. The loop is left alone
deliberately: rewriting it into a single query would have to reproduce MySQL's
case-insensitive id comparison in Python to be behaviour-preserving, and a cap
is the change that cannot be subtly wrong. 500 is far above any real rank
ladder (the seed writes 8) so the number itself should not need revisiting.

**Guard tests:** `TestReorder::test_reorder_request_is_length_capped` and
`::test_reorder_request_still_rejects_an_empty_list` in
`tests/test_operational_rank_service.py`.

### Checked and deliberately not raised

Recorded so the next pass does not spend the time again:

- **`GET /operational-ranks` and `GET /operational-ranks/{id}` are
  authentication-only.** Deliberate and unchanged since pass 1: a rank is a
  label plus an eligible-seat list, the shift-signup UI needs it, and
  `RankResponse` carries no member data. `/validate` is the one that resolves
  member names and it is the one PERM-1 gated.
- **`role_service.get_user_permissions` omits rank defaults**, so
  `GET /roles/admin-access/check` can report `has_access: false` for a member
  whose administrative grants come from their rank alone. It drives navigation
  only, every endpoint behind it re-checks through `_collect_user_permissions`,
  and the direction of the discrepancy is closed rather than open. A
  correctness wart, not a security finding.
- **`list_roles(include_user_count=True)` issues one count query per
  position.** Bounded by the number of positions in the org (seeded: ~20,
  admin-created beyond that), not by anything a caller submits — so unlike
  PERM-8 there is no request that grows it.
- **`create_rank` accepts an arbitrary `eligible_positions` list and an
  unbounded `description`.** Both are stored, neither is executed, and both are
  bounded by `RequestSizeLimitMiddleware`; `eligible_positions` entries outside
  the shift vocabulary resolve to no seats rather than to extra ones.
- **The `it_manager` position's `["*"]` grant.** Intended, documented at the
  definition, and the only wildcard in the registry; it is also what PERM-5's
  irreversibility argument turns on.
- **`get_request_enabled_modules` swallowing an invalid-credential
  `HTTPException`.** Re-verified as pass 3 described: it resolves module
  enablement, never identity, and is never used as an auth dependency (grep).

### Schema & migration notes

No model or migration was written this pass. Re-verified: `operational_ranks`
has `organization_id` `ondelete="CASCADE"` + `nullable=False` (correct —
CASCADE does not require nullable) and a `UniqueConstraint(organization_id,
rank_code)`; `organization_officers.user_id` and all three `org_chart_nodes`
FKs are `ondelete="SET NULL"` + `nullable=True` (Pitfall #2), which
`tests/test_database_schema.py::test_set_null_fks_are_nullable` also asserts
tree-wide. `validate_migrations.py --strict`: 438 revisions, single head
`1603bd9c59e7`. The three seeded-grant migrations since pass 3 are all present
in the chain (see "Verified good").

### Guard tests added

| Test                                                                         | Invariant it pins                                                                                                                                                             |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/test_permission_read_write_tiers.py` (11 tests)                       | every catalogued permission's read/write tier agrees with its own description; the two-word `view` actions are reads; a read-only holder fails `permission_matches_any_write` |
| `TestSingleAssignmentOrgScoping` in `tests/test_role_service.py` (5 tests)   | both single-assignment helpers refuse a foreign member or position before committing, and all three take `organization_id` keyword-only with no default                       |
| `TestReorder::test_reorder_request_is_length_capped` (+ the empty-list twin) | a rank reorder cannot grow into an unbounded query loop                                                                                                                       |

### Completion gate

| Check                                                                                                                                                    | Result                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                                            | ✅ 0 violations (flake8 7.3.0, CI's pin)                                              |
| `black --check app/ tests/ alembic/`                                                                                                                     | ✅ 1531 files unchanged (black 26.5.1, CI's pin)                                      |
| `isort --check-only app/ tests/ alembic/`                                                                                                                | ✅ clean (isort 9.0.1, CI's pin)                                                      |
| `python3 scripts/validate_migrations.py --strict`                                                                                                        | ✅ 438 revisions, single head `1603bd9c59e7`                                          |
| backend tests, scoped (`-k "permission or role or rank or officer or org_chart or org_scoping or documents or scoping"`)                                 | ✅ 1348 passed, 1 skipped (`py_vapid` not installed — environment)                    |
| `tests/test_org_scoping_ratchet.py`                                                                                                                      | ✅ 12 passed — no new unscoped by-id query                                            |
| `tests/test_require_permission_registry.py` + `test_endpoint_auth_coverage.py` + `test_permission_gate_composition.py` + `test_read_permission_gates.py` | ✅ 18 passed                                                                          |
| backend tests, full suite                                                                                                                                | ✅ 11 815 passed, 21 skipped (Docker/optional-dependency environment skips), 0 failed |
| `python3 scripts/check_docs_links.py`                                                                                                                    | ✅ 351 Markdown files, 0 broken links                                                 |
| `tsc --noEmit` / `eslint .`                                                                                                                              | n/a — no frontend file modified                                                       |

---

## Pass 3 (2026-09-01) — re-verified, no new findings

**Scope of this pass — corrected mid-review by Codex.** The first cut of this
pass used `git log --since=2026-08-27` (a date, not the actual merge commit)
against the six feature files and found three commits. That query is wrong in
general: a date-only cutoff can both include commits that were already part
of the reviewed merge and exclude commits that land later the same day, and it
did the latter here. Codex's review of this PR caught that `7ac83395` (merged
~45 minutes after pass 2's own closing merge `e601a95d`, confirmed with
`git merge-base --is-ancestor e601a95d 7ac83395`) carries a fourth relevant
commit, `4e40f96b`, touching `core/permissions.py` — present in the
`--since=2026-08-27` output as the boundary commit but not actually opened and
read. Re-run with the correct ancestry range
(`git log e601a95d..HEAD -- <six files>`) confirms exactly four commits, not
three: `cf033864` (permission rename), `9f6e7a7a` (member display-name
update), `a518957e` (module-gate exception handling), and `4e40f96b` +
`2959d2aa` (both merged via `7ac83395`, reviewed below). `officers.py`,
`officer_service.py`, `org_chart.py`, `org_chart_service.py`,
`operational_ranks.py`, and `operational_rank_service.py` are still
**byte-identical to pass 2** under the corrected range — zero commits,
confirmed via git log — so pass 2's "Verified good" write-up for those four
files stands without re-derivation, per this rotation's own rule not to
re-read what a prior pass already settled. Future passes on any feature
should use `git log <prior-pass-merge-sha>..HEAD`, never a date, for exactly
this reason.

All four changed commits (well, three original plus the two behind
`7ac83395`) reviewed in full against the checklist:

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
  lost by any **seeded** rank or position — verified by diffing every
  `OPERATIONAL_RANKS` / `DEFAULT_POSITIONS` entry touched: each
  `EQUIPMENT_CHECK_*` reference was replaced 1:1 (or the wildcard 1:3) with
  its `INVENTORY_CHECK_*` equivalent, nothing added or dropped there.
  **Correction (Codex review on this PR):** that seeded-only check does not
  cover every position. A **custom** position holding the `inventory.*`
  module wildcard genuinely gains authority it did not have before this
  rename: pre-rename, `inventory.*` could not satisfy `equipment_check.*`
  (different module segment, so `permission_matches`'s wildcard rule never
  matched across them), but post-rename `inventory.check_view` /
  `check_manage` / `check_submit` live inside the `inventory.*` namespace and
  are satisfied by it. This is real and not hypothetical — but it is also not
  a new finding, because the original commit's own message names it plainly
  as "one deliberate consequence" and gives the reason it's accepted: no
  seeded rank or position uses the `inventory.*` wildcard (confirmed again
  here by grep), so it only reaches a position a department configured for
  itself, and it is a widening in the same namespace the position already
  declared broad trust in. What was wrong was this write-up's own **blanket**
  "no permission gained or lost by any rank or position" claim, which
  overstated a seeded-only check into a universal one. Narrowed above.
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
- **`4e40f96b` + `2959d2aa` (merged via `7ac83395`) — restrict baseline
  `facilities.view` grants.** A revocation, not a grant: removes
  `FACILITIES_VIEW` from `_LEADERSHIP_VIEW_PERMISSIONS`,
  `_LINE_MEMBER_PERMISSIONS`, the relevant `OPERATIONAL_RANKS` entries, and
  `DEFAULT_POSITIONS['member']`, so operational roles stop inheriting
  organization-wide facility reads by default. A revocation can only narrow
  authority, so this dimension-2 (authorization fit) direction is safe by
  construction — the finding worth checking is whether it was applied
  completely, not whether it over-grants. It wasn't, on the first commit:
  `4e40f96b` only edited the registry, and `DEFAULT_POSITIONS` is
  materialized into `positions` rows once, at onboarding (Pitfall #23) — so
  every already-running department's stored Captain/Lieutenant/etc. rows
  kept the grant the registry no longer issues. `2959d2aa`, merged 3.5 hours
  later in the same PR, is exactly the Pitfall #23 correction: migration
  `c7e2b9a41f83` strips `facilities.view` from the five affected system
  slugs' stored rows, scoped to `is_system=True` so a department's own
  customized Captain is untouched, verified by its author against a real
  MySQL table (system rows lose the grant, a custom Captain and a
  still-granted secretary don't, re-run is a no-op). Confirmed both
  migrations (`e4f5a6b7c8d9`, `c7e2b9a41f83`) are present in the current
  chain and the chain still validates to a single head. No residual gap:
  current `grep FACILITIES_VIEW app/core/permissions.py` shows it only in
  `FACILITIES_VIEW_SENSITIVE`-adjacent leadership/management contexts, not
  back in any baseline default.

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

**No new findings.** Nothing in this pass's checklist coverage — the four
changed commits, plus the six unchanged files' pass-2 conclusions — surfaced
an authentication, authorization, tenant-isolation, injection, exposure, or
schema/migration defect. The one accuracy issue this pass's own first draft
introduced (the blanket wildcard-authority claim, corrected above) was in
this write-up, not in application code.

**Completion gate:** no backend or frontend source file was modified this
pass (documentation only). **Correction (Codex review on this PR):** the
first draft of this section cited PR #2133 as "the baseline already
confirmed green," which was wrong — PR #2134 (7 frontend files, 372 added
lines) merged into `main` after #2133 and is this branch's actual parent
commit, and #2133's own checks say nothing about it. The commits this pass
adds are documentation-only, so this PR's own CI run — which runs against
the real current tree, #2134 included — is the correct evidence rather than
citing any prior PR: `Frontend Lint, Typecheck & Build`, `Frontend Tests`,
`Frontend E2E`, and every backend job on this PR (#2136) all completed
green. `python3 scripts/validate_migrations.py --strict` re-run directly for
the schema dimension: single head, 399 revisions, no changes. `flake8 app/
tests/ alembic/` re-run directly: 0 violations.

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
