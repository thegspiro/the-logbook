# Security Review 13 — Apparatus & NFC

**Prefix:** `AP` · **Iteration:** 13 · **Reviewed:** 2026-08-26 (pass 1), 2026-08-28 (pass 2), 2026-09-03 (pass 3), 2026-09-03 (pass 4), 2026-09-03 (pass 5), 2026-09-03 (pass 6) · **PR:** [#1838](https://github.com/thegspiro/the-logbook/pull/1838) (pass 1), [#2199](https://github.com/thegspiro/the-logbook/pull/2199) (passes 3–6)

**Backend:** `api/v1/endpoints/apparatus.py` (88 routes), `services/apparatus_service.py`,
`evoc_level_service.py`, `services/driver_exception_service.py` (new),
`api/v1/endpoints/nfc_tags.py` (5 routes — corrected in pass 2, see below), `services/nfc_tag_service.py` (new)
**Frontend:** `modules/apparatus`
**Migrations:** none this iteration (no schema change)

---

## Pass 6 (2026-09-03) — two more findings surfaced by pass 5's own AP-12/AP-13 fixes, both fixed

**Trigger.** Codex re-reviewed the pass-5 fix commits (AP-12 and AP-13) and
found two more issues, each in the code pass 5 had just added: an
unscoped subtree walk in the new `_lock_compartment_subtree`, and a
pre-existing autosave-timer gap in `deleteCompartment` that AP-13's own new
subtree-aware confirmation logic sits next to but does not address. Both
reproduced live before being called findings, both have a regression test
confirmed failing pre-fix (`git stash` on just the fix) and passing
post-fix.

### AP-14 — P1 (multi-tenant isolation, CLAUDE.md Pitfall #14a/14c) — `_lock_compartment_subtree`'s walk had no template or organization boundary — ✅ FIXED

**What:** AP-12's `_lock_compartment_subtree` walks descendants purely by
`parent_compartment_id`, with no check against `template_id`. `add_compartment`/
`update_compartment`/`create_template` all validate a _new or changed_
`parent_compartment_id` is same-template and same-org (AP-10) — but that
only prevents a cross-template link from being written from now on. A row
persisted before AP-10 shipped (or by any future writer that misses the
same validation) could still carry a dangling cross-template
`parent_compartment_id`. Left unscoped, the walk would follow it: deleting
a compartment in template A would reach into — and, via AP-12's own bulk
delete, permanently destroy — a compartment (and its items) belonging to
template B, in this org or another org entirely.

**Where:** `backend/app/services/equipment_check_service.py`,
`_lock_compartment_subtree` (pass-5 version, no `template_id` filter).

**Failure scenario, reproduced live:** built `Template A` (org A) with a
root compartment, and a completely separate `Template B` — in org A for one
test, in org B for another — with one compartment, then wrote that second
compartment's `parent_compartment_id` directly to point at `Template A`'s
root (simulating a row that predates AP-10's validation, the way an
existing installation's data could already look). Called
`delete_compartment` on `Template A`'s root. Pre-fix, the call
succeeded and returned `True` with no error — the cross-template
compartment would have been destroyed along with everything legitimately
in the subtree.

**Impact:** multi-tenant isolation — an authorized delete of an org's own
compartment could permanently destroy another organization's data, given a
single dangling FK from before this review's own create-time validation
shipped. Not attacker-controlled on a fresh install (both write paths now
validate), but a real amplification of any already-persisted malformed row,
exactly the shape CLAUDE.md Pitfall #14a/14c describes.

**Fix:** mirrors `documents_service.delete_folder`'s cross-org fail-closed
check. `_lock_compartment_subtree` now takes the root's `template_id` and
requires every locked row — root and each level of the walk — to belong to
it; the per-level query now also selects `template_id` so a mismatch can be
detected before the row is folded into the subtree set. Finding one raises
`ValueError` (`"...contains a cross-template reference..."`), which the
`DELETE /compartments/{id}` endpoint now catches and turns into a 400 (it
previously had no `try`/`except` around this call at all). The whole delete
aborts — nothing is destroyed — rather than either silently sweeping the
foreign row in or silently excluding it and leaving an unexplained
dangling reference.

### AP-15 — P2 (frontend, stale autosave state) — `deleteCompartment` left descendant items' pending auto-saves running after the subtree was gone — ✅ FIXED

_(Referred to as "AP-13 finding 4" in this pass's commit messages and code
comments, written before this doc gave it its own number — same finding,
cross-referenced here so a reader of either doesn't lose the thread.)_

**What:** `deleteCompartment`'s backend call removes every item in the
deleted subtree, but a debounced auto-save
(`scheduleAutoSaveItem`'s 1.5s timer, `updateItemFieldWithAutoSave`'s
persistence path) already queued for one of those items was left
untouched. The timer fires anyway, calls `updateCheckItem` against an id
the delete just removed, 404s, and (via `settleAutoSaveStatus`) flips the
global auto-save indicator to "Save failed" for an item the user never
touched. Worse: pressing Save inside that same window calls
`flushPendingAutoSaves` — the _first_ thing `handleSave` does, before any
compartment or other item update is sent — so the one stale patch aborts
saving everything else in the request too.

**Where:**
`frontend/src/modules/inventory/pages/EquipmentCheckTemplateBuilder.tsx`,
`deleteCompartment` (between the confirmation and the backend delete call).

**Failure scenario, reproduced live (component test, `git stash` on just
the fix):** rendered the builder, queued a debounced edit on `Radio`
(a `Cab` item) via the bulk-toolbar "Set Required" action, then deleted
`Cab` inside the 1.5s debounce window. Pre-fix, outwaiting the window
showed `updateCheckItem('radio', ...)` called anyway — the stale timer
fired against an id the delete had already removed.

**Impact:** no data-integrity risk on its own (the item really was
deleted, correctly, by the subtree delete) — a UI-honesty and
save-reliability defect: a spurious "Save failed" indicator with nothing
actually failed, and a real chance of aborting the save of _other_,
legitimate edits made around the same time as an unrelated delete.

**Fix:** right before issuing the backend delete call, `deleteCompartment`
now walks every item in `comp.items` and each `descendantComps[*].items`,
clears any pending timer for it in `autoSavePendingRef`, and removes the
entry — cancelling, not flushing, since the compartment those items
belonged to no longer exists to save them into. Calls
`settleAutoSaveStatus()` afterward so the global indicator doesn't stay
stuck reporting on save state that no longer applies.

## Guard tests added (pass 6)

- `backend/tests/test_apparatus_check_template_compartment_delete_scope.py`
  (new) — `TestDeleteCompartmentRejectsCrossTemplateSubtree` with
  `test_cross_org_dangling_link_aborts_the_whole_delete`,
  `test_same_org_cross_template_dangling_link_aborts_the_whole_delete`
  (AP-14, both confirmed failing pre-fix — the call succeeded and would
  have destroyed the foreign row — and passing post-fix), and
  `test_normal_same_template_subtree_still_deletes` (sanity check the
  scoping doesn't block the ordinary case).
- `frontend/src/modules/inventory/pages/EquipmentCheckTemplateBuilder.test.tsx`
  — `'cancels a pending item auto-save when the item's compartment is
deleted inside the debounce window'` (AP-15). Confirmed failing pre-fix
  (`updateCheckItem` recorded a call for the deleted item's id after the
  debounce window passed) and passing post-fix.

## Completion gate (pass 6)

| Check                                                                             | Result                                                                                  |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                     | ✅ 0 violations                                                                         |
| `black --check app/ tests/ alembic/`                                              | ✅ clean                                                                                |
| `isort --check-only app/ tests/ alembic/`                                         | ✅ clean                                                                                |
| `python3 scripts/validate_migrations.py --strict`                                 | ✅ single head, no schema change                                                        |
| `pytest tests/ -k "apparatus or nfc or evoc or equipment_check or compartment"`   | ✅ 577 passed, 1 skipped (pre-existing optional-dependency skip)                        |
| `pytest tests/` (full backend suite)                                              | ✅ 10069 passed, 21 skipped (pre-existing Docker/no-MySQL/optional-dep skips), 0 failed |
| `tsc --noEmit`                                                                    | ✅ 0 errors                                                                             |
| `eslint src/modules/inventory/pages/EquipmentCheckTemplateBuilder.tsx(.test.tsx)` | ✅ 0 errors                                                                             |
| `npm run lint` (full frontend, i.e. `eslint .`)                                   | ✅ 0 errors                                                                             |
| `vitest run EquipmentCheckTemplateBuilder.test.tsx`                               | ✅ 82 passed                                                                            |
| `vitest run src/modules/inventory` (full module)                                  | ✅ 683 passed (49 files)                                                                |

---

## Pass 5 (2026-09-03) — two findings surfaced by pass 4's own AP-11 fix, both fixed

**Trigger.** Codex reviewed the commit that fixed AP-9/AP-10/AP-11 (pass 4,
still on open PR #2199) and found two more issues in the same neighborhood:
a concurrency bug in `delete_compartment` itself (not new to pass 4 — this
codebase's own `delete_folder`/FAC-40 precedent is what named it, on
`DocumentFolder`, months earlier) and a client/server staleness gap in
AP-11's own new descendant-subtree computation. Both reproduced live before
being called findings, both have a regression test confirmed failing
pre-fix (`git stash` on just the fix) and passing post-fix.

### AP-12 — P1 (data integrity, concurrency) — `delete_compartment` cascaded off a stale REPEATABLE READ snapshot, the exact race FAC-40 already fixed once on `DocumentFolder`/`delete_folder` — ✅ FIXED

**What:** `delete_compartment` read the compartment
(`_get_compartment`, establishing this transaction's REPEATABLE READ
snapshot), then called `await self.db.delete(compartment)` and let the
ORM's `cascade="all, delete-orphan"` on `CheckTemplateCompartment.children`
lazy-load the subtree to delete. That lazy-load is a plain SELECT, so it
answers from the snapshot taken at the first read, not the latest committed
state. A concurrent, already-committed reparent of a descendant between the
snapshot and the delete is invisible to it, in either direction:

- A child moved **out** of the subtree is still in the stale `children`
  collection and gets destroyed anyway, even though it now belongs to a
  different, still-live compartment.
- A child moved **in** is absent from the stale collection, survives the
  cascade, and — because `parent_compartment_id` is `ondelete="SET NULL"`,
  not `CASCADE` — is left behind as a live, orphaned root once the database
  nulls its now-dangling FK.

This is structurally identical to FAC-40
(`docs/security-review/FAC-12-facilities.md`), fixed on
`DocumentFolder`/`delete_folder` in the Facilities pass — and worse here,
because `DocumentFolder.parent_id` is `ondelete="CASCADE"`, so a folder the
ORM's stale walk missed was still caught by the database when its true
parent was physically deleted. `parent_compartment_id`'s `ondelete="SET
NULL"` gives a stale compartment cascade no such backstop: what the ORM
misses, nothing else catches.

**Where:** `backend/app/services/equipment_check_service.py`,
`delete_compartment` (~pre-fix line 604–616).

**Failure scenario, reproduced live with two real, independently-committing
database sessions (not the savepoint-based `db_session` fixture, which
never truly commits):**

- _Reparent-out:_ built `Cabinet` → `Drawer` (child) and a separate
  `Other Cabinet`. Session A (the deleter) read `Cabinet`, establishing its
  snapshot. Session B moved `Drawer` under `Other Cabinet` and committed.
  Session A then called `delete_compartment('Cabinet', ...)`. Pre-fix,
  `Drawer` was destroyed anyway — confirmed by an assertion failure, not a
  code read.
- _Reparent-in:_ built `Cabinet` and a separate, unrelated `Loose Pouch`.
  Session A read `Cabinet` (snapshot). Session B reparented `Loose Pouch`
  under `Cabinet` and committed. Session A deleted `Cabinet`. Pre-fix,
  `Loose Pouch` survived as a live, orphaned root (`parent_compartment_id`
  nulled by the database) instead of being deleted with the rest of the
  subtree it now belonged to.

**Impact:** data integrity — an authorized delete either destroys a
compartment (and everything nested under it) that a concurrent, legitimate
edit had just moved to safety, or leaves a moved-in compartment alive when
the user asked to delete the whole subtree it was just placed in. Requires
two requests racing within the same transaction window to trigger; not
attacker-controlled, but a genuine correctness bug reachable by two
authorized staff editing the same template concurrently.

**Fix:** mirrors FAC-40's three-part pattern, adapted to this model's
actual FK actions:

1. `_lock_compartment_subtree` (new) walks the subtree level by level, each
   level's read both filtering _and_ locking on `parent_compartment_id` in
   one atomic `SELECT ... FOR UPDATE` — a locking read always sees latest
   committed state (ignores the snapshot) and locks every row it finds, so
   a concurrent reparent targeting an already-locked row blocks until this
   transaction commits or rolls back rather than racing it.
2. `delete_compartment` deletes the subtree as one explicit bulk
   `DELETE ... WHERE id IN (...)` against that authoritative id set,
   instead of the ORM's own (possibly stale) `children` cascade.
3. `CheckTemplateCompartment.children` and `.items` are now
   `passive_deletes=True`, so the ORM never independently re-derives (and
   potentially disagrees with) that set. Items fall out of the deleted
   subtree automatically via `CheckTemplateItem.compartment_id`'s
   `ondelete="CASCADE"` at the database level — that FK action fires
   against the database's own current row state, not any session's
   snapshot, so it stays correct regardless of a concurrent item reparent
   without any extra locking on items themselves.

`passive_deletes=True` on `children` also means a bare
`session.delete(compartment)` (e.g. a test exercising the old shape
directly) no longer cascades to descendants at all — by design, it now
defers entirely to the database's `SET NULL` action. The pre-existing AP-8
positive-control test exercised exactly that bare ORM delete; updated it to
call the actual `delete_compartment` service method instead, since that is
now the only correct way to remove a compartment subtree.

### AP-13 — P1 (frontend, pending-edit staleness) — `deleteCompartment`'s AP-11 subtree computation trusted the client's hierarchy, which can be ahead of what's persisted — ✅ FIXED

**What:** AP-11 (pass 4) fixed `deleteCompartment`'s confirmation and
local-state removal to account for the whole descendant subtree — but
computed that subtree from `compartments`, this screen's _current_ in-memory
hierarchy. Compartments have no auto-save path: `handleSave` is the only
code that ever writes `parent_compartment_id` to the backend (indent,
outdent, and the "stored inside" parent picker are all local-only edits
until Save). So the client's hierarchy can be ahead of the server's, and
`deleteCompartment` disagreeing with the server about subtree membership
cuts both ways:

- A descendant reparented **out** of the subtree in unsaved local state is
  correctly excluded from the confirmation and local removal — but the
  backend's cascade, still seeing the old `parent_compartment_id`, destroys
  it anyway. The user's in-progress edit (and the compartment itself, with
  whatever items it held) is silently and permanently lost.
- A descendant reparented **in**, unsaved, is included in the local
  computation and removed from the screen — but the backend leaves it alive,
  unaffected, under its old (still-current) parent. Not data loss, but the
  screen now disagrees with the database until the next reload.

**Where:**
`frontend/src/modules/inventory/pages/EquipmentCheckTemplateBuilder.tsx`,
`deleteCompartment` (~pre-fix line 804–826, the code AP-11 added).

**Failure scenario, reproduced live (component test, `git stash` on just
the fix):** rendered the builder against the fixture template (`Cab` with
`Medical bag` nested underneath it), clicked "Move Medical bag out one
level" (an unsaved outdent — `Medical bag` is now top-level in local state
only), then clicked delete on `Cab`. Pre-fix, the confirmation and delete
proceeded exactly as AP-11 left them — no mention of `Medical bag`, local
state left it alone, and `equipmentCheckService.deleteCompartment('cab')`
was called unconditionally. Against the real backend (not exercised by this
component test, but established by AP-12's own live reproduction of the
identical server-side mechanism) that call still cascades off
`Medical bag`'s actual, unsaved-locally, still-`cab`-parented row.

**Impact:** data loss on the frontend's own admission — a pending structural
edit (a reparent the user has not yet saved) can be silently destroyed by a
delete issued moments later on a sibling part of the same tree, with no
error and no indication anything but the intended compartment was removed.

**Fix:** chosen over having the backend report which ids it actually
deleted (Codex's alternative direction) because reparenting already has
exactly one persistence point (`handleSave`) for the frontend to
synchronize against — requiring that save first is the smaller, more local
fix, and needs no API contract change. Added `savedParentByIdRef`, a
last-known-server `id -> parentCompartmentId` map refreshed on every full
load (initial load and the reload `handleSave` triggers after a successful
save) and at every other point that persists a compartment's parent outside
`handleSave` (add compartment, add section header, duplicate/clone — all of
which the backend assigns a parent to immediately). `deleteCompartment` now
also computes the descendant set from that server-truth map
(`descendantIdsFromParentMap`, new in `equipmentCheckHierarchy.ts`, walking
a flat parent-id map the same way `descendantCompartmentIds` walks the live
component state) and compares it against the live client computation for
every id both sides have a record of. Any disagreement blocks the delete
before the confirmation dialog even opens, with a toast asking the user to
save first — the pending edit is left completely untouched, ready to be
saved and retried.

## Guard tests added (pass 5)

- `backend/tests/test_apparatus_check_template_compartment_race.py` (new)
  — `TestDeleteCompartmentExplicitlyLocksTheSubtree` with
  `test_child_reparented_out_mid_transaction_survives` and
  `test_child_reparented_in_mid_transaction_is_deleted_not_orphaned` (AP-12),
  using two real, independently-committing `AsyncSession`s (mirroring
  `tests/test_facility_document_reference_race.py`'s pattern). Both
  confirmed failing against pre-fix `equipment_check_service.py` (`git
stash` on just the fix) and passing against the fix.
- `backend/tests/test_apparatus_check_template_compartment_cascade.py`
  (updated) — the AP-8 positive control now calls
  `EquipmentCheckService.delete_compartment` instead of a bare
  `db_session.delete(root)`, since `passive_deletes=True` (AP-12) means the
  bare ORM delete this test used to exercise no longer cascades to
  descendants at all.
- `frontend/src/modules/inventory/pages/EquipmentCheckTemplateBuilder.test.tsx`
  — `'blocks deleting a compartment whose subtree has an unsaved reparent
(AP-13 finding 2)'`. Confirmed failing pre-fix (`git stash` on just the
  component/hierarchy-helper files — the delete proceeded unguarded, no
  toast, dialog opened, `deleteCompartment` API called) and passing against
  the fix.

## Completion gate (pass 5)

| Check                                                                                                                  | Result                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                                                          | ✅ 0 violations                                                                         |
| `black --check app/ tests/ alembic/`                                                                                   | ✅ clean                                                                                |
| `isort --check-only app/ tests/ alembic/`                                                                              | ✅ clean                                                                                |
| `python3 scripts/validate_migrations.py --strict`                                                                      | ✅ single head, no schema change                                                        |
| `pytest tests/ -k "apparatus or nfc or evoc or equipment_check or compartment"`                                        | ✅ 574 passed, 1 skipped (pre-existing optional-dependency skip)                        |
| `pytest tests/` (full backend suite)                                                                                   | ✅ 10066 passed, 21 skipped (pre-existing Docker/no-MySQL/optional-dep skips), 0 failed |
| `tsc --noEmit`                                                                                                         | ✅ 0 errors                                                                             |
| `eslint src/modules/inventory/pages/EquipmentCheckTemplateBuilder.tsx(.test.tsx) equipmentCheckHierarchy.ts(.test.ts)` | ✅ 0 errors                                                                             |
| `npm run lint` (full frontend, i.e. `eslint .`)                                                                        | ✅ 0 errors                                                                             |
| `vitest run EquipmentCheckTemplateBuilder.test.tsx equipmentCheckHierarchy.test.ts`                                    | ✅ 83 passed                                                                            |
| `vitest run src/modules/inventory` (full module)                                                                       | ✅ 682 passed (49 files)                                                                |

---

## Pass 4 (2026-09-03) — three findings surfaced by pass 3's own cascade fix (AP-8), all fixed

**Trigger.** Pass 3 fixed AP-8 — `CheckTemplateCompartment.children` had
the same inverted self-referential `remote_side` shape FAC-16 fixed on
`DocumentFolder.children` — which made the model's `cascade="all,
delete-orphan"` genuinely effective for the first time. Exactly as happened
across the Facilities pass this rotation is modeled on (FAC-16 through
FAC-45: making one cascade real exposed a chain of code that had only ever
run against the previous no-op behavior), a Codex review of the AP-8 fix
commit found three call sites written against the old (silently-inert)
cascade. All three were reproduced live against the current, fixed code
before being called findings — not inferred from reading the diff — and
each has a regression test confirmed failing pre-fix (`git stash` on just
the fix) and passing post-fix.

### AP-9 — P1 (functional regression) — `clone_template` walked a relationship `get_template` never eager-loads, 500ing on any nested template — ✅ FIXED

**What:** `EquipmentCheckService._clone_compartment` recursed into
`source.children` to clone each nested compartment. `get_template` (the only
place `clone_template` sources `source` from) eager-loads
(`selectinload`) each compartment's `.items` but never `.children`. Before
AP-8, `.children` was effectively dead code — the inverted `remote_side`
meant no delete ever cascaded through it, but nothing had ever forced a
_read_ through it either, so the missing eager-load was latent. The moment
AP-8 made `children` a real, correctly-wired one-to-many, touching it
outside `clone_template`'s own awaited `db.execute` calls became a genuine
lazy-load attempt, which `AsyncSession` cannot service inline —
`sqlalchemy.exc.MissingGreenlet`, even to establish that a leaf
compartment's `children` collection is empty.

**Where:** `backend/app/services/equipment_check_service.py`, `clone_template`
(pre-fix ~446–496) and `_clone_compartment` (pre-fix ~4308–4319, the
`for child in getattr(source, "children", []) or []` walk at the end).

**Failure scenario, reproduced live:** built a template with one root and
one nested compartment against a live test database, called
`EquipmentCheckService.clone_template` directly (the same call
`POST /templates/{id}/clone` makes) — pre-fix, this raised
`sqlalchemy.exc.MissingGreenlet` from inside the `SELECT ...
check_template_compartments ... WHERE %s = parent_compartment_id` query
SQLAlchemy issued to resolve `.children`. Any department cloning a template
that has so much as one nested compartment (the feature's own worked
example — pack inside bag inside compartment) gets a 500 instead of a
clone, with no partial data left behind (the failure happens before
`commit()`).

**A second, independent bug in the same code, found while fixing the
first:** `clone_template`'s outer loop was `for compartment in
source.compartments: await self._clone_compartment(new_template.id,
compartment, parent_id=None)` — `source.compartments` is the template's
_flat_ collection (every compartment, root or nested, `back_populates`
with no parent filter), so every nested compartment was cloned **twice**:
once wrongly promoted to a root by the outer loop, once correctly nested by
`_clone_compartment`'s own recursive `.children` walk. This predates AP-8
(the duplication happens on the clone side regardless of whether the
delete cascade works) and was masked only by the first bug crashing before
a caller could ever observe the duplicate rows. The regression test below
asserts the post-fix compartment count to catch a reintroduction of either
bug.

**Impact:** availability/correctness, not access control — the clone
endpoint is unusable for the templates it exists to help with (multi-rig
departments duplicating a checklist across a fleet), and the co-discovered
duplication bug would have produced a doubled compartment tree the moment
the crash was naively patched around (e.g. by simply eager-loading
`.children` without also fixing the outer loop).

**Fix:** `clone_template` now groups the already-loaded flat
`source.compartments` collection by `parent_compartment_id` into a
dict and walks it root-down itself (`_clone_subtree`), rather than
either re-querying with a deeper `selectinload` chain or touching
`.children` at all. `_clone_compartment` no longer recurses into
`.children` — cloning descendants is entirely the caller's
responsibility now, which is what closes both bugs in the same change:
each source compartment is visited exactly once, by parent-id, regardless
of what is or isn't eager-loaded on the ORM object.

### AP-10 — P1 (multi-tenant isolation, CLAUDE.md Pitfall #14c) — `create_template` forwarded a client-supplied `parent_compartment_id` with no in-template/in-org validation — ✅ FIXED

**What:** `create_template` → `_create_compartment` built each
`CheckTemplateCompartment` from the request body with `**data`, including
whatever `parent_compartment_id` the client sent, with no check that the
referenced compartment belongs to the template being created (or even the
caller's organization). `add_compartment` and `update_compartment` both
already validate this (`parent.template_id != template_id` /
`_validate_compartment_parent`, the latter also walking the chain for
cycles) — `_create_compartment` was the one write path that didn't.
Before AP-8 this was a dangling-FK nuisance at worst, since a no-op cascade
can't destroy anything by following it. AP-8 made the cascade real, which
turns an unvalidated parent link into a cross-tenant destructive
capability: deleting a compartment in template A now genuinely
cascade-deletes whatever got linked underneath it as a "child," including
every item on that row, regardless of which template or organization it
actually belongs to.

**Where:** `backend/app/services/equipment_check_service.py`,
`create_template` (~117–131 pre-fix) and `_create_compartment` (~4303–4319
pre-fix, no `organization_id` parameter, no validation before the
`CheckTemplateCompartment(**data)` construction).

**Failure scenario, reproduced live:** created a compartment in Org B's
template, then called `EquipmentCheckService.create_template` for Org A
with a `compartments` payload naming that Org B compartment's id as
`parent_compartment_id` — pre-fix, the row persisted with the cross-org
link intact and no error. A department's admin — or anyone who can reach
this endpoint, since it needs no special privilege beyond
`inventory.check_manage` in their _own_ org — could plant a foreign
compartment as a "child" of one of their own, then delete their own parent
to cascade-delete another organization's compartment and every item on it,
entirely within their own org's permissions.

**Note on the frontend:** the builder UI never actually exercises this
path today — a template's `compartments` array is only populated with a
real `parent_compartment_id` once compartments are persisted and nested via
`addCompartment`/the indent control (both of which call the already-validated
`add_compartment` endpoint); the initial `POST /templates` payload's
compartments are always freshly-generated with no id to reference yet, so
`parentCompartmentId` is always empty at that point. This closes a request-body
level vulnerability reachable by any client that talks to the API directly
(a crafted request, a future UI change, or an already-malformed stored
payload), not a bug a normal user could trigger by clicking around — see
CLAUDE.md Pitfall #14c: an FK is validated in-org at the write regardless of
whether today's UI happens to always send a safe value.

**Existing-data check:** ran the equivalent of
`SELECT c.id FROM check_template_compartments c JOIN check_template_compartments p
ON c.parent_compartment_id = p.id JOIN equipment_check_templates t1 ON c.template_id = t1.id
JOIN equipment_check_templates t2 ON p.template_id = t2.id WHERE c.template_id <> p.template_id
OR t1.organization_id <> t2.organization_id` against the only database this
review environment has access to (a fresh/empty dev database — 0 rows in
`check_template_compartments`), so no malformed rows were found or could
have been found here. Given `_create_compartment` was the only unvalidated
write path and has existed since the feature shipped, a production
database that has ever accepted a crafted or buggy client request through
`POST /templates` could hold such rows; this query is the way to check.
Repairing any found would need either nulling the cross-boundary
`parent_compartment_id` or deleting the misattached compartment, decided
per row — which template and organization the orphaned compartment's item
history actually belongs to merits a human decision, not a blind
migration, and this review has no production data access to make that call
regardless.

**Fix:** `_create_compartment` now takes `organization_id` and, when
`parent_compartment_id` is supplied, resolves it via the same org-scoped
`_get_compartment` helper `add_compartment`/`update_compartment` already
use and rejects (`ValueError`, surfaced as an existing 400 by the
endpoint's existing `except ValueError` handler) unless
`parent.template_id == template_id`. Since a template being created has no
compartments of its own yet, this means a create-time `parent_compartment_id`
is always rejected today — matching the frontend's own behavior of only
ever nesting via `add_compartment` after the template exists — while still
being available to relax later if a legitimate same-request nested-create
payload shape is ever introduced (it would need real, resolvable parent
ids to validate against, which the current flat client-generates-nothing
shape doesn't have).

### AP-11 — P2 (frontend/backend state mismatch) — the compartment delete confirmation and local-state removal only accounted for the one selected row, not its cascade-deleted descendants — ✅ FIXED

**What:** `EquipmentCheckTemplateBuilder.deleteCompartment` built its
confirmation message from `comp.items.length` (this compartment's own
items only) and, after a successful delete, removed only the one array
index (`prev.filter((_, i) => i !== idx)`). Before AP-8, this matched
reality — the backend cascade was a no-op, so a parent delete only ever
removed the parent. AP-8 made the backend cascade delete the whole
subtree, so for a nested template the frontend now: undercounts what the
confirmation dialog says will be destroyed (missing every descendant
compartment and its items), leaves the now-deleted descendant compartments
displayed as orphaned rows in the local list (their
`parentCompartmentId` still points at an id that no longer exists), and
sends the next Save with update requests for those deleted descendant
ids, which 404.

**Where:**
`frontend/src/modules/inventory/pages/EquipmentCheckTemplateBuilder.tsx`,
`deleteCompartment` (~pre-fix line 804–826).

**Failure scenario, reproduced live (component test, `git stash` on just
the fix):** rendered the builder against the fixture template (`Cab`, 2
items, with `Medical bag` nested underneath it), clicked delete on `Cab`.
Pre-fix, the confirmation read `Delete "Cab" and its 2 items? This cannot
be undone.` — no mention of `Medical bag` or its items at all. Confirming
would call `deleteCompartment('cab')` (which the backend now cascades
correctly, per AP-8/AP-9), but the frontend would still show `Medical bag`
as a surviving top-level row until the next full reload, and the next Save
would `updateCompartment('bag', ...)` against an id the backend has
already deleted, 404ing.

**Precedent used:** the Facilities module already solved this exact shape
for room hierarchies — `frontend/src/modules/facilities/roomTree.ts`
exports `collectSubtreeIds`. This feature has its own existing hierarchy
helper module (`equipmentCheckHierarchy.ts`, already used by the indent/
outdent and "stored inside" picker code) with an equivalent function,
`descendantCompartmentIds`, that was not yet being used by delete — reused
it here rather than writing a third implementation of the same walk.

**Impact:** no data-integrity risk (the backend cascade this depends on is
correct, per AP-8/AP-9) — this is a UI-honesty and stale-state defect: an
undercounted confirmation, a UI that shows deleted rows as if they
survived, and a guaranteed 404 on the very next save for any template with
nested compartments.

**Fix:** `deleteCompartment` now calls
`descendantCompartmentIds(compartments, comp.id)` to compute the full
descendant set before showing the confirmation, folds every descendant
compartment's item count into the total the dialog states (and names the
nested-compartment count when there is one), and — after the delete API
call succeeds — filters both the selected index and every descendant id out
of local state in the same `setCompartments` call, so a deleted subtree
never lingers as orphaned top-level rows.

## Existing-data note

The maintenance query in AP-10 above is the reusable check for any
already-persisted cross-template/cross-org `parent_compartment_id` link.
No repair was attempted against production data — this review environment
only has access to an empty dev/test database, and per CLAUDE.md's
guidance on this class of finding, a live data repair needs a human
decision on affected rows, not a blind migration run without seeing what
it would touch.

## Guard tests added (pass 4)

- `backend/tests/test_apparatus_check_template_compartment_cascade_followups.py`
  — `TestCloneTemplatePreservesNestedCompartments` (AP-9: clone succeeds,
  exactly one root + one child, ids are new rows not the source re-parented)
  and `TestCreateTemplateRejectsCrossTemplateParent` (AP-10: cross-org
  parent rejected, cross-template-same-org parent rejected, a normal
  null-parent create still succeeds). All confirmed failing against the
  pre-fix `equipment_check_service.py` via `git stash` (the two AP-10 tests
  fail with the same `MissingGreenlet` as AP-9's, one level removed — the
  malformed row's parent write succeeds pre-fix, and the subsequent
  `get_template` refetch is what then trips over the same unloaded
  `.children` touch) and passing against the fix.
- `frontend/src/modules/inventory/pages/EquipmentCheckTemplateBuilder.test.tsx`
  — `'deletes the whole nested subtree, in the confirmation and in local
state, when a parent compartment is removed'` (AP-11). Confirmed failing
  pre-fix (`git stash` on just the component file) with the actual pre-fix
  dialog text `Delete "Cab" and its 2 items? This cannot be undone.` printed
  in the failure output — no mention of the nested compartment — and
  passing against the fix.

## Completion gate (pass 4)

| Check                                                                             | Result                                                                                                                                                                                  |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                     | ✅ 0 violations                                                                                                                                                                         |
| `black --check app/ tests/ alembic/`                                              | ✅ clean                                                                                                                                                                                |
| `isort --check-only app/ tests/ alembic/`                                         | ✅ clean                                                                                                                                                                                |
| `python3 scripts/validate_migrations.py --strict`                                 | ✅ single head, no schema change                                                                                                                                                        |
| `pytest tests/ -k "apparatus or nfc or evoc or equipment_check or compartment"`   | ✅ 572 passed, 1 skipped (pre-existing optional-dependency skip)                                                                                                                        |
| `pytest tests/` (full backend suite)                                              | ✅ 10064 passed, 21 skipped (pre-existing Docker/no-MySQL/optional-dep skips), 0 failed                                                                                                 |
| `mypy app/services/equipment_check_service.py`                                    | pre-existing repo-wide debt (1225 errors before this pass's changes, 1224 after — net −1, no error newly introduced by this diff; not part of this repo's enforced gate, see CLAUDE.md) |
| `pylint app/services/equipment_check_service.py --enable=E`                       | ✅ 2 pre-existing false positives (`func.count` not-callable), none on changed lines                                                                                                    |
| `tsc --noEmit`                                                                    | ✅ 0 errors                                                                                                                                                                             |
| `eslint src/modules/inventory/pages/EquipmentCheckTemplateBuilder.tsx(.test.tsx)` | ✅ 0 errors                                                                                                                                                                             |
| `npm run lint` (full frontend)                                                    | ✅ 0 errors                                                                                                                                                                             |
| `vitest run src/modules/inventory/pages/EquipmentCheckTemplateBuilder.test.tsx`   | ✅ 80 passed                                                                                                                                                                            |
| `vitest run src/modules/inventory` (full module)                                  | ✅ 915 passed (69 files)                                                                                                                                                                |

---

## Pass 3 (2026-09-03) — one fixed (a live-reproduced cascade bug flagged by the Facilities pass), one stale-doc correction, rest re-verified unchanged

**Trigger.** The rotation's Facilities pass (feature 12, FAC-16,
`docs/security-review/FAC-12-facilities.md`) found and fixed
`DocumentFolder.children` declaring `remote_side` on the plural collection
instead of on its singular `parent` backref — an inversion that made
SQLAlchemy null out every descendant's foreign key before a parent delete
instead of cascading to it. That pass flagged two sibling relationships with
the identical shape as out of scope for Facilities:
`CheckTemplateCompartment.children` (this feature, model file
`app/models/apparatus.py`) and `TrainingCategory.subcategories` (Training,
rotation features 17/18). This pass picked up the first.

**Diff scope.** `git diff` from pass 2's merge (`1c71d8e1`) to this pass's
start (`bcbffabc`) touches only two files in this feature's declared domain:
`api/v1/endpoints/apparatus.py` (+1 line — `get_apparatus_folders` now passes
`current_user` through to `get_apparatus_sub_folders`, landed as part of the
Facilities pass's `documents.py` folder-ACL sweep, already correctly
`can_access_folder`-gated — verified below, not a finding) and
`models/apparatus.py` (+35/-2, entirely `EquipmentCheckTemplate`/
`EquipmentCheckBulkDeleteRequest` additions belonging to feature 14's own
rotation slot, not touched here). `nfc_tags.py`, `nfc_tag_service.py`,
`apparatus_service.py`, `evoc_level_service.py`, and
`driver_exception_service.py` are byte-identical to pass 2. Given that, this
pass did not re-read all ~8,000 lines cover to cover — three prior passes
(module audit, 4 app-review Tier B rounds, and AP-13 passes 1–2) already
did — but re-ran the checklist's mechanical checks fresh rather than citing
them: an AST walk confirming 88/5 routes still carry a `Depends` clause
each, a grep confirming all 4 `.ilike()` call sites in `apparatus_service.py`
still pass `escape=LIKE_ESCAPE_CHAR`, a grep confirming every `ondelete="SET
NULL"` FK in `models/apparatus.py`/`models/nfc_tag.py` (36 sites) still pairs
with `nullable=True`, and spot-reads of `get_apparatus`, `NfcTagService.get_tag`/
`resolve_tag`/`check_in` re-confirming org-scoping by reading the current
code, not by re-citing the pass-2 table.

### AP-8 — MED (data integrity) — `CheckTemplateCompartment.children` had FAC-16's exact inverted self-referential shape — ✅ FIXED

**What:** `children = relationship("CheckTemplateCompartment", backref="parent",
remote_side="CheckTemplateCompartment.id", cascade="all, delete-orphan",
single_parent=True)` declared `remote_side` on the plural `children`
collection instead of on the singular `parent` backref — the standard
SQLAlchemy adjacency-list pattern puts it on the many-to-one side
(`backref=backref("parent", remote_side=[id])`), and every other
self-referential relationship in this codebase (`FacilityRoom.parent_room`,
`BudgetCategory.parent`, `StorageArea.parent`, `Event.recurrence_parent`,
and `DocumentFolder.children` after FAC-16) follows it. Inverted, SQLAlchemy
proactively sets each descendant's FK to `NULL` before a parent delete is
issued, so the database's own cascade never fires.

**Where:** `backend/app/models/apparatus.py:2249` (pre-fix).

**Failure scenario, reproduced live before being called a finding (not
inferred from reading the model — the same discipline the FAC-16 writeup
demanded of itself):** built a real three-level compartment hierarchy
(root → child → grandchild) against a live test database, then deleted the
root exactly the way `EquipmentCheckService.delete_compartment` does —
`await self.db.delete(compartment)`, a pure ORM cascade delete with no
database-level fallback (`parent_compartment_id` is `ondelete="SET NULL"`,
not `CASCADE`). Pre-fix, the child compartment survived the delete,
orphaned with `parent_compartment_id` set to `NULL` instead of removed —
confirmed with an assertion failure, not a code read. A department that
nests equipment inside a container inside a compartment (the feature's own
docstring example: "a pack inside a bag inside a compartment") and later
deletes the outer compartment is left with orphaned inner containers/items
still counted in template content and still reachable by id, instead of the
delete they asked for.

**Impact:** data integrity, not access control — an authorized user
performing an authorized delete gets silent data corruption rather than the
result they asked for. Scoped to nested compartments specifically; a
flat (non-nested) compartment tree, the overwhelmingly common case, deletes
correctly either way since there is no child to orphan.

**Fix:** moved `remote_side` onto the `parent` backref
(`backref=backref("parent", remote_side=[id])`), the identical correction
FAC-16 applied to `DocumentFolder.children`. Behavior-neutral for every
existing single-level compartment (no `parent`/`children` traversal changes
for a tree with no grandchildren); the only path that read data differently
is the newly-correct cascade-delete of a nested compartment.

**Related, correctly left open:** `TrainingCategory.subcategories`
(`app/models/training.py`) has the same inverted-`remote_side` shape but no
`cascade` configured on it at all, so its likely failure mode is a silently
nulled `parent_category_id` rather than a failed delete — a different
mechanism that has not been empirically confirmed the way this finding and
FAC-16 both were. It belongs to the Training rotation features (17/18), not
Apparatus & NFC; fixing it here would be exactly the kind of "convenient to
fix while I'm here" scope creep this rotation's discipline exists to avoid,
and a plain code read is not sufficient evidence to call it a confirmed
finding — that is precisely what let both now-fixed instances of this bug
stand for as long as they did. `docs/KNOWN_LIMITATIONS.md` updated to reflect
this fix and narrow the remaining flag to `TrainingCategory` alone.

### Doc correction — AP2-2 (`docs/app-review/apparatus.md`) claimed 🚩 OPEN; the code has validated all four FKs since before pass 1

`app-review/apparatus.md`'s AP2-2 entry (dated 2026-08-06, pass 1 of that
earlier review track) still read 🚩 OPEN, while `AP-13-apparatus-nfc.md`'s
own pass-2 "Scope" section already claimed the fix landed ("AP2-1/AP2-2 (XC-1
FK classes) still closed"). Read the current code directly rather than
trusting either doc: `apparatus_service.py` validates all four —
`required_evoc_level_id` (`create_apparatus`/`update_apparatus`),
`component_id`/`service_provider_id` on maintenance records
(`create_maintenance_record`/`update_maintenance_record`), and
`service_provider_id` on component notes (`add_component_note`/
`update_component_note`) — each via `assert_in_org`, each marked with an
`# AP2-2` comment at the call site. Corrected the stale doc rather than
re-reporting a fixed finding as new.

### Verified good ✅ (re-confirmed this pass, mechanism named)

- **Route auth coverage 88/88 (`apparatus.py`) + 5/5 (`nfc_tags.py`)** — fresh
  AST walk this pass (not a re-citation), same result as pass 2.
- **`get_apparatus_folders` → `get_apparatus_sub_folders`** now threads
  `current_user` through to `can_access_folder` (the same predicate FAC-14
  through FAC-26 hardened) — read `can_access_folder`/`_folder_admits_user`
  directly: apparatus's own folders set no `required_permissions` (unlike
  Facilities' sensitive folders), so access is governed by the folder's
  `visibility`/`allowed_roles` plus the route's own
  `apparatus.view`/`.manage` gate — nothing for `required_permissions` to
  bypass, so this is the intended shared-model behavior, not a gap FAC-14's
  class would apply to.
- **LIKE escaping** — all 4 `.ilike()` sites in `apparatus_service.py` pass
  `escape=LIKE_ESCAPE_CHAR` via `like_pattern()`, confirmed by direct read.
- **`SET NULL` nullability** — all 36 `ondelete="SET NULL"` FKs across
  `models/apparatus.py`/`models/nfc_tag.py` pair with `nullable=True`,
  confirmed by grep + read of every multi-line declaration.
- **NFC card UIDs remain hash-only** — `NfcTagResponse` exposes only
  `uid_preview`, never a hash or raw UID; unchanged since pass 2.
- **List endpoints are either bounded (`page_size` capped at 100 on
  `list_apparatus`/`list_maintenance_records`) or naturally bounded by
  org headcount** (`list_nfc_tags`, driver-exception lists, approver list —
  one row per member/exception, not attacker-growable) — considered and not
  a finding, not merely unexamined.
- **No `SafeCsvWriter`-bypass risk** — no CSV export exists in this feature's
  backend files.
- **Driver-exception separation of duties, EVOC eligibility, NFC hashing** —
  unchanged files, re-confirmed by spot-read against this pass's specific
  claims rather than re-cited wholesale.

## Completion gate (pass 3)

| Check                                                                           | Result                                                                                  |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                   | ✅ 0 violations                                                                         |
| `black --check app/ tests/ alembic/`                                            | ✅ clean                                                                                |
| `isort --check-only app/ tests/ alembic/`                                       | ✅ clean                                                                                |
| `python3 scripts/validate_migrations.py --strict`                               | ✅ single head, no schema change                                                        |
| `pytest tests/ -k "apparatus or nfc or evoc or equipment_check or compartment"` | ✅ 568 passed, 1 skipped (pre-existing optional-dependency skip)                        |
| `pytest tests/` (full backend suite)                                            | ✅ 10060 passed, 21 skipped (pre-existing Docker/no-MySQL/optional-dep skips), 0 failed |
| `tsc --noEmit` / `eslint .`                                                     | n/a this pass — no frontend change                                                      |

---

## Pass 2 (2026-08-28) — re-swept the full domain since pass 1's merge; 1 fixed, 2 doc corrections

**Scope.** Diffed everything under this feature's domain against pass 1's merge
commit (`37936879`): all 10 declared/adjacent backend files
(`apparatus.py`, `apparatus_service.py`, `evoc_level_service.py`,
`driver_exception_service.py`, `nfc_tags.py`, `nfc_tag_service.py`,
`models/apparatus.py`, `models/nfc_tag.py`, `schemas/apparatus.py`,
`schemas/nfc_tag.py`) came back **byte-identical** — confirmed with
`git diff --stat`, not assumed from the file list. No apparatus/NFC/EVOC
migration landed since pass 1 either (`git log` on
`backend/alembic/versions` in the range touches unrelated tables only —
recipient/messaging and a folder/testing-runs merge). The only change inside
`modules/apparatus/` is `routes.tsx` gaining `requiredModule="apparatus"` on
its four `ProtectedRoute`s — client-side parity for a **new server-side**
change: `api.py` now mounts the `apparatus` router behind
`module_gate("apparatus", "Apparatus")` (landed in `70449d96`, "Make module
enablement an API boundary, not just a UI one" — a whole-app change, not
specific to this feature, already covered by its own `test_module_api_gating.py`
parity test). Traced rather than trusted: `require_module`'s "no session
passes through" clause exists for routers with token-authorized public
routes; `apparatus.py` has none (all 88 routes require an authenticated
user), so the clause is inert here and the new gate is a pure AND on top of
every route's existing permission check. `nfc_tags.py` remains deliberately
**un**gated at the module level — `api.py`'s own docstring names it as
cross-module infrastructure (tag scanning shared across apparatus,
facilities, prospects and members) — and instead each of its 5 routes
independently calls `require_nfc_id_cards(db, org_id)`, which pass 1 already
verified and this pass re-confirmed by reading the file (below).

Given zero backend diff, this pass did not re-read all ~8,000 lines cover to
cover — that would re-derive what pass 1, the module audit, and four
app-review passes already settled. Instead: (1) a fresh AST-based enumeration
of every route decorator in `apparatus.py`/`nfc_tags.py` against its auth
dependency (not a re-read of pass 1's table by eye), (2) a direct read of
`nfc_tag_service.py` in full against the tenant-isolation and data-exposure
dimensions specifically, since it is the one file in this feature that has
never had more than one pass, (3) targeted re-verification of the specific
mechanisms pass 1's "Verified good" section named (assert_in_org call count,
the driver-exception conditional-UPDATE race guard, the EVOC eligibility
query, the `list_driver_exception_approvers` response shape) by reading the
actual code, not by re-citing the claim.

### Route inventory — re-enumerated

AST walk of every `@router.<verb>` decorator: **88/88** `apparatus.py` routes
carry an auth dependency (87 `require_permission`, 1 `get_current_user`
— `list_driver_exception_approvers`, unchanged from pass 1) and **5/5**
`nfc_tags.py` routes carry `require_permission` plus a
`require_nfc_id_cards` call in the body. Two routes' `Depends(...)` were
initially missed by the walk's regex header capture
(`list_apparatus`/`list_maintenance_records` have long multi-field query-param
signatures that pushed `Depends(require_permission(...))` past the capture
window) — followed up by reading both functions directly: both correctly
gated on `require_permission("apparatus.view", "apparatus.manage")`. Not a
finding; recorded so a future pass doesn't trust the raw tool output over the
source.

**Correction: `nfc_tags.py` has 5 routes, not 6.** Pass 1's header and body
both said 6; `grep -c "@router\."` and a full read of the file both show 5
(`list`, `register`, `update`, `delete`, `check-in`) and the file is
byte-identical to pass 1's merge, so this was a miscount from the start, not
a regression. Corrected in this doc's header above. **Correction:
`apparatus_service.py` has 16 `assert_in_org` call sites, not 17** — the "17"
figure traces back to app-review pass 4 (2026-08-09) and was repeated in AP-13
pass 1; `grep -c "assert_in_org("` on the unchanged file returns 16. Neither
miscount changes any conclusion — both undercounted claims ("6/6 gated",
"17 sites") remain true at the corrected number, and no site is missing
`assert_in_org` or a permission check. Recorded because a wrong count in a
security doc is exactly the kind of thing a later pass would otherwise
propagate rather than notice.

### AP-7 — LOW (defense-in-depth, not currently exploitable) — `NfcTagService._name_map` looked up display names with no org filter on the query itself — ✅ FIXED

**What:** `list_tags`, `register_tag`, and `update_tag` all resolve
`member_name`/`issued_by_name` for the response by calling a private helper,
`_name_map(user_ids)`, which ran `select(User.id, User.first_name,
User.last_name).where(User.id.in_(ids))` — no `organization_id` anywhere in
the query. The letter of CLAUDE.md Pitfall #14a ("every by-id/client-supplied-
id query must filter organization_id, or resolve through an already-org-scoped
parent") regardless of whether a caller currently exploits it — the same
class AP-6 (pass 1) fixed one file over, in `admin_hours_service.py`.

**Where:** `backend/app/services/nfc_tag_service.py:692` (`_name_map`,
pre-fix signature `_name_map(self, user_ids: set)`), called from `list_tags`
(:131), `register_tag` (:199), `update_tag` (:241).

**Why not currently exploitable:** every id ever passed to `_name_map` is
drawn from an `NfcTag` row's `user_id` / `issued_by` column, and every such
row is itself always org-consistent: `list_tags`'s own query already filters
`NfcTag.organization_id == organization_id` before the ids are collected;
`register_tag` builds the `tag` object in-line moments earlier with
`organization_id=str(organization_id)` (and its `user_id` is independently
`assert_in_org`-checked); `update_tag` fetches the row through `get_tag`,
which is itself org-scoped. `issued_by` is always `str(current_user.id)` —
the authenticated caller, who belongs to this org by construction of
`require_permission`. So no caller today can hand `_name_map` a foreign id.
That invariant lives in three different call sites rather than in the query
itself, which is exactly the kind of implicit cross-method dependency
Pitfall #14 exists to not rely on — the same reasoning AP-6 gave for the
identical shape in a sibling service.

**Impact:** latent, not live. The exposed fields are limited to
first/last name (`_to_dict` never surfaces anything else from this lookup),
so even a hypothetical future caller passing an unvalidated id would leak a
name, not a credential or contact detail — still a real cross-tenant PII
leak class to close on the query rather than continue to rely on three
call sites all staying disciplined forever.

**Fix:** `_name_map` now takes `organization_id` as a required first
parameter and filters `User.organization_id == str(organization_id)`
directly in the query, alongside the existing `User.id.in_(ids)`. All three
call sites updated to pass it. Behavior-neutral for every valid call (every
id passed in already belongs to the org, by the invariant above) — this
closes the gap on the query itself rather than continuing to depend on that
invariant holding across three unrelated call sites forever.

## Schema & migration notes

No schema changes this pass. No apparatus/NFC/EVOC migration landed since
pass 1.

## Guard tests added (pass 2)

- `test_nfc_tag_service.py::TestNameMapOrgScoping` (3 tests) —
  `test_name_map_query_is_org_scoped` asserts `"organization_id"` appears in
  the compiled statement's **`.whereclause`** specifically (matching the
  hollow-assertion lesson AP-6's own guard test learned on PR #1838 — a
  substring check against the whole statement would still pass here even
  with the filter removed, since `organization_id` isn't one of the selected
  columns, but matching the established pattern keeps the assertion
  meaningful if the selected columns ever change); the other two
  (`test_name_map_returns_names_for_in_org_ids`,
  `test_name_map_short_circuits_on_no_ids`) lock in behavior for the normal
  and empty-input paths. All three confirmed to fail against the pre-fix
  code via `git stash` (two with a `TypeError` on the changed signature, one
  on the missing `organization_id` in the `WHERE` clause) and pass against
  the fix.

## Completion gate (pass 2)

| Check                                                         | Result                                                                        |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                 | ✅ 0 violations                                                               |
| `black --check app/ tests/ alembic/`                          | ✅ 1323 files unchanged (1 reformatted during the fix, then verified)         |
| `isort --check-only app/ tests/ alembic/`                     | ✅ clean (isort 8.0.1, matches CI's pin, already installed)                   |
| `python3 scripts/validate_migrations.py --strict`             | ✅ 389 revisions, single head, no schema change                               |
| `pytest tests/ -k "apparatus or nfc or evoc"`                 | ✅ 239 passed, 1 skipped (pre-existing optional-dependency skip)              |
| `pytest tests/` (full backend suite)                          | ✅ 9179 passed, 22 skipped (pre-existing Docker/no-MySQL/optional-dep skips)  |
| `tsc --noEmit`                                                | ✅ 0 errors                                                                   |
| `eslint .`                                                    | ✅ 0 errors, 10 pre-existing warnings (same set as SEC-00/feature 34's gates) |
| `vitest run src/routeIntegrity.test.ts src/modules/apparatus` | ✅ 40 passed (6 files)                                                        |

---

## Scope

Apparatus itself is well-audited: module-audit iteration 2 plus four
app-review Tier B passes (2026-08-06 through 2026-08-09) closed every FK
class this module had (AP-1 create-path, AP2-1 update-path read-leaks,
AP2-2 dangling-only FKs — all fixed, `assert_in_org` wired at 16 sites in
`apparatus_service.py`, corrected from "17" by pass 2's recount —
see the Pass 2 section above; the site count was wrong, not the coverage).
Re-verified rather than re-derived: FK validation still present at all 16
sites, 0 `# noqa: E712`, no free-`str`-to-enum write path.

`nfc_tags.py`/`nfc_tag_service.py` (member ID cards + check-in stations) is
genuinely new since any prior pass — added in three commits
(`63f4cc49` "Add NFC ID cards", then two of the feature's own review-fix
rounds, `e7d17770`/`9973c2ab`) with no rotation coverage until now. Read in
full. `driver_exception_service.py` (EVOC driving-requirement exceptions,
tied into scheduling eligibility) is likewise new and unaudited — read in
full given it's a sanctioned bypass of a safety control, the kind of
mechanism that warrants the most scrutiny in this module.

**Growth:** `apparatus.py` grew from 83 to 88 routes (all 5 new ones are the
driver-exception feature — list/list-approvers/request/review/revoke).

## Route inventory

88/88 `apparatus.py` routes carry auth. 87 via `require_permission`/
`require_all_permissions`; 1 bare `get_current_user`
(`list_driver_exception_approvers` — self-documented: any authenticated
member, returns only names/ranks, no contact details, scoped to the caller's
org). `nfc_tags.py`'s 5 routes (corrected from "6" by pass 2's recount — the
file has always had 5) are all `require_permission`-gated
(`members.manage_id_cards` for issue/list/update/delete, `members.check_in`
for the station endpoint) plus a server-side `require_nfc_id_cards` gate on
every route — the integration must be turned on for the org, checked on the
server rather than trusted from the frontend nav.

### Driver exceptions (new)

`request_driver_exception` requires `scheduling.assign`/`.manage`/
`apparatus.manage` (not a baseline grant — a member cannot request their own
exception). `review_driver_exception`/`revoke_driver_exception` require
`apparatus.approve_driver_exception` (chief-level by default). The service
layer (`driver_exception_service.py`) independently enforces separation of
duties via `assert_different_person` on **both** the requester and the
beneficiary — a chief cannot approve their own exception, and cannot approve
one requested by someone else _for_ the chief either. `review_exception`
settles a concurrent-approval race with a conditional `UPDATE ... WHERE
status = PENDING` (the same locking-decision shape as Pitfall #27, applied
to a status transition rather than a capacity count) rather than a
read-then-write. Validity window is mandatory and capped at 366 days from
both ends (start and span). All FK ids (`user_id`, `apparatus_id`)
org-validated via `assert_in_org`. No defect found — this is the
best-defended new feature reviewed in this rotation to date.

### NFC ID cards (new)

Card UIDs are never stored raw: `hash_tag_uid` SHA-256s the normalized UID
peppered with the installation's encryption salt; only a 4-character
`uid_preview` (for a human to eyeball "is this the right card") and the
hash are persisted. Every lookup (`resolve_tag`, `list_tags`, `get_tag`) is
`organization_id`-scoped. `check_in` never raises for a domain outcome
(unknown card, inactive card, inactive member) — it returns a typed status
the station renders, so a malformed tap can't take a kiosk down; a
non-existent target (shift/event/category id not found) still raises, since
that's a caller error, not a domain state. The three check-in targets
(shift, event, admin-hours) all resolve through org-scoped getters before
touching any record, and delegate the actual attendance mutation to each
target module's own existing service method (`SchedulingService.member_check_in`,
`EventService.self_check_in`, `AdminHoursService.clock_in`) rather than
reimplementing it. No defect found in the NFC-specific code.

## Verified good ✅

- **Auth coverage 88/88 (`apparatus.py`) + 6/6 (`nfc_tags.py`)**, enumerated
  above; the one bare-`get_current_user` route is self-scoped and
  low-sensitivity by design.
- **AP-1/AP2-1/AP2-2 (XC-1 FK classes) still closed** — `assert_in_org`
  present at all 17 previously-documented call sites.
- **No SQL injection, no PK-bypass** patterns anywhere in the three files.
- **NFC card UIDs are hashed, never stored raw** — verified the model has no
  plaintext UID column and every write path goes through `hash_tag_uid`.
- **Driver-exception separation of duties is real** — traced
  `assert_different_person` to `separation_of_duties.py`, the same shared
  helper finance/skills-testing/admin-hours approval paths use; not a
  reimplementation that could drift.
- **Lint:** flake8 clean.

## Findings

### AP-6 — LOW (defense-in-depth, not currently exploitable) — `clock_out_by_category` had no org filter on its own query — ✅ FIXED

**What:** `AdminHoursService.clock_out_by_category` selected the active
`AdminHoursEntry` by `category_id` + `user_id` + `status == ACTIVE` with no
`organization_id` filter on the query itself — the letter of CLAUDE.md
Pitfall #14a ("every by-id/client-supplied-id query must filter
organization_id, or resolve through an already-org-scoped parent") regardless
of whether either caller currently exploits it.
**Where:** `app/services/admin_hours_service.py:274` (reached via
`NfcTagService._check_in_admin_hours`, the code path this iteration is
reviewing, and directly by `admin_hours.py`'s own
`POST /clock-out-by-category/{category_id}` endpoint).
**Why not currently exploitable:** both callers pass `user_id=current_user.id`
(or the NFC-resolved card owner, itself org-validated) — never an
arbitrary member. An `AdminHoursEntry`'s `category_id` is always
org-consistent with the entry's own org, because `clock_in` validates the
category is in-org before creating the entry in the first place. So the
`user_id` scoping alone happens to make cross-org access unreachable today —
but that invariant lives in a different method (`clock_in`) than the one
being called, which is exactly the kind of implicit cross-method
dependency Pitfall #14 exists to not rely on.
**Fix:** added a required `organization_id` parameter, filtered directly on
`AdminHoursEntry.organization_id`, and updated both call sites
(`nfc_tag_service.py`, `admin_hours.py`) to pass it. Behavior-neutral for
every valid call (an entry that matches on category+user+status already
matches on org, by the invariant above) — this closes the gap on the query
itself rather than continuing to rely on `clock_in`'s enforcement holding
forever. `AdminHoursService.clock_out` (a sibling method with the same
shape, reached from `admin_hours.py`'s `/clock-out/{entry_id}`) has the
identical pattern and is equally non-exploitable today for the same
reason, but is out of scope for this iteration — it belongs to the Admin
Hours module (rotation feature 21), not Apparatus & NFC, and touching it
here would spread this PR into a module this rotation hasn't reached yet.
Noted for that iteration to pick up. Guard test:
`test_admin_hours_service.py::TestOrgScopedQueries::test_clock_out_by_category_query_is_org_scoped`.

## Schema & migration notes

No schema changes. `AdminHoursEntry.organization_id` is `nullable=False`
(pre-existing, unaffected by this fix — the fix only added a filter clause,
not a column).

## Guard tests added

- `test_admin_hours_service.py::TestOrgScopedQueries::test_clock_out_by_category_query_is_org_scoped`
  — asserts `organization_id` appears in the compiled **WHERE clause**
  specifically (`stmt.whereclause`), not the whole statement. **A Codex
  review caught that the first version of this test was hollow**: a
  substring check against `str(stmt)` passes regardless of the WHERE clause,
  because `select(AdminHoursEntry)` always lists `organization_id` in its
  SELECT columns as a plain model field — the test would have kept passing
  even with the fix fully reverted. Fixed to inspect `.whereclause`; verified
  by hand that it now fails against a reconstructed pre-fix query and passes
  against the actual fixed one. While fixing it, found and fixed the
  **identical hollow-assertion flaw already present** in this same test
  class's `test_get_active_session_query_is_org_scoped` (pre-dating this
  PR, not something Codex flagged directly — the same mechanism, same file,
  caught by inspection once the pattern was known). `_get_active_session`
  also does `select(AdminHoursEntry)`, so that test was equally hollow.
  `test_check_overlap_query_is_org_scoped` is unaffected — `_check_overlap`
  selects `func.count(AdminHoursEntry.id)`, not the whole model, so
  `organization_id` only appears there via the WHERE clause. Both fixed
  tests fail on AP-6 reintroduction, for real this time.

## Completion gate

| Check                                             | Result                                                           |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                     | ✅ 0 violations                                                  |
| `black --check app/ tests/ alembic/`              | ✅ 1251 files unchanged                                          |
| `isort --check-only app/ tests/ alembic/`         | ✅ clean                                                         |
| `python3 scripts/validate_migrations.py --strict` | ✅ single head, no schema change                                 |
| `pytest tests/ -k "admin_hours or nfc"`           | ✅ 118 passed, 1 skipped (pre-existing optional-dependency skip) |
| `pytest tests/` (full backend suite)              | ✅ 8388 passed, 22 skipped (pre-existing Docker/no-MySQL skips)  |
| `tsc --noEmit` / `eslint .`                       | n/a — no frontend change                                         |
