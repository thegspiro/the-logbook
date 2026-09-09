# Application Review — Email Templates & Delivery

**Prefix:** `MAIL` · **Iteration:** A4 · **Reviewed:** 2026-08-05 (pass 1),
2026-08-08 (pass 2), 2026-09-09 (pass 5)

## Pass 5 (2026-09-09) — the send path's org filter, and two smaller repairs

**2 fixed (1 MED, 1 LOW), 1 flagged (LOW).** The feature has grown ~970 lines
since pass 2 — endpoints 671 → 904 L (11 → 13 routes), the template service
2,739 → 3,247 L, `email_service` 1,633 → 1,862 L — so unlike the previous
iteration there was genuinely new ground: the footer library, the layout /
colourway / status-chip fields, and the two footer endpoints.

> **Finding ids start at MAIL-20.** `MAIL-1 … MAIL-5` are used by **both** this
> file and `docs/security-review/MSG-25-messaging-notifications.md`, and
> `FORM-26-forms.md` cites a `MAIL-4` of its own. Same structural problem
> recorded for `SF-`, `AUTH-` and `CRON-`; giving each track its own prefix is
> an owner call, not something to rename unilaterally across six documents.

### MAIL-20 — MED — A decommissioned department keeps mailing its members — ✅ FIXED

**What:** `_run_scheduled_emails_inner` selected every `PENDING` `ScheduledEmail`
whose time had come, across all organizations, with **no `Organization.active`
filter**. Its only organization check is `if not org` (`scheduled_tasks.py:3564`),
which catches a _deleted_ row and not a deactivated one.

**Where:** `backend/app/services/scheduled_tasks.py:3520` (the query).

**Impact:** an organization switched off — offboarded, closed, non-paying —
keeps sending every scheduled email still queued against it, to its former
members. The send is real: the runner renders the template and calls
`EmailService.send_email`, and nothing downstream re-checks the org.

**This is a known shape that had already been closed next door.** CRON2-31-11 /
CRON-31-5 established it, and the sibling `run_publish_scheduled_messages` — the
same "due row, org-keyed, fans out to members" pattern for department _messages_
— was fixed as CRON3-31-1 two days before this pass, with a comment naming the
shape. Scheduled _email_ lives in a different function, and that pass was scoped
to its own diff, so this one was never in view. Every other org-spanning loop in
`scheduled_tasks.py` already carries the filter (`:533`, `:1000`, `:1290`,
`:1493`, …).

**Fix:** joined to `Organization` and filtered `active.isnot(False)` — `isnot`
rather than `== True`, matching the file's convention, so a row whose flag was
never populated still counts as active. Filtered rather than retired: an
inactive org's rows stay `PENDING`, so a department that is switched back on
keeps what it had queued instead of this task having destroyed it in passing.

**Reproduced.** `tests/test_scheduled_email_active_org.py` asserts a deactivated
org's due email is left strictly alone. Against the unfixed code it fails with
the row's status having moved to `failed` and `total_processed: 1` — i.e. the
row _was_ picked up and put through the send path. Note which assertion does the
work: `result["sent"] == 0` holds either way in a test environment with email
disabled, so the meaningful check is that the row's status is untouched. A
second test asserts an **active** org's due email is still processed, so the
fix cannot degenerate into filtering everything out.

### MAIL-21 — LOW — Attachment deletion blocked the event loop and could orphan its own row — ✅ FIXED

**What:** `delete_attachment` did two things the same module already does
correctly elsewhere:

1. **Blocking `os.path.isfile` / `os.remove` directly in an async handler**
   (`email_templates.py:708-709`), 60 lines below an upload path that carefully
   wraps `makedirs` and the file write in `asyncio.to_thread`.
2. **Removed the file _before_ committing the row delete.** If the commit then
   failed, the row survived pointing at a file that was already gone — and that
   row is loaded by the send path, so the next email using the template fails on
   a missing attachment.

**Where:** `backend/app/api/v1/endpoints/email_templates.py:707-712`.

**Impact:** the blocking calls are one small `unlink`, so the event-loop stall is
real but slight. The ordering is the substantive half: it converts a transient
database failure into a permanently broken template.

**Fix:** capture the path and filename first, delete the row and commit, then
remove the file in a thread, tolerating `OSError`. The failure mode inverts from
"row pointing at a missing file" (breaks sending) to "orphaned file on disk"
(wasted bytes).

### MAIL-22 — LOW — The detected MIME type is validated and then thrown away — 🚩 FLAGGED

