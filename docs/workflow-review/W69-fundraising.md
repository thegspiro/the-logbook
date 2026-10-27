# Workflow Review — W69 Fundraising: Campaigns, Donors, Donations, Reports

**Driven:** 2026-10-15 · **As:** `treasurer`, with `secretary`, `member`, `quartermaster` for access · **Viewports:** 1280×900, 390×844
**Commit:** `origin/main` of 2026-10-15 plus this run's changes · **Database:** continued from W68

---

## What was driven

1. As `treasurer`, Campaigns:
   - New Campaign submitted empty;
   - then "2026 Thermal Camera Drive", Equipment, $25,000 goal, from
     1 October, status **Active**, Create double-clicked;
   - Mark as restricted fund;
   - after the fixes, "Pancake Breakfast 2026", Event, $3,000, 1–8 November,
     Active, and the new status control.
2. Donors: Maria Lopez (individual) and Dale Harmon of Valley Hardware
   (business), each saved with a double-click.
3. Donations → Record Donation: $500 by check from Maria and $2,500 by bank
   transfer from Valley Hardware, both to the camera drive, Record
   double-clicked. Then the Donations list.
4. Pledges: a $1,000 pledge from Valley Hardware, edited to $400 received.
5. Fundraising Events: "Pancake Breakfast", edited.
6. Reports → Fundraising for 1 January – 15 October, and the Grants &
   Fundraising dashboard.
7. Access: an anonymous $250 gift recorded, then `secretary`
   (fundraising.view), `member` and `quartermaster` (neither) on the
   Donations page, the Campaigns page and a campaign PUT.
8. At 390×844: every fundraising page and the dashboard.

Not driven: deleting a campaign, recurring donations, and receipts (nothing on
the Donations page sends or marks one; see leads).

## Held up ✅

- Every double-click (campaign, donor, donation) recorded once.
- Each donation moved the campaign to $3,000 of $25,000 (12%) and set each
  donor's total, count and last-donation date; a donation entered for
  10 October in Chicago stored as `2026-10-10T05:00:00Z` and showed 10/10/2026.
- The event's time read 7:00 AM Chicago for `13:00Z`.
- Reports: $3,000 raised, 2 donations, 2 donors, $1,500 average, Bank
  Transfer 83.3% / Check 16.7%. The dashboard's Outstanding Pledges read $600
  after the $400 payment.
- Access: `member` and `quartermaster` see Access Denied and get 403; the
  `secretary` sees the donations with no Record Donation, no campaign status
  control, the anonymous gift as "Anonymous", and gets 403 on a PUT.
- 390×844: no sideways scroll on any page.

## Findings

### W69-1 — HIGH — Every fundraising edit was a 500 and rolled back — ✅ FIXED

**Did:** Campaigns → Mark as restricted fund, with a purpose; then, through
the API, a `notes` edit on a donor, a donation, a pledge and an event (the
pledge and event edits are what their pages' Save buttons send).
**Saw:** "Internal server error (LB-SYS-001)"; the campaign stayed
unrestricted after a reload. All five `PUT`s returned 500.
**Where:** `fundraising_service.py` — `update_campaign`, `update_donor`,
`update_donation`, `update_pledge`, `update_fundraising_event` flushed and
returned without a refresh, so `updated_at` (expired by `onupdate`) was
lazy-loaded by the response model and raised MissingGreenlet. The W68 lead.
**Fix:** refresh after the flush in all five. Re-driven: the restriction,
a pledge payment of $400 ("Pledge saved", $600 remaining after a reload) and
an event edit ("Event saved") all persist.
`tests/test_fundraising_updates.py::TestUpdatesReturnTheSavedRow` (fails 5/5
without the fix).

### W69-2 — MED — A campaign could only ever be Draft — ✅ FIXED

**Did:** created the camera drive with Status **Active**.
**Saw:** the card read **Draft**. `CampaignCreate` had no `status`, so the
choice was dropped; and no control could change a campaign's status
afterwards, so no campaign could be activated, paused or completed — the
dashboard's Active Campaigns stayed 0.
**Fix:** `status` on `CampaignCreate` (default `draft`, so a caller that
omits it is unchanged); a Status select on each card for
`fundraising.manage`; and the create form's missing **End Date** (the card
read "Ongoing" with no way to say otherwise). `TestCampaignCreateStatus` and
`fundraisingWorkflow.w69.test.tsx`.

