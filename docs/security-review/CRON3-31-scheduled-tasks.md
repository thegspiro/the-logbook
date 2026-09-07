# Security Review — Feature 31: Scheduled Tasks (pass 3)

**Prefix:** `CRON3` · **Iteration:** 31 (pass 3) · **Reviewed:** 2026-09-07 · **PR:** (opened this pass)

**Backend:** `backend/app/api/v1/endpoints/scheduled.py` (58 L, 2 routes, unchanged),
`backend/app/services/scheduled_tasks.py` (**6,040 L, 44 task runners** — grown
from pass 2's 5,600 L / 43 runners; `SCHEDULE`/`TASK_RUNNERS` still exactly
1:1, no drift), plus `backend/main.py`'s in-process scheduler
(`_scheduled_task_loop`, `_try_claim_background_task`) re-checked for
regression since pass 2 first brought it into scope.
**Frontend:** none — unchanged.
**Migrations:** none touched or needed this pass.

---

## Scope and method

Loaded, in order, before reading any code: `docs/security-review/CHECKLIST.md`,
`docs/security-review/SEC-00-cross-cutting-baseline.md` (skimmed for anything
naming scheduled-tasks/CRON — none found; the file's own content is almost
entirely about an unrelated `security_monitoring.py` tracker-cap saga, so it
was not read past confirming that), `docs/app-review/scheduled-tasks.md`
(prior art, already absorbed by pass 1/2), `docs/security-review/
CRON2-31-scheduled-tasks.md` (pass 1, PR #1915, findings CRON2-31-1 through
CRON2-31-13) and `docs/security-review/CRON-31-scheduled-tasks.md` (pass 2, PR
#2095, findings CRON-31-1 through CRON-31-8, plus the in-process-scheduler
territory it opened). No dedicated `docs/module-audit/` doc exists for this
feature — it was built out inside this rotation.

