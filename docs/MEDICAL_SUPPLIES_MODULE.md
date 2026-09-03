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
5. [Lots and on-hand](#lots-and-on-hand)
6. [Alerts](#alerts)
7. [API reference](#api-reference)
8. [Data model](#data-model)
9. [Migrations](#migrations)
10. [Edge cases](#edge-cases)

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

---

## Pages

| Route                          | Page                                                                                                                       | Permission                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `/medical-supplies`            | Medical Supplies — opens on **what is expiring**, with an all-supplies tab, an add-supply form and a receive-delivery form | `inventory.view_medical` **or** `inventory.view` |
| `/medical-supplies/categories` | Medical supply categories                                                                                                  | `inventory.view_medical` **or** `inventory.view` |

Writes on both pages require the corresponding `manage` permission.

**The page opens on the expiring tab, not the catalog.** For a consumable with
a shelf life, "what am I about to lose" is the question that brings someone to
the page; "what do we stock" is the reference behind it.

### Receive delivery

Books a whole shipment as **one dated lot per item line** — item, lot number,
expiration, quantity — under a single received date. This is the only way to
add stock to a lot-tracked item; see [Lots and on-hand](#lots-and-on-hand).

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

## Lots and on-hand

Medical supplies use the same dated-lot machinery as other consumables
(`inventory_lots`, 2026-08-10). The rules that matter here:

- **On-hand comes from in-date lots** for any item that has them, and from
  `InventoryItem.quantity` for the rest.
- **Expired lots count as zero.** The equipment-check swap refuses them, so
  counting them would hide exactly the shortage most in need of ordering.
- One shared helper backs the reorder alert, the items grid and the CSV export,
  so the three cannot disagree.

> **"On hand" is not editable on a lot-stocked item** _(fixed 2026-08-17)_. The
> field writes `quantity`, but a lot-stocked item's count comes from its lots —
> the ledger the page and the summary actually display. A manager could change
> the box, get a success toast, and watch the number stay put. The field is now
> replaced for such items by the lot figure and a pointer to **Receive
> delivery**, and `quantity` is left out of the payload entirely rather than
> sent as a null that would clear a column nothing shows.

---

## Alerts

Low-stock and expiring-supply alerts reach both domains; **NFPA retirement
stays with the gear officer**, since it is structural PPE and has no medical
analogue.

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
  checklist content governed by `equipment_check.*` — a different permission
  axis, not the supply domain.
- **The SMS carries only a count**, so it is not split, and it says so.

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
| `GET`    | `/items`                    | view       |
| `GET`    | `/items/{item_id}`          | view       |
| `POST`   | `/items`                    | manage     |
| `PATCH`  | `/items/{item_id}`          | manage     |
| `GET`    | `/items/{item_id}/lots`     | view       |
| `POST`   | `/items/{item_id}/lots`     | manage     |
| `POST`   | `/receive`                  | manage     |
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
- [August 16–17 change audit](./CHANGE_AUDIT_2026-08-16_TO_17.md)
