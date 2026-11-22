# Security Review — Feature 32: Locations & Kiosk (pass 14)

**Prefix:** `LOC14` · **Iteration:** 32 · **Reviewed:** 2026-11-22 · **PR:** (this PR)

**Backend:** `app/api/v1/endpoints/locations.py` (8 routes), `app/services/location_service.py`, `app/services/location_display.py`, `app/api/public/display.py` (6 routes), `app/api/v1/endpoints/admin_hub.py` (3 routes), `app/services/admin_hub_service.py`, `app/models/location.py`, `app/models/admin_hub.py`, `app/schemas/location.py`, `app/schemas/admin_hub.py`, `app/services/guest_check_in_service.py`, `app/schemas/event.py`, `app/core/error_codes.py`.
**Frontend:** `pages/LocationsPage.tsx`, `pages/RoomQRCodesPage.tsx`, `pages/LocationKioskPage.tsx`, `pages/RoomCheckInPage.tsx`, `components/admin/AdminHubFrame.tsx`, `pages/GuestCheckInPage.tsx`, `components/GuestEmailSignIn.tsx`.
**Migrations:** none touching this feature's tables since pass 13.

Watchdog pickup — the dedicated `/loop 30m /security-review` session
(`session_011T1ZyyLrD5HagusgK9uDw2`) remains unreachable. A fresh
`list_pull_requests` (state `open`, both pages) found **zero** open PRs with a
`claude/security-review-*` head branch. PR #4566 (Feature 31, Scheduled
tasks, pass 14) had already merged (`42f390383`) before this iteration
started; row 31 was already `✅`. Row 32 (this feature) was confirmed the next
pending (`⬜`) row in `docs/security-review/PROGRESS.md` on a freshly fetched
`main`. This session's own environment restricts pushes to its assigned
branch (`claude/friendly-babbage-ng64wn`), so the PR for this pass is opened
from that branch rather than a `claude/security-review-locations-kiosk-p14`
name — recorded in the Open PR row so the next iteration's Step 0 finds it by
the general search.

Separately: PR #4560 ("Training waivers: nobody grants or extends their own,
and rejoin main's migration heads"), which pass 13's own superseded note and
the SEC-00 pass-17 baseline both flagged as fixing a pre-existing, unrelated
Alembic fork, has merged (`9e15158d9`). `validate_migrations.py --strict`
now reports a single head (`561a3e9f4165`) — confirmed directly this pass,
not assumed from the PR title. Nothing from this feature caused or fixes that
fork; noted here only because the restriction notice in this task's brief
asked that it be checked.

---

## Scope

Pass 13's baseline is PR #4252, head `b29782324`, merged 2026-11-11.
`git diff b29782324..HEAD` (several hundred commits across an 11-day window)
touched 4 of this feature's declared backend files and 2 of its frontend
files; everything else in the declared file list
(`location_service.py`, `location_display.py`, `admin_hub.py`,
`models/location.py`, `models/admin_hub.py`, `schemas/location.py`,
`schemas/admin_hub.py`, `guest_check_in_service.py`, and
`LocationsPage.tsx`/`RoomQRCodesPage.tsx`/`AdminHubFrame.tsx`/
`GuestCheckInPage.tsx`/`GuestEmailSignIn.tsx`) is byte-identical to pass 13
and re-verified unchanged by `git diff`, not re-derived.

Every route re-enumerated by an AST walk over all three endpoint files'
`@router.<verb>` decorators (script quoted below), not trusted from pass 13's
table: **17/17, unchanged** — 8 in `locations.py`, 6 in `display.py`, 3 in
`admin_hub.py`. No route gained, lost, or changed its auth dependency or
permission string.

```
backend/app/api/v1/endpoints/locations.py: 8 (list_locations, create_location,
  get_location, update_location, delete_location, regenerate_display_code,
  set_badge_check_in, get_location_display_info)
backend/app/api/public/display.py: 6 (get_public_location_display,
  kiosk_badge_tap, get_guest_check_in_info, guest_check_in, guest_lookup,
  guest_confirm)
backend/app/api/v1/endpoints/admin_hub.py: 3 (get_admin_hub_summary,
  get_admin_hub_metrics, update_admin_hub_metrics)
```

