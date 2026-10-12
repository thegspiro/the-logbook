# Medical Supplies Module

EMS consumables — gauze, saline, epinephrine, glucometer strips — tracked as
**dated lots** rather than one flat count, on their own page rather than mixed
into the gear catalog.

Added 2026-08-16. **Off by default.**

> The deeper engineering reference lives in the source repository at
> [`docs/MEDICAL_SUPPLIES_MODULE.md`](../docs/MEDICAL_SUPPLIES_MODULE.md).

## Why it is separate from the gear and uniform pages

The two supply lines answer different questions and are usually owned by
different people:

|                  | Gear and uniforms     | Medical Supplies             |
| ---------------- | --------------------- | ---------------------------- |
| Tracked by       | Individual unit       | Quantity and expiration date |
| Belongs to       | A named member        | The rig                      |
| Ends its life by | NFPA retirement clock | Being used, or expiring      |
| Typical owner    | Quartermaster         | EMS Supply Officer           |

Before the split the quartermaster's catalog filled with items they did not
order, the EMS officer had no page of their own, and — most importantly — there
was no permission that reached only their half.

## Enabling it

**Settings → Modules → Medical Supplies.** Off by default, so a department that
does not run EMS never sees the page.

> **If you are on a department created before 2026-08-16 and the toggle is
> missing**, you are on a build from that week. The setting existed in the
> schema and in onboarding but was not wired into the Settings page, so
> established departments got it defaulted off with no way to turn it on. Fixed
> the same week — update, and the toggle appears.

## Permissions

| Permission                 | Grants                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `inventory.view_medical`   | Read medical items, categories, lots, the expiring list and the summary                     |
| `inventory.manage_medical` | Create and edit medical items and categories; add, edit and delete lots; receive deliveries |

**Every medical route accepts either the domain permission or the broad
`inventory.view` / `inventory.manage`.** So:

- A department running **one** supply line is unaffected — the quartermaster
  reaches medical stock exactly as before, with no new grant needed.
- `inventory.*` still grants everything.
- A department that **splits** the job drops the two medical permissions from
  the quartermaster and appoints an EMS Supply Officer.

## The EMS Supply Officer role

A new system role (priority 55) holding the two medical permissions **plus the
whole `equipment_check.*` set** — both halves of the shelf-to-truck loop, since
stock is only useful if the same officer can put it on the apparatus checklist
and see what is expiring out there. Plus `apparatus.view`, `locations.view`,
and the baseline directory reads.

**It has no access to gear or uniforms.** That is the point of the role.

The **Apparatus Officer** role now states the medical permissions explicitly.
Nothing was widened — it already reached medical stock through the broad
`inventory.manage`; the role editor is simply honest about it now. It also
gained the `equipment_check.*` set its description had always promised.

> `equipment_check.*` was renamed `inventory.check_*` on 2026-08-31, with the
> stored grants migrated, so both roles now hold `inventory.check_view` /
> `.check_submit` / `.check_manage`.

## Pages

| Page                      | Route                          | Opens on                                                                                        |
| ------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------- |
| Medical Supplies          | `/medical-supplies`            | **What is expiring** — with an all-supplies tab, an add-supply form and a receive-delivery form |
| Medical Supply Categories | `/medical-supplies/categories` | Category management                                                                             |

The page opens on the expiring tab rather than the catalog because, for a
consumable with a shelf life, _"what am I about to lose"_ is the question that
brings someone to the page.

The headline tiles read **Expiring within 30 days** and **Low stock**
_(2026-09-29; the second was "Below reorder point", though it counts items at or
below it)_. A category's threshold reads "Low stock at _N_ or below", and a
search that matches nothing says **No matching supplies** rather than claiming
the catalog is empty.

### Receive delivery

Books a whole shipment as **one dated lot per item line** — item, lot number,
expiration, quantity — under a single received date. This is the only way to
add stock to a lot-tracked item.

**If one line fails validation, nothing is written.** Fix the line and resubmit
the whole delivery.

Each line is labelled **Line 1**, **Line 2**… for screen readers _(2026-09-30)_.

## On-hand comes from the lots

For any item that has lots, on-hand is the sum of its **in-date** lots — not the
`quantity` field.

- **Expired lots count as zero.** The equipment-check swap refuses them, so
  counting them would hide exactly the shortage most in need of ordering.
- **"On hand" is not editable on a lot-stocked item.** The field is replaced by
  the lot figure and a pointer to **Receive delivery**. (Until 2026-08-17 it was
  an editable box that wrote a value nothing displayed — you could change it,
  get a success toast, and watch the number stay put.)
