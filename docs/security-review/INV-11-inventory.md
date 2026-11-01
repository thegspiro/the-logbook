# Security Review 11 — Inventory

**Prefix:** `INV` · **Iteration:** 11 · **Reviewed:** 2026-08-28 (pass 2), 2026-09-02 (pass 3), 2026-09-08 (pass 4), 2026-09-14 (pass 5), 2026-09-16 (pass 6), 2026-10-06 (pass 7), 2026-10-13 (pass 8), 2026-10-15 (pass 9), 2026-10-19 (pass 10), 2026-10-23 (pass 11), 2026-10-26 (pass 12), 2026-10-29 (pass 13) · **PR:** [#1957](https://github.com/thegspiro/the-logbook/pull/1957) (pass 2), [#2188](https://github.com/thegspiro/the-logbook/pull/2188) (pass 3), [#2422](https://github.com/thegspiro/the-logbook/pull/2422) (pass 4), [#2561](https://github.com/thegspiro/the-logbook/pull/2561) (pass 5), [#2616](https://github.com/thegspiro/the-logbook/pull/2616) (pass 6), [#2966](https://github.com/thegspiro/the-logbook/pull/2966) (pass 7), [#3166](https://github.com/thegspiro/the-logbook/pull/3166) (pass 8), [#3272](https://github.com/thegspiro/the-logbook/pull/3272) (pass 9), [#3432](https://github.com/thegspiro/the-logbook/pull/3432) (pass 10), [#3580](https://github.com/thegspiro/the-logbook/pull/3580) (pass 11), [#3738](https://github.com/thegspiro/the-logbook/pull/3738) (pass 12), pass 13 (this PR)

---

## Pass 14 (2026-11-01) — watchdog pickup, no backend delta, 0 fixed, 0 new findings; INV-22 re-confirmed

**Step 0.** The GitHub search tools were unavailable this iteration, so open PRs
were read with `list_pull_requests` (state open): no head branch started with
`claude/security-review-`. PR #3823 (this feature, pass 13) had merged. The
rotation table showed rows 01–10 done for this lap and row 00 still marked 🔄
(its pass 14 PR had merged while in progress), so row 11 was the first pending
row; row 00 is corrected to ✅ in this PR.

**Scope.** Baseline `d65ad33f7` (PR #3823's merge). Three commits touch the
declared files since: `233b8af39` (labels: Code 128 bars a whole number of
printer dots wide), `ab879fc7d` and `cf8fdae30` (page and list-row layout
classes). `git show --stat` over `backend/` is empty for all three.

**Verified good (mechanisms).**

- **No backend change.** None of the five endpoint files, the service, schema or
  model changed, so the 198 routes (150 HTTP plus the one WebSocket route in
  `inventory.py`, 29 NFC, 12 labels, 4 kiosk, 2 last-seen) are as pass 13 left
  them, each behind `require_permission`, `get_current_user` or the WebSocket's
  origin check and token. `check_route_permissions.py --strict`: 0 errors,
  0 warnings.
- **`233b8af39`** adds `components/labels/barcodeGeometry.ts` (pure arithmetic
  that rounds module widths to whole printer dots) and uses it from
  `LabelPrintPage.tsx` and `InventoryBarcodePrintPage.tsx`. A scan of the diff
  for `innerHTML`, `document.write`, `window.open`, `dangerouslySetInnerHTML`,
  `fetch(`, browser dialogs and storage access found none; the preferences the
  page already keeps (`inventory:labelPreset` and friends) are unchanged.
- **Layout commits** change class names only.

**Standing: INV-22** (full catalog materialized by `get_fulfillment_options` /
`get_requestable_categories`, owner-accepted) is unchanged: neither function is
in the window.

**Repo-wide error found, not mine to fix here.** `validate_migrations.py
--strict` fails on `main` (`2b1884237`): three Alembic heads, `aefb58788235`,
`b65eaef983b9` and `e9bfa68963ce`, all revising `5781476f2012`. PR #3916 (a
merge revision over all three) was open during this pass; #3915, which joins
only the first two, would have left a second fork, and a comment saying so was
left there. This PR adds no migration, so it does not touch the chain.

### Completion gate (pass 14)

| Check                                                                 | Result                                                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `flake8 app/ tests/ alembic/` (7.4.1)                                 | ✅ 0 violations                                                                                        |
| `black --check app/ tests/ alembic/` (26.10.1)                        | ✅ clean                                                                                               |
| `isort --check-only app/ tests/ alembic/` (9.0.2)                     | ✅ clean                                                                                               |
| `python3 scripts/validate_migrations.py --strict`                     | ❌ three heads on `main`, see above; not caused by this PR                                             |
| `python3 scripts/check_route_permissions.py --strict`                 | ✅ 0 errors, 0 warnings                                                                                |
| `pytest -k "inventory or label or nfc or kiosk or vendor or encrypt"` | ✅ 2319 passed, 1 skipped (`py_vapid`); the sandbox database was migrated with `alembic upgrade heads` |
| `cd frontend && npm run typecheck`                                    | FE_TSC                                                                                                 |
| `cd frontend && npm run lint`                                         | FE_LINT                                                                                                |

---

## Pass 13 (2026-10-29) — watchdog pickup, near-zero delta (frontend print/a11y/dashboard-naming fixes, 2 cross-cutting encryption touches on `InventoryVendorContact`), 0 fixed, 0 new findings

**Watchdog pickup.** No PR with a `claude/security-review-` head branch was
open (`list_pull_requests`, state=open, 0 results among `claude/security-review-*`
head branches — the 5 open PRs at the time were all unrelated feature work).
The dedicated `/loop 30m /security-review` session (`session_011T1ZyyLrD5HagusgK9uDw2`)
remains unreachable, confirmed via `ListAgents` ("No reachable agents"). PR
#3816 (Feature 10, Documents & legal, pass 13) had already merged
(`e8a5c00b`); this pickup followed promptly rather than waiting for the next
scheduled tick. Per `PROGRESS.md`'s rotation table and PR #3816's own "Next
feature" note, row 11 (Inventory) was the next pending feature.

**Backend:** zero diff across all five endpoint files (`inventory.py` 150
routes, `inventory_nfc.py` 29, `labels.py` 12, `inventory_kiosk.py` 4,
`inventory_last_seen.py` 2 — all unchanged from pass 12) and both
`inventory_service.py` / `schemas/inventory.py` (confirmed via
`git diff <pass-12-merge>..HEAD --stat` returning nothing for any of these
paths). **Frontend:** `modules/inventory/*` — 7 commits, all UX/print/a11y,
no data-flow change. **Migrations:** none touching an inventory table;
`models/inventory.py` picked up two column-type changes from cross-cutting
PII/PHI encryption sweeps that landed independently of this rotation.

### Scope

Baseline is pass 12's own merge commit, `6eefb3c4` (PR #3738) — confirmed an
ancestor of `HEAD` via `git merge-base --is-ancestor`. `git log --no-merges
6eefb3c4..HEAD` against every declared scope file (five endpoint files, both
services, both schema/model files, `frontend/src/modules/inventory`) returns
**7** commits, none made through this rotation:

1. **`fde3d647` / `b48d63f2`** — repo-wide PII/PHI encryption sweeps
   ("Encrypt personal phone numbers and addresses at rest" /
   "Encrypt email columns and add fingerprint columns to the models"). Their
   only touch inside this feature's scope is `InventoryVendorContact.phone`
   and `.email` in `models/inventory.py`, both switched from `String` to
   `EncryptedText`. Verified, not assumed: `grep`ped every reference to
   `InventoryVendorContact` across `inventory_service.py`,
   `endpoints/inventory.py` and `schemas/inventory.py` — the only query
   touching these rows orders by `.name` (`inventory_service.py:1576`); no
   `.ilike()`, `.filter()` or `.order_by()` ever targets `.phone` or
   `.email`, so the encrypted columns cannot be SQL-filtered/sorted/searched
   anywhere in this feature. The accompanying migrations
   (`20261025_1852_5510d5ff49eb_encrypt_contact_phone_numbers_and_.py`,
   `20261026_1211_b8236e29ec44_encrypt_email_addresses_at_rest.py`) both
   check `inventory_vendor_contacts` against `inspector.get_table_names()`
   before touching it (Pitfall #26 — the table is `create_all`-built on a
   fresh install) and both detect already-encrypted values by a frozen
   ciphertext-prefix check before re-encrypting, so either migration no-ops
   safely on a second run. Read in full, not sampled.
2. **Five frontend-only commits** (`4c643e01`, `955ebfd3`, `e60143a8`,
   `2a9b11c9`, `c5640463`) — a label-printing "Print stays disabled" bug fix
   (new test proven to fail pre-fix, per the commit's own description), a
   dashboard work-queue rename (`W79-10`, owner decision, Pitfall #29 shape),
   label font/wrap/paper-size print fixes, and one WCAG contrast-token swap
   on `EquipmentCheckForm.tsx`. `git diff 6eefb3c4..HEAD -- frontend/src/modules/inventory`
   swept for every previously-found-unsafe pattern (`window.confirm` /
   `.alert` / `.prompt`, `dangerouslySetInnerHTML`, `.toLocaleString()` /
   `.toLocaleDateString()` / `.toLocaleTimeString()`, a bare `date-fns`
   import) — zero matches in the added lines.

Route decorators re-enumerated **by AST** (not grep) across all five
endpoint files this pass: `inventory.py` 150, `inventory_nfc.py` 29,
`labels.py` 12, `inventory_kiosk.py` 4, `inventory_last_seen.py` 2 — **197
total, identical set and count to pass 12.** Every one of the 197 route
handlers' AST dump contains a `Depends` reference (crude auth-presence
check); `check_route_permissions.py --strict` — 279 routes repo-wide
(unchanged from pass 12's own count, since this feature added none),
0 errors, 0 warnings.

### Re-verified: INV-22, still OPEN, owner-accepted, unchanged

`get_fulfillment_options` / `get_requestable_categories` in
`inventory_service.py` carry zero diff since pass 12 (confirmed by the
file-level `git diff` above returning nothing), so the finding is
unaffected. `docs/KNOWN_LIMITATIONS.md`'s entry (the one referencing
`INV-22`, around line 3888) is unchanged; nothing new to add.

### Verified good ✅ (pass 13)

- **Zero backend diff since pass 12** across every declared endpoint,
  service and schema file — confirmed by `git diff <merge-sha>..HEAD --stat`
  returning empty for all eight backend scope files, not inferred from the
  commit list.
- **The two cross-cutting encryption touches on `InventoryVendorContact`
  introduce no SQL-queryable-ciphertext risk** — the only query against the
  table orders by `.name`, never `.phone`/`.email`, confirmed by grep across
  every file in scope.
- **Both accompanying migrations are `create_all`-tolerant and idempotent**
  on `inventory_vendor_contacts` specifically — read directly, not inferred
  from the commit message.
- **All 197 routes re-enumerated by AST this pass, identical set and count
  to pass 12** — no auth-dependency or permission regression possible from
  zero route-file diff.
- **No new `window.confirm`/`.alert`/`.prompt`, no new
  `dangerouslySetInnerHTML`, no new banned date-formatting call** anywhere
  in this window's frontend diff of this feature's scope — swept directly,
  not sampled.
- **INV-22's "owner-accepted, leave as is" status is unchanged** in code and
  in `KNOWN_LIMITATIONS.md`.

### Findings

**0 fixed, 0 new findings.** No application code in this feature's own
backend scope changed since pass 12; the only in-scope change
(`InventoryVendorContact` column-type swap) was reviewed and found sound,
and the frontend changes carry no security-relevant behavior. INV-22 is the
only standing item and remains unchanged.

| ID     | Status                                        |
| ------ | --------------------------------------------- |
| INV-22 | Re-confirmed OPEN, unchanged (owner-accepted) |

### Schema & migration notes

No migration in this pass touches an inventory table. The two migrations
that touch `inventory_vendor_contacts` as part of a repo-wide column-type
change were authored and reviewed outside this rotation; verified here only
for this feature's own table (see Scope above).

### Guard tests added

None this pass — no new code in this feature's own scope to guard.

### Completion gate {#completion-gate-pass-13}

| Check                                                   | Result                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------ |
| `flake8 app/ tests/ alembic/`                           | ✅ 0 violations                                              |
| `black --check app/ tests/ alembic/`                    | ✅ 2714 files unchanged                                      |
| `isort --check-only app/ tests/ alembic/`               | ✅ clean                                                     |
| `python3 scripts/validate_migrations.py --strict`       | ✅ 667 revisions, single head (`b74bcce55c11`)               |
| `python3 scripts/check_route_permissions.py --strict`   | ✅ 279 routes, 0 errors, 0 warnings                          |
| `pytest tests/ -k "inventory or label or nfc or kiosk"` | ✅ 2040 passed, 1 pre-existing skip (`py_vapid`/`pywebpush`) |
| `cd frontend && npm run typecheck`                      | ✅ 0 errors                                                  |
| `cd frontend && npm run lint`                           | ✅ 0 errors, 0 warnings                                      |
| `npx vitest run src/modules/inventory`                  | ✅ 1875 passed (126 files)                                   |

Rotation row 11 → ✅ (pending this PR's merge); next is Feature 12
(Facilities).

---

## Pass 12 (2026-10-26) — watchdog pickup, real delta (19 commits: NFC tag register, variant-group rename, Medical Supplies lot recalls), 1 cross-cutting fix (migration fork, not this feature's code), 0 findings

**Watchdog pickup.** No PR with a `claude/security-review-` head branch was
open (`search_pull_requests`, 0 results, re-confirmed fresh at the start of
this iteration). PR #3734 (Feature 10, Documents & legal, pass 12) had
already merged, docs-only (`DOC-10-documents-legal.md` + `PROGRESS.md` only),
so there was nothing to record per Step 0's "docs-only PR" rule. Per
`PROGRESS.md`'s rotation table, row 11 (Inventory) was the next pending
feature.

**Backend:** same five endpoint files as pass 11 — `inventory.py` (150
routes, unchanged), `inventory_nfc.py` (29 routes, **+5**), `labels.py` (12,
unchanged), `inventory_kiosk.py` (4, unchanged), `inventory_last_seen.py` (2,
unchanged) — plus `inventory_service.py`, `schemas/inventory.py`,
`models/inventory.py`. **Frontend:** `modules/inventory/*` (unchanged scope,
plus a new `InventoryAdminLayout` wrapper and `InventoryNfcRegisterPage`).
**Migrations:** one new table in this feature's scope,
`3d67883cd461_inventory_lot_recalls.py`; see Schema & migration notes.

### Scope

Baseline is pass 11's own merge commit, `5871258c` (PR #3580) — confirmed an
ancestor of `HEAD` via `git merge-base --is-ancestor`. `git log --no-merges
5871258c..HEAD -- <every scope file>` returns **19** commits. Several are
phone-layout/a11y fixes and one checklist-overdue timing fix; the real
backend delta is three features:

1. **NFC Tag Register** (`aa3c2b77`, `df92e6eb`) — a department-wide
   register of every inventory NFC tag (on items, storage areas, and
   equipment-check compartments), with search, bulk lost/found, move, and a
   CSV export. Five new routes in `inventory_nfc.py`.
2. **Variant-group rename carried onto every size** (`6ba0a552`, `8c47a1e7`)
   — renaming a folded product now rewrites the matching name segment of
   every member item, not just the group row.
3. **Medical Supplies lot recalls, truck-lot export, "not yet counted"
   positions** (`4808afbd`, `4e1ff7ac`, `54a04340`) — primarily Feature 23's
   (Medical supplies) own rotation row, but it lands in `inventory_service.py`
   and `schemas/inventory.py`, both declared scope for this feature, so it is
   reviewed here rather than deferred.

Route decorators diffed directly across all five endpoint files: **+5**
(`GET /nfc-tags`, `GET /nfc-tags/export`, `GET /nfc-tags/move-targets`,
`POST /nfc-tags/bulk-status`, `POST /nfc-tags/{tag_id}/move`), 0 removed —
confirmed by a direct AST-style grep recount (`grep -cE
'^\s*@router\.(get|post|put|patch|delete)\('` against both the pass-11
baseline revision and `HEAD`: `inventory.py` 150 → 150, `inventory_nfc.py`
24 → 29). `check_route_permissions.py --strict`: **279** routes repo-wide
(up from 273 at pass 11; the other +1 belongs to an unrelated rotation row),
0 errors, 0 warnings.

### New real delta reviewed, all clean

- **NFC Tag Register — `GET /nfc-tags`, `GET /nfc-tags/export`, `GET
/nfc-tags/move-targets`, `POST /nfc-tags/bulk-status`, `POST
/nfc-tags/{tag_id}/move`, all in `inventory_nfc.py`, backed by the new
  `InventoryNfcRegisterService`.** Read the service and every route handler
  in full:
  - **Permission split matches the owner's stated decision exactly.** All
    five routes are gated `require_permission("inventory.manage",
"inventory.check_manage")` (OR), and `_register_kinds()` then narrows
    what a `check_manage`-only caller may request: a kind other than
    `compartment` (or unset) is a 403, never a silently empty result, so a
    checklist manager cannot mistake "not permitted" for "none exist."
    `bulk_update_status`'s `allowed_kinds` mirrors the same split
    server-side per tag, independent of what the caller requested.
  - **Every query in `list_tags`, `move_targets` and `move_tag` filters
    `organization_id`** on each of the three joined target types (item,
    storage area, compartment-via-template — Pitfall #14a shape (b) for the
    one without its own column) — read directly in
    `inventory_nfc_register_service.py`, not inferred from a comment. Tests
    (`test_inventory_nfc_register.py`, `test_inventory_nfc_register_endpoints.py`,
    392 + 418 lines) include an `other_org` fixture exercised against list,
    move-target, move, and bulk-status paths.
  - **`move_tag` cannot redirect a tag cross-org or across kinds.** It
    resolves the target through the same org-scoped `_get_item` /
    `_get_storage_area` / `_get_compartment` helpers `InventoryNfcService`
    already uses for linking, and refuses a kind change with a `ValueError`
    (400) before touching the row.
  - **The CSV export uses `SafeCsvWriter`** (Pitfall #15), is capped at
    `MAX_EXPORT_ROWS` (10,000), and audits the export (`inventory_nfc_tags_
exported`) with row/kind/status counts, not tag contents.
  - **`list_tags`'s search is `like_pattern(...).ilike(..., escape=
LIKE_ESCAPE_CHAR)`** (Pitfall #25) against `target_name`, `label` and
    `template_name` — confirmed present on the one `.ilike()` call site in
    the new service.
  - **`InventoryNfcTagBulkStatusRequest.tag_ids` is bounded at the schema
    layer** (`max_length=200`, matching `MAX_BULK_TAGS`), not just in the
    service loop, and each id is length-checked (`<= 36` chars) before any
    query runs.
  - Frontend: the new `/inventory/admin/nfc/tags` route gates on
    `requiredAnyPermission: ['inventory.manage', 'inventory.check_manage']`,
    matching the backend OR exactly, and is registered in all three
    registries (`APPLICATION_PAGES.md`, `testingRegistry.ts`,
    `mobile-route-inventory.ts` — Pitfall #30a; all three checks pass, see
    Completion gate).
- **Variant-group rename (`update_variant_group` →
  `_rename_variant_members`).** Reads every `InventoryItem` by a fresh
  `organization_id`-scoped query (not the group's possibly-stale `.items`
  relationship), matches only members whose name segment casefold-equals the
  group's **current** name, and raises `ValueError` before mutating anything
  if any resulting name would exceed the 255-character column — all-or-
  nothing, not a partial rename. `update_variant_group` itself resolves the
  group through `get_variant_group_by_id(group_id, organization_id)`, already
  org-scoped; the endpoint is `inventory.manage`-gated, matching every other
  group-mutating route, and the mypy follow-up (`8c47a1e7`) only narrows a
  type the service already guaranteed — no behavior change.
- **Medical Supplies lot recalls — `inventory_lot_recalls` table,
  `record_lot_recall`/`lift_lot_recall`/`list_lot_recalls`/
  `get_recalled_shelf_lots` in `inventory_service.py`, routed through
  `medical_supplies.py`.** Reviewed because it lands in this feature's
  declared scope files, even though the rotation row is Feature 23:
  - `record_lot_recall` takes the item row `with_for_update()` before the
    duplicate-recall check, closing the same race Pitfall #27 describes —
    two officers recording the same recall at once cannot both pass the
    check and leave two active rows. `lift_lot_recall` locks the recall row
    itself for the same reason.
  - Both endpoint handlers call `_require_medical_item(service, item_id,
org_id)` (org- **and** domain-scoped — 404, not 403, for a uniform item,
    so a medical-only officer cannot distinguish "not medical" from "not
    yours") before reaching the service, and `lift_medical_lot_recall`
    additionally checks the `recall_id` against the caller's own
    domain-filtered list before lifting.
  - The new `_usable_lot`/`_lot_not_recalled` filter is applied at every
    on-hand/low-stock/reorder/issuing/truck-figure site that already existed
    (confirmed by grepping both helpers across the file — 5 call sites,
    matching the commit's own claim), so a recalled lot cannot count as
    stock in one place while reading recalled in another.
- **`InventoryLotRecall`'s `recalled_by`/`lifted_by` FKs are `ondelete="SET
NULL"` and correctly `nullable=True`** (Pitfall #2).

### New migration reviewed: `3d67883cd461_inventory_lot_recalls`

- **Guarded against `create_all`** (Pitfall #26): `upgrade()` returns
  immediately if the table already exists, so a fresh install (which builds
  it from the model) and a re-run both no-op.
- **New table, no existing row changes** — nothing behaves differently until
  a recall is recorded, so there is no backfill correctness question (Pitfall
  #35 does not apply to a `CREATE TABLE`).
- `downgrade()` does real work (`DROP TABLE IF EXISTS`) and documents why it
  is destructive (every recall and lift recorded is lost) rather than being a
  bare `pass`.
- Verified against a real database, not just read: `alembic upgrade head`
  from a stale revision (see cross-cutting fix below) applied this revision
  and every later one cleanly, in order.

### Cross-cutting fix (not this feature's code): forked migration chain

While bringing up a database to run this feature's tests,
`scripts/validate_migrations.py --strict` failed with **two heads**:
`0a8d11fcada1` (forms `allow_embed`, Feature 26) and `b7e4c2a91d35` (event
guest check-in token, Feature 16) — both independently revising
`3f2593e8071e` on 2026-10-25, neither touching an inventory table. Per
CLAUDE.md's "no acceptable pre-existing errors" rule, fixed rather than
flagged: generated a merge revision with `alembic merge` (the repo's own
tool, matching the shape of the chain's existing merge revisions such as
`7dba2d6d2dbb`), hand-fixed its `black`/`isort`/`flake8` formatting and gave
`downgrade()` a real (if no-op) docstring rather than a bare `pass`. Single
head confirmed (`9ab7b4276c22`), and `alembic upgrade head` run end-to-end
against a real database applied all 15 pending revisions, including this
one, without error. Also regenerated `docs/DATABASE_SCHEMA.md`
(`--check` was stale — a repo-wide check belonging to whichever commit
last changed a model without regenerating it; the diff is one line, a
column count bump).

### Re-verified: INV-22, still OPEN, owner-accepted, unchanged

`get_fulfillment_options` / `get_requestable_categories` are untouched —
neither function's definition appears in this window's diff of
`inventory_service.py` (confirmed via `git diff ... | grep` on both
definitions, as every prior pass has). `docs/KNOWN_LIMITATIONS.md`'s entry
recording the owner's 2026-10-05 decision is unchanged; nothing new to add.

### Verified good ✅ (pass 12)

- **All 5 new routes are gated `inventory.manage` or `inventory.check_manage`
  (OR), with the kind a `check_manage`-only caller may act on narrowed to
  `compartment` server-side** — enumerated and read in full, not spot-checked.
- **Every new query in the NFC register service org-scopes its target**
  (item, storage area, or compartment-via-template), confirmed by reading
  `inventory_nfc_register_service.py` end to end; cross-org isolation is also
  covered by new tests exercising an `other_org` fixture against list, move,
  move-target and bulk-status.
- **The variant-group rename is all-or-nothing and org-scoped**, matching
  members by a fresh query rather than a possibly-stale relationship.
- **The new medical-supplies recall paths are org- and domain-scoped,
  row-locked against the race Pitfall #27 describes, and the "not stock"
  filter is applied everywhere stock is counted or issued** — confirmed by
  grepping every call site of the new filter helpers.
- **No new `.ilike()`/`.like()` without `escape=LIKE_ESCAPE_CHAR`, no new
  bare `csv.writer`** (the new CSV export uses `SafeCsvWriter`), **no new
  JSON-column shallow-copy mutation, and no new `window.confirm`/`alert`/
  `prompt` or `dangerouslySetInnerHTML`** anywhere in this window's diff of
  this feature's scope files (`grep` swept all 65 changed frontend files:
  zero matches).
- **The one new migration in this feature's scope is `create_all`-tolerant,
  reversible, and verified against a real upgrade**, not merely read.
- **INV-22's "leave as is" owner decision is unchanged** in code and in
  `KNOWN_LIMITATIONS.md`.

### Completion gate {#completion-gate-pass-12}

| Check                                                                                          | Result                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (pinned 7.4.1)                                                   | ✅ 0 violations                                                                                                                                                                                                                         |
| `black --check app/ tests/ alembic/` (pinned 26.10.1)                                          | ✅ clean                                                                                                                                                                                                                                |
| `isort --check-only app/ tests/ alembic/` (pinned 9.0.2)                                       | ✅ clean                                                                                                                                                                                                                                |
| `python3 scripts/validate_migrations.py --strict`                                              | ✅ single head (`9ab7b4276c22`), 655 revisions (after the merge fix)                                                                                                                                                                    |
| `python3 -m pytest tests/test_alembic_migrations.py tests/test_migration_create_all_tables.py` | ✅ 80 passed                                                                                                                                                                                                                            |
| `alembic upgrade head` against a real database                                                 | ✅ 15 pending revisions applied cleanly, in order                                                                                                                                                                                       |
| `python3 scripts/check_route_permissions.py --strict`                                          | ✅ 279 routes, 0 errors, 0 warnings                                                                                                                                                                                                     |
| `python3 scripts/generate_schema_docs.py --check`                                              | was stale (unrelated model changes); regenerated, re-checked ✅                                                                                                                                                                         |
| `pytest tests/ -k "inventory or label or nfc or kiosk"`                                        | ✅ 2035 passed, 1 pre-existing skip (`pywebpush`) — first run hit 106 failures on a stale test database (pre-dating this window's migrations); `alembic upgrade head` resolved it, confirming the failures were environmental, not code |
| `npm run typecheck` (`tsc-native.mjs --noEmit`)                                                | ✅ clean                                                                                                                                                                                                                                |
| `npm run lint` (`eslint --max-warnings 10`)                                                    | ✅ clean                                                                                                                                                                                                                                |
| `npx vitest run src/modules/testing/testingRegistry.test.ts`                                   | ✅ 12 passed                                                                                                                                                                                                                            |
| `npx playwright test src/e2e/mobile-route-integrity.spec.ts --project=chromium`                | ✅ 1 passed                                                                                                                                                                                                                             |
| `npx vitest run src/modules/inventory`                                                         | ✅ 1868 passed (126 files)                                                                                                                                                                                                              |

**1 cross-cutting fix** (the forked migration chain and the stale schema
doc — neither in this feature's own code; both repo-wide hygiene gates this
pass happened to be the one to trip). **0 findings** in this feature's own
code this pass: the three new features (NFC tag register, variant-group
rename, medical-supplies lot recalls) were reviewed fresh against all seven
checklist dimensions and found sound throughout — every new route is
permission-gated and org-scoped, the one new client-influenced write path
with cross-org reach (NFC tag move) is bounded to the same organization and
kind before use, the new migration is `create_all`-tolerant and reversible,
and no unsafe pattern was introduced anywhere in the frontend diff. INV-22 is
the only standing item and remains unchanged.

Rotation row 11 → ✅ (pending this PR merge). Next: Feature 12 (Facilities).

---

## Pass 11 (2026-10-23) — watchdog pickup, real delta (29 commits, kit sizing + correctness fixes), 0 fixed, 0 new findings, INV-22 re-verified open/accepted

**Watchdog pickup.** No PR with a `claude/security-review-` head branch was
open (`search_pull_requests`, 0 results) and the dedicated `/loop 30m
/security-review` session was not reachable (`ListAgents`). PR #3579
(Feature 10, Documents & legal, pass 11) had already merged, all CI green.
Per `PROGRESS.md`'s rotation table, row 11 (Inventory) was the next `⬜`.

**Backend:** same scope as pass 10 (`inventory.py`, `inventory_service.py`,
`labels.py`, `schemas/inventory.py`, plus the other inventory endpoint/schema/
service files) — only `inventory.py`, `labels.py`, `schemas/inventory.py` and
`inventory_service.py` actually changed; the rest are byte-identical to pass 10. **Frontend:** `modules/inventory/*` (unchanged scope). **Migrations:**
none — confirmed by grepping every migration added since pass 10's baseline
for `inventory`/`storage_area`/`equipment_kit`/`reorder`: zero matches. 640
revisions total (up from 623 at pass 10), single head, no inventory table
touched.

### Scope

Baseline is pass 10's own merge commit, `63b3e867` (PR #3432) — confirmed an
ancestor of `HEAD` via `git merge-base --is-ancestor`. `git log --no-merges
63b3e867..HEAD -- <every scope file>` returns **29** commits, mostly a11y/
layout fixes and features owned by other rotation rows (Medical Supplies
kiosk sessions, operations UTC timestamps, membership status) that happen to
touch a shared frontend file. The real backend delta is in four files:
`inventory.py` (+98/-0 net across diff), `labels.py` (+2 numeric bounds),
`schemas/inventory.py` (+268/-91, almost entirely `INT32_MAX`/`MONEY_MAX`/
`FLOAT32_MAX` bounds and blank-identifier normalization), and
`inventory_service.py` (+618/-50). Route decorators diffed directly across
all five endpoint files: **+2** (`GET /kits/product-options`, `GET
/kits/{kit_id}/issue-plan`), 0 removed. Direct recount: `inventory.py`
**151** (149 + 2), `labels.py` **12**, `inventory_kiosk.py` **4**,
`inventory_last_seen.py` **2**, `inventory_nfc.py` **24**.
`check_route_permissions.py --strict`: **273** routes repo-wide, 0 errors, 0
warnings.

### New real delta reviewed, all clean

- **Kit sizing (the bulk of this window's `inventory_service.py` delta) —
  `GET /kits/product-options`, `GET /kits/{kit_id}/issue-plan`, and
  `issue_kit_to_member`'s new `selections` body.** A kit line now names a
  _product_ rather than one fixed catalog row, and the quartermaster chooses
  a size per member at issue time. Read `get_kit_product_options`,
  `_kit_line_product`, `get_kit_issue_plan` and the rewritten
  `issue_kit_to_member` in full:
  - `_kit_catalog_query` scopes every candidate row to
    `InventoryItem.organization_id == str(organization_id)`, active and
    unretired — `get_kit_product_options` and `_kit_line_product` both build
    on it, so there is one org-scoped source for "what this org's catalog
    contains," not a second ad-hoc query to drift from it.
  - **The client-supplied override in `issue_kit_to_member` is bounded, not
    trusted.** `selections` maps a line id to a chosen `item_id`; the code
    first rejects any line id not in `kit.line_items` (`unknown = set(
selections) - line_ids`), then for each line resolves
    `_kit_line_product` to get `sibling_ids` — the set of row ids that are
    sizes of _that line's own product_, itself computed from the org-scoped
    `_kit_catalog_query` — and refuses the chosen id with a 400-equivalent
    message when it is not in `sibling_ids`. A chosen id can therefore only
    ever resolve within the same product as the line already names, in the
    caller's own org; it cannot be used to redirect an issuance at an
    arbitrary item id, in-org or cross-org. `get_item_by_id(target_id,
organization_id)` on the resolved id repeats the org filter before
    anything is issued.
  - `get_kit_issue_plan` and `issue_kit_to_member` both now call
    `get_equipment_kit_by_id(kit_id, organization_id, active_only=True)` —
    a deactivated kit cannot be issued from (matching the new docstring);
    reading/editing a deactivated kit is deliberately still possible
    elsewhere and untouched.
  - `get_kit_issue_plan` checks `is_in_org(self.db, User, user_id,
organization_id)` before building a plan for that member — the same
    guard `issue_kit_to_member` already had.
  - `GET /kits/product-options` is declared _before_
    `GET /kits/{kit_id}/issue-plan`'s sibling `/kits/{kit_id}` route in
    `inventory.py`, with a comment explaining why (`{kit_id}` would
    otherwise greedily match the literal path and fail UUID parsing) —
    confirmed by reading the route order directly, not merely trusting the
    comment.
  - Both new routes are gated `require_permission("inventory.manage")`,
    matching every other kit-mutating route.
- **`delete_storage_area` → `InventoryService.deactivate_storage_area`.**
  The route no longer deactivates a storage area with a bare `UPDATE`; the
  service now takes the row `with_for_update()`, counts active items stored
  in it and active areas nested under it (both counts org-scoped on their
  own `WHERE`, not inherited from the parent lookup), and raises
  `StorageAreaNotEmptyError` — surfaced as 409 — before touching
  `is_active`. This closes a real gap (deactivating a storage area out from
  under items still stored in it, previously silent) rather than just
  refactoring; reviewed as a correctness/data-integrity fix, not flagged.
- **`delete_item_lot` → lot deletion now refuses a lot a reorder receipt
  points at.** `delete_lot` joins `ReorderReceipt.inventory_lot_id ==
lot.id` before deleting and raises `LotReceivedAgainstReorderError`
  (409) when a receipt exists, rather than leaving
  `reorder_receipts.inventory_lot_id` dangling against a RESTRICT FK (which
  would have surfaced as a raw IntegrityError/500). The lookup is scoped
  through `_get_lot(lot_id, organization_id)`, already org-scoped.
- **`assign_item` — body/URL item-id confusion closed.** The route now
  rejects `assignment_data.item_id != item_id` (400) before calling the
  service, so a body naming a different item than the URL path can no
  longer silently act on the URL's item while claiming the body's id (or
  vice versa). A narrow but real correctness/IDOR-adjacent fix; already
  present at this commit, not something this pass needed to add.
- **`_assert_not_under_itself` — category cycle prevention.** `update_category`
  now refuses setting `parent_category_id` to the category itself or one of
  its own descendants, walking up the stored chain with a `seen` set that
  also recovers from a pre-existing bad row rather than looping forever. The
  walk re-queries `InventoryCategory.parent_category_id` scoped to
  `organization_id` at each step.
- **`_check_identifier_unique` generalizes the old `_check_serial_number_
unique` to `asset_tag` and `barcode`.** All three identifiers are now
  checked for an org-wide clash (including against retired items, since the
  `uq_item_org_*` constraints span every row regardless of `active`) before
  insert/update, naming the specific field in the error rather than letting
  the constraint violation surface as a generic 500. Schema-side, blank
  `serial_number`/`asset_tag`/`barcode` strings are normalized to `None`
  before this check runs (`_blank_identifier_to_none`), so two items each
  submitting `""` no longer collide with each other on the unique
  constraint.
- **`tracking_type` can no longer be flipped under a live assignment/
  issuance.** `update_item` refuses changing `individual`↔`pool` while the
  item is assigned to a member or has units issued, closing a state the
  other tracking mode's screens cannot read.
- **`unassign_item`/`return_pool_issuance`/`check_in_item` gain `commit:
bool = True`.** A `commit=False` caller gets the same validation and
  locking, skips the auto-archive side effect, and re-raises instead of
  rolling back — read each of the three in full; none skips a check, they
  only move where the transaction boundary and error handling sit for a
  caller (a permanent member delete) that must finish more work atomically.
- **Two `User.status == "active"` sites corrected to `User.status.in_(
ACTIVE_ACCOUNT_STATUSES)`** (CLAUDE.md Pitfall #32) — a probationary
  member search-eligibility query and the general member-listing filter.
  Widens who is found/listed to match every other status gate in the
  codebase; not a new grant.
- **`get_lots_for_items`/`find_lots_by_number` (new) both apply
  `_shelf_lots_count`** so an `apparatus_only` medical supply's shelf lots
  are excluded from the replacement-stock/recall-lookup results, consistent
  with pass 10's "kept on the apparatus only" feature. `find_lots_by_number`
  uses `like_pattern(needle)` with `escape=LIKE_ESCAPE_CHAR` (Pitfall #25) on
  a user-supplied lot number.
- **`CheckoutExtendRequest`/`EquipmentRequestFulfill.expected_return_at`
  moved to `UTCDateTime`** (schema type), replacing a hand-rolled naive-vs-
  aware comparison with the shared parser — a robustness fix, not a new
  rule.
- **Numeric bounds added across `schemas/inventory.py`** —
  `INT32_MIN`/`INT32_MAX`/`FLOAT32_MAX`/`MONEY_MAX` on every previously-
  unbounded `int`/`float`/`Decimal` field in this file (quantities, costs,
  `sort_order`, `min_rank_order`, `cylinder_pressure`, etc.) plus a parallel
  fix in `labels.py`'s printer `dpi` field. `IssuanceAllowanceCreate.
max_quantity` floor changed `ge=1` → `ge=0`, documented as deliberate (0
  means "none issuable for this role/category," distinct from no allowance
  row at all, which is uncapped) — read the docstring and confirmed this
  does not create a mistaken no-cap state.
- **Frontend-only commits** (phone-layout reflows across most inventory
  pages, equipment-check Present/Absent UI, checklist builder/report
  changes) — scanned all 37 non-test frontend files touched in this
  window's diff for `dangerouslySetInnerHTML`, `window.confirm`/`alert`/
  `prompt`, and a raw `axios.*`/`fetch(` call bypassing the module's service
  layer: **zero matches**.

### Re-verified: INV-22, still OPEN, owner-accepted, unchanged

`get_fulfillment_options` / `get_requestable_categories` are untouched —
neither function appears in this window's 29-commit diff of
`inventory_service.py` (confirmed via `git diff ... | grep` on both
definitions). `docs/KNOWN_LIMITATIONS.md`'s entry recording the owner's
2026-10-05 decision is unchanged; nothing new to add.

### Verified good ✅ (pass 11)

- **No route removed; the 2 routes added (`/kits/product-options`,
  `/kits/{kit_id}/issue-plan`) are both gated `inventory.manage`** and both
  read/write only org-scoped data — confirmed by reading every query they
  reach, not spot-checked.
- **The new kit-issue size override (`selections`) cannot redirect an
  issuance outside the kit line's own product/org** — the chosen item id is
  checked against `sibling_ids`, itself derived from an org-scoped query,
  before anything is issued. This is the one genuinely new client-
  influenced write path in this window and it is XC-1/XC-3 sound.
- **`deactivate_storage_area` and `delete_lot`'s new refusals close real
  silent-corruption gaps** (an area deactivated out from under its stored
  items; a lot deleted out from under a reorder's receipt record) rather
  than merely refactoring — both now fail loudly (409) instead of leaving a
  dangling reference.
- **No new `.ilike()`/`.like()` without `escape=LIKE_ESCAPE_CHAR`**
  (`find_lots_by_number` uses it correctly), no new bare `csv.writer`, no
  new JSON-column shallow-copy mutation, and no new `window.confirm`/
  `alert`/`prompt` or `dangerouslySetInnerHTML` anywhere in this window's
  diff of this feature's scope files.
- **INV-22's "leave as is" owner decision is unchanged** in code and in
  `KNOWN_LIMITATIONS.md`.

### Completion gate {#completion-gate-pass-11}

| Check                                                    | Result                                            |
| -------------------------------------------------------- | ------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (pinned 7.3.0)             | ✅ 0 violations                                   |
| `black --check app/ tests/ alembic/` (pinned 26.5.1)     | ✅ clean, 2567 files unchanged                    |
| `isort --check-only app/ tests/ alembic/` (pinned 9.0.1) | ✅ clean                                          |
| `python3 scripts/validate_migrations.py --strict`        | ✅ single head (`cc8c16cb6d98`), 640 revisions    |
| `python3 scripts/check_route_permissions.py --strict`    | ✅ 273 routes, 0 errors, 0 warnings               |
| `pytest tests/ -k "inventory or label or nfc or kiosk"`  | ✅ 1907 passed, 1 pre-existing skip (`pywebpush`) |
| `npm run typecheck` (`tsc-native.mjs --noEmit`)          | ✅ clean                                          |
| `npm run lint` (`eslint --max-warnings 10`)              | ✅ clean                                          |
| `npx vitest run src/modules/inventory`                   | ✅ 1816 passed (122 files)                        |

No application-code fix was needed this pass — the full 29-commit real delta
since pass 10 (kit sizing/issue-plan, storage-area and lot-delete
correctness guards, category-cycle prevention, identifier-uniqueness
generalization, numeric bounds) was reviewed fresh against all seven
checklist dimensions and found sound throughout: the one new client-
influenced write path (kit issue size selection) is bounded to the line's
own product and organization before use, both new routes are permission-
gated, no migration touches this feature's tables, and no unsafe pattern
was introduced anywhere in the frontend diff. INV-22 is the only standing
item and remains unchanged.

Rotation row 11 → ✅ (pending this PR merge). Next: Feature 12 (Facilities).

---

## Pass 10 (2026-10-19) — watchdog pickup, real delta (25 commits, mostly Medical Supplies), 0 fixes, 0 new findings, INV-22 re-verified open/accepted

**Watchdog pickup.** No PR with a `claude/security-review-` head branch was
open (`search_pull_requests`, 0 results) and the dedicated `/loop 30m
/security-review` session was not reachable (`ListAgents`). Per
`PROGRESS.md`'s rotation table, row 11 (Inventory) was the first `⬜` in the
current lap (rows 00–10 all `✅`, most recently row 10/Documents & legal via
PR #3431).

**Backend:** same 15 files pass 8/9 declared (`inventory.py`,
`inventory_service.py`, `labels.py`, `label_service.py`,
`label_printer_service.py`, `inventory_kiosk.py`, `inventory_last_seen.py`,
`inventory_nfc.py`, `inventory_notification_service.py`,
`inventory_audit_schedule_service.py`, `utils/inventory_nfc.py`,
`utils/label_renderer.py`, `models/label_printer.py`, plus the inventory
slice of `app/mcp/tools/inventory.py` / `app/mcp/tools/writes.py`),
unchanged. **Frontend:** `modules/inventory/*` (unchanged scope).
**Migrations:** one landed touching this feature's table —
`0bbf263a5ff0` (`inventory_items_apparatus_only`), reviewed below; 623
revisions total (up from 599 at pass 9), single head, no other migration in
range touches an inventory table.

### Scope

Baseline is pass 9's own merge commit, `ccdf9750` (PR #3272) — confirmed an
ancestor of `HEAD` via `git merge-base --is-ancestor`. `git log --no-merges
ccdf9750..HEAD -- <every scope file>` returns **25** commits (374 non-merge
commits landed repo-wide in the same range). All 25 were read via `git show`
in full. Route decorators were diffed directly across all five endpoint
files (`git diff ccdf9750..HEAD -- <files> | grep '^[+-]@router\.'`), which
returned **nothing** — zero route lines added or removed since pass 9.
Direct recount confirms `inventory.py` **148**, `labels.py` **12**,
`inventory_kiosk.py` **4**, `inventory_last_seen.py` **2**,
`inventory_nfc.py` **24** — all unchanged from pass 9.
`check_route_permissions.py --strict`: **272** routes repo-wide (up from 270
at pass 9), 0 errors, 0 warnings.

Most of the real delta is new work on **Medical Supplies** (a sibling
feature, MSUP-23, with its own endpoint file `medical_supplies.py` outside
this feature's scope) that extends the five files/functions this feature
does own in `inventory_service.py`/`models/inventory.py`/`schemas/inventory.py`
and the shared `modules/inventory/*` frontend. Reviewed to the depth that
shared surface warrants — the endpoint-level enumeration of
`medical_supplies.py` itself is MSUP-23's own rotation turn, matching the
"Feature-X-owned, reviewed only for this feature's own surface" precedent
pass 9/pass 10-of-other-features already established (e.g. RPT-29 pass 9 on
`saved_report_delivery`, DOC-10 pass 10 on the executive-minutes publishing
path).

### New real delta reviewed, all clean

- **`d4cedd53`/`a9e7ffae`/`cb142452`/`6556baef`/`a30675f5`/`dce89db1`/`8a924f49`/`601d6a72`/`8b30e83d`/`20576fc8`
  — "kept on the apparatus only" + shelf/apparatus stock breakdown.** New
  `inventory_items.apparatus_only` column (migration `0bbf263a5ff0`: guarded
  on table/column existence per Pitfall #26, additive, `nullable=False` +
  `server_default="0"` matching the model's `Boolean, nullable=False,
default=False, server_default="0"` — no Pitfall #2 concern, no FK
  involved) and a new `InventoryService.stock_breakdown`/
  `apparatus_ready_stock`/`_medical_item_ids`/`item_sizes`/
  `storage_area_index`/`location_names`/`storage_paths_for`/
  `item_ids_stored_in`/`item_ids_kept_in_stock`/`next_lot_expirations`/
  `category_item_counts`/`pool_item_ids_by_name`/`get_lots_for_export`
  method set. **Every one of these new methods takes `organization_id` as
  an explicit parameter and filters on it directly in its own query** (not
  merely trusting a caller that already filtered) — read each in full:
  `_medical_item_ids`, `item_sizes`, `storage_paths_for`,
  `item_ids_stored_in`, `item_ids_kept_in_stock`, `next_lot_expirations`,
  `category_item_counts`, `get_lots_for_export` all carry an
  `InventoryItem.organization_id == str(organization_id)` (or the
  lot/category/area equivalent) predicate alongside any client-influenced
  `id.in_(...)` filter, so even a caller passing an id from another org gets
  nothing back rather than a cross-tenant read. `apparatus_ready_stock`
  joins `CheckTemplateItem` → `CheckTemplateCompartment` →
  `EquipmentCheckTemplate` filtered on `EquipmentCheckTemplate
.organization_id == org` and is only ever called with item ids already
  narrowed to the caller's org by `_medical_item_ids`. All call sites in
  `medical_supplies.py` (`_attach_medical_list_extras`,
  `/expiring-lots`, `/expiring-stock`) derive `org_id`/`item_ids` from
  `current_user.organization_id` and the results of an already org-scoped
  query — never from unvalidated client input.
  - `is_pool_without_stock` gains an `apparatus_only` exception (a
    zero-quantity apparatus-only supply is not a data error); confirmed
    both `create_items_bulk` and the CSV import still share the one
    definition (the drift this helper exists to prevent).
  - `_shelf_lots_count` (new) excludes a medical supply's shelf lots from
    "expiring"/"next expiry" once it is `apparatus_only`, scoped the same
    way as every other predicate here.
  - `update_item`'s pool-quantity branch now refuses an explicit
    `quantity: null` by name (`"Pool item quantity is required"`) instead
    of letting the `< 0` comparison raise `TypeError` — a robustness fix,
    not new behavior; a pool item's quantity was never nullable.
- **`8b30e83d`/`20576fc8` — Medical Supplies CSV import/export
  (`medical_supplies.py`, outside this feature's own endpoint scope, but
  the two inventory_service.py helpers it calls were read as part of the
  shared-surface review above).** All four new routes
  (`/items/export`, `/lots/export`, `/items/import-template`,
  `/items/import`) use `SafeCsvWriter` (Pitfall #15) and are gated behind
  `require_permission("inventory.manage_medical", "inventory.manage")`.
  The import route caps the upload at `MAX_INVENTORY_CSV_BYTES` via
  `read_upload_limited`, rejects non-`.csv` filenames, and runs
  `reject_if_malicious` outside the generic try/except (so a malware
  refusal isn't swallowed into a generic 400) — the same shape the
  existing general import already uses.
- **`601d6a72` — bulk-retire for Medical Supplies
  (`ItemBulkRetireRequest`, capped at 200 ids).** The new
  `POST /medical-supplies/items/bulk-retire` resolves
  `items_in_domain(item_ids, org_id, MEDICAL_ITEM_TYPES)` before acting, and
  each per-item `retire_item(...)` call repeats the org/domain check under
  the item's own row lock (`required_item_types=MEDICAL_ITEM_TYPES`) —
  double-checked exactly like the single-item retire route, no XC-1/XC-3
  gap from the new batch path.
- **`7468e9f9` — `ReorderRequestUpdate.category_id` added.** Routes through
  the existing `_assert_reorder_fks_in_org` (`INV-4`/XC-1 helper, unchanged)
  with `allow_none=True`, which both validates a non-null id is in the
  caller's org and lets an explicit `null` clear the field — not a new
  helper, just a new caller of one already covering this exactly per its
  own docstring.
- **`f6adb44d` — MCP: opt-in switch to share medical supply inventory with
  Claude** (`app/mcp/tools/inventory.py` touched only by its module
  docstring; the new tools live in the new `app/mcp/tools/medical_supplies.py`,
  outside this feature's file list but reviewed given the shared gating
  mechanism). Read `register()` in full: all four new tools
  (`get_medical_supply_summary`, `list_medical_supply_items`,
  `list_low_stock_medical_supplies`, `list_expiring_medical_lots`) pin
  `item_types=MEDICAL_ITEM_TYPES`, derive `organization_id` from
  `principal.organization_id`/`org_uuid(principal)` (never client input),
  and require `gate="medical_supplies"` plus `permissions=
("inventory.view_medical", "inventory.view")`. Followed the gate through
  `registry.gate_allows` → `principal.expose_medical_supplies`, which is
  populated from `ClaudeMcpConfig.expose_medical_supplies` (new field,
  **defaults to `False`**) in both the OAuth path (`mcp/oauth.py`'s
  `scope_reach`/`McpOAuthService`) and the service-key path
  (`mcp/keys.py`'s `McpKeyService`) — a real server-side reader exists
  before the UI switch does anything, the Pitfall #19 shape done correctly
  from the start. For member OAuth sign-in the switch deliberately rides on
  `mcp:read` rather than a new scope (documented reason: claude.ai only
  requests the scope the 401 advertises, so a dedicated scope would never
  be granted); `gate_allows` still separately requires the member's own
  `inventory.view_medical`/`inventory.view` permission, so the switch alone
  does not widen what an individual member's own connection can read.
  Read-only: `create_reorder_request` still refuses a medical item
  regardless of the switch (unchanged).
- **Frontend-only commits** (`99555095`, `724ed2d3`, `25dc7d16`,
  `53e37f9a`, `f16ef931`, `d16af4c4`, `d6862d0a`, `d696fcf0`'s frontend
  half, `8a924f49`'s frontend half, `346a1837`, `99258edb`'s frontend half,
  `6bf7d79f`, `9a0c70b2`) — phone-layout reflows for the apparatus/checklist
  screens, equipment-check Present/Absent + replacement-date UI, and the
  catalog auto-link report's Undo action (backend for the last two lives in
  `equipment_check_service.py`/`equipment_check.py`, Feature 14's own
  files, reviewed there — not re-derived here). Scanned all 30 non-test
  frontend files in this window's diff for `dangerouslySetInnerHTML`,
  `window.confirm`/`alert`/`prompt`, and a raw `axios`/`fetch` bypassing the
  module's service layer: **zero matches**.

### Re-verified: INV-22, still OPEN, owner-accepted, unchanged

`get_fulfillment_options` / `get_requestable_categories`
(`inventory_service.py:10917`, `:11108`) are untouched — neither function
appears in this window's 25-commit diff (confirmed via `git log -L` on both
definitions over the same range). `docs/KNOWN_LIMITATIONS.md`'s entry
recording the owner's 2026-10-05 decision is unchanged; nothing new to add.

### Verified good ✅ (pass 10)

- **No route added or removed anywhere in this feature's five endpoint
  files since pass 9** — confirmed by diffing `@router.` decorator lines
  directly; route counts re-confirmed by direct recount.
- **Every new `InventoryService` method added this window filters its own
  query on `organization_id`**, rather than trusting an already-scoped
  caller — read individually above, not spot-checked.
- **The new MCP medical-supplies tool surface is gated server-side, not
  only in the UI**: `expose_medical_supplies` defaults to `False` and is
  read from the stored `ClaudeMcpConfig` on both the OAuth and service-key
  principal-construction paths, matching the Pitfall #19 pattern from day
  one (no "switch wired to nothing" gap, unlike the original
  `notification_rules` finding that pattern exists to prevent).
- **The new Medical Supplies bulk-retire and CSV import/export routes**
  all stay inside the established safe patterns: `SafeCsvWriter`
  (Pitfall #15), upload size cap + malware scan, `inventory.manage_medical`/
  `inventory.manage` gating, and (for bulk-retire) an org+domain check
  before acting plus a repeated check under the row's own lock.
- **No new `.ilike()`/`.like()` without `escape=LIKE_ESCAPE_CHAR`**, no new
  bare `csv.writer`, no new JSON-column shallow-copy mutation, and no new
  `window.confirm`/`alert`/`prompt` or `dangerouslySetInnerHTML` anywhere in
  this window's diff of this feature's scope files.
- **INV-22's "leave as is" owner decision is unchanged** in code and in
  `KNOWN_LIMITATIONS.md`.

### Completion gate {#completion-gate-pass-10}

| Check                                                                       | Result                                            |
| --------------------------------------------------------------------------- | ------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                               | ✅ 0 violations (repo-wide)                       |
| `black --check app/ tests/ alembic/`                                        | ✅ clean, 2455 files unchanged                    |
| `isort --check-only app/ tests/ alembic/`                                   | ✅ clean                                          |
| `python3 scripts/validate_migrations.py --strict`                           | ✅ single head (`2315d544d60a`), 623 revisions    |
| `python3 scripts/check_route_permissions.py --strict`                       | ✅ 272 routes, 0 errors, 0 warnings               |
| `pytest tests/ -k "inventory or label or nfc or kiosk or medical_supplies"` | ✅ 1898 passed, 1 pre-existing skip (`pywebpush`) |
| `npm run typecheck` (`tsc-native.mjs --noEmit`)                             | ✅ clean                                          |
| `npm run lint` (`eslint --max-warnings 10`)                                 | ✅ clean                                          |
| `npx vitest run src/modules/inventory`                                      | ✅ 1770 passed (118 files)                        |

No application-code fix was needed this pass. The full 25-commit real delta
since pass 9 — dominated by the Medical Supplies "apparatus only"/shelf-vs-
apparatus stock feature, its CSV import/export and bulk-retire routes, and
the new opt-in MCP medical-supplies tool surface — was reviewed fresh
against all seven checklist dimensions and found sound throughout: every
new query is independently org-scoped, the new MCP gate has a real
server-side reader before its UI switch, the new CSV routes use
`SafeCsvWriter` behind a size cap and malware scan, and the new additive
migration is guarded and correctly non-nullable with a default. No new
finding; INV-22 is the only standing item and remains unchanged.

Rotation row 11 → ✅ (pending this PR merge). Next: Feature 12 (Facilities).

---

## Pass 9 (2026-10-15) — watchdog pickup, real delta (15 commits), 0 fixes, 0 new findings, INV-22 re-verified open/accepted

**Watchdog pickup.** The dedicated `/loop 30m /security-review` session for
this repo appeared stalled (its last PR, #3262, Feature 10/Documents & legal
pass 9, merged 2026-10-15T12:20:31Z and no new `claude/security-review-*` PR
had opened in the following ~2 hours). Confirmed via `list_pull_requests`
(state=open) that no PR with a `claude/security-review-` head branch was open
— the only candidates were PR #3262 and a duplicate, #3265 (same disposition,
opened 6 minutes later), both already closed/merged by the time this pass
started; the Open PR row's own "watchdog tend" note already recorded that
fork being resolved. Per `PROGRESS.md`'s Rotation table, row 11 (Inventory)
was the first `⬜`, so this pass continues that feature rather than starting a
new one.

**Backend:** same five endpoint files, plus the eleven services/
utils/models/MCP-tool files pass 8 declared, unchanged in scope.
**Frontend:** `modules/inventory/*` (unchanged scope). **Migrations:** one
landed touching this feature — `1d65720bce34` (`inventory_item_also_called_names`),
reviewed below; 599 revisions total (up from 585 at pass 8), single head, no
other migration in range touches an inventory table.

### Scope

Baseline is pass 8's own merge commit, `6d177fea` (PR #3166) — confirmed an
ancestor of `origin/main` via `git merge-base --is-ancestor`.
`git log --no-merges 6d177fea..origin/main -- <every scope file>` returns
**15** commits (335 non-merge commits landed repo-wide in the same range).
All 15 were read via `git show` in full, not sampled. Route decorators were
diffed directly (`git diff 6d177fea origin/main -- backend/app/api/v1/endpoints/inventory.py \| grep '^[+-]@router\.'`),
which returned **nothing** — zero route lines added or removed in any of the
five endpoint files since pass 8.

**Doc correction, pass 8's own route count.** Pass 8 reported "`inventory.py`:
**149** routes (unchanged from pass 7)". A direct AST walk and a plain
`grep -cE '^@router\.(get\|post\|put\|patch\|delete)\('` both return **148** at
pass 8's own merge commit (`6d177fea`) as well as at the current head — the
file did not change between those two counts (confirmed by the empty decorator
diff above), so pass 8's "149" was a one-off miscount, not a route that
existed and was later removed. Noted here rather than silently carried
forward; this pass's own count (148) is the one to compare against in pass 10.

### Re-verified: INV-22, still OPEN, owner-accepted, unchanged

`get_fulfillment_options` / `get_requestable_categories`
(`inventory_service.py:9997`, `:10186` at pass 8; unchanged in this window —
neither function appears in any of the 15 commits' diffs) are untouched.
`docs/KNOWN_LIMITATIONS.md`'s entry recording the owner's 2026-10-05 decision
to leave this as is (full catalog materialization is load-bearing for
correctness, not a safe drive-by `LIMIT`) is unchanged; nothing new to add.

### New real delta reviewed, all clean

- **`bbe28745` — Fuzzy catalog matching for checklist items, plus an "Also
  called" field.** The largest commit this window: a new nullable JSON column
  (`inventory_items.also_called`), a new `app/utils/item_aliases.py`
  (`normalize_aliases` — trims, de-duplicates against the item's own name,
  caps at 10 entries of ≤100 chars, raises rather than truncating), extensions
  to `app/utils/name_matching.py` (token-level fuzzy matching — plural
  folding, digit-safe "4x4" equivalence, edit-distance word pairing — capped
  below `EXACT` so nothing through an alias or a fuzzy pair is ever treated as
  a safe auto-apply), and a new opt-in `fuzzy=true` on `GET /inventory/items`
  and `GET /medical-supplies/items`.
  - **Tenant isolation:** `search_items_fuzzy`'s own candidate scan
    (`inventory_service.py`) builds its `WHERE` from the existing
    `_build_items_query`'s `.whereclause` and **raises `RuntimeError`** if that
    clause is ever `None` — i.e., it fails closed rather than silently
    scanning every org's names if the query builder ever stopped org-scoping
    by default. Read in full; `_build_items_query` does still always include
    `InventoryItem.organization_id == str(organization_id)`.
  - **Abuse resistance:** the candidate scan is capped at `_FUZZY_CANDIDATE_CAP
= 5000` rows (a `.limit()` on the SELECT, with a logged warning if the cap
    is hit) — opting into fuzzy search cannot be turned into an unbounded
    full-table scan per request. The token-pairing algorithm itself is
    bounded by the handful of words in a name/alias, not by catalog size.
  - **Schema/migration integrity:** `1d65720bce34` follows the established
    `_has_table`/`_has_column` guard (Pitfall #26 — the table is already
    present on every install, but the pattern is kept for consistency) and is
    additive/nullable; downgrade drops the column. No backfill needed (every
    existing row reads as "no aliases").
  - **Write-path validation:** `also_called` on `InventoryItemCreate` /
    `InventoryItemUpdate` both route through `normalize_aliases` via a
    `field_validator`, and the update path's endpoint builds `update_data` with
    `model_dump(exclude_unset=True)` (confirmed at the existing call site), so
    an explicit `also_called: null` clears the column and an omitted key
    leaves it alone — the correct update-vs-create split (CLAUDE.md
    Pitfall #1).
  - **CSV import (`063db574`):** the companion "Also Called" import column
    reuses the identical `normalize_aliases` validator (same caps, same
    raise-not-truncate behavior) and a row over the limit is refused and
    reported, not silently dropped.
  - 1 new unit-test file plus additions to the existing CSV-import test file
    cover the alias caps, the dedup-against-own-name rule, and the
    fuzzy-search org-scope/cap; not independently re-run as a guard test this
    pass since nothing needed fixing (see Completion gate below for the full
    suite run).
- **`2cd84756` — Permanent delete for medical supply categories.** New
  `DELETE /medical-supplies/categories/{id}` behind
  `inventory.manage_medical`/`inventory.manage`. Both the category being
  deleted and an optional `move_items_to` destination are checked through
  `_require_medical_category` → `InventoryService.category_in_domain`
  (org-scoped **and** domain-scoped — a gear category can be neither deleted
  through this path nor chosen as a destination) before the service method
  runs. `InventoryService.delete_category_permanently` (read in full) locks
  both category rows **in sorted id order** (so two concurrent deletes naming
  each other as `move_items_to` cannot deadlock — the Pitfall #22/#27 pattern),
  takes the subcategory count and the item count as locking reads
  (`.with_for_update()`), and only then moves items (if any) and deletes the
  source row — all org-filtered. `CategoryHasItemsError` → 409,
  domain/not-found → 404, any other refusal → 400 via `safe_error_detail`.
  Audit event `medical_category_deleted` logged after success. 1 new backend
  test file (`test_medical_category_delete.py`, 374 lines) plus frontend
  component tests; not independently re-run as a guard test this pass (see
  Completion gate).
- **`c57cc039` — Medical supplies added to the CSV import sample.** Sample
  data and docs only, plus one validation-only change: `"medical"` is now an
  accepted `Item Type` CSV value. Confirmed by reading `_coerce_csv_row`: a
  recognized `item_type` cell is validated and then **discarded** —
  `# item_type lives on the category, not the item` — so accepting the value
  does not let a crafted CSV row set an item's actual domain; domain still
  comes entirely from the row's resolved `category_id`, as before. Still uses
  `SafeCsvWriter` for the template download (Pitfall #15 unaffected).
- **`922cb6aa`, `c926b687`, `51c77a9c`, `7879398d`, `e7696e15` — mypy/typing
  narrowing batches.** Each diffed in full against its own commit message's
  claims. All are one of: a loop/branch that already excluded the `None` case
  (a query filter, a prior guard) now stating that guarantee in the type
  instead of relying on runtime truth; a local variable renamed to stop two
  different row-tuple shapes sharing one name; or an explicit `Enum(...)`
  conversion replacing a raw string assignment into an enum column (fails
  loudly on an invalid value instead of persisting a non-enum string — the
  same `ChargeStatus`-style hardening pass 8 described, applied here to
  `RequestStatus` in `review_equipment_request`). The one `is not None`
  addition in `create_equipment_request`'s rank check
  (`inventory.py:4008-4013`) is provably redundant — it sits inside a branch
  already gated on `has_rank_restriction` (`min_rank is not None`) two lines
  above — so this is mypy satisfaction, not a behavior or fail-open/fail-closed
  change. No tenancy, auth, or locking change in any of these five commits.
- **Frontend-only commits** (`96f4f325`, `9743a817`, `0bb00a3c`, `755744f7`,
  `d32dfee0`) — dark-mode dropdown contrast, icon/label button layout, phone
  restacking of the apparatus and run-a-check screens, and a single
  accessible-name fix on the checklist admin page's scroll region. None add
  `dangerouslySetInnerHTML`, a direct `axios`/`fetch` call bypassing the
  module's service layer, or a `window.confirm`/`alert`/`prompt`.

### Route inventory (re-confirmed unchanged)

`grep -cE '^@router\.(get\|post\|put\|patch\|delete)\('` this pass:
`inventory.py` **148** (see the doc correction above — unchanged from pass 8's
actual code, pass 8's written count of 149 was the error). `labels.py`: 12,
`inventory_kiosk.py`: 4, `inventory_last_seen.py`: 2, `inventory_nfc.py`: 24 —
all unchanged from pass 8, confirmed both by the route-decorator diff and by
direct recount. `check_route_permissions.py --strict` (run from the repo
root, per Pitfall #30a): **270** routes repo-wide (up from 268 at pass 8), 0
errors, 0 warnings.

**Every route in all five files enumerated, not spot-checked:** a script
walked every `@router.` decorator in all five files (190 routes total) and
confirmed each carries either a `require_permission(...)` or a bare
`get_current_user` dependency. The 20 routes using `get_current_user` alone
were read individually (not merely pattern-matched): all 14 in `inventory.py`
are self-or-quartermaster patterns (`_require_self_or_quartermaster`, the
INV-8/INV-9-fixed shape), org-scoped-by-construction creates
(`create_equipment_request`, `create_return_request`), or caller-filtered
lists/self-keyed routes (`/requests`, `/return-requests`, `/my/size-preferences`
×2) whose authorization is inline rather than a decorator (`can_manage`
checks gating whether `mine_only` is honored or forced); all 6 in `labels.py`
gate through the module-scoped `_authorize_module(current_user, module)`
helper. No route in any of the five files carries no authorization check at
all.

### Verified good ✅ (pass 9)

- **No route added or removed anywhere in this feature's five endpoint files
  since pass 8** — confirmed by diffing `@router.` decorator lines directly.
- **The new fuzzy-search candidate scan fails closed** if the query builder's
  org-scoping clause is ever absent (`RuntimeError`, not a silent unscoped
  scan) and is capped at 5000 rows — no new abuse-resistance gap.
- **The new category hard-delete locks both rows in sorted id order** and
  takes its item/subcategory counts as locking reads, matching the
  established Pitfall #27 shape; both the source and destination category ids
  are org- and domain-validated before the service method runs.
- **No new `.ilike()`/`.like()` without `escape=LIKE_ESCAPE_CHAR`** — grepped
  every `ilike`/`.like(` call site in `inventory_service.py`: all carry
  `escape=LIKE_ESCAPE_CHAR`. No new bare `csv.writer` (the one CSV path
  touched, `download_import_template`, still uses `SafeCsvWriter`). No new
  JSON-column shallow-copy mutation (the new `also_called` column is replaced
  wholesale on write via the Pydantic validator, never mutated in place).
- **The `also_called` field is bounded even before its own 10-entry cap
  applies**, by the existing global `RequestSizeLimitMiddleware`
  (`MAX_REQUEST_BODY_SIZE`, 60 MB) — a maliciously large array in a single
  request is capped at the body-size layer before `normalize_aliases` ever
  runs, the same backstop every other unbounded-until-validated list field in
  this codebase relies on. Not a new gap specific to this feature.
- **INV-22's "leave as is" owner decision is unchanged in code and in
  `KNOWN_LIMITATIONS.md`**, re-confirmed by checking that neither function
  appears in this window's 15-commit diff.

### Completion gate {#completion-gate-pass-9}

| Check                                                   | Result                                            |
| ------------------------------------------------------- | ------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                           | ✅ 0 violations (repo-wide)                       |
| `black --check app/ tests/ alembic/`                    | ✅ clean, 2325 files unchanged                    |
| `isort --check-only app/ tests/ alembic/`               | ✅ clean                                          |
| `python3 scripts/validate_migrations.py --strict`       | ✅ single head (`bb60bd43bede`), 599 revisions    |
| `python3 scripts/check_route_permissions.py --strict`   | ✅ 270 routes, 0 errors, 0 warnings               |
| `pytest tests/ -k "inventory or label or nfc or kiosk"` | ✅ 1728 passed, 1 pre-existing skip (`pywebpush`) |
| `npm run typecheck` (`tsc-native.mjs --noEmit`)         | ✅ clean                                          |
| `npm run lint` (`eslint --max-warnings 10`)             | ✅ clean                                          |
| `npx vitest run src/modules/inventory`                  | ✅ clean                                          |

No application-code fix was needed this pass — the full 15-commit real delta
since pass 8 (the fuzzy-search/aliases feature, the medical-category hard
delete, the CSV-import sample/validation addition, and five mypy-narrowing
batches) was reviewed fresh against all seven checklist dimensions and found
sound throughout: correct org-scoping (including the new fail-closed fuzzy
scan), correct lock ordering on the new delete path, no new injection surface,
no new data-exposure gap, and a sound additive migration. The only correction
is the pass-8 route-count doc fix above (148, not 149) — not a security
finding, a bookkeeping miscount.

Rotation row 11 stays ✅ (pending this PR merge). Next: Feature 12
(Facilities).

---

## Pass 8 (2026-10-13) — watchdog pickup, real delta (50 commits), 0 code fixes needed, INV-8/INV-9/INV-16/INV-17 re-verified already fixed by owner-direct work, 1 doc correction (finding-id collision)

**Watchdog pickup.** PR #3160 (Feature 10, Documents & legal, pass 8) merged
2026-10-13T11:31:55Z; no `claude/security-review-*` branch or PR existed a few
minutes later (confirmed via `search_pull_requests` and a remote branch
listing — both empty). Rotation row 11 (Inventory) was the next `⬜`/next
pointer per PR #3160's own body.

**Backend:** same 15 files pass 7 declared (`inventory.py`, `inventory_service.py`,
`labels.py`, `label_service.py`, `label_printer_service.py`,
`inventory_kiosk.py`, `inventory_last_seen.py`, `inventory_nfc.py` (endpoints

- schemas + services), `inventory_notification_service.py`,
  `inventory_audit_schedule_service.py`, `utils/inventory_nfc.py`,
  `utils/label_renderer.py`, `models/label_printer.py`, plus the inventory slice
  of `app/mcp/tools/inventory.py` / `app/mcp/tools/writes.py`), unchanged.
  **Frontend:** `modules/inventory/*` (unchanged scope).
  **Migrations:** one landed touching this feature — `9e8b0b6f3fe8`
  (`grant_quartermaster_locations_create`), reviewed below; 585 revisions
  total (up from 527 at pass 7), single head, no other migration in range
  touches an inventory table.

### Scope

Baseline is pass 7's own merge commit, `b892afba` (PR #2966) — confirmed an
ancestor of `origin/main` via `git merge-base --is-ancestor`. This repo's
working copy was a shallow clone again (the exact failure mode pass 7's own
doc warned about); `git fetch --unshallow` was run **before** counting
anything, per that warning, rather than trusting a shallow `git log`.

`git log --no-merges b892afba..origin/main -- <every scope file>` returns
**50** commits (530 non-merge commits landed repo-wide in the same range, so
this feature is a small slice of a large window). All 50 were read via
`git show`, not sampled: roughly a third are mechanical mypy/typing
commits repo-wide sweeps touched in passing (`0d4d7c5a0`, `de96f2367`,
`9aca4fb41`, `c1b61de67`, `d59c4cfda`'s audit-chain-head fix) — each diffed in
full to confirm the only behavioral change is a strict robustness
improvement (`if error or obj is None` replacing bare `if error`, which
previously let a `None`-but-no-error service result fall through to an
`AttributeError`/500 instead of the correct 400); the rest are real feature
and correctness work, both owner-direct (the four items below) and
AI-authored. Route decorators were diffed directly
(`git diff ... | grep '^[+-]@router\.'`) rather than only counted: **zero**
route lines added or removed in `inventory.py`, `labels.py`,
`inventory_kiosk.py`, `inventory_last_seen.py`, or `inventory_nfc.py` since
pass 7 — every one of the 50 commits' functional changes landed on an
existing route (a new accepted field, a new status value, a new query
response field), confirmed by re-running the AST route count below rather
than assumed from the diff.

### Re-verified: four standing findings, all fixed by owner-direct work since pass 7

All four were pass 7's full list of open/flagged items. None of the fixes
below were reviewed by this rotation before now (they landed as
owner-direct commits between pass 7's merge and this pass, the same
"reviewed-after-the-fact" shape pass 8 of Documents & legal and Medical
screening both hit this cycle) — each re-derived against the current code,
not taken on its `KNOWN_LIMITATIONS.md` entry or commit message alone.

- **INV-8 / INV-9 — ✅ FIXED**, confirmed sound. `check_member_allowance`
  and `get_member_size_preferences` (`inventory.py:6187`, `:7162`) no longer
  depend on `require_permission("inventory.view")`; both now depend on
  `get_current_user` alone and call `_require_self_or_quartermaster(user_id,
current_user)` (`inventory.py:252-270`) before any query — self or
  `inventory.manage`, matching the clearance route's existing gate
  (`inventory.py:218-224`'s `_is_quartermaster` reuses the same permission
  check). Read both handlers and the guard function in full
  (commit `21afaf34d`). The guard does not itself re-check that `user_id`
  belongs to the caller's org, but both downstream service reads
  (`check_allowance`'s `ItemIssuance` query and
  `get_member_size_preferences`'s `MemberSizePreferences` query) filter on
  `organization_id == current_user.organization_id` in the same `WHERE` as
  the id, so a quartermaster passing a foreign org's user id gets an empty/
  default answer, never another org's row — no XC-3 gap, confirmed by
  reading `check_allowance` (`inventory_service.py:6872-6961`) and
  `get_member_size_preferences` (`:10813-10825`) in full. 8 new unit tests
  (`test_inventory_member_reads_self_or_manage.py`) re-run individually:
  8 passed.
- **INV-16 — ✅ FIXED**, confirmed sound. `update_reorder_request`
  (`inventory_service.py:9121-9180`) now reads the row with
  `select(...).where(id, organization_id).with_for_update()
.execution_options(populate_existing=True)` before any field is touched —
  a locking, org-scoped read, not the plain `get_reorder_request` fetch pass
  7 described. A `quantity_requested` below the row's current
  `quantity_received` is refused with a 400 naming the received count,
  closing the negative-outstanding-quantity state `receive_reorder` did not
  anticipate. `status`/`quantity_received` are still refused through this
  path entirely (unchanged from the MSUP-25 narrowing pass 7 recorded) — so
  the row-lock-plus-floor-check closes the race pass 7 flagged without the
  `expected_version` contract change pass 2's original finding assumed was
  necessary. 6 new integration tests
  (`test_inventory_reorder_edit_lock.py`) re-run individually: 6 passed.
- **INV-17 — ✅ FIXED**, confirmed sound, in two commits. `da1b5a9fe`
  (Complete work) and `4e18814f0` (Record inspection) both route through a
  new `GET /inventory/items/{id}/maintenance?open_only=true` query and a
  shared `InventoryService._apply_completion_to_item` helper, so "Complete
  work" and "Record inspection" grade a closed record identically (the PATCH
  path previously lacked the create path's failed-inspection quarantine —
  now shared). `update_maintenance_record` reads the target record
  `FOR UPDATE` so two officers completing the same open record cannot both
  succeed. Read `InventoryMaintenancePage.tsx`'s updated Complete
  work/Record inspection handlers and the backend helper in full; 12
  integration/component tests (`test_inventory_maintenance_close_open.py`,
  `InventoryMaintenancePage.test.tsx`) re-run individually: 12 passed.
- **INV-22 — still OPEN, owner-accepted, unchanged.** `get_fulfillment_options`
  / `get_requestable_categories` (`inventory_service.py:9997`, `:10186`) are
  untouched in this window except for a mypy-driven signature widening
  (`UUID` → `UUID | str`, no logic change — confirmed by diffing exactly
  those two function signatures). `KNOWN_LIMITATIONS.md` already records
  the owner's 2026-10-05 decision to leave this as is (full catalog materialization
  is load-bearing for correctness, not a safe drive-by `LIMIT`); nothing new
  to add.

### New real delta reviewed, all clean

- **`f60d0f252` — XC-1 sweep, 3 endpoints.** `create_equipment_request`
  (`category_id`), `create_exposure_record` (`user_id`, the exposed member)
  and `create_allowance` (`category_id`, `role_id`) each now call
  `assert_in_org` before the write, mapping a `ValueError` to 400 through
  `safe_error_detail`. 18 new integration tests
  (`test_xc1_operations_finance.py`) cover the cross-org-refused/same-org-
  accepted/`None`-accepted triple for each field; re-run individually: 18
  passed.
- **`d84bcc8bb`, `da1b5a9fe`, `4e18814f0`, `21afaf34d`, `bbaff4888`** — the
  four INV-8/9/16/17 fixes and the new storage-area scan-lookup feature,
  detailed above and in the route/finding sections.
- **`42dc0d663` — new departure-clearance record screen.**
  `GET /inventory/clearances/{id}` (existing route, `inventory.manage`,
  unchanged gate) now additionally resolves and returns `member_name`
  through an org-scoped `User` lookup
  (`User.id == clearance.user_id, User.organization_id ==
current_user.organization_id`) rather than returning the ORM row
  directly. No new route (confirmed against the route-decorator diff
  above); no tenant-isolation change — `DepartureClearanceService.get_clearance`
  was already org-scoped per pass 2's original INV-7 fix.
- **`ece7f153b` (W39-5) — a direct return now marks the open return notice
  "received".** `unassign_item`, `return_to_pool` and `checkin_item` each
  now call a new `_lock_open_return_notices` (locks the notice row(s)
  **before** the item, matching `review_return_request`'s existing lock
  order — a parametrized source-inspection test,
  `TestLockOrder::test_the_notice_is_locked_before_the_item`, asserts the
  call appears before `_get_item_locked` in each method's source, closing
  off the specific deadlock CLAUDE.md Pitfall #22/#27 warns about).
  Org-scoped by construction (`ReturnRequest.organization_id ==
str(organization_id)` in the lock query). 10 integration tests re-run
  individually: 10 passed.
- **`caf954d7f` (W39-5 follow-on) — inspecting a notice received another
  way.** `review_return_request` accepts a new `status="inspected"` only
  for a notice already `RECEIVED` (locked, org-scoped read with
  `populate_existing=True`); `_inspect_received_return`
  (`inventory_service.py:7940-8020+`) re-locks the item through the
  existing `_get_item_locked` (org-scoped) and resolves the receiving
  user/issuance through additional org-filtered queries — no new
  unscoped by-id read introduced. The follow-up logic (write-off/
  maintenance/charge-review selection) was extracted into
  `_record_return_follow_up`, shared by the receipt and the inspection
  path, so the two cannot grade a condition differently — read in full,
  confirmed identical business rules on both call sites (the W41-6
  pool-issuance write-off exclusion applies on both).
- **`f40489e1b` (W41-6)** — pool-issuance returns can no longer raise a
  write-off follow-up (400 if requested; `auto` now maps to maintenance for
  an out-of-service pool return). Correctness-only, no tenancy/auth surface.
- **`892d3483e`** — adds a Permanent/Temporary assignment choice with a
  return date to `assign_item_to_user`/`distribute_items`'s batch path; the
  new `expected_return_date` flows through the same already-org-scoped
  assignment-creation path, no new by-id read.
- **`891ff45d9` (W47-6)** — `get_low_stock_items` now sums in-date lot
  quantities for lot-stocked categories instead of a flat `quantity` column
  sum, matching `get_low_stock_items_for_alerts`'s existing rule. Read the
  new subquery/CASE construction in full: still a single org-scoped
  aggregate query, no per-row loop, no new cap needed (bounded by category
  count, as before).
- **`9bdd4d734` — equipment-check swap auto-reorder** (new file,
  `app/services/auto_reorder_service.py`, 213 lines; the triggering 76-line
  change to `equipment_check_service.py` is Feature 14/Equipment-check's own
  scope, not re-reviewed here beyond its call site). Read the new file in
  full: the item lookup and lock are org-scoped
  (`InventoryItem.organization_id == str(organization_id)`,
  `.with_for_update()`), the "already open" check is a **locked** read
  (`.with_for_update()` on the `ReorderRequest` scalar lookup — the correct
  Pitfall #27 shape, not a plain `SELECT` that could answer from a stale
  snapshot), `requested_by`/`organization_id`/`item_id` are all
  server-derived (the authenticated submitter, the caller's own org, and a
  lot's own already-org-scoped `inventory_item_id` — never client input),
  and the notification email HTML-escapes the item name and goes through
  the existing low-stock audience resolver (email-only, consistent with
  CLAUDE.md Pitfall #18). 23 new tests re-run individually: 23 passed.
- **`1a8c78e29` — equipment-check builder links checklist items to medical
  supplies.** New `InventoryService.create_item_if_absent(..., item_types=)`
  parameter and `ItemNameTakenOutsideDomainError`; the name lookup stays
  org-scoped (`_item_id_by_name(organization_id, name)`) and a cross-domain
  name collision now raises instead of silently handing back a gear row to
  a medical caller (or vice versa) — a correctness improvement, not a
  tenancy change. The new `POST /medical-supplies/items/create-if-absent`
  endpoint itself is Feature 23/Medical-supplies' own route, not
  re-enumerated here.
- **`6c45efd38` — MCP OAuth gating groundwork** (primarily Feature 33/Core
  infrastructure scope). The inventory slice: all four read tools in
  `app/mcp/tools/inventory.py` now declare
  `permissions=("inventory.view", "inventory.manage")` and
  `create_reorder_request` in `writes.py` declares
  `permissions=("inventory.manage",)` — matching the equivalent endpoints'
  existing gates exactly, and (per the registry's own fail-closed design,
  read in `app/mcp/registry.py` during pass 4's original review and
  unchanged here) an undeclared-permission tool now refuses for an OAuth
  principal rather than silently allowing it.
- **Mechanical mypy/typing commits** (`0d4d7c5a0`, `de96f2367`, `9aca4fb41`,
  `c1b61de67`, `d59c4cfda`) — each diffed in full; the only behavioral
  deltas are `if error or obj is None` guards replacing bare `if error`
  (seven call sites in `inventory.py`: `create_category`, `create_item`,
  `update_item`, `checkout_item`, `initiate_departure_clearance`,
  `resolve_clearance_item`, `complete_departure_clearance`,
  `fulfill_equipment_request` — a strict robustness improvement, since the
  prior code let a `(None, None)` service result fall through to an
  unguarded attribute read instead of the intended 400), a `ChargeStatus`
  enum conversion in two call sites (`issuance.charge_status = charge_status`
  → `ChargeStatus(charge_status)` — fails loudly on an invalid value instead
  of writing a non-enum string into an enum column), and
  `Mapped`/`mapped_column` conversions in `models/label_printer.py` with
  every argument (type, nullability, FK, `ondelete`) preserved — confirmed
  by diffing nullability/ondelete explicitly rather than trusting the
  commit's own "schema unchanged" claim.
- **Frontend commits in this window** (`642b0b7b2` through `6c45efd38`'s
  frontend halves) are overwhelmingly the matching UI for the backend items
  above (`AssignTermsModal`, `DepartureClearancePage`,
  `InventoryMaintenancePage`, `ReturnRequestsPanel`, `InventoryScanModal`),
  plus repo-wide sweeps whose own guard tests already cover this module
  (the dialog-dismiss-on-outside-click sweep, Pitfall #31; a page-level
  keyboard/screen-reader a11y sweep; dark-mode surface-opacity fixes) and
  the `CatalogLinkReportPage`/`EquipmentCheckTemplateBuilder` checklist-
  catalog-linking feature, whose backend routes
  (`/equipment-checks/inventory-link-report`,
  `/equipment-checks/inventory-links`) live in Feature 14/Equipment-check's
  endpoint file, not `inventory.py` — noted, not re-enumerated here, per
  this rotation's standing "own the feature's endpoint file" scope rule.
  None of the frontend diffs add `dangerouslySetInnerHTML`, a direct
  `axios`/`fetch` call bypassing `inventoryService`, or a
  `window.confirm`/`alert`/`prompt`.

### Doc correction: an unrelated 2026-10-11 feature reused the "INV-8" label

`docs/KNOWN_LIMITATIONS.md`'s "Inventory: storage-area barcodes are assigned
but the scanner cannot resolve them" entry (resolved by `bbaff4888`) cited
itself as "(INV-8)" in its own commit message and doc entry — the same
calendar day session `21afaf34d` used "INV-8"/"INV-9" for this rotation's
actual INV-8/INV-9 finding (the cross-member permission gate). The two are
unrelated: one is a security-review finding tracked in this file, the other
is a workflow-review-style feature docket that borrowed the same short label.
Nothing was miscategorized in code or tests — both commits' tests target the
right behavior — but a future reader searching this file for "INV-8" would
find two unrelated entries under the same id. Corrected in
`KNOWN_LIMITATIONS.md` with a disambiguating parenthetical rather than
renumbering either (renumbering a merged, shipped commit message is not
worth doing); this file's own INV-8/INV-9 numbering is unaffected and
unchanged.

### Route inventory (re-confirmed unchanged)

AST-walked `inventory.py` this pass: **149** routes (unchanged from pass 7).
`labels.py`: 12 (unchanged). `inventory_kiosk.py`: 4, `inventory_last_seen.py`:
2, `inventory_nfc.py`: 24 — counted explicitly this pass for the first time
(prior passes described these files narratively but had not run the AST
count on them); all three unchanged in this window per the route-decorator
diff above. `check_route_permissions.py --strict`: 268 routes repo-wide
(up from 245 at pass 7, reflecting growth elsewhere in the app), 0 errors,
0 warnings.

### Verified good ✅ (pass 8)

- **No route added or removed anywhere in this feature's five endpoint
  files since pass 7** — confirmed by diffing `@router.` decorator lines
  directly, not inferred from an unchanged count (a route could in
  principle be both added and removed between counts; the direct diff
  rules that out).
- **Every new/changed write path this pass reviewed is org-scoped and,
  where a concurrent write could race it, lock-ordered correctly**: the
  three XC-1 fixes, the reorder-edit lock, the maintenance-close-open
  locks, the return-notice locks (notice before item, matching the
  existing order), and the auto-reorder service's locked "already open"
  check.
- **No new `.ilike()`/`.like()` without `escape=LIKE_ESCAPE_CHAR`, no new
  bare `csv.writer`, no new JSON-column shallow-copy mutation** — confirmed
  by a direct grep of the added lines across every scope file in this
  window, not a prose claim.
- **INV-22's "leave as is" owner decision is unchanged in code and in
  `KNOWN_LIMITATIONS.md`**, re-confirmed by diffing the two functions'
  signatures (mypy-only widening) rather than re-litigating the decision.

### Completion gate {#completion-gate-pass-8}

| Check                                                   | Result                                            |
| ------------------------------------------------------- | ------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                           | ✅ 0 violations (repo-wide)                       |
| `black --check app/ tests/ alembic/`                    | ✅ clean, 2257 files unchanged                    |
| `isort --check-only app/ tests/ alembic/`               | ✅ clean                                          |
| `python3 scripts/validate_migrations.py --strict`       | ✅ single head (`4d8807bdd737`), 585 revisions    |
| `python3 scripts/check_route_permissions.py --strict`   | ✅ 268 routes, 0 errors, 0 warnings               |
| `pytest tests/ -k "inventory or label or nfc or kiosk"` | ✅ 1657 passed, 1 pre-existing skip (`pywebpush`) |
| 10 new/touched guard-test files, run individually       | ✅ all pass (118 tests total across the 10 files) |
| `npm run typecheck` (`tsc-native.mjs --noEmit`)         | ✅ clean                                          |
| `npm run lint` (`eslint --max-warnings 10`)             | ✅ 0 errors/warnings                              |
| `npx vitest run src/modules/inventory`                  | ✅ 1652 passed (113 files)                        |

No application-code fix was needed this pass — the four previously-open
findings were already fixed by owner-direct work between pass 7 and now, and
the new real delta (XC-1 sweep, the two W39-5 return-notice features, the
temporary-assignment control, the low-stock lot-sum fix, the auto-reorder
service, the mypy sweeps) was reviewed fresh and found sound throughout. The
one change this pass makes is the `KNOWN_LIMITATIONS.md` doc correction
above (a disambiguating parenthetical, not a renumbering) plus this file's
own new Pass 8 section — both documentation, which is why there is no
application-code diff to list beyond the doc edit.

Rotation row 11 stays ✅ (pending this PR merge). Next: Feature 12
(Facilities).

---

## Pass 7 (2026-10-06) — real delta (77 commits), 0 fixes, INV-16 narrowed, 0 new findings

**Watchdog pickup.** PR #2962 (Feature 10, Documents & legal, pass 7) had
merged with 0 application-code changes (docs-only), so per `PROGRESS.md`'s
own rule it was not independently recordable. No `claude/security-review-*`
PR was open; rotation row 11 (Inventory) was the first `⬜`.

**Backend:** same seven files pass 6 declared, plus five files this pass's
real delta added to the feature's actual footprint — `inventory_kiosk.py`,
`inventory_last_seen.py`, `inventory_nfc.py` (endpoints + schemas +
services), `inventory_notification_service.py`,
`inventory_audit_schedule_service.py`, `utils/inventory_nfc.py`,
`utils/label_renderer.py`, `models/label_printer.py`.
**Frontend:** `modules/inventory/*` (unchanged scope).
**Migrations:** none touching this feature this pass (527 revisions total,
single head, unchanged structurally for this module).

### Scope

**Not zero-delta, unlike pass 6.** `git log --no-merges --since
<pass-6-merge-time> -- <scope files>` initially returned 59 commits against
this repo's shallow clone — silently dropping 18 real commits (several NFC
phases, storage-area put-away/print, two label-printing commits) that the
shallow history couldn't resolve as reachable. `git fetch --unshallow` before
concluding anything surfaced the true count: **77 non-merge commits**. This
is the same class of history gap prior passes have hit from the squash/
orphan-merge side; here it was from the shallow-clone side, and the fix is
the same discipline — verify the count independently rather than trust the
first `git log` that returns a plausible-looking number.

Of the 77: ~16 are the separate workflow-review rotation's own
`docs(workflow-review): W15/W17/W22/W31/W38–W47` entries (confirmed via
commit message + `--stat` to be documenting fixes already present in the
application commits reviewed below — e.g. W17's fix is `9937d6521`, read
directly); ~19 are pure layout/copy/test-stub changes confirmed via `--stat`
to touch only CSS utility classes, copy strings, or unrelated files, with no
auth/tenancy/data-exposure dimension; the remaining ~27 are real
application-logic changes, each read via `git show` and checked against all
seven checklist dimensions.

### Re-verified standing findings

- **INV-8 / INV-9** — **still open**, unchanged. `check_member_allowance`
  (`inventory.py:6066-6071`) and `get_member_size_preferences`
  (`inventory.py:7029-7033`) both still gated on
  `Depends(require_permission("inventory.view"))` only. Still an owner
  decision (no established narrower-gate precedent for this module), already
  in `KNOWN_LIMITATIONS.md`.
- **INV-16 — narrowed, not closed.** `57e81e4d2` (the MSUP-25 fix, see
  below) added a guard to `update_reorder_request`
  (`inventory_service.py:8636-8669`) rejecting `quantity_received` and
  `status` changes through this unlocked path — those two fields can now
  only move through the row-locked `transition_reorder_request`
  (`:8674-8689`, `.with_for_update()` + `version` check). What pass 6 flagged
  as "any field" is now scoped to the remaining fields `update_reorder_request`
  still writes without a lock (`notes`, `quantity_requested`, vendor/line
  details) — a real narrowing, verified by reading both functions in full,
  not inferred from the commit message. `KNOWN_LIMITATIONS.md` amended with
  this correction rather than opened as a new finding, since the underlying
  question (lock the whole PATCH, or keep narrowing field-by-field) is
  unchanged.
- **INV-17** — **still open**, unchanged. `InventoryMaintenancePage.tsx:248`
  still calls `createMaintenanceRecord` unconditionally with no lookup for
  an existing open record. The one maintenance-touching commit this window
  (`57e81e4d2`) only removed "retired" from the condition-after dropdown and
  closed a second RETIRED-via-maintenance domain-lock bypass; it does not
  touch this logic.
- **INV-22** — **still open**, unchanged. `get_fulfillment_options`
  (`inventory_service.py:9520-9547`, `.scalars().unique().all()`, `[:limit]`
  applied at `:9640` after full materialization) and
  `get_requestable_categories` (`:9672-9690`) both still unbounded in
  Python, same shape as pass 6.

### Route inventory

`inventory.py`: **149** routes, up from pass 6's 144 (`labels.py`: 12,
unchanged; 1 WebSocket, unchanged). Verified by diffing
`grep -c "^@router\.\(get|post|put|patch|delete|websocket\)"` against the
pass-6 baseline commit and the current tree, then diffing the decorator
lines directly to confirm exactly 5 new routes, all added by `c1e30031f` /
`69c6de218` / `25119679e`: `POST /labels/mark-printed`,
`POST /storage-areas/{area_id}/put-away`, `GET /label-setups`,
`POST /label-setups`, `DELETE /label-setups/{setup_id}`. All five carry
`require_permission("inventory.manage")` — a single permission, no OR-gate —
reviewed below, all clean.

### Real commits reviewed, all clean

- **`57e81e4d2` (MSUP-25)** — generalizes the medical-domain re-check under
  lock across five medical-supplies writes and closes a second
  RETIRED-via-maintenance bypass; narrows INV-16 as described above.
  Exemplary: id-ordered locking read, fails closed.
- **`0549b7e02`** — server-issued `badge_code` replaces the client-visible
  membership-number/short-id as the scannable credential; both scanners now
  resolve server-side via rate-limited `/member-badges/resolve`. Fixes a real
  forgeable-credential bug (a client could previously construct a valid scan
  payload from a visible id).
- **`410e46990`** — member-badge label printing moved from `members.view`
  (a baseline grant) to `members.manage`/`members.manage_id_cards`, closing
  an over-broad permission gate on a sensitive print action.
- **`5273c49a4`** — new CR80 ID-card endpoints/service: org-scoped query,
  `MAX_CARDS_PER_JOB=500` cap, locked read-modify-write +
  `copy.deepcopy()` on the org settings JSON column.
- **`9937d6521`** — applicant labels now print the internal `_short_id`
  instead of the prospect's public status-check token — closes a credential
  leak via a physically-printed label.
- **`29da4419d`** — equipment-request status notifications: org-scoped
  re-read inside the background task, HTML-escaped template variables,
  email-only (no SMS), consistent with CLAUDE.md Pitfall #18.
- **`28934f50c`** — the inventory WebSocket's module-gate now runs
  `get_request_enabled_modules` against a typed `HTTPConnection` and enforces
  the module switch _after_ auth (closing a bypass via code 4003); a status
  query param gained a type, turning a prior 500 into a 422.
- **`2f18127c7` / `c1e85e119` / `109f553a8`** — swap `date.today()` /
  `datetime.utcnow()` for `resolve_org_today()` across expiry/
  maintenance-due logic. Correctness-only (Pitfall #29 class), org-scoped.
- **`734f2904c`** (NFC phase 4b, self-service kiosk) — new
  `inventory.kiosk` permission, seeded to no position by default, org-scoped
  via `current_user.organization_id`, gated behind the feature switch,
  audit-logged, and reuses the existing restriction-check logic rather than
  duplicating it.
- **`c1e30031f`** — organization-shared label-setup storage (replacing
  per-browser `localStorage`) plus a print-history table. Locked
  read-modify-write with `copy.deepcopy()` on org settings, a 20-setup cap,
  `printer_id` validated in-org before storage (XC-1), and
  `organization_id` denormalized directly onto the new
  `InventoryLabelPrint` table.
- **`8a0d9eafe`, `68cad931c`, `6e68f7d94`, `ffa7a3864`, `25119679e`,
  `999a71954`, `69c6de218`** — label/storage-area printing features (sheet
  start-position, org-scoped printed-by name lookup, cycle-bounded
  storage-area path building, the new put-away endpoint with a 1–500 cap and
  a custody-status blocklist). All org-scoped, all bounded.
- **NFC frontend phases (`7cbbf5be6`, `3a9c88fe1`, `b85bee97a`, `39a98e17f`,
  `cf78107a6`, `61e9ad495`)** — each new PII-bearing endpoint
  (`/nfc-scans`, `/nfc/audits`, `/not-seen`, `/nfc/resolve-member`) was added
  to `UNCACHEABLE_PREFIXES`/`UNCACHEABLE_SUBSTRINGS` in the **same commit**
  that introduced it — verified the cache-exclusion list grew in lockstep
  rather than trailing.
- **`b574c324a`** — offline-queue entries now stamp `ownerId` at write time;
  drain/flush paths filter to the signed-in member's own entries with a
  per-entry re-check, closing a window where a mid-sync sign-out/sign-in
  could send another member's queued check under the new session's cookies
  (tracked as FE3-34-5).
- **Frontend UI/copy/defensive-rendering commits** (`19e1b03da`,
  `c97b06ab3`, `ba2a90cf0`, `dbeee842b`, `ebd2f6916`, `34aa7288e`,
  `5d2d958f0`, `4cf2fb682`, `f30bfcaa5`, `f92fbd927`) — malformed-response
  crash guards, status-label wording, preferred-name display,
  checklist-completion UX. Confirmed by diff, not commit message alone: none
  touches auth, tenancy, or data exposure.

### Verified good ✅ (pass 7)

- Every new PII-bearing route this pass introduced is already in
  `UNCACHEABLE_PREFIXES`/`UNCACHEABLE_SUBSTRINGS`, added in the same commit
  — not a trailing gap.
- No new by-id endpoint missing org-scoping; no new client-supplied FK
  stored without in-org validation (the new `label-setups`/put-away routes
  validate `printer_id`/`area_id` in-org before writing); no new unbounded
  query beyond the already-standing INV-22; no new CSV export; no new
  `.like()`/`.ilike()` usage; no new JSON-column mutation via a shallow
  `dict()` copy (the new settings writes use `copy.deepcopy()`, per
  Pitfall #12).
- The five new routes all carry a single, proportionate permission
  (`inventory.manage`) with no OR-gate.

### Completion gate

| Check                                                   | Result                                            |
| ------------------------------------------------------- | ------------------------------------------------- |
| `flake8` (22 scope files)                               | ✅ 0 violations                                   |
| `black --check` (22 scope files)                        | ✅ clean, 22 files unchanged                      |
| `isort --check-only` (22 scope files)                   | ✅ clean                                          |
| `python3 scripts/validate_migrations.py --strict`       | ✅ single head (`15802f3df5c4`), 527 revisions    |
| `python3 scripts/check_route_permissions.py --strict`   | ✅ 245 routes, 0 errors, 0 warnings               |
| `pytest tests/ -k "inventory or label or nfc or kiosk"` | ✅ 1566 passed, 1 pre-existing skip (`pywebpush`) |
| `npm run typecheck` (`tsc-native.mjs --noEmit`)         | ✅ clean                                          |
| `npm run lint` (`eslint --max-warnings 10`)             | ✅ 0 errors/warnings                              |
| `npx vitest run src/modules/inventory`                  | ✅ 1574 passed (105 files)                        |

Rotation row 11 → ✅ (pending PR merge). Next: Feature 12 (Facilities).

---

## Pass 6 (2026-09-16) — watchdog re-verification, 0 new findings, 0 fixes — zero diff since pass 5's merge

**Watchdog pickup.** The `/loop 30m /security-review` session
(`session_011T1ZyyLrD5HagusgK9uDw2`) had produced no commit and had no open
security-review PR for 2h33m since PR #2611 (Feature 10, Documents & legal,
pass 6) merged at 2026-09-16T15:13:09Z — well past the loop's 30-minute
cadence, and with no in-progress branch for Feature 11 either. This scheduled
watchdog session picked up Feature 11 (Inventory) directly, per
`PROGRESS.md`'s own "Next: Feature 11" note.

**Backend:** `api/v1/endpoints/inventory.py`, `services/inventory_service.py`,
`api/v1/endpoints/labels.py`, `services/label_service.py`,
`services/label_printer_service.py`, `app/mcp/tools/inventory.py`, and the
inventory slice of `app/mcp/tools/writes.py` — the same scope pass 5 declared.
**Frontend:** `modules/inventory/*`.
**Migrations:** none landed touching this module (or anywhere in the repo)
since pass 5's merge.

### Scope

`git log 89754f4..origin/main` (`89754f4` is pass 5's own squash-merge
commit, confirmed an ancestor of `origin/main`) shows **266 commits** landed
on `main` since pass 5, none of which touch any file in this feature's
declared scope — `git diff --stat 89754f4..origin/main` across all seven
backend scope files plus `frontend/src/modules/inventory` returns **empty**.
`backend/alembic/versions` also has zero diff in that range, and
`validate_migrations.py --strict` reports the same 444 revisions / single
head (`6ab7d903fae5`) as pass 5 — confirming independently that no migration
landed repo-wide, not just within this module.

This is a genuine zero-delta re-verification, not an assumption from diff
silence alone: each of the four standing open items was re-read at its cited
line number in the current tree (not merely grepped for absence-of-diff),
per this rotation's own standing practice (see pass 5's identical framing for
Documents & legal in PR #2611).

### Re-verified still open, not re-flagged

- **INV-8 / INV-9** — `check_member_allowance`
  (`inventory.py:5920-5929`, route `GET
/allowances/check/{user_id}/{category_id}`) and
  `get_member_size_preferences` (`inventory.py:6887-6895`, route `GET
/members/{user_id}/size-preferences`) both still gated on
  `Depends(require_permission("inventory.view"))`, byte-identical to pass 5.
  Still mirrored in `KNOWN_LIMITATIONS.md`; still an owner decision (no
  established sibling precedent for a narrower self-or-`.manage` gate, per
  pass 2's original reasoning).
- **INV-16** — `update_reorder_request`
  (`inventory_service.py:8202-8227`) re-read in full: still a plain
  `get_reorder_request` fetch with no `.with_for_update()` and no `version`
  increment, unlike the sibling `/transition`/`/correct-status`/`/receipts`
  paths. Unchanged.
- **INV-17** — `InventoryMaintenancePage.tsx`'s "Complete work" handler
  (line 248) still calls `inventoryService.createMaintenanceRecord(payload)`
  unconditionally, with no attempt to locate and close an existing open
  record for the item first. Unchanged.
- **INV-22** — `get_fulfillment_options` (`inventory_service.py:9038-9227`)
  still materializes `compatible_items` (line 9111-9113) and, when
  `include_incompatible` is set, the entire `everything` catalog scan (line
  9180-9189) in Python before sorting and applying `listed[:limit]` at line
  9213 — no SQL-level `LIMIT` on either query. `get_requestable_categories`
  (`inventory_service.py:9229-9271`) still runs its category/item join with
  no `LIMIT` at all. Both re-read in full; identical to pass 5's description.
  The DOC-9-shape reasoning (a SQL-level cap would silently wrong-answer past
  the cutoff, since eligibility and the auto-suggestion are computed over the
  full narrowed set) still holds and was not re-litigated.

### Verified good ✅ (pass 6)

- **`labels.py`/`label_service.py`/`label_printer_service.py` and the
  inventory-owned MCP surface** (`app/mcp/tools/inventory.py`,
  `writes.py::create_reorder_request`) have zero diff since pass 3's and
  pass 4's merges respectively (four and two passes running clean) —
  `git diff --stat` confirms directly rather than trusting the running count.
- **Route count unchanged.** Not re-run as a fresh AST walk this pass (no
  diff in `inventory.py` to have changed it), but pass 5's own fresh count
  (144 routes, 1 WebSocket) stands on the strength of zero diff since —
  the same reasoning pass 5 applied to pass 4's MCP-tool count.

### Completion gate

| Check                                             | Result                                                      |
| ------------------------------------------------- | ----------------------------------------------------------- |
| `flake8` (scope files)                            | ✅ 0 violations                                             |
| `black --check` (scope files)                     | ✅ clean, 7 files unchanged                                 |
| `isort --check-only` (scope files)                | ✅ clean                                                    |
| `python3 scripts/validate_migrations.py --strict` | ✅ single head (`6ab7d903fae5`), 444 revisions — unchanged  |
| `pytest tests/ -k "inventory or label"`           | ✅ 1031 passed, 1 pre-existing skip (`pywebpush`), 0 failed |
| `npm run typecheck` (`tsc-native.mjs --noEmit`)   | ✅ clean                                                    |
| `npm run lint` (`eslint --max-warnings 10`)       | ✅ 0 errors                                                 |
| `npx vitest run src/modules/inventory`            | ✅ 1232 passed (74 files)                                   |

No code changes were made this pass — zero fixes needed, every standing flag
re-verified unchanged against a zero-diff scope — so, per CLAUDE.md's "match
the verification to the change" guidance, the full repo-wide backend/frontend
suites were not re-run beyond the scoped selections above: nothing in this
pass's own diff (none) could regress a file outside inventory/labels, and the
migration/route counts were independently confirmed unchanged rather than
merely assumed.

Rotation row 11 → ✅ (pending PR merge). Next: Feature 12 (Facilities).

---

## Pass 5 (2026-09-14) — 0 new findings; all 5 standing flags re-verified unchanged; the independently-landed diff since pass 4 reviewed and found correct

**Backend:** `api/v1/endpoints/inventory.py` (144 routes, 1 WebSocket —
unchanged count from pass 4; the only change in this file's diff is a
rewrite of the body of one existing route, `GET /items/export`, not a new
route), `services/inventory_service.py` (~11,150 L), `api/v1/endpoints/labels.py`
(12 routes) and `services/label_service.py`/`services/label_printer_service.py`
(zero diff on all three since pass 4's merge, re-confirmed by `git log`),
`app/mcp/tools/inventory.py` / the inventory slice of `app/mcp/tools/writes.py`
(zero diff since pass 4's first review of this surface)
**Frontend:** `modules/inventory/*` — see scope note below
**Migrations:** none landed touching this module's tables since pass 4's five
(`f2a91c7d4e86`/`b8e3f1a97c24`/`c4f7a2e91b38`/`d3f8b6a24c91`/`a1c7e93b2d54`,
all re-confirmed unchanged); `validate_migrations.py --strict` reports 444
revisions total (up from 439), single head — the growth is repo-wide, not
this module's

### Scope

Per this rotation's own precedent (Feature 09/10 pass 5s), prior art was
loaded rather than re-derived: `CHECKLIST.md`, `SEC-00`'s pass 5 (13
standing sweep classes, all clean against 485 intervening commits — none of
which is inventory-specific, so nothing there needed independent
re-checking here), and this file's own pass 2–4 history.

**Step 1 — re-verify the five standing flags.** `git diff
92a4917e7..origin/main` (`92a4917e7` is pass 4's squash-merge commit) against
every scope file confirmed `inventory_service.py`'s `check_member_allowance`/
`get_member_size_preferences` gates (INV-8/INV-9), `update_reorder_request`
(INV-16), and `get_fulfillment_options`/`get_requestable_categories` (INV-22)
have **zero** diff since pass 4 — grepped for each method name in the diff,
zero hits, then each read directly at its current (shifted, since unrelated
code earlier in the file grew) line number to confirm the actual body, not
just the diff's silence, matches pass 4's description exactly. The frontend
half of INV-17 (`InventoryMaintenancePage.tsx`'s `createMaintenanceRecord`
call site) is also outside this pass's diff (see frontend scope below) — not
independently re-read line-by-line this pass, taken as unchanged on the
strength of `git log` showing the file untouched since pass 4's merge. All
five: still open/flagged, unchanged. See
[Re-verified still open](#re-verified-still-open-pass-5) below.

**Step 2 — review everything that changed since pass 4's merge.** The range
is real but narrow this time: `inventory.py` gained 279 lines / lost 116 (net
+163, one route rewritten, not added — confirmed by the route-count check
below), `inventory_service.py` gained 128 lines net. All of it landed through
two independent, already-merged PRs (`64207d727`, `cfd28fef9`, plus the
repo-wide `0d3f9b833` dialog-dismiss sweep touching two files under this
module's frontend tree) — not a security-review branch, but this pass's job
is to review whatever the scope files now contain, regardless of which door
it came in through, per this rotation's standing instruction to review the
feature's current code rather than only its own prior diffs.

- **`GET /items/export` was rewritten from a single `limit=10000` fetch into
  a page-at-a-time `StreamingResponse`** (`inventory.py:930-1130` roughly;
  read in full, along with the new `get_items_page`/`_joined_items_query`/
  `_run_items_page` split in `inventory_service.py` it calls). Checked
  against all seven checklist dimensions:
  - **Auth/permission unchanged.** Still `Depends(require_permission("inventory.manage"))`
    — same gate as pass 1–4 confirmed. No new route was added; the endpoint's
    method/path/permission triple is identical to the row already in this
    file's route inventory, so the 144-route count and its route table both
    still hold without needing to be reprinted.
  - **Org-scoping preserved by construction, not merely unchanged.**
    `organization_id = current_user.organization_id` is read once, before the
    generator function is defined, into a plain local the closure captures by
    value — it cannot later observe a mutated `current_user` object even in
    principle. It is threaded into every page fetch
    (`service.get_items_page(organization_id=organization_id, ...)` →
    `_joined_items_query` → `_build_items_query`, which applies
    `.where(InventoryItem.organization_id == str(organization_id))` as the
    query's base clause before any other filter is added) — read
    `_build_items_query` in full (`inventory_service.py:1853-2010`) to confirm
    every one of the newly-exposed filter params (`condition`, `item_type`,
    `location_id`, `unassigned_location`, `storage_area_id`, `vendor_id`) is
    ANDed onto that base clause, never substituted for it.
  - **The new `_enum_filter` fails closed on a bad `status`/`condition`/
    `item_type` value** (`raise HTTPException(400, ...)`) instead of the
    pre-existing code's silent `except ValueError: pass` for `status` alone —
    a strict improvement (the old behavior quietly exported the whole
    catalog under a filename implying it was filtered), not a regression;
    checked that the raise happens in the synchronous part of the handler,
    before `StreamingResponse` is constructed, so it reaches the client as an
    ordinary 400 rather than a mid-stream failure.
  - **LIKE escaping intact.** `search` flows through the same
    `_build_items_query` → `like_pattern()` + `escape=LIKE_ESCAPE_CHAR` path
    every other inventory search already used (Pitfall #25); this endpoint
    added no new `.ilike()` call of its own.
  - **CSV injection protection intact.** Still `SafeCsvWriter`
    (`inventory.py`'s import and construction unchanged; `_export_item_row`
    is the same field list/order as the pre-rewrite inline version, moved
    into a named function, not altered).
  - **Abuse resistance: the rewrite closes a real gap rather than opening
    one.** The pre-rewrite endpoint capped at 10,000 items with no signal to
    the caller that rows past the cap were silently dropped from a file
    whose name and headers imply completeness — a correctness/abuse-adjacent
    defect in its own right, now gone. The new per-page query
    (`get_items_page`, 500 rows/page) is itself bounded, and the loop's own
    stopping condition (`if len(items) < _EXPORT_PAGE_SIZE: return`) is
    correct against `_run_items_page`'s tie-broken sort (id as the final sort
    key, confirmed unchanged in the diff), so offset paging cannot skip or
    repeat a row — matches this rotation's own INV-18/19-era reasoning for
    why a tiebreaker matters under concurrent writes.
  - **The generator's own DB session is a separate, already-established
    pattern** (`async_session_factory()`, read in `core/database.py:247-269`
    — the same factory `scheduled_tasks.py` and other background contexts
    already use outside request-scoped `Depends(get_db)`), not a new
    trust boundary: the session is opened and closed entirely inside one
    `async with`, after authorization has already run, and only ever issues
    the same org-scoped `SELECT`s `get_items_page` would run under the
    ordinary per-request session. No commit/write occurs on this path, so
    there is nothing for an abandoned/disconnected stream to leave
    half-written.
  - **No new by-id fetch, no new client-supplied FK persisted** — the
    endpoint is read-only and every new parameter is a query filter, not an
    id resolved to a row and returned; XC-1/XC-3 do not apply to a pure
    equality filter that participates in an org-scoped `WHERE`.
- **`update_maintenance_record` now gates writing `item.last_inspection_date`
  on `is_inspection_type(record.maintenance_type)`, mirroring the guard
  `create_maintenance_record` already had** (`inventory_service.py`, the
  `complete_maintenance`/PATCH branch). This is a correctness fix (a repair
  or cleaning could previously push an NFPA 1851 inspection deadline out by a
  full interval with nothing logged), not a security defect, but it sits in
  a compliance-relevant safety-tracking path this rotation has treated as
  in-scope before (INV-3's original finding was exactly this shape). Read
  `is_inspection_type` (`app/schemas/inventory.py:112-124`) and confirmed it
  is applied consistently on both the create and update paths, reads the
  type off the persisted `record` rather than the incoming payload (so a
  request that both completes a record and corrects its type in the same
  call is judged on the corrected type), and normalizes both the plain-string
  and stored-enum spellings — no gap left between the two call sites.
  No tenant-isolation, auth, or injection dimension is touched by this
  change; it does not introduce a new by-id query or FK.
- **Frontend (`InventoryItemsPage.tsx`, 491-line diff — the largest frontend
  change since pass 4, a member-facing variant-clustering/group-header UI
  plus the CSV export's filter-parity fix and an auto-top-up retry-guard
  fix) read in full**, checked against the same three dimensions pass 4's
  own frontend scope addition used: no `dangerouslySetInnerHTML`/raw
  `innerHTML`/`eval` (every rendered string — item names, category chips,
  location labels — is plain JSX interpolation); no `window.confirm`/
  `alert`/`prompt`; no direct `axios`/`fetch` call (still routes through
  `inventoryService`) and no client-side re-derivation of a permission or
  role-based filtering of a fetched list (Pitfall #29's shape, not present —
  the clustering/grouping logic operates on whatever the already
  org/permission-scoped API response contains, it does not decide who may
  see a row). `exportItemsCsv`'s frontend service wrapper
  (`services/inventoryService.ts:688-707`) still goes through the shared
  `api` axios instance (`withCredentials`/CSRF interceptor inherited), and
  its new parameter list matches the backend's new query params 1:1 — no
  parameter silently dropped between the two, which is what the export's own
  filter-parity fix was for. The five hand-typed `?? ''`/`?? undefined`
  fallbacks the diff adds are all lookup/display fallbacks
  (`.find(...)?.name ?? ''`, a `Set` key default), not a form-value-to-API
  coercion — Pitfall #1 does not apply to any of them.
- **`EquipmentCheckForm.tsx`, `EquipmentCheckFormUnmount.test.tsx`,
  `EquipmentCheckTemplateBuilder.tsx`** also changed in this range, but as
  part of the repo-wide `0d3f9b833` dialog-dismiss sweep (CLAUDE.md's new
  Pitfall #31, its own guard test `dialogDismissIntegrity.test.ts`) and
  feature 14's own equipment-check surface — out of this feature's scope per
  pass 3/4's identical reasoning (these files live under
  `modules/inventory/` for historical/directory reasons but are feature 14's
  code, reviewed on feature 14's own pass). Not read line-by-line here;
  noted rather than silently skipped. `ItemFormModal.test.tsx`'s new test
  (asserting the Add Item dialog no longer discards on an outside click) is
  this module's own regression coverage for that same repo-wide fix,
  confirmed present and passing (see [Completion gate](#completion-gate-2)).

**No fixable defect found in the diff.** Every change since pass 4 either
already shipped with its own tests (the two correctness fixes) or was
reviewed fresh here and found to preserve every invariant pass 1–4
established (the export rewrite, read as a first-time review of a
functionally new code path rather than trusted by association).

### Re-verified still open (pass 5)

- **INV-8 / INV-9** — `GET /allowances/check/{user_id}/{category_id}`
  (`inventory.py:5921`) and `GET /members/{user_id}/size-preferences`
  (`inventory.py:6888`) both still gated on the baseline `inventory.view`
  rather than a self-or-quartermaster/`.manage` shape. Zero diff on either
  handler since pass 4. Still mirrored in `KNOWN_LIMITATIONS.md`; still an
  owner decision (narrow the grant vs. accept any inventory-viewing member
  can read any other member's allowance/size data).
- **INV-16** — `update_reorder_request` (`inventory_service.py:8202`) still a
  plain `get_reorder_request` fetch with no `.with_for_update()` and no
  version bump, unlike the sibling `/transition`/`/correct-status`/`/receipts`
  paths. Zero diff since pass 4.
- **INV-17** — `InventoryMaintenancePage.tsx`'s "Complete work" flow still
  unconditionally calls `createMaintenanceRecord` rather than attempting to
  locate and close an existing open record. File unchanged since pass 4 per
  `git log`; not independently re-read line-by-line this pass (see Scope).
- **INV-22** — `get_fulfillment_options`/`get_requestable_categories`
  (`inventory_service.py`) still materialize their full pre-decision working
  set in Python before applying `limit`. Zero diff on either method since
  pass 4; the DOC-9-shape reasoning for why a SQL-level cap would silently
  wrong-answer past the cutoff still holds and was not re-litigated.

### Verified good ✅ (pass 5)

- **Auth coverage unchanged and re-confirmed by a fresh programmatic count**,
  not carried forward from pass 4's number on faith: an AST walk of every
  `@router.{get,post,put,patch,delete,websocket}`-decorated handler in
  `inventory.py` this pass found **144** routes, matching pass 4 exactly (one
  route's body changed, none added or removed), and confirmed the WebSocket
  is the only one without a `require_permission`/`get_current_user` in its
  signature — consistent with its established manual-auth pattern, re-read
  and unchanged.
- **The `GET /items/export` rewrite fixes a real, if minor, data-completeness
  defect** (the prior silent 10,000-row cap) as a side effect of the
  streaming redesign, without weakening any of the seven checklist
  dimensions — detailed above.
- **`update_maintenance_record`'s new inspection-date guard closes a
  compliance-relevant correctness gap** (an NFPA 1851 inspection deadline
  silently sliding on a repair/cleaning record) on the maintenance-completion
  path this rotation's own INV-3 finding was originally about — not itself a
  security finding, but exactly the class of defect this rotation treats as
  worth confirming rather than skimming past.
- **The inventory-owned MCP surface** (`app/mcp/tools/inventory.py`,
  `writes.py::create_reorder_request`) **has zero diff since pass 4's first
  review** — `git log` against both files since `92a4917e7` returns nothing,
  so pass 4's findings (gating, org-scoping, redaction, bounds — all clean)
  stand without re-reading the files line-by-line this pass.
- **`labels.py`/`label_service.py`/`label_printer_service.py` have zero diff
  since pass 3's merge** (three passes running), re-confirmed by `git log`.

### Completion gate {#completion-gate-2}

| Check                                             | Result                                                                  |
| ------------------------------------------------- | ----------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                     | ✅ 0 violations                                                         |
| `black --check app/ tests/ alembic/`              | ✅ clean (1592 files unchanged)                                         |
| `isort --check-only app/ tests/ alembic/`         | ✅ clean                                                                |
| `python3 scripts/validate_migrations.py --strict` | ✅ single head (`6ab7d903fae5`), 444 revisions (no migration this pass) |
| `pytest tests/ -k "inventory or label"`           | ✅ 1030 passed, 1 pre-existing skip, 0 failed                           |
| `npm run typecheck` (`tsc-native.mjs --noEmit`)   | ✅ clean                                                                |
| `npm run lint` (`eslint --max-warnings 10`)       | ✅ 0 errors                                                             |
| `npx vitest run src/modules/inventory`            | ✅ 1232 passed (74 files)                                               |

No code changes were made this pass (zero fixes needed — every standing flag
re-verified unchanged, and the diff since pass 4 was independently-landed,
already-tested correctness work found to preserve every invariant on review),
so the full backend suite was not re-run beyond the scoped selection above,
per CLAUDE.md's "match the verification to the change" guidance — nothing in
this pass's own diff (none) could regress a file outside inventory/labels.

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

## INV-8 / INV-9 resolved (2026-10-11)

Owner decision: self or `inventory.manage`, matching
`GET /inventory/users/{user_id}/clearance`. `check_member_allowance` and
`get_member_size_preferences` now depend on `get_current_user` and call
`_require_self_or_quartermaster(user_id, current_user)` before touching the
service. Guard tests: `tests/test_inventory_member_reads_self_or_manage.py`
(no baseline permission dependency on either route; 403 for a baseline member
reading a colleague, with the service never awaited; self and quartermaster
reach the lookup). `tests/test_my_size_preferences_permissions.py` updated: the
GET for another member no longer carries an `inventory.view` dependency, and the
PUT stays `inventory.manage`.
