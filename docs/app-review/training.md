# Application Review — Training (Tier B)

**Prefix:** `TR2` · **Iteration:** B18 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-08 (pass 2), 2026-08-09 (pass 3)

---

## Pass 3 (2026-08-09) — TR-5 confirmed resolved; latent-500 clears; 26 E712 swept

Re-verified: **TR-5 confirmed RESOLVED** — the auto-approve self-credit guard landed
earlier this session (Decision 4): `create_submission` calls
`_credits_certification_or_requirement(...)` and routes any certification/requirement-
crediting submission to manual review regardless of auto-approve config (service
120/167). TR-6/TR-7 (category-name leak fixes) and TR-1/2/3 hold.

**Latent-500 lens clears — the module already validates its enums.** The lens flagged
10 `training_type`/`status`/`frequency` fields across `TrainingCourse`/`Record`/
`Requirement` Create/Update as free-`str`, but `schemas/training.py` already carries
**11 `@field_validator`s** covering exactly those fields (verified: all three creates
reject a bogus value with 422). A false positive the automated check produces because
it doesn't see `field_validator`s — no fix needed.

### TR2-1 — NIT — 26 `== True/False  # noqa: E712` swept across 6 services — ✅ FIXED

The training services carried 26 boolean-column E712 suppressions
(`training_enhancement_service.py` 13, `training_program_service.py`/
`training_waiver_service.py` 4 each, `training_compliance.py`/`training_service.py` 2
each, `external_training_service.py` 1) — passes 1–2 were security-focused and never
swept them. All 26 are boolean-column comparisons (no JSON-value compares); converted
to `.is_(...)`, removing every E712 noqa from the module. 95 training tests pass
unchanged.

### Still flagged (unchanged)

- **TR-4** (`year` default in requirements-progress — compliance-semantics decision),
  **TR-6 residual** (org-filter the backstopped enhancement/sync lookups; make
  `_decrypt_field` fail closed) — both in the future-development list below.

**Completion gate (pass 3):** `flake8` 0 · `black --check` clean · `tsc --noEmit`
n/a (no frontend change) · training tests **95 passed** (DB-free).

**Backend:** the largest module — 8 endpoint files (~8,100 L, 154 endpoints) + ~13
services (~9,300 L). Focus this pass: `external_training.py` +
`external_training_service.py` (the TR-6 open items) and
`training_submission_service.py` (TR-5).
**Prior audit:** `docs/module-audit/training.md` (iteration 18) — TR-1 (PHI leak),
TR-2 (record `user_id`), TR-3 (external user-mapping leak) fixed; TR-4 (year
default), TR-5 (auto-approve SoD), TR-6 (external/enhancement FKs) left open.

---

## Pass 2 (2026-08-08) — six-lens sweep across all 13 services

Re-verified the pass-1 TR-6 fixes hold (`update_category_mapping` in-org validation
+ org-scoped enrichment; `provider.default_category_id` validated; enhancement
by-id methods org-scoped) and TR-5 stays correctly flagged. Sweeping the
projection-read-leak lens across the whole module — its proven weak spot — surfaced
**two more live cross-org read-leaks the pass-1 external-training focus didn't
reach**, plus two consistency gaps. **4 fixes.**

### TR-7 — MED — Category-hours breakdown leaked another org's category name/code — ✅ FIXED

`GET .../category-hours` (self-or-training-officer) sums a member's records by
`category_id`, then looked up the categories with
`select(TrainingCategory).where(id.in_(cat_ids))` — **no org filter** — and
projected `name`/`code`/`registry_code`. The `category_id` on a record is
client-supplied and was **never validated in-org** (neither `create_record` nor
`update_record` checked it; the update path blind-`setattr`s it), so an org-A
training officer could set one of their own records' `category_id` to an org-B
category UUID and read that category's name/code/registry_code back — the live TR-3
shape, for categories. **Fix (both the leak and its root cause):** org-scope the
breakdown lookup, **and** validate a client `category_id` in-org on `create_record`
and `update_record` (404 if foreign). 2 regression tests (create + update reject a
foreign category).

### TR-8 — MED-LOW — Individual training PDF leaked an arbitrary user's name across orgs — ✅ FIXED

`generate_individual_pdf` (`training.manage`, `user_id` from the request body)
fetched the member with `select(User).where(User.id == user_id)` — no org filter —
and rendered `first_name last_name` into the PDF title. The records below it are
org-scoped (a foreign user yields an empty report), but the **title still projected
the foreign member's name**. **Fix:** org-scope the User lookup
(`User.organization_id == organization_id`), matching the records query.

### TR-9 / TR-10 — LOW — Two enrichment/lookup reads not org-scoped (consistency) — ✅ FIXED

- `list_user_mappings` enriched `internal_user_name`/`_email` via
  `select(User.full_name, User.email).where(User.id == …)` with no org filter — the
  lone TR-3-shape read whose two sibling paths already carry the org filter. Not
  currently exploitable (`internal_user_id` is in-org-guaranteed by the write
  paths), but tightened to match.
