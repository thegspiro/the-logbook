# Scheduling Module — Developer Reference

Routes, API endpoints, data model and frontend architecture for the
scheduling module. What the module does and how departments use it is on
[Scheduling Module](Module-Scheduling).

## Pages

| URL                               | Page                                      | Permission                                       |
| --------------------------------- | ----------------------------------------- | ------------------------------------------------ |
| `/scheduling`                     | Scheduling (member page)                  | Authenticated, Scheduling module enabled         |
| `/scheduling/checkin`             | Shift check-in (`?shift=<id>`)            | Authenticated                                    |
| `/scheduling/checkin/print`       | Printable check-in QR                     | Authenticated                                    |
| `/scheduling/shift-reports/print` | Printable shift report (`?id=<reportId>`) | Authenticated (report access checked by the API) |
| `/scheduling/admin`               | Scheduling Administration hub             | `scheduling.manage`                              |
| `/training/log-shift`             | Manual Shift Report (Training module)     | `training.manage`                                |

All `/scheduling` routes also require the Scheduling module to be enabled for
the organization.

### Scheduling tabs

| Tab           | `?tab=`         | Description                                                                        |
| ------------- | --------------- | ---------------------------------------------------------------------------------- |
| Schedule      | `schedule`      | The shift board                                                                    |
| My Shifts     | `my-shifts`     | Upcoming / Past / Hours (incl. Shifts with other departments), confirm/decline     |
| Open Shifts   | `open-shifts`   | Shifts with a seat you are cleared for; signing up puts you straight on the roster |
| Requests      | `requests`      | Swaps, open swaps to pick up, time off                                             |
| Shift Reports | `shift-reports` | Reports about you; with `training.manage`, the ones you write and review           |

### Scheduling Administration pages

| Page                      | URL                                              | Permission          |
| ------------------------- | ------------------------------------------------ | ------------------- |
| Shift Planning (gaps)     | `/scheduling/admin/planning`                     | `scheduling.manage` |
| Shift Templates           | `/scheduling/admin/planning/templates`           | `scheduling.manage` |
| Shift Patterns            | `/scheduling/admin/planning/patterns`            | `scheduling.manage` |
| Shift Close-Out           | `/scheduling/admin/closeout`                     | `scheduling.manage` |
| Scheduling Reports        | `/scheduling/admin/reports`                      | `scheduling.manage` |
| Platoons                  | `/scheduling/admin/platoons`                     | `scheduling.manage` |
| Shift History Import      | `/scheduling/admin/history-import`               | `scheduling.manage` |
| History Import review     | `/scheduling/admin/history-import/:importId`     | `scheduling.manage` |
| Who Can Fill What         | `/scheduling/admin/positions`                    | `scheduling.manage` |
| Settings (redirect)       | `/scheduling/admin/settings` (`?tab=` forwarded) | `scheduling.manage` |
| Settings (seven sections) | `/scheduling/admin/settings/<section>`           | `scheduling.manage` |

### Related pages in Inventory

