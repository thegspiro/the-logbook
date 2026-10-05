# Custom Forms Module

Comprehensive form builder with public-facing forms, cross-module integrations, and security hardening.

## Overview

The Forms module allows organizations to create custom forms for both internal workflows and public-facing data collection. Forms can be linked to other modules (Membership, Inventory) to automatically process submissions.

### Key Capabilities

- **15+ Field Types**: Text, textarea, email, phone, number, date, time, datetime, select, multiselect, checkbox, radio, file, signature, section_header, member_lookup
- **Public Forms**: Share forms via unique URLs or QR codes without requiring authentication
- **Cross-Module Integrations**: Route form submissions to Membership or Inventory modules
- **Submission Management**: View, filter, and manage all submissions
- **Security**: Input sanitization, rate limiting, bot detection, and type validation

---

## Architecture

### Database Models

| Model             | Description                                                                      |
| ----------------- | -------------------------------------------------------------------------------- |
| `Form`            | Form definition with name, description, category, status, public access settings |
| `FormField`       | Individual fields within a form with type, validation rules, and display options |
| `FormSubmission`  | Submitted form data with metadata (submitter info, IP, timestamps)               |
| `FormIntegration` | Links a form to a target module with field mappings                              |

### Enums

| Enum                | Values                                                                                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FormStatus`        | `draft`, `published`, `archived`                                                                                                                                                 |
| `FormCategory`      | `Operations`, `Membership`, `Training`, `Compliance`, `Events`, `HR`, `Finance`, `Custom`                                                                                        |
| `FieldType`         | `text`, `textarea`, `number`, `email`, `phone`, `date`, `time`, `datetime`, `select`, `multiselect`, `checkbox`, `radio`, `file`, `signature`, `section_header`, `member_lookup` |
| `IntegrationTarget` | `membership`, `inventory`                                                                                                                                                        |
| `IntegrationType`   | `membership_interest`, `equipment_assignment`                                                                                                                                    |

### Key Files

| File                                    | Purpose                                              |
| --------------------------------------- | ---------------------------------------------------- |
| `backend/app/models/forms.py`           | SQLAlchemy models for all forms tables               |
| `backend/app/schemas/forms.py`          | Pydantic request/response schemas                    |
| `backend/app/services/forms_service.py` | Business logic, sanitization, integration processing |
| `backend/app/api/v1/endpoints/forms.py` | Authenticated API endpoints                          |
| `backend/app/api/public/forms.py`       | Public (no-auth) API endpoints                       |
| `frontend/src/pages/FormsPage.tsx`      | Admin interface for managing forms                   |
| `frontend/src/pages/PublicFormPage.tsx` | Public-facing form renderer                          |

---

## Form Lifecycle

```
Draft  ──(publish)──>  Published  ──(archive)──>  Archived
  ^                        |                          |
  |                        v                          |
  +────────────────── (unpublish) ────────────────────+
