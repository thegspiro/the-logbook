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

Feature 07 (users & organizations, pass 2) — pushing a fix for 5 real
Codex findings (across 2 rounds) to the still-open PR #1949, including a
production-breaking `AttributeError` on every member-creation request.
Next after merge: 08 membership pipeline, pass 2.

---

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
| 07  | Users & organizations     | USR    | `users.py`, `organizations.py`, `member_status.py`, `member_leaves.py`                                                                          | ⏳     |
| 08  | Membership pipeline       | MP     | `membership_pipeline.py`, `membership_pipeline_service.py`                                                                                      | ⬜     |
| 09  | Medical screening (PHI)   | MS     | `medical_screening.py`, `medical_screening_service.py`                                                                                          | ⬜     |
| 10  | Documents & legal         | DOC    | `documents.py`, `station_documents.py`, `legal_documents.py`                                                                                    | ⬜     |
| 11  | Inventory                 | INV    | `endpoints/inventory.py` (6539 L), `inventory_service.py`                                                                                       | ⬜     |
| 12  | Facilities                | FAC    | `endpoints/facilities.py` (3724 L), `facilities_service.py`                                                                                     | ⬜     |
| 13  | Apparatus & NFC           | AP     | `apparatus.py`, `nfc_tags.py`                                                                                                                   | ⬜     |
| 14  | Equipment check & shifts  | EC     | `equipment_check.py`, `shift_completion.py`                                                                                                     | ⬜     |
| 15  | Scheduling                | SCH    | `scheduling.py`, `scheduling_module_config.py`, `calcom_sync.py`                                                                                | ⬜     |
| 16  | Events & requests         | EV     | `events.py`, `event_requests.py` (public submission path)                                                                                       | ⬜     |
| 17  | Training core             | TR     | `training.py`, `training_programs.py`, `training_sessions.py`                                                                                   | ⬜     |
| 18  | Training extended         | TRX    | `training_submissions.py`, `training_enhancements.py`, `training_waivers.py`, `external_training.py`, `course_cohorts.py`, `course_syllabus.py` | ⬜     |
| 19  | Skills testing            | SKT    | `endpoints/skills_testing.py` (3723 L)                                                                                                          | ⬜     |
| 20  | Compliance                | CMP    | `compliance_config.py`, `compliance_officer.py`                                                                                                 | ⬜     |
| 21  | Admin hours               | AH     | `admin_hours.py`                                                                                                                                | ⬜     |
| 22  | Grants & fundraising      | GF     | `grants.py`, `grant_service.py`, `fundraising_service.py`                                                                                       | ⬜     |
| 23  | Medical supplies          | MSUP   | `medical_supplies.py`                                                                                                                           | ⬜     |
| 24  | Meetings & minutes        | MM     | `meetings.py`, `minutes.py`                                                                                                                     | ⬜     |
| 25  | Messaging & notifications | MSG    | `messages.py`, `message_history.py`, `notifications.py`, `email_templates.py`                                                                   | ⬜     |
| 26  | Forms                     | FORM   | `endpoints/forms.py`, `public/forms.py`                                                                                                         | ⬜     |
| 27  | Integrations              | INT    | `integrations.py`, `salesforce_sync.py`                                                                                                         | ⬜     |
| 28  | Security, audit & IP      | SEC2   | `security_monitoring.py`, `ip_security.py`, `audit_logs.py`, `error_logs.py`                                                                    | ⬜     |
| 29  | Reports & analytics       | RPT    | `reports.py`, `analytics.py`, `platform_analytics.py`, `dashboard.py`, `labels.py`                                                              | ⬜     |
| 30  | Onboarding                | ONB    | `api/v1/onboarding.py` (24 unauth bootstrap routes)                                                                                             | ⬜     |
| 31  | Scheduled tasks           | CRON   | `scheduled.py`, `services/scheduled_tasks.py`                                                                                                   | ⬜     |
| 32  | Locations & kiosk         | LOC    | `locations.py`, `admin_hub.py`                                                                                                                  | ⬜     |
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
