# Application Review — Forms (Tier B)

**Prefix:** `FORM2` · **Iteration:** B13 · **Reviewed:** 2026-08-06 (pass 1),
2026-08-08 (pass 2), 2026-08-09 (pass 3), 2026-08-09 (pass 4),
2026-10-16 (pass 5), 2026-11-26 (pass 6)

**Backend:** `endpoints/forms.py` (752 L, 21 endpoints), `public/forms.py` (209 L),
`services/forms_service.py` (2,290 L), models `models/forms.py`
**Frontend:** `modules/forms` + `PublicFormPage`
**Prior audit:** `docs/module-audit/forms.md` (iteration 13) — FORM-1/2 (HIGH
cross-org integration writes) and FORM-3 fixed; FORM-4 (definition text unescaped),
FORM-5 (require_authentication not enforced), FORM-6 (required = presence-only)
left open.

**Correction (2026-10-03, from `docs/security-review/FORM-26-forms.md` pass
5):** every BXC-1 note below (pass 3, pass 4) describes a now-superseded
state. The 2026-10-02 workflow-review pass (W60) added a same-form/cycle
check (`FormsService._condition_error`, called from `add_field`/
`update_field`) and started dereferencing `condition_field_id` server-side
(`_visible_field_ids`/`_condition_matches`, to decide which hidden-branch
fields are excused from their `required` check) — for a functional reason,
not a security one, but it closes BXC-1 as a side effect: the dangling/
foreign-reference case these notes reasoned about can no longer occur. See
the security-review pass 5 entry for the full re-verification. Left in place
below as the historical record of what was true through pass 4.

---

## Pass 6 (2026-11-26) — the submission pipeline, the integrations and the forms screens (17 fixed, 7 flagged)

Pass 5 left three things unread: the submission pipeline, the integration
processors and the `modules/forms` frontend. This pass read them. Backend
candidates were reproduced against the real test database before anything was
changed. Every fix below has a test that failed on the unfixed code.

### Flagged (in `docs/KNOWN_LIMITATIONS.md` → "Forms — Decisions and Open Defects From App Review B13 Pass 6")

| Id      | Severity | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FORM2-3 | HIGH     | **Open defect.** `_process_event_registration` (`forms_service.py`) writes the RSVP itself and skips every rule `EventService.create_or_update_rsvp` applies: cancelled, draft and ended events, the deadline, capacity and the waitlist, and the phase gate. Reproduced: a one-seat event took two, a waitlisted member jumped the queue. Not fixed here because that method commits mid-submission; the phase-gate override is the decision inside it. |
| FORM2-4 | MEDIUM   | File and signature answers are stored as base64 text and refused by the 5,000-character cap (reproduced: a 19,870-character signature, an 8 KB file). The public page shows them as text boxes. Storage design decision.                                                                                                                                                                                                                                 |
| FORM2-5 | MEDIUM   | Answers are stored HTML-escaped and shown escaped in the submissions view, CSV and results; an option containing `&` is counted apart from its own option.                                                                                                                                                                                                                                                                                               |
| FORM2-6 | MEDIUM   | Starter templates (`formConstants.tsx`) create required select/radio questions with no options, which can never be answered, and publishing does not stop them.                                                                                                                                                                                                                                                                                          |
| FORM2-7 | LOW      | `notify_on_submission` / `notification_emails` are stored and returned, and nothing reads them (Pitfall 19).                                                                                                                                                                                                                                                                                                                                             |
| FORM2-8 | LOW      | A repeat public application with an existing applicant's email replaces the answers on that applicant's stage. Read, not reproduced.                                                                                                                                                                                                                                                                                                                     |
| FORM2-9 | LOW      | An equipment-assignment form is an inventory write with no `inventory.*` permission (by design of the integration; stated for the owner).                                                                                                                                                                                                                                                                                                                |

### Fixed — backend

- **FORM2-10 (MED): reprocessing an event-request submission filed another
  request and resent both emails.** The event-request processor had no lookup
  by `form_submission_id`, unlike the membership processor. Reproduced: one
  submit and two reprocesses made three requests and three notification sends.
  A reprocess now returns the request the submission already filed (Pitfall
  36); a first submission makes no extra read. A
  unique index would need a migration that settles existing duplicates
  (Pitfall 35), so it was not added.
