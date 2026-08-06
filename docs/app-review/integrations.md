# Application Review — Integrations (Tier B, 2nd pass)

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

### INT-3 — LOW-MED — `list`/`get` reads not gated by a manage/view permission — 🚩 FLAGGED (unchanged, needs a permission decision)

`list_integrations` / `get_integration` use bare `get_current_user`, so any
authenticated member reads every integration's **non-secret** config
(instance_url, field_mappings, api_base_url). Secrets stay redacted, so this is
not credential exposure. Re-verified the reason it wasn't tightened: the
integration **list is consumed cross-module** (prospective-members meeting-config,
training-officer dashboard) gated on *those* permissions — so gating the read on
`integrations.manage` would break those flows. The right fix is a dedicated
`integrations.view` permission (seed + roles) or a minimal projection for the
cross-module callers. A product/permission decision, not a drive-by; recorded in
`KNOWN_LIMITATIONS.md`.

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

1. **INT-3** — a dedicated `integrations.view` permission (or minimal projection
   for the cross-module reads).
2. **INT-5** — enable the chat-webhook domain allowlist; batch-remove the unused
   `request` params; drop `client_id` from `SECRET_CONFIG_KEYS`.

## Completion gate

| Check | Result |
|-------|--------|
| `flake8` (endpoint + test) | ✅ 0 violations |
| `black --check` | ✅ unchanged |
| `tsc --noEmit` | ✅ n/a — no frontend change |
| backend tests | ✅ `test_integrations_security` **50 passed** (+1 new); `test_integration_services` + `test_salesforce_sync` **88 passed**. No DB needed for these files. |
