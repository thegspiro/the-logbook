# Red-Team Security Review — The Logbook

**Date:** 2026-07-21
**Scope:** Full application — backend (FastAPI, 265 py files), frontend (React/TS, 803 files),
middleware, public/webhook surface, deployment config.
**Perspective:** Adversarial. Findings are ranked by exploitability × impact. Each item lists a
concrete exploit path and a specific fix. Items marked **(verified)** were confirmed by direct
code inspection during the review.

> **Overall posture:** Strong. Crypto primitives, tenant-isolation baseline, webhook signing,
> file-upload handling, and client-side auth are notably well-built. The findings below are real
> but sit on top of a solid foundation; the two HIGH tenant/authz issues are the ones to fix first.

## Remediation status

**All five HIGH findings are fixed** on branch `claude/app-security-red-team-rgf6bk`:

| ID | Finding | Status | Where |
|----|---------|--------|-------|
| H1 | Cross-tenant audit-log disclosure | ✅ Fixed | `security_monitoring.py` — both handlers scoped to org |
| H2 | Role-assignment privilege escalation | ✅ Fixed | `users.py` + `roles.py` — permission-subset ceiling on assign/create/update/clone |
| H3 | MFA brute-force + TOTP replay | ✅ Fixed | `mfa_service.py`, `auth.py`, migration `20260725_0001` |
| H4 | Unkeyed audit hash chain | ✅ Fixed | `audit.py` HMAC-SHA256 + versioning, migration `20260726_0001` |
| H5 | Global-lockout rate-limit DoS | ✅ Fixed | `security_middleware.py` — `get_client_ip()` |

MEDIUM and LOW items below are **not yet remediated**.

> **Discovered while working (pre-existing, unrelated to these fixes):** two Alembic migration
> files — `20260720_0001_add_department_message_deleted_at.py` and
> `20260720_0001_add_training_positions_and_shift_status.py` — declare the **same** `revision =
> "20260720_0001"` with the same `down_revision`. Duplicate revision ids collide in the Alembic
> graph and will error on `alembic upgrade`. Fixing it means renaming one revision and re-pointing
> the downstream `20260721_0001.down_revision`; validate with `alembic history`/`heads` in a live
> environment before applying.

---

## HIGH

### H1 — Cross-tenant audit-log read & export (broken tenant isolation) **(verified)**
**`backend/app/api/v1/endpoints/security_monitoring.py:350` (`GET /security/audit-log/entries`), `:435` (`GET /security/audit-log/export`)**

The canonical audit endpoints in `audit_logs.py:60-64` correctly scope every query to the caller's
org by joining through users:
`AuditLog.user_id.in_(select(User.id).where(User.organization_id == current_user.organization_id))`.
The duplicate handlers in `security_monitoring.py` issue a bare `select(AuditLog)` with **no org
scoping** — only optional `event_type`/`category`/`severity`/`user_id`/`id-range` filters.

`audit.view` is in `_LEADERSHIP_VIEW_PERMISSIONS` (fire_chief, deputy/assistant chief, captain,
lieutenant, president, VP, treasurer, board, safety_officer); `audit.export` to chief/president.

**Exploit:** A leadership user in Org A calls `GET /security/audit-log/entries?limit=500` (or
`/export?limit=10000`) and receives **every organization's** audit trail platform-wide — usernames,
IP addresses, and `event_data` containing member IDs/emails, role/permission changes, password-reset
and MFA-reset events, and logins for every other department. Paging `skip` / `start_id..end_id`
dumps the entire cross-tenant log. HIPAA-relevant PII disclosure across tenants.

**Fix:** Apply the same `user_id IN (org users)` subquery filter (and to the count query) in both
handlers, or delete the duplicate endpoints and route the UI to the already-correct `audit_logs.py`.
Exclude system-level entries (`user_id IS NULL`) from org-scoped views.

