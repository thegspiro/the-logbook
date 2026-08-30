# Security Review — Grants & Fundraising

**Prefix:** `GF` · **Iteration:** 22 · **Reviewed:** 2026-08-26 (pass 1),
2026-08-30 (pass 2) · **PR:** [#1904](https://github.com/thegspiro/the-logbook/pull/1904)
(pass 1)

---

## Pass 1 (2026-08-26)

**Backend:** `app/api/v1/endpoints/grants.py` (1,883 L, 45 endpoints),
`app/services/grant_service.py` (1,135 L), `app/services/fundraising_service.py`
(651 L), model `app/models/grant.py`.
**Frontend:** not reviewed this pass — backend only, per rotation scope.
**Migrations:** `472a1e34aa84` adds `grant_applications.compliance_tasks_generated`
(added during Codex review, see below). GF-13's fix itself is an
ORM-relationship-only change and needed none.

---

## Scope

Read in full via three parallel background agents, one per primary file.
Prior context read first: `docs/module-audit/grants-fundraising.md`
(module-audit iteration 14, findings GF-1 through GF-9) and
`docs/app-review/grants-fundraising.md` (4 app-review passes through
2026-08-09, findings GF-10 through GF-12). This pass does not re-derive
GF-1 through GF-12 — it re-confirms them with fresh file:line citations and
starts from what is new since the last pass.

## Verified good ✅ (re-confirmed, not re-derived)

- **GF-1** — donation `campaign_id`/`donor_id` validated in-org before
  storage (`_entity_in_org`).
- **GF-2** — expenditure `budget_item_id` validated against the
  already-org-scoped application (`_budget_item_in_application`).
- **GF-3** — an omitted `payment_status` is normalized to `COMPLETED` on the
  in-memory row before the running-total guard checks it.
- **GF-4** — application `opportunity_id` validated in-org
  (`_opportunity_in_org`) before it can be eager-loaded into a response.
- **GF-5** — donor/opportunity search goes through `like_pattern` +
  `LIKE_ESCAPE_CHAR`, not a hand-rolled escape.
- **GF-6** — every stored-only FK (`linked_campaign_id`, `assigned_to`,
  `approved_by` on applications; `campaign_id`/`donor_id` on pledges;
  `campaign_id`/`event_id` on fundraising events; `assigned_to` on compliance
  tasks) is validated in-org via `assert_in_org`/`_entity_in_org` before
  persisting.
- **GF-10 / GF-11** — `_status_value` duck-types on `.value` so a client-set
  `reporting_frequency` / `task_type` (a plain `str` until the row round-trips
  through the DB) can't 500 the awarded-grant or completed-task paths.
- **GF-12** — `update_compliance_task`'s `assigned_to` is validated in-org.
- No SQL injection. No CSV/spreadsheet export exists anywhere in this module
  (endpoint file, both services, and a repo-wide grep for `SafeCsvWriter`/
  `csv.writer` under a grants/fundraising path all confirm this) — Pitfall
  #15 is **n/a**, not satisfied by an export that uses the safe writer.
  **Correction (pass 2):** this line originally read "`SafeCsvWriter` used
  for exports, not raw `csv.writer`," which implied an export exists; it
  does not.
- No impersonation — `created_by`/`recorded_by` set from `current_user`,
  never from the request body.

## Findings

### GF-13 — HIGH — `GrantOpportunity.applications` cascade fought its own FK's `ondelete` — ✅ FIXED

**What:** the relationship carried `cascade="all, delete-orphan"` while
`GrantApplication.opportunity_id` is declared
`ForeignKey("grant_opportunities.id", ondelete="SET NULL")` — the ORM cascade
and the DB-level FK action said opposite things. Deleting an opportunity with
linked applications either crashed (SQLAlchemy's unit-of-work implicitly
lazy-loading `applications` in an async session, `MissingGreenlet`) or
silently deleted every linked application — along with its budget items,
expenditures, compliance tasks, and notes — the opposite of what "may be a
custom/manual entry, allowed to outlive the opportunity it was linked from"
was supposed to mean.
**Where:** `app/models/grant.py`, `GrantOpportunity.applications`.
**Failure scenario:** an officer deletes a grant opportunity that already has
one or more applications attached. Best case, the request 500s. Worst case
(the more common ORM behavior under `delete-orphan`), every application ever
linked to that opportunity — and its complete financial history — is
silently erased along with it. This is the most severe finding of this
review pass: a real data-loss path on the module that tracks the
department's money.
**Fix:** removed the cascade, added `passive_deletes=True` so the ORM leaves
the delete entirely to the DB's own `ON DELETE SET NULL`:

```python
applications = relationship(
    "GrantApplication", back_populates="opportunity", passive_deletes=True
)
```

No migration needed — this is an ORM-relationship attribute, not a schema
element; the FK itself was already correct.

### GF-14 — MED — awarded→active→awarded round-trip duplicated auto-generated compliance tasks — ✅ FIXED

**What:** `_generate_compliance_tasks` runs on every transition _into_
`AWARDED` (`update_application` has no transition guard — see GF-7 below),
with no check for tasks it already created. An application moved from
`AWARDED` to `ACTIVE` and back appends a second full set of periodic
performance-report tasks, closeout report, and equipment-inventory task, with
the same titles and due dates as the first set.
**Where:** `app/services/grant_service.py`, `_generate_compliance_tasks`.
**Fix:** a dedicated `compliance_tasks_generated` boolean on
`GrantApplication`, set the first time this method runs and checked at the
top on every call — see "Revised after Codex review" below for why this
replaced the first version's task-type-based check. This is a narrow,
self-contained slice of GF-7's broader question — it does not decide whether
`AWARDED` applications should stay editable at all, only that re-entering
this specific method must not duplicate its own output.

### GF-15 — MED — three aggregate recompute helpers had no lock (Pitfall #27) — ✅ FIXED

**What:** `_update_campaign_total` / `_update_donor_stats`
(`fundraising_service.py`) and `_update_budget_item_spent`
(`grant_service.py`) are read-then-write recomputes: SUM the child rows, then
overwrite the parent's running total — with no row lock anywhere. Two
donations to the same campaign, or two expenditures against the same budget
item, recorded/updated/deleted concurrently, could each read a stale SUM and
one silently overwrite the other's contribution. Self-healing on the next
write, but transiently wrong — and "transiently wrong" on the amount a report
or a dashboard reads is exactly the kind of gap this rotation exists to
close.
**Where:** `app/services/fundraising_service.py` (`_update_campaign_total`,
`_update_donor_stats`), `app/services/grant_service.py`
(`_update_budget_item_spent`).
**Fix:** all three now lock the parent row first (`.with_for_update()` on the
campaign/donor/budget-item fetch), and make the aggregate SUM itself a
locking read too — under InnoDB's default REPEATABLE READ, a plain SELECT
answers from the transaction's first-read snapshot even after a lock is
acquired elsewhere, so the row lock alone would not make the SUM current.
**Revised after Codex review:** the first version left `create_donation`/
`create_expenditure` (and the reassignment paths in `update_donation`/
`update_expenditure`) inserting or updating the child row _before_ this
locking fetch ran. See "Revised after Codex review" below — that ordering
is itself a deadlock.

### GF-16 — MED — ten update methods used blind `setattr` loops instead of `apply_updates` — ✅ FIXED

**What:** `update_opportunity`, `update_application`, `update_budget_item`,
`update_expenditure`, `update_compliance_task` (`grant_service.py`) and
`update_campaign`, `update_donor`, `update_donation`, `update_pledge`,
`update_fundraising_event` (`fundraising_service.py`) all did
`for key, value in data.items(): setattr(instance, key, value)`. Not
currently exploitable — no `*Update` schema exposes `organization_id` or
`id` — but an explicit `null` against a NOT NULL column (e.g.
`DonationUpdate.payment_status` against `Donation.payment_status`
`nullable=False`) reaches `flush()` and raises an unhandled `IntegrityError`
(500) instead of a clean 400, per Pitfall #1.
**Where:** both service files, the ten methods named above.
**Fix:** all ten routed through `apply_updates(instance, data, skip={...})`,
skipping the tenancy/identity columns (`organization_id`/`id`, or
`application_id`/`id` for the two application-scoped models). Endpoint-layer
payloads were already `model_dump(exclude_unset=True)` everywhere in
`grants.py`, so no endpoint change was needed — only the service-layer write.

### GF-17 — LOW — `_notes_with_authors`' `User` lookup carried no org filter — ✅ FIXED

**What:** the note-serialization helper (new since the 2026-08-09 app-review
pass, alongside `GrantNoteResponse.created_by_name`) resolves author display
names with `select(User).where(User.id.in_(author_ids))` — no
`organization_id` predicate. Not currently exploitable: `author_ids` only
ever come from notes already resolved through an org-scoped
application/list query. Inconsistent with the codebase's own convention of
org-scoping every by-id query.
**Where:** `app/api/v1/endpoints/grants.py`, `_notes_with_authors`.
**Fix:** threaded `organization_id` through the helper and its two call
sites (`get_application`, `list_notes`), added to the `User` filter.

### GF-18 — LOW — `_update_budget_item_spent`'s budget-item fetch carried no org filter — ✅ FIXED (folded into GF-15)

**What:** separate from its locking gap, the budget-item fetch inside
`_update_budget_item_spent` queried by bare `id` with no `organization_id`
predicate. Every current caller passes an id already resolved through
`_budget_item_in_application`, so not currently exploitable, but a
defense-in-depth gap against the rest of the module's convention.
**Where:** `app/services/grant_service.py`, `_update_budget_item_spent`.
**Fix:** folded into the GF-15 rewrite — the locked fetch now joins to
`GrantApplication` and filters `organization_id`, matching
`update_budget_item`/`delete_budget_item`'s existing join pattern. The method
gained an `organization_id` parameter, threaded through its three callers
(`create_expenditure`, `update_expenditure`, `delete_expenditure`), all of
which already had it in scope.

## Confirmed still open — flagged, not fixed (product/design decisions)

- **GF-7 (broader)** — the idempotency slice (GF-14) is fixed, but the wider
  question stands unchanged from every prior pass: `update_application` has
  no state-machine transition guard at all (any status can move to any
  other), and there is no overspend guard preventing expenditures from
  exceeding a budget item's `amount_budgeted`. Both need a product decision
  (which transitions are legal? hard-block vs. warn on overspend?), not a
  unilateral code fix.
- **GF-8** — `is_anonymous` is still never enforced in `DonationResponse` /
  `DonorResponse`. No conditional-suppression mechanism exists in either
  schema; closing this needs a `model_validator` plus permission-context
  threading — a real design decision about who is allowed to see an
  anonymous donor's identity, not a bug fix.
- **GF-9** — confirmed still real: `get_fundraising_report` and
  `get_grant_report` accumulate float money in a loop (not just a display
  rounding issue). Stays flagged per every prior pass's product-decision
  framing (Decimal migration across the reporting path is a larger,
  deliberate change).

## Revised after Codex review

Codex's automated review on PR #1904 caught two real issues in the first
version of GF-14 and GF-15's fixes, both fixed in the same PR before merge.

**GF-15 — lock the parent before flushing the child, not after (P1).** The
first version's `create_donation`/`create_expenditure` (and the reassignment
branches of `update_donation`/`update_expenditure`) inserted or updated the
child row (`Donation`/`GrantExpenditure`) _before_ calling
`_update_campaign_total`/`_update_donor_stats`/`_update_budget_item_spent`,
which only then acquired the `FOR UPDATE` lock on the parent. But
`campaign_id`/`donor_id`/`budget_item_id` are FK columns — InnoDB's own FK
check on an INSERT (or an UPDATE that changes the FK column) takes a
**shared** lock on the referenced parent row, held for the rest of the
transaction. Two concurrent completed donations to the same campaign would
each hold a shared lock from their own FK check, then both try to upgrade to
the exclusive `FOR UPDATE` lock the recompute takes — a lock-upgrade
deadlock InnoDB resolves by killing one transaction, surfaced as an
unhandled 500 (deadlocks are not retried). Fixed by acquiring the parent
lock(s) _first_, before the child row is added/flushed — new
`_lock_campaign`/`_lock_donor` (`fundraising_service.py`) and
`_lock_budget_item` (`grant_service.py`) helpers, called on the full set of
parents an insert or update could touch (both the old and, if reassigned,
the new parent) ahead of the child flush. `delete_expenditure` was not affected — a DELETE on the child never takes a
lock on the FK's parent. (**Correction, pass 2:** this originally also named
a `delete_donation` — no such method or endpoint exists; `Donation` has no
delete path at all, only create/update.)

