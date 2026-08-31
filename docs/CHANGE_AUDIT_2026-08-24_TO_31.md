# Change audit: August 24–31, 2026

Net changes merged to `main` in the seven days ending 2026-08-31 00:10 EDT
(merge `9445bc44`, PR #2083), picking up where the
[August 23–24 audit](./CHANGE_AUDIT_2026-08-23_TO_24.md) stopped at
`2107bb9a` (PR #1771, 2026-08-24 07:02 EDT).

**274 pull requests. 1,207 files, ~132,400 insertions.** Forty-five schema
migrations, head `f6a7b8c9d0e1`. Two features that add a screen a department
has never seen (the organizational chart, the testing checklist as a real
module), one screen rebuilt from the ground up (the equipment-check template
builder), **one data-model change that touches every member record** (member
class, member status and qualifications become three separate facts), a
module gate applied to thirty-four routers across eighteen modules, and a
long run of **authorization and disclosure fixes** — the bulk of them from
the module-by-module security review rotation, which closed its second pass
over twenty-five features in this window.

**Eighty-five changelog sections** carry a date inside this window. That is
the number to quote when somebody asks how much moved; the release map below
groups them.

Companion operator lesson:
[`training/19-august-2026-release-changes.md`](./training/19-august-2026-release-changes.md)
(August 24–31 section). Wiki handoff:
[`Recent-Changes-2026-08-24-to-31`](../wiki/Recent-Changes-2026-08-24-to-31.md).
Media disposition — which screenshots must be created, which replaced, and
which YouTube takes need rewriting — is in [Documentation and media
disposition](#documentation-and-media-disposition) below.

## Read this first

Four things in this window change what an operator or integrator must do,
rather than just what they see:

1. **The Testing Checklist is now a module, and it is off.** `/testing` was
   reachable by any signed-in member. It is now gated on a `testing` module
   flag that **defaults to false**, is not offered during first-time setup,
   and must be switched on at Settings → Modules. A department mid-way
   through a pre-launch walkthrough will find the page gone after the
   upgrade. Marks held **on the server** survive and reappear when it is
   switched back on — but marks made before the checklist moved to the server
   (`5c6886ce`) were kept in the browser under
   `logbook.testing-checklist.v1`, and **there is no import path for them**.
   Upgrading across that commit mid-walkthrough loses the run unless it is
   exported first.

2. **Four migrations take permissions away from seeded positions, two add new
   ones, and one clears a stored field.** `compliance.view` off the Member position,
   `notifications.view` off the baseline member and junior ranks,
   `facilities.view` off regular members _and then_ off the shared
   operational officer positions, and `users.view_consents` granted to the
   publication-facing ones. Separately,
   `20260827_1200_a7c4e9b13f58` **clears `User.rank` on every administrative
   member** and does not restore it on downgrade. Read
   [Permission and grant movements](#permission-and-grant-movements) before
   upgrading a department whose officers rely on any of those screens.

3. **`membership_type` is no longer the authority on a member's standing.**
   Two new columns — `member_class` and `member_status` — hold what that one
   column used to conflate, and `membership_type` is now _derived_ from them
   on every flush. Nothing reading the legacy column breaks; anything
   **writing** it should move to the pair, because the derivation is
   deliberately lossy in one direction (the legacy vocabulary cannot express
   an administrative probationer).

4. **The equipment-check template builder is a different screen.** Not
   restyled — rebuilt. The metadata sidebar, the three-step progress strip,
   the "Template readiness" card and the Quick Add / Bulk Add mode toggle are
   all gone. Every screenshot and every video take of that screen is
   **wrong**, not stale.

## Release map

| Area                                                            | PRs                                                                                                                                                   | Pages / connection points                                                                            | API / data points                                                                                                                                                                                 | Boundary and edge cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Membership standing — class, status, qualifications**         | #1833, #1839, #1841, #1844 (`emt-signup-qualification`); rank follow-ups #1849, #1852, #1856–#1858, #1900, #1943                                      | Member profile, Members administration, member create/edit, Elections eligibility, shift eligibility | New columns `users.member_class`, `users.member_status`; new table `member_qualifications`; `app/utils/membership.py` reconciles `membership_type` on flush                                       | `membership_type` held two independent facts — what kind of member somebody is (operational / administrative / social) and where they sit on the ladder (`prospective`, `probationary`, `regular`, `life`, `retired`, `honorary`, `junior` — **seven values, not the five common stages**; a client generated from a five-value vocabulary will reject or erase honorary and junior records, and the backfill maps an honorary member to social class _plus_ honorary status). Neither could be stated without losing the other, so there was no way to record a probationary treasurer, and nothing said whether a life member still rides. Elections is where the fused field showed most. **The built-in voter categories keep their legacy meaning** — `operational` still requires operational class **and** regular status. A first cut (`7204f9134`) had it read the class alone; `f65e4e7ae` reverted that **the same day**, because reading class alone admitted probationary and retired members to a restricted ballot. The two real changes: a **life member now satisfies `regular`** (with one fused field they were competing values), and **every status category now also requires the operational class**, so an administrative regular no longer receives active/life ballots — a tightening, not a widening. **Neither new column takes a DDL default** — a default would be applied to raw-SQL inserts naming only `membership_type` and would silently promote an administrative member into the operational class. `honorary` backfills to **social**, which is what the system already did with it. `member_qualifications` **starts empty**: nothing is inferred from rank, because a department that recorded somebody as an EMT _rank_ has said where they sit, not which card they hold or when it expires |
| **Organizational chart**                                        | #1796, #1808                                                                                                                                          | **`/governance/org-chart`** (new) — outline and diagram views, seat cards, node modal                | New tables `org_chart_nodes`, `org_chart_node_holders`; `GET /org-chart`, `POST /org-chart/nodes`, `PUT /org-chart/nodes/{id}`, `POST /org-chart/nodes/{id}/move`, `DELETE /org-chart/nodes/{id}` | **Reading is gated on authentication alone, deliberately.** The chart exists so any member can work out who runs an area without asking around; a permission would leave the general membership — the audience — outside the one screen built for them. Editing is `orgchart.manage` OR `settings.manage`, and the page renders read-only without either. **A seat holds several people** (`org_chart_node_holders`), so a two-deputy-chief department is expressible. A holder need not be a member: `display_name` carries a name with no `user_id`, for the town attorney or a mutual-aid liaison. `position_id` **assists** a seat rather than defining it — linking a seat to a position fills its holders from that position's assignees. **Unlinking keeps hand-entered holders and drops link-supplied ones** (`OrgChartNodeModal` filters every `fromLink` holder out of the draft; `_resolve_holders` supplies linked assignees only while the link exists), so a seat whose holders all came from its link goes vacant                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Testing checklist as a module**                               | #1947 (`home-page-testing-checklist`)                                                                                                                 | `/testing` (Testing Home), **`/testing/report/print`** (new)                                         | New tables `testing_checklist_entries`, `testing_runs`; `/api/v1/testing-checklist`; new module flag `testing`                                                                                    | **Off by default and not offered during onboarding** — it is a tool for checking an installation, not a decision a department needs while making every other one. Work is organised into **runs** ("Pre-launch, build 1.4"); starting a run archives the previous one rather than clearing it, and the first mark opens a run on its own. **Every mark is checked against what the app expected**: a refusal that happened as predicted counts as a gate verified, and a page that opened for an account that should have been refused is flagged at the mark, counted in the header, and listed in the printed report as a permissions defect. Marks record the build they were made against, so `Needs re-test` filters the ones made before a deployment. Exports: mark CSV, page-by-tester permission matrix, printable report, Markdown                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Equipment-check template builder — one canvas**               | ≈35 PRs across the `codex/*` equipment-check branches (#1976–#2062) and `claude/claude-design-changes` (#2064, #2068, #2071); revision tracking #2005 | Scheduling → equipment check templates: the builder                                                  | `equipment_check_templates.content_revision`; new table `equipment_check_bulk_delete_requests`; bulk-delete, clone and reorder endpoints                                                          | Sections, locations and items are now rows in **one list, in the order a crew walks them**. Name, answer type (Works / Count / Level / Date) and the one number that answer is graded against are edited in the row; description, serials, image, critical minimum and the inventory link moved behind a per-row disclosure, so opening anything is no longer a prerequisite for a complete item. Nesting is an indent button, not a dropdown listing every other location. **The reason Publish is unavailable is a list of specific fixes** that jump to the offending row, open its location and put the cursor in the empty field. The mobile preview docks beside the checklist **only at 1440px and wider** (`isWideCanvas`); below that — tablets and 1366px-class laptops included — the Preview control opens the modal, as it does on a phone. The rail costs 344px, and under 1440 that leaves a canvas too narrow to edit in. **Phones keep the compact rows and the full-height item editor.** Bulk deletes go through a **retry-safe ledger** so a repeated request cannot delete rows a later edit added                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Module gating for thirty-four routers**                       | #1840 and follow-ups                                                                                                                                  | Every module-owned screen                                                                            | `module_gate()` in `api/v1/api.py`, `require_module` dependency                                                                                                                                   | Gating at the **router**, not per endpoint, is the point: a route added to an already-gated module inherits the gate, so the invariant cannot be lost by somebody forgetting a decorator. Three kinds of router are deliberately **left ungated**, each for a stated reason — essential modules (members, events, documents, roles, settings) where `ModuleSettings` has no field and a gate would be a permanent no-op; cross-module infrastructure (`locations`, which is the stand-in served when Facilities is off, plus `forms`, `labels`, `nfc_tags`, `email_templates`, `analytics`, `compliance`); and platform surfaces (auth, onboarding, audit, errors, security, scheduled tasks, dashboard)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Facilities — a settings screen, and a much smaller audience** | #1836 (`security-review-facilities`), #1936, #2023, #2030, #2031 (`manager-only-facilities-settings-route`), #1951 (folder gating)                    | **`/facilities/settings`** (new, `facilities.manage`); Facility detail → Files                       | Migrations `e4f5a6b7c8d9`, `c7e2b9a41f83`, `a9c4e7b2f631`; `FACILITY_ENTRY_PERMISSIONS`                                                                                                           | The Files section stores each upload as a row in the shared **Documents** module and keeps only a reference on the facility. The facility record was restricted; **the file was not** — uploads landed outside any folder, and a file in no folder is treated as organization-wide, so anyone who could open Documents could list and download insurance policies, leases, capital-project files and inspection paperwork. Folders are now gated on the same three facility grants and existing folders have their `required_permissions` set on upgrade. **The migration does not re-file the documents themselves**: `a9c4e7b2f631` only writes `document_folders.required_permissions`, and `_validate_shared_document_reference` files a document only as it is newly attached — so **every facility file uploaded before the upgrade is still folderless, still organization-wide, and still readable by a documents administrator.** That residual exposure needs a re-file and is called out in the training guides and the wiki handoff. Two officers opening a new facility's Files tab in the same moment could each create a duplicate folder set; that is now serialized                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Administrative seats and administrative shift access**        | #1977, #1980, #1987 (`extend-scheduling-model-for-admin-access`)                                                                                      | Scheduling settings → position names; shift and template seat lists; member ID cards                 | Migration `b8d5f0c24a69` — third field `allow_administrative_members` on every stored seat object                                                                                                 | Crew seat entries settle onto a **three-field shape** (`position`, `required`, `allow_administrative_members`); legacy bare strings and two-field objects are converted, and non-list values are passed through untouched because `shift_templates.positions` also stores event metadata (Pitfall #20). An administrative member is admitted to a seat only where the seat opts in, and per-position seat limits are enforced on the way in. Member ID cards show administrative standing so a station officer can tell at a glance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Inventory — receiving, returns and the distribution rename**  | #1835 (`security-review-inventory`), #1885 (rename), #1886 (attention queue), #1889 (reorder transitions), #1890 (return process)                     | Inventory: item detail, return-request review, transfer, receiving, attention queue                  | Migrations `a8f3c1d7e902` (reorder receiving), `f4a9c2d81e70` (physical return receipt), `8fb3757b80ec` (equipment request duration); `frontend/src/modules/inventory/terminology.ts`             | "Checkout batch" is now **Item Distribution**. `terminology.ts` states the canonical vocabulary (Assignment, Temporary loan, Issuance, Return, Check-in, Transfer, Distribution) as a **glossary and request-type helper — not every screen label**: `InventoryMembersPage` still renders "Active Checkouts" and `EquipmentRequestsPage` still offers "Checkout — returnable individual item". The rename that has actually landed is the distribution flow; the rest is a target. **API payload values are unchanged** — `checkout`, `assignment` and `issuance` still travel on the wire; only the labels moved. Completing maintenance and recording poor/damaged/out-of-service condition no longer permits "Return to service". Two quartermasters acting on one return request at the same moment could overwrite each other; that review is now serialized. **Stock received through the reorder workflow now actually becomes issuable** — receiving created a purchase record and never updated on-hand                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Storefront personalization**                                  | #1819, #1824, #1834, #1837                                                                                                                            | Store item detail, sizing request, order detail                                                      | Migrations `b5e2d9a37c48` (thread colour), `c6a3f8b41e29` (variant size order), `d7f4a2c81b93` (personalization method); `ThreadSwatch.tsx`, `personalization.ts`, `threadPreview.ts`             | **Embroidery and engraving are not the same job.** They were one "customization" field; a thread colour on an engraved brass plate is meaningless, and an engraved item asked for one anyway. Variant sizes now sort in garment order rather than alphabetically, so `XL` no longer files between `L` and `XS`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Communications**                                              | #1828 (`message-navigation-path`), #1930 (scheduled delivery), #1817 (photo-use consent)                                                              | **`/messages/:id`** (new detail page); **`/communications/photo-use-consent`** (new)                 | Migrations `d4e5f6a7b8c9` (message recipients), `20260826_1600` (delivery keys), `20260826_1700` (export stream status)                                                                           | The message detail page sits under `/messages` so the breadcrumb back to the inbox is the URL's own parent, and takes **no permission beyond sign-in** — the backend only serves a message the caller was actually targeted with. The photo-use consent roster accepts any of `users.view_consents`, `notifications.manage`, `members.manage`, `users.edit`, and is excluded from the API response cache. An already-sent department message could go out a second time; delivery is now keyed, and a **reported send failure is never recorded as delivered**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Compliance configuration**                                    | #2059 (`security-review-compliance-pass2`)                                                                                                            | Compliance → requirements configuration                                                              | —                                                                                                                                                                                                 | Clearing a field and saving left the old value in place behind a success toast — the classic omitted-key update bug (Pitfall #1). Consequential: a profile whose officer had unchecked **every** required requirement was graded against every active org-wide requirement instead of none, once the fix let that empty selection reach the database. Org-wide percentages and per-profile grading could be materially wrong for any group meant to have no required certifications. The "Notify members when they become non-compliant" panel is now **labelled as not yet active** (Pitfall #19)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Grants & fundraising**                                        | #2069, #2070, #2073                                                                                                                                   | Grants dashboard, campaigns, donors, application detail, reports                                     | —                                                                                                                                                                                                 | A report covering a range that included **today** (the default) dropped everything recorded later that same day. The fundraising payment-method breakdown showed 0.0% for every method as soon as two methods had donations. View-only members were shown New Campaign / Add Donor / New Application / Add Item / Record Expenditure / Add Task / Add Note buttons that failed on click with no explanation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Medical supplies**                                            | #2075–#2078                                                                                                                                           | Medical supplies catalog and summary                                                                 | —                                                                                                                                                                                                 | The summary's Low Stock count only examined the **first 500 active items**, so a department over that threshold could have a low-stock item missing from the headline count while listed correctly in the table below. Creating a category or item was audited; **editing one was not**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Meetings and minutes**                                        | #2079, #2080                                                                                                                                          | Meeting minutes; meeting records                                                                     | —                                                                                                                                                                                                 | "Unlink" on a linked event showed _Event unlinked_ and never removed the link — it returned on the next load. Meeting **minutes** recorded who changed what; meeting **records** (create, edit, delete, approve, and their attendees and action items) recorded nothing. They do now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Security review rotation — second pass**                      | #1799–#1815, #1816–#1846, #1949–#1973, #2012–#2083                                                                                                    | Every module                                                                                         | `docs/security-review/*.md`, `PROGRESS.md`                                                                                                                                                        | Twenty-five features completed a second pass in this window. Findings and their disposition are per-feature in [`docs/security-review/`](./security-review/); the user-visible half is in `CHANGELOG.md` under the 2026-08-25 → 2026-08-31 dates                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## Alembic route (upgrade data path)

**Forty-five new revisions. Head is `f6a7b8c9d0e1`**
(`20260829_0001_add_equipment_template_content_revision.py`). The chain
validates to a single head:

```
$ cd backend && python scripts/validate_migrations.py
Migrations found: 394
Head revisions: 1
  head -> f6a7b8c9d0e1
VALIDATION PASSED
```

Seven of the forty-five are **merge revisions** that exist only to rejoin
forked heads (`cff6124cbb3f`, `b272a5d5535c`, `4b71d80aa2c1`, `d5e6f7a8b9c0`,
`5128feb36dd2`, `5b165386cc5f`, `a0af87c3904a`). They carry no DDL. Their
number is itself worth noting: seven forks in one week is the highest this
project has recorded, and every one came from two branches picking the same
`down_revision` while both were open. See
[Known limitations opened this window](#known-limitations-opened-this-window).

### Reversibility

**Five migrations do not restore the prior state on downgrade, and each says
so in its own docstring.** Four are no-ops where a downgrade that _did_ restore
the old values would be the more destructive option. **The fifth is different
in kind and is the one to plan around:** `a7c93f21d5b8` is _lossy by
construction_.

> **⚠️ Rolling back past `a7c93f21d5b8` destroys org-chart holder data.** The
> downgrade restores the single-holder shape by keeping **each seat's first
> holder only**, then drops `org_chart_node_holders`. Every additional holder a
> department added is gone, and a seat whose holders came only from a position
> link comes back **empty**. The migration's own docstring calls this lossy and
> explains the trade: refusing to downgrade at all would strand an operator
> rolling back a deploy, which was judged worse than a documented, bounded
> loss.
>
> **If a department has drawn its org chart and you may roll back, export
> `org_chart_node_holders` first.** No other migration in this window destroys
> data on the way down.

The four no-op downgrades:

| Revision       | What it does                                                    | Why the downgrade is a no-op                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `a7c4e9b13f58` | Clears `User.rank` on every administrative member               | An operational rank is a chain-of-command position, and `_collect_user_permissions` unions `get_rank_default_permissions(user.rank)` into a member's effective permissions — so an administrative Fire Chief held operational grants. **Nothing records which ranks this cleared**, so restoring them would restore ranks an officer may have cleared deliberately. Nor can an operator re-create the pair by hand: `_refuse_administrative_rank` returns 400 for an administrative-class/rank pair on both create and update, and the edit UI disables the control — the recovery is to change the member's **class** first |
| `c3d4e5f6a7b8` | Recovers membership standing out of membership _positions_      | Nothing records which members were reclassified here rather than by an officer. Putting them all back to operational/regular would flatten standings a department set deliberately. The positions they came from were never deleted                                                                                                                                                                                                                                                                                                                                                                                          |
| `d7a4e9c31b60` | Canonicalizes crew seat names (`EMT`/`EMS` → one token)         | The two spellings really were one seat. Splitting them again would have to guess which rows started as which                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `b8d5f0c24a69` | Adds `allow_administrative_members` to every stored seat object | Downgrade is a deliberate no-op because **older readers accept the extra property** — the three-field shape is forward- and backward-readable, so there is nothing to undo                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

**`f6a7b8c9d0e1` reverses cleanly** (it drops the column it added), as do all
the schema-only revisions in the window.

**Migrations that deliberately backfill nothing**, and where an empty result
is correct rather than a failure: `member_qualifications` starts empty (see
the release map), `org_chart_nodes` starts empty (a department draws its own
chart), `testing_runs` starts empty, and `content_revision` starts at 1 for
every existing template.

## New data model

### `org_chart_nodes` / `org_chart_node_holders` — the chain of command

`org_chart_nodes` is a self-referencing tree (`parent_id`) of seats, each with
a `title`, an optional `responsibility`, optional `contact_email` /
`contact_phone`, a `sort_order` among its siblings, and an `is_published`
flag. `position_id` and `rank_code` are **assists**, not definitions — a seat
linked to a position fills its holders from that position's assignees.

**Unlinking keeps hand-entered holders and drops link-supplied ones.**
`OrgChartNodeModal` filters every `fromLink` holder out of the editable draft
before sending `positionId: null` / `rankCode: null`, and
`_resolve_holders` supplies linked assignees only while the link exists — they
were never rows on the seat. So a seat whose holders all came from its link
**goes vacant** when it is unlinked, which is the one thing an editor needs
warning about before pressing it.

`org_chart_node_holders` is the many-to-many that makes a seat hold more than
one person. `user_id` is nullable and `display_name` carries a name for a
holder who is not a member of the department at all.

### `member_qualifications` — what a member is certified to do

Rank says where a member sits; a qualification says what they are trained to
do. `User.rank` is one string, so a **Captain who is also a Paramedic** — an
entirely ordinary member of a volunteer department — had nowhere to be
recorded as both. The standards already draw the line: Firefighter I/II is
NFPA 1001, apparatus operator is NFPA 1002, the officer ladder is NFPA 1021,
and EMT/Paramedic are EMS credentials on a separate track.

Qualifications expire and ranks do not, which is the other half of why they
cannot share a column. Shift eligibility reads `expires_on` **as of the shift
date**, not as of today — the rule EVOC certifications already use, and for
the same reason: a card that is current when the roster is built and expired
when the truck rolls qualifies nobody to be on it. The bulk eligibility path
resolves this per distinct shift date rather than once per member.

`emt` is now **both a rank code and a qualification code, meaning two
different things on purpose.** Neither implies the other, and a department may
use either or both.

### `users.member_class` / `users.member_status` — two facts, two columns

See the release map for the reasoning. The mechanics worth stating here:

- **Neither takes a database default.** A DDL default is applied to raw-SQL
  inserts that name only `membership_type`, and would be wrong for exactly the
  members who are not plain operational regulars.
- **NULL means "this is not one of the seven, and we are not guessing"**, and
  readers fall back to deriving from the legacy field.

  **ORM writes do leave both columns NULL, by design.** `membership_type` also
  stores **org-configurable membership tier ids** — `POST
/member-status/.../tier` validates the id against
  `organization.settings["membership_tiers"]` and writes it straight into the
  column, and the shipped defaults already include `senior`. For any value
  outside the seven it knows, `split_membership_type` returns `(None, None)`
  and `_reconcile_membership` writes that back.

  That is the safe direction: a Senior Member satisfied neither "operational"
  nor "regular" before the split, and defaulting an unknown tier to a regular
  operational member would silently widen the electorate of any ballot
  restricted to either. An **empty** value is different and does resolve to the
  default, because the column defaults to `"active"`.

  **Integrators should not treat these two columns as always populated.** A
  department running a custom tier will have members with both NULL, and that
  is correct rather than a migration that failed.

- **Whichever side a caller writes wins.** A listener on `User` reconciles the
  pair and `membership_type` on every flush, so ~160 existing call sites are
  unchanged.

### `testing_checklist_entries` / `testing_runs` — the pre-launch walkthrough

One row per tester per page, now scoped to a **run**. A run carries a name and
a build identifier; starting a new one archives its predecessor rather than
clearing it. Each entry records the expected access verdict alongside the
observed one, which is what lets the printed report separate "this page is
broken" from "this page opened for an account that should have been refused".

### `equipment_check_bulk_delete_requests` — the retry-safe ledger

A bulk delete of template items is idempotent by request id. Without the
ledger, a retried request (a flaky connection, a double tap) deleted whatever
occupied those positions at the time it arrived, which after an intervening
edit is not what the user selected.

### Added columns

| Table                       | Column                                | Note                                                                                     |
| --------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `users`                     | `member_class`, `member_status`       | No DDL default, deliberately                                                             |
| `equipment_check_templates` | `content_revision`                    | Starts at 1; drafts key off it so a draft cannot be replayed against a changed checklist |
| `label_printers`            | preset fields                         | Stock presets per printer language                                                       |
| `equipment_requests`        | duration                              | Temporary-loan expected return                                                           |
| `storefront` variants       | thread colour, personalization method | Embroidery vs. engraving                                                                 |

## Permission and grant movements

**This is the section to read before upgrading a live department.** Six
migrations move grants on _seeded_ positions — **four revoke a grant, two add a
new permission**. Scoped to `is_system = True` — a
department's own customized position is theirs (Pitfall #23).

| Revision                                       | Movement                                                                            | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `31e2816df7c3`                                 | **Revokes** `compliance.view` from the system Member position                       | It reads as an innocuous view grant, but it is an accepted alternative on two officer-grade checks, including `GET /compliance-officer/contributed-hours`                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `a1f7c34e9b02`                                 | **Revokes** `notifications.view` from the baseline member and junior-rank positions | It gates three admin tabs, one of which is the Send Log — filtered on `organization_id` and nothing else                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `e4f5a6b7c8d9`                                 | **Revokes** `facilities.view` from the regular-member position                      | The facilities workspace is leadership and facility managers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `c7e2b9a41f83`                                 | **Revokes** `facilities.view` from the shared operational officer positions         | The registry stopped handing it out; this covers the rows already stored                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `e3b7c25f9a41`                                 | **Grants** `training.configure` to the seeded positions that configure training     | New permission, and **narrower than "the module's org-level settings"**: `PUT /training-module/config` rejects every field outside `MEMBER_DISCLOSURE_FIELDS` with a 403 unless the caller also holds `training.manage`. It grants the **member-disclosure policy only** — how much of an officer's written assessment the assessed member may read. Shift reports, the officer's report form, apparatus skill mapping, the rating scale and the review workflow all still need `training.manage`. Documenting it more broadly would have administrators assign a position that then receives 403s |
| `c4a91b7e2f08`                                 | **Grants** `users.view_consents` to the publication-facing positions                | New permission, accepted by the photo-use consent roster. Registry changes only affect organizations onboarded _after_ the deploy, so the migration covers the Historian and PIO rows already stored                                                                                                                                                                                                                                                                                                                                                                                               |
| `a4f8c1b92d17`, `c4f8a2e70d19`, `b3e8d1f45a27` | **Grant** storefront access to member and corporate positions                       | Backfills for the store's own audience                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `472a1e34aa84`                                 | **Grants** the compliance tasks generated flag                                      | Supporting grant for compliance task generation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `a7c4e9b13f58`                                 | **Clears** `User.rank` on administrative members                                    | See [Reversibility](#reversibility)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

**What an administrator has to do about it:** nothing is granted back
automatically. If your compliance officer used the Member position's
`compliance.view` to read contributed hours, or your line officers used
`facilities.view` to open the facilities workspace, those grants are gone and
must be re-granted on a position that is meant to carry them.

## Security fixes

Authorization, disclosure and integrity fixes are the largest single
category in this window. The full per-finding record is in
[`docs/security-review/`](./security-review/); this is the shape of them.

**Cross-tenant reads (Pitfall #14).** The finance approvals queue scanned
every organization's pending steps. An officer with compliance access could
look up any member's admin-hours progress **in any department**. A
cross-tenant event-attachment read (EV-17). A member's audit history could
show unrelated actions performed on someone else.

**Privilege escalation.** Converting a prospect to a full member could assign
the new account a role carrying more permissions than the staff member doing
the conversion held, including one controlling the whole organization — the
safeguard already applied to direct member creation now applies here too. A
denied role assignment during member creation could leave behind a live,
unauthorized account.

**Separation of duties.** A storefront manager could settle their own order's
payment. A finance approval token could approve its own requester's request. A
secretary could submit _and_ approve their own meeting minutes. A
skills-testing officer could void or return their own result.

**Disclosure.** Facility files readable by the whole department through
Documents — **closed for new uploads only**; files predating the upgrade are
still folderless and still readable until re-filed (see the release map). Every member could read every other member's
notifications. A membership applicant's file could reach a signer who could
not otherwise view it. **Eight named surfaces** could hold member-identifying
data in the browser's stale-while-revalidate cache for up to 90 seconds — a
training cohort roster, a program's enrollment-eligibility list, an external
provider's member mappings, a form-management page, a raw analytics export, the
department-wide competency heat map, the training dashboard's at-risk widgets,
and the training-session approval roster. A grants/fundraising list was closed
as a precaution.

**Monitoring that was never running.** The background check meant to detect
session hijacking and unusual bulk downloads never ran, for any request: it
looked for the signed-in user _before_ the request had been authenticated,
under an attribute name nothing ever set. Both checks now run. In the same
pass: the hourly data-export rate limit could be reset early by unrelated
traffic in the Redis-outage fallback; a total database-connection failure at
startup could put the database password into logs on a second code path; and a
client-supplied request-tracing ID was echoed into logs and a response header
without validation.

**Races that cost money or seats.** Two approvers acting at the same moment
could double-charge a budget, and a budget's cap could be bypassed. Two
transfer requests for one prospect could each create an account. Two
quartermasters could overwrite each other's decision on one return request.
All are now serialized on the parent row with a locking count (Pitfall #27).

## Known limitations opened this window

Two new entries were written into
[`KNOWN_LIMITATIONS.md`](./KNOWN_LIMITATIONS.md) for this window; a third was
already recorded there and is only summarised here.

### QUAL-1 — qualifications are written only through a course

A course's **Certifies** field (`courses.grants_qualification`) plus
`_sync_qualifications` on the training-record paths is the supported write
path. What does not exist is any way to enter, edit or expire a qualification
**on its own** — so a card a member has held for years needs a matching
training record, an expiry is corrected by editing the training record that produced it (`PATCH /training/records/{id}` re-runs the sync) rather than by filing a second completion, which would invent training history, and
setting **Certifies** on a course does not backfill records already filed
against it. Recorded in full as
[QUAL-1](./KNOWN_LIMITATIONS.md#qual-1--qualifications-can-only-be-written-through-a-course-never-entered-directly-2026-08-26).

**An earlier draft of this audit said there was no write path at all**, and the
training guides and screenshot plan inherited that. The mistake came from
reading the model, the service and the changelog without grepping for callers
of `_sync_qualifications` — the feature's write side lives in the training
endpoints, not beside its model.

### MIG-1 — seven forked migration heads in seven days

Every one came from two open branches choosing the same `down_revision`. The
merge revisions resolve them and the chain validates, but the rate is new: each
fork took a CI cycle to surface and a follow-up PR to repair, and one had to
clean up after two earlier ones. Nothing warns an author at the point the
mistake is made, because the competing revision is not on `main` yet —
`validate_migrations.py` can only catch it once both have merged. Recorded as
[MIG-1](./KNOWN_LIMITATIONS.md#mig-1--nothing-prevents-two-open-branches-from-claiming-the-same-down_revision-2026-08-31).

### The compliance non-compliance notification is stored and inert

Already recorded, in more detail than this audit adds, in
`KNOWN_LIMITATIONS.md` as **CMP2-1**. This window applied the **partial fix**:
the panel now carries an explicit "Not yet active" notice, which is the
sanctioned second option under Pitfall #19. The switch is still wired to
nothing, and the scheduled task that would read it is a product decision on
cadence and content rather than a drive-by fix.

### The equipment-check lap is still not wired

Carried forward unchanged from the
[August 23–24 audit](./CHANGE_AUDIT_2026-08-23_TO_24.md#the-equipment-check-lap-is-built-but-unreferenced).
The four canonical item types and the lap UI are built and tested; the live
check screen still renders the previous flat compartment list. The template
builder rebuild in this window is the **authoring** side and does not change
this. Do not narrate the lap as the current member experience.

## Documentation and media disposition

### Screenshots

Full per-image queue in
[`training/SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md);
coverage counts are regenerated into
[`training/SCREENSHOT_STATUS.md`](./training/SCREENSHOT_STATUS.md) by
`scripts/screenshots/status_report.py`.

**Two changes invalidate captures in bulk rather than individually:**

1. **The equipment-check template builder.** Every capture of that screen
   shows a metadata sidebar, a three-step progress strip, a "Template
   readiness" card and a Quick Add / Bulk Add toggle, **none of which
   exist**. This is not a restyle; a viewer following an old capture cannot
   find the controls. Re-shoot at a laptop width (the docked preview and the
   side-by-side row controls need a wide canvas) _and_ at a phone
   width (compact rows, full-height item editor, blockers as a bottom sheet).
2. ~~Anything showing a member's membership type.~~ **Withdrawn — this was
   wrong.** No screen renders `member_class` or `member_status` as fields:
   `MemberProfilePage` shows roles and account status, `MembersAdminPage` has
   Member / Member # / Roles columns, and both Add Member and Member Admin Edit
   still render **one Membership Type selector** whose value the pair is
   derived from. The elections eligibility roster's refusal reason is unchanged
   too — it still reads "membership type not eligible … (requires: …; member
   has: …)".

   **Every existing capture of those screens is still current**, and the
   original instruction would have discarded valid images and sent producers to
   photograph fields that do not exist. The class/status split is a data-model
   change with no UI surface yet; the only place it is visible to a user is a
   **ballot recipient list**.

| Image area                                                                | Disposition               | Why                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Equipment check **template builder** — laptop                             | **REPLACE**               | Rebuilt as one canvas; sidebar, progress strip, readiness card and mode toggle all gone                                                                                                                                                                                        |
| Equipment check **template builder** — phone                              | **REPLACE**               | Compact rows, full-height item editor, blockers in a bottom bar                                                                                                                                                                                                                |
| **Compliance requirements configuration**                                 | **REPLACE**               | The non-compliance notification panel now carries a "not yet active" label                                                                                                                                                                                                     |
| **Grants & fundraising** dashboard, campaigns, donors, application detail | **REPLACE**               | Action buttons are hidden for view-only members — caption the capturing account's grants                                                                                                                                                                                       |
| **Inventory** item detail, return-request review, transfer                | **REPLACE**               | "Checkout batch" is Item Distribution; the "Transfer is immediate" checkbox is gone                                                                                                                                                                                            |
| **Store** item detail and sizing request                                  | **REPLACE**               | Embroidery and engraving are separate; thread swatch only on embroidery; sizes in garment order                                                                                                                                                                                |
| **Facility detail → Files**                                               | **REPLACE**               | Folder structure and the smaller audience                                                                                                                                                                                                                                      |
| Any **navigation** capture showing Facilities for a regular member        | **REPLACE**               | `facilities.view` was revoked from the regular-member and operational-officer positions                                                                                                                                                                                        |
| **`/governance/org-chart`** — outline view                                | **NEW**                   | Screen has never been captured                                                                                                                                                                                                                                                 |
| **`/governance/org-chart`** — diagram view                                | **NEW**                   | Second view of a new screen; shoot both, they are not interchangeable                                                                                                                                                                                                          |
| Org chart **node modal** (multi-holder, non-member holder)                | **NEW**                   | The two things reviewers will ask about                                                                                                                                                                                                                                        |
| **`/facilities/settings`**                                                | **NEW**                   | New manager-only screen                                                                                                                                                                                                                                                        |
| **`/testing`** with a named run and the run picker                        | **NEW**                   | Runs did not exist; shoot one with an archived predecessor visible                                                                                                                                                                                                             |
| **`/testing/report/print`**                                               | **NEW**                   | New printable report                                                                                                                                                                                                                                                           |
| Testing Home **gate-mismatch flag**                                       | **NEW**                   | The permissions-defect marker at the mark                                                                                                                                                                                                                                      |
| **`/messages/:id`**                                                       | **NEW**                   | New detail page                                                                                                                                                                                                                                                                |
| **`/communications/photo-use-consent`**                                   | **NEW**                   | New roster                                                                                                                                                                                                                                                                     |
| Settings → **Modules** showing Testing Checklist **off**                  | **NEW**                   | The upgrade's most visible surprise; the shot is the answer to "where did /testing go"                                                                                                                                                                                         |
| **Member qualifications** entry                                           | **DO NOT CAPTURE**        | No direct entry screen exists — a qualification is written only as a side effect of a training record against a course whose **Certifies** field is set (QUAL-1). Capture that selector if the workflow must be shown; never mock a qualifications panel on the member profile |
| Live equipment **check screen**                                           | **DO NOT CAPTURE AS NEW** | The lap is still not wired; the screen is unchanged                                                                                                                                                                                                                            |

### YouTube script beats

Full detail in
[`youtube-scripts/SCRIPT_CURRENCY.md`](./youtube-scripts/SCRIPT_CURRENCY.md).
Summary of this window's disposition:

- **03 — IT Manager / System Admin.** New head `f6a7b8c9d0e1`, forty-five
  revisions, four with no-op downgrades. Needs a new chapter on the module
  gate and on the permission revocations, both of which are this script's
  audience answering "why did that page disappear".
- **04 — Fire Chief / Leadership.** The org chart is a chief's screen and has
  never been shot. The `facilities.view` revocation changes what line officers
  can open.
- **05 / 16 — Training Officer.** `training.configure` splits the **member
  visibility panel only** away from `training.manage`; any take saying that
  panel is behind "training management" is **wrong**, and any take implying
  `training.configure` covers the module's other settings is wrong the other
  way — those still 403 without `training.manage`.
- **06 — Member Guide.** Membership class and status are visible on the
  profile; the org chart is the member-facing reason it exists.
- **07 — Secretary / Administrative.** Meeting records are now audited, and
  Unlink actually unlinks.
- **13 — Department Store.** Embroidery and engraving are separate jobs.
  Any take showing a thread-colour picker on an engraved item is **wrong**.
- **08 — Quick Tips & Shorts.** Five new shorts available: who runs this area
  (org chart); one member, two facts (class vs. status); build a check
  template in one list; the run picker; where /testing went.

**Do not script qualification entry, and do not script the equipment-check
lap.** Both are built and neither is reachable.

## Verification

Run these before trusting anything above:

```bash
cd backend && python scripts/validate_migrations.py   # head = f6a7b8c9d0e1
python3 scripts/check_route_permissions.py --strict   # routes vs APPLICATION_PAGES.md
python3 scripts/check_endpoint_permissions.py         # endpoints vs docstrings
python3 scripts/check_docs_links.py                   # cross-doc links
python3 scripts/screenshots/status_report.py          # screenshot coverage
```
