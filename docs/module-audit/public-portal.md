# Module Audit — Public Portal

**Scope:** the unauthenticated public-facing surface — `public/portal.py` (512 L,
API-key-gated public data API) + `core/public_portal_security.py` (477 L, API-key
auth + rate limiting), `public/calendar.py` (109 L, `.ics` feed) +
`integration_services/ical_service.py`, `public/display.py` (119 L, location
kiosk board). (`public/forms.py` was audited in #13; the webhook receivers in #12;
`public/finance_approvals.py` was built in this session.)
**Audited:** iteration 26 — two parallel readers: (A) portal + security core, (B)
calendar + display.

## Verified good ✅
- **Portal tenant isolation is enforced** — every endpoint scopes exclusively to
  `api_key.organization_id`; a key resolves to exactly one org, and org A's key
  cannot read org B. API keys are bcrypt-hashed at rest and verified in
  constant time (`bcrypt.checkpw`); revoked (`is_active`) and expired keys are
  rejected.
- **Data minimization holds.** The field whitelist is **default-deny** (returns
  `{}` when unconfigured); `/events/public` is restricted to
  `PUBLIC_EDUCATION`, non-cancelled, future events with only
  title/description/time/location surfaced (no attendee lists, notes, or private
  types); `/organization/stats` returns only aggregate counts (no member PII).
- **Rate-limit caches are bounded** (`_MAX_*_KEYS` caps + `cleanup_rate_limit_cache`
  actually invoked, with per-bucket stale pruning), and the DB rate-limit
  cross-check **fails closed** (a DB error propagates a 500, not an allow). The
  client IP for rate limiting is spoofing-resistant (`get_client_ip` ignores XFF
  unless the peer is a trusted proxy).
- **Calendar feed is well-designed** — 384-bit CSPRNG token
  (`secrets.token_urlsafe(48)`), resolves to exactly one user, feed contains only
  **that user's own** shifts (no other members' PII, no cross-tenant leak).
  Application-status token is 256-bit, TTL-bounded, pipeline opt-in, and
  IP-rate-limited before the DB lookup. **No SQL injection** anywhere.
- **Display board is data-minimized + org-scoped** — returns only location name +
  current-window event title/time/check-in URL (`event_description=None`
  explicitly), scoped to the code's owning location's org.

## Findings

### PP-1 — HIGH (availability) — API-key auth crashed once a second key existed — ✅ FIXED
`generate_api_key` sets `key_prefix = api_key[:8]`, but the key is
`f"logbook_{token}"` and `"logbook_"` is exactly 8 chars — so the stored prefix is
the **constant** `"logbook_"` for every key. `authenticate_api_key` looked up by
that prefix and called `scalar_one_or_none()`, which raises `MultipleResultsFound`
(→ 500) the moment a second key exists in **any** org, breaking public-API auth
for all tenants.
**Fix:** the lookup now iterates all prefix matches and constant-time
`verify_api_key`s each (returning the match), instead of `scalar_one_or_none()`.
Migration-free — works with the existing non-selective prefix. Making the prefix
actually selective needs a key re-issue migration (flagged).

### PP-2 — MEDIUM — ICS injection via unescaped carriage return — ✅ FIXED
`_escape_ics` escaped `\`, `;`, `,`, and `\n`, but a lone `\r` survived. RFC 5545
lines are CRLF-delimited and many calendar parsers treat a bare `\r` as a line
break, so a `\r` in an event title/description/location (e.g. a shift's free-text
`notes` or `platoon`) could inject arbitrary ICS properties/events (calendar
spoofing).
**Fix:** `_escape_ics` now folds `\r\n`, lone `\r`, and `\n` all to the escaped
`\n` sequence; the `X-WR-TIMEZONE` header is now escaped too (was the one
un-escaped feed line), and `_format_ics_datetime` escapes its fallback instead of
echoing an unparseable string into `DTSTART`/`DTEND`.

### PP-3 — LOW — Display-code validation accepted Unicode — ✅ FIXED
`display_code.isalnum()` returns True for Unicode letters/digits, a looser gate
than the ASCII codes actually issued.
**Fix:** replaced with an explicit `re.fullmatch(r"[A-Za-z0-9]{6,12}", ...)`. (No
injection — the lookup is parameterized — but the gate now matches the real
alphabet.)

### PP-4 — HIGH/MED (flagged) — Expensive bcrypt runs before any IP rate limit (CPU DoS)
`authenticate_api_key` (a `Depends`) runs `bcrypt.checkpw` before the endpoint
body's `validate_ip_rate_limit` ever executes, and — with the non-selective
prefix (PP-1) — an unauthenticated attacker sending a well-formed `logbook_…` key
forces a bcrypt verify against **every** key per request, with no IP throttle in
front. The per-key limit is also post-bcrypt. **Status:** flagged — the fix is to
move IP rate limiting ahead of the bcrypt step (and make the prefix selective so
only one candidate is verified), a dependency-chain restructure.

### PP-5 — MEDIUM (flagged) — Unauthenticated client input logged verbatim → stored-XSS risk in admin viewer
`log_access` stores the raw `user-agent`, `referer`, and `ip_address` (all
attacker-controlled) into `PublicPortalAccessLog`; if the admin-side access-log
viewer renders them unescaped, that's stored XSS in the privileged console. The
real fix is output-encoding in the admin viewer. **Status:** flagged for the
frontend (iteration #27).

### PP-6 — MEDIUM (flagged) — Rate limiter is per-process + application-status token plaintext at rest
The in-memory `rate_limit_cache`/`ip_rate_limit_cache` are per-worker (true
ceiling = workers × limit) and reset on restart — a shared Redis store is needed
for a real global limit. Separately, the application-status token is stored
plaintext and matched by DB `==` (a DB/backup read yields live 30-day tokens); it
should be hashed at rest and looked up by hash. Both are behavior/schema changes.
**Status:** flagged.

### PP-7 — LOW (flagged) — Per-request write + query amplification, nested-address whitelist
`authenticate_api_key` commits a `last_used_at` write on every authenticated GET,
and `detect_anomalies` issues 3 COUNT queries per request (including error paths)
— both amplify the PP-4 DoS surface. `filter_data_by_whitelist` gates only
top-level keys, so whitelisting `mailing_address`/`physical_address` exposes the
whole nested dict (org-level data, not member PII). The `~40-bit` display code has
no lockout and degrades to the per-process limiter on Redis outage. **Status:**
flagged.

## Notes
- Large-file caveat: `portal.py` (512 L) and `public_portal_security.py` (477 L)
  were reviewed for security invariants (auth correctness, tenant isolation,
  rate-limit fail-closed, data exposure), not line-by-line. The invariants held.
- Tests: 57 public-display + integration-service (ICS) tests pass with these
  changes; no test asserts the old `authenticate_api_key` crash behavior.
- `check_field_whitelisted` is defined-but-unused in portal.py, but a test
  (`test_changelog_fixes.py`) asserts its presence as a whitelist marker, so it is
  intentionally retained rather than removed.
