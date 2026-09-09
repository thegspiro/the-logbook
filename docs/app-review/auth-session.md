# Application Review — Auth & Session Lifecycle

**Prefix:** `AUTH` · **Iteration:** A2 · **Reviewed:** 2026-08-05 (pass 1),
2026-08-08 (pass 2), 2026-09-09 (pass 5)

## Pass 5 (2026-09-09) — the lockout counter, one layer up from AUTH-9/AUTH-13

**1 fixed (MED), 1 flagged (LOW).** The concurrency lens that produced AUTH-9
and AUTH-13 was applied to the two auth paths those findings did _not_ cover:
the password step and the refresh rotation. Both carry the same unlocked
read-then-write shape. The password one is fixed and its race reproduced; the
refresh one is flagged.

> **Finding ids here start at AUTH-20 because the `AUTH-` prefix is shared with
> the security-review track**, which allocated AUTH-1 … AUTH-19 in
> `docs/security-review/AUTH-01-auth-session.md`. The two have **already
> collided**: this file's AUTH-2, AUTH-3, AUTH-14 and AUTH-15 are not the
> security review's AUTH-2/3/14/15. An `AUTH-n` reference is therefore only
> unambiguous with the file that owns it. Numbering above the shared
> high-water mark avoids adding to the mess; **giving one track a distinct
> prefix is the actual fix and is an owner call** — the same structural problem
> was recorded for `SF-` in `storefront.md` on the same day, so it is not
> specific to this feature.

### AUTH-20 — MED — Concurrent wrong passwords are counted once, diluting the account lockout — ✅ FIXED

**What:** `AuthService.authenticate_user` counted a failed sign-in by reading
`failed_login_attempts` off the `user` object that the **unlocked** `candidates`
query loaded (`auth_service.py:128`), adding one, and committing
(`:218`, `:230`). A read-modify-write on the very field the lockout threshold is
measured against, with no row lock.

**Where:** `backend/app/services/auth_service.py:218` (the increment), against
the unlocked load at `:128`.

**Impact:** N simultaneous wrong-password requests all read the same committed
counter, all write `value + 1`, and the account absorbs N guesses for the price
of one increment. **Per-IP rate limiting does not cover this.** Account lockout
is the layer that exists for the _distributed_ case — many sources, one account
— where each source stays under its own per-IP limit and the per-account tally
is the only thing that can see the total. Diluting that tally by the attacker's
concurrency factor is a direct weakening of the control CLAUDE.md's
attack-protection table names as the second of four layers, on a system holding
PHI.

Calibrated honestly: this is a **weakening, not a bypass**. The account still
locks eventually — just after roughly N× more guesses. That is why it is MED and
not the P1 that AUTH-9 and AUTH-13 (single-use-code replay → independent
session) carried.

**Reproduced, not argued.** `tests/test_auth_lockout_race.py` drives two real,
independently-committing `AsyncSession`s through `authenticate_user` with the
wrong password and asserts the stored counter is 2. Against the unfixed code it
fails with `recorded 1 failure(s), not 2`. The race is deterministic rather than
lucky because Argon2 is deliberately slow: both requests resolve the account and
read the counter, then both spend ~100–300 ms hashing before either writes, so
the overlap is the whole verify rather than a narrow window.

**Fix:** a `.with_for_update().execution_options(populate_existing=True)` re-read
inside the failure branch, then increment the locked row — the identical remedy
`_verify_and_consume_totp` (AUTH-9) and `_verify_and_consume_recovery_code`
(AUTH-13) already carry one layer up, including the `populate_existing`
requirement that `expire_on_commit=False` forces.

**The lock's placement is load-bearing and is asserted separately.** It sits
_inside_ the failure branch, after the verify. Taking it before would hold a user
row for the ~100–300 ms of every Argon2 hash, serializing that account's logins
and handing an attacker a cheaper denial of service than the counter defends
against. `test_the_lock_is_not_taken_around_the_password_verify` fails if the
lock ever moves above the verify.

