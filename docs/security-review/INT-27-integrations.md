# Security Review — Integrations

**Prefix:** `INT` · **Iteration:** 27 · **Reviewed:** 2026-08-27 · **PR:** #1910

**Backend:** `app/api/v1/endpoints/integrations.py` (711 L, 8 endpoints),
`app/api/v1/endpoints/salesforce_sync.py` (586 L, 11 endpoints),
`app/services/integration_services/salesforce_service.py` (433 L, the raw
REST client), `salesforce_oauth_service.py` (162 L, the OAuth connect flow),
`salesforce_sync_service.py` (958 L, bidirectional sync orchestration),
`app/schemas/integration.py` (config schemas, read for growth only).
**Frontend:** not reviewed this pass — backend only, per rotation scope.
**Migrations:** none — no code change this iteration.

---

## Scope

This module carries the deepest prior coverage of any feature reviewed so
far in this rotation: a module audit (iteration 12, INT-1 through INT-5) and
a 4-pass app-review, the last two passes of which already concluded "no code
change — the module is mature." Read `integrations.py`, `salesforce_sync.py`,
and all three Salesforce backing services directly in full (moderate size,
~2,850 L across the five files, deep existing coverage — not fanned out).
Growth since the last full read: `integrations.py` 551→711 L (+160, almost
entirely new "coming soon" catalog entries — Active911, Google Maps, Zapier,
WhatsApp, ImageTrend, ESO Solutions, NREMT, FirstWatch, PulsePoint — plus the
already-documented `/connected` endpoint and two genuinely new pieces of
logic reviewed below), `salesforce_sync.py` 579→586 L (+7, negligible).

## Verified good ✅ (re-confirmed, not re-derived)

- **INT-1** (send-time SSRF re-validation via `assert_outbound_url_safe` on
  every outbound chat/webhook/Cal.com sender): not touched by this
  iteration's file set directly, but the generic `_validate_urls_in_config`
  helper that gates `url`/`webhook_url`/`api_url`/`api_base_url`/
  `instance_url` at write time is intact and still called unconditionally in
  both `connect_integration` and `update_integration`, regardless of whether
  the integration type has a registered config schema.
- **INT-2** (OAuth `error` query param URL-encoded before the redirect):
  intact in `salesforce_sync.py`'s `_connect_result_redirect`
  (`quote(str(reason), safe="")`).
- **INT-3** (full config `list`/`get` gated on `integrations.manage`; a
  `/connected` status-only projection for cross-module callers on bare
  `get_current_user`): intact, registered before `/{integration_id}` so the
  literal path wins.
- **INT-4** (`_validate_config` returns `model_dump(exclude_unset=True)` so
  a partial PATCH doesn't reset omitted fields to schema defaults): intact,
  with the original explanatory comment still in place.
- **INT-5** (`KNOWN_WEBHOOK_DOMAINS` allowlist deliberately uninvoked — an
  owner behavior decision, not a bug): unchanged. The `client_id` /
  `SECRET_CONFIG_KEYS` note now carries an explanatory comment
  (`schemas/integration.py`) that wasn't there at the last read — a doc
  improvement, not a functional change.
- **Salesforce OAuth flow** (`salesforce_oauth_service.py`,
  `salesforce_sync.py`'s `/oauth/*` routes): signed JWT state (org + integration
  id + exact `redirect_uri` + nonce, `exp`-bound) plus a double-submitted
  httpOnly nonce cookie compared with `secrets.compare_digest`; the
  integration is re-loaded by both `id` **and** `organization_id` from the
  signed state before any token is stored; tokens are stored via
  `set_secret()` (encrypted column), never echoed back. Unchanged and solid.
- **SOQL injection defense** (`salesforce_sync_service.py`): every dynamic
  SOQL query traced to its construction site — `_find_contact_by_email` and
  `_find_record_by_external_id` both use `_soql_quote` (backslash-then-quote
  escaping) for values and `_soql_identifier` (alphabet-restricted) for any
  field/sobject name that reaches the query string directly. The one other
  dynamic query (`pull_contacts`'s `LastModifiedDate > {ts}`) interpolates a
  server-formatted timestamp, never user input. No new SOQL construction
  site introduced since the last pass.
- **Instance-URL domain pinning** (`salesforce_service.py`): the client-credentials
  token endpoint and the instance URL Salesforce itself returns on token
  refresh are both checked against `_INSTANCE_URL_RE`
  (`^https://[a-zA-Z0-9.-]+\.salesforce\.com$`) before use — stronger than
  the generic "resolves to a public IP" SSRF check applied to the initially
  stored `instance_url` at write time. Noted, not flagged: the gap between
  those two checks (a cached access token can be used to call an
  admin-configured `instance_url` that passed only the generic public-IP
  check, not the domain pin, before a token refresh ever runs) requires the
  actor to already hold `integrations.manage` in their own org and only
  risks that actor's own org's access token reaching a destination they
  themselves configured — self-inflicted, not a trust-boundary crossing, so
  not treated as a finding.

## New surface reviewed (both since the last full pass, both clean)

- **`_secrets_to_clear_for_base_url_change`** (`integrations.py`): when an
  admin changes a Documenso/Cal.com integration's `api_base_url` without
  re-supplying its credential, the stored credential is not silently reused
  against the new endpoint — the handler either requires the credential be
  re-entered or explicitly cleared (empty string), or 422s. This is a
  sound, deliberate hardening (a stored API token silently following a
  base-URL change to an attacker-supplied endpoint would itself be a
  credential-leak shape) and is correctly wired into both `connect_integration`
  and `update_integration`.
- **`clear_salesforce_refresh_token`** (`integrations.py` + mirrored in
  `salesforce_sync.py`'s OAuth callback path): an explicit blank
  `refresh_token` in a PATCH/connect payload is read as "switch Salesforce
  from the interactive OAuth grant to client-credentials," and both the
  refresh token and any cached access token are cleared together so the
  next sync obtains fresh client-credentials rather than continuing under
  the previous OAuth user's session until that token naturally expired.
  Correctly scoped to the `salesforce` integration type only; omission
  still means "leave unchanged" (not treated as a clear), matching this
  codebase's established explicit-null-vs-omitted convention.

## Findings

None. Every prior finding (INT-1 through INT-5) re-verified intact; both new
pieces of logic reviewed are correctly built and introduce no gap. No code
change this iteration.

## Confirmed still open — nothing needing a product decision

- **INT-5** (uninvoked `KNOWN_WEBHOOK_DOMAINS` chat-webhook allowlist) —
  re-verified unchanged, still an explicit owner behavior decision (enabling
  it could reject legitimately-proxied webhook setups).

## Schema & migration notes

None — no code change this iteration.

## Guard tests added

None — no code change this iteration. Existing coverage re-run and
confirmed passing (`test_integrations_security.py`, `test_salesforce_sync.py`,
`test_notification_dispatch.py` — 112/112).

## Completion gate

| Check                                             | Result                  |
| ------------------------------------------------- | ----------------------- |
| `flake8`                                          | n/a — no files changed  |
| `black --check`                                   | n/a — no files changed  |
| `isort --check-only`                              | n/a — no files changed  |
| `python3 scripts/validate_migrations.py --strict` | PASSED (no migrations)  |
| backend tests, scope (integrations/salesforce)    | 112/112 passed          |
| backend tests, full suite                         | 8922 passed, 22 skipped |