**This pass is delta-focused, per the established pass-3 convention (see
Feature 25–30's pass-3 entries in `PROGRESS.md`).** Pass 2's merge commit for
the two target files is `8254875a` (PR #2095). Diffed `8254875a..HEAD` for
both files: `scheduled.py` — **zero changes**; `scheduled_tasks.py` — **+334
/ −34 lines**, growing the file from 5,740 to 6,040 lines it actually measures
at (pass 2's doc rounded to "5,600 L"). The diff was read in full, not
summarized from a stat line. It consists of:

1. A brand-new task, `run_recover_stranded_message_deliveries` (registered in
   `SCHEDULE`/`TASK_RUNNERS`/`TASK_INTERVALS_SECONDS`, 44th runner) —
   re-delivers department-message claims a dead worker left `pending`. Read
   end to end, along with the service code it calls
   (`MessageDeliveryService._claim_delivery`/`_reclaim_stale_delivery` in
   `message_delivery_service.py`) and its existing test file
   (`tests/test_message_delivery_claim_recovery.py`, 9 tests pre-existing).
   This is exactly the "grown substantially or added since pass 2" case the
   brief calls out for full scrutiny, and got it.
2. `resolve_check_templates` gained a `shift_template_id` parameter and a
   template-linked-checklist resolution path (`ShiftTemplateEquipmentCheck`),
   used by `run_post_shift_validation`, `run_shift_reminders`, and
   `run_end_of_shift_checklist_reminders`'s per-apparatus template caches
   (now keyed on `(apparatus_id, shift_template_id)` tuples instead of bare
   apparatus id). Read in full, including both new org-scoped queries.
3. `run_event_reminders` gained `.where(Event.is_draft.isnot(True))`.
4. `run_end_of_shift_summary` now resolves call-type slugs to the
   department's configured labels via `CallTrackingService.type_labels()`
   before building the flattened call-type list.
5. `run_publish_scheduled_messages` gained a `failed` count log line (no
   logic change to the fix CRON-31-1 already put in place).

**Every prior finding (CRON2-31-1 through 13, CRON-31-1 through 8) was
re-verified against current code** — not re-derived — by reading the actual
function bodies at their current line numbers, re-running the relevant guard
tests, and, for the two still-open registry/permission claims, re-deriving
them directly (`SCHEDULE == TASK_RUNNERS` check via Python import;
`system.run_tasks` grep against `DEFAULT_POSITIONS`). All findings holding, no
regressions, two line-number corrections noted below (the doc's own citations
drift as the file grows — corrected here rather than silently carried
forward as stale).

**Not re-read end to end this pass:** the ~5,700 lines of `scheduled_tasks.py`
outside the diff above and outside what re-verifying prior findings required
reading. Pass 2 did the full line-by-line read of that body 6,040 lines ago
(function by function, not diffed); this pass trusts that read for the
unchanged code and applies its own scrutiny to what changed since. Stated
explicitly per the brief's requirement, not implied.

## Route inventory

Unchanged since pass 1/2 — re-confirmed against current `scheduled.py`
(0 diff since pass 2):

| Method | Path                  | Auth dependency                    | Permission                          | Org-scoped                                       | Notes                                                                                                                                                                                                                                                                                                        |
| ------ | --------------------- | ---------------------------------- | ----------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/scheduled/tasks`    | `Depends(require_permission(...))` | `admin.access` OR `settings.manage` | n/a (read-only registry listing, no data)        | Lists `SCHEDULE` entries verbatim.                                                                                                                                                                                                                                                                           |
| POST   | `/scheduled/run-task` | `Depends(require_permission(...))` | `system.run_tasks`                  | n/a (every task iterates **all** orgs by design) | `system.run_tasks` (`app/core/permissions.py:460`) is granted to no `DEFAULT_POSITIONS` entry directly — re-verified with `grep -n '"system\.'` against `permissions.py`: only line 460 (the constant's own declaration) matches. Only the wildcard `"*"` (`it_manager`, `permissions.py:1540`) resolves it. |

## Verified good ✅ (re-confirmed from pass 1/2, no regressions)

Every item below was re-read against current code at its current location,
not assumed from the prior docs.

- **Registry sync** — `SCHEDULE`/`TASK_RUNNERS`/`TASK_INTERVALS_SECONDS` all
  in sync: direct Python check, `set(SCHEDULE) == set(TASK_RUNNERS)` →
  **44/44** (grown from 43/43), every `TASK_RUNNERS` key present in
  `TASK_INTERVALS_SECONDS` or `_MANUAL_ONLY_TASKS`. The new
  `recover_stranded_message_deliveries` task correctly appears in all three
  registries (`scheduled_tasks.py:5966`, `:5997`, `:6008` — the diff's own
  `TASK_RUNNERS`/`TASK_INTERVALS_SECONDS` additions), and the in-process
  scheduler (`main.py:1721-1799`) builds its schedule from
  `TASK_INTERVALS_SECONDS` directly, so it auto-picked up the new task with no
  code change there — confirmed by reading `_scheduled_task_loop`, not
  assumed.
- **CRON2-31-9 / the Salesforce SSRF-adjacent fix** — `_api_url()`
  (`app/services/integration_services/salesforce_service.py:156-173`) still
  validates `self.instance_url` against `_INSTANCE_URL_RE` unconditionally on
  every call, independent of cached-token state.
- **CRON2-31-13 / `run_admin_hours_auto_close` has no audit trail** —
  re-confirmed: `grep -n "log_audit_event"
app/services/admin_hours_service.py` finds nothing. Still an accepted,
  considered flag (owning feature's decision), not re-applied.
- **CRON2-31-12 / `run_action_item_reminders` has no org loop at all** —
  re-confirmed at its current location (`scheduled_tasks.py:812-935`): the
  `MeetingActionItem` branch still has no `Organization` join, and the
  `MinutesActionItem` branch (CRON-31-2's `selectinload` fix, verified still
  present at `:876-885`) is unaffected by this gap since it resolves org
  through the eager-loaded relationship, not a join. Still flagged, unchanged.
- **CRON-31-1 / `run_publish_scheduled_messages`'s per-message isolation** —
  the `needs_refresh` + `db.refresh(message)` pattern, the `msg_id` capture
  ordered before any further DB operation, and the `failed` counter are all
  still present (`scheduled_tasks.py:3780-3844`), including round 2's
  `PendingRollbackError` correction.
- **CRON-31-3 / `run_shift_reminders`'s empty-roster guard** — `if not
roster: continue` (no dedup stamp) still present in the roster-building
  block.
- **CRON-31-4/5 / `run_rolling_recurrence_extend`'s per-parent isolation and
  org filter** — the `needs_refresh` pattern, post-commit counter increments,
  and the `Organization.active.isnot(False)` join are all still present
  (`scheduled_tasks.py:4972-4984`).
- **CRON-31-6 / `run_external_training_auto_sync`'s rollback + refresh** —
  still present.
- **`run_officer_directory_sync`'s per-org commit/rollback and `.isnot(False)`
  filter** — still present, unchanged, at `scheduled_tasks.py:5754-5788`.
- **`RetentionService.enforce()`'s snapshot pattern, per-org commit/rollback,
  and per-org audit logging** — still present, unchanged
  (`app/services/retention_service.py:260-330`); the deliberate
  non-filtering on `Organization.active` (retention exists specifically to
  clean up decommissioned departments' PII) is still the same considered
  call, not the CRON-2 gap.
- **The in-process scheduler's overlap guard and Redis-down fallback** — both
  unchanged (`main.py:1544-1556`, `1721-1799`): single-worker Redis `SETNX`
  lease, sequential execution within the loop, and the fallback still returns
  `True` (run anyway) on any Redis error. Still flagged as an accepted
  trade-off, not re-applied (see Flagged, below, for why this pass leaves it
  as-is rather than re-litigating it).

## Findings — fixed

### CRON3-31-1 — LOW (latent) — the new stranded-delivery sweep, and its `DepartmentMessage`-table sibling, could act on a decommissioned org's message — ✅ FIXED

**What:** `run_recover_stranded_message_deliveries` (new this pass) reads and
writes `DepartmentMessageDelivery`/`DepartmentMessage` rows keyed by
`organization_id` with no join back to `Organization.active` at all — the
same shape CRON2-31-11/CRON-31-5 already found and fixed in three other
child-table-keyed loops in this file, structurally invisible to
`test_scheduled_tasks_structure.py`'s `test_org_selects_skip_deactivated_
organizations` guard (it AST-matches the literal string `"select(Organization)"`,
which neither of these two functions' `join(Organization, ...)` queries
contains). Its pre-existing sibling on the same table,
`run_publish_scheduled_messages`, had the identical gap and had never been
checked for it in pass 1 or pass 2 — this pass is the first time either
function was reviewed against the CRON-2 invariant.

**Where:**

- `app/services/scheduled_tasks.py:3928-3954` (the "undeliverable" retire
  query) and `:3967-3991` (the main "stranded" scan query), both inside
  `run_recover_stranded_message_deliveries`.
- `app/services/scheduled_tasks.py:3763-3779` (the "due" query) inside
  `run_publish_scheduled_messages`.

**Failure scenario:** the moment an org-deactivation flow exists (nothing
sets `Organization.active = False` today — verified with `grep -rn
"\.active = False"` across `app/`, same check pass 2 ran), a decommissioned
department's already-scheduled department message would still publish and
escalate on its next `run_publish_scheduled_messages` tick, and any of its
stranded per-recipient claims would still be re-delivered by
`run_recover_stranded_message_deliveries` — mailing/texting members of a
department the platform has been told is no longer active. Worse for the
sweep specifically: because a decommissioned org's claim was excluded from
neither query's WHERE clause pre-fix, it was also never retired by the
"undeliverable" branch, so it would have sat `pending` indefinitely at the
front of every oldest-first, bounded scan.

**Impact:** latent, like CRON-31-5 and CRON2-31-11 before it — no live
exposure today, but the same class of gap this file has now closed four
times (CRON2-31-11's three sites, CRON-31-5's one), and worth closing before
it becomes reachable rather than after, per that established precedent.

**Fix:** joined `Organization` and added `.isnot(False)` (main queries) /
`.is_(False)` (the "undeliverable" retire branch's OR-clause, so a
decommissioned org's pending claim is retired for the same reason an
inactive/deleted message's is, rather than left excluded from both queries
forever) to all three sites, matching the exact idiom used at
`scheduled_tasks.py:4972-4984` and elsewhere in this file. For
`run_publish_scheduled_messages`'s `with_for_update(skip_locked=True)`, added
`of=DepartmentMessage` explicitly (mirroring the existing
`with_for_update(of=RequirementProgress)`/`of=CheckTemplateItem`/
`of=AdminHoursEntry`/`of=EventHourMapping` precedent elsewhere in the
backend) so the join to `Organization` does not also lock the `Organization`
row for the duration of the claim transaction — that row is read-only filter
context here, and locking it would contend with every unrelated transaction
that locks an `Organization` row for its own reasons (e.g.
`inventory_service.py:458`) for no benefit this task needs.

**Verified:** 3 new regression tests (2 for the sweep, 1 for publish),
verified to fail against the pre-fix code and pass after — see Guard tests,
below.

### CRON3-31-2 — LOW (test-only, no production impact) — CRON3-31-1's own `JOIN` made an existing test's assumption about MySQL's row order intermittently false, exposing a real bug in the test's assertion, not this pass's fix — ✅ FIXED

**What:** discovered verifying CRON3-31-1, not in scope originally, but owned
per CLAUDE.md ("if you discover it, you own it"). Running the full backend
suite after CRON3-31-1's fix intermittently failed exactly one pre-existing
test — `TestPublishScheduledMessagesCommitFailureIsSurvivable::test_a_commit_
failure_on_one_message_does_not_abort_the_batch` — with `sqlalchemy.exc.
MissingGreenlet` on a bare, unawaited `good.id` attribute read. It was **not**
a flake to wave through: 3 full-suite runs with CRON3-31-1's fix applied all
failed on this exact test; 1 full-suite run with the fix reverted did not.
Investigated with a tighter, faster reproduction (looping the single test
class 30 times standalone) rather than repeated 5-minute full-suite runs:
**0/30 failures with the fix reverted, 11/30 (~37%) with it applied** —
conclusive, and a genuine causal mechanism, not full-suite-scale noise.

**Root cause:** the test seeds two `DepartmentMessage` rows (`bad`, `good`)
and asserts on `deliver.await_args.args[0].id` — an ORM object handle read
_after_ `run_publish_scheduled_messages` has fully returned — assuming
`bad` is always processed before `good` in the function's unordered `due`
list (its own comment says "must succeed regardless of which message... the
`due` query (unordered) happens to process first", which is the correct
requirement but not what the assertion actually verified). When MySQL
happens to return `good` first: `deliver(good)` runs and returns cleanly,
then `bad` fails and the exception handler's `await db.rollback()` expires
**every** persistent object in the session — `good` included, not just
`bad`. The test's later, unawaited `delivered_message.id` read then needs an
implicit lazy refresh outside the async greenlet bridge and raises
`MissingGreenlet`. This is exactly the anti-pattern `_MessageFacts`/
`_RecipientFacts` in `message_delivery_service.py` and this file's own
`needs_refresh` pattern exist to prevent in production code — here it was
latent in a _test's_ assertion instead.

**Why CRON3-31-1 exposed it:** before CRON3-31-1, the "due" query was a
plain single-table `SELECT` with no `JOIN`, which this MySQL/test setup
happened to always execute as a straightforward index scan returning rows
in a single, consistent order (insertion order, `bad` first, since it is
added before `good`) — so the pre-existing bug never fired. CRON3-31-1 added
`.join(Organization, ...)`, which changes the query's execution plan and,
with no `ORDER BY` on either side, MySQL is not obligated to preserve any
particular row order — it began returning `good` before `bad` often enough
to make this bug visible for the first time. The bug was live in the test
before CRON3-31-1 (any change perturbing row order would have surfaced it
identically); CRON3-31-1 is simply the change that happened to do so.
**No production code is affected** — `deliver()` is always awaited and
fully consumes the message's attributes within the same loop iteration,
before any later iteration's rollback can expire anything; only this test's
own after-the-fact inspection of the ORM object was at risk.

**Fix:** `tests/test_message_delivery_service.py`'s
`test_a_commit_failure_on_one_message_does_not_abort_the_batch` now captures
`good.id` into a plain string immediately after the setup commit, and the
`deliver` mock captures `message.id` into a list _at call time_ (via a
`side_effect`) rather than being read off `deliver.await_args.args[0]`
after the function returns — so nothing in the assertion touches a
persistent ORM attribute that a later message's rollback could expire.
Verified: 40/40 passes standalone after the fix (up from 11/40 failures
before it), and the scoped/full-suite runs below are clean.

**Also correction, not a new finding:** the pre-existing test's own comment
already stated the intended, order-independent behavior; this fix makes the
assertion actually verify that intent rather than assuming one specific
order, which is more correct going forward regardless of what any future
query-plan change does to MySQL's incidental row order.

## Findings — flagged, not fixed

### CRON-31-7, CRON-31-8, and the Redis-down fallback — re-confirmed still open

No new information this pass; not re-applied, per the rotation's own rule
against re-reporting a prior pass's considered, unresolved call. Current
locations, since the file grew ~300 lines and the prior docs' line citations
have drifted:

- **`run_end_of_shift_summary` can mark a member "sent" without anything
  reaching them** if both channels fail for that member —
  `scheduled_tasks.py:2529-2982` (was cited as `2709-2874` in the pass-2 doc;
  the function itself, and the specific `newly_sent.append(uid)` line now at
  `:2972`, moved down ~260 lines as a side effect of the unrelated diff
  above it in the file, not any change to this function's own body — read
  and confirmed byte-for-byte identical logic).
- **`run_event_reminders` stamps a due interval as sent with zero
  recipients**, by explicit design comment — `scheduled_tasks.py:954-1250`,
  comment now at `:1122` (was `1062-1068`; same "moved by an earlier
  unrelated diff, logic unchanged" situation — the new `is_draft` filter this
  pass's own diff added sits well above this comment, at line 1055, and
  pushed everything below it down by exactly the four lines the new `.where`
  clause added).
- **The in-process scheduler's Redis-down fallback runs on every worker,
  unguarded** — `main.py:1544-1556`. Unchanged; still the same considered
  trade-off (fail open beats zero scheduled tasks firing at all until Redis
  recovers).

## Schema & migration notes

No model or migration touched this pass. n/a.

## Guard tests added

All added to `backend/tests/test_message_delivery_claim_recovery.py`
(alongside the 9 pre-existing tests for this feature, none of which were
modified):

- `TestTheSweepFindsThem::test_a_deactivated_orgs_message_is_not_re_delivered` —
  CRON3-31-1 (sweep, redelivery side). A decommissioned org's stranded claim
  must not be handed to `deliver()`. Verified to **fail** against the
  pre-fix code (`deliver()` was called; `result["messages"] == 1`) and
  **pass** after.
- `TestTheSweepFindsThem::test_a_deactivated_orgs_stranded_claim_is_retired_not_left_pending` —
  CRON3-31-1 (sweep, retirement side). Without the fix, a decommissioned
  org's claim was excluded from the "undeliverable" retire query too (it only
  checked the message's own `is_active`/`deleted_at`), so it would sit
  `pending` forever rather than being retired like a dead message's claim.
  Verified to **fail** (`result["retired"] == 0`, claim still `pending`) and
  **pass** after.
- `TestPublishScheduledMessagesSkipsDeactivatedOrgs::test_a_deactivated_orgs_due_message_is_not_published` —
  CRON3-31-1 (`run_publish_scheduled_messages` sibling). A due message
  belonging to a deactivated org must not be published, delivered, or have
  its `scheduled_at` claim cleared. Verified to **fail** against the pre-fix
  code (`deliver()` called, `result["published"] == 1`) and **pass** after.

All three run against a real `db_session` (MariaDB), not a mocked session —
consistent with this test file's existing convention (see its own comment on
why `_claim_row` commits rather than flushes) — and were independently
verified to fail against the pre-fix code (`git stash` on
`scheduled_tasks.py` alone, tests re-run, fix restored) rather than merely
written and assumed correct.

`tests/test_message_delivery_service.py`'s existing
`test_a_commit_failure_on_one_message_does_not_abort_the_batch` was also
fixed (CRON3-31-2, above) rather than added new — its own assertion held an
ORM object handle across a point where a later message's rollback could
expire it, latent until CRON3-31-1's added `JOIN` started reordering the
"due" query's rows often enough to expose it. Verified: 40/40 standalone
passes after the fix, versus 11/40 failures before it (see CRON3-31-2 for the
full investigation and reproduction numbers).

## Completion gate

| Check                                                                                                                                           | Result                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                                   | ✅ 0 violations                                                                    |
| `black --check app/ tests/ alembic/`                                                                                                            | ✅ clean                                                                           |
| `isort --check-only app/ tests/ alembic/`                                                                                                       | ✅ clean                                                                           |
| `python3 scripts/validate_migrations.py --strict`                                                                                               | ✅ 432 revisions, single head `ee7390dcdf47`                                       |
| `pytest tests/ -k "scheduled_task or scheduled_email or scheduled or retention or audit_ship"` (plus the feature's other test files, see below) | ✅ 160 passed, 1 skipped (pre-existing, missing optional `py_vapid` dep), 0 failed |
| `pytest tests/` (full suite)                                                                                                                    | ✅ 11,642 passed, 21 skipped, 0 failed (verified clean after CRON3-31-2's fix)     |
| `cd frontend && npm run typecheck`                                                                                                              | ✅ 0 errors (no frontend files touched this pass)                                  |
| `cd frontend && npm run lint`                                                                                                                   | ✅ 0 errors, 2 pre-existing warnings unrelated to this pass (`CallTypeChips.tsx`)  |

The scoped run above widened the `-k` expression beyond the brief's literal
string to also cover the feature's actual test file names
(`test_message_delivery_claim_recovery`, `test_message_delivery_service`,
`test_action_item_reminders`, `test_shift_scheduled_tasks`,
`test_rolling_recurrence_extend_isolation`,
`test_external_training_auto_sync_isolation`,
`test_scheduled_tasks_structure`, `test_retention_service`,
`test_inventory_notification_group_isolation`), since several of those don't
contain the literal substrings the brief's `-k` expression matches on.

### How the full-suite failure was root-caused rather than waved through as a flake

The first two full-suite runs after CRON3-31-1's fix each failed exactly one
test — `test_a_commit_failure_on_one_message_does_not_abort_the_batch` — with
`MissingGreenlet` at a `SAVEPOINT` boundary, in a way that at first looked
like a classic suite-scale-only flake (passed standalone every time it was
tried in isolation, initially). A third full-suite run with CRON3-31-1's
`scheduled_tasks.py` diff reverted produced zero failures on this test. That
3-run pattern (2/2 with the fix failed, 0/1 without it passed) was not
accepted as coincidental noise: per CLAUDE.md's no-suppression rule, it was
investigated to an actual mechanism rather than documented as an unexplained
environmental flake. The investigation that found it: looping the single test
**standalone** 30 times (not another 5-minute full-suite run) reproduced
11/30 failures — proving it was never a full-suite-only phenomenon, just one
that needed enough tries to hit in isolation — and a second 30-run loop with
CRON3-31-1's diff reverted produced 0/30 failures, conclusively implicating
the diff. Reading the failing traceback in full (rather than only its final
line) showed the actual mechanism: CRON3-31-2, above. Fixing the test's own
latent bug (not the diff, which is correct) resolved it — 40/40 passes
afterward, confirmed again in this full, clean 11,642-test suite run.