**GF-14 — the idempotency check itself could misfire on a manually created
task (P2).** The first version guarded `_generate_compliance_tasks` by
counting existing `GrantComplianceTask` rows whose `task_type` matched the
three auto-generated types. But `task_type` is a fully client-settable field
on manual task creation (`create_compliance_task` has no application-status
restriction), and its allowed values include the same three strings
(`performance_report`, `closeout_report`, `equipment_inventory`). An officer
who created, say, a pre-award "performance_report" task for their own
tracking would make the guard believe generation had already run — and the
application's actual first award would generate nothing at all, silently.
Fixed by replacing the query-based check with a dedicated
`compliance_tasks_generated` boolean on `GrantApplication` itself
(migration `472a1e34aa84`), set only by `_generate_compliance_tasks` and
meaning exactly "has this method run for this application" — not inferable
from, or confusable with, anything in the tasks table.

Both fixes verified: `black`/`isort`/`flake8` clean, migration applies
cleanly against the live test database (`alembic upgrade head`), full
backend suite re-run green (see Completion gate).

## Schema & migration notes

- `472a1e34aa84` adds `grant_applications.compliance_tasks_generated`
  (`BOOLEAN NOT NULL DEFAULT false`) — see "Revised after Codex review"
  above. No backfill: every existing application defaults to `false`, which
  is correct (none has run through the new guarded path yet), so the next
  award any of them sees regenerates the compliance task set exactly as it
  would have before this change.
