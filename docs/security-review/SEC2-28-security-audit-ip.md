# Security Review — Security, Audit & IP

**Prefix:** `SEC2` · **Iteration:** 28 · **Reviewed:** 2026-08-27 (pass 1, PR
#1911), 2026-08-31 (pass 2), 2026-09-06 (pass 3), 2026-09-13 (pass 4) · **PR:**
#1911 (pass 1)

**Backend:** `app/api/v1/endpoints/security_monitoring.py` (677 L),
`app/api/v1/endpoints/ip_security.py` (555 L), `app/api/v1/endpoints/audit_logs.py`
(169 L), `app/api/v1/endpoints/error_logs.py` (342 L), `app/services/security_monitoring.py`
(1,073 L), `app/services/ip_security_service.py` (722 L), `app/core/audit.py`
(939 L), the IP-enforcement path of `app/core/security_middleware.py`,
`app/core/geoip.py`. Eight of the nine files are byte-identical to pass 1's
merged state; `core/security_middleware.py` is not — PR #1917 (feature 33,
core-infra, merged 2026-08-27, four days after pass 1's #1911) rewrote its
`SecurityMonitoringMiddleware` substantially. See "Scope check first" under
Pass 2 below for what changed and why it matters to this feature's findings.
**Frontend:** not reviewed in pass 1 (backend only, per rotation scope);
reviewed for the first time in pass 2 — `modules/ip-security/` (admin page,
store, service, components), `pages/AuditLogPage.tsx`,
`pages/ErrorMonitoringPage.tsx`.
**Migrations:** none in either pass — pass 1's fixes were all application-logic
only (the audit hash-chain version bump changes what new rows hash over, not
the schema; existing rows are unaffected and verify unchanged). Pass 2's
findings work made no code change; a Codex review round on the pass-2 PR
itself did produce one small frontend fix — see "Small fix applied this
pass" below.

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

---

## Pass 2 (2026-08-31)

**Scope check first — corrected mid-pass by Codex review.** This pass
originally diffed all nine files this doc covers against the commit pass 1's
PR (#1911) merged as and reported **byte-identical, zero lines changed**
across all nine, treating the pass as pure re-verification plus a
frontend-only review. That was wrong for one file: `core/security_middleware.py`
changed by 159 additions / 117 deletions in PR #1917 (`5a1f859c`, feature 33 —
"core-infra," merged 2026-08-27, four days after pass 1's #1911 merged),
which this pass's diff was run against the wrong baseline and missed
entirely — a real methodology failure, not a rounding error, since it made
every downstream claim about `SecurityMonitoringMiddleware`'s wiring and
severity stale.

**What #1917 actually changed, and why it matters here:** before it,
`SecurityMonitoringMiddleware` read `request.state.user` for the acting
user's id — before `self.app()` had run, and under the wrong attribute name
(the real one is `.authenticated_user`) — so `user_id` was _always_ `None`
and session-hijack/data-exfiltration detection **never fired for any
authenticated request**, silently, since the code path is wrapped in a bare
`except Exception: pass`. #1917 fixed the timing (read
`request.state.authenticated_user` _after_ `self.app()` returns), fixed
`session_id` (previously read from an `X-Session-ID` header no regular
client ever sends — only onboarding does — so hijack detection still never
ran even after the timing fix; now derived by hashing the session's own
auth token), added the `db.commit()` both detectors were missing (their
`SecurityAlertRecord`/audit-log writes were silently rolled back on scope
exit before this), and replaced `EXPORT_ENDPOINTS`'s four entries — none of
which matched a real route — with fifteen that do. Net effect: as of this
pass, session-hijack and data-exfiltration detection for authenticated
requests are _actually wired_ for the first time, where pass 1 (reviewing
`security_monitoring.py`'s detector logic in isolation, without reading the
middleware that calls it) had no way to know they weren't. This pass
re-verified pass 1's five findings against the current code (unaffected by
#1917 — none touch `security_middleware.py`'s IP-enforcement path this doc
also covers) and reviewed the **frontend** for the first time (pass 1 was
explicitly backend-only), but SEC2-28-7 below had to be substantially
rewritten once the corrected baseline was in hand.

### Re-verified — all still hold

- **SEC2-28-1** (role-grant ceiling before user flush, `users.py`): fix intact,
  source-order guard test still passes.
- **SEC2-28-2** (hash v4 covers `event_category`/`severity`, `core/audit.py`):
  fix intact, `_CURRENT_HASH_VERSION == 4`, both regression tests pass.
- **SEC2-28-3** (`BlockedAccessAttempt` row written alongside the audit log,
  `security_middleware.py::_log_blocked_attempt`): fix intact. Also confirmed
  the fix has a real frontend consumer — `BlockedAttemptsTable.tsx`, wired
  through the `blocked-attempts` tab on `/ip-security` — so the endpoint this
  fixed is not itself an instance of the gap found below.
- **SEC2-28-4** (`add_blocked_country` updates an existing row instead of
  re-inserting, `ip_security_service.py`): fix intact, both regression tests
  pass.
- **SEC2-28-5** (approved IP-allowlist exceptions have no enforcement effect):
  still open, unchanged — `IPBlockingMiddleware.__call__` still calls
  `geoip.is_ip_blocked(client_ip, set())` with a hardcoded empty set at the
  only call site. Still needs the owner decision described in pass 1.
- **SEC2-28-6** (TOCTOU on the duplicate-exception check,
  `request_ip_exception`): still open, unchanged — the existing-row check at
  `ip_security_service.py:90-106` is still a plain read then insert with no
  row lock or unique constraint.

Backend re-run: `pytest tests/test_privilege_ceiling_wiring.py
tests/test_audit_hash_chain.py tests/test_audit_org_scoping.py
tests/test_security_middleware.py tests/test_ip_security_service.py` — 129/129
passed.

### Frontend, reviewed for the first time this pass

