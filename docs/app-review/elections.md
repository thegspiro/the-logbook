# Application Review — Elections (Tier B)

**Prefix:** `ELEC2` · **Iteration:** B5 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-06 (pass 2), 2026-08-09 (pass 3)

---

## Pass 3 (2026-08-09) — invariants re-verified; the deferred E712 sweep, done

Re-verified the module's headline invariants still hold, then swept the one
standing style item passes 1–2 had deferred.

**Re-verified:** `create_candidate`'s `user_id` validation via `assert_in_org`
(elections.py:1716) intact; `CandidateUpdate` still exposes **no FK fields** (the
update-bypass vector stays closed); the AXC-1 IP fix holds (`get_client_ip` at 6
sites, `request.client.host` at 0); `'/elections'` remains in
`UNCACHEABLE_PREFIXES`. Latent-500 lens clean: the module's only enum column
(`status`) is properly enum-typed in the schemas (no free-string→ENUM 500 path).

### ELEC2-1 — NIT — 31 `== True/False  # noqa: E712` suppressions swept — ✅ FIXED

Passes 1–2 deferred this deliberately, citing churn/risk in the codebase's most
security-critical file (hash-chained audit, ballot forensics). On closer analysis
the risk is churn, not semantics: all 31 are `.where(<boolean flag> == True/False)`
on `User.is_active` / `Vote.is_test` / `Vote.is_manual` / `VotingToken.used` /
`Candidate.accepted` / `Candidate.is_write_in` — the `.is_(True)`/`.is_(False)`
conversion changes only the SQL boolean-predicate syntax, never which rows match, so
it cannot affect vote counting, dedup, or the hash-chain (which operate on data
values, not on this WHERE syntax). Swept all 31 (Pitfall #10), removing every E712
noqa from the module — now consistent with the B2/B3/B4 sweeps. flake8/black clean;
82 non-DB election tests pass unchanged.

### Future development (unchanged)

The prior audits enumerated the remaining product/feature decisions; no further
code work identified. The R-D2 audit-log-IP residual note stands (pre-change
anonymous-election audit rows keep voter IPs by hash-chain design — tamper-evidence
over scrubbing).

**Completion gate (pass 3):** `flake8` 0 · `black --check` clean · `tsc --noEmit` 0
(no frontend change) · eslint unaffected · elections tests **82 passed** (all
DB-free; the 121 `db_session` errors are the known no-MySQL fixture failures,
unchanged by this behavior-neutral sweep).

---

## Pass 2 (2026-08-06) — clean-module verification, no code change

Ran the elections FK surface through the four lenses that have been productive
across B1–B4 (update-bypass, projection read-leak, MS2-4 unpopulated names, and
newer FK-input paths beyond the create cluster). **Every one comes back clean** —
a real result for the most-audited module in the codebase, not a rubber stamp.

- **Candidate update-bypass — not present.** `create_candidate` validates
  `user_id` via `assert_in_org` (pass 1), and `CandidateUpdate` exposes **no FK
  fields at all** (only name/position/statement/photo/accepted/display_order), so
  the blind `setattr` loop in `update_candidate` has nothing org-sensitive to
  reassign — `user_id`/`election_id` cannot be changed post-create. This is the
  B2 operator pattern (update omits the FK), verified here.
- **Projection read-leak — not present.** `CandidateResponse` is scalar-only
  (`user_id`, `nominated_by` as bare ids; `name` is the candidate's own stored
  column). No `User` relationship is eager-loaded into a candidate response, so
  there is no AP2-1/INV2-1 member-name leak vector.
- **MS2-4 — not present.** The one place that could exhibit it — the manual-ballot
  batch listing, whose schema declares `recorded_by_name` / attestation `name` /
  `candidate_name` — **populates them correctly**: `list_manual_ballot_batches`
  batch-resolves the recorder/attestor names (service 3318-3326) and joins the
  candidate name (3298), rather than returning a bare ORM row. The MS2-4 pattern
  done right.
- **The newer FK-input paths validate in-org.** `create_nomination` requires the
  `nominee_user_id` to be an **active member of the caller's org** (service
  2800-2808); `merge_write_in_candidates` resolves every source/target id under an
  org-scoped election via `election_id == X AND id IN (…)`, so a foreign candidate
  id falls out as "missing" (3546-3554). Both fail closed.

One minor observation (not fixed, consistent with INV2-2): `election_service.py`
carries ~31 `== True/False # noqa: E712` suppressions. They are suppressed
(flake8 is clean) and this is the codebase's most security-critical file
(hash-chained audit, ballot forensics) — a pure-style sweep with no other change
here is not worth the churn/risk; recorded as a standalone cleanup.

**No code changed.** The verifications above are the deliverable, same disposition
as pass 1 (and the same shape as the B20 finance / B26 public-portal clean passes).

---

## Pass 1 (2026-08-06)