The real delta this window is small and entirely outside this feature's own
logic:

1. `locations.py:227-235` — the `delete_location` docstring was expanded to
   name all nine now-restricting reference kinds and the 409-on-race path
   (text only; the behavior it describes was already fixed and verified in
   pass 13 as LOC8-2).
2. `core/error_codes.py` — two MFA-setup resolution strings were reworded
   ("Profile → Security" → "My Account → Security"; "Organization Settings →
   Security" → "Settings → Authentication → MFA Policy") to match renamed
   settings screens. Not this feature's code; read and confirmed cosmetic.
3. `admin_hub_service.py:826-862` — a new `_course_link_attention` row was
   added to the Training module's "Needs attention" queue (read in full,
   below — this is the one change in this feature's own files with any
   security surface).
4. `schemas/event.py` — a 248-line diff, entirely new Outreach/RSVP fields
   (`guest_headcount`, `can_record_guest_headcount`, `can_staff_event`,
   `mandatory_rsvp_window_days`, etc.) belonging to the Events feature. This
   file is in this feature's declared list only because `GuestLookupResponse`
   also lives in it; confirmed by `grep -n "Guest\|guest"` on the diff that
   none of the added lines touch the guest-lookup/guest-check-in schemas this
   feature owns. Out of scope, not re-derived beyond that confirmation.
5. Frontend: `LocationKioskPage.tsx` gained an accessible `title` attribute
   on each of its three `QRCodeSVG` instances (naming the event, e.g.
   `"Member check-in QR code for {event.title}"` — no PII/PHI, the same event
   title the page already displays in text); `RoomCheckInPage.tsx` swapped a
   generic `getErrorMessage` call for the shared `getLoadFailureMessage`
   helper on a 404 fallback. Both read in full; neither changes what data is
   fetched, sent, or exposed.

## Route inventory

| Method | Path                                                   | Auth dependency           | Permission                                                                                                        | Org-scoped                                                                                 | Notes                                                                                   |
| ------ | ------------------------------------------------------ | ------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| GET    | `/locations`                                           | `get_current_user`        | none (any member)                                                                                                 | yes — `current_user.organization_id` passed to the service                                 | list, no change                                                                         |
| POST   | `/locations`                                           | `require_permission`      | `locations.create` OR `locations.manage`                                                                          | yes                                                                                        |                                                                                         |
| GET    | `/locations/{id}`                                      | `get_current_user`        | none                                                                                                              | yes — `get_location` filters `organization_id`                                             |                                                                                         |
| PATCH  | `/locations/{id}`                                      | `require_permission`      | `locations.edit` OR `locations.manage`                                                                            | yes                                                                                        |                                                                                         |
| DELETE | `/locations/{id}`                                      | `require_permission`      | `locations.delete` OR `locations.manage`                                                                          | yes                                                                                        | 409 (`LocationInUseError`) on a race, not 500; docstring expanded this pass (text only) |
| POST   | `/locations/{id}/regenerate-display-code`              | `require_permission`      | `locations.edit` OR `locations.manage`                                                                            | yes                                                                                        | audited                                                                                 |
| PUT    | `/locations/{id}/badge-check-in`                       | `require_permission`      | `locations.manage_nfc_tags`                                                                                       | yes                                                                                        | audited; needs NFC ID Cards integration to turn on                                      |
| GET    | `/locations/{id}/display`                              | `get_current_user`        | none                                                                                                              | yes                                                                                        | real caller (`RoomCheckInPage.tsx`'s `getCurrentCheckIns`)                              |
| GET    | `/public/v1/display/{code}`                            | none (public)             | n/a                                                                                                               | by display code → org, then `is_active`/`Organization.active` gated                        | 60/min/IP rate limit                                                                    |
| POST   | `/public/v1/display/{code}/badge-tap`                  | none (public)             | n/a                                                                                                               | by display code; both the room switch and the org integration flag re-checked on every tap | 60/min/IP + 60/min/room rate limits                                                     |
| GET    | `/public/v1/display/{code}/events/{id}/guest`          | none (public)             | n/a                                                                                                               | event resolved through the display-code-owning location                                    | 60/min/IP                                                                               |
| POST   | `/public/v1/display/{code}/events/{id}/guest-check-in` | none (public)             | n/a                                                                                                               | same                                                                                       | 10/min/IP + 10-min lockout + per-event daily cap, honeypot                              |
| POST   | `/public/v1/display/{code}/events/{id}/guest-lookup`   | none (public)             | n/a                                                                                                               | same                                                                                       | same, plus the member-oracle fix (LOC10-3, fixed pass 13)                               |
| POST   | `/public/v1/display/{code}/events/{id}/guest-confirm`  | none (public)             | n/a                                                                                                               | same                                                                                       | same; token-scoped (event+room+org, 10-minute expiry)                                   |
| GET    | `/admin-hub/{module_key}/summary`                      | `get_current_active_user` | the module's own `.manage` permission, resolved through `MODULE_REGISTRY` and checked by `_require_module_access` | n/a (summary reads the caller's own org via `MetricContext`)                               | unknown/forbidden module both 404                                                       |
| GET    | `/admin-hub/{module_key}/metrics`                      | `get_current_active_user` | same                                                                                                              | n/a                                                                                        |                                                                                         |
| PUT    | `/admin-hub/{module_key}/metrics`                      | `get_current_active_user` | same                                                                                                              | n/a                                                                                        | audited                                                                                 |

