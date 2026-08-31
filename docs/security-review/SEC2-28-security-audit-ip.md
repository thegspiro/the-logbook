# Security Review — Security, Audit & IP

**Prefix:** `SEC2` · **Iteration:** 28 · **Reviewed:** 2026-08-27 (pass 1, PR
#1911), 2026-08-31 (pass 2) · **PR:** #1911 (pass 1)

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
the schema; existing rows are unaffected and verify unchanged); pass 2 made no
code change at all.

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

**Corrected after Codex review** (five findings across this section were
wrong or overstated in the original writeup — severity, visibility, and the
underlying wiring status — all now verified directly against the code
rather than assumed):

**What actually fires, and at what severity** (`app/services/
security_monitoring.py`): `detect_brute_force` (called from `endpoints/
auth.py`, twice, on every login attempt) creates a `ThreatLevel.HIGH` alert
once the per-IP/per-user hourly failed-attempt threshold is crossed — never
CRITICAL. `detect_data_exfiltration` (called from
`core/security_middleware.py`'s `SecurityMonitoringMiddleware`, post-response,
on export endpoints) creates a `HIGH` alert for a single large transfer, and
only escalates to `CRITICAL` if the destination is external
(`AlertType.EXTERNAL_DATA_TRANSFER`) or the user's rolling 24h total exceeds
5× the single-transfer threshold. `detect_session_hijack` and
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
the backend; `resolve` and the destructive `/audit-log/rehash`/`checkpoint`
ops already require `audit.export` server-side); a platform-level alert
ownership/viewing design for `organization_id=NULL` rows that does not
weaken existing tenant isolation; and a `Content-Length` fix across however
many of the fifteen `EXPORT_ENDPOINTS` routes turn out to use
`StreamingResponse` without one. All three flagged; mirrored into
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
`communications`/`scheduling` routes elsewhere in the codebase).
`npx eslint`, `tsc --noEmit`, and `vitest run src/modules/ip-security
src/routeIntegrity.test.ts` (39/39) all pass.

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

None new. The one code change this pass (the `IPSecurityAdminPage` route
permission fix) is covered by existing tests —
`src/routeIntegrity.test.ts` and `vitest run src/modules/ip-security`
(39/39, both re-run after the fix) — rather than a dedicated new test, since
no other route file in the codebase carries a per-route permission-gate
regression test either; SEC2-28-7's three corrected/expanded findings
(brute-force platform-alert visibility, the exfiltration `Content-Length`
gap, and the missing alert UI) are all flagged, not fixed, so none has a
reproducible code path to pin.

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
| `vitest run src/modules/ip-security src/routeIntegrity.test.ts`                                                     | 39/39 passed               |
