# Security Review — Membership Pipeline

**Prefix:** `MP` · **Iteration:** 8 · **Reviewed:** 2026-08-25 (pass 1), 2026-08-27 (pass 2), 2026-09-02 (pass 3), 2026-09-02 (pass 4), 2026-09-02 (pass 4 round 2), 2026-09-02 (pass 4 round 3), 2026-09-02 (pass 4 round 4) · **PR:** [#1815](https://github.com/thegspiro/the-logbook/pull/1815) (pass 1), [#1950](https://github.com/thegspiro/the-logbook/pull/1950) (pass 2), [#2176](https://github.com/thegspiro/the-logbook/pull/2176) (pass 3), [#2177](https://github.com/thegspiro/the-logbook/pull/2177) (pass 4, pass 4 round 2, pass 4 round 3, and pass 4 round 4)

---

## Pass 4, round 4 (2026-09-02) — 1 fixed (Codex review of PR #2177's `0d9a981a`)

Codex reviewed round 3's fix commit (`0d9a981a`, MP-24/MP-25) and posted 1
new finding against `create_election_package`'s fallback branch — the one
MP-23 (round 2) left as a documented residual limitation, not a bug.

#### MP-26 — P2 — the fallback branch discarded an already-validated `step_id` in favor of an arbitrary sort-order guess — ✅ FIXED

**What:** MP-23 (round 2) made `create_election_package` prefer
`prospect.current_step` for the PII-minimization policy when `current_step`
is itself an `election_vote` step of the governing pipeline. When it isn't —
e.g. the applicant already advanced past every vote stage — the code falls
back to `next(...)` over `effective_steps`, ordered by `sort_order`: the
first configured `election_vote` step, full stop. That fallback never looked
at a caller-supplied `step_id` at all, even though MP-5 (pass 3) already
validated it to belong to the governing pipeline. In a pipeline with more
than one `election_vote` step (still unconstrained — `add_step` has no
uniqueness check on `step_type`), a request naming the later, stricter of
two such steps — exactly what `advanceApplicant` sends on the same kind of
race MP-24 guards on the `current_step`-governed side — got the earlier,
more permissive stage's policy instead, over-capturing PII the later stage
was configured to exclude.

**Independently verified:** read the current (post-round-3) fallback in
full. It was exactly the unconditional sort-order `next(...)` Codex
described — no reference to `step_id` anywhere in that branch. Re-read
MP-5's check (`membership_pipeline_service.py`, just above the policy
resolution): `if step_id: ... if not any(str(s.id) == str(step_id) for s in
steps): raise ValueError(...)` — pipeline membership only, never
`step_type`. So `step_id`, once supplied, is confirmed to name a real step
of this exact pipeline, but not confirmed to be an `election_vote` step —
using it as a policy source unconditionally would have been wrong (it could
name the pass-4 "wrong step_id" case, a real but non-election step). Traced
the only frontend caller, `advanceApplicant`
(`prospectiveMembersStore.ts:433-483`, unchanged since MP-23): it always
sends `step_id` as the election_vote stage the applicant just entered, and
there is no legitimate frontend path that names a deliberately different
stage — the same fact MP-24's own reasoning already established for the
`current_step`-governed side. Cross-checked against MP-24's mismatch check:
it only fires when `election_step is current_step` (i.e. the policy came
from `current_step`), which is never true once this fallback branch is
reached — no interaction, no conflict.

**Why this doesn't reopen MP-20.** MP-20's fix stopped trusting `step_id`
_unconditionally_ — the bug there was that a bare, type-unchecked `step_id`
could steer policy to any step at all, including a deliberately wrong one,
with no server-side signal that it was actually the applicant's stage. This
fix only extends trust to `step_id` once it clears the same type check
`current_step` itself has to clear (`step_type == ELECTION_VOTE` and
in-pipeline) — a caller with `prospective_members.manage`/`members.manage`
(the permission this endpoint already requires) could reach the same
resolved policy today by calling `regress_prospect` to the desired
`election_vote` stage, creating the package, then `advance_prospect` again;
this fix removes the extra round trip without granting any capability that
role didn't already have via `current_step` itself.

**Where:** `create_election_package`, `membership_pipeline_service.py`,
immediately before the pre-existing sort-order fallback.
**Fix:** inserted a new step between the MP-24 mismatch check and the
sort-order fallback: when `election_step` is still `None` (i.e.
`current_step` didn't govern) and `step_id` was supplied, look it up in
`effective_steps` and — only if it resolves to a step whose `step_type` is
`ELECTION_VOTE` — use it directly as `election_step`, skipping the guess
below entirely. A `step_id` naming a real, in-pipeline step of the wrong
type falls through unchanged to the existing sort-order fallback, so the
pass-4 `test_wrong_step_id_still_honors_the_pipelines_election_stage` case
is unaffected (confirmed by rerunning that suite alongside the new one).
Unlike the old fallback's `next(...)` search, the new step_id-preferred path
does not additionally require the named step to have `package_fields`
configured — it mirrors `current_step`'s own resolution exactly (trust the
step once it is confirmed to be the right _type_; an unconfigured step still
means capture-everything for that step, same as an unconfigured
`current_step` already does), rather than skipping past it to find some
other, unrelated step that merely happens to have a policy saved.

**Residual limitation, narrowed but not closed:** a pipeline with multiple
`election_vote` steps where _neither_ `current_step` _nor_ a supplied
`step_id` identifies one of them (`step_id` omitted, or naming a real but
non-election step) is still genuinely ambiguous — there remains no signal
naming "the" stage, so the sort-order guess is unchanged. This is a strict
narrowing of the case MP-23 documented (previously: any time `current_step`
didn't govern; now: only when `step_id` also doesn't disambiguate), not a
full resolution — `docs/KNOWN_LIMITATIONS.md` updated to match.

**Considered and declined:** rejecting outright (400) in the still-residual
case, as Codex's second suggested option. Declined for the same reason
MP-20's step_id-optional design was kept rather than made required: the
sort-order guess is still exact for the overwhelmingly common
single-`election_vote`-step pipeline (the vast majority of installations,
per MP-23), and turning the still-ambiguous multi-step/no-signal case into a
hard error would make `create_election_package` fail for a legitimate
caller (or a future caller other than `advanceApplicant`) who reasonably
omits `step_id` on a pipeline with only one election stage today, if that
pipeline is later reconfigured to add a second one — a behavior change with
no caller opted into it. Best-effort-guess-with-a-known-limitation, already
this rotation's disposition for the surrounding cases (MP-22, MP-25),
remains the better fit than a new hard failure mode for a case that is rare
by construction (requires a multi-`election_vote` pipeline _and_ a request
with no disambiguating signal).

Covered by `backend/tests/test_membership_pipeline_pass4_round4_codex.py`
(5 tests): the core regression (current_step past every election_vote
stage, step_id names the later/stricter one → that stage's policy governs,
not the sort-order guess); the mirror case (step_id names the earlier,
permissive stage → that stage's policy governs — proving "prefer the named
stage," not "prefer the stricter one"); a step_id naming a real but
wrong-type step → unaffected, still falls through to the sort-order guess;
step_id omitted → unaffected, same residual guess; and a
single-`election_vote`-step regression guard. The core regression test was
independently confirmed to fail against the pre-fix code (`git stash` on
`membership_pipeline_service.py`) before the fix was applied — the other 4
were confirmed to already pass unchanged against that same pre-fix code, so
the fix is additive rather than accidentally masking behavior a broader
diff would have altered.

### Completion gate (pass 4, round 4)

| Check                                                              | Result                                                                                                                                             |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                      | pass, 0 violations                                                                                                                                 |
| `black --check app/ tests/ alembic/`                               | pass (1 new test file needed reformatting, applied, re-check pass)                                                                                 |
| `isort --check-only app/ tests/ alembic/`                          | pass, 0 violations                                                                                                                                 |
| `python3 scripts/validate_migrations.py --strict`                  | pass — 409 revisions, single head (no schema change)                                                                                               |
| new guard tests (`test_membership_pipeline_pass4_round4_codex.py`) | 5 passed; the core regression assertion independently confirmed to fail against the pre-fix code (`git stash`)                                     |
| full backend suite (`pytest tests/ -q`)                            | 9877 passed / 21 skipped (pre-existing/environmental) / 0 failed (baseline was 9872 passed before this commit; +5 for the new round-4 guard tests) |

---

## Pass 4, round 3 (2026-09-02) — 1 fixed, 1 flagged/refuted (Codex review of PR #2177's `da29d880`)

Codex reviewed round 2's fix commit (`da29d880`, MP-23's `prospect.current_step`
preference) and posted 2 new findings, both against
`membership_pipeline_service.py`.

#### MP-24 — P1 — a supplied `step_id` could still disagree with the `current_step` that governed the snapshot — ✅ FIXED

**What:** `advanceApplicant` (frontend) commits the applicant's stage
advancement in one request, then makes a **separate** request to create the
election package, naming the stage it just entered via `step_id`. Between
those two requests, `prospect.current_step` can change again — a regression,
or another advance landing in the gap. MP-23 (round 2) made
`create_election_package` prefer `prospect.current_step` for the PII policy,
but never checked it against the request's `step_id` — so on this genuine
race, the method would resolve `package_fields` from whatever `current_step`
now is, while still persisting the request's original (now-stale) `step_id`
on the package. The package ends up labeled for one stage while a different
stage's policy actually governed what got captured — the same class of
mismatch MP-23 fixed for the _first-found_ lookup, reopened one layer up by
the request/response race between the two frontend calls.

Independently confirmed by reading `create_election_package`'s full body at
`da29d880`: `step_id` is validated only for belonging to the pipeline (MP-5,
`membership_pipeline_service.py` lines 4613-4616) and is stored verbatim on
`pkg.step_id` (line 4772) — completely independent of which step's
`package_fields` governed the snapshot above it. No existing check compares
the two. Also confirmed `advanceApplicant`
(`prospectiveMembersStore.ts:433-483`) is the only frontend caller of
`create_election_package`, and it always intends `step_id` to equal the
stage the applicant just entered — there is no legitimate frontend path that
names a deliberately different stage, which is what makes rejecting a
mismatch safe rather than a false-positive risk.

**Where:** `create_election_package`, `membership_pipeline_service.py:4649`
(right after `election_step` is resolved from `current_step`, before the
first-found fallback).

**Fix:** when the policy was resolved from `current_step` (i.e.
`election_step is current_step`) and the caller supplied a `step_id` that
disagrees with it, raise `ValueError` (→ 400 via the endpoint's existing
`except ValueError` handler) instead of silently mixing the two. This never
fires when `step_id` is omitted, and never fires for the pass-4 "named step
isn't the pipeline's election step" scenario
(`test_wrong_step_id_still_honors_the_pipelines_election_stage`), because
there the policy comes from the fallback lookup, not from `current_step` —
verified by re-running that suite alongside the new tests. The caller
(`advanceApplicant`) already treats package-creation failure as non-fatal to
the advance (a toast warning, per its own comment about 409s), so a 400 here
degrades the same way; a genuine race is correctly surfaced rather than
silently mis-attributed.

