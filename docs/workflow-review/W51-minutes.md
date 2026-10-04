# Workflow Review — W51 Meeting Minutes: Draft, Approve, Publish

**Driven:** 2026-10-03 · **As:** `secretary`, `chief`, `member` · **Viewports:** 1280×900, 390×844
**Commit:** `df5696d` plus this run's changes · **Database:** continued from W60

---

## What was driven

1. As `secretary`, from the dashboard: More → Governance → **Minutes**. Record
   Minutes:
   - title only;
   - then "W51 October Business Meeting", 1 Oct 2026, Station 1, called by
     "Chief Morgan", with Start Recording double-clicked;
   - then a meeting of type **Executive Meeting**.
2. The book icon ("Create minutes from this meeting") on the October meeting.
   On the minutes:
   - a motion (Add Motion double-clicked);
   - an action item due 15 Oct (Add double-clicked);
   - Submit for Approval double-clicked;
   - then **Approve Minutes** as the same secretary.
3. As `chief`: `/minutes`, then the minutes by URL. Approve, then Publish to
   Documents double-clicked. The document was read back through
   `/documents`.
4. As `member`:
   - `/minutes`, and the approved minutes by URL;
   - a `PUT` to the minutes;
   - the list API.
5. As `secretary`, the book icon on the October meeting again, then the reject
   path on the second set:
   - a Call to Order section was written and the page reloaded;
   - the minutes were submitted;
   - `member` opened them by deep link;
   - `chief` rejected them, first with a 9-character reason, then with a full
     one;
   - `secretary` read the reason and checked that editing and resubmitting
     were offered.
6. After the fixes, re-driven:
   - `secretary` recorded "W51 November Business Meeting" (5 Nov, 7:00 PM)
     and created its minutes, with the icon double-clicked;
   - `chief` found them from the list and approved them;
   - `member` followed the links;
   - a business-meeting event was created and linked to minutes (the
     W18 / W51 lead).
7. At 390×844: the list, the create dialog, the minutes page, and the card's
   icon buttons.

Not driven: templates, minutes search, attendance waivers, and the election
link from the minutes side (W50 owns elections).

## Held up ✅

- **Double-clicks:** Start Recording made one meeting. Add Motion, Add (action
  item), Submit and Publish each acted once. The second publish made no
  second document: version 1, one row.
- **Separation of duties:** the secretary's own approval was refused with
  "You cannot approve your own meeting minutes…". `chief` then approved, and
  `approved_by` is the chief.
- **Reject:** a 9-character reason kept Reject disabled. The full reason was
  shown to the secretary, and the minutes became editable and resubmittable.
- **Saved work:** a written section survived a reload.
- **Members:**
  - `member` got a 404 ("Meeting minutes not found") on unapproved minutes by
    deep link, and saw only approved minutes in the list API;
  - their `PUT` got a 403;
  - they were offered no workflow buttons.
- **Publishing:** the document is in the Meeting Minutes folder, attributed to
  the chief.
- **Linking an event:** it showed the event's start as "Thursday, October 1,
  2026 at 7:00 PM" in the department's timezone, and it survived a reload.
- **Phone:** no sideways overflow on the list or the minutes page, and the
  create dialog's title (y=45) and Start Recording (bottom 808) were on
  screen.

## Findings

### W51-1 — HIGH — Minutes from a meeting carried the wrong date and time — ✅ FIXED (going forward)

**Did:** created minutes from a meeting dated 1 Oct with no start time.
**Saw:** the header read "Wednesday, September 30, 2026 at 7:00 PM". The API
held `2026-10-01T00:00:00Z`. A meeting at 7:00 PM would have been stored as
19:00Z and shown as 2:00 PM. Minutes are the legal record of the meeting, and
they were dated the day before it.
**Where:** `MinuteService.create_from_meeting` combined the meeting's date and
start time with `tzinfo=timezone.utc`. Both are the department's wall clock.
**Fix:**

- The date and start time are read in the organization's scheduling timezone
  (`resolve_scheduling_timezone`) and converted to UTC.
- Re-driven: a 5 Nov 7:00 PM meeting reads "Thursday, November 5, 2026 at
  7:00 PM".
- Tests: `test_meeting_time_is_read_on_the_department_clock` and
  `test_meeting_with_no_time_stays_on_its_own_date` in
  `test_minute_service.py`. Both fail on the old code with the bug's values.
- **Existing rows are not corrected.** That is a data backfill, flagged in
  W51-8.

### W51-2 — HIGH — The Minutes page never led back to minutes — ✅ FIXED

**Did:**

- as `chief`, opened `/minutes` while the October minutes awaited approval;
- as `member`, opened it after they were approved.

**Saw:**

- The page lists meetings only. Neither role had a link to any minutes: zero
  `a[href^="/minutes/"]`, and the cards are not clickable.
- The only routes in were the redirect right after creation and the Action
  Items page. An approver could not find what they were asked to approve.
- "Pending approval" read **0** while the minutes awaited approval. It counted
  the meeting records' own status, which nothing advances.

**Fix:**

