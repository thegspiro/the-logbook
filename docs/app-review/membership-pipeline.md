# Application Review — Membership Pipeline (Tier B)

**Prefix:** `MP2` · **Iteration:** B9 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-06 (pass 2), 2026-08-09 (pass 3), 2026-08-09 (pass 4)

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
still shows *that* the field changed, by whom, and when (the accountability the
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

| Check | Result |
|-------|--------|
| `flake8` (both modified files) | ✅ 0 violations |
| `black --check` (both modified files) | ✅ unchanged |
| `tsc --noEmit` | ✅ n/a — no frontend change |
| `eslint` | ✅ n/a — no frontend change |
| backend tests | ✅ `test_membership_pipeline_flow` + `test_integrations_webhook_advance`: 5 passed, 12 DB-fixture errors (no MySQL — known sandbox limit). No logic failures. All existing `complete_step` tests pass valid in-pipeline steps, so the MP-5 guards don't affect them. |
