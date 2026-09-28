# Workflow Review — W18 Create, Edit and Cancel an Event, Including a Recurring One

**Driven:** 2026-09-28 · **As:** `secretary`, with `member` refused · **Viewports:** 1280×900, 390×844
**Commit:** `9937d6521` plus this run's fixes (re-driven, backend restarted) · **Database:** continued from W17; no reset

---

## What was driven

The department's timezone is `America/Chicago`. US daylight saving ends on Sunday 1 November 2026.

1. As `secretary`, from `/events`: **Create Event** (to `/events/admin?tab=create`).
   - Submitted empty.
   - Then created "W18 Weekly Drill": Training, Mondays 7–9pm from 5 Oct, weekly until 16 Nov.
2. Opened occurrence 2, **Edit**, **This event only**: renamed it and moved it to 7:30–9:30pm; reloaded.
3. Opened occurrence 3, **Edit**, **This and all future events**: changed only the description.
4. On occurrence 1: **More → Cancel Event**, first with a 4-character reason, then a real one; reloaded.
5. **More → Cancel Entire Series**; read every occurrence back, and the list.
6. After the fixes, with the backend restarted: created "W18 Fall Drill".
   - Same schedule, skipping 12 Oct.
   - Then **This and all future events** from its second occurrence: description only, then start and end moved 30 minutes later.
7. As `member` at 390×844:
   - the list;
   - `/events/:id/edit` and `/events/admin?tab=create`;
   - `PATCH …/update-future`, `POST /events` and `POST …/cancel-series`.
8. As `secretary` at 390×844: the create form with recurrence on, and the cancel dialog.

Not driven: attachments, templates, check-in and attendance (their own activities); monthly, annual and custom patterns in the browser (covered by tests).

## Held up ✅

- **The form:**
  - Title, Start and End are marked required, and an empty submit is stopped on exactly those three.
  - Quick Duration and the recurrence options are clear.
- **Editing one occurrence:** **This event only** changed that occurrence alone ("Monday, October 12, 2026 at 7:30 PM to 9:30 PM"), and it held after a reload. The other six were untouched.
- **Cancelling one:** **Cancel Event** keeps its button disabled until the reason reaches 10 characters ("4/500 characters (minimum 10)"). After a reload the page reads "This event has been cancelled. Reason: …".
- **Cancelling the series:** **Cancel Entire Series** offers "Only cancel future events", cancelled all seven, and the list stopped showing them.
- **`member`:**
  - sees the series, with no Create or Edit;
  - both pages read "Access Denied";
  - all three APIs answered `403`.
- **At 390px:** no sideways scroll on the list or the form. The cancel dialog fits, its buttons are 44px, and its close button is named.
- **The `404` on `/training/sessions/by-event/:id` is expected.** It is the detail and edit pages asking whether a training session is attached; `getSessionByEvent` reads `404` as "none".

## Findings

### W18-1 — HIGH — A recurring series was stepped in UTC: a 7pm drill became 6pm when daylight saving ended — ✅ FIXED

**Did:** created a weekly 7–9pm series from 5 Oct to 16 Nov.
**Saw:**

- The list read "Mon, Nov 2 · 6:00 – 8:00 PM" from 2 November on.
- Every occurrence was stored at `00:00Z`, which is 7pm before the change and 6pm after it.

**Read from code, same cause:**

- `_generate_recurrence_dates` added 7 days to the stored UTC instant.
- A US evening is already the next day in UTC. So custom weekdays, "the Nth weekday of the month", and the dates to skip were all matched against the UTC day, which is a day late for any evening event.
- The client sends all three as the department's calendar (`EventForm`).
- The rolling 12-month extension (`run_rolling_recurrence_extend`) uses the same generator.

**Where:** `backend/app/services/event_service.py` (`_generate_recurrence_dates`, `create_recurring_event`) and `backend/app/services/scheduled_tasks.py` (`run_rolling_recurrence_extend`).
**Fix:**

- The generator takes the department's zone.
- It steps the series in wall-clock time there and converts each occurrence back to UTC, keeping the naive or aware form it was given.
- Both callers pass the zone; the rolling task resolves it once per organization.

**Tests:** `test_event_recurrence.py::TestDepartmentWallClock`, 5 cases:

- 7pm across the change;
- a local skip date;
- evening custom weekdays;
- naive in and naive out;
- the create path passing the zone.

All 5 failed against the old generator. `test_rolling_recurrence_extend_isolation.py` now stubs the new lookup, which is not what it tests.
**Re-driven:** "W18 Fall Drill" reads 7:00 PM on every Monday from 5 Oct to 16 Nov, and 12 Oct was skipped.

### W18-2 — HIGH — "This and all future events" put every later occurrence on the anchor's date — ✅ FIXED

**Did:** from occurrence 3 (19 Oct), **Edit → This and all future events**, changed only the description, **Save Changes**.
**Saw:** the five occurrences from 19 Oct on were all stored at `2026-10-20T00:00:00Z`. The dates of four occurrences were gone.
**Why:**

