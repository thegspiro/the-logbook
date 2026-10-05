# Application Review — Platform Ops & Data Lifecycle

**Prefix:** `OPS` · **Iteration:** A9 · **Reviewed:** 2026-08-05 (pass 1),
2026-08-08 (pass 2), 2026-10-05 (pass 3) · **last of Tier A**

## Pass 3 (2026-10-05) — the control pass 2 flagged got built

Pass 2 changed no code; its deliverable was reconciling the tracking docs with
four sound services. Pass 3's job is therefore a delta, and the delta is large
in one specific place: **`assert_different_person` has gone from 4 call sites to
20, across 8 modules**, and three of pass 2's own flagged items are closed as a
result. **4 fixes, 2 flagged.**

Two of the four services are byte-identical to what pass 2 signed off
(`separation_of_duties.py` 70 lines, `admin_continuity_service.py` 216). The
other two grew — `audit_ship_service.py` 136 → 165 and
`data_export_service.py` 169 → 192 — and were read in full. For the unchanged
pair the drift risk is not the service but its **call sites**, so those were
re-enumerated from the AST rather than grepped.

### What closed since pass 2 ✅

| Pass 2 item                                         | Status now                                                                                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OPS-3** — FIN-4's disbursement half open          | **Closed.** `mark_pr_paid`, `mark_expense_paid`, `issue_check` and `waive_dues` each now compare the actor against the requester/submitter/member.      |
| **OPS-5** — storefront, "the last unaddressed path" | **Closed**, by pass 2's option (a). Five call sites: `record_payment`, `mark_order_paid`, `waive_order_payment`, `refund_order`, `update_order_status`. |
| **OPS-6** — public `approve_by_token` unguarded     | **Closed**, by a better mechanism than proposed — see below.                                                                                            |
| Admin-continuity wiring (5 paths)                   | Now **7** call sites; all still at the service layer where that was the right call.                                                                     |

**OPS-6 closed differently, and pass 2's residual recommendation should not be
implemented.** Pass 2 asked for the guard plus, "at minimum, record
`acted_by`/`approver_value` on the token path for audit parity." The guard half
is done, and well: an external approver has no Logbook id to compare, so the
conflict is enforced **by address** instead — a step whose `approver_value`
equals the requester's own email is refused unless that step explicitly sets
`allow_self_approval`, which is exactly the chain-config decision pass 2 said
the owner had to make. The attribution half should be dropped rather than
carried forward: `ApprovalStepRecord.acted_by` is a **foreign key to
`users.id`** with an `actor` relationship, so there is no value an external
approver could be written into it — NULL is correct, not an omission. And
copying `approver_value` into the audit payload would put an email address in
an audit log payload, which CLAUDE.md's PII rule forbids; the event already
carries `step_record_id`, which is the join key to the step that holds
`approver_value`. The attribution is reconstructible without the disclosure.

### OPS-9 — Audit shipping blamed every `ValueError` on the collector URL — ✅ FIXED

`ship_new_audit_logs` wrapped the URL guard and the whole batch loop in one
`try`, with a single `except ValueError` that reported
`f"unsafe collector URL: {exc}"`. Only the guard raises URL errors; a
`ValueError` from anywhere in the loop — a missing or malformed audit signing
key being the realistic one, since `_sign` calls
`_get_audit_signing_key()` per batch — was reported to the operator as a URL
problem. That sends them to `AUDIT_SHIP_WEBHOOK_URL`, which is fine, while the
key stays broken and the audit trail keeps not shipping.

**Fix:** the URL check gets its own `try`/`except` and now runs **before**
`_get_or_create_state`, so a blocking DNS resolution is no longer held across
a `FOR UPDATE` row lock and a run that cannot ship creates no watermark row.
The in-loop handler is still deliberately broad but now reports
`delivery aborted: <type>: <message>`.

**It still returns rather than raises, on purpose.** Letting the loop's
`ValueError` propagate was the first shape of this fix and was wrong: the
scheduler wraps each task in `except Exception` and would have logged it
correctly, but the **manual** `/scheduled/run-task` trigger does not wrap the
runner at all, so a misconfiguration would have turned a 200-with-an-error-dict
into a 500. Both callers treat the results dict as the contract.

Two tests: a signing-key failure does not mention the URL and ships nothing
with the watermark unmoved; an unsafe URL still names the URL and — the new
part — takes no row lock at all (`db.execute.assert_not_called()`).