- **FORM2-11 (LOW-MED): length limits counted the escaped text.** The value was
  `html.escape`d before the `max_length` check, so `'` counted as six
  characters: "O'Brien's" (9) was refused by a field the browser lets hold 10.
  The limit now measures what was typed.
- **FORM2-12 (LOW): the server accepted answers the browser refuses.**
  `min_length` was enforced only on required fields, and `float()` accepted
  `nan` (which passes every bound) and `inf`. `min_length` now applies to any
  non-empty answer, and a number must be finite. (`as_plain_number` was not
  used: it refuses `1e3`, which a number input sends.)
- **FORM2-13 (LOW): a required Member Lookup made a public form unsubmittable.**
  The public view leaves member lookups out, and the required check still
  demanded them. The public submit path now excuses the field types the public
  view hides (`PUBLIC_HIDDEN_FIELD_TYPES`).
- **FORM2-14 (LOW): an equipment-assignment form could assign gear to a former
  member** (Pitfall 32). The assignee must now hold a current account status.
- **FORM2-15 (LOW): deleting a submission was not audited.** Every other
  destructive forms action is. It is now audited with ids only.
- **FORM2-16 (LOW): a duplicate application logged the applicant's email**
  (Pitfall 33). It now logs the submission and prospect ids. No test: the change
  is to a log line's content only.

### Fixed — frontend

- **FORM2-17 (MED): switching forms on the Submissions tab kept the previous
  form's labels and page.** The viewer stays mounted; with fields already
  loaded it never fetched the new form's, so every answer was labelled with a
  field id, and page 3 of one form requested page 3 of the next. It now starts
  each form at page one with its own fields, and drops late responses.
- **FORM2-18 (MED): the Results view could show the form just left.** Its
  multi-page load had no stale guard; a late response for form A painted A's
  charts under B's heading.
- **FORM2-19 (LOW): "Recent answers" were the oldest.** Submissions arrive
  newest first and the panel took the last five.
- **FORM2-20 (MED): public forms had no multi-select control.** It fell through
  to a text box the server refused unless the exact option values were typed.
  It now renders checkboxes, as in the signed-in renderer.
- **FORM2-21 (MED): the Integrations dialog failed silently and carried
  mappings between forms.** Its errors went to the page banner behind the
  dialog, and its target, type and field mappings survived into the next form's
  dialog, where another form's field ids would be stored. Errors now show in the
  dialog, and it opens fresh each time.
- **FORM2-22 (LOW-MED): Member Lookup kept a member the user had typed over.**
  Editing the name after choosing kept the old member's id as the answer, and a
  slow search for an earlier prefix could replace newer results.
- **FORM2-23 (LOW-MED): new and duplicated fields collided on `sort_order`.**
  Deleting a field does not reindex, so `fields.length` was often an order in
  use, and a duplicate took its original's order plus one. Tied fields order
  unpredictably and Move up/down swapped two equal values, doing nothing. A new
  field now lets the server append it; a duplicate is moved under its original
  with `reorderFields`; moves work by position.
- **FORM2-24 (LOW): a refused reorder still showed the new order.** The builder
  wrote `sort_order` onto the objects held in state before saving. It now builds
  a new list, so a refusal leaves the screen as saved.
- **FORM2-25 (LOW-MED): a public form could be sent twice.** With reCAPTCHA on,
  a second tap while the token was fetched sent a second submission. A guard is
  now held from before the challenge.
- **FORM2-26 (LOW): the form list could show an earlier search's results.** It
  refetches on each keystroke with no stale guard.

Four existing tests changed, each because the code under them changed shape,
not because an expectation was loosened: three assert the exact call to the
event-request processor, which now also takes `reprocessing`; one stubs a form
field without a `field_type`, which every real field has and the public
required check now reads.

### Open (LOW, recorded here only)

- Reprocessing a successful equipment assignment rewrites its result as a
  failure ("Item is not available (status: assigned)"); no duplicate is made.
  Read, not reproduced.
