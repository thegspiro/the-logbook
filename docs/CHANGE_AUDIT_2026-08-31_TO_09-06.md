# Change audit: August 31 – September 6, 2026

Net changes merged to `main` in the seven days ending 2026-09-06, picking up
where the [August 24–31 audit](./CHANGE_AUDIT_2026-08-24_TO_31.md) stopped at
`9445bc44` (PR #2083, 2026-08-31 00:10 EDT).

**211 pull requests (#2078 – #2304).** Thirty-four schema migrations, head
`d7c1b95e2a40`. **Two modules changed address** — equipment checklists moved
out of Scheduling into Inventory, and scheduling administration moved into the
Administration section — which between them **retire fourteen URLs with no
redirect**. One integration a department has never seen (the Claude MCP
server, off by default). Two email platforms that **had never been able to
send** now send. And a long run of **permission repairs on seeded positions**,
tracing one root cause: the old onboarding wizard wrote a heuristic's output
over the permission registry's own seeded rows.

**123 changelog sections** carry a date inside this window. That is the number
to quote when somebody asks how much moved; the release map below groups them.

Companion operator lesson:
[`training/20-september-2026-release-changes.md`](./training/20-september-2026-release-changes.md).
Wiki handoff:
[`Recent-Changes-2026-08-31-to-09-06`](../wiki/Recent-Changes-2026-08-31-to-09-06.md).
Media disposition — which screenshots must be created, which replaced, and
which YouTube takes need rewriting — is in [Documentation and media
disposition](#documentation-and-media-disposition) below.

## Read this first

Five things in this window change what an operator or integrator must do,
rather than just what they see:

1. **Fourteen URLs stop resolving, and there is no redirect for thirteen of
   them.** Equipment checklists moved from Scheduling to Inventory (eight
   URLs) and scheduling administration moved under `/scheduling/admin` (six).
   A bookmark, a link in a previously-sent email, or a notification already
   sitting in a member's bell lands on the dashboard — silently, because the
   catch-all redirect succeeds. `/store/admin` is the one exception: it
   redirects to `/inventory/admin/store`. The full before/after tables are in
   [Retired URLs](#retired-urls).

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

## Release map

| Area                                                              | PRs                                                      | Pages / connection points                                                                                                                                                                                                                                                         | API / data points                                                                                                                                                                                                                                                                                                                    | Boundary and edge cases                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Equipment checklists move to Inventory**                        | #2110, #2113, #2115, #2116, #2122, #2123, #2126, #2129   | **`/inventory/checklists`** (crew), `/inventory/checklists/my`, `/inventory/checklists/log`, `/inventory/checklists/apparatus/{id}`, `/inventory/checklists/apparatus-inventory`; **`/inventory/admin/checklists`** and its `templates`, `reports`, `supply`, `settings` children | Permission rename `equipment_check.*` → `inventory.check_*` (`ff8076f4987a`); `7e2f11397849` re-enables the Inventory module where checks are in use; new table `shift_template_equipment_checks` (`191a99d1d16f`); `shifts.template_id` (`fab0ab7897d3`); `4e7e125cb00f` drops `scheduling_module_configs.equipment_check_settings` | A checklist is a list of inventory items, so it now lives with them. **Crews are unaffected at the point of use** — check-in and the shift detail panel still offer "Start checklist", and finalization still refuses to close on outstanding end-of-shift checks. What moved is authoring, reporting and the fleet views. The Equipment Checks tab is **gone from the shift screen**; members find checks under Operations → **My Checklists**, officers under **Fleet Readiness**. **Checklists now require the Inventory module** — a department that had switched it off has it switched back on automatically _if it uses checks_; switched off deliberately afterwards, the tab disappears rather than erroring. A shift template can now **name the checklists its shifts carry**; naming none keeps apparatus-based resolution, so nothing changes until a department uses it. Four settings that were stored, echoed and **read by no code** are removed                                                                                                                                                              |
| **Scheduling administration moves into Administration**           | #2263, #2267, #2272, #2277, #2285                        | **`/scheduling/admin`** (hub), `/planning`, `/planning/templates`, `/planning/patterns`, `/reports`, `/platoons`, `/positions`, and six `/settings/<section>` routes                                                                                                              | `ADMIN_NAVIGATION_PERMISSIONS` gains `scheduling.manage`; `GET /scheduling/eligibility/roster` narrowed to `scheduling.manage`; `SchedulingSettingsRedirect` forwards legacy `?tab=`                                                                                                                                                 | Everything an officer administers is now in the **Administration** section beside Training Admin and Inventory Admin, not on a strip of "Officer tools" on the member-facing page. **Each settings section is its own route** — deliberately unlike Organization and Events, which mirror the section into `?tab=`; a section inside an administration hub is a destination (a hub card, a bookmark, a link from Inventory) and a `?tab=` only client state reads cannot be linked to. `CLAUDE.md`'s settings rule now records the difference so it is not "fixed" back. **Breaking:** every scheduling administration page requires `scheduling.manage`; the position roster previously also accepted `training.view_all`/`training.manage`, and the endpoint behind it did too — narrowing only the page would have revoked nothing                                                                                                                                                                                                                                                                                          |
| **Shift planning is one screen**                                  | #2277, #2285                                             | **`/scheduling/admin/planning`** — staffing gaps, with templates and patterns as sibling sections                                                                                                                                                                                 | Reuses the drawer's own assignment call; `filter_shifts_with_open_positions`                                                                                                                                                                                                                                                         | Every upcoming shift carrying fewer people than it asks for, with the assignment on the row: ten gaps was ten trips through the month grid, and is ten selections now. Surfaces the same EVOC and overtime advisories and opens the same driver-exception dialog on `LB-SCHED-001`. **What counts as short is the board's rule, taken whole** (`shiftCapacity`/`shiftStatusInfo`/`buildSeats`), so this screen cannot answer differently from the calendar — with one stated consequence: a shift naming neither positions nor a `min_staffing` is not listed here while the hub's server-side metric does count it. **Openness is judged differently from the board on purpose** — the board zeroes open seats once the member signup window closes, which would hide the shifts starting today                                                                                                                                                                                                                                                                                                                               |
| **Claude (MCP) integration**                                      | #2196 and follow-ups                                     | Integrations → Claude (MCP): connect form and Service key panel; **`/api/mcp`**                                                                                                                                                                                                   | New table `mcp_service_keys` (`c4d5e6f7a8b9`); `meeting_action_items.created_by`/`source` (`7bfe85f2e4e5`); new permission `integrations.mcp_keys`                                                                                                                                                                                   | **Off on every installation until an administrator connects it**, and it answers nothing until an IT administrator mints a service key. 51 read tools; finance totals, medical-screening _status_ and the full duty schedule are behind three per-department switches, all off by default; three write tools behind a read/write switch, also off. Tools a department has not switched on are **not listed to the client**. **One redaction boundary** (`app/mcp/redaction.py`) strips contact details, DOB, emergency contacts, photo, membership and certification numbers, login names, medical results and credentials at every depth, and scrubs every string value of emails and phone numbers so free text cannot carry them out. Stateless JSON transport — any worker answers any request, no reverse-proxy change. **Known limitation:** claude.ai custom connectors need OAuth 2.1 and The Logbook is an OAuth client, not an authorization server, so those clients use a local bridge                                                                                                                             |
| **Email: Gmail and Microsoft 365 actually send**                  | #2196, #2214                                             | Settings → Email; the onboarding email step                                                                                                                                                                                                                                       | `app/utils/email_providers.py` presets; `app/utils/microsoft_oauth.py`; `POST /organization/settings/email/test`; migration `e3a9c1d5b7f2`                                                                                                                                                                                           | Both platforms stored credentials under `google_*`/`microsoft_*` keys while `_get_smtp_config` read only `smtp_*`, so the sender resolved **no host at all** and every message failed — in preference to a working global `SMTP_*` configuration, because the org section wins when `enabled` is true. Host, port, encryption and login are now fixed by a preset resolved by **both** the sender and the connection test. **Microsoft 365 gains an Entra ID app-registration (OAuth) path** because Exchange Online is retiring Basic auth for SMTP submission; `microsoft_auth_method` is absent on every existing row and absent reads as `app_password`, so nothing changes for a working configuration. The decorative Gmail/Microsoft OAuth client-credential fields are **removed**                                                                                                                                                                                                                                                                                                                                     |
| **Inventory Administration**                                      | #2214, #2222, #2226                                      | `/inventory/admin` hub; **`/inventory/admin/store`** (moved, `/store/admin` redirects)                                                                                                                                                                                            | `GET /inventory/summary` gains `items_by_type` and `non_medical_items`, both additive and defaulted; `GET /store/orders` gains `exclude_cancelled`; `GET /inventory/members-summary` gains `userId`                                                                                                                                  | The area had **four different names**; it is **Inventory** throughout now, administered from **Inventory Admin**. Screens genuinely about gear keep the quartermaster's vocabulary — My Issued Gear, Gear Requests, Gear Kits. **Labels only: no route, permission key, module key or API value changed.** The hub opens on the three supply lines a department staffs, including **EMS Supplies**, which it previously did not link to at all despite sharing one catalog partitioned by `item_type`. The store console moved inside the hub and stopped being the one administration page outside the shared frame. Cards now carry the gate of the route they target — `checkPermission` is exact match plus module wildcard, so `inventory.manage` implies neither `inventory.view_medical` nor `inventory.check_*`, which is why the seeded Quartermaster was being shown two consoles that refused them                                                                                                                                                                                                                  |
| **Gear requests browse instead of guessing**                      | #2270, #2278, #2287, #2290, #2292                        | Gear request form; fulfil picker; request review                                                                                                                                                                                                                                  | `equipment_requests.requested_size` (`a1c7e93b2d54`); server-side eligibility filtering and size verdicts                                                                                                                                                                                                                            | The form now **loads the catalog and offers real category names**, searches category and product-group names as well as the item's own, and shows **one row per product** rather than one per stocked size. The size step **preselects from the member's own recorded sizes**, matched through the same alias table the impact planner uses. **You can now ask for gear that is out of stock or not carried at all** — the one need a quartermaster had no other way to learn about; the size travels as its own field so a request with no matching catalog row still says what was wanted. Rank- and position-restricted gear is filtered **by the server**, not by the browser after the fact — the old form disclosed the item's existence to everyone and let the member submit a request the API then refused                                                                                                                                                                                                                                                                                                            |
| **Inventory items page: the location panel agrees with its list** | #2296                                                    | `/inventory/admin/items` and its location cards                                                                                                                                                                                                                                   | `GET /items` gains `unassigned_location`; the header reads the `non_medical_items` added by #2214                                                                                                                                                                                                                                    | **Five of the nine filters did nothing** — location, size, colour, style and the vendor scope were absent from the reload effect's dependencies, so picking one changed the request the page _would_ send and never sent it; the list then updated on an unrelated reload, applying a filter nobody had just touched. That is what made the location cards impossible to reconcile. Three counting mismatches went with it: the cards **counted medical stock the list excludes** (a header of "82 items" over a list of 6), the **"Unassigned" card sent the empty string** — which is _All Locations_, so it cleared the filter it appeared to apply — and the header summed quantities across every domain over a list that counts rows and excludes medical                                                                                                                                                                                                                                                                                                                                                                |
| **Gear requests: fulfilment resolves to the variant**             | #2298                                                    | Fulfil picker                                                                                                                                                                                                                                                                     | `_product_key` / `_variant_key` / `_variant_identity`, consumed by both the grouping and the fulfilment narrowing                                                                                                                                                                                                                    | Follow-up to the request-form rebuild above, and a direct consequence of it. The catalog collapses rows sharing a product and size/colour/style into one line and **sums their availability** — that is what turns ten serialized radios into "7 available". The request then stored a single `item_id` out of that line and fulfilment narrowed to that one row, so a member could ask for ten against a line advertising ten and leave the quartermaster looking at the row holding one. Fulfilment now offers the variant's sibling rows, so the options match the availability the member was shown; a different size, colour, style, product or organization stays excluded                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Inventory: retiring is the only way to deactivate an item**     | #2301                                                    | Item edit; the retire action; medical supplies                                                                                                                                                                                                                                    | A new retire action under the medical-supplies permission; detail pages read lot-derived stock; the category-picker cap raised                                                                                                                                                                                                       | **A plain edit could take an item out of active inventory while a member still held it.** The dedicated retire action blocks deactivation on an assigned, checked-out or unreturned item and keeps the other fields consistent; the general update path had none of that, so setting an item inactive — directly, or by setting status and condition to retired — removed it from every active list and picker with no safeguards, and left it handable-out again immediately. **Editing no longer accepts either route**; retire is the only path, and it re-checks the holder immediately before deactivating, closing the window where a member could be assigned the item an instant earlier. Three knock-ons: a medical-supplies manager without broader inventory access **lost the ability to retire a medical item** (closing the gap removed their only path), an item's **detail page showed stale stock** for lot-tracked consumables where the list view already computed from dated lots, and a low internal cap silently **hid categories past it from every picker** on a department with a large category list |
| **Grants & fundraising: pagination moves to the database**        | #2251                                                    | Every grants/fundraising list                                                                                                                                                                                                                                                     | —                                                                                                                                                                                                                                                                                                                                    | Eleven list endpoints (opportunities, applications, budget items, expenditures, compliance tasks, notes, campaigns, donors, donations, pledges, fundraising events) fetched an org's **entire** matching table before selecting the requested page in application memory — so a department with years of donation or grant history scanned and loaded all of it on every page view. `skip`/`limit` now apply in the SQL. **No response shape or ordering changed** within the documented row limits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **Compliance Matrix becomes a queue**                             | #2247, #2251                                             | Training → Compliance Matrix                                                                                                                                                                                                                                                      | `GET /training/compliance-matrix` gains per-cell progress, per-requirement meta and a top-level `as_of` — **additive only**; `evaluate_member_requirement_detail()`                                                                                                                                                                  | The member × requirement icon grid is replaced by a **triage rail**: grouped by standing, worst first, with the numbers behind each status on the row ("6 of 24 hours", "Lapsed 41 days ago"). The dashboard's non-compliant link has been passing `?status=noncompliant` all along and the grid ignored it. **A member exempt from a requirement could never reach 100%** — the denominator counted every active requirement while the numerator counted only applicable ones. **A certification expiring soon read as a failure**, so a member holding a card valid for another 26 days rendered under "Compliant" reading "1 of 2 met · 1 open item". Actions are limited to ones with something behind them; the mock's Notify and Assign buttons had no endpoint                                                                                                                                                                                                                                                                                                                                                          |
| **Empty states stop instructing members who cannot act**          | #2265, #2268, #2271, #2273, #2280, #2293                 | Documents, Members roster, Events, Training Programs, Course Library                                                                                                                                                                                                              | Component-level gating, not route-level                                                                                                                                                                                                                                                                                              | Five screens told **every** member to upload a file / add a member / create an event / create a pipeline, with the buttons beside them already officer-only — an instruction with nothing behind it, and in three cases a link to the access-denied page. Now shown only to somebody who can act. **An empty result that follows from a search or a filter is still reported to everyone** — that is feedback on what they asked for. Three dialogs (upload, new-folder, delete) also **outlived the permission that opened them**, leaving their actions on screen after the grant went away. Course Library's gate is on the component, not the route, because the same page is mounted inside the training admin hub where the officer does hold the grant                                                                                                                                                                                                                                                                                                                                                                  |
| **Roster lock and past-shift controls**                           | #2245, #2255                                             | Shift board; shift detail panel; assignment actions                                                                                                                                                                                                                               | `shifts.late_signup_until` (`c9f2a4b71d38`); `rosterLocked`; resolved cushion reported on `GET /scheduling/settings`                                                                                                                                                                                                                 | **"Reopen for 15 min" was offered on a shift three weeks gone, and it worked** — a member could sign themselves onto a shift they never worked and draw hours for it. Confirm, decline, remove and withdraw outlived the shift too, beside the hours they would have deleted. **The lock is now enforced, not just displayed**: all four paths carry the same end-plus-grace bound, with the same `scheduling.manage` exemption. **A shift with no end time was exempt entirely** — it is now treated as running twelve hours past its start, floored at the department's `checkin_closes_hours_after`, so the roster lock and check-in cannot disagree about one shift. Unknown settings now mean **unlocked**, because a permissive default is right for a claim button and wrong for a lock                                                                                                                                                                                                                                                                                                                                 |
| **Departments name their own call types**                         | #2273, #2281, #2288                                      | Administration → Scheduling Admin → General → Call types                                                                                                                                                                                                                          | `organizations.settings` call types; `ShiftCompletionReport.data_sources["call_types"]`; migrations `a3d7e2f18c45`, `c9f4a2b71d38`, `d7c1b95e2a40`                                                                                                                                                                                   | The nine types have been per-department data since call tracking shipped and **nothing in the UI could reach them**. **Retiring, not deleting**, is the default for a type with history: the stored value on every filed call is the permanent slug. Reports, CSV exports, badges, the printable report and the summary email now use the department's own names, retired types included. **A department that had named a type `unclassified` could neither report on it nor repair it** — that slug is the synthetic bucket for an untyped call, so its calls merged into "Not categorised" and the settings editor could not even mention it. **A report written under per-incident tracking keeps the officer's own wording** and is never relabelled by a rename                                                                                                                                                                                                                                                                                                                                                           |
| **Events: attendees, RSVP and waitlist**                          | #2142, #2148, #2149                                      | Event detail; dashboard inline RSVP                                                                                                                                                                                                                                               | `events.attendee_visibility` per-event override (`c3a71e5d9b48`), NULL = inherit org default                                                                                                                                                                                                                                         | The going list is now shareable with members — **names and going status only**, never contact details, notes, dietary or accessibility needs, guest counts or check-in times. **The default ships as managers-only**, so nothing changes until a department opts in. `requires_rsvp` now means "a response is expected", not "responses are permitted" — the API previously refused outright, leaving members nothing to do on most events. **Guests occupy seats**: `allow_guests` had been on the model since the beginning and was read nowhere, and capacity counted going _rows_. **A capped event will fill sooner than it used to** — that is the correction; events already over the seat count are left alone rather than retroactively waitlisted                                                                                                                                                                                                                                                                                                                                                                    |
| **Calendar dates stop shifting west of UTC**                      | #2179                                                    | Every date-only field: hire dates, expiries, due dates, leave dates                                                                                                                                                                                                               | `dateFormatting.ts` — a bare `YYYY-MM-DD` is recognised as a calendar date and pinned to UTC at parse and format                                                                                                                                                                                                                     | A hire date of 2020-12-06 printed "12/5/2020" in New York. A `DATE` column has no time and no timezone — it is a square on a calendar, the same square for everyone — but it was parsed as UTC midnight and rendered in the viewer's zone. **The same shift named the wrong weekday**, which on anything schedule-shaped is worse than a wrong number, and **"days remaining" counts were one short** in the direction that makes a renewal look less urgent. A value carrying a time is still an instant and still converts, and both directions are asserted so neither half can be restored by breaking the other                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Notification paging and the Send Log**                          | #2286, #2289                                             | Notification inbox; Send Log tab                                                                                                                                                                                                                                                  | `notification_logs.sent_at` **NOT NULL** + keyset index (`c8f4a1e6b309`); `cursor`/`next_cursor` on `GET /notifications/logs` and `/notifications/my`                                                                                                                                                                                | **"Load more" could step over a notification entirely** — offset paging over a newest-first list re-serves one row and skips another whenever something arrives mid-page. A department-wide fan-out is the **worst case, not an edge case**: `sent_at` is stored to the second, so every recipient shares one timestamp, hence a `(sent_at, id)` key. Separately, **the Send Log listed every notification the department had sent anyone** — subject, body and recipient address — to anyone who could open it. It now defaults to the caller's own deliveries and is offered to every member as their own data; the org-wide view survives as an explicit `scope=organization` requiring `notifications.manage`. **API note:** `read-all` previously always swept the whole organization and now defaults to the caller                                                                                                                                                                                                                                                                                                      |
| **Quick Add on the phone bottom bar**                             | #2157                                                    | Phone bottom navigation                                                                                                                                                                                                                                                           | `navGateIntegrity.test.ts` resolves every row against the real route definition                                                                                                                                                                                                                                                      | The centre of the bar is an Add button opening a short list of the things a member actually logs. Before this, every one was four taps and two page loads before the first field. **Quick Add adds no forms of its own** — each row goes to the screen that already owns that entry, so there is no second path for the same data to drift down. **Rows appear only where the page behind them would actually open**: a row gated more widely than its route is a link to Access Denied placed there by the app itself. The bar keeps five items and the configurable slots go from three to two; a saved layout keeps its first two and is left intact on disk                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Member roster becomes a directory**                             | #2139, #2178                                             | `/members`; member profile                                                                                                                                                                                                                                                        | `users.profile_visibility` (`a8c4d1e2f3b5`), NULL resolves to `PROFILE_VISIBILITY_DEFAULTS`; `GET /users` now populates `platoon`                                                                                                                                                                                                    | `/members` carries no permission gate — it is the department directory — but it rendered the coordinator's working screen to everyone: usernames, a hire-date column, a per-row Actions column, bulk selection, CSV export, titled "Membership Management". It is **"Member Directory"** for everyone without `members.manage`. **This is a change to what the page shows, not what the server sends** — the endpoint still returns usernames and hire dates to any `members.view` holder, so it declutters, it is not a confidentiality boundary (flagged as USR-8). Separately, each member can now choose per field what colleagues see. **`GET /users` declared `platoon` and never populated it**, so the Platoon Roster Panel rendered every member as unassigned                                                                                                                                                                                                                                                                                                                                                        |
| **Elections: eligibility and duplicate-vote hardening**           | #2162, #2173 and the ELEC pass-3 series                  | Ballot links, full-ballot submission, paper-ballot batches                                                                                                                                                                                                                        | `docs/security-review/ELEC-06-elections-ballots.md` (ELEC-13 … ELEC-39)                                                                                                                                                                                                                                                              | Ten findings, most of one shape: **a name collision between a plain position and a ballot item let a token vote on a contest it was never granted**, and the two submission routes computed different internal fingerprints for the same vote so the database's own duplicate safety net could not recognise them as one. Also: a member moved onto a department's own **custom membership tier** kept voting rights a restricted ballot meant to exclude — caused by an unrelated, correct scheduling fix that started preserving class/status across a tier switch. Paper-ballot attestation, voiding and election deletion locked in inconsistent orders and could deadlock                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Security monitoring, MFA and session hijack**                   | #2128, #2132, #2133                                      | —                                                                                                                                                                                                                                                                                 | `SecurityMonitoringService`; `user.mfa_last_timestep`                                                                                                                                                                                                                                                                                | Eight successive findings on the same subsystem, each one a gap in the previous fix — worth reading as a sequence rather than a list. A TOTP code verified at an MFA **management** route was never recorded as consumed and could replay at login. The fix for that had a **concurrency race** that let one code complete two independent logins; so did the recovery-code check one field over. The session-hijack detector **silenced itself after firing once** because its own fix promoted the attacker's IP to trusted; the fix for _that_ left the timestamp unrefreshed, so continuous attack traffic eventually earned the "probably roaming" leniency. Two of four in-memory trackers were **never capped for SSO-only organizations**, and eviction was `O(n log n)` per request once at cap                                                                                                                                                                                                                                                                                                                       |
| **Documents: folder ACLs, pagination and audit**                  | #2160, #2164, #2166, #2170, #2171 and the FAC/DOC series | Documents page; facility Files                                                                                                                                                                                                                                                    | `document_folders.required_permissions`; `e6f2a7c9d148`, `a8e4c1f7b930`; `GET /documents/folders` gains `skip`/`limit`                                                                                                                                                                                                               | Folder authorization is now **hierarchical** — a restriction can live on an ancestor, so pagination is applied after the ancestor-aware ACL filter rather than to a flat per-folder check. `documents.manage` could bypass a folder's ACL on create, reparent, move destination and the folder-mutation routes; a folder delete could cascade-destroy a **more-restricted descendant** the caller could never access directly, or an entire system tree such as every member's files. A folder listing issued **one `SELECT COUNT(*)` per folder**. Folder create/rename/delete and document metadata edits now leave an audit trail. **`e6f2a7c9d148` clears a facilities ACL copy-pasted onto apparatus sub-folders**, which had locked an apparatus officer out of a truck's own manuals                                                                                                                                                                                                                                                                                                                                    |
| **`text-right` on a table header did nothing**                    | #2258                                                    | 108 headers across 37 files                                                                                                                                                                                                                                                       | `styles/index.css`; `styles/tableHeaderAlignment.test.ts`                                                                                                                                                                                                                                                                            | `thead th { text-align: left }` was declared **outside any cascade layer**, and unlayered CSS outranks every layer — so the `text-right` Tailwind emits into `@layer utilities` was discarded on every one of them. The heading sat hard left while its figures sat at the far right of the column. **Only `text-align` moved** into `@layer base`; the other five declarations stay unlayered on purpose. Verified by measurement, not by reading the diff. jsdom compiles no Tailwind and applies no cascade, so no render test could ever have caught this                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Administration breadcrumbs**                                    | #2276, #2280, #2282, #2284                               | Every administration hub and the pages beneath it                                                                                                                                                                                                                                 | `Breadcrumbs`                                                                                                                                                                                                                                                                                                                        | Nothing under `/scheduling/admin` had one: sub-pages offered a single unlabelled back arrow whose destination was only in its `aria-label`. **A crumb no longer offers a page it cannot open** — a generated trail is built from URL prefixes, and a prefix is often not a route at all or one the viewer lacks the grant for; both used to render as working links. On a hub the trail **stops at the parent** rather than repeating the heading the page already states twice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Security review rotation — pass 3**                             | #2085–#2182 and the pass-3 series, through #2301–#2304   | Every module                                                                                                                                                                                                                                                                      | `docs/security-review/*.md`, `PROGRESS.md`                                                                                                                                                                                                                                                                                           | The rotation completed its third pass over the core features in this window. Findings and disposition are per-feature in [`docs/security-review/`](./security-review/); the user-visible half is in `CHANGELOG.md` under the 2026-08-31 → 2026-09-06 dates. **Two late findings worth naming.** Medical supplies (#2301): a plain item edit could deactivate equipment a member still held — see the Inventory row above. Meetings & minutes (#2303, MM-14): a meeting attendance waiver's member and grantor **name lookup carried no organization filter**, relying entirely on those ids having come from an org-scoped write elsewhere. True today, but the first write path to skip that validation would have returned another organization's member's name. Both lookups now filter directly, matching the convention used everywhere else in the feature — a Pitfall #14 hardening with no user-visible change                                                                                                                                                                                                         |

## Retired URLs

**Thirteen of these fourteen have no redirect.** A bookmark or an emailed link
lands on the dashboard, and the catch-all redirect makes that silent.

### Equipment checklists (Scheduling → Inventory)

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

### Scheduling administration

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

### Redirected, not retired

| Was            | Is now                   |                   |
| -------------- | ------------------------ | ----------------- |
| `/store/admin` | `/inventory/admin/store` | redirect in place |

## Alembic route (upgrade data path)

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

### Reversibility

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

## New data model

### `mcp_service_keys` — the credential behind the Claude MCP add-on

One active key per organization. **SHA-256 digest only** — the plaintext is
never stored and is shown in the UI exactly once. Carries a display prefix, an
optional expiry or lifetime, and revocation/creation audit columns; rotation
revokes the previous key. Issuing and revoking require the new
`integrations.mcp_keys` permission, which only the IT Manager position holds by
default. Reversible: the downgrade drops the table, and any MCP client
configured with a key stops authenticating, which is the correct consequence of
removing the feature.

### `shift_template_equipment_checks` — a template names its checklists

Deliberately thin: the two sides, the org, and an order. Timing
(start/end of shift) and position eligibility stay on
`equipment_check_templates`, where they are edited and where every other reader
already looks. **Presence is meaningful, and that is the whole design** — a
template with no rows keeps resolving by apparatus id and then apparatus type,
exactly as every shift does today.

### Added columns

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

## Permission and grant movements

**This is the section to read before upgrading a live department.** Eleven
migrations move grants on seeded positions. They are not eleven independent
decisions — **nine of them trace to one root cause**, and it is worth
understanding before reading the table.

### The root cause: the onboarding wizard overwrote the registry

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

### The movements

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

**What an administrator has to do about it.** Nothing is granted back
automatically. Specifically:

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

## Known limitations opened this window

Recorded in [`KNOWN_LIMITATIONS.md`](./KNOWN_LIMITATIONS.md).

### MCP-1 — claude.ai custom connectors need a local bridge

claude.ai custom connectors authenticate with OAuth 2.1. The Logbook is an
OAuth **client**, not an authorization server, so those clients cannot present
a service key directly and use a local bridge for now. Claude Code and the
Messages API connector reach `/api/mcp` without one.

### USR-8 — the member directory's reduced view is not an access boundary

The reduced "Member Directory" for non-managers withholds username, hire date
and the bulk actions **in the UI**. `GET /users` still returns the full field
set to any `members.view` holder. Not a cross-tenant leak, and not a
straightforward fix: 25+ other call sites depend on the current unfiltered
response.

### FAC-13 — baseline facility categories are stamped as sensitive

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

### MS-7 — a screening record can be self-created and self-cleared

Nothing stops a `medical_screening.manage` holder from logging their own
screening as `passed`, with no reviewer distinct from the subject.

### Two compliance fields that have never done anything

"Grace Period (days past expiration)" and "Applies to Roles" on a screening
requirement are stored and shown, and `get_compliance_status` reads neither.
Both now **say so on the form** — the sanctioned second option under pitfall
#19. Wiring `grace_period_days` is deferred because it defaults to 30 on every
requirement already on file, so switching it on would relax non-compliance
flagging installation-wide rather than only for departments that opted in.

### Carried forward, unchanged

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

## Documentation and media disposition

### Screenshots

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

### YouTube script beats

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

## Verification

Run these before trusting anything above:

```bash
cd backend && python scripts/validate_migrations.py   # head = d7c1b95e2a40
python3 scripts/check_route_permissions.py --strict   # routes vs APPLICATION_PAGES.md
python3 scripts/check_endpoint_permissions.py         # endpoints vs docstrings
python3 scripts/check_docs_links.py                   # cross-doc links
python3 scripts/screenshots/status_report.py          # screenshot coverage
```
