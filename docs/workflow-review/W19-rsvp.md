# Workflow Review — W19 RSVP, Change It, and See It on the Event

**Driven:** 2026-09-28 · **As:** `member`, `member2`, with `secretary` reading the result · **Viewports:** 1280×900, 390×844
**Commit:** `5821006fd` plus this run's fixes (re-driven, backend restarted) · **Database:** continued from W18; no reset

---

## What was driven

Setup, through the API as `secretary` (event creation was W18): "W19 Officers Meeting".

- Business meeting, Tuesday 20 Oct, 7–9pm Chicago time.
- RSVP required, deadline 6pm that day.
- **One seat.** Going, Not Going and Maybe allowed; guests allowed.

1. As `member`, from `/events`: opened the meeting and clicked **RSVP Now**.
   - Going with 1 guest: two people for one seat.
   - Then Going alone, with a note; reloaded.
2. As `member2`: **RSVP Now**, Going, on the now-full meeting; reloaded.
3. As `member`: **Change RSVP** to Not Going; reloaded both members' pages and `member2`'s notifications.
4. As `secretary`: the event's Attendance list and RSVP Activity.
5. As `member` at 390×844: **Change RSVP**, Maybe, double-clicking Submit.
6. After the fixes: the one-seat refusal, the activity feed and the choice sizes, re-driven.

## Held up ✅

- **The dialog is fully labelled.** It offers exactly the event's allowed answers. **Change RSVP** reopens with the member's current answer (Going, 0 guests).
- **An impossible party is refused in the dialog, not silently:** "This event holds 1 person, so a party of 2 cannot be accommodated."
- **Going holds after a reload.** The page shows "Your RSVP — Going" and "Capacity 1 / 1 · Event Full".
- **A full event waitlists rather than refuses:** "You're #1 of 1 on the waitlist. You'll be automatically moved to "Going" if a spot opens up."
- **When `member` declined, `member2` was promoted automatically:**
  - Their page reads "Going".
  - Their notifications hold "You're off the waitlist: W19 Officers Meeting" (in-app).
- **The officer sees all of it:** Alex Brooks Going; Jordan Avery Not Going, with the note "Bringing the minutes."
- **Times are shown in Chicago time.**
- **A double-click on Submit wrote exactly one change.**
- **At 390px:** no sideways scroll; the dialog fits; its buttons are 44px.
- **The `403` on `GET /events/:id/attendees` for members is deliberate** (read from code). Whether members may see who is going is set per event; the page asks, and `getEventAttendees` reads `403` as "not allowed" and shows no list.

## Findings

### W19-1 — MED — A member promoted off the waitlist is told only in the app, not by email — FLAGGED

**Read from code, and seen in `member2`'s notifications:** `promote_from_waitlist` logs an `in_app` notification and sends nothing else (`event_service.py`, "Tell the promoted member they're off the waitlist").
**Why it matters:**

- CLAUDE.md pitfall 18 makes email the channel of record, with the bell layered on top. A member who reads only their inbox never learns they are now confirmed.
- They may not come, and their seat is held.

**Why flagged:** it means a new outbound email, with its own template and a place in the per-member email switches added in #2774. That is a product change beyond a fix. Email is off on the review install, so it could not be driven either way. Mirrored to `docs/KNOWN_LIMITATIONS.md`.

### W19-2 — LOW — RSVP Activity printed stored values: "changed from going to not_going" — ✅ FIXED

**Saw:** in the officer's feed, "Jordan Avery changed from going to not_going" and "Alex Brooks RSVP'd as waitlisted".
**Where:** `frontend/src/components/event-detail/EventRSVPSection.tsx`.
**Fix:**

- Each status uses the same labels as the rest of the page ("Not Going", "Waitlisted").
- An unrecognised value is shown as-is.

**Test:** `EventRSVPSection.test.tsx` (new). The labels case failed before the fix.
**Re-driven:** "Jordan Avery changed from Not Going to Maybe".

### W19-3 — LOW — An automatic promotion does not appear in RSVP Activity — FLAGGED

**Saw:** the feed reads "Alex Brooks RSVP'd as Waitlisted", with nothing after it, while the list above shows Alex Going.
**Why flagged:**

- `promote_from_waitlist` writes no history row.
- A row with `changed_by` empty reads as the member changing it themselves ("Null means self-change").
- Recording it honestly as automatic needs a new column or marker on `rsvp_history`, which is a migration.

Mirrored to `docs/KNOWN_LIMITATIONS.md`.

### W19-4 — NIT — "This event holds 1 people" — ✅ FIXED

**Where:** `backend/app/services/event_service.py`, the party-size refusal.
**Fix:** it now reads "1 person".
**Test:** `test_event_rsvp_waitlist.py::test_a_one_seat_event_says_person_not_people`. It failed before the fix.
**Re-driven:** yes.

### W19-5 — NIT — The Going / Not Going / Maybe choices were 20px tall on a phone — ✅ FIXED

**Where:** `frontend/src/components/event-detail/EventRSVPModal.tsx`.
**Fix:** each choice's label carries `touch-target-phone`.
**Re-driven:** all three measure 44px at 390px.

## Checklist

| Section                 | Result                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ RSVP, change, waitlist and automatic promotion, all read back after reload       |
| 2. The right people     | ✅ each member sees only their own RSVP; the officer sees all                       |
| 3. Wrong input, failure | ✅ an impossible party is refused in the dialog; double submit wrote once           |
| 4. Browser signals      | ✅ the deliberate `403` on attendees; the provoked `400`                            |
| 5. Coming back to it    | ✅ each change holds after reload                                                   |
| 6. On a phone           | ✅ after W19-5                                                                      |
| 7. Everyone can use it  | ✅ the dialog is fully labelled                                                     |
| 8. What happens around  | ❌ W19-1: the promotion is in-app only; W19-3: it is missing from the activity feed |

## Completion gate

| Check                    | Result                                                              |
| ------------------------ | ------------------------------------------------------------------- |
| npm run typecheck        | ✅ clean                                                            |
| npm run lint             | ✅ clean                                                            |
| flake8 / black (changed) | ✅ clean                                                            |
| frontend tests           | ✅ event-detail components and `EventDetailPage`: 5 files, 91 tests |
| backend tests            | ✅ `test_event_rsvp_waitlist.py`, 46 tests                          |
