# Application Review — Orgs / Roles / Users (Tier B, 2nd pass)

**Prefix:** `ORU2` · **Iteration:** B21 · **Reviewed:** 2026-08-06

**Backend:** the privilege-management surface — `endpoints/roles.py` +
`role_service.py` + `core/permissions.py`, `endpoints/organizations.py` +
`organization_service.py`, `endpoints/users.py` + `user_service.py`,
`endpoints/member_status.py`.
**Prior audit:** `docs/module-audit/orgs-roles-users.md` (iteration 21) — ORU-1
(create-member escalation), ORU-2/3/5 (settings secret leaks), ORU-4 (cross-tenant
module read), ORU-6, ORU-8 (PII), ORU-9 fixed; ORU-7 (role-edit ceiling, last-admin,
member-role guard) left open.

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