Found the module: `frontend/src/modules/ip-security/` (admin page, store,
service, three table/form components), plus `pages/AuditLogPage.tsx` and
`pages/ErrorMonitoringPage.tsx`. All use the shared global axios instance
(no module-specific auth gap, Pitfall #7 n/a), no `window.confirm/alert/
prompt` (`IPSecurityAdminPage.tsx` uses `useConfirm()` correctly for the
unblock-country action), no `dangerouslySetInnerHTML` anywhere in the four
files reviewed (React's default escaping covers `BlockedAttemptsTable`'s
`blockReason`/`requestPath` and the audit/error viewers' free-text fields —
matches the existing `docs/KNOWN_LIMITATIONS.md` SEC-9 row's "no stored-XSS
path" claim, re-confirmed rather than re-derived), no banned
`.toLocaleString()`-family date methods, `/security/`, `/audit-logs`, and
`/ip-security/` are all present in `UNCACHEABLE_PREFIXES`
(`frontend/src/utils/apiCache.ts`), and `/errors` is separately covered.
`AuditLogPage`/`ErrorMonitoringPage` routes carry a `ProtectedRoute`
permission gate matching (or a reasonable superset of) their backend
endpoints' `require_permission` — `IPSecurityAdminPage`'s did not
(`security.manage` only, where the backend accepts `security.manage` OR
`settings.manage`); this pass's original claim that all three matched was
wrong and is fixed below, not just corrected in the writeup.

### SEC2-28-7 — HIGH (operational-security value, not an access-control bypass) — `security_monitoring.py`'s alert surface has no admin UI, and two of its four detectors have a deeper visibility gap than "missing UI" alone

**Corrected after Codex review, in two rounds** (nine findings across this
section were wrong or overstated in the original writeup — severity,
visibility, and the underlying wiring status — all now verified directly
against the code rather than assumed):

**What actually fires, and at what severity** (`app/services/
security_monitoring.py`): `detect_brute_force` (called from `endpoints/
auth.py`, twice, on every login attempt) creates a `ThreatLevel.HIGH` alert
once the per-IP/per-user hourly failed-attempt threshold is crossed — never
CRITICAL. `detect_data_exfiltration` (called from
`core/security_middleware.py`'s `SecurityMonitoringMiddleware`, post-response,
on export endpoints) creates a `HIGH` alert for a single large transfer, and
escalates to `CRITICAL` only if the user's rolling 24h total exceeds 5× the
single-transfer threshold. `detect_data_exfiltration` also accepts an
optional `destination` argument that would escalate an external transfer to
`CRITICAL` (`AlertType.EXTERNAL_DATA_TRANSFER`) — but the sole production
call site (`security_middleware.py:1406`) never supplies it, so that branch
is unreachable as currently wired; only the cumulative-volume path can
produce a CRITICAL exfiltration alert today. `detect_session_hijack` and
`report_privilege_escalation_attempt`/`detect_privilege_escalation` are the
only two that are unconditionally `CRITICAL`. The original finding's "all
five paths create `ThreatLevel.CRITICAL` rows" was wrong for three of the
five; the audit-log calls in the hijack/exfiltration paths pass
`severity="critical"`, but that is the _audit event's_ severity label, a
separate field from the persisted alert's `threat_level` — the two were
conflated.

**The authenticated-path detectors already have a visibility path — just
not the one being asked for.** `detect_session_hijack`,
`detect_data_exfiltration`, and `report_privilege_escalation_attempt` each
call `log_audit_event(..., user_id=user_id, ...)`, and
`AuditLogger.create_log_entry` (`core/audit.py`) resolves `organization_id`
from that `user_id` when the caller doesn't pass one explicitly — so these
three land as org-scoped rows in `audit_logs`, and `AuditLogPage`
(`/audit-logs`, already routed and permission-gated) already lists and
filters them. The real, narrower gap for these three: there is no
dedicated _alert_-specific view with acknowledge/resolve actions — an admin
combing the audit log can find "session_hijack_suspected," but nothing
tells them a security alert exists and is unresolved, and
`acknowledge_alert`/`resolve_alert` (which mutate the separate
`SecurityAlertRecord` table, not `audit_logs`) have no UI caller at all.

**Brute-force alerts are a distinct, more severe gap: no view can show
them, not just the missing one.** `auth.py`'s login handler calls
`detect_brute_force(db, ip=login_ip, user_id=None, success=False)` on
_every_ failed login — unconditionally, since `authenticate_user` returns
`user=None` on both an unknown username and a wrong password for a known
account, so there is no branch where a failed-login brute-force alert ever
carries a `user_id`. `_add_alert`'s `organization_id` is derived from
`alert.user_id` (`None` → `organization_id=None`, "platform-level" per its
own comment), and `get_recent_alerts`/`acknowledge_alert`/`resolve_alert`
all filter `SecurityAlertRecord.organization_id == organization_id` — a
brute-force alert with `organization_id=NULL` is excluded by every one of
them, unconditionally. This is not something a straightforward "add the
missing admin screen" fix closes: even a hypothetical
`security_monitoring.py` frontend calling the existing endpoints as-is could
never surface a single brute-force alert, because no org-scoped query
matches a `NULL` row and there is no platform-level/cross-org alert view in
this codebase at all. Closing it requires deciding who is authorized to see
a platform-wide alert (every org's admin? a new platform-operator role?)
without weakening the tenant isolation `get_recent_alerts` et al. currently
enforce correctly for every other alert type — a genuine access-control
design question, not a drive-by fix, and out of scope for this pass.

**The data-exfiltration detector also has a real backend gap, not just a
missing frontend:** `SecurityMonitoringMiddleware` only calls
`detect_data_exfiltration` when the response carries a `Content-Length`
header (`if content_length_value:`). `StreamingResponse` — Starlette's type
for a response whose body isn't fully known upfront — never gets one
computed automatically, and confirmed by reading three of
`EXPORT_ENDPOINTS`' fifteen routes (`admin_hours.py::export_entries`,
`equipment_check.py::export_csv`, `finance.py`'s CSV export) that each
returns `StreamingResponse(iter([csv_content]), ...)` with no `Content-Length`
in its `headers=`, even though the full CSV is already built in memory
before the response is constructed — nothing here is a true incremental
stream. So bulk exports through at least these three routes (likely more of
the fifteen; not exhaustively audited every route this pass) create no
data-exfiltration alert at any size, regardless of how much data leaves.
This needs a backend fix (compute and attach `Content-Length` for these
routes, or a size-tracking approach in the middleware that doesn't depend on
that header) rather than a frontend one, and is flagged rather than fixed
here since it touches the export handlers themselves, not just the
monitoring/alerting layer this doc's scope covers.

**What is still accurately "detected but has no UI at all":** the
`security_monitoring.py` endpoint surface itself. None of its 13 endpoints
(`/security/status`, `/alerts`, `/alerts/{id}/acknowledge`,
`/alerts/{id}/resolve`, `/audit-log/integrity`, `/audit-log/status`,
`/audit-log/checkpoint`, `/audit-log/rehash`, `/audit-log/entries`,
`/audit-log/export`, `/intrusion-detection/status`,
`/data-exfiltration/status`, `/manual-check`) has a working frontend
consumer. `frontend/src/services/adminServices.ts` does define a
`securityService` wrapper for five of them (`getStatus`, `getAlerts`,
`acknowledgeAlert`, `verifyAuditIntegrity`, `triggerManualCheck`), but
confirmed by exhaustive grep (`grep -rn "'/security/` and
`grep -rn securityService` across `frontend/src`) that nothing calls it —
exported from `adminServices.ts`, re-exported from `services/api.ts`,
consumed by zero components, pages, or stores. The other eight endpoints
have no frontend wrapper method at all. `AuditLogPage` (`audit_logs.py`),
`ErrorMonitoringPage` (`error_logs.py`), and `IPSecurityAdminPage`
(`ip_security.py`) all exist, are routed, and are permission-gated
correctly — three of this feature's four backend files have a working admin
screen; `security_monitoring.py` specifically does not.

