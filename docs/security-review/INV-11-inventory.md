# Security Review 11 — Inventory

**Prefix:** `INV` · **Iteration:** 11 · **Reviewed:** 2026-08-28 (pass 2), 2026-09-02 (pass 3), 2026-09-08 (pass 4) · **PR:** [#1957](https://github.com/thegspiro/the-logbook/pull/1957) (pass 2), [#2188](https://github.com/thegspiro/the-logbook/pull/2188) (pass 3), [#2422](https://github.com/thegspiro/the-logbook/pull/2422) (pass 4)

---

## Pass 4 (2026-09-08)

**Backend:** `api/v1/endpoints/inventory.py` (144 routes, 1 WebSocket, up from
137 at pass 3), `services/inventory_service.py` (~11,020 L, up from ~8,850),
`api/v1/endpoints/labels.py` (12 routes, unchanged), `services/label_service.py`,
`services/label_printer_service.py` (both unchanged — zero diff since pass 3's
merge)
**Frontend:** `modules/inventory/*` (pages, components, routes, types) — see
scope note below on what was actually read
**Migrations:** five landed since pass 3's merge (`a964f782a`) that touch this
module's tables: `a1c7e93b2d54` (`equipment_requests.requested_size`),
`b8e3f1a97c24` (`inventory_items.style_attributes`), `c4f7a2e91b38`
(`member_size_preferences.garment_fit`), `d3f8b6a24c91` (merge point, no
schema change), `f2a91c7d4e86` (`inventory_item_pins`) — all read in full, see
[Schema & migration notes](#schema--migration-notes)

### Correction to pass 3's own baseline count

Pass 3's doc states "up from 26" for `labels.py`'s route count at pass 2's
merge. Re-counted this pass with the same AST-style enumeration used
throughout this rotation: `labels.py` carries **12** routes, not 26, and has
had zero diff since pass 3 merged — so the 26 was already wrong when pass 3
wrote it, the identical stale-snapshot pattern pass 1 and pass 3 each already
corrected in the other file (`module-audit/inventory.md`'s "116 vs 132", pass
3's own "132 vs 136"). Not a sign of undocumented shrinkage between passes;
corrected here so the next pass's baseline is accurate. Not worth editing
pass 3's already-merged section.

### Correction (Codex review of PR #2422)

The version of this pass first pushed concluded "no new findings, 0 fixes
needed" and marked Feature 11 complete. That was wrong, on two axes at once,
and Codex caught both on review:

1. **Scope was declared narrower than the diff, and the doc said so in its
   own text while still marking the pass complete.** The frontend scope note
   below named eleven files that changed — the pins/grouping UI, the admin
   hub, equipment requests, write-offs, maintenance, `types/index.ts`,
   `variantHelpers.ts`, and four apparatus/fleet/supply screens — as
   genuinely inventory work that "were not read this pass," then declared
   the pass done anyway. A pass cannot honestly claim zero findings over
   ground it never walked, and it also never enumerated the inventory-owned
   MCP tools at all (`app/mcp/tools/inventory.py`,
   `app/mcp/tools/writes.py::create_reorder_request`) — an independently
   authenticated surface this rotation's own precedent (Events, Training)
   treats as belonging to the owning feature's pass, not a future MCP-wide
   sweep. Both gaps are closed below: the frontend files are now read in
   full (see "Scope addition — the frontend files pass 4 first skipped"),
   and the MCP tools get their own first review ("Scope addition — the
   inventory MCP tools").
2. **Three real, fixable defects were sitting inside the ground the first
   draft _did_ claim to cover.** `GET
/requests/{request_id}/fulfillment-options` is a seventh new route in
   `inventory.py`'s own diff, absent from a route table the pass claimed
   enumerated "every route... not spot-checked" — the "+6" delta was wrong,
   corrected to +7 below. `pin_item` and
   `create_size_variants`/`_find_variant_group_for_reuse` are both
   read-then-write capacity/existence decisions with no lock (or an
   incomplete one) on anything that exists before the row being decided
   about — the exact CLAUDE.md pitfall #27 shape this rotation has hardened
   repeatedly elsewhere in this same file (INV-18 through INV-21) and missed
   on these two newer methods. Fixed as INV-23 and INV-24 below, each with a
   guard test confirmed to fail against the pre-fix code.

A fourth, genuinely frontend defect (`SizePreferencesModal.tsx` dropping a
cleared `garment_fit` instead of sending an explicit `null`) is fixed as
INV-25, found during the frontend re-review this correction required. A
fifth item -- unbounded catalog scans in `get_fulfillment_options`/
`get_requestable_categories` -- is recorded as INV-22 but _not_ fixed here:
it is the same shape as this rotation's own DOC-9 (`get_folders`'
`accessible_folder_ids`), where the unbounded read is load-bearing for
correctness rather than incidental, so bounding it needs a design decision,
not a drive-by `LIMIT`. See INV-22 below for why.

Read together, the root cause looks like a scope-definition mistake rather
than carelessness on any single file: the backend review (route
enumeration, migrations, the four re-verified prior flags) was genuinely
thorough, and the pass's own text honestly listed what it had not read — it
just then drew the wrong conclusion from an honest partial scope note,
declaring the _feature_ clean instead of declaring the _reviewed portion_
clean and leaving the row open. The fix in this PR is procedural as much as
it is the five findings below: nothing is marked done while the pass's own
scope note lists unread files or an unenumerated tool surface.

### Correction (round 2, Codex review of commit `608a7a433`)

A third Codex review round, on the commit that closed out the round above,
found three more problems — one a genuine P1. All three investigated against
the real code before acting, not taken on the bot's word:

1. **INV-26 (P1) — the round-above's own INV-8/INV-9 note ("no established
   sibling precedent") turned out not to matter: `upsert_member_size_preferences`
   itself had a cross-tenant write, independent of which permission gates the
   route.** `PUT /members/{user_id}/size-preferences` forwards the
   client-supplied path `user_id` straight into the service method, which
   inserted a `MemberSizePreferences` row for that id under the caller's own
   `organization_id` with no check that the referenced `User` is even in that
   org. Fixed by validating with `assert_in_org` before any read or write —
   see INV-26 below.
2. **INV-27 (P2) — this round's own INV-25 fix (switching every blank field
   to an explicit `null`) reopened a failure mode INV-25 itself did not
   create: a non-404 load failure now had a save-ready blank form behind it.**
   `SizePreferencesModal`'s catch block did not distinguish "no preferences
   yet" (404, genuinely safe to show a blank form) from a timeout/500 (not
   safe — the form is blank because the load never returned anything, not
   because there is nothing stored). Fixed by checking `toAppError(err).status`
   and blocking Save until a retry succeeds — see INV-27 below.
3. **The `get_inventory_summary` MCP tool has the same shape Codex itself
   flagged as INV-22, but wasn't caught when the MCP tools got their
   first review above — investigated, and it is a different case.**
   `get_inventory_summary` calls `InventoryService.get_maintenance_due`,
   which materializes every due item with `.all()`. Unlike INV-22's two
   methods, though, `get_inventory_summary` never reads anything off those
   rows except `len()` — no per-item decision needs Python, and
   `get_user_inventory_summary` (a few hundred lines down in the same file)
   already computes its own maintenance-due figure as a plain `COUNT(*)`.
   This one **is** cheaply fixable and was fixed, not flagged — recorded as
   INV-28 below, distinct from INV-22 rather than folded into it, because the
   two are opposite outcomes of the same question (is the full set
   load-bearing for correctness?) and collapsing a fixed one into a flagged
   one would misstate which methods still carry the limitation.

### Scope

Re-verified all four still-open flagged findings from pass 2/3 (INV-8, INV-9,
INV-16, INV-17) against current code — all four confirmed still open and
unchanged, see below.

Then reviewed everything that changed since pass 3's merge (`a964f782a`, PR
#2190). That range is substantial: `inventory.py` gained 311 lines / lost 213
(net +7 routes — corrected from the first draft's "+6"; see [the correction
above](#correction-codex-review-of-pr-2422)), `inventory_service.py` gained
~2,440 lines net across two
distinct sources — genuine new inventory feature work (a pinned shortlist, an
org-wide colour filter, a member-facing "requestable catalog" grouping
variants into products, list-grouping by category/colour/attribute, a
four-axis garment-style-attributes model replacing the old single-value
`style` enum, a `garment_fit` member preference actually read by the
requestable catalog where its predecessor `shirt_style` was stored and never
consulted, and two self-scoped `/my/size-preferences` routes) and a chain of
medical-supplies (MSUP) fixes on this rotation's own feature 23 that touched
`inventory_service.py` because `MedicalSuppliesService` is a thin wrapper over
`InventoryService` — most substantially a domain-pinned retire path and the
identity-map-staleness fix (`populate_existing=True`) this rotation's own
pass 3 (INV-21) introduced, both now generalized: `retire_item` uses
`_get_item_locked` throughout, gates entry into retirement to itself alone
(the generic `update_item` PATCH now rejects `active`/`RETIRED`
status-or-condition outright rather than approximating retire_item's
locked/blocker-checked/audited contract inline — closing a way to skip
`_deactivation_block_reason`'s checks that a permissive PATCH would otherwise
leave open), and extends `_deactivation_block_reason`'s two blocker counts
with `.with_for_update()` — a fresh, correct application of Pitfall #27 to a
read this rotation had not previously flagged. All new/changed service
methods (`get_item_group_counts`, `_build_items_query`, `list_pins`/
`pin_item`/`unpin_item`/`reorder_pins`, `get_item_colors`, `get_requestable_catalog`
/`get_fulfillment_options`/`get_requestable_categories`, `_member_may_request`/
`_passes_restrictions`, `_settle_style_fields`, `retire_item`/
`_deactivation_block_reason`) were read in full. Every new/changed endpoint in
`inventory.py`'s diff was read in full.

Every route in `inventory.py` (144, all it has) was enumerated
programmatically — method, path, and the `current_user`/`Depends(...)`
dependency in each handler's signature — not spot-checked; see
[Route inventory](#route-inventory). The same enumeration confirmed **zero**
routes lack a `current_user` dependency (the WebSocket route authenticates
internally instead, unchanged since earlier passes and not re-audited here
since its diff against `a964f782a` is empty).

**Frontend:** the diff against pass 3 touches `modules/inventory/` at a scale
(65 files, ~7,970 insertions) that is, like pass 3's own frontend diff, mostly
equipment-check (feature 14) work living under this directory —
`EquipmentCheckTemplateBuilder.tsx`, `ChecklistSettingsPage.tsx`,
`ChecklistsAdminPage.tsx`, `MyChecklistsPage.tsx`, `EquipmentCheckForm.tsx`,
`EquipmentCheckReportsPage.tsx`, `equipmentCheckHierarchy.ts`,
`checkSweepContrast.test.ts` — reviewing those here would be scope creep past
this feature's rotation-table row and duplicate feature 14's own pass, per
pass 3's identical reasoning. **This pass's frontend scope is narrowed** to
files that are genuinely inventory feature work: `routes.tsx` (the two
`ProtectedRoute` gate changes — widened admin-hub access and a narrowed
supply-worklist gate, both read in full with their own explanatory comments,
see [Verified good](#verified-good--new-this-pass)), `inventoryHubCards.ts`
(a new typed navigation-card registry with its own subset-of-route-gate
invariant, enforced by `inventoryHubCards.test.ts`), `SizePreferencesModal.tsx`
(the `shirt_style`→`garment_fit` field swap, confirmed to still route
self/admin calls to the correct self- vs. admin-scoped service methods),
`RequestEquipmentModal.tsx` (new — the member-facing gear-request UI, checked
for which service calls it makes; it calls `getRequestableCatalog`/
`createEquipmentRequest` only, no direct item mutation), and `MyEquipmentPage.tsx`
(confirmed it still calls `getUserInventory(user.id)` — the caller's own id,
so the backend's `_require_self_or_quartermaster` gate is trivially satisfied,
not bypassed). **`InventoryItemsPage.tsx` (918-line diff, the group-by/pins UI),
`InventoryAdminHub.tsx` (585-line diff), `EquipmentRequestsPage.tsx`,
`ReorderRequestsPage.tsx`, `WriteOffsPage.tsx`, `ItemDetailPage.tsx`,
`VariantCapsules.tsx`, `ApparatusInventoryPage.tsx`/`ApparatusDetailPage.tsx`,
`FleetBoardPage.tsx`, `SupplyExpiringPage.tsx`, `VariantGroupsPage.tsx`,
`InventoryMaintenancePage.tsx`, `InventoryMembersPage.tsx`, `types/index.ts`,
and `variantHelpers.ts` were not read this pass** — noted explicitly rather
than silently claiming full frontend coverage. This is where the first
draft went wrong: the paragraph above is left as written (it is an honest
account of what was and was not opened), but the pass then marked Feature 11
complete anyway, on the reasoning that the backend surfaces those pages call
were already reviewed and "found to disagree with" nothing — which checks
that the _API_ is correct, not that the _client_ calls it correctly, escapes
no untrusted output, or gates its own UI consistently with what the API
enforces. That inference is not a substitute for reading the files, and the
pass should have left Feature 11's row pending instead of drawing it. See
the correction above and the scope addition immediately below, which
actually opens them.

### Scope addition — the frontend files pass 4 first skipped

All fifteen files named above as unread were read in full this round
(`InventoryItemsPage.tsx`, `InventoryAdminHub.tsx`, `EquipmentRequestsPage.tsx`,
`ReorderRequestsPage.tsx`, `WriteOffsPage.tsx`, `ItemDetailPage.tsx`,
`VariantCapsules.tsx`, `ApparatusInventoryPage.tsx`, `ApparatusDetailPage.tsx`,
`FleetBoardPage.tsx`, `SupplyExpiringPage.tsx`, `VariantGroupsPage.tsx`,
`InventoryMaintenancePage.tsx`, `InventoryMembersPage.tsx`, `types/index.ts`,
`variantHelpers.ts` — sixteen counting `types/index.ts` and the helper
separately), against the three dimensions the review comment named:

- **Untrusted-output handling.** No `dangerouslySetInnerHTML`, no raw
  `innerHTML` assignment, and no `eval`/`new Function` anywhere in the
  sixteen files (checked by grep across the whole set, not sampled). Every
  member-supplied string these pages render (item names, descriptions,
  vendor notes, write-off/return reasons, maintenance notes) goes through
  plain JSX text interpolation, which React escapes; there is no path from a
  stored free-text field to raw HTML. `types/index.ts` and
  `variantHelpers.ts` (`getDisplayName`/`displaySize`) are pure
  formatting/type-declaration code with no rendering of their own.
- **No blocked browser dialogs.** None of the sixteen files call
  `window.confirm`/`alert`/`prompt` (Pitfall #16) — the destructive actions
  in these pages (write-off approval, reorder rejection, unassigning an
  item, deleting a variant group) all route through `useConfirm()`/
  `ConfirmDialog`, matching the rest of the module.
- **No client-side auth/data-exposure gap.** None of the sixteen files call
  `axios`/`fetch` directly (every call goes through the shared
  `inventoryService`, which carries the same CSRF/credentials setup as
  every other module service) or read `localStorage`/`sessionStorage` for
  anything auth-related. None of them re-derive a permission or filter a
  fetched list client-side by role/permission (Pitfall #29's shape checked
  and not found) — each page renders whatever its service call returns, and
  authorization is left entirely to the backend endpoint and the route's own
  `ProtectedRoute` gate, both of which pass 4's backend review already
  confirmed correctly scoped. Cross-checked every one of these pages'
  `ProtectedRoute` gate in `routes.tsx` against the permission the backend
  endpoints it calls actually require (`inventory.manage` for every
  `/inventory/admin/*` screen, matching the routes those pages call) — all
  consistent, with one gap noted below that is a UX inconsistency, not a
  security defect.

**One inconsistency found, not a security finding:** `/inventory/items/:id`
(`ItemDetailPage.tsx`'s route) carries `requiredModule="inventory"` but no
`requiredPermission` at all, while `GET /items/{item_id}` on the backend
requires `inventory.view`. A member with the inventory module enabled but no
`inventory.view` grant can navigate to the URL and reach the page component,
but every data fetch it makes (`getItem`, `getCategories`,
`getStorageAreas`, and on-demand history/maintenance/NFPA/exposure record
calls) still 403s against the backend gate — so no item data is actually
exposed, only a blank/error page where every other admin screen in this
module would have redirected at the route. Not fixed here (a UI-only
consistency gap, not a data-exposure defect — the backend gate is what
actually protects the data), but worth a one-line route-gate fix in a future
pass since every sibling detail-style route in this module does carry a
gate.

No fixable defect found in this scope addition beyond the one above.
`SizePreferencesModal.tsx` — read again as part of the original (narrower)
frontend scope, not this addition — is where INV-25 was actually found; see
above.

### Scope addition — the inventory MCP tools

Not part of any prior pass's declared scope, and not part of the first
draft of this pass either — flagged by Codex, citing this rotation's own
Events/Training precedent that a feature-owned MCP tool surface belongs to
that feature's pass, not a future MCP-wide sweep. Read in full:
`backend/app/mcp/tools/inventory.py` (153 L, 4 read tools —
`get_inventory_summary`, `list_low_stock_items`, `list_inventory_items`,
`list_overdue_checkouts`) and the inventory-specific write tool in
`backend/app/mcp/tools/writes.py` (`create_reorder_request`, ~75 L of that
file's 253).

All five tools were checked against the four dimensions the review comment
named:

- **Authentication/authorization gating.** Every tool call passes through
  `logbook_tool`'s shared wrapper (`app/mcp/registry.py`), which refuses
  before the handler runs unless the caller's module set includes
  `"inventory"` (the same per-org enablement flag the module's own API
  router is gated on) and, for `create_reorder_request`, unless the service
  key's `access_mode` is `read_write` (`gate="write"`) — the four read tools
  carry no `gate`, which is correct: they are plain reads, the same shape
  every other module's read tools use. This is a materially different auth
  model from `require_permission("inventory.view"/"inventory.manage")` —
  there is no per-user permission string behind an MCP service key, only
  the module-enablement and read/write switches an administrator sets when
  issuing the key — and that difference is the model, not a gap in it.
- **Org-scoping (Pitfall #14).** Every read tool calls its `InventoryService`
  method with `org_uuid(principal)` — the principal's own organization,
  never a client-supplied id — so every one of the four is scoped by
  construction to the calling department's own data, through service
  methods (`get_inventory_summary`, `get_low_stock_items`, `get_items`,
  `get_overdue_checkouts`) whose `organization_id` filter is already part of
  the SQL this pass's own backend review read. `create_reorder_request`
  validates both client-supplied FKs (`item_id`/`category_id`) are in-org
  before persisting, twice over: once directly (`item_in_domain`/
  `category_in_domain`, both org-filtered) to refuse a request naming a
  medical-domain item/category, and again inside
  `InventoryService.create_reorder_request` itself via
  `_assert_reorder_fks_in_org` (XC-1, the same helper the REST endpoint
  uses — reused, not reimplemented). The write's actor (`_actor()`) is
  resolved by primary-key lookup and then explicitly checked against
  `principal.organization_id` before being trusted, refusing rather than
  attributing a write to a cross-org or deactivated administrator.
- **Data redaction.** Every tool result passes through the shared
  `redact()` boundary (`app/mcp/redaction.py`) before it leaves the process
  — contact details, identity fields, membership/certification numbers and
  credential-shaped keys are stripped at every depth regardless of which
  field names a tool happens to project, and free text (`checkout_reason`,
  item descriptions) is scrubbed of embedded emails/phone numbers. This is
  shared, already-tested infrastructure (`tests/test_mcp_redaction.py`), not
  something these two files implement themselves — checked that neither
  file's own field projection includes anything the boundary would need to
  catch as a _second_ net (it does not: names, quantities, statuses, dates,
  asset tags — no email/phone/DOB/SSN-shaped field is projected directly).
- **Bounds.** All four read tools clamp `limit`/`offset` through
  `clamp_limit`/`clamp_offset` (`app/mcp/tools/_common.py`,
  `MAX_PAGE_SIZE=200`) before passing them to an already-`LIMIT`/`OFFSET`-
  bounded SQL query (`get_low_stock_items`'s categories, `get_items`,
  `get_overdue_checkouts` all take `skip`/`limit` at the query level, not a
  Python-side slice of an unbounded fetch) — none of the four is the
  INV-22 shape. `list_low_stock_items` fetches `limit + 1` rows to compute
  `has_more` without a second `COUNT` query, capped at `MAX_PAGE_SIZE + 1`
  either way. `create_reorder_request`'s `quantity`/`notes`/`item_name`
  bounds are enforced by re-validating through the same
  `ReorderRequestCreate` Pydantic schema the REST endpoint uses, so an MCP
  caller cannot write what the API would have rejected.

**No fixable defect found.** This is a first-time, full review of a real
surface (not a formality): every dimension above was checked against the
actual code, not inferred from the REST endpoints' own correctness — the
tenancy and redaction guarantees the four dimensions depend on turned out to
already be enforced by shared MCP infrastructure this feature's tools
correctly opt into, rather than anything specific to `inventory.py`/
`writes.py` needing a fix. Mirrors this rotation's own TR-17 experience with
`app/mcp/tools/training.py`: a feature-owned tool file that had never been
swept into a pass, reviewed for the first time, and found tenancy-correct —
though unlike TR-17 (which flagged an unbounded certification-history read),
nothing here needed flagging either.

### Route inventory

Full enumeration of all 144 routes in `inventory.py`; identical to pass 3's
table for the 137 unchanged ones (all still `inventory.view`/`inventory.manage`,
or `get_current_user` plus an in-body self-or-quartermaster/self-or-manage
check — see the four routes below), reproduced here only for what changed.
Seven new routes, not six (the first draft's own "+6" was wrong; see
[the correction above](#correction-codex-review-of-pr-2422) — Codex caught
`fulfillment-options` missing from this table on review):

| Method | Path                                         | Auth dependency      | Permission         | Org-scoped         | Notes                                                                                                                                                                                                                                                                                        |
| ------ | -------------------------------------------- | -------------------- | ------------------ | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/items/colors`                              | `require_permission` | `inventory.view`   | ✅                 | new; was `get_current_user` in the branch's first commit, tightened to `.view` before merge (see [Verified good](#verified-good--new-this-pass))                                                                                                                                             |
| GET    | `/items/pins`                                | `require_permission` | `inventory.view`   | ✅ (+ user-scoped) | new                                                                                                                                                                                                                                                                                          |
| PUT    | `/items/pins/order`                          | `require_permission` | `inventory.view`   | ✅ (+ user-scoped) | new                                                                                                                                                                                                                                                                                          |
| POST   | `/items/{item_id}/pin`                       | `require_permission` | `inventory.view`   | ✅ (+ user-scoped) | new                                                                                                                                                                                                                                                                                          |
| DELETE | `/items/{item_id}/pin`                       | `require_permission` | `inventory.view`   | ✅ (+ user-scoped) | new                                                                                                                                                                                                                                                                                          |
| GET    | `/requestable-catalog`                       | `require_permission` | `inventory.view`   | ✅                 | new                                                                                                                                                                                                                                                                                          |
| GET    | `/requests/{request_id}/fulfillment-options` | `require_permission` | `inventory.manage` | ✅                 | new; missed by the first draft's table (Codex). Resolves the `EquipmentRequest` filtered on `id` **and** `organization_id` (`inventory.py:4004-4020` / `inventory_service.py:get_fulfillment_options`) — cross-tenant-safe; see INV-22 for the abuse-resistance dimension of this same route |

The five bare-`get_current_user` per-member routes that existed before this
pass (`GET /users/{user_id}/assignments`, `GET /users/{user_id}/issuances`,
`GET /users/{user_id}/inventory`, `GET /users/{user_id}/clearance`,
`GET /users/{user_id}/issuance-history`) are unchanged and all still call
`_require_self_or_quartermaster(user_id, current_user)` before touching the
service layer — re-confirmed this pass by reading `_require_self_or_quartermaster`
itself (`inventory.py:236`) and its five call sites. `PATCH
/checkout/{checkout_id}/extend` (also bare `get_current_user`) resolves the
checkout org-scoped first, then checks `is_own or can_manage` inline —
likewise unchanged and re-confirmed.

No new route relaxed a permission, added a bare route with no auth
dependency, or introduced an unauthenticated path. Zero of the 144 routes
lack a `current_user` dependency (enumerated programmatically, not
spot-checked — see [Scope](#scope-1) above; "Scope" is disambiguated with a
`-1` suffix since both this pass and pass 3 use the header).

### Re-verified still open, not re-flagged

- **INV-8 / INV-9** (`GET /allowances/check/{user_id}/{category_id}` and
  `GET /members/{user_id}/size-preferences` gated on the baseline
  `inventory.view` rather than a self-or-quartermaster/`.manage` shape) —
  both routes' `Depends()` are unchanged since pass 2's flag, re-read this
  pass at `inventory.py:5827` and `:6794`. Worth noting explicitly since this
  pass added the _sibling_ self-scoped pair (`/my/size-preferences`,
  `get_current_user` only, correctly scoped to the caller's own row) without
  touching the officer-facing `/members/{user_id}/...` routes this finding is
  about — the new work narrowed the blast radius of the _self_ case rather
  than resolving the pre-existing _cross-member_ gap, which is a different
  question. Still mirrored in `KNOWN_LIMITATIONS.md`; still an owner decision.
- **INV-16** (`update_reorder_request` neither locks the row nor increments
  `version`, unlike `/transition`/`/correct-status`/`/receipts`) —
  `update_reorder_request` re-read in full at
  `inventory_service.py:8051`; still a plain `get_reorder_request` fetch,
  still no `.with_for_update()`, still no version bump. Unchanged.
- **INV-17** (equipment-maintenance "Complete work" always creates a new
  record rather than closing the open one) — `InventoryMaintenancePage.tsx`
  re-checked at the `createMaintenanceRecord` call site; still a single
  unconditional call with no attempt to locate or close an existing open
  record. Unchanged.

### Findings

Seven findings this pass in total, across two Codex review rounds on this
PR, none found independently — see the two "Correction" sections above.
Round 1: three fixed (INV-23, INV-24, INV-25); one flagged, not fixed
(INV-22). Round 2 (on the commit that closed round 1 out): three more, all
fixed (INV-26, a genuine P1 cross-tenant write; INV-27, a save-after-failed-
load regression INV-25's own fix introduced; INV-28, a cheaply-fixable
unbounded scan distinct from INV-22's flagged pair). The rest of the new
feature surface (requestable catalog, list grouping,
garment-style-attributes, self-scoped size preferences) and the MSUP-driven
retire-path hardening were reviewed against the seven checklist dimensions
and found correct — see [Verified good](#verified-good--new-this-pass).

#### INV-22 — MED (abuse resistance) — the fulfillment-options and requestable-categories catalog reads are unbounded — 🚩 flagged, not fixed

**What:** `get_fulfillment_options` (`inventory_service.py:8887-9076`)
materializes its narrowed candidate set with a bare `.all()`
(`:8960-8962`), and when `include_incompatible=true` (the substitution
browse) additionally loads the **entire** organization catalog the same way
(`:9028-9038`) before applying the caller's `limit` in Python, only after
sorting the whole thing (`:9061-9062`). `get_requestable_categories`
(`:9078-9120`) loads one row per active item across every category just to
deduplicate category chips in Python. `docs/security-review/CHECKLIST.md`'s
abuse-resistance dimension rejects an org-wide `.all()` call outright.

**Where:** `backend/app/services/inventory_service.py` —
`get_fulfillment_options`, `get_requestable_categories`.

**Why this is the DOC-9 shape, not the cheaply-fixable one:** both queries'
own docstrings explain _why_ the full narrowed/whole-catalog set has to be
in Python before an answer can be given — `get_fulfillment_options` decides
`can_fulfill_now`/`suggested_item_id`/`requested_size_available` from a
normalized size/colour/style identity comparison that "is not expressible
in SQL," and `get_requestable_categories` decides per-category eligibility
from a rank/position check that has to run per item. The `limit` each
already exposes to its caller behaves like DOC-9's _fixed_ half (the
returned page size); what is unbounded is the _internal_ materialization
needed to answer correctly, which is DOC-9's own `accessible_folder_ids`
shape — the half DOC-9 left flagged because bounding it changes what the
answer means, not merely how it is computed. A SQL-level cap on either
query here has the identical failure mode: truncate the pre-decision set at,
say, 2000 rows and a department whose free-text request (no `item_id`/
`category_id`, so `get_fulfillment_options`' `narrowed` query is the whole
catalog) or whose catalog exceeds that in one category gets a silently
wrong "cannot fulfill"/"category has nothing" answer for rows past the cut
— worse than the current unbounded-but-correct read, and exactly the kind
of "fix" this rotation's own DOC-9 precedent already rejected once.

**Impact:** memory/time cost scales with catalog size on a `.manage`-gated
review screen (`get_fulfillment_options`) and a member-facing browse chip
list (`get_requestable_categories`); not a tenant-isolation or data-exposure
defect — both queries are already org-scoped, and neither returns more rows
to the client than `limit` allows (only the _internal_ working set is
unbounded).

**Not fixed here**, mirroring DOC-9's own disposition: recorded in
`docs/KNOWN_LIMITATIONS.md` under Inventory rather than force-fixed.

#### INV-23 — MED — `pin_item`'s pin-cap check is an unlocked read-then-write — ✅ FIXED

**What:** `pin_item` (`inventory_service.py:2333-2377` before this fix) read
the member's current pin count via `list_pins` (a plain, unlocked `SELECT`),
compared it against `MAX_PINS` (25), and — if under the cap — inserted a new
pin at `position=len(pins)`. No lock on anything, and the count read was not
a locking read (CLAUDE.md pitfall #27, both halves missing).

**Where:** `backend/app/services/inventory_service.py::pin_item`.

**Failure scenario:** a member at 24 pins fires two pin requests for two
different items at nearly the same time (a double-tap, or two tabs). Both
read `len(pins) == 24` before either commits, both pass the `< MAX_PINS`
check, and both insert — one at `position=24`, the other also at
`position=24` (each computed `len(pins)` from its own stale read). The
member ends up with 26 pins, two of them sharing a position, which
`reorder_pins`/the compaction logic in `unpin_item` was not written to
expect.

**Fix:** locks the member's own `User` row (`select(User.id).where(User.id
== ...).with_for_update()`) before deciding the cap — the same
"lock a parent that already exists" shape `push_service.py`'s
`_MAX_PUSH_SUBSCRIPTIONS_PER_USER` cap already uses for an identical
per-member-capacity decision — then replaces the `list_pins`/`len()` count
with a `select(func.count())...with_for_update()` locking read, so the
count decided against is the committed one, not a pre-lock snapshot.

**Verified:** `tests/test_inventory_pin_and_variant_locking.py::
test_pin_item_locks_the_member_row_before_counting_pins` and
`::test_pin_item_counts_existing_pins_with_a_locking_read` — source
inspection, confirmed to **fail** against the pre-fix code (`git stash`)
and **pass** after.

#### INV-24 — MED — first-time variant-group creation has no lock on anything — ✅ FIXED

**What:** `_find_variant_group_for_reuse`'s own `.with_for_update()` locks a
matching `ItemVariantGroup` row when one exists, but — as its own docstring
already said before this fix — "cannot close the case where the group does
not exist yet — there is no row to lock." Two quartermasters quick-creating
the same previously-unseen base name/category could both find no group,
both fall through `create_size_variants`'s `elif create_variant_group:`
branch, and both insert a new `ItemVariantGroup` for the same product.

**Where:** `backend/app/services/inventory_service.py` —
`create_size_variants` (the reuse-or-create branch, `:6514-6537` before this
fix), `_find_variant_group_for_reuse`.

**Failure scenario:** two simultaneous first runs of "generate sizes" for a
product the catalog has never stocked before (no existing
`ItemVariantGroup` row to lock) each create their own group row for the
same name+category. Depending on which of the two InnoDB gap locks land
first, the generated stock either splits across two duplicate products (the
`_variant_key`/`_product_key` collapsing this feature exists to prevent) or
one request loses a deadlock.

**Fix:** locks the `Organization` row — which, unlike the not-yet-created
group, always exists — before calling `_find_variant_group_for_reuse`,
mirroring `ensure_facility_folder`/`ensure_member_folder`'s
organization-row-locked, parent-locked-first shape for their own
get-or-create. Two concurrent first-time creates for the same product now
serialize on the organization lock instead of racing the group lookup.

**Verified:**
`tests/test_inventory_pin_and_variant_locking.py::test_create_size_variants_locks_the_organization_before_reusing_a_variant_group`
— source inspection (asserts the `Organization` lock is acquired, by name,
before the call to `_find_variant_group_for_reuse`), confirmed to **fail**
against the pre-fix code (`git stash`) and **pass** after.

#### INV-25 — MED — `SizePreferencesModal` drops a cleared `garment_fit` instead of sending an explicit `null` — ✅ FIXED

**What:** `handleSave` coerced every blank field, including `garment_fit`,
with `form.field || undefined`. `undefined` is omitted by `JSON.stringify`,
and the backend's `upsert_member_size_preferences` is called with
`data.model_dump(exclude_unset=True)` — a field never present in the
request body is "unset," not "cleared," so a member with a stored fit who
selects "No preference" gets a success toast while the old `garment_fit`
value silently survives. This is CLAUDE.md pitfall #1's update-path shape
exactly: `SizePreferencesModal` is always an upsert of an existing row
(never a distinct create form), so every field it owns needs the
`blankToNull` treatment, not `|| undefined`.

**Where:** `frontend/src/modules/inventory/components/SizePreferencesModal.tsx::handleSave`.

**Impact:** a stale `garment_fit` (or any of the other eight fields — the
same `|| undefined` bug was present on all nine, not only the one Codex's
comment named) keeps steering `get_requestable_catalog`'s fit-based variant
preselection toward gear the member no longer wants, with no way to clear it
from the UI short of picking a different fit and then somehow re-clearing —
which hits the identical bug again.

**Fix:** switched every field in the payload to `blankToNull` (already used
elsewhere in this codebase for exactly this update-path shape), which sends
an explicit `null` for a blank field instead of omitting the key. Widened
`MemberSizePreferencesCreate`'s frontend type (`eventServices.ts`) to
`string | null | undefined` per field, since `exactOptionalPropertyTypes`
otherwise refuses assigning `null` to a `string | undefined` property.

**Verified:** `SizePreferencesModal.test.tsx` — the existing save test was
updated (it had asserted the _old_, buggy behaviour — blank fields arriving
as `undefined` — so it had to change to assert the fix, not merely add
alongside it) plus a new regression test,
`'clearing a stored fit back to "No preference" sends an explicit null, not
a dropped key'`. Both confirmed to **fail** against the pre-fix component
(`git stash`) and **pass** after.

#### INV-26 — P1 — `PUT /members/{user_id}/size-preferences` never validated the target user is in the caller's organization — ✅ FIXED

**What:** `upsert_member_size_preferences`'s create branch inserted a new
`MemberSizePreferences` row keyed on the client-supplied path `user_id`,
stamped with the caller's `organization_id` — with no check that the `User`
referenced by that id actually belongs to that organization. CLAUDE.md
Pitfall #14c exactly: a client-supplied FK id persisted without validating it
is in-org.

**Where:** `backend/app/api/v1/endpoints/inventory.py::upsert_member_size_preferences`
(the endpoint forwards the path param unchanged);
`backend/app/services/inventory_service.py::upsert_member_size_preferences`
(the actual gap — no read or write in the method touched `organization_id`
against the `User` table at all).

**Failure scenario:** an inventory manager in org A calls `PUT
/members/{user_id}/size-preferences` with a `user_id` UUID belonging to org
B (guessed, enumerated, or known from a prior cross-org interaction
elsewhere). The endpoint's own permission gate (`inventory.manage`) only
proves the caller holds that permission _in their own org_ — CLAUDE.md
Pitfall #14b, `require_permission` does not scope the object — so the
service method proceeds, finds no existing row for that `user_id` +
org A's `organization_id`, and creates one: a `MemberSizePreferences` row
naming org B's user but stamped with org A's `organization_id`.

**Impact, and why this is worse than an ordinary cross-tenant write:**
`MemberSizePreferences.user_id` is `unique=True` at the model level
(`backend/app/models/inventory.py`). Once the poisoned row exists, org B's
own admin — or the member themself, via `PUT /my/size-preferences` — can
never create their own legitimate row for that user again: any attempt hits
the same unique constraint the poisoned row already occupies, an
availability bug stacked on top of the cross-tenant write, and one that
persists indefinitely until someone notices and manually deletes the wrong
row.

**Fix:** `assert_in_org(self.db, User, user_id, organization_id, label="User")`
at the top of `upsert_member_size_preferences`, before the existing-row
lookup — the same helper and call shape `attendance_dashboard_service.py`'s
`grant_waiver` already uses for an identical "client-supplied user id on a
create/update path" case. `assert_in_org` raises `ValueError("Invalid
User")`, which the existing `except Exception` in this method already turns
into `(None, str(e))`, and the endpoint's existing `if error: raise
HTTPException(400, ...)` already turns into a 400 — no endpoint-layer change
needed, the validation slots into the contract that was already there.

**Verified:** new file `tests/test_inventory_size_preferences_org_scoping.py`
(real database, two organizations, not source inspection) —
`test_upsert_rejects_a_user_from_another_organization` creates org A and org
B with a user in org B, calls the service method with org B's user id under
org A's `organization_id`, and asserts both that the call is rejected
(`error` is set, `prefs` is `None`) and that no `MemberSizePreferences` row
was created at all — not under org A and not misattributed to org B either.
`test_upsert_still_succeeds_for_a_same_org_user` pins the ordinary, intended
case is untouched. Confirmed the rejection test **fails** against the
pre-fix service method (temporarily restored from `HEAD`) — it creates the
row and returns it rather than rejecting — and **passes** after.

#### INV-27 — P2 — `SizePreferencesModal` could clear every preference after a transient load failure, a regression INV-25's own fix introduced — ✅ FIXED

**What:** the initial `GET`'s catch block treated every failure alike: a 404
("no preferences yet," genuinely safe to show a blank form) and a timeout,
500, or offline state (not safe — the form is blank because the load never
returned anything, not because there is nothing stored) both fell through to
`setForm(EMPTY)` with Save left enabled. Before INV-25's fix this only meant
the member would see stale-looking blanks after a retry; INV-25 changed
`handleSave` to send every blank field as an explicit `null` instead of
omitting the key (correctly, for the bug it fixed — see INV-25 above), which
means the same code path that used to be merely uninformative now actively
clears every preference the failed load never got a chance to see.

**Where:** `frontend/src/modules/inventory/components/SizePreferencesModal.tsx::load`
(the undifferentiated catch) and `handleSave` (which had no way to know the
form it was about to submit was never actually loaded).

**Failure scenario:** a member with several stored sizes opens the modal on
a flaky connection; the initial `GET` times out or 500s. The modal shows a
blank, apparently-ready form. The member — or, in admin mode, a
quartermaster editing someone else's sizes — fills in nothing (there is
nothing to fill in without knowing the old values) and clicks Save anyway,
or simply clicks Save to dismiss what looks like an empty form. Every field
now serializes as an explicit `null` (INV-25's fix), and the upsert clears
every preference that member had, silently, behind a "Sizes saved" toast.

**Fix:** `load`'s catch now branches on `toAppError(err).status`. A 404
behaves exactly as before (blank form, Save enabled — the genuinely safe
case). Anything else sets a new `loadError` state instead: Save is disabled,
an inline error banner explains why and offers a "Try again" button that
re-runs `load()`, and `handleSave` itself also bails out if `loadError` is
still true (belt-and-suspenders against a stray call site). This is the same
distinction `InventoryMaintenancePage.tsx` already draws on its own load
failure (404 silent, anything else surfaced) and the same `loadError` boolean
shape `useMaintenanceForm.ts` already uses to gate a form on a failed load.

**Verified:** `SizePreferencesModal.test.tsx` — the existing "load rejects"
test was corrected to reject with a realistic 404-shaped error (it had used
a bare `Error('404')`, which `toAppError` does not read a status off of, so
it was accidentally exercising the same code path as any other failure) and
now also asserts Save stays enabled and a save actually fires. Two new
tests: one rejects with a 500-shaped error and asserts Save is disabled, the
error banner is shown, and a direct click does not fire the clearing
payload; the other confirms "Try again" recovers the form and re-enables
Save once the retried load succeeds. All confirmed to **fail** against the
pre-fix component (temporarily restored from `HEAD`) — the 500 case shows no
alert and no disabled Save, the retry case has no "Try again" button to
click — and **pass** after.

#### INV-28 — P2 — `get_inventory_summary`'s maintenance-due figure materialized every due item to compute a count — ✅ FIXED

**What:** `get_inventory_summary` called `self.get_maintenance_due(...)`,
which runs `select(InventoryItem)...` with no limit and returns the full
ORM row set via `.all()`, then discarded everything from that list except
its length (after filtering out excluded-domain rows in Python). Reachable
from `GET /inventory/summary` (the admin-hub dashboard widget) and,
ungated by any extra check, the `get_inventory_summary` MCP tool — so an
org-wide `InventoryItem` materialization ran on every summary read, purely
to produce one integer.

**Where:** `backend/app/services/inventory_service.py::get_inventory_summary`
(the caller); `::get_maintenance_due` (the `.all()` itself, unchanged and
still correct for its one remaining caller, the `GET /maintenance-due`
listing endpoint, which genuinely needs the rows).

**Why this is not the same disposition as INV-22:** INV-22's two methods
each need the full pre-decision set in Python because per-row eligibility
(a normalized size/colour/style match, a rank/position check) is not
expressible as a SQL `WHERE`. Nothing about `get_inventory_summary`'s use of
the list is like that — it only ever called `len()` on the (already
Python-filtered) result. `get_user_inventory_summary`, a few hundred lines
down in the same file, already computes its own per-user maintenance-due
figure this way (`select(func.count(InventoryItem.id))...`), so a COUNT-based
answer here is not a new pattern in this file, just one this method had not
been written to use.

**Impact:** memory/time cost scaling with the organization's total item
count on every dashboard load and every MCP `get_inventory_summary` call —
an abuse-resistance/DoS-shaped concern (CHECKLIST.md's unbounded-scan
dimension), not a tenant-isolation or data-exposure defect: the query was
already org-scoped and returned only a count to the client either way.

**Fix:** replaced the `get_maintenance_due()` call and the Python `len()` +
category-exclusion filter with a direct `select(func.count(InventoryItem.id))`
reusing the same `item_filters` list (`organization_id`, `active`, and — when
present — the `_outside_domains(...)` predicate for `exclude_item_types`)
already built earlier in the method for `total_items`/`items_by_status`/etc,
plus the `next_inspection_due <= cutoff` condition. Reusing `item_filters`
rather than re-deriving the org/active/domain filters means this can't drift
from what the rest of the summary already counted against, and it let the
now-unused `excluded_category_ids` query (previously computed solely to
filter the materialized list) be deleted outright rather than left dead.

**Verified:** new file
`tests/test_inventory_summary_maintenance_due_bounded.py` — a
source-inspection regression guard
(`test_get_inventory_summary_does_not_materialize_every_due_item`, asserting
`get_maintenance_due(` does not appear in `get_inventory_summary`'s source,
confirmed to **fail** against the pre-fix method and **pass** after) plus
three real-database correctness tests (due-window filtering, inactive-item
exclusion, and `exclude_item_types` carving out the medical domain the way
`item_filters` already does for every other figure in this response) — all
four pass identically before and after the refactor, which is the point:
the fix changes how the number is computed, not what it computes.

### Verified good ✅ (new this pass)

- **Every new/changed route is correctly gated and org-scoped.** `GET
/items/colors` requires `inventory.view` and answers from
  `_known_colors(organization_id)`, an org-filtered `DISTINCT` query — the PR
  history shows this route started life on plain `get_current_user` and was
  tightened before merge (its own docstring explains why: it previously let
  any authenticated member read a value `GET /items` itself would deny them).
  The four pin routes and `/requestable-catalog` are `inventory.view`-gated
  and additionally scope every read/write to `(organization_id, user_id)` —
  `list_pins`/`pin_item`/`unpin_item`/`reorder_pins` all filter on both
  columns, so one member's shortlist is invisible to and unwritable by
  another even though the permission grant is the department-wide baseline.
  `pin_item` validates the referenced `item_id` is in-org before persisting
  the pin (`get_item_by_id(item_id, organization_id)` returning `None` raises
  `ValueError("Item not found")`, XC-1) and is idempotent (re-pinning an
  already-pinned item returns the existing row rather than erroring or
  duplicating).
- **The requestable catalog does not leak restricted gear's existence to
  members it is restricted from.** `get_requestable_catalog` filters the
  eligible list through `_member_may_request` — the same
  `_passes_restrictions` rank/position check `POST /requests` itself
  enforces at submission — _before_ grouping into products, so a
  rank-or-position-restricted item a member cannot request is not shown to
  them as an unfulfillable option (the code's own comment names this
  explicitly: "without it the modal lists gear the member is then refused at
  submit, and the restricted item's existence leaks to everyone").
  `get_requestable_categories` applies the identical check to category
  chips, for the same reason — an empty-after-filtering category would
  otherwise be a visible chip disclosing restricted stock exists. Both
  eligibility checks and the underlying rank/position lookups
  (`_member_rank_order`, `_member_position_slugs`) are org-scoped.
- **`_build_items_query`'s `search` filter and `get_requestable_catalog`'s/
  `_fulfillment_base_query`'s own search filters all use `like_pattern()` +
  `escape=LIKE_ESCAPE_CHAR`** (Pitfall #25) — checked every `.ilike(` call
  site added or touched in the diff; none use a bare pattern.
- **The retire-path hardening (MSUP fix-chain spillover) is Pitfall
  #27-correct and closes a life-safety-adjacent gap the generic PATCH left
  open.** `retire_item` now routes through `_get_item_locked` uniformly
  (fixing the same identity-map staleness class INV-21 fixed on the
  return/check-in paths, generalized here); its new
  `_deactivation_block_reason` helper makes both blocker counts
  (`CheckOutRecord`/`ItemIssuance` active-row counts) locking reads via
  `.with_for_update()`, with a comment correctly explaining _why_ the item
  lock alone is not enough under REPEATABLE READ (the count query's own
  snapshot predates the lock unless the count itself locks). Separately,
  `update_item` (the generic PATCH) now rejects any attempt to set `active`,
  or a `status`/`condition` pair equal to `RETIRED`, forcing every path into
  retirement through `retire_item`'s locked/blocker-checked/audited
  contract — closing a route that previously could flip an item's `active`
  flag or retired status/condition without running `_deactivation_block_reason`
  at all, silently orphaning an unsafe item's status if it happened to
  already be assigned or checked out (the update would have raced the block
  entirely, since it never checked). This is a defensive tightening, not a
  regression fix for a _reported_ bug in this pass's diff — mentioned here
  because it is exactly the class of gap Pitfall #27 and INV-12 both exist to
  close, caught this time before shipping rather than after.
- **No new injection surface, no new CSV export, no `window.confirm`/
  `alert`/`prompt`** anywhere in the diff (Pitfalls 15/16) — `inventory.py`'s
  two CSV exports still route through `SafeCsvWriter`, unchanged (confirmed:
  zero diff on those code paths since pass 3).
- **All five migrations since pass 3 are correctly structured** — see
  [Schema & migration notes](#schema--migration-notes-1).
- **`labels.py`'s printer-configuration routes remain correctly gated.** The
  six `/label-printers*` write/probe/status routes all require
  `settings.manage`/`organization.update_settings` (an initial programmatic
  enumeration pass missed these because the `Depends(require_permission(...))`
  call wraps across two lines in this file; re-read directly to confirm).
  `labels.py` has zero diff since pass 3's merge, so this is a
  re-confirmation of pass 1's LBL-1 fix holding, not new work.
- **The frontend route-gate changes in `routes.tsx` are each internally
  justified and consistent with what they gate.** The admin-hub route
  widened from `inventory.manage` alone to
  `['inventory.manage', 'inventory.check_manage', 'storefront.manage']` (any
  of) — the hub itself resolves each card's own, narrower gate
  (`inventoryHubCards.ts`, whose own test asserts every card's gate is a
  _subset_ of its target route's real gate, parsed out of route source
  rather than hand-copied), so this widens who can reach the hub page without
  widening what any given card actually opens. The supply-worklist route
  gate was narrowed (dropped `scheduling.manage`) to match what the backing
  equipment-check endpoint actually accepts — out of this feature's own
  backend scope to verify (that endpoint lives in feature 14's
  `equipment_check.py`), so taken on the strength of the comment's stated
  reasoning rather than independently re-checked against that endpoint's own
  `Depends()`.

### Schema & migration notes

Five migrations landed since pass 3, all correctly structured and read in
full:

- **`f2a91c7d4e86`** (`inventory_item_pins`) — new table, guarded on
  `_has_table` even though this revision creates it (CLAUDE.md pitfall #26:
  application startup's `create_all()` can reach this revision first on a
  fresh install). All three FKs (`organization_id`→`organizations`,
  `user_id`→`users`, `item_id`→`inventory_items`) are `ondelete="CASCADE"` —
  no `SET NULL` column, so Pitfall #2 does not apply. `UniqueConstraint
("user_id", "item_id")` is what keeps `get_items`' outer join to pins at
  most 1:1, called out correctly in the migration's own docstring.
  Reversible: `downgrade()` drops the table outright, and the docstring
  correctly notes an empty table is the only valid starting state (no
  backfill needed or attempted).
- **`b8e3f1a97c24`** (`inventory_items.style_attributes`) — `inventory_items`
  is a migration-created table (`20260120_0013b`), so no table guard is
  needed; the column-existence guard is load-bearing all the same (startup's
  column-repair path can add it from the model first). Backfill is
  idempotent (`IS NULL` guard) and engine-portable (`JSON_ARRAY(CAST(style AS
CHAR))`, with the `CAST` explained as necessary because `style` is an ENUM
  and would otherwise coerce to its 1-based index in a numeric context, not
  its string value). Reversible: `downgrade()` drops the column only,
  leaving the original `style` values untouched.
- **`c4f7a2e91b38`** (`member_size_preferences.garment_fit`) — same table/
  column-guard shape. Backfill is idempotent (`garment_fit IS NULL` guard,
  so a value someone has already set is never overwritten by a re-run) and
  correctly scoped: it moves `shirt_style` into `garment_fit` **only** where
  the old value is one of the three actual fit literals
  (`mens`/`womens`/`unisex`), leaving a stored `long_sleeve` or other
  non-fit `shirt_style` value where it was — the docstring explains there is
  nowhere truthful to move it, and inventing a mapping would repeat the
  conflation this migration exists to fix. The fit literals are inlined
  rather than imported from `app/utils/garment_styles`, matching CLAUDE.md
  pitfall #20's rule that a migration must keep transforming rows the way it
  did the day it ran, independent of a taxonomy module that is free to
  change later. `shirt_style` itself is deliberately not dropped (still
  holds non-fit values, and removing it would be a response-schema breaking
  change) — correctly left as a follow-up, not attempted here.
- **`d3f8b6a24c91`** — a merge revision (two heads created by the style and a
  concurrent treasurer-permission migration branching independently);
  no schema change of its own, confirmed by reading its body (`upgrade()`/
  `downgrade()` are both `pass`).
- **`a1c7e93b2d54`** (`equipment_requests.requested_size`) — `nullable=True`
  `String(50)` column, correctly guarded on column existence for the same
  create_all-race reason as the others; `equipment_requests` is a
  migration-created table so no table guard is needed. No FK, so Pitfall #2
  does not apply.

`python3 scripts/validate_migrations.py --strict` (see
[Completion gate](#completion-gate-1)) confirms a single head across all 439
migrations in the repository, not just this module's five.

### Guard tests added

- `tests/test_inventory_pin_and_variant_locking.py` (new file, 3 tests) —
  source-inspection, matching `test_inventory_return_locking.py`'s
  established style: `test_pin_item_locks_the_member_row_before_counting_pins`
  and `test_pin_item_counts_existing_pins_with_a_locking_read` (INV-23),
  `test_create_size_variants_locks_the_organization_before_reusing_a_variant_group`
  (INV-24). All three confirmed to **fail** against the pre-fix
  `inventory_service.py` (`git stash`) and **pass** after.
- `SizePreferencesModal.test.tsx` — one existing test updated (it had
  asserted the pre-fix, buggy `undefined`-drops-the-key behaviour) plus one
  new regression test for the exact scenario Codex named (clearing a stored
  `garment_fit` back to "No preference"). Both confirmed to **fail** against
  the pre-fix component (`git stash`) and **pass** after (INV-25).
- **Round 2 (Codex review of `608a7a433`):**
  `tests/test_inventory_size_preferences_org_scoping.py` (new file, 2 tests,
  real database) — `test_upsert_rejects_a_user_from_another_organization`
  confirmed to **fail** against the pre-fix service method and **pass**
  after (INV-26); `test_upsert_still_succeeds_for_a_same_org_user` pins the
  ordinary case stays working. `SizePreferencesModal.test.tsx` — the
  existing "load rejects" test corrected to a realistic 404-shaped rejection
  (it had used a bare `Error('404')`, which carries no `status` `toAppError`
  can read), plus two new tests for the non-404 case (Save disabled, error
  banner shown, no clearing payload fires) and its recovery via "Try again."
  All three new/changed assertions confirmed to **fail** against the pre-fix
  component and **pass** after (INV-27).
  `tests/test_inventory_summary_maintenance_due_bounded.py` (new file, 4
  tests) — one source-inspection regression guard (confirmed to **fail**
  against the pre-fix method, **pass** after) plus three real-database
  correctness tests that pass identically before and after, since the fix is
  a computation-strategy change, not a behavior change (INV-28).

### Completion gate

| Check                                             | Result                                                    |
| ------------------------------------------------- | --------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                     | ✅ 0 violations                                           |
| `black --check app/ tests/ alembic/`              | ✅ clean (1538 files unchanged)                           |
| `isort --check-only app/ tests/ alembic/`         | ✅ clean                                                  |
| `python3 scripts/validate_migrations.py --strict` | ✅ single head (`a3f61c8d27b4`), 439 revisions            |
| `pytest tests/ -k "inventory or label"`           | ✅ 987 passed, 1 pre-existing skip (984 baseline + 3 new) |
| `pytest tests/` (full backend suite)              | ✅ 11897 passed, 21 pre-existing skips, 0 failed          |
| `npm run typecheck` (`tsc --noEmit`, frontend)    | ✅ clean                                                  |
| `npm run lint` (`eslint .`, frontend)             | ✅ 0 errors, 2 pre-existing warnings (unrelated file)     |
| `npx vitest run src/modules/inventory` (frontend) | ✅ 1203 passed (73 files)                                 |

Unlike the first draft, this round has a real code diff (backend:
`inventory_service.py`'s `pin_item`/`create_size_variants`; frontend:
`SizePreferencesModal.tsx`/`eventServices.ts`), so the full backend suite
was run in addition to the scoped selection, and the frontend gate
(`tsc`/`eslint`, plus the inventory module's own Vitest suite) was run for
the first time this pass rather than skipped.

One backend test needed attention along the way — not a defect in the fix,
but the ratchet doing its job: `pin_item`'s new `select(User.id).where(
User.id == str(user_id)).with_for_update()` tripped
`test_org_scoping_ratchet.py::test_no_new_unscoped_by_id_query`, which
freezes bare by-id queries with no `organization_id` filter (CLAUDE.md
Pitfall #14). `user_id` here is always `current_user.id` — the endpoint
never takes a client-supplied member id for this route — so it was never a
cross-tenant read, but adding `User.organization_id ==
str(organization_id)` to the lock query costs nothing, is trivially correct
given `organization_id` is already in scope, and satisfies the ratchet
without a `tests/org_scoping_baseline.txt` exception — the better of the two
outcomes the ratchet's own failure message offers.

**Round 2 completion gate (Codex review of `608a7a433`, INV-26/27/28):**
`flake8`/`black --check`/`isort --check-only` on `app/`, `tests/`,
`alembic/` — clean (one file needed `black`'s own reformat, applied);
`validate_migrations.py --strict` — unchanged, single head (`a3f61c8d27b4`),
439 revisions (no migration in this round's fix set); `pytest tests/ -k
"inventory or label"` — 993 passed (987 + 6 new), 1 pre-existing skip; full
backend suite `pytest tests/` — 11903 passed (11897 + 6 new), 21
pre-existing skips, 0 failed; frontend `node scripts/tsc-native.mjs
--noEmit` — clean; `npm run lint` — 0 errors, the same 2 pre-existing
warnings in an unrelated file (under the `--max-warnings 10` gate); `npx
vitest run src/modules/inventory` — 1205 passed (73 files, +2 net over the
round-1 figure: one existing test corrected, two new added, matching the 15
total in `SizePreferencesModal.test.tsx` this round left behind).

---

## Pass 3 (2026-09-02)

**Backend:** `api/v1/endpoints/inventory.py` (137 routes, 1 WebSocket, up
from 136 at pass 2's merge), `services/inventory_service.py` (~8,850 L, up
from ~7,450), `api/v1/endpoints/labels.py`, `services/label_service.py`,
`services/label_printer_service.py`
**Frontend:** `modules/inventory/*` (pages, routes, service), shared
`components/InventoryScanModal.tsx`
**Migrations:** `e1f2a3b4c5d6` (normalize AVAILABLE+unsafe-condition rows to
IN_MAINTENANCE/RETIRED), `c3d0e5f7a924` (`item_issuances.lot_allocations`) —
both landed since pass 2; both correctly guarded on table existence
(Pitfall #26)

### Correction to pass 2's own baseline count

Pass 2's doc states "132+26" as the unchanged inventory.py/labels.py route
baseline. Re-counted at pass 2's own merge commit (`656755cf`) via the same
AST-style enumeration this pass used: **136**, not 132 — already stale by
the time pass 2's own doc was written, the identical pattern this rotation
has now hit twice on this module (`module-audit/inventory.md`'s
"116 vs 132" correction in pass 1's own doc). Not a sign of undocumented
growth between pass 2 finishing and merging; a snapshot recorded before the
file's own final state. Corrected here so pass 4's baseline is accurate; not
worth going back to edit pass 2's already-merged section.

### Scope

Re-verified every still-open finding from pass 1/2 against current code
(INV-8, INV-9, INV-16, INV-17 — all four confirmed still open and
unchanged, see below). Then reviewed everything that changed since pass 2's
merge (`656755cf`): the full backend diff (`inventory.py` 88 lines,
`inventory_service.py` 971 lines, `labels.py` 34 lines, `label_service.py`
26 lines — 1,119 lines total) was read in full, not sampled. This period's
real feature work is a **dual-ledger stock model**: `InventoryItem.quantity`
(the legacy column) and `InventoryLot` rows (FEFO-ordered, expiry-aware) are
now two mutually-exclusive ledgers for the same item — once an item has any
lot, every reader (issuance, low-stock alerts, the equipment-check swap)
switches to reading lots and stops consulting `quantity` — plus a new
`create-if-absent` catalog route, a member-profile-visibility fix on the
impact planner (an org's `contact_visibility` setting is now AND-gated with
the member's own `resolve_profile_visibility` choice, closing a way around a
preference the directory/profile already honoured), and an
AVAILABLE-requires-safe-condition invariant closed at the row level
(`_enforce_state_invariant`, backed by the `e1f2a3b4c5d6` backfill) after
pass 2's INV-12 closed it only as a write-time validator.

Given this pass's specific brief — every stock-quantity mutation checked for
Pitfall #27's two-part shape (parent locked **and** the count/guard itself a
locking read) — every `.with_for_update()` call site in the diff was traced
to its transaction (23 total in the file) and, separately, every
`select(ItemIssuance | CheckOutRecord | ItemAssignment | WriteOffRequest |
ReturnRequest | EquipmentRequest)` in the whole file (30 call sites) was
checked for whether it guards a status-transition write and, if so, whether
that specific read is the locking one. This is a full-file structural sweep
of the locking pattern, not limited to the diff — the two findings below
were both introduced before pass 2 (pre-existing, not new regressions from
this period's feature work) and were only found by widening the sweep past
the diff.

**Frontend:** the diff against pass 2 touches the whole `modules/inventory/`
tree at a scale (91 files, ~31,500 lines) that turns out to be almost
entirely a directory-nesting artifact, not inventory feature work — the
equipment-check checklist/scan module (`checkLapModel`, `checkSweepAdapter`,
`checkAnswers`, `equipmentCheckPresets`, `MyChecklistsPage`, etc.) lives
under `modules/inventory/` but is feature 14's own principal surface
(`equipment_check.py`), reviewed on its own rotation slot — reviewing it
here would be scope creep past what this feature's Rotation-table row
claims, and duplicate feature 14's own pass. **This pass's frontend scope is
explicitly narrowed** to the files pass 2 itself named plus what the
diff-stat shows actually changed on them:
`components/InventoryScanModal.tsx` (29 lines — read in full: a stale-form-
state fix on the custody-transfer confirmation dialog, the same class INV-13
closed on the return-review panel, already correctly fixed with a shared
`resetTransferFields` called from both the open and close paths — no action
needed), `InventoryAdminHub.tsx` (22 lines — two new nav cards plus a
`noUncheckedIndexedAccess`-safe rewrite of a `sources[index]!` non-null
assertion into a checked `source` lookup, matching CLAUDE.md's ban on `!` as
a workaround — already correct), `MyEquipmentPage.tsx` and
`EquipmentRequestsPage.tsx` (17 and 3 lines — both switch a hardcoded
`item.quantity` read to the new `onHandQuantity()` helper so the "available"
figure shown to a member requesting equipment reflects lot-backed stock too;
`ReturnRequestsPanel.tsx` has no diff since pass 2, so INV-13's fix stands
unread-but-unchanged). `onHand.ts` (new file, read in full) is a two-line
helper (`is_lot_stocked ? lot_stock : quantity`) matching the backend
schema's own `InventoryItemResponse.lot_stock`/`is_lot_stocked` fields
exactly. **`modules/inventory/routes.tsx`, `types/equipmentCheck.ts`, and
the rest of the equipment-check-shaped files under this directory were not
reviewed this pass** — noted explicitly rather than silently claiming full
frontend coverage; they are feature 14's scope.

### Findings

#### INV-18 — HIGH — `return_to_pool` can double-credit stock on a concurrent return — ✅ FIXED

**What:** `return_to_pool` read `ItemIssuance` with a plain `SELECT` (no
`.with_for_update()`), checked `issuance.is_returned`, and only _then_
locked the associated `InventoryItem` row via `_get_item_locked` — the
reverse of the order Pitfall #27 requires (lock the contended row before
reading the state that guards the write).

**Where:** `backend/app/services/inventory_service.py:return_to_pool` (the
`ItemIssuance` lookup at the top of the method).

**Failure scenario:** two callers submit `POST
/issuances/{issuance_id}/return` for the same issuance at nearly the same
time — a double-tap on a slow connection, or two officers processing the
same physical return. Both read `is_returned == False` before either
commits. The first proceeds, locks the item, credits `item.quantity` (or
the item's stock lots, via `_return_units_to_stock`), sets
`issuance.is_returned = True`, and commits. The second was blocked only on
the _item_ lock (acquired later in the method), not on the issuance row
itself; once it unblocks, it operates on its own **stale, already-loaded**
Python `issuance` object — never re-read under a lock — so it still sees
`is_returned == False` in memory, proceeds, and calls
`_return_units_to_stock` a second time: `item.quantity` (or a stock lot) is
credited **twice** for units that were only physically returned once.
`item.quantity_issued` is independently decremented a second time too
(clamped to 0, understating the item's true outstanding-issuance count).

**Impact:** phantom restocking — the department's recorded on-hand quantity
for a pool item can be inflated above what is actually on the shelf, purely
from a race on the return endpoint, with no attacker or malicious intent
required. For consumable/PPE stock this means `issue_from_pool` later
"issues" units that do not exist. Not a tenant-isolation or auth defect;
the same class of correctness/data-integrity bug INV-10 fixed on
`review_return_request`'s sibling `ReturnRequest` row two commits after
this method was written, and evidently missed on this one.

**Fix:** added `.with_for_update()` to the `ItemIssuance` lookup, mirroring
`review_return_request`'s own INV-10 fix exactly. This is the first and
only read of the row in the method (no earlier plain read to reorder), so
the fix is the lock itself, not a reordering. The second caller now blocks
until the first commits, then its locking read returns the fresh,
already-`is_returned=True` row, and it bails out with "These units have
already been returned" instead of double-crediting.

#### INV-19 — MED — `checkin_item` can silently re-record an already-closed check-in — ✅ FIXED

**What:** identical shape to INV-18, one severity notch down because
individual-tracked checkouts have no quantity ledger to double-credit:
`checkin_item` read `CheckOutRecord` with a plain `SELECT`, checked
`checkout.is_returned`, and only afterward locked the item.

**Where:** `backend/app/services/inventory_service.py:checkin_item` (the
`CheckOutRecord` lookup at the top of the method).

**Failure scenario:** two concurrent check-ins of the same `checkout_id`
(same double-tap/two-officers shape as INV-18). The second caller's stale
in-memory `checkout` object still reads `is_returned == False`, so instead
of being rejected with "Item already checked in," it silently succeeds a
second time — overwriting `checked_in_at`/`checked_in_by` and, more
significantly, `return_condition`/`damage_notes` with whatever the second
caller submitted, even if it disagrees with the first (already-committed)
check-in's recorded condition. `item.condition`/`item.status` are
recomputed a second time too (idempotent when the two calls agree, silently
overwritten when they don't).

**Impact:** a data-integrity race, not a life-safety defect on its own
(unlike INV-12, nothing here can put a genuinely unsafe item back in
service — `_status_from_condition`/`_enforce_state_invariant` still apply
to whichever condition value wins the race) — but which condition value
"wins" depends on commit order between two racing requests, which is
exactly the kind of silent disagreement Pitfall #27 exists to prevent, and
a false "success" is reported to the caller that should have been told the
item was already checked in.

**Fix:** added `.with_for_update()` to the `CheckOutRecord` lookup, same
pattern as INV-18/INV-10. The one existing caller that already locks the
`CheckOutRecord` itself before delegating to `checkin_item`
(`_scan_batch_action`'s per-code dispatch, line ~4290) re-acquires the same
row lock within the same transaction — a no-op, not a deadlock risk, since
InnoDB row locks are reentrant per transaction.

**Both verified**, together, via `git stash` of the pre-fix
`inventory_service.py`: `tests/test_inventory_return_locking.py`'s two new
source-inspection guard tests (matching
`test_inventory_return_receipt.py::test_review_return_request_locks_the_request_row`'s
established shape) both fail against the stashed pre-fix code and pass
after — see [Guard tests added](#guard-tests-added) below.

#### INV-20 — MED — the INV-18/INV-19 fix itself locked in the wrong order — ✅ FIXED (follow-up)

**What:** Codex caught this on the merged PR before this pass closed —
INV-18/INV-19's fix locked `ItemIssuance`/`CheckOutRecord` first, then the
`InventoryItem`. Two sibling methods that also touch the same
item-plus-holding-record pair lock in the opposite order:
`review_return_request` and `transfer_item_holding`/`unassign_item` all
lock the `InventoryItem` first, then the holding record. `return_to_pool`
and `checkin_item` (as just fixed by INV-18/INV-19) were the only two
methods locking holding-record-first — an inconsistent lock order across
the module, which is exactly the shape that produces a deadlock rather
than fixing one.

**Where:** `backend/app/services/inventory_service.py:return_to_pool`,
`:checkin_item`, and `:batch_return`'s own pre-lock queries that delegate
to them.

**Failure scenario:** a direct return (`return_to_pool`, now holding-first)
races `review_return_request` (item-first) on the same issuance, or a
check-in (`checkin_item`, now holding-first) races `transfer_item_holding`
(item-first) on the same checkout. Transaction A holds the holding-record
lock and requests the item lock; transaction B holds the item lock and
requests the holding-record lock — a genuine circular wait. InnoDB detects
it and kills one side with a deadlock error, which the endpoint layer
converts to a plain failure with no retry, so a legitimate concurrent
return or check-in can fail because of an unrelated concurrent transfer or
review.

**Fix:** restructured both methods to lock the item first, matching the
other three methods' convention: an unlocked peek at the holding record's
immutable `item_id` (safe — `item_id` is never reassigned after create),
lock the `InventoryItem`, then lock and re-read the holding record for the
actual `is_returned`/`already checked in` guard check. `batch_return`'s own
pre-lock queries — which locked the checkout/issuance _before_ delegating
to these methods — had their `.with_for_update()` dropped, since they now
only need to name a candidate row for the loop; leaving it would have kept
the batch path holding-first while direct calls became item-first, trading
one inconsistency for another rather than actually unifying the order.

**Verified:** two new guard tests
(`tests/test_inventory_return_locking.py`) assert lock **order**, not just
presence — confirmed failing against the merged (holding-first) code via
`git stash` and passing after. Two existing mock-based unit tests in
`tests/test_inventory_service.py`
(`TestCheckinItem::test_checkin_already_returned`/`test_checkin_success`)
updated for the new two-query shape they were asserting against — the
assertions on outcome are unchanged, only the mocked call sequence.

#### INV-21 — MED — INV-20's own locked re-read can still return a stale, pre-lock object (SQLAlchemy identity map) — ✅ FIXED (follow-up)

**What:** Codex caught this on INV-20's own PR (#2190), before it merged.
INV-20's fix makes `return_to_pool`/`checkin_item` lock the `InventoryItem`
first, then lock-and-re-read the holding record (`ItemIssuance`/
`CheckOutRecord`) for the actual `is_returned` guard check — but "lock and
re-read" is not the same guarantee as "observe the latest committed row."
`batch_return` names its candidate holding record with an earlier, _unlocked_
`SELECT` of the same row, in the same session it then hands to
`return_to_pool`/`checkin_item` (see INV-20's fix comment — that read was
deliberately left unlocked once the item-first order was established). Once a
row is loaded into SQLAlchemy's identity map, a second `SELECT` for the same
primary key — even one issued with `.with_for_update()` — returns the
_cached Python object_ by default and does **not** overwrite its
already-loaded attributes with the row the locking query just fetched. The
lock is real and the SQL-level read is fresh (InnoDB locking reads bypass the
REPEATABLE READ snapshot — Pitfall #27), but the ORM object handed back to
the caller is not.

The same defect is present, independently, in `_get_item_locked` — the
shared item-locking helper `return_to_pool`, `checkin_item`, `unassign_item`
and every other holding-mutation method call. `batch_return` also loads the
`InventoryItem` unlocked first (via `_lookup_by_item_id`/`lookup_by_code`,
to route the scan to unassign/check-in/pool-return), so the item-level lock
was exposed to the identical staleness, on `item.quantity`,
`item.quantity_issued`, `item.status` and `item.condition` — the exact
fields these methods read-modify-write.

**Where:** `backend/app/services/inventory_service.py` — `_get_item_locked`,
and the locked re-reads in `return_to_pool` (`ItemIssuance`) and
`checkin_item` (`CheckOutRecord`).

**Failure scenario:** `batch_return` scans an item already returned/checked
in by a concurrent direct call (or a second batch) that raced it and
committed in between `batch_return`'s own candidate lookup and its delegate
call. Without the fix, the delegate's locked re-read hands back the object
`batch_return` already cached — `is_returned == False` — so the guard passes
a second time: `return_to_pool` re-runs `_return_units_to_stock` and
double-credits `item.quantity` (or a lot) for units already returned once,
`checkin_item` silently re-records a check-in — overwriting the first's
committed `return_condition`/`damage_notes`, potentially making a damaged
item read as available — and the batch reports both scans as successful.
INV-20's own lock-order fix does not close this: the item lock is acquired in
the correct order, but the value read out of it afterward can still be stale.

**Impact:** the exact double-credit/silent-overwrite failure modes INV-18–20
were written to close, reopened specifically on the batch path — the one
`batch_return` exists to make routine (a member returning several items in
one scan session, which is also the shape most likely to race a
quartermaster's direct desk return of the same items).

**Verified empirically**, not just reasoned about: a throwaway script against
this app's own `database_manager`/model setup (SQLAlchemy 2.0.52) loaded an
`InventoryItem` once (unlocked) in session A, committed a change to the same
row from an independent session B, then re-read it in session A with
`.with_for_update()` — the re-read returned A's original, pre-commit values
until `.execution_options(populate_existing=True)` was added to the query, at
which point it correctly reflected B's committed change.

**Fix:** added `.execution_options(populate_existing=True)` to
`_get_item_locked`'s query (fixing every caller unconditionally — item-level
staleness can no longer depend on whether some caller upstream happened to
have already loaded the same item) and to the `ItemIssuance`/`CheckOutRecord`
locked re-reads in `return_to_pool`/`checkin_item`. `populate_existing=True`
was Codex's suggested fix and is the one applied — narrower alternatives
(e.g. having `batch_return` select only bare ids) would leave the guarantee
dependent on every future caller remembering to do the same.

**Verified:** two new integration tests
(`tests/test_inventory_identity_map_staleness.py`) reproduce the race for
real, against a real database with two independent sessions (a mock has no
identity map, so this class of bug cannot be shown with one) — each loads
the holding record once, unlocked, in session A (mirroring `batch_return`'s
own candidate query), commits a return/check-in of the same row from
independent session B, then asserts session A's own
`return_to_pool`/`checkin_item` call observes B's committed state rather
than the pre-race object it cached. Both confirmed failing against the
pre-fix code via `git stash` and passing after.

### Re-verified still open, not re-flagged

- **INV-8 / INV-9** (`GET /allowances/check/{user_id}/{category_id}` and
  `GET/PUT /members/{user_id}/size-preferences` gated on the baseline
  `inventory.view` rather than `.manage`) — both routes' `Depends()` are
  unchanged since pass 2's flag. Still mirrored in `KNOWN_LIMITATIONS.md`;
  still an owner decision (no established sibling precedent for the
  intended gate, per pass 2's own reasoning, re-confirmed).
- **INV-16** (`update_reorder_request` neither locks the row nor increments
  `version`, unlike `/transition`/`/correct-status`/`/receipts`) —
  `update_reorder_request` re-read in full; still a plain
  `get_reorder_request` fetch, still no `.with_for_update()`, still no
  version bump. Unchanged.
- **INV-17** (equipment-maintenance "Complete work" always creates a new
  record rather than closing the open one) — `InventoryMaintenancePage.tsx`
  re-checked; still a single unconditional `createMaintenanceRecord` call.
  Unchanged.

### Verified good ✅ (new this pass)

- **The dual-ledger stock model is Pitfall #27-correct throughout.**
  `_consume_from_lots`, `_restore_to_lots`, and the new
  `_carry_forward_column_stock` (the read-then-write most exposed to a
  double-carry race, since it turns a plain column value into a brand-new
  lot row) all lock their contended rows **and** make the read that decides
  the write a locking read — `_carry_forward_column_stock`'s own comments
  cite Pitfall #27 by name and explain why the item rows (not the
  not-yet-existing lots) are what must be locked. `issue_from_pool`'s
  actual capacity decision runs through `_consume_from_lots`'s locking
  `SELECT ... FOR UPDATE` on `InventoryLot`, not through the earlier plain
  `_in_date_lot_totals` call (used only to route lot-stocked vs.
  column-stocked, not to decide the quantity) — so no overcommit is
  possible even though that routing read is not itself locking.
- **`fulfill_equipment_request` closes the release-lock-between-steps gap
  its own comment names**: `.with_for_update()` alone would leave a window
  between the locked read and the (separately-committing) issue/checkout/
  assign call, so it additionally does an atomic single-statement
  `UPDATE ... WHERE status = 'approved'` claim before creating any
  fulfillment record — `rowcount == 0` means another caller already claimed
  it. Genuinely double-checked, not merely assumed correct from the lock's
  presence.
- **The new `create-if-absent` route and its FK/audit handling.** `POST
/items/create-if-absent` (new since pass 2) is gated `inventory.manage`,
  matching every sibling create route; it delegates to `create_item`, which
  still runs `_assert_item_fks_in_org` (XC-1, unchanged); the endpoint logs
  `inventory_item_created` only when it actually created a row (not on the
  found-existing branch), matching the audit pattern on every other create
  route in the file.
- **The member-profile-visibility fix on the impact planner** (new
  `resolve_profile_visibility` AND-gate) is a data-exposure _improvement_ —
  a member's own visibility choice now overrides the org's
  `contact_visibility` setting rather than being bypassable through this
  one report — not a regression to flag.
- **No new injection surface, no new CSV export, no `window.confirm`/
  `alert`/`prompt`** anywhere in the diff (Pitfalls 15/16) — `inventory.py`'s
  two CSV exports still route through `SafeCsvWriter`, unchanged.
- **Both new migrations correctly guard on table existence** (Pitfall #26):
  `e1f2a3b4c5d6` checks `"inventory_items" in ...get_table_names()` before
  its backfill `UPDATE`s (and is honestly documented as irreversible —
  `downgrade()` is a no-op, since AVAILABLE+poor is indistinguishable after
  the fact from a legitimately-quarantined row); `c3d0e5f7a924` checks both
  table and column presence before `add_column`.

### Guard tests added

- `tests/test_inventory_return_locking.py::test_return_to_pool_locks_the_issuance_row`
  and `::test_checkin_item_locks_the_checkout_row` — source-inspection,
  same shape as `test_inventory_return_receipt.py`'s existing INV-10 guard
  test. Both confirmed to **fail** against the pre-fix code (`git stash` of
  `inventory_service.py`) and **pass** after.
- INV-20 follow-up: two more tests in `tests/test_inventory_return_locking.py`
  asserting the lock **order** (item before holding record) in
  `return_to_pool`/`checkin_item`, confirmed to fail against the merged
  (holding-first) code via `git stash` and pass after. Two existing
  mock-based tests in `tests/test_inventory_service.py`
  (`TestCheckinItem::test_checkin_already_returned`/`test_checkin_success`)
  updated for the new two-query call sequence.
- INV-21 follow-up: `tests/test_inventory_identity_map_staleness.py` (new
  file) — two real-database, two-session integration tests reproducing the
  identity-map staleness itself (not just lock order), for `return_to_pool`
  and `checkin_item`. Both confirmed to fail against the pre-fix code via
  `git stash` and pass after.

### Completion gate

| Check                                             | Result                                         |
| ------------------------------------------------- | ---------------------------------------------- |
| `flake8 app/ tests/ alembic/`                     | ✅ 0 violations                                |
| `black --check app/ tests/ alembic/`              | ✅ clean (1402 files unchanged)                |
| `isort --check-only app/ tests/ alembic/`         | ✅ clean                                       |
| `python3 scripts/validate_migrations.py --strict` | ✅ single head (`a8c4d1e2f3b5`), 411 revisions |
| `pytest tests/ -k "inventory or label"`           | ✅ 786 passed, 1 pre-existing skip             |
| `pytest tests/` (full backend suite)              | ✅ 9977 passed, 21 pre-existing skips          |
| `tsc --noEmit` / `eslint .` (frontend)            | not run — no frontend files touched this pass  |

No `tsc`/`eslint` run this pass: every frontend finding this pass reviewed
(`InventoryScanModal.tsx`, `InventoryAdminHub.tsx`, `MyEquipmentPage.tsx`,
`EquipmentRequestsPage.tsx`, `onHand.ts`) was already correct in the diff,
so no frontend edit was made. Stated explicitly per this rotation's "never
report a gate you did not run" rule rather than implying a clean run.

**INV-20 follow-up note:** INV-18/INV-19's fix merged with the wrong lock
order (see INV-20 above); the corrected version landed in a separate PR
after the original merged, since a merged PR's branch cannot be pushed to
again (CLAUDE.md Pitfall #24). That follow-up PR's own completion gate:
`flake8`/`black`/`isort` clean; `validate_migrations.py --strict` single
head, 411 revisions; `pytest tests/test_inventory_return_locking.py
tests/test_inventory_service.py` — 87 passed; full backend suite `pytest
tests/` — 9979 passed, 21 pre-existing skips, 0 failed.

**INV-21 follow-up note:** found by Codex reviewing INV-20's own (not yet
merged) PR #2190, and fixed within that same PR before it merged — no
branch-reuse concern here, unlike INV-20's own follow-up. Completion gate for
this addition: `flake8`/`black --check`/`isort --check-only` on
`app/services/inventory_service.py` and the new test file — clean;
`validate_migrations.py --strict` — single head, 411 revisions, no migration
added; `pytest tests/test_inventory_return_locking.py
tests/test_inventory_service.py tests/test_inventory_identity_map_staleness.py`
— 89 passed; full backend suite `pytest tests/` — 9981 passed (9979 baseline

- 2 new), 21 pre-existing skips, 0 failed.

---

## Pass 2 (2026-08-28)

**Backend:** `api/v1/endpoints/inventory.py`, `services/inventory_service.py`,
`api/v1/endpoints/labels.py`, `services/label_service.py`,
`services/label_printer_service.py`
**Frontend:** `modules/inventory/*` (pages, routes, service), shared
`components/InventoryScanModal.tsx`, `components/ReturnRequestsPanel.tsx`
**Migrations:** `8fb3757b80ec` (equipment-request duration),
`a8f3c1d7e902` (reorder receiving workflow), `f4a9c2d81e70` (physical return
receipt) — all landed since pass 1

## Correction

The version of this pass first pushed to PR #1957 concluded "no findings."
That was wrong, and the reason is recorded here rather than quietly
overwritten: the backend diff was read in full and reviewed carefully, but
the frontend diff was waved through on the reasoning that "client-side code
cannot itself create an authorization or tenant-isolation gap" — true for
the seven checklist dimensions this rotation exists to check, but the
inventory feature work landed real functional and data-integrity defects
that reasoning has no way to catch, including one (INV-13, stale follow-up
state) that lives entirely in a frontend component
(`ReturnRequestsPanel.tsx`) this pass never opened. An automated review
(Codex) on PR #1957 caught seven of them; each was independently verified
against the actual code before being fixed or flagged below — bot findings
are bug reports, not findings on their own word. `git diff --stat` is not a
substitute for reading a changed file, even a frontend one, when the module
under review ships real business logic in its components.

## Scope

Second pass over this module: re-verify pass 1's fixes/flags still hold,
then review everything that changed since pass 1's merge (`acfc34c3`, PR
#1835). That range is substantial — six commits' worth of real feature work,
not a quiet interval:

- `distribute-items` replaces `batch-checkout` with an explicit
  per-scan operation (`permanent_assignment` / `temporary_loan`) instead of
  inferring intent from item status, and reports a structured
  `InventoryHoldingConflict` when the item is already held.
- `POST /transfer` — an explicit chain-of-custody transfer between two
  members, closing the old holding record and opening its successor
  atomically.
- Equipment requests: `requested_duration` (member intent) is now stored
  separately from `fulfillment_type` (what the quartermaster actually did),
  with a `substitution_override_reason` required when fulfilling outside the
  requested item/category.
- Reorder requests: a versioned, row-locked status-transition workflow
  (`/transition`, `/correct-status`) plus an idempotent, lot-creating
  receiving endpoint (`/receipts`) backed by a new `reorder_receipts` table.
- Return requests: three-stage lifecycle (`requested` → `received` →
  `inspected`) replacing the old `pending`/`approved`, with independent
  physical-receipt verification (barcode/asset match for serialized items,
  quantity match for pool items) before a member's claimed return closes
  their holding.
- Write-off review: an optimistic-concurrency snapshot check
  (`expected_item_status`/`expected_holder_signature`) plus a mandatory
  acknowledgement for held/high-value items before approval.
- `labels.py`: audit logging added for two PII-adjacent modules
  (`prospective_members`, `membership`) on both generate and print.

`inventory.py`'s and `labels.py`'s diffs against pass 1 were read in full
(245 and 41 changed lines respectively); the corresponding
`inventory_service.py` methods were read in full — `distribute_items`,
`transfer_item_holding`, `_active_holding_conflict`, `review_return_request`,
`review_write_off`, `transition_reorder_request`, `correct_reorder_status`,
`receive_reorder`, `update_lot`, `update_item`, `_validate_item_state`,
`create_maintenance_record`, `get_reorder_request`, and
`_assert_reorder_fks_in_org`. The `reorder_receipts` model and its migration
were read in full. Schema changes (199 lines) were read in full. On
correction, every inventory-touching frontend file the diff-stat listed was
read in full: `InventoryScanModal.tsx`, `ReturnRequestsPanel.tsx`,
`InventoryMaintenancePage.tsx`, `InventoryAdminHub.tsx`,
`EquipmentRequestsPage.tsx`, `ReorderRequestsPage.tsx`, `WriteOffsPage.tsx`,
`MyEquipmentPage.tsx`.

## Route inventory (new/changed only — see PR #1835's file for the full 132+26 baseline, unchanged)

| Method | Path                                        | Auth dependency      | Permission         | Org-scoped | Notes                                                                      |
| ------ | ------------------------------------------- | -------------------- | ------------------ | ---------- | -------------------------------------------------------------------------- |
| POST   | `/distribute-items` (was `/batch-checkout`) | `require_permission` | `inventory.manage` | ✅         | replaces removed route, same gate                                          |
| POST   | `/transfer`                                 | `require_permission` | `inventory.manage` | ✅         | new                                                                        |
| POST   | `/reorder-requests/{id}/transition`         | `require_permission` | `inventory.manage` | ✅         | new, row-locked + versioned                                                |
| POST   | `/reorder-requests/{id}/correct-status`     | `require_permission` | `inventory.manage` | ✅         | new, row-locked + versioned                                                |
| POST   | `/reorder-requests/{id}/receipts`           | `require_permission` | `inventory.manage` | ✅         | new, row-locked + idempotent                                               |
| PATCH  | `/lots/{lot_id}`                            | `require_permission` | `inventory.manage` | ✅         | unchanged gate; now catches `ValueError` → 400 instead of an unhandled 500 |

No new route relaxed a permission, added a bare `get_current_user` route, or
introduced an unauthenticated path. `/batch-checkout` was removed outright
(not deprecated-and-left), so there is no stale duplicate route carrying the
old, less-precise semantics.

## Verified good ✅

- **Every new mutation is `inventory.manage`-gated**, matching every sibling
  route in the module (checked against the full permission table in pass 1's
  file, still accurate for the unchanged 132/26 baseline).
- **New by-id/by-FK access is org-scoped**: `transfer_item_holding` resolves
  the item via `_get_item_locked` (org-filtered `SELECT ... FOR UPDATE`) and
  the specific holding record via a compound filter on id + org + item +
  **current holder** + active flag — a stale or mismatched
  `current_record_id`/`current_holder_id` fails closed ("Holding changed;
  rescan the item") rather than transferring the wrong record.
  `new_holder_id` is validated in-org via `is_in_org` (XC-1).
  `transition_reorder_request`/`correct_reorder_status`/`receive_reorder`
  all fetch the `ReorderRequest` row with `.where(id ==, organization_id ==)
.with_for_update()` before mutating (XC-3 + Pitfall #27's row-lock half).
- **The reorder receiving path is idempotent**: `receive_reorder` checks for
  a prior `ReorderReceipt` row keyed on `(reorder_request_id,
idempotency_key)` — enforced at the DB level by `uq_reorder_receipt_key`,
  not just the pre-check — before creating the lot, so a retried request
  (double-tap, client retry after a dropped response) cannot double-record
  a receipt. See INV-11 below for what it did **not** do correctly on first
  read.
- **`reorder_receipts`, `reorder_requests`, and `inventory_lots` are all
  migration-created tables** (`20260306_0501_...`, `20260724_0001_...`),
  confirmed by grepping every `alembic/versions/*.py` for their
  `create_table` calls — so `a8f3c1d7e902`'s unguarded `op.add_column` /
  `ALTER TABLE ... MODIFY status ENUM(...)` calls against them are safe on
  the empty database CI migrates from scratch (Pitfall #26 does not apply
  here). `f4a9c2d81e70`, altering `return_requests` — a `create_all`-only
  table per its own comment, confirmed by the same grep returning nothing —
  correctly guards the entire body on `_has_table` first. `reorder_receipts`
  gets its own `organization_id`-led index (`ix_reorder_receipts_org`)
  specifically because every read of it is org-scoped first and the
  request-id index can't serve that filter.
- **`received_by` on `ReorderReceipt`** is `ondelete="SET NULL"` and
  correctly `nullable=True` (Pitfall #2); `organization_id` and
  `reorder_request_id` are `CASCADE` and `nullable=False`, appropriate since
  a receipt cannot outlive its org or its parent request.
- **Physical-receipt verification is real, not cosmetic**:
  `review_return_request` requires an independent `observed_condition` for
  every receipt, and for `TrackingType.INDIVIDUAL` items requires the
  reviewer's scanned `verified_identifier` to match the item's own
  barcode/asset-tag/serial before the request can move to `received` — a
  member's claim to have returned gear cannot close the holding on its own.
  Each of the three holding types resolved on receipt
  (`ItemAssignment`/`CheckOutRecord`/`ItemIssuance`) is re-fetched org- and
  requester-scoped with `.with_for_update()` immediately before mutation.
- **No new injection surface**: no new `.ilike(`/`.like(` or `csv.writer`
  usage anywhere in the diff.
- **No new `window.confirm`/`alert`/`prompt`, no new CSV export** anywhere
  in the frontend diff (Pitfalls 15/16).

## Findings

### INV-10 — HIGH — Concurrent deny/receive on a return request can overwrite each other — ✅ FIXED

**What:** `review_return_request` read the `ReturnRequest` row with a plain
`SELECT`, no `.with_for_update()`, before checking `req.status !=
REQUESTED`.
**Where:** `backend/app/services/inventory_service.py` (the `ReturnRequest`
lookup at the top of `review_return_request`).
**Failure scenario:** two quartermasters act on the same REQUESTED return at
nearly the same time — one denies it, one physically receives it. Both read
`status == REQUESTED` before either commits, so both proceed: the deny path
commits a `DENIED` status while the receive path, unaware, closes the
member's holding and later commits `RECEIVED`/`INSPECTED` over it (or vice
versa, depending on commit order). The request ends up in one state with a
holding closed or reopened inconsistently with it.
**Impact:** a denied return can still close out the member's holding as
though it were received, or a received return's item-condition/follow-up
work is lost under a denial that lands after it — a chain-of-custody record
and a physical-safety decision (was this gear inspected?) can silently
disagree with what the database says happened.
**Fix:** added `.with_for_update()` to the initial lookup. The second
reviewer's transaction now blocks until the first commits, then re-reads
the row's now-current status via the locking read and returns "Request is
already denied/received" instead of proceeding — the same pattern
`transfer_item_holding` and the reorder workflow already use. Guard test
added (source-inspection, see below) so a future refactor that drops the
lock fails immediately rather than needing a real concurrency reproduction.

### INV-11 — HIGH — Received reorder stock was never credited to the item's on-hand quantity — ✅ FIXED

**What:** `receive_reorder` created an `InventoryLot` and a `ReorderReceipt`,
and incremented `ReorderRequest.quantity_received`, but never touched
`InventoryItem.quantity` — the column `issue_from_pool` (and everything that
calls it: distribution, equipment-request fulfillment) actually checks
before allowing an issuance.
**Where:** `backend/app/services/inventory_service.py:receive_reorder`.
**Failure scenario:** a quartermaster orders 10 units of a pool-tracked
item, receives 4 through the new receiving workflow, and the UI correctly
shows the reorder as partially received with a lot on file — but
`issue_from_pool` still sees the pre-receiving `item.quantity` and refuses
to issue units that, as far as the receiving screen is concerned, already
arrived.
**Impact:** the entire feature this iteration's diff centers on — reorder
receiving — did not do the one thing receiving stock is for. Not a
tenant-isolation or auth defect, but a correctness defect severe enough to
make the shipped feature non-functional for its stated purpose.
**Fix:** lock the linked `InventoryItem` row (`_get_item_locked`, matching
Pitfall #27) immediately before crediting it, then `item.quantity =
(item.quantity or 0) + data["quantity"]` alongside the existing
`quantity_received` increment, inside the same already-locked-request
transaction. Guard tests added (new file, real-database-backed): receiving
credits the item's on-hand quantity, and a second receipt that completes
the order brings the item to the expected final total.

### INV-12 — HIGH — An item completed with an unsafe condition could still return to service — ✅ FIXED

**What:** `_VALID_STATE_COMBOS` constrained only `RETIRED` to require
`ItemCondition.RETIRED`; `AVAILABLE` accepted any condition. The new
maintenance-completion flow writes `item.condition` from the technician's
`condition_after` field (`create_maintenance_record`, already existing
behavior, confirmed unchanged), and the new "Return to service" action
(`InventoryMaintenancePage.tsx`) sends only `{status: 'available'}` with no
regard for that condition.
**Where:** `backend/app/services/inventory_service.py` (`_VALID_STATE_COMBOS`);
`frontend/src/modules/inventory/pages/InventoryMaintenancePage.tsx`
(`returnToService`).
**Failure scenario:** a technician completes maintenance on an item and
records `condition_after: damaged` (or `poor`/`out_of_service`) — the
completion modal's own copy says the item "remains out of service until you
deliberately return it to service." Clicking "Return to service" then sent
`status: available` with no condition change, and the backend accepted it:
the item became `AVAILABLE` while still `damaged`. Assignment, checkout,
and pool issuance all gate purely on `status == AVAILABLE`, so the unsafe
item was immediately distributable to a member.
**Impact:** for a fire department, an "available" self-contained breathing
apparatus, harness, or radio that is actually damaged or out of service is
a life-safety issue, not just a data-quality one.
**Fix:** added `ItemStatus.AVAILABLE: {EXCELLENT, GOOD, FAIR}` to
`_VALID_STATE_COMBOS`, mirroring the unsafe-condition check
`review_return_request` already applies on its own (separate) path when
receiving a physical return. `update_item` now rejects the transition with
a 400 rather than silently accepting it. Two existing tests
(`test_retire_item`, `test_non_retired_statuses_accept_standard_conditions`)
encoded the old, incorrect invariant as expected behavior and were
corrected rather than deleted — the retire test's setup no longer needs an
`available`+`poor` item (changed to `in_maintenance`+`poor`, which is
unaffected), and the matrix test was split into "non-RETIRED-non-AVAILABLE
statuses accept anything" plus a new `test_available_requires_safe_condition`
asserting the corrected rule for every `ItemCondition` value.

### INV-13 — MED — Stale follow-up/quantity selection could leak between return reviews — ✅ FIXED

**What:** `ReturnRequestsPanel.tsx`'s `followUp` and `receivedQuantity`
state persisted across modal openings; only `observedCondition`,
`verifiedIdentifier`, and `reviewNotes` were reset when opening the review
modal for a new request. `handleReview` sent `follow_up: followUp`
whenever `reviewAction === 'received'`, regardless of whether the
follow-up selector was actually shown (it is hidden unless the _current_
review's observed condition is unsafe).
**Where:** `frontend/src/components/ReturnRequestsPanel.tsx`.
**Failure scenario:** a quartermaster reviews a damaged return, selects
follow-up "Write-off review," submits. They open the next request — a
different item returned in good condition, so the follow-up selector is
hidden — and receive it. `followUp` is still `"write_off"` in component
state, and it is sent anyway, creating a write-off review against an item
nobody flagged as unsafe. The same staleness applies to
`receivedQuantity` for a pool item.
**Impact:** silently misfiled write-off/maintenance/charge-review requests
against the wrong item, discovered only when someone notices the
mismatched paperwork.
**Fix:** reset `followUp` to `'auto'` and `receivedQuantity` to `1` at both
places the modal opens (receive and deny) and after a successful submit;
changed `handleReview` to send `follow_up` only when the observed condition
is actually unsafe (`UNSAFE_CONDITIONS.includes(observedCondition)`, the
same set already used to decide whether to show the selector — previously
duplicated as an inline literal, now one constant).

### INV-14 — LOW — Custody-transfer audit event had no acting user — ✅ FIXED

**What:** `transfer_item_holding`'s `log_audit_event` call omitted
`user_id`, even though `performed_by` was already available in scope.
**Where:** `backend/app/services/inventory_service.py:transfer_item_holding`.
**Failure scenario:** investigating who transferred an item's custody from
the audit log alone comes up empty for `inventory_item_transferred` events
— the org and the old/new holders are recorded, but not who performed the
transfer.
**Fix:** pass `user_id=str(performed_by)` to `log_audit_event`, matching
every other audit call in this file.

### INV-15 — LOW — "Transfer is immediate" checkbox had no effect — ✅ FIXED

**What:** `InventoryScanModal.tsx`'s transfer-confirmation dialog offered a
"Transfer is immediate" checkbox wired to an `immediate` field on
`InventoryTransferRequest`. `transfer_item_holding` accepts that field only
to embed it in the audit log payload; the transfer itself is always
performed immediately (old holding closed, new one opened, same
transaction) regardless of its value.
**Where:** `frontend/src/components/InventoryScanModal.tsx`.
**Failure scenario:** unchecking the box implies a deferred/pending
transfer is possible — no such state exists. Custody moves immediately
either way, so the control could lead a quartermaster to believe a
transfer had not yet taken effect when it had.
**Fix:** removed the checkbox and the `transferImmediate` state; the
request now always sends `immediate: true`, matching actual behavior.
Building genuine deferred-transfer semantics (a pending state held open
until a physical handoff is separately confirmed) would be a real feature,
not a bug fix, and is not implemented here.

## Flagged (owner decision)

### INV-16 — MED — Ordinary reorder edits bypass the versioned workflow — FLAGGED

`PATCH /reorder-requests/{id}` (`update_reorder_request`) neither locks the
row nor increments `version`, unlike `/transition`, `/correct-status`, and
`/receipts`. A manager editing `quantity_requested` or vendor details
through the plain PATCH endpoint while another manager is mid
transition/receipt is not serialized against them, and — since
`quantity_received` is guarded but `quantity_requested` is not — lowering
the requested quantity after partial receipt can leave `quantity_received`
greater than the (now smaller) `quantity_requested`, a state
`receive_reorder`'s own outstanding-quantity check does not anticipate.
Not fixed here because closing it means picking one of two designs with
real API-contract consequences: require every PATCH caller to start
sending `expected_version` (a breaking change for the existing frontend
edit form), or restrict which fields PATCH may touch once receiving has
started (a product decision about what "editing an order in flight" should
even mean). Mirrored to `KNOWN_LIMITATIONS.md`.

### INV-17 — MED — "Complete work" always creates a new maintenance record rather than closing the open one — FLAGGED

`InventoryMaintenancePage.tsx`'s completion flow always calls
`createMaintenanceRecord` with `is_completed: true`, even when the item
already has an open (scheduled or in-progress) record for the same work.
The original record is never marked closed, so it remains permanently
"due" in `getMaintenanceDueItems` while a second, completed record exists
alongside it — maintenance history and outstanding-work/compliance
reporting disagree even after the item is genuinely back in service. Not
fixed here because a correct fix needs to identify _which_ open record (if
more than one exists for an item, which is itself not currently
prevented) the completion is closing, which needs new data-fetching in the
modal (the "Due items" tab does not currently load an item's record list)
and a decision about the multiple-open-records case. Mirrored to
`KNOWN_LIMITATIONS.md`.

## Schema & migration notes

Three migrations landed since pass 1, all correctly structured:
`8fb3757b80ec` (adds `equipment_requests.requested_duration`, guarded on the
column already existing per the fast-path-init race, table itself always
present via `20260222_0450_...`), `a8f3c1d7e902` (reorder-receiving schema:
`reorder_requests.version`, `inventory_lots.storage_location`/`unit_cost`,
the new `reorder_receipts` table, and `organizations.reorder_vendor_required`
/`reorder_po_required` — all against migration-created tables, no guard
needed), `f4a9c2d81e70` (return-request lifecycle columns and enum values,
correctly guarded on `_has_table("return_requests")` since that table is
`create_all`-only). `validate_migrations.py --strict` confirms a single head
(see gate below). No JSON columns touched. No seeded-grant changes. No
migration needed for this pass's own fixes (all logic-only).

## Guard tests added

- `tests/test_inventory_return_receipt.py::test_review_return_request_locks_the_request_row`
  — source-inspection assertion that the `ReturnRequest` lookup in
  `review_return_request` uses `.with_for_update()` before the status
  check. Fails on reintroduction of INV-10.
- `tests/test_inventory_reorder_receiving_db.py` (new file, real-database
  backed) — `test_receiving_stock_increases_the_item_on_hand_quantity` and
  `test_a_second_full_receipt_makes_the_item_fully_available` assert
  `InventoryItem.quantity` actually increases on receipt and reaches the
  expected total across two partial receipts. Fails on reintroduction of
  INV-11.
- `tests/test_inventory_service.py::TestStatusTransitionMatrix::test_available_requires_safe_condition`
  — asserts `AVAILABLE` accepts only `EXCELLENT`/`GOOD`/`FAIR` across every
  `ItemCondition` value. Fails on reintroduction of INV-12.

## Completion gate

| Check                                                                 | Result                                                              |
| --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                         | ✅ 0 violations                                                     |
| `black --check app/ tests/ alembic/`                                  | ✅ clean                                                            |
| `isort --check-only app/ tests/ alembic/`                             | ✅ clean                                                            |
| `python3 scripts/validate_migrations.py --strict`                     | ✅ single head                                                      |
| `pytest tests/ -k "inventory or label"`                               | ✅ 702 passed (704 after guard-test additions), 1 pre-existing skip |
| `pytest tests/` (full backend suite)                                  | ✅ 9173 passed, 22 pre-existing skips                               |
| `tsc --noEmit`                                                        | ✅ clean                                                            |
| `eslint .`                                                            | ✅ 0 errors, 10 pre-existing warnings (none in touched files)       |
| Frontend component tests (`InventoryScanModal`, `ReturnRequestsPage`) | ✅ 4 passed                                                         |
