# Security Review — Grants & Fundraising

**Prefix:** `GF` · **Iteration:** 22 · **Reviewed:** 2026-08-26 · **PR:** TBD

**Backend:** `app/api/v1/endpoints/grants.py` (1,883 L, 45 endpoints),
`app/services/grant_service.py` (1,135 L), `app/services/fundraising_service.py`
(651 L), model `app/models/grant.py`.
**Frontend:** not reviewed this pass — backend only, per rotation scope.
**Migrations:** none — GF-13's fix is an ORM-relationship-only change; the
underlying FK/column already existed correctly.

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
**Fix:** added an idempotency guard — a class attribute
`_AUTO_GENERATED_TASK_TYPES` naming this method's three task types, and a
`SELECT COUNT(*)` at the top of the method that returns early if any of them
already exist for the application. Scoped to just those three types (not
"any compliance task") so a task an officer added by hand before the first
award doesn't suppress the auto-generated set. This is a narrow,
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

## Schema & migration notes

None. GF-13's fix is a relationship-attribute change only — the FK/column
were already correct in the schema.

## Guard tests added

- `tests/test_grant_opportunity_delete_db.py` (new, `pytest.mark.integration`)
  — GF-13. Real-DB test: deletes an opportunity with a linked application,
  asserts the application survives with `opportunity_id` set to `None`.
  Modeled on `test_inventory_vendors_db.py`'s pattern — this bug lives
  entirely in how SQLAlchemy's unit-of-work interprets the relationship
  cascade, invisible to a mocked session.
- `tests/test_grant_service.py`:
  - `TestComplianceTaskGeneration::test_skips_regeneration_when_auto_generated_tasks_already_exist`
    — GF-14.
  - `TestUpdateBudgetItemSpent` — GF-15/GF-18: asserts the item lock happens
    before the SUM read, and that a missing/out-of-org item is a no-op that
    never attempts the SUM query.
- `tests/test_fundraising_service.py`:
  - `TestUpdateCampaignTotal` / `TestUpdateDonorStats` — GF-15: asserts the
    parent-row lock happens before the aggregate read, and that a missing
    campaign/donor is a no-op that never attempts the aggregate query.

## Completion gate

| Check                                                              | Result                  |
| ------------------------------------------------------------------ | ----------------------- |
| `flake8` (changed files)                                           | clean                   |
| `black --check` (changed files)                                    | clean                   |
| `isort --check-only` (changed files)                               | clean                   |
| `python3 scripts/validate_migrations.py --strict`                  | PASSED (no migrations)  |
| backend tests, scope (`grant_service` + `fundraising_service`)     | 45 passed               |
| backend tests, integration (`test_grant_opportunity_delete_db.py`) | 1 passed                |
| backend tests, full suite                                          | 8849 passed, 22 skipped |
