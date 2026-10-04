# Application Review — Member Lifecycle & Offboarding

**Prefix:** `LIFE` · **Iteration:** A6 · **Reviewed:** 2026-08-05 (pass 1),
2026-08-08 (pass 2), 2026-10-04 (pass 3)

> **Finding ids continue at LIFE-5.** LIFE-1…LIFE-4 are taken by passes 1–2.

## Pass 3 (2026-10-04) — the +602 lines passes 1–2 never saw

Every one of the six services has grown since pass 2, and two of them by more
than half:

| Service                        | Pass 2 | Now | Δ        |
| ------------------------------ | ------ | --- | -------- |
| `membership_tier_service`      | 267    | 471 | **+76%** |
| `retention_service`            | 224    | 357 | +59%     |
| `property_return_service`      | 529    | 658 | +24%     |
| `member_anonymization_service` | 283    | 375 | +33%     |
| `member_archive_service`       | 322    | 359 | +11%     |
| `departure_clearance_service`  | 572    | 579 | +1%      |

So this pass went at the growth, and at the half of `property_return_service`
pass 2 recorded as **sampled rather than read** — the honest scope note that
tells a later pass where to look. **2 fixes, 1 hardening, 1 verification
mechanised.**

### LIFE-5 — MED — A tier advance committed the change and discarded its audit trail — ✅ FIXED

**What:** `advance_all` committed the membership-type changes and _then_ wrote
their audit events, leaving the trail dependent on somebody else committing
afterwards. On the scheduled path nobody does:

```
main.py:1848   async with async_session_factory() as db:   # close(), no commit
main.py:1849       result = await runner(db)
                     run_membership_tier_advance(db)
                       _for_each_org(db, ...)              # never commits
                         advance_all(org)                  # commits changes,
                                                           #  THEN audits
```

`log_audit_event` opens a SAVEPOINT (`db.begin_nested()`); releasing it does
not commit the enclosing transaction, and `AsyncSession.__aexit__` only calls
`close()`.

**Where:** `membership_tier_service.py:447-459` (pre-fix).

**Impact:** **measured, not reasoned about.** A cron-shaped advance — seed in
one session, `advance_all` in a session closed without committing, read back in
a third — reported `advanced: 1`, persisted the member as `senior`, and wrote
**zero** `membership_tier_auto_advanced` rows. After the fix the same run wrote
one, with the advancement still persisted.

That matters more than a missing log line. This job runs unattended, and it
**clears the operational rank** of anyone it moves into an administrative tier
(`:430-434`) — the audit row is the only record that those permissions went
away. The payload carries `cleared_rank` precisely so somebody can see it.

The endpoint path (`member_status.py:982`) survived the original ordering only
because FastAPI's `get_session` dependency commits on teardown. A service
should not depend on its caller to persist its own audit trail.

**Fix:** audit inside the same transaction as the change, then one commit for
both. Written after the mutations and before the commit deliberately: the
SAVEPOINT means an audit failure rolls back only itself and still lets the
advancement land, while a success is durable with the row it describes rather
than separately from it. That also closes a smaller pre-existing hole on _both_
paths — the change and its audit record previously committed separately, so a
crash between them left an unaudited change.

**Scope checked before fixing:** an AST scan of all six services for
"audit-after-commit with no later commit" found this site and no other, so it
is one fix rather than a class.

**Guarded:** `tests/test_membership_tier_audit_durability.py` (3 tests, `unit`,
so they run in the no-database job). Restoring the original order fails
`test_the_audit_write_precedes_the_commit`, and the empirical probe re-measures
zero audit rows. The guard pins the ordering rather than the durability, and
says so: measuring durability needs three real sessions and a committing write,
which is not something to leave in a suite whose fixture rolls back.

### LIFE-6 — LOW — The property-return letter resolved its member without an org filter — ✅ FIXED (hardening)

**What:** `generate_report` fetched the member with
`select(User).where(User.id == str(user_id))` — no `organization_id`
(`property_return_service.py:77`, pre-fix). Pass 2 flagged this as
defence-in-depth, "both callers pre-verify org, so not live".

