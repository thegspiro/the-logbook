# Workflow Review — W23 Locations, the Kiosk Display and Guest Check-In

**Driven:** 2026-09-29 · **As:** `admin`, anonymous, with `member` refused · **Viewports:** 1280×900, 1024×768 (kiosk), 390×844
**Commit:** `4715dc25c` plus this run's changes · **Database:** continued from W22

---

## What was driven

1. As `admin`, from the navigation: Facilities → Station 1 → Rooms → Add Room.
   First Add was pressed with no name, then "Training Room A", #101, Training
   Room, capacity 30, and Add was double-clicked.
2. As `admin`, from Rooms → Check-In QR Codes (`/locations/qr-codes`), and on
   to Back to Locations (`/locations`).
3. As `admin`, through `POST /events` (event creation through the form was
   driven in W18 and W21): "Recruitment Interest Night", Recruitment, in
   Training Room A, started ten minutes ago, with guest sign-in and "create
   a prospect" both on.
4. Anonymous at 1024×768, on the room's `/display/<code>`.
5. Anonymous at 390×844, on the guest sign-in page
   `/display/<code>/events/<id>/guest`:
   - pressed Sign In with the form empty;
   - entered the email `riley@`;
   - signed in Riley Nguyen with a double-click;
   - reloaded and signed in again with the same email.
6. As `admin`:
   - the event's external attendees (`GET /events/{id}/external-attendees`);
   - Prospective Members, in the Kanban view, the Table view and the "Recruitment Interest Night" source filter;
   - the event's own page.
7. As `member`:
   - `GET /locations`;
   - `POST /locations`;
   - `PATCH` and `regenerate-display-code` on the room;
   - the room's external attendees;
   - `/locations/qr-codes`;
   - `/locations`, where "Set Single-Station" was pressed.
8. As `admin`, QR Codes → Regenerate on Training Room A. Then, anonymous, the
   old and the new kiosk URLs, and the new one at 390×844.

## Held up ✅

- **Rooms:**
  - An empty name was refused with "Room name is required".
  - A double-clicked Add made **one** room.
  - That room mirrored into **one** location with its own display code, listed on the QR codes page with its kiosk URL.
- **The kiosk:**
  - It showed the event with a member QR and a guest QR.
  - It showed times in the department's zone ("10:36 PM – 12:36 AM" Central for a 03:36 UTC start) on a browser set to UTC.
- **The guest page on a phone:**
  - Sign In stays disabled until both names are filled.
  - The browser refused `riley@`.
  - Every field is 44px tall and labelled; the honeypot is hidden from people and from assistive technology.
  - Nothing overflows at 390px.
- **Signing in:**
  - A double-clicked Sign In, followed by a second sign-in with the same email after a reload, left **one** external attendee (source `kiosk_qr`, the note kept) and **one** prospect.
  - The second sign-in reported the original time.
- **`member` was refused:**
  - `POST`, `PATCH` and `regenerate-display-code` on locations returned 403.
  - The external attendee list returned 403.
  - `/locations/qr-codes` rendered Access Denied.
  - `GET /locations` returned the list with `display_code` redacted.
- **Regenerate:**
  - It asked first, and said what stops working.
  - The old kiosk URL then showed "Display not found. Check the URL." (the expected 404 in `events`), while the new URL served the event.

## Findings

### W23-1 — HIGH — A guest who signs in becomes an applicant nobody can see — FLAGGED

**Did:** anonymous, signed in on the guest page of an event set to create
prospects; then, as `admin`, opened Prospective Members.
**Saw:**

- The guest was told "We have your details. Someone will be in touch about becoming a member".
- The prospect was created with `pipeline_id: null` and no stage.
- Neither the Kanban nor the Table view lists it, and "Total Active" reads 1 while two prospects are active.
- The source filter offers "Recruitment Interest Night (1)" and, selected, shows "No applicants found".
- The event's own page lists "Riley Nguyen — No stage" under "1 applicant came from this event", with a "View in pipeline" link to a pipeline that does not contain the applicant.

**Why:**

- `create_prospect` places an unassigned prospect only in a pipeline flagged `is_default`.
- This department's only pipeline, created from Pipeline Settings, is not flagged: a pipeline is created with `is_default=False` unless someone sets it, and nothing prompts for it.
- The prospects screen reads one pipeline at a time.

