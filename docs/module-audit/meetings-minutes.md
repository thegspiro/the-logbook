# Module Audit — Meetings & Minutes

**Files:** `app/api/v1/endpoints/meetings.py` (488 L, 17 endpoints),
`app/api/v1/endpoints/minutes.py` (1,006 L, 25 endpoints),
`app/services/meetings_service.py` (516 L), `app/services/minute_service.py`
(807 L), models `app/models/meeting.py` / `app/models/minute.py`, frontend
`modules/minutes`.
**Audited:** iteration 6 (full read of all four files + XC-3 admin-write-scoping
lens carried over from elections).

## Verified good ✅
- **Auth coverage:** all 42 endpoints authenticated.
- **Direct-object tenant isolation is solid — and XC-3 is clean here.** Every
  by-id update/delete resolves its target through an org-scoped fetch:
  meetings writes route through `get_meeting_by_id(id, org)`; minutes
  motions/action-items route through `get_minutes(id, org)`; attendee/action-item
  and quorum-config queries filter `id + org` directly. **No** "admin edits
  another org's object via `require_permission` only" pattern — the flaw found in
  elections (ELEC-2) does not recur here.
- **No SQL injection:** no `text()`/f-string SQL; all ORM.
- **Model accuracy:** every suspicious attribute access verified against the
  models — no undefined-field references.

## Findings

### MM-1 — MEDIUM — Cross-org template leak via `template_id` — ✅ FIXED
`create_minutes` only resolved `template_id` in-org when the client sent *no*
sections. If the client sent `sections` **and** a foreign `template_id`, the
foreign id was persisted (`**minutes_dict`), and `get_minutes` eager-loads the
`template` relationship by FK join with **no org filter** — so
`get_effective_header()/footer()` returned **another organization's** template
config into the response and the published document.
**Fix:** validate `template_id` in-org (`_get_template`) *whenever* it is
present, raising `ValueError("Invalid template")` (→ 400) if it doesn't resolve;
the fetched template is reused for the section-population branch. `MinutesUpdate`
does not expose `template_id`, so create was the only path.

### MM-2 — LOW — `.ilike()` missing `escape="\\"` — ✅ FIXED
`get_meetings`, `list_minutes`, and `search_minutes` correctly escape `\`, `%`,
`_` in the search term but passed it to `.ilike(term)` **without** declaring the
escape character, so the backslashes weren't guaranteed to be honored (a `%`/`_`
in the query could still act as a wildcard — over-broad matching, not injection).
**Fix:** added `escape="\\"` to all 10 `.ilike(search_term)` calls across both
services.

### MM-3 — MEDIUM — Unpublished / executive minutes readable by any viewer — ✅ FIXED
`get_minutes` / `list_minutes` / `search_minutes` / `get_stats` applied **no
status filter**, so a plain `minutes.view` holder could read
`DRAFT`/`SUBMITTED`/`REJECTED` (unapproved) minutes, and
`MinutesMeetingType.EXECUTIVE` (closed-session) minutes were returned to anyone
with `minutes.view` — with no confidential tier.
**Fix:** the four read paths now take a `restricted` flag. A caller **without
`minutes.manage`** sees only `APPROVED`, non-`EXECUTIVE` minutes across list,
search, and stats; a by-id fetch of an unpublished or executive record returns
404 (existence not revealed). Callers **with `minutes.manage`** (secretaries/
officers — the same permission already required to create/edit/approve minutes,
19 write endpoints) see everything, and internal service callers keep the
unrestricted default. This matches the module's own write model (drafts are
work-in-progress; executive sessions are closed content) and needs **no new
permission** and no frontend change (members' lists simply return only ratified
minutes).
**Adjustable follow-up (flagged):** if a distinct audience needs executive-session
minutes *without* full `minutes.manage` (e.g. board members who attend but don't
edit), that requires a dedicated `minutes.view_executive`-style tier — a larger
change (seed data + role assignment + frontend) intentionally left for a
deliberate decision. Also note a **frontend inconsistency**: `MinutesPage` /
`MinutesDetailPage` compute `canManage` from `meetings.manage`, while the backend
gates minutes writes (and now restricted reads) on `minutes.manage`; roles that
manage minutes should hold both.

### MM-4 — LOW — Cross-org / unvalidated FKs on create (XC-1 class)
- `create_minutes` / `update_minutes` store `event_id` with no in-org check.
- Minutes action items store `assignee_id`; meetings bulk `create_meeting` adds
  attendees (`user_id`) and action items (`assigned_to`) with no org-membership
  check — inconsistent with the dedicated `add_attendee` / (which *does* verify
  the user is in-org). `create_action_item` likewise skips validating
  `assigned_to`.
**Status:** flagged (XC-1) — close with the shared `assert_in_org` helper.

## Notes
- Cosmetic: `meetings.py` / `meetings_service.py` module docstrings are titled
  "Meeting Minutes …" though they belong to the *meetings* module (minutes has
  its own files). Confusing but harmless; left as-is.
- `Meeting.motions` is a `Text` column while `MeetingMinutes.motions` is a
  relationship — a name-collision footgun, no active bug (`get_meetings` searches
  `title`/`notes`/`agenda`, not `motions`).
- `create_meeting` reloads the new row without an org filter, but the id was just
  generated server-side for the caller — not exploitable.
