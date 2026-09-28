# Workflow Review — W14 Check-in Station, Badge Scan, Member Labels and ID Cards

**Driven:** 2026-09-28 · **As:** `admin`, with `member2` refused · **Viewports:** 1280×900, 390×844
**Commit:** `52277b8` plus this run's fixes (re-driven) · **Database:** continued from W13; no reset

---

## What was driven

1. As `admin`, opened each page cold:
   - Scan Member ID;
   - Check-In Station;
   - Print Member Badges;
   - a member's digital ID card.
2. Settings → Integrations: activated **NFC ID Cards**. It is off on this install, and the station says so.
3. On `member`'s profile (Jordan Avery), issued a card with serial `04A1B2C3D4E5F6`. Then tried to issue the same card, written `04:a1:b2:c3:d4:e5:f6`, to `member2`.
4. At the Check-In Station, targeted Admin hours → Fundraising and entered the serial as a USB reader would. In order:
   - tap in;
   - tap again at once;
   - an unregistered card;
   - "Checks out";
   - suspended the card on the profile and tapped it again.
5. As `member2`, opened the station and sent `POST /nfc-tags/check-in` and `POST /nfc-tags`.
6. From the member directory, selected two members → **Print Badges**.
7. Every page at 390×844.
8. Removed the test card and deactivated NFC ID Cards, which put the install back as found.

A camera cannot be driven in this harness. The badge-scan finding (W14-1) is read from code and pinned by a test that feeds the scanner a decoded value.

## Held up ✅

- **Card issue:**
  - An officer issues a card from the member's profile, and the card lists with its last four characters, issue time and "never used".
  - The same card in another format is refused: "This card is already registered to another member. Revoke the existing registration before reissuing it."
- **The station:**
  - It says clearly when NFC ID cards are off, and why nothing can be read.
  - A USB reader or typed serial works on a device without Web NFC.
  - The target and direction buttons carry `aria-pressed`.
  - The tap sequence:
    - First tap: "Jordan Avery — Clocked in to Fundraising".
    - A second tap at once: "Already checked in just now", with no double entry.
    - An unknown card: "This card is not registered. Ask an officer to add it to your member record."
    - Checks out: "Clocked out of Fundraising. 0 minutes recorded."
    - A suspended card: "This card has been marked suspended and no longer works."
- **Card controls:**
  - Suspend is reversible, via Reactivate.
  - Lost and Remove both ask first and say what they do.
- **`member2` is refused** the station ("Access Denied"), the check-in API (`403`) and card registration (`403`).
- **Print Badges** takes the selected members and lays out one label per member, with Code 128 or QR and a PDF.

### The ID-card QR lead (from W10) — resolved, read from code

The digital ID card's QR code is unsigned JSON: `{type, id, membership_number, org}`. It is read in two places:

- **Scan Member ID** requires `users.view` or `members.manage`, and opens the member's profile.
- **`MemberIdScannerModal`** is used on inventory's officer screens to pick a member.

Both are officer-operated lookups. The two places a member identifies themselves do not read it:

- the Check-In Station;
- the inventory kiosk.

Both use officer-issued NFC cards, resolved on the server. The station's refusal of an unknown or suspended card was driven here; the kiosk's is read from code and is W45's to drive. So a forged QR code can only make an officer's screen open a profile the officer could already open. It proves nothing about who is standing there. The lead is closed.

## Findings

### W14-1 — MED — A badge printed for a member without a membership number could not be scanned by the app — ✅ FIXED

**Did:** printed badges for Jordan Avery and Alex Brooks, who have no membership number.
**Saw:** each label's barcode carried `1996D34A56FE`, a short id. For a member without a number, `label_service._build_member_specs` falls back to `_short_id(user.id)`: the id without dashes, first twelve characters, upper-case.

**Read from code:** both scanners resolve only two things:

- the ID card's JSON;
- a membership number.

