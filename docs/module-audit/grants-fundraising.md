# Module Audit — Grants & Fundraising

**Files:** `app/api/v1/endpoints/grants.py` (1,842 L, 45 endpoints),
`app/services/grant_service.py` (969 L), `app/services/fundraising_service.py`
(512 L), model `app/models/grant.py`, frontend `modules/grants-fundraising`.
Handles money: grant applications/awards, budget items, expenditures, donation
campaigns, donations, pledges.
**Audited:** iteration 14 (tenant isolation, cross-tenant financial writes,
financial-integrity correctness, donor PII).

## Verified good ✅
- **Auth coverage:** all 45 endpoints gated on `fundraising.view` / `.manage`;
  no public/donation surface.
- **Direct-object tenant isolation:** every by-id read/update/delete is
  org-scoped (direct filter or JOIN to the org-owned parent) — no read-side IDOR.
- **Stored money uses `Decimal`** correctly in the running-total helpers;
  schema money fields are `Field(ge=0)` (negatives rejected).
- No raw SQL, no PK-bypass, flake8 clean, no TODO.

## Findings

### GF-1 — CRITICAL — Cross-tenant financial corruption via donation FKs — ✅ FIXED
`create_donation` / `update_donation` set `organization_id` server-side but
accepted client-supplied `campaign_id` / `donor_id` **without an org check**,
then called `_update_campaign_total` / `_update_donor_stats`, which fetched the
campaign/donor **by id only (no org filter)** and **overwrote** their totals —
and summed donations by `campaign_id`/`donor_id` with no org filter. An org-A
`fundraising.manage` user posting (or repointing) a donation with org-B's
`campaignId`/`donorId` silently inflated/corrupted org-B's campaign progress and
donor lifetime-giving records.
**Fix:** validate `campaign_id` / `donor_id` are in-org (new `_entity_in_org`
helper) on create and on reassignment; and org-scoped both recompute helpers
(the aggregate sum **and** the parent fetch/write now filter `organization_id`).

### GF-2 — HIGH — Cross-tenant budget corruption via expenditure `budget_item_id` — ✅ FIXED
`create_expenditure` / `update_expenditure` verified the parent application
in-org but stored a client-supplied `budget_item_id` unchecked; then
`_update_budget_item_spent` fetched the budget item by id only and wrote its
`amount_spent` / `amount_remaining`. An expenditure under an org's own grant, but
with a `budgetItemId` pointing at another org's budget line, corrupted that
line's spend figures.
**Fix:** validate `budget_item_id` belongs to the (already org-verified) parent
application (`_budget_item_in_application`) on create and on reassignment.

### GF-3 — HIGH (correctness) — Donations without explicit `payment_status` dropped from totals — ✅ FIXED
Endpoints pass `model_dump(exclude_unset=True)`, so an omitted `payment_status`
(schema default `"completed"`) is not in `data`; the column's `server_default`
only materializes in the DB, so the in-memory row's `payment_status` was `None`.
The `== COMPLETED` guard was then `False` and the campaign/donor totals were
**never updated**, silently understating reality until a later write triggered a
recompute.
**Fix:** normalize `payment_status` to `COMPLETED` on the in-memory row when
omitted, so the guard sees the effective value.

### GF-4 — MEDIUM — Cross-org opportunity leak via application `opportunity_id` — ✅ FIXED
`create_application` / `update_application` stored a client-supplied
`opportunity_id` unchecked. It is eager-loaded into the application response and
read by `_generate_compliance_tasks` (`opportunity.category`), so a foreign
`opportunityId` leaked another org's opportunity fields back in the response and
drove task generation.
**Fix:** validate `opportunity_id` is in-org (`_opportunity_in_org`) on create
and update.

### GF-5 — LOW — Unescaped LIKE wildcards in donor / opportunity search — ✅ FIXED
`list_donors` / `list_opportunities` built `f"%{search}%"` and passed it to
`.ilike()` with no wildcard escaping (not injection — parameterized — but `%`/`_`
acted as wildcards). **Fix:** escape `\`/`%`/`_` and declare `escape="\\"`.

### GF-6 — MEDIUM (flagged) — Remaining unvalidated cross-org FKs (stored-only)
`create_pledge`/`update_pledge` (`campaign_id`, `donor_id`),
`create_fundraising_event`/`update` (`campaign_id`, `event_id`),
`update_application` (`linked_campaign_id`), and `assigned_to` / `approved_by`
user ids are stored without in-org validation. None drive a cross-org
recompute-write or read-leak (unlike GF-1/2/4), so they're dangling/mis-attributed
FKs. **Status:** flagged (XC-1) — close with the shared `assert_in_org` helper.

### GF-7 — MEDIUM (flagged) — No financial state-machine / overspend guards
No path checks total expenditures against `amount_awarded` / `amount_budgeted`
(`amount_remaining` can go negative); `update_application` applies any
status/amount change with no transition guard (a CLOSED/AWARDED grant stays fully
editable); an `awarded → active → awarded` round-trip **regenerates a duplicate**
full set of compliance tasks. **Status:** flagged — needs a product-defined
state machine.

### GF-8 — MEDIUM (flagged) — `is_anonymous` flag never enforced in responses
`DonationResponse` / `DonorResponse` always serialize `donor_name`/`donor_email`/
`donor_id`/`amount` regardless of `is_anonymous`; `get_dashboard_data`
recent-donations returns donor-identified rows to any `fundraising.view` user.
No public surface, so staff-only — but the anonymity flag carries no effect.
**Status:** flagged — decide whether to suppress donor identity on anonymous
gifts for `view` (vs `manage`).

### GF-9 — LOW (flagged) — Float money math in reports; zero/unbounded amounts; donor-PII gate breadth
Report/dashboard aggregation accumulates via `float()` before coercing back to
`Decimal` (prefer summing in `Decimal`); money fields accept `0` and have no
upper cap; `list_donors`/`get_donor` expose full donor PII to `fundraising.view`
(policy question). **Status:** flagged.

## Notes
- GF-1/GF-2/GF-4 are the **XC-1/XC-3 pattern with real cross-tenant impact** —
  unvalidated FKs feeding recompute helpers that fetch-and-write by id. The
  `_entity_in_org` / `_budget_item_in_application` / `_opportunity_in_org` helpers
  added here are local instances of the shared `assert_in_org` (CROSS-CUTTING XC-1).
