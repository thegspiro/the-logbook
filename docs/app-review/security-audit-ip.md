# Application Review — Security / Audit / IP (Tier B, 2nd pass)

**Prefix:** `SEC2` · **Iteration:** B23 · **Reviewed:** 2026-08-06

**Backend:** `endpoints/security_monitoring.py` + `services/security_monitoring.py`,
`endpoints/ip_security.py` + `services/ip_security_service.py`,
`endpoints/audit_logs.py`, `endpoints/error_logs.py`, `core/audit.py`,
`core/security_middleware.py`, `core/geoip.py`
**Prior audit:** `docs/module-audit/security-audit-ip.md` (iteration 23) — SEC-1
(DoS caps), SEC-3/4/5, SEC-6 (security_alerts global table), SEC-7 (audit-chain
admin ops), SEC-8 (geo-block fail-open), SEC-9 fixed; SEC-2 head-truncation fixed
with the **tail-truncation checkpoint cross-check flagged**.

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
