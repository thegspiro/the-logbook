# Module Audit — Security / Audit / IP

**Scope:** the security-tooling surface itself — `endpoints/security_monitoring.py`
(650 L) + `services/security_monitoring.py` (1,009 L), `endpoints/ip_security.py`
(525 L) + `services/ip_security_service.py` (733 L) + the IP-enforcement path of
`core/security_middleware.py`, `endpoints/audit_logs.py` (155 L),
`endpoints/error_logs.py` (248 L), `core/audit.py` (576 L). The prior red-team
review already hardened parts of this surface (audit-log org scoping H1, HMAC
hash chain H4, hard-delete restriction M9, rate-limiter client-IP H5).
**Audited:** iteration 23 — three parallel readers: (A) ip-security + enforcement,
(B) security-monitoring, (C) audit-logs + error-logs + core/audit.

## Verified good ✅
- **H1 / H4 / M9 all confirmed intact.** Audit reads are org-scoped (via the
  `org_user_ids` subquery, by-id path included); the hash chain is keyed
  HMAC-SHA256 from `AUDIT_LOG_SIGNING_KEY`/`SECRET_KEY` (never hardcoded), with a
  no-downgrade high-water-mark guard; no endpoint deletes/updates `audit_logs`
  (append-only), the sole rewrite path is the permissioned, audit-logged
  `rehash_chain` recovery tool.
- **IP-exception self-service is not exploitable.** A member cannot self-grant an
  IP bypass: exceptions are `PENDING` on create, only `APPROVED` + in-window ones
  are enforced, and PENDING→APPROVED is only reachable behind
  `security.manage`/`settings.manage`. All exception by-id ops are org-scoped;
  `get_my_exceptions` is user-scoped.
