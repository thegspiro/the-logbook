# Security Review — Meetings & Minutes

**Prefix:** `MM` · **Iteration:** 24 · **Reviewed:** 2026-08-26 (pass 1), 2026-08-31 (pass 2), 2026-09-06 (pass 3), 2026-09-13 (pass 4), 2026-10-03 (pass 5), 2026-10-07 (pass 6), 2026-10-17 (pass 7), 2026-10-20 (pass 8), 2026-10-24 (pass 9), 2026-10-27 (pass 10), 2026-10-30 (pass 11) · **PR:** #1906 (pass 1), [#2079](https://github.com/thegspiro/the-logbook/pull/2079) (pass 2), #2303 (pass 3), [#2502](https://github.com/thegspiro/the-logbook/pull/2502) (pass 4), [#2881](https://github.com/thegspiro/the-logbook/pull/2881) (pass 5), pass 6 PR recorded in `PROGRESS.md`, pass 7 PR recorded in `PROGRESS.md`, [#3456](https://github.com/thegspiro/the-logbook/pull/3456) (pass 8), [#3636](https://github.com/thegspiro/the-logbook/pull/3636) (pass 9), [#3767](https://github.com/thegspiro/the-logbook/pull/3767) (pass 10), pass 11 (this PR)

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

---

## Pass 4 (2026-09-13)

