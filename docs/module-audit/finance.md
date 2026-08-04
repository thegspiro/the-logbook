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
permission used to *create* the underlying request. One person can create a
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
payment, so nothing recorded that a payment had *happened*. A `dues_payments`
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
- **Flagged (cross-cutting refactor):** float money math in
  `get_budget_summary`/`get_dues_summary` and throughout the spend-tracking path
  (`_add_to_spent`, budget comparisons, response payloads). Converting money to
  `Decimal` end-to-end (with JSON serialization handling) is a module-wide change;
  a partial conversion would leave the service inconsistent. Deferred as a
  dedicated task.
- **Flagged (DoS surface, behavior change):** unbounded transaction export and
  in-memory pagination (fetch-all-then-slice) on the list endpoints — pushing
  `skip`/`limit` into the queries and capping the export range is the fix, but it
  touches many endpoints and changes response envelopes. Deferred.
- **Flagged (behavior change):** no overspend/negative-balance guard on spend
  posting; `get_pending_approvals` returns the org-wide queue rather than the
  caller's assigned steps. Both change established behavior and need an owner
  decision.
**Status:** the safe correctness fix (line-item total) applied; the rest remain
flagged as behavior-change or schema/sequence-change (per original triage).

## Notes
- `get_approval_records` / `get_current_pending_step` query `ApprovalStepRecord`
  by `entity_type`+`entity_id` with no org filter, **but** are not reachable from
  any endpoint — every internal caller resolves the parent entity org-scoped
  first. Verified not live; noted for future defense-in-depth.
- Large-module caveat: `finance_service.py` (~1,930 L) was reviewed for security
  invariants (org-scoping, XC-1/3, financial correctness), not line-by-line. The
  invariants held on every path examined.
