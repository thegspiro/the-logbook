# Security Review — Security, Audit & IP

**Prefix:** `SEC2` · **Iteration:** 28 · **Reviewed:** 2026-08-27 · **PR:** #1911

**Backend:** `app/api/v1/endpoints/security_monitoring.py` (677 L),
`app/api/v1/endpoints/ip_security.py` (555 L), `app/api/v1/endpoints/audit_logs.py`
(169 L), `app/api/v1/endpoints/error_logs.py` (342 L), `app/services/security_monitoring.py`
(1,073 L), `app/services/ip_security_service.py` (707 L), `app/core/audit.py`
(922 L), the IP-enforcement path of `app/core/security_middleware.py`,
`app/core/geoip.py`.
**Frontend:** not reviewed this pass — backend only, per rotation scope.
**Migrations:** none — every fix this iteration is application-logic only
(the audit hash-chain version bump changes what new rows hash over, not the
schema; existing rows are unaffected and verify unchanged).

---

## Scope

This is the most heavily pre-audited feature in the rotation after
messaging/notifications and integrations: a module audit (SEC-1 through
SEC-10) and a 4-pass app-review, both describing this as "an exhaustively
hardened surface." Given the size (~4,450 L across 7 files) and significant
growth in specific files since the last full read — `core/audit.py` 576→922 L
(+60%), `error_logs.py` 248→342 L (+38%), `security_monitoring.py` service
1,009→1,073 L, `ip_security.py` endpoint 525→555 L — three parallel
background agents split the surface: (A) the audit hash chain + error logs,
(B) security monitoring + alerts, (C) IP allowlisting + geo-blocking. Each
was briefed to re-verify prior findings against current code, not re-derive
them, and give extra scrutiny to the grown portions.

## Verified good ✅ (re-confirmed, not re-derived)

- **SEC-1** (in-memory tracking caps): `_enforce_key_caps()` still hard-caps
  every tracking dict at `_MAX_TRACKING_KEYS`, called unthrottled from the
  hot `detect_brute_force` path. No new unbounded tracking structure was
  added in the grown code.
- **SEC-2** (head + tail chain-truncation detection): both halves intact —
  genesis-hash anchoring and the checkpoint tail cross-check.
- **SEC-3/SEC-5** (error-log size caps, schema/column-width alignment):
  intact.
- **SEC-4** (audit-log LIKE search escaping via `like_pattern()`): intact.
- **SEC-6** (`security_alerts` org-scoping across all four methods): intact,
  no new alert-handling method bypasses it.
- **SEC-7** (rehash fails closed on keyed-row tamper; break-glass env gate
  on the global rehash op): intact.
- **SEC-8 part 2** (`CountryBlockRule` mutation gated on
  `GEOIP_ALLOW_COUNTRY_RULE_MANAGEMENT`; `GEOIP_FAIL_CLOSED` posture): intact.
- **SEC-9** (session_id fingerprinted in audit export; XSS-safe error
  viewers): intact.
- **SEC-10** (audit reads/exports filter `AuditLog.organization_id`
  directly, not a `user_id` subquery): intact.
- **IP-exception self-service is not exploitable**: a member cannot
  self-grant a bypass — exceptions are created `PENDING`; approval requires
  `security.manage`/`settings.manage`; every by-id exception operation is
  org-scoped; `get_my_exceptions` is user-scoped. (This workflow's
  enforcement effect is addressed separately below — SEC2-28-2.)
- **`get_client_ip` fail-closed XFF handling**: unchanged.
- **E712 cleanliness**: confirmed zero `== True`/`== False` comparisons
  across all seven files.
- **H1/H4/M9** (org-scoped audit reads, keyed HMAC chain, append-only except
  the gated rehash tool): hold, with one documentation nuance below.

## Findings

### SEC2-28-1 — MEDIUM — Orphaned account creation on a denied role-grant ceiling check — ✅ FIXED

**What:** `create_member` (`POST /users`) flushed the new `User` row to the
database (`db.add(new_user)` / `await db.flush()`) _before_ checking whether
the caller's own permissions cover the requested `role_ids`
(`_enforce_role_grant_ceiling`, called afterward). A denied ceiling check
calls `report_privilege_escalation_attempt`, which fires a CRITICAL security
alert and — by design, so the alert survives the 403 about to be raised —
**commits the entire current transaction**, not just the alert row. Since
the new user had already been flushed into that same transaction, the commit
persisted it too: an admin whose role selection exceeded their own grant
ceiling would see a 403 and believe creation failed, while a live, `ACTIVE`,
password-set account with no roles at all silently existed in the database,
permanently occupying that username/email/membership-number until an
operator noticed and cleaned it up.
**Where:** `app/api/v1/endpoints/users.py`, `create_member`.
**Fix:** reordered the function so the requested roles are resolved and
ceiling-checked _before_ the user row is created — the only part that
actually needs `new_user.id` (the `user_roles.insert()` calls) still runs
after the flush, unchanged. `report_privilege_escalation_attempt`'s general
commit-for-durability behavior is untouched, since every _other_ call site
already runs before any of the caller's own writes. Guard test added
(source-order assertion, matching this file's established
`test_privilege_ceiling_wiring.py` pattern for exactly this class of
regression).

