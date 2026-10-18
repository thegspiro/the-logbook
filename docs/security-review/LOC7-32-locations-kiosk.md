# Security Review — Feature 32: Locations & Kiosk (pass 7)

**Prefix:** `LOC7` · **Iteration:** 32 · **Reviewed:** 2026-10-18 · **PR:** (this PR)

**Backend:** `app/api/v1/endpoints/locations.py` (8 routes, byte-identical to
pass 6), `app/services/location_service.py` (type-annotation widening only),
`app/api/public/display.py` (4 routes, byte-identical), `app/api/v1/
endpoints/admin_hub.py` (3 routes, byte-identical), `app/services/
admin_hub_service.py` (two metric-logic changes, see below), `app/schemas/
admin_hub.py` / `app/schemas/location.py` (byte-identical), `app/models/
admin_hub.py` / `app/models/location.py` (byte-identical). Also read:
`app/utils/org_locks.py` (one unrelated new lock constant),
`app/services/training_module_config_service.py` (`get_practical_skills_
method`, newly consumed by this feature), `app/services/inventory_service.py`
(`get_members_inventory_summary`, newly consumed by this feature).
**Frontend:** `pages/LocationsPage.tsx`, `pages/RoomQRCodesPage.tsx`
(accessibility + form-value-coercion polish, see below). `pages/
LocationKioskPage.tsx`, `components/admin/AdminHubFrame.tsx` byte-identical.
**Migrations:** none touching this feature's tables since pass 6.

---

## Watchdog context

Picked up by the scheduled watchdog: no `claude/security-review-*` PR or
branch was open (`list_pull_requests` / `search_pull_requests` against
`head:claude/security-review-` both empty), and the dedicated `/loop 30m
/security-review` session was not reachable via `ListAgents`. The prior
rotation PR (#3384, Feature 31, Scheduled tasks, pass 7) merged
2026-10-17 22:26 UTC with no next-feature PR open. Feature 32 (Locations &
kiosk) is the next `⬜` row in `PROGRESS.md`, six passes deep already
(LOC-32 through LOC6-32), so this continues as pass 7.

## Delta method

Pass 6's baseline is commit `a4fb4b36` (merged via PR #3077, 2026-10-11).
`git diff --stat a4fb4b36 origin/main` scoped to every file pass 6 listed
found a real diff in five files only — `admin_hub_service.py`,
`location_service.py`, `org_locks.py`, `LocationsPage.tsx`,
`RoomQRCodesPage.tsx` — everything else (`locations.py`, `display.py`,
`admin_hub.py`, both schema files, both model files, `nfc_tag_service.py`,
`guest_check_in_service.py`, `LocationKioskPage.tsx`, `AdminHubFrame.tsx`)
is byte-identical, confirmed by the diff showing no hunks in those paths.
Also confirmed no new file was added under this feature's area (`locations`,
`kiosk`, `admin_hub` in either tree) and the route surface is unchanged —
re-enumerated directly from source: still 8 + 4 + 3 = 15 routes.

- **`admin_hub_service.py` gates the skills-testing attention item and
  metric behind the department's configured practical-skills method.**
  `_skills_testing_available` and `_skill_test_attention` both now call
  `get_practical_skills_method(ctx.db, ctx.organization_id)` first and
  short-circuit (a message / an empty list) when the department runs
  shift-report sign-offs instead of the skills-testing module. Read
  `get_practical_skills_method` (`training_module_config_service.py:43`) in
  full: it filters `TrainingModuleConfig.organization_id ==
str(organization_id)`, and a missing row, a NULL, or an unrecognised value
  all degrade to the same default rather than raising — the Pitfall #19
  shape ("absence must mean current behaviour, never off"), done correctly
  here. `ctx.organization_id` is server-derived from the authenticated
  caller (`MetricContext`, unchanged since pass 1), never request input.
