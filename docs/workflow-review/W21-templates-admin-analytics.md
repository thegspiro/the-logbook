# Workflow Review — W21 Event Templates, the Events Admin Hub, and Event Analytics

**Driven:** 2026-09-29 · **As:** `secretary`, with `member` refused · **Viewports:** 1280×900, 390×844
**Commit:** `497ae44c4` plus this run's fixes (re-driven) · **Database:** continued from W20; no reset

---

## What was driven

1. As `secretary`, on **Event Templates**:
   - **New Template**, first submitted empty;
   - then "Monday Drill": Training, default title "Monday Night Drill", location "Station 1", 120 minutes, created with a double-click; reloaded.
2. **Events Administration** (`/events/admin`): read the hub's counts against the data from W18–W20.
3. **Create Event**:
   - **Start from a Template** → Monday Drill;
   - set the start to 12 Oct, 7 PM;
   - read the end; created the event.
4. **Edit Monday Drill**: cleared Default Duration and Default Location, saved, reloaded.
5. **Deactivate**, then the create page's template list; then **Delete** and its confirmation.
6. **Event Analytics** (`/events/analytics`): read the totals against the data.
7. As `member`: all three pages; `POST /events/templates`, `GET /events/analytics/summary`.
8. As `secretary` at 390×844: all three pages.

## Held up ✅

- **Templates:**
  - An empty name is stopped ("Please fill out this field").
  - A double-click created one template, which is listed after a reload ("Monday Drill · Active · Training · 120 min").
  - The dialog is fully labelled, and the row buttons are named ("Edit Monday Drill", "Deactivate Monday Drill", "Delete Monday Drill").
- **The admin hub's counts match the data:**
  - "Upcoming 4 in the next 30 days": the three Fall Drills and the W19 meeting.
  - "RSVPs this week 4 · 3 going".
  - "Check-ins logged 2".
- **Creating from a template** fills the title, type and location, and the event it creates reads "Monday, October 12, 2026 at 7:00 PM to 9:00 PM · Station 1". This is after W21-1.
- **Deactivating** marks the template Inactive and removes it from the create page's picker.
- **Analytics:**
  - "Total Events 9" (cancelled excluded), "Total RSVPs 4", "Check-in Rate 50%";
  - the monthly split "Sep 1 · Oct 5 · Nov 3" and the type split "Training 8 · Business Meeting 1" all match the data.
- **`member`** reads "Access Denied" on all three pages; both APIs answer `403`.
- **At 390px:** none of the three pages scrolls sideways.

## Findings

### W21-1 — MED — Moving an event's start left its end behind, before the new start — ✅ FIXED

**Did:** Create Event → Start from a Template → Monday Drill, which pre-fills 9–11 PM today; then set the start to 12 Oct, 7 PM.
**Saw:** the end still read 28 Sep, 11:00 PM, earlier than the new start.

- `handleStartDateChange` set an end only when none existed.
- So any start moved after an end was set, and every template start is, left the end on the old day.
- Moved earlier, it would silently make a multi-day event.

**Where:** `frontend/src/components/EventForm.tsx`, `handleStartDateChange`.
**Fix:** when both are set, moving the start moves the end by the same amount, keeping the event's length.
**Test:** `EventCreatePage.test.tsx`, "carries the end with the start, keeping the length". It failed against the old `EventForm`.
**Re-driven:** the end followed to "12 Oct, 9:00 PM", and the event was created 7–9 PM.

### W21-2 — LOW — Clearing a template's default location or duration did not save — ✅ FIXED

**Did:** Edit Monday Drill, emptied Default Duration and Default Location, saved, reloaded.
**Saw:** the API still held `120` and `"Station 1"`.
**Why:** the form omitted blank fields, and on the update path an omitted key means "leave alone" (CLAUDE.md pitfall 1).
**Where:** `frontend/src/components/EventTemplateForm.tsx`; `EventTemplateCreate` in `frontend/src/types/event.ts`.
**Fix:**

- When editing, each cleared optional field is sent as `null`: description, default title, description, location, duration, max attendees, check-in window and minutes.
- Every one of those columns is nullable.
- A create still omits blanks.