**What:** `upload_attachment` sniffs the real MIME with `detect_mime_type`
(`:616`), uses it to accept or reject (`:623`) — and then persists
`content_type=file.content_type` (`:665`), the **client's claim**, which is what
the send path attaches the file as.

**Where:** `backend/app/api/v1/endpoints/email_templates.py:616` vs `:665`.

**Impact:** low, and bounded by who can reach it — the uploader already holds
`settings.manage`. But extension and content are validated against two
independent allowlists and never against _each other_, so a file named `.pdf`
whose bytes are `image/svg+xml` satisfies both and is then mailed out declared
as `application/pdf`. The code does the expensive, correct thing and discards
the answer.

**Fix — not applied, and the obvious one is wrong.** Simply storing
`detected_mime` would regress the Office formats: `.docx`/`.xlsx`/`.pptx` are
ZIP containers and libmagic commonly reports `application/zip` for them — which
is precisely why `ALLOWED_EMAIL_MIME_TYPES` lists both `application/zip` **and**
the three OOXML types. Storing the detected value would attach a Word document
as a zip and mail clients would present it as one. The right change is a
consistency check between the extension and the detected type (with an explicit
OOXML/zip equivalence), which is a table of pairings and a product decision
about what to do on mismatch — reject, or store the detected type. Recorded
rather than guessed at. Mirrored into `KNOWN_LIMITATIONS.md`.

### Verified good this pass

- **All 13 endpoints are gated**, uniformly on `settings.manage` **or**
  `organization.update_settings`, enumerated by AST rather than grep (pass 2's
  note that the multi-line dependency defeats a line-oriented grep still
  applies, and the count has since moved 11 → 13).