- "Export CSV" in the submissions view exports the current page only.
- Date-and-time answers are converted from the viewer's zone to the
  department's, so they shift when the two differ.
- "Submit Another Response" drops the fields' default values.
- A file over 10 MB is ignored without a message (moot while FORM2-4 stands).
- The form list asks for no limit, so the backend's 100 applies with no paging;
  the category filter has no "Other".
- `FormRenderer` keeps "Fix the errors below." after the errors are fixed;
  `PublicFormPage`'s error banner has no `role="alert"` and is not scrolled to.
- `membership_pipeline_service.py` logs an applicant's email on a duplicate
  application as well (Pitfall 33), outside this module.

### Verified good ✅ (this pass)

- One-per-person on both submit paths locks the form row and then makes a
  locking read (FORM-10 holds). Draft, closed and archived forms are refused on
  both paths, and `require_authentication` is enforced.
- Public intake: the daily cap is spent after validation and once across the
  deadlock retry; honeypot, captcha, per-IP limits and the slug format check
  hold.
- Hidden-branch answers are dropped and excused from `required`; select,
  radio, checkbox and multi-select values are checked against their options.
  The frontend's visibility rules (`utils/formVisibility.ts`) match the
  server's, including cycle breaking.
- Every submission read and delete is org-scoped; integration FKs pass
  `_entity_in_org`. Event-request emails wait for the commit, and the status
  token stays out of `integration_result`.
- Follow-up forms: hashed token, locked submit, one 404 for every failure,
  no-store and noindex headers, send-then-stamp reminders.
- Member lookup uses `like_pattern` with `ESCAPE` and current account statuses.
- Field update payloads send null for every cleared key (Pitfall 1), create
  payloads use `|| undefined`, every confirmation goes through `useConfirm`, and
  the CSV goes through `buildCsv` with sensitive answers left out.

### Not read (scope, stated plainly)

Form create, list, publish warnings, archive and field CRUD in
`forms_service.py` (pass 5 covered them); the follow-up form notification
emails; the membership pipeline's own `create_prospect` / stage internals; the
co-located frontend tests beyond those touched; `applicantFields.ts`,
`useEmbedHeight` and the embed snippet.

### Completion gate (pass 6)

| Check                                                   | Result                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------ |
| `flake8` / `black` / `isort` (changed files)            | ✅ clean                                                                 |
| mypy ratchet                                            | ✅ 0 errors, matching the baseline                                       |
| endpoint docstring permissions check                    | ✅ 0 warnings                                                            |
| new backend tests                                       | ✅ 16 (9 failed on the unfixed code, 7 controls); 10 run in the unit job |
| forms, event-request and public backend tests           | ✅ 2,157 passed, 1 skipped                                               |
| `npm run typecheck` / ESLint (changed files) / Prettier | ✅ clean                                                                 |
| forms frontend tests                                    | ✅ 82 passed in 21 files; 16 new tests, each failed first                |

---

## Pass 5 (2026-10-16) — seven flags could be nulled into a row that broke the form's own screen (7 fixed, 0 flagged)

Lens for this pass: the update-payload discipline the B4–B12 passes applied, driven
through the real handlers. The three PATCH routes (`/forms/{id}`, `/fields/{id}`,
`/integrations/{id}`) already write through `apply_updates`, and the service wraps it in
`except Exception → safe_error_detail`, so a null against a NOT NULL column was already a
clean 400 — that half was verified rather than fixed. What was open is the other shape
(DOC-20 / NOTIF2-5): a **nullable column behind a response field typed as a plain
`bool` / `str`**. All 22 routes were inventoried for their gate: `forms.manage` on every
write and on the submissions and integrations routes, `forms.view` on list / summary /
detail, `get_current_user` on `member-lookup` (own visibility test) and on the
authenticated submit (any member, by design).

### FORM2-2 — MEDIUM — `PATCH` with `null` on a flag stored NULL, then every read of the form returned 500 — ✅ FIXED

Probed by sending `{field: null}` for every field of the three `*Update` schemas against
a fresh form each time, then reading the row back from the table and `GET`ting the form.
Seven fields stored NULL, answered 500, and left `GET /forms/{id}` at 500 as well:

