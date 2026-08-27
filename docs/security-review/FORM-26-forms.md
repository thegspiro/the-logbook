# Security Review — Forms

**Prefix:** `FORM` · **Iteration:** 26 · **Reviewed:** 2026-08-27 · **PR:** (pending)

**Backend:** `app/api/v1/endpoints/forms.py` (768 L, 22 endpoints),
`app/api/public/forms.py` (236 L, public view/submit), `app/services/forms_service.py`
(2,601 L), models `app/models/forms.py`.
**Frontend:** not reviewed this pass — backend only, per rotation scope.
**Migrations:** none — every fix this iteration is service-layer only.

---

## Scope

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

## Verified good ✅ (re-confirmed, not re-derived)

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

## FORM-5 — re-verified as already resolved (doc correction, not a new fix)

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

## New surface reviewed (event_request integration + reprocess endpoint)

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
- **`reprocess_submission_integrations`** (new endpoint + service method):
  re-runs `_process_integrations` for an existing submission. The submission
  fetch filters both `id` and `organization_id`; integration processing reuses
  the same `_entity_in_org`-guarded processors as the original submit path —
  no separate validation to get wrong.

## Findings

### FORM-8 — LOW — Three update methods used blind `setattr` loops instead of `apply_updates` — ✅ FIXED

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

## Confirmed still open — nothing needing a product decision

- **FORM-4** (form-definition text stored unescaped, safe today because the
  React renderer never uses `dangerouslySetInnerHTML`) — re-verified
  unchanged, still deliberately not "fixed" by escaping at storage (would
  double-escape on display). Remains flagged defense-in-depth.
- **BXC-1** (`FormField.condition_field_id` — a soft, never-dereferenced
  client-side visibility reference with no same-form check) — re-verified
  unchanged, still a correctness-only residual per the prior pass's reasoning
  (rejecting it wrong would break legitimate two-phase form-builder saves).
- **MAIL-4-shaped policy items** — n/a to this module.

## Schema & migration notes

None — every fix is service-layer only, no model or column changes.

## Guard tests added

- `tests/test_forms_service.py`: `TestUpdateForm`, `TestUpdateField`,
  `TestUpdateIntegration` (new) — each asserts a nullable field clears on an
  explicit null and a NOT NULL column rejects one with a clean error rather
  than an unhandled exception.

## Completion gate

| Check                                                 | Result                  |
| ----------------------------------------------------- | ----------------------- |
| `flake8` (changed files)                              | clean                   |
| `black --check` (changed files)                       | clean                   |
| `isort --check-only` (changed files)                  | clean                   |
| `python3 scripts/validate_migrations.py --strict`     | PASSED (no migrations)  |
| backend tests, scope (forms/event-request/membership) | 64/64 passed            |
| backend tests, full suite                             | 8922 passed, 22 skipped |
