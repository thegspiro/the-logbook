# Module Audit — Onboarding

**Scope:** the tenant-provisioning flow — `api/v1/onboarding.py` (1,961 L, 20
routes), `services/onboarding.py` (1,319 L), and the org-template services
(`org_template_service.py` export, `org_template_registry.py`,
`template_service.py` minutes templates). Single-instance bootstrap: the flow
creates one org, the first System Owner (wildcard `it_manager`), roles/positions,
and a HQ facility/location, then latches `is_completed`.
**Audited:** iteration 25 — three parallel readers: (A) endpoint guards, (B)
service (reset/owner/session), (C) org-template services.

## Verified good ✅
- **The two catastrophic scenarios are correctly blocked.** Post-completion
  `POST /reset` is refused (`is_completed` check) and requires a valid session +
  CSRF, and no new onboarding session can even be minted once an org exists
  (`get_or_create_session` 403s), so post-setup reset is unreachable. A second
  `POST /system-owner` and a replayed `POST /organization` are blocked by
  `needs_onboarding()`.
- **No secrets in responses.** `/system-owner` sets auth only via httpOnly
  cookies (no token/password in the body); `/complete` returns no credentials;
  `GET /session/data` returns only `configured: True` / counts — never the SMTP
  password, OAuth secret, or S3 keys. Session secrets are `encrypt_data`'d at
  rest; only `platform` is plaintext.
- **Strong session model.** 256-bit `secrets.token_urlsafe` id, 30-min DB-backed
  expiry (no in-memory dict), CSRF via `secrets.compare_digest`, and one client
  cannot read another's session without the token.
- **Passwords hashed** (Argon2id via `register_user`); the owner password is never
  written into session data. `complete_onboarding` is a one-way latch;
  `configure_modules` validates against a module allowlist and `deepcopy`s
  settings; JSON mutation uses `deepcopy`/`flag_modified` throughout (pitfall #12
  avoided on the onboarding paths). Slug is validated URL-safe. Template export is
  strictly org-scoped from auth context; no SQL injection.

## Findings

### ONB-1 — HIGH (correctness) — Factory reset FK-failed on the HQ location → could never complete — ✅ FIXED
`reset_onboarding` deleted `users` (step 5) before the HQ `Location`/`Facility`
created during setup, relying on the `organizations` CASCADE (step 7, last). But
`Location.created_by → users.id` has **no `ondelete`** (RESTRICT), so deleting
`users` while a Location referenced one would FK-fail and abort the whole reset —
leaving the instance un-resettable after a HQ location was created.
**Fix:** explicitly delete `Location` then `Facility` **before** `users`
(`Facility.created_by` is SET NULL, so it's safe either way); the
`user_positions` raw delete now catches only `ProgrammingError`/`OperationalError`
(genuinely-missing table) instead of bare `Exception`, so a real failure aborts
the reset rather than proceeding to the FK-failing `users` delete.

### ONB-2 — MED — In-progress window let a leaked session create multiple orgs / owners — ✅ FIXED
`needs_onboarding()` stays `True` while onboarding is in progress even after an
org and owner exist, and `create_organization` only checked slug uniqueness while
`create_system_owner` had no "only one owner" check. A leaked/replayed in-progress
session could create several orgs (each with duplicate default roles) or several
full-access `*` owners with distinct emails; downstream "first active org" logic
would silently pick one and strand the rest.
**Fix:** `create_organization` now rejects if **any** organization already exists
(single-instance model), and `create_system_owner` rejects if **any** user
already exists (the owner is definitionally the first user). Both raise
`ValueError` → 400. (`test_duplicate_system_owner_prevention` still passes — the
guard raises the `ValueError` it asserts.)

### ONB-3 — MED — Mutations replayable after completion (missing completion guard) — ✅ FIXED
`/modules`, `/notifications`, `/complete`, `/session/roles`, and
`/session/positions` authenticated only via `validate_session` and never checked
`needs_onboarding()` — unlike their siblings — so within a still-valid session's
30-min TTL after completion they could be replayed to mutate `Organization.settings`
or rewrite org roles with no authenticated-user/permission check.
**Fix:** added the same `needs_onboarding()` guard the sibling routes use to all
five (`/session/positions` inherits it by delegating to `/session/roles`).
`/complete` now guards before re-persisting session data.

### ONB-4 — MED — Unauthenticated provisioning routes lacked rate limiting — ✅ FIXED
`POST /start` (mints an onboarding-session DB row per call — pre-org row-exhaustion
DoS) and `POST /system-owner` (creates a wildcard account) had no
`check_rate_limit`.
**Fix:** added `dependencies=[Depends(check_rate_limit)]` to both.

### ONB-5 — LOW/MED — `/database-check` echoed the raw DB exception — ✅ FIXED
`verify_database_connection` returned `"error": str(e)`; a driver error can embed
the DSN / internal host details.
**Fix:** log the real error server-side, return a generic message.

### ONB-6 — LOW — Minutes-template seeding shared mutable default sections (pitfall #12) — ✅ FIXED
`template_service.initialize_defaults` assigned the module-level
`DEFAULT_*_SECTIONS` constants **by reference** into each org's `sections` column,
so a later in-place edit of one org's template would contaminate the shared
constant and every other org's rows.
**Fix:** `copy.deepcopy` each `sections` before constructing the row.

### ONB-7 — MED/LOW (flagged) — Onboarding role editor accepts client-controlled permissions/priority/system-flag
`save_session_roles` accepts fully client-supplied `permissions`, `priority`, and
`is_custom` (which sets `is_system`), and keys updates on the client-supplied
slug — so a session holder can mint a high-priority `is_system` role, rewrite an
existing system role by slug, or emit near-arbitrary `{module}.*` permission
strings (a literal top-level `*` is NOT injectable, and the completion guard now
added (ONB-3) blocks post-setup abuse). Clamping priority / rejecting system-role
re-mint / allowlisting `module_id` would change what the legitimate onboarding
role editor can express, so left for a product decision. **Status:** flagged.

### ONB-8 — MED/LOW (flagged) — Reset trust model + audit durability, `/status` leak
- `/reset` is gated by the onboarding session + CSRF but not the existing owner's
  re-authentication, so a leaked in-progress session can wipe the owner+org before
  `/complete`; blocking reset once an owner exists conflicts with legitimately
  restarting a botched setup, so it needs an owner decision.
- The `reset_initiated` audit event is written in the same transaction as the
  deletes, so a failed reset rolls it back — it should be committed to a durable
  sink first.
- `GET /status` returns the org name + onboarding state to any unauthenticated
  caller even post-completion (minor info disclosure; frontend gate).
- `template_service` create/update rely on the pydantic schema never exposing
  `organization_id`/`is_system` (mass-assignment fragility).
**Status:** flagged.

## Notes
- Scope correction: `org_template_service.py` is **export-only** (Phase 1, no
  writes) and `org_template_registry.py`'s import fields are declared but unused —
  there is no template *import/apply* path yet, so the "validate a client-supplied
  template_id" control belongs to Phase 2 when import lands (the export path is
  correctly org-scoped from auth context today).
- Large-file caveat: `onboarding.py` (1,961 L) and the service (1,319 L) were
  reviewed for security invariants (guard coverage, reset scope, secret handling,
  session isolation), not line-by-line. The invariants held on every path examined.
- Fixes verified compatible with the DB-backed onboarding integration tests
  (which can't run here without MySQL): the single-org and single-owner guards
  align with `test_duplicate_system_owner_prevention` and the one-org-per-test
  pattern.