- **The item page's Stock Lots panel counts the same way** _(2026-09-30)_. It
  used to total expired lots as ready units, disagreeing with this page; it now
  counts in-date lots only and shows "· _N_ expired" beside them.
- **A retired item's lots drop out** of the expiring list, the summary counts
  and the supply-expiry email _(2026-09-30)_.
- **Open:** the main dashboard's **Low stock** widget sums the item `quantity`
  column, which a lot-stocked item leaves at 0, so it can call a well-stocked
  medical category empty (workflow review W47-6, in KNOWN_LIMITATIONS).

## Alerts

Low-stock and expiring-supply alerts reach both the gear officer and the EMS
officer. **NFPA retirement alerts stay with the gear officer** — that is
structural PPE and has no medical analogue.

_(2026-10-05)_ The weekly supply email is now titled **Supplies to Replace**: it
covers expiring items, items a crew reported used or pulled, and positions
counted below target, and its subject counts each kind separately. The deployed
tables' **Expires** column is **Status** ("Restock reported", "Short — 2 of 4
aboard", or the expiry date with days left). Low-stock says "at or below reorder
point" and the NFPA email "approaching or past". Medical-only managers can no
longer edit an item whose category was reclassified out of their domain mid-edit
(the domain is re-checked under the lock), and maintenance cannot be completed
as `RETIRED`: use the retire action.

**Each recipient group receives only the rows it is allowed to see.** Someone
holding both grants receives **one** complete email rather than two partial
ones. These alerts are **email only** — an earlier version of this page
mentioned a text-message version; SMS is reserved for the `SmsAlert` allowlist,
which names neither _(corrected 2026-10-04)_.

> Two defects here are worth knowing about if you are upgrading from before
> 2026-08-16. First, **these alerts had never been delivered at all** — the
> recipient lookup referenced a column that does not exist, so every send failed
> silently. Second, the fix that widened the audience initially sent EMS
> officers the full gear table; mailing the data is the same disclosure as
> serving it, so recipients are now grouped by what they may actually see.

## Naming

The gear side is **Inventory**, administered from **Inventory Admin**. The
screens under it keep the vocabulary a quartermaster uses:

| Screen             | Label               |
| ------------------ | ------------------- |
| Catalogue          | **Inventory**       |
| Administration hub | **Inventory Admin** |
| A member's own kit | **My Issued Gear**  |
| Member requests    | **Gear Requests**   |
| Multi-item issue   | **Gear Kits**       |

The module was briefly called "Gear & Uniforms" outright, when that was all it
held; it now covers EMS supplies on the same catalog, so the area carries the
category name and the gear language stays on the gear screens.

**Routes and table names are unchanged**, so no existing link, bookmark or
integration breaks.

## Edge cases

| Scenario                                                  | Behavior                                                                                                                                                                                                        |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EMS officer opens a **gear** item by its id               | **404, not 403.** To an officer scoped to medical stock that item does not exist, and a 403 would confirm the id is real                                                                                        |
| Gear listings                                             | Exclude medical-domain items and categories, and vice versa                                                                                                                                                     |
| Clearing an item's category                               | Refused. An explicit null used to clear the column and strand the item as uncategorized — invisible to this page's filter, visible in the gear page's uncategorized rows, with no way back _(fixed 2026-08-16)_ |
| Every lot for an item has expired                         | On hand reads **zero**, not the item's stale quantity                                                                                                                                                           |
| Module toggled off after data exists                      | The page becomes unreachable; **no data is deleted**. Items keep their type and reappear when it is turned back on                                                                                              |
| Department has an EMS officer but no apparatus checklists | Harmless — the role holds the permissions; nothing forces a checklist to exist                                                                                                                                  |

## Upgrading

Two migrations, both in the 2026-08-16 chain:

- `20260816_0004` adds the `medical` item type.
- `20260816_0005` backfills **existing** organizations — seeds only materialize
  at organization creation, so this creates the EMS Supply Officer position,
  adds the medical grants to the positions that seed with them, and gives the
  Apparatus Officer the `equipment_check.*` set. It is idempotent, skipping
  rows that already hold a grant.

## Related

- [Inventory (gear)](Module-Inventory)
- [Role System](Role-System)
- [Apparatus](Module-Apparatus)
- [Recent changes, Aug 16–17](Recent-Changes-2026-08-16-to-17)