**Related, deliberately not changed:** `mfa_login` reaches the same counter at
`auth.py:946` and _is_ covered, because both `_verify_and_consume_totp` and
`_verify_and_consume_recovery_code` take the lock before returning False. The
one path that reaches the increment unlocked is a request supplying **neither**
`code` nor `recovery_code` — `MFALogin` (`schemas/auth.py:195`) marks both
`Optional` with no cross-field validator. That path is not a guess, so diluting
its count gains an attacker nothing, and the obvious tightening (a validator
requiring one of the two) changes a public auth endpoint's response from 401 to
422 for existing clients. Recorded rather than changed.

### AUTH-21 — LOW — A double-fired refresh can revoke every session the member has — 🚩 FLAGGED

**What:** `refresh_access_token` looks the session up by refresh token with a
plain `SELECT` (`auth_service.py:382`) and then rotates `session.refresh_token`
in place (`:441`). Two concurrent refreshes presenting the **same** valid token
both find the row and both write; last writer wins.

**Where:** `backend/app/services/auth_service.py:382` → `:441`.

**Impact:** the loser's client holds a refresh token that is no longer in the
database. Its next refresh matches no session, which `:387` correctly treats as
replay — and the response to replay is `_revoke_all_user_sessions`. So a benign
double-fire logs the member out of **every** device, with the audit trail saying
token theft. Fails closed, which is why this is LOW rather than higher, but the
failure is user-visible and misattributed.

The frontend's shared `refreshPromise` (CLAUDE.md, auth patterns) prevents this
within one tab. It is per-tab state, so two tabs sharing one cookie jar are the
realistic trigger.

**Not reproduced** — unlike AUTH-20 this is reasoned from the code path, not
demonstrated with two sessions. Stated plainly so the next reader does not
inherit it as verified.

**Fix — not applied.** A locking read on the session row closes it, but this is
the hottest path in the auth surface and every request that outlives an access
token passes through it; adding a row lock there is a performance decision on an
authentication path, not a mechanical fix. Options: **(a)** lock the session row
for the rotation; **(b)** make the rotation a conditional `UPDATE … WHERE
refresh_token = :presented` and treat zero affected rows as "already rotated by
a concurrent request", which needs no lock and distinguishes a benign double-fire
from a genuine replay; **(c)** accept it and narrow the blast radius by revoking
only the one session rather than all of them. (b) is the most promising and the
most invasive. Mirrored into `KNOWN_LIMITATIONS.md`.

### Re-verified this pass, all still open

- **AUTH-15** (security review) — the HIPAA maximum password age is still
  browser-only. `auth_service.py:286` logs a warning and lets the login proceed;
  `auth.py:1403` hands the number to the client to enforce. Unchanged.
- **AUTH-17** (security review) — session rows are still never reaped. The only
  `delete(UserSession)` is `_revoke_all_user_sessions`, scoped to one user
  (`auth_service.py:475`); nothing deletes on expiry, so expired rows keep a
  member's IP and user-agent indefinitely.
- **`previous_refresh_token` / `previous_refresh_expires_at` are still dead.**
  Written to `None` at `auth_service.py:438`, read by nothing, columns still
  present (`models/user.py:860`). Still the LOW cleanup item
  `KNOWN_LIMITATIONS.md` records; dropping the columns needs a migration, which
  is out of this iteration's remit.
- **`/check` still has no production caller.** `authService.checkAuth`
  (`frontend/src/services/authService.ts:159`) is referenced only by its own
  test. Left in place, matching pass 4's decision: the frontend wrapper and the
  backend route are a pair, and removing only the wrapper reduces nothing while
  removing the route is an API-surface decision.

### Pass 5 scope

Read this pass: `authenticate_user` and the whole failed/locked/dummy-verify
branch set, the session-creation and refresh-rotation paths, `mfa_login` with
both of its consume helpers, and the `MFALogin` schema. Re-verified by grep
rather than full re-read: the four open items above.

