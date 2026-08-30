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
`app/schemas/grant.py`. **Correction (tend pass, below):** the declared scope
above omitted `app/services/dashboard_widget_service.py`, which queries
`GrantOpportunity`/`GrantApplication`/`FundraisingCampaign`/`Donation`
directly (not through `grant_service.py`) for the main dashboard's
fundraising widget — see GF-21.
**Frontend:** established for the first time this pass (pass 1 was
backend-only) — the real module lives at `frontend/src/modules/grants-fundraising/`
(services, store, routes, types, and 8 pages — `GrantsDashboardPage`,
`GrantOpportunitiesPage`, `GrantApplicationsPage`, `GrantApplicationFormPage`,
`GrantDetailPage`, `CampaignsPage`, `DonorsPage`, `DonationsPage`,
`GrantsReportsPage`), ~6,900 lines across 14 files. A repo-wide grep for
`grant`/`Grant`/`fundraising`/`Fundraising` also confirmed no grants/donor
data is read or written from outside this module and one other call site:
`DashboardWidgetService.fundraising` (`dashboard_widget_service.py`),
which does **not** aggregate already-gated `/grants` figures — it queries
`GrantOpportunity`/`GrantApplication`/`FundraisingCampaign`/`Donation`
directly, independently of `grant_service.py`/`fundraising_service.py`. Read
in full and confirmed correct: every query filters `organization_id`
(the `Donation` sum filters it on both sides of its join to
`FundraisingCampaign`), `organization_id` comes from `current_user`, never
a client value, and the block is gated behind both `"grants" in
enabled_modules` and `fundraising.view` — the same permission string used
everywhere else in this module. See GF-21. **Correction (tend pass,
below):** `GrantsDashboardPage.tsx` was omitted from both the "read in
full" and "swept" page lists below — see GF-22.
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

No new backend findings from the pass-2 re-read itself — zero code drift and
a full independent re-read surfaced nothing pass 1 missed. **Codex review on
PR #2069 subsequently caught a real backend scope gap (GF-21 — the code
itself is clean) and a real backend bug (GF-24) that this re-read's own
checklist did not surface — see "Tend pass — Codex review response" below.**

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

### Tend pass — Codex review response (2026-08-30)

Codex posted 6 review comments on PR #2069 disputing this pass's "0 fixed, 0
new findings" conclusion. Verified each against the current code rather than
taken on faith — Codex's track record on this rotation had been accurate on
every prior PR checked. Four were real, three fixed here; one was a genuine
doc-scope gap with the underlying code confirmed clean; one was an
already-fixed bug where only `KNOWN_LIMITATIONS.md` had gone stale.

#### GF-21 — NIT (doc-scope gap, no code bug) — `dashboard_widget_service.py`'s fundraising widget was never named in scope

**What:** the "Backend:" scope line at the top of this pass names
`grants.py`, `grant_service.py`, `fundraising_service.py`, `grant.py`, and
`schemas/grant.py` — it omits `app/services/dashboard_widget_service.py`,
whose `fundraising()` method queries `GrantOpportunity`, `GrantApplication`,
`FundraisingCampaign`, and `Donation` directly (not through
`grant_service.py`/`fundraising_service.py`) to build the main dashboard's
fundraising KPI widget. This pass's own "Scope" section describes
`dashboard.py`'s call site as aggregating "already-gated `/grants` figures"
onto the dashboard — which undersells what is actually happening: it isn't
calling the `/grants` API or `GrantService` at all, it's a fourth,
independent query path against the same four models that this pass's
declared scope never named.

**Verified (no code fix needed):** read `DashboardWidgetService.fundraising`
(`app/services/dashboard_widget_service.py:146-203`) and its caller
(`GET /dashboard/widgets`, `app/api/v1/endpoints/dashboard.py:816-864`) in
full. Every query filters `organization_id` — `GrantOpportunity` and
`GrantApplication` directly; the `Donation` sum joins `FundraisingCampaign`
and filters `organization_id` on **both** sides of the join, not just one.
`org_id` itself comes from `str(current_user.organization_id)`, never a
client-supplied value. The endpoint gates the entire fundraising block
behind **both** `"grants" in enabled_modules` (the org has the module
switched on) **and** `user_has_permission(current_user, "fundraising.view")`
— the identical permission string this module enforces everywhere else, not
a separate weaker check. Clean by the same mechanism (org-id-from-token +
permission dependency) as every other query in this module.

**Fix:** doc-accuracy only. Added `dashboard_widget_service.py` to the
"Backend:" scope line and corrected the "Scope" section's description of
`dashboard.py`'s call site to name the actual mechanism rather than imply it
goes through `/grants`.

#### GF-22 — NIT (doc-accuracy) — `GrantsDashboardPage.tsx` omitted from the frontend page inventory

**What:** the "Frontend review" section below lists 3 pages read in full and
5 pages swept by grep — 8 total, matching the module's page count — but the
file actually named across both lists was `GrantApplicationsPage.tsx`
appearing in the "swept" list under a paragraph that said "remaining **four**
pages" while naming **five** (a second, independent accuracy slip in the
same sentence). `GrantsDashboardPage.tsx` — a real page in the module,
rendered at the module's own root route `/grants` — appeared in neither list
and had not been opened at all.

