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

**✅ Closed (security-review 12, 2026-08-26):** `GET /facilities` and
`GET /facilities/page` both now accept and forward `search`, and
`FacilitiesDashboard.tsx` calls it. See
`docs/security-review/FAC-12-facilities.md`.

### FAC-5 — HIGH access control — sensitive facility data readable with baseline `facilities.view` — ✅ FIXED (2026-08-13)

The default **member** position holds `facilities.view`, and once FAC-P1
exposed the extended detail sections (2026-08-11), every member could read
access keys (including door/alarm codes and combinations in
`key_identifier`), utility account numbers, insurance policies, capital
project budgets, and occupant/lease records — all of whose list/get endpoints
were gated `view OR manage`.
**Fix:** reads for the five sensitive families (access keys, utility
accounts + readings, capital projects, insurance policies, occupants) now
require `facilities.view_sensitive`, `facilities.edit`, or
`facilities.manage`; operational/safety sections (rooms, systems,
maintenance, inspections, emergency contacts, shutoffs, compliance) stay at
`facilities.view`. The frontend hides the sensitive sidebar sections for
view-only users via `useFacilitiesAccess().canViewSensitive`.
`facilities.view_sensitive` is a read-only, organization-wide grant for ranks
whose duties require facility knowledge without facility write access — the
default position templates give it to vice president (president's stand-in)
and treasurer (utilities/insurance/budgets are financial records); chiefs,
president, and facilities manager are covered by `facilities.manage`. The
station-specific captain rank does not receive organization-wide sensitive
access by default. Template changes seed new organizations only — existing
organizations adjust their positions through the role editor. Locked by
`backend/tests/test_facilities_permissions.py` (route-dependency
introspection + template contract) and the frontend section-contract test.

## Notes

- No wrong-attribute bugs. `_sync_room_location` was verified against
  `app/models/location.py` — all referenced fields exist.

---

# Product Delivery Review — Advertised vs. Delivered

**Revalidated:** 2026-08-20 (current implementation, not the historical state of
an earlier audit pass)

**Advertised surface:** `README.md`, `docs/README.md`, `APPLICATION_PAGES.md`,
and `docs/training/06-apparatus-facilities.md`.

**Delivered surface:** Facilities endpoints, service and schemas; the Facilities
routes, store, dashboard, detail sections and typed API client; and the shared
Location bridge.

## Executive summary

Facilities delivers the advertised breadth better than the previous review
recorded. All 13 documented detail sections are now registered, sensitive
sections are separately read-gated, server-side search exists, dashboard card
counts are unpaginated aggregates, room nesting is implemented, and facility
rooms synchronize Location records. Cross-facility maintenance and inspection
pages are also genuine working workflows.

It should nevertheless not yet be described as a complete property-management
experience. The dashboard and search still expose only the first 100 records,
the UI hides legitimate edit and maintenance capabilities behind the broader
`facilities.manage` grant in several core sections, and the module calls five
completed maintenance records “Recent Activity.” Photos and documents have a
complete API but no facility-detail workflow. The Location bridge is deliberately
room-owned rather than bidirectional, which is a sound design but narrower than
“locations created through either module are linked.”

## Current contract matrix

| Advertised capability                                | What is delivered now                                                                                                                                                                                                                                                | Assessment                                  |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Summary statistics                                   | Dedicated SQL counts provide correct totals for facilities, operational facilities, overdue maintenance, and inspections due in 30 days.                                                                                                                             | **Delivered**                               |
| Overdue/upcoming dashboard previews                  | Preview rows are derived from default, 100-row list calls and filtered in the browser. Counts can therefore be non-zero while the corresponding preview is empty or incomplete.                                                                                      | **Partial**                                 |
| Recent activity                                      | The widget contains only the five most recent completed maintenance records; it has no actor and excludes every other facility action.                                                                                                                               | **Over-advertised**                         |
| Searchable facility card grid                        | Debounced server-side search covers name, facility number, and city, but returns at most 100 matches and has no pagination.                                                                                                                                          | **Partial at scale**                        |
| All 13 documented detail sections                    | Overview, rooms, systems, maintenance, inspections, utilities, contacts, keys, shutoffs, projects, insurance, occupants, and compliance are reachable.                                                                                                               | **Delivered**                               |
| Utility management                                   | Account CRUD, reading CRUD, costs, usage, billing dates, and notes are exposed in the detail UI.                                                                                                                                                                     | **Delivered at record-keeping level**       |
| Room nesting and Location synchronization            | Same-facility parent selection, cycle/depth safeguards, tree rendering, re-parent-on-delete, and room-to-Location synchronization are implemented.                                                                                                                   | **Delivered**                               |
| “Locations created through either module are linked” | Facility rooms create and own linked Locations. A standalone Location may point to a Facility, but does not create a room; the Locations UI is replaced when Facilities is enabled.                                                                                  | **Wording overstates the reverse workflow** |
| Permission-specific mutation access                  | The backend distinguishes create, edit, maintenance, sensitive-read, and manage. Extended sections use edit/manage correctly, but rooms, systems, contacts, overview, compliance, and facility-detail maintenance still show mutation controls only to manage users. | **Inconsistent**                            |
| Complete building/property management                | Core records are broad, but there are no detail sections for the already-supported photos/documents, no portfolio views for costs/expirations/projects, and no reminders or task ownership workflow in this module.                                                  | **Strong foundation, not complete**         |

## What is working well

- **Security boundaries are strong.** Facilities routes are authenticated and
  permission-gated, tenant scoping is systematic, and sensitive families are not
  exposed to every holder of baseline `facilities.view`.
- **The advertised detail navigation is now real.** The section registry provides
  an executable contract, and tests verify both the complete list and sensitive
  visibility behavior.
- **The room model is richer than a flat directory.** Nested rooms, a maximum
  depth, cycle rejection, containment paths, and safe re-parenting make the
  room/Location integration operationally useful.
- **Archive/restore protects references.** Facility lifecycle is non-destructive,
  while normal lists can omit archived records.
- **The API is ahead of the presentation layer.** This reduces the cost of future
  iterations for reporting, photo/document workflows, utilities, policies, and
  capital planning.

## Active gaps and improvement opportunities

### FAC-P2 — MEDIUM correctness/scale — Counts and dashboard rows have different scopes

**✅ Fixed 2026-08-20:** `/facilities/dashboard` now returns organization-wide
counts plus separately queried, globally ordered preview rows with facility
names. The facility card grid and server-side search use `/facilities/page`,
which returns total metadata and 24-record pages. Label printing is explicitly
scoped to the visible page rather than silently presenting loaded IDs as every
facility.

Previously, `/dashboard-counts` counted the full organization while the store
derived its rows from the first 100 ordinary list records. That could produce:

- a correct non-zero card paired with an empty or incomplete preview;
- “Unknown” facility names when a preview references a facility outside the
  loaded facility page;
- a facility grid and bulk-label action that silently omit later facilities;
- recent completed maintenance selected from the first API page rather than the
  globally most recent records.

**Follow-up:** preserve search, filters, and page state in URL parameters. If a
true “print all matching” action is desired, implement a server-side selection
contract rather than expanding an unbounded ID list in the browser.

### FAC-P6 — LOW/MEDIUM product language — The Location bridge is intentionally one-way

**✅ Fixed 2026-08-20:** product and page-catalog language now describes the
room-owned synchronization contract explicitly and distinguishes standalone
Locations, which may reference a Facility but do not create or update rooms.

The current ownership model is coherent: a `FacilityRoom` owns its room-shaped
`Location`; standalone Locations can optionally reference a Facility but never
materialize or update a room. That does not deliver a general “created through
either module” bridge, especially because enabling Facilities replaces the
standalone Locations page in normal navigation.

**Recommended iteration:** keep the room-owned model and advertise it precisely.
Document which fields are canonical and how conflicts are resolved. If a true
reverse workflow is later required, design explicit conversion, conflict, audit,
and unlink semantics instead of adding implicit two-way synchronization.

### FAC-P7 — LOW semantics — “Recent Activity” is a maintenance-completion widget

**✅ Fixed 2026-08-20:** the dashboard and training catalog now call this widget
**Recent Maintenance Completions**, matching the records it actually renders.

The dashboard endpoint selects the five most recent completed maintenance rows
organization-wide. It excludes inspections, room/system changes, keys,
compliance, archive/restore, and the actor who performed the action; the
corrected label makes that narrower scope explicit.

**Future iteration:** a multi-entity feed should use audit events, include
actor/action/entity, and support a facility filter; do not infer activity from
mutable domain rows.

### FAC-P9 — HIGH authorization UX — Several core sections under-deliver delegated permissions

**✅ Fixed 2026-08-20:** facility-detail sections now receive create, edit,
maintenance, and manager-only delete capabilities separately. A create holder
can add records without receiving edit/delete controls; editors can create and
update; the maintenance grant can create/update/complete maintenance; deletes
remain manager-only. Hook and component regression tests cover view, create,
edit, maintenance, and manage behavior.

The API permits room and system create/update with `facilities.edit` (and some
creates with `facilities.create`), and maintenance create/update with
`facilities.maintenance` or `facilities.edit`. The shared access hook and detail
page now pass edit, maintenance, and manager-only delete capabilities separately.
The Facilities permissions are additive action grants: normal UI entry and read
endpoints still require `facilities.view` (or `facilities.manage`). Custom roles
must pair create/edit/maintenance with view; a mutation-only role intentionally
does not gain read access implicitly.

**Follow-up:** expose the additive-view requirement in role-editor help text so
custom-role authors cannot mistake an action grant for module visibility.

### FAC-P10 — MEDIUM completeness — Photos and documents are API-only

Facility photos and documents have list/create/update/delete endpoints and typed
client methods, but neither appears in the advertised 13-section detail page.
For a module described as complete building/property management, users cannot
attach a site plan, inspection certificate, warranty, equipment-room photo, or
policy file from the facility workflow.

**Recommended iteration:** add a single **Files** section using the application’s
shared document/storage patterns rather than parallel bespoke upload behavior.
Define sensitivity, retention, download authorization, and folder ownership
before exposing it. Link documents to the relevant maintenance, inspection,
system, project, policy, or compliance record where useful.

### FAC-P11 — MEDIUM product depth — Extended sections are ledgers, not management workflows

The delivered sections are useful CRUD surfaces, but the product claims suggest
more operational support than record storage alone:

- utilities have no portfolio trend, anomaly detection, budget comparison, or
  cost-per-area view;
- policies, keys, compliance items, inspections, and maintenance have no
  configurable reminder/notification ownership surfaced here;
- capital projects have no portfolio prioritization, milestones, commitments,
  approvals, or variance dashboard;
- emergency contacts and shutoffs lack a purpose-built, mobile/print emergency
  summary.

**Recommended iteration:** prioritize exception-driven views rather than adding
more fields. Start with expiring/overdue/over-budget queues, named owners, and
configurable reminders. Follow with utility trends and an access-controlled
emergency summary.

### FAC-P12 — LOW discovery/configuration — Lookup administration has no obvious module UI

Facility types, statuses, and maintenance types have full management endpoints,
but the ordinary dashboard/detail workflow loads them only as form options. A
manager has no clearly advertised Facilities settings surface for tailoring the
lookups that the backend calls customizable.

**Recommended iteration:** add a Facilities settings page with safe delete rules,
usage counts, ordering, active/inactive state, and previews of which system
values are inherited versus organization-owned.

## Suggested roadmap

### Now — make the contract truthful

1. ~~Rename Recent Activity or replace it with accurately scoped wording~~ —
   completed (FAC-P7).
2. ~~Align mutation affordances with the backend permission matrix~~ — completed
   (FAC-P9).
3. ~~Correct Location-bridge wording~~ — completed (FAC-P6).

### Next — make the core reliable at organizational scale

1. ~~Deliver server-side dashboard previews and paginate facility search/grid~~
   — completed; URL-state filters remain a follow-up (FAC-P2).
2. Add an integrated Files section with explicit authorization and retention
   behavior (FAC-P10).
3. Add Facilities lookup administration (FAC-P12).

### Later — turn records into operations

1. Add owned exception queues and configurable reminders for maintenance,
   inspections, policies, keys, and compliance.
2. Add utility trend/cost analysis and capital-project portfolio/variance views.
3. Provide an access-controlled, mobile-first emergency summary for contacts,
   shutoffs, hazards, plans, and critical documents.
4. Consider offline availability only after threat-modeling sensitive cached data
   and revocation behavior.

## Acceptance criteria for calling the advertised module complete

- Grid, search, previews, current-page labels, and facility-name attribution
  remain complete and correct beyond 100 records.
- Dashboard preview ordering is performed by the server and agrees with the
  aggregate cards.
- Every permission advertised in the role editor unlocks exactly the matching UI
  actions, and a role without read access has an explicitly defined outcome.
- “Recent Activity” is either accurately named or includes audited, multi-entity
  actor/action events.
- Product wording describes room-owned Location synchronization rather than an
  unspecified bidirectional bridge.
- Facility files are attachable, viewable, and governed from the facility detail
  workflow.
- Due, expiring, and over-budget records have visible owners and configurable
  escalation/reminder behavior.
- The permission, section, pagination, and sensitive-data contracts have
  executable frontend and backend tests.