- **`admin_hub_service._inventory_issued` now sums `InventoryService.
get_members_inventory_summary(ctx.organization_id)` instead of two
  standalone `ItemIssuance` counts.** This fixes a real undercount (a
  permanently assigned or checked-out item wasn't counted as "issued") but
  is reviewed here as a tenancy/correctness question, not taken on the
  commit message's word. Read `get_members_inventory_summary`
  (`inventory_service.py:5508-5620`) in full: the main query and all four
  subqueries (`ItemAssignment`, `CheckOutRecord` ×2, `ItemIssuance`) filter
  their own `organization_id == org_id`; `User.organization_id == org_id` is
  the base filter; `search` and `include_user_id` are optional parameters
  this call site never passes, so the default `active`-only, no-search path
  always runs. The `search` branch builds its `ilike` pattern through
  `like_pattern(...)` with `escape=LIKE_ESCAPE_CHAR` (Pitfall #25),
  irrelevant here but confirmed correct since the helper is shared. The
  admin-hub call site only sums `total_items` and counts members with a
  nonzero total — no member name, id, or row from the returned list reaches
  the response, so this is still a single bounded aggregate with no new PII
  exposure, matching the existing bar every other admin-hub attention item
  meets (see LOC6-32's "Verified good").
- **`location_service.py`** widens three parameter types
  (`location_id: UUID` → `UUID | str`, `exclude_event_id: Optional[UUID]` →
  `UUID | str | None`) and adds `or 0` to one `result.scalar()` call. No
  query, filter, or control-flow change — confirmed by reading each call
  site; the widened signatures accept what callers already pass (a `str`
  path param is already coerced via `str(location_id)` inside the method
  bodies, unchanged).
- **`org_locks.py`** adds a `QUICKBOOKS_EXPORT` lock name. Unrelated to this
  feature — grepped every caller; none is in `locations.py`,
  `location_service.py`, `display.py`, or `admin_hub*`. Out of scope for
  this feature's review (belongs to Feature 05, Finance), noted only because
  the file is in this feature's "also read" list from pass 5 onward as the
  room-booking lock's home.
- **`LocationsPage.tsx` / `RoomQRCodesPage.tsx`** are accessibility and
  form-correctness polish: `aria-expanded`/`aria-controls` on the station
  rooms-panel toggle and the QR-code toggle, `<label htmlFor>` wired to every
  previously bare `<label>` in the station/room wizard and modals, a
  QR code `title` for screen readers, `aria-disabled` replacing `disabled`
  on the badge-check-in switch and the regenerate-code button (so a
  confirmation dialog they open can return focus to the control that opened
  it — the same pattern CLAUDE.md's shared-component notes describe
  elsewhere), heading-level fixes (`h3`/`h4` → `h2`/`h3` to keep the page's
  heading hierarchy sequential), and `focus-ring-inset` on the layout
  toggle buttons. Three changes have a correctness angle checked directly
  rather than taken as pure polish:
  - The station-setup wizard's bulk-save loops (`saveStations`,
    `saveRooms`) now mark each station/room `saved: true` via `setStations`/
    `setRoomsByStation` immediately after its own `createLocation` call
    resolves, instead of only updating local state after the whole loop
    finishes. A failure partway through (one room's `createLocation` call
    throws) previously left every room — including ones already
    persisted — eligible to be POSTed again on retry, since nothing in
    local state distinguished "saved" from "not yet attempted"; `saved`
    rooms now render a "Saved" label in place of the remove button and are
    skipped (`if (!room || room.saved) continue;`) on a retried save. This
    is a duplicate-row prevention fix, not a new validation gap — the
    server-side `POST /locations` still applies its own checks regardless
    of what the client believes it already sent.
  - `LocationsPage.tsx`'s station create/edit now requires a street address
    (`toast.error` + `required`/`aria-required` on the field) because
    `groupLocations` (same file) decides "is this a station card" by
    presence of an `address` — a station saved without one, or edited to
    clear it, fell into the "Other Locations" bucket and every room filed
    under its name lost the card it was meant to render under. This is a
    client-side UX guard for a frontend grouping heuristic, not a server
    validation change — confirmed `schemas/location.py`'s `LocationCreate`/
    `LocationUpdate` still have no required `address` (checked: byte-identical
    since pass 6), so a direct API call is unaffected, which is correct:
    the constraint belongs to this screen's own display logic, not the data
    model.
  - Both `LocationsPage.tsx` save handlers switch from `value.trim() ||
undefined` to the shared `formCoercions(isEdit)` helper
    (`utils/formValues.ts`, pre-existing, last touched in an unrelated
    commit) for `address`/`city`/`state`/`zip`/`description`/`room_number`/
    `floor`/`capacity` on **edit** only — `text(...)` resolves to
    `blankToNull`, sending an explicit `null` so a cleared box persists as
    cleared, matching CLAUDE.md Pitfall #1's create-vs-update distinction
    (omit on create, `null` on update) rather than the bug it warns against
    (omitting on update, which this file's own `|| undefined` form would
    have been). Create payloads are unaffected (still `|| undefined`/empty
    string omitted, via the wizard path's unchanged `...(x.trim() ? {x} :
{})` spread, confirmed unchanged in the wizard's own create calls).
    `capacityError()` (new, pure function) mirrors `LocationCreate.
capacity`'s `ge=1` Pydantic constraint client-side (checked
    `schemas/location.py`: `capacity: Optional[int] = Field(None, ge=1)`,
    unchanged) so the 422 the backend already enforced is now caught before
    the request, not a new or changed authorization boundary.

## Route inventory

Re-enumerated directly from current source — unchanged from pass 6 in every
column; reproduced for completeness, not because anything in it is stale.

| Method | Path                                                       | Auth dependency           | Permission                            | Org-scoped                                         | Notes                                                                                             |
| ------ | ---------------------------------------------------------- | ------------------------- | ------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| GET    | `/locations`                                               | `get_current_user`        | none (read)                           | yes                                                | `display_code` only if `can_view_kiosk_display_codes`                                             |
| POST   | `/locations`                                               | `get_current_user`        | `locations.create` OR `.manage`       | yes                                                |                                                                                                   |
| GET    | `/locations/{id}`                                          | `get_current_user`        | none (read)                           | yes                                                |                                                                                                   |
| PATCH  | `/locations/{id}`                                          | `get_current_user`        | `locations.edit` OR `.manage`         | yes                                                |                                                                                                   |
| DELETE | `/locations/{id}`                                          | `get_current_user`        | `locations.delete` OR `.manage`       | yes                                                |                                                                                                   |
| POST   | `/locations/{id}/regenerate-display-code`                  | `get_current_user`        | `locations.edit` OR `.manage`         | yes                                                | audit-logged                                                                                      |
| PUT    | `/locations/{id}/badge-check-in`                           | `get_current_user`        | `locations.manage_nfc_tags`           | yes                                                |                                                                                                   |
| GET    | `/locations/{id}/display`                                  | `get_current_user`        | none (read)                           | yes                                                |                                                                                                   |
| GET    | `/api/public/v1/display/{code}`                            | none (public)             | n/a                                   | via `display_code` + `Organization.active`         | rate-limited 60/min/IP                                                                            |
| POST   | `/api/public/v1/display/{code}/badge-tap`                  | none (public)             | n/a                                   | resolved server-side via display_code→location→org |                                                                                                   |
| GET    | `/api/public/v1/display/{code}/events/{id}/guest`          | none (public)             | n/a                                   | resolved server-side via location→org              |                                                                                                   |
| POST   | `/api/public/v1/display/{code}/events/{id}/guest-check-in` | none (public)             | n/a                                   | resolved server-side via location→org              |                                                                                                   |
| GET    | `/admin-hub/{module_key}/summary`                          | `get_current_active_user` | `spec.permission` (`<module>.manage`) | yes                                                | skills-testing item now conditional on the department's practical-skills method, see Delta method |
| GET    | `/admin-hub/{module_key}/metrics`                          | `get_current_active_user` | `spec.permission`                     | yes                                                | "issued to members" metric now correctness-fixed, see Delta method                                |
| PUT    | `/admin-hub/{module_key}/metrics`                          | `get_current_active_user` | `spec.permission`                     | yes                                                | audit-logged                                                                                      |

## Verified good ✅

- **All prior-pass findings re-verified intact.** LOC5-32-1's fix
  (`get_location_display_info` returns `event_description=None`
  unconditionally) and `get_location_by_display_code`'s `Organization.
active.is_(True)` join filter are both byte-identical to pass 6, which
  itself re-confirmed them directly against source — not re-derived here
  since `locations.py` and `location_service.py`'s relevant methods carry no
  hunk in this pass's diff apart from the type-signature widening already
  described.
- **The two genuinely new pieces of logic this pass (`get_practical_skills_
method` gating and `get_members_inventory_summary` reuse) are both
  org-scoped by construction**, named mechanism in each case: the former
  filters on `TrainingModuleConfig.organization_id`, the latter filters on
  `User.organization_id` plus a matching `organization_id` filter in each of
  its four subqueries — all confirmed by direct read, not inferred from the
  function name.
- **No new route, no route regated, no new client-supplied id anywhere on
  the path.** `ctx.organization_id` is the only identifier either new
  function receives from `admin_hub_service.py`, and it is server-derived
  (`MetricContext`), unchanged since pass 1.
- **The wizard's save-progress tracking (`saved: true` on each station/
  room) is pure UI state, not a new trust decision.** It changes what the
  client avoids re-sending on retry; it does not change what the server
  accepts — `POST /locations`' own permission gate and validation run
  identically whether or not the client thinks it already sent a given
  room.
- **The new required-address client guard does not become a server-side
  requirement that would break direct API callers.** `schemas/location.py`
  is byte-identical to pass 6: `address` remains optional in both
  `LocationCreate` and `LocationUpdate`.
- **The switch to `formCoercions` on update correctly sends explicit `null`
  rather than omitting the key**, which is the create/update distinction
  CLAUDE.md's Pitfall #1 addendum calls out — confirmed by reading `text`/
  `num`'s `isEdit` branch in `utils/formValues.ts`, not assumed from the
  call site alone.

## Findings

None. This pass's real delta — a practical-skills-method gate on one
attention item and one metric, a correctness fix to the "issued to members"
count, type-annotation widening, an unrelated lock-name addition, and a set
of accessibility/form-handling fixes on the two frontend pages — introduces
no new route, no new client-supplied identifier, no change to an
authorization boundary, and no regression in any prior-pass fix.

## Schema & migration notes

No migration touches this feature's tables since pass 6. `scripts/
validate_migrations.py --strict`: 618 revisions, single head
(`1117b642643b`).

## Guard tests added

None by this pass — nothing needed a fix. The pre-existing suite
(`tests/test_room_booking_race.py`, `tests/test_capacity_locking.py`,
`tests/test_kiosk_badge_tap.py`, `tests/test_location_display_endpoint.py`)
already covers every invariant re-verified here; re-run clean below.

## Completion gate

| Check                                                                                                                                                                                                                      | Result                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `flake8 app/ tests/ alembic/`                                                                                                                                                                                              | ✅ 0 violations                      |
| `black --check app/ tests/ alembic/`                                                                                                                                                                                       | ✅ clean, 2426 files unchanged       |
| `isort --check-only app/ tests/ alembic/`                                                                                                                                                                                  | ✅ clean                             |
| `python3 scripts/validate_migrations.py --strict`                                                                                                                                                                          | ✅ 618 revisions, single head        |
| Scoped tests (`-k "location or kiosk or admin_hub or guest_check_in or public_display or badge or room_booking"`)                                                                                                          | ✅ 669 passed, 1 skipped (pywebpush) |
| Repo-tenancy guard suite (`test_endpoint_auth_coverage`, `test_require_permission_registry`, `test_like_escaping`, `test_capacity_locking`, `test_csv_writer_sweep`, `test_org_scoping_ratchet`, `test_room_booking_race`) | ✅ 90 passed                         |
| `npm run typecheck` (aliased `tsc-native`)                                                                                                                                                                                 | ✅ 0 errors                          |
| `npm run lint`                                                                                                                                                                                                             | ✅ 0 errors, 0 warnings              |
