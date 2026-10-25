# Workflow Review — W68 Grants: an Opportunity, then an Application Through to Its Report

**Driven:** 2026-10-15 · **As:** `treasurer`, with `secretary`, `chief`, `member`, `quartermaster` for access · **Viewports:** 1280×900, 390×844
**Commit:** `origin/main` of 2026-10-15 plus this run's changes · **Database:** continued from W67

---

## What was driven

1. As `treasurer`, Grants → Opportunities → Add Opportunity: "Illinois Small
   Equipment Grant", Office of the State Fire Marshal, Equipment,
   $5,000–$26,000, fixed deadline 20 November 2026, application URL.
2. From its card, Start Application: program, agency, "Assigned To" typed as
   "Tess Park", $18,500 requested, deadline 20 November. Create.
3. On the application:
   - **Budget:** two lines — Equipment "Thermal imaging cameras (2)" $16,000
     and Indirect Costs "Administration" $500.
   - **Edit**, stepping the status Researching → Preparing → Internal Review →
     Submitted → Under Review → Awarded → Active, then Key Contacts and Budget
     Summary as text; after the fixes, the assignee, $17,000 awarded,
     submitted / award dates and the next and final report dates.
   - **Expenditures:** "FLIR K55 x2", $16,800, against the camera line.
   - **Compliance & Follow-Up:** "Q4 performance report" due 15 January 2027;
     Mark Complete on it.
   - **Activity Log:** a note.
   - Edit to Reporting.
4. The Applications list (pipeline), the Grants dashboard and Reports.
5. Access: `secretary` (fundraising.view), `chief` (manage), `member` and
   `quartermaster` (neither) on the opportunities page, the detail page, and a
   note POST.
6. At 390×844: opportunities, the detail page, the edit form, the list and
   the budget dialog.

Not driven: deleting an application or a budget line (no control exists for
either line or expenditure edits — see leads), and the fundraising half, which
is W69.

## Held up ✅

- The opportunity saved and listed with its range and deadline; Start
  Application carried it into the new application's Grant Opportunity field.
- The status picker offered only the lifecycle's next steps at every stage
  (`allowedNextStatuses`), and each step wrote an Activity Log entry. Awarding
  auto-created the "Grant-Funded Equipment Inventory" task.
- The expenditure recorded with the overspend warning "Budget line “Thermal
  imaging cameras (2)” is $800.00 over its $16,000.00 budget." and the line
  then read −$800.00 remaining.
- Reports: 1 application, $18,500 requested, $17,000 awarded, $16,800 spent,
  compliance 2 / 1 completed / 1 pending.
- Access: `member` and `quartermaster` see Access Denied and get 403; the
  `secretary` sees every tab with no write control and gets 403 on a note;
  `chief` can write.
- 390×844: no sideways scroll on any screen; the budget dialog fills the
  viewport.

## Findings

### W68-1 — HIGH — No budget line, expenditure, compliance task or note could be added — ✅ FIXED

**Did:** as `treasurer`, Budget → Add Budget Item, filled and submitted.
**Saw:** nothing happened beyond "Failed to add budget item"; `events`:
`422 POST /grants/applications/{id}/budget-items`, body `applicationId: This
field is required`. The same 422 for expenditures, compliance tasks and notes,
driven through the API with the bodies the page sends.
**Expected:** the item saved — the grant's budget, spending and reporting are
the point of the screen.
**Where:** `backend/app/schemas/grant.py` — `GrantBudgetItemCreate`,
`GrantExpenditureCreate`, `GrantComplianceTaskCreate` and `GrantNoteCreate`
each required `application_id`, which the endpoints then discard in favour of
the path.
**Fix:** `application_id` is optional on all four (still accepted, so no
caller breaks). `tests/test_grant_detail_writes.py::TestCreatesWithoutApplicationIdInBody`.

### W68-2 — HIGH — Budget categories were sent as labels — ✅ FIXED

**Did:** the same dialog, with the schema fix in place.
**Saw:** 422 again: the select's values were "Equipment", "Indirect Costs";
the API takes `equipment` … `indirect`.
**Where:** `GrantDetailPage.tsx` (the budget dialog).
**Fix:** options built from `BUDGET_ITEM_CATEGORY_LABELS` in `utils/labels.ts`
(codes as values); the budget table, the expenditure table, the budget-line
picker and Reports' Spending by Category show the label rather than the code.
`grantWorkflow.w68.test.tsx`.

### W68-3 — HIGH — Mark Complete, and editing a budget line or an opportunity, were 500s — ✅ FIXED

