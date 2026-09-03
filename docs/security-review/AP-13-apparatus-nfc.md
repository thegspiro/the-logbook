# Security Review 13 — Apparatus & NFC

**Prefix:** `AP` · **Iteration:** 13 · **Reviewed:** 2026-08-26 (pass 1), 2026-08-28 (pass 2), 2026-09-03 (pass 3) · **PR:** [#1838](https://github.com/thegspiro/the-logbook/pull/1838) (pass 1)

**Backend:** `api/v1/endpoints/apparatus.py` (88 routes), `services/apparatus_service.py`,
`evoc_level_service.py`, `services/driver_exception_service.py` (new),
`api/v1/endpoints/nfc_tags.py` (5 routes — corrected in pass 2, see below), `services/nfc_tag_service.py` (new)
**Frontend:** `modules/apparatus`
**Migrations:** none this iteration (no schema change)

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

| Check                                                                           | Result                                                           |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                   | ✅ 0 violations                                                  |
| `black --check app/ tests/ alembic/`                                            | ✅ clean                                                         |
| `isort --check-only app/ tests/ alembic/`                                       | ✅ clean                                                         |
| `python3 scripts/validate_migrations.py --strict`                               | ✅ single head, no schema change                                 |
| `pytest tests/ -k "apparatus or nfc or evoc or equipment_check or compartment"` | ✅ 568 passed, 1 skipped (pre-existing optional-dependency skip) |
| `tsc --noEmit` / `eslint .`                                                     | n/a this pass — no frontend change                               |

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
