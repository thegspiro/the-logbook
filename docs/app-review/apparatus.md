# Application Review — Apparatus (Tier B, 2nd pass)

**Prefix:** `AP2` · **Iteration:** B2 · **Reviewed:** 2026-08-06

**Backend:** `app/api/v1/endpoints/apparatus.py` (2,980 L, 83 endpoints),
`app/services/apparatus_service.py` (2,395 L), `evoc_level_service.py`
**Frontend:** `modules/apparatus`
**Prior audit:** `docs/module-audit/apparatus.md` (iteration 2) — one open
finding, AP-1 (create paths don't validate the referenced parent is in-org).

---

## Scope

Tier B: started from AP-1 and the CROSS-CUTTING note that the *operator* create
path was later fixed in the zero-trust pass, and checked whether the rest of
AP-1 was closed. The security pass had already established auth coverage (83/83),
tenant isolation on every by-id query, and no SQL injection — re-verified, not
re-derived. This 5.4k-line module was reviewed at the create-path and
invariant level, not line-by-line.

## Findings

### AP-1 — LOW→MED — Create paths don't validate `apparatus_id` is in-org — ✅ FIXED

**What the prior audit flagged:** `create_photo`, `create_document`, and the
maintenance creates stored a client-supplied `apparatus_id` without checking it
belonged to the caller's org.

**Current state, verified path by path:**
- `create_maintenance_record` — **already validated** (org-scoped
  `get_apparatus(apparatus_id, org)` at line 1069, and the maintenance-type id
  too). Not a gap.
- `create_maintenance_type` — **n/a**: it's an org-level config row with no
  apparatus FK.
- `create_operator` — **already fixed** in the zero-trust pass (validates
  apparatus_id / user_id / evoc_level_id via `assert_in_org`; the note there
  explains a foreign `user_id` would leak that user's PII through
  `list_operators`' eager-loaded relationship).
- `create_photo` / `create_document` — **still open.** Both took the
  `apparatus_id` from the `/{apparatus_id}/photos|documents` path and stored the
  row with no check, so a `POST` to `/{a_foreign_apparatus_id}/photos` created a
  photo/document row org-stamped to the caller but pointing at another org's
  apparatus.

**Impact:** consistent with the AP-1 rating — not a cross-tenant *disclosure*
(the child is org-scoped and `list_*` filters on both `apparatus_id` and org, so
the foreign-pointed row is an orphan), but a data-integrity gap: a photo or
document attached to an apparatus id that isn't the org's. LOW→MED because
apparatus documents can be inspection/compliance records.

**Fix:** `create_photo` and `create_document` now call
`assert_in_org(db, Apparatus, apparatus_id, org)` — the same helper and pattern
`create_operator` uses — and their endpoints gained the `ValueError → 400`
conversion they were missing (via `safe_error_detail`). With operator and
maintenance already covered, **AP-1 is now closed across every create path.**
Behavior is verified through `test_org_scoping.py`, which covers
`assert_in_org`'s fail-closed-on-foreign-row contract (7 tests).

### AP-2 — NIT — `== True` with a `# noqa: E712` — ✅ FIXED

The prior audit's one nit: `create_photo`'s primary-photo query used
`is_primary == True  # noqa: E712`. Swapped to `.is_(True)`, removing the noqa.
No behavior change.

## Verified good ✅ (re-confirmed from the security pass)

- **Auth:** all 83 endpoints carry an auth dependency.
- **Tenant isolation:** by-id getters filter `organization_id`; sub-resources
  (photos, documents, maintenance, EVOC, operators) each carry their own
  `organization_id` and are queried with `apparatus_id AND organization_id`, so
  a child-resource id can't be used for IDOR.
- **No SQL injection**; no PK-bypass (`db.get`/`filter_by(id=)`) patterns.
- The XC-1 create-FK gap is now closed for this module — one of the two that
  seeded the CROSS-CUTTING pattern (with medical-screening) is fully resolved.

## Duplication

None material. The four create paths now all reach for the same `assert_in_org`
helper rather than each re-implementing an org check — which is exactly the
consolidation the cross-cutting note called for.

## Dead code

None. No TODO/FIXME markers. The prior audit's note that vulture flags apparatus
route functions as "unused" remains a false positive (they're decorator-referenced
routes).

## Documentation

`docs/module-audit/apparatus.md` AP-1 is now resolved; recorded there and here.
Service docstrings remain terse ("Create photo") but accurate — not worth
churn.

## Future development

1. **No apparatus-service integration tests.** There is no `test_apparatus*.py`;
   the create-path org-scoping now rests on `assert_in_org`'s own unit tests plus
   manual reading. An integration test exercising `create_photo` against a
   foreign apparatus id would lock the wiring once MySQL is in CI.
2. **83 endpoints, ~5.4k lines, reviewed at the invariant level** across two
   passes — a future deep read of the maintenance-scheduling and EVOC-level
   business logic (not just its tenant isolation) would be the next depth
   increment, likely as its own focused iteration rather than a rotation tick.

## Completion gate

| Check | Result |
|-------|--------|
| `tsc --noEmit` | ✅ 0 errors (no frontend change) |
| `flake8 app/ tests/` | ✅ 0 violations |
| `black --check` | ✅ 503 files unchanged |
| `eslint` | ✅ clean |
| backend tests | ✅ **2517 passed, 0 failed**; `test_org_scoping.py` (the coverage backing this fix) 7/7. 648 errors, all `db_session` fixture failures against the sandbox's missing MySQL. |
</content>
