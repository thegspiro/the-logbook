# Security Review — Grants & Fundraising

**Prefix:** `GF` · **Iteration:** 22 · **Reviewed:** 2026-08-26 (pass 1),
2026-08-30 (pass 2), 2026-09-05 (pass 3) · **PR:** [#1904](https://github.com/thegspiro/the-logbook/pull/1904)
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

#### GF-31 — MED — a deep-linked status filter only ever searched the first 100 applications, silently missing older matches

**What:** Codex's third comment on the same round-5 review, distinct from
GF-27a/GF-30. `GrantApplicationsPage.tsx`'s mount effect called
`fetchApplications()` with no arguments, and `listApplications` defaults
to `limit: 100`, so every load fetched an **unfiltered** page of at most
100 applications; `statusFilter` was then applied only to that already-
capped, already-fetched set (`filteredApplications`'s `matchesStatus`).
For an organization with more than 100 grant applications, a deep-linked
`?status=active` or pipeline-column link therefore only ever searched the
newest 100 records — any older application matching that status was
invisible, even though the dashboard's own KPI count (and the `active`
pipeline column, which reads the same `applications` array) includes it.

**Where:** `frontend/src/modules/grants-fundraising/pages/GrantApplicationsPage.tsx`
(the mount effect and `filteredApplications`).

**Fix:** `statusFilter` is now passed to `fetchApplications({ status:
statusFilter })`, and the effect re-fetches whenever `statusFilter`
changes, so the backend applies the status match before the 100-row cap
rather than after it. `filteredApplications`'s client-side filtering now
covers only `searchText`/`priorityFilter`. `priorityFilter` has the same
latent shape (also applied client-side, after an unfiltered fetch) but
was not raised by Codex and is left alone here — re-plumbing every filter
through the server in one pass would widen this fix well past what was
reported. `CampaignsPage.tsx` never had this bug: `loadCampaigns` has sent
`statusFilter` to `fundraisingService.listCampaigns` server-side since
GF-27 first seeded it.

**Guard test:** none added. Reproducing the >100-application edge needs
either seeding 100+ applications through the mocked store or a real-DB
integration test, out of proportion for this fix; verified instead by
reading `grantsStore.fetchApplications` → `grantsService.listApplications`,
both of which already accept and forward a `status` param today (used
elsewhere), so this is a call-site change, not new plumbing. Noted as a
coverage gap rather than silently assumed adequate.

**Correction (Codex review of the GF-31 commit itself, 2 more comments) —
see GF-32 and GF-33 below.** Fixing GF-31 introduced one real regression
(a race between two in-flight requests) and left one part of the original
finding only partially closed (the filtered fetch is still capped, just at
a higher ceiling). Both addressed in the same PR.

#### GF-32 — MED, FIXED — GF-31's own refetch-on-change introduced a stale-response race

**What:** Caught by Codex reviewing the GF-31 commit. `fetchApplications`
unconditionally overwrites `useGrantsStore`'s `applications` with whatever
response arrives, and GF-31 made `GrantApplicationsPage.tsx` call it again
every time `statusFilter` changes. If a user changes the status filter a
second time before the first request resolves, and the first (now
superseded) request happens to resolve _after_ the second, its response
overwrites the newer one — the status dropdown reads "Active" but the list
shows "Reporting" applications, with no error. This request race did not
exist before GF-31: the old code fetched exactly once, on mount.

**Where:** `frontend/src/modules/grants-fundraising/store/grantsStore.ts`
(`fetchApplications`).

**Fix:** a module-level, monotonically-increasing request id
(`latestApplicationsRequestId`) is captured at the start of each call; the
response (success or error) is only committed to state if no later call
has started since. `grantsService.listApplications` is the module's only
caller of `fetchApplications`, so this closes the race at its source
rather than adding a guard in the one page that currently triggers it.

**Guard test added:** `grantsStore.fetchApplications.test.ts` (new file).
Starts a request for `status: 'reporting'` whose promise is held open,
starts a second request for `status: 'active'` that resolves immediately,
awaits the second (asserting its result lands), then resolves the first
and awaits it too — asserting the state still reflects the second,
newer request's result. Verified to fail before the fix (the store held
the stale `'reporting'` result) and pass after.