### H2 — Privilege escalation to System Owner via role assignment **(verified)**
**`backend/app/api/v1/endpoints/users.py:479` (`PUT /users/{id}/roles`), `:574` (`POST /users/{id}/roles/{role_id}`)**

The handlers require only `users.update_positions` / `members.assign_positions` /
`users.update_roles` / `members.assign_roles` (OR logic — non-owner roles such as **secretary** /
**membership_coordinator** hold these). The code scopes the target user and the role IDs to the
caller's org — but there is **no privilege-ceiling check and no self-assignment guard**. Every org is
seeded with an `it_manager` role granting `["*"]` (`permissions.py:1075`).

**Exploit:** A holder of `users.update_positions` reads the wildcard role ID from `GET /roles`, then
`PUT /users/{their_own_id}/roles` with `{"role_ids": ["<it_manager_role_id>"]}`. Self is not
excluded and the role is a valid same-org role, so it is assigned. The caller now holds `{"*"}` —
security management, `audit.manage` (audit deletion), all PHI, finance, template export/import. Full
vertical escalation from a clerical role to platform System Owner within the tenant.

**Amplifier:** A holder of `roles.edit`/`positions.edit` can `PATCH /roles/{id}` to add any catalog
permission to any role — including the org-wide `member` system role every user carries
(`role_service.update_role:257-270`; `is_system` blocks only name/slug edits) — mass-granting
privileges org-wide.

**Fix:** Enforce a ceiling — the caller may only assign roles whose permission set is a subset of the
caller's own effective permissions (and/or `priority ≤` caller's max). Forbid modifying one's own
role set without separate higher authority. Block assigning `["*"]` except from a `*` holder. Add the
same subset check to `create_role`/`update_role`.

### H3 — MFA has no per-user brute-force lockout and TOTP codes are replayable
**`backend/app/services/mfa_service.py:31-38` (`verify_totp`), `backend/app/api/v1/endpoints/auth.py:660-703` (`mfa_login`)**

Two compounding gaps: (1) `mfa_login` never checks `locked_until` or increments a failure counter —
the account lockout that guards the *password* step (`auth_service.py:206-227`) does not exist on the
second factor; the only limiter is per-IP (5/60s). (2) `verify_totp` uses `valid_window=1` with **no
record of the last-used time-step**, so a code stays valid for the full ±30s window and can be
replayed.

**Exploit:** An attacker who already has the password (required to mint the `mfa_pending` token)
distributes guesses across many IPs — `valid_window=1` accepts 3 of 10⁶ codes at any instant, so
~5,000 guesses/min across a botnet reaches ~50% success in under an hour, and no lockout ever fires.
The `mfa_pending` JWT is re-mintable by replaying `/login`, so its 5-min TTL is not a real ceiling.
Separately, a real-time phishing proxy can replay a captured live code (nothing marks it consumed).

**Fix:** Add a per-user `last_totp_timestep`; reject any step ≤ the last accepted one. Feed MFA
failures into the same `failed_login_attempts`/`locked_until` lockout and check `locked_until` at the
top of `mfa_login`. Rate-limit `/mfa/login` per-user (subject from the `mfa_pending` token).

### H4 — Audit hash chain is unkeyed SHA-256 with a built-in full-chain rewrite path
**`backend/app/core/audit.py:51-76` (`calculate_hash`), `:259-290` (`rehash_chain`)**

The tamper-evidence chain uses plain `hashlib.sha256` with **no HMAC / no secret**, and
`rehash_chain` recomputes and overwrites `previous_hash`/`current_hash` for the entire table.
Checkpoints live in the same DB.

**Exploit:** Anyone able to write audit rows (DB access, or by re-implementing the trivial keyless
algorithm) can delete/alter entries and recompute a fully valid chain — `verify_integrity` reports
`verified: True`. Combined with the `audit.manage` hard-delete permission (M9), this makes the audit
trail tamper-*evident* only against naive edits, not a motivated actor — undermining the HIPAA
§164.312(b) immutability claim.