| Update schema           | Fields                                                                                      | Column                        |
| ----------------------- | ------------------------------------------------------------------------------------------- | ----------------------------- |
| `FormUpdate`            | `allow_multiple_submissions`, `require_authentication`, `notify_on_submission`, `is_public` | nullable `Boolean`            |
| `FormFieldUpdate`       | `required`, `width`                                                                         | nullable `Boolean` / `String` |
| `FormIntegrationUpdate` | `is_active`                                                                                 | nullable `Boolean`            |

Each column allows NULL (`Mapped[Optional[...]]`) while its response field is a plain
`bool` / `str`, so `apply_updates` — which refuses a null only for a NOT NULL column —
wrote it, the commit succeeded, and serializing the row failed. The cost is the form's
detail view and, for the form flags, the list, until the row is repaired in the database.
Two of the flags are read as falsy afterwards: `require_authentication` is checked as
`if form.require_authentication and not submitted_by` (`forms_service.py:1508`), so a NULL
**opens an authenticated form to public submission**, and `allow_multiple_submissions` NULL
reads as "one submission per person". Reachability is low — the frontend types
(`formTypes.ts`) never allow null for any of these, so it needs a direct API client with
`forms.manage` — but the failure is fail-open on one flag and takes the screen down on all.

**Fixed in the request schemas**, not the handlers: a shared `_reject_null` validator
(`field_validator`, using `info.field_name` for the message) answers 422 for an explicit
null and does nothing when the key is omitted, since a validator does not run for a key
that was not sent. Same fix and same reasoning as NOTIF2-5.

Tests: `tests/test_forms_update_null_columns_integration.py` (39). The case lists are
**derived** from schema ∩ model ∩ response model, so a new column becomes a new case the
day it is added: NOT NULL columns must answer exactly 400 or 422 and keep their value;
nullable-but-plain-typed flags must answer 422, keep their value and leave the form
loading (detail and list); every other nullable column must still clear. A guard test pins
the derived flag set to the seven above so a new one is a deliberate edit. 7 cases fail on
the unmodified schemas (one per flag), 32 pass either way, 0 are selected under the unit
job's marker expression. A JSON column (`options`, `notification_emails`) stores the JSON
literal `null` rather than SQL NULL when cleared; the ORM reads either back as `None`, and
the test accepts both.

### Observation, not changed — one redundant `# noqa: E712`

`forms_service.py:2076` carries `# noqa: E712` on a `== True` JSON-value compare. `.flake8`
ignores E711 and E712 globally, so it is a no-op; it belongs to the repo-wide sweep
recorded in `docs/app-review/notifications.md` (67 + 6 comments), not to this change set.

### Verified good ✅ (this pass)

- **Nothing unreferenced.** The AST scan (counting `tests/`, `scripts/`, `alembic/`) over
  the endpoints, public router, service, model and schema files found no unused module-level
  name or class method.
- **Org scoping.** Every by-id read resolves the form through `get_form_by_id(form_id,
organization_id)` first; field queries then constrain by the parent `form_id`; integration
  queries filter `organization_id` as well (the FORM-1 / FORM-2 fixes from the earlier
  audit still hold, and the org-scoping ratchet passes).
- **NOT NULL columns** (`name`, `category`, `status`, `label`, `field_type`, `sort_order`,
  `field_mappings`) answer 400 / 422 and leave the stored value untouched.
- **Enum validation** (`category`, `status`, `field_type`, `integration_type`) rejects an
  out-of-set value with a 422 before it reaches the ENUM column (FORM2-1 still holds).

### Not read (scope, stated plainly)

The 3,492-line service was read at its update, delete, field and integration paths and
scanned for dead names; the submission pipeline, the integration processors (membership,
equipment, event registration, event request), email notification and the stage-advance
guards were left to their dedicated suites, which pass. The `modules/forms` frontend was
read only at its update payload types.

### Completion gate (pass 5)

