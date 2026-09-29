# Workflow Review — W17 An Applicant Checks Their Status by Link

**Driven:** 2026-09-28 · **As:** anonymous (the applicant), with `membership_coordinator` and `chief` reading the result · **Viewports:** 1280×900, 390×844
**Commit:** `8a05f191d` plus this run's fixes (re-driven) · **Database:** continued from W16; no reset

---

## What was driven

Email is off on the review install, and the status token is deliberately never returned to staff, so an applicant's link cannot be reached from any screen. For setup only, Remy Drawer's token was read from the review database (`logbook_workflow_review`) and kept under `.workflow-review/`. Everything after that went through the browser.

1. As `membership_coordinator`, in Pipeline Settings → Volunteer Applicants, ticked "Allow prospects to check their application status via a public link", then reloaded.
2. Signed out, opened Remy's link at 1280×900 and at 390×844.
3. Opened **Withdraw Application**; read the dialog, pressed Escape.
4. Opened an unknown well-formed token and a malformed one (`bad!token`).
5. With the status API made to answer `503`, and then with the connection dropped, loaded the page.
6. Withdrew with a reason, pressing the dialog's confirm twice quickly; reloaded.
7. As `membership_coordinator`: the Withdrawn tab, Remy's drawer, the activity data. As `chief`: `GET /prospective-members/my-sign-offs`.
8. As `membership_coordinator`: printed-label preview for the department's applicants (`POST /labels/preview`).
9. As `membership_coordinator`: **Reactivate** on the Withdrawn tab, then re-drove steps 3 and 5 on the fixed page.

Not driven: the Cal.com and Documenso stage actions (no integration configured). The email that carries the link, because email is off.

## Held up ✅

- **Turning the page on persists.** The checkbox read ticked after a reload.
- **The page shows the applicant's application, and nothing else:**
  - name, "In Progress", "1 / 2", the current stage "Officer Sign-Off";
  - "Applied 9/28/2026";
  - a timeline with the completed stage dated, and the current one marked for screen readers.
- **Bad links are refused plainly:**
  - An unknown token answered `404` and a malformed one `422`.
  - Both read "Application Not Found".
- **Withdrawing works end to end:**
  - The page re-read and showed "Withdrawn", and the Withdraw card went away.
  - The status held after a reload.
  - The second click on confirm produced no second request error. The activity data holds exactly one `prospect_status_changed`, with the reason and `by_applicant: true`.
- **The coordinator sees it:**
  - the Withdrawn tab lists Remy with the last stage, the date and "Moving out of the district.";
  - the drawer reads "This applicant voluntarily withdrew … Reason: …".
  - The withdrawal notice is recorded as `delivered: 0`, which is honest with email off.
- **The Chief's pending sign-offs dropped Remy once he withdrew.**
- **The dialog:** closes on Escape; focus starts inside it.
- **At 390px:**
  - no sideways scroll;
  - Withdraw is 44px, and the dialog's buttons are 66px;
  - the dialog fits the screen.
- **The responses carry `no-store` and `no-referrer`** (read from code, `portal.py`).
- **The doubled `GET` in `events` is not a finding.** It is React StrictMode in development.

## Findings

### W17-1 — NIT — The withdraw dialog's field read "Reason (optional) (optional)" — ✅ FIXED

**Saw:** the label, exactly as quoted. `PromptDialog` appends "(optional)" to an optional field itself, and the page's label carried it as well.
**Where:** `ApplicationStatusPage.tsx` (the `PromptDialog` label).

- **The same doubling was on Apparatus Inventory's "Report used" note** (`ApparatusInventoryPage.tsx`). It was fixed there too; those were the only two such labels.

**Fix:** the labels are "Reason" and "Note".
**Tests:** `ApplicationStatusPage.test.tsx` and `ApparatusInventoryPage.test.tsx` now find the field by its exact name. Both failed before the fix.
**Re-driven:** the label reads "Reason (optional)".

### W17-2 — LOW — An outage told the applicant their application does not exist — ✅ FIXED

**Did:** loaded the page with the status API answering `503`, then with the connection dropped.
**Saw:** "Application Not Found — Application not found. Please check your link or contact the department.", in both cases.
**Expected:** an applicant whose application is open should not be told it is gone because the server is briefly down.
**Where:** `ApplicationStatusPage.tsx`: the load's `catch` mapped every failure to not-found.
**Fix:**

- Only `404`, `400` and `422` read as not found.
- Anything else reads "Status Unavailable — Your application status could not be loaded right now. Please try again in a few minutes.", with **Try again**.

**Tests:** `ApplicationStatusPage.test.tsx` covers three cases: a `404` still reads not found; a `503` reads unavailable and retries; a network error reads unavailable. The last two failed before the fix.
**Re-driven:** with a `503` the page read "Status Unavailable". **Try again**, once the API answered, loaded Remy's status.

### W17-3 — MED — Staff can read every applicant's status token from the label preview — ✅ FIXED (owner decision)

**Did:** as `membership_coordinator`, `POST /labels/preview` with module `prospective_members` and the department's applicant ids.
**Saw:** each item's `barcode_value` was the applicant's status token. Remy's matched the token that opens his status page.
**Why it matters:**