**Where:** `backend/app/api/v1/endpoints/security_monitoring.py` (all
routes, no frontend consumer); `backend/app/services/security_monitoring.py`
(`_add_alert`, org-NULL platform alerts); `backend/app/core/
security_middleware.py` (`Content-Length`-gated exfiltration check);
`admin_hours.py`/`equipment_check.py`/`finance.py` (confirmed
`StreamingResponse` exports with no `Content-Length`).

**Why not fixed:** three distinct pieces of real work, none a drive-by fix —
a new admin screen with an alert list/detail view and acknowledge/resolve
actions (permission decision: `audit.view` for the read endpoints matches
the backend; both `/alerts/{id}/acknowledge` and `/alerts/{id}/resolve` —
not just `resolve` — require `audit.export` server-side, same as the
destructive `/audit-log/rehash`/`checkpoint` ops, so a screen admitting
`audit.view`-only holders for reads needs its two mutation actions gated
separately or they 403 for every read-only auditor who can see them); a
platform-level alert ownership/viewing design for `organization_id=NULL`
rows that does not weaken existing tenant isolation; and a `Content-Length`
fix across however many of the fifteen `EXPORT_ENDPOINTS` routes turn out to
use `StreamingResponse` without one. All three flagged; mirrored into
`docs/KNOWN_LIMITATIONS.md`.

### Small fix applied this pass — IP-security route permission gate

**What:** `frontend/src/modules/ip-security/routes.tsx`'s `/ip-security`
route required only `security.manage`, while every administrative mutation
in `ip_security.py` accepts `security.manage` **or** `settings.manage` (the
file's own module docstring documents the OR) — a `settings.manage`-only
admin was authorized by the API but refused the page. Caught by Codex
review of this doc's original (incorrect) claim that the two already
matched.
**Fix:** `requiredPermission="security.manage"` →
`requiredAnyPermission={['security.manage', 'settings.manage']}`, using
`ProtectedRoute`'s existing any-of support (already used by
`communications`/`scheduling` routes elsewhere in the codebase). This alone
turned CI red: `src/modules/testing/testingRegistry.test.ts`'s
`repeats each route gate exactly` test compares every route's actual gate
against a source-of-truth registry (`testingRegistry.ts`), which still
declared `/ip-security` as `permission: 'security.manage'` — updated to
`anyPermission: ['security.manage', 'settings.manage']` to match.
`npx eslint`, `tsc --noEmit`, and the full frontend suite (`npx vitest run`,
5520/5520) all pass.

### Minor note — `/admin/errors` route permission doesn't match its API's

`frontend/src/modules/admin/routes.tsx` gates `/admin/errors`
(`ErrorMonitoringPage`) on `settings.manage`, but every `error_logs.py`
endpoint it calls requires `audit.view` (list/stats), `audit.export`
(export), or `audit.manage` (clear) — three different, more specific
permissions, none of which is `settings.manage`. Both directions fail safe
(the backend is the real authorization boundary and enforces correctly
either way — a `settings.manage`-only admin who reaches the page gets clean
403s from the API, not data; an `audit.view`-only admin is simply refused
the route and never reaches the API at all), so this is a UX/consistency
gap, not a security bypass. Changing the route gate is a one-line change but
changes who can reach the screen in both directions, so it is left as a
flagged observation rather than fixed inline.

## Guard tests added (Pass 2)

None new, but the one code change this pass (the `IPSecurityAdminPage`
route permission fix) is protected by an _existing_ test that actually
covers it — `src/modules/testing/testingRegistry.test.ts`'s
`repeats each route gate exactly` — corrected from an earlier draft of this
section that credited `routeIntegrity.test.ts` and the `ip-security` store
test instead: neither of those touches route permissions at all
(`routeIntegrity.test.ts` checks declared paths and navigation targets;
`vitest run src/modules/ip-security`'s one test exercises the Zustand
store), so reverting the route to `requiredPermission="security.manage"`
would have left that reported suite green. The `testingRegistry.ts` entry
this fix required (`anyPermission: [...]`, replacing `permission: '...'`)
is what the gate-comparison test actually diffs against, and it caught the
drift live — see "Fix" above. SEC2-28-7's remaining findings (brute-force
platform-alert visibility, the exfiltration `Content-Length` gap, the
external-destination-escalation dead code, and the missing alert UI) are
all flagged, not fixed, so none has a reproducible code path to pin.

## Completion gate (Pass 2)

One small frontend fix this pass (the route permission gate); everything
else is findings-only. Ran the gate against the nine backend files and the
frontend files reviewed this pass, rather than skipping it as "n/a," per
CLAUDE.md.

| Check                                                                                                               | Result                     |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `flake8` (9 backend files this doc covers)                                                                          | clean                      |
| `black --check` (same 9 files)                                                                                      | clean                      |
| `isort --check-only` (same 9 files)                                                                                 | clean                      |
| `python3 scripts/validate_migrations.py --strict`                                                                   | n/a — no migration touched |
| backend tests, scope (privilege_ceiling/audit_hash_chain/audit_org_scoping/security_middleware/ip_security_service) | 129/129 passed             |
| `node scripts/tsc-native.mjs --noEmit` (full project, per the wrapper CLAUDE.md documents)                          | 0 errors                   |
| `npx eslint` (ip-security module + AuditLogPage/ErrorMonitoringPage/adminServices.ts, the files reviewed this pass) | 0 errors/warnings          |
| `npx vitest run` (full frontend suite, after the route permission fix + its `testingRegistry.ts` update)            | 5520/5520 passed           |

---

## Pass 3 (2026-09-06)