**Fix:** Key the chain — `hmac.new(audit_key, data, sha256)` with a dedicated secret **not** stored in
the app DB. Anchor/sign checkpoints externally (WORM / append-only store). Remove or tightly gate
`rehash_chain`.

### H5 — Login rate limiter keys the raw peer IP → global lockout DoS behind the proxy
**`backend/app/core/security_middleware.py:414`**

`check_rate_limit` uses `client_ip = request.client.host` instead of the proxy-aware
`get_client_ip()` that every other component uses. Behind nginx/Docker, every client's peer IP is the
proxy, so **all users share one bucket**.

**Exploit:** 5 failed logins from any mix of users trip the shared `login` bucket and its 30-minute
lockout, locking out **every** user — a trivial, unauthenticated availability attack. (Fail-safe re:
spoofing, but a real DoS and inconsistent with the careful XFF handling elsewhere.)

**Fix:** `client_ip = get_client_ip(request)` in `check_rate_limit`.

---

## MEDIUM

### M1 — `Secure` cookie flag silently dropped by any `http://` allowed origin
**`backend/app/api/v1/endpoints/auth.py:79-88` (`_set_auth_cookies`), `:285-294`**
When `COOKIE_SECURE` is unset, `use_secure = not any(o.startswith("http://") …)`. One stray
`http://` entry in `ALLOWED_ORIGINS` (a LAN IP, a legacy admin host) — even in production — drops
`Secure` from **all** auth cookies, exposing sessions to SSL-strip/MITM. Fails open silently.
**Fix:** Force `Secure=True` when `ENVIRONMENT in (production, staging)` regardless of origin scheme
(or refuse to boot with an `http://` origin in prod).

### M2 — Refresh-token rotation has no grace window → mass session revocation / targeted logout DoS
**`backend/app/services/auth_service.py:336-350`, `:408-415`**
A refresh token not found in the DB is treated as theft and triggers `_revoke_all_user_sessions`.
Two concurrent legitimate refreshes (multi-tab, app boot, retry) log the user out of **all** devices;
and any single old refresh token an attacker captured once can be replayed to force-revoke the
victim's sessions on demand. **Fix:** short rotation grace window, or per-session token-family
generation id — revoke only on a genuine older-generation reuse.

### M3 — Username enumeration via lockout reveal + locked-path timing
**`backend/app/services/auth_service.py:184-203`**
`ACCOUNT_LOCKOUT_REVEAL` defaults to revealing "Account temporarily locked… N minutes" (confirms the
account exists), and the locked branch returns **before** the Argon2 verify, so locked (real) accounts
respond faster — defeating the dummy-hash timing defense used for unknown users. **Fix:** default
`ACCOUNT_LOCKOUT_REVEAL=False`; run a dummy `verify_password` on the locked branch to equalize timing.

### M4 — SSRF via DNS rebinding (TOCTOU) in outbound integration requests
**`backend/app/utils/url_validator.py:101-112`; re-resolved at send in `integration_services/webhook_service.py:97`, calcom/salesforce**
Private-IP rejection happens only at config-save time; the stored URL is re-resolved at request time.
An `integrations.manage` admin registers a domain returning a public IP during validation and
`169.254.169.254`/`127.0.0.1` at send time. `follow_redirects=False` does not cover rebinding.
**Fix:** resolve once at request time and connect to the validated IP (pin it, set `Host`), or a
custom `httpx` transport that re-checks every resolved address against `_is_private_ip`.

### M5 — XXE / entity-expansion DoS in ePCR / NEMSIS XML import
**`backend/app/services/integration_services/epcr_import_service.py:85`**
`ElementTree.fromstring(file_content)` parses attacker-supplied XML with the stdlib parser
("not secure against maliciously constructed data"). Billion-laughs / quadratic-entity expansion →
memory/CPU exhaustion; external-entity handling can add file-read/SSRF. **Fix:** `defusedxml`.

