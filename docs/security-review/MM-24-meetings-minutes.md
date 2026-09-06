# Security Review — Meetings & Minutes

**Prefix:** `MM` · **Iteration:** 24 · **Reviewed:** 2026-08-26 (pass 1), 2026-08-31 (pass 2), 2026-09-06 (pass 3) · **PR:** #1906 (pass 1), [#2079](https://github.com/thegspiro/the-logbook/pull/2079) (pass 2), pass 3 PR TBD

## Pass 1 (2026-08-26)

**Backend:** `app/api/v1/endpoints/meetings.py` (493 L, 17 endpoints),
`app/api/v1/endpoints/minutes.py` (1,037 L, 25 endpoints),
`app/services/meetings_service.py` (608 L), `app/services/minute_service.py`
(921 L), `app/services/quorum_service.py` (139 L, pulled in — directly
reachable from `minutes.py`'s `/quorum` and `/quorum-config` routes and
central to whether a recorded vote is even valid).
**Frontend:** not reviewed this pass — backend only, per rotation scope.
**Migrations:** none — every fix this iteration is service/endpoint-layer
only, no schema change.

---

## Scope

No prior module-audit or app-review pass exists for this feature — the
first review of meetings/minutes. Read in full via four parallel background
agents (one per file, plus schema files each agent needed for context) —
3,059 lines across the two endpoint files and two services, large enough to
warrant the fan-out this rotation uses for first-pass, no-prior-coverage
features. `quorum_service.py` was not part of the original fan-out (it
belongs to neither endpoint file by name) but was read directly afterward
once three of the four review agents independently flagged it as
vote-legitimacy-critical and directly reachable from this feature's own
routes — a genuine gap in the original scope split, closed before writing
this doc.

## Verified good ✅

- **Auth coverage is complete.** All 17 `meetings.py` routes and all 25
  `minutes.py` routes carry a `require_permission(...)` dependency; none
  fall back to bare `get_current_user` with no check. Permission strings
  are sensible for the action performed throughout (view-only permissions
  never gate a mutation).
