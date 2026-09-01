# Security Review — Auth & Session Lifecycle

**Prefix:** `AUTH` · **Iteration:** 01 · **Reviewed:** 2026-08-25 (pass 1), 2026-08-27 (pass 2), 2026-09-01 (pass 3) · **PR:** #1804 (pass 1), #1929 (pass 2)

---

## Pass 3 (2026-09-01)

**Diff since pass 2's baseline (`9a58e352`):** `auth.py` (+11/-4),
`consent_service.py` (+104/-4, all `roster()` — already reviewed and fixed in
pass 2, unchanged since), `models/user.py` (+124, all member-classification
work unrelated to auth — see the file's own `_reconcile_membership` docstring;
out of this feature's scope). `mfa_service.py` and `oauth_service.py` are
byte-identical to pass 2. Three frontend files touched since pass 2
(`authStore.ts`, `apiClient.ts`, `utils/createApiClient.ts`) — all three
diffs are already-landed fixes from other work (a `decodeURIComponent` on the
CSRF cookie reader, adding `/auth/mfa/login` to the refresh-skip allowlist so
an invalid MFA code doesn't trigger a refresh attempt, and a JSON-blob-decode
fix for file-download error responses); read and confirmed correct, not new
findings.

**Re-verified both prior fixes and the one flagged item, all still current:**

- **AUTH-1** (OAuth login skipped the organization-active check) — the fix is
  still in place: `oauth_service.py:50-60`'s `_link_existing_user` still
  filters `Organization.active.is_(True)` and fails closed with
  `(None, "no_account")` on an empty result. `test_resolve_user_no_active_organization`
  still passes.
- **AUTH-3** (stale photo-consent roster response could overwrite a newer one)
  — the `cancelled` guard is still present in
  `PhotoUseConsentPage.tsx:68-84`.
- **AUTH-4** (unbounded roster query, informational) — still accurate;
  `ConsentService.roster()` remains unpaginated for the same reason recorded
  in pass 2 (one of 255+ identically-shaped call sites app-wide; not a
  meaningful fix in isolation).

**Full re-read of all four in-scope backend files** (`auth.py` 1543 L / 26
routes — route count unchanged from pass 1, the +11 lines are one new import
and one line in `_build_current_user_dict` expanding legacy permission
aliases into the `/auth/me` and login-response permission list, unrelated to
this feature's own security surface and already correctly implemented in
`app/core/permissions.py`; `auth_service.py` 978 L; `mfa_service.py` 121 L;
`oauth_service.py` 340 L) against all seven checklist dimensions.

### Verified good ✅ (new this pass)

- **TOTP replay handling is intentionally asymmetric between login and
  already-authenticated MFA management, and the asymmetry is not a gap.**
  `mfa_login` uses `verify_totp_get_timestep`, which rejects a code whose
  time-step was already consumed (anti-replay, `mfa_service.py:42-75`).
  `mfa_verify_setup`, `mfa_disable`, and `mfa_recovery-codes` instead call
  plain `verify_totp` (no replay tracking). Traced the actual exposure rather
  than assuming from the asymmetry alone: all three of these routes require
  an already-authenticated session (`get_current_active_user`), so a replayed
  code buys an attacker nothing beyond what a single valid call already
  grants — `mfa_verify_setup` and `mfa_disable` are self-blocking against a
  second call in the same replay window (`current_user.mfa_enabled` flips, so
  the second call hits the router's own "already enabled" / "not enabled"
  400 before `verify_totp` is even reached again), and
  `mfa_recovery-codes` regenerating twice with the same code is
  idempotent-equivalent in risk to regenerating once. The login path's
  replay protection exists to stop a captured code completing a _second,
  independent_ authentication; none of the three management routes let a
  replay do anything a single legitimate call could not already do.
- **`security_monitor.detect_brute_force`/suspicious-IP wiring from the auth
  endpoints matches `SEC-00`'s documented brute-force model exactly**, traced
  from `auth.py` rather than re-deriving the tracker internals `SEC-00`
  already swept: `login` and `mfa_login` both feed
  `record_auth_failure`/`clear_auth_failures` (long-window, cross-account,
  per-IP) alongside `detect_brute_force` (short-window, per-IP/per-user), and
  `clear_auth_failures` is called only after full authentication succeeds —
  after the MFA branch on `login`, not on password-correct alone — matching
  the CLAUDE.md invariant that a leaked password for an MFA-protected account
  must not let an attacker zero the tally by itself.

### AUTH-5 — NIT — `validate-reset-token` docstring claimed the endpoint returns the email — ✅ FIXED (doc only)

**What:** `auth.py`'s `validate_reset_token` docstring said "Returns whether
the token is valid and the associated email," but the handler deliberately
returns only `{"valid": True}` — the inline comment directly above the
`return` even says why ("omit email to prevent user enumeration"). The
docstring and the code next to it disagreed.

**Where:** `app/api/v1/endpoints/auth.py` (the `validate_reset_token`
docstring, pre-fix).

**Failure scenario:** n/a — documentation accuracy only. Left as-is, a future
reader trusting the docstring over the code could add an email field to the
response believing one was already being returned and removed, reintroducing
the exact enumeration vector the comment next to `return` exists to prevent.

**Fix:** Docstring now states what the code does: validity only, email
intentionally omitted.

### AUTH-6 — INFORMATIONAL — Dead code in the suspicious-IP in-memory fallback contradicted its own invariant — ✅ FIXED

**What:** `_InMemoryFailureTracker.clear(ip)` in `app/core/suspicious_ip.py`
cleared **both** `self.failures` and `self.blocks` for an IP. It was never
called — `clear_auth_failures()` (the only place that resets a counter on
successful auth) calls `_memory_tracker.failures.pop(ip, None)` directly, not
`.clear()`. The module's own docstring and `clear_auth_failures`'s docstring
both state the invariant this class exists to enforce: "clearing never lifts
an active block" (mirrored in CLAUDE.md's Attack Protection table). The dead
`clear()` method did the opposite of that invariant.

**Where:** `app/core/suspicious_ip.py:117-119` (pre-fix).

**Why this matters even though it was never called:** an unused method whose
behavior contradicts a documented, load-bearing invariant is a landmine, not
neutral dead code — a future edit that "simplifies" `clear_auth_failures()` by
calling the conveniently-named `.clear()` instead of the two-line direct pop
would silently reintroduce exactly the bypass CLAUDE.md's Attack Protection
section calls out by name: "an attacker holding one leaked password... could
zero the tally at will." The Redis-backed path (`clear_auth_failures`'s
primary branch) never had an equivalent method to begin with — only `delete`
on the fail key, never touching the block key — so the in-memory fallback was
the only place this landmine existed.

