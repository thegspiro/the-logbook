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

## Implementation record

The recovery was applied on 2026-08-21 rather than left as a proposal:

- `origin/main` was merged and pushed to every open feature head from #1575
  through #1642.
- The authoritative-timing tests in #1642 retain the feature branch's timing
  coverage and also include `main`'s shift-completion-status coverage.
- #1639 keeps its form-capable shared Modal implementation, which already
  incorporates the current mobile height, pinned-action, focus, and accessible
  close behavior.
- #1634 preserves an explicitly labelled, keyboard-focusable document-table
  scroll region while adopting the current responsive-table class.
- #1629 keeps its deliberate responsive-card rendering instead of reintroducing
  horizontal scrolling on the three converted tables.
- #1620 uses the complete current dependency list, including the contract-test
  compatibility pin.
- The older #1578, #1577, and #1575 heads use current `main` content for
  overlapping changelog, responsive-document, schema, release-status, and wiki
  documentation while retaining their non-overlapping feature changes.
- Follow-up CI failures exposed by the integrations were repaired on their own
  heads: #1637's source-inspection test now follows the shared assignment
  validator; #1642's fixtures satisfy authoritative template-item validation;
  #1639 preserves the shared Modal layout class hooks; #1624's regression test
  recognizes `yearly`; #1616's migration has a generated revision ID and follows
  the current single head; #1587 and #1585 use typed bound history wrappers;
  #1577's legal-document migration follows the current single head; and #1575's
  script tests satisfy the active pytest-style lint rules.

These merge commits move CI to the fixed dependency graph and remove every
previously reported Git conflict. Any subsequent failure is therefore tied to
the integrated feature head rather than the stale base diagnosed above.

## Refresh after subsequent main changes

The queue was refreshed again after `main` advanced to `36019a97`. At that
point six feature PRs remained open, and all six heads were updated from the new
base:

- #1649 kept the current selection-mode bulk-action behavior and combined the
  branch's scrollable signup panel with `main`'s centralized modal close path.
- #1648 retained both the recruitment prospect card and `main`'s CSV utilities
  in the event detail page.
- #1629 adopted the current labelled, keyboard-focusable document-table scroll
  region while retaining its responsive table rendering.
- #1637, #1585, and #1577 merged the refreshed base without file conflicts so
  their previously repaired tests, title management, and legal migration remain
  on top of the current application behavior.

The refreshed heads were pushed to their existing PR branches, removing every
newly reported conflict and triggering CI on the integrated commits rather than
their obsolete SHAs.

The first refreshed CI run exposed four additional integration issues, which
were corrected on the affected heads:

- Generated schema documentation was refreshed after the compartment-name
  column changed to `TEXT`, and that generated reference was applied to each
  remaining feature branch.
- #1649 now caps both hand-built event dialogs and teaches its integrity test to
  recognize a decorated Modal scrim instead of misidentifying it as the panel.
- #1585 removes obsolete PageTransition title cleanup now owned by
  RouteTitleManager, eliminating the extra lint warning that exceeded CI's
  warning budget.
- #1577 rebases its legal-document revision on the new compartment-path
  migration head, restoring a single Alembic head.
- Stacked PR #1651 was updated from its refreshed #1648 base so it includes the
  prospect-card render fix and regenerated schema reference.

## Latest queue refresh

After `main` advanced again to `fe7cdf9c`, the ten open PR heads (#1657, #1656,
#1655, #1654, #1653, #1648, #1637, #1629, #1585, and #1577) were merged with
that exact base and pushed. All ten integrations completed without file
conflicts.

This refresh is itself the shared fix for the stale failures visible before the
update: it carries the current generated schema reference, modal scroll
integrity fixes, warning-budget cleanup, migration chain, and test adjustments
into every head before CI reruns. Branch-specific changes remain layered above
`main`; no feature implementation was discarded to obtain a clean merge.

The refreshed CI runs then isolated five branch-local failures, all repaired on
their respective heads: #1657's parent-validation test was Black-formatted;
#1655 scoped its intentional test-only DOM access so it stays within the lint
warning budget; #1648 rebased the recruitment event-type migration onto the
current Alembic head; #1585 removed a superseded PageTransition title assertion;
and #1577 regenerated the schema reference for its legal revision model.

#1637's database failures were traced to tests reading ORM objects expired by
the intentional rejection rollback; the tests now reload the persisted swap
before asserting its unchanged state. Newly opened #1659 was also merged with
the same `fe7cdf9c` base and pushed without conflicts.

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
