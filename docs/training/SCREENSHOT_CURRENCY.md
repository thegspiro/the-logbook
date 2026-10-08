# Screenshot currency

## Moved out of 00-getting-started.md by the plain-language rewrite, 2026-10-08

The guide no longer carries inline `[SCREENSHOT — REPLACE/CHECK …]` notes: a
member reading it was reading instructions meant for whoever captures the
images. The notes it carried are kept here, unchanged in substance. Its
`> **Screenshot needed:**` placeholders stay in the guide, because
`status_report.py` and `apply_placeholders.py` find them there. Image file
names and alt text are unchanged, so `manifest.mjs` entries still match.

| Image | Disposition | Why |
| ----- | ----------- | --- |
| `00-01-login-page.png` | **CHECK** | The page is unchanged; replace only if the frame shows a lockout or session-expired message, whose wording changed on 2026-09-29 |
| `00-19-change-password.png` | **REPLACE** | The requirements list is visible before typing and has seven rules: "At least 12 characters", the four character classes, "No runs like 123 or abc" and "No character three times in a row" |
| `00-04-dashboard-overview.png`, `00-07-dashboard-panels.png` | **REPLACE** | The Scheduling Operations tiles are new. Caption which permissions the capturing account held — what a reader sees depends on their own grants |
| `00-09-account-settings.png` | **REPLACE** | The page title reads **My Account** (was User Settings), and the Appearance tab's description reads "Theme and phone navigation bar" |
| `00-24-dashboard-my-department.png`, `00-25-dashboard-organization.png` | **REPLACE** | Both still show the pre-2026-08-24 tab strip (**My Department** / **Organization**); the tabs now read **Personal** / **My Department** |

## Queued by the October 7 – 8 documentation pass, 2026-10-08

Covers PRs #2981–#2996. Audit:
[CHANGE_AUDIT_2026-10-07_TO_10-08](../CHANGE_AUDIT_2026-10-07_TO_10-08.md). **Nothing
has been captured** (the capture stack does not run in this environment). Run
`status_report.py` after adding inline placeholders to refresh
[SCREENSHOT_STATUS.md](./SCREENSHOT_STATUS.md).

**What the seeded demo cannot produce yet:** a Target Solutions provider with an
uploaded report and unmapped courses, a voided record with its reason, and a
member who holds only `finance.request`. Use a throwaway demo provider; never
capture a real key, secret or Transcript ID.

### New screens (no image exists)

| Guide | Section | Capture brief |
| ----- | ------- | ------------- |
| 06-apparatus-facilities.md | A first-time fleet | `/apparatus` on an empty department: **No apparatus yet** with its explanation and **Add Apparatus** |
| 06-apparatus-facilities.md | A first-time fleet | Add Apparatus: "Only the fields marked * are needed to start", the NFPA checkbox with its help text, Fuel Type list showing **CNG** |
| 06-apparatus-facilities.md | Equipment Tracking | Equipment tab with the "separate checklist" note and **Build equipment checklists** link (as a holder of `inventory.check_manage`) |
| 06-apparatus-facilities.md | Logging Maintenance | Maintenance record form with the which-date sentence and the Next Due note |
| 02-training.md | Void a record | Member Training History: **Void** dialog with the required reason; a voided record with its reason; **Edit** dialog (training.manage) |
| 02-training.md | Void a record | My Training as the member: voided record marked **voided** with the reason under it |
| 02-training.md | Member Visibility Settings | The card layout in two columns with the pinned "N unsaved changes" bar and **Save** |
| 11-finance.md | Member requests | A member's **My Purchase Requests** list with **New**, the Finance navigation group, and the budget-line picker ("Training — $1,250.00 remaining") |
| 16-integrations.md | Upload Report | Target Solutions provider card with **Upload Report**, and the result summary |
| 16-integrations.md | Course mappings | Mappings › **Courses** tab: a course with a suggested library match and **Map**; a mapped course |
| 16-integrations.md | Policy acknowledgments | A staged Admin item shown as **Policy Acknowledgment** |
| 08-admin-reports.md or 17 (email) | Training record emails | _Training Record Voided_ and _Training Record Updated_ in Email Templates, plus the sent email at 390px |
| 08-admin-reports.md or 17 (email) | New Course Version to Map | The training-officer email |

### Existing images to replace or check

| Image | Disposition | Why |
| ----- | ----------- | --- |
| `06-*` apparatus list rows | **REPLACE** | Row **Archive** removed; the wrench opens Maintenance; badge text colour changed |
| `06-*` Add Apparatus and `06-03-apparatus-detail.png` | **REPLACE** | Intro line, NFPA help text, CNG label; status and type badges |
| `06-04-apparatus-maintenance-tab.png`, `06-06-apparatus-equipment-tab.png` | **REPLACE** | New guidance text above the lists and form |
| `02-*` Member Visibility Settings | **REPLACE** | Grouped cards, two columns, pinned Save bar |
| `02-*` Training Admin **More** menu and equipment-check builder menus in dark mode | **REPLACE** | Opaque surface |
| `02-*` requirement template picker (HIPAA, Bloodborne, Hazmat) and any requirement card for them | **CHECK** | Now Courses requirements; the old ones can show a warning |
| `02-*` / `16-*` Training History with Void | **REPLACE** | Reason, voided marker, Edit button |
| `16-*` provider cards, Imports and Mappings | **REPLACE** | Upload Report, Courses tab, auto-credited rows |
| `11-*` finance lists, forms and the navigation | **REPLACE** | "My …" titles for members, Finance nav group, options-based pickers |
| Any email-templates list shot | **CHECK** | Three new required or system templates (voided, updated, course match) |

## Queued by the October 6 – 7 documentation pass, 2026-10-07

Covers PR #2965 (owner-decision docket), #2967 (desktop density) and the review
records through #2980. Audit:
[CHANGE_AUDIT_2026-10-06_TO_10-07](../CHANGE_AUDIT_2026-10-06_TO_10-07.md). **Nothing
has been captured** (the capture stack does not run in this environment). Guides
for these features were written by the feature PRs; the rows below are the screens
that need a first capture or a replacement. Run `status_report.py` after adding
inline placeholders to refresh [SCREENSHOT_STATUS.md](./SCREENSHOT_STATUS.md).

**What the seeded demo cannot produce yet:** an alert in each state (open,
acknowledged, resolved), an integration with a failed sync, a Claude client and a
live connection (needs `MCP_OAUTH_ENABLED=true` and an https issuer), an offline
skills evaluation held in IndexedDB, a custom crew seat, a closed election with a
correction after close, and a proxy authorization. Never capture a real token or
client secret; use a throwaway demo client.

### New screens (no image exists)

| Guide | Section | Capture brief |
| ----- | ------- | ------------- |
| 02-training.md | Knowledge tests (member) | Knowledge Tests list; an attempt in progress with a multiple-answer question; the result screen after submitting |
| 02-training.md | Knowledge tests (officer) | Training Admin knowledge-test tab: question bank editor and the test settings (`max_attempts`) |
| 02-training.md | Skill Evaluations | Training Admin › Setup › Skill Evaluations: list, and the evaluator picker (default / positions / named members) |
| 02-training.md | Competency | Training Admin › Advanced › Competency › Department Readiness grid with station, rank and category filters |
| 02-training.md | Cohort rooms | Cohort wizard Schedule step room picker; Preview step with one class moved and the "Location already booked" warning |
| 01-membership.md | Qualifications | Member profile Qualifications card; Members admin › Import Qualifications dry-run result with a rejected row by line |
| 01-membership.md | Undo a drop | Profile of a dropped member showing the Undo drop control and its confirmation (do not confirm) |
| 01-membership.md | Add Member | Add Member with the **Status** field |
| 03-scheduling.md | Shared calls | Close-out wizard step 2 with "calls another unit already logged" ticked, showing unit labels |
| 03-scheduling.md | Open swaps | Requests tab listing an open swap with **Pick up**, and the refusal message for an unqualified member |
| 03-scheduling.md | Skills testing offline | Skills-test screen with the "saved on this device" state; Sign Out warning about unsent evaluations (do not confirm) |
| 08-admin-reports.md | Security Alerts | `/admin/security-alerts` with alerts in each state; the resolve dialog with a note; Download activity list |
| 08-admin-reports.md | Admin hours Review Rules | `/admin-hours/manage` › Review Rules tab with self-approval and the resync percentage |
| 08-admin-reports.md | Role Management | The confirmation before changing the baseline Member position's permissions (do not confirm) and the duplicate-name 409 message |
| 13-medical-screening.md | Add Record | Add Record with the Member/Prospect picker; a record row with the **Self-recorded** badge |
| 14-elections.md | One ballot | Cast Vote tab showing positions and ballot items together; proxy ballot banner naming the delegating member |
| 14-elections.md | Seats per race | Create/Edit election race with Seats; Results tab showing two winners |
| 14-elections.md | Results revised | Results tab with "Results revised <when> by <who>" and the revised line on the certified PDF |
| 16-integrations.md | Integration health | `/integrations/:integrationId` with sync history, a scrubbed error and **Retry sync**; list showing the health indicator |
| 16-integrations.md | Claude connections | Consent page `/claude/authorize`; `/claude/connections`; the admin client panel on Integrations (blur secrets) |
| 02-training.md | Review Submissions › Settings | Certificate Files card with the retention days field and the virus-scan notice (when `CLAMAV_ENABLED=true`) |

### Existing images to replace or check

| Image | Disposition | Why |
| ----- | ----------- | --- |
| Any image of a **toggle switch** or a hub/table **icon button** at desktop width | **REPLACE** at the next full sweep | With a mouse, `btn-icon` is 36px and `toggle-track` a 24px pill (was 44px); rows holding a switch are 20px shorter. Touch/phone shots are unchanged |
| `04-*` event cards and Create Event shots at 820–1280px | **CHECK** | Titles clamp at two lines (three from `md`); Start/End stack until `lg` |
| `18-*` store catalog shots | **REPLACE** | Price moved from beside the name to the end of the badge row |
| `02-*` cohort list and `03-*` shift-pattern list shots | **CHECK** | Status badge wraps below long names |
| `03-*` shift-template dialog | **REPLACE** | Starts and Ends are stacked at every width |
| `03-*` swap request dialog and Requests tab | **CHECK** | Open swaps are picked up, not officer-approved |
| `03-*` close-out wizard step 2 | **REPLACE** | Gained the shared-calls picker |
| `14-*` Results tab, Cast Vote tab and Send Ballot Emails shots | **REPLACE** | One ballot model; results released on close; revised mark |
| `01-*` Members page as a non-manager | **CHECK** | Directory hides archived members and opens on Active |
| `02-*` Compliance Matrix, Shift Compliance and program enrollment progress | **CHECK** | Shift counts and linked requirements now read shift attendance / live compliance |
| `13-*` Add Record dialog | **REPLACE** | Member/Prospect picker |

## Queued by the October 5 – 6 documentation pass, 2026-10-06

Covers PRs #2941–#2972. **Nothing has been captured.** The new placeholders are
inline `> **Screenshot needed:**` paragraphs in the guides, counted by
`status_report.py` (regenerated: [SCREENSHOT_STATUS.md](./SCREENSHOT_STATUS.md)).
Topic index: [21 — October 5–6, 2026 workflow updates](./21-october-2026-release-changes.md).

**What the seeded demo cannot produce yet:** a held offline item (seed untagged
entries straight into IndexedDB), an approval step assigned to someone other than
the capturing account, an approval step whose position nobody holds, an exchange
whose member lost a qualification after submission, and a member no requirement
grades. Never capture a real badge code; use a throwaway demo member.

### New placeholders

| Guide | Section | Capture brief |
| ----- | ------- | ------------- |
| 01-membership.md | Badge codes | Print ID Cards page (`/members/print-id-cards`): Orientation, Sides and Code options, Save as department layout, and the **Accept old badges** switch |
| 01-membership.md | Badge codes | Member ID card page: the badge with its QR code, **Reissue badge** and the "Reissue this badge?" confirmation (do not confirm) |
| 02-training.md | One definition of "compliant" everywhere | Compliance Matrix rail with the **Not applicable** group and a member's detail |
| 02-training.md | One definition of "compliant" everywhere | Training dashboard **Department Compliance** card beside the matrix it opens, same percentage |
| 02-training.md | Compliance Attestations | New Attestation with the **Quarter** picker and the "calculated when you submit" sentence; one history entry showing "as of <date>" |
| 02-training.md | Shift Credit | Requirement form for an Hours requirement: **Shift attendance satisfies this requirement**, unticked |
| 03-scheduling.md | Trades somebody can actually accept | Request swap dialog with **Exchange With a Member** chosen and the **Exchange With** list |
| 03-scheduling.md | Trades somebody can actually accept | Requests tab: **Approve without qualification?** with **Approve anyway** / **Keep it pending** (do not confirm) |
| 04-events-meetings.md | A finalized event can still be edited | Edit form on a finalized event: the "Attendance for this event is finalized" notice, locked controls, editable title |
| 05-inventory.md | What the alert emails say now | Supplies to Replace email at 390px: **Status** column with an expiring, a **Restock reported** and a **Short — 2 of 4 aboard** row |
| 10-mobile-pwa.md | Queued Work Is Sent Only by the Member Who Saved It | The "N offline items are on hold" notice with **Send as me** / **Discard**, and the "Send these as yours?" confirmation (do not confirm) |
| 11-finance.md | The Approvals screen | Approvals as an approvals admin: "Requests waiting on you.", admin line, **Waiting on** column, **Not assigned to you** badge, **Approve/Deny as approvals admin** |
| 11-finance.md | The Approvals screen | **Approve as approvals admin** dialog with the **Override reason** box |
| 11-finance.md | Steps nobody can act on | Approval Chains page banner and the amber "No active member can act on this step" chip with "N requests waiting" |
| 14-elections.md | Fixes From the On-Screen Re-Drive | In-app vote receipt under "Vote submitted for <position>" |
| 15-prospective-members.md | Moving Applicants Through Stages | Applicant drawer on a Checklist stage: "1 of 2 items done — tick every item to advance" |
| 15-prospective-members.md | Pipeline Settings | **Automatic Transfer to Membership** card and its tickbox |

### Existing images

| Image | Disposition | Why |
| ----- | ----------- | --- |
| `11-12-purchase-request-detail`, `11-14-expense-report-detail`, `11-16-check-request-detail` | **REPLACE** | Pending-approval panel now always says "Waiting on <who>" and shows the **Not assigned to you** / override buttons for an approvals admin |
| the Approvals screen placeholder in guide 11 | **REPLACE** when captured | Gains the **Waiting on** column and admin rows; heading reads "Requests waiting on you." |
| `11-06-approval-chains` | **CHECK** | Step help text changed to "Only the approver chosen here can approve or deny this step…"; chain cards gain coverage warnings when a step has no one who can act |
| `02-73-compliance-attestations` | **REPLACE** | Form lost the Compliance % box and gained the Quarter picker; entries show "as of" |
| `02-66-compliance-matrix`, `02-65-print-compliance`, `02-17-officer-dashboard` | **CHECK** | A Not applicable group and graded-member percentages can change the rail and the Department Compliance card |
| `02-16-requirements` | **REPLACE** | Requirement form gains the Shift Credit box (Hours and Shifts types) |
| `03-14-scheduling-reports` | **REPLACE** | Shift Compliance cards are **Requirement Checks**, **Checks Met**, **Checks Not Met** (were Total Members, Compliant, Non-Compliant) |
| `03-67-swap-request-dialog`, `03-11-swap-requests-tab` | **REPLACE** | Exchange With a Member picker; exchange cards name the other member |
| `03-60-dashboard-my-shifts`, `00-04-dashboard-overview` | **CHECK** | Open slots the member cannot take read "Not eligible" instead of Sign Up |
| `01-23-print-member-badges`, `19-37-member-id-cards` | **CHECK** | Badge now encodes the server badge code; Print Badges needs `members.manage` or `members.manage_id_cards` |
| `15-10-pipeline-settings`, `15-14-applicant-drawer-overview` | **CHECK** | Automatic Transfer card; checklist items as tickboxes in the drawer |
| `08-11-error-monitor` | **CHECK** | Rows from scheduled tasks carry the source **Scheduled task** |
| `05-01-inventory-items`, `05-25-admin-hub`, `05-60-admin-hub-groups` | **REPLACE at phone width** | Below 640px the nine Items filters sit behind a **Filters** toggle; eight admin pages lost their doubled side padding; hub metric labels wrap to two lines |
| `09-12-summary-pending-validation` | **CHECK** | **Needs Validation** is shown to officers always (zero included) beside **Pass Rate** |
| `14-17-election-results`, election list frames | **CHECK** | Closed card shows the real close time |

### Manifest steps flagged

`scripts/screenshots/manifest.mjs`: only the comment on `09-12-summary-pending-validation`
was updated (the selector still matches the **Needs Validation** label). Not
changed, because a capture-step edit needs the new UI to be run: `03-62`
(dashboard sign-up positions) selects a seeded open shift by its Sign Up button
and now needs a shift the member **is** eligible for, since an ineligible one
reads Not eligible; `03-14-scheduling-reports` (check its wait text against the new
**Requirement Checks** card labels); and the My Training frames may want a pending record seeded.
The anchor on `09-12` ("The Summary dashboard viewed by a training officer") no
longer appears verbatim in guide 09.

## Queued by the second September 23 – 30 reading, ported 2026-10-05

A second reading of PRs #2651–#2846 checked each guide's screens against the code, not against fresh captures. It ran in parallel with the September 24 – October 4 pass and was ported onto it afterwards. Where that pass had already queued an image, the row says so rather than queueing it twice.

**97 new placeholders** are in the guides (`> **Screenshot needed:**`, counted in [SCREENSHOT_STATUS.md](./SCREENSHOT_STATUS.md)). **134 existing images should be replaced** (69 of them also queued by the earlier pass) and **143 should be checked** (25 also queued). Nothing was re-captured.

**What the seeded demo cannot produce yet**, so these shots need seed work or a manual capture:

- **NFC screens** (tag a tag, put away by tap, shelf audit, the kiosk): Web NFC exists only in Chrome on Android over HTTPS. Use route mocks or a manual Android capture.
- **The kiosk** also needs NFC switched on, the NFC ID Cards integration connected and `inventory.kiosk` granted to a position. No seeded position holds it.
- **Target Solutions** cannot be connected in a demo department.
- **Seed gaps:** no archived, dropped or rejoined member; no Multi-Signer Approval stage; no outside departments or outside shifts; no returned training submission or pending session approval.
- **Never capture** recovery codes, two-factor secrets, API keys, real suggestion follow-up keys, real tag serials or real hostnames.

**Screenshot manifest.** Ten capture steps that click or wait for UI text renamed in this window were updated in `scripts/screenshots/manifest.mjs`. Without that change they would time out at the next capture. The steps are `15-09`, `03-59`, `02-100`, `02-34`, `03-63`, `05-13`, `05-58`, `05-46`, `05-57` and `00-22`.

### New placeholders

| Guide | Section | Capture brief |
| ----- | ------- | ------------- |
| 00-getting-started.md | Changing Your Password | _[Throwaway demo member (never a real member) at /login, immediately after changing the password on My Account → Password: the sign-in page showing the green notice "Your password was changed, and you have been signed out everywhere. Sign in with your new password." Leave the username and password fields empty.]_ |
| 00-getting-started.md | Understanding the Interface | _[Administrator (all modules on) at /dashboard, 1280×900 viewport, with Navigation Layout set to Top bar: the More dropdown open at the right-hand end of the top bar, showing at least one overflowed group under its own label with separators between groups. The page must not scroll sideways.]_ |
| 00-getting-started.md | Your Dashboard | _[Fire Chief (or another officer holding a role named on a Multi-Signer Approval stage, with an applicant waiting at that stage) at /dashboard: clip to the Needs you panel showing "<Name> is waiting on your sign-off" with the stage name beneath and the Review button. Use a demo applicant, not a real person.]_ |
| 00-getting-started.md | Notification Cards (2026-03-26) | _[Admin at /notifications?tab=inbox, with everything unpinned first: at least two unread notifications of one category (for example two attendance-validation prompts from ended events) collapsed into a stack showing "N attendance validations", "Latest: …", the "N unread" badge and Mark all read, beside ordinary single cards. Then a second capture of the same stack expanded to its individual cards. Do not press Mark all read.]_ |
| 00-getting-started.md | Account Settings | _[A throwaway demo member created for the capture (never a real member) at /account?tab=security, right after Verify & enable: the "Save your recovery codes" panel with the code grid, Copy codes and Done. The codes are secrets: use a disposable account and regenerate or blur them afterwards; do not capture the QR code or the manual key.]_ |
| 01-membership.md | Member Directory | _[As an administrator (members.manage) at /members on a desktop width: the Members table with the status filter set to Archived, showing at least one archived member's row with the green Reactivate icon beside Edit and Delete in Actions. Needs an archived member in the demo seed. Do not open the Reactivate dialog.]_ |
| 01-membership.md | The Membership Number on Add Member _(2026-09-29)_ | _[As an administrator (users.create + members.manage) on an install with email not configured, at /members/admin?tab=add: the Account Password block with Set initial password ticked and disabled and the "Required: email isn't set up for this department…" hint visible. Leave the password fields empty; do not capture any typed password.]_ |
| 01-membership.md | Member Management row actions _(2026-09-28)_ | _[As an administrator (members.manage) at /members/admin, Member Management tab: a demo member's Reset Password dialog with a weak password typed (for example Abcdefgh1234!) so the Password rules list shows "No runs like 123 or abc" unmet. Never submit, and never capture a real password.]_ |
| 01-membership.md | Anonymizing a Former Member _(2026-09-25)_ | _[As an administrator (members.manage) at /members/:userId for a Dropped or Archived demo member: the Anonymize Member dialog showing the warning sentence, the red Removed panel, the Kept panel with the "Former Member" note, the empty "Type <name> to confirm" field and the disabled Anonymize button. Clip to the dialog. Never type the name or confirm — the action is irreversible and would remove the demo member. Needs a dropped or archived member in the seed.]_ |
| 01-membership.md | Enable Status Page Stages _(2026-09-25)_ | _[As a Membership Coordinator (prospective_members.manage) at /prospective-members/settings: a pipeline selected and Add Stage open with the Enable Status Page tile chosen, showing the "Enables the public status page" panel with its override sentence, "Enable public status page at this stage" ticked, and "Message in the link email (optional)" filled with a sample welcome line.]_ |
| 01-membership.md | Changing a Member's Status | _[As an administrator (members.manage) at /members/:userId for a Dropped (Voluntary) demo member: the Change Member Status dialog with Active selected, showing the Earlier service radios (department default marked), Return date and Last day of previous service. Never press Update Status. Needs a dropped member in the seed.]_ |
| 01-membership.md | Former Members Who Rejoin _(2026-09-24)_ | _[As an administrator (members.manage) at /members/:userId for a demo member who rejoined under Restart at zero: the Service History card in its read view, showing the Credited service and Prior service (not counted) tiles and two stints — an earlier one tagged "Dropped (voluntary)" and "Not counted", and a current one ending "present". Needs a seeded rejoin with stints. Clip to the card.]_ |
| 02-training.md | Submitting Training Records | _[Member (the submitter) at /notifications?tab=inbox: a "Training submission approved with changes — <course>" notice expanded, showing a "• Hours: 3 → 2" line, the officer's notes and the View My Submissions button. Demo data only.]_ |
| 02-training.md | Submitting Training Records | _[Member at /training/submit with one of their submissions in revision_requested state and a reviewer note: the returned-submission notice at the top of Submit Training showing the officer's note, "Returned <date> · Your hours are not counted yet", and the Fix and Resubmit and Withdraw buttons. Demo data only.]_ |
| 02-training.md | Viewing Your Own Progress (Members) | _[Member enrolled in one program with at least two requirements, at /training/my-training: crop to the Pipeline Progress card — the program name as the card heading, the status chip and overall percentage, each requirement row as "<name> · N%" with its status, and the View full progress link. Demo data only.]_ |
| 02-training.md | Fixing a Mistaken Approval or Record | _[Member holding the Training Officer position at /notifications?tab=inbox: a "Training submission awaiting approval — <demo member>" card expanded to its body with the Review Submission button, or collapsed into an "N training submissions awaiting approval" stack. Seed the submissions after the upgrade so the prompts exist.]_ |
| 02-training.md | Finalizing a Training Session | _[Training Officer (training.manage) at /training/approve/:token for a pending approval: the header (event title, Course, Event date, Approve by), the roster with Credited minutes and Approved minutes (one row edited to 0), and the Approval notes field. Never press Approve and record. Capture the page only — no browser address bar, so the token is not visible.]_ |
| 02-training.md | Draft Reports and Review Workflow _(2026-03-28)_ | _[Member without training.manage, no shift reports yet, at /scheduling?tab=shift-reports: the "Shift reports about you" heading, the "No shift reports yet" explanation and the three tiles (the shift itself / your officer's feedback / a place to acknowledge it). No view toggle should be visible.]_ |
| 03-scheduling.md | For scheduling officers: the list and the review | _[Member at /scheduling?tab=my-shifts&view=hours, with at least one outside department and unit seeded. The 'Log a shift with another department' dialog opened from 'Log outside shift' and filled in: a Start, an End set with '+12 hours', the 'Counts as 12 hours' line, a Department and Apparatus chosen, and Position 'Driver'. Use placeholder department names, never a real neighbouring department.]_ |
| 03-scheduling.md | For scheduling officers: the list and the review | _[Member at /scheduling?tab=my-shifts&view=hours. The 'Shifts with other departments' section under the Hours table, with two counted entries showing date, time range, hours and apparatus, and one 'Not counted' entry with its Reason line; a card above should read '+N hrs with other departments'.]_ |
| 03-scheduling.md | Patterns | _[Scheduling administrator at /scheduling/admin/planning/patterns. A pattern's Generate panel after generating a date range that is already fully on the schedule, with the 'No new shifts. Dates already on the schedule are skipped…' toast visible. Generate the same range once first so the second run creates nothing.]_ |
| 03-scheduling.md | Member Hours: worked vs. scheduled _(2026-08-01)_ | _[Scheduling administrator (scheduling.manage) at /scheduling/admin/reports, Member Hours generated for a range containing outside shifts. Show the Outside Hours column, the 'Outside apparatus staffed' table with its Total row, and the 'Shifts with other departments' list with a Reject button and one 'Not counted' row. Use placeholder department names such as 'Township Fire Company', never a real neighbouring department.]_ |
| 03-scheduling.md | August 19–23, 2026 update — request review and pagination | _[Member at /scheduling?tab=requests on the default Pending filter, after their only swap request was approved. It shows 'No swap requests', 'Your swap requests will appear here…' and the line 'Showing pending requests only. Choose All Statuses to see the rest.']_ |
| 04-events-meetings.md | For Members (Checking In) | _[Member at /events/:id/check-in on a Training-type demo event inside its check-in window, after tapping Check In to This Event: the "You're Checked In" heading, the event name, and the green Training Record panel reading "Your attendance will be added to your training record when the event's attendance is finalized." Creates a check-in (mutates seed data). Do not capture the member's email or the URL bar.]_ |
| 04-events-meetings.md | Post-Event Notifications | _[Event organizer (events.manage) at /events/:eventId on an ended Training event with attendance still open: the "Finalize attendance?" confirmation, listing how each member's time is decided, that members with no credited time get no record, and that earlier admin-hours entries are removed, with Finalize and close / Keep it open. Press Keep it open; never confirm.]_ |
| 04-events-meetings.md | Training Credit from Events _(2026-09-29)_ | _[Admin with events.manage and training.manage at /events/admin?tab=create: Create Event with Event Type set to Training, scrolled to the "Training details (optional)" group, a course picked (so Training Type and Category fill), and the Create Training Session link line visible. Do not submit.]_ |
| 04-events-meetings.md | Managing Recurring Event Series | _[Event organizer (events.manage) at /events/:id/edit on an occurrence of a weekly recurring demo event: the indigo "This event is part of a recurring series." panel above the form with "This and all future events" selected. Do not save.]_ |
| 05-inventory.md | First-Run Setup | _[Quartermaster (inventory.manage) on a department with no inventory items, at /inventory/admin/items: the empty state "Your department has no inventory items yet" with the Open the Setup Guide and Add Item buttons. Capture outside the seeded demo department, the way 05-72 is captured by scripts/screenshots/inventory-setup.mjs.]_ |
| 05-inventory.md | Step 2 — Storage areas | _[Quartermaster at /inventory/storage-areas: the "Delete <area>?" dialog for an area that holds items and has a shelf nested inside it, showing both red reasons and the disabled Delete button. Do not delete.]_ |
| 05-inventory.md | Pool Items | _[Quartermaster at /inventory/admin/pool: one pool card with Issuances expanded, showing two or three holders by name, each reading "<member> N · issued <date>" with its Return button. Use demo members only.]_ |
| 05-inventory.md | What the member is told | _[Member at /inventory/my-equipment: My Requests with seeded requests in Awaiting review, Issued and Declined, the declined one carrying "Quartermaster: <note>" beneath it.]_ |
| 05-inventory.md | Reorder Request Workflow | _[Quartermaster at /inventory/admin/reorder: an Ordered request created on this page, with Receive stock open showing the red notice "This request isn't linked to an inventory item, so its stock can't be received here…" and the disabled Receive stock button. Do not submit.]_ |
| 05-inventory.md | Returning Items | _[Quartermaster at /inventory/admin/returns: the Receive Item dialog for a multi-unit pool return, with a condition chosen, the quantity box empty, the hint "Count what came back. It must match the 2 the member reported." visible, and Receive disabled. Do not submit.]_ |
| 05-inventory.md | Turning NFC tags on | _[Administrator at /inventory/admin/nfc: the NFC Tags page with "Use NFC tags for inventory items" ticked and the "What works on which phone" card below it. The harness line "This device cannot read or write NFC tags itself…" is accurate and can stay.]_ |
| 05-inventory.md | Linking a tag to an item | _[Quartermaster at /inventory/items/:id with NFC switched on and two seeded tags: one labelled "Inside left cuff", linked by serial, and one marked Lost. Crop to the NFC Tags card. Headless capture shows only the typed serial box and Link serial, so the caption must say the Write and Read buttons appear only in Chrome on Android. Only the …last-4 preview may be visible, never a full serial.]_ |
| 05-inventory.md | Tapping items in the scanner | _[Manual capture on a real Android phone over HTTPS, quartermaster at /inventory/admin/members → Assign for a demo member, NFC on: the scanner with Tap NFC armed (reading "Stop NFC") and one tapped item in the list. Web NFC does not exist in the capture harness, so this cannot be a manifest entry.]_ |
| 05-inventory.md | Putting items away by tap | _[Quartermaster at /inventory/put-away with NFC on: choose a shelf from "Or pick a shelf" so the card reads "Items tapped now go on <shelf>", then enter two seeded item serials in the "Tag serial (or USB reader)" box, so "Put away this session" lists one "→ <shelf> (was <old shelf>)" and one "already on <shelf>". The unavailable-NFC line in place of Start tapping tags is acceptable in the harness.]_ |
| 05-inventory.md | Last Seen | _[Quartermaster at /inventory/items/:id with NFC on: crop to the Last Seen (NFC) card showing a "Moved from … to …" row and a "Found on … during a shelf audit" row, each with a time and the quartermaster's name. Seed it by driving put-away and one audit with typed serials.]_ |
| 05-inventory.md | Auditing a shelf | _[Quartermaster at /inventory/shelf-audit with NFC on: pick a seeded shelf, enter the serial of one item recorded there and of one recorded elsewhere, then press Finish audit. Capture the result card "1 of 2 expected found · 1 missing · 1 unexpected", Missing with its "Nothing has been marked lost" note, and the unexpected line ticked with "Move 1 selected onto <shelf>" enabled. Do not press Move. Recent audits should show below.]_ |
| 05-inventory.md | Scheduling shelf audits | _[Admin (inventory.manage) at /inventory/shelf-audit with NFC on: the "Audit schedule (N due)" card with at least one never-audited area reading "never audited · due now" with its Audit now button, and one current area reading "next due <date>". The tap button's unavailable line is expected in the harness.]_ |
| 05-inventory.md | Tagging many items at once | _[Quartermaster at /inventory/admin/nfc/enroll with NFC on, after one typed serial has been linked: "1 tagged this session · N of M left", the current item's name and details, Read serials selected (Write links greyed out in the harness), the typed serial box and Skip this item. No full tag serial visible.]_ |
| 05-inventory.md | Identifying a member by their ID card | _[Manual capture on a real Android phone over HTTPS, quartermaster at /inventory/admin/members → Scan Member ID, with inventory NFC and NFC ID Cards both on: the Scan Member ID window with "Or tap their ID card" below the camera controls. No card serial or member number may be visible. Not a manifest entry, because Web NFC is absent in the harness.]_ |
| 05-inventory.md | Self-service kiosk | _[Admin (inventory.manage) at /inventory/admin/categories: edit a loaner category (e.g. "Loaner Radios") with "Allow self-checkout at the kiosk" switched on and "Kiosk loan period (days)" set to 14, so its help text is visible. Close without saving.]_ |
| 05-inventory.md | Tapping without signal | _[Admin (inventory.manage) at /inventory/put-away with NFC on, then the browser set offline: the amber "No signal: keep tapping" banner with "Taps are saved on this phone and applied when signal returns." No taps needed; the tap button's unavailable line is expected on desktop.]_ |
| 05-inventory.md | Apparatus compartment tags | _[Admin (inventory.check_manage) at /inventory/admin/checklists/templates/:templateId with inventory NFC on: the "NFC tags: <compartment>" dialog opened from a saved compartment's ⋯ menu, showing the serial box, Link serial and the compartment hint line. No write button is expected on desktop. Do not link or show a real tag serial; close without linking.]_ |
| 05-inventory.md | Items not seen | _[Quartermaster at /inventory/admin/not-seen: default 180 days, All categories, with at least one "Never" row and one dated row showing its source (e.g. "Returned · 212 days ago"), and Download CSV enabled. NFC may be off, which shows the report needs no tags.]_ |
| 05-inventory.md | Generating Labels | _[Quartermaster (inventory.manage) at /inventory right after saving Add Item for one new item: the green line "1 item added. Label it now?" with Print label and Dismiss. Creates an item, so use a disposable demo item and delete it afterwards, or mark the shot as mutating seed data.]_ |
| 05-inventory.md | Putting items away by scanning | _[Quartermaster at /inventory/storage-areas: press Put away, type a seeded shelf's SA- code (e.g. SA-000003) and press Add, then two available item barcodes, so the panel reads "Filing onto <path> (SA-000003)", lists the two items and shows "File 2 items on <shelf>". Do not press File; no camera.]_ |
| 05-inventory.md | Checking a bag, box or bin | _[Quartermaster at /inventory/storage-areas: press Check contents, type a seeded bin's SA- code (e.g. the Uniform Bins area), then one item filed in it and one filed elsewhere, so the panel shows "1 of N found", "Not scanned yet (N)" and "Doesn’t belong here (1)" with its recorded location and File it here. Do not press File it here.]_ |
| 05-inventory.md | Shelf, rack and bin labels | _[Quartermaster at /inventory/storage-areas/print-labels?ids=<3–4 storage area ids>: the Print Storage Area Labels page with Settings closed, previews showing each area's name, its location/parent trail and its SA- barcode. Seeded areas only; if a printer is registered, show only an RFC 5737 documentation address.]_ |
| 05-inventory.md | Knowing which items still need a label _(2026-09-23)_ | _[Quartermaster (inventory.manage) at /inventory with no filter applied: crop to the line "N items need a label." with Show them, Print their labels and Not now above the table. The line hides under the Needs a Label filter, so leave filters clear.]_ |
| 05-inventory.md | Creating a Maintenance Record | _[Quartermaster at /inventory/admin/maintenance (or an item's Inspections tab → + Add Record): the "Log Maintenance — <item>" dialog with Record inspection selected and Pass chosen, the completion date showing today, and the note "This records the inspection without changing the item's status." Do not save.]_ |
| 05-inventory.md | Departure Clearance | _[Quartermaster at /inventory/admin: crop to the Needs attention card showing an "Unresolved departure clearance · <demo member> · 1 outstanding · Due <date> · Review" row. Requires a demo member dropped while holding an item.]_ |
| 05-inventory.md | Submitting a Request | _[Member at /inventory/my-equipment: Request Equipment → pick a garment → select the member's size on file that the department does not stock, so the chip reads "not stocked" and the "(from your profile)" line and the blue notice "The department doesn't stock this item in <size>." are visible. Do not submit.]_ |
| 05-inventory.md | Reviewing Requests (Admin) | _[Quartermaster at /inventory/admin/requests: Review on an Awaiting review request whose size the department does not stock — the dialog with Member asked for, the "not a size the department stocks" line, Tracking in words, Availability "n on hand", the note placeholder, and Decline / Approve for later fulfillment / Approve & fulfill now. Never click a decision.]_ |
| 05-inventory.md | Managing Kits | _[Quartermaster at /inventory/admin/kits: the "Issue <kit>?" confirmation after picking a demo member, reading 'Issue N items from "<kit>" to <member>.' with Don't issue and Issue to <member>. Do not confirm.]_ |
| 05-inventory.md | The Inventory Administration Page Has a New Top _(2026-08-23)_ | _[Quartermaster (inventory.manage) at /inventory/admin: the Needs attention queue with at least one "Pending return" row (member · item, Review action) and the Return Requests card carrying its count badge, with no "Some inventory services did not respond" banner. Needs a seeded return request in status "requested".]_ |
| 05-inventory.md | What the page now tells a member _(2026-09-28 – 2026-09-30)_ | _[Member with no gear, loans or requests at /inventory/my-equipment: the header with its subtitle, the three tiles at 0 (Issued to me, Temporary loans, Pending requests), the empty Issued to Me text with the Learning Center link, and the Active Temporary Loans explanation.]_ |
| 06-apparatus-facilities.md | Dashboard | _[Plain member (no locations.\* or settings permissions), /locations, department with at least one station holding a room. Stations and rooms listed, with no QR toggle, kiosk URL, Add Station, Add Room, edit, delete, Change or Run Setup Wizard control. Do not capture a kiosk URL or display code.]_ |
| 07-documents-forms.md | Form Templates | _[Forms manager (`forms.manage`) at `/forms`, **Starter Templates** tab: the template grid showing the **Public** badge and the orange "Sends responses to Membership" / "Sends responses to Events" hints on the two public templates. Do not press **Use Template**, which creates a form.]_ |
| 07-documents-forms.md | Creating a Rule | _[Administrator with `notifications.manage` at `/notifications?tab=rules`: press **Add Rule**, name it "Gear request notices" and choose the trigger **Equipment Request Update**, so its note is visible at the bottom of the dialog. Do not press **Create Rule**.]_ |
| 07-documents-forms.md | Which emails are required — Member Emails & Texts | _[Administrator with `settings.manage` at `/communications/member-emails`: the full page with **Always sent**, **Members can turn off** and **Text messages** all visible. Before capturing, switch on **Require for every member** for one optional email (e.g. **Quartermaster duties**) so its card shows **Required by your department** beside cards reading **On unless turned off**; switch it back off afterwards.]_ |
| 07-documents-forms.md | Setting up a box | _[Holder of `suggestions.manage` (e.g. the demo chief) at `/communications/suggestion-boxes` after a fresh demo seed: the **Suggestion boxes** list showing the default **Compliance** box (submitter chooses, follow-up allowed, its submission count, "Reviewers: Compliance Officer"), **Training ideas** with its reviewers and any "Also notified:" line, and the **Edit** and **Delete** buttons on each row. Nothing saved or deleted.]_ |
| 07-documents-forms.md | Edge cases | _[Ordinary member at `/suggestions`, **Submit** tab, with the **Compliance** box chosen: its description ("Report a compliance concern … Reviewed by the Compliance Officer."), the anonymity hint and the follow-up hint visible. Nothing typed or submitted.]_ |
| 08-admin-reports.md | The setup steps | _[System Owner during setup at `/onboarding/it-team`: step 7 IT & Backup Contacts with its "Optional. Choose Skip for now if your department has no IT contact." line, one demo IT contact filled in, the Recovery contacts note, and both Continue to Email and Skip for now in frame. Demo names and example.org addresses only; no real phone numbers.]_ |
| 08-admin-reports.md | The setup steps | _[Anonymous on a fresh install, then the new System Owner (scripts/screenshots/wizard-walk.mjs), at `/onboarding/apparatus`: Engine 1 carrying Officer, Driver, Firefighter, Firefighter and EMT chips — two Firefighter seats visible — and the + EMT add chip. Crop to the unit card; the administrator password from the previous step must not be in frame.]_ |
| 08-admin-reports.md | Membership ID Settings | _[Admin holding settings.edit at `/members/admin/settings/ids`: the Membership IDs section with numbering and auto-generation on, pattern `{YYYY}-{SEQ}`, Minimum digits 3, Restart the count each year on, The year follows set to Our fiscal year starting July — so the fiscal-year naming select and the "The next member will be numbered …" line are both visible.]_ |
| 08-admin-reports.md | The rest of Members Administration → Settings _(2026-09-11)_ | _[Admin at `/members/admin/settings/ranks`: the Delete rank confirmation over the Operational Ranks ladder for a rank nobody holds, showing its message and the Keep it / Delete buttons. Press Keep it afterwards; never confirm.]_ |
| 08-admin-reports.md | Configuration Options | _[Administrator (settings.manage) at `/admin/public-portal`, API Keys tab → Create API Key: the dialog with "Department website" typed into Key Name and the other fields blank. Never submit it, and never capture the API Key Created dialog — it shows a live, full key.]_ |
| 08-admin-reports.md | Configuration Options | _[Administrator at `/admin/public-portal`, Statistics tab: the full tab. An unseeded demo showing zeros, with Error Rate reading — / No requests in 24h, is acceptable. If access-log rows can be seeded, include a few 4xx and one 429 so Rate Limits Hit is non-zero; do not trigger the Attention Required banner with made-up data unless the caption says so.]_ |
| 08-admin-reports.md | Configuration Options | _[Administrator at `/admin/public-portal`, Data Control tab on the demo department: the Events, Organization and Stats sections with every toggle off, the yellow PII badges on phone, email, mailing_address and physical_address, and the Sensitive (PII) card reading 0. Do not flip any toggle — a toggle saves immediately and publishes the field.]_ |
| 08-admin-reports.md | Dashboard Notification Management | _[Admin at `/dashboard`: the My Updates card (section[aria-labelledby='my-updates-heading']) with one stacked row such as "3 attendance validations" and "Latest: …" among ordinary notification and message rows.]_ |
| 08-admin-reports.md | The email link address _(2026-09-25)_ | _[IT Manager (the demo's System Owner) at `/settings?tab=email`, clipped to section[aria-labelledby="email-link-domain-heading"], with GET /api/v1/organization/settings/email/link-domain route-mocked to a public https address (e.g. https://logbook.oakvillefd.example.org; source frontend_url, is_https true, is_loopback false, is_private_network false, allowed_hosts [that host]): the address with its copy button, "Set by the FRONTEND_URL setting.", the Change address field with Save, and the allowed-host hint. Captured from http://localhost:3000 the "You are viewing this site at…" warning and Use the address I'm on now also appear — keep them and say so in the caption, or capture from a matching origin. Never press Save; do not expose a real department hostname.]_ |
| 08-admin-reports.md | The email link address _(2026-09-25)_ | _[IT Manager at `/settings?tab=email` with the same mock: a second allowed address typed into Change address and Save pressed, showing the "Change the email link address?" dialog with its consequence text ("Every email sent from now on — including password resets and ballots — will link to …") and the Change address / Keep current address buttons. Press Keep current address afterwards; nothing is saved.]_ |
| 08-admin-reports.md | Send Test Email | _[Administrator with settings.manage at `/communications/email-templates`, with the backend's FRONTEND_URL set to a LAN address (e.g. http://192.168.1.50:7880) and EMAIL_ENABLED=true, then restarted: the yellow notice "Emails link to http://192.168.1.50:7880, which only works on your station's network…" with its Change the email link address link, and the Save bar beneath. Crop to the notice and the bar; no credentials in frame.]_ |
| 08-admin-reports.md | The Admin Hours summary | _[Admin holding admin_hours.manage at `/admin-hours/manage`, Categories tab: two categories, one with Require approval on and a 4h threshold, one with it off — one row showing "Approval: Required", "Auto-approved under 4h" and "Manual entries: always reviewed" side by side, and one showing "Approval: Not required" and "Manual entries: always reviewed" side by side.]_ |
| 08-admin-reports.md | The Admin Hours summary | _[Member at `/admin-hours`, period This month: the My Hours list with one pending manual entry showing Edit and Withdraw, and one rejected entry showing its red "Rejected: <reason> — edit and resubmit it, or withdraw it." line and the Edit & resubmit button. Crop to the list, not the whole page.]_ |
| 08-admin-reports.md | The Admin Hours summary | _[Member at `/admin-hours`: the inline edit form open on a rejected entry, showing "Returned with: <reason>", the Category, Start Time, End Time and Description fields, and the Resubmit and Cancel buttons.]_ |
| 08-admin-reports.md | IP Security _(2026-09-29)_ | _[Member at `/ip-security/my-requests`: My IP Exceptions with the New Request form open — IP address (203.0.113.x), Select a use case, Duration (days, 1–90) and details — plus the Show expired, rejected, and revoked requests checkbox. Do not submit.]_ |
| 08-admin-reports.md | IP Security _(2026-09-29)_ | _[Administrator holding security.manage at `/ip-security`: the Pending Requests tab with its count badge and one pending request showing IP, use case, duration and the Approve / Reject actions. Seed the request with a documentation-range address (203.0.113.x); never capture a real client IP, and do not capture the Blocked Attempts tab with live addresses.]_ |
| 10-mobile-pwa.md | Getting Around on a Phone _(2026-08-07)_ | _[Administrator (long menu) at /dashboard in a 390×844 phone viewport: bottom-bar More tapped so the navigation drawer is open and not yet scrolled, with the bottom fade and the More pill with its arrow visible above the drawer footer.]_ |
| 11-finance.md | Adding Steps to a Chain _(built 2026-09-29)_ | _[Treasurer or admin holding finance.configure_approvals and positions.view, /finance/settings/approval-chains. The Add step dialog over an expanded purchase-request chain: Step type Approval, Approver type Position, the position picker set to Treasurer, Auto-approve under ($) = 250. The finance.approve help text under Approver type must be visible.]_ |
| 11-finance.md | Adding Steps to a Chain _(built 2026-09-29)_ | _[Treasurer or admin holding finance.configure_approvals, /finance/settings/approval-chains. The Delete step confirmation over a chain with three steps, showing the history-removal and waiting-request warnings and the Delete step / Keep it buttons. Never confirm.]_ |
| 13-medical-screening.md | Editing and Deleting Requirements | _[Admin with medical_screening.manage, /medical-screening, Requirements tab. Click the delete button on a seeded requirement that has records filed under it and capture the Delete Requirement confirmation, reading "Screening records filed under it are kept, but will no longer be linked to a requirement.", with both buttons visible. Never confirm. No member names or results in frame.]_ |
| 15-prospective-members.md | Pipeline Settings | _[Membership Coordinator (prospective_members.manage) at /prospective-members/settings with a pipeline selected, clipped to the "When an Applicant Becomes a Member" card: Operational applicants → Operational / Probationary, Administrative applicants → Administrative / Regular, and the Save Conversion Settings button. Demo pipeline only.]_ |
| 15-prospective-members.md | Holding, Rejecting, or Withdrawing | _[Membership Coordinator (prospective_members.manage) at /prospective-members, Withdrawn tab, with at least two rows showing the Withdrawn Date and Reason columns filled — one of them withdrawn by the applicant from the status page. Crop to the tab strip and table; fictitious demo applicants only.]_ |
| 15-prospective-members.md | Applicant Detail View | _[Membership Coordinator (prospective_members.manage) at /prospective-members, drawer of a demo applicant on a Multi-Signer Approval stage, clipped to the Approval Status section listing President — Approved and Chief — Pending. The demo seeder has no such stage today; seed one.]_ |
| 15-prospective-members.md | Sign-offs: Multi-Signer Approval _(2026-09-28)_ | _[A member holding the Fire Chief position but no prospective_members permission, at /prospective-members/sign-offs. Seed a pipeline with a Required Multi-Signer Approval stage requiring chief and president and one demo applicant on it with the President's signature recorded. Capture the heading and subtitle, the applicant card with stage · pipeline, pills "President: signed" and "Chief: waiting", and the "Sign as Chief" button.]_ |
| 15-prospective-members.md | Sign-offs: Multi-Signer Approval _(2026-09-28)_ | _[Same member and state with the "Sign as Chief" dialog open: the message naming the applicant and stage, the optional Note field, and the Sign / Not now buttons. Cancel with Not now so the seed survives.]_ |
| 15-prospective-members.md | "Advance" no longer claims success when nothing moved _(2026-08-08)_ | _[Membership Coordinator (prospective_members.manage) at /prospective-members, Inactive Applications tab with two demo rows selected and the Purge Applications dialog open ("This permanently deletes 2 inactive application(s)…", Cancel / Permanently Delete). Needs seeded inactive applicants; cancel rather than confirm so the seed survives.]_ |
| 15-prospective-members.md | Printing Labels | _[Membership coordinator holding prospective_members.manage only, at /prospective-members/print-labels?ids=<two or three demo applicant ids>, reached from Print Badges: the label preview showing two or three demo applicants' labels with name and short-id barcode. Demo data only; no real applicant names or emails.]_ |
| 16-integrations.md | Setting up Target Solutions | _[Training Officer or admin (training.manage) at /training/admin?page=setup&tab=integrations → Add Provider → Target Solutions, details step: API Base URL with its helper text, API Key and API Secret \* holding only obviously fake values (demo-key / demo-secret) or empty, Enable Auto-Sync switched on (it starts off) with Pull new completions: Every hour and Daily 30-day review at 02:00 with its timezone helper. Never save, and never type a real key or secret.]_ |
| 17-privacy-data-rights.md | What is never touched | _[As an administrator (members.manage) at /members/:userId for a Dropped (Voluntary) demo member: the Membership card showing Rank, Member type, Member since, then Status reading "Dropped Voluntary" with the red "Anonymize member" link beneath it. Clip to the card. Do not open the dialog.]_ |
| Inventory-NFC-Tags.md | Scheduling shelf audits | _[Quartermaster (`inventory.manage`), inventory NFC tags on, `/inventory/storage-areas`, the Edit Storage Area dialog of an active shelf: the **NFC Tags** card and the **Shelf audit schedule** select set to **Monthly**, with its status line ("Last audited …; next due …" or "Overdue since …"). Demo data only; no real tag serials in view.]_ |
| Inventory-NFC-Tags.md | Self-service kiosk | _[Quartermaster, `/inventory/admin/categories`, editing a loaner category with **Allow self-checkout at the kiosk** switched on and **Kiosk loan period (days)** set to 14; behind the dialog, the category card's **Kiosk · 14d** chip if visible. Demo category names only.]_ |
| Module-Admin-Hours.md | Correcting or withdrawing an entry _(2026-09-27)_ | _[Member (no admin_hours.manage), /admin-hours, My Hours list with one pending row and one rejected row showing "Rejected: <reason> — edit and resubmit it, or withdraw it." and the Edit & resubmit / Withdraw buttons; a second capture with the inline edit form open on the rejected row showing "Returned with:" and the Resubmit button. Use demo data only.]_ |
| Module-Training.md | Compliance Matrix Print Page | _[Training officer (training.manage) at /training/print/compliance, landscape: the four summary counts (Compliant, At Risk, Non-Compliant, Requirements); the grid with member names down the left, a colour-coded Completion percentage beside each, and one column per requirement with full wrapped headings; cells showing ✓, ◐, ✗, Exp and — ; the legend line under the grid; and the Training Officer / Chief signature block. Use a demo department with few enough requirements that the grid fits the sheet.]_ |

### Existing images

| Shot | Disposition | Why | PR(s) |
| ---- | ----------- | --- | ----- |
| `00-04-dashboard-overview` | **REPLACE** | Shot 2026-09-25; Log Training tile subtitle now 'Record a course or hours', My Updates may show stacked rows, admin sidebar may show the new More scroll pill | #2807, #2775, #2824 |
| `00-07-dashboard-panels` | **REPLACE** | Shot 2026-09-25; Log Training tile subtitle changed and My Updates can show stacked notification rows | #2807, #2775 |
| `00-09-account-settings` | **REPLACE** (also queued below) | Shot 2026-09-25; page title now 'My Account' and the Security section description reads 'Two-factor authentication'. Manifest alt ('the tab row leads to password, security, emergency contacts, appearance and notifications') also omits the Privacy and App sections and should be revised | #2759, #2807 |
| `00-16-sidebar-admin` | **REPLACE** | Shot 2026-09-25; Forms & Comms now lists Member Emails & Texts between Email Templates and Messages, and the scrolled sidebar now shows the top fade and More scroll pill | #2772, #2824 |
| `00-17-account-settings` | **REPLACE** (also queued below) | Shot 2026-09-25; full-page /account title now 'My Account' and Security sidebar description changed | #2759, #2807 |
| `00-19-change-password` | **REPLACE** (also queued below) | Shot 2026-09-25; the Password section's checklist is now the seven-rule list (12 characters, no runs, no triple repeats) shown before typing, and the page title reads My Account (was User Settings) | #2759, #2807 |
| `00-20-member-dashboard` | **REPLACE** | Shot 2026-09-25; Log Training subtitle changed; Next 30 Days event rows past their RSVP deadline show Open instead of Going / Can't; My Updates may stack | #2807, #2828, #2775 |
| `00-22-notification-card-expanded` | **REPLACE** | Shot 2026-09-25 full-page; inbox subtitle changed to 'Your in-app notifications. Pinned ones stay at the top.' and same-category rows now stack. The manifest prepare step clicks the first aria-expanded=false button in the first div.card containing 'New Shift Assignment', which may now be a stack header — check the prepare step before re-capturing | #2791, #2775 |
| `01-01-member-directory` | **REPLACE** (also queued below) | Closed status select displays its selected option, now 'All Statuses' (was 'All Status'); privacy notice reworded | #2784, #2669 |
| `01-05-add-member-form` | **REPLACE** (also queued below) | Status and Preferred Contact selects removed, separate Membership ID override box removed, Membership Number loses its asterisk and shows next-number placeholder/hint under auto-generation, Set initial password hint changed, subtitle 'Add someone to the roster' | #2759, #2819, #2823, #2751, #2784 |
| `01-06-import-members` | **REPLACE** | Subtitle now 'Add many members at once from a spreadsheet' and drop zone 'Choose a CSV file to upload' | #2784 |
| `01-07-admin-member-edit` | **REPLACE** (also queued below) | Back link now 'Back to Members Administration', email help text and compliance-exemption helper reworded | #2784, #2764 |
| `01-08-member-audit-history` | **REPLACE** (also queued below) | Entries now show date and time; also did not run in the 2026-09-25 sweep (filter rendered no events) — reseed audit events first | #2764, #2728 |
| `01-11-create-waiver` | **REPLACE** (also queued below) | Same Create Waiver tab as 01-19: Applies To changed to two boxes, subtitle changed, member picker shows rank names | #2765, #2784 |
| `01-19-create-waiver` | **REPLACE** (also queued below) | Applies To now shows two checkboxes (Training Requirements; Meeting Attendance & Shift Requirements) instead of three; page subtitle changed | #2765, #2784 |
| `01-22-member-lifecycle` | **REPLACE** | Member Management tab heading changed to 'Member Management' with new subtitle; filter 'All Statuses'; hub description changed | #2784 |
| `01-26-print-applicant-badges` | **REPLACE** (also queued below) | Bulk bar labels are now Advance Selected / Hold Selected / Reject Selected; manifest alt (manifest.mjs ~5838) still says 'Advance All' — the guide's alt was updated to 'Advance Selected' | #2783, #2653 |
| `01-33-import-review-rejected-rows` | **REPLACE** | Welcome-email option now 'Send welcome emails now' with temporary-password wording (and an Unavailable note when email is off); button pluralisation | #2751, #2759 |
| `01-40-member-directory-member` | **REPLACE** (also queued below) | As an ordinary member with emails hidden the search placeholder now reads 'Search by name or membership number...' | #2759 |
| `01-41-profile-visibility` | **REPLACE** | Full-page /account: title now 'My Account' and Security sidebar description changed | #2807, #2759 |
| `02-01-my-training` | **REPLACE** (also queued below) | The subtitle was rewritten and the 'Requirements' stat is now 'Required Training' with an 'X of Y requirements met' hint. The Pipeline Progress card now carries the program name. | #2827, #2788 |
| `02-100-checklist-steps-editor` | **REPLACE** | The manifest prepare clicks the button named 'Edit requirement', which is now 'Edit <requirement name>', so re-capture times out until the selector is updated. The pictured UI is unchanged. | #2788 |
| `02-17-officer-dashboard` | **REPLACE** (also queued below) | Subtitle changed to 'Compliance, expiring certifications, hours, and what needs your attention'. | #2777 |
| `02-18-review-submissions` | **REPLACE** | The pending banner was reworded, and completion dates now read 'Sep 27, 2026' instead of ISO. | #2777, #2788 |
| `02-30-shift-reports` | **REPLACE** | Review Queue view: the 'New' segment is replaced by a 'New report' button, and the card header changed. | #2756, #2762, #2763 |
| `02-31-shift-reports-filed` | **REPLACE** | Written by me view: new Your reporting summary card, a 'New report' button beside the strip, the 'Reports you've written (N)' heading, and no author chip on cards. | #2756, #2762, #2763 |
| `02-34-shift-report-analytics` | **REPLACE** (also queued below) | Card retitled 'Your reporting summary' (now an h2). Tiles relabelled; the chart is now 'Reports written per month' with month names. The manifest selector 'div:has(> h3:text("Shift Report Analytics"))' no longer matches, and the alt text ('monthly hours') is wrong. | #2756, #2762, #2763 |
| `02-35-shift-reports-my-reports` | **REPLACE** | The member view has no toggle. It shows the 'Shift reports about you' heading above the stats card, and cards drop the member's own name. | #2756, #2762, #2763 |
| `02-40-member-training-history` | **REPLACE** | Buttons now read Export CSV / Export PDF, and the status filter is 'All Statuses'. | #2784 |
| `02-65-print-compliance` | **REPLACE** (also queued below) | Tiles are now Compliant / At Risk / Non-Compliant. Cells print ✗ and Exp, a legend line was added, and headings wrap to full names. | #2788 |
| `02-91-session-confirmation-toggle` | **REPLACE** | The step 3 checkbox was renamed 'Start an in-progress training record when members check in' with a new helper, and the back link reads 'Back to Training Dashboard'. | #2820, #2777 |
| `03-05-open-shifts` | **REPLACE** (also queued below) | The intro line under the tab now reads 'Shifts with open seats. Sign up for one and it goes straight onto your schedule.' | #2780 |
| `03-104-my-shifts-hours` | **REPLACE** | The Hours view now ends with the 'Shifts with other departments' section and the 'Log outside shift' button below the monthly table. | #2749, #2826 |
| `03-11-swap-requests-tab` | **REPLACE** | A seeded one-way targeted offer now reads '→ Offered to <name>' instead of '→ Open swap'. If the default Pending view is empty, the new 'Showing pending requests only…' line also appears. | #2832, #2788 |
| `03-15-scheduling-settings` | **REPLACE** | Full-page General section: Department Defaults no longer has the 'Require assignment confirmation' checkbox. | #2812 |
| `03-32-settings-general-closeout` | **REPLACE** | Full-page General section: the 'Require assignment confirmation' checkbox is gone. Close-out summary copy was also reworded. | #2812, #2780 |
| `03-38-notifications-assignment` | **REPLACE** | Full-page capture of /scheduling/admin/settings/notifications. An amber 'Not in effect yet…' notice now sits above the six Scheduling Notifications switches. | #2814 |
| `03-47-settings-desktop` | **REPLACE** (also queued below) | The section list gains 'Outside Apparatus — Other departments members ride with'. General help copy changed, and the 'Require assignment confirmation' checkbox is gone from Department Defaults. | #2749, #2780, #2812 |
| `03-48-settings-phone` | **REPLACE** (also queued below) | The tab strip gains Outside Apparatus. | #2749 |
| `03-49-report-card-names` | **REPLACE** | Written by me cards no longer carry the author chip, so the 'filing officer in the metadata row' the alt text describes may be absent. The header is now a grid. | #2756, #2762 |
| `03-59-open-shifts-signup` | **REPLACE** (also queued below) | The intro line changed. The manifest prepare also waits on getByLabel('Sign up for this shift'), which no longer exists: the label is now 'Sign up for shift on <date>, <time> (<unit>)'. Re-capture fails until the locator becomes /Sign up for shift on/. | #2780, #2788 |
| `03-63-offline-banner` | **REPLACE** (also queued below) | The banner text is now 'You're offline. Reports are saved on this device and sent automatically when you're back online.' The alt text quotes the old wording ('saved locally and submitted when connectivity returns'), and the image line was left untouched per the rules. | #2780 |
| `03-67-swap-request-dialog` | **REPLACE** (also queued below) | The Open Swap card subtitle changed from 'Any member can pick it up' to 'An officer finds cover; it stays yours until then', and the shot shows both swap-type cards. | #2788 |
| `04-04-event-qr-code` | **REPLACE** (also queued below) | The QR page subtitle now reads 'Members scan this code to check themselves in'. The Instructions steps now end 'Members sign in if they aren't already' / 'Members tap Check In to record their attendance'. The NFC unsupported line is also reworded. The image was captured 2026-09-25, before these changes | #2779, #2804 |
| `04-05-create-event` | **REPLACE** (also queued below) | The Check-In Window option now reads 'Flexible - Opens before the start, closes when the event ends' and the field is 'Minutes before start'. The attachments card reads 'Files can't be attached from the app yet.' and the template card reads 'Pick a template to pre-fill common settings, or start blank.' Captured 2026-09-25 | #2779, #2820 |
| `04-08-event-analytics` | **REPLACE** (also queued below) | Header subtitle is now 'Attendance and check-in rates across your events' | #2779 |
| `04-09-event-templates` | **REPLACE** (also queued below) | Header subtitle is now 'Save common event settings to reuse when you create an event.' | #2779 |
| `04-14-meeting-minutes` | **REPLACE** (also queued below) | The /minutes subtitle now reads 'Record meetings, write up their minutes, and track action items'. The stat is now 'Total Meetings' and the search placeholder changed | #2786 |
| `04-15-action-items` | **REPLACE** | Subtitle is now 'soonest due first'. Meeting-item priority badges read high/urgent instead of 1/2 | #2792 |
| `04-35-recurring-event-form` | **REPLACE** (also queued below) | The recurrence note, check-in window labels and attachments note all changed wording. Captured 2026-09-10 | #2779 |
| `04-38-rolling-recurrence` | **REPLACE** (also queued below) | Rolling note now reads 'New occurrences are added automatically so the series always runs 12 months ahead.' (captured 2026-09-10) | #2779 |
| `04-39-delete-event-series` | **REPLACE** (also queued below) | The dismiss button now reads 'Keep Event' (was 'Go Back') and the body text was reworded | #2779 |
| `04-45-checkin-flexible-default` | **REPLACE** | The selected option now reads 'Flexible - Opens before the start, closes when the event ends' and the field label is 'Minutes before start'. Captured 2026-09-10 | #2779 |
| `04-49-early-checkin-notice` | **REPLACE** | The success heading now reads 'You're Checked In' (was 'Successfully Checked In!'). On a Training event the panel now reads 'Training Record' with the finalize wording | #2779, #2778, #2820 |
| `05-01-inventory-items` | **REPLACE** | Captured before #2663: the admin items list now shows the 'N items need a label.' line with Show them / Print their labels / Not now above the table. | #2663 |
| `05-13-issue-allowance-exceeded` | **REPLACE** | The allowance line now reads 'Allowance: X of Y used (period). Z remaining.', and Issue is disabled until Override allowance is ticked. The prepare locator /^Issue$/ no longer matches the card button, now named 'Issue Job Shirt'; update it before re-shooting. | #2821 |
| `05-14-reorder-requests` | **REPLACE** | Status badges now show words (Pending / Approved / Ordered / Partially received / Received / Cancelled) instead of raw lowercase values. | #2781 |
| `05-24-member-inventory` | **REPLACE** | The page heading now reads 'Member Equipment' (it was 'Members Equipment'). | #2781 |
| `05-33-label-printing` | **REPLACE** | The full print page now has the 'Save setup…' row under the header, and the preview identifier line has changed. | #2663 |
| `05-36-storage-areas` | **REPLACE** (also queued below) | The header now has Put away, Scan shelf label, Check contents and Print N labels (the 2026-09-25 capture lacks Check contents), and the subtitle was reworded. | #2651, #2663, #2781 |
| `05-45-impact-planner` | **REPLACE** | The back link now reads 'Back to Admin' (it was 'Back to Inventory Admin'). | #2781 |
| `05-48-storage-area-items` | **REPLACE** | Same header buttons and subtitle change as 05-36. | #2651, #2663, #2781 |
| `05-51-label-print-settings` | **REPLACE** | The settings panel shows the old 'ADDITIONAL INFO ON LABEL' block; it is now 'What Prints on the Label' with Item name / Asset tag / Serial number and five extra fields. A saved-setup row sits above it, and the preview identifier line now reads 'Asset: …'. | #2663 |
| `05-58-return-items-modal` | **REPLACE** | Rows now carry real checkboxes and start unselected. The prepare step's /^Return$/ locator no longer matches ('Return items from <member>'); update it before re-shooting. | #2821 |
| `05-59-impact-planner-results` | **REPLACE** | Scrolled to the top, so the back link is in frame; it now reads 'Back to Admin'. | #2781 |
| `05-64-label-settings` | **REPLACE** | The framed settings panel shows the old 'Additional info on label' block above the orientation block. | #2663 |
| `05-66-my-equipment` | **REPLACE** (also queued below) | The third tile now reads 'Pending requests' (it was 'Pending') and counts open return notices, and a subtitle was added under the heading. | #2837, #2821 |
| `05-68-equipment-request-states` | **REPLACE** (also queued below) | The badges now read Awaiting review / Approved / Issued instead of raw pending / fulfilled. The alt text still says 'a pending request … a fulfilled one'. | #2761 |
| `05-69-label-print-page` | **REPLACE** | The alt and frame show the old extra-detail toggles, which are now What Prints on the Label. The saved-setup row and the preview identifier line have also changed. | #2663 |
| `05-85-label-print-confirm` | **REPLACE** | The saved-setup row was added above the printer card and the preview now reads 'Asset: …'. The alt names only Mark and Not yet, but the prompt now also has Scan labels to confirm. | #2651, #2663 |
| `06-01-apparatus-list` | **REPLACE** (also queued below) | Stat tile 'Maint. Due' is now 'Maintenance Due'; the pagination footer reads 'Page X of Y · N apparatus' | #2782 |
| `06-02-apparatus-label-print` | **REPLACE** | Label page buttons renamed (Print in browser, Download test label) and a Start at label picker added for Letter Paper (Grid); captured 2026-09-25, before #2663/#2804 | #2663, #2804 |
| `06-04-apparatus-maintenance-tab` | **REPLACE** | The add button and modal submit read 'Add Record' / 'Save Changes', and the empty-state text changed | #2782 |
| `06-08-facility-label-print` | **REPLACE** | Same shared label page, with the renamed header and test-label buttons | #2663, #2804 |
| `06-09-facilities-dashboard` | **REPLACE** (also queued below) | Header button 'Print Page Labels' is now 'Print Labels' | #2793 |
| `06-15-facility-maintenance-form` | **REPLACE** | Submit button 'Create' is now 'Create Record' | #2793 |
| `06-24-rooms-nested-tree` | **REPLACE** | Rooms show 'Capacity N' instead of 'Cap: N' | #2793 |
| `06-28-facility-settings` | **REPLACE** (also queued below) | The subtitle and per-list descriptions were reworded, and the add button now reads 'Add facility type' | #2793 |
| `07-01-documents` | **REPLACE** (also queued below) | The subtitle, the 'This Month' stat (now 'Added This Month') and the search placeholder changed | #2785 |
| `07-02-new-folder-dialog` | **REPLACE** (also queued below) | The 'Parent:' label now reads 'Location:'. The manifest alt ('parent folder selector') is wrong: the dialog has no parent selector, and the location is the open folder. Update the alt when re-capturing | #2785 |
| `07-03-upload-documents` | **REPLACE** (also queued below) | The dialog box text 'Drag and drop your file here / or click to browse' is now 'Choose the file to upload', and the placeholders changed. The manifest alt still says 'drag-and-drop zone'; suggested alt: 'Upload Document dialog with its file chooser, name and description fields'. The guide's image line was left untouched per the rules | #2785 |
| `07-04-forms-list` | **REPLACE** (also queued below) | Tab 'My Forms' now reads 'Forms'. Status and category chips are capitalised. The subtitle and the public-but-unpublished warning were reworded | #2789 |
| `07-05-form-sharing` | **REPLACE** (also queued below) | Dialog title 'Public Sharing Settings' is now 'Share Form'. It has a new 'Allow submissions without signing in' checkbox, and the Public Access subtitle, footnote and QR caption are reworded. The dialog is taller, so the QR code may fall below a viewport-only capture; consider fullPage | #2789, #2811 |
| `07-06-form-builder` | **REPLACE** | Editor header chips are capitalised, and the incomplete-field banner and warnings were reworded | #2789 |
| `07-07-form-submissions` | **REPLACE** | The tab strip now reads 'Forms \| Starter Templates \| Submissions' instead of 'My Forms \| …' | #2789 |
| `07-10-create-rule-modal` | **REPLACE** (also queued below) | The note under the trigger is reworded ('switch off every rule for this trigger — any one left on keeps it running…'), and the dropdown gained Suggestion Submitted and Equipment Request Update. The manifest alt says 'trigger and channel fields', but the dialog has no channel field (Rule Name, Trigger Event, Description only). Fix the alt | #2791, #2767, #2720 |
| `07-11-new-message-form` | **REPLACE** (also queued below) | The 'Persistent' checkbox is now 'Keep in inbox after it is read', and the list badge 'Ack required' is now 'Needs acknowledgment' | #2790 |
| `07-12-acknowledgment-report` | **REPLACE** | The row badge 'Ack required' is now 'Needs acknowledgment' | #2790 |
| `07-15-suggestion-submit-anonymous` | **REPLACE** (also queued below) | The frame is missing the new hint under 'Screenshots (optional, up to 5)' about formats, 10 MB, scaling to 2560 px and GIF first frame | #2830 |
| `08-06-reports` | **REPLACE** (also queued below) | Every card description, the page subtitle, the date-range note and the 'How Reports Work' banner changed. | #2801 |
| `08-08-public-portal` | **REPLACE** (also queued below) | Configuration tab lost the Allowed Origins and Caching cards (only Rate Limiting remains), Security Best Practices list and disabled banner changed. Alt 'with the enable toggle and domain settings' was never right; use 'Public Portal page on the Configuration tab, with the Enable Portal button and the default rate limit' (caption added in the guide). | #2803, #2809, #2812 |
| `08-34-email-templates` | **REPLACE** (also queued below) | Sidebar lacks the Suggestion Boxes category and may lack Equipment Request Update / Application Withdrawn; the fullPage capture also shows the removed CSS Styles box and the retired preview shell. | #2720, #2754, #2767 |
| `08-57-template-reset-dialog` | **REPLACE** (also queued below) | Dialog message is now 'Restores the subject, HTML body, plain-text body, styles and footer choice to the defaults. Your CC/BCC settings are kept. You cannot undo this.' and the preview behind it shows the retired shell. | #2754 |
| `08-64-email-footers-tab` | **REPLACE** (also queued below) | Footers tab gained the Department contact details card, and each footer's single contact checkbox became a four-checkbox Contact details fieldset showing values; update alt to mention both. | #2760 |
| `08-67-email-preview-design` | **REPLACE** (also queued below) | Pictures the retired centred-masthead shell with status line and fact panel; every template now renders the solid-tab design. Alt ('the white card on grey, its centred masthead and fact panel') is wrong; caption already rewritten. Recapture on Event Reminder (date tile) or Shift Assignment and update the alt in manifest.mjs. | #2754, #2760 |
| `08-77-legal-proposal-as-proposer` | **REPLACE** | The draft's action now reads 'Publish', not 'Publish to members'; the alt text (guide image line and manifest.mjs) names the old label. Caption updated; image line left untouched per rules. |  |
| `08-85-testing-home-runs` | **REPLACE** | Export buttons now read Print report / Download CSV / Download Markdown and the intro is rewritten. | #2806 |
| `08-86-testing-report` | **REPLACE** | Coverage row 'Covered by somebody' is now 'Checked' and the footnote is reworded. | #2806 |
| `09-02-create-template` | **REPLACE** | The back link reads 'Back to Templates'. | #2777 |
| `09-04-template-builder` | **REPLACE** | The back link reads 'Back to Templates'. | #2777 |
| `09-09-member-skills-testing` | **REPLACE** | The subtitle is now 'Start a skills test or review your results', and the empty-state lines changed. | #2777 |
| `10-04-mobile-dashboard` | **REPLACE** | Shot 2026-09-25; Log Training tile subtitle now 'Record a course or hours' | #2807 |
| `11-01-finance-dashboard` | **REPLACE** (also queued below) | New subtitle; quick-link 'Dues Management' is now 'Dues'; descriptions reworded | #2797 |
| `11-05-budget-detail` | **REPLACE** | Available→Remaining, % utilized→% used, transactions panel now 'Not available yet' | #2797 |
| `11-06-approval-chains` | **REPLACE** (also queued below) | The page now shows Edit chain pencils, a new subtitle, per-step Move up/Move down/Edit step/Delete step controls, an Add step button and the step-timing note. Capture with one chain expanded | #2839 |
| `11-08-create-purchase-request` | **REPLACE** (also queued below) | New subtitle ('Saved as a draft…'), Budget Category label now Budget, Create Request button | #2797 |
| `11-10-create-expense-report` | **REPLACE** (also queued below) | Subtitle now 'Saved as a draft. Submit it for approval from the next page.' | #2797 |
| `11-12-create-check-request` | **REPLACE** (also queued below) | 'Budget (Optional)' is now 'Budget' | #2797 |
| `11-15-dues-management` | **REPLACE** | The heading is now 'Dues' with a new subtitle | #2797 |
| `12-03-opportunities` | **REPLACE** (also queued below) | 'Apply' is now 'Start Application', and the subtitle changed | #2798 |
| `12-04-create-application` | **REPLACE** (also queued below) | 'Opportunity ID' is now 'Grant Opportunity', with a new subtitle and placeholders | #2798 |
| `12-06-application-budget-tab` | **REPLACE** (also queued below) | 'Add Item' is now 'Add Budget Item' | #2798 |
| `12-14-fundraising-reports` | **REPLACE** (also queued below) | Tabs renamed to Grants/Fundraising, the subtitle changed, and Total Donations is now Total Raised | #2798 |
| `13-01-medical-landing` | **REPLACE** (also queued below) | Page subtitle changed | #2795 |
| `13-03-records-tab` | **REPLACE** (also queued below) | Unlinked records now read 'Not linked to a member or prospect' instead of 'Unknown' | #2795 |
| `13-05-add-requirement` | **REPLACE** (also queued below) | The submit button is now 'Add Requirement', the helper under roles was removed, and the roles notice was reworded | #2795 |
| `13-07-add-record-linkage-notice` | **REPLACE** (also queued below) | The amber notice text is shorter, and the submit button is now 'Add Record' | #2795 |
| `14-01-elections-list` | **REPLACE** (also queued below) | Manager subtitle is now 'Create elections, send ballots and publish results' | #2787 |
| `14-07-eligibility-roster` | **REPLACE** | Stat 'Secretary Overrides' is now 'Voter Overrides'; the ineligible-members help text is reworded to point to the Overrides tab | #2787 |
| `14-16-election-settings` | **REPLACE** (also queued below) | The Defaults section was removed and the page now opens on Proxy Voting. The alt text in both the guide and the manifest ('with the default rule toggles') is now wrong. The guide image line was not edited, per the rules. The manifest alt and guide alt should become e.g. 'Election Settings opened on Proxy Voting, with Features, Test Ballot and Security beside it' | #2812 |
| `14-24-ballot-send-skipped` | **REPLACE** | The skipped-members banner text is reworded ('…add a voter override on the Overrides tab.') | #2787 |
| `15-03-create-applicant` | **REPLACE** | Add Applicant dialog now has the Target Role picker, labelled fields and a 44px Close button; manifest alt ('Create applicant form with contact fields and membership type') should name Target Role. | #2652, #2765 |
| `15-09-bulk-action-result` | **REPLACE** | Manifest prepare clicks 'Advance All' (scripts/screenshots/manifest.mjs ~11620), which no longer exists; must change to 'Advance Selected' before re-shooting or the capture times out. | #2783 |
| `15-09-convert-modal` | **REPLACE** (also queued below) | Step 2 lost the Membership Type cards and the 'Send welcome email with login credentials' checkbox; it now has Member class / Starting status selects with the pre-fill note, a Target Role picker, and the 'How will they get their password?' fieldset. Alt text ('membership type, rank, station and hire date') should name member class, starting status, target role and password choice. | #2836, #2751, #2652 |
| `15-10-pipeline-settings` | **REPLACE** (also queued below) | Pipeline Settings gained the 'When an Applicant Becomes a Member' card and the 'Show upcoming stages' option; status-page copy now reads 'Let applicants check their application status through a public link' with the Enable Status Page override sentence; inactivity/purge help reworded. | #2836, #2655, #2721, #2783 |
| `15-11-table-bulk-actions` | **REPLACE** (also queued below) | Bulk bar now reads Advance Selected / Hold Selected / Reject Selected instead of '... All'. | #2783 |
| `16-02-slack-connect` | **REPLACE** | Captured 2026-09-25, before #2802; the connect dialog note now reads 'Connecting turns this integration on for your organization. You can disconnect it at any time.' | #2802 |
| `16-04-documenso-connect` | **REPLACE** | Same connect-dialog note change from #2802 | #2802 |
| `16-06-paypal-connect` | **REPLACE** | Same connect-dialog note change from #2802 | #2802 |
| `16-08-mcp-connect-form` | **REPLACE** | Full-height capture of the same connect dialog, which includes the note that #2802 reworded | #2802 |
| `17-01-privacy-choices` | **REPLACE** | Page title now 'My Account' and Security sidebar description changed; also the manifest captures /account?tab=security while the guide section it illustrates is My Account → Privacy → Privacy Choices, so the route should move to ?tab=privacy | #2807, #2759 |
| `18-01-member-storefront` | **REPLACE** | Product button now reads 'Add to cart · $X'; the window card reads 'Ordering closes' | #2799 |
| `18-03-order-windows` | **REPLACE** (also queued below) | Row buttons now read Open ordering / Close ordering / Record or Update vendor order; counts read '1 order' / 'N orders' | #2799 |
| `18-04-my-orders-unpaid` | **REPLACE** (also queued below) | Reference line now reads 'Include ORD-… as the reference on your payment.' | #2799 |
| `00-01-login-page` | **CHECK** (also queued below) | Idle sign-in page; only notice/error/lockout wording changed (#2758, #2805). Confirm no banner is captured | |
| `00-15-sidebar-member` | **CHECK** | Tall viewport, probably no overflow; confirm the new More scroll pill is not painted | |
| `00-23-login-two-factor` | **CHECK** | Only the recovery-code placeholder changed, visible after 'Use a recovery code'; the pictured 6-digit state is likely unchanged | |
| `00-26-sidebar-officer-operations` | **CHECK** | Tall viewport, probably no overflow; confirm no scroll pill | |
| `01-02-member-profile` | **CHECK** | Recaptured 2026-09-25 with Service History card; inventory panel gained empty state 'No equipment is assigned to this member.' (#2784) | |
| `01-10-prospective-pipeline` | **CHECK** | Kanban card status badges now read 'Active'/'On Hold' instead of raw values | |
| `01-27-stage-type-picker` | **CHECK** | Manual Approval tile description now 'A pipeline manager approves the applicant before they advance.' — visible if the tile text is in frame | |
| `01-28-stage-email-config` | **CHECK** | Application Tracker Link hint reworded and email preview restyled; probably invisible if the section is unticked and Show Preview collapsed | |
| `01-29-status-change-modal` | **CHECK** | Archived removed from New Status and fields labelled; captured closed on an active member so likely unchanged | |
| `02-04-course-library` | **CHECK** | Subtitle now 'The classes your department runs or recognizes (N courses)'. | |
| `02-102-shift-report-crew-form` | **CHECK** | Reached via view=create; the strip no longer carries a 'New' segment. | |
| `02-106-course-library-member` | **CHECK** | Same Course Library subtitle change. | |
| `02-21-expiring-certifications` | **CHECK** | Days until expiry are counted from the department's date; this differs only if the capture runs between local evening and UTC midnight. | |
| `02-32-shift-reports-flagged` | **CHECK** | Flagged card with a reviewer comment no longer shows the duplicate generic notice, and the strip/New report layout changed. | |
| `02-33-shift-reports-drafts` | **CHECK** | The strip now ends at Drafts, with a separate 'New report' button. | |
| `02-37-trainee-stats-card` | **CHECK** | The My Shift Progress card is unchanged, but the member heading now sits above it. | |
| `02-42-external-integrations` | **CHECK** | The seeded provider is Vector Solutions, so the card should still read 'Every 24h'. Confirm nothing on the card moved. | |
| `02-45-training-programs` | **CHECK** | Manager subtitle now 'Build programs, import requirements, and track member progress'. | |
| `02-64-skills-testing-admin` | **CHECK** | The same summary tiles may now read '—'. | |
| `02-74-annual-compliance-report` | **CHECK** | Any requirement with members_total 0 in the demo now reads 'Not applicable' instead of a red 0%. | |
| `02-90-crew-summary-table` | **CHECK** | The table is unchanged but sits in the retitled card; confirm the selector still resolves. | |
| `03-01-scheduling-tabs` | **CHECK** (also queued below) | The Scheduling header description is now 'See the schedule, sign up for shifts, and request swaps and time off' if the header is in frame. | |
| `03-04-my-shifts` | **CHECK** | Empty-state copy changed if captured empty. Per-row accessible names changed, but nothing visible. | |
| `03-103-shift-details-modal-phone` | **CHECK** | Did not run in the last sweep; the committed bytes predate it. | |
| `03-13-shift-patterns` | **CHECK** | The per-pattern button reads 'Generate shifts' ('Generate' on phones); the alt says 'Generate Shifts action'. Accessibility-only changes elsewhere. | |
| `03-14-scheduling-reports` | **CHECK** | Captured on Shift Compliance. A requirement nobody is held to now reads 'Not applicable' instead of a red 0% and 0/0. Rows may show 'incl. N outside' if the seed has outside shifts, and Member Hours gained a column. | |
| `03-24-equipment-check-reports` | **CHECK** | The date range and trend buckets are now cut at the department's midnight; figures may differ for evening checks. Layout is unchanged. | |
| `03-33-settings-eligibility` | **CHECK** | The ranks screen's empty-rank button now reads '+ Choose shift positions this rank can fill'. | |
| `03-39-notifications-reminders` | **CHECK** | Clipped to Start-of-Shift Reminders. Confirm the new 'Not in effect yet' notice is outside the clip. | |
| `03-60-dashboard-my-shifts` | **CHECK** | The Next 30 Days event-row RSVP controls changed (Open instead of Going/Can't for closed RSVPs). | |
| `03-61-review-queue-batch` | **CHECK** (also queued below) | The strip's new 'New report' button may be in frame. | |
| `03-62-flagged-queue` | **CHECK** (also queued below) | The Flagged view dropped the duplicate flagged box when a reviewer comment exists, and the view strip and New report button changed. | |
| `03-73-flat-check-form-header` | **CHECK** | The check form gained a 'Tap NFC tags' strip, rendered only with Web NFC, which the harness lacks. The sweep container was rewrapped, so confirm the capture is unchanged; 03-70/71/72 are in the same position. | |
| `03-74-settings-call-count-toggle` | **CHECK** | General section: check whether Department Defaults, now missing the removed checkbox, is in frame. | |
| `03-78-swap-review-blocked` | **CHECK** | Changes only if the pictured request is a targeted offer ('→ Offered to <name>'). | |
| `03-97-shift-reminder-expanded` | **CHECK** | Two or more Shift Reminder rows now stack in the inbox, and the inbox subtitle changed. A fresh capture also reads 'No equipment checklists are assigned for this shift' against a caption promising checklists, so it needs seed data. | |
| `04-01-events-list` | **CHECK** | A card for an event whose RSVP deadline has passed or that has ended now shows no RSVP buttons (#2828) | |
| `04-02-event-detail` | **CHECK** (also queued below) | Only if the pictured event is a cancelled recurring occurrence, the header would now read 'Series of N' (#2773) | |
| `04-03-election-eligibility` | **CHECK** | Eligibility roster stat label changed from Secretary Overrides to Voter Overrides, if it is in frame (#2787) | |
| `04-06-check-in-monitoring` | **CHECK** | Status column now shows 'Going' label; empty state 'No one has checked in yet.' (#2778/#2779) | |
| `04-09-rsvp-modal` | **CHECK** | RSVP radio rows are taller on phones only; a desktop capture is likely unchanged (#2773) | |
| `04-10-event-attendance` | **CHECK** | Several details may be in frame: '(times edited)' wording, RSVP Activity statuses as labels, and Training Details / Requirements & Programs card text on a Training event (#2779/#2773/#2820) | |
| `04-20-event-requests` | **CHECK** | On an expanded request, 'Public status link available' now reads 'The requester can track progress with a status link', and coordinator options show rank display names (#2779/#2788) | |
| `04-34-guest-prospect-card` | **CHECK** | Badge casing on pipeline cards changed, if they are in frame (#2783) | |
| `04-35-minutes-linked-elections` | **CHECK** | Minutes detail copy changed; Linked Elections card unchanged (#2786) | |
| `04-37-hour-tracking-mapping` | **CHECK** | The intro paragraph now says Training events are not mapped here, and Training is no longer offered as a source (#2820) | |
| `04-40-end-event` | **CHECK** | The End Event Early dialog dismiss button is 'Keep It Running' if the dialog is open in the shot. The P7 sweep did not run this shot (#2779) | |
| `04-42-cast-ballot` | **CHECK** | Ballot copy changed (#2787). The sweep also held this shot back because of a seed gap: the voter has no meeting attendance, so the capture shows the attendance gate | |
| `04-47-template-reminder-audience` | **CHECK** | The template form label 'Minutes After End' shows only for Window check-in (#2779) | |
| `05-02-inventory-dashboard` | **CHECK** | Used under Low Stock Alerts; the hub has no separate low-stock banner now (low stock is in Needs attention and on the Reorder Requests badge). Confirm what this image actually shows. | |
| `05-02-items-pinned` | **CHECK** | Admin items list; the new needs-a-label line may be in frame. | |
| `05-03-inventory-categories` | **CHECK** | A Kiosk chip appears only on a category with self-checkout on; the demo seed opts none in. | |
| `05-03-items-grouped` | **CHECK** | Same page; the needs-a-label line may be in frame. | |
| `05-04-variant-group-form` | **CHECK** | The alt says 'Variant group creation form with the size and colour matrix', but the section now says variants come from Generate Sizes & Styles. Confirm the image shows that block and not an Add Group dialog. | |
| `05-05-item-form-modal` | **CHECK** (also queued below) | Serial # / Inspection Interval (days) may now show ' *', depending on the category captured. | |
| `05-06-item-detail` | **CHECK** | Label Printed can now read '<date> by <name>', and History is manage-only. Confirm the capture role is an administrator and whether a seeded label print shows. | |
| `05-25-admin-hub` | **CHECK** (also queued below) | Recaptured 2026-09-25 with the NFC cards. Check whether a departure-clearance or Pending return row now appears in Needs attention, and that the 'did not respond (returns)' banner is gone (#2750, #2765). | |
| `05-46-size-preferences` | **CHECK** | The prepare's /^Sizes$/ relies on the text fallback ('Edit sizes for <member>'); verify it still captures. | |
| `05-47-items-filter-bar` | **CHECK** | Filter-bar crop; the needs-a-label line renders directly below the filters and may intrude. | |
| `05-53-items-grid-lot-stock` | **CHECK** | Same page; the needs-a-label line may be in frame. | |
| `05-54-admin-hub-assign` | **CHECK** | Same hub: confirm the Setup & Tools cards and the absence of the returns banner. | |
| `05-57-assign-scan-modal` | **CHECK** (also queued below) | Visually unchanged, but the prepare's /^Assign$/ now matches only through the visible-text fallback ('Assign items to <member>'); verify it still captures. | |
| `05-60-admin-hub-groups` | **CHECK** | Same hub: confirm the attention queue and that the returns banner is absent. | |
| `05-71-impact-planner-replacement` | **CHECK** | The 'Back to Admin' rename matters only if the top of the page is in frame. | |
| `05-72-setup-prompt` | **CHECK** | Viewport shot of the hub; the old returns banner may have been in frame. | |
| `05-73-setup-rooms` | **CHECK** | The stub user holds '*', so the Add room form still shows; confirm the stub keeps wildcard permissions. | |
| `05-75-setup-item-prefilled` | **CHECK** | If the captured category requires a serial or maintenance, the labels now carry ' *'. | |
| `05-83-items-select-all-matching` | **CHECK** | Filtered to Needs a Label, so the count line is hidden; confirm the bulk bar is unchanged. | |
| `05-84-label-scope-picker` | **CHECK** | The picker gained a parts sentence (above 500 only) and the over-limit copy now says 5,000; with 11 items it should be unchanged. | |
| `05-86-gear-request-products` | **CHECK** | The helper under 'What do you need?' was reworded. | |
| `05-87-gear-request-size` | **CHECK** (also queued below) | The size-on-file line now ends '(from your profile).' and the duration helper and reason placeholder were reworded; 'none on hand' holds only if XXL is a stocked zero-quantity row. | |
| `06-03-apparatus-detail` | **CHECK** (also queued below) | 'Important Dates' card is now 'Expiration Dates', if in frame | |
| `06-05-apparatus-fuel-tab` | **CHECK** | Empty state changed; stale only if the shot shows no fuel logs | |
| `06-06-apparatus-equipment-tab` | **CHECK** | Empty state changed; stale only if the shot shows no equipment | |
| `06-11-facility-detail` | **CHECK** | Section labels and buttons were reworded; depends on which section is in frame | |
| `06-13-facility-maintenance` | **CHECK** | Only an aria-label and a fallback text changed; probably still accurate | |
| `06-14-facility-inspections` | **CHECK** | Only the search aria-label changed; probably still accurate | |
| `06-21-apparatus-evoc-level` | **CHECK** | The briefing reports a failed capture (no Intermediate EVOC level seeded); verify the image exists and is current | |
| `06-22-apparatus-operators-tab` | **CHECK** | Empty state changed; stale only if the shot shows no operators | |
| `06-23-add-operator-member-picker` | **CHECK** | The briefing reports a failed capture (no Intermediate EVOC level seeded); verify the image | |
| `07-08-notification-rules` | **CHECK** (also queued below) | Changes only if the demo has no rules (the empty state was reworded). Also check whether any seeded rule for an unenforced trigger now shows the 'Not enforced' badge | |
| `07-09-notification-send-log` | **CHECK** | The Send Log empty-state copy was reworded (#2791); relevant only if the frame shows the empty state | |
| `07-14-suggestion-box-dialog` | **CHECK** | Compliance Officer is now in the Reviewer positions list, above the captured scroll position; already judged unchanged 2026-09-24/25 | |
| `07-17-suggestion-review` | **CHECK** | Re-shot 2026-09-25 after the layout fixes; confirm the selected row shows the blue left edge | |
| `07-23-suggestion-box-delete-dialog` | **CHECK** | Captured after #2734; no action expected | |
| `07-24-suggestion-notification-rule` | **CHECK** (also queued below) | The note under the trigger was reworded (every-rule-off wording); the alt still holds, but the pictured text changed | |
| `08-01-setup-checklist` | **CHECK** | Module-setup subtitle and completion banner reworded | |
| `08-02-organization-settings` | **CHECK** (also queued below) | Remove logo button beside Upload logo once a logo is set; otherwise probably unchanged | |
| `08-04-role-management` | **CHECK** | Chips now show full permission names; subtitle reworded; Compliance Officer card exists; seeded 'Chief' naming | |
| `08-07-analytics-dashboard` | **CHECK** | Subtitle now 'Check-in scans across all events'; empty scan-error text changed | |
| `08-11-error-monitor` | **CHECK** | Subtitle and empty state reworded | |
| `08-19-audit-log` | **CHECK** | Subtitle reworded | |
| `08-33-notifications-inbox` | **CHECK** | Same-category rows now render as stacks; subtitle reworded | |
| `08-36-template-search` | **CHECK** (also queued below) | fullPage capture includes the editor (CSS Styles box removed) and the preview pane in the retired shell | |
| `08-37-email-officers` | **CHECK** | Officers panel unchanged, but the reachability notice now renders above every Email Templates tab while the demo's link address is loopback | |
| `08-38-email-configuration` | **CHECK** | Captured before the Email link address card merged; card now sits above Enable Email Notifications (red loopback alert in the demo unless mocked); card subtitles reworded | |
| `08-56-template-discard` | **CHECK** (also queued below) | Editor lost the CSS Styles collapsible; preview pane now solid-tab shell | |
| `08-58-template-send-test` | **CHECK** (also queued below) | Preview above Send Test to Me shows the retired shell; the reachability notice may now appear with the demo's loopback address | |
| `08-60-dashboard-notification-cards` | **CHECK** | My Updates may show a stacked 'N …' row with 'Latest: …' | |
| `08-62-topnav-bell-badge` | **CHECK** | Top bar now moves groups that do not fit into More | |
| `08-63-inbox-show-read` | **CHECK** | Read rows stack too; subtitle reworded | |
| `08-65-template-footer-selector` | **CHECK** (also queued below) | Preview column in frame shows the retired shell | |
| `08-66-template-variable-palette` | **CHECK** (also queued below) | Preview column in frame shows the retired shell | |
| `08-79-members-settings-ranks` | **CHECK** | '+ Choose shift positions this rank can fill' replaces '+ Configure eligible positions' | |
| `08-80-members-settings-tiers` | **CHECK** | Tier toggle now reads 'Show rights' | |
| `08-81-org-chart-outline` | **CHECK** | Subtitle changed; alt names 'Fire Chief' which re-seeded demo may show as 'Chief' | |
| `08-82-org-chart-diagram` | **CHECK** | Subtitle changed; alt says 'from the Fire Chief' | |
| `08-83-org-chart-node` | **CHECK** | Position editor help text reworded; toggle now 'Show this position to members' | |
| `08-87-dashboard-next-30-days` | **CHECK** | Next 30 Days event rows changed (RSVP controls withheld after end/deadline) | |
| `09-01-skill-templates` | **CHECK** | The summary tiles above the list may now read '—' for Pass Rate or Avg Score. | |
| `09-10-member-awaiting-validation` | **CHECK** | The full-page member My Training has the same subtitle and Required Training stat change. | |
| `09-12-summary-pending-validation` | **CHECK** | Avg Score reads '—' if the demo has no validated test with points. | |
| `09-12-template-linked-requirement` | **CHECK** (also queued below) | A viewport capture may include the 'Back to Templates' link. | |
| `10-06-mobile-inventory-admin` | **CHECK** | Inventory admin hub now lists pending returns and open departure clearances in Needs attention (#2750, #2765) | |
| `10-14-scan-camera-denied` | **CHECK** | 'Back to Members' is now a 44px target on phones (#2765), may shift the header | |
| `10-15-mobile-menu-notifications` | **CHECK** | Drawer scrolled to Notifications now shows the top fade and possibly the More pill (#2824) | |
| `10-16-mobile-item-detail` | **CHECK** | Item detail tabs now depend on inventory.manage (History manager-only, members open on Stock Lots, #2821); check the capturing role's view | |
| `11-02-fiscal-year-settings` | **CHECK** | Only the dialogs changed; the page is probably unchanged | |
| `11-03-budget-categories` | **CHECK** | The empty-state description changed; stale only if the shot is empty | |
| `11-12-purchase-request-detail` | **CHECK** (also queued below) | If captured as a draft, it shows Submit for Approval / Cancel Request and new timeline text; priority now shows as a label | |
| `11-14-expense-report-detail` | **CHECK** (also queued below) | Submit for Approval if draft; expense type label | |
| `11-16-check-request-detail` | **CHECK** (also queued below) | 'Void Request' and 'Submit for Approval' labels depend on the status pictured | |
| `12-02-grants-dashboard` | **CHECK** | Compliance-task status badges now show labels | |
| `12-05-applications-pipeline` | **CHECK** | The subtitle and search placeholder changed | |
| `12-07-application-compliance-tab` | **CHECK** | Status badges now show labels | |
| `12-09-campaign-detail` | **CHECK** | Campaigns page subtitle changed | |
| `12-10-donors` | **CHECK** (also queued below) | New subtitle | |
| `13-02-requirements-tab` | **CHECK** | The empty-state wording changed; stale only if the shot is empty | |
| `13-04-compliance-tab` | **CHECK** | The expiring card's empty text changed; stale only if nothing is expiring | |
| `13-06-expiring-screenings` | **CHECK** | The empty text changed; stale only if nothing is expiring | |
| `14-19-forensics-report` | **CHECK** | The Voting Timeline hour labels now read in department time, if votes exist (#2746) | |
| `14-23-membership-ballot-item` | **CHECK** | The ballot preview intro and anonymity line changed (#2787) | |
| `14-26-candidates-as-member` | **CHECK** | Same seed gap as 04-42: the attendance gate shows instead of the ballot | |
| `15-01-pipeline-board` | **CHECK** | Kanban card status badges now read 'Active' instead of 'active' (minor). | |
| `15-02-board-truncated` | **CHECK** (also queued below) | Card status badge casing changed (minor). | |
| `15-02-pipeline-builder` | **CHECK** | Stage delete tooltip now 'Delete stage'; pipeline list counts pluralise if in frame. | |
| `15-04-kanban-board` | **CHECK** (also queued below) | Card status badge casing changed (minor); cards may also show a target role. | |
| `15-08-election-package` | **CHECK** | If the pictured package is on a ballot, the ballot link now renders under the banner. | |
| `15-13-application-status` | **CHECK** | Page now shows the 'No longer interested?' withdraw card for open applications and a new footer; not in the manifest and cannot be recaptured until a status-token source exists. | |
| `15-14-applicant-drawer-overview` | **CHECK** | Drawer shows 'Target role: <name>' under Current Stage when set (seed has none) and board cards behind it now use 'Active' badge casing; alt text still says 'overview tab ... tab row' although the drawer has no tabs. | |
| `16-01-integrations-catalog` | **CHECK** | #2765/#2802 changed only the dialog semantics and the search box's accessible name. The grid should be visually unchanged, but confirm. | |
| `17-03-profile-as-officer` | **CHECK** | Shows Service History card after the 2026-09-25 recapture; alt does not mention it (acceptable) | |
| `18-02-store-admin` | **CHECK** | Settings-tab labels were reworded (Last call reminder, Extra recipients for new order alerts, banner helper); depends on how much of the page is in frame | |

## Queued by the October 4 – 5 documentation pass, 2026-10-05

Audit: [`CHANGE_AUDIT_2026-10-04_TO_10-05.md`](../CHANGE_AUDIT_2026-10-04_TO_10-05.md).
**Nothing has been captured.** This list is the work order; the one new inline
placeholder is `08-04b` in guide 08 (a `> **Screenshot needed:**` paragraph, so
`status_report.py` counts it — regenerate `SCREENSHOT_STATUS.md` when you next
capture).

**NEW**

| Shot                                    | Guide | Show                                                                                                                                                         |
| --------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `08-04b-role-save-wildcard`             | 08    | Role Management: edit a position holding `inventory.*`, change one permission, save — success toast (it used to fail with "Failed to update role")           |
| `02-xx-requirement-call-types-picker`   | 02    | Requirement form (and Create Pipeline): **Call types that count** picker over the department list, two types selected                                        |
| `03-xx-closeout-hours-column`           | 03    | Close-out wizard step 1: **Start / End / Hours** columns, one row with typed hours, one with **Until shift end** offered, the no-check-in flag               |
| `02-xx-shift-reports-department-view`   | 02    | Shift Reports as a Chief: the **Department** view beside **Written by me**, its own heading and no report list                                              |
| `02-xx-shift-report-calls-responded`    | 02    | Shift report crew list with the per-member **Calls Responded** figure                                                                                        |
| `03-xx-settings-shift-officer-files`    | 03    | Shift Reports settings → **Filing & Validation**: **Reports are filed by the officer on the rig**                                                            |
| `01-xx-expiring-supplies-email-phone`   | 03/10 | The weekly expiring-supplies email at 390px: three columns, apparatus and compartment under the item, days left under the date                               |

The preferred-name screens (My Account → Account, Admin Edit, Add Member, the ID
card) already carry placeholders in guide 01 from the commits that added them;
capture those in the same run.

**REPLACE**

| Image                                                                              | Why                                                                                                                                                                   |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `00-09` / `00-17-account-settings`                                                 | Account tab gained **Preferred Name**                                                                                                                                 |
| `01-05-add-member-form`, `01-07-admin-member-edit`                                 | Preferred Name field                                                                                                                                                  |
| `19-37-member-id-cards`                                                            | Card names the member by preferred name                                                                                                                               |
| `02-30` … `02-36`, `02-38`, `02-102`, `02-103` (Shift Reports screens)            | **Written by me** is the viewer's own reports; the Department view is separate; the report form lists only shifts the viewer led; crew list gains Calls Responded     |
| `02-34-shift-report-analytics`                                                     | Heading and scope: own figures by default, **Department** for holders of `training.view_analytics`                                                                    |
| `03-75`, `03-76`, `03-77`, `03-81` (close-out wizard)                              | Hours box and **Until shift end / Full shift** on step 1; no-hours flag on the confirm step                                                                           |
| `03-101-call-types-editor`, `03-74`, `03-08`, `03-09` (call log)                   | Incident type is a picker over the one department list                                                                                                                |
| `02-16-requirements`, `13-05-add-requirement`, `09-12-template-linked-requirement` | Requirement form has the **Call types that count** picker                                                                                                             |
| `05-25-admin-hub`, `05-54`, `05-60`, `18-02`, `19-06`, `19-08`, `20-16`, `10-06`, `03-51`, `02-41` | Administration hubs now start at the page margin (16px phone / 32px desktop), not double-indented. Phone-width frames show it most; desktop frames shift by 32px     |
| `07-14` … `07-24`, `20-15` (Suggestion Board)                                      | Vote button and filter pills are primary red, not blue                                                                                                                |
| `08-08-public-portal`                                                              | Configuration tab's default rate limit field validates 1–100,000 with an inline message                                                                              |
| `11-12`, `11-16` and the other finance request-detail frames                       | Action buttons that were blue are red                                                                                                                                 |
| Any frame showing an info, success, purple or danger alert in the light theme      | Alert body text is darker (AAA). Re-shoot with the next sweep rather than piecemeal                                                                                   |

**CHECK**

- **Tablet-width captures** with a mouse-driven desktop: card lists keep the
  `max-w-7xl` cap and Events, Past Events and Course Library use a wider card
  floor, so column counts at 1440px may differ from older frames.
- Any date-and-time picker frame at phone width (it used to cut the date to
  "mm/c").
- Finance and Grants stat tiles and the hub metric row at phone width (labels
  wrap now).

## Queued by the September 24 – October 4 documentation pass, 2026-10-04

The 250 pull requests merged between 2026-09-24 and 2026-10-04 (#2651 –
#2903) changed many screens. This pass checked each training guide against
the source and **queued 122 captures. None has been taken yet.**

- **84 REPLACE.** Each existing image the window made stale now has a
  `**[SCREENSHOT — REPLACE …]**` paragraph directly under it, saying what the
  new frame must show.
- **38 NEW.** Each is a `> **Screenshot needed:**` placeholder, which
  `status_report.py` counts. `SCREENSHOT_STATUS.md` was regenerated and now
  reads 569 of 608 filled: these 38 plus the one carried phone shot
  (`07-19`).

Audit: [`CHANGE_AUDIT_2026-09-24_TO_10-04.md`](../CHANGE_AUDIT_2026-09-24_TO_10-04.md#documentation-and-media-disposition).

**Read these before capturing.**

- **Every desktop `/scheduling` frame carries the old subtitle.** The page
  now reads "See the schedule, sign up for shifts, and request swaps and time
  off" (#2780). Only frames where the line is prominent are marked REPLACE.
  Re-shoot the rest whenever they are next touched: `03-11`, `03-44`, `03-49`,
  `03-56`, `03-59-open-shifts-signup`, `03-63-offline-banner`,
  `03-63-batch-report-form`.
- **Layout moved under several screens without changing their content.**
  - Card lists now size their columns to the grid's own width, so a tablet
    with the sidebar open shows two columns, not three (#2880, #2893, #2903).
  - Selected toggle buttons are primary red, not blue (#2891).
  - Radios are round again (#2871).
  - Settings screens drop their extra side padding on phones (#2894).
  - Hover-only controls now show on touch tablets (#2893).

  The guides' frames are desktop, so most are unaffected. Treat any
  **tablet-width** capture as CHECK.
- **The email shots show a shell that no longer ships.** `08-34`, `08-36`,
  `08-56`, `08-57`, `08-58`, `08-65`, `08-66` and `08-67` are the
  pre-2026-09-27 design. Every template now renders the solid-tab shell
  (#2754). The 2026-09-25 email re-shoot below captured the intermediate
  centred-masthead design (#2708), which #2754 replaced two days later.
- **The Email Templates banner was reworded on 2026-10-04.** Any frame of the
  **Templates** tab that shows the blue banner at the top — `08-34` certainly,
  and any other email-template shot taken at full height — shows the old
  "press Reset … to adopt it" text. The new text says there is nothing to
  adopt and points to **Previous version**.
- **"Fire Chief" now reads "Chief"** on the seeded position and rank
  (`d4e1a7c93b58`). Any frame that shows the seeded position list, or a member's
  rank, as "Fire Chief" is stale. Frames were not checked one by one for this,
  so none is marked; look for it while re-shooting.
- **Demo data the seeder must gain** for the NEW shots:
  - an outside-department shift and an Outside Apparatus entry (guide 03);
  - an "I was there" request and an event with an alternate organizer
    (guide 04);
  - a room with badge check-in on (guides 04 and 06);
  - a stack of same-category notifications (guide 07);
  - a finance request no approval chain applies to (guide 11);
  - an applicant waiting on a sign-off (guide 15);
  - a Target Solutions provider with a mapped user (guide 16).

  Shoot none of them with real credentials.

**CHECK — open the image and compare; re-shoot only if the named detail is in
frame.**

| Image(s)                                                                         | What may have changed                                                          |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `00-01-login-page`                                                               | Lockout or inactivity copy (#2805)                                             |
| `01-40-member-directory-member`                                                  | Rank column; Member # hidden when nobody is numbered (#2857)                   |
| `03-48-settings-phone`                                                           | Seven tabs, including Outside Apparatus; full phone width (#2749, #2894)       |
| `04-01`, `04-06`, `04-10`, `04-42`, `04-43`                                      | Card sizing; "Going"; "(times edited)" (#2778, #2779, #2880)                   |
| `05-73`, `05-75`, `05-86`                                                        | Inventory copy pass (#2781)                                                    |
| `07-02-new-folder-dialog`                                                        | Alt text corrected (no parent-folder selector); the frame is probably right    |
| `07-08-notification-rules`                                                       | Empty-state and note copy (#2791)                                              |
| `08-02-organization-settings`                                                    | **Remove logo**; phone padding (#2759, #2894)                                  |
| `08-37`                                                                          | A Compliance Officer row on the Officers tab (#2682, #2693)                    |
| `08-60`                                                                          | A notification stack, only if the seed produces one (#2775)                    |
| `10-12-mobile-bottom-nav`                                                        | The Settings tab now opens My Account (#2864)                                  |
| `12-06-application-budget-tab`                                                   | **Add Budget Item**; Match Amount (#2798)                                      |
| `13-03-records-tab`                                                              | "Not linked to a member or prospect" (#2795)                                   |
| `14-06`, `14-07`, `14-17`                                                        | Election copy and W50 labels (#2787, #2848)                                    |
| `18-01`, `18-02`, `19-08-store-admin-activity`                                   | Store copy pass (#2799)                                                        |
| `19-04`, `19-23`                                                                 | Badge check-in switch, if the harness has NFC ID Cards connected (#2868)       |
| `19-09`, `08-78`                                                                 | Legal page intro; **Publish** (#2796)                                          |
| `19-24`                                                                          | Events settings sidebar: the Attendance description (#2865)                    |
| `19-41-my-admin-hours`, Admin Hours Management                                   | Edit and Withdraw on rows; the red selected tab; category badges (#2748, #2752, #2891) |
| `20-13`                                                                          | The ballot link now renders in the applicant drawer (#2652)                    |

**Cannot be produced by the capture harness as it stands:**

- **The room kiosk badge tap.** It needs an NFC reader and a registered card.
  Shoot the "Which event are you here for?" chooser instead; that part is
  reachable by URL.
- **The phone drawer's scroll cue.** It appears only when items sit below the
  fold at a phone height. Set the viewport explicitly.

The per-guide queue follows. Each row is the marker's own text, so the guide
and this file cannot disagree.

### [00 — getting-started](./00-getting-started.md)

| Disposition | Image | What the new frame must show |
| --- | --- | --- |
| **REPLACE** | `00-19-change-password.png` | The requirements list is visible before typing and now has seven rules — "At least 12 characters", the four character classes, "No runs like 123 or abc" and "No character three times in a row". |
| **REPLACE** | `00-09-account-settings.png` | The page title reads **My Account** (was User Settings), and the Appearance tab's description reads "Theme and phone navigation bar". |

### [01 — membership](./01-membership.md)

| Disposition | Image | What the new frame must show |
| --- | --- | --- |
| **REPLACE** | `01-01-member-directory.png` | The table gained a **Rank** column between the name and **Member #** (2026-09-30). Re-shoot as an officer so **Member #** is present, with at least one member whose rank is set. |
| **REPLACE** | `01-05-add-member-form.png` | Four visible changes since the frame was taken: one **Membership Number** field whose hint reads "Leave blank to assign … automatically" (the separate Membership ID override box is gone); the **Status** and **Preferred Contact** controls are gone from Department Information; **Rank** and **Position** each carry a help line under the dropdown; and with **Set initial password** ticked, a password-rules checklist sits under the two password fields. Shoot on a department with auto-numbering on, so the hint shows a real next number. |
| **REPLACE** | `01-08-member-audit-history.png` | Each entry now shows the time beside the date (2026-09-28). Re-shoot filtered to profile updates, on a member with at least two edits on the same day so the times differ. |
| **REPLACE** | `01-26-print-applicant-badges.png` | The bulk buttons were renamed on 2026-09-29 — **Advance Selected**, **Hold Selected**, **Reject Selected** (they act on the selection, not on everyone). Re-shoot the same bar with two applicants selected. |
| **REPLACE** | `01-11-create-waiver.png` | **Applies To** now holds two checkboxes — **Training Requirements** and **Meeting Attendance & Shift Requirements** — where it held three (2026-09-28). Re-shoot the Create Waiver tab with both ticked, so the line under them reads "Creates a leave of absence that automatically generates a training waiver". |
| **REPLACE** | `01-19-create-waiver.png` | Same change as `01-11`: **Applies To** has two checkboxes, not three. Re-shoot with only **Training Requirements** ticked so the frame differs from `01-11` and shows "Creates a standalone training waiver without a leave of absence". |
| **NEW** | — | Members Admin → Settings → Membership IDs with numbering and auto-generation on → the **Year and number** preset applied: Number pattern `{YYYY}-{SEQ}`, Minimum digits 3, **Restart the count each year** on, **The year follows** set to **Our fiscal year** starting in July and named by **The year it ends in**, and the line "The next member will be numbered 2027-001." with "Next: 2027-001" in the panel header. |

### [02 — training](./02-training.md)

| Disposition | Image | What the new frame must show |
| --- | --- | --- |
| **REPLACE** | `02-01-my-training.png` | The subtitle under **My Training** now reads "Every class, certification and training hour the department has on record for you, and how you are doing against the training you are required to complete.", and the third stat card is **Required Training** (not **Requirements**) with a hint line beneath the percentage — "3 of 4 requirements met". Re-shoot the same member and state with those two visible. |
| **NEW** | — | My Training → as a brand-new member with no records and no requirements: the **Required Training** card reading **None assigned**, and the "Nothing is on your training record yet" panel with its three numbered ways, **Submit External Training** and **Take the short walkthrough in the Learning Center**. |
| **NEW** | — | Training Admin → Setup → Requirements → edit a requirement → the **Existing Members** section: the three choices **Apply to everyone**, **Exempt existing members** and **Give a catch-up deadline**, with **Give a catch-up deadline** selected and **Existing members joined before** / **Existing members must meet it by** filled in, and the note beneath them. |
| **NEW** | — | Training Admin → Setup → Requirements → edit a requirement, change its hours, press save → the **Who does this change apply to?** dialog with **New members only** selected, the **New standard applies to members who joined on or after** date showing, and **Keep editing** / **Save for new members**. |
| **REPLACE** | `02-17-officer-dashboard.png` | The subtitle under **Training Officer Dashboard** now reads "Compliance, expiring certifications, hours, and what needs your attention" (was "Aggregated compliance, training, validation, and capacity signals"). Re-shoot the same seeded department; the widgets are otherwise unchanged. |
| **NEW** | — | Training Admin → Dashboard → Overview on a fresh department with one course and nothing else: the **Set up training for your department** guide reading "1 of 3 steps done", step 1 ticked, steps 2–4 with their links, and the **Department Compliance** widget reading **Not set up**. |
| **NEW** | — | `/training/approve/<token>` for a Training event that requires confirmation: **Approve training credit** above the session title, the **Course** / **Event date** / **Approve by** details, the roster table (**Member**, **Check-in**, **Check-out**, **Credited minutes**, **Approved minutes**, **Note**) with one member's approved minutes edited, and **Approve and record**. |
| **REPLACE** | `02-65-print-compliance.png` | The summary tiles now read **Compliant / At Risk / Non-Compliant / Requirements** (were 100% Complete / Partially Complete / Not Started), headers wrap to the full requirement name instead of "ANNUAL MINIM…", unmet cells print **✗** rather than "—", and a legend sits under the table. Re-shoot the same department. |

### [03 — scheduling](./03-scheduling.md)

| Disposition | Image | What the new frame must show |
| --- | --- | --- |
| **REPLACE** | `03-01-scheduling-tabs.png` | The header subtitle under **Shift Scheduling** changed on 2026-09-29 from "Manage schedules, sign up for shifts, and handle trades" to "See the schedule, sign up for shifts, and request swaps and time off". Every desktop shot of the scheduling page carries that line — `03-04`, `03-61` and `03-62` among them; re-shoot them in the same pass. |
| **REPLACE** | `03-05-open-shifts.png` | The tab intro changed on 2026-09-29 from "Browse available shifts … A scheduling officer will review and confirm your signup." to "Shifts with open seats. Sign up for one and it goes straight onto your schedule." Re-shoot Open Shifts as a member with the new intro visible above the list. |
| **REPLACE** | `03-100-open-shifts-member.png` | Shot 2026-09-24, before the 2026-09-29 copy pass: the intro above the list still promises an officer will confirm the signup. Re-shoot the same member view with "Shifts with open seats. Sign up for one and it goes straight onto your schedule." |
| **REPLACE** | `03-105-open-shifts-admin.png` | Same intro change as `03-100`; re-shoot the administrator's view with the new intro. |
| **NEW** | — | My Shifts → Hours as a member → the "Shifts with other departments" card with two entries (one showing a start–end time range, one reading **Not counted** with its reason) and the **Log outside shift** button. |
| **NEW** | — | My Shifts → Hours → Log outside shift → the "Log a shift with another department" dialog with Start and End filled, the **+12 hours** / **+24 hours** buttons, "Counts as 12 hours", and Department and Apparatus chosen. |
| **NEW** | — | Scheduling Admin → Settings → Outside Apparatus → one department with two units, one turned off, and the "Add a department" field. |
| **NEW** | — | Scheduling Reports → Member Hours → scrolled to the "Outside apparatus staffed" table and the "Shifts with other departments" list with a Reject button on a row. |
| **NEW** | — | Shift Check-In at phone width, one hour into a shift → tap Check Out → the "Check out early?" dialog with **Stay checked in** and **Check out now**. |
| **REPLACE** | `03-67-swap-request-dialog.png` | The Open Swap card's subtitle changed on 2026-09-29 from "Any member can pick it up" to "An officer finds cover; it stays yours until then". Re-shoot the dialog with both swap-type cards readable. |
| **REPLACE** | `03-47-settings-desktop.png` | The section list gained a seventh entry, **Outside Apparatus** ("Other departments members ride with"), on 2026-09-27, and General's description now reads "Shift defaults, overtime, and close-out". Re-shoot with all seven sections in the list. |
| **NEW** | — | Scheduling Admin → Settings → Notifications → the "Not in effect yet" notice above the six switches. |
| **REPLACE** | `20-16-scheduling-admin-hub.png` | The Department settings group gained an **Outside Apparatus** card ("Other departments and units members log shifts on") on 2026-09-27, and several card descriptions were reworded on 2026-09-29 (Shift Templates: "Reusable shift setups — hours, crew seats and vehicle"; Shift Patterns: "Repeating rotations, and generating shifts from them"; Who Can Fill What: "Which positions each member is cleared for, and why"). Re-shoot the hub on a department that has scheduled shifts, so the setup guide below is not shown. |
| **NEW** | — | Scheduling Admin hub on a fresh department with no templates → the "Set up scheduling for your department" card reading "0 of 2 required steps done", its three numbered steps with their links, and the × in the corner. |
| **REPLACE** | `03-61-review-queue-batch.png` | The view strip's last segment, **+ New**, became a separate **New report** button beside the strip on 2026-09-28, and the page subtitle now reads "See the schedule, sign up for shifts, and request swaps and time off" (was "Manage schedules, sign up for shifts, and handle trades"). Re-shoot the same selection state. |
| **REPLACE** | `03-62-flagged-queue.png` | Same strip and subtitle change as `03-61`; and the expanded card now shows only the reviewer's comment box, not a second generic red box above it. |
| **NEW** | — | Scheduling → Shift Reports as a member with no reports → the "Shift reports about you" heading and the "No shift reports yet" empty state with its three cards. |
| **NEW** | — | Scheduling → Shift Reports as a training officer → Written by me → "Your reporting summary" with its tiles (including a Drafts to finish → button), the "Reports written per month" chart, and the "Reports you've written (N)" list beginning below. |
| **NEW** | — | Scheduling → Shift Reports at 390 px width as an officer → a report card with its status badges on their own row beneath the member's full name. |

### [04 — events-meetings](./04-events-meetings.md)

| Disposition | Image | What the new frame must show |
| --- | --- | --- |
| **NEW** | — | Events page as a regular member on a department with no upcoming events → the "No upcoming events yet" empty state with its explanation and the "Take the short walkthrough in the Learning Center" link. |
| **REPLACE** | `04-02-event-detail.png` | Taken as an administrator, the page changed twice: the details card gained an **Organized by** row with a **Transfer event** link (2026-10-03), and every card on the page now carries the shared bordered `card` treatment instead of the borderless surface (2026-10-04). Re-shoot an upcoming event with RSVP open so the RSVP controls, the Organized by row and the bordered cards are in frame. |
| **NEW** | — | Event detail as a member, for an event whose check-in window closed today and with no check-in recorded → the "Were you at this event but never checked in?" card with its "I was there" button. |
| **NEW** | — | Event detail as the event's organizer → the Attendance Requests card listing one pending request (name, "Asked …", the reason, "Says they were there from … until …") with Approve and Decline. |
| **REPLACE** | `04-04-event-qr-code.png` | The page's copy was rewritten on 2026-09-29: the line under the title now reads "Members scan this code to check themselves in", and the steps read "Members sign in if they aren't already" and "Members tap Check In to record their attendance". Re-shoot the same open-window state so those lines are in frame. |
| **NEW** | — | Check-In QR Codes (`/locations/qr-codes`) as an administrator with the NFC ID Cards integration on → a room card showing its QR code, **Write NFC tag** and the **Badge check-in** switch. |
| **NEW** | — | A phone after tapping a room tag while two events are in their check-in window in that room → "Which event are you here for?" with both events listed. |
| **REPLACE** | `04-05-create-event.png` | The form gained the **Organizer** (showing "Me (default)") and **Alternate (optional)** pickers with the line "Attendance requests for this event go to the organizer and the alternate." (2026-10-03); the template hint now reads "Pick a template to pre-fill common settings, or start blank."; the check-in window options read "Flexible - Opens before the start, closes when the event ends" etc.; and the attachments note reads "Files can't be attached from the app yet." Re-shoot the full blank create form. |
| **NEW** | — | Event detail as an administrator → the details card's "Organized by" row with the alternate's name and the "Transfer event" link; then the Transfer Event dialog on a recurring event with "This and all future events in the series" selected. |
| **NEW** | — | Manage Events → Event settings → Attendance → the "Attendance requests" block with one select per event type, each on "Default (Secretary)". |
| **REPLACE** | `04-35-recurring-event-form.png` | The note under the recurrence controls now reads "Each occurrence is created as its own event, which you can edit or cancel on its own." (2026-09-29), and the series end date, date-to-skip field and reminder control are now labelled. Re-shoot the same weekly pattern with a series end date. |
| **REPLACE** | `04-08-event-analytics.png` | The subtitle under the page title now reads "Attendance and check-in rates across your events" (2026-09-29). Re-shoot the same date range. |
| **REPLACE** | `04-09-event-templates.png` | The page's description now reads "Save common event settings to reuse when you create an event." (2026-09-29). Re-shoot the same list. |
| **REPLACE** | `04-14-meeting-minutes.png` | The `/minutes` page changed on 2026-09-29 and 2026-10-03: the subtitle reads "Record meetings, write up their minutes, and track action items", the first tile is **Total Meetings**, the search box reads "Search by title, agenda, or notes...", dates read "Thu, Oct 1, 2026 at 7:00 PM", and each meeting card lists its minutes as links with their state. Re-shoot with at least one meeting that has approved minutes and one awaiting approval. |
| **REPLACE** | `04-38-rolling-recurrence.png` | The note under **Rolling 12-month cycle** now reads "New occurrences are added automatically so the series always runs 12 months ahead." (2026-09-29). Re-shoot the same clipped recurrence block. |
| **REPLACE** | `04-39-delete-event-series.png` | The dialog's cancel button now reads **Keep Event** (was **Go Back**) and its warning reads "Permanently delete "…"? Its RSVPs and attendance records are deleted too. You can't undo this." (2026-09-29). Re-shoot with **Delete all events in this series** selected. |

### [05 — inventory](./05-inventory.md)

| Disposition | Image | What the new frame must show |
| --- | --- | --- |
| **REPLACE** | `05-05-item-form-modal.png` | The form gained a help line under **Tracking Type** that follows the choice ("Individual: one record per physical item, such as a radio or an SCBA pack, tracked on its own, usually by serial number." / "Pool: one record for a stock of identical items, such as gloves or T-shirts, counted by quantity and handed out a few at a time."). Re-shoot with an Individual item in a category that requires serial numbers and maintenance, so **Serial # \*** and **Inspection Interval (days) \*** carry their required markers. |
| **REPLACE** | `05-68-equipment-request-states.png` | The status badges and the filter now read **Awaiting review**, **Approved**, **Issued** and **Declined** (was Pending / Approved / Fulfilled / Denied), and the filter starts on **Awaiting review**. Re-shoot with **All** selected so one request in each of Awaiting review, Approved (carrying **Fulfill**) and Issued is in frame. |
| **REPLACE** | `05-57-assign-scan-modal.png` | The dialog's intro now reads "Hand gear to this member. Find each item by scanning its label or typing its name, serial number or barcode, then choose how long they keep it.", and each **Intended duration** option carries a one-line description under its name. Re-shoot **Distribute Items** with two items staged and **Ongoing assignment** chosen, so **Review 2 Items** is enabled; a second frame with no duration chosen would show the "Choose Ongoing assignment or Temporary loan above to continue." line. |
| **REPLACE** | `05-66-my-equipment.png` | The header now carries the line "The department equipment you are responsible for, and your requests for more.", and the third tile reads **Pending requests** (was **Pending**). Re-shoot as an ordinary member holding at least one item, with one open return notice so the tile is non-zero. |
| **REPLACE** | `05-36-storage-areas.png` | Since this was shot the page gained **Scan shelf label**, **Put away**, **Put Away by NFC** and **Print _N_ labels** in its toolbar and a print action on each row (2026-09-24), and its subtitle now reads "Racks, shelves, and bins inside each room. Nest one inside another as needed." Leaf areas no longer show an expand toggle. Re-shoot with one area expanded to its item list. |
| **REPLACE** | `05-87-gear-request-size.png` | The "Your size on file" line now ends "(from your profile).", and a size the department never carries reads **not stocked** rather than **none on hand**. Re-shoot the size step with **XXL** (stocked, none on hand) selected so the new notice box is in frame: "None in XXL on hand right now. — You can still submit the request. The quartermaster will decide whether to reorder, offer a substitute, or decline." |

### [06 — apparatus-facilities](./06-apparatus-facilities.md)

| Disposition | Image | What the new frame must show |
| --- | --- | --- |
| **REPLACE** | `06-01-apparatus-list.png` | The stat tile above the list reads **Maintenance Due** (was "Maint. Due"), and an empty fleet reads "No apparatus have been added yet." Re-shoot the list with the stat tiles in frame. |
| **REPLACE** | `06-03-apparatus-detail.png` | The Overview's dates card is now **Expiration Dates** (was "Important Dates"). Re-shoot the Overview tab with that card in frame; check also that the header's **Edit** / **Archive** buttons sit as they now wrap. |
| **REPLACE** | `06-09-facilities-dashboard.png` | The header button reads **Print Labels** (was "Print Page Labels"), and the facility cards now size by the grid's own width (`card-grid`, 2026-10-03/04), so a laptop frame with the sidebar open shows fewer, wider cards. An empty dashboard reads "No facilities yet. Select Add Facility to add one." Re-shoot at laptop width. |
| **NEW** | — | Signed in as a member, open `/locations/<room id>/check-in` for a room with two events in their check-in window → the "Which event are you here for?" page listing both events. |
| **REPLACE** | `06-28-facility-settings.png` | The subtitle now reads "Choose the types and statuses offered on facility and maintenance record forms.", each list's line says where its values are offered ("Offered …") instead of "Ordered as shown in facility forms.", and the add button names the value ("Add facility type" rather than "Add"). Re-shoot the same frame. |

### [07 — documents-forms](./07-documents-forms.md)

| Disposition | Image | What the new frame must show |
| --- | --- | --- |
| **REPLACE** | `07-01-documents.png` | The page subtitle now reads "SOPs, policies, forms, and other department files in one place" and the fourth total is **Added This Month** (was "This Month") _(#2785)_. Re-take Documents & Files as an administrator with the four totals, the folder cards and the search bar in frame |
| **REPLACE** | `07-03-upload-documents.png` | The file box no longer reads "Drag and drop your file here / or click to browse"; it reads **Choose the file to upload**, and the name field's placeholder is "Optional — uses the file name if left blank" _(#2785)_. Re-take the Upload Document dialog, empty, with the file box and the name, description and folder fields in frame |
| **REPLACE** | `07-04-forms-list.png` | The first tab now reads **Forms** (was "My Forms"), status and category badges are capitalised, and the subtitle reads "Build forms, share them publicly, and send responses to other modules" _(#2789)_. Re-take the Forms tab with at least one published public form and one draft in frame |
| **NEW** | — | A public form at `/f/<slug>` opened in a signed-out browser, for a form whose **Allow submissions without signing in** is off: the **Sign in to submit this form** notice above the first question, naming the department, with its **Sign in** button. |
| **REPLACE** | `07-05-form-sharing.png` | The dialog is now titled **Share Form** (was "Public Sharing Settings"), carries the **Allow submissions without signing in** checkbox under **Public Access**, and its footer reads "Anyone can submit this form without signing in." or "Only signed-in members can submit this form." followed by the globe-icon sentence _(#2789, #2811)_. Re-take it for a published public form with the box ticked, the Public URL and QR code in frame |
| **NEW** | — | Notifications → **My Notifications** with a collapsed stack (for example "3 attendance validations", **Latest:** line, **3 unread** badge and **Mark all read**) above single notifications, then the same stack expanded showing its individual rows. |
| **REPLACE** | `07-10-create-rule-modal.png` | The trigger dropdown now also offers **Equipment Request Update** _(#2767)_, and the note under it reads "To stop it for the whole department, switch off **every** rule for this trigger — any one left on keeps it running. Members set their own email and text preferences separately." _(#2791)_. Re-take Create Notification Rule with **Event Reminder** chosen and that note in frame; never save |
| **REPLACE** | `07-11-new-message-form.png` | The **Persistent** checkbox now reads **Keep in inbox after it is read** _(#2790)_. Re-take New message with the audience and scheduling fields and the four checkboxes in frame; never post |
| **NEW** | — | Communications → **Member Emails & Texts** as an administrator: the **Always sent** cards, then **Members can turn off** with one card's **Require for every member** switch on and badged **Required by your department**, and the top of the **Text messages** section. |
| **NEW** | — | Settings → **Notifications** as a member: **Email Notifications** on, the **Emails you can turn off** list with **Event reminders** switched off, and **Always emailed to you** below it. |
| **REPLACE** | `07-15-suggestion-submit-anonymous.png` | A hint now sits under **Screenshots (optional, up to 5)**: "PNG, JPEG, WebP or GIF, up to 10 MB each. Larger images are scaled down to 2560 pixels on the longest side, and animated GIFs keep only their first frame." _(#2830)_. Same state as before, with that hint in frame |
| **REPLACE** | `07-24-suggestion-notification-rule.png` | Re-shot 2026-09-25, before the rule note's second sentence was reworded to "To stop it for the whole department, switch off **every** rule for this trigger — any one left on keeps it running. Members set their own email and text preferences separately." _(#2791)_. Same state: **Suggestion Submitted** chosen, never saved |

### [08 — admin-reports](./08-admin-reports.md)

| Disposition | Image | What the new frame must show |
| --- | --- | --- |
| **REPLACE** | `08-06-reports.png` | The header subtitle now reads "Run department reports and export them to CSV or PDF", the info panel is titled **How Reports Work**, every card's description is rewritten (see the table above), and on a tablet the grid sizes to its own width — two columns at 1024px with the sidebar open. Capture at laptop width with the **All Reports** filter. |
| **REPLACE** | `08-08-public-portal.png` | The Configuration tab now shows only **Rate Limiting** and the **Security Best Practices** notice (now at AAA contrast, and themed in dark mode) — the Allowed Origins and Caching sections are gone. The disabled banner reads "The portal is disabled. External websites can't read any of your data until you enable it, create an API key, and turn on the fields to share under Data Control." There was never a domain or branding setting; the caption should not promise one. |
| **REPLACE** | `08-56-template-discard.png` | The preview pane shows the retired centred-masthead shell (re-shot 2026-09-25); since 2026-09-27 every template renders in the solid-tab shell — accent tab naming the category, title on a tinted card, white message card, centred footer _(#2754)_. The editor also has no **CSS Styles** box any more. Same state: unsaved edits, **Discard** beside **Save** |
| **REPLACE** | `08-57-template-reset-dialog.png` | The dialog's message now reads "Restores the subject, HTML body, plain-text body, styles and footer choice to the defaults. Your CC/BCC settings are kept. You cannot undo this." _(#2790)_, and the preview behind it is the solid-tab shell _(#2754)_. Same state, never confirmed |
| **NEW** | — | Communications → Email Templates → **Templates**, a template with a backup selected: the **Previous version (before the redesign)** panel above the editor with **Load this wording** and **Show the old wording**, and the solid-tab preview beside it. |
| **REPLACE** | `08-58-template-send-test.png` | The preview pane shows the retired centred-masthead shell (re-shot 2026-09-25); since 2026-09-27 every template renders in the solid-tab shell — accent tab naming the category, title on a tinted card, white message card, centred footer _(#2754)_. Same state: **Send Test to Me** under the preview |
| **REPLACE** | `08-36-template-search.png` | The preview pane shows the retired centred-masthead shell (re-shot 2026-09-25); since 2026-09-27 every template renders in the solid-tab shell — accent tab naming the category, title on a tinted card, white message card, centred footer _(#2754)_. Same state: the list filtered to "welcome" |
| **REPLACE** | `08-34-email-templates.png` | The preview pane shows the retired centred-masthead shell (re-shot 2026-09-25); since 2026-09-27 every template renders in the solid-tab shell — accent tab naming the category, title on a tinted card, white message card, centred footer _(#2754)_. Same state: the categories with **Templates** active. The blue banner above the list also changed _(2026-10-04)_: it now reads "Every email uses the current design, including templates your department had edited — there is nothing to adopt" and points to **Previous version**; the frame shows the old "press Reset … to adopt it" text |
| **REPLACE** | `08-64-email-footers-tab.png` | The tab now opens with the **Department contact details** card, and each footer has separate **Phone**, **Email** and **Website** switches showing the value each would print _(#2760)_. Re-take with the contact card and the first footer's switches in frame; never save |
| **REPLACE** | `08-65-template-footer-selector.png` | The preview pane shows the retired centred-masthead shell (re-shot 2026-09-25); since 2026-09-27 every template renders in the solid-tab shell — accent tab naming the category, title on a tinted card, white message card, centred footer _(#2754)_. Same state: **Closes with** set to Public |
| **REPLACE** | `08-66-template-variable-palette.png` | The preview pane shows the retired centred-masthead shell (re-shot 2026-09-25); since 2026-09-27 every template renders in the solid-tab shell — accent tab naming the category, title on a tinted card, white message card, centred footer _(#2754)_. Same state: the palette expanded |
| **REPLACE** | `08-67-email-preview-design.png` | Shows the retired centred-masthead shell. The frame must show the solid-tab shell _(#2754)_: the **Shift Assignment** preview's accent tab and its right-hand note, the title on the tinted card, the message card, and — once re-taken — the alt and caption should name those instead of "centred masthead and fact panel" |
| **NEW** | — | Settings → Organization → Profile at laptop width, with the **Timezone** select open on the department's zone, beside the department name — the one setting this section asks every administrator to check. |

### [10 — mobile-pwa](./10-mobile-pwa.md)

| Disposition | Image | What the new frame must show |
| --- | --- | --- |
| **NEW** | — | My Account → Appearance on a 390px phone, scrolled to **Phone navigation bar**: the **Left of Add** and **Right of Add** selects (one set to Training), the **Use the default tabs** link, and the bottom bar beneath showing the chosen tab. |
| **NEW** | — | The navigation drawer open on a 390px phone as an officer, with items below the fold: the fade at the bottom edge and the floating **More** chevron. |

### [11 — finance](./11-finance.md)

| Disposition | Image | What the new frame must show |
| --- | --- | --- |
| **REPLACE** | `11-01-finance-dashboard.png` | The header subtitle now reads "Budgets, spending, and requests at a glance"; the Quick Links begin with **Approvals** for a `finance.approve` holder, and the dues link is titled **Dues** ("Track member dues and payments"). Capture as the Treasurer so the Approvals link and the linked Pending Approvals card both show. |
| **REPLACE** | `11-06-approval-chains.png` | The page subtitle now reads "Set who approves purchase requests, expense reports, and check requests", and an expanded chain now carries an **Add step** button, a pencil (**Edit chain**) beside the trash icon in its header, and on each step **Move up** / **Move down**, **Edit step** and **Delete step** controls. Capture one chain expanded with two or three steps, one of them an Email approver. |
| **NEW** | — | Finance → Settings → Approval Chains → expand a chain → **Add step**, with Step type **Approval**, Approver type **Email**, an approver email filled in, the **Allow self-approval by email** box and the **Auto-approve under ($)** field visible, and the help text under Approver type readable. |
| **NEW** | — | Finance → Approvals as the Treasurer, with three or four waiting requests of mixed types (purchase request, expense report, check request) showing the Request, Type, Requested by, Amount, Step and Submitted columns and the Approve / Deny buttons on each row. |
| **NEW** | — | A purchase request detail page in Pending Approval with no approval chain configured, viewed by the Treasurer: the "No approval chain applies to this request. Approve or deny it here." panel with its Approve and Deny buttons, and the approval timeline reading "This request has no approval steps." |
| **REPLACE** | `11-08-create-purchase-request.png` | The subtitle now reads "Saved as a draft. Submit it for approval from the next page.", the budget field is labelled **Budget** (was Budget Category), the description placeholder reads "What you're buying and why", and the button is **Create Request**. |
| **REPLACE** | `11-12-purchase-request-detail.png` | The action buttons read **Submit for Approval** / **Cancel Request**, a pending request now shows the yellow "Waiting on … You can approve or deny this step." panel with **Approve** and **Deny** to a `finance.approve` holder, and a draft's timeline reads "Approval steps are added when you submit this request." Capture a pending request as the Treasurer (not the requester). |
| **REPLACE** | `11-10-create-expense-report.png` | The subtitle now reads "Saved as a draft. Submit it for approval from the next page." and the empty line-item list reads "No line items yet. Use “Add Item” to add each expense."; the expense type list is unchanged. |
| **REPLACE** | `11-14-expense-report-detail.png` | **Submit for Approval** replaces Submit, line items show their expense type by name ("Mileage", not `mileage`), and a pending report shows the Approve / Deny panel to a `finance.approve` holder. |
| **REPLACE** | `11-12-create-check-request.png` | The budget field is labelled **Budget** (was "Budget (Optional)"). |
| **REPLACE** | `11-16-check-request-detail.png` | **Submit for Approval** and **Void Request** replace Submit and Void, and a pending request shows the Approve / Deny panel to a `finance.approve` holder. |

### [12 — grants-fundraising](./12-grants-fundraising.md)

| Disposition | Image | What the new frame must show |
| --- | --- | --- |
| **REPLACE** | `12-03-opportunities.png` | Each opportunity's button now reads **Start Application** (was Apply), and the subtitle reads "Browse grant programs and start an application". |
| **REPLACE** | `12-04-create-application.png` | The subtitle now reads "Only the program name and agency are required. You can add the rest later.", the opportunity field is labelled **Grant Opportunity**, the budget-summary placeholder reads "How the grant money will be spent..." and the contacts placeholder "Names, roles, and phone or email...". |
| **REPLACE** | `12-10-donors.png` | The subtitle now reads "Look up donors and what each has given". |
| **REPLACE** | `12-14-fundraising-reports.png` | The tabs read **Grants** / **Fundraising**, the subtitle "Grant results and fundraising totals for the dates you choose", and the first KPI **Total Raised** (was Total Donations). |

### [13 — medical-screening](./13-medical-screening.md)

| Disposition | Image | What the new frame must show |
| --- | --- | --- |
| **REPLACE** | `13-01-medical-landing.png` | The page subtitle now reads "Set screening requirements, record screenings, and see which ones expire soon." |
| **REPLACE** | `13-05-add-requirement.png` | The submit button reads **Add Requirement** (was Create), and the note under Applies to Roles reads "Not enforced yet — this requirement applies to every active member and prospect, whatever roles you list here." |
| **REPLACE** | `13-07-add-record-linkage-notice.png` | The amber notice is reworded ("Not linked to a member or prospect. You can't choose who a screening is for here, …") and the submit button reads **Add Record** (was Create). |

### [14 — elections](./14-elections.md)

| Disposition | Image | What the new frame must show |
| --- | --- | --- |
| **REPLACE** | `14-01-elections-list.png` | The subtitle under **Elections** now reads "Create elections, send ballots and publish results" for an elections manager ("See elections and their results" for a member); it read "Manage elections and view results" (2026-09-29). Re-shoot the same list as an administrator. |
| **REPLACE** | `19-25-ballot-template-settings-before.png` | **[SCREENSHOT — REPLACE `19-25-ballot-template-settings-before.png` and `19-26-ballot-template-settings-after.png`.** The details card changed on 2026-09-30: **Voting Method** reads "One choice per voter" (before) and "Ranked choice" (after) instead of "Simple Majority" / "Ranked Choice", and a new **Winner** row shows the victory condition — in this example "Supermajority (67% of votes)" on both frames, which is the hazard the paragraph below describes. Re-shoot the same draft before and after applying the template. |
| **REPLACE** | `14-16-election-settings.png` | The **Defaults** section (default voting method, victory condition, anonymity, write-ins) was removed on 2026-09-29 because the create form never read it; its sections are now **Proxy Voting**, **Features**, **Test Ballot** and **Security**. Re-shoot the settings page so its section list no longer shows Defaults, and update the caption, which still says "default rule toggles". |

### [15 — prospective-members](./15-prospective-members.md)

| Disposition | Image | What the new frame must show |
| --- | --- | --- |
| **REPLACE** | `15-04-kanban-board.png` | **[SCREENSHOT — REPLACE `15-04-kanban-board.png` (low priority).** Each card's status badge now shows the label (**Active**, **On Hold**) instead of the raw value ("active", "on hold") — 2026-09-29. The same applies to `15-01`, `15-02-board-truncated` and guide 01's `01-10`; re-shoot them in the same pass. |
| **NEW** | — | Sign-offs page as an officer holding the Chief position → one applicant card on a "Chief and President approval" stage, with the pills reading "Chief: waiting" and "President: signed", and the **Sign as Chief** button. |
| **REPLACE** | `15-09-convert-modal.png` | The frame still shows the Regular Member / Administrative cards and a **Send welcome email with login credentials** checkbox. Step 2 now opens with **Member class** and **Starting status** dropdowns (pre-filled, with the "Pre-filled from this pipeline's conversion settings…" line under them), and the checkbox is replaced by the **How will they get their password?** group of three radio buttons. Re-shoot step 2 for a Regular applicant on a department with email set up, scrolled so the class/status pair and the password group are both in frame. |
| **REPLACE** | `15-10-pipeline-settings.png` | Two changes below the Inactivity Timeout card: a new **When an Applicant Becomes a Member** card (Operational applicants / Administrative applicants, each with **Member class** and **Starting status**, and **Save Conversion Settings**) sits between it and the status-page card (2026-09-30); and the status-page card's copy now reads "Let applicants check their application status through a public link", with help text naming the "Show this stage on the public status page" checkbox and the Enable Status Page stage (2026-09-29). Re-shoot the same full page. |
| **REPLACE** | `15-11-table-bulk-actions.png` | The bar's buttons now read **Advance Selected**, **Hold Selected** and **Reject Selected** (2026-09-29). Re-shoot the same selection in Table view. |
| **NEW** | — | Public Application Status page for an active applicant → the "Withdraw your application?" dialog open over the "No longer interested?" card, Reason filled in, with **Withdraw Application** and **Keep My Application**. |

### [16 — integrations](./16-integrations.md)

| Disposition | Image | What the new frame must show |
| --- | --- | --- |
| **NEW** | — | Training Admin → Setup → Integrations → add a Target Solutions provider: the form with **API Base URL** `https://app.targetsolutions.com/tsapp/api/`, **API Key** and **API Secret \*** filled with placeholder values, and under **Sync Settings** **Enable Auto-Sync** on, **Pull new completions** set to **Every hour** and **Daily 30-day review at** 02:00. Use a demo key, never a real one. |

### [17 — privacy-data-rights](./17-privacy-data-rights.md)

| Disposition | Image | What the new frame must show |
| --- | --- | --- |
| **REPLACE** | `17-04-profile-as-member.png` | Two things in this frame changed on 2026-09-30: the **ID Card** button at the top right is gone (an ordinary member no longer gets a colleague's ID card), and the Contact Information panel now reads "No contact details shared. This member has not added any, or your department keeps them private." Re-shoot the same profile as the same ordinary member. |

### [18 — storefront](./18-storefront.md)

| Disposition | Image | What the new frame must show |
| --- | --- | --- |
| **REPLACE** | `18-03-order-windows.png` | The window row's buttons now read **Open ordering** / **Close ordering** and **Record vendor order** (or **Update vendor order** once recorded); counts read "1 order" / "3 orders" rather than "order(s)". |
| **REPLACE** | `18-04-my-orders-unpaid.png` | The payment line now reads "Include **ORD-…** as the reference on your payment." (was "Reference ORD-… on your payment"), and item counts read "1 item" / "3 items". |
| **REPLACE** | `19-06-store-admin-orders.png` | The export button reads **Export CSV** (was Export), the bulk control **New status for selected orders** (was Bulk status), and rows read "1 item" / "2 items". |

## Needed after the 2026-10-03/04 changes

Nothing was re-shot in this pass — the demo seeder was not run. This is the
list for whoever runs it next.

**New**

| Shot (suggested name) | Guide | What it must show |
| --- | --- | --- |
| `02-xx-requirement-existing-members` | 02 | The requirement form's **Existing Members** section with **Give a catch-up deadline** chosen and both dates filled |
| `02-xx-requirement-change-scope` | 02 | The **who does this change reach** dialog with **New members only** selected and the date field open. Never saved |
| `02-xx-requirement-earlier-standard` | 02 | An older requirement's edit form with the blue _"This is the earlier standard"_ banner |
| `02-xx-program-members-already-enrolled` | 02 | The add-requirement-to-program modal with **Members already enrolled** |
| `05-xx-checklist-unpublished-banner` | 05 | The template builder after editing a live checklist: banner and **Publish now** |
| `05-xx-checklist-readiness-vehicles` | 05 | Readiness panel naming the vehicles reached (and one showing the warning) |
| `05-xx-check-failed-needs-note` | 05 | The check form with a Fail chosen and the note prompt focused, phone width |

**Replace** (the screen changed under the existing shot)

| Shot or area | Why |
| --- | --- |
| `02-16-requirements` | The form gained **Existing Members** |
| Compliance Matrix / print view shots | **Due** status and **N/A** cells; legend text |
| Every phone shot of a **settings** screen (Scheduling, Organization, Events) | Full-width rows, new padding |
| Training Setup and compliance-rules phone shots | Layout, 44px controls, heading levels |
| Event detail and roster (`04-*`) | Bordered cards; 44px roster buttons; red/green fills replaced |
| Member profile sections | Training and Admin Hours cards gained the border |
| Any shot with a **blue** selected tab or filter: Members Admin, Admin Hours, Eligibility Roster, Supply Expiring, My Checklists, Check Log, Compliance Requirements, Elections | Selected state is red now |
| Any iPad shot of a card page | Edit/delete/download controls are now visible on touch |

**Seeder:** `my-checklists` and the check form need a Fail chosen without a
count or reading, or the note prompt will not appear.

## Suggestion boxes re-shot after notifications, history, board and delete, 2026-09-25

The suggestion-box shots in guide 07 predated four changes to those screens:
submission notifications and **Also notify** (#2720), the submitter's status
history and the response to the submitter (#2730, which also carried the idea
board), and deleting a box (#2734). All ten were taken against a freshly
seeded demo department.

| Shot | State |
| ---- | ----- |
| `07-14-suggestion-box-dialog` | **Re-shot.** The dialog now has **Public idea board** (ticked in the frame) and the **Also notify** pickers, so the frame is taller and the caption names both. The image moved up to sit after the setup steps rather than after the new delete paragraph |
| `07-15-suggestion-submit-anonymous`, `07-16-suggestion-follow-up-key` | Re-run; byte-identical, so no change |
| `07-17-suggestion-review` | **Re-shot.** Adds **Response to the submitter**, **Status history** and the **Idea board** section with the published copy |
| `07-18-suggestion-forwarded-to-you` | **Re-shot.** The idea board section reads "Only the box's reviewers can publish it"; the manifest now fails the shot if a forward recipient is offered publishing |
| `07-20-suggestion-status-history` | **New.** The demo member's accepted idea under **My submissions**, its history with the reviewers' response |
| `07-21-suggestion-idea-board` | **New.** Top sort, 3 votes against 1, one voted for and one not — the shot fails if the seed leaves both buttons in the same state |
| `07-22-suggestion-publish-dialog` | **New.** **Edit published copy**, opened and never saved |
| `07-23-suggestion-box-delete-dialog` | **New.** The typed-name dialog with **Archive instead**; the shot fails if **Delete permanently** is enabled before a name is typed. Never confirmed |
| `07-24-suggestion-notification-rule` | **New.** **Create Notification Rule** with **Suggestion Submitted** chosen; never saved |

**Seeder:** Training ideas has the board on (switched on for a box an earlier
seed created without it), the accepted night drill carries a response to its
submitter, two entries are published and the votes are cast. Every step is
safe to re-run.

`07-19-suggestion-review-phone` is still a placeholder, for the reason the full
sweep below records.

## The 17 timed-out shots, re-run one at a time, 2026-09-25

Each of the 17 locator timeouts from the full sweep below was run alone, with
`--only`, against the same demo department.

**Four pass alone — the full run's timing, not drift.** `01-35`, `03-09` and
`20-13` are committed. The `15-09-` prefix also re-ran
`15-09-bulk-action-result`, committed with it: it performs a real bulk advance,
so its counts ("Advanced 2", "Skipped 9") follow the demo's current pipeline.
`01-31-applicant-documents` captures but reads "No documents yet", the seed gap
the 2026-08-25 entry already records, so its committed bytes stand.

**Thirteen failed again, identically, and all thirteen are fixed.** Each was
re-run with a harness copy that saved the page and its accessibility tree at the
moment of failure. Nine were selectors or copy the screen had moved past; three
were demo data the shot depends on and a previous run had used up or never
seeded; one needs an opt-in seed step.

| Shot | Cause | Fix |
| ---- | ----- | --- |
| `03-55-staffing-status-cards` | The week board's chips read "2 open", "Full 4/4", "You + 2/4" or "3 on"; the wait wanted an `n/m` ratio, which only some chips print | Waits for any chip. The guide's table described the retired cards (ratio, CheckCircle2 icon, template-colour overrides) and now lists the board's legend and chip labels, taken from `statusStyles.ts` and `chipLabel` |
| `05-62-generate-variants` | The category `<select>` no longer contains the word "category", and the variants toggle is a `role="switch"` button | Category by its label, preferring Uniforms (Structural PPE sorted first for a polo shirt); the switch by its name; the item name by its label |
| `02-98-requirement-prerequisite` | The phase card is the shared `card` utility, not `rounded-lg border` | Frame selector |
| `00-14-confirm-dialog` | Checklist templates moved from Checklist Settings to the checklists page | Route. The dialog is opened and never confirmed |
| `08-73-template-builder-preview` | At 1440px the preview is a rail beside the builder; the Tools menu's Preview only renders on a narrower canvas | Picks the rail's Crew view tab and frames the rail card. The guide's 2026-08-12 correction ("nothing renders beside the editor") is superseded by a 2026-09-25 one |
| `05-09-receive-stock-modal` | The item picker's result buttons were matched page-wide, and the items list behind the dialog now has a button per row | Scoped to the dialog |
| `15-09-convert-modal` | `/convert/i` matched the board's "Converted" tab before the drawer's Convert button | Scoped to the drawer, exact name |
| `09-18-finish-with-unscored-steps` | The dialog is now "Some steps have no result", offering Keep scoring or Review them, and says the test cannot be submitted until every step has one | Wait text and caption; the guide's two notes are merged into one describing what the dialog says, and "Complete Test" is now "Finish & Review" in both places the guide names it |
| `17-02-download-my-data` | Your Data moved from Account → Security to Account → Privacy | Route, caption, and the guide's step 1 |
| `02-99-member-locked-requirement` | The seeder completed the demo member's Written Exam, which is the gate: a satisfied gate locks nothing | **Seeder:** `_advance_pipeline_progress` no longer completes the demo member's gate requirements. `02-95-knowledge-test-entry`, which needed a scored exam from the same member, now looks up any enrollee whose exam is scored (Saoirse Nolan here). This demo's row was reset with the officer's Reset action |
| `19-07-member-payment-method` | The demo member had no store order: member orders went to the first three non-admin members | **Seeder:** the demo member orders first, and their order is left out of the state spread so it stays unpaid |
| `20-07-applicant-place-on-stage` | Marcus Webb, the one applicant seeded with no stage, had been placed by earlier runs of `15-09-bulk-action-result`, which really advances applicants | None to the shot: on a fresh seed it runs before 15-09. This demo's row was put back |
| `15-02-board-truncated` | Needs a pipeline past the board's 200-card ceiling, which only `seed_demo_data.py --bulk-prospects` creates | Ran that step. The demo pipeline now holds 247 applicants, which buries the named ones, so it is the last prospective-member shot to take on a database |

`20-07` came back byte-identical to its committed image.

## Email templates re-shot on the centred-masthead shell, 2026-09-25

The ten email template screens held back from the full sweep below were
re-captured after migration `f0d76814a9ab` was applied to the demo database.
Nine are committed; `08-37-email-officers` came back identical and keeps its
bytes.

| Image | What changed |
| ----- | ------------ |
| `08-67-email-preview-design` | The preview is the new shell: organization name centred above a white card on a grey page, an accent-barred label in place of the header band, and the facts in a two-column panel rather than a details table. Its caption, the note under it and its manifest alt said "header band and details table" and now say "centred masthead and fact panel" |
| `08-34`, `08-36`, `08-56`, `08-57`, `08-58`, `08-65`, `08-66` | The same shell in their preview panes, and the HTML body now opens with the hidden preheader. `08-34` and `08-36` also list eight Members & Accounts templates rather than seven |
| `08-64-email-footers-tab` | The internal footer carries one line rather than two, and the public footer's count reads 3 templates |

**A second harness leak, fixed in the same change.** The first pass of `08-34`
came back with its **Officers** tab lit: `08-37` had just clicked that tab on the
same reused page, and the pointer stayed over it. `capture.mjs` now moves the
mouse to (0, 0), where a fresh page starts, beside the route reset that closed
the first leak. Re-run in the same order, `08-34` renders with only
**Templates** active. Shots in the 2026-09-25 sweep ran before this fix; any of
them could carry a hover state from the shot before, and none was seen in
review.

## Full sweep, 2026-09-25 — 479 images refreshed, 16 held back, 24 shots that did not run

Every entry in the manifest was re-captured from a freshly seeded demo
department and compared, image by image, with the committed file. The last full
pass was 2026-08-25; a month of seed-data work shows here more than any UI
change does. Screens that used to be photographed empty — medical screening
records, skills test records, the store activity feed, an event's attendance
list, a member profile's certifications — now carry the data their captions
describe.

**The first attempt was discarded, and the harness is fixed (#2719).** Every
admin shot after `08-62-topnav-bell-badge` came back 21px too wide and in the
top-bar layout. `08-62` mocks `/auth/branding`, which is where the navigation
layout has come from since 2026-09-11, and route mocks outlived their shot on
the reused page. `capture.mjs` now drops every route before each shot. None of
that run's images were kept.

### How the 494 changed images were judged

Dimensions first, as the 2026-08-25 entry recommends: every image that shrank
was opened next to its committed version, as were the largest growers and
every shot the capture flagged as an empty state. Most of the empty-state
flags were placeholder text in a form ("No folder", "No preference", "No
personal information") and the images are good.

**Held back — the committed image stands:**

| Image | Why |
| ----- | --- |
| `04-42-cast-ballot`, `14-26-candidates-as-member`, `19-21-candidates-as-member` | The ballot is replaced by "Your meeting attendance is 0.0% … below the 50% minimum required to vote". The voting member has no meeting attendance in the seed, so the frame shows the gate rather than the ballot its caption describes. A seed gap |
| `02-34-shift-report-analytics` | The monthly trend chart, which the text above it describes, is gone: every seeded report now falls in one month. The new rating-scale line is real and will arrive with the next capture |
| `03-97-shift-reminder-expanded` | The expanded reminder reads "No equipment checklists are assigned for this shift"; its caption promises the apparatus checklists |
| `08-34`, `08-36`, `08-37`, `08-56`, `08-57`, `08-58`, `08-64`, `08-65`, `08-66`, `08-67` (the email template screens) | Captured before migration `f0d76814a9ab` (centred-masthead shell) was applied to the demo database, so the stored template bodies are the previous design. They need re-shooting once the demo has been migrated; committing them would picture the retired shell |

**Kept with a real UI change**, among others: `05-02` and `05-53` (items
list split into Available / Unavailable, variants grouped under an expandable
row), `05-85` (label printer picker on the print page), `09-23` and `09-24`
(Not Observed column on the printed scorecard), `15-14` (the drawer's Back
button), `07-16` (the follow-up key panel is narrower), and breadcrumbs above
page titles throughout.

**Filled:** `07-18-suggestion-forwarded-to-you`, the forward recipient's view
of Suggestions → Review, which had been a placeholder in
`07-documents-forms.md`.

### Did not run — the committed bytes stand

A shot that fails never reaches `page.screenshot`, so these are unchanged.

| Shot | Failure |
| ---- | ------- |
| `07-19-suggestion-review-phone`, `03-103-shift-details-modal-phone` | The subject is outside the captured frame: the page scrolls itself (`useScrollDetailIntoView`) after the frame is measured. `07-19` is still a placeholder |
| `04-40-end-event` | No running event has anyone checked in |
| `06-21-apparatus-evoc-level`, `06-23-add-operator-member-picker` | No Intermediate EVOC level is defined in the demo |
| `01-08-member-audit-history` | The page renders "No events match the selected" filter |
| `19-32-notification-after-action` | `New Shift Assignment` matches three notifications; the selector needs narrowing |
| `03-55`, `05-62`, `02-98`, `02-99`, `00-14`, `20-13`, `20-07`, `01-35`, `01-31`, `15-02`, `08-73`, `05-09`, `03-09`, `17-02`, `15-09`, `09-18`, `19-07` | Locator timeouts. Not re-run individually in this pass, so drift and timing are not yet told apart |

### Found, not fixed here

Five pages scroll sideways at the width they are shot:
`08-62-topnav-bell-badge` (the top navigation bar is 21px wider than a 1440px
viewport), `08-06-reports`, `02-65-print-compliance`,
`03-82-call-volume-count-only` and `03-83-call-volume-detailed`. All five have
the same dimensions as their committed images, so the overflow predates this
pass.

## Guide 19 folded into the module guides, 2026-09-25

The August release lesson is now an index too, so its screenshots moved into
the module guides that describe their screens. No image was re-captured; each
keeps its file name, and its manifest entry's `doc` names its new guide.

| Images                                                                                   | Now in                         |
| ---------------------------------------------------------------------------------------- | ------------------------------ |
| `19-31`, `19-32` (notification before and after the action)                              | `00-getting-started.md`        |
| `19-37`, `19-38` (ID cards, check-in station)                                            | `01-membership.md`             |
| `19-29` (training-session linkage)                                                       | `02-training.md`               |
| `19-34`, `19-36`, `19-40` (schedule board, standing shift, seal panel)                   | `03-scheduling.md`             |
| `19-24` (outreach form picker)                                                           | `04-events-meetings.md`        |
| `19-33` (label printers)                                                                 | `05-inventory.md`              |
| `19-04`, `19-05`, `19-23` (QR directory, regenerate warning, crew seats)                 | `06-apparatus-facilities.md`   |
| `19-42` (message page)                                                                   | `07-documents-forms.md`        |
| `19-16`, `19-22`, `19-28`, `19-39`, `19-41` (legal editor, admin-hours summary, My Updates, metrics, My Admin Hours) | `08-admin-reports.md` |
| `19-30` (point deduction)                                                                | `09-skills-testing.md`         |
| `19-11`, `19-35` (dark gutter, board on a phone)                                         | `10-mobile-pwa.md`             |
| `19-25`, `19-26` (saved ballot before and after)                                         | `14-elections.md`              |
| `19-03`, `19-43` (privacy notice, photo-use consent)                                     | `17-privacy-data-rights.md`    |
| `19-06`, `19-07`, `19-08` (store orders, payment method, store activity)                 | `18-storefront.md`             |

`19-01`, `19-09`, `19-10` and `19-27` were already embedded in module guides.

**Not carried over — the module guide already shows the same state:**
`19-12` (03-78), `19-13` (03-79), `19-14` (03-80), `19-15` (10-17), `19-17`
(08-78), `19-18` (17-03), `19-19` (17-04, byte-identical), `19-20` (14-25) and
`19-21` (14-26). Their files and manifest entries stay, pointing at the index,
so nothing that captures them breaks.

**Manifest order.** `19-25`, `19-26` and `19-27` keep `doc` on the index even
though guide 14 shows them: `19-26` and `14-24-ballot-send-skipped` both mutate
the seeded data, and the manifest allows one mutating shot per guide. `19-24`
moved ahead of `04-49-early-checkin-notice` for the same rule; it only reads the
seeded outreach form.

## Guide 20 folded into the module guides, 2026-09-25

The September release lesson is now an index, so its 18 `20-*` images moved
into the module guides that describe their screens. No image was re-captured;
each keeps its file name, and its manifest entry's `doc` now names its new
guide.

| Images                                  | Now in                         |
| --------------------------------------- | ------------------------------ |
| `20-01`–`20-03`, `20-08`–`20-10` (setup wizard) | `08-admin-reports.md` (The setup steps) |
| `20-04` (Navigation Layout), `20-05` (Members Administration → Settings), `20-18` (Test Connection, simulated result) | `08-admin-reports.md` |
| `20-11` (SMTP preset)                   | `08-admin-reports.md` (already there) |
| `20-06`, `20-16`, `20-17` (close-out queue, admin hub, staffing gaps) | `03-scheduling.md` (Scheduling Administration) |
| `20-07`, `20-12`, `20-13`, `20-14` (applicant drawer, stage picker) | `15-prospective-members.md` |
| `20-15` (Suggestions sidebar)           | `00-getting-started.md`        |

`20-05` had been placed only in guide 20. It is kept, beside the narrower
`08-79`, because it is the one frame that shows all five sections of the screen.

The wizard section of `08-admin-reports.md` used to say the wizard could not be
pictured; it now carries the six frames `wizard-walk.mjs` captures against an
empty database, and that note is gone.

## Disposition for September 24-25, 2026 - the Compliance Officer

The Compliance Officer arrived as a seeded position (#2673), an active default
**Compliance** suggestion box it reviews (#2678), an email signature office
(#2682), and a demo holder, Lila Nakamura (#2693). Seven candidate shots were
re-captured from a freshly seeded demo and diffed against the committed images;
one showed the change.

| Image                         | Outcome                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `08-37-email-officers`        | **Re-shot.** New Compliance Officer row with Lila Nakamura assigned, and Signature Variables 48 → 52. Also replaces the older frame in which every office was vacant |
| `07-14-suggestion-box-dialog` | Unchanged. The reviewer-positions list is a scroll box, captured scrolled to the ticked Secretary and Training Officer; Compliance Officer sits above the fold |
| `08-04-role-management`       | Unchanged by this. Compliance Officer is 15th of 31 by priority, below the fold                                                                              |
| `08-57`, `08-65`, `08-66`     | Unchanged by this. The Officer Signature Variables header, whose count moved, is outside the frame                                                            |
| `08-56-template-discard`      | **Corrected 09-25:** this one scrolls down to the HTML body, and the header is in frame. It was judged unaffected from the other three; the 09-25 re-shot below now reads "(52)" |

**Found along the way, re-shot 2026-09-25.** The four template-editor shots and
`08-04` no longer matched the shipped UI for reasons unrelated to this change:
the breadcrumb now sits above the page title rather than beside it, the template
filter pills were restyled, Members & Accounts lists eight templates rather than
seven, and the role cards' "+N more" permission counts moved. All five were
re-shot from a freshly seeded demo on `main` and each checked against its
caption: `08-04-role-management`, `08-56-template-discard`,
`08-57-template-reset-dialog`, `08-65-template-footer-selector`,
`08-66-template-variable-palette`.

## Remaining placeholders, filled 2026-09-24 — 44 down to 0

Every open placeholder in the guides was worked in one pass, and all but one
are shot. Duplicate requests (the same screen asked for in a module guide and a
release lesson) share one image. The tracker moves from 546/590 to **600/600**.
Adding the rewritten Compliance Matrix section in guide 02 is what raised the
total.

| Image(s) | Guides | Notes |
| --- | --- | --- |
| `00-26-sidebar-officer-operations` | 00, 20 | Clipped to the navigation at 1700px so Operations and Administration share a frame |
| `01-40-member-directory-member` | 01 | As `nbelhaj`; no usernames, hire date, actions or selection |
| `01-41-profile-visibility` | 01 | Seeded mix. The department's contact-visibility setting also shows "off for everyone" on three rows, which the caption says |
| `02-66-compliance-matrix` (re-shot) | 02 ×2, 20 | Triage rail via the dashboard deep link. Guide 02's older "grid view" section is rewritten to match |
| `02-106-course-library-member` | 02 | As a member |
| `03-100` / `03-105` Open Shifts | 03, 20 | Member and admin pair, one per signed-in session |
| `03-101-call-types-editor` | 03, 20 | Seeded: Service Call retired. Delete is unavailable on every type with calls; Other has none |
| `03-102` / `03-103` Shift Details | 03, 20 | Laptop and 390px. On a phone the modal opens from the day panel, after tapping a day |
| `03-104-my-shifts-hours` | 03, 20 | Seeded: ten closed-out shifts for the administrator, March–August |
| `04-50-event-attendees-member` | 04, 20 | Seeded: a three-place event, `attendee_visibility: members`, three going and `nbelhaj` waitlisted by the service |
| `05-86` / `05-87` gear request | 05, 20 | Seeded: Structural Coat XXL at 0. L is preselected from her size on file |
| `06-28-facility-settings` | 06, 19 | Laptop width only; the phone layout was optional |
| `08-81`–`08-83` org chart | 08, 19 | Seeded: seven seats, four levels, a shared Deputy Chief seat, a mutual-aid captain with no account. The node modal is the seat editor, opened unsaved |
| `08-84-modules-testing-off` | 08, 19 | **Taken from the demo, not a bootstrap.** Testing is off in the demo department, as on a fresh install; the earlier note assumed the demo turns it on |
| `08-85` / `08-86` testing | 08, 19 | Seeded: two runs (August archived, September current), a failure with a note, a blocked mark, and a member's pass on `/finance` against a denied expectation. The shots turn the module on in `prepare` and off in `cleanup`; the seeder does the same |
| `08-87-dashboard-next-30-days` | 08, 20 | The personal panel, since the two cards sit in different columns at desktop width |
| `10-24` / `10-23` Quick Add | 10, 20 | **A pair, not one frame.** The bottom bar hides while any sheet is open, so the Add button and the sheet never share a frame |
| `16-08` / `16-09` Claude (MCP) | 16, 20 | Connect form opened unsaved. Key panel: connected for the shot and disconnected in `cleanup`, which also revokes any key; the issued key is a route mock showing `lbmcp_DEMO-KEY-not-a-real-credential` |
| `19-42-message-detail` | 19 | Seeded: a four-paragraph department message |
| `19-43-photo-use-consent` | 19 | Seeded: one agreed, one declined, twenty not answered. Captured as the administrator |
| `20-16-scheduling-admin-hub` | 20 | The hub shows **four** headline metrics, not the five the request listed |
| `20-17-staffing-gaps` | 20 | — |

**Two frames the requests described cannot exist.** Testing Home's run picker
is a native select, and an open native dropdown is drawn outside the page, so
`08-85` shows it closed on the current run. The Quick Add sheet hides the bar
that opens it, hence the `10-24` / `10-23` pair.

**Settings → Email, Test Connection with Microsoft 365, is simulated.**
It was left queued at first, because a real success needs a Microsoft 365
tenant. The owner then chose a mocked success with a caption saying so over
an open placeholder. `20-18-email-test-connection` answers only the test
request, with the exact message the backend's SMTP test returns on success
(`SMTP connection successful`). Everything else is the real screen, and nothing
is saved. Guide 20 captions it as simulated, and so does the alt text. That
leaves the tracker at **600/600**.

**Seed fixtures added.** The nine `seed_demo_data.py` steps that produced the
data above run at the end of a normal seed and are idempotent: profile
visibility mix, retired call type, long department message, hours history, org
chart, testing runs, photo consent, waitlisted event and out-of-stock size.

## Disposition for September 15-23, 2026 - two new screens, and a new line on three old ones

Audit: [`CHANGE_AUDIT_2026-09-15_TO_09-23.md`](../CHANGE_AUDIT_2026-09-15_TO_09-23.md).

**Two screens are new** — **Suggestions** (`/suggestions`) and **Suggestion
Box Management** (`/communications/suggestion-boxes`) — and the inventory label
page gained a picker and a post-print prompt. Everything else is an existing
address carrying one more control or one more line.

**Eleven placeholders were written into the guides** by this pass. **All
eleven are shot** (2026-09-24), so the library moves from 533/589 to
**544/589**. Item 9, the installed-app icon, is an illustration rather than a
device capture; its row says why:

| #  | Image area                                                    | Disposition | Guide                                   | Notes                                                                                                              |
| -- | ------------------------------------------------------------- | ----------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1  | Sidebar with **Suggestions** + Suggestions **Submit** tab       | **NEW**     | 20 (release)                            | **Shot** 09-24 as `20-15-suggestions-sidebar-submit`, as `auth: "member"`                                        |
| 2  | **New suggestion box** dialog, filled in                      | **NEW**     | 07 (documents & forms)                  | **Shot** 09-24 as `07-14-suggestion-box-dialog`. Named "Officer development", never saved                         |
| 3  | Suggestions → **Submit** with **Submit anonymously** ticked    | **NEW**     | 07                                      | **Shot** 09-24 as `07-15-suggestion-submit-anonymous`. Attachment drawn in-page; never submitted                   |
| 4  | **Save your follow-up key** receipt                           | **NEW**     | 07                                      | **Shot** 09-24 as `07-16-suggestion-follow-up-key`. The POST is answered by a route mock with a `DEMO-KEY-…` value |
| 5  | Suggestions → **Review**, one submission open                 | **NEW**     | 07                                      | **Shot** 09-24 as `07-17-suggestion-review`, as `auth: "secretary"` on the seeded anonymous submission           |
| 6  | Items list: **Needs a Label** + **All N matching selected**    | **NEW**     | 05 (inventory)                          | **Shot** 09-24 as `05-83-items-select-all-matching` — Structural PPE, 11 items |
| 7  | Label page **Print barcode labels** picker                    | **NEW**     | 05                                      | **Shot** 09-24 as `05-84-label-scope-picker`, clipped to the picker card |
| 8  | "Did the labels print correctly?" prompt                      | **NEW**     | 05                                      | **Shot** 09-24 as `05-85-label-print-confirm`, full page so the preview is in frame. Mark never pressed |
| 9  | Phone home screen with the department-logo icon               | **NEW**     | 10 (mobile)                             | **Shot** 09-24 as `10-22-installed-app-icon`, **an illustration**: no device or emulator here (no KVM). A DEMO-marked crest is uploaded for the shot only and removed by `cleanup`; both icons are fetched from `/api/public/v1/branding/icon/`, and only the home screens around them are drawn |
| 10 | Medical Screening **Add Record** with the amber notice        | **NEW**     | 13 (medical screening)                  | **Shot** 09-24 as `13-07-add-record-linkage-notice`. Dialog opened, never saved |
| 11 | Applicant drawer on an event-naming **Meeting** stage          | **NEW**     | 20                                      | **Shot** 09-24 as `20-14-applicant-meeting-stage-hint`, on the seeded Associate Member Pipeline |

**Existing images this window made stale — REPLACE, no placeholder written.**
None of these was wrong about anything a reader would act on; each was missing
one new element. **All re-shot 2026-09-24**, after the NEW items:

| Image                                                                  | Guide | Why                                                                                                                  | Done |
| ---------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------- | ---- |
| `00-15-sidebar-member.png`                                             | 00    | No **Suggestions** item under Messages                                                                               | **Re-shot** — Suggestions under Messages |
| `00-16-sidebar-admin.png`                                              | 00    | Administration → Forms & Comms has no **Suggestion Boxes** link                                                      | **Re-shot**, and the shot fixed: see below |
| `05-47-items-filter-bar.png`                                           | 05    | The filter bar gained the label-status dropdown (**Any Label Status / Needs a Label / Label Printed**)                | **Re-shot** |
| `05-01-inventory-items.png`, `05-02-items-pinned.png`, `05-03-items-grouped.png` | 05 | Same filter bar, incidentally                                                                                         | **Re-shot** |
| `05-06-item-detail.png`, `05-56-item-barcode-value.png`, `05-61-item-barcode-fields.png`, `05-67-empty-asset-tag.png` | 05 | **Basic Info** gained a **Label Printed** line (date, or **Needs a label**) beneath Asset Tag              | **Re-shot** — each reads **Needs a label** |
| `10-16-mobile-item-detail.png`                                         | 10    | Same new Basic Info line                                                                                            | **Re-shot** |
| `15-14-applicant-drawer-overview.png`, `15-05-applicant-actions.png`    | 15    | **Check, do not assume.** If the pictured applicant is on a meeting stage that names an event, the drawer now shows the requirement hint | **Re-shot.** Tyrell James (Application Received) and Rosa Delgado (Background & Medical): neither stage names an event, so no hint is correct. `20-14` pictures the hint |
| Stage builder → **Meeting** config (queued 09-15, no image yet)         | 15    | The checkbox is now **"Auto-advance when the event's attendance is finalized"**, and the Auto-Link Event Type help text says naming an event makes attendance required | **Shot** as `15-15-meeting-stage-config`, placed under guide 15's stage-settings table; opened unsaved on the seeded Associate Member Pipeline |

**`00-16` had been failing silently.** Its prepare step set the sidebar's
`scrollTop` inside a swallowed `.catch`. After the sidebar's scrolling element
changed, that did nothing, so a fresh capture showed the top of the admin list
with the Members group open and nothing from this window. It now expands
**Forms & Comms**, centres **Suggestion Boxes**, and asserts that link is in
frame.

**Take prospective-member shots without the filler.** The first attempt at
`15-14` and `15-05` ran with the 236 `--bulk-prospects` applicants still in the
demo database. `15-14` opened "Applicant 0237" under a "Showing 200 of 247"
banner. `15-05` found nobody at Background & Medical on page one and timed
out. Today's `15-11` re-shoot after the bulk-bar fix had the same problem. The
filler was removed by email prefix, as `scripts/screenshots/README.md` says to
once `15-02` and `15-09` are taken. All three were then re-shot against the
twelve named applicants.

**No shot needed** for: the pipeline stat-card fix (a wrong number corrected,
not a new layout — `15-12-pipeline-stats.png` stays), hidden form answers (the
fix is the _absence_ of an error), and the dependency bumps.

**Suggestion boxes are seeded** _(2026-09-24)_. `seed_demo_data.py`'s
`suggestion boxes` step creates three boxes and four submissions, one per state
the guides describe:

| Box                     | Anonymity         | Follow-up | Reviewers                     |
| ----------------------- | ----------------- | --------- | ----------------------------- |
| **Training ideas**      | Submitter chooses | On        | Secretary, Training Officer   |
| **Station concerns**    | Always anonymous  | On        | Secretary                     |
| **Apparatus wish list** | Always named      | Off       | Secretary                     |

| Submission (all by Nadia Belhaj, `nbelhaj`)          | State                                                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Night-time vehicle extrication drill                 | Named, **Accepted**, internal note, a reviewer reply and her answer, one screenshot                    |
| More hands-on SCBA time for probationary members     | **Anonymous**, **Under review**, internal note, a reviewer question and the **Anonymous submitter**'s reply, **forwarded to Training Officer** |
| Station 2 bay door sensor keeps sticking             | Always-anonymous box, **New**, untouched                                                                |
| A second thermal imaging camera for Ladder 1         | One-way box, named, **New**                                                                             |

**Which account to shoot from.** The reviewer is the **Secretary** position, held
by `okittredge` — the manifest's existing `auth: "secretary"` account — so item
5's review frame signs in as that. Item 1 is `auth: "member"`
(`nbelhaj`, who sees no Review tab). The administrator deliberately reviews no
box: `suggestions.manage` configures boxes and reads nothing, and a demo in which
the chief could open the concerns box would picture the opposite of the rule.
Item 2's dialog is shot as the administrator.

**Nothing the five suggestion shots do is written.** The box dialog is filled
and never saved; the anonymous submission (item 3) is filled and never sent;
and the follow-up-key receipt (item 4) sends its submission into a route mock
(`beforeNavigate` in `07-16`) that answers with the endpoint's exact response
shape and a visibly fake `DEMO-KEY-…`. That was chosen over the plan this
paragraph used to carry — submitting for real during capture — because a real
submission adds a suggestion to the demo department on every capture run and
puts a real follow-up key, the submitter's only credential, into a public
image. Verified after the run: still three boxes and four submissions.

**Two framings the first capture got wrong, both fixed in the manifest.**
`20-15` landed with the Suggestions item below the fold of the member's menu —
only its active marker's top edge showed — so the entry now scrolls the item
into view and refuses to shoot if it is still off screen. `07-14` clipped to
`[role="dialog"]`, which `Modal` puts on the full-screen backdrop, and so
photographed the whole dimmed page; it now clips to `modal-panel`.

**Item 11 needed a second pipeline** _(2026-09-24)_. The default **Volunteer
Membership Pipeline** has no Meeting stage, so `seed_demo_data.py` now also
seeds a non-default **Associate Member Pipeline** — Interest Form Received →
**Attend a Business Meeting** (Auto-Link Event Type: Business Meeting) →
Committee Approval — with one applicant, **Priya Deshmukh**, parked on the
meeting stage. A separate pipeline rather than a seventh stage on the default,
so the kanban shots built on "seven applicants across six stages" stay true.

**It left one cosmetic drift, now re-shot** _(2026-09-24)_. The board shows its
pipeline dropdown **only when a department has more than one pipeline**, so the
full-page board captures taken before this lacked it, and the pipeline settings
shot listed one pipeline. All seven were re-shot from the same seeded
department: `01-10-prospective-pipeline`, `15-01-pipeline-board`,
`15-02-board-truncated`, `15-04-kanban-board`, `15-10-pipeline-settings`,
`15-11-table-bulk-actions` and `15-12-pipeline-stats`. Drawer-, dialog- and
panel-clipped shots were unaffected and were not touched.

**`15-02` needs `--bulk-prospects`, and that flag was broken.** The filler
advanced every fourth applicant with a bare advance, and the Interview stage
refuses one until an interview exists, so the step 409'd nine applicants into
236 and the board never passed its 200-card ceiling. It now goes through the
same interview-recording helper as the create path and the spread. Run it
**last** and on its own: 236 filler applicants bury the named ones every other
prospective-member shot is built around, so the six other board shots above
were taken first.

**`15-11` showed two bulk bars, and that was the application, not the capture.**
Selecting rows in the table view rendered both the page's bar (Print Badges /
Advance All / Reject All) and the table's own (Advance / Hold / Reject), each
reading "3 selected". Fixed on 2026-09-24: the table no longer draws a bar, and
**Hold All** moved onto the page's bar. `15-11` was re-shot afterwards and
shows one bar with four actions. Both `KNOWN_LIMITATIONS.md` entries for it are
removed.

**Remaining seed gap.** **Every seeded inventory
item reads "Needs a label"**, which is correct for item 6 but means the
**Label Printed** state on the detail page needs one item confirmed by hand.
Do that on a throwaway item, not one another shot depends on.

## Disposition for September 12-15, 2026 - the screens stayed put, their contents did not

Audit: [`CHANGE_AUDIT_2026-09-12_TO_09-15.md`](../CHANGE_AUDIT_2026-09-12_TO_09-15.md).

**No screen was added or retired this window**, so nothing here is a capture of
somewhere new. Every item is the same address showing something different, which
is the disposition that goes stale quietly: an old frame of a screen that still
exists does not announce itself the way a 404 does.

**Six placeholders were written into the guides** by this pass — four in
[`20-september-2026-release-changes.md`](./20-september-2026-release-changes.md),
one in [`03-scheduling.md`](./03-scheduling.md) and one in
[`08-admin-reports.md`](./08-admin-reports.md).

**Four of the six are now shot** — three on 2026-09-16 and the not-elected
drawer on 2026-09-24, by three images; the library stands at **534/578**. Of
the two left, one needs a second signed-in account and one has no placeholder
written yet — see the notes under the table.

| Image area                                     | Disposition | Guide                              | State                                                                                                  |
| ---------------------------------------------- | ----------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Settings -> **Email**, SMTP preset applied      | **REPLACE** | 20 (release), 08 (admin)           | **Shot** 09-16 as `20-11-settings-email-smtp-preset`. One image, placed in both guides                   |
| Stage picker with **Election / Vote** selected  | **NEW**     | 20 (release)                       | **Shot** 09-16 as `20-12-stage-picker-election-vote`                                                    |
| Scheduling -> **Open Shifts**, member vs admin  | **NEW**     | 20 (release), 03 (scheduling)      | **Shot** 09-24 as the pair `03-100-open-shifts-member` / `03-105-open-shifts-admin`; the demo member already sees 27 of the admin's 34   |
| Applicant drawer, **not elected** state         | **NEW**     | 20 (release)                       | **Shot** 09-24 as `20-13-applicant-drawer-not-elected`                                                  |
| Settings -> **Email**, inline refusal           | **NEW**     | no placeholder written yet         | The refusal for an enabled-but-empty Cloudflare section, or for **Not configured** with email enabled   |
| Shift signup **position picker**                | **REPLACE** | no placeholder written yet         | Offers only seats the server will grant                                                                 |
| Stage builder -> **Meeting** config             | **REPLACE** | 15                                 | **Shot** 09-24 as `15-15-meeting-stage-config`                                                          |
| Inventory item -> maintenance history           | **NO SHOT** | n/a                                | The rule changed, the screen did not                                                                     |

### What the two shot images actually show, and why not what was asked for

**The preset list cannot be photographed, and the original placeholder asked for
it.** "Fill in settings for a known provider" is a native `<select>`: the browser
draws its open list as OS chrome, outside the page, so it never appears in a
screenshot at any viewport. The placeholder was rewritten to the subject a
picture can carry — a preset already **applied**, with the credential line naming
the provider and the host, port and encryption it filled in. The twelve names are
prose; the effect is the picture. **Fastmail** is the preset used because its
hint names both an app password and the specific settings path, and because it is
SSL/465 — a preset that left the STARTTLS default in place would picture nothing
happening.

**The stage shot is the dialog, not a save.** The original placeholder said
"saving successfully", which is unphotographable twice over: the dialog closes on
success, and pressing Add Stage would write a seventh stage into the demo
pipeline. What proves the type is creatable is the dialog itself — **Election /
Vote** selected, its configuration revealed, and **Add Stage** enabled with no
validation error. The absence is the subject, so `expect` asserts **Election
Package Contents**: that heading exists only once the type is selected and sits
low in the panel, so it catches both a shot that landed on the default type and
one framed too short to reach the configuration.

**Neither capture writes anything.** Both are local component state until a Save
that is never pressed; the demo pipeline still has six stages and the
organization still stores no `email_service`, verified after the run.

**The stage dialog needs a 2,400px viewport.** Its content is 2,215px tall and
`modal-panel-scroll` caps the panel at 90vh, so at the desktop height the footer
— the enabled Add Stage button, which is the whole point — falls below the
panel's own scroll. The manifest entry carries an explicit `viewport` for that
reason; do not "tidy" it back to the default.

### The not-elected state is seeded now _(2026-09-22)_

`seed_demo_data.py` used to produce only an **Elected** package —
`MEMBERSHIP_VOTE_TALLY` is `(18, 2)`, a pass — so the state this shot is about
had nothing to photograph. **Devon Marsh** is now carried through a 6/14 vote at
a September business meeting, in its own election, and the seeder verifies the
package reads `not_elected` before it finishes.

A rebuild from an empty database leaves all three states on the **Membership
Vote** stage at once, which is what makes them photographable:

| Applicant    | Package       |
| ------------ | ------------- |
| Sam Okafor   | `elected`     |
| Devon Marsh  | `not_elected` |
| Morgan Tran  | `draft`       |

**Shoot Advance, not Convert.** The ELECTION PACKAGE panel renders only while
the applicant is on the vote stage (`isOnElectionStage`), and **Convert** appears
only on the pipeline's *final* stage — Onboarding, one further along. The two
controls cannot share a frame with the panel. Both are gated by the same
`_election_block_reason`, so Advance shows the same refusal; the placeholder in
guide 20 was corrected to say so.

**The stage pinning is load-bearing, not tidiness.** A package belongs to an
applicant, and `_spread_prospects_across_stages` moves applicants back as well
as forward — which had already dragged the *elected* package onto an applicant
at Background & Medical, quietly making guide 01's Elected badge unreproducible.
`SCENARIO_STAGES` pins both. Do not remove it to "simplify the spread".

**The ballot link was missing, and framing this shot is what found it.** The
backend had been sending `election_title`, `election_status` and
`election_end_date` on `GET /prospective-members/prospects/{id}/election-package`
all along, and `ElectionPackageSection` renders them as a link beneath the
banner — but `mapElectionPackageResponse` in the module's `services/api.ts`
copied `election_id` and dropped the other three, so the component's
`election_id && election_title` guard was permanently false. No package named
the ballot that decided it, in any outcome state, and nothing failed: a guard
that renders nothing has no error to report. The first capture pictured exactly
that absence.

The mapper now carries all four, and the shot was re-taken against the fixed
build — the frame includes _Membership Vote — September Business Meeting —
Closed_ under the banner. The manifest entry waits for that link before it
shoots, so the capture fails rather than quietly losing it if the mapping
regresses.

### The Open Shifts pair needs two sessions, not two clips

The member view and the `scheduling.manage` view of `/scheduling?tab=open-shifts`
are the **same URL**. The difference is who is signed in, so this cannot be
captured as two clips of one page the way a tab switch can — it needs two
capture sessions against the seeded department, one as an ordinary member and
one as an officer, and the pair composed afterwards. Caption which is which; a
reader cannot tell from the frame.

**Seed the member with a position that is genuinely narrower than the board.**
A member cleared for every seeded position sees the same list the admin does,
which photographs as "no difference" and argues the opposite of the caption.

### Nothing here is a consequence of the dialog change

A dialog that no longer closes on an outside click is **byte-identical in a
still frame**. No capture in the library is invalidated by it, and no new one
demonstrates it. It belongs in prose and in video, and the release lesson and
the wiki handoff both say so where a reader would otherwise go looking for a
picture.

## Disposition for September 12, 2026 - call tracking became a three-way choice

**Re-shot, so this adds no queue.** `call_tracking.mode` has always had three
values, but the settings control was a two-state switch that could only reach
two of them; it is now a radio group, and `off` is selectable for the first
time.

| Image                                    | Re-shot | What had changed                                                              |
| ---------------------------------------- | ------- | ----------------------------------------------------------------------------- |
| `03-74-settings-call-count-toggle.png`   | 09-12   | The switch became three radio options under a **How calls are recorded** heading |

The id still says "toggle". It is a filename, and renaming it would rewrite
every reference to it here, in guide 03 and in the manifest for no reader's
benefit; the alt text describes what the picture now shows.

**The seeder needed a fix before this could be captured at all**, which is
worth recording because nothing else would have caught it. Since 2026-09-11
`PATCH /scheduling/shifts/{id}/closeout/calls` refuses a count from any mode
but count-only, and `seed_count_only_calls` had always written its history
from the `detailed` default — which is precisely the accident that gate
exists to stop. It now switches the mode for the duration of its writes and
restores it afterwards. Without that, the count-only Call Volume shots have no
data behind them and the seeder reports the failure only in its blocked list,
where a capture run does not look.

## Disposition for September 6-12, 2026 - setup was rebuilt, and one shot broke silently

Audit: [`CHANGE_AUDIT_2026-09-06_TO_09-12.md`](../CHANGE_AUDIT_2026-09-06_TO_09-12.md).

**Nine of these have now been shot** (2026-09-12), taking the library from
518/560 to **527/569**. What remains queued is listed as such below. The
inventory items list is **not** in this window at all -- that was closed by the
September 7-8 disposition immediately below, which re-shot five images, added
two, and verified one.

**The three wizard shots are `capturedElsewhere`.** They are taken by
`scripts/screenshots/wizard-walk.mjs`, not by `capture.mjs`, and the manifest
says so -- see [The wizard cannot be shot by
capture.mjs](#the-wizard-cannot-be-shot-by-capturemjs). `apply_placeholders.py`
only applies shots the capture report marks `ok`, so a `capturedElsewhere`
image has to be placed into the guide by hand, in the applier's own
`![alt](./images/id.png)` form. That is how the `05-7x` inventory-setup shots
got there too.

**Read the fixed shot first.** It is the only item here that was already
producing a wrong image rather than merely lacking one.

### `08-62-topnav-bell-badge` was capturing the wrong navigation

The navigation layout stopped being a per-user `localStorage` preference on
2026-09-11 and became a department setting served by `/auth/branding`.
`AppLayout` seeds its state from `localStorage` and then **overwrites both the
state and the key** with whatever branding returns.

That defeated this shot's prepare step. It wrote `navigationLayout = "top"`,
reloaded, and waited 1800ms -- and the branding fetch resolves well inside that
window and repaints the left sidebar. **The shot still succeeded**, and captured
a left sidebar under the caption "The top navigation bar". Exactly the silent
failure this file exists to catch: nothing errors, and a reviewer glancing at a
correct-looking dashboard has no reason to look twice.

**Fixed in the manifest** by mocking `/auth/branding` in a `beforeNavigate`
hook, layered over the real response so only `navigation_layout` is forced. The
`localStorage` write is kept so the first paint is already right and the capture
cannot catch a sidebar-to-top-bar flip. `capture.mjs`'s own comment about
clearing the key was updated for the same reason -- it now governs only the
first paint.

**Re-shoot `08-62-topnav-bell-badge`** and check the result actually shows the
top bar. **It has not been re-run here** -- capture needs a live app and a
browser, neither of which was available -- so treat the fix as untested until
the next capture run confirms it.

### Everything showing navigation is a judgement call, not a sweep

Tempting to call every full-page capture stale. It is not. The demo department
has no stored layout, `AppLayout` falls back to `left`, and `left` is what the
library has always been shot in. **Those captures are still correct.**

What changed is what they *mean* for a reader on an upgraded installation --
which is the same `left`, so the image still matches. **No bulk re-shoot.** The
one genuine case is `08-62` above, and it is fixed rather than queued.

Caption the layout on any *new* full-page frame, since the department setting
now makes it a department fact rather than a photographer's accident.

### New captures -- the setup wizard

**These cannot be shot against the demo department, and that is a hard
constraint, not a scheduling problem.** The wizard only runs when no department
exists; with one on file `/onboarding` redirects to sign-in. Every other image
in the library needs a department that exists. The two requirements are
mutually exclusive in one run, which is why the library has never held a wizard
capture and why `08-admin-reports.md` says so in prose.

### The wizard cannot be shot by capture.mjs

`wizard-walk.mjs` runs against an **empty** database, before
`bootstrap_demo.py`, and drives the real wizard. It now takes **six** shots, and
three constraints made this harder than "point a capture at a route":

1. **An empty database is not enough for five of the six.** Every shot but
   `20-01` needs a live onboarding *session*. A fresh browser at
   `/onboarding/modules` has none, so the strip resets to "Step 1 of 11" and the
   completed ticks vanish; at `/onboarding/positions` it is redirected to
   `/onboarding/start` outright. The clips are therefore taken **inside** the
   walk's own session, not by revisiting the route afterwards.
2. **The subjects are panels on very tall pages.** Step 4 is ~5,200px and the
   modules step ~3,400px; a `fullPage` shot of either renders its subject as a
   thin band and pictures the position templates or the module grid instead.
   Every one is clipped, and the script asserts on the clip's own text before
   writing.
3. **The order cannot be rearranged.** `20-08` is on the step-1 form, which
   stops existing the moment step 1 is submitted; `20-02` needs steps 1-2
   already ticked; and `20-10` needs the Modules step to have run at all. They
   are taken in the order the wizard reaches them, which is the only order that
   works.

**The serial `POST /onboarding/start` this used to require is gone.** It worked
around ONBOARD-7 -- the wizard's own parallel page load created duplicate
`onboarding_status` rows, and `/onboarding/status` then 500ed permanently, which
killed the run partway through. That is fixed (PR #2500: a unique index plus a
retrying get-or-create), and twenty concurrent starts now yield one row. Issuing
one first is harmless if an older checkout still does it.

| Shot | Status | Notes |
| ---- | ------ | ----- |
| `20-01` `/onboarding/prepare` | **shot** | Both lists in frame; the footer reads "9 of the 11 steps are optional" |
| `20-02` progress strip, mid-flow | **shot** | Clipped. "Step 3 of 11: Modules", steps 1-2 ticked, Modules marked optional |
| `20-03` step 4 rank ladder | **shot** | Clipped to the card: each rank's fillable seats, per-rank Edit, Add Rank |
| `20-08` step 1 member numbering | **shot** | Clipped. Switch on, prefix `FD-`, numbering from 100, both help lines in frame |
| `20-09` step 4 tier ladder | **shot** | Clipped. **Active Member** open -- its three rights plus the automatic-advancement switch |
| `20-10` step 4 permission rows | **shot** | Clipped. "13 modules you did not enable are hidden", six rows, **Show all modules** |

**The permission rows were captured last, and the small module selection is not
staged.** The Modules step enables only the `essential` modules by default, and
`moduleStatuses` is in the onboarding store's persisted allowlist, so it
survives the `page.goto` that reaches step 4. That detail is load-bearing rather
than incidental: `visibleCategoryIds` **fails open** -- an empty answer returns
every category and `hiddenModuleCount` becomes 0 -- so a run that never reached
the Modules step produces no notice to photograph at all, and the frame would
argue the opposite of its caption. The walk asserts the notice is in the clip
for exactly that reason.

**`20-09` opens Active Member, not the first tier.** First is Probationary,
whose rights are all **off** at the shipped defaults. That is accurate, and it
photographs as an empty form -- a reader could reasonably conclude no tier
votes. Active Member is the tier most members hold, its rights are on, and
opening it additionally reveals the **Minimum % / Over the last (months)**
fields, which render only while the attendance threshold is ticked. This is
what keeps the shot from duplicating `08-80`, which pictures the same editor
closed at its Settings address.

**A tier name cannot be asserted from page text.** Tier names live in an
`input`'s `value`, and `innerText` never contains input values -- so a check for
"Active Member" in the clip's text is unsatisfiable by construction, in the
manner of Pitfall #28a. The walk proves the right row opened by reading its own
toggle instead, which reads `Hide` only while that tier is open.

**`20-08` blurs the focus ring before it shoots.** The starting-number box is
filled last and keeps its ring, and a ring in a documentation image reads as
"type here" rather than as a value already set.

**`20-03` does not show a renamed rank**, which the placeholder originally asked
for. The ladder is pictured at its shipped defaults instead: staging a rename
would picture something a reader cannot reproduce, and the controls that make
renaming possible (per-rank **Edit**, the reorder arrows, **Add Rank**) are all
in frame. The caption was changed to match the picture rather than the picture
staged to match the caption.

### New captures -- reachable from the demo department

These need no special environment and can go into the normal run:

| Route | Status | Notes |
| ----- | ------ | ----- |
| `/members/admin/settings/ranks` | **shot** `20-05` | Full screen: all five sections across the top, Operational Ranks open |
| `/members/admin/settings/ranks` | **shot** `08-79` | Clipped to the card, for the admin guide. See the duplicate note below |
| `/members/admin/settings/tiers` | **shot** `08-80` | Ladder, the "decides who votes" warning, the advancement switch |
| `/scheduling/admin/closeout` | **shot** `20-06` | 30 shifts oldest-first; the settings summary reads "Individual call records" |
| Applicant board -> place on a stage | **shot** `20-07` | Clipped to the **Not on a stage** panel. See the seeding note below |
| Settings -> General -> Profile -> **Navigation Layout** | **shot** `20-04` | Clipped to the fieldset, **left** selected -- what every upgraded department sees |
| `/members/admin/settings/evoc` | **queued** | Caption the `apparatus.manage` gate -- the one section `members.manage` will not save |
| `/members/admin/settings/visibility` | **queued, REPLACE** | Same settings, now on the shared settings frame rather than the global settings page |
| `/members/admin/settings/ids` | **queued, REPLACE** | Same |
| Shift panel -> **Calls** log | **queued, REPLACE** | Now hidden unless the department's call-tracking mode has one. An existing frame showing it on a count-only department is fine; one showing it on a department that tracks nothing is wrong |

**Two shots of one route are not two shots of one picture.** `20-05` and
`08-79` first came back **byte-identical** -- 277 KB of duplicate binary for no
added meaning, because both were `fullPage` of `/members/admin/settings/ranks`.
`08-79` is now clipped to the card: the admin guide wants the ladder, the
release lesson wants the five sections around it. Check the md5 when two
entries share a route.

**`20-07` needs the seeder undone for one applicant.** The panel renders only
when `canPlaceOnStage` -- `!applicant.current_stage_id` -- and
`seed_demo_data.py` deliberately places every applicant on a stage ("one
applicant per stage, wrapping"). The board alone can therefore never show it.
One applicant was left unassigned to produce the state; a future capture needs
the same, and `expect` is the panel's own "Not on a stage" rather than the page
heading, which the board satisfies whether or not the subject is on screen.

**The stage list itself cannot be pictured.** It is a native `<select>`, and an
open native dropdown is drawn by the OS outside the page Playwright captures --
the same trap the README records for `<option>` visibility. The caption was
changed to name the picker and the **Place** button, which is the whole control
that can be photographed.

### Registered, and two traps the manifest hit on the way

All nine now have manifest entries. Two things cost a capture round each, and
both are worth knowing before adding the next entry:

- **`selector` resolves with `.first()`, which on a nested-div selector is the
  OUTERMOST match.** `div:has(h2:text-is("Operational Ranks")):has(button:has-text("Add Rank"))`
  matched ten nested divs and clipped to the page wrapper -- a shot that looks
  like a plain full-page capture and betrays nothing. Anchor on a class that
  identifies the card (`div.card:has(...)`), and check the returned box.
- **`expect` is asserted inside the captured frame, so it must name text inside
  the clip.** `08-79` failed on `Operational Ranks` because that string is also
  the section's *tab label*, which sits above the card the shot had deliberately
  cropped out. The check was right and the entry was wrong.

**The thirteen `Screenshot needed` placeholders already in
`20-september-2026-release-changes.md` have no manifest entries either**, and
the September 6-12 section adds seven more. That file reads **0 captured, 20
remaining** and will keep reading zero until the manifest catches up -- it is a
backlog, not a regression, but it is the largest single block of unfilled
placeholders in the library. Two further placeholders were added to
`08-admin-reports.md` for the ranks and tiers sections, taking the library from
42 remaining to **51**.

**Update, 2026-09-13.** The three queued wizard shots above are now taken, which
moves the library to **530 captured, 42 remaining**. The three needed
placeholders written for them first -- they had been tracked here as queued
since the 09-12 pass but never had one, so there was nothing for
`apply_placeholders.py` to fill. Worth knowing for the next one:
`wizard-walk.mjs` writes no capture report, so its shots never appear in
`capture-report.json` and the applier does not see them at all. The report for
them was generated from the manifest, so the alt text and spacing came out of
the same machinery as every other shot rather than being typed by hand.

## Disposition for September 7-8, 2026 - the items list gained pinning and grouping

**Everything this change invalidated has been re-shot, so this section adds no
queue.** It is here because three of those images were already listed further
down as stale and their rows have now been deleted -- the file's own rule -- and
a deletion with no explanation reads like someone quietly dropping the debt.

`/inventory/items` and `/inventory/admin/items` render the same component, so
guide 05's captures of that page were affected by all of it: a **Pinned**
section, a **Group by** control, a **Size** column, and columns that hide when
grouped.

| Image                              | Re-shot | What had changed                                              |
| ---------------------------------- | ------- | ------------------------------------------------------------- |
| `05-01-inventory-items.png`        | 09-08   | Group by control above the table; a pin control on every row  |
| `05-47-items-filter-bar.png`       | 09-08   | Group by sits directly under the filter card                  |
| `05-53-items-grid-lot-stock.png`   | 09-08   | same, in the lot-stock framing                                |
| `05-53-items-variant-capsules.png` | 09-08   | same, in the variant-capsule framing                          |
| `10-05-mobile-inventory.png`       | 09-08   | the phone items list, same controls                           |

**`05-70-inventory-table-mobile.png` was re-shot and came back byte-identical,
so it was never stale.** Worth recording rather than quietly dropping: the
prediction that it had changed was wrong, and the reason is specific. Neither
new control reaches the stacked mobile card — the pin sits in a trailing cell
with no `data-label`, which the `rwd-table` reflow hides, and the **Order** row
exists only in the Pinned table, which that shot does not picture. A phone
capture of the *Available* list is unaffected by either feature.

Two captures were **added** rather than refreshed - `05-02-items-pinned` and
`05-03-items-grouped` - because the guides had no coverage of either feature.

The other eleven manifest entries routed at `/inventory/items` open a modal over
the page and are cropped to it, so they were deliberately left alone: churning
PNGs whose content did not change buries the six that did.

## Disposition for August 31 – September 6, 2026 — two modules changed address

Audit: [`CHANGE_AUDIT_2026-08-31_TO_09-06.md`](../CHANGE_AUDIT_2026-08-31_TO_09-06.md).
Nothing below has been shot yet; this is the queue.

**The manifest was repointed first, and it had to be.** Nineteen `route`
entries still named addresses that stopped resolving on 2026-08-31 —
`/scheduling/equipment-check-templates` and its `/new` and `/${id}` children,
`/scheduling/equipment-check-reports`, `/scheduling/supply/expiring`,
`/scheduling/apparatus-inventory`, and four at `/store/admin`. **A retired route
does not fail the capture**; it falls through the router's catch-all to the
dashboard, and the shot succeeds against the wrong page. That is the same trap
the 2026-09-05 scheduling repoint hit — 22 entries then, this is the set that
pass missed. Verified after the edit by importing the module: 515 entries, zero
remaining stale routes, 11 now pointing into the checklist console.

`/store/admin` still redirects, so those four would have captured correctly —
they are repointed anyway, because a redirect is a fact about today's router and
not something a manifest should depend on.

### Three changes invalidate captures in bulk

These are worth handling as sweeps rather than one image at a time.

1. **Every navigation capture.** Two modules changed address and one changed
   name. The sidebar now carries **My Checklists** and **Fleet Readiness** under
   Operations, an **Inventory Admin** entry where it read "Gear Admin", and a
   **Scheduling** row inside the Administration section. The phone bottom bar
   has an **Add** button in the middle and two configurable slots rather than
   three. These are wrong, not stale — a viewer following one cannot find the
   control.

2. **Every table with a right-aligned column**, across 37 files. Headings that
   sat hard left over right-aligned figures now sit over their own columns.
   Worst affected: the scheduling reports (19 headers), the compliance officer
   dashboard (13), and the finance, grants and inventory tables. **This one is
   dangerous precisely because it is subtle** — a reviewer will not notice a
   stale capture, so work from the list in
   `frontend/src/styles/tableHeaderAlignment.test.ts` rather than by eye.

3. **Anything showing a rank-and-file member's navigation, or the Apparatus
   pages.** `reports.view` and `apparatus.view` were revoked from the seeded
   rank-and-file, so the Administration section and the Apparatus entry are gone
   for a member account. **Caption the capturing account's grants** on every
   re-shoot — the seeder's member and officer fixtures now differ here in ways
   they did not.

### New — screens never captured

| Image area | Note |
| --- | --- |
| `/inventory/admin/checklists` and its four children | The checklist console has never been shot at its own address |
| `/inventory/checklists` (Fleet Readiness) | New crew-facing address |
| `/inventory/checklists/my` (My Checklists) | Replaces the Equipment Checks tab, which no longer exists |
| `/scheduling/admin` hub | Card grid, five headline metrics, Needs attention queue |
| `/scheduling/admin/planning` — staffing gaps | The screen this window was built around |
| `/scheduling/admin/settings/general` → Call types editor | Shoot one type **retired** and the delete control **unavailable** on a type with history — that pair is the lesson |
| `/scheduling/admin/positions` | Renamed from `/scheduling/qualifications` |
| `/inventory/admin/store` on the shared admin frame | The store console gained the header, metrics row and attention queue |
| Integrations → Claude (MCP) connect form | Shoot with the three data switches visibly **off** — that is the shipped default and the point of the shot |
| Integrations → Claude (MCP) service-key panel | The shown-once state. **Redact the key in the capture** |
| Settings → Email, Microsoft 365 with **App registration (OAuth)** selected | Get the App Password option and its dated retirement notice in the same frame |
| Settings → Email, Test Connection result | New control |
| Shift template → equipment checklists picker | New control under the vehicle picker |
| Member profile → profile visibility controls | Five field toggles; shoot a mix of on and off |
| Event detail → who's going + waitlist position | **Shoot the member view, not the organizer view** — what a member can now see is the whole point |
| Phone bottom bar → Quick Add sheet | 390px viewport, member account (officer rows are gated and must not appear) |
| My Shifts → Hours view | Three cards (this month / this year / all time) above the month table |
| Gear request form — product step and size step | Two shots: category filters with one row per product; then the size step with the member's size preselected and an out-of-stock size labelled |
| Inventory Administration → **Department Store** section | The four cards (Store Overview / Catalog / Orders / Payments) that are now the documented way into the store console. `18-storefront.md` sends readers here and nothing in the set shows it |

### Replace — the screen changed under the existing capture

| Image area | Why |
| --- | --- |
| Shift Details | Was a **right-edge drawer**, is now a centred modal — 56rem laptop, 1rem-inset phone. Shoot both widths; the drawer no longer exists |
| Compliance Matrix | The member × requirement **icon grid is gone**; it is a triage rail grouped by standing |
| `/members` as a member | Now "Member Directory" — no usernames, no hire-date column, no Actions column, no bulk selection. Keep the coordinator capture and pair them |
| `/inventory/my-equipment` | "Permanent Assignments" and "Issued Items" are one **Issued to Me** list; four tiles collapse to three |
| Dashboard — timeline card | "Next 7 Days" is **Next 30 Days**; the control reads **All Shifts**, not "Full Schedule" |
| Dashboard — gear widget | Labels are **Issued to me** / **Temporary loans**, and the count now matches the page |
| Dashboard — hours card | The duplicate header chip is gone, and Administrative hours reads a figure rather than "Unavailable" — **three changes in one frame** |
| `03-15-scheduling-settings.png` | Already queued for the shared-settings rebuild; it also needs the new address, `/scheduling/admin/settings/general` |
| Scheduling settings — Equipment section | Four dead settings removed; it is a signpost to Inventory **with no Save button** |
| Documents, empty state as a member | Blank, rather than an upload invitation |
| Events list, empty state as a member | Blank, rather than a create invitation |
| Training Programs as a member | Requirements and Templates tabs gone; the whole tab strip is hidden |
| Course Library as a member | Add / Edit / Delete / Manage classes withheld |
| Any settings screen on a phone | Section pills are 44px now, and the overflow row is a real scroll strip |
| `18-02-store-admin.png` | The console is **Department Store** at `/inventory/admin/store`, not "Store Admin" at `/store/admin`. Title and address are both in frame, so this one capture dates the whole storefront guide. Shoot the Overview tab |

### Do not capture

| Image area | Why |
| --- | --- |
| Equipment check crew **"Sweep"** | **Shipped behind a prop and not switched on for crews.** It is visible only in the template builder's preview. Capturing it as the member experience would document a screen no crew can reach |
| Equipment check **lap** | Still built and unwired; the live check screen renders the previous flat compartment list |
| **Member qualifications** entry | ~~Still no direct entry screen (QUAL-1)~~ — superseded 2026-10-06: the profile's **Qualifications** card and **Members > Administration > Import Qualifications** now exist and can be captured |


## Captured 2026-09-01 — the dashboard timeline at thirty days, and the manifest that pointed at the old heading

Two shots re-taken against the running application:
`03-60-dashboard-my-shifts.png` and `03-62-dashboard-signup-positions.png`.
Both now show the **Next 30 Days** heading and the **All Shifts** control; the
first also shows the footer's "42 more through Sep 30", which the seven-day
card could not have produced.

**The manifest had to be fixed before either could be shot.** Both entries
locate the panel by its heading text — `section.card:has(h3:has-text('Next 7
Days'))` — in a `prepare` locator and again in a `selector`, four live
references that the rename left pointing at nothing. A stale selector here does
not capture the wrong element, it times out at 20s, so the re-capture this
entry was opened for could not have run until the manifest was corrected. The
`alt` mattered too: `apply_placeholders.py` writes each guide's alt from the
manifest, so leaving it stale would have quietly reverted `03-scheduling.md` to
"Next 7 Days" on the next run.

**Budget an hour, and turn the limiter off.** The blocker was not the
environment — database, cache, both servers and a pre-installed Chromium were
all reachable — it was `Throttle`. `seed_demo_data.py` paces itself at ~119s a
batch to stay under the admin password-reset ceiling, because tripping it costs
a 15-minute lockout per account, and a 22-member roster then sleeps through
most of a session. The seeder documents the way out and it works: start the
backend with `RATE_LIMIT_ENABLED=false` and run the seeder with
`SEED_ADMIN_RESET_WINDOW_SECONDS=0`.

Also worth knowing for the next run: read progress from row counts, not the
seeder's log. Python block-buffers to a redirected file, so the log sat at
"count-only calls" long after the run had moved on.

### Still not shot

| Image area | Why |
| --- | --- |
| `03-60-report-used-sheet` | Blocked upstream: "no crewed past shift to file against" — the seeder's platoon-roster and scheduling-request steps report no platoon has members |
| `03-62-flagged-queue` | Same run, `locator.click` timeout — the queue it pictures has nothing in it for the same reason |

Neither is caused by the timeline change; both matched the `--only 03-60,03-62`
prefix filter by coincidence of id.

## Eight unreferenced images, triaged rather than swept (2026-08-31)

Eight PNGs in `images/` were reachable from no guide. "Unreferenced" turned out
to mean five different things, and only a per-file check told them apart — a
markdown-only grep found six of them and called all six orphans, and four of
those were not. Widening the sweep to `manifest.mjs` found the other two.

**Five deleted, three applied.** After this pass every PNG under `images/` is
referenced by a guide, a manifest entry, or both.

| Image | Why it was unreferenced | Done |
| ----- | ----------------------- | ---- |
| `03-94-debug-shift-panel.png` | Taken while diagnosing the crew board; never had a marker. Also predates the 2026-08-23 palette uplift — its Sign Up buttons are still violet | Deleted |
| `10-13-mobile-top-bar.png` | Superseded by `10-13-mobile-header-menu.png`, which is applied at guide 10's phone-header marker. Same subject, and the numbering collision is what hid it | Deleted |
| `08-35-notifications-show-read.png` | Same screen and same state as `08-63-inbox-show-read.png`, which fills the marker this one was written for. Its `holdBack` (the pre-fix `ShiftPosition.FIREFIGHTER` bodies) had cleared on the re-shoot, so it is redundant rather than blocked | Deleted |
| `19-02-minutes-card-counts.png` | Written to replace a guide-04 capture that pictured the zero-count defect. `04-14-meeting-minutes.png` was itself re-shot on 2026-08-17 and already reads "4 attendees / 8 attendees, 2 action items", so the replacement has nothing left to replace | Deleted |
| `08-76-org-dashboard-without-finance.png` | **Half of an applied pair.** The marker asked for the administrator's dashboard *beside* the member's, and the applier consumed that one marker with `08-75` alone — the comparison the marker was about was never in the guide | Applied beside `08-75` in guide 08 |
| `19-01-platoons-permission-error.png` | Applied to guide 19 by `1558c10e8`, then dropped — image and marker both — by the merge in `18bade651` on 2026-08-18. The topic now lives in guide 03's "Who Can See the Platoon Roster", which had no picture of the refusal | Applied in guide 03 |
| `15-06-applicant-drawer.png` | Superseded by `15-14-applicant-drawer-overview.png`, the same drawer over an unfiltered board. `15-06` was shot with "Rivera" typed into the search box, so a column behind it reads "No applicants" | Deleted |
| `02-67-competency-matrix.png` | Held back against a placeholder describing a member-by-competency heat-map. That screen does not exist, the guide was rewritten to say so, and the marker went with it — leaving a correct capture of what the Competency tab actually is, with nothing pointing at it | Applied in guide 02, holdBack dropped |

**The three that were applied are the finding, not the five deletions.** Each was
a verified capture of something a guide claims in prose and could not show, and
each had been *lost* rather than never taken — one to a half-consumed pair
marker, one to a merge resolution, one to a holdBack that outlived the
placeholder it was written against. A sweep that deleted them on the strength of
a `*.md` grep would have thrown away the evidence for three documented
behaviours and left the gaps invisible, because none of those guides carries a
marker any more.

Manifest entries for the deleted shots that had them (`08-35`, `19-02`, `15-06`)
were removed with the files; an entry whose anchor no longer exists can never
apply, so leaving it would have re-shot an orphan on the next capture run. The
three surviving entries now record where their image actually landed — `19-01`'s
`doc` moved to `03-scheduling.md`, `02-67`'s anchor moved to the paragraph it now
sits above, and `08-76` carries a note that it was placed by hand.

**`08-76`'s caption was wrong on first placement, and review caught it.** It
read "a member without `finance.manage`", which is false for a member who lacks
that and holds `fundraising.view` or `events.manage`: `get_main_dashboard_widgets`
gates the finance, fundraising and community blocks independently, and
`DashboardOrganizationWidgets` drops the section only when all three come back
empty. A member holding one of the other two still sees Department pulse, minus
the money cards. The caption and the manifest `alt` now say all three are
withheld — which is what the pictured member actually has.

**Check the whole tree, not just `*.md`.** Six of the eight were referenced from
`scripts/screenshots/manifest.mjs`, which is where a shot's route, auth and
`prepare` steps live. The manifest is the reason a capture is reproducible, so
it is part of "referenced" — and two of the eight were reachable *only* from it,
so a markdown-only sweep does not even find them to ask the question.

---

## Disposition for the 2026-08-24 → 08-31 window (recorded 2026-08-31)

Reason and data-path context in
[`../CHANGE_AUDIT_2026-08-24_TO_31.md`](../CHANGE_AUDIT_2026-08-24_TO_31.md#documentation-and-media-disposition).

**This is a disposition, not a capture pass.** It records what the week's
changes did to the existing library and what new markers were written into the
guides. Nothing below has been shot yet. `status_report.py` counted **530
placeholders, 505 filled, 25 remaining** at the time (533 / 508 / 25 after the
2026-08-31 triage above applied three images already on disk) — the twenty-five are the **sixteen
new markers** written this window plus the nine that were already outstanding.
The library was 514 placeholders before it.

**Two of the sixteen were added late** (`/messages/:id` and
`/communications/photo-use-consent`). Review caught that the audit listed both
as NEW captures while **no guide covered either page**, so no marker existed and
`status_report.py` did not count them — a producer working the queue would have
silently skipped both new surfaces. The release lesson now has a Communications
section, and the markers are real.

### Two changes invalidate captures in bulk rather than one at a time

**1. The equipment check template builder.** Every existing capture of that
screen shows a **metadata sidebar, a three-step progress strip, a "Template
readiness" card and a Quick Add / Bulk Add toggle — none of which exist**. This
is the distinction that matters for scheduling the re-shoot: it is not a
restyle, so a viewer working from an old capture cannot locate the control they
are being told to press. Treat these as **wrong**, ahead of the merely dated.

Two captures are needed, not one. The docked preview and the side-by-side row
controls are a **laptop and tablet** layout; the phone keeps compact rows, the
full-height item editor and a modal preview. A single laptop shot leaves the
phone experience undocumented, and a single phone shot makes the rebuild look
like it did not happen.

**2. ~~Anything showing a member's membership type.~~ — WITHDRAWN 2026-08-31,
before any capture was taken.**

This was written on the assumption that the class/status split surfaced in the
UI. **It does not.** No screen renders `member_class` or `member_status`:
`MemberProfilePage` shows roles and account status, `MembersAdminPage` has
Member / Member # / Roles columns, and both Add Member and Member Admin Edit
still render **a single Membership Type selector** — the pair is derived from
its value. The elections eligibility roster's refusal reason is unchanged too;
it still reads "membership type not eligible … (requires: …; member has: …)".

**Every existing capture of those screens is current.** Had this been actioned
it would have discarded valid images and sent a producer to photograph fields
and columns that do not exist — the more expensive of the two failure
directions, because the shots would have come back looking wrong with nothing
to compare against.

Recorded rather than deleted because the reasoning that produced it is worth
not repeating: a data-model change was assumed to have a UI surface. **The
class/status split is visible to a user in exactly one place — a ballot
recipient list — and nowhere on a member screen.**

### Replace

| Image area | Why |
| --- | --- |
| Equipment check **template builder** — laptop | Rebuilt as one canvas; sidebar, progress strip, readiness card and mode toggle all gone |
| Equipment check **template builder** — phone (390×844) | Compact rows, full-height item editor, blockers in a bottom bar |
| **Compliance requirements configuration** | The non-compliance notification panel now carries a "not yet active" label |
| **Grants** dashboard, campaigns, donors, application detail | Action buttons are hidden for view-only members — **caption the capturing account's grants**, or the shot is unreproducible |
| **Inventory** item detail, return-request review, transfer | "Checkout batch" is Item Distribution; the "Transfer is immediate" checkbox is gone |
| **Store** item detail and sizing request | Embroidery and engraving are separate; the thread swatch appears only on embroidery; sizes sort in garment order |
| **Facility detail → Files** | Folder structure, and a much smaller audience |
| Any **navigation** capture showing Facilities to a regular member | `facilities.view` was revoked from the regular-member and operational-officer positions |

### New markers written into the guides

| Marker | Guide | Note |
| --- | --- | --- |
| Org chart — **outline** view | 08, 19 | Four levels, a shared seat, a non-member holder |
| Org chart — **diagram** view | 08, 19 | **Not interchangeable with the outline.** One capture cannot stand in for both |
| Org chart — **node modal** | 08, 19 | Multi-holder seat + non-member holder + position link. The two things reviewers ask about |
| **`/facilities/settings`** | 06, 19 | Two lookup categories populated so it is not empty |
| Settings → **Modules**, Testing Checklist **off** | 08, 19 | The single most useful capture in this window — it is the answer to "where did /testing go" |
| **Testing Home** with a named run and the run picker | 08, 19 | Current run, one archived predecessor, mixed marks, **one gate mismatch flagged** |
| **Printable testing report** | 08, 19 | A failure carrying a note *and* a gate mismatch, so both report sections have content |

| **`/messages/:id`** | 19 | A message long enough to show the page is not a modal, sender and date visible, breadcrumb in frame |
| **`/communications/photo-use-consent`** | 19 | One consented member, one refused, one with nothing recorded; caption which of the four accepted permissions the capturing account holds |

### Do not capture

| Area | Why |
| --- | --- |
| **Member qualifications entry** | **There is no direct entry screen** — a qualification is written only as a side effect of recording a training record against a course whose **Certifies** field is set. Capture the course's Certifies selector if you need to show the workflow; do not photograph or mock a qualifications panel on the member profile, because none exists |
| Live equipment **check screen** as "new" | The lap is still built and unwired, unchanged by this window. The template builder rebuild is the *authoring* side; the check screen still renders the flat compartment list |

### One capture that cannot be taken honestly, and what to do instead

> **Superseded 2026-09-24.** The demo department has Testing Checklist **off**, so
> `08-84-modules-testing-off` was shot from it directly. The advice below
> assumed otherwise.

The **Modules screen with Testing Checklist off** is the exception worth
planning around: it is only true on a **fresh install or an install that has
just upgraded and not yet re-enabled the module**. The seeded demo environment
turns modules on so the rest of the library can be captured.

Do not toggle the module off, shoot, and toggle it back on in a live demo
database — the marks recorded against it are what make the Testing Home
captures possible, and a half-completed toggle leaves the environment in a
state the next capture pass will not recognise. **Shoot it during a
bootstrap**, before demo seeding runs, or on a throwaway instance.

This is the same class of constraint as the label-printer status line recorded
below: a shot that is trivial to fake and worth nothing faked.

## Repaired 2026-09-01 — 27 of the 35 stale shots, and what actually broke them

The full re-capture left 35 shots unable to reach their screen, all keeping
pre-palette images. 27 are fixed and verified together; the rest are not
selector problems and are listed at the bottom.

"Stale selectors" undersold it. The causes, by frequency:

| Cause | Shots |
| --- | --- |
| wrapper moved to the shared `card` utility | 9 |
| dialog clip: structural form -> `role="dialog"` | 6 |
| dialog *container* now any of three shapes | 3 |
| the email page lost its Preview tab and renamed a button | 2 |
| panel is the `modal-overlay` utility | 2 |
| a heading, a placeholder option, and a print sheet all renamed | 3 |
| strict mode: fifteen matches where one was assumed | 1 |
| an applicant no longer last in a pipeline that gained a stage | 1 |

### There are three dialog shapes now, and guessing does not work

`modal-overlay` (the shared utility, carrying its own fixed positioning),
`role="dialog"` (the shared Modal), and older hand-rolled `fixed inset-0`.
Which one a given dialog uses has to be **probed**: 03-98 and 04-39 are
`role="dialog"`, while 01-29's Change Member Status dialog next door is still
a hand-rolled panel inside `modal-overlay` with no role at all.

So containers got a union of all three — safe, because every lookup beneath
takes `.first()` — and clips were changed one at a time against what each page
renders. A union as a *clip* would match two elements on any page carrying one
of each and fail strict mode, which is why the tempting sweep is the wrong
move.

### Two things that were not shot problems at all

**Guide 08 documented a button that does not exist.** It told readers to switch
to a **Preview** tab and click **Send Test Email to Me**. The tab is gone —
the preview renders beside the editor now — and the control reads **Send Test
to Me**. Corrected in three places.

**`15-02` is not broken.** Its own comment says it needs
`--bulk-prospects`, which the ordinary seed deliberately does not create, and
failing without that flag is the intended behaviour rather than a defect. It is
excluded from the 35 rather than "fixed".

### Selectors that were facts about the feature, not about the markup

`expandFirstReportCard` anchored on `div.rounded-xl > button`. It now matches
the only visible button on that screen whose label carries a duration, because
a report row *has* a duration and its wrapper class is nobody's contract — it
has changed once already. Likewise `01-35` no longer clicks "Riley Bishop": it
finds whoever sits in the pipeline's last stage. Bishop was last when the shot
was written and the pipeline has since gained an **Onboarding** stage, so the
drawer offers Advance where the caption promises Convert. That one would have
pictured the wrong action rather than failing, had the Convert wait not timed
out first.

### The eight left, none of them selector work

`04-42`, `14-24`, `19-27` need an open election with a contested position; the
seeded elections have closed with time. `06-21` and `06-23` need an
Intermediate EVOC level that no longer exists. `01-08` needs audit events
matching its filter. `02-96`'s picker and `15-02` are covered above. These are
fixtures to rebuild, not selectors to repoint.

Image audit clean across 521 images; 281 markdown files, 0 broken links; 514
captured, 0 markers outstanding.

## Captured 2026-08-25 (twenty-third) — the last nine markers, and two more defects

**514 of 514. No markers outstanding.** The nine that arrived with this
release's own guide additions: the schedule board at both widths, the standing
shift dialog, the ID cards panel, the check-in station (shared with guide 10),
metrics settings, the seal panel, and My Admin Hours.

### Two product defects, both found by failing to photograph a feature

**The tamper-seal shortcut had never worked.** `/last-seals` returns a bare
dict keyed by compartment id, so it carries none of the camelCase aliasing the
schema-backed responses get: it answered `seal_number`, the check form types it
`LastSealRecord { sealNumber }`, and the service casts without mapping. Every
lookup was `undefined`, so the tag never prefilled and `canClear` stayed false
at any number a crew typed. The panel told them "No seal recorded at the last
count" over a bag whose seal *had* been recorded, and the one-tap clear — the
reason to read a seal at all — was unreachable. Nothing looked broken; the bag
was simply counted by hand every time. Fixed at the boundary; the service keeps
snake_case, which its own 15 tests assert.

**Requirement progress crashed for anyone who had logged hours.** `func.sum`
returns a `Decimal` on MySQL and the requirement's stored JSON a float, so the
percentage raised `TypeError`. With *no* hours the `or 0` fallback keeps
everything float and it answers normally — so the endpoint worked for every
member it had nothing to report about and 500ed for every member it did. The
first fixture hid this by pointing at a category whose only entry was pending,
returning a tidy 0.0 of 8.

### The seal shot is the one to look at twice

Both bags in one frame: the Drug Bag prefilled `M3-40817` with **Seal intact —
clear 1 check**, the Trauma Bag carrying `M3-41190` with **Record seal** and
"Different from the last count (M3-40822)". Only the *previous* count is
seeded; the mismatching tag is typed during capture, because that is where a
mismatch comes from — a number on a bag, not a value anything stores.

Framed at 1440x2200 with `fullPage: false`. A stitched full-page capture paints
this form's sticky footer at the scroll offset in force, dropping "Overall
Notes" and "Submit Report" across the middle of the checklist; and at 1500 or
1900 the second panel fell behind that footer, which always owns the bottom of
the viewport.

### What the board shot cannot show, and why that is a state

All five chip colours are in one frame — `1 open` amber, `3 open` red,
`Full 3/3` green, `You + 1/4` blue, `0 on` grey — plus the legend, whose
"Crew size not set" entry only renders when an unsized shift exists.

The marker also asks for the claim button, and **no account can produce one**:
not the demo member, not the administrator. Every open seat that month needs a
qualification nobody holds, so each crew renders "these seats need a
qualification you do not hold yet" where the button would be. An earlier
attempt selected a day on the strength of a claim button that merely *existed*
in the DOM, and landed on a panel saying exactly that under a caption promising
the opposite. The guide now names the state beside the image.

Worth someone's attention separately: `ea47d4ab` tightened
`get_eligible_positions` to close an offer bypass, and the seeded department
now has 56 open seats in September that nobody at all may claim.

### Four selectors, four wrong guesses

Every one caught by reading source rather than by a timeout: the station's
target is a native `<select>`; `MonthGrid` renders days as `role="gridcell"`;
there is no "Claim" label, it is "Take a seat on this shift" or "Join this
shift" on an unsized one — which is the grey fixture, so a "Claim" matcher
would have skipped the day that matters.

And one caught only by probing the live page: the board renders its month
**twice**, `PhoneMonth` under `md:hidden` and `MonthGrid` under `md:grid`, with
the phone copy first in the DOM. 62 gridcells, 31 visible. `first().waitFor()`
waits for visibility, so it waited on an element that never becomes visible —
the same trap `clickByName` documents a few hundred lines above it. The
standing-shift helper had the identical bug and passed by accident, its
`.catch()` swallowing a click failure per hidden cell until it reached a real
one.

### Fixture bugs, all mine, all invisible without executing

Seals sent to `/complete` after a create that had already completed the check;
an ID-card guard keyed on `tag_uid`, which `/nfc-tags` never returns (it gives
`uidPreview`, four characters, under `items` not `cards`); a reopen guard
reading `attendance_finalized_at` off a list that carries no such field; a
profile selector reading snake_case off `/compliance/config`, which is
camelCase — while `/users`, in the same method, is snake_case.

That is four instances of one mistake: assuming a response's shape instead of
printing it.

## Re-captured 2026-08-25 — 470 images refreshed, and 35 shots that no longer reach their screen

The pass planned in the entry below. Verified before committing, which is where
most of what follows came from.

**470 images rewritten, 328 of them at identical dimensions** — same layout,
new palette, which is exactly what a colour migration should look like. 31 grew
and 11 shrank; each of the 11 was opened.

### Byte size is the wrong detector; dimensions are the right one

The obvious check — "did the file get much smaller?" — is useless here. The
median re-captured image is **0.35** of its committed size, because `pngquant`
now applies where it did not for many of the originals. On bytes alone, 182 of
302 looked like data loss. On dimensions, 8 did. Anyone repeating this should
compare heights, not bytes.

### Two images were worse, and are restored rather than committed

`01-31-applicant-documents` went from a populated list to "No documents yet",
and `19-08-store-admin-activity` from a full activity feed to "No order updates
were recorded in the last 7 days". Both are seed gaps rather than code changes,
so the committed bytes stand and the gap is recorded here — the rule the
pipeline already carries. The cost is real and worth naming: those two keep the
**old** button colour until their fixtures are fixed, so the palette is not
uniformly migrated.

`19-08`'s cause is worth writing down because it will recur. The storefront
seeder advances order statuses only when they do not already match, so on a
re-seed the orders keep their original timestamps and slide out of the
seven-day activity window. The guard that makes the step idempotent is what
makes the fixture expire.

### One shot was photographing the demo scaffolding

`04-02-event-detail` came back reading "Attendance (0)" with every statistic
zero. It selected its subject with `isUpcoming` — the soonest upcoming event —
which is now permanently the early check-in fixture: 90 minutes out,
`requires_rsvp` false, RSVP cleared on every seed *by design*. A fixture added
for one marker had quietly taken over a shot two guides away. Re-pointed at
`isRsvpOpen`, the property its caption is about, and re-captured: 3333px with
its attendance back. `isUpcoming` now has no callers, and its own docstring had
already warned that the nearest upcoming event is the wrong subject for an RSVP
shot — it burned the RSVP modal shot the same way.

### 35 shots never reached their screen, and that is UI drift, not flake

Re-run individually, they fail identically every time, so these are stale
selectors rather than timing. They cluster on precisely the screens the review
found rewritten last week — the email template editor, the shift-reports tabs,
the training admin pages, the equipment-check builder.

Nothing was overwritten: a shot that fails in `prepare` never reaches
`page.screenshot`, so all 35 keep their committed bytes. **That is the problem,
not the mitigation** — those 35 keep the pre-2026-08-23 button colour while the
470 around them do not, which is the mixed palette this pass set out to remove.
They need their prepare steps repaired against the current DOM, one screen at a
time.

`02-30-shift-reports` shows why the drift is real and not cosmetic: the tab it
lands on is now a six-tab strip (About me / Written by me / Review Queue /
Flagged / Drafts / New) that did not exist when the neighbouring shots were
written. The image itself is good — four pending reports, named, with hours,
calls and competency badges — it is simply half the height it used to be.

### Also found, not fixed here

Election Settings renders **two switches with no visible label**.
`SettingsToggle` puts its `label` prop on `aria-label` only — its own prop
comment says "Required whenever no visible label is tied to the switch" — and
`ElectionsSettingsPage` passes the label while rendering no adjacent text. A
screen-reader user hears "Anonymous voting by default"; a sighted user sees a
bare toggle. `EmailSettingsSection` shows the house pattern: visible title and
description beside the switch, no `label` prop.

Four `audit_baseline.txt` entries no longer flag and are removed, as the audit
asks. No new findings across 512 images; 281 markdown files, 0 broken links.

## Reviewed 2026-08-25 — the primary button changed colour, and 80% of the library predates it

Not a marker pass. A review of what merged in the week to 2026-08-25 turned up
one change that invalidates most of the library at once, and the honest
response was to re-shoot rather than to patch a list of screens.

**`btn-primary` moved to `red-800` app-wide on 2026-08-23**, in `32627ceb`.
`styles/index.css` says why, and says it was deliberately done everywhere at
once: "a primary button that is one red on the store and another everywhere
else reads as two different actions". **408 of the 510 committed images predate
that commit**, so four in five pictured a red the application no longer draws.
`ConfirmDialog.tsx` carried the same `red-600` -> `red-800` change separately,
which put every confirmation dialog in the same position.

Measured, not assumed. `18-01-member-storefront` re-captured against the same
seed:

| | dominant red | height |
| --- | --- | --- |
| committed 2026-08-16 | `(231, 0, 11)` | 1866px |
| re-captured | `(159, 7, 18)` | 1770px |

Colour and layout both. That shot was restored to its committed bytes at the
time and re-taken properly as part of this pass.

Underneath the palette, eight screens were also substantially rewritten in the
same week and gain new content rather than only a new button colour: the email
template editor (10 shots), the equipment-check builder and form with the new
seal panel (5), the inventory admin hub (6), the settings shell and its label
printers section (5), `SubmitTrainingPage`, `StorefrontPage` / `MyOrdersPage`,
`ElectionsSettingsPage` and the label print page.

Two shared-chrome changes worth separating from the noise: `Modal.tsx` gained
the `modal-content` / `modal-footer` class hooks, and `modal-footer` makes
dialog buttons full-width and 44px **on phones** — so mobile dialog shots
change shape and desktop ones move by a few pixels of padding.
`PageTransition.tsx` only touched document titles and changes nothing visible.

### The seeder aborted first, and the guard was the reason

The first seed of this pass failed the scheduling step outright:

    Unable to create assignment. Member is no longer eligible for this shift

`_validate_assignment` reports two sentences from one gate — "eligible for this
shift" when a member may hold no seat at all, and "eligible for the X position"
when they may hold some seat but not that one. `POSITION_NOT_ELIGIBLE` matched
only the second. The first branch arrived on 2026-08-24 in `ea47d4ab`, closing
an eligibility bypass on unscoped shift offers, and the matcher predated it.

`is_expected_seat_refusal`'s own docstring already calls this class of refusal
ordinary — it leaves a shift a seat short, which is what the Open Shifts tab
exists to show — and warns that treating one as fatal "aborted the whole
scheduling step", taking the close-out fixture, the batch report trainee, the
shift reminder inbox and every downstream guide-03 capture with it. That is the
fourth time this failure has arrived by a different door. The matcher now takes
both sentences, and is asserted against both plus three refusals it must not
swallow.

Capturing on the failed seed would have produced exactly the outcome the
discipline warns about: fresh images that are worse than the committed ones
because data is missing rather than because code changed.

### Status

The re-capture itself is running as this is written; its results are recorded
in the entry above this one once the pass has been verified. Verification is
not optional on a change this size and is not a glance at a few images: the
capture report carries a per-shot empty-state, ErrorBoundary, page-error and
horizontal-overflow verdict, every one of the 511 committed images was
snapshotted beforehand for a byte-and-dimension diff, and anything that shrank
by more than 45% gets opened and checked against the API — that is the
signature of a shot that lost its *data*, which no palette change can explain.

## Captured 2026-08-25 (twenty-second) — label printers, and a marker that asked for two incompatible things

`19-33-label-printers`. 505 of 514.

The marker wanted RFC 5737 documentation addresses **and** "a status result
visible on at least one so the reader sees what a healthy answer looks like".
Those cannot both hold, and the reason is a real property of the feature rather
than a fixture shortcoming.

`app/utils/printer_transport.py` refuses any address outside
`LABEL_PRINTER_ALLOWED_NETWORKS` before it opens a socket — loopback,
link-local and reserved ranges are rejected outright, and everything else has
to be inside an operator-listed CIDR. That setting is a **platform** setting
(`app/core/config.py`), deliberately not tenant-managed, so that registering a
printer cannot be turned into an SSRF primitive. **Its default is empty**,
which disables direct network printing entirely. `192.0.2.x` is precisely the
range no operator will ever list.

So a healthy emerald status line is reachable in exactly two ways, and both are
disqualifying: put a routable printer address in a public repository, or mock
the response and photograph a lie.

What was done instead: the shot shows the two registrations, which is the real
part — the ZPL watch-desk printer badged **Default**, the ESC/POS one in the
supply room, the label stock each resolves to (`Zebra 2" x 1"` and
`80mm roll (3.1")`), and the per-printer **Check status** control the section's
"status is per printer" claim is about. The guide gains a paragraph stating the
allowlist, quoting the refusal text verbatim, and quoting the shape of a
healthy line (`model · dpi · firmware`) so the reader knows what to expect
without being shown a fabricated one.

Worth noting on its own: the guide already said "Nothing checks the address
when you save it, so registration will succeed either way and the failure
appears at print or status time" — true, and verified, since both fixtures
registered without complaint. What it did not say is that on a stock install
the failure at status time is *guaranteed* and is not about the printer at all.
That is the first thing to check, and it was missing.

Seeded by `seed_label_printers`, which skips by name and is safe to re-run.

## Found 2026-08-25 — probing the My Admin Hours marker turned up a 500

The twenty-second pass opens on the ten markers that arrived with this
release's own guide additions. Guide 19's *rebuilt My Admin Hours page* marker
asks for "one configured requirement, so the category bars and the
requirement-progress section are both populated", so the first question was
what feeds that section. It is `GET /admin-hours/compliance/{user_id}` — and it
answered 500 for every member except the one asking.

`AdminHoursService.get_user_hours_compliance` loads the target member and then
reads `user.positions` to pick the applicable compliance profiles. The query
carried no eager load, so that read is deferred IO, which under asyncio raises
`MissingGreenlet` instead of emitting a SELECT.

What kept it hidden is worth writing down, because it is the reason a manual
check would have called the endpoint healthy. SQLAlchemy's identity map answers
`select(User).where(id == <me>)` with the `current_user` instance the auth
dependency already loaded **with its positions**, so asking about yourself
never lazy-loads anything. Only a lookup of somebody else reaches a fresh
`User`. The endpoint's permission check exists solely to allow that lookup.

Fixed with `selectinload(UserModel.positions)`, and
`tests/test_admin_hours_compliance_lookup.py` covers it. The tests
`expunge_all()` before calling the service — without that they exercise the
masked path and pass against the unfixed code, which is the trap the endpoint
itself fell into. All three fail with the fix reverted, with the same
`MissingGreenlet`.

No screen calls it for another member yet, so nothing in the guides was
picturing the failure. It is recorded here because the screenshot pass is what
found it.

## Corrected 2026-08-24 — four review findings on #1794, all real

An automated reviewer read the PR and filed four. Every one held up; three were
mine, one was in the committed early-check-in work.

**P1 — the authenticated display endpoint was raising, not answering.**
`can_check_in` was added to `QRCheckInData` as a *required* field. The public
kiosk (`api/public/display.py`) was updated to pass it; the authenticated
`/locations/{id}/display` (`api/v1/endpoints/locations.py`) constructs the same
model field by field and was not — so it raised a `ValidationError` for any
location with an event in its check-in window, which is the only state that
endpoint exists to report. Reproduced by constructing the schema without the
field before touching anything.

Nothing caught it: `test_kiosk_check_in_window.py` covers the *query* that feeds
the loop and stops there, and `test_public_display.py` covers the other
endpoint. `tests/test_location_display_endpoint.py` is new and closes that gap —
3 of its 4 cases fail with the fix reverted. The value is hardcoded `True` for
the same reason `is_valid` is: the service filters on the strict window before
this loop sees an event, and the permissive rule admits everything the strict
one does.

**P2 — `03-84` opened whichever platoon the rotation happened to put first.**
The seeder prepared `existing[0]` of the generated three-day window and the
manifest opened the first shift carrying any platoon; the shot then waits for a
**"Platoon A Roster"** heading. Which platoon lands on day 35 depends on the
rotation offset and therefore on today's date — green on the day it was written
and a timeout on most others, and the two halves could disagree with each other
besides. Both now select platoon A by name.

**P2 — `_open_two_platoon_seats` was subtracting two members per re-seed.** It
freed the last two assignments unconditionally, so six on shift became four,
then two, and each pass raised another leave request. A database meant to be
repairable by re-seeding drifted further from the capture every time. Now
guarded on the roster's own statuses — one `available` and one `on_leave` is the
state the shot needs, so that is what it checks for. Verified by re-seeding and
confirming 6/1/1 holds.

**P2 — `04-49` could be captured exactly once.** The fixture slides its event
back into the early-arrival band on every run but never reset the member's RSVP,
and a second check-in takes the ALREADY_CHECKED_IN path, which returns no notice
at all. The reviewer's mechanism was slightly off — the shot waits on the notice
itself (`role="status"` appears once on that page), so it would have timed out
rather than captured the wrong screen — but the fixture was one-shot either way.
The RSVP is now cleared each run. Verified the hard way: checked the member in
through the API, re-seeded, checked in again, and the notice came back.

**`04-49` is re-committed at a third of its size.** Re-capturing it was how the
fix was proved, and `pngquant` was available here where it was not for the run
that first captured it: 276 KB to 76 KB, same screen. `03-84`/`03-85` were
re-captured too and their content did not change, so the committed bytes stand.

## Captured 2026-08-24 (twenty-first) — the platoon roster, and the last marker closed

`03-84`/`03-85`, opened and checked. **504 filled, 0 remaining** — every
placeholder in the guides now has an image or the prose that replaced it.

**The gap was structural, and it is worth stating plainly.** `Shift.platoon` is
written in exactly one place: the recurring-pattern generator, for a pattern
typed `platoon` whose `schedule_config` names its platoons. Neither
`ShiftCreate` nor `ShiftUpdate` accepts the field. Every seeded shift was made
by hand, so no shift in the demo department had a platoon, so the fill-in /
hold-over roster had nothing to render — for anybody, on any screen. The
department already had three platoons and an A/B/C pattern; the pattern had no
`schedule_config`, which is what makes the generator take its single-track
branch and write ordinary shifts.

**The generator seats the whole platoon, which is a roster with nothing to
say.** Two assignments are removed afterwards, the way a real shift loses them:
one member is booked off with an approved request covering the date, so the
roster reads **On leave**; one is simply free, which is the **Available** row
with the **Assign** button an officer holds someone over with. Six on shift, one
of each — all three states in one frame.

**Generated five weeks out, deliberately.** Every board, dashboard card and
open-shift count the guides already picture reads from the weeks around today.
The roster shot opens its shift by id, so it does not need to be near today at
all, and nothing else moves.

**I broke `03-16` and put it back.** My first version re-dealt the platoon
membership before generating — not realizing `seed_platoons` already assigns it,
idempotently, and that the Platoon Management screen pictures the exact deal.
The columns changed. The tell was almost missed: `/users` does not carry
`platoon` at all, so every member reads `platoon: None` there whatever they are
assigned — the list-shape trap again, and this time it made a populated feature
look unseeded. `/scheduling/platoons/overview` is where the truth is. The deal
is deterministic (`ids[i::3]` over the API's own order), so re-running it
restored the committed image exactly, and the fixture now only reads the
membership it finds.

**Left behind:** one approved time-off request for 2026-09-28 from the
mis-dealt run. It cannot be deleted — the API cancels only your own, and only
before approval — and it is harmless: the member it belongs to is in another
platoon now, and that date's shift is not hers. A fresh seed will not produce
it.

**One selector note.** The shift drawer is `div.drawer-panel`, laid out inside
the page's own `main`. The `div.fixed.inset-0 > div` that the modal shots use
matches nothing on this page.

## Corrected 2026-08-24 — the early-check-in fix, found twice, and what the second copy was good for

Both sessions independently found the same defect within the same hour: the self
check-in page gated its button on a window it computed itself, so a Flexible
event's documented one-hour early-arrival grace had no button to reach it
through, and the notice the marker asks for could not be photographed. The
committed fix and capture (`04-49-early-checkin-notice`) are the other
session's.

**Theirs is the better fix, and specifically here.** I replaced `is_valid` with
the permissive answer; they added `can_check_in` beside it and left `is_valid`
meaning what it meant, which is what the "Check-in Not Available" panel prints
its time range from. They also found the public kiosk endpoint computing the
permissive value under the strict name and fixed that too — a consumer I had not
looked at. Overwriting a field two screens read is the kind of thing that passes
its own test and shows up somewhere else a week later.

**Kept from the duplicate: one test and the prose.** Their two regression tests
cover the grace and the far-before case; neither covers **Strict**, which is the
asymmetry a reader is most likely to get wrong — the same twenty minutes that a
Flexible event admits with a notice is refused outright there. Without it, both
branches of `_validate_check_in_window` are exercised only in the direction that
says yes. The guide had the image and a caption; it now says what the notice is
doing: the time is the organization's timezone rather than the reader's device,
the check-in succeeded, and the grace is exactly an hour.

**Not kept, and recorded rather than pushed:** returning the notice text in the
QR payload so the page can say it _beside the button_ instead of only in the
confirmation afterwards. The other session's fix deliberately discards that
value, and adding a second surface for the same sentence is a design call for
the owner, not something to slip into a screenshot pass.

**One trap worth writing down, from the copy that lost.** `dev_env.sh` runs
uvicorn **without `--reload`**. A backend fix is live in the source and not in
the process, so a probe keeps reporting the old screen and the fix looks wrong.
Restart the stack after touching backend code before concluding anything from a
capture.

**And one that looks like a code failure and is not.** Ten event tests failed on
`Unknown column 'event_rsvps.early_check_in_minutes'`. `conftest.py`'s
`create_all(checkfirst=True)` adds missing tables but never missing columns, and
its docstring names the remedy: drop `intranet_test` and let it rebuild.

## Captured 2026-08-24 — an early check-in the app could not reach, and a product bug fixed to get there

`04-49`, opened and checked. **1 marker remaining.**

**The button was never there to click.** The guide already documents that a
Flexible event admits a tap up to an hour before its official window with an
informational notice — `_validate_check_in_window` genuinely does this. What
had never been exercised through the UI: `EventSelfCheckInPage` gates the
whole "Check In to This Event" button on `qrData.is_valid`, and
`get_qr_check_in_data` computes `is_valid` as the **strict** on-time window
(`check_in_start <= now <= check_in_end`) — no early grace at all. A member
arriving during the exact window the backend was built to admit saw
"Check-in Not Available" and no way past it. The marker could not be captured
as written because the feature it describes was unreachable, not because the
seed data was missing.

**Root cause, not a workaround.** Added `can_check_in` to `QRCheckInData` —
computed with `_validate_check_in_window`, the same permissive check
`self_check_in` itself enforces — and pointed the frontend's button gate at
it instead of `is_valid`, which stays for the "Check-in Not Available" time-
range display it already drove. Found in passing that the public kiosk
endpoint (`app/api/public/display.py`) had _already_ been computing its own
`is_valid` this permissive way, under the strict field name — the two call
sites disagreed on what the same field name meant, which is exactly the
class of bug `can_check_in`'s docstring now heads off by naming both
concepts explicitly.

**Two backend regression tests, two frontend.** `test_qr_data_can_check_in_true_during_flexible_early_grace`
and its false-outside-the-band counterpart in `test_qr_check_in.py`; a
`can_check_in: true` / `is_valid: false` case and updates to the four
existing "outside the window" tests (which needed `can_check_in: false`
added alongside `is_valid: false` — they were about the hard-block case, and
without both flags they'd now exercise the wrong branch) in
`EventSelfCheckInPage.test.tsx`. Also fixed the same tests' silent
dependence on `is_valid` alone, which the fix would otherwise have left
green for the wrong reason.

**Seeded 90 minutes out, the midpoint of the admissible band.** `_validate_check_in_window`
allows 60–120 minutes before a Flexible event's start (60 minutes before the
official window opens, plus one more hour of grace); 90 minutes centers the
capture in that hour so a few minutes' delay between seeding and capture
doesn't fall outside it. Not `requires_rsvp`: `self_check_in` auto-creates
the RSVP on first tap, and requiring one would also require an
`rsvp_deadline` — a validator this fixture found the hard way, with a first
`POST /events` returning a generic 422 until the actual constraint was read
from `EventCreate.validate_dates`.

## Corrected 2026-08-24 — two sessions filled the same two markers, and what survived from the losing copy

Guide 19's deduct-mode marker and guide 09's candidate-scorecard marker were
each captured twice, in parallel, by two sessions working this branch. The other
session's captures are the ones in the repository (`19-30-skill-point-deduction`,
`09-24-scorecard-print-candidate`); this entry records what the duplicate work
was worth keeping and what was thrown away.

**Discarded, because the committed capture is at least as good.** A second
deduct-mode fixture, built by adding one deduct criterion to the existing
weighted sheet rather than seeding a fourth template. Cheaper on demo data, and
framed on the score panel alone; but the committed shot carries the result
banner, so "passed" is visible in the picture rather than inferred from
"Passing mark is 70% — met". Two deduct fixtures would have been worse than
either. The redundant seeder fixture, template criterion and capture were
dropped rather than merged.

**Kept: three shots that were selecting their record by luck.** `09-23` and
`09-24` are a pair — the same result under two accounts — and both matched
"any validated pass"; `09-15` matched "any pass under 100". The deduction
fixture gave all three a second candidate to choose from, and on this database
the unpinned matcher already resolved to it: `09-23` would have opened Emeka
Adeyemi's 90% record while `09-24`, which can only see the demo member's own
tests, opened Nadia Belhaj's 78% — a pair captioned as one record and showing
two. All three are now pinned to the 78% fixture that `seed_scored_test` fixes
and comments.

**Kept: the outreach form must not be answered by the form-submission seeder.**
The other session fixed the `phone` field type that made those submissions fail
(theirs is the better fix — an entry in the answer pool rather than a special
case). But the generated outreach form carries an `event_request` integration:
answering it four times opens four public event requests, on a queue the events
step seeds deliberately with one, and `19-24`'s caption reads "0 submissions".
Forms carrying an integration are now skipped entirely. Verified after a full
re-seed: one request, from Dana Whitmore, and the form still at zero.

**Kept: the guide-19 deduction section, rewritten around the committed
fixture's numbers.** The marker had been closed with an image and a caption; the
three rules that make the arithmetic legible were not written down anywhere —
a deducting step does not enlarge the point pool, an unscored step is never
charged, and the percentage clamps at zero while still listing every penalty.
All three are in `build_score_breakdown`.

**Also corrected:** `09-23`'s caption claimed "one failed step", which that
print does not show — a non-critical `score` criterion is reported as its
number, so the step reads "5 / 10" and the section tally counts it as neither
passed nor failed. The caption now says what the image says. (A deduct-mode
failure _is_ printed as `FAIL −10`; the two behave differently, which is worth
knowing before reading a printed sheet for failures.)

**Process note.** Both sessions also independently fixed the same two
scheduling-seed refusals within the same hour. Duplicated work is the cost of
two sessions on one branch; the guard against wasted effort is reading the
other side before committing, not assuming your own copy is the one to keep.

## Captured 2026-08-24 — a validation prompt, before and after the action that clears it

`19-31`, `19-32`, opened and checked. **2 markers remaining.**

**Triggered for real, not seeded pre-formed.** `event_validation` notifications
are written only by the `post_event_validation` scheduled task, which looks at
events that ended in the last two hours. Seeded a training event ending 45
minutes ago and called `POST /scheduled/run-task?task=post_event_validation`
directly — the same manual-trigger endpoint the seeder already uses for shift
reminders — rather than waiting for the cron tick, which a capture run cannot
do. Slides forward and clears `custom_fields` on every re-seed, the same
pattern `seed_guest_check_in_event` already uses, so a capture run that
already finalized this fixture gets a fresh "before" state rather than a
closed window.

**The pair's second half is a real mutation, and it is deliberately not
`mutatesSeedData`.** That flag would force `19-32` to be the last shot of
guide 19, and `19-26` already holds that position for unrelated election
data with its own ordering dependencies (`openBylawDraft`, the four-item
ballot). Placed `19-31`/`19-32` earlier in the array instead, which the
guard's actual rule permits — it only refuses a _later_ entry in the same
doc once a mutator is found, and nothing after `19-32` (specifically:
`19-25`, `19-26`, and nothing else in guide 19) reads event or notification
state. The mutation itself calls `POST /events/{id}/finalize-attendance` —
the same endpoint the app's own End Event flow uses, and the one that runs
`archive_related_notifications` — so the capture exercises the real
completion path, not a shortcut around it.

**Verified the count, not just presence.** `19-31`'s badge reads 7 unread;
`19-32`'s reads 6. One notification gone, matching what the caption claims —
checked by comparing the two images side by side rather than assuming the
archive worked because the API call returned 200.

## Captured 2026-08-24 — a deduct-mode step, on a sheet built to carry one

`19-30`, opened and checked. **3 markers remaining.**

**No seeded template used `score_mode: "deduct"`.** Of the three modes a
pass/fail-judged criterion can carry — `none`, `points`, `deduct` — every
existing sheet used only the first two, so the guide's claim that a failed
step can cost fixed points without failing the whole test had nothing to
photograph. Deliberately not added to the weighted sheet
(`Handline Advance — Weighted Evaluation`): that template backs `09-22`,
`09-23` and the candidate-disclosure pair two entries back, and a fourth
criterion appearing there unexplained would raise more questions than the
caption answers. A new template, `Ladder Raise — Point Deductions`, carries
exactly one deduct-mode step for exactly this shot.

**Checked against the API's own arithmetic, not paraphrased from the UI.**
`GET .../tests/{id}` for the seeded result returns
`earned: 47, available: 50, deducted: 10, percentage: 74, passing_percentage: 70,
meets_threshold: true, critical_failures: []` — confirming both halves of the
claim before the screenshot was taken: the deduction lands (net points drop
by exactly 10) and it does not force a fail (critical_failures is empty, the
result is `pass`). The score-breakdown panel's own "How this score was
calculated" line — "47 of 50 points earned, −10 deducted = 74%. Passing mark
is 70% — met." — states the configured pass rule the marker asks the caption
to name.

**Officer scoring view, not the print page.** `ScoreBreakdownPanel` renders
deductions as their own line, itemized under the section they came from — the
print page shows per-step marks but not this breakdown, so `/test/{id}/active`
is the only screen that carries the arithmetic.

**A fixed action bar duplicated across the page on the first attempt.** A
`fullPage` capture of this route repeats a bottom "Back to Tests" bar mid-page,
overlapping the Raise section it is meant to sit beneath — the same fixed-
element artifact this pipeline has hit before, just not on this route yet.
Everything the caption needs sits inside the first viewport, so this shot is
not `fullPage`, and the bar renders once, correctly anchored at the bottom.

## Resolved 2026-08-24 — the export field diff that has no screen to picture it

Guide 17's personal-export marker, answered in prose. **4 markers remaining.**

**A download is not a screen.** "Download my data" hands the browser a JSON
file directly; nothing in the app renders it, so no screenshot of the export
itself can exist — the same class of marker as the terminal-output one two
entries back, resolved the same way: call the real endpoint, quote the real
response, redact what needs redacting.

**Called for real, twice, against the fixture `_ensure_demo_member_report`
seeds** (previous entry). `GET /users/me/data-export` before and after
disabling the five trainee-visibility toggles in Training settings
(`show_officer_narrative`, `show_performance_rating`, `show_areas_of_strength`,
`show_areas_for_improvement`, `show_skills_observed`), diffed, restored to
their prior values afterward so no other capture is left running with the
department's evaluation results hidden from every trainee.

**The diff is field removal, not blanking.** Five keys disappear entirely —
they are not present with a null or empty value — while every ordinary
completion fact (date, hours, call count and types, tasks performed, review
status) is identical in both. That distinction is what the guide's "ordinary
completion facts remain exportable" edge case claims, and now the guide shows
it verified rather than asserted.

**Narrative text redacted, structure and counts real.** The seeded record's
`performance_rating: 4`, its two `skills_observed` entries and one
`tasks_performed` entry are the actual shapes the endpoint returned; only the
free-text values inside them read `[redacted]`, per the marker's own
instruction.

## Captured 2026-08-24 (twentieth) — a mandatory event's default, a template's own, and who an open house brought in

`04-46`, `04-47`, `04-48`, opened and checked. **5 markers remaining.**

**Found first, fixed first: the scheduling seed step was aborting silently.**
Reproducing this pass from a genuinely empty database (not a long-lived
container) surfaced something every prior pass on this branch had a
pre-populated roster to paper over. `ShiftEligibilityService.get_eligible_positions`
gates every shift-assignment seat by rank, and the seeder's day-pool rotation
picks a member for a seat without checking it — a member who happens to be
one rank short of a slot is refused with "Member is no longer eligible for
the {position} position." `is_expected_seat_refusal` already tolerated the
driver/EVOC version of exactly this refusal; the general one wasn't in the
list, so it re-raised, and the per-day loop that builds every shift died on
the first occurrence. On this run that was the **second day**: 2 shifts
existed where 67 belong, and everything downstream that reads shifts —
crewed rosters, shift reports, the close-out fixture, the batch-report
trainee — was empty or blocked in ways that read as separate failures.
Widened the tolerance list to the same message pattern (any position, not
only the driver's), and to the ordinary seat-taken race a re-seed produces
when it tops up a shift a previous run already partly crewed
("`was just claimed`" / "`filled after this request was submitted`").
Neither is a seeding defect; both are the eligibility and contention rules
working, on a roster the day-pool rotation does not pre-filter.

**Second, the same failure mode one level up.** `_ensure_demo_member_report`
— the fixture that guarantees the `auth: "member"` account has an approved
shift-completion report — only ran inside the states-satisfied early return
of `seed_shift_reports`. A run that completes every review state without
happening to crew that one member onto a past shift's roster left her with
nothing, silently, because the function that exists to prevent exactly that
was gated behind the condition most likely to make it unnecessary. Made the
call unconditional, and taught the fallback to seat her directly (with the
same tolerance list) when no existing crew placement has her, rather than
only searching for one that already does. Not yet needed by an image in this
entry — the personal-export marker that reads it is still open — but it is
what makes that fixture reachable at all on a fresh install.

**A silent, deterministic form-submission failure, found the same way.**
`_form_answer`'s type-keyed sample pool had no `"phone"` entry, so a `phone`
field fell through to the generic `"text"` pool and submitted "Engine 1" —
which the server correctly rejects as not a phone number. Added a
phone-shaped pool; every form with a phone field now submits cleanly.

**The markers themselves, once the department could seed properly:**

- `04-46` is the mandatory counterpart to `04-44`: checking Mandatory
  attendance on a new event with the audience untouched flips it to All
  active members, per the edge case already written above the marker.
- `04-47` is `04-46`'s pair, applied by hand the way `17-04` sits beside
  `17-03` — the marker is one blockquote for both images, so only the first
  fills it through `apply_placeholders`. "Weekly Company Drill" is seeded
  non-mandatory with `reminder_target` explicitly overridden to `all`, which
  is what "independently saved" means: the value does not derive from the
  template's own mandatory flag. **Checked before writing the caption:**
  `EventCreatePage.templateToInitialData` copies `reminder_target` from the
  template into a new event same as every other default — the first draft
  of this caption claimed the opposite without checking, and would have
  taught the wrong thing.
- `04-48` needed a Recruitment-type event that had actually produced
  applicants, and nothing else in the seeder makes one — `19-10` captures
  only the type picker on the create form. Three named guests signed in
  through the public kiosk path (an attendee added by an officer creates no
  pipeline card at all, so only the guest path produces this), giving the
  Prospective Members card three rows instead of the single one a bare
  reproduction would show.

## Captured 2026-08-24 (nineteenth) — the candidate's own scorecard, redacted where the officer's is not

`09-24`, opened and checked against `09-23`. **7 markers remaining.**

**Same record, two prints.** The weighted-sheet test 09-23 already pictures
had no candidate-side counterpart, so this reuses it rather than minting a
new one: a template-level `result_disclosure` override of `scores` on
`Handline Advance — Weighted Evaluation`, seeded right after the test that
scores it. Officers are unaffected by the override — `resolve_disclosure_policy`
only governs the candidate's own view — so 09-23 needed no re-capture.

**Verified by diffing the two images, not by reading the code.** Same
per-step marks (`9/10`, `5/10`, …), same section arithmetic, same 78%/PASS —
and the officer's copy carries "Kinked at the stairwell turn and had to be
reset." under **Examiner Notes** plus an **Overall Notes** section that the
candidate's copy has neither of. That is the whole redaction the marker
asked for, in one side-by-side.

## Captured 2026-08-24 (eighteenth) — where a training session is wired to what it counts toward

`19-29`, opened and checked. **8 markers remaining.**

**The create wizard, not the edit card.** The marker names "requirement, course
and program linkage", and the event-detail card that corrects those links
afterwards (**Requirements & Programs**) never shows the course — it edits four
ids and nothing else. Step 2 of the wizard carries all three in one frame, so
that is what this is; the guide says where the same pickers reappear afterwards.

**Nothing is written.** The wizard creates on step 4, and this stops at step 2 —
no `mutatesSeedData` flag, and no training session added to a department that
has none.

**Framed on the wizard, not the page.** The wizard renders inside the training
admin frame, whose headline cards would have put **"COMPLIANCE — could not be
calculated"** across the top of a caption about linking a session. That reading
is true of this database (the seeded members hold three records against 26
requirements — the training-compliance seed gap already recorded here) and has
nothing to do with the marker.

**Three capture facts worth keeping:**

- The **Select Course** label carries no `htmlFor` and the select no `id`, so
  `getByLabel` cannot reach it. Located by its own placeholder option instead.
  That file has **26 labels with no `htmlFor`** — a control with no accessible
  name is a real accessibility defect, but it is a file-wide pattern rather than
  a one-off, so it is recorded here for the owner rather than swept up inside a
  screenshot change. Lint does not flag it: no jsx-a11y label rule is enabled.
- Option labels carry codes — `PUMP - Pump Operations`,
  `Driver / Operator Pipeline (DRV-OP)` — and `selectOption({ label })` matches
  exactly. Each pick resolves its value by substring instead.
- `main:has(h1:text-is('…'))` does not match a heading that also holds an icon.
  Matched on the heading's inner `<span>`.

**Order matters in the prepare, and the comment says so:** picking the course
pre-fills the category and program from what the course declares, so the
explicit picks are made after it. Reversed, the course selection overwrites them.

## Captured 2026-08-24 (seventeenth) — the station board's feed, and a pin that did not pin

`19-28`, opened and checked. **9 markers remaining.** One product defect found
and fixed at root cause, with a regression test.

**The defect.** `Dashboard.tsx` merges department messages with the member's own
notifications into one feed and sorted the result by recency alone. The inbox
arrives from the backend ordered pinned → persistent → newest
(`messaging_service.get_inbox`), and the merge threw both away. Only five rows
render, so a **pinned** "Station 2 bay doors out of service" sat below four
routine notifications, and a persistent standing order dropped off the board as
soon as five notifications arrived. The pin icon rendered beside the message
either way — which is the part that misleads: an officer who pins an urgent
notice has no way to tell it did nothing.

Fixed by ranking pinned and persistent messages above the recency sort, matching
what the backend already does for the messages list.
`Dashboard.test.tsx` gains a test that fails without it: four items, the pinned
one second-oldest and the persistent one oldest of all, asserted in the order
the rail renders them.

**Found by seeding, not by reading.** The marker wanted a persistent notice on
the board and the seed had none — three announcements, all ordinary. Adding one
put it at the top of the feed, and the reason it was at the top turned out to be
that it was the newest thing in the department, not that it was persistent.

**A test fixture that lied.** My first version of the regression test gave the
notification a `created_at` and no `sent_at`. The feed sorts notifications on
`sent_at` and falls back to `0`, so the notification sorted last and the
assertion failed on an ordering the product gets right. `sent_at` is
`server_default=func.now()` on the model, so a real row always has one; the
fixture, not the code, was wrong. Left the `|| 0` alone — a shape the database
cannot produce is not a bug to widen this change with.

**Framed on the rail, not the board.** The marker asks for a "populated station
board", and the board is already captured twice — `00-24` for the member's tab,
`08-75`/`08-76` for the conditional cards, which is exactly what "conditional
cards identified in the caption" is about. A third full-page dashboard would be
the same screen under a different caption. What is nowhere else is a feed
carrying a pinned announcement, a persistent notice and unread notifications at
once, so that is what this shot is, and the guide links to the other two.

**Title shortened twice, for the picture.** "Standing Order — Spotter Required
When Backing" truncated at "Standing Order — Spotter …": the rail is 360px and
the PERSISTENT badge takes about eleven characters of it. "Spotter Required"
fits with the badge beside it. The truncation is correct behaviour, not a
defect — but a caption about a standing order reads badly over a title cut in
half.

## Captured 2026-08-24 (sixteenth) — the roster bound, photographed where it is enforced

`19-27`, opened and checked. **10 markers remaining.**

**Half the marker asked for a screen that does not exist.** It wanted "closed
election results showing manual paper-ballot count" — and a closed election's
results show no paper figure at all. `ElectionResults.tsx` contains no reference
to manual votes or batches, by design: recording a paper tally writes one
ordinary vote row per ballot, so by the time results are drawn the paper votes
_are_ the counts. What stays itemized is the Paper-Ballot Batches panel above
the tab strip, already captured as `14-18`. Guide 19 links to it and says why
there is nothing else to point at.

**The other half is real, and it is a good picture.** The roster bound lives in
the Record Paper Ballots dialog on an _open_ election: 14 + 10 ballots for a
position with 22 eligible members is refused with all three numbers named —
projected, eligible, cap — and the override checkbox renders only once the
server has answered. One image carries the rule, the refusal and the escape
hatch.

**It writes nothing, so it needs no `mutatesSeedData` flag.** The batch is
rejected before any vote row exists — checked by re-reading the open election's
`total_votes` after the run, still 0.

**Facts verified rather than paraphrased from the guide:** the cap is
`eligible × votes-per-position`, multiplied by accepted candidates under
approval voting; the separate "physical ballots in this stack" field is checked
against the roster with no multiplier, because one member hands in one sheet;
and the override is audited at `warning` severity while a normal batch is
`info`. All four are in `record_manual_ballots`.

**Also placed in guide 14.** The plausibility guard was already described there
in prose, with no picture of it. The same image is referenced from both — which
is established practice here (`19-09`, `19-10` and `06-24` are each in two
guides) and does inflate `SCREENSHOT_STATUS.md`'s captured column by one, since
that column counts image lines per guide rather than markers closed.

## Captured 2026-08-24 (fifteenth) — what applying a ballot template changes without saying so

`19-25`/`19-26`, opened and checked. **490 filled, 11 remaining.** The picker
half of the marker was already captured — as `14-22`, in the elections guide —
so guide 19 links to it rather than photographing the same popover twice.

**The rest of the marker was the part worth doing.** Applying a saved ballot
writes the template's **voting method** and **write-in setting** over the
election, and neither the two-step confirmation nor the picker row mentions it.
The pair shows one draft before and after: one item becomes four (warned about),
and Simple Majority becomes Ranked Choice (not warned about).

**The first version of this pair was a demo artifact, and the check that caught
it was reading the create form.** I had seeded the bylaw draft with
`voting_method: "supermajority"` so the change would be visible. The create
form's control is a single `<select>` whose options pair a method with a victory
condition, and its "Supermajority Required (2/3)" is
`simple_majority|supermajority` — **no option sets the method to
`supermajority`**. The seed put the department in a state the product cannot
produce, and the screenshot would have shown a value no reader could ever see.
Re-seeded as the form writes it, with the _template_ carrying ranked choice
instead — an officer ballot plausibly run that way, and the difference the pair
needs.

**The stronger finding is what did not change.** The apply overwrites the method
and leaves the victory condition alone, so the draft is left asking for 67%
under ranked choice; `positions` still names the bylaw article over four officer
seats. And there is no editor for any of it: **Edit Dates** is dates, **Clone
Election** is title/dates/candidates, so applying a template is the only control
in the app that changes an election's voting method after creation. Both guides
now say so, and guide 14's edge-case table carries the supermajority row.

**Where the settings _can_ be read: Preview Ballot.** Its Election Details strip
carries method, victory condition with percentage, Anonymous, write-ins and
quorum together — the only screen that does. An earlier draft of the prose said
these were visible nowhere on a draft election; reading `BallotPreviewModal`
rather than the details card corrected it before it was committed.

**`19-26` mutates the seed, and three shots now repair it.** It leaves the draft
holding the template's four items, which breaks `14-21` and `14-22` — both match
on "Ballot Items (1)". `openBylawDraft` resets the election before opening it,
keyed on the item count rather than the method, and the seeder repairs it too
for a database somebody else left mutated. The manifest's own guard only
enforces that a mutating shot is last **within its guide**; the two shots it
would have broken are in another one.

## Captured 2026-08-24 (fourteenth) — the outreach-form section, and the three forms it does not list

`19-24`, opened and checked. **488 filled, 12 remaining.** Four existing captures in
guide 07 re-taken because this shot's seed changes what they count.

**The screen is real, and it was empty.** **Events -> Settings -> Public Form**
lists forms returned by `/event-requests/forms`, which filters on the
`event_request` integration — directly on `Form.integration_type`, or through a
`FormIntegration` row for forms wired after the fact. The demo department's
three hand-built forms have neither, so the section rendered nothing but its
Generate button. Not a missing screen: a missing row.

**Seeded through the button's own endpoint, not `POST /forms`.**
`POST /event-requests/generate-form` is what sets the integration type, the
twenty mapped fields and the public slug. A form posted to `/forms` with the
same name would appear in the section while being wired to nothing behind it —
a demo artifact that reads as working software. Generated as a draft, then
published, because a draft renders only the "must be published before it can
accept submissions" warning and never the public URL the caption is about.

**The absence is the marker's subject, and no image can carry it.** Written into
the guide instead: the three forms that are not in the list, named. A caption
claiming a filter works, over a picture of one row, proves nothing on its own.

**Four collateral re-captures, and the numbers are why.** A fourth published
public form moves the Forms page cards from `3 / 1` to `4 / 2`, so `07-04`,
`07-05`, `07-06` and `07-07` were re-taken rather than left reading a fleet size
that no longer exists. `07-06` now opens the builder on the generated form —
twenty fields across three section headers instead of five flat ones, which is a
better picture of the builder than the one it replaces.

**`pngquant` was not installed in this container**, and the first four captures
went to disk at three times the size of the files they replaced (248 KB against
84 KB). `capture.mjs` treats a missing pngquant as non-fatal and says so in a
comment — correct for a capture, silent for a commit. Installed and re-run over
the five files before staging. Worth knowing that the size regression is the
only signal: nothing in the run output mentions it.

## Captured 2026-08-24 (thirteenth) — Call Volume in both modes, and the calls that were not there

`03-82`/`03-83`, opened and checked. **487 of 507 filled.**

**The report was correct and useless.** Count-only Call Volume reads `OrgCall`
rows, and the only ones in the database came from the close-out wizard fixture:
four calls, all on one day, an average of `0.0` per day. That reads as a broken
screen rather than as a quiet department.

**`OrgCall` has no endpoint of its own.** The rows are written by step 2 of the
close-out wizard, through `PATCH /scheduling/shifts/{id}/closeout/calls` — so a
call history can only be built by recording counts against real shifts, which is
also exactly how a count-only department's data comes to exist.
`seed_count_only_calls` records an uneven run pattern across the roster: mostly
EMS, a scatter of everything else, and quiet tours that ran nothing, so the
report has a busiest day worth naming. Recording counts does not finalize
anything, and the close-out fixture is excluded — `03-76` and `03-77` picture
its call rows at specific values.

**The pair is the lesson, and the numbers make it.** Same department, same
period: count-only reports **52 unit responses**, detailed reports **18 total
calls**. Neither is wrong — one counts what the trucks did, the other what
happened — and all three stat cards rename themselves with the mode, which is
what the guide's caution is about.

**`Last 90 Days`, not the default.** The recorded calls sit in a three-week
band; a year-to-date window spreads 52 of them across 236 days and reports
`0.2/day`. Arithmetic that is right and reads as broken. Written into the
helper so the next person does not re-derive it.

**Found in passing:** the department was still on `count_only`, left there by an
earlier capture run. That is the self-healing rule working as designed rather
than a fault — every mode-dependent shot sets the mode it needs, because manifest
order is not a contract.

**Both halves went into `audit_baseline.txt`, and that is now the fourth and
fifth this session.** The report renders inside a dialog, and a scrim is laid
out against the initial containing block, so it cannot reach the reserved
scrollbar gutter — the structural case the baseline documents. Two ordinary
captures of an ordinary screen, flagged purely for having a scrim. The section
stands at seven entries and will take every future modal shot on a light page.
The baseline's own recommendation — retire the subtle tier, which after the
canvas fix reports a constant rather than a regression — is worth someone
acting on; still not from here.

## Flagged by the 2026-08-23 → 08-24 changes

Full reason/data-path context in
[`../CHANGE_AUDIT_2026-08-23_TO_24.md`](../CHANGE_AUDIT_2026-08-23_TO_24.md#documentation-and-media-disposition).

> **Also landed 2026-08-24, and it retracts a published claim:** the dark-mode
> scrollbar gutter *could* be photographed after all, and the white strip in
> those captures was a real product bug rather than a capture artifact. See
> [Corrected 2026-08-24](#corrected-2026-08-24--the-white-strip-i-said-could-not-be-photographed)
> immediately below this section.

**Two changes invalidate captures in bulk rather than individually**, and both
are called out first because a targeted list will miss shots nobody remembers
taking:

1. **The settings shell.** Nine settings screens — Organization, Events,
   Scheduling, Elections, User Settings, Email Templates and three more —
   carried five navigation idioms between them and now share one. **Every
   existing capture of any of those screens shows an idiom that no longer
   exists**, at desktop and at phone widths alike (where the section list is now
   a scrollable tab strip). This is a re-capture _class_, not a list.
2. **The email notification shell.** Every screenshot or B-roll frame of a
   received Logbook email predates the 5px accent rule and the status chip.
   **Caption which state you shot**: a department that has not pressed **Reset**
   on a template still receives the old shell, so both are current depending on
   the department. An uncaptioned shot of either one reads as a promise about
   the other.

Beyond those: four screens that have never been captured (the check-in station,
the ID Cards panel, Label Printers, the metrics settings screen), four
administration page headers that all changed at once, and four screens rebuilt
end to end.

### Tooling: Prettier was silently deleting markers from the tracker

Found 2026-08-24, while formatting this window's documentation. **Running
`prettier --write` over the training guides removed 40 tracked screenshot
requests from `SCREENSHOT_STATUS.md`** — and changed nothing a
reader would notice.

The mechanism: the marker convention is `> **[SCREENSHOT NEEDED — …]**`, a
blockquote whose opening `**` is closed several lines later. Prettier reads
that opening as unmatched emphasis and escapes it to `\*\*`. The page still
renders identically. But `status_report.py` anchors its pattern on
`^>\s*\*\*\[?`, so an escaped marker is invisible to it, and the guide's
"remaining" count silently drops.

**This was not caused by this window's edits.** Running Prettier over an
unmodified `03-scheduling.md` from `main` reproduces it exactly: nine markers
gone. `lint-staged` runs `prettier --write` over `*.md` on commit, so the next
commit touching any of the five would have done it, and the diff a reviewer saw
would have been backslashes.

It is the same failure this file already records under **"0 remaining was
measuring the wrong thing"** — a marker the tooling cannot see reads as work
that does not exist — arriving by a different route.

**Fixed** in `.prettierignore`, with the reasoning and a re-derivation snippet
written there.

The list is keyed on **"carries a multi-line marker"**, not on "Prettier breaks
it today" — and the merge with `main` on 2026-08-24 is why. Filling markers
changed which files Prettier escapes: guides 08 and 19 stopped being affected,
while this file and guide 04 started. Whether a given marker escapes depends on
the surrounding context, so a file that survives now flips the next time
somebody adds one. Turning prose formatting off a file costs nothing that
matters; losing a tracked capture silently does. Take a file off the list once
it has no multi-line markers left.

### DO NOT CAPTURE

| Screen                                                                         | Why                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The equipment-check **lap** — stops in walking order, collapsed finished stops | **Built, tested, and not wired.** The live check screen still renders the flat compartment list. A capture of the lap would be a screenshot of code no member can reach. `CheckLap.tsx` has no importer outside its own test file — verify with `grep` before believing any claim to the contrary |

### REPLACE — existing images now show a screen that no longer matches

Filenames below were checked against `docs/training/images/` on 2026-08-24. An
area named without a filename is one where the affected image does not exist
yet — those are listed under **SCREENSHOT NEEDED** instead.

| Image / area                                                                                                                                                                                                                                                                                                                                                                                                                           | Guide          | Why                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `08-02-organization-settings.png`, `14-16-election-settings.png`, `03-15-scheduling-settings.png`, `03-32-settings-general-closeout.png`, `03-33-settings-eligibility.png`, `03-34-settings-checklist-timing.png`, `03-35-settings-form-sections.png`, `03-36-settings-apparatus-skills.png`, `03-37-settings-rating-scale.png`, `03-40-settings-position-eligibility.png`, `00-09-account-settings.png`, `00-17-account-settings.png` | 00, 03, 08, 14 | The settings shell. One idiom now on all nine screens                                                                                                                          |
| `03-47-settings-desktop.png` and `03-48-settings-phone.png`                                                                                                                                                                                                                                                                                                                                                                            | 03             | These two exist specifically to show the settings navigation, so they are the most wrong of the set. The phone one must be re-shot at 390×844 against the scrollable tab strip |
| **Any capture of a received Logbook email**                                                                                                                                                                                                                                                                                                                                                                                            | all            | New shell. **Caption whether the department has pressed Reset** — both states are current                                                                                      |
| `01-22-member-lifecycle.png` (Members Admin hub)                                                                                                                                                                                                                                                                                                                                                                                       | 01             | Now opens with the shared frame: four metrics and a Needs attention queue above the tab bar                                                                                    |
| `02-41-training-admin-reports.png`, `02-64-skills-testing-admin.png`                                                                                                                                                                                                                                                                                                                                                                   | 02             | Same frame above the Training Admin tabs. The tab bodies themselves are unchanged, so a capture cropped to the tab content survives                                            |
| `05-25-admin-hub.png`, `05-60-admin-hub-groups.png`, `05-54-admin-hub-assign.png`, `05-72-setup-prompt.png`                                                                                                                                                                                                                                                                                                                            | 05             | Same frame above the Inventory admin hub                                                                                                                                       |
| `03-01-scheduling-tabs.png`, `03-44-month-calendar.png`, `03-04-my-shifts.png`, `03-05-open-shifts.png`, `03-54-crew-board-open-slots.png`, `03-55-staffing-status-cards.png`, `03-59-open-shifts-signup.png`, `03-62-dashboard-signup-positions.png`                                                                                                                                                                                  | 03             | The Schedule tab is a **board** with a status chip per shift and a day panel, not a grid of cards, and claiming a seat is one button rather than a position dropdown           |
| `03-60-dashboard-my-shifts.png`                                                                                                                                                                                                                                                                                                                                                                                                        | 03             | Plus the seven new scheduling staffing tiles beside it                                                                                                                         |
| `01-02-member-profile.png`                                                                                                                                                                                                                                                                                                                                                                                                             | 01             | The Assigned Inventory table is **absent** for a viewer without `inventory.manage`. **Caption the capturing account's grants**                                                 |
| `05-02-inventory-dashboard.png`                                                                                                                                                                                                                                                                                                                                                                                                        | 05             | The organization dashboard's inventory tiles now require `inventory.manage` or `settings.manage`; a shot taken under a plain member account no longer reproduces               |
| `00-04-dashboard-overview.png`, `00-07-dashboard-panels.png`, `00-20-member-dashboard.png`                                                                                                                                                                                                                                                                                                                                             | 00, 10         | Seven scheduling staffing tiles are new. **Caption the capturing account's permissions**                                                                                       |
| `02-03-submit-training.png`                                                                                                                                                                                                                                                                                                                                                                                                            | 02             | Submit External Training is rebuilt: the certificate attaches inline, duration is one stepper, and the start time is asked for and kept                                        |
| `04-01-events-list.png`                                                                                                                                                                                                                                                                                                                                                                                                                | 04             | Ranked by what each event wants from the viewer, with a **Needs you** band                                                                                                     |
| `18-01-member-storefront.png`, `18-02-store-admin.png`, `18-03-order-windows.png`, `18-04-my-orders-unpaid.png`                                                                                                                                                                                                                                                                                                                        | 18             | The storefront was redesigned end to end; checkout is now its own route at `/store/checkout`                                                                                   |
| `03-22-equipment-check-builder.png`                                                                                                                                                                                                                                                                                                                                                                                                    | 03             | Nine item types became four, each labelled with what it stores, plus a sealed-container flag                                                                                   |
| `03-25-equipment-checks-tab.png`                                                                                                                                                                                                                                                                                                                                                                                                       | 03             | Item types were renamed in stored data. A capture showing `present` or `functional` shows a value that no longer exists                                                        |
| `05-51-label-print-settings.png`, `05-64-label-settings.png`                                                                                                                                                                                                                                                                                                                                                                           | 05             | The label settings moved onto the settings shell alongside the new Label Printers section                                                                                      |

### SCREENSHOT NEEDED (new captures)

Marked in the guides as `> **[SCREENSHOT NEEDED — …]**` and counted by
`status_report.py`. Repeated here with the demo-data state each needs, because
that is what a capture run has to set up and the marker cannot carry.

**Release lesson / guide 03 — the Schedule board (2 markers)**

- **Desktop board.** _Demo data:_ a month containing one shift of **each** chip
  state — one red with open seats, one green and full, one blue with the demo
  member on it, and **one grey shift that names neither positions nor a minimum
  staffing level**. The grey one is the teaching point and the easiest to omit.
  Select a day so the crew panel and the claim button are both in frame.
- **Phone board (390×844).** Same month; capture the bar grid with the day
  sheet open. **The bottom navigation must be absent** — it hides while an
  overlay is open, and a shot showing it is a shot of the pre-08-20 defect.

**Release lesson — standing shifts (1 marker)**

- **The standing shift dialog.** _Demo data:_ a Tuesday evening shift, biweekly
  pattern selected, horizon left at its default so the "a year out" default is
  visible. Desktop. The panel must show its own action row — a dialog clipped
  at the viewport edge is the defect `modal-panel-scroll` exists to prevent.

**Release lesson / guide 01 / guide 10 — ID cards (3 markers)**

- **Member profile → ID Cards panel.** _Demo data:_ one active card and one
  revoked card on the same demo member, so the status difference and the
  four-character preview are both visible in one frame. **Use demo data** — a
  real member's card record must not be published, even as a hash preview.
- **The check-in station, armed** (release lesson), and the same screen at
  **tablet width** (guide 10). _Demo data:_ a target selected — use a drill
  night, not a medical screening clinic — the reader armed, and at least one
  successful tap in the recent-taps list. Tablet width is how it is actually
  used; a desktop-width shot teaches the wrong deployment.

**Release lesson — label printers (1 marker)**

- **Settings → Label Printers.** _Demo data:_ two registered printers, one ZPL
  and one ESC/POS, one marked default, with a status result visible on at least
  one so the reader sees what a healthy answer looks like. **Use RFC 5737
  documentation addresses (`192.0.2.x`)** — never a real department's printer
  address, which is an internal network detail.

**Release lesson — the administration frame (1 marker)**

- **The metrics settings screen.** _Demo data:_ the Members module, **department
  scope** selected, the "applies to everyone" control visible, and one metric
  mid-swap. **The fourth (queue) slot must be visibly fixed** — that it cannot
  be chosen is the rule the screenshot exists to teach.

**Release lesson — sealed containers (1 marker)**

- **The seal panel on a check.** _Demo data:_ **two** sealed compartments — one
  whose seal matches the previous check, so the clearing shortcut is offered,
  and one whose number differs, so the reader sees **Record seal** and a hand
  count instead. The contrast is the entire teaching point; a single-state shot
  teaches that a seal always clears, which is the misreading the feature was
  designed against.

**Release lesson / guide 08 — My Admin Hours (1 marker)**

- **The rebuilt My Admin Hours page.** No capture of this page exists in any
  guide, and the version one would have shown is gone. _Demo data:_ a member
  with hours in at least three categories and one configured requirement, so
  the category bars and the requirement-progress section are both populated,
  plus at least one category with **no** hours in the period so the muted
  "nothing logged in" line appears. Capture under an account that does **not**
  hold `admin_hours.manage`, so the figures are unambiguously the member's own.

**Guide 18 — storefront (marked as REPLACE, but the states are new)**

- Cart holding two different products, at least one with a size or variant
  selected, so the cart lines and the order stepper are both populated.

### Captions that are now mandatory

Three screens render differently for different viewers, and an uncaptioned
capture of any of them reads as a promise about what everyone sees:

| Screen                      | Caption must state                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Member profile              | Whether the capturing account held `inventory.manage`, or was viewing its own profile                                                |
| Any dashboard               | Which permissions the capturing account held                                                                                         |
| Members administration page | Whether the capturing account held `medical_screening.view` — without it the screening tile reads **unknown** and the queue is empty |

### Not affected

- **Guides 09, 11, 12, 13, 14, 15, 17** — no screen in this window's scope.
  Guide 13 (medical screening) is unaffected in its own pages; the change is on
  the **Members administration page**, which is guide 01/08.
- **Equipment check compartment tree and item rows** at the item level — the
  types were renamed in storage and in the builder, but a captured check sheet
  showing item names and results is still accurate.
## Corrected 2026-08-24 — the white strip I said could not be photographed

CI's image audit caught what a DOM probe had missed, and the finding retracts a
published claim.

**The claim.** `19-11-dark-scrollbar-gutter`'s caption said the scrollbar gutter
"is not in this picture, and cannot be", because
`window.innerWidth - documentElement.clientWidth` measured `0`. I recorded that
as one of the markers describing UI the product does not have.

**It was wrong, and the image itself was the evidence.** Every capture of that
page carried a **pure-white 15px strip** down its right edge against content at
luma 54. `audit_images.py` found it by comparing edge pixels with the content
beside them — the comparison the DOM measurement cannot make. Sampled directly:
`(93, 33, 37)` at `x = w-16`, `(255, 255, 255)` from `x = w-14` to the edge.

**Root cause, and it is a real product bug, not a capture artifact.** `html`
carried the themed gradient as a background _image_, and the `background:`
shorthand resets `background-color` to transparent. The reserved strip is
painted from the canvas _colour_, which an image does not supply, so it fell
back to the browser's white — on every dark-mode page, everywhere. The August 15
canvas move did not fix it; it swapped one image for another. `styles/index.css`
now sets `background-color: var(--bg-gradient-from)` on the root as well.
Verified live: the strip goes from `(255,255,255)` to `(15,23,42)`.

Guide 19 was documenting a fix that had not landed for this case. Its note is
rewritten, marked as a correction, and now says what actually happened.

**The residue that stays.** A dialog's scrim is `position: fixed; inset: 0`,
laid out against the initial containing block, which excludes that strip — so a
light page under a dark overlay keeps a light gutter beside a dimmed page.
Nothing in a page can paint outside its own box. Three modal captures are in
`audit_baseline.txt` for that reason, with the mechanism written beside them.

**Method note worth keeping.** I measured geometry, concluded "nothing to
photograph", and published it. The pixels said otherwise the whole time. When a
claim is about what an image looks like, the check has to be the image — the
same lesson as "open every PNG with Read", one level lower down.

The baseline's own recommendation — retire the subtle light-page-under-scrim
tier, since it is now a constant rather than a regression signal — is
strengthened by this fix but deliberately **not** enacted here: changing a
shared check's contract from a screenshot branch is not mine to do.

## Resolved 2026-08-24 (twelfth) — nine markers that were never going to be screenshots

`10-20` captured; eight markers answered in prose. **485 of 507 filled, 15
remaining** — down from 25 at the start of this batch.

**Six NFC markers, closed with one verified mechanism.** Web NFC is
`window.NDEFReader`, which exists only in Chrome on Android and only in a secure
context. What matters for the guides is what each control does when it is
missing, and the three differ:

| Control                                             | Without Web NFC                        |
| --------------------------------------------------- | -------------------------------------- |
| `NfcTapButton` (Tap Tag)                            | `if (!supported) return null` — absent |
| `NfcTagWriteButton` (compact, fleet QR grid)        | `return null` — absent                 |
| `NfcTagWriter` (full block, event/category QR page) | a line saying which condition fails    |

So a reader on a desktop or an iPhone is not failing to find a greyed-out
button — for two of the three there is no button. That is now written into
guides 04, 06, 10 and 19 in place of the markers, which is more useful than a
staged photograph would have been. The harness itself fails both conditions
(headless Chromium, `http://localhost`), so it could not have taken them anyway.

**The two onboarding-restart markers are a contradiction, not a limitation.**
The wizard runs only when no department exists; with one on file `/onboarding`
redirects to sign-in — verified. Every other image in the library needs a
department. Both frames would need a database with none, in the same run as a
library that needs one. The guides now say that and give the one-minute
reproduction on a scratch install.

**The terminal marker became a code block, and is better for it.** `python -m
app.preflight` was run twice for real — clean on development, exit 1 as
production — and both outputs are quoted verbatim in guide 19. Terminal output
in a code block can be searched, copied and diffed against what your own run
prints; a picture of it can do none of those.

**The "manual annotation" marker got measurements instead of drawings.** Guide
10 claimed 44px tap targets on the Submit Training form and said the comparison
had to be drawn because the "before" state no longer exists. Measured at 375px:
**50 of 52 interactive controls are 44px or taller**. The two that are not are
the painted 18×18 checkbox indicator and a 1×1 hidden file input — each inside a
label that takes the tap (the certification label is **44×317**, the
attach-certificate label 46px). Numbers a reader can reproduce beat an arrow
drawn on a screenshot, and the capture now carries them.

**One framing note worth keeping.** The first full-page attempt at that shot
stitched the sticky submit bar across the middle of the form — the same
`position: fixed` artifact as the bottom bar in the earlier table pair. Viewport
shot, scrolled with `block: "center"` rather than `"end"`, because the sticky bar
occupies the bottom of the frame and an element scrolled to the end lands behind
it.

## Captured 2026-08-24 (eleventh) — a legacy crew seat, and a roster panel no seeded shift can show

`19-23`, opened and checked. **484 of 507 filled.**

**No apparatus had crew seats at all,** so the form the release note is about
rendered "No crew seats configured" and there was nothing to photograph.
`seed_apparatus_crew_positions` gives the rescue four: three configured
positions and `rescue specialist`, which is deliberately not one of the codes.
That is the marker's "legacy read-only position" — a value a department typed
before the picker existed, which the form keeps readable and labels **(legacy
position)** rather than dropping.

**The rank backing shows in the closed control, which is lucky.** Each option
is rendered as "Officer — Fire Chief, Deputy Chief, Assistant Chief…", so the
selected seat carries its eligible ranks without the option list being open —
and the option list could not have been photographed anyway. Third native
`<select>` this pass where that is the answer.

The apparatus item route is **PATCH**, not PUT; PUT returns a bare 405.

### Seed gap: no shift carries a platoon

`03-629` — the shift detail page's hold-over roster, as a scheduler beside the
same shift as a member — **cannot be captured from the current demo data**, and
the reason is worth recording precisely rather than re-derived next pass.

The panel renders only under `platoonsEnabled && shift.platoon &&
platoonRoster.length > 0`. Platoons _are_ enabled and the roster is dealt into
A/B/C (8/7/7 members) — but **0 of 67 seeded shifts carry a `platoon` value**,
so the panel never renders for anyone, scheduler or member.

It cannot be fixed by stamping one on: `ShiftUpdate` has no `platoon` field and
neither does `ShiftCreate`. The **only** writer is
`generate_shifts_from_pattern`, which takes it from the pattern. So seeding this
means generating shifts from the seeded "A/B/C Platoon Rotation" pattern — whose
range is 2026-08-17 to 2027-02-19 — and that would lay a second set of shifts
over the calendar roughly forty verified scheduling captures already read.

Worth doing deliberately, in a pass that re-verifies those captures, rather than
inside a batch aimed at one marker. Two smaller things are already known and
would go with it: the permission half of the marker is real
(`_can_view_platoon_roster` gates the roster on `scheduling.assign`,
`scheduling.manage`, or being the named shift officer), and the approved-leave
half needs care, because approving time-off cancels any assignment inside its
range.

## Flagged 2026-08-24 — the dashboard tabs were renamed the same day

`00-24`/`00-25` were shot hours before the tab strip changed, so **both now show
labels that no longer exist**. The strip reads **Personal** and **My
Department**; the leadership panel's heading reads My Department rather than
Organization, and its failure card says "Department summary is unavailable".

Captions in `00-getting-started.md` were rewritten to describe the two views
without naming the old labels, so the prose is not false while the pixels are
stale — but the frames themselves need re-shooting. Nothing else about either
capture changed: the boundary they exist to demonstrate is the same boundary.

Re-shoot both together, as a pair, for the reason the original pass recorded
below: a department total and your own gear are never on screen at once.

## Captured 2026-08-24 (tenth) — the dashboard's data boundary, under the wrong tab names

`00-24`/`00-25`, opened and checked. **483 of 507 filled.**

**The tabs are not called what the guide calls them.** The prose describes
"Personal" and "Organization"; the strip reads **My Department** and
**Organization**. Corrected in the guide, keeping "personal" as the idea rather
than as a label.

**A single frame cannot hold this marker, and that is the lesson it teaches.**
It asks for the tabs, the personal equipment panel and an organization
aggregate card together — but the whole point of the split is that a department
total and your own gear are never on screen at once. It is a pair.

**The first framing made its own caption false.** Scrolling to My Issued Gear
put the tab strip off the top, under a caption that said "under a tab strip
offering Organization beside it". Full-page for both halves instead, which also
matches them to each other.

**Two numbers in these frames are thin, and are recorded rather than dressed
up.** The Department pulse money cards read $0 (the finance seed gap already
logged in an earlier pass), and the Organization tab's **Training Compliance
reads 0%**. The second is real arithmetic, not a bug: the demo department has
**26 active requirements** and each member carries three training records, so
nobody is fully compliant and the honest figure is zero. Making it non-zero
means seeding a member through all 26 — worth doing, and noted as a seed gap
rather than fixed inside this batch.

## Captured 2026-08-24 (ninth) — a year of admin hours, and a breakdown that named nothing

`19-22`, opened and checked. **481 of 507 filled.**

**Nothing had ever been logged against the admin-hours categories.** Six
categories were seeded; the entries were not, so the Summary tab reported 0hrs
across all three cards and "No completed entries match this reporting period"
under a heading promising a ranking. `seed_admin_hours_entries` logs twelve
sessions across the six categories and six members, spread through the calendar
year, and leaves the three most recent pending so the Needs review card and the
Pending Review tab are not zero.

Two things about how it does that, both forced by the product and worth
knowing: entries are raised **by the members themselves**, because
`POST /admin-hours/entries` credits the caller and an administrator-run loop
would credit one account with the department's whole year; and they are
approved afterwards through the review endpoint, because a manual entry
**always** lands pending on purpose — its times are client-supplied, and
auto-approval would let a member self-credit backdated time.

**The first fixture pass looked fine and left every entry pending.** The step
guarded on a total (`total >= len(ENTRIES)`), so the run after the one that
created all twelve but failed the review call skipped straight past the
approvals. It now matches per entry on the description and drives the approvals
off the _current_ pending list rather than off what this run happened to
create.

**Then the capture showed the real defect: the category breakdown rendered six
nameless bars.** "hrs · entries · 0%", six times, under correct summary cards.
`AdminHoursSummary.by_category` was `list[dict]`, and the alias generator that
gives this module its camelCase responses only rewrites _declared_ fields — so
the totals arrived as `totalHours` while the rows beneath them arrived as
`total_hours`, and every key the tab reads (`categoryName`, `totalHours`,
`entryCount`, `totalMinutes`) was undefined. Typed now, as
`AdminHoursCategoryTotal`, with a test that walks the exact payload the service
builds and fails on any snake_case key surviving into a row.

This is Pitfall #5 with a twist worth naming: the mismatch was **one level
down**. The outer field was declared and aliased correctly, so every top-level
number on the screen was right — which is precisely why nobody would report it.
The page reads as "no data", not as broken.

**One more marker/product mismatch:** the marker asks for the summary showing
"visibly different thresholds". The summary shows hours ranked by category; the
auto-approve and maximum-session limits are configured on the **Categories**
tab and are not on this screen at all. Said so beside the image.

## Captured 2026-08-24 (eighth) — the close-out override, and a template that resolves for nothing

`03-81`, opened and checked. **480 of 507 filled.**

**The warning had nothing to warn about.** The wizard's outstanding-checks
block renders only when the shift carries an end-of-shift checklist nobody has
completed, and the close-out fixture hangs on the Medic — for which no
end-of-shift template existed, because the general equipment-check seed builds
close-out templates only for the apparatus types it happens to iterate.

**Creating one by type looked right and did nothing, which is the finding
worth keeping.** `_resolve_templates` consults apparatus-_type_ templates
**only when the unit has no apparatus-specific ones**, and the Medic already
carries `Medic 3 Supply Check`. So an `ambulance` close-out template was
created successfully, appeared in the template library, reported itself active
— and was never resolved for the one shift it existed for. The fixture now
writes the template against the apparatus itself, and the _product_ behaviour
is written into guide 03 beside the "assign to a specific apparatus or
apparatus type" step, because a department hits it the same way: give one truck
a template of its own and every type-level template silently stops applying to
that truck.

**`require_end_of_shift_checks` gets the `setCallTracking` treatment.** Two
shots want opposite answers — `03-81` needs the rule on to photograph the
override it gates, `03-32` pictures the settings screen at the department's
default — so both set what they need rather than inheriting whatever ran first.
`setRequireEndOfShiftChecks` is the setter; the seeder still leaves the rule
off.

The override box is ticked in the capture because the reason field it demands
does not exist until it is, and the marker asks for both. Ticking is client
state: nothing is written until **Close out shift**, which none of the wizard
shots press — pressing it would finalize the fixture and spend it for every run
after.

## Captured 2026-08-24 (seventh) — guide 19's back-references, and a 403 no department can reach

`19-18`/`19-19` and `19-20`/`19-21`, opened and checked. **479 of 507 filled.**

Two of guide 19's markers describe the same states guides 17 and 14 already
picture, so they are the same pairs re-shot for the release note. Guide 17's
correction travels with them: **there is no account-security block on a
colleague's profile for anybody**, so "use a demo member with MFA enabled so
the redaction is visible" cannot be honoured — enrolment is shown on your own
settings page. Guide 19 now says so beside the pair.

**The hire-date 403 is unreachable in the shipped role catalogue, so it is
written rather than photographed.** The guard is real: `hire_date`, `rank`,
`station`, `platoon` and `membership_number` require `members.manage`, and the
refusal names all five. But no shipped role grants `users.edit` without also
granting `members.manage` — checked against all 28 — so nothing in the product
can be put into the state the marker asks for. Staging it would mean inventing
a role no department has. The guide now quotes the exact refusal and says when
a department would meet it: after building a custom role that separates the
two, a records clerk who maintains contact details but does not set rank.

**One `allowEmptyState` reason was wrong and got corrected before it was
committed.** I wrote that the member's "No address on file." is the withholding
the pair is about, and that the officer's half shows the address filled in.
Checked against `/users`: the member has no address recorded at all, so _both_
halves show that line and it illustrates nothing. The reason now says which
part is the permission (the three absent panels) and which part is simply
unseeded — the rule being that a reason beside `allowEmptyState` is a claim,
and a claim gets verified like any other.

**`TRAINING_MATERIALS_REVIEW.md`'s marker is an example, and is now fenced.**
`status_report.py` excludes that file by name so the count was never wrong, but
a plain `grep` over the guides returns it, and it is the one hit in the library
nobody can act on. Quoted as syntax now rather than demonstrated.

## Captured 2026-08-24 (sixth) — a fourth sign-in, and a Publish control that was never in the editor

`08-77`, `08-78`, `19-16`, `19-17`, opened and checked. **475 of 507 filled.**

**Both editor markers described a control the form does not have.** They ask
for "the revision editor captured under an account holding only
`legal.propose`, so the Publish control is visibly absent". Measured: the
editor offers **Cancel** and **Save draft** — to everybody, publisher included.
Publishing is an action on the _saved proposal_, so the proposal card is the
only place the permission is visible at all. The guides now say that, and the
two shots split accordingly: guide 08, whose marker makes the absence the
subject, gets the proposal card; guide 19, whose marker asks for the body, the
filled change note and the free-text "Last updated" field, gets the editor.

**Whose draft it is decides what the card offers, and that took a second
seeded draft.** `canModify = canPublish || revision.createdBy === currentUser`,
so a draft the administrator wrote shows the secretary _no_ controls — a true
screen picturing no rule. `_seed_secretary_draft` now writes one in the
secretary's own name, and the capture shows both on one card list: their own
proposal with Edit and Discard and no Publish, the administrator's beneath it
with nothing.

**This needed a fourth sign-in, `auth: "secretary"`.** No existing demo account
sits on the middle rung of the guide's three-way table: the administrator
publishes and an ordinary member cannot reach the screen. The **Secretary**
role is the department office that actually carries `legal.propose` without
`legal.publish` or `settings.manage`, which is also the arrangement the guide
describes in words ("the secretary drafts, an officer approves").

**The role was reaching that member as a side effect and now does not.** It was
granted while seeding the closed election's ballot attestations — which works,
and is exactly the dependency that goes quiet when the other step's fixture
guard short-circuits: the capture would then sign in successfully, land on a
screen it no longer has, and time out with nothing pointing at why.
`_ensure_legal_proposer` asserts it from the step that owns the screen.

**The history shots are clipped, and not for framing.** The privacy notice has
no pending proposals, so the page carries "No proposals yet" — true, unrelated
to the history below it, and enough for the empty-state guard to hold both
captures back. Clipping to the history section is also the better shot: the
caption is about the three revisions, not the page.

A third revision was added to `PRIVACY_REVISIONS` because both markers ask for
three, and two entries read as a change rather than as a history.

## Captured 2026-08-24 (fifth) — the tall dialog, and a table shown at both widths

`10-17`/`19-15` and the `10-18`/`10-19` pair, opened and checked. **471 of 507
filled.**

**Finding the tall dialog took measuring, not guessing.** `modal-panel-scroll`
caps a panel at `100dvh - 2rem`, which on a 390x844 phone is 812px — so a
dialog only demonstrates the fix if its content exceeds that, and most do not.
Measured: template picker 301, New Folder 328, Extend Time 375, Merge Write-Ins
409, Clone Election 445, Request Time Off 508, Record Paper Ballots 661,
Rollback 709 — all of which fit without scrolling and put their action row
mid-screen, where nothing was ever painting over it. **Add Course** is 1259px
inside a 758px panel, which is the one that genuinely scrolls.

**The shot is deliberately not `fullPage`.** `capture.mjs` hides
`nav[aria-label="Primary"]` for full-page shots, because full-page stitching
paints a `position: fixed` element at its document offset. A full-page capture
here would have removed the very thing the caption is about and proved nothing.
The prepare step also **asserts the bar is present before opening the dialog**:
without that check, a release that stopped rendering the bar at all would leave
this capture looking identical and still captioned "the bar is hidden while a
dialog is open".

**The reflow pair is the training table, not the documents table the marker
suggested.** `/documents` lists folders until one is opened, and the largest
seeded folder holds two files — a two-row wide table does not read as a table
at all, so the comparison would have shown nothing. The guide's own list of
what reflowed names the training table beside documents, so the pair uses one
member's training history: same page, same three records, 390px and desktop.

**Both halves are viewport shots rather than element clips, and that is not a
style choice.** Clipping to `table.rwd-table` is clean at desktop width and
wrong on a phone: the element is then taller than the screen, and a Playwright
element screenshot paints the sticky header and the bottom bar at their
document offsets — stamped across the middle of the table. Same family as the
full-page rule above; worth remembering as one rule rather than two.

The desktop half is placed in the guide by hand, as the pairing convention
requires — `apply_placeholders` fills one marker per shot, and the second half
carries the `__paired-with-10-18__` anchor that deliberately never matches.

## Captured 2026-08-24 (fourth) — the seeded checks that never existed, and two defects in reading one back

`03-80` and `19-14`, opened and checked. **467 of 506 filled.**

**No equipment check had been completed in the demo database at all.** The
seeder step had been failing for some time with `equipment checks: Items do not
belong to template` — a 400 naming an id and nothing else. The id was the
**section header** `_add_section_header` adds to the engine template. `header`
and `text` rows are layout, not questions: the server excludes them from the
item map by check type and refuses a submission that answers one. Three call
sites in the seeder built the submitted-item list independently, and exactly one
of them filtered — and only for `header`, not `text`. So adding the section
header to the demo template took **every seeded check** with it, and the fleet
grid, the compliance view and every phone capture of a completed check had
nothing to show. One `_checkable_rows` helper now serves all three.

**Reading a completed check back was wrong in two ways, both visible in the
shot.** `GET /equipment-checks/checks/{id}` is what the member's history row
opens, and it was the only endpoint returning a check that resolved neither of
the two things the record is read for:

- **It did not say who signed it.** `checked_by_name` is not a column and this
  endpoint never resolved it, so the detail screen printed **"Checked By:
  Unknown"** over a compliance record whose entire purpose is to name the
  inspector. Every sibling endpoint already resolved it; this one was the
  outlier.
- **It did not say in what order.** The items relationship carries no
  `order_by`, so a twelve-item engine check came back in whatever order the
  rows were yielded — compartments interleaved, and not reliably the same order
  twice. A crew reading a record back walks the same truck in the same
  sequence, so the response now follows the template's compartment and item
  sort order, with rows whose template item has since been deleted
  (`template_item_id` is SET NULL) sorting last rather than vanishing or
  landing mid-walk under a stale position.

`test_equipment_check_detail.py` covers both, plus the orphan row and org
scoping. Its fixture inserts the check items **back to front** so a response
that merely echoes the stored rows cannot pass, and it flushes the template
before the check rows — `template_item_id` is a bare foreign key with no ORM
relationship behind it, so SQLAlchemy has no dependency to order the inserts by
and emits a MySQL 1452 rather than a test failure.

**The offline half of the marker is not pictured, and the guides say so.**
Simulating a dropped connection means setting state on the browser context, not
on the page, which this harness deliberately does not do in a prepare step. A
staged "offline" banner would be a photograph of something the app never
rendered. Both guides now carry a paragraph saying that, beside the record the
two routes actually converge on.

## Captured 2026-08-24 (third) — separation of duties, a paged tab, and the race that hid it

`03-78`/`03-79` with their guide-19 twins `19-12`/`19-13`, opened and checked.
**465 of 506 filled.** Merged `origin/main` (41 commits) first; clean.

**The blocked self-review needed the administrator to be the requester.** The
rule is about people, not permissions — the chief holds `scheduling.manage` and
still cannot review their own swap — so the capture can only be made from the
requesting account. The seeder now raises one swap in the administrator's name
beside the demo member's, and `reviewOwnSwapBlocked` presses Approve on it and
waits for the server's refusal. Nothing is mutated: the service rejects before
it touches the request, so the swap is still pending afterwards and the shot
needs no `mutatesSeedData` flag. What the two rows actually differ by is worth
noting, because the marker guessed wrong: both keep Approve and Deny; the
administrator's own row carries an **extra cancel control** the member's does
not.

**Two markers asked for a control the product does not have.** Both wanted
"pagination controls ... at least 60 requests ... rather than a disabled stub".
There is no numbered pagination and no stub: `REQUESTS_PAGE_SIZE` is **20**, and
the tab renders a single **Load more time-off requests** button that is absent
rather than greyed out once everything is loaded. Both guides now say that.

**The harder half of that marker is invisible in the product.** The tab opens
filtered to **Pending**, and a department's history is resolved by definition —
so with the default filter a database holding twenty-seven time-off requests
shows _one row and no control at all_, while the count beside the view's name
reads 27. That is a real trap for a reader, not a seeding problem, and it is
now written into both guides above the image.

**Chasing that turned up a live stale-response race.** Switching to the Time
Off view and widening the filter in quick succession left the list showing the
_Pending_ results under an _All Statuses_ selector — the twenty rows arrived,
then the slower superseded fetch overwrote them with one. Two overlapping
fetches, no sequence guard; whichever resolved last won. Fixed the same way
`StoreOrdersTab` was: every fetch takes a ticket and only the newest may write
(`loadData` and `loadMore` share the counter, so an appended page cannot clobber
a reload either). `RequestsTab.test.tsx` resolves the two out of order and fails
without the guard.

Worth recording as method: the first probe of this capture looked like a
seeding failure — twenty-seven rows in the database, one on screen. It was two
separate causes stacked, a default filter and a race, and only the _timings_ in
the probe output separated them.

**Seeding notes.** `_seed_time_off_history` raises 26 requests across the ten
summer weeks behind the roster and resolves each as the administrator. Two
constraints are load-bearing and are commented in the seeder: approving
time-off **cancels any shift assignment inside its range**, so the history has
to sit behind the earliest seeded shift or it would silently unseat members
from shifts other guides photograph (verified: 125 assignments, none cancelled);
and the demo member is excluded, because several shots picture her notification
inbox in a known state. The dates were moved from 2025 to summer 2026 on a
second pass — the card prints "Jul 5 - Jul 8" with no year, so a 2025 range
reads as _next_ July.

## Captured 2026-08-24 (later) — the room picker, an overdue loan, and a history tab that leaked its own column names

`06-27` and `05-82`, opened and checked. **461 of 505 filled.**

**The item History tab was rendering its raw payload at members.** Every event
dumped `Object.entries(details)` straight to the page, so an item on loan read

> `user_name: Nadia Belhaj | reason: … | expected_return: 2026-08-20T23:40:15+00:00 | is_returned: false | is_overdue: true`

Three things wrong at once: column names shown as labels, a **raw UTC instant**
put in front of a member who will read it as their own clock — the one thing
the date rules forbid outright — and empty values rendering as a bare `notes:`
with nothing after. Keys are sentence case now, instants go through
`formatDateTime` with the organization's timezone, booleans read Yes/No, and
empty values are dropped.

**Writing the test for that found a second bug in the fix.** A plain
`YYYY-MM-DD` is a calendar date, not an instant, so putting it through
`formatDate` with a timezone _moves_ it: `2026-08-20` came out as `8/19/2026`
in New York. `formatCalendarDate` exists for exactly this and is what it uses.
The test asserts the day does not shift.

**The extracted helper had to leave the component file.** Exporting a function
beside a component costs fast refresh, which eslint flags — and that eleventh
warning put the repo over its `--max-warnings 10` gate. It lives in
`itemHistoryDetails.ts` now, the same split `dateFormatting.ts` documents for
`daysUntil`.

**Two more markers described screens the product does not have:**

- **Guide 06 wanted indented sub-rooms in the room picker.** The picker is a
  native `<select>` — its popup is drawn by the OS, so no list can be
  photographed — and its options are not indented: each carries its whole
  containment path as text instead. That is the better design for a native
  control and for a screen reader, and the guide now says so. What the capture
  shows is the half that is real and useful: a nested room selected, with the
  full path, building, address, room number and floor confirmed underneath.
- **Guide 05 wanted a stock ledger with on-hand, issued and available side by
  side.** No such panel exists, and the three are not three numbers: `quantity`
  _is_ the on-hand count — issuing decrements it, a return adds it back — so
  on-hand and available are the same figure, and the total is on-hand **plus**
  what is out. The items list shows `on-hand / total`; the per-member issued
  counts are on Gear & Uniforms → Members; deployed lots are the Stock Lots tab
  already pictured in that lesson. The marker is replaced with a table saying
  where each number lives and a warning against subtracting the issued count,
  which counts every issued unit twice.

## Captured 2026-08-24 — two permission pairs, and two markers that described the wrong thing

`17-03`/`17-04` and `14-25`/`14-26`, opened and checked. **459 of 505 filled.**

**Guide 17's marker asked for a block that does not exist on that screen.** It
wanted "the account-security block absent" from a colleague's profile viewed
with `members.view` only. There is no account-security block on a colleague's
profile _for anybody_ — MFA enrolment, last sign-in and email verification live
on your own settings page, so neither account has one to compare. The
permission difference the paragraph is really about is large and visible
though, so the pair captures that instead: the officer gets the compliance
summary, the training and certification history and the emergency contacts, and
the member gets none of the three. Worth teaching from the picture: the
member's Contact Information panel renders **empty rather than absent** — the
panel is there, the values are withheld.

**Guide 14's marker was right about the rule and impossible on the seed.**
`list_candidates` returns pending nominations to everyone _while_ nominations
are open — a nominee has to be able to find their own — and to holders of
`elections.manage` at any time; to an ordinary member after nominations close it
returns accepted candidates only. Every seeded election either sat in the
nomination phase or had nobody pending, so the rule had nothing to show. A
dedicated election is now seeded past its nomination phase with one nominee
still un-accepted. Deliberately a _new_ election: four captures need one in the
nomination phase, and advancing that one would empty them.

The member half of that pair also could not be taken as written. A member has
no Candidates tab — their view of who is standing _is_ the ballot — so reaching
for `#tab-candidates` timed out against a tab strip offering only Cast Vote.
Opening the election is the whole prepare, and the withheld nomination shows up
as a shorter list of options rather than a hidden row.

**The numbering trap bit again, and the manifest caught it this time.**
`14-20` and `14-21` were already taken, and the new entries also landed after
`14-24-ballot-send-skipped`, which mutates seed data and must stay last for its
guide. The import-time guard refused to load rather than letting the pair run
and quietly spend the fixture. They are `14-25`/`14-26`, ahead of it.

**One near-miss worth recording.** The member's candidate list came back empty
against a stale session cookie, which looked exactly like the permission rule
over-filtering. It was a 401. Re-authenticating showed the one accepted
candidate. Check the HTTP status before reading an empty list as behaviour.

## Captured 2026-08-24 — legal documents, the recruitment type, and a dashboard pair

Seven captures against a database rebuilt from zero, each opened and checked.
**455 of 505 filled.** Two of them fill a marker in two guides at once, so the
same screen is not photographed twice: `19-09` also fills guide 08's Legal
Documents marker, and `19-10` also fills guide 04's Recruitment marker.

**The database was rebuilt rather than patched.** The scorecard fixture rebuild
had left three voided records behind — a validated result cannot be deleted —
and they were showing up on the test-records capture as demo noise rather than
product behaviour. The rebuild also served as the real test of the fixture guard
rewritten the day before, and it caught one more defect in it: the seeder was
resetting the _administrator's_ password because the roster is returned
admin-first and `members[:3]` reached it, which the API rightly refuses.

**Three markers could not be taken as written, and the prose now says so.**

- **The dark-mode scrollbar gutter cannot be photographed by this harness at
  all.** The headless browser draws overlay scrollbars and reserves no gutter:
  `innerWidth - clientWidth` measures 0 even on a page forced to 4000px. The
  capture shows what it can — the themed gradient reaching the window edges —
  and the guide now tells the reader to look in their own desktop browser for
  the strip itself, rather than implying the picture contains it.
- **"All three reminder choices visible" is not possible** on a native
  `<select>`: the popup is drawn by the OS, not the page. The guide already
  tables all three above the image, so the capture shows which one a new
  optional event defaults to.
- **Legal Documents is tabs, not cards.** The marker asked for "both document
  cards"; the screen shows one document at a time behind a tab strip. Captioned
  for what it is.

**One pair was aimed at the wrong screen first.** The dashboard finance
comparison was written against `?tab=organization`, and both accounts render
that tab without any money section — a pair that compares two screens which are
identical in the one respect the marker is about. The money cards live in
_Department pulse_ on the default tab. Re-shot there and verified by measuring
both accounts: the administrator has Department pulse with dues, cash flow and
budget; the member has none of it, absent rather than empty.

**Empty-state flags on four shots were false positives**, each now carrying its
reason rather than a bare suppression: "No proposals yet" is the Privacy tab's
proposals panel (the seeded draft is deliberately on Terms), and "No reminders"
is an _option inside_ the reminder-audience select.

**New seeding:** the Legal Documents screen had nothing behind it and rendered
both cards on the platform default, picturing the feature unused. Privacy now
carries two published revisions — two, so the revision-history markers have a
superseded entry to show — and Terms an unpublished draft.

**A numbering trap worth knowing:** `--only 04-42` matches `04-42-cast-ballot`
as well as anything else starting `04-42`. Two new shots were numbered into
occupied slots and silently re-shot two unrelated ballot captures. They are
`04-44` and `04-45` now; check the number is free before claiming it.

## Re-captured 2026-08-23 — the phone sweep at 390x844, and what it exposed

**Corrected 2026-08-23 (later).** The amendment that stood here was wrong, and
the way it was wrong is worth keeping.

It reported that `03-71-set-all-to-par-confirm` was blocked by main's lap
redesign, and that `03-72` showed a `quantity` item rendering the pass/fail
control while `03-70` rendered the same type as a stepper — read as a defect in
the new code. **All four equipment-check captures shoot cleanly, and there is no
such defect.** What differed was not the item, it was the process: a backend
left running across the merge was still serving the pre-merge spellings
(`quantity`, `pass_fail`) to a post-merge frontend. Restarting it made
`03-71` capture on the first attempt and put the stepper back on the gloves.

Two things follow, and only one of them is a bug.

**`CheckLap`, `CheckItemControls` and `checkLapModel` are not wired to
anything.** Nothing outside those three files and their tests imports them; the
live screen is still `EquipmentCheckForm`'s own renderer. So the lap redesign
could not have broken a capture — it does not run. Worth knowing before anyone
else reads a check-form symptom as lap behaviour.

**The version skew that caused the false alarm is a real fragility.** The live
form compares `item.checkType` against the canonical four directly and its
control switch ends in `default: passFailButtons`, so a response carrying the
older spellings does not fail — it _degrades_, rendering every count, level and
expiry item as pass/fail. The crew answers Pass on a row meant to record a
number, no quantity is stored, and "Set all to par" has nothing to act on.
`pass_fail` is what hides it: that one lands on the right control by accident,
so most of the form still looks right. A backend on the previous release is the
ordinary state of a rolling deploy, which is exactly how this was hit.

`normalizeCheckType` was written for this and its own comment says it belongs at
the read boundary; nothing called it. `getEquipmentCheckTemplate` and
`getEquipmentCheckTemplates` now do, alongside the `normalizeShift` /
`normalizePositions` that already sit there, with tests that fail when the
normalization is removed. Structural `header` and `text` rows are passed through
untouched — canonicalizing those to `function` would put answer buttons under a
section heading.

**A screenshot caught this, and then nearly buried it.** The first diagnosis
blamed the width, the second blamed a redesign that does not execute. Neither
was reproduced against a restarted stack before being written down. A capture
that disagrees with the code is worth a second process, not just a second look.

**Two of main's renames cost a shot each, silently.** The phone menu control
became "Open full navigation menu" and the quantity stepper became
"One fewer <item>". Both matchers now carry the older spellings alongside the
current one — a capture that fails is cheap, a capture that succeeds against
the wrong element is not.

All 21 phone-width captures re-shot and opened. The trigger was the entry below:
the mobile bottom bar no longer paints over an open dialog, so every phone
capture containing one pictured the defect. That is confirmed fixed — `03-71`
(the set-all-to-par confirmation) and `03-96` (the lots-aboard sheet) now show
the bar correctly absent, and `10-14` and `10-16`, which have no overlay, still
show it.

**The viewport is now 390x844, not 414x896.** Five guide markers and the audit
below already name 390, so 414 was the outlier. The seven shots carrying an
explicit `{ width: 414, height: N }` moved too, keeping their bespoke heights —
a mobile set photographed at two widths is worse than either width.

Three defects came out of the sweep, none of them the one it was looking for.

**1. A sticky bar with no background, which read as a layout bug.** The
equipment check form's Submit bar and page header carried `bg-theme-bg` and
`bg-theme-background`. Neither token existed at the time — the stylesheet
defined `--color-theme-surface`, `--color-theme-nav-bg` and three
`--color-theme-bg-*` gradient stops — so both compiled to nothing and resolved
to `rgba(0, 0, 0, 0)` in the running app. The item list scrolled visibly
through the notes field and the Submit button, which looks like overlapping
content rather than a missing colour, and is why it survived.

Main has since settled this for the whole app: `--color-theme-bg` is now a
real token, deliberately opaque so a sticky bar occludes what scrolls under it
(a surface token cannot — in dark mode those are translucent by design), and
all 26 call sites were repointed. `themeTokenIntegrity.test.ts` walks the
source and fails on any theme utility naming a token the stylesheet does not
declare, with an empty allowlist.

> **Superseded 2026-08-24.** `--color-theme-bg` is defined now: main added it
> as the flat opaque page canvas, for precisely the sticky-bar job described
> above (a surface token cannot do it — those are translucent white in dark
> mode). So `bg-theme-bg` is the _right_ answer on that Submit bar, not the
> wrong one, and the fix recorded here was replaced by main's on merge. The
> ratchet is empty and the guard is now a plain invariant. Two sessions fixing
> one bug from opposite ends: worth reading both sides before keeping either.

_This was nearly misdiagnosed._ The overlap appeared when the width changed, so
it looked like a 390 regression. It reproduces identically at 414 on the same
code, and the geometry probe found no collision at either width — the DOM was
never the problem.

**2. A fixed bar stitched into the middle of a full-page image.** The bottom
navigation is `position: fixed`, so on a full-page capture it is painted into
the first stitch at its document offset: `10-04-mobile-dashboard` had it lying
across "Grant deadlines" with 3000px of page below. No position in a 3620px-tall
picture means "pinned to the bottom of the screen", so `capture.mjs` now hides
it for full-page shots, exactly as it already does for the skip-to-main link.
`10-12-mobile-bottom-nav` is not full-page and still shows the bar.

**3. Two shots that were passing while picturing the wrong thing.**
`10-15-mobile-menu-notifications` opened the drawer and stopped: the control had
been renamed to "Open full navigation menu", and once that was fixed the
Notifications badge the caption is about sat below the fold at 390. It now
scrolls to it, which is what a member does. The matcher keeps the two older
label spellings so the next rewording does not break it silently.

## Captured 2026-08-23 — the storefront, and three defects behind one placeholder

`19-03-privacy-header`, `19-04-qr-directory-search`, `19-05-qr-regenerate-warning`,
`19-06-store-admin-orders`, `19-07-member-payment-method` and
`19-08-store-admin-activity` are captured, opened and checked. 445 of 485 filled.

Guide 19's Store Admin marker could not be photographed at all until three
defects were fixed, and each was invisible from the previous one.

**1. The Store Admin landing page answered 500 whenever the store was in use.**
`get_open_windows` did not eager-load `offerings`, and the endpoint serializes
its result through `_window_payload`, which reads `window.offerings` and each
`offering.product.name`. Under asyncio a lazy load there raises
`MissingGreenlet` rather than emitting a query, so the dashboard failed for any
department with an open order window — the only state in which the page has
anything to show. `list_windows` and `get_window` already eager-load it.

**2. Opening the Orders tab raised a dialog stuck on "Loading…".**
`StoreAdminPage` holds `ordersDetailId` as `''` when nothing is deep-linked;
`StoreOrdersTab` did `useState(initialOrderId ?? null)`, and `'' ?? null` is
`''`. `OrderDetailModal` opens on `orderId !== null`, while its fetch is guarded
by `if (!orderId) return` — so an empty string opened a dialog with no order
behind it, over the list the administrator came to read. Pitfall #1 in its exact
documented form; `||` was the fix.

**3. The status filter silently showed the wrong rows.** Changing a filter
starts a fetch without cancelling the one running, and the tab issues more than
one unfiltered load while mounting. When an unfiltered response landed after the
filtered one it overwrote it, leaving the control reading "Paid" over a list of
every order — six rows read as though they were the two that were asked for. A
request-sequence guard now lets only the newest response write. Both defects
have tests that fail against the old implementation.

**One placeholder asked for text the product does not have.** The marker wanted
"the explanatory text that reporting payment is not payment processing" beside
the payment-method editor. No such text exists anywhere in the member-facing
storefront: the screen offers the department's handles, a method picker and an
"I've sent payment" button, which reads as a checkout. Rather than caption a
note that is not in the frame, the image is captioned for what it shows and the
guide now states the distinction in prose and says plainly that the screen does
not.

**One marker needed two images.** The activity cards are on Overview and the
list they describe is on Orders; no tab shows both. Split into `19-08` and
`19-06` with a sentence tying them together — the workflow breakdown counts
**Paid 2** and the filtered list returns those same two orders.

**Seed gaps closed:** the order window is now opened explicitly rather than
waiting for `autoOpen` to be noticed by a background task (a fresh database
produced no orders at all, and the second seeding run silently produced them),
and three member orders are placed and advanced so the list carries four
distinct states. The administrator's own order is deliberately left unpaid —
`18-04-my-orders-unpaid` pictures it.

**A capture-harness lesson worth keeping:** the first version of `19-06` waited
for `Showing 1 – 2 of 2`. That count depends on how many orders the seeder has
advanced to paid, which moves between runs, so the shot passed or timed out
according to the demo data rather than the page. It now waits for the filtered
request itself.

## Captured 2026-08-23 — the room tree, and a fixture that was never written down

`06-24-rooms-nested-tree`, `06-25-room-located-inside` and
`06-26-room-delete-subrooms` are re-captured, opened, and checked. Two things
came out of it that outlast the images.

**The room fixture existed only in one database.** The 2026-08-17 entry below
says these three "are driven from `manifest.mjs` against a seeded demo
department, so they re-shoot rather than going stale". Half of that was true:
the manifest drives the capture, but `seed_demo_data.py` never contained the
word "Volunteer Office". The tree was built by hand during that capture session
and lived only in whichever database it was using. Dropping that database
destroyed it, and all three shots failed with a 20-second locator timeout on a
room nothing had created. The tree is now seeded (`HQ_ROOMS`), hung off the
facility named in `FACILITIES[0]` rather than off "whichever the API returns
first" — a tree that moved between runs would point three shots at an empty
Rooms section without failing anything.

**The delete confirmation misstated what it was about to do.** It counted
descendants: deleting Volunteer Office — two sub-rooms, one grandchild —
promised that "3 sub-rooms will move up a level". The backend re-parents
`WHERE parent_room_id = room_id`, so **2** move; Locker Cage keeps its own
parent and rides along inside that subtree. The dialog also contradicted the
row badge directly above it, which has always shown the direct count. On a
confirmation whose only job is to state the consequence of something
irreversible, that is worth more than the screenshot. Fixed, with a test that
fails against the old implementation; `06-26` was re-shot afterwards and now
reads "Its 2 sub-rooms".

**The stray facility is gone from the pictures.** All three previously showed a
facility header reading "Oakville Fire Department / Station 1" — the record
onboarding auto-creates and the seeder then duplicated. They now read
"Station 1 - Headquarters".

Guide 19's rooms marker asked to reuse this capture rather than take its own
("shared with lesson 06; capture once, reuse"), so it now references
`06-24-rooms-nested-tree.png` directly. 439 of 485 filled.

## Captured 2026-08-23 — the close-out wizard, and why it had never shot

`03-74-settings-call-count-toggle`, `03-75-closeout-step1-attendance`,
`03-76-closeout-step2-calls` and `03-77-closeout-step3-confirm` are captured,
opened, and checked against their captions. All four had manifest entries since
2026-08-19 and had never produced an image; four separate faults stood between
the entry and the picture, and only the first announced itself.

**1. The scheduling seed died on its own feature working.** Seating crew
tolerated a "conflicting shift" 400 and re-raised everything else, but
`_require_evoc_on_apparatus` deliberately puts a minimum EVOC level on the
heavier rigs so the driver-eligibility check fires, and operators are certified
for only the first four. A driver seat landing on an uncertified member is the
demonstration, not an error — it raised, and the step died on the first one.
The demo had **2 shifts instead of 66**, which silently took out the close-out
fixture, the batch report trainee, the shift reminder inbox and every scheduling
request. Both refusals now go through `is_expected_seat_refusal`, matching
`LB-SCHED-001` on the error code rather than on a sentence that names the level
and the apparatus.

**2. The fixture read the wrong endpoint.** `_closeout_apparatus` asked
`/scheduling/apparatus` — the scheduling module's own `basic_apparatus` table,
which this demo never populates — so it answered `[]` and reported "no
non-engine apparatus to hang it on" against a seven-unit fleet that plainly
included the Medic its own hint asks for. It now reads
`/scheduling/apparatus-options` and unwraps the `{"options": [...]}` container
the rest of the scheduling seed already names.

**3. A predicate cannot close over this file.** `openStaffedShift` ships its
match function across as source text and rebuilds it with `new Function`, which
keeps the syntax and drops the scope. The close-out call site referenced
`CLOSEOUT_SHIFT_NOTE`, so every one of the three wizard shots failed with
`ReferenceError: CLOSEOUT_SHIFT_NOTE is not defined` — thrown in the browser,
with nothing in the manifest looking wrong. The constant is now interpolated
into the source string, and `openStaffedShift` says so.

**4. The step read raced the re-render, and nothing failed.** The walk clicked
Next and read `aria-current` immediately; the progress nav renders on every
step, so waiting for the wizard to be "visible" was satisfied instantly and the
read returned 1 while the body was still swapping to step 2. The `=== 2` guard
never fired, the call rows were never filled, and the capture **succeeded** —
writing a screen of ten empty rows under a caption about three EMS and one fire.
This is the failure mode worth remembering: a shot that captures cleanly and
pictures the wrong thing. The walk now waits for the step marker itself to move.

**Framing.** All three wizard shots are clipped to the card and shot at
1440x1300. At the 900px default the card is taller than its drawer, so step 1
lost the combined-hours figure its marker explicitly asks for and step 2 opened
already scrolled past the rows it exists to show. Clipping also keeps the
drawer's Notes card — which carries the seeder's own "Close-out wizard fixture"
text — out of a published image.

**One prose correction.** The guide's callout asserted that combined hours on a
four-person 24-hour tour "is 96". It cannot be, on the crew the same marker
demands: the fixture carries one member who never checked out and one who was
never checked in, and both contribute zero, so the screen reads **47.8**. The
callout now states the ideal, then explains why the picture is short of it and
what a short figure means. Verified arithmetic: 24.0 + 0.0 + 23.8 + 0.0 = 47.8,
and step 3 reports the same 47.8 against 4 calls (3 EMS + 1 Fire) from step 2.

`03-75` carries `allowEmptyState` with its reason: "no check-out recorded" is
the flag the shot exists to photograph, so the guard was reading the subject of
the capture as its absence.

**Still open in this group, unchanged:** close-out with outstanding
end-of-shift checks, and Reports → Call Volume in count-only mode. Their
blockers are recorded under the 08-17 → 08-19 entry below and neither is fixed
by the above.

## Flagged by the 2026-08-19 → 08-23 changes

Full reason/data-path context in
[`../CHANGE_AUDIT_2026-08-19_TO_23.md`](../CHANGE_AUDIT_2026-08-19_TO_23.md#documentation-and-media-disposition).

**One change invalidates captures in bulk rather than individually.** The
mobile bottom navigation used to paint over open dialogs; it now hides while
one is open. That means **every phone capture showing a dialog was taken
against the defect** — the bar in those shots is not a UI element the reader
should expect to see, it is the bug. This is a re-capture _class_, not a list,
and it is called out first because a targeted list will miss shots nobody
remembers taking at a narrow viewport.

Beyond that: one genuinely new screen (Governance → Legal Documents), a new
event type in a picker that appears in several captures, a paginated Requests
tab, and new dashboard sections.

### REPLACE — existing images now show a screen that no longer matches

| Image                                                                                                                     | Guide          | Why                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Any phone capture containing a dialog, drawer or bottom sheet**                                                         | all            | The bottom navigation no longer renders while an overlay is open. Every such shot predates the fix and shows the bar sitting on top of the dialog — the exact defect that was repaired. Re-shoot at 390×844 |
| `10-04-mobile-dashboard.png`                                                                                              | 10             | New dashboard widget sections; also subject to the dialog rule if any overlay is open in frame                                                                                                              |
| `10-12-mobile-bottom-nav.png`                                                                                             | 10             | Still correct as a shot of the bar itself, but now **needs a companion** showing the bar _absent_ behind an open dialog. Alone it now teaches the wrong expectation                                         |
| `03-11-swap-requests-tab.png`                                                                                             | 03             | The Requests tab is paginated, and the review controls now differ depending on whether the viewing member raised the request. The current shot shows neither                                                |
| `04-05-create-event.png`                                                                                                  | 04             | The event type picker gained **Recruitment**. A reader comparing their screen to this one will conclude their build is older                                                                                |
| `04-09-event-templates.png`                                                                                               | 04             | Same picker, same problem, in the template form                                                                                                                                                             |
| `04-02-event-detail.png`                                                                                                  | 04             | The event page now shows the applicants an event brought in. The current shot has no such section                                                                                                           |
| `04-01-events-list.png`                                                                                                   | 04             | Only if shot at a narrow viewport — the events page was cut down for phones. Desktop captures are unaffected                                                                                                |
| `03-22-equipment-check-builder.png`                                                                                       | 03             | Responsive builder actions changed, and compartment paths can now be deeper than the old shot shows                                                                                                         |
| `03-25-equipment-checks-tab.png`                                                                                          | 03             | Expired-equipment failures are now derived at read time, so the status column can differ from a shot taken at submission time                                                                               |
| `00-04-dashboard-overview.png`, `00-07-dashboard-panels.png`, `00-20-member-dashboard.png`, `02-17-officer-dashboard.png` | 00, 02, 10     | New permission-scoped widget sections. **Caption which permissions the capturing account held** — the sections a reader sees depend on their own grants, and an uncaptioned shot reads as a promise         |
| `06-09-facilities-dashboard.png`, `05-02-inventory-dashboard.png`                                                         | 05, 06         | Asset widgets are new on the organization dashboard                                                                                                                                                         |
| **Any capture showing browser tab chrome**                                                                                | all            | Tab titles were generic before this window and are page-specific now. Only affects shots that include the tab strip                                                                                         |
| **Documents, training, audit and check-in tables at narrow viewports**                                                    | 07, 02, 08, 04 | These now reflow into stacked cards instead of scrolling sideways. Any phone capture of them shows the old behaviour                                                                                        |

### SCREENSHOT NEEDED (new captures)

Marked in the guides as `**[SCREENSHOT NEEDED — …]**` and counted by
`status_report.py`. Repeated here with the demo-data state each needs, because
that is what a capture run has to set up and the marker cannot carry.

**Guide 08 / release lesson — Governance → Legal Documents (4 markers)**

- **Landing view**, both document cards. _Demo data:_ one document with a
  published revision, one with an unpublished draft, so the status difference
  is visible in a single frame. Use a demo department name — this page shows
  the department's own legal wording and a real one should not be published to
  a guide.
- **Revision editor** showing the body, the **required change note** filled in,
  and the free-text "Last updated" field. _Demo data:_ capture under an account
  holding **only `legal.propose`**, so the Publish control is absent. That
  absence is the subject of the shot and must be captioned, or it reads as a
  missing feature.
- **Revision history** for one document. _Demo data:_ **three** revisions — one
  published, two archived — each with a change note and a publishing member.
  Two rows read as an accident; three read as a history.
- **A published revision reflected on `/privacy`.** _Demo data:_ the same
  department, showing that what was published is what the public page serves.

**Guide 03 — scheduling (3 markers)**

- **The error after a self-review attempt.** Sign in as the member who raised a
  pending swap, press **Approve** on it, and capture the error ("Requesters
  cannot review their own swap requests") with the request still pending.
  _Demo data:_ one pending swap raised by the capturing account.
  **Corrected 2026-08-23:** this marker previously asked for a side-by-side of
  two rows with differing controls. That capture cannot be taken —
  `RequestsTab` renders Approve/Deny for **every** pending request whenever the
  viewer holds `scheduling.manage`, own requests included, so the rows are
  identical until the button is pressed. The rejection is server-side and only
  appears after the click.
- **Requests tab with pagination populated.** _Demo data:_ **at least 60**
  requests, so the control is active rather than a disabled stub.
- **Submitted shift equipment check at 390×844.** _Demo data:_ a completed
  check. If the harness can simulate the offline/queued state, capture that
  too; **if it cannot, say so in the caption rather than staging it** — a faked
  offline badge is the kind of detail a reader who has actually been in a dead
  spot will catch.

**Guide 04 — events (2 markers)**

- **Event form with Recruitment selected**, both guest switches on, and the
  teal banner reading "Guests who sign in at this event will be added to the
  prospective members pipeline."
- **Event detail showing linked prospects.** _Demo data:_ a recruitment event
  with **at least three** guest sign-ins converted to prospects.

**Guide 10 — mobile (2 markers)**

- **A tall dialog at 390×844 scrolled to its action row, with the bottom
  navigation absent.** _Demo data:_ any dialog taller than the viewport. This
  is the reference shot for the whole re-capture class above.
- **A reflowed table at 390×844 beside the same table on desktop.** The
  **pair** is the point — a single shot does not show a reflow.

**Guide 08 — dashboards (1 marker)**

- **The organization dashboard under two accounts side by side**: one holding
  `finance.manage`, one without. _Demo data:_ seeded finance figures. The
  finance section must be **present in one and absent — not empty — in the
  other**. The comparison is the entire lesson; either shot alone teaches
  nothing.

### Do not capture

- **The public `/privacy` page of a real department.** Use demo wording. This
  screen now shows department-authored legal text, and publishing a real
  department's notice into a training guide is a different act from publishing
  a screenshot of a generic settings page.

## Flagged by the 2026-08-17 → 08-19 changes

Full reason/data-path context in
[`../CHANGE_AUDIT_2026-08-17_TO_19.md`](../CHANGE_AUDIT_2026-08-17_TO_19.md#documentation-and-media-disposition).

Two things landed that invalidate existing captures rather than merely adding
new ones: **shift close-out is a different screen** for departments recording a
call count, and **four QR pages gained an NFC control in their action row**.

### REPLACE — existing images now show a screen that no longer matches

Each of these is in a guide today and is wrong, incomplete, or newly ambiguous.
Listed with the file so a re-capture run can target them.

| Image                                                        | Guide  | Why                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `03-45-finalize-checklist.png`                               | 03     | Still correct for a **detailed**-mode department, and now ambiguous without saying so. The guide has been given a note above the image; the image itself needs a caption change, and the count-only wizard needs shooting alongside it rather than replacing it |
| `03-32-settings-general-closeout.png`                        | 03     | The _Shift close-out rules_ block gained **Record a call count at close-out**. The current shot predates it, so a reader looking for the toggle will conclude their build does not have it                                                                      |
| `03-14-scheduling-reports.png`                               | 03     | If the demo department is switched to count-only for the new captures, the Call Volume card relabels. Verify which mode this was shot in and caption it                                                                                                         |
| `04-04-event-qr-code.png`                                    | 04     | The page gained **Write to an NFC tag** below the QR code. The current shot is missing a control the guide now describes                                                                                                                                        |
| `03-08-calls-runs-section.png`                               | 03     | Correct, and now conditional — Calls / Runs does not exist for a count-only department. Needs a caption saying which mode it shows                                                                                                                              |
| Check-In QR Codes directory (guide 06, `#check-in-qr-codes`) | 06     | Apparatus cards gained **Write NFC tag** in the action row. There is **no captured image of this page at all**; the new marker below covers it                                                                                                                  |
| Shift detail QR block (guide 03)                             | 03     | The NFC writer now sits beneath the QR code. No dedicated capture exists; covered by the marker below                                                                                                                                                           |
| `17-01-privacy-choices.png`                                  | 17     | `/privacy` and `/terms` were rewritten on 2026-08-17 with a new print stylesheet. Any capture of either page predates the rewrite                                                                                                                               |
| `00-04-dashboard-overview.png`, `00-20-member-dashboard.png` | 00, 10 | Only if shot at a narrow viewport — the week strip and alert list now collapse on a phone. Desktop captures are unaffected                                                                                                                                      |
| Login page (guides 00, 03 of the YouTube set)                | 00     | Only for departments with `CAPTCHA_ENABLED`. The challenge widget is new on the two internet-exposed forms and appears in no capture                                                                                                                            |

### SCREENSHOT NEEDED (new captures)

These are marked in the guides as `**[SCREENSHOT NEEDED — …]**` and counted by
`status_report.py`. Repeated here with the demo-data state each one needs,
because that is what a capture run has to set up and the marker cannot carry.

**Guide 03 — scheduling (6 markers)**

- **Settings → General → _Shift close-out rules_** with **Record a call count at
  close-out** switched on and its explanatory paragraph legible.
  _Demo data:_ none beyond the toggle.
- **Close-out wizard step 1 — attendance.** _Demo data:_ a **four-person crew on
  a 24-hour tour**, so the combined-hours figure reads ~96 and visibly is not
  the shift length; at least one member with a missing check-out; at least one
  assigned member who never checked in, showing empty times.
- **Close-out wizard step 2 — calls.** _Demo data:_ two or three type rows
  filled (e.g. EMS 3, Fire 1) with the derived total showing 4 and rendered
  read-only. This is the screen that teaches "the rows are the only source" and
  the read-only styling has to be visible.
- **Close-out wizard step 3 — confirmation.** _Demo data:_ the same crew, credit
  seeded from the apparatus count, **one member adjusted downward** for a late
  arrival, plus the pass-down notes field.
- **Close-out with outstanding end-of-shift checks.** _Demo data:_
  `require_end_of_shift_checks` on, one check outstanding, showing the warning,
  the override checkbox, and the reason field it requires.
- **Reports → Call Volume in count-only mode**, showing **Unit Responses / Avg
  Responses/Day / Peak Responses** and the footnote. **Caption it against the
  detailed-mode version** — the whole point is that the labels differ, and a
  lone capture teaches neither. Two things not to imply in that caption
  _(added 2026-08-19)_: detailed mode's "Total Calls" is **also** not an
  incident count (it sums per-trainee shift completion reports), and there is
  **no per-apparatus breakdown on this screen** to frame — the API returns
  `by_apparatus_runs` and the renderer ignores it, so do not treat its absence
  as a mis-seeded capture. See `KNOWN_LIMITATIONS.md` SCHED-15 / SCHED-16.

**Guide 04 — events (3 markers)**

- **`/events/:id/qr-code` mid-write**, showing the "hold a tag to your phone"
  state rather than the idle button.
- **Tap Tag on the Events page, scan armed**, waiting for a tag.
- **Tap Tag after reading an unrecognized tag** — the explanatory message with
  the scan still armed. This is the security behaviour, and a reader will not
  believe "it just doesn't navigate" without seeing it.

**Guide 06 — apparatus & facilities (1 marker)**

- **`/locations/qr-codes` on a phone**, an apparatus card mid-write with its
  action row showing Copy URL / Download PNG / Regenerate / **Write NFC tag**.
  Shoot it on a phone, not desktop: that is where the button is usable, and the
  card grid is the thing being described.

**Guide 10 — mobile (1 marker)**

- **A phone held against a mounted NFC tag on an apparatus**, and the resulting
  shift check-in page naming the unit, date and hours. Two frames or one
  composite. Note the camera-viewfinder caveat below does **not** apply — no
  viewfinder is involved.

**Guide 19 — release changes (3 markers)**

- **Admin hours category QR page** with the NFC tag writer beside the QR code.
- **`python -m app.preflight`**, two terminal captures side by side: exit 0 on a
  good configuration, exit 1 on a broken one with the blocking items listed.
- **The rewritten `/privacy` header**, showing the department-control statement
  above the fold.

### Capture constraints for this batch

**Four of the six guide-03 captures are now automated** _(2026-08-19)_ —
`03-74-settings-call-count-toggle`, `03-75-closeout-step1-attendance`,
`03-76-closeout-step2-calls` and `03-77-closeout-step3-confirm`. They run
against a dedicated fixture the seeder builds: a past **24-hour tour with four
crew**, one member checked in but never out, and one assigned member with no
attendance row at all. Both of those last two are states no other seeded shift
carries, because `_seed_shift_attendance` checks every past crew fully in and
out — right for every other shift, useless for this one.

Three things about that group are worth knowing before editing it:

- **Each shot forces the organization's call-tracking mode**, and
  `03-45-finalize-checklist` forces it back. The mode decides which of two
  entirely different close-out screens renders, either shot may run first, and a
  shot that inherited the wrong mode would still **succeed** — it would just
  write the wrong picture under the right filename. This is the same
  self-healing rule `capture.mjs` applies to `navigationLayout`.
- **Each shot walks the wizard from step 1.** The server remembers how far the
  last run advanced (`shifts.closeout_step`) and reopens there, so without the
  rewind a second capture run would open at step 3 and the "step 1" shot would
  quietly contain step 3.
- **Nothing clicks "Close out shift".** That finalizes, and a finalized shift
  will not reopen the wizard — one capture run would spend the fixture for every
  run after it. If the fixture is ever finalized by hand, the seeder says so and
  refuses to reuse it rather than silently building a second one.

**Two of the six are still manual, with the specific blocker for each:**

- **Close-out with outstanding end-of-shift checks.** Needs
  `require_end_of_shift_checks` on _and_ a shift with an outstanding check.
  Equipment-check templates resolve by apparatus type and the demo department
  writes its checklists for **engines**, while the close-out fixture is
  deliberately a Medic — putting it on an engine would let it race
  `03-45-finalize-checklist` for the same shift. Closing this needs either an
  engine-typed second fixture or a medic checklist template in the seed.
- **Reports → Call Volume in count-only mode.** Needs actual `org_calls` rows,
  and the fixture has none: calls are written by the wizard, and the wizard
  shots deliberately stop short of finalizing. Closing this needs the seeder to
  POST `PATCH /scheduling/shifts/{id}/closeout/calls` against a _second_ past
  shift — one the wizard captures do not use, so the two do not fight over
  `closeout_step`.

**The NFC captures cannot be automated at all.** Web NFC does not exist in the
headless Chromium the harness drives, and it is not exposed over `http://`
either. They are manual captures on a real Android phone, like the
camera-viewfinder shots recorded under the 2026-08-12 entry below, and they must
not be added to `manifest.mjs`.

## Tracker corrected 2026-08-17 — the count was never 421 of 423

Two defects in the pipeline were found while capturing the nested-room shots,
both fixed in the same pass:

1. **`MARKER` did not match a descriptive request.** The pattern required
   `[SCREENSHOT NEEDED]` as a closed token, so every
   `**[SCREENSHOT NEEDED — what to capture]**` marker — the form both August
   documentation passes used — was invisible to `status_report.py` _and_
   `apply_placeholders.py`. 41 outstanding captures across 12 guides were
   uncounted; the tracker read **421 of 423 filled (2 remaining)** while the
   real figure was 40 outstanding. The honest count is now **424 of 464**.
2. **Applying one placeholder deleted its neighbours.** `block_end` consumed to
   the end of the blockquote, and guides stack two or three requests in one
   quote separated by a bare `>`. The first replacement swallowed the rest —
   image applied, sibling requests gone, unshot and unrecorded. It happened
   once for real (the "Located Inside" request) before the behavior was found.
   11 markers across three guides were in that position. `block_end` now stops
   at the next marker.

**If you have applied placeholders on a branch since 2026-08-12, check for
silently dropped requests** — the symptom is a request that was in the guide
and is now neither a marker nor an image.

## Captured 2026-08-17

- `06-24-rooms-nested-tree` — Rooms section as a three-level tree (Volunteer
  Office → Quartermaster's Storage → Locker Cage, plus Records Closet), with
  sub-room counts and the hovered row actions.
- `06-25-room-located-inside` — the room form's "Located Inside" field.
- `06-26-room-delete-subrooms` — the delete confirmation naming the sub-room
  consequence.

All three are driven from `manifest.mjs` (ids `06-24`…`06-26`) against a
seeded demo department, so they re-shoot rather than going stale.

## Flagged by the 2026-08-15 → 08-16 changes

Full reason/data-path context in
[`../CHANGE_AUDIT_2026-08-15_TO_16.md`](../CHANGE_AUDIT_2026-08-15_TO_16.md#documentation-and-media-disposition).
These are **not verified captures**; each remains open until the image is
opened and checked against its guide caption.

### SCREENSHOT NEEDED

- **Nested facility rooms** (guide 06, lesson 19): the Rooms section rendering
  a two/three-level tree with indented sub-rooms, per-room sub-room counts,
  and the add-a-room-inside row action. Seed one nested branch (e.g.
  Volunteer Office → Quartermaster's Storage).
- Room form with the **"Located inside" picker** open, demonstrating the
  room's own subtree is excluded from the options.
- **Delete-room confirmation** for a container room, showing the
  "sub-rooms move up a level" warning.
- **Cross-module room picker** (an event form) with indented sub-rooms and
  the containment path printed under a selected nested room.
- **Candidate list, member vs. manager** (guides 14, 19): the same election
  after nominations close from a member account (accepted only) and an
  `elections.manage` account (pending visible). Caption which is which.
- **Directory profile redaction** (guides 17, 19): the same colleague profile
  with `members.view` only (no MFA/verification/last-login/notification
  metadata, roles without permission lists) beside the `users.view` version.
  Use a demo member with MFA enabled so the difference is visible.
- **Hire-date restriction** (guide 19): profile edit rejecting a `hire_date`
  change without leadership/secretary/membership-coordinator permission,
  showing the explanation in the toast.

### Added by the post-audit August 16 merges

- **Storage Areas page** (guide 05): now shows all areas by default and every
  area is assigned a barcode (auto-assigned `SA-…` series). Re-verify any
  storage-areas capture; a new capture should show the barcode column
  populated on every row. **Do not caption it as scannable** — the code is
  assigned and printable, but the inventory scanner cannot resolve it yet
  (KNOWN_LIMITATIONS INV-8).
- **Equipment-check rejection vs. offline queue** (guides 03/10): capture a
  server-rejected check showing the real error message — **not** the
  "queued for sync" toast — and, separately, the abandoned-after-retries
  loss notice. Requires demo setup that forces a 4xx (e.g. a
  revoked-permission account).

### REPLACE / re-verify

- `06-11-facility-detail.png` — re-verify: if the Rooms section is visible,
  it now renders a tree with sub-room counts, not a flat list. Replace if the
  old flat list shows.
- Any existing capture of the **room form** without the "Located inside"
  field, or of a **room picker** (events/training/scheduling captures) showing
  a flat, un-indented list — the picker now indents sub-rooms and shows the
  containment path.
- Any capture of a colleague profile that shows the account-metadata block
  (MFA, last login, timestamps) under a members-only viewing context.

### REPLACE — one image now; 38 more only when they are next re-shot

The themed background gradient moved from `body` to `html` so that it also
covers the browser's stable scrollbar gutter. Before that, the gutter showed the
browser's default canvas — against dark content, **a 15px white strip down the
right edge**.

All 429 images were checked with
[`scripts/screenshots/audit_images.py`](../../scripts/screenshots/audit_images.py)
(`--check edges`). **39 carry the strip**, and they split cleanly by how much it
matters:

| Tier                                     | Count | What changed                                                                     | Action                                                            |
| ---------------------------------------- | ----- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Stark** — `10-11-public-form-dark.png` | 1     | Dark page: the white strip becomes a **dark** gradient. Plainly visible          | **Re-shoot.** It is the only `theme: "dark"` shot in the manifest |
| **Subtle** — 38 modal captures           | 38    | Light page under a dark modal overlay: white becomes a **pale** gradient at 15px | Leave. Fold in whenever the shot is re-taken for another reason   |

**The 38 are the instructive part.** They are light-mode pages; what darkens the
right edge is the **modal overlay**, which dims the viewport but sits inside
`body`, leaving the gutter — reserved on `html` — white behind it. So the trigger
is _dark content at the right edge_, not a dark page.

> **Correction (2026-08-16).** This section first said "exactly three, measured".
> That was wrong, and wrong in an instructive way: the first scan pre-filtered on
> **whole-image** brightness before looking at the edge, which quietly assumed the
> defect was a dark-mode one. Every modal capture is bright overall and dark
> exactly where it matters, so 36 of them were filtered out before the real check
> ran. **A filter that encodes the assumption you are testing will confirm it.**
> The script now compares the edge with the content beside it and never with the
> page average; run it rather than re-deriving the check by hand.

Cropped per-control shots never included the edge and are unaffected. **There is
still no set-wide re-shoot here** — the actionable list is one file.

Nothing else about the rendering changed — no layout, no spacing, no colour
inside the content area — so these three need only re-capture, not re-caption.

### SCREENSHOT NEEDED

- **Onboarding session expired, in two frames.** (1) The wizard reopened after a
  browser restart, showing previously typed answers repainted; (2) the
  session-expired error raised by the next step. Demo data: begin an onboarding
  run through the stations step, close the browser, reopen `/onboarding`, and try
  to continue. **Both frames are required** — either one alone teaches the wrong
  lesson, because the whole point is that a filled-in form does not mean a live
  session. Used by `08-admin-reports.md` and
  `19-august-2026-release-changes.md`.
- **A public page in dark mode at full window width**, on a page long enough to
  scroll (`/f/{slug}` or an application-status link). This is the standing proof
  that the canvas covers routes rendered outside the app shell, which is the
  reason the rule exists at all. Used by `19-august-2026-release-changes.md`.
- **Skills-testing printing, three shots** (added by the 2026-08-11 print pages,
  documented 2026-08-16 — the guide had no printing section until then):
  - The Templates tab row actions with **Print** visible, plus the resulting
    blank sheet in print preview. Demo data: one published template with at
    least two sections and a mix of criterion types (pass/fail, scored, timed),
    so the differing marking boxes appear in one frame.
  - A completed scorecard print preview showing per-step marks, the score
    arithmetic, and the validating officer's sign-off. Demo data: one validated
    official result with at least one failed step, so the deduction is visible.
  - The same scorecard as a candidate under `scores` disclosure sees it, with
    the examiner's notes absent. **Capture beside the officer version** — the
    pair is the teaching point; either alone is not.

The reason, data path, and edge cases for each are recorded in
[`../CHANGE_AUDIT_2026-08-10_TO_16.md`](../CHANGE_AUDIT_2026-08-10_TO_16.md#documentation-and-media-disposition).

## Flagged by the 2026-08-12 → 08-14 changes

The three-day connection audit identified the following capture work. These
are **not verified captures**; each remains open until the image is opened and
checked against its guide caption.

### SCREENSHOT NEEDED

- Saved-ballot picker showing the visible template name, item count, replacement
  warning, and action buttons; a separate before/apply/after capture of the
  election settings form demonstrates that settings were restored. Also capture
  the manual paper-ballot count on election results.
- Station-board dashboard and the admin-hours calendar-year/category summary.
- Store admin activity/status counts, order filters, open-banner toggle, and a
  member changing their own external payment method.
- Inventory temporary-issue deadline/overdue state and stock arithmetic showing
  why on-hand and available differ.
- Room QR Codes directory (search, print, PNG), the regeneration warning, and
  rank-backed apparatus crew positions.
- Event create/template reminder audience and Flexible 60-minute check-in state.
- Personal versus Organization dashboard tabs, directory-versus-scanner
  navigation, and personal-export field visibility before/after the Training
  setting changes.
- Event Settings outreach-form picker, training-session requirement/program
  linkage, and a related notification before and after automatic archive.

### REPLACE / re-verify

Replace any existing capture that shows the old dashboard, admin-hours
summary, store admin dashboard, Ballot Builder without saved settings,
free-text apparatus crew positions, old outreach-form discovery, or QR
navigation before the Room QR directory. Re-verify mobile captures containing
changed headers, dashboard cards, breadcrumbs, or actions at 375px; the 44px
touch-target fixes can change spacing even when the words are unchanged.

The reason, data path, and edge cases for each screen are recorded in
[`../CHANGE_AUDIT_2026-08-12_TO_14.md`](../CHANGE_AUDIT_2026-08-12_TO_14.md#documentation-and-media-disposition).

Which captured screenshots still match the application. Companion to
[SCREENSHOT_STATUS.md](./SCREENSHOT_STATUS.md), which counts how many
placeholders are **filled**; this file records whether what was captured is still
**true**.

Kept separately because `SCREENSHOT_STATUS.md` is regenerated wholesale by
`scripts/screenshots/status_report.py` and anything hand-written there is lost on
the next run.

**Newest flags first: see _[Images invalidated by the 2026-08-11 → 08-12
changes](#images-invalidated-by-the-2026-08-11--08-12-changes)_** — the mobile
hamburger moved to the left edge (touches every phone-width capture with a
header) and the Ballot Builder grew a Save-as-Template control. Flagged
2026-08-12, not yet re-captured.

**Re-captured 2026-08-11.** The seventeen images flagged under _[Images
invalidated by the 2026-08-10 → 08-11 changes](#images-invalidated-by-the-2026-08-10--08-11-changes)_
were re-shot against a live stack, and every one of them was opened and read
against its caption afterwards. See _[The 2026-08-11
pass](#the-2026-08-11-pass)_ for what that found. The guides listed under _Not
re-captured_ below are otherwise unchanged and remain stale.

**Re-captured 2026-08-10.** The 02, 03 and 09 guides — 57 images — were shot
against a live stack rebuilt from current `main`. The three other guides listed
under _Not re-captured_ below still carry images from **2026-08-09 09:43 UTC or
earlier** and remain stale.

> **An earlier revision of this file said re-capture was impossible here**,
> because MariaDB and a Docker daemon were both absent. That was true of the
> container, not of the project: `apt-get install mariadb-server` supplies the
> database, and the pipeline runs fine without Docker. The claim is corrected
> rather than deleted because it is the sort of environment assumption that
> quietly becomes policy.

---

## "0 remaining" was measuring the wrong thing — 41 placeholders the tooling could not see

Guide 01's two named placeholders are filled and verified (see the entries
below). Re-checking them turned up something larger: **`status_report.py` and
`apply_placeholders.py` shared a regex that matched none of the guides' actual
placeholders.**

Both required `\[SCREENSHOT NEEDED\]` — the bracket closing immediately after
the word. Guides carry two syntaxes:

```
> **[SCREENSHOT NEEDED]:** _description outside the brackets_
> **[SCREENSHOT NEEDED — description inside the brackets]**
```

Only the first matched. The second form accounts for **41 placeholders across
twelve guides** — twenty of them in `19-august-2026-release-changes.md`, four
each in guides 04 and 06, three in guide 09 — and several carry their own seed
instructions ("seed orders in at least three states", "seed one
organization-owned template and no vote data"). They were never counted, never
attempted, and reported as though they did not exist. The tracker has been
saying "0 remaining" while forty-one specified requests sat unread; the same
list appears in this file's own SCREENSHOT NEEDED sections, so the work was
known and the tooling simply never saw it.

The bracket is now optional and unterminated in both scripts, which report
**432 captured, 40 remaining**. Two properties were checked before changing it:
every one of the 436 manifest shots carries an `anchor` (so no shot can drift
onto a bracketed placeholder on a stale line number alone), and a dry run
before and after replaces the identical set — the wider pattern lets the
counter see these placeholders without letting the applier fill any of them by
accident.

### 00-15-sidebar-member was the administrator's sidebar

The shot had no `auth` key, so it defaulted to admin: an image captioned "the
member-facing sections" showed the ADMINISTRATION heading and Department
Setup. 00-16's comment beside it recorded the symptom without naming the
cause — it said an element clip of the nav "would be the same picture as the
member-section shot above", which was true because both were the same user.

Re-shot as a member, and the real member sidebar differs in more than the
missing admin half: **Operations reads My Issued Gear / Gear & Uniforms**,
where the stale admin capture showed My Equipment / Inventory. Those are
renames, not permissions — no gate distinguishes them — so guide 00's member
table was documenting labels the product no longer uses, and listing
Department Store as an Operations child when it is its own top-level item.
Corrected, along with **Gear Admin** (was Inventory Admin) in the
Administration table, which the re-shot 00-16 exposed.

00-16 also still pictured the raw-UTC dashboard timeline
(`2026-08-16T23:00:00+00:00`) fixed earlier in this session, so it was re-shot
too — an image displaying a bug the shipped code no longer has.

### 01-39-scan-member-id-nav — the third guide-01 placeholder, filled

The one in the invisible syntax asked for "side-by-side navigation for a
`members.view`-only role and a `users.view` role". Checked against
`SideNavigation.tsx` first: the rule is real —
`anyPermission: ['users.view', 'members.manage']` — but the link is called
**Scan Member ID**, not "Scanner", and it lives under Members in the
Administration section.

Two roles cannot be one picture, and the harness authenticates as the
administrator, the demo member, or nobody — a `members.view`-only role is none
of those. Split the way `09-18` and `01-membership.md:1156` were: the elevated
half is captured, and the member half is cross-referenced to 00-15, whose
sidebar has no Administration section at all — which is _why_ the scanner
cannot appear there. Seeding a fourth identity would picture the permission
pair exactly and is left recorded rather than half-done.

Three harness lessons paid for by this one shot, all now written beside it:

- **`innerText` lies about case.** The heading is uppercased by CSS, so the
  DOM text is "Administration" and an exact `"ADMINISTRATION"` match — which
  is what a debug dump shows you — never fires.
- **The Administration sub-items are not anchors.** A `getByRole("link")`
  locator finds nothing with the group open and the words plainly on screen.
- **The admin half of the nav is built after permissions resolve**, so for a
  moment the only button named "Members" is the member-facing roster item, and
  clicking that one expands nothing. The shot waits for the section first.

## The 2026-08-17 pass — guides 04, 09, 06 and 08, 103 changed images verified

All four guides were re-captured against the rebuilt database and the merged
build, and **every changed image was opened and read against its caption** by
three parallel verification passes before anything was committed. Ninety-two
came through verified; the rest were dispositioned rather than trusted:

- **Thirteen kept their previously verified bytes** instead of the fresh
  capture, because the new frame showed a data regression, not a code change:
  the meetings module, event requests, QR-scan analytics, apparatus fuel
  logs, permanent equipment assignments and overdue facility maintenance are
  all **unseeded on a fresh database** (the long-lived one had accumulated
  them), the compliance dashboard's rate cards need screening data the seed
  does not create, two inbox shots need read notifications the fresh inbox
  lacks, and the event QR shot caught a check-in window that had closed.
  Each is an open seed gap recorded here so a future pass fixes the seeder
  rather than re-diagnosing the empty frame.
- **Time-sensitive fixtures expired twice mid-pass** — two container restarts
  cost hours each, and the "live right now" open house had ended by capture
  time. Re-seeded and re-shot: check-in monitoring, the room display, the
  guest sign-in pair and End Event. A side effect stands recorded: the guest
  event slides to the seed moment, so captures taken late at night carry an
  open house timed in the small hours, and the five guest-flow images were
  shot across different slides of that window — each internally right,
  mutually a few hours apart.
- **The guest sign-in prospect had no pipeline card on a fresh database** —
  the open-house step ran before any pipeline existed, so Rosa Delgado
  landed stage-less and unopenable. The step now runs after the pipeline
  seeding, and the one stranded record was rebuilt through the same public
  sign-in path.
- **The cast-ballot shot picked the wrong open election**: list order put the
  restricted issue vote first, whose in-app ballot correctly reads "No
  candidates for this position" (the documented position-races-only
  limitation). The shot now demands an open election with positions.
- **08-60 retargeted**: the station-board rebuild replaced the dashboard
  Notifications panel (per-card ✕, Clear All) with the My Updates feed; the
  guide section is rewritten against it. One stored notification still spelt
  a raw enum ("ShiftPosition.FIREFIGHTER") — written before the formatting
  fix landed; the row was removed rather than pictured, since the shipped
  code no longer produces it.
- **Caption drift corrected against the build** (the 03-45 pattern): the
  validation queue's controls are accept/notify/void icons with a bulk
  Accept, not "Validate and Void" buttons; module management has two
  category headers, the email-template sidebar six; organization settings
  carries no department-type selector; the screening record form opens from
  a member's row and so has no member picker; the template builder's section
  count and the operators-tab roster size are no longer promised as numbers.

Cross-image drift noted and accepted: notification badges differ between
shots captured minutes apart, and the apparatus label print reads six labels
against a seven-unit fleet — the missing one is U-1, unexplained and worth a
look next pass. The stray "Oakville Fire Department" facility record the
bootstrap creates also fronts two facility shots; real demo data, but the
sparse record makes a poor face for the detail page.

## The 2026-08-16 guide-09 re-capture — 22 images, every one opened

Arithmetic checked rather than glanced at: the weighted scorecard's
`10 + 30 = 40 of 50 = 80%` against its own per-section rows, the
failed-at-100% result (a critical step fails the test regardless of the
percentage — the banner says so, and it is the point of the shot), and the
unscored-steps dialog's "1 step still has no Pass or Fail" against the
`—/20` slider behind it.

**`Avg Score 66%` looks wrong and is right.** The four scored tests average
78%, but the stat filters on `validated_at` — 66% is the mean of the two
_validated_ results (84 and 48). Verified against the query rather than
assumed; recorded here because the next reader will do the same double-take.

### Each capture run was littering the demo database

Scoring a test is not a read. `09-16` and `09-18` drive the real scoring
screen, so **every run filed another practice attempt** against the demo
member — eleven had accumulated, all "Practice · Passed 100%", sorting above
the official attempts. The member's results panel had become a wall of
identical rows, and `09-21`'s prepare had grown a `maxHeight: 320px` clamp to
cope, whose comment cited "fifty-odd identical passes from other seeding".

`seed_skills_tests` now prunes them to one (the badge needs an example),
through the route that refuses anything but practice records — an official
result may carry a certification, which is why the API voids those instead.
With the pile gone, the clamp only cut the validated PASS the caption is
about, so it is removed and the step waits for that row instead.

**Worth generalising:** a workaround for a data problem outlives the problem
silently. The clamp still "worked" — it produced a clean image of the wrong
rows.

### A duplicate image, and a screen the guide invented

`09-04-template-builder` and `09-05-template-detail` were **byte-identical**
(same md5), the fourth instance of this shape after `02-21`/`02-41` and
`04-20`/`17-01`. The cause is not a capture bug: `/templates/{id}` and
`/templates/{id}/edit` both render `SkillTemplateBuilderPage`, so **there is
no separate read-only template detail page** — the guide described UI the
product does not have.

Corrected the way the 08-13 pass corrected its five: the prose now says a
template's own page _is_ the builder whether draft or published, the
redundant shot and its file are removed, and `09-04` keeps the picture.

## The 2026-08-16 guide-04 re-capture — 31 images, every one opened

Numbers cross-checked against the API rather than read for plausibility:
the event detail's 20/16/4 against its own twenty-row roster (four "Not
Going" badges, counted), the check-in monitor's 9-of-22 at 40.91% with a
134-minute average that matches its check-in timestamps, the analytics
type distribution summing to its 29-event total, and the voter-eligibility
roster's 22/22.

### One product defect, two shots pointed at the wrong state

**Meeting cards read "0 attendees 0 action items"** over a meeting whose
detail view showed eight and two. `MeetingResponse` declares both counts
and the cards render them, but the list query loads no children — the same
shape of gap as `creator_name` one method above it, which had already been
fixed this way. Two grouped counts, attached like the names, with tests.

- **`04-04-event-qr-code` pictured "Check-in Not Available".** It matched
  on `isUpcoming`, and the page gates the code behind its check-in window,
  so an event days out shows a disabled badge under a caption about members
  scanning to check in. Now matched on the in-progress event — the screen
  an officer actually puts on the wall.
- **`04-42-cast-ballot` pictured "No candidates for this position".** It
  took the first _open_ election, which is the restricted-ballot seat with
  an empty ballot. The elections list carries no candidate count, so no
  list-level match could tell a contested race from an empty one — it now
  resolves through each open election's candidates endpoint and lands on
  the Captain race with its two candidates, which is what the caption
  describes.

### Seeder: the Minutes page had moved out from under it

The page was rebuilt onto `/meetings` — first-class meeting records with
attendees, motions and action items — while the seeder still populated only
the older `/minutes-records` model. So a real minutes record sat behind a
"No Meeting Minutes" empty state, and the Action Items page was empty too.
Now seeded: an approved business meeting with attendees, motions and two
open action items, plus a draft board meeting; and a pending public event
request for the Requests tab. Both guarded **per title**, so a run that
dies between the two creates adds the missing one next pass rather than
deciding the step is done because one row exists.

**A step written and then deleted.** A `seed_guest_prospect` step was added
for the guest-sign-in prospect card before noticing that `04-33`'s prepare
already creates Rosa Delgado by submitting the public form — and says so in
its own comment. The manifest is part of the fixture surface; check it for
an existing producer before adding a seeder step for a record a shot needs.

Empty-state flags with their reasons: `04-31` ("No reminders" is the
reminder-audience select's own option; both guest settings are ticked) and
`04-34` (a walk-in guest has uploaded no documents; the Linked Events panel
the shot is about is populated).

## The 2026-08-16 guide-02 re-capture — 66 applied images, every one opened

The full guide-02 set was re-shot against the merged build and read against
its captions. Five capture failures and one empty state all traced to data
or contract gaps, each fixed at the root:

- **Review Submissions was empty** — nothing seeded a member training
  submission. The seeder now files one as the demo member (org defaults
  route it to pending review), and the queue also printed the submitter's
  raw UUID where a reviewer expects a name — the service now resolves
  display names in one batch query (`submitter_name` on the response).
- **The demo member had no approved shift report**, so My Reports and the
  My Shift Progress card were blank. Two causes: the filing loop's
  states-present early return never checked her, and when she was picked it
  could be as the trailing save-as-draft pair — a draft is invisible in My
  Reports, the same trap as the positional flag. The loop now swaps her off
  the tail and `_ensure_demo_member_report` files-and-approves one when the
  early return would otherwise skip filing.
- **Nothing locked, so the "Locked until you finish" line had no subject.**
  Hour auto-credit had quietly completed the old Hose Deployment gate. The
  probationary pipeline now also gates on the written exam — a knowledge
  test only an explicitly recorded result can complete — and 02-99 resolves
  the probationary enrollment directly instead of trusting list order.
- **Officer-only checklist steps existed nowhere.** The blueprint gained
  three (`member_visible: false`) with a backfill for existing databases,
  and a product fix: the member serializer **stripped** hidden steps, so
  the "+N more steps your officer records" fold line was unreachable in
  the real app while its component test asserted it against a payload the
  API never produced. Hidden steps now survive as anonymous stubs — count
  preserved, text and id redacted — with endpoint tests pinning the
  contract. 02-88 (member fold line), 02-87/02-94 (officer view with
  Officer-only badges) picture it end to end.
- **Label drift**: 02-32/33/35/36 were shot before the ReportContentDisplay
  fix landed here and read "5/5 — Excellent"; re-shot reading the
  department's configured "Exemplary".
- **02-89 removed as redundant** (02-100 pictures the same steps editor);
  **02-68-vector-category-mapping's stray file removed** and the entry now
  carries `holdBack` — the mapping table it describes is only creatable by
  a live vendor sync, per the "Held back deliberately" note.

Observations recorded, not fixed: course-type requirements completed via
certification equivalency read "Completed · 0 / 1 courses" (02-93, 02-105);
the print pages' "Active Certifications 0" and "Enrolled: 0" stats disagree
with the tables beside them (02-62, 02-63); the compliance-matrix print
overflows its sheet at 26 columns (02-65). All are what the product renders
today; they read as stat-wiring gaps worth a product pass.

## The 2026-08-16 guide-03 re-capture — 67 of 67, every changed image opened

The full guide-03 set was re-shot against the fresh database and the current
build, and **every changed image was opened and read against its caption**
before being committed. The pass surfaced four product defects (all fixed in
the same session), a set of capture flows stranded by the scheduling
redesign, and one lost fix re-instated.

### Product defects the images exposed, fixed here

1. **Apparatus types resolved by lowercased display name, not code.** The
   shift serializer and `ApparatusRef.type_slug` returned "ladder/aerial"
   where templates and the per-apparatus skill/task config are keyed on the
   code "ladder" — so ladder shifts could not resolve type-level
   equipment-check templates, and the batch shift-report form silently fell
   back to the generic skill list on every type whose name is not one word.
   The batch-form shots (03-63/03-64) now show the ladder-specific skills
   with the department's score labels, which is the proof of the fix.
2. **The platoon roster printed raw rank codes** ("deputy_chief"). Same
   defect class as the 2026-08-10 Impact Planner fix; now formatted through
   `useRanks().formatRank` (03-16).
3. **The redesigned dashboard timeline printed raw UTC ISO timestamps** —
   the my-shifts payload carries full datetimes where other shift payloads
   carry "HH:MM", and `formatTimeOfDay` falls back to the raw string. It
   also read "undefined of 4 filled" (the payload has no attendee_count).
   Both fixed; 03-60/03-62 re-shot clean.
4. **`POST /training/instructors/qualifications` refused every valid
   create** (UUID bound as dashless hex against String(36) columns) — see
   the fresh-database section below.

### The scheduling redesign stranded ten capture flows

The re-capture's first run failed 10 of 67 shots, all for the same reason:
prepares written against retired DOM. The dashboard's "My Upcoming Shifts" /
"Open Shifts" panels are now one **Next 7 Days** timeline (a
`section.card`); the crew board's open-seat button reads **Assign someone**;
the panel header's edit button is labelled just **Edit**; the My Shifts bulk
bar reads "awaiting your confirmation"; and the batch-report form's Evaluate
control renders only for an enrolled trainee who has not been reported on.
All re-pointed, and the guide's Dashboard Shift Display section rewritten
against the timeline.

### Fixture repairs behind the failures

- **The trainee-carrying ladder shift is now reserved.** Report filing walks
  newest-first, which is exactly where the evaluable trainees sit — one
  re-seed consumed them and the batch-form shots failed on a crew of
  "Already reported". `seed_shift_reports` now reserves the newest such
  shift and skips it when filing.
- **Swap and time-off requests are seeded** (a pending one of each, by the
  demo member). The old database showed rows in the Requests tab only as
  leftovers of manual runs; a fresh one rendered two empty states under a
  caption describing populated tables (03-11 now pictures both).
- **The shift reminder for 03-97 was generated by the scheduler's own
  task**, run once with the org's lookahead temporarily widened to 30 hours
  and restored afterwards. On a live stack these accrue organically; a
  fresh database's backend has not been running long enough.
- **03-22 re-points at the seeded Medic 3 Supply Check again.** The
  2026-08-11 fix for exactly this shot was lost in a later reconciliation,
  and the manifest had regressed to the blank `/new` form under an
  `allowEmptyState` flag — the precise failure mode that pass documented.

### Caption corrections, checked against the build

- `03-60-report-used-sheet`: the sheet is now the **Flag** dialog (the minus
  button is what records use); prose already said so, the alt did not.
- `03-54`: counts dropped from the caption — the property is open rows with
  per-seat controls and the bulk Fill All Open action.
- `03-58`: the form is titled "Assign someone to this shift"; prose updated
  ("Assign Member" no longer exists).
- `03-13`: the image is the patterns page with type badges, not a "creation
  page with the pattern type selector".
- Empty-state flags suppressed with reasons on 03-52 (select placeholder),
  03-54/03-57/03-05 ("No calls logged" belongs to a future shift's Calls
  sub-panel), 03-59 ("No stock" is the unlinked traffic-cones row's label).

Known-and-accepted in frame: 03-14's "Total Members 66" member-requirement
aggregation (documented product behaviour, guide carries the note), and the
08-16 toast in 03-37's corner.

## The 2026-08-16 pass — a fresh database, and the last two placeholders

The container was reclaimed, taking MariaDB (and its data directory), the
backend virtualenv and node_modules with it. The demo database this session
runs against was therefore **rebuilt from `bootstrap_demo.py`** — which the
08-13 notes predicted would happen someday and warned would carry a cost. Two
consequences worth separating:

- **Nothing already committed is invalidated by the rebuild.** The 421
  verified images record what the product rendered against the old data;
  the rebuild changes incidental values (ids, dates, spreads) only for
  captures taken from here on.
- **The clean rows the 08-13 pass wanted arrived for free.** The regress
  residue ("4 of 6 stages completed" on a stage-four applicant) is gone by
  construction.

### Three seeder crashes only a fresh database could expose

Every one of these sat in the create path, which a long-lived database never
re-runs — the skip-by-name guard means that code executes exactly once per
database, and it had not run since the blueprints last changed.

1. **The prospect create-loop advanced without the interview fallback.** The
   spread's advance knows to record an interview when a stage demands one; the
   create-path loop above it did not, so the first applicant that had to clear
   Interview aborted the whole step — Morgan Tran and Riley Bishop were never
   created at all. Both paths now share `_advance_recording_interview`.
2. **The equipment-check seed posted the engine template to the first three
   shifts regardless of apparatus.** The old database happened to return
   engines first; the fresh one ordered a medic shift into the front and the
   API correctly refused it ("Template is not applicable to this shift"),
   killing the step. The loop now filters to engine shifts with the
   `apparatus_type_of` helper that was already defined a page above it.
3. **`POST /training/instructors/qualifications` has refused every valid
   create since 2026-08-11 — a product bug, not a seeder one.** The
   tenant-scoping commit compares `users.id` (String(36)) against the
   `uuid.UUID` the endpoint's `model_dump()` produces, and aiomysql binds a
   UUID object in a representation that matches no stored row — so the guard
   answered "Invalid user_id" for references that were perfectly in-org. The
   unit test mocked the session and asserted compiled SQL, which is exactly
   the layer that cannot see a bind-value mismatch. Fixed by stringifying
   UUIDs at the service boundary; a new test pins the bound value itself.

### 01-37-elected-package-badge — the elected badge, produced by the vote

`01-membership.md:1156` wanted status Elected, a 35-3 tally and the linked
prospect on one screen, which the 08-13 analysis had already split: no screen
joins them. The caption now promises the drawer badge and cross-references
guide 14 for tallies.

`elected` is written in exactly one place — `_sync_package_statuses` when an
election closes — so the seeder now walks the product's own lifecycle
(`seed_membership_vote_outcome`): package marked `ready`, assigned to the
draft August election through the assign endpoint, election opened, the floor
vote recorded as a paper batch, attested by two officers, election closed.
Three things that pass mattered:

- **The hand-built ballot item was replaced, not reused.** It carried no
  `prospect_package_id`, so closing an election around it would have synced
  nothing — the assign endpoint is what writes the link.
- **The assign default of regular/life eligibility matches nobody** in a
  roster of active/administrative members, and an item with zero eligible
  voters rejects any tally as implausible. The package's
  `recommended_ballot_item` opens it to all types.
- **The tally is 18-2, not the guide's 35-3** — the plausibility check caps a
  batch at the eligible-voter count, and inventing 38 voters for a 22-member
  department would need the audited override for no documentary gain. The
  worked example keeps its numbers as prose.

Verified: drawer open on the applicant at Membership Vote, ELECTION PACKAGE
section reading **elected** with the "can now be converted" line, against an
API state of package `elected` / election `closed`.

Consequences recorded: the August election is now permanently closed in the
demo. `14-23-membership-ballot-item` still captures — Preview Ballot renders
for any manageable election with ballot items, status regardless — and its
committed image predates the close anyway. `GET /elections/{id}/results` on
this election answers 403 ("Results not available yet") because it was
seeded `results_visible_immediately: false`; the certified-results screens
picture the July election, which is `true`, so nothing loses its picture.

### 01-38-program-phase-progress — the phase view, on the page that shows all of it

`01-membership.md:1282`'s fractions (4/4, 0/6, 1/3, 0/2, 25%) were the worked
example's numbers, not any screen's. The 08-13 analysis established the
program detail carries no requirements inside its phases; the per-phase
grouping lives on the **enrollment progress** view. Confirmed on the fresh
database — where the blueprint's requirements actually seeded this time —
and shot as the member-facing **My Program Progress** page rather than the
admin Progress modal: the modal shows the same grouping but is height-capped
and scrolls, so a capture of it holds one phase group, and the caption is
about seeing all of them. (The fresh seed is also why this became capturable
at all: the old database's programs pre-dated requirements in the phase
payload, and the skip-by-name guard kept them that way.)

Verified: Probationary Firefighter Pipeline for the demo member — 4/13
requirements · 31% (matches the enrollment API), three phase groups with
per-requirement status, "You are here" on Phase 1, and a completed
requirement sitting inside not-yet-started Phase 2, which is the guide's
prior-credit story rendered. Caption rewritten against the screen; both
surfaces (member page, Enrollments-tab modal) named in prose.

**With these two, every placeholder in every guide is filled — 423 captured,
0 remaining.**

### Manifest housekeeping

`03-60-report-used-sheet` existed twice in the manifest, byte-identical — a
merge artifact. Ids double as output filenames, so duplicates capture twice
and the later silently overwrites the earlier; identical copies are the lucky
case. One removed, and the manifest now **throws at import on any duplicate
id**, beside the existing mutates-last invariant.

### Two sessions re-captured guide 03 at once — how the sets were reconciled

The 08-11 "two sessions shot the same screens" incident repeated at full
scale: this session and a parallel one each re-captured the whole guide
against their own rebuilt databases, fixed overlapping defect sets, and
pushed within the hour. The committed images are the **parallel session's
set** (the "67 of 67" record above), chosen on evidence rather than
recency: its captures postdate two frontend fixes this session's did not
carry — the platoon-rank formatting (this session's `03-16` showed raw
`deputy_chief` enums) and the same dashboard-timeline repairs both sessions
wrote independently.

What survived from this session's pass, verified over its own captures and
kept in the merge:

- **The `ReportContentDisplay` label fix** — the expanded report card and
  review modal hardcoded the sample skill-score scale while scoring uses the
  department's configured one, so a skill scored "Exemplary" displayed
  "5/5 — Excellent". Both sessions' `03-49` and `03-62-flagged-queue`
  captures predate the fix on the card path; the two were re-shot after the
  merge so the pictured labels match the shipped code.
- **The seeder's `seed_membership_vote_outcome`, batch-trainee, reminder and
  review-queue-depth fixtures** merged with the parallel session's versions
  of the same repairs — where both wrote one (`seed_scheduling_requests`),
  the merge kept the version whose swap request deliberately targets the
  member's furthest-out shift, so the swap-dialog shot's card keeps its
  plain Swap button, plus this session's near-term seat for the timeline's
  "Yours" pill.
- **`--only` accepts a comma-separated prefix list**, because re-running
  exactly the failed shots previously meant one invocation per shot.
- The apparatus-type mismatch both sessions found was fixed at **opposite
  ends**: this session re-keyed the seeder vocabulary to the lowercased
  display name, the parallel one made `ApparatusRef.type_slug` prefer the
  **code** — the right end, since UI-configured departments already key on
  codes. The seeder keys are back on codes and the backend fix stands.

The independent verification passes agreed with the parallel session's
verdicts everywhere they overlapped, including the reservations: `03-14`'s
member-requirement-pairs arithmetic, the `03-15`/`03-32` shared frame, and
notification-badge drift between shots captured minutes apart.

## The 2026-08-13 guide-by-guide re-verification

Every image below was **opened and read against its caption** before being
committed. Images that changed but were not opened are deliberately left
uncommitted rather than taken on trust — see the navigation incident below for
why that rule exists.

### The "Elected package with its tally" is three things on two screens

`01-membership.md:1156` asks for "the Elections module showing Alex Rivera's
election package with status **Elected**, vote tally (35-3), and the linked
prospect record". No single screen shows those together.

`ElectionPackageSection` renders the package status as a badge — `elected` gets
the same emerald treatment as `ready`, and the text is the status with
underscores swapped for spaces — inside the applicant drawer, beside the
applicant it belongs to. That covers the status and the linked prospect. **The
tally is not there**: vote counts live on the election results screen, which
guide 14 already photographs, and nothing joins the two.

So the caption needs splitting the way `09-18`'s did: the package badge in the
drawer, with the tally described in prose and cross-referenced to guide 14.

Reaching `elected` at all is the same seed problem as the ballot-send shot. The
seeded packages are `draft`; getting one to `elected` needs the package on a
ballot, the election closed, and results applied back. That is the same open
election the send shot needs, so the two should be built together rather than
seeded twice.

**All three remaining placeholders are now characterised** — none is a mystery,
each is a bounded piece of demo-data work, and two of them share a fixture.

### A currency survey after the main merges — the navigation is fine, guide 03 is not

Code changed under six guides since their images were captured. Checked in
order of blast radius:

**The navigation refactor is not a problem.** `SideNavigation.tsx`,
`TopNavigation.tsx` and a new `adminNavigation.ts` changed how admin
permissions are computed, and one item's gate moved from `forms.view` to
`forms.manage` — which could have altered the sidebar in every one of the ~420
images. Re-captured a representative admin page and compared: **the sidebar
renders identically** for the demo administrator. The only differences were
time drift ("3d in stage" to "6d in stage", notification badge 12 to 11), so
that capture was discarded rather than committed as churn.

**Guide 03 is the real exposure.** `SchedulingPage.tsx` plus a **new**
`SchedulingHeader.tsx` and the templates / patterns / platoons / settings /
admin-reports pages all changed, across 80 shots. A `--only 03-6` re-capture
produced 11 changed images out of 13.

Shots on routes whose components changed, as an upper bound rather than a
verified count:

| Shots | Guide             | Changed underneath                                                                                                                 |
| ----: | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
|    80 | 03 scheduling     | `SchedulingPage`, new `SchedulingHeader`, templates/patterns/platoons/settings/admin-reports, `shiftSettingsApi`                   |
|    67 | 02 training       | `CreateTrainingSessionPage`, `SubmitTrainingPage`, `TrainingLinkageFields`, `TrainingSessionLinkageCard`, `useTrainingLinkageData` |
|    22 | 04 events         | `EventForm`, `EventDetailPage`, `EventsPage`, `types/event.ts`                                                                     |
|    17 | 09 skills testing | `ActiveSkillTestPage`, `ScoreBreakdownPanel`, `SkillTemplateBuilderPage`, `skillTestTallies`, both print pages                     |
|    12 | 06 apparatus      | `ApparatusListPage`, `ApparatusDetailHeader`, `ApparatusFormPage`                                                                  |
|     2 | 08 admin          | `ErrorMonitoringPage`, `RoleManagementPage`                                                                                        |

`Breadcrumbs`, `PageTransition` and `CommandPalette` also changed, and they
appear across many guides — if their rendered output moved at all the exposure
is wider than the table.

Of the 11 changed guide-03 images, **only `03-63-batch-report-form` was opened
and is committed**; the other ten were reverted unopened. They are not wrong,
they are unverified, and the rule that has caught every real defect this session
is that those are not the same thing.

### The program detail has requirement totals, but not the caption's member progress

`01-membership.md:1282` wants Phase 1 (Complete, 4/4), Phase 2 (In Progress,
0/6) and so on. A program's detail response — `GET
/training/programs/programs/{id}` — returns phases (`name`, `phase_number`,
`prerequisite_phase_ids`, `requires_manual_advancement`, `time_limit_days`)
**and top-level `requirements`, `total_requirements` and `total_required`**.
Those are structural totals for the program as designed, though — the
caption's Complete/In-Progress fractions are a member's progress, which
belongs to an enrolment view. Note that `02-90-phase-prerequisites` is a
structural shot too (the phase editor's prerequisite picker, no member
progress in frame), so it is not the cross-reference for the enrolment
fractions; that screenshot still needs to come from a member's enrolment
screen.

That makes this the same split as `09-18` and `01-membership.md:1156`: the
program detail can show the phase structure, its gating, and the designed
requirement counts; the per-phase member progress belongs to a
cross-reference. Confirm against the enrolment view before rewriting the
caption — this was established from the API shape alone, and the screen has
not been opened yet.

### The skip banner is right; the toast beside it is a demo artifact

The fixture works. `Operations Committee Seat — Restricted Ballot` is open with
its one item restricted to `operational`, and pressing Send Ballot Emails
produces exactly the banner the guide describes:

> **2 member(s) skipped when sending ballots** — Jonah Whitfield: membership
> type not eligible for 1/1 item(s) (requires: operational; member has:
> administrative). Bram Hollis: same.

**The first capture was thrown away, because the toast above the banner read
"Ballots sent to 0 voter(s), 20 failed, 2 skipped".** Email is not configured in
this demo, so every actual send fails. The skip logic is genuine and the banner
is exactly what a department would see; the failure count is an artifact of the
environment, and a reader shown "0 sent, 20 failed" under a caption about
skipped members would draw the wrong conclusion.

The fix was to wait the toast out. It is transient and the banner is not, so the
prepare step now waits for the count text to disappear before shooting. A
`selector` was tried first and abandoned — the banner is a plain div with no test
id and no role.

`allowEmptyState` is set for a real reason: the page also says "No votes cast
yet", which is correct for an election whose ballots went out seconds ago and is
not what this pictures.

Verified: the banner names Jonah Whitfield and Bram Hollis with the eligibility
reason, over the election that produced it, with no toast in frame.

Everything else is committed and working: the seeded election, the
`mutatesSeedData` flag (the manifest invariant caught the shot in the wrong
position on the first run and named all eleven shots that would have been
affected), and the caption rewritten against the two things that actually
report a send — a transient toast with the counts and a persistent banner with
the names.

### The demo department now has two membership types, and `/profile` was never going to give it one

The blocker below is cleared. Bram Hollis and Jonah Whitfield are
`administrative`; the other twenty stay `active`. Flipping two existing members
rather than adding two keeps "Members on file" at 22, which several captured
images state outright, and both were chosen because **no shot in `manifest.mjs`
mentions either name** — so a different membership type on them cannot silently
change an image already verified.

**The first attempt looked like it worked and did nothing.** The seeder patched
`/users/{id}/profile`, which is where its rank repair goes. `UserUpdate` has no
`membership_type` field, so the request was accepted and the value dropped —
the same shape as `supporting_statement` being sent top-level on an election
package. The tier change has its own endpoint,
`PATCH /users/{id}/membership-type`, which also validates the value against the
department's configured tiers. Worth the habit: when a write appears to succeed
and the value does not appear, check the schema on the route rather than the
column.

That unblocks the shared fixture. Next: an open election whose item restricts
`eligible_voter_types` to `operational`, which will now skip exactly these two
with a real reason.

### The ballot-send shot is blocked on the demo having only one membership type

`14-elections.md:352` needs a send that skips somebody. The skip reason is
generated by `_user_has_role_type`: an item restricted to
`eligible_voter_types` skips a member whose `membership_type` is outside it,
with the reason "Requires voter type(s): operational; member has:
administrative".

**All 22 seeded members are `active`.** So an item restricted to `operational`
skips nobody and one restricted to `administrative` skips everybody — neither is
the "N sent, M skipped" mix the shot is about. The demo department has no
administrative members at all, which is a seed gap beyond this screenshot: the
conversion modal offers "Administrative — Non-operational support role" as one
of two choices and nothing in the demo has ever taken it.

Two ways to close it, and they are not equivalent:

- **Flip two existing members to `administrative`.** No change to any count, so
  no other image is invalidated — but `membership_type` is displayed on member
  detail screens, so the two chosen would need checking against the shots that
  picture them.
- **Add two administrative members.** Cleaner in intent, but "Members on file"
  goes 22 → 24 and every image showing a member total or a full roster has to be
  re-captured and re-verified.

The first is the smaller blast radius and is probably right, but it is a
deliberate choice about the demo department's composition rather than a
mechanical fix, so it is recorded here rather than taken on a whim. Once there
are two membership types, the rest of the shot is already designed: a new open
election whose item restricts to `operational` (an open election refuses ballot
edits, so the restriction has to be set at creation), and a prepare step that
presses Send Ballots and waits for the banner — flagged `mutatesSeedData`, which
the manifest invariant will then force to the end of guide 14.

### The offline "Queued for sync" badge does not exist either

`03-scheduling.md` asked for an offline banner, a **"Queued for sync" badge on a
pending report**, and a count. Two of the three are real. Queued reports live in
IndexedDB and are never listed individually, so there is no per-report badge to
photograph — what exists is the banner, which carries `(N pending)` once
something is queued, and a second banner reading "Syncing N queued reports…"
while the queue drains. Caption corrected to the banner, with the other two
states described in prose.

**Faked offline in the page, not in the browser context.** `context.setOffline(
true)` would have been the obvious move and would have broken every shot after
this one: the context is shared across the run and nothing in the harness
restores it. `useOnlineStatus` reads `navigator.onLine` and listens for the
window events, both of which can be overridden inside the one page — and a
navigation resets it, so the fake cannot outlive its own shot. Confirmed by
re-capturing `03-61-review-queue-batch` afterwards, which came out unchanged.

### A merge left the database stamped at a revision that no longer exists

Merging the other session's work renumbered two migrations off main's new
`20260813` revisions, and the demo database was still stamped `20260812_0006`.
The backend then refused to start at all — correctly: "Refusing destructive
fresh-database initialization; restore the missing migration or repair the
revision explicitly."

Both renamed migrations had already run under their old ids, so the schema was
at head and only the label was stale. `alembic stamp` could not fix it (it
cannot resolve the current revision to move from); `alembic stamp --purge
20260813_0007` clears the version row and re-stamps, which is the repair the
error message is asking for. Worth knowing before anyone reaches for a database
drop after a migration renumber.

### The shift-report table guide 02 described does not exist

`02-training.md` asked for "the Shift Reports tab showing the batch of 26
reports filed for the Q2 drill, with columns for trainee name, apparatus, hours
(all showing 4), skills observed count, and approval status".

Three things were wrong with that. The tab is under **Scheduling**, not
Training — the same screen guide 03 already photographs. There is no per-drill
table of individual reports: the tab rolls them up **per crew member**. And the
columns are Crew member, Reports, Hours, Calls and Avg Rating — not one of the
five named.

Caption rewritten against the table that exists, with a note saying plainly that
the old columns do not, and `02-90-crew-summary-table` captured against it.
Verified: ten crew members, one report each, hours from 8.0 to 12.0, calls and
ratings per row.

### Groundwork on the last five: what each one actually needs

No images this pass — both candidates examined turned out to need seed work
larger than a tick, and guessing at it would have produced a picture that did
not match its caption. Written down so the next pass starts from the answer.

**`14-elections.md:352` — the ballot send confirmation.** The caption's "42
ballots sent, 3 skipped" is not what the screen says. `EmailBallotResponse`
carries `recipients_count`, `failed_count`, `skipped_count` and
`skipped_details`, and `ElectionDetailPage` renders a toast reading "Ballots
sent to N voter(s), M skipped (see banner below)" plus a **persistent banner**
listing each skipped member and reason. The caption should be rewritten against
those two, not the invented numbers.

Producing a skip needs an eligibility mismatch — the reasons are "No eligible
ballot items — role type and attendance did not match any item requirements" and
"Not eligible for any position … membership type does not match any position's
voter-type rules". So the seed needs an **open** election whose items restrict
`eligible_voter_types`, with members on file who fall outside it. Sending is a
real mutation, so the shot must be flagged `mutatesSeedData` and will be forced
last in guide 14 by the manifest's own invariant.

**`01-membership.md:1282` — the training program phases.** The caption asks for
Phase 1 (Complete, 4/4), Phase 2 (In Progress, 0/6), Phase 3 (Locked, 1/3
pre-credited), Phase 4 (Locked, 0/2) and a 25% bar — numbers from the guide's
worked example, not from any screen. The three seeded programs have two or three
phases each and **zero requirements in any phase**, so no progress fraction can
render at all. Filling this means seeding a four-phase program with 4/6/3/2
requirements and an enrolment part-way through it, or narrowing the caption to
what a program detail can show. The former is a day's demo data; the latter
should be a deliberate choice, not a silent one.

### A membership vote nothing could picture, and a field that silently discarded writes

`14-elections.md:843` wanted a membership approval ballot item. None existed
anywhere: every seeded ballot was position races and a bylaw amendment, and Sam
Okafor's election package was still `draft`, so the item type the whole
prospective-member pipeline exists to produce had never reached a ballot.

**The item had to go on a draft election, and that is correct.** An open
election refuses ballot edits — "Only `end_date` can be updated while voting is
active" — because a cast vote references an item id. So the seeder now creates a
draft _Membership Vote — August Business Meeting_ carrying the item, which is
also the order the guide's own workflow describes: package marked ready,
secretary adds it, then the election opens.

**The election detail page does not render Approve/Deny; the ballot preview
does.** `BallotPreviewModal` draws the item title, its description, and the
Approve / Deny / Abstain options; `ElectionDetailPage` only lists items and
offers **Preview Ballot**. The placeholder was retargeted at the preview, and
the prose corrected — it had promised "Approve/Deny" and the screen offers
Abstain too.

**`supporting_statement` is not a column.** It lives inside `package_config`,
and the API accepts a top-level `supporting_statement` on the package endpoint
while storing nothing. Two seeder runs "filled in" that field and the box stayed
empty, which is why `15-08-election-package` had always pictured an empty
Supporting Statement — the one part of a package that decides a membership vote.
Now nested correctly, and backfilled for a package that already exists, so the
panel and the ballot item quote the same words from one shared constant.

**Third time this session for the same trap.** The seeder skips a record that
already exists by name — templates, elections, packages — so anything added to a
blueprint afterwards never reaches a long-lived demo database. Each case has
needed its own backfill. Worth a general answer rather than a fourth one.

Verified: `14-23-membership-ballot-item` shows "Membership Approval — Sam
Okafor" with the coordinator's statement and Approve / Deny / Abstain, under the
BALLOT PREVIEW banner. `15-08-election-package` re-checked with the statement now
filled.

### The storefront Payments tab is unphotographable, and that is the correct design

`store_payment_events` rows are written from exactly one place — the public
PayPal webhook, which verifies every payload against PayPal's
verify-webhook-signature API before recording anything. The authenticated
storefront API offers `GET /payments` and apply/ignore; there is no create.

That is right for a ledger of what an external provider reported, and it means a
demo department has an empty Payments tab permanently. The placeholder is
retired with the reason written into the guide itself, alongside the elections
public ballot and the Salesforce connection.

### Next tick's groundwork on guide 14

`14-elections.md:843` wants an election detail page showing a **membership
approval** ballot item. None exists: the seeder creates elections with position
and bylaw items only, and Sam Okafor's election package is still `draft`, so it
has never reached a ballot. `BallotBuilder.tsx` does support the type
(`membership_approval`, labelled "Membership Approval"), and `ballot_items` is a
JSON column on the election, so seeding one is a bounded change.

One thing to settle when doing it: the placeholder also asks for "Approve/Deny
voting options", and `KNOWN_LIMITATIONS.md` already records that the in-app
ballot only renders position races. The admin detail page may show the item and
its supporting statement without any vote controls — in which case the caption
needs narrowing to what the page actually offers, the way `09-18`'s did.

### A repair pass that had never repaired anything

`09-skills-testing.md`'s read-aloud placeholder wanted a statement criterion
with the clock button. The seeder's blueprint declared a statement criterion,
and the database held **none** — because `seed_skills_testing` skips a template
that already exists by name, and the `_repair_criterion_types` pass written to
cover exactly that case walks `template["sections"]` on the **list** response,
which returns `section_count` and `criteria_count` and no sections at all.

So the pass iterated an empty list, found nothing to fix, and reported success.
It had been a no-op since it was written — which means the `"checkbox"`
criteria it exists to rewrite were still on file the whole time. Both passes now
hydrate each template from its detail endpoint first, and a new
`_backfill_missing_criteria` adds criteria the blueprint has gained since a
template was created, matching on label within section and never editing or
removing an existing one.

**A test snapshots the sheet it started with**, deliberately, so a candidate is
scored against what they were shown. That also meant the seeded in-progress test
could never show a criterion added afterwards. The seeder now compares the
snapshot against the live template and cancels a stale in-progress test so a
fresh one is made — safe in a demo database, where nobody is mid-evaluation.

`09-18-statement-starts-clock` verified: the read-aloud box, the START CLOCK &
READ button beneath it, and the line explaining that this statement is read
inside the time limit. The button only exists while the clock is stopped —
opening an in-progress test resumes the timer, so the shot pauses it first.

The placeholder had asked for two states in one image. Narrowed to the button;
the state after the tap is now described in prose beside it, since one image
cannot be both.

**Worth an owner's attention:** the demo database holds **50 completed skills
tests for one member** on one template, one per seeder run. Nothing pictures
them and nothing breaks, but the seeder is appending rather than topping up.

### The Sign Up button was documented as doing a check it does not do

`03-scheduling.md` asked for a screenshot contrasting an open shift with a
**Sign Up** button against one without, "because the member's rank doesn't
qualify". No such contrast exists to photograph: `Dashboard.tsx` renders the
button on every open shift and only fetches eligibility when it is pressed —
the expanded card then shows either a position dropdown or "Not eligible for
this shift."

Verified against the demo member: `nbelhaj` holds the `firefighter` rank, the
shift has three open positions (officer, driver, firefighter), and the dropdown
offers **Firefighter alone**. The filtering is real; it just happens a tap later
than the guide claimed.

Prose corrected, the rough edge written up in `KNOWN_LIMITATIONS.md`, and
`03-62-dashboard-signup-positions` now pictures the expanded card — the
dropdown the caption is about, with the unconditional Sign Up buttons on the
cards below it visible in the same frame.

### The applicant progress track was drawn in the wrong order, and Back never undid an advance

Opening `15-05-applicant-actions` to check its action bar caught two product
defects behind it, neither of them about screenshots.

**1. The progress track was drawn in whatever order the database returned.**
`step_progress` has no `ORDER BY`, and `mapProspectToApplicant` mapped it
straight through into `stage_history`, which the drawer draws as a
left-to-right progress track. For Jordan Fields the API returned sort orders
3, 0, 4, 5, 1, 2 — so the picture showed him finishing Background & Medical
before Application Received. The public application-status page already sorts
by `sort_order` and carries a comment explaining why; the drawer and the
election-package snapshot never got the same treatment. All three now sort.

**2. `regress_prospect` moved the pointer and nothing else.** It set the
previous step back to `in_progress` but left its `completed_at` stamp, and left
the step being vacated `in_progress` forever. The drawer counts stamps for
"N of 6 stages completed" and draws a green tick per stamp, so an applicant
sent **Back** to stage two still read as having completed it, with stage three
still drawn as live underneath — a Back click that visibly changed nothing.
Both are now cleared, and the test asserts the round trip: regress clears the
stamp, and advancing again puts one back.

**The demo database still carries the residue, and the images show it.** Six of
seven seeded applicants have `step_progress` rows that disagree with their
current stage — stages behind the pointer left `in_progress`, stages ahead of
it holding completion stamps — all written by the buggy regress before it was
fixed. It cannot recur, but it does not self-heal: the only API routes that
touch these rows are advance and regress, and normalising a stage _ahead_ of an
applicant requires advancing them onto it first, which for the vote stage
creates an election package and would change guide 14's images too.

So `15-05-applicant-actions` is committed with its ordering fixed and its
counter still reading "4 of 6 stages completed" for an applicant on stage four.
**That number is wrong and is known to be wrong.** Clearing it needs a decision
this loop should not take on its own — rebuilding the demo database from
`bootstrap_demo.py` would produce clean rows by construction, and would also
invalidate every one of the 415 images verified against the current one.

### 15-09-convert-modal, and prose describing three fields that do not exist

Re-pointed off `openApplicantDrawer("Riley Bishop")` — with the spread restored
Riley is no longer on the final stage, so the Convert button was not there to
click — and onto `openApplicantAtStage("Onboarding")`, the property the caption
is actually about. `15-05` was re-pointed the same way, at
`Background & Medical`, because both stage-movement buttons only render for an
applicant with somewhere to go in each direction.

`openApplicantDrawer` had no call sites left after that and is deleted.

Opening the result showed the guide listing **Membership ID** ("auto-generated
or manual entry") and **Roles** ("initial role assignments") among the modal's
fields. Neither exists in `ConversionModal.tsx`. It also described one screen
where there are two steps, and missed Middle Name, Hire Date, Emergency Contact
and Notes. Rewritten against the component.

### The same wrong inference in three components, and an email running through a phone number

`15-07-interview-form` pictured a panel headed "Current Stage: Application
Received" with **Application Received ticked as completed** two lines below it.
The applicant drawer had already been fixed for this; the interview page's
Pipeline Progress and the conversion modal's "Completed N of M stages" were
doing the same thing — deciding a stage was finished from the presence of a
`completed_at` timestamp. All three now read the progress record's own status,
which is the field that actually says so.

The same shot also had the applicant's email running straight through the phone
number in the next grid column. A flex child does not shrink below its content,
so any address longer than half the card overlapped its neighbour. `min-w-0` on
the row and `break-all` on the address; the icon no longer shrinks either.

### Two bulk-action bars, and a duplicate image pair

`15-11-table-bulk-actions` shows **two** bulk-action bars stacked, both reading
"3 selected", offering different sets of buttons from two different components.
The guide said "an action bar appears" and listed the buttons as
"**Advance** / **Advance All**" as though they were alternate labels. They are
two bars. The guide now says so, and the duplication is written up in
`KNOWN_LIMITATIONS.md` — which bar survives is a design decision, not one for
this loop.

`15-01-pipeline-board` and `15-04-kanban-board` are byte-identical: the kanban
board is the default view, and both captions genuinely describe it. A third
legitimate duplicate pair alongside the two already recorded below; no hash
sweep needs to re-investigate it.

### The destructive shot had drifted, and now the manifest refuses to let it

`15-09-bulk-action-result` runs a real bulk advance, and the comment beside it
says that is why it sits last among the 15-\* shots. It was fourth. Every shot
below it that finds its applicant by stage was matching against a board this
had already advanced — which is what `15-05-applicant-actions` was timing out
on, fifteen seconds of locator failure with nothing pointing at the cause.

Moved back to last, and the manifest now **throws at import** if a shot flagged
`mutatesSeedData` has any shot of the same guide after it. A comment did not
survive one unrelated edit; the invariant now fails loudly at the top of a
capture run instead of silently four shots later.

### 15-08-election-package was pointing at the wrong applicant, twice over

Its caption promises "an applicant at the vote", and the election-package
section only renders on an `election_vote` stage. Two separate things stopped
that being true, and the first hid the second:

1. **The seeder could not restore the spread.** `_spread_prospects_across_stages`
   only moved applicants _forward_, so once `15-09-bulk-action-result`'s real
   bulk advance had run, every applicant was parked at the final stage —
   permanently, across re-seeds. The manifest assumes a re-seed restores the
   mixed page; that only holds if the spread can move applicants back, which it
   now does via `/regress`. The board goes back to one applicant per stage.
2. **The shot named its applicant.** `openApplicantDrawer("Morgan Tran")` tied
   it to one seeding order. With the spread restored, Morgan Tran is at
   Interview. A new `openApplicantAtStage("Membership Vote")` matches the
   table's Current Stage column instead, so a different spread cannot silently
   point the shot at somebody who is not at the vote.

Verified: the drawer now shows Sam Okafor at Membership Vote with the ELECTION
PACKAGE section — status, name, membership type, coordinator notes and
supporting statement — over a board spread across all six stages.

`15-12-pipeline-stats` also verified: the four stat cards, Total Active 7.

### A regression I introduced, and the capture-order trap that exposed it

**I broke an endpoint two ticks earlier and only found it now.** Declaring
`program` on `ProgramEnrollmentResponse` — the fix for the dashboard's unnamed
pipelines — turned it into a serialization-time read, so any query feeding that
model without eager-loading it lazy-loads mid-await and answers **500**.
`get_member_enrollments` loads it, which is why the dashboard worked and the
gates stayed green; `get_program_enrollments` did not, so the program detail
view's Enrollments tab 500'd. The seeder caught it, not the test suite. Fixed,
with a test that asserts every enrollment-returning query selects the
relationship rather than asserting the one that bit us.

That is the same failure mode as the prospect-advance 500 I had just fixed —
introduced by me, one tick later, while fixing something else.

**The capture run mutates the demo data, and I forgot.**
`15-09-bulk-action-result` performs a real bulk advance; the manifest says so
beside it, says that is why it sits last among the 15-\* shots, and says the
seeder restores the mixed page. Re-running `--only 15-` several times without
re-seeding pushed six of seven applicants to the final stage, which is why
`15-08-election-package` came out showing an applicant at Onboarding under a
caption about the vote stage. Not a defect in the shot — a defect in how I ran
it. **Re-seed before capturing guide 15.**

### 15-prospective-members — the two "failures" are not the same kind of thing

**`15-02-board-truncated` is skipped by design, not broken.** It needs a
pipeline past the board's 200-card ceiling, which the ordinary seed
deliberately does not create — the manifest says so beside the entry and points
at `seed_demo_data.py --bulk-prospects`. Nothing to fix; it is capturable on
demand.

**`15-13-application-status` cannot be captured the way it is written.** Its
prepare step reads the applicant's `status_token` from the prospect detail
response, and the comment beside it still says "the token is only on the
prospect _detail_ response — the list omits it". That stopped being true: a
security fix removed `status_token` from responses entirely, because it is the
credential behind the public application-status page and was leaking into the
kanban board. The tokens exist — all seven applicants have one in the database —
but nothing over the API will hand one out, and it should not.

So the shot needs a different route to a status URL (minted server-side by the
seeder and passed to the capture, the way `10-11-public-form-dark` resolves its
slug), or it needs retiring. Not decided here; recorded so the next tick does
not re-diagnose it.

**The board spread is improved but still not even.** `_spread_prospects_across_stages`
now advances applicants who are behind their target stage, recording a real
interview where the stage demands one rather than skipping it — a skip is a
different thing and shows on the applicant's progress track. That took the board
from two occupied stages to four. It cannot pull anyone _back_, so the first two
stages stay empty until either more applicants are seeded or the existing ones
are regressed.

### 15-prospective-members — in progress, and it found the advance bug's real cost

`15-01-pipeline-board` and `15-14-applicant-drawer-overview` are populated now
that the pipeline has stages, and their empty-state flags are the same false
positive as guide 01's (some columns legitimately read "No applicants";
a drawer for an applicant with no uploads reads "No documents yet"). Suppressed
with that reasoning beside the entries.

**`15-09-bulk-action-result` was displaying the 500 verbatim.** Its toast read
"Skipped 7: Rosa Delgado (**Action failed**); Morgan Tran (Prospect is already
at the final stage) … and 4 more" — every one of seven applicants refused, four
of them by the MissingGreenlet crash. So the advance bug was not an edge case:
it blocked the whole bulk workflow, and this screenshot was documenting it as
normal behaviour.

Fixed rather than filed. The audit that entry said was needed turned out to be
one line long: `_validate_step_completion` reads exactly one relationship that
`get_prospect` did not eager-load, `interviews`. Adding it lets the validator
actually run, and the endpoint's existing `ValueError` → 409 handling does the
rest. The toast now reads "This step requires at least 1 interview(s); only 0
recorded." — a real business-rule answer instead of a crash. A second test
guards the audit rather than the single relationship, failing if the validator
ever reads another unloaded one.

Two shots still failing, both about seed data rather than code:
`15-02-board-truncated` (`locator.waitFor` timeout — the board needs more
applicants than fit a column) and `15-13-application-status` ("no applicant
carries a status token").

The board's spread is also lopsided — four in Interview, three in Onboarding,
three stages empty — because the seeder's advance loop only ran for
newly-created prospects, and the ones already in the database could not be
moved while advance was crashing. Now that it returns a proper 409, spreading
them needs interviews recorded first.

### 01-membership — images complete, 19 of 19 verified

The last five opened and current: `01-05-add-member-form`,
`01-06-import-members`, `01-07-admin-member-edit`,
`01-08-member-audit-history`, `01-36-membership-number-field`. Nothing in them
contradicted its caption — the import page's nine-step instructions match the
validation the review screen actually applies, and the edit form's
"Exempt from Compliance" control carries the explanation the guide relies on.

Guide 01's **two placeholders remain open** and are the only outstanding work
here: an election package showing status "Elected" with a 35-3 tally and a
linked prospect record, and a training-program phase view (Phase 1 Complete
4/4, Phase 2 In Progress 0/6, Phase 3 Locked 1/3 pre-credited, Phase 4 Locked
0/2, overall 25%).

### 01-membership — earlier tick, 14 of 19 changed images verified

Seven more opened and current: `01-01-member-directory`, `01-11-create-waiver`,
`01-19-create-waiver`, `01-23-print-member-badges`,
`01-24-delete-member-modal`, `01-32-duplicate-applicant-warning`,
`01-33-import-review-rejected-rows`. Each shows what its caption promises —
notably the delete modal's Deactivate/Permanently Delete split with its
records-affected counts and type-to-confirm, and the import review's four
rejected rows with a per-line reason apiece.

**A third legitimate duplicate pair.** `01-11-create-waiver` and
`01-19-create-waiver` are **byte-identical** — same md5, same
`/members/admin/waivers` route, two guide locations describing the same form.
Recorded here alongside `03-15`/`03-32` and `03-02`/`03-08` so a future hash
sweep does not re-investigate it.

Still to verify: `01-05-add-member-form`, `01-06-import-members`,
`01-07-admin-member-edit`, `01-08-member-audit-history`,
`01-36-membership-number-field`. Guide 01's two placeholders are also still
open.

### 01-membership — earlier tick, 7 of 19 changed images verified

Beyond the three below: `01-02-member-profile` (compliance summary, training,
contacts, employment — all populated), `01-22-member-lifecycle` (already
re-captioned by an earlier pass as the Members Admin hub, and matches),
`01-30-evoc-operator-modal` and `01-35-applicant-drawer-final-stage`.

Both of the last two were flagged as empty states and both are **false
positives**, now suppressed with the reasoning recorded beside the entry:

- `01-30` — "No EVOC level" is the select's placeholder option, present in the
  DOM on every operator including this one, which has Level 1 selected and its
  certification and licence dates filled.
- `01-35` — "No checklist data recorded yet" is the Checklist Progress section
  for an applicant whose onboarding checklist has not been started. The shot is
  about reaching the **final** stage and the **Convert** action it unlocks, and
  both render, along with two uploaded documents.

Still to verify, changed but not yet opened: `01-01-member-directory`,
`01-05-add-member-form`, `01-06-import-members`, `01-07-admin-member-edit`,
`01-08-member-audit-history`, `01-11-create-waiver`, `01-19-create-waiver`,
`01-23-print-member-badges`, `01-24-delete-member-modal`,
`01-32-duplicate-applicant-warning`, `01-33-import-review-rejected-rows`,
`01-36-membership-number-field`. Guide 01's two placeholders are also still
open.

`01-11` and `01-19` are a duplicate pair — both resize 920→938 identically —
and should be checked together when they are opened.

### 01-membership — the "No applicants" gap, closed

Three shots (`01-10-prospective-pipeline`, `01-25-applicant-action-bar`,
`01-26-print-applicant-badges`) pictured an empty board while seven active
applicants sat in the database. **The pipeline had no stages at all.**

The seeder does send a `steps` payload — but only when it _creates_ the
pipeline, and the guard above that skips creation once a pipeline of the same
name exists. A database seeded before that payload was added therefore keeps a
stage-less pipeline forever, and a pipeline with no stages has no board columns,
so no applicant can be placed. `_backfill_pipeline_stages` now repairs an
existing pipeline, idempotent on the state.

All three images are correct now: the board shows Total Active 7 with cards in
Interview, the bulk bar shows "3 selected" with Print Badges / Advance All /
Reject All, and the drawer shows Rosa Delgado's stage, linked event, interview
requirement and full action bar.

The empty-state flag on these three is a **false positive** and is now
suppressed with a note: a board that spreads seven applicants across six stages
necessarily leaves columns reading "No applicants", and a drawer for an
applicant who has uploaded nothing reads "No documents yet". Neither means the
page is empty — the check is Total Active.

**A 500 found on the way, not yet fixed.** `POST /prospects/{id}/advance` returns
500 rather than a handled error when the target stage is an
`interview_requirement`: `_validate_step_completion` reads
`prospect.interviews`, a lazy relationship, inside async context, and SQLAlchemy
raises `MissingGreenlet`. The endpoint maps `ValueError` to 409 but nothing
catches this. Advancing anyone out of the Interview stage — the third stage of
the default pipeline — hits it. Recorded in KNOWN_LIMITATIONS.

### 00-getting-started — complete, 11 of 11 changed images verified

Third tick closed it out with `00-07-dashboard-panels`: current, and its
resize is content growth rather than layout. Guide 00 is done.

**What appearing in three images finally prompted.** The Department Overview's
**Training Compliance 0%** sits next to "252 hrs last 30 days", which reads as a
contradiction. It is not a bug: `compute_org_compliance_pct` counts members who
satisfy **every** active requirement, and the demo department has 36 of them, so
0% is arithmetically right and the hours figure beside it is unrelated. Left the
computation alone and documented the card instead — the same call as the
"Failed 100%" finding: correct, deliberate, and easy to misread. The guide's
stats list also said "training completion rates", which named it as something
it is not.

### 00-getting-started — earlier ticks, 10 of 11 changed images verified

Second tick added five: `00-09-account-settings`, `00-16-sidebar-admin`,
`00-17-account-settings`, `00-19-change-password`,
`00-22-notification-card-expanded` — all current. Only
`00-07-dashboard-panels` is still unopened.

**What `00-16-sidebar-admin` exposed.** The guide's Administration table had
drifted from the navigation in four ways, checked against `SideNavigation.tsx`
rather than against the picture: **Store Admin** and **Admin Hours** were
missing entirely, **Forms** is now **Forms & Comms** with Email Templates,
Messages, Forms and Integrations under it, and **Integrations** was listed as a
top-level item when it is nested. Table rewritten.

**What `00-09` and `00-17` exposed.** They are the same picture — `/settings/account`
and `/account` are aliases for one page. That is fine, but `00-09`'s caption
promised "profile, notification preferences, and password sections", and those
are separate **tabs**, not sections of the page shown. Caption corrected in both
the guide and the manifest. Unlike the `03-15`/`03-32` and `03-02`/`03-08`
pairs below, this one was not previously recorded.

### 00-getting-started — first tick, 5 of 11 changed images verified

| Image                      | Verdict                                                           |
| -------------------------- | ----------------------------------------------------------------- |
| `00-04-dashboard-overview` | current; gained the Learning Center nav item                      |
| `00-14-confirm-dialog`     | current; in-app dialog with named buttons, as the guide describes |
| `00-15-sidebar-member`     | current; the new Learning Center row is the whole diff            |
| `00-18-rsvp-modal`         | current                                                           |
| `00-20-member-dashboard`   | **was wrong** — see below                                         |

Three images were byte-identical and needed nothing: `00-01-login-page`,
`00-21-login-sso-options`, `00-23-login-two-factor`.

Still to verify, changed but not yet opened: `00-07-dashboard-panels`,
`00-09-account-settings`, `00-16-sidebar-admin`, `00-17-account-settings`,
`00-19-change-password`, `00-22-notification-card-expanded`.

**What `00-20-member-dashboard` exposed.** Its My Training Progress card listed
two enrollments both labelled the literal word **"Program"**, so a member on two
pipelines could not tell them apart. `get_member_enrollments` eager-loads the
programme relationship, but `ProgramEnrollmentResponse` had no field to put it
in, so it was dropped on the way out and the dashboard's `program?.name` fell
back to its placeholder every time. The member training print-out showed an em
dash for the same reason. Fixed by declaring the field the eager-load was
already paying for.

**What `00-15-sidebar-member` exposed.** The guide's sidebar table had no row
for **Learning Center**, which now sits second in the nav. Added.

---

## The 2026-08-13 currency audit — what a full pass found

A full re-capture was run to answer "are the committed images still true?". It
did not get as far as answering that, because it first exposed three things
that made every previous full pass untrustworthy. All three are fixed; the
re-capture itself is being redone guide by guide, verifying each image before
committing it.

### The harness was rendering the wrong navigation

`08-62-topnav-bell-badge` switches the app to the top navigation bar by writing
`navigationLayout` to `localStorage`, to photograph a bar that is not the
default. It never put it back, and `capture.mjs` reuses one page for every shot
of a given auth mode — so **every admin-authenticated shot captured after it
rendered with the top bar instead of the default left sidebar.**

Silent, and dependent on manifest order, which is why it had never shown up: a
narrow `--only` run does not reach 08-62 before the rest, and only a full pass
does. It surfaced as 46 images having grown by _exactly_ 65px — too uniform to
be content, and it turned out to be the sidebar-to-top-bar swap.

Fixed by clearing the key before every shot, so ordering cannot matter. 187
images had already been committed from the contaminated pass; that commit was
reverted.

**Lesson for this file: a byte diff is not verification.** The contaminated
images were all "changed", and every one of them looked plausible on its own.
What gave it away was the _shape_ of the change being identical across
unrelated guides.

### Two seeding problems that read as capture failures

Captures against stale or half-seeded data fail as bare `locator.click`
timeouts that name nothing. Both of these cost an hour before being traced:

- `GET /training/module-config/config` answered **500** for the demo
  organization, which aborted the shift-report seed step, which left the shift
  report shots with nothing to click. Fixed — see the 2026-08-12 entry in
  KNOWN_LIMITATIONS' sibling commit history.
- The TOTP account added for the two-factor login shot was `rduarte`, which is
  `DEMO_PEER_EXAMINER_USERNAME`. Several seed steps sign in as it, and a
  password sign-in on an MFA account returns no session, so three steps failed
  with 401s. Moved to an account nothing signs in as, with an assertion that
  fails at seed time if it is ever pointed at a login identity again.

**Always re-run `seed_demo_data.py` after a container restart, and require it
to finish with no failures before trusting a capture.**

### Genuine capture failures still outstanding

Seven shots failed for their own reasons rather than as fallout. (A long tail
of `Target page, context or browser has been closed` in the same log is not
real — that is the run being stopped.)

| Shot                          | Failure                          |
| ----------------------------- | -------------------------------- |
| `03-56-bulk-confirm-shifts`   | `locator.waitFor` timeout        |
| `03-58-assign-member-form`    | `locator.click` timeout          |
| `02-88-member-checklist-view` | `scrollIntoViewIfNeeded` timeout |
| `02-89-officer-only-steps`    | `scrollIntoViewIfNeeded` timeout |
| `08-55-audit-medical`         | `selectOption` timeout           |
| `15-02-board-truncated`       | `locator.waitFor` timeout        |
| `15-09-bulk-action-result`    | `locator.waitFor` timeout        |

### A seed gap: the prospect pipeline is empty

Four shots across guides 01 and 15 flagged **"No applicants"** —
`01-10-prospective-pipeline`, `01-25-applicant-action-bar`,
`01-26-print-applicant-badges`, `15-14-applicant-drawer-overview`. Earlier in
the same session `15-14` flagged the much narrower "No documents yet", so the
pipeline had applicants then and does not now. Whatever seeds prospects is
either not running or not surviving. Not yet diagnosed.

---

## Images invalidated by the 2026-08-11 → 08-12 changes

**Flagged 2026-08-12, not yet re-captured.** Two UI changes landed after the
2026-08-11 passes and reach existing images. Flagged by comparing each image's
subject against the commits, not by opening them.

### A. The mobile hamburger moved to the left edge

`SideNavigation`'s phone header now puts the ☰ button at the **left** edge
(the edge the drawer slides in from) with the logo/department name to its
right; it was previously at the far right. The component renders the top bar
of **every authenticated page on a phone**, so every phone-width capture that
includes the top bar now shows an outdated header:

| Image                                                                               | Why it's in frame                                          |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `10-04-mobile-dashboard`                                                            | fullPage, header at top                                    |
| `10-06-mobile-inventory-admin`                                                      | fullPage, header at top                                    |
| `10-10-mobile-minimum-text`                                                         | header at top                                              |
| `10-15-mobile-menu-notifications`                                                   | shot _of_ the open menu — the button itself is the subject |
| `10-14-scan-camera-denied`                                                          | viewport-anchored, header at top                           |
| `03-48-settings-phone`, `03-73-flat-check-form-header`, `03-95-apparatus-inventory` | top-anchored phone shots                                   |

**Not invalidated, recorded so nobody re-checks:** `10-12-mobile-bottom-nav`
(clipped to the bottom nav element), `03-71-set-all-to-par-confirm` (dialog
clip), `04-32`/`04-33` guest sign-in (public `/login` renders outside
`AppLayout` — no hamburger), and mid-page clips that never reach the top bar
(`03-60`, `03-70`, `03-72`, `03-96` — verify by opening before re-shooting).

The training guide's new header note carries a matching
`[SCREENSHOT NEEDED]` for the re-shoot.

### B. The Ballot Builder grew a "Save as Template" button

`14-04-ballot-configuration` pictures the Ballot Builder, which now shows
**Save as Template** beside its actions whenever the ballot has items (and the
template picker gained a "Your saved ballots" section). The whole guide-14 set
was already listed under _Not re-captured_ as cosmetically stale; `14-04` is
now **structurally** stale, and two new placeholders in
`14-elections.md` (the save form, the saved-ballots picker) have never been
shot. Note for the harness: the saved-templates picker needs a seeded saved
template — `seed_demo_data.py` does not create one yet.

### C. Checked and not invalidated

- **The responsive sweeps (08-11)** are scoped under 768px, so the existing
  desktop captures are unaffected. The two everywhere-width changes have no
  captures to invalidate: the Member Training Status page (gained its page
  gutter) has no shot in the manifest, and no facility detail page is shot at
  phone width.
- **The confirm-dialog sweep** replaced _native_ browser dialogs, which
  Playwright could never photograph anyway; `00-14-confirm-dialog` pictures
  the in-app dialog, which is the surviving pattern.
- **`02-104-cohort-preview-step`** was captured in the same commit that fixed
  the holiday-chip date format it pictures, so it is already current.

---

## What re-capturing exposed

Eight defects, plus two in the harness itself. None were reported by the
capture run: it listed **26/26 captured, 0 flagged** for a batch containing two
images showing the opposite of their captions. Its empty-state check can tell
that a page rendered, not that it rendered the thing the caption promises.

| Defect                                                                                                                                           | Found by                                                          | Fix                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platoon Management captioned "platoon columns and their members", showing a "platoon scheduling is turned off" banner over one Unassigned column | Opening the image                                                 | Seeder enables platoons and deals the roster A/B/C                                                                                                                                                                                                             |
| Scheduling Settings showed six sections against documentation describing seven                                                                   | Same — Platoons is hidden while the feature is off                | Same fix                                                                                                                                                                                                                                                       |
| `03-14` captioned "compliance report", showing an empty date picker                                                                              | Opening the image                                                 | `prepare` step drives the Shift Compliance tab                                                                                                                                                                                                                 |
| `09-10`, `09-11`, `09-12` timed out on an empty validation queue                                                                                 | Capture failure, then tracing it to the data                      | Peer examiner was a **lieutenant**, whose rank grants `training.manage`, so their submission self-validated. Switched to a firefighter; the seeder now asserts it                                                                                              |
| `02-21` and `02-41` were **byte-identical**, both shooting the default tab under two different captions                                          | Hashing the whole image set                                       | Both routes now carry `?tab=`                                                                                                                                                                                                                                  |
| `04-20` and `17-01` byte-identical to _other_ shots — hub routes defaulting to another tab                                                       | The same MD5 sweep, set aside at first as another guide's problem | Both carry `?tab=`. `17-01` needed a second fix: `/settings/account` is a `<Navigate>` with no query, so React Router dropped `?tab=` on the redirect and the shot stayed on the Account tab while the harness reported success. Uses the canonical `/account` |
| Expiring Certifications permanently empty                                                                                                        | Fixing the route above                                            | The seeder's own comment promised near-future expiries; its arithmetic put the earliest at **TODAY + 233 days**, so none of the 66 records could enter the 90-day window                                                                                       |

### Two defects in the harness

Both surfaced by images, and both had been costing accuracy silently:

- **A false positive held back a correct screenshot.** The empty-state check
  scanned the whole page as one blob, so `17-01` was flagged on its own help
  text — "These are optional — _nothing here_ is required for membership."
  Prose, not an empty state. It now matches per line and only on lines short
  enough to _be_ the message, which is what distinguishes a standalone
  "No Integrations Yet" from the same words mid-sentence.
- **A false negative let an empty page through.** The pattern required the
  phrase to end in found/yet/scheduled/available/to show, so
  "No certifications expiring within 90 days" scanned as populated — which is
  exactly why the empty expiring-certs page reported `empty=False` and was
  publish-eligible while showing nothing. Line scoping makes a whole-line
  "No …" safe to match, so that gap is closed.

### Two duplicate pairs are legitimate

`03-15` / `03-32` (settings defaults to `?tab=general`) and `03-02` / `03-08`
(the Calls / Runs section lives inside the shift detail panel) are genuinely one
screen satisfying two captions. Recorded so a future hash sweep does not
re-investigate them.

### A product bug these images display

`03-14` shows **"Total Members 66"** for a 22-member department.
`SchedulingReportsPage.tsx` computes that card as
`complianceData.reduce((sum, r) => sum + r.total_members, 0)` — a sum of
per-requirement cohorts, so a member counted under three requirements counts
three times. The Compliant and Non-Compliant cards sum the same way: the values
are member-requirement pairs, the labels claim members.

**Not fixed here.** The payload carries no distinct-member count, so correcting
it means either relabelling the cards or adding a field to the API — a product
decision, not a screenshot one. The image accurately shows current behaviour;
this note exists so the guide does not silently endorse the number.

### Held back deliberately

`02-68-vector-category-mapping` still has nothing to photograph. Category
mappings are created **only** by `POST /providers/{id}/sync-categories`, which
fetches the live vendor catalogue over the network — there is no create
endpoint the seeder could call, so the table stays empty however much demo data
is added. The harness flags the shot and does not apply it, and it is **not
committed**, so the guide keeps its unfilled placeholder rather than gaining a
picture of an empty table under a caption describing a full one.

**Resolved 2026-08-12 for `02-42-external-integrations`.** That one was empty
for a reason the seeder _could_ fix — the demo department had no provider
configured at all. `seed_external_provider` now saves one, and the shot is
captured and applied. Only the configuration is seeded: `connection_verified`
and `last_sync_at` are written by a real sync, so the card reads "Connection
not verified" and "Last Sync: Never", which the guide's prose now explains
rather than contradicts.

### Salesforce cannot be connected in a demo department, and that is correct

The Salesforce Sync panel is real and worth a picture, but it renders only for
an integration whose status is `connected`, and `POST
/integrations/{id}/connect` will not grant that. `instance_url` must match
`^https://[a-zA-Z0-9\-\.]+\.salesforce\.com$` **and** resolve in DNS — the SSRF
guard calls `getaddrinfo` on it. A Salesforce instance host is per-customer
(`oakvillefd.my.salesforce.com`), so the demo department's does not exist and
never will.

**Deliberately not worked around.** The hosts that do resolve —
`login.salesforce.com`, `test.salesforce.com`, `na1.salesforce.com` — are login
and pod hosts, not any department's instance, and seeding one would put a URL
in the demo database that is wrong in a way a reader could copy. That is a
different case from `seed_external_provider`, where the vendor's real API host
_is_ the value every customer uses.

The section's prose has been corrected against the code instead, so the guide
describes the panel accurately without a picture of it.

### A seed gap that wasn't — the quantity checklist was reachable all along

**Withdrawn 2026-08-12, the day after it was written.** This section claimed
three 03-scheduling placeholders — the carry-over banner, the Set All to Par
confirmation, and the flat check form on a phone — were unreachable because the
only template with quantity items is bound to **M-3** and `seed_scheduling`
rosters shifts onto `fleet[:3]` only. The premise about the roster is true. The
conclusion drawn from it was not.

**A check does not need a shift.** `MyChecklistsPage` has an **Unscheduled
checklist** button that offers every active template and starts a check with no
shift attached — the same standalone-check feature the guide documents two
sections further down. All three shots were captured through it with no seeder
change at all, and they are now applied.

The mistake was reasoning from `/equipment-checks/my-checklists` (which is
shift-derived, and was correctly read) to "the screen is unreachable", without
reading the page that renders it. Recorded rather than deleted because the
cheap check — open the page and look at what else is on it — is the one that
was skipped.

**What was genuinely missing** was smaller and got fixed here: no seeded
template had a **section header**, so the bold in-compartment caption the guide
documents could not be pictured and the renderer had never met one in demo
data. `_add_section_header` now puts one on the engine checklist.

---

## Not re-captured

These guides still carry pre-2026-08-09 images. Everything in them is at least
**cosmetically** stale: the 2026-08-10 form-control sweep touched 103 files
across every module, so any screenshot containing a text input, select or
checkbox differs from the current build in control padding, corner radius,
checkbox size and focus ring.

| Guide                        | Captured |
| ---------------------------- | -------: |
| `00-getting-started.md`      |        4 |
| `01-membership.md`           |        9 |
| `04-events-meetings.md`      |       10 |
| `05-inventory.md`            |       18 |
| `06-apparatus-facilities.md` |       13 |
| `07-documents-forms.md`      |       13 |
| `08-admin-reports.md`        |       11 |
| `10-mobile-pwa.md`           |        5 |
| `11-finance.md`              |       12 |
| `12-grants-fundraising.md`   |       10 |
| `13-medical-screening.md`    |        5 |
| `14-elections.md`            |        7 |
| `15-prospective-members.md`  |       11 |
| `16-integrations.md`         |        1 |
| `17-privacy-data-rights.md`  |        2 |
| `18-storefront.md`           |        4 |

`10-mobile-pwa.md` is the most affected of these: it shoots at phone width,
where the sweep's 44px minimum control height changes layout rather than just
appearance.

---

## Verification method

Captured images were checked **by opening them and reading them against the
caption they fill**, not by trusting the harness's exit code — every defect
above survived a green capture run. Two whole-set screens ran alongside that:
an MD5 pass for duplicate files, which is what caught `02-21`/`02-41`, and a
colour-uniformity pass for blank or near-blank pages.

Not every one of the 57 was opened individually. Priority went to the
structurally-changed screens, every shot carrying a `prepare` step, and anything
either screen flagged.

---

## Superseded — the 2026-08-09 staleness audit

The table below is the pre-re-capture analysis, kept for the reasoning rather
than the verdicts.

Every **Structural** row was re-captured successfully. Four —
`09-07`, `09-08`, `09-09` and `09-12` — produced **byte-identical** output, so
they do not appear in the commit diff. That is not the same as "not
re-captured": those screens already matched the current build, and the shots had
been failing for a data reason rather than a rendering one. `09-12` is the clear
case — it timed out before the examiner fix and captures cleanly after it, while
rendering exactly the same pixels, because the stale file on disk had been shot
when a pending validation happened to exist.

Worth stating because a diff-based reading gets it backwards: an unchanged image
file after a successful re-capture is the _good_ outcome. It means the screen was
already current.

## Structural — re-capture first

| Image                                     | Screen                        | What changed                                                                                                                                                                                                                                                       |
| ----------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `03-15-scheduling-settings.png`           | `/scheduling/settings`        | Rebuilt onto the shared settings layout: section sidebar on desktop, tab strip on phones, single header replacing two stacked titles                                                                                                                               |
| `03-32-settings-general-closeout.png`     | `?tab=general`                | Same, plus the Save/Reset footer now appears only on General and Apparatus — Equipment dropped off the list on 2026-08-31 when its four settings were deleted                                                                                                      |
| `03-34-settings-checklist-timing.png`     | _retired_                     | The Checklist Timing section moved out of Scheduling to `/inventory/admin/checklists/settings` (2026-08-31) and no longer exists on this screen. The guide no longer references this image; re-capture the new page instead                                          |
| `03-35-settings-form-sections.png`        | `?tab=shift-reports`          | Same                                                                                                                                                                                                                                                               |
| `03-36-settings-apparatus-skills.png`     | `?tab=shift-reports`          | Same                                                                                                                                                                                                                                                               |
| `03-37-settings-rating-scale.png`         | `?tab=shift-reports`          | Same                                                                                                                                                                                                                                                               |
| `03-38-notifications-assignment.png`      | `?tab=notifications`          | Same layout change, plus the preset toggles are now labelled switches with a disabled treatment and an error state when the rules fail to load                                                                                                                     |
| `03-39-notifications-reminders.png`       | `?tab=notifications`          | Same                                                                                                                                                                                                                                                               |
| `03-40-settings-position-eligibility.png` | `?tab=eligibility`            | Same layout change                                                                                                                                                                                                                                                 |
| `02-09-program-detail.png`                | `/training/programs` → detail | Gained the per-requirement **prerequisite** toggle, the checklist step list, and the reminder-schedule editor                                                                                                                                                      |
| `02-11-pipeline-wizard.png`               | Create-pipeline wizard        | Structure picker is **Phases / One list** ("Sequential" retired); checklist requirements now have a steps editor with per-step visibility                                                                                                                          |
| `09-*` (11 images)                        | Skills testing                | The scoring screen was rebuilt — 44px section chips replace progress dots, candidate name added to the header, scored/total and save-status lines added, **Next** replaces **Finish** as the primary bottom-bar button. Test Records rows now read "Tap to resume" |

## Cosmetic — the rest

All remaining images. Guides, with the count of captured images each:

| Guide                        | Captured | Backing screens touched by the 2026-08-09/10 sweep                      |
| ---------------------------- | -------: | ----------------------------------------------------------------------- |
| `00-getting-started.md`      |        4 | Login, Dashboard, Account Settings                                      |
| `01-membership.md`           |        9 | Members, Add Member, prospect drawer                                    |
| `02-training.md`             |       21 | Most training pages (see structural rows above for two)                 |
| `03-scheduling.md`           |       26 | Scheduling page and its tabs, shift detail panel, equipment-check pages |
| `04-events-meetings.md`      |       10 | Events list/detail/edit, minutes                                        |
| `05-inventory.md`            |       18 | Allowances, item detail                                                 |
| `06-apparatus-facilities.md` |       13 | Apparatus, locations, facilities sections                               |
| `07-documents-forms.md`      |       13 | Forms                                                                   |
| `08-admin-reports.md`        |       11 | Reports, action items, org settings, error monitoring                   |
| `09-skills-testing.md`       |       11 | **See structural**                                                      |
| `10-mobile-pwa.md`           |        5 | Multiple, at phone width — most affected by the 44px control minimum    |
| `11-finance.md`              |       12 | Finance settings, approval chains, check requests                       |
| `12-grants-fundraising.md`   |       10 | Grants pages                                                            |
| `13-medical-screening.md`    |        5 | Screening record and requirement forms                                  |
| `14-elections.md`            |        7 | Elections list/detail/settings, ballot voting                           |
| `15-prospective-members.md`  |       11 | Pipeline board, settings, interview page                                |
| `16-integrations.md`         |        1 | Integrations catalog                                                    |
| `17-privacy-data-rights.md`  |        2 | Account settings                                                        |
| `18-storefront.md`           |        4 | Product form, store settings                                            |

---

## Images invalidated by the 2026-08-10 → 08-11 changes

**Read this before trusting the "Re-captured 2026-08-10" note above.** That pass
ran at **22:34 UTC** and covered guides 02, 03 and 09. Two large branches merged
**after** it:

| Branch                                    | Merged               | What it changed on screen                                                                                                      |
| ----------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Email template catalogue + footer library | 2026-08-10 **22:45** | The whole outgoing-email design, and a new **Footers** tab on the Email Templates page                                         |
| Inventory ↔ equipment-check supply loop   | 2026-08-10 **23:22** | The template builder toolbar, the check form, the inventory items grid and toolbar, the inventory admin hub, and two new pages |

So **no capture in the repository postdates the supply work**, and the guide-08
email screenshots predate the email redesign by 21 hours. Everything below is
flagged by comparing each image's last-captured timestamp against the commit that
changed the screen it pictures — not by opening it, which is the check that still
has to happen.

### A. Stale because of the supply / catalog-linking work

Nothing in this group has ever been captured against the shipped code.

| Image                               | Captured    | What is now different                                                                                                                                                 |
| ----------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `03-22-equipment-check-builder.png` | 08-10 22:34 | The toolbar now carries a **linked / unlinked count**, and the quick-add bar is a **catalog search** with a "create in inventory" option rather than a plain name box |
| `03-25-equipment-checks-tab.png`    | 08-10 22:34 | The **My Equipment Checklists** header now carries an **Apparatus Inventory** link beside "Start a Check"                                                             |
| `05-25-admin-hub.png`               | 08-08 00:45 | The hub now links out to **Scheduling → Supply** (Expiring on Apparatus)                                                                                              |

### B. Stale because of the email redesign

Guide 08 was **not** part of the 22:34 re-capture. All three images show the
retired full-bleed red band over a grey slab; outgoing mail is now a white card
on a grey page.

| Image                                                  | Captured    | What is now different                                                                                                                                                                   |
| ------------------------------------------------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `08-34-email-templates.png`                            | 08-10 01:11 | Preview pane shows the old design; the tab strip is missing **Footers**                                                                                                                 |
| `08-36-template-search.png`                            | 08-10 01:11 | Same page, same two changes                                                                                                                                                             |
| `08-37-email-officers.png`                             | 08-10 01:11 | Same page, same two changes                                                                                                                                                             |
| `18-01-member-storefront.png`, `18-02-store-admin.png` | 08-08       | **Check before re-shooting.** The storefront's _emails_ moved onto the shared theme; these two picture the store's own screens and may be unaffected. Listed so the question gets asked |

### C. Stale because the pictured screen was fixed after the shot

All captured at **08-10 01:11**, before the fix landed the same day.

| Image                                                                                             | What is now different                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `00-04-dashboard-overview.png`, `00-07-dashboard-panels.png`                                      | The **Open Shifts** panel is capped at five with an "N more" line. It previously rendered every open shift in the next 30 days — 48 rows on the demo department, which is why the dashboard in these shots is 6,930px tall with the ID card and equipment panels pushed off the bottom. Shift dates in **My Upcoming Shifts** were also rendering a day early for some viewers |
| `11-05-budget-detail.png`, `11-12-purchase-request-detail.png`, `11-14-expense-report-detail.png` | **Breadcrumbs now render on the loaded record.** They previously appeared only in the loading and not-found states, so these three shots have no breadcrumb trail where the shipped page has one                                                                                                                                                                               |
| `05-45-impact-planner.png` (08-08)                                                                | Ranks rendered as **"Deputy_chief"** with the underscore. Fixed 2026-08-10                                                                                                                                                                                                                                                                                                     |
| `06-21-apparatus-evoc-level.png` (08-08)                                                          | **Setting this field returned a server error when the shot was taken**, and once any apparatus had a level, the fleet list returned one too. The form works now, and the guide text around it was corrected: the levels are per-organization records, not a fixed Basic/Intermediate/Advanced triple                                                                           |

### The 2026-08-11 pass

**All seventeen images in groups A, B and C above were re-captured**, and each
was then opened and read against its caption. Sixteen came out right. The
seventeenth is the reason this section exists.

| Group | Images                             | Verified                                                                                                                         |
| ----- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| A     | `03-25`, `05-01`, `05-47`, `05-25` | Supply-loop changes present                                                                                                      |
| A     | `03-22`                            | **Was wrong. See below.**                                                                                                        |
| B     | `08-34`, `08-36`, `08-37`          | **Footers** now in the tab strip; the editor shows "Closes with"                                                                 |
| B     | `18-01`, `18-02`                   | The question the table asked is answered: the storefront's own screens were unaffected by the email redesign. Re-shot regardless |
| C     | `00-04`, `00-07`                   | Open Shifts is capped; the full dashboard is 4,486px, down from 6,930px                                                          |
| C     | `11-05`, `11-12`, `11-14`          | Breadcrumbs render on the loaded record                                                                                          |
| C     | `05-45`, `06-21`                   | Ranks read "Deputy Chief"; the EVOC form saves and shows "Level 2 — Intermediate"                                                |

**`03-22-equipment-check-builder` was photographing the wrong page, and had
been for as long as it existed.** Its route was
`/inventory/admin/checklists/templates/**new**` — the blank create form — and it
carried `allowEmptyState: true` with a note calling that correct, "the shot is
of the builder layout". But the guide text this image sits under is about
compartments, item check types and drag-to-reorder, and the page in the image
says "No compartments yet". The two changes that got it flagged for re-capture
in the first place — the toolbar's linked/unlinked catalog count and the
quick-add bar's catalog search — do not render at all without items on the page,
so re-shooting the same route would have produced the same wrong picture with a
fresher timestamp.

It now opens the seeded **Medic 3 Supply Check**, and shows the `5/8 linked`
badge, three compartments, per-item check types, the catalog quick-add bar and
the summary bar. `fullPage` is off: the toolbar and the summary bar are both
sticky, so a full-page capture paints each of them twice.

The lesson is the one the harness section above already makes, sharpened: an
`allowEmptyState` flag records that somebody decided a page was legitimately
empty. That decision is worth re-examining whenever the caption changes — the
flag is what stops the one check that would have caught this.

**Three empty-state flags were false positives, all the same shape.** A
`<select>`'s placeholder option — "No EVOC requirement", "No EVOC level", "No
category" — is in the DOM on every render, including the ones where a real value
is selected. `03-52` and `06-23` now carry `allowEmptyState` with a comment
saying which option is doing it. `03-54`'s flag is a different false positive:
"No calls logged for this shift" belongs to a sub-panel further down the same
drawer, and the shift is deliberately in the future.

**One shot needed new seed data.** `03-54-crew-board-open-slots` had been
failing outright — "no future shift is part-staffed with 2+ open" — because the
seeder staffs every shift to its minimum or one short. That is what a real
schedule looks like, but it meant the crew board never showed more than one open
row and the bulk **Fill All Open** action, which appears only at two or more,
was unreachable in the demo. `PART_STAFFED_SHIFT` now leaves one future shift
crewed by its officer alone. The repair runs against the API as well as in the
create path: an existing shift is skipped on a re-run, so a create-path-only fix
would have worked on a fresh database and nowhere else.

**The Add Operator form cannot be photographed with its picker open.** Both
selects on it are native, and an open native popup is drawn by the operating
system rather than the page, so Playwright cannot capture it. `06-23` shows the
two fields _set_ instead, which makes the same point more directly: a real
member name proves the box is a picker over the roster, and an EVOC level beside
it is the combination that used to return a server error.

**Still not fixed: `11-05-budget-detail` pictures a budget with no
transactions.** The breadcrumb fix it was flagged for is confirmed, but every
seeded budget has `amountSpent: 0`, so Transaction History is genuinely empty and
the utilization bar reads 0.0%. The seeder creates purchase requests and expense
reports without settling any of them against a budget. Closing that gap is
seeder work, not a capture setting.

### Two sessions shot the same screens at once

This pass and the one recorded above it ran in parallel against the same
backlog, and both photographed the email screens, the two inventory modals, an
item's Stock tab and four of the supply shots. Nothing was lost — the duplicates
were reconciled on merge, keeping whichever version was better and deleting the
other — but the effort was spent twice, and one of the reconciliations was not
obvious:

- **`08-67-email-preview-design`.** One version opened the welcome email and
  concluded, in the guide, that the preview pane simply cannot show a footer:
  it is a fixed 600px iframe and the message is taller. The other opened
  **Shift Assignment** instead, because the footer renders only where the body
  contains `{{footer_html}}` and most shipped bodies predate footers. The second
  is right, and the first would have documented a limitation that is really a
  template-choice problem. Kept the second.
- **Numbering collided.** Both sessions took `05-65`, `05-66` and the `03-57`
  … `03-62` range for different screens. Ids are full slugs, so no file was
  overwritten, but the numbers no longer read in order. Before adding a shot,
  check the manifest for the next free number rather than counting the images
  on disk.

### D. Verified current — do not re-shoot on this pass

| Image(s)                                                                  | Why                                                             |
| ------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Everything in guides **02**, **03** and **09** except `03-22` and `03-25` | Captured 08-10 22:34 against the current code for those screens |
| `01-08-member-audit-history.png`                                          | Re-captured after the event-type filter and details-panel fixes |
| `08-60` … `08-63` (notification shots)                                    | Captured after the delivered-status and `?tab=` fixes           |
| The 15-prospective-members set                                            | The Linked Events badge capitalization fix is in these captures |

### Screenshots that do not exist yet

The 2026-08-11 documentation pass added **18 new `[SCREENSHOT NEEDED]`
placeholders** for screens that have never been photographed:

| Guide                        | Placeholders added                                                                                                                                                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `03-scheduling.md`           | Apparatus Inventory page, the lots sheet, the report-used sheet, the quick-add catalog search, the bulk inventory-match dialog, the check form with carry-over banner, the Set All to Par warning, the Expiring on Apparatus worklist (8) |
| `05-inventory.md`            | The two-ledger items grid, the Receive Stock modal, the Add Several modal, an item's Stock tab with deployed positions                                                                                                                    |
| `06-apparatus-facilities.md` | The Operators tab, the Add Operator member picker                                                                                                                                                                                         |
| `08-admin-reports.md`        | The Footers tab, the footer selector in the template editor, the Organization variable palette, the new email preview design                                                                                                              |

**All eighteen are now captured and applied** _(2026-08-11)_, across the two
parallel sessions recorded above:

| Guide | Shot as                                                                                                                                                                 |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `03`  | `03-95` apparatus inventory, `03-96` lots sheet, `03-59` worklist, `03-69` quick-add, `03-68` bulk match, plus the report-used sheet, carry-over banner and par warning |
| `05`  | `05-53` the two-ledger grid, `05-09` Receive Stock, `05-10` Add Several, `05-07` an item's Stock tab                                                                    |
| `06`  | `06-22` Operators tab, `06-23` Add Operator                                                                                                                             |
| `08`  | `08-64` Footers tab, `08-65` footer selector, `08-66` variable palette, `08-67` email preview                                                                           |

The numbering does not run in order because two sessions allocated ids at the
same time — see _Two sessions shot the same screens at once_ above. The
apparatus shots select M-3 from the picker by the option's **value** rather
than its label, since the label is built from two fields and matching it as a
string breaks the moment either changes.

`08-64` only became possible on 2026-08-11: the Email Templates page held its
tab in plain state, so a shot of the Footers tab would have silently captured
the Templates tab — the same way `02-21`/`02-41` and `04-20`/`17-01` came to be
byte-identical images under different captions. `?tab=` now round-trips all
five tabs, with a test pinning every call site.

**Superseded.** An earlier revision of this section said fourteen of the
eighteen had no manifest entry and that several needed seed data that did not
exist — a position carrying two lots with two dates, a truck below par, a
restock report raised by a member. All three now exist, and all eighteen are
shot.

**The seeder gap is closed** _(2026-08-11)_. `seed_supply_tracking` in
`scripts/screenshots/seed_demo_data.py` now builds the state these sections
describe, on the medic unit:

| What it seeds                                                                              | Which screenshot needs it                                                                                                                                    |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Five dated consumables with shelf lots, one of them **already expired**                    | The struck-through row on the worklist; the two-ledger Qty column                                                                                            |
| Catalog links on the counted positions, **and three positions deliberately left unlinked** | The toolbar's coverage count; the bulk-match dialog                                                                                                          |
| Naloxone from **two lots with two dates** on one bracket                                   | The lots sheet, and the "soonest aboard" rule                                                                                                                |
| Gauze at **18 of 24**                                                                      | The amber short count, and the Set All to Par warning — which is suppressed on a compartment already at par, so a fully stocked department cannot picture it |
| A restock report raised **by the demo member**, not the administrator                      | The worklist row naming a real reporter, which is the whole claim about who can record use                                                                   |

**A defect the wiring exposed.** The seeder had been writing
`"check_type": "presence"` on every equipment-check item. The column is a free
`String(30)` so the API accepted it, but the eight types the check form
recognises spell it **`present`** — and an unrecognised value falls through the
form's switch to the pass/fail branch. So every seeded item rendered **Pass /
Fail** buttons under a guide describing Present / Missing, and nothing reported
a problem. Fixed, with a `_repair_check_types` pass for rows a long-lived demo
database already holds. Same shape as the skills-testing `"checkbox"` criterion
type recorded in `KNOWN_LIMITATIONS.md`; worth assuming there are more of these
wherever a type is stored as a free string.

---

## Re-capturing

See [`scripts/screenshots/README.md`](../../scripts/screenshots/README.md). The
short version, once MySQL/MariaDB and Redis are up:

```bash
scripts/screenshots/dev_env.sh                       # blocks until the stack answers
python scripts/screenshots/seed_demo_data.py         # run before EVERY capture
node scripts/screenshots/capture.mjs --only 03-      # one guide at a time
python scripts/screenshots/apply_placeholders.py
python scripts/screenshots/status_report.py
```

**Structural first, and by guide.** `--only 09-` and `--only 03-` cover the two
screens that changed shape; the cosmetic tier is worth doing in one full run
rather than piecemeal, since a partial sweep leaves two control styles side by
side in the same guide.

**Update this file when you do.** It is the only record that a captured image was
checked against the build rather than merely present on disk.