**Not re-read**, and carrying no pass-5 verdict: OAuth initiate/callback,
`consent_service`, `register`, password reset, and the frontend auth store —
all covered by passes 1–4 and by the security-review track's 19 findings, none
of which this pass had reason to disturb.

### Pass 5 completion gate

| Check          | Result                                                |
| -------------- | ----------------------------------------------------- |
| tsc --noEmit   | ✅ 0 errors                                           |
| flake8         | ✅ 0 violations (`app/ tests/`)                       |
| black --check  | ✅ clean                                              |
| eslint         | ✅ 0 errors, 2 pre-existing warnings (limit 10)       |
| frontend tests | n/a — no frontend file changed this pass              |
| backend tests  | ✅ **full suite** 11,922 passed, 21 skipped, 0 failed |

`authenticate_user` is reached by most of the backend suite, so this pass ran
the whole thing rather than the auth slice (433 passed on its own). The 21 skips
are the Docker-integration tests (no daemon here) and `test_push_service.py`
(optional `pywebpush`). ESLint is carried from earlier in this working tree —
no frontend file changed this pass.

## Pass 4 (2026-09-08) — security-review AUTH pass 4 — see AUTH-01

Two further corrections to the record below, both documentation-only:

- **The route split is 14 public / 12 private, not 10/15 (below) or 11/15
  (the pass-3 note that follows).** The public set is exactly the 14 `auth.py`
  entries in `ALLOWLISTED_PUBLIC` in
  `backend/tests/test_endpoint_auth_coverage.py`, which is machine-checked in
  both directions; the full inventory is in the pass-4 section of
  [`docs/security-review/AUTH-01-auth-session.md`](../security-review/AUTH-01-auth-session.md).
- **"No dead endpoints" is no longer true of `/check`.** `authService.checkAuth`
  is the sole wrapper and now has zero call sites in `frontend/src` outside
  its own declaration and its test. The route itself is harmless.

Pass 4's two new findings — a `must_change_password` + `mfa_required` lockout
(**AUTH-14**, fixed) and the browser-only enforcement of the HIPAA maximum
password age (**AUTH-15**, flagged) — are written up in that same file.

## Pass 3 (2026-08-25) — security-review AUTH re-verification — see AUTH-01

Re-verified against current code as part of the application-wide security
rotation (`docs/security-review/AUTH-01-auth-session.md`). Two corrections to
the record below, plus one new fix:

- **The M2 "refresh grace window" this doc calls intact was removed on
  2026-08-12**, deliberately — CHANGELOG 2026-08-12 explains it was itself a
  replay-window vulnerability. `refresh_access_token` (`auth_service.py:317`)
  now revokes the whole session on any refresh-token mismatch with no grace
  fallback; `previous_refresh_token`/`previous_refresh_expires_at` are cleared
  every rotation and read by nothing (tracked as a LOW cleanup item in
  `docs/KNOWN_LIMITATIONS.md`). Net effect is a stronger security posture; this
  doc's "M2 fix intact" bullet below is superseded and should not be
  re-verified as still describing current behavior.
- **Route count is 26 (11 public / 15 private), not 25 (10/15).**
  `GET /captcha-config` (`auth.py:249`) is public and was omitted from the
  original enumeration below — it only exposes a public CAPTCHA site key, so
  this is a doc-completeness gap, not a security bug.
- **AUTH-1 — OAuth login skipped the organization-active check — ✅ FIXED**,
  see `docs/security-review/AUTH-01-auth-session.md`.

Everything else re-verified clean: all 5 sampled routes (mix of public/private)
still match this doc's auth-dependency claims; no raw SQL/LIKE, no unbounded
in-memory caches, no schema/migration drift in `consent.py`, and the frontend
auth store/API clients remain httpOnly-cookie-only with no `window.confirm`.

## Pass 2 (2026-08-08) — six-lens sweep — no code change