#### GF-33 — LOW-MED, partially fixed / FLAGGED — a status-filtered fetch was still capped, just at a higher ceiling

**What:** Also caught by Codex reviewing the GF-31 commit: fixing "the
filter runs after an unfiltered, 100-capped fetch" (GF-31) did not fix
"the filtered fetch is itself still capped at 100" — `fetchApplications`
called with no explicit `limit` still defaults to 100
(`grantsService.listApplications`), so a single status with more than 100
matching applications is still truncated, just by the filtered query
instead of the unfiltered one.

**Where:** `frontend/src/modules/grants-fundraising/pages/GrantApplicationsPage.tsx`
(the same effect GF-31 added).

**Why only partially fixed:** this page has no pagination control in
either view (pipeline or table) — its whole design assumes the org's
complete application set is loaded at once, for both the filtered and
unfiltered case. That assumption pre-dates GF-31 (the unfiltered mount
fetch was _always_ capped at 100, for any organization with more than 100
applications total, regardless of status) and is out of proportion for
this fix to redesign. **Partial mitigation applied:** the fetch now
requests `limit: 1000` — the backend's own declared ceiling
(`PaginationParams`'s `le=1000` in `app/api/dependencies.py`, ten times
the previous 100) — for both the filtered and unfiltered load, meaningfully
raising the practical threshold without inventing a new limit or changing
the page's data model. **Still open:** an organization with more than 1000
applications sharing one status (or more than 1000 applications overall,
for the unfiltered pipeline/table view) will still truncate silently.
Closing that fully needs either paging through the complete result set or
a page-size control this page was never built with — a larger change,
flagged rather than guessed at here, and mirrored into
`KNOWN_LIMITATIONS.md`.

#### GF-34 — MED, FIXED — a failed status-filtered fetch left the previous filter's rows on screen

**What:** Caught by Codex reviewing the GF-32/GF-33 commit. GF-31 removed
`filteredApplications`'s client-side `matchesStatus` check (the status
match now happens server-side), but `fetchApplications`'s `catch` branch
left `applications` untouched on a failed request — so if a status-filtered
fetch fails (network error, 500), the page keeps showing whatever rows the
_previous_ filter had loaded, now silently mismatched with the dropdown's
new selection, alongside the error banner. Before GF-31 this was
impossible: the client-side status check would have hidden any row not
matching the current filter regardless of what `applications` held.

