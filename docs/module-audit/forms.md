# Module Audit — Forms

**Files:** `app/api/v1/endpoints/forms.py` (752 L, 21 endpoints),
`app/api/public/forms.py` (209 L, public view/submit),
`app/services/forms_service.py` (2,274 L), models `app/models/forms.py`,
frontend `modules/forms` + `PublicFormPage`.
**Audited:** iteration 13 (public-submission surface, injection, form→pipeline/
integration processors, tenant isolation).

## Verified good ✅
- **Public surface is a model implementation:** slug regex-validated (12 hex,
  anti-traversal), rate-limited (60 view / 10 submit per min per IP + lockouts),
  per-form daily cap (`daily_cap_exceeded`), honeypot with fake-success (doesn't
  reveal detection), `member_lookup` fields stripped from the public GET, org
  derived from the form (not client input), IP/UA truncated.
- **Stored-XSS mitigated:** every submitted value is HTML-escaped at storage
  (`_sanitize_submission_data`), null-bytes stripped, length-capped; `submitter_*`
  escaped. Admin reads return the already-escaped blob. Form-definition text
  (label/placeholder/help) is stored raw but the React frontend renders it as
  text (no `dangerouslySetInnerHTML` anywhere in the forms module), so it
  auto-escapes — not exploitable on the current UI.
- **Pipeline integration is org-safe:** prospect creation is stamped from the
  form's org; `pipeline_id`/`stage_id` are resolved server-side and org-scoped
  (`_resolve_pipeline_for_form`), never from client input; `prospect_data` pulls
  a fixed key set.
- **Tenant isolation solid:** every by-id read/update/delete filters
  `organization_id` (or resolves via the org-scoped parent form); admin
  submission reads can't cross orgs; XC-3 clean.
- **Injection-safe:** `get_forms`/`search_members` escape LIKE wildcards;
  `json_extract`/`json_unquote` are parameterized; no raw SQL. flake8 clean.

## Findings

### FORM-1 — HIGH — Equipment-assignment integration wrote a cross-org member/item — ✅ FIXED
`_process_equipment_assignment` mapped `member_id` and `item_id` from
submitter-supplied form data (label-based mapping catches plain fields, not just
`member_lookup`) and called `inventory_service.assign_item_to_user`. That service
scopes `item_id` by org but **not** `user_id`, so a public+published
`equipment_assignment` form let a submitter assign an in-org item to an
**arbitrary/cross-org user** (and `assigned_by` fell back to that id).
**Fix:** added a reusable `_entity_in_org(model, id, org)` helper and validate
both `member_id` (User) and `item_id` (InventoryItem) belong to the submission's
org before the write; reject otherwise.

### FORM-2 — HIGH — Event-registration integration wrote an RSVP against a cross-org event — ✅ FIXED
`_process_event_registration` took `event_id` from submitter-mapped data and
created/updated an `EventRSVP` (stamped the submission's org) with **no org
check on `event_id`**, and the duplicate-check query filtered only
`event_id`+`user_id`. A member of org A could RSVP to — or mutate an RSVP on —
org B's event.
**Fix:** validate `event_id` is in the submission's org via `_entity_in_org`
before the RSVP write, and added `organization_id` to the duplicate-check query.

### FORM-3 — LOW — `MULTISELECT` option values not validated — ✅ FIXED
Option-membership validation covered `SELECT`/`RADIO`/`CHECKBOX` but not
`MULTISELECT`, so an arbitrary (escaped) string was accepted for a multiselect
field. **Fix:** added `MULTISELECT` to the comma-separated option-validation
branch alongside `CHECKBOX`. Data-integrity, not XSS.

### FORM-4 — LOW (not exploitable on current UI) — Form-definition text stored unescaped
Field `label`/`placeholder`/`help_text`/option labels are stored raw (set by a
`forms.manage` user) and returned raw by the public form GET. Verified the React
renderer uses no `dangerouslySetInnerHTML`, so it renders as escaped text — no
stored XSS today. **Status:** flagged as defense-in-depth (escape at storage or
enforce CSP) in case a future renderer changes.

### FORM-5 — LOW — `require_authentication` / `allow_multiple_submissions` not enforced on public submit
`get_form_by_slug` gates on `is_public` + `PUBLISHED` only. A form marked
`is_public=True` **and** `require_authentication=True` still accepts anonymous
submissions, and `allow_multiple_submissions=False` isn't enforced server-side
(only the per-IP daily cap applies). Logic/expectation mismatch.
**Status:** flagged — needs a product decision on the intended semantics of
"public + require_authentication" before enforcing.

### FORM-6 — INFO — Required-field check is presence-only — ✅ FIXED (app-review B13)
Both submit paths checked `field.id not in data`; a key present with `""`/
whitespace/`[]` passed the required check (later coerced to `""`). **Fix (B13):**
a new `_is_empty_value` helper treats an empty/whitespace string or empty
list/dict as missing (while `0`/`False` stay valid for number/boolean fields),
applied to both required-field loops. 9 unit tests added. See
`docs/app-review/forms.md`.

### FORM-7 — LOW-MED — Raw exception text leaked to the (unauthenticated) submitter — ✅ FIXED (app-review B13)
14 service methods returned `str(e)` on failure, which the endpoints surface as
`HTTPException(detail=error)`. On the **public unauthenticated** submit path this
returned raw SQL/column names to anonymous callers (a worse NOTIF-2/SF-2). **Fix
(B13):** all 14 client-facing tuple returns now use `safe_error_detail(e)`
(generic message + server-side log). The 5 remaining `str(e)` are internal
processor-result dicts that `_process_integrations` never returns to the client.

## Notes
- `member_lookup` fields are stripped from the public GET but still accepted on
  the public submit path. The FORM-1 in-org validation closes the actual
  cross-org exploit; additionally excluding `member_lookup`/`file`/`signature`
  from public-submission processing would be belt-and-suspenders (label-based
  mapping means type-exclusion alone is incomplete — the in-org check is the
  robust guard). Flagged.
- FORM-1/FORM-2 are the **XC-1 pattern with real cross-tenant write impact** —
  integration processors trusting submitter-supplied FK ids. The `_entity_in_org`
  helper added here is a local instance of the shared `assert_in_org` recommended
  in CROSS-CUTTING.md.
