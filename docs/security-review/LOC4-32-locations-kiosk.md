# Security Review — Feature 32: Locations & Kiosk (pass 4)

**Prefix:** `LOC4` · **Iteration:** 32 · **Reviewed:** 2026-09-13 · **PR:** (opening)

**Backend:** `app/api/v1/endpoints/locations.py` (364 L, 8 routes, byte-identical
to pass 3), `app/services/location_service.py` (383 L, byte-identical),
`app/api/public/display.py` (418 L, byte-identical), `app/api/v1/endpoints/
admin_hub.py` (113 L, byte-identical), `app/services/admin_hub_service.py`
(2,598 L — grew from pass 3's follow-up fixes, see below), `app/services/
guest_check_in_service.py` (396 L — one line changed, a dedup refactor, see
below), `app/schemas/admin_hub.py`, `app/schemas/location.py` (byte-identical),
`app/models/admin_hub.py`, `app/models/location.py` (byte-identical).
**Frontend:** `pages/LocationKioskPage.tsx`, `pages/GuestCheckInPage.tsx`,
`pages/LocationsPage.tsx` (all three changed since pass 2/3 — accessibility
only, see below), `pages/RoomQRCodesPage.tsx` (byte-identical since pass 2),
`components/admin/AdminHubFrame.tsx`, `types/adminHub.ts`.
**Migrations:** none new for this feature's tables since pass 3 (444
revisions now vs. 432 at pass 3, all elsewhere). Grepped for any touching
`locations`, `admin_hub_metric_preferences`, or `display_code` — none found.

---

## Delta method

Pass 3's baseline is commit `3ac9cd4a3` (PR #2365, 2026-09-07, merged).
`git diff --stat 3ac9cd4a3 origin/main` scoped to every backend file in this
feature's surface found exactly two files changed:

- **`admin_hub_service.py`** (+114/−41): this is pass 3's own addendum,
  already recorded in `LOC3-32-locations-kiosk.md`'s "Addendum (2026-09-07)"
  section — three Codex findings on PR #2365 fixed in a follow-up PR after
  pass 3's own doc was written (`_age_days` made timezone-aware across ~18
  call sites; `_short_staffed_shifts` given a `max_candidates=500` cap with a
  logged truncation warning; a test-coverage overstatement in that doc
  corrected). Read the current code directly rather than trusting the
  addendum's prose: confirmed present at cited locations (`_age_days`'s
  `ZoneInfo` conversion, `ctx.timezone_name` threaded through every call site,
  `_short_staffed_shifts`'s `.order_by(...).limit(max_candidates)` and its
  `logger.warning` on truncation). Nothing new to fix here — this pass is
  re-verifying an already-landed fix, not finding one.
- **`guest_check_in_service.py`** (+3/−15, net −12): an unrelated dedup
  refactor (`933640397`..`3638277e5`, the "let a coordinator place an
  applicant on a stage" work) extracted `_meeting_config_matches_event`'s body
  into a shared `meeting_config_matches_event()` in
  `membership_pipeline_service.py`, because a second caller (the stage gate
  that grades a _stored_ attendance record) now needs the identical test.
  Diffed the extracted function against the original method body: byte-for-
  byte identical logic, `GuestCheckInService._meeting_config_matches_event`
  now a one-line delegate. Not a security-relevant change and not part of
  this feature's own work, but read in full to confirm the refactor
  preserved behavior rather than trusting the diff summary alone.

Every other backend file in this feature's surface — `locations.py`,
`location_service.py`, `public/display.py`, `admin_hub.py`, `schemas/
location.py`, `schemas/admin_hub.py`, `models/location.py`,
`models/admin_hub.py` — is byte-identical to what pass 3 signed off.

**Frontend changed since pass 2/3**, missed by pass 3's own "not touched"
claim because the changes landed _after_ pass 3 merged (2026-09-07 →
2026-09-13, commits `8ffec7886`, `78fd83ccb`, `cd27e4e7d`): `LocationKioskPage.
tsx`, `GuestCheckInPage.tsx` and `LocationsPage.tsx` all picked up
accessibility fixes from an unrelated app-review/design sweep — semantic
`<main id="main-content">` landmarks replacing bare `<div>` wrappers, an
explicit `aria-label`/`aria-labelledby` on three dialogs, and `htmlFor`/`id`
pairing on the station-modal's form fields. Read all three diffs in full:
none touch data fetching, the display-code URL construction, form
submission, or any dialog's dismiss behavior — purely markup/attribute
changes. `RoomQRCodesPage.tsx` is untouched since pass 2.

## Route inventory

Unchanged from pass 3 — re-confirmed by re-reading `locations.py`,
`admin_hub.py`, and `public/display.py` directly (all three byte-identical).
Same 13 routes, same auth/permission/org-scoping shape as `LOC3-32-locations-
kiosk.md`'s table; not re-typed here since nothing moved.

## Verified good ✅

- **All five pass-2 findings (LOC-32-1 through 5) and pass 3's addendum
  fixes still hold**, verified directly against current code rather than
  assumed from the byte-identical/delta finding alone:
  - `get_location_by_display_code` still joins `Organization` and filters
    `Organization.active == True` (`location_service.py:363-370`).
  - `_link_prospect`'s insert is still wrapped in `begin_nested()` with the
    `.with_for_update()` recheck on `IntegrityError`
    (`guest_check_in_service.py:271-312`).
  - `update_location`'s duplicate check still reads `model_fields_set` to
    catch an explicit `building: null` vs. an omitted one
    (`location_service.py:132`).
  - `guest_check_in`'s window/finalization rejections still run before
    `daily_cap_exceeded` (`display.py:335-361`, comment intact — every
    rejection gate spends no quota).
  - `LocationUpdate` still carries the `model_validator` rejecting an
    explicit `null` for `name`/`is_active` (`schemas/location.py:79-85`).
  - `_age_days` is timezone-aware at every call site (18 sites checked via
    `grep -n "_age_days("`, all pass `ctx.timezone_name`).
  - `_short_staffed_shifts` still caps at `max_candidates=500` with the
    truncation warning.
- **LOC-1/2/4 (pre-pass-1) still hold** — canonical check-in window, kiosk
  timezone, 24h prefilter bound.
- **LOC-3 still open, unchanged** — `GET /locations/{id}/display` still has
  zero frontend callers (re-grepped `frontend/src` for any caller of this
  path outside `api/public/v1/display/`: none). Not fixed, same reasoning as
  passes 1-3: deleting or wiring up a dead endpoint is an API-surface
  decision, already tracked in `docs/KNOWN_LIMITATIONS.md`.
- **Kiosk credential model re-verified end to end, reading fresh rather than
  citing prior passes:**
  - The `display_code` is the only credential in play. It is globally
    unique (`Location.display_code`, `unique=True`), 8-12 alphanumeric
    characters, and `get_location_by_display_code` resolves the owning
    organization _from_ the code — there is no client-supplied org id
    anywhere on the public surface for an attacker to mismatch against a
    stolen code.
  - Both the malformed-code path (`_validate_display_code`'s regex
    rejection) and the not-found path (`get_location_by_display_code`
    returning `None`) answer with the identical `404 "Display not found"` /
    `EVT_DISPLAY_NOT_FOUND` — no oracle to distinguish "badly formed" from
    "well formed but doesn't exist" and no oracle to enumerate valid codes.
  - `_resolve_guest_event` re-derives the organization and location from the
    display code on every call and requires `Event.location_id == location.
id` _and_ `Event.organization_id == location.organization_id` before
    accepting an `event_id` from the URL — a guest cannot walk a valid code
    for Room A into guest-checking-in an event actually held in Room B, and
    every failure (wrong event, wrong room, `allow_guest_check_in` off)
    answers the same 404 rather than leaking which case applied.
  - Rotation (`POST /{location_id}/regenerate-display-code`) invalidates the
    old code immediately (the column is simply overwritten, not soft-revoked
    with a grace window) and is audit-logged.
  - Rate limiting is layered correctly for the two public write/read shapes:
    60/min/IP on lookups (DoS guard on a cheap read), 10/min/IP + 10-minute
    lockout on guest sign-in (the expensive write), plus a per-event/day
    Redis ceiling (`GUEST_CHECK_IN_DAILY_LIMIT`) that is only spent _after_
    every rejection gate runs — confirmed the ordering in `display.py:325-
361` is unchanged and the comment's reasoning (a distributed flood of
    doomed requests must not exhaust the day's real quota) still matches the
    code below it.
  - No session, token, or client-supplied identity is trusted anywhere on
    the public kiosk surface — the honeypot response, the window-state
    check, and the daily cap all operate on server-resolved values
    (`event`, `location.organization_id`) only.
- **`admin_hub_service.py`'s core service methods** (`_context`,
  `get_summary`, `_render_metric`, `_load_preferences`, `_sanitize`,
  `_resolve_selection`, `get_settings`, `save_settings`) read in full this
  pass rather than assumed unchanged from a byte-diff — they were, in fact,
  unchanged by the two file-level diffs above (both diffs are confined to
  `_age_days` and `_short_staffed_shifts`). `_load_preferences` still filters
  `organization_id` and constrains `scope_key` to `[DEPARTMENT_SCOPE,
ctx.user.id]` — no cross-org or cross-user preference read is possible.
  `save_settings`'s retry-on-`IntegrityError` loop (LOC2-32-3) and
  `_sanitize`'s permission/module gate applied identically to both the
  primary and padding loops (LOC2-32-2) both still present and unchanged.
- **No new module registered in `MODULE_REGISTRY`** since pass 3's
  `scheduling`/`storefront` additions — still 6 modules, none named
  `locations` (this feature's admin-hub-file inclusion in the rotation
  table is about reviewing the shared Administration frame, which several
  other modules' own admin pages route through, not because Locations has
  its own admin-hub module).
- **Frontend kiosk pages** (`LocationKioskPage.tsx`, `GuestCheckInPage.tsx`)
  re-read in full: no client-side trust of anything beyond what the public
  API returns, no `window.confirm`/`alert`/`prompt` (grepped, none), no
  localStorage use, bare `fetch()` deliberately bypassing the authenticated
  axios instance (documented in `GuestCheckInPage.tsx`'s own header comment)
  so an anonymous visitor is never bounced to `/login` by the 401
  interceptor.
- **`LocationsPage.tsx`'s three modal overlays checked against Pitfall
  #31** — none carry an `onClick` on the `modal-overlay` div itself; the
  only `onClick={() => setShow...Modal(false)}` handlers are on the header
  close (X) buttons, which is the correct pattern. `RoomQRCodesPage.tsx`
  uses `useConfirm()` for the regenerate action, not `window.confirm`.
- **Route registries** (`APPLICATION_PAGES.md`, `mobile-route-inventory.ts`,
  `testingRegistry.ts`) re-checked for this feature's routes (`/locations`,
  `/locations/qr-codes`, `/display/:code`, `/display/:code/events/:eventId/
guest`) — all four still present in all three, unchanged since no route
  was added or removed this pass.
- **`can_view_kiosk_display_codes`** (`api/dependencies.py`) re-read: still
  gates on `locations.manage`, `facilities.manage`, or `locations.edit` —
  matches `APPLICATION_PAGES.md`'s documented redaction rule for the QR
  directory (an `apparatus.view`-only visitor reaches the route but the
  backend never serves them a `display_code`, so room cards simply don't
  render for them).

## Findings

**None new this pass.** Zero fixes, zero flagged. The only backend deltas
since pass 3 are (a) pass 3's own already-recorded addendum fixes, confirmed
present and correct, and (b) an unrelated membership-pipeline dedup refactor
that preserves the extracted logic byte-for-byte. The only frontend deltas
are accessibility-only markup changes from an unrelated sweep. No regression
found in any of passes 1-3's prior findings; LOC-3 (dead endpoint) remains
the sole open, flagged (not fixed) item, unchanged from every prior pass.

## Schema & migration notes

No new columns or tables for this feature. `AdminHubMetricPreference` and
`Location.display_code` are unchanged from pass 3.
`scripts/validate_migrations.py --strict`: 444 revisions, single head.

## Guard tests added

None — no fix in this pass to guard. Existing coverage (`test_admin_hub_
scheduling.py`, `test_admin_hub_storefront.py`, and the location/kiosk/
guest-check-in suites) re-run clean as part of the scoped and full suites
below.

## Completion gate

| Check                                                | Result                                                |
| ---------------------------------------------------- | ----------------------------------------------------- |
| `flake8` (feature's backend files)                   | ✅ 0 violations                                       |
| `black --check` (feature's backend files)            | ✅ clean, 11 files unchanged                          |
| `isort --check-only` (feature's backend files)       | ✅ clean                                              |
| `python3 scripts/validate_migrations.py --strict`    | ✅ 444 revisions, single head                         |
| Scoped tests (`-k "location or kiosk or admin_hub"`) | ✅ 357 passed, 1 skipped (pywebpush, pre-existing)    |
| Full backend suite (`pytest tests/`)                 | ✅ 12,524 passed, 21 skipped (pre-existing), 0 failed |
| `npm run typecheck` (aliased `tsc-native`)           | ✅ 0 errors                                           |
| `npm run lint`                                       | ✅ 0 errors, 0 warnings                               |
