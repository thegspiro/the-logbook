# Workflow Review — W20 Check-In: QR Self Check-In, Live Monitoring, an Officer's Manual Check-In

**Driven:** 2026-09-29 · **As:** `member` (390×844) and `secretary` (1280×900), with `member2` checked in and refused · **Viewports:** 1280×900, 390×844
**Commit:** `de766fa94` plus this run's fixes (re-driven, backend restarted) · **Database:** continued from W19; no reset

---

## What was driven

Setup, through the API as `secretary`: "W20 Night Drill", a Training event starting 15 minutes out with a flexible 30-minute check-in window. It has no training session linked.

1. As `secretary`: the event's QR code page.
2. As `member` at 390×844: the check-in page the QR code encodes (`/events/:id/check-in`).
   - Double-tapped **Check In to This Event**; reloaded; tapped again.
3. As `secretary`: **Check-In Monitoring**.
4. As `secretary`: the event's **Check In** dialog; searched "Alex" and checked `member2` in; then monitoring again.
5. As `member2`: `/events/:id/monitoring`, `POST …/check-in` and `GET …/check-in-monitoring`.
6. After the fixes, with the backend restarted: steps 2, 4 and 5 re-driven.

Not driven: an event whose linked training session creates records (the positive case of W20-1, covered by tests); NFC tag writing (not supported by this browser, and the page says so).

## Held up ✅

- **The QR page** shows the schedule and the check-in window in the department's time ("Scheduled: Sep 28, 8:00 PM – 10:00 PM · Check-in Available: 7:30 PM – 10:00 PM"), "Check-in is Active", a print button, and plain instructions.
- **Self check-in asks for a confirming tap** rather than checking in on page load.
  - A double tap made one check-in.
  - Tapping again after a reload shows the original time ("Checked In At: 7:46 PM") rather than a second record.
  - Nothing overflows at 390px.
- **Monitoring:**
  - It counts correctly: "1 of 27 members", then 2 after the manual check-in.
  - It explains an early tap without asking anyone to fix it: "Jordan Avery — tapped in 13 minutes early … credited from 8:00 PM".
  - It auto-refreshes.
- **Manual check-in** marks the member and shows the time in the dialog ("✓ Checked in at 7:52 PM"). Monitoring lists them on its next refresh.
- **`member2` is refused** the monitoring page ("Access Denied") and both APIs (`403`).

## Findings

### W20-1 — MED — The check-in screen said "Training Record Created" when no record was created — ✅ FIXED

**Did:** as `member`, checked in to the Training event.
**Saw:** "Successfully Checked In! … **Training Record Created** — Your attendance has been logged and a training record will be created for this session."
**Why it was false (read from code):**

- `_auto_create_training_record` writes a record only when the event has a linked training session with `auto_create_records` on. This event has neither.
- The page decided from `event_type` alone.
- So a member of any training event without a session was told a record exists, and would look for it in their training history.

**Where:**

- `frontend/src/pages/EventSelfCheckInPage.tsx`;
- `backend/app/services/event_service.py` (`get_qr_check_in_data`) and `backend/app/schemas/event.py` (`QRCheckInData`).

**Fix:**

- `QRCheckInData` gains `records_training`, which the server computes with the same test the record writer uses (pitfall 29). This is an additive field.
- The panel shows only when it is true.
- Its heading is "Training Record", no longer "Created" before the record exists.

**Tests:**

- `test_qr_check_in.py::TestQRCheckInRecordsTraining` (3 cases: a recording session, none, and a non-training event that must not query). All 3 failed before the fix.
- `EventSelfCheckInPage.test.tsx`, "Training record notice" (2 cases). Both failed before the fix.

**Re-driven:** the success screen for this event no longer mentions a training record.

### W20-2 — LOW — The manual check-in dialog's search field and its buttons had the wrong names — ✅ FIXED

**Saw:**

- `getByLabel("Search Members")` found nothing: the field's `aria-label` ("Search by name or email...") overrode its visible label.
- Each of the 26 rows had a button named only "Check In", so a screen reader user could not tell whose.

**Where:** `frontend/src/components/event-detail/EventCheckInModal.tsx`.
**Fix:**

- The `aria-label` is gone, so the visible "Search Members" names the field.
- Each button is named "Check in {name}".

**Test:** `EventCheckInModal.test.tsx` (new). It failed before the fix.
**Re-driven:** step 4 was done by these names.

### W20-3 — NIT — Monitoring's Status column printed "going" — ✅ FIXED

**Where:** `frontend/src/pages/EventCheckInMonitoringPage.tsx`.
**Fix:** it uses `getRSVPStatusLabel`, as W19-2 did for the activity feed.
**Test:** `EventCheckInMonitoringPage.test.tsx`, "recent check-ins". It failed before the fix.
**Re-driven:** "Going".

Seen and left:

- **After a reload, the check-in page offers "Check In to This Event" again** instead of saying the member is already checked in. Tapping it is harmless and shows the original time.
- **Every page has two "Skip to main content" links**, one in `index.html` and one in `AppLayout`. Recorded as a lead.

## Checklist

| Section                 | Result                                                           |
| ----------------------- | ---------------------------------------------------------------- |
| 1. The job gets done    | ✅ QR, self check-in, manual check-in and monitoring all agree   |
| 2. The right people     | ✅ `member2` refused the monitoring page and both APIs           |
| 3. Wrong input, failure | ✅ a double tap and a repeat tap made one check-in               |
| 4. Browser signals      | ✅ only the expected training-session `404` on the event page    |
| 5. Coming back to it    | ✅ the check-in holds; the page's pre-tap state is seen and left |
| 6. On a phone           | ✅ the self check-in page at 390px                               |
| 7. Everyone can use it  | ✅ after W20-2                                                   |
| 8. What happens around  | ✅ after W20-1: no false claim of a training record              |

## Completion gate

| Check                    | Result                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------- |
| npm run typecheck        | ✅ clean                                                                            |
| npm run lint             | ✅ clean                                                                            |
| flake8 / black (changed) | ✅ clean                                                                            |
| frontend tests           | ✅ check-in, monitoring, QR, event-detail and `EventDetailPage`: 9 files, 164 tests |
| backend tests            | ✅ 1,125 QR, check-in and event tests                                               |
