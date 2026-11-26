# Application Review — Meetings & Minutes (Tier B)

**Prefix:** `MM2` · **Iteration:** B6 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-06 (pass 2), 2026-08-09 (pass 3), 2026-08-09 (pass 4),
2026-10-13 (pass 5), 2026-11-26 (pass 6)

---

## Pass 6 (2026-11-26) — the lifecycle, the count and the screens: 17 fixed, 5 flagged

### Scope, stated plainly

Pass 5 read update payloads. This pass read the module for **business-logic
correctness**: the minutes lifecycle (draft → submitted → approved → reopened),
quorum, motions and roll calls, action items and their reminders, and meeting
approval. It also read the frontend that pass 5 left unopened:

- `MinutesPage`;
- the rendering half of `MinutesDetailPage`;
- `AttendanceDashboardPage`;
- `ActionItemsPage`;
- `MeetingAttendance`.

Six backend findings were reproduced by a probe against the real service
classes before any test was written. Every fix below has a test that failed on
the unfixed code.

**Not read:**

- Backend: most of `minutes_record_service` (attendance suggestions, election
  capture, attachments, closed sessions), `minutes_print_data`,
  `attendance_waiver_service`, and the meetings waiver and dashboard routes.
- Frontend: the signatures, revisions, outline-editor, agenda-editor,
  carry-forward, adopt and publishing-settings components, and the waiver
  queue pages.

### Frontend

**MM6-1 — MED — The meeting waivers list showed a user id and never the reason — ✅ FIXED**

- `MinutesPage` read `user_name` and `reason`. `GET /meetings/{id}/attendance-waivers` returns `member_name` and `waiver_reason`.
- So a clerk saw a raw id in place of the member's name, and the reason never appeared.
- The response was typed `Record<string, unknown>`, which is why this compiled. It now has a `MeetingAttendanceWaiver` type.

**MM6-2 — MED — Meeting controls were gated on the wrong permission — ✅ FIXED**

- These controls are `/meetings` endpoints gated on `meetings.manage`:
  - Record Minutes (create a meeting);
  - edit agenda;
  - delete meeting;
  - the waivers list;
  - the empty-state prompt.
- The page offered them on `minutes.manage`, so a custom position holding only one of the two was offered controls that 403, or denied ones it could use.
- Opening or creating a meeting's minutes stays on `minutes.manage`, as its endpoint is.

**MM6-3 — MED — Every change on the detail page unmounted it — ✅ FIXED**

- Recording a motion, changing an action item, applying a suggestion, deleting or publishing all reloaded through `fetchMinutes`. That swaps the whole page for "Loading minutes...".
- So every panel lost its own state: a motion half-typed in another section, decisions in the suggestions panel, the scroll position.
- They now reload in place (`reloadAfterChange`). A reload failing after a successful change is reported as that, not as the change failing.

**MM6-4 — LOW — The last record's state carried over when the id changed — ✅ FIXED**

- A load error was never cleared, so after one failed load the next record still read "Failed to load minutes".
- Importable ballots, an open editor and a pending reject reason carried over too.
- The page is now keyed by the minutes id.

**MM6-5 — LOW — An overdue item's status select read "Pending" — ✅ FIXED**

- Choosing Pending then fired no change. The select now shows Overdue while the item is overdue.

**MM6-6 — LOW — "Return for Changes" could be sent twice — ✅ FIXED**

- A double click sent two reject requests. It now goes through `useSubmitGuard`, like the other workflow actions.

**MM6-7 — MED — The meetings search refetched on every keystroke, and a late response could win — ✅ FIXED**

- Each letter fetched four endpoints. A slower response for an earlier prefix or filter could land last.
- The search now settles first (350 ms, as `ArchiveSearchResults` already did), and a response that is no longer the latest is dropped.

**MM6-8 — LOW — The attendance dashboard could show an earlier filter's figures — ✅ FIXED**

- This is the same race as MM6-7, with the same guard.

### Backend

**MM6-9 — MED — Three section rewrites did not move `edit_version` — ✅ FIXED**

- Agenda sync, applying an outline and applying a suggestion all rewrite `sections`.
- An editor holding the older version could still save, writing back the sections those changes had just replaced. That bypasses MM5-4's conflict guard.
- Each writer now bumps the version SQL-side.

