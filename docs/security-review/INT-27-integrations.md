# Security Review — Integrations

**Prefix:** `INT` · **Iteration:** 27 · **Reviewed:** 2026-08-31 (pass 2, rotation pass 2) · **PR:** #2087 (pass 1: #1910, merged)

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
