# Known Limitations & Open Decisions

## Members — Class, Status, Tiers and Committees (2026-10-29)

The member standing rework (class and status as two controls, tiers as
statuses, committee positions) leaves these for the owner:

- **A tier member's missing class is not guessed.** Members moved onto a
  department tier before `member_class` existed carry no class. Migration
  `c4d7e2a91b60` settles their status to the tier and leaves the class NULL
  (owner decision 2026-10-29: flag, do not guess). They show **Not set** on the
  profile and under the roster's **Class not set** filter, and are treated as
  neither operational nor administrative until an officer sets the class.
- **The shipped Senior tier counts as nothing until set.** `ranks_as` is left
  unset on upgrade so no ballot's electorate widens without a decision; a
  department whose bylaws treat senior members as regular members sets
  **Counts as** on the tier by hand.
- **Tier benefits still resolve by the legacy field.** Voting eligibility,
  the office-holding right and training exemption are looked up by
  `membership_type == tier.id`, which for an operational member on a tier is
  the tier id, but for an administrative or social member is the class word.
  An administrative life member therefore does not receive the Life tier's
  training exemption through the tier. The readers (election service,
  training service, events, attendance dashboard, service history) should move
  to `MembershipTierService.tier_for_status(tiers, member_status)`; not done
  here to keep the change set to one model change.
- **The pipeline's conversion outcomes are built-in statuses only.** The
  applicant conversion dialog offers the seven built-in statuses, not the
  department's tiers; a converted member who should start on a custom tier is
  moved there from the edit page.
- **The baseline Member position is no longer shown on the profile chips.**
  It is of kind `system`, held by everyone, and the profile now lists offices
  and committees; the members admin hub still shows it where it can be
  removed from an archived member.

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