- **The footer library, new since pass 2, is correct on both counts this
  codebase gets wrong.** Writes deep-copy `Organization.settings` before
  touching a nested key (`email_templates.py:139`, CLAUDE.md pitfall #12), and
  the whole library is saved as a unit precisely so `default_key` cannot name a
  footer the same request deleted. Rendering escapes admin-entered line text
  _and_ the substituted values (`email_footers.py:184-205`, `:252-266`).
- **XC-1 is closed on both scheduled-email write paths.** `schedule_email`
  validates a client-supplied `template_id` with `assert_in_org` before storing
  it (`:761-774`), the send task re-scopes it at load time
  (`scheduled_tasks.py:3574-3582`), and `update_scheduled_email` accepts only a
  reschedule or a cancel — there is no path that swaps `template_id` after the
  fact, which is where this class of gap usually survives.
- **The scheduled-email send path does _not_ have the "marked sent, nothing
  delivered" bug** that its cron neighbours still carry (CRON-31-7): it branches
  on `success_count > 0` and records `FAILED` with a message otherwise
  (`scheduled_tasks.py:3647-3653`).
- **The attachment upload is properly hardened** — extension allowlist,
  magic-byte MIME check that **fails closed** with a 503 when libmagic is
  missing (the MAIL-3 fix, still in place), UUID storage filename, per-org
  directory, 10 MB cap — and the delete is org-scoped through a join to the
  template.

### Re-verified, still open

- **MAIL-4 — arbitrary recipients.** `schedule_email` still accepts any
  `to_emails`/`cc_emails`/`bcc_emails` the caller supplies, with no restriction
  to organization members. Unchanged, and still the standing CS-9 policy call
  rather than a defect.
- **A PATCH carrying an unrecognised `status` silently succeeds.**
  `update_scheduled_email` acts only on the literal `"cancelled"` (`:850`);
  any other value returns 200 with an empty `changes` list and nothing written.
  Harmless today (the row cannot be un-cancelled — a non-`PENDING` row is
  rejected earlier) but it is a silent no-op of the kind the checklist's
  correctness lens names. Not fixed: tightening it to a 400 changes a public
  response code.

### Pass 5 scope

Read this pass: all 13 endpoints (AST-enumerated for gating), the footer
endpoints and `email_footers.py` in full, the attachment upload and delete in
full, all four scheduled-email endpoints, and `_run_scheduled_emails_inner` end
to end.

**Not re-read**, and carrying no pass-5 verdict: the rendering core
(`render`, `render_static`, `_replace_variables`, `_RAW_HTML_VARIABLES`) and
`email_service`'s header/send path — both read in full by passes 1 and 2, whose
MAIL-1/MAIL-2/MAIL-5 conclusions this pass did not disturb — and the ~20 default
template bodies, which remain content rather than logic.

### Pass 5 completion gate

| Check          | Result                                                |
| -------------- | ----------------------------------------------------- |
| tsc --noEmit   | ✅ 0 errors                                           |
| flake8         | ✅ 0 violations (`app/ tests/`)                       |
| black --check  | ✅ clean                                              |
| eslint         | ✅ 0 errors, 2 pre-existing warnings (limit 10)       |
| frontend tests | n/a — no frontend file changed this pass              |
| backend tests  | ✅ **full suite** 11,924 passed, 21 skipped, 0 failed |

The full suite was run rather than the email slice (1,490 passed on its own)
because the MAIL-20 fix lands in `scheduled_tasks.py`, which the whole cron
surface shares.

## Pass 2 (2026-08-08) — six-lens sweep

Re-verified pass-1: 11 endpoints gated; every `_RAW_HTML_VARIABLES` member escapes
at construction; `_sanitize_header` defends SMTP header injection; `run_scheduled_emails`
holds the Redis overlap lock; MAIL-1 (subject/text not escaped in the primary
`render()`) and MAIL-2 (schedule `template_id` org-scoped both ends) hold. Lenses 1–6
clean on the primary paths (no update-bypass — `update_template` uses an
`allowed_fields` whitelist; no cross-org read/write — every mutation resolves the
target `id + organization_id`; no latent-500 — variable substitution is regex, not
Jinja, so missing vars can't `KeyError`). **1 fix.**

### MAIL-5 — LOW — The code-default fallback render re-introduced the MAIL-1 over-escaping — ✅ FIXED

MAIL-1 fixed `render()` so the subject line and text/plain body aren't HTML-escaped
(only the HTML body is). But the sibling **`_render_with_fallback`** path (reached
when no DB template loads) used an inline `_replace()` with **no `escape` flag** and
always escaped — so on that path a member `O'Brien` mailed as `O&#x27;Brien` and
`Fire & Rescue` as `Fire &amp; Rescue` in the `Subject:` header and text alternative.
**Fix:** gave the inline `_replace` the same `escape` flag, off for subject + text,
on for HTML — the XSS boundary on the HTML body is untouched (verified an `O'Brien`
apostrophe still escapes there). 1 DB-free regression test (`test_email_fallback_render.py`).

**Flagged (unchanged, policy):** MAIL-4 (arbitrary recipients — the CS-9 policy
call). MAIL-3's residual (the `except ImportError: pass` extension-only degrade)
is also since fixed — see the ✅ FIXED entry below (2026-08-31); `.svg` remains
an intentional allowance, not a gap.

---

**Backend:** `app/api/v1/endpoints/email_templates.py` (671 L, 11 endpoints),
`app/services/email_template_service.py` (2739 L),
`app/services/email_service.py` (1633 L),
`app/services/email_templates_storefront.py` (512 L)
**Frontend:** template admin under the membership module
**Docs:** template variables are self-documented via `TEMPLATE_VARIABLES` /
`SAMPLE_CONTEXT`

---

## Scope

All 11 endpoints enumerated for gating via AST (the permission dependency spans
multiple lines, so a line-oriented grep reports zero — worth knowing for future
iterations). Read in full: the rendering core (`render`, `render_static`,
`_replace_variables`, `_RAW_HTML_VARIABLES`), the header/send path in
`email_service`, the scheduled-email endpoints and their cron processor, and the
attachment upload.

Not read line-by-line: the ~20 default template bodies (they are content, and
the escaping contract is enforced centrally by the renderer, which _was_ read).

## Verified good ✅

- **All 11 endpoints gated uniformly** on `settings.manage` **or**
  `organization.update_settings`. No route is left open, and the pairing is
  consistent — there is no repeat of ORU-2, where a narrow permission reached a
  broad settings body.
- **The escaping design is right, and the raw allowlist is honest.**
  `_replace_variables` escapes every `{{variable}}` by default, with an explicit
  `_RAW_HTML_VARIABLES` allowlist for system-generated fragments. Every member
  of that allowlist was traced to its producer and **all of them escape at
  construction**: `custom_message_html` is `html.escape`d then wrapped
  (`email_service.py:1115`); `ballot_recipients_html` escapes name and email
  (`election_service.py:6475`); `skipped_voters_html` escapes name and reason
  (`election_service.py:6540`); `organization_logo_img` escapes both URL and alt
  text. This is the class that produced MSG-1, EV-2, CS-6 and CI-7 elsewhere —
  here it is handled correctly and centrally.
- **SMTP header injection is defended at the send layer.**
  `_sanitize_header` strips CR/LF/NUL from the subject and from-name before they
  become headers (`email_service.py:37`). This is what makes MAIL-1's fix safe:
  removing HTML-escaping from the subject does not open header injection,
  because escaping never defended that in the first place — `html.escape` does
  not touch `\r\n`.
- **Attachment upload is reasonably hardened** — the template is fetched
  org-scoped before anything else, `allow_attachments` is honored, there is a
  10 MB cap, and an extension allowlist blocks executable/script types.
- **`run_scheduled_emails` holds a Redis lock** (`lock:run_scheduled_emails`,
  120 s TTL) so overlapping cron triggers cannot double-send. This is the guard
  A3 recorded as generally missing across the task set — this task has it.
- **`PATCH /scheduled/{id}` cannot repoint the template.** `ScheduledEmailUpdate`
  exposes only `scheduled_at` and `status`, so `POST /schedule` is the single
  entry point for `template_id` — which is what makes the MAIL-2 fix complete.
- **`email_templates_storefront.py` is not duplication** — resolving the
  question A1 raised. It is a _data_ module of default template definitions
  whose `TEMPLATE_VARIABLES`, `SAMPLE_CONTEXT`, `RAW_HTML_VARIABLES` and
  `DEFAULT_TEMPLATE_DEFS` are imported and merged into the main service
  (`email_template_service.py:19, 365, 751, 2434, 2722`). A clean extension
  point with an unusually good docstring explaining why the `_html` variables
  exist. **No action.**

## Findings

### MAIL-1 — MED — Subject lines and plain-text bodies were HTML-escaped — ✅ FIXED

**What:** `render()` passed all three outputs through the same escaping
`_replace_variables`. Two of them are not markup: the `Subject:` header and the
`text/plain` alternative.

**Where:** `email_template_service.py:2337–2341`.

**Impact:** user-visible corruption in every templated email. Demonstrated:

```
SUBJECT : Welcome to Falls Church Fire &amp; Rescue, Sean O&#x27;Brien
TEXT    : Hi Sean O&#x27;Brien at Falls Church Fire &amp; Rescue.
```

Any apostrophe, ampersand, quote or angle bracket in a member name, department
name, event title or election title rendered as an entity — in the **subject
line**, which is the first thing a recipient sees, and throughout the plain-text
alternative that many clients and all screen readers use. An organization whose
name contains "&" had it mangled in every email it ever sent.

There was a second-order effect: because the subject arrived at the HTML wrapper
already escaped, `<title>{escape(subject)}</title>` and the `aria-label` escaped
it **twice**, so an ampersand reached the document as `&amp;amp;`.

**Fix:** `_replace_variables` takes `escape_html: bool = True`; `render()` passes
`escape_html=False` for the subject and text body only. The HTML body path is
untouched, so the XSS boundary is unchanged — verified by asserting an
`<img src=x onerror=…>` payload is still escaped in the HTML body while the
subject and text render cleanly. The `<title>`/aria-label escape now applies
exactly once, fixing the double-escape as a side effect.

**Safety:** confirmed the subject cannot carry a header injection —
`_sanitize_header` strips CR/LF/NUL at the send layer, and did so before this
change too.

### MAIL-2 — MED — Cross-org template disclosure via a scheduled email — ✅ FIXED

**What:** two gaps on the same client-supplied id. `POST /schedule` stored
`body.template_id` with **no org validation** (XC-1), and the cron processor
then loaded it with **no org filter** (XC-3):

```python
select(EmailTemplate)
    .where(EmailTemplate.id == item.template_id)      # no organization_id
    .options(selectinload(EmailTemplate.attachments)) # ← and its files
```

**Where:** `email_templates.py` `schedule_email`;
`scheduled_tasks.py` `run_scheduled_emails`.

**Impact:** an admin in org A could schedule an email naming org B's
`template_id`. The processor would load org B's template — subject, full HTML
body, and its **eager-loaded uploaded attachments** — render it, and send it to
recipients org A supplies in the same request (`to_emails` is client-controlled).
That is a cross-tenant disclosure of another department's template content and
attached files, exfiltrated to an address of the caller's choosing. It is
exactly the MM-1 shape (a foreign `template_id` persisted and eager-loaded
without an org filter), recurring in a module the module-audit rotation never
covered.

**Fix:** both layers, mirroring how FIN-1 was closed. `schedule_email` now calls
`assert_in_org(db, EmailTemplate, template_id, org)` — the shared helper from
`app/utils/org_scoping.py`, which fails closed and 400s without confirming
whether the id exists elsewhere. The processor's lookup is additionally
org-scoped, which also neutralizes any row already stored with a foreign id.

### MAIL-3 — LOW — Attachment validation is extension-only — ✅ FIXED (superseded)

**What:** the upload checked the filename extension against an allowlist but did
not sniff magic bytes, unlike the documents module (DOC finding set) and the
storefront product-image upload, which both verify content type from the bytes.

**Impact:** low. The file is stored and attached to outgoing mail, never
executed or rendered server-side, and the allowlist blocks executable
extensions. The realistic case was a mislabeled file (an `.exe` renamed `.pdf`)
being mailed to members over the department's own domain, which is a
reputational rather than a technical compromise.

**Status (2026-08-31, security-review MSG-25 pass 2):** fixed since this entry
was written, in a commit this doc never separately tracked. `upload_attachment`
(`email_templates.py`) now calls `detect_mime_type` on the uploaded bytes and
rejects anything not in an explicit `ALLOWED_EMAIL_MIME_TYPES` set — and fails
**closed** with a 503 (not the extension-only degrade the pass-2 summary above
flagged as residual) when libmagic itself is unavailable. Re-verified directly
in `backend/app/api/v1/endpoints/email_templates.py:595-634`. Original entry
kept below for the record of what was decided and why.

**Why it had not been fixed when this was written:** the codebase has a
magic-byte validator, but wiring it in means deciding the policy for the long
tail of allowed office formats (a `.docx` is a zip; a `.xls` is OLE2), and
getting that wrong would reject legitimate attachments. That policy call was
made (13 explicit MIME types, matching the extension allowlist) rather than
left as a drive-by.

### MAIL-4 — LOW — Scheduled email accepts arbitrary recipients — 🚩 FLAGGED

**What:** `to_emails` / `cc_emails` / `bcc_emails` on `POST /schedule` are
client-supplied with no allowlist and no requirement that they be org members.

**Impact:** a `settings.manage` holder can send org-branded, org-templated mail
to any address. This is the **same open policy decision already recorded as
CS-9** ("report emailing accepts client-supplied recipients with no allow-list —
exfiltration path, but external auditors are a legitimate case"). Recording it
here for the same reason it was left open there: mailing outside the
organization (insurers, auditors, vendors) is a legitimate use, so an allowlist
is a product decision, not a bug fix. Not re-derived — cross-referenced.

## Duplication

None requiring action; see the `email_templates_storefront.py` note under
_Verified good_, which closes the question A1 raised.

## Dead code

None found. All 11 endpoints have callers, `render_static` is a documented
no-DB-session variant of `render` used where the template is already loaded, and
no unreferenced service methods surfaced.

## Documentation gaps

- The renderer's docstring claimed "All values are HTML-escaped" while also
  being applied to non-HTML destinations. Updated as part of MAIL-1 to state
  which destination gets which treatment and why — the corrected doc is the
  thing that stops the bug being reintroduced.
- **Not fixed:** nothing documents that template _bodies_ are trusted HTML
  authored by admins while template _variables_ are escaped. That distinction
  is the whole security model of this feature and currently exists only as
  implementation detail.

## Future development

1. **No test asserted the subject/text contract before this iteration** — the
   existing suite covered HTML escaping thoroughly (which is why that half was
   correct) and never checked the other two outputs. 7 tests added; 3 of them
   verified to fail against the pre-fix code.
2. ~~Magic-byte attachment validation (MAIL-3), once the office-format policy
   is decided.~~ Done — see MAIL-3 ✅ FIXED (2026-08-31).
3. **Scheduled emails have no send-time preview or dry run.** An admin schedules
   a template + context blob and finds out whether it rendered correctly when
   members receive it. `POST /{id}/preview` exists for templates but is not
   reachable from the scheduling flow.
4. **No per-org send quota.** The department-message path has an escalation
   throttle (`_EMAIL_ESCALATION_LIMIT`); scheduled emails have none, so a loop
   that creates scheduled rows has no backstop.
5. **`ScheduledEmail.context` is an unvalidated JSON blob.** Whatever keys it
   carries are substituted into the template. Unknown variables render empty
   (safe), but there is no feedback when a context is missing a key the template
   needs — the member simply receives an email with a blank where their name
   should be.

## Completion gate

| Check                | Result                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsc --noEmit`       | ✅ 0 errors (no frontend change)                                                                                                            |
| `flake8 app/ tests/` | ✅ 0 violations                                                                                                                             |
| `black --check`      | ✅ 502 files unchanged                                                                                                                      |
| `eslint`             | ✅ clean                                                                                                                                    |
| backend tests        | ✅ **2508 passed, 0 failed** (was 2501 — 7 tests added). 648 errors, all `db_session` fixture failures against the sandbox's missing MySQL. |
| new tests            | ✅ 7 added to `tests/test_email_template_render.py`; 3 verified to fail against the pre-fix renderer                                        |

</content>
