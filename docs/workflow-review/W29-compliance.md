# Workflow Review — W29 Compliance: Configure Requirements, Read the Matrix, Print It

**Driven:** 2026-09-29 · **As:** `training_officer`, with `member` refused · **Viewports:** 1280×900, print media
**Commit:** `2a02da7ca` plus this run's changes · **Database:** continued from W28

---

## What was driven

1. As `training_officer` (who holds `compliance.manage`),
   `/training/compliance-config`:
   - set Compliant Threshold to 90%, saved with a double-click, and reloaded;
   - then set At-Risk Threshold to 95%, above the compliant one, and saved.
2. Training Administration → Compliance → Annual Report
   (`?page=compliance`), the requirement analysis and member table.
3. Training Administration → Dashboard → Compliance Matrix → Print. The print
   page (`/training/print/compliance`) was read in a new tab under print media.
4. As `member`: `PUT /compliance/config`, `GET /training/compliance-matrix`,
   `/training/compliance-config` and `/training/print/compliance`.

## Held up ✅

- **Saving the threshold:** 90% saved, survived a reload, and moved the Status Preview to "Compliant ≥ 90%, At Risk 75–89%".
- **Refusing an invalid pair:** the server refused an at-risk threshold above the compliant one (422) and kept 75%.
- **The page is honest about unread settings:** it labels the grace period and member notifications "Not in effect yet" (CLAUDE.md pitfall 19).
- **The print page:** under print media it prints without the app's navigation, with generated date, member count and a signature block.
- **`member` was refused:**
  - the configuration write and the matrix (403);
  - both pages (Access Denied).

## Findings

### W29-1 — MED — The printed matrix re-derived its statuses, and got them wrong — ✅ FIXED

**Did:** `training_officer`, Compliance Matrix → Print.
**Saw:**

- **The summary buckets:** "0 100% COMPLETE · 0 PARTIALLY COMPLETE · 27 NOT STARTED", bucketed on `completion_pct`. Jordan Avery, holding 4 of 6 Hazmat hours (◐ in his own cell), was counted "not started". The department's thresholds played no part: the API's `standing` per member was ignored (CLAUDE.md pitfall 29).
- **The cells:** every status other than met or partial printed "—", so on paper an unmet requirement looked exactly like one the member is exempt from. The matrix sends no cell at all for the second.
- **The headers:** requirement names were cut at 12 characters ("ANNUAL HAZMA…", "SUPERVISED D…"), with only a `title` tooltip to recover them, which paper doesn't have.

**Where:** `frontend/src/pages/training/CompliancePrintPage.tsx:21`, `:69`.
**Fix:**

- The summary counts Compliant / At Risk / Non-Compliant from `standing`, as the on-screen matrix does.
- Cells print ✓ met, ◐ in progress, ✗ not started, Exp expired, and — only for "does not apply", with a legend under the table.
- Headers wrap instead of truncating.

Covered by the new `CompliancePrintPage.test.tsx` (fails against the old
page). Re-driven: "0 Compliant · 0 At Risk · 27 Non-Compliant", ✗ in the
Hazmat column, full names.

### W29-2 — LOW — A refused configuration said only "Failed to save configuration" — ✅ FIXED

**Did:** `training_officer`, At-Risk Threshold 95 above Compliant 90, then Save.
**Saw:** "Failed to save configuration". The server's 422 said "at_risk_threshold
must be less than or equal to compliant_threshold", but the page discarded it.
The profile save did the same.
**Where:** `frontend/src/pages/ComplianceRequirementsConfigPage.tsx:260`.
**Fix:** both saves toast `getErrorMessage(err, …)`, which reads the server's
reason. Covered by a new case in
`ComplianceRequirementsConfigPage.clearFields.test.tsx`.

### W29-3 — LOW — The configuration's fields had no accessible names; its tabs no state — ✅ FIXED

**Did:** `training_officer`, all four tabs.
**Saw:**

- Threshold Type, both thresholds, the reminder days, the profile form's name, priority, description and overrides, and the report scheduling and generation fields were named by nothing.
- 17 fields in all; only Grace Period was labelled.
- The tab buttons showed which was open by colour alone.

**Where:** `frontend/src/pages/ComplianceRequirementsConfigPage.tsx:511` and the
labels above each field.
**Fix:** every single-control label is tied to its field, and the tab buttons
carry `aria-pressed`. Covered by a new case in the same test file. Re-driven:
the threshold was set by its label.

### W29-4 — LOW — The annual report scored a requirement nobody is held to as 0% — ✅ FIXED

**Did:** `training_officer`, Compliance → Annual Report.
**Saw:** three program-only requirements (Vehicle Familiarization, Pump
Operations, Supervised Driving Hours) read "0/0 — 0%" in red: an empty set
shown as failure, the mirror of pitfall 29's "an empty set is not a passing
set".
**Where:** `frontend/src/pages/ComplianceOfficerDashboard.tsx:436`.
**Fix:** "Not applicable" when `members_total` is 0. Covered by a new case
in `ComplianceOfficerDashboard.test.tsx`.

## Checklist

| Section                 | Result                                                                   |
| ----------------------- | ------------------------------------------------------------------------ |
| 1. The job gets done    | ✅ configure, read, print; fixed W29-1 (what the print said)             |
| 2. The right people     | ✅ `member` 403 on the write and the matrix, Access Denied on both pages |
| 3. Wrong input, failure | ✅ an invalid threshold pair refused; fixed W29-2 (the message)          |
| 4. Browser signals      | ✅ the one 422 was the refusal driven on purpose                         |
| 5. Coming back to it    | ✅ the threshold survives a reload                                       |
| 6. On a phone           | n/a — officer configuration and a print page                             |
| 7. Everyone can use it  | Fixed W29-3                                                              |
| 8. What happens around  | Fixed W29-4; unread settings are labelled as such                        |

## Completion gate

| Check                    | Result                                                                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | clean                                                                                                                                                     |
| npm run lint             | clean on the changed files                                                                                                                                |
| flake8 (changed files)   | no Python changed                                                                                                                                         |
| black --check            | no Python changed                                                                                                                                         |
| frontend tests (touched) | `ComplianceOfficerDashboard`, `CompliancePrintPage`, `ComplianceRequirementsConfigPage` (3 files), `ComplianceMatrixTab`, `TrainingAdminPage` — 77 passed |
| backend tests (touched)  | none touched                                                                                                                                              |
