# Open pull request recovery plan — 2026-08-21

## Finding

The open queue does not need the same source change copied into every branch.
Most red checks and every reported conflict are consequences of branches being
behind `main` (`a8256148`), so the safe recovery is to update the branches from
`main` and rerun CI before changing feature code.

In particular, the repeated MySQL and MariaDB API-contract failure is the
Schemathesis/jsonschema-rs incompatibility already fixed on `main` by
`031ca453` (`jsonschema-rs==0.49.9`). The affected runs fail while generating a
case with `CanonicalSchema.is_satisfiable`; no application request is sent.
PRs #1631, #1629, #1628, #1627, #1623, #1619, #1618, #1617, #1615, #1613,
#1612, and #1587 should therefore inherit the pin rather than add independent
workarounds.

## Queue inventory and recovery action

| PR                                                            | Current issue                                                                                                                    | Recovery action                                                                                                                                                                 |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1642                                                         | Conflict in `backend/tests/test_equipment_check_service.py`                                                                      | Merge `main`; retain the branch's template-authoritative assertions while keeping newer `main` fixture/setup changes.                                                           |
| #1639                                                         | Conflict in `frontend/src/components/Modal.tsx`                                                                                  | Merge `main`; preserve the current shared Modal accessibility contract and apply the branch's event-dialog usage on top.                                                        |
| #1637                                                         | Backend unit failures in driver-assignment source-inspection tests                                                               | Merge `main`. The current service restores `_check_driver_qualification` in `create_assignment`; rerun the two focused enforcement tests before making any branch-local change. |
| #1634                                                         | Conflict in `frontend/src/pages/DocumentsPage.tsx`                                                                               | Merge `main`; keep `main`'s responsive document layout, then reapply only overflow behavior not already present.                                                                |
| #1631                                                         | Shared API-contract dependency failure                                                                                           | Merge `main` to inherit `031ca453` and the scheduling pagination contracts from #1632, then rerun both database matrices.                                                       |
| #1629                                                         | Conflicts in `DocumentsPage.tsx`, `EventCheckInMonitoringPage.tsx`, and `MemberTrainingHistoryPage.tsx`; shared contract failure | Treat the newer responsive implementations on `main` as authoritative and reapply only non-duplicated table behavior. Then rerun frontend E2E and both contract matrices.       |
| #1628, #1627, #1623, #1619, #1618, #1617, #1615, #1613, #1612 | Shared API-contract dependency failure                                                                                           | Merge `main` and rerun. Do not modify endpoint behavior to compensate for a test-tool ABI mismatch.                                                                             |
| #1624                                                         | Branch-specific backend unit failure                                                                                             | Merge `main` first, then repair only failures that reproduce against the updated head.                                                                                          |
| #1620                                                         | Conflict in `backend/requirements.txt`                                                                                           | Resolve in favor of `main`'s complete dependency set, especially the `jsonschema-rs==0.49.9` compatibility pin; reapply only genuinely new branch dependencies.                 |
| #1616                                                         | Branch-specific backend lint failure                                                                                             | Merge `main`, run `ruff check app tests`, and fix the surviving lint diagnostic locally.                                                                                        |
| #1587                                                         | Frontend lint plus shared API-contract failure                                                                                   | Merge `main`; inherit the contract pin, then reconcile its title work with the newer router/title implementation before running frontend validation.                            |
| #1585                                                         | Frontend lint failure                                                                                                            | Update from `main` and reconcile with the newer router-wide title code; avoid maintaining two title controllers.                                                                |
| #1578                                                         | Conflicts in `CHANGELOG.md` and `DocumentsPage.tsx`                                                                              | Keep all changelog entries in chronological order and use the current responsive documents page as the base for the mobile cleanup.                                             |
| #1577                                                         | Conflict in `CHANGELOG.md`                                                                                                       | Keep both sets of entries in chronological order; verify whether later privacy work supersedes the old implementation before retaining code.                                    |
| #1575                                                         | Documentation conflicts in release, schema, screenshot-currency, and wiki files                                                  | Prefer current factual content, incorporate still-valid additions, and drop stale generated status/currency claims rather than choosing a whole side.                           |

## Ordered execution

1. Merge `origin/main` into each open feature branch. A merge is preferred over
   rebasing branches already under review because it preserves review anchors.
2. Resolve the eight conflicting heads using the file-specific guidance above.
3. Push the updated head and let the full workflow rerun. Do not rerun an old
   SHA: it cannot contain the dependency compatibility fix.
4. For PRs #1637, #1624, #1616, #1587, and #1585, address only failures that
   remain after the update. This separates feature regressions from stale-base
   failures.
5. Require a clean merge state and a successful latest-SHA `CI Success` check
   before merging. Re-query the queue after every merge because the base and
   conflict set will have changed.

## Verification

Use these checks on the recovery commit before updating feature heads:

```bash
python -m pip install --dry-run -r backend/requirements.txt
cd backend && pytest -q tests/test_api_contract.py --collect-only
cd frontend && npm run validate
```

The final API-contract gate must run in GitHub Actions against both MySQL 8.0
and MariaDB 10.11. Local collection verifies the Schemathesis dependency stack,
but does not replace either database job.
