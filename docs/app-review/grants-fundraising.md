# Application Review — Grants & Fundraising (Tier B)

**Prefix:** `GF2` · **Iteration:** B14 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-08 (pass 2)

**Backend:** `endpoints/grants.py` (1,842 L, 45 endpoints), `services/grant_service.py`
(1,000 L), `services/fundraising_service.py` (540 L), model `models/grant.py`
**Frontend:** `modules/grants-fundraising`
**Prior audit:** `docs/module-audit/grants-fundraising.md` (iteration 14) — GF-1
(CRITICAL), GF-2/3 (HIGH), GF-4/5 fixed; GF-6 (remaining unvalidated FKs), GF-7
(state machine), GF-8 (anonymity), GF-9 (float/PII) left open.

---

## Pass 2 (2026-08-08) — six-lens sweep

Re-verified the pass-1 GF-6 FK validations all hold (`_validate_pledge_fks`,
`_validate_fundraising_event_fks`, `_validate_application_fks` invoked on both
create and update; GF-1/2/4 recompute-write scoping intact). The systematic
six-lens sweep then surfaced **three fixes**, all in `grant_service.py`'s
compliance-task paths — a corner the finding-focused pass-1 didn't reach.

### GF-10 — MED — Awarding a grant with a client-set `reporting_frequency` 500s — ✅ FIXED

`update_application` applies the client payload via a blind `setattr` loop, then
(when status→`awarded`) calls `_generate_compliance_tasks` **before any refresh**,
so `application.reporting_frequency` is still the plain `str` the schema handed in
(a `Literal[...]` union, not the enum). Line 379 already read it safely via
`_status_value(...)`, but the report **description** one line down still did
`application.reporting_frequency.value` → `AttributeError` on a `str` → uncaught
`500` (the endpoint's `except ValueError` doesn't catch it). A single PUT setting
`application_status=awarded` + `reporting_frequency=monthly` + start/end dates
triggered it. **Fix:** route line 390 through `_status_value(...)` too. 1
regression test (plain-str frequency renders 3 quarterly reports, no crash).

### GF-11 — MED — Completing a compliance task with a client-set `task_type` 500s — ✅ FIXED

