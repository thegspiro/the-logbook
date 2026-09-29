# Workflow Review — W39 Issue Equipment to a Member, the Member Sees It, Return It

**Driven:** 2026-09-29 · **As:** `quartermaster` → `member`, with `member` refused · **Viewports:** 1280×900, 390×844
**Commit:** `110b23d9b` (main, after #2820) plus this run's changes · **Database:** continued from W38

---

## What was driven

1. As `quartermaster`, `/inventory/admin/members` → Jordan Avery → Assign:
   - "Structural Coat" (individual, TC-1001) as an ongoing assignment;
   - 2 of "Nitrile Gloves" (pool);
   - Review 2 Items, then Confirm double-clicked.
2. As `member`:
   - at 1280×900, `/inventory/my-equipment`, then the coat's detail page and each of its tabs;
   - at 390×844, "Notify quartermaster of return" for the coat (Fair, a note), Submit double-clicked, then a reload and My Requests.
3. As `quartermaster`, Return from Jordan's row: the coat (Fair) and 1 of the 2 gloves, with Return 2 Items double-clicked. Then the returns queue and the hub.
4. As `member`:
   - `GET /inventory/members-summary` and another member's `/users/{id}/inventory`;
   - `POST /inventory/distribute-items` and `POST /items/{id}/unassign`;
   - the members page.
5. After the fixes, as `quartermaster`: the coat lent back as a temporary loan due 6:00 PM Central, then checked in from the Return dialog with the keyboard only.

## Held up ✅

- **Distribution:**
  - The coat became a permanent assignment, and the gloves a pool issuance of 2.
  - Stock went from 20 to 18, and a double-clicked Confirm acted **once**.
  - The confirmation step lists what each item will become ("permanent assignment", "pool issuance").
- **The member's view:** both items are there with the serial, condition and date, and each return button names its item.
- **The member's return notice:**
  - A double-clicked Submit made **one** notice, and it survived a reload.
  - A second notice for the same coat is refused: "You already notified the quartermaster about this item".
- **The quartermaster's return:**
  - A double-clicked Return 2 Items returned **once**: the coat is available again in Fair condition, and the gloves are 19 in stock with 1 still issued.
  - The member's page shows only the remaining gloves.
- **Refusals:** the member got 403 on the summary, on another member's inventory, on distribute and on unassign, and Access Denied on the members page.
- **Layout:** `/inventory/my-equipment` fits 390px.

## Findings

### W39-1 — LOW — A member opening their own issued gear was told "Insufficient permissions" over an empty history — ✅ FIXED

**Did:** `member`, My Issued Gear → Structural Coat.
**Saw:**

- The detail page opens on History, which requests `GET /items/{id}/history`.
- That endpoint is gated on `inventory.manage`, deliberately: the history is the item's chain of custody, naming everyone who has held it.
- So every member opening their own gear got the toast "Insufficient permissions (Error code: LB-PERM-001)", two 403s, and "No history events recorded." for a coat assigned minutes earlier.

**Where:** `frontend/src/modules/inventory/pages/ItemDetailPage.tsx:183`.
**Fix:**

- History is offered, and requested, only with `inventory.manage`, the same gate as the server.
- A member's page opens on Stock Lots, even from a link that names `?tab=history`.
- Who may see the history is unchanged.

Covered by two cases in `ItemDetailPage.test.tsx`, both failing against the old page. Re-driven: no History tab, no request and no toast.

### W39-2 — LOW — An item with no NFPA record yet raised an error toast — ✅ FIXED

**Did:** `member`, and equally `quartermaster`, on the coat's NFPA Compliance tab.
**Saw:** a toast, "No NFPA compliance record found for this item (Error code:
LB-API-404)", above the tab's own "No NFPA compliance data available." A record
that hasn't been started yet is not a failure.
**Where:** `frontend/src/modules/inventory/pages/ItemDetailPage.tsx:288`.
**Fix:** a 404 there is read as "none yet". Any other failure still toasts.
Covered by a new case in `ItemDetailPage.test.tsx` (fails against the old page).

### W39-3 — MED — The Return Items dialog could not be used without a mouse — ✅ FIXED

**Did:** `quartermaster`, Return from Jordan Avery's row.
**Saw:** each held item is a clickable `div` with a drawn checkbox. Nothing
could be reached by the keyboard or announced by a screen reader: the dialog read
"0 of 2 selected" over two paragraphs. A quartermaster who doesn't use a mouse
could not return anything from it.
**Where:** `frontend/src/components/ReturnItemsModal.tsx:409`.
**Fix:**

- Each row carries a real checkbox, named e.g. "Return Structural Coat (Assigned)".
- Clicking the row still selects it.
- Clicking the checkbox toggles once, not twice.

Covered by the new `ReturnItemsModal.test.tsx`: the names, a return chosen
from the keyboard, and a single toggle. All three fail against the old dialog.
Re-driven: Space on the checkbox, Tab to the condition, Enter on Return, and
the loan was checked in.

### W39-4 — LOW — My Issued Gear's Pending read 0 with a return notice open, and the notice's fields had no names — ✅ FIXED

**Did:** `member`, after notifying the quartermaster of the coat's return, and after a reload.
**Saw:**

- **Pending** read 0 for two reasons:
  - it counted only gear requests, never return notices;
  - it loaded them only once My Requests was opened.

  So it read 0 on arrival even with a gear request waiting.

- **The notice's fields:** Condition, Quantity Returning and Notes, as well as the loan-extension date, were labels tied to nothing. At 390×844 the condition read as a bare combobox.

**Where:** `frontend/src/modules/inventory/pages/MyEquipmentPage.tsx:199`, `:210`, `:603`.
**Fix:**

