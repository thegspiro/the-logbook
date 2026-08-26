# Security Review 11 — Inventory

**Prefix:** `INV` · **Iteration:** 11 · **Reviewed:** 2026-08-26 · **PR:** [#1835](https://github.com/thegspiro/the-logbook/pull/1835)

**Backend:** `api/v1/endpoints/inventory.py` (132 routes, 1 WebSocket),
`services/inventory_service.py` (~7,450 L), `api/v1/endpoints/labels.py`
(shared cross-module label/printer routes — bundled with Inventory since
`docs/module-audit/inventory.md` audited them together), `services/label_service.py`,
`services/label_printer_service.py`
**Frontend:** none dedicated (rendered in-app); label printing UI lives in
`components/labels/`
**Migrations:** none this iteration (no schema change)

---

## Scope

This is the third pass over this module: module-audit iteration 3 (INV-1
through INV-6), then app-review Tier B (4 passes + a follow-up, 2026-08-06
through 2026-08-11), then three more permission-tightening commits
(`d7be097b`, `ccea2576`, `4361358a`) landed directly against `main` outside
either rotation. Re-verified every previously-fixed item still holds
(INV-1/2/3/5/6 all confirmed unchanged in current code) and that INV-4 — the
~13-method XC-1 FK-scoping sweep, the biggest item either prior pass left
open — is genuinely closed (`assert_in_org`/`_assert_item_fks_in_org`/
`_assert_reorder_fks_in_org` present at every method app-review pass 4's
table names).

**Endpoint count discrepancy, corrected:** `module-audit/inventory.md` states
"5,605 L, 116 endpoints" as of iteration 3, but the file already had 132
`@router.`-decorated endpoints by the time that doc's own commit landed —
the stated snapshot was stale on arrival, not a sign of undocumented growth.
The oldest state recoverable from this repo's history (`918e4b04`,
2026-08-16, a consequence of this repo's squashed/rewritten history — the
same limitation AUTH-01/SF-04/FIN-05 already documented) has 118 endpoints;
`918e4b04..HEAD` adds exactly 14 (`/setup/*` + `/vendors*`, all
`inventory.manage`-gated, reviewed below) to reach the current 132. The
2-endpoint gap between the audit's claimed 116 and the oldest recoverable
118 predates any git state this repo retains — noted rather than guessed at.
Corrected the count in `module-audit/inventory.md`.

Every endpoint was enumerated mechanically (all 132, not sampled) and its
auth dependency read; the 10 bare-`get_current_user` routes were each read in
full to confirm self-scoping. `inventory_service.py`'s by-id tenant-isolation
sweep (INV-4) and the new `/vendors*`/`/setup/*` service methods were read in
full. The 14-method growth in `labels.py`/`label_printer_service.py` since
the last audit (server-side ZPL/ESC-POS raw-socket printing, added
2026-08-21/24) was read in full, since neither prior pass on this module ever
saw it — the SSRF boundary (`printer_transport.py`: private-LAN-only,
loopback/link-local/reserved refused, host resolved once to close the
DNS-rebinding window) was already built defensively and is unchanged;
LBL-1 below is a narrower error-handling gap in one caller of it.

## Route inventory

All 132 `inventory.py` routes carry auth (0 `NONE` findings). 121 use
`require_permission`/`require_all_permissions`; 10 use bare
`get_current_user` with in-body self-scoping; 1 (`/ws`) authenticates
manually (decodes the JWT, re-checks active/non-deleted/org-matched before
joining an org-scoped `ws_manager`).

