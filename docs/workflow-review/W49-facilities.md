# Workflow Review — W49 Facilities: a Facility, Its Maintenance, Inspections and Settings

**Driven:** 2026-09-30 · **As:** `admin`, with `member` refused · **Viewports:** 1280×900, 390×844
**Commit:** `bb0bda095` (the W46–W48 branch) plus this run's changes · **Database:** continued from W48

---

## What was driven

1. As `admin`, `/facilities` → Add Facility: "W49 Station 2", with the email "not-an-email".
2. The facility's detail page:
   - every section of its navigation;
   - Edit on the overview.
3. On the facility:
   - a maintenance record and an inspection, each with its save double-clicked;
   - the facility-wide `/facilities/maintenance` and `/facilities/inspections` pages with their filters;
   - the facilities dashboard.
4. `/facilities/settings`: Add facility type (the W14-2 lead for this run).
5. As `member` at 390×844:
   - all four facilities pages;
   - create a facility, maintenance record, inspection and type through the API, and list facilities.
6. As `admin` at 390×844: the list, the detail page, both record pages and settings.

## Held up ✅

- **Double-clicks:** Add Facility made **one** facility. Saving the maintenance record and the inspection each made **one** row.
- **The records reached the pages built on them:**
  - the facility-wide Maintenance and Inspections pages listed them;
  - the dashboard read "Upcoming inspections 1", W49 annual fire inspection on 10/20/2026.
- **Edits clear:** the overview's edit payload sends `null` for an emptied field (CLAUDE.md pitfall 1).
- **`member`:**
  - got Access Denied on all four pages;
  - got 403 on every create, and on the list.
- **Phone width:** no horizontal scroll on any page at 390×844.

## Findings

### W49-1 — LOW — A facility could be added and edited with an email that is not one — ✅ FIXED (form) · OPEN (server)

**Did:** Add Facility with the email "not-an-email".
**Saw:**

- It saved, and the overview showed it as the facility's email.
- The Edit form accepted the same value.
- The server's `email` is a free string of up to 200 characters.

**Where:**

- `frontend/src/modules/facilities/components/CreateFacilityModal.tsx:43`;
- `OverviewSection.tsx`, the edit form;
- `backend/app/schemas/facilities.py:420`.

**Fix:**

- Both forms check the email with the rule the organization profile already uses (`organizationEmailError`). The field is marked invalid and described by the error, and saving is refused.
- Covered by the new `CreateFacilityModal.test.tsx` and a new case in `OverviewSection.test.tsx`.
- Re-driven:
  - the add form disabled Add with "bad" typed in;
  - the stored "not-an-email" showed its error on Edit;
  - a corrected address saved.

**Left open:** the server still takes any string. Validating it there would make an update of a facility that already stores a bad address fail until the address is fixed. That is a behaviour change for API callers, so it is not made here.

### W49-2 — MED — The facility overview's edit form named none of its 21 fields — ✅ FIXED

**Did:** a facility's detail page → Edit, then read the accessibility tree.
**Saw:** every label sat beside its field without naming it: name, type, status, the address, phone, email, the dates and the capacities.
**Where:** `frontend/src/modules/facilities/components/OverviewSection.tsx`.
**Fix:** each label is tied to its field (21 pairs). Covered by a new case in `OverviewSection.test.tsx`.

### W49-3 — LOW — The facility's section navigation showed the current section by colour alone — ✅ FIXED

**Did:** moved between Overview, Maintenance, Inspections and the other sections.
**Saw:** the active section was drawn red, and nothing else marked it.
**Where:** `frontend/src/modules/facilities/pages/FacilityDetailPage.tsx`.
**Fix:** the active section carries `aria-current`. The icons are hidden from assistive technology. Covered by a new case in `FacilityDetailPage.identity.test.tsx`. Re-driven: Overview read as current.

### W49-4 — LOW — The maintenance and inspection dialogs, on the facility and facility-wide, named nothing — ✅ FIXED

**Did:** New maintenance record and New inspection, from the facility and from the facility-wide pages.
**Saw:**

- All four dialogs were unnamed.
- Their fields were announced by placeholders or by nothing:
  - 9 and 12 fields on the facility;
  - 10 and 13 on the facility-wide pages.

**Where:**

- `frontend/src/modules/facilities/components/MaintenanceSection.tsx:215` and `InspectionsSection.tsx`;
- `pages/MaintenanceListPage.tsx:247` and `pages/InspectionsListPage.tsx:238`.

**Fix:** each dialog is named by its heading, and every label names its field. Covered by the new `FacilityRecordDialogs.test.tsx` and `FacilityListDialogs.test.tsx`, which fail against the old dialogs.

### W49-5 — LOW — The filter strips showed the chosen filter by colour alone — ✅ FIXED

**Did:** `/facilities/maintenance` (All, Pending, Completed, Overdue) and `/facilities/inspections` (All, Passed, Failed, Pending).
**Saw:** no state on any of the eight buttons.
**Where:** `MaintenanceListPage.tsx:115`, `InspectionsListPage.tsx:109`.
**Fix:** `aria-pressed`. Covered by `FacilityListDialogs.test.tsx`. Re-driven: "All" pressed, the rest not.

### W49-6 — LOW — The facilities lookup editor was not a dialog (lead from W14-2) — ✅ FIXED

**Did:** `/facilities/settings` → Add facility type.
**Saw:** the editor had `aria-labelledby` pointing at its heading, but no `role`, so it named nothing and no dialog was announced.
**Where:** `frontend/src/modules/facilities/pages/FacilitiesSettingsPage.tsx:253`.
**Fix:** `role="dialog"` and `aria-modal`. Covered by a new case in `FacilitiesSettingsPage.test.tsx`. Re-driven: found as the dialog "Add facility type".

## Checklist

| Section                 | Result                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ facility, maintenance, inspection, dashboard, settings                          |
| 2. The right people     | ✅ member refused on four pages and every call                                     |
| 3. Wrong input, failure | Fixed W49-1 in the forms (server left open); double-clicks acted once              |
| 4. Browser signals      | ✅ clean                                                                           |
| 5. Coming back to it    | ✅ records read back on the lists and the dashboard; the corrected email read back |
| 6. On a phone           | ✅ no horizontal scroll on any page                                                |
| 7. Everyone can use it  | Fixed W49-2 to W49-6                                                               |
| 8. What happens around  | ✅ the dashboard counted the new inspection                                        |

Afterwards, W49 Station 2 is left in the review database for later runs, with its maintenance record and inspection.

## Completion gate

| Check                    | Result                                                      |
| ------------------------ | ----------------------------------------------------------- |
| npm run typecheck        | clean                                                       |
| npm run lint             | clean                                                       |
| frontend tests (touched) | `modules/facilities`: 15 files, 110 passed, no local server |
| backend                  | no backend change                                           |