**Fix:** read `GrantsDashboardPage.tsx` (626 L) in full. It is read-only (a
single `fetchDashboard()` call on mount; no create/update/delete service
call anywhere in the file) and clean against the same checklist the other
pages got: no `window.confirm`/`alert`/`prompt`, no
`dangerouslySetInnerHTML`, no banned `.toLocale*`/`date-fns` (uses
`formatDate`/`daysUntil` from `dateFormatting.ts` throughout, with
`useTimezone()`), no direct `fetch(`. One gap: its "New Application" link
was unconditionally rendered regardless of the viewer's permission — folded
into GF-23 below rather than treated separately, since it's the same bug in
the same class of control. Corrected the page inventory and count in the
"Frontend review" section.

#### GF-23 — LOW (broken-UX bug, not a security hole) — manage-only controls rendered unconditionally on view-gated pages

**What:** `routes.tsx` gates navigation correctly (`fundraising.view` for
read routes, `fundraising.manage` only for `/grants/applications/new` and
`/grants/applications/:id/edit`) — the finding above ("Permission gating")
described only this and stopped, which is accurate as far as it goes but
incomplete: a `fundraising.view`-only user reaching any of the
`.view`-gated pages could still see, and attempt to submit, controls that
require `.manage` on the backend. The backend enforcement itself is
correct throughout (`require_permission("fundraising.manage")` on every
create/update route it applies to, confirmed by reading each endpoint) —
this is not a cross-tenant or authorization hole, it's a UX bug: the
control is shown, the click 403s, and the viewer gets no explanation of
why a button they can see doesn't work.

**Verified, file by file** (grepped the whole module for
`checkPermission`/`canManage`/`useAuthStore` first — zero hits anywhere,
confirming no page in this module gated any control on the viewer's
permission before this fix):

- `CampaignsPage.tsx` (read in full) — "New Campaign" button and its inline
  create form were unconditional; `POST /grants/campaigns`
  (`create_campaign`) requires `fundraising.manage`.
- `DonorsPage.tsx` (read in full) — "Add Donor" button and its inline create
  form were unconditional; `POST /grants/donors` (`create_donor`) requires
  `fundraising.manage`.
- `GrantDetailPage.tsx` (already read in full for this pass) — the Edit
  button, "Add Item" (budget), "Record Expenditure", "Add Task"
  (compliance), the per-task status dropdown + "Mark Complete", and "Add
  Note" were all unconditional. Backend: `update_application` (Edit's
  target route is itself `.manage`-gated, so this one degrades gracefully
  rather than 403ing — fixed anyway for consistency), `create_budget_item`,
  `create_expenditure`, `create_compliance_task`, `update_compliance_task`,
  and `create_note` all require `fundraising.manage` — confirmed by reading
  each endpoint in `grants.py` directly, not inferred from naming.
- `GrantsDashboardPage.tsx` (GF-22, read in full this pass) — the "New
  Application" link was unconditional; same as GrantDetailPage's Edit
  button, its target route is already `.manage`-gated so this degrades to
  a graceful "Access Denied" screen rather than a raw 403 — fixed anyway
  for consistency with every other control in the module.