Re-verified this heavily-hardened surface: **every pass-1 fix holds** — M1
forced-Secure cookies, M2 refresh grace window, M3 dummy-verify on all three
enumeration branches (incl. the locked-account path), H3 TOTP replay + lockout,
H5/AXC-1 `get_client_ip` everywhere (no `request.client.host`), AUTH-1 (session
rows + login/reset audits use `get_client_ip`), AUTH-2 (SMS gated on consent, email
unconditional), SHA-256 reset tokens, JWT `algorithms=["HS256"]` + `require:["exp"]`,
`compare_digest` on OAuth state / TOTP / recovery codes. The six lenses found **no
verified bug**: no blind `setattr` onto a protected field, no cross-user/cross-org
write by id (logout/consent/MFA all self-scoped), no enumeration branch skipping
dummy-verify, no rate-limit-skipping credential path, no unguarded token-parse → 500.

**2 informational flags (not fixes):** `oauth_service._link_existing_user` picks the
oldest org via `order_by(created_at)` without an `active` filter (single-org-benign;
would only mis-scope if the oldest org were deactivated while a newer active one
existed) and `forgot_password` constructs `AuthSettings(**org_settings["auth"])`
with no try/except (a malformed _admin-written_ config could 500 a public endpoint,
but `extra="ignore"` means extra keys don't raise — availability-only, not
attacker-controllable). **No code changed** — the verifications are the deliverable.

---

**Backend:** `app/api/v1/endpoints/auth.py` (1405 L, 25 endpoints),
`app/services/auth_service.py` (970 L), `app/services/mfa_service.py` (121 L),
`app/services/oauth_service.py` (327 L), `app/services/consent_service.py` (84 L),
`app/models/consent.py`
**Frontend:** `stores/authStore.ts`, `services/apiClient.ts`,
`utils/createApiClient.ts`, login/MFA pages
**Docs:** `docs/MFA.md`, `SECURITY.md`,
`docs/security/RED_TEAM_REVIEW_2026-07.md`

---

## Scope

All 25 endpoints enumerated for auth dependency and rate limiting. Read: cookie
issuance, login/MFA-login, refresh rotation, password reset, OAuth callback
handling, and the consent service in full.

The **security** surface here was already covered in depth by the
[July red-team review](../security/RED_TEAM_REVIEW_2026-07.md), whose H1–H5,
M1–M11 and L1–L9 findings are recorded as remediated. This pass **re-verified a
sample of those fixes rather than re-deriving them** (results below) and applied
the broader review lens. The one item the red team left open (M6, CAPTCHA on
public forms) belongs to the forms feature, not here.

## Verified good ✅

- **Auth coverage: 25/25 endpoints correct.** The 10 unauthenticated routes are
  unauthenticated _by necessity_ (`/branding`, `/oauth-config`, the four OAuth
  initiate/callback routes, `/register`, `/login`, `/mfa/login`,
  `/forgot-password`, `/reset-password`, `/validate-reset-token`); every other
  route carries `get_current_user` or `get_current_active_user`.
- **Rate limiting covers every credential-guessing path**: login, MFA login,
  MFA verify-setup/disable/recovery-codes, refresh, change-password, register,
  and all three password-reset routes. No unlimited credential endpoint.
- **Self-registration is disabled by default** (`REGISTRATION_ENABLED=false`)
  and returns 403 before touching the DB, with an optional approval flow.
- **Cookie issuance is correct (M1 fix intact)** — `_set_auth_cookies`
  (`auth.py:67`) sets `httponly=True`, `samesite="strict"`, and forces
  `secure=True` in production/staging so a stray `http://` entry in
  `ALLOWED_ORIGINS` cannot silently downgrade session cookies. Tokens are never
  placed in the JSON body.
- **Password-reset tokens are hashed at rest.** The raw token is SHA-256'd and
  only the digest is stored and looked up (`auth_service.py:843/870/909`), so a
  DB read cannot be replayed into an account takeover. SHA-256 is the right
  primitive here — the token is high-entropy random, not a password.
