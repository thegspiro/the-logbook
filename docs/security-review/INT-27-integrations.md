# Security Review — Integrations

**Prefix:** `INT` · **Iteration:** 27 · **Reviewed:** 2026-09-06 (pass 3, rotation pass 3), 2026-08-31 (pass 2, rotation pass 2) · **PR:** #2307 (pass 3); #2087 (pass 2, merged); #1910 (pass 1, merged)

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
`Integration` row rather than from the payload. 19 endpoints total across
the four files, all enumerated, none newly ungated.

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

#### INT-7 — LOW-MED — `MAX_RESPONSE_SIZE` is declared, never enforced — 🚩 FLAGGED

**What:** `app/services/integration_services/base.py` declares a 10 MB
`MAX_RESPONSE_SIZE` constant with a docstring claiming "response size
limits" as one of the hardened client's defaults. Nothing reads this
constant anywhere in the codebase (`grep -rn MAX_RESPONSE_SIZE app/` — one
hit, its own declaration). `create_integration_client()` returns a plain
`httpx.AsyncClient` with no size-related config; every connector
(`calcom_service.list_bookings`, `documenso_service`, `salesforce_service._
request`, the chat senders, PayPal) calls the client's non-streaming
`.get()`/`.request()` and then `.json()`/`.text`, which buffers the entire
response body into process memory before any caller-side code — including a
hypothetical check against this constant — ever runs. This is not a new
regression; it has been true since the constant and docstring were written
(pre-dates pass 1), but no prior pass named it — `docs/module-audit/
integrations.md`'s "Tenant isolation" bullet listed "size cap" among the
base client's verified-good hardened defaults, which per this rotation's own
rule ("a claim in Verified good must name the mechanism that makes it true")
was not actually checked against the code; corrected in that doc.

**Where:** `backend/app/services/integration_services/base.py:23` (constant,
now commented per the fix below); every connector's response-consuming call
site (not enumerated individually — the gap is structural, not per-file).

**Failure scenario:** the department's own configured Salesforce instance,
Documenso deployment, Cal.com instance, or generic webhook target — any of
which could be self-hosted, compromised, or simply misbehaving — returns an
arbitrarily large response body (a malformed/huge JSON payload, a hung
chunked-transfer stream, or a deliberately oversized reply from a
compromised self-hosted endpoint an admin pointed the integration at). The
request handler buffers the entire body into memory before `.json()` can
even raise a decode error, so a single request can consume memory
proportional to whatever the remote endpoint chooses to send, unbounded by
anything in this codebase. `INTEGRATION_TIMEOUT` (10s total) bounds how long
this can run per request but not how much memory one request can consume in
that window over a fast connection.

**Impact:** every trigger for an outbound integration call requires
`integrations.manage` (an org admin), so this is not directly reachable by
an unprivileged member — the realistic actor is a self-hosted third-party
endpoint the admin configured that later misbehaves or is compromised, not
an anonymous attacker. Inbound webhook bodies (the one path an unauthenticated
caller can influence) are already bounded by nginx's global `client_max_body_
size 50M` in `infrastructure/nginx/nginx.conf` — a separate, pre-existing
control this finding does not change. Scored LOW-MED: real unbounded memory
growth on a plausible trigger, but gated behind an admin-configured
destination and a request-scoped (not persistent) resource, not a
cross-tenant or credential-exposure issue.

**Why flagged, not fixed:** enforcing this correctly means every connector's
response-reading call site switching from `client.get(url).json()` to
`client.stream(...)` plus a running-byte-count abort — httpx's non-streaming
request methods have already fully buffered the body by the time a response
object reaches any caller-side code, so there is no single-file, low-risk
place to intercept this after the fact. That is a call-site-by-call-site
change across roughly ten connector files with a real behavior change on
every one (a legitimate large-but-under-cap response still needs the
streaming read to work correctly, e.g. Salesforce's own paginated bulk pull),
which is exactly the "changes behavior… gets flagged, not implemented" case
in this rotation's own rules — verifying ten independent streaming-refactor
diffs against real (or fully-mocked) HTTP behavior in one pass is a correctness
risk in its own right, not just a scope one.

**Fix applied (doc-only, no behavior change):** removed the false "response
size limits" claim from `base.py`'s docstring and corrected `docs/module-
audit/integrations.md`'s "size cap" bullet, both now pointing at this
finding instead of asserting a control that doesn't exist. Mirrored into
`KNOWN_LIMITATIONS.md` as an owner-decision follow-up (pick a cap value and
whether every connector needs it, e.g. Salesforce's own bulk pulls may
legitimately need a higher one than a webhook test-connection call).

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

None this pass — INT-7 is a flagged design gap, not a fixed defect, so
there is no "revert this line, watch a test fail" shape available; enforcing
a guard test here would mean asserting on the _absence_ of streaming reads
across ten files, which is exactly the kind of brittle, easily-defeated test
this rotation avoids adding for its own sake. If/when INT-7 is fixed, the
guard test belongs with that fix (one oversized-response test per connector
switched to streaming).

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
