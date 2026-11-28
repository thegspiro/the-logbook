# Application Review — Membership Pipeline (Tier B)

**Prefix:** `MP2` · **Iteration:** B9 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-06 (pass 2), 2026-08-09 (pass 3), 2026-08-09 (pass 4),
2026-10-15 (pass 5), 2026-11-26 (pass 6)

---

## Pass 6 (2026-11-26) — the lifecycle pass 5 did not read, and the screens: 8 fixed, 7 flagged

### Scope, stated plainly

Pass 5 read the update methods. This pass read what it named as unread:

- stage advance and regress, and the stage gates;
- auto-advance;
- conversion to a member;
- the inactivity sweep;
- the public status page and its link;
- the activity log;
- the interview and election-package rules.

It also read the prospective-members screens beyond their payload builders:

- the board and table;
- the applicant drawer;
- documents, election packages and the interview page;
- settings.

Nine backend findings were reproduced first against the real database. Every fix has a test that failed on the unfixed code.

**Not read:**

- Backend: `prospect_access.py` (access control is the security review's), the event-link code, `_auto_enroll_probationary`, the kanban and stats queries, the follow-up form service.
- Frontend: most of the stage-config editor, the pipeline builder and the conversion modal's steps.

### Frontend

**MP2-9 — MED — A document filed at an earlier stage showed as meeting this stage's requirement — ✅ FIXED**

- The tick counted documents uploaded at any stage. The advance gate counts only those filed at the current stage, so the tick showed green and Advance then failed with "Missing required documents".
- The tick now counts as the gate does.

**MP2-10 — MED-HIGH — Bulk actions could reach applicants no longer on screen — ✅ FIXED**

- The selection survived a pipeline switch, a filter, a page change, and a reject or convert from the drawer.
- The bar counted hidden rows, and a bulk Reject, Hold or Advance sent their ids, including applicants of the pipeline viewed before. The inactive-purge selection had the same problem.
- Both selections now keep only rows on screen.

**MP2-11 — MED — One applicant's election package could appear in another's drawer — ✅ FIXED**

- The package fetch neither cleared the previous package nor dropped a stale answer.
- A slower response for the first applicant, or a failed fetch for the second, left the first's package showing. Its notes seeded the form, and Save Draft sent them to the second applicant's package.
- The fetch now clears first and is token-guarded, like the store's other fetches.

**MP2-12 — MED — The interview page could show, and post for, the previous applicant — ✅ FIXED**

- It rendered whichever applicant the store held. Coming from another applicant's page, that applicant showed.
- If this applicant's fetch failed (a 403 after unassignment), the previous applicant stayed on screen and the interview form posted to their id. With an empty store, a failed fetch spun forever.
- It now shows only the applicant in its address, and the error when that applicant cannot load.

### Backend

**MP2-13 — MED — A rejected, withdrawn, on-hold or inactive applicant could be converted to a member — ✅ FIXED**

- `transfer_to_membership` refused only an applicant already transferred. Every other forward move goes through `_assert_movable`; conversion now does too.

**MP2-15 — LOW-MED — An applicant reactivated and left idle again was never marked inactive again — ✅ FIXED**

- The sweep skipped anyone it had ever marked. Counted as critical rather than warned, they got no warning email either.
- A mark now counts only if it postdates the last reactivation.

**MP2-16 — LOW — The checklist gate counted ticks instead of matching them — ✅ FIXED**

- `["x", "x", "x"]` passed a three-item checklist, as did ticks of items since renamed.
- Ticks are now matched against the configured labels (normalized, as the document gate normalizes types).

**MP2-17 — LOW — A stage email's "track your application" link could already be expired — ✅ FIXED**

- The email used the token's existing timestamp, so for an applicant whose link was over 30 days old the emailed link returned 404.
- It now refreshes the timestamp when it includes the link, as the status-page stage already did.

### Flagged for the owner (in `docs/KNOWN_LIMITATIONS.md`)

- **MP2-14 (LOW-MED) — A manual conversion emails the new member's login before the commit.**
  - A commit that then fails (a username or membership-number race) leaves the applicant with credentials for an account that does not exist.
  - Deferring the email to after the commit was tried and reverted. `test_prospect_transfer_password.py` pins that the transfer result never carries the sender, which would hold the plaintext password in a closure.
  - Closing this needs a way to send after the commit that does not carry the password. That is a design decision, not a one-line fix.
- **MP2-18 (HIGH) — A Reference Check stage cannot be completed.**
  - The gate counts `action_result.references`, and nothing writes that key. So Advance always fails, and Skip is refused on a required stage, which is the default.
  - The drawer's panel shows "0 of ? references received", and the "auto-advance when all references are verified" box has no reader (pitfall #19).
  - Decide: build reference capture, or stop enforcing the stage.
- **MP2-19 (MED) — A "not elected" vote is undone by creating a new package.**
  - The gate reads only the latest package, and a new draft passes it. So Advance, and Convert, go through after a failed vote.
- **MP2-20 (LOW-MED) — The Interview Panel gate is weaker than its template says.**
  - Repeat interviews by one person count toward the total, and any one positive recommendation passes. So one interviewer's `recommend` plus `do_not_recommend` advanced the applicant past "two interviews with positive recommendations".
- **MP2-21 (MED) — The Medical Screening panel reads data nothing writes.**
  - It shows "No screening data recorded yet" whatever the gate, which grades `ScreeningRecord` rows, decides.
  - The fix needs the backend to expose its grading, as it does for interviews (pitfall #29).
- **MP2-22 (LOW) — Stage-entry effects run only on a forward advance.**
  - The stage email, status-page link and meeting auto-link do not run on creation, assign-stage or regress. A pipeline whose first stage is an automated email sends nothing to a new applicant.
- **MP2-23 (LOW) — State left behind:**
  - a withdrawn or rejected applicant's package stays on its ballot and is tallied;
  - a regressed stage keeps its approvals and ticks;
  - one member can sign two approval roles;
  - the duplicate-member check refuses conversion on a name match alone, with no override and a message that says "email".

### Open (not flagged)

- **LOW — Emails sent before the commit:** stage, status-link, follow-up and completion emails go out inside the transaction. A failed commit leaves an email describing a move that did not happen.
- **LOW — Other backend items:**
  - The Documenso webhook answers 500 to a stage-gate refusal, so the provider retries.
  - The auto-transfer refusal log names the matched member (pitfall #33).
  - A converted applicant keeps an in-progress final stage.
  - A stage added later has no progress row for existing applicants.
  - The inactivity clock is `updated_at`, which a status-page view resets.
- **LOW — Frontend:**
  - Kanban drag and the table's Advance ignore a convert stage mid-pipeline.
  - `fetchApplicant` has no stale guard and always reopens the drawer.
  - The activity log and other drawer sections race when switching applicants.
  - Convert/Back use the board's pipeline for an applicant from another.
  - The membership-type buttons show without `can_work`.
  - Column sort sorts the loaded page only.
  - Settings toggles re-seed the inactivity form.
  - The timeline and the strip use different completion rules.
  - `fetchPipeline` has no stale guard.

### Mechanical checks

- **Route gating:** 64 routes.
  - 19 call `require_permission` directly.
  - 45 go through the module's own dependencies: `require_pipeline_reader`, or `require_prospect_access(Level.…)`, which admits the permission or an assignment to the applicant.
- **Status filters:** no `== UserStatus.ACTIVE` gates.
- **Search:** both `LIKE` sites escape.

### Completion gate (pass 6)

| Check                                        | Result                                                 |
| -------------------------------------------- | ------------------------------------------------------ |
| pipeline, prospect and membership tests      | ✅ **1,386 passed**, 1 skipped (optional `pywebpush`)  |
| new tests                                    | ✅ 5 backend (real database), 5 frontend; failed first |
| `flake8` / `black` / `isort` (changed files) | ✅ clean                                               |
| mypy ratchet                                 | ✅ 0 errors, matching the baseline                     |
| prospective-members frontend tests           | ✅ 414 passed (45 files)                               |
| `npm run typecheck` / `npm run lint`         | ✅ 0 errors / 0 warnings                               |

---

## Pass 5 (2026-10-15) — `PUT /pipelines/{id}` answered a null NOT NULL column with a 500 (1 fixed, 1 dead schema removed, 1 contract note)

Lens for this pass: the update-payload discipline the B4–B8 passes applied
(`exclude_unset`, `apply_updates`, an explicit `null` on a NOT NULL column), driven
through the **real handlers**, plus an AST dead-code scan that counts `tests/` as a
reference source. The module is large — **53 routes, an 8,848-line service, 1,076
lines of schemas** — and this pass reads its update paths, not its pipeline logic;
see "Not read" below.

### MP2-6 — LOW — `PUT /pipelines/{id}` returned 500 for `{"name": null}` — ✅ FIXED

`PipelineUpdate` types every field `Optional`; `name` and `public_show_future_stages`
are NOT NULL. `MembershipPipelineService.update_pipeline` applies the payload with
`apply_updates`, which refuses the null by raising `ValueError`, and the other four
update handlers in the file (`update_step`, `update_prospect`,
`update_election_package`, `update_interview`) turn that into a 400. `update_pipeline`
was the one handler with no `try/except ValueError`, so the error escaped as an
unhandled 500.

**Reproduced before fixing:** a new integration test drives the five update
endpoints over HTTP against the real schema and sends `null` for every NOT NULL
field the schemas can name (derived from schema and model: 9 fields — pipeline 2,
step 2, prospect 4, election package 1; the interview schema has none). On the
unmodified handler **2 of 15 failed — `pipeline-name` and
`pipeline-public_show_future_stages`, both 500**; the other 13 passed. The handler
now catches `ValueError` and answers 400 through `safe_error_detail`, like its
siblings. The nullable half is paired with it (`description` on a pipeline and a
step, `notes` on a prospect, `coordinator_notes` on a package still clear), so a
guard that rejected every null would fail the file too.

Reachability: low. The pipeline builder always sends a name, so this needs a direct
API client; the cost was a bare 500 instead of a message naming the field.

### MP2-7 — INFO — `PipelineKanbanColumn` (backend schema) had no reference anywhere — ✅ REMOVED

The AST scan of 246 definitions across the service, endpoints, schemas, models and
`prospect_privacy` flagged five names. **Four were false positives** — a
`@field_validator`, a `@model_validator` and a `@validates` listener, each
registered by its decorator and so never named elsewhere (`_defaults_when_unset`,
`_bound_items`, `_class_and_status_together`, `_sync_status_token_hash`); they were
read before being kept. The fifth, `schemas/membership_pipeline.py::
PipelineKanbanColumn`, appears in no `.py`, `.ts`, `.tsx` or `.md` file in the
repository besides its own definition (the board is built from `ProspectListResponse`
rows grouped on the client). Removed.

### MP2-8 — INFO — `sort_order` is accepted on a step update and silently ignored — 🚩 NOTED, contract only

`PipelineStepUpdate` declares `sort_order`, but `update_step` strips it
(`_STEP_PROTECTED_FIELDS`: a stage moves through `reorder_steps`, because a generic
update could write a value another stage already held). The stage-edit modal still
re-sends the stage's current `sort_order` on every edit, which is harmless, and a
`null` is ignored the same way instead of refused. So the field is accepted and does
nothing — the shape CLAUDE.md #19 warns about, in a mild form (no UI offers it as a
setting). The behaviour is pinned by a test so it cannot drift; removing the field
from the schema and from `mapStageUpdateToBackend` would make the contract honest
and is a small follow-up, deliberately not bundled into this fix.

### Verified good ✅ (this pass)

- **Update handlers.** All five dump with `exclude_unset`; no `exclude_none` anywhere
  in the endpoint file. Every service update goes through `apply_updates` with a
  protected-field set; none uses a `setattr` loop.
- **Routes without `require_permission`.** Two of 53, both deliberate and
  documented in their docstrings: `GET /my-sign-offs` and `POST
/prospects/{id}/approve-step` authorize by the approval role the caller holds, the
  second returns a minimal result rather than the PII-bearing record, and the first
  filters out the caller's own application (the router-level self-access guard cannot
  run on a route without a `prospect_id` path parameter).
- **Frontend update payloads.** `updateApplicant` / `updateStage` / `updatePipeline`
  send a key only when a value is present, with explicit `null` as the clear for the
  nullable fields (`target_role_id`, `inactivity_timeout_days`, the contact fields);
  the types say so. `/prospective-members/` is in `UNCACHEABLE_PREFIXES`, and the
  module's own `createApiClient` instance does not use the response cache at all.
- Related suites: 1,256 backend tests (prospect, pipeline, membership, org-scoping
  ratchet, CSV, LIKE, capacity) pass.

### Not read (scope, stated plainly)

The 8,848-line service was read at its update methods and the lines around them, not
as a whole. Stage advance / regress, auto-advance, the form-integration and email
side effects, conversion to a member, the public status page, the activity log and
the interview / election-package business rules were **not** re-read — earlier passes
and the existing tests cover the FK and PII findings recorded below; a clean result
here says nothing new about them. The prospective-members frontend (16,798 lines) was read only at
its three update payload builders and its cache classification.

### Completion gate (pass 5)

| Check                                                                                    | Result                                                                                                                      |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/`                                                                     | ✅ exit 0, no output                                                                                                        |
| `black --check app/ tests/`                                                              | ✅ 1718 files unchanged                                                                                                     |
| `isort --check-only` (changed files)                                                     | ✅ clean                                                                                                                    |
| new backend file, mutation-checked                                                       | ✅ 15 pass with the fix; **2 fail with the handler change stashed** (`pipeline-name`, `pipeline-public_show_future_stages`) |
| marker routing                                                                           | ✅ `-m "not integration and not slow and not docker"` selects 0 of 15; `-m integration` selects 15                          |
| backend tests (prospect, pipeline, membership, org-scoping ratchet, CSV, LIKE, capacity) | ✅ **1256 passed, 1 skipped** (optional `pywebpush`)                                                                        |
| `check_route_permissions.py --strict`                                                    | ✅ 0 errors, 0 warnings (no route added or removed)                                                                         |
| frontend                                                                                 | n/a — no frontend file changed, so `tsc` / `eslint` / `vitest` were not re-run                                              |

Two sandbox faults surfaced while gating, neither in the code: the Python used here
lacked `nh3` (a pinned dependency in `requirements.txt` that `main` had added), which
made 16 test files fail to collect, and the local database predated `main`'s newest
migration (`Unknown column 'inventory_items.also_called'`). I installed `nh3==0.3.7`
and ran `alembic upgrade head` + `repair_schema.py`; the re-run is the 1256 above.

---

## Pass 4 (2026-08-09) — MP2-5: two client-FK gaps the MP-5 sweep missed

Pass 4 ran the INV-4-style FK audit across the whole module (a sub-agent mapped
every create/update/advance/bulk path). Everything MP-5/MP2-2 hardened holds —
`referred_by`, `pipeline_id`, `election_id`, `event_id`, `role_ids`,
`interviewer_id` (server-set to `current_user`), and the advance/regress targets
(computed from the prospect's own pipeline) are all validated or server-derived.
The audit found **two** client-supplied FK writes the earlier MP-5 sweep missed.

### MP2-5 — LOW/MED — Two client-supplied FKs stored without an in-org check — ✅ FIXED

1. **`add_prospect_document.step_id`** — the one MP-5 sibling that was skipped.
   `create_interview` and `create_election_package` both reject a `step_id` that
   isn't in the prospect's own pipeline, but `add_prospect_document` stored it raw
   (and then drove `_try_auto_advance_step` off it). Added the same
   `step in prospect.pipeline.steps` guard → `ValueError` ("Step does not belong to
   this prospect's pipeline") on a foreign/other-pipeline step.

2. **`email_template_id` on the step writers** (`create_pipeline` inline steps,
   `add_step`, `update_step`) — a client-supplied FK to the **org-scoped**
   `EmailTemplate` (used when the stage email fires), stored with no check and
   **not** in `_STEP_PROTECTED_FIELDS`, so `update_step`'s generic `setattr` could
   re-point it too. Added a shared `_assert_email_template_in_org` helper
   (`assert_in_org(..., allow_none=True, label="email template")`) on all three
   writers (present-key-guarded on update).

**Latent-500 corrected along the way:** the `create_pipeline`, `add_step`, and
`update_step` **endpoints had no `ValueError` handling** (only `reorder_steps` and
the prospect endpoints did), so the new guards — and any future service
`ValueError` — would have surfaced as 500s. All three gained the module-standard
`except ValueError → 400 + safe_error_detail` (the same latent-500 shape closed in
B7). No behavior change for valid callers (the pipeline builder selects templates
from an org-scoped list); a foreign id is now a clean 400. **6 tests added**
(`TestStepEmailTemplateValidation`, `TestProspectDocumentStepValidation`).

### Still flagged (unchanged)

- **MP-7 message generalization** (product call, `KNOWN_LIMITATIONS.md`).
- **Step-in-pipeline check helper** — now that `add_prospect_document` joins
  `complete_step`/`create_interview`/`create_election_package` as a fourth caller
  of the same `step in prospect.pipeline.steps` idiom, a shared helper is a
  reasonable small DRY follow-up (not done this pass — the inline form is clear and
  each call site reads its own error).

**Completion gate (pass 4):** `flake8` 0 · `black --check` clean · `tsc --noEmit`
n/a (no frontend change) · `test_membership_pipeline_service.py` **10 passed**
(4 + 6 new) + `test_membership_pipeline_enum_validation.py` unchanged (all DB-free).

---

## Pass 3 (2026-08-09) — latent-500 on step/status enums; E712 swept

Re-verified the landed fixes hold (MP2-1 `pipeline_name` set in `get_prospect`;
MP2-2 `referred_by` `assert_in_org` on create+update; MP-6 sensitive-field activity
log records `{"changed": True}`). The B1 latent-500 lens then surfaced a genuine
recurrence — and a couple of false positives that a read cleared.

### MP2-3 — LOW/MED — `step_type` / `action_type` / prospect `status` 500 on a bad value — ✅ FIXED

**What:** these three fields were typed as free `str` on their request schemas but
map to **strict MySQL ENUM** columns, and are inserted **raw** — `create_step`/
`update_step` build/`setattr` `step_type`+`action_type` (service 148-149, 316-317,
and the un-protected `update_step` setattr loop), and `update_prospect` setattrs
`status` (line 934; `status` is **not** in `_PROSPECT_PROTECTED_FIELDS`). So an
out-of-set value passed Pydantic, reached MySQL, and 500'd (or stored `''` under
non-strict mode). The B1 class.

**Fix:** `@field_validator`s on `ProspectUpdate.status` (→ `ProspectStatus`) and
`PipelineStep{Create,Update}.{step_type,action_type}` (→ `PipelineStepType` /
`ActionType`), each deriving its value set from the model enum, lowercase-normalizing
and rejecting unknowns → 422. Request-only, so responses are untouched; the pipeline
builder and applicant forms send only valid values, so no valid caller is affected.
**10 tests added.**

**Two lens false positives, cleared by reading (no change):**

- `Interview{Create,Update}.recommendation` — flagged, but `create_interview` derives
  it via `InterviewRecommendation(recommendation)` (a `ValueError` the interview
  endpoints already convert to 400), so it's a clean 400 today, not a 500. Left as-is.
- `ElectionPackageUpdate.status` — flagged, but `ProspectElectionPackage.status` is a
  plain **String** column, not an ENUM, so there's no 500 path. Left as-is.

### MP2-4 — NIT — 4 `== True/False  # noqa: E712` swept — ✅ FIXED

Converted the 4 boolean-column E712 comparisons in
`membership_pipeline_service.py` (`is_template`, `is_default` ×2,
`TrainingProgram.active`) to `.is_(...)`, removing every E712 noqa.

### Still flagged (unchanged)

- **MP-7 message generalization** — whether the 409 "existing member" message should
  name the archived member at all (product call, `KNOWN_LIMITATIONS.md`).
- **Step-in-pipeline check helper** — minor DRY if a fourth caller appears.

**Completion gate (pass 3):** `flake8` 0 · `black --check` clean · `tsc --noEmit` 0
(no frontend change) · eslint unaffected · new enum-validation tests **10 passed** +
existing MP tests **16 passed** (all DB-free; the `db_session` errors are the known
no-MySQL fixture failures).

---

## Pass 2 (2026-08-06)

Re-verified pass 1 (MP-5/6/7 fixed). This module was pre-scanned in the BXC
cross-cutting sweep, which flagged two items to resolve here with proper module
context.

### MP2-1 — LOW→MED (live UI defect) — ProspectResponse.pipeline_name never populated — ✅ FIXED

`ProspectResponse` declares a flat `pipeline_name`, and the applicant detail view
renders it (`InterviewPage.tsx:189`, `ApplicantDetailDrawer.tsx:988`), but only
the **list** endpoint built it — the detail / create / update / advance / regress
endpoints returned the raw `ProspectiveMember` ORM row, which has a `pipeline`
relationship but no flat `pipeline_name` attribute, so it always serialized null
and the "Pipeline:" line was silently omitted (a guarded degrade, the DOC2-1
pattern). **Fixed** at the single choke point: `get_prospect` eager-loads
`pipeline`, and every one of those five paths returns through it
(`create/update/complete_step` via `return await self.get_prospect(...)`, advance/
regress fetch through it), so `get_prospect` now sets
`prospect.pipeline_name = prospect.pipeline.name` (free — relationship already
loaded; non-mapped attribute, never persisted).

### MP2-2 — LOW — `referred_by` reassignable to a foreign user (XC-1) — ✅ FIXED

`ProspectUpdate` exposes `referred_by` (a `User` FK), but the update
protected-set listed the **relationship** name `referrer`, not the **column**
`referred_by` — so the setattr loop stored a client-supplied referrer id
unvalidated, and `create_prospect` did the same. Dangling-only (never
name-projected; the prospect keeps its own `organization_id`), so no disclosure —
but a clean XC-1 gap. **Fixed** with an in-org `is_in_org(User, …)` check on both
create and update (mirrors MP-2's `pipeline_id` validation). Closes one entry from
the BXC-1 dangling batch.

### Latent 500 corrected (MM-1 class)

Wiring the `referred_by` guards exposed that **neither the `create_prospect` nor
the `update_prospect` endpoint wrapped `ValueError`** — so MP-2's existing
`raise ValueError("Invalid pipeline")` was already surfacing as a **500, not the
intended 400**, and the new referrer guards would have too. Both endpoints now
convert `ValueError → 400` via `safe_error_detail` (matching the module's other
write endpoints), which also corrects MP-2's error contract. The stray
function-local `safe_error_detail` import was promoted to a module import.

---

## Pass 1 (2026-08-06)

**Prefix:** `MP2` · **Iteration:** B9 · **Reviewed:** 2026-08-06

**Backend:** `endpoints/membership_pipeline.py` (1,763 L),
`services/membership_pipeline_service.py` (4,236 L),
`models/membership_pipeline.py`, `schemas/membership_pipeline.py`
**Frontend:** `modules/prospective-members`
**Prior audit:** `docs/module-audit/membership-pipeline.md` (iteration 9) — MP-1/2/3/4
fixed; MP-5 (XC-1 create paths), MP-6 (sensitive PII in the activity log), MP-7
(inconsistent PII disclosure on the two "existing member" paths) left open.

This module handles **sensitive applicant PII** (DOB, home address, background
checks, government IDs), so the two PII-shaped findings (MP-6, MP-7) got the
weight, not just the integrity one (MP-5).

---

## Scope

Tier B: the three open findings plus the broader lens. The security pass had
already established that tenant isolation is solid here — **every by-id read/write
is org-scoped or resolved through an org-scoped parent, and XC-3 does not occur**
— and that file upload/download is a model implementation (magic-byte MIME, UUID
paths, traversal guard). Re-verified, not re-derived.

## Findings

### MP-5 — LOW — Create paths stored client ids without validation (XC-1, integrity) — ✅ FIXED

Three write paths accepted a client-supplied `step_id`/`pipeline_id` and
persisted it with no consistency check. All resolve the prospect org-scoped
first, so there was **no cross-org disclosure** — the risk was a dangling /
mis-attributed FK inside the caller's own tenant. `MembershipPipelineStep` has no
`organization_id` column (it is scoped through its pipeline), so the fix
validates each id against the **prospect's own pipeline steps** (already
eager-loaded by `get_prospect`) rather than the shared `assert_in_org` helper:

- **`complete_step`** — previously created a `ProspectStepProgress` even when the
  `step_id` wasn't in the prospect's pipeline (the `if step:` guard skipped
  validation but the write happened regardless). Now rejects an unknown
  `step_id` with `ValueError` (→ 400) before writing. The redundant second
  step-lookup later in the method was removed (the first binding is unchanged).
- **`create_election_package`** — `pipeline_id`/`step_id` were stored verbatim.
  Now: a `pipeline_id` differing from the prospect's is validated in-org via the
  org-scoped `get_pipeline`, and `step_id` must belong to the effective
  pipeline's steps.
- **`create_interview`** — `step_id` was stored verbatim. Now validated against
  the prospect's pipeline steps.

All three are `prospective_members.manage`-gated, so this is data-integrity
hardening. Endpoints already convert `ValueError → 400`.

### MP-6 — LOW — Sensitive PII persisted in the activity log — ✅ FIXED (data-minimized)

`update_prospect` recorded the old→new **values** of every changed field into
`ProspectActivityLog.details`, which `GET /prospects/{id}/activity` returns to any
`prospective_members.view` user (compounding the reach MP-1 closed). So editing a
prospect's date of birth or home address wrote the plaintext old and new DOB /
street / city / state / zip into a log table read by a wider audience than needs
it.

**Fix:** for a small allowlist of sensitive fields — `date_of_birth`,
`address_street`, `address_city`, `address_state`, `address_zip` — the log now
records `{"changed": True}` instead of `{"from": ..., "to": ...}`. The audit trail
still shows _that_ the field changed, by whom, and when (the accountability the
log exists for) without persisting the PII value. Non-sensitive fields (name,
status, notes, membership type) keep the full old→new record.

**Note (accepted, not changed):** `create_prospect`'s endpoint also writes the
applicant email into a `log_audit_event` (`event_data.prospect_email`). That is
the **security audit log** — a separate, access-restricted store where an email is
a reasonable identifier for a "prospect created" event — not the member-readable
activity log. Left as-is.

### MP-7 — LOW — Inconsistent PII disclosure on the two "existing member" paths — ✅ FIXED

`POST /prospects/check-existing` deliberately strips its matches to
`status` + `match_type` (with a comment saying so), but `POST /prospects`
returned the full archived-member match — **`name`, `email`, `user_id`** in a
structured `existing_member_match` object plus a `reactivate_url` embedding the
`user_id` — in the 409 body, contradicting the sibling endpoint's stated intent.

**Two things made this an easy, safe fix rather than a product debate:**

1. The frontend **never consumes** `existing_member_match` or `reactivate_url`
   (confirmed by grep across `modules/prospective-members`). It runs its own
   `check-existing` pre-check and, on the 409, only toasts the message.
2. The structured dict body was in fact **mis-rendering**: `toAppError` has no
   dict-`detail` branch, so `data.detail || data.message` resolved to the dict
   object and the toast would show `[object Object]`.

**Fix:** the 409 now returns a plain-string `detail` (the human-readable
message), dropping the `user_id`/`reactivate_url` disclosure and repairing the
toast in one change. The message still names the matched member so leadership can
recognize who to reactivate.

**Flagged (residual, product call):** the message can echo an archived member's
**stored** name/email, which — when the match is by name — may be an email the
caller didn't supply. This is the same disclosure `check-existing` chose to
avoid; whether to generalize the message ("an archived member matches — check the
archived list") is a product decision about how much leadership should see.
Recorded in `KNOWN_LIMITATIONS.md`.

## Verified good ✅ (re-confirmed)

- MP-1 (applicant-PII reads no longer reachable with generic `members.view`),
  MP-2 (`create_prospect` validates `pipeline_id` in-org), MP-3/MP-4 (leave
  `user_id` + date-order) all remain fixed.
- Tenant isolation solid across all 62 endpoints; `_do_transfer` copies within
  the prospect's org and validates roles; file download org-scoped + traversal
  guarded; search LIKE escaped.

## Duplication

The step-membership check (`any(str(s.id) == str(step_id) for s in
pipeline.steps)`) now appears in three methods. It is a one-liner over an
already-loaded collection; extracting a helper is optional and was not done to
keep the fix minimal. Recorded as a minor future cleanup, not a defect.

## Dead code

None new. The MP-7 fix removed a genuinely-unused response shape
(`existing_member_match`/`reactivate_url`).

## Documentation

`docs/module-audit/membership-pipeline.md` updated: MP-5/MP-6/MP-7 moved to
resolved with the same reasoning. `check-existing`'s stripping comment is now
accurate for both endpoints.

## Future development

1. **MP-7 message generalization** — the one residual product call: decide
   whether the 409 message should name the archived member at all.
2. **Extract the step-in-pipeline check** into a small private helper if a fourth
   caller appears.

## Completion gate

| Check                                 | Result                                                                                                                                                                                                                                                               |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flake8` (both modified files)        | ✅ 0 violations                                                                                                                                                                                                                                                      |
| `black --check` (both modified files) | ✅ unchanged                                                                                                                                                                                                                                                         |
| `tsc --noEmit`                        | ✅ n/a — no frontend change                                                                                                                                                                                                                                          |
| `eslint`                              | ✅ n/a — no frontend change                                                                                                                                                                                                                                          |
| backend tests                         | ✅ `test_membership_pipeline_flow` + `test_integrations_webhook_advance`: 5 passed, 12 DB-fixture errors (no MySQL — known sandbox limit). No logic failures. All existing `complete_step` tests pass valid in-pipeline steps, so the MP-5 guards don't affect them. |
