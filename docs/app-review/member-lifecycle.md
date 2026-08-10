# Application Review — Member Lifecycle & Offboarding

**Prefix:** `LIFE` · **Iteration:** A6 · **Reviewed:** 2026-08-05 (pass 1),
2026-08-08 (pass 2)

## Pass 2 (2026-08-08) — six-lens sweep

Re-verified the irreversible operations: anonymization org-scoped with a
never-cross-tenant fetch + self-block + departed-only + idempotent; retention
excludes documents/minutes, floors enforced twice, Pitfall-#12 deepcopy; auto-archive
checks all four property categories; **every by-id anonymize/archive/clearance
resolves org-scoped (XC-3 clean — an admin cannot touch another org's member)**;
LIFE-1 (clearance total is Decimal) holds. **1 fix.**

### LIFE-4 — MED (money) — Property-return letter totalled the chargeable value as float — ✅ FIXED

`property_return_service.generate_report` accumulated the "Total Assessed Value" in
the member's formal return letter as `float` (`total_value = 0.0`;
`float(item.current_value …)`) — the exact LIFE-1 bug class, unfixed in this sibling.
The letter renders this figure and the involuntary notice states the member may be
pursued for "the cost of unreturned or damaged items," so it is a legally chargeable
liability computed through float. **Fix:** accumulate as `Decimal` (mirroring the
clearance service), verified safe across all consumers — `:,.2f` formatters, the
FastAPI response encoder, and the audit path (`json.dumps(..., default=str)`) all
handle `Decimal`; the valuation *methodology* (flagged separately) was left untouched.
Existing 23 property-return tests pass.

**Flagged (unchanged / new):** LIFE-2 (per-unit float division — FIN-7 refactor).
New: pool-issuance valuation charges the **full** item value × qty in the return
letter while the clearance service values it **per-unit** — the two member-facing
figures disagree; a methodology reconciliation for the owner, not a drive-by. Also
noted: `generate_report`'s member fetch has no org filter (both callers pre-verify
org, so not live — DiD), and the anonymization file-before-row delete ordering is the
accepted DOC-1 tradeoff.

---

**Backend:** `app/services/departure_clearance_service.py` (572 L),
`property_return_service.py` (529 L), `member_archive_service.py` (322 L),
`member_anonymization_service.py` (283 L), `membership_tier_service.py` (267 L),
`retention_service.py` (224 L); exposed through
`endpoints/member_status.py` (12 routes), `users.py` (anonymize),
`inventory.py` (clearances), `organizations.py` (retention policy)
**Frontend:** members admin area
**Docs:** `docs/COMPLIANCE.md`, service docstrings

---

## Scope

The irreversible operations were the priority: anonymization (right to erasure),
retention enforcement (unattended deletion by cron), and archival. Read in full:
`member_anonymization_service`, `retention_service`, `member_archive_service`'s
auto-archive path, and the clearance value computation. Read for scoping and
gating: all 12 `member_status` routes and the clearance endpoints.

Sampled rather than read line-by-line: the resolution/disposition half of
`departure_clearance_service` and most of `property_return_service` — both are
inventory-operation orchestration whose per-item logic belongs to B3.

**This feature area is in good shape.** The consequential paths are careful, and
two lessons from earlier findings (DOC-1's orphaned files, AH-2's global cron
endpoint) are visibly applied here.

## Verified good ✅

- **Anonymization is well-guarded on every axis.** `get_user_for_anonymization`
  is org-scoped with the comment *"never resolve a target across tenants"*;
  the endpoint requires `members.manage`, **blocks self-anonymization**, and
  the service enforces preconditions (already-anonymized is rejected as
  idempotent; only *departed* members qualify).
- **The anonymization contract is documented and the code matches it.** The
  module docstring enumerates what is scrubbed *and what is deliberately kept*
  — audit logs (append-only, hash-chained: "rewriting them is tampering"),
  votes/ballots (election-integrity signatures), and operational history now
  pointing at an anonymized shell. Every claimed operation was verified present:
  sessions and password history deleted, size preferences deleted, screening
  records' medical content scrubbed, free-text reason fields cleared across
  leaves/waivers/RSVPs, external mappings' duplicated name/email cleared.
  This is the claim-vs-code check that caught ELEC-5 and CI-5 — here the claims
  hold.
- **Applicant documents are removed from disk, not just the database.**
  `_scrub_prospect` walks `ProspectDocument` rows and `os.remove`s each
  `file_path` before deleting the rows — with a comment saying why. These are ID
  photos and background checks, so this is precisely where DOC-1's
  orphaned-file bug would have been most damaging. The lesson was applied.
- **PII coverage checked mechanically**, not by eye: diffing the 58 `User`
  columns against the 31 the service clears leaves only operational flags
  (`membership_type`, `email_verified`, `password_changed_at`,
  `must_change_password`) and the department-assigned membership numbers, which
  are the operational key the anonymized shell is meant to retain. No PII field
  is missed.
- **Retention enforcement is conservative by design.** Documents and meeting
  minutes are explicitly excluded from auto-deletion — the docstring's reasoning
  (statutory retention varies by state; destroying official records on a timer
  is a human decision) is exactly right. Per-class floors are enforced **twice**:
  at `set_policy` and again at `enforce`, "in case settings were edited outside
  the API". Deletes are batched to avoid long table locks. `set_policy` cites
  Pitfall #12 and uses `copy.deepcopy` — so the setting actually persists.
- **Auto-archive checks all four outstanding-property categories** (assignments,
  checkouts, pool issuances, open clearances), each org-scoped, before
  transitioning a dropped member to ARCHIVED.
- **Cron-task endpoints are org-scoped — the AH-2 lesson.** Both
  `POST /property-return-reminders/process` and `POST /advance-membership-tiers`
  pass `current_user.organization_id`, and the services require it as a
  non-optional parameter, so neither can fan out across tenants by accident.