- GF-13's fix is a relationship-attribute change only — the FK/column were
  already correct in the schema, no migration needed for that finding.

## Guard tests added

- `tests/test_grant_opportunity_delete_db.py` (new, `pytest.mark.integration`)
  — GF-13. Real-DB test: deletes an opportunity with a linked application,
  asserts the application survives with `opportunity_id` set to `None`.
  Modeled on `test_inventory_vendors_db.py`'s pattern — this bug lives
  entirely in how SQLAlchemy's unit-of-work interprets the relationship
  cascade, invisible to a mocked session.
- `tests/test_grant_service.py`:
  - `TestComplianceTaskGeneration::test_skips_regeneration_on_a_second_award`,
    `::test_manually_created_task_of_the_same_type_does_not_suppress_generation`,
    `::test_sets_the_flag_after_generating` — GF-14, the last two added for
    the Codex-caught P2 (the flag-based guard doesn't misfire on a manually
    created same-typed task the way the query-based one did).
  - `TestUpdateBudgetItemSpent` — GF-15/GF-18: asserts the item lock happens
    before the SUM read, and that a missing/out-of-org item is a no-op that
    never attempts the SUM query.
  - `TestExpenditureBudgetItemLockOrdering` (new) — the Codex-caught P1:
    asserts the budget item lock happens before the expenditure is added
    (create) or before the update flush (update, old+new budget item).
