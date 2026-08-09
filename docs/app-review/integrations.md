# Application Review — Integrations (Tier B)

**Prefix:** `INT2` · **Iteration:** B12 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-08 (pass 2)

---

## Pass 2 (2026-08-08, against freshly-merged main) — no code change

Run after the 144-commit merge, which brought integration-relevant code to
review: a parallel INT-4 fix (`918e0b3`, converged with pass 1 — the endpoint
now returns `model_dump(exclude_unset=True)`) and a **new PayPal integration**
(`2c5cff6`: `paypal_service.py`, the public `paypal_webhook.py`, storefront
reconciliation).

**Standing fixes re-verified.** INT-1's send-time `assert_outbound_url_safe` is
intact on all five outbound senders (slack/discord/teams/webhook/calcom). Worth
noting for cross-reference: that guard is **more robust than B11's push fix** — it
re-resolves the hostname and asserts a **public IP at send time**
(`_assert_hostname_resolves_public`), closing the DNS-rebinding TOCTOU window that
B11's `validate_push_endpoint` could only flag as residual (push can't re-validate
at send without breaking its 127.0.0.1 delivery-test harness). INT-4 converged;
update-bypass remains clean (config is merged via `exclude_unset`, not a blind
`setattr`); no unpopulated `*_name` response field (`channel_name` is user-supplied
config, not enrichment).

### New PayPal integration — reviewed, verified good ✅

- **No outbound SSRF:** `api_base(environment)` resolves the API host from a fixed
  `{sandbox, live}` dict (defaulting to sandbox), so the PayPal base URL is never
  client-controlled — unlike the chat webhooks, there's nothing to point at an
  internal host.
- **Secrets:** `client_secret` is read from the integration's **encrypted secret
  column** (`get_secret`) first, config only as fallback; never echoed in a
  response.
- **Inbound webhook fails closed, exemplary:** `POST /public/paypal/webhook` is
  rate-limited, resolves the integration, then calls PayPal's own
  `verify-webhook-signature` API and `raise 401` `if not verified`;
  `verify_webhook_signature` returns **False** on a missing `webhook_id`, missing
  signature headers, any exception, or a non-2xx PayPal response — trusting only an
  explicit `verification_status == "SUCCESS"`. Duplicate deliveries are ignored
  (idempotent). The `cert_url` is forwarded to PayPal for validation, not fetched
  server-side, so no SSRF there either.
- The storefront **reconciliation** logic (`storefront_service.py`, +274 L) is
  payment-matching depth that belongs to a storefront (A1) pass, not the
  integration lens; noted for that rotation.

### Flagged items (unchanged)

INT-3 (list/get reads on bare `get_current_user` — needs a dedicated
`integrations.view` permission because the list is consumed cross-module) and
INT-5 (the uninvoked `KNOWN_WEBHOOK_DOMAINS` chat-webhook allowlist + cosmetic dead
params) both stand, in `KNOWN_LIMITATIONS.md` / here.

**No code changed.** The integrations core is mature (INT-1/2/4 done) and the new
PayPal surface is well-built; the verifications are the deliverable.

---

## Pass 1 (2026-08-06)

**Prefix:** `INT2` · **Iteration:** B12 · **Reviewed:** 2026-08-06

**Backend:** `endpoints/integrations.py` (551 L), `salesforce_sync.py`,
`calcom_sync.py`, `public/integrations_webhook.py`,
`services/integration_services/*` (~3,700 L), `schemas/integration.py`,
model `models/integration.py`
**Prior audit:** `docs/module-audit/integrations.md` (iteration 12) — INT-1
(send-time SSRF) and INT-2 (OAuth error reflection) fixed; INT-3 (read gating),
INT-4 (PATCH config reset), INT-5 (allowlist/dead code) left open.

---

## Scope

Tier B: the three open findings. The security pass had already hardened the
external-service surfaces (send-time SSRF re-validation, OAuth state validation,
inbound-webhook HMAC + fail-closed, no secret exposure, tenant isolation) — those
were re-confirmed, not re-derived. This pass fixed the one clear data-integrity
bug (INT-4) and re-assessed the two flagged items.

## Findings

### INT-4 — MEDIUM — PATCH update silently reset omitted config fields to schema defaults — ✅ FIXED

