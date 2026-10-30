# Security Review 00 — Cross-Cutting Baseline

**Prefix:** `SEC` · **Iteration:** 00 · **Reviewed:** 2026-08-25 (pass 1), 2026-08-27 (pass 2), 2026-09-01 (pass 3), 2026-09-07 (out-of-band, ahead of pass 4), 2026-09-08 (pass 4), 2026-09-14 (pass 5), 2026-09-15 (pass 6), 2026-10-04 (pass 7), 2026-10-12 (pass 8, watchdog pickup), 2026-10-14 (pass 9, opens rotation lap "pass 8"), 2026-10-18 (pass 10, watchdog pickup, opens rotation lap "pass 9"), 2026-10-22 (pass 11, watchdog pickup, opens rotation lap "pass 10"), 2026-10-25 (pass 12, opens rotation lap "pass 11"), 2026-10-28 (pass 13, watchdog pickup, opens rotation lap "pass 12"), 2026-10-30 (pass 14, watchdog pickup, opens rotation lap "pass 13") · **PR:** [#1799](https://github.com/thegspiro/the-logbook/pull/1799) (pass 1), [#2128](https://github.com/thegspiro/the-logbook/pull/2128) (pass 3, rounds 1–2, merged), [#2132](https://github.com/thegspiro/the-logbook/pull/2132) (pass 3, round 3 — separate PR per Pitfall #24, #2128 having already merged), [#2381](https://github.com/thegspiro/the-logbook/pull/2381) (out-of-band data-leakage sweep, prior art for pass 4), #2387 (pass 4), [#2534](https://github.com/thegspiro/the-logbook/pull/2534) (pass 5), [#2592](https://github.com/thegspiro/the-logbook/pull/2592) (pass 6), pass 7 PR recorded in `PROGRESS.md`, pass 8 PR recorded in `PROGRESS.md`, pass 9 PR recorded in `PROGRESS.md`, pass 10 PR recorded in `PROGRESS.md`, pass 11 PR recorded in `PROGRESS.md`, pass 12 PR recorded in `PROGRESS.md`, pass 13 PR recorded in `PROGRESS.md`, [#3869](https://github.com/thegspiro/the-logbook/pull/3869) (pass 14)

Passes are recorded in this one file rather than a new `SEC<n>-00-*.md` per
lap — the sweeps are cumulative and a reader needs the earlier method beside
the later result to tell a re-verification from a first run. Newest pass first.

---

## Pass 14 (2026-10-30, watchdog pickup) — delta re-sweep of all 13 established sweep classes against 259 commits (169 non-merge), 1 new finding (SEC14-1, LOW, fixed, pre-existing — a re-sweep catch, not introduced by this delta), 0 tooling findings

Watchdog pickup — the dedicated `/loop 30m /security-review` session
(`session_011T1ZyyLrD5HagusgK9uDw2`) remains unreachable (confirmed via
`ListAgents` by the orchestrating session immediately before this iteration:
no reachable agents at all). Step 0 (re-verified fresh in this iteration via
`search_pull_requests` for `head:claude/security-review-` `is:open`) found 0
open security-review PRs: PR #3868 (Feature 34, Frontend shared, pass 13) had
already merged (`baf80bf7`), and that was the last `⬜` row — every row of
the rotation table was at `✅` for the sixth time since pass 7 opened. Per
`PROGRESS.md`'s Step 1, the table is reset to `⬜` for this new lap ("pass 13"
of the rotation) and the rotation wraps to Feature 00, continuing in the same
iteration per the "rides along in the first feature PR of the next pass,
together with the reset" rule.

**Note on the pass number:** the task briefing that started this iteration
asserted Feature 00's last recorded pass was "Pass 5," making this "Pass 6."
That was wrong — re-reading this file directly (rather than trusting the
briefing) found Pass 13 already on record (2026-10-28, the watchdog pickup
immediately before this one), so this is **Pass 14**. Recorded here per this
file's own "re-verify rather than re-derive" rule in `PROGRESS.md`'s Step 2,
and because a wrong pass number would make a future reader's "re-verify prior
findings" step look for Pass 6's open items instead of Pass 13's.

**Baseline:** `579501ee` (pass 13's own head, PR #3791's merge — pass 13
itself reviewed the window ending there). **Head:** `baf80bf7` (PR #3868's
merge). Repository was shallow (`git rev-parse --is-shallow-repository` →
`true`) and was unshallowed (`git fetch --unshallow`) before trusting any
commit count, per the standing Pitfall #24 risk note. 259 commits between
baseline and head, 169 non-merge, 76 backend `.py` files touched (546 files
total) — this window is a full rotation lap (30 security-review PRs,
Features 00 and 01–34, `#3800`–`#3868`), reflecting every feature's own
pass plus a new NWS Weather Alerts polling integration, Generic Webhooks
gaining the same event feed as chat integrations, a check-then-write race fix
on IP-exception approve/reject/revoke, and routine dependency work. Routes
checked against `APPLICATION_PAGES.md`: **280** (up from 279, 17 redirects
skipped), 0 errors, 0 warnings. Alembic revisions: **678** (up from 666),
single head `f90b1124e6f4`, confirmed via `validate_migrations.py --strict`.

### Re-verified standing sweeps (all 13 classes from passes 1–13)

