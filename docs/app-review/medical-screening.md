# Application Review — Medical Screening (Tier B)

**Prefix:** `MS2` · **Iteration:** B1 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-06 (pass 2)

---

## Pass 2 (2026-08-06)

Re-verified the pass-1 fixes still hold and widened the lens over the full
endpoint/schema surface. **MS-2/MS-3 intact:** `create_record` still validates
all three client FKs via `assert_in_org` (fail-closed), and `ScreeningRecordUpdate`
deliberately omits `user_id`/`prospect_id`/`requirement_id`, so the MS-3 create
guard **cannot be bypassed via update** — confirmed clean. `_resolve_names` still
org-scopes every lookup. MS-1 (PHI plaintext) still stands, still migration-shaped.

One new finding, the same class as MS-2 on a path pass 1 didn't cover:

### MS2-4 — MED — Record list/detail responses never populated names — ✅ FIXED

**What:** `ScreeningRecordResponse` declares `user_name`, `prospect_name`,
`reviewer_name`, and `requirement_name`
(`schemas/medical_screening.py:121-124`), but the four service methods behind the
record endpoints — `list_records`, `get_record`, `create_record`, `update_record`
— return the raw `ScreeningRecord` ORM row, which has **no such attributes** (only
the `user`/`prospect`/`reviewer`/`requirement` relationships). With
`from_attributes=True`, every one of those four fields serialized as `null` on
`GET /records`, `GET /records/{id}`, `POST /records`, and `PUT /records/{id}`.

**Why MED (live UI defect, not cosmetic):** `MedicalScreeningPage.tsx:321` — the
**Records tab** — renders `record.user_name ?? record.prospect_name ?? 'Unknown'`,
and its `records` come from `medicalScreeningService.listRecords()` → `GET
/records` (the un-enriched path). So **every row on the Records tab showed
"Unknown"** as the member/prospect name. This is exactly the MS-2 defect (which
was fixed only for the expiring/compliance dashboards, on the separate
`ExpiringScreening`/`ComplianceSummary` schemas); the record list/detail path was
left behind and still broken.

**Fix:** a new public `attach_record_names(organization_id, records)` service
method reuses the existing MS-2 `_resolve_names` helper — one org-scoped batch
query per entity type, with the reviewer (a `User`) **folded into the same user
lookup** rather than a fourth query — and sets the four names as plain instance
attributes Pydantic reads via `from_attributes` (non-mapped, never persisted).
Wired into all four record endpoints; the list endpoint enriches only the paged
slice, not the full result set. `update_record`/`delete_record`'s internal
`get_record` fetch and the compliance path's internal `list_records` call stay
un-enriched (no wasted queries) because enrichment lives at the endpoint layer,
not inside the shared fetchers. Org-scoping is load-bearing and tested: an
out-of-org id is absent from the resolved map, so a name can never cross tenants.
3 tests added (`TestAttachRecordNames`): all-four-fields populated +
reviewer-folded-into-user-batch, empty-list-no-query, unresolved-id-yields-None.

---

## Pass 1 (2026-08-06)

**Prefix:** `MS2` · **Iteration:** B1 · **Reviewed:** 2026-08-06

**Backend:** `app/api/v1/endpoints/medical_screening.py` (13 endpoints),
`app/services/medical_screening_service.py`, `app/models/medical_screening.py`
**Frontend:** `modules/medical-screening`
**Prior audit:** `docs/module-audit/medical-screening.md` (iteration 1) — three
findings left open: MS-1 (PHI plaintext at rest), MS-2 (names never resolved),
MS-3 (no cross-org FK validation on create).

---

## Scope

Started from the module-audit's three open findings (the Tier B instruction) and
applied the broader lens. The security pass had already confirmed tenant
isolation, access control, audit logging, cache exclusion and 404 handling; this
pass did **not** re-derive those — it re-verified they still hold and worked the
open list plus correctness/dead-code/docs.

## Findings

### MS-3 — LOW→MED — No cross-org validation of referenced IDs on create — ✅ FIXED

**What:** `create_record` set `organization_id` from the caller but stored
client-supplied `user_id`, `prospect_id`, and `requirement_id` with no in-org
check.

**Why it's worse than a generic XC-1 here:** the record holds **PHI**. A generic
dangling FK is a mis-attribution nuisance; attaching a *medical screening result*
to a foreign or wrong `user_id` is a PHI-integrity problem — the screening data
ends up associated with the wrong person. The original audit rated it LOW as a
plain dangling-FK; the PHI context nudges it toward MED.

