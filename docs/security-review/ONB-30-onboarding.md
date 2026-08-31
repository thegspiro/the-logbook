# Security Review — Feature 30: Onboarding (pass 2)

**Prefix:** `ONB` · **Rotation pass:** 2 (prior: module-audit iteration 25,
app-review B25 passes 1-4, security-review pass 1 — PR #1913 + a same-day
follow-up pass, both recorded in `docs/security-review/ONB2-30-onboarding.md`)
**Files:** `backend/app/api/v1/onboarding.py` (2,386 L, 24 unauthenticated
bootstrap routes), `backend/app/services/onboarding.py` (1,465 L),
`backend/app/models/onboarding.py`, `backend/app/utils/onboarding_security.py`,
`backend/app/api/v1/email_test_helper.py`, `backend/app/services/
template_service.py`, `backend/app/services/org_template_service.py`,
`backend/app/services/org_template_registry.py`. Also touched:
`frontend/.env.example`, `frontend/setup.sh`, `docs/ONBOARDING_FLOW.md`,
`CLAUDE.md` (dead-config cleanup, see ONB-30-2 below).

## Scope and method

This is the security-review rotation's **second** pass over this feature. Read
`docs/security-review/CHECKLIST.md`, `SEC-00-cross-cutting-baseline.md`,
`docs/module-audit/onboarding.md` (iteration 25), `docs/app-review/onboarding.md`
(B25, 4 passes) and `docs/security-review/ONB2-30-onboarding.md` (pass 1, PR
#1913 + follow-up) **before** reading any code, per the rotation rule — every
prior finding below was re-verified against current code, not re-derived.

Every route's file was read in full, end to end, not diffed against pass 1 —
`onboarding.py` grew from 2,255 L to 2,386 L since pass 1 (mostly the pass-1
fixes themselves plus minor comment growth), small enough that a full read was
the faster and more reliable path to "no regression" than trusting a diff to
show every relevant line. `services/onboarding.py`, `models/onboarding.py`,
`utils/onboarding_security.py`, `template_service.py` were also read in full.
`org_template_service.py`/`org_template_registry.py` (export-only, Phase 1, no
import path — confirmed still true) and `email_test_helper.py` were read for
the specific angles this pass adds (SMTP host validation, OAuth token-URL
construction).

This feature is unauthenticated **by design** — it bootstraps the first
organization and System Owner before any user exists. Per the task brief, the
review focus is what stops those open routes from being abused, not whether
they should require auth (they should not).

## Route enumeration (auth/compensating-control coverage)

All 24 routes the SEC-00 baseline counted for this feature, confirmed against
current code:

| Route                   | Method | Compensating control                                                                                           |
| ----------------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| `/status`               | GET    | none → **now rate-limited (ONB-30-1, this pass)**; response minimal post-completion (ONB-8)                    |
| `/start`                | POST   | rate-limited (own scope); blocked once an org exists (`get_or_create_session`)                                 |
| `/system-info`          | GET    | rate-limited + `validate_session(require_csrf=False)`                                                          |
| `/security-check`       | GET    | rate-limited + `validate_session(require_csrf=False)`                                                          |
| `/database-check`       | GET    | rate-limited + `validate_session(require_csrf=False)`; generic error (ONB-5)                                   |
| `/organization`         | POST   | `validate_session` (CSRF required) + `needs_onboarding()` + single-org guard (ONB-2)                           |
| `/system-owner`         | POST   | rate-limited + `validate_session` + `needs_onboarding()` + single-owner guard (ONB-2)                          |
| `/modules`              | POST   | `validate_session` + `needs_onboarding()` (ONB-3)                                                              |
| `/notifications`        | POST   | `validate_session` + `needs_onboarding()` (ONB-3)                                                              |
| `/complete`             | POST   | `validate_session` + `needs_onboarding()` (ONB-3); one-way latch in the service                                |
| `/test/email`           | POST   | rate-limited + `validate_session`; SMTP-host SSRF exposure — **flagged, ONB-30-3**                             |
| `/session/department`   | POST   | `validate_session` + `needs_onboarding()` (ONB-3)                                                              |
| `/session/email`        | POST   | `validate_session` + `needs_onboarding()` (ONB-3); config encrypted at rest                                    |
| `/session/file-storage` | POST   | `validate_session` + `needs_onboarding()` (ONB2-30-3); config encrypted at rest                                |
| `/session/auth`         | POST   | `validate_session` + `needs_onboarding()` (ONB2-30-3)                                                          |
| `/session/it-team`      | POST   | `validate_session` + `needs_onboarding()` (ONB2-30-3); list capped `max_length=50` (ONB2-30-1)                 |
| `/session/stations`     | POST   | `validate_session` + `needs_onboarding()` (ONB-9); list capped `max_length=50`                                 |
| `/session/apparatus`    | POST   | `validate_session` + `needs_onboarding()` (ONB-9); list capped `max_length=100`                                |
| `/session/modules`      | POST   | `validate_session` + `needs_onboarding()` (ONB2-30-3); module allowlist                                        |
| `/session/organization` | POST   | `validate_session` + `needs_onboarding()` (ONB-3); single-org guard (ONB-2)                                    |
| `/session/roles`        | POST   | `validate_session` + `needs_onboarding()` (ONB-3); list capped `max_length=200` (ONB2-30-2)                    |
| `/session/positions`    | POST   | delegates to `/session/roles` — inherits every guard above                                                     |
| `/session/data`         | GET    | `validate_session` (CSRF required); returns only non-sensitive fields (platform names, counts)                 |
| `/reset`                | POST   | rate-limited + `validate_session` + post-owner re-authentication as the exact System Owner (ONB-8) + audit log |

No route outside this list, and no route on this list is missing a
compensating control appropriate to what it does — matches the SEC-00
baseline's count and the checklist's dimension-1 requirement to enumerate
rather than spot-check.

## Re-verification of prior findings (all hold, no regressions)

Read the current code at each cited location; every fix from all three prior
review layers is present and unchanged in effect:

- **ONB-1** (reset deletes `Location`/`Facility` before `users`, catches only
  `ProgrammingError`/`OperationalError` on the `user_positions` raw delete) —
  `onboarding.py:2324-2343` (line numbers after this pass's additions).
- **ONB-2** (single-org guard in `create_organization`, single-owner guard in
  `create_system_owner`) — `services/onboarding.py:530-531` (`any_org...raise
ValueError`), `:1144-1146` (`existing_user...raise ValueError`).
- **ONB-3 / ONB-9** (`needs_onboarding()` replay guard on `/modules`,
  `/notifications`, `/complete`, `/session/roles`+`/positions`,
  `/session/stations`, `/session/apparatus`, `/session/organization`) —
  present at every cited route; `/complete` still guards before
  `_persist_session_data_to_org` re-writes org settings.
- **ONB-4** (rate limiting on `/start`, `/system-owner`) — present, now via the
  scoped-wrapper form ONB2-30-4 introduced.
- **ONB-5** (`/database-check` generic error) — `services/onboarding.py:
1313-1323`, logs the real exception, returns a generic message.
- **ONB-6** (`template_service.initialize_defaults` deep-copies
  `DEFAULT_*_SECTIONS` before assigning) — `template_service.py:164-171`.
- **ONB-7** (role editor accepts client-supplied permissions/priority/
  system-flag on **new** roles; existing system roles still merge
  `DEFAULT_ROLES`/wildcard defaults) — `onboarding.py:2131-2166`
  (`save_session_roles`), unchanged. Still a product-policy call, not a
  drive-by fix; re-confirmed accurately described.
- **ONB-8** (reset re-authentication as the exact System Owner via
  `find_system_owner`; `/status` minimal post-completion response) —
  `onboarding.py:2273-2299` (reset auth), `:826-839` (`/status`). Audit
  durability sub-item (the `reset_initiated` log call shares a transaction
  with the deletes) is still open — see "Still flagged" below.
- **ONB2-30-1** (`ITTeamMemberRequest` typed model, `it_team` capped
  `max_length=50`) — `onboarding.py:318-337`.
- **ONB2-30-2** (`RolesSetupRequest.roles`/`PositionsSetupRequest.positions`
  capped `max_length=200`) — `onboarding.py:424-452`.
- **ONB2-30-3** (post-completion guard added to `/session/department`,
  `/session/email`, `/session/file-storage`, `/session/auth`,
  `/session/it-team`, `/session/modules`) — present at all six.
- **ONB2-30-4** (one scoped rate-limit wrapper per route instead of a shared
  bare `Depends(check_rate_limit)`) — `onboarding.py:74-102` (wrappers),
  applied at all seven original routes. **Extended this pass** — see
  ONB-30-1 below.
- **ONB2-30-5** (E712 sweep in `template_service.py`) — confirmed
  `.is_(True)` throughout (`template_service.py:194, 312, 322`), no bare
  `== True`/`== False`.
- **ONB2-30-6** (`incidents` removed from `ONBOARDING_LEGACY_MODULES`) —
  `services/onboarding.py:71-92`: `incidents` is in
  `ONBOARDING_SETTINGS_ONLY_MODULES` only.
- **ONB2-30-7** (`validate_logo_image`'s internal wrapping sites no longer
  echo raw exception text) — out of this pass's line-by-line scope
  (`image_validator.py` is not one of this feature's principal files) but
  spot-checked: `onboarding.py`'s three call sites (`/organization`,
  `/session/department`, `/session/organization`) all still route through
  `validate_logo_image`, unchanged call shape.
- **ONB-8 residual / template mass-assignment** (`create_template`/
  `update_template` strip `organization_id`/`created_by` and route through
  `apply_updates`) — `template_service.py:228-234, 283-288`.
- **ONB2-30-8** (session TTL is a sliding 30-minute window with no absolute
  cap; `/system-info`, `/security-check`, `/database-check` slide it with the
  session id alone, no CSRF) — `onboarding.py:929, 952, 978`
  (`require_csrf=False`), `validate_session` at `:618-621` unconditionally
  renews `expires_at`. Still open, still a policy call (what should an
  absolute cap be, and would it ever cut off legitimate wizard navigation) —
  re-confirmed, not re-applied.

No regression found anywhere in this list.

## New findings this pass

### ONB-30-1 — LOW — `GET /status` was the one anonymous onboarding route with no rate limit — ✅ FIXED

Noted but explicitly left unfixed in app-review pass 2 ("`/status` is the one
anonymous endpoint with no `check_rate_limit`") and not revisited by security
pass 1. Every other anonymous onboarding route now has its own scoped
rate-limit wrapper (ONB2-30-4); `/status` alone had none. The endpoint's read
is cheap (one or two indexed `SELECT`s) so this is not a DoS-cost concern, but
it is the one anonymous surface an attacker could poll unthrottled during the
pre-completion window to watch `organization_name`/`steps_completed` change in
real time as the real admin works through setup — low value, but inconsistent
with every sibling route and a free fix.

**Fix:** added `_rate_limit_onboarding_status` (same pattern, own scope) and
applied it to `GET /status`. No functional/response change — same behavior,
now throttled. Guard test extended: `test_onboarding_rate_limit_scopes.py`
now covers 8 wrappers (was 7) and asserts all 8 scopes are pairwise distinct;
verified to fail (`AttributeError` then a scope-count mismatch) with the fix
reverted, and to pass with it applied.

### ONB-30-2 — LOW — `VITE_SESSION_KEY` is dead configuration, documented as security-critical — ✅ FIXED

`frontend/.env.example`, `frontend/setup.sh` (three separate places — the
`.env` template, the fallback here-doc, and the "next steps" banner), and
`CLAUDE.md`'s Frontend env var table all declared `VITE_SESSION_KEY` as the
**"Onboarding session encryption key — set a 32+ char value in production"**,
with `setup.sh` twice calling it out as "MUST be changed for production!".

`grep -rn VITE_SESSION_KEY frontend/src` and a repo-wide search for any reader
(`import.meta.env.VITE_SESSION_KEY`, vite config, Dockerfile, compose) found
**zero** — the variable is never read anywhere. The actual explanation is in
`frontend/src/modules/onboarding/utils/security.ts`'s own trailing comment:

> A reversible XOR-based `obfuscate()`/`deobfuscate()` pair used to live here
> for stashing onboarding data in sessionStorage. It was unused (sensitive
> onboarding data is now POSTed straight to the server, never stored
> client-side) and gave a false sense of protection, so it was removed. Do not
> reintroduce client-side "encryption" of sensitive data — use the server.

That removal (and `utils/storage.ts`'s current design, which explicitly
excludes credentials/secrets from `sessionStorage`/`localStorage` and actively
purges legacy sensitive keys on module load) was completed in the frontend
code but never followed through in the env templates or docs. The real
protection for onboarding session data is entirely server-side —
`OnboardingSessionModel` + `app.core.security.encrypt_data`, keyed by the
backend's own `ENCRYPTION_KEY`/`ENCRYPTION_SALT` — confirmed still true this
pass (`/session/email`, `/session/file-storage` both encrypt via
`encrypt_data` before storing in the `data` JSON column).

**Impact:** documentation/config drift only, not a live vulnerability — no
runtime behavior depended on this variable in either direction. But telling an
operator a value "MUST be changed for production" for something that does
nothing is actively misleading: it invites false confidence ("I rotated the
session key") and wastes a deployment-checklist item on a no-op, while the
actual protection (backend `ENCRYPTION_KEY`) sits in the same checklist
un-highlighted as more or less important.

**Fix:** removed `VITE_SESSION_KEY` and its surrounding "must change"
guidance from `frontend/.env.example`, `frontend/setup.sh` (all three
mentions), `CLAUDE.md`'s Frontend env var table, and
`docs/ONBOARDING_FLOW.md`'s production checklist. Left
`docs/review-log.md`'s historical entry (which added the variable to
`CLAUDE.md` back when it was genuinely read) untouched — it is an append-only
dated log of a past review tick, not living documentation, and rewriting it
would misrepresent what was true at the time it was written.

### ONB-30-3 — MED (flagged, not fixed) — `/test/email`'s self-hosted SMTP path has no SSRF/private-network protection

`POST /onboarding/test/email` with `platform: "selfhosted"` or `"other"`
routes to `email_test_helper.test_smtp_connection`
(`email_test_helper.py:33-217`), which takes a fully client-supplied
`smtpHost`/`smtpPort` from the request body and connects directly via
`smtplib.SMTP`/`SMTP_SSL` — no hostname/IP validation of any kind. This is the
**only** place in the codebase that makes a client-directed outbound network
connection without going through `app.utils.url_validator`'s
`assert_outbound_url_safe`/`validate_integration_url` (used everywhere else a
client supplies a destination: webhooks, Slack/Discord/Teams, Cal.com, push
subscriptions, external-training providers) — because those are all
HTTP(S)-URL based and this is a raw host:port SMTP connection, the existing
helper doesn't apply as-is.

**Why this is reachable pre-auth:** `test_smtp_connection` requires a valid
onboarding session (`validate_session`, confirmed at `onboarding.py:1356`),
but obtaining one requires only `POST /start`, which succeeds for anyone
until the first organization is created (`get_or_create_session` blocks new
sessions only once an org exists). So during the bootstrap window — after
deployment, before the real administrator finishes setup, which can be
minutes to hours on a network-reachable instance — any caller can mint a
session (rate-limited, own scope) and then repeatedly call `/test/email`
(also rate-limited, own scope — so an attacker gets an independent 5-req/60s
budget just for this probe) with an arbitrary internal `smtpHost`/`smtpPort`.

**What it discloses:** the exception handling in `test_smtp_connection`
returns materially different messages for connection-refused
(`SMTPConnectError`), timeout (`TimeoutError`/"timed out" in `SMTPException`),
unresolvable hostname ("name or service not known"), and reachable-but-wrong-
protocol (`SMTPServerDisconnected`, SSL/TLS errors) — enough to fingerprint
whether _something_ is listening on an internal `host:port`, distinguishing
open/closed/filtered, without extracting any data (`smtplib` only speaks the
SMTP protocol over the socket; it cannot be turned into an HTTP GET against,
e.g., a cloud metadata endpoint the way the URL-based SSRF class can).

**Why this is flagged rather than fixed:** the obvious fix — reject
private/internal IP ranges, mirroring `url_validator._is_private_ip` — would
be **wrong** for this specific endpoint. Unlike the webhook integrations
(Slack, Discord, Teams, generic webhook), which are policy-restricted to
public HTTPS endpoints on purpose, an on-premises SMTP relay reachable only
from the department's internal network is a normal, expected deployment
pattern for exactly the kind of organization this app serves — blocking
private IPs here would break legitimate setups, not just attacker probes.
Scoping a narrower block (e.g., only the cloud-metadata hostnames in
`url_validator.BLOCKED_HOSTNAMES`) would add complexity for close to zero
real protection, since `smtplib` can't turn a metadata-service HTTP response
into anything useful — it would just fail the SMTP handshake differently,
which is itself still a (weaker) fingerprinting signal. This is a genuine
product-policy question — how much reconnaissance capability is acceptable on
an unauthenticated bootstrap route, versus how much would break real
self-hosted-mail deployments — not a bug with an obviously-correct fix, so per
the task's guidance this is flagged for a documented decision rather than
guessed at. Mirrored in `docs/KNOWN_LIMITATIONS.md`.

The three other test paths (`test_gmail_oauth`, `test_microsoft_oauth`,
`test_cloudflare_email`) were checked for the same class and are **not**
affected: every URL they call is a hardcoded `https://` literal
(`_https_urlopen` additionally rejects any non-https scheme, guarding against
a future refactor widening it), and Microsoft's client-supplied `tenant_id` is
interpolated only into the URL **path** of a fixed-host string
(`f"https://login.microsoftonline.com/{tenant_id}/..."`) — HTTP path content
cannot redirect the TCP connection to a different host, so this is not a host-
redirection vector. **Verified good, no finding.**

## Still flagged, re-confirmed unchanged (no new information, not re-applied)

- **ONB-7** — role editor accepts client-supplied permissions/priority/
  system-flag on new roles — product-policy decision, `KNOWN_LIMITATIONS.md`.
- **ONB-8 residual (audit durability)** — `reset_initiated` is logged in the
  same transaction as `/reset`'s deletes; a failed reset rolls back its own
  audit trail too. Transaction-boundary change, deferred for care.
- **ONB2-30-8** — session TTL is a sliding 30-minute window with no absolute
  cap; three GET routes slide it on the session id alone (no CSRF). Policy
  call (what should the cap be, would it clip legitimate wizard navigation).
- **Role/position dedup** (app-review pass 2) — a duplicate `role.id` within
  one `/session/roles` payload still raises an unhandled `IntegrityError` →
  500 rather than a clean 400. Pre-existing, larger fix than a cap.
- **`POST /organization` missing the `except Exception`** its twin
  `/session/organization` has (app-review pass 2) — no info leak
  (`safe_error_detail`/production `DEBUG=false` still apply to anything that
  _does_ raise inside the `try`), just an unhandled-exception path that skips
  the friendlier 500 message. Cosmetic robustness gap, not security.
- **`ITTeamMemberRequest.email` is `str`, not `EmailStr`** (pass 1) — kept
  loose intentionally, matching `create_it_team_users`'
  skip-if-invalid-rather-than-reject behavior.

## Additional checks this pass

- **LIKE/ILIKE:** zero `.like()`/`.ilike()` calls in any of this feature's
  files. N/A.
- **CSV/export injection:** no CSV export in this feature. N/A.
- **Secrets in responses:** re-checked every response model
  (`SystemOwnerResponse`, `StartSessionResponse`, `SessionDataResponse`, the
  `/session/data` handler's `safe_data` allowlist) — no password, API key, or
  encrypted-blob ciphertext is ever echoed back. `/system-owner` still sets
  auth exclusively via httpOnly cookies (`_set_auth_cookies`), never a token
  in the JSON body.
- **JSON-column mutation (Pitfall #12):** every `/session/*` handler mutates
  `session.data` via `session.data = session.data or {}` then a **top-level**
  key assignment (`session.data["email"] = {...}`) on the
  `MutableDict.as_mutable(JSON)` column — auto-tracked, no nested
  dict-then-reassign pattern found. `_persist_session_data_to_org` correctly
  `copy.deepcopy(organization.settings or {})`s before mutating nested keys
  (`onboarding.py:658`). `OnboardingService.configure_modules` does the same
  (`services/onboarding.py:1279`). No violation.
- **Schema/migration integrity:** `onboarding_status`, `onboarding_sessions`
  (and `onboarding_checklist`, unused by current routes) are all created by
  `20260201_0018_create_onboarding_tables.py` — a real migration, not
  `create_all`-only — with matching nullability/index/unique constraints
  against the models. No `ondelete="SET NULL"` FK in either active model.
  `validate_migrations.py --strict`: 394 revisions, single head, clean.
- **Tenant isolation (XC-1/XC-3):** this feature is single-org by design
  (ONB-2's guards), so there is no second tenant to leak across; every
  `organization_id` used in `/session/stations`, `/session/apparatus`,
  `/session/roles` etc. is read from the session's own
  `data["department"]["organization_id"]`, set only by that same session's
  own `/session/organization` call — not client-suppliable as a bare
  parameter. N/A beyond what ONB-2 already established.

## Completion gate

| Check                                                              | Result                                                 |
| ------------------------------------------------------------------ | ------------------------------------------------------ |
| `flake8 app/ tests/ alembic/`                                      | ✅ 0 violations                                        |
| `black --check app/ tests/ alembic/`                               | ✅ clean (1339 files unchanged)                        |
| `isort --check-only app/ tests/ alembic/` (pinned 8.0.1, CI match) | ✅ clean                                               |
| `python3 scripts/validate_migrations.py --strict`                  | ✅ 394 revisions, single head                          |
| `pytest tests/ -k "onboard or template_service"`                   | ✅ **109 passed, 1 skipped**                           |
| `pytest tests/test_onboarding_rate_limit_scopes.py -v`             | ✅ **9 passed** (was 7)                                |
| `pytest tests/test_security_middleware.py`                         | ✅ **80 passed**                                       |
| Guard-test reintroduction check (fix reverted)                     | ✅ fails as expected (2 failures)                      |
| `tsc --noEmit` (frontend)                                          | ✅ 0 errors                                            |
| `eslint .` (frontend)                                              | ✅ 0 errors, 8 pre-existing warnings (unrelated files) |
