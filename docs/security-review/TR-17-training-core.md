# Security Review 17 — Training Core

**Prefix:** `TR` · **Iteration:** 17 · **Reviewed:** 2026-08-26 · **PR:** [#1851](https://github.com/thegspiro/the-logbook/pull/1851)

**Backend:** `api/v1/endpoints/training.py` (3,162 L),
`api/v1/endpoints/training_programs.py` (2,142 L),
`api/v1/endpoints/training_sessions.py` (528 L),
`services/training_service.py` (1,034 L),
`services/training_program_service.py` (5,482 L — grew from 4,027 L, +36%),
`services/training_session_service.py` (1,801 L),
`services/training_compliance.py` (771 L)
**Frontend:** `modules/training` (not read line-by-line this iteration)
**Migrations:** none this iteration (no schema change)

---

## Pass 3 (2026-09-04) — Codex follow-up: 1 fix, 1 flagged, 1 corrected claim

**PR:** [#2217](https://github.com/thegspiro/the-logbook/pull/2217) merged
at its stale first-draft state before this correction could be pushed to
it (CLAUDE.md pitfall #24 — the same race that hit #2213; see
`PROGRESS.md`'s Log for detail). The fix carried forward through four more
recovery branches/PRs of the identical shape, three of which again raced an
in-progress Codex review and had to move on in turn:
[#2218](https://github.com/thegspiro/the-logbook/pull/2218) (rounds 1-3,
premature merge) → [#2220](https://github.com/thegspiro/the-logbook/pull/2220)
(round 4, premature merge) → [#2221](https://github.com/thegspiro/the-logbook/pull/2221)
(round 5, premature merge) → **[#2222](https://github.com/thegspiro/the-logbook/pull/2222)**
(rounds 6-9, `claude/security-review-training-core-tr3-round6`), which
**merged cleanly** — the first merge in this pass not to race an
in-progress review, closing out the TR3-1 finding after nine rounds total.
See `PROGRESS.md`'s Log for each recovery's detail.
**Scoped since pass 2's merge:** `0b8b5bd4` (PR #1981).

> **Correction (Codex review of this PR).** The first draft of this section
> claimed "no findings, no code changes" and described two things as
> "already reviewed"/"clean" that were not quite either. Codex raised three
> comments; all three real. One is a genuine bug in this feature's own code
> (fixed below); the other two are corrections to this draft's own claims,
> not new code defects. The section below is the corrected one.

Diffed the seven declared files (six pass-1 files plus `training_compliance.py`,
already declared) against the pass-2 merge commit, plus a fresh grep for any
other file instantiating `TrainingService` or importing the training models —
one found, `app/mcp/tools/training.py`, reviewed below as a scope addition
(the same class of gap Codex caught in the Events pass immediately before
this one: a feature-specific MCP tool file added after the last pass and
never swept in).

**Of the seven, two changed:** `services/training_service.py` (+329/-91)
and `services/training_compliance.py` (+27/-14). `training.py`,
`training_programs.py`, `training_sessions.py`, `training_program_service.py`,
and `training_session_service.py` are byte-identical to pass 2 — confirmed
via `git diff --stat`, not assumed. No new migration touches any table this
feature owns (checked `alembic/versions/` by content, not filename — several
new migrations matched a bare `training` grep only inside the word
"cons**training**" or by restoring `training.*` permission strings across
seeded positions, which is the Permissions & roles feature's own domain, not
this one's).

**Two adjacent files this feature also declares carry another feature's
already-reviewed fix, not new surface of this one's:** `models/training.py`
(+109/-4) and `types/training.ts` (+32/-9) are both misleadingly-named shared
files. The former's entire diff is `Shift`/`ShiftTemplate`/
`ShiftTemplateEquipmentCheck` — Scheduling's models, already reviewed in
`SCH-15-scheduling.md` pass 3 (the `equipment_check_template_ids` feature).
The latter's entire diff is `ComplianceProfile*`/`ComplianceConfig*` type
widenings citing `CMP2-2`/`CMP2-3`/`CMP2-4` — the Compliance feature's own
security-review fixes (Pitfall #1 explicit-null-vs-omitted correctness for
its config forms). `training_compliance.py`'s own change
(`compute_org_compliance_pct`) is likewise cited as **CMP2-3** in its own
comment — read directly to confirm the fix is what it claims: `if profile.
required_requirement_ids is not None:` now correctly treats an explicitly
empty list as "zero requirements," and the threshold-override reads were
un-nested from that same conditional so they apply whenever the profile
matched, independent of whether it also overrides the requirement list.
Correct, matches the CMP2-3 description, not a re-finding.

> **Correction (Codex): `schemas/training.py`'s SSRF-hardening change was
> not, in fact, already reviewed.** The first draft claimed this — a
> `field_validator` on `ExternalProviderConfig`'s four endpoint fields,
> using `relative_endpoint` — belonged to and was covered by feature 18
> ("training extended"). Codex checked the dates: the validator landed
> September 2, after Training Extended's own pass 2 (August 29), and
> feature 18's pass 3 has not run yet — so nothing had actually reviewed it,
> and feature 18's own declared file list doesn't name `schemas/training.py`
> at all, which could have let it fall through that future pass too.
> Reviewed it directly here instead of continuing to defer it:
> `relative_endpoint` (`app/utils/ssrf_transport.py`) rejects any value that
> isn't a bare path starting with a single `/` (no scheme, no netloc, no
> `//` protocol-relative trick, no fragment) — correct for its purpose. More
> importantly, the actual outbound call sites in
> `external_training_service.py` (`join_endpoint(provider.api_base_url,
records_endpoint)`, four call sites) already run every configured endpoint
> through this exact same `relative_endpoint` check at request time,
> independent of whether the schema validates it at save time — confirmed by
> reading `join_endpoint`'s own body. So this schema-level addition is
> defense-in-depth (an early, clean 400 instead of a 500 deep in an outbound
> call), not the closing of a live gap: the SSRF vector was already closed
> at the point that actually matters. Not a finding against this feature,
> and — now that it has actually been read — not an open item to hand to
> feature 18 either.

**`training_service.py`'s diff is squarely this feature's own: an N+1
performance rework, org/tenant isolation preserved throughout.**
`check_requirement_progress` gained optional `requirement`/
`completed_records` parameters so a caller checking many requirements for
one member (`get_requirements_progress_for`, new) can preload the member's
completed records **once** and have every requirement's check filter that
same in-memory set, instead of each requirement issuing its own query.
Read every branch (HOURS, CERTIFICATION, SHIFTS, CALLS, and the
skills/checklist fallback) to confirm the in-memory path filters
identically to the SQL path it replaces (training_type, required_courses,
frequency window via `_windowed()`/`_all_completed()`):

- The preload itself (`get_requirements_progress_for`) is the only place
  `TrainingRecord` rows are fetched for this path, and it filters
  `user_id`, `organization_id`, and `status == COMPLETED` before anything
  downstream ever sees a row — every requirement's in-memory filtering
  inherits this scoping; there is no path where a preloaded row could
  belong to another org or another member.
- `get_all_requirements_progress` (TR-12's original fix site) no longer
  does its own `User` lookup at all — that responsibility moved to
  `get_applicable_requirements`, which already carries an org-scoped
  `User` query (`User.id == ... , User.organization_id == ...`, confirmed
  at its current location). `generate_training_report`'s tier-exemption
  block (TR-12's other fix site, using the locally-aliased `_User`, which
  is why a bare `select(User)` grep alone would have missed it — checked
  both spellings) still carries its own org filter, unchanged.
- Only columns the checks actually read are preloaded
  (`_PROGRESS_RECORD_COLUMNS`, a fixed tuple — never notes, attachments, or
  anything PHI-adjacent beyond what these checks already handled), loaded
  as plain rows rather than ORM instances specifically to avoid colliding
  with a fully-loaded copy of the same row already in the session.
  `_preload_window` bounds the date range read to the union of what the
  page's own requirements can use, returning `None` (no bound — read
  everything) only when a requirement type that inherently ignores the
  window is present (certification, or biannual hours' expired-cert
  override) — matches `check_requirement_progress`'s own per-requirement
  window logic exactly, so the preload can't under-fetch what a later
  per-requirement check needs.
- No new client-supplied FK, no new unauthenticated route, no schema
  change. `training.py` (the endpoint file) is untouched, so
  `get_training_dashboard_summary` (TR2-4, flagged, unbounded per-request
  scan) is not this refactor's target and remains exactly as flagged —
  confirmed, not assumed, since the file has zero diff.

### Scope addition — `app/mcp/tools/training.py` (following the EV-16 lesson)

Not part of any prior pass's declared scope; predates this diff (unchanged
in it) but was never swept into a security-review pass. Read in full (170
L, 4 tools): `list_expiring_certifications` and `list_member_training_records`
are both directly org/member-scoped and paginated with a real `total` count
(the former org-wide with a bounded `days_ahead` clamped to 1–730 days, the
latter through `require_member` — the same shared, already-reviewed
org-scoped-or-`ValueError` helper the Events MCP tools use). `get_member_
training_summary` and `get_member_requirements_progress` both resolve the
target member through `require_member` before calling into
`TrainingService`. Tenant isolation is correct on all four; no cross-org
or cross-member read is reachable.

> **Correction (Codex): `get_member_requirements_progress` is not fully
> bounded, and the first draft should not have called it clean.** `limit`
> only bounds the number of _returned_ progress rows. Two unbounded reads
> still happen underneath on every call: `get_applicable_requirements`
> itself has no page bound (mitigated only by the pass-2 finding that
> configuration data — requirements — is naturally small per org, tens not
> thousands); and if the requested page happens to include a CERTIFICATION-
> type requirement (or a BIANNUAL-hours one), `_preload_window` returns
> `None`, so `get_requirements_progress_for` preloads the member's _entire_
> completed-training history rather than a date-bounded slice. Neither is
> new: both are the same characteristic `check_requirement_progress` always
> had per-requirement (a certification check has always ignored the
> frequency window, by design — a cert is valid until it expires, not per
> period), just newly reachable through this MCP tool, which had never been
> reviewed before this pass. **Flagged, not fixed** — same disposition as
> TR2-4, for the same reason: bounding a certification check's window
> without breaking its correctness is a service-level redesign
> (`training_compliance.py`'s date-window logic would need to change what
> "ignoring the window" means for this class of call), not a safe drive-by
> change. Mirrored into `docs/KNOWN_LIMITATIONS.md`.

## Findings (pass 3)

### TR3-1 — LOW/MED (correctness) — `RequirementProgress.days_until_due` was never populated — ✅ FIXED

**Reported by Codex on this PR; confirmed.** All three `RequirementProgress(...)`
construction sites in `check_requirement_progress` set `due_date=requirement.
due_date` but never `days_until_due`, so the field always serialized as its
schema default, `None` — regardless of whether the requirement actually had
a due date. This is pre-existing (none of the three sites is part of this
pass's own diff) and was never caught before because nothing consuming
`RequirementProgress` had an explicit, checkable contract naming the field
until this pass's own `app/mcp/tools/training.py` scope addition — its
`get_member_requirements_progress` docstring promises "days until due
(negative when overdue)" verbatim, which this pass should have verified
rather than taken on faith when declaring that tool "clean."

**Where:** `app/services/training_service.py` — `check_requirement_progress`,
all three `return RequirementProgress(...)` sites.

**Impact:** LOW/MED. Not a tenant-isolation or auth defect — every consumer
of this field (the training UI's own due-date badges, this pass's MCP tool)
simply received a silently-wrong `null` where a real day count belonged, in
both the ordinary and the negative-when-overdue case. An MCP-driven
automation deciding whether to escalate an overdue requirement based on
`days_until_due` being negative would never fire.

**Fix (round 1, incomplete):** computed `days_until_due = (requirement.
due_date - today).days if requirement.due_date else None` once near the top
of the method and passed it to all three construction sites. Verified against
an explicit `due_date` — missed that most requirements don't have one.

**Round 2 — Codex caught the round-1 fix still broken for the common case.**
A `calendar_period` requirement (the default `due_date_type`, covering every
annual/quarterly/monthly requirement) carries no `due_date` of its own — its
deadline is the _end of its evaluation window_, which `_get_date_window()`
already returns as `end_date` and which `evaluate_requirement_detail()`
already uses as exactly this fallback (`effective_due_date = req.due_date if
req.due_date else (end_date if end_date else None)`). Computing solely from
`requirement.due_date` therefore left `days_until_due` (and `due_date`) null
for every calendar-period requirement — the case this fix exists for — and
only worked for the rare requirement with an explicit fixed date. Fixed by
computing `effective_due_date = requirement.due_date or end_date` right after
`_get_date_window()` (before the recency-cutoff logic below it can overwrite
`end_date`), and using `effective_due_date` for both the `due_date` and
`days_until_due` fields at all three construction sites — mirroring
`evaluate_requirement_detail()`'s own fallback rather than duplicating a
divergent one. The `BIANNUAL` cert-expiration override that
`evaluate_requirement_detail()` layers on top of that fallback was left alone:
out of scope for this finding, and unchanged from pre-existing behavior.

**Guard tests:** `test_training_compliance_integration.py::
TestHoursRequirementCompliance::test_days_until_due_is_populated` and
`::test_days_until_due_is_negative_when_overdue` — insert a requirement with
an explicit `due_date` 10 days out / 5 days past, assert the returned
`RequirementProgress.days_until_due` is `10` / `-5` respectively.
`::test_days_until_due_falls_back_to_the_period_window_end` — insert an
ordinary `calendar_period` annual requirement with no explicit `due_date`,
assert `RequirementProgress.due_date`/`days_until_due` resolve to the
window's Dec 31 end date rather than `None` — this is the test that would
have caught round 1's gap.

**Round 3 — Codex caught round 2's own fallback broken for `rolling`
requirements.** `effective_due_date = requirement.due_date or end_date`
is correct for `calendar_period` (`end_date` really is the period's
deadline) but wrong for `due_date_type="rolling"`: `_get_date_window()`
always returns `today` as `end_date` for a rolling requirement — it is a
trailing evaluation window (`today - rolling_period_months` to `today`),
not a deadline — so round 2 reported `due_date=today` /
`days_until_due=0` for every rolling requirement regardless of when it
was last completed. A rolling deadline is genuinely defined as _last
applicable completion + the configured interval_, which has no
relationship to the evaluation window at all. Fixed by adding a third
branch (`explicit due_date` → `rolling` anchor → `calendar_period` window
fallback, in that order) that resolves the rolling case via a new
`_rolling_due_date()` helper: the latest completed record matching the
requirement's `training_type` (mirroring the filter every other branch of
`check_requirement_progress` already applies), plus
`rolling_period_months`, via the preloaded `completed_records` when given
or a `MAX(completion_date)` query otherwise. Returns `None` — not `today`
— when the member has no applicable completion yet, since there is no
anchor to compute a deadline from and reporting "due today" for an
untouched requirement would be actively misleading.

While fixing this, found and fixed the same latent bug in the sibling
function `evaluate_requirement_detail()` (the `/my-training` endpoint's
own detailed-breakdown path) — it uses the identical `req.due_date or
end_date` fallback this pass's round 2 had copied, and reading it closely
after Codex's finding confirmed it has carried the exact same rolling-mode
flaw since it was introduced (pass 1, PR #1851), independent of anything
in this pass's diff. Not reported by Codex on this PR (out of this PR's
declared diff, and evaluate_requirement_detail's own days_until_due logic
predates this pass entirely) — found by inspection while fixing the
sibling copy of the same pattern, and fixed in the same commit per
CLAUDE.md's "no acceptable pre-existing errors" rule rather than left for
a future pass to rediscover. Uses the same anchor logic, adapted to work
in-memory against the already-fetched `member_records` list (this
function takes no `db` session) instead of a query.

**Guard tests (round 3):**
`test_training_compliance_integration.py::TestHoursRequirementCompliance::
test_days_until_due_for_rolling_requirement_anchors_on_last_completion` and
`::test_days_until_due_for_rolling_requirement_with_no_completion_is_none`
for `check_requirement_progress`;
`test_training_compliance.py::TestEvaluateRequirementDetailFields::
test_days_until_due_for_rolling_requirement_anchors_on_last_completion` and
`::test_days_until_due_for_rolling_requirement_with_no_completion_is_none`
for `evaluate_requirement_detail`. All four confirmed failing (reproducing
`due_date=today`/`days_until_due=0`) against the round-2 code before the
round-3 fix, via `git stash` on just `training_service.py`.

**Round 4 — Codex found three more gaps in round 3's own rolling-anchor
fix**, all real:

1. **No `certification_period` branch at all.** The fallback chain
   (`explicit due_date` → `rolling` anchor → `calendar_period` window end)
   never checked for `due_date_type="certification_period"`, so a
   certification-period requirement fell through to the window-end
   fallback: `None` for a BIANNUAL-frequency cert requirement (no window
   at all) or the calendar year end for any other frequency — neither of
   which is the certificate's actual expiration date. A
   certification-period requirement never resets on a schedule; it comes
   due when the currently-held certificate itself expires. Fixed with a
   new `_certification_due_date()` helper: the latest matching completed
   record's own `expiration_date` (mirroring `check_requirement_progress`'s
   own CERTIFICATION branch — latest matching completion, by completion
   date, then read that record's expiration), `None` when the member holds
   no matching certification.
2. **Rolling/certification anchor matching used a bare `training_type`
   check, over- and under-matching in opposite directions.** When
   `training_type` was unset (common for a course-specific requirement
   restricted by `required_courses` instead), the round-3 filter matched
   _any_ completed record of any type — Codex's example: an overdue
   course-specific requirement gets a future deadline anchored on an
   unrelated recent record. Swapping in `certification_record_matches`
   wholesale (the obvious fix, and Codex's own suggested reference) turned
   out to be wrong in the opposite direction for non-CERTIFICATION types:
   its OR-of-criteria semantics report _no_ match at all for a requirement
   that legitimately restricts nothing (e.g. "24 hours of any training
   every 24 months," a valid, common rolling HOURS configuration) — a
   round-1-draft regression caught only by this pass's own tests before
   it shipped. Fixed with a new `_anchor_matches()` static method that
   dispatches on requirement type and mirrors each type's own crediting
   filter exactly: `certification_record_matches` for CERTIFICATION;
   `required_courses` membership for COURSES; `training_type` AND
   `required_courses` (each optional) for HOURS; `training_type` only for
   SHIFTS/CALLS; `training_type` or name-substring for the
   skills/checklist fallback. Used by both `check_requirement_progress`
   (via a new shared `_anchor_records()`) and
   `evaluate_requirement_detail()`, replacing round 3's ad-hoc filters in
   both.
3. **The batch/preload path's window bound excludes the very completions
   an overdue anchor needs.** `get_requirements_progress_for` preloads
   `completed_records` once via `_preload_window`, bounded to the union of
   every requirement's own evaluation window — for an ordinary rolling
   requirement, that window is `today - rolling_period_months` to `today`.
   An _overdue_ rolling requirement's anchor is, by definition, older than
   that window, so the preload silently excluded it and the batch/API/MCP
   path reported `None` instead of a correctly negative
   `days_until_due` — while the same requirement, checked standalone
   (`completed_records=None`, an unbounded query), reported correctly.
   Fixed by extending `_preload_window`'s existing unbounded-window
   exemption (already applied to CERTIFICATION and BIANNUAL-hours, for the
   identical reason) to any requirement using a rolling or
   certification-period due date.

**Guard tests (round 4):** `test_training_compliance_integration.py::
TestCertificationCompliance::test_certification_period_due_date_is_the_certs_own_expiration`
and `::test_rolling_anchor_does_not_match_an_unrelated_record` (finding 2,
inserts a real FK-satisfying course + an unrelated newer record via raw SQL
to prove the anchor picks the right one) for `check_requirement_progress`;
`TestMultipleRequirements::test_rolling_due_date_survives_the_batch_preload_window`
(finding 3) for `get_all_requirements_progress`; and the
`test_training_compliance.py::TestEvaluateRequirementDetailFields` mirrors
of findings 1 and 2 for `evaluate_requirement_detail`. All five confirmed
failing against the round-3 code before this fix.

**Round 5 — Codex found two more gaps, both introduced by round 4 itself**,
this time on the new PR (#2220, opened after round 4 merged prematurely —
see `PROGRESS.md`'s Log):

1. **P1 (the more severe): the legacy BIANNUAL override in
   `evaluate_requirement_detail()` unconditionally overwrote round 4's
   correctly-anchored certification-period due date.** That block (added
   long before due_date_type awareness existed) selects the newest
   expiration across _any_ completed record passing a bare `training_type`
   check — not `_anchor_matches` — whenever `freq == BIANNUAL`, with no
   awareness that a certification-period (or rolling) anchor might already
   have computed the correct value earlier in the same function. Concrete
   scenario: an EMT certification due in 30 days, with an unrelated
   certification expiring next year also on file and no `training_type`
   set on the requirement (so the override's filter is a no-op) — the
   override picked the later, unrelated date, silently replacing the real
   deadline. Downstream, `generate_compliance_forecast`'s 90-day at-risk
   list would never surface the actually-overdue-soon EMT renewal. Fixed
   by skipping the legacy override whenever `rolling_months` or
   `due_date_type == "certification_period"` already computed
   `effective_due_date` via the new anchor logic — the override's original
   scope (a BIANNUAL requirement with no due-date-type awareness at all)
   is unaffected. `check_requirement_progress`'s own BIANNUAL handling was
   checked and does _not_ have this bug: it only reads the already-computed
   `effective_due_date` for its early-return's `due_date=` field rather
   than reassigning it.
2. **P2: `_anchor_records` (and `evaluate_requirement_detail`'s parallel
   in-memory filter) dropped every record with `completion_date is None`
   before a certification-period anchor could ever see it**, even though
   `TrainingRecord.completion_date` is nullable and every other
   certification-matching site in this file (four of them) deliberately
   still considers such a record via a `r.completion_date or date.min`
   sort-key fallback rather than excluding it. A completed certification
   with a known `expiration_date` but an unrecorded completion date (e.g.
   a grandfathered/imported record) was silently marked compliant while
   reporting `due_date=None`/`days_until_due=None`. Fixed by removing the
   `completion_date is not None` filter from `_anchor_records` (it now
   returns every record `_anchor_matches`, regardless of completion date)
   and having each caller apply the correct convention itself:
   `_rolling_due_date` still filters `None` internally — a rolling anchor
   genuinely cannot add an interval to an unknown date — while
   `_certification_due_date` and `evaluate_requirement_detail`'s own
   certification-period branch use `r.completion_date or date.min` as the
   sort key, matching the other four sites exactly.

**Guard tests (round 5):**
`test_training_compliance.py::TestEvaluateRequirementDetailFields::
test_biannual_certification_period_keeps_the_matched_certs_expiration`
(P1) and `::test_certification_period_anchor_includes_unknown_completion_date`
(P2) for `evaluate_requirement_detail`;
`test_training_compliance_integration.py::TestCertificationCompliance::
test_certification_period_anchor_includes_unknown_completion_date` (P2) for
`check_requirement_progress` — `check_requirement_progress` needed no P1
test since it doesn't have that bug (see above). All three confirmed
failing against the round-4 code before this fix, via `git stash` on just
`training_service.py`.

**Round 6 — Codex found two more gaps in round 5's own fixes**, on the
next PR (#2221, opened after round 5 merged prematurely — see
`PROGRESS.md`'s Log):

1. **A stale `due_date` left over from a prior `fixed_date` configuration
   defeated the rolling/certification-period anchor.** `RequirementModal.
tsx` seeds its `due_date` form field from the existing row and only
   edits or clears it on the `fixed_date` screen (confirmed by reading the
   component: line 77 seeds state, lines 181-183 submit `due_date`
   whenever it's still truthy alongside whatever `due_date_type` was
   actually selected). An officer switching an existing fixed-date
   requirement to Cert Period therefore leaves the old `due_date` in the
   payload. Every round since round 1 gave `req.due_date`/`requirement.
due_date` top priority unconditionally, so this stale value would
   silently defeat round 4's certification-period anchor (and round 3's
   rolling anchor, sharing the identical root cause though not raised by
   Codex against it directly) — the exact inverse failure mode of P1
   (round 5 fixed the BIANNUAL override clobbering a _correct_ anchor;
   this is a stale explicit date clobbering it instead). Fixed by only
   honoring the explicit `due_date` when the requirement's `due_date_type`
   is _not_ `rolling`/`certification_period` (an `anchored_type` flag in
   both functions) — `calendar_period` keeps its existing, deliberately
   tested precedent of an explicit-date override
   (`test_days_until_due_calculated`) unchanged, since Codex's finding and
   the frontend behavior it traced are specific to switching _out of_
   `fixed_date`, not that combination.
2. **A certification anchor could publish a due date for a record the
   compliance calculation itself rejects as unverifiable.** When a
   requirement sets `recency_days`, `is_recent_enough()` requires a known
   `completion_date` to check a record's freshness — a record with
   `completion_date is None` fails it and is excluded from the actual
   compliance result (`check_requirement_progress`'s own CERTIFICATION
   branch applies `apply_recency` for exactly this). Round 5's P2 fix,
   however, let `_anchor_records` admit that same record for the _due
   date_ calculation regardless, since it deliberately stopped filtering
   on `completion_date` at all. Result: `is_complete=False` (correctly
   unmet) alongside a future `due_date`/`days_until_due` computed from the
   very record the compliance check excluded — a contradiction on the
   same response object. `evaluate_requirement_detail()` needed no
   equivalent fix: its `completed` list already has `apply_recency`
   applied once, upstream of everything including the anchor block, so it
   never received an unverifiable record in the first place. Fixed by
   threading `today` into `_anchor_records` and filtering with the same
   `is_recent_enough()` predicate the compliance calculation uses —
   inert when `recency_days` is unset (matching the round-5 P2 fix's
   behavior for the common case), and correctly exclusionary only when a
   freshness window is actually configured.

**Guard tests (round 6):** `test_training_compliance.py::
TestEvaluateRequirementDetailFields::test_rolling_ignores_a_stale_fixed_due_date`
and `::test_certification_period_ignores_a_stale_fixed_due_date` (finding

1. for `evaluate_requirement_detail`;
   `test_training_compliance_integration.py::TestHoursRequirementCompliance::
test_rolling_ignores_a_stale_fixed_due_date`,
   `TestCertificationCompliance::test_certification_period_ignores_a_stale_fixed_due_date`
   (finding 1), and `::test_certification_period_anchor_excludes_unverifiable_completion_when_recency_required`
   (finding 2) for `check_requirement_progress`. All five confirmed failing
   against the round-5 code before this fix, via `git stash` on just
   `training_service.py`.

**Round 7 — Codex found round 6's own fix drew the line in the wrong
place**, pushed as a further commit onto the same still-open PR (#2222) —
no premature merge this time:

Round 6 excluded `rolling`/`certification_period` from honoring a stale
`due_date`, reasoning that `calendar_period` was unaffected because an
explicit override there was "an established, deliberate override" per
`test_days_until_due_calculated`. Codex pointed out that reasoning doesn't
hold: `RequirementModal.tsx`'s stale-value behavior (seeds `due_date` from
the existing row, only clears/edits it on the `fixed_date` screen) applies
identically when switching to `calendar_period` — there is no UI path that
lets an officer deliberately set both a period configuration _and_ an
override date at once, so a `calendar_period` row carrying a `due_date` is
just as likely to be the same stale leftover, not a real feature. The
existing test had been asserting the bug's shape as if it were a
requirement, and round 6 preserved it as a carve-out for exactly that
reason.

Fixed by replacing the round-6 `anchored_type` (rolling/certification_period)
exclusion with an inclusion list: an explicit `due_date` now wins only when
`due_date_type` is `None` (a legacy row from before the field existed) or
`fixed_date` — never `calendar_period`, `rolling`, or `certification_period`,
all three of which compute their own deadline. This required updating (not
just adding to) two round-1/2 tests in `test_training_compliance_integration.py`
(`test_days_until_due_is_populated`, `test_days_until_due_is_negative_when_overdue`)
that relied on the default `due_date_type="calendar_period"` while asserting
an explicit `due_date` wins — both now pass `due_date_type="fixed_date"`
explicitly, which is what they were actually testing all along. The unit-test
equivalents in `test_training_compliance.py` were unaffected: `_make_requirement`
defaults `due_date_type` to `None`, which the new rule still honors.

**Guard tests (round 7):**
`test_training_compliance.py::TestEvaluateRequirementDetailFields::
test_calendar_period_ignores_a_stale_fixed_due_date` for
`evaluate_requirement_detail`;
`test_training_compliance_integration.py::TestHoursRequirementCompliance::
test_calendar_period_ignores_a_stale_fixed_due_date` for
`check_requirement_progress`. Both confirmed failing against the round-6
code before this fix.

**Round 8 — Codex found rounds 6-7 only masked the symptom, not the root
cause**, pushed as a further commit onto the same still-open PR (#2222):

Rounds 6-7 made `check_requirement_progress`/`evaluate_requirement_detail`
ignore a stale `due_date` for every type but `fixed_date` — but the stale
value itself was still sitting in the database, unpersisted-corrected. Codex
found two other active paths read `requirement.due_date` directly, bypassing
both calculators entirely: the requirements dashboard widget
(`api/v1/endpoints/training.py:330`, rendered by
`frontend/.../widgets/training/index.tsx`) and the requirement detail page
(`frontend/src/pages/TrainingRequirementsPage.tsx`). An officer would see
the calculated (correct) due date on the progress screens and the raw
(stale) one on the dashboard and detail page simultaneously — the
calculators were never going to be a complete fix on their own, because the
bug is in what gets _written_, not just what gets _read_.

Fixed at the actual root: `create_requirement`/`update_requirement`
(`api/v1/endpoints/training.py`) now null out `due_date` whenever the
resulting `due_date_type` isn't `fixed_date` (or unset, for a legacy row) —
regardless of what the client sent, so `RequirementModal.tsx`'s stale-value
behavior can never reach the database in the first place, and every reader
(the two calculators, the two raw-read paths Codex found, any future one)
sees a consistent, correct value with no further per-site patching needed.
`update_requirement` normalizes even when the update payload doesn't
mention `due_date_type` or `due_date` at all, cleaning up a row that
already carries a stale value from before this fix existed the next time
it's touched. The calculators' rounds 6-7 defensive logic is left in place
as harmless, correct defense-in-depth for any row not yet touched since.

**Guard tests (round 8):** new file
`test_training_requirement_due_date_write_normalization.py` — four
`update_requirement` cases (switching away from `fixed_date` to `rolling`
or `calendar_period` clears a stale `due_date`; a genuine `fixed_date`
update keeps its own `due_date`; touching an already-stale row with an
unrelated field change cleans it up) and one `create_requirement` case
(a non-`fixed_date` create ignores a client-sent `due_date`). Four of the
five confirmed failing without the endpoint fix (the "genuine fixed_date
update" case correctly still passed, since it's unaffected).

**Round 9 — Codex found round 8's write-path fix doesn't reach a row
nobody edits**, pushed as a further commit onto the same still-open PR
(#2222):

Round 8's normalization runs on `create`/`update`, which stops _new_
staleness but does nothing for a `calendar_period`/`rolling`/
`certification_period` row that already carries a stale `due_date` and is
never edited again. Until an officer happens to touch it, the same two raw
reads (the dashboard widget, the requirement detail page) keep showing the
pre-fix value — exactly the CLAUDE.md pitfall #20 pattern applied to a
plain column instead of a JSON one: _a write-path fix alone never reaches
a row nobody revisits; it needs a migration to settle the rows already
there._

Fixed with `20260904_0530_bbdaca0844df_backfill_stale_due_date_non_fixed.py`:
a single `UPDATE training_requirements SET due_date = NULL WHERE due_date
IS NOT NULL AND due_date_type IN (...)` for the three non-`fixed_date`
types, guarded on the table's existence (per CLAUDE.md pitfall #26 — even
though `training_requirements` is migration-created, not `create_all`-only,
matching the same defensive check the precedent migration
(`20260903_1300_e3a9c1d5b7f2`, the `email_service` settle) uses).
`downgrade()` is deliberately a no-op: the cleared values were never valid
for these three types (there's no UI path to set both a period/anchor
config and a deliberate override date at once), so there's nothing correct
to restore.

**Guard tests (round 9):** new file
`test_backfill_stale_training_due_date_migration.py` — a real-database
integration test (`db_session`, not a mocked bind) proving the actual
UPDATE statement, including its expanding `IN`-list bindparam, clears
`calendar_period`/`rolling`/`certification_period` rows while leaving
`fixed_date` and legacy (`due_date_type IS NULL`) rows untouched; plus the
standard mocked-bind unit test for the table-missing guard, in the manner
of the `email_service` migration's own test.

### TR3-2 — LOW (abuse resistance) — `get_member_requirements_progress`'s pagination bounds the response, not the scan behind it — 🚩 FLAGGED

**Reported by Codex on this PR; confirmed.** See the "Scope addition"
correction above for the mechanism. `limit`/`offset` on the MCP tool
genuinely bound the number of `RequirementProgress` rows returned, but not
the work done to produce them: `get_applicable_requirements` has no page
bound of its own (mitigated by requirements being naturally few per org),
and a page containing a CERTIFICATION or BIANNUAL-hours requirement causes
`_preload_window` to return `None`, preloading the member's entire
completed-training history rather than a bounded slice.

**Not fixed.** Both characteristics are pre-existing in `TrainingService`
(the certification case is deliberate — a cert doesn't expire per period,
so its check has always looked at everything), newly reachable only because
this pass swept `app/mcp/tools/training.py` into scope for the first time.
Bounding the certification case without changing its correctness needs a
service-level redesign of `training_compliance.py`'s date-window logic —
the same class of fix TR2-4 already flagged for `get_training_dashboard_
summary`, and not a safe drive-by alongside this pass's other work.
Mirrored into `docs/KNOWN_LIMITATIONS.md`.

**Impact:** LOW. Per-member, not org-wide — the ceiling on a single call's
work is one member's own training history, not the whole department's, and
every caller is an authenticated MCP principal.

**No regression in any pass-1/pass-2 fix.** Rotation row 17 → see
`PROGRESS.md`.

## Completion gate (pass 3)

| Check                                             | Result                                            |
| ------------------------------------------------- | ------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                     | 0 violations                                      |
| `black --check app/ tests/ alembic/`              | clean                                             |
| `isort --check-only app/ tests/ alembic/`         | clean                                             |
| `python3 scripts/validate_migrations.py --strict` | single head, 414 revisions (no schema change)     |
| `pytest tests/ -k "training"`                     | 844 passed, 1 skipped (pre-existing)              |
| `pytest tests/` (full backend suite)              | 10556 passed, 21 skipped (pre-existing), 0 failed |
| `tsc --noEmit`                                    | 0 errors                                          |
| `eslint .`                                        | 0 errors                                          |

---

---

## Scope

This is the training module's first pass through the security-review
rotation, and the largest feature reviewed so far. Module-audit iteration 18
covered the whole training module (8 endpoint files, ~8,100 L, 154 endpoints)
at a mix of full-read and invariant-level depth, followed by 4 app-review
Tier B passes (2026-08-06 through 2026-08-09). The rotation splits that one
module-audit unit into two security-review passes — **this iteration is
"training core"**: `training.py`, `training_programs.py`,
`training_sessions.py`, and their three backing services. `training_
submissions.py`, `training_enhancements.py`, `training_waivers.py`,
`external_training.py`, and the never-yet-audited `course_cohorts.py`/
`course_syllabus.py` are feature 18, "training extended," out of scope here.

**Read in full, not sampled:** all six files listed above. Split across
three parallel reads given the combined size (~11,000 L): `training.py` +
`training_service.py` + `training_compliance.py`; `training_programs.py` +
`training_program_service.py` (the latter grew 36% since the module audit —
treated as largely a first thorough read, since the audit's own caveat says
this file was reviewed "for invariants, not line-by-line" at the smaller
size); `training_sessions.py` + `training_session_service.py`.

## Route inventory

- **`training.py`**: 36/36 routes authenticated. No `.view`-gating-a-write
  found. Per-member PHI routes (`/stats/user/{id}`, `/compliance-summary/{id}`,
  `/reports/user/{id}`, `/requirements/progress/{id}`, `/category-hours/{id}`)
  all still gate via `_require_self_or_training_officer`; `GET /records`
  still self-scopes non-officers to `user_id == current_user.id`.
- **`training_programs.py`**: every route authenticated; every mutating
  route requires `training.manage` except two deliberately member-scoped
  paths (`PATCH /progress/{id}`, `POST /enrollments/{id}/withdraw`), both
  `get_current_user`-gated with ownership/officer checks pushed into the
  service (`acting_user_id` + `can_manage`) — correct design, not a
  permission-inversion.
- **`training_sessions.py`**: 9/9 routes authenticated. Two are deliberately
  `get_current_user`-only, read-only, and documented as such
  (`GET /by-event/{event_id}`, `GET /calendar`); every mutating route
  requires `events.manage` or the narrower `events.reopen_attendance` (split
  from `events.manage` so the person who finalized can't unilaterally
  reopen — mirrors the same split in the events module); `GET
/approve/{token}` requires `training.manage` (attendee PII in the
  response).

No unauthenticated route found in any of the three files.

## Verified good ✅

- **TR-1, TR-2, TR-7 (write + read side), TR-9/TR-10, TR-4 all re-verified
  still hold** in `training.py`/`training_service.py`. TR-3/TR-6/TR-8 live
  in files outside this iteration's scope (`external_training.py`,
  `training_enhancement_service.py`) and were not re-chased.
- **Programs-service tenant isolation re-verified "XC-3 clean"** at the
  36%-larger size: every by-id program/phase/milestone/requirement-link/
  enrollment/progress operation traces to an org-scoped fetch, including the
  progress row lock (`with_for_update(of=RequirementProgress)`).
  `enroll_member` still validates both the program and the target user's org
  membership before enrolling.
- **The idempotent credit ledger is intact.** `apply_requirement_credit`/
  `revoke_requirement_credit` route through `RequirementProgressCredit`,
  guarded by a real unique constraint (`uq_progress_credit_source` on
  `(progress_id, source_type, source_id)`) with an `IntegrityError` fallback
  as the concurrency backstop — the claimed "no double-credit on re-sync/
  re-approve" mechanism, confirmed under the larger file.
- **The training-sessions "dangling FK batch" is resolved, not just still
  dangling — the carried-forward flag is stale.** The module-audit and
  app-review docs list `category_id`/`program_id`/`phase_id`/
  `requirement_id`/`instructor_id` on session-create as unvalidated,
  batched for "a future FK-hardening pass," on the premise that none is
  projected back so there's no live leak. Re-verified in the current code:
  all five are now validated in-org via `TrainingSessionService.
_validate_linkage_ids` (an `is_in_org` call per field), called from
  `create_training_session`, `create_recurring_training_session`, and
  `update_session_linkage`. They are echoed back in
  `TrainingSessionResponse` as bare UUIDs, but grepped app-wide for any
  join/enrichment that would resolve them to a name across orgs — none
  exists, so the "not a leak" half of the premise also still holds. Two
  adjacent items in the same batch, in the same generation call chain, are
  also already fixed: `course_cohort_service.py`'s ad-hoc class creation
  validates `instructor_id`/`location_id`/`category_id`/`requirement_id`/
  `phase_id` in-org, and `event_service.create_recurring_event` validates
  `location_id`/`template_id`. Recommend closing this batch item in
  `docs/module-audit/training.md` and `docs/app-review/training.md` rather
  than carrying it forward again.
- **The multi-table generation transaction** (Events, TrainingSessions,
  EventRSVPs, ProgramEnrollments — actually implemented in
  `course_cohort_service.py`'s `create_cohort`, called from the session-core
  scope via `TrainingSessionService.create_training_session(commit=False)`)
  threads one `organization_id` through every write with no per-table
  re-derivation — no cross-table org-mismatch path found, closing the
  module-audit's own coverage-note concern about this exact transaction's
  "wide blast radius for an org-scoping miss."
- **`EventRSVP` overrides in the training-approval flow are backstopped,
  not a live gap.** `_finalize_training_records`/`submit_training_approval`
  look up an RSVP by `event_id` (org-trusted) **and** client-supplied
  `attendee.user_id` with no explicit `organization_id` filter on that
  query. Traced why this doesn't matter: an RSVP row for a given event can
  only exist for a user already validated in-org at RSVP-creation time
  (self-service RSVP forces `user_id=current_user.id`; manager-added
  attendees are org-validated) — so no cross-org RSVP row could ever exist
  for this query to match, regardless of the `user_id` a caller supplies.
  Verified good, not fixed (nothing to fix).
- **Recurring/generation caps still bounded**: session recurrence delegates
  to `EventService.create_recurring_event`'s 365-occurrence cap; the
  separate cohort-syllabus generation path has its own 200-class cap
  (`MAX_GENERATED_CLASSES`). No unbounded generation path found.
- **RSVP capacity locking** (used by session sign-up via `Event`/`EventRSVP`)
  confirmed correct at both halves of Pitfall #27 in `event_service.py` —
  re-verified as part of the events review two iterations ago, unchanged
  here.
- **No SQL injection / no LIKE surface** in any of the six files — zero
  `.like()`/`.ilike()` calls.
- **JSON-column mutation discipline holds** — every JSON-column write
  found (`progress_notes`, checklist state, custom fields) uses
  `copy.deepcopy` + reassignment; no in-place mutation without reassignment.
- **Update payloads correctly distinguish omitted from explicit-null** —
  every update method checked uses `model_dump(exclude_unset=True)`.
- **`/training/expiring-certifications`'s member-name enrichment lookup**
  now filters `organization_id` too. `user_ids` are drawn from
  `TrainingRecord` rows already filtered to this org, so this wasn't
  independently exploitable — added for consistency with every other
  enrichment query in the module rather than to close a live gap.
- **`TrainingProgramUpdate.target_roles`** (a `List[UUID]`) is stored
  without org validation, inconsistent with the `assert_all_in_org`
  convention elsewhere in the file — but the code explicitly documents
  `target_position`/`target_roles` as advisory-only, non-gating display
  data, not a security boundary. Verified the claim (nothing reads these
  fields to make an authorization decision); not a finding.

## Findings

### TR-11 — MEDIUM (XC-1) — Program JSON import stored a client-supplied `category_ids` array unvalidated — ✅ FIXED

**What:** `POST /training/programs/import` ingests an arbitrary
user-uploaded JSON body with no Pydantic schema (`payload: dict`).
`_resolve_or_create_requirement`, which the import walks for every
requirement it needs to create, wrote `req_data.get("category_ids")`
straight onto a new `TrainingRequirement` with no in-org check — unlike
every other requirement-creation path in this same file
(`create_training_requirement`, `update_training_requirement`,
`build_program`, `import_registry_requirements`), all of which validate
`category_ids`/`required_courses`/linked-requirement ids via
`assert_all_in_org` before storing. `app/utils/org_scoping.py`'s own
docstring names `category_ids` as the canonical example of the class this
helper exists to close.

**Where:** `app/services/training_program_service.py` —
`_resolve_or_create_requirement` (was line 5150), called from
`import_program_from_json` (called by `POST /programs/import`,
`training.manage`).

**Failure scenario:** a `training.manage` user crafts (or is handed) an
import file whose requirement carries another organization's
`TrainingCategory` id. The requirement is created with that foreign id in
its `category_ids` array — a persisted, dangling cross-tenant reference
that `training_compliance.py`'s evaluator later matches training records
against.

**Impact:** MEDIUM — matches the severity class of TR-6/TR-7 (the same
unvalidated-category-FK shape, already fixed on every other write path in
this module), though this specific route requires deliberate insider action
by an authenticated `training.manage` user of the caller's own org, not an
externally reachable exploit.

**Fix:** `_resolve_or_create_requirement` now validates `category_ids` via
`assert_all_in_org(..., TrainingCategory, ...)` before constructing the new
`TrainingRequirement`, mirroring `_validate_required_courses`'s pattern
exactly. Also fixed an adjacent latent-500: `POST /programs/import` had no
`except ValueError` handler at all, so this new check's rejection (and the
pre-existing `structure_type` enum-validation `ValueError` two lines above
it, which had the identical gap) would have propagated as an unhandled 500
rather than a clean 400 — added the standard wrapper. Guard tests:
`test_training_program_import_scoping.py` (3 tests: rejects a foreign
category, accepts an in-org one, skips validation when none supplied).

### TR-12 — LOW/MEDIUM (XC-3) — Two `User` lookups in `training_service.py` were not org-scoped — ✅ FIXED

**What:** `get_all_requirements_progress` and `generate_training_report`'s
tier-exemption block both fetched a `User` row by `user_id` alone
(`select(User).where(User.id == str(user_id))`), unlike the equivalent
lookup in `get_compliance_summary` in the same module, which already filters
`organization_id`. Both are reachable from routes gated
`_require_self_or_training_officer` (`/requirements/progress/{user_id}`,
`/reports/user/{user_id}`) — that helper checks self-id-match-or-
`training.manage`, not org membership, so a `training.manage` officer in
one org could pass a foreign org's `user_id`.

**Where:** `app/services/training_service.py` — `get_all_requirements_progress`
(was line 944) and `generate_training_report`'s tier-exemption block (was
line 195).

**Failure scenario:** a training officer in Org A calls
`GET /training/requirements/progress/{foreign_user_id}` (or
`/reports/user/{foreign_user_id}`) with a user id from Org B. Before the
fix: the `User` row is fetched cross-org (an existence oracle — a
differing response shape between "found, foreign" and "not found" — though
the downstream `TrainingRecord`/`TrainingRequirement` queries were already
correctly org-scoped, so no foreign completions/certifications were
returned), and in `generate_training_report`, the foreign user's
`membership_type` is mixed into the _caller's org's_ tier-exemption
resolution — an org-isolation violation in the compliance logic itself,
even though tier ids are org-specific strings unlikely to collide in
practice.

**Impact:** LOW/MEDIUM — no PHI/record disclosure (downstream queries were
already correctly scoped), but a real cross-org existence oracle and a
genuine org-boundary violation in the tier-exemption computation.

**Fix:** both lookups now add `organization_id == str(organization_id)` to
their `where()`, matching every other `User` lookup in this module. Guard
tests: `test_training_service_user_scoping.py` (behavioral test for
`get_all_requirements_progress`, asserting `stmt.whereclause` — not the
whole compiled statement, which always projects `organization_id` for a
bare `select(User)` regardless of filtering, the exact hollow-assertion
trap CLAUDE.md's pitfall doc warns about; source-inspection test for
`generate_training_report`, since behaviorally mocking the full report
method is fragile and obscures the one invariant being guarded).

### TR-13 — LOW/MEDIUM (XC-1) — `course_id` was never org-validated on any of its three write paths — ✅ FIXED

**What:** unlike `user_id` (TR-2) and `category_id` (TR-7) on the same
endpoints, a client-supplied `course_id` was stored unchecked on
`POST /training/records` (`create_record`), `POST /training/records/bulk`
(`create_records_bulk`), and `POST /training/import/confirm`
(`confirm_historical_import`, both the already-"matched" `course_id` a row
carries and a `map_existing` mapping's `existing_course_id` — both
client-supplied on the confirm request itself, since the whole `rows`/
`course_mappings` payload round-trips through the client between parse and
confirm, so a server-computed match at parse time is not trustworthy by
the time confirm receives it back).

**Where:** `app/api/v1/endpoints/training.py` — `create_record` (was line
601), `create_records_bulk` (was line 848), `confirm_historical_import`
(was lines 2363/2374).

**Failure scenario:** `create_record`/`create_records_bulk` already ran an
org-scoped course lookup, but only to auto-calculate `expiration_date` —
if the course wasn't found in-org, the calc was silently skipped rather
than the request rejected, and the raw `course_id` was still stored.
`confirm_historical_import` had no course lookup on the `map_existing`
path at all. In all three cases the resulting `TrainingRecord.course_id`
is a dangling reference to another org's course.

**Impact:** LOW/MEDIUM — no current read-leak (`TrainingRecordResponse`
only returns the raw `course_id` UUID, never a joined course name/code the
way the actual TR-7 leak worked), but the identical missing-validation
shape as TR-2/TR-7 on the exact same functions, and any future consumer
that joins on `course_id` without its own org filter would reopen a
TR-7-class leak.

**Fix:** all three paths now validate `course_id` in-org before storing —
`create_record`/`create_records_bulk` reject with a clean error (404 /
per-row error, respectively) instead of silently skipping the auto-calc;
`confirm_historical_import` batches a single org-scoped `IN` query across
every candidate `course_id` in the request (both `matched_course_id` and
`map_existing` mappings) before the row loop, rather than one query per
row, and rejects any row whose resolved `course_id` isn't in that set
(server-generated ids from the `create_new` action are exempt — they're
always in-org since they were just created for this request). Guard tests:
`test_training_records_course_scoping.py` (3 tests, one per write path).

## Corrections to prior write-ups

- **`docs/module-audit/training.md` / `docs/app-review/training.md`**: the
  session-create "dangling FK batch" (category/program/phase/requirement/
  instructor) is resolved (see Verified good above) — recommend updating
  both docs to close this item rather than carrying it into a future
  FK-hardening pass, since the fix (`_validate_linkage_ids`) is already in
  place and confirmed by this iteration.

## Flagged, not fixed

- **Enum validation gap in bulk/historical-import paths.**
  `BulkTrainingRecordEntry.training_type`/`.status` and
  `HistoricalImportConfirmRequest.default_status`/`.default_training_type`
  and `CourseMappingEntry.new_training_type` have no `@field_validator`,
  unlike the single-record `TrainingRecordCreate`/`Update` (the TR-2-era
  fix). Both are DB-level `Enum` columns, so a bad value still reaches the
  DB layer rather than 422ing at the Pydantic boundary — but both bulk
  paths wrap each row's insert in its own try/except (`create_records_bulk`:
  `db.flush()` per row; `confirm_historical_import`: `db.begin_nested()`
  per row), so a bad value fails only that one row with a sanitized message,
  not the whole request. Not fixed here: adding request-level `@field_
validator`s to a `List[...]` field changes the failure mode from
  per-row-partial-success to whole-request-rejection (Pydantic validates
  before the endpoint runs at all) — a behavior change needing a product
  call on whether that's the right trade-off for a bulk-import UX, not a
  drive-by fix. Mirrored into `docs/KNOWN_LIMITATIONS.md`.
- **`enroll_member`'s duplicate-active-enrollment guard is a race.**
  `training_program_service.py`'s `enroll_member` does a plain SELECT
  (check for an existing ACTIVE enrollment) then INSERT, with no unique
  constraint or row lock backing it — two concurrent enroll calls for the
  same (user, program) could both pass the check and create two ACTIVE
  enrollments. Data-integrity, not tenant-isolation or an abuse vector;
  closing it properly needs a DB migration (a partial unique index on
  `(user_id, program_id)` where `status = 'active'`, or equivalent), which
  Step 4 of this rotation's own process reserves for a flagged item rather
  than a drive-by fix. Mirrored into `docs/KNOWN_LIMITATIONS.md`.

## Schema & migration notes

No schema changes this iteration. No `SET NULL` nullability issues found.

## Guard tests added

- `test_training_program_import_scoping.py` — 3 tests (TR-11).
- `test_training_service_user_scoping.py` — 3 tests (TR-12, plus the
  `/expiring-certifications` defense-in-depth enrichment scoping).
- `test_training_records_course_scoping.py` — 3 tests (TR-13).

## Completion gate (pass 1)

| Check                                                     | Result                                                           |
| --------------------------------------------------------- | ---------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/` (changed files)             | ✅ 0 violations                                                  |
| `black --check app/ tests/ alembic/` (changed files)      | ✅ clean                                                         |
| `isort --check-only app/ tests/ alembic/` (changed files) | ✅ clean                                                         |
| `python3 scripts/validate_migrations.py --strict`         | ✅ single head                                                   |
| `pytest tests/ -k "training"`                             | ✅ 792 passed, 1 skipped (pre-existing optional-dependency skip) |
| `pytest tests/` (full backend suite)                      | ✅ 8663 passed, 22 skipped (pre-existing Docker/no-MySQL skips)  |
| `tsc --noEmit` / `eslint .`                               | n/a — no frontend file changed this iteration                    |

---

## Pass 2 (2026-08-29)

**Prefix:** `TR2` · **PR:** [#1981](https://github.com/thegspiro/the-logbook/pull/1981)

**Scope check:** compared the current tree against `a9b232db` (the pass-1
merge commit for PR #1851) across all six pass-1 files. Five are byte-for-byte
unchanged; `training_program_service.py` gained exactly one unrelated
7-line change — an org-scope fix to `bulk_enroll_members`'s batch `User`
lookup for prerequisite-failure error strings, landed by the **feature 18**
("training extended") pass as part of **TRX-1** (`docs/security-review/
TRX-18-training-extended.md`), not by this feature. No file grew meaningfully
in this feature's own scope, so this pass is re-verification plus a fresh
sweep of checklist dimensions pass 1 covered more lightly (data exposure,
abuse resistance), not a first-read of grown files.

### Re-verification of pass-1 fixes and claims

- **TR-11, TR-12, TR-13 — all three confirmed present and unchanged** in the
  current code: `_resolve_or_create_requirement`'s `assert_all_in_org` call
  (`training_program_service.py:5141`), the `organization_id` filters on both
  `User` lookups in `training_service.py` (`get_all_requirements_progress`
  line 951, `generate_training_report`'s tier-exemption block line 198), and
  the `course_id` org-validation on all three write paths in `training.py`
  (lines 599, 847, 2403 — comments mark the checks) all read exactly as pass 1
  left them.
- **Route auth coverage re-enumerated independently** (AST walk, not a
  re-read of pass 1's prose): 36 routes in `training.py`, 46 in
  `training_programs.py` (pass 1 didn't give an exact count for this file),
  9 in `training_sessions.py` — 91 total, every one carrying `Depends(get_db)`
  plus either `get_current_user` or `require_permission(...)`. No route
  without an auth dependency. The five self-scoped PHI routes
  (`/stats/user/{id}`, `/compliance-summary/{id}`, `/reports/user/{id}`,
  `/requirements/progress/{id}`, `/category-hours/{id}`) all still call
  `_require_self_or_training_officer` in the handler body (5 call sites
  grepped, matching the 5 routes).
- **Baseline-grant check (Pitfall #23):** `DEFAULT_POSITIONS["member"]`
  carries `TRAINING_VIEW` only — `training.manage`/`training.view_all` are
  not seeded to the baseline position. No broadly-seeded grant opens a write
  route.
- **KNOWN_LIMITATIONS.md mirrors re-checked:** both pass-1 flagged items
  (bulk/historical-import enum validation gap; `enroll_member`'s
  duplicate-active-enrollment race) are present and still accurately
  describe the current code — neither has been fixed or has regressed
  further.
- **CSV surface re-checked:** `training.py`'s only `csv` usage is
  `csv.DictReader` (import parsing, two sites) — no `csv.writer`/
  `SafeCsvWriter` concern in this feature's scope; `export_program` emits
  JSON, not CSV.
- **`# noqa: E712`/`E711` sites re-examined, not a finding:** 12 sites across
  `training.py`/`training_sessions.py` plus 2 in `training_program_service.py`
  still carry these suppressions (the app-review pass-3 sweep only touched
  _services_, not these). Checked `backend/.flake8`: `E712`/`E711` are
  globally ignored project-wide ("required by SQLAlchemy filters"), so these
  `# noqa` comments are inert, not a live suppression of a real flake8
  finding — not the CLAUDE.md Pitfall #10 violation it first looked like.

### Findings (pass 2)

#### TR2-1 — LOW/MED (data exposure) — Two per-member training endpoints missing from `UNCACHEABLE_PREFIXES` — ✅ FIXED

**What:** `GET /training/competency-matrix` and `GET /training/dashboard-summary`
both return per-member `member_name` fields alongside compliance/competency
status — the identical shape to `/training/compliance-matrix`, which the
frontend cache already excludes — but neither was in
`frontend/src/utils/apiCache.ts`'s `UNCACHEABLE_PREFIXES` list. Both are
`training.manage`-gated GETs, so an officer's browser could hold another
member's name + compliance/competency status in its 90-second stale-cache
window past the point a permission change or record update should have
invalidated it — a smaller version of the same data-exposure class
`UNCACHEABLE_PREFIXES` exists to close for every other named PII response in
the module (`/training/compliance-matrix`, `/training/certifications/expiring`,
etc.).

**Where:** `frontend/src/utils/apiCache.ts` — `UNCACHEABLE_PREFIXES` array
(both endpoints backed by `app/api/v1/endpoints/training.py`'s
`get_competency_matrix`, which delegates to `CompetencyMatrixService.
get_competency_matrix` — see its docstring's `members: [{"name": ...}]`
shape — and `get_training_dashboard_summary`, whose own docstring states
"Member names are only returned from this `training.manage` endpoint").

**Failure scenario:** a training officer opens the (currently backend-only,
not yet wired to any frontend page — confirmed via `grep -rn
"competency-matrix" frontend/src`) competency heat map, or the training
dashboard's at-risk widget. The response — including every listed member's
name — sits in the in-memory cache for up to 90 seconds. A second read within
that window (including one issued after the officer's `training.manage`
grant was revoked, if the revocation itself doesn't force a page reload)
serves the stale cached payload rather than a fresh, permission-rechecked
one — the exact risk the HIPAA Section 164.312 comment atop the constant
exists to prevent.

**Impact:** LOW/MED. Same-org only (not cross-tenant), requires
`training.manage` to reach either endpoint in the first place, and
`competency-matrix` has no current frontend caller — but `dashboard-summary`
does (`trainingServices.ts`), and the pattern is identical to entries already
judged worth excluding elsewhere in the same file.

**Fix:** added both paths to `UNCACHEABLE_PREFIXES`, matching the existing
`/training/compliance-matrix` entry's comment style. Guard test: a new
`it()` in `apiCache.test.ts` (`'returns false for the org-wide per-member
training heat maps and dashboard'`) asserting `isCacheable(...)` is `false`
for `/training/competency-matrix`, `/training/compliance-matrix` (existing
behavior, pinned), and `/training/dashboard-summary`.

#### TR2-2 — LOW (abuse resistance) — `GET /training/records` has no pagination — 🚩 FLAGGED

See `docs/KNOWN_LIMITATIONS.md` → "Training — `GET /training/records` Has No
Pagination". `list_records` (`training.py`) returns every matching
`TrainingRecord` row for the org with no `skip`/`limit`, unlike the rest of
the codebase's per-record list endpoints (`events.py`'s `list_events` takes
`skip`/`limit` with a hard cap of 500). The query is correctly org- and
self-scoped (no isolation defect), so this is an abuse-resistance /
resource-bounding gap, not a data leak: a `training.manage` officer (or a
long-tenured member reading their own history) can trigger a single
unbounded read that only grows across a department's lifetime.

**Not fixed:** `trainingServices.ts`'s `listRecords()` returns a bare array
consumed by `MyTrainingPage` and admin record tables as the complete set,
with no pagination UI. A backend-only cap would silently truncate a large
org's data rather than degrade gracefully — needs a paired frontend change,
which is a product/UX decision outside this pass's fix criteria.

#### TR2-3 — LOW/MED (data exposure) — Training-session approval roster missing from `UNCACHEABLE_PREFIXES` — ✅ FIXED

**What:** caught by Codex's review of this PR, in the same data-exposure sweep
TR2-1 covers. `GET /training/sessions/approve/{token}` (`training_sessions.py`)
returns a `TrainingApprovalResponse` whose `attendees` array carries
`AttendeeApprovalData.user_name`/`.user_email` per attendee — the same
member-PII shape as TR2-1's two endpoints — but no `/training/sessions/`
prefix was in `UNCACHEABLE_PREFIXES`, so `trainingService.getApprovalData()`
served it through the same cached global axios client.

**Where:** `frontend/src/utils/apiCache.ts` — `UNCACHEABLE_PREFIXES` array
(endpoint: `app/api/v1/endpoints/training_sessions.py`'s
`@router.get("/approve/{token}")`, schema:
`app/schemas/training_session.py`'s `TrainingApprovalResponse`/
`AttendeeApprovalData`).

**Failure scenario:** identical to TR2-1 — an officer opens an approval link,
the attendee roster (names + emails) sits in the in-memory cache for up to 90
seconds, including past a point where the underlying session/approval state
changed.

**Impact:** LOW/MED — same-org only, requires holding a valid approval token
to reach the endpoint at all, but the same PII-in-cache class as TR2-1.

**Fix:** added `/training/sessions/approve/` to `UNCACHEABLE_PREFIXES`. Guard
test: `apiCache.test.ts` → `'returns false for the training-session approval
roster'`.

#### TR2-4 — LOW (abuse resistance) — `get_training_dashboard_summary` is an unbounded per-request scan, now uncached — 🚩 FLAGGED

Also raised by Codex, against the TR2-1 fix itself. `get_training_dashboard_summary`
(`training.py`) loads every active `User` in the org, every active
`TrainingRequirement`, and every `TrainingRecord` belonging to those users
with no date bound or row limit, then evaluates each member's applicable
requirements in Python. Before TR2-1, the response's 30s-fresh/90s-stale
cache window absorbed repeated dashboard mounts within that window; TR2-1
correctly removes that cache (the response carries per-member names, so
caching it is the HIPAA-shaped problem TR2-1/TR2-3 close), which means every
mount or manual refresh now re-runs this unbounded scan against the live
database.

See `docs/KNOWN_LIMITATIONS.md` → "Training — Dashboard Summary Is an
Unbounded Per-Request Scan". Not fixed here: the query needs a
date-window-aware bound (e.g. limiting `TrainingRecord` rows to what each
requirement's own lookback/recertification window actually needs, matching
`training_compliance.py`'s `get_requirement_date_window` logic) or a move to
set-based/aggregate evaluation instead of loading every row into Python —
either is a service-level query redesign entangled with the correctness of
`evaluate_member_requirement`'s per-requirement date logic, not a safe
drive-by change alongside a cache-exclusion security fix. Mirrors the same
abuse-resistance class as TR2-2 (unbounded per-request read that grows with
department history), and the fix removing this endpoint's cache-based
mitigation makes it more pressing than TR2-2, not less.

### Verified good ✅ (pass 2, not previously stated this way)

- **`list_courses`/`list_categories`/`list_requirements`/`get_training_programs`
  are not part of the TR2-2 abuse-resistance gap.** These list configuration
  data (courses, categories, requirements, programs) that is naturally
  bounded by department size (tens, not tens-of-thousands, of rows) — the
  absence of pagination on these is not equivalent to the `TrainingRecord`
  case, which grows per-member per-training-event indefinitely.
- **`create_records_bulk` is already abuse-bounded** — `BulkTrainingRecordCreate.
records` is `Field(..., min_length=1, max_length=500)` in `schemas/
training.py`, so the one write path that could otherwise fan out an
  unbounded insert is capped.

## Completion gate (pass 2)

| Check                                                      | Result                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| `flake8 app/ tests/ alembic/`                              | ✅ 0 violations (no Python files changed this pass)                      |
| `black --check app/ tests/ alembic/`                       | ✅ 1326 files unchanged                                                  |
| `isort --check-only app/ tests/ alembic/`                  | ✅ clean (`isort==8.0.1`, CI's pin, installed for this run)              |
| `python3 scripts/validate_migrations.py --strict`          | ✅ 389 revisions, single head `e5f6a7b8c9d0`                             |
| `pytest tests/ -q -k "training"`                           | ✅ 821 passed, 1 skipped (pre-existing optional-dependency skip)         |
| `pytest tests/ -q` (full backend suite)                    | ✅ 9200 passed, 22 skipped (pre-existing Docker/no-MySQL/optional skips) |
| `cd frontend && npx tsc --noEmit`                          | ✅ 0 errors                                                              |
| `cd frontend && npx eslint .`                              | ✅ 0 errors, 10 pre-existing warnings (none in touched files)            |
| `cd frontend && npx vitest run src/utils/apiCache.test.ts` | ✅ 85 passed (4 new assertions total: TR2-1 + TR2-3)                     |

---

## Pass 4 (2026-09-10) — 1 fix (3 rounds), 3 flagged; re-verification + review of the compliance-matrix redesign

> **Correction (Codex review of PR #2455).** This section's first draft
> claimed "0 fixes, 0 new flags" and described the matrix and the dashboard
> percentage as sharing "one definition" with no remaining drift. Both
> claims were wrong. Codex found a genuine, still-live cross-screen
> disagreement the draft's own review missed, plus a second, distinct
> abuse-resistance gap in the same endpoint TR2-4 does not cover. The
> section below is the corrected one; see TR4-1/TR4-2/TR4-3 for the three
> findings this correction adds.

**Scope check:** diffed the seven declared files against `0d1f92c41` (the
pass-3/round-6 merge, PR #2222). Five are byte-for-byte unchanged:
`training_programs.py`, `training_sessions.py`, `training_service.py`,
`training_program_service.py`, `training_session_service.py`. Two changed:
`training.py` (+187/-11, confined to `get_compliance_matrix` and its response
models) and `training_compliance.py` (+207/-49). Both changes are one
feature — "Redesign the compliance matrix as a triage queue" and its two
Codex-review follow-ups (not a security-review PR; a regular feature branch,
merged 2026-09-05/06) — not organic growth across the rest of the file.
Also checked: `models/training.py`'s only diff since pass 3 is Scheduling's
shift-signup change (unrelated, same pattern pass 3 already noted for this
file); the training-configure migration's only diff is a comment correcting
a stale Pitfall #26 claim, no behavior change; `app/mcp/tools/training.py`
and every other call site instantiating `TrainingService`/
`TrainingProgramService`/`TrainingSessionService` app-wide — no new file
found, no scope addition needed this pass.

**Re-verification of pass 1-3 fixes:** TR-11, TR-12, TR-13 all confirmed
present at their pass-2-cited line numbers, unaffected by this pass's diff
(both changed files touch only `get_compliance_matrix`/its evaluator helper;
`create_record`, `create_records_bulk`, `confirm_historical_import`,
`get_all_requirements_progress`, `generate_training_report`,
`_resolve_or_create_requirement` are all outside the diff). TR3-1's
due-date-normalization fix (`create_requirement`/`update_requirement`,
`training.py` lines 1288/1341) is likewise outside the diff and unchanged.
All five flagged-not-fixed items (TR2-2, TR2-4, TR3-2, the bulk/historical-
import enum-validation gap, `enroll_member`'s duplicate-active-enrollment
race) sit in code this pass's diff never touches, and their
`docs/KNOWN_LIMITATIONS.md` mirrors still describe the current code
accurately — none has been fixed or has regressed further.

### Review of the compliance-matrix redesign (new since pass 3)

`get_compliance_matrix` was rebuilt from a plain met/not-met grid into a
triage view backed by a new `RequirementEvaluation` dataclass
(`training_compliance.py`'s `evaluate_member_requirement_detail`, wrapped by
the pre-existing `evaluate_member_requirement` so its four other call sites
and their test suite are unaffected) and a new `classify_standing` helper
lifted out of `_evaluate_member_compliance` so the matrix and the dashboard
percentage (`compute_org_compliance_pct`) share one definition of
compliant/at-risk/non-compliant. This is exactly the discipline CLAUDE.md's
Pitfall #29 (written from an earlier incident on this same screen) asks
for, and the commit messages cite that lineage directly. Read the full diff
of both changed files, not just the description:

- **Org/tenant scoping unaffected.** `get_compliance_matrix`'s `members`,
  `requirements`, and `records` queries are the same three org-scoped
  queries pass 1 reviewed (`organization_id` filter on all three, plus a
  `user_id.in_(...)` restricted to the already-org-scoped `members` list on
  the records query) — untouched by this diff; only the per-cell response
  shape changed.
- **Permission gate unchanged** — `require_permission("training.manage")`,
  matching TR2-1's finding that this endpoint carries per-member PII and
  needs it.
- **Two real, pre-existing bugs fixed as part of this redesign, not
  introduced by it:** `_find_matching_profile` was reading a `role_id`
  attribute `Position` does not have (it has `id`) — every role-scoped
  compliance profile silently matched nobody and fell back to org-wide
  grading since the code predating this refactor; and
  `compute_org_compliance_pct` (the dashboard-percentage function) read
  `member.positions` without eager-loading it, which raises
  `MissingGreenlet` on an `AsyncSession` for every member but the caller —
  i.e., on every real request from an org using compliance profiles at all.
  Both are load-bearing for the profile-matching feature these same commits
  extended into the matrix, and both are fixed at the same two call sites
  (`get_compliance_matrix` gained the identical `selectinload(User.positions)`
  eager-load `compute_org_compliance_pct` needed).
- **The "empty denominator" pattern Pitfall #29 warns about is present but
  deliberate and consistent, not a regression.** `classify_standing`
  returns `("compliant", 100.0)` when `total_count <= 0`
  (`training_compliance.py:717`) — this exactly preserves
  `_evaluate_member_compliance`'s pre-existing `if not member_reqs: return
"compliant", 100.0` guard (present before this refactor; confirmed via
  `git show 0d1f92c41:.../training_compliance.py`), now shared by both the
  matrix and the dashboard percentage instead of being duplicated. The new
  frontend model (`complianceMatrixModel.ts`) applies the _same_ member-level
  convention (`pct: total === 0 ? 100 : ...` in `evaluateMember`) but
  deliberately diverges for the **per-requirement** rollup
  (`rollUpRequirements`'s `pct: total === 0 ? null : ...`), with a comment
  citing the exact "empty denominator is not success" reasoning — a
  requirement nobody is graded against reads "not applicable" rather than a
  misleading "100% met" in green. Two different conventions for two
  different questions ("has this member met everything asked of them" vs.
  "is this requirement actually being satisfied"), applied consistently
  across both new files. Not a finding.
- **No new client-supplied FK, no new route, no schema change, no banned
  frontend pattern** (`window.confirm`/`alert`/`prompt`,
  `dangerouslySetInnerHTML`) in `ComplianceMatrixTab.tsx` or
  `complianceMatrixModel.ts`.
- **Abuse resistance — wrong the first time this section was written.** The
  first draft called `get_compliance_matrix`'s unpaginated scan "bounded by
  department size, not by member training history," reusing pass 2's
  reasoning for a _different_ endpoint's _configuration-data_ queries
  (courses/categories/requirements). That reasoning does not transfer: this
  endpoint's own `TrainingRecord` query (`training.py:2789-2796`) has no
  date or row bound and grows with the org's complete training history, the
  same shape TR2-4 already names for the sibling dashboard-summary endpoint
  — a distinct, separately-callable scan TR2-4 does not cover. See TR4-2.
- **The "share one definition" claim was also wrong.** `classify_standing`
  unifies the compliant/at-risk/non-compliant _threshold_ logic, but not
  _which requirements count_ — `get_compliance_matrix` excludes a
  requirement scoped to a `required_membership_types` list the member
  doesn't belong to, per-member, inside its own loop; `compute_org_
compliance_pct` did not apply that same exclusion to the requirement list
  it hands to `_evaluate_member_compliance`. See TR4-1 (fixed) and TR4-3
  (the third, still-diverging endpoint, flagged).

## Findings (pass 4)

### TR4-1 — LOW/MED (data correctness, Pitfall #29) — `compute_org_compliance_pct` graded a member against a requirement scoped to another membership type — ✅ FIXED

**Reported by Codex on PR #2455; confirmed.** `get_compliance_matrix`
excludes a requirement from a member's denominator whenever
`req.required_membership_types` is set and the member's own
`membership_type` isn't in it (`training.py:2863-2867`, unchanged since
before this rotation). `compute_org_compliance_pct` — which feeds the
dashboard percentage the matrix links from — passed its profile-selected
`member_reqs` straight to `_evaluate_member_compliance` with no equivalent
filter, so a membership-scoped requirement the matrix correctly hides from
a member could still be evaluated (and, having no applicable records,
typically reported `not_started`) against that same member on the
dashboard.

**Where:** `app/services/training_compliance.py` —
`compute_org_compliance_pct`'s per-member loop, before the call to
`_evaluate_member_compliance`.

**Failure scenario:** an org configures a requirement restricted to
`required_membership_types=["reserve"]`. An `active`-type member is shown
100% on the compliance matrix for that requirement's absence from their row
(correct — it was never asked of them) while the dashboard's org-wide
compliance percentage counts them as failing it — the exact "two screens
disagreeing about the same member" shape Pitfall #29 exists to name. This
predates the compliance-matrix redesign entirely (`compute_org_compliance_
pct`'s member loop was untouched by that diff — confirmed via `git diff
0d1f92c41 HEAD`) and was never caught by pass 1-3, which reviewed the
matrix and the dashboard percentage's threshold/profile logic but not
whether their requirement _selection_ actually agreed.

**Impact:** LOW/MED. Not a tenant-isolation or auth defect, and not a
crash — a same-org, membership-type-scoped correctness gap that
understates a department's real compliance percentage whenever any
requirement is membership-restricted, which the "Verified good" precedent
this same file's CMP2-3 fix established as a real, previously-exploited
configuration shape.

**Fix:** filters `member_reqs` by the same `required_membership_types`
check as `get_compliance_matrix`, applied after profile-narrowing (matching
the matrix's own ordering) and before the compliance evaluation call.
Guard tests: `tests/test_compute_org_compliance_pct_profile_overrides.py::
TestMembershipTypeExclusion` (2 tests — a requirement restricted to another
membership type is excluded; one restricted to the member's own type still
counts, so the fix cannot pass by excluding everything). The first test
confirmed failing (`0.0` instead of `100.0`) against the pre-fix code via
`git stash` on `training_compliance.py` alone.

> **Round 2 — a second Codex review of this same PR caught the first
> draft of this fix reintroducing the class of bug it was meant to close.**
> The initial fix checked only `required_membership_types`, ignoring
> `applies_to_all` — but `TrainingService.get_applicable_requirements` (the
> member-facing `/my-training` path, `training_service.py:1471-1477`) gives
> `applies_to_all` precedence over `required_membership_types` whenever
> both are set. Both fields are independent, unvalidated columns on the
> same row (no schema cross-field validator clears one when the other
> changes), so a requirement created as "applies to all" and later scoped
> down without also clearing `applies_to_all` is a reachable state, not a
> hypothetical one — `RequirementModal.tsx` only exposes the membership-
> type checklist while "Applies to All" is unchecked and clears the list
> when it's re-checked, but nothing stops a raw API write (an import, a
> script) from setting both. Excluding such a requirement from a member's
> denominator (the first draft's behavior) directly contradicts what
> `/my-training` tells that same member applies to them — a fresh
> cross-screen disagreement in the opposite direction, opened by this
> pass's own fix, inside the pass whose entire point is closing that class.
>
> Worse: `get_compliance_matrix`'s own **pre-existing** filter has the
> identical gap (it never considered `applies_to_all` either), so simply
> matching the matrix — this fix's original approach — was matching a
> filter that was itself already wrong. Fixed both call sites together:
> `compute_org_compliance_pct` and `get_compliance_matrix` each now check
> `applies_to_all` first, falling through to the `required_membership_types`
> check only when it's false — matching `get_applicable_requirements`'s
> precedence exactly. Discovering this also surfaced that this pass's own
> first-draft guard tests, and the pre-existing `test_compliance_matrix_
endpoint.py::TestApplicableRequirementDenominator::test_inapplicable_
requirement_is_out_of_the_percentage` test from an earlier pass, all
> exercised a membership-scoped requirement via a fixture that hardcoded
> `applies_to_all=True` regardless of whether a membership-type list was
> given — data no real UI flow produces, since the modal only allows
> setting the list with the checkbox unchecked. Fixed the fixtures in both
> test files to set `applies_to_all=False` when a membership-type list is
> supplied (matching real UI-created data), and added a new guard test at
> each call site with `applies_to_all=True` forced alongside a non-matching
> membership-type list, proving the requirement still counts. Both new
> tests confirmed failing against the round-1 fix.

> **Round 3 — a third Codex review found the round-2 fix left a third,
> untouched call site disagreeing with the two it fixed.**
> `get_compliance_summary` (`training.py`, the `/training/compliance-
summary/{id}` profile-card endpoint) has its own applicability filter
> that checks `required_membership_types` **before** `applies_to_all` — the
> wrong order, unaffected by round 2 since that round only touched
> `get_compliance_matrix` and `compute_org_compliance_pct`. Investigating
> this surfaced a **second, independent bug in the same block**, not
> reported by Codex but caught by inspection while fixing the reported one
> (CLAUDE.md's "no acceptable pre-existing errors" rule): the function's
> `if req.applies_to_all: ... elif req.required_roles and ...:` chain never
> re-checked a membership-type _match_ as its own inclusion path, so a
> requirement scoped **only** by `required_membership_types`
> (`applies_to_all=False`, no `required_roles` — the ordinary shape of a
> membership-scoped requirement) was silently excluded from this endpoint
> for every member, matching or not. Grepping the rest of the file for the
> same shape found two more independent reimplementations, both missing
> `applies_to_all` entirely: `get_training_dashboard_summary`'s per-member
> `applicable` filter (used by the "Department Compliance" card; TR4-3
> already flags this endpoint's separate profile/threshold gap, but this is
> a different bug in the same function) and `get_member_period_status`'s
> own `applicable` filter (the month-at-a-glance member-status endpoint).
> Five independent reimplementations of one applicability rule, three of
> them wrong in one direction or another, is exactly how this class of
> cross-screen disagreement keeps recurring.
>
> Fixed by extracting `requirement_applies_to_member(req, membership_type,
role_ids=None)` into `training_compliance.py` — the exact precedence
> chain `TrainingService.get_applicable_requirements` already established
> (`applies_to_all` → `required_membership_types` → `required_roles`) — and
> switching all five call sites (`get_compliance_matrix`,
> `compute_org_compliance_pct`, `get_compliance_summary`,
> `get_training_dashboard_summary`, `get_member_period_status`) to call it
> instead of hand-rolling the check. Guard tests: a new
> `TestRequirementAppliesToMember` in `test_training_compliance.py` (7
> cases against the helper directly, including the applies_to_all-wins-
> over-stale-list case and the membership-scoped-with-no-role-fallback
> case that reproduces `get_compliance_summary`'s second bug). Fixing
> `get_member_period_status` required updating its own test file's mock
> requirement builder (`test_member_period_status.py`'s `_req()`), which —
> like the round-1 fixture bug — built a bare `SimpleNamespace` missing
> `applies_to_all`/`required_roles` entirely; 2 of its 4 tests failed with
> `AttributeError` until fixed, confirming the helper's stricter contract
> rather than a false positive.

### TR4-2 — LOW (abuse resistance) — `get_compliance_matrix` has its own unbounded record scan, distinct from TR2-4 — 🚩 FLAGGED

**Reported by Codex on PR #2455; confirmed.** `get_compliance_matrix`
loads every active member, requirement, and `TrainingRecord` for the org
with no date or row bound (`training.py:2789-2796`) — the identical shape
TR2-4 already flags for `get_training_dashboard_summary`, but a separately
callable endpoint sharing no code path with it. Bounding TR2-4's endpoint
would leave this one exactly as unbounded as before.

**Not fixed:** same reasoning as TR2-4 — needs the query itself bounded to
what each requirement's date window actually uses, or a set-based/aggregate
redesign entangled with `evaluate_member_requirement_detail`'s per-
requirement window correctness, not a safe drive-by alongside this pass's
own doc-only diff. Mirrored into `docs/KNOWN_LIMITATIONS.md` as its own
entry (not folded into TR2-4's, since fixing TR2-4 would not fix this).

**Impact:** LOW — same-org, `training.manage`-gated, and bounded by
department size on the member/requirement axes even though the record axis
is not; same abuse-resistance class as TR2-2/TR2-4/TR3-2.

### TR4-3 — LOW/MED (Pitfall #29) — Three endpoints, three different definitions of "compliant" — 🚩 FLAGGED

**Reported by Codex on PR #2455; confirmed.** `get_compliance_matrix` and
`compute_org_compliance_pct` (after TR4-1's fix) now agree on both which
requirements count and how the threshold is applied. `get_training_
dashboard_summary` — which backs the "Department Compliance" card that
links directly into the matrix — is a third, independent implementation
that ignores compliance profiles and configured thresholds entirely: every
membership-applicable requirement counts, and 100% of them must be met,
with no percentage tier and no at-risk state (`training.py:168-193`,
`if not unmet: compliant += 1`). An org running any compliance profile with
a narrowed requirement list, a non-100% compliant threshold, or an at-risk
tier will see this card disagree with both the matrix and the dashboard
percentage.

**Not fixed:** this is pre-existing (outside this pass's diff entirely) and
larger than a drive-by — it is a product decision about which of three
currently-different definitions the summary card should adopt, not a bug
with one obviously-correct fix. Mirrored into `docs/KNOWN_LIMITATIONS.md`.

**Impact:** LOW/MED — same-org, `training.manage`-gated; a correctness/
trust gap (a chief-facing summary card that can read differently from the
detail screen it links to) rather than a security boundary.

### TR4-4 — LOW (Pitfall #29 corollary) — A member with zero applicable requirements counts as "compliant," inflating the org percentage — 🚩 FLAGGED

**Reported by Codex on PR #2455; confirmed, and pre-existing.**
`classify_standing` returns `("compliant", 100.0)` whenever `total_count
<= 0` — this exactly preserves `_evaluate_member_compliance`'s guard from
before this rotation's own compliance-matrix redesign (`if not member_reqs:
return "compliant", 100.0`; confirmed via `git show 0d1f92c41:.../
training_compliance.py`) and is deliberately, consistently applied by both
`get_compliance_matrix` and `compute_org_compliance_pct` — not a
regression, and not the inconsistency TR4-1 fixed. TR4-1's own new
membership-type exclusion makes this reachable in one more way than
before (a member matching none of an org's membership-scoped
requirements now also gets an empty `member_reqs`, not only the
pre-existing profile `required_requirement_ids=[]` case), and Codex's
point stands independent of TR4-1: counting "nothing was asked of this
member" as a compliant hit inflates `compute_org_compliance_pct`'s
numerator without excluding the member from its denominator (`len(members)`
still counts them), which reads as real compliance on a chief-facing
percentage that isn't measuring anything for that member at all — the
same "a denominator of nothing rendered as success" shape CLAUDE.md's
Pitfall #29 corollary names.

**Not fixed:** this is the same zero-denominator convention this file
already established and deliberately tests as correct for the profile
case (`TestEmptyRequiredRequirementIds::test_explicit_empty_list_means_
nothing_required`, asserting `100.0`, predates this pass). Changing it
now would mean redefining `compute_org_compliance_pct`'s population (does
a member with nothing applicable count in `len(members)` at all, or
should the percentage exclude them and report a separate "N/A" count?) —
a product decision spanning every existing caller of `classify_standing`,
not a drive-by alongside TR4-1's narrower membership-type fix. Notably,
the frontend's own `complianceMatrixModel.ts` already treats this
distinction as real: `evaluateMember`'s member-level `pct` matches this
same "compliant when total is 0" convention, but `rollUpRequirements`'s
per-requirement `pct` deliberately returns `null` ("not applicable")
instead — proving the two conventions coexist by design elsewhere in this
codebase, which is precedent for _how_ to fix this, not evidence that the
member-level side is already correct. Mirrored into
`docs/KNOWN_LIMITATIONS.md`.

**Impact:** LOW — same-org, `training.manage`-gated; inflates a reported
percentage rather than exposing data or bypassing a control.

## Completion gate (pass 4)

| Check                                               | Result                                               |
| --------------------------------------------------- | ---------------------------------------------------- |
| `flake8` (all 6 changed files)                      | ✅ 0 violations (round 2 fixed one F841)             |
| `black --check` (same files)                        | ✅ clean                                             |
| `isort --check-only` (same files)                   | ✅ clean                                             |
| `python3 scripts/validate_migrations.py --strict`   | ✅ 441 revisions, single head (no schema change)     |
| `pytest tests/ -q -k "training or compliance"`      | ✅ 1130 passed, 1 skipped (pre-existing)             |
| `pytest tests/ -q` (full backend suite)             | ✅ 12077 passed, 21 skipped (pre-existing), 0 failed |
| `cd frontend && npm run typecheck` / `npm run lint` | n/a — no frontend file touched this pass             |

Changed files: `backend/app/services/training_compliance.py`,
`backend/app/api/v1/endpoints/training.py`,
`backend/tests/test_compute_org_compliance_pct_profile_overrides.py`,
`backend/tests/test_compliance_matrix_endpoint.py`,
`backend/tests/test_training_compliance.py`,
`backend/tests/test_member_period_status.py`.