- **Username enumeration is defended (M3 fix intact)** — a dummy Argon2 verify
  runs on the unknown-user, no-password-hash, _and_ locked-account branches
  (`auth_service.py:167/174/208`), so all three take the same time as a real
  verify. The locked-account branch is the subtle one and it is handled.
- **MFA hardening is intact (H3 fix)** — consumed TOTP steps are recorded and
  rejected as replays (`mfa_service.py:73`), and a failed second factor counts
  toward the account lockout rather than leaving MFA guessable at the per-IP
  limit alone (`auth.py:744`).
- **Refresh rotation has a grace window (M2 fix intact)** —
  `auth_service.py:350` falls back to `previous_refresh_expires_at`, so a
  concurrent in-flight refresh does not trigger replay detection and mass-revoke
  the user's sessions. Timezone-naive values are normalized before comparison.
- **`get_client_ip` itself is well built** (`security_middleware.py:810`):
  forwarded headers are trusted only when the direct peer is a configured
  trusted proxy, and the real client is taken as the **right-most** non-proxy
  XFF hop — which is what makes a client-forged left-most entry unreachable.
  Secure by default (empty `TRUSTED_PROXY_IPS` ⇒ never trust XFF).
- **No dead endpoints.** All five candidate-orphan routes (`/check`,
  `/session-settings`, `/branding`, `/oauth-config`, `/mfa/status`) have
  frontend callers. `/check` is a deliberately cheap auth probe, not a
  duplicate of `/me` (which builds the full permission set).
- **No TODO/FIXME markers** across any of the five files.

## Findings

### AUTH-1 — MED — Session and audit records stored the proxy IP, not the client IP — ✅ FIXED

**What:** six call sites in `auth.py` recorded `request.client.host` instead of
`get_client_ip(request)`.

**Where:** `auth.py:342, 353` (OAuth login + its audit event), `558` (register),
`654` (login), `1204` (forgot-password), `1350` (reset-password).

**Impact:** the production profile runs behind nginx
(`docker-compose.prod.yml`, which sets `TRUSTED_PROXY_IPS` to the RFC1918
ranges), so `request.client.host` is **the proxy's address**. Every session row,
every OAuth-login audit event, and every password-reset audit event therefore
recorded the same internal IP for all users. That silently defeats the
"where am I logged in from" session list, any per-IP anomaly detection over
session data, and password-reset forensics — the audit trail looks populated but
carries no usable attribution.

The giveaway that this was an oversight rather than a decision: `mfa_login`
already called `get_client_ip(request)` for the _same_ `create_user_tokens`
parameter (`auth.py:766`), and `login` computed `login_ip = get_client_ip(...)`
at `auth.py:602` for rate limiting and then passed `request.client.host` to
token creation 50 lines later.

**Fix:** all six now use `get_client_ip(request)`; the login site reuses the
`login_ip` already computed in that function. `get_client_ip` was already
imported. Effective in the production profile; in a deployment that leaves
`TRUSTED_PROXY_IPS` unset it correctly falls back to the peer IP, so the change
is never worse than before.

### AUTH-2 — MED — The consent system is recorded but never enforced — ✅ FIXED (2026-08-05)

> **Resolved by owner decision.** The blocker below was "enforcing this stops
> SMS to every member who was never asked". The owner's rule removes it:
> _messages always go to the member's email, so consent may suppress the text
> but never the notice._ Implementation at the end of this finding.

**What:** `ConsentService.has_consent` (`consent_service.py:75`) has **zero
callers** — `grep -rn "has_consent" app/` returns only the definition and the
docstring line describing the contract. That docstring states the requirement
explicitly: _"Consumers of a consent (photo publishing, public roster, SMS
sending) must call `has_consent` and treat 'never asked' exactly like
'refused'."_ Nothing does.

**Where:** `app/services/consent_service.py:75`; the three unenforced consumers
are the SMS path (`sms_service.py:41` `send_sms`, and
`message_delivery_service.py` — neither mentions consent), public-portal roster
listing, and photo use.

