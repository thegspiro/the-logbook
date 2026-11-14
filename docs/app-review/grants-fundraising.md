# Application Review — Grants & Fundraising (Tier B)

**Prefix:** `GF2` · **Iteration:** B14 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-08 (pass 2), 2026-08-09 (pass 3), 2026-08-09 (pass 4),
2026-10-16 (pass 5)

**Backend:** `endpoints/grants.py` (1,842 L, 45 endpoints), `services/grant_service.py`
(1,000 L), `services/fundraising_service.py` (540 L), model `models/grant.py`
**Frontend:** `modules/grants-fundraising`
**Prior audit:** `docs/module-audit/grants-fundraising.md` (iteration 14) — GF-1
(CRITICAL), GF-2/3 (HIGH), GF-4/5 fixed; GF-6 (remaining unvalidated FKs), GF-7
(state machine), GF-8 (anonymity), GF-9 (float/PII) left open.

---

## Pass 5 (2026-10-16) — eight of ten update endpoints answered 500 and lost the change (8 fixed, 7 candidates flagged elsewhere)

Lens for this pass: the update-payload discipline of B4–B13 driven through the real
handlers, extended to the ten `PUT` routes of this module. The null half came back clean —
the finding is a different one, found because the null probe had to _change_ a row to mean
anything.

**Null-to-column probe (clean).** 149 cases, every field of the ten `*Update` schemas sent
as `null` against a committed row: each NOT NULL column answers 400 (all ten handlers catch
the `ValueError` `apply_updates` raises), and each nullable one is accepted. No
nullable-behind-plain-response column exists in these schemas (the NOTIF2-5 / FORM2-2
shape), and the money fields are `Decimal` columns with `ge=0` request bounds.

### GF2-1 — HIGH — `PUT` on an opportunity, budget item, compliance task, campaign, donor, donation, pledge or fundraising event answered 500 and discarded the change — ✅ FIXED

Reproduced, not inferred: with a `get_db` that commits after the handler and rolls back on an
exception (as `DatabaseManager.get_session` does), a `PUT` carrying a real change to each of
the ten entities returned **500 for eight and left the old value in the table**; only
applications and expenditures answered 200. The traceback is
`ResponseValidationError` on `updated_at`: _MissingGreenlet — greenlet_spawn has not been
called_.