- `tests/test_fundraising_service.py`:
  - `TestUpdateCampaignTotal` / `TestUpdateDonorStats` — GF-15: asserts the
    parent-row lock happens before the aggregate read, and that a missing
    campaign/donor is a no-op that never attempts the aggregate query.
  - `TestDonationParentLockOrdering` (new) — the same P1, for donations:
    asserts the campaign/donor locks happen before the donation is added
    (create) or before the update flush (update, old+new campaign).

## Completion gate

| Check                                                              | Result                  |
| ------------------------------------------------------------------ | ----------------------- |
| `flake8` (changed files)                                           | clean                   |
| `black --check` (changed files)                                    | clean                   |
| `isort --check-only` (changed files)                               | clean                   |
| `python3 scripts/validate_migrations.py --strict`                  | PASSED                  |
| `alembic upgrade head` (live test database)                        | applied cleanly         |
| backend tests, scope (`grant_service` + `fundraising_service`)     | 52 passed               |
| backend tests, integration (`test_grant_opportunity_delete_db.py`) | 1 passed                |
| backend tests, full suite                                          | 8855 passed, 22 skipped |

---

## Pass 2 (2026-08-30)

**Backend:** `app/api/v1/endpoints/grants.py`, `app/services/grant_service.py`,
`app/services/fundraising_service.py`, `app/models/grant.py`,
`app/schemas/grant.py`.
**Frontend:** established for the first time this pass (pass 1 was
backend-only) — the real module lives at `frontend/src/modules/grants-fundraising/`
(services, store, routes, types, and 8 pages — `GrantsDashboardPage`,
`GrantOpportunitiesPage`, `GrantApplicationsPage`, `GrantApplicationFormPage`,
`GrantDetailPage`, `CampaignsPage`, `DonorsPage`, `DonationsPage`,
`GrantsReportsPage`), ~6,900 lines across 14 files. A repo-wide grep for
`grant`/`Grant`/`fundraising`/`Fundraising` also confirmed no grants/donor
data is read or written from outside this module and `dashboard.py` (a
different feature's endpoint file) — that call site only aggregates the
already-gated `/grants` figures onto the org dashboard behind its own
`fundraising.view` check, read directly and confirmed correct.
**Migrations:** none since pass 1.

### Scope since pass 1's merge (`520978c4`, PR #1904)

`git diff 520978c4 HEAD --stat` against all five declared backend files came
back **empty — byte-identical** to what merged in PR #1904; confirmed by the
diff itself, not assumed from `git log`. `git diff --name-only 520978c4 HEAD
-- backend/alembic/versions/` lists 19 new migration files; each was checked
by content (not filename) for any grant/fundraising-table touch — none
found. No backend or schema drift of any kind to scope against; this pass is
a full independent re-read of unchanged code plus the module's first
frontend review.

### Re-verification of pass-1 fixes (GF-13 through GF-18)

Read the current `grants.py`, `grant_service.py`, `fundraising_service.py`,
and `grant.py` in full (not re-cited from the pass-1 doc) and confirmed
every fix is intact at its current line:

- **GF-13** — `GrantOpportunity.applications` still carries no cascade and
  `passive_deletes=True`; the FK (`GrantApplication.opportunity_id`,
  `ondelete="SET NULL"`) is unchanged. Also checked every other relationship
  in the model file for the same ORM-cascade-vs-FK-`ondelete` mismatch: all
  four `cascade="all, delete-orphan"` relationships on `GrantApplication`
  (`budget_items`, `expenditures`, `compliance_tasks`, `grant_notes`) pair
  with a child FK that is `ondelete="CASCADE"` — consistent, no GF-13-shaped
  gap elsewhere. `FundraisingCampaign.donations`/`.pledges`/
  `.fundraising_events` carry no cascade and no `passive_deletes`, which
  would reproduce GF-13's exact failure mode on a hard delete of a
  campaign — but `delete_campaign` is (and was, per its own docstring) a
  **soft** delete (`campaign.active = False`, no `db.delete()`), and a
  repo-wide grep for `db.delete(` against `Campaign`/`Donor`/`Pledge`/
  `FundraisingEvent` found no call site — the mismatch exists on paper but
  has no reachable trigger.
- **GF-14** — `_generate_compliance_tasks` still checks
  `application.compliance_tasks_generated` first and sets it before doing
  any work; the dedicated boolean column (not a `task_type` query) is
  unchanged.
- **GF-15** — `_update_budget_item_spent`, `_update_campaign_total`, and
  `_update_donor_stats` all still lock the parent row first
  (`.with_for_update()`) and make the aggregate `SUM` itself a locking read.
- **GF-16** — all ten update methods still route through `apply_updates`.
- **GF-17** — `_notes_with_authors`' `User` lookup still filters
  `organization_id`.
- **GF-18** — `_update_budget_item_spent`'s budget-item fetch still joins
  through `GrantApplication` and filters `organization_id`.
- **Codex P1 (parent-lock-before-child-flush)** — `_lock_budget_item`/
  `_lock_campaign`/`_lock_donor` are still called before the child row is
  added/flushed in `create_expenditure`/`update_expenditure` and
  `create_donation`/`update_donation`, for both the old and (if reassigned)
  new parent.
- **Codex P2 (idempotency-guard reliability)** — `compliance_tasks_generated`
  is still a dedicated column on `GrantApplication`, not inferred from
  `task_type`; migration `472a1e34aa84` unchanged.

Re-ran an AST-equivalent enumeration by grep from scratch (not a diff
against pass 1's count): **45/45** routes in `grants.py` carry
`Depends(require_permission("fundraising.view"))` or
`Depends(require_permission("fundraising.manage"))` — matching count and
pattern exactly. Neither permission string appears in `DEFAULT_POSITIONS`'
`member`/`firefighter` baseline entries in `core/permissions.py` (grepped
the whole backend for the literal strings — only the two `Permission(...)`
declarations and this feature's own call sites), so this is not a
Pitfall #23-shaped baseline-grant gap. Every by-id query in both services
was re-swept mechanically for a missing `organization_id` filter (direct,
or via an already-org-scoped join to `GrantApplication`/`FundraisingCampaign`
etc.) — no gap. All `.ilike()` calls (`list_opportunities`, `list_donors`)
still pass `escape=LIKE_ESCAPE_CHAR` via `like_pattern()`.

**Re-confirmed still open (unchanged, per every prior pass):** GF-7
(state-machine/overspend), GF-8 (`is_anonymous` not enforced in responses —
no public surface exists anywhere in this app that would read it, checked
`api/public/` directly, so this remains staff-only exposure), GF-9 (float
money math in both `get_grant_report` and `get_fundraising_report`).

### New this pass

No new backend findings — zero code drift and a full independent re-read
surfaced nothing pass 1 missed.

**GF-19 (NIT, doc-accuracy, fixed)** — pass 1's "Verified good" section
claimed `SafeCsvWriter` is "used for exports, not raw `csv.writer`," which
reads as an export existing and using the safe writer. Neither service file,
the endpoint file, nor any other file under a grants/fundraising path
imports `SafeCsvWriter` or `csv.writer` — **no CSV/spreadsheet export exists
anywhere in this module**, so Pitfall #15 is not "satisfied," it's not
applicable. Corrected in the Pass 1 section above rather than left standing;
not a vulnerability (nothing to inject into), just a doc claim that
overstated what was checked.

**GF-20 (NIT, doc-accuracy, fixed)** — the same section's "Revised after
Codex review" writeup states "`delete_donation`/`delete_expenditure` were
not affected" by the parent-lock-ordering fix. `delete_donation` does not
exist — `Donation` has no delete endpoint or service method at all, only
`create`/`update` (confirmed: `grep -rn "delete_donation" backend/app`
returns nothing). Corrected in place.

### Frontend review (new this pass)

Read `services/api.ts` (410 L), `routes.tsx`, `store/grantsStore.ts` (342 L),
`pages/GrantApplicationFormPage.tsx` (624 L), and `pages/DonationsPage.tsx`
(232 L) in full; `pages/GrantDetailPage.tsx` (1,428 L, the module's largest
and most complex file — budget/expenditure/compliance-task/note modals) in
full through its data-loading, derived-state, and form-submission logic plus
every external-link render site; the remaining four pages
(`GrantOpportunitiesPage.tsx`, `CampaignsPage.tsx`, `DonorsPage.tsx`,
`GrantsReportsPage.tsx`, `GrantApplicationsPage.tsx`) were swept with the
same targeted greps used below rather than read line-by-line — noted as
partial-scope, not assumed clean.

- **Auth wiring (Pitfall #7):** `services/api.ts` builds its axios instance
  via the shared `createApiClient()` factory (`withCredentials: true`, CSRF
  double-submit header, shared-refresh-promise 401 handling) — not a
  hand-rolled instance. No gap.
- **Permission gating:** all 9 routes in `routes.tsx` carry
  `requiredPermission="fundraising.view"` or `"fundraising.manage"`, matching
  the backend string-for-string, plus `requiredModule="grants"`.
- **Cache exclusion:** `apiCache.ts`'s `UNCACHEABLE_PREFIXES` carries a bare
  `/grants` entry (no trailing slash, so it covers every route in the
  module by prefix) — correct, though moot in practice: `createApiClient()`
  wires no cache at all (`getCached`/`setCache` are called only from
  `services/apiClient.ts`, the separate global instance, and one bespoke
  scheduling file), so this module's own axios instance never consults the
  cache either way. Recorded as "verified good" on the list's own terms,
  not as a live risk either way.
- **Banned patterns:** repo-wide grep across the whole module for
  `window.confirm`/`alert`/`prompt`, `dangerouslySetInnerHTML`,
  `.toLocaleString`/`.toLocaleDateString`/`.toLocaleTimeString`,
  `date-fns` imports, `localStorage`/`sessionStorage`, `innerHTML`, `eval(`,
  and direct `fetch(` — **zero hits**, all clean.
- **Form payload discipline (Pitfall #1):** every form
  (`GrantApplicationFormPage`, `DonorsPage`, `CampaignsPage`,
  `GrantDetailPage`'s three modals) builds its payload with `.trim() ||
null` / `value || null`, uniformly, for **both** create and update calls.
  This is correct on both paths here specifically: the backend schemas type
  every optional field `Optional[T] = None`, so an explicit `null` is valid
  on create (equivalent to omitting the key) and is what actually clears the
  field on update (`exclude_unset=True` + `apply_updates`, per Pitfall #1's
  own update-path rule) — no `||`-vs-`??` bug, and no create/update
  asymmetry to fix.
- **Outbound URL re-validation:** every external link render
  (`exp.receiptUrl` in `GrantDetailPage`, `opp.applicationUrl` in
  `GrantOpportunitiesPage`) is gated behind `isSafeExternalUrl(...)` before
  being used as an `href`, in addition to the backend's own
  `validate_external_http_url` field validator on write — both ends
  checked, matching the pattern `assert_outbound_url_safe` documents
  elsewhere in the codebase. `target="_blank"` links carry
  `rel="noopener noreferrer"`.
- **No delete UI:** no page calls any of the five `delete*` service methods
  (`deleteOpportunity`, `deleteApplication`, `deleteBudgetItem`,
  `deleteExpenditure`, `deleteComplianceTask`) — confirmed by grep, not
  assumed from the missing `useConfirm()` calls. Not a finding (fewer
  exposed capabilities is not a risk), just why no confirm-dialog
  discipline needed checking on this surface.
- **Pitfall #11 (fetch full record after create):** `grantsStore.ts`'s
  `addBudgetItem`/`addExpenditure`/`addComplianceTask`/`addGrantNote` all
  re-fetch the full application via `getApplication` after the create call
  and before updating state — followed correctly.
- **Known, already-documented gap (not new):** `DonationsPage.tsx` carries
  an in-code comment (and `KNOWN_LIMITATIONS.md` already carries the row)
  noting the "Record Donation" action was removed because it pointed at a
  route that was never built; `fundraisingService.createDonation` and
  `useGrantsStore.createDonation` exist and are correct but have zero UI
  callers. Re-confirmed still true, not re-added as a new finding.
- **Test coverage:** zero `*.test.ts(x)` files exist anywhere under
  `frontend/src/modules/grants-fundraising/` — noted for completeness, not
  filed as a security finding (a coverage gap, not a vulnerability); no
  `npx vitest run` scope exists to execute for this module as a result.

No new frontend findings.

### KNOWN_LIMITATIONS.md

GF-7 and GF-8 were already recorded (rows added by pass 1). **GF-9 (float
money math) was not** — added this pass, mirroring the existing two rows'
format.

### Guard tests added

None. No new fix was applied this pass (zero backend drift, no new
findings needing a code change) — the existing GF-13/14/15 guard tests
(`test_grant_opportunity_delete_db.py`, `TestComplianceTaskGeneration`,
`TestUpdateBudgetItemSpent`/`TestUpdateCampaignTotal`/`TestUpdateDonorStats`,
the two lock-ordering test classes) were re-run and confirmed still passing
and still enforcing what they were written to enforce.

## Completion gate (pass 2)

| Check                                                   | Result                                                   |
| ------------------------------------------------------- | -------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                           | 0 violations                                             |
| `black --check app/ tests/ alembic/`                    | 1335 files unchanged                                     |
| `isort --check-only app/ tests/ alembic/`               | clean (isort 8.0.1, already installed)                   |
| `python3 scripts/validate_migrations.py --strict`       | PASSED — 394 revisions, single head                      |
| `python3 -m pytest tests/ -q -k "grant or fundraising"` | 307 passed, 1 pre-existing skip                          |
| `python3 -m pytest tests/ -q` (full suite)              | 9268 passed, 22 pre-existing skips, 0 failed             |
| `npx tsc --noEmit` / `npm run typecheck` (aliased TS 7) | 0 errors                                                 |
| `npx eslint .`                                          | 0 errors, 8 pre-existing warnings, none in touched files |
| frontend `vitest run` scoped to this module             | n/a — no test files exist for this module                |

No code changes this pass — findings-doc and `PROGRESS.md`/`KNOWN_LIMITATIONS.md`
corrections only.