**Considered and declined:** removing `step_id` as a caller-supplied field
entirely, deriving it server-side from `current_step`. Only one caller
exists today and it always intends the two to match, so this would likely be
safe — but it is a request-schema change on an endpoint with its own test
coverage of the "named step is deliberately not the election step" case
(pass 4), and changes the field's meaning for any future caller. Left as a
reject-on-mismatch rather than a schema change, consistent with this
rotation's preference for the smaller, reversible fix on an already
many-times-reviewed surface.

Covered by `backend/tests/test_membership_pipeline_pass4_round3_codex.py` (3
tests): the race itself (current_step moved on after step_id was captured →
`ValueError`); the ordinary matching case (step_id equals current_step →
unaffected); and step_id omitted (never triggers the check). The race
assertion was independently confirmed to fail against the pre-fix code
(`git stash` on `membership_pipeline_service.py`) before the fix was applied.

#### MP-25 — P2 — claimed lock-order deadlock between `update_election_package` and `ElectionService.close_election` — 🚩 REFUTED (no fix)

**What (claim):** `ProspectElectionPackage.election` is
`lazy="joined"` (confirmed: `models/membership_pipeline.py:544`), so
`get_election_package(..., lock_for_update=True)`'s `SELECT ... FOR UPDATE`
(added by MP-21) generates a join that locks both the package row and its
linked election row, package-then-election. The claim was that
`ElectionService.close_election` takes the opposite order — election first,
packages later via `_sync_package_statuses` — creating a classic lock-order
deadlock: `update_election_package` holding the package lock waiting on the
election lock, while a concurrent `close_election` holds the election lock
waiting on the package lock.

**Independently verified, and refuted:** the `lazy="joined"` mechanic is
real — confirmed the relationship declaration, and confirmed (via the
response schema, `schemas/membership_pipeline.py:747-749`,
`election_title`/`election_status`/`election_end_date`) that the eager join
is load-bearing, not incidental: those response fields are `@property`s that
read `self.election` synchronously during Pydantic serialization, so
dropping the eager load on this query without also handling that read would
trade a theoretical deadlock for a real, reproducible `MissingGreenlet` crash
on every successful update.

But the deadlock premise itself does not hold against the actual code.
Traced `ElectionService.close_election` (`election_service.py:4781-4947`)
statement by statement: it takes the election lock at line 4787-4792, then
**commits at line 4827** — before it ever touches `ProspectElectionPackage`.
`_sync_package_statuses` (line 4949, called from `close_election` at line
4928, after several more reads and its own commit boundary) runs in a
transaction that no longer holds the election lock (released at the line
4827 commit) and does not itself lock the package rows it selects (its query
at lines 4969-4973 has no `.with_for_update()` — only the later `UPDATE`
implicit from `pkg.status = new_status` takes a row lock, at commit time,
line 5033). Confirmed grepping `election_service.py` for
`ProspectElectionPackage`: the only two references are both inside
`_sync_package_statuses`, after the election-lock-releasing commit.

A lock-order deadlock requires two transactions to each hold one resource
while waiting on the other, at the same time. Here, `close_election` never
holds the election lock and a package lock simultaneously — the intervening
commit at line 4827 splits it into two separate transactions, one holding
only the election lock, the other (in `_sync_package_statuses`) taking only
a package lock, with no overlap. The two-transaction split makes the
opposite-order interaction Codex described structurally impossible with the
current code: at worst, `_sync_package_statuses`'s package `UPDATE` blocks
briefly behind a concurrent `update_election_package`'s lock (ordinary lock
contention, not a cycle) and proceeds once that transaction commits.

**Disposition:** flagged, not fixed — there is nothing to fix; the claimed
scenario does not reproduce against the actual code. Recorded here (rather
than silently dismissed) because: (1) the underlying "the joined eager load
also locks the election row when present" mechanic is real and worth a
future reviewer knowing about before adding a _new_ election-then-package
code path within a single uncommitted transaction elsewhere — that is the
shape that would actually risk this deadlock; (2) any fix to narrow the lock
scope (e.g. a column-limited raw locking statement instead of the ORM
join) would need to independently guarantee `election` is still loaded
before serialization, which is exactly the kind of behavior-changing,
easy-to-get-subtly-wrong change this rotation's own precedent (MP-22) says
to flag rather than force through same-day on an already many-times-reviewed
surface, especially when the finding it would guard against isn't actually
reachable today.

No test added — there is no reproducible failure to guard against. If a
future change to `close_election` merges its election-lock phase and its
package-write phase into a single transaction (removing the line-4827
commit boundary), the deadlock risk this finding described would become
real; that is the condition a reviewer of such a change should check for.

### Completion gate (pass 4, round 3)

| Check                                                              | Result                                                                                                                                             |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                      | pass, 0 violations                                                                                                                                 |
| `black --check app/ tests/ alembic/`                               | pass, 0 files would be reformatted                                                                                                                 |
| `isort --check-only app/ tests/ alembic/`                          | pass, 0 violations                                                                                                                                 |
| `python3 scripts/validate_migrations.py --strict`                  | pass — 409 revisions, single head (no schema change)                                                                                               |
| new guard tests (`test_membership_pipeline_pass4_round3_codex.py`) | 3 passed; the race assertion independently confirmed to fail against the pre-fix code (`git stash`)                                                |
| full backend suite (`pytest tests/ -q`)                            | 9872 passed / 21 skipped (pre-existing/environmental) / 0 failed (baseline was 9869 passed before this commit; +3 for the new round-3 guard tests) |

---

## Pass 4, round 2 (2026-09-02) — 1 fixed (Codex review of PR #2177's own fix commit)

Codex reviewed pass 4's fix commit (`6c9bb09e`, still on open PR #2177 — no
branch change needed, unlike the pass-3-to-4 handoff) and posted 1 new
finding against the very code MP-20 just changed.

#### MP-23 — P1 — election-package field policy still assumed a pipeline has at most one `election_vote` step — ✅ FIXED

**What:** MP-20's fix resolves `package_fields` by finding the pipeline's
"own" `election_vote`-typed step via `next(...)` over
`effective_pipeline.steps` (ordered by `sort_order`). That is correct only if
a pipeline has at most one such step — and nothing enforces that. `add_step`
has no uniqueness check on `step_type` (confirmed by reading it directly:
`membership_pipeline_service.py:470-518`, no such constraint), so a pipeline
with two or more `election_vote` stages is a reachable configuration. In that
case `next(...)` always returns the _first_ one found, ordered by
`sort_order` — not necessarily the stage the applicant, and this specific
package, actually reached. An earlier stage configured more permissively (or
left unconfigured, meaning capture-everything) than the later stage the
applicant is really on then silently governs the snapshot, over-capturing PII
the applicant's real stage was configured to exclude.

Codex additionally observed that the frontend's `advanceApplicant` flow
(`prospectiveMembersStore.ts`) already knows the exact stage the applicant
just entered when it triggers package creation. Confirmed by reading it: it
finds `newStage` by matching `advanced.current_stage_id` against the
pipeline's stage list, checks `newStage.stage_type === ELECTION_VOTE`, and
passes `stage_id: newStage.id` through `createElectionPackage` to the
backend's `step_id` parameter — but pass 4 deliberately stopped trusting
`step_id` for this decision (the MP-20 fix, for good reason: a client
supplying an arbitrary in-pipeline `step_id` could otherwise defeat the
policy). A step_id-based fix that simply re-trusts a type-checked `step_id`
would work for this one caller but re-opens exactly the class of bug pass 4
closed for every other caller of `create_election_package`.

**Where:** `create_election_package`, `membership_pipeline_service.py`.
**Fix:** resolve the governing step from `prospect.current_step` first, not
from the client-supplied `step_id`. `current_step_id` is set only by
`create_prospect`/`advance_prospect`/`regress_prospect` and is in
`_PROSPECT_PROTECTED_FIELDS` (excluded from the generic update path), so it
names the stage the applicant has actually, currently reached with nothing
for any caller — trusted or not — to steer. `get_prospect` (called at the top
of `create_election_package`) already eager-loads
`selectinload(ProspectiveMember.current_step)`, so this is available with no
extra query. When `prospect.current_step` is itself an `election_vote` step
belonging to the governing (possibly caller-overridden) pipeline, its
`package_fields` governs. Only when it is _not_ — e.g. a package requested
after the applicant already advanced past the vote stage, or a caller
overriding `pipeline_id` to one the prospect isn't actually on — does the
code fall back to MP-20's original `next(...)` lookup, which remains exactly
correct for the single-`election_vote`-stage case (the overwhelmingly common
one) and is the same best-effort guess as before for the residual ambiguous
case.

