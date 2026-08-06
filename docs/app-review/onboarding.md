# Application Review — Onboarding (Tier B, 2nd pass)

**Prefix:** `ONB2` · **Iteration:** B25 · **Reviewed:** 2026-08-06

**Backend:** `api/v1/onboarding.py` (1,961 L, 20 routes), `services/onboarding.py`
(1,319 L), org-template services
**Frontend:** `modules/onboarding`, `LoginPage`
**Prior audit:** `docs/module-audit/onboarding.md` (iteration 25) — ONB-1 (reset
FK), ONB-2 (multi-org/owner), ONB-3 (post-completion replay), ONB-4 (rate limit),
ONB-5 (DSN echo), ONB-6 (template deepcopy) fixed; ONB-7 (role editor), ONB-8
(reset trust + audit durability + `/status` leak) flagged.

---

## Scope

Tier B: the two flagged findings. The two catastrophic scenarios (post-completion
reset, second owner) are correctly blocked and were re-confirmed. One concrete
piece of ONB-8 (the `/status` info disclosure) was fixed; the rest of ONB-7/ONB-8
are product/robustness decisions.

## Findings

### ONB-8 (`/status` disclosure) — LOW — Unauthenticated `/status` leaked the org name post-completion — ✅ FIXED

`GET /onboarding/status` has no auth and returned `organization_name` plus the
setup progress (`current_step`, `steps_completed`) even when
`is_completed=True` — so any anonymous caller could read the department's name and
setup state off a fully-provisioned instance. The only consumer, `LoginPage`, reads
**just** `needs_onboarding` (to redirect an unconfigured install to `/onboarding`);
it never uses the org name or steps. **Fix:** once `is_completed` is True, `/status`
returns the minimal `needs_onboarding=False` response with `organization_name=None`
and empty progress. The in-progress branch is unchanged — the onboarding wizard
legitimately reads those back to resume before completion. **2 tests added**
(completed hides it; in-progress keeps it).

### ONB-8 (residual) — 🚩 FLAGGED (owner decision / robustness, unchanged)

- **Reset re-auth.** `/reset` is gated by the onboarding session + CSRF but not the
  existing owner's re-authentication, so a leaked in-progress session could wipe the
  owner+org before `/complete`. Blocking reset once an owner exists conflicts with
  legitimately restarting a botched setup — owner decision.
- **Audit durability.** The `reset_initiated` audit event is written in the same
  transaction as the deletes, so a failed reset rolls it back; it should commit to a
  durable sink first. A transaction-boundary change deferred for care.
- **Template mass-assignment fragility.** `template_service` create/update rely on
  the pydantic schema never exposing `organization_id`/`is_system`; an explicit
  strip/reject guard would be defense-in-depth against a future schema change.

### ONB-7 — MED/LOW — Onboarding role editor accepts client permissions/priority/system-flag — 🚩 FLAGGED (product decision)

`save_session_roles` accepts client-supplied `permissions`, `priority`, and
`is_custom` (→ `is_system`), keyed on the client slug — so a session holder can mint
a high-priority `is_system` role, rewrite a system role by slug, or emit
near-arbitrary `{module}.*` permissions (a literal top-level `*` is **not**
injectable, and ONB-3's completion guard blocks post-setup abuse, so the window is
the still-in-progress setup only). Clamping priority / rejecting system-role re-mint
/ allowlisting `module_id` would change what the legitimate onboarding role editor
can express — a product decision. Recorded in `KNOWN_LIMITATIONS.md`.

## Verified good ✅ (re-confirmed)

- ONB-1 (reset deletes Location/Facility before users), ONB-2 (single-org +
  single-owner guards), ONB-3 (completion guard on `/modules`, `/notifications`,
  `/complete`, `/session/roles`+`/positions`), ONB-4 (rate limit on
  `/start`+`/system-owner`), ONB-5 (generic DB-check error), ONB-6 (template
  `deepcopy`) all hold.
- No secrets in responses; 256-bit session id + 30-min DB expiry + CSRF; Argon2id
  owner password; `complete_onboarding` one-way latch.

## Documentation

`docs/module-audit/onboarding.md` updated: ONB-8 `/status` fixed; ONB-7 + ONB-8
residual stand.

## Future development

1. **ONB-8** — reset re-auth policy; commit the reset-initiated audit to a durable
   sink before the deletes; explicit mass-assignment guard on template create/update.
2. **ONB-7** — clamp/allowlist the onboarding role editor's permission/priority/
   system-flag inputs.

## Completion gate

| Check | Result |
|-------|--------|
| `flake8` (endpoint + test) | ✅ 0 violations |
| `black --check` | ✅ unchanged |
| `tsc --noEmit` | ✅ n/a — no frontend change (the login guard already reads only `needs_onboarding`) |
| backend tests | ✅ `test_onboarding_steps` **6 passed**; `test_onboarding_status_disclosure` **2 passed** (new). DB-backed onboarding integration tests need MySQL. |
