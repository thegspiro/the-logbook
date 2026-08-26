# Security Review — Meetings & Minutes

**Prefix:** `MM` · **Iteration:** 24 · **Reviewed:** 2026-08-26 · **PR:** TBD

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
call's existence check sees the first's committed `Meeting` row.

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
  - `TestCreateFromEventLocking` (new) — asserts the `Event` fetch renders
    `FOR UPDATE`.
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
| backend tests, full suite                             | 8908 passed, 22 skipped              |