- **Enforcement fails closed where it matters** — the allowlist load returns an
  empty set on error (removes bypasses, doesn't grant), and the real client IP is
  obtained via `get_client_ip` (trusts XFF only from configured proxies, walks
  right-to-left, never trusts forwarded headers when the proxy list is empty).
- **No SQL injection** across the surface; bounded pagination on the log/alert
  endpoints; `safe_error_detail` on error paths; the HMAC/signing key is never
  placed in a response.

## Findings

### SEC-1 — MEDIUM (DoS) — In-memory tracking caps were defined but never enforced — ✅ FIXED
`SecurityMonitoringService` declared `_MAX_TRACKING_KEYS = 5000` but never used
it. The only eviction (`_evict_stale_tracking_keys`) is throttled to once/60s and
drops only keys older than 2h, and `detect_brute_force` didn't call it at all — so
a burst of many distinct attacker-controlled keys (source IPs / user ids during
credential stuffing) grows `_login_attempts` / `_api_calls` / `_session_ips` /
`_data_transfers` without bound between sweeps (pitfall #9).
**Fix:** added an unthrottled `_enforce_key_caps()` that hard-caps each dict at
`_MAX_TRACKING_KEYS`, evicting the least-recently-active keys first; it runs on
every eviction call and is also invoked directly from `detect_brute_force` (the
hot login path). Existing tests pass.

### SEC-2 — MEDIUM — Audit chain verification didn't detect head-truncation — ✅ FIXED
`verify_integrity` checked each row's hash and the `previous_hash` link between
adjacent rows, but never anchored the first row to the genesis value, and never
cross-checked a checkpoint. Deleting rows from the **head** of the chain leaves a
tail that is internally consistent, so `verified: True` was returned for a
truncated chain — silent removal of audit history was undetectable by the very
check the design leans on. (DB-level delete required; no API deletes audit rows.)
**Fix:** when verifying from the chain start (`start_id is None`), the first row's
`previous_hash` must equal the genesis `"0"*64`, else the chain is reported broken
("chain head missing"). The checkpoint/Merkle cross-check for tail-truncation
remains flagged (below).

### SEC-3 — MEDIUM (DoS) — `POST /error_logs/log` allowed unbounded step strings — ✅ FIXED
`troubleshooting_steps: list[str]` capped only the item **count** (20), not the
length of each string, and the column is effectively LONGTEXT — so any member
could POST 20 multi-MB strings per row, ballooning rows / flooding the table.
**Fix:** added a validator capping each step to 500 chars and the total to 4 KB
(mirrors the existing `context` size check). `organization_id` is already
server-stamped from `current_user` (verified good).

### SEC-4 — LOW — Audit search built a LIKE without escaping metacharacters — ✅ FIXED
`list_audit_logs` built `f"%{search}%"` and `.ilike()`'d it with no `escape=`, so
caller-supplied `%`/`_` acted as wildcards (LIKE-pattern injection within the
caller's own org scope).
**Fix:** escape `\ % _` in the term and pass `escape="\\"`.

### SEC-5 — LOW — `error_type` schema cap exceeded the DB column width — ✅ FIXED
`ErrorLogCreate.error_type` allowed 100 chars but the column is `String(50)`, so a
51–100 char value passed validation then 500'd on insert.
**Fix:** aligned the schema cap to 50 (clean 422 instead of a DB error).

### SEC-6 — HIGH — ✅ FIXED — `security_alerts` is a global table → cross-tenant read, IDOR-suppress, and metric leaks
`SecurityAlertRecord` had **no `organization_id` column**, and the service never
scoped it: `get_recent_alerts` returned every tenant's alerts (source IP, user id,
description, and a details blob with prior/current IPs + session id) via
`GET /alerts` / `/data-exfiltration/status`; `acknowledge_alert`/`resolve_alert`
fetched by bare id, so an org-A admin could **suppress org-B's live incidents**
(XC-3), with the 404 acting as a global existence oracle; and `get_security_status`
aggregated alert/failed-login counts and in-memory session/endpoint metrics across
**all** tenants.

**Fix:** Added a nullable `organization_id` column (+ `ix_security_alerts_organization_id`
and a composite `idx_security_alert_org_timestamp` index) to `security_alerts`
(migration `20260728_0001`), which backfills existing rows from each alert's
`user_id → users.organization_id`. `_add_alert` now resolves the owning org from
the alert's `user_id` at write time (user-less pre-auth / IP-only alerts stay
NULL = platform-level, not shown in any org's view). All four read/write methods
take `organization_id` as a required parameter and filter on it:
`get_recent_alerts` and `get_security_status` scope every aggregation (failed
logins scoped via the org's user ids); `acknowledge_alert`/`resolve_alert` add
`organization_id == caller_org` to the fetch so a 404 is returned uniformly for
both missing and cross-tenant ids (no oracle). `get_security_status` also stopped
returning the raw external-endpoint URL list (another tenant's exfil
destinations) — it now exposes only a process-global **count**, with an explicit
comment that the in-memory trackers are not per-tenant. The in-memory
`get_recent_alerts` fallback returns `[]` (the in-memory list carries no org, so
it cannot be safely scoped). Endpoint callers pass
`str(current_user.organization_id)`.

### SEC-7 — MEDIUM — ✅ FIXED — Global audit-chain admin ops gated by any org's `audit.export`
`POST /audit-log/rehash` (recomputed hashes for **all** orgs' rows),
`/checkpoint`, and `/integrity` operate over the entire global chain but were
gated only by `audit.export` — any org's admin could trigger a platform-wide
rehash / attest the whole chain. Worse, `rehash_chain` recomputed `current_hash`
from each row's *current* `event_data` for **every** row, so a privileged
operator with DB write access could edit a keyed (v2) row then run rehash to
launder the tamper into a valid keyed chain (the server holds the HMAC key;
SEC-2's genesis anchor only covers head deletions, not tail edits).

**Fix (two layers):**
- **Anti-laundering — `rehash_chain` no longer rewrites keyed rows.** The tool
  now only repairs legacy (v1, unkeyed) rows — its actual purpose, fixing the
  historical hash-computation bug. For a keyed (v2) row it recomputes the
  expected hash and, if it does not match what is stored, **fails closed**
  (raises `ValueError` → 409) instead of overwriting it: a keyed mismatch is a
  genuine integrity signal (tamper or a v2 bug) and rehash refuses to launder
  it. Consistent keyed rows are chained forward from their authoritative stored
  hash, never re-derived from current data.
- **Break-glass gate for the destructive global op.** Because rehash rewrites
  the single cross-org chain and there is no platform-super-admin role (every
  org's highest role is a per-org wildcard), `/rehash` is now disabled (403)
  unless a server operator sets `AUDIT_ALLOW_CHAIN_REHASH=true` — env control is
  the de-facto platform-admin boundary. An ordinary org admin holding
  `audit.export` can no longer trigger a platform-wide chain rewrite.

`/checkpoint` and `/integrity` are non-destructive (checkpoint writes a snapshot
row; integrity is read-only) and left on `audit.export`/`audit.view`. New unit
tests cover the repair, the fail-closed keyed-tamper refusal, and the clean-chain
no-op. **Status:** fixed.

### SEC-8 — MEDIUM — ✅ FIXED — IP geo-blocking fails OPEN and `CountryBlockRule` is global
`geoip.is_ip_blocked` returned *allow* when a country couldn't be resolved (no
MaxMind DB, `AddressNotFoundError`, lookup error) — a missing/corrupt DB silently
disabled geo-blocking app-wide (the code comment already flagged "change to
fail-closed"). Separately, `CountryBlockRule` has no `organization_id` (one global
table + one in-process blocked-country set), so any org admin's block/unblock
affected **every** tenant.

**Fix (two configurable postures, both secure-by-default where it doesn't lock
people out):**
- **Fail-closed geo-blocking is now selectable.** `GEOIP_FAIL_CLOSED` (default
  `False`, preserving fail-open so a lookup gap doesn't lock users out) makes
  `is_ip_blocked` return `(True, "country_unknown_failclosed")` for any IP whose
  country can't be resolved — including the missing/corrupt-DB case, closing the
  "silently disabled app-wide" hole. Private/reserved and allowlisted IPs are
  checked *before* the country lookup, so a fail-closed deployment with a broken
  DB still lets internal/LAN and allowlisted operators in to recover.
- **Runtime country-rule management is a platform-operator action.** Geo-blocking
  is an edge control that runs before any tenant/auth context exists, so per-org
  `CountryBlockRule` rows don't fit the enforcement model (and there's no
  platform-super-admin role). Instead, the two *mutating* endpoints
  (`POST`/`DELETE /ip-security/blocked-countries`) are now gated by
  `GEOIP_ALLOW_COUNTRY_RULE_MANAGEMENT` (default `False`): an org admin can no
  longer alter the shared, cross-tenant blocklist via the API. The platform
  operator sets it at deploy time via `BLOCKED_COUNTRIES`, or enables the flag to
  allow runtime management. Read endpoints (list rules / blocked attempts) stay
  available for visibility.

New unit tests cover fail-closed on unknown country plus the private-IP and
allowlist recovery paths under fail-closed. **Status:** fixed.

### SEC-9 — LOW — ✅ mostly FIXED — Residual exposure / robustness
- **✅ session_id redacted in the audit export.** The export now emits a
  non-reversible truncated-SHA-256 fingerprint of `session_id` instead of the
  raw value (`_fingerprint_session_id`), so an `audit.export` holder can still
  correlate events within an export but never sees the live session identifier.
  session_id is not part of the hash chain, so offline integrity verification is
  unaffected. `ip_address`/`user_agent` remain (they are the point of a security
  export). (SM #6)
- **✅ error-payload / access-log XSS: verified safe.** The admin error-monitoring
  viewer (`ErrorMonitoringPage.tsx`) and the public-portal access-log viewer
  (`AccessLogsTab.tsx`) render `error_message`/`context`/`user_agent`/`referer`
  as plain JSX interpolation, which React auto-escapes; neither uses
  `dangerouslySetInnerHTML` (the only two such sites are the unrelated
  link/markdown helpers). No stored-XSS path. `context` remains capped at 4 KB.
  (EL #6, PP-5)
- **✅ dead code removed.** The unused org-scoped `get_all_active_allowed_ips`
  service method was deleted (only the pre-auth `_global` variant is called);
  the `IPExceptionType.BLOCKLIST` enum value is documented as a reserved
  placeholder (kept to avoid a needless enum-column migration when the
  explicit-blocklist feature lands). (IP #5)
- **✅ Resolved 2026-07-30:** `audit_logs.organization_id` exists (migration
  `20260801_0009`): stamped at write time (explicit or auto-resolved from the
  acting user), backfilled from `user_id` for pre-column rows, and included in
  the hash chain from hash version 3 onward — org attribution on new rows is
  tamper-proof, and every audit read path (audit-log endpoints, member
  audit-history, compliance attestations, failed-login stats) now filters the
  column directly instead of joining through the mutable `users` table.
  Cross-org allowlist bypass is documented-intentional (pre-auth edge
  control); the `TRUSTED_PROXY_IPS`-empty startup warning already exists; admin
  country-block self-lockout is now operator-only after SEC-8's management gate.
  (AL #7, IP #3/#4)
**Status:** actionable items fixed; the `audit_logs` org-column is done.

## Notes
- Large-file caveat: `security_monitoring.py` (1,009 L), `ip_security_service.py`
  (733 L), and the IP-enforcement path of `security_middleware.py` (1,341 L) were
  reviewed for security invariants (org-scoping, enforcement fail-closed, DoS,
  injection), not line-by-line. The invariants held on every path examined.
- The two global-table findings (SEC-6 security_alerts, SEC-8 CountryBlockRule)
  shared a root cause with the broader multi-tenant work: security/enforcement
  tables that predate per-org scoping. Both are now **fixed** — SEC-6 by an org
  column + backfill (all four methods org-scoped); SEC-8 by recognizing
  geo-blocking as a platform-edge control (per-org rules don't fit enforcement)
  and gating its runtime management + fail-closed posture behind deploy flags.