- The **bulk** record-create's expiration lookup fetched `TrainingCourse` by id
  with no org filter, while the single-create at the top of the same file scopes it.
  Influence-only (`expiration_months` isn't projected), fixed for consistency.

**Flagged (unchanged):** TR-5 (auto-approve branch spawns a COMPLETED self-credit
with no reviewer — SoD product decision, KNOWN_LIMITATIONS), TR-4 (year default),
TR-6 residual (bulk_enroll / sync re-fetch backstops). LOW dangling-FK stores that
are **not** projected (session-create category/program/phase/requirement/instructor,
recert `source_requirement_id`, recurring `template_id`, waiver `requirement_ids`)
are noted for a future FK-hardening batch, not fixed here — no read-back leak.
**Lens 6 (latent-500) clean:** submission endpoints route service `ValueError`/
`PermissionError` through `handle_service_errors`; enhancement endpoints each have
`except ValueError→400`.

---

## Scope

Tier B: the open findings. The security invariants (154 endpoints authed, per-member
PHI self-or-officer gated, programs-service isolation, external SSRF + encrypted
credentials) were re-confirmed. This pass closed the actionable half of TR-6 —
including a **live** cross-org category-name leak the audit had under-rated — and
re-flagged the two product/config decisions (TR-4, TR-5).

## Findings

### TR-6 — MEDIUM (upgraded) — External category FKs: a live cross-org name leak + unvalidated provider FK — ✅ FIXED

Two client-supplied training-category FKs were stored with no in-org check:

- **Category mapping `internal_category_id` (the live leak).**
  `update_category_mapping` stored the client's `internal_category_id` unchecked,
  and both the list and update-response **enrichment lookups** read
  `TrainingCategory.name WHERE id == internal_category_id` with **no org filter** —
  so an `training.manage` user could map an external category to a **foreign org's**
  category id and read that category's name back. This is the exact TR-3 shape
  (which was rated MEDIUM), for categories — a real cross-org read, not merely a
  dangling FK. **Fix:** validate `internal_category_id` in-org on write (reject
  400), and org-scope **both** enrichment lookups so a pre-existing foreign id
  returns `None` instead of a name.
- **Provider `default_category_id`.** `create_provider` / `update_provider` stored
  it unchecked; it's read at sync time to attribute imported records, so a foreign
  id would mis-attribute imports to another org's category. **Fix:** validate
  in-org on both paths (reject 400) via the shared `is_in_org`.

**2 endpoint-level regression tests added** (foreign `default_category_id` and
foreign `internal_category_id` both 400 and don't persist).

**Remaining TR-6 items (still flagged, backstopped — not live):** xAPI
`source_provider_id`, `bulk_enroll` name lookups, and `perform_sync_task`'s
provider re-fetch look up ids without an org filter but are backstopped by
downstream org-scoped writes; `_decrypt_field` returns the raw stored value on
decrypt failure (a migration shim that should fail closed once the field-encryption
backfill — CI-5 — completes). These stay flagged.

**Spot-check resolved:** the audit asked for independent confirmation of
`training_enhancement_service` by-id org-scoping — verified: `get_pathway`,
`get_matrix`, `update_qualification`, and the other by-id methods all filter
`organization_id` alongside `id`.

### TR-5 — LOW/MED — Auto-approved submissions bypass separation-of-duties — ✅ RESOLVED (owner decision, 2026-08-09)

The *manual* review path already used the shared `assert_different_person` guard,
but the **auto-approve** branch in `create_submission` (`require_approval=False` or
`hours_completed <= auto_approve_under_hours`) spawned a COMPLETED record crediting
the member's self-reported hours **with no reviewer at all**. Owner decision:
*disable auto-approve when separation of duties applies.* `create_submission` now
calls `_credits_certification_or_requirement(training_type, kwargs)` and routes any
submission that would credit a certification/requirement — training_type
`certification`, any certification credential field
(`certification_number`/`issuing_agency`/`expiration_date`), or a linked
`category_id` (the mechanism by which training counts toward a requirement) — to
`PENDING_REVIEW` regardless of the org's auto-approve config. Only non-crediting
submissions (plain logged hours, skills practice) still auto-approve, so no member
can self-credit a credential. Covered by
`tests/test_training_autoapprove_credit_guard.py` (7 tests).

### TR-4 — LOW — `year` default in requirements-progress — 🚩 FLAGGED (compliance-semantics)

The dead no-op was already removed. Whether `year` should default to the current
year (vs the current "all years" when omitted) remains a compliance-semantics
decision — it changes which year's requirements members are measured against — and
isn't changed unverified. Unchanged.

## Verified good ✅ (re-confirmed)

- TR-1 (`certifications/expiring` confines non-officers to their own id), TR-2
  (`POST /records` validates `user_id` in-org unconditionally), TR-3 (external
  user-mapping validates `internal_user_id` + org-scoped enrichment) all hold.
- External SSRF re-validated before every outbound call; API keys/secrets
  encrypted + write-only; programs-service XC-3 clean; credit accrual idempotent.

## Cleanup applied

Swept all 5 `== True`/`== False  # noqa: E712` suppressions in
`external_training.py` to `.is_(...)`.

## Documentation

`docs/module-audit/training.md` updated: TR-6 category half resolved (and its
severity note corrected — the mapping case was a live leak); TR-4/TR-5 stand.

## Future development

1. **TR-6 residual** — org-filter the backstopped lookups; make `_decrypt_field`
   fail closed after the CI-5 backfill.
2. **TR-4** — decide the `year` default semantics.

## Completion gate

| Check | Result |
|-------|--------|
| `flake8` (endpoint + test) | ✅ 0 violations |
| `black --check` | ✅ formatted |
| `tsc --noEmit` | ✅ n/a — no frontend change |
| backend tests | ✅ `test_training` **84 passed**; `test_external_training_org_scoping` **2 passed** (new, endpoint-level TR-6). No DB needed. |
