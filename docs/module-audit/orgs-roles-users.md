# Module Audit — Orgs / Roles / Users

**Scope:** the privilege-management surface — `endpoints/organizations.py`
(1,026 L) + `organization_service.py`, `endpoints/roles.py` (623 L) +
`role_service.py` + `core/permissions.py`, `endpoints/users.py` (1,774 L) +
`user_service.py`, `endpoints/operational_ranks.py` (193 L) +
`operational_rank_service.py`, `endpoints/member_status.py` (911 L). Governs role/
permission assignment, org settings/secrets, and member lifecycle — so privilege
escalation and secret handling are the headline risks.
**Audited:** iteration 21 — three parallel readers: (A) users + ranks, (B) roles
+ permissions + member-status, (C) organizations.

## Verified good ✅
- **The H2 role-grant privilege ceiling is real and correct on the paths it
  covers.** `_enforce_permission_grant_ceiling` guards role create/update/clone;
  `_enforce_role_grant_ceiling` guards the assign/add-role paths. Wildcard
  escalation is properly ceiled (`permission_matches`: only a `*` holder can
  grant `*`; only a `module.*` holder can grant `module.*`). The caller's
  permission set includes both positions and operational-rank defaults.
- **Tenant isolation is strong.** Every by-id user/role/rank/member-status
  read/mutation filters `organization_id` (or resolves via an org-scoped fetch —
  **XC-3 clean**). Organizations endpoints derive the org exclusively from
  `current_user.organization_id` (no `org_id` accepted from path/body/query).
- **Self-or-admin gate present on all four `get_current_user`-only user
  mutations** (contact-info, profile, photo up/down): each checks
  `user_id == current_user.id` or an admin permission — no bare IDOR.
- **Secrets at rest + on read.** Settings secrets are encrypted before persist,
  decrypted on read, and redacted on GET/most PATCH responses. JSON nested
  mutation correctly uses `copy.deepcopy()` (no silent no-op writes).
- **Password/MFA/state changes are admin-gated, org-scoped, self-blocked**
  (reset-password, reset-mfa, delete both block self-targeting + revoke sessions).
  No password hash / MFA secret leaks in any response schema.
- **No SQL injection** — no LIKE/raw SQL/f-string queries across any of the files;
  `/admin-access/check` computes from server-resolved roles (not spoofable);
  operational ranks fully org-scoped + `settings.manage`-gated.

## Findings

### ORU-1 — HIGH (privilege escalation) — `create_member` bypassed the role-grant ceiling — ✅ FIXED
`POST /users` (`create_member`) assigned client-supplied `role_ids` with **no**
`_enforce_role_grant_ceiling` call — unlike the assign (`PUT /users/{id}/roles`)
and add (`POST /users/{id}/roles/{role_id}`) paths that do enforce it. Roles were
filtered only by org (no `is_system` filter), and `AdminUserCreate` lets the
caller set a known initial password. Impact: a plain `users.create` holder
(secretary/coordinator, without `*`) could create a puppet account with a chosen
password, attach the wildcard `it_manager` ("System Owner", perms `["*"]`) role,
log in, and take over the entire tenant — the exact escalation the H2 ceiling was
added to close, via an unguarded third path. Both the users reader and the roles
reader independently flagged this.
**Fix:** call `_enforce_role_grant_ceiling(current_user, list(roles), db,
get_client_ip(request))` right after the role-validity check, before insertion
(added `request: Request` to the handler). Legitimate in-ceiling grants are
unaffected.

### ORU-2 — HIGH (privilege escalation → secret rewrite) — `PATCH /settings` accepted the narrow contact-visibility permission — ✅ FIXED
The full-settings update was gated `require_permission("settings.manage",
"settings.manage_contact_visibility", "organization.update_settings")` (any-of),
but its body is the entire `OrganizationSettingsUpdate` schema (auth/SSO, SMTP,
file-storage, modules, IT team). A secretary holding only
`settings.manage_contact_visibility` (meant only to toggle contact-info
visibility) could therefore rewrite the `auth` section — inject an
attacker-controlled OAuth `client_secret`/Authentik URL — or overwrite SMTP/S3
credentials and disable modules: privilege escalation bordering on SSO takeover.
**Fix:** removed `settings.manage_contact_visibility` from this route. That
permission already has a dedicated narrow endpoint (`PATCH /settings/contact-info`)
that writes only `contact_info_visibility`, so the secretary keeps their
legitimate capability and loses only the unintended full-settings write.

