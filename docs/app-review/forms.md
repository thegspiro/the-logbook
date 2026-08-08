# Application Review — Forms (Tier B)

**Prefix:** `FORM2` · **Iteration:** B13 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-08 (pass 2)

**Backend:** `endpoints/forms.py` (752 L, 21 endpoints), `public/forms.py` (209 L),
`services/forms_service.py` (2,290 L), models `models/forms.py`
**Frontend:** `modules/forms` + `PublicFormPage`
**Prior audit:** `docs/module-audit/forms.md` (iteration 13) — FORM-1/2 (HIGH
cross-org integration writes) and FORM-3 fixed; FORM-4 (definition text unescaped),
FORM-5 (require_authentication not enforced), FORM-6 (required = presence-only)
left open.

---

## Pass 2 (2026-08-08, against freshly-merged main) — no code change

Run after the 144-commit merge. The merge brought forms' own pass-1 work
(`2e8e51e`: FORM-6/FORM-7) plus three migration commits that renamed/reconciled
the forms index set and gave NOT-NULL columns a `server_default` so raw inserts
work on fresh installs (`sort_order server_default="0"`). Re-verified FORM-6
(`_is_empty_value`) and FORM-7 (`safe_error_detail` on all 14 client-facing
returns) hold on the merged tree, then applied the six pass-2 lenses. **All clean —
nothing to fix.**

- **Update-bypass:** all three update paths (`update_form`, `update_field`,
  `update_integration`) are fed `model_dump(exclude_unset=True)` from typed
  schemas, so their `setattr` loops can't inject `id`/`organization_id`/
  `created_by`. Neither `FormUpdate` nor `FormIntegrationUpdate` exposes an FK.
- **FK validation on the integration surface:** `_validate_field_mappings`
  rejects any `field_mappings` key that isn't a field id on the form
  (`bad_ids` check against `form.fields`), so a mapping can't reference a foreign
  field. The cross-module submission writes (member/item/event) remain gated by
  FORM-1/2's `_entity_in_org`.
- **No projection read-leak / MS2-4:** forms is Pattern-B clean —
  `organization_name`/`submitter_name`/`form_name` are populated at the boundary
  (`public/forms.py:133`, `forms_service.py:939`); no eager-loaded FK leaks a
  cross-org name.
- **No latent-500:** `_process_integrations` wraps every processor call in
  `try/except Exception`, capturing failures (incl. the `_reassign_prospect_pipeline`
  `ValueError`, `forms_service.py:1810`) into an internal `results` dict it never
  returns (`-> None`). Every public service method returns a
  `(result, safe_error_detail(e))` tuple and every endpoint guards `if error`.
- **Cross-org write:** every field/integration/submission mutation resolves
  through the org-scoped `get_form_by_id` (or a query filtering
  `organization_id`); forms carry `organization_id` directly. XC-3 clean.

**Residual (unchanged, LOW):** `FormFieldUpdate.condition_field_id` is stored via
`update_field`'s blind `setattr` without checking the referenced field belongs to
the same form. It is a plain `String(36)` (not a DB FK), is set by a `forms.manage`
user on their own org's form, and is **consumed only client-side** for conditional
field visibility — the server never dereferences it to fetch data, so a
dangling/foreign value degrades to a no-op toggle, never a leak or crash. Recorded
under BXC-1 in `CROSS-CUTTING.md`; not fixed here because a within-form
same-form check risks rejecting the builder's legitimate two-phase save
(fields persisted first, conditions wired second) for no security gain.

**No code changed.** The public-submission surface and integration writes are
mature (FORM-1/2/3/6/7 done); the lens verifications are the deliverable.

---

## Pass 1 (2026-08-06)

## Scope

Tier B: the open findings plus the broader lens. The security pass had already
established the public-submission surface is a model implementation (slug regex,
rate limits + lockouts, honeypot fake-success, org-from-form, stored-XSS escaped
at storage) and that the pipeline/equipment/event processors are now org-safe
after FORM-1/2 — re-confirmed, not re-derived. Two fixes applied; the two
product/DiD items stay flagged.

## Findings

### FORM-7 — LOW-MED — Raw exception text leaked to the (unauthenticated) submitter — ✅ FIXED