**Backend:** `app/api/v1/endpoints/meetings.py` (623 L, unchanged since pass 3),
`app/api/v1/endpoints/minutes.py` (1,123 L before this pass's edits),
`app/services/meetings_service.py` (642 L, unchanged), `app/services/minute_service.py`
(991 L before this pass's edits), `app/services/quorum_service.py` (159 L,
unchanged), `app/services/attendance_dashboard_service.py` (348 L, unchanged) —
all read fresh, in full. `app/models/meeting.py`/`app/models/minute.py` and
`app/schemas/meetings.py`/`app/schemas/minute.py` re-read for checklist
dimension 7 (schema/migration integrity).
**Frontend:** `frontend/src/modules/minutes/` (grep-verified, not re-read in
full — see Scope below), `frontend/src/services/meetingsServices.ts`,
`frontend/src/pages/MinutesPage.tsx`.
**Migrations:** none — confirmed no new revision under `alembic/versions/`
touches `meeting_minutes`/`meetings`/`meeting_action_items`/`minutes_templates`
since pass 3's `20260903_1130_7bfe85f2e4e5` (meeting-action-item provenance).

### Scope

`git log --since=2026-09-06` on every file this feature names turned up only
merge commits from unrelated branches merging `main` into themselves — no
substantive change to any of the six backend files since pass 3 merged (line
counts match pass 3's end-of-pass figures exactly: 623 / 642 / 1,123 / 991 /
159 / 348). Read all six in full rather than trusting that byte-count match
alone, since a same-length edit is possible in principle. Re-verified every
pass 1–3 fix by reading the current code at its cited location (not re-citing
the doc): MM-1 through MM-8, MM-10, MM-11, MM-14 all confirmed present and
unchanged (see "Confirmed still-intact" below for specifics).

Frontend: `git log` confirmed `frontend/src/modules/minutes/` and
`frontend/src/services/meetingsServices.ts` also unchanged since pass 3 (the
latter's git-blame boundary commit is a shallow-clone artifact, not evidence
of a 2026-09-08 edit — re-confirmed by grepping for actual usage, see MM-9
re-verification below). Given no diff exists to review, this pass did not
re-read the frontend module in full a second time; it re-ran the specific
greps pass 2/3 used to confirm the MM-11 fix, the dialog ban, and the
`approveMeeting()`/`meetingsService` call-site question are all still true,
rather than re-deriving them from a fresh full read. This is a narrower
frontend scope than pass 3's — noted rather than silently matched.

New this pass: two findings from a fresh, full read of `quorum_service.py`'s
consumer in `minutes.py` (`set_meeting_quorum_config`, MM-15) and
`minute_service.py`'s `create_from_meeting` (MM-16), both confirmed
exploitable/verified against actual code paths rather than left as
"unconfirmed" the way pass 3's note on the same endpoint did.

### Route inventory

All 42 routes re-enumerated by reading both files top to bottom (not diffed
against pass 3's count). Every one still carries `require_permission(...)`; no
bare `get_current_user`, no `.view` permission gating a mutation.

| File        | Route                             | Permission                        | Org-scoped                                                             | Notes                                                         |
| ----------- | --------------------------------- | --------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------- |
| meetings.py | `GET /`                           | `meetings.view` OR `minutes.view` | service query filters org                                              |                                                               |
| meetings.py | `POST /`                          | `meetings.manage`                 | org-stamped on create                                                  | attendee/action-item FKs validated (MM-4)                     |
| meetings.py | `GET /{id}`                       | `meetings.view` OR `minutes.view` | `get_meeting_by_id(id, org)`                                           |                                                               |
| meetings.py | `PATCH /{id}`                     | `meetings.manage`                 | `get_meeting_by_id(id, org)`                                           | `status` can reach `approved` — MM-9                          |
| meetings.py | `DELETE /{id}`                    | `meetings.manage`                 | `get_meeting_by_id(id, org)`                                           |                                                               |
| meetings.py | `POST /{id}/approve`              | `meetings.manage`                 | `get_meeting_by_id(id, org)`                                           | no state machine / self-check — MM-9                          |
| meetings.py | `POST /{id}/attendees`            | `meetings.manage`                 | meeting + user both org-checked                                        |                                                               |
| meetings.py | `DELETE /{id}/attendees/{aid}`    | `meetings.manage`                 | filters `meeting_id` + `organization_id`                               |                                                               |
| meetings.py | `POST /{id}/action-items`         | `meetings.manage`                 | meeting org-checked; assignee validated (MM-4)                         |                                                               |
| meetings.py | `PATCH /action-items/{id}`        | `meetings.manage`                 | filters `organization_id`; assignee validated                          |                                                               |
| meetings.py | `DELETE /action-items/{id}`       | `meetings.manage`                 | filters `organization_id`                                              |                                                               |
| meetings.py | `GET /action-items/open`          | `meetings.view` OR `minutes.view` | filters `organization_id`                                              | `assigned_to` typed `UUID                                     | None` (MM-7) |
| meetings.py | `GET /stats/summary`              | `meetings.view` OR `minutes.view` | filters `organization_id`                                              |                                                               |
| meetings.py | `GET /attendance/dashboard`       | `meetings.manage`                 | filters `organization_id` throughout                                   |                                                               |
| meetings.py | `POST /{id}/attendance-waiver`    | `meetings.manage`                 | meeting + user both org-checked                                        |                                                               |
| meetings.py | `GET /{id}/attendance-waivers`    | `meetings.manage`                 | meeting org-checked; member/grantor lookups (MM-14)                    |                                                               |
| meetings.py | `POST /from-event/{event_id}`     | `meetings.manage`                 | locking reads, both org-filtered (MM-3)                                |                                                               |
| minutes.py  | `GET /`                           | `minutes.view`                    | filters org + `restricted` gate                                        |                                                               |
| minutes.py  | `GET /stats`                      | `minutes.view`                    | filters org + `restricted` gate                                        |                                                               |
| minutes.py  | `GET /search`                     | `minutes.view`                    | filters org + `restricted` gate; LIKE-escaped                          |                                                               |
| minutes.py  | `GET /templates`                  | `minutes.view`                    | filters `organization_id`                                              |                                                               |
| minutes.py  | `GET /{id}`                       | `minutes.view`                    | filters org + `restricted` gate (404 not 403)                          |                                                               |
| minutes.py  | `POST /`                          | `minutes.manage`                  | org-stamped; `event_id`/`assignee_id`/`template_id` validated (MM-1/4) |                                                               |
| minutes.py  | `PUT /{id}`                       | `minutes.manage`                  | `get_minutes(id, org)`; re-pointed `event_id` validated                | draft/rejected only                                           |
| minutes.py  | `DELETE /{id}`                    | `minutes.manage`                  | `get_minutes(id, org)`                                                 | draft only                                                    |
| minutes.py  | `POST /{id}/submit`               | `minutes.manage`                  | `get_minutes(id, org)`                                                 | draft/rejected only                                           |
| minutes.py  | `POST /{id}/approve`              | `minutes.manage`                  | `get_minutes(id, org)`                                                 | submitted only; separation of duties (MM-5)                   |
| minutes.py  | `POST /{id}/reject`               | `minutes.manage`                  | `get_minutes(id, org)`                                                 | submitted only                                                |
| minutes.py  | `POST /{id}/motions`              | `minutes.manage`                  | `get_minutes(id, org)`                                                 | draft/rejected only                                           |
| minutes.py  | `PUT /{id}/motions/{mid}`         | `minutes.manage`                  | `get_minutes(id, org)` + `minutes_id` filter                           | draft/rejected only                                           |
| minutes.py  | `DELETE /{id}/motions/{mid}`      | `minutes.manage`                  | `get_minutes(id, org)` + `minutes_id` filter                           | draft/rejected only                                           |
| minutes.py  | `POST /{id}/action-items`         | `minutes.manage`                  | `get_minutes(id, org)`; assignee validated (MM-4)                      |                                                               |
| minutes.py  | `PUT /{id}/action-items/{iid}`    | `minutes.manage`                  | `get_minutes(id, org)`; assignee validated                             | approved minutes: status/notes only                           |
| minutes.py  | `DELETE /{id}/action-items/{iid}` | `minutes.manage`                  | `get_minutes(id, org)`                                                 | draft/rejected only                                           |
| minutes.py  | `POST /{id}/publish`              | `minutes.manage`                  | `get_minutes(id, org)`                                                 |                                                               |
| minutes.py  | `GET /templates/{id}`             | `minutes.view`                    | filters `organization_id`                                              |                                                               |
| minutes.py  | `POST /templates`                 | `minutes.manage`                  | org-stamped                                                            |                                                               |
| minutes.py  | `PUT /templates/{id}`             | `minutes.manage`                  | filters `organization_id`                                              |                                                               |
| minutes.py  | `DELETE /templates/{id}`          | `minutes.manage`                  | filters `organization_id`                                              |                                                               |
| minutes.py  | `GET /{id}/quorum`                | `minutes.manage`                  | `.with_for_update()` locked (MM-4)                                     |                                                               |
| minutes.py  | `PATCH /{id}/quorum-config`       | `minutes.manage`                  | filters `organization_id`                                              | input validation fixed (MM-15); no finalization guard (MM-17) |
| minutes.py  | `POST /from-meeting/{meeting_id}` | `minutes.manage`                  | `Meeting` org-checked; attendee-name lookup fixed (MM-16)              |                                                               |

### Confirmed still-intact (re-verified fresh, not trusted from prior docs)

- MM-1/MM-4 (XC-1 FK validation on create/update): `assert_in_org` calls
  present at every cited call site in both services — `create_meeting`'s
  attendee/action-item loops, `create_action_item`, `update_action_item` (both
  services), `create_minutes`'s `event_id`/`assignee_id`, `update_minutes`'s
  re-pointed `event_id`, `add_action_item`, `update_action_item`
  (`minute_service.py`).
- MM-2 (`apply_updates` not blind `setattr`): confirmed in `update_meeting`,
  `update_action_item` (`meetings_service.py`), `update_minutes`,
  `update_motion`, `update_action_item` (`minute_service.py`); the two
  `meetings.py` update endpoints still use `exclude_unset=True`.
- MM-3 (`create_from_event` TOCTOU): both the `Event` fetch and the `Meeting`
  existence check still render `.with_for_update()`.
- MM-4/quorum (`calculate_quorum` race): the `MeetingMinutes` fetch still
  locks with `.with_for_update().execution_options(populate_existing=True)`.
- MM-5 (separation of duties on `approve_minutes`): `assert_different_person`
  call still present and unchanged.
- MM-6/MM-8 (audit trail): every mutating route in both files still calls
  `log_audit_event` — re-confirmed by reading each of the 42 routes directly,
  not by re-citing the prior count.
- MM-7 (`assigned_to` typed as `UUID | None`): confirmed on
  `get_open_action_items`.
- MM-10 (`create_meeting_from_event` error sanitization): still routes through
  `sanitize_error_message()`, not `safe_error_detail()`.
- MM-11 (frontend unlink-event no-op): `MinutesDetailPage.tsx`'s
  `handleUnlinkEvent` still sends `{ event_id: null }` (grep-confirmed, see
  Scope).
- MM-14 (cross-org name leak in `list_waivers`): both the member and grantor
  `User` lookups in `attendance_dashboard_service.py` still filter
  `organization_id`.
- LIKE-escaping (Pitfall #25): every `.ilike()` call across both services
  still passes `escape=LIKE_ESCAPE_CHAR` on a `like_pattern()`-built term —
  re-swept, no new call site skips it.
- JSON columns (Pitfall #12): `minute_service.py`'s `attendees`/`sections`/
  `header_config`/`footer_config` are still always rebuilt from a fresh
  `model_dump()` and reassigned wholesale, never shallow-copy-then-mutate.
- Schema/migration integrity (checklist dimension 7): every `ondelete="SET
NULL"` column on `Meeting`/`MeetingActionItem`/`MeetingMinutes` (`event_id`,
  `location_id`, `created_by` on `MeetingActionItem`, `template_id`,
  `event_id`, `meeting_id` on `MeetingMinutes`) still pairs with
  `nullable=True` — re-checked directly against `app/models/meeting.py` and
  `app/models/minute.py`, not sampled.
- Baseline grants: `_LINE_MEMBER_PERMISSIONS` in `app/core/permissions.py`
  grants the line-member baseline `meetings.view`/`minutes.view` only — no
  `.manage` grant in the baseline set (Pitfall #23 n/a here).

### MM-9 (re-verified, still OPEN, unchanged) — `approve_meeting`/`update_meeting` have no approval state machine or separation of duties

Re-read `meetings_service.approve_meeting` and `MeetingUpdate`'s `status`
validator directly: `approve_meeting` still sets `APPROVED` unconditionally
from any prior status with no `submitted_by` comparison, and
`MeetingUpdate.status` still validates against the full `MeetingStatus` enum
(including `"approved"`) with `MeetingsService.update_meeting` applying it via
`apply_updates` with no transition check — both exactly as pass 3 described.
Re-confirmed the frontend still has no call site: `meetingsService.
approveMeeting()` is defined in `frontend/src/services/meetingsServices.ts`
(and was, per git blame, before this rotation's involvement with this file —
the shallow clone's blame boundary is not evidence of a recent add) but is not
invoked from any `.tsx`/`.ts` file (`grep -rn "approveMeeting" src/ | grep -v
services/meetingsServices.ts` returns nothing). No regression; still needs the
same product decision pass 2/3 described (give `Meeting` its own
`submitted_by` + submit step, or accept a lighter single-actor policy for this
record type). **OPEN — no change.**

### New findings

#### MM-15 — LOW-MED — `set_meeting_quorum_config` accepted non-finite and unbounded `quorum_threshold` values — ✅ FIXED

**What:** `quorum_threshold: float` (a raw query parameter) was validated only
with `quorum_threshold <= 0`. `inf`, `-inf`, and `nan` all pass that check —
`float('nan') <= 0` is `False`, the same as every other ordinary comparison
against NaN — so nothing rejected them before they reached
`minutes.quorum_threshold = quorum_threshold; await db.commit()`.
**Where:** `app/api/v1/endpoints/minutes.py:1009-1018` (pre-fix).
**Failure scenario (verified against the real driver and column, not
inferred):** a `minutes.manage` holder sends
`PATCH /minutes/{id}/quorum-config?quorum_type=count&quorum_threshold=inf`.
Confirmed directly against the actual `Float` column and MySQL driver in a
throwaway integration test: `db.commit()` raises
`sqlalchemy.exc.ProgrammingError: (pymysql.err.ProgrammingError) inf can not
be used with MySQL` — pymysql's own float encoder rejects `inf`/`-inf`/`nan`
before the value ever reaches the server. That is an unhandled exception (no
`try`/`except` around the commit in this endpoint), caught only by the app's
global `Exception` handler (`main.py`'s `unhandled_exception_handler`), which
sanitizes the response to a generic 500 — no information disclosure, but a
clean input is turned into a crash instead of a 400. Independently, even if a
write had succeeded, `QuorumService.calculate_quorum`'s `int(q_threshold)` for
the `"count"` branch raises `OverflowError: cannot convert float infinity to
integer` on the next recalculation. A `percentage` threshold above 100 is a
distinct, non-crashing bug: it can never be satisfied by any attendee count,
permanently blocking quorum for that meeting with no error explaining why.
**Impact:** any `minutes.manage` holder (secretary/officer — not a public
surface) can 500 this endpoint with a single malformed value, and can silently
misconfigure a meeting into an unreachable quorum with a value that looks
plausible (e.g. `120`).
**Fix:** added an explicit `math.isfinite(quorum_threshold)` check (bare
comparisons cannot catch NaN) ahead of the existing positivity check, and a
type-specific upper bound — 100 for `percentage` (a percentage above 100 can
never be met), 100,000 for `count` (comfortably inside MySQL `FLOAT`'s
representable range, far beyond any real department's membership). This is
the same class of fix as pass 1's MM-7 (malformed input reaching an unhandled
exception, turned into a clean 400) — not a new policy, a validation gap on an
existing, already-declared positivity rule.

#### MM-16 — LOW — `create_from_meeting`'s attendee-name lookup had no org filter — ✅ FIXED

**What:** `MinuteService.create_from_meeting`'s attendee-name-resolution loop
ran `select(User).where(User.id == att.user_id)` with no `organization_id`
filter — the one `select(User)` call site across all four files (grepped)
missing it; `meetings_service.py`, `attendance_dashboard_service.py`, and
`meetings.py`'s own waiver-granting route all filter it.
**Where:** `app/services/minute_service.py:938` (pre-fix).
**Failure scenario:** not exploitable today — `att.user_id` on a
`Meeting`'s attendee list is always populated by an already org-validated
write (`add_attendee`'s explicit check, `create_meeting`'s `assert_in_org`
loop, or `create_from_event`'s RSVP import from an org-scoped `EventRSVP`).
This is the exact fragile shape pitfall 14a warns about and MM-14 (pass 3)
fixed on the same file's sibling service: a future write path onto
`MeetingAttendee.user_id` that skipped that validation would have this lookup
silently resolve and copy another organization's member's name into the new
minutes record's `attendees` JSON.
**Fix:** added `User.organization_id == str(organization_id)` to the lookup,
matching the convention used at every other `select(User)` call site in this
feature.

#### MM-17 — LOW-MED — `set_meeting_quorum_config` has no finalization guard on approved minutes — OPEN (flagged, not fixed)

**What:** every other mutating route on a `MeetingMinutes` record
(`update_minutes`, `add_motion`/`update_motion`/`delete_motion`,
`add_action_item`/`delete_action_item`) rejects the operation once the record
is `APPROVED` (draft/rejected only). `set_meeting_quorum_config` has no such
guard: it can overwrite `quorum_type`/`quorum_threshold` and immediately
recompute `quorum_met`/`quorum_count` on an already-approved record, changing
whether the historical record now says quorum was met for a vote that has
already been ratified.
**Where:** `app/api/v1/endpoints/minutes.py` (`set_meeting_quorum_config`,
the block before the org-scoped `MeetingMinutes` fetch).
**Why flagged, not fixed:** this is the same category as MM-9 — bringing it
in line with every sibling mutation is an obvious-looking change that is
still a behavior change with no test today asserting the current (permissive)
behavior is unwanted. Unlike MM-15 (turning an already-declared "must be
positive" rule into one that actually catches every non-conforming value —
not a new rule), blocking this endpoint on `APPROVED` would newly forbid an
action the API has always allowed, and it's plausible a secretary
legitimately needs to correct a quorum misconfiguration discovered after
approval (the four other guarded endpoints are all content edits a correction
workflow wouldn't need; this one is closer to metadata). First raised as an
unfiled observation in pass 3 ("Looked suspicious, not fixed"); promoted to a
tracked finding this pass since MM-15's fix touches the same validation block
and the gap deserves its own id and disposition rather than staying prose in
a "looked suspicious" aside.
**Recommendation:** add the same `if minutes.status == MinutesStatus.APPROVED.value: raise ValueError(...)`
guard used by the four sibling endpoints, once a product owner confirms
post-approval quorum correction isn't a supported workflow — or, if it is,
document that this endpoint is deliberately exempt from the finalization
convention.

## Schema & migration notes (pass 4)

None — every fix this pass is service/endpoint-layer only, matching pass 1–3.

## Guard tests added (pass 4)

- `backend/tests/test_minutes_quorum_config_validation.py` (new) — calls
  `set_meeting_quorum_config` directly with a `db` mock that raises if
  `execute()` is ever called, asserting `inf`/`-inf`/`nan`/zero/negative/
  over-100-percentage/1e30-count are all rejected with 400 before any query
  runs, and that `100.0` (percentage) and `10.0` (count) pass validation and
  proceed to the (mocked) lookup. Verified to fail against the pre-fix
  endpoint (4 of 9 cases) and pass after.
- `backend/tests/test_minute_service.py::TestCreateFromMeeting::
test_create_from_meeting_scopes_attendee_name_lookup_to_org` (new) —
  captures the compiled `WHERE` clause of the attendee-name lookup and
  asserts `organization_id` appears in it, matching MM-14's guard-test shape.
  Verified to fail against the reverted (unfixed) code with the actual
  captured SQL shown, and pass after.

## Completion gate (pass 4)

| Check                                                                             | Result                                                                                  |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                     | clean (0 violations)                                                                    |
| `black --check app/ tests/ alembic/`                                              | clean (1,586 files unchanged)                                                           |
| `isort --check-only app/ tests/ alembic/` (9.0.1, CI's pin)                       | clean                                                                                   |
| `python3 scripts/validate_migrations.py --strict`                                 | PASSED — 443 revisions, single head                                                     |
| backend tests, scope (`-k "meeting or minute or quorum or attendance_dashboard"`) | 289 passed, 1 skipped (pre-existing, py_vapid)                                          |
| backend tests, full suite                                                         | 12,447 passed, 21 skipped (env-only: py_vapid, Docker, contract), 0 failed              |
| `npx tsc --noEmit` (frontend, via `tsc-native.mjs`)                               | 0 errors                                                                                |
| `npm run lint` (frontend)                                                         | 0 errors, 1,449 pre-existing `@typescript-eslint/no-unsafe-*` warnings — see note below |

**The 1,449 lint warnings are not from this pass's changes** — this diff
touches no frontend file at all (`git status`: only two backend files, one
new and one edited backend test file, and this doc). Every warning is
`@typescript-eslint/no-unsafe-*` with the message "…a type that cannot be
resolved," spread across dozens of files this feature never touches
(`themeTokenIntegrity.test.ts` and others). This is the exact symptom
`docs/KNOWN_LIMITATIONS.md`'s "Frontend — `typescript`'s declared version has
drifted…" entry already documents from an unrelated pass (EV-16, pass 4):
type-aware lint failing to resolve types under this sandbox's `node_modules`
state and emitting a large, spurious warning count instead of real findings —
already escalated there as needing an owner decision on the `typescript`
version pin, not a mechanical fix inside a single feature's PR. Re-confirmed
this is a local/sandbox artifact, not a real regression: 0 errors, and
`npx tsc --noEmit` (the actual build compiler) is clean. Not re-escalated as
a new KNOWN_LIMITATIONS entry since the existing one already covers it; noted
here only so this pass's gate table doesn't read as unexplained.

---

## Pass 5 (2026-10-03)

**Note on numbering:** `docs/security-review/PROGRESS.md`'s rotation table and
log describe this as the feature's "pass 6" (the rotation-wide full-cycle
counter reached 6 before this feature was next in line). This file's own
count says otherwise: pass 4 (above) is the fourth recorded pass for this
specific feature, and no "Pass 5" section exists between it and this one — the
rotation's cycle-5 apparently completed and reset the table to ⬜ (per
`PROGRESS.md`'s 2026-09-15 log entry) without this feature having actually
been re-reviewed in that cycle. Titled `Pass 5` here because that is the
feature's true review count, not the rotation's; noted so a future reader
does not go looking for a missing "Pass 5" write-up.

**Backend:** `app/api/v1/endpoints/meetings.py` (623 L, unchanged since pass 4),
`app/api/v1/endpoints/minutes.py` (1,142 L, was 1,123 — +19 L, no route added
or removed), `app/services/meetings_service.py` (652 L, was 642 — +10 L, a
timezone fix only), `app/services/minute_service.py` (999 L, was 991 — +8 L,
comment/doc only, no logic change at any previously-cited line),
`app/services/quorum_service.py` (159 L, byte-identical to pass 4),
`app/services/attendance_dashboard_service.py` (333 L, was 348 — rewritten,
see Scope), `app/mcp/tools/meetings.py` (642 L — read in full for the first
time this pass, see Scope), `app/utils/membership_tier_service.py` (read in
part — the two functions `attendance_dashboard_service.py` now calls).
`app/models/meeting.py` / `app/models/minute.py` and
`app/schemas/meetings.py` / `app/schemas/minute.py` re-read in full for
checklist dimension 7.
**Frontend:** `frontend/src/modules/minutes/` (full file listing + the two
commits since pass 4 read directly — both pure copy/wording changes, see
Scope), `frontend/src/services/meetingsServices.ts`, `frontend/src/pages/MinutesPage.tsx`.
**Migrations:** none — confirmed no new revision under `alembic/versions/`
touches `meetings`/`meeting_attendees`/`meeting_action_items`/`meeting_minutes`/
`motions`/`minutes_templates` since pass 4's merge. The Alembic chain has grown
to 508 revisions (single head) purely from unrelated feature work.

### Scope

`git log` against every file this feature names turned up exactly three
substantive commits since pass 4 merged (`653b4906e`, `6850d691f`,
`16eb90edd` — the last a merge of unrelated history, not a direct edit):

- `6850d691f` ("Move the remaining 'today' reads to the department's date") —
  touched `meetings_service.py` only: `get_summary`'s "meetings this month"
  count and `create_from_event`'s meeting-date/time copy now resolve the
  organization's own timezone (`resolve_org_today`, `resolve_scheduling_timezone`,
  `to_local`) instead of the server's UTC clock. Read the diff directly
  (`git show 6850d691f -- app/services/meetings_service.py`): a timezone
  correctness fix, not a security change — a 7 PM Eastern meeting bridged from
  an event no longer reads 11 PM. No new unscoped query, no new permission
  path.
- `653b4906e` ("Fix voting-attendance window...") — rewrote
  `attendance_dashboard_service.py`'s `get_dashboard` to share
  `attendance_window`/`tally_attendance` (new in `membership_tier_service.py`)
  with the elections ballot-eligibility check, so the dashboard and the vote
  gate can no longer disagree about a member's attendance percentage (the
  exact class of bug Pitfall #29 in CLAUDE.md names). Read the full diff and
  the two shared functions directly (not cited from the commit message):
  `attendance_window` bounds a member's judged period at the later of the
  look-back cutoff and their current `MemberServicePeriod` start (a rehire is
  no longer charged for meetings held while they were off the roster);
  `tally_attendance` classifies waived/on-leave/eligible/attended from
  meeting-id sets so a meeting excluded for two reasons is not double-counted
  (this was already correct before the refactor — see pass 3's note — the
  refactor's purpose is sharing the logic, not fixing a new bug in it).
  `MemberServiceHistoryService.periods_by_user` (the new per-member stint
  lookup) filters `organization_id` directly — confirmed at
  `app/services/member_service_history_service.py:267-271`. No new by-id
  query skips org-scoping; no change to any endpoint's permission gate.
- `d822431a2` / `da8b76122` (frontend) — pure copy/wording commits on
  `MinutesDetailPage.tsx` and `MinutesPage.tsx` (error-toast text naming the
  failed action, status-label display strings). Read both diffs in full:
  neither touches a permission check, an update payload, or a dialog. The
  MM-11 fix's `{ event_id: null }` payload and both pages' `minutes.manage`
  permission checks are untouched at their prior lines (grep-confirmed).

Everything else this feature names is byte-identical to pass 4's reviewed
state (line counts above, confirmed, not merely assumed from the git log
being quiet).

**New to this pass's scope, not reviewed by name in passes 1–4:**
`app/mcp/tools/meetings.py` (642 L) — pass 3 had grepped it once for a single
question (does anything write `MeetingActionItem.created_by`/`source`?) but
never read it as a surface in its own right. Read in full this pass. It is a
read-only MCP tool surface (`list_meetings`, `get_meeting_agenda`,
`list_open_action_items`, `get_action_item_description`, `list_minutes`,
`get_minutes`, `get_minutes_text` — no create/update/delete tool exists here)
exposed to an authenticated MCP `principal`, not an HTTP route, so it is noted
separately from the 42-route inventory below rather than folded into it.
Every handler filters `principal.organization_id` directly on its query
(`meetings.py:330,352,411` for the by-id reads) or resolves through
`MeetingsService`/`MinuteService` calls that already do (confirmed at each
call site, not sampled). The two minutes-reading tools
(`list_minutes`/`get_minutes`/`get_minutes_text`) hard-code
`restricted=True` unconditionally — an MCP principal can never see a draft or
an executive-session minutes record, which is strictly more conservative than
the human `minutes.manage` path and not gated on any MCP-side permission
concept at all. Finance-sensitive content (`treasurer_report`, and
finance-bearing dynamic sections via `_is_finance_section`) additionally
requires `principal.expose_finance and principal.module_enabled("finance")` —
both the explicit sharing flag and the module being enabled on the org. No
finding here; recorded as newly-verified scope, not re-derived from a prior
pass's partial look.

### Route inventory

Re-enumerated all 42 routes by reading both files top to bottom fresh (not
diffed against pass 4's table). Unchanged in every cell from the table pass 4
published: all 42 still carry `require_permission(...)`, no bare
`get_current_user`, no `.view` permission gating a mutation, every by-id
service method still resolves through an org-scoped fetch or filters
`organization_id` directly. Not reproduced verbatim here — see pass 4's table
above, every row of which was re-checked against the current file and found
unchanged at the cited behavior (permission string, org-scoping mechanism,
and the MM-id note in the last column all still apply; only `minutes.py`'s
line numbers shifted by the pass-4-unrelated `+19 L`, e.g.
`set_meeting_quorum_config` is now at `minutes.py:989` rather than `:988`).

### Confirmed still-intact (re-verified fresh against current code, not cited from prior docs)

- **MM-1 through MM-8, MM-10, MM-11, MM-14, MM-15, MM-16** — every cited
  `assert_in_org` call, `apply_updates` conversion, the dual `.with_for_update()`
  locks in `create_from_event`, the `.with_for_update().execution_options(populate_existing=True)`
  lock in `calculate_quorum`, `assert_different_person` in `approve_minutes`,
  the `log_audit_event` call on all 42 routes (both files), the typed
  `assigned_to: UUID | None` parameter, `sanitize_error_message()` in
  `create_meeting_from_event`, the frontend's `{ event_id: null }` unlink
  payload, and the org filters on both `attendance_dashboard_service.py`'s
  waiver-name lookups and `minute_service.py`'s `create_from_meeting`
  attendee-name lookup, and `set_meeting_quorum_config`'s `math.isfinite()` +
  type-specific upper-bound validation — all read directly at their cited
  locations this pass and found unchanged.
- **LIKE-escaping (Pitfall #25):** every `.ilike()` call across both services
  (`get_meetings`, `list_minutes`, `search_minutes`, and the per-field loop in
  `search_minutes`) still builds its pattern through `like_pattern()` and
  passes `escape=LIKE_ESCAPE_CHAR`. No new call site.
- **JSON columns (Pitfall #12):** `minute_service.py`'s `attendees`/`sections`/
  `header_config`/`footer_config` are still always rebuilt from a fresh
  `model_dump()` and reassigned wholesale — confirmed again in
  `create_minutes`/`update_minutes`, no shallow-copy-then-mutate-nested-key
  pattern introduced anywhere in this feature's files.
- **Schema/migration integrity (checklist dimension 7):** every
  `ondelete="SET NULL"` column on `Meeting` (`event_id`, `location_id`),
  `MeetingActionItem` (`created_by`), `MeetingMinutes` (`template_id`,
  `event_id`, `meeting_id`) is still paired with `nullable=True` — re-read
  directly against both model files line by line, not sampled.
- **No CSV/spreadsheet export** anywhere in either endpoint file or either
  service (Pitfall #15 n/a, re-confirmed by grep for `csv\.` / `StreamingResponse`
  across all four files — zero hits).
- **`minutes.view_executive` tier** — confirmed still does not exist; the
  `restricted` read gate is unchanged in `get_minutes`/`list_minutes`/
  `search_minutes`/`get_stats`. Mirrored in `KNOWN_LIMITATIONS.md` already
  (unchanged).
- **UNCACHEABLE_PREFIXES (checklist dimension 5):** `/meetings` and
  `/minutes-records/` are both present in
  `frontend/src/utils/apiCache.ts`'s `UNCACHEABLE_PREFIXES`. Worth noting
  explicitly since neither prior pass's write-up mentions checking this: the
  minutes module's own `services/api.ts` uses the module-local
  `createApiClient()` factory, which carries no caching logic at all (verified
  by reading `frontend/src/utils/createApiClient.ts` in full — it has a CSRF
  request interceptor and a 401-refresh response interceptor, nothing that
  reads or writes `apiCache.ts`), so minutes-module GET traffic was never
  subject to the stale-while-revalidate cache regardless. `meetingsServices.ts`
  (the un-modularized `Meeting` client) does use the global cached `api`
  instance from `services/apiClient.ts`, which is why `/meetings`'s exclusion
  entry is the one that actually does work.
- **No `window.confirm`/`alert`/`prompt`** anywhere under
  `src/modules/minutes/` or `src/pages/MinutesPage.tsx` (re-grepped fresh).
- **Frontend form-value handling:** no `?? undefined` or `.trim() ?? ` pattern
  in either page or the store (Pitfall #1 n/a this pass — re-grepped).

### New findings

**None.** Every file this feature owns that changed since pass 4 was read in
full; none of the three substantive commits (above) touches an auth
dependency, a permission string, an org-scoping filter, a LIKE pattern, a
JSON-column mutation, or a locking read. The one file read for the first time
this pass (`app/mcp/tools/meetings.py`) is clean by the same checklist (see
Scope).

### Looked at, not a finding — recorded for the next pass

- **`minute_service.get_stats`'s "this month" count still reads the server's
  UTC clock, not the department's date** (`app/services/minute_service.py:763-768`:
  `now = datetime.now(timezone.utc)`, then `month_start = now.replace(day=1, ...)`).
  This is the same class of bug `6850d691f` fixed one call away — in
  `meetings_service.get_summary`'s sibling "meetings this month" count, in the
  same commit, in the same PR — but `minute_service.py`'s own "this month"
  count was not touched by that sweep and is not caught by
  `tests/test_server_date_ratchet.py`'s AST detector, because the detector
  matches `date.today()` / `datetime.now(timezone.utc).date()` specifically,
  and this call never chains `.date()` — it compares a `DateTime(timezone=True)`
  column (`MeetingMinutes.meeting_date`) against a `datetime`, not a `date`.
  Concretely: an org in US Pacific time, in the last ~7 hours of a month
  (after local midnight-to-UTC-midnight rolls the server's "now" into the next
  calendar month but it is still the old month locally), would see the
  dashboard's `this_month` count reset to 0 a few hours before the org's own
  month actually ends — a stat-accuracy bug, not a tenant-isolation or
  authorization defect, and not reachable by an attacker. A second instance
  (`minute_service.py:976`, the `datetime.now(timezone.utc)` fallback for
  `meeting_date_dt` in `create_from_meeting`, used only when the source
  `Meeting.meeting_date` is somehow unset) is lower-value still — `meeting_date`
  is `nullable=False` on `Meeting`, so the fallback branch is effectively dead
  code today. **Not fixed this pass**: both are a dashboard-accuracy/dead-code
  correctness class, not one of the seven security dimensions this rotation
  works, and the "this month" fix is a behavior change (it changes which rows
  a stat counts) of the kind this rotation flags rather than applies
  unprompted. Recommend folding into the next "today reads" sweep rather than
  this feature's own PR.
- **`AttendanceDashboardService.list_waivers`'s per-waiver name lookup remains
  an N+1 pattern** (`app/services/attendance_dashboard_service.py:296-315`: up
  to two `User` queries per waiver row in a Python loop). Unchanged since pass
  3/4, both of which fixed this method's org-scoping (MM-14) without touching
  its query shape. Bounded by the number of waivers on a single meeting
  (`meetings.manage`-gated, not attacker-reachable, and a meeting realistically
  has at most a few dozen attendees), so not a DoS vector — noted only because
  checklist dimension 6 explicitly calls out "no N+1 loop issuing a query per
  row" and a future pass with a reason to touch this method should batch it
  (`User.id.in_(...)`) while there.
- **`AttendanceDashboardService.grant_waiver`'s find-or-create has no lock**
  (`app/services/attendance_dashboard_service.py:239-267`): a plain `SELECT`
  for an existing `MeetingAttendee` row followed by either an `INSERT` or an
  `UPDATE`, with no `.with_for_update()` and no unique constraint on
  `(meeting_id, user_id)` in the schema. Two admins granting a waiver to the
  same member on the same meeting within the same instant could each see "no
  existing record" and both insert, producing a duplicate `MeetingAttendee`
  row for that user. This is the Pitfall #27 shape structurally, but the
  consequence is a duplicate attendance record (a data-integrity blemish the
  dashboard's per-user loop already tolerates — it collects "records" as a
  list, not a single row), not a security bypass or an overcounted capacity
  limit, and it requires two users with `meetings.manage` acting on the same
  target within milliseconds. Left unfixed as out of proportion to this
  pass's scope; noted so a future quorum/attendance-locking pass has it on
  the list rather than rediscovering it.

### Guard tests added

None. No new finding required one this pass; all five existing guard-test
files (`test_meetings_audit_trail.py`, `test_meetings_service.py`,
`test_minute_service.py`, `test_quorum_service.py`,
`test_minutes_quorum_config_validation.py`) re-ran clean against current code
(see Completion gate).

## Completion gate (pass 5)

| Check                                                       | Result                                                                                                                              |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                               | clean (0 violations)                                                                                                                |
| `black --check app/ tests/ alembic/`                        | clean (1,849 files unchanged)                                                                                                       |
| `isort --check-only app/ tests/ alembic/` (9.0.1, CI's pin) | clean                                                                                                                               |
| `python3 scripts/validate_migrations.py --strict`           | PASSED — 508 revisions, single head `90070d4a2f6f`                                                                                  |
| backend tests, scope (`-k "meeting or minutes or quorum"`)  | 289 passed, 1 skipped (pre-existing, py_vapid) — identical count to pass 4                                                          |
| `cd frontend && npm run typecheck`                          | 0 errors (after `npm ci` from the repo root — this worktree's `node_modules` did not exist at all before this pass; see note below) |
| `cd frontend && npm run lint`                               | 0 errors, 0 warnings (well under the 10-warning budget)                                                                             |
| `npx vitest run src/modules/minutes`                        | 26 passed, 4 files (was 23/3 at pass 4 — the two copy-fix commits added coverage)                                                   |

**`node_modules` had to be installed before the frontend gates could run at
all.** Neither `frontend/node_modules` nor the root `node_modules` existed in
this worktree — not a stale/partial install, a completely absent one — so
every frontend command failed with `Cannot find module 'react-router'` /
`'react-hot-toast'` etc. across dozens of unrelated files, not anything this
feature touches. Per CLAUDE.md's own guidance this was resolved with
`npm ci` from the repo root against the **committed, untouched**
`package-lock.json` — never `rm package-lock.json && npm install`, and
`package-lock.json` itself was not modified by this pass. `npm ci` installs
exactly what the lockfile already resolves; it is the documented safe
operation, distinct from the lockfile-regeneration CLAUDE.md warns against.

---

## Pass 6 (2026-10-07)

**Backend:** `app/api/v1/endpoints/meetings.py` (623 L, byte-identical to
pass 5), `app/api/v1/endpoints/minutes.py` (1,143 L, was 1,142 — +1 L, a
response field only), `app/services/meetings_service.py` (655 L, was
652 — +3 L, a display-name helper swap), `app/services/minute_service.py`
(1,005 L, was 999 — +6 L, a display-name swap plus a one-line import),
`app/services/quorum_service.py` (159 L, byte-identical),
`app/services/attendance_dashboard_service.py` (333 L, byte-identical line
count — two `full_name` reads swapped for `display_name`),
`app/mcp/tools/meetings.py` (712 L, was 642 — +70 L, see below). All seven
read fresh, in full. `app/models/meeting.py`/`app/models/minute.py` and
`app/schemas/meetings.py`/`app/schemas/minute.py` re-read for checklist
dimension 7.
**Frontend:** `frontend/src/modules/minutes/pages/MinutesPage.tsx` (+147/-56
L), `frontend/src/modules/minutes/pages/MinutesDetailPage.tsx` (+35/-25 L),
`frontend/src/modules/minutes/services/api.ts` (+16 L), `frontend/src/modules/minutes/types/minutes.ts`
(+2 L), plus the two new test files (`MinutesDetailPage.approval.test.tsx`,
`MinutesPage.minutesLinks.test.tsx`) — all read in full.
**Migrations:** none — confirmed no new revision under `alembic/versions/`
touches `meetings`/`meeting_attendees`/`meeting_action_items`/`meeting_minutes`/
`motions`/`minutes_templates` since pass 5's merge (`c23c100b4`). The chain
has grown to 538 revisions (single head `8c4f2a6e1d93`) from unrelated
feature work.

### Scope

`git diff c23c100b4..HEAD` (pass 5's merge commit to the current tip) against
every file this feature names turned up real changes in exactly the files
listed above; every other backend/frontend file this feature's scope names
(`app/models/meeting.py`, `app/models/minute.py`, `app/schemas/meetings.py`,
`app/schemas/minute.py`, `frontend/src/services/meetingsServices.ts`) is
byte-identical to pass 5's reviewed state — confirmed by diffing, not by a
quiet `git log`.

The real deltas, each read in full rather than trusted from a commit
message:

- **`app/mcp/tools/meetings.py` (+70 L) and `app/mcp/registry.py`
  (cross-cutting, not in this feature's own file list but the mechanism the
  diff depends on)** — a new `permissions` keyword, now **required** on
  every `logbook_tool(...)` registration repo-wide, added to all six
  meetings/minutes MCP tools (`list_meetings`, `get_meeting_agenda`,
  `list_open_action_items`, `get_action_item_description`, `list_minutes`,
  `get_minutes`/`get_minutes_text` — the last two share one registration).
  Each now declares `("meetings.view", "minutes.view", "meetings.manage",
"minutes.manage")`, an OR-set matching this feature's own HTTP route
  convention (`meetings.py`'s read routes gate on the identical
  `meetings.view OR minutes.view`). **This closes the gap pass 5 recorded as
  an observation, not a finding**: "the two minutes-reading tools hard-code
  `restricted=True` unconditionally... not gated on any MCP-side permission
  concept at all." An OAuth-connected member's own permissions are now
  checked (`principal.member_allows(permissions)`,
  `app/mcp/registry.py:161-162`) before any of the six tools runs, in
  addition to the pre-existing module-enablement and `restricted=True`
  reads. Verified this is enforced, not merely declared, by reading
  `logbook_tool`'s wrapper directly (`registry.py:156-168`: the permission
  check raises `ToolError` and is audited as `"refused"` before the
  handler's `db` session ever opens) and by running the existing
  cross-cutting guard test below. Not filed as a new MM finding since no
  defect was found — the opposite: a previously-recorded observation is now
  resolved by code outside this feature's own files, same as this file's own
  convention for crediting a fix landed by other work (pass 5 §MM-15/16, pass
  3 §MM-14 citing sibling-feature precedent).
- **`app/services/meetings_service.py`, `minute_service.py`,
  `attendance_dashboard_service.py`** — `User.full_name` reads replaced with
  `User.display_name` (a `@property` combining first/last/preferred name,
  `app/models/user.py:570-572`), part of a repo-wide display-name rename.
  Read `display_name`'s implementation directly: it calls
  `format_display_name(first_name, last_name, preferred_name)`
  (`app/utils/member_names.py`), which degrades gracefully (confirmed by
  reading the function) rather than raising on a missing preferred/last
  name. The three call sites this rename touches in this feature's files are
  exactly the ones MM-14 and MM-16 already org-scoped
  (`attach_creator_names`, `list_waivers`'s member/grantor lookups,
  `create_from_meeting`'s attendee-name lookup) — re-read each at its
  current line and confirmed the `organization_id` filter the rename sits
  inside of is untouched (see "Confirmed still-intact" below for the exact
  locations). A cosmetic rename, not a new query shape.
- **`minute_service.create_from_meeting`'s meeting-date combine** — now
  resolves the organization's own scheduling timezone
  (`resolve_scheduling_timezone`) before combining `meeting.meeting_date` +
  `meeting.start_time` and converting to UTC, instead of treating the local
  wall-clock values as if they were already UTC. Read the diff and the
  current code directly: a correctness fix (the same "today reads" class
  pass 5 fixed one call away in `meetings_service.get_summary`), not a
  security-relevant change — no new unscoped query, no permission or
  org-filter change.
- **`minutes.py`'s `list_minutes` / `schemas/minute.py`'s `MinutesListItem`**
  — added `meeting_id` to the response so the frontend can link minutes back
  to the meeting they were written from. `meeting_id` is already a column on
  `MeetingMinutes` (`ondelete="SET NULL"`, `nullable=True` — unchanged, see
  Schema notes) and was already readable via `GET /minutes-records/{id}`'s
  full `MinutesResponse`; this only adds it to the **list** response, which
  is already org-filtered and `restricted`-gated identically to every other
  field on that schema. Not a new exposure — the same organization-scoped
  minutes list already contained this record; one more of its own columns is
  now visible in it.
- **Frontend (`MinutesPage.tsx`, `MinutesDetailPage.tsx`,
  `services/api.ts`, `types/minutes.ts`)** — four changes, all read in full:
  1. `minutesService.listAllMinutes()` (new) pages through
     `GET /minutes-records` at the server's own capped page size
     (`limit=100`, matching `minutes.py:63`'s `Query(50, ge=1, le=100)` — the
     client requests the server's max, it does not raise it) until a short
     page ends the loop. Each request is still the existing org-scoped,
     `restricted`-gated query; this changes how many requests the page makes
     to assemble a full list, not what any one request can return. Checked
     against checklist dimension 6 ("no `all()` over an org-wide table"):
     this is **bounded per request** by the backend's own `le=100` cap, and
     the number of requests is bounded by how many minutes records the
     org has — the same shape as any "load all pages" list screen elsewhere
     in this codebase, not a new unbounded-query class. Not a finding.
  2. The meetings list now renders a Link to each meeting's existing
     minutes (joined client-side via the new `meeting_id` field) instead of
     unconditionally offering to create a new set — a correctness/UX fix
     (`create_from_meeting`'s own TOCTOU protection, MM-3's pattern applied
     to a different table, was never at risk here: the backend endpoint
     itself is unchanged).
  3. `MinutesDetailPage.tsx` now hides the "Approve Minutes" button
     client-side when `minutes.submitted_by === currentUserId`, with
     explanatory text. Read directly: this is cosmetic UX matching a control
     the backend already enforces (MM-5's `assert_different_person` call,
     confirmed unchanged below) — the button's removal is not what makes
     self-approval impossible; the server-side check pass 1 already added
     is, and remains, the actual control. Hiding the button only avoids
     presenting a user with an action the server will refuse.
  4. Date-formatting calls switched from raw string slicing / `formatDate`
     to `formatCalendarDate`/`formatTimeOfDay` (timezone-correctness fixes,
     flagged by the diff's own inline comments as W51-4/W51-5/W52-5 —
     cross-referenced against `docs/KNOWN_LIMITATIONS.md`, no entry exists
     under those ids for this feature, and none of the four is a security
     dimension). Not security-relevant.

### Route inventory

Re-enumerated both files top to bottom fresh (not diffed against pass 5's
table): still **17/17** `meetings.py` routes and **25/25** `minutes.py`
routes, **42/42** total, every one carrying `require_permission(...)` with
no bare `get_current_user` and no `.view` permission gating a mutation —
identical in every cell to pass 4/5's published table (reproduced there, not
repeated here; only `minutes.py`'s line numbers are unchanged since pass 5,
as this pass's one `minutes.py` edit is additive and lands after every cited
route). The six `app/mcp/tools/meetings.py` MCP tools (not HTTP routes, so
tracked separately per pass 5's own convention) now each declare a member
`permissions` tuple — see Scope above.

### Confirmed still-intact (re-verified fresh against current code, not cited from prior docs)

- **MM-1 through MM-8, MM-10, MM-11, MM-14, MM-15, MM-16** — every cited
  `assert_in_org` call, `apply_updates` conversion, the dual
  `.with_for_update()` locks in `create_from_event`, the
  `.with_for_update().execution_options(populate_existing=True)` lock in
  `calculate_quorum`, `assert_different_person` in `approve_minutes`
  (`minute_service.py:480`), the `log_audit_event` call on all 42 routes
  (both files), the typed `assigned_to: UUID | None` parameter,
  `sanitize_error_message()` in `create_meeting_from_event`, the frontend's
  `{ event_id: null }` unlink payload, the org filters on
  `attendance_dashboard_service.py`'s waiver-name lookups (now reading
  `.display_name`, still filtered by `organization_id` —
  `attendance_dashboard_service.py:297-313`) and `minute_service.py`'s
  `create_from_meeting` attendee-name lookup (`minute_service.py:941-947`,
  same filter), and `set_meeting_quorum_config`'s `math.isfinite()` +
  type-specific upper-bound validation (`minutes.py:1016-1035`) — all read
  directly at their current locations this pass and found unchanged.
- **LIKE-escaping (Pitfall #25):** every `.ilike()` call across both
  services still builds its pattern through `like_pattern()` and passes
  `escape=LIKE_ESCAPE_CHAR`. No new call site.
- **JSON columns (Pitfall #12):** `minute_service.py`'s `attendees`/
  `sections`/`header_config`/`footer_config` are still always rebuilt from a
  fresh `model_dump()` and reassigned wholesale — re-confirmed in
  `create_minutes`/`update_minutes`, no shallow-copy-then-mutate-nested-key
  pattern.
- **Schema/migration integrity (checklist dimension 7):** every
  `ondelete="SET NULL"` column on `Meeting` (`event_id`, `location_id`),
  `MeetingActionItem` (`created_by`), `MeetingMinutes` (`template_id`,
  `event_id`, `meeting_id`) is still paired with `nullable=True` — re-read
  directly against both model files (`app/models/meeting.py:89-97,244-246`,
  `app/models/minute.py:584-586,628-634`), not sampled.
- **No CSV/spreadsheet export** anywhere in either endpoint file or either
  service (Pitfall #15 n/a; re-grepped for `csv\.`/`StreamingResponse` across
  all four files, zero hits).
- **`minutes.view_executive` tier** — confirmed still does not exist; the
  `restricted` read gate is unchanged in `get_minutes`/`list_minutes`/
  `search_minutes`/`get_stats`. Unchanged in `KNOWN_LIMITATIONS.md`.
- **UNCACHEABLE_PREFIXES:** `/meetings` and `/minutes-records/` both still
  present in `frontend/src/utils/apiCache.ts`.
- **No `window.confirm`/`alert`/`prompt`** anywhere under
  `src/modules/minutes/` or `src/pages/MinutesPage.tsx` (re-grepped fresh,
  including the two new test files).
- **Frontend form-value handling:** no `?? undefined` / `.trim() ?? ` pattern
  in either page, the store, or the new `listAllMinutes()` call (Pitfall #1
  n/a this pass).
- **MM-9 (`approve_meeting`/`update_meeting` — no approval state machine or
  separation of duties) — re-verified still OPEN, unchanged.**
  `MeetingsService.approve_meeting` (`meetings_service.py`, current text
  reproduced below) still sets `APPROVED` unconditionally from any prior
  status with no `submitted_by`/actor comparison:
  ```python
  async def approve_meeting(self, meeting_id, organization_id, approved_by):
      meeting = await self.get_meeting_by_id(meeting_id, organization_id)
      if not meeting:
          return None, "Meeting not found"
      meeting.status = MeetingStatus.APPROVED
      meeting.approved_by = approved_by
      meeting.approved_at = datetime.now(timezone.utc)
      await self.db.commit()
      ...
  ```
  `MeetingUpdate.status` still validates against the full `MeetingStatus`
  enum (including `"approved"`), applied via `apply_updates` with no
  transition check. Re-confirmed the frontend still has no call site for
  `meetingsService.approveMeeting()` (`grep -rn "approveMeeting" src/ | grep
-v services/meetingsServices.ts` → no results). Same product-decision gap
  pass 2/3/4/5 described; still needs an owner decision on whether `Meeting`
  gains its own `submitted_by` + submit step, or a lighter `created_by`-based
  policy is accepted for this record type. **OPEN — no change.**
- **MM-17 (`set_meeting_quorum_config` — no finalization guard on approved
  minutes) — re-verified still OPEN, unchanged.** Read the current endpoint
  in full (`minutes.py:989-1079`): still no `if minutes.status ==
MinutesStatus.APPROVED.value` guard anywhere in the handler, unlike every
  sibling mutation on `MeetingMinutes`. Same disposition as pass 4/5: an
  obvious-looking change that is still a behavior change with no product
  decision yet on whether post-approval quorum correction is a supported
  workflow. **OPEN — no change.**

### New findings

**None.** Every file with a real delta since pass 5 was read in full (see
Scope); none introduces a new auth gap, a missing org filter, a LIKE
pattern, a JSON-column mutation, a missing lock, or a data-exposure issue.
The one substantive security-relevant change (MCP tool permission gating)
is a closed gap, not a new one, and is independently verified by the
existing `tests/test_mcp_member_gating.py` (12/12, re-run this pass).

### Looked at, not a finding — carried forward from pass 5, re-confirmed unchanged

- **`minute_service.get_stats`'s "this month" count still reads the
  server's UTC clock** (`minute_service.py:768-773`, same two-line shape pass
  5 described, now a few lines further down from the unrelated `time`
  import). Still not caught by `tests/test_server_date_ratchet.py`'s
  `.date()`-specific AST detector, for the same reason pass 5 gave. Not fixed
  this pass — dashboard-accuracy class, not one of the seven security
  dimensions, and a behavior change (changes which rows a stat counts).
- **`AttendanceDashboardService.list_waivers`'s per-waiver name lookup is
  still an N+1** (`attendance_dashboard_service.py:296-315`, unchanged
  shape). Bounded by waiver count on one meeting; not attacker-reachable.
- **`AttendanceDashboardService.grant_waiver`'s find-or-create still has no
  lock** (`attendance_dashboard_service.py:230-267`, unchanged). Produces at
  worst a duplicate `MeetingAttendee` row under a two-admin race on the same
  target within milliseconds; a data-integrity blemish, not a security
  bypass.

### Guard tests added

None. No new finding required one this pass. The MCP permission addition
(Scope, above) is already covered by the pre-existing, cross-cutting
`tests/test_mcp_member_gating.py::TestEveryToolDeclaresPermissions` — adding
a feature-scoped duplicate would test the same assertion a second time
rather than closing a new gap. All six prior guard-test files
(`test_meetings_audit_trail.py`, `test_meetings_service.py`,
`test_minute_service.py`, `test_quorum_service.py`,
`test_minutes_quorum_config_validation.py`, and the frontend
`MinutesDetailPage.unlinkEvent.test.tsx`) re-ran clean against current code
(see Completion gate).

## Completion gate (pass 6)

| Check                                                                                   | Result                                                                |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.3.0, CI's pin)                                         | clean (0 violations)                                                  |
| `black --check app/ tests/ alembic/` (26.5.1, CI's pin)                                 | clean (2,027 files unchanged)                                         |
| `isort --check-only app/ tests/ alembic/` (9.0.1, CI's pin)                             | clean                                                                 |
| `python3 scripts/validate_migrations.py --strict`                                       | PASSED — 538 revisions, single head `8c4f2a6e1d93`                    |
| backend tests, scope (`-k "meeting or minute or quorum or attendance_dashboard"`)       | 330 passed, 1 skipped (pre-existing, py_vapid) — up from pass 5's 289 |
| `tests/test_mcp_member_gating.py` (spot-checked given this pass's MCP-permission delta) | 12 passed                                                             |
| `cd frontend && npm run typecheck`                                                      | 0 errors                                                              |
| `cd frontend && npm run lint`                                                           | 0 errors, 0 warnings                                                  |
| `npx vitest run src/modules/minutes`                                                    | 37 passed, 6 files (up from pass 5's 26/4 — two new test files)       |

No source file under this feature's own scope was changed by this pass — the
diff is this findings file and `docs/security-review/PROGRESS.md` (plus, per
Step 0 of the rotation process, the prior iteration's merge-recording edits
to `PROGRESS.md` that ride along on this branch). Every real code delta
since pass 5 was landed by other work and independently re-verified here,
not authored by this pass.

## Pass 7 (2026-10-17)

**Backend, current line counts (all read in full this pass):**
`app/api/v1/endpoints/meetings.py` (623 L, unchanged), `minutes.py` (1,379 L,
was 1,143), `minutes_records.py` (1,366 L — **new file this pass's scope
list, not reviewed by pass 6 at all**), `app/services/meetings_service.py`
(688 L, was 655), `minute_service.py` (1,589 L, was 1,005),
`quorum_service.py` (172 L, was 159), `attendance_dashboard_service.py`
(334 L, was 333 — see Scope), `minutes_signature_service.py` (277 L —
**new**), `minutes_reminder_service.py` (447 L — **new**),
`minutes_record_service.py` (1,355 L — **new**), `minutes_notifications.py`
(186 L — **new**), `app/schemas/minute.py` (1,156 L, was ~900 by line-count
inference), `app/schemas/meetings.py` (228 L, unchanged), `app/models/minute.py`
(1,325 L, was ~700), `app/models/meeting.py` (309 L, unchanged),
`app/utils/minutes_pdf.py` (520 L — grew substantially), `minutes_settings.py`
(171 L), `minutes_snapshot.py` (203 L — new), `minutes_attendance.py` (78 L),
`app/mcp/tools/meetings.py` (727 L, was 712 — still 7 `@logbook_tool`
registrations, no new tool; see Scope).
**Frontend:** `frontend/src/modules/minutes/` in full — 15,318 lines across
40+ source/test files (pass 6 reviewed 4 files). `services/meetingsServices.ts`
no longer exists as a separate path; the module's own `services/api.ts`
calls both `/meetings` and `/minutes-records` (see Route inventory).
**Migrations:** 8 new revisions since pass 6, all under
`backend/alembic/versions/`: `4d8807bdd737` (`documents.under_correction_since`,
reviewed pass 6-adjacent as "MM-17 residual"), `8efc77d4c0c3` (attendance
status settlement + `minutes_action_items`/`minutes_attachments`/
`minutes_election_results`/`minutes_revisions`), `f2c5e55e7dda` (adoption
fields, `minutes_closed_sessions`, `minutes_suggestions`, motion→ballot FK),
`48f403b2631f` (suggestion tracked-change columns), `bb60bd43bede` (motion
section + adoption mover/seconder), `b90813f63e25`
(`last_reminded_at`), `9ce470b513ae` (`votes_recused`/`threshold`/
`roll_call`), `f236c56b1b49` (`minutes_signatures`). Chain validated at 612
revisions, single head.

### Scope — a note on how this delta was established

`git log` on this feature's files since pass 6's cutoff (2026-10-07 14:40
UTC) returns the 19 commits the task brief already enumerated, plus merge
noise. This repository's history contains megacommits with **no parent**
(`git show -s --format="%H %P"` returns an empty parent list — e.g.
`afd68744`, `a5a2890e`), which are grafts from squashed branch merges, not
genuine root commits. A byte-diff against pass 6's reviewed state via its
PR's merge commit was attempted and abandoned: neither `PR #2983`'s merge
commit nor pass 5's `c23c100b4` is reachable as an ancestor of some of these
grafted commits, so `git diff <base>..HEAD` on this file set cannot be
computed reliably. In its place, every file above was **read in full at its
current state** (not diffed), and every one of the 19 commits (plus the two
that only touch migrations/frontend routing,`c1aa8294` and `a5a2890e`'s true
content) was inspected individually with `git show` to attribute each
behavioral change to its actual commit rather than inferred from a diff.
This is slower than a diff-based pass but produces the same guarantee: every
line now in these files has been read by this pass.

**`minutes_records.py` and three of the four "new" services are not actually
new code introduced since pass 6 — they are files pass 6's own scope list
omitted.** `minutes_records.py`'s module docstring ("They share
`/minutes-records` with `minutes.py`") and the fact that both routers are
mounted at the identical `/minutes-records` prefix (`app/api/v1/api.py:358-367`)
show this file already existed and carried real routes (attachments,
election results, revisions, carry-forward) before pass 6 — pass 6's table
claimed "25/25" `minutes.py` routes and never mentions `minutes_records.py`
at all. This pass's enumeration (below) is the first to cover it. Likewise
`c1aa8294` ("meeting attendance dashboard screen") is **frontend-only** — it
adds the `/minutes/attendance` page and route-registry entries for an
endpoint (`GET /meetings/attendance/dashboard`) that already existed and was
already reviewed as "Verified good" in earlier passes; `attendance_dashboard_
service.py`'s one-line growth (333→334 L) is unrelated incidental change, not
new dashboard logic.

**Genuinely new since pass 6, read and reviewed as new surface:** e-signatures
(`minutes_signature_service.py`, `minutes_signatures` table, `SignDialog.tsx`),
motion roll-call/threshold/recusals (`votes_recused`/`threshold`/`roll_call`
columns, `app/utils/motion_votes.py`, `MotionVoteFields.tsx`), action-item
assignment and reminders (`a5a2890e`'s W52-6/7 self-service update path,
`minutes_reminder_service.py`, `last_reminded_at`), review-and-adoption with
member suggestions/tracked changes (`minutes_suggestions` table +
`app/utils/redline.py` apply/compute-changes, `TrackedChanges.tsx`,
`SuggestChangeForm.tsx`), closed sessions (`minutes_closed_sessions` table,
`ClosedSessionsPanel.tsx`), motion-to-ballot links and election results
(`minutes_election_results` table, `ElectionResultsPanel.tsx`), attachments
and revisions (`minutes_attachments`/`minutes_revisions` tables,
`AttachmentsPanel.tsx`, `RevisionsPanel.tsx`), carry-forward
(`CarryForwardDialog.tsx`), outlines (`OutlineEditorModal.tsx`,
`OutlinePickerDialog.tsx`, `OutlinesPage.tsx`), rich-text sections
(`app/utils/rich_text.py`'s `nh3`-based allowlist sanitizer,
`components/ux/RichText.tsx`/`RichTextEditor.tsx`, TipTap), the published-
document correction notice (`66e8c1bd`, already closed as "MM-17 residual"
before this pass), and the quorum-config finalization guard + reopen flow
that this pass confirms **closes MM-17** (see below).

### Route inventory (73/73, re-enumerated top to bottom, not spot-checked)

| File                 | Routes | Auth/permission pattern                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `meetings.py`        | 17     | Every route `require_permission(...)`; reads OR `meetings.view`/`minutes.view`, writes `meetings.manage`. No bare `get_current_user`.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `minutes.py`         | 28     | 27 of 28 `require_permission(...)` (reads `minutes.view`, writes `minutes.manage`). One exception: `PUT /{minutes_id}/action-items/{item_id}` uses `get_current_active_user` with the `minutes.manage` check made **in code** (`can_manage = _has_permission(...)`), documented inline as deliberate (W52-7: the item's own assignee may act without holding the module permission).                                                                                                                                                                   |
| `minutes_records.py` | 28     | 26 of 28 `require_permission(...)` (`minutes.view` for every read, `minutes.manage` for every write — including `sign_minutes`, which additionally requires `minutes.view` **and** the signature slot's own role/permission rule checked in `MinutesSignatureService.can_sign`). Two exceptions, both self-scoped `/mine`-shaped reads: `GET /action-items/mine` (`get_current_active_user`, filtered to `ActionItem.assignee_id == current_user.id` — never another member's items) and the identical pattern is not repeated elsewhere in this file. |

Total: 17 + 28 + 28 = **73 routes**, every one gated by either a permission
string or (for the two self-scoped/assignee exceptions) an explicit,
documented in-code check against the caller's own id. No `.view` permission
gates a mutation; no route is reachable with only `get_current_user`/
`get_current_active_user` and no further check. The 7 MCP tools in
`app/mcp/tools/meetings.py` are unchanged in count and permission tuples
from pass 6 (`("meetings.view", "minutes.view", "meetings.manage",
"minutes.manage")` on all seven) and still hard-code `restricted=True`
regardless of the caller's actual permission level — a deliberate
conservative choice already credited in pass 5/6, re-confirmed unchanged.

### MM-9 — re-verified: now RESOLVED by an owner decision landed outside this rotation

Pass 6 (and 2–5) left MM-9 OPEN: `MeetingsService.approve_meeting` set
`APPROVED` unconditionally from any status with no actor comparison, and
`update_meeting` could flip `status` straight to `approved` via a plain
`PATCH`. Reading the current code (`meetings_service.py:261-292, 310-335`)
finds both gaps closed:

- `approve_meeting` now refuses unless the meeting is `PENDING_APPROVAL`
  (400 `"Only a meeting pending approval can be approved; submit it for
approval first"`, or `"This meeting is already approved"` for a repeat
  call) — `approved_by`/`approved_at` can no longer be silently re-stamped
  or stamped from an unexpected prior state.
- `update_meeting` explicitly rejects a `PATCH` whose `status` would move a
  non-approved meeting to `approved` (400 `"A meeting cannot be marked
approved by editing it; submit it for approval and use Approve instead"`),
  closing the pass-3-identified second path into the same gap. Moving to
  `pending_approval` via `PATCH` is still allowed and **is** the submit step
  (there is no separate `/submit` route for `Meeting`, unlike `MeetingMinutes`).

**Separation of duties was deliberately not added**, per an explicit
in-code comment (`meetings_service.py:319-321`: "approval stays a
single-actor action") — the same officer may still submit and approve a
`Meeting` record, unlike `MeetingMinutes`' `approve_minutes`
(`assert_different_person`). This matches `docs/KNOWN_LIMITATIONS.md`'s MM-9
entry, already updated (2026-10-11) by the commit that made this change,
which this pass independently confirms by reading the live code rather than
trusting that entry's own say-so. **Disposition: RESOLVED** (state-machine
half fixed; separation-of-duties half is a documented, deliberate product
choice, not a gap). No code change needed from this pass.

### MM-17 — re-verified: RESOLVED, and the "MM-17 residual" commit is a separate, narrower fix layered on top

Read `set_meeting_quorum_config` at its current location
(`minutes.py:1210-1317`) in full. The guard pass 6 found missing is present:

```python
if minutes.status == MinutesStatus.APPROVED.value:
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=(
            "Approved minutes are locked. Reopen them to correct the "
            "quorum settings."
        ),
    )
```

This is not an isolated patch: `MinuteService.reopen_minutes`
(`minute_service.py:935-1013`) is the correction path it points to —
`minutes.manage`, a required reason, returns minutes to `DRAFT` with
approval/submission cleared, records the prior approver/time into the
`minutes_reopened` audit event, and (separately) flags the published
document as "Being corrected." Every sibling mutation
(`update_minutes`, `add_motion`/`update_motion`/`delete_motion`,
`add_action_item`/`delete_action_item`, and — new since pass 6 —
`MinutesRecordService._require_editable` used by attachments, election
results, closed sessions and suggestion-apply) enforces the identical
`DRAFT`/`REJECTED`-only rule, so the finalization guard is now the
consistent rule across the whole record, not a one-off fix to the one
endpoint pass 4–6 kept finding unfixed.

**The commit this task brief names, `66e8c1bd` ("MM-17 residual"), is a
different, narrower fix layered on top — not the fix that closes the core
concern.** Reading its diff directly: it touches only `publish_minutes`'
response (`under_correction_since` field) and `reopen_minutes`' stamping of
`documents.under_correction_since` on the already-published document. The
quorum-config guard itself (`"Approved minutes are locked..."`) was
introduced earlier, in the same landing that added `reopen_minutes` and the
state machine generally (first traceable in this history's graph at
`afd68744`, 2026-10-12, which also contains the MM-9 fix above — see Scope
for why this repository's grafted history makes a single attributing commit
hash unreliable to cite as _the_ origin). **Disposition: RESOLVED.** Core
concern (quorum config silently rewritable on an `APPROVED` record) is
closed; the "residual" commit closes a second, cosmetic concern (a stale
published document looking current during a correction) that was never part
of MM-17's own text. `docs/KNOWN_LIMITATIONS.md`'s MM-17 entry already
documents both resolutions accurately and needs no correction.

### New findings from this pass's own review of the new surface

**None confirmed as defects.** Each item below was checked and found to
already follow this codebase's established pattern; recorded here (not as
`MM-18`+) because nothing was found broken, per this file's own convention
of only assigning an id to an actual gap:

- **Motion voting after adoption** (the class MM-17 named as a specific risk
  to check): `update_motion`/`delete_motion`/`add_motion` all reject calls
  on minutes that are not `DRAFT`/`REJECTED` (`minute_service.py:1027-1134`).
  A roll call or recusal count cannot be altered once minutes are approved
  without first reopening — same guard as every other content mutation.
- **Tracked-changes/suggestions applying silent edits to approved minutes:**
  `add_suggestion` only accepts a new suggestion while minutes are
  `SUBMITTED`; `resolve_suggestion` refuses once `APPROVED`;
  `apply_suggestion` (the only call that writes a section) requires
  `DRAFT`/`REJECTED` via `_require_editable` and is gated at
  `minutes.manage` — a plain `minutes.view` holder can only _propose_ and
  never apply. No path writes a section from a suggestion without a
  `minutes.manage` holder's explicit apply call.
- **Action-item self-service update (W52-6/7) as a privilege-escalation
  vector:** `update_action_item`'s `as_assignee` path (i) 404s rather than
  403s on someone else's item (no existence oracle across members), (ii)
  restricts the editable field set to `{"status", "completion_notes"}` via
  `PermissionError` on any other field, and (iii) on `APPROVED` minutes
  additionally intersects with the same allowlist the `minutes.manage` path
  uses — so an assignee cannot use their narrower grant to write a field a
  manager themselves could not write on approved minutes.
- **New-assignee validation (W52-6, MM-4/XC-1 class):** both `add_action_item`
  and `update_action_item` resolve a client-supplied `assignee_id` through
  `_active_assignee_name`, which is a single org + `is_active` filtered
  query — an inactive member or one from another org cannot be assigned, and
  the single query means the error can't be used as an existence oracle
  across the two failure reasons.
- **E-signatures prove identity server-side, not merely client-asserted:**
  `MinutesSignatureService.sign` requires the typed name to match the
  signer's own `full_name`/`display_name` (case/whitespace-insensitive) **and**
  a correct password re-entry (`verify_password` against the stored hash),
  rate-limited at a dedicated `minutes_signing` scope (10/60s, 300s lockout)
  separate from login's budget. A slot's eligibility (`can_sign`) is checked
  before any signature is recorded, and a race for the same slot is caught by
  a DB-level `UniqueConstraint` + `IntegrityError` handler, not a check-then-write
  gap.
- **Closed sessions are compliance metadata, not a confidentiality leak:**
  `MinutesClosedSession`'s fields (`reason`, `legal_basis`, `started_at`/
  `ended_at`, `participants`, `summary` — explicitly documented as "what may
  be said publicly") record _that_ a closed session happened, its stated
  legal basis and who attended — the public-record facts most U.S.
  open-meetings statutes already require a body to state before closing a
  session — not the substantive discussion inside it. No field stores
  closed-session deliberation content. Visibility still follows the parent
  minutes' own visibility rule (`minutes.view` + non-`executive` + `SUBMITTED`/
  `APPROVED` for a restricted caller), so a closed session held during an
  otherwise-public meeting is exactly as visible as the minutes recording it,
  consistent with how open-meetings law treats the fact-of-closure as public
  even when the content is not.
- **Rich-text sections (TipTap) — stored and rendered XSS:** server-side,
  every section write funnels through `app/utils/rich_text.py`'s
  `sanitize_html`/`canonical`, an `nh3` (Rust `ammonia`) allowlist of 11 tags
  and `href`-only links restricted to `http`/`https`/`mailto`, capped at
  100,000 characters. Client-side, `components/ux/RichText.tsx` re-sanitizes
  with DOMPurify before the one `dangerouslySetInnerHTML` in this feature's
  render path, which is explicitly commented as "safe by construction."
  PDF export (`minutes_pdf.py`) escapes every plain field via `html.escape`
  and renders rich-text sections only through the shared sanitizer's
  `_PdfBlocks` mapping to ReportLab-safe inline tags — never raw user HTML.
- **MCP exposure of the new fields:** `app/mcp/tools/meetings.py`'s `_motion()`
  helper (read by both `get_meeting_agenda` and `get_minutes`) exposes
  `votes_for`/`votes_against`/`votes_abstain` but **not** `roll_call` or
  `votes_recused` — an individual member's recorded vote is not surfaced to
  an MCP-connected integration even though it is visible in the web UI to a
  `minutes.manage` holder. A deliberate narrower exposure, not a gap.
- **New migrations (8):** every altered/created table follows
  `_has_table`/`_columns` existence guards (Pitfall #26); every new
  `ondelete="SET NULL"` FK (`meeting_minutes.adopting_minutes_id`,
  `meeting_motions.election_id`, `minutes_action_items.carried_from_id`,
  `minutes_signatures.signer_id`, and the `_user_fk()` helper's columns
  across `minutes_closed_sessions`/`minutes_suggestions`/`minutes_attachments`/
  `minutes_election_results`/`minutes_revisions`) is paired with
  `nullable=True`; every downgrade is symmetric. `8efc77d4c0c3`'s
  `_normalize`/`_settle_attendees` attendee-shape backfill is inlined per
  Pitfall #20 rather than importing the service-layer equivalent.

### Looked at, not a finding — carried forward from pass 5/6, re-confirmed unchanged

- `minute_service.get_stats`'s "this month" count still reads the server's
  UTC clock (now further down the file; same shape, same disposition).
- `AttendanceDashboardService.list_waivers`'s per-waiver name lookup is
  still an N+1, bounded by one meeting's waiver count.
- `AttendanceDashboardService.grant_waiver`'s find-or-create still has no
  lock (duplicate-row race, not a security bypass).

### App-review items re-checked (not this rotation's findings, cited per task brief)

- **MM5-4** (`docs/app-review/meetings-minutes.md`) — section edits
  (`update_minutes`) still replace the whole `sections` array; no `ETag`/
  `updated_at` precondition exists on `PUT /{minutes_id}`. Still open,
  still a correctness/lost-update concern rather than a security one under
  this checklist's seven dimensions (no cross-tenant or privilege angle —
  both editors are already authorized `minutes.manage` holders on the same
  org's record). Left FLAGGED, unchanged, per the task brief's guidance not
  to re-fix an app-review item that is primarily a UX/correctness concern.
- **MM2-3** (LOW, other schemas' `status`/`priority` free strings) — still
  flagged in the app-review doc as needing per-field verification; not
  re-verified field-by-field this pass since it sits outside this rotation's
  scope and was already explicitly deferred as a focused follow-up by the
  app-review track itself.

### Guard tests added

None. No new finding required one. The existing suite already covers this
pass's area of focus: `tests/test_meetings_service.py`,
`test_meetings_audit_trail.py`, `test_minute_service.py`,
`test_quorum_service.py`, `test_minutes_quorum_config_validation.py`, and
(per the 875-test scoped run below) a large body of new tests landed with
the features themselves — e.g. signature flow, suggestion apply-conflict,
closed-session CRUD, carry-forward, reminder classification — all passing
against current code.

### Completion gate (pass 7)

| Check                                                                                                                       | Result                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.3.0, CI's pin)                                                                             | clean (0 violations)                                                                                                                                                                                     |
| `black --check app/ tests/ alembic/` (26.5.1, CI's pin)                                                                     | clean (2,400 files unchanged)                                                                                                                                                                            |
| `isort --check-only app/ tests/ alembic/` (9.0.1, CI's pin)                                                                 | clean                                                                                                                                                                                                    |
| `python3 scripts/validate_migrations.py --strict`                                                                           | PASSED — 612 revisions, single head `c87efd81c5aa`                                                                                                                                                       |
| backend tests, scope (`-k "meeting or minute or quorum or attendance_dashboard or motion or roll_call or election_result"`) | 875 passed, 1 skipped (pre-existing, `pywebpush`) — up from pass 6's 330                                                                                                                                 |
| `python3 scripts/check_route_permissions.py --strict` (dimension-1 cross-check)                                             | 270 routes checked, 0 errors, 0 warnings                                                                                                                                                                 |
| `cd frontend && npm run typecheck`                                                                                          | 0 errors (required `npm ci` from the repo root first — this sandbox's `node_modules` predated the `@tiptap/*` dependencies the rich-text editor added; a bare `npm install` was not used, per CLAUDE.md) |
| `cd frontend && npm run lint`                                                                                               | exit 0                                                                                                                                                                                                   |
| `cd frontend && npx vitest run src/modules/minutes`                                                                         | 337 passed, 40 test files                                                                                                                                                                                |

No source file under this feature's scope was changed by this pass — every
real behavioral delta since pass 6 (the state-machine fixes for MM-9/MM-17,
and all of the genuinely new surface listed under Scope) was landed by other
work and independently re-verified here against all seven `CHECKLIST.md`
dimensions, not authored by this pass. The diff this pass contributes is
this findings file, `docs/security-review/PROGRESS.md`, and
`docs/KNOWN_LIMITATIONS.md` (no change needed there — both entries already
accurately reflect the resolved state, re-confirmed rather than rewritten).

---

## Pass 8 (2026-10-20) — the flaky-test lead was a real bug, found and fixed; two pre-existing races flagged

**Backend:** `app/api/v1/endpoints/meetings.py` (675 L, was 623),
`app/api/v1/endpoints/minutes.py` (1,570 L, was 1,379),
`app/api/v1/endpoints/minutes_records.py` (1,250 L, was 1,366 — net shrink
from extracting `build_print_data`), `app/services/meetings_service.py`
(763 L, was 688), `app/services/minute_service.py` (2,218 L, was 1,589 — the
single largest delta), `app/services/quorum_service.py` (unchanged),
`app/services/attendance_dashboard_service.py` (unchanged),
`app/services/minutes_signature_service.py` (unchanged),
`app/services/minutes_reminder_service.py` (unchanged),
`app/services/minutes_record_service.py` (unchanged),
`app/services/minutes_notifications.py` (unchanged),
`app/models/minute.py`/`app/models/meeting.py`, `app/schemas/minute.py`/
`app/schemas/meetings.py`, `app/mcp/tools/meetings.py` (unchanged),
`app/utils/minutes_pdf.py`, `app/utils/motion_votes.py`, `app/utils/rich_text.py`.
New files read in full: `app/services/agenda_document_access.py`,
`app/services/minutes_publishing_service.py`, `app/utils/minutes_public.py`,
`app/utils/minutes_search.py`, `app/api/public/minutes.py` (the new
unauthenticated surface).
**Frontend:** spot-checked the publishing/attendance-listing/signer settings
panels and the agenda-outline UI named by the delta's commits; not read in
full (see Scope).
**Migrations:** several new revisions since pass 7 for `agenda_items`,
`previous_minutes_id`/`acceptance` on `meeting_motions`,
`attendance_listing`/`published_revision_version`/`published_at` on
`meeting_minutes`, and the new `minutes_public_copies` table. Chain validated
at 631 revisions, single head `ca0c2111466f`.

### Scope

`search_pull_requests`/`list_pull_requests` (state open, head
`claude/security-review-`) returned 0 before starting and again immediately
before pushing — no collision. `git log` against every file this feature
names found pass 7's merge (`97aa9834`) 12 non-merge commits behind `HEAD`,
landing: e-signature-adjacent agenda outlining (`869fa96b`, "agenda items
become the minutes outline"), a crash fix on `Meeting` updates (`54568209`),
public posting of adopted minutes (`f8dd56a1`, "Publish adopted minutes to the
library and a public page"), a department-wide attendance-listing default
(`6e8b82ac`), prepared/previous-minutes motions (`0862bfa2`, "motions prepared
with the minutes; accept previous minutes as submitted or revised"), a
settings-page consolidation (`35b65b34`), a frontend mounting-order bug fix in
the signer panel (`362a57b9`), full-text archive search (`d9f5ebad`), and two
pure-frontend/pure-copy fixes (`0916bf2a`, `2966d7c0`) out of this rotation's
scope. Every substantive file was read in full against its current state
(`minute_service.py` nearly doubled; diffed in sections against pass 7's
reviewed text rather than re-read cold). The two new unauthenticated files
(`app/api/public/minutes.py`, and the service/util pair it depends on) were
read in full since this is the first pass to cover them.

### The flaky-test lead, investigated to a real bug — ✅ FIXED (MM-18)

The task brief's lead was
`tests/test_minutes_prepared_motions_integration.py::TestPreparedMotions::test_removing_the_flag_removes_only_the_unacted_motion`,
reported red once on CI (`got {'adjournment', 'approval_of_previous'}`,
`expected {'adjournment'}`) then green on re-run, with the **same job**
(a different DB-matrix leg) also red on `main` at the commit just before this
feature's own baseline — i.e. not plausibly caused by this feature's own
delta, and not confined to one test-ordering seed.

**Reproduced locally, deterministically reproducible and non-deterministic in
exactly the way CI described.** Running the single test in isolation passed
8/8. Running the whole file under `pytest-randomly`'s default (seeded-but-
varying) ordering failed roughly 1 run in 3 — confirmed over 6 attempts,
matching "flaky under the full file, not under `-k` isolation" exactly.

**Root cause, found by instrumenting `ensure_section_motions` and the two
service methods around it, then removed before committing:**
`MinuteService.ensure_section_motions` finds motions to delete via a **raw**
`select(Motion).where(Motion.minutes_id == minutes.id)` query — not through
the `MeetingMinutes.motions` ORM relationship — and calls
`self.db.delete(stale)` directly on what it finds. SQLAlchemy's cascade
(`cascade="all, delete-orphan"`) removes the row from the database correctly
(confirmed with a throwaway post-commit query inside the instrumented code: the
DELETE lands every single time), **but it does not update an already-loaded
`minutes.motions` Python collection**, because the delete never went through
that collection. If `.motions` had already been eagerly loaded on this same
`MeetingMinutes` object earlier in the **same request** — which happens on
every `PUT /minutes/{id}` call, since `update_minutes`'s own leading
`get_minutes()` fetch always eager-loads it — the stale, now-deleted `Motion`
instance keeps sitting in that in-memory list for the rest of the object's
life in the session's identity map.

Two distinct symptoms follow from this one cause:

1. **Deterministic, every time, within the one request:** `update_minutes`'s
   endpoint (`PUT /minutes/{id}`) returns `await _respond(db, current_user,
minutes)` built from that **same** `minutes` object — so the PUT's own
   response body lists the just-deleted motion, in the same response that
   reports 200 OK. The test never checked this (only the status code), which
   is why it alone never caught the defect in six passes of this feature's own
   review.
2. **Non-deterministic, GC-timing dependent, across the test's own two
   separate GET requests:** whether the test's _later_, separate
   `GET /minutes/{id}` call sees the same stale object (and therefore the
   same stale answer) or a freshly-loaded one depends on whether CPython's
   garbage collector had already reclaimed the first object by the time that
   request ran — nothing else in the test holds a reference to it. That is
   exactly the kind of timing CPython does not guarantee, which is why the
   test's own assertion (built on the second symptom, not the first) is
   flaky rather than reliably red or green, and why it was equally flaky on
   `main` before this feature's own delta: `ensure_section_motions` and this
   calling shape both predate this pass's work, and the test itself was the
   only thing that happened to be watching for it.

This is a genuine application-defect, not a test-infrastructure artifact
("just a flake" is explicitly ruled out): a secretary unchecking "needs a
motion" on a section with an unacted prepared motion gets back a 200 response
that still lists that motion as present, from the same call that deleted it.
A frontend that trusts the mutation response to update its own state (a common
SPA pattern, and the one `MinutesDetailPage.tsx` otherwise follows for every
other field on this same endpoint) would show a motion that no longer exists
until the page is reloaded.

**Where:** `app/services/minute_service.py`, `ensure_section_motions`.
**Fix:** after queuing the delete, also remove `stale` from
`minutes.motions` **if that collection is already loaded** (checked via
`sqlalchemy.inspect(minutes).attrs.motions.loaded_value`, which returns the
live `InstrumentedList` without triggering a lazy load when it is _not_
loaded — the two cases this bug conflated are now handled explicitly instead
of left to accident). This keeps the in-memory collection consistent with the
database for the rest of the request regardless of what loaded it or when.
Every other call site of `ensure_section_motions` (`update_minutes`,
`recall_minutes`, `apply_outline`, `sync_agenda`'s apply path, and the one
inside `create_minutes` itself) is covered by this single fix, since it is
the one place the delete happens.

**Verification:** 25 consecutive full-file runs under `pytest-randomly`'s
default ordering passed 25/25 after the fix (0/6 clean before it, matching
CI's own report of an intermittent failure). A new guard test (below) makes
the deterministic half of the bug (symptom 1) fail every time without relying
on GC timing, so the fix does not depend on the flake continuing to be
reproducible to stay caught.

### MM-18 — MED — `ensure_section_motions`'s raw-query delete left a stale motion in the same request's own response — ✅ FIXED

**What/Where/Fix:** as described above.
**Failure scenario:** `PUT /minutes/{id}` with a `sections` payload that turns
off `needs_motion` on a section whose prepared motion is still `pending`
returns 200 with that motion still present in the response body's `motions`
list, even though the row was deleted from the database by the same call.
**Impact:** a correctness/data-integrity defect confined to the acting
session's own request/response; not a cross-tenant or authorization issue (no
other organization's data is involved, and the caller already holds
`minutes.manage` on this exact record). Severity is MED rather than LOW
because the staleness is not cosmetic — it can mislead a client that trusts
the mutation response, and it was concretely responsible for the intermittent
CI failures on `main`, i.e. it already had an observable production-adjacent
blast radius before this pass.

### MM-19 — LOW — the same method's find-or-create for a new prepared motion has no lock — ✅ FIXED 2026-10-25

Fixed owner-directed: `ensure_section_motions` locks the minutes row, then
reads the motions with a locking read (pitfall #27);
`test_minutes_find_or_create_race.py`. Original finding below.

**What:** `ensure_section_motions`'s loop over `wanted.items()` does a
plain `select` to check whether a section's motion already exists
(`by_section.get(key)`) and, if not, `self.db.add(Motion(...))`. There is no
`.with_for_update()` on the `MeetingMinutes` row and no unique constraint on
`(minutes_id, section_key)`. Two `minutes.manage` holders racing a save on the
same draft's `sections` (e.g. one toggling `needs_motion` on while the other
applies an agenda sync) within the same instant could each see "no motion for
this section yet" and both insert one.
**Where:** `app/services/minute_service.py`, `ensure_section_motions`
(the `for key, section in wanted.items():` loop).
**Why flagged, not fixed:** the same Pitfall #27 shape as
`AttendanceDashboardService.grant_waiver`'s unlocked find-or-create (pass 5's
"Looked at, not a finding" note, never promoted to a tracked id because the
consequence there is a duplicate attendance row, not a security bypass).
Here the consequence is a duplicate **pending** motion for one section — a
cosmetic double entry a secretary would notice and could delete, not a
tenant-isolation or privilege gap, and not reachable without two people
editing the exact same draft within milliseconds of each other. Consistent
with this project's own precedent for this exact shape (pass 5's note, and
CLAUDE.md Pitfall #27's own text acknowledging lock-free find-or-create as a
data-integrity rather than security concern when nothing it protects is a
capacity cap or a security decision), left open rather than adding a lock
this pass did not have a reason to add elsewhere in the same method.

### MM-20 — LOW — `MinutesPublishingService._post_public`'s find-or-create for the public copy has no lock — ✅ FIXED 2026-10-25

Fixed owner-directed: `_post_public` locks the minutes row and reads the copy
with a locking read, so a second publish replaces the first's copy instead of
failing on the unique key; `test_minutes_find_or_create_race.py`. Original
finding below.

**What:** `_post_public` looks up an existing `MinutesPublicCopy` by
`minutes_id` (`_copy_for`), and either updates it or inserts a new one. No
locking read, but `MinutesPublicCopy.minutes_id` **does** carry a DB-level
`unique=True` constraint (confirmed in `app/models/minute.py`) — so unlike
MM-19, a genuine race cannot silently duplicate the row; the loser's `INSERT`
raises `IntegrityError`.
**Where:** `app/services/minutes_publishing_service.py`, `_post_public`/
`_copy_for`.
**Failure scenario:** two `minutes.manage` holders both click "Publish" on
the same minutes within the same instant; one succeeds, the other's `commit()`
raises an unhandled `IntegrityError`, surfacing as a plain 500 (caught only by
the app's generic exception handler, which sanitizes the message — no
information disclosure) rather than a clean "already published, try again"
response.
**Why flagged, not fixed:** the database already prevents the corrupted state
a lock would prevent; what is missing is a graceful retry/message, a UX
polish rather than a security or data-integrity gap, and distinct enough from
MM-19's shape (no unique constraint there) that folding them into one fix
would have papered over the difference. Left open for a future pass with a
reason to touch this method.

### Verified good ✅ (pass 8 additions, beyond what pass 7 already re-confirmed)

- **The new public, unauthenticated surface (`app/api/public/minutes.py`) is
  properly gated for what it is.** Rate-limited at 60/min per IP
  (`_rate_limit_minutes`, the same `public_rate_limit` helper other public
  routes use); fails closed to 404 on any deployment with other than exactly
  one organization (`_the_organization`, the same pattern the public legal-text
  endpoint already uses, re-read directly rather than trusted from its own
  comment); fails closed again if the `minutes` module is disabled for that
  org; `Cache-Control: no-store` on both responses so a withdrawal or a
  settings flip takes effect immediately rather than being served stale from a
  shared cache; `list_public`/`get_public` both **re-check** the department's
  publishing settings on every read (`_servable`), not only at post time, so
  switching public posting off takes the page down at once.
- **Executive-session minutes need all three settings, not a bypassable one.**
  `MinutesPublishingSettings.public_allowed` requires `public_posting` **and**
  both `executive_library`/`executive_public` for an executive meeting type;
  all three default to `False` (fail closed) when unset, confirmed in
  `minutes_publishing_settings_in`. `MinutesPublishingService.publish` also
  independently checks `library_allowed` before the library copy is even filed,
  so a public copy of an executive set cannot exist without the library copy
  first being permitted.
- **The public copy's content is built by naming every field that may leave,
  not by redacting a superset.** `app/utils/minutes_public.narrow_for_public`
  never touches its input in place; it constructs a new dict field by field
  (attendance counts and officers-present only, never the full roll; motion
  wording/mover/seconder/totals/result, never individual votes or discussion
  notes; closed-session metadata only, never the summary or participant list;
  election tallies, never voter-level detail; no attachments, no library
  links). This is a stricter cut than the PDF export's own data, by design,
  confirmed by reading the module's own docstring against its code, field by
  field, not merely trusting the comment.
- **Document links on an agenda item are validated in-org and per-viewer, not
  merely in-org (XC-1 plus a second, narrower check).**
  `MeetingsService.settle_agenda_items` resolves a client-supplied document id
  via an org-scoped query **and** `DocumentsService.can_access_document`
  against the _linking_ user's own folder permissions before it is stored;
  `app/services/agenda_document_access.narrow_documents` then re-checks every
  stored reference against the _reading_ user's own access on every response
  that carries one (`meetings.py`'s list/get/create/update routes and
  `minutes.py`'s `_respond`), so a member who can read the meeting but not a
  leadership-only folder never sees that file's name. `can_access_document`
  fails closed on an unresolvable folder (confirmed at
  `documents_service.py:651-654`).
- **The previous-minutes link and the later adoption-proposal lookup are both
  resolved by the server, in-org, never by a client-supplied id** — re-read
  `_previous_minutes` and `adoption_proposal` directly (new since pass 7;
  neither existed in the version that file reviewed): both filter
  `MeetingMinutes.organization_id`/join through it, and `previous_minutes_id`
  on a `Motion` is only ever set by `ensure_section_motions`'s own server-side
  lookup, never accepted from a request body (`MotionCreate`/`MotionUpdate`
  carry no such field — confirmed by reading both schemas).
- **`GET /minutes/{id}/adoption-proposal` requires `minutes.manage`, not
  merely `minutes.view`**, and 404s (not 403s) for another organization's
  minutes id — re-verified directly against `TestAdoptionProposal`'s own test
  suite (`test_a_member_cannot_read_one` → 403, `test_another_department_
cannot_read_a_proposal` → 404), which this pass ran rather than merely read.
- **The second-approver rule (MM-5's `assert_different_person`, pass 1) now
  also covers the new previous-minutes acceptance path**: `approve_minutes`
  still rejects the officer who submitted the minutes from being the one who
  confirms the proposed adoption (`TestAdoptionProposal::
test_the_officer_who_circulated_still_cannot_adopt_them`, read and run, not
  merely cited).
- **`search_archive`'s matching is Python-side `re`, not SQL `LIKE`, and is
  safe on both counts that matter for that shape.** Every term is
  `re.escape()`-d before being compiled (`app/utils/minutes_search.py:
compile_terms`) — no regex-injection surface — and the term count/length are
  capped (`MAX_TERMS=8`, `MAX_QUERY_LENGTH=200`, `MIN_TERM_LENGTH=2`) before
  any pattern is compiled, so a hostile query cannot build a catastrophic-
  backtracking pattern from unbounded input. The underlying row scan is
  capped at `ARCHIVE_SCAN_LIMIT=500` and eager-loads motions/action items in
  the same query (no N+1), and still applies the same `restricted`/
  `member_visible_conditions()` gate as `list_minutes`/`search_minutes` when
  the caller lacks `minutes.manage`.
- **The settings this pass's new UI writes (`public_posting`,
  `executive_library_publishing`, `executive_public_posting`,
  `attendance_listing`) go through the organization-settings endpoint's
  existing `copy.deepcopy()` + deep-merge path**
  (`OrganizationService.update_organization_settings`), not a new ad-hoc
  writer — re-read that method directly to confirm the Pitfall #12 deep-copy
  and the ORU-9 deep-merge are both still in place and apply to this new
  `"minutes"` settings section exactly as they do to every other section. The
  write is gated on `settings.manage`/`organization.update_settings` (not
  `minutes.manage`), matching the frontend's own `canEdit` check
  (`checkPermission('settings.manage') || checkPermission('organization.update_settings')`)
  — a secretary cannot unilaterally turn on public posting of executive
  minutes.
- **No `window.confirm`/`alert`/`prompt` in the new frontend.** The one
  genuinely consequential toggle this pass adds — allowing executive-session
  minutes onto the public page — is gated behind `useConfirm()`
  (`PublishingSettingsPanel.tsx`), with the dialog's body naming the actual
  consequence ("anyone who has already read it keeps what they read") rather
  than a generic yes/no.
- **No new CSV/spreadsheet export.** Grepped `csv\.`/`StreamingResponse`
  across every file this pass added or touched: zero hits, same disposition
  as every prior pass.
- **E-signatures (`minutes_signature_service.py`) are byte-identical to pass
  7's reviewed state** — confirmed via `git diff`, not re-read in full a
  second time, since nothing in this delta touches that file.

### Not re-derived, re-confirmed from pass 7 by reading the current code at its cited line

MM-1 through MM-17, the 73-route inventory's permission/org-scoping pattern,
the LIKE-escaping convention, JSON-column handling, and the `minutes.view_
executive` tier's continued absence — all re-checked at their current
locations (several shifted by this pass's line-count growth) and found
unchanged. Not reproduced verbatim a second time; see pass 7's own "Confirmed
still-intact" section for the full list this pass re-verified rather than
re-derived.

### Guard tests added

- `backend/tests/test_minutes_prepared_motions_integration.py::
TestPreparedMotions::test_the_update_response_itself_drops_the_removed_motion`
  (new) — asserts the **PUT `/minutes/{id}` response body itself** (not a
  separate, later GET) no longer lists a motion `ensure_section_motions` just
  deleted, after that same request's own `get_minutes()` call has already
  eager-loaded `minutes.motions`. This is the deterministic half of MM-18
  (symptom 1 above), so it fails every time against the unfixed code rather
  than depending on the GC-timing race that made the original test flaky.
  Verified to fail 3/3 against the code as it stood before this pass's fix
  (reverted locally and re-run), and to pass 8/8 after it. The original
  flaky test itself was also re-run 25 times under `pytest-randomly`'s
  default ordering after the fix (0 failures), up from failing roughly 1 run
  in 3 before it.

## Completion gate (pass 8)

| Check                                                      | Result                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                              | clean (0 violations)                                                                  |
| `black --check app/ tests/ alembic/`                       | clean (2,476 files unchanged)                                                         |
| `isort --check-only app/ tests/ alembic/`                  | clean (one import reordered by this pass's own edit; `isort` applied and re-verified) |
| `python3 scripts/validate_migrations.py --strict`          | PASSED — 631 revisions, single head `ca0c2111466f`                                    |
| backend tests, scope (`-k "meeting or minutes or motion"`) | 1,061 passed, 1 skipped (pre-existing, `pywebpush`)                                   |
| `cd frontend && npm run typecheck`                         | 0 errors                                                                              |
| `cd frontend && npm run lint`                              | 0 errors, 0 warnings                                                                  |

Only one backend file carries a behavior change this pass
(`app/services/minute_service.py`, the MM-18 fix); the guard test above lives
in its own existing integration-test file. No frontend file was touched, so
`npm run lint`/`typecheck` re-confirm a clean baseline rather than check new
code.

---

## Pass 9 (2026-10-24) — watchdog pickup, 0 fixes, 0 new findings; MM-19/MM-20 re-confirmed OPEN

This iteration is a watchdog pickup for `/loop 30m /security-review`: the
dedicated loop session was not reachable, and `list_pull_requests`/a
`claude/security-review-*` head search both returned no open security-review PR
before starting, and again immediately before pushing (no collision; also
confirmed `git ls-remote origin 'refs/heads/claude/security-review-meetings*'`
had nothing live — every prior pass's branch was deleted on merge).

**Backend, re-read in full against current `origin/main`:**
`app/api/v1/endpoints/meetings.py` (682 L, was 675), `app/api/v1/endpoints/minutes.py`
(1,574 L, was 1,570), `app/api/v1/endpoints/minutes_records.py` (1,250 L,
unchanged), `app/services/meetings_service.py` (782 L, was 763),
`app/services/minute_service.py` (2,288 L, was 2,218),
`app/services/quorum_service.py` (172 L, was unchanged until this delta — see
below), `app/services/attendance_dashboard_service.py` (339 L, was unchanged
until this delta), `app/services/minutes_signature_service.py`,
`app/services/minutes_reminder_service.py`, `app/services/minutes_record_service.py`
(1,352 L, was 1,250), `app/services/minutes_notifications.py`,
`app/services/minutes_publishing_service.py` (unchanged),
`app/services/agenda_document_access.py` (unchanged),
`app/utils/minutes_pdf.py`/`motion_votes.py`/`rich_text.py`/`minutes_public.py`
(unchanged)/`minutes_search.py` (unchanged), `app/api/public/minutes.py`
(unchanged), `app/models/meeting.py`/`app/models/minute.py`,
`app/schemas/meetings.py`/`app/schemas/minute.py`, `app/mcp/tools/meetings.py`
(unchanged, confirmed via `git log` rather than trusted from pass 8's note).
New file read in full: `app/services/minutes_election_filing.py`.
**Frontend:** `frontend/src/modules/minutes/pages/MinutesPage.tsx` (the only
module file with a substantive diff this delta — delete-outcome/confirm-dialog
changes), spot-checked the rest via `git log` (only a11y/copy-only diffs since
pass 8, no logic change).
**Migrations:** none new under `backend/alembic/versions/` touch
`meetings`/`meeting_minutes`/`meeting_action_items`/`minutes_*`/
`minutes_election_results` since pass 8's head (`ca0c2111466f`). Chain
re-validated at 649 revisions, single head `a0195b397bf3`.

### Scope

`git log d4fd563e7..origin/main` (pass 8's merge commit to current `main`)
against every file this feature names surfaced 9 non-merge commits with a real
backend diff, all read in full rather than trusted from their commit
summaries, plus several pure frontend a11y/copy commits and merge noise
excluded as out of scope:

- `8c504336e` — "refuse approved-meeting delete": `delete_meeting` now raises
  `MeetingDeleteRefusedError` (409) for a meeting in `APPROVED` status,
  surfaced via an `X-Delete-Outcome` header the frontend reads. Re-verified
  `get_meeting_by_id(meeting_id, organization_id)` still gates the fetch
  (XC-3 intact) before the status check.
- `f5ddf81bf` — "governance and finance deletes": `delete_minutes` now also
  (a) reopens any carried-forward action item whose _copy_ is about to be
  deleted (`_release_carried_sources`, org-scoped via a `MeetingMinutes.id`
  subquery filtered on `organization_id` — re-verified directly, not merely
  cited) and (b) deletes the minutes' attachment files from storage only
  _after_ the row-delete commits (so a rolled-back delete keeps its files).
  Separately, `documents_service.py`'s delete path now clears
  `MeetingMinutes.published_document_id`/`published_revision_version`/
  `published_at` when the library document it pointed at is deleted — an
  `UPDATE ... WHERE organization_id = :org AND published_document_id IN
(:ids)` (org-scoped, confirmed) rather than a bare FK, since that column is
  deliberately not a real foreign key (see the model's own docstring).
- `911a111d1` — "file a closed election's result with its meeting's minutes
  automatically": new `app/services/minutes_election_filing.py`, called from
  `ElectionService.close_election` (after commit, never allowed to fail the
  close) and from `MinuteService.create_minutes`/`create_from_meeting` (after
  commit). Re-verified: both entry points resolve the target minutes/elections
  through `organization_id`-filtered queries; the actual write goes through
  the existing `MinutesRecordService.capture_election_result`, which itself
  calls `assert_in_org` on the client-reachable `election_id` (XC-1) and locks
  the minutes row (`lock_minutes`, `.with_for_update()`) before its
  check-then-insert — and `MinutesElectionResult` carries a DB-level
  `UniqueConstraint("minutes_id", "election_id")`
  (`uq_minutes_election_results_pair`, confirmed in `app/models/minute.py`),
  so a race between the automatic filing and a manager's manual import (or two
  automatic triggers) cannot double-file; the loser's `IntegrityError` is
  caught by `_file`'s own `except Exception` and logged, never raised into the
  election-close or minutes-create transaction. A department can disable the
  behavior (`auto_file_election_results`, read through the same
  `OrganizationService.update_organization_settings` deep-merge/deep-copy path
  pass 8 already verified for this settings section, gated on
  `settings.manage`/`organization.update_settings`, not `minutes.manage`).
- `746382501` — "bound every numeric request field to its column range":
  `SectionEntry.order`/`TemplateSectionEntry.order`/`MotionBase.votes_*`/
  `MotionCreate.order`/`MotionUpdate.votes_*`/`order`/`MinutesBase.quorum_count`/
  `MinutesUpdate.quorum_count` all gained `le=INT32_MAX`. Does not touch
  `set_meeting_quorum_config`'s `quorum_threshold` query parameter, which
  already carries its own `math.isfinite()` + percentage/count bound from
  MM-15 (re-read directly at `minutes.py:1409-1454`, unchanged and still
  correct).
- `9b1b17226`/`3561ed0c4` — UTC-instant storage for `meeting_date`/
  `called_to_order_at`/`adjourned_at`/`MinutesAdopt.adopted_on`/closed-session
  timestamps, and a due-date display fix. Correctness/timezone fixes with no
  authorization or tenancy surface; not re-derived in detail since neither
  touches an auth, permission or org-scoping path.
- `8a57d0699` — "count a probationary account as a current member at every
  status gate" (CLAUDE.md Pitfall #32): `attendance_dashboard_service.py`'s
  member list and `quorum_service.py`'s quorum denominator both switched
  `User.status == UserStatus.ACTIVE` to `User.status.in_(ACTIVE_ACCOUNT_STATUSES)`.
  Re-swept both files plus `meetings_service.py`/`minute_service.py`/
  `meetings.py`/`minutes.py`/`minutes_records.py` for any remaining literal
  `UserStatus.ACTIVE`/`"active"` comparison: zero hits — the sweep's own
  repo-wide guard test (`tests/test_account_status_gates.py`) also passed.
  This closes a real gap this feature had before today: a probationary member
  was previously excluded from the quorum denominator and the attendance
  dashboard's roster, which could make quorum appear met on a smaller
  department-recognized body than actually existed, or vice-versa undercount
  who needed to be marked present. Filed as a fix of a cross-cutting sweep
  landed outside this rotation, not as a new `MM-` id, per this file's own
  convention of assigning ids only to gaps this rotation itself finds and
  fixes/flags — recorded here because it is new, genuine, and in scope.
- `b92da7f3a` — "route every stored-file read/check/delete through one
  interface": `minute_service.py`'s attachment-file cleanup on
  `delete_minutes` and `minutes_record_service.py`'s attachment download/
  delete now call `file_storage.delete_quietly`/`file_storage.exists`/
  `file_storage.file_response` instead of raw `os`/a private `remove_quietly`
  shim. `file_storage.resolve()` (unchanged, re-read) remains fail-closed:
  non-string/missing-org input returns `None`, and a resolved real path must
  start with `<root>/<org>/<area>/` (symlinks and `..` included, compared on
  the real path) or it is refused — confirmed this still gates both call
  sites in this feature before any delete or serve.
- `d6233224890` — "return the refreshed minutes after a prepared motion is
  removed": extends MM-18's `refresh=True` fix (pass 8) to two more response
  paths (`apply_outline`, `apply_agenda_sync`'s section-save) that call
  `ensure_section_motions` and previously returned the stale, pre-refresh
  object. Same class as MM-18, same fix shape, landed by other work and
  independently verified here rather than authored by this pass.

No new route was added by any of the above (confirmed by AST-enumerating both
endpoint files and `minutes_records.py`/`app/api/public/minutes.py` from
scratch — 17 + 32 + 30 + 2 = 81 routes total, matching the current count with
no gap against the files' own route count from pass 8's description of this
same surface). Every route still carries either `require_permission(...)` or,
for the two deliberate self-scoped exceptions already audited in pass 7/8
(`PUT /minutes/{id}/action-items/{item_id}`'s `as_assignee` path and
`GET /minutes/action-items/mine`), `get_current_active_user` with the
narrower check made in the handler body or filtered to the caller's own id —
re-verified both are unchanged at their current line.

### New findings

**None.** Nothing in the reviewed delta introduces a cross-tenant,
authorization, injection, or data-exposure gap; every new or changed code path
above follows this codebase's already-established pattern for its class
(org-scoped by-id fetch, `assert_in_org` on a client-supplied FK, a DB unique
constraint backing a "never twice" claim, `.with_for_update()` before a
check-then-write, `file_storage.resolve()` before any filesystem operation).

### Confirmed still open, unchanged

- **MM-19** (`ensure_section_motions`'s find-or-create for a new prepared
  motion has no lock) — re-read at its current location in
  `minute_service.py`; unchanged, still no `.with_for_update()` and no unique
  constraint on `(minutes_id, section_key)`. Still LOW per pass 8's own
  reasoning (a cosmetic duplicate-motion race, not a tenancy or privilege
  gap). **OPEN.**
- **MM-20** (`MinutesPublishingService._post_public`'s find-or-create has no
  lock) — `minutes_publishing_service.py` is byte-identical to pass 8
  (confirmed via `git log`, not re-read cold); the DB-level
  `unique=True` on `MinutesPublicCopy.minutes_id` still backs the no-silent-
  duplicate claim pass 8 verified. **OPEN.**
- **MM5-4** (app-review; no `ETag`/`updated_at` precondition on
  `PUT /minutes/{minutes_id}`, two editors silently overwrite each other's
  sections) — unchanged, still a correctness/lost-update concern rather than
  a cross-tenant or privilege one under this checklist's seven dimensions.
  Left FLAGGED per the same disposition as every prior pass.
- Carried-forward "looked at, not a finding" items from passes 5-8
  (`get_stats`'s UTC-clock "this month" count, `list_waivers`'s per-waiver
  N+1, `grant_waiver`'s unlocked find-or-create) — none of the files
  involved changed this delta; not re-investigated beyond confirming no
  commit touched them.

`docs/KNOWN_LIMITATIONS.md`'s MM-9, MM-17, MM-19 and MM-20 entries were
re-read against current code and all four still accurately describe the
present state (MM-9/MM-17 resolved, MM-19/MM-20 open) — no edit needed.

### Guard tests added

None. No new finding required one; the existing suite (notably
`tests/test_minutes_election_autofile_integration.py`, 270 L added by
`911a111d1` itself, and `tests/test_account_status_gates.py` for the
Pitfall #32 sweep) already covers this pass's reviewed delta.

### Completion gate (pass 9)

| Check                                                                                                                                                   | Result                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.3.0, CI's pin)                                                                                                         | clean (0 violations)                                |
| `black --check app/ tests/ alembic/` (26.5.1, CI's pin)                                                                                                 | clean (2,606 files unchanged)                       |
| `isort --check-only app/ tests/ alembic/` (9.0.1, CI's pin)                                                                                             | clean                                               |
| `python3 scripts/validate_migrations.py --strict`                                                                                                       | PASSED — 649 revisions, single head `a0195b397bf3`  |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                                                                                       | 273 routes checked, 0 errors, 0 warnings            |
| backend tests, scope (`-k "meeting or minute or motion or quorum or attendance_dashboard"`)                                                             | 1,200 passed, 1 skipped (pre-existing, `pywebpush`) |
| backend tests, cross-cutting guards (`test_org_scoping_ratchet`, `test_endpoint_auth_coverage`, `test_account_status_gates`, `test_storage_operations`) | 35 passed                                           |
| `cd frontend && npm run typecheck`                                                                                                                      | 0 errors                                            |
| `cd frontend && npm run lint`                                                                                                                           | 0 errors, 0 warnings (`--max-warnings 10`)          |

No source file under this feature's scope was changed by this pass — every
behavioral delta since pass 8 was landed by other work (the deletion-refusal,
election-auto-filing, numeric-bounds, UTC-timestamp, probationary-status and
storage-interface changes listed under Scope) and independently re-verified
here against all seven `CHECKLIST.md` dimensions, not authored by this pass.
The diff this pass contributes is this findings file, `docs/security-review/PROGRESS.md`
and the header line's PR-link backfill for pass 8 (`#3456`, found via
`search_pull_requests` and not previously linked in this file) — no code
change.

## Pass 10 (2026-10-27) — watchdog pickup, 0 fixed by this pass, MM-19/MM-20 both found already resolved by other work; 0 new findings

Watchdog pickup for `/loop 30m /security-review`: the dedicated loop session
(`session_011T1ZyyLrD5HagusgK9uDw2`) was unreachable. `list_pull_requests`
(state=open) and a fresh `search_pull_requests` for
`head:claude/security-review-` both returned no match before starting, so no
other rotation PR was in flight. PR #3766 (Feature 23, Medical supplies, pass 17) had already merged on `main`; row 24 (Meetings & minutes) was confirmed
the next `⬜` row in the rotation table read directly off a freshly fetched
`main`. **Branch name avoids reuse** (CLAUDE.md Pitfall #24): the bare
`claude/security-review-meetings-minutes` name was used and merged twice
before (passes 1/2 and pass 6), so this pass's branch carries a `-p10` suffix,
confirmed unused for this feature by `search_pull_requests` and by
`git ls-remote origin` returning nothing for any `*security-review-meetings*`
ref.

**Baseline:** pass 9's merge, `53779a30` (PR #3636). `git log 53779a30..origin/main`
against every file this feature declares (both endpoint files, `minutes_records.py`,
`api/public/minutes.py`, all nine `meetings`/`minutes`/`quorum`/`attendance`
service files, the models, the schemas, `app/mcp/tools/meetings.py`, and
`frontend/src/modules/minutes`) over 376 non-merge commits on `main` in that
window surfaced exactly **2** commits with a real diff in scope, both read in
full:

- `2cb6c029` ("Serialize the two minutes find-or-creates on the minutes row")
  — lands **outside this rotation**, from a different session
  (`session_01V3sx5bNDnFJ6AMSSb6sBDh`, 2026-10-25), but fixes exactly the two
  findings pass 8/9 left flagged OPEN:
  - **MM-19** (`MinuteService.ensure_section_motions`'s find-or-create for a
    section's prepared motion had no lock): now takes a locking read on the
    `MeetingMinutes` row (`select(MeetingMinutes.id)...with_for_update()`)
    before a locking read of the section's `Motion` rows
    (`minute_service.py`, current `ensure_section_motions`). Verified this is
    pitfall #27's full two-part shape, not just a row lock: the motion read
    itself also carries `.with_for_update()`, so a transaction that waited on
    the minutes-row lock sees the motion the other transaction committed
    while it waited, rather than the plain-SELECT snapshot it opened with.
  - **MM-20** (`MinutesPublishingService._post_public`'s find-or-create for
    the one public copy had no lock, so the loser of two concurrent publishes
    failed its commit on `MinutesPublicCopy.minutes_id`'s unique constraint —
    a 500): now locks the minutes row first, then re-reads the copy via
    `_copy_for(..., for_update=True)`, which adds `.with_for_update()` +
    `execution_options(populate_existing=True)` — the `populate_existing`
    half matters: without it, a copy already in the session's identity map
    from the plain read earlier in the same request would be returned
    unchanged even though the locking read re-fetched a possibly-different
    committed row. Confirmed by reading `_copy_for`'s diff directly, not
    inferred from the commit message.
  - Both fixes are backed by a new `tests/test_minutes_find_or_create_race.py`
    (243 lines, real `database_manager.engine` connections rather than the
    `db_session` fixture — a lock-contention test needs two actual
    transactions, which an auto-rolled-back single-connection fixture cannot
    produce). Ran it directly rather than trusting the commit message: **2
    passed** (`pytest tests/test_minutes_find_or_create_race.py -q`, 1.1s;
    marked `integration`, consistent with Pitfall #30b). The commit message
    states the race tests were seen to fail against the pre-fix code
    (Pitfall #37); not independently re-verified against a reverted tree this
    pass, since the fix is already merged on `main` and reverting it to
    reproduce the red state would itself be a destructive, unrequested
    change — the test's own docstring and the lock-then-locking-read shape
    are enough to re-derive why the old code could race.
  - The same commit also updated `docs/KNOWN_LIMITATIONS.md`'s MM-19/MM-20
    entries to "Resolved" stubs (kept only because tests/code still cite the
    ids by name) and this findings file's own `docs/security-review/MM-24-meetings-minutes.md`
    note — both re-read directly against current content and confirmed
    accurate; no further edit needed from this pass beyond recording the
    disposition change here.
- `ce9520e8` ("Show status words, not stored codes, on nine more screens") —
  a cross-feature cosmetic sweep (also touches Training, Applicants, Skills
  testing); this feature's slice is `MyActionItemsPanel.tsx` and
  `MinutesDetailPage.tsx`, which now call a new
  `frontend/src/modules/minutes/utils/actionItemStatus.ts` instead of
  `item.status.replace('_', ' ')` so `in_progress`/`overdue` read as "In
  progress"/"Overdue" instead of "in progress"/"overdue" with the rest of the
  underscore left in for anything with two. Display-only — no new network
  call, no changed permission or org-scoping path, no user-controlled string
  reaches `dangerouslySetInnerHTML` or similar (the label is drawn from a
  fixed `Record<string, string>` with a safe fallback for an unknown status).
  Not a security finding.

No route was added, removed or re-gated by either commit — confirmed by
re-running the same AST walk pass 7–9 used (`ast.walk` over each endpoint
file's decorators) from scratch rather than trusting the prior count: **81**
routes total (17 `meetings.py` + 32 `minutes.py` + 30 `minutes_records.py` + 2
`api/public/minutes.py`), identical in count and gate to pass 9 — every route
still carries `require_permission(...)`, or, for the two already-audited
self-scoped exceptions (`PUT /minutes/{id}/action-items/{item_id}`'s
`as_assignee` path and `GET /minutes/action-items/mine`),
`get_current_active_user` with the narrower check made in the handler body.
`app/api/v1/endpoints/meetings.py` (682 L), `minutes.py` (1,574 L) and
`minutes_records.py` (1,250 L) are byte-identical to pass 9 (line counts
match exactly; `git log` confirms no commit in the window touches any of the
three). `backend/alembic/versions/` has no new revision touching
`meetings`/`meeting_minutes`/`meeting_action_items`/`minutes_*`/
`minutes_election_results`/`minutes_public_copies` since pass 9; the chain
re-validated clean at a single head.

Also re-checked against the two still-open, pre-existing docs this feature
carries: `docs/module-audit/meetings-minutes.md` (MM-1/2/3 fixed, MM-4's
XC-1 gap on `event_id`/`assignee_id`/`user_id`/`assigned_to` — confirmed
still closed: `assert_in_org`/`assert_all_in_org` calls present at
`meetings_service.py:155,174,512,549`, `minute_service.py:515,841,1169,1458`
and `minutes_record_service.py:410`, all read at their current lines) and
`docs/app-review/meetings-minutes.md` (MM5-4's missing precondition on
`PUT /minutes/{minutes_id}` and the deferred `minutes.view_executive` tier —
both still open, neither touched by this delta, re-confirmed below).

### New findings

**None.** Both commits in scope either fix a standing finding in a way that
matches this codebase's established locking pattern (pitfall #27, verified at
the diff level rather than the commit-message level) or are display-only with
no auth, tenancy, injection or exposure surface.

### Confirmed still open / still flagged, unchanged

- **MM-19** and **MM-20** — see above. **RESOLVED** (fixed by `2cb6c029`,
  outside this rotation; re-verified here). No longer carried forward as
  open.
- **MM5-4** (app-review; no `ETag`/`updated_at` precondition on
  `PUT /minutes/{minutes_id}`, two editors silently overwrite each other's
  sections) — `minutes.py`'s `update_minutes` byte-identical to pass 9;
  unchanged. A correctness/lost-update concern, not a cross-tenant or
  privilege gap under this checklist's seven dimensions. **FLAGGED**, same
  disposition as every prior pass.
- **`minutes.view_executive` tier** (module-audit MM-3's deferred half; a
  role that attends but doesn't edit closed-session minutes currently has no
  way to read them without also holding `minutes.manage`) — a product/role
  decision, not touched. **FLAGGED**, unchanged.
- Carried-forward "looked at, not a finding" items from passes 5–9 (`get_stats`'s
  UTC-clock "this month" count, `list_waivers`'s per-waiver N+1,
  `grant_waiver`'s unlocked find-or-create) — none of the involved files
  changed this delta; not re-investigated beyond confirming no commit touched
  them.

`docs/KNOWN_LIMITATIONS.md`'s MM-9, MM-17, MM-19 and MM-20 entries re-read
against current code: all four still accurate (MM-9/MM-17/MM-19/MM-20 all now
resolved stubs). No edit needed from this pass.

### Guard tests added

None by this pass. `tests/test_minutes_find_or_create_race.py` (added by
`2cb6c029`, outside this rotation) already covers MM-19/MM-20's reintroduction
risk and was run directly above rather than only cited.

### Completion gate (pass 10)

| Check                                                                                                                                                                                       | Result                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.4.1 + flake8-pytest-style 2.2.0, CI's pin)                                                                                                                 | clean (0 violations)                                |
| `black --check app/ tests/ alembic/` (26.10.1, CI's pin)                                                                                                                                    | clean (2,695 files unchanged)                       |
| `isort --check-only app/ tests/ alembic/` (9.0.2, CI's pin)                                                                                                                                 | clean                                               |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                           | PASSED — 663 revisions, single head `c616fa1bd492`  |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                                                                                                                           | 279 routes checked, 0 errors, 0 warnings            |
| backend tests, scope (`-k "meeting or minutes"`)                                                                                                                                            | 1,073 passed, 1 skipped (pre-existing, `pywebpush`) |
| backend tests, cross-cutting guards (`test_org_scoping_ratchet`, `test_endpoint_auth_coverage`, `test_account_status_gates`, `test_storage_operations`, `test_minutes_find_or_create_race`) | 37 passed                                           |
| `cd frontend && npm run typecheck`                                                                                                                                                          | 0 errors                                            |
| `cd frontend && npm run lint`                                                                                                                                                               | 0 errors, 0 warnings (`--max-warnings 10`)          |

No source file under this feature's scope was changed by this pass — the only
behavioral delta since pass 9 (the two find-or-create locks) was landed by
other work and independently re-verified here at the diff level against all
seven `CHECKLIST.md` dimensions. The diff this pass contributes is this
findings file and `docs/security-review/PROGRESS.md` — no code change. (The
frontend `node_modules` tree in this sandbox was effectively empty before
`npm ci` was run from the repo root to restore it per the project's own
single-lockfile convention — an environment-setup step, not a dependency
change; no manifest or lockfile file was touched.)

---

## Pass 11 (2026-10-30) — watchdog pickup, true zero-delta, 0 fixed, 0 new findings

Watchdog pickup for `/loop 30m /security-review`: the dedicated loop session
(`session_011T1ZyyLrD5HagusgK9uDw2`) remained unreachable (`ListAgents` — "No
reachable agents"). PR #3848 (Feature 23, Medical supplies, pass 18) had
already merged on `main` (`3ec28222`); `search_pull_requests` for
`head:claude/security-review-` returned zero open results immediately before
starting this pass, confirming row 24 (Meetings & minutes) as the next `⬜`
row read directly off a freshly fetched `main`. **Branch name avoids reuse**
(Pitfall #24): the bare name and the `-p10` suffix were both used and merged
already, so this pass's branch carries a `-p11` suffix, confirmed unused by
`search_pull_requests` and `git ls-remote origin` returning nothing for any
`*security-review-meetings*` ref before pushing.

**Baseline:** pass 10's merge, `8a2d8760` (PR #3767). `git log 8a2d8760..origin/main`
restricted to this feature's full declared scope (`meetings.py`, `minutes.py`,
`minutes_records.py`, `api/public/minutes.py`, `api/attendance_lock.py`,
`app/mcp/tools/meetings.py`, every `meetings`/`minute`/`quorum`/`attendance_dashboard`
model, schema and service file, and `frontend/src/modules/minutes`) across 181
non-merge commits on `main` in that window surfaced exactly **one** commit
with a real diff in scope:

- `b4d9388a` ("Cap the refusals that join a list from data") — a repo-wide
  sweep capping error messages that join a data-derived list so they can't
  blow past `safe_error_detail`'s 300-character limit and degrade to the
  generic "An unexpected error occurred". This feature's slice is
  `minute_service.py`'s `submit_minutes`: the "sections required by the
  outline" `ValueError` now builds its message with `list_within_detail_limit`
  instead of a bare `', '.join(missing)`. Read the diff directly (not the
  commit message): no new input reaches the message that wasn't already
  there — `missing` is the outline's own configured section names, not new
  user-controlled text — and the message still passes through
  `safe_error_detail()` unchanged (a `ValueError` message with no SQL, path,
  or traceback). No auth, tenancy, injection or exposure surface. Not a
  security finding.

### Route inventory, re-enumerated by AST (not trusted from pass 10's count)

Walked each endpoint file's decorators with `ast.walk` from scratch rather
than diffing: **81 routes total** (17 `meetings.py` + 32 `minutes.py` + 30
`minutes_records.py` + 2 `api/public/minutes.py`), identical in count to pass 10. All four endpoint files are **byte-identical** to the pass 10 baseline
(diffed directly against `git show 8a2d8760:<file>`, not inferred from line
counts), so every route's auth dependency and permission string is unchanged
from pass 10's already-verified state: every route still carries
`require_permission(...)` or, for the two documented self-scoped exceptions
(`PUT /minutes/{id}/action-items/{item_id}` as-assignee, and
`GET /minutes/action-items/mine`), `get_current_active_user` plus the
narrower in-handler check. `check_route_permissions.py --strict`: 280 routes
repo-wide, 0 errors/warnings, unchanged. No Alembic revision touching any
`meetings`/`meeting_minutes`/`meeting_action_items`/`minutes_*` table exists
since pass 10; the chain re-validated clean at a single head (`f90b1124e6f4`).

Also spot-verified the FK-validation fix (module-audit MM-4, XC-1) is still
live at its call sites — `await assert_in_org(...)` /
`await assert_all_in_org(...)` still present in `meetings_service.py` (lines
155, 174, 512, 549), `minute_service.py` (515, 841, 859, 1169, 1177, 1461) and
`minutes_record_service.py` (410, 857) — read directly, not cited from a
prior pass's line numbers (the import line shifted by one in
`minute_service.py` because of the `b4d9388a` import addition, but every
call site itself is unchanged).

### New findings

**None.** The one in-scope commit is a message-formatting robustness fix
with no security-relevant behavior change.

### Confirmed still open / still flagged, unchanged

- **MM5-4** (app-review; no `ETag`/`updated_at` precondition on
  `PUT /minutes/{minutes_id}`, two editors silently overwrite each other's
  sections) — `minutes.py`'s `update_minutes` byte-identical to pass 10;
  unchanged. A correctness/lost-update concern, not a cross-tenant or
  privilege gap under this checklist's seven dimensions. **FLAGGED**, same
  disposition as every prior pass.
- **`minutes.view_executive` tier** (module-audit MM-3's deferred half) — a
  product/role decision, not touched. **FLAGGED**, unchanged.
- **MM2-3** (app-review; `status`/`priority` free-str fields on other
  schemas) — still flagged in `docs/app-review/meetings-minutes.md` as
  needing per-field verification; out of this rotation's scope and already
  explicitly deferred as a focused follow-up by the app-review track itself,
  same as pass 7's note. Not re-derived.
- Carried-forward "looked at, not a finding" items from passes 5–10
  (`get_stats`'s UTC-clock "this month" count, `list_waivers`'s per-waiver
  N+1, `grant_waiver`'s unlocked find-or-create) — none of the involved files
  changed this delta; not re-investigated beyond confirming no commit touched
  them.

`docs/KNOWN_LIMITATIONS.md`'s MM-9, MM-17, MM-19 and MM-20 entries re-read
against current code: all four still accurate (resolved stubs). No edit
needed from this pass.

### Guard tests added

None. No new finding required one.

### Completion gate (pass 11)

| Check                                                                                       | Result                                              |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (7.4.1, CI's pin)                                             | clean (0 violations)                                |
| `black --check app/ tests/ alembic/` (26.10.1, CI's pin)                                    | clean (2,743 files unchanged)                       |
| `isort --check-only app/ tests/ alembic/` (9.0.2, CI's pin)                                 | clean                                               |
| `python3 scripts/validate_migrations.py --strict`                                           | PASSED — 678 revisions, single head `f90b1124e6f4`  |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                           | 280 routes, 0 errors, 0 warnings                    |
| backend tests, scope (`-k "meeting or minute or quorum or attendance_dashboard or motion"`) | 1,273 passed, 1 skipped (pre-existing, `pywebpush`) |
| `cd frontend && npm run typecheck`                                                          | 0 errors                                            |
| `cd frontend && npm run lint`                                                               | 0 errors, 0 warnings (`--max-warnings 10`)          |

No source file under this feature's scope was changed by this pass. The only
in-scope delta since pass 10 (`b4d9388a`'s message-length cap) was landed by
other work and independently re-verified here at the diff level against all
seven `CHECKLIST.md` dimensions. The diff this pass contributes is this
findings file and `docs/security-review/PROGRESS.md` — no code change.