### M6 — Public form submission enables cross-org spam + side-effect abuse
**`backend/app/api/v1/endpoints/forms.py:132-196`, `backend/app/services/forms_service.py:868-928`**
Bot protection is honeypot-only (no CAPTCHA). Anyone with a form's 12-hex slug can POST unlimited
submissions to **any** org's form, and each accepted submission auto-runs `_process_integrations`
(creates membership-pipeline prospects, fires outbound emails). Practical DB-flooding / email-abuse
vector. **Fix:** CAPTCHA (or PoW) on submit, per-form/day cap, gate integration side-effects behind
verification.

### M7 — No replay protection on inbound webhooks
**`backend/app/api/public/salesforce_webhook.py:59`, `integrations_webhook.py:111/176`**
HMAC verification covers authenticity but not freshness — no timestamp tolerance or nonce/delivery-ID
dedup. A captured valid signed request can be replayed to re-advance pipeline stages or re-run
Salesforce sync. **Fix:** require a signed timestamp header (reject > N min skew) and/or dedup
delivery IDs.

### M8 — Public-route rate limiting is in-memory / per-process, not distributed
**`backend/app/core/security_middleware.py:28-146` (used by forms/webhooks/portal); `public_portal_security.py:26-30`**
The Redis-backed limiter exists and is used by auth routes, but public endpoints use an in-process
limiter — multiplied by worker/container count, reset on restart. Undercuts M6/M7 protections.
**Fix:** route public limits through the Redis limiter (fail-closed for these routes).

### M9 — Audit logs are hard-deletable by a permission (evidence destruction)
**`backend/app/core/permissions.py:286` (`audit.manage` = "…delete audit/error logs"); `security_monitoring.py:710`**
Combined with the keyless chain (H4), a privileged/compromised admin can hard-delete entries and
leave no cryptographic trace. **Fix:** no hard delete — retention-based purge only, itself audited and
externally anchored.

### M10 — CSRF "no cookie ⇒ allow" bypass branch
**`backend/app/core/security_middleware.py:580-590`**
When the `csrf_token` cookie is absent, the check returns without validating — the double-submit
control depends entirely on `SameSite=Strict` being honored. WebSocket and `/onboarding/` paths skip
CSRF entirely (`:561`, `:573`). **Fix:** once a session exists, treat a missing CSRF cookie on an
unsafe method as 403; keep SameSite as belt, not sole control.

### M11 — PII endpoints missing from the frontend SWR cache exclusion list
**`frontend/src/utils/apiCache.ts:31-74`**
`/events/` is not excluded, so `GET /events/{id}/rsvps` (attendance roster + names/status),
`/eligible-members` (first/last/email), `/external-attendees`, `/check-in-monitoring` persist in the
in-memory cache up to 90s past an authorization change. `/facilities/` is excluded only for
`emergency-contacts`, leaving `/facilities/occupants` (PII) and `/facilities/access-keys` (physical
key inventory) cacheable. **Fix:** add `/events/` roster sub-paths and `/facilities/occupants` +
`/facilities/access-keys` to `UNCACHEABLE_PREFIXES`.

---

## LOW / Hardening

- **L1 — Default `docker-compose.yml` is a dev config.** `ENVIRONMENT: development`, `uvicorn --reload`,
  `./backend:/app` bind-mount, backend published on `0.0.0.0:3001`. No `docker-compose.prod.yml` exists.
  Run as-is in prod → live code-reload, `/docs`+`/openapi.json` enabled, API reachable directly past
  the nginx 404 rules. **Fix:** ship a prod compose; startup guard refusing `--reload`/docs when
  `ENVIRONMENT=production`.
- **L2 — `ENABLE_DOCS` / `DEBUG` in prod are only WARNINGs**, not blocking (`config.py:287-299`);
  `ENABLE_DOCS` defaults `True` (`:534`). **Fix:** promote to CRITICAL or default `False`.