### SEC2-28-2 — MEDIUM — Audit hash chain didn't cover `event_category`/`severity` — ✅ FIXED

**What:** `_build_hash_data` (used by both verify and rehash) and the
create-time `log_data` dict both included `event_category` and `severity` —
but `calculate_hash`'s `fields` list never read either one. This was a
genuine, symmetric gap (not a create/verify mismatch): a DB-write-level
attacker (insider, compromised DB credential) could rewrite either field on
an existing row — e.g. `severity: critical → info`, or `event_category:
security → general` — with no hash mismatch and no chain break.
`verify_integrity` would report `verified: True` on the tampered row. Both
`audit_logs.py` and `security_monitoring.py`'s admin views filter/group by
exactly these two fields, so this was a practical way to hide a
critical/security incident from severity- or category-filtered review —
undermining the chain's core promise for the two fields most likely to
matter to a reviewer scanning for something serious.
**Where:** `app/core/audit.py`, `calculate_hash`.
**Fix:** bumped to hash version 4, which adds `event_category` and
`severity` to the hash input (matching the v3 precedent that added
`organization_id`). Existing v1/v2/v3 rows keep verifying byte-identically
without the new fields — only new rows (written at v4) cover them. 2
regression tests added: one confirms a severity/category change now changes
the hash at v4 while v3 stays unaffected; one updates the existing
`_CURRENT_HASH_VERSION == 3` assertion (and a DB-backed
`hash_version == 3` assertion in a sibling test file) to the new value.

### SEC2-28-3 — LOW/MEDIUM — `GET /ip-security/blocked-attempts` was permanently empty — ✅ FIXED