14 service methods caught `Exception` and returned `str(e)`, which the endpoints
surface directly (`raise HTTPException(detail=error)`). On the **public,
unauthenticated** submit path (`submit_public_form` → `public/forms.py` line 194),
a DB `IntegrityError`/`OperationalError` therefore returned raw SQL and column
names to anonymous callers — a worse instance of the NOTIF-2 / SF-2 class because
the audience is the whole internet. **Fix:** all 14 client-facing tuple returns
now use `safe_error_detail(e)` (generic client message + server-side ERROR log).
The 5 remaining `str(e)` sites are integration-processor result dicts captured
into a local `results` map that `_process_integrations` **does not return to the
client** (it is `-> None`); left as internal diagnostics, noted below.

### FORM-6 — LOW — Required-field check was presence-only — ✅ FIXED

Both submit paths validated a required field with `str(field.id) not in data`, so
a key present with `""`, whitespace, or an empty list satisfied "required" and was
then coerced to `""`. **Fix:** a new `_is_empty_value` helper treats a present key
holding an empty/whitespace string or an empty list/dict as missing, while `0` and
`False` remain valid answers for number/boolean fields. Applied to both the admin
and public required-field loops. **9 unit tests added** (`TestIsEmptyValue`)
pinning the empty-vs-real-answer boundary (DB-free, since the helper is pure).

### FORM-5 — LOW — `require_authentication` / `allow_multiple_submissions` not enforced — 🚩 FLAGGED (needs product decision)

`get_form_by_slug` still gates on `is_public` + `PUBLISHED` only. A form marked
both `is_public=True` and `require_authentication=True` still accepts anonymous
submissions, and `allow_multiple_submissions=False` isn't enforced server-side
(only the per-IP daily cap). Re-confirmed the logic mismatch; unchanged because
"public + require_authentication" needs a product decision on intended semantics
(is it a contradiction to reject, or does it mean "public listing, authed
submit"?). Recorded in `KNOWN_LIMITATIONS.md`.

### FORM-4 — LOW — Form-definition text stored unescaped — 🚩 FLAGGED (do NOT escape at storage)

Field `label`/`placeholder`/`help_text`/option labels are stored raw (set by a
`forms.manage` user) and returned raw by the public GET. Re-verified the React
renderer uses no `dangerouslySetInnerHTML`, so it renders as escaped text — no
stored XSS today. **Explicitly not "fixed" by escaping at storage:** because the
content is text-rendered, HTML-escaping it at storage would double-escape on
display (a label `Rank & Serial` would show `Rank &amp; Serial`). The correct
hardening is a CSP or escape-at-render-only-if-HTML — left as flagged
defense-in-depth against a future renderer change.

## Verified good ✅ (re-confirmed)

- FORM-1/FORM-2 (`_entity_in_org` validates `member_id`/`item_id`/`event_id` in
  the submission's org before any integration write; RSVP dup-check org-scoped),
  FORM-3 (`MULTISELECT` option validation) all hold.
- Public slug regex + rate limits + honeypot intact; submitted values escaped at
  storage; LIKE wildcards escaped; every by-id path org-scoped; XC-3 clean.

## Dead code / internal

The 5 `{"success": False, "error": str(e)}` processor dicts are internal
diagnostics (not client-facing). Sanitizing them is optional DiD; left to keep the
change focused on the reachable leak.

## Documentation

`docs/module-audit/forms.md` updated: FORM-6 resolved, FORM-7 added, FORM-4/5 clarified.

## Future development

1. **FORM-5** — decide "public + require_authentication" semantics, then enforce
   (and enforce `allow_multiple_submissions` server-side).
2. **FORM-4** — CSP / render-time escaping if a future renderer emits HTML.
3. Optionally sanitize the internal processor `str(e)` dicts for full consistency.

## Completion gate

| Check | Result |
|-------|--------|
| `flake8` (service + test) | ✅ 0 violations |
| `black --check` | ✅ unchanged |
| `tsc --noEmit` | ✅ n/a — no frontend change |
| backend tests | ✅ `test_forms_service` **9 passed** (new); forms-related selection 56 passed (DB-fixture errors are unrelated `-k form` false matches — plat**form**/**form**at). |
