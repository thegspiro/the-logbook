# Application Review — Compliance / Skills (Tier B)

**Prefix:** `CS2` · **Iteration:** B22 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-08 (pass 2)

**Backend:** `endpoints/skills_testing.py` + `skills_testing_service.py`,
`endpoints/compliance_officer.py` + `compliance_officer_service.py` +
`training_compliance.py`, `endpoints/compliance_config.py` +
`compliance_config_service.py`
**Prior audit:** `docs/module-audit/compliance-skills.md` (iteration 22) — CS-1–7
fixed; CS-8 (skills self-cert fixed; attestation SoD open); CS-9 (injection +
input-validation fixed; monthly-window + recipient allow-list + officer #6 open).

---

## Pass 2 (2026-08-08) — six-lens sweep

Re-verified pass-1 (CS-9 officer #6 UUID normalization; CS-8 skills self-cert
`assert_different_person` on `create_test`; config/profile FK re-validation on
update). **2 fixes.**

### CS-10 — MED — A candidate could score & complete their OWN official skills test — ✅ FIXED

`create_test` enforces `assert_different_person(examiner, candidate)` — an
instructor can't create a test where they're the candidate. But the **scoring**
mutations (`PUT /tests/{id}` = `update_test`, `POST /tests/{id}/complete` =
`complete_test`) authorize only through `_authorize_test_write`, which returns
early for anyone with `training.manage` and **never checked actor ≠ candidate**.
Officers routinely hold `training.manage` *and* get tested for higher certs — so
officer B, named candidate on a test officer A created, could enter their own
`section_results` and complete it, self-crediting the linked pipeline/cert
requirement. The guard's own docstring already states "a candidate gets no write
access," so this was a bypass, not a design choice. **Fix:** `_authorize_test_write`
now blocks a non-practice test whose `candidate_id == actor` **before** the officer
short-circuit (practice stays exempt — uncredited peer drills). The two callers are
exactly the credit-granting mutations, so nothing else is over-blocked. 3 DB-free
regression tests.

### CS-11 — LOW — Compliance report always reported 0 at-risk / 0 non-compliant — ✅ FIXED

`generate_annual_report` computes each member's `status`
(`compliant`/`at_risk`/`non_compliant`) but its `executive_summary` emitted only
`fully_compliant_members`. The consumer (`compliance_config_service`) reads
`exec_summary.get("at_risk_members", 0)` / `("non_compliant_members", 0)` — so the
stored report **and its email** always showed **0** at-risk and **0** non-compliant,
silently understating risk (the `.get(..., 0)` prevented a crash, so it went
unnoticed). **Fix:** aggregate the per-member statuses and emit both keys in
`executive_summary`. Verified by inspection against the already-tested consumer
path; the aggregation is a straight `sum(... == "at_risk")` over `member_compliance`.

**Flagged (unchanged, deferred):** CS-8 attestation SoD / dual-control
(`create_attestation` writes a client `compliance_percentage`, bound-only, no
recompute/second-approver), CS-9 recipient allow-list (report email accepts
arbitrary external addresses — PHI-adjacent), CS-9 monthly windowing (monthly
report reuses the full-year dataset, mislabeled). Lenses 1/3/4 clean:
`SkillTestUpdate` exposes no `candidate_id`/`examiner_id`/`template_id` (blind
setattr can't reassign FKs); the one updatable FK (`requirement_id`) is re-validated
on update; every read/write org-scoped; endpoints wrap service calls in
`handle_service_errors` (ValueError→400).

---

## Scope

Tier B: the open items on this PHI-adjacent surface. The cross-member PHI leaks
(CS-1), XC-1 (CS-3), CSV injection (CS-4), email HTML injection (CS-6), and the
skills self-certification SoD (CS-8 skills half) were re-confirmed fixed. This pass
fixed the one latent correctness item and verified the rest are genuinely deferred
product decisions.

## Findings

### CS-9 (officer #6) — LOW — ISO-readiness hour aggregation fragile to a UUID `user_id` — ✅ FIXED

`get_iso_readiness` builds `member_ids` as a set of `str(id)` and `member_hours`
keyed by those strings, then compared each training record with
`if record.user_id not in member_ids` and incremented `member_hours[record.user_id]`.
`TrainingRecord.user_id` is a `String(36)` column, so at runtime `record.user_id`
is already a `str` and it works — but if it ever arrived as a `UUID` (a refactor,
a different load path), the membership test would silently miss and the member's
hours would be **dropped from the whole ISO/FSRS readiness computation**. **Fix:**
normalize `uid = str(record.user_id)` once and use it for both the membership test
and the dict key — behavior-neutral today, robust against the type drift. **1
regression test added** (a UUID-typed `user_id` still counts toward its category).

### CS-8 (attestation) — MED/LOW — Self-attestation has no server-side recompute / dual-control — 🚩 FLAGGED (behavior change)

Re-confirmed and re-scoped: `create_attestation` stores a client-supplied
`compliance_percentage`. The value is **already range-bounded** at the schema
(`AttestationCreate.compliance_percentage: Field(ge=0, le=100)`), so an absurd
number can't be stored — but there is still no server-side recompute against the
actual compliance data and no second approver, so a compliance officer can attest
a figure they chose within [0,100]. Closing it needs a computed value or
dual-control — a workflow change. Already in `KNOWN_LIMITATIONS.md` (CS-8).

### CS-9 residual — 🚩 FLAGGED (feature / policy, unchanged)

- **Monthly windowing** — monthly reports still return the annual dataset
  relabeled; a real monthly view needs `generate_annual_report` to accept a month
  window (data-layer feature). Deferred.
- **Recipient allow-list** — ✅ RESOLVED (owner decision, 2026-08-09). Restricting
  recipients to org-member emails would break legitimate external auditors, so the
  owner chose *allow any recipient, but audit-log each external send.*
  `_email_report` now calls the shared `audit_external_recipients`
  (`app/utils/external_recipients.py`), which classifies recipients against org
  membership (work + personal email, case-insensitive) and writes one
  `external_recipient_send` audit event listing every out-of-org address, with the
  acting user threaded through `generate_report`/`email_existing_report`. Covered by
  `tests/test_external_recipient_audit.py` (7 tests). (The saved-report
  `email_recipients` on the reports module is stored schedule config with no live
  send path yet; when that path is built it should call the same helper.)
- `records_with_certification` mislabel (ambiguous-intent) left as-is.

## Cleanup applied

Swept all 4 `== True`/`== False  # noqa: E712` suppressions in
`compliance_officer_service.py` to `.is_(...)`.

## Verified good ✅ (re-confirmed)

- CS-1 (non-officer confined to own skills tests), CS-2 (template by-id visibility),
  CS-3 (`_validate_profile_fks`), CS-4 (`_csv_safe`), CS-5 (zero-requirement
  compliant), CS-6 (email escape), CS-7 (threshold ordering), CS-8 skills
  (`assert_different_person` on the examiner≠candidate path) all hold.
- No cross-tenant IDOR; officer reads take no target member id; XC-3 clean; no SQL
  injection; division-by-zero guarded.

## Documentation

`docs/module-audit/compliance-skills.md` updated: CS-9 officer #6 fixed; CS-8
attestation clarified (schema already bounds the value); monthly/recipient stand.

## Future development

1. **CS-8 attestation** — server-side recompute or a second approver.
2. **CS-9** — monthly report windowing; recipient allow-list decision.

## Completion gate

| Check | Result |
|-------|--------|
| `flake8` (service + test) | ✅ 0 violations |
| `black --check` | ✅ unchanged |
| `tsc --noEmit` | ✅ n/a — no frontend change |
| backend tests | ✅ `test_training_compliance` + `test_iso_readiness_framing` + `test_compliance_officer` **95 passed**; `test_iso_readiness_user_scoping` **1 passed** (new). No DB needed. |