So the department's own printed badge scanned as `No member found for "1996D34A56FE"`. Nothing warns the officer when printing.
**Where:** `MemberScanPage.tsx` and `MemberIdScannerModal.tsx`, the plain-text match.
**Fix:**

- A shared `matchesMemberBadgeCode` (`utils/memberBadgeCode.ts`) matches a membership number or the badge's short id, with a comment naming the backend function it mirrors.
- Both scanners use it.
- Badges already printed now scan; no reprint is needed.

**Test:**

- `memberBadgeCode.test.ts`;
- `MemberScanPage.test.tsx`, which feeds the scanner `1996D34A56FE` and expects the member's profile. It failed before the fix.

### W14-2 — LOW — The integration Activate/Connect dialog was not announced as a dialog — ✅ FIXED

**Did:** Integrations → NFC ID Cards → Activate.
**Saw:** the dialog opened, but nothing in it carried `role="dialog"` or a name. This review's own check for an open dialog found none, and a screen reader reads the page behind as live.
**Why here and not in the shared panel:** `DialogPanel` sets a role only when its caller passes one. Defaulting it there was tried. It broke 19 tests in 5 files, because most screens already put `role="dialog"` on the overlay around the panel, and the default produced nested dialogs. The fix went on this dialog instead.
**Fix:** `role="dialog"`, named by its heading.
**Re-driven:** found as "Activate NFC ID Cards".
**Test:** `IntegrationsPage.test.tsx`.

### W14-3 — NIT — Tap targets at 390px — ✅ FIXED

These are now 44px on phones:

- "Back to Members" on Scan Member ID (20px);
- "Back to Profile" on the ID card (20px);
- on the shared label-print page used by every module: the back link (20px), and the Settings, PDF and Browser print buttons (34–38px).

Seen and left:

- **Deactivating NFC ID Cards takes one click.** It is reversible, and cards stay registered.
- **The digital ID card shows the raw status**: "active", in lower case.
- **A quick second tap reads "Already checked in just now"** rather than checking out. This is the station's duplicate-tap guard, and it is correct for a card held against a reader.

## Leads for later activities

- **Facilities, reports and inventory activities** — four dialogs built on `DialogPanel` have no `role` on the panel or on a wrapper:
  - the facilities lookup editor (`FacilitiesSettingsPage.tsx`);
  - the report viewer (`ReportsPage.tsx`);
  - InventoryScanModal's confirm and custody-transfer dialogs.

  Give each `role="dialog"` and a name. The inventory pair sits inside another modal, so check the test file's dialog queries when changing it.

## Checklist

| Section                 | Result                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ issue card → tap in → out → suspend; print badges; ID card; W14-1 fixed                   |
| 2. The right people     | ✅ `member2` refused on page and both APIs; the QR lead closed                               |
| 3. Wrong input, failure | ✅ duplicate, unknown and suspended cards refused with reasons                               |
| 4. Browser signals      | ✅ only the provoked `400` (the duplicate card)                                              |
| 5. Coming back to it    | ✅ card state and admin-hours entries read back on the profile                               |
| 6. On a phone           | ✅ after W14-3                                                                               |
| 7. Everyone can use it  | ✅ after W14-2; station controls carry `aria-pressed` and live results                       |
| 8. What happens around  | ✅ test card removed, NFC ID Cards deactivated again; one 0-minute admin-hours entry remains |

## Completion gate

| Check                    | Result                                                                                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | ✅ clean                                                                                                                                                                               |
| npm run lint             | ✅ clean                                                                                                                                                                               |
| flake8 (changed files)   | n/a — no Python changed                                                                                                                                                                |
| black --check            | n/a                                                                                                                                                                                    |
| frontend tests (touched) | ✅ full suite: 607 files, 8,255 tests. The W14-1 page case failed against the old scanner. A shared `DialogPanel` default was tried first and reverted after it broke 19 tests (W14-2) |
| backend tests (touched)  | n/a                                                                                                                                                                                    |