### OPS-10 — The data export's visibility check duplicated a rule and failed open — ✅ FIXED

Shift completion reports are evaluations _about_ a trainee, so the export
withholds the fields the organization's training config hides. It resolved each
one as:

```python
if not visibility.get(setting, setting != "show_officer_narrative")
```

That second argument is a **second copy of a policy the model owns**:
`TrainingModuleConfig.to_visibility_dict()` already coerces every key through
`_b(val, default=True)` with `show_officer_narrative` defaulting `False`. It is
also unreachable, because that method always returns every key — which is why
this is LOW rather than a live disclosure.

It is still worth removing, for the direction it fails in. A missing key
resolved to **visible** for every setting but one, and an export is the one
path where silently handing a member their officer's written evaluation cannot
be taken back. Pitfall #29's rule — consume the backend's decision, don't
re-derive it — and CLAUDE.md's "fail closed in access-control helpers" point
the same way.

**Fix:** `visibility.get(setting, False)`. One integration test patches
`get_config` to drop a key and asserts the field is withheld rather than
exported; mutation-verified against the old default.

### OPS-11 — `KNOWN_LIMITATIONS.md` contradicted itself about FIN-4 — ✅ DOC FIXED

Two rows in the same file disagreed. The **FIN-4** row said "**Still open:** the
_disbursement_ actions (`mark_pr_paid`, `mark_expense_paid`, `issue_check`,
`void_check`, `record_dues_payment`, `waive_dues`, `unwaive_dues`) are all gated
only by `finance.manage`." The **money-disbursement** row, updated through
2026-09-08, said a `finance.manage` holder "can no longer mark their _own_
purchase request or expense report paid, issue a check for their own request, or
waive their own dues."

The second is right. Verified each of the seven named methods individually
rather than taking either row's word:

| Method                | State                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| `mark_pr_paid`        | guarded                                                                                                        |
| `mark_expense_paid`   | guarded                                                                                                        |
| `issue_check`         | guarded                                                                                                        |
| `waive_dues`          | guarded                                                                                                        |
| `void_check`          | **correctly unguarded** — no actor parameter, and a reversal: voiding your own check moves money away from you |
| `unwaive_dues`        | **correctly unguarded** — same shape; re-imposes a debt on the actor                                           |
| `record_dues_payment` | **genuinely open** — see OPS-8                                                                                 |