**MM6-10 — MED — A "count" quorum truncated its threshold — ✅ FIXED**

- 2.5 members needed 2, and 0.5 needed nobody. It now rounds up and never falls below one, like the percentage rule.

**MM6-11 — MED — A motion's totals could contradict its roll call — ✅ FIXED**

- Totals sent without a roll call were written beside the old one: the roll read 2 yes, the totals 0 / 3.
- `_vote_record` says the two can never disagree.
- Totals sent on their own are a vote taken by count, which is what the page's count mode sends. So the roll call they replace is now cleared.

**MM6-12 — MED — Submit, recall, reject and a content save checked status without the row lock — ✅ FIXED**

- Two racing requests could each pass a status check the other was about to falsify:
  - a save landing in minutes already circulated to members;
  - a reject overwriting an approval and keeping its stamps.
- Each now locks the row before reading the status, as approve and reopen do (pitfall #27).
- Motion and action-item edits still check status before the lock. That is recorded as open below.

**MM6-13 — LOW — Re-approval emailed assignees about finished items — ✅ FIXED**

- Approving reopened minutes emailed every assignee about every item again, completed and cancelled ones included.
- It now emails only open items (pending, in progress, overdue).

**MM6-14 — MED-LOW — The action-item bell ignored the module's own rules — ✅ FIXED**

- Bells went out for items on draft and circulated minutes, which `/action-items` and the email reminders both leave out.
- Items marked overdue were skipped, although the email reminders count them as open.
- Bells now cover approved minutes only, and include overdue items.
- The bells have no re-run guard. That is flagged as MM6-22.

**MM6-15 — MED — A PATCH could un-approve a meeting, which reopened the delete guard — ✅ FIXED**

- MM-9 refused a PATCH _into_ approved. `PATCH {"status": "draft"}` on an approved meeting succeeded and kept the approval stamps.
- `delete_meeting` then deleted it, and the attendance (membership-tier credit) went with it.
- A PATCH now cannot move a meeting out of approved. No screen sends a meeting status, so this touches API callers only.
- Whether a meeting should be un-approvable at all is MM6-19.

**MM6-16 — LOW — The reopen endpoint logged the free-text reason — ✅ FIXED**

- The reason can name a member, and the audit event already records it. The log line now carries ids only (pitfall #33).

**MM6-17 — LOW — Reopening a meeting action item kept its completion time — ✅ FIXED**

- `completed_at` is now cleared when the item leaves completed, as the minutes action items already do.

### Flagged for the owner (in `docs/KNOWN_LIMITATIONS.md`)

- **MM6-18 (MED) — Action items can be added to approved minutes.**
  - `add_action_item` has no status guard, and the approved snapshot includes action items. So adding one makes the adopted version fail its own integrity check (`changed: action_items`).
  - A `KNOWN_LIMITATIONS` passage said the call was refused, and is corrected.
  - Decide: refuse it (a correction goes through reopen), or keep later items out of the snapshot.
- **MM6-19 (MED) — An approved meeting's attendance can still change.**
  - Attendees can be added or removed one at a time, while deleting the meeting is refused because its attendance is the settled record.
  - With MM6-15 there is also no way to un-approve a meeting.
  - Decide what correction path an approved meeting has.
- **MM6-20 (MED) — The stored quorum result is refreshed only on request.**
  - It is updated only by `GET /quorum`, and approval freezes whatever is there. The page's refresh after saving the roll is fire-and-forget.
  - `MinutesCreate`/`MinutesUpdate` accept `quorum_met`/`quorum_count` from the client.
  - For approved minutes, the quorum endpoint reports the stored result beside a live "required" (met with 6 of 10 required).
  - Decide whether approval recomputes it, and whether a manual override stays.
- **MM6-21 (LOW-MED) — Carrying an item forward hides it from its assignee for a month.**
  - The copy sits in draft minutes, which the member's list and reminders do not show. Meanwhile the manager's count includes it.
- **MM6-22 (LOW) — Reminder bells have no re-run guard.**
  - A manual run or a re-run duplicates every bell (pitfall #36).
  - Re-approval after a reopen re-sends the assignee email for items still open.
  - Both need a stamp column.

### Open, LOW (not flagged)

- Motion and action-item edits check the minutes' status before the row lock (MM6-12 covers status changes and content saves).
- `create_minutes`' inline motions skip the motion-result check and drop `section_key` and `acceptance`.
- `create_from_meeting` has no duplicate check, so a double click makes two sets of minutes.
- `update_action_item` with `assignee_id: null` leaves the old `assignee_name`.
- `suggested_status` under `majority_present` with no roll passes on any yes vote.
- `settle_roll_call` keys by name, so two members sharing a name collide.
- Changing a default outline's meeting type can leave two defaults.
- `create_from_event` records a "not going" RSVP as excused.
- `MeetingAttendance` re-derives its "% present", which can exceed 100% for a member made inactive since. It also carries an `exhaustive-deps` suppression.
- The detail page hides the assignee's status control, which the backend and `ActionItemsPage` allow.
- Waivers are cached per meeting for the life of the page.
- Meeting-item rows on `ActionItemsPage` link to `/minutes`, not to their meeting.
- The Open Action Items stat is not refreshed after `MyActionItemsPanel` completes an item.

### Mechanical checks

- **Route gating:** 49 routes.
  - `minutes.py` (32): 23 `minutes.manage`, 7 `minutes.view`, 1 minutes-or-meetings manage, and 1 sign-in only. That one is the assignee self-service action-item update (W52-7, by design).
  - `meetings.py` (17): 13 `meetings.manage` and 4 meetings-or-minutes view.
- **Status filters:** no `== UserStatus.ACTIVE` gates.
- **Search:** every `LIKE` passes `escape=`.

### Completion gate (pass 6)

| Check                                                    | Result                                                      |
| -------------------------------------------------------- | ----------------------------------------------------------- |
| meetings / minutes / quorum / action-item / agenda tests | ✅ **1,736 passed**, 1 skipped (optional `pywebpush`)       |
| new and extended tests                                   | ✅ 15 backend, 10 frontend; each seen to fail first         |
| `flake8` / `black` / `isort` (changed files)             | ✅ clean                                                    |
| mypy ratchet                                             | ✅ 0 errors, matching the baseline                          |
| marker routing                                           | ✅ the new DB test is collected only by the integration job |
| minutes frontend tests                                   | ✅ 539 passed (69 files)                                    |
| `npm run typecheck` / `npm run lint`                     | ✅ 0 errors / 0 warnings                                    |

Two existing reminder tests now create their minutes as approved. They built
draft minutes by default, which MM6-14 rightly stops reminding about.

---

## Pass 5 (2026-10-13) — the template update answered a cleared NOT NULL column with a 500 (1 fixed, 1 dead method removed, 1 flagged)

Lens for this pass: the update-payload discipline CLAUDE.md #1 spells out
(`exclude_unset`, `apply_updates`, an explicit `null` on a NOT NULL column) driven
through the **real handlers** rather than read off the service, plus the
`modules/minutes` frontend that no earlier pass had opened.

### MM5-1 — LOW/MED — `PUT /minutes-records/templates/{id}` returned a 500 for `{"name": null}` — ✅ FIXED

`TemplateUpdate` types every field `Optional`; four of the columns behind it are
NOT NULL (`name`, `meeting_type`, `is_default`, `sections`).
`TemplateService.update_template` applies updates through `apply_updates`, which
correctly refuses a cleared NOT NULL column by raising `ValueError`
(`Field 'name' cannot be cleared`) — but the handler
(`endpoints/minutes.py`, `update_template`) was the only update handler in the
file not wrapped in `handle_service_errors`, so the `ValueError` escaped as an
unhandled 500. The service comment above that call says it "raises a clean 400";
it did not reach the client as one.

**Reproduced before fixing:** a new test file drives the minutes router over HTTP
against the real schema and sends `null` for every NOT NULL field on all four
update endpoints (13 fields). On the unmodified handler 4 of 13 failed, all
template fields, each with the `ValueError` above; the other 9 (minutes, motions,
action items) already returned 400 through `handle_service_errors`. With the
wrapper added, all 17 tests pass.

The assertion is `status in (400, 422)`, not "any 4xx". My first draft of the test
used the wrong HTTP verb (these routes are `PUT`, not `PATCH`) and got a 405,
which a `400 <= status < 500` check would have counted as a pass — a test that
could not tell a refused null from a wrong URL. Tightening it is what made the
mistake visible.

The nullable half is paired with the NOT NULL half (`location`, `moved_by`,
`assignee_name`, `description` on a template still clear), so a guard that
rejected every null would fail this file too.

### MM5-2 — INFO — `TemplateService.get_default_for_type` had no caller — ✅ REMOVED

An AST scan of the four B6 services (every `def` against every `Attribute` /
`Name` / string reference under `app/` and `scripts/`, not a text grep — a
comment or docstring mention does not count as a use) found exactly one method
with no production reference. Only its own two unit tests called it. Removed with
those tests. Nothing in the docs, wiki or frontend named it.

### MM5-3 — INFO — a schema comment still described the `setattr` loop that was gone — ✅ FIXED

`schemas/meetings.py` justified its enum validators by saying the meeting update
paths "apply these via a blind `setattr`". They have gone through `apply_updates`
since MM-9; the validators are still needed (`apply_updates` checks nullability,
not enum membership) but for a different reason, which the comment now states.

### MM5-4 — MED — section edits send the whole array, so two editors silently overwrite each other — ✅ RESOLVED (2026-10-31)

`modules/minutes/pages/MinutesDetailPage.tsx` saves, reorders, adds and deletes a
section by PUTting the **entire** `sections` list built from the page's local copy
(`handleSaveSection`, `handleReorderSection`, `handleAddSection`,
`handleDeleteSection`), and `MinuteService.update_minutes` replaces the stored
list wholesale ("Full sections replacement" in `MinutesUpdate`). There was no
version, ETag or per-section endpoint, so if two secretaries had the same draft
open, the second save wrote back the first one's stale copy of every section the
second did not touch, and the first person's text was gone with a success toast.

**Owner decision: refuse with a conflict, not a per-section endpoint.**
`meeting_minutes.edit_version` (migration `e15d635bbb98`) is bumped by every
content save; the page sends the version it loaded as `expected_version`, and
`PUT /minutes-records/{id}` refuses with 409 (via a `.with_for_update()` locking
read, so two racing saves cannot both pass) when it is stale. The editor keeps
whatever was typed and shows a **Reload** banner; a save naming no version stays
unconditional. See `docs/KNOWN_LIMITATIONS.md`'s MM5-4 entry and
`docs/security-review/MM-24-meetings-minutes.md`'s Pass 12 section.

### Verified good ✅ (this pass)

- **Meetings update path.** `PATCH /meetings/{id}` and `PATCH /meetings/action-items/{id}`
  dump with `exclude_unset=True`, so an explicit null reaches `apply_updates`. The
  three `exclude_none` calls in `endpoints/meetings.py` are on create (`create_meeting`,
  `create_action_item`) only, where dropping a blank is correct. A cleared NOT NULL
  column comes back as a 400 through `safe_error_detail`, and
  `test_meetings_service.py` already asserts it at the service level.
- **Quorum endpoints** (`GET /{id}/quorum`, `PATCH /{id}/quorum-config`) — the routes
  added since pass 2 — are `minutes.manage` only, and managers already see
  executive-session minutes, so they open no read path the list/detail restriction
  closes. `GET /quorum` is named like a write but only calls `calculate_quorum` and
  returns a dict; nothing is persisted.
- **Frontend update payloads.** Every `updateMinutes` / `updateActionItem` call
  sends a discrete partial (`sections`, `event_id`, `status`); unlinking an event
  sends an explicit `event_id: null`, which `update_minutes` clears. There is no
  free-text edit form here that could omit a cleared field. `modules/minutes`
  builds its axios instance through the shared `createApiClient` (auth + CSRF
  inherited). No `window.confirm` / `alert` / `prompt`.
- **Assignee self-service (W52-7)** is reachable: `ActionItemsPage` calls the same
  endpoint for a non-manager, which is why `MinutesDetailPage` gating its status
  select on `canManage` is correct rather than a gap.
- **Docs.** `MEETING_MINUTES_MODULE.md`'s route table matches the router (verified
  against the 27 route decorators in `endpoints/minutes.py`); no doc or wiki page names
  the removed method.

### Not read (scope, stated plainly)

The minutes frontend is 3,166 lines; this pass read `services/api.ts` and the
section, publish, action-item and event-link handlers of `MinutesDetailPage.tsx`
(the update paths), not its rendering, and did not open `MinutesPage.tsx` (865),
`AttendanceDashboardPage.tsx` (244), the store, or
`components/MeetingAttendance.tsx`. Backend business logic
(`minute_service` approval/reopen/publish, `meetings_service` attendance windows)
was covered by earlier passes and was only re-read where it touches update
semantics.

### Completion gate (pass 5)

| Check                                                                                       | Result                                                                                                                           |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/`                                                                        | ✅ no output (0 violations)                                                                                                      |
| `black --check app/ tests/`                                                                 | ✅ 1672 files unchanged                                                                                                          |
| `isort --check-only` (changed files)                                                        | ✅ clean                                                                                                                         |
| `npm run typecheck`                                                                         | ✅ exit 0 (no frontend file changed this pass, so `eslint` was not re-run)                                                       |
| new test file, mutation-checked                                                             | ✅ 17 pass with the fix; **4 fail with the handler change stashed** (all template fields), 13 pass                               |
| marker routing                                                                              | ✅ `-m "not integration and not slow and not docker" --collect-only` selects 0 of 17 — the file runs only in the integration job |
| backend tests (minutes, meetings, templates, quorum, org-scoping, CSV/LIKE/capacity sweeps) | ✅ **1607 passed, 1 skipped** (optional `pywebpush` dependency)                                                                  |

---

## Pass 4 (2026-08-09) — MM2-3 resolved: the two genuinely-unsafe `status` fields fixed; the rest confirmed false positives

Pass 3 flagged `status`/`priority` free-str fields for "per-field verification
before a fix, not a blanket sweep." Pass 4 did that verification across **both**
action-item code paths (the module has two distinct ones) and split the flag into
a real fix and a set of confirmed false positives.

**The module has two separate meeting/minutes stacks**, and the pass-3 note
partially conflated them:

- `app.schemas.minute` → `MinuteService` → the `minute.py` models (`Motion`,
  `ActionItem`). Here `priority` maps to a strict `ActionItemPriority` **ENUM**
  (not the Integer column pass 3 cited — that Integer is on the _other_ model),
  and `status` maps to `MotionStatus` / `MinutesActionItemStatus`.
- `app.schemas.meetings` → `MeetingsService` → the `meeting.py` models
  (`Meeting`, `MeetingActionItem`). Here `priority` **is** the bounded Integer
  (`Field(ge=0, le=2)` — already validated), and `status` maps to `MeetingStatus`
  / `ActionItemStatus`.

**Verified safe (false positives — no change):** every `minute.py`-path field
(`Motion.status` on create/update, `ActionItem.priority`/`status` on
create/update, and the inline motions/action-items in `create_minutes`) is
coerced through the **enum constructor** in the service (`MotionStatus(data.status)`,
`ActionItemPriority(data.priority)`, …). A bad value raises `ValueError` _in
Python_ before the bind, and every one of those endpoints runs inside
`handle_service_errors`, which turns `ValueError` into a clean **400** — never a
500, never a silent `''`. This is the documented "coercion path raising caught
ValueError" false-positive category. `MeetingsService`'s `priority` is a
Pydantic-validated `int` (0–2). None of these needs a validator.

### MM2-3 — LOW/MED — Two `MeetingsService` `status` fields reach the ENUM via a blind `setattr` — ✅ FIXED

**What:** `MeetingUpdate.status` and `ActionItemUpdate.status` (both in
`app.schemas.meetings`) were free `str`, and `MeetingsService.update_meeting` /
`update_action_item` apply the update dict with a **blind `setattr(obj, key,
value)`** — no enum-constructor coercion, unlike the `MinuteService` twins. So a
value outside the enum reaches MySQL. Both service methods wrap the write in
`try/except Exception → return (None, str(e))` (so the endpoint 400s rather than
500s), but that leaves two real problems: under **non-strict** MySQL the bad value
is silently stored as `''`, and even under strict mode the client gets a raw
(sanitized) DB-error string instead of a clear validation message.

**Fix:** added `@field_validator("status")` to both schemas (and factored the
existing `_validate_meeting_type` into a shared `_validate_enum` helper), deriving
the allowed set from `MeetingStatus` / `ActionItemStatus`, lowercase-normalizing,
and rejecting unknown → **422** with the allowed-values list. Response schemas are
untouched (built from the ORM enum). Valid callers and the existing tests are
unaffected. **10 tests added** (`test_meetings_status_validation.py`): every valid
status accepted, case-normalized, unknown rejected, `None` passes through on a
partial update, and `priority` stays a bounded int.

### Flagged / future (unchanged)

- The maintenance-scheduling / executive-session business-logic depth read
  (beyond tenant isolation and the latent-500 lens) remains the next increment as
  its own focused iteration.

**Completion gate (pass 4):** `flake8` 0 · `black --check` clean · `tsc --noEmit`
n/a (no frontend change) · `test_meetings_status_validation.py` **10 passed** +
`test_meetings_meeting_type_validation.py` **10 passed** (all DB-free).

---

## Pass 3 (2026-08-09) — latent-500 on `meeting_type` fixed; status/priority flagged

Re-verified the landed fixes hold (MM-4 `assert_in_org` at 5+4 sites; MM2-1's
`publish_minutes` executive guard at `document_service.py:130`; MM-3-frontend on
`minutes.manage`). The B1 latent-500 lens then surfaced a genuine recurrence.

### MM2-2 — LOW/MED — `meeting_type` accepted any string → 500 at the ENUM column — ✅ FIXED

**What:** `meeting_type` was typed as a free `str` on six request schemas
(`MeetingCreate`/`MeetingUpdate`; `MinutesCreate`/`MinutesUpdate`;
`TemplateCreate`/`TemplateUpdate`) but maps to a **strict MySQL ENUM**. SQLAlchemy's
Enum defaults to `validate_strings=False` (verified: the bind processor passes
`'bogus_type'` straight through), and `create_minutes` inserts the value raw
(`MeetingMinutes(**minutes_dict)`), so a value outside the enum reaches MySQL and
**500s** (or stores `''` under non-strict mode) on the create/update paths. The B1
class, recurring.

**The subtlety that made this worth doing carefully:** `meeting_type` maps to **two
different enums** — `MeetingType` (`business/special/committee/board/other`) for
meetings, and `MinutesMeetingType`
(`…/trustee/executive/annual/other`) for minutes and templates. Validating a minutes
type against the meeting set would have **rejected `executive`** — the very value the
executive-session read restriction (MM2-1/MM-3) keys on. Each validator derives its
allowed set directly from the correct model enum, and a test asserts `executive`,
`annual`, and `trustee` stay valid for minutes while a Meeting rejects them.

**Fix:** a per-file `_validate_*_meeting_type` helper + `@field_validator` on each of
the six **request** classes (lowercase-normalize, then reject unknown → 422). The
validators live only on the request classes, so the response schemas (built from the
ORM enum via `from_attributes`) are untouched. Also corrected a stale `MinutesBase`
docstring that listed only 5 of the 8 minutes types. **11 tests added**
(`test_meetings_meeting_type_validation.py`); the 150 existing meeting/minute tests
still pass.

### MM2-3 — LOW — `status`/`priority` free-str fields on other schemas — 🚩 FLAGGED

The same lens flagged `status` (on `MeetingUpdate`, `MotionCreate`/`Update`,
`ActionItemUpdate`) and `priority` (on `ActionItemCreate`/`Update`) as free-str, but
these need per-field verification before a fix, not a blanket sweep: **`priority`
maps to an `Integer` column** on `MeetingActionItem` (the name-based lens
over-matched — a str→int concern, not str→ENUM), and several `status` fields are
server-set on create (`create_minutes` hardcodes `DRAFT`). Flagged for a focused
follow-up that confirms each field's actual target column and write path rather than
guessing a validator onto an integer or a server-controlled field.

**Completion gate (pass 3):** `flake8` 0 · `black --check` clean · `tsc --noEmit` 0
(no frontend change) · eslint unaffected · new validation tests **11 passed** +
existing meeting/minute tests **150 passed** (all DB-free).

---

## Pass 2 (2026-08-06)

Re-verified pass 1 (MM-4 FK validation, MM-3-frontend permission, DASH-1
consistency — intact). Then chased the module's distinctive risk — the
**executive-session read restriction** — across _every_ path that reads minutes,
not just the four the restriction already covers. DASH-1 fixed one cross-module
leak of executive content; this pass found another, in a different module.

### MM2-1 — MED — Executive minutes leak to the broad documents audience via publish — ✅ FIXED

**The restriction, and where it holds:** executive-session minutes are visible
only to `minutes.manage` holders. `MinuteService.get_minutes` / `list_minutes` /
`search` / `get_stats` all apply `status == APPROVED AND meeting_type != EXECUTIVE`
for a non-manager (a plain viewer gets a 404, so the existence is hidden), and A7's
DASH-1 extended the same gate to the dashboard action-item feed. The content this
protects is, by the module's own rationale, discipline/termination/legal matters.

**The leak:** `POST /minutes/{id}/publish` (`minutes.manage`) calls
`DocumentService.publish_minutes`, which rendered the **full minutes body** into a
`Document` in the "meeting-minutes" system folder — checking `status == APPROVED`
but **not** `meeting_type`. Executive minutes can be approved, so an approved
executive session could be published. Every documents read path
(`GET /documents/{id}`, `list_documents`, download, summary) gates on
**`documents.view`** — a far broader audience than `minutes.manage` — so the
published copy exposed the executive-session body to members who get a 404 on the
minutes endpoints themselves. The system even tagged the document `executive`
while doing it. This is the DASH-1 shape (cross-module read bypassing the minutes
restriction), via publish → documents instead of the dashboard.

**Why FIXED, not flagged:** it enforces an **already-decided** access-control
policy at a path that silently violated it — the same disposition A7 chose for
DASH-1 (fix the leak, don't re-litigate the policy). `publish_minutes` now refuses
executive-session minutes with `ValueError → 400` (the endpoint's
`handle_service_errors` maps it). No data changes; the approved-status check still
runs first. 3 tests added (`TestPublishMinutesExecutiveGuard`): executive rejected
(as `.value` and as the enum), and the approved-gate-precedes-executive ordering.

**Escape hatch recorded (future dev):** if an org deliberately wants to share an
executive session with a _restricted_ audience, that needs a real build (a
restricted document folder, or a `minutes.view_executive` tier — the same tier
MM-3's deferred half wants), not a one-click publish to `documents.view`. Noted in
`KNOWN_LIMITATIONS.md`.

### Not a leak — the reports count (verified)

`reports_service._generate_department_overview` counts open minutes action items
(`open_from_minutes`) across a join to `MeetingMinutes` with no executive filter —
but it returns only a **count**, never content, at `reports.view`. A total that
includes executive items is arguably correct for an overview and discloses
nothing, so it is left as-is (contrast the dashboard, which exposed each item's
description/assignee and so needed the DASH-1 filter). `quorum_service` reads
minutes by id for quorum math only (no content projection).

---

## Pass 1 (2026-08-06)

**Prefix:** `MM2` · **Iteration:** B6 · **Reviewed:** 2026-08-06

**Backend:** `endpoints/meetings.py` (17), `endpoints/minutes.py` (25),
`services/meetings_service.py`, `services/minute_service.py`
**Frontend:** `modules/minutes`
**Prior audit:** `docs/module-audit/meetings-minutes.md` — MM-1/MM-2/MM-3 fixed;
MM-4 (XC-1) and an MM-3 frontend-inconsistency note left open.

---

## Scope

Tier B: worked the two open items. This module connects directly to the earlier
**DASH-1** fix (the dashboard's minutes-visibility gate), so consistency between
the two was a specific check.

## Findings

### MM-4 — LOW — Create/update paths store client FKs unvalidated (XC-1) — ✅ FIXED (all sites)

Closed the whole enumerated cluster with the shared `assert_in_org`:

- `minute_service.create_minutes` — `event_id` (Event) + each inline action
  item's `assignee_id` (User).
- `minute_service.update_minutes` — `event_id` on re-point.
- `minute_service.add_action_item` — `assignee_id`.
- `meetings_service.create_meeting` — the bulk path spread attendee/action-item
  dicts unvalidated (the dedicated `add_attendee` endpoint already validated);
  now each attendee `user_id` and action-item `assigned_to` is checked.
- `meetings_service.create_action_item` — `assigned_to`.

**Impact (verified):** mis-attribution, not disclosure — I checked whether a
foreign `event_id` reads back and it does **not**: `get_minutes` eager-loads
`template` (the MM-1 vector) but **not** `event`, and the response schema exposes
only `event_id`, never event details. So this is the same low-severity dangling-FK
class, closed for consistency and defense-in-depth.

**A latent bug found while wiring the error path:** the `create_minutes`
**endpoint had no `ValueError` handling at all** — so the existing MM-1
`ValueError("Invalid template")` guard was **already** surfacing as a 500, not
the intended 400, and my new MM-4 validations would have done the same. Fixed by
wrapping the call in the module's `handle_service_errors` context manager (which
maps `ValueError → 400`), matching every sibling write endpoint. So this
iteration also quietly corrected MM-1's error contract.

### MM-3-frontend — MEDIUM — `canManage` checked the wrong permission — ✅ FIXED

The MM-3 write-up flagged it and I confirmed it live: `MinutesPage.tsx` and
`MinutesDetailPage.tsx` computed `canManage = checkPermission('meetings.manage')`,
but the backend gates **all 19 minutes write endpoints and the MM-3 restricted
reads on `minutes.manage`**. The mismatch cut both ways:

- A holder of `minutes.manage` **without** `meetings.manage` — the role actually
  empowered to manage minutes — saw **no** management UI at all.
- A holder of `meetings.manage` **without** `minutes.manage` saw edit/approve
  buttons that then **403'd** on click.

**Fix:** both pages now `checkPermission('minutes.manage')`, matching the API,
with a comment explaining the meetings-vs-minutes distinction. This is strictly
corrective — a `meetings.manage`-only user was already being 403'd by the
backend, so no working capability is removed; the UI now tells the truth.

Raised to MEDIUM from the prior note's aside because it silently denied the
correct role its function.

## Verified good ✅ (re-confirmed)

- **DASH-1 consistency:** the dashboard's `minutes_visibility_filter` (added in
  A7) keys on `minutes.manage` and mirrors `MinuteService.get_minutes`'s
  `restricted` branch — the same permission this frontend fix now aligns to.
  The three surfaces (minutes module reads, dashboard action-item feed, minutes
  UI gating) are now consistent on `minutes.manage`.
- MM-1 (template leak), MM-2 (LIKE escaping — `meetings_service.get_meetings`
  confirmed still has `escape="\\"`), MM-3 (restricted reads) all remain fixed.
- XC-3 clean (the prior audit's finding that the ELEC-2 admin-write flaw does not
  recur here) — re-confirmed: every by-id write routes through an org-scoped
  fetch.

## Duplication

The `assert_in_org` calls now appear across five methods in two services — that
is the intended consolidation (one shared helper), not duplication.

## Dead code

None; no TODO/FIXME. The prior audit's cosmetic notes (docstrings titled
"Meeting Minutes …" on the meetings files; the `Meeting.motions` Text vs
`MeetingMinutes.motions` relationship name-collision) remain harmless and are
left as-is.

## Documentation

`docs/module-audit/meetings-minutes.md`: MM-4 now resolved; the MM-3 frontend
inconsistency (previously an aside) is resolved as MM-3-frontend.

## Future development

1. **`minutes.view_executive` tier** (MM-3's deferred half) — still open: if
   board members need executive-session minutes without full `minutes.manage`,
   that needs a new permission (seed + roles + frontend). A deliberate product
   decision, unchanged.
2. **No service test for the new FK guards** — they rest on `test_org_scoping.py`;
   the 132 mock-based minute/meeting tests pass with the added queries.

## Completion gate

| Check                | Result                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `tsc --noEmit`       | ✅ 0 errors                                                                                                                           |
| `flake8 app/ tests/` | ✅ 0 violations                                                                                                                       |
| `black --check`      | ✅ 503 files unchanged                                                                                                                |
| `eslint`             | ✅ clean                                                                                                                              |
| backend tests        | ✅ **2517 passed, 0 failed**; 132 minute/meeting tests pass with the new validation. 648 errors, all `db_session` fixture (no MySQL). |

</content>