Same shape in `update_compliance_task`: after the blind `setattr` loop, the
completion-note metadata read `task.task_type.value` (`GrantComplianceTaskUpdate`
exposes `task_type` as a `Literal`, so it's a plain `str` post-assign). Marking a
task `completed` and setting `task_type` in the same PUT → `AttributeError` →
`500`, **after** the row already mutated. **Fix:** `_status_value(task.task_type)`.
1 regression test (complete with plain-str `task_type` adds the note, no crash).

### GF-12 — LOW — `update_compliance_task` stored a client `assigned_to` unvalidated (XC-1) — ✅ FIXED

`GrantComplianceTaskUpdate.assigned_to` is a client FK to `users.id`, applied by
the blind `setattr` loop with no in-org check — while the sibling
`_validate_application_fks` validates the application's own `assigned_to`. No
read-leak (only the UUID is projected) and `ondelete="SET NULL"`, hence LOW, but
the standard XC-1 shape: a cross-org user id could persist as the assignee.
**Fix:** an `assert_in_org(User, data.get("assigned_to"), org, allow_none=True)`
guard before the mutation, matching the application path. 1 regression test
(foreign `assigned_to` → `ValueError` → 400).

**Flagged (unchanged):** GF-7 (grant state machine / overspend), GF-8
(`is_anonymous` not enforced in responses), GF-9 (float money / PII gate breadth)
stand in `KNOWN_LIMITATIONS.md`. Lenses 2 (projection read-leak), 3 (cross-org
by-id — every sub-resource resolves through an org-scoped `GrantApplication`
join), 4 (`*_name` are real stored columns, not join-derived), and 5 (cross-module
`event_id` already validated) were clean.

---

## Pass 1 (2026-08-06)

## Scope

Tier B: the open findings. The CRITICAL/HIGH cross-tenant financial-corruption
paths (GF-1/2/4 — unvalidated FKs feeding recompute-writes and read-leaks) were
already closed and re-confirmed. This pass closed the remaining XC-1 FKs (GF-6)
and re-assessed the product-decision items.

## Findings

### GF-6 — MEDIUM — Remaining unvalidated cross-org FKs (stored-only) — ✅ FIXED

Five write paths stored a client-supplied FK without an in-org check. Unlike
GF-1/2/4, none feed a cross-org recompute-write or read-leak, so the impact was a
dangling/mis-attributed FK — but this is exactly the XC-1 pattern the codebase is
standardizing on `assert_in_org` for. Closed all five:

- **`create_pledge` / `update_pledge`** — `campaign_id` (FundraisingCampaign) and
  `donor_id` (Donor) now validated in-org via the module's `_entity_in_org` helper
  (new `_validate_pledge_fks`), matching the donation path.
- **`create_fundraising_event` / `update_fundraising_event`** — `campaign_id`
  (FundraisingCampaign) and `event_id` (calendar `Event`) validated
  (`_validate_fundraising_event_fks`). The `event_id` case is the strongest of the
  five: a fundraiser links to a calendar event, so a foreign id both mis-attributes
  the link and could read that event through it.
- **`create_application` / `update_application`** — `linked_campaign_id`
  (FundraisingCampaign) and the `assigned_to` / `approved_by` user ids now
  validated via the **shared** `assert_in_org` helper (`_validate_application_fks`,
  `allow_none=True` so clearing/omitting is fine) — the CROSS-CUTTING-recommended
  path, rather than another local checker.

All raise `ValueError`, which the endpoints already convert to 400 (no cross-tenant
existence oracle — `assert_in_org` returns a generic "Invalid …"). **8 unit tests
added** across both services covering foreign-id rejection and in-org pass.

### GF-7 — MEDIUM — No financial state-machine / overspend guards — 🚩 FLAGGED (needs product-defined state machine)

Still open: no path checks total expenditures against `amount_awarded` /
`amount_budgeted` (`amount_remaining` can go negative); `update_application`
applies any status/amount change with no transition guard (a CLOSED/AWARDED grant
stays fully editable); an `awarded → active → awarded` round-trip regenerates a
duplicate full set of compliance tasks. Needs a product-defined state machine and
an overspend policy (hard block vs warn). Recorded in `KNOWN_LIMITATIONS.md`.

### GF-8 — MEDIUM — `is_anonymous` flag never enforced in responses — 🚩 FLAGGED (product decision)

`DonationResponse` / `DonorResponse` still serialize `donor_name`/`donor_email`/
`donor_id`/`amount` regardless of `is_anonymous`, and `get_dashboard_data`
recent-donations returns donor-identified rows to any `fundraising.view` user. No
public surface, so staff-only — but the anonymity flag carries no effect. Needs a
decision on whether to suppress donor identity on anonymous gifts for `view` (vs
`manage`). Recorded in `KNOWN_LIMITATIONS.md`.

### GF-9 — LOW — Float money math; zero/unbounded amounts; donor-PII gate breadth — 🚩 FLAGGED

Report/dashboard aggregation still accumulates via `float()` before coercing back
to `Decimal` (belongs with the codebase-wide FIN-7 float→Decimal refactor); money
fields accept `0` with no upper cap; full donor PII is exposed to `fundraising.view`
(policy question, same family as FIN-5). Unchanged.

## Verified good ✅ (re-confirmed)

- GF-1 (`campaign_id`/`donor_id` validated + both recompute helpers org-scoped),
  GF-2 (`budget_item_id` validated against the org-verified parent), GF-3
  (`payment_status` normalized so totals roll up), GF-4 (`opportunity_id`
  validated), GF-5 (LIKE wildcards escaped) all hold.
- All 45 endpoints gated on `fundraising.view`/`.manage`; every by-id path
  org-scoped; stored money uses `Decimal` in the running-total helpers.

## Documentation

`docs/module-audit/grants-fundraising.md` updated: GF-6 resolved; GF-7/8/9 stand.

## Future development

1. **GF-7** — grant state machine + overspend guard + idempotent compliance-task
   generation.
2. **GF-8** — enforce `is_anonymous` for `fundraising.view` responses.
3. **GF-9** — fold the float→Decimal aggregation into the FIN-7 refactor.

## Completion gate

| Check | Result |
|-------|--------|
| `flake8` (2 services + 2 tests) | ✅ 0 violations |
| `black --check` | ✅ unchanged |
| `tsc --noEmit` | ✅ n/a — no frontend change |
| backend tests | ✅ `test_fundraising_service` + `test_grant_service` **40 passed** (+8 new). No DB needed for these files. |