| Group                                                                         | Routes | Permission                                                                        | Org-scoped | Notes                                                                                 |
| ----------------------------------------------------------------------------- | -----: | --------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------- |
| Categories                                                                    |      5 | `.view` (read) / `.manage` (write)                                                | ✅         |                                                                                       |
| Items (CRUD, bulk, import/export)                                             |      9 | `.view` / `.manage`                                                               | ✅         | holder identity redacted from `.view` responses (`_redact_holder`)                    |
| Item history / issuances / checkout-active / overdue                          |      4 | `.manage`                                                                         | ✅         | tightened from `.view` (commit `ccea2576`) — names every holder                       |
| Assign / unassign / issue / return / checkout / checkin                       |      9 | `.manage`                                                                         | ✅         |                                                                                       |
| Per-member reads (assignments/issuances/inventory/clearance/issuance-history) |      5 | bare `get_current_user`, self-or-quartermaster                                    | ✅         | shared `_require_self_or_quartermaster` helper (verified in each body)                |
| Extend checkout                                                               |      1 | bare `get_current_user`                                                           | ✅         | org-scoped fetch + is-own-or-manage check inline                                      |
| Maintenance                                                                   |      3 | `.view` (item-scoped history) / `.manage`                                         | ✅         | INV-3's item-in-org guard intact                                                      |
| Summaries (org/location/low-stock/members)                                    |      5 | `.view` (branches to `[]`/own-only for non-admin) / `.manage` for members-summary | ✅         | members-summary tightened to `.manage` (`ccea2576`)                                   |
| Impact planner (options/plans/analyze/reorder/issue/pdf)                      |      9 | `.manage`                                                                         | ✅         |                                                                                       |
| Lookup / batch checkout / batch return                                        |      3 | `.view` / `.manage`                                                               | ✅         |                                                                                       |
| Label formats / generate (item-catalog PDF)                                   |      2 | `.view` (formats) / `.manage` (generate)                                          | ✅         | generate tightened to `.manage` (`ccea2576`) — was a catalog-read bypass              |
| Departure clearances (initiate/list/resolve/complete)                         |      4 | `.manage`                                                                         | ✅         |                                                                                       |
| **Departure clearance by id**                                                 |      1 | **`.view` → fixed to `.manage` (INV-7)**                                          | ✅         | see Findings — the one clearance route not covered by the `ccea2576`/`d7be097b` sweep |
| Equipment requests (create/list/review/fulfill)                               |      4 | bare `get_current_user` (self-scoped create/list) / `.manage`                     | ✅         | `item_id` validated in-org (INV-2, still fixed)                                       |
| Storage areas                                                                 |      4 | `.view` / `.manage`                                                               | ✅         |                                                                                       |
| Write-offs                                                                    |      3 | `.manage`                                                                         | ✅         |                                                                                       |
| NFPA compliance / exposures / summary / retirement-due                        |      6 | `.view` (read) / `.manage` (write)                                                | ✅         |                                                                                       |
| WebSocket                                                                     |      1 | manual (JWT decode + org/active check)                                            | ✅         |                                                                                       |
| Size variants / bulk issue / allowances / charges                             |      8 | `.manage`                                                                         | ✅         |                                                                                       |
| Allowance check (cross-member usage)                                          |      1 | `.view`                                                                           | ✅         | flagged, not fixed — see Findings (INV-8)                                             |
| Return requests                                                               |      3 | bare `get_current_user` (self-scoped) / `.manage`                                 | ✅         |                                                                                       |
| Reorder requests                                                              |      5 | `.manage`                                                                         | ✅         | LIKE search escaped (INV-5, still fixed)                                              |
| Variant groups / kits / kit-issue                                             |      9 | `.view` (read) / `.manage` (write)                                                | ✅         | kit `optional` flag fully wired (INV-6, closed 2026-08-11)                            |
| Member size preferences (cross-member)                                        |      2 | `.view` (get) / `.manage` (set)                                                   | ✅         | flagged, not fixed — see Findings (INV-9)                                             |
| Own size preferences / label preset                                           |      4 | `.view` (self-only target, incl. 2 mutating GETs/PUTs)                            | ✅         | not a privilege issue — hardcoded to `current_user.id`                                |
| Lots (list/add/bulk/update/delete/expiring)                                   |      6 | `.view` (read) / `.manage` (write)                                                | ✅         |                                                                                       |
| **Setup + vendors (new since last audit)**                                    |     14 | `.manage` (12) / `.view` (2, financials redacted)                                 | ✅         | reviewed in full below — no defect found                                              |

`labels.py` (shared, 26 routes across item/module label generation and
printer config): all `.manage`/`settings.manage`-gated except `POST
/labels/print`, which is intentionally reachable on the target module's own
`.view` permission (printing a label reveals nothing the PDF preview does
not — verified true for label _content_). **LBL-1** below is that route's
printer-error handling, not its authorization.

### `/setup/*` + `/vendors*` (new since 2026-08-16, first review)