**Re-verification split across three parallel readers**, matching pass 2's
split: (A) `core/audit.py` + `audit_logs.py` + `error_logs.py`, (B)
`services/security_monitoring.py` + its endpoint file, (C) `ip_security.py` +
`ip_security_service.py` + `geoip.py` + `security_middleware.py`'s
`IPBlockingMiddleware`/`SecurityMonitoringMiddleware`. Each was briefed to
re-verify prior findings against current code, not re-derive them, and to
give extra scrutiny to anything that had grown or changed since pass 2.

### Re-verified — all still hold, nothing regressed

- **SEC-1** (in-memory tracking caps): still intact, and the growth in
  `security_monitoring.py` (below) added a new tracker that is correctly
  included in the capped set.
- **SEC-2** (genesis-hash anchoring + tail-truncation checkpoint
  cross-check): both intact, unchanged.
- **SEC-4** (audit search LIKE escaping via the shared `like_pattern()`
  helper): intact.
- **SEC-6** (`security_alerts` org-scoping across all four methods): intact;
  no new alert-handling method added since pass 2 bypasses it.
- **SEC-7** (rehash fails closed on a keyed-row mismatch; break-glass
  `AUDIT_ALLOW_CHAIN_REHASH` gate; `/checkpoint`/`/integrity` on
  `audit.export`/`audit.view`): intact.
- **SEC-8** (fail-closed geo-blocking behind `GEOIP_FAIL_CLOSED`; private/
  reserved IPs checked before the country lookup; `CountryBlockRule`
  mutation gated behind `GEOIP_ALLOW_COUNTRY_RULE_MANAGEMENT`): intact.