- **L3 — Per-user authz data cached** (`/roles/user/{id}/permissions`, `/roles/admin-access/check` not
  in `UNCACHEABLE_PREFIXES`) — revocation masked up to 90s. **Fix:** add `/roles/user/`,
  `/roles/admin-access`.
- **L4 — ReportLab markup injection** (`equipment_check_pdf.py:350,390`) — user strings into
  `Paragraph` parse intra-paragraph XML; unbalanced `<`/`&` crash `doc.build()`, `<img>/<a>` embed
  local files/fetches. **Fix:** `xml.sax.saxutils.escape()` before `Paragraph`.
- **L5 — MFA recovery codes stored reversibly** (`models/user.py:353-360`, AES not hash) and compared
  non-constant-time (`auth.py:689-698`). **Fix:** store per-code hashes, constant-time compare.
- **L6 — No global request-body size cap** (only SecurityMonitoring self-limits 1 MB,
  `security_middleware.py:1143`). Memory-pressure DoS via large POST. **Fix:** ASGI/nginx body ceiling.
- **L7 — OAuth account-link by email with empty domain allowlist** (`oauth_service.py:170-189`,
  `:297-318`). **Fix:** require a non-empty domain allowlist when OAuth is enabled.
- **L8 — `display.py:28` / `calendar.py:39` have no rate limiting**; unauthenticated GETs perform DB
  writes (`portal.py:393`, `membership_pipeline_service.py:3540/3580`) → write amplification.
- **L9 — Misc:** `ENCRYPTION_KEY` has no min-length check (vs `SECRET_KEY ≥ 32`, `config.py:248-254`);
  geo-block fails open on unknown country (`geoip.py:203`); CSP allows `style-src 'unsafe-inline'`,
  HSTS lacks `preload`; latent SQL f-string `equipment_check_service.py:1221` (int-bounded, not
  currently exploitable); dead XOR "obfuscation" + bypassable denylist `sanitizeInput` in onboarding
  (`modules/onboarding/utils/security.ts`) — delete to prevent future misuse.

---

## Verified strong (not re-flagged)

Argon2id + JWT locked to `HS256` (no alg-confusion/`none`) + PBKDF2/Fernet + constant-time compares;
rate limiting fails closed when Redis is down; `get_client_ip()` correctly hardened against
X-Forwarded-For spoofing; all custom middleware is pure ASGI; tracking caches are size-capped; CORS
wildcard blocks prod startup; secrets masked in `repr`; all 3 inbound webhooks verify HMAC with
`compare_digest` and reject when unconfigured; file upload uses magic-byte MIME + UUID names + 50 MB
cap + org-scoped paths; no `pickle`/`eval`/`subprocess`/`yaml.load` in the backend; the tenant-isolation
baseline (users, roles, documents+folder ACL, medical_screening, finance approvals, elections,
messages, labels, training_waivers, organizations) correctly derives `organization_id` from the
authenticated user with no mass-assignment vector; frontend has no `dangerouslySetInnerHTML`/`eval`,
keeps auth in httpOnly cookies only, routes all 13 module axios instances through a shared
`withCredentials`+CSRF factory, and validates the post-login redirect against relative paths;
container runs non-root with `cap_drop: ALL` + `no-new-privileges`; nginx sets HSTS,
`frame-ancestors 'none'`, `object-src 'none'`, and `script-src 'self'` with no `unsafe-inline`.

---

## Suggested remediation order

1. **H1** (cross-tenant audit disclosure) and **H2** (role-assignment escalation) — passive mass
   disclosure and active in-tenant escalation, both low-skill.
2. **H3** (MFA brute-force/replay) and **H4/M9** (audit-chain integrity + hard delete).
3. **H5** (global-lockout DoS), **M1** (Secure cookie), **M4/M5** (SSRF/XXE).
4. Remaining MEDIUM, then LOW hardening.