This page's own preamble carried the same staleness, and more pointedly: it uses
FIN-4 as the worked example for an excellent lesson ("read the call site, not
the import") and asserted in the present tense that those three methods "remain
gated by `finance.manage` alone". The paragraph immediately above it warns that
overstating open risk is "the dangerous one" because this is the page a
compliance reviewer reads. Both corrected; the lesson and its illustration are
kept, now marked as since-closed with the date.

### OPS-12 — The compliance control inventory credited 1 of 20 call sites — ✅ DOC FIXED

`docs/COMPLIANCE.md` maps ISO 27001 A.5.3 to
`separation_of_duties.py`, "enforced in `finance_service.approve_step()`" —
one call site, when the guard had reached twenty across eight modules. For the
document that tells an auditor where to aim, that materially understates the
control.

**Fix:** implemented pass 2's own future-dev #5 — a **Segregation of duties —
coverage** section listing every guarded path with its actor/subject pairing,
and, more usefully, every **deliberately unguarded** one with the reason:
denial and withdrawal everywhere (declining your own record is not a conflict),
`void_check`/`unwaive_dues`/`mark_pr_ordered`/`mark_pr_received` (no actor,
reversals or non-monetary), `approve_by_token` (no Logbook id — enforced by
address instead), training auto-approve (no reviewer exists to compare), and
`record_dues_payment` (open, OPS-8).

**With a machine check behind it**, because this claim rotted precisely because
nothing verified it. `test_separation_of_duties.py` gains three tests that walk
`app/` with an AST visitor and assert the guarded module set and the call-site
total match the table — a new guarded module fails the build until the table is
updated, which is the correct outcome. Mutation-verified by renaming one call.

## Pass 3 flagged

### OPS-7 — MED — Audit shipping's row lock serializes one batch, not a run — 🚩 FLAGGED

`_get_or_create_state` reads the watermark `FOR UPDATE`, added by the security
review (SEC2-28-9) because the task runs both on a schedule and via the manual
trigger. The lock does what it was added for — the second run blocks and starts
from an advanced watermark — but the in-code comment claimed it "ships only
what's left", and it does not.

`ship_new_audit_logs` commits after **each** acknowledged batch, deliberately,
so a mid-run failure never re-ships confirmed rows. Committing is also what
releases the lock. So the two runs are serialized for their first batch only;
past that both proceed from the watermark as of batch one and can deliver the
same later batches twice, up to 20 batches each. `expire_on_commit=False`
(`core/database.py`) means neither run's in-memory `state` ever observes the
other's commits, so they stay diverged.

No row is lost or skipped — the watermark only moves forward and everything
past it is re-queried — so this is at-least-once delivery, not a hole in the
off-host copy. Every request carries `X-Logbook-First-Id`/`X-Logbook-Last-Id`
so a collector can deduplicate; one that does not would double-count.

**Not fixed** because durable per-batch progress and whole-run exclusion are
in direct conflict: resolving it needs a run-scoped claim rather than a row
lock — the shape `core/background_claim.py` already provides for the scheduler
loops — on a task that ships every organization's audit trail. The comment now
states the lock's real boundary instead of the one the fix was described as
having.

### OPS-8 — MED — `record_dues_payment` settles money with no separation guard — 🚩 FLAGGED

It accepts a `recorded_by`, appends to the dues ledger and re-derives the
member's paid total, and never calls `assert_different_person`. A
`finance.manage` holder can record a payment against their own dues with nobody
else involved. Three things make it an asymmetry rather than a scope judgement:

- **Its exact analogue is guarded.** `StorefrontService.record_payment` carries
  the check, with a comment explaining it belongs on the shared engine rather
  than the wrapper because the engine is independently reachable via
  `POST /orders/{id}/payments` — the SF-6 finding, which is this same shape
  found and fixed on the other side of the app.
- **Its sibling on the same record is guarded.** `waive_dues` refuses when
  `waived_by == dues.user_id`. So waiving your own dues is blocked and
  recording a payment on them is not.
- **The exemption already exists.** `assert_different_person` no-ops on a
  missing id and `recorded_by` is `Optional`, so an out-of-band reconciliation
  path passes through untouched, exactly as storefront's `actor_id=None` does.

`tests/test_money_separation_of_duties.py` mirrors the gap: it asserts a member
cannot waive their own dues and has no case for recording a payment on them.

**Not fixed** because it changes a money workflow and carries the operational
cost OPS-1 already recorded for admin hours — a treasurer paying their own dues
in cash at a meeting could no longer record it, and a single-officer department
has nobody else to. The owner's 2026-08-09 decision chose option (a) for an
enumerated set of paths that did not include this one. The fix is one line,
given in the `KNOWN_LIMITATIONS.md` entry so it can be accepted trivially.

## Pass 3 re-verified ✅

- **Every SoD call site pairs the right two people, and none guards a
  denial.** All 20 were extracted from the AST with their `action=`/`record=`
  arguments and read: approve, validate, void, return, examine, mark paid,
  issue check, waive, refund, record a payment. Rejection and withdrawal stay
  open everywhere, which is pass 2's rule holding across sixteen new sites
  nobody re-checked until now. `driver_exception_service` checks **twice** —
  against the requester and against the exception's subject.
- **The A6 attribute-vs-column trap does not apply to the export.**
  `_row_to_dict` filters on `column.name`, and A6 found this codebase has
  models where the assigned attribute (`_mfa_secret_encrypted`) differs from
  the column, which would make an exclusion list silently miss. Checked all
  eight entries against `User.__table__.columns`: all eight match, and a regex
  sweep for `secret|token|hash|password|mfa|oauth|key` over the real columns
  found only `mfa_enabled`, `must_change_password`, `oauth_provider` and
  `password_changed_at` exported — booleans and timestamps, which are
  legitimate subject data.
- **Pass 2's "no latent-500" claim survives the file's growth.** Every
  exported column type was enumerated across all 24 exported models:
  the only non-primitive types are `EncryptedText` and `EncryptedJSON`, whose
  `process_result_value` returns a plain `str` and a parsed object
  respectively, so everything reaching `json` is encodable. The decrypted PHI
  in the medical-screening section is intentional — the docstring names HIPAA
  right of access.
- **Audit shipping has no SSRF surface, and now re-validates.** The collector
  URL is still env-only, and `assert_outbound_url_safe` runs once per run off
  the event loop with `AUDIT_SHIP_ALLOW_PRIVATE_DESTINATION` threaded through —
  more than pass 2 verified, which predates the guard.
- **Admin-continuity's recount still honours wildcards** and the guards still
  sit at the service layer for role changes, covering every caller.
- **No dead code**, with one note: `is_administrator` in
  `admin_continuity_service.py` is a module-public name whose only caller is
  the private `_active_administrators` beside it. Left alone — renaming it
  would be a silent refactor for no gain.

## Pass 3 completion gate

| Check                       | Result                                     |
| --------------------------- | ------------------------------------------ |
| `npm run typecheck`         | ✅ 0 errors (no frontend change)           |
| `flake8 app/ tests/`        | ✅ 0 violations                            |
| `black --check app/ tests/` | ✅ 1350 files unchanged                    |
| `isort --check-only`        | ✅ clean                                   |
| docs link check             | ✅ 428 files, 0 broken links               |
| scoped backend tests        | ✅ 98 passed, 1 skipped (was 92 — 6 added) |

New tests are marked per their kind and the split was confirmed by collection,
not by a local run: 24 of 31 collect under
`-m "not integration and not slow and not docker"`, and the 7 `db_session`
data-export tests collect under `integration`. Both code fixes and the new
coverage guard are mutation-verified.

---

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
audit-ship configuration. These are the _implementations_ of controls the
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
  legacy row can't be _shown_ to be self-approval, and failing closed there would
  wedge pre-existing records. Its docstring names the four paths it closes and
  invites the fifth. 8 dedicated unit tests, all passing without a DB.
- **All four wired call sites implement the control correctly** — verified each
  pairs the _approver/actor_ against the _creator/subject_, guards **only the
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
  edit _and_ delete — at the **service layer** (`role_service.py:275/300/380`),
  which is the better choice because it covers every caller, not just one
  endpoint. The "would this leave zero `members.manage` holders?" recount
  correctly applies proposed permissions, honors `"*"`/`"members.*"` wildcards,
  and counts rank defaults. (My first read flagged the role-edit path as
  unguarded because the endpoint file has no call — the guard is one layer down.)
- **Data export is self-scoped by construction.** `export_user_data(current_user)`
  drives a table registry where _every_ section filters
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
their own admin hours) as _flagged, product decision_. It is **fixed**:
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
`KNOWN_LIMITATIONS` describes (the _disbursement_ actions `mark_pr_paid` /
`issue_check` / … under a single `finance.manage`) is genuinely still open: none
of those six methods carries an actor≠creator check or a distinct permission.
Updated the entry to record both halves, so the residual is understood as
"requester can still execute an already-approved payment" rather than the more
alarming "one person can do everything."

