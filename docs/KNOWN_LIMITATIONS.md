# Known Limitations & Open Decisions

This page consolidates known limitations and deferred design decisions surfaced
by the ongoing code review (see [review-log.md](./review-log.md) for the raw
findings and rotation). Items here are **intentionally open** — they need an
owner decision or are accepted trade-offs — rather than undocumented bugs. When
one is resolved, remove it here in the same change; the pull request records the
fix (`CHANGELOG.md` is closed to new entries — see `CLAUDE.md`). A resolved
entry stays only while code, tests or `CLAUDE.md` still cite it by name.

> **Pruned 2026-10-04.** Entries whose own text recorded them as fully resolved
> were removed: 45 table rows and 15 sections. A resolved entry was kept where
> source code, a test or `CLAUDE.md` cites it by name (ONBOARD-5, ONBOARD-7,
> "No nested `frontend/package-lock.json`") or where it still carries a live
> procedure or operator flag (the `20260808_0002` repair steps, SEC-7/SEC-8,
> the two-apparatus-tables rule). Git history holds the removed text.

> Severity reflects review classification, not an SLA. "Open decision" means a
> reasonable person could choose either way; "Accepted" means we've decided to
> live with it for now.

> **Drift check, 2026-08-07.** A sweep of the MED-severity rows found several
> describing code that had since been fixed — the CSRF no-cookie branch, the
> role grant ceiling and last-admin guard (ORU-7), the skills-test
> self-certification half of CS-8, the shared-device PII purge (FE-6/FE-7), and
> the black pin drift. The fixes landed; the rows did not get updated. That
> direction of staleness is the dangerous one: this page is what a compliance
> reviewer reads and what the next audit uses to aim, so overstating open risk
> misdirects effort and understates the product.
>
> Staleness cuts both ways, though, and the sweep itself proved it. FIN-4 was
> initially marked resolved here on the strength of `assert_different_person`
> appearing in `finance_service` — but that guard sat on the **approval** step,
> not on disbursement, so `mark_pr_paid` / `issue_check` / `waive_dues` were
> gated by `finance.manage` alone. Read the call site, not the import: "the
> guard exists in this file" is not the same claim as "this path is guarded."
>
> **The example has since closed, and this note was itself stale for it**
> (corrected app-review A9 pass 3, 2026-10-04): all three of those methods now
> call the guard, verified by extracting every `assert_different_person` call
> site and its arguments from the AST rather than by grepping the file. The
> lesson stands and the illustration is kept deliberately — but a present-tense
> "remain gated by `finance.manage` alone" sitting in this page's own preamble
> was precisely the dangerous direction of staleness the paragraph above
> describes. See the FIN-4 row for what is actually left.
>
> Rows are annotated with the date they were last _verified against the code_,
> not just the date they were written. When you fix something listed here,
> update its row in the same change.

## Authentication & Security

| Item                                                                                                                                  | Status                                                                                                                                   | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Several `config.py` settings have no reader anywhere in the backend**                                                               | 🚩 Open (LOW, 2026-09-07, security review CI3-33)                                                                                        | An exhaustive per-field reference sweep of `app/core/config.py` found more declared-and-documented settings with zero readers outside their own declaration: `RATE_LIMIT_PER_MINUTE` (actual limits are hardcoded per-scope in `security_middleware.py`'s `rate_limit_*()` helpers and the separate `RATE_LIMIT_DEFAULT` string, which _is_ read), `MAX_FILE_SIZE` and `STORAGE_TYPE` (`documents_service.py`/`documents.py` hardcode their own `UPLOAD_DIR` and size handling independently of these), and `DB_POOL_MIN` (only `DB_POOL_MAX` reaches `create_async_engine`). None of these gate a security control the way `REGISTRATION_REQUIRES_APPROVAL` does — they are tuning knobs an operator would set expecting an effect and silently get none. `LDAP_*` is a separate, already-documented case (CLAUDE.md: "exists in config but gates nothing — LDAP is not implemented"). See `docs/security-review/CI3-33-core-infra.md` (CI3-33-4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **A failed public-portal authentication is never recorded, so its anomaly detector cannot fire**                                      | 🚩 Open (LOW, 2026-09-08, security review PUB-8)                                                                                         | `detect_anomalies` counts `public_portal_access_log` rows with `status_code == 401` in the last five minutes (`app/core/public_portal_security.py:337-347`), but nothing has ever written one: the only caller of `log_access` is `app/api/public/portal.py`, and `authenticate_api_key` raises its 401 from the dependency, before any handler runs. Writing one needs `PublicPortalAccessLog.organization_id` and `config_id` to be nullable — an unknown API key cannot be attributed to an organization, and both are `nullable=False` (`app/models/public_portal.py:202-210`) even though the model's own comment beside `api_key_id` says "NULL if invalid/missing key". That is a migration plus a decision about how an unattributable row is scoped for the per-organization admin read. The related half — error-path rows being rolled back with the request transaction — was fixed on 2026-09-08. Until then the per-IP limiter and `suspicious_ip` are the controls covering failed portal auth. See `docs/security-review/PUB-03-public-surface-webhooks.md` (PUB-8). **Narrowed 2026-09-24 (PR #2665):** the _rate-limit_ refusal is now recorded. A 429 is raised from the same dependency, and was invisible for the same reason, but it needs none of what the 401 is blocked on — a rate-limited key has just been resolved, so `organization_id` and `config_id` are both in hand and no nullability migration is required. `authenticate_api_key` writes and commits that row before raising, which is what lets the admin dashboard's "Rate Limits Hit" tile and its alert condition leave zero. The 401 half is unchanged and still blocked on the nullable-column decision above: an unknown key cannot be attributed to an organization. |
| **A member's phone and mobile are free text, and any text counts as "a number on file"**                                              | ✅ Resolved (owner decision 2026-10-05: lenient validation on new writes only, existing rows untouched; workflow review W04-7)           | Member phone and mobile now accept digits, spaces, dashes, dots, brackets, a leading `+` and an extension (`ext 4`, `x4`, `#4`), with 7–15 digits before the extension (`app/utils/phone_numbers.py`). Creating a member refuses anything else (`422`); `PATCH /users/{id}/contact-info` and `PATCH /users/{id}/profile` refuse a changed value that fails (`400`, naming the field) and pass one sent back unchanged, so a member whose stored number predates the rule can still save the rest of their profile. Stored values were not rewritten, so the Notifications tab's `hasMobileOnFile` can still count a legacy non-number as a mobile on file until it is edited. (`tests/test_member_phone_validation.py`.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Two positions can share a name, and nothing tells them apart where they are assigned**                                              | ✅ Resolved (owner decision 2026-10-05: refuse duplicates on create/rename, existing duplicates left and flagged; workflow review W05-5) | Creating, cloning or renaming a position to a name another position in the organization already uses — compared trimmed and case-insensitively — is refused with `409` (`RoleManagementService._assert_position_name_free`, which locks the organization row so two concurrent creates cannot both pass). Positions that already share a name are not touched: saving one without renaming it still works, and Role Management marks each with **Same name as another position** and its internal name (slug) so an administrator can rename one apart. No unique index or migration, because existing duplicates would block it. Onboarding's position setup writes its own rows and is not covered. (`tests/test_position_name_uniqueness.py`.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Add Member cannot set a new member's account status or preferred contact method**                                                   | ✅ Resolved (owner decision 2026-10-05: add status to the create endpoint as a new optional field; workflow review W08-1)                | `POST /users` takes an optional `status` — `active` (the default when omitted), `inactive` or `leave` — and creates the member with it. Dropped, retired, archived and suspended are refused at create, because the status change is what records their service history and property return. Add Member offers Active / Inactive / On Leave again and sends the choice. Preferred contact method is still not recorded: the owner chose the status-only option, so there is no field and the form offers no control for it. (`tests/test_add_member_initial_status.py`, `AddMember.test.tsx`.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **A member's base Member position can be removed like any other**                                                                     | ✅ Resolved (owner decision 2026-10-05: refuse unless the member is archived; workflow review W11-9)                                     | The base `member` position carries the baseline grants every member needs, so taking it off a member who is not archived is now refused with `400` on both write paths — the single removal and the replace-all assignment the admin screens use (`_refuse_base_position_removal` in `users.py`). Manage Roles no longer offers the remove control on it and keeps its box ticked and locked; an archived member's can still be removed. (`tests/test_base_member_position_removal.py`, `MembersAdminPage.test.tsx`.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **A waiver cannot excuse meetings without also excusing shifts**                                                                      | Accepted by the owner (2026-10-05; workflow review W13-5)                                                                                | Waiver Management offered "Meeting Attendance" and "Shift Requirements" as separate choices, and either one created the same leave of absence — `member_leaves_of_absence` has no field saying which it covers, and scheduling, attendance and tier grading all treat a leave as excusing both. The form now offers one "Meeting Attendance & Shift Requirements" choice, which is what the data has always meant (W13-1). **Accepted by the owner (2026-10-05): one combined waiver stays.** The UI already states the combined meaning, no department has asked to excuse one without the other, and the split would need a column, a migration and a change to every reader of leaves. Revisit if a department asks for it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **A departure clearance cannot be worked or completed from any screen**                                                               | 🚩 Open (MED, 2026-09-28, workflow review W15-2)                                                                                         | Driven on the review install: a member dropped while holding property gets a departure clearance, and Inventory Administration links it to Members Equipment. Returning the item there unassigns it but leaves the clearance `initiated` with the item outstanding, so the member is never auto-archived (`check_and_auto_archive` stops while any clearance is open). Only `POST /inventory/clearances/{id}/items/{line}/resolve` and `…/complete` close one, and no screen calls either; the service deliberately keeps a fully resolved clearance open for staff review. Either a clearance screen (resolve each line, then complete) or resolving a line automatically when its item is returned the ordinary way — which changes that review design — needs deciding.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **A member dropped today cannot be reinstated until tomorrow**                                                                        | ✅ Resolved (owner decision 2026-10-05: an undo-drop action; workflow review W15-3)                                                      | `record_rejoin` still refuses a return date on or before the last day of service, by design. A mistaken drop is now undone instead: `POST /users/{id}/undo-drop` (`members.manage`) restores the member — Active by default, or Probationary, Inactive or On Leave; never Suspended — and reopens the service stint the drop closed, so their service runs on unbroken. It is available for **7 days** after the drop (`UNDO_DROP_WINDOW_DAYS`; `GET /users/{id}/undo-drop` reports whether and until when), because after that it would erase a real gap; a member who really left and came back is a rejoin. The property return report and any departure clearance the drop created are left for the quartermaster. The profile's Status area offers the control while it is available. (`tests/test_undo_member_drop.py`, `UndoDropControl.test.tsx`.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Departed members are listed in every member's directory**                                                                           | ✅ Resolved (owner decision 2026-10-05: hide archived from non-managers, default filter Active; workflow review W15-4)                   | A member without `members.manage` is served the directory from `GET /users/directory`, which now leaves archived (departed) members out, and their Members page opens on the **Active** filter (**All Statuses** still shows inactive, on-leave and retired members). Coordinators keep the whole roster, archived included, from `GET /users`, which is unchanged for its other callers — so archived members still appear in other screens' member pickers that read it. (`tests/test_member_directory_endpoint.py`, `Members.test.tsx`.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Staff can read every applicant's status-page token from the label preview, and a printed applicant label carries it**               | ✅ Resolved (2026-09-28, workflow review W17-3)                                                                                          | Resolved at the owner's direction: applicant labels now print the short record id (`_short_id(id)`), like other modules, and the label preview no longer returns the status token. **Still open:** labels printed before this change carry live tokens. Revoking them means rotating every applicant's `status_token`, which breaks every status link already emailed; that was not done. A department that has printed applicant labels and is concerned about them can ask for a rotation, which is a separate decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Recurring series stored before the W18 fixes are not repaired: some sit an hour off, on the wrong day, or collapsed onto one date** | 🚩 Open (MED, 2026-09-28, workflow review W18-3)                                                                                         | Two defects fixed in W18 wrote wrong occurrence times, and the fix corrects new series and later edits only. (1) `_generate_recurrence_dates` stepped the stored UTC instant, so a series spanning a daylight-saving change is an hour off after it, and an evening series with custom weekdays, an Nth-weekday pattern or skip dates could be matched against the UTC day (a day late). (2) `update_future_events` copied the anchor's start and end onto every later occurrence, so any series edited with "This and all future events" has those occurrences collapsed onto one date; the original dates are not recoverable from the occurrence rows, only by regenerating from the parent's stored pattern. Repairing either moves events members may have RSVP'd to and is a data migration, so it was not done.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **A member promoted off an event's waitlist is told only in the app, not by email**                                                   | 🚩 Open (MED, 2026-09-28, workflow review W19-1)                                                                                         | `promote_from_waitlist` logs an `in_app` notification ("You're off the waitlist: …") and sends nothing else. CLAUDE.md pitfall 18 makes email the channel of record with the bell layered on top, so a member who reads only their inbox never learns they are confirmed, may not come, and holds the seat. Adding it is a new outbound email with its own template and a place among the per-member email switches, which is a product change rather than a fix.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **An automatic waitlist promotion does not appear in an event's RSVP Activity**                                                       | 🚩 Open (LOW, 2026-09-28, workflow review W19-3)                                                                                         | `promote_from_waitlist` writes no `rsvp_history` row, so the officer's feed shows the member waitlisted and nothing after it while the list above shows them Going. A row with an empty `changed_by` would read as the member's own change ("Null means self-change"); recording it honestly as automatic needs a new column or marker on `rsvp_history`, which is a migration.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Deleting an event template only deactivates it, while the dialog says it cannot be undone**                                         | 🚩 Open (LOW, 2026-09-29, workflow review W21-5)                                                                                         | Driven: Delete → "This action cannot be undone." → Delete, and the template is still listed as Inactive, identical to Deactivate. `delete_template` soft-deletes deliberately ("Soft-delete a template by deactivating it"), presumably so events created from it keep a valid reference. Whether templates can be removed — and so whether the dialog or the button is wrong — is a product decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Event analytics' attendance rate counts upcoming events as no-shows**                                                               | 🚩 Open (LOW, 2026-09-29, workflow review W21-6)                                                                                         | `get_analytics_summary` divides every checked-in RSVP by every Going RSVP in the period, pooled, including events that have not started; the review install read "Avg Attendance Rate 67%" with one past event at 100% and one upcoming event at 0%, which "Top Events by Attendance" also lists. The figure falls whenever members RSVP to something upcoming, and it is a pooled ratio despite the "Avg" label. Which events it should cover, and pooled versus per-event average, is a metric definition.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **A public event requester is never given their status link**                                                                         | 🚩 Open (MED, 2026-09-29, workflow review W22-4)                                                                                         | After submitting the public request form the requester sees only "Thank you for your submission!"; neither the acknowledgement nor the status-change email carries the `/event-request/status/<token>` link, which is reachable only by a coordinator pressing Copy Link and sending it by hand. That page is where the requester follows progress and cancels, and it promises email updates that depend on the department's triggers (and still promises them after a cancellation). Showing the link on the confirmation screen changes a public endpoint's response; adding a `{{status_link}}` to the default acknowledgement changes what the department emails a stranger and would not reach a customised template. Which, or both, is a product decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **A guest sign-in's applicant lands in no pipeline, and nobody can see it**                                                           | 🚩 Open (HIGH, 2026-09-29, workflow review W23-1)                                                                                        | Driven: a guest signed in at an event set to create prospects and was told "Someone will be in touch"; the prospect was created with no pipeline and no stage, and the Prospective Members board, table and source filter ("Recruitment Interest Night (1)" → "No applicants found") all omit it — only the event page lists it, with a "View in pipeline" link to a pipeline that does not hold it. `create_prospect` places an unassigned prospect only in a pipeline flagged `is_default`, a pipeline is created unflagged unless someone sets it, and the prospects screen reads one pipeline at a time. Options — fall back to the sole active pipeline, make a department's first pipeline its default, or show unplaced applicants — each change where applicant records land, and the prospects already stranded need a backfill decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **No screen shows who signed in as a guest**                                                                                          | 🚩 Open (HIGH, 2026-09-29, workflow review W23-2)                                                                                        | A kiosk guest sign-in is stored as an external attendee (`GET /events/{id}/external-attendees`, `events.manage`), but nothing in the frontend calls `getExternalAttendees` or its sibling methods; the event page reads "Attendance (0)" after a guest signed in. An event that takes guest sign-ins without creating prospects keeps them where no officer can see them. Where guests appear (event page, check-in monitoring, exports), which of their contact details an event manager sees, and whether they count in attendance figures are product decisions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **A program's linked requirement starts at zero, whatever the member already holds**                                                  | ✅ Resolved (2026-10-06, owner decision: read the compliance result live)                                                                | A department requirement linked into a program now reads the member's compliance result: each such progress row is a projection of `evaluate_member_requirement_detail` (the compliance matrix's grader) as of the department's today — the member's graded records, shifts worked, waivers and catch-up included — written onto the row by `TrainingProgramService.refresh_linked_progress` whenever program progress is shown (enrollment detail, My Enrollments, a member's enrollments, the program's Enrollments tab, the My Training pipeline card), after which the enrollment percentage re-rolls and a completed phase advances as for any progress update. A member with 4 of 6 Hazmat hours now reads 4/6 in both places. _Linked_ means a requirement no program link owns (`owns_requirement`); a requirement a program created for itself — including one a duplicated program shares — keeps its program ledger. Feeds (shift reports, sessions, skills tests, credits) accrue nothing on a linked row and write no ledger credit; an officer cannot set its value or mark it complete (400, with the reason), only waive it for the program or lift the waiver. **Enrollments already made** read live from the next view: no migration, no row deleted; their stored values are replaced by the compliance figure on first read. **Not followed live:** completed, withdrawn, failed and expired enrollments keep the progress they finished with, so an annual requirement's new period cannot reopen last year's completion. Reports that read `requirement_progress` directly (struggling members, the program report counts) see a linked row as of its last refresh.                                                                         |
| **An open shift swap cannot be picked up, and approving one moves nothing**                                                           | ✅ Resolved (2026-10-05, owner decision: offer to members eligible for the seat; pickup moves the assignment)                            | An open swap is now listed to every member cleared for its seat (`GET /scheduling/swap-requests/open`, on the Requests tab under **Open shifts you can pick up**), judged by the same `get_eligible_positions` rule as signup and two-way exchanges. `POST /swap-requests/{id}/pick-up` moves the assignment to the member under the signup window and the full `_validate_assignment_candidate` checks (eligibility, leave, overlap, EVOC, seat cap) — no override. Officer approval of an open swap is refused, since it moved nothing; deny still works. Not built: open swaps are not pushed to eligible members by email or notification — they are found on the Requests tab. Whether to notify them is a separate decision. (W33-4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **The inventory setup wizard's first step needs a grant the quartermaster does not hold**                                             | 🚩 Open (LOW, 2026-09-29, workflow review W38-1)                                                                                         | `/inventory/admin/setup` is gated on `inventory.manage`, and its first step adds rooms — but a room is a location and `POST /locations` requires `locations.create` or `locations.manage`, which the seeded quartermaster position lacks. The form is now hidden from anyone without that grant and says who can add a room, and the later steps work from existing rooms. Whether a quartermaster should be able to create rooms (grant `locations.create` to the position, or let the wizard create rooms under `inventory.manage`) is a permission decision left to the owner.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Receiving gear back does not close the member's return notice**                                                                     | 🚩 Open (MED, 2026-09-29, workflow review W39-5)                                                                                         | A member's "Notify quartermaster of return" creates a return notice. When the quartermaster instead receives the gear through Return on the members page (`POST /inventory/items/{id}/unassign`, `/issuances/{id}/return`, or a loan check-in), the item comes back but the notice stays `requested`: it remains in the returns queue, on the Inventory Administration attention list as a pending return, and in the member's own list and Pending count. Whether a direct return should complete the notice (carrying the condition observed at the counter), mark it received for inspection, or be refused while a notice is open is a workflow decision, since each records a different account of who inspected what. W41 confirmed the consequence: such a notice can only be denied, since receiving it is refused with "Active assignment not found" once the item has moved on.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **A variant group created on the Variant Groups page can never be filled**                                                            | 🚩 Open (MED, 2026-09-29, workflow review W40-7)                                                                                         | `/inventory/admin/variant-groups` creates groups, but no screen can put an item in one: the item form has no variant group field, although `POST`/`PATCH /inventory/items` accept `variant_group_id`, and generating size variants from All Items creates a new group of its own. Every group made on that page therefore stays empty. Its empty state now says so rather than pointing at a step that does not exist. Whether to add a group picker to the item form, or let Generate variants fill an existing group, is a design choice left to the owner.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **A reorder request made in the app can never be received**                                                                           | 🚩 Open (MED, 2026-09-29, workflow review W41-5)                                                                                         | `POST /inventory/reorder-requests/{id}/receipts` refuses a request with no linked item ("Link an inventory item before receiving stock"), but nothing on `/inventory/admin/reorder` sets `item_id`: the create and edit forms have no item picker, the low-stock quick fill copies an item's name only (the low-stock data carries no ids), and Edit is gone once a request is ordered. Every reorder created there therefore ends cancelled. The Receive stock dialog now says so and is disabled for an unlinked request. Whether to add an item picker at create, allow linking at receipt, or carry item ids in the low-stock data is a design choice left to the owner.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **A write-off raised for one returned unit of pool stock retires the whole item**                                                     | 🚩 Open (MED, 2026-09-29, workflow review W41-6)                                                                                         | Receiving a damaged pool return with the "Write-off review" follow-up raises a write-off request against the item, not the returned units. Approving it runs `review_write_off`, which retires the item and releases every holder (`_release_item_holders`): in the review database, one damaged box of Nitrile Gloves would have retired the 12 on the shelf and ended four members' issuances. The review dialog does state this, and requires a note and an acknowledgement, but offers no way to write off only the returned quantity. Whether a write-off should carry a quantity, reduce stock without retiring, or not be offered for pool issuances is a data decision that may need a migration, left to the owner.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **The check log and fleet board count a checklist as missed on days before it existed**                                               | 🚩 Open (MED, 2026-09-30, workflow review W46-19)                                                                                        | `EquipmentReadinessService` builds the expected side from today's active templates applied to every shift in the look-back window. A checklist published at 9:54 PM made Engine 1's shift the day before a "missed" check, and the fleet board read "Needs attention — 1 check missed" minutes after the checklist was written. Bounding it needs a definition the owner should choose: from the template's creation, from when it was last published (not recorded today), or from when its apparatus or type assignment changed. Until then a new or re-scoped checklist starts every rig on it with misses already on the record.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **The dashboard's Low stock counts a lot-stocked category as empty**                                                                  | 🚩 Open (MED, 2026-09-30, workflow review W47-6)                                                                                         | `InventoryService.get_low_stock_items` sums `InventoryItem.quantity` per category, and an item stocked through lots leaves that column at 0, so a category of lot-stocked supplies reads as empty against its threshold whatever the lots hold. The dashboard's "Low stock" widget calls it with no domain filter, so it counts medical categories, while the `/inventory?stock=low` list it links to excludes them — the widget read 2 and the list it opens 1. Medical Supplies counts low stock from item reorder points only, so a medical category's "Low stock at N or below" is read by this report and an MCP tool alone. What "low" means for a lot-stocked category, and whether the dashboard counts medical categories, is a reporting definition shared by three screens (CLAUDE.md pitfall 29).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **A member checked in after an election opens cannot vote**                                                                           | 🚩 Open (MED, 2026-09-30, workflow review W50-9)                                                                                         | Opening an election freezes the voter roll from who would receive a ballot at that moment, and a ballot item that requires attendance counts only members already checked in. The Attendance tab still offers Check In while voting is open: a member checked in then is recorded as present and refused a ballot ("not on the voter roll that was frozen when this election opened"), in the app and by email. Checking in before opening, or a voter override, is the only way in. Whether a late arrival at the meeting may vote is a question of who is authorized to vote, and so the owner's. The Attendance tab now says a check-in after opening does not add a voter.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Results of an election closed early stay hidden until its scheduled end**                                                           | 🚩 Open (MED, 2026-09-30, workflow review W50-10)                                                                                        | `get_election_results` shows results only once the status is closed **and** the scheduled end date has passed (or results are set to show immediately). A secretary who closes the vote at the meeting cannot see the result, and neither can members, until the original end, days later. Closing does not move the end date. Whether an early close should release results, and to whom, is a visibility decision for the owner. The Results tab now says when they will appear.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **An election run on positions alone cannot email ballots, and nothing says so before it opens**                                      | 🚩 Open (LOW, 2026-09-30, workflow review W50-11)                                                                                        | The create form takes positions and candidates, and members can vote on them in the app, but the emailed ballot page votes on ballot items only. Send Ballot Emails stays disabled for an election with no ballot items, and the ballot cannot be changed once voting is open, so a secretary finds out after opening. Whether Open should warn, or positions should become ballot items, is a product choice. The page and the ballot builder now say it. Re-observed 2026-10-06 (W50-91): the API does not refuse the send, and a token ballot on such an election reads "Make a selection for each item below" over no items, with a Submit button.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **A department on basic apparatus cannot pin a checklist to one unit**                                                                | 🚩 Open (LOW, 2026-09-30, workflow review W46-20)                                                                                        | `equipment_check_templates.apparatus_id` is a foreign key to the Apparatus module's `apparatus` table, so a unit from onboarding's `basic_apparatus` list cannot be stored there, and the server refused it as "Invalid apparatus". The builder now offers only Apparatus-module units, and such a department assigns checklists by apparatus type, which works (the fleet board and log resolve it). Supporting per-unit checklists for basic apparatus is a schema change (a polymorphic reference, as `utils/apparatus_ref` handles for shifts) and is left to the owner.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## Dependencies

| Item                                       | Status                   | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **PyMySQL held at 1.2.0**                  | ⚠️ Open (2026-09-22)     | PyMySQL 1.2.1 (GHSA-x4f8-9hx9-hpp9) now sends `bytes` parameters as hex literals and replaced `pymysql.converters.escape_bytes_prefixed` with a string sentinel (1.2.3 only restored the _name_). aiomysql 0.3.2 — its latest release — imports that name and calls it for every `bytes` parameter, so with PyMySQL ≥ 1.2.1 every BLOB write fails with `TypeError: 'str' object is not callable` (caught by `tests/test_storefront_service.py::TestProductImages`). The advisory is an injection through the big5, gbk, sjis, cp932 and gb18030 connection charsets; this application connects with `DB_CHARSET=utf8mb4`, which is not affected. `requirements.txt` therefore pins 1.2.0 and `.github/dependabot.yml` ignores `pymysql >= 1.2.1`. **Owner decision pending when either changes:** lift both once aiomysql ships a compatible release; if pip-audit starts flagging 1.2.0 first, the alternative is to take PyMySQL ≥ 1.2.1 and replace aiomysql's `escape_bytes_prefixed` with the hex-literal encoding at startup. |
| **jsdom held at 30.0.1**                   | ⚠️ Open (2026-09-22)     | vitest replaces jsdom's `URL.createObjectURL` with a shim that copies each jsdom `Blob` into a Node `Blob`, and it locates jsdom's private implementation object by taking the _first_ own symbol of `new window.Blob()`. jsdom 30.1 changed that, so `blob[implSymbol]` is `undefined` and the shim throws `Cannot read properties of undefined (reading '_buffer')` from inside `URL.createObjectURL` — under vitest 4.1.11 and 5.0.1 alike, and with jsdom 30.1.0 and 30.1.1 alike. The four photo tests in `EquipmentCheckFormCounts.test.tsx` fail on it. It is test-environment only: jsdom is a devDependency and the shipped app never loads it. `frontend/package.json` and the root `package.json` therefore keep `jsdom` at 30.0.1, and `.github/dependabot.yml` ignores `jsdom >= 30.1.0`. Lift both once a vitest release handles jsdom ≥ 30.1.                                                                                                                                                                         |
| **No nested `frontend/package-lock.json`** | ✅ Resolved (2026-08-05) | The repo is npm **workspaces** (`workspaces: [backend, frontend]`), so the root `package-lock.json` is the only lockfile `npm ci` reads, and `frontend/Dockerfile` copies just `package.json` and runs `npm install`. A stale nested lock had survived since PR #1071, pinning axios 1.13.6 / form-data 4.0.5 / @remix-run/router 1.23.0 while the root lock carried the patched axios 1.19.0 and form-data 4.0.6. Nothing installed from it — but Trivy scans every lockfile it finds, so it reported 12 HIGH advisories against dependency versions the build does not use. Deleted. Do not re-add a per-workspace lockfile; run `npm install` from the repo root.                                                                                                                                                                                                                                                                                                                                                                 |

## Training Module

| Item                                                                                    | Status                               | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Requirement grandfathering reads a missing hire date as the account's creation date** | Accepted (owner to note, 2026-10-03) | A requirement's `new_member_cutoff_date` separates existing members from new ones by join date: `hire_date`, else the UTC date the account was created (`training_compliance.member_join_date`). A roster imported into The Logbook without hire dates therefore reads every imported member as having joined on the import day. If that day falls on or after a cutoff, veterans are graded as new members. Before relying on a cutoff, record hire dates for the existing roster, or choose a cutoff earlier than the import. Members already enrolled in a training program are governed separately, by the per-program `apply_to_current_enrollments` choice made when a requirement is added to it. |

## Outreach Requests — Two Deliberate Choices in the Public Pipeline (2026-09-09)

Both are decisions rather than gaps, written down because each looks like an
oversight to the next reader and the obvious "fix" for either is wrong.

**The requester's status link is shared by a coordinator, not emailed.**
Every event request carries a `status_token` and there is a public page at
`/event-request/status/{token}` showing the request's stage, the confirmed date
and — where the department has enabled `public_progress_visible` — its pipeline
checklist, plus a self-service cancel. Nothing puts that URL in front of the
requester automatically: the acknowledgement email does not carry it, and the
public form's confirmation response does not return the token. A coordinator
hands it out from the **Copy status link** control on the request detail panel
in Events → Requests.

That is the chosen posture, not an omission. The membership pipeline mails its
equivalent (`/application-status/{token}`) because a prospect's application is
a months-long relationship they are expected to track themselves; a station
tour is a short exchange the department drives, and a link that reaches every
requester's inbox is a link that reaches every forwarded inbox, spam filter and
screenshot with it. **Do not "finish" this by adding the URL to the default
`EVENT_REQUEST_STATUS` email template** — reopen the decision first.

**And do not paste a status link into a department email template as a
workaround.** Templates are reusable and the renderer has no per-request token
placeholder — `render_request_template` substitutes only `contact_name`,
`outreach_type`, `organization_name`, `organization_logo_img` and `event_date`,
and the send action supplies just a `template_id`. A pasted URL therefore
hard-codes one requester's bearer token into a template that will be sent to
the next requester, handing them the first one's status page and its
self-service cancel. Enabling self-service tracking properly means adding a
status-link placeholder resolved per request at send time, which is the change
the decision above defers.

**Publishing a request form is not the same as opting into public intake.**
Since 2026-09-09 both intake paths honour
`events.request_pipeline.accept_public_requests`: the JSON endpoint refuses,
and a public Form submission carrying the `event_request` integration is stored
but produces no pipeline row, with the reason on the submission's
`integration_result`. Previously only the JSON endpoint read the setting.

Migration `d19b2c2ae9b9` turns the toggle on for every organization that
already had a published, public request form at upgrade time, so no existing
department loses requests. **A department publishing its first request form
after that upgrade must also turn the toggle on** — the settings screen does
not yet couple the two, and the symptom is a form that accepts submissions and
files no requests. Coupling them (or warning on the Forms publish action) is an
open product decision.

## Claude (MCP) — Member Sign-In (OAuth) Residuals (2026-10-06)

**The original limitation is resolved.** "claude.ai custom connectors need an
OAuth server the app does not have" (2026-09-03): the owner chose to build it,
and The Logbook now includes an OAuth 2.1 authorization server for MCP
clients — authorization code with PKCE (S256), admin-registered clients,
rotating refresh tokens, a consent screen, and per-member tool gating. It is
off by default (`MCP_OAUTH_ENABLED`, `MCP_OAUTH_ISSUER_URL`, plus the
department's own switch); see `wiki/Integration-Claude-MCP.md` and the threat
model in `docs/security-review/MCPO-27-mcp-oauth-server.md`.

What is left, each a deliberate choice an owner may want to revisit:

- **No dynamic client registration.** An open RFC 7591 endpoint lets anyone
  create clients and cannot tie a client to a department, so clients are
  registered by an IT administrator. claude.ai accepts a pre-registered client
  ID and secret in its connector's advanced settings; a client that supports
  only DCR still needs the service key and a local bridge. If DCR is wanted,
  the shape that keeps the department binding is registration authenticated by
  an administrator-minted initial access token.
- **Loopback redirect URIs match exactly, port included.** OAuth 2.1 permits
  any port on a loopback redirect; this server does not, so a desktop client
  must be configured with a fixed callback port.
- **A client that retries a refresh loses its connection.** Refresh-token
  replay detection cannot tell a retried request from a stolen token, so it
  ends the connection and the member reconnects. A grace window for the
  immediately previous token would trade detection for convenience.
- **Access tokens are bearer tokens** (no DPoP or mTLS binding), bounded to
  15 minutes.

Two smaller ones, both deliberate:

- **Department contact details are withheld along with personal ones.** The
  redaction boundary matches field _names_ so that a test can prove it
  holds for every tool at once; a station's public phone number is stripped
  the same as a member's. Locations and facilities are still listed by name,
  city and state.
- **Tool results are point-in-time.** The server exposes no resources or
  subscriptions; a client re-asks to refresh.

## ONBOARD-7 — Concurrent First-Run Requests Brick Setup With a 500 (resolved 2026-09-12)

**Found while capturing the setup-wizard screenshots, reproduced twice on a
freshly-migrated database.** Not a theoretical race: it fired on an ordinary
first load of `/onboarding`, and recovery needed direct database access.

`OnboardingService.start_onboarding` is a read-then-write with nothing
serialising it:

```python
existing = await self.get_onboarding_status()
if existing and not existing.is_completed:
    return existing
# ...otherwise create a new OnboardingStatus
```

Two concurrent `POST /api/v1/onboarding/start` calls therefore both read "none
exists" and both insert. There is no unique constraint on
`onboarding_status` to stop the second.

`needs_onboarding()` then reads that table with `scalar_one_or_none()`
(`app/services/onboarding.py:256`), which raises `MultipleResultsFound` the
moment two in-progress rows exist. `GET /api/v1/onboarding/status` returns
**500 `LB-SYS-001` permanently**, and the wizard cannot proceed.

**Observed:** two rows written in the same second, `is_completed = 0`,
`current_step = 1`. Deleting either one restores the endpoint immediately,
which is what confirms the diagnosis.

**Why it is reachable.** The wizard's own page load issues these calls in
parallel, so no unusual behaviour is required. It is also exactly what
`08-admin-reports.md` tells operators they may do — "Open `/onboarding` in a
second tab … that tab starts its own new session".

**Recovery today is manual and needs database access**, which on a first run is
the worst time to need it: the System Owner does not exist yet, so there is no
account to sign in as, and `/onboarding/reset` authenticates against the same
broken state.

## Resolved (2026-09-12)

Both halves were needed, because they fail independently: the constraint stops
new duplicates and does nothing for a database that already has them, while the
tolerant read rescues that database and does nothing to stop the race.

- **`onboarding_status.singleton`, uniquely indexed.** There is nothing to lock
  instead — the conflicting row does not exist yet, so `FOR UPDATE` has no
  target. The index decides the race; the loser gets an IntegrityError.
- **`start_onboarding` adopts the winner's row.** The insert runs inside a
  SAVEPOINT so a failed flush cannot poison the caller's session, and on
  conflict the transaction is **rolled back** before re-reading. That rollback
  is the subtle part: under REPEATABLE READ the loser's snapshot predates the
  winner's commit, so re-reading inside it finds nothing and would raise on a
  row that demonstrably exists. Bounded at three attempts.
- **`needs_onboarding` reads with `.first()`**, so an installation duplicated
  before the constraint existed answers instead of raising — which is what lets
  the migration reach it at all.
- **Migration `6ab7d903fae5`** collapses existing duplicates before adding the
  index, since it cannot be created over them. The survivor is the completed
  row if any, else the furthest-progressed, tie-broken oldest — losing recorded
  progress being the harm worth avoiding.

**Verified against a real database, not just mocks.** Twenty concurrent
`POST /onboarding/start` against an empty install: **20/20 → 200, one row**,
and `/onboarding/status` healthy. Before the fix the same run produced
duplicates and a permanent 500. Two intermediate versions each got 10 and 6 of
20 wrong and passed the mocked tests throughout — an `expunge()` on an instance
the SAVEPOINT rollback had already detached, then the REPEATABLE READ snapshot
above. Neither was visible without a live MySQL.

**Related, same family, found and fixed the same rotation window
(security-review pass 4, ONB3-30-3):** the resumability fix that let a lapsed
onboarding session be re-minted (`get_or_create_session` keying its refusal on
completion rather than mere organization existence) had, as an unavoidable
consequence, widened who can obtain a session at all — an unrelated caller can
now mint one any time between organization creation and System Owner creation,
not merely in the sub-millisecond window before any organization exists. That
made `create_system_owner`'s own single-owner guard (a plain read-then-write,
never itself locked) newly and directly reachable as a two-caller race rather
than only as a single-session replay: reproduced against a real database, two
concurrent `POST /system-owner` calls both created a full-access "*" account.
Fixed the same way as this entry's own singleton race — lock the parent
(`onboarding_status`, guaranteed to exist and be unique by this point) and make
the existence check itself a locking read. See
`docs/security-review/ONB3-30-onboarding.md` → Pass 4.

## ONBOARD-5 — Navigation Layout Was a Per-Browser Preference (resolved 2026-09-11)

The setup wizard's last step asks whether the department wants top or left
navigation, and it does take effect — `onboardingStore` writes the answer to
`localStorage` under `navigationLayout`, and `AppLayout` reads it from there.

That is the whole of the mechanism, and it is per-browser. The chief who ran
setup sees the layout they chose; every other member, and the chief on their
phone, gets the `'left'` default, because nothing about the choice reaches
them. The step also POSTs `navigation_layout` to the backend, where it is
stored on the organization and read by nothing — Pitfall #19's "a switch wired
to nothing", with the twist that the half that is wired is wired to the wrong
scope.

**Fixed 2026-09-11.** The answer is now stored on the organization
(`settings.appearance.navigation_layout`), served beside the name and logo by
`GET /auth/branding` so the shell paints in the right shape on first load, and
editable at Settings → General → Profile. `AppLayout` reconciles against
the server on every mount rather than only on a first visit — a departmental
setting has to reach members whose browsers already hold a value, which the old
first-visit-only fetch could never do.

**Scope deliberately stopped at department-wide.** A per-member override was
considered and not built: `users` has no general preferences column, so it
would need a migration, an API field and a profile control, and no one had
asked for the ability to disagree with the department's choice. If that comes
up, the org setting is the default it would layer over.

**One upgrade consequence**, recorded in `docs/UPGRADING.md`: an existing
install has no stored `appearance` block, so every member — including the
officer whose browser held `top` — now sees the `left` default until somebody
sets it in Settings. The old value lived in one browser's `localStorage` and
was not reachable from the server, so there was nothing to migrate.

## Audit and Ballot Signing — `SECRET_KEY` Still Verifies Rows From Before the Dedicated Key (2026-10-06)

Until 2026-10-06 the shipped compose files did not pass
`AUDIT_LOG_SIGNING_KEY` (nor, on the Unraid files, `VOTE_SIGNING_KEY`) to the
backend, so an install that set either in `.env` signed with the `SECRET_KEY`
fallback. **Owner decision (2026-10-06): those rows keep verifying.** Each new
audit row and ballot records `signing_key_id`, a 16-hex HMAC fingerprint of the
key that signed it, and verification checks a row only against the key it
names. A row with no fingerprint is checked against the dedicated key, then
`SECRET_KEY`; `SECRET_KEY` is accepted only before the cut-over — the first
audit row recording the dedicated key, or for ballots the `voted_at` of the
first ballot recording it — and one `WARNING` per run reports how many rows it
verified. What this leaves, accepted rather than fixed:

- **The cut-over is read from the database.** An attacker who holds
  `SECRET_KEY` **and** can write the audit table can rewrite every row from
  the cut-over onward as `SECRET_KEY` rows with no fingerprint, and the chain
  verifies. Against an attacker holding only one of the two, nothing changes.
  Closing it needs a trust boundary outside the database — an operator-set
  last-legacy-id, as `AUDIT_LOG_LEGACY_MAX_ID` is for the unkeyed era — which
  would make every affected install set a value by hand on upgrade, the step
  the owner's decision set out to avoid. The ballot chain is unkeyed SHA-256,
  so the same attacker can already re-order it; the ballot bound is the
  earliest dedicated-key `voted_at` across the deployment, which a backdated
  `SECRET_KEY` ballot can still precede.
- **A retention archive attested with `SECRET_KEY`** sanctions the chain head
  only when its range ends before the cut-over row; that row is itself
  eventually purged, after which the bound moves to the earliest surviving
  dedicated-key row.
- **`SECRET_KEY` cannot be rotated** without the pre-upgrade rows reading as
  tampered, for as long as they are kept. Before this change they would have
  read as tampered as soon as the dedicated key arrived.

## Found by the September 24 – October 4 Documentation Pass (2026-10-04)

Five items surfaced while bringing the guides up to date with the window's
pull requests (`docs/CHANGE_AUDIT_2026-09-24_TO_10-04.md`). None is new
behaviour from that window except where noted; each is recorded here so the
guides can point at one place and an owner can decide it.

- **External Training — the Map User button does nothing.** On the External
  Training Integrations page, an unmapped provider user shows a **Map User**
  button with no click handler (`ExternalTrainingPage.tsx`). A provider user
  that does not match a member by email can only be mapped through the API
  (`PATCH /training/external/providers/{id}/user-mappings/{mapping_id}`).
  ✅ **Resolved 2026-10-04:** each user now has a member dropdown, as categories
  do. The fix also repaired two endpoint defects the button had hidden: both
  user-mapping endpoints selected the `User.full_name` property as a column and
  answered 500 once any mapping had a member (so the Users tab came back
  empty), and an explicit `internal_user_id: null` was ignored, so a mapping
  could not be cleared. Mapping now also moves the user's not-yet-imported
  records to the member (`test_external_training_user_mapping.py`).
- **Email Templates — the redesign banner still says to press Reset.** The
  blue banner on Communications → Email Templates reads "Templates you have
  never edited already use it — press Reset on any you have customised to
  adopt it." Since migration `15c5bc7700aa` (#2754) every template already uses
  the solid-tab design, edited or not, so the advice now only discards a
  department's own wording. Earlier wording is restored from the template's
  **Previous version (before the redesign)** panel, not from Reset.
  ✅ **Resolved 2026-10-04:** the banner now says every email uses the current
  design and there is nothing to adopt, points to **Previous version**, and
  says Reset replaces wording without changing the design
  (`EmailTemplatesPage.tsx`; pinned in `EmailTemplatesPage.tab.test.tsx`).
- **NFC tag and ID-card hashes depend on `ENCRYPTION_SALT`.** Every NFC tag
  UID and member card UID is stored only as a SHA-256 peppered with the
  installation's encryption salt (`nfc_tag_service.py`). Changing
  `ENCRYPTION_SALT` therefore orphans every registered tag and card: taps stop
  matching and each must be registered again. `docs/KEY_ROTATION.md` already
  says not to change the salt; this is one more reason. **Accepted.**
  ✅ **Covered 2026-10-05:** the owner chose to keep the salt as the pepper
  rather than add a separate secret, which would force every tag and card to
  be registered again. `KEY_ROTATION.md`, `BACKUP.md` and `DEPLOYMENT.md` now
  name NFC tags and ID cards among what a changed or mismatched salt breaks.
- **Probationary counts as active only where `User.is_active` is read**
  (#2886). Sign-in, scheduling, messaging recipients and the other
  `is_active` callers now admit probationary and junior members. About forty
  other places compare `status == ACTIVE` by hand — training compliance,
  certification alerts, rosters, reports, meeting quorum, administrative
  continuity — and still leave them out. Some (quorum, continuity) may be
  right to, depending on bylaws. **Pending an owner decision per site.**
- **Another member's ID card is gated in the screens, not the API** (#2860).
  The profile's **ID Card** button and the card page now require
  `members.manage` or `members.manage_id_cards` for someone else's card, but
  the shared label page `/members/print-labels` still prints colleagues'
  badges for anyone holding `members.view`.
  ✅ **Resolved 2026-10-04:** the label API's `membership` module and
  `/members/print-labels` now require `members.manage` or
  `members.manage_id_cards`, matching the card page
  (`test_label_service.py::test_members_view_alone_cannot_print_member_badges`).
  The card's contents — name and membership number — remain directory
  information that `members.view` reads; what is gated is the assembled,
  scannable badge.

## Room Kiosk Badge Check-In — A Copied Card Works With Nobody Watching (2026-10-03)

**Accepted by the owner on 2026-10-02.** A room with **Badge check-in** on
records attendance from a card tap at its public kiosk, with nobody signed in.
The card's credential — a chip serial, or a code written onto a blank tag — is
readable by any phone held near the card, so someone who copies a member's
card, and stands at a switched-on room's kiosk (or knows its display code), can
check that member in or out of the event open there. A check-in station has an
officer beside it; the kiosk does not.

What limits it, and what does not:

- **Off by default, room by room**, and only with the NFC ID Cards integration
  on. Turning either off stops the very next tap.
- **Narrow reach.** Only the one event open in that room, through the event's
  own check-in rules — no shifts, no admin hours, no other room.
- **Little to learn.** The answer shows a first name and last initial; an
  unknown card and an ambiguous overlap answer the same way for everyone.
- **Traceable, not prevented.** Every tap that moves attendance is audited with
  the room and IP, so an officer can find and correct a false record; nothing
  stops it being made.
- **Rate limited** to 60 taps a minute per IP and per room, which slows walking
  serials against a leaked display code but does nothing against one copied
  card. Rotating the display code (Regenerate) locks out a leaked one.

Closing the gap would need cards that cannot be copied by reading them
(challenge-response cards such as DESFire), which Web NFC cannot drive. Until
then, a department that needs attendance it can rely on for credit should keep
those events on a staffed station, or on members' own signed-in phones.

## Prospective Members — Purge Is Manual; Auto-Purge Is Not Wired (2026-09-30)

**Purge Selected** on the Inactive Applications tab permanently deletes the
selected applications that are still `inactive`, with their uploaded documents,
and records the purge in the audit log. Until this date it matched `withdrawn`
instead, so it deleted nothing while the page reported success. Withdrawn,
rejected and on-hold applications are never purged; the owner chose to keep the
button to exactly what its tab lists.

**Open: the pipeline's Auto-Purge setting has no reader.** The settings page
stores `auto_purge_enabled` and `purge_days_after_inactive`, and the user guide
(`docs/training/15-prospective-members.md`) says inactive applicants are
deleted after the grace period, but no scheduled task reads either value --
nothing is ever purged automatically (CLAUDE.md pitfall #19). Wiring it means a
nightly job calling `purge_inactive_prospects` per pipeline for applications
inactive longer than the grace period, which needs the date an application went
inactive (`deactivated_at`) and a decision on notifying coordinators first.
Until then, departments purge from the Inactive tab.

## Email Link Address — How a Change Reaches Every Worker (2026-09-25)

An address saved on **Settings → Email** is applied to `settings.FRONTEND_URL`
in memory on each uvicorn worker (`app/core/link_domain_sync.py`), because the
29 places that build an emailed link read that value directly. The worker that
saves the change applies it at once and announces it on Redis, and the other
workers re-read it from the database when they hear the announcement.

**Without Redis, the other workers take up to a minute.** Each worker also
re-reads the saved value every 60 seconds, so a missed announcement, or a
deployment with no Redis at all, is corrected within that window. Until then, an
email sent by one of those workers still uses the previous address. Links already
sent keep whatever address they were sent with.

## Membership Numbers — What "Never Reissued" Can See (2026-09-29)

Automatic numbering never issues a number any member holds or once held: a
current member's `membership_number`, an archived or anonymized member's (both
keep theirs), and a soft-deleted member's `previous_membership_number`. A typed
number held for a former member is refused unless it is being given back to
that member. The department's rule is that a member may return many years
later and should get their number back.

**Accepted: a permanently deleted member leaves nothing to reserve.** Permanent
deletion removes the row, so the number it held is free to issue again. Keeping
it would mean retaining a record of a person the department chose to erase,
which is the opposite of what permanent deletion is for; archive or soft-delete
a member who might return.

**Accepted: numbers issued before reservations existed are not reshuffled.**
The generator could previously reissue a soft-deleted member's number. Where
that already happened, the current holder keeps it and can still save their
profile; only a _change_ to a member's number is checked. If the former member
is reactivated, their old number is not restored because someone holds it, and
it stays recorded in `previous_membership_number`.

## Email Design — What the Solid-Tab Shell Does Not Reach (2026-09-27)

Every email the platform sends renders into the solid-tab shell in
`app/services/email_theme.py` with the built-in stylesheet: every default
template, the storefront notices, the event-request templates departments
write, the election alerts, and every email a service builds inline.
Revision `15c5bc7700aa` reset every stored template of a shipped type to the
new default, keeping what it replaced in `email_template_backups` (see
`docs/UPGRADING.md`). What remains:

- **A `custom` template row would keep whatever markup it has — but nothing
  creates one.** The type exists in `EmailTemplateType`, yet no endpoint,
  screen or service stores a template of it: the only stored templates are
  the shipped defaults `ensure_default_templates` seeds, and every one of
  those was moved to the new design. (Senders tag some one-off mail as
  `custom` in message history; that mail is built with `wrap_email_body` and
  is already in the new design.) A row inserted by hand would render with the
  built-in stylesheet, which still defines the previous shells' classes, and
  keep its own header. A "convert to the new design" action was considered
  on 2026-09-28 and not built, because there is nothing for it to convert;
  if a way to create custom templates is ever added, it should start them
  from `build_shell` so none are created in the old design.
- **Restoring a backup brings back the wording, not the layout.** The
  editor's "Previous version" panel loads a backup's subject, plain text,
  title and message into the new design as an unsaved draft. What the
  department had above or around the message (its own header, colours,
  stylesheet, extra sections outside the message card) is not restored, by
  design; it is still readable in `email_template_backups`.
- **Dark mode is Apple Mail and Outlook.com.** It is a
  `prefers-color-scheme` stylesheet, which Gmail strips along with every
  other `<style>`; Gmail's apps and classic Outlook repaint the light
  rendering themselves. Inside the body card, unclassed fragments that
  services inject (tables, coloured panels) lose their own backgrounds in the
  dark, so their text stays legible, and with them their colour coding.

## Installed App Icons — Three Things the Platforms Decide for Us (2026-09-17)

The department's logo is rendered into the installable app's icons and iOS
launch images on request (`app/utils/app_icons.py`, served by
`app/api/public/branding.py`). Three limits on that are not ours to fix.

**An installed app keeps the icon it was installed with.** Android and iOS both
read the icon once, at install, and neither revisits it. A member who installed
before the department uploaded its logo — or before it changed one — keeps the
old picture until they remove the app from their home screen and add it again.
There is no API that asks a phone to refresh it, so the only available answer is
the one `docs/UPGRADING.md` gives: tell people to reinstall.

**A logo stored as an external URL is not rendered.** `organizations.logo`
accepts either an uploaded image (a `data:` URI, which is what both the settings
screen and onboarding write) or a link to an image elsewhere. Only the first is
rendered. Fetching the second would mean an unauthenticated request causing the
server to fetch a URL out of the database — the SSRF shape, reachable by anyone
who can install the app — and the value it would buy is a case no writer in the
product actually produces. Such an installation falls back to the shipped icons,
silently, which is the same thing it saw before this existed.

**The maskable icon is smaller than it looks like it should be.** Android crops
a maskable icon to a circle, a squircle or a rounded square of the launcher's
choosing, and only a circle of 80% diameter is guaranteed to survive all of
them. A rectangular crest is therefore fitted to the square inscribed in that
circle — about 57% of the icon's width — so a department comparing its icon
against the plain one will find the masked version noticeably smaller. Fitting
it larger means some launchers cut the corners off the crest, which is worse and
is not visible to whoever chooses the setting.

## "Today" Is the Department's Date — What Still Reads UTC (2026-09-26)

**Resolved, with one accepted gap (older training records, below).** `date.today()` returns
the server's date, and a container runs in UTC, so for a US department it is
already tomorrow every evening (from 7–8 PM Eastern, 4–5 PM Pacific). Anything
that counts days, decides expired-versus-not, or picks "this month" from it is
off by one day for those hours, and the scheduled jobs that run early in the
UTC morning are off for the western half of the country every time they run.

**Fixed** (with `org_today` / `today_in` / `resolve_org_today` /
`local_date` / `local_day_start_utc` in `app/utils/org_timezone.py`):

- The certification expiry alerts, NFPA retirement alerts, expiring-supplies
  email, the monthly compliance auto-report's "last month", the training
  report exports' default end date and the certification CSV's status, and
  the equipment check reports' date range and trend buckets
  (`tests/test_org_local_today.py`).
- The whole training compliance engine, moved at once so no two views grade
  against different days (Pitfall #29): the compliance matrix and its
  `as_of`, the dashboard and admin-hub compliance percentage
  (`compute_org_compliance_pct`), member status, compliance summary,
  requirement progress (`check_requirement_progress`, resolved once per page
  in `get_requirements_progress_for`), member training stats, expiring
  certifications, the competency matrix, the annual compliance report, the
  compliance CSV/PDF "Met / Not Met" cells and forecast, the member's own
  My Training page, the MCP training tools, and a program requirement's
  recency window (`tests/test_compliance_engine_org_today.py`).
- Training program enrollments: the default deadline on enrolling, the
  recert schedule and resets (read-time and the sweep), expiry of an
  overdue enrollment (read-time and the sweep), reopening with a new
  deadline, a requirement's evaluation window, and the progress page's
  days-left and behind-schedule figures; and the struggling-member and
  enrollment-deadline warnings. An enrollment's timestamps (`enrolled_at`,
  `cycle_started_at`) are read as the department's calendar day through
  `local_date` (`tests/test_org_local_today.py`,
  `tests/test_struggling_member_service.py`).
- Recertification renewal tasks (the renewal window) and instructor
  qualification expiry, both for validating an instructor for a session and
  for listing a course's qualified instructors (`tests/test_org_local_today.py`).
- Member qualifications (`qualification_service.py`): a qualification is
  current through its expiry day when no date is given, and shift
  eligibility judges one against the shift's day on the department's
  calendar (an evening shift's UTC start is the next day) — the position
  roster passes the department's date from the org it already holds. The
  reports service's certification-expiration report, apparatus inspection
  due dates and call-volume year-to-date default
  (`tests/test_org_local_today.py`).
- Apparatus operator (EVOC) certificate expiry, moved together in
  `EvocLevelService.check_driver_evoc_eligibility` and the position roster's
  `_get_operator_map` so signup and the roster agree on the same card; and
  the administration hub and operations dashboard, which now fall back to the
  scheduling default rather than UTC for an organization with no (or an
  invalid) timezone, and age an evening row on the department's calendar
  (`tests/test_org_local_today.py`).

- Everything else that read "today" off the server, moved one area at a time
  (`tests/test_org_local_today.py`): equipment checks (the auto-fail on an
  expired item, observation validation, lots aboard, swaps, the apparatus
  inventory and my-checklists list), stock lots and NFPA screens, medical
  supplies, the fleet readiness board; apparatus and facility maintenance
  (overdue flags, due lists, dashboards, the nightly overdue sweep, run per
  department), the fleet summary's expiring registrations, driver
  qualification exceptions; scheduling (open shifts, week and month calendars,
  the "past shift" signup fallback, auto-generation, swap-offer expiry,
  cancelling shifts for a leave, the shift/hours compliance report, the iCal
  feed); membership tiers and service history, rejoin and separation dates,
  the leave widget, medical screening; grants, meetings (including a meeting
  bridged from an event, whose date and times are now the department's wall
  clock rather than the event's UTC timestamp), documents, forms,
  notification and fundraising summaries, dashboard widget periods, the admin
  hours year and quarters, action-item reminders (per department), and a few
  labels and file names.

**Guarded.** `tests/test_server_date_ratchet.py` walks `backend/app` and fails
on any new `date.today()` / `datetime.now(timezone.utc).date()` /
`datetime.utcnow().date()`. Three calls remain on purpose, each listed there
with its reason: the end bound sent to an external training provider (a later
bound only includes more), and two schema validators that refuse a future
date — they cannot see the organization, and for a US department the server's
date is never behind its own, so they never refuse a genuine date.

**A stored UTC timestamp cut to a date** — the same bug in a different shape:
`event.start_datetime.date()` is the UTC day, already tomorrow for an evening
event. Every such place was read (`grep -rn "\.date()" backend/app`, 49 at the
time) and the ones that name a day a person sees or a rule compares now go
through `local_date` / `to_local`: training records created from an event, the
lookups that find them, the mandatory-event leave and hire check, monthly event
counts, report dates and ranges, cohort end dates, the readiness board's
out-of-service days, a member's implied last day of service, donor first/last
donation dates, the election forensics timeline, the event-request activity
note and the store-order and inventory last-seen CSV exports
(`tests/test_org_local_today.py::TestDatesFromTimestamps`). The rest are right
as they stand: already converted to the department's zone first, provider data
from external training, a store preview, rough "last N days" windows, and
minutes action items, whose `DateTime` due date holds a plain date at UTC
midnight — converting that one would move it a day earlier.

**Accepted: training records written before 2026-09-27 keep their UTC date.**
A record created from an evening session was filed under the next day, which
for a session on the last day of a month puts it in the next month's
compliance. New records are dated by the department's calendar, and the
lookups that find a record for an event accept the old UTC date as well, so a
record created before the change is updated rather than duplicated. The
existing rows were deliberately not rewritten: the correct date is derivable
(the event's start time and the organization's timezone), but a migration
would change historical compliance results, and that was judged not worth it.
An officer can correct an individual record's date where it matters.

## Sign-in From a Shared Station Address (2026-10-05)

**Open decision.** A station's members usually share one public address, and
two sign-in limits are counted per address rather than per member:

- nginx's `login_limit` in both bundled proxies (`infrastructure/nginx/nginx.conf`,
  `infrastructure/nginx/docker.conf`): 5 a minute, burst 3.
- The backend's `rate_limit_login` (`app/core/security_middleware.py`): 5
  attempts in 60 seconds, counting successful ones. With Redis — the bundled
  stack — the next sign-in is refused with a 429 for the rest of the minute;
  on the in-memory fallback it locks the address out for 30 minutes.

So at shift change, the sixth member to sign in at the station within a minute
is turned away, and on the in-memory fallback everyone behind that address is
locked out for half an hour. Both are brute-force controls, so neither was
loosened when the general per-address limits were sized for a department
(`limit_conn 400`, API 50/s with a burst of 600 — see
`test_nginx_config_consistency.py`). The options are to raise the per-address
count, or to key the backend limiter on the account as well as the address;
account lockout and the suspicious-IP throttle already cover the cross-account
case. Until then, with Redis running, the cost is a member asked to wait a
minute.

## Suggestion Boxes — What Anonymity Does and Does Not Cover (2026-09-23)

**Accepted.** An anonymous suggestion is stored with no record of its author:
`suggestions.submitted_by` and every submitter-side `suggestion_messages.author_id`
stay NULL, no audit entry is written for it, screenshots are re-encoded (EXIF
and the original filename are dropped), and the submission, its screenshots'
file mtimes and the submitter's own replies are stored at 12:00 UTC of the day
rather than the moment. An anonymous submitter follows up with a random key of
which only a SHA-256 digest is stored. `tests/test_suggestion_boxes.py` pins
each of these against what is actually in the database and on disk.

What the application cannot promise, and why each is left as it is:

- **Request logging no longer records them (decided 2026-09-30).** The
  submission and follow-up routes are written to no access log: the bundled
  nginx configs drop the line (`$access_loggable` in `frontend/nginx.conf` and
  `infrastructure/nginx/nginx.conf`) and raise the error log to `crit` for
  them, and uvicorn's access log and `IPLoggingMiddleware` skip them
  (`UNLOGGED_PATH` in `app/core/logging.py`, pinned by
  `tests/test_unlogged_paths.py`). The cost is accepted: a failed or
  rate-limited submission leaves no proxy-side trace, only the backend's own
  error handling. **A proxy the operator runs in front of these is outside the
  repository** — Unraid's SWAG or Nginx Proxy Manager, an AWS load balancer's
  access logs, Cloudflare — and records the IP and the second unless it is
  configured the same way. `docs/deployment/aws.md` shows how for the host
  nginx it documents.
- **Someone with server access can still correlate by time.** The reviewers'
  notification email is sent — and logged to `message_history` — at
  submission time, their in-app notification rows carry an exact `sent_at`,
  and session activity is recorded on the member's row. None of these names
  the submitter on its own, but together they can narrow one down for whoever
  can read the server's database. Closing it would mean batching notifications
  into a delayed digest, which costs the reviewers timely notice and is a
  policy choice, not a fix.
- **A failed submission is not reported under the member's name (decided
  2026-09-30).** A 5xx on these routes used to write an `error_logs` row
  carrying the caller's `user_id`, the route and the exact second, and the
  frontend filed a second one — for a 5xx, a timeout or a network failure —
  from the member's own session; both showed on the Error Monitoring page.
  Now `persist_error_log` skips them (`is_excluded_path`), the frontend's
  `reportApiError` does not send them, and `POST /errors/log` discards one
  that arrives anyway (`is_excluded_client_path`) — a build cached before the
  change still sends them. The cost is accepted: a failed anonymous
  submission does not appear on the Error Monitoring page. The backend's
  structured log still records the failure with the route and the time — no
  user and no IP — so an operator can see that submissions are failing.
- **A lost follow-up key cannot be recovered.** Nothing links the key to the
  member, which is the point. The submission itself survives; the member's
  ability to read replies and respond does not.
- **The content of a screenshot is not inspected.** Metadata is removed, but a
  screenshot that shows the submitter's own name on screen still shows it. The
  form warns the member when the submission is anonymous.
- **The creation time of a screenshot file (`ctime`) is exact.** `mtime` is
  reset to the day stamp; POSIX offers no call to set `ctime`.

**Also a decision, not an omission:** the `/api/v1/suggestions` router is not
gated on the `communications` module flag, for the same reason as
`/api/v1/messages` — the flag defaults off and none of the module's screens
honour it, so gating only this router would hide suggestion boxes on almost
every installation. It is recorded in `DELIBERATELY_UNGATED` in
`tests/test_module_api_gating.py`.

## Self-Report Attachments — What Happens to the File (2026-08-23)

A member can attach a certificate (PDF/JPG/PNG, 10 MB) to a self-reported
training. Where the bytes end up, and when they are removed, is deliberate —
and partly still open.

**Where they live.** `/app/uploads/training_attachments/self_reported_submissions/<org_id>/`,
under the _training-record_ attachment root on purpose. Approval copies the
submission's attachment dicts onto the `TrainingRecord` verbatim, and the
record download route confines paths to `TRAINING_ATTACHMENT_DIR`; a sibling
directory would 404 every approved certificate from the member's own training
history. `tests/test_training_submission_drafts_attachments.py` asserts the
nesting.

**When they are removed.** Deleting or withdrawing a submission unlinks its
confined attachment paths along with the row. That is safe only because a
submission is deletable in `draft`, `pending_review` and `revision_requested`
alone — never after approval, which is the one state where a `TrainingRecord`
also references the file. **If that guard is ever widened, the delete must
stop unlinking**, or an approved member's evidence disappears from their
training record.

**Retention is the department's (resolved 2026-10-05).** Training Admin →
Review Submissions → Settings → **Certificate Files** sets
`self_report_configs.attachment_retention_days`. Unset means keep
indefinitely — the previous behaviour, so an upgrade deletes nothing. Once set
(90-day floor), the daily `self_report_attachment_retention` task deletes the
stored files of every approved or rejected submission decided longer ago than
that, and removes the references from the submission and from every training
record of that member that copied them — including a record voided by an
approval reversal. Submission and record rows stay. Only paths inside the
organization's own upload directory are touched, files go before the database
update so a failed commit is completed by the next run, and each organization's
sweep is audited as `self_report_attachment_retention`; changing the period is
audited as `self_report_attachment_retention_updated`.

Still open from the original question: **nothing sweeps an organization's
files when the organization itself is removed.** The owner chose a
department-set period over an organization-removal sweep, and the only flow
that deletes organizations today is the onboarding reset
(`POST /onboarding/reset`), which runs before a department has members
reporting training. A future organization-deletion flow must remove
`self_reported_submissions/<org_id>/` itself — the retention task reads a
`self_report_configs` row, which goes with the organization. A record whose certificate has been
swept shows no attachment and says nothing about why — the audit trail is the
only account of it.

**What is still open:**

| Item                                                      | Status                                   | Detail                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Malware scanning is opt-in, and covers this path only** | Resolved 2026-10-06 (opt-in) — see below | Uploads are validated by magic bytes and confined to a server-generated name, and with `CLAMAV_ENABLED=true` are also scanned by ClamAV before anything is written. Off by default, so a deployment that has not enabled it still serves officers whatever the member uploaded. |
| **Voided records keep the file**                          | By design                                | `DELETE /training/records/{id}` marks a record `cancelled` rather than removing it, so the correction stays auditable — and the evidence behind the corrected entry stays with it.                                                                                              |

**Malware scanning (resolved 2026-10-06, owner's choice: add ClamAV).** Both
certificate upload routes stream the file to a ClamAV daemon
(`app/services/malware_scan_service.py`, clamd `INSTREAM` over TCP) after the
magic-byte check and before the write. An infected file is refused
(`LB-UPLD-004`), nothing is stored, and `upload_malware_detected` is audited
with the signature name, type, size and SHA-256 — never the content or the
member's file name. `CLAMAV_ENABLED` defaults to `false`, so an upgrade adds no
container and changes nothing; the daemon is the `clamav` compose service under
the `with-clamav` profile. Configuration: `CLAMAV_ENABLED`, `CLAMAV_HOST`,
`CLAMAV_PORT`, `CLAMAV_TIMEOUT_SECONDS`
([wiki](../wiki/Configuration-Security.md#malware-scanning-of-uploads)).

What remains for the owner:

| Item                                                   | Status                       | Detail                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------ | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scanner outage fails closed**                        | Inferred — owner may reverse | With scanning enabled, an unreachable clamd, a timeout, or any reply other than `OK`/`FOUND` refuses the upload with a retryable `503` (`LB-UPLD-005`). Inferred from the CAPTCHA precedent (an outage must not be a bypass), not stated by the owner. Reversing it is a one-line change in `_reject_if_malicious` in `training_submissions.py`.                                                                      |
| **Other upload paths are not scanned**                 | Open (scope)                 | Each writes files through its own code; there is no shared helper to hook. Candidates: `documents.py` `POST /documents/upload` (also the source of facility photos/documents, which reference `document:<id>`), `training_enhancements.py` record attachments, `events.py` event attachments, `membership_pipeline.py` prospect documents, and `email_templates.py` template attachments.                             |
| **Files stored before scanning was enabled**           | Open                         | Not rescanned. Enabling scanning covers new uploads only.                                                                                                                                                                                                                                                                                                                                                             |
| **Re-encoded images are out of scope by construction** | By design                    | Member photos, storefront product images and equipment-check photos are decoded and re-encoded to WebP and stored in the database, and suggestion-box screenshots are re-encoded to WebP before they are written to disk — none is served as the uploaded bytes; logos are validated base64. CSV imports (training, inventory, events) are parsed in memory and not stored. They are not on the candidate list above. |

## Scheduling Module

### Naming: scheduled vs. worked (resolved 2026-08-01)

Shift counts and hours came from three different tables, and two of them
shipped under the _same field name_ with incompatible meanings, so a member
comparing screens saw a discrepancy that looked like a bug. The response
fields now say which measure they are:

| Endpoint                                  | Was                                                     | Now                                                                                                                | Measures                                                         |
| ----------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `GET /scheduling/summary`                 | `total_shifts`, `shifts_this_week`, `shifts_this_month` | `shifts_scheduled`, `shifts_scheduled_this_week`, `shifts_scheduled_this_month`                                    | Scheduled `Shift` rows                                           |
| `GET /scheduling/summary`                 | `total_hours_this_month`                                | `hours_worked_this_month`                                                                                          | Actual `ShiftAttendance` minutes                                 |
| `GET /scheduling/reports/member-hours`    | `shift_count`, `total_minutes`, `total_hours`           | `shifts_attended`, `worked_minutes`, `worked_hours` (+ `shifts_scheduled`, `scheduled_minutes`, `scheduled_hours`) | Attendance check-in/check-out, with the scheduled plan alongside |
| `GET /training/module-config/my-training` | `shift_stats.total_shifts`, `.total_hours`              | `.shifts_completed`, `.hours_reported`                                                                             | `ShiftCompletionReport` rows                                     |

The member-hours report was then **re-sourced from attendance** (2026-08-01):
an assignment is a plan, not a measurement — a shift can run short or long,
or be assigned and never worked — so anything that credits or pays a member
now uses the measured figure. Scheduled totals ride alongside with a
Difference column, so plan-vs-actual is visible rather than something a
reader has to know to ask about.

| Item                                                        | Status                                                                       | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Platoon presets cover 3-platoon rotations**               | Accepted                                                                     | Multi-platoon generation offsets are validated for the common 3-platoon presets (24/48, Kelly, 48/96). Departments running non-standard platoon counts should verify the generated tiling. See [SCHEDULING_MODULE.md → Platoon Rotations](./SCHEDULING_MODULE.md#platoon-rotations-added-2026-06-19).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **"Shifts completed" has three sources of truth**           | ✅ Resolved (2026-10-06, owner decision: `ShiftAttendance` is authoritative) | A `RequirementType.SHIFTS` requirement was counted from `TrainingRecord`s on the training screens (every completed record in the window counted as a shift), from attendance rows finalized or not on the scheduling Shift Compliance report, and from shift reports in the program ledger. Every grader now counts it through `training_compliance.load_credited_shift_dates`: attendance on the department's own **finalized** shifts plus **counted** external shifts, inside the requirement's own compliance window and cut-off — the compliance matrix, dashboard percentage, Department Compliance card, period roster, profile card, My Training, `/training/requirements/progress` and its MCP tool, the annual and monthly reports, the competency matrix, the compliance exports and forecast, and the Shift Compliance report (which now grades SHIFTS rows through the shared grader, with training waivers, and reports the window it counted). **Numbers moved:** a member whose training records stood in for shifts drops to the shifts they actually worked; a member who worked shifts but had no matching records rises to them; on the Shift Compliance report a shift not yet finalized stops counting, the period becomes the requirement's compliance window (not the report's own period calculation), and waivers replace the rolling-only leave pro-rating for SHIFTS rows. A SHIFTS requirement an officer marks not `shift_credited` stays on training records everywhere and off the Shift Compliance report. The program ledger (`RequirementProgress`) is not a compliance source: no compliance grader reads it, and since W26-1 it is not consulted for a linked requirement either (that row is the compliance result). A program-owned SHIFTS requirement still accrues one unit per shift completion report — see "A program-owned SHIFTS requirement counts shift reports" below. |
| **No formal "active/in-progress" shift state**              | Accepted                                                                     | `ShiftStatus` is `scheduled`/`cancelled` only; a shift's "activeness" is implied by `start_time`/`end_time` vs. now, and `is_finalized` marks closed. The live readiness panel (2026-07-16) covers most of the operational need without a dedicated state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Count-only call tracking: no cross-unit attach picker**   | ✅ Resolved (2026-10-05, owner decision: build the picker)                   | The close-out wizard's step 2 now lists **Already logged by another unit** — calls another unit recorded while the shift was on, matched by overlapping shift times — and a tick sends `attach_call_ids`, an untick `detach_call_ids` (new; removes only this shift's response, and refuses a call no other unit is on). `attachable_calls` is served from `CallTrackingService.list_attachable_calls` for an unfinalized count-only shift, with `unit_labels` and `attached`. The call-volume report's count-only branch now serves `counts_unit_responses: false` and reads **Total Calls**. What remains is a matter of practice, not code: a second unit that types the incident into its own count instead of ticking it still records a second call, and nothing can match the two afterwards. (SCHED-10)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **`dispatch` / `derived` call sources have no writer**      | Accepted (forward compatibility)                                             | `CallSource.DISPATCH` / `.DERIVED` and the `uq_org_call_external_ref (organization_id, external_ref)` constraint exist so a CAD integration can be added without a migration — the constraint is what would make a re-sync idempotent. Nothing writes either value today; every row is `manual`. (SCHED-12)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **A program-owned SHIFTS requirement counts shift reports** | Open (needs product decision)                                                | A SHIFTS requirement created inside a training program (`ProgramRequirement.owns_requirement`) applies to nobody on the compliance screens; only the program's `RequirementProgress` ledger grades it, adding one per shift completion report an officer files for the trainee (`shift_completion_service._update_requirement_progress`). It therefore still counts shift reports, not `ShiftAttendance`. Moving it to attendance would drop the officer's "this shift counts toward the program" step and needs a start date (enrollment, or the requirement's own window), which the shifts-three-sources decision did not settle.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

### Shifts With Other Departments — Counted on Entry (2026-09-27)

Members log shifts they worked on another jurisdiction's apparatus from **My
Hours** (`/api/v1/scheduling/external-hours`). Three choices were made on
purpose, and a department should know them:

- **An entry counts as soon as it is saved.** There is no approval queue. An
  officer with `scheduling.manage` reviews after the fact from **Scheduling
  Reports → Member Hours** and rejects an entry that should not count, which
  removes it from every total. The member sees the reason. A department that
  needs sign-off _before_ credit does not have that option today.
- **It is reported beside the department's own hours, never inside them.**
  `hours` / `worked_hours` stay attendance on this department's shifts, and
  outside time appears as `external_*`. It **is** added into the shift and
  hours figures of `GET /scheduling/reports/compliance`, since that report
  measures a member against a requirement.
- **Training-side compliance sees it for SHIFTS only** _(2026-10-06)_. A
  shift-credited `SHIFTS` requirement counts shifts worked on every screen,
  and a counted outside shift is one of them (see "Shifts completed has three
  sources of truth" above). An `HOURS` requirement evaluated by the training
  module counts `TrainingRecord` rows, so outside hours do not move it. Outside
  shifts do not feed a program-owned requirement's progress, which reads
  `ShiftCompletionReport`.
- **A member can't log a shift on a unit that isn't listed.** The apparatus
  comes from a list scheduling officers keep (Scheduling → Settings → Outside
  Apparatus), so that the apparatus summary counts one unit once. A member
  whose unit is missing has to ask an officer to add it before logging the
  shift; nothing queues the claim in the meantime.

## Call Volume Reporting — Two Gaps Between Payload and Screen (2026-08-19, narrowed 2026-10-04)

Found by a Codex review of PR #1573, verified against the source, and confirmed
as documentation defects rather than code regressions — the docs promised
behaviour the read path does not implement. The guides now describe what is
built; these track the code.

Five were recorded. SCHED-13 (the CSV export's "Total Calls" header on unit
responses), SCHED-16 (per-unit runs never displayed) and SCHED-17 (type slugs
instead of the department's labels) are fixed. The two below change published
figures, so each needs a product decision first. SCHED-10 and SCHED-12
above cover the _write_ side of count-only tracking; these cover the _read_
side.

| Item                                                        | Status                        | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A date range spanning a mode change omits one period**    | Open (needs product decision) | `ReportsService.get_call_volume_report()` picks its source from the organization's **current** `call_tracking.mode` and applies it to the whole range. Switching to `count_only` hides every earlier detailed-mode figure; switching back hides the `org_calls` era. Nothing warns — the number is just smaller. A correct fix reads each shift under the mode in force when it closed, which means recording that mode per shift; the cheap fix warns when the range predates the current mode's adoption. Not a silent-fix candidate: both change published figures. (SCHED-14) |
| **"Total Calls" in detailed mode is not an incident count** | Open (needs product decision) | The detailed branch sums `calls_responded` over `ShiftCompletionReport` rows, which are **per trainee** — so a shift with two enrolled trainees contributes its calls twice, and manually filed reports are added alongside. The count-only branch was built carefully to count one incident once; the branch beside it was never held to that standard. Renaming the figure is the honest short-term move; sourcing it from `shift_calls` is the real one. (SCHED-15)                                                                                                            |

Two adjacent behaviours are **working as designed** and are documented in the
guides rather than tracked here, because the code is right and the earlier
wording was not:

- **The close-out wizard has no separate total field.** `deriveCallTotal()` sums
  the visible type rows including "Not categorised", so the API's short-tally
  behaviour (a `reported_call_count` larger than the breakdown, remainder stored
  as `unclassified`) is reachable only by a client that sends the two
  separately. An officer who leaves the remainder out records a **smaller
  shift** — the guides previously told them to do exactly that, and now tell
  them to use the Not categorised row.
- **A saved zero and a saved blank are indistinguishable.** Both write no
  `OrgCall` rows, both return `reported_call_count: 0`, and hydration renders
  both as empty. The request layer distinguishes an omitted field from an
  explicit null (`count_provided`), which is what lets a correction clear a
  previous count — but that distinction ends at persistence, so no report can
  tell a quiet tour from an unanswered question. Preserving it needs a stored
  marker.

## The Two Apparatus Tables (2026-08-08)

Not a limitation — a piece of the data model that is easy to get wrong, recorded
here because it already produced two production defects that were mirror images
of each other.

**There are two apparatus tables and that is intentional.** `basic_apparatus` is
the lightweight definition onboarding collects (unit number, type, minimum
staffing, riding positions) — enough to staff a shift. `apparatus` is the full
module record, with maintenance history, fuel logs, NFPA compliance and
inventory. A department has one or the other, or both.

**`shifts.apparatus_id` is therefore polymorphic.** It is a bare `String(36)`
with no foreign key, and it holds whichever id `GET /scheduling/apparatus-options`
served the shift form. That endpoint's documented priority is **full `Apparatus`
records > `BasicApparatus` records > hardcoded type defaults**, so the same
column means different things in different deployments.

Nothing enforced that, and the two consumers each assumed the _other_ source:

| Defect                                                                                                       | Who it broke                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `submit_check` copied the shift's id into `shift_equipment_checks.apparatus_id`, a real FK to `apparatus.id` | Every department on `BasicApparatus` — **every** equipment-check submission for a shift with an apparatus 500'd                                                         |
| `create_shift` / `update_shift` validated the id against `BasicApparatus` only                               | Every department on the full Apparatus module — could not assign an apparatus to a shift at all, since the validator rejected the very ids the form had just been given |

Three further consequences of the same root cause, all fixed alongside:

- `_resolve_templates` looked up `Apparatus` by a `BasicApparatus` id, so **no
  equipment-check templates ever resolved** for those departments; and the
  apparatus-type fallback below it read `apparatus.type`, an attribute the model
  does not have (it has `apparatus_type_id` and an `apparatus_type`
  relationship). That `AttributeError` was latent only because the branch was
  unreachable — fixing the id alone would have unmasked it.
- Shift lists loaded apparatus names and min-staffing from `BasicApparatus`
  only, so full-Apparatus departments saw blank unit numbers and lost the
  understaffing badge.
- Two of those lookups had no organization filter (XC-1); resolution is now
  org-scoped throughout.

**The rule: never pass `shifts.apparatus_id` to something that expects one
table.** Use `app/utils/apparatus_ref.py`:

| Helper                                        | Use it for                                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `resolve_apparatus_ref(db, id, org)`          | One shift — returns which table the id belongs to, plus `full_id`, `type_slug`, `unit_label` |
| `apparatus_ref_exists(db, id, org)`           | Validating client-supplied input; true for an in-org id in **either** table                  |
| `resolve_apparatus_display_map(db, ids, org)` | A list of shifts — batch, at most two queries                                                |
| `resolve_apparatus_labels(db, ids, org)`      | Same, when only a display string is needed                                                   |

**Storing `NULL` is correct, not lossy.** When a shift's apparatus is a
`BasicApparatus`, `shift_equipment_checks.apparatus_id` is set to `NULL`: that
department has no full apparatus record for the vehicle, and the column is
nullable with `ON DELETE SET NULL` precisely because a check need not be
attributable to one. The check still links to its shift, which carries the
apparatus reference. The apparatus-compliance report is inherently a
full-Apparatus-module feature — it iterates `apparatus` rows — so it was already
empty for those departments and loses nothing.

**Deficiency flags are full-Apparatus only — accepted (owner decision
2026-10-04).** `has_deficiency` lives on the `apparatus` row, so a
`BasicApparatus` department gets no deficiency badge from a failed check. The
owner chose to leave it there: the full Apparatus module provides the flag, and
adding safety state to `basic_apparatus` waits until a lightweight department
asks for it. The apparatus guide says so.

## Multi-Tenant Isolation & Module Audit (2026-07-25)

Open items surfaced by the module-by-module security audit
([`docs/module-audit/`](./module-audit/PROGRESS.md)). Applied fixes are in the
CHANGELOG; the items below need an owner decision or are deferred design changes.
Per-module docs under `docs/module-audit/` carry the full lower-severity list.

| Item                                                                                                                                                                         | Status                                                                                                                    | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Executive-session minutes need a viewer tier below `minutes.manage`?**                                                                                                     | Open decision (LOW)                                                                                                       | MM-3 is fixed: plain `minutes.view` holders now see only approved, non-executive minutes; `minutes.manage` sees all. Follow-up open decision: if board members who attend executive sessions but don't hold `minutes.manage` should read executive minutes, a dedicated `minutes.view_executive` tier is needed (seed + roles + frontend). Also: frontend `canManage` uses `meetings.manage` while the backend uses `minutes.manage` — roles managing minutes should hold both. **Update (MM2-1, 2026-08-06):** publishing executive minutes to the shared Meeting Minutes document folder is now blocked, because that folder is readable by the broad `documents.view` audience and so bypassed the restriction. Sharing an executive session with a _restricted_ audience is the same build as the `minutes.view_executive` tier above (a restricted document folder or per-document permission), not a one-click publish.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Equipment-check: read endpoints bypass `equipment_check.view`; compliance metrics stubbed**                                                                                | Partially resolved (LOW)                                                                                                  | **Fixed:** `complete_incomplete_check` now re-applies the expired/under-min auto-fail rule before computing counts (matching initial submit — EC-10); `create_report` validates a client-supplied `trainee_id` is in-org when no shift links it (EC-6); `get_report` takes an org filter and all callers pass it (EC-9). **Still flagged:** the detail/read endpoints use bare `get_current_user` (org-scoped but looser than the `.view`-gated list routes — tightening is a deferred behavior decision, EC-7); a few by-id reads used only for changelog text lack an org filter (harmless, EC-8); `get_compliance_report` returns hardcoded `0` for expected/overdue counts (needs a check-cadence model — incomplete feature, EC-11).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Public portal: per-process rate limiter + application-status token plaintext at rest**                                                                                     | ✅ Resolved (2026-10-05, owner decision PP-6)                                                                             | **Both halves done (owner: "do both").** The portal's per-IP and per-API-key limits now count in Redis, shared by every worker (`_shared_window_hit` in `app/core/public_portal_security.py`), so the ceiling is the limit rather than workers × limit; the per-process caches answer only when Redis is down or a command fails (degraded, never unchecked). The applicant status token is looked up only by its SHA-256 (`status_token_hash`) and stored AES-256-GCM encrypted (`EncryptedText`) for the emails that re-send the link, so a database or backup read no longer yields a live token. Migration `f7c09cfec5b0` hashes and encrypts existing tokens in place — the token itself never changes, so links already in applicants' inboxes keep working. Tests: `test_public_portal_security.py::TestSharedRateLimit`, `test_status_token_at_rest.py`. **Resolved earlier from this cluster:** `authenticate_api_key` throttles the `last_used_at` write (≤ once/60 s per key) and `detect_anomalies` uses 2 COUNT queries instead of 3 (PP-7); the access-log viewer auto-escapes `user-agent`/`referer`/`ip` via JSX (no stored-XSS — PP-5). Accepted design limitations: the whitelist has no per-subfield granularity (a whitelisted `mailing_address` exposes the whole nested dict — intentionally-public org data, not member PII), and the ≥36-bit display code has no per-code lockout (bounded by the per-IP limit, now global). **Not covered:** `EventRequest.status_token` (the public event-request status link) is a separate credential on a separate table and is still plaintext at rest; it was not part of PP-6.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Onboarding: role editor accepts client-controlled permissions / priority / system-flag**                                                                                   | Open (MED/LOW, needs design)                                                                                              | `save_session_roles` accepts fully client-supplied role `permissions`, `priority`, and `is_custom` (which sets `is_system`), and keys updates on the client-supplied slug — so an in-progress onboarding session can mint a high-priority `is_system` role, rewrite an existing system role by slug, or emit near-arbitrary `{module}.*` permission strings (a literal top-level `*` is not injectable, and the completion guard now blocks post-setup replay). Clamping priority, rejecting system-role re-mint, and allowlisting `module_id` would change what the legitimate onboarding role editor can express, so it needs a product decision. (ONB-7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Onboarding: session TTL has no absolute cap, only a sliding 30-minute window**                                                                                             | Open (LOW, policy decision)                                                                                               | `validate_session` renews `expires_at` by another 30 minutes on every successful call — there is no maximum age tracked from session creation. Three routes (`GET /system-info`, `/security-check`, `/database-check`) call it with `require_csrf=False`, so the **session id alone** (no CSRF token) is enough to keep sliding the expiry indefinitely; a holder of just the session id can keep the pre-completion exploitation window open forever by polling any of those three, rather than it expiring 30 minutes after issuance as the user-facing message implies. (`GET /session/data`, unlike those three, does require the CSRF token — it is not itself part of the bearer-only path.) Capping absolute session lifetime is a policy choice (what the cap should be, and whether routine wizard navigation could ever hit it) rather than a drive-by fix. (ONB2-30-8)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Onboarding: `/test/email`'s self-hosted SMTP test has no SSRF/private-network protection**                                                                                 | Open (MED, policy decision)                                                                                               | `POST /onboarding/test/email` (`platform: "selfhosted"`/`"other"`) connects via `smtplib` to a fully client-supplied `smtpHost`/`smtpPort` with no hostname/IP validation — the only client-directed outbound connection in the codebase that doesn't route through `app.utils.url_validator` (every webhook/OAuth integration does, but those are HTTP(S)-URL based; this is a raw SMTP host:port, so the existing helper doesn't apply as-is). Reachable pre-auth: obtaining the required onboarding session needs only `POST /start`, which succeeds for anyone until the first organization exists. Differentiated error messages (connection-refused vs. timeout vs. DNS-failure vs. wrong-protocol) let a caller fingerprint what's listening on an internal `host:port` during the bootstrap window — network reconnaissance, not data exfiltration (`smtplib` only speaks SMTP over the socket, so it can't be turned into an HTTP GET against something like a cloud metadata endpoint). Not fixed because the obvious mitigation (block private IPs, mirroring `url_validator`) would break a normal, expected deployment pattern for this app's audience — an on-premises SMTP relay reachable only from the department's internal network — so it is a product-policy tradeoff, not a bug with an obviously-correct fix. (ONB-30-3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Core infra: fail-open TLS/image handling + latent cache isolation gaps**                                                                                                   | Partially resolved (2026-08-07)                                                                                           | (1) ✅ **Resolved as an opt-in.** Two distinct cases, now separated. "TLS enabled but peer unverified" (`DB_SSL`/`REDIS_SSL` on with no CA → `CERT_NONE`) was already CRITICAL and blocks boot in production/staging, waivable via `SECURITY_ALLOW_UNVERIFIED_TLS` — that configuration looks secure and is not, which is worse than honest plaintext. "No TLS at all" is governed by **`SECURITY_REQUIRE_TLS`** (default `True`): absent `DB_SSL`/`REDIS_SSL` is promoted from WARNING to CRITICAL and refuses to start. A deployment with equivalent transport protection (private network, service mesh, or sidecar) must explicitly set the flag to `False`, so plaintext transport is no longer silently permitted. Covered by `tests/test_tls_required_config.py`. (2) `optimize_image` fails open — a valid-header decompression bomb or any processing error returns the original bytes unprocessed (storing the bomb, bypassing EXIF/GPS stripping) and it doesn't set a local `MAX_IMAGE_PIXELS`; making it reject changes the avatar/equipment-photo upload contract. (3) Redis TLS disables cert + hostname verification when no CA is configured (`CERT_NONE`). (4) The Redis cache manager provides no tenant namespacing — all current callers use intentionally-global keys (no PHI cached), but there's no guardrail against a future caller caching an org-scoped record under a bare id; `clear_pattern()` is an unused wildcard-delete footgun. (5) WebSocket `accept()` precedes auth (deliberate, so close codes reach the browser). (CI-9/CI-10)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Crypto: AES-256-GCM + 600k PBKDF2 done; MFA recovery-code entropy raised**                                                                                                 | Partially resolved (LOW)                                                                                                  | **Done:** at-rest field encryption now uses **AES-256-GCM** (authenticated; a tampered value fails closed via `InvalidTag`). Legacy Fernet (AES-128-CBC + HMAC) values remain readable, and `scripts/reencrypt_to_aesgcm.py` backfills existing rows to GCM (run it against staging with a DB backup first — it is dry-run by default; see `docs/AES256_GCM_BACKFILL_RUNBOOK.md`). Once the backfill is verified complete, Fernet read-support can be removed. **Also done (app-review B24):** the KDF work factor for new (`$gcm2$`) values is now **600k** PBKDF2-HMAC-SHA256 iterations (the 100k `$gcm1$` path is read-only for migration-era values). **Also done (CI-10, owner decision 2026-10-05: upgrade on next regeneration):** new MFA recovery codes carry 80 bits (`_RECOVERY_CODE_BYTES = 10`, shipped in #2722), which puts an unsalted SHA-256 lookup table out of reach; codes issued before that keep verifying until the member regenerates, so nothing was invalidated (`test_a_code_issued_before_the_upgrade_still_verifies`). (CI-5 + PBKDF2 done / recovery-codes CI-10 / CI-4 fail-closed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Security/IP: audit-chain rehash laundering + break-glass gate**                                                                                                            | ✅ Resolved                                                                                                               | `rehash_chain` used to recompute `current_hash` from each row's current `event_data` for **every** row, so a privileged operator with DB write access could edit a keyed (v2) row and run rehash to launder the tamper into a valid keyed chain. Rehash now only repairs legacy (unkeyed) rows and **fails closed** (409) on a keyed-row mismatch — it never rewrites a keyed row. And because rehash rewrites the single cross-org chain and there is no platform-super-admin role, `POST /audit-log/rehash` is now disabled (403) unless a server operator sets `AUDIT_ALLOW_CHAIN_REHASH=true` (env = the de-facto platform-admin boundary), so an ordinary org admin holding `audit.export` can no longer trigger a platform-wide chain rewrite. (SEC-7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Security/IP: global country-block table + geo fail-open**                                                                                                                  | ✅ Resolved                                                                                                               | Geo-blocking is a platform-edge control (enforced before any tenant/auth context, against one shared MaxMind DB + one global blocked-country set), so per-org `CountryBlockRule` rows don't fit the enforcement model. Instead: (1) `GEOIP_FAIL_CLOSED` (default False) makes `is_ip_blocked` block any IP whose country can't be resolved — including the missing/corrupt-DB case — closing the "silently disabled app-wide" hole; private/reserved IPs are still allowed first, so an internal operator can recover (correction 2026-08-27: allowlisted IPs are no longer part of that recovery path — see the next row). (2) The two mutating country-rule endpoints are gated by `GEOIP_ALLOW_COUNTRY_RULE_MANAGEMENT` (default False), so an org admin can no longer alter the shared cross-tenant blocklist via the API — the operator sets it at deploy time via `BLOCKED_COUNTRIES`. The non-destructive audit-chain ops (`/checkpoint`, read-only `/integrity`) remain on `audit.export`/`audit.view`. (SEC-8)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Security monitoring: anonymous brute-force alerts on a multi-organization install have no viewer**                                                                         | Open — needs a platform-operator design (narrowed 2026-10-05)                                                             | The rest of this item is resolved (owner decision SEC2-28-alerts, "build UI + backend fixes"): `/admin/security-alerts` lists, acknowledges and resolves alerts with an attributed audit trail; the exfiltration check sizes exports from the bytes sent rather than a `Content-Length` header and matches parameterized export routes; every export is logged (route, size, member, IP — never the content or query string) and listed under `GET /security/download-activity`; and a failed sign-in against a known account now attributes its brute-force alert to that account's department, while a single-organization install attributes every tenant-less alert to its one department. **What remains:** on an installation hosting **more than one** organization, a brute-force alert against an _unknown_ username belongs to no tenant and is stored with `organization_id = NULL`, which no org-scoped view returns. Showing it needs a decision on who may see login-page activity that is not their department's — a platform-operator role, which this codebase does not have — and that is not inferred here. See `docs/security-review/SEC2-28-security-audit-ip.md` → SEC2-28-7.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Security/Audit: the hash chain has no write-concurrency control — two simultaneous audit-log writes fork the chain, and `verify_integrity` reports the fork as tampering** | 🚩 Open — needs a schema change + owner decision                                                                          | `AuditLogger.create_log_entry` reads the chain's "last row" (for the new row's `previous_hash`) with a plain, non-locking `SELECT ... ORDER BY id DESC LIMIT 1`, inside a SAVEPOINT that provides no cross-transaction serialization. Two audit-log writes on two different `AsyncSession`s racing under MySQL's default `REPEATABLE READ` can both read the same last row and both write the same `previous_hash` — reproduced directly with two independently-committing sessions and `asyncio.gather` (100% reproduction rate on a fresh chain). There is no DB constraint to catch this at write time; it surfaces only later, when `verify_integrity` reports the fork as `"Chain broken - previous hash does not match"` — indistinguishable from real tampering, and it fires a `LOG_TAMPERING` CRITICAL alert (`get_security_status` calls `verify_log_integrity` on every `/security/*` GET). This is reachable by an **unauthenticated** caller: `IPBlockingMiddleware._log_blocked_attempt` opens its own session and writes an audit row for every blocked request, so a burst of concurrent requests from a blocked IP/country triggers the race with no credentials at all — a denial-of-service against the integrity-monitoring subsystem's own credibility (false CRITICAL alerts train operators to distrust real ones). **Why not fixed:** the obvious mechanical fix (`.with_for_update()` on the last-row read, mirroring the `audit_ship_service.py` watermark fix, SEC2-28-9) doesn't transfer safely — that fix's lock is held inside one short, dedicated function; this one's SAVEPOINT lives inside whatever the _caller's_ outer transaction is, so the row lock would be held until the caller's own commit, potentially the rest of the request, on a function called from a large fraction of the app's endpoints. That risks serializing large, unrelated swaths of app traffic behind a single global lock — a load-tested rollout decision, not a drive-by fix. The likely correct shape is a dedicated "chain head" row updated in its own short, self-contained transaction (schema change + migration). Found in security-review SEC2-28 pass 4 (2026-09-13); see `docs/security-review/SEC2-28-security-audit-ip.md` → SEC2-28-10. |
| **Compliance: reporting correctness & email abuse-surface polish**                                                                                                           | Partially resolved (LOW/MED)                                                                                              | **Fixed:** the report email HTML now `html.escape`s the org name, `report_type`, and period label (was raw interpolation of user-controlled values — mail-client HTML/script injection); `report_type` is constrained to `monthly`/`annual` (was free-form, persisted + interpolated). **Still flagged:** report emailing accepts client-supplied recipients (external auditors are a legitimate case — **owner decision 2026-08-09: allow any recipient, but audit-log each send to a non-member address**; `_email_report` now calls `audit_external_recipients`, which writes an `external_recipient_send` audit event listing every out-of-org address); attestation history over-fetches globally (blocked on the deferred `audit_logs.organization_id` column — availability, not a leak); `records_with_certification` mislabel left as-is (ambiguous intent). (CS-9)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Compliance: "notify non-compliant members" / reminder-days settings are stored but never sent**                                                                            | 🚩 Open — needs a reader built (security-review pass 2, CMP2-1)                                                           | `ComplianceConfig.notify_non_compliant_members` and `.notify_days_before_deadline` are set from `ComplianceRequirementsConfigPage.tsx`'s Notifications panel, persisted, and returned on every `GET /compliance/config` — but no scheduled task or notification sender anywhere in the backend reads either column (confirmed: `grep -rn notify_days_before_deadline backend/app` outside `schemas/`/`models/` returns nothing). A compliance officer who enables the toggle and sets "30, 14, 7" believes members are reminded before their deadline and notified on becoming non-compliant; neither happens. This is the same shape as the `notification_rules` gap CLAUDE.md Pitfall #19 documents. **Partial fix applied:** the panel now carries an explicit "Not yet active" notice so the UI stops implying the feature works (`ComplianceRequirementsConfigPage.tsx`, `docs/security-review/CMP-20-compliance.md` CMP2-1). **Still needed:** a scheduled task (alongside the existing `compliance_auto_reports` task) that evaluates each org's compliance status against `notify_days_before_deadline` and emails members per Pitfall #18 (email-first; SMS only via the `SmsAlert` allowlist if ever added) — a product/architecture decision on cadence and message content, not a drive-by fix.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Finance: no separation of duties on terminal money movement**                                                                                                              | ⚠️ Narrowed (verified app-review A9)                                                                                      | **✅ The severe case is closed:** the request **approval step** now calls the shared `assert_different_person` guard (`finance_service.py:649`), so one person can no longer both raise a purchase/check request and approve it — a second person must approve before anything is payable. **The disbursement half has since closed too** (verified app-review A9 pass 3, 2026-10-04, by extracting every `assert_different_person` call site and its arguments from the AST): `mark_pr_paid`, `mark_expense_paid`, `issue_check` and `waive_dues` each now compare the actor against the request's `requested_by` / the expense's `submitted_by` / the dues member and refuse on a match. Two of the seven methods this row used to name — `void_check` and `unwaive_dues` — take **no actor parameter at all** and are reversals rather than disbursements (voiding your own check or re-imposing your own waived dues moves money _away_ from you), so they are correctly unguarded, not gaps. **One is genuinely still open:** `record_dues_payment` accepts a `recorded_by` and settles money, and has no guard — while its exact analogue on the storefront side (`record_payment`) does, and `waive_dues` on the _same_ `MemberDues` record does. See the OPS-8 entry below. **Also still open, and the broader point:** none of these carries a _distinct permission_, so this is self-dealing prevention, not three-way separation — the requester can still execute an already-approved payment raised by somebody else. Full separation needs a `finance.disburse`/treasury permission on roles (seed + roles + frontend). (FIN-4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Finance: dues administration has no UI — every write is API-only**                                                                                                         | Open (MED, missing feature)                                                                                               | `DuesManagementPage` is read-only: schedule filter, status tabs, summary cards and the member dues list. The store exposes only `fetchDuesSchedules` / `fetchMemberDues` / `fetchDuesSummary`, and `duesService` has no `unwaive` or payment-history call at all. So creating a schedule, generating member dues, recording a payment, waiving, reversing a waiver and reading the payment ledger are all reachable only through the API, despite every one of them being an endpoint. `docs/training/11-finance.md` documents the click-paths as the intended UI and now carries a callout saying so; the YouTube shorts for the dues fixes (8m/8n) are written but on hold because there is nothing to film. Closing this is a frontend build-out, not a fix.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Finance: correctness/DoS polish (export, pagination, request numbers, float aggregates)**                                                                                  | ⚠️ Mostly resolved (re-verified, security-review FIN-05 pass 4, 2026-09-08; corrected same-day, Codex review on PR #2398) | This row had gone stale — the items marked "still flagged" below were already fixed on `main` (in the finance-approvals security-review's own earlier passes, never threaded back into this row). Re-verified directly against current code: `_generate_request_number` is MAX-of-suffix-based with a per-org unique constraint and a SAVEPOINT retry allocator (fixed 2026-07-31); every list method the original finding named (`list_purchase_requests`, `list_expense_reports`, `list_check_requests`, etc.) pushes `.offset()`/`.limit()` into the SQL query, none fetches-all-then-slices; `generate_export` caps at `max_records=10_000` and streams in 500-row batches via `SafeCsvWriter`; `_mutate_budget` takes a locking read and raises `BudgetLimitExceededError` whenever a spend/encumbrance would exceed `amount_budgeted`, fail-closed with no override. Money storage and arithmetic are `Decimal`/`Numeric(12,2)` throughout; the only remaining `float()` casts are two percentage/rate display roundings, not currency math (one needless `Decimal`→`float`→`Decimal` round-trip on `entity_amount` in `get_pending_approvals` was found and removed this pass). **Still open:** `list_dues_payments` (`GET /dues/{dues_id}/payments`) is also a list method and does not paginate — it eager-loads one member's entire payment ledger unbounded (this row's own first correction overclaimed "every list method" before Codex review caught the exception); left flagged rather than fixed since pagination would change the endpoint's response shape. _(2026-10-04: `get_pending_approvals` now filters to the steps the caller is the named approver of — the step's `approver_type`/`approver_value`, matched by `finance_approver_matching.py`, needed no new assignee field — and approve/deny enforce the same rule; see `docs/FINANCE_MODULE.md` → "Who may act on a step".)_ (FIN-7/FIN-30; see `docs/module-audit/finance.md`'s FIN-7 entry for the full re-verification.)                                                                                                                                                                                                                                                              |
| **Recurring: create/update paths trust client-supplied FK ids without an org check (XC-1)**                                                                                  | Open (LOW, systemic)                                                                                                      | The dominant cross-cutting pattern — create/update methods store `user_id`/`category_id`/`assignee_id`/etc. without verifying the referenced row is in-org. Individually low impact (org-stamped writes → dangling/mis-attributed FKs, not disclosure), but pervasive. Best closed by a shared `assert_in_org(db, Model, id, org_id)` helper rolled out per module. Full instances in [`docs/module-audit/CROSS-CUTTING.md`](./module-audit/CROSS-CUTTING.md) (XC-1/2/3).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Email attachments: the detected MIME type is validated, then discarded**                                                                                                   | 🚩 Open (LOW, 2026-09-09, app-review MAIL-22 — needs an extension↔MIME pairing table and a mismatch policy)               | `upload_attachment` sniffs the real content type with `detect_mime_type` (`email_templates.py:616`), uses it to accept or reject the upload (`:623`), and then persists `content_type=file.content_type` (`:665`) — the **client's claim**, which is what the send path attaches the file as. Extension and content are each checked against their own allowlist and never against each other, so a file named `.pdf` whose bytes are `image/svg+xml` satisfies both and is mailed out declared as `application/pdf`. Impact is bounded by who can reach it — the uploader already holds `settings.manage` — which is why this is LOW; the substance is that the code does the expensive, correct thing and throws the answer away. **Why not fixed in the review that found it: the obvious fix is wrong.** `.docx`/`.xlsx`/`.pptx` are ZIP containers and libmagic commonly reports `application/zip` for them, which is exactly why `ALLOWED_EMAIL_MIME_TYPES` lists both `application/zip` and the three OOXML types — so simply storing `detected_mime` would attach a Word document as a zip and mail clients would present it as one. The real change is a consistency check between the extension and the detected type, carrying an explicit OOXML/zip equivalence, plus a decision on what to do on mismatch: reject the upload, or accept it and store the detected type. Both are defensible and the choice is the owner's. Note the `MAIL-` prefix is shared with `docs/security-review/MSG-25-messaging-notifications.md`, whose own MAIL-1…5 are unrelated to this row. See [`docs/app-review/email-templates.md`](./app-review/email-templates.md) → Pass 5.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## Application Review — Feature Rotation (2026-08-05)

Owner-decision items from the feature-by-feature review under
[`docs/app-review/`](./app-review/PROGRESS.md).

| Limitation                                                                                                                           | Status                                                                                                                                                                                  | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Admin hours: `export_entries_csv` is unbounded and non-streaming**                                                                 | Open (MED, needs a page-size/streaming decision shared with two sibling exports; security review AH-21 pass 4, 2026-09-11 — carried forward from pass 2, never previously tracked here) | `GET /admin-hours/entries/export` runs one org-scoped query with no `.limit()` and builds the full CSV in memory before the response starts — for a long-tenured department's complete, unfiltered history, a large synchronous query and a large in-memory string. Known since pass 2 (AH21-1's "Follow-up, round 2," 2026-08-30), which explicitly left it out of scope as matching two other export endpoints with the identical shape (`reportExportService.exportReport`, the storefront order export) — but it was never carried into this file, so it read as resolved by omission through passes 3 and 4's first draft. Same shape as MSUP-4/MSUP-10/GF-33 below: not a mechanical patch, since a cap changes the response contract and should land consistently across all three siblings rather than as a drive-by limit on one caller. (AH-16; `docs/security-review/AH-21-admin-hours.md`.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Admin hours: no per-org self-approval override; a resync can grow an already-approved entry past its threshold without re-review** | ✅ Resolved (owner decision 2026-10-05: toggle + re-queue above a threshold)                                                                                                            | Both items closed. (1) `admin_hours.allow_self_approval` in the organization settings (off by default; writable only under `settings.manage`, not `admin_hours.manage`) lets a sole-officer department approve its own entries on the single and bulk paths; a self-approval still records `approved_by == user_id`. (2) A resync that grows an `APPROVED` attendance entry by more than `admin_hours.resync_requeue_growth_percent` (default **25**, 0–1000, per department) into a length its category would not auto-approve returns it to Pending Review. Both are shown and edited on the **Review Rules** tab at `/admin-hours/manage`. (`app/utils/admin_hours_settings.py`; `tests/test_admin_hours_review_settings.py`; `docs/security-review/AH-21-admin-hours.md`.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Storefront: no reconciliation backfill**                                                                                           | ✅ Resolved (2026-10-06, owner decision SF-backfill)                                                                                                                                    | Previously: if PayPal's verify-webhook-signature API was unreachable the webhook returned 401, PayPal eventually stopped retrying, and the capture was absent from the ledger with no way to re-ingest it. **Now:** the daily `paypal_capture_backfill` scheduled task (also runnable through `POST /scheduled/run-task`) lists each enabled PayPal integration's successful incoming transactions for the last 7 days through Transaction Search, skips ids already in `store_payment_events`, re-reads each remaining one from the Payments API capture endpoint, and records only a capture that endpoint reports COMPLETED — through the webhook's own `record_external_payment`, so matching and auto-apply are identical. Idempotent with the webhook on the (org, provider, capture id) unique key; a lost race now returns the winning row instead of erroring. **Operator requirement:** the department's PayPal REST app needs the Transaction Search permission; without it the task logs a clear error to that department's error monitor and records nothing. Captures that were refunded before the backfill saw them are not recorded (the webhook path records only completed captures either). (SF future-dev #1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Consent enforcement**                                                                                                              | ✅ Resolved (2026-08-05) for SMS; the other two types have no consumer                                                                                                                  | `ConsentService.has_consent` had **zero callers** — members could refuse `PHOTO_USE`, `PUBLIC_ROSTER_LISTING` and `SMS_NOTIFICATIONS` and be ignored. Enforcement was blocked on a backfill decision, since "never asked" counts as refused and wiring it in would have stopped SMS to every existing member. **Owner's rule removed the blocker:** messages always go to the member's email, so consent suppresses the text but never the notice. SMS is now consent-gated in both send paths (department-message escalation and the inventory low-stock alert) via a new bulk `granted_user_ids` helper, and email is unconditional — sent for every department message and no longer filtered by the `email_notifications` preference, which still governs the seven reminder/alert flows. **Still open:** `PHOTO_USE` and `PUBLIC_ROSTER_LISTING` have no consumer to gate — there is no public roster or public photo publishing in the app today. Whoever builds them must gate on `has_consent`; the requirement is recorded in the `consent_service` docstring. (AUTH-2)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Cohort: a few create fields are still API-only**                                                                                   | ⚠️ Narrowed (2026-10-06) — room booking resolved; minor fields open                                                                                                                     | **✅ Room booking (CC-2) is resolved:** the owner chose a per-cohort room with a per-class override. The cohort wizard sets the cohort's room on its Schedule step and lets each class be moved to another room on the Preview step; the syllabus builder sets a class's own room. The preview now takes the cohort room and the per-class overrides, validates every location id in-org, resolves each class's room with the same helper generation uses (`_class_location`: wizard pick, then syllabus row, then cohort) and runs the double-booking check on that room, so "Location already booked" fires before anything is created (`tests/test_cohort_location_picker.py`). **Still open:** `description`, `notes`, `requires_rsvp`, `auto_create_records` and `default_duration_minutes` on `CourseCohortCreate` remain API-only — the wizard sends the defaults. Low value; recorded so the next pass does not rediscover them. (CC-2)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Onboarding: role editor accepts client-supplied permissions/priority/system-flag**                                                 | Open (MED-LOW, product decision)                                                                                                                                                        | During setup, `save_session_roles` accepts client-supplied `permissions`, `priority`, and `is_custom` (which sets `is_system`), keyed on the client slug — so a session holder can mint a high-priority `is_system` role, rewrite an existing system role by slug, or emit near-arbitrary `{module}.*` permission strings. A literal top-level `*` is not injectable, and the post-completion guard (ONB-3) blocks abuse once setup is done, so the window is the still-in-progress setup only. Clamping priority, rejecting system-role re-mint, and allowlisting `module_id` would change what the legitimate onboarding role editor can express, so it needs a product decision. (ONB-7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Roles: the org-wide `member` role can be mass-escalated up to the caller's ceiling**                                               | ✅ Resolved (owner decision 2026-10-05: confirmation naming the member count)                                                                                                           | Editing the baseline `member` role's permissions is still allowed up to the caller's own grant ceiling — that is how a capability is rolled out org-wide — but Role Management now opens a confirmation before saving any permission change to it, naming the permissions granted or removed and how many members hold the position (from `GET /roles`' `user_count`). A rename or description edit does not ask. (`RoleManagementPage.tsx`; ORU-7c.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Scheduling: swap accept-path skips target re-validation + weaker approver check**                                                  | ✅ Resolved (confirmed by security review SCH-15 pass 2, 2026-08-28)                                                                                                                    | Duplicate of the "swap accept-path re-validation & self-approval; finalize manual_hours" row above; kept rather than deleted since this was the original app-review wording and other docs may still cross-reference it. See that row for the resolution mechanism. (SCH-5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Grants: no financial state machine or overspend guard**                                                                            | Open (MED, needs product decision)                                                                                                                                                      | No path checks total expenditures against `amount_awarded` / `amount_budgeted`, so `amount_remaining` can go negative, and `update_application` applies any status/amount change with no transition guard (a CLOSED/AWARDED grant stays fully editable). Closing it needs a product-defined grant state machine and an overspend policy (hard block vs warn). The duplicate-compliance-task half of this finding (an `awarded → active → awarded` round-trip regenerating a duplicate task set) is **resolved** — see GF-14: `_generate_compliance_tasks` now checks a dedicated `compliance_tasks_generated` boolean on `GrantApplication` before doing any work, re-confirmed intact by security-review GF-22 pass 2 (2026-08-30). (GF-7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Grants: `is_anonymous` donations still show donor identity to staff**                                                              | Open (LOW-MED, product decision)                                                                                                                                                        | `DonationResponse` / `DonorResponse` serialize `donor_name`/`donor_email`/`donor_id`/`amount` regardless of the `is_anonymous` flag, and the dashboard's recent-donations list returns donor-identified rows to any `fundraising.view` user. There is no public surface, so this is staff-only — but the anonymity flag currently has no effect. Decide whether an anonymous gift should hide donor identity from `fundraising.view` (vs `.manage`), then enforce it in the response serializers. (GF-8)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Grants: dashboard KPI status links don't match the multi-status aggregate the KPI counts**                                         | Open (LOW-MED, needs a filter-UI decision)                                                                                                                                              | `GrantService.get_dashboard_data()` counts "Active Grants" as `active` **and** `reporting` applications, and "Pending Applications" as five different statuses (`researching` through `under_review`) — but the KPI cards link to `/grants/applications?status=<one value>`, and `GrantApplicationsPage.tsx`'s status filter is a single-value exact match with no way to represent "two statuses at once." Clicking "Active Grants" therefore shows only `active` applications, silently excluding `reporting` ones the card's own number counted. Closing it needs a UI decision — a synthetic grouped filter option, or restyle the KPI cards as non-filtering summaries — not a drive-by fix. Found by Codex review, security-review PR #2070 (GF-22 pass 2, round 5); see `docs/security-review/GF-22-grants-fundraising.md` GF-27a. (GF-27a)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Grants: the applications page loads at most 1,000 applications, in either view**                                                   | Open (LOW-MED, feature gap — needs real pagination)                                                                                                                                     | `GrantApplicationsPage.tsx` (pipeline/kanban and table views) has no pagination control in either view — it's built to show the organization's complete application set at once, filtered or not. The fetch requests `limit: 1000` (the backend's own declared ceiling, `PaginationParams`'s `le=1000`), raised from the previous 100 (GF-33), but an organization with more than 1,000 applications overall, or more than 1,000 sharing one status when a status filter is applied, still silently truncates past that point — the newest 1,000 win, older ones are invisible with no indication anything was cut off. Closing it fully needs either real pagination (a page-size control, `skip`/`limit` wired to user paging) or a summary/streaming approach that doesn't load the full set into the browser at once. Found by Codex review, security-review PR #2073 (GF-22 pass 2, round 6); see `docs/security-review/GF-22-grants-fundraising.md` GF-33. (GF-33)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Medical supplies: expiring-lot list has no row cap**                                                                               | Open (LOW, needs a product decision — shared across callers)                                                                                                                            | `InventoryService.get_expiring_lots` (backs `GET /medical-supplies/lots/expiring`, the equivalent gear-side route, and the low-stock/expiring alert email) has no `limit`/pagination — a department that never clears old zero-or-positive-quantity expired lots gets every matching row back to the start of the `days_ahead` window, unbounded. Not a mechanical medical-supplies patch: the method is shared with the main inventory router and `scheduled_tasks.py`'s alert email, so a cap changes those callers' contracts too (would the alert silently omit rows past the cap?) — needs a decision on page size per caller, not a drive-by limit. Found by Codex review, security-review PR #2075 (MSUP-23 pass 2); see `docs/security-review/MSUP-23-medical-supplies.md` MSUP-4. (MSUP-4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Medical/gear supplies: a single item's stock-lot list has no row cap**                                                             | Open (LOW, needs a product decision — same shape as MSUP-4)                                                                                                                             | `InventoryService.list_lots` (backs `GET /medical-supplies/items/{id}/lots` and the equivalent gear-side route) returns every lot ever recorded against one item with no `limit`/pagination, and neither frontend screen pages through the result — both treat it as the item's complete lot history. An item restocked frequently over years without its depleted lots ever being deleted accumulates an unbounded row count. Not a mechanical patch: a cap changes what "the item's lots" means to both callers, with no pagination UI on either screen to receive a later page — needs the same kind of per-caller page-size decision MSUP-4 needed, not a drive-by limit. Found by Codex review, security-review PR #2301 (MSUP-23 pass 3); see `docs/security-review/MSUP-23-medical-supplies.md` MSUP-11 (this row was mislabeled MSUP-10 until security review pass 11, 2026-09-11 — MSUP-10 is a different, already-fixed finding in that same pass, the `add_lot` opening-balance race). (MSUP-11)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Medical/gear supplies: the general item edit form has no lot-stocked awareness**                                                   | Open (LOW-MED, needs a product/UX decision)                                                                                                                                             | `modules/inventory/components/ItemFormModal.tsx`'s "Quantity" input always reads from and writes to `InventoryItem.quantity` directly, with no indication that for a lot-stocked item that column is a best-effort mirror, not the authoritative on-hand count (the sum of the item's in-date stock lots). An admin who opens this form for a lot-stocked item, sees the stale mirror value, and "corrects" it to match the detail page's lot-derived number writes into a column no lot backs, until the next delivery's carry-forward silently overwrites it again. No data corruption occurs today from this alone — nothing treats the edited mirror value as authoritative over the lots — so it is not gated as a security finding, but it is a live trap for exactly the workflow this module exists to support. `modules/medical-supplies/components/MedicalItemFormModal.tsx` (the medical-domain-specific form `MedicalSuppliesPage.tsx` actually uses) already has this awareness — it hides the Quantity input behind a read-only "N from stock lots" note for a lot-stocked item and omits `quantity` from the update payload entirely — so this is reachable today only through the general Inventory page's edit flow on a medical item (a broad `inventory.manage` holder can reach any item's detail page and its edit modal, by design), not through the medical supplies module's own screens. Closing it needs a decision — hide/disable/relabel the field for a lot-stocked item, or route an edit through a lot adjustment instead of the raw column — which is a UX/product call, not a mechanical patch. Found by Codex review, security-review PR #2301 (MSUP-23 pass 4); see `docs/security-review/MSUP-23-medical-supplies.md` MSUP-15. (MSUP-15) |
| **Reports: date-range filters use UTC, not the organization's local timezone**                                                       | Open (LOW-MED, cross-cutting; needs a reporting-context timezone default)                                                                                                               | A report end date of "June 15" is interpreted as June 15 in UTC, not June 15 in the department's own timezone — for a non-UTC organization, a report can still include some of the following day's early records or exclude some of the selected day's late-evening records, depending on the org's UTC offset. Not a regression and not module-specific: `reports_service.py` alone has the identical hard-coded-UTC `datetime.combine(..., tzinfo=timezone.utc)` boundary at 5 separate call sites, and `grant_service.py`/`fundraising_service.py` matched that same established pattern when fixing a strictly worse bug (GF-24 — the boundary previously excluded the entire end date, in every timezone) rather than inventing a one-off fix. `app/utils/org_timezone.py`'s `resolve_scheduling_timezone` is not a drop-in general-purpose answer — its own docstring ties its `America/New_York` fallback specifically to scheduling's historical behavior ("changing it would move existing departments' shift times"), so a reporting-context default needs its own decision, not a borrowed assumption. Closing this needs a coordinated fix across every report date-range filter in the app, not a per-module patch. Found by Codex review on security-review PR #2069, round 2; see `docs/security-review/GF-22-grants-fundraising.md` GF-24a. (GF-24a)                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Inventory: storage-area barcodes are assigned but the scanner cannot resolve them**                                                | Open (LOW-MED, feature gap; UI copy currently overpromises)                                                                                                                             | Since 2026-08-16 every storage area is assigned a sequential `SA-…` barcode, and the Storage Areas form tells the user it is assigned "so it can be scanned". Nothing resolves it: `/inventory/lookup` → `InventoryService.search_by_code` queries `InventoryItem.barcode` / `serial_number` / `asset_tag` / `name` / `size` / `color` only, and the sole query against `StorageArea.barcode` is the allocator's uniqueness check (`_storage_area_barcode_exists`). Scanning a shelf label in `InventoryScanModal` therefore returns nothing. Two ways to close it: extend the scan lookup (and `ScanLookupListResponse`) to return storage-area hits and navigate to the area, or reword the form to say the code is for printed labels only. Until one lands, the UI promises a capability the app does not have. Found by review on PR #1508 while documenting the feature. (INV-8)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Client IP recorded as the proxy address**                                                                                          | ✅ Resolved (2026-08-05); historical rows documented, accepted by the owner (2026-10-05)                                                                                                | `request.client.host` was used instead of `get_client_ip(request)` in 39 places across 8 files, so behind the production nginx every record stored one identical internal IP. Worst case was **elections**: per-vote IPs drive the fraud detection documented in `BALLOT_FORENSICS_GUIDE.md`, so `unique_ip_count` collapsed to 1 and every election permanently tripped the `suspicious_ips` threshold. The sweep also caught a live **availability** bug the survey had missed: `public_portal_security.py` keyed the public-portal _rate limiter_ on the peer IP, so all anonymous visitors shared one bucket and a single caller could lock out everyone (the H5 shape, still live on the public surface). Verified behavior-neutral: identical test results before and after. **Accepted by the owner (2026-10-05):** rows already written still hold proxy IPs and are indistinguishable from real ones; they are left as they are, because rewriting hash-chained audit history would break `verify_integrity`. The cutover date is documented in `BALLOT_FORENSICS_GUIDE.md` (Step 3, "IP cutover — 2026-08-05") so a reviewer dates the evidence instead. (AXC-1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

## Error Monitoring Coverage (2026-08-07)

What does _not_ reach the Error Monitoring page after the reporting sweep. Each
is an accepted gap with the same root cause: an `error_logs` row is org-scoped
and `organization_id` is NOT NULL, so a failure that cannot be attributed to an
organization has nowhere to go.

| Item                                                               | Status                               | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Failures before sign-in do not reach the error-monitoring page** | ⚠️ Open                              | `POST /errors/log` requires an authenticated session because each row is organization-scoped. Pre-authentication reports are discarded, and queued reports are cleared on login, logout, or session expiry so error content can never be delivered under a different user's cookies on a shared browser. Closing this limitation safely needs an anonymous ingestion path with its own organization resolution and abuse protection (the endpoint would be unauthenticated and world-writable).                                       |
| **The onboarding client is not instrumented**                      | Accepted (follows from the above)    | `modules/onboarding/services/api-client.ts` calls `fetch` directly rather than an axios instance, so it does not pass through the interceptor that reports API failures. Onboarding traffic is mostly pre-session. If it is ever instrumented, route it through `reportApiError` rather than adding a second transport.                                                                                                                                                                                                               |
| **Reports can still be discarded under sustained failure**         | Accepted (bounded, and never silent) | The client caps reports at 20/minute and holds at most 50 undelivered, and abandons a report after 4 delivery attempts. Anything discarded by the two caps is counted and reported as a `REPORTING_THROTTLED` row, so a burst reads as "20 reports plus 340 suppressed" rather than a quiet minute — but the discarded reports themselves are gone, and a report abandoned after 4 failed attempts is not counted anywhere. Raising the caps trades table growth for fidelity; the current values assume a browser tab, not a server. |
| **A 5xx produces two rows**                                        | Accepted (intentional)               | The backend logs `BACKEND_HTTP_5xx` with the traceback and endpoint; the client logs `API_SERVER_ERROR` with the member and the page they were on. Neither is redundant — the backend row is missing when the failure never reached the app (gateway 502) and the client row is missing for a failure outside a request the user made. They are distinguished by the Source column.                                                                                                                                                   |

## Frontend Routes & Navigation (2026-08-07)

Nothing in the codebase connects a `to=` string to a `path=` string, and
`App.tsx`'s catch-all turns an unmatched target into a silent redirect to the
dashboard — so a dead link produces no error anywhere and reads as a button that
does nothing. `frontend/src/routeIntegrity.test.ts` now walks the source and
checks every literal navigation target against the declared routes, reporting
file, line and target. Known gaps are listed in its `KNOWN_MISSING_ROUTES`
allowance, and a companion test fails if either route ever appears, so the
allowance cannot outlive the gap.

| Item                                                                  | Status                              | Detail                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Grants: "Record Donation" points at a screen that was never built** | Open (MED — feature gap, not a bug) | The donors page links to a create-donation route with no matching page. The API client and store already expose the create call, so the gap is the screen alone. `docs/training/12-grants-fundraising.md` documents the flow and carries a screenshot placeholder for it; both stay until the page exists. |
| **Grants: "Add Opportunity" points at a screen that was never built** | Open (MED — feature gap, not a bug) | Same shape as above, from the opportunities page. Documented in the grants training guide.                                                                                                                                                                                                                 |

## Member Lifecycle — The Page That Was Documented but Never Built (2026-08-08)

`docs/training/01-membership.md` described a **Member Lifecycle Management** page
under Members Admin with four tabs — Archived Members, Overdue Returns, Leave of
Absence, Tier Configuration. **No such page exists**, and it appears never to
have. The guide has been corrected.

**Owner decision (2026-10-05): distribute the operations onto existing screens**
rather than build the consolidated page — leave editing beside leave creation,
overdue returns on member and inventory screens. Reactivation and tier
configuration had already gone this way.

| Capability                | Where it lives now                                                                                                                                                                      | State                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Create a leave of absence | Waiver Management (`/members/admin/waivers`)                                                                                                                                            | ✅                     |
| Edit a leave              | Waiver Management → Active Waivers → **Edit** (`EditLeaveDialog`, `PATCH /users/leaves-of-absence/{id}`)                                                                                | ✅ Resolved 2026-10-05 |
| Overdue property returns  | `OverduePropertyReturnsPanel` on Inventory → Member Equipment and Members Admin → Member Management (`members.manage`): the list, a profile link per member, and **Send due reminders** | ✅ Resolved 2026-10-05 |
| Archived members          | Members → **Archived** filter → **Reactivate**, or the member's profile                                                                                                                 | ✅ (2026-09-24)        |
| Tier configuration        | Members Admin → Settings → Membership Tiers; the monthly task advances members                                                                                                          | ✅                     |

| Item                                                                 | Status                             | Detail                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Leave of absence is created from Waiver Management**               | Accepted by the owner (2026-10-05) | The owner chose to keep leave work where leaves are already created rather than move it to a lifecycle page, and editing now sits beside creation there. It is still not where a membership coordinator might first look; the membership guide points to it. |
| **`POST /users/advance-membership-tiers` has no button**             | Open (LOW)                         | The scheduled task `membership_tier_advance` runs it on the first of each month when the department's auto-advance switch is on; an on-demand run is API only. Not part of the 2026-10-05 decision.                                                          |
| **`GET /users/{id}/property-return-report` (preview) has no screen** | Open (LOW)                         | The preview of what a member would have to return, before a drop, is still API only; the drop itself generates the full report into Documents. Not part of the 2026-10-05 decision.                                                                          |

The overdue list's response shape was also corrected on the frontend:
`OverdueMember` had described fields the endpoint never sent (`drop_date`,
`item_name`, `due_date`), which nothing noticed while nothing read it.

## Medical Screening — No Per-Member Compliance Screen (2026-08-08)

**The Add Record half of this entry is resolved (2026-10-05, owner decision,
MS-13).** It was filed as "The Add Record Form Attaches to Nobody": the dialog
had no member or prospect control, so every record it created counted toward
nobody's compliance. The dialog now has a member/prospect picker fed by
`GET /medical-screening/subjects`, and `POST /medical-screening/records`
rejects a record naming neither or both (422). See
`docs/security-review/MS-09-medical-screening.md`, "Owner decisions".

**Residual: records created before the fix stay unattached.** Nothing can say
who they were about, and the edit dialog cannot set a subject (the update
schema accepts neither id, deliberately). They show as **Not linked to a
member or prospect** on the Records tab; re-enter them through Add Record and
delete the unattached copy.

`docs/training/13-medical-screening.md` pictures two per-member compliance
screens that do not exist:

| Guide section                      | What exists                                                                                                                                                                    | State                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------- |
| Member compliance detail view      | `fetchUserCompliance` / `fetchProspectCompliance` are defined in `medicalScreeningStore` and called by **no component**. `ComplianceDashboard` lists expiring screenings only. | ❌ Store action only |
| Compliance tab filtered to overdue | `ComplianceDashboard` has no filter controls of any kind.                                                                                                                      | ❌ Not built         |

## Grants & Fundraising — Pledges and Fundraising Events (2026-08-08)

Same shape, found while capturing `docs/training/12-grants-fundraising.md`.

- **Pledges.** `fundraisingService.listPledges` / `createPledge` /
  `updatePledge` exist over a working API. The only consumer is a
  `grantsStore` action that no component calls. The grants dashboard's
  "Outstanding Pledges" KPI card linked to `/grants/pledges`, which has no
  route — and because the router's catch-all redirects unknown paths to `/`,
  clicking it bounced the user to the home dashboard with no error. The link
  has been removed (the figure is real, the destination was not); restore it
  when the page ships.
- **Fundraising events.** `listFundraisingEvents` / `createFundraisingEvent` /
  `updateFundraisingEvent`: zero consumers, no route, no page.
- **Recording a donation.** `DonationsPage`'s primary action, "Record
  Donation", linked to `/grants/donations/new` — also routeless, also
  redirected to `/`. No component calls `createDonation` either, so the form
  behind it was never built. The button has been removed; donations reach the
  system through the API (which is how the demo seeder loads them) and through
  no screen. This is the more serious of the two dead links: the pledges one was
  a KPI tile, this was the page's only call to action.

**Navigation (resolved 2026-10-05, owner decision).** The module had no
navigation entry: its pages were reachable only by typing the URL. Both
navigations now list Grants & Fundraising and its seven pages
(`components/layout/grantsNavigation.ts`), behind the module switch and
`fundraising.view`, the routes' own gate.

Verified 2026-08-08 by counting non-test call sites under `frontend/src` for
each service method and each store action, and by searching both navigation
components for the module's route.

## Finance — Five Guide Sections With No Screen (2026-08-09)

Found while capturing `docs/training/11-finance.md`. Five of that guide's nine
placeholders picture screens the frontend does not render; their placeholders
are left open. Four defects found alongside them were fixed — see the commit
that added the purchase request, expense report and check request shots.

| Guide section             | What exists                                                                                                                              | State                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Create Budget form        | `financeStore.createBudget` over a working API, **no component calls it**. `BudgetsPage` is read-only — it has no create control at all. | ❌ Store action only |
| Create Dues Schedule form | `financeStore.createDuesSchedule`, **no component calls it**.                                                                            | ❌ Store action only |
| QuickBooks export mapping | `GET/POST/PUT /finance/export/mappings` and the `qbAccountName` types exist; no page, no route, no consumer.                             | ❌ API + types only  |
| Export logs               | `GET /finance/export/logs` and an `ExportLog` interface; no page, no route, no consumer.                                                 | ❌ API + types only  |

**Budget detail's transaction history is a stub, not an empty state.**
`BudgetDetailPage` renders `<EmptyState title="No transactions yet">`
unconditionally — there is no fetch behind it and no code path that ever
displays a transaction. The guide's placeholder asks for "a table of linked
transactions below" the progress bar. The stacked progress bar is real and
correct; the table does not exist. This is why that screenshot has been held
back through several rounds of seeding: purchase requests, expense reports and
check requests were all charged against the budgets and the panel still said
"No transactions yet", because nothing could have changed it.

Verified 2026-08-09 by counting non-test call sites for each store action and
service method, and by reading the render bodies.

## Finance — Nobody Could Approve Anything (2026-08-12, narrowed 2026-09-06)

`finance.approve` and `finance.configure_approvals` gate nine endpoints — the
approval queue (`GET /finance/approvals/pending`,
`POST /finance/approvals/{id}/approve`, `.../deny`) and the whole
approval-chain settings screen — and until 2026-09-06 **no seeded position held
either**. The only account that could reach them was one holding the `*`
wildcard, i.e. the IT administrator.

That produced two states, and the second is the one that stranded records:

- With no chain configured (or a chain with no steps), `submit_purchase_request`
  and its expense-report and check-request siblings put the request in
  `pending_approval` with **no approval steps**, and no endpoint could move it.
  _(2026-09-30: a `finance.approve` holder other than the requester can now
  approve or deny such a request from its detail page —
  `POST /finance/approvals/manual/{entity_type}/{entity_id}/approve` / `deny`.)_
- Configure a chain — which required the same unreachable settings screen — and
  every submitted request landed in `pending_approval` with nobody able to
  action it.

**Resolved for the Treasurer.** `treasurer` now carries both grants in
`DEFAULT_POSITIONS`, and `20260906_2141_ee7390dcdf47` carries them to
departments that already onboarded (gated on the row still holding exactly the
finance grants the registry seeded, per CLAUDE.md pitfall #23).

| Position   | Finance permissions                                                                |
| ---------- | ---------------------------------------------------------------------------------- |
| Treasurer  | `finance.view`, `finance.manage`, `finance.approve`, `finance.configure_approvals` |
| IT Manager | `*`                                                                                |

**What remains, and it is a configuration matter rather than a defect.**
`assert_different_person` (SEC FIN-4) refuses self-approval whoever holds the
permission, so a department whose _only_ approver is the Treasurer still cannot
clear a request the Treasurer raised. A chain that must survive that needs a
second approver step — a `POSITION` or `SPECIFIC_USER` step naming somebody
else, which the settings screen can now actually create. Widening
`finance.approve` to further seeded positions is still an authorisation
decision, and is still deliberately not made from a documentation pass.

Found 2026-08-12 while trying to seed a budget with charges for
`11-05-budget-detail`. The budget-detail consequence recorded above — spend and
encumbrance accruing on approval, so the progress bar was permanently stuck at
0% — is unblocked by this; the transaction-table stub in the section above is
not, and remains unwired.

## Two Migrations Claimed 20260808_0002 — and What It Left Behind (2026-08-09)

Two pull requests merged migrations numbered `20260808_0002`: "drop the
shift_equipment_checks apparatus FK" and "add owns_requirement to
program_requirements". Each was green against the main it branched from — the
collision only existed once both had landed — so nothing caught it until a
clean checkout of main failed three migration-chain tests. Resolved by
renumbering the first to `20260808_0003`; `0002` kept its number because live
databases had already applied it.

**A database can be recorded as having run a migration it never saw.** The same
pair collided at `20260808_0001` a day earlier ("drop the apparatus FK" before
its first renumber, and "add officer validation trail to skills tests"). Any
database that applied the former has `20260808_0001` in `alembic_version` and
will never run the latter — so `skill_tests.validated_at` is missing while
Alembic reports the chain as up to date. It surfaces as a query error, not a
migration error:

    (1054, "Unknown column 'skill_tests.validated_at' in 'SELECT'")

Repair, for a database in that state — run the skipped revision on its own,
then re-mark the chain:

```bash
cd backend
python -m alembic stamp 20260807_0009      # back to the shared parent
python -m alembic upgrade 20260808_0001    # idempotent: adds only what is missing
python -m alembic stamp head               # 0002/0003 were already applied
```

`upgrade head` is **not** the shortcut here: `20260808_0002` uses a bare
`add_column` and fails on a database that already has the column.

**Why the failure is quiet.** `main.py`'s startup fallback resolves a forked
head by renaming one migration file to `.stale`. Startup then logs "Migrations
completed successfully" while one migration has silently been taken out of the
chain. That fallback buys a working dev environment at the cost of hiding the
fork — worth knowing before trusting a green startup log.

**The general rule.** A revision id is a shared namespace across every open
branch, and a date-stamped sequence collides the moment two people work on the
same day. Before merging a migration, re-check `revision` against the current
main rather than against your merge-base.

## Integrations — No Calendar-Feed Configuration Screen (2026-08-09)

`docs/training/16-integrations.md` pictures an **iCalendar configuration**
listing "generated feed URLs for different filters (All Events, Training Only,
My Shifts) with copy buttons", and again later as "three generated feed URLs
with Copy buttons".

What exists is one feed and one place to get it: `CalendarSubscribeCard` on the
My Shifts tab, which reveals a single personal shifts URL. The `ical` entry in
the integrations catalogue is a card with a description and no configuration
screen behind it — searching `frontend/src` for a feed URL turns up only that
one card. The backend serves exactly one feed route,
`/api/public/v1/calendar/{token}.ics`, scoped to the member's own shifts.

So the filtered feeds the guide describes — all events, training only — do not
exist on either side. Both placeholders are left open. The guide-03 subscribe
card is also deliberately not captured because expanding it exposes the
calendar feed's bearer credential.

Most of the rest of guide 16 needs a live third-party account (a Salesforce
sync status, a connected Cal.com bookings panel, a warning state carrying a
real provider error) and is not capturable from a demo database at all. The
connect _dialogs_ are ordinary forms and have been captured.

## Admin — No Scheduled Tasks Page (2026-08-09)

`docs/training/08-admin-reports.md` told administrators to "Navigate to
**Administration > Scheduled Tasks** to view and manage automated tasks", and
listed the columns they would find there: last run, next run, frequency, and an
enabled toggle.

There is no such page. Searching `frontend/src` for "scheduled task" in any
casing returns nothing. What exists is `app/api/v1/endpoints/scheduled.py`:
`GET /scheduled/tasks` lists each task with its recommended cron schedule, and
`POST /scheduled/run-task` triggers one — the latter restricted to a platform
System Owner (`system.run_tasks`) because each task iterates every
organization.

The gap is wider than a missing screen. The API reports the _schedule_ only;
last-run and next-run times and a per-task enabled flag are not persisted
anywhere, so the page the guide describes needs backend work before it needs a
frontend. The placeholder is left open and the prose now says where the tasks
actually live.

## Events & Elections — Four Guide Sections With No Screen (2026-08-10)

`docs/training/04-events-meetings.md` describes four features that have no
frontend. Each is written in the present tense ("The election detail page now
shows…"), so nothing in the guide signals they are aspirational.

- **Attendance Dashboard.** A table of members with attendance percentage,
  meetings on leave, and voting eligibility. The calculation is real and
  `GET /meetings/attendance/dashboard` serves the data — `meetingsServices.ts`
  even has a `getAttendanceDashboard` client method for it — but nothing in
  `frontend/src` calls that method. The endpoint has no consumer.
- **Send Report Email.** A button on the election detail page to mail
  round-by-round results. The string appears nowhere in the frontend.
- **Upcoming Business Meetings.** A section on the election detail page listing
  meetings the election can be linked to, with **Link to Election** buttons.
  Described three separate times in the guide; neither string exists.

The election↔meeting link those last two describe _is_ real: an election
carries `meeting_id` and `event_id`, and an event shows a **Linked Elections**
card. What is missing is only the election-side UI for setting it — it is set
at creation or through the API.

Related bug found while confirming this, fixed 2026-08-10: `event_id` could
not be set through `PATCH /elections/{id}` at all.

## Audit Log — The Search Box Needs Apply, The Dropdowns Do Not (2026-08-10)

Two filters on the same bar behave differently. The severity and category
selects write straight to the query state and refetch on change; the search
input holds a separate draft that only reaches the query when **Apply** is
pressed. Typing a term and reading the table gives the unfiltered list under a
filled-in search box, with no cue that the term has not been applied.

Not changed — an unconditionally live search on a table this size is a fetch
per keystroke, and the Apply button is a deliberate answer to that. Recorded
because it reads as a bug from the outside, and because it caught this repo's
own screenshot: the first capture of the shift-report filter showed
"shift_report" in the box above 1,865 unfiltered rows. Worth revisiting as a
debounce, or as disabling Apply until the draft differs.

## Prospects — `referral_source` Is Stored But Never Shown (2026-08-10)

A guest sign-in stamps the prospect's `referral_source` with
`"Attended: <event name>"`, and the detail endpoint returns it. No screen
displays it: the applicant detail drawer renders contact details, membership
type, current stage, linked events, progress and stage history, and the
`referral_source` entry in its `FORM_FIELD_LABELS` map applies to _form
submission_ answers, not to the prospect's own column. The list endpoint omits
the field entirely.

The provenance is not lost — the drawer's Linked Events panel names the event
the guest walked in from, which is the same fact by a different route — so this
is recorded rather than fixed. The training guide claimed the drawer showed the
referral source; corrected 2026-08-10 to point at Linked Events, and to say the
stamped text is reachable only through an export or the API.

**Re-verified 2026-09-24, and it is three fields, not one.** The mapper sweep
confirms this still holds and that `interest_reason` and `referred_by` are in
the same position: all three are columns on `prospective_members`, all three are
returned by `ProspectResponse`, and none is declared on the frontend `Applicant`
type or read by any mapper. Unlike the seven fields recorded below, nothing on
the frontend reads these, so they are unused data rather than a blank screen.

## Events — The Event Form Prefers Free Text Over A Linked Location (2026-08-10)

`EventForm` decides its location mode with `initialData?.location ? 'other' :
'select'`, so an event carrying both a `location_id` and a free-text `location`
opens in "Other (off-site / enter manually)" — and saving from there clears the
`location_id`, since the "other" branch sends it as `undefined`.

The app's own flow never produces that combination: picking a location sets the
id and blanks the string. Only an API client that sets both walks into it,
which is how the demo seeder found it. Left as-is rather than reordering the
precedence, since a saved free-text location is a real signal for genuinely
off-site events; the seeder now sets `location_id` alone, matching what the
form itself writes.

## Equipment Checks — A Checklist Only Reaches Its Own Apparatus Type (2026-08-10, narrowed 2026-10-04)

**Accepted.** `_resolve_templates` matches a template to a shift by
`apparatus_id` or by `apparatus_type`, and by nothing else. There is no "applies
to every apparatus" form, so a department that writes one engine checklist has
_no_ checklist on its ladder, brush and rescue shifts. That is a modelling
decision rather than a bug: a department may well want per-type lists.

The reporting gap it caused is closed: the close-out checklist now says "No
end-of-shift equipment checklist applies to this shift" instead of leaving the
equipment row out, and the compliance report marks an apparatus "No checklist
applies" (`has_checklist`) rather than showing zero checks that read like
missed ones.

## Screenshot Harness — Camera Viewfinders Cannot Be Photographed (2026-08-12)

Three placeholders asked for a live camera viewfinder with a code being read:
`MemberIdScannerModal` on a desktop browser (`docs/training/03-scheduling.md`),
the inventory scan modal mid-batch and `InventoryScanModal` detecting a barcode
(both `docs/training/05-inventory.md`).

The capture harness runs headless Chromium with no camera device. Chromium's
fake-device flags can supply a synthetic stream, but it is a rolling test
pattern, not a scannable code — and each of these shots is specifically of a
code _being recognised_, which a fake stream cannot produce. Nothing short of a
real camera in front of a real label satisfies them, so all three are retired
rather than left open to be re-surveyed each pass.

The scanning features themselves work; this is a limitation of the automation,
not of the product. If these screens ever have to be documented visually, the
images will have to be taken by hand.

## Inventory — Scanning Has No Screen Of Its Own (2026-08-10)

`inventoryService.lookupByCode` (`GET /inventory/lookup`) has exactly one
consumer: `InventoryScanModal`, which is opened with `mode="checkout"` or
`mode="return"` already decided and a member already chosen. There is no
"scan an item, then pick what to do with it" screen anywhere — no Scan button
on `/inventory`, no route, no component. `docs/training/05-inventory.md`
described one, including quick-action buttons (Check Out, Return, View
Details) that exist nowhere; the section now documents the real flow.

Two smaller mismatches in the same guide, corrected rather than recorded:
there is no **Batch Checkout** or **Batch Return** entry in the admin menu
(both start from a member's row on **Members Equipment**), and the item-detail
assign path takes a member and nothing else — the "assignment date, condition
selector, notes field" the guide listed are not on it.

The scan placeholder is left open for a second reason as well: the capture
harness runs headless with no camera, so the viewfinder cannot be photographed
by the automation even once a screen exists to photograph.

## Skills Testing — A Criterion Type The Scorer Could Not Read (2026-08-10)

The criterion `type` was a free string up to 50 characters. The scorer and the
examiner screen each recognise exactly five values; anything else fell through
to a fallback branch that rendered plausibly and carried no points. The demo
seeder had been writing `"checkbox"` for months. Nothing complained: templates
saved, tests ran, steps were marked — and every scorecard reported
"No percentage could be calculated" with all three sections marked as not
counting, on a sheet that looked fully scored.

Fixed by validating `type` against the known set on the way in, with an error
that names the accepted values. Two things this does **not** cover:

- **Rows already stored** are unaffected — validation runs on input only. The
  seeder repairs its own (`_repair_criterion_types`); a real deployment that
  authored criteria through the API rather than the builder would need a
  migration, and none is written because the builder has only ever offered the
  five.
- **A template of pure pass/fail steps still has no point pool**, and that is
  deliberate — turning `score_pass_fail_criteria` on by default would change
  the meaning of every percentage already on record. Such a sheet scores by
  section average and says so.

## Scheduling — The Hold-Over Roster Needs Platoons (2026-08-11)

`docs/training/03-scheduling.md` described the hold-over roster as appearing
"when a shift has a gap (member on leave or open position)". The panel is
gated on `platoonsEnabled && shift.platoon && platoonRoster.length > 0` — it is
the _platoon_ roster, and a department that does not run platoons never sees it
however short a shift is. The guide now says so, and points at the crew board's
own Assign controls as the way to fill a gap otherwise.

The screenshot is held back rather than fabricated: picturing it needs platoons
enabled and shifts generated from a platoon pattern, neither of which the demo
department runs, and switching platoons on would put a platoon badge across
every calendar card in the guide's other scheduling screenshots.

## Screenshot Seeding — The Member's Own Checklists (2026-08-11)

Deferred. My Equipment Checklists is scoped to the signed-in member's own
shifts, and the checks the seeder files as the administrator do not appear on
it, so every row reads "Not Started". The page documented as showing a finished
check beside a resumable one can picture neither, and the Resume control and its
progress bar cannot be photographed.

A step to file them as the member was written and removed after two attempts: it
ran clean and filed nothing, and a seeder step that silently does nothing is
worse than no step. It uncovered a 403 on the equipment-check template reads
(fixed 2026-08-11), which was the more valuable half. Worth another attempt with
a fresh idea about which of the member's shifts carry an unclaimed checklist —
the first pass drove it from `/scheduling/my-shifts`, whose result did not line
up with what the page lists.

The same scoping blocks the **incomplete-check warning** ("Submit an incomplete
check? — _N_ of _M_ items have not been checked"), which is raised from the
check form before anything is written and would otherwise be a
straightforward capture. Two attempts to reach the form failed: the checklist
rows are empty for the administrator the harness signs in as, and driving it
through **Start a Check** did not get as far as the template picker either.
Reaching it needs the seeding above, or a member session whose own shift carries
an unstarted checklist.

## Screenshot Seeding — Apparatus Inventory Was Empty For Every Truck (2026-08-11, resolved)

Resolved the same day by `seed_supply_tracking`, which stocks **M-3** with a
catalog of dated consumables, a checklist bound to that apparatus by id, and
deployed-lot rows saying what is aboard. Recorded here because the diagnosis
still applies to any department whose inventory page is bare:

`GET /equipment-checks/apparatus/{id}/inventory` joins template compartments to
an apparatus by `EquipmentCheckTemplate.apparatus_id`. A checklist bound by
`apparatus_type` — what a template that applies to every engine looks like —
supplies checklists for shifts but stocks no particular truck, and a rig with
only type-bound templates shows an empty inventory. That is documented in
`03-scheduling.md` as a callout rather than left for the reader to discover.

Two things the seeding turned up, both now fixed:

- A position nobody has counted reports its **target** as the units aboard — a
  NULL count means "not counted since this was defined", not "empty" — and the
  first swap materializes that assumption as a real undated lot row before
  adding the swapped units on top. A seeder that fills a fresh position without
  counting it to zero first leaves the truck holding roughly double its par
  behind a phantom lot with no number and no date.
- The lot number a position reported came from `CheckTemplateItem.lot_number`,
  the scalar left over from the last swap, while the date beside it came from
  the soonest-expiring deployed lot. On a position carrying several lots those
  are different lots, and the pair reads as one false fact about a specific lot.
  Both now come from the same row (`_soonest_lot_number`).

An id-bound template also attaches to that apparatus's **shifts**, because
`_resolve_templates` matches by `apparatus_id` **or** `apparatus_type`. M-3
carries no seeded shift checklists, so nothing already published moved; a future
template bound to a rig that does needs the neighbouring equipment-check shots
re-captured and diffed before applying.

## Email Templates — A Chosen Footer Is Silently Ignored By Most Bodies (2026-08-11)

Open decision, and user-visible.

The footer library gives every template a **Closes with** selector, and the
Footers tab reports "N templates close with this footer". But the closing block
reaches the message as the `{{footer_html}}` variable, and there is no fallback
that appends it: a body without that variable renders **no footer at all**, no
matter what the selector says. Nothing on the screen distinguishes the two —
choosing a footer, saving and sending looks identical either way.

Most shipped bodies do include the variable. Two populations do not:

- **A department that customised a template body** before this release, or since.
- **Any database seeded before the footers release.** Re-seeding never touches a
  template that already exists by name, which is the same drift that left
  `check_type: "presence"` rows behind (see `_repair_seeded_check_types` in
  `scripts/screenshots/seed_demo_data.py`). In the screenshot demo database
  **31 of 35 templates** carry no `{{footer_html}}`, so the Footers tab's count
  of 35 is a count of templates _pointing at_ the footer, not of templates that
  will print it.

The count is not wrong for what it measures — a template really does resolve to
that footer — but read beside a selector that appears to take effect, it
overstates what will happen.

Three options, none obviously right, which is why this is recorded rather than
fixed:

1. **Append the footer when the body omits the variable.** Makes the selector
   always mean something, and changes the output of every customised template
   that deliberately closes its own way.
2. **A repair pass over legacy bodies**, as `check_type` got. Fixes the upgrade
   population without touching deliberate customisation, but has to guess where
   in the body the variable belongs.
3. **Say so in the UI** — mark a template whose body omits `{{footer_html}}`,
   and grey its selector. Smallest change, and leaves the work with the
   administrator.

`backend/tests/test_email_footer_rendering.py` pins the current contract in
either direction, so whichever option is chosen has something deliberate to
change rather than a silent behavioural shift.

## External Training — The Mapping List Needs a Live Provider (2026-08-11)

Held back. `02-training.md` asked for the Vector Solutions category mapping
list. Category mappings are **discovered by a sync against the provider's API**
— the endpoints expose only GET and PATCH, so there is no supported way to bring
a mapping into being without a real Vector Solutions account answering the sync.

Seeding one would mean writing rows straight into the database and presenting
invented external category names as a real integration's output, which is a
worse outcome than no screenshot. The section now describes the list instead,
which is accurate as far as it goes.

The visit was not wasted: an unmapped category showed a **Map Category** button
with no handler behind it. It is a category dropdown now, wired to the PATCH
endpoint that had been there all along, and covered by
`ExternalTrainingPage.test.tsx`.

## Equipment Checks — Two Legacy Columns Still Written, No Longer Authoritative (2026-08-10)

`check_template_items.lot_number` and `.expiration_date` predate
`check_item_deployed_lots`. Since 2026-08-10 a position's expiration is the
**earliest date across its deployed lots** and its count is their **sum**, and
every reader — the supply worklist, the apparatus view, the check form, the
item-to-apparatus lookup — uses those derivations. The two columns are still
written on the single-lot paths and still carry the legacy value the data
migration was seeded from.

**Accepted for now.** Dropping them means auditing every write path in one
change, and they are harmless while nothing reads them for a decision. The risk
is the obvious one: a future reader that reaches for
`item.expiration_date` because it is right there will get whichever lot was
restocked last, which is exactly the bug the table was added to remove. If you
are adding a reader, take the derived value.

## Frontend — ESLint And `tsc` Run Different TypeScript Versions (2026-08-10)

**Superseded in part (2026-09-10)** — `typescript-eslint` has since moved to
`^8.69.0` (still `<6.1.0`-capped, same constraint) and, contrary to what
this entry says below, an explicit `typescript: 5.9.3` pin in
`frontend/package.json` is **not** refused — PR
[#2452](https://github.com/thegspiro/the-logbook/pull/2452) pinned it
successfully. What was actually wrong at the time (2026-08-10) isn't
established from here; either the constraint genuinely eased since, or this
entry's own diagnosis was incomplete. **The mechanism explained in the two
bullets below is still accurate and is exactly what caused the newer,
still-open finding** — see "Frontend — `typescript`'s declared version has
drifted..." further down this file, and CLAUDE.md's "Two TypeScript
installs" section for the current, correct description of the tree.

`typescript-eslint` is held at `^8.65.0` rather than the dependabot group's
`^8.66.0`. Bumping it forces npm to re-resolve the package, and **no
`typescript-eslint` release accepts the TypeScript 7.0.2 this repo pins** —
every version caps its peer at `<6.1.0`. The tree resolves today only because
the lockfile carries a second TypeScript (5.9.3) at the root for the linter's
own use.

So the linter type-checks against 5.9.3 while `tsc --noEmit` runs 7.0.2. In
practice that means a type-aware lint rule can disagree with the build, in
either direction.

Neither an explicit root `typescript` pin (still refused by npm) nor
`--legacy-peer-deps` (drops the root copy and hands the linter an unsupported
TypeScript) fixes it honestly. Pulling that thread needs its own change.

Two related facts worth carrying:

- **The lockfile must be regenerated with npm 11** — the version
  `frontend/package.json` requires and both Dockerfile stages install. npm 10
  and npm 11 hoist this tree differently, so a lock built by npm 10 installs a
  different tree under the npm 11 that actually runs in CI and in the image.
- **npm keeps a per-workspace copy of each declared range inside the lock and
  trusts it over the manifest.** When that copy goes stale, `npm ls` reports the
  tree as invalid while `npm ci` still exits 0 — a silent refusal to re-resolve.

## Integrations — No Per-Event Notification Triggers (2026-08-12)

**Health monitoring is built (owner decision, 2026-10-05).** The owner chose
"build health monitoring" and not per-event triggers. Each integration now has
a detail page (`/integrations/:integrationId`, the **Details** button on its
card) showing its last sync, last success, last error with its time, how many
runs in a row have failed, and its last 50 runs — Salesforce syncs (manual and
scheduled), connection checks, and every Slack/Discord/Teams delivery. **Retry
Sync** re-runs a Salesforce sync, or re-checks the connection of an
integration with nothing to sync; it needs `integrations.manage`, is limited
to 10 calls a minute per caller IP and one run per integration a minute, and
is audited. Stored errors are sanitized — only a connector's own hand-written
message survives, and URLs (a webhook URL is its own secret), email
addresses, bearer tokens and long token-shaped strings are stripped from it —
and a run's summary keeps integer counts only, never the records that moved.
`integrations.status` is deliberately **not** flipped to `error` by a failed
run: the sync and Retry paths require `connected`, so one transient failure
would have switched the integration off. Health is reported in a separate
`health` field instead.

**Still not built — by the owner's choice, not an oversight.** Messaging
integrations have no event-trigger selection. The guide once told
administrators to "select which events trigger notifications" with checkboxes
for New Member, Training Completed, Event Scheduled and Shift Change; no such
control exists, and a Slack/Discord/Teams integration posts every event,
shift and training notification the dispatcher sends. Revisit if departments
ask to route only some of them.

Two screenshots stay unreachable for a separate reason: the Cal.com
**Bookings** panel works but lists bookings fetched live from a real Cal.com
account, and the Slack placeholder asked for a picture of the Slack channel
itself. Neither exists in a demo environment with no third-party accounts.

## Inventory — Departure Clearance Is Backend-Only (2026-08-12)

`DepartureClearanceService` is a complete implementation — initiate a clearance
for a departing member, list clearances, resolve each outstanding item with a
disposition, complete or close-incomplete — and `api/v1/endpoints/inventory.py`
exposes it. Nothing in the frontend calls any of it: there is no route, no page,
no service method, and no reference to "departure" or "clearance" in that sense
anywhere in `frontend/src`.

`docs/training/05-inventory.md` documented the whole workflow as if it were a
screen, including a clearance record with per-item disposition dropdowns and
resolve/complete buttons. That screenshot placeholder is retired and the section
now says the workflow is API-only.

The property-return report generated when a member is dropped is a separate,
working feature — see Membership > Property Return Process. It is the clearance
_record_ that has no interface.

Needs an owner decision on whether to build it. This loop does not make that
call.

## Events — There Is No Per-Event Analytics Panel (2026-08-12)

`docs/training/02-training.md` described a post-event analytics panel on the
event detail page, with an attendance-rate pie chart, an average-hours bar, a
participant count, and a breakdown by apparatus showing skills observed per
unit. None of it exists.

What does exist, and is easy to mistake for it:

- **`/events/analytics`** (`EventAnalyticsPage`) — a **department-wide**
  attendance-trends dashboard: summary cards and charts across all events, not
  one event.
- **`/events/:id/analytics`** (`AnalyticsDashboardPage`) — per-event, but it is
  **QR check-in analytics**: total scans, successful and failed check-ins,
  success rate, time-to-check-in, device breakdown, hourly activity. No hours,
  no skills observations, no apparatus breakdown.

The event detail page itself has attendance finalization and a printable
attendance roster, and no analytics section at all. The guide's metrics table
(attendance rate, average hours, skills observations, apparatus used) was
narrative from a worked example presented as a description of a real screen; it
is now marked as such and the screenshot placeholder is retired.

Needs an owner decision on whether the panel should be built. This loop does
not make that call.

## Events — Series RSVP Never Shows the Training Phase-Gate Warning (2026-09-04, security review EV-23)

An individual RSVP to a training session ahead of the member's current
pipeline phase gets a soft, overridable 409 warning that the member must
confirm before it proceeds. `rsvp_to_series` (rewritten 2026-09 to delegate
to `create_or_update_rsvp` per occurrence, closing a separate set of
capacity/deadline/`allow_guests` gaps) passes `override=True`
unconditionally for every occurrence, with a code comment claiming the
member "already confirmed once for the series." No such confirmation
exists anywhere in the series path — `useRSVPForm.ts`'s series branch
calls the series endpoint directly with no warning/retry handling, and
`POST /events/{id}/rsvp-series` has no `override` parameter to receive one.
A member applying to a whole series therefore never sees the warning an
individual RSVP to the identical session would have required.

Soft and overridable even when working correctly — a training-pipeline
advisory, not an authorization or tenancy boundary — so the gap is a member
proceeding without a nudge, not unauthorized access.

**Needs an owner decision, not a mechanical fix:** a series can span
sessions in different training phases, so "the" phase-gate warning for a
series submission isn't single-valued the way it is for one event. Does the
series endpoint warn once for the _first_ ahead-of-phase occurrence found,
list every one, or warn only if _any_ occurrence would? Any is defensible;
picking one needs a real response-shape change (a 409 from
`POST /events/{id}/rsvp-series`, matching frontend confirm-and-retry
handling). Full write-up: `docs/security-review/EV-16-events-requests.md`
(EV-23). A related ordering bug in the same review (EV-24: editing an
existing waitlisted RSVP could promote it ahead of an earlier-queued party)
was a straightforward engineering fix rather than an owner decision and was
fixed in the pass 4 follow-up (2026-09-10) — tracked only in that findings
doc, not here.

## Frontend — `typescript`'s declared version has drifted from the documented alias arrangement (2026-09-10, security review EV-16 pass 4)

**✅ The original finding is resolved (2026-09-10)** — PR
[#2452](https://github.com/thegspiro/the-logbook/pull/2452) re-pinned
`typescript` to `5.9.3` in `frontend/package.json`, matching CLAUDE.md's
documented arrangement again. `npm ci`, `eslint`, and `tsc-native.mjs
--noEmit` are all verified clean against the committed lockfile.

**⚠️ Still open, escalated rather than fixed:** fixing the pin surfaced a
second, distinct problem the pin alone doesn't close. `npm ls typescript`
reports `frontend/node_modules/typescript@7.0.2 invalid` against the
`5.9.3` requirement, and bare `tsc` run from `frontend/` resolves `7.0.2`,
not `5.9.3` — both confirmed twice, independently, via a fresh `npm ci`
directly against `origin/main` with no local edits (a note briefly stood
here claiming this was clean, based on testing a lockfile that had been
hand-merged across branches with `git merge` — not a reliable way to
verify a generated lockfile; that claim was wrong and is retracted). This
looks like an inherent consequence of `typescript-native:
npm:typescript@7.0.2` sharing its real package name with the direct
`typescript` dependency. `npm ci`, `eslint`, and `tsc-native.mjs --noEmit`
are all still verified clean under it (and CI's own "Frontend Lint,
Typecheck & Build" job has been green across every PR touching this tree),
so nothing in the actual build/lint/test path is failing — but `npm ls
typescript`'s own `ELSPROBLEMS` is a real, standing dependency-check
failure, not a cosmetic one. Closing it needs a restructure of how
`typescript-native` is aliased, which is beyond a manifest-text fix and
hasn't been done. See CLAUDE.md's "Two TypeScript installs" section for
the current, verified-accurate description, including why a full `rm
package-lock.json && npm install` regeneration is separately unreliable
for this tree (it has produced this same invalid entry, silently shifted
the root `typescript` to an undeclared version, and crashed npm outright,
on different attempts from the same starting state) and should never be
used to diagnose or "clean up" this dependency graph.

<details>
<summary>Original entry (superseded by the above), preserved for history</summary>

CLAUDE.md's "Two TypeScript installs" section requires the plain
`typescript` dependency in `frontend/package.json` to stay at `5.9.3` (the
version `typescript-eslint` can actually type-check against), with
`typescript-native` carrying the newer compiler under an alias for
`npm run typecheck`/`npm run build`. As of `26613a59` (current `main`),
`frontend/package.json` declares `"typescript": "7.0.2"` directly — the
exact version that broke this arrangement once before, on 2026-08-17, per
that section's own account — while `package-lock.json` still resolves the
plain `typescript` to `5.9.3`. A `node_modules/typescript` that matches the
lockfile but not the manifest is, in CLAUDE.md's own words, "surviving only
as an npm-auto-installed peer": not something a fresh
`rm package-lock.json && npm install` can regenerate, since `npm install`
reconciling the manifest to `7.0.2` hits `typescript-eslint`'s `<6.1.0` peer
cap with an ERESOLVE.

**Not currently breaking anything** — the most recent CI run on `main`
(`26613a59`) shows "Frontend Lint, Typecheck & Build" green, so whatever
installs the `node_modules` CI actually lints against is not (yet) in the
drifted state a local `npm install` from this `package.json` would produce.
This was found incidentally while running a routine backend-feature security
review's frontend completion gate (`docs/security-review/EV-16-events-requests.md`
pass 4), in a sandbox where the shared `node_modules` had drifted from the
locked state and reproduced exactly the type-resolution failure mode that
section predicts (1382 spurious `@typescript-eslint/no-unsafe-*` warnings
from a fresh `npx eslint .`, none of them real).

**Needs an owner decision on which way to resolve, not a mechanical
revert:** either (a) pin `typescript` back to `5.9.3` in `package.json`, per
CLAUDE.md's own rule ("the plain `typescript` moves only when the linter's
cap does"), or (b) if the `7.0.2` declaration was intentional — e.g. a step
toward eventually dropping the alias once `typescript-eslint` ships TS 7
support — regenerate `package-lock.json` and confirm `npm install` still
succeeds cleanly from a clean slate, and update CLAUDE.md's documented
version to match. Cross-cutting frontend tooling, not any one feature's
code, so it is flagged here rather than fixed inside a single-feature PR.

</details>

## Frontend — `npm run test:ui` crashed on a `@vitest/ui`/`vitest` version mismatch (2026-09-10)

**✅ Resolved.** `frontend/package.json` declared `@vitest/ui: ^5.0.0`
against `vitest: ^4.1.10` (and `@vitest/coverage-v8: ^4.1.10`) — a real
version mismatch, not merely a lint-tool quirk: `npm run test:ui`
(`vitest --ui`) crashed outright with `Error [ERR_MODULE_NOT_FOUND]:
Cannot find package '@vitest/ui'`, because the hoisted `vitest@4.1.11`
could not import the incompatible `@vitest/ui@5.0.0` nested under
`frontend/`. Found incidentally while investigating an unrelated
`typescript` finding (`npm dedupe` failing on this same peer conflict was
the first symptom). Fixed by pinning `@vitest/ui` to `^4.1.10` and
removing the lockfile's stale nested `frontend/node_modules/@vitest/ui`
entry (a targeted fix, not a full `rm package-lock.json && npm install` —
see CLAUDE.md's "Two TypeScript installs" section for why a full
regeneration is unreliable for this tree and should be avoided).

Verified via a fresh `npm ci`: `npm ls vitest @vitest/ui` reports no
invalid nodes, `npx vitest --ui --run` starts cleanly (no longer crashes),
and a scoped subset (36 files, 817 tests) passes cleanly. A first
full-suite attempt did not reach a clean full-suite result: one test
_file_'s worker process crashed mid-run ("Worker exited unexpectedly")
before completing, so that file's tests cannot be reported as passed — every
other file among the 6,982 individual tests that did finish passed, but the
crashed file is an open question this local run did not answer, not a
confirmed pass. Not re-run again locally, to avoid repeating the same
heavy-npm-operation resource pressure suspected of causing the crash.
CI's own frontend test job is the authoritative full-suite signal and was
green on this branch, so nothing here blocks the PR — but this note itself
now says exactly that, rather than describing an unverified file as passed.

## Inventory — Nothing In The UI Can Choose a Temporary Assignment (2026-08-12)

An item assignment carries an `assignment_type` of `permanent` or `temporary`,
`assign_item_to_user` accepts both along with an `expected_return_date`, and the
quartermaster's member view (`/inventory/admin/members`) renders a "Permanent
Assignments" group while the member's own gear page shows a "Due:" date on a
loan — so the concept is visible throughout. (A member's own page stopped
splitting assignments from pool issuances on 2026-09-05; the quartermaster
view still does, because the two are separate custody records with separate
return endpoints.) No screen can create one:

- `ItemDetailPage` is the only UI caller of `inventoryService.assignItem`, and
  it passes no options, so the API default (`permanent`) always applies.
- `distribute_items` — the bulk flow the guide pictured issuing six SCBA units —
  hardcodes `AssignmentType.PERMANENT`.

Fixed in passing, because it was losing data rather than merely missing a
control: fulfilling an equipment request for an **individually tracked** item
dropped the expected-return date entirely and issued the item permanently. The
fulfil form collects that date, and the pool branch of the same function already
honoured it by creating a checkout. That branch now marks the assignment
temporary and stores the date; two tests in `test_inventory_gaps.py` pin both
outcomes.

Still missing is any control letting an officer choose Temporary directly on an
assign or distribute-items form, which is what
`docs/training/02-training.md` described. That placeholder is retired. Needs an
owner decision on whether the control should exist.

## Elections — The Public Ballot Cannot Be Screenshotted, By Design (2026-08-12)

The public ballot page works; it just cannot be reached by the capture harness,
and the reason is a security property worth keeping rather than a defect to fix.

`_generate_voting_token` returns the raw token exactly once, to its caller, and
stores only its SHA-256 (`module-audit ELEC-5`), so database access never yields
a live credential. The only caller is `send_ballot_emails`, which puts the raw
token into an email and nothing else — the `send-test-ballot` endpoint returns
`{success, message}` and no token. The demo stack runs with `EMAIL_ENABLED`
false and no mail catcher, and the disabled path logs only
`"Email disabled. Would batch-send N messages."` — not the body.

So there is no supported way to obtain a working token in the demo environment,
and the ways to manufacture one all mean defeating the hashing. The placeholder
for the public ballot page in `docs/training/14-elections.md` is retired on that
basis. Filling it would need a mail catcher wired into `dev_env.sh` plus email
enabled for the demo org — a harness change, and the right one if this page ever
has to be documented visually.

## Elections — Proxy Voting Has an Admin Panel But No Ballot Mode (2026-08-12)

`ProxyVotingManagement` exists on the election detail page and configures
proxies. What does not exist is any way to _vote_ as one: `ElectionBallot` has
no reference to proxies at all, and the string "Voting as proxy" (or anything
like it) appears nowhere in the frontend. The guide described a ballot with a
"Voting as proxy for: …" banner above the standard ballot; there is no such
banner and no proxy mode on the ballot.

Note this compounds the ballot limitation below — the in-app ballot is the one
that would need the proxy mode, and it is already the weaker of the two ballots.

Needs an owner decision on whether proxy voting is finished or abandoned. This
loop does not make that call.

## Elections — The In-App Ballot Only Shows Position Races (2026-08-12)

An election can carry three kinds of ballot item — `officer_election`,
`general_vote` and `membership_approval` — and the Ballot Builder happily
creates all three. Members reach a ballot two ways, and the two disagree about
what is on it:

- **The public token ballot** (`BallotVotingPage`, `/ballot?token=…`, the link
  sent by email) reads `election.ballot_items` and renders every item, then
  submits them atomically as `{ballot_item_id, candidate_ids | rankings | …}`.
- **The in-app Cast Vote tab** (`ElectionBallot`, on the election detail page)
  never reads `ballot_items` at all. It derives the ballot from
  `election.positions`, renders the candidates for each, and submits **one
  position at a time** as `{position, …}`.

So an item with no position — a bylaw amendment, a membership approval —
is invisible to anyone voting in the app. It is not refused or flagged: the
ballot simply does not mention it, and the submit button names the one position
it did find ("Submit Vote for Captain"). A secretary who builds a two-item
ballot and watches members vote in-app gets a result for one item and silence on
the other.

Reproducible in the demo data: the seeded "Line Officer Election — 2027 Term"
has a Captain race and an Article IV quorum amendment, and
`docs/training/images/04-42-cast-ballot.png` is the in-app ballot showing only
the former.

This is not a small patch — the in-app component would have to move from the
position model to the ballot-item model the public page already uses, including
its submission shape. Needs an owner decision on whether to converge the two
ballots or retire one of them. This loop does not make that call.

**Update (2026-09-02, security review ELEC-28):** the backend-side half of
this gap is now closed for eligibility purposes — `send_ballot_emails`
correctly snapshots `eligible_positions` on the token for a mixed election
(ELEC-23, ELEC-26 in `docs/security-review/ELEC-06-elections-ballots.md`),
and `/ballot/lookup` correctly returns the eligible positions and their
candidates to that token. But this UI gap means it doesn't matter: a member
eligible **only** for a plain position in a mixed election (ineligible for
every structured ballot item) now correctly receives a live token, opens
`BallotVotingPage`, and sees an **empty ballot** — no positions render, so
there is nothing to vote on. A member eligible for both a position and an
item sees only the item, and submitting it spends the single-use token with
no way back to the position vote. Confirmed the backend's single-vote token
route (`POST /elections/ballot/vote`, `cast_vote_with_token`) that could in
principle carry a positional vote is not called from any current frontend
code — there is no wiring to repurpose, only a route to design a UI and
submission contract around. Through the product today, a plain-position
contest inside a mixed election cannot be voted on by an emailed-token
recipient at all. Not fixed for the same reason as the original finding: it
is a UI/submission-contract design decision, not a mechanical fix.

## Training — The Student View of a Cohort Has No Frontend (2026-08-12)

The API implements it. `GET /training/cohorts/{id}` served to a member on the
roster returns the class timeline in full and `members: []` — the roster,
classmates and per-member progress withheld exactly as intended — and
`GET /training/cohorts/mine` lists the cohorts that member is on. A member who
is _not_ on the roster gets a 404 rather than confirmation the cohort exists.

None of it is reachable from the application:

- `/training/cohorts/:cohortId` is wrapped in
  `<ProtectedRoute requiredPermission="training.manage">`, so a member who
  types the URL gets **Access Denied**, not the reduced view.
- `getMyCohorts()` exists in `trainingServices.ts` and has **no caller**
  anywhere in `frontend/src` — nothing fetches a member's own cohorts.
- Nothing links a member to a cohort. The only navigations to the detail route
  are from `CohortsPage`, which is itself officer-gated.
- `CohortDetailPage` has no member branch. Reached with `members: []` it would
  render a **Roster (0)** tab rather than omitting the tab.

So the access restriction is real and enforced server-side, but the screen the
restriction was designed for was never built. `docs/training/02-training.md`
described the member's view as something a member can open today; that
paragraph has been corrected, and its screenshot placeholder retired.

Finishing it means deciding who may open a cohort page and building the
member's half of `CohortDetailPage` — a permissions decision plus a feature,
not a correctness fix. This loop does not widen route guards, so it needs an
owner.

## Elections — Vote Receipt Verification Takes Its Credential as a GET Query Parameter (2026-09-02)

`GET /elections/{id}/verify-receipt?receipt=...` (`verify_vote_receipt`)
binds `receipt` as a bare scalar parameter on a `GET` route, so it travels
in the URL query string rather than a request body — unlike the other three
public token routes (`/ballot/lookup`, `/ballot/vote`, `/ballot/vote/bulk`),
which all carry their credential in a POST body specifically so it never
lands in server/proxy access logs or browser network history (R-D3). A
receipt hash cannot cast, change, or reveal the content of a vote — it only
confirms a matching vote was recorded, plus its timestamp and position — but
it is still a value tied to one specific voter's one specific ballot, and a
query-string value is more exposed than a body value to logging
infrastructure the application doesn't control.

Not fixed: converting this endpoint to `POST` with the receipt in the body
would be a public API **shape** change, not a mechanical one. This exact
`GET .../verify-receipt?receipt=` contract is documented as a stable,
external-facing endpoint in `wiki/API-Reference.md`, `ARCHITECTURE.md`,
`BALLOT_FORENSICS_GUIDE.md`, and the training materials — any of which may
already have a caller depending on the GET shape — so changing it needs an
owner decision about that external contract, not a guess made during a
security-review pass. (Security review ELEC-14,
`docs/security-review/ELEC-06-elections-ballots.md`.)

## Elections — Manual Ballot Batch Listing Has No Bound (2026-09-02)

`list_manual_ballot_batches` (`GET .../manual-ballots`) returns every
paper-tally batch recorded for an election with `scalars().all()`, eagerly
loads every batch's attestations, and aggregates every associated vote —
with no pagination or per-election cap. Access control is sound
(`elections.manage`-gated, org- and election-scoped), so this is a scaling concern rather than a
leak: an election that accumulates many paper-tally sessions over a long
voting window pays a growing, uncapped cost on every load of this listing.

**Accepted by the owner (2026-10-05):** left unbounded. Realistic batch
counts are small — a paper tally is entered once or twice per meeting — so
neither a cap nor a pagination contract change for the manual-ballots screen
is worth taking. Revisit if an election ever accumulates more than a few dozen
batches. (Security review ELEC-16,
`docs/security-review/ELEC-06-elections-ballots.md`.)

## Elections — Two Ballot Items Sharing an Alias String Can't Be Fully Disambiguated Without a Schema Change (2026-09-02)

A legacy ballot item (one persisted without its own `position` field) is
matched by its `title` _or_ its `id` — `ballot_item_candidate_positions()`
needs both, because a real candidate/vote for that item can be stored under
either convention depending on which code wrote it, and matching only one
would silently empty a legitimate item's candidate list. The schema
(`BallotItemInput.unique_item_ids`) enforces only unique **ids** across an
election's ballot items — nothing stops a _different_ item's `title` (or
explicit `position` override) from equaling this item's `id`.

When that collision happens, a stored `Candidate`/`Vote` row carrying that
exact string is genuinely ambiguous: `Vote` has no `ballot_item_id` column,
only `position` (a string) and `candidate_id`, and `Candidate.position`
carries the identical ambiguity — which item a candidate was originally
created "for" is not persisted anywhere once its position string is
stored. Neither table can be joined back to a specific item's identity to
settle the question.

The one instance of this that was concretely reported (security review
ELEC-38) — the duplicate-vote pre-check treating a different item's stored
vote as a re-vote on this item — **is** fixed for votes written after
ELEC-34 (round 7): that check only needs to decide "would this read as a
re-vote," where under-matching is safe as long as a genuine repeat vote is
dedup-hashed against the item's own canonical id, never its title, so the
database's `vote_dedup_hash` UNIQUE constraint still catches an actual
duplicate on that exact item even after a colliding alias is excluded from
the pre-check. `_dedup_scoped_item_aliases()` drops a fallback alias from
the pre-check whenever another item in the same election already claims
that exact string as its own canonical key.

**Correction (security review ELEC-40, round 10):** that "still caught by
the UNIQUE constraint" guarantee does not reach a vote row whose
`vote_dedup_hash` predates the id-based convention itself — i.e. a vote
`cast_vote_with_token` wrote for a legacy item before ELEC-34 landed, back
when the hash was computed against the title (`Vote.position`'s own value
for that route, which ELEC-34 never changed — only the hash input was
redirected to the item's id). For such a row, dropping its title alias
from the pre-check removes the only mechanism that could have caught a
second vote on it: the new vote hashes against the item's id, the old row
against its title, and the two never collide. Genuinely rare in practice —
it additionally requires the same election to already have a title/id
alias collision between two ballot items — but real, and not fixable by
adjusting the pre-check alone without reopening ELEC-38 (there is no way
to keep both fixed with string matching, since the schema still cannot
disambiguate the two colliding items apart from the string itself, per
above). Flagged rather than guessed at; a full fix needs one of: reverting
the pre-check narrowing (accepting ELEC-38's false-positive back) or a
backfill migration re-hashing existing legacy-item votes to the id-based
convention — both are product/data-migration decisions for an owner, not
something to pick during a review pass.

What is **not** fixed, and cannot be with today's schema: full
disambiguation of candidate/vote _ownership_ when two items collide this
way. If both colliding items happen to have real, legitimately
title-keyed/id-keyed candidates stored under the exact same string, there
is currently no way — for candidate-list rendering, eligibility, tallying,
or any other consumer of `ballot_item_candidate_positions()` — to tell
which item a given stored row actually belongs to; the function
necessarily returns the union of both, and the broader (unscoped) alias
matching it produces is deliberately left in place at those other call
sites for exactly that reason. Fixing this fully would need a schema
change — e.g. an explicit `ballot_item_id` column on `Candidate` and/or
`Vote`, populated going forward and backfilled for existing rows where
resolvable — which is a data-model decision for an owner, not something to
guess at during a security-review pass. In practice this requires an
admin to deliberately configure two ballot items whose alias sets collide
in the same election. (Security review ELEC-38,
`docs/security-review/ELEC-06-elections-ballots.md`.)

**Owner decision applied (2026-10-05):** the colliding state is now refused
when a ballot is written. `_validate_ballot_item_identities` in
`schemas/election.py` rejects, on election create, election update and saved
template alike, a ballot item whose `title` or `position` equals a
**different** item's id (an item titled with its own id stays legal). So a
new election can no longer reach the ambiguity above, and neither the
ELEC-40 legacy-hash gap nor the ownership ambiguity can arise for it. The
owner did not take the schema change or the re-hash migration. **What
remains:** an election stored before 2026-10-05 that already carries such a
collision keeps it (and keeps the ELEC-40 gap for any pre-ELEC-34 legacy
vote on it) until its ballot is next saved, which the validator will then
refuse until the collision is renamed away. Finding one needs a read of
`elections.ballot_items`; none is expected outside a deliberately crafted
API call. (`tests/test_ballot_item_alias_collision.py`.)

## Users: Roster/Archive/Leave Lists Are Unbounded, Not Just Un-Paginated (2026-08-25)

**Narrowed, and the remainder accepted by the owner (2026-10-05).** The owner
chose "compute leave widget counts with SQL COUNT — no contract change" over
paginating these lists.

- **✅ Fixed:** `leave_widget_summary` (`member_leaves.py`) no longer
  materializes every `active` leave to count three numbers; it runs one
  aggregate query with the same definitions
  (`tests/test_leave_widget_summary_counts.py`).
- **Accepted, unchanged:** `list_users_with_roles` (`users.py`),
  `get_archived_members` (`member_status.py`) and
  `MemberLeaveService.list_leaves` (`member_leave_service.py`, whose two
  callers in `member_leaves.py` still slice in memory) return every matching
  row. All three are `members.manage`-gated and org-scoped — not a leak. The
  cost grows with the department's all-time membership rather than its
  headcount, because `archive_member` keeps the row and leave records are not
  deleted; paginating them changes the response envelope the Members admin
  page and the leave screens read, which the owner declined for now.

(Security review USR-5, `docs/security-review/USR-07-users-organizations.md`.)

## Users: `GET /users` Sends the Full Admin Roster Record to Every `members.view` Holder (2026-09-02)

**Narrowed by the owner's decision (2026-10-05); the remainder is accepted.**
The owner chose to split a narrow directory endpoint for the Members page's
non-manager view and leave every other caller unchanged.

- **✅ The Members page's directory is now a real boundary.** A viewer without
  `members.manage` is served `GET /users/directory` (`MemberDirectoryEntry`):
  names, membership number, photo, status, rank, and email/phone/mobile under
  the department's contact-visibility ceiling and each member's own choice.
  `username`, `hire_date`, `station`, `platoon`, `membership_type` and the
  classification fields are not in that response, so what the directory view
  hides no longer reaches that page's network traffic.
- **Accepted, unchanged:** `GET /users` still returns the full
  `UserListResponse` to every `members.view` holder, because 25+ other screens
  (scheduling, messaging, elections, meetings, waivers, shift reports) read it
  and several need `rank`/`station`/`platoon` at that tier. A member who calls
  `GET /users` directly can still read those fields for the whole roster. They
  are org-internal, not leadership-only PII (DOB and emergency contacts stay
  gated elsewhere), and changing that contract was declined.

(Security review USR-8, `docs/security-review/USR-07-users-organizations.md`.)

## Users: A Membership-Tier Removal's Occupancy Check Can Still Miss an Unattended Batch Advancement (2026-09-14)

`PUT /users/membership-tiers/config` (`update_membership_tier_config`,
`member_status.py`) refuses to remove or rename a tier members currently
hold, and `PATCH /users/{user_id}/membership-type` (`change_membership_type`)
refuses to assign a tier that no longer exists. Security review pass 5 found
and fixed the race between these two endpoints directly (both now lock the
`Organization` row before deciding — see USR-10 in
`docs/security-review/USR-07-users-organizations.md`), but not the same race
against a third writer: `MembershipTierService.advance_all`, the unattended
monthly/on-demand tier-advancement scan, writes `User.membership_type`
without ever locking the `Organization` row. Under InnoDB's default
REPEATABLE READ, `update_membership_tier_config`'s occupancy count is a
plain read answering from a snapshot fixed before its own lock is acquired —
if `advance_all` commits a member onto the tier being removed in the narrow
window between that snapshot and the lock, the occupancy check can still
miss it, landing a member on a tier id absent from the stored config.

Not fixed: the only complete close is making `advance_all`'s member-row
locks and this occupancy check share one consistent lock order — either
holding the `Organization` lock for the scan's entire duration (a real,
bounded availability cost to every settings edit in the org while the scan
runs) or making the occupancy count itself a locking read scoped to the
tiers being removed, which does not fully eliminate the same AB/BA deadlock
risk USR-10's fix was designed to avoid (`advance_all` locks member rows one
at a time across its own loop without ever touching the `Organization` row).
Either is a deliberate change to `membership_tier_service.py`'s own,
separately-tuned locking scheme (last touched in security review pass 2 for
an unrelated race), not a one-file fix. Requires three conditions at once
(the scan running, a concurrent config edit, and a narrow non-contending
commit window) and is self-healing on the next `advance_all` run in the
common case — an unrecognized `membership_type` is `off_ladder`-counted and
skipped, not silently re-corrupted further. (Security review USR-10a,
`docs/security-review/USR-07-users-organizations.md`.)

## Membership — Length of Service Across a Break: What Is Deliberately Left Alone (2026-09-24)

Credited service now comes from recorded stints (`member_service_periods`,
`app/services/member_service_history_service.py`): time a member spent dropped,
retired or archived is not counted, and a returning member's earlier stints can
either keep counting or be kept on record as prior service. Tier advancement is
the reader. Four things are unchanged on purpose, each for the owner to revisit:

- **Members reinstated before this shipped have no recorded gap.** Nothing
  recorded when a member left before 2026-09-24, and inferring breaks from the
  audit log was rejected: it only reaches back as far as auditing does, and
  `status_changed_at` is overwritten on archive. Their service still runs
  unbroken from `hire_date` — the pre-existing behaviour, so nobody's tier moves
  on upgrade — until an officer edits their **Service History**.
- **Other `hire_date` readers are untouched.** The ID card's "Member since", the
  roster's Hire Date column, the Salesforce sync and event-attendance cut-offs
  still read `hire_date`. It remains the date the member first joined; credited
  service is a separate figure.
- **An archived member's inferred last day is the archive date.** When a member
  with no recorded stints is reactivated, the end of their earlier service is
  taken from `status_changed_at`, which archiving overwrites. The Reactivate
  dialog pre-fills it and asks the officer to correct it.
- **A soft-deleted (deactivated) member still cannot be restored.** Service
  history does not change that; see the Deactivate dialog's wording.

## Membership Pipeline — Election Packages Have No List Bound or Creation Cap (2026-08-25)

`GET /prospective-members/election-packages` (`list_election_packages`) runs
`.scalars().all()` with no pagination or limit, and `POST
/prospects/{id}/election-package` (`create_election_package`) imposes no
per-prospect or per-organization cap — there is no unique constraint on
`ProspectElectionPackage.prospect_id` and no "already has a ready package"
check, so every call inserts a new row. Access control is sound — both are
org-scoped and permission-gated (`elections.manage` / `prospective_members.*`)
— so this is the same scaling concern as the two entries above, not a leak:
repeated legitimate package regeneration (e.g. after editing coordinator
notes) accumulates rows, each carrying a PII-bearing snapshot (documents,
coordinator notes, config), without bound.

Not fixed for the same reason as the two entries above: enforcing one ready
package per prospect is a behavior change that could break an intended
"regenerate before the vote" workflow, and pagination on the list endpoint is
a response-envelope/frontend-contract change, not a drop-in. (Security review
MP-10, `docs/security-review/MP-08-membership-pipeline.md`.)

## Membership Pipeline — `/widget-summary` Loads Every Prospect Row to Count Them (2026-09-02)

`GET /prospective-members/widget-summary` (`pipeline_widget_summary`,
`membership_pipeline.py:121-178`) loads every full `ProspectiveMember` row in
the organization — every column, unbounded — into Python just to compute
`by_status` counts, three aging buckets, and (for a caller holding
`prospective_members.manage`) a `details` list of every applicant's id/name/
status. Same class as MP-10 above and the medical-screening/finance entries
elsewhere on this page: access control is sound (org-scoped,
permission-gated, and the manager-only `details` field is already withheld
from view-only callers), so this is a scaling concern, not a leak — but a
department with years of applicant history materializes its entire prospect
table, full PII columns included, on every render of this dashboard widget.

Not fixed: the aggregate counts (`by_status`/`aging`/`total`) could be
computed with `GROUP BY`/`CASE` SQL instead of a full row scan without
changing the response shape, but the `details` list itself has no natural
cap in the current contract — capping it silently truncates what a manager
sees, and paginating it is a response-envelope change for the frontend
widget, the same class of decision MP-10 already declined to make
unilaterally. (Security review MP-08 pass 3, PR #2176,
`docs/security-review/MP-08-membership-pipeline.md`.) The sibling read in
this same finding — `GET /pipelines`'s `selectinload(...prospects)` used
only to `len()` the collection — **was** fixed in the same pass: it now
counts prospects per pipeline with one aggregate query instead of
eager-loading every row, with no response-shape change.

## Membership Pipeline — A Document Delete Can Lose the File If the Commit Fails After `os.remove` Succeeds (2026-09-02)

`delete_prospect_document` (`membership_pipeline_service.py`) removes the
prospect document's file from disk, then deletes the `ProspectDocument` row
and commits. That ordering is deliberate (pass 3, MP-18): a failed
`os.remove` now raises instead of being swallowed, and the metadata row
survives specifically so it remains the one record an operator can retry
cleanup against. But if `_log_activity`, `db.delete`, or the commit itself
fails **after** a successful `os.remove`, the transaction rolls back while
the file is already irrecoverably gone — the DB row survives (untouched by
the failed transaction) pointing at a file that no longer exists.

Not fixed: this is a genuine reliability tradeoff between two failure modes,
not a one-sided gap. Reverting to commit-DB-first (this codebase's more
common pattern elsewhere, e.g. `documents_service.delete_folder`) would
reopen MP-18 — an untracked orphaned PII file with no row left to explain it
— which is strictly worse than the residual risk here: a row surviving a
failed commit is retry-safe, since a retry's `os.path.exists` check is
already false and proceeds straight to a clean metadata delete. A
rename-to-trash/restore-on-rollback scheme would close this gap without
reopening MP-18, but is meaningfully more machinery (a new trash-file
convention, restore-on-any-exception handling, a cleanup job for anything
left behind if the restore itself fails) than a rare compound failure — an
`os.remove` succeeding immediately followed by a DB commit failing —
justifies as a same-day fix. (Security review MP-08 pass 4, PR #2177,
`docs/security-review/MP-08-membership-pipeline.md`.)

**Same tradeoff, second site (2026-10-05):** `purge_inactive_prospects`
(rewritten pass 8 to actually match `INACTIVE` rows) removes every selected
prospect's uploaded files from disk, then deletes the rows and commits, for
the same reason and with the same residual gap — a commit failure after the
last `os.remove` succeeds leaves rows pointing at files already gone.
Recorded here rather than as a second entry (security review MP-08 pass 8,
`docs/security-review/MP-08-membership-pipeline.md`).

## Membership Pipeline — A Pipeline With Multiple `election_vote` Stages Has No Single "Current Stage" Once Neither `current_step` Nor a Supplied `step_id` Identifies One (2026-09-02, narrowed 2026-09-02)

`create_election_package` (`membership_pipeline_service.py`) resolves its
PII-minimization `package_fields` policy from `prospect.current_step` when
that step is itself an `election_vote` step in the governing pipeline — this
is server-only state (`current_step_id` is set exclusively by
`create_prospect`/`advance_prospect`/`regress_prospect`, and is excluded from
the generic update path), so it correctly identifies the applicant's actual
stage even when a pipeline has more than one `election_vote` step (`add_step`
has no uniqueness constraint on `step_type`, so this is a reachable
configuration; fixed in security review MP-08 pass 4 round 2, MP-23).

When `current_step` is **not** an `election_vote` step at all — e.g. a
package is requested (or re-requested) after the applicant has already
advanced past every vote stage in the pipeline, or a caller overrides
`pipeline_id` to one the prospect was never actually on — the code next
checks a caller-supplied `step_id`, once it is confirmed (unlike the
pre-existing MP-5 in-pipeline check, which never looked at `step_type`) to
actually name an `election_vote` step of the governing pipeline: `step_id`
is server-validated to belong to the pipeline either way, but only a
type-checked one is trusted as a policy source, so a `step_id` naming a
real, non-election step still falls through to the guess below rather than
being trusted (fixed in security review MP-08 pass 4 round 4, MP-26).

**Narrowed, not closed:** when _neither_ `current_step` _nor_ a
type-checked `step_id` identifies an `election_vote` step — `step_id`
omitted, or naming a real step of the wrong type — the code still falls
back to the first `election_vote` step found in the pipeline's
`sort_order`. With more than one such stage configured and no current or
step_id match, that fallback remains a best-effort guess, not a resolution
of "the" stage the package is for; an earlier stage's `package_fields`
(more permissive, or unconfigured — meaning capture-everything) can still
govern a package that conceptually belongs to a later, stricter stage the
applicant already passed through. This is now a strictly smaller case than
originally documented — it no longer includes the (now-fixed) situation
where a caller supplies the correct stage's `step_id` — but it is not
eliminated: nothing today requires a caller to supply `step_id` at all, or
guarantees it identifies an election stage when supplied.

This needs a product decision, not a drive-by fix: should a pipeline be
allowed multiple `election_vote` stages at all, and if so, what does "the
applicant's stage" mean once none of them is the applicant's _current_ one
and no `step_id` names one either — the highest-`sort_order` stage they
ever reached (would need step-progress history, not just
`current_step_id`)? Should `step_id` become required rather than optional on
`ElectionPackageCreate`, closing the gap by making the ambiguous case
unreachable instead of merely rarer? Until that is decided, a pipeline with
multiple `election_vote` stages, requested with no disambiguating `step_id`
and no current match, remains an edge case with no fully-correct backend
resolution in this fallback path. (Security review MP-08 pass 4 round 2,
PR #2177, narrowed pass 4 round 4, MP-26, same PR,
`docs/security-review/MP-08-membership-pipeline.md`.)

## Inventory — Two Cross-Member Reads Sit Behind the Baseline `.view` Grant (2026-08-26)

`GET /allowances/check/{user_id}/{category_id}` (allowance usage count) and
`GET /members/{user_id}/size-preferences` (stored uniform/PPE measurements)
both let any authenticated member look up another named member's data by id
using only `inventory.view` — the permission every seeded Member position
holds. This is the same class of gap the `ccea2576`/`d7be097b` commits closed
across most of this module (item history, active/overdue checkouts, the
members-inventory roster) and that this review's own INV-7 finding closed on
the departure-clearance-by-id route, but these two were not part of either
sweep.

Not fixed here because, unlike INV-7, this module has no established
precedent for what the intended gate is: INV-7 had an identically-shaped
sibling route (`/users/{user_id}/clearance`) already gated
self-or-quartermaster, making the fix mechanical. Allowance usage and size
data may be legitimately visible to more roles than clearance/checkout
detail (e.g. an officer approving an allowance request, or a future
supply-ordering workflow needing a colleague's size) — narrowing the gate is
a product decision about who should see it, not a mechanical match. (Security
review INV-8/INV-9, `docs/security-review/INV-11-inventory.md`.)

## Inventory — Ordinary Reorder Edits Bypass the Versioned Workflow (2026-08-28)

`PATCH /reorder-requests/{id}` (`update_reorder_request`) neither locks the
row nor increments `version`, unlike the `/transition`, `/correct-status`,
and `/receipts` endpoints added alongside it. An edit through the plain
PATCH endpoint is not serialized against a concurrent transition/receipt on
the same request, and lowering `quantity_requested` after a partial receipt
can leave `quantity_received` above the new (smaller) total — a state
`receive_reorder`'s outstanding-quantity check does not anticipate.

Not fixed because closing it means choosing between two designs with real
API-contract consequences: requiring every PATCH caller to send
`expected_version` (breaking the existing frontend edit form), or
restricting which fields PATCH may touch once receiving has started (a
product decision about what "editing an order in flight" means). (Security
review INV-16, `docs/security-review/INV-11-inventory.md`.)

**Narrowed (security review INV-16 pass 7, 2026-10-06):** the MSUP-25 fix
(`57e81e4d2`) added a guard rejecting `quantity_received` and `status`
changes through this plain-PATCH path, forcing those two fields through the
row-locked `transition_reorder_request` instead. The remaining gap is now
scoped to the other fields this PATCH still writes without a lock or version
check (`notes`, `quantity_requested`, vendor/line details) — the underlying
design choice above is unchanged, just smaller in surface.

## Inventory — "Complete Work" Always Creates a New Maintenance Record (2026-08-28)

`InventoryMaintenancePage.tsx`'s maintenance-completion flow always calls
`createMaintenanceRecord` rather than updating an item's existing open
(scheduled/in-progress) record. The original record is never closed, so it
stays permanently "due" in `getMaintenanceDueItems` alongside the new
completed record — maintenance history and outstanding-work/compliance
reporting disagree even after the item is genuinely back in service.

Not fixed because a correct fix needs to identify which open record a
completion is closing (an item is not currently prevented from having more
than one), which needs new data-fetching in the modal and a decision about
the multiple-open-records case. (Security review INV-17,
`docs/security-review/INV-11-inventory.md`.)

## Inventory — Fulfillment-Options and Requestable-Categories Catalog Reads Are Unbounded (2026-09-08)

`get_fulfillment_options` (the quartermaster's request-fulfilment picker)
materializes its narrowed candidate set with a bare `.all()`, and when
browsing for a substitution (`include_incompatible=true`) additionally
loads the organization's entire catalog the same way before applying the
caller's `limit` in Python, only after sorting the whole set.
`get_requestable_categories` (the member-facing request form's category
chips) loads one row per active item across every category just to
deduplicate chips in Python. Neither is a tenant-isolation or data-exposure
defect — both are already org-scoped, and neither returns more rows to the
client than its `limit` allows — but the _internal_ working set both build
before answering scales with catalog size with no cap, which
`docs/security-review/CHECKLIST.md`'s abuse-resistance dimension rejects.

Not fixed because, at the time this was written, it was the same shape as
this rotation's own DOC-9 (`documents_service.py`'s `accessible_folder_ids`):
both queries' own docstrings explained that the full set had to be
materialized in Python before a correct answer could be given. **Correction
(security review DOC-10 pass 7, 2026-10-06): DOC-9 was subsequently fixed
(2026-10-05, PR #2954)** — not by bounding the materialized set, but by
recognizing that folder access is a tree-reachability question answerable
with a SQL recursive CTE once only the folders carrying a restriction of
their own are loaded (see `restricted_folders_query`/`reachable_folder_ids`
in `documents_service.py`). That technique does not transfer here: a
fulfilment/category match is a per-item comparison (normalized size/colour/
style identity, rank/position eligibility), not a graph walk, so there is no
analogous SQL predicate to delegate it to. INV-22 is therefore its own
open question, no longer a shared one — a SQL-level cap would still silently
produce a wrong "cannot fulfill"/"category has nothing" answer for a
department whose free-text request or single-category stock exceeds the
cap, rather than merely reading fewer rows to reach the same correct answer.
Bounding it without breaking that correctness is a design decision (what
should happen once one category or one free-text match legitimately exceeds
a cap), not a safe drive-by `LIMIT`. (Security review INV-22,
`docs/security-review/INV-11-inventory.md`.)

**Not the same shape as `get_inventory_summary`'s own (unrelated)
maintenance-due count**, which looked identical on the surface — also an
unbounded `.all()` — but only ever read `len()` off the result, so it was
cheaply fixable and was fixed (a `COUNT(*)` query, no correctness tradeoff)
rather than added here. See INV-28 in the same security-review doc.

## Membership — Department Email Generation Has No Settings Screen (2026-08-12)

The backend implements department email generation end to end.
`DepartmentEmailSettings` (`enabled`, `domain`, `format`) is a real field on
organization settings, `PUT /organizations/{id}/settings` accepts it, and
`MembershipPipelineService._generate_department_email` uses it when a prospect
is transferred to membership — including the numeric-suffix collision handling
(`john.smith2@…`) the guide describes.

What does not exist is anywhere to set it. The frontend references
`DepartmentEmailSettings` in exactly two places — `types/user.ts` and a type
annotation in `services/userServices.ts` — and no component renders a toggle, a
domain field, or a format selector. `docs/training/01-membership.md` sent
administrators to "Settings > Organization > Department Email", which is not a
section that exists.

The defaults are `enabled: false`, `domain: ""`, `format: first.last`, so out of
the box the feature is off and stays off. Turning it on today requires writing
organization settings through the API. The guide now says so, and its screenshot
placeholder is retired until a screen exists to photograph.

Needs an owner decision: whether to build the settings section or drop the
feature. This loop does not make that call.

## Storefront — The Payments Tab Cannot Be Screenshotted, By Design (2026-08-13)

`store_payment_events` rows are written from one place: the public PayPal
webhook at `app/api/public/paypal_webhook.py`, which resolves the integration,
verifies the payload against PayPal's verify-webhook-signature API, and only
then records the capture. The authenticated storefront API exposes `GET
/payments`, `POST /payments/{id}/apply` and `POST /payments/{id}/ignore` — read
and resolve, no create.

That is the right shape for a ledger of what an external provider reported: a
hand-written row would be a claim about money movement nobody can substantiate.
It also means a demo department, which has no PayPal account and no verifiable
signature, has an empty Payments tab and always will.

`docs/training/18-storefront.md` therefore documents the tab in prose and its
screenshot placeholder is retired, with the reason in the guide so the next
person does not re-diagnose it. Same shape as the elections public ballot and
the Salesforce connection recorded elsewhere in this file.

## Skills Testing — Offline Support (2026-08-07)

Autosave shipped (2026-08-08) and covers the common data-loss case — a locked
phone or a killed tab with signal still up. Conducting an evaluation with **no
connectivity at all** was scoped in
[SKILLS_TESTING_OFFLINE_PLAN.md](./SKILLS_TESTING_OFFLINE_PLAN.md) and built
on 2026-10-06 once the owner had answered the plan's questions:

| Item                                                               | Status                                                           | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The read path blocks before the write path does**                | ✅ Resolved (2026-10-06)                                         | Built per the plan. A live test the examiner opens is kept on the device (only their own, only while draft or in progress); with no signal `loadTest` opens that copy with any queued scoring laid over it, and a test never opened on the device says so instead of spinning. `/api/*` stays `NetworkOnly` in the service worker — the copy is IndexedDB, owner-tagged and purged with the other offline stores.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **The generic offline queue cannot carry a skills test**           | ✅ Resolved (2026-10-06)                                         | A skills-test-specific queue (`utils/skillsTestOffline.ts`): one entry per test, every save merged into it (an hour offline is one PUT), and each entry's steps run in order — create, then the merged save against the version it was made from, then `complete` — so scoring never runs on a partial scorecard. A refused step marks the entry failed with the server's reason and keeps the payload; nothing is dropped after N retries, and only the examiner can discard it. Entries carry the owner tag and the drain sends only the signed-in member's own (FE3-34-5).                                                                                                                                                                                                                                                                                                                                                       |
| **May logout keep destroying unsynced work on a shared terminal?** | ✅ Decided (2026-10-06) — block with a warning; ⚠️ residual open | **Sign Out** first tries to send unsent skills evaluations; any still on the device block sign-out behind a warning naming how many, with **Stay signed in** or **Sign out and delete**. Everything else still purges as before (FE-6/FE-7). **Open, needs an owner decision:** only an interactive sign-out can ask. The **idle timeout** (default 15 min) and an **expired session** still purge without asking, and so can still discard an unsent evaluation — blocking either would defeat the automatic logoff it exists for, and keeping the scorecards past them is the "retain until the same examiner signs in" option the owner did not choose. Signing in as a different member also purges, by design.                                                                                                                                                                                                                 |
| **Must offline support cover a cold start?**                       | ✅ Resolved (2026-10-06) — owner: yes                            | Test ids are client-minted: the store mints a UUID for every create, online or not, and `POST /tests` accepts it once. A replay by the same examiner for the same template, candidate and mode returns the existing test; any other holder of the id gets one 409 whoever owns it. Starting with no signal builds the test on the device from a published sheet kept when **Start Skill Test** was last opened with signal (up to 25, bodies only — no member data) and offers the members this examiner has tested on the device; the create is queued ahead of the scoring. It sends `expected_template_version`, and a sheet edited meanwhile is refused (409) rather than frozen into a snapshot that does not match the scorecard. **Residual:** a test created on sync is dated by its arrival (`created_at`, which "Tests This Month" counts), not by when it was scored; the elapsed time is the examiner's clock as usual. |

## Onboarding Cannot Be Resumed Across a Browser Restart (2026-08-15)

**Status: accepted trade-off**, recorded because it is visible to installers and
because the wizard's own behavior makes it look like a bug.

The onboarding session identifier moved from `localStorage` to `sessionStorage`
so that a bearer credential capable of authorizing setup mutations cannot outlive
the tab on a shared or station-kiosk machine. The consequence is that onboarding
is now a **one tab, one sitting** operation: a second tab starts a new server
session, and closing the browser ends the run (as does 30 minutes of inactivity,
which was always true — the server session expires on a sliding 30-minute timer).

What makes this worth recording rather than merely documenting: the wizard's
typed answers live in a _different_ store (`localStorage['onboarding-storage']`),
which the change deliberately did not touch, because they are non-sensitive and
re-typing an entire department profile is a real cost. So reopening `/onboarding`
after a restart **repaints the form** while the session behind it is gone. The
failure surfaces at the next step that saves something, as `401` /
`ONBD_SESSION_INVALID` — not at the repaint, where the user would understand it.

The obvious tightening — clearing `onboarding-storage` whenever the session
identifier is absent — was not done, because it would discard a part-finished
department profile every time an installer glanced at another tab and came back.
An owner may want the opposite trade; the honest middle option is a banner on
wizard load that says the session has expired and the answers shown are a local
draft. Until then the guides carry the caution explicitly (see
[`ONBOARDING.md`](../ONBOARDING.md) → Data Persistence and
[`training/00-getting-started.md`](./training/00-getting-started.md)).

## DASH-1 — The Main Widget Registry Is Mostly Unread (2026-08-23)

`frontend/src/components/dashboard/widgetRegistry.ts` declares eight widgets,
each with a `permission`, an `aggregatePath` and a `queuePath`. **Only one —
`department-setup` — is read by any screen**, via
`dashboardWidget('department-setup')` in `OrganizationSetupWidget.tsx`. The
other seven are exported, covered by a test that asserts the registry against
itself, and consumed by nothing.

Seven of the eight `aggregatePath` values do not resolve to a mounted route:

| `aggregatePath`                           | Resolves to a mounted route?                                   |
| ----------------------------------------- | -------------------------------------------------------------- |
| `/users/leaves-of-absence/widget-summary` | ✅ yes                                                         |
| `/membership-pipeline/widget-summary`     | ❌ **no** — the route is `/prospective-members/widget-summary` |
| `/organizations/setup-checklist`          | ❌ **no** — the router mounts at `/organization`, singular     |
| `/onboarding/widget-summary`              | ❌ no                                                          |
| `/users/status/widget-summary`            | ❌ no                                                          |
| `/admin-hours/widget-summary`             | ❌ no                                                          |
| `/meetings/widget-summary`                | ❌ no                                                          |
| `/messages/widget-summary`                | ❌ no                                                          |

> **Corrected 2026-08-24 — it is seven of eight, not five.** The two rows now
> marked ❌ were previously recorded as ✅. Both were checked by finding the
> route decorator (`@router.get("/widget-summary")`,
> `@router.get("/setup-checklist")`) without also checking the `include_router`
> prefix in `app/api/v1/api.py` — which is `/prospective-members` and
> `/organization` respectively, not the paths the registry declares. A
> decorator alone never gives the URL. The same mistake produced three wrong
> endpoint URLs in the August 23–24 API reference, caught in review on #1772.

**Status:** Open (LOW — found 2026-08-23, verified against the code the same
day).

Nothing is broken today, because nothing fetches those paths. This is
[pitfall #19](../CLAUDE.md) in its milder form — a declaration without a
reader — and the risk is entirely forward-looking: the next contributor wires
a widget to the registry, trusts a path that sits in a file called a
registry, and gets a 404 from an endpoint that was never built.

| Option                                            | Consequence                                                                              |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Build the five missing `widget-summary` endpoints | Makes the registry true. Five endpoints of work, each needing its own permission scoping |
| Mark the unwired entries in the file              | Cheap and honest; the registry stops reading as a promise                                |
| Delete the seven unread entries                   | Smallest surface, but discards the design intent the file records                        |

Not resolved here because it is a design decision about how far the widget
layer is meant to go, not a documentation fix.

## SCHEMA-1 — `compartment_name` Is Widened Twice (2026-08-23)

`20260820_1300_d6f4a13c9e20` and `20260821_4c8d7e2a91b3` are the same
migration authored twice: both widen `shift_equipment_check_items.compartment_name` from
`VARCHAR(200)` to `TEXT`, on two different parents. Both are reachable —
`d6f4a13c9e20` through the `9bb38ab9b052` merge, `4c8d7e2a91b3` through the
chain beneath it.

**Status:** Accepted (LOW — found 2026-08-23).

Re-applying the widening is a no-op on a column that is already `TEXT`, so
this costs nothing at upgrade time and does not warrant a corrective
migration. Two things make it worth recording rather than ignoring:

1. **It looks like an error when read cold.** Anyone auditing the migration
   list will find two revisions with the same description and the same
   effect, and has to reconstruct the history to learn it is benign.
2. **The downgrade is not symmetric.** Each `downgrade()` narrows the column
   back to `VARCHAR(200)`. **A downgrade past both will truncate deep
   compartment paths** — the exact data the widening was added to hold.

## Documents — Legal Revision History Is Unbounded (2026-08-25)

`LegalDocumentService.list_revisions` (`legal_service.py`) runs `.all()` with
no pagination or limit, and `GET /legal-documents` (`get_legal_documents`,
`legal_documents.py`) returns every draft and every archived revision's full
body (capped at 100,000 characters each) and change note, for both document
types, on every load of the Governance -> Legal Documents screen. Access
control is sound — org-scoped, `legal.propose`/`legal.publish`/
`settings.manage`-gated — so this is the same scaling concern as the entries
below, not a leak: a department with years of proposal history, or a
`legal.propose` holder repeatedly creating drafts (there is no per-user or
per-org cap on draft creation), pays a growing query and response cost on
every load, with no ceiling.

Not fixed for the same reason as the entries below: pagination changes the
response envelope this screen currently expects (full `drafts`/`history`
arrays inline per document type), a frontend-contract change rather than a
drop-in. (Security review DOC-8, `docs/security-review/DOC-10-documents-legal.md`.)

## Equipment Checks — `get_item_deployments` Gates on `.view`, Its Sibling on `.manage` (2026-08-26)

`GET .../deployments` (`get_item_deployments` — which checklist positions
carry a given inventory item) is gated on `inventory.view`, while
`update_deployed_lot`'s equivalent write on the same deployed-lot data
requires `inventory.manage`. Both belong to the same request; a caller who
can only view inventory can still read a full cross-checklist deployment
map, one tier looser than the write it feeds.

Not fixed here: unlike the mechanical INV-7 fix, this pairing has no
identically-shaped sibling already gated the tighter way to copy from, and
tightening a read gate is a behavior change — an existing `inventory.view`
holder's screen would start 403ing — that a security review does not make
unilaterally. `tests/test_permission_gate_composition.py`'s `ALLOWED` dict
already records this pairing as deliberately unadjudicated, for the same
reason. (Security review EC-14 residual,
`docs/security-review/EC-14-equipment-check-shifts.md`.)

## Outbound Integration Requests — DNS Rebinding Is Closed for Direct Connections; a Proxied Deployment Relies on Its Proxy (SCH-10, resolved 2026-10-05)

**Resolved for every sender this entry tracked, on a direct connection.**
`assert_outbound_url_safe()` (`app/utils/url_validator.py`) resolves an
org-configured integration URL's hostname immediately before an outbound
request and refuses an internal answer — but the request then resolved the
name **again** when it connected, so a hostname could answer the check with a
public address and the connection with an internal one (classic DNS
rebinding). The check narrowed that window; it could not close it.

It is closed now by connecting to the address that was validated, so there is
no second resolution to win:

- **`create_integration_client()`** (`app/services/integration_services/base.py`)
  wraps its direct transport in `SSRFSafeAsyncTransport`
  (`app/utils/ssrf_transport.py`), which resolves the request's host once
  (off the event loop), refuses the request unless every answer is a global,
  non-multicast address, and connects to that address while keeping the
  original hostname in the `Host` header and as the TLS SNI / certificate
  name. That covers the six senders this entry listed —
  `integration_services/{teams,webhook,slack,discord,calcom,documenso}_service.py`
  — and, because it is the factory, every other connector built on it
  (`salesforce`, `salesforce_oauth`, `paypal`, `outlook_calendar`, `weather`).
  The senders' own `assert_outbound_url_safe()` calls stay: they fail closed
  early with the sender's own message, and nothing about them was weakened.
- **`audit_ship_service.py`**, the one sender that built its own bare
  `httpx.AsyncClient`, now builds its client from the factory. The operator's
  `AUDIT_SHIP_ALLOW_PRIVATE_DESTINATION` opt-in reaches the transport as
  `allow_private_destinations=True`, which lifts only the public-address
  requirement — the connection is still pinned, and a name resolving to a
  cloud-metadata address (`169.254.169.254`, `fd00:ec2::254`) is still
  refused. A refusal by the transport is reported as `unsafe collector URL`,
  the same as the up-front check. Moving onto the factory also gives the
  collector's acknowledgement the INT-7 size cap and identity encoding.
- `external_training_service.py` and `push_service.py` were closed
  independently on 2026-09-02 (`803eff25`, `d50a9037`) and are unchanged;
  `SSRFSafeAsyncTransport` is the transport the first of those introduced.

Guarded by `backend/tests/test_integration_dns_pinning.py`: the factory's
connection targets the validated address with the original `Host` and SNI and
resolves the name exactly once; a private, loopback, metadata, IPv6-ULA or
multicast answer is refused before anything connects; a Slack send whose own
check sees a public address and whose name then answers `127.0.0.1` is
refused; and audit shipping delivers to a real loopback socket through the
pinned address with one lookup, and reports a rebind as an unsafe URL.

**What remains — a deployment that routes integrations through an egress
proxy.** When `HTTP_PROXY`/`HTTPS_PROXY` (or an explicit `proxy=`) applies to
a request, the proxy resolves the destination, so there is no local
connection to pin. Rewriting the URL to the validated address does not work
either: httpcore 1.0's `CONNECT` tunnel takes its TLS server name from the
tunnelled URL's host and ignores the `sni_hostname` extension, so certificate
verification would fail against the address. Proxy mounts are therefore left
unpinned; on those deployments the senders keep the up-front
`assert_outbound_url_safe()` narrowing, and closing the window is the proxy's
destination policy (deny RFC 1918, loopback, link-local and metadata
addresses). **Owner decision, if this matters for a deployment:** accept the
proxy as the control, or refuse integrations through a proxy that cannot be
trusted to enforce it.

A related behaviour change worth knowing: the five factory connectors that
never called `assert_outbound_url_safe()` (`salesforce`, `salesforce_oauth`,
`paypal`, `outlook_calendar`, `weather`) now resolve their destination locally
on a direct connection, so a host whose answer is not a public address is
refused for them too.

(Security review SCH-10, `docs/security-review/SCH-15-scheduling.md`; count
corrected by the training-extended pass,
`docs/security-review/TRX-18-training-extended.md`; `documenso_service.py`'s
missing check closed by INT-27 pass 4,
`docs/security-review/INT-27-integrations.md`.)

## Google Calendar's Connector Bypasses the Shared HTTP Hardening (INT-9, 2026-09-06; size cap and timeouts resolved 2026-10-05)

**Resolved: the response-size cap and the timeouts.** `GoogleCalendarService`
reaches Google through `googleapiclient` → `google_auth_httplib2` → `httplib2`,
not `httpx`, so it never reached `create_integration_client()` and none of
that factory's limits applied — `httplib2.Http._conn_request()` drains every
response with a bare, unbounded `response.read()`, and a default
`httplib2.Http()` sets no socket timeout.

`_build_service()` (`app/services/integration_services/google_calendar_service.py`)
now passes `build()` an `AuthorizedHttp` over `_BoundedHttp`, an
`httplib2.Http` subclass that supplies its own `connection_type` on every
request — API calls, the OAuth token refresh and any redirect all come back
through it. Its connections enforce the **same numbers** the `httpx`
connectors use, imported rather than restated:

- **`MAX_RESPONSE_SIZE` (10 MB)** on the wire: the connections'
  `response_class` replaces only the bare `read()` httplib2 calls with a
  chunked read that stops as soon as the total passes the cap, and refuses a
  declared `Content-Length` over it before reading anything. A breach raises
  the shared `ResponseTooLargeError`.
- **`MAX_RESPONSE_SIZE` decompressed**, via httplib2's own
  `decode_limit_hard`: httplib2 requests gzip and inflates the body after
  reading it, so a small compressed body under the wire cap could otherwise
  expand far past it. A breach is re-raised as `ResponseTooLargeError`.
- **`INTEGRATION_TIMEOUT`'s budgets** as socket timeouts: 5 s for the TCP
  connect and TLS handshake, 10 s for every later socket operation.

After a refused or timed-out response the pooled connections are closed, so a
half-read body is never parsed as the next response. Every call site already
catches `Exception` and fails closed (`None`/`False`, or `test_connection`'s
generic message). Guarded by
`backend/tests/test_google_calendar_http_bounds.py`, against a real loopback
server: a normal response succeeds; chunked and declared-length streams four
times the cap are refused without the server managing to send the whole
stream; a gzip body that inflates past the cap is refused; a response that
stalls before its headers or mid-body times out; the same `Http` object works
again after a refusal; and the whole `googleapiclient` stack, pointed at the
loopback server, succeeds, fails cleanly on an oversized body, and returns
`None` from a push against a stalled API.

**Still open:**

- **No wall-clock deadline** — the timeouts are per socket operation, so a
  server that trickles a byte every few seconds is bounded in memory but not
  in time. The `httpx` connectors have had a total deadline since 2026-10-04
  (`INTEGRATION_DEADLINE_SECONDS` in `create_integration_client()`), but it
  is an `asyncio.timeout()` around `send()`, and Google Calendar's calls are
  synchronous `httplib2` calls inside `async def` methods, so it needs its
  own mechanism.
- **The synchronous calls block the event loop** for as long as a call runs
  — now bounded by the timeouts above rather than unbounded.
- **Redirects follow `httplib2`'s default** (followed for `GET`/`HEAD`, up to five). The
  destination is Google's own API and token endpoint, so there is no SSRF
  angle, but it is not the `httpx` factory's no-redirect policy.
- **`httplib2` and `google-auth-httplib2` are not pinned in
  `requirements.txt`** — they arrive as dependencies of
  `google-api-python-client`. The fix relies on `httplib2`'s
  `connection_type` argument, its `decode_limit_hard` option (present in
  0.32.0) and `http.client.HTTPConnection.response_class`, so an unpinned
  upgrade is what could break it; the tests above would catch that.

(Security review INT-27, follow-up round 5, 2026-09-06:
`docs/security-review/INT-27-integrations.md`.)

## Salesforce Integration — Clearing the Refresh Token Has No Reachable UI Control (INT-11, 2026-09-13)

`connect_integration`/`update_integration`
(`backend/app/api/v1/endpoints/integrations.py`) special-case an explicit
`config["refresh_token"] == ""` on a Salesforce integration: it clears the
stored `refresh_token` and `access_token`, switching the integration from its
interactive OAuth grant to Salesforce's client-credentials flow on the next
sync — the documented way for a department to move off a colleague's
personal OAuth connection onto the Connected App's own service credentials.

The frontend has no way to trigger it. `IntegrationsPage.tsx` builds the
Salesforce config as `refresh_token: sfRefreshToken || undefined` — a blank
field becomes `undefined`, which is dropped from the JSON payload entirely
rather than sent as `""`. The backend's merge
(`{**stored, **public_config}`) then leaves the old `refresh_token`
untouched: an administrator who clears the field and saves, believing they
have switched auth modes, sees no error and no confirmation either way — the
org keeps authenticating as whoever the old refresh token belonged to.

**Not fixed — needs a product decision on the shape.** Two options, and this
review would not choose between them unilaterally: (1) a distinct "Switch to
Client Credentials" control that sends the explicit `""` the backend already
knows how to handle, or (2) changing the field's blank-submission semantics
to always mean "clear" — which would need its own pass across every other
field this same form treats as "blank = leave unchanged" (client secret,
webhook secrets, API tokens across Documenso/Cal.com/PayPal), since widening
one field's semantics without checking the others risks the opposite defect
(a blank field silently wiping a working secret). No cross-tenant or
credential-exposure angle — this is a credential-lifecycle correctness gap
reachable only by an org's own `integrations.manage` holder acting on their
own organization's integration.

(Security review INT-27 pass 4, 2026-09-13:
`docs/security-review/INT-27-integrations.md`.)

## Training — Compliance Grading Still Reads Full History for Certifications and One-Time Requirements (2026-10-05)

Department-wide compliance grading used to load every `TrainingRecord` each
member ever had, then grade in Python (TR2-4: the dashboard summary; TR4-2:
the compliance matrix). On the owner's decision (2026-10-05), it now loads
only the records the grader can read. `load_graded_records`
(`app/services/training_compliance.py`) does this, bounded by
`graded_records_clause`. Every department-wide grader uses it:
`get_training_dashboard_summary`, `get_compliance_matrix`,
`compute_org_compliance_tally` (the dashboard and Administration hub
percentage), `get_member_period_status`, the annual/monthly compliance
report and the profile-card `get_compliance_summary`.

The results are identical, not approximately equal.
`tests/test_graded_records_bounded_load.py` grades an eight-year department
twice, once bounded and once unbounded. Every figure from every caller must
match, and so must every member × requirement cell on seven evaluation dates.

**Bounded to a date range** (COMPLETED records whose completion date falls in
the requirement's window, narrowed by `recency_days`):

- hours, courses, shifts, calls and the fallback types (skills evaluation,
  checklist, knowledge test), for every frequency with a window: annual
  (including custom and cross-year periods, and a pinned past `year`),
  quarterly, monthly and biannual
- rolling requirements (`today − rolling_period_months` to `today`)
- certification-period due dates. The compliance grader never reads the due
  date, only the frequency window.
- biannual hours. Its expired-certificate override reads only the records
  inside the biannual window.
- one-time requirements with `recency_days` ("on or after the cutoff")
- certifications with `recency_days` ("on or after the cutoff")

Windows are resolved per requirement on the same as-of date the grader uses,
so `include_current_month` moves the bound with them. Grandfathering,
catch-up deadlines and waivers read the member and waiver tables, not
records, so they widen nothing. SCHEDULED, CANCELLED and FAILED records are
never read, so they are never loaded.

**Still unbounded:**

- **Certification requirements without `recency_days`** load the member's
  whole COMPLETED history. A certification ignores its frequency window by
  design, and part of `certification_record_matches` is a case-insensitive
  substring test: the requirement name in the course name, the registry code
  in the certification number. SQL `LIKE` folds case by the column
  collation, not by Python's `str.lower`. The two disagree on characters
  such as `İ` and the Greek final sigma. Pushing the match into the query
  could drop a record the grader would have credited. That is a
  wrong-result risk, and the owner's bar was identical results. Bounding
  this case needs a design change, either a collation-independent match key
  stored on the record or dropping the name and registry-code heuristics in
  favour of linked courses. That is an owner decision.
- **One-time hours, courses, shifts, calls and fallback requirements without
  `recency_days`** have no window, so the grader reads every COMPLETED
  record, including ones with no completion date. They load all of them.
- **Fallback types** (skills evaluation, checklist, knowledge test) also
  read IN_PROGRESS records of any date when nothing completed matches, so
  every IN_PROGRESS record is loaded while one of these is active.

Most departments define at least one certification requirement, so most
departments still load each member's full COMPLETED history. The saving is
then the unread statuses, plus every department whose requirements are all
windowed. The callers' own extra reads are OR'd in exactly: the dashboard's
expiring, recent and year-to-date lists, the roster's selected period, and
the report's certificate count, which reads every completed certificate.

TR3-2 (above) is the same class: `TrainingService._preload_window` serves a
different evaluator. That evaluator also reads rolling and
certification-period due-date anchors, so it cannot bound the cases this
loader bounds. Both now take their per-requirement window from
`completion_window`. (Security review TR-17, TR2-4 and TR4-2,
`docs/security-review/TR-17-training-core.md`.)

## Training — The MCP Requirement-Progress Tool Is Paginated, Not Bounded (2026-09-04)

`app/mcp/tools/training.py`'s `get_member_requirements_progress` looks
paginated (`limit`/`offset`, a real `total`), and its returned rows are —
but two unbounded reads still happen underneath on every call, both
pre-existing characteristics of `TrainingService` that this pass's first
scope addition of this MCP file surfaced without previously being flagged:

- `get_applicable_requirements` has no page bound of its own; a page is cut
  from its full result only in Python, after the whole thing is fetched.
  Mitigated in practice (per TR-17 pass 2) by configuration data — a
  department's requirements — being naturally small (tens, not thousands),
  unlike the per-member `TrainingRecord` case below.
- If the requested page includes a CERTIFICATION-type requirement (or a
  BIANNUAL-hours one), `get_requirements_progress_for`'s `_preload_window`
  returns `None`, and the member's **entire** completed-training history is
  preloaded rather than a date-bounded slice — a cert check has always
  ignored the frequency window by design (valid until it expires, not per
  period), so this is not new behavior, just newly reachable through an
  MCP caller that never existed before.

**Accepted by the owner (2026-10-05):** the ceiling is one member's history,
and that is acceptable for this caller. Not redesigned: bounding a
certification check's window without breaking its correctness is a
service-level redesign of what "ignoring the window" means
for this class of check (`training_compliance.py`'s date-window logic), not
a safe drive-by change. Same class as the certification residual in
"Compliance Grading Still Reads Full History for Certifications and One-Time
Requirements" above (TR2-4/TR4-2) — a per-member, not org-wide, scan, so the
ceiling is one member's training history rather than the whole
department's. (Security review TR-17 pass 3,
`docs/security-review/TR-17-training-core.md`, TR3-2.)

## Compliance — The Annual Report's New Applicability Filter Has Four More Gaps, Plus a Display Nit (2026-09-11)

Feature 20 (Compliance) pass 4 (`docs/security-review/CMP-20-compliance.md`,
PR #2476) fixed `AnnualComplianceReportService.generate_annual_report`
grading every member against every requirement regardless of scope (CMP4-1),
by filtering through the shared `requirement_applies_to_member` helper
(`training_compliance.py`). Four rounds of Codex review on that same PR
surfaced further gaps, all flagged rather than fixed in the same pass:

- **`required_roles` was written as rank slugs but matched as position ids
  (CMP4-5, MED) — ✅ fixed 2026-10-05, owner decision.** The owner chose to
  match it against the member's rank (`User.rank`), as the model comment,
  the training-program requirements schema and every writer already say.
  The change is in the one shared helper, `requirement_applies_to_member`
  (and `requirement_applies_to_user`, which now reads `member.rank`), so
  `/my-training` (`get_applicable_requirements`), the My Training summary,
  `get_compliance_matrix`, `compute_org_compliance_pct`,
  `get_member_period_status`, `get_compliance_summary`, the competency
  matrix and the annual report all move together. The scheduling
  shift-compliance report, which matched the rank all along, now calls the
  same helper instead of its own copy — which also makes it honour
  `required_membership_types`, which it alone ignored. **Reported numbers
  change**: a requirement scoped only by `required_roles` now grades the
  members of those ranks everywhere (before, it graded nobody outside the
  shift-compliance report), so those members' standings and the department
  percentages that include them move; and a shift-credited requirement
  scoped by membership type now appears in the shift-compliance report for
  the members it names. No data migration — stored values were already
  rank slugs. Compliance-profile `role_ids` are unaffected: they hold
  position ids and are still matched against positions. Tests:
  `tests/test_required_roles_rank_matching.py`.
- **The annual report was not compliance-profile-aware (CMP4-3, MED) — ✅
  fixed 2026-10-05, owner decision.** `generate_annual_report` (and the
  monthly report built on it) now resolves every member through the shared
  `ComplianceGrading.for_member` / `ComplianceGrading.classify`, as
  `compute_org_compliance_pct`, the compliance matrix and the dashboard's
  "Department Compliance" card already did. A matching profile narrows the
  member's requirements to its `required_requirement_ids` and applies its
  threshold overrides; the report's requirement analysis counts a member
  under a requirement only when their grading includes it.
  **Reported numbers change for departments that use compliance profiles**:
  the report's overall percentage, its compliant / at-risk / non-compliant
  counts, each member's met/total and status, and a requirement's
  `members_total` now match the dashboard and matrix rather than the old
  every-requirement, fixed-100%/75% grading. A department with no compliance
  configuration, or one whose profiles match nobody, sees no change; nor
  does a previously filed report, which stores what it said when generated.
  `tests/test_annual_report_compliance_profiles.py` holds the three surfaces
  to the same figures for a profile org.
- **A requirement with zero currently-applicable members renders as a
  failing 0% (CMP4-4, LOW) — ✅ fixed 2026-09-29, workflow review W29-4.**
  `ComplianceOfficerDashboard.tsx` colored `requirement_analysis.compliance_pct`
  red below 50%, including the `0.0` CMP4-1 emits whenever a scoped
  requirement currently applies to no active member — the per-_requirement_
  counterpart to TR4-4 (the per-member case, itself fixed 2026-10-05 — see
  `docs/security-review/TR-17-training-core.md`). Fixed without widening the
  backend contract or
  `AnnualReportRequirement.compliance_pct`'s type: the dashboard now checks
  `req.members_total === 0` directly and renders a muted "Not applicable"
  instead of reading `compliance_pct` at all in that case
  (`ComplianceOfficerDashboard.tsx:436-437`; `docs/workflow-review/W29-compliance.md`
  W29-4; re-verified against current code by `docs/security-review/CMP-20-compliance.md`
  pass 6).

Full detail, line citations, and the "considered, not changed" rationale for
why CMP4-1 deliberately left the per-member zero-denominator case alone (TR4-4,
since fixed: such a member is now "not applicable" in the annual report too)
are in `docs/security-review/CMP-20-compliance.md`'s CMP4-2
through CMP4-5 entries. (Security review CMP-20 pass 4, PR #2476, Codex
review rounds 2-4.)

## RPT2-29-2 — Saved Report Scheduling Is Stored and API-Writable, but Nothing Reads It (2026-08-27)

`POST /reports/saved` and `PATCH /reports/saved/{id}` fully accept and
persist `is_scheduled`, `schedule_frequency` (daily/weekly/monthly/quarterly),
`schedule_day`, and `email_recipients`. `GET /reports/saved` reports
`next_run_at` back to the caller as though it's live. But no code anywhere
reads these fields to actually generate and email a report:

- `create_saved_report` never computes `next_run_date` — it stays `None`
  forever.
- `scheduled_tasks.py`'s `TASK_RUNNERS` registry has no entry for saved/
  scheduled reports (`run_compliance_auto_reports` is a distinct,
  `ComplianceConfig`-driven feature, not `SavedReport`-driven).
- No Celery beat / APScheduler config exists for this anywhere in the
  backend.

This is CLAUDE.md **Pitfall #19** — a config switch with no reader. A chief
can set `is_scheduled=True`, `schedule_frequency="weekly"`, add
`email_recipients`, see it listed as scheduled, and no report is ever
generated or emailed, with no error at any point.

**Fix applied (2026-08-27):** `SavedReportResponse.enforced` reports `False`
(hardcoded — there is no per-row state to compute; see the comment on
`SavedReport.is_scheduled` in `app/models/analytics.py`) and the frontend's
`SavedReportConfig` type now carries the same field, so a future
saved-reports screen can show a saved report as "not yet automated" rather
than badging it Active. **No UI currently exposes this at all** —
`ReportsPage.tsx` doesn't render saved reports despite `reportsStore.ts`/
`services/api.ts` having full CRUD support for them — so nothing is
mislabeled in the shipped app today; this closes the type gap Codex flagged
on PR #1912 ahead of that screen being built. The underlying scheduling
fields are left writable (no data-model change) — wiring a `TASK_RUNNERS`
entry that scans due `SavedReport` rows, generates, emails via the resolved
creator's permissions (the RPT-3 PII gate lives only in the endpoint layer
today, so a future sender must re-derive or enforce it itself before
emailing any of `PII_REPORT_PERMISSIONS`' report types — `member_roster`,
`pipeline_overview`, `training_summary`, `training_progress`,
`annual_training`, `certification_expiration`, `compliance_status`, and
`admin_hours` — output), advances
`next_run_date`, and builds the saved-reports screen itself is a feature
addition, not a security-review drive-by fix.

**Options for closing it:** (1) implement the `TASK_RUNNERS` reader, or (2)
reject `is_scheduled=True` at the API layer with a clear "not yet supported"
error until a sender exists, rather than the current silent-accept.

## RPT5-29-1 — `compliance_status`/`training_summary` Re-Derive Training Compliance Instead of Consuming the Shared Evaluator (2026-09-06)

`reports_service._generate_compliance_status` (the `compliance_status`
report) and `_generate_training_summary`'s `requirement_breakdown` section
both compute per-member/per-requirement completion from `ProgramEnrollment` +
`RequirementProgress` — "did this member's structured training-program
enrollment mark this requirement complete?" `app/services/
training_compliance.py`'s `compute_org_compliance_pct` (used by
`/dashboard/admin-summary`'s `training_completion_pct`, and by the training
compliance-matrix endpoint) answers a related but different question —
"has this member completed a `TrainingRecord` inside this requirement's
compliance window?" — additionally applying compliance-profile-scoped
requirement lists, per-profile threshold overrides, waivers, and per-
requirement date windows (rolling periods, custom annual windows).

This is CLAUDE.md **Pitfall #29**: two endpoints computing the same-sounding
"compliance" metric off the same `TrainingRequirement` rows, by different
rules, with no shared authority. An organization that tracks its annual
training requirements via direct `TrainingRecord` completion (no formal
`ProgramEnrollment`) sees every member as 0%/sharply-understated on the
"Compliance Status" report while `/dashboard/admin-summary` and the
compliance-matrix screen show the same members compliant for the same date —
visible only by opening both screens, not by any test or error.

**Not fixed:** `compute_org_compliance_pct` currently returns only an
org-wide percentage, not the per-member breakdown `compliance_status` renders,
so consuming it directly is a return-shape refactor of a shared utility, not a
drive-by. The alternative — relabeling `compliance_status`/`requirement_
breakdown` to say plainly they measure program-enrollment progress, not
org-wide annual compliance — is a product decision about what those screens
should say. (Security review RPT-29 pass 5,
`docs/security-review/RPT5-29-reports-analytics.md`, RPT5-29-1.)

**Options for closing it:** (1) extend `training_compliance.py` to also
return a per-member breakdown and have `_generate_compliance_status` consume
it, retiring its own `ProgramEnrollment`-based evaluation; or (2) rename/
re-scope `compliance_status` and `requirement_breakdown` to be explicit that
they measure training-_program_ enrollment completion, distinct from the
org-wide annual-requirement compliance the dashboard and compliance-matrix
report.

**Widened, not narrowed, by a later feature commit (2026-10-04, security
review pass 7):** `ea939c38` ("Let a training requirement exempt members who
joined before it") added per-requirement grandfathering
(`new_member_cutoff_date`/`existing_member_deadline`) and routed "every
screen that decides who a requirement grades" through `training_compliance.
py`'s shared `requirement_applies_to_user`/`catch_up_deadline`/
`member_join_date` helpers — explicitly including `_generate_compliance_
status` (`reports_service.py:1148-1243`), which now correctly exempts or
catches-up a grandfathered member. **`_generate_training_summary`'s sibling
`requirement_breakdown` section (`reports_service.py:358-421`) was not
updated and calls none of the three helpers** — it still counts a
grandfathered-exempt member as unmet in its per-requirement completion
percentage, the identical requirement `compliance_status` now excludes. This
is RPT5-29-1's own scenario, now reachable with a concrete, shipped trigger
rather than a hypothetical one, and is invisible to `tests/
test_requirement_grandfathering.py`'s own guard sweep, which only flags a
call to one of the three helpers that omits `join_date=` — not a report that
never calls any of them. See `docs/security-review/RPT5-29-reports-
analytics.md`, RPT5-29-5, for the full analysis. Still not fixed, for the
same reason as above: converging the two requires either rewriting
`requirement_breakdown`'s aggregate-SQL shape into `compliance_status`'s
per-member loop, or explicitly re-scoping what each report claims to
measure — a product/architecture decision, not a drive-by.

## CRON2-31-13 — A Scheduled-Task Gap Left Open by This Rotation's Pass (2026-08-27)

- **`run_admin_hours_auto_close` has no audit trail**
  (`admin_hours_service.py`'s `auto_close_stale_sessions`) — force-closes a
  member's open admin-hours session (a money-adjacent paid-hours state
  change) with no `log_audit_event()` call anywhere in that file. What to
  log (per-session vs. one batched summary event) is a design choice for
  the admin-hours feature to make deliberately.

See `docs/security-review/CRON2-31-scheduled-tasks.md` for the full pass
(12 findings fixed, 2 flagged, one of those since fixed).

## CRON-31-7/8 — Two More Scheduled-Task Dedup Trade-offs, and a Redis-Down Fallback (2026-08-31)

A second security-review pass over `scheduled_tasks.py` and the in-process
scheduler in `main.py` fixed six new findings (`docs/security-review/
CRON-31-scheduled-tasks.md`) and flagged three, all deliberate trade-offs
rather than bugs with an obviously-correct fix. The end-of-shift summary's
early "sent" stamp was settled on 2026-10-05 (a member is stamped only once the
email goes, or once the in-app notice is written where no email can go); the
other two stand:

- **`run_event_reminders` stamps a due reminder interval as sent when zero
  recipients exist yet** (an event targeted at "going" RSVPs, with nobody
  RSVP'd at the moment that interval comes due) — by explicit, commented
  design ("avoid re-processing"), not an oversight. A late RSVP after that
  point will not retroactively receive that specific interval's reminder,
  though closer, not-yet-due intervals still fire normally.
- **The in-process scheduler's Redis-down fallback runs on every worker,
  unguarded.** `main.py`'s `_try_claim_background_task` returns "you may
  run this" on any Redis error, so if Redis is unavailable, every uvicorn
  worker runs the scheduler loop concurrently with no coordination — a
  duplicate-notification risk (two workers processing the same due row),
  not a data-loss or security risk. The alternative (fail closed, run on no
  worker) is worse for this feature: zero scheduled tasks would fire until
  Redis recovers. Mirrors the documented breached-password fail-open
  trade-off in CLAUDE.md's Attack Protection table.

## CI2-33-13 — Injection-Attempt Detection Was Never Implemented (2026-08-27)

`SecurityMonitoringMiddleware`'s docstring claimed "Detect injection
attempts" among its capabilities. The code buffered up to 1MB of every
non-GET/HEAD/OPTIONS request body — including `/api/v1/auth/login` and
`/api/v1/users/password` — into a `request_data["body"]` dict that no code
anywhere in the file ever read back out. `SENSITIVE_ENDPOINTS` was likewise
defined and never consulted. No injection analysis happened at all, ever.

Found by `docs/security-review/CI2-33-core-infra.md` (feature 33). The dead
buffering was removed and the docstring corrected to state plainly that
injection-attempt analysis is not implemented, rather than silently dropping
the claim — but implementing real detection is a product decision this
security-review pass did not make on its own: what patterns to flag, the
false-positive tolerance for a log-only alert vs. a blocking one, and
whether `SENSITIVE_ENDPOINTS` should gate it or every write request should
be in scope. Left as documented future work.

## MM-9 — `approve_meeting` Has No Approval State Machine or Separation of Duties (2026-08-31)

`minute_service.approve_minutes` (the `MeetingMinutes` governance workflow)
requires the record be `SUBMITTED` and refuses to let the submitter also
approve it (`assert_different_person`). `meetings_service.approve_meeting`
(the sibling `Meeting` model — same shape of content: `agenda`/`notes`/
`motions` text, a `DRAFT → PENDING_APPROVAL → APPROVED` status, an
`approved_by`/`approved_at` pair) has neither control: it sets `APPROVED`
unconditionally from any status, and there is no `submitted_by` field or
submit step to compare the approver against in the first place — only
`created_by`.

Closing this needs a product decision, not a mechanical patch: `Meeting` has
no natural "the submitter can't approve their own submission" comparison the
way `MeetingMinutes` does, and blocking approval whenever `approved_by ==
created_by` would also block the common single-secretary workflow of one
person entering and approving a routine meeting record — a materially
different policy than the one MM-5 already established elsewhere. The
options are (a) give `Meeting` its own `submitted_by` field and a submit
step so the same guard MM-5 uses actually applies to the right pair of
people, or (b) leave `Meeting` approval as a lighter-weight, single-actor
record type and accept that its "approval" is closer to a status flag than a
governance control. Neither was chosen here.

Found by `docs/security-review/MM-24-meetings-minutes.md` (feature 24, pass
2). Confirmed not currently reachable from the reviewed frontend (no
`meetingsService.approveMeeting()` call site exists in `frontend/src/**`
today), which lowers today's exploitability but does not change that the API
itself grants any `meetings.manage` holder an unconditional, unaudited-before-
this-pass, untracked approval with no self-check.

**Update (pass 3, 2026-09-06):** the same missing state-machine guard is also
reachable through the generic `PATCH /meetings/{id}` route — `MeetingUpdate.
status` accepts any legal enum value including `"approved"`, and
`MeetingsService.update_meeting` applies it via `apply_updates` with no
transition check, so a plain edit can flip a meeting straight to `APPROVED`
while leaving `approved_by`/`approved_at` at whatever they already were
(typically still `None`) — a more silent version of the same gap, since it
records no approval actor or timestamp at all. Same permission
(`meetings.manage`) gates both routes, so this doesn't widen who can reach
the gap, only how. Whichever option is chosen for the sibling `/approve`
route above should also close this path — most likely by having
`update_meeting` reject a client-supplied `status` transition into
`APPROVED` and requiring the dedicated route (or its replacement) for that
transition specifically.

## MM-17 — `set_meeting_quorum_config` Has No Finalization Guard on Approved Minutes (2026-09-13)

Every other mutating route against a `MeetingMinutes` record —
`update_minutes`, `add_motion`/`update_motion`/`delete_motion`,
`add_action_item`/`delete_action_item` — rejects the call once the record's
status is `APPROVED` (draft or rejected only). `PATCH
/minutes/{id}/quorum-config` (`set_meeting_quorum_config` in
`app/api/v1/endpoints/minutes.py`) has no such guard: a `minutes.manage`
holder can overwrite `quorum_type`/`quorum_threshold` and immediately trigger
a recalculation of `quorum_met`/`quorum_count` on a minutes record that has
already been ratified, changing whether the historical record says quorum
was met for a vote the organization has already treated as final.

Closing this needs a product decision, not a mechanical patch: adding the
same `if minutes.status == MinutesStatus.APPROVED.value: raise ValueError(...)`
guard the four sibling endpoints already use would newly forbid an action the
API has always allowed, and it is plausible a secretary legitimately needs to
correct a quorum misconfiguration discovered after approval — the four
guarded endpoints are all content edits a correction workflow wouldn't need,
while this one is closer to record metadata. The options are (a) add the
finalization guard to match every sibling mutation and require a distinct
"reopen" or "amend" path for a genuine post-approval correction, or (b)
leave this endpoint deliberately exempt from the finalization convention and
document why. Neither was chosen here.

First surfaced as an unfiled observation in
`docs/security-review/MM-24-meetings-minutes.md` (feature 24, pass 3,
"Looked suspicious, not fixed"); promoted to a tracked finding with an id and
disposition in pass 4, when a related fix (MM-15) touched the same
validation block.

## MSG-12 — A Failed or Throttled Department-Message Delivery Is Never Retried (2026-08-31, stranded-pending sub-case fixed 2026-09-06)

`MessageDeliveryService._claim_delivery` commits a
`DepartmentMessageDelivery` row with `status="pending"` before calling out to
the email/SMS provider — this is what makes a raced or retried `deliver()`
call safe (a second attempt hits the row's unique
`(message_id, recipient_id, channel)` constraint and skips). That same
constraint means **no outcome for a claimed row is ever revisited**, and a
department message is published exactly once — no future `deliver()` call
for that message will come back around. There are three distinct ways a
member ends up not receiving a channel they should have:

- **Stranded `pending` — FIXED (2026-09-06).** If the worker process is
  killed, OOM-killed, or loses its DB connection between the claim commit
  and `_finish_delivery`'s follow-up commit, the row was left in
  `status="pending"` permanently. A new scheduled task,
  `run_recover_stranded_message_deliveries` (`app/services/
scheduled_tasks.py`, every 30 minutes, `_STRANDED_CLAIM_AFTER_MINUTES =
35`), now sweeps `pending` rows older than the cutoff: it retires claims
  whose message was deactivated/deleted or whose recipient dropped out of
  the audience since (recorded as `failed` with a reason, not left
  `pending` forever — otherwise one dead message would fill the bounded
  scan window and starve recoverable claims behind it), and re-delivers the
  rest via `MessageDeliveryService.deliver(message, only_user_ids=...)`,
  which reclaims the stale claim (`_reclaim_stale_delivery`) rather than
  duplicating it. Deliberately may occasionally re-send to a member whose
  original worker was merely slow past the cutoff, not actually dead — the
  chosen direction to err, since the alternative is a notice they never
  get. Guard tests in `backend/tests/test_message_delivery_claim_recovery.py`.
- **`failed`, from an ordinary provider error — still open.** `_finish_delivery(attempt,
error)` commits the same row as `status="failed"` whenever the provider
  raises, or reports zero successes (`EmailService.send_email` returning
  `(sent, failed)`, `SMSService.send_bulk_sms` returning a count) — no
  crash needed, just a transient outage, a rate limit, or one rejected
  recipient. This is not an edge case: it is the intended, working
  behavior of `_finish_delivery`, hit every time a send legitimately
  fails.
- **Throttled — no row at all.** `_send_email`/`_send_sms` each check the
  org's per-hour escalation limit (`is_rate_limited`, the 30/org/hour
  email and 10/org/hour SMS caps) **before** the loop that calls
  `_claim_delivery` — when the org is over the cap, the whole method
  returns immediately, logs a warning, and never claims a single recipient
  for that channel. No `pending` or `failed` row exists for any of them,
  so a fix that only sweeps `DepartmentMessageDelivery` rows (the
  recommendation below, as originally written) cannot recover this path —
  there is nothing in that table to sweep. This is arguably the worst of
  the three: it needs no crash and no provider outage, just a busy
  message-volume hour, and leaves not even a `failed` row for an admin to
  ever find later, only a log line.

Whichever path a recipient falls into, the channel affected is whichever
one fails, strands, or gets throttled — and email is the "record of
notice" this feature's own module docstring says a member must not be able
to miss, so any one of these three, on the one delivery attempt a message
ever gets, permanently and silently drops that member from the channel of
record for that message.

The stranded-`pending` path above is now closed. The remaining two —
`failed` and throttled — still need a product decision, not a mechanical
patch, and it has to cover both together: a fix scoped to
`DepartmentMessageDelivery` rows alone (i.e. a `failed`-row sweep) leaves
the throttled path, which creates no row, completely unaddressed. Open
questions: what counts as eligible for retry on a `failed` row (any
failure? a cap on attempts, so a permanently-invalid address doesn't retry
forever?), whether a throttled batch should be recorded somewhere
retriable rather than just logged, whether retry is automatic via a new
scheduled task or surfaced to an admin instead, and whether the department
would rather risk an occasional duplicate delivery (retry unconditionally)
or an occasional silent miss (leave it and alert) — the same tradeoff the
stranded-`pending` fix already made in favor of the former. None was
chosen here for the remaining two paths.

Found by `docs/security-review/MSG-25-messaging-notifications.md` (feature
25, pass 2, MSG-12); both the `failed`-status path and the throttled/
no-row path were caught by two separate rounds of Codex's review of the PR
recording this finding, broadening it from the `pending`-only scenario
originally reported — and it was that same `pending`-only scenario that
got the fix, per pass 3 (`docs/security-review/MSG-25-messaging-
notifications.md`). No `SMSService`/`EmailService` allowlist or
org-scoping gap involved — this is a reliability gap in an otherwise-correct
idempotency mechanism, not an access-control defect.

## MSG-15 — Web Push's Send-Time DNS-Rebinding Pin Is Skipped Outside `ENVIRONMENT in ("production", "staging")` (2026-09-06)

`PushService._send_one` only builds the IP-pinned `requests` session that
closes the check/use DNS-rebinding window
(`_pinned_session`/`_resolve_public_address`) when `settings.ENVIRONMENT`
is exactly `"production"` or `"staging"`. `ENVIRONMENT` is a bare,
unvalidated `str` (`core/config.py:32`, default `"development"`, no
enum) — so a real deployment left at the default, or set to any value
other than those two exact strings, sends every push through `webpush()`
with no send-time pin, relying solely on `validate_push_endpoint`'s
one-time, subscribe-time check.

The gate is not an oversight: `tests/test_push_service.py` runs a real
local HTTP server standing in for a browser push service (deliberately
not mocked, so encryption/VAPID/DB constraints are genuinely exercised),
reachable only at `http://127.0.0.1:<port>` — which `validate_push_endpoint`'s
HTTPS-only, exact-vendor-hostname allowlist would reject outright if
pinning/validation ran unconditionally in tests. `PushService.subscribe()`
itself does not call `validate_push_endpoint` (by design, that check lives
at the API boundary), so the test suite subscribes such endpoints
directly and depends on the environment gate to reach them at all. The
same `ENVIRONMENT in ("production", "staging")` idiom is also this
codebase's established pattern for other prod-only checks
(`core/config.py:460`), so a push-specific carve-out would be
inconsistent with it.

Closing this properly needs one of: a test-infrastructure change so the
local test server does not depend on skipping validation (e.g. an
explicit test-only bypass rather than an environment-string coincidence),
or a more precise signal than `ENVIRONMENT` for "is this deployment
internet-facing." Either is a design decision, not a one-line fix. The
practical exposure today is narrow — `validate_push_endpoint`'s exact-
hostname allowlist (~7 real vendor hosts) already means an attacker would
need to compromise DNS for a major push vendor (`fcm.googleapis.com` et
al.), not merely stand up an arbitrary host, so this is a defense-in-depth
gap rather than an open path.

Found by `docs/security-review/MSG-25-messaging-notifications.md` (feature
25, pass 3, MSG-15). Not exploitable cross-tenant — this affects the send
path for any recipient's push, regardless of org, and requires either a
misconfigured `ENVIRONMENT` on a real deployment or DNS compromise of a
push vendor to matter at all.

## FORM-10-related — `allow_multiple_submissions` Is Enforced Only On The Public Submit Path (2026-09-06)

`Form.allow_multiple_submissions` is a single, general-purpose column with no
hint in the schema that it applies to one submission channel only, but only
`public/forms.py`'s `submit_public_form` (and the service method behind it)
actually enforces it. The authenticated, non-public path
(`POST /forms/{form_id}/submit` → `FormsService.submit_form`) never checks it
at all — a member can submit the same "one submission per person" form
repeatedly through that endpoint regardless of the setting.

This has stood since the setting was introduced and every prior review pass
(module audit, app-review, and security-review passes 1-2) scoped FORM-5
(the sibling finding about this same column) to the public path specifically,
so it is a pre-existing scope question rather than a regression. Whether the
authenticated path should also honor it depends on what "multiple
submissions" is meant to mean for an internally-submitted form — e.g. a
recurring training acknowledgment is presumably meant to be resubmittable,
while a one-time equipment request is not — which needs a product decision
(most likely a separate setting, since the two channels' correct defaults
may differ), not a guess encoded as a fix.

Found by `docs/security-review/FORM-26-forms.md` (feature 26, pass 3,
FORM-10 note). Not a cross-tenant or disclosure issue — the only effect is
that a form-specific business rule silently doesn't apply to one of its two
submission channels.

## FORM-10-related — `allow_multiple_submissions` Has No Control In The Form Builder (2026-09-06)

Distinct from the scope question above, and found while documenting it rather
than by the review pass: **nothing in the frontend writes
`allow_multiple_submissions`.** `components/forms/FormBuilder.tsx` exposes no
control for it, `pages/FormsPage.tsx` writes only `is_public`, and a grep of
`frontend/src` finds the field in exactly three places — the type in
`services/formTypes.ts`, test fixtures, and `pages/PublicFormPage.tsx:345`,
which **reads** it to decide whether to offer _Submit Another Response_ after a
successful submission.

The column defaults to `True` (`models/form.py:127`, and `bool = True` on the
create schema). So every form a department creates through the application
allows multiple submissions, and there is **no path in the UI to change that** —
only a caller hitting the API directly can set it `False`.

The practical consequence is that the enforcement #2306 hardened is currently
unreachable for any department using the application normally. Nothing is
broken by this and no data is at risk; the fix was still correct, because the
column is settable through the API and the race was real for anyone who had set
it. But it means "set your form to one submission per person" must not be
written into operator documentation as an available step, and it is why
`docs/training/07-documents-forms.md` (Public Forms) and the wiki handoff for
this window say explicitly that the checkbox does not exist.

This is the inverse of CLAUDE.md Pitfall #19 ("a config switch must have a
reader before it has a UI"): here there is a reader, an enforcer and a stored
column, and no writer. Closing it means either adding the control to the form
builder — which needs the product decision in the entry above first, since a
checkbox labelled "one submission per person" that silently governs only the
public link would be its own defect — or removing the column and its
enforcement. Recorded rather than fixed because both directions are product
calls, not documentation ones.

## MIG-1 — Nothing Prevents Two Open Branches From Claiming the Same `down_revision` (2026-08-31)

The week to 2026-08-31 produced **seven forked Alembic heads** — the highest
this project has recorded — every one caused by two branches that were open
simultaneously choosing the same `down_revision`. They were resolved by seven
merge revisions (`cff6124cbb3f`, `b272a5d5535c`, `4b71d80aa2c1`,
`d5e6f7a8b9c0`, `5128feb36dd2`, `5b165386cc5f`, `a0af87c3904a`), the chain
validates to a single head, and no department is affected.

The limitation is in the tooling, not the schema.
`backend/scripts/validate_migrations.py` detects multiple heads **after both
branches have merged** — which is the correct time to fail CI, and far too late
to be cheap. Each fork cost a CI cycle to surface and a follow-up PR to repair,
and one of them (`a0af87c3904a`) had to clean up after two earlier ones.

Nothing warns an author at the point the mistake is made. A branch opened
against head `X` has no way to know another open branch has already claimed
`X` as its parent, because the competing revision does not exist on `main`
yet. Options, none chosen here: a pre-push hook that queries open PRs for
`down_revision` collisions; a convention that a migration's `down_revision` is
rewritten at merge time rather than authoring time; or accepting the merge
revisions as a normal cost of parallel work and simply not treating them as
defects — which is, in practice, what currently happens.

Recorded because the _rate_ is new. Seven in seven days is a signal about how
many branches are open at once, not about anybody's care with Alembic.

<!--
FE3-34-4 (filed 2026-08-31) is resolved and removed per this page's own
convention. Its fix was already present in the commit that merged the
FE3-34 doc, landed by unrelated feature work that happened to close it
before the security-review PR calling it open had itself merged — see
docs/security-review/FE4-34-frontend-shared.md ("One finding resolved out
from under the rotation, one reopened on review") for the verification
detail and the guard test that now covers it. Has its own CHANGELOG entry
("A successful edit no longer reads as though it had not happened",
2026-09-04).
-->

<!--
FE3-34-5 (filed 2026-08-31, reopened 2026-09-07) is resolved and removed per
this page's own convention. Every offline queue entry now records the member
who queued it, each drain sends only the signed-in member's own, and entries
queued before the owner was recorded are held for that member to send as
theirs or discard rather than syncing automatically — so a sign-in purge that
silently fails no longer lets the previous member's work go out under the
next member's session. See docs/security-review/FE4-34-frontend-shared.md
(FE3-34-5) for the fix and its guard tests.
-->

## FE5-34-1 — The Inventory Item Catalog Serves Its Unconstrained `color` Field From a Client-Side Cache (2026-09-07)

`InventoryItem.color` (`backend/app/schemas/inventory.py`) is `Optional[str]`,
capped at 50 characters, with no fixed vocabulary — deliberate, per its own
module docstring, since a department stocks whatever colour its supplier
sells. `GET /inventory/items/colors` (the distinct-values endpoint used to
populate the list screen's filter) was excluded from the frontend's
stale-while-revalidate cache in `docs/security-review/FE5-34-frontend-shared.md`
(`frontend/src/utils/apiCache.ts`'s `UNCACHEABLE_PREFIXES`), and its
permission dependency was tightened from `get_current_user` to
`require_permission("inventory.view")` to match every sibling read on the
router.

Neither change touches `GET /inventory/items` itself (the list/detail catalog
endpoints), which also serialize `color` per item and remain cacheable by
design — that is the catalog every `inventory.view` holder is already
authorized to read in full. Excluding it from caching entirely, to guard
against an org typing sensitive free text into a field meant for colour
names, is a broader trade (losing the stale-while-revalidate optimization on
the catalog's primary screens for every organization) that needs a product
decision — constrain/validate `color` at write time instead, or accept that
it carries the same up-to-90-seconds staleness the rest of the catalog's
already-cacheable fields do. Not fixed; correctly flagged rather than
patched, per Codex review on PR #2382.

## MS-14 — `medical_screening.view` Grants Full Narrative PHI, With No Finer-Grained Read Tier (2026-10-06)

Five routes are gated on `medical_screening.view`:
`GET /requirements`/`{id}` (configuration only, not PHI), `GET /records`/
`{id}` (the full `ScreeningRecordResponse` — including the decrypted
`provider_name`, `result_summary`, `notes`, `result_data` fields), and
`GET /compliance/{user_id}`/`.../prospect/{id}`/`GET /expiring` (derived
status only — a requirement name, a date, a `passed`/`failed`/`waived`
status — never the narrative fields). There is no permission tier between
"can see who is compliant" and "can see the clinical narrative": anyone an
administrator grants `.view` to, without also granting `.manage`, can read
every member's examining provider, free-text result summary, and reviewer
notes for every screening in the organization. HIPAA's minimum-necessary
principle would be better served by a split that lets an org grant
read-only compliance visibility (e.g. for scheduling) without also granting
read access to the clinical detail.

Not fixed, and not escalated to "the permission model is wrong": the
`view`/`manage` split here is the same pattern used uniformly across every
other resource in this codebase (view reads, manage writes), so a
three-tier model for this one feature would be an inconsistent special case
rather than a drop-in fix. Neither permission is baseline-granted — an
administrator must deliberately assign `.view` to a role, which is a
materially different posture than a route reachable by every member by
default. Splitting `GET /records`/`{id}` onto a narrower permission (or
trimming the response for `.view`-only callers) would change who can read
what for any organization that has already assigned `.view` without
`.manage` today — a behavior change on a PHI read path that only the
application owner can decide. If this is to be wired, the shape is a new
permission (e.g. `medical_screening.view_detail`) gating only the narrative
fields, with plain `.view` continuing to cover the five derived-status
routes. Found in `docs/security-review/MS-09-medical-screening.md` (feature
09, pass 7, MS-14).

## FAC-13 — Every Facility Folder Requires the Sensitive-Family Permission Set, Silencing Three Established-Baseline Categories for Their Intended Audience (2026-09-03)

`GET /{facility_id}/folders` is gated at baseline `facilities.view`/
`.manage`, and FAC-5's design deliberately splits facility data into five
**sensitive** families (access keys, utility accounts, capital projects,
insurance policies, occupants — gated `facilities.view_sensitive`/`.edit`/
`.manage`) and everything else — including a facility's photos and
maintenance/inspection records — which stays readable at the **baseline**
`facilities.view` grant held by the `secretary`, `quartermaster`,
`safety_officer`, and `training_officer` positions by design.

The facility file tree built by `DocumentsService.ensure_facility_folder`
does not honor that split: the shared `facilities` system root, each
per-facility folder, and **all six** of its sub-folders (Photos, Blueprints
& Permits, Maintenance Records, Inspection Reports, Insurance & Leases,
Capital Projects) are stamped with the identical
`required_permissions = FACILITY_SENSITIVE_PERMISSIONS` (`facilities.view_sensitive`/
`.edit`/`.manage`). That stamping existed since 2026-08-27 but was inert —
`get_facility_sub_folders` never checked it — until PR #2160
("Enforce document folder ancestor authorization", 2026-09-02, the DOC-5
fix from the Documents & Legal feature) wired `can_access_folder` into it.
Because `can_access_folder` ANDs every ancestor, a caller who is not
admitted at the shared root is now refused a facility's **entire** folder
tree, sensitive or not — so a secretary, quartermaster, safety officer, or
training officer gets an empty folder list for every facility, including
the Photos, Maintenance Records, and Inspection Reports categories that are
supposed to be visible at their baseline grant (Blueprints & Permits'
classification is separately undecided — see below). `GET /photos`
(baseline `.view`) still returns the photo's metadata; only the file behind
it, filed into this tree, is unreachable to them.

Verified empirically against the real `DocumentsService.can_access_folder`
(not a reimplementation): a `facilities.view`-only caller is refused a
`required_permissions`-stamped Photos sub-folder; a `facilities.manage`
caller is admitted.

Fail-closed throughout — not a data-exposure bug, a functional regression.
Not fixed because a correct narrowing needs: (1) a new permission tier for
"any facilities module access" to gate the root/per-facility folder and the
three sub-folders unambiguously operational per FAC-5's own text (Photos,
Maintenance Records, Inspection Reports), distinct from both the generic
`documents.view` (much broader — the default `member` position holds it, so
simply clearing `required_permissions` would let any member browse these
folders through the generic Documents module with no facilities grant at
all) and the narrower sensitive set (which must stay on Insurance & Leases
and Capital Projects); (2) an owner call on whether **Blueprints & Permits**
specifically should stay sensitive (floor plans can be defensibly
security-sensitive even though FAC-5 never named them as one of the five
families) or move with the other three — until decided it stays sensitive,
fail-closed; (3) reclassifying existing document references before
loosening the per-facility folder's own permission — this covers two
cases, not just unfiled documents: `_validate_shared_document_reference`
files every currently-unfiled photo/document directly into that parent
folder, not into any of the six sub-folders, so loosening it first would
expose every document sitting there today regardless of how the sub-folders
are classified — **and** the same function only relocates when
`folder_id is None`, so an already-org-shared document already sitting in
an unrestricted or otherwise weakly-protected folder is left exactly there
and stays downloadable via `GET /documents/{id}/download` (which authorizes
on that folder's own ACL alone, no facility-specific check) to any
`documents.view` holder — a gap that is live today independent of whether
this permission tier is ever loosened; (4) a migration correcting every
already-stamped row for whichever categories move, sequenced after (3).
Found in `docs/security-review/FAC-12-facilities.md` (feature 12, pass 3,
FAC-13; the already-filed sub-case surfaced in a later Codex review round
of the same pass). A related but distinct gap — `documents.manage` alone
bypassing a document's own folder ACL through the _generic_ update/delete
routes, independent of this facility-specific over-restriction — was found
in the same review round and fixed (FAC-14, same doc). Two further Codex
follow-ups found and fixed in the next round: the same bypass on a document
_move_'s destination folder (FAC-15) and on the folder-mutation routes
themselves — rename/reparent/delete of the target folder (FAC-16), the
latter of which also uncovered and fixed a pre-existing bug where deleting a
folder with descendants silently orphaned them instead of cascading (see
FAC-16 and the entry below). A further round of Codex review fixed an
unrelated response-model bug that turned every successful call to
`GET /{facility_id}/folders` into a 500 (FAC-17). A final round of Codex
review on the same commit, plus a systematic sweep of every remaining
folder/document route in the file, found and fixed the identical
destination-not-checked shape on folder reparenting (`update_folder`'s
`parent_id`, FAC-18) and folder creation (`create_folder`'s `parent_id`,
FAC-19), and added a defense-in-depth guard so the now-working
folder-delete cascade cannot follow a cross-organization `parent_id` even
if one is ever written outside the two guarded write paths (FAC-20). A
further round found the delete cascade checked only the folder named in
the request, never any descendant's own `required_permissions` (FAC-21).
And, after PR #2191 (carrying FAC-14 through FAC-21) had already merged,
a Codex finding on its final commit caught the most severe instance of
this family: `delete_folder` never checked `is_system`, so — now that
FAC-16 made the cascade genuinely destructive — any `documents.manage`
holder could delete a system root such as "Member Files" outright and
destroy every member's subfolder and document beneath it in one request,
contradicting the documented invariant that system folders cannot be
deleted; fixed on a dedicated follow-up branch/PR per CLAUDE.md Pitfall
#24 (FAC-22). A further Codex review of that same fix commit, still on the
same PR before it merged, found a two-step bypass of FAC-22 itself:
`update_folder` never checked `is_system` before applying a reparent, so a
system folder could be moved underneath an ordinary, freely deletable
folder and destroyed by deleting that folder instead — the delete
cascade's subtree walk checked cross-organization membership and each
descendant's own ACL but never a descendant's `is_system`. Fixed with two
independent changes: `update_folder` now refuses to reparent a system
folder, and `delete_folder`'s subtree walk now refuses if any descendant is
a system folder regardless of how it got there (FAC-23). None of FAC-14
through FAC-23 are listed here because they are resolved, not open
limitations. The already-filed sub-case in item (3) above and the
Blueprints & Permits classification question in item (2) remain open,
unresolved by any of these rounds.

## FAC-30 — A `facilities.delete`-Only Custom Role Cannot Delete a Facility Document/Folder Through the Generic Documents API (2026-08-25)

`can_access_folder`'s `required_permissions` list on a sensitive facility
folder is `[facilities.view_sensitive, facilities.edit, facilities.manage]`
— it has never included `facilities.delete`, on either side of the FAC-24/26
read-vs-write split. A department's own **custom** position granting
`facilities.delete` alone (without `.edit`/`.manage`) passes the
facility-specific `DELETE /facilities/documents/{id}`/`DELETE
/facilities/photos/{id}` routes (which check the action-specific permission
directly) but is refused by the _generic_ Documents API's folder/document
mutation routes for the same file, since the read-admission check
`permission_matches_any` never recognized `facilities.delete` either. No
seeded role or rank is affected — `facilities.delete` appears in
`core/permissions.py` only bundled with `.edit`/`.manage`, which already
satisfy the check, on the three chief ranks. Not fixed because it is a
permission-model design question, not a mechanical gap: teaching
`required_permissions` a third, action-specific tier (distinguishing
"delete-capable" from "edit-capable" within the write tier) is a real product
decision about whether the generic Documents module should honor a
facility-specific action grant at all. Found in
`docs/security-review/FAC-12-facilities.md` (feature 12, pass 3, FAC-30).

## Medical Supplies — The Item Picker Pages by Offset, and a Concurrent Edit Can Hide a Match (2026-09-04)

**Severity:** LOW · **Status:** Accepted trade-off · **Verified against code:**
2026-09-04

`MedicalSupplyItemPicker` (the delivery-line catalogue search) pages with
`skip`/`limit` against `GET /medical-supplies/items`. Offset paging is not
stable over a set that changes between requests: if another officer archives or
deletes a matching item **before** the page boundary while a search is open,
every later match shifts back into a range already read, so the next page starts
past a match that was never returned. The officer sees "Show more" retire on a
list that is missing one row, with nothing on screen indicating it.

**Why there is no client-side fix.** A revision of this component tried to
detect the shift by comparing the new `total` against the previous one and
rewinding the offset by the difference. It was wrong in both directions and
introduced two defects of its own:

- A removal paired with an insertion leaves `total` unchanged, so a net-count
  comparison never fires while the boundary has still moved.
- When the corrective request failed, the recorded total had already been
  updated, so the retry saw no decrease, skipped the rewind, and omitted the row
  permanently. The corrective request was also not chained into the original
  promise, so "Show more" re-enabled mid-correction and could discard it.

The compensation was removed rather than deepened. A client cannot reconstruct a
boundary shift it did not observe; inferring one from a net count is a guess
that fails silently.

**The fix, when it is worth doing.** A cursor (keyset) on
`GET /medical-supplies/items`, so a page is anchored to the last row returned
rather than to a positional offset. That endpoint is shared with the gear
inventory side, so it is a public-API change with its own schema, service and
test surface — deliberately out of scope for the picker fix and needing its own
change set.

**Why it is accepted for now.** The window is a live search open across a
concurrent catalogue edit, the impact is one hidden row in a search the officer
can re-run, and the search box narrows results directly. This does not affect
what is delivered or recorded — only which matches a picker lists.

## The Skip Link Dangles in Two Pre-Layout Loading States (2026-09-08, narrowed and corrected 2026-09-09)

`index.html` opens with `<a href="#main-content">`, and every page that owns its
own shell provides that target — `skipLinkTarget.test.ts` checks all of them,
in both directions. Two **transient** states have no target and cannot be given
one statically:

| State            | What renders                            | Why it cannot own the id                                                                                                                                                                                                                                                                        |
| ---------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First chunk load | `PageLoadingFallback` (`App.tsx`)       | React does not unmount the children a `<Suspense>` stands in for on an update — it hides them with `display: none` and leaves them in the DOM, so `getElementById('main-content')` answers with the hidden `AppLayout` main. Focusing a `display: none` element is worse than focusing nothing. |
| Session check    | `ProtectedRoute`'s two loading branches | Module routes nest `<ProtectedRoute requiredModule=…>` **inside** the layout route, so the same branch can render within `AppLayout`'s `<main>` — a nested landmark and a duplicate id.                                                                                                         |

The `PageLoadingFallback` case is reachable rather than theoretical: finance,
grants-fundraising and training route to `lazyWithRetry` pages with no inner
`<Suspense>`, so navigating to one suspends against the global boundary with
`AppLayout` already mounted. Most other modules wrap their lazy pages in
`<Suspense fallback={null}>`, which keeps the suspension local — but **not all
of the reachable routes live in a module**: `App.tsx` mounts
`LearningCenterPage` and `LearningPathPage` directly inside the layout route,
both `lazyWithRetry` and neither wrapped. Any inventory of "which routes can
suspend against the global boundary" has to include those two.

**A third pre-layout state was found and fixed rather than accepted**, and the
difference is the whole rule here. The top-level `ErrorBoundary` also renders
outside the layout, but an error boundary **unmounts** the tree it caught —
`AppLayout`'s main is gone, not hidden — so exactly one `#main-content` is ever
present and its fallback can own the target. It now does. The two states above
are the ones that cannot, not the only ones that lacked a target; a new
full-screen state should be checked against that test (does it replace, or does
it coexist?) rather than assumed to belong on this list.

**What a fix would take.** Either give every unwrapped route the inner
`<Suspense>` most modules already have — the three modules above **and** the two
learning routes in `App.tsx`, since missing any one of them leaves the global
fallback reachable and the condition for safely putting the id on it false — or
resolve the skip target at click time against the visible main rather than by
id. The first is 47 route entries and changes what a page
swap looks like (a quiet in-layout replace instead of a whole-app spinner); the
second changes a shared contract that `index.html`, `AppLayout` and three e2e
specs all read. Both are their own change set.

**What is actually on screen, and what the link actually does.** This paragraph
has been wrong twice, in both directions, so it states the mechanics rather than
a conclusion:

- **Activating the link moves nothing.** Focus stays on it. The `role="status"`
  text is a live region, not a focus target — a `<p>` with no `tabIndex`, so it
  is not in the tab order and the user does not "land" on it. Nothing is thrown;
  the link is simply inert.
- **The screen is not always only a spinner.** `App.tsx` renders
  `<UpdateNotification />` immediately before, and _outside_, the `<Suspense>`
  whose fallback this is, so it stays mounted through the loading state. When an
  update is pending it shows "Reload now" / "Force refresh" plus a dismiss
  button. So an earlier claim here that these states have no interactive content
  was false whenever that banner is up.

**Why it is still accepted.** Not because there is nothing interactive, but
because there is nothing to skip _to_: SC 2.4.1 exists so a keyboard user can
get past a repeated block of navigation **into the content**, and in these two
states the content does not exist yet. The banner is a single dismissible strip
of at most three controls, reachable by one Tab, and it is followed by a spinner
rather than by a page. A skip link that worked here would land the user on an
empty region. Both states are also transient and the link is only revealed on
focus.

**What would void this.** Either state gaining real content or a persistent
navigation block behind the banner — at which point there is something to skip
to, and the fix above has to be done.

`skipLinkTarget.test.ts` names both files and explains the constraint in its
failure message, so the next person to try the obvious fix is told why it is not
one rather than discovering the duplicate id in review.

## SCHED-CUSTOM-SEAT — A Department's Own Crew Seat Cannot Be Assigned to Anybody (2026-09-09, resolved 2026-10-06)

**Resolved by building it (owner decision).** The position columns are
`VARCHAR(100)` (migration `56c91e7d9e10`), the four request schemas take a
validated string, and the rank editor and the Open Positions picker offer the
department's own seats again. A seat is checked against **that shift's** seats
by one function, `app.utils.positions.resolve_seat`, on every path that seats a
member; a seat the shift does not have is a 422 with `LB-SCHED-003`.
`docs/SCHEDULING_MODULE.md` (Shift Signup) states the rule and the eligibility
answer; `tests/test_custom_crew_seats.py` covers each path, the migration and
the cross-department case.

**Downgrade.** `56c91e7d9e10`'s downgrade narrows the columns back to the
built-in ENUM only when no row holds a custom seat. Otherwise it refuses and
names the rows' seats rather than letting MySQL truncate them — reassign or
remove those assignments and claims first.

**Still open, recorded rather than decided here:**

- **Eligibility for a custom seat is grant-only.** A seat nothing grants (no
  rank, not on Open Positions, not an open-to-all shift) is eligible for nobody,
  which is how every seat is treated; officer assignment enforces eligibility
  too, so such a seat cannot be filled by anyone until it is granted. Template
  and apparatus seats carry no rank or certification requirement of their own,
  so there is nowhere to read a per-seat rule from. Whether an officer should be
  able to seat a member in an ungranted custom seat is an owner question.
- **Qualifications and training programs map onto built-in seats only**
  (`positions_for_qualifications`, `TRAINING_POSITION_MAP`). A certification
  cannot confer a custom seat.
- **The crew board offers the apparatus's seats; the server checks the
  shift's.** `apparatus_positions` on the shift response prefers the apparatus's
  riding seats over the shift's own, while the seat cap, eligibility and now the
  seat check read `shift.positions` (which `create_shift` copies from the
  apparatus when the shift names none). The two diverge only when both carry
  seats and they differ; a seat offered from the apparatus list that the shift
  lacks is refused — 400 for a built-in seat, as before, and 422 for a custom
  one.
- **Server-rendered seat names use a title-cased token for a custom seat**
  (`position_label`), not the label chosen under Position Names — notification
  bodies and printed rosters read "Rescue Tech" for a seat the screens call
  "Rescue Technician".

<details>
<summary>The original entry (2026-09-09)</summary>

A department defines its own seats in Scheduling → Position Names, and they
belong to the vocabulary nearly everywhere: a shift template can carry one,
`canonical_position` round-trips it verbatim rather than folding its case, the
board renders the admin-chosen label, and `getPositionOptions` offers it in the
template form's dropdown.

Nobody can be put in one. Every route that seats a member types `position` as
the closed `ShiftPosition` enum — `ShiftSignupRequest`, `ShiftAssignmentCreate`,
`ShiftAssignmentUpdate` and `StandingShiftCreate` — and `shift_assignments.position`
is a MySQL `ENUM` behind them. A custom seat is therefore refused at request
validation with a 422, and would be refused again at the flush.

**What this costs.** A department can build a template around "Rescue
Technician", publish shifts from it, and watch every attempt to claim that seat
fail. The seat looks configured everywhere except where it counts.

**Why it is recorded rather than fixed here.** Widening it is a schema
migration on an ENUM column plus a decision about how an open-vocabulary seat is
validated against a shift's own list — a scheduling change, not an onboarding
one. What this branch did do is stop the rank editor offering custom seats: a
rank made eligible for one grants nothing, and offering it is a promise the app
cannot keep, the same reason a module checkbox with no permission behind it is
not rendered. `rankEligibleSeatOptions` in
`frontend/src/modules/scheduling/utils/positionLabels.ts` states this, and
`positionLabels.test.ts` asserts a custom seat is not offered.

**What would fix it.** Widen the four request schemas to a validated string
checked against the shift's configured seats, migrate the ENUM columns to
`VARCHAR`, and then restore custom seats to the rank picker in the same change.

</details>

## EV-26 — Room Booking Serializes Per Department; Two Departments Can Still Collide (2026-10-04)

**Accepted residual.** The double-booking race is fixed: every booking path
takes the department's `organization_locks` row (scope `room_booking`) before
checking for an overlap, reads events with a locking read, and `update_event`
takes that lock before its own event-row lock
(`tests/test_room_booking_race.py`). The lock is per department rather than per
room because the locking range read over `events` takes InnoDB gap locks that
two rooms can share, which deadlocked bookings of different rooms in the same
way `test_storefront_order_deadlock.py` documents for the store.

What a per-department lock cannot cover is two _departments_ on one
installation booking at the same moment, when the last room of one and the
first room of the other sit next to each other in the `events.location_id`
index with no events between them. Both then hold the same gap, and InnoDB
breaks the cycle by failing one request with a deadlock (1213); the officer
retries. It needs two departments booking in the same few milliseconds, and it
fails loudly rather than double-booking. The same residual exists for the
store's per-department lock, and for program enrollment, which takes the same
kind of lock (scope `program_enrollment`) around its duplicate check.

## Prospects — Seven Drawer Fields Have Readers and No Producer (2026-09-24, resolved 2026-09-24)

Found by the mapper sweep that followed the `election_title` fix (see below).
The frontend `Applicant`, `ApplicantListItem` and `ElectionPackage` types
declare seven fields that components read and nothing anywhere supplies:
`target_role_id`, `target_role_name`, `deactivated_at`, `deactivated_reason`,
`reactivated_at`, `withdrawn_at` and `withdrawal_reason`.

These are not dropped in the mapping — the `prospective_members` table has no
such columns, no schema serialises them, and a repository-wide search finds
`target_role` in the backend only under training and messaging, which are
unrelated. The status lifecycle is carried by `status`, `metadata_` and the
activity log instead.

**What it costs today.** The drawer's "Deactivated: …", "Previously reactivated
on …" and withdrawal-reason lines never render; the deactivated/withdrawn
columns in the applicant table render `—` for every row. The live one is the
conversion: `ConversionModal` sends `target_role_id: applicant.target_role_id`,
which is always `undefined`, so `convertToMember` never populates `role_ids` and
`_do_transfer` takes its `if role_ids:` branch never. The new member still gets
the default `member` role — the fallback below that branch guarantees it — but
never the role the drawer's own Target Role block was written to carry, and no
error says so.

**Resolved by adding the columns**, which is the direction the UI was written
expecting. `20260924_1540_77d4aa7798dd` adds `target_role_id` (FK to
`positions`, `SET NULL`) and the five lifecycle columns, and backfills the
latter from `prospect_activity_log`, which had been recording every status
change and its reason all along — so an existing department sees real dates on
applications it withdrew years ago rather than the blank fields this entry was
about.

The stamps are historical rather than mirrors of `status`: the drawer's Details
block renders "Deactivated:" and "Last reactivated:" whatever the application's
status is now, and its inactive banner expects to show a _prior_ reactivation on
a record that has gone inactive again. `_apply_status_change` — the single choke
point for every transition, single and bulk — stamps forward on that same rule
and never clears, and the backfill used it too.

The target role is now settable on the three surfaces that display it: the
add-applicant form, the drawer's contact editor, and the conversion dialog,
where it is pre-filled and changeable because that is the last moment anyone can
correct it. `_do_transfer` uses an explicit `role_ids` when given and the
application's own target role otherwise, which also reaches the automatic path
at `_complete_step` — that one passes no roles at all and so could never have
honoured the applicant's role.

**Choosing a target role is granting it (MP-31, 2026-09-30).** Saving one is
held to the saver's own permissions, manual conversion to the converting
member's, and automatic conversion applies it only while whoever chose it is
still active and holds every permission it grants. **Accepted:** a target role
saved before 2026-09-30 has no recorded chooser, so automatic conversion gives
that applicant the default position and logs that a leader must assign the
role. Converting manually applies it as normal. To have it applied
automatically, clear the role on the applicant and choose it again: only a
change records who chose it, because the applicant drawer re-sends the stored
role on every save.

**Two further defects surfaced while closing this**, both fixed here:

- `new_user.roles = roles` in `_do_transfer` was a lazy load on a persistent
  instance (the role query autoflushes the INSERT), so it raised
  `MissingGreenlet`. It was unreachable only because `role_ids` was always
  empty — meaning the explicit-role path was broken too, not just the default.
- `ApplicantListItem.current_stage_type` was declared, never populated and
  never read on that type. Removed.

The one gap that remains is `ElectionPackage.target_role_name`, which
`mapperFieldIntegrity.test.ts` still carries as its single `KNOWN_GAPS` entry —
see the comment there for why resolving it live would put a current value beside
two frozen snapshot ones in the same panel.

## Prospects — The Screen Re-Derives "Last Stage" Instead of Reading `is_final_step` (2026-09-24)

`ProspectiveMembersPage` computes `isLastStage` as "the stage with the highest
`sort_order`", and that is what decides whether the drawer's action row offers
**Advance** or **Convert**. The backend ships `is_final_step` per step and
decides auto-transfer from the flag, not from the ordering.

They normally agree: `reorder_steps` normalises the flag onto the new last
position after a reorder. But it does so **only for a pipeline that already has
some step flagged** — deliberately, so normalisation cannot invent an
auto-transfer trigger nobody configured — and a step can be created with
`is_final_step=True` in any position. The service's own comments at
`membership_pipeline_service.py:2397` and `:2491` guard the skip path against
exactly that state, which is the evidence it occurs.

Where they disagree, completing a mid-pipeline stage can auto-convert a prospect
while the UI labelled that stage's action **Advance** — a conversion nobody read
as a conversion. This is CLAUDE.md pitfall #29: the screen re-deriving a
decision the backend already made and shipped.

**What would fix it.** Carry `is_final_step` and `is_first_step` on
`PipelineStage`, map them, and read the flag instead of the ordering. The one
judgement needed first is what **Convert** should mean on a pipeline with no
flagged final stage: today the button appears on the highest-`sort_order` stage
and the manual `/transfer` it calls works regardless of the flag, so reading the
flag alone would remove the button from those pipelines entirely.

## Training — Credit From Event Attendance (2026-09-29)

Finalizing a Training event's attendance now writes every checked-in member's
training record (see `docs/training/04-events-meetings.md` → _Training Credit
from Events_). Before this, an event made from Events → Create Event wrote no
records at all, and the members an officer corrected with Edit Times were the
ones skipped.

**Decisions the owner made, and what they cost:**

- **No backfill.** Events finalized before this change keep whatever they
  wrote — for Events-created Training events, nothing. The fix is per event:
  somebody with `events.reopen_attendance` reopens it (optionally adding
  training details on the Requirements & Programs card) and it is finalized
  again. Training officers do not hold that permission by default, so a chief
  has to do the reopen.
- **Training events no longer credit admin hours**, even where a department
  mapped them. Finalizing a Training event removes the admin-hours entries
  _that event_ wrote earlier, including approved ones. Entries for Training
  events that are never finalized again stay in the ledger, and still add to
  the dashboard's My Hours and the annual compliance total alongside the
  training records.
- **A credited member removed from the roster** has the record marked
  Cancelled with its hours zeroed and a note of what it held, rather than
  deleted, so their history shows the credit given and taken back.

**Known risks and gaps, not fixed here:**

- **Records from a Training event with no details carry no category or
  course.** They count toward total hours; category-scoped HOURS requirements
  and COURSES requirements ignore them until details are attached and the event
  is re-finalized.
- **A CERTIFICATION requirement could be met by name — ✅ narrowed
  2026-10-05, owner decision: name matching kept for legacy records only.**
  `certification_record_matches` still accepts the requirement's name as a
  substring of the record's course name, but only for a record completed on or
  before the requirement's `name_match_until` (an undated record is dated by
  when it was entered). Migration `60aaf273de27` sets that to the day the
  migration runs, for every requirement that exists then — the day this
  installation's rule changed, so a record graded under the old rule before
  the upgrade keeps its credit, whenever the upgrade happens. A requirement
  created afterwards has no cut-off and never matches by name; nor does any
  requirement on a fresh install. A later record needs a linked course, the
  requirement's training type, or its registry code in the certification
  number (the registry-code substring match was not part of the decision and
  is unchanged). **Reported numbers change**: a member whose only match for a
  certification is a course-name substring on a record completed after the
  upgrade (an event titled "CPR Refresher", say) now reads not started on that
  requirement, on every screen at once — link the course on the requirement
  to credit it. Records completed before the upgrade are unaffected. Still
  open: a record backdated after the upgrade to a completion date before the
  cut-off is legacy by that date; and the non-certification fallback types
  (skills evaluation, checklist, knowledge test) still match by name with no
  cut-off — the decision covered certifications only.
- **Duplicates of a self-reported or hand-entered record are not detected.** A
  member who submitted the same class, or an officer who entered it by hand as a
  workaround, gets a second record from finalize; void the manual one.
- **A session-backed event still adopts a same-named record from its day.**
  Finalizing looks for a record written before the source link existed by the
  session's course name and the event's day, as it always has, so a record an
  officer scheduled for that class that day is completed by it rather than
  duplicated. Taking credit back is narrower: removing, cancelling or
  re-typing only reaches the member's own check-in placeholder and completed
  records for members the session credited — never a record somebody else
  scheduled or started.
- **The NFPA completeness report flags a missing instructor** on records from
  events without a course.
- **A rolling recurring series cannot carry training details** — the nightly
  job that extends it copies events, not sessions. Its occurrences are still
  credited, as their titles.

## Events — Attendance-Lock Refusals (2026-09-30)

A write refused because an event's attendance is finalized now reaches the
client as a sentence and a 409 on every route
(`app/api/attendance_lock.py`). Eleven routes sent the internal
`ATTENDANCE_LOCKED::` marker, or replaced a long refusal with a generic error.
Found while fixing that, and left as they are:

- **The legacy `POST /training/sessions/{id}/finalize` can report "Training
  session not found" after the event's finalize has committed** (no approval
  id came back, or the approval row is missing). The route keeps its 400 for
  that rather than a 404, so a caller is not told nothing happened. No screen
  calls the route.

## Events — Edit Form Gaps (2026-10-04)

A finalized event can now be edited: the lock refuses a change to its type,
category, schedule or check-in rules rather than their presence in the save,
and the edit form disables those controls and leaves them out. Found on the
same screen, and left as they are:

- **Saving a draft publishes it.** The edit page does not load `is_draft`, so
  the form starts from its default and every save sends `is_draft: false`.
- **Clearing an optional field does not stick.** A blank description,
  location, location details, RSVP deadline, capacity (max attendees) or
  category is left out of the save rather than sent as `null`, so the stored
  value survives behind a success toast (CLAUDE.md pitfall #1). Choosing
  Category → None is the same no-op.
- **A window-type event stored with no lead time is shown, and saved, as 60
  minutes.** The backend reads a missing lead time on a window-type event as 15,
  so the first save of an open one moves its check-in window. A finalized
  one's check-in rules are locked and left alone.
- **An open event's times are saved at the form's minute precision.** A stored
  start or end with seconds, or one in the hour repeated when clocks fall back,
  can move by those seconds or by an hour on its first save. A finalized
  event's times are locked, never resent, and not checked by the form either.
- **A series save from an open occurrence can be refused for a field nobody
  touched.** "This and all future events" writes the edited occurrence's type,
  category (when it has one) and check-in rules onto every later occurrence,
  and moves every occurrence when the form's restatement of its times, which
  is to the minute, differs from what is stored (a start or end saved with
  seconds). Where a later occurrence is finalized and would change, the save
  is refused and names that field. Edit the later occurrences one at a time
  instead. The category part is new with this change: the form used to show
  every event's category as None and leave it out of the save, so a series
  save never touched it. It now loads the stored category, so a save from an
  open occurrence also writes that category onto later open occurrences that
  had a different one. A save from a finalized occurrence leaves all of these
  fields out and is not affected.
- **Reminder and validation markers an earlier series save copied are still
  there.** Before this change, a "This and all future events" save wrote the
  edited occurrence's `reminders_sent` and `validation_notification_sent` onto
  every later occurrence. It no longer does, and each row now keeps only its own
  markers, but rows already reached keep the copies: those occurrences skip the
  reminder or the post-event validation prompt the copy says was sent. Clearing
  them needs a data migration that tells a copied marker from a sent one by each
  row's schedule, which was left for a decision rather than shipped here.

## Equipment Checks — Basic Apparatus, and Checks Filed Ahead of Their Shift (2026-09-30)

Found driving W46 (`docs/workflow-review/W46-equipment-checks.md`). Each
needs a decision rather than a patch:

- **W46-11 — A check on a basic apparatus is stored with no apparatus.**
  - `submit_check` keeps only a full `apparatus.id` in
    `shift_equipment_checks.apparatus_id`, and its comment still describes the
    foreign key `20260808_0003` dropped. So a department that runs on basic
    apparatus gets "No apparatus data available" under Apparatus Compliance,
    and nothing in the reports' apparatus filters.
  - The fleet board and check log are unaffected: they key by the shift's
    apparatus.
  - A checklist also cannot name a basic apparatus (`equipment_check_templates.apparatus_id`
    is still a foreign key), so such departments write checklists by type.
    Since W46-8 the builder offers only that.
  - The options:
    - store the shift's id as the model now documents, and teach the report
      readers both tables, with a backfill from `shifts` for existing rows;
    - or resolve reports through the shift.
- **W46-12 — A check can be filed before its shift's date and is then invisible
  to officers.**
  - My Checklists offers shifts from today onward, and the server accepts a
    check for any of them.
  - The fleet board and log read shifts dated today or earlier. A failed check
    filed the evening before a morning shift does not appear until the date
    turns.
  - Either refuse checks ahead of the shift, or let the readiness window reach
    the next shift's start.
- **W46-13 — Fail and Out of service carry no required note.** An item marked
  out of service takes the rig off the fleet board with no reason recorded.
  ✅ Resolved 2026-10-04 (#2882): the check form now requires a note on a Fail
  or Out of service the member chose (one a count, reading or expiry already
  explains is exempt) before it submits. The requirement is enforced by the
  form only; the server still accepts a failed item without a note from a
  direct API call.
- **W46-14 — The seeded Quartermaster holds no `inventory.check_*` grant.**
  ✅ Resolved: the owner granted `inventory.check_manage` (authoring only),
  seeded and backfilled by migration `f73b449bdb8b` — see "The seeded
  Quartermaster cannot build equipment checklists" above.

## Elections — Owner Decisions From the W50 Drive (2026-09-30)

Found driving W50 (`docs/workflow-review/W50-elections.md`): two browsers ran
the module end to end with email on, and 41 findings were fixed across
`3de83db`, `d6f828c` and `7aa3405`. These are what is left: each changes
behaviour a department may rely on, needs a migration, or is a product
decision, so it is recorded here rather than patched. The finding named in
each row carries the evidence and the file.

| Item                                                                                                    | Status                                                                                        | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Paper ballots cannot record a vote on a motion or membership item**                                   | 🚩 Open (HIGH, 2026-09-30, workflow review W50-8)                                             | Print Blank Ballots now prints every approval item as "☐ Approve ☐ Deny" (`7aa3405`), but `POST /elections/{id}/manual-ballots` takes candidate ids only, and an item's Approve/Deny rows exist only once an electronic vote has materialised them (W50-30). So a motion decided on paper cannot be keyed in. Either pre-create the option rows per approval item when the election opens, or document paper as positions-only. Candidate-selection items whose position is not in `election.positions` are also still absent from the printout.                                                                                                                          |
| **Certified, published results can be revised after close by merge, void and batch void**               | 🚩 Open (HIGH, 2026-09-30, workflow review W50-9)                                             | S09 refuses renaming or re-positioning a candidate once votes exist (compared by value, so a statement edit still saves). Merge Write-Ins, Void a Vote and a paper-batch void remain allowed after close and after publish, and re-issue the tally silently: in the drive one election went from four co-winners to one and another from a tie to a win, with the certified PDF's integrity line unchanged. These are deliberate corrections, so the choice is between a gate after publish and a "results revised <when> by <who>" mark on the PDF and the panel.                                                                                                        |
| **The in-app Cast Vote tab is not the ballot**                                                          | 🚩 Open (HIGH, 2026-09-30, workflow review W50-10)                                            | `ElectionBallot.tsx` iterates `election.positions` only: ballot items are missing and a multi-seat race is single-select, while the emailed ballot carries the items and "Select up to 2". A member who votes in-app then needs Abstain on the race to get past "You have already voted on: Chief" on the link. Either rebuild the tab on the token page's model, or hide it when the election has items or a cap above 1 and send members to their emailed link (the smaller change, which can ship first). S24 records the email-first ballot as a design decision, not a regression.                                                                                   |
| **A multi-seat race declares one winner**                                                               | 🚩 Open (HIGH, 2026-09-30, workflow review W50-11)                                            | `max_votes_per_position` (API only — the create dialog has no field) lets voters pick two, but the tally has no seat count: "2027 Board of Directors (2 seats)" elected one, and the report read "ELECTED" beside one name. A `seats_per_position` is schema, migration, tally and UI; the alternative is a documented one person per position, with the cap hidden.                                                                                                                                                                                                                                                                                                      |
| **A voter override on a restricted-list election says it lets the member vote, and it does not**        | 🚩 Open (HIGH, 2026-09-30, workflow review W50-13)                                            | With `eligible_voters` set, an override for another member is created, the roster reads "Override", `total_eligible_voters` rises and turnout falls — but the member's vote is still refused "restricted to a specific voter list", and the endpoint's own docstring says overrides do not bypass the list. Decide whether an override extends a restricted list. Either way a non-admitted override should leave the denominator, and its row should say it has no effect.                                                                                                                                                                                               |
| **A draft's test ballot cannot be opened**                                                              | 🚩 Open (MED, 2026-09-30, workflow review W50-19)                                             | Election Settings offers test ballots for drafts only, and the draft test token is sent — `send-ballot` now refuses a draft unless `is_test` (S08's status question, settled that way in `7aa3405`) — but the public lookup refuses every non-open election, so the link answers "Election is draft". Either admit `is_test` tokens on a draft, which gives the officer the preview the settings promise, or offer open elections in the select.                                                                                                                                                                                                                          |
| **Closed early, results are refused to everyone until the scheduled end**                               | 🚩 Open (MED, 2026-09-30, workflow review W50-22)                                             | The results gate needs `now > end_date` even when the election is CLOSED, so the officer who closed it gets 403 seconds after the report mail carrying the same numbers reached them; only Publish lifts it. The report, the certified PDF and the runoff logic already bypass the gate (CLAUDE.md pitfall 29 in miniature). Decide whether CLOSED alone unlocks results for managers. S10 fixed the gate's shape (403 vs 404, the live-tally flag) and holds live.                                                                                                                                                                                                       |
| **The proxy holder is Cc'd a ballot that says the link is the voter's alone**                           | 🚩 Open (MED, 2026-09-30, workflow review W50-23)                                             | Creating a proxy authorization sends nothing; at send time the holder is Cc'd on the delegating member's ballot mail, whose callout reads "This link is yours alone… Don't forward this email" and names no proxy, and the holder's own mail says nothing either. There is no proxy ballot mode (see the 2026-08-12 entry below). If the Cc is the mechanism, the delegator's mail must say who holds the proxy and the holder's copy whose ballot it is. The manual now describes the Cc.                                                                                                                                                                                |
| **The emailed ballot pre-selects Abstain on every item**                                                | 🚩 Open (MED, 2026-09-30, workflow review W50-25)                                             | `BallotVotingPage.tsx` fills the Abstain radio on load under "Make a selection for each item below"; an untouched Submit → Cast burns the single-use link with no votes, and the confirm dialog's "Abstain (No Vote)" per item is the only guard. A product choice between no default (Submit disabled until every item has a choice or an explicit abstain) and stating the default with "You have not voted on N items" at the confirm step.                                                                                                                                                                                                                            |
| **A sanctioned void certifies the election CHAIN_BROKEN**                                               | 🚩 Open (MED, 2026-09-30, workflow review W50-31; folded into ELEC-06 pass 7 as ELEC-45)      | `verify_vote_integrity` drops deleted rows before walking the chain, so an officer's own void — a single vote or a paper batch — shows "Vote Integrity Issue Detected — votes may have been deleted or reordered" and prints CHAIN_BROKEN on the certified PDF under "We certify that the results above are true and correct", while voiding the chain's tail leaves PASS. `7aa3405` stops every forensics read re-logging the critical audit row; the chain design must decide how voids are represented, e.g. walk them and report "PASS — N votes voided by <officer>: <reason>".                                                                                      |
| **A manager can accept a nomination for the nominee, and the slate is not frozen at Close Nominations** | 🚩 Open (MED, 2026-09-30, workflow review W50-38; folded into ELEC-06 pass 7 as ELEC-46)      | `PATCH …/candidates/{id}` accepts `accepted` from any manager with no nominee check and no notice, after the nominator was refused "Only the nominee can respond"; after Close Nominations members lose the tab but the API still accepts and declines, so a race silently lost a candidate. The positions guard is fixed (S17, corrected for item-keyed candidates in `7aa3405`). Decide whether managers may accept on a nominee's behalf (then label it so and notify) and whether the slate freezes at close.                                                                                                                                                         |
| **A ballot item added after tokens were issued never reaches already-sent links**                       | 🚩 Open (MED, 2026-09-30, workflow review W50-47)                                             | The lookup serves the item ids snapshotted when the token was minted, and a rollback to draft leaves tokens live, so a link minted before an item was added shows the old ballot and nothing prompts a resend. Invalidate outstanding tokens when the ballot changes inside a rollback window (with the W50-36 resend banner), or serve the current item list on lookup.                                                                                                                                                                                                                                                                                                  |
| **Members read the recipient list and live counts from the election body**                              | 🚩 Open (LOW, 2026-09-30, workflow review W50-70; folded into ELEC-06 pass 7 as ELEC-44)      | `GET /elections/{id}` gives every `elections.view` holder `email_recipients` and vote counts while `/results` is 403, and the public ballot lookup hands token holders every candidate's `user_id` and `nominated_by`. Probably intended for attendees and recipients; decide whether counts and ids are withheld while the election is open.                                                                                                                                                                                                                                                                                                                             |
| **Auto-open sends no ballots**                                                                          | 🚩 Open (LOW, 2026-09-30, workflow review W50-72)                                             | A scheduled open changes the status only; the department's first ballot mail is then the pre-close reminder, or nothing if reminders are off. Decide whether auto-open should send ballots; otherwise the Features copy should say "Scheduled opening changes the status only — send ballots yourself" (the manual now says so).                                                                                                                                                                                                                                                                                                                                          |
| **A proxy ballot on an anonymous election is attributable**                                             | 🚩 Open (HIGH, 2026-09-30, workflow review W50-2, S01; folded into ELEC-06 pass 7 as ELEC-43) | S01 stopped audit rows naming in-app voters on anonymous elections, but a proxy vote stores `proxy_voter_id` and `proxy_delegating_user_id` on the `Vote` row in clear regardless of `anonymous_voting`, `_sign_vote` covers the delegating id, and forensics is designed to list `vote_id` with the delegating member. Scrubbing the audit row alone changes nothing. Either document that a proxy ballot is attributable and tell the delegating member so when the authorization is created, or store the linkage as a salted hash that dies with the salt at close — a migration plus a signing change on existing rows. No proxy vote can be cast from the UI today. |
| **Audit rows written before S01 still name anonymous in-app voters**                                    | 🚩 Open (MED, 2026-09-30, workflow review W50-2, residual)                                    | `vote_cast` rows written before `3de83db` carry the voter's `user_id` beside `vote_id`, and they cannot be scrubbed without breaking `verify_integrity` — the same shape as the ELEC-6 IP residual above. `7aa3405` removes the other half of the join (`candidate_id` in `deleted_votes` on anonymous elections), so such a row can no longer be paired with a choice through forensics, but a database read still can. The operator should be told that the audit trail of any anonymous election held before the fix names its in-app voters.                                                                                                                          |
| **Votes stored across the deploy on an open ballot-item election can count twice**                      | 🚩 Open (MED, 2026-09-30, workflow review W50-3, S03)                                         | Documented for operators in `docs/UPGRADING.md` — "Close any election that is OPEN before you upgrade (2026-09-30)". In-app rows written before the change carry no `voter_hash` and link rows no `voter_id`, so the two never collide; a backfill of `voter_hash` from `voter_id` is possible only while the election's salt exists, and a closed named election that was double-voted cannot be repaired. Separately, a link vote in a named election stores the hash only, so the roster of who voted cannot name link voters — resolving `voter_id` on the token path for named elections (or a `user_id` on the token, a migration) is a product call.               |
| **A multi-item ballot's `overall_results` pools every item into one contest**                           | 🚩 Open (MED, 2026-09-30, workflow review W50-7, S04)                                         | S04 reads each item's own victory condition and S05 reports per-item results with a label, but the pooled `overall_results` list — the one the results screen renders when `results_by_position` is empty, i.e. every general-vote ballot — still ranks one motion's Approve against another's Deny for a single winner, with percentages over the whole ballot. Grouping per item fixes that but changes the response shape and what the certified PDF and the runoff tie detector see for a ballot-item election; the owner decides whether to take that scope.                                                                                                         |

## Minutes — Owner Decisions From the W51 Drive (2026-10-03)

Found driving W51 (`docs/workflow-review/W51-minutes.md`).

- **W51-4 — Executive, Trustee and Annual meetings cannot be recorded.**
  - Minutes support eight meeting types, but a meeting record
    (`meetings.meeting_type`, a MySQL ENUM) accepts five.
  - The Minutes page now offers only those five instead of failing with a 422.
    So a closed executive session cannot be recorded through the UI at all,
    although the minutes side, and its member restriction on executive
    minutes, exists.
  - Recording one needs a migration widening the ENUM, and a mapping for the
    three types in `MinuteService.create_from_meeting`. Until that mapping
    exists, an executive meeting's minutes would be typed "business", which
    members can read.
- **W51-8 — Minutes created from meetings before 2026-10-03 carry a shifted
  date.**
  - `create_from_meeting` read the meeting's local date and time as UTC. A
    meeting with no start time is therefore dated the evening before, and
    one at 7:00 PM is shown at 2:00 PM. New minutes are correct.
  - The linked `meeting_id` would let a backfill recompute the date, but it
    cannot tell a shifted value from one a secretary has since corrected by
    hand.
  - Options: a backfill that changes only rows still equal to the old
    UTC-combined value (which spares hand corrections), with a dry run; or
    leaving the old rows and noting it.

## Action Items — Who Is Assigned, and Who Closes (2026-10-04)

Found driving W52 (`docs/workflow-review/W52-action-items.md`).

- **W52-6 — Nothing can be assigned to a member.**
  - The only screen that creates action items, the minutes page, takes a typed
    assignee name. `minutes_action_items.assignee_id` stays empty, so the
    Action Items page's "Assigned to me" never matches anything created there.
  - Meeting action items, which do carry a user (`assigned_to`), have no
    screen at all.
  - The fix is a member picker on the minutes form, setting `assignee_id`
    alongside the name. Decide who may be assigned, and whether items already
    assigned by name should be matched to members.
- **W52-7 — An assignee cannot close their own item.**
  - Every action-item update needs `minutes.manage`, so a member assigned an
    item can neither mark it in progress nor done. The secretary closes it for
    them.
  - One option: let the assignee change only status and completion notes, keyed
    on `assignee_id`, which depends on W52-6. It widens a write permission, so
    it is the owner's decision.

## Documents — Folders Cannot Be Restricted or Managed From the Screen (2026-10-04)

Found driving W53 (`docs/workflow-review/W53-documents.md`, W53-4).

- **What the screen offers:** Create Folder takes a name and a description,
  so every folder made there is visible to all members. Nothing on the screen
  renames, moves or deletes a folder.
- **What the API already supports:**
  - restricting a folder: `PATCH /documents/folders/{id}` with `visibility`,
    `allowed_roles` or `required_permissions`;
  - moving one: `parent_id`;
  - deleting one: `DELETE /documents/folders/{id}`.
- **The result:** a department cannot create its own leadership-only folder,
  or tidy a misnamed one, without the API.
- **Decisions needed before building it:**
  - which visibility options to offer (leadership, owner, roles);
  - what deleting a non-empty folder does;
  - whether system folders may be renamed or moved.

## Legal Documents — History, Attribution and Formatting Gaps (2026-10-04)

Found driving W54 (`docs/workflow-review/W54-org-chart-and-legal.md`, W54-3 to
W54-5). Publishing, reverting and the permission split all work; these three
need an owner decision before anything is built.

- **W54-3 — A revert leaves no trace on the screen.** After "Revert to the
  built-in text", the published history reads "Replaced — published by …" and
  stops. Nothing says when the built-in text came back, or who restored it;
  only the audit log knows. So the history cannot do what the page says it is
  for: show what members saw on a given date. Fixing it needs a revert row or
  "replaced at / replaced by" columns, which is a migration.
- **W54-4 — Edits to someone else's proposal are not attributed.** A
  publisher may edit any draft. The card keeps "Sam Ortiz proposed this" with
  no sign of the edit, and the published history names only the publisher.
  - Option: an "edited by" column.
  - Option: publishers comment on a proposal rather than editing it.
- **W54-5 — Department text is plain paragraphs only.** A proposal starts
  from the built-in text flattened to plain text, and `/privacy` renders
  department text as paragraphs only. So headings become capitalised
  paragraphs and lists become lines starting with "- ". This is by design: no
  markup reaches a public page. The decision is whether to support a small,
  safe set (headings, lists) so that adapting the built-in text does not make
  the page look worse.

## Events — Files Cannot Be Attached From the App (2026-09-30)

`POST /api/v1/events/{id}/attachments` (`events.manage`) accepts a file, and
the event detail page lists and downloads whatever is attached — but no screen
uploads one. `eventService.uploadAttachment` has no caller, and there is no
upload control anywhere in the events UI. Until 2026-09-29 the event form's
attachments note promised uploads from the detail page; it now says "Files
can't be attached from the app yet." A department that needs a file on an event
attaches it through the API. Building the control, or dropping the endpoint, is
an owner decision.

## Inventory — NFC Tags and Items Not Seen: Open Decisions (2026-09-30)

Workflow review W44 (`docs/workflow-review/W44-nfc.md`) and the NFC design left
these for the owner. None is a defect in the sense of code doing something it
was not meant to; each is a definition or a trade-off.

- **A new item reads "Never" and sorts first on Items Not Seen (W44-2).**
  Creating or importing an item is not treated as seeing it, so an import made
  an hour ago heads the report. That is deliberate — a new item nobody has
  handled is still unaccounted for — but whether creation should count is
  undecided.
- **Tag Items in Bulk cannot tell apart two items with the same name (W44-3).**
  The tagging card shows name, serial, asset tag, category and storage area.
  Two items that share a name and have neither serial nor asset tag look
  identical, because the untagged-items response does not carry the barcode
  every item has.
- **Items Not Seen still names a deleted storage area (W44-4)**, while the
  item's own page shows "--" for the same link.
- **A barcode put-away is not a sighting.** It is recorded only as an audit
  event with no per-item row, so it neither counts as seeing an item on Items
  Not Seen nor appears in its **Last seen** column. An NFC put-away does both.
- **An unlocked written tag can be rewritten by anyone with an NFC app.**
  Inside the app a rewritten tag is ignored, because a tag pointing anywhere but
  the department's own site is refused. From a phone's home screen, though, it
  could open a different website. The mitigation is the department's: lock
  tags in public view after writing (permanent), or link them by serial rather
  than by a written link. See `wiki/Inventory-NFC-Tags.md` → _Looking after
  tags_.

## Member Emails — An Opted-Out Officer or Nominee Hears Nothing for Email-Only Alerts (2026-09-30)

**Open (owner decision).** Since 2026-09-28 every member email is either always
sent or optional (`app/services/email_policy.py`), and a member's **Email
Notifications** switch, or their own switch for one optional email, stops it.
For most optional emails the in-app entry still arrives. For these it does not,
because they have no in-app copy:

- **Quartermaster duties** — low-stock, shelf-audit digest, gear due for
  retirement, supplies expiring, and failed equipment checks. The conditions
  still show on the Inventory screens, but nothing tells an opted-out officer
  to look.
- **The third-party nominee's accept-or-decline email** (`_notify_nominee`,
  under **Election notices**). A nominee who has opted out is never told they
  must accept before nominations close; the pending nomination shows only on
  the election page.
- **Membership and store administration** — if every officer opts out, nobody
  is told a member was archived or an applicant withdrew.

There is also no administrator view of which members have opted out of what.
Options: make these kinds required by default, give them in-app copies, or rely
on each department switching on **Require for every member** for them under
**Administration → Forms & Comms → Member Emails & Texts** (`settings.manage`
or `organization.update_settings`).

## Shift Reports — "Your Reporting Summary" Counts the Whole Department (2026-09-30)

An officer's **Written by me** view on **Scheduling → Shift Reports** opens with
a card headed **Your reporting summary** — **Reports written**, **Shift hours
covered**, **Calls covered**, the crew summary and **Reports written per
month**. Its figures come from `GET /training/shift-reports/officer-analytics`,
which totals every report in the organization, not only the viewer's. The list
below the card is the viewer's own. Either scope the endpoint to the officer or
retitle the card; until then an officer in a department with several report
writers reads the department's numbers as their own.

## AP2-4 — The EVOC Driver Gate Stops Enforcing On A Deleted Apparatus (2026-10-05)

`EvocLevelService.check_driver_evoc_eligibility` answers "may this member drive
this apparatus?" and returns **eligible** both when the apparatus carries no EVOC
requirement and when the apparatus cannot be found at all — one condition covered
both cases.

That second case is reachable through ordinary use, with no attacker.
`shifts.apparatus_id` is declared `Column(String(36))  # Link to apparatus
(future)` with **no foreign key** (`backend/app/models/training.py:2954`), and
`ApparatusService.delete_apparatus` is a hard delete. Retiring an engine
therefore leaves every shift that referenced it pointing at a row that no longer
exists; `shift_eligibility_service.py:1292` passes that id to the gate, the
lookup returns nothing, and any member can be seated in the driver's seat of
those shifts with the EVOC requirement silently unenforced and no warning shown.

**What was done (app-review B2 pass 5):** the two cases are now distinct code
paths and the unresolvable one logs a warning naming the apparatus, the
organization and the member, so the failure is diagnosable. **The gate's answer
was deliberately left unchanged**, because changing it is a safety-gate behavior
change: a department holding dangling references would begin seeing EVOC
warnings — or hard blocks, depending on its enforcement setting — on every
affected shift the moment it deployed.

**The decision:**

1. **Fail closed** — return ineligible with a "could not resolve this apparatus"
   warning. Correct per CLAUDE.md pitfall #14 ("fail closed in access-control
   helpers"), and surfaces broken scheduling data loudly rather than quietly
   passing everyone.
2. **Fix the data path instead** — give `shifts.apparatus_id` a real foreign key
   with `ondelete="SET NULL"` (and therefore `nullable=True`, pitfall #2), so
   deleting an apparatus clears the reference and the shift genuinely has no EVOC
   requirement. This is the better fix and the more invasive one: it needs a
   migration, and a decision about the other `apparatus_id` columns that
   deliberately match the unconstrained shape
   (`call_tracking.py:221`, `training.py:4618`).

Either way the gate stops depending on a reference nothing maintains. Until one
is chosen, the log line is the only signal.

## Process

## OPS-7 — Audit Shipping Can Deliver A Batch Twice (2026-10-04)

`audit_ship_service._get_or_create_state` reads the shipping watermark with
`SELECT ... FOR UPDATE`, added by the security review (SEC2-28-9) because this
task runs both on a schedule and via the manual
`/scheduled/run-task?task=audit_log_ship` trigger, so two runs can overlap. The
lock does what it was added for: the second run blocks until the first commits
and so starts from an advanced watermark rather than the same one.

It does not, however, serialize a _run_. `ship_new_audit_logs` commits after
**each** acknowledged batch — deliberately, so a failure mid-run never
re-ships rows the collector already confirmed — and committing is also what
releases the row lock. So two concurrent runs are serialized for their first
batch only; past that both proceed from the watermark as it stood after batch
one and can deliver the same later batches twice. `expire_on_commit=False` on
the session (set in `core/database.py`) means neither run's in-memory `state`
ever notices the other's commits, so they diverge for the rest of the run,
up to `_MAX_BATCHES_PER_RUN` (20) batches each.

**What it costs, and what it does not.** No audit row is lost or skipped — the
watermark only ever moves forward, and every row past it is re-queried — so
this is an at-least-once delivery property, not a gap in the off-host copy the
control exists to provide. The collector is handed `X-Logbook-First-Id` and
`X-Logbook-Last-Id` on every request precisely so it can deduplicate. A SIEM
that does not dedupe would double-count entries for the overlapping batches.

**Why it is here rather than fixed.** The two goals genuinely conflict:
durable per-batch progress requires committing, and holding an exclusive claim
for a whole run requires not committing. Resolving it means a run-scoped claim
rather than a row lock — the shape `core/background_claim.py` already provides
for the scheduler loops (CRON-40) — which is a design change to a task that
ships every organization's audit trail, not a drive-by. The in-code comment now
states the real boundary of the lock rather than the one the fix was described
as providing.

## OPS-8 — Recording A Payment Against Your Own Dues Has No Separation Guard (2026-10-04)

`FinanceService.record_dues_payment` accepts a `recorded_by` and appends to the
dues ledger, re-deriving the member's paid total — a money settlement. It does
**not** call `assert_different_person`, so a `finance.manage` holder can record
a payment against their own dues with no second person involved.

Three things make this a real asymmetry rather than a judgement call about
scope:

- **Its exact analogue is guarded.** `StorefrontService.record_payment` carries
  the check, with a comment explaining that it belongs on the shared engine
  rather than the wrapper because the engine is also reachable directly
  (`POST /orders/{id}/payments`) — the SF-6 finding. Dues payment recording is
  the same shape and has no such guard.
- **Its sibling on the same record is guarded.** `waive_dues` compares
  `waived_by` against `dues.user_id` and refuses. So waiving your own dues is
  blocked while recording a payment on them is not.
- **The exemption mechanism already exists.** `assert_different_person` no-ops
  when either id is missing, and `recorded_by` is `Optional`, so an
  out-of-band/reconciliation path would pass through untouched exactly as the
  storefront's `actor_id=None` path does.

`tests/test_money_separation_of_duties.py` reflects the gap: it asserts a
member cannot waive their own dues and has no case for recording a payment on
them.

**Why it is here rather than fixed.** It changes a money workflow, and the
operational cost is the one OPS-1 already recorded for admin hours: a treasurer
paying their own dues in cash at a meeting would no longer be able to record
it, and in a single-officer department nobody else can. The owner's 2026-08-09
decision chose option (a) — block self-dealing — for an enumerated set of paths
that did not include this one, so extending it is a decision rather than a
correction. The fix itself is one line mirroring the storefront call:

```python
assert_different_person(
    recorded_by, dues.user_id, action="record a payment on", record="dues"
)
```

## LOC-37 — A Room Tag Tapped With An Expired Session Loses The Room (2026-10-04)

`/locations/:locationId/check-in` is where a room's NFC sticker lands a member's
phone. It is the **only route in the app entered cold from a physical object**
rather than from inside a live session, which makes it both the likeliest to be
hit with no valid session and the worst at handling it.

The route carries no `ProtectedRoute`
(`frontend/src/modules/facilities/routes.tsx`). So a member whose session has
expired renders the page, which calls `GET /locations/{id}/display`, receives a
401, and is hard-redirected by `handleExpiredSession`
(`frontend/src/services/apiClient.ts:207`) via
`window.location.href = '/login'`. That is a full page load carrying **no
`state.from`**, so `postLoginRedirect` falls through to its default and the
member arrives at the dashboard. To check in they must walk back to the door and
tap the sticker again.

The machinery to do this correctly already exists and is used everywhere else:
`ProtectedRoute` redirects with `<Navigate to="/login" state={{ from: location }} replace />`,
and `postLoginRedirect` reads that, validates it against open-redirect, and
returns `pathname + search + hash`. This route simply never reaches it.

**Why it is here rather than fixed.** The obvious fix is to wrap the route in a
bare `<ProtectedRoute>`, which gates on authentication alone and so preserves
the route's documented intent exactly — no module gate, no permission gate,
because a room tag must work in Locations mode as well as Facilities mode and
any member may check in. But `/events/:id/check-in`, which this page forwards to,
is ungated in precisely the same way. So this is a convention shared by both
check-in landing pages rather than a one-route slip, and the fix belongs to both
at once. It is also a change to the session/redirect flow, which this
repository's standing instructions put behind an explicit confirmation.

**Bounded.** Nothing is exposed and nothing errors — the endpoint's own auth
dependency is what actually protects the data, and it holds. The cost is a
member standing at a door, sent to a dashboard, with no indication that tapping
again after signing in is what they need to do.

## LOC-40 / LOC-41 — Two Locations Decisions Left Open (2026-10-04)

- **LOC-40 — the display capability exists twice, and both copies are now
  live.** Pass 2 of the application review said to delete the dead
  authenticated `GET /locations/{id}/display` or give it a caller; it got a
  caller (`RoomCheckInPage`). `LocationDisplayInfo` has six fields and its two
  producers fill different subsets: `public/display.py` computes `is_valid` via
  `_validate_check_in_window` and populates `timezone`,
  `badge_check_in_enabled` and `allow_guest_check_in`, while `locations.py`
  hardcodes `is_valid`/`can_check_in` to `True` and leaves the rest at their
  defaults. Nothing is broken — every omission defaults to the safe value and
  the one caller reads none of them — but the ~20 lines of `QRCheckInData`
  construction are near-identical between the two, which is exactly how LOC-1
  (a drifted check-in window) happened the first time. Consolidating onto one
  builder is the right answer and is not a safe drive-by: the two differ
  _deliberately_ in `is_valid`, because the authenticated endpoint's selection
  query has already applied the stricter window while the public one computes
  the permissive check, so a shared builder needs that as a parameter and the
  blast radius includes a public kiosk endpoint.
- **LOC-41 — (name, building) uniqueness for locations has no database
  constraint behind it.** `Location.__table_args__` declares four plain
  indexes and no `UniqueConstraint`, so the rule lives only in
  `LocationService.create_location` / `update_location` as a read-then-write
  with no lock — two concurrent creates can both pass it. Pass 3 capped both
  checks with `.limit(1)` so a duplicate pair can no longer turn every later
  write of that name into a 500, but the duplicates themselves remain possible.
  Adding the constraint is a decision rather than a chore for two reasons:
  MySQL permits repeated NULLs in a unique index, so `UNIQUE (organization_id,
name, building)` would not stop duplicates where `building IS NULL` — which
  is precisely the case the application check handles with an explicit `IS NULL`
  branch — and existing installations may already hold duplicate pairs that a
  migration would have to surface and resolve before the constraint could be
  created.

## MS2-7 — A Lapsing Waiver Is Counted As Expiring Soon But Never Listed (2026-10-05)

Medical screening defines "expiring soon" in two places, and they disagree about
a **waived** screening.

`MedicalScreeningService.get_compliance_status` treats `PASSED`, `COMPLETED` and
`WAIVED` as satisfying a requirement, so a waived screening whose expiration
date falls inside the 30-day window increments `expiring_soon_count`.
`get_expiring_soon` — the list that count links to — filters status to `PASSED`
and `COMPLETED` only, so it never returns one. A waiver about to lapse is
therefore counted on the summary and absent from the list, with nothing on
either screen to explain the difference.

(The other divergence between the same two methods — a screening expiring
_today_ was listed but not counted — was fixed as MS2-6 in the same pass, with
a comment at both sites naming the other.)

**Why it is here rather than fixed.** Either reading is defensible and they lead
to opposite one-line changes:

- **List it.** A waiver that is about to lapse is real work coming: somebody has
  to either renew the waiver or get the member screened, and the expiring list
  is where that work is surfaced.
- **Stop counting it.** A waiver is an administrative exemption rather than a
  screening, so it arguably does not belong on a list of _screenings_ coming
  due, and the count should match the list by excluding it.

Only the owner can pick, and this is a PHI-adjacent compliance surface where
guessing changes what a chief is told about a member. Once picked, the right
shape is CLAUDE.md Pitfall #29's: extract the window-and-status predicate so
there is a single definition and the other call site is a projection of it,
rather than editing whichever of the two is being looked at — which is how the
pair drifted apart twice.

## DASH-37 — Dashboard Tiles Promise A Filter They Do Not Apply (2026-10-04)

Every asset-widget tile renders `aria-label="{title}: {count}. Open filtered
results"` and, when its count is non-zero, a body line reading "View filtered
results" (`frontend/src/components/dashboard/AssetWidgetRegistry.tsx:36,53`).
The `href` carries the filter as a query string. **Of the 16 parameterised
navigation targets `backend/app/api/v1/endpoints/dashboard.py` serves, 13 land
on a page that ignores the parameter**, so the user arrives at an unfiltered
list and has to re-find the rows the tile just counted.

The three that work:

| Target                                           | Honoured by                             |
| ------------------------------------------------ | --------------------------------------- |
| `/facilities/maintenance?status=overdue`         | `MaintenanceListPage` reads `status`    |
| `/inventory/checklists/log?status=…&submitted=1` | `CheckLogPage` reads both               |
| `/training/admin?page=…&tab=…`                   | the canonical administration-hub target |

The thirteen that do not: `ApparatusListPage`, `InspectionsListPage`,
`FacilitiesDashboard`, `InventoryCheckoutsPage`, `ActionItemsPage`,
`EventsPage`, `Members` and `AdminHoursManagePage` never call
`useSearchParams`; `InventoryItemsPage` reads `vendor_id` and `item_type` but
not `stock`; `NotificationsPage` reads `tab` but not `status`.

Telling: the two honoured targets are exactly the two whose hrefs carry an
explanatory comment in `dashboard.py`. The rest were written as if the
destination pages already filtered.

**Why it is here rather than fixed.** It is page work across eight components,
and each one needs a product decision about which of its filters are
addressable by URL — which is also the decision Scheduling's settings sections
turned on (CLAUDE.md, "How a section is addressed differs, deliberately"). The
announcement is separately wrong on an informational tile such as
`inventory-summary`, where a department's total item count has nothing to
filter and the alert-triangle affordance should not appear at all.

**Bounded, not harmless.** Nothing is disclosed and nothing errors; the cost is
that a chief who taps "Unresolved defects: 4" gets the whole fleet and must
find the four. The dead _paths_ in the same family were fixed (DASH-30, pass 3)
and are now held by `frontend/src/routeIntegrity.test.ts`, which walks the
backend modules that build navigation targets as response data. That check
proves a path resolves; proving a _parameter is read_ needs route-to-component
resolution and is not attempted.

**Related, and the same shape one layer up:** the `DASH-1` entry above records
seven of eight `widgetRegistry.ts` `aggregatePath` values that resolve to no
mounted route. Server-supplied and registry-declared navigation targets have
both drifted from the routes they name, for the same reason — nothing in the
type system connects either to a `path=` string.

## DASH-38 / DASH-39 / DASH-40 — Three Smaller Dashboard Decisions (2026-10-04)

- **DASH-38 — no apparatus maintenance page.** `/apparatus/maintenance` is an
  API path with a full CRUD surface (`apparatus/maintenance`,
  `apparatus/maintenance/due`, `apparatus/maintenance-types`) and no route
  behind it. The `apparatus-maintenance` tile counted `maintenance_due_soon`
  and pointed there, so it bounced off the catch-all; pass 3 retargeted it to
  the fleet board, which surfaces the same tallies in its summary strip. Either
  build the page or fold the figure in explicitly.
- **DASH-39 — no genuine upcoming-facility-maintenance figure.** Pass 3 removed
  a `facilities-maintenance` tile that re-rendered its neighbour's overdue count
  (DASH-31). Restoring the concept needs a `due_date > today AND <= today + 30`
  query **and** a `due` value accepted by `MaintenanceListPage`'s
  `all | pending | completed | overdue` filter. The apparatus block is the model.
- **DASH-40 — `/dashboard/action-items` is unpaginated.** It returns every
  matching action item in the organization from both sources, merged and sorted
  in Python, with no `limit`/`offset` and no cap. `ActionItemSummary` carries
  free-text `description`, so the payload grows with the content rather than
  just the row count; a department with years of minutes sends the lot on every
  dashboard load.

The review loop (see [review-log.md](./review-log.md)) advances through one area
per tick and appends findings. New "needs owner decision" items should be
mirrored here so they're visible outside the log. The parallel module-by-module
security audit tracks its rotation and per-module findings under
[`docs/module-audit/`](./module-audit/PROGRESS.md); its open decisions are
mirrored in the Multi-Tenant Isolation section above.