- **Org scoping verified mechanically across all six services**: every method
  taking `organization_id` uses it. All 12 `member_status` routes require
  `members.manage`.
- **ORU-9's deferred item is done.** The `member_status` lifecycle state machine
  now exists (`ALLOWED_STATUS_TRANSITIONS`) with genuinely considered
  transitions — suspension must resolve to reinstatement or termination rather
  than laundering into leave/retirement, and ARCHIVED is isolated on both sides
  so the dedicated endpoints stay the only doors.

## Findings

### LIFE-1 — LOW — Clearance total summed through float — ✅ FIXED

**What:** `initiate_clearance` accumulated the clearance total with
`sum(float(li.item_value or 0) for li in line_items)`, then converted back to
`Decimal`.

**Where:** `departure_clearance_service.py:197`.

**Impact:** low in magnitude, but it is a member's **financial liability** — the
clearance total is what a departing member can be charged for unreturned gear
(the `/inventory/charges` endpoint is described as "per-member cost-recovery /
financial liability"). Each `item_value` is an exact `Numeric(10, 2)`; routing
them through binary floating point to add them up reintroduces representation
error into that figure.

The tell that this was an oversight rather than a choice: **the same file already
does it correctly** 350 lines later — `get_clearance_summary` accumulates with
`Decimal("0")` and `Decimal(str(...))`.

**Fix:** summed as `Decimal` with a `Decimal("0")` start value, matching the
file's own established pattern, and dropped the now-redundant round-trip
through `str(round(...))`.

### LIFE-2 — LOW — Per-unit value divides in float — 🚩 FLAGGED

**What:** `per_unit_value = float(item.current_value or 0) / max(1, quantity …)`
(`departure_clearance_service.py:170`), later multiplied by the issued quantity
and rounded to cents.

**Impact:** bounded — the result is rounded to 2 decimals before storage, so the
error cannot exceed a cent per line. But it is float arithmetic on money, in the
same computation LIFE-1 fixed.

**Why not fixed:** unlike the sum, converting this to `Decimal` division would
change results at the sub-cent rounding boundary — potentially ±1 cent per line
on figures a member may already have been charged. That is a behaviour change on
financial data and belongs with the **FIN-7 module-wide float→Decimal refactor**
already recorded in KNOWN_LIMITATIONS, done deliberately and with a migration
plan, rather than as a drive-by in a review.

### LIFE-3 — NIT — Rows with a null timestamp are never retention-eligible — OPEN

**What:** `_delete_expired` filters `ts_col < cutoff`. SQL NULL comparisons are
unknown, so a row whose retention timestamp was never populated (e.g. a
`MessageHistory` that failed before `sent_at` was set) is never deleted.

**Impact:** negligible, and arguably correct — refusing to destroy a record you
cannot date is the safer default for a retention system. Recorded so it is a
decision rather than an accident.

## Duplication

None material. The six services have genuinely distinct responsibilities, and
the one place they could have diverged — the "does this member still hold
anything?" question — is asked consistently: `check_and_auto_archive` and the
clearance initiation both enumerate the same four categories with the same
org-scoped filters.

## Dead code

None found. No TODO/FIXME markers across the six services.

## Documentation gaps

- **Fixed:** `KNOWN_LIMITATIONS.md` still listed the `member_status` state
  machine as *deferred* under ORU-9, although the module-audit file records it
  as fixed on 2026-07-31 and the code is present. Corrected, with a note that
  nothing deferred remains under ORU-9. This is exactly what the checklist's
  "re-verify findings left open" step is for — a resolved item left marked open
  makes the whole limitations list less trustworthy.
- **Not fixed:** `membership_number` / `previous_membership_number` survive
  anonymization. That is almost certainly deliberate (they are the operational
  key the anonymized shell is built around, and the docstring's whole premise is
  that operational rows keep pointing somewhere), but the docstring's "what is
  deliberately NOT touched" list does not mention them. Worth one line, since a
  privacy reviewer will ask.

## Future development

1. **Anonymization has no dry run.** It is irreversible by design and touches a
   dozen tables; an officer gets no preview of what will be scrubbed. A
   report-only mode returning the same summary dict without committing would
   make the operation far less frightening to use.
2. **No test asserts anonymization completeness.** The PII-column diff performed
   in this review is exactly the check that should run in CI: a new PII column
   added to `User` will not be picked up by the service and nothing will notice.
   A structural test in the shape of `test_scheduled_tasks_structure.py` would
   catch it.
3. **Retention enforcement has no dry run or preview either**, and it deletes
   unattended on a daily cron. `enforce()` returns counts *after* deleting;
   there is no "what would this remove" call for an admin about to lower a
   retention setting.
4. **Retention covers three record classes.** The registry is designed for easy
   extension ("adding one here is the whole registration") but audit-adjacent
   PII stores — error logs with user context, access logs — are not yet
   enrolled.
5. **Clearance write-off/waiver has no separation of duties.** The same
   `members.manage` holder can both assess an item as unreturned and waive its
   value. Same shape as FIN-4, AH-4 and the storefront SoD item; worth folding
   into whichever SoD decision is taken rather than deciding separately.

## Completion gate

| Check | Result |
|-------|--------|
| `tsc --noEmit` | ✅ 0 errors (no frontend change) |
| `flake8 app/ tests/` | ✅ 0 violations |
| `black --check` | ✅ unchanged |
| `eslint` | ✅ clean |
| backend tests | ✅ **2508 passed, 0 failed**; the 62 lifecycle-related tests pass. 648 errors, all `db_session` fixture failures against the sandbox's missing MySQL (39 matching connection/timeout lines in the lifecycle selection). |
</content>