| Check                                                           | Result                                                             |
| --------------------------------------------------------------- | ------------------------------------------------------------------ |
| `flake8 app/ tests/`                                            | ✅ exit 0, no output                                               |
| `black --check app/ tests/`                                     | ✅ 1767 files unchanged                                            |
| `isort --check` (changed files)                                 | ✅                                                                 |
| `mypy app/schemas/forms.py`                                     | ✅ no issues                                                       |
| Related backend suites (16 files incl. the org-scoping ratchet) | ✅ 270 passed                                                      |
| New file                                                        | ✅ 39 pass; 7 fail without the fix; 0 under the unit job's markers |
| `check_route_permissions.py --strict`                           | ✅ 0 errors, 0 warnings                                            |
| Frontend                                                        | n/a — no frontend change                                           |

---

## Pass 4 (2026-08-09) — full FK re-audit; the one residual re-confirmed non-security

Pass 4 ran a fresh, exhaustive client-FK audit across every `create_*`/`update_*`
path in the module (a sub-agent traced each writer against its request schema).
Everything the FORM-1/FORM-2 fixes covered holds, and the sweep found **no new
cross-org write gap**:

- `create_form`/`update_form`/`add_integration`/`update_integration` — the only
  FKs are server-derived (`organization_id`/`created_by`) or the server-set,
  org-verified `form_id`; `field_mappings` is validated to reference only the
  form's own field ids (`_validate_field_mappings`); `target_module`/
  `integration_type` are enums, not resource FKs.
- `submit_form`/`submit_public_form` — `form_id` is org-scoped via
  `get_form_by_id`/`get_form_by_slug`; the submitter-mapped integration FKs
  (`member_id`/`item_id`/`event_id`) are validated in-org via `_entity_in_org`;
  submission `data` keys are filtered to known field ids.

The audit's only finding is the **already-flagged BXC-1 residual**:
`FormField.condition_field_id` is written through `create_form`/`add_field`/
`update_field` without a same-form/org check. Re-confirmed this pass that it is
**not a security gap**: the column is a _soft_ reference (`String(36)`, **no** DB
`ForeignKey`), it has **no** `organization_id` of its own (org-scoped only via the
parent `Form`), and — decisively — it is **never dereferenced server-side**. It
drives only client-side conditional-visibility rendering, which matches against
fields of the _current_ form, so a foreign/garbage value is a dangling,
never-matching reference (a broken visibility rule), never cross-org data reach.