| #   | Class swept                                           | Result                                                                                                                                                                                                                                               |
| --- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Formula injection in exports (Pitfall #15)            | **clean** — `grep -E "csv\.(writer\|DictWriter)\("` over `app/` and `scripts/` outside `csv_export.py`: 0 hits; `tests/test_csv_writer_sweep.py` passes                                                                                              |
| 2   | `SET NULL` on `NOT NULL` columns (Pitfall #2)         | **clean** — `test_database_schema.py::TestForeignKeyIntegrity::test_set_null_fks_are_nullable` passes                                                                                                                                                |
| 3   | Proxy-IP attribution                                  | **clean** — same 3 `request.client.host` hits as every prior pass, same shape (`audit.py:1394`, `security_middleware.py:955` — both documenting comments — and the deliberate direct-IP fallback at `security_middleware.py:1273`)                   |
| 4   | Alembic chain integrity                               | **clean** — `validate_migrations.py --strict`: 678 revisions, single head `f90b1124e6f4`                                                                                                                                                             |
| 5   | LIKE-wildcard handling (Pitfall #25)                  | **clean** — `tests/test_like_escaping.py` passes                                                                                                                                                                                                     |
| 6   | `BaseHTTPMiddleware` usage (Pitfall #4)               | **clean** — 0 imports, 0 subclasses; every `grep` hit in `security_middleware.py` / `app/mcp/transport.py` is a documenting comment                                                                                                                  |
| 7   | Unbounded in-memory trackers (Pitfall #9)             | **clean, 0 new unbounded trackers** — see below (an AST pass over all 76 changed backend files found one new candidate, a static validation set, not a tracker)                                                                                      |
| 8   | `window.confirm`/`alert`/`prompt` (Pitfall #16)       | **clean** — `grep -rn "window\.\(confirm\|alert\|prompt\)("` over `frontend/src/`: 0 hits                                                                                                                                                            |
| 9   | JSON shallow-copy-then-nested-mutate (Pitfall #12)    | **clean** — `tests/test_json_column_ast_sweep.py` passes                                                                                                                                                                                             |
| 10  | Org-scoping / IDOR ratchet (Pitfall #14)              | **clean** — `tests/test_org_scoping_ratchet.py` passes                                                                                                                                                                                               |
| 11  | Capacity-check locking (Pitfall #27)                  | **clean** — `tests/test_capacity_locking.py` passes; a genuinely new check-then-write lock was added this delta (`ip_security_service.py`'s exception approve/reject/revoke, now `.with_for_update()`), reviewed below, not this class's own finding |
| 12  | Route auth coverage                                   | **clean** — `check_route_permissions.py --strict`: 280 routes, 0 errors, 0 warnings; `tests/test_endpoint_auth_coverage.py` passes                                                                                                                   |
| 13  | Raw exception text reaching the client (checklist §5) | **1 new finding** — see SEC14-1 below. Fresh AST walk of every bound broad `except` handler (`Exception`/`BaseException`/bare, bound to a name): 768 handlers (up from 758). All but SEC14-1 compose their own message or are already safe.          |

Also re-ran: `tests/test_api_cache_pii_exclusions.py` and
`tests/test_baseline_member_grants.py` (both pass), and the frontend
structural guards (`dialogScrollIntegrity`, `dialogDismissIntegrity`,
`testingRegistry`, `primaryFillContrast`, `touchTargetIntegrity`,
`hoverRevealIntegrity`) — **32/32** across 6 files (up from 30, new tests from
other features' passes), unchanged disposition from pass 13.

Outbound-transport checks: raw SQL by string interpolation is still the same
2 sites (`scheduling_service.py`, `enum_normalization.py`), same disposition
as every prior pass. Direct `httpx.AsyncClient(`/`Client(` construction is
unchanged at the same 7 files as pass 13 (`breached_password.py`,
`captcha.py`, `email_service.py`, `external_training_service.py`,
`integration_services/base.py`, `oauth_service.py`, `gmail_api_sender.py`).
`SSRFSafeAsyncTransport(` direct construction is unchanged (2 files).
`assert_outbound_url_safe(` call sites are unchanged at **7** files
(`documenso_service.py`, `teams_service.py`, `webhook_service.py`,
`slack_service.py`, `discord_service.py`, `calcom_service.py`,
`s3_storage.py`) — none of the lines flagged by a bare `grep` in `base.py` /
`ssrf_transport.py` are call sites; they are comments and docstrings
referencing the function by name, confirmed by reading each.

### New outbound-capable surfaces this delta: both reviewed, both clean

- **`app/services/integration_services/weather_service.py`** (new) —
  `fetch_active_alerts(zone_id)` for the new NWS Weather Alerts integration.
  Its destination is a hardcoded constant
  (`NWS_API_BASE = "https://api.weather.gov"`), never admin-configurable;
  the admin-chosen `zone_id` reaches the request only as an `httpx` `params=` value (safely
  encoded, never concatenated into the URL), and the call goes through the
  existing hardened `create_integration_client()`. No SSRF surface — matches
  pass 12's disposition for `google_drive_storage.py`'s equally-hardcoded
  endpoint.
- **`app/services/integration_services/notification_dispatch.py`**'s new
  `dispatch_generic_webhooks()` — extends the existing per-entity
  chat-notification fan-out (`notify_entity_created`) to also deliver to the
  department's Generic Webhook integration, with the same payload chat
  integrations already receive. It calls the existing, already-SSRF-safe
  `send_webhook()` (`webhook_service.py`'s `assert_outbound_url_safe()` +
  `create_integration_client()` pair, re-validated at send time per
  checklist §4) rather than constructing its own transport — no new
  DNS-rebinding surface, and no new data-exposure surface beyond what the
  chat-notification path already sends to the same destinations' class of
  recipient (an admin-configured endpoint).

### Class 7 (unbounded in-memory trackers): delta check against the changed files

76 backend `.py` files changed in this delta. An AST pass (module-level
assignments and `self.x` assignments inside `__init__`, restricted to
dict/set/list literals and bare `dict()`/`list()`/`set()`/`OrderedDict()`/
`defaultdict()` calls — the shape a tracker starts from) found no new
unbounded, attacker-reachable cache. The handful of non-empty module-level
dict/set/list assignments in the changed files (`DEFAULT_POSITIONS`,
`ALL_PERMISSIONS`, `WEBHOOK_EVENT_TYPES`, `ONBOARDING_CORE_MODULES`, and
similar) are fixed configuration/enumeration constants, not caches that grow
over the process's life, and were excluded by requiring an **empty** or
bare-constructor initializer. The two matches that did start empty:

- `app/schemas/forms.py:38` — `_APPLICANT_FIELDS = set(APPLICANT_FIELDS)`.
  Seeded once, at import time, from a fixed list imported from
  `app.models.forms`; used only as a Pydantic field-validator's allow-list
  (the same pattern as the four `_FORM_CATEGORIES`/`_FORM_STATUSES`/
  `_FIELD_TYPES`/`_INTEGRATION_TARGETS`/`_INTEGRATION_TYPES` sets immediately
  above it in the same file). Never written to again. Not a tracker.
- `app/services/equipment_check_service.py:122`
  (`self._counted_inventory_ids: Set[str] = set()`) and
  `app/services/scheduling_service.py:443-445`
  (`self.last_assignment_warnings`/`last_generation_warnings`/
  `last_generation_seat_warnings`) — both re-flagged by this delta's diff
  only because other parts of the same files changed; both pre-date baseline
  `579501ee` unchanged at the flagged lines (confirmed with
  `git show 579501ee:<file> | sed -n '<line>p'`) and were already reviewed
  clean under pass 12's equivalent check (per-instance, request-scoped
  services, not module-level).

No genuinely new outbound-HTTP-capable or tracker-shaped surface beyond the
items above.

### Also reviewed: a new check-then-write lock on the IP-exception approve/reject/revoke path

`app/services/ip_security_service.py`'s `approve_exception` /
`reject_exception` / `revoke_exception` (lines ~210–400) each gained a
`.with_for_update()` on the exception row's fetch, with a comment explaining
why: two administrators acting on the same exception at once could otherwise
both pass the status check and leave the row approved with a rejection's
audit trail attached, or vice versa. This is the same class of fix Pitfall
#27 and `tests/test_capacity_locking.py` exist for, applied correctly here to
a check-then-write rather than a capacity count; `tests/test_capacity_locking.py`
itself doesn't cover this file (it is a different endpoint's own fix, not a
cross-cutting-class regression), so it is noted here as reviewed-and-correct
rather than claimed under that guard test's coverage.

## Findings

### SEC14-1 — LOW — a third write site for the same `import_error` leak class SEC13-1 fixed, in the service layer's own matched-member repair pass — FIXED

**File:** `backend/app/services/external_training_service.py:2246` (inside
`import_pending_for_matched_members`, now at line 2246 after this fix's
import addition — originally reported at the pre-fix line 2245).

**Scenario:** SEC13-1 (pass 13) fixed two call sites in
`app/api/v1/endpoints/external_training.py` where a failed import stored
`str(e)` — raw exception text — directly into `ExternalTrainingImport
.import_error`, a column `ExternalTrainingImportResponse` serializes back to
the client on every later GET of `/providers/{id}/imports` or
`/imports/{id}`. This pass's fresh AST walk of all 768 broad-except handlers
found a **third** writer of the same column with the same bug, in the
service layer rather than the endpoint layer:
`import_pending_for_matched_members` (the "repair" pass that credits a
member's already-staged completions once they are mapped — called both from
the user-mapping endpoint, `external_training.py:1377`, and from its own
"Import matched" button endpoint, `external_training.py:1609`) catches its
own call to `self.import_single_record(...)` and ran
`import_record.import_error = str(exc)`. A duplicate-key `IntegrityError`, a
transient driver error, or any other exception from that call persisted its
full driver/SQL text (table/index names, the `INSERT` statement, a file
path) onto the row, exactly `safe_error_detail()` exists to prevent and
exactly the pattern SEC13-1 already fixed two call-sites away.

**Why this wasn't caught by SEC13-1 (pass 13):** this line pre-dates pass
13's own baseline (`git log -S` traces it to `cf07b12bf`, 2026-10-21, four
days before pass 13's `e007f1f5` baseline on 2026-10-25, and a week before
pass 13's own 2026-10-28 review) — pass 13's "fresh AST walk ... all but
SEC13-1 compose their own message or are already safe" claim was a miss, not
a regression introduced by this delta. Recorded here as a re-sweep catch
rather than attributed to any commit in this pass's own review window.

**Fix:** imported `safe_error_detail` from `app.core.utils` (already used
for exactly this column two call-sites away, in the endpoint file) and
changed the one site to `import_record.import_error = safe_error_detail(exc)`.
Same semantics as SEC13-1's fix: `ValueError`/`PermissionError` messages pass
through unless they match an unsafe pattern, everything else gets a generic
fallback, and the real exception is still logged server-side at ERROR level
via the existing `logger.exception(...)` call immediately above.

**Guard test:**
`tests/test_external_training_course_mapping.py::TestImportButtonsShareTheImport::test_matched_member_import_failure_does_not_persist_the_raw_exception_text`
patches `ExternalTrainingSyncService.import_single_record` to raise a
`RuntimeError` carrying SQL/path text, stages an import already assigned to
a member (the precondition `import_pending_for_matched_members` selects on),
drives the repair pass, and asserts the persisted `import_error` contains
neither the driver text, the `INSERT` statement, nor a path. Seen to fail
first against the unfixed code (`AssertionError` on
`"sqlalchemy" not in failed.import_error.lower()`, with the raw driver text
asserted against — confirmed by reverting the one-line fix, running the new
test, observing the red failure, then reapplying the fix), per Pitfall #37,
then re-run green after the fix (`75 passed` across this file plus its two
sibling external-training test files).

**Severity:** LOW — identical reasoning to SEC13-1: an internal-schema
information disclosure (index/table names, not PII/PHI or credentials) to an
already-authenticated, already-permitted (`training.manage`) user, not a
tenant-isolation or auth-bypass issue.

**Disposition:** FIXED.

**0 other application-security findings this pass.** All 13 classes
re-verified clean against head and diffed against the pass-13 baseline tree.

### Re-verified open items from prior passes

- **SEC12-1 (LOW/MED, S3/MinIO DNS-rebinding TOCTOU) — still OPEN/FLAGGED,
  unchanged.** `backend/app/services/s3_storage.py` did not change in this
  delta (confirmed: `git diff 579501ee..baf80bf7 -- backend/app/services/s3_storage.py`
  is empty), so the gap described in pass 12 — `boto3`'s own HTTP stack
  resolves the endpoint independently on every call, outside
  `SSRFSafeAsyncTransport`'s pinning — is unchanged. No new information to
  add; `docs/KNOWN_LIMITATIONS.md`'s corrected entry from pass 12 still
  describes it accurately.
- **The standing egress-proxy TOCTOU item** (`docs/KNOWN_LIMITATIONS.md`,
  "Outbound Integration Requests") — remains open, unchanged. Not
  re-investigated this pass: `create_integration_client()` and
  `SSRFSafeAsyncTransport` (`app/services/integration_services/base.py`,
  `app/utils/ssrf_transport.py`) did not change in this delta.
- **The MFA-recovery-codes and `REGISTRATION_REQUIRES_APPROVAL` stale
  carry-forwards** that pass 12 already corrected (removed from this file's
  active tracking) — nothing in this delta reopens either; not re-litigated.

**0 security-tooling findings this pass.**

## Guard tests added

`test_matched_member_import_failure_does_not_persist_the_raw_exception_text`
(above).

## Completion gate

| Check                                                                                                                                                                 | Result                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `flake8 app/ tests/ alembic/` (7.4.1, CI's pin)                                                                                                                       | ✅ 0 violations                     |
| `black --check app/ tests/ alembic/` (26.10.1, CI's pin)                                                                                                              | ✅ clean, 2744 files unchanged      |
| `isort --check-only app/ tests/ alembic/` (9.0.2, CI's pin)                                                                                                           | ✅ clean                            |
| `validate_migrations.py --strict`                                                                                                                                     | ✅ 678 revisions, single head       |
| `check_route_permissions.py --strict`                                                                                                                                 | ✅ 280 routes, 0 errors, 0 warnings |
| Cross-cutting guard suite (10 files: json/like/org-scoping/capacity/auth-coverage/csv/schema/api-cache/baseline-grants/create-all)                                    | ✅ 215 passed                       |
| `pytest tests/test_external_training_course_mapping.py tests/test_external_training_credit_hours.py tests/test_external_training_report_upload.py`                    | ✅ 75 passed                        |
| `cd frontend && npm run typecheck`                                                                                                                                    | ✅ 0 errors                         |
| `cd frontend && npm run lint`                                                                                                                                         | ✅ 0 errors (`--max-warnings 10`)   |
| Frontend structural guards (6 files: dialogScrollIntegrity, dialogDismissIntegrity, testingRegistry, primaryFillContrast, touchTargetIntegrity, hoverRevealIntegrity) | ✅ 32 passed                        |

---

## Pass 13 (2026-10-28, watchdog pickup) — delta re-sweep of all 13 established sweep classes against 330 commits (210 non-merge), 1 new finding (SEC13-1, LOW, fixed), 0 tooling findings

Watchdog pickup — the dedicated `/loop 30m /security-review` session
(`session_011T1ZyyLrD5HagusgK9uDw2`) remains unreachable (confirmed via
`ListAgents`: no reachable agents at all). Step 0 found exactly one open
security-review PR (**#3791**, Feature 34 Frontend shared pass 12): CI green
on its head SHA (`CI`/`Supply Chain`/`Secret Scan` all `success`),
`mergeable_state: clean`, no unresolved review threads (the
`chatgpt-codex-connector[bot]` review attempt had failed with "usage
limits" — not a finding, nothing to tend), so it was merged (squash,
`579501ee`). That merge was the last `⬜` row — every row of the rotation
table was at `✅` for the fifth time since pass 7 opened. Per
`PROGRESS.md`'s Step 1, the table is reset to `⬜` for this new lap ("pass
12" of the rotation) and the rotation wraps to Feature 00, continuing in
the same iteration per the "rides along in the first feature PR of the
next pass, together with the reset" rule.

**Baseline:** `e007f1f5` (pass 12's own head, PR #3682's merge — pass 12
itself reviewed the window ending there). **Head:** `579501ee` (PR #3791's
merge). Repository was shallow (`git rev-parse --is-shallow-repository` →
`true`) and was unshallowed (`git fetch --unshallow`) before trusting any
commit count, per the standing Pitfall #24 risk note. 330 commits between
baseline and head, 210 non-merge, 126 backend `.py` files touched (658
files total) — reflecting the Security/audit/IP, Reports/analytics,
Onboarding, Scheduled tasks, Locations/kiosk, Core infrastructure and
Frontend shared passes (Features 28–34 of this lap) plus a Gmail
domain-wide-delegation sending method, a new remote-storage migration path,
and routine dependency work. Routes checked against `APPLICATION_PAGES.md`:
**279** (up from 276, 17 redirects skipped), 0 errors, 0 warnings. Alembic
revisions: **666** (up from 651), single head `0d9897752425`, confirmed via
`validate_migrations.py --strict`.

### Re-verified standing sweeps (all 13 classes from passes 1–12)

| #   | Class swept                                           | Result                                                                                                                                                                                                                                      |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Formula injection in exports (Pitfall #15)            | **clean** — `grep -E "csv\.(writer\|DictWriter)\("` over `app/` and `scripts/` outside `csv_export.py`: 0 hits; `tests/test_csv_writer_sweep.py` passes                                                                                     |
| 2   | `SET NULL` on `NOT NULL` columns (Pitfall #2)         | **clean** — `test_database_schema.py::TestForeignKeyIntegrity::test_set_null_fks_are_nullable` passes                                                                                                                                       |
| 3   | Proxy-IP attribution                                  | **clean** — same 3 `request.client.host` hits as every prior pass, same shape (`audit.py:1394`, `security_middleware.py:955` — both documenting comments — and the deliberate direct-IP fallback at `security_middleware.py:1273`)          |
| 4   | Alembic chain integrity                               | **clean** — `validate_migrations.py --strict`: 666 revisions, single head `0d9897752425`                                                                                                                                                    |
| 5   | LIKE-wildcard handling (Pitfall #25)                  | **clean** — `tests/test_like_escaping.py` passes                                                                                                                                                                                            |
| 6   | `BaseHTTPMiddleware` usage (Pitfall #4)               | **clean** — 0 imports, 0 subclasses; every `grep` hit in `security_middleware.py` / `app/mcp/transport.py` is a documenting comment                                                                                                         |
| 7   | Unbounded in-memory trackers (Pitfall #9)             | **clean, 0 new unbounded trackers** — see below (two new bounded, non-attacker-controlled candidates reviewed)                                                                                                                              |
| 8   | `window.confirm`/`alert`/`prompt` (Pitfall #16)       | **clean** — `grep -rn "window\.\(confirm\|alert\|prompt\)("` over `frontend/src/`: 0 hits                                                                                                                                                   |
| 9   | JSON shallow-copy-then-nested-mutate (Pitfall #12)    | **clean** — `tests/test_json_column_ast_sweep.py` passes                                                                                                                                                                                    |
| 10  | Org-scoping / IDOR ratchet (Pitfall #14)              | **clean** — `tests/test_org_scoping_ratchet.py` passes                                                                                                                                                                                      |
| 11  | Capacity-check locking (Pitfall #27)                  | **clean** — `tests/test_capacity_locking.py` passes                                                                                                                                                                                         |
| 12  | Route auth coverage                                   | **clean** — `check_route_permissions.py --strict`: 279 routes, 0 errors, 0 warnings; `tests/test_endpoint_auth_coverage.py` passes                                                                                                          |
| 13  | Raw exception text reaching the client (checklist §5) | **1 new finding** — see SEC13-1 below. Fresh AST walk of every bound broad `except` handler (`Exception`/`BaseException`/bare, bound to a name): 758 handlers (up from 751). All but SEC13-1 compose their own message or are already safe. |

Also re-ran: `tests/test_api_cache_pii_exclusions.py` and
`tests/test_baseline_member_grants.py` (both pass). The full standing
cross-cutting guard suite (10 files covering classes 1, 2, 5, 9, 10, 11, 12,
and the baseline-grant/cache-exclusion spot checks) — **215 passed**.

Outbound-transport checks: raw SQL by string interpolation is still the
same 2 sites (`scheduling_service.py`, `enum_normalization.py`), same
disposition as every prior pass. Direct `httpx.AsyncClient(`/`Client(`
construction grew from 6 to **7 files**: the standing `breached_password.py`,
`captcha.py`, `email_service.py`, `external_training_service.py`,
`integration_services/base.py`, `oauth_service.py`, plus a new caller,
`app/services/gmail_api_sender.py` (the new Gmail domain-wide-delegation
sending method). Read in full — see "Verified good" below: both its target
URL (`GMAIL_SEND_URL`) and the OAuth token endpoint it depends on
(`google_oauth.py`'s `_GOOGLE_TOKEN_URI`) are hardcoded constants, never
admin-configurable, so there is no SSRF/DNS-rebinding surface here the way
there is for the admin-configurable S3/MinIO endpoint (SEC12-1, unchanged,
still open). `SSRFSafeAsyncTransport(` direct construction and
`assert_outbound_url_safe(` call sites are unchanged (2 files; 7 files
respectively, same set as pass 12).

### Class 7 (unbounded in-memory trackers): delta check against the two genuinely new candidates

126 backend `.py` files changed in this delta. Two genuinely new
tracker-shaped module-level variables appeared (everything else flagged by
the diff — `security_middleware.py`'s standing trackers, etc. — pre-dates
baseline `e007f1f5` unchanged at the flagged line):

- `app/core/security.py:672` — `_fingerprint_keys: dict[str, bytes] = {}`, a
  cache of HKDF-derived blind-index keys for email fingerprinting
  (`_fingerprint_key`). Keyed only on `settings.ENCRYPTION_KEY` and the
  fixed legacy-key ring (`email_fingerprints`'s `keys` list) — an
  operator-configured, small, fixed set, never user input — so this is
  bounded by construction, the same shape as the pre-existing cipher caches
  it sits beside. (This primitive itself was already reviewed under Feature
  33's own CI9/CI10/CI11 passes; re-confirmed here only because the exact
  line reporting it as newly-added in this delta's diff, from a later
  rewrite of the surrounding module section, prompted a fresh check.)
- `app/utils/google_oauth.py:70` — `_cache: OrderedDict[str, _Entry] = OrderedDict()`,
  the Gmail service-account credential cache. Explicitly bounded
  (`_MAX_CACHED_CREDENTIALS = 32`, `popitem(last=False)` eviction on
  overflow, line 170) and keyed by a SHA-256 hash of (key material, sending
  address) — never raw attacker input. **Clean.**

No genuinely new outbound-HTTP-capable service appeared beyond
`gmail_api_sender.py`, reviewed above.

## Findings

### SEC13-1 — LOW — a failed external-training import stored the raw exception text in a field served back to the client — FIXED

**File:** `backend/app/api/v1/endpoints/external_training.py:1544` (inside
`import_single_record`) and `:1733` (inside `bulk_import_records`).

**Scenario:** a training officer (`training.manage`) imports an external
training record whose underlying write fails — a duplicate
`external_record_id` racing the unique index, a transient DB error, or any
other exception from `ExternalTrainingSyncService.import_single_record`.
The `except Exception as e:` handler stored `str(e)` directly into
`ext_import.import_error`, a `Text` column serialized back to the client
on every later read via `ExternalTrainingImportResponse`
(`app/schemas/training.py:1154`, used as the `response_model` on both the
list and single-import endpoints). A real `IntegrityError`/driver error
message routinely carries the constraint or index name, the SQL verb, and
a file path/line — exactly checklist §5's "no SQL, paths, or tracebacks
reach the client", just delivered through a persisted field on the next GET
rather than through this response's own `detail`. The HTTPException raised
in the same handler was already a safe, generic message — only the stored
field leaked.

**Why this one and not the five other `str(e)`/`detail=str(e)` sites this
delta's AST sweep also flagged:** the other five (two in
`app/api/dependencies.py` and `app/api/v1/onboarding.py`, three more in
`onboarding.py`) all put `str(e)` only in a server-side `logger.error(...)`
call, with the `HTTPException(detail=...)` in the same block carrying a
hardcoded, generic string — not a leak. This pair is different: `str(e)`
goes into a column, and that column is what a `response_model` serializes.
The same file already has the established, correct pattern one `except`
block away — `provider.connection_error = safe_error_detail(e)`
(`external_training.py:506`) — so these two sites are an inconsistency
with the file's own convention, not a judgment call.

**Fix:** `ext_import.import_error = safe_error_detail(e)` at both sites.
`safe_error_detail` (already imported in this file) passes through
`ValueError`/`PermissionError` messages unless they match an unsafe
pattern (SQL, tracebacks, file paths), and replaces anything else —
exactly `IntegrityError`'s shape — with a generic fallback, logging the
real error server-side at ERROR level either way.

**Guard test:** `tests/test_external_training_course_mapping.py::TestImportButtonsShareTheImport::test_import_failure_does_not_persist_the_raw_exception_text`
mocks the service call to raise an exception carrying SQL/path text, drives
`import_single_record` to its failure branch, and asserts the persisted
`import_error` contains neither. Seen to fail against the unfixed code
first (`AssertionError` on `"sqlalchemy" not in failed.import_error.lower()`,
with the raw driver text asserted against), per Pitfall #37, then re-run
green after the fix.

**Severity:** LOW — an internal-schema information disclosure (index/table
names, not PII/PHI or credentials) to an already-authenticated,
already-permitted (`training.manage`) user, not a tenant-isolation or
auth-bypass issue.

**Disposition:** FIXED.

## Guard tests added

`test_import_failure_does_not_persist_the_raw_exception_text` (above).

## Completion gate

| Check                                                                                                                                              | Result                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `flake8 app/ tests/ alembic/` (7.4.1, CI's pin)                                                                                                    | ✅ 0 violations                     |
| `black --check app/ tests/ alembic/` (26.10.1, CI's pin)                                                                                           | ✅ clean, 2706 files unchanged      |
| `isort --check-only app/ tests/ alembic/` (9.0.2, CI's pin)                                                                                        | ✅ clean                            |
| `validate_migrations.py --strict`                                                                                                                  | ✅ 666 revisions, single head       |
| `check_route_permissions.py --strict`                                                                                                              | ✅ 279 routes, 0 errors, 0 warnings |
| Cross-cutting guard suite (10 files: json/like/org-scoping/capacity/auth-coverage/csv/schema/api-cache/baseline-grants/create-all)                 | ✅ 215 passed                       |
| `pytest tests/test_external_training_course_mapping.py tests/test_external_training_credit_hours.py tests/test_external_training_report_upload.py` | ✅ 74 passed                        |
| `cd frontend && npm run typecheck`                                                                                                                 | ✅ 0 errors                         |
| `cd frontend && npm run lint`                                                                                                                      | ✅ 0 errors (`--max-warnings 10`)   |

---

## Pass 12 (2026-10-25) — delta re-sweep of all 13 established sweep classes against 386 commits (229 non-merge), 1 new finding (SEC12-1, LOW/MED, flagged), 0 tooling findings

This iteration picked up the rotation at its normal Feature-00 slot (Step 0:
`search_pull_requests` for `head:claude/security-review-` `is:open` returned 0
results, after PR #3682, Feature 34 Frontend shared pass 11, merged). Every
row of the rotation table was at ✅ for the fourth time since pass 7 opened.
Per `PROGRESS.md`'s Step 1, the table is reset to ⬜ for this new lap ("pass
11" of the rotation) and the rotation wraps to Feature 00, continuing in the
same iteration per the "rides along in the first feature PR of the next pass,
together with the reset" rule.

**Baseline:** `7485cfa7` (pass 11's own head, PR #3552's merge). **Head:**
`e007f1f5` (PR #3682's merge). Repository was shallow
(`git rev-parse --is-shallow-repository` → `true`) and was unshallowed
(`git fetch --unshallow`) before trusting any commit count, per the standing
Pitfall #24 risk note. 386 commits between baseline and head, 229 non-merge —
reflecting the Core infrastructure and Frontend shared passes (Features
33–34) plus a new remote-storage (S3/MinIO, Google Drive) capability, NFC
inventory tags/cards, membership-pipeline and finance-budget work, and
routine dependency bumps. Routes checked against `APPLICATION_PAGES.md`:
**276** (up from 273, 17 redirects skipped), 0 errors, 0 warnings. Alembic
revisions: **651** (up from 639), single head `3d67883cd461`, confirmed via
`validate_migrations.py --strict` (filenames' embedded timestamps are not the
revision graph's order — `a0195b397bf3` names an earlier timestamp than its
own parent `7dba2d6d2dbb` merge revision; the tool validates the graph, not
filenames, and it is single-headed).

### Re-verified standing sweeps (all 13 classes from passes 1–11)

| #   | Class swept                                           | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Formula injection in exports (Pitfall #15)            | **clean** — `grep -E "csv\.(writer\|DictWriter)\("` over `app/` and `scripts/` outside `csv_export.py`: 0 hits; `tests/test_csv_writer_sweep.py` passes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2   | `SET NULL` on `NOT NULL` columns (Pitfall #2)         | **clean** — `test_database_schema.py::TestForeignKeyIntegrity::test_set_null_fks_are_nullable` passes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 3   | Proxy-IP attribution                                  | **clean** — same 3 `request.client.host` hits as every prior pass, same shape (`audit.py:1394`, `security_middleware.py:955` — both documenting comments — and the deliberate direct-IP fallback at `security_middleware.py:1250`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 4   | Alembic chain integrity                               | **clean** — `validate_migrations.py --strict`: 651 revisions, single head `3d67883cd461`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 5   | LIKE-wildcard handling (Pitfall #25)                  | **clean** — `tests/test_like_escaping.py` passes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 6   | `BaseHTTPMiddleware` usage (Pitfall #4)               | **clean** — 0 imports, 0 subclasses; every `grep` hit in `security_middleware.py` / `app/mcp/transport.py` is a documenting comment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 7   | Unbounded in-memory trackers (Pitfall #9)             | **clean, 0 new unbounded trackers** — see below (one new bounded, transient candidate reviewed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 8   | `window.confirm`/`alert`/`prompt` (Pitfall #16)       | **clean** — `grep -rn "window\.\(confirm\|alert\|prompt\)("` over `frontend/src/`: 0 hits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 9   | JSON shallow-copy-then-nested-mutate (Pitfall #12)    | **clean** — `tests/test_json_column_ast_sweep.py` passes (enumeration only, no new flagged site)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 10  | Org-scoping / IDOR ratchet (Pitfall #14)              | **clean** — `tests/test_org_scoping_ratchet.py` passes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 11  | Capacity-check locking (Pitfall #27)                  | **clean** — `tests/test_capacity_locking.py` passes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 12  | Route auth coverage                                   | **clean** — `tests/test_endpoint_auth_coverage.py` passes; `check_route_permissions.py --strict`: 276 routes, 0 errors, 0 warnings                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 13  | Raw exception text reaching the client (checklist §5) | **clean** — fresh AST walk of every bound **broad** `except` handler (`Exception`/`BaseException`/bare `except`, bound to a name): 751 handlers (up from 737), 0 `HTTPException(detail=...)` sites referencing the bound name outside `safe_error_detail(...)`/`sanitize_integration_error(...)`, even nested inside an f-string. A complementary check of `detail=str(<bound>)` inside **narrow** handlers (`ValueError`, `BudgetLimitExceededError`, `InventoryNfcTagNotFound`, `ExternalApparatusInUseError`, and similar codebase-defined exceptions in the new finance-budget, membership-pipeline and inventory-NFC endpoints) found every one composing its own message, not a driver/library's — same disposition as pass 7's equivalent check |

Also re-ran as spot-checks: `tests/test_api_cache_pii_exclusions.py` and
`tests/test_baseline_member_grants.py` (both pass), and the frontend
structural guards (`dialogScrollIntegrity`, `dialogDismissIntegrity`,
`testingRegistry`, `primaryFillContrast`, `touchTargetIntegrity`,
`hoverRevealIntegrity`) — **30/30** across 6 files, unchanged from pass 11.

Outbound-transport checks: raw SQL by string interpolation is still the same
2 sites (`scheduling_service.py`, cushion cast through `int()`;
`enum_normalization.py`, table/column names from an internal enumeration,
never user input — same disposition as every prior pass). Direct
`httpx.AsyncClient(`/`Client(` construction is still the same 6 files as pass
11 (`breached_password.py`, `captcha.py`, `email_service.py`,
`external_training_service.py`, `integration_services/base.py`,
`oauth_service.py`), each a standing, previously-reviewed site.
`SSRFSafeAsyncTransport(` direct construction is unchanged at 2 files
(`external_training_service.py`, `integration_services/base.py`).

`assert_outbound_url_safe(` direct **call** sites grew from 6 to **7**:
the standing `documenso_service.py`, `teams_service.py`, `webhook_service.py`,
`slack_service.py`, `discord_service.py`, `calcom_service.py`, plus a new
caller, `app/services/s3_storage.py:205` (the new remote-storage feature's
S3/MinIO connector). Read in full — see **SEC12-1** below: it is a genuinely
new outbound-HTTP-capable surface, admin-configurable, and it reproduces the
exact pre-SCH-10 TOCTOU shape (check-then-connect, not pinned), because it is
built on `boto3`/`botocore`, not the `httpx` stack `SSRFSafeAsyncTransport`
wraps. `google_drive_storage.py`, the delta's other new remote-storage
connector, was also checked and is **not** a finding: its Drive API endpoint
(`DRIVE_API = "https://www.googleapis.com/drive/v3"`) is hardcoded, never
read from org settings, so there is no admin-configurable destination for a
rebinding attack to target.

### Class 7 (unbounded in-memory trackers): delta check against the genuinely new candidate

123 backend `.py` files changed in this delta. Narrowing to files whose diff
touches a module- or instance-level dict/set/list-shaped assignment found one
genuinely new tracker-shaped variable (the rest — `security_middleware.py`'s
`_keys`/`_saturation_reject_until`, `file_encryption.py`'s module-level
`_keks`, `directory_account_departure.py`'s `_tasks`,
`equipment_check_service.py`'s `self._counted_inventory_ids`,
`scheduling_service.py`'s `self.last_assignment_warnings` and siblings — all
pre-date baseline `7485cfa7` unchanged at the flagged line, confirmed with
`git show 7485cfa7:<file> | grep <name>`; this delta touched other parts of
those same files):

- `google_drive_storage.py:217` (`self._spare_ids: list[str] = []`, inside
  `GoogleDriveBackend.__init__`) — a small batch of Drive-reserved file ids,
  capped at `_IDS_PER_REQUEST = 20` and refilled only when exhausted
  (`_reserve_id`, line 250), consumed with `.pop()`. `GoogleDriveBackend` is
  constructed fresh on every call to `GoogleDrivePlatform.backend(config)`
  (confirmed via `grep -rn "GoogleDriveBackend("` — one construction site,
  the platform's own `backend()` method) and that method's own two callers
  (`file_storage_service.py:595,765`) hold the result in a function-local
  variable, never a module-level or app-state cache. Bounded by construction
  and transient by lifetime — not a tracker in the sense this class exists to
  catch.

No genuinely new outbound-HTTP-capable service appeared beyond the two
reviewed above (`s3_storage.py`, `google_drive_storage.py`); the other new
service files in this delta (`remote_storage.py`, `remote_migration.py`,
`upload_relocation.py`, and the inventory/NFC/finance/membership-pipeline
services) were checked for `httpx`/`requests`/`boto3`/`urlopen` construction —
0 hits outside the two already covered.

## Findings

### SEC12-1 — LOW/MED — the S3/MinIO remote-storage connector has the same DNS-rebinding TOCTOU the other six integrations had before SCH-10 — FLAGGED

**File:** `backend/app/services/s3_storage.py:188-212` (`check_endpoint`),
construction at `backend/app/services/s3_storage.py:226-241`
(`S3Backend.__init__`).

**Scenario:** an org administrator with `settings.manage` sets the
department's File Storage platform to S3/MinIO and types an endpoint URL
whose hostname currently resolves to a public address (passing
`check_endpoint`'s `assert_outbound_url_safe()` call) but is later repointed —
by the administrator's own DNS provider, or by an attacker who has
compromised it — to resolve to an internal address (`169.254.169.254`, a
container's loopback, an RFC 1918 peer). `boto3.client("s3", endpoint_url=…)`
(line 228) resolves the hostname itself, independently, on every actual
`put_object`/`get_object`/`head_object`/`delete_object` call; nothing pins the
connection to the address `check_endpoint` validated. The window is narrowed
to the 30-second `_ORG_STORAGE_TTL_SECONDS` cache
(`file_storage_service.py:513`) — on each cache miss `_org_storage_from`
re-runs `platform.check_config` before rebuilding the client — but within that
window, and on every subsequent request against the same cached backend, a
rebind reaches the internal address. This is exactly the shape SCH-10 closed
for the six `httpx`-based connectors (`teams`, `webhook`, `slack`, `discord`,
`calcom`, `documenso`) by routing them through `SSRFSafeAsyncTransport`, which
resolves once and connects to the resolved address directly. `S3Backend` uses
`boto3`/`botocore`'s own HTTP stack (`urllib3`), which `SSRFSafeAsyncTransport`
— an `httpx` transport — cannot wrap; pinning a `boto3` client's connection
needs a `botocore`-specific mechanism (a custom endpoint resolver or
connection pool), which is a different, non-trivial piece of engineering, not
a mechanical reuse of the existing fix.

**Why flagged, not fixed:** this is the same class of judgment call SEC-00
has flagged every pass since SCH-10 for the egress-proxy case (same file,
`docs/KNOWN_LIMITATIONS.md`'s "Outbound Integration Requests" entry) — closing
it requires new, `boto3`-specific transport-pinning code, which is a design
decision and a nontrivial change, not a verifiable one-line fix safe to make
inside a cross-cutting sweep. The module's own docstring (lines 20–27)
already discloses the gap honestly ("a DNS-rebinding window remains between
the check and the request") — the problem is that `KNOWN_LIMITATIONS.md`'s
entry title and body describe the DNS-rebinding class as "closed... for
direct connections" without qualification, which is no longer accurate now
that a direct, boto3-based connection exists that the fix does not cover.
**Fixed in this pass:** the `KNOWN_LIMITATIONS.md` entry (see below) now says
so explicitly, so an operator or the next reviewer reading it is not misled
into believing S3/MinIO got the same protection the other six connectors did.

**Severity reasoning:** same LOW/MED rating SCH-10 itself carried for the
identical mechanism (`docs/security-review/SCH-15-scheduling.md:1210`) — it
requires an admin-level configuration capability to set the attacked
endpoint, bounded by a short cache window, and the blast radius (SSRF against
the server's own network, cloud metadata) matches the other six connectors'
pre-fix exposure exactly.

**Disposition:** OPEN / FLAGGED. No guard test added — `test_integration_dns_pinning.py`
tests the `httpx`/`SSRFSafeAsyncTransport` path only; a test asserting
`boto3` is _not_ pinned would freeze the gap rather than catch a regression,
which is not this suite's purpose. Added instead: a corrected
`KNOWN_LIMITATIONS.md` entry (mechanical, verifiable, no behavior change).

**0 other application-security findings this pass.** All 13 classes
re-verified clean against head and diffed against the pass-11 baseline tree.
The standing egress-proxy TOCTOU item remains open, unchanged — not
re-investigated this pass since nothing in the delta touches
`create_integration_client()`/`SSRFSafeAsyncTransport`.

**0 security-tooling findings this pass.**

## Schema & migration notes

No migration in this delta tightens a column or seeds a grant without
settling existing rows — spot-checked
`20261023_1553_6dce1364ff7e_not_null_on_columns_upgraded_databases_.py`
(99 columns across 32 tables moved from nullable to `NOT NULL`): it backfills
every stored NULL to the column's frozen default before the `ALTER`, skips a
table/column `create_all` would still be building (Pitfall #26), skips a
column already `NOT NULL` (idempotent against an upgraded database), and
documents its downgrade as a deliberate no-op with the reason stated —
textbook Pitfall #35 compliance. Chain: 651 revisions, single head
`3d67883cd461`, no duplicate ids. `test_set_null_fks_are_nullable` and
`test_migration_create_all_tables` both pass.

## KNOWN_LIMITATIONS.md correction

`docs/KNOWN_LIMITATIONS.md`'s "Outbound Integration Requests" entry is
updated in this pass (mechanical, no behavior change) to add the S3/MinIO
remote-storage connector as a second case — alongside the existing
egress-proxy case — where the DNS-rebinding window is narrowed by an
up-front check but not closed by connection pinning. See SEC12-1.

## Guard tests added

None — SEC12-1 is flagged rather than fixed, and a guard test for an
unfixed, disclosed gap would freeze the gap rather than catch a regression.

## Completion gate

| Check                                                                                                                                                                                                                                                                                                                                                                     | Result                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                                                             | ✅ 0 violations                     |
| `black --check app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                                                      | ✅ clean (2637 files)               |
| `isort --check-only app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                                                 | ✅ clean                            |
| `validate_migrations.py --strict`                                                                                                                                                                                                                                                                                                                                         | ✅ 651 revisions, single head       |
| `check_route_permissions.py --strict`                                                                                                                                                                                                                                                                                                                                     | ✅ 276 routes, 0 errors, 0 warnings |
| Backend `pytest tests/test_json_column_ast_sweep.py tests/test_like_escaping.py tests/test_org_scoping_ratchet.py tests/test_capacity_locking.py tests/test_endpoint_auth_coverage.py tests/test_csv_writer_sweep.py tests/test_database_schema.py tests/test_api_cache_pii_exclusions.py tests/test_baseline_member_grants.py tests/test_migration_create_all_tables.py` | ✅ 215 passed                       |
| `npm run typecheck`                                                                                                                                                                                                                                                                                                                                                       | ✅ 0 errors                         |
| `npm run lint`                                                                                                                                                                                                                                                                                                                                                            | ✅ 0 errors (`--max-warnings 10`)   |
| Frontend structural guards (6 files)                                                                                                                                                                                                                                                                                                                                      | ✅ 30 passed                        |

---

## Pass 11 (2026-10-22) — delta re-sweep of all 13 established sweep classes against 614 commits (375 non-merge), 0 security findings, 0 tooling findings

This iteration (watchdog pickup for `/loop 30m /security-review`: `ListAgents`
showed no reachable dedicated loop session, and `search_pull_requests` found
no open `claude/security-review-*` PR after PR #3551, Feature 34 Frontend
shared pass 10, merged 2026-10-22 02:48 UTC) found every row of the rotation
table at ✅ for the third time since pass 7 opened. Per `PROGRESS.md`'s Step
1, the table is reset to ⬜ for this new lap ("pass 10" of the rotation) and
the rotation wraps to Feature 00, continuing in the same iteration per the
"rides along in the first feature PR of the next pass, together with the
reset" rule. PR #3551 touched only `PROGRESS.md` and
`FE10-34-frontend-shared.md` (0 fixes that pass), so per the skill's
"docs-only PR is not a recordable event" rule it got no `PROGRESS.md` Log
entry — only the `Open PR` row needed clearing this time.

**Baseline:** `ea6752c2` (PR #3394's merge, pass 10's own baseline head).
**Head:** `7485cfa7` (PR #3552's merge — the app-review rotation's own PR,
landed immediately after #3551; swept regardless of which rotation produced
it, consistent with every prior pass). Repository was shallow
(`git rev-parse --is-shallow-repository` → `true`) and was unshallowed
(`git fetch --unshallow`) before trusting any commit count, per the standing
Pitfall #24 risk note. 614 commits between baseline and head, 375 non-merge —
down from pass 10's 672/347, reflecting a quieter four days with Features
33–34's own review passes (Core infrastructure, Frontend shared) as the
rotation's main activity, plus routine dependency bumps and an app-review
pass. Routes checked against `APPLICATION_PAGES.md`: **273** (up from 270,
17 redirects skipped), 0 errors, 0 warnings. Alembic revisions: **639** (up
from 618), single head `e5f9bb066e07` (the merge-heads revision PR #3547
ported — confirmed the fork that revision closed stayed closed; no new fork
opened since).

### Re-verified standing sweeps (all 13 classes from passes 1–10)

| #   | Class swept                                           | Result                                                                                                                                                                                                                             |
| --- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Formula injection in exports (Pitfall #15)            | **clean** — `grep -E "csv\.(writer\|DictWriter)\("` over `app/` and `scripts/` outside `csv_export.py`: 0 hits; `tests/test_csv_writer_sweep.py` passes                                                                            |
| 2   | `SET NULL` on `NOT NULL` columns (Pitfall #2)         | **clean** — `test_database_schema.py::TestForeignKeyIntegrity::test_set_null_fks_are_nullable` passes                                                                                                                              |
| 3   | Proxy-IP attribution                                  | **clean** — same 3 `request.client.host` hits as every prior pass, same shape (`audit.py:1394`, `security_middleware.py:955` — both documenting comments — and the deliberate direct-IP fallback at `security_middleware.py:1250`) |
| 4   | Alembic chain integrity                               | **clean** — `validate_migrations.py --strict`: 639 revisions, single head `e5f9bb066e07`                                                                                                                                           |
| 5   | LIKE-wildcard handling (Pitfall #25)                  | **clean** — `tests/test_like_escaping.py` passes                                                                                                                                                                                   |
| 6   | `BaseHTTPMiddleware` usage (Pitfall #4)               | **clean** — 0 imports, 0 subclasses; every `grep` hit in `security_middleware.py` / `app/mcp/transport.py` is a documenting comment                                                                                                |
| 7   | Unbounded in-memory trackers (Pitfall #9)             | **clean, 0 new** — see below                                                                                                                                                                                                       |
| 8   | `window.confirm`/`alert`/`prompt` (Pitfall #16)       | **clean** — `grep -rn "window\.\(confirm\|alert\|prompt\)("` over `frontend/src/`: 0 hits                                                                                                                                          |
| 9   | JSON shallow-copy-then-nested-mutate (Pitfall #12)    | **clean** — `tests/test_json_column_ast_sweep.py` passes (enumeration only, no new flagged site)                                                                                                                                   |
| 10  | Org-scoping / IDOR ratchet (Pitfall #14)              | **clean** — `tests/test_org_scoping_ratchet.py` passes                                                                                                                                                                             |
| 11  | Capacity-check locking (Pitfall #27)                  | **clean** — `tests/test_capacity_locking.py` passes                                                                                                                                                                                |
| 12  | Route auth coverage                                   | **clean** — `tests/test_endpoint_auth_coverage.py` passes; `check_route_permissions.py --strict`: 273 routes, 0 errors, 0 warnings                                                                                                 |
| 13  | Raw exception text reaching the client (checklist §5) | **clean** — fresh AST walk of every bound broad `except` handler: 737 handlers (up from 726), 0 `HTTPException(detail=...)` sites referencing the bound name outside `safe_error_detail(...)`/`sanitize_integration_error(...)`    |

Also re-ran as spot-checks: `tests/test_api_cache_pii_exclusions.py` and
`tests/test_baseline_member_grants.py` (both pass), and the frontend
structural guards (`dialogScrollIntegrity`, `dialogDismissIntegrity`,
`testingRegistry`, `primaryFillContrast`, `touchTargetIntegrity`,
`hoverRevealIntegrity`) — **30/30** across 6 files, up from pass 10's 28/28
(new test cases added by other work, not a gap).

Outbound-transport checks: raw SQL by string interpolation is still the same
2 sites (`scheduling_service.py:333`, cushion cast through `int()`;
`enum_normalization.py:125`, table/column names from an internal enumeration,
never user input — same disposition as every prior pass). Direct
`httpx.AsyncClient(`/`Client(` construction is still the same 6 files as pass
10 (`breached_password.py`, `captcha.py`, `email_service.py`,
`external_training_service.py`, `integration_services/base.py`,
`oauth_service.py`), each a standing, previously-reviewed site.
`assert_outbound_url_safe(` direct call sites: still the same 6
(`documenso_service.py`, `teams_service.py`, `webhook_service.py`,
`slack_service.py`, `discord_service.py`, `calcom_service.py`) — the two
extra `grep` hits this pass (`url_validator.py`, `ssrf_transport.py`) are the
function's own definition and docstring mentions, not callers, confirmed by
reading both. `SSRFSafeAsyncTransport(` direct construction is unchanged at
2 files (`external_training_service.py`, `integration_services/base.py`) —
the third hit (`ssrf_transport.py`) is the class's own definition line, not a
construction site.

### Class 7 (unbounded in-memory trackers): delta check against the three genuinely new candidates

186 backend `.py` files changed in this delta. Narrowing to files whose diff
touches a module- or instance-level dict/set/list-shaped assignment
(`grep` for `_[a-zA-Z_]+\s*(:.*)?=\s*(\{\}|\[\]|set\(\)|dict\(\)|defaultdict\(|Counter\(`)
found 7 candidates: `security_middleware.py`, `ballot_send_jobs.py`,
`equipment_check_service.py`, `google_workspace_service.py` — all four
already reviewed in pass 10 (unchanged disposition, this delta touched other
parts of those files) — plus three genuinely new this pass:

- `event_service.py:436` (`self._deferred_reversals: List[...] = []`),
  `forms_service.py:220` (`self._post_commit: List[...] = []`), and
  `storefront_notification_service.py:165` (`self._templates: Dict[...] =
{}`) are all `self.` attributes set in `__init__(self, db: AsyncSession)` —
  the repo's standard per-request service pattern (`service = FooService(db)`,
  CLAUDE.md "Backend Patterns"). Each instance lives only as long as the
  request/call that constructed it; none is a module-level singleton or
  otherwise long-lived, so none can accumulate across requests. Confirmed by
  reading each class's `__init__` and checking every construction site
  (`grep -rn "StorefrontNotificationService("`, etc.) takes a fresh
  `AsyncSession`, never a cached/shared instance.

No genuinely new outbound-HTTP-capable service appeared in this delta either:
the 7 new service files (`department_email.py`,
`member_shift_release_service.py`, `minutes_election_filing.py`,
`minutes_print_data.py`, `minutes_publishing_service.py`,
`training_course_names.py`, `training_requirement_removal.py`) were checked
for `httpx.AsyncClient(`/`Client(`/`requests.get(`/`post(`/`urlopen(` — 0
hits.

## Findings

**0 application-security findings this pass.** Every one of the 13 classes
re-verified clean against head and diffed against the pass-10 baseline tree.
The single open cross-cutting item (outbound-URL TOCTOU) remains open,
unchanged — not re-investigated this pass since nothing in the delta touches
the outbound-transport factory. No `KNOWN_LIMITATIONS.md` change.

**0 security-tooling findings this pass.**

## Schema & migration notes

No migration written this pass. Chain: 639 revisions, single head
`e5f9bb066e07`, no duplicate ids. `test_set_null_fks_are_nullable` and
`test_migration_create_all_tables` both pass.

## Guard tests added

None — this pass found no new gap to backstop. The class-7 and class-13 AST
scripts used this pass are scratch tooling (not committed), same as prior
passes.

## Completion gate

| Check                                                                                                                                                                                                                                                                                                                                                                     | Result                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                                                             | ✅ 0 violations                     |
| `black --check app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                                                      | ✅ clean (2555 files)               |
| `isort --check-only app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                                                 | ✅ clean                            |
| `validate_migrations.py --strict`                                                                                                                                                                                                                                                                                                                                         | ✅ 639 revisions, single head       |
| `check_route_permissions.py --strict`                                                                                                                                                                                                                                                                                                                                     | ✅ 273 routes, 0 errors, 0 warnings |
| Backend `pytest tests/test_json_column_ast_sweep.py tests/test_like_escaping.py tests/test_org_scoping_ratchet.py tests/test_capacity_locking.py tests/test_endpoint_auth_coverage.py tests/test_csv_writer_sweep.py tests/test_database_schema.py tests/test_api_cache_pii_exclusions.py tests/test_baseline_member_grants.py tests/test_migration_create_all_tables.py` | ✅ 214 passed                       |
| `npm run typecheck`                                                                                                                                                                                                                                                                                                                                                       | ✅ 0 errors                         |
| `npm run lint`                                                                                                                                                                                                                                                                                                                                                            | ✅ 0 errors (`--max-warnings 10`)   |
| Frontend structural guards (6 files)                                                                                                                                                                                                                                                                                                                                      | ✅ 30 passed                        |

---

## Pass 10 (2026-10-18) — delta re-sweep of all 13 established sweep classes against 672 commits (347 non-merge), 0 security findings, 0 tooling findings

This iteration (watchdog pickup for `/loop 30m /security-review`: `ListAgents`
showed no reachable dedicated loop session, and `search_pull_requests` found
no open `claude/security-review-*` PR after PR #3394, Feature 34 Frontend
shared pass 9, merged 2026-10-18 03:46 UTC) found every row of the rotation
table at ✅ for the second time since pass 7 opened. Per `PROGRESS.md`'s Step
1, the table is reset to ⬜ for this new lap ("pass 9" of the rotation) and
the rotation wraps to Feature 00, continuing in the same iteration per the
"rides along in the first feature PR of the next pass, together with the
reset" rule — this pass's PR therefore also carries that reset and the `Open
PR` row's clearing (PR #3393/#3394 both recorded merged; no narrative gap to
backfill).

**Baseline:** `ed51d2ea` (PR #3195's merge, pass 9's own head). **Head:**
`ea6752c2` (PR #3394's merge). Repository was shallow
(`git rev-parse --is-shallow-repository` → `true`) and was unshallowed
(`git fetch --unshallow`) before trusting any commit count, per the standing
Pitfall #24 risk note. 672 commits between baseline and head, 347 non-merge —
nearly double pass 9's delta, reflecting the calendar-sync, directory-account
and Minutes (rich-text/signature/record) features landing across Features
31–34's own review passes in this same window, plus routine dependency bumps.
Routes checked against `APPLICATION_PAGES.md`: **270** (up from 269, 17
redirects skipped), 0 errors, 0 warnings. Alembic revisions: **618** (up from
590), single head `1117b642643b`, no duplicate ids.

### Re-verified standing sweeps (all 13 classes from passes 1–9)

| #   | Class swept                                           | Result                                                                                                                                                                                                                             |
| --- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Formula injection in exports (Pitfall #15)            | **clean** — `grep -E "csv\.(writer\|DictWriter)\("` over `app/` and `scripts/` outside `csv_export.py`: 0 hits; `tests/test_csv_writer_sweep.py` passes                                                                            |
| 2   | `SET NULL` on `NOT NULL` columns (Pitfall #2)         | **clean** — `test_database_schema.py::TestForeignKeyIntegrity::test_set_null_fks_are_nullable` passes                                                                                                                              |
| 3   | Proxy-IP attribution                                  | **clean** — same 3 `request.client.host` hits as every prior pass, same shape (`audit.py:1394`, `security_middleware.py:955` — both documenting comments — and the deliberate direct-IP fallback at `security_middleware.py:1250`) |
| 4   | Alembic chain integrity                               | **clean** — `validate_migrations.py --strict`: 618 revisions, single head `1117b642643b`                                                                                                                                           |
| 5   | LIKE-wildcard handling (Pitfall #25)                  | **clean** — `tests/test_like_escaping.py` passes                                                                                                                                                                                   |
| 6   | `BaseHTTPMiddleware` usage (Pitfall #4)               | **clean** — 0 imports, 0 subclasses; every `grep` hit in `security_middleware.py` / `app/mcp/transport.py` is a documenting comment                                                                                                |
| 7   | Unbounded in-memory trackers (Pitfall #9)             | **clean, 0 new** — see below                                                                                                                                                                                                       |
| 8   | `window.confirm`/`alert`/`prompt` (Pitfall #16)       | **clean** — `grep -rn "window\.\(confirm\|alert\|prompt\)("` over `frontend/src/`: 0 hits                                                                                                                                          |
| 9   | JSON shallow-copy-then-nested-mutate (Pitfall #12)    | **clean** — `tests/test_json_column_ast_sweep.py` passes (266 JSON-typed columns across 52 model files, up from prior count — enumeration only, no new flagged site)                                                               |
| 10  | Org-scoping / IDOR ratchet (Pitfall #14)              | **clean** — `tests/test_org_scoping_ratchet.py` passes                                                                                                                                                                             |
| 11  | Capacity-check locking (Pitfall #27)                  | **clean** — `tests/test_capacity_locking.py` passes                                                                                                                                                                                |
| 12  | Route auth coverage                                   | **clean** — `tests/test_endpoint_auth_coverage.py` passes; `check_route_permissions.py --strict`: 270 routes, 0 errors, 0 warnings                                                                                                 |
| 13  | Raw exception text reaching the client (checklist §5) | **clean** — fresh AST walk of every bound broad `except` handler: 726 handlers (up from 691), 0 `HTTPException(detail=...)` sites referencing the bound name outside `safe_error_detail(...)`/`sanitize_integration_error(...)`    |

Also re-ran as spot-checks: `tests/test_api_cache_pii_exclusions.py` and
`tests/test_baseline_member_grants.py` (both pass), and the frontend
structural guards (`dialogScrollIntegrity`, `dialogDismissIntegrity`,
`testingRegistry`, `primaryFillContrast`, `touchTargetIntegrity`,
`hoverRevealIntegrity`) — **28/28** across 6 files, unchanged from pass 9.

Outbound-transport checks: raw SQL by string interpolation is still the same
2 sites (`scheduling_service.py:302`, cushion cast through `int()`;
`enum_normalization.py:125`, table/column names from an internal enumeration,
never user input — same disposition as every prior pass). Direct
`httpx.AsyncClient(`/`Client(` construction is still the same 6 files as pass
9 (`breached_password.py`, `captcha.py`, `email_service.py`,
`external_training_service.py`, `integration_services/base.py`,
`oauth_service.py`), each a standing, previously-reviewed site.

**Methodology note, not a finding:** `assert_outbound_url_safe(` direct call
sites count at **6** this pass (`documenso_service.py`, `teams_service.py`,
`webhook_service.py`, `slack_service.py`, `discord_service.py`,
`calcom_service.py`), not the "9 callers" pass 9 recorded, and
`SSRFSafeAsyncTransport(` direct construction is unchanged at 2 files
(`external_training_service.py`, `integration_services/base.py`). The
pass-9 "9" figure cannot be reproduced against either the current tree or a
checkout of pass 9's own head commit (`ed51d2ea`) under this same grep, so it
was most likely a manual miscount rather than a regression — no caller was
removed between the two commits (`git log -L` on each of the 6 call sites
returns no commit in the delta). The newer calendar-integration surfaces
added in this delta (`google_calendar_service.py`, `outlook_calendar_service.py`,
`microsoft_365_service.py`, `salesforce_service.py`, `nemsis_service.py`,
`nfirs_service.py`, `paypal_service.py`, `weather_service.py`) construct no
`httpx.AsyncClient`/`Client` of their own (confirmed: none appear in the
direct-construction grep above), so they are out of scope for this check,
not an unreviewed gap in it; their outbound-request safety belongs to
whichever feature review covers them.

### Class 7 (unbounded in-memory trackers): delta check against the two genuinely new candidates

Nine files touching a tracker-shaped variable changed in this delta
(`security_middleware.py`, `directory_account_departure.py`,
`ballot_send_jobs.py`, `equipment_check_service.py`,
`google_calendar_oauth_service.py`, `google_workspace_service.py`,
`outlook_calendar_oauth_service.py`, `notification_rules.py`,
`microsoft_oauth.py`), but only two introduce a tracker that did not exist at
the pass-9 baseline:

- `directory_account_departure.py:58` (`_tasks: set[...] = set()`) and
  `ballot_send_jobs.py:82` (`_running_tasks: Set[...] = set()`) — both the
  established fire-and-forget background-task pattern
  (`task.add_done_callback(_tasks.discard)` / `.discard` on the running-tasks
  set immediately after `.add`), the same shape the audit-chain sealer uses.
  Bounded by construction: every entry is removed on completion, so the set
  only ever holds in-flight tasks.
- `google_workspace_service.py:164`
  (`GoogleWorkspaceDirectory.__init__`'s `self._credentials: dict[tuple, Any]
= {}`) — keyed by a `scopes` tuple drawn from a small fixed set of OAuth
  scope constants (`DIRECTORY_SCOPES` and whatever else the directory sync
  calls with), on an object constructed per directory-sync call rather than
  held as a long-lived singleton (no module-level or app-state instance
  found via `grep -rn "GoogleWorkspaceDirectory("`). Domain size and object
  lifetime both bound it; not a tracker in the sense this class exists to
  catch.

The remaining 7 changed files' tracker-shaped variables (e.g.
`security_middleware.py`'s `_entries`/`_keys`/`_saturation_reject_until`,
`notification_rules.py`'s `_cache`) all predate the baseline and were
already reviewed in earlier passes; this delta touched other parts of those
files.

## Findings

**0 application-security findings this pass.** Every one of the 13 classes
re-verified clean against head and diffed against the pass-9 baseline tree.
The single open cross-cutting item (outbound-URL TOCTOU) remains open,
unchanged — not re-investigated this pass since nothing in the delta touches
the outbound-transport factory. No `KNOWN_LIMITATIONS.md` change.

**0 security-tooling findings this pass.**

## Schema & migration notes

No migration written this pass. Chain: 618 revisions, single head
`1117b642643b`, no duplicate ids. `test_set_null_fks_are_nullable` and
`test_migration_create_all_tables` both pass.

## Guard tests added

None — this pass found no new gap to backstop. The class-7 and class-13 AST
scripts used this pass are scratch tooling (not committed), same as pass 9.

## Completion gate

| Check                                                                                                                                                                                                                                                                                                                                                                     | Result                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                                                             | ✅ 0 violations                     |
| `black --check app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                                                      | ✅ clean (2426 files)               |
| `isort --check-only app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                                                 | ✅ clean                            |
| `validate_migrations.py --strict`                                                                                                                                                                                                                                                                                                                                         | ✅ 618 revisions, single head       |
| `check_route_permissions.py --strict`                                                                                                                                                                                                                                                                                                                                     | ✅ 270 routes, 0 errors, 0 warnings |
| Backend `pytest tests/test_json_column_ast_sweep.py tests/test_like_escaping.py tests/test_org_scoping_ratchet.py tests/test_capacity_locking.py tests/test_endpoint_auth_coverage.py tests/test_csv_writer_sweep.py tests/test_database_schema.py tests/test_api_cache_pii_exclusions.py tests/test_baseline_member_grants.py tests/test_migration_create_all_tables.py` | ✅ 213 passed                       |
| `npm run typecheck`                                                                                                                                                                                                                                                                                                                                                       | ✅ 0 errors                         |
| `npm run lint`                                                                                                                                                                                                                                                                                                                                                            | ✅ 0 errors (`--max-warnings 10`)   |
| Frontend structural guards (6 files)                                                                                                                                                                                                                                                                                                                                      | ✅ 28 passed                        |

---

## Pass 9 (2026-10-14) — delta re-sweep of all 13 established sweep classes against 364 commits (216 non-merge), 0 security findings, 0 tooling findings

This iteration found no open `claude/security-review-*` PR (Step 0) — PR
#3195 (Feature 14, Equipment check & shifts, pass 8) had merged 2026-10-14
04:45 UTC, which closed out every row of the rotation table at ✅
simultaneously for the first time since pass 7 opened. Per `PROGRESS.md`'s
Step 1, the table was reset to ⬜ for pass 8 and the rotation wrapped to
Feature 00, continuing in the same iteration per the "rides along in the
first feature PR of the next pass, together with the reset" rule — this
pass's PR therefore also carries that reset and the `Open PR` row's
clearing.

**Baseline:** `3f429ede` (PR #3093's merge, pass 8). **Head:** `ed51d2ea`
(PR #3195's merge, pass 8 of the rotation / pass 7 of the lap). The clone
was shallow (`git rev-parse --is-shallow-repository` → `true`) and was
unshallowed (`git fetch --unshallow`) before any commit count was trusted,
per the risk pass 8's own note and CLAUDE.md Pitfall #24 both flag. 364
commits between baseline and head, 216 non-merge. Routes checked against
`APPLICATION_PAGES.md`: **269** (up from 265, 17 redirects skipped), 0
errors, 0 warnings. Alembic revisions: **590** (up from 571), single head
`70070d86ff27`, no duplicate ids.

### Re-verified standing sweeps (all 13 classes from passes 1–8)

| #   | Class swept                                           | Result                                                                                                                                                                                                                                                                          |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Formula injection in exports (Pitfall #15)            | **clean** — `grep -E "csv\.(writer\|DictWriter)\("` over `app/` and `scripts/` outside `csv_export.py`: 0 hits; `tests/test_csv_writer_sweep.py` passes                                                                                                                         |
| 2   | `SET NULL` on `NOT NULL` columns (Pitfall #2)         | **clean** — `test_database_schema.py::TestForeignKeyIntegrity::test_set_null_fks_are_nullable` passes                                                                                                                                                                           |
| 3   | Proxy-IP attribution                                  | **clean** — same 3 `request.client.host` hits as every prior pass, same shape (`audit.py:1394`, `security_middleware.py:955` — both documenting comments — and the deliberate direct-IP fallback at `security_middleware.py:1250`)                                              |
| 4   | Alembic chain integrity                               | **clean** — `validate_migrations.py --strict`: 590 revisions, single head `70070d86ff27`, no duplicate ids                                                                                                                                                                      |
| 5   | LIKE-wildcard handling (Pitfall #25)                  | **clean** — `tests/test_like_escaping.py` passes                                                                                                                                                                                                                                |
| 6   | `BaseHTTPMiddleware` usage (Pitfall #4)               | **clean** — 0 imports, 0 subclasses; every `grep` hit in `security_middleware.py` / `app/mcp/transport.py` is a documenting comment                                                                                                                                             |
| 7   | Unbounded in-memory trackers (Pitfall #9)             | **clean, 0 new** — see below for method and the one methodology change                                                                                                                                                                                                          |
| 8   | `window.confirm`/`alert`/`prompt` (Pitfall #16)       | **clean** — `grep -rn "window\.\(confirm\|alert\|prompt\)("` over `frontend/src/`: 0 hits                                                                                                                                                                                       |
| 9   | JSON shallow-copy-then-nested-mutate (Pitfall #12)    | **clean** — same 5 sites as pass 8 (line drift only — `onboarding.py`, `inventory_service.py`, `training_programs.py`, `salesforce_sync.py`, `ssrf_transport.py`); `git log -L` on each exact line across the whole delta returns no commit, so none of the five itself changed |
| 10  | Org-scoping / IDOR ratchet (Pitfall #14)              | **clean** — `tests/test_org_scoping_ratchet.py` passes                                                                                                                                                                                                                          |
| 11  | Capacity-check locking (Pitfall #27)                  | **clean** — `tests/test_capacity_locking.py` passes                                                                                                                                                                                                                             |
| 12  | Route auth coverage                                   | **clean** — `tests/test_endpoint_auth_coverage.py` passes; `check_route_permissions.py --strict`: 269 routes, 0 errors, 0 warnings                                                                                                                                              |
| 13  | Raw exception text reaching the client (checklist §5) | **clean** — fresh AST walk (script below) of every bound broad `except` handler: 691 handlers, 0 `HTTPException(detail=...)` sites referencing the bound name outside `safe_error_detail(...)`/`sanitize_integration_error(...)`                                                |

Also re-ran as spot-checks: `tests/test_api_cache_pii_exclusions.py`,
`tests/test_baseline_member_grants.py`, and the frontend structural guards
(`dialogScrollIntegrity`, `dialogDismissIntegrity`, `testingRegistry`,
`primaryFillContrast`, `touchTargetIntegrity`, `hoverRevealIntegrity` —
**28/28** across 6 files, up from 26/26). Outbound-transport checks: raw SQL
by string interpolation is still the same 2 sites
(`scheduling_service.py:302`, cushion cast through `int()`;
`enum_normalization.py:125`, table/column names from an internal
enumeration, never user input — same disposition as every prior pass) and
`assert_outbound_url_safe(` has the same 9 callers as pass 8. Direct
`httpx.AsyncClient(`/`Client(` construction is down to **6 files** (from
7): `breached_password.py`, `captcha.py`, `email_service.py`,
`external_training_service.py`, `integration_services/base.py`,
`oauth_service.py` — each a standing, previously-reviewed site; the
decrease is further consolidation onto the shared factory, not a new
exposure, and `external_training_service.py`'s client is itself built with
`transport=SSRFSafeAsyncTransport()`, read directly at the construction
site. **Outbound-URL DNS-rebinding TOCTOU (`KNOWN_LIMITATIONS.md`)
re-confirmed open, unchanged.**

### Class 7 (unbounded in-memory trackers): method changed, delta is 0 new

This pass's AST walk is **narrower on purpose** than pass 8's documented
method (which also counted class-body `ClassVar`-style declarations and
non-`__init__` method assignments) — it matches only module-level
assignments and `self.*` assignments inside `__init__` of an empty `{}` /
`dict()` / `set()` / `OrderedDict()` / `Counter()`, or any `defaultdict(...)`
/ `deque(...)` call, anywhere in those two scopes. Run that way, it finds
**15 candidates at both baseline and head — the identical set, same files,
same line numbers** (confirmed by running the script against a `git
archive`-exported baseline tree rather than checking out over the working
tree, the same safe-diff method pass 8 used). No tracker was added or
removed by this delta under either method's definition, so the narrower
match still answers the question this class exists to ask: nothing new to
read. The discrepancy with pass 8's absolute count (34) is a methodology
difference flagged here rather than silently producing a smaller number —
closing it, if wanted, means writing one shared script instead of an
ad-hoc one per pass (not done this pass; low priority, no security impact
either way since the delta is 0 regardless of method).

### Class 13 method, in full

```python
# AST walk: every ExceptHandler with a bound name (`except X as e`) where X
# is Exception/BaseException (or absent — bare `except:`), searching the
# handler body for HTTPException(detail=...) calls whose detail expression
# references the bound name anywhere not inside a safe_error_detail(...) or
# sanitize_integration_error(...) call.
```

0 candidates at head (691 broad bound handlers walked). This supersedes
pass 8's "1 candidate, wrapped by a domain sanitizer" finding only in that
the `salesforce_sync.py:117` site still routes through
`sanitize_integration_error()` and so still does not appear as a raw
candidate under this detection rule either — re-confirmed, not re-found.

## Findings

**0 application-security findings this pass.** Every one of the 13 classes
re-verified clean against head and diffed against the pass-8 baseline tree.
The single open cross-cutting item (outbound-URL TOCTOU) is re-confirmed
open with the same disposition. No `KNOWN_LIMITATIONS.md` change.

**0 security-tooling findings this pass** (pass 8's `json_column_ast_sweep.py`
fix re-verified still in place — `mapped_column(...)` recognition intact,
`tests/test_json_column_ast_sweep.py` passes as part of the guard-test run
below).

## Schema & migration notes

No migration written this pass. Chain: 590 revisions, single head
`70070d86ff27`, no duplicate ids. `test_set_null_fks_are_nullable` and
`test_migration_create_all_tables` both pass.

## Guard tests added

None — this pass found no new gap to backstop. The class-7 and class-13 AST
scripts used this pass are scratch tooling (not committed); promoting one or
both to `backend/scripts/` with a guard test, the way `json_column_ast_sweep.py`
was formalized in pass 3, is a reasonable future improvement but not required
by anything found this pass.

## Completion gate

| Check                                                                                                                                                                                                                                                                                                                                                                     | Result                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                                                             | ✅ 0 violations                     |
| `black --check app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                                                      | ✅ clean (2279 files)               |
| `isort --check-only app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                                                 | ✅ clean                            |
| `validate_migrations.py --strict`                                                                                                                                                                                                                                                                                                                                         | ✅ 590 revisions, single head       |
| `check_route_permissions.py --strict`                                                                                                                                                                                                                                                                                                                                     | ✅ 269 routes, 0 errors, 0 warnings |
| Backend `pytest tests/test_json_column_ast_sweep.py tests/test_like_escaping.py tests/test_org_scoping_ratchet.py tests/test_capacity_locking.py tests/test_endpoint_auth_coverage.py tests/test_csv_writer_sweep.py tests/test_database_schema.py tests/test_api_cache_pii_exclusions.py tests/test_baseline_member_grants.py tests/test_migration_create_all_tables.py` | ✅ 213 passed                       |
| `npm run typecheck`                                                                                                                                                                                                                                                                                                                                                       | ✅ 0 errors                         |
| `npm run lint`                                                                                                                                                                                                                                                                                                                                                            | ✅ 0 errors (`--max-warnings 10`)   |
| Frontend structural guards (6 files)                                                                                                                                                                                                                                                                                                                                      | ✅ 28 passed                        |

---

## Pass 8 (2026-10-12, watchdog pickup) — delta re-sweep of all 13 established sweep classes against 646 commits, 0 security findings; 1 security-tooling regression found and fixed

Watchdog pickup: the dedicated `/loop 30m /security-review` session had no
open security-review PR or branch anywhere in the repo (`list_pull_requests`
state=open and `search_pull_requests head:claude/security-review-` both
returned nothing), and `main`'s last security-review merge (#3093, Feature
34 pass 8) was from 2026-10-11 22:45 UTC with no follow-up iteration since.
Row 34 was the rotation table's last row, so per its own preamble this
iteration wraps back to Feature 00 rather than resetting the table.

**Baseline:** `532340e3` (PR #2915's merge, pass 7). **Head:** `3f429ede`
(PR #3093's merge). 646 commits between them. Routes checked against
`APPLICATION_PAGES.md`: **265** (up from 244, 17 redirects skipped).
Alembic revisions: **571** (up from 511), single head `e1a5bfe7a2ed`, no
migration of this pass's own. Each guard-test-backed class ran directly;
each grep/AST class ran against `HEAD` and against a `git archive` export
of the baseline tree (never checked out over the working tree — the
previous entry in this file describes two commands, `git checkout
532340e3 -- .` immediately undone, that this pass used and does not repeat;
`git archive <sha> | tar -x` into a scratch directory is the safe way to
diff a sweep against an old tree without touching HEAD) for a count to
diff against pass 7's.

### Re-verified standing sweeps (all 13 classes from passes 1–7)

| #   | Class swept                                           | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Formula injection in exports (Pitfall #15)            | **clean** — 0 `csv.writer`/`csv.DictWriter` sites outside `csv_export.py`; `tests/test_csv_writer_sweep.py` passes                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2   | `SET NULL` on `NOT NULL` columns (Pitfall #2)         | **clean** — `test_set_null_fks_are_nullable` passes                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 3   | Proxy-IP attribution                                  | **clean** — same 3 hits as every prior pass, same shape (two documenting comments, one deliberate direct-IP fallback in `security_middleware.py:1250`)                                                                                                                                                                                                                                                                                                                                                                   |
| 4   | Alembic chain integrity                               | **clean** — `validate_migrations.py --strict`: 571 revisions, single head `e1a5bfe7a2ed`, no duplicate ids                                                                                                                                                                                                                                                                                                                                                                                                               |
| 5   | LIKE-wildcard handling (Pitfall #25)                  | **clean** — `tests/test_like_escaping.py` passes                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 6   | `BaseHTTPMiddleware` usage (Pitfall #4)               | **clean** — 0 imports, 0 subclasses; every hit is a documenting comment in `security_middleware.py` / `app/mcp/transport.py`                                                                                                                                                                                                                                                                                                                                                                                             |
| 7   | Unbounded in-memory trackers (Pitfall #9)             | **7 new candidates, all bounded or request-scoped** — see below                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 8   | `window.confirm`/`alert`/`prompt` (Pitfall #16)       | **clean** — 0 native calls (`window\.(confirm\|alert\|prompt)\(` greps to nothing); every `confirm(`/`alert(`/`prompt(` hit outside tests/e2e is the `useConfirm()` hook, `LabelScanConfirm.tsx`'s own component-local `confirm`, or the `BeforeInstallPromptEvent.prompt()` type                                                                                                                                                                                                                                        |
| 9   | JSON shallow-copy-then-nested-mutate (Pitfall #12)    | **clean** — same 5 hits as pass 7, same files; `git diff 532340e3..HEAD` around each line is empty, so none of the 5 sites itself changed since it was last cleared                                                                                                                                                                                                                                                                                                                                                      |
| 10  | Org-scoping / IDOR ratchet (Pitfall #14)              | **clean** — `tests/test_org_scoping_ratchet.py` passes                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 11  | Capacity-check locking (Pitfall #27)                  | **clean** — `tests/test_capacity_locking.py` passes                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 12  | Route auth coverage                                   | **clean** — `tests/test_endpoint_auth_coverage.py` passes; `check_route_permissions.py --strict`: 265 routes, 0 errors, 0 warnings                                                                                                                                                                                                                                                                                                                                                                                       |
| 13  | Raw exception text reaching the client (checklist §5) | **clean** — AST walk of every bound broad `except` handler (851, up from 615) found one `HTTPException(detail=...)` candidate (`salesforce_sync.py:117`) referencing the bound exception outside `safe_error_detail`; read directly: it is wrapped in `sanitize_integration_error()` (`integration_health.py:58`), a dedicated sanitizer that redacts URLs/emails/bearer tokens/key=value secrets and caps length — a different, purpose-built sanitizer for the integrations domain, not a leak. 0 real unwrapped sites |

Also re-ran, as a spot-check rather than a numbered class: `tests/test_api_cache_pii_exclusions.py`,
`tests/test_baseline_member_grants.py`, the frontend structural guards
(`dialogScrollIntegrity`, `dialogDismissIntegrity`, `testingRegistry`,
`primaryFillContrast`, `touchTargetIntegrity`, `hoverRevealIntegrity` —
26/26 across 6 files, up from 25/25) and the standing outbound-transport
checks: raw SQL by string interpolation (still the same 2 sites,
`scheduling_service.py:302` and `enum_normalization.py:125`, same
disposition) and outbound HTTP client construction (7 files construct a
client directly, down from 8 at baseline — `audit_ship_service.py` no
longer appears because it now routes through the same
`create_integration_client()` shared, DNS-rebinding-safe factory
`base.py` provides, read at `audit_ship_service.py:86-133`; it still calls
`assert_outbound_url_safe` first, under `asyncio.to_thread`, exactly as
before — a hardening, not a regression). `assert_outbound_url_safe(`
callers: 9 files (7 `integration_services/*`, `ssrf_transport.py`,
`url_validator.py`) — **outbound-URL DNS-rebinding TOCTOU
(`KNOWN_LIMITATIONS.md`) re-confirmed open, unchanged.**

### New candidates for class 7 (unbounded in-memory trackers), all verified bounded or request-scoped

27 at baseline → 34 at head. The 7 new sites, each read directly:

| Site                                                                                     | Disposition                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `upload_encryption.py:321` `_cache`                                                      | Bounded by construction — closed two-key space (`checked`, `remains`), overwritten in place, never grown per-request                                                                                                                                                |
| `finance_approver_matching.py:141-142` `ApproverDirectory.self._positions`/`self._users` | Not a tracker — the class's own docstring: "cached **per request**... one instance serves a whole pending list or coverage report." Lifetime is bounded by the request, not the process, so size is bounded by that request's own chain, not by accumulated traffic |
| `oauth_service.py:355` `_authentik_discovery`                                            | Bounded by construction, self-documented: "One entry: the configured issuer's discovery document... a new issuer replaces the old entry"                                                                                                                            |
| `file_encryption.py:97` `_keks`                                                          | Keyed by `(ENCRYPTION_KEY, ENCRYPTION_SALT)` from deployment config plus a finite `ENCRYPTION_KEYS_LEGACY` list — a closed, operator-controlled key space, not request-derived                                                                                      |
| `issued_secrets.py:56` `_local`                                                          | Explicitly bounded, self-documented: "Pitfall #9: the fallback map is capped and swept of expired entries," `_LOCAL_MAX_ENTRIES = 1000`, LRU eviction via `OrderedDict.popitem(last=False)`                                                                         |
| `security_middleware.py:1300` `_ExceptionCache._entries`                                 | Explicitly bounded, self-documented: `MAX_ENTRIES = 10_000`, `TTL_SECONDS = 60.0`, LRU eviction                                                                                                                                                                     |

No new finding from class 7.

### Security-tooling finding, fixed: SEC8-00-1 (LOW, tooling correctness, not an application vulnerability)

`backend/scripts/json_column_ast_sweep.py` — the structural sweep built in
pass 3 to enumerate every JSON-shaped model column for pitfall #12 checks —
matched only `Column(...)` calls. Every model in `app/models/*.py` has since
moved to SQLAlchemy 2.0's `mapped_column(...)` declarative style (0 remaining
`Column(JSON` sites; confirmed by direct grep), so a real run against the
current tree printed **"0 distinct attribute names, 0 ... declarations"**
instead of the documented ~180-and-growing baseline. The script's own exit
code is always 0 ("a reporting tool, not a gate" — its own docstring), so
this had no CI signal and could have stood for an arbitrary number of passes
without anyone noticing, exactly the failure mode its own docstring warns
reporting-only tools are exposed to.

This is not an application-security finding — no column, no request path,
no pitfall #12 site itself was found newly unsafe — but it is a finding
about this review's own tooling: the instrument meant to make pitfall #12
checkable mechanically had gone silently blind, which matters because a
future pass could have trusted its "0" output as "nothing to check" rather
than "the matcher can't see the current declaration style."

**Fixed:** `_call_target_name(value) != "Column"` widened to a
`COLUMN_CALL_NAMES = frozenset({"Column", "mapped_column"})` membership
check; the rest of the AST walk (subtree search for `JSON_LIKE_TYPE_NAMES`,
restriction to a class's direct body) is unchanged and needed no change —
`mapped_column(...)`'s target-extraction path was already the same `Name`
case `Column(...)` uses. Re-run against current `main`: **202 distinct
attribute names, 256 declarations, across 50 files** (up from the
documented 180/231/43 — consistent with four more months of feature
growth, not a sign the fix over- or under-matches). `backend/scripts/README.md`'s
worked example and `json_column_ast_sweep.py`'s own module docstring are
updated to match. Guard test added
(`tests/test_json_column_ast_sweep.py`): four synthetic-AST cases pin both
call styles (bare `Column(JSON)`, `mapped_column(JSON)`,
`mapped_column(MutableDict.as_mutable(JSON))`, `mapped_column(EncryptedJSON)`)
plus a negative case (a non-JSON `mapped_column` must not match), and two
real-tree assertions (`sweep()` against the actual `app/models/` returns
more than 100 names/declarations, and finds the known `settings` /
`result_data` columns by name) so a future declaration-style migration this
matcher doesn't follow fails a test instead of silently printing a smaller
number.

## Findings

**0 application-security findings this pass.** Every one of the 13 classes
re-verified clean against head and diffed against the pass-7 baseline tree.
The single open cross-cutting item (outbound-URL TOCTOU) is re-confirmed
open with the same disposition. No `KNOWN_LIMITATIONS.md` change.

**1 security-tooling finding, fixed:** SEC8-00-1 (`json_column_ast_sweep.py`
silently matched 0 columns after the codebase's `Column` → `mapped_column`
migration) — see above. Not mirrored into `KNOWN_LIMITATIONS.md`: it was
fixed, not flagged, and it describes review tooling, not an application
behavior an operator would need to know about.

## Schema & migration notes

No migration written this pass. Chain: 571 revisions, single head
`e1a5bfe7a2ed`, no duplicate ids. `test_set_null_fks_are_nullable` and
`test_migration_create_all_tables` both pass.

## Guard tests added

`backend/tests/test_json_column_ast_sweep.py` — pins both `Column(...)` and
`mapped_column(...)` recognition (plus the `MutableDict`/`EncryptedJSON`
wrapping of either) at the AST level, and asserts the real sweep against
`app/models/` returns a plausible nonzero count, so a future declaration-
style change that this matcher doesn't follow fails a test rather than
silently printing a smaller number.

## Completion gate

| Check                                                                                                                                                                                                                                                                                                                                                                     | Result                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.3.0, CI's pin)                                                                                                                                                                                                                                                                                                                           | ✅ 0 violations                           |
| `black --check app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                                                      | ✅ clean                                  |
| `isort --check-only app/ tests/ alembic/`                                                                                                                                                                                                                                                                                                                                 | ✅ clean                                  |
| `validate_migrations.py --strict`                                                                                                                                                                                                                                                                                                                                         | ✅ 571 revisions, single head             |
| `check_route_permissions.py --strict`                                                                                                                                                                                                                                                                                                                                     | ✅ 265 routes, 0 errors, 0 warnings       |
| Backend `pytest tests/test_json_column_ast_sweep.py tests/test_like_escaping.py tests/test_org_scoping_ratchet.py tests/test_capacity_locking.py tests/test_endpoint_auth_coverage.py tests/test_csv_writer_sweep.py tests/test_database_schema.py tests/test_api_cache_pii_exclusions.py tests/test_baseline_member_grants.py tests/test_migration_create_all_tables.py` | ✅ 209 passed                             |
| `npm run typecheck`                                                                                                                                                                                                                                                                                                                                                       | ✅ 0 errors                               |
| `npm run lint`                                                                                                                                                                                                                                                                                                                                                            | ✅ 0 errors (exit 0, `--max-warnings 10`) |
| Frontend structural guards (6 files)                                                                                                                                                                                                                                                                                                                                      | ✅ 26 passed                              |

## Pass 7 (2026-10-04) — delta re-sweep of all 13 established sweep classes against 1015 commits, 0 new findings

**Baseline:** `1bf12e3de` (PR #2592's merge, pass 6). **Head:** `532340e3`
(PR #2915's merge). 1015 commits between them — by far the largest window
this file has swept: 217 files changed under `backend/app/` (39 of them
new), 69 under `backend/alembic/`, 1041 under `frontend/src/`. Routes
checked against `APPLICATION_PAGES.md`: **244** (up from 228). Alembic
revisions: **511** (up from 444), single head `edf608b5a8ea`.
**Frontend:** grep sweep (class 8) plus the structural guard tests and the
mobile-route-integrity e2e spec — no class in this file reads UI component
source line by line.
**Migrations:** none written this pass.

### Scope and method

Unlike pass 6's window (80 commits, no new route or migration), this one
carried real feature work: an anonymous suggestion box, inventory NFC /
kiosk / last-seen subsystems, external shift hours, event-attendance
petitions, member service history, an email link-domain service, a public
branding/app-icon route, a Redis-backed background-task claim, and 67 new
migrations. Each sweep class was therefore run **twice** — once against
current `main` and once against an exported copy of the pass-6 baseline tree
— using the same script or grep, so that every difference in a count is
attributed to a specific new site and read, rather than a stale prior number
being compared against a re-implemented method. Where a guard test owns the
class, the guard test is the method (it is whole-tree by construction).

### Re-verified standing sweeps (all 13 classes from passes 1–6)

| #   | Class swept                                           | Method                                                                                                                                                                                                                                                               | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Formula injection in exports (Pitfall #15)            | `grep -E "csv\.(writer\|DictWriter)\("` over `app/` and `scripts/` outside `csv_export.py`, plus `tests/test_csv_writer_sweep.py`                                                                                                                                    | **clean** — 0 sites; guard test passes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2   | `SET NULL` on `NOT NULL` columns (Pitfall #2)         | `test_database_schema.py::TestForeignKeyIntegrity::test_set_null_fks_are_nullable`                                                                                                                                                                                   | **clean** — passes, including the two new model files (`models/suggestion.py`, `models/external_shift_hours.py`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 3   | Proxy-IP attribution                                  | grep `request.client.host`                                                                                                                                                                                                                                           | **clean** — same 3 hits as every prior pass, same lines (`app/core/audit.py:799` and `app/core/security_middleware.py:954` comments; `security_middleware.py:1228`, the deliberate direct-IP fallback). None of the new public routes reads the socket peer directly                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 4   | Alembic chain integrity                               | `validate_migrations.py --strict`                                                                                                                                                                                                                                    | **clean** — 511 revisions (67 new), single head `edf608b5a8ea`, no duplicate ids; `test_migration_create_all_tables.py` passes over the 67 new revisions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 5   | LIKE-wildcard handling (Pitfall #25)                  | `tests/test_like_escaping.py`                                                                                                                                                                                                                                        | **clean** — passes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 6   | `BaseHTTPMiddleware` usage (Pitfall #4)               | `grep -rn "BaseHTTPMiddleware" app/`                                                                                                                                                                                                                                 | **clean** — 0 imports, 0 subclasses; every hit is one of the same documenting comments in `security_middleware.py` and `app/mcp/transport.py`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 7   | Unbounded in-memory trackers (Pitfall #9)             | AST walk: module-level assignments, and `self.*` assignments inside `__init__`, of an empty `{}` / `dict()` / `set()` / `OrderedDict()` / `Counter()`, or any `defaultdict(...)` / `deque(...)`; run on baseline and head                                            | **2 new candidates, both bounded** — baseline 25 (matching pass 6's count), head 27. The two new ones are `app/services/branding_service.py:51` `_logo_cache` (a fixed three-key dict — `expires_at`/`digest`/`logo` — overwritten by `.update()`, never grown, 60 s TTL) and `:52` `_asset_cache` (an `OrderedDict` LRU capped at `ASSET_CACHE_MAX_ENTRIES = 40`, evicted with `popitem(last=False)` at `:186-187`). Its key space is closed too: icon variants are looked up in `ICON_VARIANTS` before rendering (`:90-92`) and splash sizes are checked against the `SPLASH_GEOMETRIES` allowlist (`app/utils/app_icons.py:241`), so an anonymous caller cannot mint new keys or ask for an arbitrary render size |
| 8   | `window.confirm`/`alert`/`prompt` (Pitfall #16)       | grep `frontend/src/` for `window.(confirm\|alert\|prompt)` and bare `confirm(`/`alert(`/`prompt(`, tests and e2e excluded; `noBlockingBrowserDialogs` still wired in `eslint.config.js` (`:63`, `:196`, `:219`)                                                      | **clean** — 0 native calls. 13 hits: comments that document the ban, `LabelScanConfirm.tsx:154` (a component-local `async confirm` defined at `:89`) and the `BeforeInstallPromptEvent.prompt()` interface in `usePWAInstall.ts:4`. `npm run lint` passes over the whole tree, so the ESLint rule agrees                                                                                                                                                                                                                                                                                                                                                                                                             |
| 9   | JSON shallow-copy-then-nested-mutate (Pitfall #12)    | `grep -E "= dict\([a-zA-Z_]+\.[a-zA-Z_.]+( or \{\})?\)"` over `app/`, run on baseline and head, then read every hit                                                                                                                                                  | **clean** — 5 hits, the **same 5 at baseline** (line drift only). Pass 6 listed only 2 of them, so the other 3 were read for the first time this pass: `services/onboarding.py:1616` (`steps_completed` — sets one top-level key, reassigns), `services/inventory_service.py:3337` (`lot_allocations` — values are ints, only top-level keys set/popped) and `api/v1/endpoints/training_programs.py:122` (`progress_notes` — copied into a **response** via `model_copy`, never written back to the row). None mutates a nested value through the copy. The other 2 are unchanged from pass 6 (`salesforce_sync.py:564`, `ssrf_transport.py:55`)                                                                     |
| 10  | Org-scoping / IDOR ratchet (Pitfall #14)              | `tests/test_org_scoping_ratchet.py`                                                                                                                                                                                                                                  | **clean** — passes; no new unscoped by-id query on an org-carrying model across the 9 new API route files and 15 new service files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 11  | Capacity-check locking (Pitfall #27)                  | `tests/test_capacity_locking.py`                                                                                                                                                                                                                                     | **clean** — passes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 12  | Route auth coverage                                   | `tests/test_endpoint_auth_coverage.py`                                                                                                                                                                                                                               | **clean** — passes, covering the new unauthenticated `app/api/public/branding.py` routes; `check_route_permissions.py --strict`: 244 routes, 0 errors, 0 warnings                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 13  | Raw exception text reaching the client (checklist §5) | AST walk of every bound `except Exception` / `except BaseException` / bare `except` handler in `app/`, flagging an `ast.Name` of the bound exception anywhere in an `HTTPException(detail=...)` outside a `safe_error_detail(...)` subtree; run on baseline and head | **clean** — head 615 bound broad handlers (baseline 589 under the same script; this script counts every bound broad handler, which is why it differs from pass 6's 198), **0 unwrapped** in both. A complementary check of `detail=str(<bound>)` sites (107, up from 81) found every one inside a **narrow** handler for a domain exception — `ValueError` 18, `LookupError` 14, `BudgetLimitExceededError` 48, `LastAdministratorError` 5, `SeparationOfDutiesError` 4, `AttemptLimitReached` 3, `InventoryNfcTagNotFound` 3, `PrinterUnreachableError` 3, `ExternalApparatusInUseError` 2, `PermissionError` 1, `SalesforceOAuthError` 1 — whose messages are composed by this codebase, not a driver or library   |

Also re-ran, as a spot-check rather than a numbered class:
`tests/test_api_cache_pii_exclusions.py`, `tests/test_baseline_member_grants.py`,
and the frontend structural guards (`dialogScrollIntegrity`,
`dialogDismissIntegrity`, `testingRegistry`, `primaryFillContrast`,
`touchTargetIntegrity`, `hoverRevealIntegrity` — 25/25 across 6 files) plus
`mobile-route-integrity.spec.ts` (1/1).

### Read directly to resolve a delta

- **`app/core/background_claim.py:87,113`** — new `redis_client.eval(...)`
  hits from pass 5's one-shot `eval`/`exec` check. Both are Redis
  server-side Lua: a module-constant script (`RENEW_IF_OWNER_LUA`,
  `RELEASE_IF_OWNER_LUA`) with the key in `KEYS[1]` and the owner/TTL in
  `ARGV`. Nothing request-derived reaches the script text. Not a finding.
- **Raw SQL by string interpolation** (pass 5's other one-shot check) —
  still the same 2 sites (`scheduling_service.py:282`, `int()`-cast interval;
  `enum_normalization.py:125`, identifiers from a hardcoded tuple). Unchanged.
- **Outbound HTTP client construction** — a per-file count of
  `httpx.AsyncClient(`/`httpx.Client(`/`requests.*(`/`aiohttp.ClientSession(`/
  `urlopen(` is **identical** at baseline and head: no new outbound client
  anywhere in the 1015 commits.
- **`app/services/integration_services/base.py`** — the one file in the
  outbound-transport family that changed. The change replaces httpx 0.28's
  deprecated `AsyncHTTPTransport(cert=...)` with a `verify=` SSL context
  built by `_tls_verify()` (`:146-169`). Certificate verification is
  preserved: with no client certificate it still passes `verify=True`, and
  with one it builds the context from `httpx.create_ssl_context(verify=True,
trust_env=trust_env)` before loading the chain. Every transport the factory
  builds (direct, explicit proxy, environment proxy mounts) receives the same
  context. Not a weakening.

**Outbound-URL DNS-rebinding TOCTOU (`KNOWN_LIMITATIONS.md`'s "Outbound
Integration Requests" entry) — re-confirmed open, unchanged.** Still 7 sites:
six `integration_services/*_service.py` files call `assert_outbound_url_safe(`
directly, and `audit_ship_service.py` passes it as a callable (`:99`), so a
plain `assert_outbound_url_safe(` grep finds 6 and needs that seventh read.
Only `base.py` changed among them, and only as described above; the
check-then-resolve gap is untouched. Same disposition as passes 5 and 6.

### Verified good ✅ (pass 7 additions)

- **All 13 classes hold across the largest window yet** (1015 commits, 39
  new backend files, 67 migrations, 16 new routes). Mechanism: each class
  re-run on head and on the baseline tree with the same method, so the deltas
  are new sites rather than method drift.
- **The new anonymous branding surface cannot be used to grow memory or force
  arbitrary renders.** Both of its caches are bounded and the render inputs
  are allowlisted (class 7 row).
- **Pass 6's class-9 write-up under-reported its own grep.** It listed 2
  hits where the grep produced 5. The 3 unlisted ones were present at pass
  6's baseline and are read and cleared here, so none is a regression. The
  full hit list is recorded above so a later pass can compare against it.

## Findings

**0 new findings this pass.** Every class re-verified clean against head
and diffed against the pass-6 baseline tree. The single open cross-cutting
item (outbound-URL TOCTOU) is re-confirmed open with the same disposition.
No `KNOWN_LIMITATIONS.md` change.

## Schema & migration notes

No migration written. Chain: 511 revisions, single head `edf608b5a8ea`, no
duplicate ids. `test_set_null_fks_are_nullable` and
`test_migration_create_all_tables` both pass.

## Guard tests added

None. Every class already has a standing guard test or a recorded
grep/AST method, and this pass found nothing new to close.

## Completion gate

| Check                                                             | Result                                                                                                                                                                                              |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                     | ✅ clean                                                                                                                                                                                            |
| `black --check app/ tests/ alembic/`                              | ✅ 1862 files unchanged                                                                                                                                                                             |
| `isort --check-only app/ tests/ alembic/` (9.0.1)                 | ✅ clean                                                                                                                                                                                            |
| `python3 scripts/validate_migrations.py --strict`                 | ✅ 511 revisions, single head                                                                                                                                                                       |
| `python3 scripts/check_route_permissions.py --strict` (repo root) | ✅ 244 routes, 0 errors, 0 warnings                                                                                                                                                                 |
| cross-cutting guard tests (backend)                               | ✅ 141 passed: CSV sweep, LIKE escaping, org-scoping ratchet, capacity locking, endpoint-auth coverage, PII cache pin, `create_all`-table tolerance, baseline member grants, `SET NULL` nullability |
| `cd frontend && npm run typecheck`                                | ✅ 0 errors (aliased 7.0.2 compiler)                                                                                                                                                                |
| `cd frontend && npm run lint`                                     | ✅ 0 errors, 0 warnings                                                                                                                                                                             |
| frontend structural guard tests                                   | ✅ 25/25 across 6 files; `mobile-route-integrity.spec.ts` 1/1                                                                                                                                       |

The diff is documentation only: this file and `PROGRESS.md`. No source file
changed, so per CLAUDE.md's "Match the Verification to the Change" the full
backend and frontend suites were not run locally. CI runs both.

---

## Pass 6 (2026-09-15) — re-sweep of all 13 established sweep classes, 0 new findings

**Backend:** whole `app/` tree (80 commits landed since pass 5's merge
`2e6dcf3d1`; 228 routes checked against `APPLICATION_PAGES.md`, 444 Alembic
revisions, single head — both counts unchanged from pass 5, confirming no
route or migration landed in this window)
**Frontend:** re-ran the three frontend structural guard tests plus the
mobile-route-integrity e2e spec, per pass 5's own precedent — no frontend
sweep class in this file reads UI component source line by line
**Migrations:** none written this pass

### Scope

Per pass 5's closing instruction ("pass 6 should not re-derive any of
this"), every sweep class below was **re-run against current code**
(fresh AST walk or grep, not a diff against pass 5's numbers) rather than
assumed from the prior write-up. The 80 intervening commits are almost
entirely the parent rotation's own Feature 01–22 pass-5 re-verifications
(each already reviewed under its own feature file) plus three dependabot
merges and one post-merge self-review fix (`468d4feab`, four email
findings from PR #2519's own review) — none of which is a new cross-cutting
pattern; each lands inside a single feature's already-declared files and is
out of this feature's scope to re-litigate.

Read directly (not just swept mechanically) to resolve an apparent new hit:
`app/utils/ssrf_transport.py:55`'s `dict(request.extensions)` (sweep 9,
below) — new to the grep's output this pass because the grep pattern was
widened, not because the code is new — and three `log_audit_event`
proximity near-misses in `users.py` and `training.py` (sweep re-check,
below) that the wider window this pass used surfaced and a line-by-line
read ruled out.

### Re-verified standing sweeps (all 13 classes from passes 1–5)

| #   | Class swept                                           | Method                                                                                                                                                                                                                                                                                                                                              | Result                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Formula injection in exports (Pitfall #15)            | `grep` for `csv.writer(`/`csv.DictWriter(` outside `csv_export.py`, plus `tests/test_csv_writer_sweep.py`                                                                                                                                                                                                                                           | **clean** — 0 sites; guard test passes                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2   | `SET NULL` on `NOT NULL` columns (Pitfall #2)         | `test_database_schema.py::TestForeignKeyIntegrity::test_set_null_fks_are_nullable`                                                                                                                                                                                                                                                                  | **clean** — passes                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 3   | Proxy-IP attribution                                  | grep `request.client.host`                                                                                                                                                                                                                                                                                                                          | **clean** — same 3 hits as every prior pass (`app/core/audit.py:799` and `app/core/security_middleware.py:954` comments, `security_middleware.py:1228`'s deliberate use inside the direct-IP fallback)                                                                                                                                                                                                                                          |
| 4   | Alembic chain integrity                               | `validate_migrations.py --strict`                                                                                                                                                                                                                                                                                                                   | **clean** — 444 revisions, unchanged from pass 5, single head `6ab7d903fae5`, no duplicate ids                                                                                                                                                                                                                                                                                                                                                  |
| 5   | LIKE-wildcard handling (Pitfall #25)                  | `tests/test_like_escaping.py`                                                                                                                                                                                                                                                                                                                       | **clean** — passes                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 6   | `BaseHTTPMiddleware` usage (Pitfall #4)               | `grep -rn "BaseHTTPMiddleware" app/`                                                                                                                                                                                                                                                                                                                | **clean** — 0 usages; same 8 documenting comments (7 in `security_middleware.py`, 1 in `app/mcp/transport.py`)                                                                                                                                                                                                                                                                                                                                  |
| 7   | Unbounded in-memory trackers (Pitfall #9)             | Fresh AST walk (module-level and `self.*`-in-`__init__` assignments of `dict()`/`set()`/`defaultdict()`/`OrderedDict()`/`deque()` calls or empty `{}`/`set()` literals), whole `app/` tree                                                                                                                                                          | **clean** — same 25 trackers as pass 5, every one still bounded; the walk's raw 230-hit output includes ~200 static label/enum/config dicts (module-level lookup tables, never mutated after import) and 7 Pydantic response-schema field defaults (`{}` per-instance, not process-global) — both filtered out and confirmed by reading a sample of each shape, not assumed                                                                     |
| 8   | `window.confirm`/`alert`/`prompt` (Pitfall #16)       | grep `frontend/src/` excluding tests                                                                                                                                                                                                                                                                                                                | **clean** — 0 raw calls; all 10 matches are comments/replacement-component names documenting the ban                                                                                                                                                                                                                                                                                                                                            |
| 9   | JSON shallow-copy-then-nested-mutate (Pitfall #12)    | grep for `= dict(<expr>)` across `app/`, then read each hit assigning into a persisted/mutated structure                                                                                                                                                                                                                                            | **clean** — `app/api/v1/endpoints/salesforce_sync.py:564` (pass 5's "salesforce_sync.py:564" hit, re-confirmed at the same line) still only sets a top-level key on the copy before reassigning `integration.config`; `ssrf_transport.py:55`'s `dict(request.extensions)` is an httpx `Request.extensions` dict (not a SQLAlchemy JSON column, no `db.commit()` in the path) with only a top-level key set — not a Pitfall #12 shape either way |
| 10  | Org-scoping / IDOR ratchet (Pitfall #14)              | `tests/test_org_scoping_ratchet.py`                                                                                                                                                                                                                                                                                                                 | **clean** — passes; no new unscoped by-id query on an org-carrying model                                                                                                                                                                                                                                                                                                                                                                        |
| 11  | Capacity-check locking (Pitfall #27)                  | `tests/test_capacity_locking.py`                                                                                                                                                                                                                                                                                                                    | **clean** — passes                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 12  | Route auth coverage                                   | `tests/test_endpoint_auth_coverage.py`                                                                                                                                                                                                                                                                                                              | **clean** — passes; no new unreviewed unauthenticated handler                                                                                                                                                                                                                                                                                                                                                                                   |
| 13  | Raw exception text reaching the client (checklist §5) | Fresh AST walk of every broad `except`/`except Exception`/bare `except` handler in `app/`, checking whether the bound name reaches `HTTPException(detail=...)` as an `ast.Name` reference (not a substring match on the dump, which pass 5's write-up implies but a naive re-implementation of gets wrong for single-letter binding names like `e`) | **clean** — 198 raw hits (same count as pass 5), 0 unwrapped — every one reaches the client only through `safe_error_detail(...)`, directly or inside an f-string                                                                                                                                                                                                                                                                               |

Also re-ran, as a spot-check rather than a numbered class: `tests/test_api_cache_pii_exclusions.py` (2/2), `tests/test_migration_create_all_tables.py` and `tests/test_baseline_member_grants.py`, and the frontend structural guards (`dialogScrollIntegrity.test.ts`, `dialogDismissIntegrity.test.ts`, `testingRegistry.test.ts` — 16/16 combined — plus `mobile-route-integrity.spec.ts`, 1/1, and the backend-side `check_route_permissions.py --strict`: 228 routes, 0 errors, 0 warnings, unchanged from pass 5).

**`log_audit_event` PII-shaped-key re-check (ad hoc, not a numbered class, per pass 5's own framing of this as a one-shot check rather than a standing sweep):** an AST-based re-implementation (walking each `log_audit_event` call's arguments for a `Name`/string match, rather than a fixed-line-window grep) found the same 8 calls carrying an `email`/`deleted_full_name`/`prospect_email` key pass 4/5 already accounted for as the audited event's own subject. A wider proximity grep (±25/+40 lines around the call, matching pass 5's own looser method) additionally surfaces `organizations.py`'s `phone`/`email` (already documented in pass 5 as the **response dict**, not `event_data`), plus two hits new to this pass's wider window — `users.py:1054` (`full_name`) and `training.py:705` (`full_name`) — both read directly and confirmed to be, respectively, the route's own return payload and a background chat-notification task's argument, neither reaching `log_audit_event`'s `event_data`. 0 new genuine findings; the discrepancy from pass 5's stated "13" is the grep window's sensitivity, not a code change — recorded here so a future pass doesn't need to re-resolve the same apparent mismatch.

**Outbound-URL DNS-rebinding TOCTOU (`KNOWN_LIMITATIONS.md`'s "Outbound Integration Requests" entry) — re-confirmed open, not attempted this pass.** Re-verified directly against code, not trusted from the doc: still **7** call sites (`assert_outbound_url_safe(` in `integration_services/{teams,webhook,slack,discord,calcom,documenso}_service.py` plus `audit_ship_service.py`), `documenso_service.py`'s single `_assert_base_url_safe()` call confirmed still exercised from both `test_connection` and `create_document`. No code in this window touched any of the seven files or `create_integration_client()`. Same reasoning as pass 5 for leaving it flagged rather than attempting a fix inside this sweep: the factory's own docstring documents four already-shipped regressions from prior attempts to change it, and pinning the resolved IP is in direct tension with the proxy support the same factory provides — a design decision, not a mechanical wrap-the-transport change. **Remains OPEN in `KNOWN_LIMITATIONS.md`, unchanged disposition, count, and mechanism.**

### Verified good ✅ (pass 6 additions)

- **All 13 established sweep classes hold clean against 80 commits of intervening change**, none of which touches a cross-cutting mechanism this file tracks. Mechanism: re-run per row above, each against its own guard test or a from-scratch AST/grep pass, not a diff against pass 5's numbers.
- **Route count (228) and migration count (444) are byte-identical to pass 5's**, independently confirming the 80 intervening commits added no new route and no new migration in this window — consistent with them being pass-5 re-verification PRs for other rotation features, which by design change little to nothing in-scope.
- **The tracker sweep's raw AST output (230 hits) was fully triaged, not sampled** — every hit beyond the known 25 mutable trackers was confirmed to be either a static lookup table (never reassigned after module import) or a Pydantic response-schema field default (per-instance, dies with the response object), by reading a representative instance of each shape rather than assuming the category from the variable name.

## Findings

**0 new findings this pass.** Every established sweep class re-verified clean against the 80 commits landed since pass 5's merge. The one open cross-cutting item this pass could plausibly have acted on (the outbound-URL TOCTOU) was re-evaluated and left flagged, for the same reasons pass 5 gave — not silently skipped.

## Schema & migration notes

No migration written this pass. Chain re-validated: 444 revisions (unchanged from pass 5), single head `6ab7d903fae5`, no duplicate ids. `test_set_null_fks_are_nullable` and `test_migration_create_all_tables` both pass.

## Guard tests added

None. Every invariant this pass re-verified already has a standing guard test from a prior pass; this pass found nothing new to close a class on.

## Completion gate

| Check                                                                                      | Result                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `python3 -m flake8 app/ tests/ alembic/`                                                   | ✅ clean                                                                                                                                                                                 |
| `black --check app/ tests/ alembic/`                                                       | ✅ 1596 files unchanged                                                                                                                                                                  |
| `isort --check-only app/ tests/ alembic/`                                                  | ✅ clean                                                                                                                                                                                 |
| `python3 scripts/validate_migrations.py --strict`                                          | ✅ 444 revisions, single head                                                                                                                                                            |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                          | ✅ 228 routes checked, 0 errors, 0 warnings                                                                                                                                              |
| cross-cutting guard tests (backend)                                                        | ✅ 141 passed — LIKE escaping, CSV sweep, `SET NULL`, org-scoping ratchet, capacity locking, endpoint-auth coverage, PII cache pin, `create_all`-table tolerance, baseline member grants |
| backend full unit suite (`pytest tests/ -m "not integration and not slow and not docker"`) | ✅ **10199 passed, 1 skipped**, 2419 deselected (the 1 skip is `test_push_service.py`'s optional `py_vapid`/`pywebpush` dependency, pre-existing)                                        |
| `cd frontend && npm run typecheck`                                                         | ✅ 0 errors (aliased 7.0.2 compiler)                                                                                                                                                     |
| `cd frontend && npm run lint`                                                              | ✅ 0 errors, 0 warnings                                                                                                                                                                  |
| frontend structural guard tests                                                            | ✅ `dialogScrollIntegrity.test.ts`, `dialogDismissIntegrity.test.ts`, `testingRegistry.test.ts` — 16/16 combined; `mobile-route-integrity.spec.ts` 1/1                                   |

No source files changed this pass — every check above is a re-verification, not a fix, so there is nothing for a behavior-neutrality diff against unmodified `HEAD` to compare.

---

## Pass 5 (2026-09-14) — re-sweep of all 13 established sweep classes, 0 new findings, one flagged-not-fixed decision re-confirmed

**Backend:** whole `app/` tree (485 commits landed since pass 4's `c91060f7a`;
88 files under `app/api/`, 228 routes checked against
`APPLICATION_PAGES.md`, 444 Alembic revisions, single head)
**Frontend:** re-ran the frontend-side guard tests (dialog scroll/dismiss
integrity, testing registry, mobile route inventory) rather than reading
component source — no frontend sweep class in this file reads UI code line by
line
**Migrations:** none written this pass

### Scope

This pass follows pass 4's own "Pass 5 should not re-derive any of this"
instruction literally: every sweep class established in passes 1–4 was
**re-run against current code** (AST walk, grep, or the standing guard test —
method stated per row), not re-derived from first principles. Nothing in this
pass re-reads the feature-owned service internals passes 01–34 already cover;
that would duplicate them rather than sweep across them, per this file's own
scoping rule.

Read directly (not just swept mechanically): the three hits the "raw
exception reaching the client" pattern (checklist §5, sweep-13's class)
turned up before being ruled out, `documenso_service.py`'s outbound-URL
guard (new since pass 4), `organizations.py`'s `log_audit_event` call (a
false-positive from the audit-payload sweep, read to confirm), and
`email_service.py`'s two `httpx.AsyncClient` construction sites (read to
confirm they target a hardcoded `api.cloudflare.com` host, not an
org-configurable one).

### Re-verified standing sweeps (all 13 classes from passes 1–4)

| #   | Class swept                                           | Method                                                                                                                                                                      | Result                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Formula injection in exports (Pitfall #15)            | `grep` for `csv.writer(`/`csv.DictWriter(` outside `csv_export.py`, plus `test_csv_writer_sweep.py`                                                                         | **clean** — 0 sites; guard test 12/12                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2   | `SET NULL` on `NOT NULL` columns (Pitfall #2)         | `test_database_schema.py::test_set_null_fks_are_nullable`                                                                                                                   | **clean** — passes                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 3   | Proxy-IP attribution                                  | grep `request.client.host`                                                                                                                                                  | **clean** — same 3 hits as every prior pass (2 comments, 1 deliberate use inside `get_client_ip`)                                                                                                                                                                                                                                                                                                                                                |
| 4   | Alembic chain integrity                               | `validate_migrations.py --strict`                                                                                                                                           | **clean** — 444 revisions (up from pass 4's 437), single head, no duplicate ids                                                                                                                                                                                                                                                                                                                                                                  |
| 5   | LIKE-wildcard handling (Pitfall #25)                  | `tests/test_like_escaping.py`                                                                                                                                               | **clean** — 3/3                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 6   | `BaseHTTPMiddleware` usage (Pitfall #4)               | `grep -rn "BaseHTTPMiddleware" app/`                                                                                                                                        | **clean** — 0 usages; same 8 documenting comments (7 in `security_middleware.py`, 1 in `app/mcp/transport.py`)                                                                                                                                                                                                                                                                                                                                   |
| 7   | Unbounded in-memory trackers (Pitfall #9)             | AST walk (module-level assignments + `self.*` inside `__init__`) for dict/set/defaultdict/OrderedDict/deque literals, whole `app/` tree                                     | **clean** — same 25 trackers as pass 4 (identical names, `_session_trusted_ip` included), every cap constant/eviction call still present — verified by re-grepping each tracker's own `_MAX_*`/`_enforce_key_caps`/`cleanup_rate_limit_cache` site, not just re-running the count                                                                                                                                                                |
| 8   | `window.confirm`/`alert`/`prompt` (Pitfall #16)       | grep `frontend/src/` excluding tests; `noBlockingBrowserDialogs` still wired in `eslint.config.js`                                                                          | **clean** — 0 raw calls; ESLint rule present                                                                                                                                                                                                                                                                                                                                                                                                     |
| 9   | JSON shallow-copy-then-nested-mutate (Pitfall #12)    | grep for `= dict(<obj>.<json-attr>)` across `app/`                                                                                                                          | **clean** — same single site (`salesforce_sync.py:564`), still only a top-level key assignment on the copy (the correct pattern)                                                                                                                                                                                                                                                                                                                 |
| 10  | Org-scoping / IDOR ratchet (Pitfall #14)              | `tests/test_org_scoping_ratchet.py`                                                                                                                                         | **clean** — 12/12; no new unscoped by-id query on an org-carrying model                                                                                                                                                                                                                                                                                                                                                                          |
| 11  | Capacity-check locking (Pitfall #27)                  | `tests/test_capacity_locking.py`                                                                                                                                            | **clean** — 31/31                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 12  | Route auth coverage                                   | `tests/test_endpoint_auth_coverage.py`                                                                                                                                      | **clean** — 1/1 (the allowlist-diff test); no new unreviewed unauthenticated handler                                                                                                                                                                                                                                                                                                                                                             |
| 13  | Raw exception text reaching the client (checklist §5) | AST walk of every broad `except`/`except Exception` handler in `app/`, checking whether the bound name reaches `HTTPException(detail=...)` unwrapped by `safe_error_detail` | **clean** — 198 raw AST hits, all but 3 already routed through `safe_error_detail(e)` (directly or via an f-string); the 3 read in full each wrap `safe_error_detail(exc)`/`safe_error_detail(e)` inside their f-string, which the AST script's first pass (looking only for a direct `safe_error_detail(...)` call as the whole `detail=` expression) didn't recognize — 0 real findings, same conclusion as pass 4's SEC4-1/SEC4-2 fix holding |

Also re-ran, as a spot-check rather than a numbered class since pass 4 recorded them as "also checked, no finding": the `PINNED_EXCLUSIONS` cache-PII regression guard (`tests/test_api_cache_pii_exclusions.py`, 4/4), `tests/test_migration_create_all_tables.py` and `tests/test_baseline_member_grants.py` (68/68 combined), and the three frontend structural guards this file's prior passes didn't need but the parent rotation's other features added since (`dialogScrollIntegrity.test.ts` 2/2, `dialogDismissIntegrity.test.ts` 2/2, `testingRegistry.test.ts` 12/12, plus the backend-side `check_route_permissions.py --strict`: 228 routes, 0 errors, 0 warnings, and the e2e `mobile-route-integrity.spec.ts`, 1/1).

### Candidate new sweep classes considered, not adopted as standing classes

Three additional checks were run this pass, given "hundreds of commits ... unrelated feature work" since pass 4, to look for a genuinely new cross-cutting pattern per the rotation's own instruction. None found a defect, and none is being added as a 14th numbered standing class — each is a one-shot check whose result is fully captured by an existing class or an existing guard test, so a dedicated new AST sweep for it would duplicate coverage rather than add any:

- **Raw SQL built by string interpolation** (`text(f"...")`/`.format()`/`+`
  inside `text(...)`) — 2 hits, both read in full.
  `scheduling_service.py:271` interpolates `int(cushion)`, an `int()`-cast
  value (raises rather than admits a non-numeric string) into an `INTERVAL
... HOUR` clause — not attacker-controlled text, and identifiers can't be
  bound params in the first place. `enum_normalization.py:125`
  (`ALTER TABLE {tbl} MODIFY {col} ...`) interpolates a backtick-quoted
  table/column name drawn from a hardcoded `_TARGET_COLUMNS` tuple of code
  constants, with its own comment explaining why (identifiers, not values,
  can't be bound params) — already covered by sweep 5's LIKE-escaping
  invariant's own reasoning, not a new gap.
- **`eval`/`exec`/`pickle.loads`** — 1 hit, a string literal
  (`"eval("`) inside `security_monitoring.py`'s own list of suspicious
  request-body substrings it watches _for_ — not a call. 0 real uses.
- **`log_audit_event` calls naming a PII-shaped key** — re-ran pass 4's
  sweep; still 13 hits (`email`×5, `full_name`×3, `deleted_full_name`×2,
  `prospect_email`×1, `phone`×1, all already accounted for in pass 4's
  writeup as the audited event's own subject). One apparent 14th hit
  (`organizations.py:1476`) was a proximity false-positive from a
  line-window grep — the `phone`/`email` keys it matched are in the
  **response dict** the handler returns, several lines after the actual
  `log_audit_event` call, whose `event_data` carries only
  `{"fields_changed": [...]}` (field _names_, no values) — read in full to
  confirm, not a finding.

### The one item this pass evaluated fixing and explicitly declined to touch

**Outbound-URL DNS-rebinding TOCTOU across the shared integration transport
(`KNOWN_LIMITATIONS.md`'s "Outbound Integration Requests" entry) — re-confirmed
open, deliberately not attempted this pass.** That entry explicitly names this
feature ("a dedicated cross-cutting pass ... the shape SEC-00 exists for") as
the place to close it, so it was evaluated rather than skipped past. Current
state, re-verified directly against code rather than trusted from the doc:
**7** call sites (`integration_services/{teams,webhook,slack,discord,calcom,
documenso}_service.py` via the shared `create_integration_client()`, plus
`audit_ship_service.py`'s own client) all call `assert_outbound_url_safe()`
immediately before their request — up from pass 4's 6, because
`documenso_service.py`'s own missing call was closed by a feature-scoped
review (INT-27 pass 4) between pass 4 and this pass, independently of this
file. All seven still perform their _own_ independent DNS resolution at
connect time, separate from that check, so the classic TOCTOU (hostname
answers public at check-time, private moments later) is narrowed, not closed,
identically across all seven.

Closing it means pinning the address `assert_outbound_url_safe` resolved for
the actual connection — the shape `external_training_service.py` and
`push_service.py` already use (`SSRFSafeAsyncTransport`/a pinned
`requests.Session` adapter) — across the six-site `create_integration_client()`
family plus `audit_ship_service.py`'s own client construction. This was not
attempted here, and the reason is specific rather than generic caution:
`create_integration_client()` (`app/services/integration_services/base.py`)
is a ~150-line factory whose own docstring documents four _already-shipped_
regressions from changing it without accounting for every interacting
concern — `trust_env`/environment-proxy mounts, an explicit `proxy=` mount
overriding env-derived ones, HTTP/2 and client-cert (`cert=`) propagation
into the transport `AsyncClient._init_transport` silently drops once a
`transport=` is supplied, and the gzip-bomb-aware `_SizeLimitedTransport`
wrapper already in the chain. `SSRFSafeAsyncTransport` pins the connection
to a specific resolved IP by rewriting the request URL's host — a change
that is fundamentally in tension with routing through an HTTP proxy (the
proxy, not this process, needs to resolve and connect to the real
hostname), which this factory explicitly supports both via `trust_env`
env-var mounts and an explicit `proxy=` kwarg. Layering IP-pinning under
proxy support correctly (skip pinning when a proxy mount is active? pin
against the proxy's own address instead? disallow proxy configuration for
these six services outright?) is a design decision this file's checklist
correctly flags as needing, not a mechanical wrap-the-transport change —
and CLAUDE.md's own guidance ("a wrong fix in a payments or permissions
path is worse than an accurate finding") plus this rotation's explicit
instruction to stay conservative on a whole-codebase-blast-radius pass
argue for leaving it flagged with the interaction spelled out, rather than
landing an under-tested change to the transport six integration services
and one audit-shipping path share. **Remains OPEN in `KNOWN_LIMITATIONS.md`,
unchanged disposition, count and mechanism re-verified.** A future PR scoped
_only_ to this change (with its own test matrix covering the proxy/HTTP2/
mTLS interactions above) is the right shape for it, not a line item inside
this sweep.

### Verified good ✅ (pass 5 additions)

- **All 13 established sweep classes hold clean against 485 commits of
  intervening change.** Mechanism: re-run per row above, each against its own
  guard test or a from-scratch AST/grep pass — not a diff against pass 4's
  numbers.
- **The outbound-integration-URL exclusion count is accurate at 7, and the
  reason it grew from 6 is documented and independently verifiable** —
  `documenso_service.py`'s two public methods (`test_connection`,
  `create_document`) both call `_assert_base_url_safe()` before their
  request, confirmed by reading the file directly rather than trusting
  `KNOWN_LIMITATIONS.md`'s own account of the fix.
- **No new site of any of the 13 classes appeared anywhere in the 485
  commits since pass 4**, including in code owned by other rotation
  features — the sweeps here are whole-`app/`/whole-`frontend/src` AST or
  grep passes, not scoped to any one module, so they see a regression
  introduced by any feature's own work, not just this file's stated scope.

## Findings

**0 new findings this pass.** Every established sweep class re-verified
clean; the one open cross-cutting item this pass could plausibly have acted
on (the outbound-URL TOCTOU) was evaluated and explicitly left flagged, for
the reasons above — not silently skipped.

## Schema & migration notes

No migration written this pass. Chain re-validated: 444 revisions, single
head, no duplicate ids, no orphans (`validate_migrations.py --strict`).
`test_set_null_fks_are_nullable` and `test_migration_create_all_tables` both
pass.

## Guard tests added

None. Every invariant this pass re-verified already has a standing guard test
from a prior pass (the table above names each one); this pass found nothing
new to close a class on.

## Completion gate

| Check                                                                                      | Result                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                              | ✅ clean                                                                                                                                                                                           |
| `black --check app/ tests/ alembic/`                                                       | ✅ 1592 files unchanged                                                                                                                                                                            |
| `isort --check-only app/ tests/ alembic/`                                                  | ✅ clean                                                                                                                                                                                           |
| `python3 scripts/validate_migrations.py --strict`                                          | ✅ 444 revisions, single head                                                                                                                                                                      |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                          | ✅ 228 routes checked, 0 errors, 0 warnings                                                                                                                                                        |
| cross-cutting guard tests (backend)                                                        | ✅ 68 + 64 = 132 passed — CSV sweep, `SET NULL`, LIKE escaping, org-scoping ratchet, capacity locking, endpoint-auth coverage, PII cache pin, `create_all`-table tolerance, baseline member grants |
| backend full unit suite (`pytest tests/ -m "not integration and not slow and not docker"`) | ✅ **10158 passed, 1 skipped**, 2412 deselected (the 1 skip is `test_push_service.py`'s optional `py_vapid`/`pywebpush` dependency, pre-existing)                                                  |
| `cd frontend && npm run typecheck`                                                         | ✅ 0 errors (aliased 7.0.2 compiler)                                                                                                                                                               |
| `cd frontend && npm run lint`                                                              | ✅ 0 errors, 0 warnings                                                                                                                                                                            |
| frontend structural guard tests                                                            | ✅ `dialogScrollIntegrity.test.ts` 2/2, `dialogDismissIntegrity.test.ts` 2/2, `testingRegistry.test.ts` 12/12, `mobile-route-integrity.spec.ts` 1/1                                                |

No source files changed this pass — every check above is a re-verification,
not a fix, so there is nothing for a behavior-neutrality diff against
unmodified `HEAD` to compare (unlike pass 1, which added two new tests and
needed one).

---

## Pass 4 (2026-09-08) — re-sweep, PR #2381's prior art re-verified, plus one sweep class new to this file

**Backend:** whole `app/` tree (1521 routes across 79 `app/api/` files; 437
Alembic revisions, single head `b1e7c3a92f45`)
**Frontend:** `frontend/src/utils/apiCache.ts` and the axios clients that
consume it
**Migrations:** none written this pass

### Scope

Read in full: `frontend/src/utils/apiCache.ts` (374 L),
`backend/tests/test_api_cache_pii_exclusions.py` (275 L), `safe_error_detail`
and its neighbours in `app/core/utils.py`, the two handlers named in SEC4-1 /
SEC4-2, `app/core/public_portal_security.py`'s rate-limit caches, and
`app/utils/ssrf_transport.py`.

Swept mechanically (AST or guard test, method stated per row below) rather than
read: the tracker sweep's 25 hits, the JSON shallow-copy sweep's 5 hits, the
`safe_error_detail` sweep's 64 hits, the 15 upload handlers, and the 13
`log_audit_event` payloads naming a PII-shaped key.

**Not read this pass:** the module-level code each rotation feature owns —
that is what features 01–34 are for, and re-reading it here would duplicate
them rather than sweep across them. No verdict below covers a per-module
finding.

### Re-verified standing sweeps

| #   | Class swept                                     | Method                                                                                                                                                                                                                       | Result                                                                                                                                                                                                                                                                 |
| --- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Formula injection in exports (Pitfall #15)      | `grep` for `csv.writer(` / `csv.DictWriter(` outside `csv_export.py`, plus `tests/test_csv_writer_sweep.py`                                                                                                                  | **clean** — 0 sites; guard test passes                                                                                                                                                                                                                                 |
| 2   | `SET NULL` on `NOT NULL` columns (Pitfall #2)   | `test_database_schema.py::test_set_null_fks_are_nullable`                                                                                                                                                                    | **clean** — passes                                                                                                                                                                                                                                                     |
| 3   | Proxy-IP attribution                            | grep `request.client.host`                                                                                                                                                                                                   | **clean** — same 3 hits as passes 1–3 (2 comments, 1 deliberate use inside `get_client_ip`)                                                                                                                                                                            |
| 4   | Alembic chain integrity                         | `backend/scripts/validate_migrations.py --strict`                                                                                                                                                                            | **clean** — 437 revisions (up from pass 3's 399), single head `b1e7c3a92f45`, no duplicate ids                                                                                                                                                                         |
| 5   | LIKE-wildcard handling (Pitfall #25)            | `tests/test_like_escaping.py` (2 guard tests)                                                                                                                                                                                | **clean** — both pass; no new call site dropped `escape=` or re-inlined the transform                                                                                                                                                                                  |
| 6   | `BaseHTTPMiddleware` usage (Pitfall #4)         | `grep -rn "BaseHTTPMiddleware" app/`                                                                                                                                                                                         | **clean** — 0 usages; 7 comments in `security_middleware.py` and 1 in the newer `app/mcp/transport.py` document the ban                                                                                                                                                |
| 7   | Unbounded in-memory trackers (Pitfall #9)       | AST walk for `self.<name> = {}/set()/defaultdict()/OrderedDict()/deque()` and the module-level equivalent, whole `app/` tree, including `ast.AnnAssign` (pass 3's regex-shaped version would have missed the annotated ones) | **clean** — 25 trackers, every one bounded; see below                                                                                                                                                                                                                  |
| 8   | `window.confirm`/`alert`/`prompt` (Pitfall #16) | grep `frontend/src/` excluding tests; confirmed `noBlockingBrowserDialogs` still wired in `eslint.config.js`                                                                                                                 | **clean** — 0 raw calls; the ESLint rule is present                                                                                                                                                                                                                    |
| 9   | JSON shallow-copy-then-nested-mutate (#12)      | grep for `dict(<obj>.<attr>` on model attributes, then read each hit                                                                                                                                                         | **clean** — 5 hits, all top-level key assignment on the copy (which is the correct pattern) or already `copy.deepcopy`                                                                                                                                                 |
| 10  | Org-scoping / IDOR ratchet (Pitfall #14)        | `tests/test_org_scoping_ratchet.py`                                                                                                                                                                                          | **clean** — passes; no new unscoped by-id query on an org-carrying model                                                                                                                                                                                               |
| 11  | Capacity-check locking (Pitfall #27)            | `tests/test_capacity_locking.py`                                                                                                                                                                                             | **clean** — passes; both halves (parent `for_update`, counting read `with_for_update`) still asserted at every site                                                                                                                                                    |
| 12  | Route auth coverage                             | `tests/test_endpoint_auth_coverage.py`                                                                                                                                                                                       | **clean** — 24 unauthenticated handlers under `app/api/v1/endpoints/`, all 24 on the reviewed allowlist, 0 stale entries. Reconciles with pass 3's 69: + 24 `onboarding.py` + 20 `app/api/public/*` + 1 `api.py` root, none of which that test's directory glob covers |

**Sweep 7, in detail, because pass 3 spent nine Codex rounds here.** All 25
trackers are bounded, and the mechanism differs per tracker, so each was
checked rather than pattern-matched: `public_portal_security`'s two
rate-limit caches (`_MAX_RATE_LIMIT_KEYS` 5 000 / `_MAX_IP_RATE_LIMIT_KEYS`
10 000, with `cleanup_rate_limit_cache()` doing stale-then-LRU eviction — and
these are the ones an **unauthenticated** caller keys, so they matter most);
`geoip._ip_cache` (`_cache_max_size` 10 000, drops 1 000 at a time);
`suspicious_ip` (`_MAX_KEYS` 10 000, LRU); `security_middleware._keys` /
`_saturation_reject_until` and `security_monitoring`'s five trackers (capped
by pass 3's own fixes); `mcp/transport._hits` (`_MAX_TRACKED_KEYS` 5 000,
`popitem(last=False)`); `websocket_manager` (`MAX_CONNECTIONS_PER_ORG` 200);
`microsoft_oauth._app_cache` / `_recent_failures` (`_MAX_CACHED_APPS` 16).
The remainder are bounded by construction rather than by a cap, which is a
different claim and is stated as such: `security.py`'s three cipher caches key
on `(encryption key, KDF work factor)`; `microsoft_oauth._registrations` keys
on configured tenant/client; `email_theme._SHELL_COLOURWAYS` keys on a
colourway name; and `notification_rules._cache`,
`storefront_notification_service._templates` and
`salesforce_service.skipped_fields` are **per-instance**, not process-global —
they die with the request or task that made them. None of these can be grown
by a caller.

### New sweep class (first run in this file)

| #   | Class swept                                           | Method                                                                                                                                       | Result                          |
| --- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 13  | Raw exception text reaching the client (checklist §5) | AST walk of every `ast.ExceptHandler` in `app/` whose caught type is broad, looking for the bound name inside an `HTTPException(detail=...)` | **2 findings — SEC4-1, SEC4-2** |

64 sites matched the shape. 62 are custom domain exceptions raised by this
codebase with a curated message — `BudgetLimitExceededError`,
`LastAdministratorError`, `SeparationOfDutiesError`, `PrinterUnreachableError`,
`SalesforceOAuthError` (whose messages are OAuth error _codes_:
`invalid_state`, `missing_client_id`, `token_exchange_failed`),
`ImageValidationError`. Echoing those is the point of raising them, and
`safe_error_detail` would replace a useful sentence with a generic one. The
two exceptions were the two handlers catching bare `Exception` and formatting
whatever came out, both fixed below.

The related shapes were checked and are clean: `except ValueError as e:
detail=str(e)` (the largest group by far) is behaviourally what
`safe_error_detail` does for a `ValueError` anyway, minus the unsafe-pattern
regex and the 300-character cap — worth converging on eventually, but a
mechanical rewrite of ~200 call sites is not a security-review-iteration
change and nothing about it is a live disclosure.

**Also checked, no finding, recorded so it is not re-derived:**

- **Uploads** (checklist §4): 15 `UploadFile` handlers. Every one that stores
  or serves the bytes validates by magic byte (`magic.from_buffer`) rather
  than the client-supplied `Content-Type` — including the two that re-encode
  rather than store the original (`users.py:2239` avatar,
  `storefront.py:733` product image), which magic-check _before_ re-encoding.
  The four that do not magic-check (`inventory.py:1385`, `training.py:1969`,
  `training.py:3220`, `events.py:3481`) parse CSV text that is never stored or
  served, where a magic-byte check has nothing to assert; three of those four
  additionally go through `read_upload_limited`. The `await file.read()` sites are
  **not** an unbounded-buffer finding: `RequestSizeLimitMiddleware`
  (`main.py:2113`, `settings.MAX_REQUEST_BODY_SIZE`) caps the body two ways —
  a Content-Length fast path and a byte-counting `receive` wrapper for a
  chunked upload that lies about it — before any handler reads.
- **SSRF re-validation at send time** (checklist §4): every service that posts
  to a stored URL re-validates it at send (`assert_outbound_url_safe` in
  `webhook_service`, `slack_service`, `discord_service`, `teams_service`,
  `calcom_service`, `audit_ship_service`), and `external_training_service`
  goes further, pinning the connection through `SSRFSafeAsyncTransport`. The
  remaining `httpx` callers target hardcoded hosts (`weather_service`'s NWS
  base, the breached-password and CAPTCHA providers) or provider endpoints
  derived from OAuth config.
- **PII in audit payloads** (checklist §5): 13 `log_audit_event` calls name a
  PII-shaped key. All 13 are cases where the identifier _is_ the subject of
  the audited event — `email` on login/registration/user-admin events,
  `ip_address` on IP-security events, `prospect_email` on a pipeline decision,
  `deleted_full_name` on a user deletion (the row it names no longer exists,
  which is precisely why the audit trail has to carry it). None is incidental.

### PR #2381's prior art, re-verified (the pass-4 action item)

**(a) All six unratcheted genuine fixes are still excluded.**
`/inventory/allowances/check/{user_id}/{category_id}`,
`/inventory/clearances` and `/inventory/requests` by prefix;
`/inventory/items/{item_id}/exposures`, `/.../history` and `/.../issuances`
by substring. Re-derived rather than assumed: each was run back through the
ratchet's own `_is_excluded()`.

**They were, and remained, unguarded** — confirmed by re-running the ratchet's
analysis with the exclusion list ignored. Four of the six carry a
`response_model` whose schema graph names none of `PII_FIELDS`; the other two
(`/inventory/items/{item_id}/history`, `/inventory/requests`) have **no
`response_model` at all**, which puts them in the 141 routes the file's own
docstring says it cannot see. Closed this pass — see SEC4-3.

**(b) The three unratcheted no-ops are still inert**, on both axes PR #2381
identified:

| Route                                                  | Why it was a no-op                                                         | Still true?                                                                                                                                                                                                       |
| ------------------------------------------------------ | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/apparatus/evoc-check/{apparatus_id}/{user_id}`       | apparatus module's own `createApiClient()`, which has no cache interceptor | **yes** — `modules/apparatus/services/api.ts:7` still builds its client from `createApiClient`, and `getCached`/`setCacheIfCurrent`/`isCacheable` are still imported by exactly one file, `services/apiClient.ts` |
| `/inventory/clearances/{clearance_id}`                 | no frontend wrapper on any client                                          | **yes** — no call site references the path                                                                                                                                                                        |
| `/training/instructors/validate/{user_id}/{course_id}` | wrapper on the cached client with zero call sites                          | **yes** — `validateInstructor` appears exactly once in `frontend/src`, its own declaration                                                                                                                        |

**(c) Nothing landed after PR #2381 with either leak shape.** The diff from
`ae423afa` (PR #2381's own commit) to `34e6fa70` touches 10 files under
`backend/app/` and `frontend/src/`, all inventory-grouping or
security-middleware work: one new response field (`group_key`, a grouping
key, no member data), one endpoint whose gate was **tightened**
(`GET /inventory/items/colors`, `get_current_user` → `require_permission("inventory.view")`),
and one new denylist entry. No new GET route, and no new write into a
documents folder or any other shared-audience container — `grep source_type=`
still returns the same two generated-document writers XC-4 accounted for.

## Verified good ✅

- **Every cache exclusion PR #2381 added is still in place**, and the nine
  that no automated check covered now have one (SEC4-3). Mechanism: the pinned
  list runs through the same `_is_excluded()` the ratchet uses, so it tracks
  the real denylist rather than a copy of it.
- **The response cache is reachable from exactly one axios instance.**
  Mechanism: `getCached` / `setCacheIfCurrent` / `isCacheable` are imported
  only by `frontend/src/services/apiClient.ts`; module clients come from
  `utils/createApiClient` and have no cache interceptor. This is what makes
  "no-op today" a defensible verdict for the three routes in (b) — and what
  makes it fragile enough to be worth pinning.
- **All 24 unauthenticated `v1/endpoints` handlers are on a reviewed
  allowlist**, with no stale entries. Mechanism:
  `tests/test_endpoint_auth_coverage.py`, which fails in both directions.
- **All 25 in-memory trackers are bounded.** Mechanism: named per tracker in
  sweep 7 above — a cap plus eviction for the ten that a caller can key, and
  a bounded or per-instance key space for the rest.

## Findings

### SEC4-1 — LOW — SMTP failure text returned verbatim to the caller — ✅ FIXED

**What:** `email_test_results` wrapped `EmailService.send_email` in a bare
`except Exception` and put `str(e)` straight into the 500's `detail`. Every
other error path in this file goes through `safe_error_detail`.
**Where:** `backend/app/api/v1/endpoints/skills_testing.py:3157`.
**Failure scenario:** a training officer (`training.manage`) posts to
`/training/skills-testing/tests/{id}/email-results` while the configured SMTP
host is unreachable or rejecting. `socket.gaierror` renders as
`[Errno -2] Name or service not known: 'smtp.internal.example.org'` and
`smtplib.SMTPAuthenticationError` as `(535, b'5.7.8 Username and Password not
accepted')` — the mail host's name and the provider's own auth-failure
response, returned to the browser. Repeating the call with the endpoint down
is a cheap way to enumerate mail infrastructure.
**Impact:** internal infrastructure disclosure to any holder of
`training.manage`. Not a cross-tenant leak and not reachable
unauthenticated, which is why this is LOW rather than MED.
**Fix:** `safe_error_detail(e, fallback="Failed to send email")` — the real
exception is still logged at ERROR for ops, the client gets the fallback.

### SEC4-2 — LOW — A bare `except Exception` reported internal faults as a 422 with the Python message — ✅ FIXED

**What:** `_validate_config` caught **any** exception from constructing the
integration's Pydantic config model and returned it as
`Invalid config for {type}: {e}` with a 422.
**Where:** `backend/app/api/v1/endpoints/integrations.py:344`.
**Failure scenario:** a `@field_validator` on an integration config schema
dereferences a `None` (a stored config written before a field was added, then
merged into the PATCH validation payload at
`integrations.py:721`: `{**(integration.config or {}), **config}`). The
`AttributeError` — `'NoneType' object has no attribute 'lower'` — is reported
to the client as a validation complaint about their own input. The status is
wrong (a server fault presented as a client error, so it never reaches the
500-rate alerting), and the message is raw Python internals.
**Impact:** internals disclosure to an integrations admin, plus a
misclassified fault that hides a real bug. Low: the caller already holds the
integration-management permission and the message is not another tenant's
data.
**Fix:** narrowed to `except ValidationError` (imported from `pydantic`).
Pydantic's own verdict — which is a statement about the caller's input —
still reaches them unchanged; anything else propagates and becomes a generic 500. Safe to narrow because the config arrives as JSON, so its keys are always
strings and `schema_cls(**config)` cannot raise the `TypeError` the broad
clause would otherwise have been catching.

### SEC4-3 — MED — Nine cache exclusions protecting member PII had no regression guard — ✅ FIXED

**What:** `tests/test_api_cache_pii_exclusions.py` is the only automated check
on `apiCache.ts`'s denylist, and it flags a route only when the route declares
a `response_model` whose schema graph names one of 20 `PII_FIELDS`. Nine of the
18 routes PR #2381 excluded satisfy neither condition, so their exclusion was
held in place by nothing at all.
**Where:** `backend/tests/test_api_cache_pii_exclusions.py` (the gap);
`frontend/src/utils/apiCache.ts:102–104,142,145,152` (the lines with no guard
behind them).
**Failure scenario:** someone tidying the denylist — or resolving a merge
conflict in it, which is a 90-line array that two branches touch — drops
`'/inventory/clearances'`. Every test in the repository still passes.
`GET /inventory/clearances` (who is leaving the department, the separation
type, the notes, and the equipment value still owed) is then held for 30s
fresh / 90s stale in a cache keyed by URL with **no user identity in the key**,
so on a shared station terminal the next member to sign in and open Inventory
is served it. This is the exact shape CLAUDE.md Pitfall #16 describes: an
invariant that held on review discipline until it did not.
**Impact:** MED. No live disclosure today — this is a guard for a fix, not a
fix — but the class it guards is member PII on a shared terminal, and its
absence is silent by construction.
**Fix:** `PINNED_EXCLUSIONS`, a frozen dict of URL → why-it-is-excluded, and
two tests: one asserting each stays excluded (run through the ratchet's own
`_is_excluded`, not a re-implementation), one asserting each still names a
real route so a stale pin has to be deleted rather than left as decoration.
Verified by deleting `'/inventory/clearances'` from `apiCache.ts` and
confirming the suite goes red, naming both affected routes, then restoring it.
The three inert-today routes are pinned alongside the six live ones, for the
reason PR #2381's own write-up gives: the apparatus module can gain a cache
interceptor and a wrapper can gain a caller, and neither change touches this
file.

## Schema & migration notes

No migration written this pass. Chain re-validated: 437 revisions, single head
`b1e7c3a92f45`, no duplicate ids, no orphans (`validate_migrations.py
--strict`). `test_set_null_fks_are_nullable` and
`test_migration_create_all_tables` both pass.

## Guard tests added

| Test                                                                                             | Invariant asserted                                                                                                                            |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `test_api_cache_pii_exclusions.py::test_pinned_pii_routes_stay_excluded_from_the_frontend_cache` | The nine hand-judged cache exclusions the schema scan cannot see stay excluded. Fails with the route URL and the reason it was pinned.        |
| `test_api_cache_pii_exclusions.py::test_pinned_routes_all_still_exist`                           | Every pinned URL still resolves to a v1 GET route, so a renamed or deleted route forces the pin to be re-decided instead of silently rotting. |

## Completion gate

| Check                                             | Result                                                                                                                                                                                 |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                     | ✅ clean                                                                                                                                                                               |
| `black --check app/ tests/ alembic/`              | ✅ 1527 files unchanged                                                                                                                                                                |
| `isort --check-only app/ tests/ alembic/`         | ✅ clean (isort 9.0.1, CI's pinned version)                                                                                                                                            |
| `python3 scripts/validate_migrations.py --strict` | ✅ 437 revisions, single head                                                                                                                                                          |
| backend tests (scoped)                            | ✅ 174 passed — integrations, skills-testing, cache ratchet                                                                                                                            |
| cross-cutting guard tests                         | ✅ 115 passed — LIKE escaping, CSV sweep, org-scoping ratchet, capacity locking, endpoint-auth coverage, `create_all`-table migration tolerance; plus `test_set_null_fks_are_nullable` |
| `tsc --noEmit` / `eslint .`                       | n/a — no frontend source changed this pass                                                                                                                                             |

---

## Out-of-band data-leakage sweep (2026-09-07) — PR #2381, prior art for pass 4

Run as a standalone review between pass 3's completion and pass 4's start,
not as a rotation iteration — so it never occupied `PROGRESS.md`'s **Open
PR** row, and pass 4's Feature 00 iteration would otherwise re-derive both
findings from scratch. Recorded here because this file, not `PROGRESS.md`'s
log, is what Step 2 of the security-review skill actually loads before
reading code.

Two findings, both fixed:

1. **A record written into a shared container inherits that container's
   audience.** `PropertyReturnService.save_as_document` filed a
   property-return report — a departed member's name, home address, and the
   stated reason for the separation — into the organization-visible
   `Reports` documents folder, readable by every `documents.view` holder.
   Fixed: reports now go into a leadership-only `member-separations` folder,
   with a migration relocating existing ones. Full write-up: **XC-4** in
   `docs/module-audit/CROSS-CUTTING.md`.
2. **Member-PII endpoints held in the frontend response cache.**
   `frontend/src/utils/apiCache.ts` added 15 exclusion patterns (11
   prefixes, 4 substrings), which — verified by diffing the full route
   inventory against the old vs. new denylist, not a raw pattern match —
   newly exclude **18 routes** from caching. No module-audit or
   cross-cutting entry documents this finding elsewhere — this section is
   its only prior-art record. For the exact diff, see PR #2381's
   `frontend/src/utils/apiCache.ts` change.

   **Every one of the 18 was individually traced to its frontend caller
   (or lack of one) for this entry** — not sampled — after three rounds of
   Codex review each found more no-ops than the last. Two independent axes
   determine whether an exclusion is a real fix:

   - **Which axios client serves it.** Only `services/apiClient.ts` caches
     GET responses. Anything requested through a module's own
     `createApiClient()` instance (no cache interceptor) was never cached
     regardless of `apiCache.ts`.
   - **Whether any frontend code calls it at all.** A route can have a
     wrapper function in a service file that imports the cached client and
     still have zero call sites — the wrapper itself was never cached
     because nothing invokes it.

   | Outcome                                                              | Count  | Routes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
   | -------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | **Genuine fix** — real call site through the cached `apiClient.ts`   | **10** | `/inventory/allowances/check/{user_id}/{category_id}` (`checkAllowance`), `/inventory/clearances` (`getDepartureClearances`), `/inventory/items/{item_id}/exposures` (`getExposureRecords`), `/inventory/items/{item_id}/history` (`getItemHistory`), `/inventory/items/{item_id}/issuances` (`getItemIssuances`), `/inventory/requests` (`getEquipmentRequests`), `/inventory/reorder-requests` (`getReorderRequests`), `/inventory/return-requests` (`getReturnRequests`), `/inventory/write-offs` (`getWriteOffRequests`), `/operational-ranks/validate` (`validateRanks`) |
   | No-op — apparatus module's uncached `createApiClient()`              | **4**  | `/apparatus/operators`, `/apparatus/driver-exceptions`, `/apparatus/driver-exceptions/approvers`, `/apparatus/evoc-check/{apparatus_id}/{user_id}`                                                                                                                                                                                                                                                                                                                                                                                                                            |
   | No-op — **no wrapper exists at all**, on any client                  | **2**  | `/inventory/clearances/{clearance_id}`, `/roles/{role_id:uuid}/users`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
   | No-op — wrapper exists on the cached client, but **zero call sites** | **2**  | `/inventory/reorder-requests/{request_id}` (`getReorderRequest` — declared, never called; only plural `getReorderRequests` is), `/training/instructors/validate/{user_id}/{course_id}` (`validateInstructor` — declared, never called)                                                                                                                                                                                                                                                                                                                                        |

   **10 genuine fixes, 8 no-ops.** The 8 no-ops still closed nothing today
   — but "no-op today" is not "safe to leave excluded without a guard": the
   apparatus module could gain a cache interceptor, a wrapper could gain a
   caller, or a wrapper could be written for one of the two currently
   wrapper-less routes, and the exclusion would then be doing real work
   with no test asserting it stays in place.

   **Ratchet coverage does not track the genuine-fix/no-op split** —
   `test_api_cache_pii_exclusions.py` only checks `response_model` +
   `PII_FIELDS`, which is blind to which axios client serves a route or
   whether anything calls it. Of the 18, **9 are ratchet-protected**: 4 of
   the 10 genuine fixes (`/inventory/reorder-requests`,
   `/inventory/return-requests`, `/inventory/write-offs`,
   `/operational-ranks/validate`) and, incidentally, 5 of the 8 no-ops
   (`/apparatus/operators`, `/apparatus/driver-exceptions`,
   `/apparatus/driver-exceptions/approvers`,
   `/inventory/reorder-requests/{request_id}`,
   `/roles/{role_id:uuid}/users`). The **9 unratcheted** routes split into
   two different priorities:

   - **6 genuine fixes with no regression guard** — a real leak that would
     reopen silently if its exclusion were ever removed:
     `/inventory/allowances/check/{user_id}/{category_id}`,
     `/inventory/clearances`, `/inventory/items/{item_id}/exposures`,
     `/inventory/items/{item_id}/history`,
     `/inventory/items/{item_id}/issuances`, `/inventory/requests`.
   - **3 no-ops with no regression guard** — inert today, but nothing
     would catch it if that stopped being true:
     `/apparatus/evoc-check/{apparatus_id}/{user_id}`,
     `/inventory/clearances/{clearance_id}`,
     `/training/instructors/validate/{user_id}/{course_id}`.

   Neither set is covered by `api_cache_pii_baseline.txt` either (it lists
   tolerated exceptions, not fixed routes, and is intentionally empty).

**Action for pass 4:** treat both as already-fixed prior art, but do not
read this as limiting the sweep to re-verifying only these named routes —
this file's whole-codebase sweeps re-run against whatever has landed
_since_ PR #2381 too (see `PROGRESS.md`'s "35 iterations per full pass"
note). At minimum: (a) re-verify the 6 unratcheted genuine fixes above are
still excluded, since a regression there is a real leak the ratchet
cannot catch; (b) spot-check the 3 unratcheted no-ops haven't gained a
caller or a cache interceptor, which is lower priority but not zero; and
(c) sweep any endpoint or module-service change landed after PR #2381 for
the same two shapes (shared-container writes, cache-by-default
exclusions) rather than assuming this list is exhaustive going forward.

**Done — pass 4 (2026-09-08), see that section above.** (a) all six still
excluded and all six confirmed still unratcheted, now pinned by
`test_pinned_pii_routes_stay_excluded_from_the_frontend_cache` (SEC4-3, which
pins the three no-ops from (b) as well); (b) all three still inert on both
axes; (c) the post-#2381 diff carries neither leak shape. **Pass 5 should not
re-derive any of this** — re-run the pin test, and sweep whatever has landed
since PR #2387.

## Pass 3 (2026-09-01) — re-sweep, plus four sweep classes new to this file

**Revised same-day after Codex review on PR #2128, round 1:** four P2
findings against this pass's methodology — a too-narrow tracker sweep that
missed a real gap, a too-narrow JSON shallow-copy sweep, a route-auth method
description that dropped a scan root, and a completion-gate command that ran
the wrong TypeScript compiler. All four verified against real code and
corrected below (one produced an actual source fix,
`app/services/security_monitoring.py`; the rest were methodology/doc
corrections with the same zero-finding conclusion holding once properly
re-checked). See each numbered sweep and the completion-gate section for what
changed.

**Revised again, same day, after Codex review round 2 — on the round-1
source fix itself:** Codex reviewed commit `3b6b65e4` (round 1's fix) and
found it was, itself, incomplete in two ways: the eviction it added ran
unthrottled on a real hot path but evicted one key at a time (so a saturated
tracker re-sorted itself on every single subsequent call), and a fifth
tracker (`_external_endpoints`, a `set()`) that the same fix's own
cap-enforcement helper never actually touched. This is the **second round**
of Codex catching a real gap in the same tracker-cap sweep in the same PR —
said plainly rather than undersold. Both fixed; see sweep 7's write-up below
for the full account of both rounds.

**Revised a third time after Codex review round 3 — on the code as it stood at
commit `df7438e0` (round 2's fix, the version live on `main` at the time), and
this round found an actual regression, not just an incomplete fix:**
`self._enforce_key_caps()` ran, on `detect_session_hijack`, **before** the
method read the current session's own prior IP history — so if that exact
session happened to be among the least-recently-active entries the batch
picked for eviction, its history was deleted a few lines before it was read,
the method saw no prior IP, silently treated an ongoing hijack as a
first-ever observation, and never raised the alert. That call-site
placement — before the read — was introduced by **round 1**, commit
`3b6b65e4`, not round 2; round 2 (`df7438e0`) changed only what
`_enforce_key_caps()` does internally (batched eviction), which widened how
many keys a single over-cap call could evict and so widened the odds of the
current key being caught, but did not move the call or introduce the
ordering bug. (This paragraph's own earlier revision — and `PROGRESS.md`'s —
attributed the bug's introduction to round 2 alone; corrected on a later
Codex pass, round 4 — see "Attribution correction" in the round-3 write-up
below.) **PR #2128 had already been merged to `main` (commit `2b3231a3`) by
the time this was caught**, so this regression was live and unfixed on
`main` between the round-2 merge and the follow-up fix landing — see
`docs/security-review/PROGRESS.md` for the timeline and the follow-up PR.
Codex also flagged the count behind sweep 9's "132 distinct
JSON/`MutableDict`-typed model attributes" as still wrong (a regex/line-based
scan that missed multiline `Column(...)` declarations), and a process
conflict in this file's own completion-gate write-up between CLAUDE.md's "fix
every warning, in the same commit" rule and the "8 pre-existing, unrelated"
framing used to wave 8 ESLint warnings through. All three verified against
real code and fixed; see sweep 7's round-3 write-up, the corrected sweep 9
write-up, and the completion-gate section below.

**Revised a fourth time after Codex review round 4 — three more findings, on
the round-3 fix itself and on this file's own historical record:** `_check_
rate_limit` had the identical read-after-evict shape as the three methods
round 3 fixed, missed there because it evicts through a different helper
(`_evict_stale_tracking_keys()`, not a direct `_enforce_key_caps()` call) —
the fourth time in this PR/its predecessor that this exact bug shape has been
found unfixed after a "checked every method" pass. This file's attribution of
the bug's introduction to round 2 was also wrong, per Codex — it was round 1.
And the AST sweep script sweep 9 describes as "checked into
`docs/security-review/`" did not actually exist in the repo. All three fixed;
see sweep 7's round-4 write-up, the "Attribution correction" note in the
round-3 write-up, and sweep 9's corrected script reference below.

Re-verified pass 1/2's five standing sweeps against current code (backend grew
to 399 Alembic revisions, 1536 routes across 80 `app/api/` files, from pass
2's 381 revisions / 1526 routes), and added four sweep classes named in the
rotation's own "typical categories" list that this file had not yet run as an
explicit whole-codebase pass — each is a class CLAUDE.md documents as a
recurring defect, and each is exactly the kind of thing a per-feature
iteration can only ever show "not here" for. This pass does not re-derive pass
1/2's conclusions; it re-checks them against current code and extends
coverage, per the rotation's own rule (`docs/security-review/PROGRESS.md`
line ~4220).

### Re-verified standing sweeps

| #   | Class swept                      | Method                                                               | Result                                                                                    |
| --- | -------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | Formula injection in exports     | `grep` for `csv.writer(` / `csv.DictWriter(` outside `csv_export.py` | **clean** — 0 sites, unchanged                                                            |
| 2   | `SET NULL` on `NOT NULL` columns | `test_set_null_fks_are_nullable` (guard test)                        | **clean** — passes                                                                        |
| 3   | Proxy-IP attribution             | grep `request.client.host`                                           | **clean** — same 3 hits as pass 1/2 (2 comments, 1 deliberate use inside `get_client_ip`) |
| 4   | Alembic chain integrity          | `backend/scripts/validate_migrations.py --strict`                    | **clean** — 399 revisions, single head `4e7e125cb00f`, no duplicate ids                   |
| 5   | LIKE-wildcard handling           | `tests/test_like_escaping.py` (2 guard tests)                        | **clean** — both pass; no new call site reintroduced a raw copy or dropped `escape=`      |

**Route auth coverage re-check (corrected on Codex review — see below):** an
AST walk of every route decorator across **two scan roots**: the 68 files
`api/v1/api.py` imports and registers (derived from its router registrations,
not a directory glob — pass 2's Codex-caught correction), plus the 10 routers
in `app/api/public/` that `backend/main.py` mounts **directly**
(`app.include_router(public_portal_router, ...)` etc. — these are never
imported by `api.py` at all, so a walk scoped to `api.py`'s registrations
structurally cannot see them). `api/v1/api.py` itself is also walked, for the
bare `GET /` root route it defines. This two-root method is what pass 1's
original "whole `app/api/`" directory walk did implicitly; pass 2 preserved it
by scanning `api/v1/endpoints/`, `api/v1/onboarding.py`, and `api/public/` as
three explicit roots; this pass's own prose (before this correction) had
narrowed the _stated_ method to "files registered in `api.py`" and dropped the
explicit second root — the walk's actual output still matched pass 1/2's
totals, but the method sentence no longer supported the conclusion,
[per Codex review](https://github.com/thegspiro/the-logbook/pull/2128#discussion_r3900139059).

Re-running with both roots stated explicitly finds **69 routes with no
`Depends()`-recognized auth dependency**, unchanged from pass 1/2's count but
with one raw hit reclassified and the `public/*` subtotal corrected:

| Bucket                                               |  Count |
| ---------------------------------------------------- | -----: |
| `auth.py` (login, register, OAuth, password reset)   |     14 |
| `elections.py` (token-scoped ballot routes)          |      4 |
| `event_requests.py` (public outreach-request routes) |      4 |
| `events.py` (`GET /events/public-calendar`)          |      1 |
| `salesforce_sync.py` (OAuth callback)                |      1 |
| `onboarding.py` (bootstrap routes)                   |     24 |
| `app/api/public/*` (10 routers, main.py-mounted)     |     20 |
| `api/v1/api.py` (`GET /` root)                       |      1 |
| **Total**                                            | **69** |

The `public/*` figure is **20, not the 22** pass 2/3 had been carrying
forward — verified by direct AST count of every `@router.<verb>` in
`app/api/public/*.py` today (10 files: `calendar`, `display`×3, `finance_
approvals`×3, `forms`×2, `integrations_webhook`×2, `legal`, `paypal_webhook`,
`portal`×5, `salesforce_webhook`, `security_txt` = 20), and it matches pass
1's own original count on this same directory ("20 in `api/public/`" —
see the Pass 1 section below). The "22" was never re-derived after pass 1; it
was carried forward across pass 2 and pass 3 as prose. All 20 are
intentionally public (rate-limited, token-addressed, webhook-signature- or
CAPTCHA-verified) — no genuine gap, same conclusion as pass 1, just a
corrected subtotal.

**One raw AST hit is a false positive, not a finding:**
`app/api/v1/endpoints/inventory.py`'s `@router.websocket("/ws")` (`inventory_
websocket`) carries no `Depends()` in its signature, so a decorator-only scan
flags it. It is not ungated: WebSocket handshakes can't rely on the same
`Depends()`-before-response flow as HTTP routes (the socket must call
`.accept()` first or the browser sees a bare HTTP 403 with no close code), so
this route authenticates **in the function body** — through
`AuthService.get_user_from_token()` against the same access-token-type,
live-session, and expiry checks as every HTTP request, reading the token from
the `access_token` cookie with a query-param fallback for non-browser
clients. Manually confirmed correct; excluded from the 69. This is a
documented blind spot of the AST method going forward: it recognizes auth
expressed as a `Depends()` marker, not auth checked manually in a handler
body, and WebSocket routes are the one place in this codebase that pattern
appears.

Every one of the 69 is confined to the same features pass 1 named: auth (14),
`event_requests.py`'s 4 public routes, `elections.py`'s 4 token-scoped
routes, `events.py`'s public calendar (1), `onboarding.py`'s 24 bootstrap
routes, `salesforce_sync.py`'s OAuth callback, the API root, and the
`public/*` surface (now correctly 20, not 22). **No new ungated route outside
those features**, and the one route the wider method newly surfaced
(`inventory_websocket`) is correctly gated, just not decorator-visible.

### New sweep classes (first run in this file)

| #   | Class swept                                               | Method                                                                                                                                                                               | Result                                                                                                    |
| --- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| 6   | `BaseHTTPMiddleware` usage (Pitfall #4)                   | `grep -rn "BaseHTTPMiddleware" app/`                                                                                                                                                 | **clean** — 0 imports/usages; the 7 hits are all comments in `security_middleware.py` documenting the ban |
| 7   | Unbounded in-memory trackers (Pitfall #9)                 | broadened on Codex review (see below) — module-level _and_ `self.<name> = {}`/`= set()` instance trackers, whole `app/` tree                                                         | **3 gaps found and fixed across two Codex rounds** — see below                                            |
| 8   | `window.confirm`/`alert`/`prompt` (Pitfall #16)           | `grep` for `window.confirm(`/`window.alert(`/`window.prompt(` in `frontend/src/`; confirmed `no-restricted-syntax`'s `noBlockingBrowserDialogs` is still wired in `eslint.config.js` | **clean** — 0 raw calls in source (tests excluded); the ESLint rule is present and active                 |
| 9   | JSON-column shallow-copy-then-nested-mutate (Pitfall #12) | broadened on Codex review (see below) — every JSON/`MutableDict`-typed model attribute (132 names), whole `app/` tree                                                                | **clean** — see below for the corrected method and count                                                  |

**Sweep 7 correction (Codex review):** the original method (`grep` for
module-level `defaultdict(`/`= {}`) cannot find a tracker initialized on
`self` inside `__init__`, and one exists:
[`SecurityMonitoringService`](https://github.com/thegspiro/the-logbook/pull/2128#discussion_r3900139050)
(`app/services/security_monitoring.py`) is a process-wide singleton
(`security_monitor = SecurityMonitoringService()`) whose `__init__` sets
`self._login_attempts`, `self._session_ips`, `self._data_transfers`, and
`self._api_calls` — four `Dict[str, list]` trackers keyed on attacker-
controlled IPs/user ids/session ids. Re-swept with `grep -rn "self\.\w+\s*=\s*
({}\|set()\|defaultdict(\|\[\])"` across the whole `app/` tree (not just
`app/core/`) for anything tracking request/security state; this is the only
additional tracker class found (all other `self.<dict>` hits are per-request
caches scoped to a single request/response cycle, not cross-request state).

Read the file rather than trusting Codex's "happen to be bounded" claim.
All four dicts share one cap (`_MAX_TRACKING_KEYS = 5_000`) enforced by
`_enforce_key_caps()` (evicts the least-recently-active keys first once a
dict exceeds the cap) plus a throttled (≤ once/60s) stale-entry sweep,
`_evict_stale_tracking_keys()`, which calls `_enforce_key_caps()`
unconditionally first. **But two of the four were not actually reached by
either function on the hot path that grows them:** `detect_session_hijack`
(writes `_session_ips` on every request through `security_middleware.py`) and
`detect_data_exfiltration` (writes `_data_transfers`) called neither eviction
function themselves. The only caller of `_enforce_key_caps` /
`_evict_stale_tracking_keys` was `detect_brute_force` — invoked exclusively
from the password `/auth/login` endpoint (`app/api/v1/endpoints/auth.py`) —
and `analyze_request` (the method that wraps the full time-based sweep,
`_check_rate_limit`) is never called anywhere in the app at all, dead code.
For an organization running SSO/OAuth-only (`AZURE_AD_ENABLED` /
`GOOGLE_OAUTH_ENABLED`, no password logins), `detect_brute_force` — and so
every cap on every one of the four dicts — would never fire, and
`_session_ips`/`_data_transfers` would grow without bound for the life of the
process, one entry per authenticated request.

**Fixed** (trivial, low-risk — one line each, mirroring the existing
`detect_brute_force` self-cap pattern): `detect_session_hijack` and
`detect_data_exfiltration` now call `self._enforce_key_caps()` on entry, so
the hard cap on all four trackers is enforced from the same code path that
grows the two previously-uncovered ones, independent of login volume or auth
provider. `tests/test_security_monitoring.py` (10/10) still passes unchanged.

**Round 2 (Codex review on the round-1 fix commit `3b6b65e4` itself):**
Codex reviewed the fix above and found it was, itself, incomplete in two
ways — the second time in this same PR that Codex caught a real gap in this
sweep, worth saying plainly.

1. [**The new hot-path call sorted the entire tracker on every request once
   saturated, not just when the cap was first hit**](https://github.com/thegspiro/the-logbook/pull/2128#discussion_r3900232886).
   `detect_session_hijack` — now calling `_enforce_key_caps()` per the round-1
   fix — runs on every authenticated response through
   `SecurityMonitoringMiddleware.__call__`. The eviction logic computed
   `overflow = len(tracker) - _MAX_TRACKING_KEYS`, sorted the whole tracker by
   last-active timestamp, and evicted exactly `overflow` keys. Once a tracker
   first reached the 5,000-key cap, `overflow` on every later call was 1 (the
   caller's own new key pushed it there again after the previous call's
   single-key eviction), so the full `O(n log n)` sort over ~5,000 entries ran
   on **every** subsequent distinct session — turning a lightweight memory
   safeguard into sustained request-time CPU overhead under exactly the
   sustained distinct-session churn it existed to survive.

   **Fixed:** eviction is now batched. A new class constant,
   `_EVICTION_TARGET_RATIO = 0.9`, means that once a tracker exceeds its cap,
   it is trimmed down to 90% of the cap in one pass (evicting `len - target`
   keys, not just `len - cap`), buying 500 entries of headroom before the sort
   needs to run again — the sort still runs, but roughly once per ~500
   additions instead of once per addition. This is the smaller, safer diff
   consistent with the existing sort-and-evict structure (an alternative —
   `collections.OrderedDict` with `move_to_end`/`popitem(last=False)` for O(1)
   eviction — was considered and rejected as a larger structural change than
   this hot-path fix warrants; the existing dicts are plain `defaultdict`s
   used throughout the file's other logic, and batching gets the same
   amortized-cost outcome without touching that).

2. [**`_external_endpoints` — a fifth tracker, entirely missed by round
   1**](https://github.com/thegspiro/the-logbook/pull/2128#discussion_r3900232889).
   It is a `set()`, not a dict — grown by `detect_data_exfiltration` adding
   every distinct external `destination` seen. Round 1's fix made
   `detect_data_exfiltration` call `_enforce_key_caps()`, but that helper's
   loop only ever iterated the four **dict** trackers
   (`_api_calls`/`_login_attempts`/`_session_ips`/`_data_transfers`); it never
   touched the set. A 200-entry cap for it (`_MAX_EXTERNAL_ENDPOINTS`) did
   exist — in `_evict_stale_tracking_keys()` — but that method's own caller
   (`_check_rate_limit`, reachable only through `analyze_request`) is **never
   invoked anywhere in the running application** (confirmed by grep: the only
   callers of `analyze_request`/`_check_rate_limit` outside the service itself
   are in `tests/test_security_monitoring.py`) — dead code. So the fifth
   tracker could grow unbounded on the exact call path
   (`detect_data_exfiltration`) round 1 had just fixed, for the same
   underlying reason: the broadened sweep pattern documented above
   (`self.<name> = {}`/`= set()`) explicitly includes `set()`, but the fix
   that followed from it was not checked all the way through to "does _this_
   set specifically have an effective, reachable cap" — it has a cap
   constant, which is not the same thing.

   **Fixed:** `_enforce_key_caps()` now caps `_external_endpoints` too, in a
   separate branch (a set has no per-entry activity timestamp to sort
   eviction by, unlike the four dicts — trimmed arbitrarily instead, which is
   sufficient for a coarse memory safeguard), called from the same
   `detect_data_exfiltration()` entry point that already calls
   `_enforce_key_caps()`. The now-redundant capping block inside
   `_evict_stale_tracking_keys()` — dead in practice, per the paragraph above
   — was removed rather than left as unreachable code sitting behind a real
   one.

**Verification, round 2:** every tracker in the file was re-checked against
its actual growth path, not just the two Codex named — `_login_attempts`,
`_session_ips`, `_data_transfers`, and `_api_calls` all resolved correctly to
the batched `_enforce_key_caps()` on their respective hot paths;
`_external_endpoints` was the only additional gap. 4 new tests added to
`tests/test_security_monitoring.py` (`TestTrackerCaps`): batched eviction
drops a saturated dict tracker to the 90% target in one pass (not left
sitting at the cap); sustained one-key-per-call churn past the cap stays
bounded and the sort call count is asserted amortized (not once per
addition); `_external_endpoints` is capped directly via
`_enforce_key_caps()`; and the same is proven end-to-end by calling
`detect_data_exfiltration()` itself repeatedly with distinct destinations —
its actual production growth path, not just the internal helper. All 4
verified to **fail** against the pre-round-2 code (commit `3b6b65e4`,
checked out standalone) and **pass** after the fix; full file 14/14.

**Round 3 (Codex review on the round-2 fix commit `df7438e0` itself — a real
regression, not a gap):** by the time Codex reviewed this, `df7438e0` had
already merged to `main` (PR #2128, merge commit `2b3231a3`), so this was a
live, unfixed bug on `main`, not just an open-PR finding — see
`docs/security-review/PROGRESS.md` for the timeline.

[**`_enforce_key_caps()` ran before the read it was meant to protect, in
both `detect_session_hijack` and `detect_data_exfiltration`.**](https://github.com/thegspiro/the-logbook/pull/2128)
**Round 1** (commit `3b6b65e4`) added the eviction call to the very top of
each method, ahead of the code that reads that method's own tracker for the
current key — round 2 (`df7438e0`) did not move that call; it only changed
`_enforce_key_caps()`'s internal eviction strategy from one key at a time to
a 90%-of-cap batch, which widened how many keys a single over-cap call could
take and so widened the window in which the current key could be caught, but
the ordering itself dates to round 1. (See "Attribution correction" below —
an earlier revision of this section, and of `PROGRESS.md`, credited round 2
with introducing the ordering bug; Codex caught that misattribution on a
later review, round 4.) The eviction picks the least-recently-active keys in
the _entire_ tracker once it is over cap — a decision that has nothing to do
with whether the specific key this call is about to use is "cold" in
absolute terms, only whether it ranks in the bottom slice relative to
whatever else is in the tracker right now. Concretely, in
`detect_session_hijack`, from `3b6b65e4` onward:

```python
# 3b6b65e4 (round 1) onward — WRONG order, unchanged by round 2's df7438e0
self._enforce_key_caps()                       # can delete _session_ips[key]
...
session_data = self._session_ips.get(key, [])  # now reads [] — looks like
                                                 # a brand-new session
if session_data:                                # never enters this branch
    ...                                          # the hijack alert lives here
```

If the victim session's tracker entry is picked in that eviction batch —
plausible under exactly the sustained-churn traffic the cap exists to
survive — the read that follows finds nothing, the method treats a genuine
IP change mid-session as the session's first-ever observation, silently
resets the baseline to the new IP, and **never raises the alert**. This is a
false negative in the literal alerting sense: an attacker riding a hijacked
session is indistinguishable, from this code's perspective, from a session
that has simply never been seen before. `detect_data_exfiltration` had the
same shape one step later — `_enforce_key_caps()` ran before the method built
and summed the current 24-hour transfer window for `user_id`, so an evicted
entry silently reset the running total, understating it and potentially
missing the cumulative-transfer alert.

**Also checked, per the review instruction not to assume only
`detect_session_hijack` was affected: `detect_brute_force`.** It has called
`self._enforce_key_caps()` at the top of the method since the cap was first
introduced (predates round 2), in the same shape — the ip/user key it is
about to append to and threshold-check is exactly the key the eviction batch
can delete first. Fixed for the same reason, even though it was not part of
round 2's diff: CLAUDE.md's "no acceptable pre-existing errors" rule applies
to a bug discovered while editing this file, not only to bugs introduced in
the commit under review.

**Fixed in all three methods by reordering, not by skipping eviction:** each
method now reads (and, for brute-force/exfiltration, appends to and filters)
its own tracker entry for the current key **before** `_enforce_key_caps()`
runs, capturing the result in a local variable so a later dict lookup can't
be quietly answered by a fresh/evicted entry either. `_enforce_key_caps()`
still runs unconditionally on every non-early-return call path — the fix is
purely about ordering within the method, not about calling it less often, so
the cap enforcement guarantee sweep 7 established in round 1 is unchanged.
`detect_session_hijack`'s early-return-on-alert path still runs
`_enforce_key_caps()` before that return (it was moved down to right after
the read, not to the very end), so cap enforcement does not become
conditional on whether this particular call happens to fire an alert.

**Verification, round 3:** 3 new tests in a new `TestReadBeforeEvictOrdering`
class, one per affected method, each reproducing the exact shape of the bug —
fill the tracker above its cap with the victim key as the single oldest
(least-recently-active) entry, drive the call through the real public method
(not the eviction helper directly), and assert the alert that should fire
still does:

- `test_session_hijack_alert_survives_batch_eviction_of_the_victim_session` —
  Codex's exact reproduction: victim session is the oldest of 21 entries in a
  10-key-capped tracker, called with a changed IP; asserts a `session_hijack`
  alert is raised with the correct `previous_ip`/`current_ip`.
- `test_brute_force_threshold_survives_batch_eviction_of_the_attacker_ip` —
  attacker IP already has 2 failed attempts recorded (the oldest entry in an
  over-cap tracker); a 3rd call against a threshold of 3 must still alert.
- `test_data_exfiltration_cumulative_alert_survives_batch_eviction` — victim
  user already has 45MB transferred in the last 24h (the oldest entry in an
  over-cap tracker); a 10MB transfer that alone is under the single-transfer
  threshold but pushes the 24h cumulative total over its threshold must still
  alert, with the correct `total_24h_mb`.

All 3 verified to **fail** against the pre-round-3 code (commit `df7438e0` —
the version that was live on `main` at the time — checked out standalone,
`alert is None` in every case) and **pass** after the reordering fix; full
file **17/17**.

**Attribution correction (round 4, Codex review):** this write-up, and
`PROGRESS.md`'s log entry for round 3, originally credited **round 2**
(commit `df7438e0`) with introducing the read-after-evict ordering bug. Codex
checked the actual commits and that is wrong. Verified directly with `git show
3b6b65e4 -- app/services/security_monitoring.py` and `git show df7438e0 --
app/services/security_monitoring.py`:

- `3b6b65e4` (**round 1**) is the commit that first added
  `self._enforce_key_caps()` to the top of `detect_session_hijack` and
  `detect_data_exfiltration`, ahead of each method's own tracker read — the
  diff adds exactly four lines (the call plus its comment) immediately after
  each method's docstring, before the `now = datetime.now(...)` line that
  starts the read. The ordering bug exists from this commit forward.
- `df7438e0` (**round 2**) touches only `_enforce_key_caps()` itself (adds
  `_EVICTION_TARGET_RATIO` and switches its four-tracker loop from
  evict-one-key-at-a-time to evict-down-to-90%-of-cap) and folds
  `_external_endpoints` capping into the same helper. It does not add, move,
  or otherwise touch the call sites inside `detect_session_hijack` /
  `detect_data_exfiltration` at all — those two methods' diffs in `df7438e0`
  are empty.

So the accurate framing is: **introduced in round 1's commit `3b6b65e4`,
widened in round 2's `df7438e0`** (a larger batch means more keys evicted per
over-cap call, which raises the odds any given current key is among them —
under round 1's one-at-a-time eviction the bug could only bite when the
current key was _exactly_ the single least-recently-active entry at the
moment the tracker first crossed 5,001; round 2's batch widened that to any
of up to ~500 keys per eviction), **fixed in round 3**. Every other place in
this file that referred to the bug's origin has been corrected to this
framing (see the Pass 3 summary above and the round-3 write-up immediately
above this note); `PROGRESS.md`'s round-3 entry is corrected the same way.
Historical PR bodies on #2128/#2132 are left as the record of what was
believed at the time rather than rewritten — this doc-level correction is the
authoritative account going forward.

**Round 4 (Codex review): `_check_rate_limit` had the identical
read-after-evict shape, missed by round 3's "checked every method" pass.**
Counting methods rather than rounds: round 3 found this shape in three
methods at once (`detect_session_hijack`/`detect_data_exfiltration`/
`detect_brute_force`) despite round 1/2 having already touched two of them;
`_check_rate_limit` is the **fourth method** in this file found to carry the
same shape, and round 4 is the **third separate round** in which a Codex
review disproved a prior round's own "checked every method"/"fixed"
completeness claim on this exact bug (round 2 disproved round 1's fix as
incomplete in a different way; round 3 disproved round 1's ordering as
buggy from the start; round 4 disproves round 3's "checked every method"
claim) — worth stating plainly rather than as routine follow-up.

`_check_rate_limit` calls `self._evict_stale_tracking_keys()` (which calls
`self._enforce_key_caps()` internally) as its first statement, before reading
or appending to `self._api_calls[ip]`:

```python
# pre-round-4 — WRONG order, same shape as the three round-3 fixes
self._evict_stale_tracking_keys()  # -> _enforce_key_caps() can delete
                                    #    self._api_calls[ip]
...
self._api_calls[ip] = [ts for ts in self._api_calls[ip] if ts > minute_ago]
self._api_calls[ip].append(now)    # defaultdict silently starts a fresh
                                    # list — the evicted history is gone
if len(self._api_calls[ip]) > threshold:  # now undercounted by however
    ...                                    # many calls were evicted
```

Round 3's own write-up ("Also checked, per the review instruction not to
assume only `detect_session_hijack` was affected") explicitly checked
`detect_brute_force` for this shape and missed `_check_rate_limit`, likely
because `_check_rate_limit` evicts via `_evict_stale_tracking_keys()` — a
wrapper that also runs the throttled time-based sweep — rather than calling
`_enforce_key_caps()` directly the way the other three methods do; a review
grepping for direct `_enforce_key_caps()` calls would not have surfaced it.
Codex reproduced this with a 10-key cap, the victim IP holding 2 prior calls
(the oldest entry in the tracker) toward a 3-call threshold, and 20 newer
filler IPs pushing the tracker over its cap — the buggy order evicted the
victim IP's key before the append, so the request was undercounted as call #1
and no alert fired. This file's regression test reproduces the same shape
(10-key cap, victim IP as the oldest entry, 20 filler IPs) against a
threshold of 2 rather than 3, so the 3rd call (2 prior + this one) exceeds the
threshold under `_check_rate_limit`'s strict `>` comparison: the buggy order
still evicted the victim IP's 2 prior calls before the append, undercounting
the request as call #1 and skipping the `rate_limit_exceeded` alert.

**Fixed the same way as round 3's three fixes:** `_check_rate_limit` now
appends the current call and captures the filtered 1-minute window into a
local variable (`calls`) **before** `_evict_stale_tracking_keys()` runs, and
every subsequent read (the alert's `description`/`calls_per_minute` details,
the threshold check) uses that local variable rather than re-reading
`self._api_calls[ip]`.

**Final exhaustive audit, round 4:** re-read the full file and listed every
method that (a) reads any of the five trackers (`_api_calls`,
`_login_attempts`, `_session_ips`, `_data_transfers`, `_external_endpoints`)
for a specific key, and (b) has an eviction call (`_enforce_key_caps()` or
`_evict_stale_tracking_keys()`) anywhere in its own body — direct or via a
helper it calls. Every call site of either eviction function in the file
(there are 6: one inside `_evict_stale_tracking_keys()` itself, and one each
in `_check_rate_limit`, the success branch of `detect_brute_force`, the
failure branch of `detect_brute_force`, `detect_session_hijack`, and
`detect_data_exfiltration`) was checked against the read(s) in the same
method:

| Method                                | Reads tracker for this call's key                       | Evicts                         | Order                                                      |
| ------------------------------------- | ------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------- |
| `_check_rate_limit`                   | `self._api_calls[ip]`                                   | `_evict_stale_tracking_keys()` | **fixed this round** — read/append captured before evict   |
| `detect_brute_force` (success branch) | none — only overwrites `self._login_attempts[...] = []` | `_enforce_key_caps()`          | order irrelevant — no read to protect (documented in-line) |
| `detect_brute_force` (failure branch) | `self._login_attempts[ip]` / `[f"user:{user_id}"]`      | `_enforce_key_caps()`          | correct since round 3 — read/append before evict           |
| `detect_session_hijack`               | `self._session_ips[key]`                                | `_enforce_key_caps()`          | correct since round 3 — read before evict                  |
| `detect_data_exfiltration`            | `self._data_transfers[user_id]`                         | `_enforce_key_caps()`          | correct since round 3 — read/append before evict           |

Five methods have the read+evict shape; all five are now correctly ordered.
`_external_endpoints` (the fifth tracker) has no per-key read to protect — it
is a `set()` grown by `.add()`, not a dict keyed by request identity, and the
only place it is read is `len()` in `get_security_status` (a count, not a
lookup by key) — so no method reading it "for a specific key" exists; its
eviction (covered in sweep 7's round-2 write-up above) has no ordering hazard
to have. No other method in the file calls either eviction function.

**Verification, round 4:** 1 new test,
`test_rate_limit_alert_survives_batch_eviction_of_the_victim_ip` in
`TestReadBeforeEvictOrdering`, reproducing the same shape as round 3's three
tests. Verified to **fail** against the pre-round-4 code (`alert is None`)
and **pass** after the reordering fix; full file **18/18**.

**Round 5 (Codex review): the round-4 fix protected the read, but nothing
wrote the current call's contribution back into the tracker after eviction
ran — so a key that was evicted while its own call correctly fired an alert
had no baseline left for the very next call.** Round 3/4's fix pattern —
read the current key's tracker entry into a local variable _before_ calling
`_enforce_key_caps()` — correctly stops eviction from corrupting the read a
given call uses to make its own alert decision. It does not stop
`_enforce_key_caps()` from deleting that key's entry from the tracker as
part of its batch. Nothing in the round-3/4 fix re-inserted the entry
afterward, so the round-3/4 fix only ever guaranteed **this call's own
decision** was correct — it said nothing about what the _next_ call from the
same key would find.

Codex reproduced this concretely in `detect_session_hijack`: call 1, with the
session's key as the batch-eviction target, correctly detects the IP change
and fires the `session_hijack` alert (round 4 already guarantees this much).
Call 2, immediately after, from the same session: `None` — no alert. The
method's shape explains exactly why. Its read (the prior IP/timestamp) and
its write (this call's new IP/timestamp) are two separate steps with
`_enforce_key_caps()` running in between, and the write was gated behind "no
alert fired this call" via an early `return alert` on the hijack-detected
path:

```python
# 95db016b (round 4) — detect_session_hijack
session_data = self._session_ips.get(key, [])   # read, before evict (round 3/4 fix)
self._enforce_key_caps()                        # can still delete _session_ips[key]
if session_data:
    ...
    if time_diff < 300:
        ...
        await self._add_alert(db, alert)
        return alert                             # <- returns WITHOUT writing this
                                                   #    call's own (current_ip, now)
self._session_ips[key].append((current_ip, now)) # only reached when no alert fired
```

When the alert fires, the method returns before this call's own IP is ever
recorded — so if `key` was also the eviction target a few lines above, the
tracker ends the call holding **no entry at all** for this session. The next
request from the same hijacked session reads `session_data = []`, is scored
as a first-ever observation, and the alert stream for an ongoing hijack goes
silent immediately after its first (correctly fired) alert — a false
negative on every call after the first, precisely because the first call was
a true positive.

**Checked individually, per the review instruction not to assume the same
reproduction applies everywhere the round-3/4 fix pattern was applied, for
whether `_check_rate_limit`, `detect_brute_force`, and
`detect_data_exfiltration` share this exact gap.** They do not, and the
reason is structural, not incidental: in all three, the read and the write
are the _same_ statement block, executed unconditionally, and that block
runs entirely **before** `_enforce_key_caps()` is called — e.g.
`detect_brute_force`:

```python
self._login_attempts[ip].append(now)                              # write
ip_attempts = [ts for ts in self._login_attempts[ip] if ts > hour_ago]  # read
...
self._enforce_key_caps()                                          # evict runs after
```

Because the write happens first, this call's own key always carries the
freshest timestamp in the tracker by the time `_enforce_key_caps()` runs —
`_enforce_key_caps()` evicts the _oldest_ `N` keys by last-activity
timestamp, and a key that was just written to, this call, cannot be among
them (barring a same-microsecond tie with another key written in the same
call, which does not happen — each call writes at most two keys, `ip` and
optionally `user:{id}`). So the current key can never be evicted by its own
call's eviction pass in these three methods; the round-4 fix's read-before-
write ordering was never actually necessary for them in the way it is for
`detect_session_hijack`, and there is no "call 1 alerts, call 2 finds no
baseline" sequence to reproduce. Verified empirically, not just reasoned
about: `git stash`-ing the round-5 source fix and running the new regression
tests (below) for all three against commit `95db016b` — they **pass
unmodified**; only the `detect_session_hijack` test fails.

**Fix applied to all five (write-after-evict), even though only one was
empirically exploitable — write-after-evict chosen over excluding the
current key from eviction, and here is why:** two ways to close the gap.
(A) After `_enforce_key_caps()` runs, always write this call's own
contribution into the tracker — restoring the entry if eviction removed it,
extending it otherwise — so the tracker provably ends every call holding a
live entry for the calling key regardless of what eviction just did. (B)
Exclude the current call's key from the eviction candidate set entirely, so
it can never be picked no matter how stale it looked going in.

(B) was considered and rejected for this tracker shape specifically, not
picked-against by default. The caution against it is for a tracker where one
attacker can cheaply mint many _distinct_ keys and hammer through them to
starve out the cap (a bloat/DoS angle) — excluding "whichever key is active
right now" from eviction would still let that attacker's flood evict
everyone else's legitimate entries while contributing nothing evictable
itself. That does not describe these five trackers: every key here already
is one attacker-controlled identity (an IP, a session id, a user id) — there
is no cheaper "distinct sub-value" underneath a key for an attacker to
churn — so excluding _the one key this call is actively using_ from this
call's own eviction pass costs nothing: it is exactly the key CLAUDE.md
pitfall #9's cap exists to eventually evict once it truly goes idle, and one
call's temporary exclusion does not stop that from happening on a later,
quieter call once other keys have taken its place among the oldest.
Excluding it would have worked, and would have been fewer lines.

Write-after-evict (A) was chosen anyway, for two reasons specific to this
file's actual history rather than as a generic default: first, it is the
same shape already applied to `_check_rate_limit` / `detect_brute_force` /
`detect_data_exfiltration` (write happens, then evict) — restructuring
`detect_session_hijack` to write-after-evict makes all five methods follow
one uniform read/evict/write ordering, rather than four methods doing
write-then-evict and a fifth doing evict-then-write-with-exclusion, which is
exactly the kind of asymmetry that let this bug hide in one method while the
others were "checked" in three prior rounds. Second, and the more direct
reason: this file has now needed the _same_ tracker-cap logic corrected
across five consecutive review rounds (see the closing note below) — adding
a second distinct mechanism (exclusion) alongside the first (read-before-
write) for the _same_ underlying invariant is one more shape for the next
review to have to hold in its head and re-verify empirically per method,
which is exactly what round 5 had to do here to find that only one of five
methods actually needed it. One mechanism, applied uniformly and provably,
was judged worth the few extra lines in the three methods that did not
strictly need it.

`detect_session_hijack` no longer returns early on the alert path; it always
rebuilds `self._session_ips[key]` from the pre-eviction `session_data` plus
this call's own `(current_ip, now)`, trimmed to the last 10 entries, and
returns the alert (or `None`) at the end. This closes one of the bugs the
early return combined: the tracker losing the entry to eviction. **The second
half of this paragraph's original framing — that leaving a hijacked session's
"last known IP" at its pre-hijack value was itself "a real correctness gap,"
and that the fix should compare against "the attacker's actual most recent
IP" instead — is superseded by round 6 and round 7 below, and was wrong.**
Preserving the pre-hijack IP as the comparison baseline is the _correct_
behavior for the alert-firing path; round 5's own fix, by writing
`current_ip` (the attacker's IP) back unconditionally, is precisely what
round 6 found and reverted (an alerting attacker IP got silently promoted to
"trusted," so a repeat attack from the same IP stopped alerting after its
first hit). See the round-6 write-up below for the corrected mechanism, and
round 7 (further below) for a related timestamp-only bug in that same
corrected code. This note corrects the account in place rather than deleting
it, per this rotation's own established practice (see the round-4
"Attribution correction" note above) — the sentence above is left as the
record of what round 5 believed at the time; it was not shipped as-is
(round 6 caught and reverted the actual code before this branch merged), but
the write-up's reasoning was wrong and must not be read as current guidance.

**Verification, round 5:** 4 new tests in a new `TestWriteAfterEvictOrdering`
class — one per affected method, each driving **two** calls in a row (call 1
puts the key up for batch eviction and correctly fires its alert; call 2
immediately after asserts the tracker still has a live baseline and detects
the continuing activity, not a fresh first observation), plus a **third**
call in the `detect_session_hijack` test specifically (three IP changes in a
row) to confirm the fix generalizes past the exact two-call shape Codex
reproduced rather than special-casing it. `test_session_hijack_detects_a_
second_and_third_ip_change_in_a_row` fails against commit `95db016b` (call 2
returns `None`) and passes after the fix; the other three
(`_check_rate_limit`, `detect_brute_force`, `detect_data_exfiltration`) pass
against `95db016b` unmodified, as the empirical check above found, and
continue to pass after the fix — they stand as regression guards against a
_future_ refactor reintroducing the same early-return-before-write shape
that broke `detect_session_hijack`, not as reproductions of a bug that was
ever live in those three. Full file **22/22**.

**Five review rounds on the same tracker-cap logic, in one PR/its
predecessor — worth stating plainly rather than folding into routine
follow-up, because it is information about how much to trust the next "0
gaps found" claim on this exact code:** round 1 added eviction but only
one-key-at-a-time and missed `_external_endpoints`; round 2 fixed both of
those but introduced the read-after-evict ordering bug across two methods;
round 3 fixed that ordering in three methods (missing a fourth,
`_check_rate_limit`, because it evicts through a different wrapper); round 4
found and fixed the fourth method, and explicitly re-audited all five
eviction call sites against all five tracker reads — the audit table in that
round's write-up above lists all five as "correctly ordered" — and still
missed that read-before-write does not imply write-after-evict; round 5
fixed that. Every prior round's "checked every method, all fixed" framing
turned out to be narrower than it read, in a different way each time. That
pattern, not any single round's fix, is the fact worth a future reviewer
weighting: a review of this file's tracker-cap code that reaches a clean
result is worth substantially less evidentiary weight here than the same
result on code with no such history, and is exactly the place to look
hardest for one more angle rather than accept "audited all five, all
correct" at face value — round 4 wrote almost that exact sentence and was
still short one fix.

**Round 6 (Codex review): round 5's write-after-evict fix wrote the
_attacker's_ IP back as the trusted baseline on the alert path itself,
silencing every repeat of the same attack after its first (correctly fired)
alert.** This is a distinct bug from the eviction-ordering class fixed in
rounds 3–5 above — it is not about a key being evicted at the wrong moment,
it fires on every call regardless of eviction — but it lives in the exact
same few lines round 5 just rewrote, so it belongs in this file's ongoing
account of that code rather than as an unrelated footnote.

**Origin, verified against git history rather than assumed: this is new in
round 5, not a pre-existing gap the eviction-fix rounds' scrutiny happened to
surface.** Every version of `detect_session_hijack` before commit `90e373cc`
— the original pre-PR-#2128 implementation, and every round-1-through-4
revision — `return`s immediately inside the "IP changed within 5 minutes"
branch, before the method ever reaches the line that writes `current_ip` into
the tracker:

```python
# every version before 90e373cc (round 5)
if time_diff < 300:
    alert = SecurityAlert(...)
    await self._add_alert(db, alert)
    return alert                              # <- exits BEFORE the write below
self._session_ips[key].append((current_ip, now))
```

So on every call that fired an alert, in every version of this method before
round 5, the attacker's IP was never written back at all — the tracker kept
whatever pre-hijack entry it already had, which is why a genuine attack
already alerted correctly on repeat use _before_ round 5 touched this code
(confirmed by reading `95db016b`, the round-4 revision, directly: same early
return, same effect). Round 5's fix (documented above) removed that early
return specifically to close the write-after-evict gap — the tracker must
always end a call holding a live entry, alert or not, so a key evicted at the
exact moment its alert fires does not lose its baseline. That part of the fix
was correct and necessary. But the replacement write used `current_ip`
unconditionally:

```python
# 90e373cc (round 5) — detect_session_hijack, unconditional write
self._session_ips[key] = (session_data + [(current_ip, now)])[-10:]
```

which on the alert path writes the _attacker's_ IP as the newest (and, since
the comparison only ever looked at `session_data[-1]`, the _only_ IP that
matters for the next comparison) entry. The next request from that same
attacker IP then compared its own IP against itself, found no change, and
returned `None` — an ongoing hijack detected exactly once, then silent, for
as long as the attacker kept reusing the one IP. Round 5's own regression
test (`test_session_hijack_detects_a_second_and_third_ip_change_in_a_row`)
did not catch this because it drives three _distinct_ attacker IPs
(`9.9.9.9` → `8.8.8.8` → `7.7.7.7`), each different from the one before, so
every comparison still finds a mismatch regardless of the promotion bug — the
repeat-IP case Codex's review flagged was simply never exercised.

**Fix: split "the full observed-IP log" from "the IP a hijack decision is
compared against."** A new tracker, `_session_trusted_ip` (declared beside
`_session_ips` in `__init__`, capped and swept the same way, read before
`_enforce_key_caps()` and written after it for the same reason as every other
tracker in this file), holds only the single IP/timestamp pair the next call's
comparison is made against. `_session_ips` keeps its existing role unchanged
— a full per-call audit log, including attacker IPs, retained for forensics —
but is no longer what the hijack decision reads. The trusted tracker is
advanced to `current_ip` whenever this call does _not_ fire an alert (first-
ever observation, a matching IP refreshing its timestamp, or an IP change
slow enough — ≥ 5 minutes — to not be flagged as suspicious, which was already
this method's own definition of "not suspicious"); when an alert _does_ fire,
the trusted tracker is deliberately left at its pre-alert value instead, so
the alerting IP is never promoted. This is the minimal fix that satisfies
Codex's framing directly: distinguish the trusted baseline from the most
recently observed IP, without inventing a new "confirmed hijack" state
machine — the existing 5-minute suspicion window already does the work of
deciding when a changed IP is legitimate enough to become the new normal;
the only change is that an alert-firing IP no longer qualifies by default.

**Verified by hand-tracing the full method, not just the reported
repro, for all four steps of a realistic sequence** (trusted IP `A`, attacker
IP `B` fires an alert, `B` repeats, then legitimate `A` returns):
step 1 (`A`, first-ever observation) sets the trusted baseline to `A`, no
alert; step 2 (`B`, within 5 minutes) compares against `A`, mismatches, fires
the alert, and leaves the trusted baseline at `A` (not promoted to `B`); step
3 (`B` again) compares against the still-unchanged `A`, mismatches again, and
fires a **second** alert for the same repeat attacker IP — the exact
behavior Codex's review asked for; step 4 (`A` again) compares against the
still-unchanged `A`, matches, and does **not** alert — `A`'s return is not
mistaken for a hijack just because `B` was observed in between, since `B`
was never written into the comparison baseline at any point in the sequence.

**Verification, round 6:** `TestSessionHijackTrustedBaseline`, 2 new tests —
`test_repeated_attacker_ip_keeps_alerting` (the exact 3-call sequence from
Codex's review comment: trusted IP, attacker IP alerts, same attacker IP
alerts again) and `test_legitimate_ip_returning_after_attacker_ip_does_not_
alert` (the 4-step trace above, asserting the legitimate IP's return does not
false-positive). Both verified to **fail** against commit `90e373cc` (the
third/fourth call returns `None` where an alert/no-alert was expected) and
**pass** after the fix. The existing round-5 regression test
(`test_session_hijack_detects_a_second_and_third_ip_change_in_a_row`) had its
assertions updated: it drives three _distinct_ IPs, none of which are ever
promoted under the fix, so every one of the three alerts now correctly
reports `previous_ip` as the original pre-hijack IP (`"1.1.1.1"`) rather than
the immediately preceding call's IP as it did against `90e373cc` — the old
assertions encoded exactly the promotion behavior this round removes, so
updating them (not merely re-running them) was necessary; both the two
`TestReadBeforeEvictOrdering`/`TestWriteAfterEvictOrdering` session-hijack
tests were also updated to seed the new `_session_trusted_ip` tracker
alongside `_session_ips`, since that tracker — not the tail of `_session_ips`
— is what the comparison now reads. Full file **24/24**. The session-hijack
coverage in `test_security_middleware.py` is unaffected — it mocks
`detect_session_hijack` at the service boundary, not the tracker internals.

**Round 7 (Codex review): round 6's fix kept the trusted IP pinned correctly
on the alert path, but left the trusted entry's TIMESTAMP unrefreshed — which
the method's own 5-minute leniency check reads, and that gap is a time-based
bypass of round 6's fix.** `_session_trusted_ip[key]` stores a
`(ip, timestamp)` pair; round 6 (correctly) stops the alert path from
advancing the `ip` half to the attacker's IP, but left the `timestamp` half
as `last_time` — the timestamp of whenever the trusted IP was last
_confirmed_-good — unchanged on that same path:

```python
# 56620c9e (round 6) — detect_session_hijack, alert path
new_trusted_ip = last_ip
new_trusted_time = last_time          # <- not refreshed; this is the bug
```

That stored timestamp is exactly what the next call's leniency check reads:

```python
if last_ip != current_ip:
    time_diff = (now - last_time).total_seconds()
    if time_diff < 300:               # suspicious -> alert
        ...
    # time_diff >= 300 -> falls through to the DEFAULT path, which
    # promotes current_ip (the attacker's) as the new trusted baseline
```

Under continuous attacker traffic, `last_time` stays pinned to the pre-hijack
confirmation while real wall-clock time keeps advancing on every subsequent
attacker call. `time_diff` is computed against that same stale, unrefreshed
timestamp on every call, so it grows monotonically with real elapsed time —
and once it crosses 300s (which it eventually will, purely because time has
passed, regardless of how many attacker requests occurred in between), the
`time_diff < 300` branch stops matching. Control falls through to the
_default_ path at the top of the method (`new_trusted_ip = current_ip`),
which silently promotes the attacker's now-longstanding IP to trusted, with
no alert — the exact "IP changed but it's been a while, probably roaming"
leniency that exists for a session that genuinely went idle, wrongly
triggered by a session that has been under continuous, uninterrupted attack
the entire time. This is a distinct bug from round 6's: round 6 was about the
`ip` half of the stored pair being wrongly advanced; round 7 is about the
`timestamp` half being wrongly held still, and it fully bypasses round 6's
fix given enough elapsed wall-clock time — the trusted `ip` never gets
directly overwritten by the attacker's, but the leniency's own arithmetic
gets there indirectly.

**Fix: refresh the trusted entry's timestamp to `now` on every call, alert or
not — while still leaving the trusted `ip` unchanged on the alert path (round
6's fix, unmodified).**

```python
new_trusted_ip = last_ip
new_trusted_time = now                # refreshed; ip still pinned to last_ip
```

This makes the stored timestamp mean "the last time this session was
evaluated, by any IP" rather than "the last time the trusted IP was
confirmed-good." The next call's `time_diff` therefore measures the gap since
_this_ call, not since the session's last idle period ended (if it had one).
A session under continuous attack never accumulates elapsed time toward the
leniency window, because every attacker call resets the clock the very same
call it fails to earn promotion on. A genuinely idle session — no calls at
all, from anyone, for 5+ minutes — still earns the leniency exactly as
before, because nothing refreshes the timestamp during a gap with no calls to
refresh it.

**Three scenarios hand-traced end-to-end, not just the reported repro:**

1. **Attacker persists (the bypass this round fixes):** trusted IP `A`
   confirmed at `t=0`. Attacker IP `B` alerts at `t=0` (compares against `A`,
   `time_diff` small, alerts; trusted stays `(A, t=0)` under round 6, refreshes
   to `(A, t=0)`→`(A, now)` under this fix). `B` continues once a minute
   through `t=10min`: under the pre-round-7 code, `time_diff` is measured
   against the _original_ `t=0` and crosses 300s at `t=5min`, silently
   promoting `B` from that point on — every call from `t=5min` onward goes
   unflagged. Under the fix, `time_diff` is measured against the _previous
   call's_ timestamp (refreshed every time), stays at ~60s on every call, and
   every single one of the ten calls alerts. Legitimate `A` returns at
   `t=11min`: matches the still-preserved trusted `A`, no alert.
2. **Legitimate idle-then-return (the leniency's original purpose,
   confirmed not broken by this fix):** trusted `A` confirmed at `t=0`, then
   _nothing at all_ touches the session — no attacker, no legitimate
   activity — for 10 minutes. At `t=10min`, the same user returns from a new
   IP (a genuine network change). `time_diff` against the unrefreshed `t=0`
   timestamp is 600s, `>= 300`, leniency applies, no alert, and the new IP is
   promoted to trusted. This path is untouched by the fix — nothing refreshes
   the timestamp during a gap with no calls, by construction — so the
   original "probably just roaming" case still works.
3. **Round 6's original 4-step trace (re-confirmed still correct under this
   fix):** trusted `A` → attacker `B` alerts (`A` stays trusted, timestamp
   refreshes) → `B` again, still within a short gap (alerts again, `A` stays
   trusted, timestamp refreshes again) → legitimate `A` returns (matches the
   still-preserved `A`, no alert). Identical outcome to round 6's trace; the
   only change is that the _timestamp_ half of the stored pair moves on every
   step now, which is invisible to this trace because every gap here is
   already well under 300s regardless.

**Verification, round 7:** new `TestSessionHijackLeniencyWindow` class, 2
tests, in `backend/tests/test_security_monitoring.py`:
`test_continuous_attacker_traffic_never_earns_the_leniency_window` drives one
legitimate call followed by ten attacker calls spaced one (simulated) minute
apart, asserting every one of the ten still alerts, that the trusted baseline
is still the legitimate IP afterward, and that the legitimate IP's return at
`t=+11min` does not alert; `test_genuinely_idle_session_still_gets_the_leniency_on_return`
asserts the original idle-then-roam case (a 10-minute gap with _no_ calls at
all) still does not alert. Simulated time is driven by a small `_FrozenClock`
helper plus a `datetime` subclass monkeypatched over
`app.services.security_monitoring.datetime` (this project has no `freezegun`
dependency; the existing session-hijack tests instead seed tracker dicts
directly with past timestamps, which does not fit this scenario's need to
control several successive calls' `now` independently). Verified directly:
`git stash`-ing this round's one-line source fix (`new_trusted_time =
last_time` restored) and running the new leniency-window test against commit
`56620c9e` — it **fails** at the `t=+5min` call specifically (`alert is
None`), matching the hand-traced mechanism above exactly (300s = 5 × 60s);
**passes** after the fix. Full `test_security_monitoring.py` **26/26**, up
from 24.

**Seven review rounds on this file's session-hijack tracking now, across two
PRs — the seventh straight round to find something in this exact method, each
a genuinely different shape** (missing eviction, one-key-at-a-time eviction,
read-after-evict, a fourth method with the same read-after-evict shape,
write-after-evict, a semantic bug in what write-after-evict wrote, and now a
time-based path around that same semantic fix). The caution stated in rounds
4, 5, and 6 — that a clean result on this exact code is worth less
evidentiary weight than elsewhere, and is exactly where to look hardest for
one more angle — is carried forward again rather than treated as satisfied by
this round's fix.

**Sweep 9 correction, round 3 / round 8 overall (Codex review): the AST
walk matched only the literal identifier `JSON`, missing a custom-named
type that wraps it — on the one JSON-shaped column holding PHI.** Codex
reviewed commit `dc152491` (round 7's write-up-only follow-up) and found
that `backend/scripts/json_column_ast_sweep.py`'s `_call_references_json`
checked a `Column(...)` call's argument subtree for a `Name`/`Attribute`
node literally spelled `JSON` — which finds `Column(JSON, ...)` and
`Column(MutableDict.as_mutable(JSON), ...)` (any depth of wrapping, per the
round-4 write-up above) but not a _different_ type name whose underlying
storage is JSON. `app/models/medical_screening.py`'s
`MedicalScreening.result_data = Column(EncryptedJSON, ...)` is exactly
that case: `EncryptedJSON` (`app/core/encrypted_types.py`) never spells
`JSON` anywhere in the `Column(...)` call, so the sweep's `--list` output
silently excluded `result_data` and the **179 distinct names, 230
declarations, 43 files** figure everywhere in this doc and in
`backend/scripts/README.md` was not actually complete — one JSON-shaped
column, and specifically the medical-screening PHI one, had never been
covered by sweep 9's bug-detection pass at all.

**Investigated `EncryptedJSON` before extending the sweep, rather than
hard-coding the name in:** it is a `TypeDecorator` (`impl = Text`) in
`app/core/encrypted_types.py`, alongside `EncryptedText` (the only other
custom `Column(...)` type anywhere in `app/models/*.py` — confirmed by an
AST pass over every `Column(...)` call's first-argument identifiers across
all 43 model files, not just a grep for the two known names). Its
`process_bind_param` does `encrypt_data(json.dumps(value))` on write and
`process_result_value` does `json.loads(decrypt_data(value))` on read (with
an `InvalidToken` fallback for legacy plaintext rows, matching
`EncryptedText`'s backward-compatibility contract) — so the mapped Python
attribute is a genuine JSON-able object (dict/list), identical in shape to
what a bare `Column(JSON)` attribute holds. Critically, `EncryptedJSON` is
**not** wrapped in `MutableDict.as_mutable(...)` anywhere it's used — a
`TypeDecorator`'s bind/result processing is invisible to the ORM's
attribute-level dirty-tracking layer, which instruments the _mapped
attribute_, not the column type, so wrapping `Text` instead of `JSON` at
the type level changes nothing about how SQLAlchemy tracks changes to the
Python value. That makes `result_data`'s mutation semantics exactly the
**bare** `Column(JSON)` case pitfall #12 opens with (no in-place-mutation
tracking at all — a plain `MutableDict.as_mutable(JSON)` column at least
auto-detects top-level key reassignment, and `result_data` gets none of
that either), and therefore exactly as exposed to the
shallow-copy-then-reassign bug as any other name on this sweep's list.
`EncryptedText` is deliberately _not_ added to the sweep's type-name set:
it wraps `Text` and stores a scalar string, not a JSON value, so it carries
no shallow-copy risk to check for.

**Fix — extended, not hard-coded:** `json_column_ast_sweep.py` now matches
against a `JSON_LIKE_TYPE_NAMES` frozenset (`{"JSON", "EncryptedJSON"}`,
each entry commented with why it's included) instead of the literal string
`JSON`, so a future third JSON-wrapping type is one name added to a
documented set rather than a second special case. The AST walk's structure
is otherwise unchanged (still walks the full argument subtree, so
`Column(MutableDict.as_mutable(JSON), ...)`-style nesting of a future
custom name would also still be found).

**Corrected count, re-run against current `app/models/*.py`: 180 distinct
attribute names, across 231 `Column(...)` declarations, across the same 43
files** (up from 179/230 — the single new name is `result_data`,
`medical_screening.py:183`; the file count is unchanged because
`medical_screening.py` was already counted, for `EncryptedText` and its own
`JSON`-typed attributes). Re-ran `--list` before and after the fix and
diffed: the only change is `result_data`'s addition, confirming the fix
didn't also pick up an unrelated false positive from the broadened name
set.

**Re-ran the shallow-copy-then-reassign bug-detection pass (b) against
`result_data` specifically**, whole `app/` tree: grepped for
`dict(...)`/`{**...}`/`.copy()`/`.setdefault(...)` idioms referencing
`result_data` (zero hits) and traced every direct `.result_data =`
reassignment by hand (two sites, both in
`app/services/medical_screening_service.py`): `create_record` passes
`result_data=data.result_data` straight into the `ScreeningRecord(...)`
constructor on a row that is about to be `db.add()`-ed (a new insert — no
prior committed value to alias against, and the value is the freshly
deserialized Pydantic payload, never derived from `self`'s own column);
`update_record` routes through `apply_updates(record,
data.model_dump(exclude_unset=True))`, which does a plain `setattr` of a
value taken directly from the incoming payload dict — never `dict(record.
result_data)`-then-mutate, so there is no shared nested reference between
the old committed value and the new one being written. (The bulk
`update(ScreeningRecord).values(result_data=None, ...)` calls in
`member_anonymization_service.py` are SQL-level `UPDATE` statements, not
ORM-instance mutation, and set the column to a scalar `None` — outside
this bug's shape entirely.) A third file
(`training_enhancement_service.py`) has a local variable also named
`result_data` (an xAPI statement's `"result"` object, parsed from a
webhook payload) that is unrelated to this column — confirmed by reading
the function: it is never assigned to a `ScreeningRecord` and the file
does not import that model. **Clean — 0 bugs found in `result_data`**;
no other name was newly added by this round's fix, so no further sites to
check. `EncryptedJSON`'s absence of any mutation-tracking (not even
`MutableDict`'s top-level auto-detection) makes a future direct
`record.result_data["key"] = value` in-place mutation with no reassignment
at all a live risk if one is ever written — worth naming for the next
reviewer, since nothing in the type stops it, but not a finding against
code that exists today.

**Sweep 9 correction, round 2 (Codex review):** Codex re-checked round 2's
own correction to this sweep (immediately below) and found the "132 distinct
JSON/`MutableDict`-typed model attributes" figure was itself produced by a
regex/line-based scan (`name = Column(JSON, ...)` matched per source line),
which cannot see a multiline declaration such as

```python
report_email_recipients = Column(
    JSON, ...
)
```

— the assignment target and the `JSON` reference land on different lines, so
a line-anchored regex never associates them. This is the same "the method was
narrower than the write-up claimed" shape as sweep 9's round-1 correction
below (two directories instead of the whole tree that time; single-line
declarations only, this time) — worth naming plainly, since it is the
**third** time this exact sweep's method has needed correcting in this PR.

Re-swept with a structural method instead:
[`backend/scripts/json_column_ast_sweep.py`](../../backend/scripts/json_column_ast_sweep.py)
parses every `backend/app/models/*.py` file with the `ast` module and walks,
for every `ast.ClassDef`, that class's direct-body `ast.Assign`/`ast.AnnAssign`
statements whose value is a `Call` named `Column` — checking whether `JSON`
appears anywhere in that call's argument subtree via a recursive `ast.walk`,
which is what makes `Column(MutableDict.as_mutable(JSON), ...)` match
identically to a bare `Column(JSON, ...)` regardless of how deep the wrapping
nests, not a substring match on one line. Because this walks the parsed
syntax tree rather than source lines, a multiline declaration is included
exactly like a single-line one; nothing about the walk depends on how the
declaration happens to be formatted.

**Round 4 correction (Codex review):** an earlier version of this section
claimed this script was "checked into `docs/security-review/`" — it was not;
no such file existed anywhere in the repo (confirmed via `git ls-tree` /
`rg --files` / `find` at the time, and by this file's own prior text never
actually linking to one). The script now exists at
`backend/scripts/json_column_ast_sweep.py` — alongside the project's other
verification scripts (`backend/scripts/validate_migrations.py`,
`verify_database_enums.py`, etc.) rather than under `docs/`, matching where
every other runnable sweep tool in this codebase lives — and is documented in
`backend/scripts/README.md`. Run it with:

```bash
cd backend
python3 scripts/json_column_ast_sweep.py            # prints the summary line
python3 scripts/json_column_ast_sweep.py --list      # every name + location
python3 scripts/json_column_ast_sweep.py --by-file   # grouped by model file
```

which reproduces the **179 distinct names, 230 declarations** figure below
exactly, on demand, rather than requiring a future reviewer to re-derive the
AST-walking method from this prose. **Superseded by the round-8 entry
above: the script's own type-name matching was itself incomplete (matched
only the literal `JSON` identifier, missing the custom `EncryptedJSON`
type on the medical-screening PHI column), so re-running it today prints
180/231, not 179/230.**

**Corrected count (at the time of this round): 179 distinct attribute
names, across 230 `Column(...)` declarations that reference `JSON`** (some
names — e.g. templated columns
repeated across a handful of models — account for more than one
declaration) — up from the 132 previously claimed, an increase of 47. A
naive single-line regex re-run for comparison (`^\s*(\w+)\s*=\s*Column\(.*
JSON`) found 137 names on the current tree, missing 42 of the AST method's
179 — the exact multiline shape above, spread across 26 files (`compliance_
config.py`'s `report_email_recipients`, `training_programs.py`'s `co_
instructors`/`prerequisite_program_ids`, `event_requests.py`'s `assigned_
members`/`required_positions`/`recurrence_exceptions`, and 39 more). The
132-vs-137 gap between the previously-claimed figure and this regex baseline
is not reconciled here — likely a slightly different ad hoc pattern used the
first time — but is moot: the AST walk is now the authoritative, structural
method, checked into `backend/scripts/json_column_ast_sweep.py` (see the
round-4 correction above) rather than re-derived by hand each round.

Re-ran the actual bug-detection sweep — nested bracket mutation (a) and
shallow-copy-then-reassign (b) — against the **full corrected 179-name
list**, whole `app/` tree. (a) is field-name-agnostic by construction, so its
12 hits are unchanged from the round-1 write-up below (already checked and
cleared). (b) was re-run specifically against the 42 newly-discovered names:
grepped the whole tree for `dict(...)`/`{**...}`/`.copy()`/`.setdefault(...)`
idioms referencing any of the 42, found **zero** such shallow-copy sites, then
separately traced every direct `.<name> =` reassignment of one of the 42
outside `app/models/` (7 sites, in `scheduled_tasks.py`, `shift_completion_
service.py` ×3, and `compliance_config_service.py` ×3) by hand: one
(`report.review_history = history`, `scheduled_tasks.py:3232`) reassigns a
`list(...)`-copied _list_ with only a top-level `.append()` — safe, since
appending to the copy never mutates a shared nested object the old committed
value could still reference; one (`shift_completion_service.py:1533`) already
uses `copy.deepcopy()`; the remaining five (`requirements_progressed`×2,
`report_data`, `summary`, `emailed_to`) assign a value built fresh from a
helper call or request payload, never derived by copying-then-mutating the
object's own prior column value, and three of those five are on a row that
was `db.add()`-ed a few lines earlier in the same function (a new insert, not
an update — no prior committed value to alias against). **Clean — 0 bugs
found among the 42 newly-discovered names**, consistent with the round-1
conclusion for the original 132.

**Sweep 9 correction, round 1 (Codex review):** the original method
([flagged here](https://github.com/thegspiro/the-logbook/pull/2128#discussion_r3900139055))
grepped only `.settings =` / `.positions =` / `.config =` across two
directories (`app/services/`, `app/api/v1/endpoints/`) — Codex's specific
example, `app/api/v1/onboarding.py:815`, sits one directory level up
(`app/api/v1/`, not `.../endpoints/`) and so was structurally invisible to
that grep, and the field-name list ignored the rest of the schema (`notification_
preferences`, `filters`, `custom_fields`, and more).

Re-swept properly: enumerated all **132 distinct JSON/`MutableDict`-typed
model attribute names** by parsing every `Column(JSON...)` /
`MutableDict.as_mutable(JSON)` in `app/models/*.py`, then checked the whole
`app/` tree (excluding tests) for the two idioms that actually produce this
bug regardless of which of the 132 names is involved: (a) a two-level nested
bracket mutation on any variable (`x[a][b] = ...`) — field-name-agnostic, so
complete by construction — and (b) a shallow-copy idiom (`dict(...)`,
`.setdefault(...)[...] =`, `{**x, ...}`) feeding one of the 132 field names.
(a) found 12 hits app-wide; all are either local report/response dicts
unconnected to any persisted JSON column, or mutate a dict created fresh in
the same scope (never aliased to committed ORM state). (b) found the
`onboarding.py:815` site Codex named (`org_settings = copy.deepcopy(
organization.settings or {})` at line 676, correctly deep-copied — just
outside the original two-directory scope, not a bug) plus ~30 more sites
across 26 files, spanning `notification_preferences`, `custom_fields`,
`filters`, `progress_notes`, `action_result`, `package_config`,
`applicant_snapshot`, `inactivity_config`, `steps_completed`, and
`ballot_items` in addition to the original three names. Every reassignment
found is one of: `copy.deepcopy()` before a nested mutation, a fresh dict via
`{**old, "key": new}` / `dict(old); d[k] = new` that only ever sets a
_top-level_ key (safe even with a shallow copy, per pitfall #12's own
explanation), a wholesale replace from a validated Pydantic payload (no
aliasing possible), or not a persisted SQLAlchemy attribute at all (e.g.
`training_programs.py:117`'s `notes = dict(response.progress_notes or {})`
mutates a Pydantic response model for redaction, never written back to the
DB). Every single-level bracket mutation on a bare column reference
(`session.data["key"] = ...`, 11 sites, all in `onboarding.py`) targets
`OnboardingSession.data`, the one column wrapped in `MutableDict.as_mutable
(JSON)` specifically so `__setitem__` is auto-tracked without a copy —
correct by design, not a gap. **Clean** — 0 bugs found, ~40+ sites checked
across the whole tree and all 132 attribute names claimed at the time, up
from 16 sites / 3 names / 2 directories. (That 132-name figure was itself
corrected to 179 on round-2 review — see "Sweep 9 correction, round 2"
above; the bug-detection conclusion did not change.)

Eight findings across this pass's four Codex review rounds, all in
`SecurityMonitoringService` or this file's own write-up of it (sweep 7's
tracker-cap fix across rounds 1–4 — the fourth round found the _same bug
shape_, a fourth time, in a method the round-3 "checked every method" pass
missed; sweep 9's JSON-attribute count and missing sweep script across
rounds 1–2 and 4; the completion-gate warning-count policy conflict, round 3;
this file's own misattribution of the round-1/round-2 regression, corrected
round 4) — see each sweep's write-up above for the full account of what
changed and why, including round 3 catching an actual regression (not just an
incomplete fix) in round 1's ordering, only fully corrected in round 4. All
nine invariants otherwise hold — five re-verified
against 399 revisions / 1536 routes, four checked for the first time as an
explicit whole-codebase sweep in this file (two of the four — sweeps 6 and 8
— were already correct; sweep 7 needed four rounds of fixes — round 1 fixed a
real gap, round 2 fixed two gaps in round 1's own fix, round 3 fixed a
read-after-evict regression that dated to round 1, and round 4 found the
identical regression, still unfixed, in a fourth method round 3's own
"checked every method" pass missed — and sweep 9 needed its method broadened
twice — first in scope, then in structural completeness — before it could be
trusted, plus a round-4 correction once its claimed script turned out not to
exist in the repo).

**Completion-gate policy correction (Codex review, round 3):** every prior
revision of this section reported the 8 ESLint warnings below as "pre-
existing, unrelated to this pass — well under `max-warnings 10`" and treated
that as gate-passed. Codex pointed out this is a direct conflict with
CLAUDE.md's "Fix All Errors — Non-Negotiable" section, which names warnings
explicitly alongside errors ("compilation errors, type errors, lint
violations, warnings, or failing tests") and says plainly: "If you discover
it, you own it... by default in the same commit" and "acknowledging an error
and moving on is a violation." `max-warnings 10` is a CI gate threshold, not
license under CLAUDE.md's own rule to leave a warning unfixed merely because
the count sits under it — the two are answering different questions
(would CI block the PR / does CLAUDE.md consider this task done), and
conflating them is exactly what "pre-existing, unrelated" was doing silently.

Per CLAUDE.md's Hard Stop clause, the correct question is not "does this fail
CI" but "would fixing it exceed this task's scope" — and 8 warnings across 3
files is not "hundreds of strict-mode violations across unrelated files," the
Hard Stop's own example of a genuine escalation. All 8 were attempted, and
**all 8 were fixed** — none needed escalating:

- **`StorageAreasPage.test.tsx` (3× `testing-library/no-node-access`,
  lines 24/25/27):** a helper snapshotted tree structure via
  `tree.querySelector`/`querySelectorAll`/`row.querySelector`. Replaced with
  scoped testing-library queries — `within(tree).queryByRole('button', {
name: /^Back from/ })` for the back button (stronger than the old
  `:scope > button` selector, which matched _any_ direct-child button and
  merely assumed it was the back one), and `data-testid` added to the row and
  path-label elements in `StorageAreasPage.tsx` (`storage-area-row` /
  `storage-area-row-path`, the same `data-testid={`prefix-${id}`}` convention
  already used in `CheckSweepStop.tsx` in the same module) so rows/labels are
  found via `within(...).getAllByTestId(...)`/`getByTestId(...)` instead of
  raw DOM traversal. `.getAttribute()`, `.dataset`, `.style`, `.classList` on
  the _results_ of those queries are unaffected — the ESLint rule's banned
  list (`PROPERTIES_RETURNING_NODES`/`METHODS_RETURNING_NODES` in
  `eslint-plugin-testing-library`) covers node-traversal only
  (`querySelector`, `closest`, `.children`, `.parentElement`, …), not
  attribute/style reads. Verified: same 17/17 tests pass, snapshot file
  (`__snapshots__/StorageAreasPage.test.tsx.snap`) unchanged byte-for-byte —
  the fix changed how elements are found, not what the test asserts.
- **`DocumentsPage.test.tsx` (2× the same rule, lines 109/113, each
  double-reported):** `screen.getByText(name).closest('div.stat-card')` to
  scope a card before checking for a Download button. `.closest()` has no
  testing-library replacement (there's no "find the ancestor" query), so the
  card itself needed a stable handle: added
  `data-testid={`document-card-${doc.id}`}` to the grid-card `<div>` in
  `DocumentsPage.tsx` (same convention as above), and the test now does
  `screen.getByTestId('document-card-d-generated')` directly — simpler than
  the original, not just compliant, since it targets the exact card by id
  instead of trusting `.closest()` to have walked to the right ancestor.
  Verified: same tests pass.
- **`RoleSetup.tsx` (1× `react-refresh/only-export-components`, line 161):**
  the file exported both the `RoleSetup`/`PositionSetup` component and a
  plain function, `buildPositionTemplates` — Fast Refresh can only hot-reload
  a module whose exports are all components, so every edit to this ~1300-line
  wizard while iterating on it forced a full page reload instead of a hot
  patch. Root cause, per the ESLint rule's own suggested fix ("Use a new file
  to share constants or functions between components"): split
  `buildPositionTemplates` (and the two helpers only it uses,
  `buildAllPositionTemplates` and `generateRolePermissions` — traced by hand,
  neither is called anywhere else in the file) into a new file,
  `positionTemplates.ts`. Pure data/logic, no JSX, no hooks — a `.ts` module,
  not `.tsx`. `RoleSetup.tsx` now imports `buildPositionTemplates` from it;
  `applyAgencyVocabulary` and the `OrganizationType` type import, used only
  inside the moved code, were dropped from `RoleSetup.tsx`'s own imports
  (would otherwise have become unused-import errors, not warnings). Two test
  files referenced the old location and needed the same update, not as an
  afterthought but because they'd otherwise start failing: `RoleSetup.test.
tsx` imports `buildPositionTemplates` from the new file now, and
  `RoleSetup.membership.test.ts` — which walks `RoleSetup.tsx`'s raw source
  text as a guard against re-adding retired membership-standing positions —
  had two assertions (`id: '${slug}'` absence, `id: 'member'` presence) that
  were checking text that moved; those now read `positionTemplates.ts`'s
  source instead, while the assertions about `RoleSetup.tsx`'s own restore-
  from-localStorage logic (`RETIRED_STANDING_SLUGS.has(posId)`, still genuinely
  in that file) stayed put. Verified: all 42 tests across the 4 touched test
  files pass, plus the full onboarding module suite (317 tests) as a check
  against collateral breakage from the split.

**Result: 0 errors, 0 warnings** (`eslint --max-warnings 10` on a clean tree
now reports nothing at all, not "under the cap") — the framing this section
should have used from pass 3 round 1 onward, and the one to keep using: a
warning discovered while this rotation's own gate is being reported gets
fixed in the same commit, or the specific reason it doesn't (a genuine Hard
Stop) gets written down here rather than folded into "pre-existing,
unrelated."

**Completion gate (pass 3, round 3 — full re-run):** `flake8`/`black --check`/
`isort --check-only` clean across `app/ tests/ alembic/`;
`validate_migrations.py --strict` passed (399 revisions, single head
`4e7e125cb00f` — unchanged, no migration touched this round);
`test_like_escaping.py` (2/2), `test_database_schema.py::test_set_null_fks_
are_nullable` (1/1), `test_capacity_locking.py` (17/17), `test_migration_
create_all_tables.py` (clean), and `test_security_monitoring.py` (**17/17**,
up from 14 — the 3 new `TestReadBeforeEvictOrdering` tests proving the
round-3 fix, each verified to fail against the pre-round-3 commit `df7438e0`
and pass after) all pass; `cd frontend && npm run typecheck` (the aliased
7.0.2 compiler, not bare `tsc` — see the round-1 correction below) **0
errors**; `cd frontend && npm run lint` **0 errors, 0 warnings** (see the
policy correction above). Files changed this round:
`app/services/security_monitoring.py` (the read-before-evict reordering,
sweep 7 above) and its test file; `StorageAreasPage.tsx`/`.test.tsx`,
`DocumentsPage.tsx`/`.test.tsx`, `RoleSetup.tsx`/`.test.tsx`/`.membership.
test.ts`, and the new `positionTemplates.ts` (the 8-warning fix above);
everything else is documentation.

**Completion gate (pass 3, round 4 — full re-run):** `flake8`/`black
--check`/`isort --check-only` clean across `app/ tests/ alembic/` (including
the new `backend/scripts/json_column_ast_sweep.py` — also fixed two
unrelated pre-existing `black`/`isort` violations discovered by this same
gate run, in `scripts/verify_database_enums.py` and
`scripts/seed_test_users.py`, neither touched by this round's own change, per
CLAUDE.md's "no acceptable pre-existing errors" rule); `validate_migrations.py
--strict` passed (399 revisions, single head `4e7e125cb00f` — unchanged, no
migration touched this round); the full backend unit-test suite matching
CI's `Backend Unit Tests` job exactly (`pytest tests/ -m "not integration and
not slow and not docker" --cov=app --cov-fail-under=51`): **8097 passed, 2
skipped, 58.65% coverage** (well over the 51% floor), including
`test_security_monitoring.py` (**18/18**, up from 17 — the 1 new
`test_rate_limit_alert_survives_batch_eviction_of_the_victim_ip` test proving
the round-4 fix, verified to fail against the pre-round-4 code and pass
after); `cd frontend && npm run typecheck` (the aliased 7.0.2 compiler) **0
errors**; `cd frontend && npm run lint` **0 errors, 0 warnings**. Files
changed this round: `app/services/security_monitoring.py` (the
`_check_rate_limit` read-before-evict reordering) and its test file;
`backend/scripts/json_column_ast_sweep.py` (new) and `backend/scripts/
README.md`; `scripts/verify_database_enums.py` and `scripts/
seed_test_users.py` (pre-existing black/isort fixes, unrelated to this
round's finding); `CHANGELOG.md`; everything else is documentation
(this file and `PROGRESS.md`).

**Completion-gate command correction (Codex review, round 1):** this section
originally reported `tsc --noEmit`
([flagged here](https://github.com/thegspiro/the-logbook/pull/2128#discussion_r3900139067)).
Per CLAUDE.md's "Two TypeScript installs" section, bare `tsc`/`npx tsc`
resolves through whichever bin `npm` happened to link into `node_modules/
.bin` — the 5.9.3 `typescript` install kept for typescript-eslint's peer
range, not the 7.0.2 `typescript-native` install this repo's build and
typecheck actually run on. `npm run typecheck` is the command that goes
through `frontend/scripts/tsc-native.mjs` to force the aliased 7.0.2
compiler; re-run as `cd frontend && npm run typecheck` for this pass — 0
errors, confirming the tree was clean under the compiler that actually
matters, not just under the lint-compatibility one. Every completion-gate
section in this file (and, where they quote it, PR bodies for this rotation)
should read `npm run typecheck`, not `tsc --noEmit`.

### Round 9 (Codex review on round-8 commit `c417d659`): a real async interleaving race in `detect_session_hijack`, plus a stale attribution comment

Two findings, handled separately per this rotation's own rule that a
doc-accuracy nit and a genuine concurrency finding call for different levels
of scrutiny.

**Doc fix.** The comment at `security_monitoring.py:634` (inside
`detect_session_hijack`, explaining why `session_data` is read before
`_enforce_key_caps()` runs) still read "a regression introduced by the
round-2 fix that added the call below." Per the "Attribution correction" note
above (round 4), the accurate framing is: **introduced in round 1's
`3b6b65e4`, widened in round 2's `df7438e0`.** Reworded to match. No
behavior change.

**Concurrency finding.** Codex's claim: `detect_session_hijack` is `async
def`; on its alert-firing path it `await`s `log_audit_event()` and
`self._add_alert()` — both real DB-I/O yield points — **before** writing its
decision back to `_session_trusted_ip` / `_session_ips`; `security_monitor`
is a module-level singleton shared by every request via the ASGI middleware;
so a second concurrent call for the same `session_id` can write to those
trackers while the first call is suspended mid-await, and the first call's
resumption then overwrites the second call's write with a stale snapshot —
losing a forensic-log entry and potentially moving the trusted-IP timestamp
backward.

**Verification, in the order the task required — claim, then singleton,
then reproduction, then impact — nothing taken on reasoning alone:**

1. **Are these real `await` points?** Yes, traced to the actual I/O.
   `log_audit_event()` (`app/core/audit.py:814`) delegates to
   `AuditLogger.create_log_entry()` (`audit.py:163`), which opens `async with
db.begin_nested()` and does two `await db.execute(...)` calls inside it —
   a nested transaction and two real round-trips to the (mocked-in-tests,
   real-in-production) async DB driver. `_add_alert()`
   (`security_monitoring.py:290`) does `await db.execute(...)` (the
   alert's owning-org lookup) and `await db.flush()`. Neither is a
   synchronous function merely declared `async`; both are genuine
   cooperative-yield points under `asyncio`.
2. **Is `security_monitor` actually a shared singleton on the request
   path, not a fresh instance per call?** Yes.
   `security_monitoring.py`'s last line is `security_monitor =
SecurityMonitoringService()` at module scope — constructed once, at
   import time. `security_middleware.py:1403` and `:1406` import that exact
   name and call `security_monitor.detect_session_hijack(...)` directly, for
   **every** authenticated request that carries `user_id`/`session_id`
   /`client_ip` (`security_middleware.py:1400`) — not behind a
   per-request factory or DI scope. This is also the method's own
   documented hot-path assumption (`_enforce_key_caps`'s docstring: "a
   genuine hot path (`detect_session_hijack` fires on every authenticated
   response)").
3. **Same bug shape checked against the other three tracker methods in this
   file** (`_check_rate_limit`, `detect_brute_force`,
   `detect_data_exfiltration`), per the task's explicit instruction not to
   stop at the one method named. All three already write their tracker
   state (the `self._api_calls[ip] = calls` / `self._login_attempts[ip] =
ip_attempts` / `self._data_transfers[user_id] = transfers` lines) **before**
   building any `SecurityAlert` or awaiting `log_audit_event`/`_add_alert` —
   each one's own round-5 comment already says so explicitly ("Write the
   filtered window back AFTER eviction... Check threshold [below]"). Only
   `detect_session_hijack` interleaves an `await` between its read and its
   write, because its alert-dispatch calls sit _inside_ the same `if
trusted_data:` block that computes the new tracker values, ahead of the
   writes at the bottom of the method. This is a genuinely different shape
   from the read-after-evict/write-after-evict family rounds 3–5 fixed
   (and round 4 found a fourth instance of) — which is exactly why eight
   rounds of "checked every method" passes on that bug class never surfaced
   it.
4. **Reproduced, not just reasoned about.** New test
   `TestSessionHijackConcurrentInterleaving` in
   `backend/tests/test_security_monitoring.py`. Two coroutines share one
   `SecurityMonitoringService` instance and call `detect_session_hijack` for
   the same `session_id`. Call A presents an IP change inside the 5-minute
   window (fires the hijack alert) and is stalled inside a monkeypatched
   `app.services.security_monitoring.log_audit_event` — an `asyncio.Event`
   under the test's control stands in for the real DB-I/O suspension. While
   A is parked there, call B — a legitimate IP change the test arranges to
   land outside the 5-minute window, so it takes the no-alert branch and
   never awaits at all — runs to completion, writing its own entries to both
   trackers. Only then is A released to resume and finish.

   ```python
   # backend/tests/test_security_monitoring.py
   # A stalls inside log_audit_event; B runs to completion in the gap;
   # A is released and resumes last.
   alert_a, alert_b = await asyncio.gather(call_a(), call_b())
   assert alert_a is not None
   assert alert_b is None
   final_ip, _ = svc._session_trusted_ip[key][-1]
   assert final_ip == "10.0.0.3"       # B's IP, not A's stale "10.0.0.1"
   assert "10.0.0.3" in [ip for ip, _ in svc._session_ips[key]]
   ```

   **Run against the pre-round-9 source (commit `c417d659`, saved aside and
   swapped in for the run, then restored): fails**, exactly as predicted —
   `final_ip` comes back `"10.0.0.1"` (call A's pre-hijack trusted IP,
   written by A's stale resume) instead of B's `"10.0.0.3"`, and
   `"10.0.0.3"` is absent from `_session_ips` (B's forensic entry, silently
   erased by A rebuilding the list from its own pre-B `session_data`
   snapshot). **Run against the fix (below): passes.** This is a genuine
   reproduction of both halves of Codex's claim — the stale-overwrite on
   `_session_trusted_ip` and the erased entry in `_session_ips` — not an
   assertion accepted on the strength of the reasoning alone.

5. **Impact, assessed honestly rather than inflated or minimized for the
   sake of a clean decision.** This detection runs on every authenticated
   request, and this app is a React SPA that fires multiple concurrent API
   calls under one session cookie as a matter of routine (parallel widget
   fetches on page load, prefetching) — so two concurrent calls for the same
   `session_id` are ordinary traffic here, not solely an attacker replaying
   a stolen cookie. The race window is narrower than "every call," though:
   it only opens on the alert-firing branch (an IP change observed within 5
   minutes of the last), which correlates with either a genuine hijack in
   progress or a legitimate client presenting multiple egress IPs (mobile
   carrier-grade NAT, corporate proxies round-robining outbound addresses) —
   already a known source of the false-positive alerts this method's
   leniency window exists to soften, and a plausible source of concurrent
   requests specifically during that same short window. What's actually at
   risk is bounded: each call's own alert-or-not decision and the audit-log
   row it writes are computed and persisted independently, unaffected by the
   race — what the race corrupts is the _tracker state a later call reads_,
   i.e. the session's stored forensic IP history and the trusted-baseline
   timestamp used to evaluate the _next_ request. Real, and worth fixing on
   its own terms; not a reason to distrust an alert that has already fired,
   and not the kind of finding whose severity needed rounding up or down to
   make the fix-vs-flag call easier.

**Fix — reorder, not redesign.** Moved both tracker writes
(`self._session_trusted_ip[key] = [(new_trusted_ip, new_trusted_time)]` and
`self._session_ips[key] = (session_data + [(current_ip, now)])[-10:]`) to run
immediately after the synchronous decision logic that computes
`new_trusted_ip` / `new_trusted_time` and builds the `SecurityAlert` object
(if any), and moved the `await log_audit_event(...)` / `await
self._add_alert(db, alert)` pair to run afterward, gated on `if alert is not
None:`. This is not a new pattern invented for this fix — it is exactly the
compute-then-write-then-await-for-dispatch shape `_check_rate_limit`,
`detect_brute_force`, and `detect_data_exfiltration` already use, so
`detect_session_hijack` now matches the other three instead of being the one
outlier. None of the values written (`new_trusted_ip`, `new_trusted_time`,
`session_data`, `current_ip`, `now`) are produced or altered by the two
awaited calls, so the reorder changes _when_ the write happens, never _what_
gets written — confirmed by re-running the full pre-existing
`TestSessionHijackTrustedBaseline` (round 6's regression tests) and
`TestSessionHijackLeniencyWindow` (round 7's) suites unmodified after the
reorder: both still pass, showing the reorder does not reopen either prior
bug. With the write now sitting ahead of both awaits, there is no `await`
left between this method's read and its write for a concurrent call to land
inside — closing the race outright rather than narrowing it.

**Why this was fixed rather than flagged.** The task's own criterion is
whether the fix is "small... doesn't require a broader redesign... and
doesn't lose any needed ordering guarantee elsewhere." This qualifies on all
three: it is a pure statement reorder inside one method, touching no other
method, model, or migration; it requires no `asyncio.Lock`, no change to how
alerts are dispatched, and no merge-vs-overwrite semantics decision (the
"last write wins" contract this dict was always written with is preserved —
what changes is which call's write happens to run last, which is now
determined by request completion order rather than an arbitrary await
suspension); and every ordering guarantee the file's prior seven rounds
established (read-before-evict, write-after-evict, trusted-IP-not-promoted-
on-alert, timestamp-refreshed-on-alert) is unaffected, verified by the
unmodified regression suites for rounds 6 and 7 above. An `asyncio.Lock` per
session key was considered explicitly and rejected as unnecessary
complexity: it would serialize concurrent calls for the same session rather
than removing the interleaving opportunity, adds a new failure mode (lock
contention, potential deadlock interaction with the DB session), and buys
nothing the reorder doesn't already deliver, since the reorder leaves the
method's tracker-mutating section synchronous start-to-finish.

**Verification:** `TestSessionHijackConcurrentInterleaving` (1 new test) —
verified to **fail** against the pre-round-9 commit `c417d659` and **pass**
after the fix, per the reproduction steps above. Full
`test_security_monitoring.py`: **27/27**, up from 26.

**Completion gate (round 9 — full re-run):** `flake8`/`black --check`/
`isort --check-only` clean on `app/ tests/ alembic/ scripts/`;
`validate_migrations.py --strict` unchanged (399 revisions, single head
`4e7e125cb00f`, no migration touched this round); full backend unit suite
matching CI's `Backend Unit Tests` job exactly (`pytest tests/ -m "not
integration and not slow and not docker" --cov=app --cov-fail-under=51`):
**8106 passed, 2 skipped, 58.66% coverage** (well over the 51% floor); `cd
frontend && npm run typecheck` (aliased 7.0.2 compiler) **0 errors**; `cd
frontend && npm run lint` **0 errors, 0 warnings** (no frontend files touched
this round — this round's whole diff is backend + docs). Files changed:
`app/services/security_monitoring.py` (the comment fix and the
write-before-await reorder in `detect_session_hijack`) and its test file
(new `TestSessionHijackConcurrentInterleaving`); `CHANGELOG.md`; this file
and `PROGRESS.md`.

---

## Pass 2 (2026-08-27) — re-sweep after rotation pass 1

Pass 1 completed the full 35-feature rotation (#1799–#1918) and closed SEC-1
through SEC-4 with two of the five sweeps converted into standing guard tests
(`test_like_escaping.py`, `test_database_schema.py::TestColumnConstraints::
test_set_null_fks_are_nullable`). This pass re-runs the same five sweeps
against everything that landed during pass 1 and since (the endpoint count grew
by one file — `app/api/prospect_privacy.py`, a `Depends()` helper module with
no routes of its own, not a new router — and the Alembic chain grew from 355 to
381 revisions). It does not re-derive pass 1's conclusions; it re-verifies them
against current code, per the rotation's own rule.

| #   | Class swept                      | Method                                                                                                                              | Result                                                                                                                                   |
| --- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Formula injection in exports     | `grep` for `csv.writer(` / `csv.DictWriter(` outside `csv_export.py`                                                                | **clean** — 0 sites, unchanged                                                                                                           |
| 2   | `SET NULL` on `NOT NULL` columns | `test_set_null_fks_are_nullable` (guard test added pass 1)                                                                          | **clean** — passes                                                                                                                       |
| 3   | Proxy-IP attribution             | grep `request.client.host`                                                                                                          | **clean** — same 3 hits as pass 1 (2 comments, 1 deliberate use inside `get_client_ip`)                                                  |
| 4   | Alembic chain integrity          | `backend/scripts/validate_migrations.py --strict`                                                                                   | **clean** — 381 revisions, single head `8fb3757b80ec`, no duplicate ids                                                                  |
| 5   | LIKE-wildcard handling           | `test_every_like_call_declares_the_escape_character` + `test_wildcard_escaping_lives_only_in_sql_search` (guard tests added pass 1) | **clean** — both pass; no new `.like()`/`.ilike()` call site has reintroduced a raw copy of the transform or dropped the `escape=` kwarg |

**Route auth coverage re-check:** an AST walk of every `@router.<verb>`
decorator in `api/v1/endpoints/`, `api/v1/onboarding.py`, and `api/public/`
found 68 routes with no recognized auth dependency (pass 1: 69 — the
one-route difference is a rename/refactor within the same already-accounted
surface, not a new gap). Every route is still confined to the same five
features pass 1 named: auth (14), event_requests.py's 4 public routes,
elections.py's 4 token-scoped routes, onboarding.py's 24 bootstrap routes, and
the public/* surface (22, including `salesforce_sync.py`'s OAuth callback).
**No new ungated route outside those five features.**

**Correction (Codex review on PR #1924):** the walk above was scoped by
directory glob (`endpoints/*.py`), which is narrower than pass 1's actual
"whole `app/api/`" scope and silently excluded
`app/api/v1/public_portal_admin.py` — a router mounted directly in
`api.py` (`from app.api.v1 import onboarding, public_portal_admin`, not
`from app.api.v1.endpoints import ...`) with 13 real route decorators. Derived
the file list from `api.py`'s router registrations instead of a directory
glob and re-ran: 80 files, 1526 routes (up from 1513 — the 13 newly-included
routes), same 68 ungated routes as above. All 13 `public_portal_admin.py`
routes carry `Depends(get_current_user)`; the corrected scan changes the
denominator, not the finding. **No new ungated route.**

No findings this pass. All five pass-1 invariants hold; two are now enforced
by tests rather than by review, exactly as pass 1 intended.

**Completion gate (pass 2):** `flake8`/`black --check`/`isort --check-only`
clean across `app/ tests/ alembic/`; `validate_migrations.py --strict` passed;
`test_like_escaping.py` (2/2) and the `SET NULL` guard test pass; `tsc
--noEmit` 0 errors; `eslint .` 0 errors (10 pre-existing warnings, same set as
feature 34's gate). No code changes this pass — documentation only.

---

## Pass 1 (2026-08-25)

**Scope:** whole codebase — `backend/app/` (66 v1 endpoint files, 11 public
endpoint files, 108 services, 42 model modules, 355 Alembic revisions).

The rotation opens with the sweeps that only make sense run against everything
at once. A per-feature iteration cannot establish "this class does not exist
anywhere"; it can only establish "not here". Running them first also means the
34 feature iterations that follow inherit the invariants instead of re-checking
them by hand.

---

## Scope

**Read in full:** `app/utils/sql_search.py`, `app/utils/csv_export.py`,
`app/utils/org_scoping.py`, and every call site the five sweeps returned.

**Swept mechanically** (AST or grep over all of `backend/app/`): LIKE/ILIKE
escaping, CSV writer selection, `request.client.host` usage, `SET NULL`
nullability, route auth coverage, and model-vs-migration table/column drift.

**Not read:** the feature internals themselves. This iteration establishes
class-level absence or presence, not per-feature verdicts — those are
iterations 01–34. A clean sweep here does **not** mean a feature is clean.

---

## Sweep results

| #   | Class swept                      | Method                                                                              | Result                                                                                                                                                                   |
| --- | -------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Formula injection in exports     | `grep` for `csv.writer(` / `csv.DictWriter(` outside `csv_export.py`                | **clean** — 0 sites; every exporter uses `SafeCsvWriter`                                                                                                                 |
| 2   | `SET NULL` on `NOT NULL` columns | grep every `ondelete="SET NULL"`, check the 3 lines that follow for `nullable=True` | **clean** — 0 sites; also guarded by `tests/test_database_schema.py::test_set_null_fks_are_nullable`                                                                     |
| 3   | Proxy-IP attribution             | grep `request.client.host`                                                          | **clean** — 3 hits, all non-runtime: 2 explanatory comments and 1 deliberate `direct_ip` inside `get_client_ip` itself. AXC-1 closed this class and it has stayed closed |
| 4   | Alembic chain integrity          | `backend/scripts/validate_migrations.py`                                            | **clean** — 355 revisions, single head `f2a91c7d6b04`, no duplicate ids, no orphans                                                                                      |
| 5   | LIKE-wildcard handling           | AST walk of every `.like()` / `.ilike()` call                                       | **3 findings — SEC-1/2/3, all fixed below**                                                                                                                              |

A sixth sweep (model↔migration drift) is written up under
[Schema & migration notes](#schema--migration-notes) — it found no defect, but
what it found instead is load-bearing enough to record.

---

## Route auth coverage

An AST walk of every route decorator in `app/api/` found **69 routes with no
auth dependency in the signature**, split as:

- **20 in `api/public/`** — the intentionally public surface (portal, calendar,
  display, `security.txt`, legal, four inbound webhooks, three finance
  approval-token routes, two public form routes).
- **49 in `api/v1/`** — 24 onboarding bootstrap routes, 15 auth routes (login,
  register, OAuth initiate/callback, password reset), 4 token-scoped ballot
  routes, 4 public event-request routes, the public calendar, the Salesforce
  OAuth callback, and `GET /` on the API root.

Every one of these is public **by design**. That is not the same as verified:
each needs its compensating control checked (rate limit before the expensive
work, signed/consumed token, webhook signature). That check is the substance of
iterations **01 auth**, **03 public surface**, **06 elections**, **16 events**
and **30 onboarding**, and the inventory above is recorded here so those
iterations start from a list rather than re-deriving one.

**No route outside those five features was found ungated.**

---

## Verified good ✅

- **Every CSV that leaves the system is formula-safe.** Zero uses of raw
  `csv.writer` remain in `app/`; `SafeCsvWriter` prefixes any cell opening with
  `= + - @ \t \r`. Mechanism: sweep 1, plus the class was closed repo-wide by
  the 2026-07 audit and has not regressed.
- **No `ondelete="SET NULL"` column is `NOT NULL`.** Mechanism: sweep 2, backed
  by an existing metadata test, so this is guarded rather than merely observed.
- **Client IP attribution is uniform.** Every runtime site resolves through
  `get_client_ip(request)`, which honours `TRUSTED_PROXY_IPS` and falls back to
  the peer address. Mechanism: sweep 3.
- **The migration chain is single-headed and consistent.** Mechanism: sweep 4,
  which the CI gate also runs.
- **All 76 `like`/`ilike` calls declare `escape=LIKE_ESCAPE_CHAR`**, and the
  wildcard-escaping transform has exactly one implementation. Mechanism:
  `tests/test_like_escaping.py`, added this iteration — this is now an
  invariant, not a snapshot.

---

## Findings

### SEC-1 — MED — Raw user input interpolated into a LIKE pattern — ✅ FIXED

**What:** two search paths built their pattern by direct interpolation, with no
wildcard escaping at all.

**Where:**

- `backend/app/services/messaging_service.py:124` — `pattern = f"%{search.strip()}%"`
- `backend/app/api/v1/endpoints/message_history.py:80` — `pattern = f"%{search}%"`

**Failure scenario:** a user with `settings.manage` types `%` into the
department-message search box. The pattern becomes `%%%`, which matches every
row, so the "search" silently returns the org's entire message table — and the
paginated list's count query scans all of it. `_` behaves the same way at
single-character granularity: searching `a_c` also returns `abc`, so a member
looking for one record gets a set they did not ask for and has no way to tell
the filter was ignored.

**Impact:** both queries are correctly org-scoped, so this is **not** a
cross-tenant leak. What it is: a filter that can be made to not filter, on two
list endpoints, with an unbounded scan behind it. The wrong-results half is the
part a user would never notice.

**Fix:** both now build the pattern with `like_pattern()` and pass
`escape=LIKE_ESCAPE_CHAR`.

### SEC-2 — MED — Wildcard escaping present but never declared to the database — ✅ FIXED

**What:** 47 call sites escaped the search term correctly and then emitted
`LIKE`/`ILIKE` **without an `ESCAPE` clause**.

**Where:** 12 files, chiefly `inventory_service.py` (19 sites),
`forms_service.py` (7), `apparatus_service.py` (4),
`membership_pipeline_service.py` (3), `documents_service.py` (3),
`facilities_service.py` (3).

**Failure scenario:** MySQL's default LIKE escape character depends on
`sql_mode`. Under `NO_BACKSLASH_ESCAPES` — a mode a DBA can enable for
standards compliance, and which some managed MySQL offerings set — the
backslashes the escaping inserted are treated as literal characters rather than
escapes. Every wildcard the transform was written to neutralize comes back, and
the codebase reverts to SEC-1 behaviour across all 47 sites at once. The
project already knew this: `app/utils/sql_search.py`'s own docstring says
"MySQL's default varies by mode and cannot be relied on implicitly" and "the
result must be passed with `escape=LIKE_ESCAPE_CHAR`; without it the escaping
is inert".

**Impact:** latent rather than live — on the default `sql_mode` these queries
behave correctly today. It is recorded as MED rather than LOW because the
failure is configuration-triggered, silent, simultaneous across the whole
application, and invisible in code review: the escaping _looks_ present.

**Fix:** every `like`/`ilike` call in `app/` now passes
`escape=LIKE_ESCAPE_CHAR` — 76 of 76, no exceptions. That includes the 21 sites
that had been passing a raw `"\\"` literal (now the shared constant) and the
four whose pattern is system-generated (`"ORD-2026-%"`,
`"reminder_sent:%"`, `"%probationary%"`, `"{prefix}-{year}-%"`). Declaring the
escape character on those four is **inert**, not wrong — their `%` is not
preceded by a backslash, so it stays a wildcard — and covering them is what
makes the invariant exception-free, so the guard test needs no allowlist to
grow stale.

### SEC-3 — LOW — The escaping transform was copy-pasted into 15 files — ✅ FIXED

**What:** `app/utils/sql_search.py` exists specifically to own this transform.
Its docstring names the seven modules it was copy-pasted into and says "it lives
here so a fix or a subtlety lands in one place rather than seven". Exactly one
call site — `storefront_service.py` — actually imported it. Fifteen other files
carried their own copy, including one nested inside a function
(`membership_pipeline_service.py`'s local `_escape`).

**Where:** `apparatus`, `grant`, `notifications`, `inventory`, `minute`,
`equipment_check`, `meetings`, `documents`, `forms`, `facilities`,
`membership_pipeline`, `fundraising` services, plus `audit_logs.py`,
`skills_testing.py` and `message_history.py`.

**Failure scenario:** this is the mechanism behind SEC-2. Each copy of the
transform obliged its author to remember the `escape=` kwarg independently, and
47 of them did not. A single owner makes the two halves inseparable.

**Impact:** the duplication is why the defect class existed at all, and why it
would have come back.

**Fix:** all 15 now call `like_pattern()`. The transform exists once, in
`sql_search.py`. `finance_service.py`'s local variable named `like_pattern` was
renamed `number_prefix` so it cannot shadow the helper.

### SEC-4 — MED — Inventory barcode search attributes the wrong matched field — ✅ FIXED

**What:** `search_items_by_code` runs its DB query against the LIKE-escaped
pattern (correct), then re-scans the returned rows **in Python** to decide which
field matched — and compared against the _escaped_ string rather than the raw
input.

**Where:** `backend/app/services/inventory_service.py:3392` (was
`safe_lower = safe_code.lower()`).

**Failure scenario:** a member scans or types an asset tag containing `%`, `_`
or `\` — e.g. `50%`. The escape transform turns it into `50\%`. The database
correctly returns the item whose `asset_tag` is `50%`, but the Python loop then
tests `"50\%" in "50%"`, which is false for every field, so the match falls
through to the `matched_field = "name"` default. The UI reports the item was
found by _name_ when it was found by _asset tag_, and `matched_value` shows the
item's name instead of the code that was scanned.

**Impact:** wrong attribution in a scanning workflow, silently — the item is
still returned, so nothing looks broken. Pre-existing; not introduced by this
change. It surfaced because collapsing the duplicated transform removed the
`safe_code` variable, and `flake8` then reported `F821 undefined name
'safe_code'` at the line that had been misusing it. The lint rule found a
correctness bug the tests did not.

**Fix:** compare against `code.lower()` — the raw input — with a comment stating
why the escaped form is the wrong comparand.

---

## Schema & migration notes

The model-vs-migration sweep compared every `__tablename__` and `Column` in
`app/models/` against every `create_table` / `add_column` / raw `ALTER TABLE` in
the 355 Alembic revisions. It reports:

- **37 model tables that no migration ever creates** — `positions`,
  `integrations`, `error_logs`, `event_requests`, `prospects`, `budgets`,
  `approval_step_records`, and 30 more.
- **49 model columns that no migration ever adds**, across 17 tables.
- **0 migration-created tables with no model.**

**This is not a finding.** It is the documented, deliberate shape of this
deployment: application startup runs `Base.metadata.create_all(checkfirst=True)`
followed by `_add_missing_model_columns` (`backend/main.py:274–350`), and that
is how model-only tables and later-added model columns actually materialize.
`backend/scripts/repair_schema.py` exists so CI reproduces the same state, and
its docstring names the exact count — "37 tables exist in the models with no
migration that creates them" — along with the seven contract-test failures that
resulted when CI skipped the step.

Recording it here for two reasons. First, so a later iteration does not
rediscover it and file it as a critical drift bug. Second, because it is a
standing risk worth stating plainly even though it is working as designed:
`create_all` does not carry the `ondelete` behaviour, index set, or column
ordering that a hand-written migration does, so a table born from `create_all`
and a table born from a migration are not guaranteed identical. Checklist
dimension 7 asks each feature iteration which path its tables took.

Chain integrity itself is clean: 355 revisions, one head, no duplicates.

---

## Guard tests added

`backend/tests/test_like_escaping.py` — two tests, both source-walking:

1. `test_every_like_call_declares_the_escape_character` — every `.like()` /
   `.ilike()` in `app/` passes `escape=LIKE_ESCAPE_CHAR`. Asserts SEC-2's
   invariant with no allowlist.
2. `test_wildcard_escaping_lives_only_in_sql_search` — the transform
   `.replace("%", "\\%")` appears in exactly one file. Asserts SEC-3's.

Verified to fail on reintroduction: removing the `escape=` kwarg from one call
in `documents_service.py` fails test 1 and names the file and line; restoring it
passes.

---

## Completion gate

| Check                                                 | Result                                              |
| ----------------------------------------------------- | --------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                         | ✅ 0 violations                                     |
| `black --check app/ tests/ alembic/`                  | ✅ 1216 files unchanged                             |
| `isort --check-only app/ tests/ alembic/`             | ✅ clean — see the note below                       |
| `python3 -m pytest tests/ -k "<19 touched services>"` | ✅ **1715 passed, 1 skipped, 0 failed**, 325 errors |
| `backend/scripts/validate_migrations.py`              | ✅ 355 revisions, single head                       |
| `tsc --noEmit` / `eslint .`                           | n/a — no frontend file changed this iteration       |

The 325 errors are the sandbox's missing MySQL (`OperationalError(2003, "Can't
connect to MySQL server on 'localhost'")` at fixture setup), the same limitation
recorded in `docs/app-review/PROGRESS.md`'s baseline.

The same selection was run against unmodified `HEAD` in a separate git
worktree, which is what makes the result evidence rather than an assertion:

| Run                 |   Passed | Skipped |  Errors |
| ------------------- | -------: | ------: | ------: |
| `HEAD` (unmodified) |     1713 |       1 |     325 |
| this branch         | **1715** |       1 | **325** |

The error count is identical, so nothing moved from passing to erroring. The
`+2` is exactly the two tests added in `test_like_escaping.py`. That is the
standard AXC-1 set for a mechanical sweep, and it is the claim being made here:
behaviour-neutral to the suite, not merely still green.

### The gate that was reported clean and was not

`isort` was not installed in this sandbox and the first push went out without
it, on the reasoning that `black` and `flake8` both passed and CI would run the
real thing. CI did, and it failed: `storefront_service.py` had its
`sql_search` import placed after `storefront_payments` instead of before it.

The cause is specific and worth recording, because it is the one file where the
import was not newly added — it already existed at line 58, my sweep stripped it
along with the misplaced ones, and the AST pass that put it back inserts after
the _last_ top-level import rather than in sorted position. Every other file got
a new import that happened to sort correctly; this one did not.

`isort==8.0.1` (CI's pin) was then installed and run over `app/ tests/
alembic/`. One line moved. `black`, `flake8` and the guard test were re-run
after it and all still pass.

**The lesson is in the command file now** (Step 6): run all three linters
against `alembic/` too, and install a missing one at CI's pinned version rather
than noting it as unavailable. An import inserted programmatically is precisely
the change `isort` exists to catch, so "the other two linters passed" was never
evidence about this one.