All 14 read in full. Every mutation (`create/update/deactivate` vendor,
contacts, attach-name, merge, category-preset apply) requires
`inventory.manage`. The two `.view`-gated reads (`list_vendors`, `get_vendor`)
redact account numbers, payment terms and spend totals for callers without
`inventory.manage` via `_vendor_response(..., include_financials=...)` —
verified at both call sites (lines ~4164, ~4216) — leaving only the vendor
directory (name, contacts) visible at `.view`, which matches the item catalog's
own precedent. No IDOR: `get_vendor`/`update_vendor`/`deactivate_vendor`/
contact and merge endpoints all resolve through `InventoryService`'s
org-scoped vendor lookups. No defect found.

## Verified good ✅

- **Auth coverage 132/132**, enumerated above, 0 `NONE` findings.
- **Tenant isolation (service layer)** remains solid — INV-4's `assert_in_org`
  sweep covers every previously-flagged create/update FK
  (`create_category`/`update_category`, `create_item`/`update_item`,
  `create_maintenance_record`/`update_maintenance_record`,
  `create_write_off_request`, `create_size_variants`, `create_return_request`,
  `create_reorder_request`/`update_reorder_request`, `create_equipment_kit`,
  `create_reorder_from_plan`), each via `_assert_item_fks_in_org` /
  `_assert_reorder_fks_in_org` / direct `assert_in_org` calls — confirmed
  present in current code, not re-derived from the app-review table alone.
- **No raw SQL, and every LIKE search escapes wildcards** — `search_by_code`,
  `get_items`, `list_reorder_requests` (INV-5) all use the bound-parameter
  `.replace()` escape; none of the three vendor/setup searches added since
  bypass it (`list_vendors`'s `search` param is applied via the same escaped
  helper pattern).
- **The label-printer SSRF boundary is real and unchanged**: port allowlist
  (raw-print ports only), loopback/link-local/reserved address classes
  refused, host resolved once to the literal address used for the connection
  (closes the DNS-rebinding TOCTOU) — `app/utils/printer_transport.py`,
  read in full, matches the design the commit that introduced it (`21463e2e`)
  describes.
- **Lint:** flake8 clean on both changed files and the full `app/`/`tests/`/
  `alembic/` tree (see gate below). No TODO/FIXME/HACK in the touched code.

## Findings

### INV-7 — MED — `GET /clearances/{clearance_id}` bypassed the quartermaster gate its sibling route already has — ✅ FIXED

**What:** `get_departure_clearance` was gated on `inventory.view` — the
baseline permission every seeded Member position holds — and returns the
full `DepartureClearanceResponse`: the departing member's `user_id` plus
every line item (item name, serial, value, disposition).
**Where:** `backend/app/api/v1/endpoints/inventory.py:3264`.
**Failure scenario:** any authenticated member who learns or guesses a
clearance UUID (e.g. surfaced in a future notification link, or shared
between staff over chat) can `GET /inventory/clearances/{id}` and read
another member's full departure gear detail — the same PII/inventory-detail
disclosure the `ccea2576`/`d7be097b` sweep closed on
`/items/{id}/history`, `/checkout/active`, `/checkout/overdue`, and
`/users/{user_id}/clearance` (this route's own identically-shaped sibling,
already gated self-or-quartermaster). This one route was missed by that
sweep — every other clearance route (`initiate`/`list`/`resolve`/`complete`)
was already `inventory.manage`-only, making `.view` here an outlier, not a
deliberate choice.
**Impact:** cross-member disclosure of departure-clearance detail (LOW
practical severity — clearance ids are UUIDs and the feature has no frontend
consumer today per `KNOWN_LIMITATIONS.md`'s "Departure Clearance Is
Backend-Only" entry, so there is no UI flow that hands a member this id —
but the access-control gap itself is real and matches a class this rotation
treats as MED elsewhere).
**Fix:** changed the dependency to `require_permission("inventory.manage")`,
matching every other clearance route and the sibling by-user route. No
frontend caller exists to update (confirmed no reference to `/clearances/`
anywhere in `frontend/src`). Guard test added (see below).

### LBL-1 — LOW — `POST /labels/print` echoed the printer's host:port to any module viewer — ✅ FIXED