**Did:** Compliance & Follow-Up → Mark Complete.
**Saw:** "Internal server error (LB-SYS-001)"; the task stayed Pending after a
reload. The log: `ResponseValidationError … updated_at … MissingGreenlet`.
`PUT /grants/budget-items/{id}` and `PUT /grants/{opportunity_id}` failed the
same way.
**Where:** `grant_service.py` `update_compliance_task`, `update_budget_item`,
`update_opportunity` — `onupdate` expires `updated_at` at the flush, and the
response model's lazy read raised. The create paths already refresh.
**Fix:** refresh after the flush. Also stopped the page sending
`completedDate: new Date().toISOString()` (an instant for a date field; the
service already stamps the department's today). Re-driven: "Task marked
complete", Completed with 2026-10-15 after a reload.
`TestUpdatesReturnASerializableRow`, and the page test asserting the request.

### W68-4 — HIGH — Saving an application with Key Contacts or Budget Summary filled was refused — ✅ FIXED

**Did:** Edit, typed a contact, Save; separately, a budget summary.
**Saw:** "Failed to save application. Try again." both times; `events`: 422.
**Where:** the form edits both as free text and the frontend types them
`string`; `schemas/grant.py` typed them `Dict` / `List[Dict]`. Nothing on the
backend reads them as structures.
**Fix:** the schemas accept a string beside the structured shapes (the JSON
columns store a JSON string; no migration). The save toast now gives the
server's reason. `TestApplicationFields`. Whether contacts should become
structured is flagged — W68-9.

### W68-5 — MED — "Assigned To" was a free-text box for a member id — ✅ FIXED

**Did:** typed "Tess Park", created the application.
**Saw:** it saved, and the response read `assignedTo: null`: the create schema
had no such field, so the name was dropped without a word. On edit the same
text is a 422 (`assigned_to: UUID`).
**Fix:** `assigned_to` accepted on create (validated in-org by the existing
`_validate_application_fks`); the field is a member picker fed by the member
directory, keeping a saved assignee the directory cannot show as "Current
assignee"; the applications list, pipeline cards and task rows show the name
(`hooks/useMemberNames.ts`) rather than the id. Re-driven: "Tess Park" on the
pipeline card.

### W68-6 — MED — Nothing could record the award or when reports fall due — ✅ FIXED

**Did:** moved the application to Awarded.
**Saw:** no Amount Awarded field, nor Submitted, Award Date, Next Report Due or
Final Report Due — though the detail page, the overspend warning, the
dashboard's Total Grant Funding and Reports all read them, and the API accepts
them.
**Fix:** the five fields added to the form, loaded on edit and saved.
Re-driven: $17,000 awarded and the dates on the detail page; Reports' Total
Awarded $17,000.

### W68-7 — MED — Budget totals read "-" and over-budget was decided on strings — ✅ FIXED

**Did:** Budget tab with two lines.
**Saw:** Total Budgeted / Spent / Remaining all "-". The API serializes the
Decimals as strings ("500.00"), so `0 + "500.00" + "16000.00"` concatenated;
the per-line `amountSpent > amountBudgeted` compared strings ("900.00" >
"16000.00" is true).
**Fix:** `Number()` at the sums and comparisons. Re-driven: $16,500.00.

### W68-8 — LOW — Smaller defects — ✅ FIXED

- Notes went out as type `comment`, which the API refuses; now `general`.
- The detail page's add/update failures said only "Failed to …"; they now give
  the server's reason.
- The dashboard read a date-only due date as UTC midnight: a task due today
  read **Overdue** by 9:58 in Chicago, and a deadline 36 days out "35d left".
  Now counted with `calendarDaysFromToday` on the department's timezone.
- Start Application was offered to `secretary`, whom the route refuses; it now
  follows `fundraising.manage`.
- The category filter had no accessible name; touch targets under 44px on
  the opportunities cards, the detail page's back link / Edit / tabs, the
  form's back, Cancel and Save, and the list's view toggle and New
  Application.

### W68-9 — LOW — Key Contacts: free text or a list of people? — FLAGGED

The column is typed as a list of contact objects and the only screen edits
free text; nothing reads it as structured. W68-4 makes the text save. Whether
contacts should become structured (name, role, phone, email — so a report
could list them) is a product decision. Mirrored to KNOWN_LIMITATIONS.

### W68-10 — LOW — Opportunities cannot be edited or retired from the screen — ✅ FIXED 2026-10-25

Each opportunity now has Edit (`/grants/opportunities/:id/edit`, the add form in
edit mode) and Retire, which the owner chose to be `is_active = false` rather than a
delete, so applications started from it keep their program. **Show retired** lists
them and reinstates one. The Federal Programs cards are unchanged. Original finding
below.

`PUT` and `DELETE /grants/{opportunity_id}` exist (the PUT was a 500 until
W68-3); no control reaches either, so a mistyped deadline or an expired
program stays as entered. The four Federal Programs cards are static text with
no Start Application. Mirrored to KNOWN_LIMITATIONS.

## Checklist

| Section                 | Result                                                                       |
| ----------------------- | ---------------------------------------------------------------------------- |
| 1. The job gets done    | ❌ → ✅ budget, spending, tasks, notes, award and assignee all failed; fixed |
| 2. The right people     | ✅ view / manage / none held on screen and API; Start Application gated      |
| 3. Wrong input, failure | ❌ → ✅ refusals now give the server's reason                                |
| 4. Browser signals      | ❌ → ✅ 422s and 500s in `events`; clean after                               |
| 5. Coming back to it    | ✅ every write checked after a reload and from the API                       |
| 6. On a phone           | ✅ no sideways scroll; touch targets fixed                                   |
| 7. Everyone can use it  | ✅ category filter named; labelled fields                                    |
| 8. What happens around  | ✅ dashboard and Reports reflect the grant; due-today fixed                  |

## Completion gate

| Check                    | Result                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------- |
| npm run typecheck        | ✅ clean                                                                            |
| npm run lint             | ✅ clean                                                                            |
| flake8 (changed files)   | ✅ clean                                                                            |
| black --check            | ✅ clean                                                                            |
| frontend tests (touched) | ✅ `src/modules/grants-fundraising` 64 passed (new file fails 5/10 on the old page) |
| backend tests (touched)  | ✅ `-k grant` 761 passed; `test_grant_detail_writes.py` fails 9/10 without the fix  |