- `update_future_events` copied every field in the payload onto every future occurrence as-is.
- The edit form always sends `start_datetime`, `end_datetime` and any RSVP deadline, so any series edit collapsed the series onto one day.

**Where:** `backend/app/services/event_service.py`, `update_future_events`.
**Fix:**

- The times are applied as a change, not copied:
  - each occurrence moves by the anchor's own shift in the department's wall-clock time;
  - it takes the anchor's new length;
  - an RSVP deadline keeps the same lead ahead of each occurrence's own start.
- Unchanged times leave every occurrence's times alone, including ones edited individually.
- The finalized-attendance guard now fires only when times actually change, rather than whenever the form sends them.

**Tests:** `test_event_series_update.py::TestUpdateFutureEventsTiming`, 3 cases: unchanged times, a 30-minute move across the change, and a deadline lead. All 3 failed before the fix.
**Re-driven:**

- After a description-only series edit, all six occurrences kept their dates.
- Moving the start and end 30 minutes later gave 7:30 PM on each of 19 Oct to 16 Nov.

### W18-3 — MED — Series already stored wrong on existing installations are not repaired — FLAGGED

**Read from data and code:** this upgrade corrects new series and later edits. It does not touch series already stored:

- any series spanning a daylight-saving change is an hour off after it;
- evening series with custom weekdays, an Nth-weekday pattern or skip dates may sit on the wrong day;
- any series edited with "This and all future events" has its later occurrences collapsed onto one date, and those dates are not recoverable from the occurrence rows.

**Why flagged:** repairing them means regenerating occurrences from each parent's stored pattern. That would move events members have RSVP'd to, and it is a data migration. Mirrored to `docs/KNOWN_LIMITATIONS.md`.

### W18-4 — LOW — Schedule controls had no accessible name, or the same one twice — ✅ FIXED

**Saw:**

- The series end date, the date-to-skip field and "+ Add a reminder…" had no label.
- Each date-to-skip Remove button read only "Remove".
- The start and end time selects both announced "Time hour", "Time minute" and "Time AM/PM".

**Where:** `frontend/src/components/EventForm.tsx` and `frontend/src/components/ux/DateTimeQuarterHour.tsx`.
**Fix:**

- Named "Series end date", "Date to skip", "Remove 2026-10-12" and "Add a reminder".
- `DateTimeQuarterHour` takes an optional `timeLabel`. The event form passes "Start time" and "End time"; its 30 other users are unchanged.

**Test:** `EventForm.test.tsx`, "names every schedule control a screen reader reaches". It failed before the fix.
**Re-driven:** step 6 filled the form by these names.

### W18-5 — LOW — A cancelled occurrence read "Occurrence of 6" — ✅ FIXED

**Saw:** after cancelling occurrence 1, its page read "Occurrence of 6". The cancelled event is not in the active series it is counted against, so it has no position.
**Where:** `frontend/src/components/event-detail/EventRecurrenceInfo.tsx`.
**Fix:** it reads "Series of 6" when the event has no position.
**Test:** `EventRecurrenceInfo.test.tsx` (new). It failed before the fix.

### W18-6 — NIT — Tap targets on the event form at 390px — ✅ FIXED

These were under 44px on phones:

- the description toolbar (28px);
- Quick Duration (38px);
- **Add** for a skip date (36px);
- a reminder's "×" (16px).

They now carry `touch-target-phone`. **Re-driven:** nothing under 44px on the form at 390px.

Seen and left:

- **The detail page's More menu is a list of buttons with no menu semantics.**
- **The event form does not pass the department's timezone to its date-time pickers.** Picking a time before a date fills in the browser's today (`DateTimeQuarterHour` documents this).

## Checklist

| Section                 | Result                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ after W18-1 and W18-2: create, edit one, edit future, cancel one, cancel series |
| 2. The right people     | ✅ `member` refused on both pages and three APIs                                   |
| 3. Wrong input, failure | ✅ required fields and the 10-character reason are enforced                        |
| 4. Browser signals      | ✅ only the expected training-session `404`                                        |
| 5. Coming back to it    | ✅ edits and cancellations hold after reload                                       |
| 6. On a phone           | ✅ after W18-6; no overflow; the dialog fits                                       |
| 7. Everyone can use it  | ✅ after W18-4                                                                     |
| 8. What happens around  | ✅ times read in the department's zone after W18-1; existing data is W18-3         |

## Completion gate

| Check                            | Result                                                                                                                                                                                                                                             |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm run typecheck                | ✅ clean                                                                                                                                                                                                                                           |
| npm run lint                     | ✅ clean                                                                                                                                                                                                                                           |
| flake8 / black / isort (changed) | ✅ clean                                                                                                                                                                                                                                           |
| frontend tests                   | ✅ full suite: 614 files, 8,293 tests. The one failure, `testingRegistry.test.ts`, came from W17-4's route change and is fixed in its own commit. The new cases in `EventForm.test.tsx` and `EventRecurrenceInfo.test.tsx` failed before the fixes |
| backend tests                    | ✅ 1,123 event, recurrence, scheduled-task and training-session tests. The 8 new cases failed before the fixes                                                                                                                                     |