**Prefix:** `ELEC2` · **Iteration:** B5 · **Reviewed:** 2026-08-06

**Backend:** `app/api/v1/endpoints/elections.py` (2,721 L, 46 endpoints),
`app/services/election_service.py` (4,616 L), `quorum_service.py`
**Frontend:** `modules/elections`
**Prior audit:** `docs/module-audit/elections.md` — the most heavily reviewed
module in the codebase: iteration 5 (security-critical), plus a full 2026-07
follow-up (R-1…R-13) and a practical-workflow pass (R-D1…R-D5).

---

## Scope

Tier B on the most-audited module. Rather than re-derive the two exhaustive
security passes, this iteration **verified their fixes still hold**, resolved
the one finding the tracker still listed open (ELEC-7), and applied the broader
lens (dead code, docs, frontend pitfalls, and consistency with the AXC-1 sweep
this review made earlier).

**No code change was needed — the module is clean.** That is a real outcome for
the surface that has had the most scrutiny, not a shallow pass; the verifications
below are the deliverable.

## Findings

### ELEC-7 — LOW — `create_candidate` user_id unvalidated — ✅ ALREADY FIXED (doc corrected)

The tracker listed this XC-1 gap as open. It is **fixed**: `create_candidate`
(`elections.py:1669`) resolves the election org-scoped, then validates
`candidate.user_id` via the shared `assert_in_org` helper with `allow_none=True`
(write-ins) and `ValueError → 400`. This landed in the zero-trust review; the
module-audit entry had simply never been ticked. Corrected there.

With ELEC-7 closed, **every** elections finding across all three prior passes is
resolved.

## Verified good ✅ (re-confirmed this pass)

- **AXC-1 fix holds.** The vote-recording paths use `get_client_ip(request)`
  (5 sites), not `request.client.host` (0) — the earlier cross-cutting sweep is
  intact, so per-vote IPs (which feed the fraud detection documented in
  `BALLOT_FORENSICS_GUIDE.md`) resolve to the real client behind the proxy.
- **ELEC-7 XC-1 closed** (above).
- **No dead code.** An AST unreferenced-private scan flagged only
  `_notify_leadership_of_deletion`, which is a false positive — it's called from
  `elections.py:992` (the scan was service-file-local). ELEC-9's genuinely dead
  max-votes branch was already removed in iteration 5.
- **No TODO/FIXME markers** anywhere in the module.
- **Frontend clean:** no Pitfall #1 (`??` on outgoing form values), no banned
  date APIs (`toLocaleDateString`/`date-fns`), and the R-10e cache fix is intact
  — `'/elections'` (no trailing slash) is in `UNCACHEABLE_PREFIXES`, so the list
  endpoint is excluded.
- **The headline security invariants from the prior passes remain in place** by
  inspection: 512-bit tokens hashed at rest (ELEC-5), anonymous-ballot IP purge
  at close (ELEC-6), the eligibility gate on `cast_vote` (ELEC-1), the
  org-scoped candidate update/delete (ELEC-2), the method-aware dedup hash
  (ELEC-3), and the rollback-double-vote guard (ELEC-4).

## Duplication

None found beyond the deliberate shared-source-of-truth the R-7 fix introduced
(`annotate_ballot_items_for_user`, from which the eligibility filter derives) —
which is *de*-duplication, the correct direction.

## Dead code

None (see the false-positive note above).

## Documentation

- `docs/module-audit/elections.md`: ELEC-7 corrected to fixed.
- `BALLOT_FORENSICS_GUIDE.md` remains accurate; note its dependence on the
  AXC-1 IP fix (verified holding) — a reader relying on `suspicious_ips` needs
  `TRUSTED_PROXY_IPS` set, the deployment caveat recorded in
  [`CROSS-CUTTING.md`](./CROSS-CUTTING.md).

## Future development

The prior audits already enumerated the design decisions. The one forward note
this pass adds:

1. **The audit-log IP residual (R-D2) is permanent by design** — voter-action
   audit rows written before the `_audit_ip` change keep their IPs because
   `ip_address` is in the hash-chain input. That is correct (tamper-evidence
   over scrubbing), but it means a pre-change anonymous election's audit trail
   still carries voter IPs. Worth a one-line note in the operator/forensics docs
   so it isn't mistaken for a leak — the *forensics API* is threshold-only, but
   the *raw audit rows* from before the change are not.
2. **No further code work identified.** This module is at the point where the
   next increment is product/feature decisions, not defect-fixing.

## Completion gate

| Check | Result |
|-------|--------|
| `tsc --noEmit` | ✅ 0 errors (no change this iteration) |
| `flake8 app/ tests/` | ✅ 0 violations |
| `black --check` | ✅ 503 files unchanged |
| `eslint` | ✅ clean |
| backend tests | ✅ unchanged — no code modified. Full suite baseline (2517 passed, 0 failed) stands. |
</content>
