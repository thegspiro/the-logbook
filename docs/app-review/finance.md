# Application Review — Finance (Tier B, 2nd pass)

**Prefix:** `FIN2` · **Iteration:** B20 · **Reviewed:** 2026-08-06

**Backend:** `endpoints/finance.py` (~1,370 L, 41 endpoints),
`services/finance_service.py` (~1,930 L)
**Frontend:** `modules/finance`
**Prior audit:** `docs/module-audit/finance.md` (iteration 20) — FIN-1 (CRITICAL
budget corruption), FIN-2, FIN-3 (dues PII), FIN-6 (dues idempotency) fixed; FIN-7
partly fixed; FIN-4 (disburse SoD), FIN-5 (view scoping) flagged.

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

### FIN-4 / FIN-5 / FIN-7 — 🚩 FLAGGED (unchanged, product/behavior decisions)

- **FIN-4** — no `finance.disburse` separation: one `finance.manage` holder can
  create a request *and* mark it paid / issue the check / record-or-waive dues. The
  approval-chain step is SoD-guarded; the *disbursement* actions are not. Needs a
  new treasury permission on roles. (In `KNOWN_LIMITATIONS.md`.)
- **FIN-5** — reimbursement/payee lists readable by any `finance.view` holder
  (XC-2 shape, lower sensitivity than dues). Scoping non-managers to their own
  submissions is a behavior change for treasurers. (In `KNOWN_LIMITATIONS.md`.)
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