**Fix:** Removed the unused method. `grep`-confirmed no caller anywhere in
`app/` or `tests/` (the one test file exercising this tracker,
`test_suspicious_ip_throttle.py`, resets state directly via
`_memory_tracker.failures.clear()` / `.blocks.clear()` — plain `dict.clear()`,
not the removed class method — so it required no change).

**Completion gate (pass 3):**

| Check                                                                   | Result                                                                |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                           | ✅ 0 violations                                                       |
| `black --check app/ tests/ alembic/`                                    | ✅ unchanged (1351 files)                                             |
| `isort --check-only app/ tests/ alembic/`                               | ✅ clean                                                              |
| `validate_migrations.py --strict`                                       | ✅ single head, 399 revisions                                         |
| backend tests (`-k "auth or mfa or oauth or consent or suspicious_ip"`) | ✅ 216 passed, 1 skipped (pre-existing, missing optional `pywebpush`) |
| `npm run typecheck` (native compiler wrapper)                           | ✅ 0 errors                                                           |
| `npx eslint .`                                                          | ✅ 0 errors/warnings (no frontend files touched this pass)            |

---

## Pass 2 (2026-08-27)

`git diff` between PR #1804's merge commit (`9a58e352`) and current `main`
shows **zero changes** to `auth.py`, `auth_service.py`, `mfa_service.py`, or
`oauth_service.py` — byte-identical. AUTH-1's fix
(`Organization.active.is_(True)` + fail-closed `(None, "no_account")` in
`oauth_service.py:57-77`) is confirmed still present, and its guard test
(`test_resolve_user_no_active_organization`) still passes. The route count is
unchanged at 26.