`_validate_config` returned `schema_cls(**config).model_dump()`, which re-emits
**every** schema field at its default. Both `connect_integration` and
`update_integration` then merge that over the stored config
(`{**stored, **public_config}`). So a partial PATCH — say, changing only
`sync_direction` — silently overwrote every omitted field (`match_strategy`,
`graceful_fields`, `auto_sync_enabled`, …) with its schema default. A Salesforce
integration set to `match_strategy="email_lastname"` would quietly revert to
`"email"` (which *adopts* pre-existing Contacts) the next time any other field was
edited — a real data-integrity / behavior regression, config-shaped, not a leak.
A secondary effect: empty secret-named defaults (`client_secret=""`) were emitted
and, being falsy, fell through `_extract_secrets` into **public** config.

**Fix:** `_validate_config` now returns `model_dump(exclude_unset=True)` — only the
keys the caller actually supplied. Construction still enforces required fields and
validators (unchanged); omitted keys keep their stored value through the handler's
existing merge. **Verified safe end-to-end:** every service reads config with
`config.get(key, default)` (e.g. `get("match_strategy", DEFAULT_MATCH_STRATEGY)`,
`get("auto_apply_payments", True)`), and each read-time default matches the schema
default — so a partial stored config stays usable and fresh-connect behavior is
unchanged. **1 regression test added** (`test_omitted_fields_not_reemitted`):
a Salesforce partial config returns exactly its supplied keys, with
`sync_direction`/`graceful_fields`/`client_secret` absent.

### INT-3 — LOW-MED — `list`/`get` reads not gated by a manage/view permission — ✅ RESOLVED (owner decision, 2026-08-09)

`list_integrations` / `get_integration` used bare `get_current_user`, so any
authenticated member read every integration's **non-secret** config (instance_url,
field_mappings, api_base_url). The complication was that the integration list is
consumed cross-module (`useConnectedIntegrations` in the membership-pipeline
meeting-config) gated on *those* permissions — so a blanket `integrations.manage`
gate on the read would silently break those flows. **Fix (the "minimal projection"
option):** the full config `list`/`get` now require `integrations.manage`, and a new
`GET /integrations/connected` returns only `integration_type`/`status`/`enabled`
(no URLs, mappings, PHI flags, or secrets) for any authenticated org member. The
`useConnectedIntegrations` hook was repointed to it (`getConnectedIntegrationStatus`),
so cross-module callers keep working without the integrations-admin permission.
`/connected` is registered before `/{integration_id}` so the literal path wins.
Covered by `frontend/src/hooks/useConnectedIntegrations.test.ts`.

### INT-5 — LOW — Unused allowlist + dead params — 🚩 FLAGGED (unchanged)

- `KNOWN_WEBHOOK_DOMAINS` + `allow_known_only=True` in `url_validator.py` remain
  uninvoked, so a chat `webhook_url` is checked only for "resolves to a public IP,"
  not "is actually hooks.slack.com / discord.com / webhook.office.com." Enabling
  the allowlist would harden this but could reject proxied setups (behavior change).
  INT-1's send-time check still covers the internal-IP case regardless.
- Unused `request: Request` params on several endpoints, and `client_id` listed in
  `SECRET_CONFIG_KEYS` (harmless — `_SECRET_KEY_PATTERN` wouldn't redact it if it
  reached public config). Cosmetic; not flake8 errors. Left for a batch cleanup to
  avoid churning endpoint signatures in a security-focused pass.

## Verified good ✅ (re-confirmed)

- INT-1 send-time `assert_outbound_url_safe` on all three chat senders + Cal.com;
  INT-2 OAuth `error` now `quote`-encoded. Both hold.
- No secret exposure (separate encrypted column + `_sanitize_config` redaction);
  OAuth callback validates signed JWT state + httpOnly nonce, loads integration by
  id AND org; inbound webhook HMAC uses `compare_digest` and fails closed on a
  missing secret; every by-id path filters `organization_id`.

## Documentation

`docs/module-audit/integrations.md` updated: INT-4 resolved; INT-3/INT-5 stand.

## Future development

1. **INT-5** — enable the chat-webhook domain allowlist; batch-remove the unused
   `request` params; drop `client_id` from `SECRET_CONFIG_KEYS`.

## Completion gate

| Check | Result |
|-------|--------|
| `flake8` (endpoint + test) | ✅ 0 violations |
| `black --check` | ✅ unchanged |
| `tsc --noEmit` | ✅ n/a — no frontend change |
| backend tests | ✅ `test_integrations_security` **50 passed** (+1 new); `test_integration_services` + `test_salesforce_sync` **88 passed**. No DB needed for these files. |
