# Security Review — Progress Tracker

A feature-by-feature security pass over the whole application, driven by
`/loop 30m /security-review`. Each iteration works one feature through
[`CHECKLIST.md`](./CHECKLIST.md), records findings in
`docs/security-review/<feature>.md`, applies only safe/verified fixes, flags
the rest, passes the completion gate, and opens a pull request.

**One PR at a time.** An iteration that finds a security-review PR still open
tends that PR — CI, review comments, conflicts — instead of starting the next
feature. The rotation cannot outrun its own review queue.

**Legend:** ⬜ pending · 🔄 in progress · ⏳ awaiting PR merge · ✅ done

---

## Open PR

Feature 32 (Locations & kiosk), pass 2 — PR
[#2098](https://github.com/thegspiro/the-logbook/pull/2098), branch
`claude/security-review-locations-kiosk-pass2`. Round 1 read every backend
file in the feature's surface in full and reported zero findings (correctly
noting the surface is byte-for-byte unchanged since pass 1, PR #1916 — but
citing an unreachable commit, `1b7be79a`, for that diff). **Round 2
(Codex-caught):** five real, independently verified findings the full read
missed — LOC-32-1 (a lost prospect-link race could cost the guest their
whole attendance record, not just the pipeline link), LOC-32-2 (kiosk
display codes kept working after the owning organization was deactivated),
LOC-32-3 (the location-uniqueness check skipped a building-only change),
LOC-32-4 (the guest-check-in daily cap was reserved before the window-open
and attendance-finalized rejection gates, letting refused traffic exhaust
it), LOC-32-5 (an explicit `null` for `name`/`is_active` reached a NOT NULL
column as a 500 instead of a validation error) — plus the commit-hash
correction (`1a0a35c8` is the actual, reachable squash-merge commit). All
five fixed with guard tests. **Round 3 (Codex-caught, on the LOC-32-3
fix):** the effective-building calculation couldn't tell an explicit
`building: null` (clearing it) apart from an omitted `building`, so a
clear skipped the dup-check against the new null scope — fixed by reading
`model_fields_set` instead of an `is not None` check. See log entry below
and `docs/security-review/LOC-32-locations-kiosk.md`.

**Note on branch naming:** pass 1's PR (#1916) used the branch name
`claude/security-review-locations-kiosk` — reusing it for this pass would
violate CLAUDE.md Pitfall #24, so this pass uses `-pass2` appended, matching
the convention the CRON-31 and ONB-30 pass-2 iterations used for the same
collision.

---

### 2026-08-31 — Feature 32 (Locations & kiosk), pass 2 — round 2: 5 fixed (Codex-caught), 1 doc correction — PR #2098