**Left flagged, not fixed.** The one worthwhile hardening would be a _same-form_
validation (reject a `condition_field_id` not among this form's fields) — a
correctness guard, not a security one. It's deferred deliberately: the semantics
are builder-specific (a field's visibility can depend on another field created in
the same `create_form` call, whose id is server-generated), so scoping the check
wrong would reject legitimate cross-field rules — exactly the kind of change that
wants its own DB-backed verification rather than a rotation-tick guess. Recorded
as the BXC-1 correctness follow-up.

**Completion gate (pass 4):** no code changed; `flake8` 0 · `black --check` clean ·
`tsc --noEmit` n/a.

---

## Pass 3 (2026-08-09) — latent-500 on form/field/integration enums; E712 swept

Re-verified FORM-1/2/3/6/7 hold. The B1 latent-500 enum lens — which pass 2's
error-handling latent-500 check didn't cover — surfaced a genuine gap, plus two
false positives a read cleared.

### FORM2-1 — LOW/MED — Enum fields 500 on a bad value (incl. an _incomplete_ prior guard) — ✅ FIXED

**What:** `category`/`status` (Form), `field_type` (FormField), and
`target_module`/`integration_type` (FormIntegration) map to **strict MySQL ENUM**
columns but were typed as free `str` and inserted raw (`create_form`/`create_field`
via `**data`, the `update_*` `setattr` loops, `create_integration` via explicit
kwargs). An out-of-set value 500'd at MySQL. Notably `category` **already had a
`@field_validator`, but it only lowercase-_normalized_ — it did not reject
unknowns**, so `category="bogus"` still reached MySQL and 500'd; the guard looked
present but didn't prevent the fault.

**Fix:** a shared `_enum_check(valid, field)` that normalizes case **and** validates
membership, replacing the two normalize-only `category` validators and added to
`FormUpdate.status`, `FormField{Create,Update}.field_type`, and
`FormIntegrationCreate.{target_module,integration_type}` — each deriving its set from
the model enum, → 422. Request-only, so the response schemas are untouched.
**10 tests added.**

**Two lens false positives, cleared by reading (no change):**

- `Form.integration_type` (`FormCreate`/`FormUpdate.integration_type`) is a plain
  **String** column, not an ENUM — no 500 path (distinct from
  `FormIntegration.integration_type`, which _is_ an ENUM and _was_ fixed).
- `FormIntegrationUpdate` exposes no enum field (only `field_mappings`/`is_active`).

### FORM2-2 — NIT — 6 boolean-column E712 swept; 1 JSON compare kept — ✅ FIXED

Swept 6 `is_public`/`is_template == True/False  # noqa: E712` boolean-column
comparisons to `.is_(...)`. **Kept** the one at `forms_service.py:1337` —
`func.json_extract(config, "$.auto_advance") == True` — as an explicit `# noqa: E712`
(a JSON-value compare, not a boolean column; `.is_(True)` would change MySQL
semantics), now with a comment saying so.

### Still flagged (unchanged)

- **FORM-4** (definition text stored unescaped — escaped at _render_, not storage, by
  design), **FORM-5** (`require_authentication`/`allow_multiple_submissions`
  semantics — product decision), and the BXC-1 `condition_field_id` residual
  (client-only conditional visibility, degrades to a no-op, never dereferenced
  server-side).

**Completion gate (pass 3):** `flake8` 0 · `black --check` clean · `tsc --noEmit`
n/a (no frontend change) · new enum tests **10 passed** + existing forms tests pass
(DB-free).

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

### FORM-5 — LOW — `require_authentication` / `allow_multiple_submissions` not enforced — ✅ FIXED (re-confirmed in security-review FORM-26, 2026-08-27)

`get_form_by_slug` still gates on `is_public` + `PUBLISHED` only. A form marked
both `is_public=True` and `require_authentication=True` still accepts anonymous
submissions, and `allow_multiple_submissions=False` isn't enforced server-side
(only the per-IP daily cap). Re-confirmed the logic mismatch; unchanged because
"public + require_authentication" needs a product decision on intended semantics
(is it a contradiction to reject, or does it mean "public listing, authed
submit"?). Recorded in `KNOWN_LIMITATIONS.md`.

**Update (2026-08-27):** resolved since this pass — `submit_public_form`
(both the endpoint and the service) now enforces both policies, including a
locked, race-safe duplicate check for `allow_multiple_submissions=False` and
a cross-org 404 for an authenticated submitter from a different org. See
`docs/security-review/FORM-26-forms.md`. The `KNOWN_LIMITATIONS.md` entry
should be marked resolved.

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

The 5 `{"success": False, "error": str(e)}` processor dicts were assessed here
as internal diagnostics (not client-facing). Sanitizing them was left as
optional DiD, to keep the change focused on the reachable leak.

**Correction (security-review FORM-26 pass 2, 2026-08-31):** they were
client-facing after all — `submission.integration_result` (the dict these
sites populate) is a field on `FormSubmissionResponse`, the response model for
`submit_form`/`get_submission`/`list_submissions`/
`reprocess_submission_integrations`, and is rendered directly in
`SubmissionViewer.tsx`. Fixed as FORM-9; see
`docs/security-review/FORM-26-forms.md` pass 2.

## Documentation

`docs/module-audit/forms.md` updated: FORM-6 resolved, FORM-7 added, FORM-4/5 clarified.

## Future development

1. **FORM-5** — decide "public + require_authentication" semantics, then enforce
   (and enforce `allow_multiple_submissions` server-side).
2. **FORM-4** — CSP / render-time escaping if a future renderer emits HTML.
3. Optionally sanitize the internal processor `str(e)` dicts for full consistency.

## Completion gate

| Check                     | Result                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `flake8` (service + test) | ✅ 0 violations                                                                                                                                                    |
| `black --check`           | ✅ unchanged                                                                                                                                                       |
| `tsc --noEmit`            | ✅ n/a — no frontend change                                                                                                                                        |
| backend tests             | ✅ `test_forms_service` **9 passed** (new); forms-related selection 56 passed (DB-fixture errors are unrelated `-k form` false matches — plat**form**/**form**at). |