**Impact:** members can grant or refuse `PHOTO_USE`,
`PUBLIC_ROSTER_LISTING`, and `SMS_NOTIFICATIONS` in the UI, the choice is stored
and audit-logged — and then ignored. A member who explicitly refuses photo
publication still has their photo published; one who refuses SMS still receives
it. The `SMS_NOTIFICATIONS` case carries the most exposure: the model comment
notes _"TCPA: text messaging requires express consent in the US"_, and TCPA
provides statutory damages per message. This is an ISO 27701 control that is
inert — arguably worse than not having it, because the UI represents to the
member that their choice takes effect.

**Why it was initially flagged:** enforcement is a behavior change.
`has_consent` treats "never asked" as refused, so wiring it in as documented
would immediately stop SMS to every existing member (none of whom have been
asked). That needed an owner decision on backfill.

**Resolution — email is the channel of record.** The owner's rule makes
enforcement safe without any backfill: consent may suppress the _text_, but the
member is always reached by email, so nobody can be left able to say they were
never told. Implemented as:

- **`ConsentService.granted_user_ids(user_ids, type)`** — a bulk, fail-closed
  companion to `has_consent`. The fan-out paths target the whole roster, so a
  per-recipient `has_consent` would have been an N+1 on the send path. An id
  with no row is simply absent from the set, i.e. treated as refused.
- **SMS is consent-gated in both send paths** — department-message escalation
  (`message_delivery_service._send_sms`) and the inventory low-stock admin alert
  (`scheduled_tasks.py:3353`, found by grepping every `SMSService` caller). The
  gate is _in addition to_ the existing channel preference, because TCPA
  consent and a UI toggle are not the same thing.
- **Email is now unconditional** (`message_delivery_service.deliver`) — sent for
  every department message, not only urgent/ack-required ones, and **no longer
  filtered by the `email_notifications` preference**. A member must not be able
  to opt out of the record that they were told something. Email is sent _before_
  the SMS branch so the ordering itself encodes the invariant.
- **The `email_notifications` preference is not dead** — it still governs the
  seven reminder/alert flows (`scheduled_tasks`, `cert_alert_service`,
  `scheduling_service`). The settings-page helper text was reworded to say so,
  since the toggle no longer covers department announcements.
- **Tests:** three existing tests encoded the old contract and were **updated,
  not deleted** (`test_every_message_is_emailed`,
  `test_email_ignores_opt_out_and_reaches_everyone_with_an_address`, and the SMS
  gating test now patches consent). Three added:
  `test_sms_requires_consent_even_when_the_channel_is_on`,
  `test_no_consent_means_no_sms_at_all`, and
  `test_member_without_sms_consent_is_still_emailed` — the last one is the
  invariant that makes the whole change safe. 15/15 pass.

**Still open — the other two consent types have no consumer to gate.**
Investigation found **no public roster endpoint and no public photo
publishing** anywhere in the app: `api/public/portal.py` exposes only org info,
stats, public events, application status, and health, behind a default-deny
field whitelist. So `PUBLIC_ROSTER_LISTING` and `PHOTO_USE` are being collected
for features that do not exist yet. Nothing to enforce today; whoever builds
them must gate on `has_consent`. This is now recorded in the
`consent_service` module docstring so the requirement sits where it will be
read.

### AUTH-3 — LOW — `core/audit.py` docstring teaches the wrong IP pattern — ✅ FIXED

**What:** the usage example in the `log_audit_event` docstring
(`app/core/audit.py:703`) shows `ip_address=request.client.host`.

**Impact:** documentation only — no runtime effect — but it is the example
developers copy when adding audit calls, and it is the direct source of the
AUTH-1 pattern. Left as-is it would keep reproducing the defect.

**Fix:** updated the example to `ip_address=get_client_ip(request)`.

## Duplication

- The Google and Microsoft OAuth initiate/callback pairs (`auth.py:363–487`) are
  structurally parallel but differ in provider config, claim mapping, and error
  handling. Collapsing them behind one provider-parameterized route would save
  little and would make the per-provider security handling harder to audit.
  **Not recommended.**
