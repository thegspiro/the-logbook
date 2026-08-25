# Security Review — Auth & Session Lifecycle

**Prefix:** `AUTH` · **Iteration:** 01 · **Reviewed:** 2026-08-25 · **PR:** #TBD

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
