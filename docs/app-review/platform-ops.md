# Application Review — Platform Ops & Data Lifecycle

**Prefix:** `OPS` · **Iteration:** A9 · **Reviewed:** 2026-08-05 (pass 1),
2026-08-08 (pass 2) · **last of Tier A**

## Pass 2 (2026-08-08) — six-lens sweep — no code change

Re-verified the four services (SoD guard, admin-continuity, data-export,
audit-shipping) against the six lenses. **All clean, no code change:**

- **`assert_different_person`** is well-built (no-ops on missing ids, approve-only,
  `ValueError`→400) and wired into all four SoD call sites (finance approve,
  admin-hours approve, training-submission review, skills-test examine + validate).
- **Admin-continuity (ORU-7)** is wired across all five paths with the role-edit guard
  at the **service** layer so it covers every caller; org is always caller-derived,
  never client-supplied — a foreign target id merely no-ops.
- **Data-export** is self-scoped by construction (every `_EXPORT_SECTIONS` row filters
  the member's own FK; `export_user_data` takes the authenticated user only), rate-
  limited (3/hr), audited. `_serialize_value` covers datetime/date/enum/Decimal and
  the one `LargeBinary` column isn't exported — no latent-500.
- **Audit-shipping** POSTs to an **env-only** URL (no SSRF), HMAC-signed, watermark
  advances only on a 2xx ack.

### Flagged (caller-side, needs a product/config decision) — OPS-6

The sweep surfaced one MED **outside these four services**, in the finance module's
public approval path: **`finance_service.approve_by_token`** (reached by the
unauthenticated `POST /public/finance/approvals/...`) sets a step `APPROVED` with
**no `assert_different_person` guard and no approver attribution** (`acted_by` never
set) — a twin of the FIN-4-guarded `approve_step`. The token is issued only to a
chain step whose `approver_type=="email"`, sent to that step's configured
`approver_value`. Whether this bypasses FIN-4 hinges on **whether a check requester
can end up as an "email" approver on their own chain** — a chain-config question for
the owner. If external-approver-by-design is accepted, at minimum record
`acted_by`/`approver_value` on the token path for audit parity. Recorded, not fixed.
Also confirmed: OPS-4 (TR-5 auto-approve self-credit) and the AH-4 bulk-approve inline
`==` (fail-closed, but bypasses the shared helper) stand as previously flagged.

**No code changed** in the four A9 services — the verifications and the one new
caller-side flag are the deliverable.

---

**Backend:** `app/services/separation_of_duties.py` (70 L),
`admin_continuity_service.py` (216 L), `audit_ship_service.py` (136 L),
`data_export_service.py` (169 L)
**Frontend:** none (these are cross-cutting controls invoked by other modules)
**Docs:** `docs/COMPLIANCE.md`, service docstrings, and the module-audit findings
these services were built to close

---

## Scope

All four services read in full, plus every call site: the SoD helper's four
callers, admin-continuity's five guard points, the data-export endpoint, and the
audit-ship configuration. These are the *implementations* of controls the
module-audit had deferred (FIN-4, AH-4, CS-8, TR-5, ORU-7), so the review's job
here was less "find new bugs" and more **verify the deferred controls are
correctly and completely wired, and reconcile the tracking docs with the code**.

**No code was changed.** The controls are sound; the finding is that the
tracking docs drifted behind the code, in both directions (some items marked
open are fixed; one item that looked fixed is not). Correcting that is the
deliverable, because a stale limitations list makes every entry less
trustworthy — the same problem A6 caught with ORU-9.

## Verified good ✅

- **The shared SoD control is well-designed.** `assert_different_person`
  (`separation_of_duties.py`) is deliberately tiny, raises a `ValueError`
  subclass so the endpoint layer's existing `except ValueError → 400` surfaces
  it unchanged, and **no-ops when either id is missing** — an unattributed
  legacy row can't be *shown* to be self-approval, and failing closed there would
  wedge pre-existing records. Its docstring names the four paths it closes and
  invites the fifth. 8 dedicated unit tests, all passing without a DB.
- **All four wired call sites implement the control correctly** — verified each
  pairs the *approver/actor* against the *creator/subject*, guards **only the
  approve action** (rejection/withdrawal of one's own record is correctly left
  open), and each carries a comment explaining the specific conflict:
  - Finance approval step (`finance_service.py:649`) — approver ≠ request creator.
  - Admin-hours approve (`admin_hours_service.py:739`) — approver ≠ entry owner.
  - Training manual review (`training_submission_service.py:289`) — reviewer ≠ submitter.
  - Skills examination (`skills_testing.py:678`) — examiner ≠ candidate, with the
    `is_practice` carve-out.
- **Admin-continuity (ORU-7) is comprehensively wired — all five documented
  paths, at the right layer.** `assert_not_last_administrator` guards
  `delete_user`, `change_member_status`, and `archive_member` at the endpoints;
  `assert_positions_retain_administrator` guards position reassignment
  (`users.py:728`); and `assert_role_change_retains_administrator` guards role
  edit *and* delete — at the **service layer** (`role_service.py:275/300/380`),
  which is the better choice because it covers every caller, not just one
  endpoint. The "would this leave zero `members.manage` holders?" recount
  correctly applies proposed permissions, honors `"*"`/`"members.*"` wildcards,
  and counts rank defaults. (My first read flagged the role-edit path as
  unguarded because the endpoint file has no call — the guard is one layer down.)
- **Data export is self-scoped by construction.** `export_user_data(current_user)`
  drives a table registry where *every* section filters
  `getattr(model, fk_attr) == user.id` — there is no code path that accepts an
  arbitrary user id, so a member can only export their own record. Rate-limited
  to 3/hour and audit-logged. This is the right shape for a right-of-access
  export.
- **Audit-shipping has no SSRF surface.** It POSTs to
  `settings.AUDIT_SHIP_WEBHOOK_URL` — an **operator-configured env var**, not a
  user- or DB-supplied value — so the INT-1 DNS-rebinding concern (which was
  about stored, user-influenced URLs) doesn't apply. Bodies are HMAC-SHA256
  signed with the audit key, and the high-water mark advances only on a 2xx ack,
  so a failed delivery retries rather than silently dropping rows.

## Findings

All A9 findings are documentation-accuracy corrections. Each was verified against
the code before editing.

### OPS-1 — AH-4 is fixed, docs said flagged — ✅ DOC FIXED

`admin-hours.md` and the module-audit tracker listed AH-4 (officers self-approving
their own admin hours) as *flagged, product decision*. It is **fixed**:
`admin_hours_service.py:739` calls `assert_different_person` on the approve
action. Corrected the module-audit entry — and recorded the one real consequence
the doc should carry: the fix is **unconditional**, not the configurable toggle
AH-4 originally recommended, so a genuinely single-officer department can no
longer approve its own admin hours. That is an accepted cost of the ISO 27001
A.5.3 control, noted as a possible future refinement rather than a silent
behavior change.

### OPS-2 — CS-8 is half-fixed, docs said fully open — ✅ DOC FIXED

The skills-test self-certification half **is fixed** (`skills_testing.py:678`,
with the `is_practice` carve-out). The self-attestation half **is still open** —
`create_attestation` stores a client-supplied `compliance_percentage` with no
server-side recompute and no second approver, unchanged. Split the entry in both
`compliance-skills.md` and `KNOWN_LIMITATIONS.md` so the closed half isn't
re-investigated and the open half isn't assumed closed.

### OPS-3 — FIN-4 is narrowed, docs framed only the open half — ✅ DOC FIXED

The severe case — one person raising a request **and approving it** — is now
closed by the shared guard on the approval step (`finance_service.py:649`). What
`KNOWN_LIMITATIONS` describes (the *disbursement* actions `mark_pr_paid` /
`issue_check` / … under a single `finance.manage`) is genuinely still open: none
of those six methods carries an actor≠creator check or a distinct permission.
Updated the entry to record both halves, so the residual is understood as
"requester can still execute an already-approved payment" rather than the more
alarming "one person can do everything."

### OPS-4 — TR-5 looked fixed but is not — ✅ DOC CLARIFIED (no status change)

This is the one that went the *other* way, and the reason to verify rather than
pattern-match. The shared guard appears in `training_submission_service.py:289`,
which looks like TR-5 being closed. It is not: that call is in the **manual**
`review_submission` path, which the original finding already noted blocked
self-approval. TR-5 is about the **auto-approve** branch in `create_submission`
(line 114), which spawns a COMPLETED, credited record with **no reviewer at
all** — so an actor≠subject check is moot, and the shared guard does nothing for
it. Added a clarification to `training.md` that TR-5's status is **unchanged**
(still a config decision: bound the auto-approve threshold or accept it), so a
future reader doesn't tick it off on the strength of the nearby guard call.

### OPS-5 — Storefront is the last unaddressed SoD path — 🚩 FLAGGED (unchanged)

The `separation_of_duties.py` docstring names storefront as "the fifth path with
an obvious thing to call," and it remains open (SF future-dev #3 from A1). Left
flagged, but the `KNOWN_LIMITATIONS` entry now records that there are **two
non-equivalent** fixes and the choice is a real one: (a) the cheap
`assert_different_person` blocking a manager from marking their *own* order paid
or waived — mirrors AH-4, closes the self-dealing case now; or (b) a
`storefront.disburse` permission tier — broader, closes requester≠disburser
generally. Not implemented unilaterally because it changes a money workflow and
the maintainer's flag leaned toward the permission approach.

## Duplication

None — the opposite. These four services *are* the de-duplication: one
`assert_different_person` shared across finance, admin-hours, training and skills
instead of four inline checks, and one admin-continuity module instead of a
last-admin recount copy-pasted into every user-mutation path. This is the
structure A3 wished `scheduled_tasks.py` had.

## Dead code

None. Every exported function has a live caller (the one that looked orphaned —
`assert_role_change_retains_administrator` — is called from the service layer,
not the endpoint). No TODO/FIXME markers.

## Documentation gaps

The whole iteration was a documentation-gap correction; see OPS-1..4. One
forward note: there is no single place that lists the SoD control's coverage —
which paths are guarded and which are deliberately not (storefront, finance
disbursement, training auto-approve). The `separation_of_duties.py` docstring is
the closest thing and is a good anchor; a short "SoD coverage" table in
`docs/COMPLIANCE.md` referencing it would stop the next drift.

## Future development

1. **Attestation dual-control or server-side recompute** (CS-8 open half) — the
   compliance percentage should be computed, not asserted.
2. **Finance disbursement separation** (FIN-4 open half) — a `finance.disburse`
   tier, the same decision as the storefront one.
3. **Storefront SoD** (OPS-5) — pick option (a) or (b).
4. **A per-org SoD toggle**, if any single-officer department finds the
   unconditional admin-hours block (OPS-1) genuinely blocking. Not needed
   speculatively.
5. **An SoD coverage table** in the compliance docs (see above), so the set of
   guarded vs. deliberately-unguarded paths is stated once rather than inferred.

## Completion gate

| Check | Result |
|-------|--------|
| `tsc --noEmit` | ✅ 0 errors (no code changed this iteration) |
| `flake8 app/ tests/` | ✅ 0 violations |
| `black --check` | ✅ 503 files unchanged |
| `eslint` | ✅ clean |
| backend tests | ✅ `test_separation_of_duties.py` 8/8 pass; broader ops selection errors are all `db_session` fixture failures against the sandbox's missing MySQL (32 matching lines). No code changed, so the full-suite baseline (2514 passed, 0 failed) is unaffected. |

---

## Tier A complete

A9 is the last never-reviewed feature. **All 9 Tier A features are done** (A1–A9).
The rotation now moves to Tier B — the second, broader pass over the 27 modules
the [module audit](../module-audit/PROGRESS.md) already covered for security.
</content>
