# Security Review — Forms

**Prefix:** `FORM` · **Iteration:** 26 · **Reviewed:** 2026-08-27 (pass 1), 2026-08-31 (pass 2), 2026-09-06 (pass 3), 2026-09-13 (pass 4) · **PR:** [#1908](https://github.com/thegspiro/the-logbook/pull/1908) (pass 1), [#2085](https://github.com/thegspiro/the-logbook/pull/2085) (pass 2)

---

## Pass 4 (2026-09-13) — the event-request integration leaked a bearer capability token past the permission that guards it

**Scope:** loaded prior art (`CHECKLIST.md`, `SEC-00-cross-cutting-baseline.md`,
`docs/module-audit/forms.md`, `docs/app-review/forms.md`, this file's passes
1-3, `KNOWN_LIMITATIONS.md`'s two FORM-10-related entries) before touching
code. Unlike pass 3, this module has grown substantially since the last
pass: `forms_service.py` 2,628 → 2,985 L before this pass's fix (+357;
pass 3 through pass 4 span nine commits, 2026-09-09 through 2026-09-10,
titled "Close three gaps in the public outreach request pipeline" through
"Store an aware datetime as UTC..." — a multi-round Codex-reviewed hardening
of the shared JSON-endpoint/form intake parity for event requests). `forms.py`
(784 L), `public/forms.py` (236 L), `models/forms.py` (347 L) and
`schemas/forms.py` (424 L) all match pass 3's recorded line counts exactly,
and `git log --since=2026-09-06` on each turns up no commit that actually
diffs the file (the one merge commit it names touches unrelated modules) —
confirming no change since pass 3, not merely a coincidental line-count
match. All five files were read in full this pass regardless. The
growth is concentrated entirely in `_process_event_request` and the new
`app/services/event_request_service.py` module it now imports eight helpers
from (`clamp_text_fields`, `get_pipeline_settings`, `lead_time_error`,
`normalize_request_preferences`, `parse_audience_size`, `public_daily_limit`,
`apply_default_assignee`, `send_request_notification`) — that shared service
has its own extensive dedicated review history (visible in its commit
messages) as part of the events/outreach surface, which is a different
rotation concern; this pass reviewed it only at the boundary forms_service.py
actually calls across, not as a from-scratch audit of the whole outreach
pipeline.

Re-verified every prior finding (FORM-1 through FORM-10, BXC-1) against
current code — all hold, nothing regressed. Full route inventory
re-enumerated: all 22 `endpoints/forms.py` routes still carry either
`require_permission("forms.view")` or `require_permission("forms.manage")`,
except `submit_form` and `GET /member-lookup` (bare `get_current_user`, by
design — any authenticated org member), and both `public/forms.py` routes
remain intentionally unauthenticated behind slug regex + rate limiting +
honeypot + CAPTCHA, unchanged from every prior pass.

### FORM-11 — MEDIUM — `_process_event_request`'s result carried `EventRequest.status_token`, a bearer credential, to an audience the permission model does not authorize for it — ✅ FIXED

**What:** `status_token` is a 64-character bearer credential
(`app/models/event_request.py:163`) that lets its holder view **and
self-service-cancel** an event request at the fully unauthenticated
`GET /event-requests/status/{token}` / `POST /event-requests/status/{token}/cancel`
endpoints (`app/api/v1/endpoints/event_requests.py:402-519`) — no
`organization_id` check, no permission, nothing but possession of the string.
`docs/KNOWN_LIMITATIONS.md` (the "Public portal" and "requester's status link"
entries) documents this as a **deliberate** design choice: the token is meant
to reach a requester only by a coordinator's "Copy status link" control on
the request detail panel in Events → Requests, which is gated by
`events.manage` — "nothing puts that URL in front of the requester
automatically... a coordinator hands it out." The admin-facing
`GET /event-requests/{request_id}` endpoint that also returns it
(`event_requests.py:191`) is likewise gated by `require_permission("events.manage")`.

`forms_service.py`'s `_process_event_request` (added as part of the
event-request/forms intake-parity work between pass 3 and this pass) built
its result dict as `{"success": True, "event_request_id": ..., "status_token":
event_request.status_token, "message": ...}`. That dict is what
`_process_integrations` stores verbatim into `submission.integration_result`
— the same JSON column FORM-9 (pass 2) already established is serialized to
the client by `FormSubmissionResponse`, the response model on **four**
endpoints: `submit_form` (any authenticated org member, no `forms.manage`
needed — `get_current_user` only), `get_submission`, `list_submissions`, and
`reprocess_submission_integrations` (all three gated only by
`forms.manage`). None of those four require `events.manage`.

