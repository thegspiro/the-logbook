# Recent changes: August 24–31, 2026

This wiki handoff is intentionally usable without the repository `docs/` tree.
The deeper engineering audit is in the source repository at
[`docs/CHANGE_AUDIT_2026-08-24_TO_31.md`](https://github.com/thegspiro/the-logbook/blob/main/docs/CHANGE_AUDIT_2026-08-24_TO_31.md).
Predecessor: [August 23–24](Recent-Changes-2026-08-23-to-24).

**The headline:** your department now has an **organizational chart** any
member can open, membership records now say **what kind of member** somebody is
separately from **where they sit on the ladder**, the **equipment check
template builder** was rebuilt into one list you scroll, and the **Testing
Checklist became a module that is switched off** — so a department mid-way
through a pre-launch walkthrough will find `/testing` gone until an
administrator turns it back on. Four upgrade steps **take permissions away**
from seeded positions; read that section even if you skip the rest.

## Read this first

**If you administer a department:**

- **`/testing` has disappeared.** The Testing Checklist is now a module and it
  is **off by default**. Settings → Modules → **Testing Checklist** brings it
  back. **Marks held on the server are not lost** — they are still there and
  reappear the moment you switch it on.

- **⚠️ But marks from before the checklist moved to the server are.** The old
  version kept them in the **browser** (`logbook.testing-checklist.v1`) and
  there is no import path. If you are part-way through a walkthrough on an
  older build, **export the run before upgrading**.

- **Four upgrade steps revoke permissions from seeded positions**, and they are
  not granted back automatically (two further steps add new grants):
  - `compliance.view` is taken off the **Member** position.
  - `notifications.view` is taken off the **baseline member and junior rank**
    positions.
  - `facilities.view` is taken off **regular members**, and then off the
    **shared operational officer** positions. Line officers who used to open
    the Facilities workspace will not be able to.
  - `training.configure` is a **new** permission and is granted to the
    positions that configure training.
  - `users.view_consents` is a **new** permission and is granted to the
    Historian and PIO positions.

  If somebody in your department relied on one of the revoked grants, re-grant
  it on a position that is meant to carry it.

- **Every administrative member has had their operational rank cleared.** An
  operational rank is a chain-of-command position and it carries permissions
  with it, so an administrative member holding one held grants that role was
  never meant to have. This does not reverse.

- **You cannot simply set the rank again.** The API refuses the
  administrative-class/rank pair with a 400, and the edit screen disables the
  rank control for an administrative member — a rank carries chain-of-command
  permissions, which is what that class is outside of. If somebody genuinely
  holds an operational rank, **change their class first**, then set the rank.

- **Facility files were readable by the whole department** through the
  Documents module — insurance policies, leases, capital-project files,
  inspection paperwork. The facility _record_ was restricted; the _file_ it
  pointed at was not. Fixed for files uploaded from now on, and existing
  facility **folders** have their permissions corrected on upgrade.

- **⚠️ Files uploaded before the upgrade are not re-filed.** The migration sets
  the folders' permissions; it does not move documents that were already stored
  outside a folder into them, and the app files a document only as it is newly
  attached. **Every facility file that predates this upgrade is still
  folderless, still treated as organization-wide, and still listable and
  downloadable by anyone who can open Documents.** Re-attach or re-file them —
  the upgrade alone does not close it.

- **The compliance configuration page was silently dropping cleared fields.**
  If you ever cleared a setting there and saved, the old value stayed. More
  consequential: a compliance profile whose officer had unchecked _every_
  required requirement was being graded against every active org-wide
  requirement instead of none. **Re-check your compliance percentages after
  upgrading** — they may move.

**If you are a member:**

- **Governance → Organizational Chart** is new and open to everyone signed in.
  It is there so you can work out who runs an area without asking around.
- **Your record now holds two facts where it held one.** "Membership type"
  became **class** (operational / administrative / social) and **status**
  (prospective → probationary → regular → life → retired, plus honorary and junior). A life member who
  still rides, or a probationary treasurer, is now expressible. **The member
  screens still show a single Membership Type selector** — the pair is derived
  from it — so there is nothing new to fill in.

**If you integrate with the API:** `membership_type` is still present, still
correct, and still returned — it is now _derived_ from the new `member_class`
and `member_status` pair rather than being the authority. Nothing was removed
or renamed. If your integration **writes** `membership_type`, move it to the
pair: the derivation is deliberately lossy in one direction, because the old
vocabulary cannot express an administrative probationer. Shift and template
seat objects gained a third field, `allow_administrative_members`; older
readers accept it.

**If you run the upgrade:** forty-five migrations, head `f6a7b8c9d0e1`. Four
do not reverse. See [Database upgrade route](#database-upgrade-route).

## Pages and connection points

| Area                                            | Pages                                                                             | API/data connection                                                                                                                                                                               | Boundary and important edge cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Organizational chart**                        | **`/governance/org-chart`** (new) — outline and diagram views                     | New tables `org_chart_nodes`, `org_chart_node_holders`; `GET /org-chart`, `POST /org-chart/nodes`, `PUT /org-chart/nodes/{id}`, `POST /org-chart/nodes/{id}/move`, `DELETE /org-chart/nodes/{id}` | **Reading needs no permission beyond signing in** — the chart exists for the general membership, and gating it would lock out its audience. Editing needs `orgchart.manage` or `settings.manage`; without either the page is read-only. **A seat can hold several people**, so two deputy chiefs share one box. **A holder need not be a member** — a name with no account covers the town attorney or a mutual-aid liaison. Linking a seat to a position _fills in_ its holders; **unlinking keeps the holders you typed and drops the ones the link supplied**, so a seat whose holders all came from its link goes vacant. The chart starts empty; you draw your own                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Membership class, status and qualifications** | Member profile; Members administration; member create/edit; Elections eligibility | New columns `users.member_class`, `users.member_status`; new table `member_qualifications`                                                                                                        | The old single field could not say both things at once, and elections is where it showed. **The built-in voter categories keep their legacy meaning** — `operational` still requires operational class **and** regular standing; an earlier version of this change read the class alone and was reverted the same day because it admitted probationary and retired members to a restricted ballot. Two things did change: **a life member now receives a `regular` ballot** (with one fused field, "life" and "regular" were competing values), and **every status category now also requires the operational class**, so an administrative member with regular standing no longer receives ballots restricted to active or life members — a tightening. **Honorary members become the _social_ class** — that is not a new judgement, it is what the system already did with them. A **qualification** (Firefighter I/II, apparatus operator, EMT, Paramedic) is separate from a rank because qualifications expire and ranks do not; shift eligibility reads the expiry **as of the shift date**, not as of today. **Qualifications are recorded through a course's Certifies field**, never entered directly — so a card a member has held for years needs a matching training record, and setting Certifies on a course does not backfill records already filed against it |
| **Equipment check template builder**            | Scheduling → equipment check templates                                            | `equipment_check_templates.content_revision`; new bulk-delete, clone and reorder endpoints                                                                                                        | Sections, locations and items are now **rows in one list, in the order a crew walks them**. The metadata sidebar, the three-step progress strip, the "Template readiness" card and the Quick Add / Bulk Add toggle are all gone. Adding items is one box per location — type one and press Enter, or paste a list and confirm a preview. Nesting a location is an **indent button**. **When Publish is unavailable the page lists the specific things to fix**, and each one jumps to the row, opens its location and puts the cursor in the empty field. The mobile preview docks beside the checklist **only at 1440px and wider**; below that — tablets and 1366px-class laptops included — the Preview control opens the modal, as it does on a phone. The compact rows and full-height item editor are unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Testing Checklist**                           | `/testing`, **`/testing/report/print`** (new)                                     | New tables `testing_checklist_entries`, `testing_runs`; new module flag `testing`                                                                                                                 | **Off by default**, and not offered during first-time setup — it is a tool for checking an installation, not a decision to make while making every other one. Work is organised into **runs** ("Pre-launch, build 1.4"); starting one **archives** the previous run rather than clearing it. **Every mark is checked against what the app expected** — a page that opened for an account that should have been refused is flagged where you marked it and listed in the report as a permissions defect. Marks record the build, so `Needs re-test` finds the ones made before a deployment. Exports: CSV, a page-by-tester permission matrix, a printable report, and Markdown                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Facilities**                                  | **`/facilities/settings`** (new, managers only); Facility detail → Files          | Folder gating migration; `FACILITY_ENTRY_PERMISSIONS`                                                                                                                                             | Facility files live in the shared Documents module. They were landing **outside any folder**, and a file in no folder is treated as organization-wide — so the whole department could list and download them. Now filed into the facility's own folder on upload, and the folder carries the same three facility grants. Two officers opening a new facility's Files tab at the same moment could each create a duplicate folder set; that is serialized now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Inventory**                                   | Item detail; return-request review; transfer; receiving                           | Reorder-receiving, return-receipt and request-duration migrations                                                                                                                                 | "Checkout batch" is now **Item Distribution**, and the module's canonical vocabulary is stated in one place — Assignment, Temporary loan, Issuance, Return, Check-in, Transfer, Distribution. **That is the target, not yet every label:** you will still see "Active Checkouts" and "Checkout — returnable individual item" on some screens. **API values are unchanged**; only the labels moved. **Stock received through the reorder workflow now actually becomes issuable** (it previously created a purchase record and never updated on-hand). An item recorded as poor, damaged or out of service **can no longer be returned to service** until a later inspection records a safe condition. The "Transfer is immediate" checkbox is gone — transfers always were                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Department Store**                            | Item detail; sizing request                                                       | Thread-colour, size-order and personalization-method migrations                                                                                                                                   | **Embroidery and engraving are not the same job.** They shared one "customization" field, so an engraved brass plate asked for a thread colour. They are now separate, and the thread swatch appears only where thread is used. Variant sizes sort in **garment order** — `XL` no longer files between `L` and `XS`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Communications**                              | **`/messages/:id`** (new); **`/communications/photo-use-consent`** (new)          | Message-recipient and delivery-key migrations                                                                                                                                                     | The message detail page needs no permission beyond signing in — the server only serves a message you were actually sent. An **already-sent department message could go out a second time**; delivery is keyed now, and a **reported send failure is never recorded as delivered**. The photo-use consent roster is readable by the people who publish (`users.view_consents`, or notifications/members/users management) and is excluded from the browser response cache                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Meetings and minutes**                        | Meeting minutes; meeting records                                                  | —                                                                                                                                                                                                 | **"Unlink" on a linked event never unlinked it.** It showed _Event unlinked_ and the link returned on the next page load. Meeting **minutes** already recorded who changed what; meeting **records** — create, edit, delete, approve, and their attendees and action items — recorded nothing. They do now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Grants & fundraising**                        | Dashboard; campaigns; donors; application detail; reports                         | —                                                                                                                                                                                                 | A report covering a range that **included today** — the default — dropped everything recorded later that same day. The fundraising payment-method breakdown showed **0.0% for every method** as soon as two methods had donations. View-only members were shown New Campaign / Add Donor / New Application / Add Item / Record Expenditure / Add Task / Add Note buttons that failed on click; those are hidden now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Medical supplies**                            | Catalog; summary                                                                  | —                                                                                                                                                                                                 | The summary's **Low Stock count only looked at the first 500 active items** — a department over that size could have a low-stock item missing from the headline figure while listed correctly in the table below. Creating a category or item was recorded in the audit trail; **editing one was not**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## What was fixed that members will notice

- **Creating a new member was completely broken** and failed every time with a
  server error. Fixed.
- **Every member could read every other member's notifications.** Fixed.
- **A member's audit history could show actions performed on someone else.**
  Fixed.
- **Admin hours CSV export** now recovers from an expired session instead of
  downloading a broken file.
- **Bulk edits to a saved checklist** now save every selected item, not just
  the last one.
- **Two approvers acting at the same moment could double-charge a budget**, and
  a budget's cap could be quietly bypassed. Both are serialized now.
- **Two coordinators transferring the same prospect** could create two accounts
  for one person. Serialized.
- **Two quartermasters reviewing the same return request** could overwrite each
  other's decision. Serialized.

## Who could see what — the disclosure fixes

Tell your officers about these:

- **Facility files** — the whole department, through Documents. **Closed for
  files uploaded from now on only.** Files that predate the upgrade are still
  folderless and still downloadable by anyone who can open Documents until you
  re-file them; see the warning above. This is the one item on this list that
  needs you to do something.
- **Notifications** — every member could read every other member's. Closed.
- **Admin-hours progress** — an officer with compliance access could look up
  any member's progress **in any department**. Closed.
- **The finance approvals queue** was scanning every organization's pending
  steps. Closed.
- **A membership applicant's file** could reach a signer who could not
  otherwise view it. Closed.
- **Eight named surfaces** could hold member-identifying data in the browser's
  short-lived response cache for up to 90 seconds — a training cohort's roster, a
  program's enrollment-eligibility list, an external provider's member mappings, a
  form-management page, a raw analytics export, the department-wide competency
  heat map, the training dashboard's at-risk widgets, and the training-session
  approval roster. All are now excluded, and a grants/fundraising list was closed
  as a precaution.
- **Separation of duties** — a storefront manager could settle their own
  order's payment, a finance approval token could approve its own requester's
  request, a secretary could submit _and_ approve their own meeting minutes,
  and a skills-testing officer could void or return their own result. All
  closed.
- **Security monitoring for session hijacking and unusual bulk downloads was
  never actually running** — it looked for the signed-in user before the
  request had been authenticated. Both checks run now.

## Database upgrade route

**Forty-five migrations. Head is `f6a7b8c9d0e1`.**

Back up, confirm `alembic heads` returns exactly one, then
`alembic upgrade head`.

**Five migrations do not reverse.** Four are no-ops where a downgrade that
_did_ restore the old values would be the more destructive option:

| What it does                                                 | Why the downgrade leaves it alone                                                                                                                         |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clears the operational rank of every administrative member   | Nothing records which ranks this cleared, so restoring them would also restore ranks an officer cleared deliberately                                      |
| Recovers membership standing out of membership positions     | Nothing records which members were reclassified here rather than by an officer; putting them all back would flatten standings a department set on purpose |
| Canonicalizes crew seat names (`EMT` / `EMS` onto one token) | The two spellings really were one seat; splitting them again would have to guess                                                                          |
| Adds `allow_administrative_members` to every stored seat     | Older readers accept the extra field, so there is nothing to undo                                                                                         |

> **⚠️ The fifth destroys data on the way down.** `a7c93f21d5b8` (org-chart
> multi-holder) restores the single-holder shape by keeping **each seat's first
> holder only**, then drops the holders table. Every additional holder is lost,
> and a seat whose holders came only from a position link comes back **empty**.
> **If you have drawn your org chart and might roll back, export the holders
> first.** No other migration in this window destroys data downward.

**Several migrations deliberately backfill nothing, and an empty result is not
a bug:** member qualifications start empty (nothing is inferred from rank — a
department that recorded somebody as an EMT _rank_ has said where they sit, not
which card they hold or when it expires), the org chart starts empty because
you draw your own, and testing runs start empty.

## After you upgrade

- **Turn the Testing Checklist back on** if you were using it (Settings →
  Modules).
- **Re-grant anything the revocations took** that your department genuinely
  needs — especially `facilities.view` for line officers, if that is your
  intent.
- **Re-check your compliance percentages.** The configuration fix can move
  them, and for any group meant to have _no_ required certifications it can
  move them a lot.
- **Do not try to re-set an operational rank on an administrative member** —
  the pair is refused with a 400 and the control is disabled. If the rank is
  right, their **class** is what needs changing first.
- **Draw your org chart.** It starts empty, and it is the one new screen your
  members will actually open. **If you may roll this upgrade back, export
  `org_chart_node_holders` once you have drawn it** — the downgrade keeps
  only each seat's first holder.
- **Warn your quartermaster** that "checkout batch" is now Item Distribution,
  and that received reorder stock is finally issuable.