- Requests load with the page.
- Pending counts undecided gear requests plus return notices not yet received.
- Each field is tied to its label.
- Each stat tile is a group named by its label.

Covered by three cases in `MyEquipmentPage.test.tsx`, all failing against the old page.

### W39-5 — MED — Receiving gear back leaves the member's return notice open — FLAGGED

**Did:**

1. `member` notified the quartermaster of the coat's return.
2. `quartermaster` then received it through Return on the members page.

**Saw:**

- The coat came back, but the notice stayed "requested".
- It still sits in `/inventory/admin/returns` ("1 return request awaiting review").
- It still sits on the hub's attention list as "Pending return · Jordan Avery · Structural Coat".
- The member's own list still shows "requested", and after W39-4 their Pending tile counts it.
- **Why, read from code:** the direct return paths (`POST /items/{id}/unassign`, `/issuances/{id}/return`, check-in) don't look for an open notice on the same record.

**Where:** `backend/app/api/v1/endpoints/inventory.py:2039` and the other direct return endpoints.
**Not fixed because:** what the direct return should do with an open notice is a workflow decision:

- close it as completed, carrying the condition observed at the counter;
- mark it received and leave it for inspection;
- or refuse the direct return while a notice is open and send the quartermaster to the queue.

Each writes a different record of who inspected what. Mirrored into
`docs/KNOWN_LIMITATIONS.md`. W41 drives the returns queue and should start here.

### W39-6 — LOW — Every member row's actions read the same, and three controls had no names — ✅ FIXED

**Did:** `quartermaster`, the members page and the Assign dialog.
**Saw:**

- With 27 members, a screen reader heard 27 "Assign" and 27 "Sizes" buttons, with nothing saying whose each was.
- The sort select had no name.
- In the Assign dialog, the item search was named only by its placeholder, and each pool item's quantity was "Quantity".

**Where:**

- `frontend/src/modules/inventory/pages/InventoryMembersPage.tsx:324`, `:445`;
- `frontend/src/components/InventoryScanModal.tsx:950`, `:1124`.

**Fix:**

- The row actions read "Assign items to <member>", "Return items from <member>" and "Edit sizes for <member>".
- The sort select is named "Sort members".
- The item search is named "Item to add: name, barcode, serial or asset tag".
- Each quantity reads "Quantity of <item>", and in return mode each condition reads "Return condition for <item>".

Covered by new cases in `InventoryMembersPage.test.tsx` and
`InventoryScanModal.test.tsx`, failing against the old code. The existing
"hides management actions" test looked for a button named "Assign", which the
rename would have made pass vacuously, so it now looks for "Assign items to".

### W39-7 — LOW — A temporary loan's return time was bounded in UTC and read in the browser's zone — ✅ FIXED

**Did:** `quartermaster`, Assign → Temporary loan, in a Central-time department.
**Saw, read from code and confirmed in the browser after the fix:**

- The Expected return field's minimum was `new Date().toISOString().slice(0, 16)`, a UTC wall-clock time. In Central that put the earliest pickable return five hours ahead, so a loan due back this afternoon could not be entered.
- The value was parsed in the browser's zone rather than the department's.

**Where:** `frontend/src/components/InventoryScanModal.tsx:683`, `:800`.
**Fix:** the minimum and the value both use the department's zone
(`formatForDateTimeInput` and `localToUTC`), like the other datetime fields.
Covered by a new case in `InventoryScanModal.test.tsx` (fails against the old
dialog). Re-driven: the minimum read 14:56 at 14:56 Central, and a loan due at
6:00 PM Central was stored as 23:00Z.

### W39-8 — NIT — "Review 2 Items" is disabled until a duration is chosen, and nothing says so — OPEN

The dialog opens with neither "Ongoing assignment" nor "Temporary loan"
selected. After scanning, the only action is disabled, with no hint that the
fieldset above is what it waits for. Left: this is deliberate (#1885 made the
choice explicit), so the fix is a line of copy.

### W39-9 — NIT — "Notify quartermaster of return" is still offered after a notice was sent — OPEN

The coat's row keeps the button after the notice. Pressing it again gets the
server's clear refusal, so nothing is duplicated, but the row could say the
quartermaster has been told. Left for W41, which owns the notice flow.

## Checklist

| Section                 | Result                                                                        |
| ----------------------- | ----------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ assign, issue, member sees it, notify, return; ⚠ W39-5 notice left open    |
| 2. The right people     | ✅ member 403 on every write and read, Access Denied on the page; fixed W39-1 |
| 3. Wrong input, failure | ✅ three double-clicks acted once; a duplicate notice refused; fixed W39-7    |
| 4. Browser signals      | Fixed W39-1 (403 + toast), W39-2 (404 toast)                                  |
| 5. Coming back to it    | ✅ assignment and notice survive reload; fixed W39-4 (Pending read 0)         |
| 6. On a phone           | ✅ My Issued Gear and the notice dialog at 390×844                            |
| 7. Everyone can use it  | Fixed W39-3 (return dialog unusable without a mouse), W39-4, W39-6            |
| 8. What happens around  | Flagged W39-5; W39-8, W39-9 open                                              |

## Completion gate

| Check                    | Result                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------- |
| npm run typecheck        | clean                                                                                  |
| npm run lint             | clean                                                                                  |
| flake8 (changed files)   | no Python changed                                                                      |
| black --check            | no Python changed                                                                      |
| frontend tests (touched) | `modules/inventory`, `ReturnItemsModal`, `InventoryScanModal` — 100 files, 1503 passed |
| backend tests (touched)  | none touched                                                                           |
