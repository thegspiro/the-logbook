# Application Review — Email Templates & Delivery

**Prefix:** `MAIL` · **Iteration:** A4 · **Reviewed:** 2026-08-05

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
the escaping contract is enforced centrally by the renderer, which *was* read).

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
  question A1 raised. It is a *data* module of default template definitions
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

### MAIL-3 — LOW — Attachment validation is extension-only — OPEN

**What:** the upload checks the filename extension against an allowlist but does
not sniff magic bytes, unlike the documents module (DOC finding set) and the
storefront product-image upload, which both verify content type from the bytes.

**Impact:** low. The file is stored and attached to outgoing mail, never
executed or rendered server-side, and the allowlist blocks executable
extensions. The realistic case is a mislabeled file (an `.exe` renamed `.pdf`)
being mailed to members over the department's own domain, which is a
reputational rather than a technical compromise.

**Why not fixed:** the codebase has a magic-byte validator, but wiring it in
means deciding the policy for the long tail of allowed office formats (a
`.docx` is a zip; a `.xls` is OLE2), and getting that wrong would reject
legitimate attachments. Worth doing deliberately rather than as a drive-by.

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
*Verified good*, which closes the question A1 raised.

## Dead code

None found. All 11 endpoints have callers, `render_static` is a documented
no-DB-session variant of `render` used where the template is already loaded, and
no unreferenced service methods surfaced.

## Documentation gaps

- The renderer's docstring claimed "All values are HTML-escaped" while also
  being applied to non-HTML destinations. Updated as part of MAIL-1 to state
  which destination gets which treatment and why — the corrected doc is the
  thing that stops the bug being reintroduced.
- **Not fixed:** nothing documents that template *bodies* are trusted HTML
  authored by admins while template *variables* are escaped. That distinction
  is the whole security model of this feature and currently exists only as
  implementation detail.

## Future development

1. **No test asserted the subject/text contract before this iteration** — the
   existing suite covered HTML escaping thoroughly (which is why that half was
   correct) and never checked the other two outputs. 7 tests added; 3 of them
   verified to fail against the pre-fix code.
2. **Magic-byte attachment validation** (MAIL-3), once the office-format policy
   is decided.
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

| Check | Result |
|-------|--------|
| `tsc --noEmit` | ✅ 0 errors (no frontend change) |
| `flake8 app/ tests/` | ✅ 0 violations |
| `black --check` | ✅ 502 files unchanged |
| `eslint` | ✅ clean |
| backend tests | ✅ **2508 passed, 0 failed** (was 2501 — 7 tests added). 648 errors, all `db_session` fixture failures against the sandbox's missing MySQL. |
| new tests | ✅ 7 added to `tests/test_email_template_render.py`; 3 verified to fail against the pre-fix renderer |
</content>
