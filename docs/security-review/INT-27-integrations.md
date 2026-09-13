# Security Review — Integrations

**Prefix:** `INT` · **Iteration:** 27 · **Reviewed:** 2026-09-13 (pass 4, rotation pass 4), 2026-09-06 (pass 3, rotation pass 3), 2026-08-31 (pass 2, rotation pass 2) · **PR:** #2508 (pass 4); #2307 (pass 3); #2087 (pass 2, merged); #1910 (pass 1, merged)

---

## Pass 4 (2026-09-13) — one fix (a known, tracked gap closed), one new flagged finding, everything else re-verified

**Backend:** `app/api/v1/endpoints/integrations.py` (849 L, 7 routes),
`app/api/v1/endpoints/salesforce_sync.py` (586 L, 9 routes),
`app/api/v1/endpoints/calcom_sync.py` (73 L, 1 route),
`app/api/v1/endpoints/mcp_keys.py` (244 L, 4 routes — mounted at
`/integrations/claude-mcp` under the same `module_gate("integrations", ...)`
as the other three files; reviewed at the route/permission level per this
pass's scope, deeper MCP internals left to the existing out-of-scope carve-out
below), `app/api/public/integrations_webhook.py` (258 L, 2 public routes),
`app/api/public/salesforce_webhook.py` (246 L, 1 public route),
`app/api/public/paypal_webhook.py` (153 L, 1 public route),
`app/services/integration_services/*` (base.py, calcom_service.py,
slack/discord/teams/webhook_service.py, documenso_service.py,
paypal_service.py, salesforce_service.py, salesforce_oauth_service.py,
salesforce_sync_service.py, google_calendar_service.py,
outlook_calendar_service.py, weather_service.py, notification_dispatch.py,
`__init__.py` dispatcher — all read in full this pass), `models/integration.py`,
`schemas/integration.py`.
**Frontend:** `pages/IntegrationsPage.tsx` (2081 L), `hooks/useConnectedIntegrations.ts`,
`components/integrations/McpServiceKeyPanel.tsx`, `modules/integrations/*` —
read in full. Prior passes explicitly scoped the frontend out ("not reviewed
this pass — backend only"); this is the first pass in this file's history to
read it, and it is what surfaced INT-11 below.
**Migrations:** none this pass (443 revisions, single head, unchanged).

### Scope

Re-verified every standing finding (INT-1 through INT-9) against current code
rather than assuming pass 3's verdicts still hold, then did a fresh full read
of every backend file this feature owns (all byte-for-byte close to pass 3's
sizes — `integrations.py` 841→849 L from an unrelated `git log` artifact of
this environment's squashed history, not a real content diff; content
confirmed identical to pass 3's documented state by direct read) plus, for the
first time in this file, the frontend module. Also read `mcp_keys.py` at the
route/permission/org-scoping level, since it is mounted under
`/integrations/claude-mcp` behind the same `module_gate` as the rest of this
feature's routes — narrower than a full MCP-internals review, which stays
out of scope per pass 3's own precedent (the wider `app/mcp/*` package has its
own `KNOWN_LIMITATIONS.md` entry, outside this rotation).

### Route inventory (re-verified, +4 routes since pass 3 — `mcp_keys.py` now enumerated)

| Method | Path                                       | Auth dependency           | Permission                                       | Org-scoped                                  | Notes                                               |
| ------ | ------------------------------------------ | ------------------------- | ------------------------------------------------ | ------------------------------------------- | --------------------------------------------------- |
| GET    | `/integrations`                            | `require_permission`      | `integrations.manage`                            | yes (query filter)                          | INT-3                                               |
| GET    | `/integrations/connected`                  | `get_current_user` (bare) | none                                             | yes (query filter)                          | INT-3 carve-out, deliberate                         |
| GET    | `/integrations/{id}`                       | `require_permission`      | `integrations.manage`                            | yes (id+org)                                |                                                     |
| POST   | `/integrations/{id}/connect`               | `require_permission`      | `integrations.manage`                            | yes (id+org)                                |                                                     |
| POST   | `/integrations/{id}/disconnect`            | `require_permission`      | `integrations.manage`                            | yes (id+org)                                | revokes MCP keys, `require_audit_entry`-gated       |
| PATCH  | `/integrations/{id}`                       | `require_permission`      | `integrations.manage`                            | yes (id+org)                                |                                                     |
| POST   | `/integrations/{id}/test-connection`       | `require_permission`      | `integrations.manage`                            | yes (id+org)                                |                                                     |
| GET    | `/integrations/salesforce/status`          | `require_permission`      | `integrations.manage`                            | yes                                         |                                                     |
| POST   | `/integrations/salesforce/push/members`    | `require_permission`      | `integrations.manage`                            | yes                                         |                                                     |
| POST   | `/integrations/salesforce/push/training`   | `require_permission`      | `integrations.manage`                            | yes                                         |                                                     |
| POST   | `/integrations/salesforce/push/events`     | `require_permission`      | `integrations.manage`                            | yes                                         |                                                     |
| POST   | `/integrations/salesforce/pull/contacts`   | `require_permission`      | `integrations.manage`                            | yes                                         |                                                     |
| GET    | `/integrations/salesforce/readiness`       | `require_permission`      | `integrations.manage`                            | yes                                         |                                                     |
| POST   | `/integrations/salesforce/preview/members` | `require_permission`      | `integrations.manage`                            | yes                                         | read-only                                           |
| GET    | `/integrations/salesforce/oauth/authorize` | `require_permission`      | `integrations.manage`                            | yes                                         | 302 to Salesforce                                   |
| GET    | `/integrations/salesforce/oauth/callback`  | **none**                  | n/a                                              | yes (id+org from signed state)              | public by design, JWT state + nonce cookie          |
| GET    | `/integrations/calcom/bookings`            | `require_permission`      | `integrations.manage`                            | yes                                         |                                                     |
| GET    | `/integrations/claude-mcp/status`          | `require_permission`      | `integrations.manage` OR `integrations.mcp_keys` | yes                                         |                                                     |
| GET    | `/integrations/claude-mcp/keys`            | `require_permission`      | `integrations.manage` OR `integrations.mcp_keys` | yes                                         |                                                     |
| POST   | `/integrations/claude-mcp/keys`            | `require_permission`      | `integrations.mcp_keys`                          | yes                                         | tighter than read; `require_audit_entry`-gated      |
| DELETE | `/integrations/claude-mcp/keys/{key_id}`   | `require_permission`      | `integrations.mcp_keys`                          | yes (`get_key(org_id, key_id)`)             | `require_audit_entry`-gated                         |
| POST   | `/public/v1/webhooks/documenso/{id}`       | none                      | n/a                                              | yes (resolved via id-matched `Integration`) | public, HMAC/shared-secret, replay-protected        |
| POST   | `/public/v1/webhooks/calcom/{id}`          | none                      | n/a                                              | yes                                         | public, HMAC, replay-protected                      |
| POST   | `/public/v1/webhooks/salesforce/{id}`      | none                      | n/a                                              | yes                                         | public, HMAC, replay-protected, 500-record cap      |
| POST   | `/public/v1/webhooks/paypal/{id}`          | none                      | n/a                                              | yes                                         | public, PayPal-verified signature, replay-protected |

25 routes, all enumerated (21 authenticated/permission-gated + 4 intentionally
public with a named compensating control). No route relies on
`require_permission` alone to scope its object (checklist 14b) — every by-id
route resolves its target through an `id` + `organization_id` filter in the
same query, confirmed by direct read of every handler, not sampled.

### Re-verified from passes 1–3 (all hold)

- **INT-1** (send-time SSRF re-validation, `assert_outbound_url_safe`): intact
  in `calcom_service.py`, `slack_service.py`, `discord_service.py`,
  `teams_service.py`, `webhook_service.py` — each calls it immediately before
  the outbound request, confirmed by direct read of every connector this
  pass, not grep alone.
- **INT-2** (OAuth `error` URL-encoded): intact, `salesforce_sync.py:419`.
- **INT-3** (list/get gated on `integrations.manage`; `/connected`
  status-only on bare auth, registered first): intact,
  `integrations.py:464-517`.
- **INT-4** (`exclude_unset` partial-PATCH merge): intact, `integrations.py:345`.
- **INT-5** (uninvoked `KNOWN_WEBHOOK_DOMAINS` allowlist): unchanged, still an
  explicit owner decision, `app/utils/url_validator.py`.
- **INT-6** (connector exception sanitization via `sanitize_connector_error`):
  intact at `integrations.py:848`, `salesforce_sync_service.py:664`/`704`, and
  the three non-interpolating re-raises in `google_calendar_service.py`,
  `outlook_calendar_service.py`, `weather_service.py`.
- **INT-7** (`_SizeLimitedTransport` response-size cap): intact,
  `base.py:98-139`, wired into `create_integration_client()`.
- **INT-8** (`http1`/`http2`/`cert` kwargs reaching the wrapped transport):
  intact, `base.py:212-386`.
- **INT-9** (Google Calendar bypasses the shared HTTP hardening — no size cap,
  no future wall-clock deadline): still open, still correctly scoped to
  `google_calendar_service.py`'s `googleapiclient`/`httplib2` transport, which
  never reaches `create_integration_client()`. `KNOWN_LIMITATIONS.md`'s entry
  is current and accurate; re-verified rather than re-derived.
- **SOQL injection defense** (`_soql_quote`/`_soql_identifier`,
  `salesforce_sync_service.py:131-149`): every dynamic SOQL construction site
  (`_find_contact_by_email:314`, `_find_record_by_external_id:735-737`) still
  uses them; `pull_contacts`' `LastModifiedDate > {ts}` interpolation
  (line 419) is a server-formatted `datetime` (`integration.last_sync_at`),
  never user input, so it carries no injection surface.
- **Instance-URL domain pinning** (`salesforce_service.py`): `_INSTANCE_URL_RE`
  now also gates `_api_url()` itself (`:157-175`), not only the token-refresh
  path — confirmed still the case, closing the gap the file's own docstring
  there describes (a cached access token skips `_refresh_access_token()`
  entirely, so without this second gate an admin-editable `instance_url`
  would reach every request URL, with the live bearer token attached,
  unvalidated).
- **Secret handling** (`models/integration.py`): secrets live only in
  `encrypted_config` (AES-256 via `app/core/security.encrypt_data`), decrypted
  only through `get_secret()`; `_sanitize_config` redacts any
  `_SECRET_KEY_PATTERN`-matching key before a response is built. No endpoint
  response includes a raw secret — confirmed by reading every response
  builder in `integrations.py`/`salesforce_sync.py`/`calcom_sync.py`, not
  assumed.
- **Frontend cache exclusion**: `/integrations` is in `apiCache.ts`'s
  `UNCACHEABLE_PREFIXES` (SEC-00's SEC4-3 pin covers it), and
  `integrationsService` is built on the shared, CSRF/auth-wired
  `services/apiClient.ts` — not a bespoke module axios instance (Pitfall #7
  n/a; there is only one client here).
- **Webhook replay dedup** (`app/utils/webhook_replay.py`): Redis-backed,
  10-minute TTL, fails open (not drops) when Redis is unavailable — bounded,
  no Pitfall #9 tracker concern.

### Findings

#### INT-10 — MED — `documenso_service.py` never re-validated its outbound URL at send time — ✅ FIXED

**What:** `KNOWN_LIMITATIONS.md`'s "Outbound Integration Requests" entry
(found by the training-extended rotation's pass 4, added 2026-09-10) named
`documenso_service.py` as the one `create_integration_client`-family connector
with **no** `assert_outbound_url_safe` call anywhere in the file — worse than
its five siblings (which at least narrow the DNS-rebinding TOCTOU window),
this one had no send-time re-check at all. Since Documenso is this feature's
own file, closing the documented "first step" (adding the missing call, matching
`calcom_service.py`'s identical `_assert_base_url_safe()` shape) belongs to
this rotation pass rather than waiting for another feature to stumble onto it
again.
**Where:** `backend/app/services/integration_services/documenso_service.py` —
`test_connection()` (the only currently-invoked path, via the
`test_integration_connection` dispatcher) and `create_document()` (not yet
wired to any route, but part of this class's public API).
**Failure scenario:** a department points a self-hosted Documenso instance's
`api_base_url` at a hostname that resolves to a public IP at config-save time
(passing `validate_integration_url`) and is later re-pointed (DNS rebinding)
at `169.254.169.254`/`127.0.0.1`/an internal host. Every sibling connector
(Cal.com, Slack, Discord, Teams, generic webhook) would refuse the request at
send time; Documenso's `test_connection()`/`create_document()` would not —
the only thing standing between the request and an internal service was the
save-time check, whose window was the entire lifetime of the stored config.
**Impact:** MED — SSRF against internal infrastructure, gated behind
`integrations.manage` (an org admin must have configured the integration), so
not attacker-reachable without that permission, but a real gap relative to
every sibling connector doing the equivalent request.
**Fix:** added `_assert_base_url_safe()` (identical shape and docstring intent
to `calcom_service.py`'s own method) and call it before the request in both
`test_connection()` and `create_document()`. This is the "narrowed, not
closed" TOCTOU shape the other five connectors already have — it does not
pin the resolved address the way `external_training_service.py`'s
`SSRFSafeAsyncTransport` does; that larger cross-cutting fix (resolve once,
connect to the pinned IP, preserve Host/SNI) remains tracked, unfixed, for all
six `create_integration_client`-family connectors in
`KNOWN_LIMITATIONS.md`'s "Outbound Integration Requests" entry, updated below
to reflect that `documenso_service.py` is no longer the _worse_ case (no
check at all), only the same "narrowed, not closed" case as its siblings.
**Guard tests:** `backend/tests/test_integration_services.py::TestDocumensoPayload::test_connection_blocks_unsafe_base_url`
and `::test_create_document_blocks_unsafe_base_url` — each patches
`assert_outbound_url_safe` to raise, asserts the exception propagates
(fail-closed), and asserts `create_integration_client` is never called (proves
the check runs _before_ any request, not merely somewhere in the method).
Both verified to fail against the pre-fix code (`AttributeError: ... does not
have the attribute 'assert_outbound_url_safe'`, since the import did not
exist) via `git stash` on just this file, and to pass after.

#### INT-11 — LOW-MED — Salesforce's "blank the refresh token to switch to client credentials" feature has no reachable frontend control — 🚩 FLAGGED

**What:** `connect_integration`/`update_integration`
(`integrations.py:568-572`, `:720-724`) special-case an explicit
`config["refresh_token"] == ""` on a Salesforce integration: it clears the
stored `refresh_token` _and_ `access_token`, switching the integration from
the interactive OAuth grant to Salesforce's client-credentials flow on the
next sync. This requires the wire payload to contain the literal key/value
pair `"refresh_token": ""`. `IntegrationsPage.tsx:585` builds the Salesforce
config as `refresh_token: sfRefreshToken || undefined` — when the field is
blank, this is `undefined`, which `JSON.stringify` (and therefore the request
body axios sends) **omits entirely**, not `""`. Grepped the whole file for
any other place that could send an explicit empty string for this field —
none exists; the field only reaches the backend as either a real token or
absent.
**Where:** `frontend/src/pages/IntegrationsPage.tsx:580-590` (the Salesforce
branch of `getConfigFromForm`); the backend behavior it can never trigger is
`backend/app/api/v1/endpoints/integrations.py:568-572` (connect) and
`:720-724` (update).
**Failure scenario:** an IT administrator who previously pasted a
colleague's personal Salesforce refresh token (interactive OAuth) wants to
switch the org to the Connected App's own client-credentials flow — the
documented, intended way to do this is to clear the Refresh Token field and
save. Clearing the field and saving does nothing: the key is omitted from the
payload, the backend's merge (`{**stored, **public_config}`) leaves the
stored `refresh_token`/`access_token` untouched, and every subsequent sync
keeps authenticating as whoever the old refresh token belonged to — silently,
with no error, and no way for the admin to tell from the UI that their intent
was not carried out (the form has no separate confirmation of which auth mode
is currently active). If that person leaves the department or Salesforce
revokes their session, sync failures start with no visible link back to "the
field I cleared didn't do what its own tooltip position implies."
**Impact:** LOW-MED. Not attacker-reachable (requires `integrations.manage`
and the admin's own mistaken belief that clearing the field did something) —
this is a credential-lifecycle correctness gap, not a leak or an escalation.
Flagged rather than fixed because closing it is a product decision between at
least two shapes (a distinct "Switch to Client Credentials" button/checkbox
that sends the explicit `""`, versus changing the field's semantics so a
blank submission always means "clear," which would itself need its own
review against every _other_ field this form treats as "blank = leave
unchanged" — CSV3-style scope creep this pass should not decide unilaterally).
**Mirrored:** `docs/KNOWN_LIMITATIONS.md`, new entry below.

### Checked, no new finding

- **Abuse resistance on the sync-trigger endpoints**
  (`push/members`/`push/training`/`push/events`/`pull/contacts`): none of the
  four carry a rate-limit dependency, and each runs synchronously within the
  request (no background task), so a large org's push could hold the request
  open for a while. Not flagged: the actor must already hold
  `integrations.manage`, the work is bounded by the org's own data (not
  attacker-controlled), and the effect (a slow request, a duplicate
  Salesforce Contact if two pushes race) is self-inflicted within the org's
  own tenant, not a cross-tenant or resource-exhaustion vector against the
  platform. Consistent with three prior passes not flagging this; recorded so
  the next pass does not re-derive the question from scratch.
- **`mcp_keys.py`'s four routes**: enumerated in the route inventory above.
  `DELETE /keys/{key_id}` resolves via `McpKeyService.get_key(org_id, key_id)`
  (`app/mcp/keys.py:155-163`), which filters both — confirmed by direct read,
  closing the one route in this file with a client-supplied id (checklist
  14a). No new finding; this is the first pass to enumerate these routes
  rather than treating the whole file as out of scope.
- **`nfc-id-cards`/coming-soon catalog entries with no `INTEGRATION_CONFIG_SCHEMAS`
  entry** (`active911`, `google-maps`, `zapier`, `whatsapp`, `imagetrend`,
  `eso-solutions`, `nremt`, `firstwatch`, `pulse-point`, `nfc-id-cards`): PATCH
  (unlike POST `/connect`) does not check `status == "coming_soon"`, so an
  admin can write arbitrary JSON into a not-yet-implemented integration's
  public config. No schema means no `extra="forbid"` and no secret-key
  restriction beyond the generic `SECRET_CONFIG_KEYS` split, but this is the
  org's own admin writing to the org's own row — no cross-tenant or
  injection surface. `nfc-id-cards` itself stores no config at all in
  practice (`app/utils/nfc_integration.py` reads only `enabled`/`status`).
  Not flagged — a data-quality nit, not a security finding.
- **JSON-column mutation** (`integration.config`): every write in this
  feature is a flat top-level merge (`{**stored, **new}`) or a `dict()` copy
  with only top-level key assignment (`salesforce_sync.py:564-568`) — no
  nested-mutation-on-shared-reference shape anywhere in this feature
  (Pitfall #12 n/a here, consistent with SEC-00 pass 4's sweep 9).
- **LIKE-pattern usage**: none in this feature (`grep -rn "\.like(\|\.ilike("`
  across every file in scope: zero hits). Checklist §4's LIKE item is n/a.

## Schema & migration notes

None — no model or migration change this pass. `validate_migrations.py
--strict`: 443 revisions, single head, unchanged from before this pass.

## Guard tests added

| Test                                                                                              | Invariant asserted                                                                                                                                              |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test_integration_services.py::TestDocumensoPayload::test_connection_blocks_unsafe_base_url`      | `DocumensoService.test_connection()` re-validates `api_base_url` at send time and fails closed before any request; fails on reintroduction of the missing call. |
| `test_integration_services.py::TestDocumensoPayload::test_create_document_blocks_unsafe_base_url` | Same guard on `create_document()`.                                                                                                                              |

## Completion gate (pass 4)

| Check                                                                                                                       | Result                                           |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `flake8 app/ tests/ alembic/`                                                                                               | ✅ 0 violations                                  |
| `black --check app/ tests/ alembic/`                                                                                        | ✅ 1586 files unchanged                          |
| `isort --check-only app/ tests/ alembic/`                                                                                   | ✅ clean (isort 9.0.1, CI's pinned version)      |
| `python3 scripts/validate_migrations.py --strict`                                                                           | ✅ 443 revisions, single head, PASSED            |
| backend tests, scope (`-k "integration or salesforce or calcom or documenso or paypal or webhook or connector or mcp_key"`) | ✅ 2690 passed, 21 skipped (env-only), 0 failed  |
| backend tests, full suite (`pytest tests/ -q`)                                                                              | ✅ 12450 passed, 21 skipped (env-only), 0 failed |
| `tsc --noEmit` (frontend)                                                                                                   | ✅ 0 errors                                      |
| `eslint --max-warnings 10` (frontend)                                                                                       | ✅ 0 errors, 0 warnings                          |

---

## Pass 3 (2026-09-06) — one new finding (dead safeguard), everything else re-verified

**Scope of growth since pass 2:** `integrations.py` grew 710 → 841 lines (+131);
`salesforce_sync.py` (585), `salesforce_service.py` (447),
`salesforce_oauth_service.py` (161) are byte-identical; `salesforce_sync_
service.py` grew 958 → 966 (+8, unrelated to security — no new call site of
either eviction/audit/exception-handling logic). Read all backend files in
this feature's declared scope in full, plus `calcom_sync.py`,
`app/api/public/integrations_webhook.py` (public, inbound webhooks — not
explicitly enumerated in pass 2's file list) and
`app/services/integration_services/base.py`, `__init__.py` (the connector
dispatcher), neither of which pass 1/2 read in full either.

**The +131 lines in `integrations.py` are new Claude (MCP) integration
glue** (`claude-mcp` catalog entry + `ClaudeMcpConfig` schema, `_test_mcp_
connection`, MCP-service-key revocation on disconnect, `require_audit_entry`
gating on the MCP config update path) plus new `nfc-id-cards` and `paypal`
catalog entries. **The wider MCP module (`app/mcp/*`, ~5,000+ L) is not a
declared file of this feature and already carries its own
`KNOWN_LIMITATIONS.md` entry from outside this rotation** — the same scope
line Feature 15 (Scheduling, pass 3) drew for its own MCP tool file; not
duplicated here. What _is_ in scope is the glue inside `integrations.py`
itself, reviewed below.

### Route inventory (re-verified, unchanged counts)

`integrations.py`: 7 routes, same set as pass 2 (no new route — the MCP glue
lives inside the existing `connect`/`disconnect`/`update`/`test-connection`
handlers, all still `require_permission("integrations.manage")` + id+org
filter). `salesforce_sync.py`: 9 routes, unchanged. `calcom_sync.py`: 1 route
(`GET /bookings`, `integrations.manage`, org-scoped via `_get_calcom_
integration`). `app/api/public/integrations_webhook.py`: 2 intentionally
public routes (`POST /documenso/{id}`, `POST /calcom/{id}`) — both rate
limited (30/min/IP), reject any integration with no configured
`webhook_secret` (fail closed), verify HMAC/shared-secret with
`hmac.compare_digest`-based helpers, replay-protected
(`is_duplicate_webhook`), and resolve the acting org from the id-matched
`Integration` row rather than from the payload.

**Correction (Codex round, 2026-09-06):** the count above stopped one file
short. `main.py` mounts two more public webhook routers immediately before
`integrations_webhook_router` — `app/api/public/salesforce_webhook.py`
(`POST /public/v1/webhooks/salesforce/{integration_id}`) and
`app/api/public/paypal_webhook.py` (`POST /public/v1/webhooks/paypal/
{integration_id}`) — neither inspected in this pass nor in pass 2, despite
PayPal being listed as reviewed and clean below. Read both in full: **21
endpoints across six files**, not 19 across four. Both hold up to the same
checklist dimensions the rest of this pass used —

- **`salesforce_webhook.py`:** HMAC-SHA256 verified with
  `hmac.compare_digest`; an integration with no `webhook_secret` configured
  is rejected (401), not silently trusted; rate limited (30/min/IP) — but
  **correction (Codex round, 2026-09-06): the 5-minute lockout an earlier
  version of this entry claimed does not exist.** `_rate_limit_webhook()`
  calls `public_rate_limit(..., window_seconds=60)` with no
  `lockout_seconds`, which defaults to `0`. On the Redis path (the common
  case) this is moot regardless: `app.core.security.is_rate_limited` — what
  `public_rate_limit` actually calls for the distributed, Redis-backed
  check — has no `lockout_seconds` parameter at all, only a sliding window;
  it is a pure `limit`-per-`window_seconds` check with nothing to add a
  lockout to. `lockout_seconds` only reaches the in-memory fallback used
  when Redis is unavailable, and there it is `0` too, so that path also has
  no additional lockout beyond the 60-second window. In both cases, a
  request that hits the limit simply resumes once its own timestamp ages
  out of the 60-second sliding window, not after an extra 5-minute block;
  replay-protected (`is_duplicate_webhook`, correctly
  ordered _after_ shape validation so a rejected payload's fingerprint
  can't be poisoned — see the file's own comment); a `records` array is
  capped at 500 per request; the acting org comes from
  `integration.organization_id` on the id-matched row, never the payload.
  One inaccuracy fixed in the file's own docstring: it claimed payload size
  was "limited by FastAPI / Uvicorn defaults" — neither imposes a body-size
  limit on its own; see the inbound-body-size note below for the real
  mechanism. Corrected in place.
- **`paypal_webhook.py`:** signature verification is delegated to PayPal's
  own `verify-webhook-signature` API (`paypal_service.verify_webhook_
signature`), which fails closed (returns `False`, never raises past the
  caller) on a missing `webhook_id`, missing signature headers, or a
  transport failure; rate limited (60/min/IP); replay-protected the same
  way; the acting org again comes from the id-matched `Integration` row.
  **Fixed (Codex follow-up round, 2026-09-06):** `paypal_service.py`'s own
  two outbound calls to PayPal (`get_access_token`,
  `verify_webhook_signature`) used a bare `httpx.AsyncClient(timeout=
_TIMEOUT)` rather than `create_integration_client()`, so they did not
  inherit the INT-7 fix below — flagged as low risk when first noted
  (`base_url` is one of two hardcoded PayPal API hosts, never
  client/org-supplied, so there's no SSRF or cross-tenant exposure, only
  the same class of unbounded-response memory risk INT-7 covers, against a
  single trusted vendor host) but still a real gap, and a CHANGELOG entry
  claiming the fix covered "every integration connector" while this one
  didn't was itself a second finding on this same round. Rather than leave
  the inconsistency and only correct the CHANGELOG's wording,
  `create_integration_client()` gained a `timeout=` override (defaulting to
  `INTEGRATION_TIMEOUT`, so every other call site is unaffected) and both
  PayPal call sites now pass their own tuned `Timeout(15.0, connect=10.0)`
  through it — closing the gap without the timeout regression that made
  bundling this into the original INT-7 pass undesirable. See
  `backend/tests/test_integration_response_size_cap.py`'s
  `test_create_integration_client_timeout_override_preserves_hardening` and
  the PayPal-specific size-cap tests added alongside it.

**Inbound webhook body size — nginx is deployment-conditional, but the
backend has its own cap regardless (Codex round, 2026-09-06).** Both files'
`request.body()` calls run before signature verification, on a public,
unauthenticated route, which makes body size a real question independent of
INT-7 (that finding is about _outbound_ response size). Checked two things
Codex raised:

1. **Is nginx actually in front of the backend?** No, not by default.
   `docker-compose.yml`'s `nginx` service is `profiles: [production]` —
   opt-in — while `backend` publishes directly on `${BACKEND_PORT:-3001}`
   with no profile gate, so the default (`docker-compose up`, no
   `--profile production`) stack has no nginx in the request path at all,
   and the documented standalone backend image can likewise run without
   it. So a claim that inbound webhook bodies are bounded by nginx's 50 MB
   `client_max_body_size` cannot be unconditional — it depends on a
   deployment choice this repo does not default to.
2. **Does anything else cap it?** Yes — `RequestSizeLimitMiddleware`
   (`app/core/security_middleware.py`, pure ASGI per CLAUDE.md pitfall #4)
   is registered in `main.py` as the **outermost** middleware
   (`app.add_middleware(RequestSizeLimitMiddleware, max_body_size=settings.
MAX_REQUEST_BODY_SIZE)`, added last so it wraps every other layer) and
   applies to every request the ASGI app receives, public webhook routers
   included, regardless of whether nginx is present. It rejects (413) up
   front when a declared `Content-Length` exceeds the cap, and separately
   counts streamed bytes and signals disconnect if a client omits or lies
   about `Content-Length` (chunked upload), so a request body cannot be
   silently unbounded either way. `settings.MAX_REQUEST_BODY_SIZE` defaults
   to 60 MB — pre-existing on `main`, not added by this PR or this pass.

**Net effect:** the "arbitrarily large body" DoS Codex described does not
hold as stated — the backend caps inbound bodies at 60 MB unconditionally,
independent of nginx. What _is_ real, and worth naming precisely rather than
leaving to an unconditional nginx claim: without nginx, an oversized body is
rejected only after the backend process has already accepted the connection
and started counting bytes (up to 60 MB before the `RequestSizeLimitMiddleware`
disconnect fires), whereas nginx in front would reject a body over its own
50 MB cap before the request reaches a backend worker at all. That's a real,
if minor, difference in how much per-request resource an anonymous flood can
make the backend absorb — not the unbounded gap originally described, so no
new finding (no "INT-8") is warranted; the existing control already closes
the unbounded case. This finding's own prior text (in INT-7's "Impact"
section, below) named nginx's cap as the relevant control for inbound
webhook bodies; corrected there to name `RequestSizeLimitMiddleware` as the
actually load-bearing, deployment-independent control, with nginx as an
additional, deployment-conditional layer in front of it — not the reverse.

### MCP glue reviewed (new since pass 2) ✅

- **`disconnect_integration`** revokes every MCP service key
  (`McpKeyService.revoke_all`, row-locked, org-scoped) when the `claude-mcp`
  integration is disconnected — a key must not outlive the connection it was
  issued under, or reconnecting would silently reinstate it. Each revocation
  is audit-logged and gated by `require_audit_entry` (`app/api/v1/endpoints/
mcp_keys.py`): if the audit write itself failed, the whole disconnect
  rolls back rather than silently revoking a key with no record — a
  deliberately stricter failure mode than this file's other audit calls
  (`log_audit_event` alone, which swallows its own failure), and the
  comment on `require_audit_entry` names why: a widened/rotated key with no
  record is exactly the failure the record exists to catch.
- **`update_integration`** applies the same `require_audit_entry` gate when
  the integration being updated is `claude-mcp` — a live service key's
  access is what a config change to `access_mode`/`expose_finance`/
  `expose_medical_screening`/`expose_full_schedule` widens or narrows, so an
  unrecorded change to it is treated the same as an unrecorded key change.
  Other integration types keep the existing best-effort `log_audit_event`.
- **`_test_mcp_connection`** makes no outbound call (nothing external to
  reach) — it reports whether the integration is connected and whether an
  active service key exists, reading `McpKeyService(db).active_keys(
integration.organization_id)` where `integration` was already fetched by
  id+org above. No new SSRF/tenant-isolation surface.
- **`ClaudeMcpConfig`** (`schemas/integration.py`): `extra="forbid"`, four
  boolean/enum switches, no secret-shaped or URL-shaped field — none of
  `_validate_urls_in_config`'s SSRF check or `_extract_secrets`' secret
  split apply to it, correctly (there is nothing in this config to
  SSRF-check or encrypt).

Deeper MCP internals (`app/mcp/keys.py`'s `McpKeyService`, `app/mcp/tools/*`,
redaction, transport auth) are out of this feature's declared scope per the
precedent above and were not re-derived; `active_keys`/`revoke_all`'s
signatures and locking were read only far enough to confirm the call sites
inside `integrations.py` use them correctly (org id passed, row-locked,
audit-gated).

### Findings

#### INT-7 — LOW-MED — `MAX_RESPONSE_SIZE` is declared, never enforced — ✅ FIXED (Codex round, 2026-09-06)

**What:** `app/services/integration_services/base.py` declared a 10 MB
`MAX_RESPONSE_SIZE` constant with a docstring claiming "response size
limits" as one of the hardened client's defaults. Nothing read this
constant anywhere in the codebase (`grep -rn MAX_RESPONSE_SIZE app/` — one
hit, its own declaration). `create_integration_client()` returned a plain
`httpx.AsyncClient` with no size-related config; every connector
(`calcom_service.list_bookings`, `documenso_service`, `salesforce_service._
request`, the chat senders) calls the client's non-streaming
`.get()`/`.request()` and then `.json()`/`.text`. This is not a new
regression; it has been true since the constant and docstring were written
(pre-dates pass 1), but no prior pass named it — `docs/module-audit/
integrations.md`'s "Tenant isolation" bullet listed "size cap" among the
base client's verified-good hardened defaults, which per this rotation's own
rule ("a claim in Verified good must name the mechanism that makes it true")
was not actually checked against the code; corrected in that doc.

**Originally flagged, not fixed, in this pass's first draft** on the belief
that enforcing the cap meant every connector's response-reading call site
switching from `client.get(url).json()` to `client.stream(...)` plus a
running-byte-count abort — a call-site-by-call-site change across roughly
ten connector files. **A Codex review round on this PR (#2307) challenged
that premise**, and it does not hold: httpx's non-streaming `AsyncClient.
send()` still fully drains `response.stream` via `Response.aread()` before
`.json()`/`.text` become available on _any_ call — `.get()`, `.post()`,
`.request()` included (`send()` calls `await response.aread()` whenever
`stream=False`, which is the default `.get()`/`.request()` use). That
stream is exactly what a wrapping transport controls, so the cap can be
enforced once, centrally, with **no connector call site changing at all**.

**Fix:** `base.py` now wraps its transport with a new `_SizeLimitedTransport`
(and `_SizeLimitedAsyncStream`), which intercepts `response.stream` in
`handle_async_request()` and aborts — raising `ResponseTooLargeError`
(`httpx.TransportError` subclass, so it's caught by every existing `except
httpx.TransportError` retry path the same as a connection/timeout failure,
and `sanitize_connector_error` (INT-6) treats it as an unvetted infra
failure rather than a hand-authored safe message) — once more than
`MAX_RESPONSE_SIZE` bytes have been read. `create_integration_client()`
builds its own `httpx.AsyncHTTPTransport(verify=True, limits=
INTEGRATION_LIMITS)` explicitly and wraps that, rather than letting
`httpx.AsyncClient` build its default transport, because passing an
explicit `transport=` makes `AsyncClient` ignore its own `verify=`/`limits=`
kwargs entirely (`AsyncClient._init_transport` only builds a transport from
them when `transport` is `None`) — moved onto the inner transport instead so
neither hardening default silently regresses.

Verified against a real `httpx.AsyncHTTPTransport` over an actual socket
(not just `httpx.MockTransport`) before writing the fix, to confirm the
mechanism holds against the real transport class this client uses, not only
a synthetic one — see the guard tests below for the equivalent, checked-in
version of that verification.

**Where:** `backend/app/services/integration_services/base.py` (the whole
fix — one file, as the Codex round predicted).

**Reachable population corrected (Codex round, 2026-09-06):** the original
"Impact" text below said every trigger for an outbound integration call
requires `integrations.manage`. That's wrong. `notify_entity_created`
(`app/services/integration_services/notification_dispatch.py`) fans out to
every enabled Slack/Discord/Teams webhook via `create_integration_client()`
the same as any other connector, and it is enqueued as a background task
from `create_event` (`events.manage`), `create_shift`
(`scheduling.manage`), and `create_record` (`training.manage`) — three
endpoints, none gated on `integrations.manage`. So the actual reachable
population for triggering an outbound chat-webhook request (and therefore
this finding, before the fix) is anyone holding any one of those three
module-manage permissions, not just an org's integration admin. The
"self-hosted third-party endpoint the admin configured" framing for the
_destination_ still holds — a member cannot point the webhook anywhere new
— but the _trigger_ is far broader than `integrations.manage` alone.

**Timeout semantics corrected (Codex round, 2026-09-06):** the original text
below described `INTEGRATION_TIMEOUT` as bounding "how long this can run per
request" (a 10s total). That's also wrong, and raises the pre-fix severity:
`httpx.Timeout(10.0, connect=5.0)` sets a 5s _connect_ timeout and a 10s
_read_ timeout applied to each individual socket read (confirmed against
the pinned httpx 0.28.1's own source — `httpx._config.Timeout` has no
"total" concept at all; every value it accepts maps to one of
connect/read/write/pool). A server that sends one chunk every 9 seconds
resets the read timer each time and can hold the connection open
indefinitely — a slow-drip availability scenario, not a bounded one. This
was corrected in `base.py`'s own comment on `INTEGRATION_TIMEOUT` (fixed
alongside the response-size cap, since both wrong claims sat in the same
file) and in `KNOWN_LIMITATIONS.md` below. It does not change what the fix
above closes — the size cap aborts on byte count, not elapsed time, so it
still stops the slow-drip scenario from consuming unbounded _memory_; the
unbounded-_time_ half of a slow-drip request is a distinct, still-open
gap, noted as a `KNOWN_LIMITATIONS.md` follow-up rather than fixed in this
pass (a genuine wall-clock deadline needs an `asyncio.timeout()`-style
wrapper around the whole request, not a `Timeout` tweak — but, per a Codex
correction on this same PR, that does not need every connector call site
touched: every connector already gets its client from
`create_integration_client()`, so the fix centralizes the same way this
pass's `_SizeLimitedTransport` did, via an `httpx.AsyncClient` subclass
constructed there whose `send()` wraps `super().send()` in
`asyncio.timeout(N)`).

**Impact (as originally written, now superseded by the two corrections
above):** ~~every trigger for an outbound integration call requires
`integrations.manage` (an org admin), so this is not directly reachable by
an unprivileged member~~ — struck through rather than deleted, so the
correction is visible in place. Inbound webhook bodies are a separate
question from this finding (outbound response size) — see the inbound
body-size note under "Route inventory" above; nginx's `client_max_body_size`
was never load-bearing for _this_ finding, since INT-7 is about a _response_
body from an admin-configured outbound destination, not a request body from
an inbound caller.

**Guard tests:** see "Guard tests added" below —
`backend/tests/test_integration_response_size_cap.py` (new file): a
transport-unit test that an oversized streamed response aborts with
`ResponseTooLargeError`, one confirming an under-limit response is
unaffected, a structural test that `create_integration_client()` actually
wires `_SizeLimitedTransport` in (so reverting the wiring — as opposed to
the wrapper logic — also fails a test), and an end-to-end test through a
real connector (`CalcomService.test_connection`) with only the network-
facing `httpx.AsyncHTTPTransport` replaced, proving the cap holds along the
real code path a connector call takes.

### Re-verified from pass 1/2 (all hold)

- **INT-1** (send-time SSRF re-validation): intact — re-checked
  `assert_outbound_url_safe` call sites directly (grep above) across
  calcom/discord/slack/teams/webhook services; unchanged from pass 2.
- **INT-2** (OAuth `error` URL-encoded): intact.
- **INT-3** (list/get gated on `integrations.manage`, `/connected`
  status-only on bare auth, registered first): intact, route table
  above confirms both routes and their comments in the source
  (`integrations.py:463-467`, `:483-493`) still state the rationale.
- **INT-4** (`exclude_unset` partial-PATCH merge): intact.
- **INT-5** (uninvoked `KNOWN_WEBHOOK_DOMAINS` allowlist): unchanged, still
  an owner behavior decision, not auto-applied.
- **INT-6** (connector exception sanitization, type-based via
  `sanitize_connector_error`): intact at all originally-fixed sites
  (`integrations.py:840`, `salesforce_sync_service.py:664`/`704`) plus the
  three re-raise-with-interpolation sites (google/outlook calendar, NWS
  weather) — re-checked via grep for `Exception(f"...{e}"/{exc})`-shaped
  interpolation across every connector file: zero hits, only safe
  hand-authored messages remain.
- **SOQL injection defense, OAuth state validation, instance-URL domain
  pinning, secret redaction, tenant isolation**: all re-confirmed against
  current code, no change since pass 2.

## Guard tests added

**Initial draft of this pass:** none — INT-7 was flagged as a design gap
rather than fixed, on the (mistaken) premise that closing it needed a
per-connector streaming-read change with no single safe interception point,
so there was no "revert this line, watch a test fail" shape to test against.

**Codex round, 2026-09-06:** that premise didn't hold (see INT-7 above), so
this pass now ships the fix and its guard tests together —
`backend/tests/test_integration_response_size_cap.py` (new file):

- `test_oversized_response_aborts_before_full_buffering` /
  `test_response_at_or_under_the_limit_is_unaffected` — a `_SizeLimitedTransport`
  wrapping an `httpx.MockTransport` that streams a response (via `stream=`,
  not `content=` — the latter eagerly materializes `Response._content`
  inside `MockTransport`'s dispatch call, before the wrapping transport gets
  a chance to intercept anything, so it doesn't exercise the real mechanism
  a live transport uses).
- `test_create_integration_client_wires_the_size_limited_transport` — a
  structural check that `create_integration_client()`'s returned client's
  `_transport` actually is a `_SizeLimitedTransport` with the right
  `max_bytes`; this is what fails if a future edit reverts the wiring in
  `create_integration_client()` even though the wrapper class itself (and
  the two tests above, which build their own instance directly) still pass.
- `test_real_connector_call_aborts_on_an_oversized_response` — end-to-end
  through `CalcomService.test_connection()` with only the network-facing
  `httpx.AsyncHTTPTransport` replaced, proving the cap holds along the real
  code path a connector call takes, not just in the transport unit tests.

All four pass after the fix; the first, third, and fourth fail (no
`ResponseTooLargeError`/no `_SizeLimitedTransport`) if `_SizeLimitedTransport`
or its wiring into `create_integration_client()` is reverted.

## Completion gate (pass 3)

| Check                                                                                 | Result                                                                                                                           |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                         | ✅ 0 violations                                                                                                                  |
| `black --check app/ tests/ alembic/`                                                  | ✅ 1503 files unchanged                                                                                                          |
| `isort --check-only app/ tests/ alembic/`                                             | ✅ clean                                                                                                                         |
| `python3 scripts/validate_migrations.py --strict`                                     | ✅ 431 revisions, single head (`d7c1b95e2a40`), PASSED                                                                           |
| backend tests, scope (`-k "integration or salesforce or calcom or connector or nfc"`) | ✅ 2412 passed, 21 skipped (env-only), 0 failed                                                                                  |
| backend tests, full suite (`pytest tests/ -q`)                                        | ✅ 11472 passed, 21 skipped (env-only), 0 failed                                                                                 |
| `tsc --noEmit` (frontend)                                                             | ✅ 0 errors                                                                                                                      |
| `eslint .` (frontend)                                                                 | ✅ 0 errors, 3 pre-existing warnings (`ShiftDetailPanel.test.tsx`, unrelated/untouched, well under the `--max-warnings 10` gate) |

**One environment wrinkle, same shape as `SKT-19-skills-testing.md`'s pass 3
note — recorded here rather than as a finding.** This worktree started with
no `node_modules`; `npx eslint .`/`npx tsc --noEmit` initially fell back to a
global toolchain that could not resolve `@types/node`, producing 1032
spurious `@typescript-eslint/no-unsafe-*` warnings across unrelated files
(mostly Node-built-in access in test/tooling scripts) before `npm ci` (from
the worktree root) installed a real `node_modules` and both commands
returned the clean result in the table above. Recorded here so a future
reader does not mistake either number for a real `main`-red finding.

No frontend source file was touched this pass, so `tsc`/`eslint` verify no
regression rather than validate new code.

### Completion gate — Codex round (2026-09-06)

Re-run after the INT-7 fix and doc corrections above. No frontend file
touched in this round either, so `tsc`/`eslint` were not re-run — the
pass-3 table above still stands for those two checks.

| Check                                                                        | Result                                                                    |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                | ✅ 0 violations                                                           |
| `black --check app/ tests/ alembic/`                                         | ✅ 1504 files unchanged                                                   |
| `isort --check-only app/ tests/ alembic/`                                    | ✅ clean                                                                  |
| `python3 scripts/validate_migrations.py --strict`                            | ✅ 431 revisions, single head (`d7c1b95e2a40`), PASSED (no schema change) |
| new guard tests (`test_integration_response_size_cap.py`)                    | ✅ 4 passed                                                               |
| backend tests, scope (`-k "integration or salesforce or paypal or webhook"`) | ✅ 2374 passed, 21 skipped (env-only), 0 failed                           |
| backend tests, full suite (`pytest tests/ -q`)                               | ✅ 11476 passed, 21 skipped (env-only), 0 failed                          |

---

## Follow-up round 5 (2026-09-06) — transport kwargs silently dropped; Google Calendar's coverage gap named

### INT-8 — P2 — connection-affecting kwargs (`http2`, `http1`, `cert`) weren't applied to the wrapped transports — ✅ FIXED

**What:** `create_integration_client()`'s existing `**kwargs` interface lets a
caller pass any `httpx.AsyncClient` keyword through. For `http2=True`,
`http1=False` or `cert=...`, that flowed to `httpx.AsyncClient(...)` only —
and pinned httpx 0.28.1's `AsyncClient._init_transport()` returns whatever
`transport=` it was given immediately, without ever building a transport
from `verify`/`cert`/`trust_env`/`http1`/`http2`/`limits`:

```python
def _init_transport(self, ..., transport=None):
    if transport is not None:
        return transport
    return AsyncHTTPTransport(verify=..., cert=..., http1=..., http2=..., ...)
```

`create_integration_client()` always supplies an explicit `transport=` (the
size-limiting wrapper from INT-7), so the inner `AsyncHTTPTransport` this
factory builds never saw `http1`/`http2`/`cert` at all — it silently kept
HTTP/1 enabled, HTTP/2 disabled, and no client certificate regardless of
what the caller asked for, with no error and nothing on `AsyncClient` itself
reflecting the mismatch. Same shape as the `trust_env` gap fixed earlier
this round: an opt-out/opt-in on the client's own constructor arguments was
defeated by the factory's `transport=` override, just for a different set of
kwargs.

**Reproduced:** `create_integration_client(http2=True, trust_env=False)`
against pre-fix code had `client._transport._transport._pool._http2 ==
False`; the equivalent stock `httpx.AsyncClient(http2=True)` has it `True`.
A `cert=` pointed at a nonexistent file raised nothing pre-fix (silently
ignored) versus `FileNotFoundError` post-fix (proof the value now actually
reaches `AsyncHTTPTransport`'s SSL-context construction — same verification
shape as `test_create_integration_client_trust_env_false_transport_ignores_
env_ssl_vars` used for `trust_env`).

**Fix:** `http1`, `http2` and `cert` are pulled out as named parameters on
`create_integration_client()` (default `http1=True`, `http2=False`,
`cert=None`, matching stock httpx's own defaults) and forwarded to every
`AsyncHTTPTransport(...)` this module constructs — the default transport,
the explicit-`proxy=` mount, and each environment-derived proxy mount built
by `_environment_proxy_mounts()` (which also gained the same three
parameters). They're still passed to `httpx.AsyncClient(...)` too, matching
stock behavior byte-for-byte (including its `http2=True` → `import h2`
availability check, which now runs consistently with the transport actually
requiring `h2` to negotiate HTTP/2).

No current connector call site passes any of the three — this is the same
"future caller must not silently lose what it asked for" posture as the
`trust_env`/`proxy` parameters already documented in this function's
docstring.

**Guard tests** (`test_integration_response_size_cap.py`):
`test_create_integration_client_http2_kwarg_reaches_the_transport`,
`test_create_integration_client_http1_false_reaches_the_transport`,
`test_create_integration_client_default_still_has_http2_disabled` (no
regression to the no-kwarg default), `test_create_integration_client_cert_
kwarg_reaches_the_transport`, and `test_environment_proxy_mounts_forwards_
http2_and_cert` (the proxy-mount path specifically — a proxied request must
not lose protocol selection or mTLS that the direct-connection transport
was given).

### INT-9 — P2 — Google Calendar's connector bypasses the response-size cap and any future centralized deadline — tracked, not fixed

**What:** the CHANGELOG's INT-7 entry says "every integration connector's
outbound calls are covered." That was already corrected once this round for
PayPal (see the pass-3 note above); it is still inaccurate for a second,
architecturally distinct connector. `GoogleCalendarService._build_service()`
(`google_calendar_service.py`) does not use `httpx` at all — it calls
`googleapiclient.discovery.build("calendar", "v3", credentials=creds)` with
no `http=` argument, so `push_event`/`update_event`/`delete_event`/
`test_connection`'s `.execute()` calls run through whatever transport
`googleapiclient` builds for itself, not `create_integration_client()`.

**Investigated, not guessed:** traced `build()`'s no-`http=` path to
`googleapiclient._auth.authorized_http()`, which returns
`google_auth_httplib2.AuthorizedHttp(credentials, http=build_http())` —
`build_http()` is a plain `httplib2.Http()`. `httplib2.Http._conn_request()`
(confirmed against the pinned version, `httplib2==0.32.0`) always ends with
`content = response.read()` — an **unconditional, unbounded read** on the
raw `http.client.HTTPResponse` from Python's stdlib, called with no byte
limit and no streaming option. `httplib2` exposes no size-cap parameter of
any kind; the only way to intercept the read is a custom `connection_type`
passed to `httplib2.Http()` that overrides `getresponse()` to wrap the
returned response's `.read`, reaching into `httplib2`'s private connection
internals plus CPython's `http.client` implementation details — a materially
different, deeper, and more fragile change than the httpx-based fixes in
this document (including PayPal's, which was a one-line swap to the
existing shared factory because PayPal was already on `httpx`). Per this
round's own scope guidance, that fix was not attempted under review-loop
time pressure without being able to verify it holds across `httplib2`
versions and the two layers of wrapping (`google_auth_httplib2.
AuthorizedHttp` around `httplib2.Http`) in between.

**Decision: qualify and track, not force a fix.** The same reasoning
applies to the `KNOWN_LIMITATIONS.md` wall-clock-deadline follow-up's
proposed centralized fix (an `httpx.AsyncClient` subclass wrapping `send()`
in `asyncio.timeout()`, constructed inside `create_integration_client()`):
it would also miss Google Calendar entirely, for the identical reason — the
connector never reaches that factory. Both documents are corrected below
rather than left overclaiming coverage.

**Impact:** same reachable population and severity class as INT-7 pre-fix,
scoped to one connector — an org admin (`integrations.manage`) who connects
a Google Calendar integration is trusting Google's API and OAuth token
endpoint to behave; a compromised or malfunctioning response from either is
not bounded by size or, once a deadline exists elsewhere, by time. Lower
practical likelihood than the general case (the endpoint is Google's own,
not an arbitrary self-hosted destination — there is no SSRF vector here,
same as PayPal's), but the exception is real and now named rather than
silently absent from every "every connector" claim.

**Fix applied:**

- `CHANGELOG.md`'s INT-7 entry: qualified from "every integration
  connector's outbound calls are covered" to name the httpx-based scope and
  the Google Calendar exception explicitly.
- `docs/KNOWN_LIMITATIONS.md`: new entry ("Google Calendar's Connector
  Bypasses the Shared HTTP Hardening") tracking this as an open, scoped
  follow-up, and the existing wall-clock-deadline entry corrected to note
  its proposed fix would not reach Google Calendar either.

**Not fixed this round** — reaching `httplib2`'s read path safely needs its
own dedicated, verified change (a custom `connection_type` with a test
proving it actually aborts an oversized `httplib2` response, not just that
it compiles), tracked in `KNOWN_LIMITATIONS.md` rather than guessed at here.

### Completion gate — follow-up round 5 (2026-09-06)

| Check                                                                                                                 | Result                                                                    |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                         | ✅ 0 violations                                                           |
| `black --check app/ tests/ alembic/`                                                                                  | ✅ clean                                                                  |
| `isort --check-only app/ tests/ alembic/`                                                                             | ✅ clean                                                                  |
| `python3 scripts/validate_migrations.py --strict`                                                                     | ✅ 431 revisions, single head (`d7c1b95e2a40`), PASSED (no schema change) |
| `pytest tests/test_integration_response_size_cap.py -v`                                                               | ✅ 25 passed                                                              |
| backend tests, scope (`-k "integration or salesforce or paypal or webhook or calcom or google_calendar or calendar"`) | ✅ 2411 passed, 21 skipped (env-only), 0 failed                           |

---

## Pass 2 (2026-08-31)

**Backend:** `app/api/v1/endpoints/integrations.py` (710 L, 7 endpoints),
`app/api/v1/endpoints/salesforce_sync.py` (585 L, 9 endpoints),
`app/services/integration_services/salesforce_service.py` (447 L, the raw
REST client), `salesforce_oauth_service.py` (161 L, the OAuth connect flow),
`salesforce_sync_service.py` (958 L, bidirectional sync orchestration),
`app/schemas/integration.py` (303 L, config schemas).
**Frontend:** not reviewed this pass — backend only, per rotation scope.
**Migrations:** none — no schema change this iteration.

---

## Scope

Pass 2 of the rotation. File sizes are within a line or two of pass 1's read
(`integrations.py` 711→710, `salesforce_sync.py` 586→585,
`salesforce_service.py` 433→447, `salesforce_oauth_service.py` 162→161,
`salesforce_sync_service.py` 958→958), so the surface has not materially
grown since PR #1910. Re-read all five backend files in full rather than
diffing, since the shallow clone in this environment does not retain history
back to PR #1910's merge. Also re-read `app/schemas/integration.py` in full
and re-checked every `except Exception` in the reviewed files against where
its message ends up (endpoint response vs. internal log), which is what
surfaced INT-6 below — a class of bug the prior two passes' scope did not
specifically target, and the same class FORM-9 (feature 26, the previous
rotation stop) had just found one file over.

## Route inventory

| Method | Path                                 | Auth dependency            | Permission            | Org-scoped                              | Notes                                                                |
| ------ | ------------------------------------ | -------------------------- | --------------------- | --------------------------------------- | -------------------------------------------------------------------- |
| GET    | `/integrations`                      | `require_permission`       | `integrations.manage` | yes (query filter)                      | full config, secrets redacted                                        |
| GET    | `/integrations/connected`            | `get_current_user` (bare)  | none                  | yes (query filter)                      | deliberate INT-3 carve-out — status-only projection, no URLs/secrets |
| GET    | `/integrations/{id}`                 | `require_permission`       | `integrations.manage` | yes (id + org filter)                   |                                                                      |
| POST   | `/integrations/{id}/connect`         | `require_permission`       | `integrations.manage` | yes (id + org filter)                   |                                                                      |
| POST   | `/integrations/{id}/disconnect`      | `require_permission`       | `integrations.manage` | yes (id + org filter)                   |                                                                      |
| PATCH  | `/integrations/{id}`                 | `require_permission`       | `integrations.manage` | yes (id + org filter)                   |                                                                      |
| POST   | `/integrations/{id}/test-connection` | `require_permission`       | `integrations.manage` | yes (id + org filter)                   | **INT-6 fixed here**                                                 |
| GET    | `/salesforce/status`                 | `require_permission`       | `integrations.manage` | yes (via `_get_sf_integration`)         |                                                                      |
| POST   | `/salesforce/push/members`           | `require_permission`       | `integrations.manage` | yes (query + `_get_sf_integration`)     |                                                                      |
| POST   | `/salesforce/push/training`          | `require_permission`       | `integrations.manage` | yes (query + `_get_sf_integration`)     |                                                                      |
| POST   | `/salesforce/push/events`            | `require_permission`       | `integrations.manage` | yes (query + `_get_sf_integration`)     |                                                                      |
| POST   | `/salesforce/pull/contacts`          | `require_permission`       | `integrations.manage` | yes (via `_get_sf_integration`)         |                                                                      |
| GET    | `/salesforce/readiness`              | `require_permission`       | `integrations.manage` | yes (via `get_salesforce_sync_service`) | **INT-6 fixed here**                                                 |
| POST   | `/salesforce/preview/members`        | `require_permission`       | `integrations.manage` | yes (query + service)                   |                                                                      |
| GET    | `/salesforce/oauth/authorize`        | `require_permission`       | `integrations.manage` | yes (query)                             | 302 to Salesforce consent screen                                     |
| GET    | `/salesforce/oauth/callback`         | **none** (unauthenticated) | n/a                   | yes (id + org from signed state)        | public by design; compensating control below                         |

16 endpoints, all enumerated. One intentionally public route
(`/salesforce/oauth/callback`), one intentionally bare-auth route
(`/integrations/connected`); both re-verified below. Every other route is
`integrations.manage` **and** resolves its target by id + `organization_id`
together — no route in this feature relies on `require_permission` alone to
scope an object (checklist 14b).

## Verified good ✅ (re-confirmed, not re-derived)

- **INT-1** (send-time SSRF re-validation via `assert_outbound_url_safe` on
  every outbound chat/webhook/Cal.com sender): intact. `_validate_urls_in_config`
  still gates `url`/`webhook_url`/`api_url`/`api_base_url`/`instance_url` at
  write time, unconditionally, in both `connect_integration` and
  `update_integration`; the chat senders and Cal.com client each re-validate
  independently at send time (`slack_service.py`, `discord_service.py`,
  `teams_service.py`, `webhook_service.py`, `calcom_service.py`'s
  `_assert_base_url_safe`).
- **INT-2** (OAuth `error` query param URL-encoded before the redirect):
  intact — `_connect_result_redirect` still does
  `quote(str(reason), safe="")`.
- **INT-3** (full config `list`/`get` gated on `integrations.manage`; a
  `/connected` status-only projection for cross-module callers on bare
  `get_current_user`): intact, registered before `/{integration_id}` so the
  literal path wins (verified in the route inventory above — FastAPI matches
  path operations in registration order and `/connected` is declared first).
- **INT-4** (`_validate_config` returns `model_dump(exclude_unset=True)` so
  a partial PATCH doesn't reset omitted fields to schema defaults): intact,
  explanatory comment still in place, `test_omitted_fields_not_reemitted`
  still passes.
- **INT-5** (`KNOWN_WEBHOOK_DOMAINS` allowlist deliberately uninvoked — an
  owner behavior decision, not a bug): unchanged.
- **Salesforce OAuth flow** (`salesforce_oauth_service.py`,
  `salesforce_sync.py`'s `/oauth/*` routes): signed JWT state (org + integration
  id + exact `redirect_uri` + nonce, `exp`-bound) plus a double-submitted
  httpOnly nonce cookie compared with `secrets.compare_digest`; the
  integration is re-loaded by both `id` **and** `organization_id` from the
  signed state before any token is stored; tokens are stored via
  `set_secret()` (encrypted column), never echoed back. The callback's own
  `except Exception` (line 555 of `salesforce_sync.py`) already logs the real
  exception and returns a fixed `"server_error"` reason code — this path was
  already following the safe pattern INT-6 (below) extends to the two paths
  that were not.
- **SOQL injection defense** (`salesforce_sync_service.py`): every dynamic
  SOQL query traced to its construction site — `_find_contact_by_email` and
  `_find_record_by_external_id` both use `_soql_quote` for values and
  `_soql_identifier` for any field/sobject name reaching the query string
  directly. No new SOQL construction site introduced.
- **Instance-URL domain pinning** (`salesforce_service.py`): the
  client-credentials token endpoint and the instance URL Salesforce returns
  on token refresh are both checked against `_INSTANCE_URL_RE`
  (`^https://[a-zA-Z0-9.-]+\.salesforce\.com$`) before use.
- **Tenant isolation** (checklist 3/14): every by-id query in both endpoint
  files filters `organization_id` in the same `where()` as the id — verified
  per-route in the inventory table above, not sampled.
- **No secret exposure** (checklist 5): `_sanitize_config` redacts every
  key matching `_SECRET_KEY_PATTERN` before serialization; `get_secret`/
  `set_secret`/`clear_secret` are the only paths that touch the encrypted
  secret column; no endpoint response includes a raw secret.

## New/changed surface reviewed since pass 1 (clean)

No functional changes were found between pass 1 (PR #1910) and this pass
other than what pass 1 itself introduced — the file sizes and the read above
confirm this. This pass's contribution is a fresh dimension-5 (data exposure)
pass over the `except Exception` sites in the reviewed files, prompted by the
adjacent FORM-9 finding (feature 26) landing one file over in the same
service package the previous iteration. That produced INT-6 below.

## Findings

### INT-6 — LOW-MED — Unhandled connector exceptions could leak infra details via `test-connection` and `readiness` — ✅ FIXED

**What:** `test_integration_connection()`'s per-connector implementations
(Salesforce, Cal.com, Documenso, Outlook, Google Calendar, NWS weather, the
chat webhooks) mostly raise hand-authored, safe messages on their expected
failure paths (e.g. `"Salesforce rejected these credentials"`), but several
of them do not wrap _every_ outbound call in a try/except — a raw
`httpx`/Google-API-client exception (DNS failure, TLS error, timeout,
malformed-response `JSONDecodeError`) can still propagate up unfiltered. Two
call sites returned that exception text to the client verbatim via `str(e)`
instead of routing it through the project's `sanitize_error_message()` /
`safe_error_detail()` sanitizers (CLAUDE.md's Error Handling section,
checklist dimension 5).

**Where:**

- `backend/app/api/v1/endpoints/integrations.py:710` (was
  `return {"success": False, "message": str(e)}` in `test_connection`'s
  `except Exception as e:`)
- `backend/app/services/integration_services/salesforce_sync_service.py:659`
  and `:697` (`check_readiness`'s two `except Exception as exc:` blocks,
  `report["error"] = str(exc)` and `entry["error"] = str(exc)`), consumed
  directly by `GET /integrations/salesforce/readiness`
  (`salesforce_sync.py:344`, `return await sync_service.check_readiness()`).

**Failure scenario:** an org admin (holding `integrations.manage`) configures
an integration pointing at an unreachable or misbehaving host and clicks
"Test connection", or hits the Salesforce readiness check while the org's
Salesforce instance is having connectivity trouble. If the failure occurs
inside a per-connector call that is not individually wrapped (e.g.
`calcom_service.test_connection`'s and `documenso_service.test_connection`'s
`client.get(...)` calls, `salesforce_service._request`'s raw
`client.request(**request_kwargs)`, or `get_field_names`'s
`describe_sobject`), the raw exception's `str()` — potentially including
low-level connection diagnostics — reached the JSON response unfiltered.

**Impact:** same-org, `integrations.manage`-gated only — not a cross-tenant
leak, and every hand-crafted message the connectors raise on their _expected_
failure paths was already safe (none embeds a secret; auth tokens/API keys
are sent in headers or as a config-supplied `apiKey`/`api_token`, never
interpolated into an exception string). The residual risk is narrower: an
_unhandled_ infra-level exception bypassing the connectors' own safe-message
handling and reaching the client with Python internals (a stack frame, a
driver name, in the worst case a file path) — the same shape and severity
class as FORM-9 (feature 26), reached through a different boundary. Recorded
LOW-MED to match FORM-9's precedent severity for this exact defect class.

**Fix:** both sites now route through `sanitize_error_message()` (matching
the existing `inventory.py:774` precedent for a service-returned error
string, not an exception object — `safe_error_detail()` itself only passes
through `ValueError`/`PermissionError`, and these connectors raise bare
`Exception`, so swapping to `safe_error_detail()` directly would have
replaced every one of the intentional safe messages with the generic
fallback, a functional regression). `sanitize_error_message()` only replaces
a message that matches the SQL/path/traceback unsafe-pattern list, so the
existing hand-authored messages pass through unchanged — verified by a
dedicated regression test (below) alongside the leak-prevention test.

**Correction (2026-08-31, on PR #2087 itself):** Codex caught that
`sanitize_error_message()`'s blacklist is the wrong tool for this specific
boundary. It only recognizes SQL/path/traceback/driver-name patterns — a
realistic DNS/TLS/timeout message like
`[Errno -2] Name or service not known` matches none of them and passed
through unchanged, so the exact scenario the fix was written to close (an
unhandled infra-level exception reaching the client) still leaked. Fixed by
adding `sanitize_connector_error()` (`app/core/utils.py`) as the correct
tool for this boundary: it checks the exception's _type_, not its message —
`type(exc) is Exception` (or an explicitly-named `trusted_types` subclass,
e.g. `PayPalError`) is trusted content from a connector's own hand-authored
raise, and anything else (an `httpx` transport error, any other exception
class) always gets the generic fallback regardless of what its message
looks like, since a generic infra failure has no fixed vocabulary a
blacklist could enumerate. Both original INT-6 sites, plus the
previously-unfixed second `check_readiness` site
(`salesforce_sync_service.py`'s per-sObject `get_field_names` catch, same
method, same defect, not itself named in the original finding) now use it.

Investigating why the exact-type check is _necessary_ (not just a nicety)
surfaced a second, sharper instance of the same root problem: three
connectors' own `test_connection()` — `google_calendar_service.py`,
`outlook_calendar_service.py`, `weather_service.py` — catch a broad
exception and re-raise it as `Exception(f"...: {e}")`, interpolating the
caught exception's raw text into the new message. That re-raised message
_is_ of exact type `Exception`, which is exactly what a type-based check
(correctly) treats as "hand-authored and safe" — so the interpolated raw
text (an httpx DNS/TLS/timeout message, unfiltered) would have reached the
client anyway, defeating both the blacklist approach and the type-check
approach. Confirmed the other reachable connectors (Slack, Discord, Teams,
generic-webhook, Documenso, Cal.com, PayPal) don't have this shape: their
outbound calls are either unwrapped (a raw `httpx` exception propagates
under its own type, which the boundary check already treats as untrusted)
or the exception is fully swallowed and replaced with a static,
non-interpolated message. Fixed all three by dropping the interpolation —
they now log the real exception server-side (`logger.error`) and raise a
static, connector-specific message with no embedded exception text.

## Confirmed still open — nothing needing a product decision

- **INT-5** (uninvoked `KNOWN_WEBHOOK_DOMAINS` chat-webhook allowlist) —
  re-verified unchanged, still an explicit owner behavior decision (enabling
  it could reject legitimately-proxied webhook setups).

## Schema & migration notes

None — no code change touches a table or column this iteration.

## Guard tests added

- `backend/tests/test_salesforce_sync.py::test_check_readiness_sanitizes_connection_error`
  and `::test_check_readiness_sanitizes_field_lookup_error` — an unhandled
  exception raised inside `check_readiness()`'s two try/except blocks must
  not appear verbatim in the returned report; both fail before the fix
  (raw `OperationalError`/traceback-shaped text present in `report["error"]`)
  and pass after it.
- `backend/tests/test_integrations_security.py::TestTestConnectionEndpointSanitizesErrors`
  — two tests: `test_unhandled_exception_is_sanitized` (an unhandled
  exception raised inside `test_integration_connection()` must not appear
  verbatim in the endpoint's `message`) and
  `test_hand_authored_message_still_passes_through` (a safe, hand-authored
  connector message — e.g. the Cal.com "rejected the API key" message — must
  survive unchanged, so the fix does not regress into the FORM-9-adjacent
  mistake of over-sanitizing legitimate connector diagnostics).

Verified to fail on reintroduction: reverting either `sanitize_error_message`
call back to bare `str(e)`/`str(exc)` fails its corresponding test with the
literal sensitive substring showing up in the assertion diff.

**Correction round guard tests added:**

- `test_salesforce_sync.py::test_check_readiness_sanitizes_infra_exception_with_no_blacklist_match`
  and `::test_check_readiness_field_lookup_sanitizes_infra_exception` — an
  `httpx.ConnectError` with DNS-failure text that matches no
  `sanitize_error_message()` pattern must still resolve to the generic
  fallback, at both `check_readiness()` catch sites.
- `test_integrations_security.py::test_infra_exception_with_no_blacklist_match_gets_generic_fallback`
  — same scenario at the `test-connection` endpoint.
- `test_integrations_security.py::test_paypal_error_still_passes_through` —
  `PayPalError`, the one named `trusted_types` exception besides bare
  `Exception`, must still pass its hand-authored message through unchanged.
- `test_connector_exception_wrapping.py` (new file) — one test per fixed
  connector (Google Calendar, Outlook Calendar, NWS weather): a caught
  DNS-failure exception must not appear, in any form, in the message the
  connector re-raises.

All four verified to fail on reintroduction: reverting `sanitize_connector_error`'s
type check back to an unconditional `sanitize_error_message(str(exc))` call
fails the three infra-exception tests (the DNS text passes through
unfiltered); reverting any of the three connectors' fix back to
`raise Exception(f"...: {e}")` fails that connector's test in
`test_connector_exception_wrapping.py`.

## Completion gate

| Check                                                                                                                                                                               | Result                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                                                                       | ✅ 0 violations                                 |
| `black --check app/ tests/ alembic/`                                                                                                                                                | ✅ 1337 files unchanged                         |
| `isort --check-only app/ tests/ alembic/`                                                                                                                                           | ✅ clean                                        |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                   | ✅ 394 revisions, single head, PASSED           |
| backend tests, scope (integration/salesforce/connector)                                                                                                                             | ✅ 1581 passed, 21 skipped (env-only), 0 failed |
| backend tests, `test_integrations_security.py` + `test_salesforce_sync.py` + `test_integration_services.py` + `test_salesforce_webhook.py` + `test_connector_exception_wrapping.py` | ✅ 172 passed                                   |
| `tsc --noEmit` / `eslint .`                                                                                                                                                         | n/a — no frontend file changed this iteration   |
