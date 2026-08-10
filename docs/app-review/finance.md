# Application Review — Finance (Tier B)

**Prefix:** `FIN2` · **Iteration:** B20 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-08 (pass 2), 2026-08-09 (pass 3), 2026-08-09 (pass 4)

---

## Pass 4 (2026-08-09) — invariants re-verified, no code change

Re-verified this well-hardened money module: **FIN-4** disburse-side SoD
(`assert_different_person` on `mark_pr_paid`/`mark_expense_paid`/`issue_check`/
`waive_dues`, 6 refs), **FIN-5** `restrict_to_user` view scoping, and
`_validate_finance_fks` (13 refs — wired into the budget/PR/CR/expense create+update
paths) all hold; FIN2-1 enum validators intact; `finance_service.py` E712-free.
The known DiD gap (`get_approval_records`/`get_current_pending_step` unscoped)
stays re-confirmed **not live** — every call site passes an already-org-resolved
`entity_id`.

Open items unchanged, both refactor-shaped: **FIN-7** (float→Decimal money math +
unbounded transaction export/pagination + overspend guard) and **FIN-N** (the
`ApprovalStepRecord` helpers stay unfiltered — verified not-live; threading `org_id`
through the critical money-approval path isn't worth the churn).

**Completion gate (pass 4):** no code changed; `flake8` 0 · `black --check` clean ·
`tsc --noEmit` n/a.

---

## Pass 3 (2026-08-09) — FIN-4 & FIN-5 now resolved; latent-500 fixed

Two of the module's standing flags were **closed earlier this session** via owner
decisions, and re-verified here:

- **FIN-4 — ✅ RESOLVED (person-based SoD).** The disburse-side self-service gap is
  closed: `mark_pr_paid`, `mark_expense_paid`, `issue_check`, and `waive_dues` now
  call `assert_different_person` (service 649/1288/1511/1649/1898), so the requester
  can't also disburse — the same person-based guard `approve_step` already used
  (owner decision 2026-08-09, chosen over minting a new `finance.disburse`
  permission). Automatic payment reconciliation stays exempt.
- **FIN-5 — ✅ RESOLVED.** `list_expense_reports`/`get_expense_report` take
  `restrict_to_user` (service 1345/1365); a plain `finance.view` holder sees only
  their own reimbursements, treasurers the full queue.

### FIN2-1 — LOW/MED — Approval/PR/dues/expense/export enum fields 500 on a bad value — ✅ FIXED

**What:** `applies_to`, `step_type`, `approver_type` (approval chains/steps),
`frequency` (dues), `expense_type` (line items), `mapping_type` (QB export), and
`priority` (purchase requests) — **13 fields across 8 request schemas** — map to
strict MySQL ENUM columns but were typed as free `str` with **no `field_validator`**
and stored raw, so an out-of-set value 500'd at MySQL. The B1 class, in the money
module.

**Fix (input-validation only — no money math touched):** a shared `_enum_check`
helper + `@field_validator`s on all 8 request classes, each deriving its set from the
model enum (`ApprovalEntityType`/`ApprovalStepType`/`ApproverType`/`DuesFrequency`/
`ExpenseType`/`ExportMappingType`/`PurchaseRequestPriority`), → 422. Amounts and the
FIN-7 float→Decimal item are untouched. Request-only, so responses are unchanged.
**8 tests added.** (E712 was already swept in pass 2; `finance_service.py` stays
E712-free.)

### Still flagged (unchanged)

- **FIN-7 residual** — float→Decimal money-math refactor, unbounded transaction
  export/pagination, overspend guard, org-wide pending-approvals queue.
- **FIN-N** — the `ApprovalStepRecord` helpers stay unfiltered (verified not-live;
  threading `org_id` through the critical money-approval path isn't worth the churn).

**Completion gate (pass 3):** `flake8` 0 · `black --check` clean · `tsc --noEmit`
n/a (no frontend change) · new enum tests **8 passed** + finance unit tests **32
passed** (DB-free; the `db_session` errors are the known no-MySQL fixture failures).

---

**Backend:** `endpoints/finance.py` (~1,370 L, 41 endpoints),
`services/finance_service.py` (~1,930 L)
**Frontend:** `modules/finance`
**Prior audit:** `docs/module-audit/finance.md` (iteration 20) — FIN-1 (CRITICAL
budget corruption), FIN-2, FIN-3 (dues PII), FIN-6 (dues idempotency) fixed; FIN-7
partly fixed; FIN-4 (disburse SoD), FIN-5 (view scoping) flagged.

---

## Pass 2 (2026-08-08) — six-lens sweep

Re-verified this well-hardened module: FIN-1/2/3/6 closed; `_validate_finance_fks`
wired into the budget/PR/CR/expense create+update paths; org-scoped budget
write-helpers; `approve_step`'s `assert_different_person`; both ratio computations
guard their denominators (no divide-by-zero 500). The known DiD gap
(`get_approval_records`/`get_current_pending_step` unscoped) re-confirmed **not
live** (every call site passes an already-org-resolved `entity_id`). **1 fix.**

### FIN-8 — LOW — Dues-schedule create/update skipped the finance FK validator (XC-1) — ✅ FIXED

`_validate_finance_fks` guards budget/PR/CR/expense writes, but `create_dues_schedule`
and `update_dues_schedule` — the one create/update pair the "all 7 paths" claim
didn't cover — never called it, while `DuesScheduleCreate/Update` expose a client
`fiscal_year_id` splatted straight onto the row. Impact is bounded to a dangling
cross-tenant reference (`DuesScheduleResponse` exposes only the id, no eager-loaded
fiscal-year name; `generate_member_dues` reads only `amount`/`due_date`), so no
read-leak or money corruption today — but it's the exact FK the validator exists to
catch. **Fix:** call `_validate_finance_fks` at the top of `create_dues_schedule`
and after the not-found check in `update_dues_schedule` (the helper already
validates `fiscal_year_id` and no-ops on absent keys). 2 regression tests
(create + update reject a foreign fiscal year).

**Flagged (unchanged):** FIN-4 (disburse-side SoD — `issue_check`/`mark_pr_paid`/
`mark_expense_paid` need only `finance.manage`, no requester≠disburser check),
FIN-5 (view scoping), FIN-7 residual (float→Decimal money math). Also noted (LOW,
not fixed here): `PendingApprovalResponse.requester_name` is hardcoded `""` in
`_get_entity_info` — a cosmetic MS2-4 unpopulated-name, no security impact.
Cross-module FKs `station_id`/`apparatus_id`/`facility_id` on budget/PR are
consistently unvalidated on **both** create and update (SET NULL, no projection) —
pass-1's deliberate finance-FK-only scope, noted for a future cross-module batch.

---

## Scope

Tier B: the open items. Finance is one of the best-hardened modules — the
money-corruption and PII paths (FIN-1/2/3/6) are closed. The remaining findings
are genuinely product/behavior decisions or a verified-not-live defense-in-depth
item, so this pass **re-confirmed** the fixes, made a deliberate no-thread decision
on the not-live item, and applied one safe cleanup.

## Findings

### No new code-level security findings.

Re-confirmed present and correct:
- `_validate_finance_fks` is wired into every create/update path (PR, CR, expense
  report + line items, budget: lines 260/271/1171/1196/1369/1371/1406), so a
  foreign `budget_id`/`category_id`/`fiscal_year_id` fails closed — **FIN-1/FIN-2
  hold**. The three budget write-helpers still take and filter `org_id`.
- FIN-3 dues self-scoping (non-`finance.manage` callers confined to their own
  `user_id`) and FIN-6's `dues_payments` ledger + `_apply_payment_totals`
  (re-derived totals, `UniqueConstraint(member_dues_id, transaction_reference)`,
  WAIVED/EXEMPT refuse payment) hold.
- `approve_step` calls the shared `assert_different_person` guard (FIN-4's
  approval-chain half) and is org-scoped via the `ApprovalChain` join.

### FIN-N (Notes item) — LOW — `get_approval_records`/`get_current_pending_step` lack an org filter — 🚩 FLAGGED (verified not-live; deliberately not threaded)

These two helpers query `ApprovalStepRecord` by `entity_type`+`entity_id` with no
org filter. Re-verified **not live**: every one of the 7 call sites reaches them
with an `entity_id` that the caller already resolved through an org-scoped parent
fetch (approve/deny are org-scoped via the chain join; the money-movement callers
resolve the PR/CR/expense org-scoped first). Threading an `org_id` through
`get_approval_records`, `get_current_pending_step`, `_advance_notification_steps`,
`_check_all_steps_complete` and all 7 call sites would churn the **critical
money-approval path** for **zero live benefit** — the regression risk there
outweighs a redundant filter. Deliberately left flagged rather than threaded;
recorded as future defense-in-depth.

### FIN-4 / FIN-7 — 🚩 FLAGGED (unchanged, product/behavior decisions); FIN-5 ✅ RESOLVED

- **FIN-4** — no `finance.disburse` separation: one `finance.manage` holder can
  create a request *and* mark it paid / issue the check / record-or-waive dues. The
  approval-chain step is SoD-guarded; the *disbursement* actions are not. Needs a
  new treasury permission on roles. (In `KNOWN_LIMITATIONS.md`.)
- **FIN-5** — ✅ RESOLVED (owner decision, 2026-08-09). Reimbursement (expense
  report) lists/reads were readable by any `finance.view` holder. `list_expense_reports`
  and `get_expense_report` now take `restrict_to_user`: the endpoints pass the
  caller's id unless they hold `finance.manage`, so a plain `finance.view` holder
  sees only their own reimbursement submissions while treasurers keep the full org
  queue. Mutation callers pass no restriction (unchanged). Covered by
  `tests/test_read_permission_gates.py`.
- **FIN-7 residual** — float money math (module-wide Decimal refactor), unbounded
  transaction export + in-memory pagination (DoS surface, response-envelope
  change), no overspend/negative-balance guard, and `get_pending_approvals`
  returning the org-wide queue. All behavior/schema-change or large refactors,
  deferred per the original triage.

## Cleanup applied

Swept the 2 `== True  # noqa: E712` suppressions in `finance_service.py` to
`.is_(True)` (Pitfall #10). Behavior-neutral.

## Verified good ✅

- All 41 endpoints `require_permission`-gated; approval-step IDOR closed (chain
  join + `str(current_user.id)` approver); by-id reads/updates/deletes org-scoped;
  terminal money-movement status-guarded; errors sanitized via `safe_error_detail`.

## Documentation

`docs/module-audit/finance.md` Notes updated (the ApprovalStepRecord item now
carries the deliberate no-thread rationale). FIN-4/5 already mirrored in
`KNOWN_LIMITATIONS.md`.

## Future development

1. **FIN-4** — `finance.disburse` treasury permission.
2. **FIN-7** — float→Decimal; bounded export/pagination; overspend guard.
3. **FIN-N** — org-filter the approval-record helpers if the approval path is
   refactored to carry `org_id` (not worth a standalone churn).

## Completion gate

| Check | Result |
|-------|--------|
| `flake8` (service) | ✅ 0 violations |
| `black --check` | ✅ unchanged |
| `tsc --noEmit` | ✅ n/a — no frontend change |
| backend tests | ✅ `test_finance` + `test_dues_payment_guards`: **19 passed** (the pure unit tests — allocation, `_apply_payment_totals`); 30 DB-fixture errors (no MySQL), unchanged from baseline. E712 change behavior-neutral. |