### W69-3 — MED — Donations from a directory donor read "Unknown" — ✅ FIXED

**Did:** recorded both gifts against directory donors, opened Donations.
**Saw:** both rows **Unknown**; status shown as the raw `completed`. A
directory gift stores `donor_id` only — `donor_name` is for a walk-in — and
the list printed `donor_name`.
**Fix:** names come from the donors list, as the Pledges page already does.
Not resolved on the server, because `present_donation` masks only by the
gift's own anonymity flag: a server-side name from an anonymous _donor_ would
reach a view-only caller, while the donors list is masked per caller already.
Status uses `PAYMENT_STATUS_LABELS`. A failed load now says so instead of
"No donations recorded yet."; the list loads up to the API's 1,000 (it was
the default 100, under a "Total" that would have silently undercounted).

### W69-4 — MED — "Total Raised (12mo)" always read $0 — ✅ FIXED

**Saw:** the dashboard read $3,000 year-to-date and $0 for twelve months.
**Where:** the API serializes `total_raised_12mo` as `totalRaised12Mo`
(camel-casing capitalises the M); the page read `totalRaised12mo`.
**Fix:** the frontend type and the tile read `totalRaised12Mo` (the API is
unchanged).

### W69-5 — LOW — Smaller defects — ✅ FIXED

- The Add Donor form's ten labels were not tied to their fields; the email and
  call links were icon-only with no name; both filters were unnamed.
- Reports' monthly table printed `2026-10`; now "October 2026".
- Campaign and donor create failures said only "Failed to …"; they now give
  the server's reason.
- Touch targets under 44px: New Campaign, Add Donor, the restricted-fund
  button and checkbox, the donation form's back link and checkboxes, the
  Reports tabs, and the dashboard's View Grant / View Campaign / New
  Application.

### W69-6 — LOW — A business donor must be entered as a person — ✅ FIXED 2026-10-26

Owner decision: every non-individual donor type may be recorded by organization name
alone; an individual still needs both names. `donors.first_name`/`last_name` are
nullable (migration `e03f96c98452`), `FundraisingService.check_donor_name` holds the rule
for create and update, and the Add Donor form asks for an organization name for those
types. Original finding below.

The API requires `first_name` and `last_name` on every donor
(`DonorBase`), so Valley Hardware had to be entered as "Dale Harmon (Valley
Hardware)". A foundation or a business with no named contact cannot be
added. Mirrored to KNOWN_LIMITATIONS.

## Checklist

| Section                 | Result                                                                      |
| ----------------------- | --------------------------------------------------------------------------- |
| 1. The job gets done    | ❌ → ✅ every edit 500ed; campaigns stuck in Draft; fixed                   |
| 2. The right people     | ✅ view / manage / none held on screen and API; anonymity held              |
| 3. Wrong input, failure | ✅ empty campaign and donor forms refused with a message; reasons now shown |
| 4. Browser signals      | ❌ → ✅ five 500s; clean after                                              |
| 5. Coming back to it    | ✅ every write checked after a reload and from the API                      |
| 6. On a phone           | ✅ no sideways scroll; touch targets fixed                                  |
| 7. Everyone can use it  | ❌ → ✅ donor form labels and link names                                    |
| 8. What happens around  | ❌ → ✅ dashboard 12-month total; campaign totals and donor stats held      |

## Completion gate

| Check                    | Result                                                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| npm run typecheck        | ✅ clean                                                                                                                         |
| npm run lint             | ✅ clean                                                                                                                         |
| flake8 (changed files)   | ✅ clean                                                                                                                         |
| black --check            | ✅ clean                                                                                                                         |
| frontend tests (touched) | ✅ `src/modules/grants-fundraising` 72 passed                                                                                    |
| backend tests (touched)  | ✅ grant / fundraising / donor / donation / pledge / campaign: 821 passed after the mock fix; new file fails 7/7 without the fix |
