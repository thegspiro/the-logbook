# Application Review — Meetings & Minutes (Tier B)

**Prefix:** `MM2` · **Iteration:** B6 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-06 (pass 2), 2026-08-09 (pass 3), 2026-08-09 (pass 4)

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
  (not the Integer column pass 3 cited — that Integer is on the *other* model),
  and `status` maps to `MotionStatus` / `MinutesActionItemStatus`.
- `app.schemas.meetings` → `MeetingsService` → the `meeting.py` models
  (`Meeting`, `MeetingActionItem`). Here `priority` **is** the bounded Integer
  (`Field(ge=0, le=2)` — already validated), and `status` maps to `MeetingStatus`
  / `ActionItemStatus`.

**Verified safe (false positives — no change):** every `minute.py`-path field
(`Motion.status` on create/update, `ActionItem.priority`/`status` on
create/update, and the inline motions/action-items in `create_minutes`) is
coerced through the **enum constructor** in the service (`MotionStatus(data.status)`,
`ActionItemPriority(data.priority)`, …). A bad value raises `ValueError` *in
Python* before the bind, and every one of those endpoints runs inside
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
**executive-session read restriction** — across *every* path that reads minutes,
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
executive session with a *restricted* audience, that needs a real build (a
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

| Check | Result |
|-------|--------|
| `tsc --noEmit` | ✅ 0 errors |
| `flake8 app/ tests/` | ✅ 0 violations |
| `black --check` | ✅ 503 files unchanged |
| `eslint` | ✅ clean |
| backend tests | ✅ **2517 passed, 0 failed**; 132 minute/meeting tests pass with the new validation. 648 errors, all `db_session` fixture (no MySQL). |
</content>