- `_set_auth_cookies` is correctly the single choke point for cookie issuance —
  all five paths that mint a session (login, MFA login, register, OAuth,
  refresh) go through it. No duplication of the `Secure`-flag logic.

## Dead code

`ConsentService.has_consent` is unreferenced (see AUTH-2) — but it is **not**
dead code to delete. It is the enforcement half of a half-built feature, and
removing it would erase the evidence that enforcement is missing. Left in place
deliberately.

Nothing else unreferenced: all 25 endpoints have callers, and no unused service
methods surfaced while tracing the endpoint layer.

## Documentation gaps

- `docs/MFA.md` accurately describes the implemented TOTP + recovery-code flow,
  including the admin-reset path.
- The red-team review's remediation table is accurate for the five fixes
  re-verified here (M1, M2, M3, H3, plus H5's `get_client_ip`) — the claims
  match the code.
- **Gap (not corrected here):** no document states that `TRUSTED_PROXY_IPS`
  **must** be set for client-IP-dependent features to work.
  `.env.example.full:464` does call it "CRITICAL when behind a reverse proxy",
  and `docker-compose.prod.yml` sets a default — but a self-hosted deployment
  following the base `docker-compose.yml` behind its own proxy gets proxy IPs
  everywhere, silently. This belongs with the AXC-1 sweep (see
  [CROSS-CUTTING.md](./CROSS-CUTTING.md)) rather than being fixed piecemeal here.

## Future development

1. **Enforce consent (AUTH-2).** The highest-value follow-up in this feature.
   Needs a backfill decision before any code changes.
2. **No test covers the client-IP resolution end to end.** `get_client_ip` has
   the security-critical right-most-hop logic and AUTH-1 showed call sites can
   drift away from it. A test asserting that a login behind a trusted proxy
   records the XFF client IP — not the peer — would have caught this class.
3. **Session list has no revoke-other-sessions control.** Sessions are recorded
   with IP/user-agent (now correctly), but a member who sees an unfamiliar
   session cannot terminate it; only a full logout exists. Now that the recorded
   IP is meaningful, this becomes worth building. _Incomplete feature._
4. **OAuth has no account-linking flow.** A member who signs up with a password
   and later uses Google gets matched by email; there is no explicit link or
   unlink UI, and no way to see which providers are attached. _Incomplete
   feature._
5. **`REGISTRATION_REQUIRES_APPROVAL` is not honored anywhere — corrected
   2026-09-07, security review CI3-33.** This bullet's original claim ("honored
   server-side but pending self-registrations are reachable only through the
   members list") is wrong, not merely incomplete: `settings
.REGISTRATION_REQUIRES_APPROVAL` has no reader anywhere in the backend, no
   `UserStatus` value represents a pending/unapproved account, and
   `register_user()` (`auth_service.py`) unconditionally sets `status=
UserStatus.ACTIVE` and returns tokens that log the caller in immediately.
   Every self-registered account is fully active and authenticated the moment
   registration completes, regardless of this setting's value (default `True`).
   See `docs/security-review/CI3-33-core-infra.md` (CI3-33-3) and
   `docs/KNOWN_LIMITATIONS.md`.

## Completion gate

| Check                | Result                                                                                                                                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsc --noEmit`       | ✅ 0 errors (repo-wide)                                                                                                                                                                                                             |
| `flake8 app/ tests/` | ✅ 0 violations                                                                                                                                                                                                                     |
| `black --check`      | ✅ 501 files unchanged                                                                                                                                                                                                              |
| `eslint`             | ✅ clean                                                                                                                                                                                                                            |
| frontend tests       | ✅ unchanged — no frontend files modified this iteration                                                                                                                                                                            |
| backend tests        | ✅ 118 passed (auth/mfa/oauth/consent) · ⚠️ 3 errored at fixture setup — `test_consent_service.py` needs MySQL, unavailable in this sandbox (verified: 5 "Can't connect to MySQL" lines). Environment limitation, not a regression. |

</content>