**Residual limitation, not fixed:** a pipeline with **multiple**
`election_vote` stages where the prospect's `current_step` matches none of
them (the fallback path) is still genuinely ambiguous — there is no single
correct "the" election stage to resolve, by construction, once the pipeline
itself has more than one and the applicant isn't presently on any of them.
This is a product-design question (should a pipeline even be allowed
multiple `election_vote` stages? if so, does "the applicant's stage" have a
different definition for a package requested after they've moved on?) rather
than a bug fixable in this pass. Mirrored to `docs/KNOWN_LIMITATIONS.md`.

Covered by `backend/tests/test_membership_pipeline_pass4_round2_codex.py`:
a two-`election_vote`-stage pipeline where the prospect's current step is the
later, stricter one (must exclude phone/address/DOB, not the earlier
permissive stage's fields); the mirror case where the current step is the
earlier, permissive one (must include those fields — proving this is "prefer
the actual stage," not "always prefer the stricter one"); and a
single-`election_vote`-stage regression guard. The multi-stage assertion was
independently confirmed to fail against the pre-fix code (`git stash` on
`membership_pipeline_service.py`) before the fix was applied.

### Completion gate (pass 4, round 2)

| Check                                                              | Result                                                                                                                                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `flake8 app/ tests/ alembic/`                                      | pass, 0 violations                                                                                                                                           |
| `black --check app/ tests/ alembic/`                               | pass, 0 files would be reformatted                                                                                                                           |
| `isort --check-only app/ tests/ alembic/`                          | pass, 0 violations                                                                                                                                           |
| `python3 scripts/validate_migrations.py --strict`                  | pass — 409 revisions, single head (no schema change)                                                                                                         |
| new guard tests (`test_membership_pipeline_pass4_round2_codex.py`) | 3 passed; the multi-stage assertion independently confirmed to fail against the pre-fix code (`git stash`)                                                   |
| full backend suite (`pytest tests/ -q`)                            | 9869 passed / 21 skipped (pre-existing/environmental) / 0 failed (baseline was 9866 passed before this PR's last commit; +3 for the new round-2 guard tests) |

---

## Pass 4 (2026-09-02) — 3 fixed, 1 flagged (Codex review on PR #2177)

> **Branch note:** Codex reviewed pass 3's fix commit while #2176 was still
> open and posted 4 new findings. #2176 merged before the investigation
> finished (this rotation's "one PR at a time" model), so — per CLAUDE.md
> Pitfall #24 and the identical precedent of #2173 against #2162 in the
> elections feature — this pass landed as a fresh branch off `main` and a new
> PR (#2177) rather than a push to the now-closed `claude/security-review-membership-pipeline`
> branch. Replies to the original findings are posted on #2176's threads
> (still open for replies/resolution despite the PR being closed), pointing
> here for the actual fix.

### Findings (Codex review of PR #2176's fix commit)

#### MP-20 — P1 — election-package PII policy trusted the caller's `step_id`, and a new stage had no policy at all — ✅ FIXED

**What:** two angles on the same mechanism — `create_election_package`'s
`package_fields` reader (added in pass 3 for MP-15).

1. The reader resolved policy from whatever `step_id` the _caller_ supplied
   on `ElectionPackageCreate` — optional, and never checked for being the
   pipeline's actual `election_vote`-typed step. Even after a coordinator
   saves a restrictive `package_fields`, a caller could still get full
   capture by omitting `step_id`, or by naming a different, real, in-pipeline
   step (which passes pass 3's own MP-5 in-org/in-pipeline check) — silently,
   with no error and no sign anything was skipped.
2. Separately: a brand-new, never-configured `election_vote` stage had no
   `package_fields` at all, because neither `DEFAULT_STAGE_CONFIGS.election_vote`
   nor the "Membership Vote" preset (`frontend/.../StageConfigModal.tsx`)
   ever set it — even though `ElectionVoteConfig.tsx` displays
   phone/address/DOB as **unchecked** by default. Pass 3's `package_fields is
None -> capture everything` fallback (deliberately conservative, to avoid
   silently narrowing existing pipelines) meant the normal, untouched
   default UI workflow — not just legacy pipelines — still over-captured PII
   the UI visually implies is excluded.

**Where:** `create_election_package`, `membership_pipeline_service.py`;
`StageConfigModal.tsx`, `frontend/src/modules/prospective-members/components/`.
**Fix:**

- Backend: `package_fields` is now resolved by finding the pipeline's own
  `election_vote`-typed step directly (`s.step_type == PipelineStepType.ELECTION_VOTE`),
  not by trusting `step_id` for anything beyond what MP-5 already validated
  it for. A pipeline has at most one election stage in practice, so this
  removes the client's ability to steer which step's config governs the
  snapshot, while `step_id` is unchanged as the package's own step reference
  and pass 3's "absent config -> capture everything" fallback is preserved
  exactly when no `election_vote` step (or one with no saved `package_fields`)
  exists.
- Frontend: the "Membership Vote" preset's `config()` now includes
  `package_fields: { ...DEFAULT_ELECTION_PACKAGE_FIELDS }` — the same object
  `ElectionVoteConfig.tsx` already falls back to for _display_. This is the
  only UI path that can actually produce a _savable_ new `election_vote`
  stage: manually picking the "Election / Vote" type card leaves
  `eligible_voter_roles` empty with no control anywhere in the modal to set
  it (a separate, pre-existing gap, left untouched — out of scope here).
  `DEFAULT_STAGE_CONFIGS.election_vote` itself was deliberately **not**
  touched: it is also the merge base `StageConfigModal.tsx` spreads under an
  _existing_ stage's config when opening it for editing
  (`{ ...defaultStageConfig(editingStage.stage_type), ...editingStage.config }`),
  so adding defaults there would have leaked into every edit of a legacy,
  never-configured stage and silently narrowed its capture-everything
  behavior on an unrelated save (exactly what pass 3 was protecting against).
  Scoping the fix to the preset (rendered only when `!editingStage`) targets
  new-stage creation without touching that merge path at all.

Covered by `TestElectionPackageFieldPolicyIsNotClientChosen` (backend:
omitted `step_id`, wrong-but-real `step_id`, correct `step_id`, and a
pipeline with no election step at all, each against a prospect with real PII)
and 2 new `StageConfigModal.test.tsx` cases (the preset persists the UI's
defaults; editing an existing, never-configured stage leaves `package_fields`
untouched even when saved).

#### MP-21 — P1 — `update_election_package`'s status path reopened the pass-3-fixed assignment race — ✅ FIXED

**What:** pass 3 (MP-16) locked `assign_package_to_election`'s read of the
election package specifically because its status check has to be the
locking read (CLAUDE.md Pitfall #27). `update_election_package` — the other
write path that changes `pkg.status`, guarded by pass 3's MP-17
state-machine check — still read the package with a plain, unlocked
`get_election_package` call. A `{"status": "ready"}` reset racing a
concurrent `assign_package_to_election` could validate against a stale
snapshot of `pkg.status`, reopening the exact compounding scenario the
MP-17 state machine exists to prevent.
**Where:** `update_election_package`, `membership_pipeline_service.py`.
**Fix:** the package is now fetched with `lock_for_update=True`, and the
state-machine check runs against that same locked read — mirroring
`assign_package_to_election` exactly. Covered by
`TestElectionPackageUpdateLocking`: a source-inspection test (matching this
rotation's established lock-wiring-guard pattern) confirming the lock is
acquired before the `ELECTION_PACKAGE_SYSTEM_STATUSES` check, plus
behavioral tests for the ordinary path and the already-`added_to_ballot`
refusal case.

#### MP-22 — P2 — document-deletion fix can still lose a file if a later step fails after `os.remove` succeeds — 🚩 FLAGGED

**What:** pass 3's MP-18 fix reordered `delete_prospect_document` to remove
the file from disk _before_ deleting the DB row and committing — correct for
the `OSError` case that was pass 3's actual finding. But if `_log_activity`,
`db.delete`, or the commit itself fails _after_ a successful `os.remove`, the
transaction rolls back while the file is already irrecoverably gone; the DB
row survives (untouched by the failed transaction) pointing at a file that no
longer exists.
**Where:** `delete_prospect_document`, `membership_pipeline_service.py`.
**Disposition — FLAGGED, not fixed.** This is a genuine reliability
tradeoff, not a one-sided gap: the current ordering is what this exact
method was deliberately reordered _to_ in pass 3, specifically so an
`OSError` on removal leaves the DB row as the one record an operator can
retry cleanup against. Reverting to commit-DB-first (this codebase's more
common pattern elsewhere, e.g. `documents_service.delete_folder`) would
reopen MP-18 — an untracked orphaned PII file with no row left to explain
it, which is strictly worse than the residual risk here: the row surviving a
failed commit is retry-safe (a retry's `os.path.exists` check is already
false, so it proceeds straight to a clean metadata delete). A full
rename-to-trash/restore-on-rollback scheme (stage the file, commit the DB
delete, only then permanently remove the staged file, restoring it if the
commit fails) would close this gap without reopening MP-18, but is
meaningfully more machinery — a new trash-file convention, restore-on-any-
exception handling, and eventually a cleanup job for anything left in trash
by a restore itself failing — than a rare compound failure (an `os.remove`
succeeding immediately followed by a DB commit failing) justifies as a
same-day fix on an already-twice-reviewed, election-adjacent surface.
Mirrored to `docs/KNOWN_LIMITATIONS.md`.

### Completion gate (pass 4)

| Check                                                                                    | Result                                                                                                                                                        |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                                            | pass, 0 violations                                                                                                                                            |
| `black --check app/ tests/ alembic/`                                                     | pass (1 file needed reformatting, applied, re-check pass)                                                                                                     |
| `isort --check-only app/ tests/ alembic/`                                                | pass, 0 violations                                                                                                                                            |
| `python3 scripts/validate_migrations.py --strict`                                        | pass — 409 revisions, single head (no schema change)                                                                                                          |
| new/changed guard tests (`test_membership_pipeline_pass4_codex.py` + one pass-3 fixture) | 33 passed (7 new + 26 pass 3); the 3 new/changed assertions independently confirmed to fail against the pre-fix code (`git stash` on the changed source file) |
| `StageConfigModal.test.tsx`                                                              | 45 passed (43 existing + 2 new); the 1 new save-path assertion confirmed to fail against the pre-fix component (`git stash`)                                  |
| `tsc --noEmit` / `eslint` (frontend files touched this pass)                             | clean                                                                                                                                                         |
| full backend suite (`pytest tests/ -q`)                                                  | 9866 passed / 21 skipped (pre-existing/environmental) / 0 failed                                                                                              |

---

## Pass 3 (2026-09-02) — 5 fixed, 2 flagged (Codex review on PR #2176)

> **Revision note:** the pass as first drafted (below, unedited) concluded
> "no new findings" from a byte-identical diff against pass 2. Codex's review
> of that draft found the diff being byte-identical proved nothing about the
> code's _soundness_ — only that nothing had changed since a pass that never
> looked at this angle either. It posted 6 findings, plus a 7th (mirroring
> MP-10) restated in a review comment: unvalidated cross-tenant form ids in
> step config, an N+1 query in the event-link list, election-package PII
> over-collection ignoring a stage's configured field toggles, an
> election-package assignment race with no row lock, a document-deletion
> path that could orphan a file on disk, no server-side state machine on
> election-package status, and unbounded prospect reads on two endpoints.
> Independently re-traced against the actual current code (not Codex's
> say-so): all 7 were real. 5 were fixed; 2 were flagged as needing a
> migration/product decision, per this rotation's standing discipline. See
> Findings below for what was actually done; the original "no new findings"
> draft is left intact afterward for the record.

### Findings (Codex review on PR #2176)

#### MP-13 — P2 — unvalidated cross-tenant `form_id` in step config — ✅ FIXED

**What:** `add_step`/`update_step` (`membership_pipeline_service.py`) wrote
and committed a step's `config` — including a client-supplied `form_id` — to
the database _before_ calling `_ensure_membership_form_integration`, and
that helper only logs a warning and returns when its own org-scoped lookup
fails; it never rejects the write. `create_pipeline`'s inline steps loop
didn't call the integration helper at all. A manager could submit another
org's form UUID in `config.form_id` and have it persist unchecked — CLAUDE.md
Pitfall #14c (validate client-supplied FK ids belong to the org before
storing them), the same shape already fixed for `email_template_id` on the
same two methods.
**Where:** `add_step` (~line 420), `update_step` (~line 497), `create_pipeline`'s
inline steps loop (~line 249).
**Fix:** added `_assert_form_in_org`, mirroring `_assert_email_template_in_org`
exactly (`assert_in_org` against `Form`, `allow_none=True` since a step need
not reference a form) — called in all three write paths _before_ the step is
persisted. `_ensure_membership_form_integration` is unchanged; it remains a
best-effort bookkeeping call that now only ever runs against an
already-validated in-org form. Covered by `TestStepFormIdOrgValidation` in
`tests/test_membership_pipeline_pass3_codex.py` (all three paths, plus
regression guards that a legitimate same-org `form_id` and a step with no
form config are unaffected).

#### MP-14 — P2 — N+1 query in `list_event_links` — ✅ FIXED

**What:** `list_event_links` (backing `GET /prospects/{id}/event-links`)
loaded every link for a prospect, then issued a separate `Event` query and
(when `linked_by` was set) a separate `User` query per row — a 2N+1 shape.
**Where:** `membership_pipeline_service.py`, `list_event_links`.
**Fix:** batch-fetch every referenced `Event`/`User` with two `.in_()`
queries before the loop, then build the response from `dict` lookups — same
output shape, no behavior change. Covered by a source-inspection test
(`TestEventLinkListBatching.test_list_event_links_does_not_query_per_row`,
walks the function's AST and fails if any `db.execute` call sits inside a
`for` loop) and a behavioral test asserting the enriched output is still
correct with two links, one with a linker and one without.

#### MP-15 — P1 — election-package PII over-collection ignored `package_fields` — ✅ FIXED

**What:** the election-vote stage's config (`ElectionVoteConfig.tsx`'s
"Election Package Contents" panel — `include_email`/`include_phone`/
`include_address`/`include_date_of_birth`/`include_documents`/
`include_stage_history`) had **no backend reader at all** — grepped zero
hits for `package_fields` anywhere under `backend/`. `create_election_package`
unconditionally captured DOB, full address, phone, and documents into
`applicant_snapshot` regardless of what a coordinator configured, and
`ElectionPackageResponse` returns that whole dict to any `elections.manage`
caller. This is CLAUDE.md Pitfall #19 (a config switch shipped with no
reader) applied to a PII-minimization control rather than a notification
toggle.
**Where:** `create_election_package`, `membership_pipeline_service.py`.
**Fix:** the step referenced by a package's `step_id` (when set) is
consulted for `config.package_fields`; each of the six toggled fields is
included in the snapshot only when its flag is true (matching the frontend's
own defaults for a key present in the dict but not itself set). Critically,
`package_fields is None` (no step, or a step whose config was never touched
by a coordinator) preserves the **prior capture-everything behavior exactly**
— this is additive, not a default change, so no existing pipeline's data
collection is altered. Fields with no toggle on the stage-config UI (name,
interest reason, notes, referral source) are always captured, unaffected.
Verified the frontend never reads `address_*`/`date_of_birth` from the
mapped response (`services/api.ts`'s `mapElectionPackageResponse`), so
omitting them carries no frontend regression risk. Covered by
`TestElectionPackagePIIFields` (configured exclusions honored; unconfigured
steps and no-step-id packages both still capture everything).

#### MP-16 — P1 — election-package assignment race, no row lock — ✅ FIXED

**What:** `assign_package_to_election` read the package via a plain
(unlocked) `get_election_package`, checked `pkg.status == "ready"`, then
wrote `election.ballot_items`/`pkg.election_id`/`pkg.status` — a
check-before-write with no lock or version check, CLAUDE.md Pitfall #27's
exact shape (already fixed once in this same file, for
`transfer_to_membership`, in pass 2). Two concurrent assignment calls for
the same package could both observe `"ready"` before either commits and both
append a ballot item to their own (possibly different) elections, landing
the applicant on two ballots with the second write to `pkg.election_id`
silently overwriting the first.
**Where:** `get_election_package`/`assign_package_to_election`,
`membership_pipeline_service.py`.
**Fix:** added `lock_for_update: bool = False` to `get_election_package`
(same signature shape as `get_prospect`'s existing parameter), and
`assign_package_to_election` now locks the package row and runs the
`"ready"` check against that locked read — the lock and the decision are the
same statement, so there is no snapshot gap between acquiring the lock and
reading the value it protects (per Pitfall #27's "the count itself must be a
locking read" requirement). Also locks the target `Election` row for the
same reason: two _different_ packages assigned to the _same_ election
concurrently would otherwise race the identical read-modify-write on
`ballot_items` and silently lose one ballot item. Covered by
`TestElectionPackageAssignmentLocking` — source-inspection tests (matching
this rotation's established pattern for lock-wiring guards,
`test_transfer_locks_the_prospect_before_checking_status`) confirming the
lock is acquired before the status check and that `get_election_package`'s
`lock_for_update` actually calls `with_for_update`, plus a behavioral test
confirming the ordinary path still works and a second assignment attempt is
still refused.

#### MP-17 — P1 — no state machine on election-package `status` — ✅ FIXED

**What:** `ElectionPackageUpdate.status` is an unrestricted `str`, and
`update_election_package` applied it directly with no allowed-value or
valid-transition check. A caller holding only `members.manage` could PUT
`{"status": "ready"}` on a package already `added_to_ballot`, then call
`assign_package_to_election` again — landing the same applicant on a second
ballot with **no race required** (a serial escalation, independent of and
compounding MP-16). A caller could also write `"elected"` directly (no vote
tally behind it) or an arbitrary unknown string, breaking the documented
five-state contract (`draft` → `ready` → `added_to_ballot` →
`elected`/`not_elected`, the last three set only by
`assign_package_to_election` and `election_service._sync_package_statuses`).
**Where:** `update_election_package`, `membership_pipeline_service.py`;
`ElectionPackageUpdate`, `schemas/membership_pipeline.py` (type left
unchanged — see below).
**Fix:** added `ELECTION_PACKAGE_CALLER_STATUSES = {"draft", "ready"}` and
`ELECTION_PACKAGE_SYSTEM_STATUSES = {"added_to_ballot", "elected",
"not_elected"}` module-level constants. `update_election_package` now
refuses a `status` update when the target isn't caller-settable, **or** when
the package's current status is already system-only — mirroring MP-9's fix
for `ProspectStatus.TRANSFERRED` exactly (a status the system derives must
not be settable _or clearable_ through the generic update). The Pydantic
schema field is deliberately left as `Optional[str]` rather than a `Literal`
— the existing module docstring already explains election-package status
was left off the request-schema enum validator list because it isn't a
strict MySQL `ENUM` column (unlike `step_type`/`action_type`/prospect
`status`), and duplicating the caller-settable set as a second literal in
the schema would only invite drift from the service-layer constants that are
now the single source of truth. Covered by
`TestElectionPackageStatusStateMachine`: every system/unknown status is
refused, `draft`/`ready` remain settable, a package already
`added_to_ballot` refuses _any_ status change (the specific compounding
scenario Codex described), and unrelated-field updates (`coordinator_notes`)
are unaffected.

#### MP-18 — P2 — document deletion could orphan the file on `OSError` — ✅ FIXED

**What:** `delete_prospect_document` deleted the `ProspectDocument` metadata
row and **committed** before attempting `os.remove()`; the code comment
directly above claimed the opposite order ("Remove the stored file from disk
before dropping the DB row"). A caught `OSError` (permissions, transient
filesystem error) was logged and swallowed, and the method still returned
`True` — the applicant's file, which can carry PII, survives on disk with no
database row left to retry cleanup against.
**Where:** `delete_prospect_document`, `membership_pipeline_service.py`.
**Fix:** reordered so the file removal is attempted first; a missing file
(`os.path.exists` false — already cleaned up by some earlier partial
failure) is not an error and the metadata delete proceeds as before, but a
file that exists and fails to remove now **raises** `ValueError` instead of
being swallowed — the metadata row survives specifically so it remains the
one record telling an operator this file still needs cleaning up. Added the
matching `except ValueError` → 400 in the endpoint (`membership_pipeline.py`,
which had no error handling on this call at all previously). Covered by
`TestDocumentDeletionDoesNotOrphanTheFile`: normal deletion still removes
both the file and the row; an already-missing file still deletes cleanly; a
mocked `os.remove` failure raises and leaves the metadata row (and the file)
in place.

#### MP-19 — P2 — unbounded prospect reads (`/widget-summary`, `/pipelines`) — PARTIALLY FIXED, PARTIALLY 🚩 FLAGGED

**What:** two read paths materialize every prospect row in an org rather
than aggregating in SQL — the same abuse-resistance class already tracked
as MP-10 for election packages. `GET /pipelines` (`list_pipelines`)
eager-loaded the full `MembershipPipeline.prospects` relationship (every
column of every historical applicant, across every pipeline) solely to
`len()` it per pipeline. `GET /widget-summary` (`pipeline_widget_summary`)
loads every full `ProspectiveMember` row in the org to compute status
counts, aging buckets, and (for managers) a full id/name/status `details`
list.
**Where:** `list_pipelines`, `membership_pipeline_service.py`;
`pipeline_widget_summary`, `membership_pipeline.py:118-168`.
**Disposition — `/pipelines`: FIXED.** Replaced the eager-loaded
`prospects` relationship with one aggregate `GROUP BY pipeline_id` count
query, attached as a non-mapped `prospect_count` attribute (same pattern as
`pipeline_name` on `ProspectiveMember`) — the response shape is unchanged,
so this is a pure efficiency fix with no API contract change, unlike MP-10.
Covered by `TestPipelineListProspectCount` (correct counts, including zero;
asserts via `sqlalchemy.inspect(...).unloaded` that the `prospects`
collection itself is never materialized).
**Disposition — `/widget-summary`: FLAGGED**, mirrored to
`docs/KNOWN_LIMITATIONS.md`. The aggregate counts here could similarly move
to SQL, but the `details` list is a full, uncapped enumeration in the
response contract itself — capping it silently truncates what a manager
sees (a behavior change) and paginating it is a response-envelope/frontend
contract change, the same category of decision MP-10 already declined to
make unilaterally rather than guess at.

### Completion gate (Codex-fix pass)

| Check                                                          | Result                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `flake8 app/ tests/ alembic/`                                  | pass, 0 violations                                                                                                                                                                                                                                                 |
| `black --check app/ tests/ alembic/`                           | pass (2 files needed reformatting, applied, re-check pass)                                                                                                                                                                                                         |
| `isort --check-only app/ tests/ alembic/`                      | pass, 0 violations                                                                                                                                                                                                                                                 |
| `python3 scripts/validate_migrations.py --strict`              | pass — 409 revisions, single head (no schema change)                                                                                                                                                                                                               |
| new guard tests (`test_membership_pipeline_pass3_codex.py`)    | 26 passed; independently confirmed to fail against the pre-fix code (`git stash` on the two changed source files — 15 of the 26 fail, matching the 5 fixed findings plus MP-19's fixed half; the other 11 are regression guards that correctly still pass pre-fix) |
| scoped election/membership/prospect/pipeline pytest (49 files) | 808 passed / 0 failed                                                                                                                                                                                                                                              |
| full backend suite (`pytest tests/ -q`)                        | 9859 passed / 21 skipped (pre-existing/environmental) / 0 failed (9833 baseline + 26 new guard tests)                                                                                                                                                              |

No frontend file changed in this pass, so `tsc`/`eslint` were not re-run.

### Original pass 3 draft (superseded above)

**Zero code diff, no new findings** — see the Revision note above; the
"no new findings" conclusion below did not hold once Codex's review looked
for the classes of defect this draft's checklist pass didn't specifically
probe (config switches with no reader, read-then-write races, error-path
ordering, and per-row query loops).

**Scope.** Diffed the full domain against pass 2's merge commit (`58535700`,
PR #1950): `endpoints/membership_pipeline.py`, `services/membership_pipeline_service.py`,
`models/membership_pipeline.py`, `schemas/membership_pipeline.py`,
`api/prospect_privacy.py`, `frontend/src/modules/prospective-members/`, and
`frontend/src/utils/membership.ts` are all **byte-identical** to pass 2
(`git diff --stat`, not assumed — confirmed for both the declared backend
files and a broad `git diff --name-only` over all of `frontend/src/`, which
turned up one incidental hit, `RoleSetup.membership.test.ts` in the
onboarding module — a substring match on "membership" in an unrelated test
file, not this feature). Every new migration since pass 2 (24 files) was
content-grepped for `prospect|membership_pipeline|pipeline_stage`; the one
hit, `20260901_1320_f7b3c8d2e569_restore_seeded_position_grants.py`, is the
same class of false positive pass 2 already documented — every match is a
`"prospective_members.*"` permission-string literal in an unrelated
position-grant backfill, not a schema change to any table this feature owns.

Given the zero diff, this pass did not re-derive conclusions from the prior
write-up — it independently re-read the current code against all seven
`CHECKLIST.md` dimensions and re-verified, at the cited line, that every
prior fix is still in place:

- **MP-8/MP-9** (`update_prospect`, `membership_pipeline_service.py:1166`) —
  confirmed `apply_updates` is still the write path (explicit `null` clears a
  field rather than being silently dropped) and the `TRANSFERRED`-status
  guard (`:1195-1204`) still refuses to set or clear that status through the
  generic update.
- **MP-11** (`approve-step`, `membership_pipeline.py:1160-1216`) — confirmed
  the route still returns `StepApprovalResponse` (id/step/`step_completed`
  only), not the full `ProspectResponse`.
- **MP-12** (interview self-access, `membership_pipeline.py:2200-2258`) —
  confirmed both `PUT`/`DELETE /interviews/{interview_id}` still carry
  `dependencies=[Depends(block_self_interview_access)]`.
- **Pass 2's two Codex findings** (role-grant ceiling and the transfer row
  lock) — confirmed in `membership_pipeline.py:1543-1561` (role ids resolved
  in-org and run through `_enforce_role_grant_ceiling` before
  `transfer_to_membership` is called) and
  `membership_pipeline_service.py:2402-2404` (`get_prospect(...,
lock_for_update=True)` ahead of the `TRANSFERRED` check).
- **MP-10** (unbounded election-package list/create,
  `membership_pipeline_service.py:4698-4718` /
  `:4512-4631`) — confirmed still open exactly as flagged: `list_election_packages`
  is still a bare `.scalars().all()` with no `limit`/`offset`, and
  `create_election_package` still has no per-prospect ready-package cap. No
  change — still a product decision, already mirrored in
  `KNOWN_LIMITATIONS.md`.

**Fresh checks, not previously written up explicitly, all clean:**

- **Route inventory** re-enumerated from source (51 routes across both
  files): every route carries `Depends(get_current_user)` at minimum, every
  route but `approve-step` (intentional — see pass 1's Verified good) carries
  a `require_permission(...)` gate matching its sensitivity, and every by-id
  route is either explicitly org-scoped in its service call or resolved
  through an org-scoped parent. No new route since pass 1's inventory.
- **Client-supplied FKs** — re-checked every write path that accepts one:
  `update_prospect`'s `referred_by` (`assert_in_org`,
  `membership_pipeline_service.py:1181-1188`), `create_election_package`'s
  `pipeline_id`/`step_id` (`:4535-4544`), `assign_package_to_election`'s
  `election_id` (org-scoped `select`, `:4755-4763`), `link_event`'s
  `event_id` (org-scoped `select`, `:5571-5581`), and
  `transfer_prospect`'s `role_ids` (see above). All validated in-org before
  being stored; none found unvalidated.
- **`ondelete="SET NULL"` nullability** (Pitfall #2) — every `SET NULL`
  foreign key in `models/membership_pipeline.py` (11 occurrences) carries
  `nullable=True`. Read in full, not sampled.
- **LIKE escaping** (Pitfall #25) — the two `.ilike()` call sites in this
  service (`:751-755` name/email search, `:2752` an unrelated
  `TrainingProgram.name` lookup used by a stage-config helper) both pass
  `escape=LIKE_ESCAPE_CHAR`.
- **JSON-column mutation** (Pitfall #12) — `assign_package_to_election`'s
  writes to `election.ballot_items` and `pkg.package_config`
  (`:4814-4825`) both go through `copy.deepcopy()` before reassignment.
- **Injection & output encoding** — no raw SQL (`text()`/f-string `.execute`)
  anywhere in the service; every user-controlled value interpolated into the
  applicant-notification email HTML (title, format, location, org name,
  first name, custom welcome message, FAQ link, status-check URL) is
  `html.escape`d before use (`:2859-2969`).
- **File upload/download** (`add_prospect_document`,
  `download_prospect_document`, `membership_pipeline.py:1706-1857`) — magic-byte
  MIME detection (not the client `Content-Type`), UUID filename with a
  MIME-derived extension, 50 MB size cap, and org+prospect-scoped storage
  path. Download re-validates the stored path resolves inside
  `PROSPECT_DOCUMENT_DIR` via `os.path.realpath` before serving. A failed
  document-metadata write cleans up the file it already wrote to disk
  (`except ValueError` / `except Exception` both call
  `_remove_prospect_document_file`), so a rejected upload cannot leave an
  orphaned file.
- **Bulk actions bounded** — `BulkAdvanceRequest`/`BulkStatusRequest.prospect_ids`
  both declare `max_length=_MAX_BULK_PROSPECTS` (`schemas/membership_pipeline.py:529,561`).
- **Frontend module axios instance** (Pitfall #7) — `services/api.ts` builds
  its client via the shared `createApiClient` factory
  (`frontend/src/utils/createApiClient.ts`), which sets
  `withCredentials: true` and the CSRF header interceptor; not a hand-rolled
  instance missing either.
- **`UNCACHEABLE_PREFIXES`** — `/prospective-members/` is listed in
  `frontend/src/utils/apiCache.ts`, and that is the exact router prefix this
  feature is mounted under (`api/v1/api.py:267-271`).
- **No banned frontend patterns** — zero `window.confirm`/`alert`/`prompt`,
  zero `dangerouslySetInnerHTML`, zero banned `.toLocale*` calls, zero direct
  `fetch()` in `modules/prospective-members/` or `modules/membership/`
  (grepped).

**Conclusion:** no new findings. Every prior finding's fix is intact at its
original mechanism; MP-10 remains correctly OPEN/FLAGGED, unchanged.
Completion gate below. Rotation row 08 -> awaiting PR merge. Next: 09 medical
screening (PHI).

### Completion gate (pass 3)

| Check                                                        | Result                                                           |
| ------------------------------------------------------------ | ---------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                | pass, 0 violations                                               |
| `black --check app/ tests/ alembic/`                         | pass, 1387 files unchanged                                       |
| `isort --check-only app/ tests/ alembic/` (9.0.1, CI-pinned) | pass, 0 violations                                               |
| `python3 scripts/validate_migrations.py --strict`            | pass — 409 revisions, single head                                |
| scoped pytest (20 membership/prospect/pipeline test files)   | 322 passed / 0 failed                                            |
| full backend suite (`pytest tests/ -q`)                      | 9833 passed / 21 skipped (pre-existing/environmental) / 0 failed |
| `npx tsc --noEmit`                                           | pass, 0 errors                                                   |
| `npx eslint .`                                               | pass, 0 errors (see below)                                       |

No frontend file in this feature changed, so `tsc`/`eslint` are whole-repo
runs, not a scoped diff check.

---

## Pass 2 (2026-08-27)

> **Revision note:** the backend section below, as first drafted, concluded
> the 2 changed backend files needed no further review since they matched
> already-Codex-reviewed work from PR #1931. That comparison was correct as
> far as it went, but incomplete — Codex's review of this PR's draft found
> two real, separate P1 issues in the same `transfer_prospect`/
> `transfer_to_membership`/`_do_transfer` path that PR #1931's review never
> had reason to look for (it was scoped to the administrative-rank pairing,
> not to `role_ids` or to concurrency): a missing role-grant ceiling on the
> transfer's `role_ids`, and a missing row lock making the transfer's
> already-once-fixed `ProspectStatus.TRANSFERRED` guard a check-before-write
> race. Both are recorded under Findings with what was actually done. The
> original draft's backend paragraph is left below for the record, followed
> by the corrected conclusion.

Scoped to the **full domain** since pass 1's merge commit (`aad49be4`,
PR #1815): `endpoints/membership_pipeline.py`, `services/membership_pipeline_service.py`,
`models/membership_pipeline.py`, `schemas/membership_pipeline.py`,
`api/prospect_privacy.py`, every migration since (checked by content, not
filename, for anything touching prospect/pipeline/stage tables), and —
learning from ELEC-06/USR-07 pass 2's own correction — a `git diff --stat`
against `frontend/src/` broadly rather than only `modules/prospective-members/`,
which also caught `frontend/src/modules/membership/routes.tsx` and the new
`frontend/src/utils/membership.ts`, both outside that directory.

**Backend (2 files changed, both already reviewed):** `endpoints/membership_pipeline.py`
(+42/-1) and `services/membership_pipeline_service.py` (+37) both changed
only for the privilege-ceiling fix already made and Codex-reviewed earlier
in this same rotation, on PR #1931 (feature 02, permissions & roles pass 2)
— `transfer_prospect` resolves and validates the prospect before checking
the administrative-rank ceiling (avoiding a false CRITICAL on an invalid
prospect id), and `_do_transfer` refuses an administrative class paired with
a rank via `is_administrative(...)`, matching
`TestEveryWriterIsCovered.test_the_prospect_transfer_path_refuses_the_pair`
(verified during USR-07 pass 2). This is an INSERT path (a new `User` row
via prospect conversion) rather than an update-in-place, and the
`ProspectStatus.TRANSFERRED` guard already prevents a double-transfer race,
so it does not need the `populate_existing`/row-lock treatment the update
writers required — no finding.

**Corrected backend conclusion (Codex review on this PR):** the two findings
below are both real and both fixed.

- **Missing role-grant ceiling on `transfer_prospect`'s `role_ids`.**
  `TransferProspectRequest` carries a caller-supplied `role_ids` list, and
  `_do_transfer` resolved those ids with only an `organization_id` filter and
  attached every match to the new `User` — `create_member`'s identical
  `role_ids` handling calls `_enforce_role_grant_ceiling` right after the
  same org-scoped resolution; `transfer_prospect` never did. A caller
  holding only `members.manage`/`prospective_members.manage` (neither of
  which implies `roles.manage`) could submit a wildcard or otherwise
  more-privileged role's id and mint an account with permissions beyond
  their own — and since the same request also controls
  `department_email`, they could point the new account's welcome email at
  an address they control and log in as it themselves, a full-tenant
  escalation through the transfer path rather than the (already-guarded)
  direct-create or assign paths. Fixed in `transfer_prospect`
  (`endpoints/membership_pipeline.py`): after the existing rank-ceiling
  check and before calling `service.transfer_to_membership`, resolve
  `data.role_ids` the same way `create_member` does (org-scoped, 400 on any
  id that doesn't resolve) and run `_enforce_role_grant_ceiling` on the
  result. Covered by
  `test_transfer_prospect_calls_role_ceiling` in
  `test_privilege_ceiling_wiring.py`.
- **`transfer_to_membership` is a check-before-write with no row lock.**
  `get_prospect` supports `lock_for_update=True` and the pattern is already
  established elsewhere in this service (`complete_step_for_prospect` locks
  before its own status check, with the exact comment explaining why) — but
  `transfer_to_membership` called `get_prospect` with no lock, checked
  `ProspectStatus.TRANSFERRED`, and only set that status _after_ creating
  the new `User` row in `_do_transfer`. Two concurrent transfer requests
  supplying distinct `username`/`membership_id`/`department_email` values
  (so the `User` table's uniqueness indexes don't conflict) can both observe
  `ACTIVE` before either commits, and both create a separate `User` account
  for the same prospect — the second write to `prospect.transferred_user_id`
  simply overwrites the first, silently orphaning one of the two accounts
  from the prospect record while leaving both live. This is the same
  read-then-write shape CLAUDE.md Pitfall #27 documents for capacity checks,
  applied to a one-time status transition instead of a count. Fixed by
  adding `lock_for_update=True` to `transfer_to_membership`'s `get_prospect`
  call, ahead of the `TRANSFERRED` check (the row lock serializes the
  decision; `get_prospect`'s query already carries
  `.execution_options(populate_existing=True)` unconditionally, so no
  separate staleness fix was needed here). Covered by
  `test_transfer_locks_the_prospect_before_checking_status` in
  `test_membership_pipeline_flow.py`.

**Migrations:** content-grepped (`prospect|membership_pipeline|pipeline_stage`,
case-insensitive) across every migration added since pass 1; the 3 hits are
all false positives — permission-string substring matches in unrelated,
already-reviewed storefront-grant-backfill migrations, not schema changes to
any membership-pipeline table.

**Frontend:** reviewed via a dedicated pass over the diff for `PipelineSettingsPage.tsx`
(527 L changed), `ProspectiveMembersPage.tsx` (237 L changed),
`ApplicantDetailDrawer.tsx`, `ConversionModal.tsx`, `StageConfigModal.tsx`,
`prospective-members/routes.tsx`, `services/api.ts`, `types/index.ts`, the
new `PipelineBuilder.test.tsx`, and the new `frontend/src/utils/membership.ts`
(the frontend counterpart to `backend/app/utils/membership.py`'s class/status
split, diffed line-by-line against it). Findings:

- Most of the diff is `DialogPortal` adoption on every fixed-position dialog
  shell — the established fix for the fixed-dialog-in-a-`backdrop-blur`
  defect (Pitfall #21 family) — structural only, no behavior change.
- `mapStageUpdateToBackend` used `?? undefined` on `inactivity_timeout_days`,
  collapsing an explicit `null` (clear a per-stage override) into an omitted
  key, which the backend's `exclude_unset=True` update path reads as "leave
  alone" — unticking a custom timeout silently failed to persist. Already
  fixed in this diff (forwards `null` verbatim) and covered by new tests in
  `stageMapping.test.ts`/`PipelineBuilder.test.tsx`; the create path
  correctly keeps `null → undefined` since no "leave alone" meaning exists
  on create. No further action.
- `DEFAULT_STAGE_CONFIGS` previously covered only 7 of 12 stage types,
  crashing the editor on a stored `checklist`/`reference_check`/
  `multi_approval`/`medical_screening`/`interview_requirement` stage.
  Already fixed in this diff (one canonical table shared by the editor and
  the read boundary) and covered by new tests. No further action.
- `frontend/src/utils/membership.ts` matches `app/utils/membership.py`'s
  `_SPLIT`/`is_administrative` exactly, including the no-guessing behavior
  for unknown/custom tiers; no label or comment misrepresents backend
  enforcement (the exact bug class `BallotBuilder.tsx` had in ELEC-06 pass 2
  — not repeated here).
- `ConversionModal` disables/clears the Rank input when "Administrative" is
  picked — client-side only, but confirmed backed by the same server-side
  refusal reviewed above (`_do_transfer`'s `is_administrative(...)` check),
  so this is defense-in-depth, not the actual gate.
- Module gating (`requiredModule`/`moduleLabel`) added to
  `prospective-members/routes.tsx` and a training-history route in
  `membership/routes.tsx`. Confirmed in `ProtectedRoute.tsx` that the module
  check runs strictly after the existing `requiredPermission`/`requiredRole`
  checks and is documented as a usability gate, not access control —
  additive, not a weakening.
- No stale-response race: neither page's diff added new fetch/`useEffect`
  logic (both are pure reindentation from the `DialogPortal` change).

Frontend: no confirmed security findings, no code changes needed (the diff's
own bugs were already fixed and tested within it). Backend: 2 real P1
findings, both fixed above and each covered by a guard test confirmed to
fail against the pre-fix code via `git stash` before being counted.
Completion gate: flake8/black/isort clean on every changed file;
`test_membership_pipeline_flow.py` + `test_privilege_ceiling_wiring.py` +
`test_prospect_create_privacy.py` + `test_rejected_prospect_dropped.py` +
`test_administrative_rank_restriction.py` (95 tests) all pass; full backend
suite 9112 passed / 22 skipped (pre-existing, environment-related) / 0
failed. Rotation row 08 -> done.

---

## Pass 1 (2026-08-25)

**Backend:** `endpoints/membership_pipeline.py` (2,255 L, 51 routes), `services/membership_pipeline_service.py` (5,690 L), `models/membership_pipeline.py`, `schemas/membership_pipeline.py`, `api/prospect_privacy.py`
**Frontend:** `modules/prospective-members/` (not re-read in full this pass — see Scope)
**Migrations:** `20260812_0003_restore_active_prospect_uniqueness.py`, `20260814_0003_reconcile_active_prospect_emails.py` — reviewed this iteration, see Schema & migration notes

> **Revision note:** the pass as first drafted (below, unedited) concluded "no
> new findings." Codex's review of that draft found five real issues the
> conclusion had missed, and a sixth (a second, unguarded path to the same
> defect Codex's fourth finding covered) turned up while fixing the fourth.
> All six are recorded under Findings with what was actually done. The
> original draft's Scope, Route inventory and Verified good sections are left
> intact below except where a finding required a correction — the point of
> this note is that the "no defect" conclusion they supported was wrong, not
> that the legwork in them was.

---

## Scope

This is a re-verification pass, not a first read. `docs/module-audit/membership-pipeline.md`
(MP-1 through MP-7, all ✅ FIXED) and `docs/app-review/membership-pipeline.md`
(MP2-1 through MP2-5, all ✅ FIXED) cover the module's history through
2026-08-09; neither doc has an open finding, so this pass did not re-derive
either.

The module grew substantially since that baseline (1,763 L / 44 routes →
2,255 L / 51 routes in the endpoint file; the service file from 4,236 L to
5,690 L) entirely from ordinary feature work — none of it run through the
security-review process. This pass focused on that unreviewed surface:

- **Read in full:** every commit touching `membership_pipeline.py` or
  `membership_pipeline_service.py` since 2026-08-09 (`git log --since
2026-08-09 --until 2026-08-25`), and the current source for every function
  those commits touched — `set_prospect_status`/`_apply_status_change`/
  `_assert_open` (closed-application gating, PR #1811), `record_step_approval`/
  `_authorized_multi_approval_result`/`_accumulate_approvals` (multi-approval
  signer authorization), `complete_current_step_for_integration_event`
  (webhook stage-completion reference matching, 2026-08-17),
  `get_kanban_board`, `list_prospects`/`list_election_packages` (open/closed
  filtering), and `app/api/prospect_privacy.py` in full (self-record access
  guard).
- **Enumerated:** all 51 routes, extracted programmatically (method, path,
  function, permission dependency) — see Route inventory below. This is a
  full listing, not a sample.
- **Verified by grep, not fully re-read line-by-line:** the ~30 endpoint
  functions untouched since the 2026-08-09 baseline (pipeline/step CRUD,
  document upload/download, interviews, event links). These were in scope for
  the prior module-audit and app-review passes and are unchanged since.
- **Not read this pass:** the frontend module
  (`frontend/src/modules/prospective-members/`). PR #1811's own Codex review
  already covered the frontend changes in that PR (findings 2–4, all fixed in
  `f5b1ae6a`); no frontend-only commits landed in this feature since then that
  weren't part of that PR.
- **Explicitly out of scope:** `app/api/public/integrations_webhook.py`. It
  calls into `complete_current_step_for_integration_event` but the webhook
  endpoint itself (auth, secret verification, provider parsing) belongs to
  feature 03 (Public surface & webhooks), already reviewed under
  `PUB-03-public-surface-webhooks.md` / PR #1806. This pass only verified the
  membership-pipeline-side half of that boundary: the service method the
  webhook calls into stays org-scoped and now requires the stage's configured
  reference to match the event (see Verified good).
- **Migrations correction:** the first draft of this pass claimed "no
  migrations touch this feature's tables since the last audit." False —
  `20260812_0003_restore_active_prospect_uniqueness.py` and
  `20260814_0003_reconcile_active_prospect_emails.py` both post-date the
  2026-08-09 baseline and alter `prospective_members` (email normalization,
  reconciling duplicate active rows to `inactive`, and installing the
  `uq_prospect_org_active_email` unique index). Both are now read in full —
  see Schema & migration notes.

## Route inventory

| Method | Path                                                      | Permission                                            | Org-scoped |
| ------ | --------------------------------------------------------- | ----------------------------------------------------- | ---------- |
| GET    | /widget-summary                                           | prospective_members.view / .manage                    | yes        |
| GET    | /pipelines                                                | prospective_members.view / .manage                    | yes        |
| POST   | /pipelines                                                | members.manage / prospective_members.manage           | yes        |
| GET    | /pipelines/{pipeline_id}                                  | prospective_members.view / .manage                    | yes        |
| PUT    | /pipelines/{pipeline_id}                                  | members.manage / prospective_members.manage           | yes        |
| PATCH  | /pipelines/{pipeline_id}/report-settings                  | members.manage / prospective_members.manage           | yes        |
| DELETE | /pipelines/{pipeline_id}                                  | members.manage / prospective_members.manage           | yes        |
| POST   | /pipelines/{pipeline_id}/duplicate                        | members.manage / prospective_members.manage           | yes        |
| POST   | /pipelines/{pipeline_id}/seed-templates                   | members.manage / prospective_members.manage           | yes        |
| GET    | /validate-form/{form_id}                                  | prospective_members.manage                            | yes        |
| GET    | /pipelines/{pipeline_id}/steps                            | prospective_members.view / .manage                    | yes        |
| POST   | /pipelines/{pipeline_id}/steps                            | members.manage / prospective_members.manage           | yes        |
| PUT    | /pipelines/{pipeline_id}/steps/reorder                    | members.manage / prospective_members.manage           | yes        |
| PUT    | /pipelines/{pipeline_id}/steps/{step_id}                  | members.manage / prospective_members.manage           | yes        |
| DELETE | /pipelines/{pipeline_id}/steps/{step_id}                  | members.manage / prospective_members.manage           | yes        |
| GET    | /pipelines/{pipeline_id}/kanban                           | prospective_members.view / .manage                    | yes        |
| GET    | /pipelines/{pipeline_id}/stats                            | prospective_members.view / .manage                    | yes        |
| POST   | /pipelines/{pipeline_id}/purge-inactive                   | members.manage / prospective_members.manage           | yes        |
| GET    | /source-events                                            | prospective_members.view / .manage                    | yes        |
| GET    | /prospects                                                | prospective_members.view / .manage                    | yes        |
| POST   | /prospects/check-existing                                 | members.create / prospective_members.manage           | yes        |
| POST   | /prospects                                                | members.create / prospective_members.manage           | yes        |
| GET    | /prospects/{prospect_id}                                  | prospective_members.view / .manage                    | yes        |
| PUT    | /prospects/{prospect_id}                                  | members.manage / prospective_members.manage           | yes        |
| POST   | /prospects/{prospect_id}/complete-step                    | members.manage / prospective_members.manage           | yes        |
| POST   | /prospects/{prospect_id}/approve-step                     | _(auth only — see note)_                              | yes        |
| POST   | /prospects/{prospect_id}/skip-step                        | prospective_members.manage                            | yes        |
| POST   | /prospects/{prospect_id}/advance                          | members.manage / prospective_members.manage           | yes        |
| POST   | /prospects/bulk-advance                                   | members.manage / prospective_members.manage           | yes        |
| POST   | /prospects/{prospect_id}/status                           | members.manage / prospective_members.manage           | yes        |
| POST   | /prospects/bulk-status                                    | members.manage / prospective_members.manage           | yes        |
| POST   | /prospects/{prospect_id}/regress                          | members.manage / prospective_members.manage           | yes        |
| POST   | /prospects/{prospect_id}/transfer                         | members.manage / prospective_members.manage           | yes        |
| GET    | /prospects/{prospect_id}/activity                         | prospective_members.view / .manage                    | yes        |
| GET    | /prospects/{prospect_id}/documents                        | prospective_members.view / .manage                    | yes        |
| POST   | /prospects/{prospect_id}/documents                        | members.manage / prospective_members.manage           | yes        |
| GET    | /prospects/{prospect_id}/documents/{document_id}/download | prospective_members.view / .manage                    | yes        |
| DELETE | /prospects/{prospect_id}/documents/{document_id}          | members.manage / prospective_members.manage           | yes        |
| GET    | /prospects/{prospect_id}/election-package                 | prospective_members.view / .manage / elections.manage | yes        |
| POST   | /prospects/{prospect_id}/election-package                 | members.manage / prospective_members.manage           | yes        |
| PUT    | /prospects/{prospect_id}/election-package                 | members.manage / prospective_members.manage           | yes        |
| GET    | /election-packages                                        | prospective_members.view / .manage / elections.manage | yes        |
| POST   | /prospects/{prospect_id}/election-package/assign          | elections.manage / prospective_members.manage         | yes        |
| POST   | /prospects/process-inactivity                             | members.manage / prospective_members.manage           | yes        |
| GET    | /prospects/{prospect_id}/interviews                       | prospective_members.view / .manage                    | yes        |
| POST   | /prospects/{prospect_id}/interviews                       | prospective_members.manage                            | yes        |
| PUT    | /interviews/{interview_id}                                | prospective_members.manage                            | yes        |
| DELETE | /interviews/{interview_id}                                | prospective_members.manage                            | yes        |
| GET    | /prospects/{prospect_id}/events                           | prospective_members.view                              | yes        |
| POST   | /prospects/{prospect_id}/events                           | prospective_members.manage                            | yes        |
| DELETE | /prospects/{prospect_id}/events/{link_id}                 | prospective_members.manage                            | yes        |

**Note on `/prospects/{prospect_id}/approve-step`:** the only route with no
`require_permission` gate (`membership_pipeline.py:1155`, `Depends(get_current_user)`
only). This is intentional — see Verified good below — but its response shape
was not (MP-11, FIXED).

Every route also sits behind the router-level `block_self_prospect_access`
dependency (`membership_pipeline.py:95`), so a `{prospect_id}` route is
additionally checked against the caller's own record regardless of permission.
**Correction:** `PUT`/`DELETE /interviews/{interview_id}` carry no
`{prospect_id}` path parameter and were not actually covered by this — see
MP-12.

## Verified good ✅

- **`approve-step`'s missing permission gate is closed by a server-side role
  check, not client input.** `record_step_approval`
  (`membership_pipeline_service.py:1564`) accepts a client-supplied `role`,
  but the string only decides _which_ configured approver role is being
  claimed — it never authorizes anything by itself. `complete_step` routes
  every multi-approval submission through
  `_authorized_multi_approval_result` (`membership_pipeline_service.py:1422`),
  which re-queries the authenticated signer's own `User.positions` (in-org,
  active, not soft-deleted) and rejects any submitted role the signer does not
  actually hold (`"You may only approve for a role you currently hold"`,
  line 1477). A caller cannot claim a role they lack, and cannot claim to be
  someone else — `completed_by`/`signer_id` come from `current_user.id`, never
  from the request body. This claim was correct as far as it went — it is
  about _who may sign_, not about _what the caller gets back_ for signing,
  which is a separate question the first draft conflated with this one and
  answered wrong. See MP-11.
- **Closed-application gating (PR #1811) is applied everywhere a closed
  applicant could otherwise re-enter workflow.** `_assert_open`
  (`membership_pipeline_service.py:133`) is called from
  `create_election_package` (line 4486), `assign_package_to_election`
  (line 4703), and `create_interview` (line 5235) — the three actions the
  commit identifies as consequential (a ballot package, assigning it to an
  election, and a fresh interview against a closed file). `_apply_status_change`
  (line 2156) is the single write path both the single-record and bulk status
  endpoints go through, and it explicitly refuses to set or clear
  `TRANSFERRED` (lines 2180–2188) — closing the P1 Codex found on the PR
  itself (setting `transferred` via status-change bypassed
  `transfer_prospect`'s User-creation side effects; clearing it would return
  an existing member to the applicant board under the active-email unique
  index).
- **The webhook stage-auto-completion path
  (`complete_current_step_for_integration_event`,
  `membership_pipeline_service.py:1861`) is org-scoped and reference-matched.**
  The prospect query filters `organization_id == organization_id` and
  `status == ACTIVE` (lines 1897–1898) before any email match is attempted, so
  a webhook cannot complete a stage for a prospect in a different
  organization even given a colliding email. The 2026-08-17 fix
  (`e1f6ea46`) added the `event_reference`/`reference_config_key` match
  (lines 1924–1931): the step's own configured booking URL / template id must
  match the inbound webhook event, closing the earlier gap where any webhook
  event for a matching email + step type + provider could complete an
  unrelated stage (e.g. a different Cal.com booking for the same applicant).
- **Self-record access is blocked router-wide for every route that carries a
  `{prospect_id}` path parameter — but that claim, as first drafted, silently
  assumed every by-id route in this router carries one.** It doesn't: see
  MP-12. `app/api/prospect_privacy.py`'s `block_self_prospect_access` is
  installed as a router-level dependency (`membership_pipeline.py:95`,
  `APIRouter(dependencies=[Depends(block_self_prospect_access)])`), so a new
  `{prospect_id}` route added later inherits the guard without needing to
  remember it. It answers 404 (not 403) on a match, deliberately, so a 403
  doesn't confirm existence. `get_hidden_prospect_ids` (the list-filtering
  counterpart) is applied at all 8 endpoints that return multiple prospects
  or packages at once: `widget-summary`, `pipelines/{id}/kanban`,
  `pipelines/{id}/stats`, `source-events`, `prospects`, `prospects/bulk-advance`,
  `prospects/bulk-status`, and `election-packages` — confirmed by grep for
  `hidden_prospect_ids` across the endpoint file. The per-prospect
  `{prospect_id}/events` list route does not need it (and doesn't have it):
  it is already covered by the router-level `block_self_prospect_access`
  guard on its own `{prospect_id}` path parameter, same as every other
  by-id route.
- **LIKE search is escaped correctly.** The two `.ilike()` call sites in this
  service (`membership_pipeline_service.py:750-754`, name/email search, and
  `:2708`, a system-generated `"%probationary%"` lookup) both pass
  `escape=LIKE_ESCAPE_CHAR` from `app/utils/sql_search.py`, per Pitfall #25.
- **Prospect-id normalization in the self-access guard resists the
  case/format bypass.** `normalize_prospect_id`
  (`app/api/prospect_privacy.py:82`) routes both the stored id and the
  path-supplied id through `uuid.UUID()` before comparison, so re-casing or
  unhyphenating a caller's own id (MySQL's default collation is
  case-insensitive) cannot walk past the guard.

## Findings

Six, all from the code this pass's own draft had just called sound. Five were
caught by Codex's review of that draft; the sixth turned up while fixing the
fourth. All are fixed except the one flagged.

### MP-8 — MED — `update_prospect` silently dropped explicit nulls — ✅ FIXED

**What:** the generic setattr loop used `if value is not None and
hasattr(prospect, key):` to decide whether to write a field. The endpoint
builds `data` via `ProspectUpdate.model_dump(exclude_unset=True)`, so a key
present in `data` was explicitly sent by the caller — an explicit `null`
means "clear this field," per CLAUDE.md Pitfall #1. The old guard treated it
identically to an omitted key and silently kept the old value.
**Where:** `membership_pipeline_service.py:1165` (`update_prospect`).
**Failure scenario:** `PUT /prospects/{id}` with `{"referred_by": null}` (or
`phone`, `date_of_birth`, `address_street`, ...) returns 200. The coordinator
believes the referral was cleared; the stale `referred_by` — a client-supplied
FK — survives, including into a later `transfer_prospect` copy onto the new
User row.
**Impact:** silent data-integrity loss on every nullable field this update
endpoint owns; low severity per-field, but it is the exact class of bug
CLAUDE.md calls the project's most common.
**Fix:** rewrote `update_prospect` to use the repository's `apply_updates`
helper (`app/utils/model_updates.py`), already the pattern for pipeline and
step updates in this same service. It writes an explicit null as a clear, and
raises `ValueError` → 400 (instead of a silent no-op) when the null targets a
`NOT NULL` column (e.g. `email`, `status`) rather than accepting an update
that didn't do what it said. Old values are captured before the write so the
existing `prospect_updated` activity-log diff (including the MP-6
sensitive-field masking for DOB/address) is unchanged.

### MP-9 — HIGH — a second, unguarded path to set or clear `TRANSFERRED` — ✅ FIXED

**What:** discovered while fixing MP-8. `ProspectUpdate` includes `status`,
and the old `update_prospect` loop wrote it with the same bare `setattr` as
every other field — it never routed through `_apply_status_change`, so it
carried none of that function's guards, including the one PR #1811's own
Codex review added (P1: `TRANSFERRED` is derived by `transfer_prospect` and
must not be set or cleared through a status change). The dedicated status
endpoints (`/prospects/{id}/status`, `/prospects/bulk-status`) were fixed;
the older, still-live `PUT /prospects/{id}` was not.
**Where:** `membership_pipeline_service.py:1165` (`update_prospect`); the
frontend still sends `status` through this endpoint's payload for some edit
paths (`modules/prospective-members/services/api.ts:744,1098`).
**Failure scenario:** `PUT /prospects/{id}` with `{"status": "transferred"}`
marks an applicant a member with no `transfer_prospect` run — no User row, no
`transferred_user_id`/`transferred_at` stamped — while counting as a
conversion in the stats. The mirror case is worse: `PUT` with
`{"status": "active"}` against a prospect already `TRANSFERRED` returns an
existing member to the applicant board, racing the
`uq_prospect_org_active_email` unique index against their own active-email
prospect record from before they transferred.
**Impact:** the exact state-corruption / membership-integrity issue Codex's
P1 on #1811 was written to close, reachable through a route that predates
that fix and was never touched by it.
**Fix:** `update_prospect` now parses a submitted `status` and refuses it,
with the same message as `_apply_status_change`, when either the target or
the prospect's current status is `TRANSFERRED`. An ordinary status edit
(e.g. `active` → `on_hold`) through this endpoint is unaffected.

### MP-10 — MED — unbounded election-package list and creation — 🚩 FLAGGED

**What:** `list_election_packages` (`membership_pipeline_service.py:4638`)
runs `result.scalars().all()` with no `limit`/pagination, and
`create_election_package` (`:4468`) has no per-prospect or per-organization
cap — no unique constraint on `ProspectElectionPackage.prospect_id`, and no
"already has a ready package" check. Every `POST
/prospects/{id}/election-package` call inserts a new row; the doc snapshot
each carries (documents, coordinator notes, config) persists indefinitely.
**Where:** `membership_pipeline_service.py:4638` (list),
`membership_pipeline_service.py:4468` (create).
**Failure scenario:** repeated legitimate package regeneration (e.g. after
editing coordinator notes) for even one applicant accumulates rows without
bound; `GET /election-packages` — the list an election officer assembles a
ballot from — grows in lockstep, along with the PII-carrying snapshots each
row holds.
**Impact:** same class already tracked elsewhere in this rotation (FIN-9,
ELEC-12, USR-5) — unbounded accumulation of PII-carrying rows and an
ever-growing scan on a route with no natural ceiling.
**Fix:** not applied. Enforcing one ready package per prospect is a behavior
change (could break an intended "regenerate before the vote" flow); adding
pagination to `GET /election-packages` is a response-envelope/API-contract
change for the frontend, same as the other three unbounded-list items this
rotation has flagged rather than fixed. Mirrored into
`docs/KNOWN_LIMITATIONS.md`.

### MP-11 — HIGH — `/approve-step` returned full prospect PII to a caller with no view permission — ✅ FIXED

**What:** the endpoint authorizes a caller by the role they hold on a
multi-approval stage (`_authorized_multi_approval_result`, see Verified
good) — deliberately not gated by `prospective_members.view`, since a stage's
approver roles (chief, president, ...) are rarely held by anyone with view
access. It nonetheless returned the full `ProspectResponse` — DOB, full
address, phone, `interest_reason`, `notes` (coordinator commentary),
`step_progress` — as the HTTP response body.
**Where:** `membership_pipeline.py:1152` (`response_model=ProspectResponse`,
`return prospect`).
**Failure scenario:** a member holding only a stage's configured office
(e.g. Fire Chief), with no `prospective_members.*` permission at all, submits
their one authorized sign-off and receives the applicant's full confidential
file in the response — everything the role check was designed to keep out of
their hands, as a side effect of an action the role check correctly let them
take.
**Impact:** PII/PHI-adjacent exposure to a caller class this router
specifically does not extend view access to.
**Fix:** added `StepApprovalResponse` (`schemas/membership_pipeline.py`) — a
minimal `{prospect_id, step_id, step_completed}` result — and changed the
route's `response_model` to it. `step_completed` is derived from the
returned prospect's own `step_progress` row for the submitted step
(`status == COMPLETED`), not re-derived business logic. No frontend consumes
this endpoint (checked — no match for `approve-step` anywhere under
`frontend/src/modules/prospective-members` or elsewhere), so the response
shape change has no caller to break.

### MP-12 — HIGH — `PUT`/`DELETE /interviews/{interview_id}` bypassed the self-access guard — ✅ FIXED

**What:** `block_self_prospect_access` is keyed on
`request.path_params.get("prospect_id")`. The two interview-mutation routes
are registered at `/interviews/{interview_id}` — no `{prospect_id}` in their
path — so the guard's lookup always returns `None` and the dependency no-ops
for them. `delete_interview` (`membership_pipeline_service.py:5368`) resolves
purely by `interview_id` + `organization_id`, with no check against who the
interview is about.
**Where:** `membership_pipeline.py:2139` (`update_interview` decorator),
`membership_pipeline.py:2174` (`delete_interview` decorator).
**Failure scenario:** a caller who holds `prospective_members.manage` — a
coordinator role a former applicant can hold once transferred to membership —
knows or guesses the id of an interview filed against their own past
application, and calls `DELETE /interviews/{id}` (no identity check on the
service side at all) or, if they happen to be the recorded interviewer,
`PUT` to alter it. This is exactly the class of self-access the router-level
guard exists to close everywhere else in this feature.
**Impact:** an applicant-turned-coordinator can destroy or alter the record
of their own vetting.
**Fix:** added `block_self_interview_access`
(`app/api/prospect_privacy.py`) — resolves `interview_id` to its owning
`ProspectiveMember` via a join and applies the same `self_prospect_predicate`
check as the router-level guard, answering 404 (not 403) on a match, for the
same reason. Wired as a per-route `dependencies=[...]` on both interview
mutation routes, since they sit outside the router-level guard's path-param
assumption.

## Schema & migration notes

`20260812_0003_restore_active_prospect_uniqueness.py` and
`20260814_0003_reconcile_active_prospect_emails.py` (both post-dating the
2026-08-09 baseline, per Codex — see Scope) were read in full this pass. Both
are org-scoped throughout (`keeper.organization_id = duplicate.organization_id`
in the dedup `UPDATE`, and the unique index itself is on
`(organization_id, active_email)`, not a bare `email` uniqueness that would
leak across tenants), both guard on `prospective_members` existing before
touching it (Pitfall #26), and both are textually-identical copies of the
same repair by design (`20260812_0003`'s own comment explains why: it runs
_before_ `20260814_0003` in the chain, so a fresh install with legacy
duplicate active emails would fail inside `op.create_index` and never reach
the later revision's cleanup without its own copy). No defect found in
either; this is a scope correction to the first draft, not a new finding.

No other migrations touch this feature's tables since the last audit.

## Guard tests added

- `backend/tests/test_rejected_prospect_dropped.py` —
  `TestGenericUpdateStatusGuard` (MP-9: `update_prospect` refuses to set or
  clear `TRANSFERRED`, and an ordinary status edit through the same endpoint
  still works) and `TestGenericUpdateExplicitNull` (MP-8: an explicit null
  clears `referred_by`/`phone`, and an explicit null against the `NOT NULL`
  `email` column is a 400, not a silent no-op).
- `backend/tests/test_prospect_self_access.py` — `TestInterviewRouteGuard`
  (MP-12: the guard is registered on both interview routes; a caller's own
  interview is 404 on `PUT`/`DELETE` while another applicant's is editable).
- `backend/tests/test_approve_step_response.py` (new file, MP-11): the
  response body from a successful approval contains exactly `{prospect_id,
step_id, step_completed}` — no prospect PII field, checked both by key-set
  and by asserting applicant-identifying strings are absent from the raw
  response body — for both a stage-completing approval and a partial one.

## Completion gate

| Check                                                       | Result                                              |
| ----------------------------------------------------------- | --------------------------------------------------- |
| `flake8` (touched files)                                    | pass                                                |
| `black --check` (touched files)                             | 2 files needed reformatting, applied, re-check pass |
| `isort --check-only` (touched files)                        | pass                                                |
| `python3 scripts/validate_migrations.py --strict`           | pass (357 migrations, single head)                  |
| `pytest` — full membership-pipeline test surface (17 files) | 228 passed                                          |
| `pytest tests/test_pii_exposure.py`                         | 37 passed                                           |
| `npx tsc --noEmit`                                          | pass (no frontend files changed)                    |

Test files run: `test_rejected_prospect_dropped.py`, `test_prospect_self_access.py`,
`test_approve_step_response.py`, `test_membership_pipeline_service.py`,
`test_multi_approval_accumulation.py`, `test_prospect_bulk_actions.py`,
`test_membership_pipeline_flow.py`, `test_membership_pipeline_enum_validation.py`,
`test_active_prospect_uniqueness.py`, `test_pipeline_stage_auto_advance.py`,
`test_pipeline_widget_privacy.py`, `test_prospect_create_privacy.py`,
`test_prospect_duplicate_response.py`, `test_prospect_event_source.py`,
`test_prospect_fields.py`, `test_prospect_pipeline_scaling.py`,
`test_prospect_stage_movement.py` — every file under `backend/tests/` whose
name matches `membership`, `prospect`, or `pipeline`, run in full rather than
filtered by `-k`, per this rotation's standing practice of not trusting a
keyword filter's apparent match.
