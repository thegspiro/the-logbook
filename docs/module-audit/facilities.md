# Module Audit — Facilities

**Files:** `app/api/v1/endpoints/facilities.py` (3,553 L, 95 endpoints),
`app/services/facilities_service.py` (2,766 L), model `app/models/facilities.py`,
frontend `modules/facilities`.
**Audited:** iteration 4 (full line-by-line tenant-isolation read of the service
layer + endpoint auth coverage).

## Verified good ✅

- **Auth coverage:** all 95 endpoints carry `require_permission(...)` — 0
  unauthenticated routes, no bare `get_current_user` (every route is
  permission-gated with sensible `.view`/`.manage` scoping).
- **Tenant isolation is solid — no IDOR.** Every by-id
  `get_*`/`update_*`/`delete_*` in the service filters `organization_id`, and
  every update/delete routes through an org-scoped `get_*` first. Lookup tables
  (types/statuses/maintenance-types) additionally allow `organization_id IS NULL`
  system rows — intentional and correct. `delete_room`'s linked-`Location`
  delete is scoped by both `facility_room_id` and `organization_id`.
- **No SQL injection:** no `text()`/f-string/`.format()` SQL. The one search
  (`list_facilities`) escapes `\`, `%`, `_` before building the `ilike` term —
  this is the correct pattern (contrast INV-5).
- **No PK-bypass** (`db.get`/`filter_by(id=)`).
- **Lint:** flake8 clean; no TODO/FIXME markers.

## Findings

### FAC-1 — cleanup — dead no-op "attachment conversion" blocks — ✅ FIXED

Eight create/update methods (maintenance, inspection, capital-project,
insurance-policy × create+update) contained:

```python
# Convert attachment models to dicts for JSON storage
if dump.get("attachments"):
    dump["attachments"] = [a if isinstance(a, dict) else a for a in dump["attachments"]]