`consent_service.py` is the one file in this feature's scope that grew
(84 L → 211 L) since pass 1, entirely from a new "Photo Use Consent" feature
(commits `4b68b3da`, `d5bb37ce`, `fd3c797f` — a new `roster()` method, a new
`GET /users/consents/photo-use` endpoint in `users.py`, a new
`users.view_consents` permission, and a frontend `PhotoUseConsentPage.tsx`).
Read in full against all seven checklist dimensions, since none of it existed
at pass 1:

- **Tenant isolation (dim. 3):** `roster()` takes `organization_id` as a
  parameter and filters `User.organization_id` directly, plus a belt-and-
  suspenders `UserConsent.organization_id == organization_id` on the outer
  join condition (commented as "redundant against the org filter on User,
  kept so the join can never pull a row from another tenant"). Correct.
- **Authorization fit (dim. 2):** the endpoint's `require_permission` list
  (`users.view_consents`, `notifications.manage`, `members.manage`,
  `users.edit`) was deliberately built to avoid the XC-2 pattern this
  checklist watches for — the code comment explains why `users.view` (held by
  25 of 30 default positions) was rejected as too broad for a whole-department
  consent roster, and why the new narrow permission exists instead of
  widening an existing broad one. This is the checklist's own dimension-2
  concern, already reasoned through by the author.
- **Data exposure (dim. 5):** `roster()`'s docstring and code both explicitly
  exclude contact fields ("Returns no contact fields... a second list carrying
  it unconditionally would quietly undo [the member directory's
  contact-visibility gate]") — returns only name/rank/station/membership
  number/photo_url, which is what identifies someone on a photo call sheet.
  Caching: `/users` (no trailing slash) is already in `UNCACHEABLE_PREFIXES`
  and matches every consent sub-path via `startsWith` — no separate entry
  needed, verified by grep rather than assumed.
- **Fan-out helper `granted_user_ids`** (used by
  `notification_channels.resolve_sms_recipients`) does not itself filter
  `organization_id`, but its only caller passes an already org-scoped `users`
  list and the function can only _narrow_ that set (intersect with consent),
  never add ids beyond what the caller supplied — resolves through an
  already-org-scoped parent, not a gap.
- **Schema & migration integrity (dim. 7):** `ConsentType.PHOTO_USE` already
  existed at pass 1 (no model/column change needed); the new
  `20260825_1900_c4a91b7e2f08_grant_users_view_consents.py` migration is a
  seeded-grant backfill and does everything Pitfall #23 + #26 require: scoped
  to `is_system = True`, rewrites a row only when its stored permissions still
  exactly equal a frozen `_PRIOR_DEFAULTS` snapshot (so a department that
  already customized the position is left alone), guards on the `positions`
  table's existence before reflecting it (`create_all`-only table, Pitfall
  #26), and ships both `upgrade()` and a symmetric `downgrade()`.
- No `window.confirm`/`alert`/`prompt`, no direct `fetch`/raw `axios` in
  `PhotoUseConsentPage.tsx` (grep-confirmed — it goes through the shared
  service layer feature 34 already reviewed).

**Correction (Codex review on PR #1929):** the "no findings" conclusion above
was wrong on two counts, both raised by Codex against `PhotoUseConsentPage.tsx`
and `consent_service.py`.

### AUTH-3 — LOW — Stale roster response could overwrite a newer one — ✅ FIXED

**What:** `PhotoUseConsentPage.tsx`'s `loadRoster` fired a new
`getPhotoUseConsentRoster(includeInactive)` request on every change to the
`includeInactive` toggle with no cancellation or staleness check. Toggling the
checkbox twice in quick succession (check, then uncheck before the first
request resolves) let the two requests resolve out of order; whichever
response landed last overwrote `roster` via `setRoster`, regardless of whether
it still matched the toggle's current value.

**Where:** `frontend/src/modules/communications/pages/PhotoUseConsentPage.tsx`
(the `useEffect`/`loadRoster` pair).

**Failure scenario:** a PIO toggles "Include inactive members" on and then
immediately back off while choosing photos. If the first (checked) request is
slow and resolves after the second (unchecked) one, the roster silently
reverts to including inactive members — with the checkbox itself showing
unchecked, a display state inconsistent with what's on screen. Each member's
own `granted`/`declined` value is unaffected (the race is only over which
members appear, not their consent state), but the page is documented as "the
operational enforcement point" for photo consent, so a PIO trusting the
checkbox to reflect what's listed is a real, if narrow, correctness bug.

**Fix:** moved the fetch into the `useEffect` body with the codebase's
existing `let cancelled = false` / cleanup-sets-`cancelled=true` idiom (same
pattern as `PipelineDetailPage.tsx`), so a response belonging to a superseded
effect run is never applied to state.

**Guard test:** `ignores a stale response that resolves after a newer request
for a different toggle state` in `PhotoUseConsentPage.test.tsx` — two requests
in flight, the older one resolved last; asserts the newer request's roster
wins. Verified to fail against the pre-fix component (confirmed by stashing
the fix and re-running) and pass against it.

### AUTH-4 — INFORMATIONAL — Unbounded roster query, flagged not fixed

**What:** `ConsentService.roster()` has no `LIMIT`/pagination and materializes
every matching member with `result.all()`; `GET /users/consents/photo-use`
passes that straight through. Checklist dimension 6 names "no `all()` over an
org-wide table" as a pattern to catch.

**Where:** `backend/app/services/consent_service.py:118-143`.

**Why flagged, not fixed:** this is not a defect unique to the new code —
grepping `select(User` across `app/` finds **255+ other call sites** with the
identical unbounded shape (`/officers`, the base `/users` list, and most other
whole-department rosters). The application's own scale assumption throughout
is a single fire department's membership (tens to a few hundred rows), not an
org-wide table that grows without bound the way `audit_logs` or
`message_history` do — dimension 6's concern is real for those, and this
codebase already bounds or paginates them. Adding a `LIMIT` to this one new
endpoint while its 255 siblings stay unbounded would be an arbitrary,
inconsistent fix, not a security improvement. Recorded here for awareness
rather than actioned as a drive-by; a genuine fix would be an app-wide
pagination pass, out of scope for this iteration.

**Completion gate (pass 2, after AUTH-3):** flake8/black/isort clean on `app/
tests/ alembic/`; `validate_migrations.py --strict` passed (381 revisions,
single head); scoped backend tests (`-k "oauth or auth_service or mfa or
consent"`) 70 passed, 1 skipped (pre-existing, missing optional dependency);
`tsc --noEmit` 0 errors; `eslint .` 0 errors (1 file, 0 warnings);
`PhotoUseConsentPage.test.tsx` 7/7 passed (1 new).

---

## Pass 1 (2026-08-25)

**Backend:** `app/api/v1/endpoints/auth.py` (1405 L, 26 endpoints),
`app/services/auth_service.py` (970 L), `app/services/mfa_service.py` (121 L),
`app/services/oauth_service.py` (327 L), `app/services/consent_service.py`
(84 L), `app/models/consent.py`
**Frontend:** `stores/authStore.ts`, `services/apiClient.ts`,
`utils/createApiClient.ts`, login/MFA pages
**Migrations:** `20260801_0019_add_user_consents.py` (consent table)

---

## Scope

This feature already carries two prior application-review passes
(`docs/app-review/auth-session.md`, 2026-08-05 and 2026-08-08) that did a
six-lens sweep and a full 25/26-endpoint auth-dependency enumeration. This
iteration does **not** re-derive that work. It re-verifies a sample of the
prior claims against current code (auth-dependency spot-check across 5 routes,
both public and private) and applies full weight to the checklist dimensions
those passes covered lightly: tenant isolation, injection/untrusted output,
data exposure, abuse resistance, and schema/migration integrity. All 5 backend
files and the frontend auth surfaces were read in full or by targeted grep;
nothing was sampled without a stated reason.

`git log` for these files could not be trusted to date changes since
2026-08-08 (history for this path appears to have been squashed/rewritten —
the earliest dateable commit touching these files is 2026-08-21). `CHANGELOG.md`
was used as the dating source of record instead and cross-checked against the
current code for every claim below.

## Route inventory

Full enumeration (26 routes, not the 25 the prior pass recorded —
`GET /captcha-config` was omitted from that count; see AUTH-2).

| Method | Path                        | Auth dependency                 | Permission       | Org-scoped | Notes                                                  |
| ------ | --------------------------- | ------------------------------- | ---------------- | ---------- | ------------------------------------------------------ |
| GET    | `/branding`                 | none                            | n/a              | n/a        | public, no secrets exposed                             |
| GET    | `/captcha-config`           | none                            | n/a              | n/a        | public, site key only (not the secret)                 |
| GET    | `/oauth-config`             | none                            | n/a              | n/a        | public, provider-enabled flags only                    |
| GET    | `/oauth/google`             | none                            | n/a              | n/a        | public, initiates redirect                             |
| GET    | `/oauth/google/callback`    | none                            | n/a              | n/a        | public, state verified via `compare_digest`            |
| GET    | `/oauth/microsoft`          | none                            | n/a              | n/a        | public, initiates redirect                             |
| GET    | `/oauth/microsoft/callback` | none                            | n/a              | n/a        | public, state verified via `compare_digest`            |
| POST   | `/register`                 | none                            | n/a              | n/a        | rate-limited; 403 unless `REGISTRATION_ENABLED`        |
| POST   | `/login`                    | none                            | n/a              | n/a        | rate-limited + `enforce_suspicious_ip`                 |
| POST   | `/mfa/login`                | none (pre-auth MFA token)       | n/a              | n/a        | rate-limited; token-scoped                             |
| POST   | `/mfa/setup`                | `get_current_active_user`       | self             | self       | —                                                      |
| POST   | `/mfa/verify-setup`         | `get_current_active_user`       | self             | self       | rate-limited                                           |
| POST   | `/mfa/disable`              | `get_current_active_user`       | self             | self       | rate-limited                                           |
| GET    | `/mfa/status`               | `get_current_active_user`       | self             | self       | —                                                      |
| POST   | `/mfa/recovery-codes`       | `get_current_active_user`       | self             | self       | rate-limited                                           |
| GET    | `/mfa/policy`               | `get_current_active_user`       | self             | org        | —                                                      |
| PUT    | `/mfa/policy`               | `get_current_active_user`       | admin permission | org        | —                                                      |
| POST   | `/refresh`                  | none (refresh token via cookie) | n/a              | n/a        | rate-limited; org-active check (`auth_service.py:382`) |
| POST   | `/logout`                   | `get_current_user`              | self             | self       | —                                                      |
| GET    | `/me`                       | `get_current_active_user`       | self             | self       | —                                                      |
| GET    | `/session-settings`         | `get_current_user`              | self             | self       | —                                                      |
| POST   | `/change-password`          | `get_current_active_user`       | self             | self       | rate-limited                                           |
| GET    | `/check`                    | none (cheap probe)              | n/a              | n/a        | intentionally minimal, no full permission build        |
| POST   | `/forgot-password`          | none                            | n/a              | n/a        | rate-limited; enumeration-safe                         |
| POST   | `/reset-password`           | none                            | n/a              | n/a        | rate-limited; SHA-256 token lookup                     |
| GET    | `/validate-reset-token`     | none                            | n/a              | n/a        | rate-limited; returns `{"valid": bool}` only           |

11 public / 15 private. Every private route carries `get_current_user` or
`get_current_active_user`; both admin-scoped routes (`/mfa/policy` PUT, and
admin MFA reset / consent listing which live in `users.py`, out of this
feature's file scope) additionally org-scope the target by id.

## Verified good ✅

- **Auth-dependency spot-check (5 routes sampled, public and private) still
  matches the prior enumeration.** `/branding` and `/login` remain
  unauthenticated by design; `/me`, `/change-password`, `/session-settings`
  all carry `get_current_user`/`get_current_active_user`. No drift.
- **Tenant isolation on consent data.** `UserConsent` (`models/consent.py:41`)
  has `organization_id` and `user_id` both `NOT NULL` with `ondelete="CASCADE"`
  — matches its migration exactly, no drift. The admin-facing consent listing
  and admin MFA reset (in `users.py`, adjacent to this feature) org-scope the
  by-id target before acting, and MFA reset enforces a privilege ceiling and
  blocks self-reset. (Read as supporting context; full review of `users.py`
  itself is feature 07 in the rotation, not re-litigated here.)
- **No injection surface.** Zero raw SQL and zero `.like()`/`.ilike()` calls in
  any of the 5 in-scope files (grep-confirmed) — Pitfall #25 does not apply to
  this feature. OAuth state and TOTP/recovery-code comparisons use
  `secrets.compare_digest`; redirect targets are server config, never
  client-supplied — no open-redirect vector. `reason` codes passed through
  `_oauth_fail_redirect` are a fixed short enum, never raw user input.
- **No unbounded in-memory caches** in these 5 files (Pitfall #9 n/a here —
  the actual rate-limit/suspicious-IP trackers live in `security_middleware.py`
  / `suspicious_ip.py`, out of this feature's scope and already audited via the
  `get_client_ip` sweep in the prior pass).
- **Data exposure remains clean.** `validate_reset_token` returns
  `{"valid": bool}` only; tokens are never placed in JSON bodies (httpOnly
  cookies only, per `_set_auth_cookies`); the reset link uses a URL fragment,
  not a query param, to keep the token out of Referer headers and access logs.
  Frontend `authStore.ts` writes only a `has_session` boolean flag to
  `localStorage` — grep confirms no token writes, and the only reads of the
  legacy token keys are one-time cleanup code that removes them. No
  `window.confirm`/`alert`/`prompt` anywhere in the auth frontend surfaces.
- **Rate limiting still covers every credential-guessing path**: login, MFA
  login, MFA verify-setup/disable/recovery-codes, refresh, change-password,
  register, and all three reset routes each carry a `rate_limit_*` dependency.
- **Schema/migration integrity.** `consent.py`'s FKs are `ondelete="CASCADE"`
  with `nullable=False` — not a `SET NULL` case, so Pitfall #2 doesn't apply;
  the migration matches the model column-for-column, including the
  `(user_id, consent_type)` unique index. No drift.

## Findings

### AUTH-1 — MED — OAuth login skipped the organization-active check — ✅ FIXED

**What:** `oauth_service._link_existing_user` scoped its org lookup to the
earliest-created organization with no `active` filter, and — when that lookup
came back empty — dropped the org filter from the user query entirely instead
of failing closed.

**Where:** `app/services/oauth_service.py:50` (pre-fix).

**Failure scenario:** The 2026-08-12 hardening pass added
`Organization.active.is_(True)` to the password-login path
(`auth_service.authenticate_user`), specifically so members of a deactivated
organization can no longer sign in with a password. The OAuth path was never
given the same filter — tracked as an open MED item in
`docs/KNOWN_LIMITATIONS.md` since that date. A member of a deactivated
organization whose account is Google- or Microsoft-linked could still sign in
via OAuth, bypassing the exact control password login now enforces. Worse: had
the org lookup ever come back empty for any reason (not just deactivation —
e.g. an empty `organizations` table in a fresh/test environment), the code
dropped the `organization_id` filter from the user query altogether, so the
email-match query would have matched a user in **any** organization — a
tenant-isolation gap (dimension 3), not just an availability one.

**Impact:** Deactivating an organization is expected to lock out all of its
members; OAuth-linked members retained access. In the empty-org-table edge
case, the missing filter could also have crossed a tenant boundary.

**Fix:** The org lookup now carries `.where(Organization.active.is_(True))`,
and an empty result returns `(None, "no_account")` immediately — the same
indistinguishable error password login's candidate-empty case produces,
preserving the enumeration-avoidance convention this file already follows
elsewhere. This removes both the deactivated-org bypass and the fail-open path
on an empty lookup. Mirrors `auth_service.authenticate_user`'s existing,
already-tested pattern exactly, rather than inventing a new one.

**Guard test:** `test_resolve_user_no_active_organization` in
`backend/tests/test_oauth_service.py` — asserts the org query text contains
`organizations.active IS true`, and that a missing active org returns
`(None, "no_account")` without ever issuing the user-lookup query (so a
regression back to the fail-open path fails this test rather than merely
returning a wrong-but-harmless result).

### AUTH-2 — NIT — Prior review's route count and M2 claim had drifted from current code — ✅ FIXED (docs only)

**What:** `docs/app-review/auth-session.md` (2026-08-08 pass) stated 25
endpoints (10 public / 15 private) and listed the 2026-08-08 refresh-grace-
window fix as still intact. Neither matches current code: there are 26 routes
(`GET /captcha-config` was omitted from the original count — it is correctly
public, exposing only a CAPTCHA site key, so this was a documentation gap, not
a security bug), and the refresh grace window was intentionally removed on
2026-08-12 (CHANGELOG, same date) because it was itself a replay-window
vulnerability — a stale token now revokes the whole session immediately, with
no grace fallback.

**Where:** `docs/app-review/auth-session.md`.

**Failure scenario:** n/a — documentation accuracy only. Left uncorrected, a
future reviewer re-verifying "M2 fix intact" against current code would either
report a false claim as re-confirmed, or waste time reconciling a described
mechanism that no longer exists.

**Fix:** Added a "Pass 3" correction section to `auth-session.md` recording
both drifts and pointing to this file for AUTH-1.

## Schema & migration notes

`consent.py` / `20260801_0019_add_user_consents.py` — no drift, both FKs
`ondelete="CASCADE"` + `nullable=False` (not a `SET NULL` case), unique index
matches. No other migration touches this feature's tables since the last pass.

## Guard tests added

- `test_resolve_user_no_active_organization` (`test_oauth_service.py`) — fails
  if the OAuth org lookup ever drops the `active` filter or stops failing
  closed on an empty result.

## Completion gate

| Check                                         | Result                                  |
| --------------------------------------------- | --------------------------------------- |
| `flake8 app/ tests/ alembic/`                 | ✅ 0 violations                         |
| `black --check app/ tests/ alembic/`          | ✅ unchanged                            |
| `isort --check-only app/ tests/ alembic/`     | ✅ clean                                |
| `validate_migrations.py --strict`             | ✅ single head                          |
| backend tests (scoped: oauth/auth/active-org) | ✅ 22 passed                            |
| `tsc --noEmit`                                | ✅ 0 errors (no frontend files touched) |
| `eslint .`                                    | n/a — no frontend files touched         |
