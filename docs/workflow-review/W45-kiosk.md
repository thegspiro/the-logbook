# Workflow Review — W45 The Self-Service Kiosk

**Driven:** 2026-09-30 · **As:** `admin` (kiosk officer) for members Jordan Avery and Alex Brooks, with `quartermaster` and `member` refused · **Viewports:** 1024×768 (tablet), 390×844
**Commit:** `be89d0a11` (main, after #2833) plus this run's changes · **Database:** continued from W44

---

## What was driven

The review browser has no NFC reader. For this run a stand-in `NDEFReader` was
installed in the page before it loaded (`.workflow-review/fake-nfc.js`, not
committed). It delivers a blank tag's serial number to the page's own reader
callback, as a card or tag tap does on an Android tablet. Everything after the
tap is the real page, the real API and the review database.

1. As `member` at 390×844, then `quartermaster`: `/inventory/kiosk` and `POST /inventory/kiosk/identify`.
2. As `admin` with NFC ID Cards off: the kiosk page and the API. Then Integrations → NFC ID Cards → Activate.
3. Setup as `quartermaster`:
   - a category "Loaner Radios" with "Allow self-checkout at the kiosk" and a loan period, first 0 and then 3 days, with Create Category double-clicked;
   - Loaner Radio 1 and 2, each with a serial tag.
   - As `admin`, cards issued by serial to Jordan and Alex.
4. As `admin` at 1024×768, Start kiosk, then:
   - Jordan's card → Radio 1 → Borrow it double-clicked;
   - Alex's card while Jordan was still greeted;
   - Done → Alex → Radio 1 (on loan to Jordan);
   - Jordan → Radio 1 → "Yes, it's damaged", with a blank and then a spaces-only note, then "Antenna cracked" and Return as damaged double-clicked;
   - a minute without a tap;
   - an item tag tapped first;
   - Alex's card suspended.
5. The API directly: a card with nothing read, a return by a member who does not hold the item, and a damaged return with no note.
6. At 390×844: Alex borrows and returns Radio 2.

## Held up ✅

- **Borrowing:**
  - A double-clicked Borrow it made **one** checkout, to the member whose card was tapped.
  - The officer is recorded as `checked_out_by`, and the reason is "Self-service kiosk".
  - It is due in 3 days, shown in the department's zone ("Loaner Radio 1 is yours until 10/2/2026"), and the loan list updated.
- **Refusals:**
  - Another member tapping an item on loan was refused: "Loaner Radio 1 is not available (checked out)."
  - A return by a member who does not hold the item was refused ("… is not checked out to you. Hand it to a quartermaster.").
  - An item tag with nobody greeted was refused ("This card is not registered to a member.").
- **Damaged returns:**
  - Return as damaged stayed disabled for a blank or spaces-only note.
  - A double-clicked return closed the loan **once**, recording the condition as damaged with the note. The item went to In Maintenance and Damaged, as the quartermaster's item page shows.
  - The API refused a damaged return with no note (422).
- **Forgetting the member:** a minute without a tap returned to "Tap your ID card to start". The next tap is read as a card, so nobody inherits the previous member.
- **Switches:**
  - With NFC ID Cards off, the page and the API both said so (403).
  - Loan period 0 was refused by the form ("Value must be greater than or equal to 1").
  - A double-clicked Create Category made **one** category.
- **Refused people:** `member` and `quartermaster` got Access Denied and 403. The grant is seeded to no position by design (read from `permissions.py`), so a department chooses who runs a kiosk.
- **Phone width:** no horizontal scroll at 390×844.

## Findings

### W45-1 — LOW — The next member's card was read as an item until the last member pressed Done — ✅ FIXED

**Did:** `admin`'s kiosk, with Jordan greeted; Alex tapped his card.
**Saw:**

- "This tag is not linked to anything. (Error code: LB-API-409)". Jordan stayed on screen.
- The page's own comment says the next member can start without Done. That only held for a card carrying an issued code.
- Cards are issued by serial by default, and a serial card cannot be told from an item tag on the tablet, so it went to the item lookup.
- Until Jordan pressed Done or a minute passed, Alex could not start, and the screen gave him a reason that made no sense to him.

**Where:** `frontend/src/modules/inventory/pages/InventoryKioskPage.tsx:185`, the item branch of `onTag`.
**Fix:** when the item lookup refuses a tap, the page asks the server whether
it is a member's card. If so it greets that member; otherwise it shows the item
refusal as before. Only a refused tap costs the second request. Covered by a new case
in `InventoryKioskPage.test.tsx`, which fails against the old page. The
existing refusal case now has the card lookup refuse too, as the server does
for an item's tag. Re-driven: Alex's tap greeted Alex, with no alert.

### W45-2 — LOW — A suspended card was described as lost or replaced — ✅ FIXED

**Did:** Alex's card set to suspended (a temporary hold), then tapped.
**Saw:** "This card has been marked lost or replaced and no longer works." That
sends a member whose card is only on hold to ask for a new one. The check-in
station words it per status.
**Where:** `backend/app/services/inventory_kiosk_service.py:213`, `_member`.
**Fix:**

- Suspended reads "This card is suspended. Ask an officer."
- Lost and revoked read "This card has been marked lost|revoked and no longer works. Ask an officer to issue a replacement.", as the station does.

Covered by new cases in `test_inventory_kiosk.py`; three of the four fail
against the old service. Re-driven after a backend restart.

### W45-3 — LOW — Refusals shown to members ended in "(Error code: LB-API-409)" — ✅ FIXED

**Did:** every refused tap above.
**Saw:** each reason ended in "(Error code: LB-API-409)". The module header
calls a refusal an answer, not an error. The support code is appended to every
API error so members can quote it to IT. At a shared tablet it is noise under
a sentence already written for the member.
**Where:** `InventoryKioskPage.tsx:121`, `run`.
**Fix:** a 409 shows the server's reason alone. Any other failure keeps the code.
Covered by a new case. Re-driven: "Loaner Radio 1 is not available (in maintenance)."

### W45-4 — LOW — With NFC off, the kiosk told its officer to turn it on at a page they may not open — ✅ FIXED

**Did:** read while driving the NFC ID Cards branch, then confirmed under test.
**Saw:** the NFC-tags-off notice linked "Turn on NFC tags" to
`/inventory/admin/nfc`. That page takes the department-settings grant, and
`inventory.kiosk` is its own grant: an officer given only it reaches Access
Denied. This is the same wording W44-1 fixed on Tag Items in Bulk.
**Where:** `InventoryKioskPage.tsx:276`.
**Fix:** "An administrator can turn it on under NFC Tags", as on the other NFC
screens. Covered by a new case, which fails against the old page.

### W45-5 — NIT — The quartermaster's member-card lookup has the same "lost or replaced" wording — OPEN

`POST /inventory/nfc/resolve-member` (`inventory_nfc.py:850`) says "marked lost
or replaced" for a suspended card too. It is an officer-facing lookup, so less
misleading than the kiosk. Left for the run that drives it.

### W45-6 — NIT — The NFC ID Cards activation dialog does not mention the kiosk — OPEN

"What this turns on" lists tap to check in, officer-issued cards, and shifts,
meetings and admin hours. The inventory kiosk also needs this integration, and
turning it off also stops the kiosk.

## Checklist

| Section                 | Result                                                                          |
| ----------------------- | ------------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ borrow, return, damaged return; fixed W45-1                                  |
| 2. The right people     | ✅ member and quartermaster refused; the card, not the page, names the borrower |
| 3. Wrong input, failure | ✅ three double-clicks acted once; blank note and loan period 0 refused         |
| 4. Browser signals      | ✅ only the 409 refusals driven on purpose                                      |
| 5. Coming back to it    | ✅ loans and the damaged condition read back from the item page and database    |
| 6. On a phone           | ✅ borrow and return at 390×844, no horizontal scroll                           |
| 7. Everyone can use it  | ✅ labelled damage note; fixed W45-3                                            |
| 8. What happens around  | Fixed W45-2, W45-4; W45-5, W45-6 open                                           |

Afterwards: both review cards revoked and NFC ID Cards deactivated. The
Loaner Radios category and its two radios are left for later runs.

## Completion gate

| Check                    | Result                                                               |
| ------------------------ | -------------------------------------------------------------------- |
| npm run typecheck        | clean                                                                |
| npm run lint             | clean                                                                |
| flake8 (changed files)   | clean                                                                |
| black --check / isort    | clean                                                                |
| frontend tests (touched) | `modules/inventory` — 98 files, 1513 passed, no local server         |
| backend tests (touched)  | `test_inventory_kiosk`, `test_inventory_kiosk_endpoints` — 43 passed |