**Re-verified, and the caller count has changed:** there is now exactly **one**
caller, the drop path at `member_status.py:427`, and it does resolve the member
in-org first. So it is still not live. The two `generate_report` call sites in
`scheduled_tasks.py` belong to `ComplianceReportService`, not this one.

**Fixed rather than flagged a third time** because it is a one-line,
behaviour-preserving change in the single path that builds a letter naming a
member and stating a chargeable liability: an unscoped by-id fetch there is one
upstream mistake away from addressing another department's member. Behaviour
differs only in the case that is currently a bug — the service now raises its
existing `Member not found` instead of generating the letter.

### Anonymization PII coverage — mechanised, and it caught my own bad method first

Pass 2 diffed the `User` columns against the ones anonymization clears **by
hand**, found nothing missed, and recorded the problem with having done it that
way: a PII column added later is not picked up and nothing notices. `User` has
since gained a column (58 → 59). The check is now
`tests/test_anonymization_pii_coverage.py` (3 tests, `unit`), in the ratchet
shape `test_org_scoping_ratchet` uses: a new column fails the build until
somebody classifies it, either by clearing it or by naming it with a reason.

**Re-run correctly, no PII column is missed** — the 28 untouched attributes are
row identity and tenancy, department-assigned keys, operational role and
standing, sign-in metadata with no credential left behind it, interface
preferences, and one pointer to a different member. Pass 2's conclusion holds.

Worth recording **how the first attempt got it wrong**, because the trap is in
the test now: `sa_inspect(User).columns` is keyed by _column_ name, and for an
encrypted field that is not the attribute the service assigns. The MFA secret
appears there as `mfa_secret` while the service correctly writes
`_mfa_secret_encrypted`. Diffing those two namespaces made a scrubbed field look
untouched, and briefly suggested the service ignored MFA secrets — against a
docstring that explicitly promises them — when it clears them on three adjacent
lines. The third test now asserts the docstring's credential claim against the
code directly, which is the ELEC-5/CI-5 check applied to this file.

### Verified good this pass

- **`retention_service` is structurally sound where it matters most.** All six
  registered record classes were checked mechanically rather than by eye: every
  one has the `timestamp_attr` it declares and an `organization_id` column, and
  the one `row_filter` (`practice_skill_tests`, which shares a table with
  official results that must never be swept) builds without error. A mismatch
  here would fail inside the per-org `except`, be logged, and silently never
  sweep that class.
- **`enforce()` is cron-only.** Its `results["errors"]` carry raw `str(e)`,
  which would be an exposure if an endpoint returned them — checked, and the
  only callers are `scheduled_tasks.py:3831` and `:3848`. The two exposed
  endpoints use `get_policy` / `set_policy` only.
- **The retention endpoints are gated and scoped.** Both require
  `settings.manage` **or** `organization.update_settings`, resolve the org from
  `current_user.organization_id`, and `days` is `int | None` with `ge=0`, so
  `set_policy`'s floor comparison cannot be handed a string. `set_policy`
  flushes and the endpoint commits (`organizations.py:1756`) — the setting
  actually persists, which is the Pitfall #19 failure this could have been.
- **`advance_all`'s concurrency handling is careful and was left alone.** It
  re-selects each candidate `with_for_update()` + `populate_existing=True`,
  re-checks eligibility under the lock because the batch read may be stale, and
  counts off-ladder members rather than silently skipping them. The comments
  name the specific defects each guard closes.
- **No float on money anywhere in `property_return_service`** — LIFE-4's fix
  held, and nothing new reintroduced it.

### Re-verified, still open

- **LIFE-2** (per-unit value divides in float, `departure_clearance_service.py`)
  — unchanged, still deferred to the module-wide FIN-7 float→Decimal refactor.
- **LIFE-3** (a row whose retention timestamp is NULL is never eligible, since
  `ts_col < cutoff` is unknown for NULL) — unchanged at
  `retention_service.py:238`, and still arguably the safer default.