No route gained, lost, or changed its auth dependency or permission string
since pass 13.

## Verified good ✅

- **Route count and gating unchanged, re-derived by AST** (17/17, table
  above), not trusted from pass 13.
- **All prior fixes remain in place, re-confirmed by `git diff` against their
  files rather than re-read line by line**: LOC-40 (shared display builder),
  LOC-41 ((org, name, building) uniqueness), LOC8-2 (nine-kinds-of-record
  hard-delete guard), and LOC10-3's member half (guest-lookup oracle) all
  live in files that are byte-identical to pass 13's merge
  (`location_display.py`, `location_service.py`, `models/location.py`,
  `display.py`'s `guest_lookup`) — confirmed by `git diff b29782324..HEAD`
  returning no hunks for any of them.
- **The new Training admin-hub "Needs attention" row
  (`_course_link_attention`, `admin_hub_service.py:843-862`) is correctly
  scoped and introduces no new exposure.** It is gated the same way every
  other row in `_training_attention` is: the endpoint's own
  `_require_module_access(module_key, current_user)`
  (`admin_hub.py:35-43`) checks `training.manage` before `get_summary` is
  ever called, and the module spec carries no narrower
  `attention_permission`, so there is nothing for this row to leak that the
  caller could not already see via the Training module itself. Its data
  source, `TrainingCourseLinkService.unlinked_names`
  (`training_course_links.py:147-163`), filters
  `TrainingRecord.organization_id == org_id` before grouping — org-scoped,
  matching Pitfall #14. The row itself carries only a count and a total
  record count (`detail=f"across {records} records"`), no member names or
  record ids. The call is wrapped in its own `try/except`
  (`admin_hub_service.py:827-836`) so a failure in this one row cannot take
  down the submissions/certification rows that run before it in the same
  function — matching the pattern the enclosing `get_summary` already uses
  one level up. This is Training's own already-reviewed query pattern
  (`TrainingCourseLinkService`), delegated into, not re-implemented — the
  shape Pitfall #19 calls for.
- **`ondelete="SET NULL"` columns pointing at `locations.id` remain
  `nullable=True`** on the three that carry it (`inventory_items`,
  `storage_areas`, `nfc_card_taps`) — unchanged file, re-confirmed via
  `git diff` returning no hunks for `models/location.py`.
- **No new or changed migration touches this feature's tables** — the git log
  for `backend/alembic/versions/` filtered to the relevant table/model names
  in the `b29782324..HEAD` window returns nothing.
- **The two frontend diffs introduce no new data exposure.** `LocationKioskPage.tsx`'s
  added `title` attributes name only the event title already rendered as
  visible text on the same page (no new field reaches the DOM); `RoomCheckInPage.tsx`'s
  swap to `getLoadFailureMessage` is a message-formatting change only — the
  404 branch above it (which already has the feature's own custom copy) is
  untouched, and the generic branch still routes through `toAppError`.

## Findings

No new findings this pass. `locations.py`, `display.py`, `admin_hub.py`,
`location_service.py`, `location_display.py`, `guest_check_in_service.py`,
and every model/schema file this feature declares are either byte-identical
to pass 13's reviewed state or — for the one genuinely new surface,
`_course_link_attention` — read in full and verified correctly gated and
org-scoped (above). The docstring and copy changes (items 1, 2, 5 under
Scope) carry no behavior change to verify.

## LOC10-2, LOC10-4 status — unchanged, re-confirmed OPEN/FLAGGED

| ID      | Severity | Disposition | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------- | -------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LOC10-2 | LOW      | 🚩 FLAGGED  | `tests/test_guest_email_first_sign_in.py`'s `_member()` fixture (`:378-388`) still bypasses the `EncryptedText`/`EncryptedEnum` bind-param path with a raw `text()` INSERT, so it only ever exercises the `email_hash` branch of the lookup, never a real ciphertext comparison. Closing it is a test-fixture-convention decision (rewrite the fixture through the ORM, or add a narrow standalone unit test), not a one-line fix — unchanged from pass 10's assessment. Confirmed the file carries no diff since pass 13 (`git diff b29782324..HEAD -- backend/tests/test_guest_email_first_sign_in.py` returns nothing). |
| LOC10-4 | LOW      | 🚩 FLAGGED  | `MembershipPipelineService.create_prospect`'s duplicate-detection branch still logs the raw applicant email by f-string (`membership_pipeline_service.py:1919`, same text, line number unchanged from pass 13). Still unreachable from this feature's own kiosk/guest-lookup path (`find_active_prospect_by_email` is a different code path); still out of scope — flagged for Membership pipeline / Volunteer recruitment's own next pass.                                                                                                                                                                                |

Neither file's relevant lines changed in this window, so neither is
re-derived beyond confirming the text is unchanged (`git diff`/`grep` above).

## Schema & migration notes

- `scripts/validate_migrations.py --strict` — single head `561a3e9f4165`
  (unrelated to this feature — the merge revision from the already-merged
  PR #4560 rejoining an Alembic fork two other, unrelated features'
  migrations caused; nothing in this feature's tables forked or needed
  rejoining).
- No migration in `b29782324..HEAD` touches a table or column this feature
  declares.
- `ondelete="SET NULL"` vs `nullable=True` (Pitfall #2): unchanged, re-confirmed
  above.

## Guard tests added

None new this pass — no code change in this feature's own files carried a
fixable defect. The prior passes' guard tests
(`tests/test_location_display_builder.py`, `tests/test_location_name_uniqueness.py`,
`tests/test_location_name_unique_migration.py`,
`tests/test_delete_reference_guards.py`, `tests/test_location_restrict_references.py`)
all re-ran clean as part of this pass's scoped suite below.

## Completion gate

| Check                                                                                                          | Result                                                       |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `flake8 app/ tests/ alembic/` (repo-pinned)                                                                    | ✅ 0 violations                                              |
| `black --check app/ tests/ alembic/`                                                                           | ✅ 3421 files unchanged                                      |
| `isort --check-only app/ tests/ alembic/`                                                                      | ✅ clean                                                     |
| `python3 scripts/validate_migrations.py --strict`                                                              | ✅ 820 revisions, single head `561a3e9f4165`                 |
| Route re-enumeration (AST walk of all 3 files' decorators)                                                     | ✅ 17/17, unchanged from pass 13                             |
| `python3 scripts/check_route_permissions.py --strict` (repo root)                                              | ✅ 338 routes, 0 errors/warnings                             |
| Scoped `pytest -k "location or admin_hub or guest_check_in or public_display or guest_email_first or display"` | ✅ 779 passed, 1 pre-existing environment skip (`pywebpush`) |
| `npm run typecheck`                                                                                            | ✅ 0 errors                                                  |
| `npm run lint`                                                                                                 | ✅ 0 errors/warnings                                         |
| Relevant vitest (`LocationsPage`, `RoomQRCodesPage`, `RoomCheckInPage`, `AdminHubFrame`, `LocationKioskPage`)  | ✅ 82 passed (5 files)                                       |
