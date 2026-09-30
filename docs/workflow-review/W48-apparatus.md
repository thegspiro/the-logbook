# Workflow Review — W48 Add an Apparatus, Edit It, Read Its Detail, Print Its Labels

**Driven:** 2026-09-30 · **As:** `admin`, with `member` refused · **Viewports:** 1280×900, 390×844
**Commit:** `323212ee7` (the W46–W47 branch) plus this run's changes · **Database:** continued from W47

---

## What was driven

1. As `admin`:
   - `/apparatus` (empty) and `/apparatus-basic` (Engine 1 from onboarding);
   - `/apparatus/new`: Add Apparatus submitted empty, then E-2 "W48 Pumper" (Engine, In Service, 2019, minimum staffing 3, one crew seat, registration 3/31/2027), with Add Apparatus double-clicked.
2. E-2's detail page, then Edit:
   - make "Pierce";
   - nickname and year cleared;
   - saved.
3. `/apparatus/print-labels?ids=…` for E-2.
4. A second apparatus, W48-T (Utility, Reserve), added with no fuel type.
5. The basic apparatus form: `/apparatus-basic` → Add Apparatus (the W30 lead for this run).
6. At 390×844:
   - as `admin`: the list, the form, the detail page and the labels page;
   - as `member`: all five pages;
   - as `member`: create, update and list through the API.

## Held up ✅

- **Submitting empty** showed three field errors and a toast, and saved nothing.
- **A double-clicked Add** made **one** apparatus. Its registration date read 3/31/2027 on the detail page, printed as a calendar date.
- **The labels page** rendered E-2's label, with Code 128 or QR and PDF or browser printing, and gave the printer settings in plain words.
- **`member`** got Access Denied on all five pages and 403 on create, update and list.
- **Phone width:** no horizontal scroll on the list, the form or the labels page at 390×844.

## Findings

### W48-1 — MED — The Add and Edit Apparatus form named almost none of its 40 fields — ✅ FIXED

**Did:** `admin`, `/apparatus/new`, and read the accessibility tree.
**Saw:**

- Every label sat beside its field without naming it.
- Text fields were announced by their placeholder: "E-1" for Unit Number, "Old Reliable", "2024" for Year, "Pierce" for Make, "1HGCM82633A123456" for VIN.
- Apparatus Type, Status, EVOC, Fuel Type, License Plate, Asset Tag, the capacities and every date were announced by nothing.