- **`grant_attendance_waiver`/`list_attendance_waivers`** (`meetings.py`)
  are a clean example of Pitfall #14b+#14c done right: both re-fetch their
  target (`Meeting`, then the waiver's target `User`) filtered by
  `organization_id` before trusting a path-supplied id, and the grant path
  audit-logs the waiver.
- **Every by-id service method in both services filters `organization_id`**
  on every read/update/delete, or resolves through an already org-scoped
  parent (`get_meeting_by_id`/`get_minutes` first, then the child row) —
  confirmed method-by-method across both files, not sampled.
- **XC-1 create-path validation was already solid before this pass**:
  `create_meeting` (attendees, action items), `create_action_item`,
  `create_minutes` (`event_id`, per-item `assignee_id`, `template_id`),
  `add_action_item`, and `update_minutes`'s re-pointed `event_id` all
  already called `assert_in_org` before persisting a client-supplied FK —
  the gaps this pass found were specifically on the _update_ paths that
  didn't mirror their sibling create path (see MM-1 below).
- **LIKE search safety (Pitfall #25)**: `get_meetings`, `list_minutes`, and
  `search_minutes` all build their patterns through `like_pattern()` with
  `escape=LIKE_ESCAPE_CHAR` — no hand-rolled wildcard escaping anywhere in
  either service.
- **JSON-column mutation (Pitfall #12)**: not applicable to
  `meetings_service.py` (no JSON columns on `Meeting`/`MeetingAttendee`/
  `MeetingActionItem`). `minute_service.py`'s JSON columns (`attendees`,
  `sections`, `header_config`, `footer_config`) are always rebuilt wholesale
  from a fresh `model_dump()` and reassigned outright — never a
  shallow-copy-then-mutate-nested-key pattern.
- **Finalization guard is correct**: `update_minutes`, `delete_minutes`,
  `add_motion`, `update_motion`, `delete_motion`, `delete_action_item` all
  reject the operation once a minutes record is `APPROVED` (draft/rejected
  only). `update_action_item`'s narrower approved-minutes allowance
  (`status`/`completion_notes` only) is explicit, documented, and reads as
  a deliberate design choice for post-approval task tracking, not an
  oversight.
- **No CSV/spreadsheet export exists in either file** — Pitfall #15 not
  applicable.
- **`create_from_meeting`'s `Meeting` fetch is org-filtered** before its
  fields are copied into the new minutes record — the one cross-reference
  the `minutes.py` review agent flagged as needing confirmation from the
  service side.

## Findings

### MM-1 — MED — `update_action_item` (both services) persisted a reassigned owner with no in-org check — ✅ FIXED

**What:** `meetings_service.update_action_item` and
`minute_service.update_action_item` both let a client set `assigned_to` /
`assignee_id` to any UUID on an existing item with no validation, while
their sibling _create_ paths (`create_action_item`, `add_action_item`) both
already call `assert_in_org` before persisting the same field. An
unvalidated FK persists a dangling/mis-attributed reference (Pitfall
#14c) — a reassignment to a foreign org's user id is stored, not currently
readable back cross-tenant (neither model eager-loads an `assignee`
relationship), but a real inconsistency against the codebase's own
convention and this file's own sibling method.
**Where:** `app/services/meetings_service.py` (`update_action_item`),
`app/services/minute_service.py` (`update_action_item`).
**Fix:** both now call `assert_in_org(..., allow_none=True, label="assignee")`
when `assigned_to`/`assignee_id` is present in the update payload, mirroring
their own create-path check exactly.

### MM-2 — MED — five update methods across both services used blind `setattr` loops instead of `apply_updates` — ✅ FIXED

**What:** `meetings_service.update_meeting`, `meetings_service.update_action_item`,
`minute_service.update_minutes`, `minute_service.update_motion`, and
`minute_service.update_action_item` all applied their update payload with a
hand-rolled `for key, value in data.items(): setattr(obj, key, value)` loop.
Concretely: `meetings.py`'s two update endpoints additionally called
`.model_dump(exclude_none=True)` rather than `exclude_unset=True`, which
made explicit field-clearing structurally impossible (a `null` was stripped
before reaching the service at all, indistinguishable from "field not
touched" — `location`, `agenda`, `notes`, `called_by` on a meeting could
never be cleared once set). `minute_service.py`'s three used
`exclude_unset=True` already, so an explicit null against a NOT NULL
column (`title`/`meeting_type`/`meeting_date` on minutes, `motion_text` on
a motion, `description` on an action item) reached `commit()` and raised an
unhandled `IntegrityError`.
**Where:** `app/services/meetings_service.py`, `app/services/minute_service.py`,
plus the two `meetings.py` endpoints that called `exclude_none`.
**Fix:** all five methods now route through `apply_updates`; the two
`meetings.py` endpoints switched to `exclude_unset=True` so an explicit null
reaches the service as "clear this field" rather than being silently
stripped.

### MM-3 — MED — `create_from_event` had a TOCTOU race on event uniqueness — ✅ FIXED

**What:** two coordinators bridging the same calendar event into a meeting
at nearly the same instant could each read "no meeting exists for this
event yet" before either committed, and both insert one — the same
read-then-write shape Pitfall #27 covers, applied to a uniqueness check
rather than a capacity check. `Meeting.event_id` has no unique DB
constraint, so nothing else would have caught it.
**Where:** `app/services/meetings_service.py`, `create_from_event`.
**Fix:** the `Event` fetch is now a locking read (`.with_for_update()`),
serializing concurrent bridge attempts for the same event so the second
call's existence check sees the first's committed `Meeting` row. **Revised
after Codex review** — see below; the `Meeting` existence check is now
also a locking read, not just the `Event` fetch.

### MM-4 — MED — quorum recalculation had the same read-then-write race, on the quorum status itself — ✅ FIXED

**What:** `QuorumService.calculate_quorum` reads `MeetingMinutes.attendees`
(a JSON column) from a plain SELECT, computes `quorum_met`/`quorum_count`
in Python, then writes those two fields back onto the same row. Two
check-ins triggering a recalculation for the same meeting at nearly the
same instant could each read the attendee list before the other's own
check-in commit landed, and whichever write lands last overwrites the
other's — a transient undercount of who was actually present.
Self-healing on the next check-in, and `quorum_met` is informational only
today (nothing programmatically blocks a vote on it), which is why this is
MED rather than HIGH — but it is exactly this rotation's Pitfall #27 shape
on a field whose entire purpose is recording whether a vote was legitimate.
**Where:** `app/services/quorum_service.py`, `calculate_quorum`.
**Fix:** the `MeetingMinutes` fetch is now a locking read
(`.with_for_update()`) — since the read and the write in this method target
the same row, locking that one fetch both serializes concurrent
recalculations and guarantees each sees the latest committed attendee list.

### MM-5 — MED — no separation of duties on the minutes approval step — ✅ FIXED

**What:** `submit_for_approval` and `approve_minutes` both gate on the
identical `minutes.manage` permission, with nothing preventing the same
person from submitting minutes and then immediately approving their own
submission — self-certifying what the codebase elsewhere treats as a
governance/legal record (see the `restricted` draft/executive-session
visibility logic throughout `minute_service.py`). This is the same gap
`app/services/separation_of_duties.py` was built to close, and already
closed the same way for finance requests (FIN-4), skills tests (CS-8), and
admin hours (AH-4) — the module's own docstring states "a fifth path has an
obvious thing to call."
**Where:** `app/services/minute_service.py`, `approve_minutes`.
**Fix:** `approve_minutes` now calls the shared
`assert_different_person(approved_by, minutes.submitted_by, action="approve",
record="meeting minutes")` before transitioning status — matching the exact
pattern already adopted three times elsewhere in this codebase, not a novel
design decision. `reject_minutes` was deliberately left unguarded: rejecting
your own submission back to yourself isn't the self-dealing risk approval
is (a gatekeeper saying no to their own work is not a control gap).

### MM-6 — LOW — motion and action-item CRUD, and the quorum-config override, had no audit trail — ✅ FIXED

**What:** every other mutating `minutes.py` endpoint (create/update/delete
minutes, submit/approve/reject, publish, template CRUD) calls
`log_audit_event`; the six motion/action-item CRUD endpoints and the
quorum-config override endpoint did not. Most notably, `update_motion` lets
anyone holding `minutes.manage` change a recorded `votes_for`/
`votes_against`/`votes_abstain` tally and `status` (passed/failed/tabled/
withdrawn) with no trace of the prior value, who changed it, or when.
**Where:** `app/api/v1/endpoints/minutes.py` — `add_motion`, `update_motion`,
`delete_motion`, `add_action_item`, `update_action_item`,
`delete_action_item`, `set_meeting_quorum_config`.
**Fix:** all seven now call `log_audit_event`, matching the file's own
established pattern (`event_category="meetings"`, `info` for
create/update, `warning` for delete). `update_motion`/`update_action_item`
log the set of changed field names; `set_meeting_quorum_config` logs both
the old and new quorum type/threshold for a real before/after trace.

### MM-7 — LOW — `GET /action-items/open`'s `assigned_to` query param crashed on a malformed UUID — ✅ FIXED

**What:** `assigned_to: str | None = None` was parsed manually via
`UUID(assigned_to) if assigned_to else None`, with no `try/except` — a
malformed value raised an unhandled `ValueError`, an unhandled 500 instead
of a clean 422.
**Where:** `app/api/v1/endpoints/meetings.py`, `get_open_action_items`.
**Fix:** typed the parameter `assigned_to: UUID | None = None` directly, so
FastAPI/Pydantic reject a malformed value with a clean 422 before the
handler body runs — the same pattern already used for every other UUID path
parameter in this file.

## Revised after Codex review

Codex reviewed PR #1906 and surfaced two real findings on this pass's own
fixes, both mechanical, both fixed in a follow-up commit:

- **P1 — lock-completeness gap in the MM-3 fix.** The original fix locked
  only the `Event` fetch, reasoning that since it would be the
  transaction's first query, the plain `Meeting` existence-check SELECT
  that follows would establish its own accurate REPEATABLE READ snapshot
  at that point. Codex correctly identified this as unsafe in production:
  an authenticated request has typically already run other queries on the
  same DB session before `create_from_event` is ever called (e.g.
  `get_current_user` resolving the caller), which can establish the
  snapshot first — so the "event fetch is first" assumption doesn't hold
  in general, and the existence check could still miss a concurrently
  committed row. Fixed by making the `Meeting` existence check a
  `.with_for_update()` locking read as well, matching every other Pitfall
  #27 fix in this codebase: lock the parent/uniqueness row **and**
  separately make the check itself a locking read, never rely on query
  ordering. `TestCreateFromEventLocking` now asserts `FOR UPDATE` on both
  captured queries, not just the first.
- **P2 — audit-log inaccuracy in the MM-6 fix.** `update_action_item`'s new
  `action_item_updated` audit event logged `changed_fields` from the raw
  client payload, but `minute_service.update_action_item` silently
  restricts the applied fields to `{status, completion_notes}` when the
  parent minutes are `APPROVED` — so a client sending `description` on
  approved minutes would have it no-opped by the service while the audit
  log still claimed it changed. Fixed by having the service set a
  non-mapped `item.applied_fields` attribute (the post-filter field set,
  same convention as `MeetingsService.attach_creator_names`) and having the
  endpoint log that instead of re-deriving from the raw payload.

Both fixes verified via the same completion gate below (lint clean, full
suite green) before being pushed and the review threads resolved.

## Confirmed still open — nothing needing a product decision

Everything this pass surfaced had a mechanical fix available and was
applied. No item is left flagged.

## Schema & migration notes

None — every fix is service/endpoint-layer only.

## Guard tests added

- `tests/test_meetings_service.py`:
  - `TestUpdateMeeting` (new) — nullability guard (`title`) and a
    nullable-field-clears test (`notes`).
  - `TestUpdateActionItem` — added a reassignment-to-foreign-user rejection
    test and a `description` nullability guard.
  - `TestCreateFromEventLocking` (new) — asserts both the `Event` fetch and
    the `Meeting` existence check render `FOR UPDATE`.
- `tests/test_minute_service.py`:
  - `TestUpdateMinutes` — added a `title` nullability guard.
  - `TestUpdateMotion` — added a `motion_text` nullability guard.
  - `TestUpdateActionItem` — added a reassignment-to-foreign-assignee
    rejection test and a `description` nullability guard.
  - `TestApproveMinutes` — added `test_self_approval_is_rejected` and
    `test_a_different_approver_succeeds`.
- `tests/test_quorum_service.py`:
  - `TestQuorumRecalcLocking` (new) — asserts the `MeetingMinutes` fetch in
    `calculate_quorum` renders `FOR UPDATE`.

## Completion gate

| Check                                                 | Result                               |
| ----------------------------------------------------- | ------------------------------------ |
| `flake8` (changed files)                              | clean                                |
| `black --check` (changed files)                       | clean                                |
| `isort --check-only` (changed files)                  | clean                                |
| `python3 scripts/validate_migrations.py --strict`     | PASSED (no migrations)               |
| backend tests, scope (`meeting or minutes or quorum`) | 203 passed, 1 skipped (pre-existing) |
| backend tests, full suite                             | 8910 passed, 22 skipped              |

---

## Pass 2 (2026-08-31)

**Backend:** `app/api/v1/endpoints/meetings.py` (17 routes),
`app/api/v1/endpoints/minutes.py` (25 routes), `app/services/meetings_service.py`,
`app/services/minute_service.py`, `app/services/quorum_service.py`,
`app/models/meeting.py`, `app/models/minute.py`, `app/schemas/meetings.py`,
`app/schemas/minute.py`.
**Frontend:** established for the first time this pass (pass 1 was backend-only)
— `frontend/src/modules/minutes/` (services, store, pages, types — 3,166 L
across 8 files, 2 of them existing tests) plus `frontend/src/services/meetingsServices.ts`
(the `Meeting`/`meetings.py` client, not module-scoped) and the 6-line
`frontend/src/pages/MinutesPage.tsx` re-export wrapper.
**Migrations:** none touched this pass.

### Scope since pass 1's merge (PR #1906)

All five backend files pass 1 named came back byte-identical except for one
line: `quorum_service.py` gained `.execution_options(populate_existing=True)`
on the `calculate_quorum` locking read, landed by the **elections** module's
own ELEC-06 pass-2 review (`a518957e`, 2026-08-27) — `quorum_service.py` is
shared between meetings and elections quorum math, and Codex caught there
that a session which already held the `MeetingMinutes` row via
`set_meeting_quorum_config`'s own unlocked read (same session, same
identity-mapped object, `expire_on_commit=False`) would still read stale
`attendees` after acquiring the lock, since a re-SELECT of a row already in
the identity map does not refresh it by default. Re-read the current method
directly (not cited from the commit message): the fix is present and correct,
and MM-4's own locking read is otherwise unchanged. No other file in this
feature's declared scope has moved since PR #1906 merged.

Re-verified all seven pass-1 fixes (MM-1 through MM-7) by reading the current
code rather than re-citing the doc: `update_action_item`'s `assert_in_org` on
a reassigned owner (both services), all five `apply_updates` conversions,
`create_from_event`'s dual locking reads (`Event` fetch **and** the `Meeting`
existence check, both `.with_for_update()` — the Codex-caught P1 fix), the
`assert_different_person` guard on `approve_minutes`, the seven `log_audit_event`
calls on minutes.py's motion/action-item/quorum-config endpoints (including
the P2 `applied_fields` fix so the audit log doesn't claim a field changed
that the approved-minutes filter silently dropped), and `get_open_action_items`'s
typed `UUID | None` parameter — all intact at their pass-1 lines.