No security-review PR was open (feature 31 fully merged via PR #2095, closed
out via PR #2097 earlier this iteration), so the rotation continued to
feature 32. Loaded `CHECKLIST.md`, `SEC-00-cross-cutting-baseline.md`, and
`docs/security-review/LOC2-32-locations-kiosk.md` (pass 1, PR #1916, 3
findings + LOC-3 flagged) before reading any code.

**Round 1** read every backend file in the feature's surface in full —
`locations.py`, `admin_hub.py`, `location_service.py`, `public/display.py`,
`admin_hub_service.py` (1,841 L), `guest_check_in_service.py`, models,
schemas — and confirmed a diff against what it believed was pass 1's merge
commit came back empty. Re-verified LOC2-32-1/2/3 and LOC-1/2/4 all hold.
Reported zero new findings and opened PR #2098 on that basis.

**Round 2 (Codex-caught), all verified against actual code before fixing:**

1. **Commit-hash correction.** The diff commit `1b7be79a` cited in round 1
   is the last commit of pass 1's source branch before it was
   squash-merged, and is not reachable from `main` — it only resolved
   locally because this session had fetched it by exact SHA earlier. The
   actual, reachable squash-merge commit is `1a0a35c8`. Confirmed it diffs
   identically to `1b7be79a` for every file in the surface — round 1's
   zero-diff conclusion was correct, only its citation was not
   reproducible by anyone who hadn't done that SHA-targeted fetch.
2. **LOC-32-1 (MED)** — `guest_check_in_service.py`'s `_link_prospect`
   catches a broad exception on the reasoning that a pipeline failure must
   not cost the guest their attendance, but `link_prospect_to_event`'s
   insert ran with no SAVEPOINT — a lost duplicate-key race left the whole
   session needing a rollback it never got, so `check_in_guest`'s own
   commit (the attendance record itself) failed too. Fixed by wrapping the
   insert in `begin_nested()`, matching `MembershipPipelineService.
create_prospect`'s own established pattern for the identical race
   shape.
3. **LOC-32-2 (MED)** — `get_location_by_display_code` filtered only
   `Location.is_active`, never `Organization.active` — a deactivated
   org's kiosk codes and guest sign-in path kept working indefinitely.
   Other public intake surfaces (`event_requests.py`, `auth.py`) already
   gate on `Organization.active`; this one didn't. Fixed with a join.
4. **LOC-32-3 (LOW/MED)** — `update_location`'s duplicate check only ran
   on a `name` change, even though the uniqueness scope is `(name,
building)` together — a building-only PATCH could merge two
   legitimately-separate same-named locations into one building
   undetected. Fixed by computing the effective `(name, building)` pair and
   checking whenever either changes.
5. **LOC-32-4 (MED)** — the guest-check-in daily cap (`daily_cap_exceeded`,
   an atomic Redis INCR) was checked before the check-in-window-open and
   attendance-finalized rejection gates, so refused traffic before the
   window opens could exhaust the 300/day allowance and deny legitimate
   guests once it does — the exact ordering bug `event_requests.py`'s
   EV-19 fix already documents and avoids for the identical cap shape.
   Fixed by moving both rejection checks above the cap.
6. **LOC-32-5 (LOW)** — `LocationUpdate.name`/`.is_active` are typed
   `Optional[...] = None` to make them omittable on a PATCH, which also
   admits an explicit `null` — `model_dump(exclude_unset=True)` preserves
   it and `setattr` writes it straight into a NOT NULL column, 500ing
   instead of 422ing. Fixed with a `model_validator` that rejects an
   explicit null for either field while still allowing omission.

**Round 3 (Codex-caught, on LOC-32-3's own fix):** the effective-building
calculation used `location_data.building is not None` to mean "supplied,"
which cannot tell an explicit `PATCH {"building": null}` (clearing it)
apart from an omitted `building` — both read as `None`. A clear therefore
fell back to the location's _current_ building for the dup-check while
still persisting `null`, missing a conflict with an existing same-named,
no-building location. Fixed by reading `location_data.model_fields_set`
instead, which correctly distinguishes omission from an explicit null for
both fields (`name` cannot be explicitly null since LOC-32-5, so only
`building` was actually exposed). Two more guard tests added.

Every fix has a guard test independently verified against the new code:
`tests/test_guest_check_in.py::TestGuestProspectCreation::
test_link_race_is_scoped_to_a_savepoint_not_the_whole_commit`,
`tests/test_location_display_code.py::TestGetLocationByDisplayCode`,
`tests/test_location_uniqueness.py` (new file, 9 tests across three
findings), and `tests/test_public_display.py::
TestGuestCheckInDailyCapOrdering` (3 tests).

**LOC-3** (`GET /locations/{id}/display`, the dead authenticated display
endpoint) remains unchanged and flagged, not fixed, for the same reason as
pass 1 — already tracked in `docs/KNOWN_LIMITATIONS.md`.

**Completion gate:** `flake8`/`isort` clean; `black --check` required
reformatting two files (`location_service.py`,
`tests/test_location_uniqueness.py`), applied. Scoped tests
(`-k "location or admin_hub or guest_check_in or public_display"`) —
**313 passed** (was 290), 1 skipped (pre-existing). Full backend suite —
**9368 passed** (was 9353), 22 skipped, 0 failed.
`validate_migrations.py --strict` — 394 revisions, single head (no schema
change). No frontend file touched. Findings doc:
`docs/security-review/LOC-32-locations-kiosk.md`. PR #2098 opened and
subscribed. Next: 33 core infrastructure, once #2098 merges.

Feature 32 marked 🔄 (not ✅ yet — that happens on the closing PR after
merge, per the rotation's own rule).

### 2026-08-31 — Feature 31 (Scheduled tasks), pass 2 ✅ PR #2095 merged (`8254875a`)

Round 1: 6 fixed, 3 new flagged. Round 2 (Codex-caught): 3 more corrected —
see below.

No security-review PR was open (feature 30 fully merged via PR #2093 earlier
this iteration), so the rotation continued to feature 31. Loaded
`CHECKLIST.md`, `SEC-00-cross-cutting-baseline.md`,
`docs/app-review/scheduled-tasks.md` (A3, 2 passes), and
`docs/security-review/CRON2-31-scheduled-tasks.md` (pass 1, PR #1915 + its
Codex round, 13 findings) before reading any code.

Read `scheduled.py` (58 L, 2 routes) and `scheduled_tasks.py` (5,600 L, 43
task runners) end to end — not diffed against pass 1, per the rotation's
"enumerate, don't spot-check" rule — plus the in-process scheduler in
`main.py` (`_scheduled_task_loop`, `_scheduled_email_loop`,
`_try_claim_background_task`), which drives every `TASK_RUNNERS` entry in a
default deployment but was outside pass 1's stated scope. Diffed pass 1's
merged head against current `HEAD` for the two named files: one real change
landed since pass 1 (a `run_publish_scheduled_messages` rewrite adding
row-locking and message-expiry handling), which is where CRON-31-1 was
found.

Re-verified all 13 pass-1 findings (CRON2-31-1 through -13) hold with no
regressions, each re-checked against current `file.py:line`, not assumed
from the prior doc.

**6 new fixes:**

1. **CRON-31-1 (MED)** — `run_publish_scheduled_messages` (the new code
   since pass 1) had no per-message isolation: one message's failure
   propagated an unhandled exception, permanently orphaning every other
   due message in the same batch (their `scheduled_at` claim was already
   committed, so the "due" query would never select them again). Fixed with
   the same try/except + `needs_refresh` pattern CRON2-31-1/5/6 established.
2. **CRON-31-2 (MED)** — `run_action_item_reminders`'s minutes-action-item
   branch has raised `MissingGreenlet` on every single invocation since the
   day it was written (verified against a real MariaDB connection via
   `async_session_factory()`, not the `db_session` test fixture — a naive
   version of the guard test using that fixture passes even with the bug
   present, since SQLAlchemy's identity-map short-circuit for many-to-one
   lazy loads masks it when the same session already holds the parent row).
   Fixed with `selectinload(MinutesActionItem.minutes)`.
3. **CRON-31-3 (MED)** — `run_shift_reminders` never got the "empty
   member_ids after the active-user filter" guard CRON2-31-3's Codex round
   added to its sibling `run_end_of_shift_checklist_reminders` — stamped its
   dedup flag even when every assigned member was inactive and zero
   reminders were sent. Fixed with the matching guard.
4. **CRON-31-4 (LOW)** — `run_rolling_recurrence_extend` had no per-parent
   commit/rollback isolation (a single deferred trailing commit — the
   "worst" shape CRON2-31-1 found in `run_shift_auto_checkout`) and no
   rollback in its except at all. Fell outside the structural test's
   `"select(Organization)"` heuristic since it iterates `Event` parents.
   Fixed: commit per parent, rollback on failure.
5. **CRON-31-5 (LOW, latent)** — same function, no `Organization.active`
   filter at all (not even the original CRON-2's bare form). Fixed with a
   join, same pattern as CRON2-31-11.
6. **CRON-31-6 (LOW)** — `run_external_training_auto_sync` had no rollback
   in its per-provider except, even though the delegated service's own
   pre-try `flush()` can fail and poison the session for every later
   provider. Fixed.

**3 new flagged (not fixed):**

- **CRON-31-7 (LOW)** — `run_end_of_shift_summary` can mark a member "sent"
  if both channels fail for them, same shape as CRON2-31-3 but much lower
  exposure (the in-app half never reaches the DB before the org-level
  commit) — reversing it is a product decision about cross-channel delivery
  semantics.
- **CRON-31-8 (LOW)** — `run_event_reminders` stamps a reminder interval
  sent when zero recipients exist yet, by explicit documented design
  ("avoid re-processing"), not an oversight.
- **In-process scheduler's Redis-down fallback** (`main.py`) runs on every
  worker unguarded when Redis is unavailable — the alternative (fail closed,
  run on no worker) is worse for this feature. Mirrors the CLAUDE.md
  breached-password fail-open trade-off.

Every fix has a guard test independently verified to fail against the
pre-fix code and pass against the post-fix code (not merely written and
assumed correct) — full list in `docs/security-review/
CRON-31-scheduled-tasks.md`'s "Guard tests added" section.

**Completion gate:** `flake8`/`black --check`/`isort --check-only` clean on
`app/ tests/ alembic/`; `validate_migrations.py --strict` — 394 revisions,
single head; the full backend suite — **9351 passed, 22 skipped, 0 failed**
(all skips pre-existing Docker/optional-dependency/contract-suite skips).
No frontend file touched.

**Round 2 (Codex-caught, all verified against actual code — and, where the
claim was about async session behavior, against a real connection — before
fixing):**

1. **CRON-31-1 addendum.** The except block still read
   `getattr(message, "id", "?")` for its log line before calling
   `db.rollback()`. Verified empirically against a real connection: once
   `db.commit()` itself fails (not just `materialize_recipients()` raising),
   _any_ attribute read on _any_ loaded object — not only an expired one —
   raises `PendingRollbackError` until the rollback runs; `getattr`'s default
   only catches `AttributeError`, so the read itself aborted the exception
   handler, crashing the whole batch — exactly the bug this finding exists
   to fix. Moved the `id` capture to before any further DB operation.
2. **CRON-31-4/5 addendum, two gaps.** `total_created`/`series_extended`
   were incremented before the commit that could still fail, so a failed
   parent's counts survived its own rollback; moved both increments to after
   the commit succeeds. The fix also never refreshed the parent processed
   right after a failed one (the same `parents`-list session-poisoning gap
   CRON-31-1 had) — added the same `needs_refresh` + `db.refresh(parent)`
   pattern.
3. **CRON-31-6 addendum.** Same `providers`-list gap as above — added
   `needs_refresh` + `db.refresh(provider)`, and captured `provider.id`/
   `provider.name` before the risky call instead of reading them in the
   except block.

New/strengthened guard tests: a real-`db_session` test forcing a genuine
FK-violation `IntegrityError` on the commit itself (CRON-31-1), a mocked test
forcing the failure specifically at `db.commit()` after what the pre-fix code
would already have counted (CRON-31-4/5), and an added
`db.refresh.assert_awaited_once_with(...)` assertion (CRON-31-6). Every one
verified to fail against the pre-fix/pre-correction code and pass with the
correction restored. `pytest tests/ -k "scheduled_task or rolling_recurrence
or ..."` — **143 passed** (was 141); full suite — **9353 passed, 22 skipped,
0 failed** (was 9351); `flake8`/`black --check`/`isort --check-only` clean.

Feature 31 marked 🔄 (not ✅ yet — that happens on the closing PR after
merge, per the rotation's own rule).

### 2026-08-31 — Feature 30 (Onboarding), pass 2 ✅ PR #2093 merged (`e6a1eb45`)

Round 1: 2 fixed, 1 new flagged. Round 2 (Codex-caught): 1 more fixed — see
below.

No security-review PR was open (feature 29 fully merged via PR #2091 earlier
this iteration), so the rotation continued to feature 30. Loaded
`CHECKLIST.md`, `SEC-00-cross-cutting-baseline.md`, `docs/module-audit/
onboarding.md` (iteration 25), `docs/app-review/onboarding.md` (B25, 4
passes), and `docs/security-review/ONB2-30-onboarding.md` (pass 1, PR #1913 +
same-day follow-up) before reading any code — re-verified their findings
rather than re-deriving them.

Read `onboarding.py` (2,386 L), `services/onboarding.py` (1,465 L),
`models/onboarding.py`, `utils/onboarding_security.py`, `template_service.py`
in full, plus the SMTP/OAuth test helper (`email_test_helper.py`) for a new
angle this pass adds. Enumerated all 24 unauthenticated bootstrap routes and
their compensating controls (table in the findings doc). Re-verified every
prior finding across all three review layers (ONB-1 through ONB-9, ONB2-30-1
through ONB2-30-8, the E712/template-mass-assignment fixes) line-by-line — all
hold, no regressions.

**Two fixes, both low-risk and verified:**

1. **ONB-30-1 (LOW)** — `GET /status` was the one anonymous onboarding route
   with no rate limit (noted, not fixed, in app-review pass 2). Added the same
   scoped-wrapper pattern the other 7 routes already use. Guard test extended
   from 7 to 8 wrappers; verified to fail with the fix reverted.
2. **ONB-30-2 (LOW)** — `VITE_SESSION_KEY` is declared in
   `frontend/.env.example`/`setup.sh` and documented in `CLAUDE.md` as a
   security-critical "Onboarding session encryption key" that "MUST be
   changed for production," but has had zero readers anywhere in the code
   since a client-side XOR obfuscate/deobfuscate pair was removed (confirmed
   by a trailing comment in `onboarding/utils/security.ts` explaining exactly
   that removal, and by `onboarding/utils/storage.ts`'s current no-client-
   secrets design). Removed the dead variable and its "must change" guidance
   from `.env.example`, `setup.sh` (3 places), `CLAUDE.md`'s env var table,
   and `docs/ONBOARDING_FLOW.md`'s production checklist.

**One new finding, flagged not fixed:**

- **ONB-30-3 (MED)** — `POST /onboarding/test/email`'s self-hosted-SMTP path
  (`email_test_helper.test_smtp_connection`) connects to a fully
  client-supplied `smtpHost`/`smtpPort` via raw `smtplib` with no SSRF/
  private-IP protection — the only client-directed outbound connection in the
  codebase that doesn't route through `app.utils.url_validator`. Reachable
  pre-auth during the bootstrap window (anyone can mint a rate-limited
  onboarding session via `/start` until the first org exists); differentiated
  error messages let a caller fingerprint internal `host:port` reachability.
  Not fixed: the obvious mitigation (block private IPs) would break the
  legitimate, common case of an on-prem SMTP relay reachable only from a fire
  department's internal network — a genuine product-policy tradeoff, not a
  drive-by-fixable bug. Mirrored in `KNOWN_LIMITATIONS.md`.

All still-flagged items from prior passes (ONB-7 role editor, ONB-8 residual
audit-transaction durability, ONB2-30-8 session sliding TTL, role/position
dedup, `/organization`'s missing `except Exception`, `ITTeamMemberRequest`'s
loose `email: str`) re-confirmed unchanged by direct code read, not
re-applied.

**Completion gate:** `flake8`/`black --check`/`isort --check-only` (pinned
8.0.1) clean across `app/ tests/ alembic/`; `validate_migrations.py --strict`
— 394 revisions, single head; `pytest tests/ -k "onboard or template_service"`
— 109 passed, 1 skipped; `test_onboarding_rate_limit_scopes.py` — 9 passed
(was 7), verified to fail with the fix reverted; `test_security_middleware.py`
— 80 passed; `tsc --noEmit` — 0 errors; `eslint .` — 0 errors, 8 pre-existing
warnings in unrelated files. Full writeup:
`docs/security-review/ONB-30-onboarding.md`.

**Round 2 (Codex-caught, verified before fixing):** ONB-30-1's own fix gave
`GET /status` `check_rate_limit`'s bare auth defaults (5 requests/60s,
1800s lockout on the Redis-unavailable fallback). Unlike its siblings,
`/status` isn't gated behind a deliberate user action — `LoginPage.tsx` and
`OnboardingCheck` call it from a `useEffect` on every mount, twice under
React StrictMode — so a handful of page loads exhausts the budget and the
fallback lockout could leave a legitimate admin locked out of even learning
whether onboarding is needed for up to 30 minutes. Fixed by giving
`_rate_limit_onboarding_status` its own explicit budget
(`max_requests=60, window_seconds=60, lockout_seconds=60`) instead of the
auth defaults; every other onboarding route keeps the tight defaults since
each gates a one-shot action. Guard tests added:
`test_status_wrapper_uses_a_read_appropriate_budget_not_auth_defaults` and
`test_action_wrappers_keep_the_auth_defaults` (confirms the loosening stays
confined to `/status`). `pytest tests/ -k "onboard or template_service"` —
**117 passed, 1 skipped** (was 109); `test_onboarding_rate_limit_scopes.py`
— **17 passed** (was 9); `flake8`/`black --check`/`isort --check-only` clean.

---

### 2026-08-31 — Feature 29 (Reports & analytics), pass 3 ✅ PR #2091 merged (`b6c283a7`)

Round 1: 0 fixed, 0 new flagged (claim did not hold). Round 2 (Codex-caught):
6 fixed — see below.

No security-review PR was open (feature 28/Security-audit-IP fully merged via
PR #2089), so the rotation continued to feature 29. Loaded `CHECKLIST.md`,
`SEC-00-cross-cutting-baseline.md`, and both prior findings docs
(`docs/security-review/RPT2-29-reports-analytics.md`, PR #1912;
`docs/module-audit/reports-analytics.md`; `docs/app-review/reports-analytics.md`;
`docs/app-review/dashboard.md`) — re-verified their open items rather than
re-deriving them.

Diffed all ten files (`reports.py`, `analytics.py`, `platform_analytics.py`,
`dashboard.py`, `labels.py`, `reports_service.py`,
`dashboard_widget_service.py`, `attendance_dashboard_service.py`,
`label_service.py`, `label_printer_service.py`) against the commit pass 2
merged as: the only change since is one small commit adding a `printer_id`
field to the label preset, which validates the client-supplied printer id
against the caller's org before storage (correct pitfall-14c pattern) —
verified good, no finding.

Read every endpoint and service in full (not just the diff), enumerated all
29 routes' auth/permission dependencies (table in the findings doc), and
re-verified every prior fix line-by-line: RPT2-29-1, RPT2-29-3, DASH-29-1,
DASH-29-2, DASH-29-3, LBL-29-1, LBL-29-3 (security-review pass 2) and DASH-3,
RPT-1, RPT-4, RPT-5a, RPT-5b (module-audit/app-review) all hold exactly as
recorded, no regressions. Every still-flagged policy item (RPT2-29-2 saved-
report scheduler, LBL-29-2 label-printer permission gate, LBL-29-4 PDF label
count cap, RPT-3 PII-tier permission, RPT-5c/RPT-6/RPT-7, DASH-2 dead
`/dashboard/stats` endpoint) re-confirmed unchanged by grep/re-read, not
re-applied.

Also checked dimensions the pass-2 writeup didn't fully re-derive: zero
`.like()`/`.ilike()` calls in this feature (n/a); the frontend's client-side
CSV export (`modules/reports/utils/export.ts`) routes every cell through
`escapeCsvCell`, which neutralizes formula-injection triggers the same way
`SafeCsvWriter` does server-side (verified good); `platform_analytics.py`'s
error-log aggregate projects only `error_type` + count, never
`error_message`/`context` (verified good); the one `ondelete="SET NULL"` FK
in this feature's models (`LabelPrinter.created_by_id`) is `nullable=True`.

Noted in passing, not fixed (dead code, not exploitable): the frontend's
`modules/reports/services/api.ts` exports a `reportExportService.exportReport`
that calls a `POST /reports/export` backend route which does not exist, and
has zero callers anywhere in the frontend.

**Round 1 claimed no new findings, no code changes.** That claim did not
survive Codex's review of the doc itself. Full writeup:
`docs/security-review/RPT-29-reports-analytics-pass3.md`.

**Round 2 (Codex-caught, all six verified against actual code before fixing):**

1. **LBL-29-3 addendum (P1).** `extra_lines` was bounded on list length
   (`max_length=20`) but not per-element string length; `_build_extra_lines`
   passes a `custom:<text>` entry through unbounded, joined into every label
   spec. Fixed with a per-element `max_length=100` on both
   `LabelGenerateBody.extra_lines` and `LabelPrintBody.extra_lines`.
2. **RPT-3, real authorization bypass (P1).** `PII_REPORT_PERMISSIONS`
   covered only `member_roster`/`pipeline_overview`. `training_summary`,
   `training_progress`, `annual_training`, `certification_expiration`, and
   `compliance_status` all return per-member training/compliance detail
   gated behind `training.manage` at their source; `admin_hours` returns
   per-member hours gated behind `admin_hours.manage` at its source. A
   `reports.view`-only caller could reach all six via `/reports/generate` and
   `/reports/saved/{id}/run`. Fixed by adding all six to the map — this
   supersedes round 1's "still flagged, policy call" characterization of the
   `certification_expiration` gap, which was a real bug, not a policy choice.
3. **Dashboard action-items caching (P2).** `/dashboard/action-items`
   (assignee names + free-text descriptions) was missing from
   `UNCACHEABLE_PREFIXES`, so a revoked grant could still be served from the
   90s stale-while-revalidate cache. Fixed.
4. **Unbounded saved-report listing (P2).** `GET /reports/saved` has no
   pagination; capped creation at 200 active rows per org to bound it.
5. **Saved-report field widths unvalidated (P2).** `name`/`report_type`/
   `schedule_frequency` had no length bounds against their `VARCHAR`
   columns, risking an uncaught `DataError` under MySQL strict mode. Fixed
   with matching `Field(max_length=...)` bounds.
6. **Analytics deviceType unvalidated (P2).** `metadata.deviceType` was
   copied straight into a `VARCHAR(20)` column with no type/length check.
   Fixed with a sanitizing extraction helper.

Guard tests added: 3 (labels), 5 (report PII gate), 11 (saved-report caps/
bounds + analytics), plus 1 frontend cache-exclusion test — 20 new tests, all
passing. Completion gate: `flake8`/`black --check`/`isort --check-only`
clean on all files touched; `pytest tests/ -k "reports or label or
analytics"` — **368 passed, 1 skipped, 0 failed**; new/modified test files —
**31 passed**; frontend `tsc --noEmit` clean, `eslint` clean on both changed
files, `vitest run apiCache.test.ts` — **87 passed**.

---

### 2026-08-31 — Feature 28 (Security, audit & IP), pass 2 ✅ PR #2089 merged

PR #2089 merged (`eca2825d`). No code finding fixed; two rounds of Codex
correction on the findings writeup itself, plus one small frontend fix Codex
caught along the way:

1. **Scope-methodology error, caught round 1.** The pass's original "all
   nine files byte-identical to pass 1" claim was false for one file —
   `core/security_middleware.py` was rewritten by PR #1917 (an unrelated
   feature, "core-infra," merged four days after pass 1) — the diff had been
   run against the wrong baseline. #1917 actually fixed a real bug (session-
   hijack/data-exfiltration detection read `user_id` before it existed on
   the request, so those detectors never fired; also added a missing
   `db.commit()`), which meant SEC2-28-7's wiring/severity claims needed
   re-deriving against the corrected code, not the stale assumption.

2. **SEC2-28-7 corrected across both rounds.** Original claim: all five
   detector paths fire `ThreatLevel.CRITICAL` and are visible only via a
   raw DB/API query. Actual: only `detect_session_hijack` and
   `report_privilege_escalation_attempt` are unconditionally CRITICAL;
   `detect_brute_force` is HIGH; `detect_data_exfiltration` is HIGH,
   escalating to CRITICAL only on 5× cumulative volume (its
   external-destination CRITICAL branch is dead code — the sole call site
   never supplies `destination`). Three of the five detectors already write
   an org-scoped audit-log row `AuditLogPage` displays — the real gap for
   those three is a missing alert-specific ack/resolve UI, not
   invisibility. Two findings widened instead: brute-force alerts carry
   `user_id=None` on every failed login unconditionally, so they get
   `organization_id=NULL` and are excluded by every org-scoped alert query
   — no frontend fix alone closes this, it needs a platform-level
   alert-viewing design; and `SecurityMonitoringMiddleware` only checks
   exfiltration when the response has `Content-Length`, which
   `StreamingResponse` never sets — confirmed at three of the fifteen
   `EXPORT_ENDPOINTS` routes that build the full export in memory and still
   never set it, so those exports create no alert at any size (a backend
   gap, not a UI one). The remediation note also originally named only
   `resolve` as needing `audit.export`; `acknowledge` requires the same
   permission and was missing.

3. **Small fix, both rounds.** `IPSecurityAdminPage`'s route required only
   `security.manage` while `ip_security.py` accepts `security.manage` OR
   `settings.manage`, refusing a `settings.manage`-only admin the page the
   API would authorize. Fixed via `ProtectedRoute`'s `requiredAnyPermission`
   — which immediately turned CI red via `testingRegistry.test.ts`'s route-
   gate comparison test, since `testingRegistry.ts`'s own entry needed the
   same update; fixed in a follow-up commit. The doc's first draft had
   credited the wrong tests (`routeIntegrity.test.ts`, an unrelated store
   test) with covering this change — corrected to credit the actual
   gate-comparison test.

CI green (17/17), all ten review threads across two rounds resolved, no
merge conflict. See `docs/security-review/SEC2-28-security-audit-ip.md` for
the full writeup.

---

### 2026-08-31 — Feature 28 (Security, audit & IP), pass 2 — 0 fixed, 1 flagged (HIGH-operational) — PR pending

No security-review PR was open (feature 27/Integrations fully merged via PR
#2088), so the rotation continued to feature 28. Loaded `CHECKLIST.md`,
`SEC-00-cross-cutting-baseline.md`, pass 1's own findings doc
(`SEC2-28-security-audit-ip.md`, PR #1911), `docs/module-audit/
security-audit-ip.md`, and `docs/app-review/security-audit-ip.md`; re-verified
their open items rather than re-deriving them.

Diffed all nine backend files this feature covers against the commit pass 1's
PR merged as, and originally reported **byte-identical, zero lines changed**
across all nine — wrong for one: `core/security_middleware.py` changed by
159 additions / 117 deletions in PR #1917 (feature 33, "core-infra," merged
2026-08-27, four days after pass 1's #1911), which the diff was run against
the wrong baseline and missed. Codex review caught it (see the full writeup
in `SEC2-28-security-audit-ip.md` for what #1917 actually changed — mainly,
it fixed session-hijack/data-exfiltration detection's user-id timing bug and
a missing `db.commit()`, so those detectors are now genuinely wired where
pass 1 had no way to know they weren't yet). All six pass-1 findings
(SEC2-28-1 through SEC2-28-6) re-verified directly against current code: the
four fixes are intact (129/129 scoped tests pass), and the two flagged items
(SEC2-28-5 — approved IP-allowlist exceptions have no enforcement effect;
SEC2-28-6 — TOCTOU on the duplicate-exception check) still reproduce exactly
as described, unchanged — none of the six touch `security_middleware.py`'s
IP-enforcement path, so this correction doesn't affect them.

**Frontend reviewed for the first time this pass** (pass 1 was backend only):
`modules/ip-security/` (admin page, store, service, components),
`AuditLogPage.tsx`, `ErrorMonitoringPage.tsx`. No `window.confirm`/`alert`/
`prompt`, no `dangerouslySetInnerHTML`, no banned date methods, all three
`/security/`, `/audit-logs`, `/ip-security/` prefixes correctly excluded from
the API cache, module axios auth inherited correctly. Route permission gates
were originally reported as all matching their backend endpoints — wrong:
`IPSecurityAdminPage`'s route required only `security.manage` while
`ip_security.py` accepts `security.manage` OR `settings.manage`, refusing a
`settings.manage`-only admin the page the API would authorize them for.
Codex caught it; fixed by switching to `ProtectedRoute`'s
`requiredAnyPermission`. That alone turned CI red: the actual test covering
route permissions, `testingRegistry.test.ts`'s `repeats each route gate
exactly` (a second Codex catch — the first fix's own summary had credited
`routeIntegrity.test.ts` and the ip-security store test, neither of which
touches permissions at all), diffs every route against `testingRegistry.ts`,
which still declared the old single permission; updated to match. Verified
with `tsc --noEmit`, `eslint`, and the full frontend suite (5520/5520).

**SEC2-28-7 (HIGH — operational-security value, not an access-control bypass;
flagged, not fixed) — corrected after Codex review.** The original writeup
overstated severity (claimed all five detector paths fire
`ThreatLevel.CRITICAL`; actually `detect_brute_force` is `HIGH`, and
`detect_data_exfiltration` is `HIGH`, escalating to `CRITICAL` only when the
24h cumulative total exceeds 5× the single-transfer threshold — it also
accepts a `destination` argument that would escalate an external transfer,
but the sole production call site never supplies it, so that branch is
unreachable as currently wired (a third Codex catch) — only
`detect_session_hijack`/`report_privilege_escalation_attempt` are
unconditionally `CRITICAL`) and overstated the visibility gap (claimed
"only a direct DB/API query surfaces one" for all five; actually
`detect_session_hijack`/`detect_data_exfiltration`/
`report_privilege_escalation_attempt` each write an org-scoped
`log_audit_event` call already visible via the existing `AuditLogPage` — the
real gap for those three is narrower: no alert-specific ack/resolve UI).
Two corrections _widen_ the finding instead: brute-force alerts are called
with `user_id=None` on every failed login (unconditionally — `user` is
`None` on both an unknown username and a wrong password), so
`_add_alert` stamps `organization_id=NULL` and every org-scoped query
(`get_recent_alerts`/`acknowledge_alert`/`resolve_alert`) excludes them
structurally — no realistic frontend fix closes this without a new
platform-level alert-viewing design, a bigger question than a UI build; and
`SecurityMonitoringMiddleware` only checks exfiltration when the response
carries `Content-Length`, which `StreamingResponse` (confirmed at three of
the fifteen `EXPORT_ENDPOINTS` routes: `admin_hours.py`,
`equipment_check.py`, `finance.py`) never sets even though the full export
is already built in memory first — bulk CSV exports through at least those
three routes create no exfiltration alert at any size, a backend gap, not a
missing UI. `security_monitoring.py`'s 13-endpoint alert-management surface
genuinely has zero frontend consumers either way (`securityService` in
`adminServices.ts` wraps five of them but is called from nowhere, confirmed
by exhaustive grep; the other eight have no wrapper at all), and this
feature's other three backend files (`audit_logs.py`, `error_logs.py`,
`ip_security.py`) do have working, permission-gated admin screens — that
part of the original finding holds. See
`docs/security-review/SEC2-28-security-audit-ip.md` for the full,
corrected writeup. Mirrored into `docs/KNOWN_LIMITATIONS.md`.

Also noted (not fixed, low severity, fails safe both directions): the
`/admin/errors` route gates on `settings.manage` while its `error_logs.py`
endpoints require `audit.view`/`audit.export`/`audit.manage` — a
permission-string mismatch, not a bypass in either direction.

Full local completion gate: flake8/black/isort clean on the 9 backend files
this feature covers (no backend code changed); 129/129 scoped backend tests
pass; `tsc --noEmit` 0 errors; `eslint` 0 errors/warnings on the files
reviewed; full frontend suite (`npx vitest run`) 5520/5520 pass, including
the route-permission fix and its `testingRegistry.ts` update. Findings
appended to `docs/security-review/SEC2-28-security-audit-ip.md`'s existing
Pass 1 doc as a new Pass 2 section, corrected across two rounds of Codex
review on this PR. Rotation row 28 → ⏳ pending this PR's merge.

---

### 2026-08-31 — Feature 27 (Integrations), pass 2 ✅ PR #2087 merged

PR #2087 merged (`53ebd0ac`). One finding, one Codex correction round:

1. **INT-6 (LOW-MED, fixed).** `test_integration_connection()`'s per-connector
   implementations mostly raise hand-authored, safe messages on their
   expected failure paths, but several don't wrap every outbound call, so an
   unhandled infra-level exception (DNS, TLS, timeout) could still reach two
   client-facing sites unsanitized — `POST /integrations/{id}/test-connection`
   and `GET /integrations/salesforce/readiness`. Fixed by routing both
   through `sanitize_error_message()`.

2. **Codex correction, same commit round.** `sanitize_error_message()`'s
   pattern blacklist doesn't cover generic DNS/TLS/timeout text (e.g.
   `[Errno -2] Name or service not known` matches none of its SQL/path/
   traceback patterns), so the exact scenario INT-6 was written to close
   still leaked. Fixed by adding `sanitize_connector_error()`
   (`app/core/utils.py`), which checks the exception's _type_ instead: only
   an exact-type `Exception` (or the one named trusted subclass,
   `PayPalError`) is treated as a connector's own hand-authored message —
   anything else always gets the generic fallback regardless of content.
   That investigation also surfaced a sharper instance of the same root
   problem: three connectors (`google_calendar_service.py`,
   `outlook_calendar_service.py`, `weather_service.py`) caught broadly and
   re-raised as `Exception(f"...: {e}")`, interpolating the raw caught
   exception into a message that _is_ exact-type `Exception` — exactly what
   a type check (correctly) trusts. Fixed by dropping the interpolation in
   all three; they now log the real exception server-side and raise a
   static message instead. Also caught a second, previously-unfixed
   `check_readiness` catch site (the per-sObject `get_field_names` lookup)
   with the same defect as the two named in the original finding.

CI green (17/17), one review thread resolved, no merge conflict. See
`docs/security-review/INT-27-integrations.md` for the full writeup.

---

### 2026-08-31 — Feature 27 (Integrations), pass 2 ⏳ PR #2087 opened

Re-read all five backend files in full (`integrations.py`, `salesforce_sync.py`,
`salesforce_service.py`, `salesforce_oauth_service.py`,
`salesforce_sync_service.py`) plus `schemas/integration.py`. File sizes
essentially unchanged since pass 1 (PR #1910); re-verified INT-1 through
INT-5 all still hold, INT-5 still an open owner decision. Enumerated all 16
routes across both endpoint files with their auth dependency, permission,
and org-scoping — no gap.

1. **INT-6 (LOW-MED, fixed).** Prompted by FORM-9 landing one file over in
   the same feature 26 pass, checked every `except Exception` in this
   feature's files against where its message ends up. Two sites returned
   an unhandled connector exception's raw `str(e)`/`str(exc)` straight to
   the client: `POST /integrations/{id}/test-connection` and
   `GET /integrations/salesforce/readiness`. Most connector failure paths
   raise a safe, hand-authored message, but not every outbound call inside
   them is individually wrapped, so an unhandled infra-level exception
   (DNS, TLS, timeout) could still reach the client unsanitized. Fixed by
   routing both through `sanitize_error_message()` — not
   `safe_error_detail()`, which only passes through `ValueError`/
   `PermissionError` and would have replaced every intentional connector
   message with the generic fallback, since these connectors raise bare
   `Exception`. Two guard tests per site (leak case + hand-authored-message
   passthrough case), all verified to fail on reintroduction.

Full local completion gate green: flake8/black/isort clean across
`app/ tests/ alembic/`, `validate_migrations.py --strict` passed (394
revisions, single head), 1561/1561 integration/salesforce-scoped tests pass
(21 skipped, all environment-only). No frontend file changed —
`tsc`/`eslint` n/a. Findings doc: `docs/security-review/INT-27-integrations.md`.

---

### 2026-08-31 — Feature 26 (Forms), pass 2 ✅ PR #2085 merged

PR #2085 merged (`8f42de4d`). One finding, one Codex correction round:

1. **FORM-9 (LOW-MED, fixed).** Three prior review passes (module-audit
   iteration 13, app-review pass 1, this doc's own pass 1) had misjudged six
   `except Exception as e:` sites in `forms_service.py`'s integration
   processors as "internal, never returned to the client" — the dict those
   blocks build is persisted to `submission.integration_result`, which
   `FormSubmissionResponse` serializes straight back on
   `submit_form`/`get_submission`/`list_submissions`/
   `reprocess_submission_integrations`, and `SubmissionViewer.tsx` renders
   it verbatim. Fixed by routing all six through `safe_error_detail(e)`,
   matching the existing FORM-7 pattern.

2. **Codex correction, same commit round.** A seventh site had the same
   shape but not the same fix: `InventoryService.assign_item_to_user()`
   never raises on failure, it returns `(None, str(e))`, so
   `_process_equipment_assignment`'s `if error: return {"success": False,
"error": error}` branch returned that raw string untouched — no
   exception ever reaches the `except`-block sanitizer. `error` here is
   already a plain string, not an `Exception`, so `safe_error_detail`
   doesn't apply; fixed by routing it through `sanitize_error_message()`
   instead (the sibling helper `inventory.py`'s own caller already uses for
   this exact tuple shape). Both sites now have dedicated guard tests,
   each verified to fail on reintroduction.

CI green (17/17), one review thread resolved, no merge conflict. See
`docs/security-review/FORM-26-forms.md` for the full writeup.

---

### 2026-08-31 — Feature 25 (Messaging & notifications), pass 2 follow-up ✅ PR #2083 fully merged

PR #2083 merged (`7ce4c24e`). What started as a HIGH-severity migration fix
(MSG-11) turned into six rounds of Codex review, all real, all resolved:

1. **The premise itself was false.** `positions`/`user_positions` are not
   create_all-only — `20260805_0008_rename_roles_to_positions.py` renames
   `roles`/`user_roles` (created by the initial schema migration) to those
   names, and is a required upgrade-path ancestor of the message-recipients
   migration. Verified empirically with a real `alembic upgrade head`
   against a fresh, correctly-collated database: the full 394-revision
   chain completes with no `NoSuchTableError`. Reverted the guard entirely
   — its early-return path was untested dead code that, per a second
   Codex finding, would have silently dropped the recipient backfill (and
   permanently hidden existing messages from inboxes) had it ever actually
   triggered.
2. **The real fix:** `_tables_created_by_migrations` in
   `test_migration_create_all_tables.py` now recognizes `op.rename_table`
   destinations, the actual root cause of the false positive.
3. **Four more rounds hardened that fix and its sibling detector,
   `_find_autoload_offenders`** (kept as an independent ratchet against a
   real future unguarded-reflection bug): scoping both to `upgrade()` only
   via a new `_upgrade_body` helper (a downgrade-only rename or
   downgrade-only helper must not count — the dangerous direction, since
   either hides a real create_all-only table from the ratchet); including
   helper functions `upgrade()` delegates to, directly or via a
   lambda/dispatch table (two real migrations use this shape); running the
   reachability check against a comment/string-stripped view of the text
   (via the stdlib tokenizer) so a helper named only in a comment doesn't
   count; and broadening `_AUTOLOAD_TABLE`'s regex to match a bare
   `Table(...)` import, reordered arguments, and one level of nested
   parens. Twelve review threads total, every one addressed with a fix and
   a pinning test, not just a reply.
4. **MSG-12 grew from one crash-window scenario to three** as two separate
   Codex findings pointed out that an ordinary provider failure
   (`status="failed"`) and a throttled send (no row created at all) hit the
   same permanent-non-retry wall as the originally-reported stranded
   `pending` claim — the throttled path needs no crash or outage at all,
   arguably making it the most likely of the three in practice.
5. Also fixed the same stale "positions is create_all-only" claim in
   CLAUDE.md's own Pitfall #26 (which had misled the original MSG-11
   report) and in this test file's own module docstring.

Full local gate green throughout (22 tests in the migration file, up from
13; 1175 scoped + 9300 full backend tests by the final commit); CI green on
the final head (17/17 checks), no merge conflict. Rotation row 25 → ✅.
Next: 26 Forms.

---

### 2026-08-31 — Feature 25 (Messaging & notifications), pass 2 follow-up — initial assessment (0 fixed, 1 flagged; see corrections below for the retracted HIGH finding)

A second, independent security-review iteration reached feature 25 pass 2 at
essentially the same moment as the entry directly below — both found no open
PR at Step 0, both reviewed the same PR #1938 recipient-materialization
architecture, and both pushed to the same conventional branch name
(`claude/security-review-messaging-notifications-pass2`) within minutes of
each other. Discovered the collision at push time (`git push` rejected,
`git ls-remote` showed the branch already existed with PR #2081 open), and
discovered it a second time when a first merge-onto-their-branch attempt was
itself rejected — the other session had pushed an additional commit
(Codex's review of PR #2081 catching an id collision in that session's own
write-up) in the interval. Rebased a second time onto that tip, renumbered
this session's findings to MSG-11/MSG-12 to stay clear of the ids already in
use, and was about to push the combined branch when PR #2081 merged to
`main` out from under it (`git fetch` came back with "couldn't find remote
ref" — the branch was deleted on merge). Per CLAUDE.md Pitfall #24, that
branch name is not reused. This finding — a real, unaddressed HIGH-severity
migration bug the other session's PR did not touch — is instead delivered as
a small follow-up PR against current `main` (which already contains #2081)
rather than silently dropped.

**MSG-11 (initially reported HIGH/fixed; corrected below to not
reproducible)** — `20260826_1700_d4e5f6a7b8c9_message_recipients.py`
(the same PR #1938 backfill migration PR #2081's "New architecture reviewed"
section had already read for a different question) reflects `positions` and
`user_positions` with raw `sa.Table(..., autoload_with=bind)` and, at the
time this was written, had no existence guard. This paragraph pattern-matched
CLAUDE.md Pitfall #26 (`positions` is one of that section's own listed
examples) and concluded `alembic upgrade head` against a fresh/empty
database would raise `NoSuchTableError` on this reflection and fail the
whole migration chain, the same way the `event_requests` incident on
2026-08-24 did. **This was not verified against a real fresh-database run at
the time, and turned out to be wrong** — see the correction entry directly
below, written the same day after Codex's review of this PR caught it.

**MSG-12 (LOW-MED, flagged)** — a worker crash between
`MessageDeliveryService._claim_delivery`'s commit and
`_finish_delivery`'s follow-up commit leaves a `DepartmentMessageDelivery`
row permanently `status="pending"`: the same unique
`(message_id, recipient_id, channel)` constraint that makes retries safe
also means nothing ever retries a stranded claim, and no sweep exists to
detect or expire stale pending rows. Narrow blast radius (needs a crash in
an exact window) but affects whichever channel strands, including email —
this feature's own "record of notice." Needs a product decision on
stale-claim policy (TTL, automatic retry vs. admin alert, duplicate-send
risk tradeoff); mirrored into `KNOWN_LIMITATIONS.md`.

New guard tests: `backend/tests/test_migration_create_all_tables.py` gained
a second detector (`_find_autoload_offenders`/`_AUTOLOAD_TABLE`) — the
existing ratchet only recognized `op.*` calls and could not have caught
MSG-11, since `sa.Table(..., autoload_with=bind)` is a raw SQLAlchemy Core
call — plus the real-migrations assertion and two pinning tests. Full local
completion gate re-verified green against current `main` (which already
includes #2081): flake8/black/isort (8.0.1, CI's pin) clean, migrations
validated (394 revisions, single head), 1036/1036
messaging+notifications+email-scoped and 9291/9291 full backend suite pass
(22 pre-existing skips), `tsc --noEmit` 0 errors, `eslint .` 0 errors (8
pre-existing warnings, none touched). Findings appended to
`docs/security-review/MSG-25-messaging-notifications.md`'s existing Pass 2
section (MSG-11/MSG-12, continuing #2081's own MSG-9/MSG-10). Rotation row
25 stays `⏳` — a HIGH-severity, CI-breaking fix is still outstanding, so
the feature is not fully closed until this follow-up PR merges too. PR
[#2083](https://github.com/thegspiro/the-logbook/pull/2083) opened (never
reusing #2081's now-merged branch name, per Pitfall #24) and subscribed.
Next: 26 Forms, once this merges.

**Correction (2026-08-31, on this same PR #2083):** Codex's review of PR
#2083 raised four findings on the MSG-11 guard, the most serious (P1) being
that on any real (non-CI-ephemeral) database that had already hit the
crash MSG-11 described, the guard's own `CREATE TABLE`/`CREATE INDEX`
statements would already have implicitly committed (MySQL DDL auto-commits
per statement) without Alembic stamping the revision, so a retry after
deploying the guard would fail again — this time on "table already exists."
Investigating that finding surfaced a second Codex comment questioning
MSG-11's premise entirely: `positions`/`user_positions` are not actually
create_all-only, because `20260805_0008_rename_roles_to_positions.py`
renames `roles`/`user_roles` (created by the initial schema migration) to
those names, and is a required upgrade-path ancestor of the message-
recipients migration. Verified this empirically rather than trusting the
re-reading: created a fresh, correctly-collated MySQL database and ran
`alembic upgrade head` against it from `base` — the full 394-revision chain,
including the message-recipients migration, completed with no
`NoSuchTableError`, and `positions`/`user_positions` existed while
`roles`/`user_roles` did not (confirming the rename had run). Also confirmed
via `ScriptDirectory.walk_revisions` that the rename migration is a required
DAG ancestor, not merely an artifact of this run's ordering. **MSG-11 does
not reproduce.** Reverted the guard (its early-return path was untested
dead code resting on a false premise, and per Codex's fourth finding, had it
ever triggered on a database missing exactly one of the two tables, it would
have silently skipped the backfill and stamped success — permanently
dropping existing messages from members' inboxes on any installation that
already had real data, since inbox visibility now derives from the
`DepartmentMessageRecipient` join). Fixed the actual root cause instead:
`_tables_created_by_migrations` in `test_migration_create_all_tables.py`
only recognized `op.create_table`, not `op.rename_table` destinations —
now it does. Kept the new `_find_autoload_offenders`/`_AUTOLOAD_TABLE`
detector as a ratchet with independent value against a real future instance
of this reflection-without-guard shape; it now correctly reports zero
offenders for the current chain. Left open, not addressed: Codex's third
finding that `_guarded_tables` scans whole-file text rather than being
scoped to `upgrade()` — a pre-existing limitation of the whole detector
family, not introduced by this PR, out of scope for this pass. Full local
gate re-verified green (flake8/black/isort/migrations/1166 scoped +
9291 full backend tests), plus the fresh-database empirical check above
that no static gate would have caught either the original false alarm or
this correction. See MSG-11 in the findings doc for the complete writeup.
Rotation row 25 still `⏳` pending this PR's merge; MSG-12 unaffected. Next:
26 Forms, once this merges.

**Second correction (2026-08-31, same PR):** two further rounds of Codex
review, both on code this correction had just added, both real. (1)
`_AUTOLOAD_TABLE`'s regex matched only one exact call spelling and missed a
bare `Table(...)` import, reordered/extra arguments, and a nested-call
argument (`sa.MetaData()`) — broadened it, with pinning tests per shape
plus a negative test. (2) The `op.rename_table` recognition just added to
`_tables_created_by_migrations` scanned whole files, so a rename
destination appearing only in a migration's `downgrade()` (undoing an
`upgrade()`-side rename) would be wrongly credited as migration-created —
the dangerous direction, since it removes a real create_all-only table from
that set. Added `_upgrade_body` to scope both the `create_table` and
`rename_table` scans to `upgrade()` only; its first version (matching only
an unannotated `def upgrade():`) matched nothing against this codebase's
`def upgrade() -> None:` convention and was caught before shipping by
diffing its output against the unscoped scan on the real chain, not by
review. Re-verified `positions`/`user_positions` still correctly excluded
from create_all-only after the fix (40-table set, unchanged). Full local
gate green again (17 tests in this file, up from 13; 1170 scoped +
9291 full backend). See MSG-11 in the findings doc for the complete writeup.

### 2026-08-31 — Feature 25 (Messaging & notifications), pass 2 ✅ PR #2081 fully merged (PR #2082 closed the tracker)

PR #2081 merged (`7d4c8fda`). Codex's review flagged two real issues on the
first commit: a finding-id collision (the flagged `reconcile_recipients`
item in `KNOWN_LIMITATIONS.md` reused `MSG-9`, already assigned to the fixed
`get_message_stats` org-scoping issue) and an overstated claim that
narrowing a message's audience "destroys acknowledgment history" — it
overlooked the independent, tamper-evident `message_acknowledged` audit-log
entry `reconcile_recipients` never touches. Fixed by renaming the
limitation to MSG-10 (with cross-references updated in the findings doc and
this tracker) and rewording the claim to distinguish the acknowledgment
report's/inbox's lost record from the surviving audit trail. A third Codex
comment (stale `## Open PR` header) was already addressed by the prior
commit. All three review threads resolved; CI green on the final head
(17/17 checks), no merge conflict.

**Correction (2026-08-31, on the closing PR #2082):** Codex's review there
caught that the "surviving audit trail" framing above overstated it too —
`AuditLogger.create_log_entry` (`app/core/audit.py:265-270`) is deliberately
fail-open and `acknowledge_message` never checks its return value, so the
`message_acknowledged` audit-log write is best-effort, not guaranteed. Fixed
across three separate spots Codex caught one at a time (the `KNOWN_LIMITATIONS.md`
body, its own heading, and this tracker's original PR #2081 summary below) to
say the report/inbox loss is reliable while the audit-trail survival is
conditional on that write having succeeded. PR #2082 merged (`c71913ec`),
marking rotation row 25 ✅ — **before** a second, independent security-review
session's PR #2083 (see entry above) surfaced the still-outstanding
HIGH-severity MSG-11 migration bug, which reopened row 25 to `⏳`. Next: 26
Forms, once #2083 merges.

### 2026-08-31 — Feature 25 (Messaging & notifications), pass 2 — 1 fixed (LOW-MED), 1 flagged (LOW-MED) — PR #2081 ✅ merged

No security-review PR was open (feature 24/Meetings & minutes pass 2 fully
merged via PR #2080), so the rotation continued directly to feature 25.
Loaded `CHECKLIST.md`, `SEC-00-cross-cutting-baseline.md`, pass 1's own
findings doc (`MSG-25-messaging-notifications.md`, PR #1907), the module-audit
docs (`docs/module-audit/messaging.md`, `docs/module-audit/notifications.md`),
and the 4-5-pass app-review docs (`docs/app-review/messaging.md`,
`docs/app-review/notifications.md`, `docs/app-review/email-templates.md`).

Messaging's architecture changed materially since pass 1: PR #1938 (merged
2026-08-27, after pass 1 closed) replaced live in-Python audience
re-evaluation with a durable `DepartmentMessageRecipient` table, materialized
at publish time and reconciled on an audience edit. Re-read
`messaging_service.py` (now 1047 L), `messages.py`, and `message_history.py`
in full against that change; confirmed `notifications.py`/
`notifications_service.py`/`push_service.py`/`notification_rules.py`/
`notification_channels.py`/`integration_services/notification_dispatch.py`
and the whole email-templates surface unchanged since pass 1 (git history
shows only a no-op merge touching those files) and spot-checked each pass-1
fix directly against current code rather than re-deriving. All eight pass-1
fixes (MSG-4 through MSG-8, the Codex-round `cc_emails` legacy-read fix)
confirmed intact.

**Frontend reviewed for the first time this rotation** (pass 1 was backend
only): `modules/communications/` (messaging admin/inbox, email-template
editor/preview/scheduler), `modules/notifications/`, `NotificationsPage.tsx`,
`usePushNotifications.ts`. All verified good — no `window.confirm`/`alert`/
`prompt`, no `dangerouslySetInnerHTML` (department-message bodies render via
the script-safe `LinkifiedText` component), the email-template preview iframe
is `sandbox="allow-same-origin"` with no `allow-scripts` (blocks script
execution regardless of template content), no direct `fetch(`, no banned
date-formatting methods, update payloads send explicit nulls correctly on
edit, `UNCACHEABLE_PREFIXES` coverage current, and route permission gates
match all enumerated backend permission strings.

**MSG-9 (LOW-MED, fixed)** — `get_message_stats`'s `read_count`/`ack_count`
queries filtered only by `message_id`, not `organization_id`, unlike
`targeted_count` three lines below and every other by-id query in the file.
Not currently exploitable (`message_id` is always pre-resolved through an
org-scoped `get_message_by_id` call one line above), but one refactor away
from a real cross-tenant read. Fixed by adding the missing filter; guard test
added that inspects the compiled `WHERE` clause and fails on reintroduction
(verified by reproducing the bug locally and confirming the test catches it).

**Flagged (MSG-10, not fixed, recorded in `docs/KNOWN_LIMITATIONS.md`)** —
`reconcile_recipients` hard-deletes a member's `DepartmentMessageRecipient`
row, including `read_at`/`acknowledged_at`, the moment an audience edit no
longer targets them — reliably erasing that member's record from
`get_acknowledgment_report` (which the same file's own `delete_message`
docstring calls "compliance evidence"). An independent `message_acknowledged`
audit-log entry may also exist, but that write is best-effort, not
guaranteed — `AuditLogger.create_log_entry` is deliberately fail-open and
`acknowledge_message` never checks its return, per Codex's review of the
closing PR #2082 — so whether any evidence survives beyond the report/inbox
depends on whether that write happened to succeed. Not mechanically fixable
like MSG-9 (the org-scoping fix above): keeping resolved rows would also keep
the message visible in that member's inbox (visibility is a join on the same
table), which is a product decision, not a bug fix. Not cross-tenant.

Also corrected a stale doc: `docs/app-review/email-templates.md` still marked
MAIL-3 (attachment magic-byte validation) as OPEN; the code already fixes it
(fails closed with a 503 when libmagic is unavailable) — pass 1's own
"Verified good" section had already confirmed this but never corrected the
doc it was re-checking against.

Full local completion gate green: flake8/black/isort (CI's 8.0.1 pin)
clean across `app/ tests/ alembic/`, `validate_migrations.py --strict` passed
(394 revisions, single head), 1100/1100 messaging+notifications+email-template
scoped tests and 9288/9288 full backend suite passed, `tsc --noEmit` 0 errors,
`eslint .` 0 errors (8 pre-existing warnings, none in touched/reviewed files).
PR #2081 opened and subscribed. Next: 26 forms, once this PR merges.

### 2026-08-31 — Feature 24 (Meetings & minutes), pass 2 ✅ fully merged — PR #2079

PR #2079 merged (`6b33538c`). Codex's review flagged one real issue on the
new guard test (`MinutesDetailPage.unlinkEvent.test.tsx`): a `vi.clearAllMocks()`
in `beforeEach` that CLAUDE.md Pitfall #28 already documents as leaving stale
implementations behind — fixed by resetting each mock explicitly before
installing its default, verified against the actual test and eslint, and
pushed. Thread resolved; no further findings on the re-review. CI green on
the final head (17/17 checks), no merge conflict. Rotation row 24 → ✅.
Next: 25 messaging & notifications.

### 2026-08-31 — Feature 24 (Meetings & minutes), pass 2 — 3 fixed (LOW-MED, LOW, MED), 1 flagged (LOW-MED)

No security-review PR was open (feature 23/Medical supplies pass 2 fully
merged via PR #2078), so the rotation continued directly to feature 24.
Loaded pass 1's findings doc (`MM-24-meetings-minutes.md`, PR #1906), the
module-audit and app-review docs (`docs/module-audit/meetings-minutes.md`,
`docs/app-review/meetings-minutes.md`, 4 passes), and re-checked CLAUDE.md's
pitfalls against the code rather than re-deriving anything those already
settled.

Scoped to the full backend surface since pass 1's merge: `quorum_service.py`
is the only file that moved (+1 line, `populate_existing=True`), landed by
the **elections** module's own ELEC-06 pass-2 review since `quorum_service.py`
is shared between meetings and elections quorum math — re-read directly and
confirmed correct, no regression to MM-4's own fix. Re-verified all seven
pass-1 fixes (MM-1 through MM-7) by reading the current code, and re-ran a
route enumeration from scratch: 17/17 `meetings.py` and 25/25 `minutes.py`
routes, matching pass 1 exactly, all `require_permission`-gated. Every by-id
query in both services re-swept for a missing `organization_id` filter — no
gap.

**Frontend scope established for the first time this pass** (pass 1 was
backend-only): `frontend/src/modules/minutes/` (3,166 L) plus
`frontend/src/services/meetingsServices.ts` (the `Meeting` client). Swept for
`window.confirm`/`alert`/`prompt` (0 — `useConfirm()` used throughout),
`dangerouslySetInnerHTML` (0), banned `.toLocale*`/`date-fns` (0), and direct
`fetch(` (0 — both the module's own `createApiClient()` instance and the
global `apiClient` carry auth interceptors, Pitfall #7 satisfied). Confirmed
`/meetings` and `/minutes-records` (the real mount prefix for `minutes.py`'s
router — not `/minutes`) are both already covered in `UNCACHEABLE_PREFIXES`.

**MM-8 (LOW-MED, fixed)** — `meetings.py` had audit logging on exactly one
of its ten mutating routes (`grant_attendance_waiver`); the other nine
(create/update/delete/approve on `Meeting`, attendee add/remove, action-item
CRUD, and the event-bridge create) left no trace at all, despite `Meeting`
carrying the same governance-content shape (`agenda`/`notes`/`motions` text,
an approval workflow) `minutes.py` already audits on every write. Not a dead
API surface — `MinutesPage.tsx`'s "New Meeting" flow calls
`meetingsService.createMeeting()` directly. Fixed by adding `log_audit_event`
to all nine routes, matching this file's own established convention.

**MM-9 (LOW-MED, flagged, not fixed)** — `approve_meeting` has neither an
approval state-machine guard (it sets `APPROVED` unconditionally from any
status) nor a separation-of-duties check, unlike its sibling
`approve_minutes`. Not mechanically fixable like MM-5 was: `Meeting` has no
`submitted_by` field or submit step, so there's no natural "the submitter
can't also approve" comparison to apply — only `created_by`, and blocking
self-approval against that would block the common single-secretary
create-and-approve workflow, a product decision rather than a bug fix.
Mirrored into `KNOWN_LIMITATIONS.md`.

**MM-10 (LOW, fixed)** — `create_meeting_from_event` was the one error path
in `meetings.py` that forwarded a raw service-layer error string via
`detail=error` with no `safe_error_detail`/`sanitize_error_message` pass;
`create_from_event`'s own `except Exception: return None, str(e)` branch
means that string is not always one of the two hand-written messages. Fixed
by routing through `sanitize_error_message()`, the established convention
for this exact "raw string, not an exception object" shape.

**MM-11 (MED, fixed, frontend)** — `MinutesDetailPage.tsx`'s "Unlink event"
button sent `{ event_id: undefined }`, which `JSON.stringify` drops
entirely — the PUT body was `{}`, so the backend's `exclude_unset=True` read
it as "field not touched" and never cleared the link, despite an "Event
unlinked" success toast (CLAUDE.md Pitfall #1's own update-vs-create
mirror-image). Fixed by sending an explicit `{ event_id: null }`. Swept the
rest of the module for the same shape — no other instance found (the
remaining `: undefined` sites are create-form `useState` defaults, correct
as-is).

New guard tests: `backend/tests/test_meetings_audit_trail.py` (14 tests, one
per newly-audited route plus MM-10's sanitization cases) and
`frontend/src/modules/minutes/pages/MinutesDetailPage.unlinkEvent.test.tsx`
(1 test, confirmed to fail on the pre-fix `undefined` payload). Full local
completion gate green: flake8/black/isort (8.0.1, CI's pin) clean, migrations
validated (394 revisions, single head, no schema change), 219/219
meetings+minutes+quorum-scoped and 9287/9287 full backend suite pass (22
pre-existing skips), `tsc --noEmit` 0 errors, `eslint .` 0 errors (8
pre-existing warnings, none in touched files), `vitest run
src/modules/minutes` 23/23 passed. Findings doc:
`docs/security-review/MM-24-meetings-minutes.md` → Pass 2. PR
[#2079](https://github.com/thegspiro/the-logbook/pull/2079) opened and
subscribed. Rotation row 24 → ⏳ (awaiting PR merge). Next: 25 Messaging &
notifications, once this PR merges.

---

### 2026-08-30 — Feature 23 (Medical supplies), pass 2 ✅ fully merged — PR #2076 (audit-trail follow-up, MSUP-5/MSUP-6)

PR #2076 merged (`6567828e`). This was a second, independent pass-2 session
that started from the same pass-1 baseline as PR #2075 (log entry below)
and found a different finding — MSUP-5, the missing audit trail on
category/item updates — resolved as a merge conflict against #2075's
already-merged changes (see the tend-pass log entry above this one).
Codex's review of the merge caught a real bug in the MSUP-5 fix itself
(MSUP-6: the audit event could report the DB column name `extra_data`
instead of `metadata`, the field the caller actually changed) and two doc
accuracy issues (a reused `MSUP-2` identifier, a stale "no changes since
pass 1" baseline claim once this branch picked up #2075's merged work) —
all three fixed and their review threads resolved before merge. CI green
on the final head; no merge conflict remained after the earlier tend pass.
Rotation row 23 → ✅. Next: 24 meetings & minutes.

### 2026-08-30 — Feature 23 (Medical supplies), pass 2 ✅ merged — PR #2075

PR #2075 merged. 2 findings fixed (MSUP-2: N+1 domain-check loop in bulk
delivery validation; MSUP-3: `low_stock` tile undercounting past a page
cap — fixed across two rounds, ending on the existing
`get_low_stock_items_for_alerts` alert-scan method rather than a raised
cap), 1 flagged (MSUP-4: `get_expiring_lots` has no row cap, a product
decision spanning shared callers), and 1 write-up self-correction (baseline
members do already get medical-supply view access via the broad
`inventory.view` OR-gate — intentional, documented, no PHI). Codex's
review converged after MSUP-3's second fix; a third round asking for a
bare aggregate/count-only query was logged as a possible future
optimization rather than chased further, per this rotation's own
convergence-stop precedent (GF-27→GF-27a). Rotation row 23 → ✅. Next: 24
meetings & minutes.

### 2026-08-30 — Feature 23 (Medical supplies), pass 2 — 2 fixed (LOW, LOW/MED), 1 flagged (LOW); 1 doc self-correction

No prior module-audit or app-review pass exists for this feature (pass 1's
own scope note); this is the second security-review pass over it. The
endpoint file (`medical_supplies.py`) grew by only 3 lines since pass 1
(667 L → 670 L, no route added or removed) — the growth is
`medical_supply_summary`'s pre-existing `_on_hand` low-stock calc, not new
and not security-relevant. `inventory_service.py`, this router's only
dependency, grew substantially in the interim (~7,450 L → 8,200 L) from
other features' reviews touching it, so every method this router actually
calls was re-read directly rather than trusted from pass 1's summary.
Re-verified against current code: MSUP-1's `apply_updates` fix still holds
in `update_category`/`update_item`/`update_lot`; `item_in_domain`/
`category_in_domain`/`lot_in_domain` still org-scope both sides of their
joins and fail closed; `get_items`'s domain filter and its
`_category_ids_of_type` subquery are still org-scoped inside the subquery;
`add_lots_bulk`'s XC-1 check still resolves every client-supplied
`inventory_item_id` in one org-scoped query before writing any lot; the
free-text search in `get_items` still uses `like_pattern` +
`escape=LIKE_ESCAPE_CHAR` (Pitfall #25).

The PR's first commit also claimed baseline grants restrict medical-supply
visibility (`_LINE_MEMBER_PERMISSIONS` grants only the broad
`inventory.view`, never `inventory.view_medical`) — **Codex correctly
caught this as a false conclusion**: every medical-view route OR-gates
`inventory.view_medical` against that same broad `inventory.view`, which
every firefighter/EMT holds by baseline, so every rank-and-file member can
already view medical-supply stock. This is the router's own stated design
(the split governs _manage_ authority, not view) and involves no PHI (this
is equipment stock, not the separate `medical_screening` PHI domain, row 09) — corrected the write-up, no code change needed for this one.

Codex's review of the same commit also caught two real bugs, both fixed:
**MSUP-2 (LOW)** `receive_medical_delivery` validated each delivery line's
domain membership with its own query (`_require_medical_item` in a loop) —
up to 200 sequential queries for a delivery near the schema's entry cap.
Fixed with a new bulk `InventoryService.items_in_domain`, resolving every
line in one query (Checklist §6, "no N+1 loop issuing a query per row").
**MSUP-3 (LOW/MED)** `medical_supply_summary`'s `low_stock` tile walked a
500-row-capped `get_items` page while `total_items` used the query's
separate, uncapped count — a department with more than 500 active medical
items got a `low_stock` number that silently excluded every low-stock item
past the 500th. First fix raised the internal cap to 10000 (matching the
CSV export's "whole org, one page" convention in `inventory.py`); Codex
correctly flagged that as still materializing up to 10000 full ORM rows
with eager loads just to derive a count, and still inexact above the new
cap. Replaced it instead with the existing (already used by the low-stock
alert email) `get_low_stock_items_for_alerts`, which filters on
`reorder_point IS NOT NULL` before loading any rows — given a new optional
`item_types` parameter to scope it to `MEDICAL_ITEM_TYPES`, `low_stock` is
now `len()` of that result with no page and no cap at any org size; no
`KNOWN_LIMITATIONS.md` entry needed. **MSUP-4 (LOW, flagged, not fixed)** —
`get_expiring_lots` (backs `/lots/expiring` and this same summary) has no
row cap; not a mechanical fix because it's a method shared with the main
inventory router and the low-stock/expiring alert email, so a cap changes
those callers' contracts too — needs a page-size decision per caller,
mirrored into `KNOWN_LIMITATIONS.md`. New guard tests:
`test_a_delivery_checks_domain_in_one_query_not_one_per_line`,
`test_low_stock_comes_from_the_uncapped_domain_scoped_scan`,
`test_total_items_does_not_depend_on_the_low_stock_scan`. Full local
completion gate green: flake8/black/isort clean, migrations validated (no
schema change), 112/112 inventory+medical_supplies-scoped and 9270/9270
full backend suite pass. Findings doc:
`docs/security-review/MSUP-23-medical-supplies.md`. PR #2075 opened and
subscribed. Next: 24 meetings & minutes, once merged.

---

### 2026-08-30 — Feature 23 (Medical supplies), pass 2 — 1 fixed, 0 flagged

This session's pass 2 review began independently and concurrently with the
session that opened PR #2075 (log entry above), from the same pass-1
baseline (PR #1905, 2026-08-26) — at the time this review started, neither
`medical_supplies.py` nor the `InventoryService` methods it calls had
changed since pass 1, so it began as a fresh re-verification rather than a
diff review. PR #2075 has since merged with its own additional fixes
(MSUP-2/MSUP-3, MSUP-4 flagged); this entry covers only the audit-trail
gap this session found independently, not a re-review of #2075's changes
— see MSUP-5 below (renumbered from this session's own draft "MSUP-2" in
the findings doc to avoid colliding with #2075's already-claimed MSUP-2).
Re-read all 14 endpoints directly (pass 1's "15" was a miscount) and
re-checked every pass-1 claim against the current code rather than
trusting the summary forward: domain pinning, the MSUP-1 `apply_updates`
fix, XC-1 FK validation on create/update, and LIKE-escaping on the shared
search — all confirmed still correct.

**MSUP-5 (new, LOW-MED, fixed)** — `update_medical_category` and
`update_medical_item` were the only writes on this router with no audit
trail: this file's own create routes audit, and `inventory.py`'s general
`update_category`/`update_item` audit their updates too, so the
medical-scoped router — arguably the higher-sensitivity path — was the one
place a category/item edit left no record. Both routes now call
`log_audit_event`, mirroring the exact pattern already used elsewhere in
this file and in `inventory.py`. Lot endpoints (add/receive/update/delete)
were left alone — they don't audit either, but neither do their exact
`inventory.py` equivalents, so that's a pre-existing cross-cutting gap, not
a medical-specific asymmetry. New guard tests (fail before/pass after) in
`tests/test_medical_supplies_domain.py`. Full gate green: flake8/black/isort
clean, migrations validated (no schema change), 577/578 scoped tests
(1 pre-existing skip), 9273/9295 full backend suite (22 pre-existing
skips). Findings doc: `docs/security-review/MSUP-23-medical-supplies.md`
→ "Pass 2" section. PR #2076 opened and subscribed.

**Tend pass (same day):** after PR #2076 was rebased onto #2075's merged
`main` to resolve the merge conflict between the two concurrent sessions'
work, Codex reviewed the merge commit and caught a real bug in the MSUP-5
fix itself: **MSUP-6 (new, LOW, fixed)** — `InventoryService.update_category`
renames a `"metadata"` key to the DB column name `"extra_data"` inside the
same dict `update_medical_category` passed it, in place, so the audit
event's `fields_updated` reported `extra_data` instead of what the caller
actually changed. Fixed by snapshotting `fields_updated` before the service
call; `update_medical_item` checked for the same shape and isn't affected
(`update_item` renames no keys). New guard test (fails before/passes
after). Full gate re-run green (577 scoped, 9273 full backend suite). Both
Codex threads on this PR addressed and resolved. Next: 24 meetings &
minutes, once #2076 merges.

### 2026-08-30 — Feature 22 (Grants & fundraising), pass 2 ✅ fully merged — PR #2073 (round-5 tend); duplicate PR #2072 closed

**Two concurrent sessions independently tended the same round-5 findings
(GF-30/GF-27a, then GF-31/GF-32/GF-33) after PR #2070 merged mid-review,**
each cherry-picking the orphaned post-merge commits onto its own fresh
branch per CLAUDE.md Pitfall #24: this session opened PR #2072
(`claude/security-review-grants-fundraising-pass2-r5`), another opened PR
#2073 (`claude/security-review-grants-fundraising-pass2-tend2`), off the
same `main` base (`71c1563b`). Both independently found and applied
identical fixes for GF-32 (a stale out-of-order response overwriting the
current filter) and GF-34 (a failed refetch leaving the previous filter's
rows on screen). Both also raised GF-31's 100-row fetch cap to 1,000
rather than closing it — that residual gap is GF-33 in the doc below,
**flagged, not fixed**: an org with more than 1,000 applications in one
status still silently truncates, recorded in `KNOWN_LIMITATIONS.md` rather
than claimed as resolved. PR #2073
reached a superset state first (it also included a fixture-typing nit from
Codex, fixed in `b513ce2e`) and was merged (`d7a0c456`); PR #2072 was
closed as a duplicate rather than merged, per the standing "never reuse or
re-open a closed PR" rule — no unique fix was lost, since everything in
#2072 is present in #2073's merged diff. All review threads on #2073 were
resolved before merge; nothing outstanding. Rotation row 22 → ✅. Next: 23
medical supplies.

### 2026-08-30 — Feature 22 (Grants & fundraising), pass 2 ✅ merged — PR #2070; round-5 tend continues in PR #2073

PR #2070 merged (`e6cf9b5b`) while its round-5 Codex review was still in
flight — the same shape as the #2069 → #2070 transition above. Two
commits fixing that round's 3 comments (GF-27a/GF-30, then GF-31) were
pushed to the branch after the merge and never reached `main`. Per
CLAUDE.md Pitfall #24, both commits were cherry-picked onto a fresh branch
(`claude/security-review-grants-fundraising-pass2-tend2`) off current
`main` and opened as PR #2073 — a clean cherry-pick, no conflicts, gate
re-run green (`tsc --noEmit` 0 errors, `eslint src/modules/grants-fundraising`
0/0, `vitest run src/modules/grants-fundraising` 3 files/5 passed).
Rotation row 22 stays ⏳. Next: 23 medical supplies, once #2073 merges.

**PR #2073 tend, round 6 (Codex review of the GF-31 commit, 2 comments):**
**GF-32 (new, MED, fixed)** — GF-31's own refetch-on-`statusFilter`-change
introduced a request race: `fetchApplications` unconditionally overwrote
`applications` with whatever response arrived, so a slower response from a
filter the user had already changed away from could clobber a newer one.
Fixed with a monotonic request-id guard in `grantsStore.ts` — a response is
only committed if no later call has started since. New guard test
`grantsStore.fetchApplications.test.ts` (fails before/passes after).
**GF-33 (new, LOW-MED, partially fixed/flagged)** — GF-31 fixed "the filter
runs after an unfiltered, 100-capped fetch" but not "the filtered fetch is
itself still capped at 100." This page has no pagination UI in either view
(it's built to show the org's full set at once), so a full fix means
building pagination, out of scope here; raised the fetch's `limit` to
1000 (the backend's own declared ceiling) as a partial mitigation for both
the filtered and unfiltered case, and mirrored the remaining >1000 gap
into `KNOWN_LIMITATIONS.md`. Gate re-run: `tsc --noEmit` 0 errors, `eslint
src/modules/grants-fundraising` 0/0, `vitest run src/modules/grants-fundraising`
4 files/6 passed. Full write-up in `GF-22-grants-fundraising.md` →
GF-32/GF-33.

**PR #2073 tend, round 7 (Codex review of the GF-32/GF-33 commit, 1
comment):** **GF-34 (new, MED, fixed)** — GF-31 removed the client-side
status check on `filteredApplications` (the match now happens
server-side), but `fetchApplications`'s `catch` branch left the previous
fetch's `applications` untouched on failure — so a failed status-filtered
fetch left rows from whatever filter was active _before_ on screen,
mismatched with the dropdown's new selection, alongside the error banner.
Fixed by clearing `applications` in the `catch` branch. New guard-test
case in `grantsStore.fetchApplications.test.ts` (fails before/passes
after). Gate re-run: `tsc --noEmit` 0 errors, `eslint
src/modules/grants-fundraising` 0/0, `vitest run src/modules/grants-fundraising`
4 files/7 passed. Full write-up in `GF-22-grants-fundraising.md` → GF-34.

**PR #2073 tend, round 8 (Codex review of the GF-34 commit, 2 comments):**
one re-raise, one new non-security finding. **GF-33 re-raised** — Codex
flagged the round-6 `limit: 1000` bump as evidence the pagination gap is
still open, which is exactly GF-33's own already-recorded disposition
(partial mitigation, full pagination flagged in `KNOWN_LIMITATIONS.md`,
not built). No further code pushed; replied on the PR pointing to the
existing GF-33 entry — this thread's convergence-stop point, same shape as
GF-27a earlier in this PR chain. **Fixture cast (P1, fixed, no GF id)** —
the `application()` test helper added in round 6 used
`as unknown as GrantApplication`, the exact broad-cast pattern AGENTS.md
prohibits; rewritten as a fully, honestly-typed fixture with every field
given a concrete default. No behavior change; both existing tests still
pass. Gate re-run: `tsc --noEmit` 0 errors, `eslint
src/modules/grants-fundraising` 0/0, `vitest run src/modules/grants-fundraising`
4 files/7 passed.

### 2026-08-30 — Feature 22 (Grants & fundraising), pass 2 ✅ merged — PR #2069; round-4 tend continues in PR #2070

PR #2069 merged (`9608aea9`) while its 4th round of Codex review was still
in flight — 3 more real bugs (GF-27/GF-28/GF-29, all below) were found and
fixed in a commit pushed to the branch _after_ the merge, so that commit
never reached `main`. Per CLAUDE.md Pitfall #24 (never reuse a branch name
after its PR merges — a closed PR cannot track further commits, and reusing
the branch risks CI not triggering at all), that commit was cherry-picked
onto a fresh branch (`claude/security-review-grants-fundraising-pass2-tend`)
off current `main` and opened as PR #2070. Rotation row 22 stays ⏳ — the
feature isn't fully done until #2070 also merges. Next: 23 medical
supplies, once #2070 merges.

**PR #2070 tend, round 1 (CI fix):** the new date-range test's direct DOM
queries tripped `eslint --max-warnings 10` (3 new warnings, 8→11). Fixed
by adding real `aria-label`s to the two date inputs and switching the test
to `getByLabelText`; back to 8 warnings.

**PR #2070 tend, round 2 (Codex round 5):** GF-27's own fix drew 2 more
comments. **GF-27a (new, LOW-MED, FLAGGED not fixed)** — the dashboard's
KPI cards count multiple statuses per card (`get_dashboard_data()`:
"Active Grants" = `active`+`reporting`) but link with only one status, so
GF-27's single-value filter now under-shows what the card counted.
Fixing it needs a filter-UI decision (a grouped option, or restyling the
cards as non-filtering summaries), not a mechanical patch — flagged,
mirrored into `KNOWN_LIMITATIONS.md`. This is the rotation's own
convergence-stop point: GF-27→GF-27a is the third straight round where a
fix drew a reshape in the same code; not chasing a fourth variant.
**GF-30 (new, LOW, fixed)** — a stale or mistyped `?status=` value was
applied silently instead of falling back to unfiltered, producing an
unexplained empty list. Both pages now validate against their own
existing status whitelist first; new test case (fails before/passes
after). Full gate re-run green.

**PR #2070 tend, round 3 (Codex round 5, 3rd comment):** **GF-31 (new,
MED, fixed)** — `GrantApplicationsPage.tsx`'s mount effect fetched an
unfiltered, 100-record-capped page and applied `statusFilter`
client-side to that already-capped set, so a deep-linked status filter
(including the dashboard's KPI/pipeline links) could silently miss any
matching application past the newest 100 for a department with more than
100 on file. Fixed by passing `statusFilter` to `fetchApplications` and
refetching on change, so the backend applies the match before the cap
rather than the frontend after it; `priorityFilter` has the same latent
shape but wasn't raised and is left alone. `CampaignsPage.tsx` was
unaffected (already server-side since GF-27). No guard test added
(reproducing the >100-row edge is out of proportion for this fix; noted
as a coverage gap). Gate re-run scoped to the frontend diff: `tsc
--noEmit` 0 errors, `eslint src/modules/grants-fundraising` 0/0,
`vitest run src/modules/grants-fundraising` 3 files/5 passed. Full
write-up in `GF-22-grants-fundraising.md` → GF-31.

### 2026-08-30 — Feature 22 (Grants & fundraising), pass 2 — 0 fixed, 0 new findings; re-verification only

No security-review PR was open (PR #2065/feature 21 admin-hours pass 2 had
already merged as `991c04d2`; its own record-only follow-up PR #2067 was
still open at the time this iteration started, but per this rotation's
established convention a record-only PR does not block the next feature —
confirmed via `mcp__github__list_pull_requests`, not assumed from a stale
local `Open PR` row, which this iteration also corrects above and in the Log
below). Continued directly to feature 22 per the pass-2 order.

Scoped to the full backend surface since pass 1's merge (`520978c4`, PR
#1904): all five declared/adjacent files (`grants.py`, `grant_service.py`,
`fundraising_service.py`, `grant.py`, `schemas/grant.py`) came back
**byte-identical** (`git diff --stat`, not assumed) — zero backend drift, so
this pass independently re-verified all of GF-1 through GF-18 by reading the
current code directly rather than re-citing the pass-1 doc. Re-ran a route
enumeration from scratch: 45/45 routes in `grants.py` carry
`require_permission("fundraising.view"/"fundraising.manage")`, matching pass
1 exactly; neither permission string is in the `member`/`firefighter`
baseline grant set. Every by-id query in both services re-swept mechanically
for a missing `organization_id` filter — no gap. Re-checked GF-13's
ORM-cascade-vs-FK-`ondelete` class against every other relationship in the
model file: `FundraisingCampaign.donations`/`.pledges`/
`.fundraising_events` have the same mismatch on paper, but `delete_campaign`
is a soft delete and no code path hard-deletes a campaign, donor, or pledge —
confirmed by grep, not assumed, so the class exists nowhere reachable beyond
the one instance GF-13 already fixed.

**Frontend scope established for the first time** (pass 1 was backend-only):
the real module is `frontend/src/modules/grants-fundraising/`, ~6,900 lines
across 14 files. Full reads of `services/api.ts`, `routes.tsx`,
`store/grantsStore.ts`, `GrantApplicationFormPage.tsx`, `DonationsPage.tsx`,
and `GrantDetailPage.tsx` (the module's largest file); the remaining four
pages swept by targeted grep rather than read line-by-line (noted as
partial-scope). Confirmed: `createApiClient()` auth wiring present (Pitfall
#7); all 9 frontend routes gate on `fundraising.view`/`.manage` matching the
backend; `/grants` is in `apiCache.ts`'s `UNCACHEABLE_PREFIXES` (though moot
in practice — this module's axios instance never consults that cache at
all, since only the separate global instance wires it); zero hits for
`window.confirm`/`alert`/`prompt`, `dangerouslySetInnerHTML`, banned
`.toLocale*`, `date-fns`, `localStorage`, or direct `fetch(`; every form's
`|| null` payload construction is correct on **both** create and update
paths (the backend accepts an explicit `null` as equivalent-to-omitted on
create and as the intentional clear signal on update, so there is no
create/update asymmetry to fix here, unlike the general Pitfall #1 shape);
external links (`receiptUrl`, `applicationUrl`) are gated behind
`isSafeExternalUrl()` in addition to the backend's own
`validate_external_http_url` write-time validator. No new frontend findings.
Zero `*.test.ts(x)` files exist for this module — noted, not filed as a
security finding.

**GF-19/GF-20 (NIT, doc-accuracy, fixed):** pass 1's doc overstated a
`SafeCsvWriter`-based export that does not exist in this module (no CSV
export exists at all — confirmed by grep, not assumed) and named a
`delete_donation` method that was never built (`Donation` has no delete
path). Both corrected in `GF-22-grants-fundraising.md`'s Pass 1 section.

GF-7/GF-8/GF-9 re-confirmed unchanged and still flagged as product
decisions, per every prior pass. GF-9 was missing from `KNOWN_LIMITATIONS.md`
(GF-7/GF-8 were already there) — added this pass.

Full local completion gate green: flake8/black/isort clean; migrations
validated (394 revisions, single head); 307/307 grant+fundraising-scoped and
9268/9268 full backend suite pass (22 pre-existing skips, 0 failed); `tsc
--noEmit`/`npm run typecheck` 0 errors; `eslint .` 0 errors (8 pre-existing
warnings, none in touched files — no frontend files were touched, since no
frontend fix was needed). Findings doc: `docs/security-review/GF-22-grants-fundraising.md`
→ **Pass 2**. PR #2069 opened and subscribed. Rotation row 22 → ⏳ (awaiting
merge). Next: 23 medical supplies, once this PR merges.

**Tend pass (same day):** Codex posted 6 review comments on PR #2069, all
independently verified against the actual code and addressed. Two were real,
previously-undetected bugs, not just doc gaps: **GF-24 (MED)** — three
report/list query sites (`get_grant_report`, `get_fundraising_report`,
`list_donations`) filtered a `DateTime` column with `<= end_date` against a
bare date, which MySQL coerces to that day's midnight — silently dropping
every record created later the same day, understating totals whenever
"today" falls inside the range (the common case, not an edge case). Fixed
with an explicit UTC end-of-day boundary, matching `reports_service.py`'s
existing pattern; new real-DB test added (fails before/passes after).
**GF-26 (MED)** — `donations_by_method` amounts serialize as JSON strings
(Pydantic's default `Decimal` behavior), but `GrantsReportsPage.tsx` typed
them as numbers and summed with `+`, silently string-concatenating instead
of adding (`0 + "10.10" + "20.20"` → `"010.1020.20"`, which then made every
percentage render `0.0%`). Fixed at the frontend boundary with `Number(...)`,
matching `DonationsPage.tsx`'s existing convention; new test added (the
module's first, fails before/passes after). **GF-23 (real UX bug, not a
security hole — backend enforcement was already correct)** — no page in the
module checked the caller's permission before rendering a mutation control,
so a `fundraising.view`-only user saw Edit/Add/Record/Mark-Complete buttons
that would 403 on click. Fixed 4 files (`CampaignsPage`, `DonorsPage`,
`GrantDetailPage`, `GrantsDashboardPage`) with the app's established
`checkPermission('fundraising.manage')` pattern; two lower-severity
variants and one unrelated dead-route bug flagged, not fixed. **GF-21/GF-22
(doc-only)** — the backend scope statement omitted `dashboard_widget_service.py`
(verified clean: org-scoped, permission-gated) and the frontend page
inventory omitted `GrantsDashboardPage.tsx` (verified clean); both corrected.
**GF-25 (doc-only)** — `KNOWN_LIMITATIONS.md`'s GF-7 row still described a
duplicate-compliance-task bug this same doc's own GF-14 re-verification
had already confirmed fixed; corrected to keep only the still-open
state-machine/overspend items. Full completion gate re-run green (backend
full suite 9271/9271, frontend full vitest 5498/5498, tsc/eslint clean).
CI re-verified on the follow-up commit; merge conflict against `main`
(from PR #2067's concurrent merge touching the same `Open PR` section)
resolved by this check-in.

**Tend pass, round 2 (same day):** Codex posted 2 more review comments on
the round-1 commit. **GF-24a (new, LOW-MED, cross-cutting, FLAGGED not
fixed)** — GF-24's fix hard-codes the report date-range boundary as UTC,
but a non-UTC organization's "June 15" report should mean June 15 in the
department's own timezone. Confirmed real, but not a regression and not
unique to this PR: `reports_service.py` has the identical hard-coded-UTC
boundary at 5 other call sites, and GF-24's fix matched that established
(if imperfect) pattern rather than inventing a one-off — it's strictly
better than the bug it replaced (silently dropping the entire end date, in
every timezone) for every organization regardless of timezone. Doing the
org-timezone conversion correctly needs a coordinated fix across every
report date-range filter in the app, not a 3-line patch scoped to this
PR's own files — `org_timezone.py`'s `resolve_scheduling_timezone` isn't a
drop-in answer either, since its own docstring ties its fallback
specifically to scheduling's historical behavior. Flagged in the findings
doc (GF-24a) and mirrored into `KNOWN_LIMITATIONS.md` as a new cross-cutting
item. **The other comment (stale PROGRESS.md entry) was about this doc's
own pre-round-1-fix state and was already resolved by round 1's check-in
above** — replied confirming no further action needed. Local gate: docs-only
change, no code touched, so no re-run needed beyond the markdown itself.

**Tend pass, round 3 (same day):** Codex posted 1 more comment — round 1's
GF-21 correction fixed the "Backend:" scope line's stale claim about
`dashboard.py` aggregating already-gated `/grants` figures, but missed the
parallel "Frontend:" paragraph's identical stale claim just below it.
Fixed: that paragraph now names `DashboardWidgetService.fundraising`
explicitly and matches GF-21's own accurate description instead of
contradicting it. Docs-only.

**Tend pass, round 4 (same day):** Codex posted 3 more comments, all real
bugs found by continued deeper reading of `GrantsDashboardPage.tsx` (added
to scope in round 1) rather than reshapes of earlier fixes. **GF-27 (new,
LOW)** — the dashboard's KPI/pipeline cards link to
`/grants/applications?status=active` etc., but `GrantApplicationsPage.tsx`/
`CampaignsPage.tsx` never read the URL's `status` param, so the links
silently landed on the unfiltered list. Fixed both by seeding
`statusFilter` from `useSearchParams()`, matching the app's existing
`?tab=`-reading convention; new guard test
(`CampaignsPage.statusFilter.test.tsx`, fails before/passes after).
**GF-28 (new, LOW)** — the dashboard's "View Campaign" link pointed at
`/grants/campaigns/${id}`, a route that doesn't exist (only the list route
is registered), silently redirecting to `/` via the app's catch-all. Fixed
by pointing at the list route instead; building a real per-campaign detail
view is a separate, larger feature gap, flagged not fixed. **GF-29 (new,
MED)** — `GrantsReportsPage.tsx`'s `getDefaultDateRange` derived its
start-of-year bound from the test/browser runtime's own local year instead
of the organization's, so near midnight UTC on New Year's an org behind UTC
could get a 1-day default range instead of its full current year — distinct
from GF-24a (the backend's report-query boundary). Fixed by deriving the
year from the org's own local "today" directly; new guard test
(`GrantsReportsPage.defaultRange.test.tsx`, fakes only `Date` to avoid
starving `waitFor`, fails before/passes after). Full gate re-run green
(tsc, eslint 0 errors, full grants-fundraising vitest suite 4/4 passing
across 3 files).

---

### 2026-08-30 — Feature 21 (Admin hours), pass 2 ✅ merged — PR #2065

Merged (`991c04d2`). Two Codex review rounds on this PR, both independently
verified against the actual code and addressed rather than taken on the
bot's say-so: round 1 (AH21-2 doc-accuracy gap, AH21-1's first timeout
mitigation) in commit `34761461`; round 2, after Codex correctly rejected
round 1's finite-timeout fix as still a regression, in commit `fc0aaafc` —
switched to `timeout: 0` (true no-timeout), and fixed a real MEDIUM
correctness bug (AH21-3: a JSON error body from a `blob`-typed request was
silently undecoded, losing the detail message and support code) centrally
in `utils/createApiClient.ts` so it also covers `reportExportService` and
the storefront export, not just this PR's new call site. Also strengthened
the guard test to catch `window.fetch`/`globalThis.fetch`/direct-`axios`
bypasses and added a real behavioral test of `exportCsv` (AH21-4). CI green
on the final head; no merge conflict. All 6 review threads resolved.
Confirmed on `origin/main` by ancestry check. Rotation row 21 -> done.
Next: 22 grants & fundraising.

### 2026-08-30 — Feature 21 (Admin hours), pass 2 — 1 fixed (LOW), 0 flagged (new); 0 regressions in pass-1 fixes

No security-review PR was open, so the rotation continued directly to
feature 21 per the pass-2 order. Scoped to the full surface since pass 1's
merge (`598a8063`, PR #1903): of the four backend files, only
`admin_hours_service.py` changed (+24/-7), and it's an unrelated
pre-existing-bug fix (an eager-load for `positions` on `get_user_hours_
compliance`'s cross-user fetch, fixing a `MissingGreenlet` crash — the AH-7
org-scoping filter it sits inside is untouched). `event_service.py`'s change
is EV-17's already-reviewed fix (feature 16). No migration touches an
admin-hours table since pass 1.

Independently re-verified all 8 pass-1 fixes (AH-7 through AH-14) by reading
the current code, not re-citing the doc — all intact, including AH-11's
Codex-caught deadlock fix (locks the complete source set, target row
included) and AH-10's two-part locking (User-row lock + locking active-
session read). Re-ran an AST route enumeration from scratch: 27/27 routes,
matching pass 1 exactly, all carrying `get_current_user` or
`require_permission("admin_hours.manage")`. Freshly swept every `select(...)`
call site in the service (~60 sites) for a missing org filter — none found;
the two by-id `User` lookups with no visible org filter resolve through an
already-org-scoped `AdminHoursEntry` fetched two lines above, the checklist's
named exception.

**Frontend scope established for the first time this pass** (pass 1 was
backend-only): the 21-file `modules/admin-hours/` module plus 6 outside
consumers (`AdminHoursSection.tsx`, `HourTrackingSection.tsx`,
`Dashboard.tsx`, `MemberProfilePage.tsx`, `ComplianceRequirementsConfigPage.tsx`,
`CheckInStationPage.tsx` — see AH21-2 below; a first pass at this list named
only 3 and wrongly included `AdminHoursRenderer.tsx`, which does not import
the module). Swept for `window.confirm`/`alert`/`prompt` (0 —
destructive actions go through `useConfirm()`), `dangerouslySetInnerHTML` (0),
banned `.toLocale*`/`date-fns` (0 — `formatDate`/`formatForDateTimeInput`/
`localToUTC` + `useTimezone()` used throughout), and direct `fetch(` (1 hit —
**AH21-1**, below). Confirmed `/admin-hours/` is already a full-prefix
`UNCACHEABLE_PREFIXES` entry. Checked the category-edit form against Pitfall
#1's create-vs-update semantics: `handleUpdate` sends every field the form
owns on every save with an explicit `null` (not an omitted key) to clear the
description field — correct, even without calling the shared `blankToNull`
helper by name.

**AH21-1 (LOW, robustness, FIXED):** `AllEntriesTab.tsx`'s CSV export used a
hand-rolled `fetch()` with manually-set `credentials: 'include'` instead of
the module's shared axios client — the only such call site in the module,
and one of only 3 in the whole frontend (the other two run before a session
exists). It worked (cookies were sent, GET needs no CSRF header) but
bypassed the 401-refresh-and-retry interceptor and error-reporting
integration every other request gets, unlike every comparable export
elsewhere in the codebase (`reportExportService.exportReport`, storefront),
which route through the shared client with `responseType: 'blob'`. Fixed by
replacing the URL-builder + raw-fetch pair with an
`adminHoursEntryService.exportCsv(...)` method on the existing service,
matching the established pattern. Guard test added
(`modules/admin-hours/moduleFetchIntegrity.test.ts`, source-walks the module
for a reintroduced `fetch(` call), confirmed to fail on reintroduction.

Both items pass 1 flagged as open product decisions (the per-org SoD toggle;
`credit_event_attendance`'s resync-can-grow-a-decided-entry gap) re-read
against the current code — unchanged, still deliberate per their own
docstrings.

Full local completion gate green: flake8/black/isort clean (isort 8.0.1,
already installed), migrations validated (394 revisions, single head),
`pytest -k admin_hours` 67 passed/1 pre-existing skip, `tsc --noEmit` 0
errors, `eslint .` 0 errors (8 pre-existing warnings, none in touched files),
`vitest run` 67 passed (admin-hours module) + 7 passed (adjacent compliance/
member-profile suites). Findings doc:
`docs/security-review/AH-21-admin-hours.md` → Pass 2. Next: 22 grants &
fundraising, once this PR merges.

**Tend pass (same day):** Codex posted 3 review comments on PR #2065, all
independently verified against the actual code and addressed in a follow-up
commit. **AH21-2 (new, LOW, doc accuracy)** — the "3 outside consumers" list
above was incomplete: a repo-wide import search found 6, not 3
(`AdminHoursRenderer.tsx` doesn't import the module at all; `Dashboard.tsx`,
`MemberProfilePage.tsx`, `ComplianceRequirementsConfigPage.tsx`, and
`CheckInStationPage.tsx` were missing). The 4 newly-found files were swept
against the same checklist items — 0 hits, all read-only service calls.
**AH21-1 follow-up** — the CSV export's raw `fetch()` had no timeout;
routing it through the shared axios client's default `API_TIMEOUT_MS` (30s)
could newly abort a large department's unfiltered export. Added
`EXPORT_TIMEOUT_MS` (120s) and applied it to this one call site — the same
unbounded-query shape exists in `reportExportService.exportReport` and the
storefront order export, both pre-existing and out of this PR's scope.
**Rotation-table row** — the same tend pass also caught this PR's PROGRESS.md
update marking row 21 ✅ before merge, contradicting the legend; corrected to
⏳. CI re-verified green on the follow-up commit; no merge conflict.

**Tend pass, round 2 (same day):** Codex posted 3 more review comments on
the follow-up commit — findings kept converging (each fix drew a reshaped
or new one) rather than repeating, so all three were investigated rather
than treated as noise. **AH21-1 round 2** — round 1's `EXPORT_TIMEOUT_MS`
(120s) was correctly called out as still a finite cap that can abort a
download the old unbounded `fetch()` would have finished; changed to
`timeout: 0` (axios's actual no-timeout value) instead of guessing a
bigger number. **AH21-3 (new, MEDIUM)** — `responseType: 'blob'` applies
to axios error responses too, so a JSON 403/500 body arrived at
`error.response.data` as an undecoded `Blob`; `toAppError`/`reportApiError`
both read `.detail`/`.code` directly off it, so a failed export lost its
error detail and `LB-*` support code behind a generic fallback. Not
admin-hours-specific — `reportExportService.exportReport` and the
storefront export share the same latent bug — so fixed once in
`utils/createApiClient.ts`'s response interceptor (decodes a JSON blob
body before the 401-retry/reporting logic runs), covering all three call
sites. **AH21-4 (new, LOW)** — the guard test's regex missed
`window.fetch(`/`globalThis.fetch(` bypasses (excluded by its own
dot-exclusion), and no test actually invoked `exportCsv()` to prove the
fix's real behavior rather than the fix's absence of one string in the
source. Broadened the guard test (also catches a direct `axios` import)
and added `services/exportCsv.behavior.test.ts`, which mocks only
`createApiClient` and asserts the real request shape and failure
propagation. Full gate re-run green (tsc, eslint, and the admin-hours +
createApiClient vitest suites); CI re-verified on the new commit.

---

### 2026-08-30 — Feature 20 (Compliance), pass 2 ✅ merged — PR #2059

Merged (`9e212c13`). Codex posted 4 review comments on the first version of
the PR (CMP2-2-A, CMP2-3, CMP2-4, CMP2-B); all four independently verified
against the actual code and addressed in follow-up commit `ef882c98`,
including CMP2-3 (HIGH) — a real, previously-latent org-wide compliance
grading bug made reachable by CMP2-2's own fix. CI green on the final head;
no merge conflict (base was current `main`). Confirmed on `origin/main` by
ancestry check. Rotation row 20 -> done. Next: 21 admin hours.

### 2026-08-30 — Feature 20 (Compliance), pass 2 — 3 fixed (1 HIGH, 2 MED), 1 partially fixed/flagged (MED)

Resumed the rotation directly at feature 20 per the pass-2 order (no
security-review PR was open; the previous `/security-review` loop had
stalled with no PR opened in ~24h). Scoped to the full backend surface since
pass 1's merge (`bf63018b`, PR #1902): all seven declared files
(`compliance_officer.py`, `compliance_config.py`, both service files,
`training_compliance.py`, the model, the schema) came back **byte-identical**
(`git diff --stat`, not assumed) — zero backend diff, so this pass
re-verified all seven pass-1 fixes (CMP-1 through CMP-7) and re-confirmed
CS-8/CS-9's still-open-by-design status by reading the current code directly,
rather than re-deriving anything. Re-ran an AST route enumeration from
scratch: 20/20 routes (8 in `compliance_officer.py`, 12 in
`compliance_config.py`) carry `require_permission(...)`, matching pass 1's
route-for-route inventory. Org-scoping re-swept mechanically across every
by-id query in both endpoint files — no gap.

**Frontend scope established for the first time** (pass 1 was backend-only):
traced every file importing `complianceOfficerService`/
`complianceConfigService` — `trainingServices.ts`'s compliance sections,
`ComplianceOfficerDashboard.tsx`, `ComplianceRequirementsConfigPage.tsx`, and
their four test files. Swept for `window.confirm`/`alert`/`prompt` (none —
both destructive actions go through `useConfirm()`), `dangerouslySetInnerHTML`
(none), banned `.toLocale*`/`date-fns` (none — both pages use
`formatDate`/`formatDateCustom` + `useTimezone()`), direct `fetch(` (none —
shared `api` client, so Pitfall #7 doesn't apply), and confirmed `/compliance/`
is already a full-prefix `UNCACHEABLE_PREFIXES` entry covering all 20 routes
including the two that return per-member names + hours
(`/compliance/annual-report`, `/compliance/contributed-hours`).

**CMP2-2 (MED, FIXED):** the frontend mirror of CMP-1/CMP-2's bug, on the same
two forms — pass 1 fixed the backend's `exclude_unset` + `apply_updates`
handling of an explicit `null` clearing a nullable column, but the frontend
was never updated to send one. Eight fields across the config and profile save
handlers coerced a cleared field to `undefined` (dropped from the JSON body
entirely) instead of `null`, so clearing "Email Recipients," a profile's
threshold override, or its membership-type/requirement selections and saving
silently kept the old value behind a success toast. Fixed on both the config
and profile forms; guard test added
(`ComplianceRequirementsConfigPage.clearFields.test.tsx`).

**CMP2-1 (MED, partially fixed/flagged):** `notify_non_compliant_members` and
`notify_days_before_deadline` are set from the Configuration page's
Notifications panel and persisted, but read by no scheduled task or sender
anywhere in the backend (Pitfall #19 — a second instance of the
`notification_rules` dead-switch shape, on a different module). Wiring a
sender is a real feature (cadence, message content) and was flagged rather
than built; the panel now carries an explicit "Not yet active" notice so it
stops implying the toggle does anything, per the pitfall's own sanctioned
partial remedy. Mirrored into `KNOWN_LIMITATIONS.md`.

**Codex follow-up on the first version of this PR surfaced four issues, all
investigated and addressed in commit `ef882c98`:**

**CMP2-3 (HIGH, FIXED, new this pass):** `compute_org_compliance_pct` guarded
both the requirement-list substitution and the threshold overrides behind one
truthy check (`if profile and profile.required_requirement_ids:`), so a
profile with an explicitly empty required-requirement list (`[]` — "this
group requires nothing," only reachable after CMP2-2's own fix) was treated
the same as `None` ("no override") and graded against every org requirement
instead of none; the same guard silently skipped both threshold overrides for
any profile that didn't also override the requirement list. Fixed by checking
`is not None` for the list substitution and moving the threshold overrides out
from under that guard entirely. New test:
`backend/tests/test_compute_org_compliance_pct_profile_overrides.py` (3
integration tests against a real database).

**CMP2-4 (MED, FIXED, new this pass):** the read-path mirror of CMP2-2 —
`loadConfig` mapped a loaded config's `null` `notifyDaysBeforeDeadline` back
to the pre-save placeholder `'30, 14, 7'`, so a cleared-and-saved reminder
schedule reappeared as the old default immediately on reload even though the
database correctly held nothing. Fixed the loaded-config fallback to `''`;
the placeholder now only shows before a config has ever been saved. Swept
every other loaded field on both the config and profile forms for the same
class of bug — none found.

**CMP2-2-A (guard test rigor, FIXED):** the original CMP2-2 guard test
(`ComplianceRequirementsConfigPage.clearFields.test.tsx`) only scanned the
page's source text for `null`/`undefined` substrings, so it would keep
passing even if the Save button stopped calling the service. Rewritten to
render the real page with all five services mocked, drive an actual field
clear through `@testing-library/user-event`, click Save, and assert the exact
request body the mocked service methods received — verified by reverting the
CMP2-2 fix locally and confirming the rewritten tests fail.

**CMP2-B (previously "escalated," now FIXED):** the pre-existing
`EquipmentCheckTemplateBuilder.test.tsx` failure found in the first version of
this pass turned out not to be a genuine CLAUDE.md Hard Stop —
its bar is a fix that "genuinely exceeds the current scope," which a five-line
test-only change does not. Root cause: the failing `describe` block never
overrode `window.matchMedia` to simulate a laptop viewport, unlike two sibling
blocks in the same file, so the component's `isLaptop` flag was permanently
false and the accessible name the test waits for could never appear. Fixed by
copying the existing override pattern into that block's `beforeEach`. All 32
tests in the file now pass. See `docs/security-review/CMP-20-compliance.md`
Pass 2 completion-gate section for the full writeup, including a correction to
that doc's own CMP2-2 entry: it had claimed `[]` and `None` are read
identically everywhere, true for `membership_types`/`report_email_recipients`
but not for `required_requirement_ids` — the wrong generalization that let
CMP2-3 ship reachable in the first place.

Full gate (final, commit `ef882c98`): flake8/black/isort clean; migrations
valid (394 revisions, single head); backend compliance-scoped tests 290
passed, 1 skipped; full backend suite 9268 passed, 22 skipped; frontend
`tsc --noEmit` 0 errors; `eslint .` 0 errors (10 pre-existing warnings, none
in touched files); frontend `vitest run` 5458/5458 passed, 415/415 files (no
outstanding escalation). Rotation row 20 -> ⏳ (awaiting PR merge). Next: 21
(Admin hours), once this PR merges.

### 2026-08-29 — Feature 19 (Skills testing), pass 2 ✅ merged — PR #2017

Merged (`793bbebb`). Codex's review completed with no findings (no review
threads opened) — the earlier usage-limit comment on the first run was
superseded by a second, completed run triggered by the follow-up commit. CI
green on the final head; no merge conflict (base was current `main`).
Confirmed on `origin/main` by ancestry check (`git log origin/main --oneline`
shows the merge commit at HEAD, directly above `30ae2c97`). Rotation row 19
-> done. Next: 20 compliance.

### 2026-08-29 — Feature 19 (Skills testing), pass 2 — 1 fixed (NIT), 0 flagged

Scoped to the full backend surface since pass 1's merge (`7a772a67`, PR
#1901): the endpoint file, service file, schema file, model file, and the
skill-sheet-library data module all came back **byte-identical**
(`git diff --stat`, not assumed). No new migration touches a skills-testing
table.

Independently re-verified all four pass-1 fixes (SKT-1 through SKT-4) by
reading the current code, not re-citing the doc — all intact, including both
halves of SKT-4's Pitfall #27 capacity lock and the lock-ordering fix Codex's
review added on PR #1901. Re-ran an AST route enumeration from scratch: 29/29
routes carry either `get_current_user` or `require_permission`, matching pass
1's inventory route-for-route. Swept every `select(SkillTest)`/
`select(SkillTemplate)`/`select(SkillTestViewer)` call site mechanically for
an `organization_id` filter (direct, or via an already-org-scoped parent row)
— no gap. Read the surface pass 1 named but did not individually verify
(`complete_test`, `cancel_test`, `bulk_validate_tests`, `release_test_results`,
the `/viewers` routes, `email_test_results`, `export_tests_csv`) line by line
this pass; no new backend finding.

**SKT2-1** (NIT, fixed) — ten `SkillTest.is_practice == False  # noqa: E712`
sites in the endpoint file (the same class **CS2-1** had already swept in the
_service_ file and in `compliance_officer_service.py`, but evidently missed in
the endpoint file's own later additions). `backend/setup.cfg` disables
E712/E711 project-wide, so the `# noqa` comments were dead weight, not a live
suppression — not a vulnerability, but ten unnecessary `# noqa`s is the
opposite of CLAUDE.md's "documented, unavoidable reason" bar. Converted all
ten to `.is_(False)`, matching CS2-1's precedent; no guard test added (mirrors
how CS2-1 itself was disposed of, and E712 cannot regress into a real flake8
failure while the ignore line stands).

Also established, for the first time, a frontend scope for this feature (pass
1 was backend-only): 16 files / ~9,000 L actually import a skills-testing
service, store, or type export. All 16 grep-swept clean for
`window.confirm`/`alert`/`prompt`, `dangerouslySetInnerHTML`, banned
`.toLocale*`, `date-fns`, and direct `fetch(`. Checked the full skills-testing
route surface against `UNCACHEABLE_PREFIXES` directly rather than assuming:
unlike this feature's sibling training passes (TR2-1/TRX2-1), **no
cache-exclusion gap found** — the existing `/training/skills-testing/tests`
prefix entry already covers every PII-bearing route via `startsWith`, and the
one PII-adjacent route it doesn't syntactically cover (`GET /candidates`) is a
capped, minimal-PII name lookup by the endpoint's own design, not a listing.
`skillsTestingService` routes through the shared `api` client
(`withCredentials`, CSRF interceptor) rather than a bespoke module axios
instance.

Completion gate: flake8/black/isort clean (isort 8.0.1, CI's pin, already
installed); `validate_migrations.py --strict` 393 revisions, single head;
`pytest -k skill` 392 passed/1 pre-existing skip; full backend suite 9225
passed/22 pre-existing skips/0 failed; `tsc --noEmit`/`npm run typecheck` 0
errors; `eslint .` 0 errors (10 pre-existing warnings, none in touched files).
Full write-up: `docs/security-review/SKT-19-skills-testing.md` → **Pass 2**.
Rotation row 19 -> awaiting PR merge. Next: 20 compliance, once this PR
merges.

---

### 2026-08-29 — Feature 18 (Training extended), pass 2 ✅ merged — PR #2012

Merged (`988d5a73`). CI green on the final head (`e094e66e`); Codex hit its
usage limit and produced no review. GitHub reported `mergeable_state: clean`
and the merge completed with no conflict, despite 26 unrelated commits
landing on `main` between this PR's base and its merge point. Confirmed on
`origin/main` by ancestry check (merge commit at `origin/main` HEAD).
Rotation row 18 -> done. Next: 19 skills testing.

### 2026-08-29 — Feature 18 (Training extended), pass 2 — 1 fixed (LOW/MED), 0 flagged

Scoped to the full domain since pass 1's merge (`013fc341`, PR #1873): all
twelve declared backend files (six endpoint files, six service files) plus
`training_program_service.py` (the out-of-list file TRX-1's fix landed in)
came back **byte-identical** (`git diff --stat`, not assumed). The only touch
anywhere in `backend/app/models/training.py` since pass 1 is a comment-only
docstring update to `Shift`/`ShiftTemplate.positions` from an unrelated
scheduling PR — no training-extended model changed. No new migration touches
a training-extended table (checked `alembic/versions/` directly, not scoped to
source files, per the SCH-15 lesson).

Independently re-verified all 10 pass-1 fixes (TRX-1 through TRX-10) by
reading the current code, not re-citing the doc — all intact. Re-ran an AST
route enumeration from scratch: 88/88 routes across the six files carry either
`get_current_user` or `require_permission("training.manage")`, matching each
file's route count exactly. Examined the `_confined_path`/
`download_record_attachment` shared-upload-root containment design (superficially
EV-17-shaped) and confirmed it is deliberate, not exploitable — the
`attachments` schema field is `Optional[list[str]]` on every write path, which
blocks the dict/`file_path` injection EV-17 depended on, and a stricter
per-org confinement would break the documented submission→record attachment
handoff.

**TRX2-1** (LOW/MED, data exposure, fixed) — `GET
/training/effectiveness/evaluations` returns per-member `user_id` alongside
free-text evaluation comments/behavior/results notes but was missing from the
frontend's `UNCACHEABLE_PREFIXES` cache-exclusion list, the same class TR2-1/
TR2-3 (training-core pass 2) already closed for this module's other
per-member endpoints. Fixed, with a guard test confirmed to fail pre-fix.
Checked every other GET route in this feature against the prefix list; no
other gap found (aggregate/config-only endpoints correctly left cacheable).

Also established, for the first time, a frontend scope for this feature (pass
1 was backend-only): 10 files / ~8,400 L actually consume a training-extended
service export. Only `WaiverManagementPage.tsx` changed since pass 1 (+7/-1,
an unrelated resilience fix, reviewed and clean); all 10 grep-swept clean for
`window.confirm`/`alert`/`prompt`, `dangerouslySetInnerHTML`, banned
`.toLocale*`, `date-fns`, and direct `fetch(`.

Completion gate: flake8/black/isort clean (isort 8.0.1, CI's pin, already
installed); `validate_migrations.py --strict` 393 revisions, single head;
`pytest -k "training or cohort or syllabus or waiver or external or
enhancement or submission or xapi"` 986 passed/1 pre-existing skip; full
backend suite 9222 passed/22 pre-existing skips/0 failed; `tsc --noEmit` 0
errors; `eslint .` 0 errors (10 pre-existing warnings, none in touched files);
`vitest run apiCache.test.ts` 86 passed. Full write-up:
`docs/security-review/TRX-18-training-extended.md` → **Pass 2**. Rotation row
18 -> awaiting PR merge. Next: 19 skills testing, once this PR merges.

---

### 2026-08-29 — Feature 17 (Training core), pass 2 ✅ merged — PR #1981

Merged (`7522f0a1`). Codex reviewed the initial push and caught two real
findings (TR2-3, TR2-4 below) in the same class as this pass's own TR2-1/
TR2-2; both verified and addressed before merge. CI green on the final head
(17/17 checks). No merge conflict (base was current `main`). Rotation row
17 -> done. Next: 18 training (extended).

### 2026-08-29 — Feature 17 (Training core), pass 2 — 2 fixed (TR2-1, TR2-3), 2 flagged (TR2-2, TR2-4)

Re-verified all three pass-1 fixes (TR-11/TR-12/TR-13) and the route-auth
coverage / baseline-grant / KNOWN_LIMITATIONS claims still hold — the six
scoped files were byte-for-byte unchanged since PR #1851's merge except one
unrelated 7-line spillover fix from the feature-18 pass. Independently
re-enumerated all 91 routes across the three endpoint files (AST walk): no
route without an auth dependency.

New this pass: **TR2-1** (LOW/MED, data exposure, fixed) — `GET
/training/competency-matrix` and `GET /training/dashboard-summary` both
return per-member names alongside compliance/competency status but were
missing from the frontend's `UNCACHEABLE_PREFIXES` cache-exclusion list,
unlike the identically-shaped `/training/compliance-matrix`. Fixed, with a
guard test. **TR2-2** (LOW, abuse resistance, flagged) — `GET
/training/records` has no `skip`/`limit`, unlike the rest of the codebase's
per-record list endpoints; needs a paired frontend pagination UI, mirrored
into `docs/KNOWN_LIMITATIONS.md`.

Codex's review of the PR caught two more in the same vein, both verified and
addressed: **TR2-3** (LOW/MED, data exposure, fixed) — the training-session
approval roster (`GET /training/sessions/approve/{token}`, attendee names +
emails) had the identical missing-cache-exclusion gap as TR2-1; added to
`UNCACHEABLE_PREFIXES` with a guard test. **TR2-4** (LOW, abuse resistance,
flagged) — `get_training_dashboard_summary` scans every active member's full
training history with no date bound on every call; TR2-1's fix correctly
removes that endpoint's cache (it carries per-member PII), which means the
unbounded scan it was masking now runs on every dashboard mount. Needs a
query-level bound tied to `training_compliance.py`'s per-requirement
date-window logic — a service redesign, not a drive-by fix alongside a
cache-exclusion security patch — mirrored into `docs/KNOWN_LIMITATIONS.md`.

Completion gate (final): flake8/black/isort clean (no Python touched);
`validate_migrations.py --strict` 389 revisions, single head; `pytest -k
training` 821 passed; full suite 9200 passed, 22 skipped (pre-existing);
`tsc --noEmit` 0 errors; `eslint .` 0 errors (10 pre-existing warnings, none
in touched files); `vitest run apiCache.test.ts` 85 passed. Full write-up:
`docs/security-review/TR-17-training-core.md` → **Pass 2**.

---

### 2026-08-28 — Feature 16 (Events & requests), pass 2 ✅ merged — PR #1973

Merged (`7e27b765`). Codex had hit its usage limit and could not review this
PR directly, so the fix-commit history (5 comments raised against the
original draft on a prior Codex pass over this same branch, all independently
re-verified real and addressed — see below) stood as the review record. CI
green on the final head (17/17 checks); the one E2E failure surfaced mid-PR
(`mobile-route-integrity.spec.ts`) was traced to the pre-existing, unrelated
`main` bug tracked on #1971/fixed by #1972, which had already merged into
`main` by the time this PR's base was updated — confirmed clean on the final
run. No merge conflict (base was current `main`). Confirmed on `origin/main`
by ancestry check (`git log origin/main --oneline` shows the merge commit at
HEAD). Rotation row 16 -> done. Next: 17 training (core).

### 2026-08-28 — Feature 16 (Events & requests), pass 2 — 3 fixes (EV-17 HIGH, EV-18/EV-19 MED), 3 scope corrections, 2 stale-doc corrections

> **Revised after Codex review of PR #1973.** This entry originally read "no
> findings, 1 frontend scope correction, 1 doc-completeness correction."
> Codex raised **five P2 comments against that draft and all five were
> confirmed real** on independent re-reading of the current code; none was
> dismissed. Three were defects (**EV-17**, a HIGH cross-tenant attachment
> read; **EV-18** and **EV-19**, MED ordering defects on the public intake
> endpoint), two were scope gaps (a basename-only frontend discovery command
> that missed `pages/events-settings/`; `api/public/portal.py`, a changed
> public `Event` consumer outside the enumerated backend scope). All three
> defects are fixed with guard tests in this PR; both scope gaps are closed
> and the affected files reviewed. The summary below is the corrected one.
> Detail per finding in `EV-16-events-requests.md` → **Findings (pass 2)**.
>
> **EV-17 (HIGH, ✅ fixed)** — `EventCreate`/`EventUpdate`/
> `RecurringEventCreate` accept an unconstrained
> `attachments: List[Dict[str, str]]`, all four service write paths persisted
> it verbatim, and `download_event_attachment` confined the stored
> `file_path` only to the **shared** `/app/uploads/event-attachments` root,
> not to the caller's own org subdirectory. An `events.manage` holder who
> obtained another tenant's stored path could attach it to an event in their
> own org and download that tenant's file. Same defect, same shape, as
> **DOC-24** (P1) already fixed in the documents module. Closed at both ends
> via the new `app/utils/event_attachments.py`: `validate_attachments_for_org`
> on every write path (400 on a foreign path), and org-scoped containment on
> download **and** delete. Guard test
> `tests/test_event_attachment_org_scoping.py`, 12 cases.
>
> **EV-18 (MED, ✅ fixed)** — the per-IP limiter was a call in the handler
> body while `require_captcha` was a route `Depends`, so FastAPI necessarily
> ran the CAPTCHA dependency first and one IP could drive unbounded outbound
> provider verifications. Now
> `dependencies=[Depends(_rate_limit_public_request), Depends(require_captcha)]`,
> matching `api/public/forms.py`'s existing pairing. Guard test asserts the
> declaration order on the live `APIRoute`.
>
> **EV-19 (MED, ✅ fixed)** — `daily_cap_exceeded` is an atomic Redis `INCR`,
> so consulting it spends a slot; the `min_lead_time_days` rejection ran
> after it, letting distributed callers exhaust a department's whole daily
> allowance with too-soon dates that were never going to be stored. Lead-time
> validation moved above the counter, restoring the "valid-only cap" contract
> `forms_service.py` already documents. Guard test asserts a flood of
> rejected submissions leaves the counter untouched and a valid one still
> succeeds.
>
> **Frontend scope (✅ corrected)** — `find -iname "*event*"` matches
> basenames, so it enumerated `pages/events-settings/` the directory and none
> of its nine files, including `PipelineSection.tsx` (the EV-5 opt-in UI this
> pass claimed to have re-verified). Rebuilt two ways that agree — `-ipath`
> recursion (70) plus an import-graph closure from the route entry points
> (+4 events-exclusive generically-named files) — for a true surface of
> **74**, not 54. None of the 20 newly-found files changed since pass 1, so
> the changed set and its conclusions are unaffected; `PipelineSection.tsx`
> read in full (purely presentational, enforcement is server-side) and all 74
> re-swept clean.
>
> **Backend scope (✅ corrected)** — `api/public/portal.py` (+35/-5) changed
> in range and gates `GET /public/v1/events`. Reviewed: the change _adds_ a
> module-enablement gate, both refusals return an identical 503 (no oracle),
> and there is no client-supplied org id anywhere on the path. Clean, no
> finding.

Scoped to the full domain since pass 1's merge (`c68a9bef`, PR #1848 —
single merge, no Codex follow-up to re-scope against). All four declared
backend files plus the models/schemas came back **byte-identical** except
`event_service.py` (+17/-6, `git diff --stat`, not assumed), which is
feature 21's own already-applied, already-verified cross-org fix
(`3024a941`, admin-hours) threading `organization_id` through this file's
three call sites into `AdminHoursService.delete_event_attendance_entries` —
read all three call sites directly and confirmed the value is always the
already-org-validated caller org, not attacker-influenceable. No migration
since pass 1 touches an events/event-request table (`git diff --stat`
against `alembic/versions/` directly, not scoped to source files — the
exact gap Codex found in SCH-15 pass 2 — then grepped each of the 18 new
files for "event" by content and confirmed none is this feature's).

**Frontend scope correction, found before Codex could catch it this time**
(the SCH-15/EC-14 lesson): pass 1 scoped its frontend check to
`modules/events/` — a two-file route-registration barrel — and never
mentioned that the real ~20,650-line, 54-file events frontend lives
entirely outside it, in `pages/Event*.tsx`, `components/event-detail/`,
`components/events/`, `services/eventServices.ts`, and three more shared
files. Swept the real surface this pass: only 2 of 54 files changed since
pass 1 (`EventForm.tsx`, a display-only label tweak; `eventServices.ts`,
entirely unrelated INV-11 inventory type additions that happen to live in
this shared file) — both read in full, neither security-relevant. The
other 52 were grep-swept (`window.confirm`/`alert`/`prompt`,
`dangerouslySetInnerHTML`, banned `.toLocale*`, `date-fns` import, direct
`fetch(`) — all clean, noted as partial-scope rather than assumed
line-by-line read, matching how EC-14/SCH-15 disposed of their own large
unchanged frontend surfaces.

Re-verified every pass-1 "Verified good" mechanism by reading the current
code rather than re-citing the doc: fresh AST route enumeration (55/55 +
23/23, unchanged), both halves of the Pitfall #27 RSVP-capacity lock,
EV-11's `template_id` org-check, JSON-column mutation discipline on every
write site, the `get_check_in_monitoring_stats` string-comparison claim,
the 256-bit status-token claim, the `exclude_unset`-only update-payload
discipline, the six frontend cache-exclusion entries, and all 12
`SET NULL` FKs' `nullable=True`. Also verified, for the first time in this
rotation's own docs, **EV-5** (public-intake per-org opt-in + honeypot +
daily cap) — resolved 2026-08-17, before pass 1 ran, but pass 1's doc never
mentioned or verified it: read `submit_public_event_request` in full and
confirmed all four controls present — though **not** correctly ordered, as
this sentence originally claimed: see EV-18 and EV-19 above, both raised by
Codex against this very claim and both fixed. The controls are all there
(opt-in, indistinguishable from "org not found" → honeypot, before any
write → daily cap); their sequence was the defect. One doc-completeness
correction (NIT): pass 1's permission-tier summary omitted
`GET /{event_id}/folder`'s `require_permission("events.view")` gate — not a
defect (`events.view` is a baseline member grant, more restrictive than the
bare-authentication routes beside it, and the endpoint returns only folder
metadata + a document count), just missing from the enumeration. No new
security findings; no regression in any pass-1 fix. Full detail in
`EV-16-events-requests.md` → Pass 2. Completion gate: flake8/black/isort
clean (isort 8.0.1, CI's pin, already installed), migrations 389
revisions/single head, `pytest -k "events or event_request or portal or
attachment"` 285 passed/1 pre-existing skip, `pytest -k "event"` (broader
net — most test files are singular `test_event_*`) 589 passed/1 pre-existing
skip, full backend suite **9196 passed/22 pre-existing skips/0 failed**
(9181 at PR #1968's post-merge baseline, plus the 15 new guard cases added
for EV-17/EV-18/EV-19), `tsc`/`eslint` clean (10 pre-existing warnings,
same set as SEC-00/AP-13/EC-14/SCH-15 pass 2). Rotation row 16 -> awaiting
PR merge. Next: 17 training core, once this PR and the bookkeeping PR
#1971 both merge.

### 2026-08-28 — Feature 15 (Scheduling), pass 2 ✅ merged — PR #1968

Merged (`a28d39e6`). All three Codex P2 review threads (migration scope gap,
weak guard test, overstated `_account_is_active` claim) were independently
re-verified as real and addressed within the PR, replied to, and resolved
before merge; CI green on the final head (17/17 checks). Confirmed on
`origin/main` by ancestry check (`git log origin/main --oneline` shows the
merge commit at HEAD, directly above #1967's merge commit `80c87d91`).
Rotation row 15 -> done. Next: 16 events & requests.

### 2026-08-28 — Feature 15 (Scheduling), pass 2 — 1 test fix, 2 stale-doc corrections, 0 flagged

Scoped to the full domain since pass 1's **final** merge (`5d19cefa`, PR
#1847 — the Codex-follow-up merge, not the earlier `c92f0438`/#1846 that
preceded it). `git diff --stat` against the seven declared/adjacent backend
files found real churn in three (`scheduling.py` +20/-20,
`scheduling_service.py` +6/-1, `scheduling_module_config_service.py`
+70/-0), none touching auth/permission/tenant-scoping code paths.
**Correction (Codex follow-up on this PR):** "no new migration on a
scheduling table" was false — that `git diff --stat` was scoped to source
files and never included `alembic/versions/`, so it could not have found one.
`20260826_1400_e2c8f5a71d40_canonicalize_paramedic_seat.py` does touch
`shifts.positions`/`shift_templates.positions`; reviewed in full against
`CHECKLIST.md` dimension 7 (guards `create_all`-only tables, idempotent,
correctly scoped, irreversible for a stated reason, follows its
already-reviewed same-day sibling migration exactly) and recorded as
reviewed-clean in `SCH-15-scheduling.md`, not just re-asserted good. A grep for other backend files referencing
`ShiftCall`/`ShiftSwapRequest`/`ShiftAssignment`/`StandingShiftClaim`/
`SchedulingService` changed since pass 1 (per the EC-14 lesson) found
`shift_eligibility_service.py` (+90/-43) carrying a real, already-applied
security fix from a different feature's PR (Codex-authored, `a72fed15`):
member-held RBAC positions no longer grant _operational_ shift-position
eligibility (closing a role-manager self-escalation path), verified by
reading the current code rather than trusting the commit message.
`scheduled_tasks.py`'s CRON2-31 changes to the two scheduling cron tasks were
also traced and confirmed org-scoped throughout, matching EC-14 pass 2's
verification of this same file's equipment-check task.

**Frontend scope correction, found before Codex could catch it this time:**
pass 1 (and every prior scheduling audit) scoped the frontend to
`modules/scheduling/` (56 files) only. `pages/scheduling/` — 81 files, ~34,000
lines, holding the actual shift board, my-shifts/open-shifts tabs, swap/
time-off UI, platoons, and position roster — was never mentioned in any prior
scheduling doc. Swept this pass: only one file changed since pass 1
(`PositionRosterPage.tsx`, read in full — clean, uses the approved date
utilities and plain JSX text interpolation); the other 80 were checked with
the same targeted `window.confirm`/`dangerouslySetInnerHTML`/banned-`.toLocale*`/
direct-`fetch()` greps EC-14 used for its equipment-check pages in this same
directory (all clean), noted as partial-scope rather than assumed fully
reviewed.

**SCH-11 (NIT, docs-only, fixed):** SCH-5 ("swap accept-path skips
re-validation + a looser approver-identity check than manager review") had
been carried as **Open** in `KNOWN_LIMITATIONS.md` (two rows), `docs/
module-audit/scheduling.md`, and `docs/app-review/scheduling.md` since
2026-08-06 — but `respond_to_swap_offer`, added 2026-08-24 (two days _before_
SCH-15 pass 1, not new this pass), already resolves it: it replaced the
general swap-accept path with a narrower one-way-offer accept, re-validates
the target shift's live state (capacity/cancellation/finalization) before
moving the seat, and enforces a strict identity check on the responder; every
two-way exchange is confined to the already-hardened manager-review path.
Pass 1 had actually read this method (noted in "Verified good" as
"SCH-5-adjacent," reviewed for capacity locking) but never connected it to
closing SCH-5. All four documents corrected to ✅ Resolved, each citing
`scheduling_service.py`'s exact validation calls and (originally)
`tests/test_swap_offer_response.py` (17 tests, re-run and confirmed passing).
**Correction (Codex follow-up):** the cited test for the
cancelled/finalized-shift half was weak —
`test_the_acceptance_path_runs_that_validation` only greps the calling
method's source for the helper's name, and every one of the 17 tests mocks
`_validate_assignment_candidate`
outright, so none could fail if `require_mutable=True` were dropped or the
helper's own check broke. Fixed, not just reworded: strengthened the existing
kwargs assertion to check `require_mutable`/`reject_past` explicitly, and
added two real (unmocked) tests that reject acceptance against a cancelled
and a finalized shift respectively. 19 tests now pass; confirmed the new
ones fail without the fix by temporarily reverting `require_mutable=True`.

Route/permission enumeration re-run from scratch (AST walk, not a diff):
96/96 routes (92+3+1, unchanged from pass 1) carry a recognized auth
dependency. SCH-9's fix and SCH-10's flag both re-verified intact at their
current lines (SCH-10's KNOWN_LIMITATIONS entry was already kept current by
the training-extended pass, TRX-18 — no correction needed here). A new
`ShiftPosition.PARAMEDIC` enum member (landed via an adjacent qualifications
feature) needs no migration: confirmed `shift_assignments`/
`standing_shift_claims` are both in `enum_normalization.py`'s
`_TARGET_COLUMNS`, which widens the live MySQL `ENUM(...)` DDL to the current
Python enum on every startup, unconditionally.

**Correction (Codex follow-up):** the `_account_is_active` gate
(`shift_eligibility_service.py`) was written up as closing a "stale session"
gap — a retired/suspended member's own valid session outliving their status
change. That's not accurate: `get_current_user` calls
`AuthService.get_user_from_token`, which reloads the user and enforces
`is_active` fresh on every single request, so no such window exists on that
path. The real gap is narrower — `_validate_assignment_candidate`'s
`enforce_position_eligibility` branch loads a client-supplied candidate
`user_id` with no status filter at all, and that candidate is a _third
party_ when an officer assigns someone else to a shift
(`create_assignment(self_signup=False)`) — a path that never goes through
`get_current_user` for the target member, so their inactive status was never
consulted before this fix. Corrected in `SCH-15-scheduling.md` and in the
misleading docstring the code itself carried (same inaccurate claim, fixed at
its source).

Full detail in
`SCH-15-scheduling.md` → Pass 2. Completion gate (post-follow-up):
flake8/black/isort clean (isort already installed), migrations 389
revisions/single head, scoped tests 716 passed/1 skipped, full backend suite
9181 passed/22 skipped/0 failed (+2 over the pre-follow-up baseline of 9179 —
the two new swap-offer guard tests), `tsc`/`eslint` clean (10 pre-existing
warnings, same set as
SEC-00/AP-13/EC-14 pass 2). Rotation row 15 -> awaiting PR merge. Next: 16
events & requests, once this PR merges.

---

### 2026-08-28 — Feature 16 (Events & requests), pass 2 ✅ merged — PR #1973

Merged (`7e27b765`). Codex had hit its usage limit and could not review this
PR directly, so the fix-commit history (5 comments raised against the
original draft on a prior Codex pass over this same branch, all independently
re-verified real and addressed — see below) stood as the review record. CI
green on the final head (17/17 checks); the one E2E failure surfaced mid-PR
(`mobile-route-integrity.spec.ts`) was traced to the pre-existing, unrelated
`main` bug tracked on #1971/fixed by #1972, which had already merged into
`main` by the time this PR's base was updated — confirmed clean on the final
run. No merge conflict (base was current `main`). Confirmed on `origin/main`
by ancestry check (`git log origin/main --oneline` shows the merge commit at
HEAD). Rotation row 16 -> done. Next: 17 training (core).

### 2026-08-28 — Feature 16 (Events & requests), pass 2 — 3 fixes (EV-17 HIGH, EV-18/EV-19 MED), 3 scope corrections, 2 stale-doc corrections

> **Revised after Codex review of PR #1973.** This entry originally read "no
> findings, 1 frontend scope correction, 1 doc-completeness correction."
> Codex raised **five P2 comments against that draft and all five were
> confirmed real** on independent re-reading of the current code; none was
> dismissed. Three were defects (**EV-17**, a HIGH cross-tenant attachment
> read; **EV-18** and **EV-19**, MED ordering defects on the public intake
> endpoint), two were scope gaps (a basename-only frontend discovery command
> that missed `pages/events-settings/`; `api/public/portal.py`, a changed
> public `Event` consumer outside the enumerated backend scope). All three
> defects are fixed with guard tests in this PR; both scope gaps are closed
> and the affected files reviewed. The summary below is the corrected one.
> Detail per finding in `EV-16-events-requests.md` → **Findings (pass 2)**.
>
> **EV-17 (HIGH, ✅ fixed)** — `EventCreate`/`EventUpdate`/
> `RecurringEventCreate` accept an unconstrained
> `attachments: List[Dict[str, str]]`, all four service write paths persisted
> it verbatim, and `download_event_attachment` confined the stored
> `file_path` only to the **shared** `/app/uploads/event-attachments` root,
> not to the caller's own org subdirectory. An `events.manage` holder who
> obtained another tenant's stored path could attach it to an event in their
> own org and download that tenant's file. Same defect, same shape, as
> **DOC-24** (P1) already fixed in the documents module. Closed at both ends
> via the new `app/utils/event_attachments.py`: `validate_attachments_for_org`
> on every write path (400 on a foreign path), and org-scoped containment on
> download **and** delete. Guard test
> `tests/test_event_attachment_org_scoping.py`, 12 cases.
>
> **EV-18 (MED, ✅ fixed)** — the per-IP limiter was a call in the handler
> body while `require_captcha` was a route `Depends`, so FastAPI necessarily
> ran the CAPTCHA dependency first and one IP could drive unbounded outbound
> provider verifications. Now
> `dependencies=[Depends(_rate_limit_public_request), Depends(require_captcha)]`,
> matching `api/public/forms.py`'s existing pairing. Guard test asserts the
> declaration order on the live `APIRoute`.
>
> **EV-19 (MED, ✅ fixed)** — `daily_cap_exceeded` is an atomic Redis `INCR`,
> so consulting it spends a slot; the `min_lead_time_days` rejection ran
> after it, letting distributed callers exhaust a department's whole daily
> allowance with too-soon dates that were never going to be stored. Lead-time
> validation moved above the counter, restoring the "valid-only cap" contract
> `forms_service.py` already documents. Guard test asserts a flood of
> rejected submissions leaves the counter untouched and a valid one still
> succeeds.
>
> **Frontend scope (✅ corrected)** — `find -iname "*event*"` matches
> basenames, so it enumerated `pages/events-settings/` the directory and none
> of its nine files, including `PipelineSection.tsx` (the EV-5 opt-in UI this
> pass claimed to have re-verified). Rebuilt two ways that agree — `-ipath`
> recursion (70) plus an import-graph closure from the route entry points
> (+4 events-exclusive generically-named files) — for a true surface of
> **74**, not 54. None of the 20 newly-found files changed since pass 1, so
> the changed set and its conclusions are unaffected; `PipelineSection.tsx`
> read in full (purely presentational, enforcement is server-side) and all 74
> re-swept clean.
>
> **Backend scope (✅ corrected)** — `api/public/portal.py` (+35/-5) changed
> in range and gates `GET /public/v1/events`. Reviewed: the change _adds_ a
> module-enablement gate, both refusals return an identical 503 (no oracle),
> and there is no client-supplied org id anywhere on the path. Clean, no
> finding.

Scoped to the full domain since pass 1's merge (`c68a9bef`, PR #1848 —
single merge, no Codex follow-up to re-scope against). All four declared
backend files plus the models/schemas came back **byte-identical** except
`event_service.py` (+17/-6, `git diff --stat`, not assumed), which is
feature 21's own already-applied, already-verified cross-org fix
(`3024a941`, admin-hours) threading `organization_id` through this file's
three call sites into `AdminHoursService.delete_event_attendance_entries` —
read all three call sites directly and confirmed the value is always the
already-org-validated caller org, not attacker-influenceable. No migration
since pass 1 touches an events/event-request table (`git diff --stat`
against `alembic/versions/` directly, not scoped to source files — the
exact gap Codex found in SCH-15 pass 2 — then grepped each of the 18 new
files for "event" by content and confirmed none is this feature's).

**Frontend scope correction, found before Codex could catch it this time**
(the SCH-15/EC-14 lesson): pass 1 scoped its frontend check to
`modules/events/` — a two-file route-registration barrel — and never
mentioned that the real ~20,650-line, 54-file events frontend lives
entirely outside it, in `pages/Event*.tsx`, `components/event-detail/`,
`components/events/`, `services/eventServices.ts`, and three more shared
files. Swept the real surface this pass: only 2 of 54 files changed since
pass 1 (`EventForm.tsx`, a display-only label tweak; `eventServices.ts`,
entirely unrelated INV-11 inventory type additions that happen to live in
this shared file) — both read in full, neither security-relevant. The
other 52 were grep-swept (`window.confirm`/`alert`/`prompt`,
`dangerouslySetInnerHTML`, banned `.toLocale*`, `date-fns` import, direct
`fetch(`) — all clean, noted as partial-scope rather than assumed
line-by-line read, matching how EC-14/SCH-15 disposed of their own large
unchanged frontend surfaces.

Re-verified every pass-1 "Verified good" mechanism by reading the current
code rather than re-citing the doc: fresh AST route enumeration (55/55 +
23/23, unchanged), both halves of the Pitfall #27 RSVP-capacity lock,
EV-11's `template_id` org-check, JSON-column mutation discipline on every
write site, the `get_check_in_monitoring_stats` string-comparison claim,
the 256-bit status-token claim, the `exclude_unset`-only update-payload
discipline, the six frontend cache-exclusion entries, and all 12
`SET NULL` FKs' `nullable=True`. Also verified, for the first time in this
rotation's own docs, **EV-5** (public-intake per-org opt-in + honeypot +
daily cap) — resolved 2026-08-17, before pass 1 ran, but pass 1's doc never
mentioned or verified it: read `submit_public_event_request` in full and
confirmed all four controls present — though **not** correctly ordered, as
this sentence originally claimed: see EV-18 and EV-19 above, both raised by
Codex against this very claim and both fixed. The controls are all there
(opt-in, indistinguishable from "org not found" → honeypot, before any
write → daily cap); their sequence was the defect. One doc-completeness
correction (NIT): pass 1's permission-tier summary omitted
`GET /{event_id}/folder`'s `require_permission("events.view")` gate — not a
defect (`events.view` is a baseline member grant, more restrictive than the
bare-authentication routes beside it, and the endpoint returns only folder
metadata + a document count), just missing from the enumeration. No new
security findings; no regression in any pass-1 fix. Full detail in
`EV-16-events-requests.md` → Pass 2. Completion gate: flake8/black/isort
clean (isort 8.0.1, CI's pin, already installed), migrations 389
revisions/single head, `pytest -k "events or event_request or portal or
attachment"` 285 passed/1 pre-existing skip, `pytest -k "event"` (broader
net — most test files are singular `test_event_*`) 589 passed/1 pre-existing
skip, full backend suite **9196 passed/22 pre-existing skips/0 failed**
(9181 at PR #1968's post-merge baseline, plus the 15 new guard cases added
for EV-17/EV-18/EV-19), `tsc`/`eslint` clean (10 pre-existing warnings,
same set as SEC-00/AP-13/EC-14/SCH-15 pass 2). Rotation row 16 -> awaiting
PR merge. Next: 17 training core, once this PR and the bookkeeping PR
#1971 both merge.

### 2026-08-28 — Feature 15 (Scheduling), pass 2 ✅ merged — PR #1968

Merged (`a28d39e6`). All three Codex P2 review threads (migration scope gap,
weak guard test, overstated `_account_is_active` claim) were independently
re-verified as real and addressed within the PR, replied to, and resolved
before merge; CI green on the final head (17/17 checks). Confirmed on
`origin/main` by ancestry check (`git log origin/main --oneline` shows the
merge commit at HEAD, directly above #1967's merge commit `80c87d91`).
Rotation row 15 -> done. Next: 16 events & requests.

### 2026-08-28 — Feature 15 (Scheduling), pass 2 — 1 test fix, 2 stale-doc corrections, 0 flagged

Scoped to the full domain since pass 1's **final** merge (`5d19cefa`, PR
#1847 — the Codex-follow-up merge, not the earlier `c92f0438`/#1846 that
preceded it). `git diff --stat` against the seven declared/adjacent backend
files found real churn in three (`scheduling.py` +20/-20,
`scheduling_service.py` +6/-1, `scheduling_module_config_service.py`
+70/-0), none touching auth/permission/tenant-scoping code paths.
**Correction (Codex follow-up on this PR):** "no new migration on a
scheduling table" was false — that `git diff --stat` was scoped to source
files and never included `alembic/versions/`, so it could not have found one.
`20260826_1400_e2c8f5a71d40_canonicalize_paramedic_seat.py` does touch
`shifts.positions`/`shift_templates.positions`; reviewed in full against
`CHECKLIST.md` dimension 7 (guards `create_all`-only tables, idempotent,
correctly scoped, irreversible for a stated reason, follows its
already-reviewed same-day sibling migration exactly) and recorded as
reviewed-clean in `SCH-15-scheduling.md`, not just re-asserted good. A grep for other backend files referencing
`ShiftCall`/`ShiftSwapRequest`/`ShiftAssignment`/`StandingShiftClaim`/
`SchedulingService` changed since pass 1 (per the EC-14 lesson) found
`shift_eligibility_service.py` (+90/-43) carrying a real, already-applied
security fix from a different feature's PR (Codex-authored, `a72fed15`):
member-held RBAC positions no longer grant _operational_ shift-position
eligibility (closing a role-manager self-escalation path), verified by
reading the current code rather than trusting the commit message.
`scheduled_tasks.py`'s CRON2-31 changes to the two scheduling cron tasks were
also traced and confirmed org-scoped throughout, matching EC-14 pass 2's
verification of this same file's equipment-check task.

**Frontend scope correction, found before Codex could catch it this time:**
pass 1 (and every prior scheduling audit) scoped the frontend to
`modules/scheduling/` (56 files) only. `pages/scheduling/` — 81 files, ~34,000
lines, holding the actual shift board, my-shifts/open-shifts tabs, swap/
time-off UI, platoons, and position roster — was never mentioned in any prior
scheduling doc. Swept this pass: only one file changed since pass 1
(`PositionRosterPage.tsx`, read in full — clean, uses the approved date
utilities and plain JSX text interpolation); the other 80 were checked with
the same targeted `window.confirm`/`dangerouslySetInnerHTML`/banned-`.toLocale*`/
direct-`fetch()` greps EC-14 used for its equipment-check pages in this same
directory (all clean), noted as partial-scope rather than assumed fully
reviewed.

**SCH-11 (NIT, docs-only, fixed):** SCH-5 ("swap accept-path skips
re-validation + a looser approver-identity check than manager review") had
been carried as **Open** in `KNOWN_LIMITATIONS.md` (two rows), `docs/
module-audit/scheduling.md`, and `docs/app-review/scheduling.md` since
2026-08-06 — but `respond_to_swap_offer`, added 2026-08-24 (two days _before_
SCH-15 pass 1, not new this pass), already resolves it: it replaced the
general swap-accept path with a narrower one-way-offer accept, re-validates
the target shift's live state (capacity/cancellation/finalization) before
moving the seat, and enforces a strict identity check on the responder; every
two-way exchange is confined to the already-hardened manager-review path.
Pass 1 had actually read this method (noted in "Verified good" as
"SCH-5-adjacent," reviewed for capacity locking) but never connected it to
closing SCH-5. All four documents corrected to ✅ Resolved, each citing
`scheduling_service.py`'s exact validation calls and (originally)
`tests/test_swap_offer_response.py` (17 tests, re-run and confirmed passing).
**Correction (Codex follow-up):** the cited test for the
cancelled/finalized-shift half was weak —
`test_the_acceptance_path_runs_that_validation` only greps the calling
method's source for the helper's name, and every one of the 17 tests mocks
`_validate_assignment_candidate`
outright, so none could fail if `require_mutable=True` were dropped or the
helper's own check broke. Fixed, not just reworded: strengthened the existing
kwargs assertion to check `require_mutable`/`reject_past` explicitly, and
added two real (unmocked) tests that reject acceptance against a cancelled
and a finalized shift respectively. 19 tests now pass; confirmed the new
ones fail without the fix by temporarily reverting `require_mutable=True`.

Route/permission enumeration re-run from scratch (AST walk, not a diff):
96/96 routes (92+3+1, unchanged from pass 1) carry a recognized auth
dependency. SCH-9's fix and SCH-10's flag both re-verified intact at their
current lines (SCH-10's KNOWN_LIMITATIONS entry was already kept current by
the training-extended pass, TRX-18 — no correction needed here). A new
`ShiftPosition.PARAMEDIC` enum member (landed via an adjacent qualifications
feature) needs no migration: confirmed `shift_assignments`/
`standing_shift_claims` are both in `enum_normalization.py`'s
`_TARGET_COLUMNS`, which widens the live MySQL `ENUM(...)` DDL to the current
Python enum on every startup, unconditionally.

**Correction (Codex follow-up):** the `_account_is_active` gate
(`shift_eligibility_service.py`) was written up as closing a "stale session"
gap — a retired/suspended member's own valid session outliving their status
change. That's not accurate: `get_current_user` calls
`AuthService.get_user_from_token`, which reloads the user and enforces
`is_active` fresh on every single request, so no such window exists on that
path. The real gap is narrower — `_validate_assignment_candidate`'s
`enforce_position_eligibility` branch loads a client-supplied candidate
`user_id` with no status filter at all, and that candidate is a _third
party_ when an officer assigns someone else to a shift
(`create_assignment(self_signup=False)`) — a path that never goes through
`get_current_user` for the target member, so their inactive status was never
consulted before this fix. Corrected in `SCH-15-scheduling.md` and in the
misleading docstring the code itself carried (same inaccurate claim, fixed at
its source).

Full detail in
`SCH-15-scheduling.md` → Pass 2. Completion gate (post-follow-up):
flake8/black/isort clean (isort already installed), migrations 389
revisions/single head, scoped tests 716 passed/1 skipped, full backend suite
9181 passed/22 skipped/0 failed (+2 over the pre-follow-up baseline of 9179 —
the two new swap-offer guard tests), `tsc`/`eslint` clean (10 pre-existing
warnings, same set as
SEC-00/AP-13/EC-14 pass 2). Rotation row 15 -> awaiting PR merge. Next: 16
events & requests, once this PR merges.

---

### 2026-08-28 — Feature 14 (Equipment check & shifts), pass 2 ✅ merged — PR #1963

Merged (`d1f43285`). Confirmed on `origin/main` by ancestry check
(`git log origin/main --oneline` shows the merge commit at HEAD, directly
above #1962's merge commit `2da165c6`). No review-thread follow-up needed
beyond the same-day scope-correction commit already included in the merge
(the two Codex-flagged adjacent files, both verified clean — see below).
Rotation row 14 -> done. Next: 15 scheduling.

### 2026-08-28 — Feature 14 (Equipment check & shifts), pass 2 — no findings

Scoped to the full domain since pass 1's merge (`2a7e47ee`, PR #1842): all
six declared/adjacent backend files (`equipment_check.py`,
`shift_completion.py`, `equipment_check_service.py`,
`shift_completion_service.py`, `equipment_check_pdf.py`,
`models/apparatus.py`) came back **byte-identical**
(`git diff --stat`, not assumed), and no migration since pass 1 touches an
equipment-check/shift-completion/deployed-lot table. A broad grep across
`frontend/src` found 41 files mentioning the feature by name; of the 10 that
changed since pass 1, every one was an incidental substring hit from an
unrelated rotation feature landing in the same window (notifications, the
new testing module, training, inventory, a scheduling my-attendance fix) —
none touches this feature's own code, and the `/equipment-checks`
`UNCACHEABLE_PREFIXES` entry EC-14 added in pass 1 is present, unmodified.

Given the zero diff, re-verified every pass-1 finding's fix mechanism by
reading the current code directly rather than re-citing the doc (EC-1, EC-2/
EC2-4, EC-6, EC-9, EC-10, EC-12, EC-13, EC-14 all confirmed intact at their
original lines), plus a fresh AST-based route/permission enumeration
reproducing 47/47 + 21/21 routes with no drift from pass 1's table. Also
checked, not previously written up explicitly: the module's one `.ilike()`
call still declares `escape=LIKE_ESCAPE_CHAR`; `export_csv` still uses
`SafeCsvWriter`; every `SET NULL` FK in `models/apparatus.py` is
`nullable=True`; no unsafe shallow-copy JSON mutation in either service
file; the ~12,400 L of equipment-check frontend pages have zero
`window.confirm`/`alert`/`prompt`, zero `dangerouslySetInnerHTML`, zero
banned `.toLocale*` calls, and zero direct `fetch()` (grepped, not read
line-by-line — noted as partial-scope rather than assumed clean);
`EquipmentCheckForm.tsx`'s offline-draft `localStorage` key is covered by
`clearAllDrafts()`'s equipment-check prefix match, correctly purged on
logout (the pre-existing FE-6/FE-7 mechanism, traced here for the first
time against this feature's specific key); and both batch endpoints
(`batch_create_shift_reports`, `batch_review_reports`) resolve
client-supplied ids through already-org-scoped paths, re-verified by
reading the branches directly. No findings, no code changes. Completion
gate: flake8/black/isort clean (isort 8.0.1, CI's pin, already installed),
migrations 389 revisions/single head, scoped tests 296 passed/1 skipped,
full backend suite 9179 passed/22 skipped/0 failed, `tsc`/`eslint` clean
(10 pre-existing warnings, same set as SEC-00/AP-13 pass 2). Full detail in
`EC-14-equipment-check-shifts.md`.

**Scope correction (same-day follow-up on Codex review of PR #1963):** the
zero-diff claim above covered only the six files pass 1 declared, not
adjacent files outside that list. Codex correctly flagged two:
`scheduled_tasks.py` (end-of-shift equipment-check reminder task) and
`scheduling_service.py` (`ShiftCall.responding_members`, read by
`ShiftCompletionService` for trainee call attribution) — both had changed
since `2a7e47ee` (confirmed via `git log`, commits `c19ecc0f`, `f439cf07`,
`27c78fcf`, `b10a8ca7`, and the message-delivery chain). Read both in full
against the changed hunks: the reminder task is org-scoped throughout (per-org
processing, `shift_ids` built only from an already org-filtered `Shift`
query) and its diff is a dedup/inactive-user correctness fix from a different
feature's PR (#1915, CRON2-31), not a tenant or auth change. The
`responding_members` validation is a real, already-applied XC-1 fix
(`f439cf07`, feature 15's own pass) that batches an in-org check before
persisting; traced `ShiftCompletionService`'s consumption of it and confirmed
a trainee's call count can only be auto-populated from calls on a shift the
trainee is already tied to via attendance/assignment — the JSON field cannot
be used to attribute a call to an untied trainee. **Verdict: both clean, no
findings, no code change.** Full detail in the "Adjacent files reviewed on
follow-up" subsection of `EC-14-equipment-check-shifts.md`. Rotation row 14
-> awaiting PR merge. Next: 15 scheduling, once this PR merges.

---

### 2026-08-28 — Feature 13 (Apparatus & NFC), pass 2 ✅ merged — PR #1961

Merged (`1c71d8e1`). Confirmed on `origin/main` by ancestry check
(`git log origin/main --oneline` shows the merge commit at HEAD). No
review-thread follow-up needed — AP-7 was the only finding, already fixed
before the PR was opened, and CI was green with no Codex comments requiring
a push. Rotation row 13 -> done. Next: 14 equipment check & shifts.

### 2026-08-28 — Feature 13 (Apparatus & NFC), pass 2 — 1 fixed (LOW), 0 flagged, 2 doc corrections

Picked up a stalled rotation: PR #1959 (feature 12, facilities) had merged
over 2 hours prior with no follow-up (well past the usual ~30-90 min
cadence) and the Open PR row read "None", so this iteration resumed at
feature 13 per the rotation order rather than waiting further. Scoped to
the full domain since pass 1's merge (`37936879`, PR #1838): all 10
declared/adjacent backend files came back **byte-identical**
(`git diff --stat`, not assumed), and no apparatus/NFC/EVOC migration
landed since pass 1. The only change under `modules/apparatus/` is
`routes.tsx` gaining `requiredModule="apparatus"` on its four routes —
client-side parity for a new, whole-app change (`70449d96`, unrelated to
this rotation) that mounted the `apparatus` router behind a server-side
`module_gate("apparatus", "Apparatus")` for the first time. Traced rather
than trusted: the gate's "no session passes through" clause is inert for
this router (no public/token routes in `apparatus.py`), so it's a pure AND
on top of every route's existing permission check; `nfc_tags.py` remains
deliberately ungated at the module level, with each of its 5 routes
independently calling `require_nfc_id_cards` (re-confirmed by reading the
file, not re-citing pass 1's claim).

Given the zero backend diff, did not re-read ~8,000 lines cover to cover.
Instead: a fresh AST-based enumeration of every route decorator's auth
dependency (confirmed 88/88 + 5/5, with two routes' long signatures
initially defeating the walk's regex capture — followed up by reading both
functions directly, both correctly gated), a full direct read of
`nfc_tag_service.py` against tenant isolation and data exposure (the one
file in this feature that had never had more than one pass), and targeted
re-verification of pass 1's specific "Verified good" mechanisms by reading
the actual code (assert_in_org call count, the driver-exception conditional-
UPDATE race guard, the EVOC eligibility query's org-scoping, the
`list_driver_exception_approvers` response shape) rather than re-citing the
claim. Found and fixed **AP-7** (LOW, defense-in-depth): `NfcTagService.
_name_map`, the helper that resolves `member_name`/`issued_by_name` for
card responses, ran `select(User...).where(User.id.in_(ids))` with no
`organization_id` filter on the query itself — the same Pitfall #14a shape
AP-6 (pass 1) fixed one file over in `admin_hours_service.py`, and for the
same reason not currently exploitable: every id it's ever called with is
already drawn from an org-scoped `NfcTag` row or `current_user.id`, across
three different call sites, which is exactly the cross-method dependency
Pitfall #14 warns against relying on. Fixed by adding a required
`organization_id` parameter and filtering directly; behavior-neutral for
every valid call. New guard test class (`TestNameMapOrgScoping`, 3 tests,
whereclause-specific per the hollow-assertion lesson from AP-6's own guard
test) confirmed to fail pre-fix via `git stash`. Also corrected two
stale counts carried since pass 1/app-review: `nfc_tags.py` has always had
5 routes, not 6; `apparatus_service.py` has 16 `assert_in_org` sites, not
17 (the "17" traces to app-review pass 4, 2026-08-09) — neither miscount
changed any conclusion (both undercounted claims remain true at the
corrected number), corrected in `AP-13-apparatus-nfc.md` in place.
Completion gate: flake8/black/isort clean (isort 8.0.1, CI's pin, already
installed), migrations 389 revisions/single head/no schema change, scoped
tests 239 passed/1 skipped, full backend suite 9179 passed/22 skipped/0
failed, `tsc`/`eslint` clean (10 pre-existing warnings, same set as
SEC-00/feature 34), `routeIntegrity`/apparatus-module vitest 40/40 passed.
No FLAGGED items this pass, so no `KNOWN_LIMITATIONS.md` entry; the fix is
behavior-neutral and not user-visible, so no `CHANGELOG.md` entry (matching
how AP-6 was handled in pass 1). Full detail in `AP-13-apparatus-nfc.md`.
Rotation row 13 -> awaiting PR merge. Next: 14 equipment check & shifts,
once this PR merges.

---

### 2026-08-28 — Feature 12 (Facilities), pass 2 ✅ merged — PR #1959

Merged (`b39a548c`), including the 2 additional fixes Codex found on the
draft PR (docstring's position list was missing `vice_president`/`secretary`;
the new `PromptDialog` edit flow could close a different, still-open dialog
if an earlier slow update resolved after the user switched targets). CI
green on the final head (17/17 checks), both review threads resolved.
Confirmed on `origin/main` by ancestry check. Rotation row 12 -> done. Next:
13 apparatus & NFC.

### 2026-08-28 — Feature 12 (Facilities), pass 2 — 3 fixed (1 MED, 2 LOW), 0 flagged

Scoped to the full domain since pass 1's merge (`4e8c6b0c`, PR #1836). Both
declared backend files (`facilities_service.py`, `models/facilities.py`)
unchanged; the real churn was a new cross-module document-reference
validator in `facilities.py` (landed via PR #1953/DOC-10 pass 2 but never
documented there — reviewed here for the first time), the granular
`facilities.delete` permission wired to every delete route, two
`facilities.view` revocation migrations narrowing it from a baseline member
grant to leadership/facilities-manager only, a new folder-ACL migration, a
new frontend `FilesSection` component, and a stale-response-race guard in
`facilitiesStore.ts`. Fixed: a stale module docstring still calling
`facilities.view` "the baseline member grant" (FAC-10, LOW); the new
`FilesSection` used `window.prompt` for caption/description edits, a
CLAUDE.md Pitfall #16 violation, replaced with `PromptDialog` and corrected
to send an explicit `null` on clear rather than omitting the key (FAC-11,
MED); the Files section's delete button was gated on `facilities.manage`
instead of the hook's general `canDelete`, hiding the button from holders
of the new granular delete-only grant despite the backend already
authorizing them (FAC-12, LOW). Verified good: all of pass 1's fixes intact;
the new document-reference validator is org-scoped with no bypass via
update; the granular-delete rollout grants no new access (every position
holding it already holds `facilities.manage`); both revocation migrations
correctly guard the `create_all`-only `positions` table; the facilities
router carries the whole-app module gate. Full backend suite 9176
passed/22 skipped; full frontend suite 5383/5384 (one confirmed-flaky,
unrelated `NotificationCard.test.tsx` failure, recorded rather than
ignored). Full detail in `FAC-12-facilities.md`. Rotation row 12 ->
awaiting merge. Next: 13 apparatus & NFC, once #1959 merges.

### 2026-08-28 — Feature 11 (Inventory), pass 2 ✅ merged — PR #1957

Merged (`656755cf`), including the 6 fixes (INV-10 through INV-15) and the
2 flags (INV-16, INV-17) mirrored to `KNOWN_LIMITATIONS.md`. CI green on the
final head (all 17 checks), no unresolved review threads requiring further
action — the two open threads are the two flagged items, already replied to
with the disposition and correctly left for an owner decision. Confirmed on
`origin/main` by ancestry check. Rotation row 11 -> done. Next: 12 facilities.

### 2026-08-28 — Feature 11 (Inventory), pass 2 — 6 fixed (3 HIGH), 2 flagged (corrected after initial "no findings")

Scoped to the full domain since pass 1's merge (`acfc34c3`, PR #1835). This
range carried substantial new feature work (six commits: distribute-items
replacing batch-checkout, an explicit custody `/transfer` endpoint,
request-intent/fulfillment-type separation, a versioned row-locked
reorder-receiving workflow with a new `reorder_receipts` table, a
three-stage return-request lifecycle with independent physical
verification, and an optimistic-concurrency write-off review). The backend
diff was read in full and reviewed carefully; the first version pushed to
PR #1957 waved through the frontend diff on the (true but incomplete)
reasoning that client-side code cannot itself create an auth/tenant gap —
missing that this feature ships real business logic in its components. An
automated review on the PR caught 7 issues; each was independently
verified against the actual code, not taken on the bot's word. Fixed: a
missing row lock let concurrent deny/receive on the same return request
overwrite each other (INV-10, HIGH); `receive_reorder` never credited
`InventoryItem.quantity`, so received stock could not actually be issued
(INV-11, HIGH — the entire feature this range centers on was
non-functional); the item-status validator allowed a damaged/unsafe item
to return to `AVAILABLE`, becoming distributable (INV-12, HIGH — a
life-safety issue for a fire department); stale `followUp`/quantity state
in `ReturnRequestsPanel` could misfile a write-off/charge-review against
the wrong item (INV-13, MED); a custody-transfer audit event omitted the
acting user (INV-14, LOW); a "Transfer is immediate" checkbox had no
effect and was removed (INV-15, LOW). Flagged: ordinary reorder PATCH
edits bypass the versioned workflow (INV-16, MED — API-contract decision);
"Complete work" always creates a new maintenance record instead of closing
the open one (INV-17, MED — needs new data-fetching + a multi-open-record
decision). Both mirrored to `KNOWN_LIMITATIONS.md`. Two pre-existing tests
that encoded the old, incorrect state-validation rule as expected behavior
were corrected, not deleted. New guard tests added for INV-10/11/12. Full
backend suite: 9173 passed. Frontend: `tsc`/`eslint` clean. Full detail in
`INV-11-inventory.md`. INV-7/LBL-1 (pass 1 fixes) confirmed still intact;
INV-8/INV-9 (pass 1 flags) confirmed still open, no new information this
pass. Rotation row 11 -> awaiting merge. Next: 12 facilities, once #1957
merges.

### 2026-08-28 — Feature 10 (Documents & legal), pass 2 ✅ merged — PR #1953

Merged (`ba4a89ca`), including the CHANGELOG.md conflict-resolution merge
commit tended after main advanced past the PR's base. Confirmed on
`origin/main` by ancestry check. CI green on the final head, no unresolved
review threads. Rotation row 10 -> done. Next: 11 inventory.

### 2026-08-27 — Feature 10 (Documents & legal), pass 2 — 1 real finding, fixed

Scoped to the full domain since pass 1's final merge (`6ab8b31e`, PR
#1826). Zero changes to any endpoint/schema/model file; one real change in
`documents_service.py` (+30/-1), landed via a Facilities PR (#1836, feature
12, not yet reached in this rotation) rather than by this rotation: a
partial fix for the exact Pitfall #27 race pass 1 had predicted for the
apparatus/facility/event folder-provisioning helpers. It locked the
`Organization` row in `ensure_facility_folder` but left the two existence
checks after it as plain reads — insufficient per Pitfall #27's own second
half, since the caller (`GET /facilities/{id}/folders`) already reads the
`Facility` row first, establishing the REPEATABLE READ snapshot before the
lock is acquired. Two concurrent first-time visits to the same facility's
folder tab could each still see "no folder yet" and each create a
duplicate folder tree. Fixed by making both existence checks locking reads
too; extended the existing (too-weak) guard test to actually distinguish
"org locked" from "org and existence checks locked," confirmed to fail
pre-fix via `git stash`. No migrations touch document/legal tables since
pass 1; no frontend changes (broad content-grep hits were all incidental).
Full detail in `DOC-10-documents-legal.md`. Rotation row 10 -> done. Next:
11 inventory.

---

### 2026-08-27 — Feature 09 (Medical screening, PHI), pass 2 ✅ merged — PR #1952

Merged, with the doc-correction commit (`1670bd4d`) included. Confirmed on
`origin/main` by ancestry check. Codex left 3 P2 review comments; all
verified against the actual code and were real doc-accuracy issues (not
security defects — the backend module gate is authoritative and correctly
enforces in every case): the Open PR wording had already been fixed by a
later commit on the same PR before the review ran; the onboarding
description said "offered during setup" when `medical_screening` is
settings-only and never offered by the wizard; and the frontend's
module-off skip in `Dashboard.tsx` doesn't cover the genuinely-unconfigured-
org state, where `useEnabledModules`' deliberate permissive default lets
the call through and the backend correctly 403s it (a UX-only mismatch,
not a leak, since the failure is caught and cleared silently). All three
corrected and threads resolved. Rotation row 09 -> done. Next: 10
documents & legal.

---

### 2026-08-27 — Feature 09 (Medical screening, PHI), pass 2 — no findings

Scoped to the full domain since pass 1's merge (`daf5eaca`, PR #1816). Zero
changes to any of the 4 declared backend files, and no new migrations
touching the module's tables. One real, non-trivial change landed outside
those files: `medical_screening.router` is now gated server-side by a new
`module_gate("medical_screening", ...)` dependency in `api/v1/api.py`,
mirrored client-side in `routes.tsx`/`Dashboard.tsx`. Traced the whole
mechanism rather than taking it at face value: `require_module`'s resolver
is `get_request_enabled_modules`, the exact function this rotation already
hardened in ELEC-06 pass 2 (invalid-session-cookie handling); the module
gate is a pure AND on top of each route's existing permission check, never
a substitute; the one route with no permission string (`/compliance/me`)
still requires `Depends(get_current_user)` independently, so the module
gate's "anonymous passes through" clause (there for routers with
token-authenticated public routes) is a no-op on this router, not a gap.
Frontend module gating confirmed to run strictly after the existing
permission/role checks in `ProtectedRoute.tsx`, same ordering already
verified for MP-08's equivalent change. `test_module_api_gating.py` +
3 medical-screening test files: 67 passed, 0 failed. No code changes, no
new PR needed beyond the doc update. Full detail in
`MS-09-medical-screening.md`. Rotation row 09 -> done. Next: 10 documents &
legal.

---

### 2026-08-27 — Feature 08 (Membership pipeline), pass 2 ✅ merged — PR #1950

Merged, with the 2-bug fix commit (`6c824ed1`) included. Confirmed on
`origin/main` by ancestry check. Both Codex P1 findings (missing
role-grant ceiling on prospect transfer, missing row lock on the transfer's
check-before-write) fixed, regression-tested, and their review threads
replied to and resolved before merge. Rotation row 08 -> done. Next: 09
medical screening (PHI).

### 2026-08-27 — Feature 08 (Membership pipeline), pass 2 — Codex caught 2 real P1 bugs, both fixed

Scoped to the full domain since pass 1's merge (`aad49be4`, PR #1815). The
frontend diff (dialog-portal adoption across 5 components, a
stage-timeout-clearing fix, a stage-config-default fix, module gating, and
the new `frontend/src/utils/membership.ts`) was reviewed in full and had no
findings — its own bugs were already fixed and tested within the diff, and
`membership.ts` matches `backend/app/utils/membership.py` line-by-line, no
mislabeled UI text of the kind ELEC-06 pass 2 found in `BallotBuilder.tsx`.
The backend's initial "already-reviewed on PR #1931" read was incomplete:
Codex's review of the draft PR found two real, separate P1 issues in the
same transfer-prospect path that PR #1931's narrower review never had
reason to look for — `transfer_prospect` accepted a caller-supplied
`role_ids` list and attached every resolved role to the new account with no
`_enforce_role_grant_ceiling` check (a bare `members.manage`/
`prospective_members.manage` holder could mint an account with a
wildcard/more-privileged role, and via the request's own
`department_email` field, log in as it themselves); and
`transfer_to_membership` read the prospect without `lock_for_update`, so
two concurrent transfer requests with distinct usernames could both pass
the `ProspectStatus.TRANSFERRED` check and each create a separate `User`
account for one prospect. Both fixed (role ceiling added to the endpoint;
row lock added ahead of the status check in the service), each covered by
a guard test confirmed to fail against the pre-fix code via `git stash`.
Full detail in `MP-08-membership-pipeline.md`. Rotation row 08 -> done.
Next: 09 medical screening (PHI).

### 2026-08-27 — Feature 07 (Users & organizations), pass 2 ✅ merged — PR #1949

Merged, with the 5-bug fix commit included. Confirmed on `origin/main`
by ancestry check. This PR sat green and mergeable for over an hour
without auto-merging (unlike every other PR in this rotation so far) —
proactively notified the user by push, since the unmerged fix meant
member creation stayed broken on `main` in the meantime. Final tally: 5
real findings (a production-breaking schema regression that broke every
member-creation request, plus three separate gaps in the administrative-
member-holds-no-rank invariant: an unlocked fourth writer, a missing
`populate_existing` on two locked ones, and an explicit-null
misjudgment), all fixed, across two Codex review rounds. Rotation row 07
-> done. Next: 08 membership pipeline.

### 2026-08-27 — Feature 07 (Users & organizations), pass 2 — Codex caught 5 real bugs across 2 rounds, all fixed

Full-domain diff since pass 1's merge (`5f610f1f`, PR #1814): the
member-class/status split (already read in full during ELEC-06 for its
eligibility angle) reaches this module directly via `users.py`/
`member_status.py`/`schemas/user.py`. First draft called the
class/rank-contradiction invariant fully closed by three locked writers
plus two pre-existing structural tests. It wasn't -- Codex caught three
separate gaps in that same invariant, plus one production-breaking
regression the diff's own removed lines should have flagged:

- **`schemas/user.py` (P1, production-breaking).** `AdminUserCreate`'s
  refactor onto `MembershipClassificationFields` silently dropped
  `password`, `role_ids`, `send_welcome_email`, every address field, and
  `emergency_contacts`. Every `POST /api/v1/users` hit `user_data.password`
  with no such attribute and raised `AttributeError` -- member creation
  was completely broken on `main`. Every existing test for this route was
  source-inspection style and would never have caught a field silently
  disappearing. Fixed; guarded by a new test extracting every
  `user_data.<attr>` access from the route's source and asserting each is
  a declared field, so the two can't drift silently again.
- **A fourth, unlocked writer.** `MembershipTierService.advance_all` (the
  scheduled tier-advancement scan) also clears rank on a move into an
  administrative tier, but its batch SELECT was never locked -- the cited
  "every writer" tests only covered three. Fixed with a per-member lock
  taken right before each mutation (not the whole batch upfront).
- **The lock alone wasn't enough on a self-update.** Neither locking read
  had `populate_existing=True`; on a self-update, `get_current_user`
  already put the same row in the session's identity map, so a re-SELECT
  under the lock could still return pre-lock values. The exact bug
  ELEC-06 already found and fixed in `quorum_service.py`; this file
  hadn't caught up. Fixed on both locking reads.
- **An explicit `member_class: null` was judged against the wrong
  value.** `update_data.get("member_class") or user.member_class` can't
  tell "omitted" from "explicitly cleared" -- both read back None. An
  explicit null resets to the operational default, not "keep the old
  class", so clearing an administrative member's class while assigning a
  rank in the same request was wrongly refused. Fixed by checking key
  presence before falling back.

All fixes independently verified against the real code before fixing
(reproduced the AttributeError directly, traced the identity-map
behavior, traced the exclude_unset semantics) -- not taken on Codex's
word. Also confirmed real and already-fixed: `_canonical_rank_or_400`
(unconstrained rank strings) and a real prior frontend bug (rank-list
cache leaking across orgs, now scoped and guarding the same stale-
response race AUTH-3 found elsewhere). Completion gate: flake8/black/
isort clean, migrations valid, scoped tests 430 passed/1 skipped, full
backend suite 9110 passed/22 skipped/0 failed, `tsc`/`eslint` clean.
Every new/modified guard test confirmed to fail pre-fix via `git stash`.
Rotation row 07 -> awaiting
PR merge.

### 2026-08-27 — Feature 06 (Elections & ballots), pass 2 ✅ merged — PR #1948

Merged, with the 3-bug fix commit included (pushed directly to the
still-open PR ahead of auto-merge). Confirmed on `origin/main` by
ancestry check. Final tally: 3 real findings (quorum staleness via a
missing `populate_existing`, a module gate blocking public ballot routes
on a stale session cookie, a mislabeled ballot-builder option), all
fixed, across two Codex review rounds — plus one scoping-methodology
repeat: the pass's own frontend check was scoped to `modules/elections/`
and missed `BallotBuilder.tsx`, which lives outside it. Rotation row 06
-> done. Next: 07 users & organizations.

### 2026-08-27 — Feature 06 (Elections & ballots), pass 2 — Codex caught 3 real bugs across 2 rounds, all fixed

Full-domain diff since pass 1's merge (`56b897ec`, PR #1810). First draft
scoped its frontend check to `modules/elections/` and missed
`frontend/src/components/BallotBuilder.tsx` — a shared component outside
that directory that also changed and carried a real defect. Same class of
mistake feature 04 already corrected once; re-swept against `frontend/src/`
broadly this time, not a directory glob.

The significant backend change: a same-day feature split the fused
`membership_type` column into independent `member_class`/`member_status`
columns and rewrote `election_service.py`'s `_user_has_role_type` (the
function every ballot-eligibility check calls) to read them. Read in full
given the stakes — every legacy voter category reproduces its pre-split
meaning exactly, the unknown-tier fallback fails closed, the
`_reconcile_membership` ORM listener keeps the columns populated. **This
part had no findings** — but three other things in this diff did:

- **Quorum staleness.** `quorum_service.py`'s new `.with_for_update()`
  lock was declared Pitfall #27-complete on first pass — wrong. On a
  session that already holds the `MeetingMinutes` row (the
  quorum-config-update endpoint loads+commits the same instance just
  before calling this method), a re-`SELECT` with `expire_on_commit=False`
  returns the cached, pre-lock Python object unless the query opts into
  `populate_existing` — an established pattern elsewhere in this codebase
  that this file hadn't caught up to. Fixed.
- **Module gate blocking public ballot routes.** `module_gate("elections",
...)` (pre-existing, not part of this diff, but a real bug regardless)
  gates the whole router including the token-authorized public ballot
  routes. `get_optional_current_user` correctly raises on an invalid
  credential rather than downgrading to anonymous — but that means a
  voter with a stale/expired session cookie from an unrelated main-app
  visit got a 401 before their ballot token was ever checked. Fixed by
  having the module-flag resolution catch an invalid-credential exception
  specifically, without weakening any endpoint that declares its own auth
  dependency.
- **Mislabeled ballot-builder option (ELEC-19, the one the scope miss
  hid).** `BallotBuilder.tsx`'s new `"operational"` label claimed "any
  status, incl. probationary & life" — backwards. The backend requires
  status == regular for that category specifically; an admin trusting the
  new label would silently exclude probationary/life members from a
  ballot meant to include them. Label and explanatory comment corrected.

All three independently verified against the real code (traced
`expire_on_commit`/identity-map behavior, traced FastAPI's
dependency-resolution order, re-read `_user_has_role_type` against the
new label) before fixing — not taken on Codex's word. Plus one test gap
closed (a new `"social"` voter category had no coverage). Completion
gate: flake8/black/isort clean, migrations 383 revisions, scoped tests
269 passed/1 skipped, full backend suite 9069 passed/22 skipped/0 failed,
`tsc`/`eslint` clean. Rotation row 06 -> awaiting PR merge.

### 2026-08-27 — Feature 05 (Finance & approvals), pass 2 ✅ merged — PR #1946

Merged, with the FIN-16/17/18 fix commit included (pushed directly to the
still-open PR ahead of auto-merge, for once). Confirmed on `origin/main`
by ancestry check, not just the merge notification. Final tally for this
pass: 9 real findings across FIN-10 through FIN-18, all fixed, plus 1
documentation correction — three successive Codex rounds, each catching
something the previous round's own fix and tests had missed (a genuine
concurrency bug, a ceiling bypass, two schema regressions, a frontend
precision gap, then an ordering bug the first fix's own review didn't
question, then two deadlocks and a portability gap _that_ fix introduced).
**Process note for future iterations**: this rotation's PRs kept
auto-merging the instant CI went green — three times in a row here, twice
before a follow-up commit could land (forcing a rebase onto new `main` and
a fresh PR each time) and once caught in time by pushing directly to the
still-open PR. When Codex is still actively reviewing a PR, watch for
review comments landing in the same window CI turns green, and don't
assume "CI green" means "done" until either Codex has had time to weigh in
or the PR has actually closed. Rotation row 05 -> done for pass 2. Next:
06 elections & ballots.

### 2026-08-27 — Feature 05 (Finance & approvals), pass 2 — Codex round 3 on #1946 caught FIN-16/17/18 (deadlocks + portability), fixed

Enforcing chain order (FIN-15) surfaced two real deadlocks and one
portability gap that FIN-15's own tests didn't cover:

- **FIN-16** — `create_approval_records` never advanced any step at
  creation time (only `approve_step`/`approve_by_token` did, after a
  success). A chain starting with a NOTIFICATION step (or one following
  only auto-approved steps) left that notification `PENDING` forever, and
  FIN-15's order check then refused to let the real approval step skip
  past it -- a hard deadlock. Fixed by calling step advancement once,
  immediately after creating a chain's records.
- **FIN-17** — every EMAIL step's token was generated and its 7-day expiry
  clock started at chain creation, regardless of position. Combined with
  FIN-15, a step whose predecessors took a week or more could expire
  before ever being reachable, with no resend path -- neither "act early"
  nor "act on time" was possible. Fixed by deferring token generation and
  the invite email until a step actually becomes reachable, generalizing
  `_advance_notification_steps` (renamed `_advance_reachable_steps`) to
  handle both notification-send and token-issue in one pass.
- **FIN-18** — `get_approval_records` (which `get_current_pending_step`
  reads) ordered by `step_order`+`created_at` with no `id` tiebreaker, but
  `get_pending_approvals`' own subquery already breaks such ties with
  `id` -- nothing stops two steps sharing a `step_order`, and records for
  one entity are created in the same instant. On a database that doesn't
  happen to return ties in `id` order, FIN-15's check could reject the
  exact step the pending-approvals list told the user was actionable.
  Fixed by adding the same `id` tiebreaker.

Three new regression tests (DB-backed), two of the three confirmed to fail
pre-fix via `git stash`; the third (FIN-18) asserts correct, portable
behavior rather than a locally-reproducible failure -- this dev database
happens to return the tie in primary-key order without the tiebreaker.
Completion gate re-run clean: flake8/black/isort, migrations 383
revisions, scoped tests 246 passed/1 skipped, full backend suite 9065
passed/22 skipped/0 failed. Pushed directly to #1946 (still open when
this landed, CI green but not yet auto-merged).

### 2026-08-27 — Feature 05 (Finance & approvals), pass 2 — Codex round 2 on #1944 caught FIN-15 (approval-chain ordering), fixed

`create_approval_records` marks every step in a chain `PENDING` up front —
including emailing an EMAIL-type step's token immediately, regardless of
its position — but none of `approve_step`/`deny_step`/`approve_by_token`/
`deny_by_token` checked that the acted-on record was the chain's _current_
step (earliest `step_order` still `PENDING`), only that its own status was
`PENDING`. A `get_current_pending_step` helper already existed to answer
that and was never called anywhere — dead code next to the gap it should
have closed. A later-step approver (by record id, or by the token emailed
to them at the same moment as everyone else's) could act out of order;
denial is the sharp edge, since a single deny finalizes the whole entity
immediately, killing the request before earlier reviewers ever weighed in.
Fixed with a shared `_ensure_current_step` check wired into all four action
paths, inside the same lock each already holds for FIN-10. Two new
regression tests (one DB-backed multi-step-chain test, one mock-based
token-path test), both confirmed to fail pre-fix via `git stash`. Full
completion gate re-run clean (flake8/black/isort, migrations 383 revisions,
scoped tests 243 passed/1 skipped, full backend suite 9060 passed/22
skipped/0 failed, frontend gates clean). Pushed to PR #1944, which itself
merged before this commit landed — re-pushed as a fresh PR, #1946, rebased
onto current `main` (see Open PR above).

### 2026-08-27 — Feature 05 (Finance & approvals), pass 2 — Codex caught 5 real bugs, all fixed

Codex reviewed PR #1942 (the "no findings" doc-only push below) and flagged
6 issues; 5 verified as real defects (not just documentation gaps) and
fixed, 1 was a documentation correction. #1942 merged (docs-only, as
originally pushed) before this fix commit could be pushed to it, so the fix
went out as a fresh PR, #1944, rebased onto current `main`:

- **FIN-10** — `approve_step`/`deny_step` read `ApprovalStepRecord` without
  `.with_for_update()`, unlike the token-based `approve_by_token`/
  `deny_by_token` siblings. Two approvers acting on the same step at once
  could both pass the pending check and both finalize -> double-encumbered
  budget. Fixed by locking both reads.
- **FIN-11** — `update_budget` (`PUT /budgets/{id}`) set `amount_budgeted`
  with no lock and no check against `amount_spent + amount_encumbered` —
  a silent side door around the hard ceiling `_mutate_budget` enforces.
  Fixed: same locking read, raises `BudgetLimitExceededError` on a
  reduction below the committed total (the endpoint's exception handler
  for this was previously dead code).
- **FIN-12** — `DuesScheduleUpdate.grace_period_days` had a copy-pasted
  `decimal_places=2` constraint on an `int` field; pydantic-core raised a
  bare `TypeError` on every valid integer, breaking the update path
  entirely. Fixed by dropping the stray constraint.
- **FIN-13** — `ExportRequest`'s date-range validator compared naive and
  aware datetimes directly, raising an uncaught `TypeError` (a 500) for a
  mixed-format request instead of a 422. Fixed with a `field_validator`
  normalizing naive input to UTC, mirroring `schemas/election.py`'s
  `_as_utc`.
- **FIN-14** — `ExpenseReportFormPage.tsx` was the one finance form the
  `MonetaryAmount`/`DecimalString` hardening pass missed (also: the frontend
  file count was 10, not 8 as first documented) — it still sent
  `Number(item.amount)`, a live float-precision gap since the backend
  already required a 2-decimal `Decimal`. Fixed to `.toFixed(2)`, matching
  the sibling forms.
- **Doc-only correction** — the migration review wrongly said `status` was
  nullable and its table-existence guard unnecessary; `status` is
  `nullable=False` and the guard is required (Pitfall #26,
  `finance_export_logs` is `create_all`-only). The migration code itself
  was already correct.

Every fix independently re-verified against the real code (reproduced each
schema TypeError directly; confirmed the missing lock by reading the token
path; confirmed the frontend gap against the backend schema it feeds) before
fixing — not taken on Codex's word. Six new regression tests added, each
confirmed to fail on the pre-fix code via `git stash`. Completion gate:
flake8/black/isort clean, migrations valid, scoped tests 240 passed/1
skipped, full backend suite green (re-confirmed after the rebase onto
`main`), frontend `tsc`/`eslint`/`vitest` (80 tests) clean. Pushed as
PR #1944.

### 2026-08-27 — Feature 05 (Finance & approvals), pass 2 — no findings

Full-domain diff since pass 1's merge (`51ce8547`, PR #1809): `finance.py`,
`finance_service.py`, `finance_approvals.py` (already covered by PUB-03,
re-confirmed unchanged), `models/finance.py`, `schemas/finance.py`, the new
`add_export_stream_status` migration, and 8 finance frontend files. Two
background agents reviewed the budget/export and endpoint/schema/model
halves independently — both reported clean; the two highest-stakes claims
(`_mutate_budget`'s locking read, `get_pending_approvals`'s org-scoped
`union_all`) were re-verified by direct read rather than trusted from the
agent summaries alone. No code changes — completion gate: flake8/black/
isort clean, migrations valid (382 revisions), scoped tests 233 passed,
full backend suite 9042 passed/22 skipped/0 failed, frontend `tsc`/`eslint`/
`vitest` (80 tests) all clean. Rotation row 05 -> awaiting PR merge. Next:
06 elections & ballots.

### 2026-08-27 — Feature 04 (Storefront & payments), pass 2 ✅ merged — PR #1935

Merged. Codex caught a real scoping gap (the diff had covered only the 7
files pass 1's header literally listed, missing models/schemas/a new
util/6 migrations/11 frontend files) before merge — corrected, still no
findings after the full re-sweep, thread resolved. **Methodology note for
future iterations**: scope each pass-2 diff to everything under the
feature's domain (models, schemas, services, endpoints, utils, migrations,
frontend module), not just the exact files a prior pass's header happened
to enumerate — a real feature can land touching more of a domain than the
original file list named. Rotation row 04 -> done for pass 2. Next: 05
finance & approvals.

### 2026-08-27 — Feature 04 (Storefront & payments), pass 2 — no findings

Only 2 of the 7 pass-1-declared files changed on their own: `storefront.py`
(two new display fields) and `storefront_service.py` (an embroidery
thread-color/personalization-method feature plus a variant `sort_order`
fix making it fully server-computed). SF-6's separation-of-duties guard in
`record_payment` re-verified present and unmodified; SF-5's guard tests
still pass.

**Update:** Codex reviewed PR #1935 and found the initial pass scoped its
diff only to the 7 files pass 1's header literally listed, missing that
the same embroidery feature also touched `models/storefront.py`,
`schemas/storefront.py`, a new `utils/size_order.py`, 6 migrations
(including 3 seeded-grant backfills needing Pitfall #23 scrutiny), and 11
frontend files — and the doc had wrongly claimed "no frontend files
touched." Re-swept properly: all of it is clean — closed-enum validation
end to end on both backend and frontend, the grant migrations correctly
`is_system`/frozen-snapshot scoped, no raw client value ever reaches a
frontend `style` attribute (always resolved server-side or from a fixed
catalog), no `dangerouslySetInnerHTML`. No findings, no code changes;
`tsc`/`eslint`/frontend tests now actually run and pass. Replied and
resolved.

Completion gate: flake8/black/isort clean, `validate_migrations.py
--strict` passed, 644/644 scoped backend tests pass (up from 533 at pass
1), full backend suite 9040 passed / 22 skipped (pre-existing) / 0 failed,
`tsc --noEmit` 0 errors, `eslint src/modules/storefront/` 0 errors,
`vitest run src/modules/storefront/` 170/170 passed. Full detail in
`SF-04-storefront-payments.md`. Next: 05 finance & approvals, once this PR
merges.

### 2026-08-27 — Feature 03 (Public surface & webhooks), pass 2 ✅ merged — PR #1934

Merged. No findings — the three changed files (finance_approvals.py,
legal.py, portal.py) were already-complete fixes for other rotation
findings plus one new defense-in-depth improvement. Rotation row 03 -> done
for pass 2. Next: 04 storefront & payments.

### 2026-08-27 — Feature 03 (Public surface & webhooks), pass 2 — no findings

Only 3 of the 12 in-scope files changed since pass 1: `finance_approvals.py`
(a new fail-closed budget-limit error mapped to 409 — verified PUB-4's
self-approval guard and the Pitfall-#27 locking read are both still present
and correctly ordered ahead of it), `legal.py` (a correctness fix for
independently-dated privacy/terms text, DOC-10 — no security-relevant
change), and `portal.py` (a genuine new defense-in-depth fix: the portal's
API-key-authenticated router now also checks the `public_info` module is
enabled, closing a gap where feature 02's new `require_module` mechanism
didn't reach this separately-mounted router — confirmed applied to all
three relevant routes, correctly not applied to the two that don't need
it). File count unchanged at 12, no new public endpoint. No findings, no
code changes. Completion gate: flake8/black/isort clean,
`validate_migrations.py --strict` passed, pass-1 guard tests 10/10 pass,
366/366 broader scoped tests pass, full backend suite 9040 passed / 22
skipped (pre-existing) / 0 failed. No frontend files touched. Full detail in
`PUB-03-public-surface-webhooks.md`. Next: 04 storefront & payments, once
this PR merges.

### 2026-08-27 — Feature 02 (Permissions & roles), pass 2 ✅ merged — PR #1931

Merged. Two HIGH privilege-escalation findings (PERM-3, PERM-4), both fixed;
Codex's follow-up (PERM-3's fix could still generate spurious CRITICAL
security alerts for an unresolvable prospect) also fixed and its thread
resolved before merge. Rotation row 02 -> done for pass 2. Next: 03 public
surface & webhooks.

### 2026-08-27 — Feature 02 (Permissions & roles), pass 2 — 2 HIGH findings, both fixed

Unlike feature 01, this feature's files grew substantially since pass 1 (up
to +450 net lines in `org_chart_service.py`). Three parallel background
agents reviewed org_chart, roles/role_service, and operational_ranks against
the full diff; I reviewed `dependencies.py`'s new per-request auth/module
caching and the `core/permissions.py` registry churn (new `EMT` rank, new
`training.configure` permission with its Pitfall-#23-compliant migration)
directly. org_chart and roles/role_service came back clean (one LOW
informational note on dead code in role_service). operational_ranks
surfaced two real HIGH findings, both independently verified by reading the
actual code before fixing (per this rotation's standing rule) rather than
trusting the agent report as-is:

**PERM-3 (HIGH, fixed):** `POST /prospects/{id}/transfer` creates a full,
live `User` account with a client-supplied `rank`, validated only for
"is this rank configured" — never for whether the caller's permissions cover
what that rank grants. Gated on `members.manage`/`prospective_members.manage`
only, neither of which implies `security.manage`. A caller holding either
could transfer a prospect in at `rank="fire_chief"` and mint a tenant-admin-
equivalent account — the exact scenario `_enforce_rank_grant_ceiling`'s own
docstring names for `create_member`, reachable through a second, unguarded
door. Fixed by wiring the same (unmodified) ceiling helper into
`transfer_prospect` before the service call.

**PERM-4 (HIGH, fixed):** `OperationalRankService.update_rank` bulk-rewrites
`User.rank` for every member currently holding a rank whose `rank_code` is
renamed, with no ceiling check — renaming any currently-held rank to a
reserved code like `fire_chief` retroactively escalates every one of its
holders at once. Endpoint required only `settings.manage`. Fixed by
enforcing the ceiling against the new code before the rename, only when the
code actually changes (a rename to a non-reserved custom code, the common
case, resolves to zero default permissions and passes trivially).

Both fixes reuse `_enforce_rank_grant_ceiling` unmodified — no duplicated
ceiling logic. Guard tests added to `test_privilege_ceiling_wiring.py`
(source-inspection, matching this file's established pattern for exactly
this failure class — the ORU-1/ORU-7d regressions it already guards were
also "call site silently dropped", not broken helper logic), both verified
to fail against the pre-fix endpoints. Two pre-existing tests needed
updates for the new `request` parameter / extra `get_rank` lookup, not for
any behavior change. Completion gate: flake8/black/isort clean,
`validate_migrations.py --strict` passed, 945/945 scoped tests pass, full
backend suite 9039 passed / 22 skipped (pre-existing) / 0 failed. No
frontend files touched.

**Update:** Codex reviewed PR #1931 and found the PERM-3 fix still let a
caller generate a committed CRITICAL security alert for a prospect id that
could never have been transferred (nonexistent, wrong-org, or already
transferred) alongside `rank="fire_chief"` — not an escalation gap (still
correctly blocked), but alert-noise that could degrade the monitoring
channel's signal. Fixed by resolving and validating the prospect _before_
the ceiling check, returning the same 404/400 the service would eventually
have produced. New guard test verified to fail against the pre-correction
ordering. Replied and resolved. Scoped tests re-run: 946/946 pass.

Full detail in `PERM-02-permissions-roles.md`. Next: 03 public surface &
webhooks, once this PR merges.

### 2026-08-27 — Feature 01 (Auth & session lifecycle), pass 2 ✅ merged — PR #1929

Merged. AUTH-3 (stale-response race, fixed) and AUTH-4 (unbounded roster
query, flagged) both came from Codex's review, not the initial pass — see the
"Update" note below. AUTH-4's thread was left open on the PR for the owner;
it did not block the merge. Rotation row 01 -> done for pass 2. Next: 02
permissions & roles.

### 2026-08-27 — Feature 01 (Auth & session lifecycle), pass 2

`auth.py`/`auth_service.py`/`mfa_service.py`/`oauth_service.py` are
byte-identical to PR #1804's merge commit — zero changes since pass 1.
AUTH-1's fix and its guard test re-verified intact. The only in-scope growth
is `consent_service.py` (84 L → 211 L), entirely a new "Photo Use Consent"
feature (new `roster()` method, `GET /users/consents/photo-use` endpoint, a
new `users.view_consents` permission, a frontend page) — read in full against
all seven checklist dimensions since none of it existed at pass 1. Backend
found already built to this checklist's standard: org-scoped roster query
with a belt-and-suspenders join filter, a narrow new permission chosen
specifically to avoid the XC-2 broad-grant pattern (documented in the
endpoint's own comment), contact fields deliberately excluded from the
response, and the seeded-grant migration follows Pitfalls #23 and #26 exactly
(frozen prior-defaults snapshot, `is_system` scoping, `positions`-table
existence guard, symmetric downgrade).

**Update:** Codex reviewed PR #1929 and found two real gaps in the initial
"no findings" pass. **AUTH-3 (LOW, fixed):** `PhotoUseConsentPage.tsx` had no
stale-response guard on its roster fetch — toggling "include inactive" twice
quickly could let an older response overwrite a newer one. Fixed with the
codebase's standard `cancelled`-flag `useEffect` idiom; added a regression
test verified to fail against the pre-fix component. **AUTH-4
(informational, flagged not fixed):** `ConsentService.roster()` has no
`LIMIT`/pagination — but grepping `select(User` found 255+ other call sites
with the identical unbounded shape, so this is the application's existing,
consistent scale assumption (a department's membership, not an unbounded
table), not a defect unique to the new code; fixing one of 255 sites would be
arbitrary. Both replied to on the PR; AUTH-3's thread resolved, AUTH-4's left
open pending the owner's view on whether an app-wide pagination pass is
wanted.

Completion gate (after AUTH-3): flake8/black/isort clean,
`validate_migrations.py --strict` passed, 70/70 scoped backend tests
(oauth/auth_service/mfa/consent) pass, `tsc --noEmit` 0 errors, `eslint .` 0
errors (1 file touched, 0 warnings), `PhotoUseConsentPage.test.tsx` 7/7 passed
(1 new). Full detail in `AUTH-01-auth-session.md`. Next: 02 permissions &
roles, once this PR merges.

### 2026-08-27 — Feature 00 (Cross-cutting baseline), pass 2 ✅ merged — PR #1924

Merged. Codex's file-list gap (missed `public_portal_admin.py`) was caught
before merge, fixed, replied to, and resolved — see the "Update" note below.
Rotation row 00 -> done for pass 2. Next: 01 auth & session lifecycle.

### 2026-08-27 — Feature 00 (Cross-cutting baseline), pass 2 — no findings

Re-ran all five pass-1 sweeps (formula-injection exports, `SET NULL`
nullability, proxy-IP attribution, Alembic chain integrity, LIKE-wildcard
escaping) plus the route-auth-coverage AST walk against current `main`
(381 Alembic revisions, up from 355; one new file in `api/`,
`prospect_privacy.py`, which is a `Depends()` helper module with no routes of
its own). All five sweeps clean; the two pass-1 guard tests
(`test_like_escaping.py`, `test_set_null_fks_are_nullable`) both pass with no
edits needed. Route auth coverage: 68 unauthenticated routes (pass 1: 69),
all still confined to the same five already-accounted-for features (auth,
event_requests public routes, elections token routes, onboarding bootstrap,
`api/public/*`) — no new ungated route. No findings, no code changes.
Completion gate: flake8/black/isort clean, `validate_migrations.py --strict`
passed, guard tests pass, `tsc --noEmit` 0 errors, `eslint .` 0 errors (10
pre-existing warnings); full backend suite 9036 passed, 22 skipped
(pre-existing), 0 failed. Full detail in `SEC-00-cross-cutting-baseline.md`.

**Update:** Codex reviewed PR #1924 and found the route-auth-coverage walk's
file list (`endpoints/*.py` glob) was narrower than pass 1's actual scope and
missed `app/api/v1/public_portal_admin.py` — a router mounted directly in
`api.py` outside the `endpoints/` package, 13 routes. Re-scanned with the file
list derived from `api.py`'s router registrations instead of a directory
glob: 1526 routes total (up from 1513), same 68 ungated, all 13
`public_portal_admin.py` routes already `Depends(get_current_user)`-gated —
conclusion unchanged, denominator corrected. Replied and resolved.

Next: 01 auth & session lifecycle, once this PR merges.

### 2026-08-27 — Rotation pass complete; reset for pass 2

Feature 34 (frontend shared) merged — see the entry immediately below. That
was the last ⏳ row in the table: 00 through 34 are all ✅, completing the
first full pass of the rotation (started 2026-08-25). All 35 rows reset to
⬜ in the table below. Next iteration: 00 cross-cutting baseline, re-run
against current code.

---

### 2026-08-27 — Feature 34 (Frontend shared) merged — PR #1918

Merged (squash-adjacent merge commit `d15ba67b`; picked up one merge
conflict against `main` when #1914 landed first, both touching
CHANGELOG.md and this file — resolved, re-validated, CI green). Three
parallel background agents did a first-ever line-by-line read of the
shared frontend layer previously checked only "for invariants, not
line-by-line": (A) the shared API/cache/error core, (B)
`createApiClient.ts` + all 12 module axios instances, (C)
`ProtectedRoute.tsx` + all four global stores.

9 findings, all fixed (3 HIGH, 2 MEDIUM, 4 LOW):

- FE2-34-1/2/3 (HIGH/HIGH/MED-HIGH): three training endpoints returning a
  member roster (name/email) had no `UNCACHEABLE_PREFIXES` entry at all —
  held in the in-memory 90s response cache on every page load. Fixed.
- FE2-34-4 (MED): `/forms`'s bare list escaped its own exclusion via the
  same trailing-slash bug class fixed for six other endpoints on
  2026-08-08. Fixed.
- FE2-34-5/6 (LOW, defense-in-depth): `/grants` (same trailing-slash shape,
  currently inert) and `/analytics/export` (no exclusion at all). Fixed.
- FE2-34-7 (LOW): `authStore.getCsrfCookie` never `decodeURIComponent`'d
  the cookie value, unlike `apiClient.getCookie` — flagged as FE-7 in the
  original module audit and left unfixed across four app-review passes.
  Fixed to match.
- FE2-34-8 (LOW): `scheduling` module's `getMyAttendance` swallowed _any_
  error as "not checked in," masking real operational failures. Fixed to
  only swallow a confirmed 404.
- FE2-34-9: re-verified FE-6 (PII drafts/offline queue surviving logout) —
  already resolved by an intervening change; documented so it isn't
  re-flagged.

Completion gate: typecheck/lint/build clean, 116/116 scoped
(`apiCache`/`authStore`), 218/218 scheduling-scoped, full frontend suite
5242/5242 passed (397 files), 0 failed. No backend changes.

Next: rotation pass complete — see entry above.

---

### 2026-08-27 — Feature 28 (Security, audit & IP) merged — PR #1911

Merged (squash, `03916fdd`). Three parallel background agents re-verified
module-audit SEC-1 through SEC-10 against current code, with extra scrutiny
on files that had grown significantly since the last full read
(`core/audit.py` +60%, `error_logs.py` +38%). Six findings surfaced; four
fixed:

- SEC2-28-1 (MEDIUM, most severe): `create_member` flushed the new `User` row
  before checking the caller's permissions covered the requested `role_ids`.
  A denied ceiling check's alert-reporting helper commits the whole
  transaction by design, which also persisted the should-be-rejected user —
  a live, ACTIVE, password-set account with no roles, behind a request the
  admin believed failed outright. Fixed by resolving/ceiling-checking roles
  before the user row is created.
- SEC2-28-2 (MEDIUM): the audit hash chain's `calculate_hash` never covered
  `event_category`/`severity` despite both being read into the hash-input
  dict — a DB-write-level attacker could rewrite either with no hash
  mismatch. Fixed with a hash-version bump (v3 → v4); old rows verify
  unchanged.
- SEC2-28-3 (LOW/MED): `GET /ip-security/blocked-attempts` was permanently
  empty — the block-logging path wrote only to `audit_logs`, never to the
  table the endpoint reads. Fixed by wiring the write.
- SEC2-28-4 (LOW/MED): `add_blocked_country` always inserted despite
  `country_code` being unique and unblock being a soft delete, so
  re-blocking a previously-unblocked country 500'd. Fixed with an
  update-in-place lookup.

Flagged, not fixed: approved IP-allowlist exceptions have had zero effect on
geo-blocking enforcement since PR #1544 correctly closed a cross-tenant
bypass by hard-coding an empty allowlist, without a safe replacement or doc
update. Needs an owner decision — corrected the stale docstring/doc claims
instead of guessing at a fix.

Codex review found one real P2 during the round: `request_method` was
written to a `String(10)` column with no length bound (unlike `request_path`
immediately above it), so a malformed/overlong HTTP method would overflow
the column, fail the commit, and silently drop the row from both security
logs. Fixed by truncating to 10 chars, with a regression test; replied and
resolved the thread.

Completion gate: 268/268 scoped tests, 8927/8927 full suite (22 pre-existing
skips), black/isort/flake8 clean, migration validation passed (no
migrations — hash-version bump is pure application logic).

Next: 29 reports & analytics.

---

### 2026-08-27 — Feature 29 (Reports & analytics) merged — PR #1912

Three parallel background agents covered this feature's split scope: (A)
re-verification of the two prior review passes on `reports.py`/`analytics.py`/
`platform_analytics.py`/`reports_service.py` (RPT-1 through RPT-7, no
regressions found, plus review of the ~13% growth in `reports_service.py`
since the last audit), (B) a first-ever full read of `dashboard.py` +
`dashboard_widget_service.py` + `attendance_dashboard_service.py` (never
previously module-audited or app-reviewed), (C) a first-ever full read of
`labels.py` + `label_service.py` + `label_printer_service.py` (same — never
previously reviewed).

No criticals or highs anywhere. Six findings fixed:

- RPT2-29-1 (LOW/MED): `pipeline_overview`'s client-supplied `stage_groups`
  filter override had no shape validation and crashed the report on
  malformed input (RPT-2-class unvalidated-filter 500). Fixed with a
  `_is_valid_stage_groups` guard, falling back to the saved config.
- RPT2-29-3 (LOW): `avg_time_to_check_in` in `/analytics/metrics` ignored the
  `event_id` filter every other figure in the same response respects,
  silently reporting the org-wide average instead. Fixed.
- DASH-29-1 (LOW): the attendance dashboard's `MeetingAttendee` query was
  missing a defense-in-depth `organization_id` filter (not currently
  exploitable — every write path already validates — but inconsistent with
  every sibling join in the same feature). Fixed.
- DASH-29-2 (LOW): `grant_waiver` trusted its one caller to have already
  org-scoped `meeting_id`/`user_id` rather than self-enforcing. Fixed with
  `assert_in_org` per pitfall 14c.
- DASH-29-3 (LOW): `total_external_attendees` in the community-engagement
  dashboard didn't filter to public event types, unlike its sibling
  `total_member_attendees` — inflating the metric with private events'
  guests. Fixed to match.
- LBL-29-1 (LOW): generating/printing labels for `prospective_members`
  (embeds a public status-check token) and `membership` (membership number)
  had no audit trail, unlike every other read of that class of PII. Fixed.
- LBL-29-3 (LOW): `extra_lines` was the one unbounded list field in schemas
  that bound every other field explicitly. Fixed with `max_length=20`.

Flagged rather than fixed:

- RPT2-29-2 (MEDIUM) — `SavedReport` scheduling (`is_scheduled`,
  `schedule_frequency`, `email_recipients`) is fully stored and
  API-writable but nothing reads it — no `TASK_RUNNERS` entry, no
  scheduler. Textbook Pitfall #19. Partial fix applied:
  `SavedReportResponse.enforced` now reports `False` so the UI can label it
  as not-yet-automated; building the actual scheduler/sender is a feature
  addition, not a drive-by. Mirrored to `KNOWN_LIMITATIONS.md`.
- LBL-29-2 (LOW) — `GET /label-printers` has no permission gate at all,
  a deliberate documented design choice, still org-scoped. Permission-
  granularity policy call, left unchanged.
- LBL-29-4 (Informational) — the PDF label-generation path has no
  per-request count cap, unlike the physical-print path's
  `MAX_LABELS_PER_JOB = 500`. Applying the same cap would be a behavior
  change with no evidence it's needed; left as a flagged asymmetry.
- RPT-5c, RPT-6, RPT-7 (all pre-existing, re-confirmed unchanged) — no new
  action.

Completion gate: 460/460 scoped tests (`-k "reports or analytics or
dashboard or attendance or label"`), 8937/8937 full suite (22 pre-existing
skips), black/isort/flake8 clean, migration validation passed (no schema
change — only a model comment added).

**Update:** Codex reviewed the PR and found three real bugs in this pass's
own fixes, all confirmed and corrected before merge:

- `_is_valid_stage_groups` only checked `step_ids` was a list, not that
  every element was a string — a payload like `{"step_ids": [{}]}` passed
  validation, then crashed downstream anyway at `set.update()` on an
  unhashable dict, the exact 500 the guard was meant to prevent. Fixed to
  validate every element is a `str`.
- The label audit-count fix (LBL-29-1) logged `len(data.ids)` — the
  requested count, not the labels actually produced — over-counting on a
  filtered id and under-counting when `copies > 1`. Fixed:
  `LabelService.generate()` now also returns the specs-rendered count;
  `print_labels` uses the already-correct `result["labels_sent"]`.
- The `enforced` flag (RPT2-29-2's partial fix) was added to the backend
  response but not to the frontend's `SavedReportConfig` type, and
  `ReportsPage.tsx` doesn't render saved reports at all today — so "the
  frontend can label it" overstated the fix. Added the frontend type field
  for whenever that screen is built; corrected the overstated claim in
  `CHANGELOG.md` and `KNOWN_LIMITATIONS.md`.

All three replied to and resolved on the PR. Merged (squash, `721a60e7`).

Next: 30 onboarding.

---

### 2026-08-27 — Feature 30 (Onboarding) merged — PR #1913

Two parallel background agents did the first-ever true line-by-line read of
this module (both prior review passes explicitly skipped it due to file
size) — one covering `api/v1/onboarding.py` (2,255 L, endpoint layer), one
covering `services/onboarding.py` + `models/onboarding.py` +
`utils/onboarding_security.py` + org-template services (service layer).
Extra scrutiny on the ~15%/~11% growth in each file since the last audit,
given this is unauthenticated bootstrap surface (creates the first org,
owner, and roles before any auth exists).

No regressions in ONB-1 through ONB-9/ONB2-1/ONB2-2. One doc correction:
ONB-8's reset-re-authentication sub-item was listed open in both prior docs,
but the code already fixed it (landed 2026-08-21, commit `3d445eb2`,
undocumented at the time) — corrected in both docs and
`KNOWN_LIMITATIONS.md`.

Six findings fixed:

- ONB2-30-1 (HIGH): `ITTeamRequest.it_team` had no length cap or item
  schema, unlike every sibling collection in the file — a single request
  could drive unbounded password-hashing/DB work at `/complete`. Fixed with
  a typed `ITTeamMemberRequest` + `max_length=50` (matching
  stations/apparatus); also fixed a bug the change surfaced along the way —
  `save_it_team` was about to store pydantic model instances directly into
  a JSON column, which isn't serializable.
- ONB2-30-2 (HIGH/MED): `RolesSetupRequest.roles`/`PositionsSetupRequest.positions`
  had no cap — immediate unbounded `Role` row creation on a single POST.
  Fixed with `max_length=200`.
- ONB2-30-3 (LOW): six of twelve `/session/*` mutation endpoints
  (department, email, file-storage, auth, it-team, modules) never got the
  post-completion `needs_onboarding()` replay guard their siblings have.
  Fixed — added to all six.
- ONB2-30-4 (LOW/MED): all 7 rate-limited onboarding routes shared one
  `check_rate_limit` "auth" bucket — retrying `/test/email` or `/reset` a
  few times could lock the whole bootstrap process out for 30 minutes.
  Fixed with a scoped wrapper per route, matching the established
  `_rate_limit_admin_reset` pattern.
- ONB2-30-5 (LOW): undocumented `# noqa: E712` in `template_service.py`
  that the prior ONB2-1/ONB2-2 sweeps never reached (they only covered
  `api/v1/onboarding.py`). Swept.
- ONB-8 residual (template mass-assignment fragility, previously flagged):
  `template_service` create/update now strip `organization_id`/`created_by`
  defensively and route updates through `apply_updates(skip=...)` instead
  of a blind `setattr` loop.

Plus a NIT: `"incidents"` was listed in both `ONBOARDING_SETTINGS_ONLY_MODULES`
and `ONBOARDING_LEGACY_MODULES`, contradicting the latter's own "not a
ModuleSettings field" docstring (inert, but fixed for consistency).

Still flagged: ONB-7 (role editor accepts client-supplied
permissions/priority/system-flag — product decision), ONB-8's audit
durability sub-point (transaction-boundary change, deferred for care),
pre-existing role/position dedup gap and `/organization`'s missing
`except Exception` (both app-review pass 2, unchanged).

Completion gate: 106/106 scoped tests (`-k "onboard or template_service"`),
8962/8962 full suite (22 pre-existing skips), black/isort/flake8 clean,
migration validation passed (no schema change).

**Update:** Codex was over its usage limit on this PR — no review produced. All checks (CI, Secret Scan, Supply Chain) green, no unresolved threads. Merged (squash, `5da36a73`).

Next: 31 scheduled tasks.

---

### 2026-08-27 — Feature 31 (Scheduled tasks) — PR #1915 opened

`services/scheduled_tasks.py` is 5,446 lines (~44 task runners), and the
prior app-review pass explicitly did NOT read it line-by-line ("at 4570 L
that would not be an honest single-iteration claim") — it reviewed
structural patterns and sampled a few runners. Four parallel background
agents split the file by line range and did the line-by-line read that
pass skipped, with extra scrutiny on the +19% growth since the last audit.

No regressions in any prior CRON finding (CRON-1 through CRON-6, the
registry-sync test). Registry sync re-confirmed 43/43 (grown from 38/39),
no drift.

12 findings, 10 fixed (4 MED, 6 LOW), 2 flagged:

- CRON2-31-1 (MED): `InventoryNotificationService.process_pending_notifications`
  had no per-group commit/rollback — a failed (org, member) group poisoned
  the session for every later group in the batch, invisible to the
  existing structural test since the loop lives outside
  `scheduled_tasks.py`. Fixed.
- CRON2-31-2 (MED): `run_post_shift_validation` never excluded cancelled
  shifts, generating bogus "validate attendance" emails for the common
  case of a same-day cancellation. Fixed.
- CRON2-31-3 (MED): reminder dedup flags (`start_reminder_sent`,
  `eos_checklist_reminder_sent`) were stamped permanently `True` even when
  nothing was sent because a precondition (crew/apparatus/templates) wasn't
  ready yet — silently suppressing the reminder forever, even once the
  precondition was met later in the same window. Fixed.
- CRON2-31-4 (LOW): `run_end_of_shift_checklist_reminders` notified
  deactivated members, unlike its sibling which explicitly filters
  `User.is_active`. Fixed.
- CRON2-31-5 (MED): `run_scheduled_emails` had no per-item commit/rollback
  across up to 100 pending emails spanning many orgs — one bad item could
  cascade failures to every later item and, in the worst case, cause
  already-sent emails to re-send on the next run. Fixed.
- CRON2-31-6 (MED): `RetentionService.enforce()` had zero per-org isolation
  (unlike every other multi-org runner in the file) and never audit-logged
  its PII-bearing deletes. Fixed with per-org commit/rollback plus a
  `log_audit_event()` call when an org had deletions.
- CRON2-31-7 (LOW): `run_audit_log_archival`'s except block didn't roll
  back, so a DB-level failure turned its intended graceful 200-with-errors
  response into an unhandled 500 anyway. Fixed.
- CRON2-31-8 (LOW, latent): `run_officer_directory_sync` used a bare
  `where(Organization.active)` instead of `.isnot(False)`, excluding NULL
  rows. Fixed.
- CRON2-31-9 (MED, SSRF-adjacent): Salesforce's cached-access-token path
  never validated `instance_url` — only the token-refresh path did — so an
  org-admin-editable `instance_url` with a cached token became an
  unvalidated outbound-request target hit every 30 minutes unattended, with
  the org's bearer token attached. Fixed by validating in `_api_url()`
  itself, the one call site every request goes through.
- CRON2-31-10 (informational, now fixed): the naive-datetime issue in
  `run_rolling_recurrence_extend`, flagged-not-fixed by the prior review
  pending verification of aiomysql's actual return type for
  `DateTime(timezone=True)` columns on this stack — now verified
  naive-but-UTC (via two other sites in the same file), unblocking the fix
  the prior review explicitly deferred.
- CRON2-31-11 (LOW, latent): three more org-scoped loops
  (`run_compliance_auto_reports`, `run_external_training_auto_sync`,
  `run_salesforce_auto_sync`) skipped the active-org filter entirely since
  they iterate a child table keyed by `organization_id` rather than
  `Organization` directly — the same shape as CRON-2, invisible to its
  regression test's `select(Organization)` detection heuristic. Fixed with
  joins.

Flagged, not fixed: CRON2-31-12 (`run_action_item_reminders` has no org
loop at all, so it was never in scope for CRON-2 either — closing it means
joining two different action-item tables through two different parents,
a structural change beyond a drive-by) and CRON2-31-13
(`run_admin_hours_auto_close` has no audit trail — a design choice for the
admin-hours feature to make deliberately). Both mirrored to
`KNOWN_LIMITATIONS.md`.

Completion gate: 299/299 scoped tests across every touched runner/service,
8971/8971 full suite (22 pre-existing skips), black/isort/flake8 clean,
migration validation passed (no schema change — this feature's fixes are
pure application logic; separately repaired unrelated schema drift from a
prior merge's inventory-reorder migration via `repair_schema.py` +
`alembic stamp head` to unblock the sandbox's DB-backed tests).

### 2026-08-27 — Feature 31 (Scheduled tasks) — PR #1915, Codex review round

Codex reviewed #1915's own fix commit and found 5 real bugs, all one root
cause: the CRON2-31-1/CRON2-31-5/CRON2-31-6 fixes (commit-per-unit,
rollback-on-failure over a _pre-fetched_ list of ORM objects sharing one
`AsyncSession`) missed that `AsyncSession.rollback()` expires every
persistent object in the session, not just the failed unit's. Once one
unit's rollback fires, the next pre-fetched-but-not-yet-processed unit's ORM
attributes are expired, and reading one outside the async greenlet bridge
raises `MissingGreenlet` — a class of bug the `db_session` test fixture
cannot catch, since its savepoint-based rollback doesn't expire objects the
same way a production session does. Verified by reproducing the crash
directly against a real `async_session_factory()` session before trusting
the finding.

All 5 fixed:

- `inventory_notification_service.py` (CRON2-31-1) and `scheduled_tasks.py`'s
  `run_scheduled_emails` (CRON2-31-5): **refresh-after-rollback pattern** — a
  `needs_refresh` flag flips `True` after any unit's rollback; every
  subsequent unit's records are explicitly refreshed (`db.refresh()`, plus
  `db.get(..., populate_existing=True)` for the email loop's `organization`
  relationship) before their attributes are read again. Used here rather
  than a snapshot because both loops keep mutating the _same_ ORM rows across
  iterations for the eventual UPDATE to persist.
- `retention_service.py` (CRON2-31-6): **snapshot pattern** instead — `(id,
config)` tuples are extracted for every org in one pass before the loop,
  since nothing here needs to keep mutating the pre-fetched `Organization`
  rows themselves.
- `scheduled_tasks.py`'s `run_end_of_shift_checklist_reminders`: a smaller,
  related bug in the CRON2-31-3/CRON2-31-4 fix — the `User.is_active` filter
  added for CRON2-31-4 can leave a shift with assignments but zero _active_
  recipients, and the dedup flag was still being stamped `True` in that case.
  Added a fourth continue-without-stamping guard.

Regression tests: `test_inventory_notification_group_isolation.py` (new),
`test_scheduled_email_group_isolation.py` (new), `test_retention_service.py`
(the isolation test rewritten to 3 orgs — a 2-org version can't distinguish
this bug class from a plain try/except, since it only manifests on the unit
_after_ a failure), `test_shift_scheduled_tasks.py` (2 new tests for the
empty-active-member-list case). Full detail:
`docs/security-review/CRON2-31-scheduled-tasks.md`.

Completion gate (this round): 96/96 scoped tests, black/isort/flake8 clean
on every touched file. Full suite: 8938 passed, 38 failed, 22 skipped — the
38 failures (`test_public_legal.py`, `test_agency_position_seeding.py`,
`test_onboarding_integration.py`, `test_facilities_onboarding.py`) reproduced
identically with this round's diff stashed out, confirmed pre-existing and
unrelated.

All 5 Codex threads replied to and resolved. CI green (16/16 checks),
`mergeable_state: clean`, no Claude Approvals check configured on this repo.

### 2026-08-27 — Feature 31 (Scheduled tasks) merged — PR #1915

Merged (squash, `c19ecc0f`). Registry sync, CRON-1/CRON-2/CRON-5/CRON-6
invariants, and the Codex-caught MissingGreenlet class of bug are all
resolved on `main`. Rotation row 31 -> done.

### 2026-08-27 — Feature 32 (Locations & kiosk) — PR #1916 opened

Five parallel background agents: four read `admin_hub_service.py`
(1,798 lines, never previously reviewed — headline metrics and "needs
attention" queues for the administration dashboard, one per module in
`MODULE_REGISTRY`) by line range; one re-verified `locations.py`/
`location_service.py`/`public/display.py`/the kiosk frontend against the
prior app-review pass's LOC-1 through LOC-4.

3 findings, all fixed (1 LOW, 2 MED):

- LOC2-32-1 (LOW): `_events_attendance_rate` joined `Event` without
  independently filtering its `organization_id`, relying on (rather than
  verifying) the invariant that a joined RSVP's org always matches its
  parent Event's org. Defense-in-depth fix; not independently exploitable
  today. Fixed.
- LOC2-32-2 (MED): `AdminHubService._sanitize()`'s slot-padding loop (fills
  empty slots from a module's defaults) skipped the permission/module gate
  its own primary loop applies — a permission-gated default metric could
  reach a resolved selection for an admin who lacks that permission, and
  `_render_metric`'s redacted-value branch would still show the metric's
  _label_. Latent under the current registry (no module has a gated
  default today) but live the moment one is added. Fixed by sharing one
  gate check between both loops.
- LOC2-32-3 (LOW/MED): concurrent first-time settings saves for the same
  (org, module, scope) could both observe no existing row, both insert,
  and the second commit's `IntegrityError` was uncaught — surfacing as a
  500 that silently dropped the second admin's save. Fixed with a
  bounded (2-attempt) retry: catch, roll back, re-read/re-apply once, then
  re-raise if it conflicts again.

Also re-confirmed LOC-1/LOC-2/LOC-4 still hold, and investigated a LOW an
agent flagged in `RoomQRCodesPage.tsx` (a kiosk-URL card with no
`display_code` null-guard) — found **not reproducible**: `groupByStation()`
already filters out codeless locations before any card is built, with
existing test coverage asserting it. No code change made there.

LOC-3 (the dead-code authenticated display endpoint, flagged not fixed in
the 2026-08-08 app-review pass) is still open and has grown a third gap
since then (event descriptions, unlike its public sibling, are not
redacted) — mirrored to `KNOWN_LIMITATIONS.md`.

Completion gate: flake8/black/isort clean on all touched files, migration
validation passed (no schema change), 174/174 scoped backend tests passed
(5 new: 2 for LOC2-32-1, 1 for LOC2-32-2, 2 for LOC2-32-3), full backend
suite 8943 passed / 38 failed (same pre-existing onboarding/facilities/
legal-doc failures confirmed unrelated in the prior feature's pass,
reproduced identically with this diff stashed out) / 22 skipped, `tsc
--noEmit` and `eslint` clean.

A Codex review of #1916's own fix commit found one real bug, the same
root cause named above: the LOC2-32-3 retry's `self.db.rollback()` expired
`ctx.user` (the same `User` object the caller and the endpoint's post-save
audit-log call keep using), and a retry's `user_has_permission()` reading
`user.positions` would then raise `MissingGreenlet` — turning the race into
a _different_ 500. Fixed by explicitly refreshing `ctx.user` (columns, then
the `positions` relationship) right after the rollback. Regression test
extended; thread replied to and resolved.

### 2026-08-27 — Feature 32 (Locations & kiosk) merged — PR #1916

Merged (squash, `1a0a35c8`). LOC-1/2/4 re-confirmed, LOC-3 still flagged
(now 3 gaps, mirrored to `KNOWN_LIMITATIONS.md`), `admin_hub_service.py`
fully reviewed for the first time. Rotation row 32 -> done.

### 2026-08-27 — Feature 33 (Core infrastructure) — PR #1917 opened

Corrected a stale rotation-table entry first: `core/middleware.py` does not
exist (only `security_middleware.py` does) — the file list above is fixed.

Four prior passes (module audit iteration 24, app-review `core-infra.md`
passes 1-4) fixed 8 findings and left CI-9/CI-10-residual deliberately
flagged as ops/design decisions — but every one of those passes explicitly
noted `security_middleware.py` (1,380 L) and `config.py` (964 L, grown from
603 L reviewed last time) were checked "for security invariants, not
line-by-line." Four parallel background agents did that line-by-line read
for the first time (security_middleware.py split in half, config.py and
database.py each read whole), plus a spot-check re-verification of the 6
fixable prior findings (all still hold, no regressions) and the CI-9/CI-10
residual items (unchanged, not re-flagged; DB/Redis TLS posture confirmed
already upgraded past the original WARN-only characterization since the
last pass).

14 findings, all fixed (1 HIGH, 8 MED, 5 LOW):

- CI2-33-1 (HIGH): `SecurityMonitoringMiddleware` read
  `request.state.user` — an attribute no auth path ever sets
  (`get_current_user` sets `.authenticated_user`) — and read it _before_
  `self.app()` ran, before any route dependency could populate anything.
  Session-hijack and data-exfiltration detection, two of the four
  capabilities the class docstring advertises, silently never ran for any
  request, ever. Fixed by reading the correct attribute after `self.app()`
  returns, once it's genuinely populated.
- CI2-33-2 (MED): the shared in-memory rate limiter's eviction sweep judged
  every tracked key's staleness against whichever call's `window_seconds`
  triggered the sweep, not the key's own — so a 3600s-window key
  (`data_export`, limit 3/hour) could be evicted/reset by a 60s-window
  sweep, letting an attacker exceed the hourly limit by spacing requests
  ~65s+ apart during exactly the Redis-outage window this fallback exists
  for. Fixed by recording and evicting against each key's own window.
- CI2-33-3 (MED): `database.py`'s connect() retry loop scrubbed
  `DB_PASSWORD` from per-attempt _log_ lines (the original CI-2 fix) but
  re-raised the raw, unscrubbed exception on total failure — reaching
  Uvicorn's startup output and Sentry with no surrounding try/except at the
  call site. Fixed by re-raising only the already-scrubbed detail, `from
None` to suppress cause-chain leakage too.
- CI2-33-4 (MED): the `ALGORITHM` boot check blocklisted only null-signature
  spellings ("none"), not enforced the pinned `HS256` value `decode_token()`
  hardcodes — a typo or different-but-real algorithm booted silently, then
  broke all authentication at runtime with zero boot signal. Fixed to
  `!= "HS256"`.
- CI2-33-5 (MED): `AUDIT_LOG_SIGNING_KEY` (signs the audit tamper-evidence
  chain and off-host shipping HMAC — ISO 27001 A.8.15) had no boot warning,
  unlike its sibling `VOTE_SIGNING_KEY` with the identical rationale. Fixed
  by mirroring that warning.
- CI2-33-6 (MED): `CAPTCHA_ENABLED=True` with an empty
  `CAPTCHA_SECRET_KEY` was only caught per-request (a silent skip, logged
  once), never at boot — an operator fat-fingering the 2026-08-16 red-team
  CAPTCHA rollout would believe the control was live indefinitely. Fixed
  with a boot-time warning mirroring `is_captcha_configured()`'s own
  condition.
- CI2-33-7 (MED): an unvalidated client-supplied `X-Request-ID` was
  interpolated verbatim into log lines and the response header, letting a
  client forge what reads as a genuine, distinct security-audit-trail
  entry (e.g. via embedded newlines). Fixed by only reusing an incoming id
  that matches the exact format this app generates.
- CI2-33-8 (LOW/MED): no sanity bound on `TRUSTED_PROXY_IPS` CIDR width — a
  misconfigured `0.0.0.0/0` (or similarly broad range) would trust
  `X-Forwarded-For` from any direct-connecting client within it, letting
  IP spoofing bypass every IP-keyed control downstream. Fixed with a
  boot-time warning above `/8` (a typical container network is never
  flagged).
- CI2-33-9 (LOW): `InputSanitizer.sanitize_string` truncated before
  HTML-escaping, so the escaped output could exceed `max_length`. Fixed by
  escaping first.
- CI2-33-10 (LOW): the CSRF onboarding bypass used a substring match
  instead of the anchored-prefix pattern this codebase already uses
  correctly one class over (`IPBlockingMiddleware.BYPASS_PREFIXES`); not
  exploitable against any route that exists today, but would silently
  widen the CSRF exemption to any future endpoint whose path merely
  contains "onboarding". Fixed to match the existing pattern.
- CI2-33-11 (LOW): `disconnect()` left `is_connected` stale (True) after
  closing the connection — no live caller checks it post-disconnect today,
  but a latent trap for future reconnect-on-demand logic. Fixed.
- CI2-33-12 (LOW/INFO): `InputSanitizer.validate_url` accepted a bare IPv4
  host literal (e.g. an internal/link-local address); the function has no
  callers today, but would need this closed the moment one appears. Fixed
  as defense in depth.
- CI2-33-13 (MED): injection-attempt detection was never implemented —
  the docstring claimed it, and the code buffered every write-request body
  (including login/password-change) into memory for an analysis step that
  read nothing back. Fixed by removing the dead buffering and correcting
  the docstring; real detection is a product decision, mirrored to
  `KNOWN_LIMITATIONS.md` as documented future work, not an open finding
  (nothing is broken — the capability is simply absent).

Completion gate: flake8/black/isort clean on all touched files, migration
validation passed (no schema change), 149/149 scoped backend tests passed
(23 new across the four touched test files), full backend suite 8972
passed / 38 failed (the identical pre-existing onboarding/facilities/
legal-doc set confirmed unrelated in the immediately preceding feature's
pass) / 22 skipped, no frontend changes this iteration.

Codex reviewed the fix commit and found 6 more real bugs — each time, my
original fix addressed the surface symptom but missed a deeper reason the
control still didn't work: (1) the rebuilt `EXPORT_ENDPOINTS` set still
didn't match any real route (fixed with a full grep-and-resolve of every
export route in the app, 15 real paths, one parameterized route
structurally excluded); (2) `session_id` came from `X-Session-ID`, a
header real clients never send (fixed by deriving it from the same
credential `get_current_user` authenticates with, hashed); (3) password
scrubbing missed the percent-encoded form `DATABASE_URL` actually embeds
(fixed to scrub both forms); (4) the CAPTCHA boot check only covered the
secret key, missing two more silent-failure pairings, site key and
provider (fixed, both added); (5) truncation could still cut an HTML
entity in half (fixed to trim back to the last complete entity); (6) the
`/8` trusted-proxy threshold was IPv6-blind (split into a v4/v6-aware
pair, `/8` and `/64`). All 6 verified against actual code before fixing,
per this rotation's standing rule. Full findings and guard tests in
`CI2-33-core-infra.md`'s "Revised after Codex review" section. Completion
gate re-run clean: flake8/black/isort clean, 103/103 scoped tests passed
(9 new/updated), full backend suite 8980 passed / 38 failed (same
pre-existing set, reconfirmed unrelated with this round's diff stashed
out) / 22 skipped.

Next: 34 frontend shared, once this PR merges.

### 2026-08-27 — Feature 34 (Frontend shared) — PR opened

This layer carries four prior app-review passes and one module-audit pass, all
of which explicitly noted the module axios instances and most of the shared
core were checked "for invariants, not line-by-line." Three parallel
background agents did that line-by-line read for the first time: (A) the
shared API/cache/error core (`apiClient.ts`, `apiCache.ts`, `errorHandling.ts`,
`errorTracking.ts`), (B) `createApiClient.ts` + all 12 module axios instances,
(C) `ProtectedRoute.tsx` + `authStore.ts`/`learningProgressStore.ts`/
`pendingSyncStore.ts`/`skillsTestingStore.ts` — including independently
re-verifying two items the module audit left open (FE-6, FE-7) against current
code rather than trusting the doc.

9 findings, all fixed (3 HIGH, 2 MEDIUM, 4 LOW):

- FE2-34-1/2/3 (HIGH/HIGH/MED-HIGH): three training endpoints
  (`/training/cohorts/{id}`, `/training/programs/programs/{id}/eligibility`,
  `/training/external/providers/{id}/user-mappings`) each return a
  member roster with resolved names/emails and had no entry in
  `UNCACHEABLE_PREFIXES` at all — held in the in-memory 90s cache on every
  page load. Fixed by adding all three (each as a trailing-slash prefix so
  the roster-free bare list stays cacheable).
- FE2-34-4 (MED): `/forms` bare list escaped its own exclusion — a live
  recurrence of the FE-2 trailing-slash bug class (`'/forms/'` doesn't match
  `'/forms'.startsWith(...)`), missed when the other six were fixed
  2026-08-08. Fixed.
- FE2-34-5/6 (LOW, defense-in-depth): `/grants` had the same trailing-slash
  shape (currently inert — that module doesn't use the cached global
  instance) and `/analytics/export` (raw per-user events) had no exclusion
  at all. Both fixed.
- FE2-34-7 (LOW): `authStore.getCsrfCookie` didn't `decodeURIComponent` the
  cookie value, unlike `apiClient.getCookie` — flagged as FE-7 in the
  original module audit and left unfixed across four app-review passes.
  Re-verified still present (currently inert — the backend's token alphabet
  has nothing to decode) and fixed to match.
- FE2-34-8 (LOW): `scheduling/services/api.ts`'s `getMyAttendance` swallowed
  _any_ error (network failure, 500, 403) as "not checked in," masking
  operational failures. Fixed to only swallow a confirmed 404, mirroring
  the correct pattern already used elsewhere in the codebase. Also removed
  a dead duplicate `_retry` type-augmentation block in the same file.
- FE2-34-9: re-verified FE-6 (module-audit MEDIUM — PII drafts/offline
  queue surviving logout) and found it already resolved by an intervening
  change (`purgeLocalMemberData()` wired into `authStore.logout()`, the
  idle-timeout path, and the session-expiry catch branch) — no code change
  needed, documented so it isn't re-flagged as open.
- Corrected a stale LOW finding in `docs/app-review/frontend-shared.md`:
  the `createApiClient.ts` 401-handler note didn't match current code (it
  imports and calls the same `handleExpiredSession` the global client
  uses, onboarding guard and `clearCache()` included).

Completion gate: flake8/black/isort n/a (no backend changes); `tsc --noEmit`
0 errors; `eslint` 0 errors (10 pre-existing warnings, unrelated files,
within budget); `npm run build` succeeds; full frontend suite 5242/5242
passed (397 files).

Next: 00 cross-cutting baseline (second full pass), once this PR merges.

### 2026-08-27 — Feature 33 (Core infrastructure) merged — PR #1917

Merged (squash, `5a1f859c`). Codex round confirmed and fixed (see the
Codex-round log entry above); the 14 original findings plus the 6 Codex
findings are all resolved with no open items. Rotation row 33 -> done.

---

## Relationship to the existing review passes

This rotation is **not** a replacement for the two that came before it, and it
must not re-derive their conclusions:

| Pass                   | Lens                                                | Where                |
| ---------------------- | --------------------------------------------------- | -------------------- |
| Module audit (2026-07) | tenant isolation, XC-1/2/3                          | `docs/module-audit/` |
| Application review     | correctness, duplication, dead code, doc accuracy   | `docs/app-review/`   |
| **Security review**    | the seven dimensions in `CHECKLIST.md`, PR per pass | here                 |

Each iteration reads the matching file in the other two directories first and
starts from their **open** findings. Re-verifying something they left open is
in scope; re-reporting something they fixed is not.

---

## Rotation

Ordered by risk: unauthenticated and money-handling surfaces first, then the
data-carrying modules, then the supporting infrastructure.

**Pass 1 complete (2026-08-25 → 2026-08-27):** every row below went ✅
(PRs #1799–#1918, see the Log for detail on each). Reset to ⬜ for pass 2 —
each row's prior PR is recorded in the Log, not repeated here.

| #   | Feature                   | Prefix | Principal code                                                                                                                                  | Status |
| --- | ------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 00  | Cross-cutting baseline    | SEC    | whole-codebase sweeps; see `SEC-00-cross-cutting-baseline.md`                                                                                   | ✅     |
| 01  | Auth & session lifecycle  | AUTH   | `endpoints/auth.py`, `auth_service.py`, `mfa_service.py`, `oauth_service.py`                                                                    | ✅     |
| 02  | Permissions & roles       | PERM   | `dependencies.py`, `core/permissions.py`, `roles.py`, `operational_ranks.py`, `officers.py`, `org_chart.py`                                     | ✅     |
| 03  | Public surface & webhooks | PUB    | `api/public/*` (20 unauth routes), `paypal_webhook.py`, `integrations_webhook.py`, `salesforce_webhook.py`                                      | ✅     |
| 04  | Storefront & payments     | SF     | `endpoints/storefront.py`, `storefront_service.py`, `utils/storefront_payments.py`                                                              | ✅     |
| 05  | Finance & approvals       | FIN    | `endpoints/finance.py`, `finance_service.py`, `public/finance_approvals.py`                                                                     | ✅     |
| 06  | Elections & ballots       | ELEC   | `endpoints/elections.py` (token-scoped voting)                                                                                                  | ✅     |
| 07  | Users & organizations     | USR    | `users.py`, `organizations.py`, `member_status.py`, `member_leaves.py`                                                                          | ✅     |
| 08  | Membership pipeline       | MP     | `membership_pipeline.py`, `membership_pipeline_service.py`                                                                                      | ✅     |
| 09  | Medical screening (PHI)   | MS     | `medical_screening.py`, `medical_screening_service.py`                                                                                          | ✅     |
| 10  | Documents & legal         | DOC    | `documents.py`, `station_documents.py`, `legal_documents.py`                                                                                    | ✅     |
| 11  | Inventory                 | INV    | `endpoints/inventory.py` (6539 L), `inventory_service.py`                                                                                       | ✅     |
| 12  | Facilities                | FAC    | `endpoints/facilities.py` (3724 L), `facilities_service.py`                                                                                     | ✅     |
| 13  | Apparatus & NFC           | AP     | `apparatus.py`, `nfc_tags.py`                                                                                                                   | ✅     |
| 14  | Equipment check & shifts  | EC     | `equipment_check.py`, `shift_completion.py`                                                                                                     | ✅     |
| 15  | Scheduling                | SCH    | `scheduling.py`, `scheduling_module_config.py`, `calcom_sync.py`                                                                                | ✅     |
| 16  | Events & requests         | EV     | `events.py`, `event_requests.py` (public submission path)                                                                                       | ✅     |
| 17  | Training core             | TR     | `training.py`, `training_programs.py`, `training_sessions.py`                                                                                   | ✅     |
| 18  | Training extended         | TRX    | `training_submissions.py`, `training_enhancements.py`, `training_waivers.py`, `external_training.py`, `course_cohorts.py`, `course_syllabus.py` | ✅     |
| 19  | Skills testing            | SKT    | `endpoints/skills_testing.py` (3723 L)                                                                                                          | ✅     |
| 20  | Compliance                | CMP    | `compliance_config.py`, `compliance_officer.py`                                                                                                 | ✅     |
| 21  | Admin hours               | AH     | `admin_hours.py`                                                                                                                                | ✅     |
| 22  | Grants & fundraising      | GF     | `grants.py`, `grant_service.py`, `fundraising_service.py`                                                                                       | ✅     |
| 23  | Medical supplies          | MSUP   | `medical_supplies.py`                                                                                                                           | ✅     |
| 24  | Meetings & minutes        | MM     | `meetings.py`, `minutes.py`                                                                                                                     | ✅     |
| 25  | Messaging & notifications | MSG    | `messages.py`, `message_history.py`, `notifications.py`, `email_templates.py`                                                                   | ✅     |
| 26  | Forms                     | FORM   | `endpoints/forms.py`, `public/forms.py`                                                                                                         | ✅     |
| 27  | Integrations              | INT    | `integrations.py`, `salesforce_sync.py`                                                                                                         | ✅     |
| 28  | Security, audit & IP      | SEC2   | `security_monitoring.py`, `ip_security.py`, `audit_logs.py`, `error_logs.py`                                                                    | ✅     |
| 29  | Reports & analytics       | RPT    | `reports.py`, `analytics.py`, `platform_analytics.py`, `dashboard.py`, `labels.py`                                                              | ✅     |
| 30  | Onboarding                | ONB    | `api/v1/onboarding.py` (24 unauth bootstrap routes)                                                                                             | ✅     |
| 31  | Scheduled tasks           | CRON   | `scheduled.py`, `services/scheduled_tasks.py`                                                                                                   | ✅     |
| 32  | Locations & kiosk         | LOC    | `locations.py`, `admin_hub.py`                                                                                                                  | 🔄     |
| 33  | Core infrastructure       | CORE   | `core/security_middleware.py`, `core/database.py`, `core/config.py`                                                                             | ⬜     |
| 34  | Frontend shared           | FE     | `utils/apiCache.ts`, module axios instances, `ProtectedRoute`, global stores                                                                    | ⬜     |

**35 iterations per full pass.** After 34 the rotation wraps to 00, which
re-runs the whole-codebase sweeps against whatever has landed since.

---

## Log

- **(init, 2026-08-25)** Rotation created at the owner's request: a 30-minute
  loop running an application-wide, feature-by-feature security review with a
  pull request per iteration. Feature partition derived from the current
  endpoint inventory (66 files in `api/v1/endpoints/`, 11 in `api/public/`),
  ordered by risk rather than alphabetically.
- **SEC-00 cross-cutting baseline ⏳** — five whole-codebase sweeps. Four came
  back clean with the mechanism named (CSV injection, `SET NULL` nullability,
  proxy-IP attribution, Alembic chain integrity); the fifth found a live class
  and closed it. **SEC-1/2/3: LIKE-wildcard handling** — 2 sites interpolated
  raw user input into a LIKE pattern, 47 escaped the input but never declared
  `ESCAPE '\'` (inert under `NO_BACKSLASH_ESCAPES`), and the transform that
  `app/utils/sql_search.py` was written to own had been copy-pasted into 15
  files while exactly one call site used the helper. All 76 `like`/`ilike`
  calls now pass `escape=LIKE_ESCAPE_CHAR`, the transform has one
  implementation, and `tests/test_like_escaping.py` fails on reintroduction of
  either half. **SEC-4** — a pre-existing mis-attribution in the inventory
  barcode search, found by the flake8 run the sweep forced. Next: 01 auth &
  session lifecycle.
- **SEC-00 cross-cutting baseline ✅ merged** — PR #1799 merged 2026-08-25
  08:34:59Z.
- **01 Auth & session lifecycle ✅ merged** — PR #1804 merged 2026-08-25.
- **01 Auth & session lifecycle ⏳** — two prior app-review passes
  (`docs/app-review/auth-session.md`, 2026-08-05 and 2026-08-08) already did a
  six-lens sweep; this iteration re-verified those claims against current code
  (still accurate) and applied the checklist dimensions those passes covered
  lightly. **AUTH-1 (MED)** — OAuth login never adopted the 2026-08-12
  organization-active check that password login got, and fell back to an
  unscoped user lookup (a latent tenant-isolation gap) when its org lookup
  came back empty; fixed to filter on `Organization.active` and fail closed,
  mirroring password login exactly. **AUTH-2 (NIT)** — the prior pass's route
  count (25) and "refresh grace window intact" claim had both drifted from
  current code (26 routes; the grace window was deliberately removed
  2026-08-12); corrected in `auth-session.md`. See
  `AUTH-01-auth-session.md` for the full write-up. Next: 02 permissions &
  roles.
- **02 Permissions & roles ✅ merged** — PR #1805 merged 2026-08-25. A Codex
  review comment caught a real regression in the PERM-2 fix before merge
  (a plain `db.rollback()` would have expired `current_user` and raised
  `MissingGreenlet` on the next request-scoped access) — corrected to a
  SAVEPOINT (`begin_nested`), verified empirically against a live DB
  connection, replied, and resolved.
- **02 Permissions & roles ⏳** — `roles.py`/`role_service.py`/
  `dependencies.py`/`core/permissions.py` carry an extremely thorough
  privilege-escalation history (module audit + 4 app-review passes through
  2026-08-09); spot-checked the ceiling machinery still holds unchanged (git
  log: zero commits to those 3 files since). `officers.py`, `org_chart.py`,
  and `operational_ranks.py` are new since that pass (added 2026-08-21/24) and
  carry no prior audit — read in full. **PERM-1 (LOW)** — `GET
/operational-ranks/validate` backs a `settings.manage`-gated screen but had
  no server-side permission check of its own; any authenticated member could
  call it directly and see which members have a misconfigured rank. Fixed to
  match its CRUD siblings. **PERM-2 (LOW)** — `seed_defaults` had a narrow
  concurrent-first-load race (two admins opening a brand-new org's Settings at
  once) that surfaced as an uncaught 500 instead of the ranks simply loading;
  now rolls back and returns the already-seeded set. See
  `PERM-02-permissions-roles.md` for the full write-up. Next: 03 public
  surface & webhooks.
- **03 Public surface & webhooks ⏳** — 6 of 12 files already carried thorough
  prior coverage (`public-portal.md`, `integrations.md`, `forms.md`,
  `storefront.md`); spot-checked and confirmed unchanged. `display.py` grew
  3x (119→401 L, the new guest QR check-in feature) since the last audit —
  re-read in full, verified tenant-safe and enumeration-resistant. Five files
  (`finance_approvals.py`, `legal.py`, `responses.py`, `salesforce_webhook.py`,
  `security_txt.py`) had no prior audit at all — read in full. **PUB-1
  (LOW)** — the Salesforce inbound webhook had no cap on payload record
  count; a validly-signed but oversized request could drive unbounded DB
  work inside the per-request rate limit. Fixed with a 500-record cap.
  **A Codex review comment on the PR caught a real ordering bug in that
  fix** — the cap check ran after the replay-fingerprint mark, so a
  rejected oversized request still got fingerprinted "seen," and a
  provider's retry of the same payload would be mistaken for an
  already-handled duplicate (200) instead of being validated again. Fixed by
  moving payload-shape validation before the replay check. **PUB-2 (NIT)** —
  documented `legal.py`'s single-org guard, which was already correct but
  unexplained. **PUB-4 (MED)** — **a second Codex review comment correctly
  challenged this iteration's own initial conclusion**: the finance
  token-approval path's lack of a self-approval check had been recorded as
  "verified safe" on the reasoning that the token path has no Logbook
  identity to compare — true for POSITION/PERMISSION/SPECIFIC_USER approver
  types, but wrong for `EMAIL`-type steps, where the approver's identity
  _is_ the literal email on the step. Fixed: `approve_by_token` now blocks
  self-approval when the step's approver email matches the requester's,
  unless the step explicitly sets `allow_self_approval`. **PUB-3 (INFO)** —
  recorded that the finance approval tables are `create_all`-only by design,
  matching the documented pattern elsewhere. See
  `PUB-03-public-surface-webhooks.md` for the full
  write-up. Next: 04 storefront & payments.
- **03 Public surface & webhooks ✅ merged** — PR #1806 merged 2026-08-25.
- **04 Storefront & payments ⏳** — already the most heavily-audited module
  in the codebase (module audit + 2 app-review passes, called "the
  best-defended module reviewed to date"); re-verified all established
  invariants hold unchanged and read the one file with no prior coverage
  (`storefront_preview_service.py` — clean). Found via git history, not
  re-derivation, that module-audit's previously-open SF-4 (`storefront.order`
  held by one endpoint) was resolved 2026-08-24 by a position-editor fix
  (`_VIEW_IMPLIED_PERMISSIONS`) — corrected that doc to mark it resolved.
  **A Codex review comment on the PR caught that the initial "no new
  findings" conclusion was wrong on three counts**: the git-history sweep
  had missed 5 real commits (this repo's history is squashed/rewritten, so
  `--since` and ancestry checks can't be trusted — matches the same issue
  AUTH-01 already documented); one of those 5 was a real gap — **SF-6 (MED)**
  — `record_payment` (the shared engine `mark_order_paid`/
  `waive_order_payment`/`refund_order` all delegate to, and also its own
  directly-callable endpoint) had no separation-of-duties check unlike its
  three siblings, letting a `storefront.manage` holder settle their own
  order's payment; and a still-open prior-review item (unbounded
  `/orders/export`) had been silently dropped instead of carried forward.
  Fixed SF-6, carried the export item forward as still-open, corrected the
  write-up. Closed one cheap test-coverage gap the 2026-08-08 app-review had
  flagged: added a regression test for the refund amount's `gt=0` constraint.
  See `SF-04-storefront-payments.md` for the full write-up. Next: 05 finance
  & approvals.
- **04 Storefront & payments ✅ merged** — PR #1807 merged 2026-08-25 12:39
  UTC.
- **05 Finance & approvals ⏳** — the most heavily audited module in the
  codebase before this pass even started (module audit + 4 app-review
  passes). Re-verified FIN-1/2 (`_validate_finance_fks`, 13 call sites), FIN-3
  (dues self-scoping), FIN-4 (`assert_different_person` disburse-side SoD),
  FIN-6 (dues-payment ledger + idempotency) all hold unchanged. All 66 routes
  enumerated and confirmed `require_permission`-gated. **FIN-9 (MED, fixed)**
  — `get_pending_approvals` queried `ApprovalStepRecord` with no organization
  filter at all, scanning every tenant's pending approval steps (not merely
  "the org-wide queue" the prior passes' notes described) before the
  per-record `_get_entity_info` call silently discarded anything foreign from
  the response — no data leaked, but the query cost scaled with the whole
  platform's pending-approval volume on every approver's inbox load. Fixed by
  resolving each entity type's org-scoped id set first and filtering the
  record query on it before the N+1 follow-up loop runs. **Four Codex review
  comments on the PR all caught real issues and were fixed**: (1) the initial
  fix materialized each entity type's id set into a Python list before
  filtering — a large org's full request history — rewritten to pass
  correlated subqueries into `.in_()` so the database does the filtering; (2)
  the regression test only asserted on the returned list, which
  `_get_entity_info`'s own filter would have passed even under the old,
  unfiltered query — rewritten to spy on `_get_entity_info` and assert the
  foreign record's id never reaches it; (3) the write-up's "12 finance
  tables, all `create_all`-only" claim was wrong on both counts — 15 tables,
  and `dues_payments` has a real (conditional) creating migration a
  single-line-only grep pattern missed; corrected with the accurate
  breakdown; (4) the "zero logic commits since Aug 9" premise was itself
  wrong — a broader sweep (not path-filtered `git log`, which this repo's
  rewritten history can mislead, per AUTH-01/SF-04) surfaced a real Aug 16
  commit (`3dd2b28b`, token-approval locking) the original sweep missed;
  corrected, though the current-code review this pass actually ran already
  covered that commit's effect. See `FIN-05-finance-approvals.md` for the
  full write-up. Next: 06 elections & ballots.
- **05 Finance & approvals ✅ merged** — PR #1809 merged 2026-08-25 15:49
  UTC.
- **06 Elections & ballots ⏳** — the most heavily audited module in the
  codebase (module audit + 13 R-findings + 5 R-D findings + 5 app-review
  passes, all closed). File sizes have nearly doubled since the module-audit
  header was written (`elections.py` 2,721→3,809 L, 46→65 routes;
  `election_service.py` 4,616→7,962 L) with no discrete finding ever called
  out for the growth — cross-checked the current route list against
  everything every prior pass named and nearly all of it is accounted for
  (voter-overrides, proxy-authorizations, manual-ballots, attendees,
  eligibility-roster, package assembly — each individually documented across
  the R/R-D/ELEC2 series; only the header counts were never bumped).
  **One feature outside the module-audit/app-review/security-review doc set
  found:** `SavedBallotTemplate` (migration `20260812_0001`) — org-scoped
  list/create/delete, `elections.manage` gated, `extra="forbid"` schema
  accepting only configuration fields (no election/voter/candidate/token/
  result data), audit-logged. Access-control clean. Also re-verified all 31
  `select(Election)` call sites in `election_service.py` for tenant
  isolation (28 direct, 3 safe-by-construction) — no FIN-9-shaped unscoped
  scan here. Corrected the stale endpoint/line counts in
  `module-audit/elections.md` (NIT). **Two Codex review comments on the PR
  both caught real issues**: (1) the route-inventory table's "61
  permission-gated" claim conflated authenticated with permission-gated —
  5 voter-facing routes (`check_eligibility`/`cast_vote`/`cast_bulk_votes`/
  `get_results`/`cast_proxy_vote`) are authenticated-only by documented
  design (self-scoped, not a gap), corrected to 56 gated + 5
  authenticated-only + 4 public; (2) `SavedBallotTemplate`'s list/create
  were recorded as clean when they're actually unbounded — no pagination on
  the list, no per-org cap on creation — a real dimension-6 (abuse
  resistance) gap the initial pass missed by checking access control only.
  **ELEC-12 (LOW/MED, flagged, not fixed)** — both remedies are
  behavior-change judgment calls (response-envelope pagination, an
  arbitrary creation cap), so flagged rather than guessed; mirrored into
  `KNOWN_LIMITATIONS.md`. Also caught in my own review before push: the
  write-up initially claimed `SavedBallotTemplate` was "previously
  undocumented," but `KNOWN_LIMITATIONS.md` already carries a 2026-08-12
  ship-time entry on it (a different angle — schema tolerance, not access
  control); corrected. See `ELEC-06-elections-ballots.md` for the full
  write-up. Next: 07 users & organizations.
- **06 Elections & ballots ✅ merged** — PR #1810 merged 2026-08-25 16:59
  UTC.
- **07 Users & organizations ⏳** — the highest-risk surface by design
  (privilege escalation): module audit iteration 21 (three parallel readers)
  - 4 dedicated app-review passes, all closed except ORU-7c (unchanged).
    Re-verified the privilege-ceiling functions, PII redaction gates, and
    settings-secret redaction are still wired at every documented call site.
    **An 8-issue Codex review round on the PR** corrected the initial pass's
    "no defect found" conclusion — 6 fixed, 2 doc-corrected: **USR-1**
    (leave-of-absence create/update/delete never wrote an audit event despite
    the event types existing since the audit-history feature shipped — now
    fixed, 3 tests), **USR-2** (MED — the audit-history query's actor-fallback
    clause had no target check, so an event where the viewed member acted ON
    someone else leaked that other member's event_data into the viewed
    member's history — narrowed to only fire on genuinely self-inherent
    events, DB-backed regression test verified to fail without the fix),
    **USR-3** (two real, emitted audit event types — admin MFA reset,
    compliance exemption change — were invisible in member history because
    neither was in the endpoint's allowlist — added), **USR-4** (a schema
    test looked up the pre-rename table name `user_roles` instead of
    `user_positions` and had been silently skipping instead of verifying
    anything — fixed, now passes for real), **USR-5** (flagged — the
    "no defect" pass's unbounded-list dismissal was wrong: archived accounts
    and leave records accumulate for an org's entire lifetime rather than
    being bounded by current headcount; 2 more instances found in this
    module's own files beyond the 2 the first pass checked; not fixed,
    pagination is a response-envelope decision same as ELEC-12), plus a
    corrected route-inventory claim (3 org-wide reads use bare `get_current_user`
    with no self-check — already-audited ORU-8b pattern, not a gap) and a
    corrected test-coverage claim (added a source-inspection guard test since
    the cited helper-level tests don't exercise the actual route call sites).
    See `USR-07-users-organizations.md` for the full write-up. Next: 08
    membership pipeline.
- **07 Users & organizations ✅ merged** — PR #1814 merged 2026-08-25 18:18
  UTC.
- **08 Membership pipeline — 5 fixed, 1 flagged (via Codex on the draft PR),
  plus 1 more found and fixed while fixing one of those.** First drafted as a
  "no new findings" re-verification pass; Codex's review of that draft PR
  caught five real issues the draft had missed, and fixing one of them
  (`update_prospect` dropping explicit nulls) surfaced a second, unguarded
  path to the exact `TRANSFERRED`-manipulation bug PR #1811's own Codex
  review had already fixed on the dedicated status endpoints — the generic
  `PUT /prospects/{id}` reaches the same status column and had none of that
  fix's guards. Fixed: the explicit-null drop itself (now routes through
  `apply_updates`, this service's established pattern elsewhere); the second
  `TRANSFERRED` path (closed the same way as the first); `/approve-step`
  returning the full applicant record — DOB, address, coordinator notes — to
  a signer authorized only by the role they hold, not by view permission
  (now returns a minimal `{prospect_id, step_id, step_completed}` result);
  and `PUT`/`DELETE /interviews/{id}` bypassing the router-wide self-access
  guard, because those routes carry no `{prospect_id}` path parameter for it
  to key on (added a dedicated `block_self_interview_access` dependency).
  Flagged, not fixed: unbounded election-package listing/creation, the same
  class as ELEC-12/USR-5 — pagination and a creation cap are both
  behavior/contract changes needing an owner decision. Full completion gate
  re-run after the fixes (flake8/black/isort/migrations/228 pipeline tests +
  37 PII-exposure tests/tsc, all green). See `MP-08-membership-pipeline.md`
  for the complete writeup, including the revision note explaining the
  draft-vs-final split. Next: 09 medical screening (PHI).
- **08 Membership pipeline ✅ merged** — PR #1815 merged 2026-08-25 19:43
  UTC.
- **09 Medical screening (PHI) — 2 fixed, 1 re-flagged, 1 doc correction.**
  Module-audit (MS-1–MS-3) and app-review (four passes, MS-1/MS-2/MS-3/
  MS2-4/MS2-5) had no open findings — MS-1 (PHI plaintext) was closed in
  app-review pass 4 via `EncryptedText`/`EncryptedJSON`; re-verified
  genuinely intact (model columns, migration, reversibility all checked).
  Reviewed the two pieces added since the 2026-08-09 baseline in full:
  `GET /compliance/me` (self-scoped, structurally IDOR-safe — no id param —
  minimal-detail response) and a new medical-screening → membership-pipeline
  auto-advance integration (org-scoped and gated through the same
  `_assert_movable`/stage-completion checks MP-08 reviewed). **MS-4** (doc
  correction): `KNOWN_LIMITATIONS.md` and `APPLICATION_PAGES.md` both
  claimed the frontend route was ungated; it was fixed the day before this
  review (`05b8275b`, "gate 21 officer pages") and neither doc was updated —
  both corrected. **MS-5** (fixed): `update_record`/`update_requirement`
  wrote every field with a bare `setattr`, so an explicit null on a NOT NULL
  column (`status`/`screening_type`/`name`) 500'd as a raw `IntegrityError`
  instead of a clean 400 — the same failure shape MS2-5 fixed for an
  out-of-enum string, just for the null case its validator doesn't cover.
  Rewritten to use `apply_updates`. **MS-6** (flagged): unbounded
  requirement/record lists, the same class as FIN-9/ELEC-12/USR-5/MP-10 —
  first flagged in app-review pass 3 but never mirrored into
  `KNOWN_LIMITATIONS.md` until now. Two more LOW items re-verified still
  accurate, left open, not re-flagged. See `MS-09-medical-screening.md`.
  Next: 10 documents & legal.
- **09 Medical screening (PHI) ✅ merged** — PR #1816 merged 2026-08-25
  22:39 UTC. No Codex findings on this one — clean pass.
- **10 Documents & legal — no new findings.** The rotation row bundles three
  files, but only `documents.py` had ever been reviewed
  (`docs/module-audit/documents.md` DOC-1–6,
  `docs/app-review/documents.md` four passes); `station_documents.py` and
  `legal_documents.py` — and their backing services — had no prior review at
  all. Re-verified `documents.py`: DOC-1/2/3/6 still fixed; DOC-4 (summary
  ignores folder ACL) and DOC-5 (ACL not hierarchical) still open, unchanged
  — DOC-5 confirmed to extend identically to a facility-folder hierarchy
  added since the last pass. First full review of the other two: the
  station-document print path (shift roster / apparatus check sheet to a
  receipt printer) correctly inherits scheduling's own pass-down-notes
  access rule and equipment-check's own position-narrowing rather than
  re-deriving looser ones; the legal-document propose/publish workflow is
  org-scoped throughout, uses `apply_updates` correctly, and — checked
  through to the frontend — the one path here where an authenticated write
  reaches an anonymous audience (the public `/privacy`/`/terms` pages)
  renders custom text as plain JSX, never `dangerouslySetInnerHTML`, so it
  cannot inject markup. No code changes. See `DOC-10-documents-legal.md`.
  Next: 11 inventory.
- **10 Documents & legal ✅ merged** — PR #1826 merged 2026-08-26 03:19 UTC
  (the follow-up applying the 11-comment Codex round from #1821, DOC-19–21,
  plus the consolidated #1827 download-endpoint work, DOC-18/22–26 — see the
  log entries above for the full history). #1827 closed as superseded.
  Next: 11 inventory.
- **11 Inventory — 2 fixed, 2 flagged.** Re-verified INV-1/2/3/5/6 from the
  module audit still hold and that INV-4's ~13-method XC-1 FK-scoping sweep
  (app-review pass 4) is genuinely closed. Corrected a stale endpoint count
  in `module-audit/inventory.md` (132, not 116, even at that doc's own
  commit — this repo's squashed history means the doc's stated snapshot was
  already out of date when it was written, not a sign of undocumented
  growth). Enumerated all 132 routes (0 unauthenticated). **INV-7 (MED,
  fixed)** — `GET /clearances/{clearance_id}` was gated on the baseline
  `inventory.view` while every sibling clearance route, including the
  identically-shaped `/users/{user_id}/clearance`, requires
  `inventory.manage`; the recent `ccea2576`/`d7be097b` permission-tightening
  commits missed this one route. Tightened to match; no frontend caller
  exists (the feature is backend-only per `KNOWN_LIMITATIONS.md`).
  **LBL-1 (LOW, fixed)** — `POST /labels/print` (a shared cross-module route
  bundled with this feature since the module audit reviewed it together)
  echoed the printer transport's raw error, including its configured LAN
  host:port, to any caller holding just the target module's `.view`
  permission — this rotation's own recent DOC-10 pass had fixed the
  identical leak in `station_documents.py` and assumed (incorrectly, for
  this one route) that all of `labels.py`'s printer routes were
  `settings.manage`-gated. Fixed the same way: log server-side, generic 502
  to the caller. Flagged: **INV-8** (allowance-usage-by-member) and **INV-9**
  (size-preferences-by-member), both cross-member reads on the baseline
  `.view` grant with no established sibling precedent for the intended gate
  — owner decision, mirrored to `KNOWN_LIMITATIONS.md`. Full completion gate
  green: flake8/black/isort/migrations clean, full 8302-test backend suite
  passed. See `INV-11-inventory.md` for the complete write-up. Next: 12
  facilities.
- **11 Inventory ✅ merged** — PR #1835 merged 2026-08-26 04:47 UTC. No
  review-bot findings on this one (Codex reported it had hit its usage
  limit for security reviews); CI green on the first run.
- **12 Facilities — 4 fixed, 1 doc correction (via Codex on the draft PR).**
  First drafted as "no new findings, no code changes" — re-verified FAC-1
  through FAC-5 all hold (including the HIGH-severity FAC-5 sensitive-family
  gate) and read the new `GET /{facility_id}/folders` bridge to the generic
  Documents module for IDOR/org-scoping only (clean). **A Codex review of
  that draft caught 5 real issues the draft missed.** Fixed:
  **FAC-6 (HIGH, availability)** — `ensure_facility_folder`'s get-or-create
  had no locking or uniqueness constraint, so two concurrent first-accesses
  to a facility's folders could both insert a duplicate, after which every
  later read raised `MultipleResultsFound` — a permanently broken endpoint
  for that facility. Fixed with an organization-row lock (Pitfall #27
  shape). **FAC-7 (MED)** — 6 update methods plus the module's shared
  `_apply_updates` helper (19 call sites total) hand-rolled a blind
  `setattr` loop, so an explicit null on a NOT-NULL column (e.g.
  `Facility.name`) 500'd as a raw `IntegrityError` instead of a clean 400 —
  the same class MS-5 already fixed elsewhere. Routed through the shared
  `apply_updates` utility. **FAC-8 (LOW)** — `FacilityPhotoResponse`/
  `FacilityDocumentResponse` leaked the internal storage `file_path` to any
  `facilities.view` holder; now excluded, matching the Documents module's
  own `DocumentResponse` precedent. **FAC-9 (LOW)** — the new folder
  endpoint's `document_count` crossed the `documents.view` permission
  boundary (the same aggregate-disclosure class as DOC-4, still open in the
  Documents review); now redacted to `null` for callers without
  `documents.view`/`.manage`. **FAC-4 correction**: the draft (and every
  app-review pass before it) claimed facility search was "wired but not
  exposed" — Codex caught that this is stale; `GET /facilities`/`/page`
  both forward `search` and the frontend calls it. Corrected in
  `module-audit/facilities.md` and `app-review/facilities.md`. Full
  completion gate green including the full 8317-test backend suite. See
  `FAC-12-facilities.md` for the complete write-up. Next: 13 apparatus &
  NFC.
- **12 Facilities ✅ merged** — PR #1836 merged 2026-08-26 10:56 UTC.
- **13 Apparatus & NFC — 1 fixed, no defect in either new feature.**
  Apparatus itself re-verified clean (AP-1/AP2-1/AP2-2 all still closed).
  First full review of `nfc_tag_service.py` (member ID cards + check-in
  stations) and `driver_exception_service.py` (EVOC-requirement bypass, tied
  into scheduling) — both new since the last pass, neither previously
  audited, and both already well-hardened (hashed card UIDs,
  separation-of-duties on the exception approval, a locking conditional
  UPDATE for the approval race). **AP-6 (LOW, fixed)** — tracing the NFC
  admin-hours check-in path surfaced a missing `organization_id` filter on
  `AdminHoursService.clock_out_by_category`'s own query; not exploitable
  today (both callers pass the caller's own id and entries are
  org-consistent by construction), but closed on the query itself rather
  than continuing to rely on that invariant holding. A sibling method
  (`clock_out`) with the same shape is left for the Admin Hours module's own
  turn (feature 21). Full completion gate green, full 8388-test backend
  suite. See `AP-13-apparatus-nfc.md` for the complete write-up. Next: 14
  equipment check & shifts.
- **13 Apparatus & NFC ✅ merged** — PR #1838 merged 2026-08-26 12:31 UTC.
  A Codex review round caught that the new guard test's org-scoping
  assertion was hollow (checked the whole compiled statement rather than
  its WHERE clause); fixed, and the same pre-existing flaw in a sibling
  test in the same class was fixed alongside it.
- **14 Equipment check & shifts — no new findings, no code changes.** The
  most heavily audited module by finding-count in the rotation (11 fixes
  in the module audit alone, including a HIGH cross-tenant apparatus write,
  plus 3 more from app-review). Re-verified all 14 prior fixes hold.
  `equipment_check.py` grew from 34 to 47 routes since the last pass — a
  new supply-officer stock swap/consume/recount feature (9 endpoints
  touching `InventoryLot` quantities, the exact shape of surface this
  module's history shows is where its defects live). Read all nine, and
  their service methods, in full. Found them already correctly
  org-scoped, and the one concurrency-sensitive operation
  (`swap_item_lot`) correctly locking three separate rows in a
  deliberately fixed order to avoid both an overconsumption race and a
  lock-ordering deadlock. No defect found. Full completion gate green,
  full 8500-test backend suite. See `EC-14-equipment-check-shifts.md` for
  the complete write-up. Next: 15 scheduling.
- **14 Equipment check & shifts — correction: a Codex review of the above
  draft caught 3 real issues it missed.** (1) `report_item_used` was an
  unlocked read-modify-write on deployed-lot quantities — fixed with a
  row lock plus a locking read on the item's deployed lots, same order as
  `swap_item_lot`. (2) A submit-only caller could inflate a deployed
  lot's quantity via `update_deployed_lot` (only metadata changes were
  blocked, not increases) and then use that inflated figure as
  `swap_item_lot`'s submitter cap — fixed by requiring manage permission
  for a quantity increase under `allow_metadata_change=False`. (3) None
  of the 9 new supply endpoints were in the frontend's
  `UNCACHEABLE_PREFIXES` despite carrying reporter names and free-text
  notes — fixed by adding `/equipment-checks`. A 4th thread (the
  pre-existing `get_item_deployments` `.view`-vs-`.manage` gate gap) was
  confirmed already deliberately unadjudicated and mirrored into
  `docs/KNOWN_LIMITATIONS.md` rather than fixed. Same shape as FAC-12's
  draft-vs-final split. `EC-14-equipment-check-shifts.md` rewritten with
  a Revision note and the EC-12/EC-13/EC-14 write-ups. Guard tests added
  for all three fixes. Full completion gate green, full 8542-test backend
  suite, frontend `tsc`/`eslint`/`vitest` clean.
- **14 Equipment check & shifts ✅ merged** — PR #1842 merged 2026-08-26.
  All 4 Codex review threads replied to (with the fixing commit hash) and
  resolved; all 16 CI checks green on the merged head, no merge conflict.
  Next: 15 scheduling.
- **15 Scheduling — PR #1846 opened.** `scheduling.py` and
  `scheduling_service.py` have roughly doubled in size since the last
  full read (module-audit iteration 19 + 4 app-review passes,
  2026-08-06..09): endpoints ~1,900 → 3,437 L (92 routes), service
  ~5,000 → 7,018 L. Re-read both in full rather than treating the growth
  as incremental, plus `standing_shift_service.py` (570 L, recurring
  member shift claims) and the `scheduling_module_config`/`calcom_sync`
  surface, neither previously reviewed. SCH-1 through SCH-8 all
  re-verified still fixed, no regressions. One new finding: SCH-9 (LOW,
  XC-1) — `create_shift_call`/`update_shift_call` stored a
  client-supplied `responding_members` user-id list with no in-org
  check, the one exception to this file's otherwise-universal
  client-supplied-user-id discipline; `compute_member_call_counts` sums
  this column, so a foreign id could inflate an unrelated org's
  member's call-count statistic. Fixed via the same `_user_in_org`
  helper used everywhere else in the file. Guard tests added
  (`test_scheduling_org_scoping.py::TestShiftCallRespondingMembersScoping`).
  Full completion gate green, full 8544-test backend suite. See
  `SCH-15-scheduling.md` for the complete write-up.
- **15 Scheduling ✅ merged (#1846), Codex round follow-up opened
  (#1847).** #1846 was merged by the repo owner before its Codex review
  round finished, leaving 3 findings unaddressed on `main`: a real
  efficiency gap (SCH-9's original per-id validation loop — up to 100
  serial queries) and two inaccurate claims in the draft's own write-up
  (SCH-9's cross-tenant impact was overstated — there is no cross-tenant
  failure scenario, since every reader of `responding_members` is scoped
  to one already org-validated shift/trainee first; and a "Verified
  good" claim that `calcom_service.py` closes the DNS-rebinding TOCTOU
  was wrong — it narrows the window, and the same repo-wide pattern
  exists in 5 other integration services). Followed the merged-branch
  protocol: rebased the one unmerged commit onto latest main rather than
  reusing or discarding it, pushed to a fresh branch, opened #1847.
  SCH-9 downgraded to NIT with corrected text; the DNS-rebinding gap
  filed as SCH-10, flagged (cross-cutting, not scheduling-specific) and
  mirrored into `KNOWN_LIMITATIONS.md`. Replied to and resolved all 3
  Codex threads on the now-merged #1846, referencing #1847. Full
  completion gate green, full 8556-test backend suite.
- **15 Scheduling — #1847 ✅ merged.** A second Codex round on #1847
  itself caught that the SCH-10 correction had undercounted its own
  affected surface — six files sharing one fix, when it's actually seven
  callers of `assert_outbound_url_safe` across three distinct transports
  (five via the shared `create_integration_client`, one hand-built
  `httpx.AsyncClient` in `audit_ship_service.py`, one `pywebpush` in
  `push_service.py` — neither of the latter two reachable by a fix
  scoped to the shared client factory). Corrected in both
  `SCH-15-scheduling.md` and `KNOWN_LIMITATIONS.md`; replied to and
  resolved the thread. All 16 CI checks green on the merged head, no
  merge conflict. Next: 16 events & requests.
- **16 Events & requests — PR #1848 opened.** `events.py`,
  `event_requests.py`, and `event_service.py` grew 15-30% since the last
  full read (module-audit iteration 17 + 4 app-review passes,
  2026-08-06..09); read all three in full plus the new
  `event_request_service.py` (extracted from `event_requests.py`'s
  endpoint file since the last audit). EV-1 through EV-10, EV2-1, EV2-2
  all re-verified still fixed, no regressions. One new finding: EV-11
  (LOW, XC-1) — `create_recurring_event`'s client-supplied `template_id`
  was not org-validated, unlike `location_id` checked two lines above it
  — fixed via the existing org-scoped `get_template()`. A first draft of
  the fix also wrongly added the same check to `create_event`, based on
  a misread of the schema (`EventCreate` has no `template_id` field at
  all); this failed all 16 tests in `test_event_lifecycle.py` and was
  caught and reverted by running the full suite before opening the PR,
  not by external review. Full completion gate green, full 8557-test
  backend suite. See `EV-16-events-requests.md` for the complete
  write-up.
- **16 Events & requests ✅ merged** — PR #1848 merged 2026-08-26. No
  review threads; all 16 CI checks green on the merged head, no merge
  conflict. Next: 17 training core.
- **17 Training core — PR #1851 opened.** The largest feature reviewed so
  far: `training.py`, `training_programs.py`, `training_sessions.py`, and
  their 3 backing services (~11,000 L combined), split off from the
  module-audit's single "Training" unit (8 endpoint files, 154 endpoints)
  — `training_submissions.py`/`training_enhancements.py`/
  `training_waivers.py`/`external_training.py`/`course_cohorts.py`/
  `course_syllabus.py` are feature 18. `training_program_service.py` grew
  36% since the module audit (4,027 → 5,482 L); read all six in-scope
  files in full, split across 3 parallel reads. TR-1/2/4/7/9/10
  re-verified still hold. 3 new findings, all fixed: TR-11 (MEDIUM, XC-1)
  — program JSON-import stored a client-supplied `category_ids` array
  unvalidated, the one requirement-creation path in the file missing the
  `assert_all_in_org` guard every sibling path has; also fixed a missing
  `except ValueError` wrapper on the import endpoint (a pre-existing
  latent-500 this fix's own new raise would have hit too). TR-12 (LOW/MED,
  XC-3) — two `User` lookups in `training_service.py` had no org filter,
  reachable by a `training.manage` officer supplying a foreign org's
  `user_id` (existence oracle + a cross-org membership_type read feeding
  tier-exemption logic). TR-13 (LOW/MED, XC-1) — `course_id` was never
  org-validated on 3 record-create paths, unlike `user_id`/`category_id`
  on the same endpoints. Also closed 1 stale carried-forward flag (doc
  correction, not code): the training-sessions "dangling FK batch" is
  already resolved via `_validate_linkage_ids`, corrected in
  `docs/app-review/training.md`. 2 items flagged (enum validation gap in
  bulk/historical-import paths; `enroll_member`'s duplicate-enrollment
  race), mirrored into `KNOWN_LIMITATIONS.md`. Full completion gate green,
  full 8663-test backend suite. See `TR-17-training-core.md` for the
  complete write-up.
- **17 Training core ✅ merged** — PR #1851 merged 2026-08-26. No review
  threads (Codex reported it had hit its usage limit for security reviews,
  same as #1835); CI ran clean. Next: 18 training extended.
- **18 Training extended — PR #1873 opened.** The other half of the
  training module's module-audit unit: `training_submissions.py`,
  `training_waivers.py`, `training_enhancements.py`, `external_training.py`,
  and `course_cohorts.py`/`course_syllabus.py` — the last two never read by
  any prior audit or review pass at all (~10,000 L across 12 files
  combined). Read in full across 4 parallel reads, each briefed with the
  specific prior findings/flagged items for its files so the pass
  re-verified rather than re-derived. 10 findings, all fixed: **TRX-1
  (HIGH, confirmed live)** — `bulk_enroll_members`'s prerequisite-gate
  error strings resolved a foreign org member's real name via an unscoped
  batch `User` lookup; not caught by the TR-17 pass despite
  `training_program_service.py` being in that iteration's file list, since
  this is an error-message path, not a by-id read/update/delete. **TRX-2 /
  TRX-5 / TRX-5b** — blind `setattr` on NOT NULL columns (external-provider,
  cohort, syllabus-class updates), routed through `apply_updates`. **TRX-3**
  — `GET /effectiveness/evaluations` had no permission gate at all and
  leaked every member's free-text self-evaluations org-wide; confined
  non-officers to their own submissions, mirroring the file's own
  `get_member_competencies`/`.../me` split. **TRX-4 (MEDIUM)** — cohort
  class reschedule/cancel mutated and **committed** before checking the
  class belonged to the URL's cohort, and cancel's audit-log call sat after
  that check — a cross-cohort request cancelled a real class with zero
  audit trail while telling the caller 404; fixed by scoping the fetch to
  `cohort_id` before any write. **TRX-6 through TRX-10** — six
  client-supplied FK ids unvalidated in-org (waiver `requirement_ids` —
  also corrected a stale "not projected" premise, it is projected;
  submission `category_id`; 5 recertification-pathway FKs; 2
  multi-agency-exercise FKs; xAPI `source_provider_id`). Verified good, no
  code change: the cohort-generation transaction's full id chain, and the
  roster-membership-gated cohort read's org-scoping + PII redaction.
  Corrected a stale count in the SCH-10 `KNOWN_LIMITATIONS.md` entry
  (`external_training_service.py`'s own httpx client is an 8th affected
  site, not among the original 7). Full completion gate green, full
  8778-test backend suite. See `TRX-18-training-extended.md` for the
  complete write-up.
- **18 Training extended ✅ merged** — PR #1873 merged 2026-08-26. A Codex
  review round caught 3 real issues before merge (see prior log entry) —
  all fixed and threads resolved. **Separately, while getting CI green,
  found and fixed two pre-existing, repo-wide-blocking regressions on
  `main` unrelated to this feature**: `InventoryAdminHub.tsx` (introduced
  by #1894) failed `npm run lint`/`npm run build` for every open PR that
  merged main in (a banned `.toLocaleDateString()` call with no timezone
  parameter, three un-narrowed `severity` literals, and a banned
  `bg-red-600` fill) — fixed via standalone PR #1899, also merged. A Codex
  review on #1899 caught a real bug in that fix's own first draft (two
  calendar-date fields shifting a day west of UTC) — fixed and verified.
  While driving #1899 to green, also discovered a second pre-existing
  gap: the fire-chief officer-visibility test's `@pytest.mark.integration`
  fix (first surfaced during #1873's own CI, apparently authored by
  another session) had only ever been merged directly into #1873's
  branch, never through its own PR onto `main` — so `main` itself, and
  any fresh branch cut from it, still failed `Backend Unit Tests` on that
  same MySQL-connection error. Ported the identical one-line fix into
  #1899 so it closes on `main` for good rather than resurfacing on the
  next branch. Both PRs fully green (16/16 checks) before merge. Next:
  19 skills testing.
- **19 Skills testing ⏳** — reviewed `endpoints/skills_testing.py` (grown
  2.6x to 3,723 L since the 1,412 L last audited) and
  `skills_testing_service.py` (1,207 L) in full via 3 parallel background
  agents, cross-checked against `docs/module-audit/compliance-skills.md`
  and `docs/app-review/compliance-skills.md`. Re-confirmed CS-1, CS-2,
  CS-8/CS-10, LIKE escaping (Pitfall #25) and CSV injection guarding
  (Pitfall #15) all still intact. Four new findings, all fixed: **SKT-1**
  `update_template`'s blind `setattr` loop could raise an unhandled 500 on
  an explicit null against a NOT NULL column, now routed through
  `apply_updates`. **SKT-2/SKT-3** `void_test` and
  `return_test_for_correction` had no separation-of-duties check unlike
  their siblings `create_test`/`validate_test` (CS-8) — an
  officer-candidate could void their own unfavorable result or force
  unlimited free redo cycles on their own submission; both now call
  `assert_different_person`. **SKT-4** `assert_attempts_remaining`'s
  `max_attempts` cap was a read-then-write with no row lock (Pitfall #27,
  independently corroborated by all 3 review agents) — fixed with both
  halves the pitfall requires: a `FOR UPDATE` lock on the candidate's
  `RequirementProgress` row, and the spent-count query itself made a
  locking read. Fixing the new lock query broke 5 pre-existing tests whose
  mocked `db.execute` result queues didn't account for the extra call —
  reordered, not a logic change. Full local completion gate green:
  flake8/black/isort clean, migrations validated, 380/380 skills-scoped
  tests and the full 8814-test backend suite pass. Findings doc:
  `docs/security-review/SKT-19-skills-testing.md`. PR #1901 opened and
  subscribed. Next: 20 compliance, once #1901 merges.
- **19 Skills testing ✅ merged** — PR #1901 merged 2026-08-26. Codex review
  caught two real issues in the SKT-4 capacity-lock fix before merge: (P1)
  locking the candidate's `RequirementProgress` row rather than something
  guaranteed to exist — `_validate_requirement_link` never requires an
  active enrollment, so the lock could silently serialize on nothing; (P2) a
  lock-ordering deadlock risk, since `validate_test` locks its specific
  `SkillTest` row before calling into the capacity check, so two concurrent
  validations could each hold their own test row and then deadlock waiting
  on the capacity lock in reverse order of each other. Fixed by locking
  `TrainingRequirement` instead (the row already fetched first, guaranteed
  to exist for every capped test) via a new `lock_attempt_capacity` helper,
  and by having `validate_test` acquire that lock — through a non-locking
  peek at the test's `requirement_id` — before locking the test row, fixing
  the ordering as well as the target. Replied to both review threads with
  the fix and resolved them. Full local completion gate re-verified green
  (391/391 skills-scoped, 8816/8816 full suite) before pushing the revision;
  CI came back 16/16 green with no further comments. Next: 20 compliance.
- **20 Compliance ⏳** — this module already had the deepest prior coverage
  in the rotation (module-audit iteration 22 + 4 app-review passes through
  2026-08-09); read `compliance_officer.py`+service, `training_compliance.py`,
  and `compliance_config.py`+service+model+schema in full via 3 parallel
  background agents, re-confirming CS-1, CS-3, CS-6, CS-7, CS-8 (skills
  half), CS-9 recipient audit, and no IDOR/SQL-injection all still intact.
  **CMP-1/CMP-2** `update_compliance_config`/`update_compliance_profile`
  discarded an explicit null before the service ever saw it
  (`exclude_none=True`), so a profile's threshold override ("null = use org
  default") could never actually be cleared — fixed with `exclude_unset=True`
  - `apply_updates`. **CMP-3** a first-write race on `ComplianceConfig`
    surfaced as a raw 500 — now a clean 400. **CMP-4** `get_incomplete_records`
    silently capped its scan at the 500 most-recently-completed records with no
    signal to the caller, so older incomplete records on any org with more
    history were permanently invisible — fixed by pushing the predicate into
    SQL. **CMP-5** `report_type`'s real 3-value set (`monthly`/`annual`/
    `yearly`, the last used only by a scheduled task bypassing the HTTP schema)
    was undocumented at the schema layer and contradicted by a stale model
    comment — tightened to a `Literal`. **CMP-6** dict-key id-normalization
    parity for `ContributedHoursService`/`_get_admin_hours_summary` (both added
    since the last audit, both reintroducing the un-normalized pattern CS-9 had
    already fixed elsewhere in the same file) — guarded with a UUID-object
    regression test. **CMP-7** `create_attestation`'s percentage bound was
    schema-only; added a service-layer check to match its sibling validations.
    CS-8 attestation dual-control (re-confirmed no narrow fix exists — the
    record has no "subject" field to compare against the actor at all) and
    CS-9 monthly windowing remain flagged as product decisions, not bugs. Two
    design observations raised for owner awareness rather than fixed (a
    broader permission grant and a `compliance_exempt`-filtering inconsistency
    on the new contributed-hours endpoint — both look intentional per their
    docstrings). Full local completion gate green: flake8/black/isort clean,
    migrations validated, 269/269 compliance-scoped and 8833/8833 full backend
    suite pass. Findings doc: `docs/security-review/CMP-20-compliance.md`. PR
    #1902 opened and subscribed. Next: 21 admin hours, once #1902 merges.
- **20 Compliance ✅ merged** — PR #1902 merged 2026-08-26. Codex review
  caught one real regression in the CMP-4 fix before merge: the SQL
  location predicate checked only `location IS NULL`, but the Python
  fallback logic (`not r.location`) also treats `location=""` as missing —
  a value the training schemas allow — so a completed record with
  `location=""` and no `location_id` was silently excluded from the new SQL
  scan, the opposite of what the fix was for. Corrected to
  `location IS NULL OR location = ''`, matching the Python check exactly;
  replied and resolved the review thread. Full local completion gate
  re-verified green (270/270 compliance-scoped, 8834/8834 full suite)
  before the final push; CI came back 16/16 green with no further comments.
  Next: 21 admin hours.
- **21 Admin hours ⏳** — this HIGH-sensitivity module (self-credit/SoD risk)
  already had thorough prior coverage (module-audit iteration 15 + 4
  app-review passes through 2026-08-09); read `admin_hours.py` and
  `admin_hours_service.py` in full via 3 parallel background agents,
  re-confirming AH-1 through AH-6 all still intact. **AH-7 (HIGH)**
  `get_user_hours_compliance` resolved a client-supplied `user_id` with no
  `organization_id` filter — a caller with compliance access could pull
  compliance/membership data for a member of a different organization;
  independently flagged by two agents. **AH-8** `clock_out` was the one
  query in this module not yet org-scoped — literally deferred to this
  exact rotation turn by a same-day sibling commit
  (`clock_out_by_category`'s own fix). **AH-9** `update_category`'s blind
  `setattr` loop → `apply_updates`. **AH-10** `clock_in` was a read-then-
  write race with no lock (Pitfall #27) — fixed with a lock on the user's
  own row plus a locking active-session read. **AH-11** event-hour-mapping
  percentage totals could race past 100% — `FOR UPDATE` added, residual
  first-insert gap noted rather than hidden. **AH-12** `edit_pending_entry`
  now applies the same future/24h-cap/overlap guards `create_manual_entry`
  already had (closes a "parity nit" prior passes explicitly left open).
  **AH-13** 4 unguarded `datetime.fromisoformat` call sites → clean 400s.
  **AH-14** 3 `source_rsvp_id`-keyed queries (new since last audit) gained
  `organization_id` filters. Per-org SoD toggle and a resync
  approval-integrity gap (documented as deliberate in the code) remain
  flagged as product decisions. Full local completion gate green:
  flake8/black/isort clean, migrations validated, 604/604 admin_hours+event
  scoped and 8845/8845 full backend suite pass. Findings doc:
  `docs/security-review/AH-21-admin-hours.md`. PR #1903 opened and
  subscribed. Next: 22 grants & fundraising, once #1903 merges.
- **21 Admin hours ✅ merged** — PR #1903 merged 2026-08-26. Codex review
  caught one real deadlock risk in the AH-11 fix before merge: the first
  version of `update_event_hour_mapping`'s percentage-check locked only
  the _other_ mappings for a source, excluding the target row being
  updated. Two concurrent updates to two different mappings under the same
  source could each lock the row the other was about to write to, then
  each block writing their own row at flush — a lock-order inversion
  InnoDB resolves by killing one side as a deadlock (surfaced as a 500).
  Fixed by locking the complete set of mappings for the source — including
  the target — in one query ordered consistently by id, so a second
  transaction reaching the same source queues behind the first instead of
  each holding what the other needs. `create_event_hour_mapping` doesn't
  share this failure mode (a fresh INSERT never needs to acquire a write
  lock on an existing row). Replied and resolved the review thread. Full
  local completion gate re-verified green (8846/8846 full suite) before
  the final push; CI came back 16/16 green with no further comments.
  Next: 22 grants & fundraising.
- **22 Grants & fundraising** — read `docs/module-audit/grants-fundraising.md`
  (iteration 14, GF-1 through GF-9) and `docs/app-review/grants-fundraising.md`
  (4 passes through 2026-08-09, GF-10 through GF-12) first; three parallel
  agents then read `grants.py`, `grant_service.py`, `fundraising_service.py`
  in full, re-confirming GF-1 through GF-12 and surfacing six new findings.
  **GF-13 (HIGH, most severe of the whole rotation so far)**
  `GrantOpportunity.applications` carried `cascade="all, delete-orphan"`
  while `GrantApplication.opportunity_id` is `ondelete="SET NULL"` — deleting
  an opportunity with linked applications either crashed or silently deleted
  every one of those applications and their full financial history. Fixed by
  removing the cascade and adding `passive_deletes=True`; guarded by a new
  real-DB integration test (`test_grant_opportunity_delete_db.py`), invisible
  to a mocked session. **GF-14** an awarded->active->awarded round-trip
  duplicated the auto-generated compliance task set — idempotency guard
  added, scoped narrowly so it doesn't presume an answer to GF-7's broader
  state-machine question. **GF-15** three read-then-write aggregate
  recomputes (campaign total, donor stats, budget item spent) had no lock —
  Pitfall #27 fix applied to all three (lock the parent row, make the SUM
  itself a locking read). **GF-16** ten update methods across both services
  used blind `setattr` loops -> converted to `apply_updates`. **GF-17/GF-18**
  two by-id queries (`_notes_with_authors`, the budget-item fetch inside the
  GF-15 fix) gained `organization_id` filters for defense-in-depth
  consistency; neither was independently exploitable. GF-7 (broader
  state-machine/overspend question), GF-8 (`is_anonymous` enforcement), GF-9
  (float money math) re-confirmed unchanged and stay flagged as product
  decisions, per every prior pass. Full local completion gate green:
  flake8/black/isort clean, migrations validated (no migration needed —
  GF-13's fix is ORM-relationship-only), 45/45 grant+fundraising scoped and
  8849/8849 full backend suite pass. Findings doc:
  `docs/security-review/GF-22-grants-fundraising.md`. PR #1904 opened and
  subscribed. Next: 23 medical supplies, once #1904 merges.
- **22 Grants & fundraising ✅ merged** — PR #1904 merged 2026-08-26.
  Codex review caught two real issues before merge, both fixed in the same
  PR: (P1) the parent-lock fixes for GF-15 left `create_donation`/
  `create_expenditure` (and the reassignment branches of
  `update_donation`/`update_expenditure`) inserting/updating the
  FK-carrying child row _before_ locking the parent — InnoDB's own FK
  check on that insert takes a shared lock on the parent, so two
  concurrent writes to the same parent could each hold a shared lock and
  then both try to upgrade to the exclusive FOR UPDATE lock the recompute
  takes, deadlocking; fixed by acquiring the parent lock(s) first, via new
  `_lock_campaign`/`_lock_donor`/`_lock_budget_item` helpers. (P2) the
  GF-14 idempotency guard matched on `task_type`, which is fully
  client-settable on manual task creation with no status restriction — an
  officer's own pre-award task of the same type could make the guard
  believe generation had already run and silently skip the real thing;
  replaced with a dedicated `compliance_tasks_generated` boolean on
  `GrantApplication` (migration `472a1e34aa84`). Both fixes replied to and
  resolved on their review threads. CI also caught the generated
  `docs/DATABASE_SCHEMA.md` going stale after the new column — regenerated
  and pushed. Full local completion gate re-verified green (8855/8855 full
  suite) before the final push; CI came back green with no further
  comments. Next: 23 medical supplies.
- **23 Medical supplies** — no prior module-audit or app-review pass exists
  for this feature, the first review of `medical_supplies.py` (667 L, 15
  endpoints). Read directly rather than via parallel agents — small file,
  and its only dependency (`InventoryService`) was already read in full by
  the INV-11 pass three weeks prior. The endpoint layer itself is soundly
  domain-pinned: every by-id write re-checks the target is in the medical
  domain, the domain is never client-supplied, and a `category_id: null`
  escape hatch out of the domain is already closed with its own guard test.
  **MSUP-1 (MED)** the one real gap: three shared `InventoryService`
  methods this router calls (`update_category`, `update_item`,
  `update_lot`) used blind `setattr` loops instead of `apply_updates` — out
  of INV-11's tenant-isolation lens, so not previously flagged.
  `update_lot` was the worst case, with no exception handling at all, so an
  explicit null against its NOT NULL `quantity` column was a genuine
  unhandled 500; `update_category`/`update_item` softened the same bug into
  a generic sanitized error via a catch-all `try/except`. All three now
  route through `apply_updates`; `update_lot`'s two callers
  (`inventory.py` and this router) gained a `ValueError` -> 400 catch to
  match the sibling `add_lots_bulk` convention already on both files. Full
  local completion gate green: flake8/black/isort clean, migrations
  validated (no schema change), 553/553 inventory+medical_supplies scoped
  and 8897/8897 full backend suite pass. Findings doc:
  `docs/security-review/MSUP-23-medical-supplies.md`. PR #1905 opened and
  subscribed. Next: 24 meetings & minutes, once #1905 merges.
- **23 Medical supplies ✅ merged** — PR #1905 merged 2026-08-26. Codex was
  over its usage limit for security reviews on this PR (no review
  produced); CI passed clean on the first push, no fix round needed.
  Next: 24 meetings & minutes.
- **24 Meetings & minutes** — no prior module-audit or app-review pass
  exists for this feature, the first review of `meetings.py`/`minutes.py`
  and their two services (3,059 L combined). Read via four parallel agents,
  one per file; `quorum_service.py` pulled in afterward once three of the
  four independently flagged it as vote-legitimacy-critical and directly
  reachable from minutes' own quorum routes. **MM-5 (MED, most notable)**
  the minutes approval workflow had no separation of duties — the same
  person could submit minutes and immediately approve their own submission.
  Fixed with the shared `assert_different_person` guard already used for
  finance requests, skills tests, and admin hours — its own module docstring
  invites exactly this. **MM-1** `update_action_item` in both services
  persisted a reassigned owner with no in-org check, unlike its own
  create-path sibling. **MM-2** five update methods used blind `setattr`
  instead of `apply_updates`; two `meetings.py` endpoints used
  `exclude_none` instead of `exclude_unset`, making field-clearing
  structurally impossible. **MM-3/MM-4** `create_from_event` and
  `QuorumService.calculate_quorum` both had a read-then-write race with no
  lock (Pitfall #27) — event-bridging uniqueness and the quorum status
  itself; both fixed with a locking read. **MM-6** motion and action-item
  CRUD, and quorum-config overrides, had no audit trail while every other
  minutes mutation did — a recorded vote tally could be silently edited
  with no trace; all seven endpoints now log. **MM-7** a malformed UUID
  query param crashed with an unhandled 500. Nothing left flagged — every
  finding had a mechanical fix, all applied. Full local completion gate
  green: flake8/black/isort clean, migrations validated (no schema
  change), 203/203 meetings+minutes+quorum scoped and 8908/8908 full
  backend suite pass. Findings doc:
  `docs/security-review/MM-24-meetings-minutes.md`. PR #1906 opened and
  subscribed. Next: 25 messaging & notifications, once #1906 merges.
- **24 Meetings & minutes ✅ merged** — PR #1906 merged 2026-08-26. Codex
  review caught two real issues before merge, both fixed: (P1) the MM-3 fix
  locked only the `Event` fetch in `create_from_event`, reasoning it would
  always be the transaction's first query so the subsequent plain `Meeting`
  existence-check SELECT would establish its own accurate snapshot — Codex
  correctly identified this as unsafe in production, since an earlier query
  elsewhere in the same session (e.g. `get_current_user` resolving the
  caller) can already have established the REPEATABLE READ snapshot first;
  fixed by making the existence check a `.with_for_update()` locking read
  too, matching every other Pitfall #27 fix in this codebase — lock the
  parent/uniqueness row and separately make the check itself a locking
  read, never rely on query ordering. (P2) the MM-6 audit-log fix for
  `update_action_item` logged `changed_fields` from the raw client payload,
  but the service silently restricts applied fields to
  `{status, completion_notes}` on approved minutes, so a client sending
  `description` there would have it no-opped while the audit log still
  claimed it changed; fixed by having the service expose a non-mapped
  `applied_fields` attribute (same convention as
  `MeetingsService.attach_creator_names`) and having the endpoint log that
  instead. Both replied to and resolved on their review threads. Full local
  completion gate re-verified green (203/203 meetings-scoped, 8910/8910
  full suite) before the final push; CI came back green with no further
  comments. Next: 25 messaging & notifications.
- **25 Messaging & notifications** — this feature already carried the
  deepest prior coverage in the rotation: a module audit plus a 4-5-pass
  app-review for messaging, notifications, and email templates each. Four
  parallel background agents split the surface, each briefed to re-verify
  prior findings rather than re-derive them and focus on what's grown or is
  new since: messaging (`messages.py`/`message_history.py`/
  `messaging_service.py`/`message_delivery_service.py`), notifications
  (`notifications.py`/`notifications_service.py`/`push_service.py`, plus
  three files with no prior review at all — `notification_rules.py`,
  `notification_channels.py`, `integration_services/notification_dispatch.py`
  — all clean), email templates (`email_templates.py`/
  `email_template_service.py`/`email_templates_storefront.py`, plus two
  never-reviewed utility modules `email_footers.py`/`email_theme.py`), and
  the shared send layer `email_service.py` on its own (the widest-blast-radius
  file in scope — every other email-producing feature calls into it). All
  prior findings across all five documents re-verified as still holding.
  **MSG-4 (MEDIUM)** `update_message`'s reschedule guard only blocked moving
  an already-published message to a _future_ time — a past/current
  `scheduled_at` slipped through unmodified, leaving a non-null due
  timestamp the next publish sweep would treat as newly due and re-deliver:
  a duplicate in-app notification, a duplicate email, and (if urgent) a
  duplicate SMS blast to the whole targeted audience, repeatably every ~15
  minutes. Fixed by collapsing it to `None` the same way `create_message`
  already does. **MSG-5 (LOW)** `notifications_service.update_rule` used
  `exclude_none` + a blind `setattr` loop, so an explicit null couldn't
  clear `description`/`config` — switched to `exclude_unset` +
  `apply_updates`. **MSG-6 (MEDIUM)** `email_service.py`'s header
  construction sanitized Subject/From only — To, Cc, Reply-To, and
  List-Unsubscribe were unsanitized in both header-writing sites, and a live
  unvalidated path already reached one of them
  (`MemberDropNotificationSettings`/`ScheduleNotificationSettings.cc_emails`
  were `List[str]`, not `List[EmailStr]`, unlike every sibling cc/to/bcc
  field). Fixed both. **MSG-7 (MEDIUM)** the SMTP send path had no
  attachment size budget (unlike the Cloudflare path's 4.5 MiB cap) and its
  per-recipient loop serializes a full message copy per recipient, so
  memory scales as attachment-size × recipient-count — concretely reachable
  via election-package PDFs mailed to a full voter roster; also, two of
  three send branches weren't exception-safe despite the method's own
  contract never raising. Fixed with an 18 MiB budget mirroring the
  Cloudflare pattern and matching try/except on all three branches.
  **MSG-8 (MEDIUM-LOW, Pitfall #9)** `email_theme._SHELL_COLOURWAYS` — a
  module-level dict with no cap or eviction — was populated by every
  `build_shell()` call including the ~20 runtime call sites inside
  `wrap_email_body()`, none of which are ever read back (only the ~35+9
  import-time default-template constants are looked up), so every email
  sent grew it by one entry for the life of the worker process. Fixed with
  a `cache: bool` parameter defaulting to the existing behavior, with the
  one runtime caller passing `cache=False`. One item deliberately left
  unfixed as a policy call, not a bug: `email_service.py`'s org-configured
  SMTP host has no SSRF-style private-IP guard, unlike this codebase's
  webhook-URL pattern — but a department may legitimately point it at an
  internal mail relay, so adding that guard would be a functional
  regression, not hardening. Full local completion gate green:
  flake8/black/isort clean, migrations validated (no schema change),
  855/855 messaging+notifications+email-theme scoped and 8914/8914 full
  backend suite pass. Findings doc:
  `docs/security-review/MSG-25-messaging-notifications.md`. PR #1907 opened
  and subscribed. Next: 26 forms, once #1907 merges.
- **25 Messaging & notifications ✅ merged** — PR #1907 merged 2026-08-27.
  Codex review caught one real regression before merge: the MSG-6 fix
  tightened `scheduling.cc_emails`/`member_drop_notifications.cc_emails`
  from `List[str]` to `List[EmailStr]`, correct on writes (strictly
  validated via `OrganizationSettingsUpdate`) but not on reads —
  `get_organization_settings` reconstructs the entire stored settings
  blob via Pydantic on every call, including the read at the end of any
  unrelated settings update, and `scheduling` flowed through unvalidated
  `extra_settings` into that reconstruction. An org with a legacy
  malformed `cc_emails` value saved before the tightening would find
  every future settings read — and any subsequent update to an unrelated
  field — broken, with no way to fix it through the API. Fixed by
  reconstructing `scheduling` explicitly and filtering `cc_emails` to
  syntactically valid addresses on the read path only. Traced the
  equivalent `member_drop_notifications` field Codex flagged as carrying
  the same risk and confirmed it doesn't: that field is excluded from the
  same reconstruction path entirely today (a separate, pre-existing gap
  unrelated to this change), and its only other reader accesses it as a
  raw dict, never through Pydantic. 3 regression tests added. Full local
  completion gate re-verified green (8917/8917 full suite) before the
  final push; CI came back green with no further comments. Next: 26 forms.
- **26 Forms** — already has thorough prior coverage (module audit
  iteration 13, FORM-1 through FORM-7, plus a 4-pass app-review). Read
  `forms.py`, `public/forms.py`, and `forms_service.py` directly in full
  (~3,600 L combined, moderate size with deep existing coverage — not
  fanned out). Re-verified FORM-1/2/3/6/7 all hold. **FORM-5** (flagged in
  every prior pass as needing a product decision on
  `require_authentication`/`allow_multiple_submissions` enforcement) turned
  out to already be resolved — shipped correctly since the last review pass
  but never reflected in `module-audit/forms.md` or `app-review/forms.md`
  (only `KNOWN_LIMITATIONS.md` had it right); corrected both docs. Reviewed
  the ~300-line growth in full: a new `event_request` integration type
  (creates a coordinator-review record from free-text contact fields, no
  submitter-supplied FK to another module's row, so no FORM-1/2-shaped
  cross-org write risk exists structurally) and a new
  `reprocess_submission_integrations` endpoint (org-scoped submission
  fetch, reuses the same `_entity_in_org`-guarded processors as the
  original submit path). **FORM-8 (LOW, fixed)** — `update_form`,
  `update_field`, and `update_integration` all used blind `setattr` loops;
  an explicit null against a NOT NULL column (`Form.name`,
  `FormField.label`/`field_type`, `FormIntegration.target_module`/
  `integration_type`) reached `commit()` and raised an `IntegrityError`
  caught by a generic exception handler — not a crash, but a confusing
  error instead of a specific one. All three now route through
  `apply_updates`. Full local completion gate green: flake8/black/isort
  clean, migrations validated (no schema change), 64/64 forms-scoped and
  8922/8922 full backend suite pass. Findings doc:
  `docs/security-review/FORM-26-forms.md`. PR #1908 opened and subscribed.
  Next: 27 integrations, once #1908 merges.
- **26 Forms ✅ merged** — PR #1908 merged 2026-08-27. Codex reported it
  was over its usage limit for security reviews (no review produced, same
  as a few earlier PRs this rotation); CI ran clean on the first push, no
  review threads to resolve. Next: 27 integrations.
- **27 Integrations** — the deepest prior coverage of any feature reviewed
  so far in this rotation (module audit iteration 12, INT-1 through INT-5,
  plus a 4-pass app-review whose last two passes already concluded "no code
  change — the module is mature"). Read `integrations.py`, `salesforce_sync.py`,
  and all three Salesforce backing services directly in full (~2,850 L
  combined). Re-verified INT-1 through INT-5 all hold. Growth since the
  last full read was almost entirely new "coming soon" catalog entries
  (Active911, Google Maps, Zapier, WhatsApp, ImageTrend, ESO Solutions,
  NREMT, FirstWatch, PulsePoint) plus two genuinely new pieces of logic,
  both reviewed clean: `_secrets_to_clear_for_base_url_change` (a stored
  Documenso/Cal.com credential can't silently follow an `api_base_url`
  change to a new endpoint without being re-entered or explicitly cleared)
  and `clear_salesforce_refresh_token` (an explicit blank refresh token
  correctly switches Salesforce from interactive OAuth to client-credentials
  and clears the cached access token alongside it). Re-traced every dynamic
  SOQL construction site — all still route through the established
  `_soql_quote`/`_soql_identifier` helpers, no new site introduced. No new
  findings; no code change this iteration. Full local completion gate
  green: existing 112/112 integrations+salesforce-scoped tests pass, no
  migration needed. Findings doc: `docs/security-review/INT-27-integrations.md`.
  PR #1910 opened and subscribed. Next: 28 security, audit & IP, once
  #1910 merges.
- **27 Integrations ✅ merged** — PR #1910 merged 2026-08-27. Codex reported
  it was over its usage limit for security reviews (no review produced,
  informational only); CI ran clean on the first push, no review threads
  to resolve. Next: 28 security, audit & IP.
- **28 Security, audit & IP** — an exhaustively-hardened surface (module
  audit SEC-1 through SEC-10 + a 4-pass app-review), with significant growth
  in specific files since the last full read (`core/audit.py` +60%,
  `error_logs.py` +38%). Three parallel background agents split the surface:
  (A) audit hash chain + error logs, (B) security monitoring + alerts, (C)
  IP allowlisting + geo-blocking, each re-verifying SEC-1 through SEC-10
  against current code and giving extra scrutiny to the grown portions.
  **SEC2-28-1 (MEDIUM, most severe)** `create_member` flushed the new User
  row before checking whether the caller's own permissions covered the
  requested role_ids — a denied ceiling check's alert-reporting helper
  commits the whole transaction (by design, so the alert survives the 403
  about to be raised), which also persisted the should-be-rejected user: a
  live, ACTIVE, password-set account with no roles, behind a request the
  admin believed failed outright. Fixed by resolving/ceiling-checking roles
  before the user row is created. **SEC2-28-2 (MEDIUM)** the audit hash
  chain's `calculate_hash` never covered `event_category`/`severity` despite
  both being read into the hash-input dict at create and verify time — a
  DB-write-level attacker could rewrite either field (e.g. downgrade a
  critical incident to info) with no hash mismatch, hiding it from
  severity/category-filtered admin review. Fixed with a hash-version bump
  (v3 -> v4, matching the v3-added-organization_id precedent); old rows
  verify unchanged. **SEC2-28-3 (LOW/MED)** `GET /ip-security/blocked-attempts`
  was permanently empty — the actual block-logging path wrote only to
  audit_logs, never to the table the endpoint reads — a false-negative risk
  for incident response. Fixed by wiring the write. **SEC2-28-4 (LOW/MED)**
  `add_blocked_country` always inserted a new row despite `country_code`
  being unique and unblock being a soft delete, so re-blocking a
  previously-unblocked country 500'd on the constraint. Fixed with an
  update-in-place lookup. Also removed two orphaned comment banners.
  **Flagged, not fixed: SEC2-28-5 (HIGH by-name, safe-direction)** — approved
  IP-allowlist exceptions have had zero effect on geo-blocking enforcement
  since PR #1544 (2026-08-17) correctly closed a cross-tenant allowlist-union
  bypass by hard-coding an empty allowlist at the one enforcement call site,
  without replacing it with a safe per-tenant mechanism or updating the
  stale docstrings/docs that still described the old behavior — needs an
  owner decision (restore a safe per-IP-only version, or retire the feature
  explicitly). Corrected the stale claims in the class docstring and
  `module-audit/security-audit-ip.md`; mirrored into `KNOWN_LIMITATIONS.md`
  (also corrected the adjacent SEC-8 row's copy of the same stale claim).
  **SEC2-28-6 (LOW, flagged)** a TOCTOU race on the IP-exception duplicate
  check — admin-queue clutter only, not a bypass. Full local completion gate
  green: flake8/black/isort clean, migrations validated (no schema change —
  the hash-version bump is pure application logic), 268/268 scoped and
  8927/8927 full backend suite pass. Findings doc:
  `docs/security-review/SEC2-28-security-audit-ip.md`. PR #1911 opened and
  subscribed. Next: 29 reports & analytics, once #1911 merges.