- The status token is the applicant's only credential. It opens the status page, and it withdraws the application, which is recorded as `by_applicant: true` with no staff actor.
- It is deliberately kept from staff everywhere else: the Kanban response model was narrowed specifically to stop leaking it (`schemas/membership_pipeline.py`, `KanbanBoardResponse`).
- But anyone holding `prospective_members.view` can read every applicant's token from the preview.
- Anyone who holds or photographs a printed applicant label can decode it from the barcode.

**Where:** `backend/app/services/label_service.py`, `_build_prospect_specs`: `barcode = status_token or _short_id(id)`.

- **This is deliberate.** The comment calls the token "a stable, scannable badge id". The `/labels/generate` docstring notes the label carries it, and so filters out the caller's own application.
- **Nothing reads the barcode back** (read from code). The only lookups by `status_token` are the two public status endpoints.

**Decided by the owner:** "Print the short id on labels."

**Fix:**

- `_build_prospect_specs` now prints `_short_id(id)`, as other modules do, and never the token.
- The `/labels/generate` docstring no longer says a label carries it.

**Not done:** labels printed before this change still carry live tokens. Revoking them means rotating every applicant's token, which breaks links already emailed. That was left alone; see `docs/KNOWN_LIMITATIONS.md`.
**Test:** `test_label_builders.py::TestProspectBuilder::test_maps_name_and_short_id_never_the_status_token`. It failed against the old builder. The test it replaces asserted the token was the barcode.
**Re-driven:** the coordinator's preview reads "15B749F4AC3A" for Remy, where it read his token before. The PDF downloads.

### W17-4 — LOW — A membership coordinator is refused the applicant label page their own pipeline links to — ✅ FIXED

**Did:** re-driving W17-3 as `membership_coordinator`, opened `/prospective-members/print-labels`. This is where the pipeline's **Print Labels** button goes.
**Saw:** "Access Denied — You do not have the required permissions to access this page."

- The route required `prospective_members.view`, and the coordinator holds `prospective_members.manage` alone.
- The label API accepts either, and had just served them the preview.

**Where:** `frontend/src/modules/prospective-members/routes.tsx`.
**Fix:**

- The route takes `requiredAnyPermission` view **or** manage, as the Apparatus and Facilities label pages already do.
- `APPLICATION_PAGES.md` and `testingRegistry.ts` updated to match.

**Test:** `routes.test.tsx` (new). It failed against the old route.
**Re-driven:** the coordinator's page lists "Remy Drawer 15B749F4AC3A", "Quinn Prospect C64137D80503" and "Pat Applicant FA4292184E38". **PDF** downloads `labels-2026-09-28.pdf`.

Seen and left:

- **The page never names the department.** It says "contact the department directly", but shows neither the department's name nor any contact detail, and the response carries neither. Adding them is a small additive change, but what a department publishes to anyone holding the link is its choice.
- **After withdrawing, the timeline still marks Officer Sign-Off "(current stage)" in blue.**
- **Reactivate on the Withdrawn tab acts on one click with no confirmation.** It is recoverable: the applicant can withdraw again.

## Checklist

| Section                 | Result                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ status read and withdrawal end to end; the coordinator and the Chief see the result               |
| 2. The right people     | ✅ after W17-3 and W17-4; unknown and malformed tokens are refused                                   |
| 3. Wrong input, failure | ✅ after W17-2; double confirm made one withdrawal                                                   |
| 4. Browser signals      | ✅ only the provoked `404`, `422` and `503`; the doubled `GET` is StrictMode                         |
| 5. Coming back to it    | ✅ status and withdrawal hold after reload                                                           |
| 6. On a phone           | ✅ no overflow; 44px+ controls; the dialog fits                                                      |
| 7. Everyone can use it  | ✅ after W17-1; Escape closes the dialog                                                             |
| 8. What happens around  | ✅ activity records the reason and `by_applicant`; the notice is recorded undelivered with email off |

## Completion gate

| Check                    | Result                                                                                                                                        |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | ✅ clean                                                                                                                                      |
| npm run lint             | ✅ clean                                                                                                                                      |
| flake8 (changed files)   | n/a — no Python changed                                                                                                                       |
| black --check            | n/a                                                                                                                                           |
| frontend tests (touched) | ✅ `ApplicationStatusPage.test.tsx` and `ApparatusInventoryPage.test.tsx`, 34 tests. The 4 new or tightened cases failed against the old code |
| backend tests (touched)  | n/a                                                                                                                                           |

W17-3 and W17-4 fixes:

| Check                            | Result                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| npm run typecheck / lint         | ✅ clean                                                                             |
| flake8 / black / isort (changed) | ✅ clean                                                                             |
| backend tests                    | ✅ 303 label tests; the new builder case failed before the fix                       |
| frontend tests                   | ✅ `routes.test.tsx`, which failed before the fix                                    |
| route registries (pitfall 30a)   | ✅ `check_route_permissions.py --strict` clean after the `APPLICATION_PAGES.md` edit |
