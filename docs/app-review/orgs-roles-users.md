# Application Review — Orgs / Roles / Users (Tier B)

**Prefix:** `ORU2` · **Iteration:** B21 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-08 (pass 2), 2026-08-09 (pass 3), 2026-08-09 (pass 4),
2026-10-25 (pass 5)

**Backend:** the privilege-management surface — `endpoints/roles.py` +
`role_service.py` + `core/permissions.py`, `endpoints/organizations.py` +
`organization_service.py`, `endpoints/users.py` + `user_service.py`,
`endpoints/member_status.py`.
**Prior audit:** `docs/module-audit/orgs-roles-users.md` (iteration 21) — ORU-1
(create-member escalation), ORU-2/3/5 (settings secret leaks), ORU-4 (cross-tenant
module read), ORU-6, ORU-8 (PII), ORU-9 fixed; ORU-7 (role-edit ceiling, last-admin,
member-role guard) left open.

---

## Pass 5 (2026-10-25) — seven fields acknowledged a null and ignored it (7 fixed)

Lens for this pass: the update-payload contract (omit = keep, `null` = clear, a value =
set) driven through the real handlers, the method of B18–B20, on the four update routes
that write a model row: `PATCH /roles/{id}`, `PATCH /users/{id}/profile`,
`PATCH /users/{id}/contact-info` and `PATCH /users/leaves-of-absence/{id}`. The
organization settings routes write JSON blobs rather than columns and are out of the
test's reach. A test reads each route's schemas from the application's OpenAPI document,
builds a row from the model, and sends `null` for every field. A field must be refused
(exactly 400 or 422, value unchanged) when its column is NOT NULL or its response cannot
hold `None`, and must clear otherwise.

**The test was made stricter for this module, and the stricter half found most of it.**
Until now the "may be cleared" half asserted a 200 and a readable row. A handler that
skips a null answers 200 too, so it passed. The half now seeds the column with a value
first and asserts it is empty afterwards. That is what exposed the role description, and
it should be applied to the training, scheduling and finance tests, which still assert only
the status for clearable fields (not done here; see below). It cannot seed encrypted or
JSON columns, so those are read from the handler instead.

This is the privilege-management surface, so to be explicit: none of these changes alters
who may do what. Each refuses a request that previously did nothing, and the frontend
sends none of the nulls (its update types exclude them, and the role form sends a field
only when it changed).

### ORU2-2 — LOW — a null on four role fields answered 200 and changed nothing — ✅ FIXED

`RoleService.update_role` takes keyword arguments and reads `None` as "not provided", so
`PATCH /roles/{id}` with `name`, `description`, `permissions` or `priority` as `null`
returned 200 and left the role as it was. `name`, `permissions` and `priority` are NOT NULL
columns, so there was nothing a null could mean. `description` is nullable, and an
acknowledged request that does not clear it is the failure the contract is meant to
prevent. **Fixed:** `RoleUpdate` inherits `RefusesNull` and answers 422; to empty a
description, send an empty string, which is what the role form already does.

### ORU2-3 — LOW — a null email or notification preferences on contact-info answered 200 and changed nothing — ✅ FIXED

`update_contact_info` guards both with `is not None`. `email` is NOT NULL, and preferences
are merged, never cleared. The test found `email`; `notification_preferences` has the same
guard and was added by reading it, the encrypted/JSON seeding gap above hid it from the
test. **Fixed** with `RefusesNull` on `ContactInfoUpdate`. `phone` and `mobile` are
untouched: a null clears them, as the handler's comment says and the test confirms.

### ORU2-4 — LOW — a null on the profile's emergency contacts answered 200 and changed nothing — ✅ FIXED

`update_user_profile` pops `emergency_contacts` and writes it only if it is not None, so
a null was dropped behind a 200; an empty list is how contacts are removed. **Fixed** with
`RefusesNull` on `UserUpdate`.

### Checked and left alone

- `member_class` and `member_status` accept a null and do not end up empty: the
  reconciliation listener on `User` re-derives them from `membership_type`, so the stored
  value is the default. The test names this in `_REDERIVED` rather than treating it as a
  failure.
- All 90 endpoints in `roles.py`, `organizations.py`, `users.py` and `member_status.py`
  (13, 29, 32 and 16) carry an auth dependency (an AST scan).

### Not done

- **The seeded-clear assertion is not yet in the training, scheduling or finance tests.**
  It is cheap and should be tried on each; an ignored null in those modules would not have
  been seen.
- **Organization settings routes** (`PATCH /organization/settings*`, `/profile`,
  `/modules`) and the `PUT /users/{id}/roles` / `service-periods` / `qualifications`
  whole-object routes are not in the test.
- **The harness is a fourth copy** and should move to a shared helper.
- The other five checklist dimensions were not re-run beyond the scan above; passes 1–4
  stand, including the ceiling guards recorded in pass 4.