**Fix:** added `const canManage = useAuthStore((s) => s.checkPermission)('fundraising.manage')`
to each of the four files above (the established convention this app
already uses — see `inventory`/`apparatus` modules' `canManage` pattern) and
wrapped each manage-only control in `{canManage && (...)}`; the compliance
task status dropdown and "Mark Complete" button render as a plain read-only
status badge for a view-only viewer instead of disappearing outright, since
the status itself is information the viewer is entitled to see.

**Verified but left unfixed, with reasoning — not silently left off the
list:** `GrantApplicationsPage.tsx` has two "New Application" links and
`GrantOpportunitiesPage.tsx` has one "Add Opportunity" button, both also
unconditional. Both are lower severity than the four fixed above for the
same reason GrantsDashboardPage's link was: `GrantApplicationsPage`'s links
navigate to `/grants/applications/new`, a route `routes.tsx` already gates
at `fundraising.manage`, so a view-only click lands on `ProtectedRoute`'s
graceful "Access Denied" screen rather than a raw API 403 — a real
UX rough edge, not the "will 403 when clicked" failure mode Codex flagged.
Left as-is rather than expanding this fix into a fifth and sixth file for a
strictly lower-severity variant of the same issue; a future pass can pick
these up.

**Aside, out of scope for this finding, not fixed:**
`GrantOpportunitiesPage.tsx`'s "Add Opportunity" button navigates to
`/grants/opportunities/new` — a route that does not exist anywhere in
`routes.tsx`. The router's catch-all sends it to `/`, so the button silently
returns any user (regardless of permission) to the home dashboard — the
same shape of bug `DonationsPage.tsx`'s already-documented "Record Donation"
removal fixed on a different page. This is unrelated to permission gating
(it fails identically for a `.manage` holder) and outside the six findings
this tend pass addresses; flagged here rather than fixed so it isn't lost,
and left for a future pass to build the missing page/route or remove the
dead button the same way `DonationsPage.tsx` did.

#### GF-24 — MED — `get_grant_report`/`get_fundraising_report` end-date filters excluded the entire end date

**What:** `GrantApplication.created_at` and `Donation.donation_date` are
both `DateTime(timezone=True)` columns; `get_grant_report`
(`grant_service.py`) and `get_fundraising_report`
(`fundraising_service.py`) — plus `FundraisingService.list_donations`, the
same bug in a sibling method in the same file — filtered
`<= end_date` against a plain `date` from the report UI. MySQL coerces a
bare `DATE` to midnight (00:00:00) of that day when compared against a
`DATETIME`, so the filter silently excluded every record created later that
same day. Since the report UI's default range always includes "today," this
understated every report's totals whenever any record from later in the
current day existed — the default/common case, not an edge case.

**Where:** `app/services/grant_service.py` (`get_grant_report`),
`app/services/fundraising_service.py` (`get_fundraising_report` and
`list_donations`).

**Fix:** matched the established end-of-day boundary pattern already used
elsewhere in this codebase (`reports_service.py`'s
`_generate_event_attendance` and others): replaced the bare-`date`
comparison with `datetime.combine(end_date, datetime.max.time(),
tzinfo=timezone.utc)` for the upper bound (and, for consistency,
`datetime.combine(start_date, datetime.min.time(), tzinfo=timezone.utc)`
for the lower bound, which was not itself buggy — MySQL's midnight
coercion is already the correct inclusive start-of-day boundary — but now
makes both ends of the comparison explicit `DateTime` values rather than
mixing a bare `date` with a timezone-aware column).

**Guard tests added (new file, real DB):**
`tests/test_grant_report_date_range_db.py` (`pytest.mark.integration`,
`db_session` fixture — a mocked-session test cannot catch this at all, since
the mock returns canned rows regardless of the constructed `WHERE` clause).
Three tests, each creating one record at 08:00 UTC and one at 23:30 UTC on
the same day and asserting a same-day `start_date`/`end_date` report
includes both: `test_grant_report_end_date_includes_records_created_later_that_day`,
`test_fundraising_report_end_date_includes_donations_later_that_day`,
`test_list_donations_end_date_includes_donations_later_that_day`. Verified
each fails before the fix (temporarily reverted the `Number`/`datetime.combine`
change, confirmed the 23:30 record was silently dropped) and passes after.

**Follow-up (Codex review, round 2) — GF-24a — LOW-MED, FLAGGED, not fixed —
the boundary is hard-coded UTC, not the organization's local timezone.**
Correct: for an org whose `organization.timezone` is not UTC (e.g.
`Asia/Tokyo`, `America/Los_Angeles`), a report end date of June 15 should
mean "through June 15 in the department's own timezone," not through
June 15 in UTC — the current fix's boundary is off by the org's UTC offset,
which for a report spanning "today" can still include tomorrow's early-UTC
records or exclude this evening's local records depending on the offset's
sign. **Not a regression from this fix, and not unique to this PR:** the
identical hard-coded-UTC boundary is the pre-existing, established pattern
at every other date-range report filter in the codebase —
`reports_service.py` alone has the same `datetime.combine(..., tzinfo=timezone.utc)`
shape at 5 separate call sites, none org-timezone-aware. This fix brings
`grant_service.py`/`fundraising_service.py` from "silently drops same-day
records" (strictly wrong for every organization) to "matches every other
report in the app" (imperfect for non-UTC organizations, consistent with
existing behavior) — a net improvement, never a regression, for any org in
any timezone.

Fixing the org-timezone gap correctly is a larger, deliberately out-of-scope
change for this PR: `app/utils/org_timezone.py`'s `resolve_scheduling_timezone`
looks like the obvious reusable primitive, but its own docstring says its
`America/New_York` fallback is specifically scheduling's historical default
("changing it would move existing departments' shift times") — reusing it
for reports would need its own decision about what a reporting-context
default should be, not an assumption borrowed from an unrelated module.
Doing this correctly means a coordinated fix across every `reports_service.py`
call site plus these two grants/fundraising ones, not a 3-line patch to the
files this PR happens to touch. Flagged rather than guessed at; mirrored
into `docs/KNOWN_LIMITATIONS.md` as a new cross-cutting item (not filed
under the `GF` prefix, since it spans well beyond this module).

#### GF-25 — NIT (doc-accuracy) — `KNOWN_LIMITATIONS.md`'s GF-7 row still described the already-fixed GF-14 bug

**What:** GF-14 (pass 1, re-confirmed intact above) fixed the
`awarded → active → awarded` duplicate-compliance-task bug via the dedicated
`compliance_tasks_generated` boolean. `docs/KNOWN_LIMITATIONS.md`'s GF-7 row
still listed "an `awarded → active → awarded` round-trip regenerates a
duplicate full set of compliance tasks" and "idempotent compliance-task
generation" as open work, alongside GF-7's genuinely-still-open
state-machine/overspend-guard gap.

**Fix:** docs-only. Rewrote the GF-7 row to keep only the state-machine and
overspend-guard items (still open, still needs a product decision) and
note the duplicate-task half as resolved, citing GF-14 and this pass's
re-confirmation that the fix is intact.

#### GF-26 — MED — fundraising report payment-method percentages broken by string concatenation

