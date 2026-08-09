# Application Review — Orgs / Roles / Users (Tier B)

**Prefix:** `ORU2` · **Iteration:** B21 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-08 (pass 2), 2026-08-09 (pass 3), 2026-08-09 (pass 4)

**Backend:** the privilege-management surface — `endpoints/roles.py` +
`role_service.py` + `core/permissions.py`, `endpoints/organizations.py` +
`organization_service.py`, `endpoints/users.py` + `user_service.py`,
`endpoints/member_status.py`.
**Prior audit:** `docs/module-audit/orgs-roles-users.md` (iteration 21) — ORU-1
(create-member escalation), ORU-2/3/5 (settings secret leaks), ORU-4 (cross-tenant
module read), ORU-6, ORU-8 (PII), ORU-9 fixed; ORU-7 (role-edit ceiling, last-admin,
member-role guard) left open.

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
escalate every member at once; intended (an org-wide role *should* be broadly
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
  once; intended (an org-wide role *should* be broadly editable) but sharp. An
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

Effective permissions are the **union of a member's positions *and* their
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
*raising* a role above your level but not *editing a role already above it*.

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

| Check | Result |
|-------|--------|
| `flake8` (endpoint + test) | ✅ 0 violations |
| `black --check` | ✅ unchanged |
| `tsc --noEmit` | ✅ n/a — no frontend change |
| backend tests | ✅ `test_role_service` + `test_permission_matching` **25 passed**; `test_role_edit_ceiling` **3 passed** (new). No DB needed. |