**Tests:** `EventTemplateForm.test.tsx`, 2 cases (edit sends null; create omits). The edit case failed before the fix.
**Re-driven:** both fields read `null` after save and reload.

### W21-3 — NIT — The template picker had no accessible name — ✅ FIXED

**Where:** `frontend/src/pages/EventCreatePage.tsx`.
**Fix:** it is named "Start from a template".
**Test:** the W21 cases in `EventCreatePage.test.tsx` find it by that name.

### W21-4 — NIT — A template's default start was the next hour on the browser's clock — ✅ FIXED

**Read from code:**

- `templateToInitialData` built a naive wall-clock string from the browser's clock, which the form then reads as a browser-time instant.
- In a browser whose offset differs from the department's by part of an hour (India, UTC+5:30), the default landed on the half hour.

**Fix:** it takes the next hour on the department's clock (`useTimezone`) and passes UTC instants, which is what `EventForm` expects of `initialData`.
**Test:** "starts at the next hour on the department's clock", with a pinned clock. It checks the hour and the minute, and it fails against the old code when run with `TZ=Asia/Kolkata`.

### W21-5 — LOW — "Delete" a template deactivates it, while the dialog says it cannot be undone — FLAGGED

**Did:** Delete Monday Drill → "Are you sure you want to delete "Monday Drill"? This action cannot be undone." → Delete; reloaded.
**Saw:** the template is still listed, "Monday Drill · Inactive", the same as Deactivate.
**Why flagged:** `delete_template` deliberately soft-deletes ("Soft-delete a template by deactivating it"), presumably so events created from it keep a valid reference. Whether templates can be removed, and so which of the dialog or the button is wrong, is a product decision. Mirrored to `docs/KNOWN_LIMITATIONS.md`.

### W21-6 — LOW — Analytics' attendance rate counts upcoming events as no-shows — FLAGGED

**Saw:**

- "Avg Attendance Rate 67%". Two events have Going RSVPs: W20, which happened, 2 of 2 checked in; and W19, on 20 October, 1 going and nobody checked in, because it has not happened.
- "Top Events by Attendance" lists W19 at 0%.

**Why (read from code):**

- `get_analytics_summary` divides every checked-in RSVP by every Going RSVP in the period, pooled, and includes events that have not started.
- So the figure falls whenever members RSVP to something upcoming. It is also a pooled ratio, not an average, despite the label.

**Why flagged:** which events an attendance rate should cover, and whether it is pooled or averaged per event, is a metric definition. Mirrored to `docs/KNOWN_LIMITATIONS.md`.

Seen and left:

- **The analytics page and API disagree on permissions** (read from code). The page's route requires `analytics.view`, while `GET /events/analytics/summary` also accepts `events.manage`. A role with `events.manage` alone would be refused the page. No such role exists on the review install, so this was not driven.

## Checklist

| Section                 | Result                                                                            |
| ----------------------- | --------------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ after W21-1: template → event; the hub's counts are right                      |
| 2. The right people     | ✅ `member` refused on three pages and two APIs                                   |
| 3. Wrong input, failure | ✅ after W21-2; an empty name is stopped; double-click created once               |
| 4. Browser signals      | ✅ only the expected training-session `404` on the new event's page               |
| 5. Coming back to it    | ✅ templates and edits hold after reload                                          |
| 6. On a phone           | ✅ no overflow on the three pages                                                 |
| 7. Everyone can use it  | ✅ after W21-3                                                                    |
| 8. What happens around  | ❌ W21-5: Delete does not delete; W21-6: the attendance rate counts future events |

## Completion gate

| Check             | Result                                                                                                                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| npm run typecheck | ✅ clean                                                                                                                |
| npm run lint      | ✅ clean after replacing one `waitFor` + `getByRole` in the new test with `findByRole` (testing-library/prefer-find-by) |
| flake8 / black    | n/a — no Python changed                                                                                                 |
| frontend tests    | ✅ `EventCreatePage`, `EventForm`, `EventTemplateForm` and the templates page: 4 files, 82 tests                        |
| backend tests     | n/a                                                                                                                     |
