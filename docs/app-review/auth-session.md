# Application Review — Auth & Session Lifecycle

**Prefix:** `AUTH` · **Iteration:** A2 · **Reviewed:** 2026-08-05 (pass 1),
2026-08-08 (pass 2)

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
with no try/except (a malformed *admin-written* config could 500 a public endpoint,
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
  unauthenticated *by necessity* (`/branding`, `/oauth-config`, the four OAuth
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
  runs on the unknown-user, no-password-hash, *and* locked-account branches
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
already called `get_client_ip(request)` for the *same* `create_user_tokens`
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
> *messages always go to the member's email, so consent may suppress the text
> but never the notice.* Implementation at the end of this finding.

**What:** `ConsentService.has_consent` (`consent_service.py:75`) has **zero
callers** — `grep -rn "has_consent" app/` returns only the definition and the
docstring line describing the contract. That docstring states the requirement
explicitly: *"Consumers of a consent (photo publishing, public roster, SMS
sending) must call `has_consent` and treat 'never asked' exactly like
'refused'."* Nothing does.

**Where:** `app/services/consent_service.py:75`; the three unenforced consumers
are the SMS path (`sms_service.py:41` `send_sms`, and
`message_delivery_service.py` — neither mentions consent), public-portal roster
listing, and photo use.

**Impact:** members can grant or refuse `PHOTO_USE`,
`PUBLIC_ROSTER_LISTING`, and `SMS_NOTIFICATIONS` in the UI, the choice is stored
and audit-logged — and then ignored. A member who explicitly refuses photo
publication still has their photo published; one who refuses SMS still receives
it. The `SMS_NOTIFICATIONS` case carries the most exposure: the model comment
notes *"TCPA: text messaging requires express consent in the US"*, and TCPA
provides statutory damages per message. This is an ISO 27701 control that is
inert — arguably worse than not having it, because the UI represents to the
member that their choice takes effect.

**Why it was initially flagged:** enforcement is a behavior change.
`has_consent` treats "never asked" as refused, so wiring it in as documented
would immediately stop SMS to every existing member (none of whom have been
asked). That needed an owner decision on backfill.

**Resolution — email is the channel of record.** The owner's rule makes
enforcement safe without any backfill: consent may suppress the *text*, but the
member is always reached by email, so nobody can be left able to say they were
never told. Implemented as:

- **`ConsentService.granted_user_ids(user_ids, type)`** — a bulk, fail-closed
  companion to `has_consent`. The fan-out paths target the whole roster, so a
  per-recipient `has_consent` would have been an N+1 on the send path. An id
  with no row is simply absent from the set, i.e. treated as refused.
- **SMS is consent-gated in both send paths** — department-message escalation
  (`message_delivery_service._send_sms`) and the inventory low-stock admin alert
  (`scheduled_tasks.py:3353`, found by grepping every `SMSService` caller). The
  gate is *in addition to* the existing channel preference, because TCPA
  consent and a UI toggle are not the same thing.
- **Email is now unconditional** (`message_delivery_service.deliver`) — sent for
  every department message, not only urgent/ack-required ones, and **no longer
  filtered by the `email_notifications` preference**. A member must not be able
  to opt out of the record that they were told something. Email is sent *before*
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
   IP is meaningful, this becomes worth building. *Incomplete feature.*
4. **OAuth has no account-linking flow.** A member who signs up with a password
   and later uses Google gets matched by email; there is no explicit link or
   unlink UI, and no way to see which providers are attached. *Incomplete
   feature.*
5. **`REGISTRATION_REQUIRES_APPROVAL` has no admin queue in the UI.** The flag
   is honored server-side but pending self-registrations are reachable only
   through the members list. *Incomplete feature.*

## Completion gate

| Check | Result |
|-------|--------|
| `tsc --noEmit` | ✅ 0 errors (repo-wide) |
| `flake8 app/ tests/` | ✅ 0 violations |
| `black --check` | ✅ 501 files unchanged |
| `eslint` | ✅ clean |
| frontend tests | ✅ unchanged — no frontend files modified this iteration |
| backend tests | ✅ 118 passed (auth/mfa/oauth/consent) · ⚠️ 3 errored at fixture setup — `test_consent_service.py` needs MySQL, unavailable in this sandbox (verified: 5 "Can't connect to MySQL" lines). Environment limitation, not a regression. |
</content>
