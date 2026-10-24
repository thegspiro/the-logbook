# Medical Supplies Module

EMS consumables — gauze, saline, epinephrine, glucometer strips — held as
**dated lots** rather than one flat count, on their own page rather than mixed
into the gear catalog.

Shipped 2026-08-16. Off by default; a department that does not run EMS never
sees it.

> **Why it is separate from the gear and uniform pages.** The two supply lines answer
> different questions and are usually owned by different people. Gear is
> tracked per unit, issued to a named member, and retires on an NFPA clock. EMS
> stock is tracked by quantity and expiration date, belongs to the rig rather
> than the member, and is consumed. Mixing them meant the quartermaster's
> catalog filled with items they did not order and the EMS officer had no page
> of their own — and, before the split, no permission that reached only their
> half.

---

## Contents

1. [Enabling the module](#enabling-the-module)
2. [Permissions and roles](#permissions-and-roles)
3. [Pages](#pages)
4. [The domain boundary](#the-domain-boundary)
5. [Linking checklist items](#linking-checklist-items)
6. [Lots and on-hand](#lots-and-on-hand)
7. [Alerts](#alerts)
8. [API reference](#api-reference)
9. [Data model](#data-model)
10. [Migrations](#migrations)
11. [Edge cases](#edge-cases)

---

## Enabling the module

Per organization, in **Settings → Modules → Medical Supplies**
(`org.settings["enabled_modules"]`, key `medical_supplies`). **Default: off.**

There are no deployment-level environment flags for module availability — see
[Module Enablement](../CLAUDE.md#module-enablement). When the module is off,
the navigation entry is absent and the routes are unreachable.

> **The toggle shipped incomplete and was fixed the same week.**
> `medical_supplies` was in the settings schema and the onboarding registry but
> not in `ModuleSettingsData` or the Settings page, so a department created
> before the release got the field defaulted off **with no interface to turn it
> on**. New organizations were unaffected because the onboarding registry
> carried it. Fixed 2026-08-16 (PR #1500).

---

## Permissions and roles

Two domain-scoped permissions, so a department can appoint an EMS supply
officer for medical stock while the quartermaster keeps gear:

| Permission                 | Grants                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| `inventory.view_medical`   | Read medical items, categories, lots, expiring list, summary                              |
| `inventory.manage_medical` | Create/update medical items and categories; add, edit and delete lots; receive deliveries |

**Every medical route accepts either the domain permission or the broad
one.** The check is `require_permission("inventory.view_medical",
"inventory.view")` — an OR. Consequences worth internalising:

- A department running **one** supply line is unaffected. Its quartermaster
  holds `inventory.view` / `inventory.manage` and reaches medical stock exactly
  as before.
- `inventory.*` still grants everything.
- The frontend route gate lists **both** permissions, mirroring the backend's
  OR exactly. Gating on the narrow permission alone would bounce the
  single-supply-line department off a page the API would happily have served
  them — a redirect to the dashboard with no explanation.

### Roles

| Role                                                       | Change                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **EMS Supply Officer** (`ems_supply_officer`, priority 55) | **New system role.** Holds the two medical permissions plus the **whole** `equipment_check.*` set — both halves of the shelf-to-truck loop, because stock is only useful if the same officer can put it on the apparatus checklist and see what is expiring out there. Also `apparatus.view`, `locations.view`, and the baseline directory reads. **No access to gear or uniforms.** |
| **Quartermaster**                                          | Seeds with `inventory.view_medical` / `inventory.manage_medical` alongside the gear permissions. A department that splits the job drops these two from the quartermaster and appoints an EMS Supply Officer.                                                                                                                                                                         |
| **Apparatus Officer**                                      | Now **states** the medical permissions explicitly. Nothing is widened — it already reached medical stock through the broad `inventory.manage`; the role editor is simply honest about it now. Also gains the `equipment_check.*` set its description had always promised.                                                                                                            |

A matching **email-signature office** ships with the role.

> **`equipment_check.*` is `inventory.check_*` now** _(renamed 2026-08-31)_.
> The table records the grants as they shipped; a migration renamed the stored
> keys, so these positions now hold `inventory.check_view` / `.check_submit` /
> `.check_manage`. Since 2026-09-30 the Quartermaster also seeds with
> `inventory.check_manage` (authoring only), applied to existing departments by
> migration `f73b449bdb8b`.

---

## Pages

| Route                          | Page                                                                                                                       | Permission                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `/medical-supplies`            | Medical Supplies — opens on **what is expiring**, with an all-supplies tab, an add-supply form and a receive-delivery form | `inventory.view_medical` **or** `inventory.view` |
| `/medical-supplies/categories` | Medical supply categories                                                                                                  | `inventory.view_medical` **or** `inventory.view` |

Writes on both pages require the corresponding `manage` permission.

**Finding a supply by another name.** A supply has an **Also called** list
(`also_called`, up to 10 names such as "BVM") on its add and edit form.
`GET /items?search=…&fuzzy=true` returns the exact matches first, then supplies
whose name or alternate names merely resemble the search; the checklist builder
uses it so a rig's wording finds the catalog row instead of prompting a
duplicate. It stays inside the medical domain like every other route here.

**List, sort and bulk actions** _(2026-10-16)_. `GET /items` sorts server-side
(`sort_by` accepts `name`, `category`, `on_hand`, `reorder_point`; blanks last,
ties by name; `on_hand` orders by the number the list shows, the in-date lot
total for a lot-stocked supply). A `low_stock` flag filters to what the Low
stock tile counts; an unset (null) reorder point is never low.
`POST /items/bulk-retire` retires each item through `retire_item` with the
medical domain re-checked under its lock; failures are reported and the rest go
through (audit `medical_items_bulk_retired`). The list route adds `size`,
`next_expiry`, `storage_path`, `apparatus_count` and `apparatus_places`.
The two export routes are in `SecurityMonitoringMiddleware.EXPORT_ENDPOINTS`.

**Where a supply is kept** _(2026-10-16)_. Items carry a storage area
(`storage_area_id`, which settles the room) beside the free-text
`storage_location` note. New
medical-scoped reads, so a medical-only officer needs no general inventory
access: `GET /storage-options` and `GET /items/{id}/placements`
(`ItemDeployment` adds `target_quantity`, `quantity_on_truck`,
`compartment_path`). Paths come from one query per request over the templates
involved, walking `parent_compartment_id` with a cycle guard. Migration
`58522b08f6a7` files existing supplies under the one active area whose name
matches their text; the downgrade unlinks rows still matching that rule.

**Deleting a category moves its supplies first.** A category can be deleted
permanently (`DELETE /categories/{id}`), and the page asks where its supplies
should go. This is not left to the database: an item's foreign key to its
category is `SET NULL`, and an item with no category reads as **gear** — a
bare delete would carry every supply in it off this page and into the uniform
closet. So the route refuses (409) while the category holds supplies unless
`?move_items_to=<medical category id>` names a destination, and then moves
them, **retired supplies included**, before deleting. A category with
subcategories is refused (400). A supply's low-stock threshold comes from its
category, so a moved supply takes on the new category's. Both ids must be
medical categories in the caller's organization, so a gear category can be
neither deleted nor chosen as the destination here. The delete is recorded in
the audit log as `medical_category_deleted`, with the count moved.

Rows in other tables that point at a category (issuance allowances, variant
groups, kit items, reorder and equipment requests) are gear features and are
not moved; the database clears or removes them as their own foreign keys say.

**The page opens on the expiring tab, not the catalog.** For a consumable with
a shelf life, "what am I about to lose" is the question that brings someone to
the page; "what do we stock" is the reference behind it.

**The headline tiles** _(labels from 2026-09-29)_ read **Expiring within 30
days** and **Low stock** — the latter was "Below reorder point", which was
wrong: it counts items **at or below** their reorder point. A category's
threshold reads "Low stock at _N_ or below" for the same reason. A search that
matches nothing on **All supplies** says **No matching supplies**, rather than
the empty-catalog **No medical supplies yet**.

### Receive delivery

Books a whole shipment as **one dated lot per item line** — item, lot number,
expiration, quantity — under a single received date. This is the only way to
add stock to a lot-tracked item; see [Lots and on-hand](#lots-and-on-hand).

Each line is a group named **Line 1**, **Line 2**… with **Remove line _n_**, so
a screen reader can tell which line's **Item**, **Qty**, **Lot #** and
**Expires** it is in _(2026-09-30)_. Success reads "Delivery recorded: _n_
lines". The add-supply form's "No medical supply categories exist yet" notice
links to the **Medical Supply Categories** page it names.

### Naming

The gear side is **Inventory** in navigation, with **Inventory Admin** as its
administration hub; the screens under it keep the gear vocabulary a
quartermaster uses — **My Issued Gear**, **Gear Requests**, **Gear Kits**.

The module was briefly called "Gear & Uniforms" outright, when gear and
uniforms were all it held. It now also covers EMS supplies on the same catalog,
so the area carries the category name and the gear language lives on the
screens that are actually about gear. **Routes, permission keys and table names
have never changed through any of this**, so no link, bookmark or integration
breaks.

### Importing supplies from a CSV

A department can bring its existing stock in through the inventory CSV import
(`/inventory/import`, which needs `inventory.manage`). Its downloadable sample
includes common medical supplies — airway, bleeding control and trauma,
dressings, diagnostics and infection control — as counted rows, plus one
individually tracked, serial-numbered device. It deliberately has **no
medications**: they vary by protocol and include controlled substances.

Three things about the import decide where those rows land:

- **The Category cell is a name, matched against categories you have already
  created** (case-insensitively, among all of them, medical included). The
  sample uses generic names — _Airway & Breathing_, _Bleeding Control & Trauma_,
  _Dressings & Bandages_, _Diagnostics_, _Infection Control_ — so rename them in
  the file to match your own. A name that matches nothing still imports the
  row, **with no category**, and an uncategorized item reads as gear rather
  than medical; the import lists each such row as a warning.
- **"Item Type" is checked and then ignored.** An item's type comes from its
  category, so writing `medical` there does not make a row medical by itself
  (it is accepted, so it is not rejected).
- **"Also Called" carries alternate names.** Put them in one cell, separated by
  semicolons or commas (`BVM; Ambu bag`); they become the item's "Also called"
  names, which the checklist matcher looks through when linking a checklist
  item to inventory. Blank and repeated names, and the item's own name, are
  dropped. A row with more than 10 names, or a name over 100 characters, is
  refused and reported rather than trimmed.
- **The import carries no lots.** Lot numbers and expiration dates are added
  afterwards, for example through **Receive delivery**; a supply imported by
  count shows its quantity but nothing is flagged as expiring until it has
  dated lots.

---

## The domain boundary

This is the part most likely to be broken by a careless change.

**The domain is never read from a request.** `MEDICAL_ITEM_TYPES` is fixed in
the endpoint module; there is no `?domain=` parameter to tamper with. Every
by-id write re-checks that its target is in the domain **before** touching it:

```python
await _require_medical_item(service, item_id, organization_id)
await _require_medical_category(service, category_id, organization_id)
```

**These answer `404`, not `403`, and that is deliberate.** To a supply officer
scoped to medical stock a uniform item does not exist, and a `403` would
confirm the id is real — turning the endpoint into an existence oracle over the
gear catalog.

Symmetrically, **gear listings exclude medical-domain items and categories**,
so the quartermaster's catalog does not fill with saline.

---

## Linking checklist items

_(2026-10-11)_ An equipment check position tracks expiry, lots and restock only
through its `inventory_item_id`. The template builder used to search the gear
list alone — which excludes medical stock — and its "create in inventory" filed
the new row with no category, which made it gear. A rig's gauze either stayed a
free-text line or became a second catalog row the supply officer never saw.

The builder's quick-add bar and its **Linked Inventory Item** picker now:

- **Search both halves of the catalog**, medical first, with medical results
  badged. Each half is searched only when the viewer can read it
  (`inventory.view` for gear; `inventory.view_medical` or `inventory.view` for
  medical) and, for medical, only when the module is enabled — so a
  medical-only EMS Supply Officer is not refused on every keystroke.
- **Offer "Create in Medical Supplies"** to holders of `inventory.manage_medical`
  or `inventory.manage`. The officer picks a medical category (preselected when
  there is only one), and `POST /items/create-if-absent` files and links the
  row in one request.
- **Withhold every create when a half of the search failed.** A partial answer
  cannot prove the name is free.

`create-if-absent` dedups pool rows by normalized name across the **whole**
catalog, as the gear route does. A match in the medical domain is handed back
with `created: false`. A match filed as gear is refused with **409** rather
than linked — the officer asked for medical stock — and the response does not
describe the gear row. The quartermaster moves it into a medical category if
that is where it belongs.

After a bulk paste into a saved compartment, the builder offers **Match to
catalog**, opening the existing match tool, whose fuzzy matching already spans
medical stock. The template-level "_n_ of _m_ items linked" line remains the
standing warning; linking is never required to save.

**Cleaning up existing checklists** _(2026-10-12)_. **Catalog Links**
(`/inventory/admin/checklists/catalog-links`, `inventory.check_manage`) lists
every unlinked position in the department — active and draft templates — grouped
by normalized name, so "4x4 gauze" on six rigs is one decision rather than six.
Exact name matches are pre-selected; likely and possible matches wait for a
person; any group can be linked to an item found through the same gear-and-
medical search the builder uses. Names nothing in the catalog resembles sit in a
collapsed "No catalog match" section: they are usually tasks rather than stock,
but `function` is also the default type for a free-typed supply line, so the
type cannot be used to hide them.

Applying goes through `POST /equipment-checks/inventory-links`, all or nothing
per request (2,000 positions), with a change-log entry on each affected
template. A position somebody linked in the builder after the report loaded is
left as they set it, never overwritten. The response lists each one in
`skippedPositions` — the line, its template and compartment, the item it is
linked to now and the item the officer chose — and the page keeps that list on
screen after it reloads, with a link into each template, until it is dismissed.

---

## Lots and on-hand

Medical supplies use the same dated-lot machinery as other consumables
(`inventory_lots`, 2026-08-10). The rules that matter here:

- **On-hand comes from in-date lots** for any item that has them, and from
  `InventoryItem.quantity` for the rest.
- **Expired lots count as zero.** The equipment-check swap refuses them, so
  counting them would hide exactly the shortage most in need of ordering.
- One shared helper backs the reorder alert, the items grid and the CSV export,
  so the three cannot disagree.
- **The item page's Stock Lots panel agrees** _(2026-09-30, workflow review
  W47)_. It totalled every lot as ready units, expired ones included, so the
  item page and Medical Supplies disagreed about the same item. It now counts
  only in-date lots, adds "· _N_ expired" when there are any, and names each
  lot on its quantity and delete controls ("Delete lot 4471A").
- **A retired item's lots are gone from expiry figures** _(2026-09-30)_. They
  were still listed as expiring stock, counted in the medical summary, and
  mailed in the supply-expiry alert — for an item nobody could issue.

> **The dashboard's Low stock reads lots and leaves medical out** _(W47-6,
> fixed 2026-10-11)_. The main dashboard's low-stock widget summed each
> category's `quantity` column, which a lot-stocked item leaves at 0, and
> counted medical categories the gear list it links to excludes. It now reads a
> lot-stocked item from its in-date lots and leaves medical categories out;
> Medical Supplies' own **Low stock** tile, counted from item reorder points, is
> the medical figure.

> **"On hand" is not editable on a lot-stocked item** _(fixed 2026-08-17)_. The
> field writes `quantity`, but a lot-stocked item's count comes from its lots —
> the ledger the page and the summary actually display. A manager could change
> the box, get a success toast, and watch the number stay put. The field is now
> replaced for such items by the lot figure and a pointer to **Receive
> delivery**, and `quantity` is left out of the payload entirely rather than
> sent as a null that would clear a column nothing shows.

### The medical domain is re-checked under each write's lock _(2026-10-05, MSUP-25)_

Five medical-supplies writes (item update, lot add, delivery receipt, lot update,
lot delete) checked domain membership in a preflight and then called a general
mutation, so a category reclassification landing in between let a medical-only
manager edit an item outside their domain. `_items_in_domain_locked` now locks
the item rows in id order and reads their categories with a locking read; each
mutation takes `required_item_types` and the medical routes pass
`MEDICAL_ITEM_TYPES`. A miss reads as the route's existing 404, and a delivery
with one such line receives nothing. Callers passing no domain are unchanged.
Completing maintenance with condition `RETIRED` is refused on both maintenance
paths (retirement goes through `retire_item`, with its lock, blockers and audit
event), and the maintenance form no longer offers it.

---

## Stock on the apparatus _(2026-10-16)_

A medical supply's ready stock is **shelf plus trucks**
(`InventoryService.stock_breakdown`): in-date deployed lots, else the last count,
else the position's target (tallied as uncounted). The low-stock list, the Low
stock tile, the daily alert email and automatic reorder read that one figure;
gear keeps judging the shelf alone. Auto-reorder is also checked after a daily
check, a "report used" and a recount. The list's On hand shows "+N on trucks" and
takes Low from the server (`is_low_stock`).

- **Expiring**: `GET /medical-supplies/expiring-stock` lists truck stock beside
  shelf lots; `/lots/expiring` is unchanged. The summary adds
  `expiring_soon_on_apparatus` and `expired_on_apparatus` and keeps its existing
  fields. Next expiry takes the soonest of the shelf and the trucks and reports
  `next_expiration_location` and `next_expiration_where`; a tie goes to the shelf.
- **Lot recall lookup**: `GET /medical-supplies/lots/search?lot_number=` (view
  permission; at least 2 characters) returns every unit whose lot number
  contains the text, case-insensitive, on the shelves and aboard the apparatus,
  dated or not and expired or not, in the `/expiring-stock` row shape; empty
  lots and positions holding nothing are left out. The Expiring tab's "Find a
  lot" box calls it, past the GET cache.
- **Weekly "Supplies to Replace" email**: already listed truck stock expiring or
  short. Its place now reads as the checklist names it ("Medic 1 › Main
  Compartment › Jump Bag", from the overview's new `compartment_path`), and an
  apparatus-only supply never counts as having replacement stock ready
  (`get_lots_for_items` applies `_shelf_lots_count`).
- **Swap and restock live in Inventory**: a truck row in the Expiring tab or the
  lot lookup links to that apparatus's inventory
  (`/inventory/checklists/apparatus-inventory?apparatus=`, from the row's new
  `apparatus_id`), where the swap is; the header links the supply worklist
  (`/inventory/admin/checklists/supply`). Each link shows only to a viewer that
  route admits, with the Inventory module on. A checklist written for an
  apparatus type names no vehicle, so its rows carry no link.
- **Apparatus only** (`inventory_items.apparatus_only`, default false; migration
  `0bbf263a5ff0`, guarded, downgrade drops the column): the shelf counts as 0,
  the list shows "N on M apparatus", the lots dialog has no stock-lot controls,
  and Receive delivery leaves it out (`exclude_apparatus_only`). Shelf lots left
  from before are excluded from Expiring, the tiles and Next expiry by one
  filter, `InventoryService._shelf_lots_count`; rows are untouched, so unmarking
  restores them. CSV carries "Kept on Apparatus Only" (Yes/No); an unreadable
  value is refused, an apparatus-only row may carry Quantity 0, and lot columns
  on such a row are refused.
- **Sort by Next expiry** _(2026-10-23)_: `GET /items?sort_by=next_expiry` (and
  the export) orders by the Next expiry each row shows. The figure spans shelf
  lots and truck positions and is worked out in Python (`_next_expiries`, the one
  definition behind the column, the sort and the export), over the whole
  filtered set rather than one page, then handed to `get_items` as
  `sort_values`, which orders by it in SQL so paging still works. Supplies with
  nothing dated come last in either direction, then by name.
- **Truck stock in the CSV export** _(2026-10-23)_: the supply export appends
  "On Apparatus", "Uncounted Positions", "Next Expiry" and "Next Expiry Where"
  after "Notes", so the columns the import reads keep their positions. The
  import ignores all four, and the template leaves them out.
- **Not yet counted** _(2026-10-23)_: `GET /items?uncounted=true` (and the
  export) narrows to supplies carried on a truck position no crew has counted —
  the positions On hand counts at their target. The summary adds
  `uncounted_on_apparatus` (supplies, not positions). Each list row carries
  `apparatus_uncounted_places` (`template_item_id`, `apparatus_id`, `where`).
  The page's "Not yet counted" tab (`?tab=uncounted`) lists them with a "Count
  it" link to the apparatus's inventory, under the same gate as "Swap or
  restock". One rule decides "uncounted" for every reader:
  `InventoryService._ready_positions`.
- **Truck lots in the lot export** _(2026-10-23)_: `GET /lots/export` lists the
  lots aboard the apparatus beside the shelf lots, in one list soonest first and
  undated last. Two columns are appended after "Notes": "Location" ("In storage"
  or "On apparatus") and "Where" (the storage path, or the apparatus and
  compartment). A truck unit is listed by its deployed lot, or by the position's
  own lot number and date when no lot is recorded; a position with neither, or
  holding nothing, has no lot to list (`apparatus_expiring_stock(...,
include_undated=True)`). Shelf-only columns (Received Date, Storage Location,
  Unit Cost, Notes) are blank on a truck row.
- **Not yet counted count** _(2026-10-23)_: the tab reads "Not yet counted (N)"
  from the summary's `uncounted_on_apparatus`.
- **Uncounted positions in the weekly email** _(2026-10-23)_: "Supplies to
  Replace" adds a "Not yet counted on apparatus" table naming each medical
  position no crew has counted, and the summary line counts them. It rides
  along with an email that is going anyway and never sends one of its own, so a
  department that never counts a position is not mailed about it every week.
  Shown to audiences holding the medical domain, as the shelf lots are. Rows
  come from `EquipmentCheckService.uncounted_supply_positions`, which reads the
  same rule as the page's Not yet counted tab.
- **Look-ahead window** _(2026-10-23)_: the Expiring tab offers 30, 60 or 90
  days. The tiles, the Expiring list, its empty state and the Next expiry
  colouring all follow the choice; it is not saved between visits, and the
  weekly email keeps its 30 days.

## Alerts

Low-stock and expiring-supply alerts reach both domains; **NFPA retirement
stays with the gear officer**, since it is structural PPE and has no medical
analogue.

**What the emails now say** _(2026-10-05)_. The weekly supply alert lists more
than expiring items: it also lists items a crew reported used or pulled, and
counted positions below their target, which have no date to expire by. The
email is titled **Supplies to Replace**; the subject, opening line and plain-text
body share one summary that counts each kind separately and names only the kinds
present ("1 expiring on apparatus, 2 to restock on apparatus, 1 stock lot
expiring"). The deployed tables' former **Expires** column is **Status**: an
expiring row shows its date and days left, a reported row shows "Restock
reported" with the crew's note, a short row shows "Short — 2 of 4 aboard". A
reported item whose own date is months away is no longer counted as expiring.
The low-stock alert says "at or below reorder point" (the query includes items
sitting exactly at it), and the NFPA retirement alert says "approaching or past"
and gives the past-due count. The low-stock and NFPA emails put the category and
the serial number or asset tag on a grey line under the item name so the table
fits a phone.

**Raised by the checks themselves** _(2026-10-11)_. Two signals no longer wait
for someone to act on a report:

- **A short count raises a restock report.** When a shift, standalone or
  completed check counts a position below its required (or expected) quantity,
  the position is flagged for restock with the note "Counted 2 of 4 on an
  equipment check", attributed to whoever submitted. This is the same flag
  "report used" sets, so it appears on the supply overview and in the weekly
  email. A report already standing is left as it is; a full recount still
  clears it.
- **A lot swap that leaves the shelf at its reorder point files a reorder
  request.** Shelf stock is read exactly as the low-stock alert reads it
  (`InventoryService.ready_on_hand`: in-date lots for lot-stocked items), and
  the threshold is the same "at or below". The request asks for enough to
  bring ready stock back to **twice the reorder point**, is `high` urgency when
  the shelf is empty and `normal` otherwise, and is skipped while the item has
  any request pending, approved, ordered or partially received. It lands in the
  quartermaster's reorder queue, and an email goes to the same audiences as the
  low-stock alert, so an EMS Supply Officer hears about medical items only.

`AutoReorderService` runs **after the swap commits, in a session of its own**.
Inside the swap it would take the item lock after the lot lock — the reverse of
`add_lot` — and risk InnoDB aborting a crew's swap as a deadlock victim; and a
rollback in the request's session would expire the endpoint's loaded objects. A
failure there is logged and never fails the swap; the daily low-stock alert
still covers the item.

Recipients are grouped by the domains they may actually see:

```python
_stock_alert_audiences(db, org_id)
# -> {frozenset({"gear", "medical"}): [...],
#     frozenset({"medical"}):         [...]}
```

Each group receives a message containing **only its own rows**, and expiring
lots are fetched per domain.

> **Why grouping rather than filtering per recipient.** Someone holding both
> grants lands in the two-domain group and receives **one** complete email
> rather than two partial ones.

Two boundary decisions inside that:

- **The deployed-on-apparatus sections go to every recipient.** That is
  checklist content governed by `inventory.check_*` (named `equipment_check.*`
  until 2026-08-31) — a different permission axis, not the supply domain.

**Email only.** An earlier version of this section said an SMS carried the
count. Since 2026-08-16 low-stock and expiring-supply notices are email-only:
SMS is reserved for the alerts in the `SmsAlert` allowlist, which names neither
_(corrected 2026-10-04)_.

### Two defects worth knowing about, both fixed

- **The alerts had never been delivered at all.** Low-stock, NFPA-retirement
  and expiring-supply recipients were filtered on `u.role` — a column `User`
  does not have, since roles are the many-to-many `positions` relationship. Every
  send raised `AttributeError` inside the per-organization guard, which logged
  it and moved on. Recipients now resolve through the permission via the roles
  relationship.
- **Widening the audience leaked the other domain.** Adding medical-only
  officers to the low-stock and expiring-supply alerts handed them a single
  rendered table built from _every_ row — gear item names, categories and
  counts the API refuses them by design. **Mailing the data is the same
  disclosure as serving it**, so the fix that closed one gap opened a smaller
  one. That is what the per-domain grouping above exists to prevent.

---

## API reference

All routes under `/api/v1/medical-supplies`. Every one accepts the domain
permission **or** the broad equivalent.

| Method   | Path                        | Permission |
| -------- | --------------------------- | ---------- |
| `GET`    | `/categories`               | view       |
| `POST`   | `/categories`               | manage     |
| `PATCH`  | `/categories/{category_id}` | manage     |
| `DELETE` | `/categories/{category_id}` | manage     |
| `GET`    | `/items`                    | view       |
| `GET`    | `/items/{item_id}`          | view       |
| `POST`   | `/items`                    | manage     |
| `POST`   | `/items/create-if-absent`   | manage     |
| `PATCH`  | `/items/{item_id}`          | manage     |
| `POST`   | `/items/{item_id}/retire`   | manage     |
| `GET`    | `/items/{item_id}/lots`     | view       |
| `POST`   | `/items/{item_id}/lots`     | manage     |
| `POST`   | `/lots/bulk`                | manage     |
| `PATCH`  | `/lots/{lot_id}`            | manage     |
| `DELETE` | `/lots/{lot_id}`            | manage     |
| `GET`    | `/lots/expiring`            | view       |
| `GET`    | `/summary`                  | view       |

`/summary` reports counts for the landing page. **Low stock is judged against
the item's own reorder point**, not a global threshold — the department's floor
for gauze is not its floor for epinephrine.

---

## Data model

No new tables. The module is a **domain view** over the existing inventory
schema:

| Object                    | Change                                 |
| ------------------------- | -------------------------------------- |
| `InventoryItem.item_type` | New enum member **`medical`**          |
| `InventoryCategory`       | Categories carry the medical item type |
| `inventory_lots`          | Unchanged — reused as-is               |

> **`ItemType.MEDICAL` was appended, never inserted.** MySQL stores an `ENUM` as
> its ordinal, so a mid-list insert would silently reclassify every existing
> category. If you add another member, append it too.

---

## Migrations

| Revision        | What it does                                                                                                                                                                                                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260816_0004` | Adds `medical` to the `item_type` enum                                                                                                                                                                                                                                            |
| `20260816_0005` | **Backfill for existing organizations.** Seeds only materialize at organization creation, so this idempotently creates the EMS Supply Officer position, adds the medical grants to the positions that seed with them, and gives the Apparatus Officer the `equipment_check.*` set |

The `_0005` upgrade is idempotent by skipping rows that already hold a grant.

> **Its downgrade was destructive and is now guarded** _(fixed 2026-08-16)_. It
> removed the medical and `equipment_check` permissions **unconditionally**,
> including ones a department had granted by hand long before the migration —
> while the comment above it claimed the opposite.

---

## Edge cases

| Scenario                                                     | Behavior                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Department runs one supply line                              | Unaffected. `inventory.view` / `inventory.manage` reach everything, and `inventory.*` still grants all                                                                                                                                                                                                                      |
| EMS officer requests a **gear** item by id                   | `404` — not `403`. To that officer the item does not exist, and a 403 would confirm the id is real                                                                                                                                                                                                                          |
| EMS officer opens a gear listing                             | Medical-domain items and categories are excluded from gear listings, and vice versa                                                                                                                                                                                                                                         |
| Update sends `{"category_id": null}`                         | **Refused.** `exclude_unset` keeps the key and a truthiness check used to read the null as absent, so the update cleared the column and stranded the item as uncategorized — invisible to this page's filter, visible in the gear page's uncategorized rows, with no way back. Now checks key presence _(fixed 2026-08-16)_ |
| "On hand" edited on a lot-stocked item                       | The field is not editable; the lot figure is shown with a pointer to **Receive delivery**                                                                                                                                                                                                                                   |
| An item's lots have all expired                              | On hand reads **zero**, not the item's stale `quantity`                                                                                                                                                                                                                                                                     |
| A lot passes its expiration date                             | Stops counting toward on hand, is flagged, and the equipment-check swap **refuses** it                                                                                                                                                                                                                                      |
| One line of a receive-delivery batch fails validation        | **Nothing is written.** Fix the line and resubmit the whole delivery                                                                                                                                                                                                                                                        |
| Module toggled off after data exists                         | The page and routes become unreachable; **no data is deleted**. Items keep their `medical` type and reappear when it is turned back on                                                                                                                                                                                      |
| Department has an EMS officer but no `equipment_check` usage | Harmless — the role holds the permissions; nothing forces a checklist to exist                                                                                                                                                                                                                                              |

---

## Related

- [Inventory module (gear)](../wiki/Module-Inventory.md)
- [Role system](../ROLE_SYSTEM_README.md)
- [Application pages](../APPLICATION_PAGES.md)
- [Training guide 05 — Gear & supplies](./training/05-inventory.md)
- [August 16–17 change audit](./CHANGE_AUDIT_2026-08.md#change-audit-august-1617-2026)