- **The pool-issuance valuation disagreement** — the return letter charges the
  full item value × quantity while the clearance service values it per-unit, so
  two member-facing figures disagree. An owner reconciliation, untouched.
- **The anonymization docstring still does not mention that
  `membership_number` / `previous_membership_number` survive.** Pass 2 asked for
  one line and it has not been added. Now also encoded in the coverage test's
  "department-assigned keys" group, so the reasoning is at least somewhere a
  reader will hit.

### Pass 3 completion gate

| Check                       | Result                                                                  |
| --------------------------- | ----------------------------------------------------------------------- |
| `npm run typecheck`         | ✅ 0 errors (no frontend change)                                        |
| `flake8 app/ tests/`        | ✅ 0 violations                                                         |
| `black --check app/ tests/` | ✅ unchanged                                                            |
| `isort --check-only`        | ✅ clean                                                                |
| `npm run lint`              | ✅ 0 errors                                                             |
| Docs link check             | ✅ 0 broken                                                             |
| Lifecycle-related tests     | ✅ **257 passed, 1 skipped**                                            |
| Whole backend suite         | ✅ **15,723 passed, 21 skipped, 0 failed** after the baseline fix below |

**The whole-suite run found a failure the targeted selection could not.**
`test_org_scoping_ratchet.py::test_baseline_has_no_stale_entries` went red on
LIFE-6: the ratchet freezes the unscoped by-id queries that existed on
2026-09-06, and adding the org filter resolved one of them, so its baseline
entry went stale. The test checks **both** directions and said exactly what to
do — _"If you fixed them, delete the lines"_ — so the line is gone
(`tests/org_scoping_baseline.txt`, 215 → 214 entries) and the ratchet's 12
tests pass.

Worth drawing the procedural lesson rather than just the fix: the pre-commit
hook passed, and so did the 257-test lifecycle selection, because neither
covers a check that sweeps the whole repository for a query _shape_. A one-line
org filter is exactly the kind of change whose only observer is the global
ratchet. CLAUDE.md's "match the verification to the change" still holds — but
when a change touches a pattern the repo polices globally, the whole suite is
the matching verification.

**One self-inflicted failure worth recording.** The first lifecycle run showed
4 failures in `test_audit_retention_archival.py`. They were not a regression:
the probe that measured LIFE-5 cleaned up its organization and user but **not
the audit row it caused**, and that row was the only one in `audit_logs`, which
is a table those tests make assumptions about. Deleting it returned all 8 to
green. This is the second time in this review cycle that a scratch script's
incomplete cleanup produced failures in an unrelated file — the lesson is that
a probe which writes through a service must clean up what the _service_ wrote,
not just what the probe inserted.

---

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
handle `Decimal`; the valuation _methodology_ (flagged separately) was left untouched.
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
  is org-scoped with the comment _"never resolve a target across tenants"_;
  the endpoint requires `members.manage`, **blocks self-anonymization**, and
  the service enforces preconditions (already-anonymized is rejected as
  idempotent; only _departed_ members qualify).
- **The anonymization contract is documented and the code matches it.** The
  module docstring enumerates what is scrubbed _and what is deliberately kept_
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
  _(2026-09-24: `process_reminders` is now also run daily by the
  `property_return_reminders` scheduled task, per organization through
  `_for_each_org`; before that nothing called it.)_
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
  machine as _deferred_ under ORU-9, although the module-audit file records it
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
   unattended on a daily cron. `enforce()` returns counts _after_ deleting;
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

| Check                | Result                                                                                                                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsc --noEmit`       | ✅ 0 errors (no frontend change)                                                                                                                                                                                        |
| `flake8 app/ tests/` | ✅ 0 violations                                                                                                                                                                                                         |
| `black --check`      | ✅ unchanged                                                                                                                                                                                                            |
| `eslint`             | ✅ clean                                                                                                                                                                                                                |
| backend tests        | ✅ **2508 passed, 0 failed**; the 62 lifecycle-related tests pass. 648 errors, all `db_session` fixture failures against the sandbox's missing MySQL (39 matching connection/timeout lines in the lifecycle selection). |

</content>