Re-ran a route enumeration from scratch (not a diff against pass 1's count):
**17/17** `meetings.py` routes and **25/25** `minutes.py` routes, matching
pass 1 exactly. Every route still carries `require_permission(...)`; no
route fell back to bare `get_current_user`. Freshly re-swept every by-id
query in both services for a missing `organization_id` filter (not sampled)
— no gap; every write resolves its target through an org-scoped fetch or
filters `organization_id` directly on the query.

### MM-8 — LOW-MED — `meetings.py`'s own mutation endpoints had no audit trail — ✅ FIXED

**What:** every mutating route in `minutes.py` calls `log_audit_event`
(create/update/delete/submit/approve/reject/publish, motion CRUD, action-item
CRUD, template CRUD, quorum-config). `meetings.py` — the sibling `Meeting`
model, which carries the same shape of governance content (`agenda`/`notes`/
`motions` text columns, a `DRAFT → PENDING_APPROVAL → APPROVED` status, an
`approved_by`/`approved_at` pair) — had exactly **one** audited route
(`grant_attendance_waiver`) out of ten mutating endpoints. `create_meeting`,
`update_meeting`, `delete_meeting`, `approve_meeting`, `add_attendee`,
`remove_attendee`, `create_action_item`, `update_action_item`,
`delete_action_item`, and `create_meeting_from_event` all left zero trace.
This is not a dead API surface: `MinutesPage.tsx`'s "New Meeting" flow calls
`meetingsService.createMeeting()` (`POST /meetings`) directly, so the gap sat
on a live, UI-reachable create path, not merely a theoretical one.
**Where:** `app/api/v1/endpoints/meetings.py` — the ten routes named above.
**Failure scenario:** a meeting's agenda/notes text is edited or the record
is deleted outright (cascading its attendees and action items), or a meeting
is approved, with no record of who did it or when — the same governance-record
opacity MM-6 closed for `minutes.py` one pass ago, reopened here on the
sibling model MM-6's own scope split didn't reach.
**Fix:** all ten routes now call `log_audit_event`, mirroring the exact
`event_category="meetings"` / severity convention already established by
`grant_attendance_waiver` in this same file and by every `minutes.py`
mutation. The one pre-existing local `from app.core.audit import
log_audit_event` import inside `grant_attendance_waiver` was removed in favor
of the new top-level import (it would otherwise be a duplicate/shadowing
import, `F811`-adjacent, once the top-level import is added).

### MM-9 — LOW-MED — `approve_meeting` has no approval state-machine guard and no separation of duties — OPEN (flagged, not fixed)

**What:** `minute_service.approve_minutes` requires the record be
`SUBMITTED` and calls `assert_different_person(approved_by, minutes.submitted_by, ...)`
so the submitter cannot also approve. `meetings_service.approve_meeting` has
neither control: it sets `status = APPROVED` unconditionally regardless of
the meeting's current status (including re-approving an already-approved
record, or approving one still in `DRAFT` with no submission step at all),
and does not compare `approved_by` against `created_by` or any other actor.
**Where:** `app/services/meetings_service.py` (`approve_meeting`);
`app/api/v1/endpoints/meetings.py` (`approve_meeting` route).
**Why flagged, not fixed:** unlike MM-5 (which mirrored an already-decided,
already-repeated policy — the same `assert_different_person` guard applied
identically to finance requests, skills tests, admin hours, and minutes), the
`Meeting` model has **no `submitted_by` field and no submit step at all** —
`created_by` is the only actor recorded before approval, and comparing against
it is a materially different policy than "the submitter can't approve their
own submission": it would also block the common case of one secretary
single-handedly entering and approving a routine meeting record, a workflow
this endpoint's total absence of a state-machine check suggests may be
intentional for this lighter-weight sibling of the `MeetingMinutes` workflow.
Confirmed this route is not currently called from the reviewed frontend (no
`meetingsService.approveMeeting()` call site in `frontend/src/**`), which
lowers today's exploitability but does not change that the API itself grants
`meetings.manage` holders an unconditional, untracked approval with no
self-check — closing it properly needs a product decision on whether
`Meeting` should gain its own submit step and `submitted_by` field to make
the comparison mean the same thing MM-5 already established, or whether a
lighter `created_by`-based check is acceptable for this record type.
**Recommendation:** mirror `MeetingMinutes`'s workflow (add `submitted_by`,
require a submit step before `approve_meeting` accepts a status transition,
then apply `assert_different_person`) — deferred here since it changes the
endpoint's contract (a direct `DRAFT → APPROVED` call, which the live UI's
`meetingsService` interface does not currently exercise, would start
returning 400 for existing integrations that rely on it).