**What:** `FundraisingReportResponse.donations_by_method` is
`Dict[str, Decimal]` — verified empirically
(`M(donations_by_method={'cash': Decimal('10.10')}).model_dump(mode='json')`
→ `{'cash': '10.10'}`) that Pydantic 2's default JSON serialization sends
`Decimal` values as **strings**, with no override anywhere in this schema or
a shared base model. `GrantsReportsPage.tsx`'s `FundraisingReport` type
nonetheless declares `donationsByMethod: Record<string, number>` — the same
declared-vs-wire mismatch `currencyFormatting.ts`'s own `Money` doc comment
says is deliberate and app-wide, on the understanding that every consumer
coerces before doing arithmetic. This one didn't:
`donationsByMethod.reduce((sum, [, v]) => sum + v, 0)` used `+`, which is
string concatenation on two strings, not addition — `0 + "10.10" + "20.20"`
becomes the string `"010.1020.20"`, not `30.30`. That corrupted total then
fed `donationsByMethodTotal > 0` (a string compared to a number coerces the
string with `Number()`, and `Number("010.1020.20")` is `NaN`, so the
guard was always false) — every payment method's displayed percentage
silently read **0.0%** the moment 2 or more methods had donations, with no
error, on the page an officer would use to see the donation mix.

**Where:** `frontend/src/modules/grants-fundraising/pages/GrantsReportsPage.tsx`
(`donationsByMethodTotal`, and the per-row `pct` calculation immediately
below it).

**Fix:** frontend-boundary fix, matching this exact module's own established
convention — `DonationsPage.tsx` already guards its own donation-amount
total the same way
(`filtered.reduce((sum, d) => sum + Number(d.amount), 0)`). Changed the
reduce to `sum + Number(v)` and the per-row percentage calculation to
`Number(amount) / donationsByMethodTotal`. Did not change the backend
schema — `Decimal`-as-string is this app's established, intentional
Pydantic serialization behavior for money fields (every other financial
response in the app relies on the same frontend-coerces-at-use-site
convention via the `Money` type in `currencyFormatting.ts`), so a
schema-level change here would be inconsistent with every other financial
response rather than more correct.

**Guard test added:** `GrantsReportsPage.test.tsx` (new file — no test
file existed anywhere in this module before this pass). Mocks
`grantsService.getFundraisingReport` to return `donationsByMethod: { cash:
'10.10', check: '20.20' }` — **strings**, simulating the real wire shape
rather than the clean `number` the declared type claims, which is exactly
what let this bug through untested — and asserts the rendered percentages
are `33.3%`/`66.7%`. Verified it fails before the fix (both percentages
render `0.0%`, reproducing the bug exactly) and passes after.

#### GF-27 — LOW (broken UX, not a security hole) — dashboard KPI/pipeline status links silently landed on the unfiltered list

**What:** Caught by Codex review, round 4, on the round-3 commit — after
`GrantsDashboardPage.tsx` was added to reviewed scope (GF-22) and its
controls audited for permission-gating (GF-23), a further read found its
KPI/pipeline cards link to `/grants/applications?status=active`,
`/grants/applications?status=submitted`, and `/grants/campaigns?status=active`
— but `GrantApplicationsPage.tsx` and `CampaignsPage.tsx` each initialize
their own `statusFilter` to `''` from a plain `useState`, never reading the
URL's `status` query parameter. Clicking any of those cards therefore always
returned to the full unfiltered list, silently discarding the filter the
card promised.

**Where:** `frontend/src/modules/grants-fundraising/pages/GrantApplicationsPage.tsx`,
`frontend/src/modules/grants-fundraising/pages/CampaignsPage.tsx`.

**Fix:** both pages now seed `statusFilter` from `useSearchParams()` at
initial state (`useState(() => searchParams.get('status') ?? '')`), matching
the existing `?tab=`-reading convention already used elsewhere in the app
(`ComplianceRequirementsConfigPage.tsx`, `Dashboard.tsx`). Confirmed the
dashboard's literal query values (`active`, `submitted`) match the pages'
own `ApplicationStatus`/`CampaignStatus` enum values exactly, so no mapping
layer was needed.

**Guard test added (`CampaignsPage.statusFilter.test.tsx`, new file):**
renders the page with `initialEntries={['/grants/campaigns?status=active']}`
and asserts `fundraisingService.listCampaigns` is called with
`{ status: 'active' }` (and with `{}` when the URL carries no `status`).
Verified it fails before the fix (called with `{}` regardless of the URL)
and passes after. `GrantApplicationsPage.tsx`'s identical one-line fix was
not given its own dedicated render test — the change is the same pattern
verified by the `CampaignsPage` test, `tsc --noEmit` confirms the types
line up, and the module's applications-list rendering already has no test
harness to extend without building one from scratch, which is out of
proportion for a one-line fix. Flagged here rather than silently assumed.

#### GF-28 — LOW (broken UX, not a security hole) — dashboard's "View Campaign" link pointed at a route that does not exist