**Where:** `frontend/src/modules/apparatus/pages/ApparatusFormPage.tsx:400` and the 38 fields below it.
**Fix:** each label is tied to its field (39 pairs, keyed by the field's name).
Covered by new cases in `ApparatusFormPage.test.tsx`, which fail against the old
form. Re-driven: every field is found by its label.

### W48-2 — LOW — Required-field errors were not tied to their fields — ✅ FIXED

**Did:** Add Apparatus submitted empty.
**Saw:** "Unit number is required", "Apparatus type is required" and "Status is
required" showed in red under each field. Nothing marked the fields invalid or
described them with the error, so a screen reader on Unit Number heard nothing wrong.
**Where:** `ApparatusFormPage.tsx`, the three required fields.
**Fix:** `aria-invalid` and `aria-describedby` point each field at its error. Covered by a new case.

### W48-3 — LOW — An apparatus added without a fuel type was recorded as diesel — ✅ FIXED

**Did:** added E-2, and later W48-T, leaving Fuel Type at "Select Fuel Type".
**Saw:**

- E-2's detail page read "Fuel Type: Diesel", and the row stored `diesel`.
- The form sends nothing when left unset, but the model defaulted the column to diesel.
- The column itself carries no default and allows NULL; only the ORM supplied one.

**Where:** `backend/app/models/apparatus.py:424`.
**Fix:**

- The model default is removed, so an unchosen fuel type stays empty and reads "-" like every other blank.
- No migration is needed: the database column had no default.
- `docs/DATABASE_SCHEMA.md` is regenerated.
- Existing rows keep what they hold.
- Covered by `test_apparatus_fuel_type_default.py` (unit), which fails against the old model.
- Re-driven: W48-T stored no fuel type.

### W48-4 — LOW — Clearing a field on Edit Apparatus left the old value in place — ✅ FIXED

**Did:** Edit E-2, cleared the nickname, Save.
**Saw:**

- "Apparatus updated", but the nickname was still "W48 Pumper".
- The form turned an emptied field into `undefined` and dropped it.
- The server applies an update with `exclude_unset`, so the missing key read as "leave it" (CLAUDE.md pitfall 1).
- A cleared number box was dropped the same way.

**Where:** `ApparatusFormPage.tsx:293`, `handleSubmit`; `frontend/src/modules/apparatus/types/index.ts`, `ApparatusUpdate`.
**Fix:**

- On edit, an emptied field is sent as `null`, and so is a number box the user cleared (tracked as it is cleared).
- The four NOT NULL columns stay omitted, as before: unit number, type, status, minimum staffing.
- A stored 0 that the form loads as blank is not treated as a clear.
- `ApparatusUpdate` allows `null` per field.
- Covered by a new case. Re-driven: nickname and year cleared, make and minimum staffing kept.

### W48-5 — LOW — Every apparatus row's actions shared one name — ✅ FIXED

**Did:** `/apparatus` with two units.
**Saw:** each row's icon buttons were named only by a shared title: "Print label", "View Details" (twice, eye and wrench), "Edit".
**Where:** `frontend/src/modules/apparatus/pages/ApparatusListPage.tsx:478`.
**Fix:** "Print label for E-2", "View E-2" and "Edit E-2". The icons are hidden from assistive technology. Covered by a new case in `ApparatusListPage.test.tsx`.

### W48-6 — LOW — The detail page scrolled sideways on a phone — ✅ FIXED

**Did:** `admin`, E-2's detail page at 390×844.
**Saw:** the page was 85px wider than the screen. The header row (unit badge, name, Edit, Archive) could not wrap.
**Where:** `frontend/src/modules/apparatus/components/ApparatusDetailHeader.tsx:43`.
**Fix:** both header rows wrap. Covered by `ApparatusDetailHeader.layout.test.ts`, asserted against the source because jsdom does no layout. Re-driven: no horizontal scroll.

### W48-7 — LOW — The basic apparatus form named nothing (lead from W30) — ✅ FIXED

**Did:** `/apparatus-basic` → Add Apparatus.
**Saw:**

- The dialog had no name.
- Unit Number and Name were announced by their placeholders.
- Apparatus Type, Minimum Staffing and every crew position select were announced by nothing.
- Each seat's remove button read "Remove position".
- Each card's actions read "Edit apparatus" and "Delete apparatus".

**Where:** `frontend/src/pages/ApparatusBasicPage.tsx:397`.
**Fix:**

- The dialog is named by its heading, and the four fields by their labels.
- Seats read "Crew position 2", with "Remove crew position 2".
- Card actions read "Edit Engine 51".

Covered by a new case in `ApparatusBasicPage.test.tsx`, whose existing cases now
query the named actions. Re-driven.

### W48-8 — NIT — The detail page does not show the crew seats — OPEN

E-2 was added with one crew seat. The Overview shows minimum staffing, not the seats that new shifts on it will start with.

## Checklist

| Section                 | Result                                                              |
| ----------------------- | ------------------------------------------------------------------- |
| 1. The job gets done    | ✅ add, detail, edit, labels; fixed W48-3, W48-4                    |
| 2. The right people     | ✅ member refused on five pages and every call                      |
| 3. Wrong input, failure | ✅ empty submit refused with errors; double-click acted once; W48-2 |
| 4. Browser signals      | ✅ clean                                                            |
| 5. Coming back to it    | ✅ saved values read back from the API; fixed W48-4                 |
| 6. On a phone           | Fixed W48-6; list, form and labels fine                             |
| 7. Everyone can use it  | Fixed W48-1, W48-2, W48-5, W48-7                                    |
| 8. What happens around  | W48-8 open                                                          |

Afterwards: E-2 and W48-T are left in the review database for later runs.

## Completion gate

| Check                    | Result                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | clean                                                                                                   |
| npm run lint             | clean                                                                                                   |
| flake8 / black / isort   | clean                                                                                                   |
| frontend tests (touched) | `modules/apparatus`, `modules/scheduling`, `ApparatusBasicPage` — 32 files, 397 passed, no local server |
| backend tests (touched)  | `test_apparatus_*` — 60 passed; `docs/DATABASE_SCHEMA.md` regenerated                                   |