### ORU-3 — MEDIUM — Auth secret destroyed on a full-settings round-trip — ✅ FIXED
The `"••••••••"` redacted-placeholder preservation loop in
`update_organization_settings` iterated only `("email_service", "file_storage")`,
not `"auth"`. Since GET `/settings` redacts SSO client secrets to `"••••••••"`, a
client saving the settings back through the top-level `PATCH /settings` (with the
auth section still holding the bullets) would persist the literal bullet string
(encryption skips it), silently overwriting the real SSO client secret and
breaking login.
**Fix:** added `"auth"` to the preservation loop's section list.

### ORU-4 — MEDIUM (cross-tenant) — Module migration read another org's onboarding row — ✅ FIXED
`_resolve_module_settings`'s safety-net path ran
`select(OnboardingStatus).limit(1)` with **no org filter and no ordering**. In the
migration path (org settings' modules empty/all-False and not `_user_configured`),
org A's `enabled_modules` could be seeded from an arbitrary other org's onboarding
row and then persisted as org A's canonical modules — cross-tenant config bleed +
non-determinism.
**Fix:** scoped the query to `OnboardingStatus.organization_id == org.id`; when
`org` isn't available (can't be scoped safely) the fallback is skipped and
defaults are returned.

### ORU-5 — MEDIUM — `PATCH /settings/auth` echoed secrets un-redacted — ✅ FIXED
Unlike its email/file-storage siblings (which `return ….redacted()`), the auth
PATCH returned `auth_settings` directly, serializing `*_client_secret` fields in
plaintext in the response body/logs.
**Fix:** `return auth_settings.redacted()`.

### ORU-6 — LOW — Self-service email change: type-mismatch + no re-verification — ✅ FIXED
On `PATCH /users/{id}/contact-info`, the email-uniqueness self-exclusion used
`.where(User.id != user_id)` — a `UUID`-vs-`String` comparison that never
excludes the caller's own row, so re-saving your own email raised a spurious
"Email is already in use." And a changed email left `email_verified=True`,
inheriting trust it hadn't earned.
**Fix:** `.where(User.id != str(user_id))`, and reset `email_verified=False` when
the email actually changes.