```

Both branches of `a if isinstance(a, dict) else a` return `a` unchanged, and
`model_dump()` already produces dicts — so the block is an unconditional no-op
with a misleading comment. Removed all 8 (behavior-preserving; verified compile

- flake8 clean).

### FAC-2 — LOW correctness/robustness — `maintenance_type_id` NOT NULL vs schema-optional — ✅ FIXED

`FacilityMaintenance.maintenance_type_id` is `nullable=False`, but
`FacilityMaintenanceCreate` declares it `Optional[str] = None`, and
`create_maintenance_record` only validated it "if provided." A caller omitting
it produced a DB `IntegrityError` → generic 500 at insert time.
**Fix:** guard at the top of the create path — `raise ValueError` (→ clean 400)
when `maintenance_type_id` is missing, then validate it resolves in-org. Success
path unchanged (the column has always required a value, so no existing row could
have been created without one). The Update schema stays optional (correct).

### FAC-3 — LOW — Create/update paths don't validate referenced FK ids are in-org (XC-1 class) — ✅ FIXED (app-review B4, 2026-08-06)

Client-supplied FK ids stored without an in-org check:

- `create_photo` / `create_document` — `facility_id` stored with no `get_facility`
  ownership check (every other child-create verifies the facility).
- `create_maintenance_record` — `system_id` stored unverified (facility +
  maintenance-type are verified).
- `create_access_key` — `assigned_to_user_id` stored unverified.
- `update_facility` — applies `facility_type_id` / `status_id` from the payload
  via `setattr` with no re-validation (unlike `create_facility`).
- `update_maintenance_record` — applies `maintenance_type_id` / `system_id`
  unverified; `update_access_key` sets `assigned_to_user_id` unverified.

Writes are org-stamped, so a bad FK is a dangling/mis-attributed reference, not
a cross-tenant read. **Status:** flagged (XC-1) — best closed by the shared
`assert_in_org` helper rather than per-method patches.

### FAC-4 — LOW (unused capability) — `list_facilities` search not exposed

The service's `list_facilities` supports a `search` argument (with correct LIKE
escaping), but the `GET /facilities` endpoint never accepts/forwards a `search`
query param — the search branch is unreachable from the API. Not a bug; a
wired-but-unexposed feature. **Status:** flagged (adding the query param is a
small API addition, left for deliberate feature work rather than auto-applied).

### FAC-5 — HIGH access control — sensitive facility data readable with baseline `facilities.view` — ✅ FIXED (2026-08-13)

The default **member** position holds `facilities.view`, and once FAC-P1
exposed the extended detail sections (2026-08-11), every member could read
access keys (including door/alarm codes and combinations in
`key_identifier`), utility account numbers, insurance policies, capital
project budgets, and occupant/lease records — all of whose list/get endpoints
were gated `view OR manage`.
**Fix:** reads for the five sensitive families (access keys, utility
accounts + readings, capital projects, insurance policies, occupants) now
require `facilities.edit` or `facilities.manage`; operational/safety sections
(rooms, systems, maintenance, inspections, emergency contacts, shutoffs,
compliance) stay at `facilities.view`. The frontend hides the sensitive
sidebar sections for view-only users via `useFacilitiesAccess().canViewSensitive`.
Locked by `backend/tests/test_facilities_permissions.py` (route-dependency
introspection) and the frontend section-contract test.

## Notes

- No wrong-attribute bugs. `_sync_room_location` was verified against
  `app/models/location.py` — all referenced fields exist.

---

# Product Delivery Review — Advertised vs. Delivered

**Reviewed:** 2026-08-11
**Advertised surface:** `README.md` (unified locations and facilities summary),
`APPLICATION_PAGES.md` (dashboard, detail sections, permissions, and bridge
behavior).
**Delivered surface:** `backend/app/api/v1/endpoints/facilities.py`,
`backend/app/services/facilities_service.py`, `backend/app/services/location_service.py`,
`frontend/src/modules/facilities`, and `frontend/src/services/facilitiesServices.ts`.

## Executive summary

The module has a much broader backend than its UI suggests: the API and typed
client implement the core facility record plus a broad set of related resource
families.
The currently reachable UI makes seven detail sections available and provides
useful cross-facility maintenance and inspection workflows. The largest gap is
therefore not missing persistence or API design, but an unfinished presentation
layer: six sections promised in the page catalog have no detail-page UI even
though most of their API clients already exist.

The other material mismatches are correctness and access-control UX. Dashboard
"totals" are calculated from the first API page rather than true aggregates,
the advertised searchable facility grid has no search control, and the route and
mutation UI does not reflect the documented permissions. Finally, the location
bridge is reliable in the Facility Room → Location direction, but the reverse
path is opt-in, not validated against the caller's organization, and cannot be
changed after creation.

## Advertised vs. delivered

| Advertised capability                                                                      | Delivered state                                                                                                                                                                                                              | Assessment                                          |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Dashboard summary statistics                                                               | Four cards plus overdue/upcoming previews are present, but all values are derived client-side from list responses capped at 100 rows.                                                                                        | **Partial; becomes incorrect at scale**             |
| Recent activity feed                                                                       | Present, but defined narrowly as the last five _completed maintenance_ records. It does not include facility, room, system, inspection, or other activity.                                                                   | **Partial**                                         |
| Searchable facility card grid                                                              | Facility cards are present; no search input, query state, or filtering exists on the dashboard.                                                                                                                              | **Not delivered**                                   |
| Detail: overview, rooms, systems, maintenance, inspections, emergency contacts, compliance | All seven sections are reachable and have CRUD-oriented UI.                                                                                                                                                                  | **Delivered**                                       |
| Detail: utilities, access keys, shutoff locations, capital projects, insurance, occupants  | Models, schemas, endpoints, service methods, TypeScript types, and API client methods exist, but none is registered in `FacilityDetailPage`'s section list.                                                                  | **Backend/client delivered; user workflow missing** |
| Facilities includes utility management                                                     | Utility accounts/readings have backend and typed-client CRUD, but no page or section consumes those methods.                                                                                                                 | **Not delivered to users**                          |
| Locations remain the shared event/training reference                                       | Facility rooms create/update a linked `Location`; event-facing consumers continue to use `locations`.                                                                                                                        | **Delivered in the facility-to-location direction** |
| Locations created through either module are linked                                         | A generic location may accept an optional `facility_id` only at create time. The Locations UI does not establish that link automatically, `LocationUpdate` cannot change it, and no room is created from a generic location. | **Partial / wording overstates bidirectionality**   |
| Routes require `facilities.view`                                                           | The print-label route has a `ProtectedRoute` permission guard. Dashboard, detail, maintenance, and inspection routes do not; their API reads still enforce permissions.                                                      | **Backend enforced; frontend contract missing**     |

## What is working well

- **Tenant scoping is systematic in the Facilities service.** Primary and child
  reads filter by `organization_id`, and mutations resolve their target through
  those scoped getters. The previously identified facility-FK reassignment gaps
  are now guarded by `_assert_facility_in_org` on the relevant paths.
- **The room bridge preserves the canonical location reference.** Creating a
  room creates/updates its linked `Location`, and deleting a room deletes only
  the matching in-org location. The unique `facility_room_id` relationship makes
  this a strong basis for the advertised unified picker.
- **The API surface is unusually complete.** Utilities/readings, keys, shutoffs,
  projects, insurance, occupants, photos, documents, and compliance all have
  server-side CRUD. Most also already have typed frontend service methods, so
  finishing the user experience does not require redesigning the module.
- **Cross-facility maintenance and inspection pages are real workflows, not
  placeholders.** Both support create/edit/delete, filters/search, facility
  attribution, and useful status cues.
- **Archive/restore is preferable to destructive facility deletion.** This
  protects references while keeping inactive facilities out of normal lists.

## Findings and improvement opportunities

### FAC-P1 — HIGH product gap — Six advertised detail sections were unreachable — ✅ FIXED

**✅ Fixed 2026-08-11:** the detail sidebar now exposes utilities, access keys,
shutoff locations, capital projects, insurance, and occupants. Each section
loads its facility-scoped records, provides a read-only state for viewers, and
offers create/delete workflows to managers through the existing typed API
client. A section-contract test locks the advertised navigation list in place.

Before the fix, the sidebar stopped at seven sections even though the models,
endpoints, and typed client already supported all six extended resource groups.
The absence was therefore a presentation-layer gap rather than missing backend
infrastructure.

**Follow-up:** add update workflows and richer domain behavior incrementally,
starting with utility readings, expiry/budget alerts, access-key assignee
pickers, and printable emergency shutoff information.

### FAC-P2 — MEDIUM correctness — Dashboard statistics silently cap at 100 rows

**⚠️ Partly fixed 2026-08-11:** a dedicated `/facilities/dashboard-counts`
endpoint now computes all four summary-card values with unpaginated SQL counts,
and the dashboard consumes those values. The card grid and bounded preview lists
still need cursor pagination so records beyond the first API page remain
navigable and attributable by facility name.

Before the fix, `loadDashboardStats` derived every card from ordinary list
responses capped at 100 rows. Counts are now authoritative, but the bounded
records used for the overdue, upcoming, recent-activity, facility-name, and print
label views can still omit rows outside their first page.

**Recommended follow-up:** return bounded, correctly ordered preview rows from a
server-side dashboard response and paginate or cursor-load the facility grid.
Do not request the endpoint maximum of 500; that only moves the failure point and
increases dashboard payload cost.

### FAC-P3 — MEDIUM product gap — The advertised searchable grid was not searchable — ✅ FIXED

**✅ Fixed 2026-08-11:** `GET /facilities` now exposes the service's escaped
server-side search, the typed client forwards it, and the dashboard provides a
debounced name/number/city search with a distinct empty state. Pagination of the
base grid remains part of FAC-P2.

Before the fix, the dashboard rendered `facilities.map(...)` directly without
search state, and the API did not expose the service's existing search argument.

**Follow-up:** add type, status, and archived filters alongside pagination. Preserve them in URL query parameters so a view is
shareable and back-navigation is stable. A client-only filter would still miss
facilities beyond the first 100 and should be avoided.

### FAC-P4 — HIGH security/integrity — Generic locations accepted an unscoped facility ID — ✅ FIXED

**✅ Fixed 2026-08-11:** location create and update now validate a supplied
facility through the shared `assert_in_org` helper. `LocationUpdate` supports
safe reassignment and clearing, with regression tests for rejection-before-write,
reassignment, and clearing.

`LocationCreate.facility_id` is caller-controlled. `LocationService.create_location`
copies it directly into the new in-org location without checking that the
facility exists in the same organization. This is the remaining location-side
instance of the cross-cutting unvalidated-FK pattern (XC-1). Depending on foreign
key existence it can either create a cross-org association or fail as a generic
server error. `LocationUpdate` omits `facility_id`, so an incorrect association
cannot be repaired through the API.

**Recommended iteration:** validate `facility_id` with the shared `assert_in_org`
helper on create and when adding it to `LocationUpdate`. If the intended bridge
is facility-only, remove `facility_id` from the public location request instead.
Add tests for foreign-org, missing, same-org, clear, and reassignment cases.

### FAC-P5 — MEDIUM contract/UX — Permission behavior did not match the page catalog — ✅ FIXED

**✅ Fixed 2026-08-11:** all five Facilities routes, including print labels,
accept either `facilities.view` or `facilities.manage` through `ProtectedRoute`.
A shared Facilities access hook now distinguishes create from manage access;
the dashboard hides facility creation without `facilities.create`/`.manage`, and
all detail and cross-facility mutation controls require `facilities.manage`.
Backend permission checks remain authoritative.

Before the fix, only the print-label route had a permission-aware guard and
mutation controls rendered regardless of the caller's grants. This created
avoidable 403-driven workflows for view-only users.

**Follow-up:** add route-level integration coverage for view-only, create-only,
manage, and no-access roles as the Facilities route test harness expands.

### FAC-P6 — MEDIUM integration gap — The location bridge is one-way in practice

The facility-room service does a useful room-to-location sync, including name,
address, floor, room number, capacity, and `facility_id`. The reverse workflow
does not match the claim that locations "created through either module are
linked":

- The Locations UI is hidden when Facilities is enabled, so there is no normal
  "either module" workflow at that point.
- A generic location can link only to a facility, not a `facility_room_id`, and
  it does not create or update a `FacilityRoom`.
- Location edits cannot add, change, or clear `facility_id`.
- Facility-level fields and linked location fields can drift because facility
  updates do not synchronize standalone linked locations; only room writes run
  `_sync_room_location`.

**Recommended iteration:** define and document one ownership model. The simplest
is: `FacilityRoom` owns room-shaped locations; standalone locations may optionally
point at a facility but never create rooms. Expose the distinction in UI labels,
make reassignment safe and explicit, and replace "created through either module"
with wording that describes actual ownership. If true bidirectional editing is
desired, add conflict rules and audit events before exposing it.

### FAC-P7 — LOW/MEDIUM semantics — "Recent activity" is only completed maintenance

The dashboard feed is built from maintenance records where `isCompleted` is
true. A newly added inspection, room, access key, facility edit, or archived
facility never appears. This is a valid "recent maintenance completions" widget,
but not a module activity feed as advertised.

**Recommended iteration:** either rename the widget now or back it with audit-log
events across facility entity types. An audit-backed feed would also provide the
actor and action, which the current maintenance-derived feed cannot show.

### FAC-P8 — LOW maintainability — Delivered backend breadth is weakly covered at the UI boundary

Existing frontend tests concentrate on dashboard rendering/store actions and a
small inspection presentation case. There is no detail-page navigation test and
no component test coverage for rooms, systems, maintenance, contacts, or
compliance. The absence of six promised sidebar sections therefore has no
executable specification that would fail.

**Recommended iteration:** turn the advertised-vs-delivered table into a compact
route/section contract test. Assert every advertised section is registered,
permission-gated, and renders an accessible heading. Add API-client contract
tests for snake_case request and camelCase response mapping where applicable.

## Suggested roadmap

### Now — make claims and behavior trustworthy

1. Fix the unscoped `LocationCreate.facility_id` path and add tenant-isolation
   regression tests (FAC-P4).
2. Add permission-aware route and action gating (FAC-P5).
3. Correct the documentation immediately for the six API-only sections and
   one-way bridge, or mark them clearly as planned (FAC-P1/FAC-P6).

### Next — make the delivered core scale

1. Add a server-side dashboard aggregate and paginated/searchable facility grid
   (FAC-P2/FAC-P3).
2. Rename recent activity or implement a true audit-backed feed (FAC-P7).
3. Add the section/permission contract test before expanding the UI (FAC-P8).

### Later — expose the backend investment

1. Deliver the missing sections in the order proposed in FAC-P1.
2. Add cross-facility views only where they answer an operational question
   (utilities cost/usage, expiring insurance, projects over budget), rather than
   duplicating every detail section as a global table.
3. Add reminders/notifications for due maintenance, inspections, insurance, and
   compliance, with configurable lead times and explicit ownership.
4. Provide an emergency-mode, mobile-first summary containing contacts,
   shutoffs, hazards, and critical documents, with carefully defined offline and
   access-control behavior.

## Acceptance criteria for calling the advertised module complete

- Every section named in `APPLICATION_PAGES.md` is reachable or explicitly
  labeled planned/API-only.
- Dashboard counts remain correct above 100 facilities, maintenance records, and
  inspections.
- Facility search works across the full organization dataset, not only the
  loaded page.
- A user without `facilities.view` cannot enter facilities routes; a view-only
  user sees no mutation affordances; create/manage roles see only allowed actions.
- Location-to-facility links are tenant-validated, editable according to a
  documented ownership model, and covered by cross-org tests.
- "Recent activity" either contains multi-entity audit activity with actor/action
  context or is accurately named "Recent maintenance completions."
- The missing-section and permission states have executable frontend tests.
