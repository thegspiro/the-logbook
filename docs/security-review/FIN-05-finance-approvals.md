# Security Review 05 — Finance & Approvals

**Prefix:** `FIN` · **Iteration:** 05 · **Reviewed:** 2026-08-25 (pass 1), 2026-08-27 (pass 2), 2026-09-02 (pass 3), 2026-09-08 (pass 4) · **PR:** [#1809](https://github.com/thegspiro/the-logbook/pull/1809) (pass 1)

---

## Pass 4 (2026-09-08)

**Scope.** No backend finance file changed since pass 3's closing commit —
confirmed with `git log --since="2026-09-01" -- <finance module paths>`, which
surfaces exactly one commit (`9f9a28d`, "Give the Finance and Elections pages
a trail in every state"), a breadcrumb/navigation-trail addition touching only
ten `frontend/src/modules/finance/pages/*.tsx` files (each a one-line JSX
addition) plus its own test file — no data flow, auth, or money-movement
logic. Reviewed and confirmed cosmetic; no finding.

With nothing to diff, this pass re-verified pass 3's own fixes against current
code (not retaken on the prior write-up's word) and worked the full checklist
fresh rather than spot-checking, on the theory that three prior passes'
absence of new findings does not by itself prove a fourth pass would find
none — which is exactly what happened.

**FIN-19 through FIN-26 (pass 3's fixes) re-verified present and unchanged.**
Read every method pass 3's write-up names — `_terminate_pending_steps`,
`_chain_is_denied`, `_ensure_current_step`, `_advance_reachable_steps` (the
`DENIED`-early-return and the deferred EMAIL-token issuance), `_validate_
finance_fks` (now covering `apparatus_id`/`facility_id`), `_validate_budget_
category_fks`, `_validate_approval_chain_fks`, `_validate_chain_step_fks` (the
last wired into `add_chain_step`, `update_chain_step`, **and**
`create_approval_chain`'s inline per-step loop) — all present, all still
called from every site pass 3 put them in. `20260901_1300_d5e1f6a8b037`
(FIN-22's backfill) still guards on `approval_step_records` existing
(Pitfall #26).

### FIN-27 — MED — `GET /budgets/summary` and `GET /approval-chains/preview` were both permanently unreachable, shadowed by an earlier `/{id}` route — ✅ FIXED

**What:** Starlette/FastAPI matches routes in registration order and dispatches
to the first _full_ match (path **and** method); it does not prefer a
fixed-path route over a same-shaped parameterized one registered earlier. Two
fixed 2-segment GET routes were each registered **after** a same-method,
same-segment-count `/{id}` route sharing their prefix:

- `backend/app/api/v1/endpoints/finance.py` — `GET /budgets/{budget_id}`
  (`get_budget`, then at line 326) was registered before `GET /budgets/
summary` (`get_budget_summary`, then at line 361). Both are `GET` on a
  2-segment path under `/budgets/`.
- Same file — `GET /approval-chains/{chain_id}` (`get_approval_chain`, then at
  line 437) was registered before `GET /approval-chains/preview`
  (`preview_approval_chain`, then at line 564).

**Failure scenario:** any request to `GET /finance/budgets/summary` or `GET
/finance/approval-chains/preview` — from the frontend's budget dashboard and
the approval-chain preview-before-save UI, and from any API client — was
dispatched to `get_budget(budget_id="summary")` / `get_approval_chain(chain_id=
"preview")` instead. Both org-scope the lookup correctly, so this was never a
cross-tenant leak; "summary"/"preview" simply never match a real row, so both
endpoints have been permanently returning `404 Not Found` since whenever they
were added — a fully broken feature with no error in the logs to point at it
(a 404 on a client-looking-up-something-that-doesn't-exist path is
indistinguishable, from the server's perspective, from a legitimate not-found).
Reproduced directly (not inferred from reading the code): a minimal two-route
FastAPI app in the same registration order returns the by-id handler's
response for the fixed path (`{'route': 'by_id', 'budget_id': 'summary'}`,
`200`), and a `Match.FULL` sweep over the real router — see the guard test
below — printed exactly these two shadows and no others, against the pre-fix
code.

**Where:** `backend/app/api/v1/endpoints/finance.py` (route registration
order only — no change to either handler's body, auth dependency, or org
scoping).

**Fix:** reordered both fixed-path routes to register before their
same-shaped `/{id}` sibling (matching the order the `roles.py` router already
uses for the same reason — see `tests/test_roles_route_resolution.py`, the
precedent this pass's guard test follows). No behavior change to either
handler; no schema, permission, or response-model change.

**Guard test:** `tests/test_finance_route_resolution.py` — asserts, per
`Match.FULL` dispatch simulation (the same mechanism Starlette itself uses),
that `GET /budgets/summary` resolves to `get_budget_summary` and `GET
/approval-chains/preview` resolves to `preview_approval_chain` (not their
by-id siblings), that real by-ids still resolve correctly, and — the part
that generalizes past these two known cases — a whole-router sweep asserting
no route in the finance router is shadowed by any earlier-registered one.
Confirmed to fail on the pre-fix code (`git stash` on the two source files,
re-run: 3 of 5 tests fail, including the whole-router sweep) and pass after.

### FIN-28 — LOW — `get_pending_approvals` cast a Decimal amount through `float()` before Pydantic re-validated it as `Decimal` — ✅ FIXED

**What:** `finance_service.py`'s `get_pending_approvals` built its response
dicts with `"entity_amount": float(row.amount)`, where `row.amount` is already
a `Decimal` (the column is `Numeric(12, 2)`) and `PendingApprovalResponse.
entity_amount` (the field FastAPI validates this dict against, via
`response_model=list[PendingApprovalResponse]`) is typed `Decimal`. The value
went `Decimal → float → Decimal` for no reason. Not a live bug — every value
this table can hold (`Numeric(12,2)`, department budget/request amounts) is
exactly representable in a `float64` mantissa, so the round-trip is lossless
in practice — but it is exactly the kind of gratuitous float conversion the
module's own money-math discipline (`Decimal` end-to-end, confirmed via
`grep -c "float("` across `finance_service.py` — the only two other hits are
percentage/rate display roundings, not currency) exists to avoid, and it
would stop being lossless the moment `Numeric`'s precision is ever widened
without this line being remembered.

**Where:** `backend/app/services/finance_service.py:1168` (inside
`get_pending_approvals`).

**Fix:** pass `row.amount` straight through, removing the round-trip. No
behavior change (verified: no test asserts on `entity_amount`'s exact
representation — `grep -rn entity_amount backend/tests/` returns nothing —
and `Decimal == float` compares by value in Python, so any hand run against
either form agrees).

### FIN-29 — MED — `GET /approval-chains/preview`'s own 404 was swallowed by its trailing `except Exception`, downgraded to a 500 — ✅ FIXED

**What:** Codex review on PR #2398 caught this the moment FIN-27's route
reorder made the endpoint reachable at all: `preview_approval_chain`'s
`if not chain: raise HTTPException(status_code=404, ...)` sat _inside_ the
same `try` block as the service call, and that block's own
`except Exception as e: raise HTTPException(status_code=500, ...)` has no
`except HTTPException` clause ahead of it — `HTTPException` is an `Exception`
subclass, so the 404 it raised was itself caught by the generic handler and
replaced with a 500. A caller previewing a chain for a genuinely
no-match `(entity_type, amount, category_id)` combination — the normal,
expected outcome for a preview, not an error — got `500 Internal Server
Error` instead of the intended `404`. Confirmed this shape is unique to this
one endpoint in the file: every other 404-raising handler in `finance.py`
either raises outside any `try` (`get_fiscal_year`, `get_budget`,
`get_approval_chain`, `get_purchase_request`, `get_expense_report`,
`get_check_request`) or raises it via a caught `except ValueError`
(`list_dues_payments`), never as a bare `raise HTTPException(404)` sharing a
`try` with a bare `except Exception`.

**Where:** `backend/app/api/v1/endpoints/finance.py`, `preview_approval_chain`
(the same function FIN-27 reordered).

**Fix:** moved the `if not chain: raise HTTPException(404, ...)` check to
after the `try`/`except` block, matching the pattern every other read
endpoint in this file already uses — the service call and its
`BudgetLimitExceededError`/`ValueError`/`Exception` handling stay wrapped
(the service can raise `ValueError` for an invalid `entity_type`), but the
"no chain matched" branch is no longer inside anything that can catch it. No
handler logic changed beyond the reordering.

### Documentation correction — FIN-7's residual "still flagged" items were already fixed on `main`, undocumented — no code change, docs only

Re-verifying FIN-7 (the module-audit's original correctness/DoS-polish
finding) against current code, rather than against what the doc said, found
three of its four "still flagged" items already resolved — not by this pass,
and not claimed by any commit in this rotation's log, which is exactly how a
stale doc survives three prior passes' re-reads: each pass re-read the _code_
this doc doesn't cover and found it clean, without noticing the older doc
still called the same gap open.

- **"Unbounded transaction export and in-memory pagination (fetch-all-then-
  slice) on the list endpoints"** — **partially resolved; the "every list
  method" claim below was itself wrong, per Codex review on PR #2398 (now
  filed separately as FIN-30).** Every list method the original finding
  actually named already pushes `.offset()`/`.limit()` into the SQL query
  (`list_purchase_requests`, `list_expense_reports`, `list_check_requests`,
  `list_budgets`, `list_dues_schedules`, `list_export_mappings`,
  `list_export_logs`); none fetches the full table into Python first.
  `generate_export` (`finance_service.py:2496`) counts rows up front, refuses
  anything over `max_records=10_000` (→ 400), and streams the CSV in
  `batch_size=500` pages, recording `partial`/`failed` on `ExportLog` if the
  stream is interrupted — evidently landed alongside pass 2's
  `add_export_stream_status` migration (2026-08-27), which added the
  `status`/`error_message`/`completed_at` columns this exact code path
  writes, but pass 2's own write-up described that migration without
  reporting that the export it belongs to had also become bounded.
- **"No overspend/negative-balance guard on spend posting"** — `_mutate_
budget` (`finance_service.py:2778`) takes the budget row `.with_for_update()`
  and raises `BudgetLimitExceededError` (→ 409) whenever `new_spent +
new_encumbered > amount_budgeted`, on every encumber/spend path
  (`_encumber_budget`/`_release_encumbrance`/`_add_to_spent`, and
  `update_budget`'s own reduce-side check per FIN-11). Fail-closed, no
  administrative override, per the comment at `finance_service.py:2751`.
- **`_generate_request_number` `count()+1` race** — module-audit's own next
  bullet already marked this ✅ Fixed (2026-07-31); only the summary bullet
  three lines below it, and the mirrored `KNOWN_LIMITATIONS.md` row, had not
  caught up.

Genuinely still open, and correctly still flagged: **float→Decimal is not a
module-wide gap** (storage is `Numeric(12,2)` and every money computation is
`Decimal` throughout — see FIN-28 above for the one straggler, now fixed), and
**`get_pending_approvals` returning every org approver's queue rather than
filtering to steps assigned specifically to the caller** — the query itself
has been org-confined since FIN-9; there is no per-step assignee field to
filter on today, and adding one is a schema/behavior decision, not a fix this
pass can make.

### FIN-30 — LOW — `list_dues_payments` (`GET /dues/{dues_id}/payments`) is genuinely unbounded — the "every list method paginates" claim above was false — 🚩 FLAGGED (doc correction reverted, not fixed)

**What:** Codex review on PR #2398 caught that this very pass's own
documentation correction (above) overclaimed: `list_dues_payments`
(`finance_service.py:2325`) is a list-shaped method the original FIN-7
finding's "list endpoints" language covers, and it does **not** paginate —
`select(MemberDues).where(*filters).options(selectinload(MemberDues.
payments))` eager-loads the entire `payments` relationship with no
`.offset()`/`.limit()`, and the endpoint (`finance.py:1402`) returns
`list(dues.payments)` straight through with no slicing of its own. Scoped to
one member's dues record rather than the whole org (the enumeration above
was of org-wide list endpoints, which is a materially smaller blast radius),
but a dues ledger that accrues an unusually large number of payments —
plausible over a multi-year membership, and each individual
`record_dues_payment` call is itself unbounded in count — still returns its
full history in one response with no cap.

**Where:** `backend/app/services/finance_service.py:2325`
(`list_dues_payments`); `backend/app/api/v1/endpoints/finance.py:1402`
(`list_dues_payments` route).

**Why flagged, not fixed:** paginating this endpoint changes its response
shape — today it returns `list[DuesPaymentResponse]` unconditionally; adding
`limit`/`offset` (or a cursor) means either a new paginated envelope (a
frontend contract change, mirrored in `DuesManagementPage`'s payment-history
view if it has one) or silently capping and dropping older payments with no
indication anything was cut off, which is worse than the current unbounded
behavior for a bookkeeping ledger. That is a product decision, not a
drive-by fix, and finance code is exactly where this pass should flag rather
than guess. Left unchanged.

**Corrected (the corrected version, this time verified against every
enumerated list method individually rather than the blanket claim reverted
here):** `docs/module-audit/finance.md`'s FIN-7 entry, `docs/app-review/
finance.md`'s pass-4 section, `docs/KNOWN_LIMITATIONS.md`'s finance
correctness/DoS-polish row — each now names `list_dues_payments` as the one
list method still unbounded rather than asserting "every list method"
without exception. No other security-review file needed correction.

**Disposition: FIN-27 and FIN-29 FIXED (both with guard coverage); FIN-28
FIXED; FIN-30 FLAGGED (a Codex-caught overclaim in this pass's own doc
correction, now accurately scoped rather than resolved).** `get_pending_
approvals` assignee-level filtering remains FLAGGED, as it always has been,
now for the first time accurately described as the _only_ remaining FIN-7
item besides FIN-30.

**Verified good ✅ (re-confirmed, not re-derived):** all 66 routes still carry
`require_permission` (route count unchanged); every by-id read/update/delete
across fiscal years, budget categories, budgets, approval chains + steps,
purchase requests, expense reports, check requests, dues schedules, member
dues, and export mappings/logs is org-scoped (walked every service method in
this pass, not sampled); `approve_step`/`deny_step`/`approve_by_token`/`deny_
by_token` all `.with_for_update()` their `ApprovalStepRecord` read and call
`_ensure_current_step`; `mark_pr_paid`/`mark_expense_paid`/`issue_check`/
`waive_dues` all call `assert_different_person`; `_validate_finance_fks` and
its three siblings cover every client-supplied FK named across `schemas/
finance.py`; the one `.like()` (`_generate_request_number`) still declares
`escape=LIKE_ESCAPE_CHAR` against a system-generated pattern; `export_
transactions`'s CSV path still uses only `SafeCsvWriter`; every `except` still
routes through `safe_error_detail()`; `public/finance_approvals.py` unchanged
since PUB-03 (byte-for-byte diff against this file's own pass-1 read),
rate-limited, bounds- and pattern-checked token, 404-before-400 ordering, and
the email-address self-approval guard all present.

**Completion gate (pass 4):** `flake8`/`black --check`/`isort --check-only`
(9.0.1, CI's pin) on `app/ tests/ alembic/` — clean. `validate_migrations.py
--strict` — 438 revisions, single head `1603bd9c59e7`. `pytest tests/ -q -k
"finance or dues or approval or budget or export"` — 308 passed (303
pre-existing + 5 new route-resolution guards), 1 skipped (pre-existing,
`py_vapid`), 0 failed. Full backend suite (`pytest tests/ -q`) — 11840 passed,
21 skipped (all pre-existing: `py_vapid`, Docker-unavailable integration
tests, the opt-in API-contract suite), 0 failed. No frontend source file
changed by this pass, so `tsc --noEmit`/`eslint .`/`vitest run src/modules/
finance/` were run anyway per the completion-gate checklist: `tsc --noEmit` 0
errors; `eslint .` 0 errors, 2 warnings (both `react-refresh/only-export-
components` on `CallTypeChips.tsx`, a scheduling-module file unrelated to
finance, pre-existing, well under the `--max-warnings 10` gate); `vitest run
src/modules/finance/` — 3 files, 108 tests, all passed.

**Local-environment note, not a finding:** the first run of `eslint .` in
this session's sandbox reported 1116 warnings across 41 files, none of them
touched by this pass, all `@typescript-eslint/no-unsafe-*` — a type-resolution
failure, not real violations. Root cause: this worktree is nested inside the
main checkout's directory tree with no `node_modules` of its own, so Node's
upward module resolution silently fell back to
`/home/user/the-logbook/node_modules` (the main checkout's install, shared
across whatever else is concurrently using that path) instead of a clean
install of _this_ worktree's lockfile. `npm ci` at the worktree root (per
CLAUDE.md: run `npm install`/`npm ci` from the repo root) gave the worktree
its own `node_modules`, and every frontend command above was re-run against
it. Confirmed not a real regression before ruling it out: the most recent CI
run on `main`'s current tip (`61de421`, workflow run `34212980428`) is green,
17/17 checks, including `frontend-checks`.

---

## Pass 3 (2026-09-02)

**Scope methodology.** Pass 2's own closing PR (#1946) merged onto a rewritten
history: its head commit is not an ancestor of `origin/main` (confirmed with
`git merge-base --is-ancestor`), the same rewritten-history effect AUTH-01/
SF-04/pass-1-of-this-file already documented. The actual landing point of
pass 2's fixes on `main`'s real ancestry is commit `0eb84bf2` (2026-08-28,
"Add Testing Checklist module; fix messaging, documents, membership, finance,
and various frontend issues") — confirmed by content match: its diff to
`docs/security-review/FIN-05-finance-approvals.md` is the same +200-line pass
2 section already in this file, and its `finance_service.py`/`schemas/
finance.py` diff reproduces FIN-9 through FIN-18 verbatim. Scoped from there:
`git log 0eb84bf2..origin/main -- <finance module paths>`, cross-checked
against a full, non-pathspec-simplified walk to rule out the pathspec-miss
failure mode pass 1 already hit once. Two real commits touch the finance
module in that range (`8729c68a`, `6b5a82fa`); everything else the broader
walk surfaced either doesn't touch finance files or is a squashed-history
whole-file-add artifact from before the pass-2 boundary (`a67261be`, no
parent commit, dated 2026-08-26 — the same class of false positive pass 1's
header already flagged and excluded once).

**Delta reviewed in full.** Both commits were already merged to `main` before
this pass started (products of an unrelated review cycle, not this rotation),
so this pass's job was independent re-verification, not authorship — read
end-to-end against the model, confirmed each fix's own reasoning by tracing
the code paths it touches, and confirmed test coverage exists and is not
just descriptive:

- **FIN-19 through FIN-22, already fixed on `main` prior to this pass,
  independently re-verified correct.** `8729c68a` (2026-08-30) and `6b5a82fa`
  (2026-09-01) fix four real defects in the approval-chain denial path — all
  four re-derived from the code and confirmed sound (not taken on the commit
  messages' word):
  - **FIN-19 — denying a step never terminated the rest of the chain.**
    `_finalize_denial` wrote only the entity's own status; every later
    `PENDING` step record was left actionable, so `get_pending_approvals`
    kept listing a refused request and approving the remaining steps ran
    `_finalize_approval` on it — `_encumber_budget` charged against a denied
    disbursement. Fixed by `_terminate_pending_steps`
    (`finance_service.py:795`), called from both `deny_step` and
    `deny_by_token` before `_finalize_denial`, marking every other `PENDING`
    record `SKIPPED` and clearing its token.
  - **FIN-20 — `_advance_reachable_steps` read a `DENIED` prior step as
    resolved.** The reachability test only rejected a `PENDING` prior, so a
    `DENIED` one read as "complete" — approving a later step of an
    already-denied entity minted a fresh 7-day email token and sent an
    external approver a live link for a refused request. Fixed with an
    explicit early return on any `DENIED` record
    (`finance_service.py:1217`) plus the `_PRIOR_STEP_SATISFIED` allowlist
    (`APPROVED`/`AUTO_APPROVED`/`SENT`) replacing the old blocklist.
    Re-verified `SKIPPED` cannot itself deadlock a live chain: the only
    writer of `SKIPPED` is `_terminate_pending_steps`, always paired with a
    `DENIED` sibling in the same chain, so the early-return above always
    fires first — the prior-step loop that doesn't treat `SKIPPED` as
    satisfied is never reached while a `SKIPPED` record exists.
  - **FIN-21 — `Budget.station_id` (`ondelete="SET NULL"` FK to
    `facilities`) was never org-validated.** `_validate_finance_fks`
    (`finance_service.py:2809`) checked `budget_id`/`category_id`/
    `fiscal_year_id` but not `station_id`, which `BudgetCreate`/
    `BudgetUpdate` both expose as a free client-supplied string (Pitfall
    14c). Fixed by adding an `assert_in_org` check for `station_id`.
  - **FIN-22 — the runtime fix for FIN-19 doesn't reach rows already in an
    existing department's database.** A department that had already hit
    FIN-19 could hold a `DENIED` step followed by `PENDING` ones from before
    the fix shipped; approving the last of those still reversed the denial.
    Fixed two ways: `_ensure_current_step` now calls `_chain_is_denied`
    (`finance_service.py:780`) and refuses to act on any chain already
    carrying a denial regardless of when it was created, and migration
    `20260901_1300_d5e1f6a8b037` backfills existing `DENIED`-then-`PENDING`
    chains to `SKIPPED` with tokens cleared — guarded on `approval_step_
records` existing (Pitfall #26; the table is `create_all`-only on a
    fresh install) and deliberately irreversible (`downgrade` is a no-op —
    reopening a refused chain is the defect, not a state worth restoring).
  - All four verified against real code, not just the commit messages: read
    every call site of `_terminate_pending_steps`/`_chain_is_denied`/
    `_ensure_current_step` (all four action paths — `approve_step`,
    `deny_step`, `approve_by_token`, `deny_by_token` — call
    `_ensure_current_step`; only the two deny paths call
    `_terminate_pending_steps`), confirmed `SKIPPED` has no other writer in
    the codebase (`grep -rn SKIPPED backend/app` — one hit, this one), and
    confirmed the migration guards table existence per Pitfall #26. Existing
    tests (`test_finance_denied_chain_is_terminal.py`,
    `test_finance_approval_tokens.py`) cover both the runtime guard and the
    migration's own source (source-inspection style, since the backfill's
    correctness can't be exercised as a `git stash`-reproducible failure —
    there's no pre-fix code state to stash for a migration file). Full
    scoped suite green (see completion gate below).

**FIN-23 through FIN-26, found this pass — the same Pitfall-14c class as
FIN-21, four more instances of it, in the same file, in functions adjacent to
the ones FIN-21 fixed.** Grepping every `_id: Optional[str]` field in
`schemas/finance.py` against what `_validate_finance_fks` actually checks
surfaced four more client-supplied, `ondelete="SET NULL"` foreign keys with
no org check at all — not narrowed like FIN-21 (missing one field on an
otherwise-checked path), but entire create/update methods that never called
any FK-scoping helper:

- **FIN-23 — MED — `PurchaseRequest.apparatus_id`/`facility_id` unchecked.**
  `finance_service.py:2809` (`_validate_finance_fks`, prior to this pass's
  fix). Both fields are `ondelete="SET NULL"` FKs (`models/finance.py:573`,
  `:578`) exposed as free strings on `PurchaseRequestCreate`/`Update`
  (`schemas/finance.py:382-383`, `:400-401`) — and `_validate_finance_fks`
  **is** already called from both `create_purchase_request`
  (`finance_service.py:1555`) and `update_purchase_request` (`:1580`), so
  this wasn't a missing call site, only a missing field inside the shared
  helper. **Failure scenario:** an org sets `apparatus_id`/`facility_id` to
  another org's apparatus/facility id (not itself a data leak — neither ever
  appears eager-loaded in `PurchaseRequestResponse`, which serializes only
  the bare id) — but that other org later deleting its own apparatus/facility
  silently nulls this org's purchase-request attribution, a cross-tenant
  side effect one org can trigger on another org's data by deleting its own
  row. **Fix:** extended `_validate_finance_fks` with the same
  `assert_in_org` pattern FIN-21 used for `station_id`, covering both create
  and update automatically (both already call the shared helper).
- **FIN-24 — MED — `BudgetCategory.parent_category_id` (self-referential)
  unchecked.** `finance_service.py:260`/`:268` (now `:280`,
  `_validate_budget_category_fks`) — `create_budget_category`/
  `update_budget_category` called no FK-validation helper at all.
  `ondelete="SET NULL"` FK to `budget_categories.id`
  (`models/finance.py:243`). **Fix:** new `_validate_budget_category_fks`,
  called from both create and update.
- **FIN-25 — MED — `ApprovalChain.budget_category_id` unchecked.**
  `finance_service.py:426`/`:443` (now `:457`,
  `_validate_approval_chain_fks`) — `create_approval_chain`/
  `update_approval_chain` called no FK-validation helper. `ondelete="SET
NULL"` FK to `budget_categories.id` (`models/finance.py:363`). A chain
  scoped to another org's budget category would silently apply to `applies_
to` entities regardless of category once that category vanished (`SET
NULL` clears the scoping filter, not the chain). **Fix:** new
  `_validate_approval_chain_fks`, called from both create and update.
- **FIN-26 — MED — `ApprovalChainStep.email_template_id` unchecked, on
  _three_ creation paths.** `finance_service.py:461`/`:473` (now `:494`,
  `:507`; helper `_validate_chain_step_fks` at `:472`) — `add_chain_step`/
  `update_chain_step` called no FK-validation helper, **and**
  `create_approval_chain`'s own `steps` parameter constructs
  `ApprovalChainStep` rows directly in a loop (`finance_service.py:433-437`
  prior to this pass) bypassing `add_chain_step` entirely — so fixing only
  `add_chain_step` would have left the chain-creation-with-steps path (the
  common case: `ApprovalChainCreate.steps` is how a chain is normally built
  in one call) still unchecked. `ondelete="SET NULL"` FK to `email_
templates.id` (`models/finance.py:431`); `EmailTemplate.organization_id`
  is `nullable=False` (no org-agnostic system templates to special-case).
  **Fix:** new `_validate_chain_step_fks`, called from `add_chain_step`,
  `update_chain_step`, **and** inside `create_approval_chain`'s per-step
  loop.

None of FIN-23 through FIN-26 leak cross-org data on read — verified by
checking every response schema and every `selectinload`/`joinedload` of the
four relationships (`apparatus`, `facility`, `parent`/`children`, `budget_
category`, `email_template`) in `finance_service.py`: none is eager-loaded
into a serialized response beyond the bare id column already on each
`*Response` schema. The risk is the dangling-reference/cross-org-`SET NULL`
side channel Pitfall 14c itself names, identical in shape to FIN-21 — a
department's own data can be silently altered by another org's unrelated
delete, and (for FIN-25/FIN-26) a chain's approval routing or a step's email
template can be pointed at another org's configuration with no ownership
check on either side.

**Fix applied, all four, same pattern as FIN-21 (`assert_in_org`, already
imported and tested in this file):** `app/services/finance_service.py`
imports `Apparatus` (`app.models.apparatus`) and `EmailTemplate`
(`app.models.email_template`) alongside the existing `Facility` import;
`_validate_finance_fks` gained `apparatus_id`/`facility_id` checks; three new
sibling helpers (`_validate_budget_category_fks`, `_validate_approval_chain_
fks`, `_validate_chain_step_fks`) cover the three call sites that had no
FK-validation helper at all. 13 new tests in
`tests/test_finance_chain_fk_validation.py`, one class per field group,
following `test_finance_station_fk_validation.py`'s exact shape (mocked DB,
no MySQL). Confirmed against the pre-fix code (`git stash` on
`finance_service.py`, re-run, `git stash pop`): 11 of 13 failed — every test
calling `_validate_budget_category_fks`/`_validate_approval_chain_fks`/
`_validate_chain_step_fks` failed with `AttributeError` (the methods didn't
exist yet), and both `apparatus_id`/`facility_id` "rejects" tests on the
shared `_validate_finance_fks` failed by not raising. The remaining 2 (the
`apparatus_id`/`facility_id` "accepts an in-org id" case) can't fail pre-fix
by construction — a check that doesn't exist yet also doesn't reject a valid
id — so their coverage is carried entirely by the paired "rejects" test in
the same class.

**Disposition: all six (FIN-19 through FIN-26) FIXED.** FIN-19–22 were
already fixed on `main` before this pass and are re-verified correct here;
FIN-23–26 are fixed in this pass's own commit. No open items from this
pass's own review. Pass 1/2's FIN-1 through FIN-18 re-verified still hold
against current code (route inventory unchanged at 66 routes, all carrying
`require_permission`; `get_pending_approvals`' org-scoped `union_all` CTE
unchanged; `.with_for_update()` present on all four approval-action reads;
`SafeCsvWriter` still the only writer in `export_transactions`; the one
`.like()` call still declares `escape=LIKE_ESCAPE_CHAR` against a
system-generated prefix).

**Completion gate (pass 3):** `flake8`/`black --check`/`isort --check-only`
on `app/ tests/ alembic/` — clean (isort 9.0.1, matching CI's pin).
`validate_migrations.py --strict` — 409 revisions, single head. `pytest
tests/ -q -k "finance or dues or approval or budget or export"` — 270 passed
(257 pre-existing + 13 new), 1 skipped (pre-existing, unrelated `py_vapid`
optional dependency), 0 failed. Full backend suite (`pytest tests/ -q`) —
9771 passed, 21 skipped (all pre-existing: `py_vapid`, Docker-unavailable
integration tests, an opt-in API-contract suite gated behind an env var), 0
failed. `tsc --noEmit` — 0 errors (no frontend file changed by this pass).
`eslint .` — 0 errors/warnings (no frontend file changed).

---

## Pass 2 (2026-08-27)

Scoped to the **full finance domain** since pass 1's merge commit (`51ce8547`,
PR #1809), not just the files pass 1's header enumerated — the corrected
methodology adopted after Codex flagged the same gap on SF-04 (PR #1935).
`git diff 51ce8547..<pass-2 base>` on the finance/approvals area touches:

- **Backend:** `api/v1/endpoints/finance.py` (+176), `services/finance_service.py`
  (+781), `api/public/finance_approvals.py` (+6 — the PUB-03 self-approval
  guard, already reviewed under that iteration and re-confirmed unchanged
  since), `models/finance.py` (+7), `schemas/finance.py` (+122).
- **Migrations:** `20260826_1700_add_export_stream_status.py` — adds
  `status`/`error_message`/`completed_at` to `finance_export_logs`.
- **Frontend:** 10 files under `modules/finance` (not 8 — the first sweep
  missed `routes.tsx` and `store/financeStore.ts`), primarily a
  `MonetaryAmount`/`DecimalString` type-hardening pass (money stays a string
  end-to-end, matching the backend's `Decimal` usage, never a float) plus a
  `requiredModule="finance"` addition to the module's `ProtectedRoute`,
  matching the pre-existing backend `module_gate("finance", "Finance")` — a
  frontend gate mirroring a server-side one already in place, not a new
  access-control boundary.

**Correction (Codex review on PR #1942):** the first draft of this section
claimed no findings. Codex caught six real defects the initial sweep missed
— five of them genuine bugs, not just documentation gaps — all now fixed:

- **FIN-10 (concurrency, the significant one).** `approve_step`/`deny_step`
  read the `ApprovalStepRecord` with a plain `SELECT`, not the
  `.with_for_update()` lock `approve_by_token`/`deny_by_token` already use on
  the identical read. Two authorized approvers acting on the same pending
  step at the same time both see `PENDING`, both flip it to `APPROVED`, and
  both call `_finalize_approval` — double-encumbering the budget for one
  purchase request. Fixed by adding `.with_for_update()` to both reads,
  matching the token path. Guarded by
  `TestFinanceApprovalStepLocking` in `test_capacity_locking.py` (source-
  inspection style, matching the rest of that file's Pitfall #27 coverage).
- **FIN-11 (ceiling bypass).** `update_budget` (the `PUT /budgets/{id}`
  path) set `amount_budgeted` directly with no lock and no check against
  `amount_spent + amount_encumbered` — the exact ceiling `_mutate_budget`
  enforces on the encumber/spend side. A manager could reduce a budget below
  what was already committed and have it persist silently; the endpoint's
  `except BudgetLimitExceededError` handler was dead code, since nothing on
  this path could ever raise it. Fixed: `update_budget` now takes the same
  locking read and raises `BudgetLimitExceededError` when the new amount
  would go under the committed total. Guarded by
  `test_update_budget_enforces_ceiling_when_reducing` /
  `test_update_budget_allows_reduction_above_committed_amount`
  (`test_finance.py`) and `TestFinanceBudgetCeilingOnUpdate`
  (`test_capacity_locking.py`).
- **FIN-12 (schema regression).** `DuesScheduleUpdate.grace_period_days`
  carried `decimal_places=2` copied from the neighboring `Decimal` fields
  onto an `int` field. Pydantic-core raises a bare `TypeError` for that
  combination on any valid integer, so every dues-schedule update touching
  this field broke. Fixed by dropping the stray constraint (the sibling
  create/response schemas were never affected). Guarded by
  `test_dues_schedule_update_accepts_integer_grace_period`.
- **FIN-13 (schema regression).** `ExportRequest.validate_date_range`
  compares and subtracts `date_range_start`/`date_range_end` directly. A
  request mixing a naive and a timezone-aware ISO datetime raises
  `TypeError: can't compare offset-naive and offset-aware datetimes` —
  a bare Python exception the `model_validator` does not turn into a 422,
  so it reaches the client as a 500. Fixed with a `field_validator` that
  normalizes a naive datetime to UTC before the range/span checks run,
  mirroring `schemas/election.py`'s `_as_utc`. Guarded by
  `test_export_request_normalizes_mixed_naive_and_aware_datetimes`.
- **FIN-14 (data integrity, frontend).** `ExpenseReportFormPage.tsx` was the
  one form the type-hardening pass missed: it still built the wire payload
  with `amount: Number(item.amount)`, sending expense line-item amounts as
  JS floats while every sibling form (`PurchaseRequestFormPage.tsx`,
  `CheckRequestFormPage.tsx`) now sends a fixed-precision decimal string.
  The backend's `ExpenseLineItemCreate.amount` already only accepts a
  `Decimal` with `decimal_places=2`, so this was a live precision gap, not
  just an incomplete rollout. Fixed by switching to `item.amount.toFixed(2)`
  at the payload boundary, matching the sibling forms exactly, and dropping
  the `totalAmount` payload key `ExpenseReportCreate` never accepted (dead
  weight, silently ignored server-side).
- **Documentation-only correction.** The first draft mischaracterized the
  `add_export_stream_status` migration: `status` is `nullable=False` (with a
  `server_default`), not nullable as stated, and the migration's
  table-existence guard is _required_, not optional — `finance_export_logs`
  is `create_all`-only (Pitfall #26), and CI runs `alembic upgrade head`
  against an empty database before `create_all` ever creates the table.
  Corrected above; the migration code itself was already right.

**FIN-15, found on a second Codex round against the fix PR (#1944) — the
significant one.** `create_approval_records` marks every step in a chain
PENDING immediately when the entity is submitted, not just the first —
including emailing an EMAIL-type step's token the moment the record is
created, regardless of that step's position in the chain. None of
`approve_step`/`deny_step`/`approve_by_token`/`deny_by_token` checked that
the record being acted on was the chain's _current_ step (the earliest
`step_order` record still `PENDING`) — only that its own status was
`PENDING`. A `get_current_pending_step` helper already existed to answer
exactly that question and was never called from any of the four action
paths — dead code sitting next to the gap it should have closed. Consequence:
a later-step approver (internal, by record id — exposed in entity detail
responses — or external, by the token emailed to them the same moment as
everyone else's) could approve or deny before an earlier step acted.
Approving out of order doesn't by itself finalize anything early (the
entity still needs every step non-pending), but denying does: `deny_step`/
`deny_by_token` finalize the whole entity immediately on a single denial,
so a later-step denial kills the request before earlier reviewers ever
weighed in — defeating the point of a sequential chain of custody entirely.
Fixed with a shared `_ensure_current_step` check (calls the existing
`get_current_pending_step`, raises `ValueError` — already mapped to 400 on
every one of the four endpoints — when the record isn't the current step),
wired into all four action paths, inside the same lock each already
acquired for FIN-10. Guarded by
`test_a_later_step_cannot_be_acted_on_before_an_earlier_one`
(`test_finance.py`, DB-backed, real multi-step chain) and
`test_token_action_rejects_a_later_step_out_of_order`
(`test_finance_approval_tokens.py`, mock-based, both token actions).

**FIN-16/17/18, found on a third Codex round against the FIN-15 fix PR
(#1946) — enforcing order surfaced two real deadlocks and one portability
gap the previous fix's own tests didn't cover.**

- **FIN-16 (deadlock).** `create_approval_records` never called any
  step-advancement logic at creation time — only `approve_step`/
  `approve_by_token` did, after a successful approval. A chain that starts
  with a NOTIFICATION step (or has one following only auto-approved steps)
  therefore left that notification `PENDING` forever: nothing ever marks it
  `SENT` except the very advancement call that only runs after an approval
  succeeds, and nothing can be approved because `get_current_pending_step`
  returns the stuck notification, which FIN-15's new order check correctly
  refuses to let the real approval step skip past. Before FIN-15 this
  "worked" only by accident — the missing order check let approvers step
  around the stuck notification. Fixed by calling step advancement once,
  immediately after creating a chain's records, so any step reachable from
  the start (not just step 1) is activated before the entity is ever
  returned to the caller.
- **FIN-17 (deadlock, token expiry).** Every EMAIL-type approval step's
  token was generated and emailed at chain creation, starting a 7-day
  expiry clock for all of them at once — including steps several positions
  down the chain. Combined with FIN-15's order enforcement, a step whose
  predecessors took a week or more to resolve could expire before it was
  ever reachable, with no resend path — the external approver could neither
  act early (blocked by order) nor act once it was their turn (token
  already expired). Fixed by deferring token generation and the invite
  email for an EMAIL approval step until it actually becomes reachable,
  exactly mirroring how a NOTIFICATION step's `SENT` transition already
  worked — the two are now one function, `_advance_reachable_steps`
  (renamed from `_advance_notification_steps`), called at chain creation
  and after every approval.
- **FIN-18 (portability).** Nothing stops two steps in one chain from
  sharing a `step_order` (no DB or schema constraint), and every record for
  one entity is created in the same instant, so a `step_order`+`created_at`
  tie is real. `get_pending_approvals`' own `has_earlier_pending_step`
  subquery already breaks such ties with the record `id`;
  `get_approval_records` (which both `get_current_pending_step` and
  `_advance_reachable_steps` read) did not, so on a database that doesn't
  happen to return tied rows in `id` order, FIN-15's check could reject the
  exact step the pending-approvals list told the user was actionable. Fixed
  by adding the same `id` tiebreaker to `get_approval_records`'s
  `order_by`. (Not independently reproducible against this dev database —
  MariaDB here happens to return the tie in primary-key order without an
  explicit tiebreaker — so the guard test asserts the correct, portable
  behavior rather than a locally-red-then-green diff.)

Guarded by `test_a_leading_notification_step_does_not_deadlock_the_chain`,
`test_email_step_token_is_issued_only_once_reachable`, and
`test_current_step_tiebreak_matches_the_pending_approvals_list` (all
`test_finance.py`, DB-backed).

**Read in full and independently re-verified by direct code read** (not
taken on an agent's word alone, and this pass's own miss above is exactly
why): `_mutate_budget` (`finance_service.py:2564`) — org-scoped,
`.with_for_update()` locking read on the budget row, with the over-budget
ceiling check computed from the locked row's fresh value (Pitfall #27
compliant). `get_pending_approvals` (`finance_service.py:871`) — rewritten
to a `union_all` "entities" CTE covering `PurchaseRequest`/`ExpenseReport`/
`CheckRequest`, each arm filtered on `organization_id == organization_id`
before the `UNION ALL`, then INNER JOINed to `ApprovalStepRecord` — no arm
can leak another org's pending approvals into the merged result.

Two background agents independently reviewed `finance_service.py`'s budget/
export logic and `finance.py`+`schemas.py`+`models.py` respectively; both
reported no findings. Codex's review, posted after this PR opened, is what
actually caught FIN-10 through FIN-14, then FIN-15 on a second round
against the fix PR, then FIN-16/17/18 on a third round against _that_ fix —
each round catching a real defect the previous fix's own review and tests
had not — all verified independently against the real code (reproduced
each schema TypeError directly, confirmed each missing lock/check/tiebreak
by reading the sibling methods that already had it right, confirmed the
frontend gap and the backend schema it feeds by reading both sides) before
fixing, not taken on the bot's word.

**9 real findings, all fixed; 1 documentation correction.** No open items.

**Completion gate (pass 2):** flake8/black/isort clean on `app/ tests/
alembic/`; `validate_migrations.py --strict` passed (383 revisions, single
head); scoped backend tests (`-k "finance or dues or approval or budget or
export"`) 246 passed, 1 skipped (pre-existing), 0 failed; full backend suite
9065 passed, 22 skipped (pre-existing), 0 failed.
`tsc --noEmit` 0 errors; `eslint src/modules/finance/` 0 errors; `vitest run
src/modules/finance/` 2 files, 80 tests, all passed. Each new guard test
confirmed to fail against the pre-fix code (`git stash` on the fix, re-run,
`git stash pop`) before being counted as covering its finding.

---

## Pass 1 (2026-08-25)

**Backend:** `api/v1/endpoints/finance.py` (66 routes), `services/finance_service.py`
(~2,000 L), `api/public/finance_approvals.py` (token-scoped approve/deny)
**Frontend:** `modules/finance`
**Migrations:** `20260801_0011` (per-org request numbering) alters existing
tables; `20260802_0001` (`dues_payments` ledger) creates one of the 15 finance
tables outright (conditionally — see Schema & migration notes). The other 14
are `create_all`-only.

---

## Scope

This is the most heavily audited module in the codebase before this iteration
even starts: module-audit iteration 20, four app-review passes
(2026-08-06/08/09 ×2), and the public token-approval routes were already
covered in full by security-review 03 (`PUB-03-public-surface-webhooks.md`,
PUB-4 fixed the `EMAIL`-approver self-approval gap there).

**Corrected (Codex review, PR #1809):** the original pass of this section
claimed "zero logic commits" to `finance_service.py` since the 2026-08-09
app-review, based on `git log --oneline -- <path>`. That claim was wrong, in
the same way AUTH-01 and SF-04 already documented this repo's rewritten
history can mislead a pathspec-filtered `git log` — a broader sweep (every
commit's full `--name-only` diff, not history-simplified per path) surfaces
two real logic commits that pathspec filtering missed: **`3dd2b28b`** (Aug 16,
"consume approval tokens atomically" — added `.with_for_update()` and
token-clearing to `approve_by_token`/`deny_by_token`) and **`d506246b`** (Aug
25, the PUB-03 self-approval guard, already accounted for above). Both are
real, targeted diffs (verified with `git show`, not the whole-file-rewrite
artifact that same sweep also turned up for an unrelated Aug 13 commit
touching this file — a squashed-history false positive, confirmed by its
diff being a 2,273-line "new file" for a file that already existed). Neither
changes this iteration's findings: the current code — which this iteration
read in full, not the commit history — already reflects both fixes, and
`approve_by_token`/`deny_by_token`'s locking and self-approval behavior were
read and verified as part of this pass's own `finance_service.py` review.
The corrected claim: **no logic commits to `finance_service.py` since Aug 16
other than the two named above and the 2026-08-25 LIKE-escaping variable
rename** — not "zero since Aug 9."

Given that, this iteration's job was **re-verification against current code**
plus the two checklist dimensions the prior passes gave the least explicit
weight to: dimension 6 (abuse resistance — unbounded queries, N+1) and
dimension 7 (schema & migration integrity). It found one live defect neither
prior pass's framing would have caught, because both described it in a way
that was subtly wrong (see FIN-9).

**Read in full:** `finance_service.py` end to end, focused on every method the
prior passes' open items reference (`_validate_finance_fks`,
`assert_different_person`, `list_member_dues`/`record_dues_payment`/
`waive_dues`/`unwaive_dues`, `get_pending_approvals`/`_get_entity_info`,
`_generate_request_number`/`_flush_with_unique_number`). All 66 route
decorators in `finance.py` enumerated for their `Depends`. `public/
finance_approvals.py` re-read but not re-derived — PUB-03 already covers it
in full; nothing has changed there since.

**Not re-read line-by-line:** the schema/response layer (`schemas/finance.py`)
beyond the enum-validator claim (FIN2-1), and the QuickBooks export-mapping
CRUD, which carries no money-movement or tenant-isolation risk beyond the
already-verified `finance.manage` gate + org scoping common to every by-id
route in the file.

## Route inventory

All 66 routes carry a `require_permission` dependency; none fall through to
bare `get_current_user`. Grouped rather than listed individually (the full
enumeration is mechanical — `grep -n '^@router\.' app/api/v1/endpoints/
finance.py` — and reproducible on demand):

| Group                                        | Routes | Permission                         | Org-scoped                   |
| -------------------------------------------- | -----: | ---------------------------------- | ---------------------------- |
| Fiscal years                                 |      6 | `.view` (read) / `.manage` (write) | ✅ every by-id op            |
| Budget categories                            |      4 | `.view` / `.manage`                | ✅                           |
| Budgets (+ summary)                          |      5 | `.view` / `.manage`                | ✅                           |
| Approval chains + steps                      |      8 | `.view` / `.configure_approvals`   | ✅                           |
| Approve/deny/pending                         |      3 | `.approve`                         | ✅ (chain-join; FIN-9 below) |
| Purchase requests + actions                  |      9 | `.view` / `.manage`                | ✅                           |
| Expense reports + line items                 |      8 | `.view` / `.manage`                | ✅                           |
| Check requests + actions                     |      8 | `.view` / `.manage`                | ✅                           |
| Dues schedules                               |      4 | `.view` / `.manage`                | ✅                           |
| Member dues + payments + waive/unwaive       |      7 | `.view` (self-scoped) / `.manage`  | ✅                           |
| QB export mappings + transaction export/logs |      5 | `.manage`                          | ✅                           |
| Dashboard                                    |      1 | `.view`                            | ✅                           |

The public token routes (`GET/POST /approvals/{token}`, `.../approve`,
`.../deny`) are out of this table — they carry no `Depends` by design (token
is the credential) and are the ones PUB-03 already audited: 256-bit token,
`.with_for_update()` locking read, own-org derived from the token, self-approval
now blocked for `EMAIL`-type approvers.

## Verified good ✅

- **Approval-step IDOR closed.** `approve_step`/`deny_step`/`get_pending_approvals`
  all resolve through org-scoped lookups; `test_approve_step_is_org_scoped`
  proves a step record from another org is unreachable (`ValueError: not
found`), not silently 200'd.
- **FIN-1/FIN-2 (budget/category/fiscal-year FK corruption) still closed.**
  `_validate_finance_fks` is unconditionally called at the top of every PR/CR/
  expense-report/budget/dues-schedule create+update (13 call sites, grepped),
  and the three budget write-helpers (`_encumber_budget`, `_release_encumbrance`,
  `_add_to_spent`) still take and filter `org_id` as defense in depth.
- **FIN-3 dues self-scoping still holds.** `GET /dues` and `GET /dues/{id}/payments`
  both override a foreign `user_id`/apply a `viewer_user_id` filter unless the
  caller holds `finance.manage` (`finance.py:1272`, `:1318`).
- **FIN-4 disburse-side SoD still holds.** `waive_dues` calls
  `assert_different_person(waived_by, dues.user_id, ...)`
  (`finance_service.py:1952`); `mark_pr_paid`/`mark_expense_paid`/`issue_check`
  carry the same guard per the 2026-08-09 app-review pass, re-confirmed present.
- **FIN-6 dues-payment ledger still holds.** `record_dues_payment` re-derives
  `amount_paid` from the ledger via `_apply_payment_totals`, refuses payment
  against `WAIVED`/`EXEMPT` (`finance_service.py:1878`), and dedups on
  `transaction_reference` (`:1885`) rather than raising — confirmed idempotent
  on a retried submission.
- **No SQL injection; CSV export uses `SafeCsvWriter`.** The one `.like()`
  (`_generate_request_number`) takes a system-generated prefix, not client
  input, and now declares `escape=LIKE_ESCAPE_CHAR` like every other call site
  in the app (SEC-00). `export_transactions` imports and uses `SafeCsvWriter`
  (`finance_service.py:2121`) — no raw `csv.writer` anywhere in the file.
- **Errors sanitized.** Every endpoint's `except` routes through
  `safe_error_detail()`.
- **`isort`/`black`/`flake8` clean; migration chain single-headed** (356
  revisions, head `a7c93f21d5b8`).

## Findings

### FIN-9 — MED — `get_pending_approvals` scanned every tenant's pending steps, not just the caller's org — ✅ FIXED

**What:** the query behind `GET /finance/approvals/pending` carried **no
organization filter at all**:

```python
result = await self.db.execute(
    select(ApprovalStepRecord)
    .options(selectinload(ApprovalStepRecord.step))
    .where(ApprovalStepRecord.status == ApprovalStepStatus.PENDING)
)
```

Both prior passes' notes describe this as returning "the org-wide queue rather
than the caller's assigned steps" — which reads as _scoped to the org, just
not to the assignee_. The actual scope was platform-wide: every organization's
pending purchase-request/expense-report/check-request approval steps, every
time any org's approver opened their approvals inbox.

**Where:** `backend/app/services/finance_service.py:810` (`get_pending_approvals`).

**Failure scenario:** the loop that follows issues **two more queries per
pending record** — `_get_entity_info` (org-scoped, so it silently discards
anything not belonging to the caller's org) and `get_current_pending_step`
(not org-scoped either, walks the same chain again). None of this leaked data
— `_get_entity_info`'s own `organization_id` filter meant a foreign record
was always filtered out of the final response — but the cost of computing
that response scaled with the **total number of pending approval steps on the
entire platform**, not the caller's own organization. A single department
with a handful of pending purchase requests pays a query cost proportional to
every other department's pending queue combined, on every poll of an
approvals inbox. This is exactly checklist dimension 6's "no `all()` over an
org-wide table, no N+1 loop issuing a query per row" — except worse than
org-wide, since there was no org boundary at all on the first query.

**Impact:** availability/performance, not confidentiality — no cross-tenant
data was ever returned. Severity is MED rather than LOW because it is a
platform-wide amplification factor on a page every finance-approver in every
tenant loads routinely, and the amplification grows with the platform's total
transaction volume rather than any single org's.

**Fix:** filter the `ApprovalStepRecord` query itself to only the caller's
organization's entities, via a correlated subquery per entity type
(`entity_id.in_(select(PurchaseRequest.id).where(organization_id == org_id))`,
and the same shape for expense reports and check requests) rather than a bare
status filter. The database resolves and filters these against its own
indexes in one query plan; nothing is materialized into Python first (an
initial version of this fix did fetch each id set into a Python list before
filtering — a Codex review comment on the PR caught that this repeats the
same "no `all()` over an org-wide table" problem at one remove for a
long-lived org with a large request history, and it was rewritten to the
subquery form). Output is identical to before — those ids are exactly what
`_get_entity_info` was already implicitly filtering to one row at a time —
only the scan and the N+1 follow-up queries are now confined to the caller's
own organization, proven by
`test_get_pending_approvals_is_confined_to_the_caller_org`.

## Schema & migration notes

**Corrected (Codex review, PR #1809):** the original pass of this section
miscounted the module's tables (said 12, listed 15) and, worse, called all of
them `create_all`-only — wrong for `dues_payments`, which
`alembic/versions/20260802_0001_add_dues_payments_ledger.py` explicitly
`create_table`s. My grep for the class-wide sweep matched only
`create_table\(\s*["']name["']` on one line, and that migration puts the
table-name string argument on the line _after_ `op.create_table(`, so it was
missed the same mechanical way SEC-00 warns a copy-pasted, un-owned check can
fail quietly.

Of the 15 finance tables (`fiscal_years`, `budget_categories`, `budgets`,
`approval_chains`, `approval_chain_steps`, `approval_step_records`,
`purchase_requests`, `expense_reports`, `expense_line_items`,
`check_requests`, `dues_schedules`, `member_dues`, `dues_payments`,
`export_mappings`, `export_logs`):

- **14 are `create_all`-only** — no migration creates them, matching SEC-00's
  documented, deliberate deployment shape (37 model-only tables
  platform-wide). Not a finding.
- **`dues_payments` is conditionally migration-created.** `20260802_0001`
  creates the table and backfills one row per already-paid `member_dues`
  record — but only when `member_dues` already exists at migration time (an
  established install upgrading through this revision); on a fresh database,
  where `member_dues` doesn't exist yet either, the migration no-ops
  (`if not has_table("member_dues"): return`) and `create_all` builds
  `dues_payments` from the model instead, same as its 14 siblings. This is
  the CLAUDE.md Pitfall #26 pattern (a migration must tolerate a table only
  `create_all` builds) applied correctly, not a defect — but the table is not
  uniformly "`create_all`-only" the way the other 14 are, and describing it
  that way risks a future migration treating it as never-migration-managed
  when an established install's `dues_payments` in fact came from this
  revision.

Every `ondelete="SET NULL"` FK in `models/finance.py` (12 sites: budget
category on budget, facility on budget, email-template on approval step,
budget on PR/CR/expense-line, approver on PR/CR/expense-report,
fiscal-year on dues-schedule, waived-by/recorded-by on member-dues/
dues-payment) is paired with `nullable=True` — verified line-by-line, not
merely by the codebase-wide SEC-00 sweep.

## Guard tests added

- `test_get_pending_approvals_is_confined_to_the_caller_org`
  (`tests/test_finance.py`) — creates a pending purchase-request approval step
  in each of two organizations and calls `get_pending_approvals(org_id=A)`.
  Asserts two things, not one: (1) the returned list contains org A's entity
  id and not org B's, and (2) — the part that actually detects a regression
  to the unfiltered query — a spy wrapped around `_get_entity_info` never
  receives org B's entity id at all. A first version of this test asserted
  only (1), which a Codex review comment on the PR correctly pointed out
  would pass against the pre-fix code too, since `_get_entity_info`'s own org
  filter already kept the foreign entity out of the _response_ — it just
  didn't stop the query from scanning it. The spy proves the record-level
  query itself is org-confined, which is what FIN-9 actually fixed.

## Completion gate

| Check                                                       | Result                                                       |
| ----------------------------------------------------------- | ------------------------------------------------------------ |
| `flake8 app/ tests/ alembic/`                               | ✅ 0 violations                                              |
| `black --check app/ tests/ alembic/`                        | ✅ (1 file reformatted before commit, then clean)            |
| `isort --check-only app/ tests/ alembic/` (8.0.1, CI's pin) | ✅ clean                                                     |
| `validate_migrations.py --strict`                           | ✅ 356 revisions, single head                                |
| `pytest tests/test_finance.py`                              | ✅ 31 passed                                                 |
| `pytest tests/ -k "finance or dues or approval"`            | ✅ 166 passed, 1 skipped (unrelated `py_vapid` optional dep) |
| `tsc --noEmit`                                              | ✅ 0 errors (no frontend file changed)                       |
| `eslint .`                                                  | ✅ 0 errors/warnings (no frontend file changed)              |
