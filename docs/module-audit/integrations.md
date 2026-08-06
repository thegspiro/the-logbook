# Module Audit — Integrations

**Files:** `app/api/v1/endpoints/integrations.py` (551 L, 6 endpoints),
`salesforce_sync.py` (579 L, 9), `calcom_sync.py` (72 L, 1),
`app/api/public/integrations_webhook.py` (243 L, inbound webhooks),
`app/services/integration_services/*` (~3,700 L: slack/discord/teams, cal.com,
salesforce OAuth+sync, calendar, documenso, weather, EMS), model
`app/models/integration.py`.
**Audited:** iteration 12 (external-service surfaces — SSRF, credential
handling, OAuth, webhook verification).

## Verified good ✅
- **Auth coverage:** all endpoints authed except `salesforce_oauth_callback`
  (an OAuth redirect callback — public by design, but validates state; see below).
- **No secret exposure.** Secrets live in a separate encrypted column; responses
  emit only the public `config`, additionally run through `_sanitize_config`
  which redacts secret-looking keys. No read endpoint serializes a decrypted
  webhook_url / API key / OAuth token / client_secret.
- **OAuth callback state validation is robust.** `salesforce_oauth_callback`
  validates a signed JWT `state` (HS256 + `exp` + `purpose`, binding
  org/int/redirect_uri) **and** a double-submitted httpOnly nonce cookie
  (`secrets.compare_digest`); the integration is loaded by both `id` AND
  `organization_id` from the signed state, so no cross-org linking. Code is
  exchanged server-side; tokens stored encrypted. Fixed `FRONTEND_URL` host (no
  open redirect).
- **Inbound webhook receiver is solid.** `verify_hmac_signature` /
  `verify_shared_secret` use `hmac.compare_digest` (constant-time); a missing
  webhook_secret rejects all payloads (401, fail-closed); replay protection
  (`is_duplicate_webhook`) + rate limiting; org-scoped from the integration.
- **Tenant isolation:** every by-id read/connect/disconnect/update/test filters
  `organization_id`; salesforce sync resolves via an org-scoped helper; base
  HTTP client has hardened defaults (TLS verify, no redirect-following, timeouts,
  size cap). Salesforce URLs are fixed constants / regex-locked to
  `*.salesforce.com`. flake8 clean; no TODO/FIXME.

## Findings

### INT-1 — MEDIUM-HIGH — SSRF: chat + Cal.com senders didn't re-validate the URL at send time — ✅ FIXED
`webhook_service.send_webhook` re-validated the destination at send time
(`assert_outbound_url_safe`), but the chat senders
(`send_slack_notification` / `send_discord_notification` /
`send_teams_notification`) and the Cal.com client (`test_connection` /
`list_bookings`, built from a client-supplied `api_base_url`) POSTed/GETed the
stored URL **directly** — relying only on config-save-time validation. That's a
DNS-rebinding TOCTOU: a host that resolves public at save time can flip to
`169.254.169.254` / `127.0.0.1` / an internal address before the send.
**Fix:** added the same fail-closed `assert_outbound_url_safe(url)` guard at send
time to all three chat senders (covers `notification_dispatch` and the
test-message paths) and to the Cal.com client's two GETs. Matches the M4
send-time-revalidation pattern from the red-team review.

### INT-2 — LOW — Unencoded `error` reflected into the OAuth redirect — ✅ FIXED
`salesforce_oauth_callback` passed the attacker-controllable `error` query param
straight into the redirect `Location` (`salesforce_error={reason}`) unencoded.
Not an open redirect (fixed host) and CRLF is blocked, but the reflected value
could inject extra query/fragment content.
**Fix:** URL-encode the reason with `quote(..., safe="")`.

### INT-3 — LOW-MED (flagged) — `list`/`get` integration reads not gated by a manage permission
`list_integrations` / `get_integration` use bare `get_current_user`, while all
writes require `integrations.manage`. Any authenticated member can read every
integration's **non-secret** config (instance_url, field_mappings, api_base_url).
Secrets are redacted, so this is not credential exposure.
**Why flagged, not tightened:** unlike MP-1, the integration **list** is consumed
cross-module (prospective-members meeting-config, training-officer dashboard)
gated on *those* permissions, not `integrations.manage` — so gating the read on
`integrations.manage` would break those config flows. A dedicated
`integrations.view` permission (or scoping the cross-module reads to a minimal
projection) is the right follow-up. Not auto-applied.

### INT-4 — MEDIUM — PATCH update resets omitted config fields to schema defaults — ✅ FIXED (app-review B12)
`update_integration` / `connect_integration` ran the incoming config through
`schema_cls(**config).model_dump()`, which re-emitted **all** schema fields with
their defaults and merged that over the stored config. A partial update that
omitted e.g. `sync_direction` / `match_strategy` silently overwrote the stored
value with the schema default (a Salesforce `match_strategy="email_lastname"`
reverting to `"email"` is a real behavior regression), and empty secret-named
defaults leaked into public config. **Fix (B12):** `_validate_config` now returns
`model_dump(exclude_unset=True)` — only caller-supplied keys are emitted, so
omitted keys keep their stored value via the merge; construction still enforces
required fields, and every service reads config via `.get(key, default)` with the
same defaults, so a partial stored config stays usable. 1 regression test added.
See `docs/app-review/integrations.md`.

### INT-5 — LOW / dead code (flagged)
- The `KNOWN_WEBHOOK_DOMAINS` allowlist + `allow_known_only=True` branch in
  `url_validator.py` are **never invoked** (`_validate_urls_in_config` uses the
  default `allow_known_only=False`). So a chat `webhook_url` is only checked for
  "resolves to a public IP," not "is actually hooks.slack.com / discord.com /
  webhook.office.com." Enabling the allowlist for chat webhooks would harden this
  (behavior change — could reject proxied setups), hence flagged. INT-1's
  send-time check protects against the internal-IP case regardless.
- Unused `request: Request` params in several integration endpoints; and
  `SECRET_CONFIG_KEYS` lists `client_id` which `_SECRET_KEY_PATTERN` wouldn't
  redact if it ever landed in public config (harmless today).

## Notes
- flake8 `PT028` warnings on `test_connection` (integrations.py) are pytest-plugin
  false positives — it's a FastAPI endpoint named `test_connection`, not a test.
