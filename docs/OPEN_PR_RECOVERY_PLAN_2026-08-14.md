# Open pull request recovery plan — 2026-08-14

## Executive summary

The 15 open pull requests were reviewed against their latest GitHub Actions runs. Two are currently green, while 13 are marked unstable. Eleven of the unstable pull requests share one failure introduced on `main`: the redesigned dashboard renders the **Full Schedule**, **Older Items**, and **View All** controls below the 44 px mobile touch-target floor. This change fixes that shared regression at its source.

The remaining failures are branch-specific or are stale-branch integration failures. They should be handled by merging this fix and the two green prerequisites first, updating every open branch from `main`, and only then addressing failures that still reproduce. This avoids independently patching the same dashboard regression in eleven branches and avoids debugging code already corrected by newer pull requests.

## Current inventory

| PR    | State reviewed | Latest failing check(s)                     | Diagnosis and recovery action                                                                                                                                                                                                                                                                                                |
| ----- | -------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1444 | Unstable       | Integration tests on MySQL and MariaDB      | Two shift-completion test doubles no longer match the service contract: one passes obsolete `shift_date`, and another omits `report.shift_date`. Correct the fixtures/call or make the notification formatting tolerate the deliberately minimal test double, then run the focused shift-completion suite on both databases. |
| #1443 | Unstable       | Frontend E2E                                | Shared dashboard touch-target regression. Update from `main` after this fix merges and rerun.                                                                                                                                                                                                                                |
| #1442 | Unstable       | Frontend E2E                                | Shared dashboard touch-target regression. Update from `main` after this fix merges and rerun.                                                                                                                                                                                                                                |
| #1441 | Green          | None                                        | Merge first, subject to review approval. It has a clean merge state and a complete green check suite.                                                                                                                                                                                                                        |
| #1440 | Unstable       | Frontend E2E                                | Shared dashboard touch-target regression. Update from `main` after this fix merges and rerun.                                                                                                                                                                                                                                |
| #1439 | Unstable       | Frontend E2E                                | Shared dashboard touch-target regression. Update from `main` after this fix merges and rerun.                                                                                                                                                                                                                                |
| #1438 | Unstable       | Frontend E2E                                | Includes the shared dashboard failure; its run also reported other E2E failures, so rerun after updating and triage any survivors separately.                                                                                                                                                                                |
| #1437 | Unstable       | Frontend E2E                                | Shared dashboard touch-target regression. Update from `main` after this fix merges and rerun.                                                                                                                                                                                                                                |
| #1436 | Unstable       | Frontend E2E                                | Shared dashboard touch-target regression. Update from `main` after this fix merges and rerun.                                                                                                                                                                                                                                |
| #1435 | Unstable       | Frontend E2E                                | Shared dashboard touch-target regression. Update from `main` after this fix merges and rerun.                                                                                                                                                                                                                                |
| #1434 | Unstable       | Frontend E2E                                | Shared dashboard touch-target regression. Update from `main` after this fix merges and rerun.                                                                                                                                                                                                                                |
| #1433 | Green          | None                                        | Merge first, subject to review approval. Its complete check suite is green.                                                                                                                                                                                                                                                  |
| #1431 | Unstable       | Frontend E2E                                | Shared dashboard touch-target regression. Update from `main` after this fix merges and rerun.                                                                                                                                                                                                                                |
| #1417 | Unstable       | Backend unit tests; Frontend E2E            | The E2E failure is shared. Backend failures combine intentional default-window changes with stale assertions and a migration fork caused by newer `main`; update from `main`, reconcile the reminder migration into the single head, and update focused check-in/public-display expectations to the new 60-minute contract.  |
| #1400 | Unstable       | Frontend lint/typecheck; MySQL API contract | This is the oldest branch. Rebase first. Then fix remaining lint errors and the public application-status endpoint's unexpected response to Schemathesis input; verify both database contract matrices, not only MySQL.                                                                                                      |

## Ordered execution plan

1. **Land the shared fix.** Verify the dashboard unit tests, frontend validation, and the focused mobile Playwright test, then merge this pull request.
2. **Reduce the queue with already-green work.** Merge #1441 and #1433 after normal review. Re-query the queue because their changes may supersede or conflict with older branches.
3. **Update all remaining heads from the new `main`.** Prefer a merge from `main` for branches already under review so review history is preserved. Resolve conflicts according to the newer `main` behavior rather than mechanically choosing either side.
4. **Rerun CI before making branch-local changes.** The eleven shared E2E failures should disappear once the dashboard fix is present. Do not weaken the mobile test or increase its zero-defect budget.
5. **Repair #1444.** Align shift-completion tests and notification construction with the current report API; run the focused tests locally and both integration database jobs.
6. **Repair #1417.** Reconcile its migration with the current single head and make its tests consistently express the new 60-minute default and flexible-window notice behavior. Run migration-chain, event check-in, public-display, backend unit, and E2E checks.
7. **Repair #1400.** Rebase the old branch, resolve lint/type errors, reproduce the Schemathesis failure with its recorded case, and make the endpoint return a documented success/error status for valid generated input.
8. **Triage only genuine survivors.** In particular, inspect #1438's additional E2E failures after the common failure is removed. Assign each survivor to the feature changed by that branch and add a focused regression test with the fix.
9. **Final gate.** Require every non-skipped required check to pass on the latest head SHA and require a clean/mergeable state before merging. Re-check the open list after every merge because each merge changes the base for the rest of the queue.

## Verification commands

Run the shortest relevant checks during development, followed by the full required jobs before merge:

```bash
cd frontend && npm run validate
cd frontend && npm test -- --run src/pages/Dashboard.test.tsx
cd frontend && npm run test:mobile
cd backend && pytest -q tests/test_shift_completion.py
cd backend && pytest -q tests/test_event_checkin_window.py tests/test_public_display.py tests/test_alembic_migrations.py tests/test_changelog_fixes.py
```

Database-specific integration and API-contract jobs must still run in GitHub Actions against both MySQL 8.0 and MariaDB 10.11. A local SQLite pass is not a substitute for those final gates.
