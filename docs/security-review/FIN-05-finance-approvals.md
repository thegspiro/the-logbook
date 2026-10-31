# Security Review 05 — Finance & Approvals

**Prefix:** `FIN` · **Iteration:** 05 · **Reviewed:** 2026-08-25 (pass 1), 2026-08-27 (pass 2), 2026-09-02 (pass 3), 2026-09-08 (pass 4), 2026-09-14 (pass 5), 2026-09-15 (pass 6), 2026-10-05 (pass 7), 2026-10-12 (pass 8), 2026-10-14 (pass 9, [#3225](https://github.com/thegspiro/the-logbook/pull/3225)), 2026-10-18 (pass 10), 2026-10-22 (pass 11), 2026-10-25 (pass 12), 2026-10-28 (pass 13), 2026-10-31 (pass 14) · **PR:** [#1809](https://github.com/thegspiro/the-logbook/pull/1809) (pass 1)

---

## Pass 14 (2026-10-31) — watchdog pickup: true near-zero delta (an unbounded-refusal cap fix to one `ValueError`, pure frontend layout refactors), 0 fixed, 0 new findings

**Scope.** Pass 13 merged as `dd47d8734` (PR #3807). `git diff --stat
dd47d8734..HEAD` over this feature's full established scope
(`endpoints/finance.py`, `finance_service.py`,
`finance_budget_request_service.py`, `finance_budget_access.py`,
`finance_report_service.py`, `finance_reimbursement.py`,
`schemas/finance.py`, `models/finance.py`, `public/finance_approvals.py`,
`frontend/src/modules/finance/`) touches exactly **2** files:
`finance_service.py` (+10/-3) and 15 frontend files (+63/-85, mostly
layout). `endpoints/finance.py`, `finance_budget_request_service.py`,
`finance_budget_access.py`, `finance_report_service.py`,
`finance_reimbursement.py`, `schemas/finance.py`, `models/finance.py` and
`public/finance_approvals.py` are all confirmed byte-identical to pass 13
(`git diff --stat` empty for each, checked individually rather than
trusting the combined stat). No migration in this window touches a
finance table — the one migration whose text matches a finance keyword
(`d8f1a4c27b93`, "positions.kind, and the four seeded committee
positions") only copies the pre-existing baseline `member` permission
list — which already included `finance.request` before this migration,
confirmed by its own comment and by `core/permissions.py:1442` — onto four
new committee positions; it is PERM-02's territory (seeded baseline
grants), not a change to anything Finance & approvals owns, and grants
nothing new.

**The one backend change, read in full:** `finance_service.py`'s inactive-
budget-category refusal (`_assert_category_takes_new_lines`'s `ValueError`)
switched from joining every blocked category's name into the message by
hand to building it with `list_within_detail_limit` (`core/utils.py:75`),
part of a same-day sweep that capped three such refusals across unrelated
services (`530edfc18`, "Cap three more refusals that list data through a
variable"). This is a correctness/availability fix, not a new exposure: an
org with enough inactive categories named in one request used to produce a
message longer than `MAX_ERROR_DETAIL_LENGTH`, which `safe_error_detail`
then discards entirely in favor of the generic "An unexpected error
occurred" — turning a legible 400 into an opaque one for the admin who hit
it. `list_within_detail_limit` keeps the message under the cap by
truncating to "and N more" rather than dropping it, and never exceeds the
cap itself, so it cannot reopen that same discard path. The category names
it lists come from `BudgetCategory.name` rows already resolved through the
org-scoped `CategoryTree` (unchanged ten lines above this edit), so nothing
newly unauthorized is echoed back — the admin already has permission to see
every category name in their own org's budget tree.

**The frontend changes, read in full:** 15 files replace a locally-defined
`KpiCard`/ad-hoc stat grid with the shared `KpiTile`/`StatGrid` components
(`FinanceDashboardPage.tsx`), and switch ~10 hand-rolled
`flex flex-col sm:flex-row sm:justify-between` headers/rows to the shared
`split-row`/`page-header` utilities across the Budgets, Dues, Check
Requests, Expense Reports, Purchase Requests, Fiscal Year Settings, QuickBooks
Export Settings, Approval Chains Settings and Manual Approval Panel screens
— all part of the repo-wide layout sweeps (`ab879fc7d`, `cf8fdae30`,
`06dec4a13`, `18e105b48`) reviewed under their own commits. None changes a
data fetch, a permission check, or what is rendered beyond CSS/markup
shape; no new axios instance, no new endpoint call, no new user input.
`restrictedFunds.test.tsx`'s own +4/-0 is a mock addition
(`approvalChainService: { routePreview: ... }`) needed only because an
unrelated feature's commit (`92ec254c3`, prospective-members case
managers) now trips the request form's debounced route-preview call under
load in that one test file — not a finance behavior change.

**Route count.** `finance.py` re-enumerated fresh by AST (not taken from
the diff): **136 routes**, unchanged from pass 11/12/13. Every one still
carries an explicit auth dependency in its signature (`Depends(...)`
containing `get_current_user` or a permission check), confirmed
programmatically with no false negatives. `public/finance_approvals.py`
re-enumerated the same way: **3 routes**
(`get_approval_detail`/`approve_via_token`/`deny_via_token`), unchanged,
file byte-identical to pass 13 so their token-scoped fail-closed behavior
(verified in earlier passes) carries forward unchanged.

**Standing items re-verified by direct read, both unchanged:**

- **FIN8-05-1 — stays ✅ FIXED.** `finance_budget_request_service.py:679`
  (`decide_request`) still carries the `BudgetRequestForbiddenError` guard
  comparing `request.submitted_by`/`_acts_as_owner` against `decided_by`,
  placed after the stage/status checks and before any mutation, matching
  `review_request`'s shape. Also re-confirmed: `waive_dues`
  (`finance_service.py:6938`) still takes the row lock
  (`.with_for_update()`) before its `assert_different_person` (FIN-4)
  check, and still refuses a second waiver of an already-`WAIVED` record
  rather than silently overwriting who waived it — both shipped in pass
  13's window and unchanged since.
- **FIN-30 (LOW) — still an accepted owner decision, not a live gap.**
  `list_dues_payments` (`finance_service.py:6918`, unchanged body) still
  takes no `.offset()`/`.limit()`; `docs/KNOWN_LIMITATIONS.md`'s
  2026-10-05 owner decision to leave it unpaginated still matches the code
  and needs no update.

**Not security-relevant, confirmed by reading each commit in the window
touching this scope:** the four layout-sweep commits above and the one
test-mock commit — none changes auth, tenancy, data exposure or abuse
resistance for this feature.

**0 fixed this pass** (no finding of this review's own needed fixing —
the refusal-cap change was already correct when it landed), **0 new
findings.**

### Completion gate (pass 14)

| Check                                                                                                                                                              | Result                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.4.1, CI's pin)                                                                                                                    | clean                                                                                                                   |
| `black --check app/ tests/ alembic/` (26.10.1, CI's pin)                                                                                                           | clean, 2757 files unchanged                                                                                             |
| `isort --check-only app/ tests/ alembic/` (9.0.2, CI's pin)                                                                                                        | clean                                                                                                                   |
| `scripts/validate_migrations.py --strict`                                                                                                                          | passed, 680 revisions, single head `3fbd0fe30e5b`                                                                       |
| `scripts/check_route_permissions.py --strict` (repo root)                                                                                                          | 281 routes, 0 errors, 0 warnings                                                                                        |
| `pytest tests/ -k "finance or budget_request or approval_chain or dues or reimburs or quickbooks or waive"` (no `-m` exclusion — this sandbox has a live database) | 1,562 passed, 2 skipped (both environment-only: `pywebpush`, and a time-zone-table fixture unavailable in this sandbox) |
| `frontend: npm run typecheck`                                                                                                                                      | 0 errors                                                                                                                |
| `frontend: npm run lint`                                                                                                                                           | 0 errors, 0 warnings                                                                                                    |

---

## Pass 13 (2026-10-28) — watchdog pickup: real delta (FIN8-05-1's fix shipped, a dues-waiver race/repeat-waiver fix, email/PII encryption reaching `payee_address` and `notification_emails`), 0 fixed this pass, 0 new findings

**Scope.** Pass 12 merged as `0a21b5c5`. `git diff --numstat 0a21b5c5..HEAD`
over this feature's established scope (`endpoints/finance.py`,
`finance_service.py`, `finance_budget_request_service.py`,
`finance_budget_access.py`, `finance_report_service.py`,
`finance_reimbursement.py`, `finance_settings.py`, `schemas/finance.py`,
`models/finance.py`, `public/finance_approvals.py`,
`frontend/src/modules/finance/`) shows a near-zero real delta: 3
insertions/2 deletions in `models/finance.py`, 13/0 in
`finance_budget_request_service.py`, 11/1 in `finance_service.py`, and a
5-line addition to one frontend test file (`amountLimits.test.tsx`). Every
other file in scope — `finance.py`, `public/finance_approvals.py`,
`finance_report_service.py`, `finance_reimbursement.py`,
`finance_settings.py`, `finance_budget_access.py`, `schemas/finance.py` —
is confirmed byte-identical to pass 12 (`git diff --stat` returns nothing
for each). Route count re-enumerated by AST: **136**, unchanged from pass 12.

**What's new, read in full rather than taken on the diff's framing:**

- **FIN8-05-1 (MED) is now fixed in code, not just recorded as fixed.**
  Pass 12's note already said the owner shipped this 2026-10-26; this pass
  confirms the actual commit (`49994b9c`, within this window) is the fix
  `FinanceBudgetRequestService.decide_request` now carries:
  ```python
  if str(request.submitted_by or "") == str(decided_by) or (
      await self._acts_as_owner(request, org_id, decided_by)
  ):
      raise BudgetRequestForbiddenError(...)
  ```
  placed immediately after the existing stage/status checks, before any
  mutation — the same shape `review_request` already used. No exception
  for a one-person department, matching the owner's stated FIN-4 decision.
  Already marked resolved in `KNOWN_LIMITATIONS.md` (the FIN8-05-1 section,
  resolved 2026-10-26); nothing to update there.
- **`waive_dues` now locks the row and refuses a repeat waiver**
  (`finance_service.py:6820`, commit `84073154`, "refuse a repeat waiver
  instead of replacing the first"). The read is now `.with_for_update()`
  before the existing `assert_different_person` (FIN-4) check, so two
  officers waiving the same dues record concurrently serialize instead of
  racing (Pitfall #27's shape); and a second `waive_dues` call against an
  already-`WAIVED` record now raises `ValueError` rather than silently
  overwriting who waived it, when and why — the correct fix is
  `unwaive_dues` first, which already existed and is unaffected. Confirmed
  by direct read: the new `if dues.status == DuesStatus.WAIVED: raise
ValueError(...)` sits after the lock and the SoD check, so it cannot be
  raced past.
- **App-wide email/PII-at-rest encryption reaches this feature**
  (`ApprovalChainStep.notification_emails` → `EncryptedJSON`,
  `CheckRequest.payee_address` → `EncryptedText`; migrations
  `b8236e29ec44` and `5510d5ff49eb`, reviewed under their own Core
  infrastructure rotation slot). Verified correctly applied here: neither
  column is read through `ilike`/`LIKE` anywhere in `finance_service.py`
  or `finance.py` (grepped both patterns, zero matches), so encrypting
  them breaks no search path; `notification_emails` is only ever
  round-tripped through the existing Pydantic schema fields
  (`schemas/finance.py:863/889/910`), which the SQLAlchemy-level
  `EncryptedJSON` type decrypts/encrypts transparently — no service code
  needed to change. Neither column needed a fingerprint column (no
  hash-based lookup exists for either), consistent with the pattern
  `payer_email`-style write-only ciphertext columns already use elsewhere.

**Standing items re-verified:**

- **FIN8-05-1 — ✅ FIXED**, see above — closes out what pass 12 had
  flagged as fixed-but-unconfirmed.
- **FIN-30 (LOW) — still an accepted owner decision, not a live gap.**
  `list_dues_payments` (`finance_service.py:6796`, unchanged body,
  confirmed by direct read) still takes no `.offset()`/`.limit()`.
  `KNOWN_LIMITATIONS.md` already records the owner's 2026-10-05 decision
  to leave this as-is (one member's dues ledger is small); re-verified
  that decision still matches the code and needs no update.

**Not security-relevant, confirmed by reading the one other commit in the
window's full log:** none — every non-merge commit touching this scope is
one of the three described above.

**0 fixed this pass** (both fixes above shipped in the owner's own prior
commits, outside this review), **0 new findings.**

### Completion gate (pass 13)

| Check                                                                                                                                                                                                                                           | Result                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.4.1, CI's pin)                                                                                                                                                                                                 | clean                                                 |
| `black --check app/ tests/ alembic/` (26.10.1, CI's pin)                                                                                                                                                                                        | clean, 2706 files unchanged                           |
| `isort --check-only app/ tests/ alembic/` (9.0.2, CI's pin)                                                                                                                                                                                     | clean                                                 |
| `scripts/validate_migrations.py --strict`                                                                                                                                                                                                       | passed, 666 revisions, single head `0d9897752425`     |
| `scripts/check_route_permissions.py --strict` (repo root)                                                                                                                                                                                       | 279 routes, 0 errors, 0 warnings                      |
| `pytest -k "finance or budget_request or approval_chain or dues or reimburs or quickbooks or waive"` (unit)                                                                                                                                     | 670 passed, 1 skipped (environment-only: `pywebpush`) |
| Standing guard suites (org-scoping ratchet, capacity locking, CSV sweep, LIKE escaping, `create_all`-table tolerance, baseline member grants, account-status gates, encryption-registry coverage, email-fingerprint, rotate-email-fingerprints) | 186 passed                                            |
| `frontend: npm run typecheck`                                                                                                                                                                                                                   | 0 errors                                              |
| `frontend: npm run lint`                                                                                                                                                                                                                        | 0 errors, 0 warnings                                  |

---

**Scope.** Pass 11 merged as `f9909b70` (PR #3562). `git diff f9909b70..HEAD`
over this feature's full established scope (`endpoints/finance.py`,
`finance_service.py`, `finance_budget_request_service.py`,
`finance_budget_access.py`, `finance_report_service.py`,
`finance_reimbursement.py` (new file), `finance_settings.py`,
`schemas/finance.py`, `models/finance.py`, `public/finance_approvals.py`,
`frontend/src/modules/finance/`) shows **1,885 insertions / 160 deletions**
across 8 backend files plus a 2,385-insertion frontend delta across 27
files — not a near-zero-delta pass. 13 non-merge commits touch this scope;
each read in full rather than taken on its message. `public/finance_approvals.py`
is confirmed byte-identical to pass 11 (`git diff` on that one path alone
returns no lines).

**What's new, by area:**

- **Purchase -> expense report -> reimbursement check** (new module
  `app/services/finance_reimbursement.py`, 163 lines, plus ~450 combined
  lines across `finance.py`/`finance_service.py`/`schemas/finance.py`/
  `models/finance.py`, migration `4250eb8b8378`): lets a member who bought
  an approved purchase with their own money claim it back. Three new routes,
  all read in full against the checklist:
  - `POST /purchase-requests/{pr_id}/reimbursement-report` —
    `finance.request`/`finance.manage`, but the service additionally
    requires `pr.requested_by == caller_id` regardless of grant (even a
    `finance.manage` holder cannot raise this for someone else — "the report
    pays whoever submits it"). The purchase is resolved org-scoped and
    locked (`lock_purchase`) before any check.
  - `POST /expense-reports/{er_id}/reimbursement-check` — `finance.manage`
    only. Builds the check payable to the _report's_ submitter
    (`er.submitted_by`), not the caller, so the pre-existing `finance.manage`
    holder issuing/raising it is never the same identity the SoD checks at
    `issue_check`/`approve_step` compare against unless they happen to be the
    same person — in which case the existing `assert_different_person`
    guards (unchanged by this pass) already block them from approving or
    issuing their own check, exactly as for any other check request.
  - `GET /approval-chains/route-preview` — OR-gated
    `finance.request`/`finance.view`/`finance.manage`; returns only step
    names/order/auto-approve state via the existing `describe_assignee`
    (never raw approver configuration — same redaction `preview_approval_chain`
    already uses), and is proven to agree with what submission would actually
    do by sharing `_request_chain` with `submit_purchase_request`/
    `submit_expense_report`/`submit_check_request` (closes the CLAUDE.md
    Pitfall #29 class — a preview and the real decision computed twice would
    drift).
  - Money/state invariants verified by direct read, not inferred from names:
    `live_report_for_purchase`/`live_check_for_report`/`lock_purchase` are all
    org-scoped, locking reads (Pitfall #27); `_refuse_while_claimed` is called
    from both `mark_pr_paid` and `cancel_purchase_request` so a purchase a
    submitted report already claims cannot be paid or cancelled out from under
    it; `_settle_report`/`_unsettle_report` release/restore the purchase's
    encumbrance in the same budget mutation as the line spend, so a
    near-full budget line is not spuriously refused for counting both
    halves at once; `_lock_reimbursed_report` documents and takes the
    report-then-check lock order `request_reimbursement_check`/
    `mark_expense_paid` also use, so `issue_check`/`void_check` cannot
    deadlock against them; `qb_export_entry` (new JSON column on
    `CheckRequest`) is written whole via a bulk `update(...).values(...)`
    (`finance_service.py:8212`, comment citing Pitfall #12 explicitly), never
    read-mutated-reassigned.
  - `_refuse_reimbursement_changes` (on `update_check_request`) refuses a
    budget/fund/amount change on a reimbursement check — it pays exactly what
    its report owes, so those fields are fixed at creation; `update_check_request`
    itself is unchanged (still OR-gated `finance.request`/`finance.manage`
    with `restrict_to_user` scoping), so the report's own submitter editing
    the check's `payee_address`/`memo` while it is draft/submitted is the
    same pre-existing self-service edit any check requester already has, not
    a new exposure.
- **Draft editing, withdrawal and cancellation** (`update_expense_line_item`/
  `delete_expense_line_item`/`cancel_expense_report`/`cancel_check_request`,
  all new routes): every one resolves its target through the existing
  org-scoped, `restrict_to_user`-aware `get_expense_report`/`get_check_request`
  with `for_update=True` before acting, so a non-manager can reach only their
  own record (confirmed by direct read of `_draft_line`, `cancel_expense_report`,
  `cancel_check_request`); line edits/deletes are refused once the report
  leaves `DRAFT`; cancellation is refused once a live reimbursement check or
  report claims the entity being cancelled (same `_refuse_while_claimed`/
  `live_check_for_report` guard as above).
- **Budget-category deactivation now closes sub-categories, not just the
  category itself** (`CategoryTree.inactive_source`/`is_effectively_active`
  in `finance_budget_access.py`; consumed by `assert_category_takes_new_lines`,
  `_assert_budget_open_for_new_charges`, `start_from_last_year`, and the
  budget-request proposal-options/category list) — a correctness tightening
  of an existing control, not a new one; every query behind it remains
  `organization_id`-filtered (`load_category_tree`), confirmed by direct read
  rather than taken on the diff's own framing.
- **Reporting fixes** (`finance_report_service.py`, +180/-16): a report paid
  by a reimbursement check (rather than `mark_expense_paid`) is now counted
  in the payments register and functional-expense report when its check is
  issued, and reversed when voided, via a new `_paid_by_check` EXISTS-subquery
  and `_reports`/`report_parts` helpers — every added query filters
  `organization_id`, confirmed by direct read of all four new/changed query
  sites.
- **Frontend** (27 files, +2,385/-177, including two new test files —
  `reimbursementFlow.test.tsx` 309 lines, `draftWithdrawal.test.tsx` 339
  lines): wires the above through the existing shared module `api` axios
  instance (`services/api.ts` — confirmed no new axios instance created,
  Pitfall #7 n/a) and the existing route-preview/reimbursement endpoints; no
  new backend trust boundary.

**Not security-relevant, confirmed by reading each commit:** 1 layout-only
commit (`ce094e7b9`, icon/label alignment on the expense line "Add line"
button) and 1 CI-fix-after-merge commit (`39dc1e537`, no logic change beyond
what the two feature commits it follows already introduced).

**Migration.** One migration landed this window, read in full:
`4250eb8b8378` — adds `purchase_requests.status = 'reimbursed'`,
`expense_reports.purchase_request_id` (`SET NULL`, `nullable=True` —
Pitfall #2), `check_requests.expense_report_id` (`SET NULL`,
`nullable=True`, `use_alter=True` since the two tables now reference each
other both ways), and `check_requests.qb_export_entry` (JSON). Every step is
guarded on `_has_table(...)` first (Pitfall #26 — all three tables are
`create_all`-built). The downgrade folds any `reimbursed` row back to `paid`
and says in its own docstring what is lost (which report/check paid it) —
an irreversible backfill whose cost is stated up front, per Pitfall #20's
corollary. No seeded-grant or other JSON-column change.

**Route count.** `finance.py` enumerated fresh by AST: **136 routes**
(up from 124 at pass 9/10/11's unchanged count — 7 new routes this pass:
the 3 reimbursement-path routes, `update_expense_line_item`,
`delete_expense_line_item`, `cancel_expense_report`, `cancel_check_request`).
Every one of the 136 carries an explicit auth dependency (`get_current_user`
or a `require_permission`/`require_all_permissions` call), checked
programmatically — zero false negatives after correcting an initial
substring-matching script bug (the `Depends(\n    require_permission(...)\n)`
line-wrap shape was being missed by a naive adjacent-text check; re-run with
a corrected check confirms all 136). `public/finance_approvals.py` unchanged
at 3 routes, byte-identical to pass 11.

**Standing items re-verified, both unchanged (neither touched by this
window's delta):**

- **FIN8-05-1 (MED) — ✅ FIXED 2026-10-26 (owner-directed, after this pass).**
  `decide_request` now refuses a decider who submitted the request or owns its line
  (`BudgetRequestForbiddenError`, 403), the same guard `review_request` applies; no
  exception for a one-person department. Pass 12's text as found, still OPEN (flagged):
  `finance_budget_request_service.py`'s `decide_request` (now line 659,
  shifted from 635/660 by this window's unrelated insertions, confirmed same
  body by direct read) still has no `assert_different_person` check, unlike
  `review_request`.
- **FIN-30 (LOW) — still FLAGGED.** `list_dues_payments`
  (`finance_service.py:6796`, shifted from `:6116`, confirmed same body by
  direct read) still takes no limit/offset.

**0 fixed, 0 new findings.**

### Completion gate (pass 12)

| Check                                                                                                                                                               | Result                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.4.1, CI's pin)                                                                                                                     | clean                                                                                                                   |
| `black --check app/ tests/ alembic/` (26.10.1, CI's pin)                                                                                                            | clean, 2642 files unchanged                                                                                             |
| `isort --check-only app/ tests/ alembic/` (9.0.2, CI's pin)                                                                                                         | clean                                                                                                                   |
| `validate_migrations.py --strict`                                                                                                                                   | passed, 652 revisions, single head `3f2593e8071e`                                                                       |
| `check_route_permissions.py --strict` (repo root)                                                                                                                   | 276 routes, 0 errors, 0 warnings                                                                                        |
| `generate_schema_docs.py` re-run                                                                                                                                    | zero diff against committed `docs/DATABASE_SCHEMA.md`                                                                   |
| `pytest -k "finance or budget_request or approval_chain or dues or reimburs or quickbooks"` (unit)                                                                  | 1,336 passed, 2 skipped (both environment-only: `pywebpush`, and a time-zone-table fixture unavailable in this sandbox) |
| Standing guard suites (org-scoping ratchet, capacity locking, CSV sweep, LIKE escaping, `create_all`-table tolerance, baseline member grants, account-status gates) | 171 passed                                                                                                              |
| `frontend: npm run typecheck`                                                                                                                                       | 0 errors                                                                                                                |
| `frontend: npm run lint`                                                                                                                                            | 0 errors, 0 warnings                                                                                                    |

---

## Pass 11 (2026-10-22) — watchdog pickup: real delta (QuickBooks chart-of-accounts upload, reimport confirmation, approval-chain range validation, an approve/cancel race fix), 0 fixed, 0 new findings; FIN8-05-1 and FIN-30 re-confirmed open

**Scope.** Pass 10 merged as `765f79f5` (PR #3401). `git log --no-merges
765f79f5..HEAD` over this feature's files (`finance.py`, `finance_service.py`,
`finance_budget_request_service.py`, `finance_settings.py`,
`schemas/finance.py`, `models/finance.py`, `public/finance_approvals.py`,
`frontend/src/modules/finance/`): 26 non-merge commits — a substantially
larger window than recent near-zero-delta passes, read in full rather than
spot-checked. `public/finance_approvals.py` and `finance_settings.py` are
byte-identical to pass 10 (confirmed by `git diff --stat`); the public,
token-scoped email-approval surface is unchanged.

**Backend delta, by area:**

- **Numeric-bounds hardening** (`74638250`, repo-wide) — adds `max_digits=12`
  to every finance money `Decimal` field (matching the `Numeric(12,2)`
  columns) and `le=INT32_MAX` / `ge=INT32_MIN` to integer fields
  (`sort_order`, `step_order`, `grace_period_days`). Strictly tightens
  existing `gt=0`/`ge=0` fields — nothing widened. Already covered by its own
  repo-wide guard test.
- **QuickBooks chart-of-accounts upload** (new feature, `finance.py` +
  `finance_service.py` + `models/finance.py` + migration
  `a33ffa561e4f`) — a new `QuickBooksChartAccount` model/table and three
  endpoints (`GET`/`POST`/`DELETE /finance/export/chart-of-accounts`), all
  gated `finance.manage`, all org-scoped (`organization_id` filtered on every
  query; `replace_chart_of_accounts`/`clear_chart_of_accounts` take the
  existing `lock_organization_scope(..., QUICKBOOKS_EXPORT)` lock). Upload
  hardening verified directly: `read_upload_limited` caps the file at 5 MB
  before parsing; `reject_if_malicious` (the repo's existing upload-scanning
  service) runs before any parse; `parse_chart_of_accounts`
  (`app/utils/quickbooks_chart.py`) caps rows read (20,000), accounts kept
  (5,000) and per-name length (255, matching the column), and reads `.xlsx`
  via `openpyxl` with `defusedxml` installed (confirmed pinned in
  `requirements.txt`) — no XXE/zip-bomb-via-entity-expansion surface. Account
  names are compared for export-safety via the pre-existing
  `csv_safe_cell`/`SafeCsvWriter` formula-injection guard
  (`_unsafe_account_name`), not re-implemented. New model's one
  `ondelete="SET NULL"` FK (`uploaded_by`) is `nullable=True` (Pitfall #2);
  `organization_id` is `CASCADE`+`NOT NULL`. The migration is
  `create_all`-tolerant (Pitfall #26) for the pre-existing `finance_export_logs`
  table it also alters.
- **Reimport confirmation** (`ExportLog.imported_at`/`imported_by`,
  `confirm_export_imported`/`withdraw_export_imported`,
  `ReimportConfirmationRequired`) — lets the Treasurer record that an export's
  file was actually imported into QuickBooks, and refuses (409) a resend of
  those same payments unless `confirm_reimport` is set. Every new query
  (`_export_log`, `_export_log_rows`, `_count_confirmed_imported`) filters
  `organization_id`; the new FK is `nullable=True` SET NULL. Both endpoints
  are `finance.manage`-gated and audit-logged
  (`finance.export_import_confirmed`/`_withdrawn`).
- **Approval-chain range validation** (`20d5e337`,
  `ApprovalChainCreate`/`Update` + `update_approval_chain`) — refuses
  `min_amount > max_amount` at both the schema and service layer (a change to
  only one end is checked against the other end as stored). `pick_approval_chain`
  (extracted, same logic, now unit-tested in isolation) keeps both range ends
  inclusive and breaks ties by chain id, closing an ambiguity at the exact
  boundary between two chains rather than changing it.
- **Approve/cancel race fix** (`_lock_entity_awaiting_approval`,
  `_finalize_approval`'s added `entity.status != pending_status` check,
  `cancel_purchase_request`'s added `_terminate_entity_pending_steps` call) —
  a genuine correctness/integrity fix, not a regression: a request cancelled
  before its chain closed still carried PENDING step records, so approving
  the last one could finalize a cancelled/denied request as APPROVED and
  encumber budget against it. The new lock takes the entity row
  `.with_for_update()` before reading its status, matching
  `cancel_purchase_request`'s own lock on the same row (Pitfall #27's "lock
  the parent row to serialize the decision" shape) — read and confirmed both
  call the same row under the same lock.
- **Chain matching no longer falls back to `PURCHASE_REQUEST`'s chains for
  other entity types** (`find_matching_chain`) — previously an expense report
  or check request with no chain of its own silently borrowed purchase-request
  chains (`applies_to == ApprovalEntityType.PURCHASE_REQUEST` was OR'd into
  every entity type's query). Now `applies_to == entity_type` only. This is a
  bug fix (routing reimbursements/payouts to approvers nobody assigned to
  them was the defect), not a scoping regression — chains remain
  `organization_id`-filtered either way.
- **Coverage-report fix** (`get_pending_approvals`'s coverage query,
  `_coverage_problem`) — the "who can approve this step" admin report now
  checks `finance.approve` (via `user_has_permission`) in addition to the
  approver-type match before counting someone as `eligible`, and distinguishes
  "nobody in this step" (`no_active_members`) from "someone's in this step but
  nobody holds the grant" (`no_approve_permission`). This changes only a
  diagnostic report's output, not an authorization decision — `approve_step`
  /`deny_step` already separately re-check `finance.approve` via
  `require_permission` at the endpoint, unchanged by this commit.
- **`delete_budget_category` now deactivates instead of deleting** when a
  budget line, approval chain or budget request still references the
  category (`budget_category_in_use`, all three reference queries
  org-filtered) — avoids silently cascading away approval-step history and
  budget links. `create_budget`/`FinanceBudgetRequestService` both now also
  refuse an inactive category (`is_active` check, 7-line addition to
  `finance_budget_request_service.py`), consistent with the existing
  `assert_in_org`-validated `category_id`.
- **Dues overdue-status fixes** (`effective_dues_status`,
  `dues_overdue_clause`, `generate_member_dues`'s `initial_status`) —
  correctness only: a dues record whose due date has already passed is now
  reported as overdue immediately rather than waiting for the next daily
  `mark_overdue_dues` run. No new query is unbounded or unscoped; all read
  through the existing org-scoped `list_member_dues`/`get_dues_summary`.
- **`list_budget_options`'s `amount_remaining` is now hidden from a
  `finance.request`-only caller who does not own the line** (`sees_all_amounts`,
  `owned_ids` via the existing `owned_budgets_query`) — a tightening of data
  exposure, not a new leak: the endpoint already restricted the fields
  returned (CLAUDE.md's "a member-facing schema must not carry admin-only
  fields" dimension-5 item), and this closes the one field (how much budget is
  left) that had been visible to every requester regardless of ownership.
- **Draft-autosave** (`useDraftAutosave`, `PurchaseRequestFormPage.tsx`) —
  frontend-only; creates/updates a `PurchaseRequest` through the existing,
  already-validated `create`/`update`/`cancel` endpoints as the member types.
  `PurchaseRequestStatus.DRAFT` is a pre-existing status (predates this
  window); no new backend surface, no bypass of `submit_purchase_request`'s
  own transition into `PENDING_APPROVAL`.

**Not security-relevant, confirmed by reading each commit:** 5 `fix(a11y)`
commits (text-contrast-only CSS), 1 `fix(layout)` commit (phone/tablet
overflow), 5 `docs(workflow-review)` log-entry commits (W61–W66, already
reviewed and fixed/flagged under their own passes — see
`docs/workflow-review/PROGRESS.md`), and 1 migration-merge-conflict fix
(`dafc58cb`, no DDL of its own).

**Migrations.** Two real finance migrations landed this window, both
reviewed directly: `a33ffa561e4f` (QuickBooks chart of accounts + export-log
import columns, above) and `da76465bc3d2` (one-time backfill converting 19
finance tables' `DATETIME` columns from the server's local zone to UTC,
guarded by an identifier allowlist before building per-table SQL, refuses
rather than corrupts when the source zone cannot be resolved, skips
`create_all`-only tables). Two no-op merge-heads revisions reconcile branch
graphs with no DDL of their own. No seeded-grant or JSON-column change.

**Standing items re-verified, both unchanged (neither file touched by this
window's delta):**

- **FIN8-05-1 (MED) — still OPEN (flagged).** `finance_budget_request_service.py`'s
  `decide_request` (now line 660, shifted by this window's earlier insertions,
  confirmed same body by direct read) still has no `assert_different_person`
  check, unlike `review_request`.
- **FIN-30 (LOW) — still FLAGGED.** `list_dues_payments`
  (`finance_service.py:6116`, shifted from `:5760`, confirmed same body by
  direct read) still takes no limit/offset.

**0 fixed, 0 new findings.**

### Completion gate (pass 11)

| Check                                                                                                                                                               | Result                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                                                                       | clean                                                 |
| `black --check app/ tests/ alembic/`                                                                                                                                | clean                                                 |
| `isort --check-only app/ tests/ alembic/`                                                                                                                           | clean                                                 |
| `scripts/validate_migrations.py --strict`                                                                                                                           | passed, single head (`e5f9bb066e07`, 639 revisions)   |
| `scripts/check_route_permissions.py --strict`                                                                                                                       | 273 routes, 0 errors/warnings                         |
| `pytest -k "finance or budget_request or approval_chain or dues or quickbooks"` (unit)                                                                              | 575 passed, 1 skipped (environment-only, `pywebpush`) |
| Standing guard suites (org-scoping ratchet, capacity locking, CSV sweep, LIKE escaping, `create_all`-table tolerance, baseline member grants, account-status gates) | 169 passed                                            |
| `frontend: npm run typecheck`                                                                                                                                       | clean                                                 |
| `frontend: npm run lint`                                                                                                                                            | clean                                                 |

## Pass 10 (2026-10-18) — watchdog pickup: real delta (approval-chain/step delete restriction + audit logging), 0 fixed, 0 new findings; FIN8-05-1 and FIN-30 re-confirmed open

**Scope.** Pass 9 merged as `74a57caba` (PR #3225). `git log --no-merges
74a57caba..HEAD` over this feature's files (`finance.py`,
`finance_service.py`, `finance_budget_request_service.py`,
`finance_settings.py`, `schemas/finance.py`, `models/finance.py`,
`public/finance_approvals.py`, `frontend/src/modules/finance/`): 2
non-merge commits. No finance/approval-chain/restricted-fund/budget
migration landed in this window (checked by scanning every new/changed
migration file's content for those keywords, not just by pathspec).

**Commit 1 of 2 — `48136548e` (dark-mode CSS only).** One line of
`FiscalYearSettingsPage.tsx` swaps a translucent `card` class for
`surface-opaque`, part of a repo-wide opaque-surface sweep. No logic
touched.

**Commit 2 of 2 — `d8c76347f` — a real, substantive change, read in full.**
`delete_approval_chain` and `delete_chain_step` used to cascade-delete
every request's `ApprovalStepRecord` (who approved/denied each step, and
their notes) while the UI's own confirmation dialog claimed that history
was kept. Both now count the requests routed through the chain/step via a
new `_requests_routed_through()` helper and refuse the delete with a 400
if any exist, telling the admin to deactivate the chain instead. Verified
against all seven checklist dimensions:

- **Tenancy (parent-resolution shape, Pitfall #14b):** both callers resolve
  the chain through the existing org-scoped `get_approval_chain(chain_id,
org_id)` _before_ calling `_requests_routed_through`, exactly as the new
  helper's own docstring states the invariant it depends on
  (`ApprovalStepRecord` carries no `organization_id` column — ancestor
  resolution is the only correct shape for it, per repo-tenancy rules).
  `_requests_routed_through` itself filters `ApprovalStepRecord.chain_id ==
chain_id` (and `.step_id ==` when given), which is safe only because the
  caller already proved that `chain_id` belongs to the caller's org — read
  and confirmed true at both call sites.
- **Auth:** all five endpoints (`update_approval_chain`,
  `delete_approval_chain`, `add_chain_step`, `update_chain_step`,
  `delete_chain_step`) remain gated by
  `require_permission("finance.configure_approvals")`, unchanged by this
  commit — confirmed by direct read of each `Depends(...)`.
  `delete_approval_chain`/`delete_chain_step` now return the deleted
  row's `name` (previously `None`) purely so the new audit-log call has it;
  no new data is exposed to the caller — the response model for both
  routes is still the bare success the delete endpoints always returned.
- **Audit:** chain update/delete and step add/update/delete are now logged
  (`finance.approval_chain_updated` / `_deleted` /
  `_step_added`/`_step_updated`/`_step_deleted`), matching the
  pre-existing `finance.approval_chain_created` event — a net improvement
  to the HIPAA/audit posture, not a regression.
- **Data exposure / injection / abuse resistance:** N/A — admin-only
  settings page, no new unauthenticated or client-controlled input beyond
  what the existing update/delete payloads already carried.
- **Schema:** no migration; uses the existing `ApprovalStepRecord` model
  and its existing `ON DELETE CASCADE` FK, unchanged.

Ships with its own 296-line test file
(`test_finance_approval_chain_delete.py`), confirmed to assert the refusal
message, the audit events, and that an unused chain/step still deletes.
The frontend half (`ApprovalChainsSettingsPage.tsx`, `financeStore.ts`) is
copy and error-propagation changes matching the new backend behavior and
the store's existing error-handling pattern for sibling chain mutations —
no logic affecting auth or tenancy.

**Standing items re-verified, both unchanged (neither file touched by this
window's delta):**

- **FIN8-05-1 (MED) — still OPEN (flagged).**
  `finance_budget_request_service.py`'s `decide_request` (still line 653 —
  the file carries zero diff this window) has no `assert_different_person`
  check, unlike `review_request`.
- **FIN-30 (LOW) — still FLAGGED.** `list_dues_payments`
  (`finance_service.py:5760`, shifted from `:5714` by this window's earlier
  insertions, confirmed same body by direct read) still takes no
  limit/offset.

**0 fixed, 0 new findings.**

### Completion gate (pass 10)

| Check                                                                                        | Result                                                  |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                | clean                                                   |
| `black --check app/ tests/ alembic/`                                                         | clean                                                   |
| `isort --check-only app/ tests/ alembic/`                                                    | clean                                                   |
| `scripts/validate_migrations.py --strict`                                                    | passed, single head (`1117b642643b`, 618 revisions)     |
| `pytest -k "finance or cash_advance or restricted_fund or budget or dues or approval_chain"` | 1,129 passed, 1 skipped (environment-only, `pywebpush`) |
| `frontend: npm run typecheck`                                                                | clean                                                   |
| `frontend: npm run lint`                                                                     | clean                                                   |

## Pass 9 (2026-10-14) — real delta (cash advances, restricted funds, budget charge restrictions, functional expense classes, QuickBooks dues export), 0 fixed, 0 new findings; FIN8-05-1 and FIN-30 re-confirmed open

**Scope.** Pass 8 merged as `8dc5260b9` (PR #3137). `git diff --numstat
8dc5260b9 HEAD` over this feature's files: `endpoints/finance.py` +828/−22,
`finance_service.py` +1,504/−128, `schemas/finance.py` +446/−4,
`models/finance.py` +230/−0, `utils/finance_settings.py` +106/−1,
`finance_budget_request_service.py` +24/−6, `public/finance_approvals.py`
+17/−1. Thirteen non-merge commits, each read. Routes: `finance.py` 108 → 124;
`public/finance_approvals.py` 3, unchanged. Every new or changed route was
enumerated with its dependency rather than inferred.

| Route                                                                                                            | Gate                                            | Reading                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /charge-access`                                                                                             | session only                                    | Returns only categories the caller owns or that sit beneath one they own (`list_charge_access_categories` → `CategoryTree.manageable_by` on the caller's held positions); position names only when that list is non-empty. Clean.                                         |
| `PUT /budget-categories/{cat_id}/charge-access`                                                                  | session only                                    | `set_category_charge_access`: `finance.manage` (`_requester_scope` → None) or an owner position on the category or an ancestor; anyone else gets 404. Charge positions validated in-org (`_validate_charge_positions`). Audited. Clean.                                   |
| `GET /reports/late-substantiation`, `/functional-expenses`, `/fund-balances`, `/advances`                        | `finance.view`                                  | Org-scoped report queries. Clean.                                                                                                                                                                                                                                         |
| `GET /funds`                                                                                                     | request/view/approve/manage                     | Lists the org's active restricted funds for the request forms. Clean.                                                                                                                                                                                                     |
| `PUT /purchase-requests/{id}/functional-class`, `/check-requests/{id}/…`, `/expense-reports/{er}/items/{item}/…` | `finance.manage`                                | Target fetched org-scoped `FOR UPDATE`; a line item is resolved through its org-scoped report. Clean.                                                                                                                                                                     |
| `GET /settings` (gate widened)                                                                                   | request/view/approve/manage/configure_approvals | Returns policy values the expense form needs (dual-approval threshold, substantiation mode/days, fund overspend mode); nothing member-specific. Clean.                                                                                                                    |
| `GET /advances`, `GET /advances/{id}`                                                                            | request/view/manage                             | A caller without view/manage is confined to their own advances (`_read_scope` → `advance_balances(member_id=…)` filters `CheckRequest.requested_by`); another member's advance is a 404. Clean.                                                                           |
| `POST /advances/{id}/returns`, `DELETE …/returns/{return_id}`                                                    | `finance.manage`                                | `lock_advance` (org-scoped) then a locking balance read before the return is checked against what is outstanding (pitfall #27); the member who owes the money cannot record it came back (`assert_different_person`, FIN-4); an exported return cannot be removed. Clean. |
| `PUT /export/dues-accounts`, `/export/advance-accounts`                                                          | `finance.manage`                                | Org settings writes. Clean.                                                                                                                                                                                                                                               |

**Writes reached through existing routes:**

- **Expense report against an advance.** `assert_settleable` admits only the filer's own issued advance in this org (pitfall #14c), and `_apply_advance` locks the advance and reads its balance with locking reads, so two reports cannot both claim its last dollars.
- **Restricted funds.** Every create/update path for purchase requests, check requests, expense reports and expense lines runs `_validate_finance_fks`, which calls `assert_chargeable` (fund must be this org's active restricted campaign). A cash advance refuses a budget line or fund outright.
- **Budget charge restrictions.** `assert_may_charge` runs on every create and every budget-changing update of the three request types and on each expense line; `finance.manage` is exempt by design.

**Standing items re-verified:**

- **FIN8-05-1 (MED) — still OPEN (flagged).** `finance_budget_request_service.py` `decide_request` (line 653) still has no `assert_different_person` check, unlike `review_request`; mirrored in `KNOWN_LIMITATIONS.md` as before.
- **FIN-30 (LOW) — still FLAGGED.** `list_dues_payments` (`finance_service.py:5714`) still takes no limit/offset.

### Completion gate (pass 9)

No application code changed in this pass.

| Check                                                                      | Result                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                              | clean                                                                                                                                                                                                                              |
| `black --check app/ tests/ alembic/`                                       | clean                                                                                                                                                                                                                              |
| `isort --check-only app/ tests/ alembic/`                                  | clean                                                                                                                                                                                                                              |
| `scripts/validate_migrations.py --strict`                                  | passed, one head                                                                                                                                                                                                                   |
| `pytest -k "finance or cash_advance or restricted_fund or budget or dues"` | 1,116 passed, 1 skipped. A first run against a local database still at an older revision gave 29 failures and 481 errors; after `alembic upgrade head` the same selection was clean, so those were the stale schema, not the code. |
| `frontend: npm run typecheck`                                              | clean                                                                                                                                                                                                                              |
| `frontend: npm run lint`                                                   | clean                                                                                                                                                                                                                              |

## Pass 8 (2026-10-12) — real delta (budget amendments, fiscal-year planning, budget requests, receipts), 1 new finding flagged, three standing items re-verified (two already closed by other work)

**Scope.** Pass 7's closing merge is `2c2ebaa7` (PR #2941). `git diff
2c2ebaa7..origin/main --stat` scoped to this feature's domain
(`endpoints/finance.py`, `services/finance_service.py`,
`services/finance_budget_request_service.py`,
`services/finance_budget_ownership.py`, `public/finance_approvals.py`,
`models/finance.py`, `schemas/finance.py`, `core/audit.py`,
`frontend/src/modules/finance`) shows **82 files changed, 20,664
insertions(+), 1,507 deletions(-)** — the backend alone is 6,726
insertions across six files. This is not a near-zero-delta pass: the feature
roughly tripled in size since pass 7 (`endpoints/finance.py` 1,370 → 3,650
lines, 69 → 105 routes; `finance_service.py` grew to 5,867 lines; a new
1,145-line `finance_budget_request_service.py`). Read in full against the
checklist rather than sampled: every one of the 105 routes was enumerated
(method, path, handler, auth dependency/permission — see below), and every
new service method the diff touches was read, not diffed-and-trusted.

**What's new, by area:**

- **Fiscal-year lifecycle** (`fiscal-years/{fy_id}/activate|begin-close|
planning-stage|lock`, `.../open-items`, `.../start-from/{source_id}`):
  adoption, a leadership-review planning stage, a year-end close/lock
  sign-off, and copying last year's lines into a draft (`start_from`).
- **Budget amendments** (`budgets/{id}/amendments`, `.../reverse`,
  `.../confirm`, `.../reject`): a second-officer confirmation workflow for
  extra money approved mid-year, plus a reversing-entry correction for a
  mistaken amendment — both entered `pending` and applied only when a
  **different** officer confirms (`assert_different_person`), both take the
  budget row's lock before touching `amount_budgeted`
  (CLAUDE.md Pitfall #27), both refuse a locked fiscal year, and the reversal
  path additionally takes a _locking_ read for an existing reversal so two
  concurrent reversal attempts cannot both see "none yet" (the same #27
  shape applied to the uniqueness check itself, not just the money).
- **Budget-line ownership and self-service budget requests**
  (`my-budgets`, `my-budgets/summary`, `budgets/{id}` GET,
  `budgets/{id}/amendments` GET, `budgets/{id}/transactions` GET, and the
  whole `budget-requests` resource — list/my-lines/proposal-options/create/
  get/update/submit/withdraw/delete/decide/review): a budget line is now
  owned by a **position** (`finance_budget_ownership.py`'s
  `owned_budgets_query`/`user_owns_budget`), and its holder can read their
  own lines and propose next year's amount for them with no `finance.*`
  permission at all — every one of these routes carries only
  `Depends(get_current_user)` and does its own self-scoping in the handler
  or service (`_authorize_budget_view` for reads; `user_owns_budget`/
  `user_holds_position` for writes). This is the single largest new
  authorization surface in the feature and was read as such: every write
  path either requires `finance.manage` outright or explicitly checks
  ownership/position-holding before accepting a client-supplied
  `budgetId`/`categoryId`/`stationId`/`ownerPositionId` (`assert_in_org` on
  each FK — `create_request`, `finance_budget_request_service.py:517-531`).
- **Receipts on purchase requests and expense line items**
  (`.../receipt` upload/download, four routes): routed through the
  app-wide `module_documents.store_as_document`/`serve_document`/
  `discard_file` with `RECEIPT_FILE_RULES` — the same shared, already-
  reviewed scanned-upload service the storefront and apparatus/facilities
  receipts use, not a new trust boundary. A non-manager can only attach a
  receipt to their own request, and not once it has left the status window
  that status-guard constants (`_PR_RECEIPT_CLOSED*`, `_ER_RECEIPT_*`)
  define.
- **`finance.budget_review`**, a new permission gating `confirm_budget_
amendment`/`reject_budget_amendment` (as an OR-alternative to
  `finance.manage`) and `review_budget_request` (leadership's change to a
  Treasurer-decided request). Confirmed **not** baseline-granted: searched
  `core/permissions.py`'s `DEFAULT_POSITIONS` for the string — zero matches
  — so no seeded position (including `member`/`firefighter`) carries it,
  per CLAUDE.md Pitfall #23/Checklist §2.
- **`core/audit.py`** gained signing-key rotation support (a `signing_key_
id` fingerprint per row, `_AuditKeyring`, SECRET_KEY-fallback
  verification before a cut-over row) — a cross-cutting change, not
  finance-specific, that this feature only consumes through `log_audit_
event()`'s unchanged call signature. Out of this feature's scope to
  re-review in full (it belongs to Feature 00/28's own sweeps); confirmed
  only that every finance `log_audit_event` call site still compiles
  against it and the full backend suite (below) passes.

**New finding this pass:**

### FIN8-05-1 — MED — `decide_budget_request` has no separation-of-duties guard, unlike its own sibling `review_budget_request` — OPEN (flagged)

**What:** `FinanceBudgetRequestService.review_request` (leadership review of
a Treasurer-decided request) explicitly refuses a reviewer who owns the
line or submitted the request:

```python
if str(request.submitted_by or "") == str(reviewer_id) or (
    await self._acts_as_owner(request, org_id, reviewer_id)
):
    raise BudgetRequestForbiddenError(...)
```

`decide_request` — the Treasurer's own decision on a submitted request,
gated by `finance.manage` — has no equivalent check anywhere in its body
(`backend/app/services/finance_budget_request_service.py:635-714`). Nothing
stops the same `finance.manage` holder who submitted a request from also
deciding it.

**Where:** `backend/app/services/finance_budget_request_service.py:635`
(`decide_request`); compare `:842` (`review_request`'s guard).

**Failure scenario, concrete:** a `finance.manage` holder (the Treasurer)
also holds a position that owns a budget line (plausible — the Treasurer's
own office, or a small department where the Treasurer wears a second hat).
`create_request` lets a manager create a request for **any** line,
including one they personally own (`is_manager=True` bypasses the
ownership check at `finance_budget_request_service.py:503-509`). The same
person then calls `POST /budget-requests/{id}/decide` with
`decision=approve`, writing their own requested amount straight into the
draft-year budget line (`_write_amount`) with no second person involved at
any point in the Treasurer-decision step. Contrast `review_request`, written
by the same feature in the same pass, which explicitly blocks exactly this
for the leadership-review step one stage later.

**Impact:** a single `finance.manage` holder can self-approve their own
unit's budget request, with no audit trail distinguishing it from an
arm's-length decision (the audit event records `decided_by` but nothing
flags same-person). Lower severity than a money-movement SoD gap (FIN-4):
nothing is disbursed, the amount still passes every ceiling/locked-year
check, and leadership review (if the department uses that planning stage)
still gets a chance to catch it via `review_request`'s own guard — but a
department that skips leadership review for most years has no check at all
on this specific self-dealing path.

**Why not fixed:** this is the exact shape CLAUDE.md's established pattern
for this file treats as a product decision, not a drive-by fix — compare
FIN-4 (disbursement SoD, flagged, not fixed, pending a `finance.disburse`
permission) and OPS-8 (`record_dues_payment`, flagged, not fixed). Adding
`assert_different_person(decided_by, request.submitted_by, ...)`
unconditionally would also block the only-finance-officer department from
ever deciding a request they raised themselves (the same operational
tension OPS-8 and the amendment-confirmation docs already name for a
single-officer department) — a behavior change needing an owner call on
whether to accept that cost, add an override, or leave the leadership-
review stage as the sole backstop. No guard test was added for the same
reason FIN-4/OPS-8 have none: there is nothing to regress-test for a
behavior that is not changing.

**Disposition: FIN8-05-1 OPEN (flagged).** Mirrored into
`docs/KNOWN_LIMITATIONS.md`.

**Re-verified, standing items — one correction, two closed by other work:**

- **FIN-30** — `list_dues_payments` (`finance_service.py:4909`) still
  eager-loads a member's entire payment ledger with no `.offset()`/
  `.limit()`. Unchanged; correctly flagged rather than fixed (a response-
  shape change).
- **`record_dues_payment` has no separation-of-duties guard** (OPS-8) —
  unchanged; `kwargs.get("recorded_by")` is still passed straight through
  with no `assert_different_person` call.
- **`get_pending_approvals` per-assignee filtering — correction, not a
  re-confirmation.** Pass 7 (2026-10-05) stated this was "unchanged; still
  no per-step assignee column to filter on." That was already **wrong on
  the day it was written** — `docs/KNOWN_LIMITATIONS.md`'s own "Finance:
  correctness/DoS polish" row dates the fix to 2026-10-04, one day earlier.
  Read directly, not taken on either doc's word: `get_pending_approvals`
  (`finance_service.py:2846`) now matches every pending step against the
  caller via `user_matches_step`/`finance_approver_matching.py` (the same
  function `approve_step`/`deny_step` gate on) and returns only the steps
  the caller can act on, unless they hold `finance.configure_approvals`
  (an approvals admin, who sees every row with the ones they are not named
  on flagged `requires_override`). Pass 7's claim is corrected here rather
  than silently carried forward.
- **The eight non-ledger status-transition locks** (`submit_purchase_
request`/`submit_expense_report`/`submit_check_request`/`mark_pr_
ordered`/`mark_pr_received`/`update_purchase_request`/`update_expense_
report`/`update_check_request`) — **re-verified FIXED by other,
  non-security-review work, not still open as pass 6/7 stated.** Commit
  `1eae838d` ("let every member raise their own finance requests",
  2026-10-07 — two days _after_ pass 7), landed while adding
  `restrict_to_user` self-service scoping, now routes all eight through
  `get_purchase_request`/`get_expense_report`/`get_check_request`'s
  `for_update=True` path (confirmed by direct read of all eight methods,
  not the commit message). A guard test already exists —
  `tests/test_capacity_locking.py::TestFinanceWorkflowLocking` (added in
  the same commit) — and passes against current code (55/55 in that file,
  run below). FIN-31's pass-5 scope decision to defer these eight is
  therefore **closed**, not merely unchanged.

**Verified good ✅ (re-confirmed by direct read of current code, not
re-derived from pass 7's word):** all 105 routes enumerated by method,
path, handler and gate — every one carries either `require_permission`
(appropriate to its sensitivity: `.manage` for money-moving/config writes,
`.view`/`.request`/`.manage` OR-gates for the request lifecycle,
`.approve` for the approval queue, `.configure_approvals` for chain admin,
`.budget_review` for the two leadership-review actions) or `get_current_
user` with explicit self-scoping in the handler/service body (`my-budgets`,
the budget-owner reads, the whole `budget-requests` self-service surface) —
no route falls through to an unguarded `get_current_user` with no scoping
at all; `_validate_finance_fks`/`_validate_owner_position`/
`_validate_budget_category_fks`/`assert_in_org` cover every client-supplied
`budget_id`/`category_id`/`fiscal_year_id`/`station_id`/`apparatus_id`/
`facility_id`/`owner_position_id`/`parent_category_id` on every create/
update path touched by this pass's diff (walked each one, not sampled);
every `ondelete="SET NULL"` FK in `models/finance.py` pairs with
`nullable=True` (scripted check across all 40 SET NULL columns, zero
violations — Pitfall #2); `add_budget_amendment`/`reverse_budget_
amendment`/`confirm_budget_amendment`/`_pending_amendment`/`create_
budget_request`/`decide_request`/`review_request`/`start_from` all take
their row locks in the documented order (fiscal year, then request/
amendment, then line) and use locking reads for their own uniqueness
checks (`_assert_no_live_duplicate`, the reversal-exists check) rather than
a plain `SELECT` that could answer from a pre-lock snapshot; receipt
upload/download goes through `module_documents` only, no bespoke file
handling; the one `.like()` still declares `escape=LIKE_ESCAPE_CHAR`; the
one CSV export (`export_transactions`) still uses only `SafeCsvWriter`,
capped at `max_records=10_000`; every `except` routes through `safe_error_
detail()`; `public/finance_approvals.py` is unchanged from pass 7's
byte-identical, independently-verified state (re-confirmed: `git diff
2c2ebaa7..origin/main -- backend/app/api/public/finance_approvals.py`
returns no lines).

**Completion gate (pass 8):** `flake8 app/ tests/ alembic/` (7.3.0, CI's
pin) — clean. `black --check app/ tests/ alembic/` (26.5.1) — clean.
`isort --check-only app/ tests/ alembic/` (9.0.1, CI's pin) — clean.
`validate_migrations.py --strict` — 572 revisions, single head
`3c9c5025a380`. `check_route_permissions.py --strict` — 265 routes, 0
errors, 0 warnings. `generate_schema_docs.py` re-run — zero diff against
committed `docs/DATABASE_SCHEMA.md`. `pytest tests/test_capacity_locking.py`
— 55 passed. `pytest tests/ -q -k "finance or dues or approval or budget or
export"` — 1,097 passed, 1 skipped (pre-existing, `py_vapid`), 0 failed.
Full backend unit suite (`pytest tests/ -m "not integration and not slow
and not docker"`) — **14,262 passed, 1 skipped (pre-existing, `py_vapid`),
0 failed.** Frontend: `npx vitest run src/modules/finance/` — 27 files, 435
tests, all passed. `npx vitest run src/modules/testing/testingRegistry.
test.ts` — 12 passed. `npx playwright test src/e2e/mobile-route-integrity.
spec.ts --project=chromium` — 1 passed. `npm run typecheck` — 0 errors.
`npm run lint` — 0 errors, 0 warnings.

---

## Pass 7 (2026-10-05) — real delta (a new manual-approval path), 1 new finding fixed, prior open items re-confirmed

**Scope.** Pass 6's closing merge is `7754eccd7` (PR #2599). `git diff
7754eccd7..origin/main --stat` scoped to this feature's domain
(`endpoints/finance.py`, `services/finance_service.py`,
`public/finance_approvals.py`, `models/finance.py`, `schemas/finance.py`,
`utils/model_updates.py`, `utils/csv_export.py`, `utils/sql_search.py`,
`utils/org_scoping.py`, `core/audit.py`, `frontend/src/modules/finance`) shows
41 files changed, 3,771 insertions — not a near-zero-delta pass like pass 6.
`public/finance_approvals.py` itself is byte-identical (`git diff` on that one
path alone returns no lines) — re-read in full anyway rather than trusted on
that diff, per the checklist's "enumerate, don't spot-check" rule, and
re-confirmed unchanged (see "Verified good" below).

**What changed, read in full against the model rather than taken on commit
messages:**

- **A new manual-approval path** (`finance.py` +132, `finance_service.py`
  +243 net across the feature, `schemas/finance.py` +~70): `GET
/approvals/unrouted`, `POST /approvals/manual/{entity_type}/{entity_id}
/approve`, `POST .../deny`, plus the service methods
  `get_unrouted_approvals`/`manual_approve`/`manual_deny`/
  `_lock_unrouted_entity`/`_unrouted_mapping`/`_has_step_records`. This closes
  the "nobody could approve a request with no matching chain" gap documented
  in `KNOWN_LIMITATIONS.md`'s "Finance — Nobody Could Approve Anything" entry
  (that entry's own 2026-09-30 addendum already noted the fix landed; this
  pass is this rotation's first independent review of it). A matching
  frontend `ApprovalsPage`/`ManualApprovalPanel`/`ApprovalDecisionDialog` and
  a new `/finance/approvals` route (`finance.approve`-gated) ship alongside
  it.
- **camelCase request-body acceptance** (`schemas/finance.py`, every request
  schema gains `model_config = _REQUEST_CONFIG`: `alias_generator=to_camel,
populate_by_name=True, loc_by_alias=False`) — intake-only; no response
  schema changed, no dump anywhere in the three in-scope files uses
  `by_alias=True` (confirmed: `grep -rn by_alias backend/app/schemas/
finance.py backend/app/services/finance_service.py backend/app/api/v1/
endpoints/finance.py backend/app/api/public/finance_approvals.py` — the
  only hits are the comment explaining the convention), so `apply_updates`'s
  `exclude_unset` semantics and every existing validator are unaffected.
- **`ondelete="RESTRICT"` declared on finance's seven previously-implicit
  `users.id` FKs** (`models/finance.py`, part of a 23-file, whole-codebase
  sweep, commit `014a4a44a`) — documentation of MySQL's existing implicit
  default, not a behavior change; no migration needed or added, matching the
  commit's own stated reasoning. `docs/DATABASE_SCHEMA.md` already
  regenerated by that commit (re-run `generate_schema_docs.py` this pass:
  zero diff).
- **CSV export dates now render in the department's timezone**
  (`finance_service.py`, `generate_export`) — a correctness fix (was
  `.strftime` on a naive/UTC `datetime` with no conversion), not a security
  change; no injection surface touched, `SafeCsvWriter` still the only
  writer.
- **Approval-chain step editing from the settings UI** and an **approver-picker
  hook** are frontend-only against the pre-existing, already-reviewed
  `add_chain_step`/`update_chain_step` endpoints (FIN-26) — no backend
  change in this diff.

**New finding this pass:**

### FIN-33 — MED — `record_dues_payment` reads and recomputes the dues ledger total via a plain SELECT, so two concurrent payments can silently lose one from the cached total — ✅ FIXED

**What:** `record_dues_payment` loads `MemberDues` with `selectinload(MemberDues.payments)` via a plain `SELECT` (no lock), appends a new `DuesPayment` row to the in-memory collection, and calls `_apply_payment_totals(dues)`, which **recomputes** `amount_paid`/`status`/`paid_date` from `sum(dues.payments)` rather than incrementing a running total — by design, per FIN-6, so a duplicate submission can't double-credit. That design choice is exactly what makes an unlocked read dangerous for two _different_, legitimate concurrent payments: this is CLAUDE.md Pitfall #27 (a read-then-write of an aggregate) applied to the dues ledger, the same shape FIN-31 (pass 5) found and fixed for `Budget`.

**Where:** `backend/app/services/finance_service.py`, `record_dues_payment` (now line ~2593, immediately before the fix's added comment).

**Failure scenario, concrete:** a treasurer records a $50 cash payment and, seconds later (or a second treasurer, simultaneously), records a $25 check payment against the same member's dues record, before either transaction commits. Both read `dues.payments` (say, empty) via the same unlocked `SELECT`. Both append their own payment to their own in-memory copy of the collection (each sees only its own new row, not the other's). Both call `_apply_payment_totals`, each computing `amount_paid` from _its own_ single payment ($50, then $25). Both flush. The second to commit wins the `UPDATE member_dues SET amount_paid = ...` — the cached total ends at $25, silently dropping the $50 payment from the aggregate. The `DuesPayment` row for the $50 payment still exists in `dues_payments` (the ledger itself is not corrupted — `list_dues_payments` would still show both rows), but `MemberDues.amount_paid`/`status` — which is what `DuesManagementPage`'s summary cards, `get_dues_summary`, and `MemberDuesResponse` actually show — understates what was paid, potentially leaving a member who paid in full showing as `PARTIAL` or `PENDING` indefinitely (until the next payment against that record recomputes the total and happens to catch up, which is not guaranteed if no further payment is ever recorded).

**Impact:** a department's dues records can silently and persistently misstate how much a member has paid, after two genuinely concurrent (not duplicate) payments — plausible at a monthly dues-collection meeting where more than one officer takes payments. Not a cross-tenant or authorization issue; a correctness/data-integrity defect on a financial ledger, consistent with FIN-31's MED severity for the identical mechanism on `Budget`.

**Fix:** added `.with_for_update()` to `record_dues_payment`'s initial `MemberDues` SELECT, matching the exact pattern `approve_by_token` (same file) already uses combined with `selectinload` — serializes concurrent payments on the same dues row so the second transaction's `_apply_payment_totals` call sees the first payment's already-committed row. No response-shape or behavior change for the non-concurrent case (the lock is transparent).

**Not extended to `waive_dues`/`unwaive_dues`:** `waive_dues` sets `status = WAIVED` unconditionally without reading `_apply_payment_totals`, so there is nothing for a stale read to drop — a race there is a benign double-write of the same final state, the same lower-severity "non-ledger status transition" shape already documented as flagged-not-fixed for purchase/expense/check requests (`KNOWN_LIMITATIONS.md`, "Finance: eight non-ledger status transitions..."). `unwaive_dues` requires `status == WAIVED` to proceed and `record_dues_payment` refuses whenever `status == WAIVED`, so the two cannot race against each other on the same row (mutually exclusive preconditions); two concurrent `unwaive_dues` calls are idempotent (both would set the same fields). Left unlocked — fixing a read that reads no new data and recomputes the same deterministic answer from rows already committed is not this finding's scope.

**Guard test:** `tests/test_capacity_locking.py::TestFinanceDuesPaymentLocking::test_record_dues_payment_locks_the_dues_row` — source-inspection style, matching `TestFinanceDisbursementLocking`'s existing shape in the same file. Confirmed to fail against the pre-fix code (`git stash` on `finance_service.py` alone, re-run: fails with the expected `AssertionError`) and pass after (`git stash pop`).

**Re-verified sound, this pass's own independent read, not taken on the diff's comments:** `manual_approve`/`manual_deny`/`get_unrouted_approvals`/`_lock_unrouted_entity` —

- org-scoped: `_lock_unrouted_entity`'s fetch filters `model.organization_id == org_id`; `get_unrouted_approvals`'s `union_all` filters every one of its three branches on `organization_id == org_id`, and its `User` outer-join for the requester's display name additionally filters `User.organization_id == org_id` (so a requester row from another org — impossible today, since `requested_by`/`submitted_by` are populated from `current_user.id` at creation, but still a defense-in-depth filter) can't be joined in;
- race-safe: `_lock_unrouted_entity` takes `.with_for_update()` on the entity row before checking its status and whether it already has step records, closing the same double-decision race `approve_step`'s lock closes — reproduced the reasoning, not just read the lock: two concurrent `manual_approve` calls on the same request both block on the second's lock acquisition until the first commits its status flip to `APPROVED`, so the second's subsequent `entity.status != pending_status` check (after acquiring the now-released lock) correctly fails;
- separation of duties: `manual_approve` calls `assert_different_person` against `_entity_creator_id`, the identical guard `approve_step` uses (FIN-4's mechanism, not a reimplementation) — confirmed by reading `_entity_creator_id`'s per-entity-type column mapping, not assumed from the function name;
- cannot be reached by a routed request: `_has_step_records` is an `EXISTS` against `ApprovalStepRecord` keyed on `(entity_type, entity_id)` with no status filter, so a request routed through any chain — including one whose chain was fully denied — is excluded from `get_unrouted_approvals` and refused by `manual_approve`/`manual_deny` ("has approval steps; approve it through those steps"); confirmed by reading `submit_purchase_request`/`submit_expense_report`/`submit_check_request` (step records are created in the same call that sets `PENDING_APPROVAL`, atomically — there is no state where an entity is `PENDING_APPROVAL` today and gains step records later, so no race exists between "becomes unrouted" and "a chain is later matched to it");
- no route shadowing: `GET /approvals/unrouted` and `GET /approvals/pending` are both fixed, same-segment-count paths with no `/approvals/{id}` GET sibling in this file to shadow them (confirmed by listing every `@router.get` under `/approvals`); the two manual-decision POSTs are 5-segment paths, distinct in shape from every other registered route;
- audit logging: both manual actions call `log_audit_event` (`event_category="finance"`, `severity="info"`/`"warning"`), matching FIN-32's pattern, with no PII in `event_data` (entity type/id and the free-text note/reason only — the same choice FIN-32 made for `waive_dues`, except here the note is not itself flagged as potentially sensitive, since it is the approver's own note, not a withheld personal detail);
- camelCase intake does not create a second validation path: every `_REQUEST_CONFIG` field is the same `Field`/validator-decorated attribute under an additional alias, not a parallel schema — confirmed by reading `ExpenseLineItemCreate`'s `mode="before"` validator fix (also in this diff) applies identically regardless of which alias the client used, since `populate_by_name=True` resolves both names to the same field before any validator runs.

**Disposition: FIN-33 FIXED.** No other new findings. Every prior pass's open
item re-confirmed still open and unchanged, by direct read at current line
numbers:

- **FIN-30** — `list_dues_payments` (`finance_service.py`, now ~line 2650,
  +12 lines of unrelated additions since pass 6's citation) still
  eager-loads a member's entire payment ledger with no `.offset()`/
  `.limit()`. Still correctly flagged rather than fixed.
- **`get_pending_approvals` per-assignee filtering** — unchanged; still no
  per-step assignee column to filter on. (The new `get_unrouted_approvals`
  does not have this problem — by construction, every row it returns is
  actionable by any `finance.approve` holder, since an unrouted request has
  no assignee concept at all; there is nothing narrower to filter to.)
- **The eight non-ledger status-transition locks** — unchanged, still
  deliberately deferred per FIN-31's pass-5 scope decision.
- **`record_dues_payment` has no separation-of-duties guard**
  (`KNOWN_LIMITATIONS.md`'s "Finance: no separation of duties on terminal
  money movement" row, the `OPS-8`-referenced gap) — unchanged; `kwargs.get
("recorded_by")` is passed straight through with no `assert_different_person`
  call, unlike `waive_dues` on the same `MemberDues` record. Not this pass's
  fix — a behavior change to an existing endpoint's authorization semantics
  on a money-handling path warrants its own dedicated review, consistent with
  how FIN-31 and FIN-33 both treated "found something adjacent" as scope to
  flag, not scope to fold in silently.

**Verified good ✅ (re-confirmed by direct read of current code, not
re-derived from pass 6's word):** all 69 finance routes (66 + the 3 new
manual-approval ones) carry `require_permission`, confirmed by
`check_route_permissions.py --strict` below (0 errors against the current
244-route application total); every by-id read/update/delete across all
twelve-plus finance entity types remains org-scoped (walked every service
method touched by this pass's diff, plus re-spot-read every method named in
pass 4–6's own "Verified good" lists); `approve_step`/`deny_step`/
`approve_by_token`/`deny_by_token` all still `.with_for_update()` their
`ApprovalStepRecord` read and call `_ensure_current_step`;
`mark_pr_paid`/`cancel_purchase_request`/`mark_expense_paid`/`issue_check`/
`void_check` still take their locked read per FIN-31; `mark_pr_paid`/
`mark_expense_paid`/`issue_check`/`waive_dues` still call
`assert_different_person`; `_validate_finance_fks` and its three siblings
unchanged; the one `.like()` still declares `escape=LIKE_ESCAPE_CHAR`;
`export_transactions` still uses only `SafeCsvWriter`, still caps at
`max_records=10_000`; every `except` routes through `safe_error_detail()`;
**`public/finance_approvals.py` is byte-identical to pass 6's reviewed
state** (confirmed `git diff 7754eccd7..origin/main -- backend/app/api/
public/finance_approvals.py` returns no lines) and was re-read in full this
pass regardless (see the module docstring's own claims re-verified above):
256-bit (`secrets.token_urlsafe(32)`) single-use tokens, cleared
(`approval_token = None`) on use; 7-day expiry checked against
`token_expires_at` before any state change; `.with_for_update()` on both
`approve_by_token`/`deny_by_token`'s `ApprovalStepRecord` read, so the
single-use check (`status != PENDING`) is a locking read, not a
stale-snapshot one; 30 requests/60s per-IP rate limit via `public_rate_limit`
(Redis-backed with the documented in-memory fallback) applied **before** the
token lookup; bounds (20–255 chars) and a `base64url` alphabet pattern
enforced at the path-parameter level before any DB query; 404-before-400
ordering (an unknown token and a used/expired one are distinguishable only
by calling `_load_record` first); the EMAIL-approver self-approval guard
(`SeparationOfDutiesError`, comparing the step's `approver_value` against the
requester's own email) unchanged; both `log_audit_event` calls (FIN-32)
resolve `organization_id` from the eager-loaded `record.chain.organization_id`
— never from client input — and carry no PII in `event_data`.

**Completion gate (pass 7):** `flake8 app/ tests/ alembic/` — clean.
`black --check app/ tests/ alembic/` — clean (26.5.1). `isort --check-only
app/ tests/ alembic/` — clean (9.0.1, CI's pin). `validate_migrations.py
--strict` — 512 revisions, single head `34d3d56d1479`.
`check_route_permissions.py --strict` — 244 routes, 0 errors, 0 warnings.
`generate_schema_docs.py` re-run — zero diff against committed
`docs/DATABASE_SCHEMA.md`. `pytest tests/ -q -k "finance or dues or approval
or budget or export"` — 510 passed (509 pre-existing + 1 new guard test), 1
skipped (pre-existing, `py_vapid`), 0 failed. Cross-cutting guard tests
(`test_org_scoping_ratchet.py`, `test_capacity_locking.py` — 41 tests
including the new one, `test_like_escaping.py`, `test_csv_writer_sweep.py`,
`test_permission_gate_branch_sweep.py`, `test_finance_route_resolution.py`,
`test_database_schema.py`) — 120 passed. Full backend unit suite (`pytest
tests/ -m "not integration and not slow and not docker"`) — **12,609
passed, 1 skipped (pre-existing, `py_vapid`), 0 failed.** Frontend: `npx
vitest run src/modules/finance/` — 11 files, 188 tests, all passed.
`npx vitest run src/modules/testing/testingRegistry.test.ts` — 12 passed
(the new `/finance/approvals` route is registered correctly). `npx
playwright test src/e2e/mobile-route-integrity.spec.ts --project=chromium` —
1 passed. `npm run typecheck` — 0 errors. `npm run lint` — 0 errors, 0
warnings.

---

## Pass 6 (2026-09-15) — near-zero-delta, one collaborator commit re-verified sound, 0 new findings

**Scope.** `git log 6613919e2..origin/main -- backend/app/api/v1/endpoints/finance.py
backend/app/services/finance_service.py backend/app/api/public/finance_approvals.py
backend/app/models/finance.py backend/app/schemas/finance.py
backend/app/utils/model_updates.py backend/app/utils/csv_export.py
backend/app/utils/sql_search.py backend/app/utils/org_scoping.py
backend/app/core/audit.py frontend/src/modules/finance` (`6613919e2` is pass
5's own closing merge, PR #2544) surfaces exactly **one** commit,
`4b7bd1adb` — despite 74 unrelated commits landing on `main` since pass 5.
`finance_service.py`, `public/finance_approvals.py`, `models/finance.py`,
`schemas/finance.py`, every migration under the finance domain, the shared
collaborators (`core/permissions.py`, `api/dependencies.py`,
`core/database.py`, `core/utils.py`, `utils/model_updates.py`,
`utils/csv_export.py`, `utils/sql_search.py`, `utils/org_scoping.py`,
`core/audit.py`), and the entire `frontend/src/modules/finance` tree are
byte-identical to pass 5's reviewed state (`git diff 6613919e2 origin/main`
across that set returns no lines).

**The one commit, read in full rather than trusted on its message.**
`4b7bd1adb` ("admit the manage grant to seven reads that branch on it") is an
unrelated cross-module sweep (the scheduling-module defect class from
`#2511`/`#2524`) that touched four finance routes:
`list_expense_reports`/`get_expense_report`/`list_member_dues`/
`list_dues_payments` were gated `require_permission("finance.view")` alone
while each one's own body branches on `finance.manage`
(`user_has_permission(current_user, "finance.manage")`) to decide whether to
widen the query past the caller's own records. A custom position holding
`finance.manage` without the paired `finance.view` (no seeded rank does this,
but a hand-configured one could) was refused before that branch ever ran —
the exact CHECKLIST §2 "OR-gate: check every alternative" shape, mirroring
FIN-05's own pass-4/5 verification that every `require_permission` OR-gate be
walked rather than sampled.

Independently re-verified rather than deferred to the commit message: read
all four current handlers (`finance.py:956` `list_expense_reports`, `:1010`
`get_expense_report`, `:1412` `list_member_dues`, `:1470`
`list_dues_payments`) —
each now reads `require_permission("finance.view", "finance.manage")`, and
each body's own `user_has_permission(current_user, "finance.manage")` /
`restrict_to_user` narrowing is unchanged beneath the widened gate, so a
plain `finance.view` holder still sees only their own reimbursements/dues
(FIN-5's scoping) and a `finance.manage` holder still sees the full org
queue — the gate widened who can _reach_ the branch, not what the branch
does. No handler gained a new code path, no new permission string was
introduced, and the change is covered by
`tests/test_permission_gate_branch_sweep.py`'s registry-driven check (run
independently below, not taken on the commit's own claim of coverage).

**Every prior pass's open item re-confirmed still open and unchanged, at
current line numbers, by direct read (not re-derived from a prior pass's
word):**

- **FIN-30** — `list_dues_payments` (`finance_service.py:2392`, moved from
  `:2325` since pass 5 — the file grew 67 lines from unrelated additions,
  citation corrected here) still
  eager-loads a member's entire payment ledger with no `.offset()`/`.limit()`;
  still correctly flagged rather than fixed (a response-shape change, not a
  security gap this review closes unilaterally).
- **`get_pending_approvals` per-assignee filtering** — still returns every
  applicable step for the caller's org rather than filtering to steps
  assigned specifically to the caller; there is still no per-step assignee
  column to filter on.
- **The eight non-ledger status-transition locks** (`submit_purchase_request`/
  `submit_expense_report`/`submit_check_request`/`mark_pr_ordered`/
  `mark_pr_received`/`update_purchase_request`/`update_expense_report`/
  `update_check_request`) — still unlocked plain-`SELECT` reads, per FIN-31's
  own pass-5 scope decision; `docs/KNOWN_LIMITATIONS.md`'s row is unchanged
  and still names the exact fix pattern for whoever picks it up.

**Disposition: 0 fixed, 0 new findings.** The one in-scope commit is a
correctness improvement (widening an under-scoped OR-gate), independently
re-verified sound rather than merely accepted, and changes no finding's
status.

**Verified good ✅ (re-confirmed by direct read of the current four widened
handlers and a fresh route/test run, not re-derived from pass 5's word):**
all 66 routes still carry `require_permission` (route count unchanged, per
`check_route_permissions.py --strict` below); the four widened gates'
underlying `restrict_to_user`/`viewer_user_id`/`user_id` narrowing logic is
byte-identical to pass 5's read of it; `approve_step`/`deny_step`/
`approve_by_token`/`deny_by_token` still `.with_for_update()` and call
`_ensure_current_step`; `mark_pr_paid`/`cancel_purchase_request`/
`mark_expense_paid`/`issue_check`/`void_check` still take their locked read
per FIN-31; `mark_pr_paid`/`mark_expense_paid`/`issue_check`/`waive_dues`
still call `assert_different_person`; `_validate_finance_fks` and its three
siblings unchanged; the one `.like()` still declares
`escape=LIKE_ESCAPE_CHAR`; `export_transactions` still uses only
`SafeCsvWriter`, still caps at `max_records=10_000`; every `except` routes
through `safe_error_detail()`; `public/finance_approvals.py`'s token
bounds/pattern, rate limit, 404-before-400 ordering, self-approval guard, and
the two `log_audit_event` calls FIN-32 added are all unchanged (also
independently re-verified by PUB-03 pass 6 for the same file, from the other
feature's side, with the same conclusion: no PII in the audit payload, org
resolved from the eager-loaded chain rather than the token payload, and an
audit-write failure isolated by a SAVEPOINT).

**Completion gate (pass 6):** `flake8`/`black --check`/`isort --check-only`
on `app/ tests/ alembic/` — clean. `validate_migrations.py --strict` — 444
revisions, single head `6ab7d903fae5` (unchanged). `check_route_permissions.py
--strict` — 228 routes, 0 errors, 0 warnings. `pytest tests/ -q -k "finance or
dues or approval or budget or export"` — 332 passed (unchanged from pass 5),
1 skipped (pre-existing, `py_vapid`), 0 failed.
`tests/test_permission_gate_branch_sweep.py` — 3 passed. Cross-cutting guard
tests (org-scoping ratchet, capacity locking, LIKE escaping, CSV writer
sweep) — 67 passed. Full backend unit suite (`pytest tests/ -m "not
integration and not slow and not docker"`) — 10,199 passed, 1 skipped
(pre-existing, `py_vapid`), 0 failed. Frontend: `npm run typecheck` — 0
errors; `npm run lint` — 0 errors, 0 warnings (no frontend file in this
feature's domain changed since pass 5, run anyway per the completion-gate
checklist).

---

## Pass 5 (2026-09-14)

**Scope.** No commit touched `endpoints/finance.py`, `services/finance_service.py`,
`public/finance_approvals.py`, or their direct dependencies (`models/finance.py`,
`schemas/finance.py`, `utils/model_updates.py`, `utils/csv_export.py`,
`utils/sql_search.py`, `utils/org_scoping.py`, `core/audit.py`) between pass 4's
closing merge (`320a143d`, PR #2398) and this pass's starting point on
`origin/main` — confirmed both with a pathspec-scoped `git log` (empty) and a
full, non-simplified walk of the 475 intervening commits (all either
security-review passes on other features or unrelated modules). With nothing to
diff, this pass re-read all three in-scope files end to end against the model
rather than spot-checking prior passes' claims, on pass 4's own stated theory
that a clean prior pass doesn't prove the next one is — which is exactly what
happened again this time.

**FIN-19 through FIN-30 (every prior pass's fix) re-verified present and
correct.** Read every method these findings name —
`_terminate_pending_steps`, `_chain_is_denied`, `_ensure_current_step`,
`_advance_reachable_steps` (the `DENIED`-early-return and the deferred
EMAIL-token issuance), `_validate_finance_fks` (station/apparatus/facility),
`_validate_budget_category_fks`, `_validate_approval_chain_fks`,
`_validate_chain_step_fks` (wired into `add_chain_step`, `update_chain_step`,
and `create_approval_chain`'s inline per-step loop), the route-registration
order for `GET /budgets/summary` and `GET /approval-chains/preview`,
`preview_approval_chain`'s 404-outside-`try` fix, and `get_pending_approvals`'
`Decimal`-straight-through `entity_amount` — all present, all still wired at
every call site the prior passes' write-ups name. `list_dues_payments`
(FIN-30) is still genuinely unbounded and still correctly left flagged rather
than fixed, for the same response-shape reason pass 4 gave.

### FIN-31 — MED — five money-ledger status transitions read their entity via a plain SELECT, letting two concurrent calls both pass the precondition check and both mutate the same Budget totals — ✅ FIXED

**What:** `mark_pr_paid`, `cancel_purchase_request`, `mark_expense_paid`,
`issue_check`, and `void_check` each followed the same shape: fetch the
entity with a plain (unlocked) `SELECT`, check its status in Python, flip it,
and — for the money-movement four — mutate the org's `Budget` row through
`_mutate_budget` (which _does_ lock the budget). This is CLAUDE.md Pitfall
#27 applied to a status transition instead of a seat count, and it is the
same shape FIN-10 (pass 2) already fixed for `approve_step`/`deny_step`: two
concurrent calls on the _same_ request/report/check both read the
precondition status off a plain SELECT before either commits, both pass it,
and both proceed into the budget mutation.

**Failure scenario, concrete:** a double-click (or two staff members) calling
`POST /purchase-requests/{id}/mark-paid` on the same PR at nearly the same
moment. Both requests read `status=APPROVED` from their own pre-commit
snapshot. The first acquires `_mutate_budget`'s lock on the `Budget` row,
moves `estimated_amount` from encumbered to spent, and commits (flushing its
own `status=PAID` write in the same unit of work). The second, still holding
its stale in-memory `status=APPROVED`, blocks on the _budget_ row lock (not
the PR row — nothing locked that), then proceeds once the first commits and
applies the identical delta a second time: `amount_spent` is credited twice
for one physical payment, unbounded (unlike a capacity cap, there is no
ceiling on a second correct-looking credit — the "less than or equal to
budgeted" check the ledger enforces is being fed an inflated `amount_spent`
it has no way to distinguish from a real second expense). A related, worse
interaction motivated including `cancel_purchase_request` in the same fix:
an _unlocked_ cancel racing a _locked_ `mark_pr_paid` reads a stale
pre-payment snapshot, and its own flush — which has no `WHERE status = ...`
guard, only `WHERE id = ...` — silently overwrites an already-committed
`PAID` status back to `CANCELLED` once its write finally lands, while its
(correctly locked) `_release_encumbrance` call further corrupts the budget
against the now-mismatched state. Fixing `mark_pr_paid` alone would not have
closed this — it would only have moved where the corruption surfaced.

**Where:** `backend/app/services/finance_service.py` —
`mark_pr_paid`, `cancel_purchase_request`, `mark_expense_paid`, `issue_check`,
`void_check`.

**Fix:** each method's initial entity fetch is now an inline
`select(...).where(...).with_for_update()`, matching the exact pattern
`update_budget` (FIN-11) and `approve_step`/`deny_step` (FIN-10) already use
— no shared getter was touched, since the read-only `get_purchase_request`/
`get_expense_report`/`get_check_request` getters are also called from
endpoints that must not take a write lock on every page view. `void_check`
additionally now reverses spend through `_mutate_budget(spent_delta=-amount)`
instead of a duplicated inline `budget.amount_spent = max(0, ... - amount)`
read-then-write, which was itself a second, independent instance of the same
class of bug: a plain read of the _budget_ row (not just the check request)
that could answer from a stale REPEATABLE READ snapshot taken before a
concurrent `_mutate_budget` writer (`issue_check`, `mark_expense_paid`)
committed, silently discarding that writer's spend.

**Scope decision — not fixed, flagged instead:** the same unlocked-read shape
also exists on `submit_purchase_request`/`submit_expense_report`/
`submit_check_request` (a race could create two parallel sets of approval-
chain records for one entity) and on `mark_pr_ordered`/`mark_pr_received`/
`update_purchase_request`/`update_expense_report`/`update_check_request`
(non-terminal, non-ledger transitions). These are lower severity — none
mutates the shared `Budget` ledger, and a raced double-submit is a duplicate-
state defect rather than a silent money-accounting corruption — and closing
all eight uniformly is a broader "lock every status transition in the
purchase/expense/check lifecycle" change than this pass's evidence
(demonstrated ledger corruption on five specific methods) supports fixing
under one commit without its own dedicated concurrency test pass across the
whole lifecycle. Recorded in `docs/KNOWN_LIMITATIONS.md` with the concrete
fix pattern (mirror `mark_pr_paid`'s locked read) for whoever picks it up.

**Guard test:** `tests/test_capacity_locking.py::TestFinanceDisbursementLocking`
— six tests, source-inspection style matching this file's existing
`TestFinanceApprovalStepLocking`/`TestFinanceBudgetCeilingOnUpdate` coverage:
one `with_for_update()` assertion per fixed method, plus an assertion that
`void_check` reverses spend through `_mutate_budget` rather than a
duplicated inline mutation of `Budget.amount_spent`. Confirmed to fail
against the pre-fix `finance_service.py` (`git stash` on that file alone,
re-run: all 6 fail — 4 on the missing lock, void_check's lock test plus its
`_mutate_budget` test) and pass after (`git stash pop`). Fixing this also
required updating `tests/test_money_separation_of_duties.py`'s
`TestFinanceDisbursementSoD`: four of its five tests stubbed
`svc.get_purchase_request`/`get_expense_report`/`get_check_request` directly,
which the production code no longer calls from these five methods — updated
to mock `db.execute` instead (matching the fifth test, `waive_dues`'s, which
already did), with no change to what each test actually proves.

### FIN-32 — LOW — no audit trail on any disbursement action or on either public token-approval action — ✅ FIXED

**What:** `finance_service.py` has zero `log_audit_event` call sites of its
own (confirmed: `grep -rn log_audit_event backend/app/services/
finance_service.py` returns nothing), so every audit event this module emits
is an endpoint-layer choice. Of the ~46 mutating routes in `finance.py`,
8 call `log_audit_event` — fiscal-year create/activate, approval-chain
create, `approve_step`/`deny_step`, purchase-request create/submit, and
dues-waiver reversal — and the six actual money-movement/disbursement
actions had none: `mark_pr_paid`, `mark_expense_paid`, `issue_check`,
`void_check`, `record_dues_payment`, `waive_dues`. The two public,
unauthenticated token-approval actions (`approve_via_token`/`deny_via_token`
in `public/finance_approvals.py`) had none either — arguably the higher-value
gap of the two, since these are the approval-chain actions taken by someone
with no Logbook account at all. CLAUDE.md's Backend Patterns section calls
for `log_audit_event()` on audit-sensitive operations generally, and this
pass's checklist named "approval/rejection/disbursement" specifically — the
first two were already covered; disbursement was not.

**Not a live security defect** (nothing was unauthorized or unscoped — every
one of these actions already carries its own permission gate and, on the
money-movement ones, the `assert_different_person` SoD guard) but a real
observability/compliance gap on a financial ledger: a department cannot
answer "who paid this, and when" from the audit log for any of these six
internal actions, or "who approved/denied this from outside the app" for the
two token actions — only from the entity's own `paid_at`/`acted_by` columns,
which are irreversible/legally weaker than the tamper-evident hash-chained
audit log described in `core/audit.py`.

**Where:** `backend/app/api/v1/endpoints/finance.py` (6 endpoints);
`backend/app/api/public/finance_approvals.py` (2 endpoints).

**Fix:** added `log_audit_event` calls following the file's own established
pattern exactly (`event_category="finance"`, `severity="info"` for a normal
disbursement/payment/approval, `"warning"` for a reversal or a foregone
receivable — voiding a check, waiving dues, denying via token — matching the
existing `deny_step`/`dues_waiver_reversed` severity choices). The two public
endpoints follow the no-`user_id` convention already used by
`paypal_webhook.py`'s `log_audit_event` call for an external-actor event
(`organization_id` passed explicitly, resolved from the already-loaded
`record.chain.organization_id`, `user_id` omitted since an email-token
approver has no Logbook account). `waive_dues`'s event deliberately omits the
waive reason from `event_data`, matching `unwaive_dues`'s existing comment
that a waive reason may carry sensitive personal information and must stay
eligible for the app's privacy-scrubbing guarantees.

**Not fixed, and not flagged as a gap:** budget/category/fiscal-year/
approval-chain-step CRUD, QuickBooks export-mapping CRUD, and the CSV export
route remain without `log_audit_event`. The export path already writes its
own domain-specific `ExportLog` row (`exported_by`, `record_count`, `status`,
`error_message`) on every attempt, which serves the same purpose for that
one action; the CRUD actions are configuration, not money movement or an
approval/rejection/disbursement decision, and adding audit events to all of
them is a much larger, separate completeness pass this finding's evidence
doesn't call for.

**Disposition: FIN-31 and FIN-32 both FIXED.** No open items from this
pass's own review beyond the two explicitly deferred and documented above
(the eight non-ledger status-transition locks, and `get_pending_approvals`'
per-assignee filtering, which pass 1 already flagged and remains unchanged —
there is still no per-step assignee field to filter on).

**Verified good ✅ (re-confirmed by direct read, not re-derived from a prior
pass's word):** all 66 routes still carry `require_permission`; every by-id
read/update/delete across all twelve finance entity types is org-scoped
(walked every service method, not sampled); `approve_step`/`deny_step`/
`approve_by_token`/`deny_by_token` all still `.with_for_update()` their
`ApprovalStepRecord` read and call `_ensure_current_step`;
`mark_pr_paid`/`mark_expense_paid`/`issue_check`/`waive_dues` all still call
`assert_different_person`; `_validate_finance_fks` and its three siblings
still cover every client-supplied FK named across `schemas/finance.py`; the
one `.like()` (`_generate_request_number`) still declares
`escape=LIKE_ESCAPE_CHAR` against a system-generated pattern;
`export_transactions`'s CSV path still uses only `SafeCsvWriter`, still caps
at `max_records=10_000`, still streams in `batch_size=500` pages; every
`except` still routes through `safe_error_detail()`; no in-memory
dict/set-based cache or tracker exists anywhere in the three in-scope files
(Pitfall #9 — n/a); the two JSON columns in `models/finance.py`
(`notification_emails`, `applies_to_membership_types`) are always assigned
wholesale on create/update, never read-modified-in-place-and-reassigned, so
Pitfall #12 does not apply; `public/finance_approvals.py`'s token bounds/
pattern, rate limit, 404-before-400 ordering, and email-address
self-approval guard all present and unchanged except for the two new
`log_audit_event` calls (FIN-32) — no change to token validation, expiry, or
replay behavior.

**Completion gate (pass 5):** `flake8`/`black --check`/`isort --check-only`
on `app/ tests/ alembic/` — clean. `validate_migrations.py --strict` — 444
revisions, single head `6ab7d903fae5`. `check_route_permissions.py --strict`
— 228 routes, 0 errors (no route added or removed this pass).
`pytest tests/ -q -k "finance or dues or approval or budget or export"` —
332 passed (326 pre-existing + 6 new locking guards), 1 skipped
(pre-existing, `py_vapid`), 0 failed. Full backend suite (`pytest tests/
-q`) — **12,556 passed, 21 skipped (all pre-existing environment-only:
`py_vapid`, Docker-unavailable/unreachable integration tests, the opt-in API-
contract suite), 0 failed.** Cross-cutting guard tests (org-scoping ratchet,
LIKE escaping, CSV writer sweep, capacity locking including the 6 new tests)
64 passed. No frontend file changed by this pass, so `tsc --noEmit`/
`eslint .`/`vitest run src/modules/finance/` were not re-run — the
assignment's own completion-gate condition for those (`if you touched any
frontend files`) was not met.

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