| URL                                                 | Page                                       | Permission                                                                |
| --------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------- |
| `/inventory/checklists/my`                          | My Checklists (`?shift=<id>`)              | see [Inventory](Module-Inventory#equipment-checklists)                    |
| `/inventory/checklists/apparatus-inventory`         | Apparatus Inventory                        | any of `inventory.check_submit`, `inventory.check_view`, `inventory.view` |
| `/inventory/admin/checklists/supply`                | Expiring on Apparatus (supply worklist)    | any of `inventory.check_view`, `inventory.manage`                         |
| `/inventory/admin/checklists/templates/new`         | Equipment Check Template Builder           | `inventory.check_manage`                                                  |
| `/inventory/admin/checklists/templates/:templateId` | Edit Equipment Check Template              | `inventory.check_manage`                                                  |
| `/inventory/admin/checklists/reports`               | Equipment Check Reports                    | `inventory.check_view`                                                    |
| `/inventory/admin/checklists/settings`              | Checklist settings (incl. check-in timing) | see [Inventory](Module-Inventory#equipment-checklists)                    |

---

## API Endpoints

All scheduling routes are under `/api/v1/scheduling` and require the
Scheduling module to be enabled. "Officer" means the shift's own named
officer, who is admitted alongside the listed permission.

### Shifts and calendar

```
GET    /shifts                          # List shifts (scheduling.view)
POST   /shifts                          # Create shift (scheduling.manage)
GET    /shifts/open                     # Open shifts the caller can fill
GET    /shifts/needing-closeout         # Close-out backlog (scheduling.manage)
GET    /shifts/{id}                     # Shift detail; platoon_roster only for assign/manage/officer
PATCH  /shifts/{id}                     # Edit shift (scheduling.manage)
DELETE /shifts/{id}                     # Delete shift (scheduling.manage)
POST   /shifts/{id}/cancel              # Cancel, keeping the record (manage or officer)
POST   /shifts/{id}/reopen              # Reopen a finalized shift
GET    /shifts/{id}/handoff             # Pass-down notes for the next crew
POST   /shifts/{id}/late-signup         # Reopen signup on one shift
DELETE /shifts/{id}/late-signup         # Close it again
GET    /calendar/week                   # Week view (scheduling.view)
GET    /calendar/month                  # Month view (scheduling.view)
GET    /summary                         # Counts, incl. active_templates / active_patterns / shifts_scheduled
GET    /apparatus/{apparatus_id}/active-shift  # Shift currently on an apparatus
```

`GET /shifts/open` takes `start_date` (default: the department's today),
`end_date` (default: 30 days on) and `apparatus_id`. An inverted range or
one longer than 366 days is a `400`. A member gets the seat-level answer: a
shift is listed only when one of its unclaimed seats is a position the
member is cleared for, and shifts the member already holds are left out. A
holder of `scheduling.manage` gets the department-wide staffing-gap view,
judged on required seats. Either way at most 500 candidate shifts in the
window are examined. Every shift response carries its `roster` (seat
occupants), so a month of shifts arrives with its occupants in one request.

A finalized shift is locked: `DELETE /shifts/{id}` refuses it, as it refuses a
shift that has shift completion reports (remove the reports first), and
`POST …/cancel` and `POST …/late-signup` refuse it too. Cancelling keeps the
record (`status` `cancelled`, with who, when and why), so it is the route for a
shift that should not run.

### Signup, assignments and standing shifts

```
POST   /shifts/{id}/signup              # Self-signup
DELETE /shifts/{id}/signup              # Withdraw
GET    /shifts/{id}/assignments         # List assignments (scheduling.view)
POST   /shifts/{id}/assignments         # Assign member (scheduling.assign or officer)
PATCH  /assignments/{id}                # Edit assignment
DELETE /assignments/{id}                # Remove assignment
POST   /assignments/{id}/confirm        # Member confirms
POST   /assignments/{id}/decline        # Member declines
GET    /shifts/{id}/unavailable-members # User ids on leave/time off/already assigned (scheduling.assign)
GET    /availability                    # Member availability (scheduling.assign)
GET    /my-shifts                       # Caller's shifts
GET    /my-assignments                  # Caller's assignments, with embedded shift data
GET    /my-hours-history                # Caller's hours
GET    /standing-shifts/preview         # Preview a standing series
GET    /standing-shifts                 # Caller's standing claims
POST   /standing-shifts                 # Create a standing claim
DELETE /standing-shifts/{claim_id}      # End a standing claim
GET    /shifts/{id}/standing-claim      # Caller's claim covering this shift
```

A standing shift is a stored recurring claim, not a batch of assignments,
and it has two readers: creating a claim seats the member on matching
shifts already on record, and creating a shift (directly or by pattern
generation) seats every member whose active claim matches it. A claim may
run at most 366 days. Its `apparatus_id` is verified in-org before it is
stored, and claims go through the same self-service validation as any other
signup — eligibility, seat capacity, shift mutability and past dates all
apply.

### Eligibility

```
GET    /eligibility/positions           # Seats the caller may take (optionally for a shift)
GET    /eligibility/positions/bulk      # Same, for many shifts at once
GET    /eligibility/roster              # Who Can Fill What (scheduling.manage)
GET    /eligibility/settings            # Eligibility settings (scheduling.manage)
PUT    /eligibility/settings            # Update them (scheduling.manage)
```

`/eligibility/positions/bulk` answers once for many shifts (the board asks
once per day rather than once per shift): the expensive half of the answer
is about the member and is identical across the shifts.

**Driver exceptions** live on the apparatus router, `/api/v1/apparatus`, and
are surfaced on Who Can Fill What (`PositionRosterPage`, Driver exceptions
tab):

```
GET    /driver-exceptions                       # List (apparatus.view/manage or scheduling.view/manage)
GET    /driver-exceptions/approvers             # Who may approve
POST   /driver-exceptions                       # Request one (scheduling.assign, scheduling.manage or apparatus.manage)
POST   /driver-exceptions/{exception_id}/review # Approve or deny (apparatus.approve_driver_exception)
POST   /driver-exceptions/{exception_id}/revoke # Revoke (apparatus.approve_driver_exception)
GET    /evoc-check/{apparatus_id}/{user_id}     # Would this member clear the unit's EVOC level?
```

A request grants nothing until approved; the requester cannot approve it and
the member it covers cannot approve their own. `valid_until` is required and
at most 366 days after `valid_from` (`MAX_VALIDITY_DAYS` in `driver_exception_service.py`). A
NULL `apparatus_id` covers any unit; when both match, the unit-specific
exception is preferred. `apparatus.approve_driver_exception` is granted by
default to the fire chief, deputy chief and assistant chief positions and
ranks only. Revoking has no separation-of-duties bar. The EVOC check itself is
on while `org.settings["scheduling"]["enforce_evoc"]` is true (the default) and
does nothing until an apparatus names a `required_evoc_level_id`.

### Attendance, check-in and pre-shift work

```
POST   /shifts/{id}/attendance          # Add attendance (manage or officer)
GET    /shifts/{id}/attendance          # List attendance (scheduling.view)
PATCH  /attendance/{id}                 # Edit attendance (scheduling.manage)
DELETE /attendance/{id}                 # Remove attendance (scheduling.manage)
POST   /shifts/{id}/check-in            # Member check-in
POST   /shifts/{id}/check-out           # Member check-out
GET    /shifts/{id}/my-attendance       # Caller's attendance on a shift
GET    /my-attendance-history           # Caller's attendance (optional start_date/end_date; embeds shift date/times)
GET    /pre-shift-work/eligible-shifts  # Upcoming shifts the caller may log prep work against
GET    /pre-shift-work/active           # Caller's running session, or null
POST   /pre-shift-work                  # Start a session
POST   /pre-shift-work/{id}/end         # End it; it then awaits review
GET    /pre-shift-work/pending          # Department review queue (scheduling.manage)
GET    /shifts/{id}/pre-shift-work      # Sessions on a shift (manage or officer)
POST   /pre-shift-work/{id}/review      # Approve, adjust or reject (manage or officer, not own time)
```

### Close-out and calls

```
GET    /shifts/{id}/closeout            # Wizard state + resume point
PATCH  /shifts/{id}/closeout/attendance # Step 1 — who was on, and when
PATCH  /shifts/{id}/closeout/calls      # Step 2 — how many calls
POST   /shifts/{id}/finalize            # Step 3 — confirm and close
POST   /shifts/{id}/calls               # Log a call (detailed mode)
GET    /shifts/{id}/calls               # List a shift's calls (scheduling.view)
GET    /calls/{id}                      # One call (scheduling.view)
PATCH  /calls/{id}                      # Edit a call (scheduling.manage)
DELETE /calls/{id}                      # Delete a call (scheduling.manage)
```

The four close-out routes require `scheduling.manage` **or** being the shift's
own officer. `POST …/finalize` accepts `reported_call_count`,
`reported_call_types`, `member_call_counts`, `attach_call_ids`, `manual_hours`,
`override_incomplete_checks` + `override_reason`, and `pass_down_notes`.
`attach_call_ids` claims a call another unit already logged (listed as
`attachable_calls` on the close-out GET).

Each step writes real records as it advances, so an interrupted close-out
resumes rather than restarting. `closeout_step` in the GET response is `0`
(not started), `1` (attendance saved) or `2` (calls saved); a finalized
shift reports `0`, and reopening a shift restarts the wizard.
`attachable_calls` lists calls another unit logged while this shift was on;
it is populated only for `count_only` call tracking on a shift that is not
yet finalized.

`PATCH …/closeout/calls` accepts `reported_call_count`,
`reported_call_types`, `attach_call_ids` and `detach_call_ids` (withdraw an
earlier claim). An explicit `null` count clears a previously reported
figure and is distinguished from an omitted field, so a client that only
attaches calls does not wipe a count it never mentioned.
`reported_call_types` is keyed by the organization's own type slugs; a
tally larger than the total is refused, and a shorter tally records the
remainder as unclassified. `override_incomplete_checks` on finalize is
audited as `shift_finalized_check_override` (with `override_reason`), and
finalizing creates draft shift completion reports for trainees on the
shift.

The detailed call routes (`/shifts/{id}/calls`, `/calls/{id}`) are refused
with a `400` unless the organization's call tracking is in `detailed` mode;
a `count_only` department records volume through close-out instead (see
[Module-Scheduling → Call Volume Without an RMS](Module-Scheduling#call-volume-without-an-rms)).
`POST /shifts/{id}/calls` requires `scheduling.manage` or being the shift's
officer, and `incident_type` is required.

### Templates, patterns and apparatus

```
GET    /templates                       # List templates (scheduling.view)
POST   /templates                       # Create (scheduling.manage)
GET    /templates/{id}                  # Get (scheduling.view)
PATCH  /templates/{id}                  # Edit (scheduling.manage)
DELETE /templates/{id}                  # Delete (scheduling.manage)
GET    /patterns                        # List patterns (scheduling.view)
POST   /patterns                        # Create (scheduling.manage)
GET    /patterns/{id}                   # Get (scheduling.view)
PATCH  /patterns/{id}                   # Edit (scheduling.manage)
DELETE /patterns/{id}                   # Delete (scheduling.manage)
POST   /patterns/{id}/generate          # Generate shifts (scheduling.manage; at most 366 days)
GET    /apparatus-options               # Apparatus choices for pickers
GET    /apparatus                       # List basic apparatus
POST   /apparatus                       # Create basic apparatus (scheduling.manage)
PATCH  /apparatus/{id}                  # Edit (scheduling.manage)
DELETE /apparatus/{id}                  # Delete (scheduling.manage)
```

### Swaps and time off

```
GET    /swap-requests                   # Paginated {items,total,skip,limit} (scheduling.swap or manage)
POST   /swap-requests                   # Request a swap (scheduling.swap)
GET    /swap-requests/open              # Open swaps the caller is cleared to pick up (scheduling.swap)
POST   /swap-requests/{id}/pick-up      # Take an open swap; the seat moves to the caller (scheduling.swap)
GET    /swap-requests/{id}              # One request (participants and reviewers)
POST   /swap-requests/{id}/review       # Officer review (scheduling.manage; not a participant)
POST   /swap-requests/{id}/respond      # Target member accepts/declines a one-way offer
POST   /swap-requests/{id}/cancel       # Requester cancels (scheduling.swap)
GET    /shifts/{id}/trade-candidates    # Who could take the caller's seat
GET    /shifts/{id}/exchange-candidates # Qualifying two-way exchange pairs
GET    /time-off                        # Paginated {items,total,skip,limit} (scheduling.view)
POST   /time-off                        # Request time off (scheduling.swap)
GET    /time-off/{id}                   # One request (scheduling.view)
POST   /time-off/{id}/review            # Approve/deny (scheduling.manage; not the requester)
POST   /time-off/{id}/cancel            # Requester cancels (scheduling.swap)
```

Both list routes take `skip` (default 0) and `limit` (default 100,
max 1000) and a `status` filter; `/swap-requests` also takes `mine=true`
(only swaps the caller is a participant in) and `/time-off` takes
`user_id`. Requests are visible to their participants; a requester cannot
review their own swap or time-off request even holding
`scheduling.manage`.

`trade-candidates` returns only members who could actually accept: anyone
already on the shift, on leave or approved time off, not cleared for the
seat's position, or rostered on a shift that overlaps or abuts this one
(within an hour) is excluded. Candidates carry the month's shift count and
whether they owe the offerer a trade, and are ranked least-loaded first.
Holding no seat on the shift is a `409`, not an empty list.

`respond` is participant acceptance, distinct from manager review (which
refuses participants). It completes a one-way targeted offer: accepting is
the offerer withdrawing and the accepter signing up, in one step. Approved
time off is rechecked at acceptance.

**Two-way exchanges.** `GET /shifts/{id}/exchange-candidates` lists only pairs
where both members are cleared for the seat they would take, and answers
`409` when the caller holds no seat on the shift. `POST
/swap-requests/{id}/review` accepts `override_qualification: true`, which
waives only the position-qualification check on an exchange; it is noted on
the request and audited (`shift_exchange_qualification_override`, with the
reviewer's notes as the reason). Without it, a pair that is no longer
qualified is refused `400` with code `LB-SCHED-002`.

### Reports, dashboard, settings, feed and platoons

```
GET    /reports/member-hours            # (scheduling.report)
GET    /reports/coverage                # (scheduling.report)
GET    /reports/call-volume             # Detailed-mode shift calls by day/week/month (scheduling.report)
GET    /reports/compliance              # Shift Compliance (scheduling.report)
GET    /dashboard/widgets               # Staffing widgets, window < 93 days (scheduling.manage)
GET    /dashboard/widget-preferences    # Per-member tile settings (scheduling.manage)
PUT    /dashboard/widget-preferences    # (scheduling.manage)
GET    /settings                        # Feature settings (any member)
PUT    /settings                        # Update feature settings (scheduling.manage)
GET    /shift-settings                  # Department defaults (scheduling_module_configs)
PUT    /shift-settings                  # Update them (scheduling.manage)
GET    /calendar-feed                   # Caller's private ICS URL
POST   /calendar-feed/rotate            # Reset the URL
GET    /platoons/overview               # Department platoon roster (scheduling.manage)
POST   /platoons/bulk-assign            # Bulk platoon assignment (scheduling.manage; audited)
```

`/dashboard/widgets` takes `start_date`, `end_date` and optional
`station_id`, `platoon`, `shift_type` and `position`. An inverted window,
or one whose end is 93 or more days after its start, is a `422`.
`station_id` and `platoon` are validated against the organization's own
lists, and an unknown value is a `422` rather than an empty result.
Preferences are stored per member and per widget, one entry for each of the
seven tiles (`today_staffing`, `future_coverage_gaps`, `open_slots`,
`pending_staffing_changes`, `incomplete_closeouts`, `workload_balance`,
`special_operations`); an unknown widget key on save is a `422`, and a
saved station or platoon that no longer exists is dropped on read.

### Shifts with other departments — `/api/v1/scheduling/external-hours`

```
POST   /                                # Log an outside shift (caller)
GET    /my                              # Caller's entries
PATCH  /{entry_id}                      # Edit own entry
DELETE /{entry_id}                      # Delete own entry
GET    /                                # All entries (scheduling.manage or scheduling.report)
POST   /{entry_id}/reject               # Reject with a reason (scheduling.manage)
POST   /{entry_id}/restore              # Restore (scheduling.manage)
GET    /summary                         # Per-unit summary (scheduling.manage or scheduling.report)
GET    /apparatus-options               # Departments and units members may pick
GET    /agencies                        # Outside departments (scheduling.manage)
POST   /agencies                        # (scheduling.manage)
PATCH  /agencies/{agency_id}            # (scheduling.manage)
DELETE /agencies/{agency_id}            # (scheduling.manage)
POST   /agencies/{agency_id}/apparatus  # Add a unit (scheduling.manage)
PATCH  /apparatus/{apparatus_id}        # (scheduling.manage)
DELETE /apparatus/{apparatus_id}        # Refused once shifts are logged on it (scheduling.manage)
```

### Shift history import — `/api/v1/scheduling/history-import`

All routes require `scheduling.manage`.

```
GET    /template                        # Download the CSV template
GET    /                                # List imports
POST   /                                # Upload a CSV as a draft
GET    /{import_id}                     # Import with rows and proposals
PATCH  /{import_id}                     # Import settings (e.g. timezone)
PATCH  /{import_id}/rows/{row_id}       # Edit one row (e.g. keep_separate)
PUT    /{import_id}/mappings            # Member / unit / position decisions
POST   /{import_id}/commit              # Commit (final)
DELETE /{import_id}                     # Discard the draft
```

### Shift completion reports — `/api/v1/training/shift-reports`

```
POST   /                                # Create a report
POST   /batch                           # Batch-create for a shift's crew → {created, skipped}
GET    /shift-crew/{shift_id}           # Crew and report status for a shift
GET    /shift-preview/{shift_id}/{trainee_id}  # Pre-fill data (training.manage)
GET    /my-reports                      # Reports about the caller
GET    /my-stats                        # Caller's stats
GET    /drafts                          # Drafts (caller's own unless training.manage)
POST   /drafts/submit-all               # Submit the caller's own drafts
GET    /pending-review                  # (training.manage)
GET    /flagged                         # (training.manage)
GET    /all | /by-status | /by-officer  # (training.manage)
GET    /officer-analytics               # (training.manage)
GET    /trainee/{trainee_id}            # (training.manage)
GET    /trainee/{trainee_id}/stats      # (training.manage)
GET    /{report_id}                     # Trainee (approved only), filing officer, or training.manage; else 404
PUT    /{report_id}                     # Update
POST   /{report_id}/acknowledge         # Trainee acknowledges
POST   /{report_id}/review              # Approve/flag; redact_fields clears fields before the trainee sees it (training.manage)
POST   /batch-review                    # Up to 100 reports → {reviewed, failed} (training.manage)
```

Skill linkage for the settings panel: `GET /api/v1/training/module-config/skill-names`.

### Equipment-check supply endpoints — `/api/v1/equipment-checks`

See [Who can write what](Module-Scheduling#who-can-write-what) for the permission split.

```
GET    /supply/expiring-items?days_ahead=30              # The supply worklist: expiring, expired,
                                                         #   short or reported-used positions, with
                                                         #   the ready stock behind each
GET    /supply/item-deployments/{inventory_item_id}      # Reverse lookup: which trucks carry this item
GET    /apparatus/{apparatus_id}/inventory               # Standing view of one truck, outside any check

POST   /items/{template_item_id}/used                    # Report used/pulled — raises a restock report
DELETE /items/{template_item_id}/used                    # Withdraw the report (also clears reporter + note)
PUT    /items/{template_item_id}/quantity                # Recount; reconciles against the deployed lots
POST   /items/{template_item_id}/swap                    # Move a ready lot onto the truck

GET    /items/{template_item_id}/deployed-lots           # Lots aboard, soonest-to-expire first
PUT    /items/{template_item_id}/deployed-lots/{lot_id}  # Correct one lot: count + number + date together

GET    /templates/{template_id}/inventory-matches        # Propose a catalog item per unlinked position
POST   /templates/{template_id}/inventory-links          # Apply a reviewed set of links
GET    /inventory-link-report                            # Unlinked positions across all checklists, grouped by name
POST   /inventory-links                                  # Apply links across checklists, all or nothing;
                                                         #   the response lists skipped_positions
```

| Route group                                                             | Accepted permissions                                                     |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `GET /supply/expiring-items`                                            | `inventory.check_view` or `inventory.manage`                             |
| `GET /supply/item-deployments/…`                                        | `inventory.check_view` or `inventory.view`                               |
| `GET /apparatus/…/inventory`, `GET …/deployed-lots`                     | `inventory.check_view`, `inventory.check_submit` or `inventory.view`     |
| `POST …/used`, `PUT …/quantity`, `PUT …/deployed-lots/…`, `POST …/swap` | `inventory.check_submit`, `inventory.check_manage` or `inventory.manage` |
| `DELETE …/used`                                                         | `inventory.check_manage` or `inventory.manage`                           |
| Catalog matching and linking                                            | `inventory.check_manage`                                                 |

Submitters (holding neither `inventory.check_manage` nor `inventory.manage`)
are narrowed rather than shut out: on `PUT …/deployed-lots/{lot_id}` a
change to a lot's `lot_number` or `expiration_date` is a `403` (a
quantity-only save, including one that round-trips unchanged values,
passes); on `POST …/swap` they may deploy only enough stock to fill the
position's shortfall or replace the expired units aboard, and may not make
a position's first catalog link.

| Behaviour               | Detail                                                                                                                                                                                                                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Derived values**      | A position's count is the sum of its deployed lots; its expiration is the earliest of them                                                                                                                                                                                                                     |
| **Consumption order**   | First-expiring-first-out; undated lots sort last                                                                                                                                                                                                                                                               |
| **Expiry**              | Recomputed server-side from the soonest date aboard. A client-supplied `is_expired` is ignored — that flag force-fails a safety-critical item                                                                                                                                                                  |
| **Expired shelf stock** | Excluded from ready stock, flagged in the payload, and refused by `POST …/swap` with a `400`                                                                                                                                                                                                                   |
| **Lot corrections**     | `PUT …/deployed-lots/{lot_id}` requires `quantity`; `lot_number` and `expiration_date` are partial (omitted leaves alone, `null` clears). `quantity: 0` removes the lot                                                                                                                                        |
| **Match confidence**    | `inventory-matches` returns a `score` and a `confidence` of `exact`, `strong` or `weak`, plus `matchedAlias` when an item's "also called" name rather than its own produced the match. Only `exact` (the same words) is pre-selected client-side; a plural, a near-spelling or an alias match never reaches it |
| **404 vs 400**          | An unknown template, item or lot is a `404`; a business-rule refusal (expired lot, over-draw, cross-org reference) is a `400` via `safe_error_detail()`                                                                                                                                                        |

The rest of the equipment-check API is documented in the
[Inventory module](Module-Inventory#equipment-checklists).

---

## Data Model

| Table                                                                                   | Purpose                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shifts`                                                                                | One shift: date, start/end, `apparatus_id`, `station_id`, `template_id`, `platoon`, `shift_officer_id`, `color`, `positions` (JSON seat list), `min_staffing`, `notes`, `pass_down_notes`, `open_to_all_members`, `call_count`, `closeout_step`, `late_signup_until`, `is_finalized`, `status` (+ `cancelled_at` / `cancelled_by` / `cancellation_reason`) |
| `shift_assignments`                                                                     | A member on a seat: `position` (VARCHAR seat token), `assignment_status` (`assigned`, `confirmed`, `declined`, `pending`, `cancelled`, `no_show`), training-slot fields (`is_training`, `training_program_id`, `training_evaluator_id`). `UniqueConstraint(shift_id, user_id)`; index `idx_shift_assign_shift_status` on `(shift_id, assignment_status)`   |
| `shift_attendance`                                                                      | Check-in/out times and per-member `call_count`                                                                                                                                                                                                                                                                                                             |
| `shift_pre_work_sessions`                                                               | Pre-shift work sessions and their review                                                                                                                                                                                                                                                                                                                   |
| `shift_calls`                                                                           | Per-incident calls (detailed mode)                                                                                                                                                                                                                                                                                                                         |
| `org_calls` / `org_call_responses`                                                      | Count-only calls (`call_date` is a date) and each unit's response to one                                                                                                                                                                                                                                                                                   |
| `shift_templates`                                                                       | Reusable configuration: hours, `positions` (seat list or event metadata), `min_staffing`, colour, vehicle                                                                                                                                                                                                                                                  |
| `shift_template_equipment_checks`                                                       | The checklists a template names for its shifts                                                                                                                                                                                                                                                                                                             |
| `shift_patterns`                                                                        | Generation patterns (daily, weekly, platoon, custom; JS weekday convention 0 = Sunday, mapped server-side)                                                                                                                                                                                                                                                 |
| `standing_shift_claims`                                                                 | Recurring claims: `pattern`, `weekday`, `period`, `position`, `apparatus_id`, `start_date`, `end_date`, `is_active`                                                                                                                                                                                                                                        |
| `shift_swap_requests`                                                                   | Swaps, offers and exchanges                                                                                                                                                                                                                                                                                                                                |
| `shift_time_off`                                                                        | Time-off requests                                                                                                                                                                                                                                                                                                                                          |
| `basic_apparatus`                                                                       | Scheduling's own apparatus list for departments without the Apparatus module                                                                                                                                                                                                                                                                               |
| `scheduling_module_configs`                                                             | One row per org: department defaults (duration, minimum staffing, …)                                                                                                                                                                                                                                                                                       |
| `external_agencies` / `external_apparatus` / `external_shift_hours`                     | Shifts with other departments (`start_at` / `end_at`; at most 48 h per entry)                                                                                                                                                                                                                                                                              |
| `shift_history_imports` / `shift_history_import_rows` / `shift_history_import_mappings` | Shift history import drafts and persisted decisions                                                                                                                                                                                                                                                                                                        |
| `check_item_deployed_lots`                                                              | One row per lot aboard one checklist position (Inventory)                                                                                                                                                                                                                                                                                                  |
| `shift_completion_reports`                                                              | Training's shift reports; `UniqueConstraint(shift_id, trainee_id)` (`uq_shift_report_shift_trainee`)                                                                                                                                                                                                                                                       |
| `driver_exceptions`                                                                     | Chief-approved permission for a member to drive below a unit's EVOC level: `apparatus_id` (NULL = any), `status` starting `pending`, `valid_from` / `valid_until`                                                                                                                                                                                          |

Status values: `shifts.status` is `scheduled` or `cancelled` (finalizing is the
separate `is_finalized` flag); swap and time-off requests are `pending`,
`approved`, `denied` or `cancelled`.

Related columns elsewhere:

- `users.platoon`, `users.calendar_feed_token`
- `operational_ranks.eligible_positions` (JSON) — seats a rank may take
- `apparatus.required_evoc_level_id` → `evoc_levels`
- `training_requirements.shift_credited`
- `training_module_configs`: `form_show_*`, `apparatus_type_skills`,
  `apparatus_type_tasks`, `rating_label`, `rating_scale_type`,
  `rating_scale_labels`, `report_review_role`

Seat lists in `shifts.positions`, `shift_templates.positions` and
`basic_apparatus.positions` have one canonical stored shape,
`[{"position": str, "required": bool}]`, normalized on write by
`app/utils/positions.normalize_stored_positions`; a bare string reads as
`required=true`. Template positions are copied onto each shift when it is
created, so later template edits do not change existing shifts.

Every path that seats a member — signup, officer assignment and edit, swap
review, offer acceptance, open-swap pickup and standing-shift seating — checks
the requested seat with one function, `app.utils.positions.resolve_seat`,
against **that shift's** seats. A seat the shift names is matched
case-insensitively and stored in the shift's spelling; one of the ten built-in
seats (`officer`, `driver`, `firefighter`, `ems`, `paramedic`, `captain`,
`lieutenant`, `probationary`, `volunteer`, `other`) the shift does not name is
left to the capacity check; anything else — including another department's
seat — is a `422` with `LB-SCHED-003`. Seat names are at most 100 characters
(`VARCHAR(100)` assignment columns).

Settings live in `org.settings`: `scheduling` (platoons, overtime advisory,
auto-generation, close-out rules, signup window, call tracking, decline
alerts), `scheduling_assignment`, `shift_reminders`, and `shift_reports`
(`member_summary`, `follow_up`, `post_shift_validation`, `checklist_timing`).

Scheduling response schemas derive from `UTCResponseBase`, which stamps naive
datetimes as UTC; all times are stored in UTC and shown in the department's
timezone.

---

## Scheduled Tasks

Defined in `SCHEDULE` and `TASK_RUNNERS` in
`backend/app/services/scheduled_tasks.py` and run by the backend's in-process
task loop.

| Task                               | Cadence      | What it does                                                                                                |
| ---------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------- |
| `shift_auto_checkout`              | every 15 min | Checkout reminders at shift end; auto-checks-out anyone still in 30 minutes later                           |
| `shift_reminders`                  | every 30 min | Start-of-shift reminders, with the shift's equipment checklists, to assigned members                        |
| `post_shift_validation`            | every 30 min | Asks shift officers to validate attendance and timing after the shift ends                                  |
| `end_of_shift_checklist_reminders` | every 30 min | Reminds assigned members to complete end-of-shift equipment checklists before the shift ends                |
| `end_of_shift_summary`             | every 30 min | Email and in-app summary (hours, calls, report link) to each member who attended                            |
| `shift_pattern_generation`         | daily 04:00  | Generates upcoming shifts from active patterns where auto-generation is on                                  |
| `swap_offer_expiry`                | daily 05:30  | Expires swap offers nobody accepted by the day before the shift and tells both members and the duty officer |
| `trainee_report_escalation`        | daily 08:00  | Escalates shift completion reports awaiting trainee acknowledgment past the window (default 7 days)         |

---

## Frontend Architecture

- **Routes** — `modules/scheduling/routes.tsx` (`getSchedulingRoutes()`), every
  page lazy-loaded through `lazyWithRetry()`. Settings section paths are written
  once in `modules/scheduling/components/schedulingSettingsSections.ts`.
- **Store** — `modules/scheduling/store/schedulingStore.ts` (Zustand) caches
  shifts, templates, patterns, members and apparatus.
- **Services** — `modules/scheduling/services/api.ts` (module client built with
  `createApiClient()`), `shiftSettingsApi.ts`, `historyImportApi.ts`.
- **Types** — `modules/scheduling/types/index.ts`, `shiftSettings.ts`,
  `historyImport.ts`.
- **Utilities** — `utils/shiftBoard.ts` (chip text, open seats, shortness —
  shared by the board and the staffing-gaps view), `staffingGaps.ts`,
  `closeoutQueue.ts`, `standingShift.ts`, `patternGeneration.ts` (generation
  summary and EVOC driver warnings), `positionLabels.ts`.
- **Member page** — `pages/SchedulingPage.tsx` with tabs in `pages/scheduling/`:
  the board (`board/ShiftBoard.tsx`, `MonthGrid`, `DayDetailPanel`,
  `PhoneMonth`, `PhoneDaySheet`, `StandingShiftModal`, `GiveUpShiftModal`),
  `MyShiftsTab`, `OpenShiftsTab`, `RequestsTab` (+ `OpenSwapPickups`),
  `ShiftReportsTab`, and `ShiftDetailPanel` / `ShiftCloseoutWizard`.
- **Administration** — `pages/scheduling/admin/` (`SchedulingAdminHub`,
  `SchedulingSetupGuide`, `schedulingHubCards.ts`, `planning/`, `closeout/`,
  `historyImport/`), plus `SchedulingSettingsPage`, `SchedulingPlatoonsPage`,
  `PositionRosterPage` and `SchedulingAdminReportsPage`. Templates are
  `pages/ShiftTemplatesPage.tsx` with `TemplateFormModal`, `PatternFormModal`,
  `GenerateShiftsModal` and `shiftTemplateTypes.ts`.
- **Administration header** _(2026-10-25)_ — the same area navigation Training
  and Inventory Administration draw. `SchedulingAdminLayout` wraps
  `AdminHubFrame` with seven area cards and a page strip
  (`SchedulingAdminNav`); `schedulingAdminAreas.ts` builds the areas from
  `schedulingHubCards.ts`, so each page keeps its route's gate. Every route in
  `SCHEDULING_ADMIN_SHELL_PATHS` wraps its page in the layout, inside its
  `ProtectedRoute`; `schedulingAdminAreas.test.ts` fails if the routes and the
  list drift. The wrapped pages draw no title, back arrow or trail of their
  own (an `sr-only` `<h2>` keeps heading navigation). The header's
  **Create Shift** links to `/scheduling?create=shift`, which `SchedulingPage`
  reads once to open its Create Shift dialog.
  `SchedulingSettingsPage` does not use `SettingsLayout`: the header's
  Settings strip is its section nav, and a card with `requiresPlatoons`
  (Platoon Rosters) is offered only while platoon scheduling is on — the
  layout reads `platoonsEnabled` from the scheduling store.
- **Settings components** — `ShiftSettingsPanel` composed of
  `ApparatusTypeDefaultsCard`, `DepartmentDefaultsCard`, `PositionNamesCard`,
  `ResourceTypeDefaultsCard`, `TemplatesOverviewCard`, `PositionListEditor`,
  `CallTypesCard`, `EligibilitySettingsCard`; plus `SchedulingNotificationsPanel`,
  `ShiftReportsSettingsPanel` (with `EditableTagList`) and
  `OutsideApparatusSettings`.
- **Shift report storage** — `utils/shiftReportDrafts.ts` (localStorage, 20
  drafts) and `utils/shiftReportOfflineQueue.ts` (IndexedDB).
- **Shift card colours** pass 4.5:1 contrast via `utils/colorContrast.ts`.

---
