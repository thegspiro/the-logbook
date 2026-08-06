# Application Review — Public Portal (Tier B, 2nd pass)

**Prefix:** `PP2` · **Iteration:** B26 · **Reviewed:** 2026-08-06

**Backend:** `public/portal.py` (512 L) + `core/public_portal_security.py` (477 L),
`public/calendar.py` + `ical_service.py`, `public/display.py`
**Prior audit:** `docs/module-audit/public-portal.md` (iteration 26) — PP-1 (API-key
auth crash), PP-2 (ICS injection), PP-3 (display-code Unicode), PP-4 (bcrypt-before-
rate-limit DoS + selective prefix), PP-5 (log XSS verified safe) fixed; PP-7 mostly
fixed; PP-6 flagged.

---

## Scope

Tier B: the flagged PP-6 items on this unauthenticated surface. The auth, tenant
isolation, data-minimization, and rate-limit fail-closed properties were
re-confirmed. Both PP-6 items turned out to be genuine infra/schema changes (one
with more nuance than the audit noted), so this pass verified the posture, applied
a safe cleanup, and flagged the rest precisely.

## Findings

### PP-6 — MEDIUM — 🚩 FLAGGED (infra / schema, with added nuance)

- **Per-process rate limiter.** `rate_limit_cache` / `ip_rate_limit_cache` are
  per-worker (true ceiling = workers × limit) and reset on restart; a real global
  limit needs a shared Redis-backed store. Infra change, deferred.
- **Application-status token plaintext at rest.** The 256-bit status token is stored
  plaintext on `ProspectiveMember.status_token` and matched by DB `==`, so a
  DB/backup read yields live 30-day tokens. **Added nuance found this pass:** unlike
  a reset token (emailed once, then only verified), the status token is *re-read*
  in many places to rebuild the status-check URL (email templates lines 1843/1961,
  the public status response line 3674). So it **cannot be hash-only** — hashing at
  rest requires a **two-column** design: a `status_token_hash` (indexed, for
  lookup) plus the token stored **encrypted** (via `EncryptedText`, for re-display),
  with a backfill. That's a schema + service change, correctly deferred; the naive
  "hash it" would break every status link. Recorded in `KNOWN_LIMITATIONS.md`.

### PP-7 residual — accepted design limitations (unchanged)

- Nested-address whitelist gates only top-level keys (intentionally-public **org**
  data, not member PII); per-subfield whitelisting is a future feature.
- Display code has no per-code lockout (already ≥36 bits behind a 60/min-per-IP
  limit; per-code state is marginal gain).

## Cleanup applied

Swept the 4 `== True`/`== False  # noqa: E712` suppressions in `portal.py` to
`.is_(...)` (Pitfall #10). Behavior-neutral.

## Verified good ✅ (re-confirmed)

- PP-1 (prefix-scan + constant-time verify), PP-2 (`_escape_ics` folds `\r\n`/`\r`/
  `\n`), PP-3 (ASCII display-code regex), PP-4 (IP rate limit before bcrypt +
  selective self-healing prefix), PP-5 (access-log render is auto-escaped JSX),
  PP-7 (throttled `last_used_at`, 3→2 anomaly queries) all hold.
- Portal endpoints scope exclusively to `api_key.organization_id`; keys bcrypt-
  hashed + constant-time verified; whitelist is default-deny; `/events/public`
  minimized to public-education future events; calendar/status tokens CSPRNG; no SQL
  injection.
- `check_field_whitelisted` remains defined-but-unused **intentionally** (a test
  asserts its presence as a whitelist marker) — not removed.

## Documentation

`docs/module-audit/public-portal.md` PP-6 note expanded with the two-column
hashing nuance; `KNOWN_LIMITATIONS.md` gains the status-token entry.

## Future development

1. **PP-6** — Redis-backed rate limiter; two-column status-token storage
   (hash-for-lookup + encrypted-for-display).
2. **PP-7** — per-subfield address whitelisting.

## Completion gate

| Check | Result |
|-------|--------|
| `flake8` (portal) | ✅ 0 violations |
| `black --check` | ✅ unchanged |
| `tsc --noEmit` | ✅ n/a — no frontend change |
| backend tests | ✅ `test_public_portal_security` + `test_public_display` **21 passed**; broader public selection 57 passed. |