### OPS-4 — TR-5 looked fixed but is not — ✅ DOC CLARIFIED (no status change)

This is the one that went the _other_ way, and the reason to verify rather than
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
`assert_different_person` blocking a manager from marking their _own_ order paid
or waived — mirrors AH-4, closes the self-dealing case now; or (b) a
`storefront.disburse` permission tier — broader, closes requester≠disburser
generally. Not implemented unilaterally because it changes a money workflow and
the maintainer's flag leaned toward the permission approach.

## Duplication

None — the opposite. These four services _are_ the de-duplication: one
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

| Check                | Result                                                                                                                                                                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsc --noEmit`       | ✅ 0 errors (no code changed this iteration)                                                                                                                                                                                                               |
| `flake8 app/ tests/` | ✅ 0 violations                                                                                                                                                                                                                                            |
| `black --check`      | ✅ 503 files unchanged                                                                                                                                                                                                                                     |
| `eslint`             | ✅ clean                                                                                                                                                                                                                                                   |
| backend tests        | ✅ `test_separation_of_duties.py` 8/8 pass; broader ops selection errors are all `db_session` fixture failures against the sandbox's missing MySQL (32 matching lines). No code changed, so the full-suite baseline (2514 passed, 0 failed) is unaffected. |

---

## Tier A complete

A9 is the last never-reviewed feature. **All 9 Tier A features are done** (A1–A9).
The rotation now moves to Tier B — the second, broader pass over the 27 modules
the [module audit](../module-audit/PROGRESS.md) already covered for security.
</content>