Cause: every one of these tables has `updated_at … onupdate=func.now()`, a server-side
expression. MySQL and MariaDB cannot return a value from an `UPDATE`, so SQLAlchemy (2.1.4
here, `eager_defaults="auto"`) expires the attribute after the flush, and the first read
lazy-loads — which an async session cannot do outside a greenlet. Eight service methods
returned the instance straight after `flush()`, the endpoint handed it to the response model,
the model read `updated_at`, and the request failed. The session's rollback then discarded
the `UPDATE`, so the user saw neither the change nor an error they could act on. The two
that worked (`update_application`, `update_expenditure`) did so by reloading the row (the
application handler re-fetches with `populate_existing`) or by touching the row again in a
recompute. The create paths already carry the fix and the comment explaining it
(`create_donor`: _"every unloaded one raises MissingGreenlet when the response model reads
it"_); the update paths never got it.

What this does to the app: the frontend calls four of the eight —
`updatePledge`, `updateFundraisingEvent`, `updateCampaign` (the restricted-fund control),
`updateComplianceTask` (marking a task done or in progress on the grant detail page). I
could not run the browser flow here, and I reproduced against MariaDB 10.11 (the sandbox
database), not MySQL 8; neither can return from an `UPDATE`, so I expect the same, but the
claim is "reproduced on MariaDB", not "observed in production". No test caught it because
every existing service test uses a mocked session, which evaluates neither the `onupdate`
expression nor the response model.

**Fixed** with one shared helper, `reload_updated_at(db, instance)` in
`app/utils/model_updates.py` (next to `apply_updates`), called after the flush in the eight
methods: one `refresh(instance, ["updated_at"])`, a single primary-key SELECT. I chose the
targeted refresh over a full `refresh()` (which the create paths use) because `updated_at`
is the only `onupdate` column on these models, and over `eager_defaults=True` on the mapper
because that changes every write to every one of those tables for a read the handlers do
not all need. Two mocked service tests stood in for a session without an awaitable
`refresh`; they now provide one.

Tests: `tests/test_grants_update_endpoints_integration.py` (159). One test per entity makes a
real change and asserts **200 and that the value is in the table afterwards** — the second
half is what shows the lost write, which a plain status check would not. 9 fail with the
service change stashed (the eight entities, plus `donor.country`, which is the one null case
that happens to change a row because of its `server_default`); the other 150 pass either way,
and 0 are selected under the unit job's marker expression.

### GF2-2 — MEDIUM — the same flush-and-return shape exists in seven services outside this module — ✅ CLOSED 2026-10-25, none affected

Traced each of the seven to its endpoint; none answers 500, so no code changed:

| Method                                                           | Why it does not fail                                                              |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `finance_service.update_chain_step`                              | `ApprovalChainStep` has no `updated_at` column                                    |
| `inventory_service.update_reorder_request`                       | re-fetches with `populate_existing` before returning                              |
| `label_printer_service.update_printer`                           | `_printer_response` is hand-built and never reads `updated_at`                    |
| `legal_service.update_draft`                                     | the endpoint refreshes the revision after its commit                              |
| `medical_screening_service.update_requirement` / `update_record` | refresh after the flush (W71 fix)                                                 |
| `org_chart_service.update_node`                                  | the endpoint responds with a freshly queried chart, which carries no `updated_at` |

Original finding below.

A static scan of `app/services` for `update_*` methods that write through `apply_updates` /
`setattr`, flush, and neither refresh nor commit found 17; ten are the ones fixed above (or
`update_application` / `update_expenditure`, which work), leaving: `finance_service.
update_chain_step`, `inventory_service.update_reorder_request`, `label_printer_service.
update_printer`, `legal_service.update_draft`, `medical_screening_service.update_requirement`
and `update_record`, `org_chart_service.update_node`. **These are candidates, not findings**:
I did not drive them. Whether each fails depends on its model carrying `onupdate`, and on
whether its endpoint re-fetches or refreshes before responding. They belong to B3, B20, B1,
B21 and the unrotated services; the check is the one in
`test_grants_update_endpoints_integration.py` — a real change over HTTP with a rolling-back
`get_db`. Recorded in `docs/KNOWN_LIMITATIONS.md` so the owning pass picks it up.

### Verified good ✅ (this pass)

- **Nothing unreferenced.** The AST scan (counting `tests/`, `scripts/`, `alembic/`) over
  the endpoint, both services, model, schema, `donor_privacy` and the reminder module found
  no unused module-level name or class method, and no `noqa` / `TODO`.
- **Earlier flags re-read.** GF-7 (lifecycle and overspend warnings) and GF-8 (anonymous
  donors masked for `fundraising.view`) are both fixed in code (`donor_privacy.py`,
  `present_donor` / `present_donation`); GF-9's float math is `Decimal` and its remaining
  half (zero / unbounded amounts, donor PII to `fundraising.view`) is the open owner
  decision already in `docs/KNOWN_LIMITATIONS.md`. Nothing new to add.
- **Permissions.** All 45 routes carry `fundraising.manage` or `fundraising.view`; the
  route-permission check passes strict.

### Not read (scope, stated plainly)

The 1,446-line grant service and 838-line fundraising service were read at their update,
delete and recompute paths and scanned for dead names; the report builders, the reminder
notifications and the application lifecycle (GF-7) were left to their own suites, which
pass. The 16,000-line frontend module was read only at its update calls.

### Completion gate (pass 5)

| Check                                                           | Result                                                              |
| --------------------------------------------------------------- | ------------------------------------------------------------------- |
| `flake8 app/ tests/`                                            | ✅ exit 0, no output                                                |
| `black --check app/ tests/`                                     | ✅ 1772 files unchanged                                             |
| `isort --check` (changed files)                                 | ✅                                                                  |
| `mypy` (helper + both services)                                 | ✅ no issues                                                        |
| Related backend suites (17 files incl. the org-scoping ratchet) | ✅ 449 passed                                                       |
| New file                                                        | ✅ 159 pass; 9 fail without the fix; 0 under the unit job's markers |
| `check_route_permissions.py --strict`                           | ✅ 0 errors, 0 warnings                                             |
| Frontend                                                        | n/a — no frontend change                                            |

---

## Pass 4 (2026-08-09) — full FK re-audit: zero gaps; no code change

Pass 4 ran a fresh, exhaustive client-FK audit across every `create_*`/`update_*`
writer in both `grant_service.py` and `fundraising_service.py` (a sub-agent traced
each against its request schema). **Every writer comes back clean** — this is a
money module, so the FK surface got the closest look:

- Grant side: `create_application`/`update_application` (`opportunity_id`,
  `assigned_to`, `linked_campaign_id`) via `_opportunity_in_org` +
  `_validate_application_fks`; `create_expenditure`/`update_expenditure`
  (`budget_item_id`) via `_budget_item_in_application`; `update_compliance_task`
  (`assigned_to`) via `assert_in_org`; `create_budget_item`/`create_note` have
  their `application_id` popped from the org-verified URL path.
- Fundraising side: `create_donation`/`update_donation` (`campaign_id`,
  `donor_id`) via `_entity_in_org`; `create_pledge`/`update_pledge` via
  `_validate_pledge_fks`; `create_fundraising_event` via
  `_validate_fundraising_event_fks`.
- The three fields most likely to slip a create path — `Donor.user_id`,
  `GrantExpenditure.approved_by`, `GrantComplianceTask.assigned_to` — are
  **response-only** (absent from their request schemas), so a client cannot inject
  them; `model_dump(exclude_unset=True)` + Pydantic's drop of undeclared fields
  closes that door.

GF-10/GF-11 enum fixes and the `Literal`-typed schema validation hold; both
services E712-free.

**Still flagged (unchanged, all product/refactor-shaped):** GF-7 (financial state
machine + overspend guard), GF-8 (`is_anonymous` not enforced in staff donor
responses — a genuine **product decision**: whether an anonymous gift should hide
donor identity from `fundraising.view` vs `.manage`, per `KNOWN_LIMITATIONS.md`),
GF-9 (float money math + donor-PII gate breadth).

**Completion gate (pass 4):** no code changed; `flake8` 0 · `black --check` clean ·
`tsc --noEmit` n/a.

---

## Pass 3 (2026-08-09) — verified clean; latent-500 lens clears (Literal-typed)

No code change. Re-verified the guards hold: GF-6/GF-12 `assert_in_org` on the
pledge/expenditure/compliance-task FKs (`grant_service.py` 241/249/257/786);
GF-10/GF-11 enum fixes (`reporting_frequency`/`task_type`) intact. E712-free across
`grant_service.py` and `fundraising_service.py`.

### Latent-500 lens (the B1 finding) — clears; the module uses `Literal` types

The grant schemas validate their enum fields with **`Literal` types** (63 uses —
`ReportingFrequencyLiteral`, `ComplianceTaskTypeLiteral`, `PaymentMethodLiteral`, …),
which Pydantic rejects out-of-set values against with a 422. That's how GF-10/GF-11
were fixed, and it covers the surface. The lens flagged
`GrantExpenditureCreate/Update.payment_method` as free-`str`, but that is a **double
false positive**: (a) the automated check doesn't recognize `Literal` as validation,
and (b) `GrantExpenditure.payment_method` is a plain **`String`** column, not a strict
ENUM — so an unrecognized value stores fine, with no 500.

### GF2-obs — LOW — expenditure `payment_method` is free-text where a sibling uses a Literal — noted, not changed

`GrantExpenditureCreate/Update.payment_method` is `Optional[str]` against a `String`
column, while another schema in the module types the same concept as
`PaymentMethodLiteral`. This is an **inconsistency, not a defect** — no 500, no
security issue, and the `String` column implies free-text payment methods (custom
"wire/ACH/…") were allowed by design. Tightening it to the Literal would reject
previously-valid custom values — a product call on a money module, not a review
auto-fix. Recorded as a consistency observation; folds naturally into the GF-9
money/validation-breadth follow-up.

### Still flagged (unchanged)

- **GF-7** (grant financial state machine + overspend guard), **GF-8**
  (`is_anonymous` not enforced in donor responses), **GF-9** (float money math + the
  donor-PII gate breadth) — all product/refactor-shaped, in `KNOWN_LIMITATIONS.md`.

**Completion gate (pass 3):** `flake8` 0 · `black --check` clean · `tsc --noEmit`
n/a (no frontend change) · no tests changed (no code change).

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

### GF-7 — MEDIUM — No financial state-machine / overspend guards — ✅ RESOLVED (owner decision, 2026-10-11)

This section previously read "Still open," which became stale the moment the
fix below landed — corrected 2026-10-30 (security-review pass 12). **Resolved
2026-10-11:** `APPLICATION_STATUS_TRANSITIONS` (`app/models/grant.py`) is now
the grant lifecycle, and `update_application` refuses any other status change
with a 400 before anything is written. Overspend warns rather than blocks:
`app/utils/grant_spending.py` computes `overspent_by`/`total_expended`, and an
over-budget expenditure write still succeeds with a `warnings` field and an
audited `grant_overspend_recorded` event. The duplicate-compliance-task half
was already closed by GF-14. See `KNOWN_LIMITATIONS.md`'s GF-7 row and
`docs/security-review/GF-22-grants-fundraising.md`'s pass 8 for the full
citation. Tests: `tests/test_grant_lifecycle.py`.

### GF-8 — MEDIUM — `is_anonymous` flag never enforced in responses — ✅ RESOLVED (owner decision, 2026-10-11)

This section previously read that the anonymity flag "carries no effect,"
which became stale the moment the fix below landed — corrected 2026-10-30
(security-review pass 12). **Resolved 2026-10-11:** `app/services/donor_privacy.py`
now clears `donor_name`/`donor_email`/`donor_id` on an anonymous donation, and
clears contact detail on an anonymous donor, for any caller without
`fundraising.manage`; a view-only donor search no longer matches an anonymous
donor's hidden name. See `KNOWN_LIMITATIONS.md`'s GF-8 row and
`docs/security-review/GF-22-grants-fundraising.md`'s pass 8 for the full
citation. Tests: `tests/test_anonymous_donations.py`.

### GF-9 — LOW — Float money math; zero/unbounded amounts; donor-PII gate breadth — ✅ RESOLVED (all three parts)

Originally: report/dashboard aggregation accumulated via `float()`; money
fields accepted `0` with no upper cap; full donor PII was exposed to
`fundraising.view` (policy question, same family as FIN-5).

**Float part resolved 2026-10-05 (owner decision):** `get_grant_report` and
`get_fundraising_report` sum money as `Decimal` and convert each total to a
float once, at the response; the average gift rounds half-up to the cent.
Covered by `TestGrantReportIsExact` and `TestFundraisingReportIsExact`.

**Remaining two-thirds resolved 2026-10-21 (owner decision), corrected here
2026-10-30 (security-review pass 12) — this section previously read "stand as
before" after that fix had already landed:** every amount field on a
grants/fundraising request schema now carries an upper bound (a donation or
pledge up to $1,000,000; awards, budgets, campaign/event goals and
expenditures up to $100,000,000; `$0` stays valid where it means something).
A caller with only `fundraising.view` now reads donor name, type, company,
totals and dates; email, phone, address, notes and the linked member account
need `fundraising.manage` (`app/services/donor_privacy.py`,
`DONOR_CONTACT_FIELDS`); `DonorResponse.contact_hidden` tells a screen why a
field is blank. See `KNOWN_LIMITATIONS.md`'s GF-9 row and
`docs/security-review/GF-22-grants-fundraising.md`'s pass 9/10 for the full
citation. Tests: `tests/test_grant_money_bounds.py`, `test_donor_contact_privacy.py`.

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

| Check                           | Result                                                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `flake8` (2 services + 2 tests) | ✅ 0 violations                                                                                            |
| `black --check`                 | ✅ unchanged                                                                                               |
| `tsc --noEmit`                  | ✅ n/a — no frontend change                                                                                |
| backend tests                   | ✅ `test_fundraising_service` + `test_grant_service` **40 passed** (+8 new). No DB needed for these files. |
