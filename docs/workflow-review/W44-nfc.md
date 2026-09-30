# Workflow Review — W44 NFC: Tag in Bulk, Put Away, Shelf Audit, Items Not Seen

**Driven:** 2026-09-30 · **As:** `admin` → `quartermaster`, with `member` refused · **Viewports:** 1280×900, 390×844
**Commit:** `5f54f9f76` (main, after #2825 and #2826) plus this run's changes · **Database:** continued from W43

---

## What was driven

The review browser (headless Chromium on Linux) has no Web NFC reader, so no
tag was physically tapped. Every NFC screen offers a typed serial number as the
alternative, which is also how a USB desk reader enters one. That typed path
was driven end to end, and it is the same request a tap sends.

1. As `quartermaster` with NFC off: the NFC settings page, Tag Items in Bulk, and Shelf Audit.
2. As `admin`: `/inventory/admin/nfc`, "Use NFC tags for inventory items", double-clicked, then a reload.
3. As `quartermaster` with NFC on:
   - Tag Items in Bulk → Read serials → serial `04:A1:B2:C3`, with Link serial double-clicked.
   - Shelf Audit → pick Shelf 1, enter the serial, then Finish audit double-clicked. The unexpected item was ticked, then "Move 1 selected onto Shelf 1" double-clicked.
   - Put Away → pick Turnout Rack A, enter the serial.
   - Items Not Seen at 180 days, before and after the tap.
4. As `member` at 390×844:
   - `POST /nfc/put-away`, `GET /not-seen` and `POST /nfc/resolve`;
   - all five pages.

## Held up ✅

- **The switch:** a double-clicked NFC toggle turned the feature on **once** ("NFC tag tracking turned on"), and it stayed on after a reload.
- **Without an NFC reader:** each screen says "This device or browser does not support NFC tags. NFC works only in Chrome on Android." It still offers the serial box, and tagging disables "Write links" rather than failing.
- **Tagging:**
  - A double-clicked Link serial linked **one** tag, storing only its hash and a four-character preview.
  - The progress count advanced ("1 tagged this session · 8 of 9 left").
- **Shelf audit:**
  - Finishing recorded one audit, listed under Recent audits.
  - It found the tapped item "recorded on no storage area" and listed it as unexpected.
  - Ticking it and moving it put it on Shelf 1 once ("1 item(s) moved onto Shelf 1").
  - The audit records who moved items and when.
- **Put-away:**
  - Tapping the item with Turnout Rack A open moved it there ("→ Turnout Rack A (was Shelf 1)").
  - The tap took it off Items Not Seen.
- **Refusals:**
  - `member` got 403 on put-away and the not-seen report, and Access Denied on all five pages.
  - `POST /nfc/resolve` answered the member (200): read from code, it takes `inventory.view`, deliberately the same grant as the barcode lookup it stands in for.

## Findings

### W44-1 — LOW — Tag Items in Bulk told the quartermaster to turn NFC on at a page they cannot open — ✅ FIXED

**Did:** `quartermaster`, Tag Items in Bulk with NFC off.
**Saw:** "NFC tag tracking is turned off for your department. Turn it on under
NFC Tags first." The link leads to `/inventory/admin/nfc`, which takes the
department-settings grant, and the quartermaster got Access Denied there. Put
Away and Shelf Audit already said "An administrator can turn it on under…".
**Where:** `frontend/src/modules/inventory/pages/InventoryNfcEnrollPage.tsx:193`.
**Fix:** worded as the other two screens. Covered by a new case in
`InventoryNfcEnrollPage.test.tsx`, which fails against the old page.

### W44-2 — NIT — Items Not Seen lists items created hours ago as unseen since April — OPEN

With 180 days, the report said "6 item(s) not seen since Thursday, April 2, 2026". Its first rows were items imported during W43, a few hours earlier, each marked "Never".
Read from code, this is deliberate: never-seen items are listed first, since
a new item nobody has handled is still unaccounted for. Whether creation counts
as being seen is a definition for the owner, so it is left.

### W44-3 — NIT — Two items with the same name cannot be told apart while tagging — OPEN

The tagging card shows the name, serial, asset tag, category and storage area.
The two imported `=HYPERLINK(…)` items had only the name and category, so the
second read exactly like the first after the first was tagged. Every item has a
barcode, but the untagged-items response does not carry it.

### W44-4 — NIT — Items Not Seen names a deleted storage area — OPEN

"W43 Trauma Shears" reads "Temp Bin", an area deleted in W43. The item's own page
shows "--" for the same link. W43-2 stops new cases, and this report is the one
place that still says where such an item was last recorded.

## Checklist

| Section                 | Result                                                                     |
| ----------------------- | -------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ switch, tag, audit, move, put-away, not-seen, via the typed-serial path |
| 2. The right people     | ✅ member 403 and Access Denied; fixed W44-1                               |
| 3. Wrong input, failure | ✅ five double-clicks acted once                                           |
| 4. Browser signals      | ✅ clean `events`                                                          |
| 5. Coming back to it    | ✅ the switch, tags, audit and moves survive reload                        |
| 6. On a phone           | refusals at 390×844; NFC itself not drivable here (no reader)              |
| 7. Everyone can use it  | ✅ NFC screens named throughout, including remove-from-audit               |
| 8. What happens around  | W44-2, W44-3, W44-4 open                                                   |

## Completion gate

| Check                    | Result                                      |
| ------------------------ | ------------------------------------------- |
| npm run typecheck        | clean                                       |
| npm run lint             | clean                                       |
| flake8 (changed files)   | no Python changed                           |
| black --check            | no Python changed                           |
| frontend tests (touched) | `modules/inventory` — 98 files, 1510 passed |
| backend tests (touched)  | none touched                                |