The same path serves every intake that does not name a pipeline.
**Where:** `backend/app/services/membership_pipeline_service.py:5311`
(`_get_default_pipeline`), `backend/app/services/guest_check_in_service.py:210`,
`frontend/src/modules/prospective-members/store/prospectiveMembersStore.ts:390`.
**Not fixed because:** it decides where applicants land and whether existing
unplaced records move. The options are:

- fall back to the sole active pipeline when none is flagged;
- make a department's first pipeline its default;
- show unplaced applicants on the screen.

All of them change applicant records, and the prospects already stranded
need a backfill decision. Mirrored into `docs/KNOWN_LIMITATIONS.md`.

### W23-2 — HIGH — No screen shows who signed in as a guest — FLAGGED

**Did:** as `admin`, opened the event after a guest signed in.
**Saw:**

- The event page reads "Attendance (0)", "Checked In 0", and has no guest list.
- The sign-in exists (`GET /events/{id}/external-attendees` returns it).
- Nothing in the frontend calls `getExternalAttendees` or any of its sibling methods in `eventServices.ts`.

An event that takes guest sign-ins without creating prospects keeps them
where no officer can see them. With prospects on, they appear only through
W23-1's applicant list.
**Where:** `frontend/src/services/eventServices.ts:506` (unused), the event
detail page, `backend/app/api/v1/endpoints/events.py:3043` (`events.manage`).
**Not fixed because:** it needs a product decision on several points:

- where guests belong (the event page, check-in monitoring, attendance counts, exports);
- which of their contact details an event manager sees;
- whether they count in attendance figures.

Mirrored into `docs/KNOWN_LIMITATIONS.md`.

### W23-3 — LOW — Locations offered a member controls the server refuses — ✅ FIXED

**Did:** `member`, `/locations`, pressed "Set Single-Station".
**Saw:**

- The screen offered `member` Set Single-Station, Set Multi-Station, Run Setup Wizard and Add Station, plus Edit, Delete and Add Room on every station and room.
- The press fired `PATCH /organization/settings` → **403**, and the only word was "Failed to save setting".
- With no locations, the setup wizard opened for them on its own.

The page is deliberately open to every member, because events and forms pick
from these locations; its controls were not gated.
**Where:** `frontend/src/pages/LocationsPage.tsx:928`, `:1010`.
**Fix:** each control now mirrors its endpoint's permission:

- create and the wizard: `locations.create` or `locations.manage`;
- edit: `locations.edit` or `locations.manage`;
- delete: `locations.delete` or `locations.manage`;
- station mode: `settings.manage` or `organization.update_settings`.

A room card renders only the actions it is given.

Covered by the new `LocationsPage.test.tsx` (3 tests, all failing against the
old page). Re-driven: `member` sees only the room toggle; `admin` sees every
control.

### W23-4 — NIT — The kiosk's two QR codes have no accessible name — OPEN

**Where:** `/display/:code`. Each is labelled by the text beside it
("Department member", "Visiting us today?"), and nobody scans a QR code with
a screen reader, so this is left.

## Checklist

| Section                 | Result                                                                           |
| ----------------------- | -------------------------------------------------------------------------------- |
| 1. The job gets done    | ✅ room → kiosk → guest sign-in; ⚠ W23-1, W23-2 — the result has nowhere to show |
| 2. The right people     | ✅ API refuses `member`, code redacted; fixed W23-3                              |
| 3. Wrong input, failure | ✅ empty name, bad email, double submit, repeat sign-in                          |
| 4. Browser signals      | ✅ only the expected 404 for a regenerated code, and the 403 behind W23-3        |
| 5. Coming back to it    | ✅ regenerate retires the old URL                                                |
| 6. On a phone           | ✅ guest page and kiosk at 390×844                                               |
| 7. Everyone can use it  | ✅ labelled fields, hidden honeypot; W23-4 NIT                                   |
| 8. What happens around  | Flagged W23-1, W23-2                                                             |

## Completion gate

| Check                    | Result                                                               |
| ------------------------ | -------------------------------------------------------------------- |
| npm run typecheck        | clean                                                                |
| npm run lint             | clean                                                                |
| flake8 (changed files)   | no Python changed                                                    |
| black --check            | no Python changed                                                    |
| frontend tests (touched) | `LocationsPage.test.tsx` and the `RoomQRCodesPage` suite — 16 passed |
| backend tests (touched)  | none touched                                                         |
