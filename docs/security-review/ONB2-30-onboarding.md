# Security Review — Feature 30: Onboarding

**PR:** #1913 (guessed — corrected if wrong)
**Files:** `backend/app/api/v1/onboarding.py` (2,255 L, 20+ routes),
`backend/app/services/onboarding.py` (1,465 L), `backend/app/models/onboarding.py`,
`backend/app/utils/onboarding_security.py`, `backend/app/services/template_service.py`,
`backend/app/services/org_template_service.py`, `backend/app/services/org_template_registry.py`.

This is the single-instance tenant-provisioning flow — unauthenticated
bootstrap routes that create the very first organization, the first System
Owner (wildcard `it_manager`), roles, and a HQ facility, before any auth
exists. It has five prior review passes (2 module-audit iterations, 4
app-review passes), but **both prior docs explicitly say they reviewed the
endpoint/service files "for security invariants... not line-by-line"** due
to size. This pass did the line-by-line read they skipped, via two parallel
background agents (endpoint layer / service+model layer), with extra
scrutiny on the ~15%/~11% growth in each file since the last audit.

## Re-verification of prior findings

**No regressions.** ONB-1 (reset FK ordering), ONB-2 (single-org/single-owner
guards), ONB-3 (completion guard on `/modules`, `/notifications`, `/complete`,
`/session/roles`+`/positions`), ONB-4 (rate limiting on `/start`,
`/system-owner`), ONB-5 (generic DB-check error), ONB-6 (template deepcopy),
ONB-9 (guard on `/session/stations`, `/session/apparatus`), ONB2-1/ONB2-2
(E712 sweep) all hold exactly as documented. ONB-7 (role editor accepts
client-supplied permissions/priority/system-flag) remains accurately
described and unfixed — still a product-policy call, not a drive-by.

**One correction to the docs:** ONB-8's reset-re-authentication sub-item was
listed as open in both prior docs, but the code already fixes it — landed
2026-08-21 (commit `3d445eb2`), simply undocumented at the time. Once a
System Owner exists, `/reset` now requires the caller to be authenticated as
that exact owner (via `find_system_owner`) or the request 403s/409s.
Corrected in `docs/module-audit/onboarding.md`, `docs/app-review/onboarding.md`,
and `docs/KNOWN_LIMITATIONS.md` with a dated note.

## New findings

### ONB2-30-1 — HIGH — `ITTeamRequest.it_team` had no length cap or item schema — ✅ FIXED