- **SEC-9** (`_fingerprint_session_id` non-reversible, applied in
  `/audit-log/export`): intact. Also confirmed why `audit_ship_service.py`
  (new to this feature's scope — see below) doesn't need the same
  treatment: its serializer (`AuditLogger.serialize_row`) doesn't include
  `session_id` in the shipped payload at all, so there's no raw value to
  redact there in the first place.
- **SEC-3/SEC-5** (error-log per-item/total size caps; `error_type` schema
  cap aligned to the DB column width): intact.
- **SEC2-28-1** through **SEC2-28-4** (all previously FIXED): intact,
  unchanged.
- **SEC2-28-5** (HIGH, flagged, not fixed) — approved IP-allowlist
  exceptions still have zero enforcement effect. Confirmed
  `IPBlockingMiddleware.__call__` is still the only production call site of
  `is_ip_blocked`, still with a hardcoded empty set. Still needs the owner
  decision described in pass 1.
- **SEC2-28-6** (LOW, flagged, not fixed) — the TOCTOU race in
  `request_ip_exception`'s duplicate-pending-exception check is still
  present, same shape.
- **SEC2-28-7** (HIGH, flagged, not fixed) — re-verified in full, including
  the exact severities (`detect_brute_force` HIGH-only,
  `detect_data_exfiltration` HIGH/CRITICAL-on-cumulative with a still-dead
  `destination`-escalation branch, `detect_session_hijack`/privilege-
  escalation unconditionally CRITICAL), the still-open `organization_id=NULL`
  brute-force-alert invisibility gap, and the still-zero frontend consumers
  of `security_monitoring.py`'s endpoint surface. **Scope of the
  `Content-Length`-gated exfiltration gap sharpened:** pass 2 sampled 3 of the
  15 `EXPORT_ENDPOINTS` routes and found each returned `StreamingResponse`
  with no `Content-Length`; this pass grepped every `StreamingResponse(` call
  site across `app/api/v1/endpoints/` (16 call sites in 10 files, a superset
  of `EXPORT_ENDPOINTS`) and confirmed **none** sets `Content-Length` — the
  gap is effectively the entire export surface, not a sampled subset. Same
  severity/ownership as pass 2 filed it; still needs the backend fix
  (`Content-Length` computed for buffered-then-streamed exports, or a
  size-tracking approach that doesn't depend on that header) rather than
  anything in this feature's own files.

### New — dead detector code (LOW, flagged, not fixed)

`security_monitoring.py`'s `analyze_request`, `_check_rate_limit`, and
`_check_injection_patterns` — the SQL-injection/XSS/path-traversal
pattern-matching detector and the generic rate-limit-violation detector —
have **zero production callers**. Grepped every call site across
`app/core/security_middleware.py` and the rest of `backend/app`: the only
callers are this file's own tests. This isn't a new vulnerability (inert
code opens nothing), but the module's own docstring describes "comprehensive
security monitoring" including pattern-based attack detection that, as
wired, never inspects a real request. Same shape as SEC2-28-7's "detected but
no UI" framing, just one layer earlier: "written but never invoked." Worth a
product decision (wire it into `SecurityMonitoringMiddleware`, or remove it)
rather than a drive-by change to code three passes have now read without
flagging it — not fixed here.

### Scope correction — `audit_ship_service.py` added to this feature's file list

**What:** `app/services/audit_ship_service.py` (off-host audit-log shipping
to `AUDIT_SHIP_WEBHOOK_URL`, an ISO/IEC 27001 A.8.15 control — HMAC-signed
NDJSON batches, watermark-based delivery) shares the audit signing key and
row serializer with `core/audit.py` and is squarely "audit logging" by any
reasonable scope definition, but has never appeared in this feature's file
list in the module audit or any of the three security-review passes. Added
to the Rotation table's principal-code column and reviewed against all seven
checklist dimensions for the first time.

**Verified good:** gated behind `system.run_tasks` for its manual
`/scheduled/run-task?task=audit_log_ship` trigger, same posture as
`audit_log_archival`'s existing gate; `_MAX_BATCHES_PER_RUN = 20` bounds one
run's work (Pitfall #9 spirit); the collector URL is re-validated via
`assert_outbound_url_safe(allow_private=AUDIT_SHIP_ALLOW_PRIVATE_DESTINATION)`
on every run, not just at config time; TLS certificate verification is on by
default (no `verify=False`); shipping every org's audit trail to one
platform-configured collector is a deliberate, documented design choice
consistent with the existing platform-level audit-chain model (SEC-7's
break-glass rehash is the same "no platform-super-admin role, so this is an
env-gated platform op" shape) — not a new tenant-isolation gap. **Already
tracked, not re-derived as new:** the outbound-request TOCTOU (the actual
`httpx` connection resolves DNS independently of `assert_outbound_url_safe`'s
own resolution, so a rebinding attacker can still win the race within a
single call) is one of six sites listed in `docs/KNOWN_LIMITATIONS.md`'s
"Outbound Integration Requests" entry, and `audit_ship_service.py` is
correctly still on that list — this pass's per-run re-validation closes a
narrower, different gap (a collector URL edited since the last run) and
doesn't change that entry.

**SEC2-28-9 — LOW/MEDIUM — watermark read was a plain SELECT, not a locking
read — ✅ FIXED**

**What:** `audit_log_ship` runs both on a schedule (every 30 minutes, per
`scheduled_tasks.py`'s registry) and via a manual
`/scheduled/run-task?task=audit_log_ship` trigger, so two runs can execute
concurrently — the same "scheduled runner racing a manual trigger" shape
pass 1 already raised as a tangential note for `audit_log_archival`, and
which this pass now finds actually landed here with no lock in place.
`_get_or_create_state`'s fetch of the singleton `AuditShipState` watermark
row was a plain `SELECT`, so two concurrent runs could both read the same
watermark, both ship an overlapping batch to the external collector, and
race to advance it — whichever run's transaction commits last could regress
the watermark, causing the next run to re-deliver rows already shipped.
Reproduced directly (not inferred): with the fix reverted, a real two-session
`asyncio.gather` test shipped one row's audit content twice to the collector
in 5/5 runs. Not a data-loss or authorization bypass — worst case is
duplicate off-host delivery, which the module's own design already tolerates
for failed-delivery retries — so scoped LOW/MEDIUM rather than HIGH.
**Where:** `app/services/audit_ship_service.py`, `_get_or_create_state`.
**Fix:** added `.with_for_update()` to the watermark read, serializing the
two runs — the second blocks until the first commits, then sees the
advanced watermark and ships only what's left (CLAUDE.md pitfall #27's
model, applied to a watermark advance rather than a capacity count). A
narrower, one-time race is accepted rather than also fixed: if the
`AuditShipState` row does not exist yet (only possible on the very first
`audit_log_ship` run ever, on a fresh install), two concurrent first-runs
could both attempt to insert `id=1` and one would hit a primary-key
conflict — logged as a delivery failure and retried next run, not a security
issue, and disproportionate to guard given it can only occur once in the
row's entire lifetime. Guard test
(`tests/test_audit_shipping.py::TestConcurrentShipRuns`) uses two real,
independently-committing sessions and `asyncio.gather`, asserting the total
delivered rows across both runs equals the actual new-row count (not
doubled, not lost) and the final watermark matches the newest row — verified
to fail reliably (5/5 runs) with the fix reverted and pass reliably (multiple
runs) with it in place.

### Guard tests added (Pass 3)

- `tests/test_audit_shipping.py`: `TestConcurrentShipRuns::test_two_concurrent_runs_never_double_ship_or_regress_watermark`.

### Completion gate (Pass 3)

One fix this pass (`audit_ship_service.py`'s watermark lock); everything
else is re-verification plus findings-only (the dead-detector note, the
scope correction). Ran the gate against the full repo, matching CI's scope.

| Check                                                                                               | Result                                                            |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                       | clean                                                             |
| `black --check app/ tests/ alembic/`                                                                | clean (1,504 files)                                               |
| `isort --check-only app/ tests/ alembic/`                                                           | clean                                                             |
| `python3 scripts/validate_migrations.py --strict`                                                   | PASSED — 431 revisions, single head (no migration this pass)      |
| backend tests, scope (audit/security_monitoring/ip_security/error_log/privilege_ceiling/middleware) | 335/335 passed, 1 skipped (env-only)                              |
| backend tests, full suite                                                                           | 11,505 passed, 21 skipped (env-only, all pre-existing/documented) |
| frontend `tsc`/`eslint`/`vitest`                                                                    | n/a — no frontend file touched this pass                          |

---

## Pass 4 (2026-09-13)

Full re-read of all nine files this doc covers (`security_monitoring.py`
endpoint (677 L) + service (1,338 L — grown from pass 3's stated size;
byte-for-byte re-read start to finish, not diffed against a prior commit,
because this repo's squash-merge history makes the file's own git log an
unreliable diff baseline — the same caveat pass 2 hit on
`security_middleware.py`), `ip_security.py` (555 L) + `ip_security_service.py`
(722 L), `audit_logs.py` (169 L), `error_logs.py` (342 L), `core/audit.py`
(939 L), `core/geoip.py` (267 L), `audit_ship_service.py` (165 L), plus
`core/suspicious_ip.py` (236 L, named explicitly in `CLAUDE.md`'s Attack
Protection table and read for the first time under this feature's own file
list) and the `IPBlockingMiddleware`/`SecurityMonitoringMiddleware` sections of
`core/security_middleware.py`. `git log` confirms none of the nine core files
changed since pass 3 (2026-09-06) — the only touch in that window
(`f14370f`, onboarding navigation-layout work) doesn't touch this feature.

### Route inventory — 35 routes, all enumerated, all correctly gated

| Method | Path                                     | Auth dependency      | Permission                                            | Org-scoped                                                      | Notes                                                                                 |
| ------ | ---------------------------------------- | -------------------- | ----------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| GET    | `/security/status`                       | `require_permission` | `audit.view`                                          | yes (via `organization_id` param)                               |                                                                                       |
| GET    | `/security/alerts`                       | `require_permission` | `audit.view`                                          | yes                                                             |                                                                                       |
| POST   | `/security/alerts/{id}/acknowledge`      | `require_permission` | `audit.export`                                        | yes (fetch filters `organization_id`)                           |                                                                                       |
| POST   | `/security/alerts/{id}/resolve`          | `require_permission` | `audit.export`                                        | yes                                                             |                                                                                       |
| GET    | `/security/audit-log/integrity`          | `require_permission` | `audit.view`                                          | n/a — chain-level stats, by design                              |                                                                                       |
| GET    | `/security/audit-log/status`             | `require_permission` | `audit.view`                                          | n/a — chain-level stats                                         |                                                                                       |
| POST   | `/security/audit-log/checkpoint`         | `require_permission` | `audit.export`                                        | n/a — global chain checkpoint                                   |                                                                                       |
| POST   | `/security/audit-log/rehash`             | `require_permission` | `audit.export`                                        | n/a — global chain, break-glass `AUDIT_ALLOW_CHAIN_REHASH` gate |                                                                                       |
| GET    | `/security/audit-log/entries`            | `require_permission` | `audit.view`                                          | yes (`AuditLog.organization_id` filter)                         | `user_id` query filter is AND'd with the org filter, not a substitute for it          |
| GET    | `/security/audit-log/export`             | `require_permission` | `audit.export`                                        | yes                                                             | `session_id` fingerprinted (SEC-9)                                                    |
| GET    | `/security/intrusion-detection/status`   | `require_permission` | `audit.view`                                          | yes                                                             |                                                                                       |
| GET    | `/security/data-exfiltration/status`     | `require_permission` | `audit.view`                                          | yes                                                             |                                                                                       |
| POST   | `/security/manual-check`                 | `require_permission` | `audit.export`                                        | yes                                                             |                                                                                       |
| POST   | `/ip-security/exceptions`                | `get_current_user`   | any authenticated                                     | self (user-scoped create)                                       |                                                                                       |
| GET    | `/ip-security/exceptions/me`             | `get_current_user`   | any authenticated                                     | self                                                            |                                                                                       |
| GET    | `/ip-security/exceptions/pending`        | `require_permission` | `security.manage` OR `settings.manage`                | yes                                                             |                                                                                       |
| GET    | `/ip-security/exceptions`                | `require_permission` | `security.manage` OR `settings.manage`                | yes                                                             |                                                                                       |
| POST   | `/ip-security/exceptions/{id}/approve`   | `require_permission` | `security.manage` OR `settings.manage`                | yes                                                             |                                                                                       |
| POST   | `/ip-security/exceptions/{id}/reject`    | `require_permission` | `security.manage` OR `settings.manage`                | yes                                                             |                                                                                       |
| POST   | `/ip-security/exceptions/{id}/revoke`    | `require_permission` | `security.manage` OR `settings.manage`                | yes                                                             |                                                                                       |
| GET    | `/ip-security/exceptions/{id}/audit-log` | `require_permission` | `security.manage`, `settings.manage`, OR `audit.view` | yes (`ensure_found` 404s pre-check + join filter)               |                                                                                       |
| GET    | `/ip-security/blocked-attempts`          | `require_permission` | `security.manage`, `settings.manage`, OR `audit.view` | n/a — pre-auth edge data, org-agnostic by design                |                                                                                       |
| GET    | `/ip-security/blocked-countries`         | `require_permission` | `security.manage` OR `settings.manage`                | n/a — platform-wide edge control                                |                                                                                       |
| POST   | `/ip-security/blocked-countries`         | `require_permission` | `security.manage` OR `settings.manage`                | n/a                                                             | + `GEOIP_ALLOW_COUNTRY_RULE_MANAGEMENT` gate                                          |
| DELETE | `/ip-security/blocked-countries/{code}`  | `require_permission` | `security.manage` OR `settings.manage`                | n/a                                                             | + `GEOIP_ALLOW_COUNTRY_RULE_MANAGEMENT` gate                                          |
| GET    | `/audit-logs`                            | `require_permission` | `audit.view`                                          | yes                                                             | search escaped via `like_pattern()`/`LIKE_ESCAPE_CHAR`                                |
| GET    | `/audit-logs/stats`                      | `require_permission` | `audit.view`                                          | yes                                                             |                                                                                       |
| GET    | `/audit-logs/{log_id}`                   | `require_permission` | `audit.view`                                          | yes                                                             |                                                                                       |
| POST   | `/errors/log`                            | `get_current_user`   | any authenticated                                     | self-stamped org                                                | per-user rate limit (120/min), fail-open on Redis down (non-security-critical ingest) |
| GET    | `/errors`                                | `require_permission` | `audit.view`                                          | yes                                                             |                                                                                       |
| GET    | `/errors/codes`                          | `get_current_user`   | any authenticated                                     | n/a — static reference data                                     |                                                                                       |
| GET    | `/errors/stats`                          | `require_permission` | `audit.view`                                          | yes                                                             |                                                                                       |
| DELETE | `/errors`                                | `require_permission` | `audit.manage`                                        | yes                                                             | audit-logged before commit                                                            |
| GET    | `/errors/export`                         | `require_permission` | `audit.export`                                        | yes                                                             |                                                                                       |

35/35 carry an auth dependency; the two intentionally-open ones
(`POST /ip-security/exceptions`, `GET /ip-security/exceptions/me`) are
self-scoped by design (a member requesting/viewing their own exception) and
`GET /errors/codes` is static documentation, not log data — none is a gap.
No route's permission is looser than the sensitivity of what it returns
(XC-2 n/a); no `require_permission(a, b)` OR-list includes a broadly-seeded
grant (all three real gates here — `security.manage`, `settings.manage`,
`audit.view`/`audit.export`/`audit.manage` — are admin-tier permissions, none
on `DEFAULT_POSITIONS["member"]` or the `firefighter` rank).

### Re-verified — all prior findings hold, nothing regressed

- **SEC-1 through SEC-9** (module-audit iteration 23) and **all of pass
  1–3's SEC2-28-1 through SEC2-28-9**: re-read the actual code (not assumed
  from the doc) and confirmed every fix is still present exactly as pass 3
  described — hash v4 covering `event_category`/`severity`; genesis-head
  anchor + tail-truncation checkpoint cross-check; keyed-row rehash
  fail-closed + `AUDIT_ALLOW_CHAIN_REHASH` break-glass; `security_alerts`
  org-scoped on all four methods; `GEOIP_FAIL_CLOSED` + private-IP-first +
  `GEOIP_ALLOW_COUNTRY_RULE_MANAGEMENT`; `BlockedAccessAttempt` written
  alongside the audit log; `add_blocked_country` updates-in-place;
  `audit_ship_service.py`'s watermark `.with_for_update()` lock (SEC2-28-9).
- **SEC2-28-5** (HIGH, flagged) — still open, unchanged.
  `IPBlockingMiddleware.__call__` (`security_middleware.py:1341`) is still
  the only production call site of `is_ip_blocked`, still
  `geoip.is_ip_blocked(client_ip, set())` with a hardcoded empty set, for the
  documented reason (pre-auth, no tenant context). Still needs the owner
  decision from pass 1; still mirrored in `KNOWN_LIMITATIONS.md`.
- **SEC2-28-6** (LOW, flagged) — still open, unchanged.
  `request_ip_exception`'s existing-exception check
  (`ip_security_service.py:90-106`) is still a plain read-then-insert, no
  lock, no unique constraint.
- **SEC2-28-7** (HIGH, flagged) — still open, unchanged. `securityService` in
  `frontend/src/services/adminServices.ts` re-exported from `services/api.ts`
  and called from zero components (re-confirmed by grep this pass); the
  `organization_id=NULL` brute-force-alert invisibility gap and the
  `Content-Length`-gated exfiltration gap are both still present in the code
  exactly as described.
- **Dead detector code** (`analyze_request`, `_check_rate_limit`,
  `_check_injection_patterns`) — re-confirmed zero production callers
  (`grep` across `app/` outside `security_monitoring.py` itself returns
  nothing). Still flagged, not fixed, same as pass 3.
- **The `system.run_tasks` blast-radius tangential note from pass 1 is now
  settled, not just re-verified.** `app/core/permissions.py:456-464`
  documents in-line why the permission is seeded to no default role — "so
  this is intentionally granted to no default role — only the wildcard
  'System Owner' ... matches it" — closing the open question pass 1 raised
  about whether an org's own admin could hold it. No finding; recorded so a
  future pass doesn't re-open it.
- **Frontend** (`ip-security` module, `AuditLogPage`, `ErrorMonitoringPage`,
  `adminServices.ts`): `git log` shows none of these files changed since pass
  2's fix. Spot-re-verified the fix itself still holds:
  `modules/ip-security/routes.tsx`'s `/ip-security` route still declares
  `requiredAnyPermission={['security.manage', 'settings.manage']}`, and
  `testingRegistry.ts`'s matching entry still reads
  `anyPermission: ['security.manage', 'settings.manage']`.

### New finding

### SEC2-28-10 — HIGH — The audit hash chain has no concurrency control: two simultaneous writes fork the chain and `verify_integrity` reports the fork as tampering

**What:** `AuditLogger.create_log_entry` determines the new row's
`previous_hash` with a plain, non-locking read —
`select(AuditLog).order_by(AuditLog.id.desc()).limit(1)` — inside
`db.begin_nested()` (a SAVEPOINT, not a serializing lock). Under MySQL's
default `REPEATABLE READ`, two audit-log writes racing on two different
`AsyncSession`s (i.e. two different concurrent HTTP requests, or two
independent short-lived sessions such as the ones `IPBlockingMiddleware` and
`SecurityMonitoringMiddleware` open per call) can both read the same "last
row" before either commits, and both then insert a new row carrying the
_same_ `previous_hash`. There is no DB-level constraint (unique or otherwise)
on `previous_hash`/`current_hash` to catch this — it is caught, if at all,
only later by `verify_integrity`'s chain-link check, which reports it
indistinguishably from real tampering: `"Chain broken - previous hash does
not match"`.

**Where:** `backend/app/core/audit.py:205-210` (the unlocked read),
consumed by every caller of `log_audit_event`/`log_event`
(48 endpoint files) and, at higher frequency, the two independent
per-request sessions in `core/security_middleware.py`
(`IPBlockingMiddleware._log_blocked_attempt`,
`SecurityMonitoringMiddleware.__call__`'s session-hijack check).

**Failure scenario — reproduced directly, not inferred.** Using two real,
independently-committing `AsyncSession`s (`database_manager.session_factory()`)
and `asyncio.gather`, exactly the pattern `tests/test_audit_shipping.py`'s
`TestConcurrentShipRuns` already uses for the sibling watermark race
(SEC2-28-9):

```python
session_a = database_manager.session_factory()
session_b = database_manager.session_factory()

async def write(db, tag):
    r = await audit_logger.create_log_entry(
        db, event_type=f"race_{tag}", event_category="security",
        severity="info", event_data={"tag": tag},
    )
    await db.commit()
    return r

a, b = await asyncio.gather(write(session_a, "A"), write(session_b, "B"))
```

Both rows come back with the **identical** `previous_hash` (the genesis
value, in an empty table — the same shape occurs mid-chain against any
shared "last row"). A subsequent `verify_audit_log_integrity()` against the
same rows returns `verified: False` with `"Chain broken - previous hash does
not match"` naming the second-committed row — reproduced reliably, not
occasionally, in a fresh MySQL instance with no other traffic. Under real
concurrent load (or two workers/pods) the same race applies to any two
audit-log writes that overlap in time, not just a contrived pair.

**Why this is more than a lab curiosity:**

- **48 endpoint files** call `log_audit_event`/`log_event`, and several fire
  on plain reads (e.g. `security_status_viewed` on every `GET
/security/status`), so ordinary concurrent traffic — including, by this
  codebase's own documentation elsewhere in this file
  (`security_monitoring.py`'s comments on the SPA firing "several API calls
  in parallel on one page load"), routine single-user browsing — produces
  overlapping audit writes routinely, not just under adversarial load.
- **It is reachable, at will, by an unauthenticated attacker.**
  `IPBlockingMiddleware._log_blocked_attempt` opens a brand-new
  `async_session_factory()` session and writes an audit row for _every_
  blocked request, pre-auth. Sending a burst of concurrent requests from a
  blocked IP/country (or several blocked IPs at once) reliably produces the
  overlapping-write pattern above, with no credentials needed — a
  denial-of-service against the integrity-monitoring subsystem itself, not
  against the app's availability.
- **The failure mode is a false CRITICAL alert, not a missed one** — the
  opposite direction from most findings in this file, but just as damaging
  to the feature's purpose: `verify_log_integrity` (called from
  `get_security_status`, which every `/security/*` GET route calls) fires a
  `LOG_TAMPERING` `CRITICAL` alert and logs
  `event_type="log_tampering_detected"` whenever `verified` is `False`. A
  tamper-detection system that cries wolf under ordinary concurrent use
  trains operators to distrust or dismiss its alerts — exactly the alert
  fatigue that lets a _real_ tamper event go unnoticed, and is triggerable
  by anyone who can send the app concurrent requests.

**Why this was not fixed in this pass, and why a narrow fix is unsafe:** the
obvious mechanical fix — mirror `audit_ship_service.py`'s SEC2-28-9 fix by
adding `.with_for_update()` to the "last row" read — does not transfer safely
here, for a reason that fix didn't have to contend with. `AuditShipState`'s
lock is held only across one dedicated, short function that commits and
returns; `create_log_entry`'s SAVEPOINT lives inside whatever the _caller's_
outer transaction is, and that transaction's lifetime is the caller's to
control, not this function's. A row lock taken here would be held by MySQL
until the _caller's_ transaction commits or rolls back — which, for a
request that logs an audit event early and then does more work afterward
(most of them), could be the rest of the request. Since this function is on
the hot path of a large fraction of the app's endpoints, and the "last
row" is a single shared resource with no per-tenant partitioning (the chain
is deliberately one cross-org sequence, same as SEC-7's rehash op), a naive
`.with_for_update()` here would serialize an unbounded, unrelated set of
concurrent requests app-wide behind whichever one happens to hold the audit
row lock longest — a global-availability risk this environment cannot
load-test with confidence, and exactly the kind of change CLAUDE.md's
Attack-Protection guidance warns against making unilaterally in this
feature. The **correct-shaped fix** most likely mirrors SEC2-28-9's own
watermark pattern more precisely than a direct copy: a small, dedicated
"chain head" row (id, last row's `current_hash`) updated in its **own**
short, self-contained transaction — acquire the lock, read the head,
compute the hash, insert the row, advance the head, commit, release, all
inside `create_log_entry` itself rather than depending on the caller's
transaction boundary. That is a schema change (new table + migration) and a
behavior change to a function called from nearly every endpoint in the
codebase, so it needs an owner decision and a load-tested rollout, not a
drive-by fix in a review pass. **Flagged, not fixed.** Mirrored into
`docs/KNOWN_LIMITATIONS.md`. No guard test was added — per this repo's own
convention (see SEC2-28-5/-6/-7, none of which carry one either), a guard
test is added for a fix, not for an open finding; a permanently-red test
would itself be a new CI failure this pass would be leaving behind.

### Completion gate (Pass 4)

No code changed this pass (findings-only: all prior fixes re-verified
intact, one new finding flagged). Ran the gate against the full repo per
this file's own established practice.

| Check                                                                                                                      | Result                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                              | clean                                                                                                                                                 |
| `black --check app/ tests/ alembic/`                                                                                       | clean                                                                                                                                                 |
| `isort --check-only app/ tests/ alembic/`                                                                                  | clean                                                                                                                                                 |
| `python3 scripts/validate_migrations.py --strict`                                                                          | PASSED — 444 revisions, single head (no migration of this feature's own; +1 unrelated migration picked up by the `origin/main` merge below)           |
| backend tests, scope (audit/security_monitoring/ip_security/error_log/privilege_ceiling/security_middleware/suspicious_ip) | 369 passed, 1 skipped (env-only: optional `pywebpush`)                                                                                                |
| backend tests, full suite                                                                                                  | 12,490 passed, 21 skipped (all environment-only: optional `pywebpush`, Docker registry/daemon unavailable in this sandbox, opt-in API-contract suite) |
| frontend `tsc --noEmit`                                                                                                    | 0 errors (no frontend file touched this pass; run anyway per convention)                                                                              |
| frontend `eslint --max-warnings 10`                                                                                        | 0 errors / 0 warnings                                                                                                                                 |

**Note on how SEC2-28-10 was verified:** the reproduction used two real,
independently-committing sessions against this sandbox's live MySQL instance
(the same technique `test_audit_shipping.py`'s `TestConcurrentShipRuns`
already uses) rather than a script against a mocked session, run outside the
`pytest`/`db_session` fixture and cleaned up (`DELETE FROM audit_logs` /
verified `audit_ship_state` untouched) before the completion-gate runs above
— confirmed by re-running the scoped suite clean afterward. No test was
added to the suite for this finding (see SEC2-28-10's own writeup for why).

**Post-merge re-run:** `origin/main` moved (a scheduling fix and an
onboarding-singleton migration/fix, neither touching this feature's files)
between branching and pushing; merged in with no conflicts in this file or
`KNOWN_LIMITATIONS.md`, applied the new migration
(`6ab7d903fae5_enforce_onboarding_status_singleton`) to this sandbox's test
database, and re-ran the full gate above against the merged tree — all
green, counts updated to reflect it (444 revisions, 12,490 full-suite
passes, up from the pre-merge 443/12,450).

---

## Pass 4 addendum (2026-09-13) — second, independently-branched review (PR #2515)

A second pass-4 review of this feature branched from `origin/main` before
the pass 4 above (PR #2513) had merged — branch
`claude/security-review-security-audit-ip`, PR #2515 — and, working
independently, reached the same conclusion: every prior finding
re-verified intact, no new exploitable bug. Its own re-verification
narrative duplicated the above and is not repeated here. It did surface one
item this review missed:

### SEC2-28-11 — LOW — stale "dead code removed" claim in the module-audit doc — ✅ FIXED (documentation only)

**What:** `docs/module-audit/security-audit-ip.md`'s SEC-9 section claimed
"the unused org-scoped `get_all_active_allowed_ips` service method was
deleted (only the pre-auth `_global` variant is called)." Re-checked against
the current `ip_security_service.py`: the org-scoped method is present
(`ip_security_service.py:477-500`), correctly scoped
(`organization_id`/`valid_from`/`valid_until` all filtered), and has its own
passing unit tests (`test_ip_security_service.py::TestGetAllActiveAllowedIps`
— confirmed by name/behavior, not just presence) — but grepping all of
`backend/app` finds **zero production callers**, and there is no `_global`
variant anywhere in the current codebase. The doc's claim was stale, not a
new defect: it most likely described an intermediate state before PR #1544
(SEC2-28-5) removed the middleware's allowlist union entirely rather than
routing it through a safe per-tenant lookup.

**Where:** `docs/module-audit/security-audit-ip.md` (doc only; no
application code defect — the method is unreachable, not unsafe).

**Impact:** none functionally (dead code opens nothing); a reviewer trusting
the stale claim could wrongly assume this method no longer exists, which
matters if/when SEC2-28-5's proposed fix (a) — a per-IP-only allowlist
lookup — is ever built, since this method is exactly the building block
that fix would adapt.

**Fix:** corrected the module-audit doc in place to describe the current,
re-verified state and cross-reference SEC2-28-5 and this entry, rather than
silently leaving a wrong "resolved" claim standing next to accurate
neighboring bullets. Not mirrored into `KNOWN_LIMITATIONS.md` — it is a
documentation correction about an existing, already-tracked finding
(SEC2-28-5, and the same "written but not wired" shape as the pass-3
dead-detector note), not a new open item.

**Renumbering note:** PR #2515 itself labeled this finding SEC2-28-10,
which collides with the unrelated audit-hash-chain-race finding recorded
under that same ID in the Pass 4 section above (from PR #2513, which
merged first). Renumbered SEC2-28-11 here to keep this file's ID space
collision-free; PR #2515's own commit history and PR description still
read "SEC2-28-10" and are left as-is as the historical record of that
branch.

No code fix, no guard test — documentation only, nothing to pin. PR #2515's
own completion gate (`flake8`/`black --check`/`isort --check-only` clean;
`validate_migrations.py --strict` passed, 444 revisions single head; scoped
backend tests 165/165 passed; full suite 12,490 passed, 1 skipped
(env-only); frontend `tsc --noEmit` 0 errors, `eslint --max-warnings 10` 0
errors/warnings) verified the same tree state this file's Pass 4 gate above
already covers, and is not duplicated here.
