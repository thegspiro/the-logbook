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

## Pass 3 (2026-09-04) — Codex follow-up (same PR): 1 fix, 1 flagged, 1 corrected claim

**PR:** [#2217](https://github.com/thegspiro/the-logbook/pull/2217).
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

**Fix:** compute `days_until_due = (requirement.due_date - today).days if
requirement.due_date else None` once near the top of the method (`today` was
already computed there) and pass it to all three construction sites.

**Guard tests:** `test_training_compliance_integration.py::
TestHoursRequirementCompliance::test_days_until_due_is_populated` and
`::test_days_until_due_is_negative_when_overdue` — insert a requirement with
an explicit `due_date` 10 days out / 5 days past, assert the returned
`RequirementProgress.days_until_due` is `10` / `-5` respectively.

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