Unlike every sibling collection in this file (`StationsRequest.stations`
capped at 50, `ApparatusListRequest.apparatus` capped at 100, both with an
explicit comment: "the cap exists so a malformed or hostile payload cannot
drive an unbounded write loop"), `it_team` was `list[dict[str, Any]]` with no
cap and no item typing. `POST /session/it-team` (unauthenticated except for
session validation) stores it into the session's JSON `data` verbatim; at
`/complete`, `create_it_team_users` loops every entry doing duplicate-email/
username DB lookups plus a password hash + `register_user()` call **per
entry** — turning one request into an unbounded amount of synchronous
password-hashing and DB work on the single most privileged bootstrap request
in the app.

**Fix:** added a typed `ITTeamMemberRequest` model (`name`/`email`/`phone`/
`role`, matching the frontend's actual shape and `create_it_team_users`'
expected keys) and capped `it_team` at `max_length=50`, same rationale as
`stations`/`apparatus`. `save_it_team` now `model_dump()`s each entry before
storing into the JSON column (pydantic model instances aren't
JSON-serializable — caught this while making the fix, not a pre-existing bug).

### ONB2-30-2 — HIGH/MED — `RolesSetupRequest.roles` / `PositionsSetupRequest.positions` had no length cap — ✅ FIXED

`save_session_roles` (no rate limit) iterates `data.roles` and calls
`db.add(new_role)` per item with no cap — immediate `Role` row creation, no
`/complete` step needed, same missing-cap class as ONB2-30-1 but writing
directly to the DB on a single POST.

**Fix:** `max_length=200` on both `RolesSetupRequest.roles` and
`PositionsSetupRequest.positions`. (The pre-existing, separately-flagged
"no dedup on `role.id` → `IntegrityError` → unhandled 500" issue is
unchanged — a bigger fix than a cap, left flagged per prior app-review notes.)

### ONB2-30-3 — LOW — Inconsistent post-completion guard coverage across `/session/*` — ✅ FIXED

ONB-3/ONB-9 added the `needs_onboarding()` replay guard to `/modules`,
`/notifications`, `/complete`, `/session/roles`+`/positions`,
`/session/stations`, `/session/apparatus`, and `/session/organization` — but
six of the twelve `/session/*` mutation endpoints never got it:
`/session/department`, `/session/email`, `/session/file-storage`,
`/session/auth`, `/session/it-team`, `/session/modules`. Impact today is
bounded (only `_persist_session_data_to_org`, called solely from `/complete`,
turns this session data into real org state, and `/complete` is itself
guarded) — but a stale/leaked session could indefinitely keep rewriting its
own encrypted secrets, and it's a landmine for any future tool that reads
onboarding session data.

**Fix:** added the same guard to all six, for consistency with the
established invariant.

### ONB2-30-4 — LOW/MED — All 7 rate-limited onboarding routes shared one `check_rate_limit` bucket — ✅ FIXED

`/start`, `/system-info`, `/security-check`, `/database-check`,
`/system-owner`, `/test/email`, and `/reset` all used bare
`Depends(check_rate_limit)`, sharing one `auth:{ip}` bucket (5 req/60s,
**30-minute lockout**) with each other and every other bare use of
`check_rate_limit` in the app — exactly the failure mode `check_rate_limit`'s
own docstring warns about. An admin retrying `/test/email` a few times fixing
an SMTP typo, or `/reset` after a validation error, could lock their IP out
of `/system-owner` or `/reset` for 30 minutes with no other way to complete
or restart bootstrap — a self-inflicted DoS on the one path that provisions
the whole instance.

**Fix:** one scoped wrapper per route (matching the established
`_rate_limit_admin_reset` pattern in `users.py`), same defaults, isolated
`scope=`.

### ONB2-30-5 — LOW — Undocumented `# noqa: E712` in `template_service.py` — ✅ FIXED

`MinutesTemplate.is_default == True` (×2, lines 299/309) carried an
undocumented `# noqa: E712` — a real, fixable Pitfall #10 violation the
prior ONB2-1/ONB2-2 E712 sweeps never reached (they only covered
`api/v1/onboarding.py`). Swept to `.is_(True)`.

### ONB2-30-6 — NIT — `"incidents"` was listed in both `ONBOARDING_SETTINGS_ONLY_MODULES` and `ONBOARDING_LEGACY_MODULES` — ✅ FIXED

`incidents` is a real current `ModuleSettings` field, so per
`ONBOARDING_LEGACY_MODULES`'s own docstring ("not ModuleSettings fields...
do not add to this list") it belongs only in `ONBOARDING_SETTINGS_ONLY_MODULES`.
Inert (the union in `ONBOARDING_ACCEPTED_MODULE_IDS` didn't change either
way, and `tests/test_onboarding_module_parity.py`'s only cross-list assertion
is `LEGACY ∩ OFFERED == ∅`), but it contradicted a stated, tested invariant.
Removed from `ONBOARDING_LEGACY_MODULES`.

### ONB-8 residual — template mass-assignment fragility — ✅ FIXED

`template_service.create_template`/`update_template` relied entirely on
`TemplateCreate`/`TemplateUpdate` never exposing `organization_id`/`is_system`
— safe today, fragile against a future schema change (flagged in both prior
docs). `create_template` now strips `organization_id`/`created_by`
defensively before `**tpl_dict`; `update_template` now routes through
`apply_updates(tpl, update_data, skip={"organization_id", "id", "created_by"})`
instead of a blind `setattr` loop — the established pattern, which also means
an explicit `null` against `name` (`NOT NULL`) now raises a clean 400 instead
of a flush-time `IntegrityError`.

## Still flagged, not fixed

- **ONB-7** — role editor accepts client-supplied permissions/priority/
  system-flag — product-policy decision, unchanged.
- **ONB-8 residual (audit durability)** — `reset_initiated` is written in the
  same transaction as `/reset`'s deletes, so a failed reset rolls back its own
  audit trail too. A transaction-boundary change, deferred for care rather
  than a drive-by.
- **Role/position dedup on `save_session_roles`** (pre-existing, app-review
  pass 2) — duplicate `role.id` in one payload still raises an unhandled
  `IntegrityError` → 500. Compounds ONB2-30-2's cap but is a distinct,
  larger fix.
- **`POST /organization` missing `except Exception`** its twin
  `/session/organization` has (pre-existing, app-review pass 2) — no
  info-leak (production `DEBUG=false`), just unlogged and inconsistent.
- **`ITTeamMemberRequest` uses `str` for `email`, not `EmailStr`** — kept
  loose intentionally, matching `create_it_team_users`' existing
  skip-if-invalid degrade-gracefully behavior rather than introducing a
  stricter rejection path in the same change.

Org-template import/apply path (Phase 2) confirmed still absent — no
regression; the export path remains correctly org-scoped.

## Completion gate

- `black --check` / `isort --check-only` / `flake8` on all changed files —
  clean.
- `python3 scripts/validate_migrations.py --strict` — passed (no schema
  change).
- `pytest tests/ -k "onboard or template_service"` — 106/106 passed.
- Full backend suite (`pytest tests/`) — 8962 passed, 22 skipped (all
  pre-existing Docker/optional-dependency skips), 0 failures.

---

## Follow-up pass (2026-08-27) — post-merge monitoring sweep

PR #1913 above had already merged when this pass started; the 30-minute
rotation monitor re-verified the feature's re-verification and did an
independent fresh read of the same files (unaware of the concurrent PR at
first — timing race, not duplicated effort by design). Confirmed
ONB2-30-1/2's caps and the ONB-8 reset re-auth / template mass-assignment
fixes are present and unchanged. Two items the original pass didn't reach:

### ONB2-30-7 — LOW — `validate_logo_image`'s error paths echoed raw exception text to an unauthenticated caller — ✅ FIXED

`backend/app/utils/image_validator.py`'s `validate_logo_image` catches
`ImageValidationError` and returns `f"Invalid image: {str(e)}"` on the 400
branch — safe for the library's own curated messages (size/dimension/format
checks), but four internal wrapping sites (`_decode_base64`,
`_validate_mime_type`, `_open_and_validate_image`, `_sanitize_image`) each
caught an arbitrary underlying exception and embedded its raw `str(e)`
_into_ the `ImageValidationError` message — so a Pillow internal error
during `image.load()`/`.save()` (buffer/format details, or a corrupted-file
parser error) reached the client verbatim through the very 400 branch meant
to be safe, never through the `except Exception` 500 fallback. The initial
fix in this PR only patched that 500 fallback (via `safe_error_detail`),
which a Codex review round correctly flagged as not covering the actual
reachable path — the regression test had mocked `validate_and_process`
directly, bypassing the four real wrapping sites entirely.

