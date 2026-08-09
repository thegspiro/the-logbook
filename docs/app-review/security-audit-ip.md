# Application Review — Security / Audit / IP (Tier B, 2nd pass)

**Prefix:** `SEC2` · **Iteration:** B23 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-08 (pass 2)

**Backend:** `endpoints/security_monitoring.py` + `services/security_monitoring.py`,
`endpoints/ip_security.py` + `services/ip_security_service.py`,
`endpoints/audit_logs.py`, `endpoints/error_logs.py`, `core/audit.py`,
`core/security_middleware.py`, `core/geoip.py`
**Prior audit:** `docs/module-audit/security-audit-ip.md` (iteration 23) — SEC-1
(DoS caps), SEC-3/4/5, SEC-6 (security_alerts global table), SEC-7 (audit-chain
admin ops), SEC-8 (geo-block fail-open), SEC-9 fixed; SEC-2 head-truncation fixed
with the **tail-truncation checkpoint cross-check flagged**.

---

## Pass 3 (2026-08-09) — verified clean; 2 E712 swept

Re-verified this exhaustively-hardened surface: **SEC-6** — `security_monitoring`
resolves each alert's `organization_id` (via the alert's user) and all alert
queries/mutations are org-scoped; **SEC-10** — `core/audit.py` stamps
`organization_id` into the hash-chain input (v3) and audit reads/exports filter it;
SEC-1..9 spot-checks (DoS caps, LIKE escape, geo fail-closed, keyed rehash) hold.

**Latent-500 lens clean:** the only enum column here is `severity`, which is
**server-set** (audit/alert code chooses it), not a client request field — no
free-string→ENUM path.

### SEC2-1 — NIT — 2 boolean-column E712 swept — ✅ FIXED

`security_monitoring.py:850` (`SecurityAlertRecord.acknowledged`) and
`ip_security_service.py:636` (`CountryBlockRule.is_blocked`) carried
`== True/False  # noqa: E712`; converted to `.is_(...)`. Both files now E712-free.

### Still flagged (unchanged)

- **SEC-2 (residual)** — tail-truncation of the newest audit rows is detectable only
  at the DB level (no API delete path exists); a periodic external chain-tip
  attestation is the remaining hardening, recorded as future development.

**Completion gate (pass 3):** `flake8` 0 · `black --check` clean · `tsc --noEmit`
n/a (no frontend change) · security/audit tests **354 passed** (DB-free; the
`db_session` errors are the known no-MySQL fixture failures).

---

## Pass 2 (2026-08-08) — six-lens sweep

Re-verified this exhaustively-hardened surface: SEC-2 tail-truncation cross-check
intact and correct (fires only on full-chain verify; no false positive on
append-only or retention purge); SEC-1–9 spot-checks hold; every IP-rule mutation
resolves its target org-scoped before mutating (XC-3 clean); integrity/verify
helpers fail closed; in-memory tracking caps enforced. **1 fix.**

### SEC-10 — LOW — Audit-log entries/export scoped by a user-id subquery, not the org column — ✅ FIXED

`GET /audit-log/entries` and `/audit-log/export` (`security_monitoring.py`) scoped
tenancy with `AuditLog.user_id IN (SELECT users.id WHERE organization_id = …)`
under a comment asserting **"AuditLog has no organization_id column."** It does
(`models/audit.py:73`, indexed), and the canonical `audit_logs.py` filters on it
directly. The subquery form diverged two ways: it **dropped org-stamped system
rows** (`user_id IS NULL`, e.g. scheduled jobs) that the column filter includes,
and it resolved membership from the user's **current** org rather than the row's
**write-time** `organization_id` stamp — so a user reassigned between orgs could
surface their old org's audit rows to the new org's admin. **Fix:** both endpoints
now use the canonical `AuditLog.organization_id == caller-org` filter and the false
comment is removed. Narrow practical exposure (cross-org user reassignment isn't a
normal flow here), hence LOW, but it aligns the two endpoints with the audit
module's source-of-truth scoping. 2 compiled-SQL regression tests (both queries
filter the org column, neither joins `users`).

### Confirmed by-design (not bugs)

`/audit-log/status` and the integrity endpoint return **chain-level** stats
(global first/last id, counts) for the deliberately shared cross-org hash chain —
the only per-row datum exposed is the newest entry's `event_type` string;
`ip_security` blocked-attempts / blocked-countries are genuinely org-agnostic
edge-security data (the block happens pre-auth, before any org is known). Both
match pass-1/iteration-23's accepted design.

---

## Scope

Tier B: the one open residual on a surface that is otherwise exhaustively hardened
(the red-team review + iteration-23 audit closed the rest). This pass completed the
SEC-2 hardening.

## Findings

### SEC-2 (residual) — MEDIUM — Audit-chain tail-truncation was undetectable — ✅ FIXED

`verify_integrity` anchors the chain **head** to the genesis hash (the original
SEC-2 fix), so deleting the oldest rows is caught. But deleting the **newest** rows
leaves a chain that is still internally consistent and still anchored to genesis —
so `verified: True` was returned for a tail-truncated chain, the same silent-removal
gap SEC-2 set out to close, at the other end. (DB-level delete required; no API
deletes audit rows.)

**Fix:** on a full-chain verify (`end_id is None`), cross-check the chain's current
last id against the newest **non-archival** `AuditLogCheckpoint`. A checkpoint
cryptographically attests that entries existed up to its `last_log_id`; if the chain
now ends before that, those attested rows were removed — reported as
`"Chain tail truncated"`, `verified: False`. Archival checkpoints (`archived_at`
set) purge the *old head* range, not the tail, so they're excluded — no false
positive on the sanctioned retention path, and none for an append-only chain
(a checkpoint's `last_log_id` is always ≤ the current max in normal operation).
To truncate the tail undetectably an attacker must now also delete/rewrite the
checkpoint, which can be exported/attested out of band. **2 regression tests added**
(truncation trips it; a checkpoint within the chain does not).

## Verified good ✅ (re-confirmed)

- SEC-1 (`_enforce_key_caps` hard-caps the in-memory trackers), SEC-3 (per-step +
  total size caps), SEC-4 (LIKE escape), SEC-5 (schema/column width), SEC-6
  (`security_alerts.organization_id` + all four methods org-scoped), SEC-7
  (`rehash_chain` fails closed on keyed tamper + break-glass env gate), SEC-8
  (`GEOIP_FAIL_CLOSED` + country-rule management gate), SEC-9 (session_id
  fingerprinted, XSS-safe viewers, `audit_logs.organization_id`) all hold.
- H1/H4/M9 intact (org-scoped reads, keyed HMAC chain, append-only); IP-exception
  self-service not exploitable; enforcement fails closed; `get_client_ip` trusts
  XFF only from configured proxies.

## Documentation

`docs/module-audit/security-audit-ip.md` updated: SEC-2 tail-truncation now
resolved (the last residual on this surface).

## Future development

1. A periodic checkpoint-creation cadence (the tail check is only as fresh as the
   newest checkpoint) — an operational/scheduling decision, not a code gap.

## Completion gate

| Check | Result |
|-------|--------|
| `flake8` (core/audit + test) | ✅ 0 violations |
| `black --check` | ✅ unchanged |
| `tsc --noEmit` | ✅ n/a — no frontend change |
| backend tests | ✅ `test_audit_hash_chain` **10 passed** (+2 new tail-truncation); other non-DB audit tests pass. DB-backed audit tests error on the no-MySQL fixture, unchanged from baseline. |
