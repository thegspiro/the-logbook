# Application Review — Training (Tier B, 2nd pass)

**Prefix:** `TR2` · **Iteration:** B18 · **Reviewed:** 2026-08-06

**Backend:** the largest module — 8 endpoint files (~8,100 L, 154 endpoints) + ~13
services (~9,300 L). Focus this pass: `external_training.py` +
`external_training_service.py` (the TR-6 open items) and
`training_submission_service.py` (TR-5).
**Prior audit:** `docs/module-audit/training.md` (iteration 18) — TR-1 (PHI leak),
TR-2 (record `user_id`), TR-3 (external user-mapping leak) fixed; TR-4 (year
default), TR-5 (auto-approve SoD), TR-6 (external/enhancement FKs) left open.

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

### TR-5 — LOW/MED — Auto-approved submissions bypass separation-of-duties — 🚩 FLAGGED (config/product decision)

Unchanged, and re-confirmed as the OPS-4 clarification found: the *manual* review
path uses the shared `assert_different_person` guard, but the **auto-approve**
branch in `create_submission` (`require_approval=False` or
`hours_completed <= auto_approve_under_hours`) spawns a COMPLETED record crediting
the member's self-reported hours **with no reviewer at all** — so an actor≠subject
check doesn't apply. The only limit on member self-credit is the org's auto-approve
config. Closing it means bounding the auto-approve threshold or accepting it as
documented config — a product decision. Recorded in `KNOWN_LIMITATIONS.md`.

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

1. **TR-5** — bound the auto-approve hours threshold or accept as documented config.
2. **TR-6 residual** — org-filter the backstopped lookups; make `_decrypt_field`
   fail closed after the CI-5 backfill.
3. **TR-4** — decide the `year` default semantics.

## Completion gate

| Check | Result |
|-------|--------|
| `flake8` (endpoint + test) | ✅ 0 violations |
| `black --check` | ✅ formatted |
| `tsc --noEmit` | ✅ n/a — no frontend change |
| backend tests | ✅ `test_training` **84 passed**; `test_external_training_org_scoping` **2 passed** (new, endpoint-level TR-6). No DB needed. |