**Where:** `app/services/forms_service.py:2842-2847` (as it stood before this
pass's fix — the `return` at the end of `_process_event_request`).

**Failure scenario:** a department grants `forms.manage` to a records clerk
who is not an events coordinator (no `events.manage`). The department has
published its request-intake form (the standard "Generate public request
form" flow) with the `event_request` integration. Any submission to it —
public or, since the direct/legacy path runs identically for the internal
`submit_form` route, an authenticated member's own submission — stores its
`status_token` on `submission.integration_result`. The clerk opens
`GET /forms/{id}/submissions` (their own permission, `forms.manage`, is
enough) and reads `status_token` for any event request in the org straight
out of the JSON body — no `events.manage` involved. With it they can open
the request's public status page and, if it is not yet in a terminal state,
call the self-service cancel endpoint and cancel a community event on the
department's calendar — a capability the permission model reserves for
`events.manage` holders, reached instead through `forms.manage`.

**Impact:** cross-permission privilege escalation within one organization
(not cross-tenant — everything here stays inside the submitting org). Same
disclosure _shape_ as FORM-9 (a value captured into `integration_result` that
was assessed as "internal" without tracing where the response schema
actually sends it) but a different, more consequential payload: FORM-9 leaked
diagnostic error text; this leaked a working bearer credential with a
destructive action (cancel) behind it, and did so past a specific,
documented access-control boundary (`events.manage`) rather than merely past
`safe_error_detail`'s sanitization.

**Fix:** dropped `status_token` from the dict `_process_event_request`
returns. Nothing else reads it from there — the coordinator still gets the
token the documented way (the request detail panel, gated by
`events.manage`), and the requester still gets it via
`send_request_notification`'s email where the department has chosen to send
one; neither of those paths goes through `submission.integration_result`.
The returned dict now carries only `success`, `event_request_id` and
`message`.

**Guard test:** `tests/test_event_request_form_intake.py::test_a_form_request_result_never_carries_the_status_token`
— asserts the full key set of `_process_event_request`'s success result is
exactly `{success, event_request_id, message}`. Verified to fail on
reintroduction (restoring the `"status_token": event_request.status_token`
line fails the test with the token value visible in the assertion diff) and
to pass with the fix in place; the file's other five tests (pre-existing,
covering auto-assignment, the deferred notification queue, and the lead-time
warning) still pass unchanged.

### FORM-12 — LOW/INFO — `get_submission`, `delete_submission` and `reprocess_submission_integrations` ignore the `form_id` path segment — 🚩 FLAGGED (not a security boundary, correctness-only)

**What:** `GET/DELETE /forms/{form_id}/submissions/{submission_id}` and
`POST /forms/{form_id}/submissions/{submission_id}/reprocess` all accept
`form_id` in the URL, but the service methods behind them
(`get_submission_by_id`, `delete_submission`,
`reprocess_submission_integrations`) filter only `submission_id` +
`organization_id` — `form_id` is never passed through or checked. A request
against the "wrong" `form_id` for a submission that belongs to a different
form in the same org still succeeds.

**Where:** `app/api/v1/endpoints/forms.py:688-784` (the three routes) calling
`app/services/forms_service.py:1226` (`get_submission_by_id`), `:1275`
(`delete_submission`), `:1241` (`reprocess_submission_integrations`) — none
of the three accepts or uses a `form_id` parameter.

**Why this is not a security boundary today:** `forms.manage` is an
org-wide, not per-form, permission — the same holder can already reach any
submission on any form in the org via `list_submissions` with the correct
`form_id`, so reaching the same row through a mismatched `form_id` in the
path grants no privilege beyond what the permission already carries. This is
a URL-correctness gap (a form_id that does not describe what is actually
returned/deleted/reprocessed), not an access-control one.

**Disposition:** flagged rather than fixed. Adding the filter is
low-complexity, but it is a behavior change (a previously-200 request with a
mismatched `form_id` would start 404ing) that this task's scope excludes from
an unreviewed drive-by fix — left for a future pass or an explicit product
call on whether that response should change. Not mirrored to
`KNOWN_LIMITATIONS.md`: it carries no owner-facing risk or decision, only an
API-shape nit.

### Re-verified this pass (unchanged, all hold)

- **FORM-1/FORM-2** (`_entity_in_org` gates `member_id`/`item_id`/`event_id`)
  — re-read `_process_equipment_assignment`, `_process_event_registration` in
  full; both still validate in-org before the write.
- **FORM-3** (`MULTISELECT` option-membership validation) — intact.
- **FORM-4** (form-definition text stored unescaped) — still correctly left
  unescaped at storage; re-confirmed no `dangerouslySetInnerHTML` anywhere
  under `frontend/src/components/forms/`, `pages/PublicFormPage.tsx`, or
  `modules/forms/` (grep, zero matches).
- **FORM-5** (`require_authentication`/`allow_multiple_submissions` enforced
  on public submit, cross-org 404 for a foreign-org authenticated submitter)
  — intact in `public/forms.py` and `submit_public_form`.
- **FORM-6** (`_is_empty_value`).
- **FORM-7/FORM-9** (`safe_error_detail`/`sanitize_error_message` on every
  client-facing error path) — re-read all four integration processors and
  `_process_integrations`'s two exception handlers; every one still routes
  through one or the other, never raw `str(e)`.
- **FORM-8** (`apply_updates` on `update_form`/`update_field`/
  `update_integration`).
- **FORM-10** (the public duplicate-submission check is a locking read,
  `.with_for_update()`, not a plain `SELECT`) — re-read
  `_create_public_submission` in full; the fix and its documenting
  docstring are unchanged. The sibling gap it noted — the authenticated
  `submit_form` path enforces no `allow_multiple_submissions` check at all —
  is unchanged and remains a product-scope question, not a defect; still
  correctly recorded only in `KNOWN_LIMITATIONS.md`, not re-litigated here.
  The companion `KNOWN_LIMITATIONS.md` entry (no form-builder control writes
  `allow_multiple_submissions` at all, so it defaults `True` and is
  unreachable from the UI) is also unchanged — re-confirmed by grepping
  `frontend/src` for the field: still only the type declaration, test
  fixtures, and `PublicFormPage.tsx`'s read of it to decide whether to offer
  "Submit Another Response".
- **BXC-1** (`FormField.condition_field_id` — soft reference, never
  dereferenced server-side) — unchanged in `models/forms.py`.
- **Tenant isolation** — every by-id read/update/delete across forms,
  fields, integrations, and submissions filters `organization_id` or
  resolves through an org-scoped parent; the new `_process_event_request`
  code path was checked against this too — it stamps `organization_id` from
  `submission.organization_id` (server-derived, never client input) on the
  `EventRequest` it creates, and takes no client-supplied FK id at all (every
  field is free text or server-derived), so it introduces no FORM-1/FORM-2
  shaped cross-org write risk. `is_public` (the flag gating the
  `accept_public_requests`/daily-cap checks added since pass 3) is likewise
  derived server-side from `submitted_by is None`, never from client input
  or the URL.
- **LIKE escaping** — `get_forms`/`search_members`, unchanged, both still use
  `like_pattern()` + `escape=LIKE_ESCAPE_CHAR`.
- **`search_members` email disclosure** — unchanged, still gated on
  `ContactPolicy`.
- **JSON column mutation (Pitfall #12)** — every write to
  `submission.integration_result`, `integration.field_mappings`, and
  `progress.action_result` in this module is a full-value reassignment
  (`submission.integration_result = results`, etc.), never a mutated shared
  reference behind a shallow copy; unchanged from pass 2's finding.
- **CSV export (Pitfall #15)** — n/a, this module has no CSV/spreadsheet
  export surface (grepped for `csv`/`SafeCsvWriter`, zero matches).
- **Capacity/locking (Pitfall #27)** — the one capacity-style check in this
  module's own code is FORM-10's duplicate-submission lock, re-verified
  above. The event-request daily cap (`daily_cap_exceeded`, an atomic Redis
  `INCR`) is not a row-lock pattern and lives in `event_request_service.py`,
  outside this feature's file set.

### Completion gate (pass 4)

| Check                                             | Result                                                                                                |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                     | ✅ 0 violations                                                                                       |
| `black --check app/ tests/ alembic/`              | ✅ clean, 1586 files unchanged                                                                        |
| `isort --check-only app/ tests/ alembic/`         | ✅ clean (isort 9.0.1, matches CI's pin)                                                              |
| `python3 scripts/validate_migrations.py --strict` | ✅ PASSED — 443 revisions, single head, no migration this pass                                        |
| `pytest tests/ -q -k form`                        | ✅ 482 passed, 1 skipped (pywebpush, environment-only)                                                |
| `pytest tests/` (full suite)                      | ✅ 12,448 passed, 21 skipped (all environment-only: pywebpush, Docker, opt-in API-contract), 0 failed |
| `tsc --noEmit` (`npm run typecheck`)              | ✅ 0 errors                                                                                           |
| `npm run lint`                                    | ✅ exit 0, no warnings                                                                                |

---

## Pass 3 (2026-09-06) — duplicate-submission check used a stale REPEATABLE READ snapshot

**Scope:** loaded prior art (`CHECKLIST.md`, `SEC-00-cross-cutting-baseline.md`,
`docs/module-audit/forms.md`, `docs/app-review/forms.md`, this file's passes 1-2)
before touching code. Confirmed file sizes are effectively unchanged since pass
2: `endpoints/forms.py` 784 L (was 768 — the `+16` is `require_authentication`/
`allow_multiple_submissions`/cross-org enforcement already recorded under
FORM-5's "resolved 2026-08-27" note, not new code this pass),
`public/forms.py` 236 L (unchanged), `forms_service.py` 2,628 L (was 2,601 — the
`+27` is the same FORM-5 enforcement plus the event-request lead-time/timezone
handling already covered by other reviews), `models/forms.py` 347 L and
`schemas/forms.py` 424 L (both unchanged). All five files were re-read in full
this pass rather than diffed, since `git log` on this branch's history does not
cleanly show line-level provenance for a squash-merged file. Re-verified every
prior finding (FORM-1/2/3/4/5/6/7/8/9, BXC-1) against the current code — all
hold as previously recorded; nothing regressed.

### FORM-10 — MEDIUM — The "one submission per member" duplicate check is a stale-snapshot race, not a real lock — ✅ FIXED

**What:** `submit_public_form` enforces `allow_multiple_submissions=False` by
locking the `Form` row (`with_for_update()`) and then querying for a prior
`FormSubmission` from the same `submitted_by`. The row lock serializes the two
requests correctly, but the duplicate-check query itself was a **plain**
`SELECT` — and under InnoDB/MariaDB's default REPEATABLE READ, a plain SELECT
always answers from the snapshot taken at the transaction's _first_ read, not
from whatever is current when the statement runs. That first read is
`get_form_by_slug()`, called both by the `public/forms.py` endpoint before
`submit_public_form` is even invoked and again inside it — i.e. before the
lock section runs at all. Acquiring the `Form` row lock afterward does not
refresh that snapshot (this is precisely CLAUDE.md Pitfall #27's "the row is
locked and the count is stale anyway").

**Where:** `app/services/forms_service.py`, `submit_public_form` (the
duplicate-check block immediately after the `with_for_update()` lock on
`Form.id`).

**Failure scenario:** an authenticated member double-clicks a "submit" button
wired to a form with `allow_multiple_submissions=False` (or two devices/tabs
submit within the same instant). Request A locks the `Form` row, finds no
prior submission (correctly — none exists yet), inserts, and commits,
releasing the lock. Request B then acquires the same lock, but its duplicate
check runs against **B's own snapshot**, taken at B's `get_form_by_slug()`
call before A ever committed — so B does not see A's row and also inserts,
producing two submissions from one member on a form whose entire point is to
forbid that (double a stipend claim, double an equipment self-assignment
request, etc., depending on the form's integration).

**Fix:** made the duplicate-check query itself a locking read
(`.with_for_update()`), matching the FAC-45/MSG-13 precedent already
established elsewhere in this codebase for exactly this class of bug — a
locking read is guaranteed to see the latest committed data regardless of the
transaction's own snapshot, unlike a plain SELECT.

**Guard test:** `tests/test_forms_service.py::TestConcurrentDuplicateSubmissionCheck`
— two genuinely independent sessions (`database_manager.session_factory()`,
not the auto-rollback `db_session` fixture) submit to the same
`allow_multiple_submissions=False` form as the same member via
`asyncio.gather`, and asserts the winner-agnostic invariant that exactly one
submission succeeds. Verified fail-before (reliably reproduces 2 successful
submissions on the unpatched query, every run — the staleness is a guaranteed
property of REPEATABLE READ semantics, not a timing coin-flip) / pass-after.

**Note:** the equivalent authenticated (non-public) `submit_form` path enforces
no `allow_multiple_submissions` check at all — only the public path does. This
mirrors the existing FORM-5 scope (that finding, and its 2026-08-27 fix, both
concern the public-submission policy specifically) and every prior pass has
treated `allow_multiple_submissions` as a public-form policy. Whether it
should also gate repeat submissions on the authenticated `/forms/{id}/submit`
endpoint is a product-scope question (what does "multiple submissions" mean
for an internal member form, e.g. a recurring training acknowledgment?), not a
verifiable defect — flagged rather than guessed at.

### Re-verified this pass (unchanged, all hold)

- **FORM-1/FORM-2** (`_entity_in_org` gates `member_id`/`item_id`/`event_id`
  before every cross-module integration write) — read `_process_equipment_assignment`,
  `_process_event_registration` in full; both still validate in-org before
  the write, and event registration additionally checks `attendance_is_finalized`
  before creating an RSVP.
- **FORM-3** (`MULTISELECT` option-membership validation) — intact in
  `_sanitize_submission_data`.
- **FORM-4** (form-definition text stored unescaped) — still correctly left
  unescaped at storage (the React renderer text-renders it; escaping at
  storage would double-escape on display). No renderer change since pass 2.
- **FORM-5** (`require_authentication`/`allow_multiple_submissions` enforced,
  plus the cross-org 404 for an authenticated submitter from a different org)
  — `public/forms.py:submit_public_form` and the service method both still
  enforce this.
- **FORM-6** (`_is_empty_value` — a required field needs a real value).
- **FORM-7/FORM-9** (`safe_error_detail`/`sanitize_error_message` on every
  client-facing error path, including `integration_result`) — re-read all
  four integration processors and `_process_integrations`'s two exception
  handlers; every one routes through `safe_error_detail` or
  `sanitize_error_message`, never raw `str(e)`.
- **FORM-8** (`apply_updates` on `update_form`/`update_field`/`update_integration`).
- **BXC-1** (`FormField.condition_field_id` — soft reference, no FK, never
  dereferenced server-side, org-scoped only via the parent form) — confirmed
  unchanged in `models/forms.py`; still correctly left flagged, not fixed.
- **Tenant isolation** — every by-id read/update/delete across forms, fields,
  integrations, and submissions filters `organization_id` or resolves through
  an org-scoped parent; `_entity_in_org` is the shared helper for
  submitter-mapped FKs. No new endpoint or write path since pass 2.
- **LIKE escaping** — `get_forms` and `search_members` both use
  `like_pattern()` + `escape=LIKE_ESCAPE_CHAR` on every `ilike()` call,
  including the `func.concat()` name matcher.
- **`search_members` email disclosure** — gated on `ContactPolicy`, matching
  the directory's own visibility rules; unconditional email matching only
  when the policy discloses it unconditionally.

### Completion gate (pass 3)

| Check                                             | Result                                                    |
| ------------------------------------------------- | --------------------------------------------------------- |
| `flake8 app/ tests/ alembic/`                     | ✅ 0 violations                                           |
| `black --check app/ tests/ alembic/`              | ✅ clean (after reformatting the new test file)           |
| `isort --check-only app/ tests/ alembic/`         | ✅ clean                                                  |
| `python3 scripts/validate_migrations.py --strict` | ✅ passed (no migration this pass)                        |
| `pytest tests/ -q -k form`                        | ✅ 436 passed, 1 skipped (pywebpush, environment-only)    |
| `pytest tests/` (full suite)                      | ✅ 11,472 passed, 21 skipped (environment-only), 0 failed |
| `tsc --noEmit` / `eslint .`                       | n/a — no frontend file touched this pass                  |

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
