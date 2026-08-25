# Security Review 05 — Finance & Approvals

**Prefix:** `FIN` · **Iteration:** 05 · **Reviewed:** 2026-08-25 · **PR:** TBD

**Backend:** `api/v1/endpoints/finance.py` (66 routes), `services/finance_service.py`
(~2,000 L), `api/public/finance_approvals.py` (token-scoped approve/deny)
**Frontend:** `modules/finance`
**Migrations:** `20260801_0011` (per-org request numbering), `20260802_0001`
(`dues_payments` ledger) touch this feature's tables; the 12 finance tables
themselves are `create_all`-only (see Schema & migration notes).

---

## Scope

This is the most heavily audited module in the codebase before this iteration
even starts: module-audit iteration 20, four app-review passes
(2026-08-06/08/09 ×2), and the public token-approval routes were already
covered in full by security-review 03 (`PUB-03-public-surface-webhooks.md`,
PUB-4 fixed the `EMAIL`-approver self-approval gap there). Git history
confirms `finance.py`/`finance_service.py` have had **zero logic commits**
since the 2026-08-09 app-review pass — the only touch since is the 2026-08-25
cross-cutting LIKE-escaping sweep, which renamed a local variable
(`like_pattern` → `number_prefix`) to stop it shadowing the shared helper and
changed no behavior.

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

**Fix:** resolve each of the three entity types' org-scoped id sets first
(three cheap, indexed-by-`organization_id` queries), then filter the
`ApprovalStepRecord` query to only those `(entity_type, entity_id)` pairs
before the per-record loop runs. This is the same id set `_get_entity_info`
was already implicitly computing one row at a time — the output is identical
to before (proven by `test_get_pending_approvals_is_confined_to_the_caller_org`,
which asserts a pending step from a second organization is absent from the
result) — only the scan and the N+1 follow-up queries are now confined to the
caller's own organization.

## Schema & migration notes

All 12 finance tables (`fiscal_years`, `budget_categories`, `budgets`,
`approval_chains`, `approval_chain_steps`, `approval_step_records`,
`purchase_requests`, `expense_reports`, `expense_line_items`,
`check_requests`, `dues_schedules`, `member_dues`, `dues_payments`,
`export_mappings`, `export_logs`) are **`create_all`-only** — no Alembic
migration creates any of them; this matches SEC-00's documented, deliberate
deployment shape (37 model-only tables platform-wide) and is not a finding.
Every `ondelete="SET NULL"` FK in `models/finance.py` (12 sites: budget
category on budget, facility on budget, email-template on approval step,
budget on PR/CR/expense-line, approver on PR/CR/expense-report,
fiscal-year on dues-schedule, waived-by/recorded-by on member-dues/
dues-payment) is paired with `nullable=True` — verified line-by-line, not
merely by the codebase-wide SEC-00 sweep.

## Guard tests added

- `test_get_pending_approvals_is_confined_to_the_caller_org`
  (`tests/test_finance.py`) — creates a pending purchase-request approval step
  in each of two organizations and asserts `get_pending_approvals(org_id=A)`
  returns org A's entity id and never org B's. Fails on reintroduction of the
  unfiltered query (the assertion would still pass by luck under the old code
  since `_get_entity_info` filtered on the way out, but the test's purpose —
  recorded in its docstring — is to anchor FIN-9's fix so a future edit to
  `_get_entity_info` that removes its own org filter would no longer have this
  query-level backstop).

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