```

- **Draft**: Form is being built. Not accepting submissions.
- **Published**: Form is live and accepting submissions. If `is_public` is enabled, accessible via public URL.
- **Archived**: Form is no longer accepting submissions. Historical submissions are preserved.

---

## API Endpoints

### Authenticated Endpoints (require `forms.view` or `forms.manage`)

| Method   | Path                                    | Permission     | Description                      |
| -------- | --------------------------------------- | -------------- | -------------------------------- |
| `GET`    | `/api/v1/forms/`                        | `forms.view`   | List all forms (with filtering)  |
| `POST`   | `/api/v1/forms/`                        | `forms.manage` | Create a new form                |
| `GET`    | `/api/v1/forms/summary`                 | `forms.view`   | Get forms summary statistics     |
| `GET`    | `/api/v1/forms/member-lookup?q=`        | authenticated  | Search members for lookup fields |
| `GET`    | `/api/v1/forms/{id}`                    | `forms.view`   | Get form details with fields     |
| `PATCH`  | `/api/v1/forms/{id}`                    | `forms.manage` | Update a form                    |
| `DELETE` | `/api/v1/forms/{id}`                    | `forms.manage` | Delete a form                    |
| `POST`   | `/api/v1/forms/{id}/publish`            | `forms.manage` | Publish a form                   |
| `POST`   | `/api/v1/forms/{id}/archive`            | `forms.manage` | Archive a form                   |
| `POST`   | `/api/v1/forms/{id}/fields`             | `forms.manage` | Add a field                      |
| `PATCH`  | `/api/v1/forms/{id}/fields/{fid}`       | `forms.manage` | Update a field                   |
| `DELETE` | `/api/v1/forms/{id}/fields/{fid}`       | `forms.manage` | Delete a field                   |
| `POST`   | `/api/v1/forms/{id}/fields/reorder`     | `forms.manage` | Reorder fields                   |
| `POST`   | `/api/v1/forms/{id}/submit`             | authenticated  | Submit a form (internal)         |
| `GET`    | `/api/v1/forms/{id}/submissions`        | `forms.manage` | List submissions                 |
| `GET`    | `/api/v1/forms/{id}/submissions/{sid}`  | `forms.manage` | Get submission detail            |
| `DELETE` | `/api/v1/forms/{id}/submissions/{sid}`  | `forms.manage` | Delete a submission              |
| `POST`   | `/api/v1/forms/{id}/integrations`       | `forms.manage` | Add integration                  |
| `PATCH`  | `/api/v1/forms/{id}/integrations/{iid}` | `forms.manage` | Update integration               |
| `DELETE` | `/api/v1/forms/{id}/integrations/{iid}` | `forms.manage` | Delete integration               |

### Public Endpoints (no authentication required)

| Method | Path                                 | Rate Limit | Description             |
| ------ | ------------------------------------ | ---------- | ----------------------- |
| `GET`  | `/api/public/v1/forms/{slug}`        | 60/min/IP  | Get public form by slug |
| `POST` | `/api/public/v1/forms/{slug}/submit` | 10/min/IP  | Submit public form      |

---

## Public Forms

### How It Works

1. **Create a form** in the admin interface
2. **Enable public access** via the **Share Form** dialog (toggle "Public Access" on)
3. **Decide who may submit** — tick **Allow submissions without signing in** in
   the same dialog to accept anonymous submissions; leave it off to accept
   signed-in members only
4. **Publish the form** to make it live
5. **Share the URL** or **print the QR code** for physical distribution

### Who may submit _(2026-09-29, notice 2026-10-03)_

Opening a public form and submitting it are separate. `Form.require_authentication`
defaults to **true** (model default, unchanged), so a new form accepts
submissions only from a signed-in member of its organization even when
`is_public` is on: `POST /api/public/v1/forms/{slug}/submit` answers
`401 Authentication is required to submit this form.` without a session. A
form with `allow_multiple_submissions = false` needs a session whatever
`require_authentication` says, because "once each" needs a stable identity.

- **The Share dialog's "Allow submissions without signing in" checkbox** sends
  `require_authentication` through `PATCH /forms/{id}` (#2811). The backend had
  always accepted the field; only the control was missing, so before this every
  public form refused signed-out visitors while the dialog promised "no login
  required". The checkbox is disabled, with the reason shown, on a
  one-submission-per-person form. No default changed and no migration ran, so
  forms made public earlier still require a sign-in until a manager ticks it.
- **The public page says so before the visitor starts** (W60-11, #2887).
  `PublicFormPage` resolves the session the way `ProtectedRoute` does
  (`loadUser`, which calls the server only when `has_session` is set). When the
  form needs a signed-in member and the visitor is not one, a **Sign in to
  submit this form** notice sits above the questions with a **Sign in** link
  that returns to `/f/<slug>`. A 401 from the submit shows the same notice,
  which covers a stale `has_session` flag. Who may submit is unchanged; the
  owner chose the notice over changing the default.
- **Integrations still see anonymity, not the URL.** `submit_public_form`
  calls `_process_integrations(..., is_public=submitted_by is None)`, so a
  signed-in member submitting through `/f/<slug>` is treated as an internal
  submission by modules' public-intake gates.

### Public URL Format

```
https://your-instance.com/f/{12-char-hex-slug}
```

Each form is assigned a unique 12-character hex slug on creation (e.g., `a1b2c3d4e5f6`).

### QR Codes

The Share modal generates a QR code for any public form. Features:

- High error correction (Level H) for reliable scanning from printed materials
- Downloadable as PNG (for documents) or SVG (for scalable printing)
- Designed to be printed and placed in physical locations (inventory rooms, station entrances, bulletin boards)

### Public Form Page

The public form page (`/f/:slug`) is a standalone React page with:

- Light theme (white background, blue accents) distinct from the internal dark theme
- Organization name and form description header
- All field types rendered with HTML5 input types
- A sign-in notice when the form needs a signed-in member (see above)
- Loading, error, and success states (**Response Submitted** — "Your response
  was saved.")
- "Submit Another Response" option for multi-submission forms
- "Powered by The Logbook" footer

---

## Cross-Module Integrations

### Membership Interest

When a public form has a **Membership** integration:

- Form submissions are stored with mapped fields (e.g., form "Full Name" -> membership "first_name")
- Data is available for admin review in the submissions list
- Marked with `integration_processed = true` and results stored in `integration_result`

### Equipment Assignment

When an internal form has an **Inventory** integration:

- Uses `member_lookup` fields to reference existing members
- On submission, calls `InventoryService.assign_item_to_user()` with mapped field values
- Automatically links equipment to the selected member

### Field Mappings

Integrations use a JSON `field_mappings` object that maps form field IDs to target module field names:

```json
{
  "field-uuid-for-name": "first_name",
  "field-uuid-for-email": "email",
  "field-uuid-for-phone": "phone"
}
```

---

## Security

### Input Sanitization

All form submissions (both public and authenticated) pass through `_sanitize_submission_data()`:

1. **Unknown field IDs rejected**: Values for field IDs not in the form definition are silently dropped
2. **Null byte removal**: `\x00` characters stripped
3. **HTML escaping**: All values passed through `html.escape()` before storage
4. **Length limits**: Per-field-type maximums (5K text, 50K textarea, 254 email)
5. **Type validation**:
   - Email: Format regex + header injection check (no newlines)
   - Phone: Character whitelist (digits, +, -, (), spaces)
   - Number: Parsed as float, min/max range enforced
   - Select/Radio: Value must be in the field's allowed options
   - Checkbox: Each comma-separated value must be in allowed options
6. **Validation patterns**: Custom regex patterns per field
7. **Required fields need a real answer**: A field marked required is only
   satisfied by a non-empty value — an empty or whitespace-only text entry, or a
   multi-select with nothing chosen, is rejected as missing (not merely the key
   being present). Number and checkbox fields answered with `0` or "unchecked"
   still count as answered.

### Public Form Protection

| Layer           | Protection                                                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Rate Limiting   | 60 views/min, 10 submits/min per IP                                                                                     |
| Daily Cap       | Per-form daily limit (`PUBLIC_FORM_DAILY_LIMIT`) counted against **valid submissions only**; exceeding it returns `429` |
| Honeypot        | Hidden "website" field catches bots                                                                                     |
| Slug Validation | Strict `^[a-f0-9]{12}$` pattern prevents injection                                                                      |
| Sanitization    | HTML escape + type validation on all data                                                                               |
| DOMPurify       | Frontend strips all HTML from server text                                                                               |
| Data Isolation  | Public submissions flagged, IP/UA captured                                                                              |

> **Daily cap semantics** _(2026-08-16)_: the cap is enforced inside
> `FormsService.submit_public_form` (`enforce_daily_cap=True`), **after**
> authorization, honeypot, and validation. Bots tripping the honeypot and
> rejected payloads no longer consume the form's daily allowance, so an
> anonymous flood cannot exhaust the quota and deny service to legitimate
> submitters. Honeypot hits still receive a fake success response. The public
> rate limiter also falls back to an in-memory limiter when Redis errors
> _(2026-08-16)_ rather than failing open.

### Frontend Defense

- All server-provided text sanitized through DOMPurify before display
- Honeypot field positioned off-screen with `aria-hidden` and `tabIndex={-1}`
- Public form page has no access to authenticated application state or tokens

---

## Starter Templates

### Membership Interest Form (Public)

Pre-configured with 15 fields:

- Personal info (name, email, phone, address)
- Experience and availability
- Emergency contact
- Motivation (textarea)
- Designed for public access with membership integration

### Equipment Assignment Form (Internal)

Pre-configured with 10 fields:

- Member lookup field (searches existing members)
- Equipment details (type, serial number, condition)
- Assignment metadata (date, notes, acknowledgment)
- Designed for internal use with inventory integration

---

## Database Migrations

| Migration                                         | Description                                                                            |
| ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `20260212_0100_create_forms_tables`               | Creates `forms`, `form_fields`, `form_submissions` tables with all enums               |
| `20260212_0200_add_public_forms_and_integrations` | Adds `member_lookup` to fieldtype enum, public form columns, `form_integrations` table |

### Running Migrations

```bash
cd backend
alembic upgrade head
```

---

## Permissions

| Permission     | Grants                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `forms.view`   | View forms list, form details, submission data                                                                                                    |
| `forms.manage` | All view permissions + create/edit/delete forms, manage fields, publish/archive, configure public access, manage integrations, delete submissions |

Public form submission requires no permissions or authentication.

---

## Frontend Components

### FormsPage (Admin)

- **Stats Dashboard**: Total forms, published, draft, submissions, public forms
- **Form Cards**: Status badges, public URL with copy button, action buttons
- **Create Modal**: Form name, description, category, public toggle, starter templates
- **Share Modal** (**Share Form**): Public access toggle, **Allow submissions
  without signing in**, URL display, QR code with download (PNG/SVG). Responses
  through the public link carry a globe icon in the submissions list
- **Tabs**: **Forms** (every department form — renamed from "My Forms"
  2026-09-29), **Starter Templates**, **Submissions**
- **Integration Modal**: View/add/delete cross-module integrations with field mapping UI
- **Submissions View**: Paginated list with public/integrated badges, submitter info
- **Integration Health Dashboard**: Shows integration processing status per submission with reprocess support for failed integrations
- **Survey Results Panel**: Per-field aggregation with distribution charts for select/radio/checkbox fields and response counts for text fields
- **Form Dropdown Selector**: Dropdown-based form selection for integration configuration

### PublicFormPage

- Standalone page at `/f/:slug` (outside authenticated routes)
- Light theme for public visitors
- Full field type rendering with HTML5 inputs
- No contact section: the page collects only the form's own fields (name/email
  no longer forced — add them explicitly via the form builder). The Share dialog
  used to claim public submissions carry the submitter's name and email; that
  claim was removed 2026-09-29
- Sign-in notice for a form that needs a signed-in member
- Loading/error/success states

### FormBuilder

- **Drag-and-drop reordering**: Fields can be reordered via `@dnd-kit` drag-and-drop
- **Field duplication**: Duplicate existing fields with one click
- **Incomplete field highlighting**: Fields with missing required configuration are visually highlighted
- **Conditional visibility**: Fields can be shown/hidden based on other field values
  - **Enforced on the server too** _(2026-09-23)_, and **through every level**
    _(2026-10-02, W60-1)_. One frontend definition,
    `utils/formVisibility.ts` `getVisibleFieldIds`, serves both renderers
    (`pages/PublicFormPage.tsx`, `components/forms/FormRenderer.tsx`); its
    backend twin is `FormsService._visible_field_ids`. A field is shown only
    when its own rule passes **and** the field it branches from is shown, so a
    follow-up of a closed branch is hidden and not required — before, a
    leftover answer in a hidden parent kept its follow-up on screen and
    required (`400 Required field 'EMT card number' is missing`). Operators:
    `equals`, `not_equals`, `contains`, `not_empty`, `is_empty`. `submit_form`
    and `submit_public_form` skip the **required** check for a hidden field,
    `_sanitize_submission_data` **drops** any answer to one, and both renderers
    leave hidden answers out of the payload (they stay in state, so switching
    back restores them). An unrecognised operator counts as visible, so a bad
    rule fails closed. **Keep the two implementations identical** — if they
    disagree, the browser accepts a form the server rejects, or the reverse.
  - **`contains` on a checkbox or multi-select parent compares whole options**
    (comma-separated, case-insensitive), so "contains EMT" no longer matches
    "AEMT" (W60-2). A free-text parent still matches a substring.
  - **Rules are validated** (W60-4, W60-9): a field may not branch from itself,
    from anything that already branches from it, from a section header, or
    from a field on another form; an operator that takes a value needs one.
    The editor offers only valid parents and the API refuses the rest.
  - **Clearing saves** (W60-3): the builder sends every blank setting it owns as
    `null` on `PATCH /forms/{id}/fields/{id}` (`exclude_unset`), the service
    clears operator and value with the controlling field, and
    `FormFieldUpdate.condition_operator` has create's pattern validation.
  - **Delete confirms and releases follow-ups** (W60-6): the builder asks via
    `useConfirm`, naming the follow-ups that will be shown to everyone, and
    `FormsService.delete_field` clears their rules in the same transaction.
    Duplicate keeps the condition and number limits (W60-5); reopening a number
    field shows its limits (W60-7).
  - `_is_field_visible` survives as the **single-rule** check, used only by
    `clear_hidden_form_answers.py`, whose decisions must not move.
  - **Older submissions** can still hold hidden answers.
    `backend/scripts/clear_hidden_form_answers.py` removes them: dry run by
    default; `--apply` requires a `--backup-file` (written owner-only, never
    overwritten) before any row changes; `--restore` undoes without overwriting
    answers re-added since. It removes an answer only when the rule, applied to
    that submission's own answers, hides it **and** neither the field nor its
    controlling field was edited after the submission — no rule history is
    kept, so anything newer is skipped and listed for a person. Each change is
    audited without the answer values. See `backend/scripts/README.md`.
- **Calculated fields**: Fields that auto-compute values from other fields
- **Hidden fields**: Metadata fields not shown to the form filler
- **Novice UX**: Guided tooltips and simplified interface for first-time form builders

### FormResultsPanel

- **Per-field aggregation**: Aggregates submissions by field for survey-style analysis
- **Distribution charts**: Visual breakdowns for select, radio, and checkbox fields
- **Response counts**: Summary statistics for text and numeric fields
- Requires at least one submission to display data

---

## Integration Health & Reprocessing

### Integration Health Dashboard

The FormsPage includes an integration health view that shows:

- Processing status per submission (success, failed, pending)
- Error details for failed integrations
- **Reprocess** button to retry failed integration processing

### API Endpoints

| Method | Path                                             | Permission     | Description                    |
| ------ | ------------------------------------------------ | -------------- | ------------------------------ |
| `GET`  | `/api/v1/forms/{id}/integrations/health`         | `forms.manage` | Get integration health status  |
| `POST` | `/api/v1/forms/{id}/submissions/{sid}/reprocess` | `forms.manage` | Reprocess a failed integration |

### Field Mapping UI

Integration configuration includes a visual field mapping interface:

1. Select the target module (Membership or Inventory)
2. Choose the integration type
3. Map form fields to target module fields using dropdown selectors
4. Save the mapping — submissions are automatically processed against the mapping

---

## Recent Changes (March 2026)

### September 29 – October 3, 2026

- **Public submissions without signing in** (#2811): Share dialog checkbox for
  `require_authentication`; see [Who may submit](#who-may-submit-2026-09-29-notice-2026-10-03).
- **Sign-in notice on the public page** (#2887, W60-11).
- **Branching and builder fixes from workflow review W60** (#2866): multi-level
  visibility, whole-option `contains`, rule validation, explicit-null clears,
  confirmed delete, duplicate and number-limit fixes; the in-app renderer's
  fields are labelled and the field-type picker exposes its state. See
  `docs/workflow-review/W60-forms.md`.
- **Plain-language copy** (#2789): validation messages ("Enter a number",
  "Enter a valid email address", "Fix the errors below."), empty states,
  starter templates name what their integration does ("Sends responses to
  Membership"), the integrations dialog is **Integrations**.

### August 17, 2026

- **Auto-advance is bound to the submitting prospect**: `_auto_advance_pipeline_step` previously found _every_ `ACTIVE` prospect sitting on the matching stage and completed the step for all of them — so one applicant's submission advanced the whole cohort behind them. It now takes the `FormSubmission` as an argument and filters `ProspectiveMember.form_submission_id == submission.id`, and the audit `action_result` records `form_submission_id` alongside `form_id`. A form submission is not evidence that unrelated prospects on the same stage have completed the form

### March 14, 2026

- **Auto-advance integration with pipeline stages**: When a `form_submission` pipeline stage has `auto_advance: true` in its configuration, submitting the linked form automatically advances the prospect to the next pipeline stage. The `forms_service.py` now checks for auto-advance configuration after processing a submission linked to a pipeline stage
- **Auto-advance for document upload stages**: Similarly, `document_upload` pipeline stages with `auto_advance: true` auto-advance when all required documents are uploaded

### March 4, 2026

- **Form-to-pipeline integration hardening (13 improvements)**: Server-side validation, label-based fallback for all integration types, O(N) cleanup query optimization, field compatibility checks before save, step update lifecycle fix
- **Form data flow fix**: Fixed multiple issues where form submissions were not appearing in the prospective members pipeline — including field mapping failures on reprocessed submissions
- **Duplicate prospect detection**: Email-based duplicate detection with coordinator notification when a prospect with the same email already exists
- **Pipeline form validation**: Pre-save field compatibility check warns when form fields don't match expected pipeline field mappings
- **Form deletion protection**: Forms linked to active pipelines are protected from deletion with clear error messaging
- **form.integration_type**: Added direct label-mapping path for pipeline integrations, simplifying form-to-pipeline configuration
- **Modal click-through fix**: Modal backdrop no longer intercepts click events intended for dialog buttons (affected delete confirmations)

### March 3, 2026

- **Integration health dashboard**: Added integration health view with result display and reprocess support
- **Form dropdown selector**: New dropdown-based form selection for integration field mapping
- **Survey results panel**: New `FormResultsPanel` with per-field aggregation
- **Industry-standard form builder**: Drag-and-drop via `@dnd-kit`, field duplication, conditional visibility, calculated fields, hidden fields
- **Incomplete field highlighting**: Visual indicators for fields missing required configuration
- **Novice UX improvements**: Guided tooltips and simplified interface
- **Public form fixes**: Fixed doubled `/v1` in API URL path; removed forced name/email section
- **Permission fix**: Forms page now uses `forms.view` instead of `settings.manage`
- **Theme compatibility**: Fixed form editor background and tab text for light/dark themes

## August 12–14, 2026 event connection update

Event Settings now obtains its choices through the event-request forms
connection point rather than the general form catalog. Discovery requires event
administration, is organization-scoped, and returns public-outreach forms only.
A general form viewer therefore cannot enumerate the administrative catalog,
and a non-outreach or cross-organization form cannot be linked through this
flow. The user workflow and screenshot state are in
[Public Request Form](./training/04-events-meetings.md#public-request-form) section of the events training guide.