**What:** Also caught by Codex review, round 4. The dashboard's
recent-donations table links each row to
`` `/grants/campaigns/${donation.campaignId}` ``, but `routes.tsx` registers
only `/grants/campaigns` (the list) — no `/grants/campaigns/:id` detail
route exists anywhere in this module. Clicking "View Campaign" matched
`App.tsx`'s catch-all route and silently redirected to `/`, with no error
and no explanation.

**Where:** `frontend/src/modules/grants-fundraising/pages/GrantsDashboardPage.tsx`.

**Fix:** pointed the link at `/grants/campaigns` (the list, an existing
valid route) instead of the non-existent per-id route. This is the minimal
correct fix, not a full solution — `CampaignsPage.tsx` has no per-campaign
detail view or ID-based deep link at all (confirmed: no `campaignId` route
param, no expand/detail UI reading one), and the `Donation` type carries
only `campaignId`, no `campaignName`, so there is no reasonable way to
land the user on the specific campaign without first building a campaign
detail page — a real feature gap, not a one-line fix, and out of this PR's
scope. Flagged rather than building new UI to close it.

#### GF-29 — MED — the reports page's default year could be built from the wrong year across a UTC/local mismatch

**What:** Also caught by Codex review, round 4 — distinct from GF-24a (the
backend's report-query boundary): this is a frontend bug in
`getDefaultDateRange`, which built the start-of-year bound from
`new Date().getFullYear()` (the **test/browser runtime's own local year**)
and then converted that `Date` instant into the organization's `tz` via
`toLocalDateString`. Near midnight UTC on January 1st, an organization in a
timezone behind UTC (e.g. `America/Los_Angeles`) is still in the previous
year locally while the runtime's own year has already rolled over — the
old code then produced a `start` date _after_ the correct start of the
organization's actual current year, collapsing the default report range to
a single day instead of the full year. Verified with a reproduction: system
time `2027-01-01T00:30:00Z`, org tz `America/Los_Angeles` (still
`2026-12-31` there) — old code produced `start: '2026-12-31'`,
`end: '2026-12-31'`; the organization's actual current year starts
`2026-01-01`.

**Where:** `frontend/src/modules/grants-fundraising/pages/GrantsReportsPage.tsx`
(`getDefaultDateRange`).

**Fix:** derive the year from the organization's own local "today" directly
(`getTodayLocalDate(tz).slice(0, 4)`) rather than round-tripping through a
`Date` object built in the runtime's own timezone. `toLocalDateString` is no
longer used in this file and its import was removed.

**Guard test added:** `GrantsReportsPage.defaultRange.test.tsx` (new file).
Fakes only `Date` (`vi.useFakeTimers({ toFake: ['Date'] })` — faking
`setTimeout` too starves Testing Library's own `waitFor` polling and the
page's data-fetch effect), sets system time to `2027-01-01T00:30:00Z`, mocks
`useTimezone` to `'America/Los_Angeles'`, and asserts the rendered date
inputs read `2026-01-01`/`2026-12-31`. Verified it fails before the fix
(`2026-12-31`/`2026-12-31`, reproducing the bug exactly) and passes after.
The two date inputs also gained `aria-label="Start date"`/`"End date"` — a
real, if minor, accessibility gap the test's own need to query them exposed
— which let this test use `getByLabelText` instead of a direct
`container.querySelectorAll` (the latter tripped `--max-warnings 10` in CI:
see "CI fix" below).

**CI fix (same day):** the direct-DOM-query version of this test's own
first push tripped `Frontend Lint, Typecheck & Build`'s
`eslint --max-warnings 10` — 3 new `testing-library/no-node-access`/
`no-container` warnings pushed the repo-wide total from 8 to 11. Fixed by
adding the `aria-label`s above and switching the test to `getByLabelText`
(commit `e6cf9b5b`); back to 8 warnings.

#### GF-27a — LOW-MED, FLAGGED, not fixed — the dashboard's KPI-card status links don't match the multi-status aggregate the KPI itself counts

**What:** Caught by Codex review, round 5, on GF-27's own fix. The
dashboard's "Active Grants" and "Pending Applications" KPI numbers come
from `GrantService.get_dashboard_data()`, which counts **multiple**
statuses per KPI — `active` **and** `reporting` for "Active Grants";
`researching`, `preparing`, `internal_review`, `submitted`, and
`under_review` for "Pending Applications" (verified directly against
`backend/app/services/grant_service.py`'s `get_dashboard_data`). But the
KPI cards link with only **one** status
(`/grants/applications?status=active`, `?status=submitted`), and GF-27's
fix made `GrantApplicationsPage.tsx` apply that single value as an exact
match. The result: clicking "Active Grants" now shows only `active`
applications, silently excluding `reporting` ones the card's own number
counted — the opposite failure direction from before GF-27 (which showed
everything, a superset; this shows too little, a subset).

**Why flagged instead of fixed:** the correct fix is not mechanical.
`GrantApplicationsPage.tsx`'s status filter is a single-value `<select>`
with no representation for "two statuses at once," so supporting a
multi-status initial filter from the URL means either inventing a new
UI state invisible to the visible dropdown (which then disagrees with
what's actually applied) or adding a synthetic grouped option to the
dropdown itself (a real UI/product decision about how "Active" should be
presented as a filterable concept, not just a KPI label). Guessing at
either changes user-facing behavior beyond what this fix is meant to do.
Flagged rather than built; mirrored into `KNOWN_LIMITATIONS.md`.

**Stopping point for this rotation of Codex review:** this is the third
consecutive round where fixing the previous round's finding surfaced a
new one in the same code (GF-27 → GF-27a in this same round; GF-28/GF-29
were independent). Per this rotation's own convergence rule, this is
where pushing for further reshapes of the same finding stops — GF-27a is
recorded as the stopping point, not chased into a fourth variant.

#### GF-30 — LOW — an unrecognized `?status=` value was silently applied instead of falling back to unfiltered

**What:** Also caught by Codex review, round 5, on both `CampaignsPage.tsx`
and `GrantApplicationsPage.tsx`'s GF-27 fix. A bookmarked or shared URL
carrying a stale or mistyped `status` value (an enum value a later release
removed, a typo) was accepted as-is and sent to the list query, which then
returns zero rows — an unexplained empty list, since the value isn't one
of `STATUS_OPTIONS`/`PIPELINE_COLUMNS` the visible filter UI can display or
explain.

**Where:** `frontend/src/modules/grants-fundraising/pages/CampaignsPage.tsx`,
`frontend/src/modules/grants-fundraising/pages/GrantApplicationsPage.tsx`.

**Fix:** both pages now validate the URL's `status` value against their
own existing whitelist (`STATUS_OPTIONS` / `PIPELINE_COLUMNS` — both
already existed for the dropdown's own options, so this reused rather than
duplicated them) before using it as the initial filter, falling back to
unfiltered (`''`) on no match — the same behavior as no `status` param at
all, rather than a confusing empty result.

**Guard test added:** a third case in `CampaignsPage.statusFilter.test.tsx`
— `?status=archived` (not a real `CampaignStatus`) asserts
`fundraisingService.listCampaigns` is called with `{}`, not
`{ status: 'archived' }`. Verified it fails before the fix and passes
after. `GrantApplicationsPage.tsx`'s identical change was not given its
own dedicated test, for the same proportionality reason GF-27 itself
noted — the module has no render-test harness for that page to extend
without building one from scratch for a few-line change; `tsc --noEmit`
confirms the types, and the logic is identical to the tested
`CampaignsPage` case.

#### GF-31 — MED — `GrantApplicationsPage` filtered by status client-side against a single capped, unfiltered fetch

**What:** Caught by Codex review, round 6, on GF-27's own fix (merged in
PR #2070) — a 4th consecutive finding in this same file's status-filtering
logic, but a genuinely distinct bug from GF-27a, not a reshape of it:
independent of whether a KPI represents one status or several,
`GrantApplicationsPage.tsx` fetched applications **once on mount with no
params** (`listApplications` defaults to `limit: 100` server-side) and
then filtered by status **client-side** against that single capped page.
For an organization with more than 100 grant applications, a
`?status=active` deep link (or the page's own status dropdown) could
silently omit any matching application older than the newest 100 — even
though the dashboard's own KPI count, which queries `COUNT(*)` with no
limit, included it. Unlike GF-27a (which needs a UI/product decision),
this one has a direct mechanical fix: the store's `fetchApplications`
already accepted and forwarded a `status` param to the server
(`grantsStore.ts`); the page just never passed it.

**Where:** `frontend/src/modules/grants-fundraising/pages/GrantApplicationsPage.tsx`.

**Fix:** the mount effect now passes `{ status: statusFilter }` (when set)
to `fetchApplications` and re-fetches whenever `statusFilter` changes
(dropdown or URL), instead of fetching once and filtering client-side.
Removed the now-redundant `matchesStatus` client-side check — every row
the store holds already matches, once the fetch itself is filtered. The
search-text and priority filters are unchanged (still client-side against
the fetched page) — that limitation is pre-existing on this page (present
before GF-27 ever touched it) and shared by every list-style page with a
free-text search in this app; refactoring it is a larger, separate change
not requested by this finding.

**Guard test added:** `GrantApplicationsPage.statusFilter.test.tsx` (new
file, mocks `useGrantsStore` directly). Asserts `fetchApplications` is
called with `{ status: 'active' }` when the URL carries `?status=active`,
and with `undefined` when it carries none. Verified both cases fail
before the fix (the pre-fix mount effect always calls
`fetchApplications()` with zero arguments, matching neither case) and
pass after.

#### GF-32 — MED — GF-31's own fix left the fetch still capped, and introduced a stale-response race

**What:** Caught by Codex review, round 7, on GF-31's own fix. Two
distinct findings, both introduced by GF-31 rather than reshapes of an
earlier one chasing the same code — GF-31 changed _what_ was fetched
(added `status`), these are about _how much_ and _in what order_:

1. **Still capped, just narrower.** Passing `status` server-side moved
   the existing 100-row cap (`listApplications` defaults to `limit: 100`)
   from "newest 100 applications overall" to "newest 100 in the selected
   status." An organization with more than 100 applications in a single
   status still silently loses the older ones — the exact failure GF-31
   set out to fix, in a new shape.
2. **No request sequencing.** `grantsStore.fetchApplications` writes
   every response straight into `applications` with no cancellation or
   ordering. Removing GF-31's client-side `matchesStatus` check means a
   response that resolves out of order (the user switches the status
   filter again, or switches it back, before the first request finishes)
   can silently overwrite the current filter's results with a stale
   filter's rows — invisible to a slow network in dev, real on a flaky
   connection.

**Where:** `frontend/src/modules/grants-fundraising/pages/GrantApplicationsPage.tsx`,
`frontend/src/modules/grants-fundraising/store/grantsStore.ts`.

**Fix:** both are contained, mechanical fixes rather than a redesign, so
fixed rather than flagged despite this being the second consecutive round
on this file — GF-27 → GF-27a was flagged because the correct fix needed
a UI/product decision; neither of these does.

1. The page has no pagination UI at all — the pipeline and table views
   render every row the store holds — so there is no "page 2" for a user
   to reach. The fetch now always passes `limit: 1000`, the backend's own
   ceiling (`PaginationParams.limit`, `le=1000` in
   `app/api/dependencies.py`), instead of leaving it at the 100-row
   default. A department with more than 1000 applications in one status
   is out of scope for this fix, same as it would be for any unpaginated
   list screen in the app.
2. `grantsStore.fetchApplications` now tracks a module-scoped, monotonic
   request counter. Each call captures the counter's value at call time;
   if the counter has moved on by the time the response (or error)
   arrives, the result is dropped instead of written to `applications`.
   Scoped to just this one action — not a store-wide request-cancellation
   redesign, which several other actions could independently need but
   which no evidence here shows they do.

**Guard tests added:**

- `GrantApplicationsPage.statusFilter.test.tsx` — both existing cases
  updated to assert `limit: 1000` is included on every fetch (with and
  without a status filter).
- `grantsStore.applicationsRace.test.ts` (new file) — issues two
  overlapping `fetchApplications` calls with independently-resolvable
  promises, resolves the newer one first, then resolves the older one
  late, and asserts the store still holds the newer result. Verified to
  fail against the pre-fix store (the late response overwrites
  `applications`) and pass after.

### Frontend review (new this pass)

Read `services/api.ts` (410 L), `routes.tsx`, `store/grantsStore.ts` (342 L),
`pages/GrantApplicationFormPage.tsx` (624 L), and `pages/DonationsPage.tsx`
(232 L) in full; `pages/GrantDetailPage.tsx` (1,428 L, the module's largest
and most complex file — budget/expenditure/compliance-task/note modals) in
full through its data-loading, derived-state, and form-submission logic plus
every external-link render site. **Correction (tend pass, 2026-08-30):** this
list omitted `pages/GrantsDashboardPage.tsx` (626 L) entirely — neither read
in full nor swept, caught by Codex review on PR #2069. Now read in full: it
is read-only (a single `fetchDashboard()` call, no create/update/delete
service call anywhere in the file), clean against the same checklist as the
other pages (no `window.confirm`/`alert`/`prompt`, no
`dangerouslySetInnerHTML`, no banned `.toLocale*`/`date-fns` — uses
`formatDate`/`daysUntil` from `dateFormatting.ts` throughout, no direct
`fetch(`), with one permission-gating gap fixed — see GF-23. The remaining
five pages (`GrantOpportunitiesPage.tsx`, `CampaignsPage.tsx`,
`DonorsPage.tsx`, `GrantsReportsPage.tsx`, `GrantApplicationsPage.tsx`) were
swept with the same targeted greps used below rather than read line-by-line;
`CampaignsPage.tsx` (476 L) and `DonorsPage.tsx` (555 L) were additionally
read in full for GF-23 below — noted as partial-scope for the other three,
not assumed clean.

- **Auth wiring (Pitfall #7):** `services/api.ts` builds its axios instance
  via the shared `createApiClient()` factory (`withCredentials: true`, CSRF
  double-submit header, shared-refresh-promise 401 handling) — not a
  hand-rolled instance. No gap.
- **Permission gating:** all 9 routes in `routes.tsx` carry
  `requiredPermission="fundraising.view"` or `"fundraising.manage"`, matching
  the backend string-for-string, plus `requiredModule="grants"`. **This
  correctly describes route-level gating and stopped there — it did not
  check whether the page bodies gate their own manage-only controls, which
  they did not.** See GF-23 (tend pass, below): a `fundraising.view`-only
  user reaching a route that only requires `.view` could still see and
  submit create/edit controls that require `.manage`, hitting a raw 403
  on the ones with no route boundary to catch it first.
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
- **Test coverage:** zero `*.test.ts(x)` files existed anywhere under
  `frontend/src/modules/grants-fundraising/` as of this pass's original
  writeup. **Corrected (tend pass, below):** `GrantsReportsPage.test.tsx`
  now exists, added for GF-26.

No new frontend findings from the pass-2 re-read itself. **Codex review on
PR #2069 subsequently caught GF-22, GF-23, and GF-26 — see "Tend pass —
Codex review response" above.**

### KNOWN_LIMITATIONS.md

GF-7 and GF-8 were already recorded (rows added by pass 1). **GF-9 (float
money math) was not** — added this pass, mirroring the existing two rows'
format. **Tend pass correction:** GF-7's row still described the
already-fixed GF-14 duplicate-compliance-task bug as open — see GF-25 above.

### Guard tests added

Pass 2's original re-read added none (zero backend drift, no new findings
needing a code change) — the existing GF-13/14/15 guard tests
(`test_grant_opportunity_delete_db.py`, `TestComplianceTaskGeneration`,
`TestUpdateBudgetItemSpent`/`TestUpdateCampaignTotal`/`TestUpdateDonorStats`,
the two lock-ordering test classes) were re-run and confirmed still passing
and still enforcing what they were written to enforce. **The tend pass
above added two:** `tests/test_grant_report_date_range_db.py` (3 real-DB
tests, GF-24) and `GrantsReportsPage.test.tsx` (1 test, GF-26) — both
verified to fail before their respective fix and pass after.

## Completion gate (pass 2)

| Check                                                   | Result                                                   |
| ------------------------------------------------------- | -------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                           | 0 violations                                             |
| `black --check app/ tests/ alembic/`                    | 1335 files unchanged                                     |
| `isort --check-only app/ tests/ alembic/`               | clean (isort 8.0.1, already installed)                   |
| `python3 scripts/validate_migrations.py --strict`       | PASSED — 394 revisions, single head                      |
| `python3 -m pytest tests/ -q -k "grant or fundraising"` | 310 passed, 1 pre-existing skip                          |
| `python3 -m pytest tests/ -q` (full suite)              | 9271 passed, 22 pre-existing skips, 0 failed             |
| `npx tsc --noEmit` / `npm run typecheck` (aliased TS 7) | 0 errors                                                 |
| `npx eslint .`                                          | 0 errors, 8 pre-existing warnings, none in touched files |
| `npx vitest run src/modules/grants-fundraising`         | 1 passed (`GrantsReportsPage.test.tsx`, new — GF-26)     |
| `npx vitest run` (full frontend suite)                  | 5498 passed across 418 files, 0 failed                   |

**Tend pass (2026-08-30), in response to Codex's 6 review comments on
PR #2069:** fixed GF-23 (frontend, 4 files), GF-24 (backend, 2 service files

- new integration test file), and GF-26 (frontend, 1 file + new test file);
  corrected the doc for GF-21 and GF-22 (no code change needed — GF-21's code
  was already clean) and `KNOWN_LIMITATIONS.md` for GF-25 (docs only). No
  backend schema or migration change. Numbers above are from a re-run after
  the tend pass, superseding the original pass-2 numbers.

#### GF-33 — round 8: one fixed, one flagged

**What:** Codex review, round 8, on GF-32's own fix (`b43120b8`). Two
findings, both on `GrantApplicationsPage.tsx`'s status-filtering code —
the fourth straight round to find something there, which is itself the
reason for the fix-vs-flag split below.

1. **Stale rows survive a failed refetch (fixed).** GF-31 removed the
   client-side `matchesStatus` predicate on the theory that every row the
   store holds already matches the current filter, since the fetch itself
   is now filtered. That holds only when the fetch _succeeds_. On failure,
   `fetchApplications`'s catch block left the previous `applications`
   array in place while clearing `isLoading` — so switching from one
   nonempty status to another, where the new request fails, rendered the
   _previous_ status's rows underneath the error banner with nothing
   marking them as stale or mismatched. **Fix:** the catch block now also
   sets `applications: []`. Scoped to this one action only — the other
   `fetch*` actions in this store retain their existing failure behavior,
   which was never flagged and is out of scope here.

2. **The `limit: 1000` fetch is still a cap, not full pagination
   (flagged, not fixed).** GF-32's fix moved the ceiling from the
   server's 100-row default to 1000 — Codex correctly points out that is
   still a cap, and `GrantApplicationsPage.tsx` has no pagination UI, so
   an org with more than 1000 applications in a single status would still
   lose data with no indication. This is the point where the finding
   stops being a mechanical patch: implementing real pagination here means
   either (a) building pagination UI for a page whose two views (pipeline
   kanban, sortable table) were both designed to show a full unpaginated
   set, or (b) looping the fetch across `skip`/`limit` pages until
   exhausted, which turns one request into an unbounded number for a
   large org and needs its own loading-state design (a spinner for "page
   3 of 7" is a different UX than the current single fetch). Both are
   real feature work, not a follow-up patch — and this is the fourth
   consecutive round (GF-31 → GF-32 → GF-32's own pagination half → this)
   finding something in the same fetch call. Flagged rather than chased
   into a fifth variant; mirrored into `docs/KNOWN_LIMITATIONS.md` (GF-32a).
   Realistically low-severity in this app's actual context — a single fire
   department accumulating over 1,000 grant applications _in one pipeline
   status_ is not a scenario any department using this software is near.

**Where:** `frontend/src/modules/grants-fundraising/store/grantsStore.ts`
(fix), `frontend/src/modules/grants-fundraising/pages/GrantApplicationsPage.tsx`
(flagged item, unchanged).

**Guard test added:** `grantsStore.applicationsRace.test.ts` gained a
second case — seeds `applications` with a stale row, rejects the next
`fetchApplications` call, and asserts the store ends with an empty array
and a set error. Verified to fail against the pre-fix store (the stale
row survives) and pass after.