**Completion gate (pass 5):** `flake8 app/ tests/` 0 · `black --check app/ tests/` clean ·
`isort` clean on the changed files · `mypy` on `schemas/role.py` and `schemas/user.py` clean ·
no frontend change · new `test_roles_users_update_endpoints_integration.py` 42 pass, 0
selected under the unit job's marker expression; 8 cases failed before the schema changes
(5 refused, 3 not cleared, one of which was the finding above and two the re-derived fields
now named in the test) · 2,329 tests selected by
`role|user|member|permission|position|privilege|contact|rank|leave|organization|org_|model_updates|ceiling`
pass. **Environment note:** the first full run of that group showed 248 failures, all
`CONSTRAINT users.emergency_contacts failed`; they reproduce on a clean `main` and were the
sandbox database sitting one revision behind (`3d67883cd461` against head `3f2593e8071e`,
today's encrypt-date-of-birth migration). `alembic upgrade head` cleared them, and the
248 plus the new file pass: 595 passed.

---

## Pass 4 (2026-08-09) — invariants re-verified, no code change

Re-verified this highest-risk (privilege-escalation) module's ceiling guards hold:

- **ORU-7a/7b** — `_enforce_permission_grant_ceiling` / `_enforce_role_edit_ceiling`
  wired into the role create/update/grant paths; last-admin/lockout protection
  intact (6 ceiling refs in `roles.py`).
- **ORU-7d (CRITICAL)** — `_enforce_rank_grant_ceiling` wired into both
  `create_member` and `update_user_profile` (rank-change path), so a rank can't be
  used to grant permissions beyond the caller's own (3 ceiling refs in `users.py`).
- **Latent-500 lens clean** (user/role/org enum fields typed in the request
  schemas); **E712-free** across `role_service.py`/`organization_service.py`/
  `user_service.py`.

Open item unchanged: **ORU-7c** — mass-editing the org-wide `member` role can
escalate every member at once; intended (an org-wide role _should_ be broadly
editable) but sharp — an optional confirmation/guard is the owner's call.

**Completion gate (pass 4):** no code changed; `flake8` 0 · `black --check` clean ·
`tsc --noEmit` n/a.

---

## Pass 3 (2026-08-09) — verified clean on the privilege-escalation surface

Re-verified the module's permission-ceiling guards all hold — the crux of this,
the highest-risk module:

- **ORU-7a/7b** — `_enforce_permission_grant_ceiling` / `_enforce_role_edit_ceiling`
  (`roles.py` 51/87) are wired into the role create/update/grant paths (228/312/327/452);
  last-admin/lockout protection intact.
- **ORU-7d (CRITICAL)** — `_enforce_rank_grant_ceiling` (`users.py` 673) is wired into
  both `create_member` (234) and `update_user_profile` (1314, only when the rank
  actually changes), so a `users.create`/`members.manage` holder still can't mint or
  self-assign a rank carrying permissions beyond their own. `test_rank_grant_ceiling.py`
  4/4 pass.

**Latent-500 lens clean:** the enum columns (`identifier_type`, `leave_type`,
`organization_type`, `status`) are all properly typed in the user/role/org request
schemas — no free-string→ENUM path. **E712-free** across `role_service.py`,
`organization_service.py`, `user_service.py`.

### Still flagged (unchanged)

- **ORU-7c** — mass-editing the org-wide `member` role can escalate every member at
  once; intended (an org-wide role _should_ be broadly editable) but sharp. An
  optional dedicated confirmation/guard is the owner's call, in `KNOWN_LIMITATIONS.md`.

**Completion gate (pass 3):** `flake8` 0 · `black --check` clean · `tsc --noEmit`
n/a (no frontend change) · `test_rank_grant_ceiling.py` **4 passed** (DB-free); no
code changed.

---

## Pass 2 (2026-08-08) — six-lens sweep

Re-verified pass-1 ORU-7a (`_enforce_role_edit_ceiling`) and ORU-7b (last-admin
retention) hold. The privilege-escalation lens then found a **CRITICAL** parallel
escalation path the role-ceiling work didn't cover.

### ORU-7d — CRITICAL — Operational rank bypassed the permission-grant ceiling — ✅ FIXED

Effective permissions are the **union of a member's positions _and_ their
operational rank** (`_collect_user_permissions` in `dependencies.py`:
`perms.update(get_rank_default_permissions(user.rank))`). Every role/position
grant is ceiling-checked — `_enforce_role_grant_ceiling` blocks a caller from
handing out permissions beyond their own — but **rank had no such ceiling**, and a
rank change is gated only on `members.manage`. The `fire_chief` rank's
`default_permissions` include `settings.manage`, `security.manage`, and
`positions.manage_permissions`; the default **secretary** position holds
`members.manage`/`users.create` but none of those. Two live exploit paths:

- `POST /users` (`create_member`) — needs only `users.create`; it set
  `rank=user_data.rank` **unchecked** while only `role_ids` were ceiling-checked.
  A secretary creates a member with `rank="fire_chief"` and a chosen `password`,
  then logs in as a near-superadmin.
- `PATCH /users/{id}/profile` (`update_user_profile`) — `rank` is a "restricted
  field" gated on `members.manage` only, so a secretary sets **their own**
  `rank="fire_chief"` and instantly gains `settings.manage`/`security.manage`.

This defeats the exact segregation the settings-secret work (ORU-2/3) established.
**Fix:** a new `_enforce_rank_grant_ceiling` mirrors the role ceiling — a rank may
be assigned only if every permission it grants is within the caller's own
effective permissions (wildcards honored via `_has_permission`), else `403` +
`report_privilege_escalation_attempt` (CRITICAL alert). Wired into `create_member`
(any provided rank) and `update_user_profile` (only when the rank actually
changes, so ordinary profile edits aren't blocked). A chief keeps setting any
rank; a secretary can still set low ranks that carry ≤ their own permissions. 4
DB-free regression tests (`test_rank_grant_ceiling.py`).

**Flagged (unchanged):** ORU-7c (org-wide `member` role mass-escalation). Two LOW
latent-500s noted (both effectively unreachable): `acknowledge_setup_checklist_item`
and `create_member`'s `generate_next_membership_id` (100k-collision cap) raise
`ValueError` outside a 400-mapping wrapper. Lenses 1–4 otherwise clean:
`update_user_profile` uses an `ALLOWED_PROFILE_FIELDS` allowlist (no
`role_ids`/`permissions`/`organization_id` mass-assignment), every by-id read/write
is org-scoped, and role assignment validates `Role.organization_id`.

---

## Scope

Tier B: the open ORU-7 items on the highest-risk surface (privilege escalation).
The H2 role-grant ceiling, tenant isolation, self-or-admin gates, and secret
handling were re-confirmed. One ORU-7 sub-item turned out already-fixed (doc drift),
one was fixed here, one stays flagged.

## Findings

### ORU-7a — MEDIUM (privilege sabotage) — Could edit/gut a MORE-privileged role — ✅ FIXED

`_enforce_permission_grant_ceiling` (on `update_role`) only validated the **new**
permission list and **early-returns on an empty list**. So a privileged-but-not-`*`
caller (e.g. a Fire Chief) could:

- set the `*` "System Owner" role's permissions to `[]` (the empty-list bypass), or
- downgrade it to their own subset,

wiping/sabotaging the tenant's wildcard admin. The grant ceiling stopped
_raising_ a role above your level but not _editing a role already above it_.

**Fix:** a new `_enforce_role_edit_ceiling` runs when the caller is changing a
role's permissions (`role_update.permissions is not None`): it fetches the role's
**current** permissions and requires the caller's own ceiling to cover them —
i.e. you cannot edit a role more privileged than you could have created. A `*`
holder edits anything; a Fire Chief editing the `*` role is now 403'd and the
attempt is reported to security monitoring. Legitimate edits (a role at or below
your level) are unaffected. **3 unit tests added.**

### ORU-7b — last-admin / lockout protection — ✅ ALREADY FIXED (doc drift corrected)

The audit flagged "no last-admin / lockout protection anywhere." It exists:
`assert_role_change_retains_administrator` (`admin_continuity_service.py`) recounts
the whole org with the proposed permissions and raises `LastAdministratorError` if
no active member would still satisfy `members.manage`. It is wired into
`update_role` (both system and custom branches) and `delete_role`. This closed
since the audit; the module-audit is corrected.

### ORU-7c — org-wide `member` role mass-escalation — 🚩 FLAGGED (intended-but-sharp)

The baseline `member` role every user carries can be escalated up to the caller's
own ceiling (no dedicated guard on the baseline role beyond the grant ceiling).
This is intended (an admin can grant all members a new capability) but sharp — a
dedicated confirmation/guard on the org-wide role is a product decision. Unchanged;
recorded in `KNOWN_LIMITATIONS.md`.

## Verified good ✅ (re-confirmed)

- ORU-1 (`create_member` calls `_enforce_role_grant_ceiling`), ORU-2/3/5 (settings
  secret preservation + redaction), ORU-4 (module migration org-scoped), ORU-6,
  ORU-8 (PII gate on with-roles + it_team), ORU-9 (membership-id TOCTOU lock,
  member-status state machine) all hold.
- H2 ceiling wildcard logic correct (`permission_matches`); orgs endpoints derive
  org from `current_user` only; self-or-admin on all `get_current_user` user
  mutations; no password/MFA-secret leaks.

## Documentation

`docs/module-audit/orgs-roles-users.md` updated: ORU-7a fixed, ORU-7b marked
already-fixed (doc drift), ORU-7c stands.

## Future development

1. **ORU-7c** — optional dedicated guard/confirmation on mass-editing the org-wide
   `member` role.

## Completion gate

| Check                      | Result                                                                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `flake8` (endpoint + test) | ✅ 0 violations                                                                                                               |
| `black --check`            | ✅ unchanged                                                                                                                  |
| `tsc --noEmit`             | ✅ n/a — no frontend change                                                                                                   |
| backend tests              | ✅ `test_role_service` + `test_permission_matching` **25 passed**; `test_role_edit_ceiling` **3 passed** (new). No DB needed. |