| Item                                                                                                                                                                                                                                                                                                  | Status                                                                                                                                   | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Several `config.py` settings have no reader anywhere in the backend**                                                                                                                                                                                                                               | ✅ Resolved (owner decision 2026-10-08: delete the dead settings; security review CI3-33-4)                                              | `RATE_LIMIT_PER_MINUTE`, `MAX_FILE_SIZE`, `STORAGE_TYPE`, `UPLOAD_DIR` and `DB_POOL_MIN` were declared in `app/core/config.py` and documented, but nothing read them: the per-scope rate limits are fixed in `security_middleware.py` (`RATE_LIMIT_DEFAULT` is the tunable one), every upload writer uses its own path under `/app/uploads`, and only `DB_POOL_MAX` reaches `create_async_engine`. **Resolved 2026-10-08:** the five fields are deleted and listed in `RETIRED_SETTINGS`, so a `.env` that still names one boots, ignores it and logs a warning asking for the line to be removed (pydantic-settings would otherwise refuse the unknown key). They are gone from the three Compose `environment:` blocks, `.env.example.full`, the Unraid templates and the wiki. `LDAP_*` remains a separate, documented case. See `docs/security-review/CI3-33-core-infra.md` (CI3-33-4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **A failed public-portal authentication is never recorded, so its anomaly detector cannot fire**                                                                                                                                                                                                      | ✅ Resolved (owner decision 2026-10-11: nullable org/config, log every 401, unattributable rows platform-only)                           | `detect_anomalies` counts `public_portal_access_log` rows with `status_code == 401` per IP, but nothing wrote one: `authenticate_api_key` raises its 401 from the dependency, and an unknown key could not be filed under any organization while `organization_id`/`config_id` were NOT NULL. (The 429 half was recorded from 2026-09-24.) **Resolved 2026-10-11:** migration `e6d21e605d99` makes both columns nullable (downgrade deletes the platform-level rows, then restores NOT NULL). `authenticate_api_key` now writes and commits a 401 row for every refusal — no key, an unknown key, a revoked key, an expired key — through `_log_refusal`, which first runs the detector so the attempt that crosses its threshold (more than five failures from one IP in five minutes) is itself flagged. A key that was found but refused is attributed to its own department; one that matches no stored key is written with no organization and no config, and is **platform-level**: every per-organization reader (the Access Logs tab, the usage statistics) filters on `organization_id`, so no department sees it, while the detector, which counts by IP across the table, does. There is no platform-operator screen for these rows; they are read from the database or through the detector's flags in the server log. **Retention resolved 2026-10-12 (owner decision: a daily task deletes rows older than 90 days, successful and failed alike):** nothing had pruned `public_portal_access_log`, and writing every 401 made it grow with failed traffic too. The daily `prune_public_portal_access_log` scheduled task now deletes every row older than `PUBLIC_PORTAL_ACCESS_LOG_RETENTION_DAYS` (90), platform-level rows included, in batches of 1,000 committed one at a time. The detector and the usage tiles look back at most 30 days, so they are unaffected; the Access Logs tab and the all-time usage figures now cover 90 days (`docs/UPGRADING.md`, `tests/test_prune_public_portal_access_log.py`). Tested in `tests/test_public_portal_failed_auth_logging.py`, including the migration against a scratch table. See `docs/security-review/PUB-03-public-surface-webhooks.md` (PUB-8).                                                                                                                                                                                               |
| **A member's phone and mobile are free text, and any text counts as "a number on file"**                                                                                                                                                                                                              | ✅ Resolved (owner decision 2026-10-05: lenient validation on new writes only, existing rows untouched; workflow review W04-7)           | Member phone and mobile now accept digits, spaces, dashes, dots, brackets, a leading `+` and an extension (`ext 4`, `x4`, `#4`), with 7–15 digits before the extension (`app/utils/phone_numbers.py`). Creating a member refuses anything else (`422`); `PATCH /users/{id}/contact-info` and `PATCH /users/{id}/profile` refuse a changed value that fails (`400`, naming the field) and pass one sent back unchanged, so a member whose stored number predates the rule can still save the rest of their profile. Stored values were not rewritten, so the Notifications tab's `hasMobileOnFile` can still count a legacy non-number as a mobile on file until it is edited. (`tests/test_member_phone_validation.py`.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Two positions can share a name, and nothing tells them apart where they are assigned**                                                                                                                                                                                                              | ✅ Resolved (owner decision 2026-10-05: refuse duplicates on create/rename, existing duplicates left and flagged; workflow review W05-5) | Creating, cloning or renaming a position to a name another position in the organization already uses — compared trimmed and case-insensitively — is refused with `409` (`RoleManagementService._assert_position_name_free`, which locks the organization row so two concurrent creates cannot both pass). Positions that already share a name are not touched: saving one without renaming it still works, and Role Management marks each with **Same name as another position** and its internal name (slug) so an administrator can rename one apart. No unique index or migration, because existing duplicates would block it. Onboarding's position setup writes its own rows and is not covered. (`tests/test_position_name_uniqueness.py`.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Add Member cannot set a new member's account status or preferred contact method**                                                                                                                                                                                                                   | ✅ Resolved (owner decision 2026-10-05: add status to the create endpoint as a new optional field; workflow review W08-1)                | `POST /users` takes an optional `status` — `active` (the default when omitted), `inactive` or `leave` — and creates the member with it. Dropped, retired, archived and suspended are refused at create, because the status change is what records their service history and property return. Add Member offers Active / Inactive / On Leave again and sends the choice. Preferred contact method is still not recorded: the owner chose the status-only option, so there is no field and the form offers no control for it. (`tests/test_add_member_initial_status.py`, `AddMember.test.tsx`.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **A member's base Member position can be removed like any other**                                                                                                                                                                                                                                     | ✅ Resolved (owner decision 2026-10-05: refuse unless the member is archived; workflow review W11-9)                                     | The base `member` position carries the baseline grants every member needs, so taking it off a member who is not archived is now refused with `400` on both write paths — the single removal and the replace-all assignment the admin screens use (`_refuse_base_position_removal` in `users.py`). Manage Roles no longer offers the remove control on it and keeps its box ticked and locked; an archived member's can still be removed. (`tests/test_base_member_position_removal.py`, `MembersAdminPage.test.tsx`.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **A waiver cannot excuse meetings without also excusing shifts**                                                                                                                                                                                                                                      | Accepted by the owner (2026-10-05; workflow review W13-5)                                                                                | Waiver Management offered "Meeting Attendance" and "Shift Requirements" as separate choices, and either one created the same leave of absence — `member_leaves_of_absence` has no field saying which it covers, and scheduling, attendance and tier grading all treat a leave as excusing both. The form now offers one "Meeting Attendance & Shift Requirements" choice, which is what the data has always meant (W13-1). **Accepted by the owner (2026-10-05): one combined waiver stays.** The UI already states the combined meaning, no department has asked to excuse one without the other, and the split would need a column, a migration and a change to every reader of leaves. Revisit if a department asks for it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **A departure clearance cannot be worked or completed from any screen**                                                                                                                                                                                                                               | ✅ Resolved (2026-10-11, owner decision: build the clearance record screen)                                                              | A member dropped while holding property gets a departure clearance, and only `POST /inventory/clearances/{id}/items/{line}/resolve` and `…/complete` close one; no screen called either, so the clearance stayed `initiated` and the member was never auto-archived. **Built:** `/inventory/admin/clearances/:clearanceId` (`DepartureClearancePage`) lists each line with its disposition, resolves a line as Returned, Returned damaged (with the return condition), Written off or Waived, and completes the clearance or — with items still outstanding — closes it incomplete after a confirmation stating how many items and how much value stay unresolved. The hub's **Unresolved departure clearance** row now opens it. `GET /inventory/clearances/{id}` returns `member_name`. Returning an item the ordinary way on **Members** still does not resolve its clearance line — the line is resolved on the clearance, which performs the return itself. Initiating a clearance by hand still has no button; the drop creates one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **A member dropped today cannot be reinstated until tomorrow**                                                                                                                                                                                                                                        | ✅ Resolved (owner decision 2026-10-05: an undo-drop action; workflow review W15-3)                                                      | `record_rejoin` still refuses a return date on or before the last day of service, by design. A mistaken drop is now undone instead: `POST /users/{id}/undo-drop` (`members.manage`) restores the member — Active by default, or Probationary, Inactive or On Leave; never Suspended — and reopens the service stint the drop closed, so their service runs on unbroken. It is available for **7 days** after the drop — counted from the drop's effective date (the end of the stint it closed), not the day it was recorded, and never later than the recording (2026-10-16) — (`UNDO_DROP_WINDOW_DAYS`; `GET /users/{id}/undo-drop` reports whether and until when), because after that it would erase a real gap; a member who really left and came back is a rejoin. The property return report and any departure clearance the drop created are left for the quartermaster. The profile's Status area offers the control while it is available. (`tests/test_undo_member_drop.py`, `UndoDropControl.test.tsx`.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Departed members are listed in every member's directory**                                                                                                                                                                                                                                           | ✅ Resolved (owner decision 2026-10-05: hide archived from non-managers, default filter Active; workflow review W15-4)                   | A member without `members.manage` is served the directory from `GET /users/directory`, which now leaves archived (departed) members out, and their Members page opens on the **Active** filter (**All Statuses** still shows inactive, on-leave and retired members). Coordinators keep the whole roster, archived included, from `GET /users`, which is unchanged for its other callers — so archived members still appear in other screens' member pickers that read it. (`tests/test_member_directory_endpoint.py`, `Members.test.tsx`.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Staff can read every applicant's status-page token from the label preview, and a printed applicant label carries it**                                                                                                                                                                               | ✅ Resolved (2026-09-28, workflow review W17-3)                                                                                          | Resolved at the owner's direction: applicant labels now print the short record id (`_short_id(id)`), like other modules, and the label preview no longer returns the status token. **Still open:** labels printed before this change carry live tokens. Revoking them means rotating every applicant's `status_token`, which breaks every status link already emailed; that was not done. A department that has printed applicant labels and is concerned about them can ask for a rotation, which is a separate decision. **Rotation built (2026-10-11), as the owner chose — per department, on request:** `backend/scripts/rotate_applicant_status_tokens.py --org <id or exact name> [--apply]` gives every applicant in that one department a fresh token (dry run by default, one audit event with the count). It breaks every status link already emailed to that department, and re-sends nothing; departments that do not ask keep their links.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Recurring series stored before the W18 fixes are not repaired: some sit an hour off, on the wrong day, or collapsed onto one date**                                                                                                                                                                 | ✅ Resolved (2026-10-11, workflow review W18-3) — by report, not repair                                                                  | Resolved as the owner chose — report only, officers fix by hand: `backend/scripts/report_recurring_series_drift.py [--org …] [--include-past] [--all-differences]` writes nothing and lists, per series, occurrences 1 hour or 1 day off the date the parent's stored pattern gives under the fixed generator (stored vs expected, with RSVP counts), and series collapsed onto one start with the pattern dates no occurrence holds. **Still true:** no stored series is changed; a deliberate move of exactly an hour or a day is listed too, and the officer decides. Original finding: Two defects fixed in W18 wrote wrong occurrence times, and the fix corrects new series and later edits only. (1) `_generate_recurrence_dates` stepped the stored UTC instant, so a series spanning a daylight-saving change is an hour off after it, and an evening series with custom weekdays, an Nth-weekday pattern or skip dates could be matched against the UTC day (a day late). (2) `update_future_events` copied the anchor's start and end onto every later occurrence, so any series edited with "This and all future events" has those occurrences collapsed onto one date; the original dates are not recoverable from the occurrence rows, only by regenerating from the parent's stored pattern. Repairing either moves events members may have RSVP'd to and is a data migration, so it was not done.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **A member promoted off an event's waitlist is told only in the app, not by email**                                                                                                                                                                                                                   | ✅ Resolved (2026-10-11, workflow review W19-1)                                                                                          | Resolved as the owner chose — an email, a template and its own switch: `promote_from_waitlist` now also emails the promoted member (non-fatal, after the in-app entry) through the new **Off the Waitlist** template (`event_waitlist_promotion`; migration `32a58e65eb63` widens `email_templates`/`scheduled_emails.template_type`). The email is gated by a new optional member email kind, `event_waitlist` (**Off the waitlist**, on by default, not tied to the Event reminders switch), which a department can make required. Original finding: `promote_from_waitlist` logs an `in_app` notification ("You're off the waitlist: …") and sends nothing else. CLAUDE.md pitfall 18 makes email the channel of record with the bell layered on top, so a member who reads only their inbox never learns they are confirmed, may not come, and holds the seat. Adding it is a new outbound email with its own template and a place among the per-member email switches, which is a product change rather than a fix.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **An automatic waitlist promotion does not appear in an event's RSVP Activity**                                                                                                                                                                                                                       | ✅ Resolved (2026-10-11, workflow review W19-3)                                                                                          | Resolved as the owner chose — a marker column and a row: migration `43b88e6ec431` adds `rsvp_history.is_automatic` (boolean, default false; guarded, since `rsvp_history` is a `create_all`-only table), `promote_from_waitlist` writes a `waitlisted → going` row with `is_automatic = true` and no `changed_by`, `GET /events/{id}/rsvp-history` returns `is_automatic`, and RSVP Activity reads "… was moved from Waitlisted to Going (automatically, when a spot opened up)". Promotions made before the change wrote no row and are not backfilled. Original finding: `promote_from_waitlist` writes no `rsvp_history` row, so the officer's feed shows the member waitlisted and nothing after it while the list above shows them Going. A row with an empty `changed_by` would read as the member's own change ("Null means self-change"); recording it honestly as automatic needs a new column or marker on `rsvp_history`, which is a migration.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Deleting an event template only deactivates it, while the dialog says it cannot be undone**                                                                                                                                                                                                         | ✅ Resolved (2026-10-11, workflow review W21-5)                                                                                          | Resolved as the owner chose — relabel, do not delete: the action is now **Deactivate** (archive icon, shown on active templates only), its dialog reads _"Deactivate "…"? It will no longer be offered when creating an event. Events already created from it are not affected, and you can reactivate it at any time with its switch."_, and the "cannot be undone" copy is gone. The backend's `DELETE /events/templates/{id}` still soft-deletes, unchanged. Original finding: Driven: Delete → "This action cannot be undone." → Delete, and the template is still listed as Inactive, identical to Deactivate. `delete_template` soft-deletes deliberately ("Soft-delete a template by deactivating it"), presumably so events created from it keep a valid reference. Whether templates can be removed — and so whether the dialog or the button is wrong — is a product decision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Event analytics' attendance rate counts upcoming events as no-shows**                                                                                                                                                                                                                               | ✅ Resolved (2026-10-11, workflow review W21-6)                                                                                          | Resolved as the owner chose — past events only, per-event average: `avg_attendance_rate` is now the mean of checked-in ÷ Going for each event in the period that has ended (`end_datetime <= now`) and had anyone Going, so the "Avg" label is accurate and upcoming RSVPs no longer pull it down. The response field and the card label are unchanged. **Still as before:** "Top Events by Attendance" lists upcoming events at 0%. Original finding: `get_analytics_summary` divides every checked-in RSVP by every Going RSVP in the period, pooled, including events that have not started; the review install read "Avg Attendance Rate 67%" with one past event at 100% and one upcoming event at 0%, which "Top Events by Attendance" also lists. The figure falls whenever members RSVP to something upcoming, and it is a pooled ratio despite the "Avg" label. Which events it should cover, and pooled versus per-event average, is a metric definition.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **A public event requester is never given their status link**                                                                                                                                                                                                                                         | Accepted by the owner (2026-10-05; MED, workflow review W22-4)                                                                           | After submitting the public request form the requester sees only "Thank you for your submission!"; neither the acknowledgement nor the status-change email carries the `/event-request/status/<token>` link, which is reachable only by a coordinator pressing Copy Link and sending it by hand. That page is where the requester follows progress and cancels, and it promises email updates that depend on the department's triggers (and still promises them after a cancellation). Showing the link on the confirmation screen changes a public endpoint's response; adding a `{{status_link}}` to the default acknowledgement changes what the department emails a stranger and would not reach a customised template. Which, or both, is a product decision. **Accepted by the owner (2026-10-05):** leave as is — the status link stays something a coordinator shares by hand, the deliberate posture recorded under "Outreach Requests — Two Deliberate Choices in the Public Pipeline" below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **A guest sign-in's applicant lands in no pipeline, and nobody can see it**                                                                                                                                                                                                                           | ✅ Resolved (owner decision 2026-10-08: fall back to the sole/first active pipeline + backfill stranded; workflow review W23-1)          | A guest sign-in created its prospect with no pipeline whenever the department's pipeline was not flagged `is_default`, and the board, table and source filter all omitted it. **Resolved 2026-10-11:** `_get_default_pipeline` now falls back to the organization's first active, non-template pipeline (by creation time) when none is default, so a new applicant always lands on a board when one exists. Migration `e1a5bfe7a2ed` places the applicants already stranded — open ones only (`active`, `on_hold`) — on the same pipeline, at its first stage with a progress row per stage, and logs `pipeline_assigned_by_backfill` in each applicant's activity log; closed applications stay as they were, and a department with no usable pipeline keeps its rows unplaced. The downgrade takes back exactly those placements. `tests/test_prospect_pipeline_fallback.py`, `tests/test_place_stranded_prospects_migration.py`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **No screen shows who signed in as a guest**                                                                                                                                                                                                                                                          | ✅ Resolved (2026-10-11, owner decision: guests list on the event page, not counted in member attendance)                                | A kiosk guest sign-in is stored as an external attendee (`GET /events/{id}/external-attendees`, `events.manage`), and nothing in the frontend read it, so the event page said "Attendance (0)" after guests signed in. **Built:** the event page shows a **Guests (_n_)** card to event managers (`EventGuestsCard`) — name, organization, email, phone, sign-in time and source — and states that guests are not counted in attendance; member attendance figures are unchanged (they are read from RSVPs, which guests do not have). Shown on an event that takes guest sign-ins even when empty. Not built: guests in check-in monitoring or attendance exports, and editing a guest from the card. _(2026-10-25)_ Adding a guest and signing a listed guest in from the card are built.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **A program's linked requirement starts at zero, whatever the member already holds**                                                                                                                                                                                                                  | ✅ Resolved (2026-10-06, owner decision: read the compliance result live)                                                                | A department requirement linked into a program now reads the member's compliance result: each such progress row is a projection of `evaluate_member_requirement_detail` (the compliance matrix's grader) as of the department's today — the member's graded records, shifts worked, waivers and catch-up included — written onto the row by `TrainingProgramService.refresh_linked_progress` whenever program progress is shown (enrollment detail, My Enrollments, a member's enrollments, the program's Enrollments tab, the My Training pipeline card), after which the enrollment percentage re-rolls and a completed phase advances as for any progress update. A member with 4 of 6 Hazmat hours now reads 4/6 in both places. _Linked_ means a requirement no program link owns (`owns_requirement`); a requirement a program created for itself — including one a duplicated program shares — keeps its program ledger. Feeds (shift reports, sessions, skills tests, credits) accrue nothing on a linked row and write no ledger credit; an officer cannot set its value or mark it complete (400, with the reason), only waive it for the program or lift the waiver. **Enrollments already made** read live from the next view: no migration, no row deleted; their stored values are replaced by the compliance figure on first read. **Not followed live:** completed, withdrawn, failed and expired enrollments keep the progress they finished with, so an annual requirement's new period cannot reopen last year's completion. Reports that read `requirement_progress` directly (struggling members, the program report counts) see a linked row as of its last refresh.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **An open shift swap cannot be picked up, and approving one moves nothing**                                                                                                                                                                                                                           | ✅ Resolved (2026-10-05, owner decision: offer to members eligible for the seat; pickup moves the assignment)                            | An open swap is now listed to every member cleared for its seat (`GET /scheduling/swap-requests/open`, on the Requests tab under **Open shifts you can pick up**), judged by the same `get_eligible_positions` rule as signup and two-way exchanges. `POST /swap-requests/{id}/pick-up` moves the assignment to the member under the signup window and the full `_validate_assignment_candidate` checks (eligibility, leave, overlap, EVOC, seat cap) — no override. Officer approval of an open swap is refused, since it moved nothing; deny still works. Not built: open swaps are not pushed to eligible members by email or notification — they are found on the Requests tab. Whether to notify them is a separate decision. (W33-4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **The inventory setup wizard's first step needs a grant the quartermaster does not hold**                                                                                                                                                                                                             | ✅ Resolved (2026-10-11, owner decision: grant `locations.create` to the quartermaster; workflow review W38-1)                           | `/inventory/admin/setup` is gated on `inventory.manage`, and its first step adds rooms through `POST /locations`, which requires `locations.create` or `locations.manage`. The seeded Quartermaster position now carries `locations.create` in `DEFAULT_POSITIONS`, and migration `9e8b0b6f3fe8` (`grant_quartermaster_locations_create`) adds it to every stored system `quartermaster` position that still holds `inventory.manage` and does not already cover it (`locations.create`/`locations.manage`/`locations.*`/`*`) — an addition gated on evidence per pitfall #23; its downgrade removes the grant. Create only: `locations.edit`/`locations.delete` are not granted. The wizard's room form was already shown by permission, so it now appears for the quartermaster; a position without the grant still sees the explanation instead of a form. Pinned by `tests/test_quartermaster_locations_create_grant.py` (registry, the grant/revoke functions, and the migration's own upgrade/downgrade against a temporary table).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Receiving gear back does not close the member's return notice**                                                                                                                                                                                                                                     | ✅ Resolved (2026-10-11, owner decision: mark received for inspection; workflow review W39-5)                                            | `unassign_item`, `return_to_pool` and `checkin_item` (and so batch return, the kiosk check-in and departure clearance, which call them) now mark the member's open `requested` return notice for the same holding `received`: `reviewed_by`/`reviewed_at` set, `received_quantity` recorded, `review_notes` "Received through <path>, not through this notice; not inspected here." `observed_condition` stays empty and no follow-up is raised — the direct return's own condition is the record, and the notice is not completed. The notice leaves the returns queue, the hub's pending-returns count and the member's Pending count; the returns panel gains a **Received another way** filter. A pool return of fewer units than the notice announced leaves it open; another member's notice on the same pool item is untouched. The notices are locked before the item, the order `review_return_request` uses, so the two paths cannot deadlock. **Follow-on (2026-10-12, owner decision):** a received notice can now be **inspected**. `PUT /inventory/return-requests/{id}/review` accepts `status: "inspected"` for a `received` notice only (any other state, and `received`/`denied` on a received notice, is refused; the fetch is org-scoped), records `observed_condition`, the notes and the same follow-up a receipt raises (maintenance, write-off, or a pool charge review), and completes the notice. It moves no stock and closes no holding a second time; the one item change is the receipt's safety rule — a serialized item found poor, damaged or out of service while it is still on the shelf (`available`, unassigned) goes to `in_maintenance`, while gear already out again is left to the follow-up record. The owner confirmed this rule on 2026-10-12. The notice has no inspector column, so `reviewed_by`/`reviewed_at` move to the inspector and the receipt's actor is appended to the preserved "Received through …" note ("Received by <name>."), followed by "Inspected: <condition> -- <notes>"; the audit event records the decision and observed condition. The returns panel shows **Inspect** on received notices, opening the review dialog with condition, follow-up and notes but no identifier or count. Pinned by `tests/test_inventory_direct_return_closes_notice.py`, `tests/test_inventory_inspect_received_notice.py` and `ReturnRequestsPanel.test.tsx`. |
| **A variant group created on the Variant Groups page can never be filled**                                                                                                                                                                                                                            | ✅ Resolved (2026-10-11, owner decision: group picker on the item form; workflow review W40-7)                                           | The Add/Edit Item form (`ItemFormModal.tsx`) now has a **Variant Group** select listing the organization's groups (active ones offered, an item's current inactive group shown as "(inactive)"). Create sends the chosen `variant_group_id` (omitted when none); edit sends it or an explicit `null` to remove the item from its group — the existing `POST`/`PATCH /inventory/items` contract, whose FK is already org-validated by `_assert_item_fks_in_org`. The picker is hidden while Generate Sizes & Styles is on, which still creates its own group. The Variant Groups page's empty state now points at the picker. No backend change. Pinned by `ItemFormModal.test.tsx` ("variant group picker") and `VariantGroupsPage.test.tsx`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **A reorder request made in the app can never be received**                                                                                                                                                                                                                                           | ✅ Resolved (2026-10-11, owner decision: both — item picker at create and linking at receipt; workflow review W41-5)                     | The create and edit forms on `/inventory/admin/reorder` now carry an **Inventory item** picker (`InventoryItemPicker`, gear catalog), and the low-stock quick fill and the hub's `?category=` prefill link the category's lowest item: `GET /inventory/low-stock` items gain an additive `id`. An unlinked request's **Receive stock** dialog asks for the item first and links it through `PATCH /inventory/reorder-requests/{id}` before posting the receipt (the plain PATCH does not bump `version`, so the receipt's `expected_version` still matches). `ReorderRequestUpdate` gains an additive `item_id` (org-validated by `_assert_reorder_fks_in_org`); the update refuses to change or clear it once `quantity_received > 0`, and an unchanged id passes, so the edit form can send it every save. Pinned by `tests/test_inventory_reorder_item_link.py`, `tests/test_low_stock_lot_totals.py` and `ReorderRequestsPage.test.tsx`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **A write-off raised for one returned unit of pool stock retires the whole item**                                                                                                                                                                                                                     | ✅ Resolved (2026-10-11, owner decision, docket W41-6)                                                                                   | Owner decision: do not offer write-off for pool issuances. Receiving a damaged pool return (`return_type = issuance`) no longer lists **Write-off review** as a safety follow-up, and `review_return_request` refuses `follow_up = write_off` for a pool issuance with a 400 ("Write-off review is not available for pool issuances"). `auto` on an out-of-service pool return now maps to `maintenance`, the follow-up a damaged pool return already got, instead of `write_off`. The returned units were already kept out of issuable stock by the receipt (`_return_units_to_stock`), so nothing is lost; the hazard was the write-off request naming the item, whose approval retired the whole shelf and released every holder. Individual items are unchanged. A quantity write-off remains unbuilt by decision. Pinned by `tests/test_inventory_return_receipt.py` and `ReturnRequestsPanel.test.tsx`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **The check log and fleet board count a checklist as missed on days before it existed**                                                                                                                                                                                                               | ✅ Resolved 2026-10-11 (owner decision 2026-10-05: from template creation; MED, 2026-09-30, workflow review W46-19)                      | Resolved by counting a checklist from its creation. `EquipmentReadinessService._expected_pairs` — the one definition the fleet board, check log and Check Reports compliance counts share — now pairs a shift with a checklist only if the checklist existed before the shift was over: a shift whose `end_time` is at or before the template's `created_at` owes nothing, a shift still under way at creation does, and a shift with no recorded end owes it from the creation day on the department's calendar. The 9:54 PM checklist no longer makes the previous day missed. Re-scoping an existing checklist (new apparatus or type) does not restart the clock, per the chosen option; no publish timestamp was added. `tests/test_checklist_expected_from_creation.py` pins it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **The dashboard's Low stock counts a lot-stocked category as empty**                                                                                                                                                                                                                                  | ✅ Resolved (2026-10-11, owner decision: sum lots for lot-stocked items; exclude medical to match the list)                              | `InventoryService.get_low_stock_items` summed `InventoryItem.quantity` per category, and an item stocked through lots leaves that column at 0, so a category of lot-stocked supplies read as empty against its threshold; the dashboard's "Low stock" widget also counted medical categories the `/inventory?stock=low` list it opens leaves out (the widget read 2, the list 1). **Fixed:** an item's on-hand is now read the way the reorder alert reads it — its in-date lots when it has any lot (expired lots count as nothing), `quantity` otherwise — in the category sum, the threshold comparison and the per-item names; and the dashboard widget passes `exclude_item_types=MEDICAL_ITEM_TYPES`, as the MCP tool already did. Medical Supplies keeps counting its own low stock from item reorder points. `tests/test_low_stock_lot_totals.py`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **A member checked in after an election opens cannot vote**                                                                                                                                                                                                                                           | ✅ Accepted by the owner (2026-10-05) — secretary override only                                                                          | Opening an election freezes the voter roll, and an attendance-gated ballot item counts only members already checked in, so a member checked in after opening is recorded as present and refused a ballot. **The owner decided (2026-10-05) that a late arrival votes only through a secretary voter override** — the bylaw-neutral choice, and a mechanism that already exists: the override admits the member past the frozen roll and the attendance rule, and is recorded with its reason and officer. Late check-in does not add to the roll. The Attendance tab says a check-in after opening does not add a voter; the elections guide's edge-case table says to add an override.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Results of an election closed early stay hidden until its scheduled end**                                                                                                                                                                                                                           | ✅ Resolved (owner decision 2026-10-05; workflow review W50-10)                                                                          | Resolved as the owner chose: an early close releases results exactly as the scheduled end would have. `get_election_results` unlocks on CLOSED alone (or the pre-open live-tally flag set on the election form); the scheduled end is no longer a condition, so the officer who closes the vote at the meeting, and every `elections.view` holder, sees the result then. The Results panel says closing is what releases them. Test: `TestResultsVisibilityGate` in `tests/test_election_voting_flow.py`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **An election run on positions alone cannot email ballots, and nothing says so before it opens**                                                                                                                                                                                                      | 🔶 Warned on Open (2026-10-05, W50-11)                                                                                                   | The emailed ballot page votes on ballot items only, so an election built from positions alone cannot email ballots, and the ballot cannot change once voting is open. **Owner decision (2026-10-05): warn on Open.** The Open election confirmation now says that the election has no ballot items, that ballot emails cannot be sent once it opens and members will vote in the app only, and to add the races in the Ballot Builder first (`ElectionDetailPage.w50-open-confirm.test.tsx`). The limitation itself goes when the emailed ballot carries plain positions (the ballot convergence entry, 2026-08-12). Re-observed 2026-10-06 (W50-91): the API does not refuse the send, and a token ballot on such an election reads "Make a selection for each item below" over no items, with a Submit button. **Fixed 2026-10-15:** the emailed ballot page now says the ballot has no items and keeps Submit disabled (`BallotVotingPage.w50-empty.test.tsx`); **Fixed 2026-10-16:** `ElectionService.send_ballot_emails` now refuses an election with neither ballot items nor positions (HTTP 400 from send-ballot, send-test-ballot and remind-non-voters; the auto-open send logs it and alerts managers); `tests/test_election_send_empty_ballot.py`. A positions-only election is not empty: plain positions are served as ballot items on the emailed ballot.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **A department on basic apparatus cannot pin a checklist to one unit**                                                                                                                                                                                                                                | ✅ Accepted by the owner (2026-10-05: leave as is — assign by type; LOW, 2026-09-30, workflow review W46-20)                             | `equipment_check_templates.apparatus_id` is a foreign key to the Apparatus module's `apparatus` table, so a unit from onboarding's `basic_apparatus` list cannot be stored there, and the server refused it as "Invalid apparatus". The builder now offers only Apparatus-module units, and such a department assigns checklists by apparatus type, which works (the fleet board and log resolve it). Supporting per-unit checklists for basic apparatus is a schema change (a polymorphic reference, as `utils/apparatus_ref` handles for shifts) and is left to the owner. **Owner decision (2026-10-05): leave as is.** A department on basic apparatus assigns checklists by apparatus type; no polymorphic template reference will be built.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **`POST /auth/step-up` has no account-tied lockout** (AUTH-23, MED, security review AUTH-01 pass 12, 2026-10-25, open decision)                                                                                                                                                                       | 🔶 Open — needs an owner decision                                                                                                        | `step_up` (`backend/app/api/v1/endpoints/auth.py`) checks the submitted password or TOTP code and, on a mismatch, only audits the failure — it never increments `failed_login_attempts`/`locked_until`, the columns the account-lockout control is measured against, unlike `/login` and `/mfa/login`. The only throttle is the shared per-**IP** `rate_limit_login()` (5/60s, then a 30-minute IP lockout). An attacker who already holds a member's **live session** (stolen cookie, unattended device) but not their password/TOTP secret can guess against `/auth/step-up` at that IP rate indefinitely, with no account-level consequence ever recorded against the real owner — and step-up gates 24 of the most sensitive handlers in the app (`admin_reset_password`, `admin_reset_mfa`, `delete_user`, `anonymize_member`, `set_mfa_policy`, every `roles.py`/`ip_security.py` mutation, several exports). **Why open:** tying step-up failures into the same lockout columns `authenticate_user` uses would let the same attacker who stole the session deliberately lock the legitimate owner out of signing in at all, by failing step-up on purpose — trading a guessing weakness for a new DoS lever against the real account holder. A narrower per-account (not per-IP) rate limit scoped to step-up, with a longer window but no lock, is the other candidate and carries a smaller version of the same tradeoff. Owner must choose which failure mode to prefer. See `docs/security-review/AUTH-01-auth-session.md`'s Pass 12 section (AUTH-23).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **The new step-up gate covers role-granting handlers in `users.py` but not the equally ceiling-bound rank-granting ones in the same file** (PERM-10, MED, security review PERM-02 pass 12, 2026-10-25, open decision)                                                                                 | 🔶 Open — needs an owner decision                                                                                                        | `assign_user_roles`/`add_role_to_user`/`remove_role_from_user` (`users.py`) now require a fresh step-up, same as `roles.py`’s mutating routes — but `update_user_profile`’s rank-change branch (`users.py:2011-2039`/`:2094`, `members.manage`-gated, bound by the identical `_enforce_rank_grant_ceiling`) and `create_member` (`POST /users`, sets a client-chosen password **and** a ceiling-checked rank **and** ceiling-checked role_ids in one call, `users.create`-gated only) did not. Both are functionally indistinguishable from paths that did get the gate — `create_member` in particular combines `admin_reset_password`’s shape (sets a credential) with `assign_user_roles`’s shape (grants up to the ceiling), and is arguably the more natural way to entrench access from a stolen live session, since it sidesteps needing to touch an existing account at all. **Why open:** `STEPUP_HANDLERS` (`backend/tests/test_mfa_policy.py`) is Feature 01’s own pinned, AST-checked set; `create_member`/`update_user_profile` also mix the sensitive branch with routine, high-frequency traffic (ordinary self-service profile edits; routine onboarding) that a blanket gate on the whole handler would needlessly catch. The ceiling still bounds the grant to the attacker’s own permission level — this is a gap in the step-up control’s coverage, not an escalation beyond it. See `docs/security-review/PERM-02-permissions-roles.md`’s Pass 12 section (PERM-10).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Rank CRUD has no step-up gate, unlike the structurally parallel role CRUD it sits beside** (PERM-11, MED, security review PERM-02 pass 12, 2026-10-25, open decision)                                                                                                                               | 🔶 Open — needs an owner decision                                                                                                        | `roles.py`’s `create_role`/`update_role`/`delete_role`/`clone_role` all gained `require_stepup` this pass. `operational_ranks.py`’s `create_rank`/`update_rank`/`delete_rank` — equally `settings.manage`/`members.manage`-gated and equally bound by a ceiling check (`_enforce_rank_grant_ceiling`, plus this pass’s new `assert_rank_code_may_change` guard) before any grant-bearing write — did not. `reorder_ranks` is correctly not part of this comparison: it never touches the ceiling and grants nothing. **Why open:** expanding `STEPUP_HANDLERS` is Feature 01’s reviewed, test-pinned decision; unlike PERM-10’s two call sites, these three handlers carry no routine/self-service traffic, so — of the two findings — this is the cheaper one to act on once the owner decides to extend the gate. See `docs/security-review/PERM-02-permissions-roles.md`’s Pass 12 section (PERM-11).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **The step-up gate added to `delete_user` does not cover the two sibling member-status mutations bound by the identical privilege ceiling** (USR-11, MED, security review USR-07 pass 12, 2026-10-25, open decision)                                                                                  | 🔶 Open — needs an owner decision                                                                                                        | `users.py`'s `delete_user` gained `require_stepup` the same pass that found PERM-10/PERM-11. `member_status.py`'s `change_member_status` and `archive_member` — both bound by the identical `_enforce_account_reset_ceiling` call `delete_user` uses, added together with it one pass earlier as three equally privilege-ceiling-sensitive "destructive member action" mutations — did not gain it and are absent from `STEPUP_HANDLERS`. A stolen-live-session attacker holding `members.manage` is asked to re-verify before deleting a member but not before suspending, dropping, or archiving one — an equally destructive outcome on the same target population, still bounded by the ceiling (not an escalation beyond the stolen session's own level). **Why open:** identical reasoning to PERM-10/PERM-11 — `STEPUP_HANDLERS` (`backend/tests/test_mfa_policy.py`) is Feature 01's own pinned, test-enforced set; adding a handler to it is a deliberate behavior change belonging to that feature's owner, not a mechanical fix. Neither call site carries routine/self-service traffic, so — like PERM-11 — this is a cheap item to act on once the owner decides to extend the gate. See `docs/security-review/USR-07-users-organizations.md`'s Pass 12 section (USR-11).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **The new Gmail domain-wide-delegated-service-account capability is reachable without re-verification, unlike its two step-up-gated settings-route siblings** (USR-12, MED, security review USR-07 pass 13, 2026-10-28, open decision; revised 2026-10-28 after a Copilot review comment on PR #3810) | 🔶 Open — needs an owner decision                                                                                                        | Both `PATCH /organizations/settings/email` (`update_email_settings`) and the generic `PATCH /organizations/settings` (`update_organization_settings`) can configure a Gmail service account with domain-wide delegation, able to send as any address in the department's Google Workspace domain — strictly more capability than the SMTP/App-Password/OAuth options the route already held. Setting it up or changing it correctly requires `admin.access` server-side (`OrganizationService.update_organization_settings`'s `may_configure_delegated_email` check, fails closed) — but neither route carries `require_stepup`, unlike `update_auth_settings` and `update_file_storage_settings`, its two siblings in `STEPUP_HANDLERS`'s identical "Security and policy changes" category. **Bounded by a Google-side prerequisite the Logbook doesn't control:** Google itself refuses to issue a token for a service-account key whose client ID hasn't already been authorized for the `gmail.send` scope under Domain-wide Delegation in the organization's own Google Admin console (`backend/app/utils/google_oauth.py:175-196`), and changing the sending identity without also supplying a fresh, already-authorized key clears the stored key rather than impersonating anyone (`organization_service.py:562-566`). So a stolen **live session** belonging to an `admin.access` holder is not sufficient on its own — the attacker also needs a key the organization's Google Admin console has already delegated. **Why open:** `STEPUP_HANDLERS` (`backend/tests/test_mfa_policy.py`) is Feature 01's own pinned, exact-set-equality-checked list; the routes also save ordinary low-stakes settings (SMTP host, From name, toggling email off), so gating either route whole needs either a narrower endpoint for the service-account fields or a conditional step-up inside the shared handler — both are decisions for that mechanism's owner, not a mechanical fix, and a fix needs to cover both write paths. See `docs/security-review/USR-07-users-organizations.md`'s Pass 13 section (USR-12).                                                                                                                                                                                                                                                                                                 |

## Dependencies

| Item                                        | Status                             | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **PyMySQL held at 1.2.0**                   | Accepted by the owner (2026-10-05) | PyMySQL 1.2.1 (GHSA-x4f8-9hx9-hpp9) now sends `bytes` parameters as hex literals and replaced `pymysql.converters.escape_bytes_prefixed` with a string sentinel (1.2.3 only restored the _name_). aiomysql 0.3.2 — its latest release — imports that name and calls it for every `bytes` parameter, so with PyMySQL ≥ 1.2.1 every BLOB write fails with `TypeError: 'str' object is not callable` (caught by `tests/test_storefront_service.py::TestProductImages`). The advisory is an injection through the big5, gbk, sjis, cp932 and gb18030 connection charsets; this application connects with `DB_CHARSET=utf8mb4`, which is not affected. `requirements.txt` therefore pins 1.2.0 and `.github/dependabot.yml` ignores `pymysql >= 1.2.1`. **Owner decision pending when either changes:** lift both once aiomysql ships a compatible release; if pip-audit starts flagging 1.2.0 first, the alternative is to take PyMySQL ≥ 1.2.1 and replace aiomysql's `escape_bytes_prefixed` with the hex-literal encoding at startup. **Accepted by the owner (2026-10-05):** keep holding at 1.2.0 until aiomysql ships a compatible release, rather than shim `escape_bytes_prefixed`; the unaffected `utf8mb4` connection charset is why the hold is safe. |
| **jsdom held at 30.0.1**                    | ⚠️ Open (2026-09-22)               | vitest replaces jsdom's `URL.createObjectURL` with a shim that copies each jsdom `Blob` into a Node `Blob`, and it locates jsdom's private implementation object by taking the _first_ own symbol of `new window.Blob()`. jsdom 30.1 changed that, so `blob[implSymbol]` is `undefined` and the shim throws `Cannot read properties of undefined (reading '_buffer')` from inside `URL.createObjectURL` — under vitest 4.1.11 and 5.0.1 alike, and with jsdom 30.1.0 and 30.1.1 alike. The four photo tests in `EquipmentCheckFormCounts.test.tsx` fail on it. It is test-environment only: jsdom is a devDependency and the shipped app never loads it. `frontend/package.json` and the root `package.json` therefore keep `jsdom` at 30.0.1, and `.github/dependabot.yml` ignores `jsdom >= 30.1.0`. Lift both once a vitest release handles jsdom ≥ 30.1.                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Images run newer runtimes than CI tests** | ⚠️ Open (2026-10-14)               | `backend/Dockerfile` builds on `python:3.14-slim` and `frontend/Dockerfile` on `node:26-alpine`, while the unit, integration, contract and frontend test jobs in `.github/workflows/ci.yml` run on Python 3.13 and Node 22, and `CLAUDE.md` names Python 3.13 and Node >= 22 as the toolchain. The Docker job (`tests/test_docker_integration.py`) does build both images and smoke-tests them — the backend container starts and listens, nginx serves the index — so a dependency that will not install or an app that will not boot on the newer runtime is caught. What no job catches is behaviour that differs at runtime once the app is up (a removed or changed stdlib API on a path the smoke test does not reach, a changed default): the test suites never run on the interpreter production uses. **Owner decision pending:** pin the images to what the suites test (`python:3.13-slim`, `node:22-alpine`), or move the test jobs to the versions the images ship (or test both).                                                                                                                                                                                                                                                              |
| **No nested `frontend/package-lock.json`**  | ✅ Resolved (2026-08-05)           | The repo is npm **workspaces** (`workspaces: [backend, frontend]`), so the root `package-lock.json` is the only lockfile `npm ci` reads, and `frontend/Dockerfile` copies just `package.json` and runs `npm install`. A stale nested lock had survived since PR #1071, pinning axios 1.13.6 / form-data 4.0.5 / @remix-run/router 1.23.0 while the root lock carried the patched axios 1.19.0 and form-data 4.0.6. Nothing installed from it — but Trivy scans every lockfile it finds, so it reported 12 HIGH advisories against dependency versions the build does not use. Deleted. Do not re-add a per-workspace lockfile; run `npm install` from the repo root.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Training Module

| Item                                                                                    | Status                                                                            | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A requirement cannot name one policy acknowledgment**                                 | ✅ Resolved (2026-10-07, owner decision: map provider courses to library courses) | A requirement graded only by training type (`training_compliance.py`) is still met by **any** record of that type. A particular policy is now required by mapping its Target Solutions Course ID to a library course (`external_course_mappings`) and linking a COURSES requirement to that course; imports set `TrainingRecord.course_id` from the mapping. Every version of a course maps to the same library course, so a reissued course never needs the requirement edited. **Residual, accepted:** members who complete a new version read as not current until an officer maps it. Training officers are emailed when a new course resembles a library course, and mapping it backfills the records already imported. See [16-integrations.md](./training/16-integrations.md). |
| **Requirement grandfathering reads a missing hire date as the account's creation date** | Accepted (owner to note, 2026-10-03)                                              | A requirement's `new_member_cutoff_date` separates existing members from new ones by join date: `hire_date`, else the UTC date the account was created (`training_compliance.member_join_date`). A roster imported into The Logbook without hire dates therefore reads every imported member as having joined on the import day. If that day falls on or after a cutoff, veterans are graded as new members. Before relying on a cutoff, record hire dates for the existing roster, or choose a cutoff earlier than the import. Members already enrolled in a training program are governed separately, by the per-program `apply_to_current_enrollments` choice made when a requirement is added to it.                                                                              |

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
after that upgrade must also turn the toggle on** — the two are not coupled,
and the symptom is a form that accepts submissions and files no requests.
**Owner decision (2026-10-11): warn on publish.** Publishing on the Forms
screen first reads `GET /forms/{id}/publish-warnings`; for a public form that
files event requests while the toggle is off, it asks **Publish this form?**
with the reason, and **Not yet** leaves the form a draft. The warning reuses the
condition the intake refuses on, so the two cannot disagree
(`tests/test_form_publish_warnings.py`, `FormsPage.publishWarning.test.tsx`).
Turning a form public after it is published, or switching the toggle off later,
does not warn — publishing is the one moment the owner chose.

## Microsoft 365 — Account Provisioning Not Yet Proven Against a Live Tenant (2026-10-17)

The Microsoft 365 integration (`wiki/Integration-Microsoft-365.md`) shares the
Google Workspace engine, so everything in the section below applies to it too
— with sign-in blocked where Google suspends. These are specific to Microsoft,
and an owner may want to revisit each:

- **No live tenant has run it.** Every Microsoft Graph call is covered by tests
  against recorded responses built from Microsoft's documentation, not by a
  real tenant. Two behaviours rest on documentation alone: that a cloud-only
  user's `extensionAttribute15` can be set in the request that creates it
  (the tag that tells a retry its own account from someone else's), and the
  shape of Graph's "already exists" and on-premises errors. A third, added
  2026-10-23: that Graph reports a group's `assignedLicenses` to this
  application, which is how a licensing group is told apart and left alone on
  departure; if it does not, every group is left alone. The wiki's
  "Verifying Against a Real Tenant" checklist exercises all three and the
  rest of the integration, step by step; until a department has run it, its
  first conversion is the first real test.
- **The User Administrator role may be more than is needed.** Microsoft's
  documentation does not say whether resetting a password with the
  `User-PasswordProfile.ReadWrite.All` application permission also needs a
  directory role; the setup guide asks for User Administrator so a retry does
  not fail for want of it. The role lets the application manage every
  non-administrator user in the tenant; a department that confirms resets work
  without it can remove it.
- **Accounts synced from on-premises Active Directory are not blocked.**
  Microsoft 365 cannot change them. The Logbook flags them and stops retrying;
  a person disables the account in Active Directory.
- **Custom attribute 15 is The Logbook's.** Accounts it creates carry its tag
  there. A tenant that already uses Exchange custom attribute 15 for every
  user (in a dynamic-group rule, say) will see The Logbook's value on new
  members' accounts instead.
- **Client secrets expire, and the date is typed in.** An Entra ID secret
  lasts at most 24 months. Reading its expiry from Graph would need
  Application.Read.All, which can read every app registration in the tenant,
  so an administrator records the date in the integration's settings instead
  (owner decision, 2026-10-23). With a date recorded, the Integrations card
  says so from 30 days out and the administrators' morning email warns at 30
  days, at 7 and on the day. Without one, or with a stale one after the secret
  is replaced, nothing warns: creation and blocking simply fail with "The
  client secret has expired" until a new one is entered. A certificate is not
  supported.
- **One directory per department.** Google Workspace and Microsoft 365 cannot
  both be connected. Switching moves nothing: records for the old directory
  stay, and their suspensions wait until it is connected again.

---

## Gmail — Sending Through a Service Account (2026-10-25)

Gmail departments on Google Workspace can send through the Gmail API with a
domain-wide delegated service account (`app/utils/google_oauth.py`,
`app/services/gmail_api_sender.py`) instead of an App Password. Each of these is
a known edge an owner should know about:

- **The key can send as anyone in the domain.** Domain-wide delegation cannot be
  limited to one mailbox; the `gmail.send` scope limits it to sending, not to a
  sender. Whoever holds the key could send mail as the chief. The key is
  encrypted at rest and never returned by the API, configuring the method needs
  `admin.access` (owner decision, 2026-10-25), and the From address is fixed by
  the saved settings — but the key itself is as powerful as the delegation
  allows. Microsoft 365's equivalent is narrower: its app registration is granted
  `SendAs` on one mailbox. Recommend a dedicated Google Cloud project for the
  key, and delete the key in Google Cloud if it may have leaked.
- **Not yet proven against a live tenant.** The request shape, the scope and the
  upload endpoint are taken from Google's own API description bundled with
  `google-api-python-client`. Three behaviours are taken from Google's
  documentation without a live test: that the Gmail API delivers to a `Bcc`
  header and strips it (the sender adds one for recipients not in To or Cc),
  how a daily sending limit is reported (the sender stops the batch on a
  message naming a daily limit, or a `Retry-After` longer than 60 seconds), and
  that the `Message-ID` and `List-Unsubscribe` headers the sender sets are kept.
- **Onboarding offers App Password only.** A department chooses the service
  account after setup, in **Settings → Email**, where the `admin.access` check
  applies. Someone with `settings.manage` alone sees the option disabled.
- **The connection test is open to `settings.manage`.** It obtains a token as
  the From address and sends nothing, and a saved key is only used for the From
  address it was saved with, so it cannot be pointed at another mailbox.

## Google Workspace — What Account Provisioning Leaves Out (2026-10-15)

The Google Workspace integration creates an account for each applicant
converted to a member and suspends it when the member is dropped or deleted
(`wiki/Integration-Google-Workspace.md`). Each of these is a deliberate
choice an owner may want to revisit:

- **Retirement keeps the account unless the department opts in.** A drop or a
  delete always suspends it. Retiring does only when the integration's
  "suspend when a member retires" setting is on (off by default; owner
  decision, 2026-10-23), and only for members who retire while it is on:
  turning it on does not reach back to members already retired, and turning
  it off does not lift suspensions it caused. On-leave, inactive and
  Logbook-suspended members always keep a working account.
- **Suspended, never deleted.** A departed member's account keeps its mailbox
  and its Workspace license until an administrator deletes it in Google.
- **Long-suspended accounts are listed, not unlicensed.** The daily departure
  check marks an account still in the directory 90 days after its suspension;
  the attention list shows it and the morning email names it once (owner
  decision, 2026-10-23). Nothing is removed. An account deleted in the
  directory is unmarked only when its record holds the directory's id; one
  matched by address alone stays listed until the member returns.
- **A permanent delete cannot be retried.** The account record goes with the
  member, so a Google failure while suspending is recorded only in the audit
  log; an administrator suspends the account by hand.
- **A rename changes the name, never the address.** A member's first or last
  name change reaches an account The Logbook created (given and family name;
  Microsoft 365's display name too), but the email address and sign-in name
  stay as they were. An existing account The Logbook only linked to is never
  renamed, a Microsoft 365 account synced from Active Directory is renamed
  there, and a departed member's account keeps its name until they return.
  Names changed before this was added are not sent.
- **Groups follow the configuration, not history.** A departure takes an
  account The Logbook created out of the groups configured _now_, and a return
  puts it back in them; the record does not keep which groups the account
  joined at creation. A Microsoft 365 group that assigns licenses is never
  touched (owner decision, 2026-10-23), nor is one whose licenses Graph does
  not report. Members who left before this was added keep their groups.
- **A departed member's account cannot be kept on.** The daily departure check
  (owner decision, 2026-10-20) suspends again any departed member's account
  found active in the directory, every morning, with no exemption: an
  administrator who re-enables one to export a mailbox must finish within the
  day or return the member in The Logbook. The check runs once a day, so an
  account re-enabled just after it is active for up to a day; the morning
  email reports only what the last day's check found, and anything older is
  in the audit log.
- **Add Member creates an account only when asked; import never does.** Add
  Member's **Create a … account** box starts unticked (owner decision,
  2026-10-20), and a roster import only links members to accounts already at
  their addresses, so an import cannot consume a batch of licenses. A member
  added without an account and without one to link to is not covered until
  one is created in the directory and **Link existing members** is run.
- **Linking is by exact address.** Linking — on demand, or automatically as a
  member is added — matches a member's Logbook email to an account's own
  address only — not an alias, not a personal address — and skips members who
  have already left. A failed lookup while adding a member is logged, not
  retried.
- **A delegated key is domain-wide.** The service account can manage every
  user in the domain, not only members The Logbook created. That is why
  changing the integration needs `admin.access`, and why the requested scopes
  are limited to users and group membership.

---

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
concurrent `POST /system-owner` calls both created a full-access "\*" account.
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
pull requests (`docs/CHANGE_AUDIT_2026-09.md`). None is new
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
  `is_active` callers already admitted probationary and junior members.
  ✅ **Resolved 2026-10-20** (CLAUDE.md Pitfall #32): the owner decided
  training compliance, the compliance officer views, certificate alerts,
  the competency matrix, meeting quorum, administrative continuity, rosters,
  reports/exports and the remaining `== ACTIVE` sites all count a
  probationary member as current, with no bylaws exception for quorum or
  continuity. Every such gate now filters
  `User.status.in_(ACTIVE_ACCOUNT_STATUSES)` (or the instance form); the one
  deliberate holdout is the admin hub's `_members_active` tile, which keeps
  the literal status because its Probationary tile sits beside it and the
  two must add up. `tests/test_account_status_gates.py` sweeps `app/` for a
  literal `== ACTIVE` comparison and fails on any site outside that single
  allowlist entry.
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

## Inventory — Input Rules Deliberately Left Open (2026-10-20)

Found by driving the module end to end. The rest of that pass (blank names,
numbers a column cannot hold, duplicate identifiers, a tracking-mode change
under a live assignment, the assign URL/body mismatch, category loops) is fixed;
these were left because each is a policy choice or needs a schema change.

| Item                                                  | Status        | Detail                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Duplicate category names                              | Open decision | `inventory_categories` has no uniqueness on `(organization_id, name)`, so "Radios" and "radios" can both exist. A rule has to decide what to do with duplicates installations already hold (merge, rename or grandfather), and whether it spans parents or only siblings. |
| Date plausibility on items                            | Open decision | A warranty expiring before the purchase date, and a purchase date of `0001-01-01`, are accepted. Enforcing it on update would also refuse unrelated edits to rows that already hold such a pair unless it only applies when a date field changes.                         |
| Unassign takes effect on one click, with no condition | Open decision | `ItemDetailPage` unassigns with no confirmation and records no return condition, though `unassign_item` accepts one. The Returns screen captures it; whether the detail page should is a product call.                                                                    |

## Medical Supplies — Automatic Reorders Land in a Queue the EMS Officer Cannot Open (2026-10-11)

**Accepted.** A lot swap that leaves shelf stock at its reorder point files a
reorder request (see `docs/MEDICAL_SUPPLIES_MODULE.md`, Alerts). Every
`/inventory/reorder-requests` route requires `inventory.manage`, so an EMS
Supply Officer holding only the medical pair is emailed that the request exists
but cannot see, approve or cancel it.

The owner chose this over widening the queue: purchasing stays with the
quartermaster, and the email tells the medical officer what was filed. Opening
the queue to `inventory.manage_medical` for medical items would need
domain-pinned reorder routes on `/medical-supplies` and a page to show them —
reopen this if the department moves medical purchasing to the EMS officer.

## Locations — Deleting One Clears Its Location From Nine Kinds of Records (2026-10-21, updated 2026-10-25)

Found by the pass-8 security review of Locations & Kiosk
([`LOC8-32-locations-kiosk.md`](./security-review/LOC8-32-locations-kiosk.md),
LOC8-2). Deleting a location that events, event templates or apparatus still
reference deactivates it instead, so those records keep it
(`LocationService.remove_location`). Nine other kinds of record reference a
location with `ON DELETE SET NULL`, so a location that only they reference is
hard-deleted and each of them silently loses its location. (Pass 9,
[`LOC9-32-locations-kiosk.md`](./security-review/LOC9-32-locations-kiosk.md),
added the ninth — `nfc_card_taps`, from Apparatus & NFC's 2026-10-23
migration — to this table; the decision itself is unchanged.)

| Records                                                                           | Status        | Detail                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `training_records`, `course_classes`, `course_cohorts`, `course_cohort_classes`   | Open decision | Where a class or training record took place may be part of the history the record exists to keep. Adding these columns to `_RESTRICTING_LOCATION_REFERENCES` makes such a location deactivate instead; `tests/test_location_restrict_references.py` then needs the same list. |
| `meetings`, `event_requests`, `inventory_items`, `storage_areas`, `nfc_card_taps` | Open decision | An item, storage area or NFC tap log with no location is an ordinary state, so clearing it may be the right outcome here. A meeting or request is closer to an event, which is already protected, so it is worth deciding deliberately.                                       |

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

## Prospective Members — Purge Scope and Auto-Purge (2026-09-30, wired 2026-10-09)

**Purge Selected** on the Inactive Applications tab permanently deletes the
selected applications that are still `inactive`, with their uploaded documents,
and records the purge in the audit log. Until 2026-09-30 it matched `withdrawn`
instead, so it deleted nothing while the page reported success. Withdrawn,
rejected and on-hold applications are never purged, manually or automatically;
the owner chose to keep purging to exactly what the Inactive tab lists.

**Auto-Purge is in effect since 2026-10-09.** The daily `membership_auto_purge`
task deletes, through the same code path as the manual button, the `inactive`
applications in each pipeline with `auto_purge_enabled: true` whose
`inactive_since` is at least `purge_days_after_inactive` days old (UTC, clamped
to 30–1095; a missing or non-numeric value skips the pipeline). Decisions the
owner made, recorded so they are not mistaken for gaps:

- **Coordinators are emailed 7 days before a purge** _(owner decision
  2026-10-08, built 2026-10-11)_. Each daily run first emails the department's
  membership coordinators (the Membership Coordinator / Assistant positions,
  else everyone who can manage prospective members, filtered by their email
  preferences) one list of the applications that will be deleted within seven
  days, with each one's deletion date. An application is listed once per
  inactive spell (an `auto_purge_warning_sent` activity entry), and nothing is
  marked warned unless the email was accepted, so a failed send is retried on
  the next run. The purge does not wait on the warning: if no coordinator can
  be emailed, it still runs on schedule. The audit log
  (`membership_pipeline.prospects_purged`, `trigger: auto_purge`) records each
  purge with the pipeline, threshold and purged ids.
- **The clock restarted at the upgrade.** Applications already inactive when
  migration `feecd81eef2d` ran count from that moment, not from their real
  deactivation date, so the first run could not delete a backlog at once.
  `inactive_since` is separate from the drawer's historical `deactivated_at`,
  which is untouched; an application with no `inactive_since` is never
  auto-purged.

## Prospective Members — The Inactivity "Notify" Checkboxes Have No Reader (resolved 2026-10-27)

Pipeline Settings → Inactivity offers **Notify coordinator** (on by default)
and **Notify applicant**. Until 2026-10-27 both were saved and nothing read
either: the daily inactivity sweep (`process_inactivity_warnings` in
`membership_pipeline_service.py`) only logged an `inactivity_warning_sent`
activity entry — the shape Pitfall #19 forbids.

**Resolved as the owner chose.** On each warning the sweep records (at most
once a week per applicant, the cadence it already had):

- **Notify coordinator** emails the membership coordinators — the same
  recipients as the withdrawal notice, filtered by their membership-admin
  email preference — through the **Prospect Inactivity Warning** template.
- **Notify applicant** emails the applicant through the new **Application
  Going Inactive** template (`application_going_inactive`, migration
  `0d9897752425`), which gives the date the application will be marked
  inactive.

A pipeline with no stored inactivity settings behaves as Pipeline Settings
shows it: coordinator on, applicant off. Either template can be switched off
in Communications → Email Templates, which stops that email.

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

## Meeting Minutes — What Record Keeping Does Not Do (2026-10-14)

**Open — owner decisions to confirm.** The 2026-10-14 record-keeping work
(roll-call statuses, filed election results, attachments, approved versions,
carry-forward; see [MEETING_MINUTES_MODULE.md](./MEETING_MINUTES_MODULE.md#record-keeping-2026-10-14))
made these choices where nothing had been decided. Each is easy to reverse.

- **A signed copy is the one thing that can be filed on approved minutes.**
  MM-17 locks approved minutes against every edit; the scanned signature page
  cannot exist before approval, so `signed_copy` attachments are accepted after
  it and can never be deleted from approved minutes. If the department would
  rather file the signed copy as a Document and leave the minutes wholly
  untouched, remove the `signed_copy` branch in `MinutesRecordService.store_minutes_attachment`.
- **Election results are filed automatically, and a correction is a second
  addendum.** A closed election tied to a meeting (its calendar event or meeting
  record) files its certified result with that meeting's minutes: when the
  election closes if the minutes exist, otherwise when they are made. The copy
  is taken at that moment. In a draft it can be removed and filed again if the
  election is revised (a voided ballot after certification, W50); once the
  minutes are circulated or adopted it is filed as a permanent addendum and
  cannot be removed, so a later correction is a second addendum, not a
  replacement. A department that prefers to file by hand switches
  **Minutes → Settings → Elections** off; the manual import is unchanged.
- **Approved minutes from before this change have no approved version.**
  `GET /{id}/verify` says so rather than inventing a hash for content nobody
  hashed. Reopening and re-approving one creates version 1.
- **Quorum counts present, late and left early; not guests, and there is no
  proxy status.** The code does not know the department's bylaws on a member
  who left before the vote, or on proxies. If either should change the count,
  it is `COUNTS_TOWARD_QUORUM` in `app/utils/minutes_attendance.py`.
- **Attachments are not searchable, are not in the published Documents copy,
  and the PDF lists them without embedding them.**
- **Assignees are emailed when minutes are approved.** An item added to
  approved minutes emails its assignee then; a carried-forward item is not
  re-announced. The due-date reminders in `run_action_item_reminders` still go
  only to the in-app bell, not to email — at odds with the email-first rule
  (CLAUDE.md pitfall #18), and unchanged by this work.
- **Confirmed by the owner (2026-10-14).** Minutes are circulated for review
  and adopted (the API statuses are unchanged); any member who can view minutes
  may suggest changes; an election that runs past the meeting is attached to the
  meeting's minutes afterwards as an addendum; a closed session is a structured
  record with participants and times; a motion can name the ballot that decided
  it; and the departments' standard order of business is an editable outline.
  This is a new install, so no earlier minutes needed converting.
- **Circulating minutes emails members (owner decision 2026-10-14).** Each
  active member except the circulating officer gets one email linking to the
  minutes; it is an optional kind members can switch off, and circulating again
  after a recall or return sends it again. Executive minutes are not announced.
- **A suggestion made as a comment changes nothing by itself; one made as
  tracked changes can be applied (owner decision 2026-10-15).** Accepting a
  comment-only suggestion marks it and makes the adoption default to "as
  amended"; the secretary recalls the minutes and works it in by hand. A
  reviewer's edit of a section is applied change by change from the suggestions
  panel, which recalls circulating minutes first (with a confirmation). Tracked
  changes cover the text of a section only; they do not compare headings of
  sections, motions or action items. A change in a section edited since is
  applied only where its surrounding text still matches exactly once, so a
  heavily rewritten section can refuse a change that a human could still place;
  the secretary rejects it and makes it by hand.
- **Outline changes do not reach minutes already written.** Deleting or editing
  an outline affects only minutes started from it afterwards, or an outline
  applied to a draft.

## File Storage — The Onboarding Platform Choice Has No Reader (2026-10-08)

**Open (owner decision 2026-10-08: build the connections later).** Onboarding's
File Storage step (`FileStorageChoice.tsx`) and
`PATCH /organization/settings/file-storage` let a department pick Google Drive,
OneDrive / SharePoint, Amazon S3 (or an S3-compatible endpoint such as MinIO),
Local Storage, or Configure Later, and store its credentials encrypted in the
organization's settings (`FileStorageSettings`, `schemas/organization.py`).
**No code reads that choice.** Every upload goes to the local uploads volume
(`/app/uploads`) whatever was picked, and `local_storage_path` is ignored
too. A department that chose S3 or SharePoint is keeping its files on the
application server and has no indication of it — the step offers the options
without saying they are not yet in effect (CLAUDE.md pitfall #19).

**Partly resolved (2026-10-22): the S3 / MinIO option works** (decision 31,
steps 2 and 3, in `docs/FILE_STORAGE_HARDENING.md`). A department's uploads go to its
own bucket once **Test and switch to S3** passes with its saved settings, and
the Storage screen reports where new files go whatever platform is picked.
Still open:

- **OneDrive / SharePoint and "Other" are still unread.** The screen says
  files stay on the server for them, and lists what can be connected.
  **Resolved 2026-10-23: Google Drive works** (decision 32), through a
  service account and a Shared Drive. It needs Google Workspace; a personal
  Google account has no Shared Drives.
- **A Drive reference is trusted to name the department's drive.** Reads go
  by file id with the department's own service account, which reaches only
  the drives it was added to; the existence check also requires the file to
  be in the drive the reference names, but a download does not repeat that
  check. Rows are written only by the server.
- **A file deleted from a Shared Drive stays in its trash for 30 days
  (2026-10-25).** The Content manager role the account is given may trash a
  file but not delete it outright, and Google empties a Shared Drive's trash
  after 30 days. The file is encrypted, and until then it still counts against
  the drive's storage; a drive Manager can empty the trash sooner. Granting the
  account Manager would allow an outright delete, but also lets it change who
  belongs to the drive, so it is not asked for.
- **Resolved 2026-10-22: existing files move with
  `scripts/migrate_uploads_to_s3.py`** (apply, rollback, finalize), and
  `scripts/encrypt_uploads.py --rewrap` reaches bucket objects. Every object
  is written encrypted, so the plain-file notice has nothing to find in a
  bucket; until a migration is finalized, the disk copies it keeps are still
  covered by the notice.
- **Backups do not include buckets, by decision (2026-10-22).**
  `scripts/backup.sh` names the buckets it left out; `docs/BACKUP.md` says how
  to protect them with the provider's tooling. A department that skips that
  has no second copy of its bucket. The same holds for a Google Shared Drive
  (2026-10-25).
- **A copy of a Shared Drive cannot simply be put back (2026-10-25).** The
  Logbook finds a Drive file by its id, and a file copied out and uploaded
  again is a new file with a new id, so its record still points at the old
  one. Nothing repoints references yet. Within 30 days the drive's own trash
  restores a file with its id intact; after that, a copy kept elsewhere has
  to be matched to its records by file name (each is named after its storage
  path) and the references updated by hand. A bucket has no such gap: its
  objects are found by key, so a mirror restores as it is.
- **A settings change reaches other workers within 30 seconds.** Each worker
  caches a department's storage view for that long; the worker that saved
  clears its own copy at once.
- **DNS rebinding.** The endpoint's address is checked each time a client is
  built, but botocore resolves the host again when it connects, the same
  window the integrations' save-time checks leave. Blocking metadata hosts
  and private ranges (without the operator's opt-in) is what narrows it.
- **Anonymous suggestion screenshots carry their exact upload time in a
  bucket** (owner decision, 2026-10-22). On the volume that time is truncated
  to noon of the day; a bucket stamps its own and cannot be told otherwise.

What has to exist before any option other than Local Storage does anything:

- a storage interface the upload, download and delete paths all go through —
  Phase 2 of `docs/FILE_STORAGE_HARDENING.md` built the write side, and
  step 1 of decision 31 (2026-10-21) routes every read, existence check,
  delete and download through `file_storage_service` as well;
- one backend per platform: S3 (which also covers MinIO; the compose file's
  `minio` service under the `with-s3` profile has nothing connecting to it
  either), then Google Drive and OneDrive / SharePoint, which need OAuth token
  handling as well as storage calls;
- a migration path for files already on local disk when a department switches,
  and a decision on what happens to them;
- the same org-scoped containment, malware scanning and (from Phase 4)
  encryption on every backend, so choosing a remote platform never weakens
  what local storage guarantees.

The deployment-level `STORAGE_TYPE` / `UPLOAD_DIR` / `AWS_*` / `AZURE_*` /
`GCS_*` settings are the same gap at the environment level (see the CI3-33-4
row above).

## File Storage — Folder Rights Phase 3 Left Open (2026-10-09)

**Open, deliberate.** Phase 3 of `docs/FILE_STORAGE_HARDENING.md` gated each
module folder on that module's rights.

- **Resolved 2026-10-12: custom folder rights now have a screen.** The Create
  Folder and Manage folder dialogs set positions and required permissions
  (decision 27).
- **Resolved 2026-10-14: a folder nobody but full administrators can open is
  confirmed, not made by accident** (decision 29). The check runs when the
  folder is saved.
- **Resolved 2026-10-15: a folder that becomes administrators-only later is
  listed** (decision 30). Full administrators see it on the Documents page,
  until they fix it or confirm it.
  - A confirmation lapses once the folder regains an audience, so losing it
    again lists the folder once more. It lapses when a full administrator
    next opens Documents, not at the moment of the change: a folder that
    regains and loses its member between two visits keeps its confirmation.
  - **Resolved 2026-10-16: full administrators are emailed the list once a
    week** while any folder is on it (the `admin_only_folder_digest` task).
    Each email repeats every folder still listed, not only new ones. A
    folder shut on a Tuesday can wait up to a week for the next email,
    unless someone opens Documents first. An administrator can turn the
    email off ("Document folder access"), and a department can make it
    required.
- **Resolved 2026-10-13: positions are stored by id** (decision 28). Deleting
  a position takes it out of every folder, and is refused while it alone opens
  a folder. A position created later with the same name inherits nothing.
- **Resolved 2026-10-16: facility files no longer need `documents.manage` to
  upload.** The facility Files section used to upload through
  `POST /documents/upload` and then link the document, so a facilities
  manager holding `facilities.edit` but not `documents.manage` was refused at
  the first step. It now uploads through
  `POST /facilities/{id}/photos/upload` and
  `POST /facilities/{id}/documents/upload`. These take the same facilities
  grants as the record they create, store the file straight into the
  facility's Photos or Facility Documents folder through
  `app/services/module_documents.py` (as apparatus and finance do), and never
  pass through General Documents. The two-step path still works for API
  callers.
- **Files in the `documents` area were not stored per record** (found and
  resolved 2026-10-11). Library uploads and the apparatus and finance
  documents that `module_documents` creates were written flat under
  `<org>/documents/`, where every other area adds the record. New uploads go
  to `<org>/documents/<document_id>/`; `scripts/relocate_uploads.py --apply`
  moves the flat ones into their document's directory with the same verified
  copy, rollback and finalize steps as the legacy move. Until it runs they
  stay where they are and keep downloading.
- **An event's attachment references are confined to the organization, not
  the event** (found 2026-10-11). Event create/update payloads accept an
  `attachments` list, checked only for being in the organization's
  event-attachments area — deliberately, because duplicating an event and
  generating recurring occurrences share one file. So event A can reference a
  file uploaded to event B, and it is served under A's visibility. Only
  someone who can write events can set that list, and they can already open
  every event's attachments, so it grants nothing new today.
  `GET /events/{id}/attachments` also returns the stored `file_path`.

## File Storage — What Encryption at Rest Does Not Cover (2026-10-09)

**Open, each deliberate.** Phase 4 of `docs/FILE_STORAGE_HARDENING.md`
encrypts every file written under `/app/uploads`. It does not reach:

- **Images stored in the database.** Member photos, logos, storefront and
  equipment-check photos are re-encoded and kept in table columns, not on
  disk. They are protected by database access and backup handling, not by
  the file key.
- **Backups taken before the encrypt run.** An `uploads.tar.gz` made before
  `scripts/encrypt_uploads.py --apply` holds the plaintext files, and one
  made between `--apply` and `--finalize` holds both copies. Retire or
  re-protect those archives on their own schedule. Restoring one brings
  plaintext files back; they are served as before, but the "not yet
  encrypted" notice does not return on its own once a finalize recorded the
  tree as complete. Delete `/app/uploads/.encryption/state.json` and run the
  command again.
- **HTTP Range requests on encrypted downloads.** They stream whole; a
  resumed download starts again. A file stored before encryption, still on
  `FileResponse`, keeps Range support until it is encrypted.
- **Downgrading the code.** A release from before Phase 4 serves an
  encrypted file's ciphertext. The encrypt command's `--rollback` only
  restores the files it encrypted, not uploads made since. Do not downgrade
  past Phase 4 once files have been uploaded (see "Before every upgrade" in
  `docs/UPGRADING.md`).
- **Key custody is attested, not checked.** The confirmation records that an
  administrator said the key is stored separately. The application cannot
  see where it is, and on an installation hosting more than one organization
  any organization's `settings.manage` holder confirms for the installation,
  because the key is installation-wide.

## Forms — What a Sensitive Field Does Not Reach (2026-10-25)

**Open, each deliberate.** A field marked Sensitive stores its answers
encrypted in `form_submissions.sensitive_data` and serves them only to holders
of `sensitive_answers.view` (see "Sensitive Fields" in
`docs/FORMS_MODULE.md`). Three things fall outside that:

- **Copies an integration made before the field was marked.** Marking an
  existing field Sensitive moves the answers held on each submission into the
  encrypted column. It does not reach a value an integration already copied
  out — an applicant record created from an interest form, or the answers kept
  on that applicant's pipeline stage. Mark a field Sensitive before the form
  is published to avoid this; otherwise those records keep what they were
  given until they are edited, purged or anonymized.
- **A submission that arrives while the field is being marked.** A request
  that loaded the form before the flag was saved writes that one answer to the
  plain `data` column. The submission screens still withhold it — they decide
  by the field's current flag, not only by where the answer is stored — but
  the stored copy is not encrypted. Closing it would mean locking the form row
  on every submission.
- **Backups taken before the field was marked.** They hold the plaintext
  answers, as any pre-change backup does.

`sensitive_answers.view` is granted to no seeded position, so a department
that wants its membership committee to read these answers grants it by hand.

## Prospective Members — Follow-up Form Links (2026-10-29)

**Open, each deliberate.**

- **A forwarded link shows what is pre-filled.** The link needs no sign-in, so
  anyone the applicant forwards their email to opens the form with the address,
  phone and date of birth it pre-fills. The token is 256 bits, the page is
  served no-store and no-referrer, and only the fields the form maps are
  filled — but the link is the credential, as the status-page link is.
- **An email change reaches the new address at once.** Later pipeline emails
  go to it as soon as the form is submitted. The safeguards are the flag on the
  applicant's card and the notice to the old address; a change is not held for
  approval (the owner's decision of 2026-10-25).
- **Applicant names entered on an interest form are stored HTML-escaped.**
  `FormsService` escapes every answer, and the interest-form mapping copies the
  escaped text onto the applicant record, so "O'Brien" is stored as
  `O&#x27;Brien` and the pipeline screens show it that way. Follow-up forms
  unescape for display and comparison, and write plain text back when the
  applicant changes a value, but records nobody has edited keep the escaped
  text. Fixing it needs a decision on a backfill of existing records.

## Self-Report Attachments — What Happens to the File (2026-08-23)

A member can attach a certificate (PDF/JPG/PNG, 10 MB) to a self-reported
training. Where the bytes end up, and when they are removed, is deliberate —
and partly still open.

**Where they live.** `/app/uploads/<org_id>/self-reports/<submission_id>/`
since 2026-10-08 (file-storage Phase 2; before that
`training_attachments/self_reported_submissions/<org_id>/`, still read until
`scripts/relocate_uploads.py` moves them). Approval copies the submission's
attachment dicts onto the `TrainingRecord` verbatim, so the record download
route accepts the self-reports area as well as its own; without that every
approved certificate would 404 from the member's own training history.
`tests/test_training_submission_drafts_attachments.py` asserts it.

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
`/app/uploads/<org_id>/` (and any not-yet-relocated legacy trees) itself — the retention task reads a
`self_report_configs` row, which goes with the organization. A record whose certificate has been
swept shows no attachment and says nothing about why — the audit trail is the
only account of it.

**What is still open:**

| Item                             | Status                          | Detail                                                                                                                                                                                         |
| -------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Malware scanning**             | Resolved 2026-10-08 — see below | Every upload path is scanned by ClamAV before anything is written, on by default. An operator can still set `CLAMAV_ENABLED=false`; administrators are then warned until it is turned back on. |
| **Voided records keep the file** | By design                       | `DELETE /training/records/{id}` marks a record `cancelled` rather than removing it, so the correction stays auditable — and the evidence behind the corrected entry stays with it.             |

**Malware scanning (resolved 2026-10-06, owner's choice: add ClamAV).** Both
certificate upload routes stream the file to a ClamAV daemon
(`app/services/malware_scan_service.py`, clamd `INSTREAM` over TCP) after the
magic-byte check and before the write. An infected file is refused
(`LB-UPLD-004`), nothing is stored, and `upload_malware_detected` is audited
with the signature name, type, size and SHA-256 — never the content or the
member's file name. **Since 2026-10-08 (file-storage Phase 2) scanning is on by
default and covers every upload path** — documents, every attachment type,
applicant files, email-template attachments, suggestion screenshots, member
photos, logos, storefront and equipment-check photos, and every CSV import —
through `app/services/upload_scanning.py`; `tests/test_upload_scan_sweep.py`
fails on a new upload endpoint that does not reach it. The daemon is the
`clamav` service every compose file now starts. Setting `CLAMAV_ENABLED=false`
accepts files unscanned behind a startup/preflight warning and a standing
administrator notice (`GET /system-notices`). Configuration: `CLAMAV_ENABLED`, `CLAMAV_HOST`,
`CLAMAV_PORT`, `CLAMAV_TIMEOUT_SECONDS`
([wiki](../wiki/Configuration-Security.md#malware-scanning-of-uploads)).

What remains for the owner:

| Item                                         | Status                      | Detail                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scanner outage fails closed**              | Owner's decision 2026-10-08 | With scanning enabled, an unreachable clamd, a timeout, or any reply other than `OK`/`FOUND` refuses the upload with a retryable `503` (`LB-UPLD-005`) — on every upload path. The owner confirmed it for the on-by-default rollout: a host that upgrades without a running scanner refuses uploads until it has one. |
| **Files stored before scanning was enabled** | Open                        | Not rescanned. Scanning covers new uploads only; files already on disk (and logos, photos and images already in the database) were never scanned.                                                                                                                                                                     |

## Unraid Community Apps Template — Not Installable Yet (2026-10-13)

**Open decision.** `unraid/the-logbook.xml` is a Community Applications
template for a single container, `ghcr.io/thegspiro/the-logbook:latest`,
answering on 3000 (web) and 3001 (API). Two things stand between it and a
working install:

- **Nothing builds or publishes that image.** No workflow pushes to ghcr.io,
  and there is no root `Dockerfile`; `UNRAID-INSTALLATION.md` already warns
  that a pull fails with "manifest unknown".
- **The project has no combined image to publish.** It ships two:
  `backend/Dockerfile` (uvicorn on 3001, fixed uid 1000) and
  `frontend/Dockerfile` (nginx on port 80, forwarding `/api` to a host named
  `backend`). Publishing either one under the template's name would not
  give it a container that answers on both ports.

The template is marked as a draft in its own header, its overview and its
`Status:Beta` category, so nobody submits it as it stands. The settings no
image reads were removed: `/app/data`, `PUID`/`PGID` (the backend runs as uid
1000 whatever they say) and a placeholder donate link. The Docker Compose path
(`unraid/QUICK-START.md`) remains the supported Unraid install.

**To make it installable, choose one:**

1. **A combined image**: nginx and the backend under one process supervisor,
   plus a workflow that publishes it to ghcr.io on each release. That needs
   package-write permission on the repository and someone owning releases.
   MySQL, Redis and ClamAV stay separate containers the user installs (the
   template already asks for their hosts).
2. **Two templates**: publish the existing backend and frontend images and
   split the template in two. The frontend's nginx would need the backend
   address made configurable instead of the fixed `backend` hostname.

Related and not changed here: `unraid/docker-compose-unraid.yml` also passes
`PUID`/`PGID` to the backend and frontend, where nothing reads them either.

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

| Item                                                                   | Status                                                                       | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Platoon presets cover 3-platoon rotations**                          | Accepted                                                                     | Multi-platoon generation offsets are validated for the common 3-platoon presets (24/48, Kelly, 48/96). Departments running non-standard platoon counts should verify the generated tiling. See [Scheduling Module → Platoon Rotations](../wiki/Module-Scheduling.md#platoon-rotations).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **"Shifts completed" has three sources of truth**                      | ✅ Resolved (2026-10-06, owner decision: `ShiftAttendance` is authoritative) | A `RequirementType.SHIFTS` requirement was counted from `TrainingRecord`s on the training screens (every completed record in the window counted as a shift), from attendance rows finalized or not on the scheduling Shift Compliance report, and from shift reports in the program ledger. Every grader now counts it through `training_compliance.load_credited_shift_dates`: attendance on the department's own **finalized** shifts plus **counted** external shifts, inside the requirement's own compliance window and cut-off — the compliance matrix, dashboard percentage, Department Compliance card, period roster, profile card, My Training, `/training/requirements/progress` and its MCP tool, the annual and monthly reports, the competency matrix, the compliance exports and forecast, and the Shift Compliance report (which now grades SHIFTS rows through the shared grader, with training waivers, and reports the window it counted). **Numbers moved:** a member whose training records stood in for shifts drops to the shifts they actually worked; a member who worked shifts but had no matching records rises to them; on the Shift Compliance report a shift not yet finalized stops counting, the period becomes the requirement's compliance window (not the report's own period calculation), and waivers replace the rolling-only leave pro-rating for SHIFTS rows. A SHIFTS requirement an officer marks not `shift_credited` stays on training records everywhere and off the Shift Compliance report. The program ledger (`RequirementProgress`) is not a compliance source: no compliance grader reads it, and since W26-1 it is not consulted for a linked requirement either (that row is the compliance result). A program-owned SHIFTS requirement still accrues one unit per shift completion report — see "A program-owned SHIFTS requirement counts shift reports" below. |
| **No formal "active/in-progress" shift state**                         | Accepted                                                                     | `ShiftStatus` is `scheduled`/`cancelled` only; a shift's "activeness" is implied by `start_time`/`end_time` vs. now, and `is_finalized` marks closed. The live readiness panel (2026-07-16) covers most of the operational need without a dedicated state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Count-only call tracking: no cross-unit attach picker**              | ✅ Resolved (2026-10-05, owner decision: build the picker)                   | The close-out wizard's step 2 now lists **Already logged by another unit** — calls another unit recorded while the shift was on, matched by overlapping shift times — and a tick sends `attach_call_ids`, an untick `detach_call_ids` (new; removes only this shift's response, and refuses a call no other unit is on). `attachable_calls` is served from `CallTrackingService.list_attachable_calls` for an unfinalized count-only shift, with `unit_labels` and `attached`. The call-volume report's count-only branch now serves `counts_unit_responses: false` and reads **Total Calls**. What remains is a matter of practice, not code: a second unit that types the incident into its own count instead of ticking it still records a second call, and nothing can match the two afterwards. (SCHED-10)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **`dispatch` / `derived` call sources have no writer**                 | Accepted (forward compatibility)                                             | `CallSource.DISPATCH` / `.DERIVED` and the `uq_org_call_external_ref (organization_id, external_ref)` constraint exist so a CAD integration can be added without a migration — the constraint is what would make a re-sync idempotent. Nothing writes either value today; every row is `manual`. (SCHED-12)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **A program-owned SHIFTS requirement counts shift reports**            | Open (needs product decision)                                                | A SHIFTS requirement created inside a training program (`ProgramRequirement.owns_requirement`) applies to nobody on the compliance screens; only the program's `RequirementProgress` ledger grades it, adding one per shift completion report an officer files for the trainee (`shift_completion_service._update_requirement_progress`). It therefore still counts shift reports, not `ShiftAttendance`. Moving it to attendance would drop the officer's "this shift counts toward the program" step and needs a start date (enrollment, or the requirement's own window), which the shifts-three-sources decision did not settle.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **`member_call_counts` / `reported_call_types` have no list/dict cap** | Open (needs an owner-picked ceiling)                                         | `ShiftFinalizeRequest.member_call_counts` (a list) and `.reported_call_types` (a dict keyed by call type) take an authenticated `scheduling.manage`/shift-officer submission with no size bound, unlike the sibling `attach_call_ids`/`detach_call_ids` fields, which were capped at 200 (matching `CallTrackingService.MAX_ATTACHABLE_CALLS`) by security review SCH-15 pass 8's addendum (2026-10-15, SCH-18). Each entry costs a per-member/per-type lookup, so an oversized submission is a cost multiplier on one request — abuse-resistance, not a data-isolation gap. `responding_members`'s existing 100-entry cap is a plausible precedent for the list; the dict has no clean existing ceiling since the call-type vocabulary itself is unbounded in org settings. (SCH-19)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

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

| Item                                                        | Status                                                                                                              | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A date range spanning a mode change omits one period**    | Narrowed (owner decision 2026-10-08: warn when the range predates the current mode; stamp from now on, no backfill) | `ReportsService.get_call_volume_report()` still picks its source from the organization's **current** `call_tracking.mode` and applies it to the whole range, so the figures are unchanged. **Since 2026-10-11** every save that changes the mode stamps `call_tracking.mode_since` (the department-calendar date; carried forward on saves that keep the mode, never client-settable), and the report returns `mode_since` / `range_predates_mode`; the renderer shows "Part of this range is missing" with the date. **What remains:** a department whose last change predates the stamp has no date and gets no warning until its next change (deliberately not backfilled), and the omitted period is still omitted — reading each shift under the mode in force when it closed is the full fix. (SCHED-14) |
| **"Total Calls" in detailed mode is not an incident count** | ✅ Resolved by rename (owner decision 2026-10-08: rename the figure, numbers unchanged)                             | The detailed branch sums `calls_responded` over `ShiftCompletionReport` rows, which are **per member** — so a shift two members reported contributes its calls twice, and manually filed reports are added alongside. **Since 2026-10-11** the detailed branch returns `counts_member_reports: true` and the renderer and CSV export call the figure **Member-Reported Calls** (with Avg/Peak to match) and explain it underneath; the numbers are unchanged. Sourcing an incident count from `shift_calls` remains the real fix if one is ever wanted. (SCHED-15)                                                                                                                                                                                                                                             |

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

| Item                                                                                                                                                                            | Status                                                                                                                                  | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Executive-session minutes need a viewer tier below `minutes.manage`?**                                                                                                        | Accepted by the owner (2026-10-05)                                                                                                      | MM-3 is fixed: plain `minutes.view` holders now see only approved, non-executive minutes; `minutes.manage` sees all. Follow-up open decision: if board members who attend executive sessions but don't hold `minutes.manage` should read executive minutes, a dedicated `minutes.view_executive` tier is needed (seed + roles + frontend). Also: frontend `canManage` uses `meetings.manage` while the backend uses `minutes.manage` — roles managing minutes should hold both. **Update (MM2-1, 2026-08-06):** publishing executive minutes to the shared Meeting Minutes document folder is now blocked, because that folder is readable by the broad `documents.view` audience and so bypassed the restriction. Sharing an executive session with a _restricted_ audience is the same build as the `minutes.view_executive` tier above (a restricted document folder or per-document permission), not a one-click publish. **Accepted by the owner (2026-10-05):** leave as is — only `minutes.manage` holders read executive minutes, and no `minutes.view_executive` tier is built.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Equipment-check: read endpoints bypass `equipment_check.view`; compliance metrics stubbed**                                                                                   | ✅ Resolved (2026-10-11, owner decision: gate reads on view and build the cadence counts)                                               | **Fixed earlier:** `complete_incomplete_check` re-applies the expired/under-min auto-fail rule (EC-10); `create_report` validates a client-supplied `trainee_id` is in-org (EC-6); `get_report` takes an org filter (EC-9). **EC-7:** the detail reads (`get_shift_checklists`, `get_check`, the template list/detail) gate on `inventory.check_view` OR `inventory.check_submit`; the routes still on bare `get_current_user` are self-scoped (`/my-checklists`, its history, the photo upload on the caller's org's check), scope themselves by permission (`/log`), or carry a router-level `check_manage` gate (the changelog). **EC-11, built 2026-10-11:** `get_compliance_report` counts an expected check as one per shift per applicable checklist — the fleet board's rule, through `EquipmentReadinessService.expected_checks_between` — so each apparatus carries `checks_expected` and `checks_missed` and the report's `overdue_count` is the missed total; owed checks only (a rig out of service or a check not yet due is not counted). No cadence setting and no migration. The Check Reports compliance tab, its CSV and PDF show them. Still flagged: a few by-id reads used only for changelog text lack an org filter (harmless, EC-8).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Public portal: per-process rate limiter + application-status token plaintext at rest**                                                                                        | ✅ Resolved (2026-10-05, owner decision PP-6)                                                                                           | **Both halves done (owner: "do both").** The portal's per-IP and per-API-key limits now count in Redis, shared by every worker (`_shared_window_hit` in `app/core/public_portal_security.py`), so the ceiling is the limit rather than workers × limit; the per-process caches answer only when Redis is down or a command fails (degraded, never unchecked). The applicant status token is looked up only by its SHA-256 (`status_token_hash`) and stored AES-256-GCM encrypted (`EncryptedText`) for the emails that re-send the link, so a database or backup read no longer yields a live token. Migration `f7c09cfec5b0` hashes and encrypts existing tokens in place — the token itself never changes, so links already in applicants' inboxes keep working. Tests: `test_public_portal_security.py::TestSharedRateLimit`, `test_status_token_at_rest.py`. **Resolved earlier from this cluster:** `authenticate_api_key` throttles the `last_used_at` write (≤ once/60 s per key) and `detect_anomalies` uses 2 COUNT queries instead of 3 (PP-7); the access-log viewer auto-escapes `user-agent`/`referer`/`ip` via JSX (no stored-XSS — PP-5). Accepted design limitations: the whitelist has no per-subfield granularity (a whitelisted `mailing_address` exposes the whole nested dict — intentionally-public org data, not member PII), and the ≥36-bit display code has no per-code lockout (bounded by the per-IP limit, now global). **Not covered:** `EventRequest.status_token` (the public event-request status link) is a separate credential on a separate table and is still plaintext at rest; it was not part of PP-6.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Onboarding: role editor accepts client-controlled permissions / priority / system-flag**                                                                                      | ✅ Resolved (owner decision 2026-10-11: clamp and allowlist)                                                                            | `save_session_roles` accepted client-supplied `permissions`, `priority` and `is_custom` (which set `is_system`), keyed on the client slug — so a setup session could mint a high-priority `is_system` role, rewrite an existing system role by slug, or emit near-arbitrary `{module}.*` grants. **Resolved 2026-10-11 (owner decision: clamp and allowlist):** before anything is written, every `permissions` key must be a module row the Positions editor renders (`ONBOARDING_POSITION_EDITOR_MODULE_IDS` — the frontend registry including Positions and Settings, held to `moduleRegistry.ts` by a test), else 400 naming the modules; a custom position may not reuse a built-in identifier (a `DEFAULT_POSITIONS` slug or an existing system row), else 400. A built-in position stores the registry priority (or its seeded row's own when the registry no longer lists it) — the client's figure is ignored, matching `RoleService.update_role` after setup; anything client-defined is clamped to one below the System Owner's `it_manager` (99). `is_system` now follows the registry, not the client flag: a non-custom slug the registry does not define (a template a stale draft remembers) is stored as an ordinary, deletable position. Three wizard templates whose displayed priority disagreed with the registry (Board of Directors, Historian, Fundraising Chair) were aligned. **What the editor can no longer express:** a custom position named like a built-in one, or a per-position priority of its own. Tested in `tests/test_onboarding_role_clamps.py`. (ONB-7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Onboarding: session TTL has no absolute cap, only a sliding 30-minute window**                                                                                                | ✅ Resolved (owner decision 2026-10-11: cap at 24 hours)                                                                                | `validate_session` renewed `expires_at` by another 30 minutes on every successful call with no maximum age, and three routes (`GET /system-info`, `/security-check`, `/database-check`) call it with `require_csrf=False`, so a holder of just the session id could keep the pre-completion window open indefinitely by polling. **Resolved 2026-10-11:** `SESSION_MAX_LIFETIME_HOURS = 24` in `api/v1/onboarding.py`. Both places that slide the expiry (`validate_session` and `get_or_create_session`) now clamp it to `created_at + 24h`, and `validate_session` refuses a session past that ceiling with 401 `ONBD_SESSION_INVALID` ("reached its 24-hour limit") even when an earlier poll had slid `expires_at` forward. Resuming a session past the ceiling mints a fresh one, which rehydrates the saved progress exactly as a 30-minute lapse does. Tested in `tests/test_onboarding_session_lifetime_cap.py`. (ONB2-30-8)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Onboarding: `/test/email`'s self-hosted SMTP test has no SSRF/private-network protection**                                                                                    | ✅ Resolved (owner decision 2026-10-11: unify error messages only — on-premises relays keep working)                                    | `POST /onboarding/test/email` (`platform: "selfhosted"`/`"other"`) connects via `smtplib` to a fully client-supplied `smtpHost`/`smtpPort`, reachable pre-auth while no organization exists. Differentiated errors (connection-refused vs. timeout vs. DNS-failure vs. wrong-protocol) let a caller fingerprint an internal `host:port`. **Resolved 2026-10-11:** private addresses stay allowed (blocking them would break the on-premises SMTP relays this audience runs), but the oracle is gone — the onboarding path now calls `test_smtp_connection_uniform`, which returns one message (`UNIFORM_SMTP_UNREACHABLE_MESSAGE`) and one set of detail keys (`error: "connection_failed"`, the echoed host/port/encryption/from) for **every** failure before a server greets as SMTP, including the endpoint's own 30-second timeout; the specific cause goes to the backend log only. After an SMTP greeting, authentication and TLS errors keep their specific messages. The authenticated **Settings → Email** test is unchanged. **What remains, accepted with the decision:** the connection is still made, so response **timing** still differs (a refused port answers at once, a filtered one after the 10-second socket timeout), and a target that greets as SMTP is distinguishable from one that does not — the latter is inherent in a test that can succeed. Tested in `tests/test_onboarding_smtp_uniform_errors.py`. (ONB-30-3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Core infra: fail-open TLS/image handling + latent cache isolation gaps**                                                                                                      | Partially resolved (2026-08-07); remainder accepted by the owner (2026-10-05)                                                           | (1) ✅ **Resolved as an opt-in.** Two distinct cases, now separated. "TLS enabled but peer unverified" (`DB_SSL`/`REDIS_SSL` on with no CA → `CERT_NONE`) was already CRITICAL and blocks boot in production/staging, waivable via `SECURITY_ALLOW_UNVERIFIED_TLS` — that configuration looks secure and is not, which is worse than honest plaintext. "No TLS at all" is governed by **`SECURITY_REQUIRE_TLS`** (default `True`): absent `DB_SSL`/`REDIS_SSL` is promoted from WARNING to CRITICAL and refuses to start. A deployment with equivalent transport protection (private network, service mesh, or sidecar) must explicitly set the flag to `False`, so plaintext transport is no longer silently permitted. Covered by `tests/test_tls_required_config.py`. (2) ✅ **Resolved (CI-9).** `optimize_image` (`app/utils/image_processing.py`) now fails closed: an image over 25 million pixels (`MAX_INPUT_PIXELS`) is rejected with `DecompressionBombError` before it is decoded, the image is verified and fully loaded, and any processing error propagates and rejects the upload instead of returning the original bytes — so a failed image is no longer stored unprocessed with its EXIF/GPS intact. (It previously failed open: a valid-header decompression bomb or any processing error returned the original bytes, and no local pixel cap was set.) (3) Redis TLS disables cert + hostname verification when no CA is configured (`CERT_NONE`). (4) The Redis cache manager provides no tenant namespacing — all current callers use intentionally-global keys (no PHI cached), but there's no guardrail against a future caller caching an org-scoped record under a bare id; `clear_pattern()` is an unused wildcard-delete footgun. (5) WebSocket `accept()` precedes auth (deliberate, so close codes reach the browser). **Owner decision (2026-10-05): fix image handling only** — item (2), already built. Items (3) Redis `CERT_NONE` without a CA and (4) the cache's lack of tenant namespacing (and the unused `clear_pattern()`) are accepted as they are: no guardrail or verification change will be made, and a future caller caching an org-scoped record must namespace its own key. (CI-9/CI-10)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Crypto: AES-256-GCM + 600k PBKDF2 done; MFA recovery-code entropy raised**                                                                                                    | Partially resolved (LOW)                                                                                                                | **Done:** at-rest field encryption now uses **AES-256-GCM** (authenticated; a tampered value fails closed via `InvalidTag`). Legacy Fernet (AES-128-CBC + HMAC) values remain readable, and `scripts/reencrypt_to_aesgcm.py` backfills existing rows to GCM (run it against staging with a DB backup first — it is dry-run by default; see `docs/AES256_GCM_BACKFILL_RUNBOOK.md`). Once the backfill is verified complete, Fernet read-support can be removed. **Also done (app-review B24):** the KDF work factor for new (`$gcm2$`) values is now **600k** PBKDF2-HMAC-SHA256 iterations (the 100k `$gcm1$` path is read-only for migration-era values). **Also done (CI-10, owner decision 2026-10-05: upgrade on next regeneration):** new MFA recovery codes carry 80 bits (`_RECOVERY_CODE_BYTES = 10`, shipped in #2722), which puts an unsalted SHA-256 lookup table out of reach; codes issued before that keep verifying until the member regenerates, so nothing was invalidated (`test_a_code_issued_before_the_upgrade_still_verifies`). (CI-5 + PBKDF2 done / recovery-codes CI-10 / CI-4 fail-closed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Security/IP: audit-chain rehash laundering + break-glass gate**                                                                                                               | ✅ Resolved                                                                                                                             | `rehash_chain` used to recompute `current_hash` from each row's current `event_data` for **every** row, so a privileged operator with DB write access could edit a keyed (v2) row and run rehash to launder the tamper into a valid keyed chain. Rehash now only repairs legacy (unkeyed) rows and **fails closed** (409) on a keyed-row mismatch — it never rewrites a keyed row. And because rehash rewrites the single cross-org chain and there is no platform-super-admin role, `POST /audit-log/rehash` is now disabled (403) unless a server operator sets `AUDIT_ALLOW_CHAIN_REHASH=true` (env = the de-facto platform-admin boundary), so an ordinary org admin holding `audit.export` can no longer trigger a platform-wide chain rewrite. (SEC-7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Security/IP: global country-block table + geo fail-open**                                                                                                                     | ✅ Resolved                                                                                                                             | Geo-blocking is a platform-edge control (enforced before any tenant/auth context, against one shared MaxMind DB + one global blocked-country set), so per-org `CountryBlockRule` rows don't fit the enforcement model. Instead: (1) `GEOIP_FAIL_CLOSED` (default False) makes `is_ip_blocked` block any IP whose country can't be resolved — including the missing/corrupt-DB case — closing the "silently disabled app-wide" hole; private/reserved IPs are still allowed first, so an internal operator can recover (correction 2026-08-27: allowlisted IPs are no longer part of that recovery path; resolved 2026-10-05 by a dedicated per-IP allowlist lookup kept separate from this recovery path — see `docs/security-review/SEC2-28-security-audit-ip.md` → SEC2-28-5). (2) The two mutating country-rule endpoints are gated by `GEOIP_ALLOW_COUNTRY_RULE_MANAGEMENT` (default False), so an org admin can no longer alter the shared cross-tenant blocklist via the API — the operator sets it at deploy time via `BLOCKED_COUNTRIES`. The non-destructive audit-chain ops (`/checkpoint`, read-only `/integrity`) remain on `audit.export`/`audit.view`. (SEC-8)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Security monitoring: anonymous brute-force alerts on a multi-organization install have no viewer**                                                                            | Open — needs a platform-operator design (narrowed 2026-10-05)                                                                           | The rest of this item is resolved (owner decision SEC2-28-alerts, "build UI + backend fixes"): `/admin/security-alerts` lists, acknowledges and resolves alerts with an attributed audit trail; the exfiltration check sizes exports from the bytes sent rather than a `Content-Length` header and matches parameterized export routes; every export is logged (route, size, member, IP — never the content or query string) and listed under `GET /security/download-activity`; and a failed sign-in against a known account now attributes its brute-force alert to that account's department, while a single-organization install attributes every tenant-less alert to its one department. **What remains:** on an installation hosting **more than one** organization, a brute-force alert against an _unknown_ username belongs to no tenant and is stored with `organization_id = NULL`, which no org-scoped view returns. Showing it needs a decision on who may see login-page activity that is not their department's — a platform-operator role, which this codebase does not have — and that is not inferred here. See `docs/security-review/SEC2-28-security-audit-ip.md` → SEC2-28-7.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Security/Audit: the hash chain had no write-concurrency control — two simultaneous audit-log writes forked the chain, and `verify_integrity` reported the fork as tampering** | ✅ Resolved (2026-10-12, owner decision: rows stay in the caller's transaction; a separate sealer orders and hashes them)               | **Was:** `AuditLogger.create_log_entry` read the chain's last row (for the new row's `previous_hash`) with a plain, non-locking `SELECT`, inside the caller's transaction. Two writers on two sessions read the same last row and wrote the same `previous_hash` (100% reproduction on a fresh chain); `verify_integrity` then reported `"Chain broken"` and `get_security_status` raised a `LOG_TAMPERING` CRITICAL alert. Reachable unauthenticated through `IPBlockingMiddleware._log_blocked_attempt`, which writes an audit row on its own session for every blocked request. **Now:** the write and the chain are separate steps. `create_log_entry` inserts the row in the caller's transaction exactly as before — a rolled-back action leaves no row, and a caller that aborts when the audit write fails keeps that guarantee — but with `chain_seq`, `previous_hash`, `current_hash`, `hash_version` and `signing_key_id` all NULL. `AuditLogger.seal_pending`, in its own short transaction, locks the single `audit_chain_head` row (`SELECT ... FOR UPDATE`), seals the committed unsealed rows in id order (position, previous hash, HMAC under the existing v4 scheme, key id), advances the head and commits. Two sealers serialize on that row and cannot fork; no lock is taken inside a caller's transaction. Migration `bcd688674099` adds `audit_logs.chain_seq` (unique; backfilled to `id`, the old chain order), makes the two hash columns nullable and creates `audit_chain_head`, seeded from the current tail so existing chains continue without a break. **When the sealer runs:** every commit that carried audit rows starts it in the background (a `Session` `after_commit` hook; one in-flight sealer per process, so a burst of blocked requests cannot open a connection per row), at startup before the integrity check, and from the `audit_chain_seal` scheduled task every minute as the backstop for anything those missed (a worker that exited first, a failed attempt). **Chain order is `chain_seq`, not id:** a transaction that inserts early and commits late is sealed after rows with higher ids. `verify_integrity` and `rehash_chain` walk by `chain_seq`; off-host shipping (SEC2-28-9) ships only sealed rows, in chain order, and its watermark (`audit_ship_state.last_shipped_id`, kept under its old name) now holds a chain position — equal to the id for every row sealed before the change; batches also carry `X-Logbook-First-Seq`/`Last-Seq`; retention purges only at a checkpoint boundary that is a clean prefix of the chain, and checkpoints refuse a range containing an unsealed row. **Left open, by design:** a row is unsealed between its commit and the seal — normally milliseconds, at worst until the next scheduled run (about a minute) if the after-commit seal failed. In that window it is not verified, not shipped and not checkpointable; `verify_integrity` reports it in `pending_seal` instead of as tampering, so a non-zero count that persists past a minute means the sealer is failing, not that the log was altered. The downgrade refuses while any row is unsealed, and after it the previous code verifies in id order, so a row that was sealed out of id order reads as a broken link until re-upgraded. Tests: `tests/test_audit_chain_sealing.py`. See `docs/security-review/SEC2-28-security-audit-ip.md` → SEC2-28-10. |
| **Compliance: reporting correctness & email abuse-surface polish**                                                                                                              | Partially resolved (LOW/MED)                                                                                                            | **Fixed:** the report email HTML now `html.escape`s the org name, `report_type`, and period label (was raw interpolation of user-controlled values — mail-client HTML/script injection); `report_type` is constrained to `monthly`/`annual` (was free-form, persisted + interpolated). **Still flagged:** report emailing accepts client-supplied recipients (external auditors are a legitimate case — **owner decision 2026-08-09: allow any recipient, but audit-log each send to a non-member address**; `_email_report` now calls `audit_external_recipients`, which writes an `external_recipient_send` audit event listing every out-of-org address); attestation history over-fetch is **resolved** — this row previously said it was still blocked on a deferred `audit_logs.organization_id` column; that column was added and the query updated on 2026-07-30 (`d07a51821`, "Add organization_id to the audit log with org-scoped reads"), and `get_attestation_history` (`compliance_officer_service.py`) has filtered `AuditLog.organization_id == str(organization_id)` directly in the query — not a global fetch with Python-side filtering — since before this row's own last edit; corrected here during the CMP-20 security-review pass 8 re-verification (2026-10-16); `records_with_certification` mislabel left as-is (ambiguous intent). (CS-9)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Compliance: "notify non-compliant members" / reminder-days settings were stored but never sent**                                                                              | ✅ Resolved 2026-10-11 (owner decision: build the daily email task — settings work as configured, email-first)                          | **Resolved per the owner's decision.** The daily `compliance_member_notices` scheduled task (`app/services/compliance_member_notices.py`, registered in `TASK_RUNNERS`/`TASK_INTERVALS_SECONDS`) reads both settings, each on its own: `notify_days_before_deadline` emails a member a reminder for each unmet requirement whose deadline (the end of its current compliance window, or the member's catch-up deadline) is that many days away — the most urgent begun window, so a missed run still sends; `notify_non_compliant_members` emails a member whose standing is `non_compliant` a notice listing what is unmet. Members are graded by the shared evaluator (`training_compliance.grade_org_members`, the same rules as `compute_org_compliance_tally`), so the emails agree with the dashboard and matrix. Email only (`EmailKind.TRAINING_REMINDERS`, honouring a member's opt-out unless the department requires it); idempotent through email-channel `NotificationLog` rows keyed by (requirement, deadline, offset) and by the unmet (requirement, window) set. The panel's "Not yet active" warning is gone. **Behaviour to know on upgrade:** a department whose saved configuration holds the suggested `[30, 14, 7]` starts sending reminders on the first run; clearing the list stops them. **Not changed:** `grace_period_days` is still not consulted by any grading (outside this decision; the configuration page says so). Tests: `tests/test_compliance_member_notices.py`. (CMP2-1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Finance: no separation of duties on terminal money movement**                                                                                                                 | ✅ Resolved (owner decision: same-person guard, no new role)                                                                            | **Resolved 2026-10-11 per the owner's decision — guard the same person on every disbursement, add no new role.** The request **approval step** calls the shared `assert_different_person` guard, so one person cannot both raise a purchase/check request and approve it. `mark_pr_paid`, `mark_expense_paid`, `issue_check` and `waive_dues` each compare the actor against the request's `requested_by` / the expense's `submitted_by` / the dues member and refuse on a match. **`record_dues_payment` now does the same** (`recorded_by` vs `dues.user_id`, refused before the ledger is touched), matching its storefront analogue `record_payment` and its sibling `waive_dues` on the same record — the gap OPS-8 recorded. `void_check` and `unwaive_dues` take no actor and are reversals that move money _away_ from the actor, so they are correctly unguarded. **Accepted, by decision:** there is no distinct `finance.disburse` permission, so this is self-dealing prevention rather than three-way separation — a `finance.manage` holder can still execute an already-approved payment that somebody else raised. The owner chose this over a new role because a small department would need a second holder of it. A treasurer paying their own dues must have another `finance.manage` holder record it. Tests: `tests/test_dues_payment_guards.py::TestRecordingYourOwnDuesIsRefused`, `tests/test_money_separation_of_duties.py`. (FIN-4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Finance: dues administration has no UI — every write is API-only**                                                                                                            | ✅ Resolved (owner decision, 2026-10-11)                                                                                                | _Resolved 2026-10-11 (owner: "build it — documented click-paths become real")._ **Finance › Dues** now carries, for a `finance.manage` holder: **New schedule** / **Edit schedule** (`DuesScheduleDialog`), **Generate dues** behind a confirmation, **Record payment** (`DuesPaymentDialog`, amount prefilled with what is owed), **Waive** and **Reverse waiver** (reason required, `PromptDialog`), and a **Payment history** dialog over `GET /finance/dues/{id}/payments` for every reader. `GET /finance/dues` now sends each row's `memberName`, so the list names members instead of showing a user id. **Still open:** the schedule form offers only name, amount, frequency, due date, notes and active, because nothing reads the stored grace period, late fee, fiscal year or membership types (pitfall #19) — generation bills every active member and no late fee is ever charged; the payment history does not show who recorded each payment (the id is stored, the name is not sent). See `docs/training/11-finance.md`, "Dues & Assessments".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Finance: correctness/DoS polish (export, pagination, request numbers, float aggregates)**                                                                                     | ⚠️ Mostly resolved (re-verified, security-review FIN-05 pass 4, 2026-09-08; corrected same-day, Codex review on PR #2398)               | This row had gone stale — the items marked "still flagged" below were already fixed on `main` (in the finance-approvals security-review's own earlier passes, never threaded back into this row). Re-verified directly against current code: `_generate_request_number` is MAX-of-suffix-based with a per-org unique constraint and a SAVEPOINT retry allocator (fixed 2026-07-31); every list method the original finding named (`list_purchase_requests`, `list_expense_reports`, `list_check_requests`, etc.) pushes `.offset()`/`.limit()` into the SQL query, none fetches-all-then-slices; `generate_export` caps at `max_records=10_000` and streams in 500-row batches via `SafeCsvWriter`; `_mutate_budget` takes a locking read and raises `BudgetLimitExceededError` whenever a spend/encumbrance would exceed `amount_budgeted`, fail-closed with no override. Money storage and arithmetic are `Decimal`/`Numeric(12,2)` throughout; the only remaining `float()` casts are two percentage/rate display roundings, not currency math (one needless `Decimal`→`float`→`Decimal` round-trip on `entity_amount` in `get_pending_approvals` was found and removed this pass). **Still open:** `list_dues_payments` (`GET /dues/{dues_id}/payments`) is also a list method and does not paginate — it eager-loads one member's entire payment ledger unbounded (this row's own first correction overclaimed "every list method" before Codex review caught the exception); left flagged rather than fixed since pagination would change the endpoint's response shape. **Owner decision (2026-10-05): leave as is** — one member's dues ledger is small, so `GET /dues/{dues_id}/payments` stays unpaginated. _(2026-10-04: `get_pending_approvals` now filters to the steps the caller is the named approver of — the step's `approver_type`/`approver_value`, matched by `finance_approver_matching.py`, needed no new assignee field — and approve/deny enforce the same rule; see `docs/FINANCE_MODULE.md` → "Who may act on a step".)_ (FIN-7/FIN-30; see `docs/module-audit/finance.md`'s FIN-7 entry for the full re-verification.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Recurring: create/update paths trust client-supplied FK ids without an org check (XC-1)**                                                                                     | ✅ Resolved (2026-10-11, owner decision XC-1: roll out per module)                                                                      | The dominant cross-cutting pattern — create/update methods stored `user_id`/`category_id`/`assignee_id`/etc. without verifying the referenced row is in-org. **Closed by the 2026-10 sweep:** every create/update path in the 134 services and their endpoints was reviewed; the ones still unvalidated now call `assert_in_org` / `assert_all_in_org` (`app/utils/org_scoping.py`) before any write — departure clearances, election eligible voters, minutes attendees, inline form conditions, training course/category/requirement/skill/program references, session locations, competency matrices, module-config apparatus, shift patterns, shift-report equipment checks, the event-request default coordinator, inventory requests/allowances/exposures, apparatus equipment catalog links and report filters. Everything else was already validated by an org-scoped fetch or a local helper. Tests: `backend/tests/test_xc1_*.py`. A JSON program import keeps only this department's own `target_roles` rather than refusing. New code must keep doing this — pitfall #14c; there is still no repo-wide machine check for it. Details in [`docs/module-audit/CROSS-CUTTING.md`](./module-audit/CROSS-CUTTING.md) (XC-1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Email attachments: the detected MIME type is validated, then discarded**                                                                                                      | ✅ Resolved 2026-10-08 (owner decision 2026-10-05: reject on mismatch, with OOXML/zip equivalence; LOW, 2026-09-09, app-review MAIL-22) | `upload_attachment` sniffs the real content type with `detect_mime_type` (`email_templates.py:616`), uses it to accept or reject the upload (`:623`), and then persists `content_type=file.content_type` (`:665`) — the **client's claim**, which is what the send path attaches the file as. Extension and content are each checked against their own allowlist and never against each other, so a file named `.pdf` whose bytes are `image/svg+xml` satisfies both and is mailed out declared as `application/pdf`. Impact is bounded by who can reach it — the uploader already holds `settings.manage` — which is why this is LOW; the substance is that the code does the expensive, correct thing and throws the answer away. **Why not fixed in the review that found it: the obvious fix is wrong.** `.docx`/`.xlsx`/`.pptx` are ZIP containers and libmagic commonly reports `application/zip` for them, which is exactly why `ALLOWED_EMAIL_MIME_TYPES` lists both `application/zip` and the three OOXML types — so simply storing `detected_mime` would attach a Word document as a zip and mail clients would present it as one. The real change is a consistency check between the extension and the detected type, carrying an explicit OOXML/zip equivalence, plus a decision on what to do on mismatch: reject the upload, or accept it and store the detected type. Both are defensible and the choice is the owner's. Note the `MAIL-` prefix is shared with `docs/security-review/MSG-25-messaging-notifications.md`, whose own MAIL-1…5 are unrelated to this row. See [`docs/app-review/email-templates.md`](./app-review/email-templates.md) → Pass 5. **Resolved in `ce50c5c6b` (2026-10-08).** `upload_attachment` (`email_templates.py`) now stores the file through `FileStorageService` with `keep_consistent_extension`, which rejects an upload whose extension and sniffed content disagree (`file_storage_service.py`), treating `application/zip` as consistent with `.docx`/`.xlsx`/`.pptx` (`mime_validation.py`); the stored `content_type` is the detected type, not the client's claim. The text above describes the code before that commit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Application Review — Feature Rotation (2026-08-05)

Owner-decision items from the feature-by-feature review under
[`docs/app-review/`](./app-review/PROGRESS.md).

| Limitation                                                                                                                           | Status                                                                                                   | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Admin hours: `export_entries_csv` was unbounded and non-streaming**                                                                | ✅ Resolved 2026-10-11 (owner decision: stream all three — no cap, bounded memory)                       | **Resolved per the owner's decision to stream all three sibling exports rather than cap them**, so the files stay complete and the response contract is unchanged. `GET /admin-hours/entries/export` reads its rows through a server-side cursor (`app/utils/streamed_query.iter_row_batches`, 500 rows a batch) and writes each batch to the response as it is read; `GET /storefront/orders/export` writes and sends each page of orders before reading the next; the training report CSVs (`POST /training/reports/export` — compliance, member records, hours summary, certification) send one member at a time, and the certification report reads its records through the same cursor. All three write through `SafeCsvChunks` (a drained `SafeCsvWriter`), and the request's database session stays open until the body is sent (FastAPI's request-scoped `get_db`). The string-returning `export_entries_csv` / `export_orders_csv` / `generate_*_csv` remain for callers that need the whole document, and are now joins of the stream. **What remains:** a failure part-way through arrives as a truncated download rather than an HTTP 500, because the status line has already been sent — validation and the lookups each export needs are done before streaming starts so an ordinary error still returns its status; the individual-member CSV (one member's history) and the three training PDFs are still built whole before download — the decision covered the CSV exports, and on 2026-10-12 the owner accepted leaving these as they are: one member's history and the training PDFs are small and bounded, and a streamed PDF would turn a failure into a broken file instead of an error. Tests: `tests/test_streamed_exports.py` (unit + integration against a real cursor). (AH-16; `docs/security-review/AH-21-admin-hours.md`.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Admin hours: no per-org self-approval override; a resync can grow an already-approved entry past its threshold without re-review** | ✅ Resolved (owner decision 2026-10-05: toggle + re-queue above a threshold)                             | Both items closed. (1) `admin_hours.allow_self_approval` in the organization settings (off by default; writable only under `settings.manage`, not `admin_hours.manage`) lets a sole-officer department approve its own entries on the single and bulk paths; a self-approval still records `approved_by == user_id`. (2) A resync that grows an `APPROVED` attendance entry by more than `admin_hours.resync_requeue_growth_percent` (default **25**, 0–1000, per department) into a length its category would not auto-approve returns it to Pending Review. Both are shown and edited on the **Review Rules** tab at `/admin-hours/manage`. (`app/utils/admin_hours_settings.py`; `tests/test_admin_hours_review_settings.py`; `docs/security-review/AH-21-admin-hours.md`.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Storefront: no reconciliation backfill**                                                                                           | ✅ Resolved (2026-10-06, owner decision SF-backfill)                                                     | Previously: if PayPal's verify-webhook-signature API was unreachable the webhook returned 401, PayPal eventually stopped retrying, and the capture was absent from the ledger with no way to re-ingest it. **Now:** the daily `paypal_capture_backfill` scheduled task (also runnable through `POST /scheduled/run-task`) lists each enabled PayPal integration's successful incoming transactions for the last 7 days through Transaction Search, skips ids already in `store_payment_events`, re-reads each remaining one from the Payments API capture endpoint, and records only a capture that endpoint reports COMPLETED — through the webhook's own `record_external_payment`, so matching and auto-apply are identical. Idempotent with the webhook on the (org, provider, capture id) unique key; a lost race now returns the winning row instead of erroring. **Operator requirement:** the department's PayPal REST app needs the Transaction Search permission; without it the task logs a clear error to that department's error monitor and records nothing. Captures that were refunded before the backfill saw them are not recorded (the webhook path records only completed captures either). (SF future-dev #1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Consent enforcement**                                                                                                              | ✅ Resolved (2026-08-05) for SMS; the other two types have no consumer                                   | `ConsentService.has_consent` had **zero callers** — members could refuse `PHOTO_USE`, `PUBLIC_ROSTER_LISTING` and `SMS_NOTIFICATIONS` and be ignored. Enforcement was blocked on a backfill decision, since "never asked" counts as refused and wiring it in would have stopped SMS to every existing member. **Owner's rule removed the blocker:** messages always go to the member's email, so consent suppresses the text but never the notice. SMS is now consent-gated in both send paths (department-message escalation and the inventory low-stock alert) via a new bulk `granted_user_ids` helper, and email is unconditional — sent for every department message and no longer filtered by the `email_notifications` preference, which still governs the seven reminder/alert flows. **Still open:** `PHOTO_USE` and `PUBLIC_ROSTER_LISTING` have no consumer to gate — there is no public roster or public photo publishing in the app today. Whoever builds them must gate on `has_consent`; the requirement is recorded in the `consent_service` docstring. (AUTH-2)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Cohort: a few create fields are still API-only**                                                                                   | ⚠️ Narrowed (2026-10-06) — room booking resolved; minor fields open                                      | **✅ Room booking (CC-2) is resolved:** the owner chose a per-cohort room with a per-class override. The cohort wizard sets the cohort's room on its Schedule step and lets each class be moved to another room on the Preview step; the syllabus builder sets a class's own room. The preview now takes the cohort room and the per-class overrides, validates every location id in-org, resolves each class's room with the same helper generation uses (`_class_location`: wizard pick, then syllabus row, then cohort) and runs the double-booking check on that room, so "Location already booked" fires before anything is created (`tests/test_cohort_location_picker.py`). **Still open:** `description`, `notes`, `requires_rsvp`, `auto_create_records` and `default_duration_minutes` on `CourseCohortCreate` remain API-only — the wizard sends the defaults. Low value; recorded so the next pass does not rediscover them. (CC-2)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Onboarding: role editor accepts client-supplied permissions/priority/system-flag**                                                 | ✅ Resolved (owner decision 2026-10-11: clamp and allowlist)                                             | `save_session_roles` accepted client-supplied `permissions`, `priority` and `is_custom` (which set `is_system`), keyed on the client slug — so a setup session could mint a high-priority `is_system` role, rewrite an existing system role by slug, or emit near-arbitrary `{module}.*` grants. **Resolved 2026-10-11 (owner decision: clamp and allowlist):** before anything is written, every `permissions` key must be a module row the Positions editor renders (`ONBOARDING_POSITION_EDITOR_MODULE_IDS` — the frontend registry including Positions and Settings, held to `moduleRegistry.ts` by a test), else 400 naming the modules; a custom position may not reuse a built-in identifier (a `DEFAULT_POSITIONS` slug or an existing system row), else 400. A built-in position stores the registry priority (or its seeded row's own when the registry no longer lists it) — the client's figure is ignored, matching `RoleService.update_role` after setup; anything client-defined is clamped to one below the System Owner's `it_manager` (99). `is_system` now follows the registry, not the client flag: a non-custom slug the registry does not define (a template a stale draft remembers) is stored as an ordinary, deletable position. Three wizard templates whose displayed priority disagreed with the registry (Board of Directors, Historian, Fundraising Chair) were aligned. **What the editor can no longer express:** a custom position named like a built-in one, or a per-position priority of its own. Tested in `tests/test_onboarding_role_clamps.py`. (ONB-7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Roles: the org-wide `member` role can be mass-escalated up to the caller's ceiling**                                               | ✅ Resolved (owner decision 2026-10-05: confirmation naming the member count)                            | Editing the baseline `member` role's permissions is still allowed up to the caller's own grant ceiling — that is how a capability is rolled out org-wide — but Role Management now opens a confirmation before saving any permission change to it, naming the permissions granted or removed and how many members hold the position (from `GET /roles`' `user_count`). A rename or description edit does not ask. (`RoleManagementPage.tsx`; ORU-7c.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Scheduling: swap accept-path skips target re-validation + weaker approver check**                                                  | ✅ Resolved (confirmed by security review SCH-15 pass 2, 2026-08-28)                                     | Duplicate of the "swap accept-path re-validation & self-approval; finalize manual_hours" row above; kept rather than deleted since this was the original app-review wording and other docs may still cross-reference it. See that row for the resolution mechanism. (SCH-5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Grants: no financial state machine or overspend guard**                                                                            | ✅ Resolved 2026-10-11 (owner decision: state machine + warn on overspend)                               | **Resolved per the owner's decision.** `APPLICATION_STATUS_TRANSITIONS` in `app/models/grant.py` is the grant lifecycle, whose individual steps the owner reviewed and accepted as built on 2026-10-12 (drafting stages move freely among themselves and to Submitted; Submitted/Under Review advance to a decision; Denied may reopen to Researching; Awarded -> Active <-> Reporting -> Closed, Awarded may close directly; Closed may reopen to Reporting only), and `update_application` refuses any other status change with a 400 naming the allowed next statuses, before anything is written. `GrantApplicationResponse.allowed_next_statuses` reports the same set, and the edit form's status picker offers only it plus the current status; a new application may still start at any status. **Overspend warns, never blocks:** `app/utils/grant_spending.py` measures it once — `overspent_by` on the application (total expenditures vs `amount_awarded`) and on each budget line (spent vs budgeted), plus `total_expended` — and the expenditure create/update responses carry `warnings` when the write leaves the grant or its line over; each such write is audited as `grant_overspend_recorded` (severity warning). The application page shows a standing warning while spending exceeds the award. **Not in this decision, left as is:** other fields of a Closed grant remain editable (the lifecycle governs status only), and lowering `amount_awarded` below what has been spent is accepted — the standing warning then shows. The duplicate-compliance-task half was already resolved by GF-14 (`compliance_tasks_generated`). Tests: `tests/test_grant_lifecycle.py`, `GrantApplicationFormPage.lifecycle.test.tsx`, `GrantDetailPage.overspend.test.tsx`. (GF-7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Grants: `is_anonymous` donations showed donor identity to staff**                                                                  | ✅ Resolved 2026-10-11 (owner decision: hide from `.view`, show to `.manage`)                            | **Resolved per the owner's decision.** `app/services/donor_privacy.py` presents gifts and donors for the caller: to a caller without `fundraising.manage`, an anonymous donation comes back with `donor_name`, `donor_email` and `donor_id` cleared (`GET /grants/donations`, and the dashboard's `recent_donations`), and an anonymous donor comes back as first/last name "Anonymous" / "donor" with email, phone, address, company, notes and `user_id` cleared (`GET /grants/donors`, `GET /grants/donors/{id}`), `is_anonymous` still true beside the placeholder. A view-only donor search no longer matches anonymous donors, so the hidden name cannot be confirmed by searching for it. `fundraising.manage` sees everything, for receipting. Amount, date, campaign and payment fields stay visible — totals are built from them. **Accepted:** the donation flag and the donor flag are applied separately (a named gift from an anonymous donor shows the name typed on the gift), the donors list is still ordered by the real name, and a donor's id remains visible as the record's own id. Tests: `tests/test_anonymous_donations.py`. (GF-8)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Grants: dashboard KPI status links don't match the multi-status aggregate the KPI counts**                                         | ✅ Resolved 2026-10-11 (owner decision: grouped filter option — links match counts)                      | **Resolved per the owner's decision.** The status sets the dashboard counts are now one definition, `APPLICATION_STATUS_GROUPS` in `app/models/grant.py` — `active` (active, reporting), `pending` (researching through under_review) and `funded` (awarded, active, reporting, closed) — used by both `get_dashboard_data()` and a new `status_group` filter on `GET /grants/applications` (unknown group → 400). The **Active Grants**, **Pending Applications** and **Total Grant Funding** cards link to `/grants/applications?group=active                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | pending | funded`, and the applications page's Status filter offers the three groups beside the single statuses. In the pipeline each column asks for its own status *within* the group, so the server decides membership and the page does not re-derive it. `?status=<one value>`links still work. Tests:`tests/test_grant_applications_paging.py`, `GrantsDashboardPage.kpiLinks.test.tsx`, `GrantApplicationsPage.paging.test.tsx`. (GF-27a) |
| **Grants: the applications page loads at most 1,000 applications, in either view**                                                   | ✅ Resolved 2026-10-11 (owner decision: build pagination — no truncation)                                | **Resolved per the owner's decision.** `GET /grants/applications` now reports the number of matching applications in `X-Total-Count` and takes `search` (program name or agency, `like_pattern`-escaped), `sort` (a whitelisted camelCase field; priority sorts by urgency; missing dates/amounts last) and `order` — all additive; the response body is unchanged. The table view pages through the server with the shared pager (25 a page by default, sizes 10–100) and sorts server-side, so a sort covers every application rather than the loaded page. Each pipeline column fetches its own status 25 cards at a time with **Show more**, and its header shows the server's total for the column. **Behaviour change:** search no longer matches the assignee — the field holds a user id, so the old client-side match was against a UUID. Tests: `tests/test_grant_applications_paging.py` (unit + integration), `GrantApplicationsPage.paging.test.tsx`. (GF-33)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Grants/fundraising: money fields were unbounded; donor contact details went to `fundraising.view`**                                | ✅ Resolved (2026-10-21, owner decision: tiered ceilings; contact details need manage)                   | **Resolved 2026-10-21.** (1) Every money field on a grants/fundraising request schema is now bounded: a donation or pledge must be above $0 and at most $1,000,000; awards, budgets, expenditures, campaign and event goals and budget-summary categories are capped at $100,000,000; $0 stays valid where it means something (a denied grant's award, a free ticket). The bounds are on the request schemas only (`app/schemas/grant.py`: `MAX_GIFT_AMOUNT`, `MAX_AMOUNT`), so a row written before them, including a $0 donation, still serializes; only new writes are checked. (2) A caller with only `fundraising.view` now reads donor names, type, company, totals and dates; email, phone, postal address, notes, communication preferences and the linked member account need `fundraising.manage` (`app/services/donor_privacy.py`, `DONOR_CONTACT_FIELDS`), a donation's `donor_email` follows the same rule, and a view-only donor search no longer matches on email. `DonorResponse.contact_hidden` tells a screen why a field is blank. Tests: `backend/tests/test_grant_money_bounds.py`, `test_donor_contact_privacy.py`. The original description follows. **Two of GF-9's three original gaps, not yet decided; the third (float-money math in the two report methods) was fixed 2026-10-07 and is not part of this row.** (1) Every money field in `app/schemas/grant.py` — grant amounts, pledge/donation amounts, campaign goals — is `Field(..., ge=0)`/`Field(None, ge=0)`: rejects negative, accepts $0, has no upper bound. A $0 or absurdly large award/donation is accepted and flows into every total and report unflagged. (2) `app/services/donor_privacy.py` (GF-8, resolved 2026-10-11) only masks a donor's identity when is_anonymous=True; for every other donor, list_donors/get_donor still return the full DonorResponse — email, phone, address, company, lifetime total, dates — to any fundraising.view holder, with no narrower read-only projection for non-managers. Re-confirmed open at security-review pass 9 (2026-10-20), by direct code read, not carried forward from pass 8's wording; pass 9 also found that the new `GrantBudgetSummary` fields added that pass (an amount per budget category, `app/schemas/grant.py:301-309`) are minted in gap (1)'s exact shape (`Field(None, ge=0)`, no upper bound), so the open item now covers them too, without a new finding id. See docs/security-review/GF-22-grants-fundraising.md's "GF-9 split" section (introduced pass 7) and its Pass 8/Pass 9 re-verifications. (GF-9) |
| **Medical supplies: expiring-lot list has no row cap**                                                                               | ✅ Accepted by the owner (2026-10-05: leave as is; LOW)                                                  | `InventoryService.get_expiring_lots` (backs `GET /medical-supplies/lots/expiring`, the equivalent gear-side route, and the low-stock/expiring alert email) has no `limit`/pagination — a department that never clears old zero-or-positive-quantity expired lots gets every matching row back to the start of the `days_ahead` window, unbounded. Not a mechanical medical-supplies patch: the method is shared with the main inventory router and `scheduled_tasks.py`'s alert email, so a cap changes those callers' contracts too (would the alert silently omit rows past the cap?) — needs a decision on page size per caller, not a drive-by limit. Found by Codex review, security-review PR #2075 (MSUP-23 pass 2); see `docs/security-review/MSUP-23-medical-supplies.md` MSUP-4. (MSUP-4) **Owner decision (2026-10-05): leave as is.** No cap is added to `get_expiring_lots` for any caller; the alert email keeps listing every matching lot.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Medical/gear supplies: a single item's stock-lot list has no row cap**                                                             | ✅ Accepted by the owner (2026-10-05: leave as is; LOW)                                                  | `InventoryService.list_lots` (backs `GET /medical-supplies/items/{id}/lots` and the equivalent gear-side route) returns every lot ever recorded against one item with no `limit`/pagination, and neither frontend screen pages through the result — both treat it as the item's complete lot history. An item restocked frequently over years without its depleted lots ever being deleted accumulates an unbounded row count. Not a mechanical patch: a cap changes what "the item's lots" means to both callers, with no pagination UI on either screen to receive a later page — needs the same kind of per-caller page-size decision MSUP-4 needed, not a drive-by limit. Found by Codex review, security-review PR #2301 (MSUP-23 pass 3); see `docs/security-review/MSUP-23-medical-supplies.md` MSUP-11 (this row was mislabeled MSUP-10 until security review pass 11, 2026-09-11 — MSUP-10 is a different, already-fixed finding in that same pass, the `add_lot` opening-balance race). (MSUP-11) **Owner decision (2026-10-05): leave as is.** An item's lot list stays its complete history, unpaginated, with depleted lots included.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Medical/gear supplies: the general item edit form has no lot-stocked awareness**                                                   | ✅ Resolved (2026-10-11, owner decision, docket MSUP-15: hide with a read-only lot note)                 | **Resolved 2026-10-11:** `ItemFormModal.tsx` now reads `is_lot_stocked` off the item being edited (the list and detail endpoints already attach it via `_attach_lot_stock`); for a lot-stocked item it replaces the Quantity input with the same read-only "N from stock lots — adjust by receiving a delivery or editing the item's lots" note `MedicalItemFormModal` shows, and leaves `quantity` out of the update payload. Items with no lots, and creation, are unchanged; `PATCH /inventory/items/{id}` itself still accepts `quantity` for an API caller. Pinned by `ItemFormModal.test.tsx` ("a lot-stocked pool item"). Original finding: `modules/inventory/components/ItemFormModal.tsx`'s "Quantity" input always reads from and writes to `InventoryItem.quantity` directly, with no indication that for a lot-stocked item that column is a best-effort mirror, not the authoritative on-hand count (the sum of the item's in-date stock lots). An admin who opens this form for a lot-stocked item, sees the stale mirror value, and "corrects" it to match the detail page's lot-derived number writes into a column no lot backs, until the next delivery's carry-forward silently overwrites it again. No data corruption occurs today from this alone — nothing treats the edited mirror value as authoritative over the lots — so it is not gated as a security finding, but it is a live trap for exactly the workflow this module exists to support. `modules/medical-supplies/components/MedicalItemFormModal.tsx` (the medical-domain-specific form `MedicalSuppliesPage.tsx` actually uses) already has this awareness — it hides the Quantity input behind a read-only "N from stock lots" note for a lot-stocked item and omits `quantity` from the update payload entirely — so this is reachable today only through the general Inventory page's edit flow on a medical item (a broad `inventory.manage` holder can reach any item's detail page and its edit modal, by design), not through the medical supplies module's own screens. Closing it needs a decision — hide/disable/relabel the field for a lot-stocked item, or route an edit through a lot adjustment instead of the raw column — which is a UX/product call, not a mechanical patch. Found by Codex review, security-review PR #2301 (MSUP-23 pass 4); see `docs/security-review/MSUP-23-medical-supplies.md` MSUP-15. (MSUP-15)                                                                                                                                                 |
| **Reports: date-range filters use UTC, not the organization's local timezone**                                                       | ✅ Resolved (owner decision 2026-10-08: org timezone via the org_timezone helpers, UTC fallback; GF-24a) | A report end date of "June 15" used to mean June 15 in UTC, so a non-UTC department's report could take in the next day's early records or drop the selected day's late evening. **Resolved 2026-10-11:** every report date-range filter on a timestamp column now goes through `app/utils/org_timezone.py` — `reporting_timezone` (the organization's timezone, **UTC** when it has none or an invalid one, deliberately not scheduling's America/New_York default), `local_range_utc` (local midnight inclusive to the next local midnight exclusive, so DST days are bounded by the calendar) and `resolve_local_range_utc` (which loads nothing for an unbounded range). Converted: the department overview's event and check-in counts, admin hours, the prospect pipeline report, the event attendance report (moved from the scheduling fallback to the reporting one), the grant report, the fundraising report and the donation list. Date columns (training `completion_date`, call `call_date`, `shift_date`) compare against the dates directly and were already right. `tests/test_report_range_timezone.py` covers it. See `docs/security-review/GF-22-grants-fundraising.md` GF-24a.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Inventory: storage-area barcodes are assigned but the scanner cannot resolve them**                                                | ✅ Resolved (2026-10-11, owner decision: extend the scan lookup)                                         | `GET /inventory/lookup` now also returns `storage_areas` — an additive list on `ScanLookupListResponse` (default empty; `total` still counts items) of active, in-org storage areas whose `barcode` equals the scanned code exactly, case-insensitively (`InventoryService.find_storage_areas_by_code`). Exact rather than substring so a partial item search never pulls every `SA-…` shelf into its results. `InventoryScanModal` (the assign/return scanner) shows a scanned shelf label as "SA-… is the label for the storage area _name_, not an item" instead of "No item found", adds nothing to the list, and offers **Open storage area** (`/inventory/storage-areas?area=<id>`) to holders of `inventory.manage`. The Storage Areas page's own scan, Put away and Check contents already matched shelf codes locally and are unchanged. The form's "so it can be scanned" copy is now accurate. Pinned by `tests/test_inventory_scan_storage_area_lookup.py` and `InventoryScanModal.test.tsx`. (Tracked internally as "INV-8" in the commit that shipped it — unrelated to, and not to be confused with, this rotation's own security-review finding INV-8/INV-9 below, "Two Cross-Member Reads Sit Behind the Baseline `.view` Grant"; corrected here, security review INV-11 pass 8, 2026-10-13.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Client IP recorded as the proxy address**                                                                                          | ✅ Resolved (2026-08-05); historical rows documented, accepted by the owner (2026-10-05)                 | `request.client.host` was used instead of `get_client_ip(request)` in 39 places across 8 files, so behind the production nginx every record stored one identical internal IP. Worst case was **elections**: per-vote IPs drive the fraud detection documented in `BALLOT_FORENSICS_GUIDE.md`, so `unique_ip_count` collapsed to 1 and every election permanently tripped the `suspicious_ips` threshold. The sweep also caught a live **availability** bug the survey had missed: `public_portal_security.py` keyed the public-portal _rate limiter_ on the peer IP, so all anonymous visitors shared one bucket and a single caller could lock out everyone (the H5 shape, still live on the public surface). Verified behavior-neutral: identical test results before and after. **Accepted by the owner (2026-10-05):** rows already written still hold proxy IPs and are indistinguishable from real ones; they are left as they are, because rewriting hash-chained audit history would break `verify_integrity`. The cutover date is documented in `BALLOT_FORENSICS_GUIDE.md` (Step 3, "IP cutover — 2026-08-05") so a reviewer dates the evidence instead. (AXC-1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## Error Monitoring Coverage (2026-08-07)

What does _not_ reach the Error Monitoring page after the reporting sweep. Each
is an accepted gap with the same root cause: an `error_logs` row is org-scoped
and `organization_id` is NOT NULL, so a failure that cannot be attributed to an
organization has nowhere to go.

| Item                                                               | Status                               | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Failures before sign-in do not reach the error-monitoring page** | Accepted by the owner (2026-10-05)   | `POST /errors/log` requires an authenticated session because each row is organization-scoped. Pre-authentication reports are discarded, and queued reports are cleared on login, logout, or session expiry so error content can never be delivered under a different user's cookies on a shared browser. Closing this limitation safely needs an anonymous ingestion path with its own organization resolution and abuse protection (the endpoint would be unauthenticated and world-writable). **Accepted by the owner (2026-10-05):** leave as is — no anonymous ingestion path is built; a server-side failure before sign-in reaches Sentry and Loguru, and a browser-side one is not recorded anywhere. |
| **The onboarding client is not instrumented**                      | Accepted (follows from the above)    | `modules/onboarding/services/api-client.ts` calls `fetch` directly rather than an axios instance, so it does not pass through the interceptor that reports API failures. Onboarding traffic is mostly pre-session. If it is ever instrumented, route it through `reportApiError` rather than adding a second transport.                                                                                                                                                                                                                                                                                                                                                                                      |
| **Reports can still be discarded under sustained failure**         | Accepted (bounded, and never silent) | The client caps reports at 20/minute and holds at most 50 undelivered, and abandons a report after 4 delivery attempts. Anything discarded by the two caps is counted and reported as a `REPORTING_THROTTLED` row, so a burst reads as "20 reports plus 340 suppressed" rather than a quiet minute — but the discarded reports themselves are gone, and a report abandoned after 4 failed attempts is not counted anywhere. Raising the caps trades table growth for fidelity; the current values assume a browser tab, not a server.                                                                                                                                                                        |
| **A 5xx produces two rows**                                        | Accepted (intentional)               | The backend logs `BACKEND_HTTP_5xx` with the traceback and endpoint; the client logs `API_SERVER_ERROR` with the member and the page they were on. Neither is redundant — the backend row is missing when the failure never reached the app (gateway 502) and the client row is missing for a failure outside a request the user made. They are distinguished by the Source column.                                                                                                                                                                                                                                                                                                                          |

## Frontend Routes & Navigation (2026-08-07)

Nothing in the codebase connects a `to=` string to a `path=` string, and
`App.tsx`'s catch-all turns an unmatched target into a silent redirect to the
dashboard — so a dead link produces no error anywhere and reads as a button that
does nothing. `frontend/src/routeIntegrity.test.ts` now walks the source and
checks every literal navigation target against the declared routes, reporting
file, line and target. Known gaps are listed in its `KNOWN_MISSING_ROUTES`
allowance, and a companion test fails if either route ever appears, so the
allowance cannot outlive the gap.

| Item                                                                  | Status                                   | Detail                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Grants: "Record Donation" points at a screen that was never built** | ✅ Resolved (owner decision, 2026-10-11) | _Resolved 2026-10-11 (owner: "build the form — API/store already exist, screen only")._ **Record Donation** on the Donations page (`fundraising.manage`) opens `/grants/donations/new` over `POST /grants/donations`. Check number, transaction ID and the recurring flag are not on the form (the create schema does not accept the first two). |
| **Grants: "Add Opportunity" points at a screen that was never built** | ✅ Resolved (owner decision, 2026-10-11) | _Resolved 2026-10-11 (owner: "build the screen")._ `/grants/opportunities/new` (`fundraising.manage`) is the **Add Grant Opportunity** form over `POST /grants`; the button is shown only to a holder of that permission. Required documents, tags and a recurring schedule stay API-only.                                                       |

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

| Item                                                                 | Status                             | Detail                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Leave of absence is created from Waiver Management**               | Accepted by the owner (2026-10-05) | The owner chose to keep leave work where leaves are already created rather than move it to a lifecycle page, and editing now sits beside creation there. It is still not where a membership coordinator might first look; the membership guide points to it.                                                                                    |
| **`POST /users/advance-membership-tiers` has no button**             | Accepted by the owner (2026-10-05) | The scheduled task `membership_tier_advance` runs it on the first of each month when the department's auto-advance switch is on; an on-demand run is API only. Not part of the 2026-10-05 decision. **Accepted by the owner (2026-10-05), decided separately:** leave as is — the monthly task is the runner, and no on-demand button is added. |
| **`GET /users/{id}/property-return-report` (preview) has no screen** | Open (LOW)                         | The preview of what a member would have to return, before a drop, is still API only; the drop itself generates the full report into Documents. Not part of the 2026-10-05 decision.                                                                                                                                                             |

The overdue list's response shape was also corrected on the frontend:
`OverdueMember` had described fields the endpoint never sent (`drop_date`,
`item_name`, `due_date`), which nothing noticed while nothing read it.

## Medical Screening — No Per-Member Compliance Screen (2026-08-08)

**Resolved 2026-10-11** — both screens in the table below are built.

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

| Guide section                      | What exists                                                                                                                                                                                                                                                                                                                                                                                                                                | State    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Member compliance detail view      | **Built 2026-10-11 (owner decision: build it).** **View** on a roster row renders the server's `ComplianceSummary` for that member or prospect, requirement by requirement (`SubjectCompliancePanel`).                                                                                                                                                                                                                                     | ✅ Built |
| Compliance tab filtered to overdue | **Built 2026-10-11 (owner decision: add filter).** `GET /medical-screening/compliance?standing=` returns every screenable member and open prospect graded by the same `_grade` rule as the per-subject summary, with totals; the tab's **Show** filter offers Everyone / Not compliant (overdue or missing) / Expiring within 30 days / Compliant, applied on the server and audit-logged with the subjects returned (`ComplianceRoster`). | ✅ Built |

## Grants & Fundraising — Pledges and Fundraising Events (2026-08-08)

**Resolved 2026-10-11 (owner decision: "build both pages and restore the
Outstanding Pledges link").** **Pledges** (`/grants/pledges`) and
**Fundraising Events** (`/grants/events`) are in both navigations, readable
with `fundraising.view`, with create and edit for `fundraising.manage`. The
dashboard's Outstanding Pledges tile links to the pledges page again.

What remains, deliberately:

- **A pledge is kept in step with donations by hand.** Nothing in the backend
  moves a pledge's received amount or status when a donation arrives, so the
  edit form asks for both. Linking a donation to a pledge would be a backend
  change.
- **Not on the forms:** a pledge's payment schedule (nothing reads it), and
  an event's sponsors and calendar-event link. All stay API-only. The
  pledge's **Send reminders** switch is on the form, read by the daily
  `grant_reminders` task.

The original findings, for the record:

- **Pledges.** `fundraisingService.listPledges` / `createPledge` /
  `updatePledge` existed over a working API with no page. The grants
  dashboard's "Outstanding Pledges" KPI card linked to `/grants/pledges`,
  which had no route, so its link was removed until the page shipped.
- **Fundraising events.** `listFundraisingEvents` / `createFundraisingEvent` /
  `updateFundraisingEvent`: zero consumers, no route, no page.
- **Recording a donation** _(resolved 2026-10-11 — see the "Record Donation" row above)_. `DonationsPage`'s primary action, "Record
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

| Guide section             | What exists                                                                                                           | State    |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------- |
| Create Budget form        | _Resolved 2026-10-08:_ **Add budget line** and **Edit** open `BudgetFormDialog` (`finance.manage`). See below.        | ✅ Built |
| Create Dues Schedule form | _Resolved 2026-10-11:_ **New schedule** and **Edit schedule** on **Finance › Dues** (`finance.manage`).               | ✅ Built |
| QuickBooks export mapping | _Resolved 2026-10-09:_ **Finance › QuickBooks Export** (`/finance/settings/quickbooks`, `finance.manage`). See below. | ✅ Built |
| Export logs               | _Resolved 2026-10-11:_ **Export history** on **Finance › QuickBooks Export**, with who ran each export.               | ✅ Built |

**Budget detail's transaction history** — _resolved 2026-10-08._ It was a
stub that said "No transactions yet" unconditionally. It now lists what moved
the line's spent and committed totals (`GET /finance/budgets/{id}/transactions`),
and budget-line owners see their own lines on **My Budgets** and open them
read-only — see
[FINANCE_MODULE.md](./FINANCE_MODULE.md#my-budgets-the-owners-view-and-the-transaction-list-2026-10-08).
The Create Budget row is closed too — see
[FINANCE_MODULE.md](./FINANCE_MODULE.md#budget-line-owners-stations-and-the-createedit-budget-screen-2026-10-08).

## Finance — Budget Request Reminders Go Out 7 Days and 1 Day Before, for Every Department (2026-10-08)

The deadline reminder for next year's budget requests is sent 7 days and 1 day
before a draft year's request deadline, to line owners who still owe a request.
The two offsets are constants (`REMINDER_OFFSETS_DAYS` in
`app/services/finance_budget_request_notifications.py`), not a department
setting: no finance settings section exists to hold one, and a new one for two
numbers was judged more surface than the reminder is worth. A department that
wants a different schedule cannot choose it today.

The budget-request notices are email only — there is no in-app bell entry,
because the Finance module has none for anything; the deadline and every
decision are on the owner's _Next year's budget_ screen. A member can turn the
emails off under their email preferences (_Next year's budget requests_,
_Treasurer duties_), and a department can make either required. See
[FINANCE_MODULE.md](./FINANCE_MODULE.md#budget-request-emails).

**Owner decision needed** only if a department asks for a different schedule
or for bell entries.

## Finance — Budget Amendment Corrections Are Whole Reversals Only (2026-10-09)

**Resolved in part (owner decision, 2026-10-09).** A mistaken amendment is now
corrected by a **reversing entry** —
`POST /finance/budgets/{id}/amendments/{amendmentId}/reverse`, the **Reverse**
button on the line's page — a negative amendment with its own reason and
approval that lowers the current budget and leaves the original budget and the
original amendment on record (`docs/FINANCE_MODULE.md`, "Reversing a mistaken
amendment"). The old workaround, editing the amount down, is no longer needed
and should not be used for this: it moves the original budget.

What remains limited, by design:

- **No partial reversal.** $2,500 entered for $250 is fixed by reversing the
  whole $2,500 and recording a new $250 amendment — two entries, not one.
- **A reversal is final.** It cannot itself be reversed; restoring the money
  takes a new amendment with a fresh approval.
- **A locked year takes no reversal**, as it takes no amendment. A mistake found
  after the year is locked stays as entered unless the year is unlocked.
- **A reversal is refused when the money is already spent or committed** past
  the lower budget (409 "Insufficient available budget"); the spending has to be
  resolved first.

**Owner decision needed** only if partial reversals, or reversals in a locked
year, are wanted.

## Finance — Dual Approval: What It Does Not Cover (2026-10-11)

Large requests can need two different approvers
(`finance.dual_approval_threshold`; see `docs/FINANCE_MODULE.md`, "Dual
approval"). Four gaps are deliberate, pending a decision:

- **Nobody is told a request is waiting for its second approval.** It is
  listed on the Approvals screen and marked on its own page, but no email or
  bell entry goes out.
- **Any `finance.approve` holder may give the second approval**, not only the
  approvers a chain names. The rule is "two different people", not "two named
  officers"; a department that wants the second approver to be a specific
  office needs a two-step chain naming it.
- **People are told apart by account.** An approval from an emailed link
  counts as the address the step names, so one person who is both a member and
  an external email approver could be counted twice. Steps that auto-approve
  count as nobody.
- **The threshold is whole dollars and one figure for all three request
  types.** A per-type or per-category threshold, or one in cents, is not
  supported.

## Finance — Amendment Confirmation: What It Does Not Cover (2026-10-09)

Amendments and reversals are entered pending and move money only once a
`finance.budget_review` or `finance.manage` holder other than whoever entered
them confirms them (`docs/FINANCE_MODULE.md`, "Second-officer confirmation").
Three gaps are deliberate, pending a decision:

- **Nobody is told an amendment is waiting.** No email, bell entry or queue
  lists pending amendments across lines; the confirmer finds them on the line's
  page (marked _Pending confirmation_) or, at year-end, in the open items that
  hold the lock. The Treasurer tells the confirming officer.
- **A department with one finance officer cannot confirm anything.** Someone
  other than the entering member must hold `finance.budget_review` or
  `finance.manage`; until one does, amendments stay pending and a closing year
  cannot be locked. This is the control working as intended, but a very small
  department has to grant `finance.budget_review` to a second officer first.
- **A rejected reversal loses its link on the row.** Rejecting a pending
  reversal clears `reverses_amendment_id` so the original can be reversed
  again; the rejected row then reads "Reverses an earlier amendment" rather
  than naming it. The audit event `finance.budget_amendment_rejected` keeps
  `reversed_amendment_id`.

## Finance — Budget Adoption Stages: What They Do Not Cover (2026-10-09)

Next year's budget moves through taking requests, leadership review and board
review to an adoption the Treasurer records (see `docs/FINANCE_MODULE.md`,
"Adopting the budget"). Three gaps are deliberate, pending a decision:

- **Leadership changes only what the Treasurer decided.** A request still
  submitted or declined, and a draft line nobody requested (one copied from
  last year and never requested), cannot be changed in leadership review. The
  Treasurer moves the year back to taking requests, or edits the line.
- **Owners are not emailed when leadership changes their amount.** They see the
  change and its note on _Next year's budget_, and the adoption email lists the
  final amounts.
- **The board's changes are entered by moving the year back.** Board review
  freezes the draft; if the board amends the budget at its meeting, the
  Treasurer moves the year back to leadership review (or taking requests),
  makes the change there, and returns it to board review before recording the
  adoption.

## Finance — The Year-End Close: What It Does Not Cover (2026-10-09)

Adoption, starting a year, its year-end close and the lock sign-off are
separate steps (see `docs/FINANCE_MODULE.md`, "Starting, closing and locking a
year"). Three gaps remain, pending a decision:

- ~~**The Treasurer's own line edit still changes an adopted draft.**~~
  **Resolved 2026-10-09:** from board review on, and in an active or closing
  year, a line's amount changes only through an amendment a second officer
  confirms (`docs/FINANCE_MODULE.md`, "Second-officer confirmation").
- **Nothing starts or closes a year on its own.** The Treasurer is reminded by
  a banner once the end date passes (`closeDue`), but no email goes out and the
  year stays active until its close is begun; likewise an adopted year waits
  for **Start the year**. Both are deliberate — each step is an officer's
  decision on the record.
- **Drafts left in a closing year stay as drafts.** A purchase request, expense
  report or check request never submitted cannot be submitted once the close
  begins, and does not stop the lock. A requester who still needs it raises it
  again in the new year; nothing moves it across.

## Finance — Expense Receipts: What the Requirement Does Not Cover (2026-10-09)

Every expense line needs an uploaded receipt before its report is submitted
(see `docs/FINANCE_MODULE.md`, "Expense receipts are required"). Gaps,
pending a decision:

- **One receipt per line.** A hotel folio covering several lines is attached
  to each of them.
- **Mileage has no log of its own.** A mileage line needs a file like any
  other; the guide asks for the trip log. Nothing checks what the file is.
- **Purchase requests and check requests do not require one.** A purchase
  request can carry an uploaded receipt, but nothing requires it before
  payment, and check requests take none.

## Finance — Restricted Funds: What They Do Not Cover (2026-10-13)

Described in
[FINANCE_MODULE.md](./FINANCE_MODULE.md#restricted-funds-2026-10-13). Left out
on purpose:

- **One fund per payment.** A purchase or check is charged to one fund, or
  none; an expense report can charge a different fund on each line. Paying one
  invoice partly from a fund and partly from operating money means two
  requests.
- **Pledges are not money in until paid.** A department cannot spend a pledge
  it has not received; it shows in the fund's balance once the donation is
  recorded as completed.
- **Grants are not funds here.** A grant's own budget items and overspend
  check (the Grants module) are separate; a restricted grant is tracked there,
  not as a campaign.
- **No release of restrictions or transfers between funds.** When a purpose is
  met and donors agree to redirect the remainder, that is recorded by the
  treasurer outside the module; there is no "release" entry.
- **Not sent to QuickBooks.** The export does not carry the fund; a department
  that tracks restricted net assets in QuickBooks (as Classes or Locations)
  sets them there.
- **A refund after a payment can leave a fund overspent.** The balance follows
  the donations as they stand, so a refunded gift lowers it even when payments
  were already approved against it; the report marks the fund Overspent rather
  than undoing anything.
- **Requests created before this change cannot be charged retroactively except
  by editing them,** which a purchase request allows while it is a draft or
  submitted; a check request has no edit screen, and an expense line none
  after creation.

## Finance — Functional Expense Classification: What It Does Not Cover (2026-10-13)

Described in
[FINANCE_MODULE.md](./FINANCE_MODULE.md#functional-expense-classification-2026-10-13).
Left out on purpose:

- **No splitting one payment across classes.** A payment takes one class. An
  expense report can be split line by line; a single purchase or check that
  served two functions cannot. Allocating shared costs (rent, utilities) by
  percentage is what Form 990 asks for there, and is not built.
- **Not sent to QuickBooks.** The export does not carry the class; a
  department that tracks functions in QuickBooks (as Classes) sets them there.
- **Dues and other income are not classified** — Part IX is expenses only.
- **Nothing is backfilled.** Existing payments read as unclassified until their
  categories are set; then they follow their category, overrides aside.

## Finance — The Expense Deadline: What It Does Not Cover (2026-10-12)

The accountable-plan substantiation deadline is described in
[FINANCE_MODULE.md](./FINANCE_MODULE.md#the-deadline-for-claiming-expenses-2026-10-12).
Left out on purpose:

- **Cash advances and the 120-day return rule.** The finance module has no
  advances, so the other half of the accountable-plan timing rules (returning
  an unspent advance within 120 days) has nothing to apply to. Building it
  means advances to members, settlement against expense reports, and the
  return deadline: a separate change.
- **Reports submitted before 2026-10-12** are never graded; when they were
  submitted was not recorded, and inferring it from an approval step's creation
  time would be a guess.
- **Purchase requests and check requests** are not graded. A purchase request
  is approved before money is spent, and a check request pays a third party;
  the deadline concerns a member claiming back money they spent.
- **No payroll or W-2 integration.** _Finance > Reports > Outside the
  accountable plan_ lists the late reimbursements with a CSV; deciding whether
  and how to report them as wages is the department's, with its tax adviser.
- **The form's warning measures from today**, the earliest the report can be
  submitted. A report drafted on time but submitted after the deadline is
  graded at submission, which the warning cannot foresee.

## Finance — Board Reports: What They Do Not Cover (2026-10-12)

**Finance › Reports** (`/finance/reports`) is described in
[FINANCE_MODULE.md](./FINANCE_MODULE.md#board-reports-2026-10-12). Left out on
purpose:

- **Commitments on a past date.** Encumbrances are a running figure with no
  history, so budget vs actual shows **Committed** only on a report through
  today. Reconstructing them would mean recording each approval and payment as
  a dated encumbrance movement, a schema change not made here.
- **Spent is the dated payments, not the running total.** A line whose running
  `amount_spent` was edited by hand, or that holds spending from before a
  payment's date was recorded, reads differently on the report. Today's report
  flags those lines (`runningSpentDiffers`) and shows both figures; the report
  is not corrected to the running total, because then it would not reconcile
  with the payments register.
- **A voided check with no void date** counts as voided from the start on
  budget vs actual, but its original row still appears on the register. The
  2026-10-11 migration (`3f3bd6f3c7e4`) filled `voided_at` for every check
  voided before then, so this arises only if a row is edited directly.
- **No server-side PDF**, and no scheduled delivery. The browser's print, or
  its _Save as PDF_, is the PDF.
- **Not yet built from the original plan:** expense summary by member, dues
  collection with delinquency, and purchase orders by vendor. Restricted funds
  and functional expense classification (program / management / fundraising)
  have reports of their own (Restricted funds, Functional expenses).

## Finance — Cash Advances: What They Do Not Cover (2026-10-14)

Described in
[FINANCE_MODULE.md](./FINANCE_MODULE.md#cash-advances-2026-10-14). Left out
on purpose, or needing a decision first:

- **Only the requester's own advance.** An advance is paid to the member who
  asks for it; the finance office cannot raise one on another member's behalf,
  since the member who owes it, the overdue block and the separation of duties
  all key on the requester.
- **Fixed-date method only.** The 120 days run from the check. The IRS's other
  safe harbor, the periodic statement method (quarterly statements, 120 days
  from each), is not modelled.
- **Overdue is flagged, not reported to payroll.** The advances report lists
  what is overdue; turning it into wages on a W-2 is the treasurer's job, as for
  late reimbursements on _Outside the accountable plan_.
- **Not part of the year-end close.** An advance still outstanding at year end
  is not listed among the year's open items; the advances report is where to
  look before closing. Returned cash can still be recorded against an advance
  whose year is locked, since a return moves no budget figure.
- **Cash from petty cash is still a "check".** Issuing asks for a check number;
  an advance paid in cash is issued with a reference such as `CASH` in that
  field.
- **The advance a report accounts for is fixed on submission.** If a report is
  later denied, its share is owed again; it is not re-allocated to another
  report automatically.

## Finance — QuickBooks Export Gaps (2026-10-08)

The transactions export is now a valid QuickBooks Online journal-entry import
(see `docs/FINANCE_MODULE.md`, "QuickBooks Export"). Its accounts are set on
**Finance › QuickBooks Export** _(2026-10-09)_, which also shows each budget
category's export readiness, and in the budget category dialog. Running the
export, subcategory inheritance and exporting dues were closed on 2026-10-14. These gaps
remain, and each needs a decision or a follow-up change rather than a fix
inside that one:

- **There is no live QuickBooks connection.** Posting entries and reading back
  the chart of accounts, budgets and actuals needs the QuickBooks Online
  Accounting API. That means an Intuit developer app, OAuth 2.0 with encrypted
  per-organization tokens, and a background sync, and it is planned as its own
  change. The API cannot create or edit QuickBooks budgets; it can only read
  them, and QuickBooks budgets need QuickBooks Online Plus or higher.
  Decided for that change _(2026-10-09)_: it posts each payment as a
  QuickBooks **Purchase** (a Check, or a cash or credit card Expense) to a
  vendor, not as a journal entry, so it appears on the vendor's record and in
  1099 reporting, which journal entries do not reliably reach. The Accounting
  API also has no read-only scope (`com.intuit.quickbooks.accounting` grants
  read and write), so the connection must confine itself to the calls it
  needs.
- **"Sent" means the file was produced, not that QuickBooks imported it.**
  _(2026-10-11)_ The export stamps a payment once its file is complete; it
  cannot see whether the Treasurer then imported the file. A file downloaded
  and never imported leaves its payments marked as sent; the Treasurer sends
  that period again with `includeExported`. The live connection would close
  this, since it would know what QuickBooks accepted. _(2026-10-18)_ The
  Treasurer can now mark a file as imported in **Export history**, and sending
  a marked file's payments again is refused until they confirm the earlier
  entries were deleted. That depends on the Treasurer marking it: an imported
  file left unmarked is still not caught, and importing the same file twice
  inside QuickBooks never reaches the module at all.
- **Only voided checks are reversed.** Paid purchase requests and expense
  reports cannot be un-paid in the module, so there is nothing to reverse; a
  refund or correction after export is entered in QuickBooks by hand.
- **The CSV import is journal entries, with the limits that brings.** They do
  not appear on a vendor's record in QuickBooks and may not be counted on its
  1099 report; a department paying contractors checks that report before
  filing. Accounts Payable and Receivable are refused because the import needs
  a vendor or customer on those lines and the file has no Name column. The
  check recognizes QuickBooks' standard names only, so a renamed A/P or A/R
  account passes and fails at import instead.
- **The chart of accounts check is only as current as the upload.**
  _(2026-10-18)_ An account added or renamed in QuickBooks after the last
  upload is refused here until the Treasurer uploads the Account List again,
  and one deleted there still passes. Names are matched exactly, case
  included; whether QuickBooks' import itself ignores case was not confirmed,
  so a name differing only in case is refused rather than assumed to work. The
  parser reads the Account List report's layout as Intuit has published it
  ("Account" or "Full name" columns); a future change to that report could
  need the parser updated.

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

**Accepted by the owner (2026-10-05):** leave as is — `finance.approve` stays
with the Treasurer, and a department that needs a request the Treasurer raised
approved adds a second approver step to its own chain.

Found 2026-08-12 while trying to seed a budget with charges for
`11-05-budget-detail`. The budget-detail consequence recorded above — spend and
encumbrance accruing on approval, so the progress bar was permanently stuck at
0% — is unblocked by this; the transaction-table stub in the section above is
not, and remains unwired.

## Upgraded and Fresh Databases Still Differ (2026-10-20)

A fresh install is built from the models (`main.py`'s fast path:
`create_all`, then `MIGRATION_ONLY_FILES` and the seed files, then a stamp at
head). An existing installation is built by the Alembic chain plus the startup
column repair. A comparison of the two on 2026-10-20 found defects that are
now fixed:

- duplicate RESTRICT foreign keys on 18 apparatus columns;
- three redundant `organization_id` indexes;
- 99 columns NOT NULL on upgraded databases and nullable in the models
  (`f938324f8081` relaxed `training_waivers.end_date`; `6dce1364ff7e` made the
  other 99 NOT NULL everywhere).

The differences below are **accepted** for now.
`backend/tests/test_live_schema_drift.py` guards the fixed directions on CI's
migrated database, nullability included. It deliberately does not assert
these.

**Tables only an upgraded database has: by design.** Three bookkeeping tables,
`document_unfiled_backfill`, `facility_document_refile_backfill` and
`facility_folder_tier_backfill`, are written by the 2026-10-11 folder backfills
so their downgrades can move each document back. A fresh install never ran
those backfills and has nothing to undo. Drop them only after deciding those
downgrades are no longer needed.

**Five tables that no code reads.** `compliance_policies`,
`policy_acknowledgments`, `compliance_checklists`, `checklist_submissions` and
`compliance_incidents` come from `20260201_0016`. Every installation has them,
fresh ones included, because `MIGRATION_ONLY_FILES` replays that migration, but
nothing under `backend/app/` references them. The facilities module's checklist
tables are the separately named `facility_compliance_checklists` family.
**Open decision:** retire them (this drops whatever rows a department has in
them), or leave them as harmless empty tables.

**Server defaults only upgraded databases carry.** 133 columns have a server
default (`0`, `1`, a sort order, `'pending'`) on an upgraded database and none
on a fresh install, where the model's Python default is used instead. Their
nullability already agrees:

- 34 are `NOT NULL` on both kinds of database;
- 99 are nullable on both, for example `apparatus.is_financed`.

Writes through the ORM supply the Python default, so ordinary requests do not
see the difference. Only a hand-written `INSERT` that leaves one of these
columns out behaves differently. On an upgraded database it gets the default.
On a fresh install it fails for the 34 and stores NULL for the 99. These were
left as they are because every write found goes through the ORM.

**One unused index on upgraded databases.** `20260808_0003` dropped the
foreign key on `shift_equipment_checks.apparatus_id`, and MySQL kept the index
it had created for that key (`fk_shift_equipment_checks_apparatus_id_apparatus`).
Nothing queries it and fresh installs do not have it. It costs one index write
per equipment-check submission.

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

**Why the failure is quiet — outside production.** `main.py`'s startup
fallback resolves a duplicate revision id by renaming one migration file to
`.stale`, then logs "Migrations completed successfully" while that migration
has been taken out of the chain. **Since 2026-10-11 (owner decision: fail
loudly in production, keep the fallback in dev)** a production boot refuses
instead and names the duplicate files (`docs/UPGRADING.md`); development and
staging still self-heal, so a green dev startup log is still worth reading
twice.

**The general rule.** A revision id is a shared namespace across every open
branch, and a date-stamped sequence collides the moment two people work on the
same day. Before merging a migration, re-check `revision` against the current
main rather than against your merge-base.

## Integrations — One Department Feed, No Filtered Feeds (2026-08-09)

Older notes for guide 16 picture an **iCalendar configuration** listing
"generated feed URLs for different filters (All Events, Training Only, My
Shifts) with copy buttons".

What exists is two feeds. Each member's shifts come from `CalendarSubscribeCard`
on the My Shifts tab (`/api/public/v1/calendar/{token}.ics`). The department's
published events come from the **iCalendar (ICS)** integration card, which
shows one URL with a copy button and a **Reset link** control
(`/api/public/v1/calendar/org/{token}.ics`). The integration's stored
`included_event_types` narrows that feed by event type, but no screen sets it,
so in practice the card's link carries every published event. There is no
training-only feed and no per-filter list of URLs. The department feed carries
no shifts; an `include_shifts` setting that was accepted and stored but read by
nothing was removed on 2026-10-23.

The guide-03 subscribe card is deliberately not captured because expanding it
exposes the calendar feed's bearer credential; the same applies to a connected
iCalendar card.

Most of the rest of guide 16 needs a live third-party account (a Salesforce
sync status, a connected Cal.com bookings panel, a warning state carrying a
real provider error) and is not capturable from a demo database at all. The
connect _dialogs_ are ordinary forms and have been captured.

## Integrations — Calendar Publishing Is Off by Default (2026-10-16)

One-way publishing of department events to a Google or Outlook calendar sits
behind the server setting `CALENDAR_SYNC_ENABLED`, which is off by default.
While it is off both catalog cards report **Coming Soon**; connect, update,
test and both sign-ins are refused with `400`, and the `calendar_sync`
scheduled task does nothing.

With it on, an administrator connects each card through its provider
sign-in, which creates a "<Department> Events" calendar and stores the grant
encrypted on the integration:

- **Google Calendar** — **Connect with Google**
  (`POST /api/v1/integrations/google-calendar/oauth/start` and its callback),
  asking only for the `calendar.app.created` scope. It needs the deployment's
  Google OAuth client (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, with the
  Google Calendar API enabled and the callback registered) or the
  department's own client ID and secret.
- **Microsoft Outlook** — **Connect with Microsoft**
  (`POST /api/v1/integrations/outlook/oauth/start` and its callback), asking
  for delegated `Calendars.ReadWrite` plus `offline_access openid email`. It
  needs the deployment's Azure AD app (`AZURE_AD_CLIENT_ID` /
  `AZURE_AD_CLIENT_SECRET`, tenant `AZURE_AD_TENANT_ID`, else the
  `organizations` endpoint) or the department's own client ID, secret and
  tenant ID. Microsoft offers no per-grant revocation, so disconnecting
  forgets the tokens without revoking them; the grant lapses on its own or
  when an administrator removes the app in the Microsoft account.

The generic connect endpoint refuses both calendar cards, and the connect and
update endpoints refuse a typed `refresh_token`, `access_token`,
`calendar_id` or `account_email` for either.

An older release let both cards be connected with an empty configuration.
Those rows were left as they are in the database — no data migration. The API
reports a calendar row as connected only when it holds a grant and a calendar
id; otherwise it reads `coming_soon` (setting off) or `available` (setting
on), on the integration list, the detail and the `/integrations/connected`
projection. Such a row never held a sign-in, so nothing was ever published
through it. A stored `sync_direction` of `pull` or `both` from that release is
ignored — publishing is push-only — and no longer blocks saving other
settings.

## Integrations — Weather Alerts and Generic Webhooks Do Nothing After Their Test (2026-10-08)

> **Generic Webhooks — resolved (2026-10-29), as the owner chose: build it
> out.** A connected webhook is now sent `event.created`, `shift.created` and
> `training.recorded`, the events the chat integrations get, through
> `dispatch_generic_webhooks` beside the chat dispatch. Its settings pick which
> (`event_types`, validated against `WEBHOOK_EVENT_TYPES`); none ticked means
> all, so a webhook connected earlier starts receiving every event. Each
> delivery is recorded in the integration's run history. Covered by
> `tests/test_generic_webhook_dispatch.py`.
>
> **NWS Weather Alerts — resolved (2026-10-29), as the owner chose: build it
> out.** `weather_alert_poll` checks each department's zone every 15 minutes
> and keeps Severe and Extreme alerts (real ones, not tests) in the new
> `weather_alerts` table, unique on department and NWS alert id, so each alert
> is announced once. The department picks the channels in the integration's
> settings: a dashboard banner while the alert is active
> (`GET /integrations/weather/active-alerts`), a bell notice to every current
> member, and an email under the new optional **Severe weather alerts** kind;
> banner and bell default on, email off. The row is committed before anyone is
> told, so a crash in between loses that alert's notices rather than repeating
> them to the department. Covered by `tests/test_weather_alerts.py`.

Both are listed in the integrations catalogue as `available`
(`app/api/v1/endpoints/integrations.py`), can be connected, and pass their
**Test** — and that test is the only thing either of them ever does.

- **NWS Weather Alerts.** `fetch_active_alerts`
  (`integration_services/weather_service.py`) has one caller, `test_zone`. No
  scheduled task polls a zone (the module docstring's "every 15 min" has no
  task behind it), and no screen shows an alert. A department that connects it
  expecting severe-weather warnings gets none, with nothing on screen to say so.
- **Generic Webhooks.** `send_webhook` (`integration_services/webhook_service.py`)
  has one caller, `send_test_webhook`. No domain event dispatches to it, and the
  stored `event_types` list (`GenericWebhookConfig`) is read by nothing. The
  card's feature list still advertises "Custom events" and "Retry logic".

This is the shape CLAUDE.md Pitfall #19 warns about: a switch with no reader.
Two ways out, and choosing between them is the owner's decision — wire a reader
(a polling task and a dashboard surface; an event dispatcher like
`notification_dispatch.py` does for chat), or mark both `coming_soon` as the EMS
exports are. Until then, `docs/training/16-integrations.md` says plainly that
only the test runs, and its webhook payload example now matches what is
actually sent (`event_type`, a Unix `timestamp`, a `sha256=`-prefixed
signature) rather than the earlier invented shape.

## Scheduling — Settings That Do Nothing, and Two Mismatches (2026-10-11)

Found while rewriting `docs/training/03-scheduling.md` in plain language, and
each checked against the code. The guide now describes what actually happens;
whether to wire, relabel or remove each one is the owner's decision. Items 1–3
are the shape CLAUDE.md Pitfall #19 warns about: a switch with no reader.

1. **"Require officer shift completion report"** (Shift Reports settings). Its
   only reader is the shift reminder (`scheduled_tasks.py`, ~line 1894), which
   adds "A shift completion report is required before this shift can be
   finalized." `finalize_shift` (`scheduling_service.py`) never checks for a
   report, so a shift closes out without one despite the reminder's claim.
   **Labelled (2026-10-11):** the setting's description now says it changes
   the reminder, and it shows "Not in effect yet — a shift can still be closed
   out without a report." Enforcing it at close-out is still open.
   **Resolved (2026-10-29), owner decision: enforce at close-out.** With the
   setting on (and post-shift validation on, which is when the box shows),
   `finalize_shift` refuses while any member in a training seat has no shift
   completion report for the shift, naming them; a shift with no training
   seats closes as before. A `scheduling.manage` holder may override with a
   reason (`override_missing_reports`), audit-logged as
   `shift_finalized_report_override`; a shift officer without that grant may
   not. Both close-out paths show the block (`TraineeReportGate`, reading
   `GET /scheduling/shifts/{id}/trainee-reports`). Covered by
   `tests/test_shift_trainee_report_requirement.py`.
2. **"Reviewer role"** (Shift Reports settings). Saved as
   `report_review_role` in the training module config and read by nothing.
   Approving reports is gated on `training.manage` alone
   (`shift_completion.py`), so changing the role changes nothing.
   **Labelled (2026-10-11):** both places it is chosen (Shift Reports settings
   and the My Training settings page) show "Not in effect yet — anyone who can
   manage training can review reports, whatever is chosen here." Wiring it is
   still open.
   **Resolved (2026-10-31), owner decision: also allow that role.** While
   review is required, members holding the chosen position (or rank) may work
   the review queue, read and review pending or flagged reports, and batch
   review, in addition to `training.manage` holders, who keep what they had.
   "Chief" covers `fire_chief`, `deputy_chief` and `assistant_chief`. A role
   reviewer never sees or reviews a report about themselves. The screen asks
   `GET /training/shift-reports/review-access`. Covered by
   `tests/test_shift_report_reviewer_role.py`.
3. **Department Defaults** (default duration, minimum staffing, overtime
   threshold). Stored and shown on the settings summary, but nothing applies
   them: new shifts and templates do not pick them up, and no overtime warning
   reads the threshold. **Labelled (2026-10-11):** the card shows "Not in
   effect yet". Applying the defaults is still open.
   **Resolved (2026-10-31), owner decision: apply them, and merge the
   overtime threshold into the Overtime advisory.** A new shift template
   starts from the default length (end time that many hours after 08:00) and
   minimum staffing, and the built-in Day/Night/24 Hour shift types staff to
   that minimum. The weekly overtime threshold field is removed: the Overtime
   advisory card (hours limit over a window of days) already drives the
   assignment warning, and two limits that could disagree would be worse. Its
   stored value is kept untouched, and the settings summary now reports the
   advisory instead.
4. **Start-of-shift reminder emails default on in the backend, off on the
   screen.** `scheduled_tasks.py` (~line 2358) reads
   `reminder_cfg.get("send_email", True)` ("sent by default"); the
   Notifications panel's default is `send_email: false` and nothing seeds
   `shift_reminders` when a department is created. Until someone saves that
   panel, crews receive reminder emails while the box shows unticked. The
   function's own docstring says the default is False.
   **Resolved (2026-10-11):** the panel now defaults the box to ticked, so it
   shows what is sent, and the docstring matches the code. The backend default
   is unchanged on purpose: switching it off would silently stop reminder
   emails for every department that never saved the panel.
5. **Eligibility screen promises an override the server refuses.** The
   membership-type exclusion card says "Admins can still assign them
   manually", but officer assignment runs the eligibility check
   (`enforce_position_eligibility=True`), which returns no positions for an
   excluded type, and the assignment is refused with "Member is no longer
   eligible for this shift". Shifts open to all members and administrative
   members are the exceptions. **Same refusal now extends to pattern
   generation (2026-10-24):** generated seats run the same check, so an
   excluded member is left unseated rather than seated by the pattern.
   **Resolved (2026-10-29), owner decision: correct the text.** The card now
   says an excluded type cannot sign up or be assigned, except to a shift
   opened to all members. No override was added.
6. **"Manage schedules" sees assign controls the server refuses.**
   `ShiftDetailPanel.tsx` and `OpenShiftsTab.tsx` show **Assign someone** to
   `scheduling.manage` holders, but creating, editing or removing an assignment
   requires `scheduling.assign` or being the shift officer
   (`endpoints/scheduling.py`); `scheduling.manage` does not imply it. The
   officer fills the form and gets "Insufficient permissions".
   **Resolved (2026-10-29), owner decision: hide the controls.** Both screens
   now offer assigning only to `scheduling.assign` holders and the shift's own
   officer; the server's rule is unchanged. A manage-only officer still sees
   the check-in QR code and the declined/removed list, which are read-only.
7. **A shift-panel hint points to a tab that no longer exists.**
   `ShiftDetailPanel.tsx` (~line 3114) reads "Start check → Go to Checklists
   tab". Equipment checks moved to Inventory; the working route is the panel's
   **Complete Checklists** button.
   **Resolved (2026-10-11):** the hint now reads "Not started — use Complete
   Checklists above".

## Scheduling — Left Open by the Shifts-Module Review (2026-10-24)

The 2026-10-24 review of the shifts module fixed what it found in a set of
pull requests: the trainee report view that erased officers' narratives, the
generation duplicate guard and DST end time, template reactivation,
assignment and eligibility gates, locks on finalized and cancelled shifts,
shift-report review rules, and the report figures. Each item below was found
in the same pass and needs a schema change or a product decision, so it is
recorded here rather than built.

1. **Deleting or re-timing a generated shift lets auto-generation recreate
   it.** Pattern generation treats an occurrence as already present when a
   shift from the pattern's template starts at that date and time; that is not
   a durable occurrence key. Deleting a generated shift (which removes the
   row) or moving its start leaves nothing at that key, so the next scheduled
   run — when auto-generation is on — recreates the original occurrence with
   the pattern's full crew. **Cancel** is the supported way to remove one
   occurrence: a cancelled shift stays in the guard and is never regenerated.
   To change a generated shift's start, cancel it and create the replacement
   by hand. A fix needs a stored pattern/occurrence key on generated shifts (a
   column and a migration).
   **Resolved (2026-10-31), owner decision: add the key.** Generation now
   records every occurrence it makes in `shift_pattern_occurrences` (pattern,
   date, day/night side), and both a manual Generate and the scheduled run skip
   an occurrence already recorded, whatever happened to its shift since.
   Deleting the shift clears only the row's `shift_id`. Shifts generated before
   the table existed are not backfilled (nothing records which pattern made
   them), so they rely on the start-time guard as before. Covered by
   `TestOccurrenceLedger` in `tests/test_scheduling_generation_fixes.py`.
2. **The nightly run reports skipped seats as a count in the server log
   only.** Generation now seats a member only where the seat, eligibility,
   seat cap, leave and overlap checks an officer's assignment runs would allow
   it. A manual Generate names the skipped members in its result; the
   scheduled run logs how many it skipped per pattern and shows nothing in the
   app, so a department whose members have no rank, qualification or open
   position configured sees crews left unseated with no on-screen notice.
   Surfacing it (a notification to schedulers, or a badge on the pattern) is
   open.
   **Resolved (2026-10-31), owner decision: notify the schedulers.** After a
   scheduled run, every `scheduling.manage` holder gets a bell entry listing
   each pattern's empty seats (driver seats included), and those who keep
   Scheduling officer duties email get the same list by email. Sent once per
   run; the occurrence ledger (item 1) keeps a rerun from repeating it. Covered
   by `test_the_scheduled_run_tells_the_schedulers_who_was_not_seated`.
3. **Editing an approved shift report does not restate its training
   credit — narrowed 2026-10-27 (EC-17), still open where review is off.**
   An edit to an approved report now sends it back to `pending_review` in any
   org that requires review, which is also the only path to that credit being
   restated (whoever re-approves the revised report re-triggers
   `_trigger_deferred_progress` with the edited figures). Where the
   department's `report_review_required` setting is off, the report stays
   `approved` after the edit and the credit already applied keeps the old
   figures, so the report and the pipeline still disagree for those orgs. See
   `docs/security-review/SCH-15-scheduling.md` pass 12 and
   `EC-14-equipment-check-shifts.md`'s EC-17 for the mechanism. Restating the
   credit in place for the review-off case, rather than relying on a
   re-review to do it, is still the owner's choice.
4. **Sign-offs recorded before 2026-10-24 can still duplicate on
   re-approval.** Re-approving a report no longer adds a second skill sign-off
   for the same skill, keyed on the report id now stored in
   `SkillCheckoff.evaluation_results`. Sign-offs written before that carry no
   report id, so re-approving one of those older reports can still add one.
5. **Shift attendance has no database-level uniqueness.** `add_attendance`
   now locks the shift and refuses a second row for the same member, and
   `member_check_in` already did, but `shift_attendance` has no unique
   constraint on `(shift_id, user_id)`. Adding one needs a migration that first
   settles any duplicate rows already stored (CLAUDE.md Pitfall #35).
   **Resolved (2026-10-31), owner decision: add the key.** Migration
   `1740b4886e52` merges any duplicates into the earliest row (earliest
   check-in, latest check-out, the largest minutes and call count — not the
   sum, which would double-count a stint recorded twice), deletes the rest, and
   adds `uq_shift_attendance_shift_user`. Covered by
   `tests/test_shift_attendance_unique_migration.py`.
6. **Shift cancellation notices are in-app only.** `cancel_shift` notifies the
   crew in the app and sends no email, and unlike the decline and assignment
   notices there is no setting to turn email on. CLAUDE.md Pitfall #18 makes
   email the channel of record; whether a cancellation should email, and
   under which member email kind, is a product decision.
   **Resolved (2026-10-29), owner decision: email under Shift notices.** The
   crew is now emailed as well as notified in the app, after the cancellation
   is saved; a member who turned Shift notices off gets the bell entry only.
7. **The month and week calendars stop at 500 shifts without saying so.**
   `get_month_shifts` and `get_week_shifts` pass `limit=500`, so a department
   running enough units with day and night shifts loses the end of the month
   from the calendar.
   **Resolved (2026-10-29), owner decision: load every shift in range.** Both
   now pass no limit; the week or month is the bound. Covered by
   `test_month_view_is_not_capped_at_500`.
8. **Driver/EVOC enforcement knows the seat named `driver` only.** Custom
   seat names are stored as typed, so a department that names its wheel seat
   "Engineer" or "Driver/Operator" seats members without the required EVOC
   level, with no block or warning. A fix is a "drives apparatus" flag on the
   seat definition or an alias list.
   **Resolved (2026-10-31), owner decision: a "Drives apparatus" flag.** Each
   custom position under Scheduling Settings → Position Names carries a
   **Drives apparatus** tick (`drivesApparatus`, off by default). A ticked seat
   gets the driver EVOC check everywhere `driver` does: assignment, editing
   an assignment, re-timing or re-vehicling a shift, and pattern generation.
   `driver` is always checked. Covered by `tests/test_custom_driver_seats.py`.

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

**Accepted by the owner (2026-10-05):** scheduled tasks stay platform-owner
only by design, and no department-facing page is built. The guide's placeholder
is retired: `docs/training/08-admin-reports.md` now says so instead of calling
the page not yet built.

## Events & Elections — Four Guide Sections With No Screen (2026-08-10)

`docs/training/04-events-meetings.md` describes four features that have no
frontend. Each is written in the present tense ("The election detail page now
shows…"), so nothing in the guide signals they are aspirational.

- **Attendance Dashboard.** ✅ Built (2026-10-11), as the owner chose:
  `/minutes/attendance` (`meetings.manage`, linked from the Minutes page)
  renders `GET /meetings/attendance/dashboard` with period and meeting-type
  filters, showing the server's figures without re-deriving them.
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

**Update (2026-10-08): two of the three are no longer missing.** The owner's
2026-10-05 answer for **Send Report Email** was to trim the guide, but the
build had already overtaken it: **Send Report** under **Email Results Report**
on a closed election's **Results & Publishing** panel (`PublishResultsPanel`,
`POST /elections/{id}/send-report`) emails the results report to the officer
who presses it (since 2026-10-21; it went to the election's creator before), so the guide now describes the button rather than being trimmed —
resolved. The election-side link control also exists: the **Linked Meeting**
field on `ElectionDetailPage` offers **Link a meeting** / **(change)** on a
draft election, opening a picker of upcoming events and minutes records. There
is still no list of upcoming meetings with a **Link to Election** button on
each, and the guide no longer describes one. The **Attendance Dashboard**
was built 2026-10-11 (`/minutes/attendance`, owner decision
meetings-attendance-dashboard).

## Audit Log — The Search Box Needs Apply, The Dropdowns Do Not (2026-08-10, resolved 2026-10-11)

Two filters on the same bar behave differently. The severity and category
selects write straight to the query state and refetch on change; the search
input holds a separate draft that only reaches the query when **Apply** is
pressed. Typing a term and reading the table gives the unfiltered list under a
filled-in search box, with no cue that the term has not been applied.

The Apply step stays — an unconditionally live search on a table this size is
a fetch per keystroke. **Resolved 2026-10-11 (owner decision: disable Apply
until the draft differs / show an unapplied cue):** Apply is disabled while the
box (trimmed) matches the search already applied, and a typed-but-unapplied
term shows "Not applied yet — press Enter or Apply to search" under the box,
linked to the input by `aria-describedby`. A filled box above unfiltered rows
now says so. `AuditLogPage.searchApply.test.tsx` covers it.

## Prospects — `referral_source` Is Stored But Never Shown (2026-08-10, resolved 2026-10-11)

**✅ Resolved 2026-10-11 (owner decision: show in the drawer — add to the
`Applicant` type and mapper).** `referral_source`, `interest_reason` and the
referrer are now on `Applicant`, mapped by `mapProspectToApplicant`, and shown
in the drawer's **How They Found Us** section. `referred_by` is a user id, so
the detail response gained `referred_by_name` (resolved in `get_prospect`,
never stored); it is filled only when the referrer belongs to the prospect's
organization, so a legacy cross-org `referred_by` names nobody. The list
endpoint still omits the three fields — the drawer is the place to read them.
The history below is kept for context.

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

**Accepted by the owner (2026-10-05):** leave as is — scanning stays
mode-first (choose check-out or return, then scan), and no scan-then-choose
screen is built.

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

> ✅ **Resolved (2026-10-11), as the owner chose option 1: append when
> missing.** `EmailTemplateService.render` now adds the chosen footer to a body
> that has no `{{footer_html}}` — inside the message card when the body ends
> with the shell's card, at the end otherwise — and the text footer to a
> plain-text body without `{{footer_text}}`. A body that has the variable is
> unchanged. **Accepted cost:** a template a department customised to close its
> own way now carries the footer as well; remove the custom closing or place
> `{{footer_html}}` where the footer should sit. Nothing is appended when no
> organization is passed to the renderer, since the footer names the
> department. The contract tests in
> `backend/tests/test_email_footer_rendering.py` were deliberately rewritten.
> The history below is kept as the record.

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

- **Two npm majors install from this one lockfile.** CI's `setup-node` jobs
  run the npm 10 bundled with Node 22, and both `frontend/Dockerfile` stages
  install npm 11.9.0; the `engines` floor in both manifests is npm 10. `npm ci`
  installs the tree the lock records under either, so a regenerated lock must
  be checked with `npm ci` under both before it is trusted.
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

**Resolved (2026-10-11), owner decision: build the clearance record screen.**
`/inventory/admin/clearances/:clearanceId` resolves each line (dispositions,
return condition, notes) and completes or closes-incomplete the clearance; the
Inventory Administration attention list links to it. Initiating a clearance by
hand is still API-only — a drop with property outstanding creates one.

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

**Accepted by the owner (2026-10-05):** leave as is — the department-wide
analytics dashboard and the per-event QR check-in analytics cover the need, and
no per-event analytics panel is built.

**Correction (2026-10-20, app-review B16):** the per-event QR check-in analytics
cover the need only if something feeds them, and nothing does — see RPT2-3 below.
The acceptance above stands for the department-wide dashboard.

## Events — Series RSVP Never Shows the Training Phase-Gate Warning (2026-09-04, security review EV-23)

> ✅ **Resolved (2026-10-11), as the owner chose: list every ahead-of-phase
> occurrence in the 409.** `POST /events/{id}/rsvp-series` now takes
> `override` (query, default false). For a **going** response it evaluates
> the phase gate on every future occurrence before writing anything, and if
> any is ahead of the member's phase answers 409 with
> `{"warning_type": "phase_gate", "message": "N sessions are in this series
ahead of your current training phase.", "occurrences": [{event_id, title,
start_datetime (UTC ISO), message}, ...]}`. The RSVP form lists those
> sessions by name and date in the department's timezone, and **RSVP to
> series** retries with `override=true`; **Not now** leaves nothing written.
> The per-occurrence write still passes `override=True`, now because the gate
> has already been evaluated for the whole series. The text below is the
> original finding.

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

**Accepted by the owner (2026-10-05):** the `ELSPROBLEMS` entry is accepted
until typescript-eslint ships TypeScript 7 support; then the alias is collapsed
to a single `typescript` dependency, which removes the nested install and this
entry with it. No restructure of the alias is attempted before then.

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

**Resolved (2026-10-11), owner decision: add a Permanent/Temporary choice plus a
return date to assign and distribute.** Assigning from an item's detail page now
asks, after the member is picked, whether the assignment is **Permanent** or
**Temporary**; Temporary requires a return date. The **Distribute Items** dialog
gains a third duration, **Temporary assignment**, beside **Ongoing assignment**
and **Temporary loan**, and `distribute_items` stores it as
`AssignmentType.TEMPORARY` with the date. The API enforces the pairing:
`ItemAssignmentCreate` refuses a temporary assignment without a future
`expected_return_date` and a permanent one carrying any date (422), and the
batch item schema accepts `operation: "temporary_assignment"` only with a future
`expected_return_at`. Pinned by `tests/test_inventory_temporary_assignment.py`,
`AssignTermsModal.test.tsx` and `InventoryScanModal.test.tsx`.

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

**Deferred by the owner (2026-10-05):** the member's view of a cohort is not
being built now; the cohort page stays officer-only until it is.

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

## Elections — Background Ballot Sends Live in the Web Process (2026-10-17)

Sending ballots to a 42-member department failed in the browser with "timeout
of 30000ms exceeded". The send ran inside the HTTP request: an eligibility check
and a new voting token per member, then one SMTP connection with a 0.25 s pause
between messages. The server kept going after the browser gave up, so the
ballots most likely went out, but the secretary was shown an error, which
invited a second send that would have mailed every member again.

**Correction (2026-10-17):** an earlier version of this entry, and the
pull requests that added the jobs, said a resend breaks the links already in
members' inboxes. It does not. A plain resend mints a new token per member and
leaves earlier ones valid; the vote is deduplicated on the voter hash, so a
member votes once whichever link they use. Earlier links are retired only by a
reminder (for the members it reached), by a rollback that regenerates the
anonymity salt, and by a change to the ballot.

**Fixed for the Send Ballots dialog.** `POST /elections/{id}/ballot-send-jobs`
records a `ballot_send_jobs` row and returns `202`. The send runs after the
response, and the page polls `GET /elections/{id}/ballot-send-jobs/{job_id}`
for the outcome. While a send is queued or running, a second one for the same
election is refused with `409`, from both the new endpoint and the synchronous
`POST /elections/{id}/send-ballot`. The synchronous endpoint is kept, unchanged
in behaviour otherwise, for API callers. Tests: `tests/test_ballot_send_jobs.py`,
`electionService.test.ts`.

Two limitations remain:

- **The send runs in the web process, not in a worker.** No Celery worker is
  deployed (Celery is in `requirements.txt`, but no compose file runs one), so
  the job is an asyncio task like the scheduled-email loop in `main.py`. A
  restart while it runs stops it partway, and some members will have been
  mailed. Their links work: the tokens are committed before the batch starts
  (`send_ballot_emails`, 2026-10-17; they used to be committed only after it,
  which left those links answering "Invalid voting token"). What is lost is the
  election's record of who was sent a ballot, which is written at the end. The
  row stays `running` until `STALE_JOB_AFTER` (30 minutes) passes. After
  that it reads as failed with a message to check who received a ballot, and it
  stops blocking a new send. Moving sends to a real worker would remove this,
  at the cost of a new service in every deployment (Docker, Unraid, AWS).
- ~~**The automatic pre-close reminder does not consult the guard.**~~
  **Fixed 2026-10-20.** The lifecycle task now queues both of its sends — the
  ballots after an automatic open, and the pre-close reminder — as
  `ballot_send_jobs` rows instead of sending inside the task, so they fall
  under the same guard as the buttons. That closed two further problems the
  inline sends had: a department-sized send held up every other election's
  scheduled open and close behind it, and a send longer than the scheduler's
  three-minute claim let a second backend worker (four run by default) take
  over and start the same reminder again, because `reminder_sent_at` is
  stamped only when a reminder delivers. A second tick or worker now finds the
  first job in progress and queues nothing. An automatic reminder that fails
  for anyone also emails the managers "Action needed: reminders for … were
  not all sent", once per election: one that delivered nothing is retried
  every tick, and an alert per retry would mail them every fifteen minutes
  through an outage. Tests: `test_election_lifecycle.py`
  (`TestAutomaticReminderJob`), `test_w50_auto_open_sends_ballots.py`.
- **The synchronous endpoints can still race each other directly (ELEC-48,
  security review pass 10, 2026-10-18).** The "refused with 409" guard above
  was, until pass 10, a plain read behind a snapshot the auth dependency's own
  user lookup had already fixed earlier in the same transaction — two requests
  to `POST /elections/{id}/ballot-send-jobs` arriving together could both see
  no job in progress and both queue one, even though the endpoint locks the
  election row (CLAUDE.md pitfall #27: the lock doesn't refresh a snapshot a
  prior read already fixed). Pass 10 fixed this for the queued path by making
  the check itself a locking read (`find_active_job`, now `.with_for_update()`)
  — see `ELEC-06-elections-ballots.md`'s **ELEC-47**. The two **synchronous**
  endpoints (`send-ballot`, `remind-non-voters`) still take no lock of their
  own, so two concurrent calls to the _same_ synchronous endpoint, with no job
  row yet for either to find, both pass the check and both send — the
  identical double-mail outcome, just not yet closed for that path (ELEC-48,
  owner decision: lock those endpoints too, or retire them now that the job
  queue exists for both kinds of send).

**Remind Non-Voters fixed the same way (2026-10-17).** It had the same
synchronous timeout. `POST /elections/{id}/reminder-send-jobs` now queues it
as a `ballot_send_jobs` row with `kind = 'reminder'`, polled through the same
`GET /elections/{id}/ballot-send-jobs/{job_id}`. A reminder that is refused
outright (election not open, reminders off, inside the one-hour cooldown) is
refused before anything is queued. Ballot sends and reminders share the
in-progress guard, because both mint fresh tokens. The synchronous
`POST /elections/{id}/remind-non-voters` is kept for API callers and now also
answers `409` while a send is running.

## Elections — A Rolled-Back Election Leaves Its Filed Result in Circulated Minutes (2026-10-22)

Closing an election files its result with its meeting's minutes
automatically (`auto_file_election_results`, on by default). When those minutes
are already circulated or adopted, the result is a permanent addendum.
`rollback_election` reopens a closed election but does not touch that filing,
so after a rollback the minutes keep the old tally, the next close files
nothing (a result is filed once per minutes and election), and the addendum
cannot be removed. Found by the pass-11 security review (ELEC-49).

**Needs an owner decision:** on a rollback, supersede the addendum with a
dated correction, annotate it as withdrawn, or refuse a rollback once the
result sits in adopted minutes. Until then, a manager who must roll back an
election whose result is in adopted minutes should record the correction in
the next meeting's minutes.

## Elections — Broadcast Election Emails Go One Message Per Member (2026-10-18)

The nominations-open announcement and the pre-meeting package used to go out as
one message with every member BCC'd. When the mail server accepted some of
those addresses and refused others, the code did not see it, and the package
confirmation said "sent to N recipient(s)" for the whole list. Many mail
providers also cap the recipients one message may carry, so a larger department
would have lost addresses with no error.

**Fixed (owner decision 2026-10-18: a separate email per member).** Both now
send each address its own message and record each address's outcome.

- **Pre-meeting package:** queued with `POST /elections/{id}/package-send-jobs`
  as a `ballot_send_jobs` row of `kind = 'package'`, because one message per
  address with the PDF attached runs past the request timeout just as ballots
  did. The outcome names every address the package could not be sent to. The
  sender still gets a copy, as they did when they were the visible To, but it
  is not counted. A package send has its own one-at-a-time guard and does not
  wait on a ballot send. `POST /elections/{id}/send-package` keeps the
  synchronous path for API callers.
- **Nominations-open announcement:** queued by the open-nominations endpoint
  as a `ballot_send_jobs` row of `kind = 'announcement'`, with its own
  one-at-a-time guard. It skips sending if nominations have closed again by
  then.

**Fixed 2026-10-21: the announcement's outcome is shown.** It used to run as
a FastAPI background task whose outcome only reached the log and the audit
table. The election response now carries the latest announcement job
(`nominations_announcement`, election managers only), and the Nominations tab
shows "Emailing members…", then how many members were emailed and how many
could not be reached. A miss, or a send that fails outright, writes a
`nominations_announcement_failed` audit row and emails the election managers.
A restart mid-send reads as interrupted after 30 minutes, like any other job.

What remains:

- **A package job interrupted by a restart** has the same limits as an
  interrupted ballot job (see the entry above): it reads as failed after 30
  minutes, and some recipients may already have the package.

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

✅ **Resolved 2026-10-11 (owner decision: hold the Organization lock for the
whole `advance_all` scan — settings edits block while it runs).**

`PUT /users/membership-tiers/config` (`update_membership_tier_config`,
`member_status.py`) refuses to remove or rename a tier members currently
hold, and `PATCH /users/{user_id}/membership-type` (`change_membership_type`)
refuses to assign a tier that no longer exists. Security review pass 5 fixed
the race between those two endpoints, but not against a third writer:
`MembershipTierService.advance_all`, the unattended tier-advancement scan,
wrote `User.membership_type` without locking the `Organization` row, so a
scan committing a member onto a tier could pass an edit removing it.

What changed:

- **`advance_all` locks the `Organization` row first and holds it for the
  whole scan**, reading the ladder off the locked row, and commits on every
  path (including "auto-advance disabled" and "no tiers"), which is what
  releases it. A tier-config save in that organization waits for the scan to
  finish — normally well under a second, longer for a very large roster.
- **The lock alone was not enough, and the edit now counts in a fresh
  snapshot.** The occupancy count is a plain read, and InnoDB answers a plain
  read from the snapshot taken at the transaction's first read — the auth
  dependency's, before the lock was asked for — so an edit that waited out a
  scan still counted the roster as it was before the scan. The edit now ends
  its read-only transaction before taking the lock, so its count sees every
  tier change committed before it. Demonstrated on real connections: without
  this, both race tests fail.
- **`change_membership_type` now locks the `Organization` row before the
  member row**, the order the scan uses. The previous member-then-organization
  order was safe only while the scan never took the organization lock; with
  it, a manual tier change and a scan could each hold what the other waited
  for.

Tested in `tests/test_membership_tier_lock_race.py` (the scan against the edit
on real connections) and the lock-order assertions in
`tests/test_capacity_locking.py`. (Security review USR-10a,
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

## Membership Pipeline — Election Packages Have No List Bound or Creation Cap (2026-08-25, creation resolved 2026-10-11)

**✅ Creation resolved 2026-10-11 (owner decision 2026-10-05: regenerating
replaces the prior package).** `create_election_package` now deletes the
prospect's existing **draft** or **ready** package in the same transaction as
it inserts the new one, under a lock on the prospect row, so an application
holds at most one package still being assembled however often it is
regenerated. Packages **added to a ballot, elected or not elected** are the
record of a vote and are kept. The coordinator's notes and the package
config (the supporting statement) carry over to the new package unless the
request supplies its own, and the activity log's `election_package_created`
entry lists the `replaced_package_ids`. No API shape change; the behaviour
change is that the old draft/ready package id stops existing. Replacing
drafts as well as ready packages was confirmed by the owner on 2026-10-12: a
draft holds the same personal-data snapshot, so narrowing the replacement to
ready packages would bring back the growth this closes. The list
endpoint is still unpaginated — the owner did not choose pagination — but it
is now bounded by applicants × votes held rather than by clicks.
`tests/test_election_package_regenerate.py` pins it. The original finding
follows.

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

## Membership Pipeline — `/widget-summary` Loads Every Prospect Row to Count Them (2026-09-02, resolved 2026-10-11)

**✅ Resolved 2026-10-11 (owner decision: counts via SQL `GROUP BY`; details
capped at the 10 most recent + "View all").** `by_status` is one `GROUP BY`,
the three aging buckets one `CASE` aggregate with the same whole-day
boundaries as before, and `total` their sum — no prospect row is loaded to
count. A manager's `details` selects only id, name and status for the
`PIPELINE_WIDGET_DETAIL_LIMIT` (10) most recently created applicants, and the
new `details_truncated` flag says more exist behind `queue_url`, the "View all"
link. Response change is additive (`details_truncated`); the list is now a
glance, not a roster. Note that no dashboard screen renders this widget yet
(DASH-1 below — the registry entry now names the right path but is marked
unwired), so the "View all" link exists in the API contract for whichever widget consumes it.
`tests/test_pipeline_widget_summary_counts.py` pins the counts, the cap and
the self-application exclusion. The original finding follows.

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

**Accepted by the owner (2026-10-05):** both sites keep the file-first order;
the residual is retry-safe and needs a rare compound failure, so no
trash-and-restore scheme is built.

## Membership Pipeline — Typing Your Own Email Into the Duplicate Check Names Your Own Application (2026-10-23, resolved 2026-10-23)

`POST /prospective-members/prospects/check-existing` returns
`existing_applicant` (name, pipeline, stage) for the active applicant holding
the email the caller typed, and `POST /prospects` refuses that email with a
409 that names the same three things. Neither route has `{prospect_id}` in its
path, so the router-wide `block_self_prospect_access` guard never runs, and
neither applies `get_hidden_prospect_ids`. A caller holding `members.create`
or `prospective_members.manage` who also has an active application of their
own can type their own email and learn which pipeline and stage that
application is at. `prospect_privacy.py` says a member must never be able to
read that about their own file.

**Resolved (2026-10-23, owner decision: hide the caller's own match).** Both
routes now depend on `get_hidden_prospect_ids`. `check-existing` returns
`existing_applicant: null` when the match is the caller's own application,
and the 409 says only "An active applicant already uses this email", with no
name, pipeline or stage. The refusal still confirms that an active
application holds the email; it has to refuse, and the caller already knows
they applied. That is the same line the router guard's 404 draws. Both routes
were removed from `EXEMPT` in `tests/test_prospect_route_self_access_coverage.py`.

## Membership Pipeline — A Pipeline With Multiple `election_vote` Stages Has No Single "Current Stage" Once Neither `current_step` Nor a Supplied `step_id` Identifies One (2026-09-02, narrowed 2026-09-02, resolved 2026-10-11)

**✅ Resolved 2026-10-11 (owner decision 2026-10-05: require `step_id` only
when the current step is not an election stage and the pipeline has more
than one — 422 otherwise).** The sort-order guess is gone for that case:
`create_election_package` raises `ElectionStageAmbiguousError` and
`POST /prospects/{id}/election-package` answers **422** — "This pipeline has
more than one election vote stage and the applicant is not on any of them.
Choose which election vote stage this package is for." — when the applicant
is not on an `election_vote` stage of the governing pipeline, the pipeline
has two or more, and `step_id` is omitted or names a step of another type.
An applicant on a vote stage, and every pipeline with one vote stage, need no
`step_id` and behave as before. Multiple vote stages remain allowed.
`tests/test_election_package_regenerate.py` (`TestAmbiguousElectionStage`) and
the two updated cases in `tests/test_membership_pipeline_pass4_round4_codex.py`
pin it. The history follows.

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

**Resolved (2026-10-11), owner decision: self or `inventory.manage`, matching
the clearance route.** Both handlers now authenticate only and call
`_require_self_or_quartermaster` before any query, so a member reads their own
allowance usage and sizes and a quartermaster reads anyone's; a baseline member
asking for a colleague's gets 403. The only frontend callers (issuing from
**Pool Items**, and **Edit sizes** on the Members Inventory page) are already
quartermaster screens. Pinned by
`tests/test_inventory_member_reads_self_or_manage.py`.

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

**Resolved (owner decision, docket INV-16, 2026-10-11):** closed without a
contract change. `update_reorder_request` now reads the row with
`SELECT … FOR UPDATE` (and `populate_existing`, so the comparison uses the
committed `quantity_received`), which serializes a plain edit against a
concurrent transition or receipt, and it refuses a `quantity_requested` below
`quantity_received` with a 400. PATCH still takes no `expected_version`; a
plain edit does not bump `version`. Pinned by
`tests/test_inventory_reorder_edit_lock.py`.

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

**Resolved (owner decision, docket INV-17, 2026-10-11):** "close the earliest
open record (or let the officer pick when several) instead of creating a new
one". Complete work now fetches the item's open records through
`GET /inventory/items/{id}/maintenance?open_only=true` (a new, additive query
parameter: open records only, earliest scheduled first — the default ordering
by `completed_date` desc put every open record past the page limit on a long
history) and completes the chosen one through the existing
`PATCH /inventory/items/{id}/maintenance/{record_id}`. One open record is
closed directly; several show a picker defaulting to the earliest; none falls
back to creating a completed record as before. The record keeps its task
description, and the performed work is appended to its notes.
`update_maintenance_record` now reads the record `FOR UPDATE` so two officers
completing the same record update the item once. Open _inspection_ records
are deliberately not offered to Complete work (it carries no pass/fail, and
completing an inspection moves the inspection clock).

**Scheduled inspections (owner decision, 2026-10-12):** "Record inspection
closes the item's open scheduled inspection record, mirroring Complete work".
Record inspection now reads the same open-record list, keeps only the
inspection types, and closes the chosen one through the same PATCH with the
pass/fail, completion date and notes ("Inspection notes: …" appended, the
original description kept): one is closed directly, several show a picker
defaulting to the earliest scheduled, none records a new completed inspection
as before. So that closing moves the item exactly as recording a new
inspection does, both paths now go through one helper
(`InventoryService._apply_completion_to_item`); the PATCH path had never
applied the create path's failed-inspection quarantine, so a scheduled
inspection closed as failed would have left the item available. The PATCH
path also now refuses to complete an inspection with no pass/fail result or
no completion date, as the create validator does. Pinned by
`tests/test_inventory_maintenance_close_open.py` and
`InventoryMaintenancePage.test.tsx`.

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

**Accepted by the owner (2026-10-05): leave as is.** Correctness requires the full
set and catalogs are department-sized, so both reads keep materializing the
whole candidate set; no cap will be added.

**Not the same shape as `get_inventory_summary`'s own (unrelated)
maintenance-due count**, which looked identical on the surface — also an
unbounded `.all()` — but only ever read `len()` off the result, so it was
cheaply fixable and was fixed (a `COUNT(*)` query, no correctness tradeoff)
rather than added here. See INV-28 in the same security-review doc.

## Membership — Department Email Generation Has No Settings Screen (2026-08-12)

**✅ Resolved 2026-10-11 (owner decision: build a Department Email section in
Organization settings).** **Settings → Organization → Department Email** now
has the switch, the domain and the address format, with a live example, and an
explicit Save (not autosave — half a domain must never be what a conversion
uses). It refuses to save "on" without a domain, and normalizes what is typed
(trims, drops a leading "@", lowercases) and rejects a URL. It writes through
the general `PATCH /organization/settings`, which the generator already reads;
`tests/test_department_email_settings_roundtrip.py` pins that the saved value
drives the generated address and that switching it off stops generation. The
original entry follows.

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

## DASH-1 — The Main Widget Registry Is Mostly Unread (2026-08-23, resolved 2026-10-11)

**✅ Resolved 2026-10-11 (owner decision 2026-10-05: mark the unwired entries
in the file).** Every entry in `widgetRegistry.ts` now carries `wired` (true
only when a screen reads it through `dashboardWidget()`) and
`aggregateEndpoint` (`mounted` or `not-built`). Seven entries read
`wired: false`; five of those read `aggregateEndpoint: 'not-built'`
(onboarding, membership status, admin hours, meetings, messages). The two
paths that pointed at the wrong prefix were corrected while marking them —
`/prospective-members/widget-summary` and `/organization/setup-checklist` —
since both routes exist and nothing fetched the old strings.
`widgetRegistry.test.ts` scans the source for `dashboardWidget('…')` calls and
fails if the set of `wired: true` entries differs from the set actually read,
or if a wired entry's endpoint is `not-built`. No endpoints were built and no
entries were deleted. The original finding follows; its table describes the
paths as they were.

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

**Status:** Resolved 2026-10-11 by marking (LOW — found 2026-08-23, verified
against the code the same day).

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

✅ **Resolved 2026-10-11 (owner decision: paginate drafts and history with a
"load more" UI — bounded cost, changes the response envelope).**

`GET /legal-documents` used to return every draft and every archived revision's
full body (up to 100,000 characters each), for both document types, on every
load of Governance → Legal Documents, with no cap on how many drafts a
`legal.propose` holder could accumulate.

It now returns, per document, the **first ten** drafts and the first ten
history entries (newest first, `id` breaking ties) plus `draftsTotal` and
`historyTotal`; the live revision's publisher is read on its own rather than
picked out of the full list. **Envelope change:** `drafts` and `history` are
no longer complete — a client must read the totals. The rest is served by the
new `GET /legal-documents/{document_type}/revisions?kind=drafts|history&offset=&limit=`
(limit 1–50, default 10; same permissions as the overview), and the screen
appends it with **Load more proposals** / **Load more versions**, skipping any
revision already shown. Tested in `tests/test_legal_documents_paging.py`,
`legalDocumentsStore.test.ts` and `LegalDocumentsPage.test.tsx`.

~~**What remains:** draft creation is still uncapped per user and per
organization; only the cost of _reading_ them is now bounded.~~

✅ **Draft creation capped 2026-10-12 (owner decision: at most 10 open drafts
per member per document type).** `LegalDocumentService.create_draft` refuses
an eleventh with a 400 — "You already have 10 open proposals for the privacy
policy. Publish or withdraw one first." — and the screen shows that message.
An **open** draft is one in status `draft`: publishing moves it to
`published` (later `archived`) and withdrawing deletes it, so either frees the
slot; `archived` and `published` rows never count. The check locks the
proposer's own `users` row (org-scoped) and counts with a locking read
(pitfall #27) — the user row rather than the organization row, because publish
already locks the organization and would otherwise queue every member's
proposal behind every other member's. The decision sets a per-member cap
only, so there is **no separate per-organization cap**: an organization's open
drafts are bounded by 10 × 2 document types × its number of members who can
propose. Tested in
`tests/test_legal_documents_draft_cap.py` (including a two-connection race at
nine) and `tests/test_capacity_locking.py::TestLegalDraftCap`. (Security review
DOC-8, `docs/security-review/DOC-10-documents-legal.md`.)

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

**Accepted by the owner (2026-10-05):** the read keeps its `.view` gate, one
tier looser than the write, so no existing viewer's screen starts refusing.

## Outbound Integration Requests — DNS Rebinding Is Closed for Direct `httpx` Connections; a Proxied Deployment and the `boto3`-Based S3/MinIO Connector Rely on the Up-Front Check Alone (SCH-10, resolved 2026-10-05 for `httpx`; S3/MinIO gap noted 2026-10-25)

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

**What also remains — the S3/MinIO remote-storage connector
(`app/services/s3_storage.py`), added 2026-10 and not part of the original
six.** An org administrator's configured bucket endpoint is checked with the
same `assert_outbound_url_safe()` (`check_endpoint`, line 188) before a
`boto3.client("s3", endpoint_url=…)` is built — but `boto3`/`botocore` resolve
the hostname themselves, on their own `urllib3`-based stack, independently on
every `put_object`/`get_object`/`head_object`/`delete_object` call.
`SSRFSafeAsyncTransport` is an `httpx` transport and cannot wrap a `boto3`
client, so this connector never received the pinning fix above — it sits at
the same narrowed-but-not-closed point the other six were at before SCH-10.
The window is bounded by `file_storage_service.py`'s 30-second per-org config
cache (`_ORG_STORAGE_TTL_SECONDS`), which re-runs the check on every rebuild,
but a rebind inside that window — or a hostname that resolves safely at
config time and unsafely by the time `boto3` connects — reaches the internal
address unpinned. Closing it needs a `botocore`-specific mechanism (a custom
endpoint resolver or connection pool), not a reuse of `SSRFSafeAsyncTransport`.
**Owner decision, if this matters for a deployment:** restrict which
administrators can set a custom S3 endpoint (the risk does not apply to
AWS's own endpoints, only to a self-hosted MinIO/S3-compatible one with an
operator-chosen hostname), or accept the same narrowed check the pre-SCH-10
integrations ran under until a `botocore`-specific pin is built. Not guarded
by `tests/test_integration_dns_pinning.py`, which covers the `httpx` path
only. (Security review SEC-00 pass 12, SEC12-1.)

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
half-read body is never parsed as the next response. A refusal or timeout
surfaces from the connector as the typed `CalendarTransient` error
(`integration_services/calendar_common.py`), and `test_connection` still
returns its generic message. Guarded by
`backend/tests/test_google_calendar_http_bounds.py`, against a real loopback
server: a normal response succeeds; chunked and declared-length streams four
times the cap are refused without the server managing to send the whole
stream; a gzip body that inflates past the cap is refused; a response that
stalls before its headers or mid-body times out; the same `Http` object works
again after a refusal; and the whole `googleapiclient` stack, pointed at the
loopback server, succeeds, fails cleanly on an oversized body, and raises
`CalendarTransient` from `upsert_event` against a stalled API within five
seconds.

**Still open:**

- **No wall-clock deadline** — the timeouts are per socket operation, so a
  server that trickles a byte every few seconds is bounded in memory but not
  in time. The `httpx` connectors have had a total deadline since 2026-10-04
  (`INTEGRATION_DEADLINE_SECONDS` in `create_integration_client()`), but it
  is an `asyncio.timeout()` around `send()`, and Google Calendar's calls are
  synchronous `httplib2` calls run in a worker thread (`asyncio.to_thread`),
  so it needs its own mechanism. Running them in a thread means they no longer
  block the event loop, but a cancelled wait does not stop the thread.
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

## Calendar Publishing — What a Pass Sends, and What No Screen Sets (2026-10-16)

The `calendar_sync` scheduled task publishes department events one way to a
Google Calendar or Outlook integration's calendar
(`app/services/calendar_sync_service.py`, mapping rows in
`calendar_sync_mappings`). It does nothing unless `CALENDAR_SYNC_ENABLED` is
on, and then only for an integration that is connected and holds a refresh or
access token plus a `calendar_id` in its config — which only the provider
sign-ins on the two cards write (see
[guide 16](training/16-integrations.md#calendar-integrations)).

What a pass sends is the allowlist in `build_calendar_payload`: title, start
and end in the department's timezone, location name, event type label, a link
back, and the description only when the integration's `sync_descriptions` is
true. It skips drafts, deletes cancelled events from the calendar, covers 30
days back to `days_ahead` (default 180) ahead, and honours an
`event_types_to_sync` list. The cards set `sync_descriptions`; no screen sets
`days_ahead` or `event_types_to_sync`, which only the API accepts.

## Salesforce Integration — Clearing the Refresh Token Has No Reachable UI Control (INT-11, 2026-09-13)

✅ **Resolved 2026-10-11 (owner decision: a dedicated "Switch to Client
Credentials" button sending `""`).**

`connect_integration`/`update_integration`
(`backend/app/api/v1/endpoints/integrations.py`) already special-cased an
explicit `config["refresh_token"] == ""` on a Salesforce integration: it clears
the stored `refresh_token` and `access_token`, moving the integration from a
person's interactive OAuth grant to the Connected App's client-credentials
flow on the next sync. The page could not send it — `refresh_token:
sfRefreshToken || undefined` drops a blank, and an omitted secret means "leave
unchanged" — so an administrator who cleared the box and saved changed
nothing.

The Salesforce **Sync** panel now has a **Sign-in method** section with a
**Switch to Client Credentials** button. After a confirmation that says what
the Connected App needs, it sends `PATCH /integrations/{id}` with exactly
`{"refresh_token": ""}` — no other field — and the backend behaviour above does
the rest. The blank-means-unchanged rule for every secret field on the page
is deliberately untouched (option 2, which would have risked wiping working
secrets, was not chosen). Tested in `IntegrationsPage.test.tsx` (the request
sent, and nothing sent on cancel) and
`tests/test_salesforce_switch_to_client_credentials.py` (the tokens cleared,
the client id/secret and public settings kept, an omitted token left alone).

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

> **✅ Resolved 2026-10-11 (owner decision: build the `TASK_RUNNERS` sender
> and a saved-reports screen with the PII gate — the full feature).** The daily
> `saved_report_delivery` task (`app/services/saved_report_schedule.py`) sends
> each active scheduled report on its `next_run_date` (the department's date)
> and advances it, so a second run the same day sends nothing; a schedule saved
> before the sender existed gets its first email at its next occurrence, not on
> upgrade day. `POST`/`PATCH /reports/saved` now validate a schedule
> (frequency, day, 1–25 recipients, a known `filters.period`), compute
> `next_run_at`, and report `enforced: true` for a live schedule; saving or
> editing a PII-bearing report type needs the same permission as running it.
> **The PII gate:** for the eight `PII_REPORT_PERMISSIONS` types every
> recipient must be an active member holding that permission (refused with the
> addresses named on save, dropped and logged at send), and the schedule's
> owner must still hold it on the run day or the send stops. **The email
> carries only the report's top-level counts** and a link to the new
> `/reports/saved` screen — never member rows — so non-PII reports may go to an
> outside address (audited via `audit_external_recipients`). Saved reports also
> take a relative `filters.period`, resolved on the run day by both the
> scheduled send and **Run**. **Accepted, by design:** the email is a summary,
> not an attachment; a member-data report reaches its recipients only through
> the app. Tests: `tests/test_saved_report_delivery.py`,
> `SavedReportsPage.test.tsx`. The text below is the original finding.

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

> **✅ Resolved 2026-10-11 (owner decision: relabel as program-enrollment
> progress, and fix `requirement_breakdown` grandfathering — no silent number
> change).** Option (2) below. The `compliance_status` report is now titled
> **Program Requirement Progress** and `training_summary` **Training & Program
> Progress Summary** (report ids, routes and response shapes unchanged); both
> descriptions say they are not requirement compliance, and the renderers no
> longer use the word — the buckets read All Requirements Met / Some Met /
> None Met, the column Program Progress. `_generate_training_summary`'s
> `requirement_breakdown` now grades each requirement with
> `requirement_applies_to_user` and `catch_up_deadline`, exactly as
> `_generate_compliance_status` does, so a member a requirement exempts or is
> still giving time to catch up is left out of that requirement's count rather
> than counted unmet (its population — enrolled members, or active members when
> nobody is enrolled — is unchanged). That fix does move those percentages
> where grandfathering or role/position scoping applies; it is the change the
> owner asked for. The always-zero `compliance_percentage` on summary member
> rows is no longer exported (the API field is unchanged). **Remaining, by
> decision:** the two reports still measure program progress and can disagree
> with the dashboard; that is now stated on them. Tests:
> `tests/test_training_summary_program_progress.py`,
> `programProgressLabels.test.tsx`. The text below is the original finding.

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

- ✅ **Resolved 2026-10-11 (owner decision: one audit event per closed
  session).** `run_admin_hours_auto_close` used to force-close a member's
  open admin-hours session (a money-adjacent paid-hours state change) with no
  audit trail. `auto_close_stale_sessions` now writes one
  `admin_hours.session_auto_closed` event (`administration`, `warning`) per
  closed session, stamped with the session's organization and carrying the
  entry, the member, the category, the capped clock-in/out, the duration, the
  limit applied and `trigger` — `scheduled` for the 30-minute task (no acting
  user), `manual` with the officer named when **Close Stale Sessions** is
  pressed. Not a batched summary: a member disputing a capped session can find
  the record for that session alone. Tested in
  `tests/test_admin_hours_auto_close_audit.py`.

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

**Dropped by the owner (2026-10-05):** injection-attempt detection will not be
built; the application relies on parameterized queries and input validation
instead. The code half of the decision is already done — `SENSITIVE_ENDPOINTS`
has been removed and no longer exists anywhere under `backend/`.

## MM-9 — `approve_meeting` Has No Approval State Machine or Separation of Duties (2026-08-31)

> ✅ **Resolved (2026-10-11), as the owner chose: keep `Meeting` approval
> single-actor, but require `PENDING_APPROVAL` first and block approval by
> edit.** `MeetingsService.approve_meeting` now refuses a meeting that is not
> `pending_approval` (400: _"Only a meeting pending approval can be approved;
> submit it for approval first"_, or _"This meeting is already approved"_, so
> an approved record's `approved_by`/`approved_at` are never re-stamped), and
> `update_meeting` refuses a `PATCH /meetings/{id}` that moves `status` into
> `approved` (400), so every approval carries an approver and a timestamp. A
> draft is submitted by `PATCH` with `status: "pending_approval"`. No
> `submitted_by` field or second-person rule was added — the same officer may
> submit and approve — which is the deliberate difference from
> `MeetingMinutes` (MM-5). The text below is the original finding.

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

## Minutes — Publishing and the Public Page (2026-10-17)

**Open — owner decisions to confirm.** Publishing minutes to the library and the
public page (see
[MEETING_MINUTES_MODULE.md](./MEETING_MINUTES_MODULE.md#publishing-2026-10-17))
made these choices. Everything is off until the department switches it on.

- **The public copy is stricter than "the printed copy".** The PDF lists attendees
  by name, closed-session participants and summaries, and individual votes; a page
  anyone can open does not. The public copy shows attendance as counts plus the
  officers present, motions with the totals and result, and closed sessions as
  reason, authority and times. To show more, add the field to the whitelist in
  `app/utils/minutes_public.py`.
- **Executive-session minutes can be posted publicly if the department turns on
  all three switches.** That was the owner's choice (two switches: library, and
  public). It is the one setting here that cannot be undone for a reader who has
  already seen the page; the settings screen asks for confirmation, and each
  public request re-checks the switches, so turning it off hides the copy at
  once.
- **The hosted page answers only on a deployment with one organization**, the
  same rule as `/privacy` and `/terms`, and only while the Minutes module is
  enabled. With two or more it returns 404 rather than guess whose minutes to
  show.
- **A failure while posting the public copy leaves the library copy filed.**
  Publishing again repeats both and is safe to repeat.
- **Minutes published before this change carry no recorded version**, so their
  next republish has no "replaces version" note.

---

## Minutes — Attendance Listing (2026-10-18)

**Open — owner decisions to confirm.** See
[MEETING_MINUTES_MODULE.md](./MEETING_MINUTES_MODULE.md#who-the-minutes-name-2026-10-18).

- **Unset reads as "everyone", not "present only".** The owner preferred present
  only as the default, but an installation that never chose would otherwise
  start hiding absences on printed and published copies the moment it upgraded.
  A department switches to present only under Minutes → Settings → Attendance. To make
  present only the default for new installs, change `DEFAULT_ATTENDANCE_LISTING`
  in `app/utils/minutes_attendance.py` (existing installs that never set it
  would change too).
- **The listing applies when a copy is shown, not when minutes are adopted.**
  Changing the department default changes how already adopted minutes print,
  and a library copy already filed keeps the listing it was published with
  until it is republished. The sealed approved version is unaffected: it does
  not depend on the display choice.

---

## Minutes — Prepared Motions and Accepting the Previous Minutes (2026-10-18)

**Open — owner decisions to confirm.** See
[MEETING_MINUTES_MODULE.md](./MEETING_MINUTES_MODULE.md#prepared-motions-and-accepting-the-previous-minutes-2026-10-18).

- **Outlines a department already saved are not changed.** Only the built-in
  outlines mark approval of previous minutes and adjournment as needing a motion,
  so a department with its own saved outline ticks the box on the Outlines screen
  before its minutes get prepared motions. Setting the flag on every saved
  outline's sections of those two keys would be a data migration; it was not done
  because it would change what existing departments' next minutes contain.
- **Minutes made before this change get their prepared motions when next edited**
  (sections saved, an outline applied, an agenda synced), not at once.
- **"Previous minutes" means the latest earlier circulated or adopted minutes of
  the same kind of meeting.** A trustee meeting accepts the last trustee minutes,
  not the last business ones. A draft set is skipped, and if none has been
  circulated the motion reads generically and links nothing.
- **Passing the acceptance motion does not adopt the previous minutes.** An
  officer other than the one who circulated them confirms the pre-filled
  adoption, because the separation-of-duties rule was kept.

---

## MM-17 — `set_meeting_quorum_config` Has No Finalization Guard on Approved Minutes (2026-09-13)

> ✅ **Resolved (2026-10-11), as the owner chose: lock on APPROVED, with a
> reopen path for corrections.** `PATCH /minutes-records/{id}/quorum-config`
> now refuses approved minutes (400, _"Approved minutes are locked. Reopen
> them to correct the quorum settings."_), matching every sibling mutation.
> `GET /{id}/quorum` — which recalculated and **wrote** `quorum_met` /
> `quorum_count` on every call, from today's active-member count and today's
> org default — no longer writes on approved minutes and reports the stored
> result. The correction path is the new `POST /{id}/reopen` (`minutes.manage`,
> a 10–500 character reason): approved minutes return to draft with their
> approval and submission cleared, the prior approver and approval time go
> into a `minutes_reopened` audit event, and the record is submitted and
> approved again under the usual separation of duties. The minutes page offers
> it as **Reopen for Correction** on approved minutes. The text below is the
> original finding.
>
> ✅ **Residual resolved (2026-10-12), as the owner chose: the published
> document stays readable, marked "Being corrected", until the corrected
> minutes are republished, which replaces it.** A reopen now stamps
> `documents.under_correction_since` on the document named by the minutes'
> `published_document_id` (resolved in-org; migration `4d8807bdd737`, a
> guarded nullable column). `DocumentResponse` carries the field, and the
> Documents screen shows a warning notice on that document in both grid and
> list views — _"These minutes were reopened for correction on [date]. A
> corrected version will replace this document when it is approved."_ The flag
> is stored rather than derived from the minutes' status because it must
> outlast the re-approval: approved-but-not-republished minutes still leave the
> old text in Documents. Republishing already updated the same document row in
> place (links stay valid, no second copy); it now also clears the flag. A
> reopen that happened before this revision left no mark, so such a document
> reads as current until it is republished.

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

## MM-19 — A Prepared Motion's Find-or-Create Had No Lock (2026-10-20, resolved 2026-10-25)

**Resolved.** `ensure_section_motions` locks the minutes row and reads the
motions with a locking read, so two saves of one draft cannot each add the
section's motion. Kept only because code and tests cite it by name; history in
`docs/security-review/MM-24-meetings-minutes.md`.

## MM-20 — Publishing a Public Minutes Copy Had No Lock Either (2026-10-20, resolved 2026-10-25)

**Resolved.** `_post_public` locks the minutes row and reads the copy with a
locking read, so a second publish replaces the first one's copy instead of
failing on the unique key with a 500. Kept only because code and tests cite it
by name; history in `docs/security-review/MM-24-meetings-minutes.md`.

## MSG-12 — A Failed or Throttled Department-Message Delivery Is Never Retried (2026-08-31, stranded-pending sub-case fixed 2026-09-06)

> ✅ **Resolved (2026-10-11), as the owner chose: record throttled sends as
> retriable rows, and retry on a schedule.** Migration `b834afdaffdf` adds
> `attempt_count` and `next_attempt_at` to `department_message_deliveries`.
> A failed send, or one held back by the hourly escalation cap (which now
> writes a row per member instead of only a log line), is recorded as
> `retrying` and sent again by the new `retry_message_deliveries` task (every
> 5 minutes) 5, 10, 20, 40 and 80 minutes after each attempt — five retries.
> A sixth failure is final: the row says `failed`, and the message's
> acknowledgment report (the per-member delivery list on the Messages admin
> screen) shows "Email failed" / "Text failed" beside the member, or "not
> sent yet, trying again …" while a retry is pending. A due retry whose
> message has since been deactivated, deleted or expired, or whose member left
> the audience, is written down as failed with that reason. Rows that failed
> before the upgrade are not retried. A duplicate remains possible in the
> direction the stranded-claim fix already chose (a provider that accepted a
> message but reported failure is sent to again). The history below is kept
> as the record.

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

> ✅ **Resolved (2026-10-11), as the owner chose: pin by default, with an
> explicit test-only bypass.** `PushService._send_one` now pins every send
> whatever `ENVIRONMENT` says. The only way round it is the module attribute
> `push_service._UNPINNED_SENDS_FOR_TESTS`, which `tests/test_push_service.py`
> sets so its local stand-in push service can be reached; it is not a setting,
> so no deployment can switch it on, and production/staging pin even if it
> were. Guard tests in `tests/test_push_rebinding_guard.py`. The history below
> is kept as the record.

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

> ✅ **Resolved (2026-10-11), as the owner chose: enforce on both paths.**
> `FormsService.submit_form` now runs the same locked duplicate check
> (`_already_submitted`) as the public path, and a prior submission by the same
> member on either path counts. Accepted cost: a form set to one submission
> per person through the API but used for repeat in-app submissions now
> refuses the second one with _"You have already submitted this form"_; untick
> **One submission per person** on such a form. The history below is kept as
> the record.

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

> ✅ **Resolved (2026-10-11), as the owner chose: add the control.** A **One
> submission per person** checkbox in the Create Form dialog and at the top of
> the form editor's Builder tab writes `allow_multiple_submissions`; with the
> scope entry above resolved, it governs both submit paths. The default stays
> "repeats allowed". The history below is kept as the record.

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

**Accepted by the owner (2026-10-05):** the last option — merge revisions are a
normal cost of parallel work, each fork repaired by one follow-up PR, and no
pre-push or merge-time tooling is built.

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

**Accepted by the owner (2026-10-05).** `color` carries the same up-to-90-seconds
staleness as the rest of a catalog the caller is already authorized to read;
`GET /inventory/items` stays cacheable and `color` stays free text.

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

## MS-15 — Compliance Roster Loads Every Screening Record in the Organization, Unbounded (2026-10-13)

`GET /medical-screening/compliance` (the Compliance tab's department
roster, added 2026-10-11) grades every screenable member and open prospect
by calling `MedicalScreeningService.get_compliance_roster`, which loads
_every_ screening record ever created for the organization — no date,
status, or subject filter, and `list_records`'s own `limit=None` default —
to group into per-subject lists for grading. This runs on every tab load or
filter change, not an admin batch job, and only the single latest record
per subject/screening-type is ever used, so the load grows with the
organization's full history even though most of it is never read.

Same class as FIN-9/ELEC-12/USR-5/MP-10/DOC-9/MS-6 (no SQL-level pagination
on an org-wide table), but a genuinely new call site: MS-6's own fix (PR
#2965) added `skip`/`limit` to the _public_ `GET /records` list; it could
not reach this _internal_ roster call, which by design needs every
subject's history to grade correctly — the same reason the single-subject
`get_compliance_status` call also passes `limit=None`, accepted there
because one person's history is small. `get_compliance_roster` is the same
shape applied to the whole organization at once.

Not fixed: narrowing the query to a SQL-level "latest record per subject per
screening_type" (mirroring the `exists()`/`aliased()` superseded-record
pattern already written for the MCP tool's `list_expiring_screenings`,
`app/mcp/tools/medical.py:131-167`) is a grading-implementation change on a
PHI-adjacent, department-wide read, where a subtle error in the "latest"
definition would silently change who reads compliant for the whole roster
at once — the kind of change this feature's established discipline (MS-6,
MS-9, MS-13) declines to make without a product decision. It is also
plausible the real-world scale is fine as-is: the target deployment is a
volunteer fire department's own roster (tens to low hundreds of members),
not an enterprise table. Found in
`docs/security-review/MS-09-medical-screening.md` (feature 09, pass 8,
MS-15).

## MS-16 — `grace_period_days` / `applies_to_roles` / `frequency_months` Are Stored and Read By Nothing (2026-10-15, two of three resolved)

**✅ `applies_to_roles` resolved 2026-10-19 (owner decision: it names _positions_).** A requirement listing positions now applies only to members who hold one of them, matched by position name or slug, ignoring case and word separators; a blank list applies to everyone; a prospect holds no positions and is graded on every requirement; a member left with nothing that applies reads `not_applicable` on the roster, never compliant. The form says so and the "Not enforced yet" notice is gone from that field (`_applicable_requirements` in `medical_screening_service.py`; `tests/test_medical_screening_requirement_positions.py`). **✅ `frequency_months` resolved 2026-10-25** (W71-1 above): a record with no expiration date falls due that many months after completion. **`grace_period_days` is unchanged and still open**, as described below.

`screening_requirements.grace_period_days` (default 30) and `.applies_to_roles`
have labelled, editable controls on `ScreeningRequirementForm.tsx`, each with
a "Not enforced yet" notice beside it — but `_grade()`/`get_compliance_status`
(`medical_screening_service.py`) never reads either: compliance is a hard
`expiration_date >= today` with no grace, and a requirement scoped to
`["emt"]` still grades every member and prospect in the org. `frequency_months`
is in the same position — written on create, read nowhere — but was
deliberately left out of the dedicated guard test's scope (a separate,
considered edit for a future pass, not an oversight).

**Correcting this file, not just adding to it.** Every pass of
`docs/security-review/MS-09-medical-screening.md` since pass 3 (2026-09-02)
described this as "already in `KNOWN_LIMITATIONS.md`" — it never was; each
pass repeated the prior pass's claim rather than grep-ing this file to check
it. The notices on the form, and `test_medical_screening_requirement_fields_
are_unwired.py`'s guard against a silent reader appearing without the notice
being removed, are both real and have been since pass 4 — only the mirror
into this file was missing. Not fixed here: wiring either field changes who
counts as non-compliant (and for `applies_to_roles`, which requirements apply
to whom) for any organization already holding a non-default value, which is
a product decision, not a same-day patch.

## MS-17 — `GET /medical-screening/compliance/{user_id}` Returned 200 For a Nonexistent Subject (2026-08-25, resolved 2026-10-25)

**Resolved (owner decision: 404).** Both compliance routes, member and
prospect, now answer 404 for an id that is not a member or prospect of the
caller's organization, before anything is graded or audited. Kept only because
`endpoints/medical_screening.py` and
`tests/test_medical_screening_compliance_subjects.py` cite it by name; history
in `docs/security-review/MS-09-medical-screening.md`.

## FAC-13 — Every Facility Folder Requires the Sensitive-Family Permission Set, Silencing Three Established-Baseline Categories for Their Intended Audience (2026-09-03)

✅ **Resolved 2026-10-11 (owner decision: a new "any facilities access" tier,
Blueprints & Permits stays sensitive; reclassify existing documents; restamp
migration).** `FACILITY_ACCESS_PERMISSIONS` (`facilities.view`,
`.view_sensitive`, `.edit`, `.manage`) now gates the Facility Files root, each
per-facility folder, and Photos / Maintenance Records / Inspection Reports;
Blueprints & Permits, Insurance & Leases, Capital Projects and a new
restricted **Facility Documents** sub-folder keep `FACILITY_SENSITIVE_PERMISSIONS`.
Write stays edit/manage on both tiers (the view grants are read-only), and
`documents.view` alone still opens nothing. Item (3) below — files that would
be exposed by loosening the parent — is handled by refiling rather than left
open: `_validate_shared_document_reference` now files a photo into Photos and
a facility document into Facility Documents (never the parent), and migration
`65128d5ccd50` moves every file sitting directly in a facility's folder or the
root into a restricted folder (photo-referenced files into Photos), moves a
Documents-list file out of the three opened sub-folders, gives user-made
folders in the tree the sensitive tier, and records everything for a real
downgrade. Tested in `tests/test_facility_folder_tiers.py` and
`tests/test_facility_folder_tier_migration.py`. **What remains:** the
already-filed sub-case in item (3) — a facility-referenced document that was
filed somewhere outside the facility tree stays where it was and is governed by
that folder's own ACL — is unchanged; and files a sensitive-only person filed by
hand into Photos, Maintenance Records or Inspection Reports are now readable by
every facilities role, which is what the decision opens.

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

**Accepted by the owner (2026-10-05): leave as is.** A `facilities.delete`-only
custom role deletes through the facility routes, which honour the grant; the
generic Documents API keeps its two-tier check, and no seeded role is
affected.

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
[Scheduling Module — Developer Reference](../wiki/Module-Scheduling-Developer.md#data-model) states the rule and the eligibility
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

## Prospects — The Screen Re-Derives "Last Stage" Instead of Reading `is_final_step` (2026-09-24, resolved 2026-10-11)

**✅ Resolved 2026-10-11 (owner decision: read the flag; keep Convert on the
highest stage when none is flagged).** `PipelineStage` now carries
`is_final_step` from the step response, and `isConvertStage`
(`modules/prospective-members/utils`) decides the drawer's Advance/Convert:
in a pipeline with any flagged stage, only a flagged stage shows **Convert**
(and hides **Skip**), wherever it sits; in a pipeline with none, the
highest-`sort_order` stage keeps **Convert**, since the manual transfer works
without the flag. `isFirstStage` still follows the order. Covered by
`utils/isConvertStage.test.ts` and `services/stageMapping.test.ts`. The
original entry follows.

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

- **✅ Resolved 2026-10-25 — saving a draft published it, and a window-type
  event with no stored lead time saved as 60 minutes.** The edit page now
  loads `is_draft`, and fills a missing lead time with what the backend reads
  it as (15 on a window-type event, 60 otherwise).
- **An open event's times are saved at the form's minute precision.** A stored
  start or end with seconds, or one in the hour repeated when clocks fall back,
  can move by those seconds or by an hour on its first save. A finalized
  event's times are locked, never resent, and not checked by the form either.
- **A series save from an open occurrence can be refused for a field nobody
  touched.** "This and all future events" writes the edited occurrence's type,
  category and check-in rules onto every later occurrence,
  and moves every occurrence when the form's restatement of its times, which
  is to the minute, differs from what is stored (a start or end saved with
  seconds). Where a later occurrence is finalized and would change, the save
  is refused and names that field. Edit the later occurrences one at a time
  instead. The category part is new with this change: the form used to show
  every event's category as None and leave it out of the save, so a series
  save never touched it. It now loads the stored category, so a save from an
  open occurrence also writes that category onto later open occurrences that
  had a different one. Since 2026-10-16 a blank field is sent as a clear rather
  than left out, so an occurrence with no category (or no description,
  location, capacity or RSVP deadline) clears that field on later open
  occurrences too, and a later finalized occurrence that has a category refuses
  the save. A save from a finalized occurrence leaves all of these fields out
  and is not affected.
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
  - ✅ Resolved 2026-10-11 (owner decision: resolve reports through the shift;
    no backfill). The compliance report and the failure log (screen, CSV and
    PDF) attribute a check to `shifts.apparatus_id`, falling back to the check's
    own column only for a standalone check, and a department with no Apparatus
    records is reported against its basic apparatus list. Stored rows are
    unchanged. Still true: a checklist cannot name one basic unit (W46-20).
- **W46-12 — A check can be filed before its shift's date and is then invisible
  to officers.**
  - My Checklists offers shifts from today onward, and the server accepts a
    check for any of them.
  - The fleet board and log read shifts dated today or earlier. A failed check
    filed the evening before a morning shift does not appear until the date
    turns.
  - Either refuse checks ahead of the shift, or let the readiness window reach
    the next shift's start.
  - ✅ Resolved 2026-10-11 (owner decision: widen the readiness window). The
    fleet board and check log now also read a shift up to
    `EARLY_CHECK_LOOKAHEAD_DAYS` (7) ahead **when a check has already been filed
    against it**: the early check is a column after today, its findings count
    on the board at once, and it is a log entry. An upcoming shift with nothing
    filed stays off both, so the window of past duty days is unchanged
    (`tests/test_equipment_check_shift_attribution.py`).
- **W46-13 — Fail and Out of service carry no required note.** An item marked
  out of service takes the rig off the fleet board with no reason recorded.
  ✅ Resolved 2026-10-04 (#2882): the check form now requires a note on a Fail
  or Out of service the member chose (one a count, reading or expiry already
  explains is exempt) before it submits. The server enforces the same rule
  too (2026-10-12, owner decision): a shift, standalone or resumed-incomplete
  check submission carrying such an item without a note — or with a
  whitespace-only one — is refused with a 400 naming the item, before anything
  is written. The exemptions match the form's `failureNeedsNote`, expiry read
  from the soonest lot aboard as well as the item's own date
  (`backend/tests/test_equipment_check_failure_notes.py`).
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

| Item                                                                                                    | Status                                                                                   | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **The emailed ballot pre-selects Abstain on every item**                                                | ✅ Resolved (2026-10-08, owner decision; workflow review W50-25)                         | No default: the shared ballot model (`components/ballot`) starts every item with no selection, and both the emailed ballot and the in-app Cast Vote tab keep Submit / Cast Ballot disabled until every open item has a choice or an explicit Abstain, naming the items still waiting. An untouched Submit can no longer burn the single-use link. Tests: `BallotVotingPage.w50-abstain.test.tsx`, `ballotChoices.test.ts`, `ElectionBallot.w50-receipt.test.tsx`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **A sanctioned void certifies the election CHAIN_BROKEN**                                               | ✅ Resolved (2026-10-08, owner decision; workflow review W50-31; ELEC-45)                | `verify_vote_integrity` now walks voided rows with the chain and verifies their signatures, and reports them as `voided_votes` and `voids` (count, officer, reason, time, grouped per officer and reason). A sanctioned void reads PASS with "N vote(s) voided by <officer>: <reason>" on the Forensics panel and the certified PDF; a tail void is reported instead of passing silently; a tampered voided row still fails. Tests: `test_w50_integrity_with_voids.py`, `ElectionDetailPage.w50-31-voids.test.tsx`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **A manager can accept a nomination for the nominee, and the slate is not frozen at Close Nominations** | ✅ Resolved (2026-10-08, owner decision; workflow review W50-38; ELEC-46)                | Managers may accept for a nominee before nominations close: `PATCH …/candidates/{id}` routes `accepted` through `ElectionService.set_candidate_acceptance`, which stamps `candidates.accepted_on_behalf_by` / `_at` (migration `7adc810c57f9`) when the acceptor is not the nominee, audits `nomination_accepted_on_behalf` and emails the nominee; the Candidates tab labels the row "Accepted by manager" and the button reads "Accept on their behalf". Close Nominations stamps `elections.nominations_closed_at` and freezes the slate: `respond_to_nomination` and the manager toggle both refuse with "the slate is final" until nominations reopen, and the toggle is disabled on screen. This removes the earlier "nominee may respond after the phase closes but before the ballot opens" window, as decided. Elections whose nominations closed before the migration have no stamp and keep the old, unfrozen behaviour. Tests: `test_w50_manager_accept_frozen_slate.py`, `CandidateManagement.w50-38-accept.test.tsx`.                                                                                                                                            |
| **A ballot item added after tokens were issued never reaches already-sent links**                       | ✅ Resolved (2026-10-08, owner decision; workflow review W50-47)                         | A change to `ballot_items`, `positions` or `position_eligibility` (compared by value, so resaving an unchanged ballot retires nothing) now retires every outstanding link — expired and stamped `superseded_at` (`invalidate_tokens_for_ballot_change`) — and the election response reports `ballots_must_be_resent` with `ballots_resend_reason` ("ballot_changed" or "reopened"), derived from the latest real link retirement later than the last ballot or reminder send. The W50-36 banner now reads that flag: on an open election it says the ballot changed and offers Resend Ballot Emails; on a draft it explains the dead links without a send the server would refuse. A retired link answers "The ballot changed after this link was sent". Remaining: a resend to a subset of members clears the banner for everyone (the flag compares against the last send stamp). Test: `test_w50_stale_token_items.py`, `ElectionDetailPage.w50-resend-banner.test.tsx`.                                                                                                                                                                                                    |
| **Members read the recipient list and live counts from the election body**                              | ✅ Resolved (2026-10-08, owner decision; workflow review W50-70; ELEC-44)                | While an election is OPEN, `GET /elections/{id}` withholds `email_recipients`, `eligible_voters` and the resend flag from callers without `elections.manage`, and `total_votes` / `total_voters` / `voter_turnout_percentage` too unless the election publishes results immediately; `GET /elections` withholds `total_votes` by the same rule. The ballot lookup and the in-app ballot now return `BallotCandidateResponse`, which carries no `user_id`, `nominated_by` or `accepted_on_behalf_by`. Not changed: `GET /elections/{id}/candidates` still returns `user_id` to members, because a nominee finds their own pending nomination by it during the nomination phase. Test: `test_w50_member_live_detail.py`.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Auto-open sends no ballots**                                                                          | ✅ Resolved (2026-10-08, owner decision; workflow review W50-72)                         | After the lifecycle task opens a flagged draft it queues the ballot send as a background job (since 2026-10-20; it called `send_ballot_emails` inline before), with links on the configured `FRONTEND_URL` (never a request host); the mail's reply-to and contact are the election's creator, and the `ballots_auto_sent` audit row is attributed to them. A send that raises, fails for any recipient, or reaches nobody does not roll the open back: it writes `ballots_auto_send_failed` and emails every active `elections.manage` holder "Action needed: ballots for <election> were not sent". The Election Settings copy and the manual say so. Test: `test_w50_auto_open_sends_ballots.py`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **A proxy ballot on an anonymous election is attributable**                                             | ✅ Resolved (2026-10-08, owner decision; workflow review W50-2, S01; ELEC-43)            | The owner allowed proxy ballots on anonymous elections, on condition that the delegating member acknowledges they are attributable. `add_proxy_authorization` now refuses an anonymous-election authorization without `anonymity_acknowledged` and stamps `anonymity_acknowledged_at` on the record; the Proxy Voting form shows the warning with a required checkbox; the delegating member is emailed "Proxy authorized" with the same warning; the interim refusal (`_proxy_anonymity_error`) now refuses only an unstamped authorization on an anonymous election, so one created before the rule must be revoked and re-authorized; and the certified PDF names the proxy votes as the exception to "de-anonymization impossible". The linkage itself is still stored in clear on the vote row — by decision, not as a salted hash. Tests: `test_w50_proxy_anonymity_ack.py`, `ProxyVotingManagement.w50-anonymity.test.tsx`.                                                                                                                                                                                                                                             |
| **Audit rows written before S01 still name anonymous in-app voters**                                    | Accepted by the owner (2026-10-05; MED, workflow review W50-2, residual)                 | `vote_cast` rows written before `3de83db` carry the voter's `user_id` beside `vote_id`, and they cannot be scrubbed without breaking `verify_integrity` — the same shape as the ELEC-6 IP residual above. `7aa3405` removes the other half of the join (`candidate_id` in `deleted_votes` on anonymous elections), so such a row can no longer be paired with a choice through forensics, but a database read still can. The operator should be told that the audit trail of any anonymous election held before the fix names its in-app voters. **Accepted by the owner (2026-10-05), and this is the operator notice:** `vote_cast` audit rows written before the S01 fix (`3de83db`) name the in-app voters of anonymous elections, and they are left as they are, because rewriting them breaks the audit hash chain that `verify_integrity` checks. Any anonymous election held before that fix has an audit trail that names who voted in the app; forensics no longer pairs those rows with a choice, but a direct database read still can. Recorded here rather than in `docs/UPGRADING.md`, which this repository keeps for changes that can stop an upgrade booting. |
| **Votes stored across the deploy on an open ballot-item election can count twice**                      | ✅ Resolved 2026-10-08; one upgrade caveat stays documented (workflow review W50-3, S03) | Documented for operators in `docs/UPGRADING.md` — "Close any election that is OPEN before you upgrade (2026-09-30)". In-app rows written before the change carry no `voter_hash` and link rows no `voter_id`, so the two never collide; a backfill of `voter_hash` from `voter_id` is possible only while the election's salt exists, and a closed named election that was double-voted cannot be repaired. Separately, a link vote in a named election stored the hash only, so the roster of who voted could not name link voters after close — **resolved 2026-10-08 (owner decision)**: migration `edb445ae5806` adds a nullable `voting_tokens.user_id`, set at issue on named elections only (never on anonymous ones), and both token routes copy it to the vote's `voter_id`; a token issued before the column is resolved by matching its voter hash against the roster at submit time (`_token_voter_id`). Votes already cast by link before the change keep no `voter_id` — they cannot be attributed once the salt is gone. Test: `test_w50_token_voter_id.py`.                                                                                                    |
| **A multi-item ballot's `overall_results` pools every item into one contest**                           | ✅ Resolved (2026-10-08, owner decision; workflow review W50-7, S04)                     | Results are grouped per item. `results_by_position` is the result — one entry per position and per ballot item, each now carrying `ballot_item_id` and `vote_type` — and `overall_results` holds only candidates no contest claims (a legacy election whose candidates have no position), so it is empty on every item ballot instead of ranking one motion's Approve against another's Deny. The results screen heads an item ballot "Results by Ballot Item" and shows any unclaimed candidates as "Other candidates"; the certified PDF prints one table per contest (and the unclaimed table when there is one) with the tie line naming the item; the runoff check treats each candidate-selection item as a race, so a tied race on an item-only ballot now gets its runoff and a motion never does. API shape change: clients that read `overall_results` for an item ballot must read `results_by_position`. Test: `test_w50_grouped_results.py`, `ElectionResults.w50-label.test.tsx`.                                                                                                                                                                                |

## Minutes — Owner Decisions From the W51 Drive (2026-10-03)

Found driving W51 (`docs/workflow-review/W51-minutes.md`).

- **W51-4 — Executive, Trustee and Annual meetings cannot be recorded.**
  ✅ Resolved (2026-10-11), as the owner chose: migration `2cfc5a75105e`
  widens `meetings.meeting_type` to the minutes' eight types,
  `MinuteService.create_from_meeting` maps each to the minutes type of the same
  name (so an executive meeting's minutes keep the executive read restriction)
  with that type's default sections, and the Minutes page offers all eight.
  The downgrade folds the three into `other`.
  - Still true: the **meeting record** itself (title, agenda, notes) is read
    under `meetings.view` whatever its type; only the minutes carry the
    executive restriction.
- **W51-8 — Minutes created from meetings before 2026-10-03 carry a shifted
  date.** ✅ Resolved (2026-10-11), as the owner chose: a guarded backfill
  with a dry run, `backend/scripts/backfill_minutes_meeting_dates.py`. It
  re-dates a row only while its date still equals the old UTC-combined value
  of its linked, same-organization meeting, so a hand correction (or a meeting
  rescheduled since) is spared; dry run by default, `--apply` writes and
  audit-logs each change with its old and new value.
  - Remaining: it is an operator-run script, not a migration, so an
    installation's old minutes stay shifted until someone runs it with
    `--apply`.

## Action Items — Who Is Assigned, and Who Closes (2026-10-04)

Found driving W52 (`docs/workflow-review/W52-action-items.md`).

- **W52-6 — Nothing can be assigned to a member.** ✅ Resolved (2026-10-11),
  as the owner chose (picker only; any active member; old items stay
  name-only): the minutes page's action-item form picks from every active
  member (`GET /minutes-records/action-item-assignees`, `minutes.manage`),
  the server refuses an `assignee_id` that is not an active member of the
  department and stores that member's name beside it, and items assigned by
  name before this are left as they are — they show their name but never match
  "Assigned to me".
  - Still open: meeting action items (`assigned_to`) have no screen.
- **W52-7 — An assignee cannot close their own item.** ✅ Resolved
  (2026-10-11), as the owner chose: `PUT /minutes-records/{id}/action-items/
{item_id}` accepts the item's assignee, keyed on `assignee_id`, for `status`
  and `completion_notes` only (another field is a 403, someone else's item a
  404). The Action Items page offers **Update status** on those items, and its
  feed now always includes items assigned to the caller by member — even on
  minutes they cannot otherwise read (a draft or an executive session); only
  the item is shown, never the minutes.

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

**Resolved 2026-10-11 (owner decision).** Each folder card has **Manage
folder** (`FolderManageDialog`): rename, description, **Who can open it** —
Organization / Leadership / Specific roles (`visibility` plus
`allowed_roles`, positions listed by the new `GET /documents/folders/role-options`
under `documents.manage`, since `GET /roles` needs `positions.view`) — move by
browsing to a destination, and delete. Delete cascades to every subfolder and
document behind a `useConfirm` naming the document count and subfolder count.
System folders cannot be renamed, moved or deleted: the dialog does not offer
it, and `update_folder` now refuses a rename (400) as it already refused a move,
alongside `delete_folder`'s refusal. Not offered: `owner` visibility (personal
folders keep theirs) and `required_permissions` (set by modules, not by hand).

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

> ✅ **Resolved (2026-10-29), as the owner chose: give them in-app copies.**
> `app/services/officer_alert_copies.py` writes a bell entry for every officer
> each alert is about, whether or not they receive the email: low stock, the
> shelf-audit digest, NFPA retirement, Supplies to Replace and the automatic
> reorder request; member archived, the property return summary, a new store
> order, the directory-accounts digest, and an applicant withdrawing, going
> inactive or coming up for auto-purge. A recurring digest refreshes an unread
> entry instead of adding one per run. Two of the original items needed
> nothing: failed equipment checks already wrote a bell entry for every
> recipient, and the third-party nominee's accept-or-decline request already
> had one (`_record_nominee_bell_notice`). Behaviour that changed with it: an
> auto-purge warning, the shelf-audit digest and a withdrawal now count as given
> when every coordinator or manager has turned the email off, because the bell
> entries are the notice. Still open: there is no administrator view of who has
> opted out of what. Covered by `tests/test_officer_alert_copies.py` and
> `tests/test_prospect_auto_purge_warning.py`. The history below is kept as the
> record.

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

## FAC2-5 — The Cross-Facility Maintenance And Inspection Lists Showed At Most 100 Records (2026-10-11, resolved 2026-10-25)

**Resolved.** `GET /facilities/maintenance/page` and `GET /facilities/inspections/page`
return a page and the organization-wide total, with search and the tri-state
inspection `result` (`passed` / `failed` / `pending`) applied by the server. The
two cross-facility screens and the two facility-detail sections page through
them. The original `GET /facilities/maintenance` and `/inspections` list
endpoints are unchanged for other callers. Kept only because code and tests cite
it by name; history in `docs/app-review/facilities.md`.

## W56-4 / NOTIF2-6 — Notification Rules Could Not Be Edited or Deleted From the Screen (2026-10-12, resolved 2026-10-25)

**Resolved (owner decision: delete, with a warning).** Each rule on Notifications
→ Rules now has Edit and Delete. Because a trigger with no rule sends with its
defaults, and one with rules sends while any is on, the delete confirmation
says when removing the rule switches that notification back on or off for the
whole department, and the edit dialog says the same when the trigger changes.
Kept only because `NotificationsPage.ruleEdit.test.tsx` cites it; history in
`docs/workflow-review/W56-notifications.md` and `docs/app-review/notifications.md`.

## MM5-4 — Two People Editing One Set of Minutes Silently Overwrite Each Other's Sections (2026-10-13)

_(app-review B6.)_ The minutes page saves, reorders, adds and deletes a section
by sending the **entire** `sections` list built from its local copy, and
`MinuteService.update_minutes` replaces the stored list wholesale. There is no
version or precondition, so if two secretaries have the same draft open, the
second save writes back the first one's stale text for every section the second
did not touch, behind a success toast. **Why not fixed.** The cure is an API
change — a per-section update endpoint, or an `If-Match` / `updated_at`
precondition on `PUT /minutes-records/{id}` — plus a decision on how a conflict
is shown ("reload and re-apply" versus a merge). **Owner decision:** whether
concurrent editing of one draft is a supported workflow (the per-section
endpoint) or is to be refused with a conflict message (the precondition). Same
lost-update class as SF-9. See `docs/app-review/meetings-minutes.md` → Pass 5.

## ELEC2-9 — Seven `default_*` Election Settings Are Accepted, Stored And Returned, But Nothing Reads Them (2026-10-13)

> ✅ **Resolved (2026-10-29), as the owner chose: wire a reader.** Election
> Settings has a **Defaults** section again, and the **Create Election** form
> starts from the saved values; with nothing saved it starts where it always
> did. The PATCH now refuses an unknown voting method, victory condition or
> quorum type, and the GET reads a value stored before that check (or a null)
> as the built-in. A default quorum, which the form has no control for, is
> shown on the form as a read-only line. Accepted limit: only the form reads
> the defaults, so an election created directly through the API still takes
> the schema's own. Covered by `tests/test_election_defaults.py`,
> `ElectionsPage.defaults.test.tsx`, `ElectionsSettingsPage.test.tsx` and
> `utils/electionDefaults.test.ts`. The history below is kept as the record.

`PATCH /elections/settings` accepts `default_voting_method`,
`default_victory_condition`, `default_victory_percentage`,
`default_anonymous_voting`, `default_allow_write_ins`, `default_quorum_type` and
`default_quorum_value`. The handler writes them into
`org.settings["election_defaults"]` and `GET /elections/settings` returns them
back — and that is the whole of their life. Nothing reads `election_defaults`
anywhere else in the backend (the service, the create path and the schemas do
not), no frontend code reads them (the only references are the type definition
and one test fixture), and the settings screen renders no control for any of
them.

The wiki already says so: _"there are no organization-wide election defaults"_
(`wiki/Module-Elections.md`, Election Settings). The API disagrees with it in
the one place a person or an integrator would look. A client that PATCHes
`default_voting_method: "ranked_choice"` gets a 200 and sees the value come back
on the next GET, which reads as "this is now my department's default" — and the
next election created still starts as simple majority. This is CLAUDE.md pitfall
#19 (a setting with no reader) in its API-only form: no screen misleads anyone,
which is why it is rated low, but the contract does.

**Not changed in the review pass that found it**, because both fixes alter the
public API or add a feature:

1. **Remove them** — drop the seven fields from `ElectionSettingsUpdate`, from
   `ElectionSettingsResponse`, from both handlers, and from the frontend
   `ElectionSettings` type. Consistent with the wiki. Senders are not broken
   (unknown keys on the request are ignored), but the GET response loses seven
   keys, and any `election_defaults` already stored in an organization's
   settings becomes dead data unless a migration clears it.
2. **Wire a reader** — have the create-election form seed its starting values
   from them, and add the missing controls to the settings screen. This is the
   feature the endpoint appears to promise; it also needs a decision on whether a
   stored default may override the form's own initial values for an officer who
   never touched the setting.
3. **Leave it and say so** — document the seven fields as reserved and unused in
   the API reference. Cheapest, and it leaves the trap in place.

Until one is chosen, the fields are harmless to set and useless.

## INT2-3 / INT2-4 — Integrations Connect Without Credentials, And The Catalog Never Updates Existing Rows (2026-10-16, INT2-3 resolved 2026-10-27)

**INT2-3 — resolved (owner decision: require the credentials at connect).**
`POST /integrations/{id}/connect` now refuses PayPal without `client_id` and
`client_secret`, Documenso without `api_token`, Cal.com without `api_key`, and
Salesforce without `client_id` and `client_secret` (a 400 naming the missing
fields, as chat integrations already got). A blank value counts as missing, and
a credential already stored lets a reconnect through. Their config schemas keep
the credentials optional, because a partial settings update is validated
against the same schema, so the check is a list by type in the endpoint
(`_CREDENTIALS_REQUIRED_TO_CONNECT`). Covered by
`tests/test_integration_connect_required_fields.py`.

**INT2-4.** `ensure_catalog` only inserts rows an organization lacks. A catalog entry
promoted from `coming_soon` to `available`, demoted, or reworded keeps its seeded values
for every existing department, and no migration reconciles them. **Owner decision:**
decide which columns the catalog owns (status, description, category), then reconcile
them in a migration — noting that a status reconcile can change what a department sees as
connected — or accept that catalog changes reach new organizations only.

See `docs/app-review/integrations.md` → Pass 5.

## Finance — Emailed Approvals Cannot Be Re-Sent, and Show the Approver Nothing to Decide On (2026-10-14)

Found driving W62 (`docs/workflow-review/W62-approval-chains-and-finance-settings.md`,
W62-6 and W62-7).

- **A link that never arrives is invisible.** When a request reaches an
  "Email" approver step, the link is minted once and emailed.
  - If email is off or the send fails, `send_approval_request_email` returns
    False and nothing records or shows it. The queue reads "waiting on
    board-chair@example.org" either way.
  - A link that expires after its 7 days is never replaced.
  - The only way forward is an approvals admin's "Approve as admin", which
    overrides the external approver rather than reaching them.
- **The approver decides blind.** The emailed page shows the request's type
  and the step's name, then Approve and Deny. No title, amount, vendor or
  requester. The email itself carries only the step name. This is
  deliberate, because the link is a bearer token, but it leaves the approver
  nothing to judge.
- **Decisions needed:**
  - whether staff may re-send a link, and whether the screen should say when
    one was not sent;
  - whether staff may ever see or copy a link, since it is a bearer token for
    someone else's approval;
  - which details the emailed page and the email may show. At least the title
    and amount are needed to make the decision; the requester's name and the
    description are more sensitive.

## Finance — Purchase Requests: Named Approvers, Notices and the Paid Amount (2026-10-14)

Found driving W63 (`docs/workflow-review/W63-purchase-request-approval.md`,
W63-5, W63-6 and W63-7).

- **A chain can name an approver who cannot approve.** Approve, deny and the
  Approvals queue require `finance.approve`. A chain step naming a position
  (the Chief, here) whose holders lack it leaves them a 403 on the queue and
  a 404 on the request. Only an approvals admin's override moves it on.
  - The chain screen now says so ("Nobody on this step has the finance
    approval permission", W63-2).
  - Decision: either naming a position or member in a chain lets them act on
    that step, or saving such a step is refused.
- **Nobody is told.** No email, bell entry or text goes to:
  - an approver whose step a request has reached;
  - the requester when it is approved or denied.

  The existing entries record this for dual approval's second approval and
  for amendments. It holds for every ordinary step and for the decision too.
  Decision: which events notify whom (email first, pitfall 18).

- **The paid amount is always the estimate.** "Mark Paid" sends no amount,
  though `POST /finance/purchase-requests/{id}/mark-paid` takes
  `actual_amount` and the service records it. An invoice that differs from
  the quote leaves the budget line's spent and committed figures wrong, with
  no way to correct them on screen. Decision: whether "Mark Paid" asks for
  the amount, and how a difference from the commitment is shown.

## Finance — Expense Reports: Routed by Purchase Chains, and Charged to No Budget (2026-10-14)

Found driving W64 (`docs/workflow-review/W64-expense-report.md`, W64-4 and
W64-5).

- **Purchase-request chains route everything.** `resolve_approval_chain`
  matches chains whose `applies_to` is the request's type **or
  `PURCHASE_REQUEST`**, and scores them without preferring the exact type.
  - Every chain marked "Purchase Requests" also routes expense reports and
    check requests.
  - A purchase chain with an amount range or category outranks a default
    expense or check chain.
  - In this review an expense reimbursement went to the board chair's emailed
    sign-off. `FINANCE_MODULE.md`'s own example ("Large Purchase" $5,000+
    beside "General Expense") would send a $6,000 reimbursement to the Board
    of Trustees.
  - It has worked this way since the module was added, so changing it
    re-routes live requests.
  - Decision: match only the request's own type (with an `UPGRADING.md` note
    and perhaps a migration copying purchase chains to the other types), add
    an explicit "All requests" option, or keep it and say so on the chain
    screen.
- **Expense lines carry no budget.** The form offers no budget line, so
  `budget_id` is null, and `mark_expense_paid` posts spending only to lines
  that have one. A paid reimbursement reaches no budget line, and nothing
  commits it on approval as a purchase request's amount is. Decision: who
  picks the line (the member, or the Treasurer on approval), and whether
  approval commits it.

## Finance — Dues: Overpayments, and Members Who Cannot See What They Owe (2026-10-14, overpayments resolved 2026-10-27)

Found driving W66 (`docs/workflow-review/W66-dues.md`, W66-3 and W66-4).

- **An overpayment is accepted silently — resolved 2026-10-27** (owner
  decision: warn and allow, and the excess is a donation). The Record payment
  dialog asks first; `record_dues_payment` refuses an overpayment unless the
  request carries `excessAsDonation`. With it, the dues are settled at the
  balance and the excess is a completed Fundraising donation under no campaign,
  from the member's donor record (created from their account if they have
  none). If the dues are already paid, the whole amount is the donation. A
  retried submission with the same reference records neither twice. Covered by
  `tests/test_dues_overpayment_donation.py` and `DuesPaymentDialog.test.tsx`.
- **A member cannot see their own dues.**
  - No screen shows a member what they owe; `/finance/dues` needs
    `finance.view`.
  - `GET /finance/dues` already confines a non-manager to their own records,
    but its `finance.view` gate refuses a plain member first.
  - Nothing tells a member their dues are due or overdue.
  - Decision: whether members get a "My dues" view (and on what gate), and
    which dues reminders go out (email first, pitfall 18).

## Department Store — The Cart Does Not Survive a Reload (2026-10-15, resolved 2026-10-27)

**Resolved (owner decision: keep it in this browser).** The cart is saved in
the browser's local storage, per member and per order window
(`modules/storefront/utils/savedCart.ts`), and restored when the store loads.
Only each line's product, variant, personalization and quantity are kept;
names and prices are rebuilt from the current catalog, and a line whose
product or variant is no longer offered is dropped. A saved cart is cleared
when its order is placed, when its window is no longer open, and at sign-out
(`purgeLocalMemberData`), since station computers are shared. Each window keeps
its own cart, so with several windows open a reload shows the store's default
window's cart until the member picks the other window again. It does not follow
the member to another device. History in
`docs/workflow-review/W67-department-store.md` (W67-6).

## Grants — Opportunities Could Not Be Edited (2026-10-15, edit and retire resolved 2026-10-25)

Found driving W68 (`docs/workflow-review/W68-grants.md`, W68-10).

- **Resolved:** each opportunity has Edit (`/grants/opportunities/:id/edit`) and
  Retire. Owner decision: retiring sets `is_active = false` and keeps the
  record, so applications started from it still name their program; **Show
  retired** lists retired ones and reinstates them. Retired opportunities offer
  no Start Application.
- **Still open:** the four Federal Programs cards are fixed text with no way to
  start an application from them. **Decision:** whether they become real,
  seeded opportunities.

## Medical Screening — A Screening With No Expiration Date Never Fell Due (2026-10-16, grading resolved 2026-10-25)

Found driving W71 (`docs/workflow-review/W71-medical-screening.md`, W71-1).

- **Resolved (owner decision):** a passed, completed or waived record with no
  `expiration_date` falls due `frequency_months` after its completed date —
  the frequency of the requirement it is linked to (even if that requirement
  is inactive), else of the requirement it is graded against. Its own
  expiration date still wins; with no frequency anywhere it stays compliant
  indefinitely. `_effective_expiration` in `medical_screening_service.py`
  holds the rule for both the compliance summary and the expiring list, and
  both screens mark such a date "by frequency". **Upgrade effect, accepted:**
  existing records saved without an expiration can change standing on the
  first read after upgrade.
- **Still open — records are matched to a requirement by screening _type_,
  not by `requirement_id`,** so two requirements of the same type are
  satisfied by one record. **Decision:** whether a record should satisfy only
  the requirement it is linked to.
- **Still open — the MCP `list_expiring_screenings` tool** pages in SQL on the
  stored `expiration_date`, so it does not list a record falling due by
  frequency that the dashboard lists. Bringing it in needs the derived date in
  SQL, or giving up SQL paging for that tool.
- **Resolved 2026-10-25 — superseded records on the expiring list.**
  `get_expiring_soon` now leaves out a record a newer one of the same type
  supersedes for the same member or prospect, using the same
  `superseded_record_clause` the MCP tool uses, so the list and the count
  agree.

## Integrations — Connecting iCalendar (ICS) Does Nothing (2026-10-17)

Found driving W73 (`docs/workflow-review/W73-integrations.md`, W73-5).

- **What happens:** the catalog offers "iCalendar (ICS) — Subscribe to
  department events via standard iCal feed URL … Filtered feeds". Connecting
  it shows Connected, but no feed URL appears anywhere, and nothing reads the
  integration's status or its config (`feed_token`, `included_event_types`,
  `include_shifts` in `ICalConfig`).
- **What does work:** each member's personal shift feed, from
  `GET /scheduling/calendar-feed` (`/api/public/v1/calendar/{token}.ics`),
  whether or not this integration is connected.
- **Decision:**
  - build the department events feed the card describes;
  - mark the entry unavailable; or
  - re-describe it as the members' personal shift feeds.

  The catalog row is seeded per organization, so the last two also need a
  data change for existing installations.

## Inventory — "Needs Attention" Means Two Things on One Dashboard (2026-10-23, resolved 2026-10-27)

**Resolved (owner decision: rename the queue).** The inventory dashboard's
work queue (pending returns, requests, write-offs, low stock, maintenance due,
overdue loans and deliveries, departure clearances) is now **Waiting for
action**. The headline tile keeps **Needs attention** and its count, which the
other administration hubs' frames share. The training guide follows; its two
screenshots of the queue (`05-97`, `05-132`) still show the old heading until
they are next captured. Covered by `InventoryAdminHub.test.tsx`. History in
`docs/workflow-review/W79-phone-pass.md` (W79-10).

## Public Portal — Three Statistics Fields Can Be Enabled but Always Publish Null (2026-10-21, resolved 2026-10-27)

**Resolved (owner decision: define each and wire it).**
`GET /api/public/v1/organization/stats` now computes all three, in
`app/services/public_stats_service.py`:

- **stations**: facilities of the "Fire Station" type, not archived. An
  EMS-only department, whose onboarding creates "EMS Station" facilities,
  reads 0 until its stations use that type.
- **total_calls_ytd**: calls in call tracking dated from 1 January to today in
  the department's timezone.
- **total_volunteer_hours**: whole hours over the same period, from approved
  admin hours, completed training, shift attendance and event attendance. An
  event check-in that also became an approved admin-hours entry or a training
  record is counted once.

Data Control's descriptions say the same. Covered by
`tests/test_public_portal_stats.py`. History in
`docs/workflow-review/W76-public-portal.md` (W76-6).

## RPT2-3 — The QR Check-In Analytics Dashboard Had A Reader And No Writer (2026-10-20, resolved 2026-10-25)

**Resolved (owner decision: record server-side).** The self-check-in page's
first load records one `qr_scan` per member per event (the data endpoint is
polled, and the officer's QR display page polls it too, so the page marks only
its first load and the server deduplicates). `POST /events/{id}/self-check-in`
records `check_in_success`, or `check_in_failure` with one of `not_open_yet`,
`closed`, `event_cancelled` or `attendance_locked`; a check-out, a repeat scan,
the phase-gate warning and a manual officer check-in are not counted. Rows
from before this change do not exist, so the dashboard starts from zero on
upgrade. `POST /analytics/track` and its unused client methods remain. Kept
only because code and tests cite it by name; history in
`docs/app-review/reports-analytics.md`.

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

> **✅ Resolved 2026-10-11 (FIN-4 owner decision: same-person guard on every
> disbursement, no new role).** `record_dues_payment` now calls
> `assert_different_person(recorded_by, dues.user_id, ...)` before touching the
> ledger, exactly as proposed below; an unattributed (`recorded_by=None`)
> reconciliation still passes. The operational cost described below is the
> accepted consequence: a treasurer's own dues are recorded by another
> `finance.manage` holder. Covered by
> `tests/test_dues_payment_guards.py::TestRecordingYourOwnDuesIsRefused`. The
> text below is the original finding, kept for the record.

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

## SF8-04-2 — A Storefront Order Status Update Could Settle A Payment From A Stale Read (2026-10-12, resolved 2026-10-25)

**Resolved (option 1, narrowed).** `update_order_status` reads the order with
`for_update=True` when, and only when, the target status is `PAID` — the one
transition that can write `amount_paid` — so routine status changes still do
not queue behind a row lock. Kept only because `storefront_service.py` and
`tests/test_storefront_payment_race.py` cite it by name; history in
`docs/security-review/SF-04-storefront-payments.md`.

## SF8-04-3 — Waiving A Storefront Order's Payment Did Not Check It Was Not Already Settled (2026-10-12, resolved 2026-10-25)

**Resolved (owner decision: refuse).** `waive_order_payment` locks the order and
answers 400 on an order already paid ("Refund it instead") or already waived. A
partly paid order can still be waived. Kept only because code and tests cite it
by name; history in `docs/security-review/SF-04-storefront-payments.md`.

## FIN8-05-1 — Deciding A Budget Request Had No Separation-Of-Duties Guard (2026-10-12, resolved 2026-10-26)

**Resolved (owner decision: refuse, no single-officer exception).**
`FinanceBudgetRequestService.decide_request` refuses a decider who submitted
the request or owns its line, with the same check `review_request` already
made; another `finance.manage` holder has to decide it. A department with one
finance officer grants the permission to a second member. Kept only because
code and tests cite it by name; history in
`docs/security-review/FIN-05-finance-approvals.md`.

## CI-1 — Backend Lint's Pinned `flake8`/`isort` Have Drifted From `requirements.txt` Again (2026-10-12) — ✅ FIXED (2026-10-25)

`.github/workflows/ci.yml`'s Backend Lint job installs
`flake8==7.3.0`/`isort==9.0.1` explicitly (its own comment at lines 110-121
explains why: an earlier drift let "CI was green against a toolchain no
developer actually ran"). `backend/requirements.txt` currently declares
`flake8==7.4.1`/`isort==9.0.2` — a developer running `pip install -r
requirements.txt` and then `flake8`/`isort` locally is not running what CI
runs, which is exactly the failure mode the workflow's own comment warns
against. `black==26.5.1` is in step with both.

Found incidentally during security review SF-04 pass 8 (2026-10-12) while
installing the completion gate's linters at CI's pinned versions — not a
storefront-specific finding, flagged for whichever pass next touched
`requirements.txt` or the workflow file to resolve.

**Fixed in security review CI9-33 (core infrastructure, pass 9,
2026-10-25):** by that point `backend/requirements.txt` had also moved
`black` to `26.10.1`, widening the drift to all three tools. Re-ran all three
linters against the full `app/ tests/ alembic/` tree at the newer
(`requirements.txt`) versions first — clean at `flake8==7.4.1`,
`black==26.10.1`, `isort==9.0.2` — then bumped `.github/workflows/ci.yml`'s
pin to match rather than reverting `requirements.txt` backward, so a
Dependabot-style forward bump doesn't have to fight this pin again. See
`docs/security-review/CI9-33-core-infra.md`.

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

## MS2-7 — A Lapsing Waiver Was Counted As Expiring Soon But Never Listed (2026-10-05, resolved 2026-10-25)

**Resolved (owner decision: list it).** `_grade` and `get_expiring_soon` read
one `_SATISFYING_STATUSES` (passed, completed, waived), so the count and the
list agree; the list now returns each row's `status`, and the Compliance tab
marks a waiver. Kept only because code and tests cite it by name; history in
`docs/app-review/medical-screening.md`.

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
seven of eight `widgetRegistry.ts` `aggregatePath` values that resolved to no
mounted route (now marked in the file, 2026-10-11). Server-supplied and registry-declared navigation targets have
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

## Training — `POST /training/enrollments` Duplicates, and Lags, the Fixed Enrollment Path (2026-10-06)

Found by security review TR-17 pass 7
(`docs/security-review/TR-17-training-core.md`, TR7-1). There are two HTTP
routes that create a `ProgramEnrollment`: `POST /api/v1/training/programs/
enrollments` (`training_programs.py` → `TrainingProgramService.enroll_
member`) and `POST /api/v1/training/enrollments` (`training.py`'s
`enroll_member_in_program`), both gated on `training.manage`. The frontend's
own `enrollMember()` call (`frontend/src/services/trainingServices.ts:894`)
uses only the first. The second is a hand-written duplicate of the first's
old logic and was never updated to match it.

- **The race this duplicate was supposed to have inherited a fix for, did
  not.** `TrainingProgramService.enroll_member`'s existing-ACTIVE-enrollment
  check was a plain SELECT then INSERT — two concurrent calls for the same
  member and program could both pass and both commit, leaving two ACTIVE
  rows. Fixed in that one method with `lock_organization_scope` +
  `.with_for_update()` (commit `012f3da49`). `training.py`'s copy of the
  same check (`training.py:2146-2153`) still has no lock and no backing
  unique constraint, so the identical race reproduces there, the same way
  `tests/test_program_enrollment_race.py` reproduces it for the fixed method
  — on two real connections.
- **It also never creates the enrollment's `RequirementProgress` rows**, nor
  determines a starting phase for a phase-structured program, nor schedules
  a recert deadline, nor sends the enrollment notification — all of which
  `TrainingProgramService.enroll_member` does. A single, non-concurrent call
  to this route produces an enrollment with no per-requirement tracking rows
  at all. This review did not trace every downstream reader of an enrollment
  in that state (whether `get_enrollment_progress` and phase-completion
  logic report it as stuck at zero, or read an empty requirement set as
  vacuously complete) — that is exactly the kind of question an owner should
  settle before this is "fixed" in place.

**Not fixed as part of the review pass.** Closing the race alone (adding the
same lock) would still leave the enrollment structurally incomplete, and the
fuller fix — delegating to `TrainingProgramService.enroll_member` (changes
the response shape and the audit event) or removing the apparently-unused
duplicate route outright — is a product decision, not a drive-by patch.
Exposure today is narrow: nothing in the frontend calls this route, so it
reaches only a direct API client holding `training.manage`.

**Was open as of security review TR-17 pass 8 (2026-10-16), and the gap
widened in the interim.** `training_program_service.py`'s `enroll_member` (the
fixed path) gained prerequisite-program enforcement on 2026-10-14
(`e3aee773`, "enforce prerequisites on single-member enrollment") — a member
missing a prerequisite now gets a clean 400 through that path. `training.py`'s
duplicate was not touched at that point, so `POST /training/enrollments` also
silently enrolled a member who had not met a program's prerequisites, in
addition to the race and the missing `RequirementProgress`/phase/recert/
notification behavior already recorded above.

**The prerequisite gap closed on 2026-10-23** (`94e3d2e0`, "Close the
remaining pipeline gaps: empty required sets, inactive due dates,
prerequisite checks on auto and legacy enrollment") — its own message: "The
legacy POST /training/enrollments now refuses a missing prerequisite with the
same message as the other manual paths." **Passes 9–11 of TR-17 did not
notice**: pass 11 reviewed `94e3d2e0` itself (grouped with a sibling commit
under "inactive-aware completion" in its write-up) but described only its
pipeline/phase-completion effects, then separately re-asserted "TR7-1 — still
OPEN/FLAGGED, unchanged" on the stated grounds that neither
`enroll_member_in_program` nor `enroll_member` appeared among that pass's
reviewed commits — which was incorrect; `94e3d2e0` touches
`enroll_member_in_program` directly. Caught and corrected by TR-17 pass 12
(2026-10-29), which re-read the current function end to end rather than
trusting the "unchanged" citation.

**Still open: the race and the structural incompleteness.** Confirmed by
TR-17 pass 12 against the current code — "Check for existing active
enrollment" is still a plain `SELECT` with no `.with_for_update()` and no
backing unique constraint on `(user_id, program_id, status)`, and the
function still never creates `RequirementProgress` rows, determines a
starting phase, schedules a recert deadline, or sends the enrollment
notification. Every one of these two remaining defects traces to the same
root cause — a second, hand-maintained copy of enrollment logic that nothing
keeps fully in sync with the one the rest of the codebase fixes. Confirmed
the frontend still calls only `/training/programs/enrollments`; no owner
decision on delegating, locking in place, or removing the route has been
recorded yet.

## Training — Online Knowledge Tests Have No Owning Feature In The Security Rotation (2026-10-06, resolved 2026-10-29)

Found by security review SKT-19 pass 7
(`docs/security-review/SKT-19-skills-testing.md`, pass 7 cross-feature scope
note), while reviewing Skills Testing. `feat(training): online knowledge
tests with a question bank and auto-grading` (`b310f532`) added a
substantial new surface — `app/api/v1/endpoints/knowledge_tests.py`
(1,147 L, mounted at `/training/knowledge-tests`), `app/models/knowledge_test.py`,
`app/schemas/knowledge_test.py`, and migration `7c2e9a41b6d3` (three new
tables: `knowledge_tests`, `knowledge_test_questions`,
`knowledge_test_attempts`). Members sit a test online and the server grades
it and credits a linked `knowledge_test` requirement through the same
`update_requirement_progress` path an officer's hand-entered score uses.

This file is not named in any feature's declared scope: not Feature 19
(Skills testing — `skills_testing.py` and its service/schema/model only),
not Feature 17 (Training core — `training.py`, `training_programs.py`,
`training_sessions.py`), and not Feature 18 (Training extended —
`training_submissions.py`, `training_enhancements.py`, `training_waivers.py`,
`external_training.py`, `course_cohorts.py`, `course_syllabus.py`). It
merged (2026-10-06 09:32 UTC) before Feature 18's pass 7 merged (16:09 UTC)
without being added to either Training feature's scope line, so neither
pass reviewed it, and the rotation's checklist (auth coverage, permission
fit, tenant isolation, injection, data exposure, abuse resistance, schema
integrity) has not yet been run against it. The commit message describes
org-scoped FK validation on the requirement link (XC-1) and a frozen-per-attempt
paper design, but a self-description in a commit message is exactly what
this rotation exists to verify independently rather than accept.

**Resolved (2026-10-29, security review TR-17 pass 12).** The three files
(plus `app/schemas/knowledge_test.py`) are now in Feature 17's declared
scope and received their first full pass against all seven checklist
dimensions — see `docs/security-review/TR-17-training-core.md`'s **Pass 12**
section. Clean: every one of the 13 routes carries an auth dependency and the
correct permission (`training.manage` for every bank write, self/officer
split for attempts), every query is org-scoped or XC-1-validated, answer
secrecy holds under direct trace (no path reaches `correct_option_ids` before
submission), the attempt cap and the start-attempt dedup both lock before
they read (Pitfall #27), and migration `7c2e9a41b6d3` is `create_all`-
tolerant with both `SET NULL` columns nullable. No fix was needed. One
process gap was found and corrected: this surface's own guard tests
(`tests/test_knowledge_tests.py`, `tests/test_training_knowledge_test_score.py`)
did not match training-core's scoped completion-gate filter
(`pytest tests/ -k "training or compliance"`), so they had never actually run
under that gate; the filter is now `"training or compliance or
knowledge_test"`.

## DOC-31 — A Document Delete's New Receipt-Reference Guard Reads Without Locking The Row It Checks (2026-10-23)

Found by security review DOC-10 pass 11
(`docs/security-review/DOC-10-documents-legal.md`, pass 11, DOC-31). An
owner-direct change landed between pass 10 and pass 11 that makes
`DocumentsService.delete_document`/`delete_folder` refuse to delete a
document that is the receipt on a purchase request or expense report once
that record has left `DRAFT` — closing a prior silent-data-loss gap where the
`SET NULL` foreign key let the receipt reference disappear with no trace.

The new check (`_release_document_references`) reads the referencing
`PurchaseRequest`/`ExpenseReport` rows with a plain `SELECT`, not
`.with_for_update()`. If another transaction submits that same request past
`DRAFT` between this read and the deleting transaction's commit, the delete
can still proceed and the request ends up referencing a document that no
longer exists — the original failure mode, reached through a race instead of
through the missing check. The window is one request's own transaction, and
the worst case is no worse than the pre-pass-11 behavior; this is an unclosed
gap in the new guard, not a regression.

**Not fixed.** Closing it means taking a locking read
(`.with_for_update()`) on the referencing `PurchaseRequest`/`ExpenseReport`
rows inside a document-delete transaction, which raises a lock-ordering
question against Finance's own locking conventions (Pitfall #27) that a
documents-feature review pass should not decide unilaterally — Finance and
Documents would need to agree on one order before this can lock safely
without risking a new cross-feature deadlock.

## EC-17 — A Shift Report Stays Editable By Its Filing Officer After Approval (2026-10-26, resolved 2026-10-27)

**Resolved (owner decision: an edit sends the report back to review).**
`ShiftCompletionService.update_report` now returns a submitted report to
`pending_review` when its filing officer changes any field. A flagged report
always goes back once revised. An approved one goes back where the department
requires review; where review is off it stays approved, as a newly submitted
report would. Returning a report clears its reviewer and review date, which
vouched for the earlier text, and keeps the reviewer's notes. Re-saving
unchanged values keeps the approval. Training credit is keyed on the report, so
approving it again does not credit the trainee twice. The app's own screens
edit only drafts; this governs `PUT /shift-reports/{id}`. Covered by
`tests/test_shift_completion.py::TestAnEditedReportGoesBackToReview`; history
in `docs/security-review/EC-14-equipment-check-shifts.md`.

The review loop (see [review-log.md](./review-log.md)) advances through one area
per tick and appends findings. New "needs owner decision" items should be
mirrored here so they're visible outside the log. The parallel module-by-module
security audit tracks its rotation and per-module findings under
[`docs/module-audit/`](./module-audit/PROGRESS.md); its open decisions are
mirrored in the Multi-Tenant Isolation section above.
