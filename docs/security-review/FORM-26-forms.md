# Security Review — Forms

**Prefix:** `FORM` · **Iteration:** 26 · **Reviewed:** 2026-08-27 (pass 1), 2026-08-31 (pass 2) · **PR:** [#1908](https://github.com/thegspiro/the-logbook/pull/1908) (pass 1), [#2085](https://github.com/thegspiro/the-logbook/pull/2085) (pass 2)

---

## Pass 2 (2026-08-31) — `integration_result` leaked raw exception text to the client

**Backend:** `app/api/v1/endpoints/forms.py` (768 L, 22 endpoints, unchanged
since pass 1), `app/api/public/forms.py` (236 L, unchanged),
`app/services/forms_service.py` (2,601 L, unchanged size — six sites patched
in place), `app/models/forms.py` (347 L), `app/schemas/forms.py` (424 L) —
both read in full this pass, unchanged since pass 1.
**Frontend:** `components/forms/SubmissionViewer.tsx`, `pages/FormsPage.tsx` —
read to confirm exploitability of the finding below; not modified.
**Migrations:** none.

### Scope

Full end-to-end re-read of `forms.py`, `public/forms.py`, `forms_service.py`,
`models/forms.py`, and `schemas/forms.py` — every route, every service method,
the full model and schema layer (not sampled). File sizes match pass 1 exactly
(768 L / 236 L / 2,601 L / 347 L / 424 L), which confirms nothing in this
module has changed since PR #1908 merged four days ago. Re-verified every
pass-1 finding and every still-open module-audit/app-review finding against
current code — all hold, no drift. One new finding, from tracing where
`integration_result` (not the `(result, error)` tuple FORM-7 already covers)
actually surfaces.

### Route inventory (re-verified, unchanged from pass 1)

All 22 `endpoints/forms.py` routes carry either
`require_permission("forms.view")` or `require_permission("forms.manage")`,
except `submit_form` and `GET /member-lookup`, which use bare
`get_current_user` — any authenticated org member, by design: submitting a
form and looking up a member for a form's `member_lookup` field both need only
being signed in, not an admin permission. Both `public/forms.py` routes
(`GET /{slug}`, `POST /{slug}/submit`) are intentionally unauthenticated,
gated by slug regex (12 hex, anti-traversal) + per-IP rate limiting
(60/min view, 10/min submit, with lockouts) + honeypot fake-success + (submit
only) CAPTCHA. Unchanged from pass 1.

### Findings

#### FORM-9 — LOW-MED — Integration-processor exceptions leaked raw driver/exception text via `integration_result` — ✅ FIXED

**What:** three prior review passes (module-audit iteration 13, app-review
pass 1, and this doc's own pass 1) all classified the six
`except Exception as e:` sites inside `_process_integrations` and its four
`_process_*` integration handlers as "internal diagnostics... not
client-facing", on the reasoning that `_process_integrations` itself returns
`None`. That reasoning addressed the wrong return value. The dict those
`except` blocks build is written to `submission.integration_result` (a JSON
column), and `FormSubmissionResponse` — the `response_model` on `submit_form`,
`get_submission`, `list_submissions`, and
`reprocess_submission_integrations` — declares
`integration_result: Optional[Dict[str, Any]]` and serializes that ORM
attribute straight into the JSON response body. Confirmed this is actually
rendered, not merely reachable: `SubmissionViewer.tsx:395-396` prints
`result.error` verbatim on screen for any `forms.manage` admin viewing a
submission, and `submit_form`'s own response — no elevated permission
required, any authenticated org member can call it — carries the same field
in its JSON body even though the current SPA does not render it back to the
submitter after posting.
**Where:** `app/services/forms_service.py` —
`_process_integrations` (two `except` blocks, one per direct/legacy
integration path, originally lines ~1387 and ~1425),
`_process_membership_interest` (~1854, message field),
`_process_equipment_assignment` (~2187), `_process_event_registration`
(~2301), `_process_event_request` (~2485).
**Failure scenario:** a form has an `equipment_assignment` integration. A
member submits it, and something in the write path throws (a DB constraint
error inside `InventoryService.assign_item_to_user`, or any other exception —
the same applies to the RSVP write in `_process_event_registration` and the
`EventRequest` insert in `_process_event_request`). The raw exception text —
potentially naming a table or column — lands in
`submission.integration_result["equipment_assignment"]["error"]` and is
returned verbatim: immediately, in the `submit_form` response to the
submitting member, and later to any `forms.manage` admin who opens the
submission in `SubmissionViewer`.
**Impact:** same disclosure class as FORM-7 (raw internals reaching a
client), reached through a field FORM-7's own fix never touched. Audience is
broader on the write side (any authenticated org member via `submit_form`)
and narrower on the read side (`forms.manage` admins via
`get_submission`/`list_submissions`/`reprocess`). Never reaches an anonymous
caller — `PublicFormSubmissionResponse`, the public submit endpoint's
response schema, does not carry `integration_result` at all.
**Fix:** all six sites now build the error text with `safe_error_detail(e)`
(already imported in this file for the FORM-7 fix) instead of `str(e)` / an
f-string interpolating `e`. `safe_error_detail` passes through only a
"safe"-looking `ValueError`/`PermissionError` message and returns a generic
fallback for everything else — a `RuntimeError`/`IntegrityError`/
`OperationalError`, the realistic failure modes here, always gets the
fallback — while still logging the real exception server-side either way, so
nothing is lost for debugging.

**Correction (2026-08-31, on PR #2085 itself):** Codex caught that this fix
missed a seventh site with the same shape. `_process_equipment_assignment`
doesn't only reach the `except Exception as e:` block above — its normal
success path also reads `assignment, error = await
InventoryService.assign_item_to_user(...)`, and that method (`inventory_
service.py`) never raises on failure; it catches internally and returns
`(None, str(e))`. The `if error: return {"success": False, "error": error}`
branch that follows returned that raw string untouched, bypassing the
`except`-block sanitizer entirely because no exception ever propagates up to
it. Since `error` here is already a plain string (not an `Exception`
instance), `safe_error_detail(e)` doesn't apply — fixed by routing it through
`sanitize_error_message()` (`app/core/utils.py`), the sibling helper this
codebase already uses for exactly this shape (`inventory.py`'s own
`assign_item_to_user` caller does the same). Added
`test_equipment_assignment_processor_sanitizes_returned_error`, verified to
fail on reintroduction, alongside the original except-block test.

### Verified good ✅ (re-confirmed this pass, unchanged since PR #1908)

- FORM-1/FORM-2 (`_entity_in_org` validates `member_id`/`item_id`/`event_id`
  against the submission's org before any cross-module integration write) —
  intact.
- FORM-3 (`MULTISELECT` option-membership validation), FORM-6
  (`_is_empty_value` — presence isn't enough, a required field needs a real
  value), FORM-8 (`apply_updates` on `update_form`/`update_field`/
  `update_integration`) — all intact.
- FORM-5 (`require_authentication`/`allow_multiple_submissions` enforced on
  public submit, cross-org 404 for an authenticated foreign-org submitter, a
  locked race-safe duplicate check via `SELECT ... FOR UPDATE` on the form
  row) — intact, exactly as pass 1 described.
- Tenant isolation (XC-3): every by-id form/field/integration/submission
  read/update/delete resolves through the org-scoped `get_form_by_id` or
  filters `organization_id` directly — unchanged.
- LIKE search (`get_forms`/`search_members`): both use `like_pattern()` with
  `escape=LIKE_ESCAPE_CHAR` (Pitfall #25) — unchanged.
- Public surface: slug regex, rate limits + lockouts, honeypot fake-success,
  `member_lookup` stripped from the public GET, org always derived from the
  form (never client input), CAPTCHA on submit — unchanged.
- Schema layer (`schemas/forms.py`, read in full this pass): `_enum_check`
  rejects an out-of-set `category`/`status`/`field_type`/`target_module`/
  `integration_type` with a 422 rather than letting it reach the ENUM column
  (FORM2-1) — unchanged.
- Models (`models/forms.py`, read in full this pass): the one
  `ondelete="SET NULL"` column (`FormSubmission.submitted_by`) is
  `nullable=True` (Pitfall #2); every JSON-column write in the service is a
  full-value reassignment (`integration.field_mappings = new_mappings`,
  `submission.integration_result = results`, `progress.action_result = {...}`)
  rather than a mutated shared reference behind a shallow copy — Pitfall #12
  does not apply anywhere in this module.

### Still open — no product decision, unchanged

- FORM-4 (form-definition text stored unescaped, safe today because the React
  renderer never uses `dangerouslySetInnerHTML`) — re-verified, still
  deliberately flagged defense-in-depth rather than fixed (escaping at
  storage would double-escape at render).
- BXC-1 (`FormField.condition_field_id` — a soft, never-dereferenced
  client-side visibility reference with no same-form check) — re-verified,
  still a correctness-only residual.

### Schema & migration notes

None — the fix is a `str(e)` → `safe_error_detail(e)` substitution at six
call sites, no model or column change.

### Guard tests added

`tests/test_forms_service.py::TestIntegrationProcessorsSanitizeErrors` (3
tests) — asserts a processor exception never reaches `integration_result`
verbatim. One exercises the real `_process_equipment_assignment` code path
(mocks only `InventoryService.assign_item_to_user`, not the processor
itself, so the method's own `_entity_in_org` checks and dict-building run for
real); two exercise `_process_integrations`' own direct- and legacy-path
`except` blocks directly. Verified to fail on reintroduction: reverting any
one `safe_error_detail(e)` back to `str(e)` fails the corresponding test with
the injected sensitive string visible in the assertion diff; restoring it
passes.

### Completion gate (pass 2)

| Check                                                                 | Result                                                                                                |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                                         | clean                                                                                                 |
| `black --check app/ tests/ alembic/`                                  | clean (1 file needed `black` once, applied; clean on re-check)                                        |
| `isort --check-only app/ tests/ alembic/`                             | clean (isort 8.0.1 present, matches CI's pin)                                                         |
| `python3 scripts/validate_migrations.py --strict`                     | PASSED — 394 revisions, single head, no migration this pass                                           |
| backend tests, scope (forms/event_request/membership/inventory/event) | 1273 passed, 1 skipped (pre-existing, unrelated — optional `pywebpush` dep)                           |
| backend tests, full suite                                             | 9303 passed, 22 skipped (pre-existing environment-only skips: Docker, pywebpush, API-contract opt-in) |
| `tsc --noEmit` / `eslint .`                                           | n/a — no frontend file changed (`SubmissionViewer.tsx` read only, to confirm exploitability)          |

---

## Pass 1 (2026-08-27)

**PR:** [#1908](https://github.com/thegspiro/the-logbook/pull/1908)

**Backend:** `app/api/v1/endpoints/forms.py` (768 L, 22 endpoints),
`app/api/public/forms.py` (236 L, public view/submit), `app/services/forms_service.py`
(2,601 L), models `app/models/forms.py`.
**Frontend:** not reviewed this pass — backend only, per rotation scope.
**Migrations:** none — every fix this iteration is service-layer only.

### Scope

This module already carries thorough prior coverage — a module audit
(iteration 13, FORM-1 through FORM-7) and a 4-pass app-review
(`FORM2-1`/`FORM2-2`, plus re-verification passes). Read `forms.py`,
`public/forms.py`, and `forms_service.py` directly in full (moderate total
size, ~3,600 L, with deep existing coverage — not fanned out to parallel
agents). Re-verified every prior finding against current code and focused
extra attention on what's grown since: `forms.py` 752→768 L (+16, the new
`reprocess_submission_integrations` endpoint), `public/forms.py` 209→236 L
(+27, the `require_authentication`/cross-org submitter checks below),
`forms_service.py` 2,290→2,601 L (+311, primarily a new `event_request`
integration type and its supporting label maps/processor).

### Verified good ✅ (re-confirmed, not re-derived)

- **FORM-1/FORM-2** (`_entity_in_org` validates `member_id`/`item_id`/`event_id`
  against the submission's org before any cross-module integration write):
  intact in `_process_equipment_assignment` and `_process_event_registration`.
  `_process_event_registration` also gained an attendance-finalization check
  since the last pass (blocks registering to a closed event via the form path)
  — reviewed, correctly org-scoped, not a security-relevant change.
- **FORM-3** (`MULTISELECT` option-membership validation): intact in
  `_sanitize_submission_data`.
- **FORM-6** (`_is_empty_value` — a required field needs a real value, not just
  a present key): intact, used identically in both `submit_form` and
  `submit_public_form`.
- **FORM-7** (`safe_error_detail` on all client-facing service returns, so the
  unauthenticated public submit path never leaks raw SQL/driver text): intact
  across every method reviewed.
- **FORM2-1** (enum fields validated via `_enum_check`, not raw `str`): intact
  in the schema layer (not re-read this pass — no growth there).
- **Tenant isolation**: every by-id form/field/integration/submission
  read/update/delete still resolves through the org-scoped `get_form_by_id`
  or filters `organization_id` directly (`get_submission_by_id`,
  `get_submissions`, `update_integration`, `delete_integration`). XC-3 clean.
- **`_validate_field_mappings`**: still rejects any `field_mappings` key that
  isn't a real field id on the form, unchanged.
- **LIKE search**: `get_forms`/`search_members` still use `like_pattern()` with
  `escape=LIKE_ESCAPE_CHAR` (Pitfall #25) throughout.
- **Public surface**: slug regex (12 hex, anti-traversal), 60/min view + 10/min
  submit rate limits with lockouts, honeypot fake-success, `member_lookup`
  stripped from the public GET, org derived from the form (never client
  input) — all unchanged.

### FORM-5 — re-verified as already resolved (doc correction, not a new fix)

Every prior pass (module audit through app-review pass 4) left FORM-5 flagged:
_"`require_authentication`/`allow_multiple_submissions` not enforced on public
submit — needs a product decision."_ Re-reading the current code, both are now
correctly enforced:

- `public/forms.py`'s `submit_public_form` endpoint rejects (401) an anonymous
  submission when the form requires authentication **or** disallows repeat
  submissions (the latter needs a stable identity to check against — an IP or
  client-supplied email is trivially bypassed, which is exactly the reasoning
  the code comment gives).
- A new cross-org guard sits alongside it: an **authenticated** submitter whose
  own org doesn't match the form's org gets a 404 (not a 403, so a foreign-org
  member can't distinguish "form doesn't exist" from "form belongs to another
  org").
- `forms_service.py`'s `submit_public_form` enforces `allow_multiple_submissions
= False` server-side with a **locked, race-safe** duplicate check (`SELECT
... FOR UPDATE` on the form row before checking for a prior submission by the
  same `submitted_by` — the Pitfall #27 shape, already correctly applied here).

This is a real product decision that was made and shipped correctly since the
last review pass — not something this iteration did. `docs/module-audit/forms.md`
and `docs/app-review/forms.md` both still listed FORM-5 as open (only
`KNOWN_LIMITATIONS.md` had already been corrected, 2026-08-17); both updated
in this pass to mark it resolved and point here.

### New surface reviewed (event_request integration + reprocess endpoint)

- **`event_request` integration type** (`_process_event_request`, new since
  the last pass): creates an `EventRequest` record for coordinator review.
  Unlike the equipment/event-registration integrations, it has **no
  submitter-supplied FK to another module's row** — every field is either
  free text (contact name/email/phone, description) or server-derived
  (`organization_id` from the form's own org). No FORM-1/FORM-2-shaped
  cross-org write risk exists here structurally. `int(mapped_data["audience_size"])`
  raising `ValueError` on a non-numeric value is caught by the method's own
  `except Exception` and surfaces only in the internal (never client-returned)
  `results` dict — same class FORM-7 already covers.
  **Correction (pass 2, 2026-08-31):** the "never client-returned" half of
  this note was wrong — see FORM-9 above. The `results` dict is persisted to
  `submission.integration_result`, which the response schema does return to
  the client. The `int()` cast itself was never the risk (it fails closed,
  caught by the surrounding `except`); the exception text it produced was.
- **`reprocess_submission_integrations`** (new endpoint + service method):
  re-runs `_process_integrations` for an existing submission. The submission
  fetch filters both `id` and `organization_id`; integration processing reuses
  the same `_entity_in_org`-guarded processors as the original submit path —
  no separate validation to get wrong.

### Findings

#### FORM-8 — LOW — Three update methods used blind `setattr` loops instead of `apply_updates` — ✅ FIXED

**What:** `update_form`, `update_field`, and `update_integration` all applied
their update payload with a hand-rolled `for key, value in data.items():
setattr(obj, key, value)` loop. All three endpoints already call
`model_dump(exclude_unset=True)`, so an explicit null against a NOT NULL
column (`Form.name`, `FormField.label`/`field_type`,
`FormIntegration.target_module`/`integration_type`) reached `commit()` and
raised an unhandled `IntegrityError` — caught by the method's own
`except Exception`, so the client saw a generic `safe_error_detail()` message
rather than a crash, but a confusing one ("something went wrong" instead of
"name cannot be empty").
**Where:** `app/services/forms_service.py` — `update_form`, `update_field`,
`update_integration`.
**Fix:** all three now route through `apply_updates`, matching this
rotation's established pattern — a null against a NOT NULL column now returns
a specific, fast-failing 400 instead of reaching the database at all. Guard
tests added for all three (clears a nullable field; rejects null against the
NOT NULL column).

### Confirmed still open — nothing needing a product decision

- **FORM-4** (form-definition text stored unescaped, safe today because the
  React renderer never uses `dangerouslySetInnerHTML`) — re-verified
  unchanged, still deliberately not "fixed" by escaping at storage (would
  double-escape on display). Remains flagged defense-in-depth.
- **BXC-1** (`FormField.condition_field_id` — a soft, never-dereferenced
  client-side visibility reference with no same-form check) — re-verified
  unchanged, still a correctness-only residual per the prior pass's reasoning
  (rejecting it wrong would break legitimate two-phase form-builder saves).
- **MAIL-4-shaped policy items** — n/a to this module.

### Schema & migration notes

None — every fix is service-layer only, no model or column changes.

### Guard tests added

- `tests/test_forms_service.py`: `TestUpdateForm`, `TestUpdateField`,
  `TestUpdateIntegration` (new) — each asserts a nullable field clears on an
  explicit null and a NOT NULL column rejects one with a clean error rather
  than an unhandled exception.

### Completion gate (pass 1)

| Check                                                 | Result                  |
| ----------------------------------------------------- | ----------------------- |
| `flake8` (changed files)                              | clean                   |
| `black --check` (changed files)                       | clean                   |
| `isort --check-only` (changed files)                  | clean                   |
| `python3 scripts/validate_migrations.py --strict`     | PASSED (no migrations)  |
| backend tests, scope (forms/event-request/membership) | 64/64 passed            |
| backend tests, full suite                             | 8922 passed, 22 skipped |