**Fix:** all four sites now log the real exception server-side
(`loguru.logger.warning`) and raise `ImageValidationError` with a fixed,
non-interpolated message — no internal exception text reaches the 400
branch either. Replaced the test with two that patch `Image.Image.load`/
`.save()` directly (exercising the actual wrapping code, not a bypass) and
assert the sensitive text set on the raised `OSError` doesn't appear in the
resulting `HTTPException.detail`.

### ONB2-30-8 — LOW (flagged) — Onboarding session TTL has no absolute cap, only a sliding 30-minute window

`validate_session` renews `expires_at` by another `SESSION_EXPIRY_HOURS`
(30 min) on **every** successful call. Three routes — `GET /system-info`,
`/security-check`, `/database-check` — call it with `require_csrf=False`,
so the **session id alone** (no CSRF token) is enough to keep sliding the
expiry forever by polling any of those three; there is no maximum age
tracked from session creation. (A Codex review round caught that the
initial write-up here cited `GET /session/data` as an example of this
bearer-only path — it isn't: that route uses the default `require_csrf=True`
and is not part of it. Corrected above and in `KNOWN_LIMITATIONS.md`.)
Capping absolute session lifetime is a policy choice (what should the cap
be, and should routine wizard navigation ever hit it) — flagged rather than
fixed. Also fixed in this pass: the model docstring claimed "2 hours," the
actual constant is 30 minutes (`backend/app/models/onboarding.py`).

## Completion gate (follow-up pass)

- `flake8` / `black --check` / `isort --check-only` on
  `app/utils/image_validator.py`, `app/models/onboarding.py`,
  `tests/test_image_validator.py` — clean.
- `pytest tests/test_image_validator.py` — 24/24 passed (3 new).