### MM-10 — LOW — `create_meeting_from_event` forwarded a raw service-layer error string with no sanitization — ✅ FIXED

**What:** every other error path in `meetings.py` wraps its service error
through `safe_error_detail(ValueError(error))` before returning it as
`detail=`. `create_meeting_from_event` returned `detail=error` directly —
`error` here is `create_from_event`'s own `except Exception as e: return
None, str(e)` branch output for anything beyond its two hand-written
"Event not found" / "Meeting already exists for this event" strings, so an
unexpected `IntegrityError`, `OperationalError`, or similar would forward its
raw `str(exception)` — potentially containing SQL fragments, table/column
names, or other internal detail — straight to the client with none of
`safe_error_detail`'s pattern-based redaction.
**Where:** `app/api/v1/endpoints/meetings.py` (`create_meeting_from_event`).
**Failure scenario:** a transient DB error inside `create_from_event`'s
`except` branch (e.g. a constraint violation from a concurrent edit) reaches
the client's `detail` field verbatim instead of a safe fallback message.
**Fix:** routed through `sanitize_error_message()` from `app/core/utils.py`
— the helper built for exactly this "raw service-layer string, not an
exception object" shape, already the established convention in
`inventory.py`/`medical_supplies.py`. The two hand-written strings still
pass through unchanged (neither trips `_UNSAFE_PATTERNS`); a SQL-shaped
string is now redacted to the generic fallback.

### MM-11 — MED — "Unlink" on a minutes record's linked event was a silent no-op — ✅ FIXED

**What:** `MinutesDetailPage.tsx`'s `handleUnlinkEvent` called
`minutesService.updateMinutes(minutesId, { event_id: undefined })`. Axios
serializes the request body with `JSON.stringify`, which drops any key whose
value is `undefined` entirely — so the PUT body sent was `{}`, not
`{ event_id: null }`. The backend's `MinutesUpdate` is applied with
`data.model_dump(exclude_unset=True)`; since the key never reached the JSON
body at all, `"event_id" in update_data` is `False` and `update_minutes`'s
own explicit-null-clears-the-field special case never runs. The result: the
button shows an "Event unlinked" success toast and the minutes record's
`event_id` never changes — the exact mirror-image of CLAUDE.md Pitfall #1
("on update, omitting the key is the bug").
**Where:** `frontend/src/modules/minutes/pages/MinutesDetailPage.tsx`
(`handleUnlinkEvent`).
**Failure scenario:** a secretary re-links minutes to the wrong event, then
clicks "Unlink" to correct it. The UI reports success and the linked-event
card disappears from view (component state is cleared locally via
`setLinkedEvent(null)`), but a page refresh — or another user opening the
same record — shows the stale link still present, since the database write
never happened.
**Fix:** changed the payload to `{ event_id: null }`, an explicit JSON
`null` that survives serialization and triggers `update_minutes`'s existing
clear-on-falsy handling correctly. Swept the rest of the module
(`MinutesPage.tsx`, `MinutesDetailPage.tsx`) for the same `undefined`-in-an-
update-payload shape — the only other `: undefined` sites are `useState`
initializers and local form-state resets for **create** payloads
(`MotionCreate`/`ActionItemCreate`), where an omitted optional field on
create is the correct behavior (Pitfall #1's create-side rule), not an
instance of this bug.

## Confirmed still open (pass 2)

- **MM-9** (above) — needs a product decision on `Meeting`'s approval
  workflow shape before a mechanical fix is safe.
- The pass-1 module-audit/app-review's deferred `minutes.view_executive`
  tier (a distinct-from-`minutes.manage` audience for executive-session
  minutes) remains open, unchanged, and out of this pass's scope — re-read
  `docs/app-review/meetings-minutes.md`'s pass 1/2 sections and confirmed no
  code in either reviewed pass introduces or removes that tier.

## Guard tests added (pass 2)

- `backend/tests/test_meetings_audit_trail.py` (new, 14 tests) — one test
  per newly-audited `meetings.py` mutation route asserting `log_audit_event`
  was awaited with the expected `event_type`; a failure-path test asserting
  `delete_meeting` does **not** log on a failed delete; three tests for
  MM-10 (`create_meeting_from_event`'s raw-error sanitization, and that the
  two hand-written error strings and their status codes are unaffected).
  Verified to fail on reintroduction: removing the new `log_audit_event`
  call from any one route fails that route's own test with no other test
  affected (each test asserts `assert_awaited_once`, so a reintroduced gap
  is caught at the specific route, not just in aggregate).
- `frontend/src/modules/minutes/pages/MinutesDetailPage.unlinkEvent.test.tsx`
  (new) — clicks "Unlink" and asserts `updateMinutes` was called with a
  payload where `event_id` is an **own property** equal to `null` (not
  merely absent-and-therefore-`undefined`-when-read). Confirmed to fail
  before the fix (reverted `null` back to `undefined` locally, re-ran: fails
  with the expected-call assertion) and pass after.

## Completion gate (pass 2)

| Check                                                       | Result                                                    |
| ----------------------------------------------------------- | --------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                               | clean (0 violations)                                      |
| `black --check app/ tests/ alembic/`                        | clean (1337 files unchanged)                              |
| `isort --check-only app/ tests/ alembic/` (8.0.1, CI's pin) | clean                                                     |
| `python3 scripts/validate_migrations.py --strict`           | PASSED — 394 revisions, single head                       |
| backend tests, scope (`-k "meeting or minutes or quorum"`)  | 219 passed, 1 skipped (pre-existing)                      |
| backend tests, full suite                                   | 9287 passed, 22 skipped, 0 failed                         |
| `npx tsc --noEmit` (frontend)                               | 0 errors                                                  |
| `npx eslint .` (frontend)                                   | 0 errors, 8 pre-existing warnings (none in touched files) |
| `npx vitest run src/modules/minutes` (frontend)             | 23 passed, 3 files                                        |

---

## Pass 3 (2026-09-06)

**Backend:** `app/api/v1/endpoints/meetings.py` (623 L, was 493, +130),
`app/services/meetings_service.py` (642 L, was 608, +34),
`app/api/v1/endpoints/minutes.py` (1,123 L, was 1,037, +86),
`app/services/minute_service.py` (991 L, was 921, +70),
`app/services/quorum_service.py` (159 L, was 139, +20). Also pulled in
`app/services/attendance_dashboard_service.py` — backs three `meetings.py`
routes (`get_attendance_dashboard`, `grant_attendance_waiver`,
`list_attendance_waivers`) and was not named as in-scope by either prior
pass, a scope gap closed this pass.
**Frontend:** spot-checked `frontend/src/modules/minutes/` (9 files, 3,280
lines, including a new `MinutesDetailPage.linkedElections.test.tsx`) and the
new "Linked Elections" cross-module card in `MinutesDetailPage.tsx`.
**Migrations:** none.

### Scope

The local clone is a shallow clone (433 commits visible), so `git log` could
not reliably diff against pass 2's merged PR content. Read all five backend
files fresh, in full, via two parallel background agents (one per endpoint
pair: `meetings.py`+`meetings_service.py`, `minutes.py`+`minute_service.py`+
`quorum_service.py`), each briefed with the exact set of pass-1/pass-2
findings already fixed (not to re-report) and already open (to re-verify,
not re-derive) — plus my own direct read of `attendance_dashboard_service.py`
and the frontend module.

### New findings

**MM-9 (updated, still OPEN)** — the `update_meeting` PATCH route
(`app/api/v1/endpoints/meetings.py:125-159`) reaches the exact same
unguarded state MM-9 already flagged, through a second path:
`MeetingUpdate.status` accepts any legal `MeetingStatus` value including
`"approved"`, and `MeetingsService.update_meeting` (`meetings_service.py:
247-263`) applies it via `apply_updates` with no state-machine check —
so a generic PATCH can flip a meeting straight from `DRAFT` to `APPROVED`
while leaving `approved_by`/`approved_at` at whatever they already were
(typically `None`), which is a _more_ silent version of the gap than calling
the dedicated `/approve` route: no approval actor or timestamp is ever
recorded. Same permission (`meetings.manage`) already gates both routes, so
this is not a privilege escalation on its own, but it is one more surface
that the same missing state-machine guard reaches. Folded into MM-9 rather
than filed as a separate id, since both need the same product decision
(what `Meeting`'s approval workflow is actually supposed to enforce) before
either can be mechanically fixed — flagged, not fixed, pending that
decision, same disposition as before.

**MM-14 — LOW — cross-org name leak surface in `list_waivers` — FIXED.**
**What:** `AttendanceDashboardService.list_waivers` (`attendance_dashboard_
service.py`, now lines ~308-330) resolved the waiving member's and the
granting admin's names via `select(User).where(User.id == w.user_id)` /
`select(User).where(User.id == w.waiver_granted_by)` — no `organization_id`
filter, unlike every other by-id lookup in this feature (e.g.
`attach_creator_names`).
**Where:** `app/services/attendance_dashboard_service.py`.
**Scenario:** not exploitable today — `w.user_id` and `w.waiver_granted_by`
on a `MeetingAttendee` row are always populated from an already org-validated
write (`grant_waiver`'s own `assert_in_org` calls, and `add_attendee`'s
explicit check elsewhere), so a client cannot currently steer these ids
cross-org. It is exactly the fragile shape pitfall 14a warns about: a single
future write path that stores a `MeetingAttendee.user_id`/`waiver_granted_by`
without that validation would have this lookup silently resolve and return
another organization's member's name.
**Fix:** both lookups now filter `User.organization_id == organization_id`,
matching the convention used everywhere else in this feature.
**Guard test:** `backend/tests/test_attendance_dashboard_service.py::
TestWaivers::test_list_waivers_scopes_member_and_grantor_lookup_to_org` —
captures the compiled `WHERE` clause (not the full compiled statement,
which always mentions the column name `organization_id` in its `SELECT`
list regardless of any filter — the test's first draft false-passed against
the unfixed code for exactly that reason, caught and corrected before
landing) and asserts `organization_id` appears in it for both the member and
the grantor query. Verified to fail against the reverted (unfixed) code and
pass after.

### Looked suspicious, not fixed — reasoning recorded

- **`meeting_action_items.created_by`/`source`** (added by migration
  `20260903_1130_7bfe85f2e4e5`, exposed via `ActionItemResponse`) has no
  writer anywhere in `meetings.py`, `meetings_service.py`, or
  `app/mcp/tools/meetings.py` (confirmed by grep) — a column shipped ahead
  of the feature that populates it. Always `null` today; not a security
  defect, but the same shape as pitfall #19 (a switch with no reader, here
  a column with no writer). Not filed as a security finding since there is
  no disclosure or integrity risk in an always-null column; noting it so
  the next pass over this feature isn't surprised by it.
- **`set_meeting_quorum_config`** (`minutes.py:987-1064`) has no
  finalization-status guard (can rewrite quorum settings and recompute
  `quorum_met`/`quorum_count` on an already-`APPROVED` minutes record) and
  validates only `quorum_threshold > 0` with no upper bound, which feeds
  `quorum_service.py`'s `math.ceil(raw_required - 1e-9)` (line ~123).
  Unconfirmed exploitable — requires `minutes.manage`, and would need a
  value approaching `inf` to raise `OverflowError` — and unchanged since
  pass 1's description of this endpoint. Left open for a future pass rather
  than guessed at.

### Confirmed still-intact (re-verified fresh, not trusted from prior docs)

- All 17 `meetings.py` routes and all 25 `minutes.py` routes still carry
  `require_permission(...)`; no bare `get_current_user`, no `.view`
  permission gating a mutation.
- Every by-id service method across both features still filters
  `organization_id` or resolves through an org-scoped parent — re-swept
  method-by-method in both files, no new gap.
- XC-1 FK validation, `apply_updates` (not blind `setattr`), LIKE-escaping,
  JSON-column handling, finalization guards on `minutes.py`'s mutation
  routes, `assert_different_person` on `approve_minutes`, the
  `.with_for_update()` + `populate_existing=True` identity-map fix in
  `quorum_service.calculate_quorum`, and audit logging on every mutation
  route in both features — all re-verified present and unchanged.
- **MM-9's original finding** (`approve_meeting` has no state-machine guard
  and no separation of duties) — confirmed still open and unchanged, now
  updated above to include the `update_meeting` path.
- **`minutes.view_executive`** — confirmed the tier still does not exist;
  the restricted-read filter (non-managers see only `APPROVED` +
  non-`EXECUTIVE` minutes, 404 rather than 403 on a restricted record) is
  present and unchanged in `get_minutes`, `list_minutes`, `search_minutes`,
  and `get_stats`; no new read path in `minute_service.py` bypasses it.
- Frontend: no `window.confirm`/`window.alert`/`window.prompt` anywhere
  under `src/modules/minutes/` or `src/pages/MinutesPage.tsx`. The new
  "Linked Elections" card in `MinutesDetailPage.tsx` calls
  `electionService.getElectionsByEvent`, which routes to `elections.py`'s
  `list_elections` — confirmed `require_permission("elections.view")` and
  `Election.organization_id` scoping on that route, so the cross-module
  fetch is properly secured. (Its blanket `.catch(() => setLinkedElections
([]))` silently hides the card on any error including a legitimate 403 —
  safe, if imprecise, UX; not filed as a finding.)

### Guard tests added (pass 3)

- `backend/tests/test_attendance_dashboard_service.py::TestWaivers::
test_list_waivers_scopes_member_and_grantor_lookup_to_org` (MM-14, above).

### Completion gate (pass 3)

| Check                                                                              | Result                                                    |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                      | clean (0 violations)                                      |
| `black --check app/ tests/ alembic/`                                               | clean (1503 files unchanged)                              |
| `isort --check-only app/ tests/ alembic/`                                          | clean                                                     |
| `python3 scripts/validate_migrations.py --strict`                                  | PASSED — 431 revisions, single head                       |
| backend tests, scope (`-k "meeting or minutes or quorum or attendance_dashboard"`) | 245 passed, 1 skipped (pre-existing, py_vapid)            |
| backend tests, full suite                                                          | 11,470 passed, 21 skipped (env-only), 0 failed            |
| `npx tsc --noEmit` (frontend)                                                      | 0 errors                                                  |
| `npx eslint .` (frontend)                                                          | 0 errors, 3 pre-existing warnings (none in touched files) |
| `npx vitest run src/modules/minutes` (frontend)                                    | 23 passed, 3 files                                        |
