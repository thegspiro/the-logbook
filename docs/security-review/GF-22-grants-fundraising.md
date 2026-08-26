# Security Review — Grants & Fundraising

**Prefix:** `GF` · **Iteration:** 22 · **Reviewed:** 2026-08-26 · **PR:** #1904

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
- No SQL injection; `SafeCsvWriter` used for exports, not raw `csv.writer`.
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
the new parent) ahead of the child flush. `delete_donation`/
`delete_expenditure` were not affected — a DELETE on the child never takes a
lock on the FK's parent.

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
| backend tests, full suite                                          | 8849 passed, 22 skipped |