**What:** `print_labels` catches `PrinterUnreachableError` and returned
`str(e)` verbatim as the HTTP 502 detail. The transport's error messages
embed the printer's configured LAN host and port (e.g. "Could not connect to
the printer at 10.0.0.7:9100."). This route is gated on the _target
module's_ own view-or-manage permission — `apparatus.view`,
`facilities.view`, and `members.view` are all baseline grants per
`MODULE_LABELS`'s own comment — not on `settings.manage` like its neighbours
(`test`/`status`/`probe`, three routes up in the same file).
**Where:** `backend/app/api/v1/endpoints/labels.py:482` (pre-fix).
**Failure scenario:** any member with `apparatus.view` (etc.) who triggers a
label print while the org's configured printer is unreachable — or an
attacker deliberately probing — learns the printer's internal LAN
address and port, information the settings-gated config routes are
explicitly allowed to disclose only because the caller is the admin who
configured it.
**Impact:** internal network topology disclosure to any authenticated
member of the relevant module — the exact class already fixed one file over
in `station_documents.py`'s `print_station_document` (this rotation's own
recent DOC-10 pass), whose fix comment explicitly (and incorrectly, for this
one route) assumed labels.py's printer routes were all `settings.manage`-gated.
**Fix:** mirrored the `station_documents.py` fix exactly — log the real
error server-side (`logger.error`), return a generic 502 detail with no
host/port. The three `settings.manage`-gated routes (`test`/`status`/`probe`)
are left unchanged; that caller is always the admin who configured the
printer. Guard test added (`test_labels_endpoint.py`).

### INV-8 — LOW — `GET /allowances/check/{user_id}/{category_id}` — cross-member allowance usage on `.view` — FLAGGED

A member holding only `inventory.view` can query another member's
issuance-allowance usage count for a given category by user id. Low
sensitivity (a count, not gear detail or PII), consistent with this
rotation's pattern of flagging rather than guessing at owner-decision-level
gates when the data exposed is minor. Mirrored to `KNOWN_LIMITATIONS.md`.

### INV-9 — LOW — `GET /members/{user_id}/size-preferences` — cross-member physical data on `.view` — FLAGGED

Same shape as INV-8: any member can read a named colleague's stored size
preferences (physical measurements) via `inventory.view`. Not fixed here
because, unlike INV-7, there is no established sibling precedent in this
module for what the intended gate is (uniform/PPE size data may be
legitimately visible to more roles than clearance detail — e.g. a
supply-request workflow) — an owner decision rather than a mechanical
one-line match. Mirrored to `KNOWN_LIMITATIONS.md`.

## Schema & migration notes

No schema changes this iteration. Re-confirmed from prior passes: all
inventory tables are `create_all`-only (no dedicated creating migrations);
the `EquipmentKitItem.optional` column (INV-6) has `nullable=False` with a
`server_default`, consistent with Pitfall #2 (not a `SET NULL` FK, n/a there).

## Guard tests added

- `tests/test_inventory_member_visibility.py::test_reads_that_name_the_holder_require_quartermaster`
  — extended the existing parametrized guard (which already covers
  `/items/{item_id}/history`, `/items/{item_id}/issuances`,
  `/checkout/active`, `/checkout/overdue`) with
  `/clearances/{clearance_id}`, asserting it requires exactly
  `inventory.manage` and not `inventory.view`. Fails on reintroduction of
  INV-7.
- `tests/test_labels_endpoint.py` (new file) —
  `test_printer_unreachable_error_is_redacted`: calls `print_labels` with a
  mocked `PrinterUnreachableError` carrying a host:port, as a caller holding
  only `apparatus.view`, and asserts the resulting 502's detail contains
  neither. Mirrors `test_print_documents.py`'s identical guard for the
  station-document path. Fails on reintroduction of LBL-1.

## Completion gate

| Check                                             | Result                                                           |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                     | ✅ 0 violations                                                  |
| `black --check app/ tests/ alembic/`              | ✅ 1246 files unchanged                                          |
| `isort --check-only app/ tests/ alembic/`         | ✅ clean                                                         |
| `python3 scripts/validate_migrations.py --strict` | ✅ single head, no schema change this iteration                  |
| `pytest tests/ -k "inventory or label"`           | ✅ 657 passed, 1 skipped (pre-existing optional-dependency skip) |
| `pytest tests/` (full backend suite)              | ✅ 8302 passed, 22 skipped (pre-existing Docker/no-MySQL skips)  |
| `tsc --noEmit` / `eslint .`                       | n/a — no frontend change this iteration                          |