**Fix:** each of the three FKs is now validated via the shared
`assert_in_org` helper (`app/utils/org_scoping.py`) with `allow_none=True`, so a
foreign or nonexistent id is refused before the row is written. The create
endpoint gained the `ValueError → 400` conversion it was missing (via
`safe_error_detail`), so the rejection surfaces cleanly rather than as a 500.
This is the same shape closed in finance, forms, elections, and now the standard
remedy — the helper the cross-cutting guidance recommended.

### MS-2 — LOW — Compliance/expiring responses never populated names — ✅ FIXED

**What:** `get_compliance_status` always returned `subject_name = ""`, and
`get_expiring_soon` always returned `user_name/prospect_name/requirement_name =
None`.

**Why it mattered (upgraded from "incomplete feature"):** it is a **live UI
defect**, not just an unfinished field. The frontend renders
`screening.user_name ?? screening.prospect_name ?? 'Unknown'`
(`ComplianceDashboard.tsx:48`, `MedicalScreeningPage.tsx:321`), so **every row on
the expiring-screenings dashboard showed "Unknown"** instead of the member's
name. The backend was the only possible source and never filled it.

**Fix:** a new `_resolve_names` helper batch-resolves member, prospect and
requirement display names — **one org-scoped query per entity type**, not an N+1
over the result set. `get_expiring_soon` and `get_compliance_status` both use it.
Org scoping is load-bearing and tested: a missing or out-of-org id is simply
absent from the map, so `.get()` yields `None` and a name can never cross an org
boundary. 3 unit tests added (`TestResolveNames`) covering composition, the
empty-set short-circuit, and the missing-id case; the pre-existing compliance and
expiring tests were refocused with an autouse stub so they still test only their
own subject (counts/dates).

### MS-1 — MEDIUM — PHI stored in plaintext columns — 🚩 FLAGGED (unchanged)

`ScreeningRecord.result_summary` / `result_data` / `notes` / `provider_name`
remain plain `Text`/`JSON`/`String` columns rather than the app's
`EncryptedType`, despite CLAUDE.md documenting encryption of sensitive fields.
**Still correctly deferred:** converting them requires an Alembic data migration
to encrypt existing rows and a check that no filter relies on plaintext matching
(none does today — `list_records` filters only on ids/type/status, never on the
four PHI fields, which I verified). This is the single highest-value follow-up in
this module and is migration-shaped, not a review-time fix.

## Verified good ✅ (re-confirmed from the security pass)

- Tenant isolation still solid: every by-id getter filters `organization_id`,
  and update/delete route through those getters. `list_records` /
  `get_expiring_soon` / the new `_resolve_names` are all org-scoped.
- All 13 endpoints gated on `medical_screening.view` / `.manage`; record creation
  audit-logged; `/medical-screening/` remains in `UNCACHEABLE_PREFIXES`.
- No SQL injection (the expiring cutoff is a bound Python date), no raw
  interval fragments.

## Duplication

None introduced; `_resolve_names` *removes* the latent temptation to resolve
names per-row in two separate methods by giving both one shared, org-scoped path.

## Dead code

None. All 13 endpoints have frontend callers; no unused service methods; no
TODO/FIXME markers. Frontend avoids Pitfall #1 (no `??` on outgoing form values).

## Documentation

- `docs/module-audit/medical-screening.md` MS-2 and MS-3 are now resolved; MS-1
  stands. (This file is the app-review record; the module-audit file remains the
  historical security-pass record.)
- The four-field encryption gap (MS-1) is the one doc-vs-code contradiction that
  remains — CLAUDE.md says sensitive fields are AES-256 encrypted; these four are
  not. Resolving MS-1 closes the contradiction; until then it is flagged.

## Future development

1. **MS-1 encryption migration** — the top item; convert the four PHI columns to
   `EncryptedType` with a data migration.
2. **No integration test for the name resolution against a real DB** — the unit
   tests mock the queries; an integration test would lock the org-scoping join
   behavior once MySQL is available in CI.
3. **`create_record` doesn't enforce exactly-one-of `user_id`/`prospect_id`** —
   the model comment says a record links to *either*, but nothing rejects both
   or neither. Out of scope for MS-3 (which was about *in-org* validation); worth
   a `@model_validator` on the schema.

## Completion gate

| Check | Result |
|-------|--------|
| `tsc --noEmit` | ✅ 0 errors (no frontend change) |
| `flake8 app/ tests/` | ✅ 0 violations |
| `black --check` | ✅ 503 files unchanged |
| `eslint` | ✅ clean |
| backend tests | ✅ **2517 passed, 0 failed** (was 2514 — 3 tests added; the 19 medical-screening tests all pass). 648 errors, all `db_session` fixture failures against the sandbox's missing MySQL. |
</content>