### ORU-7 — MED/LOW — Role-edit ceiling, last-admin lockout, member-role guard — ⚠️ MOSTLY FIXED (app-review B21)
- **✅ Role-edit ceiling (roles #2) — FIXED (B21).** The grant ceiling only
  validated the *new* permission list (early-returns on `[]`), so a
  privileged-but-not-`*` caller could wipe/downgrade the tenant's only `*` role.
  A new `_enforce_role_edit_ceiling` now requires the caller's ceiling to cover the
  role's **current** permissions when changing them — you cannot edit a role more
  privileged than you could have created. 3 unit tests added.
- **✅ Last-admin / lockout (roles #3) — ALREADY FIXED (doc drift).**
  `assert_role_change_retains_administrator` (`admin_continuity_service.py`)
  recounts the org with the proposed permissions and raises `LastAdministratorError`
  if no active member would still satisfy `members.manage`; wired into
  `update_role` (both branches) and `delete_role`. Closed since the audit.
- **🚩 Member-role mass-escalation (roles #4) — still flagged.** The org-wide
  `member` role can be escalated up to the caller's ceiling (intended-but-sharp);
  a dedicated guard/confirmation is a product decision. In `KNOWN_LIMITATIONS.md`.
**Status:** roles #2 fixed, roles #3 already-fixed, roles #4 flagged. See
`docs/app-review/orgs-roles-users.md`.

### ORU-8 — MED/LOW — ✅ FIXED (2026-08-04) — Broader PII/config exposure than the privacy gate intends
- `GET /users/{id}/with-roles` and `GET /users/with-roles` serialized full
  contact PII (email, phone, home address, DOB, emergency contacts) to any
  `users.view` holder, bypassing the `contact_info_visibility` gate the list
  endpoint honors. (users #2)
- `GET /settings` (`get_current_user`-only) returned integration identifiers
  (OAuth `client_id`, tenant id, Authentik URL, SMTP host/user, S3 bucket/region)
  and the whole `it_team` block (member names/emails/phones + free-form
  `backup_access`) to any authenticated member. (orgs #5)

**Fixed in two passes**, and on reading the code neither needed the product
decision this was carried for — the policy was already expressed, in
`contact_info_visibility` and in `without_infrastructure()`. These were the call
sites that did not consult it.

- **ORU-8a.** The roster endpoint was redacted first; `GET /users/{id}/with-roles`
  was left returning the raw ORM record, which made the setting *advisory* —
  anything the roster withheld was one request to the detail URL away, plus
  `personal_email` and the full home address, which the roster never exposes at
  any visibility setting. Both endpoints now share `_clear_hidden_contact_fields`
  and `_load_contact_visibility` (fails closed when the settings row is
  unreadable) so they cannot drift again. `members.manage` holders **and the
  subject** are exempt: `UserSettingsPage` loads a member's own profile through
  that endpoint and writes the fields back, so redacting for self would have
  blanked their own address and phone on the next save.
- **ORU-8b.** `without_infrastructure()` stripped the identifiers but not
  `it_team`, so every authenticated member still received the names, direct
  email and phone of whoever administers the deployment, plus `backup_access` —
  unstructured text about break-glass access. Now emptied (not nulled, so the
  settings UI still renders the section) for callers without `settings.manage`.
- **Date of birth and emergency contacts** were the part that *was* a product
  call, since `contact_info_visibility` has no flag for either. Decided
  leadership-only, unconditionally: cleared by `_clear_leadership_only_fields`
  for everyone except `members.manage` holders and the member themselves, with
  no setting able to publish them. `members.manage` was chosen over a new
  permission because it already resolves to the intended population, where
  `users.view` reaches 24 positions and `members.view` reaches every member; it
  also needs no seed migration, so existing organizations get the restriction on
  upgrade. Emergency contacts are PII belonging to people who are not members of
  the department at all and cannot remove themselves, which is why there is
  deliberately no setting. `MemberProfilePage` mirrors the gate and hides the
  section rather than rendering it empty. Disclosure is recorded on the existing
  `user_viewed` audit event via `restricted_pii_disclosed`.

**Status:** fixed. Covered by `tests/test_pii_exposure.py`.

### ORU-9 — LOW — mostly FIXED — Correctness/robustness polish
- **✅ Membership-ID generation hardened.** `generate_next_membership_id` now
  locks the org row `FOR UPDATE` before reading/incrementing the JSON counter,
  so two concurrent member creations can't read the same `next_number` and mint
  duplicate IDs (TOCTOU); the collision-retry `while` loop is now capped
  (raises after 100k attempts instead of spinning forever). (orgs #6/#7)
- **✅ `users.edit`/`users.update` reconciled.** The admin self/other update path
  checked the non-existent permission `"users.update"` (never granted, so it
  silently fell through to `members.manage` only); it now checks `"users.edit"`,
  matching the catalog and the sibling update path. (users #5)
- **✅ `PATCH /settings` deep-merges.** `update_organization_settings` now merges
  nested sections key-by-key (`_deep_merge_settings`) instead of a shallow
  `{**a, **b}` that replaced a whole section when a partial PATCH touched one
  sub-key — closing the data-loss risk. (orgs #9)
- **✅ Fixed (2026-07-31, was deferred):** `member_status` transitions now go
  through a lifecycle state machine (`ALLOWED_STATUS_TRANSITIONS` in
  `endpoints/member_status.py`) instead of any-to-any: membership states
  interchange, suspension must resolve to reinstatement or termination (never
  straight to leave/retirement), retired/dropped members have explicit
  reinstatement paths, and ARCHIVED is isolated on both sides (the dedicated
  /archive and /reactivate endpoints remain the only doors). Blocked
  transitions return 400 with the allowed list. Unit-tested in
  `tests/test_member_status_transitions.py`. (roles #5) **✅ users #6 unblocked (resolved 2026-07-30: `audit_logs.organization_id` exists (migration `20260801_0009`, backfilled from user_id, hash-bound from version 3)):** the member
  audit-history query now filters `AuditLog.organization_id` directly.
**Status:** correctness/robustness items fixed; two items deferred (design /
blocked on the audit-log org column).

## Notes
- Large-file caveat: `users.py` (1,774 L) and `member_status.py` (911 L) were
  reviewed for security invariants (escalation, org-scoping, self-or-admin gates,
  secret/PII handling), not line-by-line. The invariants held on every path
  examined.
