# Change audit: August 2026

One section per documentation pass, newest first. Each pass adds its
section at the top of the current month's file, and a new month starts a
new file. The plain-language handoff for each pass is in
[`wiki/Recent-Changes-2026-08.md`](../wiki/Recent-Changes-2026-08.md).

## Change audit: August 31 – September 6, 2026

Net changes merged to `main` in the seven days ending 2026-09-06, picking up
where the [August 24–31 audit](./CHANGE_AUDIT_2026-08-24_TO_31.md) stopped at
`9445bc44` (PR #2083, 2026-08-31 00:10 EDT).

**213 pull requests (#2078 – #2306).** Thirty-four schema migrations, head
`d7c1b95e2a40`. **Two modules changed address** — equipment checklists moved
out of Scheduling into Inventory, and scheduling administration moved into the
Administration section — which between them **retire fourteen URLs with no
redirect**. One integration a department has never seen (the Claude MCP
server, off by default). Two email platforms that **had never been able to
send** now send. And a long run of **permission repairs on seeded positions**,
tracing one root cause: the old onboarding wizard wrote a heuristic's output
over the permission registry's own seeded rows.

**126 changelog sections** carry a date inside this window. That is the number
to quote when somebody asks how much moved; the release map below groups them.

Companion operator lesson:
[`training/20-september-2026-release-changes.md`](./training/20-september-2026-release-changes.md).
Wiki handoff:
[`Recent-Changes-2026-08-31-to-09-06`](../wiki/Recent-Changes-2026-08-31-to-09-06.md).
Media disposition — which screenshots must be created, which replaced, and
which YouTube takes need rewriting — is in [Documentation and media
disposition](#documentation-and-media-disposition) below.

### Read this first

Five things in this window change what an operator or integrator must do,
rather than just what they see:

1. **Fourteen addresses stop taking a member where they used to, and none of
   them redirects.** Equipment checklists moved from Scheduling to Inventory
   (eight) and scheduling administration moved under `/scheduling/admin`
   (six). **Thirteen are retired paths**: a bookmark, a link in a
   previously-sent email, or a notification already sitting in a member's bell
   lands on the dashboard — silently, because the catch-all redirect succeeds.
   **The fourteenth is not a retired path at all.**
   `/scheduling?tab=equipment-checks` still resolves, because `/scheduling`
   does; the removed tab value is simply ignored and the page opens on
   **Schedule**. The member does not reach their checklists and nothing says
   why, so it is as broken in effect — but it lands somewhere else, which
   matters if you are testing these by hand. `/store/admin` **does** redirect
   (to `/inventory/admin/store`) and is _not_ one of the fourteen. The full
   before/after tables are in [Retired URLs](#retired-urls).

2. **Six migrations take permissions away from seeded positions, and three
   give some back.** `reports.view` and `apparatus.view` come off the
   rank-and-file; `integrations.view`, `medical_supplies.view`, `mobile.view`
   and `prospective_members.view` come off Member, Firefighter, Engineer and
   EMT; Engineer's `apparatus.*` wildcard is narrowed. **One of these is
   removed unconditionally, including where a department granted it
   deliberately** — see [Permission and grant
   movements](#permission-and-grant-movements) before upgrading a live
   department.

3. **A position holding `inventory.*` gained three grants it did not have.**
   Renaming `equipment_check.view/.manage/.submit` to
   `inventory.check_view/.check_manage/.check_submit` brought them inside the
   Inventory module, and a module wildcard covers its whole module. No seeded
   position or rank grants `inventory.*`, so this reaches only positions a
   department built for itself — typically a quartermaster, who can now author
   and submit equipment checklists. Deliberate, and now pinned by a test.

4. **Gmail and Microsoft 365 email configurations saved before this window
   never worked, and the OAuth fields on them are being deleted.** The form
   stored credentials under keys the sender never read, so every message for
   that department failed after a green "saved" toast. Both are now ordinary
   SMTP submission behind a preset. Migration `e3a9c1d5b7f2` prunes the
   retired Gmail/Microsoft OAuth client-credential keys from every stored row
   and **is not reversible** — the pruned keys held secrets nothing read.

5. **Three data repairs that shipped months ago had never run on any upgraded
   department.** Four migrations named a table `positions` while it was still
   called `roles`; existence guards turned the resulting crash into a silent
   no-op, and the rename six days later never revisited them. The Membership
   Committee Chair was never renamed to Membership Coordinator, role-targeted
   department messages were never converted from names to ids, and the default
   Member position never received the equipment-check submit grant.
   `e8a1c04f6b27` performs all three at the current head.

### Release map

| Area                                                              | PRs                                                      | Pages / connection points                                                                                                                                                                                                                                                         | API / data points                                                                                                                                                                                                                                                                                                                    | Boundary and edge cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Equipment checklists move to Inventory**                        | #2110, #2113, #2115, #2116, #2122, #2123, #2126, #2129   | **`/inventory/checklists`** (crew), `/inventory/checklists/my`, `/inventory/checklists/log`, `/inventory/checklists/apparatus/{id}`, `/inventory/checklists/apparatus-inventory`; **`/inventory/admin/checklists`** and its `templates`, `reports`, `supply`, `settings` children | Permission rename `equipment_check.*` → `inventory.check_*` (`ff8076f4987a`); `7e2f11397849` re-enables the Inventory module where checks are in use; new table `shift_template_equipment_checks` (`191a99d1d16f`); `shifts.template_id` (`fab0ab7897d3`); `4e7e125cb00f` drops `scheduling_module_configs.equipment_check_settings` | A checklist is a list of inventory items, so it now lives with them. **Crews are unaffected at the point of use** — check-in and the shift detail panel still offer "Start checklist", and finalization still refuses to close on outstanding end-of-shift checks. What moved is authoring, reporting and the fleet views. The Equipment Checks tab is **gone from the shift screen**; members find checks under Operations → **My Checklists**, officers under **Fleet Readiness**. **Checklists now require the Inventory module** — a department that had switched it off has it switched back on automatically _if it uses checks_; switched off deliberately afterwards, the tab disappears rather than erroring. A shift template can now **name the checklists its shifts carry**; naming none keeps apparatus-based resolution, so nothing changes until a department uses it. Four settings that were stored, echoed and **read by no code** are removed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Scheduling administration moves into Administration**           | #2263, #2267, #2272, #2277, #2285                        | **`/scheduling/admin`** (hub), `/planning`, `/planning/templates`, `/planning/patterns`, `/reports`, `/platoons`, `/positions`, and six `/settings/<section>` routes                                                                                                              | `ADMIN_NAVIGATION_PERMISSIONS` gains `scheduling.manage`; `GET /scheduling/eligibility/roster` narrowed to `scheduling.manage`; `SchedulingSettingsRedirect` forwards legacy `?tab=`                                                                                                                                                 | Everything an officer administers is now in the **Administration** section beside Training Admin and Inventory Admin, not on a strip of "Officer tools" on the member-facing page. **Each settings section is its own route** — deliberately unlike Organization and Events, which mirror the section into `?tab=`; a section inside an administration hub is a destination (a hub card, a bookmark, a link from Inventory) and a `?tab=` only client state reads cannot be linked to. `CLAUDE.md`'s settings rule now records the difference so it is not "fixed" back. **Breaking:** every scheduling administration page requires `scheduling.manage`; the position roster previously also accepted `training.view_all`/`training.manage`, and the endpoint behind it did too — narrowing only the page would have revoked nothing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Shift planning is one screen**                                  | #2277, #2285                                             | **`/scheduling/admin/planning`** — staffing gaps, with templates and patterns as sibling sections                                                                                                                                                                                 | Reuses the drawer's own assignment call; `filter_shifts_with_open_positions`                                                                                                                                                                                                                                                         | Every upcoming shift carrying fewer people than it asks for, with the assignment on the row: ten gaps was ten trips through the month grid, and is ten selections now. Surfaces the same EVOC and overtime advisories and opens the same driver-exception dialog on `LB-SCHED-001`. **What counts as short is the board's rule, taken whole** (`shiftCapacity`/`shiftStatusInfo`/`buildSeats`), so this screen cannot answer differently from the calendar — with one stated consequence: a shift naming neither positions nor a `min_staffing` is not listed here while the hub's server-side metric does count it. **Openness is judged differently from the board on purpose** — the board zeroes open seats once the member signup window closes, which would hide the shifts starting today                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Claude (MCP) integration**                                      | #2196 and follow-ups                                     | Integrations → Claude (MCP): connect form and Service key panel; **`/api/mcp`**                                                                                                                                                                                                   | New table `mcp_service_keys` (`c4d5e6f7a8b9`); `meeting_action_items.created_by`/`source` (`7bfe85f2e4e5`); new permission `integrations.mcp_keys`                                                                                                                                                                                   | **Off on every installation until an administrator connects it**, and it answers nothing until an IT administrator mints a service key. 51 read tools; finance totals, medical-screening _status_ and the full duty schedule are behind three per-department switches, all off by default; three write tools behind a read/write switch, also off. Tools a department has not switched on are **not listed to the client**. **One redaction boundary** (`app/mcp/redaction.py`) strips contact details, DOB, emergency contacts, photo, membership and certification numbers, login names, medical results and credentials at every depth, and scrubs every string value of emails and phone numbers so free text cannot carry them out. Stateless JSON transport — any worker answers any request, no reverse-proxy change. **Known limitation:** claude.ai custom connectors need OAuth 2.1 and The Logbook is an OAuth client, not an authorization server, so those clients use a local bridge                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Email: Gmail and Microsoft 365 actually send**                  | #2196, #2214                                             | Settings → Email; the onboarding email step                                                                                                                                                                                                                                       | `app/utils/email_providers.py` presets; `app/utils/microsoft_oauth.py`; `POST /organization/settings/email/test`; migration `e3a9c1d5b7f2`                                                                                                                                                                                           | Both platforms stored credentials under `google_*`/`microsoft_*` keys while `_get_smtp_config` read only `smtp_*`, so the sender resolved **no host at all** and every message failed — in preference to a working global `SMTP_*` configuration, because the org section wins when `enabled` is true. Host, port, encryption and login are now fixed by a preset resolved by **both** the sender and the connection test. **Microsoft 365 gains an Entra ID app-registration (OAuth) path** because Exchange Online is retiring Basic auth for SMTP submission; `microsoft_auth_method` is absent on every existing row and absent reads as `app_password`, so nothing changes for a working configuration. The decorative Gmail/Microsoft OAuth client-credential fields are **removed**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Inventory Administration**                                      | #2214, #2222, #2226                                      | `/inventory/admin` hub; **`/inventory/admin/store`** (moved, `/store/admin` redirects)                                                                                                                                                                                            | `GET /inventory/summary` gains `items_by_type` and `non_medical_items`, both additive and defaulted; `GET /store/orders` gains `exclude_cancelled`; `GET /inventory/members-summary` gains `userId`                                                                                                                                  | The area had **four different names**; it is **Inventory** throughout now, administered from **Inventory Admin**. Screens genuinely about gear keep the quartermaster's vocabulary — My Issued Gear, Gear Requests, Gear Kits. **Labels only: no route, permission key, module key or API value changed.** The hub opens on the three supply lines a department staffs, including **EMS Supplies**, which it previously did not link to at all despite sharing one catalog partitioned by `item_type`. The store console moved inside the hub and stopped being the one administration page outside the shared frame. Cards now carry the gate of the route they target — `checkPermission` is exact match plus module wildcard, so `inventory.manage` implies neither `inventory.view_medical` nor `inventory.check_*`, which is why the seeded Quartermaster was being shown two consoles that refused them                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Gear requests browse instead of guessing**                      | #2270, #2278, #2287, #2290, #2292                        | Gear request form; fulfil picker; request review                                                                                                                                                                                                                                  | `equipment_requests.requested_size` (`a1c7e93b2d54`); server-side eligibility filtering and size verdicts                                                                                                                                                                                                                            | The form now **loads the catalog and offers real category names**, searches category and product-group names as well as the item's own, and shows **one row per product** rather than one per stocked size. The size step **preselects from the member's own recorded sizes**, matched through the same alias table the impact planner uses. **You can now ask for gear that is out of stock or not carried at all** — the one need a quartermaster had no other way to learn about; the size travels as its own field so a request with no matching catalog row still says what was wanted. Rank- and position-restricted gear is filtered **by the server**, not by the browser after the fact — the old form disclosed the item's existence to everyone and let the member submit a request the API then refused                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Inventory items page: the location panel agrees with its list** | #2296                                                    | `/inventory/admin/items` and its location cards                                                                                                                                                                                                                                   | `GET /items` gains `unassigned_location`; the header reads the `non_medical_items` added by #2214                                                                                                                                                                                                                                    | **Five of the nine filters did nothing** — location, size, colour, style and the vendor scope were absent from the reload effect's dependencies, so picking one changed the request the page _would_ send and never sent it; the list then updated on an unrelated reload, applying a filter nobody had just touched. That is what made the location cards impossible to reconcile. Three counting mismatches went with it: the cards **counted medical stock the list excludes** (a header of "82 items" over a list of 6), the **"Unassigned" card sent the empty string** — which is _All Locations_, so it cleared the filter it appeared to apply — and the header summed quantities across every domain over a list that counts rows and excludes medical                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Gear requests: fulfilment resolves to the variant**             | #2298                                                    | Fulfil picker                                                                                                                                                                                                                                                                     | `_product_key` / `_variant_key` / `_variant_identity`, consumed by both the grouping and the fulfilment narrowing                                                                                                                                                                                                                    | Follow-up to the request-form rebuild above, and a direct consequence of it. The catalog collapses rows sharing a product and size/colour/style into one line and **sums their availability** — that is what turns ten serialized radios into "7 available". The request then stored a single `item_id` out of that line and fulfilment narrowed to that one row, so a member could ask for ten against a line advertising ten and leave the quartermaster looking at the row holding one. Fulfilment now offers the variant's sibling rows, so the options match the availability the member was shown; a different size, colour, style, product or organization stays excluded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Inventory: retiring is the only way to deactivate an item**     | #2301                                                    | Item edit; the retire action; medical supplies                                                                                                                                                                                                                                    | A new retire action under the medical-supplies permission; detail pages read lot-derived stock; the category-picker cap raised                                                                                                                                                                                                       | **A plain edit could take an item out of active inventory while a member still held it.** The dedicated retire action blocks deactivation on an assigned, checked-out or unreturned item and keeps the other fields consistent; the general update path had none of that, so setting an item inactive — directly, or by setting status and condition to retired — removed it from every active list and picker with no safeguards, and left it handable-out again immediately. **Editing no longer accepts either route**; retire is the only path, and it re-checks the holder immediately before deactivating, closing the window where a member could be assigned the item an instant earlier. Three knock-ons: a medical-supplies manager without broader inventory access **lost the ability to retire a medical item** (closing the gap removed their only path), an item's **detail page showed stale stock** for lot-tracked consumables where the list view already computed from dated lots, and a low internal cap silently **hid categories past it from every picker** on a department with a large category list                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Grants & fundraising: pagination moves to the database**        | #2251                                                    | Every grants/fundraising list                                                                                                                                                                                                                                                     | —                                                                                                                                                                                                                                                                                                                                    | Eleven list endpoints (opportunities, applications, budget items, expenditures, compliance tasks, notes, campaigns, donors, donations, pledges, fundraising events) fetched an org's **entire** matching table before selecting the requested page in application memory — so a department with years of donation or grant history scanned and loaded all of it on every page view. `skip`/`limit` now apply in the SQL. **No response shape or ordering changed** within the documented row limits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Compliance Matrix becomes a queue**                             | #2247, #2251                                             | Training → Compliance Matrix                                                                                                                                                                                                                                                      | `GET /training/compliance-matrix` gains per-cell progress, per-requirement meta and a top-level `as_of` — **additive only**; `evaluate_member_requirement_detail()`                                                                                                                                                                  | The member × requirement icon grid is replaced by a **triage rail**: grouped by standing, worst first, with the numbers behind each status on the row ("6 of 24 hours", "Lapsed 41 days ago"). The dashboard's non-compliant link has been passing `?status=noncompliant` all along and the grid ignored it. **A member exempt from a requirement could never reach 100%** — the denominator counted every active requirement while the numerator counted only applicable ones. **A certification expiring soon read as a failure**, so a member holding a card valid for another 26 days rendered under "Compliant" reading "1 of 2 met · 1 open item". Actions are limited to ones with something behind them; the mock's Notify and Assign buttons had no endpoint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Empty states stop instructing members who cannot act**          | #2265, #2268, #2271, #2273, #2280, #2293                 | Documents, Members roster, Events, Training Programs, Course Library                                                                                                                                                                                                              | Component-level gating, not route-level                                                                                                                                                                                                                                                                                              | Five screens told **every** member to upload a file / add a member / create an event / create a pipeline, with the buttons beside them already officer-only — an instruction with nothing behind it, and in three cases a link to the access-denied page. Now shown only to somebody who can act. **An empty result that follows from a search or a filter is still reported to everyone** — that is feedback on what they asked for. Three dialogs (upload, new-folder, delete) also **outlived the permission that opened them**, leaving their actions on screen after the grant went away. Course Library's gate is on the component, not the route, because the same page is mounted inside the training admin hub where the officer does hold the grant                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Roster lock and past-shift controls**                           | #2245, #2255                                             | Shift board; shift detail panel; assignment actions                                                                                                                                                                                                                               | `shifts.late_signup_until` (`c9f2a4b71d38`); `rosterLocked`; resolved cushion reported on `GET /scheduling/settings`                                                                                                                                                                                                                 | **"Reopen for 15 min" was offered on a shift three weeks gone, and it worked** — a member could sign themselves onto a shift they never worked and draw hours for it. Confirm, decline, remove and withdraw outlived the shift too, beside the hours they would have deleted. **The lock is now enforced, not just displayed**: all four paths carry the same end-plus-grace bound, with the same `scheduling.manage` exemption. **A shift with no end time was exempt entirely** — it is now treated as running twelve hours past its start, floored at the department's `checkin_closes_hours_after`, so the roster lock and check-in cannot disagree about one shift. Unknown settings now mean **unlocked**, because a permissive default is right for a claim button and wrong for a lock                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Departments name their own call types**                         | #2273, #2281, #2288                                      | Administration → Scheduling Admin → General → Call types                                                                                                                                                                                                                          | `organizations.settings` call types; `ShiftCompletionReport.data_sources["call_types"]`; migrations `a3d7e2f18c45`, `c9f4a2b71d38`, `d7c1b95e2a40`                                                                                                                                                                                   | The nine types have been per-department data since call tracking shipped and **nothing in the UI could reach them**. **Retiring, not deleting**, is the default for a type with history: the stored value on every filed call is the permanent slug. Reports, CSV exports, badges, the printable report and the summary email now use the department's own names, retired types included. **A department that had named a type `unclassified` could neither report on it nor repair it** — that slug is the synthetic bucket for an untyped call, so its calls merged into "Not categorised" and the settings editor could not even mention it. **A report written under per-incident tracking keeps the officer's own wording** and is never relabelled by a rename                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Events: attendees, RSVP and waitlist**                          | #2142, #2148, #2149                                      | Event detail; dashboard inline RSVP                                                                                                                                                                                                                                               | `events.attendee_visibility` per-event override (`c3a71e5d9b48`), NULL = inherit org default                                                                                                                                                                                                                                         | The going list is now shareable with members — **names and going status only**, never contact details, notes, dietary or accessibility needs, guest counts or check-in times. **The default ships as managers-only**, so nothing changes until a department opts in. `requires_rsvp` now means "a response is expected", not "responses are permitted" — the API previously refused outright, leaving members nothing to do on most events. **Guests occupy seats**: `allow_guests` had been on the model since the beginning and was read nowhere, and capacity counted going _rows_. **A capped event will fill sooner than it used to** — that is the correction; events already over the seat count are left alone rather than retroactively waitlisted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Calendar dates stop shifting west of UTC**                      | #2179                                                    | Every date-only field: hire dates, expiries, due dates, leave dates                                                                                                                                                                                                               | `dateFormatting.ts` — a bare `YYYY-MM-DD` is recognised as a calendar date and pinned to UTC at parse and format                                                                                                                                                                                                                     | A hire date of 2020-12-06 printed "12/5/2020" in New York. A `DATE` column has no time and no timezone — it is a square on a calendar, the same square for everyone — but it was parsed as UTC midnight and rendered in the viewer's zone. **The same shift named the wrong weekday**, which on anything schedule-shaped is worse than a wrong number, and **"days remaining" counts were one short** in the direction that makes a renewal look less urgent. A value carrying a time is still an instant and still converts, and both directions are asserted so neither half can be restored by breaking the other                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Notification paging and the Send Log**                          | #2286, #2289                                             | Notification inbox; Send Log tab                                                                                                                                                                                                                                                  | `notification_logs.sent_at` **NOT NULL** + keyset index (`c8f4a1e6b309`); `cursor`/`next_cursor` on `GET /notifications/logs` and `/notifications/my`                                                                                                                                                                                | **"Load more" could step over a notification entirely** — offset paging over a newest-first list re-serves one row and skips another whenever something arrives mid-page. A department-wide fan-out is the **worst case, not an edge case**: `sent_at` is stored to the second, so every recipient shares one timestamp, hence a `(sent_at, id)` key. Separately, **the Send Log listed every notification the department had sent anyone** — subject, body and recipient address — to anyone who could open it. It now defaults to the caller's own deliveries and is offered to every member as their own data; the org-wide view survives as an explicit `scope=organization` requiring `notifications.manage`. **API note:** `read-all` previously always swept the whole organization and now defaults to the caller                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Quick Add on the phone bottom bar**                             | #2157                                                    | Phone bottom navigation                                                                                                                                                                                                                                                           | `navGateIntegrity.test.ts` resolves every row against the real route definition                                                                                                                                                                                                                                                      | The centre of the bar is an Add button opening a short list of the things a member actually logs. Before this, every one was four taps and two page loads before the first field. **Quick Add adds no forms of its own** — each row goes to the screen that already owns that entry, so there is no second path for the same data to drift down. **Rows appear only where the page behind them would actually open**: a row gated more widely than its route is a link to Access Denied placed there by the app itself. The bar keeps five items and the configurable slots go from three to two; a saved layout keeps its first two and is left intact on disk                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Member roster becomes a directory**                             | #2139, #2178                                             | `/members`; member profile                                                                                                                                                                                                                                                        | `users.profile_visibility` (`a8c4d1e2f3b5`), NULL resolves to `PROFILE_VISIBILITY_DEFAULTS`; `GET /users` now populates `platoon`                                                                                                                                                                                                    | `/members` carries no permission gate — it is the department directory — but it rendered the coordinator's working screen to everyone: usernames, a hire-date column, a per-row Actions column, bulk selection, CSV export, titled "Membership Management". It is **"Member Directory"** for everyone without `members.manage`. **This is a change to what the page shows, not what the server sends** — the endpoint still returns usernames and hire dates to any `members.view` holder, so it declutters, it is not a confidentiality boundary (flagged as USR-8). Separately, each member can now choose per field what colleagues see. **`GET /users` declared `platoon` and never populated it**, so the Platoon Roster Panel rendered every member as unassigned                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Elections: eligibility and duplicate-vote hardening**           | #2162, #2173 and the ELEC pass-3 series                  | Ballot links, full-ballot submission, paper-ballot batches                                                                                                                                                                                                                        | `docs/security-review/ELEC-06-elections-ballots.md` (ELEC-13 … ELEC-39)                                                                                                                                                                                                                                                              | Ten findings, most of one shape: **a name collision between a plain position and a ballot item let a token vote on a contest it was never granted**, and the two submission routes computed different internal fingerprints for the same vote so the database's own duplicate safety net could not recognise them as one. Also: a member moved onto a department's own **custom membership tier** kept voting rights a restricted ballot meant to exclude — caused by an unrelated, correct scheduling fix that started preserving class/status across a tier switch. Paper-ballot attestation, voiding and election deletion locked in inconsistent orders and could deadlock                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Security monitoring, MFA and session hijack**                   | #2128, #2132, #2133                                      | —                                                                                                                                                                                                                                                                                 | `SecurityMonitoringService`; `user.mfa_last_timestep`                                                                                                                                                                                                                                                                                | Eight successive findings on the same subsystem, each one a gap in the previous fix — worth reading as a sequence rather than a list. A TOTP code verified at an MFA **management** route was never recorded as consumed and could replay at login. The fix for that had a **concurrency race** that let one code complete two independent logins; so did the recovery-code check one field over. The session-hijack detector **silenced itself after firing once** because its own fix promoted the attacker's IP to trusted; the fix for _that_ left the timestamp unrefreshed, so continuous attack traffic eventually earned the "probably roaming" leniency. Two of four in-memory trackers were **never capped for SSO-only organizations**, and eviction was `O(n log n)` per request once at cap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Documents: folder ACLs, pagination and audit**                  | #2160, #2164, #2166, #2170, #2171 and the FAC/DOC series | Documents page; facility Files                                                                                                                                                                                                                                                    | `document_folders.required_permissions`; `e6f2a7c9d148`, `a8e4c1f7b930`; `GET /documents/folders` gains `skip`/`limit`                                                                                                                                                                                                               | Folder authorization is now **hierarchical** — a restriction can live on an ancestor, so pagination is applied after the ancestor-aware ACL filter rather than to a flat per-folder check. `documents.manage` could bypass a folder's ACL on create, reparent, move destination and the folder-mutation routes; a folder delete could cascade-destroy a **more-restricted descendant** the caller could never access directly, or an entire system tree such as every member's files. A folder listing issued **one `SELECT COUNT(*)` per folder**. Folder create/rename/delete and document metadata edits now leave an audit trail. **`e6f2a7c9d148` clears a facilities ACL copy-pasted onto apparatus sub-folders**, which had locked an apparatus officer out of a truck's own manuals                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **`text-right` on a table header did nothing**                    | #2258                                                    | 108 headers across 37 files                                                                                                                                                                                                                                                       | `styles/index.css`; `styles/tableHeaderAlignment.test.ts`                                                                                                                                                                                                                                                                            | `thead th { text-align: left }` was declared **outside any cascade layer**, and unlayered CSS outranks every layer — so the `text-right` Tailwind emits into `@layer utilities` was discarded on every one of them. The heading sat hard left while its figures sat at the far right of the column. **Only `text-align` moved** into `@layer base`; the other five declarations stay unlayered on purpose. Verified by measurement, not by reading the diff. jsdom compiles no Tailwind and applies no cascade, so no render test could ever have caught this                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Administration breadcrumbs**                                    | #2276, #2280, #2282, #2284                               | Every administration hub and the pages beneath it                                                                                                                                                                                                                                 | `Breadcrumbs`                                                                                                                                                                                                                                                                                                                        | Nothing under `/scheduling/admin` had one: sub-pages offered a single unlabelled back arrow whose destination was only in its `aria-label`. **A crumb no longer offers a page it cannot open** — a generated trail is built from URL prefixes, and a prefix is often not a route at all or one the viewer lacks the grant for; both used to render as working links. On a hub the trail **stops at the parent** rather than repeating the heading the page already states twice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Security review rotation — pass 3**                             | #2085–#2182 and the pass-3 series, through #2301–#2306   | Every module                                                                                                                                                                                                                                                                      | `docs/security-review/*.md`, `PROGRESS.md`                                                                                                                                                                                                                                                                                           | The rotation completed its third pass over the core features in this window. Findings and disposition are per-feature in [`docs/security-review/`](./security-review/); the user-visible half is in `CHANGELOG.md` under the 2026-08-31 → 2026-09-06 dates. **Four late findings worth naming.** Medical supplies (#2301): a plain item edit could deactivate equipment a member still held — see the Inventory row above. Meetings & minutes (#2303, MM-14): a meeting attendance waiver's member and grantor **name lookup carried no organization filter**, relying entirely on those ids having come from an org-scoped write elsewhere. True today, but the first write path to skip that validation would have returned another organization's member's name. Both lookups now filter directly, matching the convention used everywhere else in the feature — a Pitfall #14 hardening with no user-visible change. Messaging (#2305): **a member could register an unlimited number of push devices**, and every later notification fanned out to all of them — capped at 20 per member, with refreshes unaffected. The same PR escaped an email subtitle that no current sender passes anything but static text through, and landed the user-facing half of `revoked_at` (see Added columns): **narrowing a published message's audience no longer erases who had already read or acknowledged it** — the receipt is marked inactive rather than deleted, so an acknowledgment report stays accurate while access is still withdrawn. Forms (#2306, FORM-10): a public form set to **one submission per person** could take two from the same member if they arrived together — a double-click, or two tabs. The check locked the form row and then counted with a plain `SELECT`, which under REPEATABLE READ answers from the snapshot taken at the transaction's first read, so the lock never refreshed what the check could see (Pitfall #27, the same shape as FAC-45 and MSG-13). The count is now a locking read. **Flagged, not fixed:** the authenticated (in-app) submit path enforces no such limit at all — every pass has scoped the setting to public submissions, so this is a standing product-scope question, now recorded in `KNOWN_LIMITATIONS.md`. **A second gap found while documenting this, not part of #2306:** `allow_multiple_submissions` has no writer in the frontend at all. `FormBuilder.tsx` exposes no control for it, the column defaults to `True`, and the only frontend reader is `PublicFormPage.tsx`, which consults it to decide whether to offer _Submit Another Response_ — so the enforcement #2306 hardened cannot currently be switched on from inside the application by any department. This is Pitfall #19 inverted: a reader with no switch, rather than a switch with no reader |

### Retired URLs

**None of these fourteen redirects.** Thirteen are retired paths: a bookmark or
an emailed link lands on the dashboard, and the catch-all redirect makes that
silent. The fourteenth, `/scheduling?tab=equipment-checks`, is the odd one —
`/scheduling` still resolves, so the removed tab value is ignored and the page
opens on **Schedule** rather than on the dashboard. It is listed here because
the member still fails to reach their checklists, not because the path retired.

`/store/admin` is a genuine redirect (to `/inventory/admin/store`) and is
deliberately **not** in these tables.

#### Equipment checklists (Scheduling → Inventory)

| Was                                       | Is now                                      |
| ----------------------------------------- | ------------------------------------------- |
| `/scheduling/equipment-check-templates/…` | `/inventory/admin/checklists/templates/…`   |
| `/scheduling/equipment-check-reports`     | `/inventory/admin/checklists/reports`       |
| `/scheduling/supply/expiring`             | `/inventory/admin/checklists/supply`        |
| `/scheduling/equipment`                   | `/inventory/checklists`                     |
| `/scheduling/equipment/checks`            | `/inventory/checklists/log`                 |
| `/scheduling/equipment/{id}`              | `/inventory/checklists/apparatus/{id}`      |
| `/scheduling/apparatus-inventory`         | `/inventory/checklists/apparatus-inventory` |
| `/scheduling?tab=equipment-checks`        | `/inventory/checklists/my`                  |

**End-of-shift reminder notifications already sitting in members' bells carry
the old address** and will land on the dashboard. New ones point at the right
place, and these reminders age out within a few days.

#### Scheduling administration

| Was                          | Is now                                                           |
| ---------------------------- | ---------------------------------------------------------------- |
| `/scheduling/settings`       | `/scheduling/admin/settings/general` (and five sibling sections) |
| `/scheduling/templates`      | `/scheduling/admin/planning/templates`                           |
| `/scheduling/patterns`       | `/scheduling/admin/planning/patterns`                            |
| `/scheduling/reports`        | `/scheduling/admin/reports`                                      |
| `/scheduling/platoons`       | `/scheduling/admin/platoons`                                     |
| `/scheduling/qualifications` | `/scheduling/admin/positions`                                    |

`/scheduling/admin/settings?tab=…` **does** resolve — `SchedulingSettingsRedirect`
forwards it to the section its parameter names, and an unknown or absent one to
General. Templates and patterns passed through `/scheduling/admin/templates`
and `/scheduling/admin/patterns` mid-window; **those two intermediate URLs never
shipped in a release**, so nothing outside the repository can be pointing at
them.

#### Redirected, not retired

| Was            | Is now                   |                   |
| -------------- | ------------------------ | ----------------- |
| `/store/admin` | `/inventory/admin/store` | redirect in place |

### Alembic route (upgrade data path)

**Thirty-four new revisions. Head is `d7c1b95e2a40`**
(`20260905_2200_d7c1b95e2a40_narrow_call_type_provenance_to_slugs.py`). The
chain validates to a single head:

```
$ cd backend && python scripts/validate_migrations.py
Head revisions: 1
  head -> d7c1b95e2a40  (20260905_2200_d7c1b95e2a40_narrow_call_type_provenance_to_slugs.py)
VALIDATION PASSED
```

**Exactly one of the thirty-four is a merge revision** (`a1d7f3c05e64`,
rejoining the messaging/inventory line with main's event-attendee-visibility
revision). Last window recorded seven forks in seven days and opened
[MIG-1](./KNOWN_LIMITATIONS.md) for it; one fork in a window carrying 203 PRs
is a marked improvement, though nothing structural changed to cause it —
`validate_migrations.py` still cannot see a competing revision until both have
merged.

#### Reversibility

**Eleven migrations do not restore the prior state on downgrade**, and each
says so in its own docstring. None of them destroys data on the way down —
unlike last window's `a7c93f21d5b8`, there is no export-first warning in this
set. They fall into three groups.

**Irreversible because the old shape held nothing worth restoring:**

| Revision       | What it does                                                                      | Why the downgrade cannot restore                                                                                                                                                                      |
| -------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `4e7e125cb00f` | Drops `scheduling_module_configs.equipment_check_settings`                        | The downgrade restores the column but not the four switches' values — and every one of them was read by no code at all, so the restored values would mean exactly as much as they did before: nothing |
| `f7a1c3b5d9e2` | Unwraps crew seats whose name is itself a seat object                             | The wrapper carried no information of its own, so unwrapping restores the seat exactly. There is nothing to put back                                                                                  |
| `e3a9c1d5b7f2` | Prunes retired Gmail/Microsoft OAuth keys; settles pre-validation platform labels | The pruned keys held OAuth secrets **nothing ever read** — no refresh token was obtained or stored, and no XOAUTH2 or Graph send path existed                                                         |

**Data repairs whose downgrade would re-break what they fixed:**

| Revision                       | What it does                                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `d5e1f6a8b037`                 | Closes approval chains left with actionable steps after a denial — rows that let a refused purchase request be approved and charged |
| `bbdaca0844df`                 | Clears stale `due_date` on requirements switched away from `fixed_date`                                                             |
| `9d2b4492faba`                 | Removes skills-testing viewer grants naming a test's own examiner (a no-op grant the officer could not tell had done nothing)       |
| `e8a1c04f6b27`                 | Applies the three repairs the pre-rename `positions` migrations could not                                                           |
| `a3d7e2f18c45`, `d7c1b95e2a40` | Set, then narrow, the `org_calls` provenance marker on shift reports                                                                |
| `c9f4a2b71d38`                 | Renames a department's call type squatting the reserved `unclassified` slug, and moves the calls and reports pointing at it         |

**Permission repairs**, where a downgrade would restore grants that were
removed precisely because they should not be held —
`f7b3c8d2e569` and the wizard/EMT series below.

**Migrations that deliberately backfill nothing**, where an empty result is
correct rather than a failure: `shifts.template_id` (no column on an existing
shift could identify its originating template, and NULL falls back to today's
apparatus-based resolution), `shift_template_equipment_checks` (presence is
meaningful — a template with no rows behaves exactly as it does today),
`events.attendee_visibility` (NULL is a real third state meaning "inherit the
org default", which ships as managers-only), `users.profile_visibility` (NULL
resolves to defaults reproducing pre-migration behaviour),
`item_issuances.lot_allocations` (NULL means the issuance came out of the
column ledger), and `meeting_action_items.created_by`/`source` (NULL means
"entered by a person").

### New data model

#### `mcp_service_keys` — the credential behind the Claude MCP add-on

One active key per organization. **SHA-256 digest only** — the plaintext is
never stored and is shown in the UI exactly once. Carries a display prefix, an
optional expiry or lifetime, and revocation/creation audit columns; rotation
revokes the previous key. Issuing and revoking require the new
`integrations.mcp_keys` permission, which only the IT Manager position holds by
default. Reversible: the downgrade drops the table, and any MCP client
configured with a key stops authenticating, which is the correct consequence of
removing the feature.

#### `shift_template_equipment_checks` — a template names its checklists

Deliberately thin: the two sides, the org, and an order. Timing
(start/end of shift) and position eligibility stay on
`equipment_check_templates`, where they are edited and where every other reader
already looks. **Presence is meaningful, and that is the whole design** — a
template with no rows keeps resolving by apparatus id and then apparatus type,
exactly as every shift does today.

#### Added columns

| Column                                       | Revision       | Note                                                                                       |
| -------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------ |
| `shifts.template_id`                         | `fab0ab7897d3` | No backfill is possible — nothing on an existing shift identifies its originating template |
| `shifts.late_signup_until`                   | `c9f2a4b71d38` | Now clamped to the roster deadline as well as gated by it                                  |
| `events.attendee_visibility`                 | `c3a71e5d9b48` | NULL = inherit the org default                                                             |
| `users.profile_visibility`                   | `a8c4d1e2f3b5` | JSON of five booleans, written only as a whole by `PUT /users/me/profile-visibility`       |
| `item_issuances.lot_allocations`             | `c3d0e5f7a924` | Records which lots an issuance drew from, so a return puts units back where they came from |
| `equipment_requests.requested_size`          | `a1c7e93b2d54` | The only record of what was wanted when `item_id` is NULL                                  |
| `department_message_recipients.revoked_at`   | `b2c9d4e6f813` | Splits the read receipt from the access the row grants                                     |
| `department_message_recipients.created_at`   | `e93b6a4d21c7` | "Was this member in the audience when the notice went out, or added afterwards?"           |
| `meeting_action_items.created_by`, `.source` | `7bfe85f2e4e5` | Distinguishes an item created through the MCP connection                                   |
| `notification_logs.sent_at` → NOT NULL       | `c8f4a1e6b309` | Plus the keyset index behind the cursor query                                              |

### Permission and grant movements

**This is the section to read before upgrading a live department.** Eleven
migrations move grants on seeded positions. They are not eleven independent
decisions — **nine of them trace to one root cause**, and it is worth
understanding before reading the table.

#### The root cause: the onboarding wizard overwrote the registry

The old onboarding position editor derived its checkbox defaults from a
heuristic — _"a member views every module whose category is not System"_,
_"a leader manages everything but settings"_ — that had no relationship to
what `DEFAULT_POSITIONS` actually seeds. **Its first Continue saved that
heuristic's output over the seeded rows wholesale**, and
`dependencies.py` unions every assigned position's stored permissions, so the
difference became live grants on every department that onboarded under that
code (CLAUDE.md pitfall #23).

That is why a rank-and-file member could open Administration → Reports: the
registry seeds `reports.view` to no rank-and-file position, but Reports is its
own module category, so the heuristic ticked it.

**Four migrations chased this before one worked.** `f7b3c8d2e569` and
`d1c7f4a92e63` rewrote only a row matching the heuristic's output _in full_ —
and four other migrations edit those same rows first, so a department that
onboarded before them was a permission or two off, its row was skipped, and
every discrepancy survived. `f3b8d0c26a17` removes and restores **one
permission at a time**, which does not depend on the rest of the row.

**Setting up a position now starts from the registry on either path**, so a
new department does not create the problem again.

#### The movements

| Revision                                            | Movement                                                                                                                                                                                                                                                                                                                                                                                                                      | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `c9a5e21f7b04`                                      | **Revokes** `reports.view` from the baseline member and firefighter positions                                                                                                                                                                                                                                                                                                                                                 | A leadership grant. It opens the report catalog, generation and every saved report — all of which **aggregate across the whole department** rather than scoping to the holder. Same argument that removed `compliance.view` last window                                                                                                                                                                                                                                                                                          |
| `f3b8d0c26a17`                                      | **Revokes** the wizard's over-grants **unconditionally** — `integrations.view`, `medical_supplies.view`, `mobile.view`, `prospective_members.view` from Member, Firefighter, Engineer and EMT, including their `.manage` and module-wildcard forms; Engineer additionally loses `positions.view`, `reports.view`, `settings.view`, and its `apparatus.*` is narrowed to the seeded `apparatus.view` + `apparatus.maintenance` | **The one to read twice.** The earlier attempts gated on a "wizard fingerprint" so a deliberate grant would survive — and that gate missed every department that had switched those modules off during setup, leaving the original problem in place for exactly the smaller departments least likely to notice. Nothing in a stored row distinguishes a grant the heuristic wrote from one an administrator chose, so the direction rule applies: **a grant that discloses other members' data is revoked wherever it is found** |
| `b6e4a0d17c93`                                      | **Revokes** `apparatus.view` from the seeded rank-and-file positions                                                                                                                                                                                                                                                                                                                                                          | The apparatus pages are a maintenance and compliance workspace — inspection expirations, out-of-service status, deficiency flags, driver qualifications. **The registry edit alone would revoke nothing:** `DEFAULT_POSITIONS["firefighter"]["permissions"]` _is_ the rank's list, the same object (pitfall #23)                                                                                                                                                                                                                 |
| `d5f2b8c04a19`                                      | **Revokes** `apparatus.view` from the membership positions `c3d4e5f6a7b8` deliberately kept                                                                                                                                                                                                                                                                                                                                   | Rows a department accumulated under the old role setup — Probationary, Junior, Life, Administrative, Social, Exempt as _positions_. Missed by the revision above                                                                                                                                                                                                                                                                                                                                                                 |
| `a2e9f6b04c71`                                      | **Revokes** the heuristic's over-grants from every seeded EMT row                                                                                                                                                                                                                                                                                                                                                             | Until the registry gained an `emt` entry, the wizard offered EMT to every agency type with nothing seeded behind it, so `save_session_roles` took its **create** branch and stored the checkbox expansion verbatim                                                                                                                                                                                                                                                                                                               |
| `b4d1c8e37f52`                                      | **Restores** four grants to EMT rows — `locations.view`, `meetings.view`, `organization.view`, `scheduling.swap`                                                                                                                                                                                                                                                                                                              | No checkbox in any version of the setup screen can produce these, so their **absence** is the mark of a row the screen built. A department that removed some of the four keeps that choice: none are put back                                                                                                                                                                                                                                                                                                                    |
| `c7a4e91d3b68`                                      | **Broadens** `b4d1c8e37f52`'s gate                                                                                                                                                                                                                                                                                                                                                                                            | The first attempt identified a row by comparing its **whole** permission list against a frozen snapshot — the strategy pitfall #23 bans by name, and it failed exactly as the pitfall says: the snapshot is pinned to one build's module list. Superseded rather than edited, because an installation that already stamped the narrow version would never execute a rewritten body                                                                                                                                               |
| `f7b3c8d2e569`, `d1c7f4a92e63`                      | **Restore** the registry's seeded grants on rows the wizard overwrote                                                                                                                                                                                                                                                                                                                                                         | Superseded in part by `f3b8d0c26a17`; retained because a department already past them would never execute a rewritten version                                                                                                                                                                                                                                                                                                                                                                                                    |
| `9d2b4492faba`                                      | **Removes** skills-testing viewer grants naming a test's own examiner                                                                                                                                                                                                                                                                                                                                                         | The examiner already holds full disclosure on their own scoring, so the grant was a no-op the officer could not tell had done nothing                                                                                                                                                                                                                                                                                                                                                                                            |
| `e8a1c04f6b27`                                      | **Grants** `inventory.check_submit` to the default Member position (among three repairs)                                                                                                                                                                                                                                                                                                                                      | One of the three repairs that silently never ran — those members had **lost the checklist on upgrade**                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `ff8076f4987a` _(2026-08-30, in force this window)_ | **Renames** `equipment_check.*` → `inventory.check_*`                                                                                                                                                                                                                                                                                                                                                                         | Every position keeps exactly the authority it had. **Consequence:** a position holding `inventory.*` now also grants the three checklist permissions                                                                                                                                                                                                                                                                                                                                                                             |

**Restores are gated; revocations are not.** That asymmetry is deliberate and
follows the rule in CLAUDE.md pitfall #23: an unconditional _add_ would
override a department that removed a grant on purpose, and a missing benign
grant discloses nothing — whereas leaving a disclosing grant in place on an
unrecognized row keeps the disclosure open.

**What an administrator has to do about it.** Nothing **revoked** by these six
steps is granted back automatically — two separate steps do add grants, covered
above. Specifically:

- **A department that deliberately gave its members Reports must grant
  `reports.view` again** on the positions screen. A position the department
  created itself is not touched at all.
- **Line members can no longer open the Apparatus pages.** Officers, chiefs,
  administrators and the **Engineer** rank keep `apparatus.view` — Engineer is
  the driver/operator and holds `apparatus.maintenance` beside it. A
  department that wants members to see the fleet re-adds the grant to its
  Member position. The lightweight `/apparatus-basic` page, shown when the
  Apparatus module is off, is unaffected and stays open to everyone.
- **Check any custom position holding `inventory.*`** — it now authors and
  submits equipment checklists. Replace the wildcard with specific
  `inventory.` grants if that is wider than intended.
- **A training officer holding neither scheduling grant can no longer open the
  position roster** at `/scheduling/admin/positions`, and neither can the API
  behind it.

### Known limitations opened this window

Recorded in [`KNOWN_LIMITATIONS.md`](./KNOWN_LIMITATIONS.md).

#### MCP-1 — claude.ai custom connectors need a local bridge

claude.ai custom connectors authenticate with OAuth 2.1. The Logbook is an
OAuth **client**, not an authorization server, so those clients cannot present
a service key directly and use a local bridge for now. Claude Code and the
Messages API connector reach `/api/mcp` without one.

#### USR-8 — the member directory's reduced view is not an access boundary

The reduced "Member Directory" for non-managers withholds username, hire date
and the bulk actions **in the UI**. `GET /users` still returns the full field
set to any `members.view` holder. Not a cross-tenant leak, and not a
straightforward fix: 25+ other call sites depend on the current unfiltered
response.

#### FAC-13 — baseline facility categories are stamped as sensitive

An unrelated folder-ACL fix started enforcing a permission stamp that was
present but previously inert, so **every** facility folder — including the
baseline Photos, Maintenance Records and Inspection Reports categories — now
carries the same permission set as Insurance & Leases and Capital Projects. A
secretary, safety officer or training officer gets an empty list from
`GET /{facility_id}/folders` and is refused those categories through the
generic Documents module. **Fail-closed, not a leak**, and the Facilities
module's own Files section is unaffected (it does not call that endpoint).
Correcting it needs a new permission tier, an owner call on Blueprints &
Permits, a reclassification and a migration.

#### MS-7 — a screening record can be self-created and self-cleared

Nothing stops a `medical_screening.manage` holder from logging their own
screening as `passed`, with no reviewer distinct from the subject.

#### Two compliance fields that have never done anything

"Grace Period (days past expiration)" and "Applies to Roles" on a screening
requirement are stored and shown, and `get_compliance_status` reads neither.
Both now **say so on the form** — the sanctioned second option under pitfall
#19. Wiring `grace_period_days` is deferred because it defaults to 30 on every
requirement already on file, so switching it on would relax non-compliance
flagging installation-wide rather than only for departments that opted in.

#### Carried forward, unchanged

- **The equipment-check lap is still not wired.** The four canonical item types
  and the lap UI are built and tested; the live check screen still renders the
  previous flat compartment list. **The new crew Sweep experience shipped this
  window is behind a prop and is not switched on for crews** — the template
  builder's preview shows it so departments can see it against their own
  templates first. Do not narrate either as the current member experience.
- **QUAL-1** — qualifications are written only through a course's **Certifies**
  field, never entered directly.
- **CMP2-1** — the compliance non-compliance notification is stored and inert,
  with the panel labelled "not yet active".

### Documentation and media disposition

#### Screenshots

Full per-image queue in
[`training/SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md);
coverage counts are regenerated into
[`training/SCREENSHOT_STATUS.md`](./training/SCREENSHOT_STATUS.md) by
`scripts/screenshots/status_report.py`.

**Three changes invalidate captures in bulk rather than individually:**

1. **Every navigation capture.** Two modules changed address and one changed
   name. The sidebar now carries **My Checklists** and **Fleet Readiness**
   under Operations, an **Inventory Admin** entry that used to read "Gear
   Admin", and a **Scheduling** row inside the Administration section. The
   phone bottom bar has an **Add button in the middle** and two configurable
   slots rather than three. A capture of any of these is wrong, not stale.

2. **Every table with a right-aligned column**, in 37 files. Headings that sat
   hard left over right-aligned figures now sit over their own columns. Worst
   affected: the scheduling reports (19 headers), the compliance officer
   dashboard (13), and the finance, grants and inventory tables. This is
   subtle enough that a reviewer will not notice a stale capture — re-shoot
   from the list in `styles/tableHeaderAlignment.test.ts`.

3. **Anything showing a rank-and-file member's navigation or the Apparatus
   pages.** `reports.view` and `apparatus.view` were revoked from the
   rank-and-file, so the Administration section and the Apparatus entry are
   gone for a member account. **Caption the capturing account's grants** on
   any re-shoot.

| Image area                                                                    | Disposition                   | Why                                                                                                                                                                          |
| ----------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`/inventory/admin/checklists`** and its four children                       | **NEW**                       | The checklist console has never been captured at its own address                                                                                                             |
| **`/inventory/checklists`** (Fleet Readiness)                                 | **NEW**                       | New crew-facing address                                                                                                                                                      |
| **`/inventory/checklists/my`** (My Checklists)                                | **NEW**                       | Replaces the Equipment Checks tab, which no longer exists                                                                                                                    |
| **`/scheduling/admin`** hub                                                   | **NEW**                       | New hub with metrics row and Needs attention queue                                                                                                                           |
| **`/scheduling/admin/planning`** — staffing gaps                              | **NEW**                       | The screen the window was built around                                                                                                                                       |
| **`/scheduling/admin/settings/general`** → Call types editor                  | **NEW**                       | Departments can name their own call types for the first time                                                                                                                 |
| **`/inventory/admin/store`** on the shared admin frame                        | **NEW**                       | The store console gained the header, metrics row and attention queue                                                                                                         |
| Integrations → **Claude (MCP)** connect form                                  | **NEW**                       | Shoot with the three data switches visibly **off** — that is the default and the point                                                                                       |
| Integrations → **Claude (MCP)** service-key panel                             | **NEW**                       | The plaintext-shown-once state; redact the key in the capture                                                                                                                |
| Settings → **Email** with Microsoft 365 **App registration (OAuth)** selected | **NEW**                       | New auth path; the App Password option and its dated retirement notice should be visible in the same frame                                                                   |
| Settings → **Email** Test Connection result                                   | **NEW**                       | New control                                                                                                                                                                  |
| **`/scheduling/admin/positions`**                                             | **NEW**                       | Renamed from `/scheduling/qualifications`                                                                                                                                    |
| Shift template → **equipment checklists** picker                              | **NEW**                       | New control under the vehicle picker                                                                                                                                         |
| Member profile → **profile visibility** controls                              | **NEW**                       | New per-field member choice                                                                                                                                                  |
| Event detail → **who's going** list and waitlist position                     | **NEW**                       | Shoot the member view, not the organizer view; the point is what a member can now see                                                                                        |
| Phone bottom bar → **Quick Add** sheet                                        | **NEW**                       | Shoot on a 390px viewport                                                                                                                                                    |
| **Shift Details** dialog                                                      | **REPLACE**                   | Was a right-edge drawer, is now a centred modal — 56rem on a laptop, 1rem-inset on a phone. Shoot both widths                                                                |
| **Compliance Matrix**                                                         | **REPLACE**                   | The icon grid is gone; it is a triage rail grouped by standing                                                                                                               |
| **`/members`** as a member (not a coordinator)                                | **REPLACE**                   | Now "Member Directory" — no usernames, no hire date, no Actions column, no bulk selection                                                                                    |
| **Gear request form**                                                         | **REPLACE**                   | Browses the catalog, one row per product, with a size step                                                                                                                   |
| **`/inventory/my-equipment`**                                                 | **REPLACE**                   | "Permanent Assignments" and "Issued Items" are one **Issued to Me** list; four tiles collapse to three                                                                       |
| **Dashboard** — timeline card                                                 | **REPLACE**                   | "Next 7 Days" is **Next 30 Days**; the control reads "All Shifts", not "Full Schedule"                                                                                       |
| **Dashboard** — gear widget                                                   | **REPLACE**                   | Labels are now "Issued to me" and "Temporary loans"; the count matches the page                                                                                              |
| **Dashboard** — hours card                                                    | **REPLACE**                   | The duplicate header chip is gone; Administrative hours reads a figure rather than "Unavailable"                                                                             |
| **My Shifts** → Hours view                                                    | **NEW**                       | Third view; three cards now read this month / this year / all time                                                                                                           |
| **Scheduling settings** — Equipment section                                   | **REPLACE**                   | Four dead settings removed; it is a signpost to Inventory with no Save button                                                                                                |
| **Documents** page, empty state as a member                                   | **REPLACE**                   | Blank rather than an upload invitation                                                                                                                                       |
| **Events** list, empty state as a member                                      | **REPLACE**                   | Blank rather than a create invitation                                                                                                                                        |
| **Training Programs** as a member                                             | **REPLACE**                   | Requirements and Templates tabs are gone; the tab strip is hidden entirely                                                                                                   |
| **Course Library** as a member                                                | **REPLACE**                   | Add / Edit / Delete / Manage classes are withheld                                                                                                                            |
| Any **navigation** capture, sidebar or phone bar                              | **REPLACE**                   | See bulk note 1                                                                                                                                                              |
| Any capture of a **right-aligned table**                                      | **REPLACE**                   | See bulk note 2                                                                                                                                                              |
| Any **member-account** navigation or Apparatus page                           | **REPLACE**                   | See bulk note 3                                                                                                                                                              |
| **Equipment check crew "Sweep"**                                              | **DO NOT CAPTURE AS CURRENT** | Behind a prop and not switched on for crews; visible only in the template builder's preview. Capturing it as the member experience would document a screen no crew can reach |
| **Member qualifications** entry                                               | **DO NOT CAPTURE**            | Still no direct entry screen (QUAL-1)                                                                                                                                        |

#### YouTube script beats

Full detail in
[`youtube-scripts/SCRIPT_CURRENCY.md`](./youtube-scripts/SCRIPT_CURRENCY.md).
Summary of this window's disposition:

- **01 / 02 — Installing and First-time Setup.** The email step is materially
  different: Gmail and Microsoft 365 now work, Microsoft 365 offers an app
  registration, and there is a Test Connection button. **Any take that shows
  the Gmail or Microsoft OAuth Client ID/Secret fields is wrong** — those
  fields are gone, and they never did anything.
- **03 — IT Manager / System Admin.** New head `d7c1b95e2a40`, thirty-four
  revisions, eleven with no-op downgrades. Needs a new chapter on the two URL
  moves and on the permission repairs — this script's audience is who answers
  "why did that page disappear". The Claude MCP integration is squarely this
  script's material: opt-in, key-based, redacted, three switches off by
  default.
- **04 — Fire Chief / Leadership.** The `reports.view` and `apparatus.view`
  revocations change what the rank and file can open, and the chief is who
  gets asked. Scheduling administration has moved into Administration.
- **05 / 16 — Training Officer.** The Compliance Matrix is a different screen.
  **Any take walking the icon grid is wrong**, not stale. Course Library's
  management controls are gated on `training.manage`.
- **06 — Member Guide.** The largest member-facing window in a while: My
  Checklists as a navigation row, Quick Add on the phone bar, the Hours view
  in My Shifts, who's-going and waitlist position on events, profile
  visibility, and the Member Directory. **Any take reaching equipment checks
  through a tab on the shift screen is wrong.**
- **07 — Secretary / Administrative.** Notification Send Log is now the
  member's own; the org-wide view needs `notifications.manage`.
- **09 / 10 / 11 — Training Pipelines.** Members no longer see the
  Requirements and Templates tabs at all.
- **08 — Quick Tips & Shorts.** Six new shorts available: where equipment
  checks went; Quick Add in two taps; name your own call types; what you have
  worked this year; who's going to this event; ask for a size we don't stock.

**Do not script the crew Sweep, do not script qualification entry, and do not
script the equipment-check lap.** All three are built and none is reachable.

### Verification

Run these before trusting anything above:

```bash
cd backend && python scripts/validate_migrations.py   # head = d7c1b95e2a40
python3 scripts/check_route_permissions.py --strict   # routes vs APPLICATION_PAGES.md
python3 scripts/check_endpoint_permissions.py         # endpoints vs docstrings
python3 scripts/check_docs_links.py                   # cross-doc links
python3 scripts/screenshots/status_report.py          # screenshot coverage
```

## Change audit: August 24–31, 2026

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

### Read this first

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

### Release map

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

### Alembic route (upgrade data path)

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

#### Reversibility

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

### New data model

#### `org_chart_nodes` / `org_chart_node_holders` — the chain of command

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

#### `member_qualifications` — what a member is certified to do

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

#### `users.member_class` / `users.member_status` — two facts, two columns

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

#### `testing_checklist_entries` / `testing_runs` — the pre-launch walkthrough

One row per tester per page, now scoped to a **run**. A run carries a name and
a build identifier; starting a new one archives its predecessor rather than
clearing it. Each entry records the expected access verdict alongside the
observed one, which is what lets the printed report separate "this page is
broken" from "this page opened for an account that should have been refused".

#### `equipment_check_bulk_delete_requests` — the retry-safe ledger

A bulk delete of template items is idempotent by request id. Without the
ledger, a retried request (a flaky connection, a double tap) deleted whatever
occupied those positions at the time it arrived, which after an intervening
edit is not what the user selected.

#### Added columns

| Table                       | Column                                | Note                                                                                     |
| --------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `users`                     | `member_class`, `member_status`       | No DDL default, deliberately                                                             |
| `equipment_check_templates` | `content_revision`                    | Starts at 1; drafts key off it so a draft cannot be replayed against a changed checklist |
| `label_printers`            | preset fields                         | Stock presets per printer language                                                       |
| `equipment_requests`        | duration                              | Temporary-loan expected return                                                           |
| `storefront` variants       | thread colour, personalization method | Embroidery vs. engraving                                                                 |

### Permission and grant movements

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

### Security fixes

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

### Known limitations opened this window

Two new entries were written into
[`KNOWN_LIMITATIONS.md`](./KNOWN_LIMITATIONS.md) for this window; a third was
already recorded there and is only summarised here.

#### QUAL-1 — qualifications are written only through a course

A course's **Certifies** field (`courses.grants_qualification`) plus
`_sync_qualifications` on the training-record paths is the supported write
path. What does not exist is any way to enter, edit or expire a qualification
**on its own** — so a card a member has held for years needs a matching
training record, an expiry is corrected by editing the training record that produced it (`PATCH /training/records/{id}` re-runs the sync) rather than by filing a second completion, which would invent training history, and
setting **Certifies** on a course does not backfill records already filed
against it. Recorded as QUAL-1 in KNOWN_LIMITATIONS.md; resolved 2026-10-06 by
the profile's Qualifications card and the qualifications CSV import — see
[Entering Qualifications Directly](./training/01-membership.md#entering-qualifications-directly).

**An earlier draft of this audit said there was no write path at all**, and the
training guides and screenshot plan inherited that. The mistake came from
reading the model, the service and the changelog without grepping for callers
of `_sync_qualifications` — the feature's write side lives in the training
endpoints, not beside its model.

#### MIG-1 — seven forked migration heads in seven days

Every one came from two open branches choosing the same `down_revision`. The
merge revisions resolve them and the chain validates, but the rate is new: each
fork took a CI cycle to surface and a follow-up PR to repair, and one had to
clean up after two earlier ones. Nothing warns an author at the point the
mistake is made, because the competing revision is not on `main` yet —
`validate_migrations.py` can only catch it once both have merged. Recorded as
[MIG-1](./KNOWN_LIMITATIONS.md#mig-1--nothing-prevents-two-open-branches-from-claiming-the-same-down_revision-2026-08-31).

#### The compliance non-compliance notification is stored and inert

Already recorded, in more detail than this audit adds, in
`KNOWN_LIMITATIONS.md` as **CMP2-1**. This window applied the **partial fix**:
the panel now carries an explicit "Not yet active" notice, which is the
sanctioned second option under Pitfall #19. The switch is still wired to
nothing, and the scheduled task that would read it is a product decision on
cadence and content rather than a drive-by fix.

#### The equipment-check lap is still not wired

Carried forward unchanged from the
[August 23–24 audit](./CHANGE_AUDIT_2026-08-23_TO_24.md#the-equipment-check-lap-is-built-but-unreferenced).
The four canonical item types and the lap UI are built and tested; the live
check screen still renders the previous flat compartment list. The template
builder rebuild in this window is the **authoring** side and does not change
this. Do not narrate the lap as the current member experience.

### Documentation and media disposition

#### Screenshots

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

#### YouTube script beats

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

### Verification

Run these before trusting anything above:

```bash
cd backend && python scripts/validate_migrations.py   # head = f6a7b8c9d0e1
python3 scripts/check_route_permissions.py --strict   # routes vs APPLICATION_PAGES.md
python3 scripts/check_endpoint_permissions.py         # endpoints vs docstrings
python3 scripts/check_docs_links.py                   # cross-doc links
python3 scripts/screenshots/status_report.py          # screenshot coverage
```

## Change audit: August 23–24, 2026

Net changes merged to `main` in the 19 hours ending 2026-08-24 07:02 EDT
(merge `2107bb9a`, PR #1771), picking up where the
[August 19–23 audit](./CHANGE_AUDIT_2026-08-19_TO_23.md) stopped at
`630b4769` (PR #1723, 2026-08-23 12:38 EDT).

**46 pull requests. 477 files, ~59,500 insertions.** Twelve schema
migrations. Three features that add a screen a department has never seen
(NFC ID cards and a check-in station, network label printers, a scheduling
board that claims a seat in one tap), one shared frame that replaces the top
of four admin pages, three screens rebuilt around what their users actually
do (member storefront, Submit External Training, My Admin Hours), a nine-screen
settings consolidation, an email-notification shell rewrite, and **five
authorization gaps closed** — four of them reachable by an ordinary member.

Companion operator lesson:
[`training/19-august-2026-release-changes.md`](./training/19-august-2026-release-changes.md)
(August 23–24 section). Wiki handoff:
[`Recent-Changes-2026-08-23-to-24`](../wiki/Recent-Changes-2026-08-23-to-24.md).
Media disposition — which screenshots must be created, which replaced, and
which YouTube takes need rewriting — is in [Documentation and media
disposition](#documentation-and-media-disposition) below.

### Read this first

Three things in this window change what an operator or integrator must do,
rather than just what they see:

1. **The check-in station is a new unattended screen.** `/members/check-in-station`
   is opened by an officer on a shared device and left running. It is gated by
   the `nfc-id-cards` integration row, which **starts off** — the feature does
   not appear until a department turns it on.
2. **Label printers are network devices the server talks to directly.** The
   backend opens a socket to the printer's host and port. A printer on a
   network segment the backend container cannot reach will register fine and
   fail at print time; see [Label printing](#label-printing--the-server-opens-the-socket).
3. **The equipment-check lap is built but not yet wired.** The four canonical
   item types, their controls and the lap UI all shipped and are tested. **The
   live check screen still renders the previous flat compartment list.** Do not
   document, screenshot or narrate the lap as the current member experience.

### Release map

| Area                                                          | PRs                                                    | Pages / connection points                                                                                                 | API / data points                                                                                                                                                                                                                                                                                                       | Boundary and edge cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scheduling — the board, and standing shifts                   | #1748, #1751                                           | `/scheduling` Schedule tab (month grid + day panel; phone bar grid, day sheet, confirmation)                              | New table `standing_shift_claims`; `GET /scheduling/shifts/{id}/trade-candidates`, `POST /scheduling/swap-requests/{id}/respond`, `GET/POST/DELETE /scheduling/standing-shifts`, `GET /scheduling/standing-shifts/preview`, `GET /scheduling/eligibility/positions/bulk`; every shift response now carries its `roster` | A status chip per shift (`2 open` / `Full 4/4` / `You + 2/4`) and one button that claims the first open seat the member is cleared for. **A shift that names neither positions nor `min_staffing` reads as unset, not as an emergency** — grey, headcount not ratio, out of the open-seat count and the URGENT flag. Cancelled, finalized and past shifts read as closed and offer nothing. Standing claims have **two readers and only work because both exist**: creating a claim seats matching shifts already on record, and creating a shift seats every member whose active claim matches. Series parity is anchored on the shift it was started from, not on today. Giving up a seat is withheld while your own offer of it stands. A **training seat cannot be traded** — it carries the trainee's program and evaluating officer                                                    |
| Administration pages — one frame                              | #1729                                                  | Members, Training, Inventory and Events admin pages: header, four metrics, **Needs attention** queue, existing tabs below | New table `admin_hub_metric_preferences`; `GET /admin-hub/{module_key}/summary`, `GET`/`PUT /admin-hub/{module_key}/metrics`; `AdminHubFrame.tsx`, `AdminMetricsRow.tsx`, `AdminAttentionQueue.tsx`, `AdminMetricsSettings.tsx`                                                                                         | Three of four metric slots are choosable; **the fourth is always the count the queue is about**, so it is not stored and cannot be configured away. Two scopes share one table — a department-wide row (`user_id` NULL, scope key `__department__`) whose `applies_to_everyone` decides whether an individual admin may keep a personal selection. **No row means the module's built-in default four, never "no metrics"** (Pitfall #19). Authorized as the module's own manage permission, never a blanket admin gate — the queue rows name people. **An unknown module and a forbidden one both answer 404**, so the endpoint cannot be used to discover which modules a department runs                                                                                                                                                                                                   |
| NFC ID cards & the check-in station                           | #1739, #1750, #1765, #1770                             | `/members/check-in-station` (**new**); member profile → ID Cards panel                                                    | New table `nfc_tags`; `GET/POST/PATCH/DELETE /nfc-tags`, `POST /nfc-tags/check-in`; new `admin_hours.entry_method` value `nfc_station`                                                                                                                                                                                  | The credential is stored **only as a peppered SHA-256 hash** — a card serial is the whole credential, so a plaintext column would make a database dump a stack of working ID cards. `uid_preview` keeps the last four characters purely so an officer can tell two of a member's cards apart. Feature gated by the `nfc-id-cards` integration row, **off by default**. A station offers a shift until it is **finalized**, deliberately with no time cutoff beside that — `member_check_out` has no deadline, so an unfinalized shift is by definition one somebody may still need to tap out of, and a clock-based cutoff took the station away from the crew at exactly the moment they went off duty. Retired and on-leave members can still tap in; suspended, dropped, archived and deleted members cannot. A revoked card is never reactivated — a replacement is a fresh registration |
| Label printing                                                | #1740, #1749, #1763, #1766, #1768                      | Settings → Label Printers; inventory label print; `PrintDocumentButton` on shift roster and check sheet                   | New table `label_printers` (+ `language` column); `GET/POST/PUT/DELETE /label-printers`, `POST /label-printers/{id}/test`, `GET /label-printers/{id}/status`, `POST /label-printers/probe`, `POST /labels/print`, `POST /station-documents/preview`, `POST /station-documents/print`                                    | Two command languages: **ZPL** (Zebra and ZPL-emulating printers) and **ESC/POS** (receipt-class thermal, some with linerless label media). The renderer, the stock sizes offered and the status query all branch on it; existing rows are ZPL because that is the only language that existed when they were written. The server opens the socket, so reachability is the **backend container's**, not the operator's browser. One unanswered status query no longer silences the others. Status flags were corrected against the published command tables                                                                                                                                                                                                                                                                                                                                   |
| Equipment checks — four types, the lap, and sealed containers | #1729, #1738                                           | Template builder (type picker, sealed flag); check form seal panel                                                        | New column `check_template_compartments.is_sealed`; new table `shift_equipment_check_seals`; `check_template_items.check_type` collapsed to four values; `GET /equipment-checks/templates/{id}/last-seals`                                                                                                              | Nine `check_type` values collapse to **`level` / `function` / `count` / `expiry`** (`header` and `text` untouched — they are layout, not checks). The request schema still **accepts** legacy names and normalizes before storing; it is deliberately stricter than the reader. **A seal proves unchanged, not full**: confirming carries the previous count forward rather than writing quantities up to par, and a carried shortfall still files as a failure. A seal never clears expiry dates or pressure readings. Clearing requires a prior **intact** seal whose normalized number matches; otherwise the seal is filed and the contents are counted by hand. **The lap UI is not wired to the live check screen**                                                                                                                                                                    |
| Submit External Training                                      | #1741, #1748                                           | `/training/submit` rebuilt                                                                                                | New columns `training_submissions.start_time` (and the record's); multipart `POST /training/submissions/with-attachment`, `POST /{id}/submit`, `POST/GET /{id}/attachments`, `GET /{id}/attachments/{index}/download`                                                                                                   | The certificate now travels **with** the submission rather than as a second step that could be skipped. Files land under the _training-record_ attachment root on purpose, because approval copies the attachment dicts onto the `TrainingRecord` verbatim and the record download route confines paths to `TRAINING_ATTACHMENT_DIR`. Delete/withdraw unlinks the file — safe **only** because a submission is deletable in `draft`, `pending_review` and `revision_requested` alone. Start time is nullable with no backfill; editing previously invented 09:00                                                                                                                                                                                                                                                                                                                             |
| Email templates & the notification shell                      | #1747                                                  | Settings → Email Templates (side-by-side editor and preview); every notification the platform sends                       | New columns `email_templates.header_accent`, `status_chip`, `layout`                                                                                                                                                                                                                                                    | A notice's colourway is **data**, not hexes baked into markup. All three columns are nullable with **no backfill**: NULL means "this body carries its own colours", which is true of every pre-migration row — those render byte-for-byte as they do today. A department opts in by creating a template or pressing **Reset**. A body still byte-identical to the _current_ shipped default is upgraded to the token form; **a body anybody has touched is left exactly alone.** A department upgrading from the previous release holds a pre-1b body that no token substitution reconstructs, and the migration does not try                                                                                                                                                                                                                                                                |
| Settings — nine screens, one shell                            | #1744                                                  | Organization, Events, Scheduling, Elections, User Settings, Email Templates and three more                                | `SettingsLayout`, new `useSettingsAutosave`, `SaveStatusPill`, `SettingsPanelHead`, `SettingsToggle`                                                                                                                                                                                                                    | Nine screens carried five navigation idioms between them. All now render through the shared shell: section sidebar on desktop, scrollable tab strip on phones, `aria-current` on the active section, selection mirrored into `?tab=`. A Save/Reset footer appears **only** on sections the footer actually writes. Violet was removed from the surfaces it survived on                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Department Store                                              | #1742, #1746, #1756                                    | `/store` catalog, `/store/checkout` (**new route**), My Orders                                                            | Storefront endpoints; route gated on the organization's `storefront` module                                                                                                                                                                                                                                             | The admin dashboard **500'd**; onboarding's Enable button did not enable the store; the position editor stripped store grants on first save; and an inert config step was dropped. The member catalog, checkout and My Orders were redesigned around the cart. The Logistics Admin hub's Department Store card is gated on the module **and** the permission                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Events — ranked by what they want from you                    | #1745, #1759, #1762                                    | `/events` list                                                                                                            | `GET /events/missed-mandatory`; new column `event_rsvps.early_check_in_minutes`                                                                                                                                                                                                                                         | Events are ranked by what they need from the member, with a **Needs you** band. An early check-in — inside the window but well before the start — is **flagged and never credited as attendance**; the tap time stays the honest arrival record and the column says how far ahead of the scheduled start it was. Existing rows stay NULL, because backfilling would decide what each event's start time was at the moment somebody tapped, and an event whose start was edited afterwards would get a number that was never true. `missed-mandatory` is excluded from the API cache — it is per-member                                                                                                                                                                                                                                                                                       |
| My Admin Hours                                                | #1743                                                  | `/admin-hours` personal view                                                                                              | `GET /admin-hours/summary` now always scoped to the caller; `reportingRange.ts`                                                                                                                                                                                                                                         | **See [Security fixes](#security-fixes)** — the summary was unscoped. The six-tile grid is replaced by a reporting period driving both totals and the entry list, three fixed stats, requirement progress from the compliance endpoint, and a ranked category breakdown. The period defaults to **all time**, because a calendar-year opening view made "no hours logged in this year" read as an empty account rather than an active filter                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Dashboard — scheduling staffing widgets                       | #1686, #1695, #1698                                    | `/dashboard`                                                                                                              | `GET /scheduling/dashboard/widgets`, `GET`/`PUT /scheduling/dashboard/widget-preferences`                                                                                                                                                                                                                               | Seven tiles, each linking into the schedule already filtered to what it counted. **The window is bounded at the server**: inverted, or 93 days or longer, is a 422 rather than a query that walks the whole schedule. Station and platoon are validated against the organization's own lists, so an unknown value is a 422 and not an empty result reading as "nothing scheduled". Per-member horizons and filters                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Member profile — assigned inventory                           | #1767                                                  | Member profile → Assigned Inventory + Quick Stats                                                                         | `/users/{id}/inventory`, `/assignments`, catalog reads                                                                                                                                                                                                                                                                  | **See [Security fixes](#security-fixes)**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Authorization fixes                                           | #1732, #1752, #1753, #1754, #1755, #1757, #1758, #1767 | Dashboard asset widgets; pipeline widget; shift assignment; admin hub; lot swap; member profile                           | —                                                                                                                                                                                                                                                                                                                       | **See [Security fixes](#security-fixes)**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Browser / PWA                                                 | #1735                                                  | Installed app, every browser                                                                                              | Service-worker precache and update flow                                                                                                                                                                                                                                                                                 | The app never updated in Brave until the cache was cleared by hand. The legacy push worker is excluded from precache                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| CI and test integrity                                         | #1726, #1727, #1733, #1734, #1760                      | —                                                                                                                         | Workflow graph; `tests/conftest.py` patch guard; contract-test boot                                                                                                                                                                                                                                                     | A green PR took 28 minutes to do 39 minutes of work, almost all of it queueing. Every `main` commit now gets its own concurrency group. A leaked `patch()` now fails **the test that leaked it** rather than an innocent later one. A contract-test server that will not boot now says why — including the `SystemExit` uvicorn actually exits with                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

### Alembic route (upgrade data path)

Twelve revisions this window. **Current head: `e7a41b6d09c2`.** Confirm with
`cd backend && python scripts/validate_migrations.py` rather than trusting
this line — [`ALEMBIC_MIGRATIONS.md`](./ALEMBIC_MIGRATIONS.md) deliberately
does not declare a head in prose, for the reason recorded there.

The window opened on `a17c4e9d2b61` and immediately forked in two: the
equipment-check/admin-hub chain and the label-printer chain both descend from
it directly, and `e4b91c7d2a58` rejoins them.

| Revision       | Revises        | What it does                                                                   |
| -------------- | -------------- | ------------------------------------------------------------------------------ |
| `c3e91a7f4d28` | `a17c4e9d2b61` | Adds `admin_hub_metric_preferences`                                            |
| `d5b207e4f139` | `c3e91a7f4d28` | Adds `check_template_compartments.is_sealed` and `shift_equipment_check_seals` |
| `c3f81a4d5e72` | `d5b207e4f139` | Collapses `check_template_items.check_type` to four canonical values           |
| `c3b71f0d5a92` | `c3f81a4d5e72` | Adds `nfc_tags`                                                                |
| `d5e82c0a7f31` | `c3b71f0d5a92` | Adds `event_rsvps.early_check_in_minutes`                                      |
| `b3e7f1a92c40` | `a17c4e9d2b61` | Adds `label_printers` (second branch off the same parent)                      |
| `c7d1f4a83e29` | `b3e7f1a92c40` | Adds the printer's command `language`                                          |
| `e4b91c7d2a58` | _(merge of 2)_ | Rejoins `c7d1f4a83e29` and `d5e82c0a7f31`                                      |
| `e7a41b9c3d85` | `e4b91c7d2a58` | Adds `nfc_station` to the `admin_hours.entry_method` enum                      |
| `a71c9d4e5b62` | `e7a41b9c3d85` | Adds the self-report submission `start_time` columns                           |
| `e7c4a913b8d2` | `a71c9d4e5b62` | Adds the email-template colourway columns                                      |
| `e7a41b6d09c2` | `e7c4a913b8d2` | Adds `standing_shift_claims` — **current head**                                |

#### Reversibility

**`c3f81a4d5e72` (check-type collapse) does not reverse.** `pass_fail`,
`present` and `functional` all become `function`, and `reading` joins `level`;
no column remembers which name a row started with. Its `downgrade()`
deliberately leaves the types canonical rather than guessing — a wrong guess
renders the wrong control on a safety checklist, which is worse than leaving
the column modern.

What the old names carried implicitly is preserved rather than dropped: the
three pass/fail variants differed only in what the crew was asked to do, and
the type name was the only place that instruction lived. Items with an empty
description get the instruction written into it ("Confirm the item is in
place." / "Switch it on and confirm it works."); an item whose author described
the test keeps their own words. The seeded preset library got the same
treatment — **185 of its 232 items** were pass/fail-family with no description,
so collapsing them untreated would have left a crew with "Works / Fails" and no
test written on the item.

**`e7c4a913b8d2` (email colourway) rewrites exactly one class of row** — a body
still byte-identical to the _current_ shipped default. Everything else is left
alone, and the columns are nullable, so a downgrade drops opt-in styling data
and no wording.

**Everything else in this window adds and does not transform.** Seven of the
twelve state explicitly in their own docstrings that they do not backfill, and
each says why:

| Revision       | Why nothing is backfilled                                                                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `d5b207e4f139` | Every existing compartment stays unsealed — that is what every department has today                                                                                    |
| `d5e82c0a7f31` | Deciding each historical RSVP's early minutes means deciding what its event's start was at tap time; an event edited afterwards would get a number that was never true |
| `e7a41b9c3d85` | A historical `qr_scan` really was written by the QR path; rewriting one invents provenance the database never recorded                                                 |
| `a71c9d4e5b62` | A row written before this has no start time. NULL reads as "not recorded", which is the truth                                                                          |
| `e7c4a913b8d2` | NULL means "this body carries its own colours" — true of every pre-migration row                                                                                       |
| `e7a41b6d09c2` | No standing claim exists yet, and inferring one from existing assignments guesses a commitment nobody made                                                             |
| `c3e91a7f4d28` | A department with no preference row gets its module's built-in defaults                                                                                                |

### New data model

#### `admin_hub_metric_preferences` — which three metrics an admin page shows

Two scopes in one table. The department-wide row carries `user_id` NULL and
scope key `__department__`; a user id can never collide with it because ids are
36-character UUIDs and `__department__` is not one. `applies_to_everyone` on
the department row decides whether an individual admin may keep a personal
selection.

Only **three** slots are stored. The fourth is always the count that feeds the
attention queue, so a page cannot be configured into hiding the number its own
queue is about.

#### `nfc_tags` — ID card credentials bound to members

`uid_hash` is a **peppered SHA-256**; there is no plaintext column, because a
card serial is the whole credential and a database dump would otherwise be a
stack of working ID cards. `uid_preview` holds the last four characters so an
officer can tell two of a member's cards apart on screen — nothing else reads
it.

The table exists whether or not a department uses cards. The feature is gated
by the `nfc-id-cards` integration row, which starts **off**.

#### `shift_equipment_check_seals` — what the crew read on the tag

One row per sealed compartment per check: the seal number as read, whether it
was intact, how many items the seal cleared, and the compartment name copied as
text. `template_compartment_id` is `ondelete="SET NULL"` and nullable — a
template compartment can be deleted years after the check that referenced it,
and the audit record must survive that.

#### `standing_shift_claims` — a member's recurring claim on a seat

Stored as a claim rather than written once as a batch of assignments, so giving
up a single date leaves the series intact and shifts generated later can still
be seated from it. The horizon is the member's to pick, defaulting to a year
out rather than to December 31 — a December-31 default quietly shrinks as the
year goes on.

#### `label_printers` — registered network devices

Host, port, resolution, loaded label stock and command `language`, registered
once per physical printer instead of typed at every print.

#### Added columns

| Column                                   | Table                         | Note                                          |
| ---------------------------------------- | ----------------------------- | --------------------------------------------- |
| `is_sealed`                              | `check_template_compartments` | Default false; no backfill                    |
| `early_check_in_minutes`                 | `event_rsvps`                 | Nullable; NULL = not recorded                 |
| `start_time`                             | training submission / record  | Nullable; editing previously assumed 09:00    |
| `header_accent`, `status_chip`, `layout` | `email_templates`             | Nullable; NULL = body carries its own colours |
| `language`                               | `label_printers`              | Existing rows are ZPL as a statement of fact  |

### Label printing — the server opens the socket

The backend connects to the printer's host and port itself. Three consequences
that will otherwise be diagnosed as "the printer is broken":

- **Reachability is the backend container's, not the browser's.** A printer an
  operator can ping from their laptop may be unreachable from the container.
  Registration succeeds regardless — nothing validates the address at save
  time — and the failure surfaces at print or status time.
- **Two languages, and the choice changes more than the bytes.** ZPL and
  ESC/POS differ in the renderer used, the stock sizes offered, and the status
  query issued. A ZPL-emulating printer should be registered as ZPL.
- **Status is best-effort and per-printer.** One printer failing to answer a
  status query no longer suppresses the answers from the others — that was the
  fix in #1749, alongside correcting the status flag meanings against the
  published command tables.

Reference: [`LABEL_PRINTING_MODULE.md`](./LABEL_PRINTING_MODULE.md).

### Security fixes

Five authorization gaps, plus the member-profile disclosure. **Four were
reachable by an ordinary member holding nothing but baseline grants**, which is
the common thread: three of the five rested on a permission that is part of the
default Member position and therefore proves only that the caller is a member.

| #            | What was exposed                                                                                                                 | To whom                                                                                   | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1767        | A member's assigned gear — turnout coat, radio, SCBA mask — and its condition, on **every** member profile                       | Every viewer. The section was gated on "is the inventory module enabled" and nothing else | `inventory.manage`, or the profile is the viewer's own. `inventory.view` **could never have been the gate** — it is baseline Member. The catalog-side reads were closed in the same PR                                                                                                                                                                                                                                                               |
| #1755        | Department-wide item counts, low-stock lines, overdue-checkout totals via `GET /dashboard/asset-widgets`                         | Every member — the gate was `inventory.view`                                              | `inventory.manage` **or** `settings.manage`. The test asserts the service is never constructed for a plain viewer                                                                                                                                                                                                                                                                                                                                    |
| #1732, #1753 | The caller's own prospective-membership record, through the pipeline widget's totals, aging buckets **and** manager-only details | Anyone with `prospective_members.view` who had themselves applied                         | The widget takes the same `hidden_prospect_ids` dependency every other pipeline read already used                                                                                                                                                                                                                                                                                                                                                    |
| #1757        | Medical-screening compliance and the members attention queue — protected health information                                      | Anyone with `members.manage`                                                              | `MetricSpec.permission` / `ModuleSpec.attention_permission`, both `medical_screening.view`. A caller without it sees the metric as **unknown** rather than omitted; an absent tile invites a second look, a stated unknown does not                                                                                                                                                                                                                  |
| #1752, #1754 | — (integrity, not disclosure)                                                                                                    | —                                                                                         | `create_assignment` enforced position eligibility only on `self_signup`, so the rule applied to a member claiming their own seat and not to a scheduler seating somebody else. Now enforced on both paths. `require_mutable` and `reject_past` stay tied to `self_signup` deliberately — a scheduler backfilling last week's roster is doing records work, and being cleared for a position is a safety question that does not expire with the shift |
| #1758        | Unlimited stock movable onto a truck by a check submitter without `inventory.manage`, and disposal of lots never aboard          | Any check submitter                                                                       | Submitter-scope swaps are bounded by what is being replaced: the replaced lot must be aboard the item, and the quantity is capped at what it replaces. The template-item row is selected `FOR UPDATE` so two concurrent swaps cannot both pass the cap                                                                                                                                                                                               |

**The recurring lesson.** `inventory.view` and `prospective_members.view` are
held by positions that hold almost nothing else. A permission that everybody
has is not an authorization check — it is a statement that the caller signed
in. When gating anything per-member or department-wide, check the **manage**
grant or self-ownership, and write the test that pins which grants the baseline
Member position actually holds, so the fact the guard rests on cannot drift.

### Known limitations opened this window

#### Self-report attachments — retention and scanning

Recorded in [`KNOWN_LIMITATIONS.md`](./KNOWN_LIMITATIONS.md). Three open items:

- **No retention policy.** Approved certificates are kept indefinitely, which
  is what a training record is for, but nothing expires them and nothing sweeps
  an organization's files if the organization is removed. This needs a
  records-retention decision from the department before it needs code.
- **No malware scanning.** Uploads are validated by magic bytes and confined to
  a server-generated name, so a double extension cannot survive the trip and
  nothing is executed server-side. They are **not scanned** — a file served
  back to an officer is whatever the member uploaded.
- **Voided records keep the file**, by design: `DELETE /training/records/{id}`
  marks the record `cancelled` rather than removing it, so the correction stays
  auditable and the evidence behind the corrected entry stays with it.

There is also a load-bearing invariant worth restating: the delete path unlinks
a submission's attachment only because a submission is deletable in `draft`,
`pending_review` and `revision_requested` **alone** — never after approval,
which is the one state where a `TrainingRecord` also references the file. **If
that guard is widened, the delete must stop unlinking**, or an approved
member's evidence vanishes from their training history.

#### ONBOARD-1 — the setup wizard's per-module configuration step is inert

Fifteen setup-wizard module cards point at a per-module "configure permissions"
step that **reports success and discards the answer**.
`modulePermissionConfigs` is written to the Zustand store and read by nothing —
no API client method submits it, no backend field corresponds to it. It is
CLAUDE.md **Pitfall #19** in its worst form, because the toast actively asserts
a save.

The Department Store's route was **removed rather than repaired**, deliberately:
the previous commit had added a `configRoute` for storefront "for parity with
its peers", and parity with a screen that changes nothing is a liability. The
remaining fifteen were left because wiring the step up means deciding whether it
edits the positions saved on the previous step or submits separately — its own
change, with its own data-model question. **Whichever way it resolves, the toast
goes first**: a step that silently does nothing is recoverable; one that claims
success is not.

Related and also open: three module ids offered by checkbox
(`medical_supplies`, `mobile`, `integrations`) grant permissions that do not
exist. Predates this window.

Full entry in [`KNOWN_LIMITATIONS.md`](./KNOWN_LIMITATIONS.md).

#### The equipment-check lap is built but unreferenced

`CheckLap.tsx`, `CheckItemControls.tsx` and `checkLapModel.ts` are complete and
tested; `grep` finds no importer outside their own test files. The live check
screen still renders the previous flat compartment list. Swapping it rewrites
that screen and the tests pinning its markup, which is a deliberate follow-up.
Until then the lap must not appear in a guide, a screenshot or a script as the
current member experience.

### Documentation and media disposition

#### Screenshots

Full per-image queue in
[`training/SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md).

**Two changes invalidate captures in bulk rather than individually:**

1. **The settings shell.** Nine settings screens moved onto one navigation
   idiom. Every existing capture of Organization, Events, Scheduling, Elections,
   User Settings or Email Templates settings shows an idiom that no longer
   exists — including at phone widths, where the section list is now a
   scrollable tab strip.
2. **The email notification shell.** Every screenshot or B-roll frame of a
   received Logbook email predates the 5px accent rule and status chip. Note
   the rollout caveat when re-shooting: a department that has not pressed
   **Reset** on a template still receives the old shell, so both are current
   depending on the department.

| Image area                                                     | Disposition               | Why                                                                                                          |
| -------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Members / Training / Inventory / Events **admin page headers** | **REPLACE**               | All four now open with the shared frame: four metrics and a Needs attention queue above the tab bar          |
| Any **settings** screen                                        | **REPLACE**               | One shell, one idiom, on all nine                                                                            |
| Any **received email**                                         | **REPLACE**               | New shell; caption whether the department has adopted it                                                     |
| `/scheduling` **Schedule tab**, desktop and phone              | **REPLACE**               | Board with status chips and a day panel, not a grid of cards                                                 |
| `/store` catalog, checkout, My Orders                          | **REPLACE**               | Redesigned; `/store/checkout` is a new route                                                                 |
| `/training/submit`                                             | **REPLACE**               | Rebuilt around four things members named; certificate now attaches inline                                    |
| `/admin-hours` personal view                                   | **REPLACE**               | Six-tile grid gone; period selector, three stats, requirement progress, category breakdown                   |
| `/events` list                                                 | **REPLACE**               | Ranked, with a **Needs you** band                                                                            |
| Member profile                                                 | **REPLACE**               | Assigned Inventory is absent for viewers without `inventory.manage` — caption the capturing account's grants |
| Equipment check **template builder**                           | **REPLACE**               | Four item types with what each stores named beside it; sealed-container flag                                 |
| Dashboard                                                      | **REPLACE**               | Seven scheduling staffing tiles                                                                              |
| `/members/check-in-station`                                    | **NEW**                   | Screen has never been captured                                                                               |
| Member profile → **ID Cards** panel                            | **NEW**                   | New panel                                                                                                    |
| Settings → **Label Printers**                                  | **NEW**                   | New section                                                                                                  |
| Check form **seal panel**                                      | **NEW**                   | New control                                                                                                  |
| Standing shift modal, give-up modal, phone day sheet           | **NEW**                   | New dialogs                                                                                                  |
| Admin **metrics settings** screen                              | **NEW**                   | New configuration screen                                                                                     |
| Live equipment **check screen**                                | **DO NOT CAPTURE AS NEW** | The lap is not wired; the screen is unchanged                                                                |

#### YouTube script beats

Full detail in
[`youtube-scripts/SCRIPT_CURRENCY.md`](./youtube-scripts/SCRIPT_CURRENCY.md).
Summary of this window's disposition:

- **03 — IT Manager / System Admin.** New head `e7a41b6d09c2`, twelve
  revisions, one non-reversible (`c3f81a4d5e72`). Needs a new chapter on label
  printers, whose reachability question is squarely this script's audience.
- **04 — Fire Chief / Leadership.** The admin-page frame is the chief's daily
  view; the metric-choice scope rule (department default vs. personal) is the
  beat.
- **05 / 16 — Training Officer.** Submit External Training is rebuilt, and the
  certificate now attaches inline. Any take walking the old two-step upload is
  **wrong**, not merely stale.
- **06 — Member Guide.** Scheduling board, `/events` ranking, My Admin Hours,
  the storefront and NFC tap-in are all member-facing and all changed.
- **07 — Secretary / Administrative.** Email Templates and the notification
  shell.
- **13 — Department Store.** Previously "not affected"; the storefront is now
  redesigned end to end. **Reshoot.**
- **08 — Quick Tips & Shorts.** Four new shorts available: tap-in at the
  station, claim a shift in one tap, a sealed drug bag, printing the shift
  roster.

**Do not script the equipment-check lap.** It is built, tested and unreachable.

### Verification

Run these before trusting anything above:

```bash
cd backend && python scripts/validate_migrations.py   # head = e7a41b6d09c2
python3 scripts/check_route_permissions.py --strict   # routes vs APPLICATION_PAGES.md
python3 scripts/check_endpoint_permissions.py         # endpoints vs docstrings
python3 scripts/check_docs_links.py                   # cross-doc links
python3 scripts/screenshots/status_report.py          # screenshot coverage
```

## Change audit: August 19–23, 2026

Net changes merged to `main` in the 4 days ending 2026-08-23 12:38 EDT
(merge `630b4769`, PR #1723), picking up where the
[August 17–19 audit](./CHANGE_AUDIT_2026-08-17_TO_19.md) stopped at
`2777e004` (PR #1571, 2026-08-19 18:04 EDT).

**147 pull requests.** Eight schema migrations, one new module
(Governance → Legal Documents), a new dashboard widget layer, an
equipment-check rewrite that made shift submissions atomic and idempotent,
a breaking pagination change on two scheduling endpoints, an app-wide
mobile overlay repair, and a run of migration-history reconciliations for
revision-id collisions that had been silently skipping upgrades.

Companion operator lesson:
[`training/19-august-2026-release-changes.md`](./training/19-august-2026-release-changes.md)
(August 19–23 section). Wiki handoff:
[`Recent-Changes-2026-08-19-to-23`](../wiki/Recent-Changes-2026-08-19-to-23.md).
Media disposition — which screenshots are now wrong and which YouTube takes
need rewriting — is in [Documentation and media
disposition](#documentation-and-media-disposition) below.

### Release map

| Area                                            | PRs                                             | Pages / connection points                                                                                | API / data points                                                                                                                                                                                                                                                                                                          | Boundary and edge cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Governance — Legal Documents                    | #1579, #1584                                    | `/governance/legal` (**new**); the public `/privacy` and `/terms` render what it publishes               | New table `legal_document_revisions`; new permissions `legal.propose`, `legal.publish`; `GET /legal-documents` (overview), `POST /legal-documents/revisions`, `PUT`/`DELETE …/revisions/{id}`, `POST …/revisions/{id}/publish`, `POST /legal-documents/{document_type}/revert-to-default`                                  | Live text stays in `organizations.settings["legal"]` — that is what the **anonymous** public endpoint reads, with no join. The table is the governance record _around_ it. Proposing and publishing are **separate grants**: `legal.propose` cannot publish. The service archives the previous published row as it publishes, so in practice one `published` revision per document type per org — but this is a **service convention, not a schema constraint**: the index is non-unique and concurrent publishes could leave two (see the module page). Archived rows are never deleted, because the question a records request asks is what the notice said _on a given date_. `change_note` is required at the schema layer — the point of proposing rather than editing in place is that someone later can see why                                                                                                                                                                                        |
| Dashboard — widget layer                        | #1687, #1662, #1659, #1654                      | `/dashboard`; Chief operations dashboard; Organization dashboard asset widgets; training-officer widgets | `GET /dashboard/widgets?period=`, `GET /dashboard/operations`, `GET /dashboard/asset-widgets` (**all new**); `dashboard_widget_service.py`; `widgetRegistry.ts`, `chiefWidgetRegistry.ts`, `AssetWidgetRegistry.tsx`                                                                                                       | Each section is authorized independently, but the three endpoints differ and must not be generalized: `/dashboard/operations` and `/dashboard/asset-widgets` **omit** unauthorized sections, while `/dashboard/widgets` serializes them as **`null`**. Only `/operations` checks module **and** permission throughout; `/widgets` module-gates `fundraising` alone; `/asset-widgets` is permission-only. `settings.manage` is intentionally **not** financial access: money needs `finance.manage`, fundraising `fundraising.view` + the `grants` module, outreach `events.manage`. Asset widgets return **counts and fixed links only**, so facility codes, accounts, budgets and leases cannot leak through a general dashboard endpoint. Training-officer widget choices live in `localStorage` under `training-officer-dashboard.widgets.v1`, separate from the member-facing dashboard. **See [DASH-1](#dash-1--the-main-widget-registry-is-mostly-unread) — most of `DASHBOARD_WIDGETS` has no reader** |
| Equipment checks — atomic & idempotent          | #1654, #1659, #1662, #1710, #1719, #1643, #1641 | Shift detail → equipment check; equipment template builder; compartment tree                             | New table `equipment_check_bulk_requests`; new column `shift_equipment_checks.client_submission_id`; new constraints `uq_shift_equipment_check_shift_template`, `uq_shift_equipment_check_client_submission`; `shift_equipment_check_items.compartment_name` widened `VARCHAR(200)` → `TEXT`; `equipmentCheckHierarchy.ts` | One check per `(shift_id, template_id)` is now a **database** rule, not a UI convention. The client mints `client_submission_id` before sending, so a retry from a queued offline submission resolves to the same row instead of a second one. Bulk item creation is keyed on `(compartment_id, idempotency_key)` with a `payload_hash`, so a retry with the _same_ key but different content is rejected rather than silently accepted. Compartment parents are cycle-checked. Standalone checks accept `equipment_check.submit` **or** `equipment_check.manage` — submitting is not a manager-only right. Expired-equipment failures are **derived from authoritative inventory at submission** rather than from the client's asserted flag, then stored with the check; a lot expiring later does not retroactively fail an earlier check                                                                                                                                                                  |
| Scheduling — request pagination                 | #1632                                           | Scheduling → Requests tab                                                                                | `GET /scheduling/swap-requests` and `GET /scheduling/time-off` now return `{items, total, skip, limit}` — **previously a bare array**                                                                                                                                                                                      | **Breaking response-shape change.** Any integration or script reading these two endpoints as a list breaks. `ShiftSwapRequestsPage` / `ShiftTimeOffRequestsPage`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Scheduling — separation of duties               | #1636, #1638                                    | Requests tab; swap and time-off review                                                                   | `scheduling_service.py` review paths                                                                                                                                                                                                                                                                                       | A requester cannot review their own swap or time-off request, **even holding `scheduling.manage`** — a permission grant is not a second person. Scheduling requests are restricted to their participants                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Mobile — overlays and the bottom bar            | #1597, #1611, #1622, #1630, #1633, #1645        | Every dialog, drawer and bottom sheet on a phone                                                         | New hook `useOverlaySurface`; `modal-panel-scroll` utility; `--bottom-nav-height` custom property; `dialogScrollIntegrity.test.ts`                                                                                                                                                                                         | The bottom nav is `fixed bottom-0 z-50` and `AppLayout` renders it _after_ page content, so at equal z-index it painted **over** dialogs. Measured at 390×844 a taller-than-viewport dialog buried its action row 40px behind the bar; on a notched phone even `max-h-[90dvh]` lost 32px. `elementFromPoint` returned the nav, so buttons were **untappable, not merely clipped**, and the tap navigated the page out from under the dialog. `useOverlaySurface` is deliberately a **separate stack** from `useDialog`'s `openDialogs`, which owns Escape routing and the scroll lock — a drawer that only wants the bar out of the way must not be able to strand that lock                                                                                                                                                                                                                                                                                                                                  |
| Navigation — page titles                        | #1592, #1593                                    | Every route: authenticated, public, onboarding, sign-in                                                  | `RouteTitleManager.tsx`                                                                                                                                                                                                                                                                                                    | Derives the tab title from the page's visible `h1`, including headings that arrive after an async load. The old title is cleared **immediately** on navigation, so a slow or heading-less destination never masquerades as the page just left. Deliberately independent of `requestAnimationFrame` — browsers throttle animation frames in background tabs, which is exactly where a correct title matters most                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Events — recruitment type & prospect provenance | #1583, #1588, #1590                             | Events (type picker); membership pipeline board; event detail                                            | New `EventType.RECRUITMENT`; prospect source filtering                                                                                                                                                                                                                                                                     | `recruitment` is appended **after** `other`, not placed beside the outward-facing types where it reads better: MySQL stores an ENUM as the member's **ordinal**, so inserting mid-list would silently reassign the type of every event already stored. New recruitment events default to guest sign-in so the pipeline actually receives applicants                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Security fixes                                  | #1581, #1591, #1598, #1570, #1600, #1626        | Exports, vendor links, error details, logging, elections                                                 | `utils/csv.ts` single escaper; vendor URL scheme validation; URL redaction in copied error details; Sentry/Loguru sink hardening                                                                                                                                                                                           | See [Security fixes](#security-fixes)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Migration history reconciliation                | #1596, #1602, #1607, #1625                      | —                                                                                                        | `7ed8593bc904`, `5c2f6a8b1d34`, `9f6d1c2a4b70`                                                                                                                                                                                                                                                                             | Three revision-id collisions meant databases upgraded during specific windows carry a **valid stamp for a migration that never ran**. The stamp cannot distinguish the two histories, so the fix repeats the idempotent work downstream. No-op on a healthy database                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| PWA / offline                                   | #1588, #1621                                    | Installed app, offline launch                                                                            | Transitive chunk precaching                                                                                                                                                                                                                                                                                                | An offline launch previously failed when a lazily-imported chunk was not precached — the app installed, then would not start                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### Alembic route (upgrade data path)

Eight revisions this window. **Current head: `a17c4e9d2b61`.** Confirm with
`cd backend && python scripts/validate_migrations.py` rather than trusting
this line — [`ALEMBIC_MIGRATIONS.md`](./ALEMBIC_MIGRATIONS.md) deliberately
does not declare a head in prose, for the reason recorded there.

| Revision       | Revises        | What it does                                                                                                                            |
| -------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `1eeb053d59b7` | `2827079fd66c` | Normalizes `shifts.positions`, `shift_templates.positions`, `basic_apparatus.positions` to one canonical seat-list shape                |
| `7ed8593bc904` | `1eeb053d59b7` | Repeats the storage-area barcode backfill skipped by a revision-id collision                                                            |
| `5c2f6a8b1d34` | `7ed8593bc904` | Creates `push_subscriptions` when a collision skipped it                                                                                |
| `d6f4a13c9e20` | `7ed8593bc904` | Widens `shift_equipment_check_items.compartment_name`                                                                                   |
| `9f6d1c2a4b70` | `7ed8593bc904` | Makes `documents.file_name` / `file_path` nullable on already-upgraded databases                                                        |
| `4c8d7e2a91b3` | `9f6d1c2a4b70` | Widens `shift_equipment_check_items.compartment_name` (**see note below**)                                                              |
| `06adc68a8b84` | `4c8d7e2a91b3` | Adds `legal_document_revisions` + the `legal.propose` / `legal.publish` grants                                                          |
| `5223a69474b8` | `4c8d7e2a91b3` | Appends the `recruitment` event type                                                                                                    |
| `8a4f2d1c9b30` | `4c8d7e2a91b3` | Adds `equipment_check_bulk_requests`                                                                                                    |
| `9bb38ab9b052` | _(merge of 5)_ | Rejoins `06adc68a8b84`, `5223a69474b8`, `5c2f6a8b1d34`, `d6f4a13c9e20`, `8a4f2d1c9b30`                                                  |
| `a17c4e9d2b61` | `9bb38ab9b052` | Unique `(shift_id, template_id)` and `(organization_id, client_submission_id)` on `shift_equipment_checks`; adds `client_submission_id` |

> **`d6f4a13c9e20` and `4c8d7e2a91b3` are the same migration twice.** Both
> widen `shift_equipment_check_items.compartment_name` from `VARCHAR(200)` to `TEXT`, on
> two different parents, and both are reachable — `d6f4a13c9e20` through the
> `9bb38ab9b052` merge, `4c8d7e2a91b3` through the chain beneath it. The
> second application is a no-op on a column already `TEXT`, so this is
> harmless in practice and not worth a corrective migration; it is recorded
> here because the duplicate looks like an error when read cold, and because
> its `downgrade()` narrows the column back to `VARCHAR(200)` — **a
> downgrade past both will truncate deep compartment paths.** Tracked as
> [SCHEMA-1](./KNOWN_LIMITATIONS.md).

#### Reversibility

Two of these do **not** round-trip cleanly, and both say so in their own
docstrings:

- **`1eeb053d59b7`** (seat lists) expands a legacy `count` into that many
  seats. Its `downgrade()` is a deliberate **no-op** — it leaves the
  normalized array in place rather than trying to reconstruct the legacy
  shape, because the original `count` cannot be recovered from the expanded
  seats. **Downgrading destroys nothing**; it simply does not undo the
  normalization, and both old and new readers understand the stored shape.
- **`a17c4e9d2b61`** (unique checks) detaches historical duplicate rows by
  nulling their `shift_id` and appending an explanatory note. It keeps one
  canonical row per `(shift_id, template_id)`, preferring a completed row
  and then the earliest check. **Item snapshots are retained** — no safety
  record is deleted. The downgrade drops the constraints but cannot
  re-associate the detached rows: a later check may now own the slot.

### New data model

#### `legal_document_revisions` — governance record for the public notices

| Column                      | Type                 | Notes                                                                                                                                                          |
| --------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                        | VARCHAR(36) PK       |                                                                                                                                                                |
| `organization_id`           | VARCHAR(36) NOT NULL | FK → `organizations.id` `ON DELETE CASCADE`                                                                                                                    |
| `document_type`             | ENUM                 | `privacy_policy` \| `terms_of_service`                                                                                                                         |
| `status`                    | ENUM                 | `draft` \| `published` \| `archived`, default `draft`                                                                                                          |
| `body`                      | TEXT NOT NULL        | The proposed wording                                                                                                                                           |
| `change_note`               | TEXT NOT NULL        | The bylaw, SOP, statute or counsel note behind it. Required **at the schema layer**                                                                            |
| `effective_date`            | VARCHAR(64) NULL     | Shown to the public as "Last updated". **Free text, never parsed** — departments date policies however their records officer does (`March 3, 2026`, `FY26-Q1`) |
| `created_by`                | VARCHAR(36) NULL     | FK → `users.id` `ON DELETE SET NULL` (nullable per pitfall #2)                                                                                                 |
| `published_by`              | VARCHAR(36) NULL     | FK → `users.id` `ON DELETE SET NULL`                                                                                                                           |
| `published_at`              | DATETIME(tz) NULL    |                                                                                                                                                                |
| `created_at` / `updated_at` | DATETIME(tz)         |                                                                                                                                                                |

Index: `ix_legal_revisions_org_type_status (organization_id, document_type,
status)`.

`SET NULL` on both user references is deliberate: the wording published on a
date is a department record and **outlives the account that drafted it**.

`DRAFT` is a proposal and is **not public**. `PUBLISHED` is what `/privacy`
or `/terms` currently serves — at most one per document type per
organization. `ARCHIVED` is a revision that was published and replaced, or
a draft that was superseded; archived rows are kept, never deleted.

**The live text is not in this table.** It stays in
`organizations.settings["legal"]`, because the anonymous public endpoint
must read it without a join and without auth.

**Edge case — clearing the effective date.** Emptying the "Last updated"
box on a draft has to persist as a cleared value, not as an omitted key.
This is [pitfall #1's update-path half](../CLAUDE.md): the update payload is
`model_dump(exclude_unset=True)`, so `|| undefined` would drop the key and
the old date would survive behind a success toast. The field uses
`blankToNull`, so the clear reaches the column as an explicit `null`.

#### `equipment_check_bulk_requests` — idempotency ledger

| Column            | Type                  | Notes                                                     |
| ----------------- | --------------------- | --------------------------------------------------------- |
| `id`              | VARCHAR(36) PK        |                                                           |
| `organization_id` | VARCHAR(36) NOT NULL  | FK → `organizations.id` `ON DELETE CASCADE`               |
| `compartment_id`  | VARCHAR(36) NOT NULL  | FK → `check_template_compartments.id` `ON DELETE CASCADE` |
| `idempotency_key` | VARCHAR(200) NOT NULL | Client-supplied                                           |
| `payload_hash`    | VARCHAR(64) NOT NULL  | Guards key reuse with different content                   |
| `item_ids`        | JSON NOT NULL         | What the original request created, replayed on retry      |
| `created_at`      | DATETIME(tz)          |                                                           |

Unique index on `(compartment_id, idempotency_key)`. A retry with the same
key and same payload replays `item_ids`; **the same key with a different
payload is rejected** rather than quietly creating a second set of items.

#### `shift_equipment_checks.client_submission_id`

VARCHAR(100) NULL, unique per `(organization_id, client_submission_id)`.
Minted **on the client before the request leaves the phone**, which is what
makes a queued offline submission safe to retry: the retry resolves to the
row the first attempt created rather than adding a second check.

### End-to-end data paths and sharing boundaries

**Publishing a privacy notice.**
Secretary opens `/governance/legal` → drafts a revision (`POST
/legal-documents/revisions`, needs `legal.propose`) → a second person holding
`legal.publish` calls `POST …/{id}/publish` → the service writes the body
into `organizations.settings["legal"]` and flips the prior published row to
`archived` → anonymous `GET /privacy` reads `settings["legal"]` directly.
The revision table is never read by the public path.

**An offline equipment check.**
Phone mints `client_submission_id` → submission queued in the browser while
offline → on reconnect the queue replays → `uq_shift_equipment_check_client_submission`
resolves the retry to the existing row → item snapshots and photos attach to
that one check. Photo uploads carry their own queued ids, repaired this
window so a retried photo no longer lands against the wrong check.

**A dashboard widget request.**
`GET /dashboard/operations` → resolves the caller's org and timezone →
loads `enabled_modules` → for each section, tests **both** the module flag
and `OPERATIONS_SECTION_PERMISSIONS[section]` → omits the section entirely
if either fails. Every statement includes the tenant id. The response
carries counts and oldest-item ages, not records.

`OPERATIONS_SECTION_PERMISSIONS`:

| Section                  | Requires (any of)                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `operational_readiness`  | `scheduling.manage`                                                                                        |
| `critical_exceptions`    | `meetings.manage`, `minutes.manage`, `scheduling.manage`, `equipment_check.manage`, `notifications.manage` |
| `membership_health`      | `members.manage`                                                                                           |
| `upcoming_command_dates` | `events.manage`                                                                                            |
| `period_trends`          | `training.manage`                                                                                          |
| `pending_approvals`      | `admin_hours.manage`                                                                                       |

`GET /dashboard/widgets` accepts `period` ∈ `month | quarter | year |
rolling_30` and returns `finance` only with `finance.manage`, `fundraising`
only with the `grants` module **and** `fundraising.view`, `community` only
with `events.manage`. Note the asymmetry with `/operations` above: this
endpoint **does not omit** an unauthorized section, it serializes it as
**`null`**. So `null` here reliably means "not authorized" rather than "no
data", and an integrator can tell the two apart — which is the opposite of
the operations endpoint's behaviour. Only `fundraising` is module-gated;
`finance` and `community` are permission-only.

### Security fixes

- **CSV exports behind one escaper.** The events page had two export paths
  and only one was converted, so bulk "Export CSV" still built rows by hand.
  The event attendance export quote-escaped **only** the notes column — a
  member named `Smith, John` shifted every column after it. The reports
  module quoted values without neutralizing them. Consolidating onto
  `utils/csv.ts` then exposed three defects in the surviving implementation:
  `'=+@-'.includes('')` is `true`, so **every empty cell got a stray
  apostrophe**; whitespace was skipped before testing in one copy and not
  the other, so each caught a leading formula the other missed (both rules
  now apply — a leading tab or CR triggers on the raw first character,
  `=+@-` on the first non-whitespace one); and cells were quoted
  unconditionally, which broke the member-import error report that people
  correct and re-upload. See [pitfall #15](../CLAUDE.md).
- **Stored XSS in vendor website links** — vendor URL schemes are validated,
  so a `javascript:` href can no longer be stored and rendered.
- **URL redaction in copied error details** — the "copy error details"
  control could carry tokens embedded in URLs onto the clipboard and into a
  support ticket.
- **Sentry / Loguru sink hardening** and disabled sensitive exception
  diagnostics — exception context could reach logs in production.
- **In-flight request isolation by session** — request deduplication could
  hand one session's in-flight response to another.
- **Serialized public election ballot writes** — concurrent public ballot
  submissions could interleave.
- **Screenshot service log directory** permissions tightened.

### Known limitations opened this window

#### DASH-1 — the main widget registry is mostly unread

`frontend/src/components/dashboard/widgetRegistry.ts` declares eight widgets
with a `permission`, an `aggregatePath` and a `queuePath`. **Only one of
them — `department-setup` — is read by anything**, via
`dashboardWidget('department-setup')` in `OrganizationSetupWidget.tsx`. The
other seven entries are exported, tested against themselves, and consumed by
no screen.

Seven of the eight `aggregatePath` values do **not resolve to a mounted route**:

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

This is [pitfall #19](../CLAUDE.md) in its milder form — a declaration
without a reader. Nothing is broken today, because nothing fetches those
paths. The risk is the next contributor wiring a widget to the registry and
getting a 404 from a path that looks authoritative because it sits in a file
called a registry. Either wire the readers or mark the unwired entries in
the file itself.

#### SCHEMA-1 — duplicate `compartment_name` widening

`d6f4a13c9e20` and `4c8d7e2a91b3` both widen `shift_equipment_check_items.compartment_name`
to `TEXT` on different parents; both are reachable. Re-application is a
no-op, but **a downgrade past both narrows the column back to
`VARCHAR(200)` and will truncate deep compartment paths.**

### Documentation and media disposition

#### Screenshots needing replacement

Full detail and the per-image queue is in
[`training/SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md).
Summary of what this window invalidated:

| Image area                                                                    | Why it is now wrong                                                                                                                                          |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Any phone screenshot showing a **dialog with its action row near the bottom** | The bottom nav now hides while an overlay is open. Every such shot was taken with the bar painted over the dialog — the exact defect that was fixed. Reshoot |
| **Events page on a phone**                                                    | Cut down to what fits; toolbars no longer stack                                                                                                              |
| **Equipment check / template builder**                                        | Compartment tree, responsive builder actions, and mobile template actions all changed                                                                        |
| **Scheduling → Requests tab**                                                 | Now paginated — a shot of an unbounded list is wrong                                                                                                         |
| **Any browser-chrome shot showing the tab title**                             | Tab titles were generic before this window and are page-specific now                                                                                         |
| **Dashboard**                                                                 | New widget rows for chief / asset / training-officer views                                                                                                   |
| Events **type picker**                                                        | Gains **Recruitment**                                                                                                                                        |

#### YouTube script beats needing rewrite

Full detail in
[`youtube-scripts/SCRIPT_CURRENCY.md`](./youtube-scripts/SCRIPT_CURRENCY.md),
which was **revised 2026-08-23** after a verification pass over all eighteen
scripts. The first version of this list was written from the change list
rather than from the scripts and was wrong in both directions — it invented a
defect in script 03 and missed the three real ones.

**Narration that was false, and is now rewritten in-script** (per the standing
rule that no behavioural content lives only in SCRIPT_CURRENCY):

| Script | Beat                                | Was                                                                                                                                                                                                                                                   |
| ------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **08** | `SHORT 8C` (line 102)               | Told the viewer their swap partner would "accept or decline". **No such control exists** — the partner is notified but never decides, and since this window neither party may review the swap. The only item here a viewer _acts on_ and is harmed by |
| **05** | `DASHBOARD OVERVIEW` (lines 76, 80) | Named **"Expiring Soon"** and **"Overdue Training"**, neither of which exists on the rebuilt nine-widget dashboard. The expirations card is forward-looking only — already-expired records are excluded by a lower bound                              |
| **15** | `PRACTICE` (line 583)               | "Official tests still need `training.manage`." False — `create_test` needs only an authenticated user; the permission sits on **validation**. A leftover from 2026-08-08 that the file already contradicts twice                                      |

**New material, correctly queued** (nothing existing is wrong):

- **03 — IT Manager / System Admin.** Needs the new head, the two
  non-reversible migrations, and the three renumber-repair revisions. **It does
  not contain a rollback promise** — the earlier claim that it did was wrong.
  Script **01** carries the series' only `alembic upgrade head` beat and needs
  the same caveat appended.
- **04 — Fire Chief / Leadership.** Gains Governance → Legal Documents; the
  propose/publish split is the point of the beat. Also needs the swap
  self-review rule said out loud — a chief who is the department's only
  `scheduling.manage` holder cannot approve their own swap, and nobody else
  can either.
- **07 — Secretary / Administrative.** Legal Documents is a secretary
  workflow; new chapter.
- **08 — Quick Tips & Shorts.** Three new shorts (offline equipment check,
  recruitment nights, browser tab titles).
- **06 — Member Guide.** Production only: the phone chapter's lots sheet
  (line 472) was shot against the old bottom bar.

**Verified clear** — flagged on suspicion, checked, and clean: **12** (no
"back out" beat), **14** ("override" appears zero times), **09/10/11** (these
are _training_ pipeline scripts; "prospect" appears zero times), **13**
(storefront unchanged).

### Verification

Run these before trusting anything above:

```bash
cd backend && python scripts/validate_migrations.py   # head = a17c4e9d2b61
python3 scripts/check_route_permissions.py --strict   # routes vs APPLICATION_PAGES.md
python3 scripts/check_endpoint_permissions.py         # endpoints vs docstrings
python3 scripts/check_docs_links.py                   # cross-doc links
python3 scripts/screenshots/status_report.py          # screenshot coverage
```

All five were green at `630b4769`.

## Change audit: August 17–19, 2026

Net changes merged to `main` in the 72 hours ending 2026-08-19 18:04 EDT
(merge `2777e004`, PR #1571), picking up where the
[August 15–16 audit](./CHANGE_AUDIT_2026-08-15_TO_16.md) stopped.

Two schema migrations, one substantial new feature (PII-free call volume
tracking with a resumable shift close-out wizard), a cross-module NFC tag
surface, a configuration-preflight tool, a rewritten privacy notice, roughly
twenty security fixes from an automated red-team pass, and a CI outage fix
that had been letting the backend suite report _skipped_ rather than failed.

Companion operator lesson:
[`training/19-august-2026-release-changes.md`](./training/19-august-2026-release-changes.md)
(August 17–19 section). Wiki handoff:
[`Recent-Changes-2026-08-17-to-19`](../wiki/Recent-Changes-2026-08-17-to-19.md).
Media disposition — which screenshots are now wrong and which YouTube takes
need rewriting — is in [Documentation and media
disposition](#documentation-and-media-disposition) below.

### Release map

| Area                                                | PRs                 | Pages / connection points                                                                                                                                                            | API / data points                                                                                                                                                                                                                                                                                                    | Boundary and edge cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Scheduling — PII-free call volume                   | #1567               | Scheduling → Settings → **General → Shift close-out rules**: the **Record a call count at close-out** toggle. Shift detail panel → close-out. Reports → Call Volume                  | New tables `org_calls`, `org_call_responses`; new org setting `scheduling.call_tracking.{mode,call_types}`; `POST /scheduling/shifts/{id}/finalize` gains `reported_call_count`, `reported_call_types`, `member_call_counts`, `attach_call_ids`; `GET /scheduling/reports/call-volume` gains `counts_unit_responses` | Three quantities, three code paths, deliberately not reconcilable: department volume = distinct `OrgCall` rows; apparatus runs = `OrgCallResponse` rows; member credit = `ShiftAttendance.call_count`. `null` count ≠ `0`. Cap of 100 calls per shift. A tally short of the total pads with unclassified rather than rejecting. Mode absent ⇒ `detailed`, never `off`.                                                                                                                                                                                                                                                         |
| Scheduling — resumable close-out wizard             | #1567               | Shift detail panel → **Close out shift** (count-only departments only)                                                                                                               | New column `shifts.closeout_step`; `GET /scheduling/shifts/{id}/closeout`; `PATCH …/closeout/attendance`; `PATCH …/closeout/calls`                                                                                                                                                                                   | Each step writes real records as it advances, so a locked phone resumes rather than restarting. `closeout_step` carries no entered data. Finalized shifts report step 0; reopening restarts the wizard. Detailed-mode departments keep the single finalize checklist unchanged.                                                                                                                                                                                                                                                                                                                                                |
| NFC tags across modules                             | #1568               | `/events/:id/qr-code`, `/admin-hours/categories/:id/qr-code`, `/locations/qr-codes`, shift detail panel QR block; **Tap Tag** on Events, My Admin Hours, and the scheduling calendar | `constants/nfc.ts` — `TAG_TARGETS` registry, `parseNfcTagPath`, `buildShiftCheckInUrl`, `buildEventCheckInUrl`; `NfcTagWriter`, `NfcTagWriteButton`, `NfcTapButton`; `useNfcScanner`, `useNfcWriter`; `NfcTagTarget` in `constants/enums.ts`                                                                         | A tag is untrusted input. The parser resolves against the app's own origin, rejects anything landing elsewhere (which disposes of `javascript:` and `data:`), and returns a **rebuilt** route rather than the raw string. Only spec-named query parameters may carry an id; `?next=` cannot be smuggled in. `/display/:code` is deliberately not taggable. Web NFC is Android-Chromium only and needs a secure context: the compact controls render nothing where the API is absent, while the full writer panel distinguishes an insecure origin from an unsupported browser so the reader learns which one they are hitting. |
| Configuration — preflight and passthrough           | #1563–#1566         | — (CLI)                                                                                                                                                                              | `python -m app.preflight`, `--compose PATH`; `app/core/startup_diagnostics.py`; `docs/UPGRADING.md`                                                                                                                                                                                                                  | Exit `0` starts, `1` blocked (items listed), `2` malformed. Must be run with the same `-f` compose files and `--build`, or it answers about a configuration nobody runs. `COOKIE_SECURE` is now reachable from `.env` without breaking the unset case. A dropped compose setting is named rather than silently defaulted.                                                                                                                                                                                                                                                                                                      |
| Privacy notice and terms                            | #1562               | `/privacy`, `/terms` (public)                                                                                                                                                        | Static content; print stylesheet extracted; `noscript` fallback                                                                                                                                                                                                                                                      | Department control is stated up front: the department, not the platform, is the data controller. Accessibility pass on the print pages.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Auth — breached passwords, CAPTCHA, per-IP throttle | #1503, #1548, #1560 | Login, forgot-password, public registration, the two internet-exposed forms                                                                                                          | HIBP k-anonymity range lookup; `app/core/suspicious_ip.py`; CAPTCHA widget origins added to `SecurityHeadersMiddleware` CSP; `X-Captcha-Token` allowed in CORS                                                                                                                                                       | Breached-password lookup **fails open** (it is supplementary; an outage must not block password changes). CAPTCHA **fails closed** (nothing sits behind it). A successful sign-in clears an IP's counter only after _full_ authentication, and clearing never lifts an active block. Lockout responses are generic by default.                                                                                                                                                                                                                                                                                                 |
| Dashboard — phone layout                            | #1502, #1525, #1553 | `/dashboard`                                                                                                                                                                         | `DashboardNeedsYou`; week strip collapses on narrow viewports                                                                                                                                                                                                                                                        | The phone line counts the whole week, not the visible slice; focus is preserved across the collapse.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Inventory — vendors, medical supplies               | #1513, #1514, #1495 | `/inventory/vendors`, `/medical-supplies`                                                                                                                                            | Vendor records replace typed-in names; unmatched vendor names reported on CSV import                                                                                                                                                                                                                                 | Medical supplies split onto their own page; vendor pricing is a purchasing permission, not a directory one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| CI — apt stall and duplicated DB setup              | #1571               | —                                                                                                                                                                                    | `.github/scripts/install-system-deps.sh`; `.github/actions/backend-db-setup/action.yml`; `backend/scripts/repair_schema.py`                                                                                                                                                                                          | An unbounded `apt-get` stalled 19m26s and consumed the whole 20-minute budget of two jobs; matrices behind `needs:` then reported **skipped**, so a merge reached `main` with no backend test having run and nothing red. Now: skip apt entirely when the SONAME is already loadable, else retry under one 240s deadline covering every attempt.                                                                                                                                                                                                                                                                               |
| Security fixes (red-team batch)                     | #1479–#1561         | Training, scheduling, elections, forms, kiosk, integrations                                                                                                                          | See [`security/RED_TEAM_REVIEW_2026-08-16.md`](./security/RED_TEAM_REVIEW_2026-08-16.md)                                                                                                                                                                                                                             | Cross-tenant IP allowlist bypass; qualification-roster and training-approval scoping; kiosk draft-event exposure; CSV formula injection in the impact planner; unescaped markup in impact-plan PDFs; early self-check-in grace bounded; deleted users excluded from platoon generation; integration credentials bound to API base URLs; webhooks bound to pipeline stage references.                                                                                                                                                                                                                                           |

### Alembic route (upgrade data path)

Two revisions this window, both introspection-guarded and both reversible:

| Revision       | Revises        | File                                                    | What it does                                                                           |
| -------------- | -------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `82bdcb3b1e64` | `8050e5a61f34` | `20260818_1200_82bdcb3b1e64_add_call_tracking.py`       | Creates `org_calls` and `org_call_responses` with their indexes and unique constraints |
| `2827079fd66c` | `82bdcb3b1e64` | `20260819_0900_2827079fd66c_add_shift_closeout_step.py` | Adds `shifts.closeout_step` INTEGER NULL                                               |

`8050e5a61f34` (`20260817_1847`) is the rejoin that collapsed the four heads
left by concurrently-merged pull requests on 2026-08-17; two merge revisions
dated `20260817_1757` sit under it. **`2827079fd66c` is the current head.**
Confirm with `cd backend && python scripts/validate_migrations.py` rather than
trusting this line — [`ALEMBIC_MIGRATIONS.md`](./ALEMBIC_MIGRATIONS.md)
deliberately does not declare a head in prose, for the reason recorded there.

Both upgrades are additive. Neither backfills: an organization that has never
run count-only tracking gets two empty tables and a NULL column, and every
report keeps reading the source it already read.

### New data model

#### `org_calls` — one call the department ran

| Column            | Type                 | Notes                                                                                                                        |
| ----------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `id`              | VARCHAR(36) PK       |                                                                                                                              |
| `organization_id` | VARCHAR(36) NOT NULL | FK → `organizations.id` `ON DELETE CASCADE`, indexed                                                                         |
| `call_date`       | DATE NOT NULL        | **Date only.** A timestamp would let response times be reconstructed, which is the first step back toward an incident record |
| `call_type`       | VARCHAR(50) NULL     | Slug into the org's own type list, never a display label. NULL = unclassified                                                |
| `source`          | VARCHAR(20) NOT NULL | `manual` \| `dispatch` \| `derived`. Not a DB enum — a new dispatch vendor should not need a migration                       |
| `external_ref`    | VARCHAR(100) NULL    | Dispatch's own id. Never displayed; a CAD incident number is a lookup key into a system that _does_ hold PII                 |
| `created_at`      | DATETIME(tz)         |                                                                                                                              |
| `created_by`      | VARCHAR(36) NULL     | FK → `users.id` `ON DELETE SET NULL` (nullable per pitfall #2)                                                               |

Indexes: `ix_org_calls_organization_id`, `ix_org_calls_call_date`,
`idx_org_call_org_date`. Unique: `uq_org_call_external_ref
(organization_id, external_ref)` — this is what makes a dispatch re-sync
idempotent instead of duplicating the day's calls on every poll, and it is
org-scoped because two departments on the same CAD share its numbering.

#### `org_call_responses` — one apparatus on one call

| Column            | Type                 | Notes                                                                                                                                                                                             |
| ----------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | VARCHAR(36) PK       |                                                                                                                                                                                                   |
| `organization_id` | VARCHAR(36) NOT NULL | FK → `organizations.id` `ON DELETE CASCADE`                                                                                                                                                       |
| `call_id`         | VARCHAR(36) NOT NULL | FK → `org_calls.id` `ON DELETE CASCADE`                                                                                                                                                           |
| `shift_id`        | VARCHAR(36) NULL     | FK → `shifts.id` **`ON DELETE SET NULL`** — deleting a shift must not silently reduce the department's historical call volume                                                                     |
| `apparatus_id`    | VARCHAR(36) NULL     | **Polymorphic, no FK**, exactly like `shifts.apparatus_id`: resolves against either apparatus table via `utils/apparatus_ref`. A department on `BasicApparatus` has no `apparatus.id` to point at |
| `created_at`      | DATETIME(tz)         |                                                                                                                                                                                                   |

Unique: `uq_call_response_apparatus (call_id, apparatus_id)` — a unit responds
to a given call once. Without it, re-finalizing a shift would add a second run
to the apparatus's tally every time an officer corrected a number.

#### `shifts.closeout_step`

INTEGER NULL. `0`/NULL = not started, `1` = attendance saved, `2` = calls
saved. It carries **no entered data** — the wizard writes real records as it
advances — only where to resume.

### What is deliberately not collected

This is the point of the feature, so it is worth stating as a contract rather
than as a description. `org_calls` holds no address, no cross streets, no
patient or caller identity, no narrative, no dispatch/on-scene/clear times, and
no CAD incident number for display. That is enforced **by absence**: there is
no parameter to pass one to and no column to land it in, and
`test_incident_detail_is_not_accepted` asserts the request schemas reject the
fields outright.

A department that wants incident-level records wants an incident module, behind
its own consent and access-control story. A call counter is not the place to
start keeping PHI.

### End-to-end data paths and sharing boundaries

**Call recording (count-only mode).**
Officer opens the shift detail panel → wizard step 2 posts
`PATCH /scheduling/shifts/{id}/closeout/calls` →
`SchedulingService.save_closeout_calls` →
`CallTrackingService.record_shift_calls` reconciles this shift's _solely-owned_
calls against the reported total → `OrgCall` + `OrgCallResponse` rows →
`shifts.closeout_step = max(current, 2)`. Finalize then snapshots
`shifts.call_count` from `shift_response_count` and writes per-member
`ShiftAttendance.call_count`.

**Cross-unit dedup.** `attach_call_ids` on finalize (and on the step-2 PATCH)
points this shift's apparatus at a call another unit already logged, via
`CallTrackingService.attach_response`. Attachment runs **before** the
shift's own reconciliation, so a shared call counts toward the total instead
of being duplicated alongside it. Org scope is an explicit filter on the
query, not an inference from the caller's permission (pitfall #14b).

**Reporting.** `GET /scheduling/reports/call-volume` picks **one** source and
never mixes: count-only orgs read `org_calls`; detailed orgs read the
per-incident records feeding `ShiftCompletionReport`. Reading both and adding
them would double-count every call for an org that has used each mode in turn.
The count-only branch sets `counts_unit_responses: true`, and the renderer
relabels **Total Calls → Unit Responses**, **Avg Calls/Day → Avg
Responses/Day**, **Peak Calls → Peak Responses**, with a footnote saying an
incident two units attended is counted once for each.

**Training credit.** `ShiftAttendance.call_count` is what a member's training
requirements grade against. It is never derived from the department total and
never summed back into one — with a four-person crew that multiplies every call
by four.

**Sharing boundary.** Nothing in this feature crosses an organization: every
read and write filters `organization_id`, and the polymorphic `apparatus_id`
is resolved through the org-scoped shift rather than trusted from the client.
No call data reaches any integration, export, or email in this release.

### Edge cases worth knowing

These are behaviours a reader will otherwise discover in production. Each is
covered by a test in `backend/tests/test_call_tracking.py` (70 tests) or
`frontend/src/pages/scheduling/ShiftCloseoutWizard.test.tsx`.

- **`null` and `0` are different facts.** `null` is "we did not track it", `0`
  is "we ran none". A report that conflates them understates the department's
  quiet nights as missing data. The step-2 PATCH distinguishes an omitted field
  from an explicit null via `count_provided`, so a client that only attaches
  calls does not wipe a count it never mentioned.
- **A short tally pads with unclassified.** `{"ems": 3}` against a total of 5
  records two untyped calls. Requiring the breakdown to reconcile exactly would
  teach officers to invent a type at 0700 to get the close-out to submit.
- **A tally longer than the total is truncated**, and zero-valued entries are
  ignored entirely.
- **Lowering the total below the shift's already-shared calls is refused**, with
  a message naming the count and telling the officer to detach first. Silently
  detaching would drop another unit's run from the record.
- **Shared calls survive re-finalization.** Only solely-owned calls are
  reconciled. Rebuilding every call from scratch on each finalize would delete
  the other unit's response along with it.
- **A corrected shift drags its calls with it.** Editing the shift's date or
  reassigning it to another apparatus after step 2 was saved re-dates and
  re-attributes the surviving rows. Before this fix the totals stayed right
  while the daily and per-apparatus reports pointed at the wrong day and the
  wrong truck.
- **An apparatus-less shift is deduped by `shift_id`, not `apparatus_id`.**
  `apparatus_id == None` compiles to `= NULL`, which is never true, so every
  attach inserted another row: the tally climbed on each save and the third
  raised.
- **The close-out roster is `ASSIGNED` and `CONFIRMED` only.** `DECLINED`,
  `PENDING` and `NO_SHOW` members were previously listed, and every listed
  member gets an attendance row and the apparatus's full call count by default
  — calls credited to people who never worked the shift.
- **Assigned members with no attendance row are still listed**, with empty
  times to fill in. Otherwise anyone who never checked in was invisible: no
  hours, no credit, and no way for the officer to notice.
- **Per-member call _types_ are not invented.** Types are recorded only when
  the member was on every call; below that the count stands alone. A trainee
  credited with one call on a shift of one EMS and one fire was previously
  always assigned "EMS" — an alphabetical prefix — and `create_report` then
  spent that invented type against type-specific requirements.
- **A seeded credit and a typed one are distinguished.** On a fresh close-out
  the count is not known yet, so every credit seeds to 0; treating that as the
  officer's answer pinned the whole crew at 0 once a real count arrived.
- **Counts against a call type an admin later deleted are dropped from the
  payload**, rather than travelling invisibly and returning as an unknown-slug
  error with no field to clear.
- **Malformed `call_types` JSON degrades to the built-in list**, and the
  sanitiser now mirrors `CallTypeOption`'s pattern and length bounds exactly.
  It previously admitted any non-blank slug, so a hand-edited uppercase or
  over-long entry passed the filter and then failed schema construction —
  taking out the settings endpoint and every close-out for that organization.
- **The mode toggle takes effect immediately — in the saving browser only.**
  `loadSettings` is a once-per-session cache; mirroring the save into the store
  fixes it for the admin who flipped it. It does **not** reach another
  officer's already-open session, which keeps the stale mode and is shown a
  checklist that never asks for a count while the backend has already moved —
  so that officer's close-out finalizes with none recorded. Documented as
  "tell working officers to reload" rather than fixed; a correct fix
  re-validates the cached settings, which is a behaviour change.
- **Count-only departments that enforce end-of-shift checks can still close
  out.** The wizard carries the override (gated on a logged reason) and
  pass-down notes, because it _replaces_ the finalize checklist rather than
  sitting beside it.
- **100 calls per shift is a hard cap.** An officer closing out a shift is
  reporting a tour, not a year; a department genuinely running more has an RMS
  and is not using count-only mode.
- **Post-shift validation never prompts for an already-finalized shift**, even
  if it was finalized after it ended but before the task ran.

### Known gaps carried forward

- **The cross-unit attach picker has no UI.** `attachable_calls` is served
  **empty** on the close-out GET, deliberately: `list_calls_in_window` costs
  two queries on every request and nothing consumes the result yet. The field
  stays on the response so the contract does not change when the picker lands.
  Until then, dedup is reachable only by an API client sending
  `attach_call_ids`, and two units closing out independently each report their
  own call — which is exactly why the report labels the figure **unit
  responses**. Recorded in [`KNOWN_LIMITATIONS.md`](./KNOWN_LIMITATIONS.md#scheduling-module).
- **The call-volume report carries no preliminary marker.** Unfinalized shifts
  are labelled preliminary elsewhere; this report is not, and a docstring that
  claimed otherwise has been corrected rather than the marker added.
- **`dispatch` and `derived` sources have no writer.** The `CallSource` values
  and the `external_ref` unique constraint exist so a dispatch integration can
  be added without a migration. Nothing writes them today.

### Documentation and media disposition

#### SCREENSHOT NEEDED (new captures)

- **Scheduling → Settings → General → Shift close-out rules**, with the
  **Record a call count at close-out** toggle visible and on. Guide 03.
- **Close-out wizard step 1 — attendance**: the crew listed with editable
  on/off times, the combined-hours figure, and a member flagged
  _missing check-out_. Guide 03.
- **Close-out wizard step 2 — calls**: the per-type rows with the derived,
  read-only total beside them. This is the screen that teaches "the rows are
  the only source". Guide 03.
- **Close-out wizard step 3 — confirmation**: per-member credit seeded from the
  apparatus count, with one member adjusted down for a late arrival. Guide 03.
- **Close-out with outstanding end-of-shift checks**, showing the override
  checkbox and its required reason field. Guide 03.
- **Reports → Call Volume in count-only mode**, showing the **Unit Responses**
  labelling and the footnote. Caption it against the detailed-mode version so
  the difference in what the number means is visible. Guides 03 and 08.
- **`/events/:id/qr-code` with "Write to an NFC tag"**, mid-write. Guide 04.
- **Tap Tag on the Events page**, scan armed. Guide 04 and guide 10.
- **`/locations/qr-codes` apparatus card** showing **Write NFC tag** in the
  action row beside Copy URL / Download PNG / Regenerate. Guide 06.
- **`/admin-hours/categories/:id/qr-code` with the tag writer** beside the QR
  code. Guide 08.
- **An unrecognized tag**, showing the scan left armed with an explanation
  rather than a navigation. This is the security behaviour and it needs a
  picture. Guide 04.
- **`python -m app.preflight` output**, one clean run and one blocked run with
  the items listed. Guide 00 / script 01.
- **Privacy notice header** as rewritten, showing the department-control
  statement above the fold. Guide 17.

#### REPLACE / re-verify (existing images invalidated)

- **Any shift finalize / close-out screenshot in guide 03.** For a count-only
  department the single checklist is gone, replaced by the three-step wizard.
  Existing images are still correct for detailed-mode departments — caption
  them as such rather than deleting them, and shoot the wizard alongside.
- **Reports → Call Volume**, guides 03 and 08. The stat-card labels change
  wording in count-only mode; an uncaptioned old shot now silently claims
  incidents where the figure is unit responses.
- **`/events/:id/qr-code`**, guide 04. The action row gained a button; the
  existing shot is missing it.
- **`/locations/qr-codes`**, guide 06. Same — apparatus cards gained **Write
  NFC tag**.
- **`/admin-hours/categories/:id/qr-code`**, guide 08. Same.
- **Shift detail panel QR block**, guide 03. The NFC writer now sits under the
  QR code.
- **Scheduling → Settings → General**, guide 03. The _Shift close-out rules_
  block gained a setting; a shot of that block is stale.
- **`/privacy` and `/terms`**, guide 17. Rewritten content and a new print
  stylesheet — every existing capture is wrong.
- **Login page**, guide 00, **if** the department has CAPTCHA enabled: the
  challenge widget is new on the two internet-exposed forms.
- **Dashboard on a phone**, guides 00 and 10. The week strip collapses and the
  alert list is condensed; existing narrow-viewport captures predate both.

#### YouTube scripts

Full disposition in
[`youtube-scripts/SCRIPT_CURRENCY.md`](./youtube-scripts/SCRIPT_CURRENCY.md).
Summary — **all five affected scripts are now rewritten in place**, so nothing
behavioural from this window is left sitting in the queue:

- **04 — Fire Chief / Leadership** _(WRONG, corrected in-script)_. The close-out
  chapter narrated the single checklist and never mentioned the toggle sitting
  on the very card the presenter stands on. Worse, Scheduling Reports sent a
  chief to a figure labelled **unit responses** — a chief reading "400 calls"
  off a screen that means "400 unit responses" puts the wrong number in a grant
  application. Both are now in the take; pull any existing footage of the
  reports beat.
- **08 — Quick Tips & Shorts** _(written in-script)_. Short 8J gains a shooting
  note: film it on a detailed-mode department, where it stays correct as filmed.
  New short **8AG, "Tap Instead of Scan"**, covers NFC.
- **01 — Installing The Logbook** _(written in-script)_. New chapter **CHECK IT
  BEFORE YOU START IT** ahead of START THE SERVICES. The highest-value 60
  seconds available in the series: it turns "find the configuration problem by
  losing the service" into a command run beforehand.
- **03 — IT Manager** _(written in-script)_. Chapter 5 gains the brute-force
  stack and — the load-bearing part — which controls fail **open** and which
  fail **closed**. Chapter 9 gains preflight and `--compose`.
- **06 — Member Guide** _(written in-script)_. NFC tap as a second way in, with
  the Android-only limitation said plainly rather than buried: a member who
  tries it on an iPhone and fails will assume the app is broken.

### Verification checklist

- [ ] `cd backend && python scripts/validate_migrations.py` reports a single
      head of `2827079fd66c`
- [ ] `cd backend && pytest tests/test_call_tracking.py` — 70 tests
- [ ] `cd frontend && npm run typecheck` clean (aliased compiler, not bare `tsc`)
- [ ] A detailed-mode department still sees the single finalize checklist
- [ ] Enabling count-only shows the wizard **without a page reload**
- [ ] Reopening a finalized shift restarts the wizard at step 1

## Change audit: August 16–17, 2026

Net changes merged to `main` in the 24 hours after the
[August 15–16 audit](./CHANGE_AUDIT_2026-08-15_TO_16.md) snapshot — from
2026-08-16 17:30 ET through PR #1532 at 2026-08-17 17:28 ET. Sixty non-merge
commits: three new security subsystems (challenge-response, breached-password
detection, suspicious-IP throttling), nine authorization and data-exposure
fixes, one schema migration plus a four-head Alembic repair, a dependency
sweep that changed a documented invariant, and a large screenshot re-capture
pass.

Companion operator lesson:
[`training/19-august-2026-release-changes.md`](./training/19-august-2026-release-changes.md)
(August 16–17 section). Wiki handoff:
[`Recent-Changes-2026-08-16-to-17`](../wiki/Recent-Changes-2026-08-16-to-17.md).
Media disposition:
[`training/SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md) and
[`youtube-scripts/SCRIPT_CURRENCY.md`](./youtube-scripts/SCRIPT_CURRENCY.md).

---

### Release map

| Area                                                 | PRs                        | Pages / connection points                                                                                              | API / data points                                                                                                                                                                                                                                                                                                       | Boundary and edge cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Auth — challenge-response (CAPTCHA)**              | #1513 (+#1534)             | Forgot-password page; public form submission page. **Not** guest check-in                                              | `GET /api/v1/auth/captcha-config` (anonymous); `require_captcha` dependency on `POST /api/v1/auth/forgot-password` and `POST /api/public/forms/{slug}/submit`; token rides in the **`X-Captcha-Token`** header; `app/core/captcha.py`; `frontend/src/hooks/useCaptcha.ts`                                               | **Fails closed** — a provider outage rejects submissions (opposite of breached-password, deliberately: nothing else guards these forms). Off by default. Enabled-without-a-secret logs an error and enforces **nothing** rather than rejecting everything. Enabling widens the CSP to the provider's widget origins (`_WIDGET_ORIGINS`); with CAPTCHA off the policy is byte-for-byte unchanged, `frame-src` included. Tokens are single-use, so a rejected submission resets the widget. Rejections are generic — provider error codes are never relayed. Frontend mirrors the server's decision and treats an unreachable config endpoint as "not required" (the server still enforces). reCAPTCHA v3 is scored against `CAPTCHA_MIN_SCORE`, not read as a boolean.                                                                                                                                                                       |
| **Auth — breached-password rejection**               | #1513                      | Registration; self-service password change; reset-by-token; admin user creation; admin password reset — all five paths | `app/core/breached_password.py` → `check_password_not_breached()`; HIBP range API (`BREACHED_PASSWORD_API_URL`), k-anonymity: only the first **5 hex characters** of the SHA-1 are sent                                                                                                                                 | **Fails open** by design — an unreachable, slow, erroring or unparseable provider **accepts** the password, because complexity rules, history, MFA and lockout still apply and a third-party outage must not stop a department setting passwords mid-incident. Degradation is logged so operators can alert on it. Off by default (needs outbound network). The rejection message **omits the breach count** — a precise count is a free oracle over the corpus and tells the member nothing actionable. The SHA-1 is marked `usedforsecurity=False`: it is the corpus's lookup index, never stored, never compared to a credential, and the marking keeps the call working on FIPS builds.                                                                                                                                                                                                                                                 |
| **Auth — suspicious-IP throttling**                  | #1513                      | All sign-in surfaces (no new page)                                                                                     | `app/core/suspicious_ip.py`: `record_auth_failure()`, `clear_auth_failures()`, `get_block_remaining()`, `enforce_suspicious_ip()`; Redis keys `suspicious_ip:fail:{ip}` / `suspicious_ip:block:{ip}`; wired into `POST /auth/login` and `POST /auth/mfa/login`, **including the pre-verification challenge rejections** | Counts **failed** attempts per IP across **all** accounts over a long window — the gap between the per-IP burst limit and the per-account lockout, through which a spray (two passwords × a thousand usernames) walks unmetered. **A successful sign-in clears the IP's counter only after full authentication**, never on a correct password alone — otherwise an attacker holding one leaked password for an MFA-protected account could zero the tally at will. **Clearing never lifts an already-active block.** Redis-backed and shared across workers; degrades to a per-process counter that is capped and evicted per Pitfall #9.                                                                                                                                                                                                                                                                                                   |
| **Auth — CI-11 rate-limit fail-open**                | #1513                      | —                                                                                                                      | `check_rate_limit` now calls `is_rate_limited(..., raise_on_error=True)`                                                                                                                                                                                                                                                | The helper swallows its own exceptions and returns "not limited" unless `raise_on_error` is set, so the documented in-memory fallback was **unreachable**: in the window where Redis is connected but a command transiently fails, the request was limited by neither backend. The sibling `public_rate_limit` already passed the flag; the auth path did not.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Scheduling — platoon roster exposure**             | #1531, #1532               | Shift detail (hold-over / availability roster); Platoon Management page (`/scheduling/platoons`)                       | `GET /scheduling/shifts/{id}` returns `platoon_roster: []` unless `_can_view_platoon_roster()`; `GET /scheduling/platoons/overview` moved `scheduling.view` → **`scheduling.manage`**                                                                                                                                   | The roster reveals other members' **availability and leave status**. Visible to `scheduling.assign`, `scheduling.manage`, or the shift's own `shift_officer_id`; everyone else keeps general shift details and gets an empty list — the roster is not even fetched. `scheduling.view` is implicit for all authenticated members, so it was never a meaningful gate on a department-wide roster.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Scheduling — deleted members on generated shifts** | #1526                      | Generated platoon shifts                                                                                               | `SchedulingService` platoon generation filters `User.is_active` (was `User.status == "active"`)                                                                                                                                                                                                                         | `status` and `is_active` are different columns: a soft-deleted / anonymized member can retain a `status` of `active` while `is_active` is false, so deleted users were being staffed onto generated shifts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Scheduling — pattern rendering crash**             | #1527                      | Scheduling → Patterns tab                                                                                              | `PatternsTab.tsx` reads `schedule_config.platoons` defensively                                                                                                                                                                                                                                                          | `schedule_config` is unvalidated JSON. A non-array (or an array with non-string members) reached `.map()` and took the whole tab down. Now filtered to strings, defaulting to `[]`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Prospective members — form auto-advance**          | #1523                      | Pipeline stage of type `form_submission` with `auto_advance`                                                           | `FormsService._auto_advance_pipeline_step(form, submission)` now also filters `ProspectiveMember.form_submission_id == submission.id`; audit `action_result` gains `form_submission_id`                                                                                                                                 | **One submission advanced every active prospect parked on that step.** A submission is evidence about its own submitter only. Now exactly the bound prospect advances, and the audit row records which submission caused it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Inventory — impact-plan PDF injection**            | #1529                      | Impact Planner → export PDF                                                                                            | `app/utils/impact_plan_pdf.py` wraps `org_name`, each parameter string, member `full_name` and the contact cell in `xml.sax.saxutils.escape`                                                                                                                                                                            | ReportLab `Paragraph` parses a mini-HTML dialect, so a member name or org name containing `<`/`&` was interpreted as markup — corrupting or failing the render, with the text under a member's own control. Non-`Paragraph` cells (membership number, rank, station) are drawn as plain strings and are not affected.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Logging — exception diagnostics**                  | #1533                      | —                                                                                                                      | `app/core/logging.py`: `diagnose=False` on all three sinks (JSON, console, rotating file)                                                                                                                                                                                                                               | Loguru's `diagnose` prints **local variable values** in tracebacks. On a password-set or token-verify frame that is the credential itself, written to disk with 30-day retention and shipped wherever logs are shipped. Off on every sink, not just the file one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **CORS — CAPTCHA header**                            | #1534                      | —                                                                                                                      | `X-Captcha-Token` added to `allow_headers` in `backend/main.py`                                                                                                                                                                                                                                                         | Without it, a cross-origin browser preflight strips the header and every challenged submission fails verification — presenting as "the CAPTCHA never passes" rather than as a CORS error. Same-origin deployments were unaffected, which is why it survived the feature's own tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Meetings — card counts**                           | #1519                      | Minutes page (`/minutes`) meeting cards                                                                                | `MeetingsService.attach_child_counts()` fills `attendee_count` / `action_item_count`; called from the list endpoint                                                                                                                                                                                                     | `MeetingResponse` declared both counts and the cards rendered them, but the list query loaded no children — every card read "0 attendees · 0 action items" over a meeting whose detail view showed eight and two. Two grouped `COUNT()`s, not loaded rows, since only totals are rendered. Seeder now populates `/meetings` (approved business meeting with attendees, motions and open action items; a draft board meeting; a pending public event request), guarded per title so a half-finished run tops up rather than skipping.                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Dashboard — readiness correctness**                | #1518                      | Dashboard readiness line                                                                                               | `currentCredentials` (newest credential per course) feeds both the verdict and the "Needs you" filter; screening window read from `days_until_next_expiration`                                                                                                                                                          | **A renewed certification grounded the member permanently** — `my-training` returns a history, so a lapsed 2024 row outvoted the valid 2026 one. Screenings were judged on the backend's 30-day `expiring_soon_count` while certifications used 60, so a screening lapsing in 45 days read as current beside a certification that read as a condition; the verdict now reads its own window, which also catches one lapsing **today** (excluded by the backend's `0 < days` bound). A failed screening refresh now **clears** the counts instead of leaving a stale "Clear to respond" behind a scope note claiming screenings were checked. A screening-only verdict links to the department feed, not the training page.                                                                                                                                                                                                                  |
| **Training — driver / EVOC block**                   | #1511                      | Shift assignment; pattern generation; shift edit; driver-exception review                                              | `driver_exceptions` table (migration `20260816_0008`); `DriverExceptionService`; `EvocLevelService`; `ShiftEligibilityService`                                                                                                                                                                                          | Certification expiry is judged **on the shift's date**, not today. Pattern generation writes assignments directly and bypassed the block entirely — it now checks each driver seat, leaves the seat empty rather than failing the run, and reports the skip. A shift edit moving `apparatus_id` or `shift_date` revalidates drivers already seated (otherwise: seat a driver on an apparatus-less shift, then set the apparatus). Deleting an apparatus **CASCADEs** the exception instead of `SET NULL` — a `SET NULL` grant for one retired unit is indistinguishable from a blanket one and silently widens to the whole fleet; the audit log retains the approval. Concurrent chief reviews are settled by a conditional `UPDATE`. **Every** certification a member holds is considered, not just the highest (cumulative L3 + non-cumulative L4 was refused for an L2 apparatus). `valid_from` is bounded, not only the window length. |
| **Medical supplies — alert domain leak**             | #1500                      | Low-stock, expiring-supply and NFPA-retirement emails/SMS                                                              | `_stock_alert_audiences(db, org_id)` → `{frozenset({"gear","medical"}): [...], frozenset({"medical"}): [...]}` in `app/services/scheduled_tasks.py`                                                                                                                                                                     | Widening recipients to medical-only officers handed them a **single rendered table built from every row** — gear item names, categories and counts the API refuses them by design. Mailing data is the same disclosure as serving it. Recipients are now grouped by the domains they may see and each group gets only its own rows; someone holding both grants lands in the two-domain group and receives **one** complete email, not two partial ones. Expiring lots are fetched per domain. Deployed-on-apparatus sections stay with every recipient — that is checklist content governed by `equipment_check.*`, a different permission axis. The SMS carries only a count, so it is not split, and says so.                                                                                                                                                                                                                            |
| **Medical supplies — lot-stocked "On hand"**         | #1500                      | Medical Supplies → edit supply                                                                                         | `quantity` omitted from the payload for lot-stocked items                                                                                                                                                                                                                                                               | A lot-stocked item's count comes from its lots. Editing "On hand" wrote `quantity`, returned a success toast, and the displayed number did not move. The field is replaced for such items by the lot figure and a pointer to **Receive delivery**; `quantity` is left out of the payload entirely rather than sent as a null that would clear a column nothing shows.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Medical supplies — migration downgrade**           | #1500                      | —                                                                                                                      | `20260816_0005` downgrade                                                                                                                                                                                                                                                                                               | The downgrade removed the medical and `equipment_check` grants **unconditionally**, including ones a department had granted by hand long before the migration — while the comment above it claimed the opposite.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Prospective members — approve-step authority**     | #1510                      | Pipeline stage approval (`/approve-step`)                                                                              | `MembershipPipelineService` rejects roles the stage did not request; refuses a stage with no approver roles configured                                                                                                                                                                                                  | `/approve-step` is deliberately **not** manager-gated — the caller's only authority is that the stage asks for a role they hold. The service checked only that they hold the submitted role, never that the stage requested it: any member could write their own position into any prospect's workflow (with arbitrary notes, receiving the full prospect record back), and a stage with **no** configured approvers left nothing "missing", completing and advancing the prospect outright. The manager route rejects unrequested roles too, since recording one files misleading sign-off evidence.                                                                                                                                                                                                                                                                                                                                       |
| **Events — copied lifecycle markers**                | #1510                      | Event duplication; rolling-series extension                                                                            | Shared reset-key constant on the event model, applied at both copy sites                                                                                                                                                                                                                                                | Copying stripped the older lifecycle markers but not `attendance_finalized`, so a copy of a finalized event looked finalized and never got its own validation prompt.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Scheduling — reopened shift reminders**            | #1510                      | Shift reopen                                                                                                           | `reopen_shift` clears `validation_notification_sent`                                                                                                                                                                                                                                                                    | The post-shift task skipped a reopened shift forever, so nobody was reminded to re-finalize.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Events — date-only timezone**                      | #1510                      | Event-request form                                                                                                     | Date-only picker values anchored to midnight in the **organization's** timezone                                                                                                                                                                                                                                         | They were stamped UTC midnight, displaying the previous day for every negative-offset department.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **PWA — force refresh offline guard**                | #1512                      | Settings → App → Force refresh                                                                                         | `forceAppRefresh()` probes `/version.json` and returns `'unreachable'` without touching anything                                                                                                                                                                                                                        | The precache is the app's **only** offline copy and workbox heals a deleted entry only by fetching it, so purging offline deleted the shell and reloaded into nothing — bricking the installed PWA until signal returned. Reachability means a **parseable `/version.json`**, not `navigator.onLine`, which reports a healthy connection on station Wi-Fi behind a captive portal. `navigator.onLine === false` is still a fast path (unreliable when true, conclusive when false). Residual window between probe and reload is milliseconds and cannot be closed from the page.                                                                                                                                                                                                                                                                                                                                                            |
| **Inventory — CSV vendor import**                    | #1513, #1517               | Gear Admin → import CSV                                                                                                | Unmatched-vendor report on the import result                                                                                                                                                                                                                                                                            | Names are deduplicated on the **case-folded** key (matching what Attach-all does), displaying the first spelling seen — "Gals"/"gals"/"GALS" was reported as three pieces of work for one. A name is recorded only **after** its row imported, because `create_item` still rejects rows the CSV parse accepted (duplicate serial, pool item with no quantity). A name matching a **deactivated** vendor now links to it rather than being reported as unmatched and sending the reader to a creation form that rejects inactive duplicates — a dead end.                                                                                                                                                                                                                                                                                                                                                                                    |
| **Public API — token alphabet**                      | #1515                      | `GET /api/public/v1/application-status/{token}`; finance approval-by-token                                             | OpenAPI `pattern` declared for base64url on both token parameters                                                                                                                                                                                                                                                       | The schema constrained length but not alphabet, so the contract fuzzer generated arbitrary Unicode; percent-encoding is byte-oriented and lossy, so ten characters arrived as eight and tripped `min_length=10`. These are `secrets.token_urlsafe` values — base64url is the truth about them. **The calendar feed's token is deliberately left alone**: it answers 404 for a malformed token, so it cannot trip the check, and adding a pattern would turn that into a 422, leaking "wrong format" apart from "not found" on a public feed.                                                                                                                                                                                                                                                                                                                                                                                                |
| **Onboarding — CSRF token storage**                  | #1521                      | Setup wizard                                                                                                           | Onboarding CSRF token moved from an origin-wide cookie to **`sessionStorage`** (tab-scoped)                                                                                                                                                                                                                             | Two concurrent onboarding tabs could overwrite each other's token. Migration path: a client still holding the legacy cookie has it **adopted** into the tab and the cookie retired; a stray cookie with **no session id behind it** is ignored rather than adopted as a credential. Both paths are covered by tests, because one-time migration code fails silently once the deploy needing it has rolled past.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Onboarding — email header injection**              | #1521                      | Onboarding forms                                                                                                       | `isValidEmailSecure` newline check is now case-insensitive                                                                                                                                                                                                                                                              | It rejected `%0a`/`%0d` with a **case-sensitive** `includes()`. RFC 3986 prefers uppercase hex, so `%0A` — the canonical spelling and the one an attacker is most likely to send — went straight through. The backend's equivalent in `security_middleware.py` is **not** affected: it lowercases the address first.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Dependencies**                                     | #1504, #1505, #1506, #1507 | —                                                                                                                      | `bcrypt` 4.3.0 → **5.0.0**; python-minor-patch group (12 packages); npm-minor-patch group (4 packages); `typescript` **5.9.3 → 7.0.2** in `frontend/package.json`                                                                                                                                                       | The TypeScript bump **collapsed a documented invariant** — see [TypeScript dependency drift](#typescript-dependency-drift-action-required) below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Migrations**                                       | #1511, #1514, #1524, #1530 | —                                                                                                                      | Revision ids are now Alembic-generated; `validate_migrations.py` errors on a hand-authored `YYYYMMDD_SSSS` id dated 2026-08-17 or later, and prints the head                                                                                                                                                            | The validator no longer hands out **single-parent guidance for a forked chain** — "set `down_revision = X`" printed once per head names two parents that cannot both be right.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

---

### Alembic route (upgrade data path)

The window opened with a single head at `20260816_0005` and closed with a
single head at `8050e5a61f34`, by way of a four-head fork that made the
versions directory unloadable for roughly an hour.

#### Revisions added

| Revision        | Revises                                            | File                                                           | What it does                                                                                                                                                     |
| --------------- | -------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260816_0006` | `20260816_0005`                                    | `20260816_0006_backfill_legacy_shift_finalization.py`          | Backfills `is_finalized` on shifts predating the finalization feature                                                                                            |
| `20260816_0007` | `20260816_0005`                                    | `20260816_0007_unify_email_notification_preference.py`         | Folds the split email-notification preference into one column                                                                                                    |
| `20260816_0008` | (`_0006`, `_0007`)                                 | `20260816_0008_add_driver_exceptions.py`                       | Creates `driver_exceptions` (org-scoped, `justification`, `restrictions`, `valid_from`/`valid_until`, review fields) with four indexes; **also merges** the fork |
| `20260816_0009` | (`_0006`, `_0007`)                                 | `20260816_0009_track_reversible_completion_effects.py`         | Adds `previous_status`, `phase_before_id`, `phase_after_id`, `completion_credit_id`; **also merges** the fork                                                    |
| `71d86eba9a9e`  | (`_0006`, `_0007`)                                 | `20260817_1757_71d86eba9a9e_merge_…py`                         | No-op merge                                                                                                                                                      |
| `bb34f8937c89`  | (`_0006`, `_0007`)                                 | `20260817_1757_bb34f8937c89_merge_…py`                         | No-op merge                                                                                                                                                      |
| `8050e5a61f34`  | (`_0008`, `_0009`, `71d86eba9a9e`, `bb34f8937c89`) | `20260817_1847_8050e5a61f34_rejoin_the_four_heads_left_by_.py` | **Current head.** Names all four surviving heads as parents                                                                                                      |

#### How the fork happened, and why the repair looks redundant

`20260816_0006` and `20260816_0007` both revise `20260816_0005` — two branches
open at once, each landing a migration. **Five pull requests independently
noticed the fork and each wrote a merge for it. All five merged within the
hour**, so the repair became the fork: `main` was left with four heads and two
files claiming revision id `20260816_0008`. A duplicate revision id makes the
versions directory unloadable — `alembic upgrade head` fails outright, a fresh
install cannot migrate, and the head-count tests fail on every open PR.

The repair, and the reasoning that constrains it:

- **`20260816_0008_merge_finalization_and_email_prefs.py` was deleted.** The
  duplicate id has to go for Alembic to load _either_ revision, and this file
  is a no-op merge — the only member of the set whose removal has no schema
  consequence. The driver-exceptions revision keeps the id.
- **The two redundant no-op merges (`71d86eba9a9e`, `bb34f8937c89`) were
  kept.** A deployment may already have stamped them, and deleting a recorded
  revision strands that database at an id its chain no longer contains.
- **One merge revision names all four surviving heads.** Alembic runs each
  ancestor exactly once however many merge paths reach it, so the redundancy
  costs nothing at upgrade time.

Backend suite after the repair: 5,092 passed, 2 skipped.

#### Operational notes

- **`driver_exceptions.apparatus_id` is `ON DELETE CASCADE`, not `SET NULL`.**
  This is the one place in the schema where CASCADE is the _safe_ choice: a
  nulled `apparatus_id` on an approved exception is indistinguishable from a
  blanket fleet-wide grant, so `SET NULL` silently widens an authorization on
  apparatus retirement. The audit log retains the approval record.
- Standard procedure is unchanged: back up, confirm exactly one
  `alembic heads` result, run `alembic upgrade head`.
- `python scripts/validate_migrations.py` (from `backend/`) is the source of
  truth for the head and the `down_revision` to use.
  [`ALEMBIC_MIGRATIONS.md`](./ALEMBIC_MIGRATIONS.md) no longer records it by
  hand.

---

### End-to-end data paths and sharing boundaries

#### 1. Password set → breach corpus (new outbound path)

```
member/admin sets password
  → AuthService / users endpoint
    → check_password_not_breached(password)
      → SHA-1(password) locally
        → first 5 hex chars ────HTTPS───▶ api.pwnedpasswords.com/range/{prefix}
        ◀──── every suffix sharing that prefix
      → match made in-process against BREACHED_PASSWORD_MIN_COUNT
  → accept, or reject without naming the count
```

**What leaves the deployment:** five hexadecimal characters. Never the
password, never its full hash, never which suffix was being asked about, never
a member identifier. **What happens on failure:** the password is accepted and
the degradation is logged. **Default:** off — this is the only feature in the
platform that makes an outbound request during authentication, and some
deployments cannot permit that.

#### 2. Anonymous submission → challenge provider (new outbound path)

```
browser loads forgot-password / public form
  → GET /api/v1/auth/captcha-config   (anonymous; returns enabled/provider/siteKey — never the secret)
  → widget renders (Turnstile | hCaptcha | reCAPTCHA v3)
  → submit carries X-Captcha-Token header
    → require_captcha dependency (runs before body parsing — no schema change)
      → POST provider verify URL with CAPTCHA_SECRET_KEY + token + remote IP
      ◀── success boolean, or a 0.0–1.0 score for reCAPTCHA v3
    → reject generically on failure; token is burned either way
  → FormsService.submit_public_form / password-reset flow
```

**Shared with the provider:** the token and the submitter's IP address.
**Never shared:** form contents, the member's email, the organization.
**CSP consequence:** enabling CAPTCHA adds the provider's widget origins to
`script-src` and `frame-src` in `SecurityHeadersMiddleware`. A new provider
needs an entry in **both** `_VERIFY_URLS` and `_WIDGET_ORIGINS` — a hardcoded
`script-src 'self'` silently blocks the widget, and the symptom is "the
challenge never appears", not a CSP error.

#### 3. Failed sign-in → suspicious-IP ledger

```
POST /auth/login or /auth/mfa/login (incl. pre-verification challenge rejection)
  → enforce_suspicious_ip(request)         ← blocks before any credential work
  → on failure: record_auth_failure(ip)    → INCR suspicious_ip:fail:{ip}, EXPIRE window
      → threshold crossed → SET suspicious_ip:block:{ip}, EXPIRE block
  → on FULL authentication success: clear_auth_failures(ip)
      → clears the counter; does NOT lift an active block
```

**Keyed on IP only** — no account identifier is stored, so this ledger holds
no member data. Redis-backed and shared across workers; the in-memory fallback
is per-process, capped and evicted.

#### 4. Stock alerts → per-domain audiences

```
scheduled task
  → _stock_alert_audiences(db, org_id)
      → {frozenset({"gear","medical"}): [recipients…],
         frozenset({"medical"}):        [recipients…]}
  → per audience: fetch only that audience's rows (expiring lots fetched per domain)
  → render one message per audience
  → deployed-on-apparatus sections → every recipient (equipment_check.* axis)
  → SMS → count only, not split, and says so
```

A member holding both grants appears in the two-domain group **once**, and
receives one complete email rather than two partial ones.

#### 5. Shift detail → platoon roster

```
GET /scheduling/shifts/{id}
  → _can_view_platoon_roster(shift, user)
      scheduling.assign OR scheduling.manage OR user is shift.shift_officer_id
  → true  → service.get_platoon_roster_for_shift(shift)
    false → []   (not fetched at all)
```

The roster carries other members' availability and leave status. Everything
else on the shift stays visible to any member with `scheduling.view`.

---

### TypeScript dependency drift (action required)

**Dependabot PR #1504 bumped `frontend/package.json`'s `typescript` from
`5.9.3` to `7.0.2`, collapsing the two-install arrangement CLAUDE.md
documents.** The manifest now declares:

```jsonc
"typescript": "7.0.2",
"typescript-eslint": "^8.67.0",
"typescript-native": "npm:typescript@7.0.2",   // now identical to the above
```

`typescript-eslint@8.67.0` still caps its peer at `typescript >=4.8.4 <6.1.0`.
The tree resolves today only because **npm auto-installed a second TypeScript
(5.9.3) at the repository root as a peer dependency** — `package-lock.json`
carries `node_modules/typescript@5.9.3` with `"peer": true`, alongside
`frontend/node_modules/typescript@7.0.2`.

CI on `main` is green with this arrangement (last full-suite success:
run for PR #1528, 2026-08-17 20:27 UTC), so nothing is broken **right now**.
What changed is that the arrangement went from **declared** to **incidental**:

- The alias `typescript-native` is now redundant — both names resolve to
  `typescript@7.0.2`.
- The linter's 5.9.3 is no longer pinned by anything the repository controls.
  It exists because npm chose to satisfy a peer range, which is not a
  guarantee across npm versions or a `--strict-peer-deps` install.
- CLAUDE.md's warning that "plain `tsc` on `PATH` is the 5.9.3 one" is now
  **stale inside the frontend workspace** — `frontend/node_modules/.bin/tsc`
  is 7.0.2.

CLAUDE.md has been corrected to describe the current state. Deciding whether
to re-pin `typescript` at 5.9.3 (restoring the declared arrangement) or to
drop the alias and let the peer stand is a code change, not a documentation
one, and is left to the maintainers. It is tracked as **BUILD-1** in
[KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md).

Other dependency notes from this window:

- **`bcrypt` 4.3.0 → 5.0.0** (major). Password hashing is unchanged in
  behaviour; the API key verification path and the login path both exercise it
  and pass. Worth re-reading if a deployment pins a bcrypt wheel.
- **Stryker is deliberately absent from `package.json`.** `stryker.pilot.json`
  and `vitest.stryker.config.ts` are committed but `@stryker-mutator/core`
  pulls a transitive `qs` advisory through `typed-rest-client` with no released
  fix, taking `npm audit` from 0 findings to 2 moderate for every developer.
  [TESTING.md](../TESTING.md) carries the pinned install-for-the-run line, both
  invocation forms, the sandbox cleanup, and the wrong-package trap (`npx
stryker` fetches an unrelated pre-scoped registry package and never reads the
  config).

---

### Test and tooling changes

- **Backend guards now fail when their subject moves.** 18 guards in
  `test_changelog_fixes.py` skipped themselves when the file they inspect was
  missing. Every one of those paths is tracked, so "not found" means someone
  moved the file — a guard that retires itself exactly when its subject is
  renamed is worse than no guard. Three more skipped on an empty migrations
  glob, which would let the chain-integrity checks pass over an empty set.
  All now assert, with a message saying to repoint the path.
- **`test_push_service.py` imports `py_vapid` via `pytest.importorskip`.** It
  ships with the optional `pywebpush`; a failed module-level import is a
  _collection_ error and pytest aborts the whole session on one, so a developer
  without that optional dependency got 0 tests instead of 4,535.
- **`vitest/prefer-called-with` is `off` and must stay off.** Its autofix
  rewrites `expect(m).toHaveBeenCalled()` into the **zero-argument**
  `toHaveBeenCalledWith()` without inspecting how the mock was called, and the
  pre-commit hook runs `eslint --fix`. That is the mechanism behind "34 of 46
  broken tests" — see CLAUDE.md Pitfall #13.
- **New coverage:** the shared axios factory every module's auth depends on;
  API cache TTL boundaries and eviction ordering (the eviction path is now
  mutation-proof at 90.43%); onboarding storage and the API client transport;
  onboarding utils (validation 0→100%, security 0→100%, errorHandler 0→93.4%);
  the offline queue, the one path where a defect loses field data.
- **Interpretation caveat, recorded in TESTING.md:** inspect mutation
  survivors by hand before treating any as a gap. A meaningful share are
  _equivalent_ mutants no test can kill — all three survivors in
  `formValues.ts` were equivalent, so its effective score is 100%, not the
  reported 96%. `isValidHostSecure`'s IPv4 branch is unreachable (every
  digit-only label is already a legal hostname label), and 34 mutants inside it
  have no input that can distinguish them; the regex is kept as documentation
  of intent, with a test recording the observable consequence — octet ranges
  are **not** enforced, so it is a syntax gate, not an address validator.

---

### Documentation and media disposition

#### Corrected in this pass

| Document                                                     | Correction                                                                  |
| ------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `CLAUDE.md`                                                  | "Two TypeScript installs" section rewritten to match the post-#1504 reality |
| `docs/ALEMBIC_MIGRATIONS.md`                                 | Head note points at `8050e5a61f34`; the four-head fork recorded as history  |
| `docs/KNOWN_LIMITATIONS.md`                                  | BUILD-1 added (TypeScript peer drift); EV-5 and FORM-5 confirmed resolved   |
| `docs/SCHEDULING_MODULE.md`                                  | Platoon overview permission; shift-roster visibility rule                   |
| `wiki/Module-Scheduling.md`                                  | Same, for the wiki audience                                                 |
| `wiki/Configuration-Security.md`                             | Brute-force control matrix; CAPTCHA configuration and its CSP consequence   |
| `wiki/Security-Authentication.md`                            | Breached-password check; suspicious-IP throttling                           |
| `wiki/Configuration-Environment.md`                          | Twelve new environment variables                                            |
| `docs/training/19-august-2026-release-changes.md`            | August 16–17 operator section                                               |
| `docs/training/03-scheduling.md`                             | Who can see the platoon roster                                              |
| `docs/DATABASE_SCHEMA.md`                                    | **Regenerated** — it was stale by three merges                              |
| `docs/PUBLIC_API_DOCUMENTATION.md`                           | Token parameters declare a base64url pattern                                |
| `docs/MEETING_MINUTES_MODULE.md`                             | List-response child counts                                                  |
| `docs/PROSPECTIVE_MEMBERS_MODULE.md`, `docs/FORMS_MODULE.md` | Auto-advance is bound to the submitting prospect                            |
| `wiki/Module-Inventory.md`                                   | CSV unmatched-supplier report; impact-plan PDF escaping                     |
| `docs/training/05-inventory.md`                              | Lot-stocked "On hand"; CSV supplier-name edge cases                         |

**`DATABASE_SCHEMA.md` is generated** (`backend/scripts/generate_schema_docs.py`
reads `app/models/`, which _is_ the schema a fresh install receives) and had not
been regenerated since three model changes landed. It was understating the
database by one table and 21 columns:

- **`driver_exceptions`** (17 columns) was entirely absent
- `inventory_items.item_type` was missing the `medical` enum member
- `requirement_progress_credits` was missing three columns
- `apparatus_operators` was missing one

Regenerating is a one-command step and is worth doing in any pull request that
touches `app/models/` — a schema reference that silently omits a whole table is
the kind of staleness a reader has no way to detect. **CI now regenerates and
fails on a diff**, so this cannot recur.

#### Follow-up sweep (2026-08-18)

Acting on this audit turned up three more findings that were not changes in the
window but were exposed by documenting it:

1. **The Medical Supplies module had no documentation at all.** Shipped
   2026-08-16 with a page, two permissions, a system role, a module toggle and
   an enum member, and appeared in no module doc, no wiki page, no
   `APPLICATION_PAGES.md` row, and no role or permission reference. Now covered
   by [`MEDICAL_SUPPLIES_MODULE.md`](./MEDICAL_SUPPLIES_MODULE.md) and
   `wiki/Module-Medical-Supplies.md`.

2. **The gear renames left instructions pointing at items that no longer
   exist** — `00-getting-started.md` told readers to open "My Equipment under
   Inventory". 74 references corrected across 11 documents, plus four lines of
   YouTube narration. Dated historical notes were deliberately left alone.

3. **`check_endpoint_permissions.py` was not checking 202 routes.** Its regex
   read one of the two docstring spellings in use. Because an unread docstring
   contributes no permissions, those routes could never produce a `mismatch` —
   they landed in the warning bucket instead, exempt from the gate. It also read
   only the signature, so eight routes enforcing through a body authorizer
   looked `undefended`; that report was not just wrong but actively dangerous,
   since "fixing" it by adding the dependency would have removed the shift
   officer's access. Both fixed, with regression tests, and the check now runs
   `--strict` against a zero backlog.

The pattern across all three, and worth carrying into the next pass: **the
documentation that fails silently is the documentation nothing reads.** A
missing module page, a renamed nav item, and a regex that skips a spelling all
present identically — as nothing at all.

#### Screenshots

Flagged for **replacement** (the pictured screen changed) and for **new
capture** (the screen is new) in
[`training/SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md).
The short version:

- **Replace:** any Minutes-page card capture (the counts were rendering `0`),
  the shift-detail capture that shows a populated roster (it is now empty for
  most viewers), and the Platoon Management capture (its permission changed).
- **Capture:** the challenge widget on forgot-password and public form submit;
  the breached-password rejection; Settings → App with the unreachable-server
  refusal; the driver-block refusal and the exception-request flow.

#### YouTube scripts

Two scripts carry narration this window falsified, and three carry B-roll that
will now behave differently on camera. Full disposition in
[`youtube-scripts/SCRIPT_CURRENCY.md`](./youtube-scripts/SCRIPT_CURRENCY.md).

---

### Upgrade notes for administrators

1. **Run `alembic upgrade head`.** If you pulled `main` between roughly 17:30
   and 18:50 UTC on 2026-08-17 you may have a checkout whose versions directory
   does not load at all (duplicate revision id `20260816_0008`). Pull again —
   the repair is `8050e5a61f34`. No database recovery is needed; the broken
   state prevented migration rather than corrupting it.
2. **Nothing new is on by default** except suspicious-IP throttling, which is
   `SUSPICIOUS_IP_THROTTLE_ENABLED=true` with a deliberately generous
   threshold (50 failures per hour per IP, 15-minute block). Departments
   behind a single NAT egress should confirm the threshold suits their roster
   size before assuming it will never fire; a fully successful sign-in from
   that IP clears the counter, so ordinary typo traffic does not accumulate.
3. **CAPTCHA and breached-password checks are opt-in** and both need
   configuration beyond a boolean — see
   [`wiki/Configuration-Security.md`](../wiki/Configuration-Security.md).
   Enabling CAPTCHA without `CAPTCHA_SECRET_KEY` logs an error and enforces
   nothing; that is deliberate, so a half-finished setup does not read as an
   outage.
4. **If you run behind a reverse proxy on a different origin,** the
   `X-Captcha-Token` header must survive it. It is in the app's CORS
   allowlist as of #1534; a proxy with its own header allowlist needs the same
   entry.
5. **Platoon Management now requires `scheduling.manage`.** Anyone who reached
   it with `scheduling.view` will now get a permission error — grant
   `scheduling.manage` to the roles that legitimately need the
   department-wide roster.

## Change audit: August 15–16, 2026

Net changes merged to `main` after the
[August 12–14 audit](./CHANGE_AUDIT_2026-08-12_TO_14.md) snapshot (post
PR #1456), through PR #1471 on 2026-08-16. One schema migration, one
feature (nested facility rooms), nine security/privacy fixes with a
follow-up red-team review, a coverage-measurement correction, and two
frontend session/rendering fixes.

Companion operator lesson:
[`training/19-august-2026-release-changes.md`](./training/19-august-2026-release-changes.md)
(August 15–16 section). Wiki handoff:
[`Recent-Changes-2026-08-15-to-16`](../wiki/Recent-Changes-2026-08-15-to-16.md).

### Release map

| Area                                 | PRs                  | Pages / connection points                                                                                                                                                                       | API / data points                                                                                                                                                                                                                                    | Boundary and edge cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------ | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Facilities — nested rooms            | #1461                | Facility detail → Rooms section (tree view, sub-room counts, add-a-room-inside per row, "Located inside" picker on the room form); cross-module room picker in Events, Training, and Scheduling | `facility_rooms.parent_room_id` (new, self-FK, `ON DELETE SET NULL`); `GET /api/v1/facilities/rooms` returns `parentRoomId`, accepts `parent_room_id` / `top_level_only`; `roomTree.ts` helpers; linked `Location` name carries the containment path | Parent must be same org **and** same facility; no cycles (a room cannot enter its own subtree); depth capped at `MAX_ROOM_NESTING_DEPTH` = 5 (backend `facilities_service.py` is the authority, frontend mirrors it); deleting a room re-parents children one level up, never cascades; moving a room to another facility carries its subtree and re-syncs Location `facility_id`; a room whose parent is missing surfaces at top level rather than disappearing; room form sends explicit nulls so cleared fields persist |
| Elections — candidate visibility     | #1462                | Election detail candidate list (member view)                                                                                                                                                    | `GET /elections/{id}/candidates` → `ElectionService.list_candidates(accepted_only=…)`                                                                                                                                                                | Pending (unaccepted) nominations are returned only while the election status is `nominations`, or to callers with `elections.manage`. Outside that phase members see accepted candidates only. Managers always see all.                                                                                                                                                                                                                                                                                                    |
| Users — profile privacy              | #1464, #1469         | Member directory profile; admin member edit                                                                                                                                                     | `PATCH /users/{id}/profile` restricted-field set now includes `hire_date`; `GET /users/{id}/with-roles` clears account metadata for `members.view`-only callers (`_clear_directory_only_profile_metadata`)                                           | `hire_date` drives automatic membership-tier advancement, so it now requires leadership / secretary / membership coordinator like rank, station, platoon, membership number. Directory-only callers no longer receive `email_verified`, `mfa_enabled`, `last_login_at`, `created_at`, `updated_at`, notification preferences, or role permission lists; role **names** stay (the profile shows them); `users.view`, members-managers, and the subject are exempt.                                                          |
| Finance — approval tokens            | #1465                | External approver email link (approve/deny without login)                                                                                                                                       | `FinanceService.approve_step_by_token` / `deny_step_by_token`: `SELECT … FOR UPDATE` + `approval_token = None` on action                                                                                                                             | A token is consumable exactly once, even under concurrent clicks; the second request sees the already-actioned state. No schema change — the token column is cleared, not migrated.                                                                                                                                                                                                                                                                                                                                        |
| Public forms — daily cap             | #1466                | Public form submission page                                                                                                                                                                     | Cap moved from the route (`api/public/forms.py`) into `FormsService.submit_public_form(enforce_daily_cap=True)`; `PUBLIC_DAILY_CAP_ERROR` → `429`                                                                                                    | Only submissions that pass authorization and validation count toward `PUBLIC_FORM_DAILY_LIMIT`; honeypot hits and rejected payloads no longer exhaust the allowance (an anonymous bot can no longer deny service on a form's daily quota). Honeypot still returns fake success.                                                                                                                                                                                                                                            |
| Rate limiting — Redis outage         | #1467                | All public endpoints behind `public_rate_limit`                                                                                                                                                 | `is_rate_limited(raise_on_error=True)` re-raises Redis errors so `public_rate_limit` falls to its in-memory fallback limiter                                                                                                                         | Previously `fail_closed=False` meant a Redis error silently disabled public rate limiting. Security-critical fail-closed paths (login, registration) unchanged.                                                                                                                                                                                                                                                                                                                                                            |
| Deployment — prod volumes            | #1468                | —                                                                                                                                                                                               | `docker-compose.prod.yml` `volumes: !override`                                                                                                                                                                                                       | Clears development bind mounts instead of merging them; **requires Docker Compose v2.24.4+**. Older Compose versions error on the tag — upgrade Compose, do not remove the tag.                                                                                                                                                                                                                                                                                                                                            |
| Deployment — Unraid origin           | #1463                | —                                                                                                                                                                                               | `unraid/.env.example` `ALLOWED_ORIGINS=https://logbook.yourdomain.com`                                                                                                                                                                               | Default posture enforces HTTPS, so the previous `http://<LAN-IP>:7880` example was unusable as shipped. Existing installs with a working HTTPS origin are unaffected.                                                                                                                                                                                                                                                                                                                                                      |
| Shared devices — draft purge         | #1470                | Logout (station/shared computers)                                                                                                                                                               | `clearAllDrafts()` sweeps `equipment-check-draft-*` alongside `shift-report-draft-*`, including orphaned keys                                                                                                                                        | Red-team RT-08 (medium, CWE-922): equipment-check drafts survived logout and were readable by the next browser user. Unrelated browser preferences are preserved. See [`security/RED_TEAM_REVIEW_2026-08-16.md`](./security/RED_TEAM_REVIEW_2026-08-16.md).                                                                                                                                                                                                                                                                |
| Onboarding — session storage         | #1459                | Onboarding wizard (all steps)                                                                                                                                                                   | `onboarding_session_id` moved `localStorage` → `sessionStorage`; legacy key removed on load and on `clearSession()`                                                                                                                                  | The session can authorize setup mutations, so it is now tab-scoped and does not survive browser restart. Multi-tab onboarding is intentionally no longer shared state. CSRF token remains a `SameSite=Strict` cookie. [`ONBOARDING_FLOW.md`](./ONBOARDING_FLOW.md) has the full model.                                                                                                                                                                                                                                     |
| Theming — dark canvas                | #1459                | Every page outside `AppLayout`: public forms, ballots, status pages                                                                                                                             | Gradient canvas + `scrollbar-gutter: stable` moved `body` → `html`                                                                                                                                                                                   | Dark-mode surface tokens are translucent white by design; without a painted root canvas those pages composited over browser-default white (white page, light-on-light text). The root owns the canvas because the scrollbar gutter sits outside the body's box.                                                                                                                                                                                                                                                            |
| Module API clients — refresh failure | (direct, `a9204af9`) | Every module using `createApiClient`                                                                                                                                                            | On 401 → refresh failure: `handleExpiredSession()` + `reportApiError()` + **reject** the original request                                                                                                                                            | Previously the client redirected to `/login` but resolved the request with `undefined`, letting callers continue against a missing Axios response mid-navigation.                                                                                                                                                                                                                                                                                                                                                          |
| CI / coverage                        | #1471                | —                                                                                                                                                                                               | `frontend/vitest.config.ts` `coverage.include`; backend `--cov-fail-under=51` + separate 35% gate on `api/services/core/utils`; `stryker.pilot.json`                                                                                                 | Frontend coverage previously counted only imported files, hiding 384 of 758 source files; honest baseline is 33.10% lines and the ratchet floors were re-based (31/23/25/30) — not a regression. Backend logic layers gate separately so ~97%-covered declarative models/schemas can't mask regressions. Mutation pilot: 90.6%; survivors cluster in `apiCache.ts` eviction.                                                                                                                                               |

### Alembic route (upgrade data path)

One revision this window:

| Revision        | Revises         | File                                        | What it does                                                                                                                                                            |
| --------------- | --------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260816_0001` | `20260814_0004` | `20260816_0001_add_facility_room_parent.py` | Adds `facility_rooms.parent_room_id` VARCHAR(36) NULL, index `idx_facility_rooms_parent`, self-referential FK `fk_facility_rooms_parent_room` with `ON DELETE SET NULL` |

`20260816_0001` was the single head at this audit's snapshot; later
same-day merges appended `20260816_0002` (storage-area barcode backfill) and
`20260816_0003` (inventory vendors — renumbered from a colliding `_0002`), so
the current head is `20260816_0003`. The migration is introspection-guarded
(no-op if the table is absent or the column already exists) and the downgrade
removes FK, index, and column defensively in that order.

Operational notes:

- **`ON DELETE SET NULL` is a deliberate backstop, never CASCADE** — removing a
  room must not silently delete the sub-rooms (and their kiosk codes and stored
  inventory) beneath it. The service re-parents children onto the deleted
  room's own parent before the constraint would ever fire.
- No data backfill: existing rooms upgrade with `parent_room_id = NULL` (all
  top-level) and behavior is unchanged until someone nests a room.
- Standard procedure: back up, require exactly one `alembic heads` result, run
  `alembic upgrade head`.

### End-to-end data paths and sharing boundaries

- **Nested rooms → Locations → Events/QR check-in.** A room's linked Location
  record now derives its name from the containment path ("Quartermaster's
  Storage — Volunteer Office — Station 1"), and its `facility_id` follows the
  room when the room changes buildings. Anything consuming Locations (event
  location picker, kiosk displays, QR directory) sees the path automatically.
  Nesting validation is org-scoped end to end: the parent room must be in the
  caller's organization and the same facility.
- **Election candidates.** The member-facing list is now phase-dependent. Any
  integration or export that read pending nominations through the member list
  outside the nominations phase must use an `elections.manage` credential.
- **Directory profiles.** `members.view` now yields strictly less data than
  `users.view` on `GET /users/{id}/with-roles`. Consumers must tolerate the
  redacted fields being `null` (`UserProfileResponse` makes them Optional).
- **Public form quota.** The cap decision moved a layer down, into the service,
  and is now made after honeypot + validation. Anything invoking
  `FormsService.submit_public_form` directly gets cap enforcement only when it
  passes `enforce_daily_cap=True` (the public route does).
- **Shared-device residue.** Post-logout, `localStorage` holds neither
  shift-report nor equipment-check drafts; IndexedDB offline queues were
  already purged. Onboarding session identity is tab-scoped.

### Documentation and media disposition

#### SCREENSHOT NEEDED (new captures)

Tracked in [`training/SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md)
with exact demo-data requirements:

1. Rooms section rendering a nested tree with sub-room counts and the
   add-a-room-inside row action.
2. Room form "Located inside" picker, showing the excluded own-subtree and a
   depth-capped selection.
3. Delete-room confirmation stating sub-rooms move up one level.
4. Cross-module room picker (an event form) with indented sub-rooms and the
   containment path under the selected room.
5. Member-vs-manager candidate list during and after the nominations phase.
6. Directory profile as seen with only `members.view` (redacted metadata)
   beside the same profile with `users.view`.
7. Profile edit rejecting a `hire_date` change without the coordinator grant.

#### REPLACE / re-verify (existing images invalidated)

- `06-11-facility-detail.png` — re-verify; replace if the Rooms section is
  visible with the old flat list.
- Any capture showing a flat Rooms list or the old room form without the
  "Located inside" field (the Rooms section was substantially re-rendered).
- Event/training/scheduling captures showing the room picker with a flat,
  un-indented list — re-verify; the picker now indents sub-rooms and prints
  the containment path.
- Dark-mode captures of public pages (forms, ballots, status) taken before the
  canvas fix showed a white background — replace any that did.

#### YouTube scripts

Queued in [`youtube-scripts/SCRIPT_CURRENCY.md`](./youtube-scripts/SCRIPT_CURRENCY.md):
facilities/rooms narration (scripts 03, 04), any location-picker B-roll
(04, 06, 07), elections candidate-list claims (12), member privacy/directory
narration (06), and the shared-computer logout claim (06, 08). Nothing is
recorded yet, so these are pre-take corrections, not re-records.

### Verification checklist

- [ ] `alembic heads` returns exactly `20260816_0001`; `alembic upgrade head`
      clean on a backup-verified database.
- [ ] Nest a room, delete its parent, confirm the child re-parents (not
      deletes) and its Location name re-syncs.
- [ ] Attempt to nest a room under its own descendant and past depth 5 — both
      rejected with a clear message, surfaced in the toast.
- [ ] As a member without `elections.manage`, list candidates on a closed
      election — pending nominations absent.
- [ ] As a `members.view`-only member, open a colleague profile — no MFA/login
      metadata, no role permission lists.
- [ ] Click a finance approval email link twice — second click reports the
      already-actioned state.
- [ ] Submit an invalid public form repeatedly — valid submissions still
      accepted afterward (cap not consumed).
- [ ] Log out on a shared machine — no `equipment-check-draft-*` or
      `shift-report-draft-*` keys remain.
- [ ] `docker compose version` ≥ 2.24.4 anywhere `docker-compose.prod.yml` is
      deployed.

## Three-day change and connection audit — 2026-08-12 through 2026-08-14

**Audit window:** 2026-08-12 00:00 UTC through 2026-08-14 (inclusive)  
**Baseline:** `b55d39c14bd244b360c358f87107e2526783a662` (last reachable commit before the window)  
**Audited head:** `4ae6f3ffb4a654f5c9d0901c17f6ab8110ff20a2`

This is the cross-functional release handoff for the three-day window. It records
user-visible pages, API and service connection points, persisted data, Alembic
routes, sharing boundaries, security rules, documentation/media work, and edge
cases. The exact **net** file set is retained in
[`change-audit/2026-08-12-through-14-files.txt`](./change-audit/2026-08-12-through-14-files.txt).
The manifest is authoritative for the initial audited snapshot, not a claim that
no later August 14 merge occurred. The follow-up reconciliation below records
same-day changes merged after that head; use Git history for their exact paths.
This narrative groups both tranches into usable release information. Merge-only
commits and intermediate revisions are not counted twice.

### Same-day follow-up incorporated after the audited snapshot

The August 14 merge after the manifest head added the event reminder audience
and 60-minute Flexible check-in default; frozen-roll enforcement at ballot issue
and token redemption; private audit archive modes; training-result visibility in
personal exports; redacted directory vs elevated scanner permissions; and the
personal/organization dashboard split. These are included in the release map,
changelog, module/wiki references, and numbered training guides even though they
are intentionally not retroactively inserted into the immutable 879-path
snapshot manifest.

### Release map

| Area                                      | Pages and operator touchpoints                                                                                                                                            | Backend connection points                                                                                                      | Data points and paths                                                                                                                                                                                            | Sharing, permission, and edge cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Elections                                 | Elections list/detail, addressable detail tabs, Ballot Builder, saved-template picker, runoff chain, manual ballot count, frozen-roll issue/redemption                    | `/api/v1/elections/*`; new list/create/delete `/templates/saved-ballots`; election service                                     | `SavedBallotTemplate`; template structure plus quorum, voting method, victory rules, voter types, attendance settings; `manual_batch_ballots_cast`                                                               | `elections.manage`, organization scope; templates never copy candidates, rosters, votes, tokens, attendance, or result state. Names collide case-insensitively. Applied items get new IDs. Count quorum may exceed 100; percentage may not. Legacy rows, duplicate item IDs, invalid voting methods, mixed `all` voter types, runoff clone state, concurrent votes, approval turnout, attested paper-count bounds, and members outside the frozen roll now fail safely; secretary overrides and null legacy snapshots are explicit exceptions.                                                                                                                                                                    |
| Membership pipeline / forms / events      | Prospect board/detail and progress rail; event Settings outreach-form picker; early-ended attendance                                                                      | `/api/v1/prospective-members/*`, `/api/v1/forms`, `/api/v1/event-requests/forms`, `/api/v1/events/*`; skip-step action         | Active-prospect normalized email key; stage approvals/interviews; event mandatory membership tiers; reminder target; 60-minute Flexible check-in; related public outreach form metadata                          | Active email uniqueness is per organization and active rows only. Reconciliation preserves one canonical active record and releases inactive duplicates. Multi-approval signers must authenticate; final/gated stages cannot be skipped into invalid state. Outreach-form discovery is limited to event administrators and public outreach form type. Deleted interviewers remain readable historically. Attendance finalization supports early-ended events and reporting includes reviewed attendance only. Reminder audiences are `going`/`all`/`none`, preference-aware and org-scoped; copies deep-copy JSON and strip lifecycle state. Flexible defaults to 60 minutes, with a 15-minute overlap exception. |
| Scheduling / apparatus / equipment checks | Shift settings, calendar context, templates, crew seats, member checklist reports, apparatus QR directory                                                                 | `/api/v1/scheduling/shift-settings` GET/PUT/DELETE; scheduling, equipment-check and apparatus services                         | Per-org `SchedulingModuleConfig`; shift-template vehicle fields; apparatus crew positions/rank IDs; checklist findings and completion reports                                                                    | Settings cache/state is keyed by org. Crew seats use configured ranks, preserve legacy names, and reject incompatible edits. Member completion/report flows remain allowed after tighter template permissions. Shift completion resolves apparatus labels in batches.                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Training / skills / compliance            | Training session edit, program breadcrumbs, member program cards, skill-test runner/results, compliance profile admin-hours editor                                        | `/api/v1/training/sessions/by-event/{event_id}` and linkage PATCH; training/program/skills/compliance endpoints                | Session links to requirement/course/program; skill-test `resume_count`; scoring points; result-visibility setting; requirement ownership                                                                         | Officer-only checklist/sign-off fields are not exposed to members. A failed step may deduct points without forcing whole-test failure. Official-test policy fields are server guarded. Resume retries are scoped to the test and 409 is guarded. Undated records cannot satisfy recency. Deleting a program cannot delete a requirement it does not own.                                                                                                                                                                                                                                                                                                                                                          |
| Inventory                                 | Items/detail, issue/return, stock lots, CSV import, barcode/label flows, live inventory updates                                                                           | `/api/v1/inventory/*`; inventory and label services; inventory WebSocket                                                       | Computed overdue state; temporary-issue return date; available/issued/deployed stock; barcode/asset-tag identifier fallback; CSV upload bytes                                                                    | Overdue is calculated from the current return deadline rather than stale stored state. Temporary issues preserve their return date. Availability excludes stock already issued/deployed. Barcode labels fall back only through the documented identifier order. CSV limits apply to bytes as well as row shape, and WebSocket origins must pass the configured allowlist.                                                                                                                                                                                                                                                                                                                                         |
| Storefront                                | Member storefront/payment method; admin dashboard counts; order status/activity cards and filters; configurable open banner                                               | `/api/v1/store/*`, including `/api/v1/store/orders/mine/{order_id}/payment-method` PATCH; storefront and notification services | `show_store_open_banner`; activity/status counts; order filters; canonical product locks; member payment method                                                                                                  | Member can change only their own payment method. Email/notice sends do not disclose recipient lists. Product locks canonicalize variants/options. Dashboard counts and filtered order lists use the same org-scoped source.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Facilities / locations / QR               | Facility detail extended sections; facilities dashboard counts; Room QR Codes directory, print signs, search, PNG download, inline room QR; apparatus check-in QR entries | facility counts endpoint; location display-code regeneration; facility/location APIs                                           | Facility sensitive sections; rotating display code; facility/room/apparatus targets encoded as app routes                                                                                                        | `facilities.view_sensitive` is read-only and must be explicitly granted; editing still requires edit/manage. Bulk QR directory is restricted, codes are tenant-bound, and regeneration invalidates the previous code. Captain-like labels alone do not grant sensitive access.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Admin hours / dashboard                   | Station-board dashboard; admin-hours summary charts and category editor                                                                                                   | admin-hours/report services; dashboard stat/card data                                                                          | Calendar-year totals, category totals, requirement thresholds and reporting periods                                                                                                                              | Calendar-year reporting is distinct from rolling periods. Category visualization separates configured categories correctly. Mobile cards/breadcrumbs/buttons retain 44px targets. Conditional dashboard panels should not be documented as always present.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Messaging / notifications                 | Pending/persistent dashboard message card; inbox; notification page                                                                                                       | `/api/v1/messages/*`, notification service, scheduled task cleanup                                                             | Read/ack state, persistent/pinned flags, audience lists, related entity/action IDs                                                                                                                               | Every targeted department message is emailed best-effort at every priority; urgent adds eligible SMS. Dashboard excludes handled messages on the next load but preserves persistent notices. Invalid/empty audiences and irrelevant audience fields are rejected/cleared. Read/ack writes fail closed for inactive, expired, deleted, or future messages. Completing event/scheduling actions archives related notifications, with filtering performed in the database.                                                                                                                                                                                                                                           |
| Integrations                              | Integrations page, Salesforce readiness/preview/sync                                                                                                                      | `/api/v1/integrations/*`; Salesforce, Slack, Teams, Discord services                                                           | Encrypted client secret, external IDs, retry/backoff state, pagination cursor, redacted webhook diagnostics                                                                                                      | Secrets are not returned or logged. Salesforce retries transient failures, preserves pagination, scopes sync to org, and rejects unsafe/missing configuration. Webhook logs redact tokens and sensitive payload fields.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Auth, audit, errors, privacy              | Login/OAuth/MFA, error reference page, audit/error logs, personal data export                                                                                             | auth refresh/OAuth; `/api/v1/errors/codes`; audit shipping                                                                     | Rotating refresh token family; OAuth MFA state; `AUDIT_LOG_LEGACY_MAX_ID`; `LB-*` support code and UTC diagnostic timestamp; guest/applicant retention fields; private archive modes; training export visibility | Refresh replay revocation commits before 401 and inactive organizations cannot refresh. Account reset cannot affect a more privileged account. OAuth cannot bypass MFA. API errors expose stable support codes but not sensitive internals. Audit ship destinations are validated before dispatch and legacy hash exceptions are bounded by operator config. Transfers/anonymization scrub applicant data and malformed retention settings fail conservatively. New audit archives use `0700` directories/`0600` files, and personal exports omit officer-only training fields when result visibility is disabled.                                                                                                |
| Deployment / backup / public portal       | Docker/Unraid installation and recovery runbooks                                                                                                                          | compose, nginx, install/backup scripts; public display/portal API                                                              | TLS flags, backup artifact/key separation, API-key hashes, public timestamp normalization                                                                                                                        | Production transport TLS fails closed unless explicitly overridden. Backup scripts preserve pipeline exit failures and safe extraction. Public portal API keys fail closed; timestamps are timezone-aware. WebSocket/external URL and upload/MIME validation reject unsafe origins, schemes, sizes, or spoofed content.                                                                                                                                                                                                                                                                                                                                                                                           |
| Shared frontend / accessibility           | Navigation, personal/organization dashboard tabs, member directory/scanner, command palette, forms, mobile layouts, labels                                                | API client and service adapters                                                                                                | Organization-keyed rank/settings caches; route query/tab state; normalized API error payload                                                                                                                     | Admin navigation uses centralized permissions. Redacted directory/profile access uses `members.view`; scanning requires `users.view` or `members.manage`; dashboard personal and organization data remain separated. Redundant mobile menus were removed; hamburger/dashboard controls preserve touch targets. Skip link/live announcements and skill-test state are truthful. Form fields retain dependent-value validation and readable contrast.                                                                                                                                                                                                                                                               |

### Alembic route (upgrade data path)

Run migrations in the repository's single-head order; never select them by
filename alone. The window adds or materially changes these revisions:

1. `20260805_0004_public_portal_timestamps_to_datetime` — normalizes public
   portal timestamps (an older revision changed in this window).
2. `20260812_0001_add_saved_ballot_templates` — saved ballot structure table.
3. `20260812_0002_add_skill_test_resume_count` — initial resume counter.
4. `20260812_0003_restore_active_prospect_uniqueness` — restores the active
   prospect uniqueness constraint without mutating released history further.
5. `20260812_0004_fail_closed_public_portal_api_keys` — secure API-key state.
6. `20260813_0001_add_shift_template_vehicle_fields` and
   `20260813_0002_add_apparatus_crew_positions` — apparatus/shift linkage.
7. `20260813_0006_backfill_training_config_result_visibility` and
   `20260813_0007_reconcile_skill_test_resume_count` — safe training defaults
   and reconciliation for installations that saw an earlier branch revision.
8. `20260813_0008_backfill_facilities_view_sensitive` — explicit sensitive
   facility read permission.
9. `20260813_0009_add_manual_batch_ballots_cast` — physical ballot turnout.
10. `20260813_0010_add_scheduling_module_configs` — per-org shift settings.
11. `20260813_0011_add_event_mandatory_membership_types` — configured event
    eligibility tiers.
12. `20260814_0001_add_store_open_banner_setting` — banner visibility.
13. `20260814_0002_saved_ballot_election_settings` — completes template
    snapshots with election settings while preserving its published identity.
14. `20260814_0003_reconcile_active_prospect_emails` — moves destructive
    reconciliation out of the previously released uniqueness revision while
    preserving its published identity.
15. `20260814_0004_revoke_captain_facilities_view_sensitive` — removes the
    unintended system Captain grant and joins the event-reminder branch with
    the published saved-ballot/reconciliation chain, leaving one head.

**Required duplicate preflight before `alembic upgrade head`:** revision
`20260812_0003` creates the active-email unique index before the later
reconciliation revision can run. First identify collisions using the same
normalized key that reconciliation uses:

```sql
SELECT organization_id, LOWER(TRIM(email)) AS normalized_email, COUNT(*) AS active_rows
FROM prospective_members
WHERE status = 'active' AND email IS NOT NULL
GROUP BY organization_id, LOWER(TRIM(email))
HAVING COUNT(*) > 1;
```

If this returns rows, stop the upgrade. For each organization/email group,
select the canonical record with the earliest `created_at` (then lowest `id`),
review linked application data, and set every other row to `inactive`. Re-run
the query and require zero rows before upgrading. Do not delete prospects or
assume `20260814_0003` can repair the collision after the index creation has
already failed.

**Upgrade edges:** take a database backup; run `alembic heads` and require one
head; run `alembic upgrade head`; do not downgrade to “repair” a fork. The
reconciliation migration can merge active duplicate-email state, so operators
should review its log before and after rollout. Saved templates created between
the two template migrations receive safe defaults. Permission backfills grant
only the intended read capability and do not imply edit rights.

### End-to-end data paths and sharing boundaries

- **Saved ballot:** manager UI → election service API → strict schema →
  organization-owned template row → template picker → fresh ballot item IDs.
  No vote-bearing object crosses the boundary.
- **Outreach form:** event settings → administrator-scoped discovery endpoint →
  public-outreach forms only → event request link → public submission path.
  Public users never receive the administrative form catalog.
- **Training linkage:** event/session editor → session linkage PATCH → owned
  requirement/course/program IDs → member progress/compliance calculations.
  Cross-org and mismatched-program links are rejected.
- **Shift/apparatus:** org scheduling settings + rank catalog → template crew
  position → apparatus assignment/check-in → completion report. Rank IDs are
  canonical; display names are presentation data and legacy fallback only.
- **Store order:** member storefront → product/variant lock → order → selected
  external payment method → administrator status/activity aggregates. The app
  records payment state but does not become the payment processor.
- **Related notification:** originating event/request action → notification with
  entity/action identifiers → completion endpoint → database-scoped archive.
  Unrelated notifications and other organizations are untouched.
- **Salesforce:** org integration settings → decrypted secret in process only →
  readiness/preview → paginated sync with external IDs → local member/prospect
  records. Logs and API responses carry redacted diagnostics, not credentials.
- **Support error:** exception → public `LB-*` code + request metadata → Error
  Monitoring/code reference → operator troubleshooting. Private exception and
  PII remain server-side.

### Documentation and media disposition

Training guides changed throughout this window. Any new training paragraph must
use an explicit marker until a verified capture exists:

> **[SCREENSHOT NEEDED — describe the exact state/control and required demo data]**

The immediate capture queue is: the saved-ballot picker’s visible name/count/warning/actions plus a separate before/apply/after settings sequence;
manual-paper ballot count; station-board dashboard; admin-hours summary and
category editor; store dashboard counts/order filters/open-banner toggle; inventory temporary-issue deadlines, stock arithmetic, and import failure; Room
QR directory plus regenerated-code warning; apparatus rank-backed crew seats;
event outreach-form picker; training-session requirement/program linkage; and
a related notification before/after auto-archive. Mobile variants are required
where the header, dashboard card, breadcrumb, or primary action appears.

Existing images containing the old dashboard, old admin-hours summary, old
store admin, Ballot Builder without saved settings, apparatus free-text crew
positions, old event-settings form picker, or pre-directory QR navigation are
**REPLACE** candidates. Do not overwrite an image until it has been opened and
checked against its caption; preserve its identifier so guide links remain
stable. The detailed queue lives in
[`training/SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md).

YouTube scripts requiring edits before recording are: **01/03** (production TLS
and upgrade path), **04/06** (station-board/dashboard visuals and conditional
cards), **07** (notification auto-archive and message delivery wording), **12**
(saved ballot settings/manual paper count/validation), **13** (store dashboard,
filters, member payment method, banner), **14/15/16** (session linkage, scoring,
resume/result rules), and **08** (QR rotation/download short). See
[`youtube-scripts/SCRIPT_CURRENCY.md`](./youtube-scripts/SCRIPT_CURRENCY.md).

### Verification checklist

- Compare the exact manifest to the release branch; a later merge requires a
  new audit rather than silently extending this window.
- Validate a single Alembic head and upgrade a copy of pre-window data.
- Exercise each new endpoint with same-org, cross-org, missing-permission,
  legacy-row, and concurrent-write cases.
- Verify desktop and 375px layouts, keyboard focus, 44px touch targets, empty
  states, loading states, and API failures.
- Re-capture every **REPLACE** image and clear every **SCREENSHOT NEEDED** marker
  only after visual/caption review.
- Update script timings after inserting new chapters; timestamp drift is an
  editorial defect even when narration is correct.

## Six-day change and connection audit — 2026-08-10 through 2026-08-16

**Audit window:** 2026-08-10 00:00 UTC through 2026-08-16 (inclusive)
**Baseline:** `fddbdbc1e548d0e0f74811a358e6b507a7a96fd5` (last commit before the window)
**Audited head:** `3872361886779554ce3f0f081c455653c6c7e7e0`
**Volume:** 504 non-merge commits, 1,517 net changed paths, **28** Alembic
revisions, 5 new authenticated routes, **3** new models, 37 new endpoint
handlers in 1 new endpoint module plus existing ones.

> **How the commit count is derived**, since the obvious alternatives disagree:
> `git log --since="2026-08-10 00:00" --no-merges` reachable from the audited
> head — **504**. Filtering the same range by _committer_ date instead gives the
> same 504. The unfiltered range `baseline..head` contains **508** non-merge
> commits; the four extra carry author dates before the window (rebased or
> cherry-picked work that landed inside it). Counting merges as well gives 802.
> 504 is the figure for _authored-in-window, non-merge_ work, which is what the
> rest of this document describes.

This is the six-day rollup the release asked for. It **supersedes nothing** — it
is the wider frame around the
[three-day audit](./CHANGE_AUDIT_2026-08-12_TO_14.md), which remains the
authoritative record for 08-12 → 08-14 and holds the per-area connection map,
its 879-path manifest, and its own verification checklist. Read that document
for the middle of the window; read this one for the two days on either side of
it and for the cross-window views (routes, client storage, the full Alembic
route) that a three-day frame could not show.

> **What this pass actually added.** The 08-10 → 08-11 tranche was already in the
> CHANGELOG at the time of writing, and 08-12 → 08-14 had a dedicated audit. The
> genuinely undocumented material was **2026-08-15 → 08-16** (onboarding session
> storage, the root application canvas, one screenshot finding), plus four
> cross-window trackers that had drifted: the Alembic head banner, the page
> reference's missing routes, the onboarding storage description, and the
> public-page canvas troubleshooting entry. Those are corrected at their source
> and summarized here. Nothing in this document is a claim that a screen was
> photographed or a script was recorded — see
> [Documentation and media disposition](#documentation-and-media-disposition).

### Window at a glance

| Sub-window        | Character                                                                                                                                                                                                       | Where it is recorded                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **08-10 → 08-11** | Feature weight: the supply loop (shelf ↔ truck), the email footer library, the Learning Center, skills-testing print/return-for-correction, a phone-width sweep across every page, the split TypeScript install | CHANGELOG entries dated 08-10 / 08-11; this document's release map                       |
| **08-12 → 08-14** | Security, permissions, elections, dashboard split, storefront, QR, scheduling settings                                                                                                                          | [`CHANGE_AUDIT_2026-08-12_TO_14.md`](./CHANGE_AUDIT_2026-08-12_TO_14.md) — authoritative |
| **08-15 → 08-16** | Client-side hardening and one global style ownership move; no backend, schema, route, or permission change                                                                                                      | This document; CHANGELOG entry dated 2026-08-15                                          |

### 2026-08-15 → 08-16 in full

Two behavioral changes and one documentation finding. Both behavioral changes are
frontend-only: **no endpoint, schema, model, migration, or permission changed**,
so no upgrade step and no API contract movement accompanies them.

#### Onboarding session identifiers are tab-scoped

`frontend/src/modules/onboarding/services/api-client.ts` moved the onboarding
session identifier from `localStorage` to `sessionStorage`.

| Item           | Before                                                            | After                                     |
| -------------- | ----------------------------------------------------------------- | ----------------------------------------- |
| Storage key    | `localStorage['onboarding_session_id']`                           | `sessionStorage['onboarding_session_id']` |
| Lifetime       | Until explicitly cleared — survived browser restarts indefinitely | Ends with the tab or the browser session  |
| Reach          | Every tab and window on the origin                                | The one tab that created it               |
| CSRF companion | `onboarding_csrf_token`, `SameSite=Strict` cookie (unchanged)     | unchanged                                 |
| Wizard answers | `localStorage['onboarding-storage']` (Zustand persist)            | **unchanged — still localStorage**        |

**Why it matters.** The identifier is a bearer credential: presented as
`X-Session-ID`, it authorizes the setup mutations that create the organization,
stations, apparatus, the IT team and the first System Owner. A bearer credential
that outlives the browser session on a shared or kiosk machine is a standing
grant to finish somebody else's installation.

**Connection points.** `X-Session-ID` header → `get_or_create_session()` /
`validate_session()` in `backend/app/api/v1/onboarding.py` → the
`onboarding_sessions` row. Server-side TTL is **30 minutes, sliding**
(`SESSION_EXPIRY_HOURS = 0.5`; every authenticated activity pushes `expires_at`
forward). The client change narrows the window the client keeps the identifier;
it does not change the server's.

**Legacy cleanup.** `loadSession()` deletes any `localStorage`-persisted
`onboarding_session_id` at construction, and `clearSession()` deletes both
locations. A browser that ran the previous build therefore drops its stale
identifier on the first page load of the new build, and `hasSession()` correctly
reports `false` rather than presenting an identifier the client no longer tracks.

**Edge cases — these are the ones to teach, not the mechanism:**

- **A second tab does not inherit the wizard.** Opening `/onboarding` in a fresh
  tab starts a _new_ server session; a step that requires an established session
  answers `401` with error code `ONBD_SESSION_INVALID`. (A _duplicated_ tab is
  the exception — Chrome and Firefox copy `sessionStorage` into a duplicate, so
  it does carry the identifier. Do not teach tab duplication as a supported
  resume path; it is browser behavior, not a product guarantee.)
- **Closing the browser mid-wizard ends the run.** The identifier is gone, and
  after 30 minutes of inactivity so is the server row.
- **The wizard can look resumable when it is not.** `onboarding-storage` is still
  `localStorage`, so re-opening `/onboarding` after a restart repaints the
  answers already typed. The next mutating step is the one that fails, with
  `ONBD_SESSION_INVALID`. Installers should be told to finish onboarding in one
  sitting, in one tab, and that re-typing answers is not the recovery — restarting
  the wizard is.
- **"Onboarding has already been completed" is a different failure.** Once an
  organization row exists, `get_or_create_session()` refuses new sessions with
  `403` / `ONBD_ALREADY_COMPLETED`. An installer who sees this has not lost a
  session; the install is done and they should sign in.
- **Reset Progress clears everything.** `ResetProgressButton` calls
  `sessionStorage.clear()`, so it takes the identifier with it by construction.

#### The application canvas moved from `body` to `html`

`frontend/src/styles/index.css` now paints the themed gradient on the root
element and folds `scrollbar-gutter: stable` into the same rule.

The dark-mode surface tokens (`--surface-bg`, `--surface-secondary`) are
**translucent white** by design — they are built to composite over the gradient.
`scrollbar-gutter: stable` reserves its gutter on `html`, **outside the body
box**, so painting only `body` left that reserved strip showing the browser's
default canvas: a bright seam down the right edge of every page in dark mode.
Painting the gutter a solid fallback colour instead would have produced a
different seam beside the gradient. The root owns the canvas because the root
owns the gutter.

**Blast radius: every route, authenticated and public.** This is a global style
rule, which is precisely why it is a screenshot problem — see
[Documentation and media disposition](#documentation-and-media-disposition).

**Edge cases:**

- **Public routes were the original reason the canvas exists.** `/f/:slug`,
  ballot voting and `/application-status/:token` render outside `AppLayout`.
  Any new public route must use the gradient utility, not
  `bg-theme-surface-secondary` — that token is correct only inside `AppLayout`.
- **It silently broke the print pages' background contract — two defects, both
  fixed 2026-08-16.** CSS propagates a `body` background to the window **only**
  while the root's `background-image` is `none` and its `background-color` is
  `transparent`. Once `html` is painted, nothing on `body` propagates. **Six
  in-app print routes** (`print/template`, `print/scorecard`,
  `training/print/member`, `.../program`, `.../compliance`,
  `scheduling/shift-reports/print`) each carried their own
  `@media screen { body { background: #f3f4f6 } }` for a grey desk behind a
  white sheet, and that grey stopped reaching the canvas. Separately, the
  `@media print` reset covered `body, main, .dark` — and because `ThemeContext`
  puts `dark` on `document.documentElement`, **dark mode was covered by accident
  while light mode was not**, so printing with "Background graphics" on could put
  the gradient behind a scorecard or label. `InventoryBarcodePrintPage` and
  `LabelPrintPage` were never affected — they write into a fresh iframe.

  Fixed by `components/print/PrintPageStyles`, which all six routes now render:
  it marks the root so one `html.print-preview` rule beside the canvas rule
  supplies the desk, and `html` is now named in the print reset.
  `PrintPageStyles.test.tsx` guards all three invariants. **The duplication was
  the real defect** — six copies of a rule, none naming what they depended on.

- **`overscroll-behavior: none` stayed on `body`** — iOS bounce suppression is a
  body concern and was deliberately not moved.

#### Screenshot finding, 08-16

`GET /training/programs/programs/{id}` returns phases with `name`,
`phase_number`, `prerequisite_phase_ids`, `requires_manual_advancement` and
`time_limit_days` — and **no requirements**. The per-phase fractions in
`01-membership.md:1282`'s caption ("Phase 1, Complete, 4/4") therefore cannot come
from the program detail screen; they belong to a member's enrolment view. Recorded
in [`training/SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md).
Established from the API shape alone — the screen has not been opened yet.

### Routes added in this window

These five routes were live at the audited head. All were absent from
`APPLICATION_PAGES.md` until this pass; they are now listed in their module
sections there.

| Route                                      | Page                        | Gate                                                                           | Notes                                                                                                                                                                      |
| ------------------------------------------ | --------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/learning`                                | Learning Center             | **Authenticated**                                                              | In-app guide index; sits beside `/dashboard` inside `AppLayout`                                                                                                            |
| `/locations/qr-codes`                      | Check-In QR Codes           | `locations.manage` **OR** `facilities.manage`                                  | Search, print signs, PNG download, inline room QR; prefetched by `routePrefetch.ts`                                                                                        |
| `/scheduling/apparatus-inventory`          | Apparatus Inventory         | `equipment_check.submit` **OR** `equipment_check.view` **OR** `inventory.view` | Deliberately crew-level: recording what you just used is the point                                                                                                         |
| `/training/skills-testing/print/template`  | Blank skill sheet (print)   | **Authenticated**                                                              | Empty form, no member data; the backend's template fetch enforces visibility and org scope                                                                                 |
| `/training/skills-testing/print/scorecard` | Completed scorecard (print) | **Authenticated**                                                              | The backend redacts to the reader's disclosure level before the data leaves the server; gating on `training.manage` would instead block members printing their own results |

**The permission shape is the documentation.** Three of the five are
authenticated-only on purpose, and in two of those the real access control is
server-side redaction rather than a route gate. Documenting them as "open to
everyone" would be wrong; documenting them as officer-only would be equally
wrong and would send departments looking for a permission to grant.

### Models and data points

**Three** new models in the window. Only one of them arrived in a new file, which
is why a file-level count undercounts them — the other two were added to existing
domain modules:

| Model                                                                    | Table                       | Revision        | Purpose                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------ | --------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SchedulingModuleConfig` (new file `models/scheduling_module_config.py`) | `scheduling_module_configs` | `20260813_0010` | Per-organization shift settings, cached and keyed by org. Served by the window's one new endpoint module, `endpoints/scheduling_module_config.py`, at `/api/v1/scheduling/shift-settings` GET/PUT/DELETE — all three resolve the org from `current_user.organization_id`, never from client input |
| `CheckItemDeployedLot`                                                   | `check_item_deployed_lots`  | `20260810_0008` | One row per lot's presence on one checklist position — the record that makes "soonest expiration aboard" representable                                                                                                                                                                            |
| `SavedBallotTemplate`                                                    | `saved_ballot_templates`    | `20260812_0001` | Org-scoped reusable ballot **structure**; carries no candidates, rosters, votes, tokens, or attendance                                                                                                                                                                                            |

Across the window **37 new endpoint handlers** were added, the large majority on
existing routers rather than the one new module.

Columns and settings added across the window, grouped by the question they let a
user answer:

| Data point                                                                             | Revision                                                         | Question it answers                                                                                                 |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `check_item_deployed_lots` (table)                                                     | `20260810_0008`                                                  | Which lots, with which dates, are on this position right now — and what is the _soonest_ date aboard                |
| `check_template_items.quantity_on_truck`                                               | `20260810_0007`                                                  | How many are actually aboard, as distinct from how many should be. **NULL means never counted**, not zero           |
| `check_template_items.restock_needed` + `restock_reported_by` / `_at` / `restock_note` | `20260810_0006`                                                  | Who used the last one, when, and what they said about it                                                            |
| `shift_equipment_check_items.expiration_found`                                         | `20260810_0005`                                                  | The replacement's expiration date, written back on submit — the missing counterpart to `serial_found` / `lot_found` |
| `email_templates` default-CSS tracking + `footer_key`                                  | `20260810_0003`, `_0004`                                         | Which footer a template uses, out of a library instead of 35 copies                                                 |
| optional equipment-kit items                                                           | `20260811_0001`                                                  | Which kit contents are required and which are optional                                                              |
| skill-test return trail; `resume_count`                                                | `20260811_0002`, `20260812_0002` (reconciled by `20260813_0007`) | Who returned a result for correction, and how many times a test was resumed                                         |
| `SavedBallotTemplate` (+ election settings)                                            | `20260812_0001`, `20260814_0002`                                 | Ballot _structure_ only — never candidates, rosters, votes, tokens, or attendance                                   |
| active-prospect email uniqueness + reconciliation                                      | `20260812_0003`, `20260814_0003`                                 | One canonical active applicant per email per organization                                                           |
| shift-template vehicle fields; apparatus crew positions                                | `20260813_0001`, `_0002`                                         | Which rank a crew seat requires, by rank ID rather than free text                                                   |
| training result-visibility default                                                     | `20260813_0006`                                                  | Whether a trainee sees officer-entered evaluation fields                                                            |
| `facilities.view_sensitive` backfill, then Captain revocation                          | `20260813_0008`, `20260814_0004`                                 | Who may _read_ sensitive facility sections — read-only, and not implied by a Captain label                          |
| `manual_batch_ballots_cast`                                                            | `20260813_0009`                                                  | Physical-ballot turnout, separately from electronic                                                                 |
| event mandatory membership types; reminder target                                      | `20260813_0011`, `20260813_0020`                                 | Which tiers an event is mandatory for; who a reminder goes to (`going` / `all` / `none`)                            |
| `show_store_open_banner`                                                               | `20260814_0001`                                                  | Whether the storefront announces that it is open                                                                    |

### Alembic route (upgrade data path)

Single head at the audited commit: **`20260814_0004`**. Run the chain in
repository order; never select revisions by filename.

```
20260809_0002  preserve released revision          (dated 08-09, added inside this window)
20260810_0001  encrypt medical-screening PHI
20260810_0002  score pass/fail criteria            (merge: 20260810_0001 + 20260809_0002)
20260810_0003  email templates track default CSS
20260810_0004  email_templates.footer_key
20260810_0005  shift_equipment_check_items.expiration_found
20260810_0006  check_template_items.restock_needed + reporter/note
20260810_0007  check_template_items.quantity_on_truck
20260810_0008  check_item_deployed_lots            (migrates existing single-lot data across)
20260811_0001  optional equipment-kit items
20260811_0002  skill-test return trail
20260812_0001  saved_ballot_templates
20260812_0002  skill-test resume counter
20260812_0003  restore active-prospect uniqueness  ← PREFLIGHT REQUIRED, see below
20260812_0004  fail closed on public-portal API keys
20260813_0001  shift-template vehicle fields
20260813_0002  apparatus crew positions
20260813_0006  backfill training result-visibility
20260813_0007  reconcile skill-test resume count
20260813_0008  backfill facilities.view_sensitive
20260813_0009  manual_batch_ballots_cast
20260813_0010  scheduling module configs
20260813_0011  event mandatory membership types
20260813_0020  event reminder target               (branch off 20260813_0010)
20260814_0001  store open-banner setting
20260814_0002  saved-ballot election settings
20260814_0003  reconcile active-prospect emails
20260814_0004  revoke Captain facilities.view_sensitive
               (merge: 20260814_0003 + 20260813_0020 → single head)
```

Two revisions carry renumbering history worth knowing before an operator reads a
mismatched filename as corruption: **`20260810_0005`–`_0008` were renumbered from
`_0003`–`_0006`** after `main` landed the email-template pair on the same date,
and **`20260813_0006`–`_0011`** likewise absorbed a branch collision. The
published identities of `20260814_0002` / `_0003` were deliberately preserved
when their destructive work was moved — see the three-day audit.

**Required preflight before `alembic upgrade head`.** `20260812_0003` creates the
active-email unique index _before_ `20260814_0003` can reconcile anything. Run:

```sql
SELECT organization_id, LOWER(TRIM(email)) AS normalized_email, COUNT(*) AS active_rows
FROM prospective_members
WHERE status = 'active' AND email IS NOT NULL
GROUP BY organization_id, LOWER(TRIM(email))
HAVING COUNT(*) > 1;
```

Rows returned is a hard stop. Per group, keep the earliest `created_at` (then
lowest `id`) after reviewing linked application data, set the others `inactive`,
and require a zero-row re-check. Do not delete prospects, and do not assume
`20260814_0003` can repair a collision after index creation has already failed.

**Upgrade edges:** back up first; `alembic heads` must return exactly one; run
`alembic upgrade head`; **never downgrade to repair a fork**. Installations that
saw an interim skill-resume or saved-ballot revision are reconciled by the later
_forward_ migrations. Permission backfills grant a **read** capability only and
never imply edit rights.

### End-to-end data paths and sharing boundaries

The three-day audit records the 08-12 → 08-14 paths (saved ballot, outreach
form, training linkage, shift/apparatus, store order, related notification,
Salesforce, support error). The paths this wider window adds:

- **Supply loop (08-10).** Delivery → `POST /inventory/lots/bulk` (all-or-nothing,
  every item validated in the caller's org) → shelf lot → **Swap** draws N units
  onto a position → `check_item_deployed_lots` row snapshots lot number and
  expiration → the position's on-truck count is the **sum** of its lots and its
  expiration the **earliest** of them → supply worklist, apparatus inventory
  page, equipment-check form and item-to-apparatus lookup all read that derived
  minimum. The snapshot is deliberate: shelf lots get consumed and deleted, and
  what is on a truck must stay answerable after the shelf record is gone.
- **Restock report (08-10).** Crew presses **Minus** on the apparatus page at
  03:00 → count drops _and_ `restock_needed` rises with reporter, timestamp and
  note → the supply worklist shows it beside expiring items, because "expires
  Thursday" and "the crew used it last night" are the same job to a supply
  officer.
- **Field replacement (08-10).** Equipment check writes back `serial_found`,
  `lot_found` **and now `expiration_found`** → the found date lands on the
  template item on submit. Without it, an expired item was force-failed on every
  submission, held its apparatus in a deficiency state, and never left the
  worklist.
- **Onboarding session (08-15).** Wizard tab → `sessionStorage` identifier +
  `SameSite=Strict` CSRF cookie → `X-Session-ID` → `onboarding_sessions` row with
  a 30-minute sliding TTL → setup mutations. **The identifier never reaches
  another tab, another window, or the next browser launch.** The wizard's
  non-sensitive answers travel a separate, longer-lived path
  (`localStorage['onboarding-storage']`), which is why the two can disagree.

**Sharing boundaries unchanged by 08-15 → 08-16.** Neither change moves an
organization boundary, a permission, or a field's visibility. The onboarding
change _narrows_ a client-side grant; the canvas change is presentational.

### Client-side storage map

Recorded because the 08-15 change is only legible against the whole map, and
because "which of these is a credential" is the question that decides where a
value may live.

| Value                             | Location                               | Lifetime          | Sensitivity                                                                             |
| --------------------------------- | -------------------------------------- | ----------------- | --------------------------------------------------------------------------------------- |
| Auth tokens                       | **httpOnly cookies only**              | Server-controlled | Never JS-readable — see CLAUDE.md                                                       |
| `has_session`                     | `localStorage`                         | Until sign-out    | Hint only, not a credential; `loadUser()` reads it on refresh                           |
| `csrf_token`                      | Non-httpOnly cookie                    | Session           | Double-submit pair for `X-CSRF-Token`                                                   |
| `onboarding_session_id`           | **`sessionStorage`** _(changed 08-15)_ | Tab               | **Bearer credential** for setup mutations                                               |
| `onboarding_csrf_token`           | `SameSite=Strict` cookie               | Session           | Double-submit pair                                                                      |
| `onboarding-storage`              | `localStorage`                         | Until cleared     | Non-sensitive wizard answers; session IDs and CSRF tokens are excluded from persistence |
| `navigationLayout`, branding keys | `localStorage` / `sessionStorage`      | Mixed             | Presentation only                                                                       |

### Documentation and media disposition

#### Screenshots

Any new training paragraph must carry an explicit marker until a verified
capture exists:

> **[SCREENSHOT NEEDED — describe the exact state/control and required demo data]**

**New to this pass (08-15 → 08-16):**

- **REPLACE — 39 images carry the old gutter strip; one is worth re-shooting.**
  All 429 training images were checked with
  `scripts/screenshots/audit_images.py --check edges`. The single `theme: "dark"`
  capture (`10-11-public-form-dark`) is **stark** — its white strip becomes a dark
  gradient — and should be re-shot. The other 38 are light-mode pages under a
  **dark modal overlay**: the overlay dims the viewport but sits inside `body`,
  so the gutter stayed white behind it. On those the strip goes white to _pale_
  gradient at 15px; fold them in whenever the shot is re-taken for another reason.
  **Correction:** an earlier version of this bullet said "exactly three". That
  scan pre-filtered on whole-image brightness, which assumed the defect was a
  dark-mode one and hid every modal capture. The script compares the edge with the
  content beside it instead — see `scripts/screenshots/README.md`.
- **SCREENSHOT NEEDED — the onboarding session-expiry state.** The wizard
  reporting `ONBD_SESSION_INVALID` after a restart, so the guide can show the
  installer what "start over" looks like rather than describing it. Demo data:
  a part-finished onboarding run, the tab closed and reopened.
- **SCREENSHOT NEEDED — a public route in dark mode** (`/f/:slug` or
  `/application-status/:token`) at full window width, as the standing proof that
  the canvas covers routes outside `AppLayout`.

The 08-12 → 08-14 capture queue and REPLACE list are unchanged and remain in
[`training/SCREENSHOT_CURRENCY.md`](./training/SCREENSHOT_CURRENCY.md), which is
the working queue. Do not overwrite an image until it has been opened and checked
against its caption, and preserve its identifier so guide links stay stable.

#### YouTube scripts

Flagged by 08-15 → 08-16, in
[`youtube-scripts/SCRIPT_CURRENCY.md`](./youtube-scripts/SCRIPT_CURRENCY.md):

- **02 — First-Time Setup & Onboarding — this one was _wrong_, not merely
  incomplete, and has been corrected in the script.** Chapter 2's Welcome Screen
  narration told viewers _"the wizard auto-saves your progress, so if you need to
  step away or your browser closes, you'll pick up right where you left off."_
  That is false as of 08-15 and was misleading before it — the server session has
  always expired after 30 minutes idle. Recorded, it would have been the
  expensive kind of error: a viewer does exactly what the narrator says and loses
  their install. Replaced with the one-tab/one-sitting caution and the
  refilled-form trap; **all timecodes from Chapter 2 onward re-time**
  (~45–70 seconds added). Also re-plan any B-roll showing the presenter leaving
  the wizard and returning — that shot now fails on camera.
- **01 / 03 — Installing / IT Manager.** Same caution where the install walkthrough
  hands off between screens.
- **Any script with full-screen dark-mode B-roll** recorded before 08-15 shows the
  unpainted gutter. Re-shoot only if the seam is visible in frame; it is an edit
  decision per clip, not a re-record of the script.

The 08-12 → 08-14 script queue (01/03 TLS and upgrades, 04/06 dashboard, 07
notifications and message delivery, 12 elections, 13 storefront, 14/15/16
training and skills, 08 QR short) is unchanged.

### Verification checklist

- Confirm `alembic heads` returns exactly one head (`20260814_0004`) and upgrade
  a **copy** of pre-window data; run the active-prospect preflight first.
- Exercise each route in [Routes added in this window](#routes-added-in-this-window)
  with same-org, cross-org, missing-permission, and unauthenticated cases —
  particularly the two print routes, where the control is server-side redaction
  rather than the route gate.
- Onboarding: complete a run in one tab; then confirm a second tab does **not**
  inherit it; then confirm a browser restart yields `ONBD_SESSION_INVALID` on the
  next mutating step rather than a silent half-write; then confirm an
  already-installed instance answers `ONBD_ALREADY_COMPLETED`.
- Load a public route (`/f/:slug`, ballot voting, `/application-status/:token`)
  in dark mode at a window narrow enough to scroll, and confirm no seam at the
  right edge.
- Print a scorecard and a label with "Background graphics" **on**, in **light**
  mode, and confirm a white page; then open a print route in dark mode on a
  tall window and confirm the grey desk reaches the edges. Both were broken
  between 08-15 and 08-16 and are guarded by `PrintPageStyles.test.tsx`.
- Verify desktop and 375px layouts, keyboard focus, 44px touch targets, empty
  states, loading states, and API failures.
- Clear a **SCREENSHOT NEEDED** marker only after the image is opened and read
  against its caption. Re-time script chapters after inserting narration;
  timestamp drift is an editorial defect even when the words are right.