**What:** the `blocked_access_attempts` table (and its admin-visibility
endpoint) exist specifically to record denied requests for incident
response, but nothing in the codebase ever inserted a row — the actual
block-logging path (`IPBlockingMiddleware._log_blocked_attempt`) wrote only
to `audit_logs`. An admin checking this endpoint after suspecting an attack
would see an empty list regardless of how much traffic was actually being
blocked — a false-negative risk for exactly the use case the table's own
docstring describes ("Critical for security auditing and identifying attack
patterns").
**Where:** `app/core/security_middleware.py`, `_log_blocked_attempt`.
**Fix:** the same method now also inserts a `BlockedAccessAttempt` row
(ip_address, country_code/name, block_reason, request path/method,
user-agent) alongside the existing audit-log write, in the same
best-effort try/except so a logging failure still can't affect the actual
block decision. Guard test added confirming both writes happen together
with the right field values.

### SEC2-28-4 — LOW/MEDIUM — `add_blocked_country` 500'd on re-blocking a previously-unblocked country — ✅ FIXED

**What:** `CountryBlockRule.country_code` is unique, and unblocking is a
soft delete (`remove_blocked_country` sets `is_blocked = False`, never
deletes the row) — but `add_blocked_country` always constructed and
inserted a brand-new row with no existing-row check. Block → unblock →
re-block on the same country hit the unique constraint and surfaced as a
generic 500 (via the shared `handle_service_errors` catch-all) instead of
succeeding or returning a clean validation error.
**Where:** `app/services/ip_security_service.py`, `add_blocked_country`.
**Fix:** look up an existing row by `country_code` first; if found, update
it in place (`is_blocked=True`, refresh `reason`/`risk_level`/`updated_by`,
`country_name` if supplied) instead of always inserting. 2 regression tests
added (re-block updates in place with no insert; a genuinely new country
still inserts).

### Cleanup — two orphaned comment banners removed

`ip_security_service.py` carried two `# ====...` section banners with
nothing under them — the methods they used to head were removed at some
earlier, undated point (confirmed via the surrounding code, not via git
history, which this repo's squash-merge topology couldn't resolve
precisely). Removed both; no behavior change.

## Flagged — needs a product decision, not fixed

### SEC2-28-5 — HIGH (by-design-safe direction, but a real functional gap) — Approved IP-allowlist exceptions have no effect on geo-blocking enforcement

**What:** `IPBlockingMiddleware.__call__` calls `geoip.is_ip_blocked(client_ip,
set())` unconditionally — the allowlist argument is always empty, at the
only call site in the app. This is intentional: PR #1544 (2026-08-17) closed
a real cross-tenant hole where the middleware previously unioned every org's
approved `IPException` rows into one set, so one org's approved travel
exception silently let _any_ org's geo-blocked traffic through (this
middleware runs pre-auth, before any tenant context exists). The fix removed
the union rather than replacing it with a safe per-tenant mechanism, and
nothing downstream was updated to reflect that — the class docstring still
said "Supports IP allowlist exceptions," and the module-audit doc's SEC-8
writeup still claimed a fail-closed deployment "lets internal/LAN and
allowlisted operators recover."
**Why not fixed:** the `IPException` request → approve workflow is still
fully functional in the API (create, approve, org-scoped, permission-gated)
and persists rows that enforcement now never reads — a member whose
exception is approved specifically so they can work from a blocked country
is still blocked, with no error message pointing at the real cause. This
needs an actual decision, not a drive-by: either (a) restore a _safe_
version of the feature — a per-IP-only allowlist lookup, keyed on the IP
alone rather than unioned across orgs, which the existing org-scoped
`get_all_active_allowed_ips` could plausibly feed if adapted — or (b)
retire the feature explicitly (relabel/remove the create-exception UI so
nobody approves a request that silently does nothing). Both are behavior
changes an owner should choose, not something to guess at in a security
pass. Corrected the stale class docstring and the module-audit doc's claim
in place; mirrored into `KNOWN_LIMITATIONS.md` as a new open-decision row
(the SEC-8 row was also corrected — it repeated the same stale "allowlisted
operators can recover" claim).

### SEC2-28-6 — LOW — TOCTOU race in the IP-exception duplicate-request check

`request_ip_exception`'s "does a pending/approved exception already exist
for this user+IP" check is a plain read-then-insert with no row lock and no
DB-level unique constraint. Two concurrent identical requests from the same
user could both pass the check and create two `PENDING` rows for the same
IP. Not a security bypass (approval is still required, and per SEC2-28-5
approval currently has no enforcement effect anyway) — worst case is
duplicate admin-queue clutter. Flagged for completeness, not fixed;
proportionate effort given it's an admin-UX nicety, not a capacity or
authorization boundary.

### Tangential note — `system.run_tasks` blast radius (out of this pass's file scope)

`POST /scheduled/run-task?task=audit_log_archival` (gated on
`system.run_tasks`) can trigger the platform-wide audit-retention purge
outside the weekly cron's single-worker claim, with no lock of its own
around `archive_expired_logs` — a manual trigger racing the cron could
compute overlapping purge ranges. Low practical risk (rare, high-privilege
action; default retention is 2555 days) and not itself a finding, but
raised for whichever future pass covers `core/permissions.py`/positions to
confirm `system.run_tasks` truly cannot be granted by an org's own admin —
if it can, this would be the same class of gap SEC-7 already closed for the
audit-rehash op specifically.

## Schema & migration notes

None. The hash-version bump (SEC2-28-2) is pure application logic — no
column change, no migration. `BlockedAccessAttempt` (SEC2-28-3) and
`CountryBlockRule` (SEC2-28-4) both already existed with the columns used.

## Guard tests added

- `tests/test_privilege_ceiling_wiring.py`: `test_create_member_ceiling_check_runs_before_the_user_is_flushed`.
- `tests/test_audit_hash_chain.py`: `test_v4_includes_event_category_and_severity`;
  updated `test_default_version_is_keyed`'s version assertion.
- `tests/test_audit_org_scoping.py`: updated `hash_version` assertion to 4.
- `tests/test_security_middleware.py`: `TestIPBlockingMiddlewareBlockedAttemptLogging`.
- `tests/test_ip_security_service.py`: `TestAddBlockedCountry` (2 tests).

## Completion gate

| Check                                                                                           | Result                  |
| ----------------------------------------------------------------------------------------------- | ----------------------- |
| `flake8` (changed files)                                                                        | clean                   |
| `black --check` (changed files)                                                                 | clean                   |
| `isort --check-only` (changed files)                                                            | clean                   |
| `python3 scripts/validate_migrations.py --strict`                                               | PASSED (no migrations)  |
| backend tests, scope (audit/security_monitoring/ip_security/privilege_ceiling/users/middleware) | 268/268 passed          |
| backend tests, full suite                                                                       | 8927 passed, 22 skipped |
