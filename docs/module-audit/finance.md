# Module Audit — Finance

**Scope:** `api/v1/endpoints/finance.py` (~1,370 L, 41 endpoints — fiscal years,
budgets, categories, approval chains, purchase requests, check requests, expense
reports, member dues, transaction export) and `services/finance_service.py`
(~1,930 L). Money-handling module: budgets with encumbrance/spend running
totals, multi-step approval chains, and member dues collection. Frontend
`modules/finance`.
**Audited:** iteration 20 — two parallel readers: (A) service-layer tenant
isolation + financial correctness; (B) endpoint-layer access control + SoD.

## Verified good ✅

- **All 41 endpoints are `require_permission`-gated** (none fall through to bare
  `get_current_user`). Config mutations require `finance.manage`; approval-chain
  CRUD requires the dedicated `finance.configure_approvals`; approve/deny require
  `finance.approve`.
- **Approval-step IDOR is explicitly closed.** `approve_step`/`deny_step` join
  `ApprovalChain` and filter `organization_id` before acting, and use
  `str(current_user.id)` as the approver (not a body field, so the approver id
  can't be spoofed). Status guards (`status != PENDING → raise`) block
  re-approval double-credit.
- **By-id reads/updates/deletes are org-scoped** across the public surface
  (fiscal years, categories, budgets, chains, PRs, CRs, expense reports, dues,
  export mappings). **XC-3 clean.**
- **Terminal money-movement has status guards** (`mark_pr_paid`,
  `mark_expense_paid`, `issue_check`, `void_check`, `submit_*`) preventing
  repeated spend posting. `void_check` reverses spend through the org-scoped
  `get_budget`. `generate_member_dues` is idempotent (skips existing
  schedule+user) and org-scopes the eligible-user query.
- **No SQL injection** — the one `.like()` (`_generate_request_number`) takes no
  client input (internal `PR/ER/CK` prefix + fiscal-year); parameterized
  everywhere else, no raw SQL.
- **Errors sanitized** — every `try/except` routes `ValueError`→400 /
  `Exception`→500 through `safe_error_detail`.

## Findings

### FIN-1 — HIGH (XC-1, dangerous variant) — Unvalidated `budget_id` corrupted another department's budget totals — ✅ FIXED

A client-supplied `budget_id` on a purchase request / check request / expense
line item was stored with no in-org check, then flowed into three budget
write-helpers (`_encumber_budget`, `_release_encumbrance`, `_add_to_spent`) that
fetched the budget by **bare id with no org filter** and incremented its
`amount_encumbered` / `amount_spent`. Reachable from ordinary approve / pay /
issue / cancel flows. Impact: a caller in org A submits a request referencing org
B's `budget_id`; on approval/payment the service silently corrupts **org B's**
budget running totals (never surfaced, since the foreign budget is never read
back org-scoped).
**Fix (two layers):** (1) the three helpers now take `org_id` and filter
`Budget.organization_id == org_id` — the referencing record's org is passed at
every call site, so a foreign budget can never be encumbered/spent (defense in
depth). (2) A new `_validate_finance_fks` helper rejects a foreign
`budget_id`/`category_id`/`fiscal_year_id` at create/update time (PR, CR, expense
report + line items, budget), so the FK fails closed with a clear error instead
of silently no-op'ing the encumbrance.

### FIN-2 — MEDIUM (XC-1) — `create_budget` stored `fiscal_year_id`/`category_id` without in-org validation — ✅ FIXED

A budget could be bound to another org's fiscal year or category, polluting
cross-tenant references and the summary/list filtering. **Fix:** covered by the
same `_validate_finance_fks` call now in `create_budget`/`update_budget`.

### FIN-3 — HIGH (XC-2, cross-member PII) — `GET /dues` leaked any member's dues to any `finance.view` holder — ✅ FIXED

`list_member_dues` passed the client `user_id` query param straight to the
service (`WHERE MemberDues.user_id == user_id`) with no self-scoping, gated only
by the broad `finance.view` (roster-level read). Any member with `finance.view`
could read any other member's dues balances / delinquency status by id.
**Fix:** a caller without `finance.manage` (the permission that records/waives
dues payments) is now confined to their own `user_id` regardless of the requested
id; dues managers keep the cross-member view. Members still see their own dues.

### FIN-4 — MEDIUM (flagged) — No separation of duties on terminal money movement

`mark_pr_paid`, `mark_expense_paid`, `issue_check`, `void_check`,
`record_dues_payment`, `waive_dues` are all gated by `finance.manage` — the same
permission used to _create_ the underlying request. One person can create a
purchase/check and also mark it paid / issue the physical check. **Status:**
flagged — closing it needs a distinct `finance.disburse`/treasury permission on
roles (behavior change).

### FIN-5 — MEDIUM (flagged) — Reimbursement/payee records readable by any `finance.view` holder

`list_expense_reports` / `list_check_requests` / `list_purchase_requests` (and
their get-by-id) are `finance.view` with no owner scoping, so any viewer sees
every member's reimbursement amounts and payee detail. Lower sensitivity than
dues (FIN-3) but the same XC-2 shape. **Status:** flagged — scoping non-managers
to their own submissions is a behavior change for treasurers on `.view`.

### FIN-6 — MEDIUM — ✅ FIXED (2026-08-04) — `record_dues_payment` has no idempotency and no status guard

`amount_paid += amount` accumulated on every call with no dedup on the
client-supplied `transaction_reference`, so a retried/replayed payment
double-credited collections; recording a payment against a `WAIVED` record
silently recomputed it to `PAID`/`PARTIAL`, destroying the waive (and moving the
waived amount into collections, since `get_dues_summary` derives `total_waived`
from `status == WAIVED`); and `payment_method` / `transaction_reference` /
`notes` were each assigned `kwargs.get(...)` against an endpoint that passes
`**data.model_dump()`, so every call blanked whatever an earlier payment had
written.

**Fix.** The three shared one cause — `MemberDues` was the only record of
payment, so nothing recorded that a payment had _happened_. A `dues_payments`
ledger (migration `20260802_0001`) now holds one row per payment and the columns
on `MemberDues` are a projection of it:

- `amount_paid` is **re-derived** by `_apply_payment_totals` as the sum of the
  ledger rather than accumulated. A double-credit would require a duplicate
  ledger row, which `UniqueConstraint(member_dues_id, transaction_reference)`
  refuses — the bug class stops being representable rather than being guarded.
  Re-submitting a known reference returns the record untouched, so a
  double-clicked form is safe. Unreferenced cash is never deduplicated: two
  identical cash amounts are two payments.
- `payment_method` / `transaction_reference` / `notes` project the newest ledger
  row, so they can no longer be blanked or contradict the ledger.
- `WAIVED` and `EXEMPT` refuse payment. `EXEMPT` was included because it is the
  same shape, though the audit named only `WAIVED`.
- The migration **backfills** one row per already-paid record — without it a
  derived total would recompute an existing balance to zero.

**Companion.** `POST /finance/dues/{id}/unwaive` (`finance.manage`, reason
required) is the deliberate reversal that replaces the old accidental one; the
ledger decides the restored status, and the erased waive reason is carried into
a `finance.dues_waiver_reversed` audit event rather than left on an un-waived
row. `GET /finance/dues/{id}/payments` (`finance.view`) exposes the ledger.
15 unit tests over `_apply_payment_totals`, which is pure and therefore runs in
CI's unit job rather than needing MySQL. **Status:** fixed.

### FIN-7 — LOW/MED — partially FIXED — Correctness/DoS polish

- **✅ `add_expense_line_item` total drift fixed.** It recomputed `total_amount`
  as `sum(er.line_items) + item.amount`, where `er.line_items` may or may not
  already include the just-added row (depending on load timing) → double-count /
  drift. It now recomputes from a fresh `SUM(amount)` aggregate over the
  persisted line items, which is authoritative.
- **✅ Fixed (2026-07-31):** `_generate_request_number` used `count()+1`
  (race → duplicate `PR-YYYY-NNNN`; count-based numbering also re-issued
  numbers after deletions). Worse, the columns were **globally** unique while
  numbering was per-org — org B's first `PR-2026-0001` collided with org A's.
  Migration `20260801_0011` replaces the global unique with a per-org
  composite (`uq_*_org_number`), the generator is now MAX-of-suffix-based,
  and creates go through `_flush_with_unique_number` — a SAVEPOINT-wrapped
  retry-on-conflict allocator (offset stepping defeats REPEATABLE READ
  snapshot staleness) that never poisons the caller's outer transaction.
  Covered by `TestRequestNumberAllocation` in `tests/test_finance.py`.
- **✅ Mostly resolved (re-verified, security-review FIN-05 pass 4, 2026-09-08;
  corrected same-day after Codex review on PR #2398 caught one overclaim —
  see FIN-30).** The three items below were still described as open by this
  entry, and two of the three were not: current code already carries the fix
  each calls for, with no commit in this rotation's own log claiming credit —
  they landed as
  incidental improvements in the finance-approvals security-review passes
  (pass 1's request-number migration, pass 2's export-streaming rewrite) that
  were never threaded back into this older audit doc. Re-verified against the
  code directly, not taken on any doc's word:
  - **"Unbounded transaction export and in-memory pagination (fetch-all-then-
    slice) on the list endpoints"** — **partially resolved (corrected
    2026-09-08, Codex review on PR #2398 — see FIN-30):** every list method
    the original finding named (`list_purchase_requests`, `list_expense_
reports`, `list_check_requests`, `list_budgets`, `list_dues_schedules`,
    `list_export_mappings`, `list_export_logs`, …) pushes `.offset()`/
    `.limit()` into the SQL query itself; none fetches the full table into
    Python first. `generate_export` (`finance_service.py:2496`) counts rows
    up front and refuses anything over `max_records=10_000` (`ValueError` →
    400), then streams the CSV in `batch_size=500` pages via `SafeCsvWriter`,
    writing an `ExportLog` row (`status`/`error_message`/`completed_at`,
    from migration `20260826_1700_add_export_stream_status`) that records
    `partial`/`failed` if the stream is interrupted. **Still open:**
    `list_dues_payments` (`finance_service.py:2325`, backing
    `GET /dues/{dues_id}/payments`) is also a list method and does **not**
    paginate — it eager-loads a member's entire payment ledger with no
    `.offset()`/`.limit()`. Scoped to one member's dues record rather than
    the whole org, but genuinely unbounded; not fixed because pagination
    would change the endpoint's response shape (`list[DuesPaymentResponse]`
    today), a frontend-contract decision rather than a drive-by fix.
  - **"No overspend/negative-balance guard on spend posting"** —
    `_mutate_budget` (`finance_service.py:2778`) takes the budget row
    `.with_for_update()` and raises `BudgetLimitExceededError` (→ 409) whenever
    `new_spent + new_encumbered > amount_budgeted`, on every path that
    encumbers or spends (`_encumber_budget`/`_release_encumbrance`/
    `_add_to_spent`, and `update_budget`'s own reduce-side check per FIN-11).
    Deliberately fail-closed with no override, per the comment at
    `finance_service.py:2751`.
  - **`_generate_request_number` `count()+1` race** — this file's own bullet
    two lines above already marked this fixed (2026-07-31); only the summary
    bullet below it had not caught up.
    Genuinely unchanged: **float→Decimal is not a module-wide gap** — every
    money _column_ is `Numeric(12, 2)` (`models/finance.py`) and every money
    _computation_ (`_mutate_budget`, `_apply_payment_totals`, `get_dues_summary`'s
    totals) is `Decimal` arithmetic throughout; the only `float()` calls left in
    `finance_service.py` are two percentage/rate display roundings
    (`percent_used`, `collection_rate`), which are not currency amounts and do
    not need cent precision. One straggler was found and fixed this pass:
    `get_pending_approvals` cast `entity_amount` through `float()` before
    `PendingApprovalResponse` (which types it `Decimal`) revalidated it — a
    needless, precision-risking round-trip with no live bug at this table's
    size (`Numeric(12,2)` fits exactly in a float64 mantissa), removed by
    passing the `Decimal` straight through.
    `get_pending_approvals` returning the org-wide queue is unchanged from the
    correction already recorded in `KNOWN_LIMITATIONS.md`: the query itself has
    been org-confined since FIN-9 (2026-08-25); only the assignee-level filter
    (return each approver only _their own_ actionable steps rather than every
    org approver's) is the remaining behavior-change item, and it still needs an
    owner decision on what "assigned to me" means when a step has no
    per-user assignment field today.

## Notes

- `get_approval_records` / `get_current_pending_step` query `ApprovalStepRecord`
  by `entity_type`+`entity_id` with no org filter, **but** are not reachable from
  any endpoint — every internal caller resolves the parent entity org-scoped
  first. Verified not live; noted for future defense-in-depth.
  **Re-verified (app-review B20):** still not live across all 7 call sites.
  Deliberately **not** threaded — adding `org_id` through these two helpers plus
  `_advance_notification_steps`/`_check_all_steps_complete` and 7 call sites would
  churn the critical money-approval path for zero live benefit; the regression risk
  outweighs a redundant filter. Left flagged.
  **Correction (security-review FIN-9, 2026-08-25):** the sibling method
  `get_pending_approvals` — the query actually reachable from `GET
/finance/approvals/pending` — carried no organization filter either, and
  unlike these two was live: it scanned every tenant's pending approval steps
  on every call, not merely "the org-wide queue" this doc previously implied.
  Fixed to resolve each entity type's org-scoped id set before the record
  query runs; see `docs/security-review/FIN-05-finance-approvals.md`.
- Large-module caveat: `finance_service.py` (~1,930 L) was reviewed for security
  invariants (org-scoping, XC-1/3, financial correctness), not line-by-line. The
  invariants held on every path examined.