- `MinutesListItem` now carries `meeting_id`, an additive response field.
- The page loads every set of minutes the caller may see (all pages) and
  lists them under their meeting, as links with their state ("Awaiting
  approval", "Approved", "Returned for changes").
- Members get only the approved ones, which the server already decides.
- The Pending approval tile reads the minutes stats endpoint (pitfall 29).
- Re-driven: `chief` saw "Pending approval 1" and followed the link to
  approve; `member` saw both approved minutes as links.
- Tests: `MinutesPage.minutesLinks.test.tsx`.

### W51-3 — MED — The book icon wrote a second set of minutes for a meeting that had them — ✅ FIXED

**Did:** pressed the book icon on the October meeting after its minutes were
approved and published.
**Saw:** a second draft "Minutes: W51 October Business Meeting" was created.
**Fix:**

- When a meeting has minutes, the icon opens the newest ("Open the minutes of
  …"). Only a meeting with none gets new minutes.
- The create path is guarded against a double-click and shows the server's
  reason on failure.
- The API still allows a second set, for example from a second tab. Making it
  idempotent changes the endpoint, so it is left as is.
- Re-driven: a double-click created one set.

### W51-4 — MED — Executive, Trustee and Annual meetings could not be recorded — ✅ FIXED (UI) / FLAGGED (types)

**Did:** Record Minutes → Meeting Type "Executive Meeting", with a title and a
date.
**Saw:** `POST /meetings` returned 422, and the dialog said "Make sure it has
a title and a date", which both were.
**Where:** `meetings.meeting_type` is a database ENUM of five types. The
dialog offered the eight minutes types.
**Fix:**

- The dialog and the filter offer the five a meeting accepts.
- A refused create now shows the server's message.
- Making closed (executive) sessions recordable needs a migration on
  `meetings.meeting_type`, plus a mapping in `create_from_meeting`. That is
  flagged for the owner in `KNOWN_LIMITATIONS.md`.

### W51-5 — MED — An action item's due date read a day early — ✅ FIXED

**Did:** added an action item due 15 Oct.
**Saw:** "Due: 10/14/2026". The calendar day is stored at UTC midnight and was
converted to Chicago time.
**Fix:**

- `formatCalendarDate`; re-driven, "Due: Oct 15, 2026".
- Test: `MinutesDetailPage.approval.test.tsx`.
- The Action Items page is a lead for W52.

### W51-6 — LOW — The submitter was offered Approve — ✅ FIXED

**Saw:** the secretary who submitted saw Approve Minutes. Pressing it got the
server's refusal (400).
**Fix:**

- The submitter now reads "Waiting for another officer to approve. You
  submitted these minutes, so you cannot approve them."
- Reject stays available, as a way to withdraw.
- Test: `MinutesDetailPage.approval.test.tsx`, which also checks that another
  officer is still offered Approve.

### W51-7 — LOW — Smaller defects on the meetings list — ✅ FIXED

- **Dates:** a meeting's date printed as `2026-10-01` and its time as
  `19:00`. They now read "Thu, Oct 1, 2026" and "at 7:00 PM".
- **Dialog semantics:** the create dialog had no `role="dialog"`, name or
  `aria-modal`.
- **Date check:** Start Recording was enabled without the required date, so
  the date was only checked by a 422 round trip.
- **Icon buttons:**
  - the card's icon buttons were named only by `title`; they now carry an
    `aria-label` naming the meeting;
  - at 390px they were 32×32, and are now 44×44 on phones through
    `touch-target-phone`, unchanged on desktop.
- **Tests:** `MinutesPage.minutesLinks.test.tsx` covers the dates, the dialog
  and the date requirement. The tap size was measured in the browser only:
  `mobile-route-integrity`'s `/minutes` fixture has no meetings, so it never
  renders these buttons.

### W51-8 — MED — Minutes already created from meetings keep the shifted date — FLAGGED

Every set of minutes created through "Create minutes from this meeting" before
W51-1 is dated at the meeting's date and time read as UTC. For a US
department, that is the previous evening, or 5–6 hours early. The meeting is
still linked (`meeting_id`), so a backfill could recompute the date. But a
secretary may have corrected the date by hand since, and a backfill cannot tell
that apart. Owner decision, in `KNOWN_LIMITATIONS.md`.

### W51-9 — LOW — A meeting's own status badge never moves — OPEN

The meetings list badges each meeting "Draft". Nothing in the UI advances a
meeting record's status, so it still read Draft beside approved, published
minutes. Now that minutes show their own state on the card, the meeting badge
is mostly redundant. Whether to drop it, or to drive it from the minutes, is a
product choice, so it is left as a lead.

## Checklist

| Section                 | Result                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. The job gets done    | Drafted, approved, published, read. Fixed W51-1, W51-2 and W51-3.                                                                                      |
| 2. The right people     | Held: separation of duties; `member` sees approved minutes only and is refused writes.                                                                 |
| 3. Wrong input, failure | Held: the reject reason rule. Fixed W51-4 and the date requirement.                                                                                    |
| 4. Browser signals      | Clean apart from the refusals above. A member's deep link to a draft fetches it twice (two 404s, harmless).                                            |
| 5. Coming back to it    | Held: a section and an event link survived a reload.                                                                                                   |
| 6. On a phone           | Held after the W51-7 tap-size fix.                                                                                                                     |
| 7. Everyone can use it  | Fixed the dialog semantics and icon names (W51-7).                                                                                                     |
| 8. What happens around  | Held: the event time shows in the department's timezone. Dates fixed (W51-1, W51-5). Publishing is audit-logged (`minutes_published`; read from code). |

## Completion gate

| Check                    | Result                                                                           |
| ------------------------ | -------------------------------------------------------------------------------- |
| npm run typecheck        | clean                                                                            |
| npm run lint             | clean (two warnings in this run's new test, fixed)                               |
| flake8 (changed files)   | clean                                                                            |
| black --check            | clean (isort clean too)                                                          |
| frontend tests (touched) | `src/modules/minutes` and `ActionItemsPage`: 39 passed                           |
| frontend tests (full)    | 708 files, 9002 tests passed                                                     |
| backend tests (touched)  | every test file mentioning minutes or meetings: 4083 passed, 20 skipped (Docker) |