**Where:** `frontend/src/modules/grants-fundraising/store/grantsStore.ts`
(`fetchApplications`'s `catch` branch).

**Fix:** the `catch` branch now clears `applications` to `[]` alongside
setting `error`, rather than leaving the prior fetch's rows in place — a
failed request shows an empty list plus the error banner, never rows that
belong to a filter the user has since changed away from.

**Guard test added:** a second case in
`grantsStore.fetchApplications.test.ts` — seeds the store with rows from
one status, fails a fetch for a different status, and asserts the store
ends up with an empty list and the error set. Verified to fail before the
fix (the seeded rows survived the failed fetch) and pass after.

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

**Tend pass, round 5 (2026-08-30, PR #2070), in response to Codex's 3
review comments on the round-4 commit (`e6cf9b5b`):** fixed GF-30 (status
whitelist validation, `CampaignsPage.tsx` + `GrantApplicationsPage.tsx`,
new guard-test case) and GF-31 (server-side status filtering to avoid the
100-record fetch cap, `GrantApplicationsPage.tsx`); flagged GF-27a
(KPI-card aggregate-vs-single-status mismatch) as a product decision and
mirrored it into `KNOWN_LIMITATIONS.md`. No backend files touched. Gate
re-run, scoped to what changed (frontend-only, matching this round's own
diff):

| Check                                           | Result                                                            |
| ----------------------------------------------- | ----------------------------------------------------------------- |
| `npx tsc --noEmit`                              | 0 errors                                                          |
| `npx eslint src/modules/grants-fundraising`     | 0 errors, 0 warnings                                              |
| `npx vitest run src/modules/grants-fundraising` | 3 files, 5 passed (`CampaignsPage.statusFilter.test.tsx` +1 case) |

**Tend pass, round 6 (2026-08-30, PR #2073), in response to Codex's 2
review comments on the GF-31 commit:** fixed GF-32 (a stale-response race
GF-31's own refetch-on-change introduced, `grantsStore.ts`, new guard test
`grantsStore.fetchApplications.test.ts`) and partially fixed/flagged GF-33
(the filtered fetch was still capped at 100 — raised to the backend's own
declared max of 1000 in `GrantApplicationsPage.tsx`; true unbounded
pagination remains open, mirrored into `KNOWN_LIMITATIONS.md`). No backend
files touched. Gate re-run:

| Check                                           | Result               |
| ----------------------------------------------- | -------------------- |
| `npx tsc --noEmit`                              | 0 errors             |
| `npx eslint src/modules/grants-fundraising`     | 0 errors, 0 warnings |
| `npx vitest run src/modules/grants-fundraising` | 4 files, 6 passed    |

**Tend pass, round 7 (2026-08-30, PR #2073), in response to Codex's 1
review comment on the GF-32/GF-33 commit:** fixed GF-34 (a failed
status-filtered fetch left the previous filter's rows on screen,
`grantsStore.ts`, new guard-test case in
`grantsStore.fetchApplications.test.ts`). No backend files touched. Gate
re-run:

| Check                                           | Result               |
| ----------------------------------------------- | -------------------- |
| `npx tsc --noEmit`                              | 0 errors             |
| `npx eslint src/modules/grants-fundraising`     | 0 errors, 0 warnings |
| `npx vitest run src/modules/grants-fundraising` | 4 files, 7 passed    |

**Tend pass, round 8 (2026-08-30, PR #2073), in response to Codex's 2
comments on the GF-34 commit:** one re-raise, one new, non-security
finding on this rotation's own test code.

- **GF-33, re-raised (no code change beyond round 6's):** Codex flagged
  the round-6 `limit: 1000` bump itself as evidence the pagination gap is
  "unresolved rather than fixed." Correct, and already the documented
  disposition — GF-33's own write-up (round 6, above) states plainly that
  1000 is a partial mitigation, not a fix, and that full pagination is
  flagged in `KNOWN_LIMITATIONS.md`, not built. No further code pushed for
  this thread; replied on the PR pointing to the existing GF-33 entry.
  This is this thread's convergence-stop point, the same shape as GF-27a
  earlier in this same PR chain: the fix already ships the best available
  mitigation and states its own remaining limit, so re-litigating it
  without a page-size UI or real pagination (a design decision, not a
  drive-by patch) would not change the outcome.
- **Fixture cast (P1, code-quality, fixed, no GF id — not a security or
  correctness finding):** the new `application()` test helper in
  `grantsStore.fetchApplications.test.ts` (added round 6) used
  `({...}) as unknown as GrantApplication`, the exact pattern AGENTS.md
  prohibits ("add broad `any`, `unknown`, ... merely to silence errors") —
  it would have suppressed a real type error from any future required
  field added to `GrantApplication` that this fixture doesn't set.
  Rewritten as a fully, honestly-typed `GrantApplication` fixture with
  every field given a concrete default; only `id` and `applicationStatus`
  vary per call. No behavior change — both existing tests (GF-32, GF-34)
  still pass unmodified.

No backend files touched. Gate re-run:

| Check                                           | Result               |
| ----------------------------------------------- | -------------------- |
| `npx tsc --noEmit`                              | 0 errors             |
| `npx eslint src/modules/grants-fundraising`     | 0 errors, 0 warnings |
| `npx vitest run src/modules/grants-fundraising` | 4 files, 7 passed    |

---

## Pass 3 (2026-09-05)

**Backend:** `app/api/v1/endpoints/grants.py` (1,897 L, 45 endpoints),
`app/services/grant_service.py` (1,235 L), `app/services/fundraising_service.py`
(765 L), `app/models/grant.py`, `app/schemas/grant.py`,
`app/services/dashboard_widget_service.py` (its `fundraising()` method only,
per pass 2's GF-21 scope correction).
**Frontend:** `frontend/src/modules/grants-fundraising/` (all 8 pages,
services, store, routes, types) — diff-scoped, not re-read line-by-line; see
"Diff-scoping methodology" below for why a full re-read was not repeated.
**Migrations:** none touching a grants/fundraising table since pass 2's merge.

### Diff-scoping methodology

Per this pass's instructions, the pass-2 merge commit was verified reachable
from `HEAD` **before** trusting it as a diff base — this rotation was
explicitly burned once already (Feature 21) for asserting a diff was
"unreachable" without checking. The repository arrived shallow-cloned;
`git merge-base --is-ancestor <sha> HEAD` on the shallow history could not
even resolve the pass-2 merge sha (`fatal: Not a valid object name`), which
is a different failure mode than "not an ancestor" and must not be treated as
one. `git fetch --unshallow origin` was run first; afterward
`git rev-parse --is-shallow-repository` returned `false` and
`git merge-base --is-ancestor d7a0c456 HEAD` exited `0` (`d7a0c456` — PR
#2073's merge, closing pass 2 per `PROGRESS.md`'s 2026-08-30 log entry).

With reachability confirmed, `git diff d7a0c456 HEAD --stat` against every
declared backend file (`grants.py`, `grant_service.py`,
`fundraising_service.py`, `grant.py`, `schemas/grant.py`,
`dashboard_widget_service.py`) and against
`frontend/src/modules/grants-fundraising/` came back **empty — byte-identical**
to pass 2's merged state. `git diff d7a0c456 HEAD --name-only` (1,348 changed
files across the whole repo, all other features' 876 commits) was then
grepped for `grant|fundrais|donor|donation|campaign|pledge` to catch drift
outside the declared file list: the only hits were unrelated —
seeded-_permission_-grant migrations and their tests
(`restore_seeded_position_grants`, `repair_wizard_overwritten_baseline_grants`,
`emt_seeded_grant_restoration`, etc. — CLAUDE.md Pitfall #23's "grant" meaning
a permission grant on a position, not this module) and training
documentation/screenshots. Confirmed by reading the migrations' actual
content (not filename): none add `fundraising.view`/`fundraising.manage` to
`DEFAULT_POSITIONS["member"]` or `"firefighter"` — every role touched is an
officer/leadership position (`fire_chief`, `treasurer`, `president`,
`fundraising_chair`, etc.), consistent with this module's existing baseline.
Independently re-confirmed directly against the current
`app/core/permissions.py`: `"fundraising"` does not appear anywhere in the
`member` or `firefighter` `DEFAULT_POSITIONS` entries.

**Conclusion: zero code drift in this module since pass 2's merge.** This
pass is a full independent re-verification of unchanged code (not a diff
review) plus a fresh, from-scratch endpoint enumeration and checklist sweep,
per this pass's own instructions to enumerate rather than spot-check.

### Re-verification of pass-1/pass-2 fixes

Read the current `grants.py`, `grant_service.py`, `fundraising_service.py`,
`grant.py`, and `schemas/grant.py` in full (not re-cited from either prior
doc) and confirmed every fix is intact at its current line:

- **GF-13** (opportunity→application cascade/`ondelete` mismatch) —
  `GrantOpportunity.applications` still carries no cascade and
  `passive_deletes=True` (`app/models/grant.py:332`).
- **GF-14 / Codex P2** (idempotent compliance-task generation) —
  `_generate_compliance_tasks` still checks the dedicated
  `compliance_tasks_generated` boolean first (`grant_service.py:384-386`), not
  a `task_type` query.
- **GF-15 / Codex P1** (locked aggregate recomputes, parent-lock-before-child-
  flush ordering) — `_update_budget_item_spent`, `_update_campaign_total`, and
  `_update_donor_stats` all still lock the parent row first and make the SUM
  itself a locking read; `_lock_budget_item`/`_lock_campaign`/`_lock_donor` are
  still called before the child row is added/flushed in both create and
  update paths, for old and (if reassigned) new parents.
- **GF-16** (`apply_updates` instead of blind `setattr`) — all ten update
  methods (`update_opportunity`, `update_application`, `update_budget_item`,
  `update_expenditure`, `update_compliance_task`, `update_campaign`,
  `update_donor`, `update_donation`, `update_pledge`,
  `update_fundraising_event`) still route through `apply_updates`.
- **GF-17** (`_notes_with_authors`' `User` lookup org filter) — still filters
  `organization_id` (`grants.py:254`).
- **GF-18** (`_update_budget_item_spent`'s org-scoped budget-item fetch) —
  still joins through `GrantApplication` and filters `organization_id`.
- **GF-24 / GF-24a** (end-of-day report boundary) — `get_grant_report`,
  `get_fundraising_report`, and `list_donations` all still build the upper
  bound with `datetime.combine(end_date, datetime.max.time(),
tzinfo=timezone.utc)`; the hard-coded-UTC limitation (GF-24a) is unchanged
  and still correctly flagged, not fixed, per pass 2's reasoning.
- **GF-26** (fundraising report `donations_by_method` string-concatenation
  bug) — `GrantsReportsPage.tsx` frontend fix unchanged (diff-confirmed).
- **GF-27 through GF-34** (dashboard KPI links, status-filter whitelisting,
  server-side status filtering, the resulting stale-response race, and the
  failed-fetch-leaves-stale-rows bug) — all unchanged (diff-confirmed); no
  re-read needed beyond the byte-identical diff check, since none of these
  touch backend code this pass re-read line-by-line anyway.
- **GF-19/GF-20/GF-21/GF-22/GF-23/GF-25** (doc-accuracy corrections and the
  `dashboard_widget_service.py` scope gap) — the corrected doc text itself
  re-read and still accurate; `DashboardWidgetService.fundraising()` re-read
  in full again this pass (see below).

### Fresh endpoint enumeration (not a re-count)

Ran `grep -c "^@router\."` and `grep -c 'require_permission("fundraising'`
independently against the current file rather than trusting the prior
passes' "45/45" figure: both commands return **45**, and a third check
(`awk` pairing each `@router.` decorator with its following `async def`)
also returns 45 — no route lacks a decorator-adjacent handler. Every one of
the 45 carries `Depends(require_permission("fundraising.view"))` or
`Depends(require_permission("fundraising.manage"))` — no route with a bare
`Depends(get_current_user)` or no auth dependency at all. Spot-checked the
HTTP-verb-to-permission mapping across all 45 (not sampled): every `GET` is
`.view`, every `POST`/`PUT`/`DELETE` is `.manage`, with no exceptions —
matching Checklist §2's "permission string matches the sensitivity of the
data" with no XC-2-shaped gap. Re-confirmed via `core/permissions.py` that
neither string appears in the `member`/`firefighter` baseline (Pitfall #23 —
see "Diff-scoping methodology" above).

`DashboardWidgetService.fundraising()` (`dashboard_widget_service.py:146-203`)
re-read in full again (GF-21's own scope gap, corrected in pass 2): still
gates behind both `"grants" in enabled_modules` and
`user_has_permission(current_user, "fundraising.view")`, still filters
`organization_id` from `current_user` on every one of its four direct model
queries including both sides of the `Donation`⋈`FundraisingCampaign` join.

### New this pass

#### GF-35 — LOW-MED — every list endpoint fetched the entire org-wide table into memory before slicing in Python — ✅ FIXED

**What:** all 11 `list_*` service methods (`list_opportunities`,
`list_applications`, `list_budget_items`, `list_expenditures`,
`list_compliance_tasks`, `list_notes` in `grant_service.py`; `list_campaigns`,
`list_donors`, `list_donations`, `list_pledges`, `list_fundraising_events` in
`fundraising_service.py`) built their `SELECT` with every declared filter and
an `ORDER BY`, but **no `LIMIT`/`OFFSET`** — the endpoint layer then took a
`pagination.skip`/`pagination.limit` from the client and applied it as a
**Python list slice** (`results[pagination.skip : pagination.skip +
pagination.limit]`) _after_ the full result set had already been fetched
from MySQL and materialized into application memory. `PaginationParams`
itself (`app/api/dependencies.py:28-53`) exists precisely to be threaded into
the query as `.offset(skip).limit(limit)` — its own docstring shows that
usage — but none of the 11 call sites did.

This is Checklist §6 ("List endpoints and exports are bounded — no `all()`
over an org-wide table") for seven of the eleven (`opportunities`,
`applications`, `campaigns`, `donors`, `donations`, `pledges`,
`fundraising-events` are org-wide, unbounded by any parent); the remaining
four (`budget-items`, `expenditures`, `compliance-tasks` when filtered by
`application_id`, `notes`) are naturally bounded by their parent application
in ordinary use, but `list_compliance_tasks` can also be called **unfiltered**
across the whole org (`GET /compliance-tasks` with no `application_id`), so
it carries the same org-wide exposure as the first seven.

**Where:** `app/services/grant_service.py` (6 methods),
`app/services/fundraising_service.py` (5 methods),
`app/api/v1/endpoints/grants.py` (all 11 corresponding endpoints).

**Failure scenario:** a fire department that has used this module for years —
thousands of donations, a large historical donor roster, or a long-running
grant-application pipeline — pays the full table-scan-and-materialize cost
on **every single page view** of any list screen, including the very common
case of viewing just the first page. This is a resource-exhaustion /
availability concern rather than a data-exposure one (`organization_id` is
still filtered correctly on every query, so this is not a cross-tenant leak):
memory pressure and query latency scale with the org's total historical row
count, not with the page size actually being displayed, and a large org's
list pages get slower over time even though nothing about the request
changed. It was not previously flagged: GF-31/32/33 (pass 2, round 5-6)
addressed a related but distinct problem — the frontend's own effective
fetch ceiling and a stale-response race — without examining how the backend
serviced that fetch once it arrived.

**Fix:** every one of the 11 `list_*` service methods now accepts
`skip: int = 0, limit: int = 100` (matching `PaginationParams`' own
defaults) and applies `.offset(skip).limit(limit)` in SQL, after the
existing `ORDER BY`. The 11 corresponding endpoints in `grants.py` now pass
`skip=pagination.skip, limit=pagination.limit` straight through and return
the service result directly, with the Python slice removed. Verified no
other backend caller of any of the 11 methods exists (only `grants.py`'s
own endpoints call them; two test files call `list_notes`/`list_donations`
with fewer than the default `limit=100` rows, so the new default does not
change their outcome).

Codex review on this PR raised three follow-up findings against the first
cut of this fix, all confirmed and fixed in the same PR before merge:

1. **Non-deterministic pagination.** None of the 11 `ORDER BY` clauses had a
   unique tie-breaker, so tied rows (null deadlines, identical donor names,
   same-day expenditures) could be ordered differently between two
   `LIMIT`/`OFFSET` executions of the same query, duplicating or dropping
   rows across pages. Every one of the 11 `ORDER BY` clauses now ends with
   the model's own `id.asc()` as the final term, added after the existing
   sort key(s) — the existing ordering is otherwise unchanged.
2. **`list_budget_items`/`list_expenditures`/`list_notes` still eager-loaded
   their parent's full child history.** These three resolved their parent
   application by calling `get_application()` purely as an existence/org-scope
   check, but `get_application()`'s loader options (`selectinload` on
   budget_items, expenditures, compliance_tasks, grant_notes, opportunity)
   materialize every child row on the application regardless of the page
   size requested — defeating the pagination fix for exactly these three
   routes. Replaced with a new `_application_in_org()` helper that runs a
   bare `select(GrantApplication.id).where(id ==, organization_id ==)` with
   no loader options, raising the same `ValueError("Application not
   found")` as before when it finds nothing. `get_application()` itself is
   unchanged and still used by callers that need the full eager-loaded
   object (`update_application`, `delete_application`, `create_budget_item`,
   etc.).
3. **`list_applications` itself still carried `selectinload` for
   `budget_items`/`compliance_tasks`.** Distinct from #2 above — this is the
   list query's own eager loaders, not a parent-existence check. Those
   loaders issue their own follow-up query fetching every child row for
   every application on the page, unbounded by the page's `LIMIT`, and
   `GrantApplicationListResponse` (this route's response model) serializes
   neither collection. Both `selectinload` options were removed from
   `list_applications()`'s query; `get_application()`'s eager loads (used by
   the single-record fetch, whose response model does serialize both
   collections) are untouched.

**Guard tests added:** `TestListPagination` in both `test_grant_service.py`
(11 cases: skip/limit application for `list_opportunities`,
`list_applications`, `list_compliance_tasks`, `list_budget_items`; the
bounded-default case for `list_opportunities`; and an id-tie-breaker
ordering assertion for all 6 of that file's `list_*` methods) and
`test_fundraising_service.py` (11 cases: skip/limit application and the
id-tie-breaker assertion for all 5 of that file's `list_*` methods, plus
the bounded-default case for `list_campaigns`). Each captures the compiled
statement (mocked session, `mysql.dialect()`, `literal_binds=True`) and
asserts the exact `LIMIT <offset>, <count>` clause MySQL's dialect renders
(there is no separate `OFFSET` keyword in MySQL's syntax — verified
empirically before writing the assertions, since an `OFFSET n LIMIT m`-shaped
assertion would have silently never matched). Verified fail-before/pass-after
by temporarily reverting the `.offset(skip).limit(limit)` line in
`list_opportunities` alone: both of that method's new tests failed with the
un-limited compiled SQL shown in the assertion diff, confirming the guard
actually exercises the fix rather than passing vacuously; re-applied
immediately after confirming.

Follow-up findings #2 and #3 above have their own guard tests:
`TestListDoesNotEagerLoadParent` (4 cases — `list_budget_items`,
`list_expenditures` and `list_notes` each asserting `get_application` is
never called, plus one compiling `_application_in_org()`'s query and
asserting none of the four child table names appear in it) and
`TestListApplicationsDoesNotEagerLoadChildren` (1 case, asserting neither
`budget_items` nor `compliance_tasks` appears in `list_applications()`'s
compiled loader options) in `test_grant_service.py`. Two more
foreign-application-rejection cases (`list_budget_items`,
`list_expenditures`) were added alongside the existing `list_notes` one to
confirm the org-scoping guarantee (Pitfall #14) survived the swap from
`get_application()` to `_application_in_org()`.

### Re-confirmed still open (unchanged, per every prior pass)

- **GF-7** (state-machine/overspend guards) — `update_application` still has
  no transition guard; no overspend check exists anywhere in
  `create_expenditure`/`update_expenditure`. Unchanged, still a product
  decision.
- **GF-8** (`is_anonymous` not enforced) — `DonationResponse`/`DonorResponse`
  (`schemas/grant.py`) still serialize donor identity unconditionally; no
  `model_validator` or permission-context suppression exists. Unchanged,
  staff-only exposure (re-confirmed: no `api/public/` surface reads either
  model), still a product decision.
- **GF-9** (float money math in both report methods) — `get_grant_report`
  and `get_fundraising_report` still accumulate `sum(float(...) for ...)`
  rather than `Decimal`. Unchanged, still a deliberate-refactor decision.
- **GF-27a** (dashboard KPI multi-status aggregate vs. single-status link) —
  unchanged; still needs a filter-UI product decision, already in
  `KNOWN_LIMITATIONS.md`.
- **GF-33** (applications page still caps at 1,000 total, no real
  pagination UI) — unchanged by GF-35 above: GF-35 fixes _how efficiently_
  the backend computes a capped page (SQL `LIMIT` instead of fetching
  everything and slicing), not _whether_ the frontend's own 1,000-row
  request ceiling still truncates a larger org's result set. The frontend
  still requests `limit: 1000` and still has no pagination control; that
  remains open exactly as GF-33 describes it, already in
  `KNOWN_LIMITATIONS.md`.

### Guard tests added

29 new/changed cases total, GF-35 (described above): `TestListPagination`
(11 in `test_grant_service.py`, 11 in `test_fundraising_service.py`),
`TestListDoesNotEagerLoadParent` (4) and
`TestListApplicationsDoesNotEagerLoadChildren` (1) in
`test_grant_service.py`, plus 2 new foreign-application-rejection cases in
`test_grant_service.py`.

### Completion gate (pass 3)

| Check                                                   | Result                                         |
| ------------------------------------------------------- | ---------------------------------------------- |
| `flake8 app/ tests/ alembic/`                           | 0 violations                                   |
| `black --check app/ tests/ alembic/`                    | 1,477 files unchanged                          |
| `isort --check-only app/ tests/ alembic/`               | clean                                          |
| `python3 scripts/validate_migrations.py --strict`       | PASSED — 422 revisions, single head            |
| `python3 -m pytest tests/ -q -k "grant or fundraising"` | 495 passed, 1 pre-existing skip                |
| `python3 -m pytest tests/ -q` (full suite)              | 10,903 passed, 21 pre-existing skips, 0 failed |
| `npx tsc --noEmit`                                      | 0 errors                                       |
| `npx eslint .`                                          | 0 errors, 0 warnings                           |

No frontend files were touched this pass (diff-confirmed zero drift, and no
new frontend finding), so no `vitest` run is reported separately from the
full-suite gate above.
