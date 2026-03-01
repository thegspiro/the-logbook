# Plan: Logo in Templates, Email Scheduling, and Election Template Variables

## 1. Add organization logo as a global template variable

The Organization model already stores a `logo` field (base64 data URL or external URL) in `user.py:167`. No email template currently references it.

### Changes:

**`backend/app/services/email_template_service.py`**
- Add `organization_logo` and `organization_name` to every template type in `TEMPLATE_AVAILABLE_VARIABLES` (they're universal — every email comes from an org)
- Add sample values to every type in `SAMPLE_CONTEXT`
- Update `DEFAULT_CSS` to add a `.logo` style (centered, max-height constrained)
- Update every `DEFAULT_*_HTML` constant to include an optional logo `<img>` above the header `<h1>` — use a conditional pattern like `{{organization_logo}}` that the admin can remove if they don't want it
- Update `render()` to accept an optional `organization` parameter and auto-inject `organization_logo` + `organization_name` into the context

**`backend/app/services/email_service.py`**
- In every send method that uses the template-first pattern (`send_welcome_email`, `send_password_reset_email`): add `organization_logo` to the context dict from `self.organization.logo`
- In `send_ballot_notification()` (and other inline-only methods): wire up the template-first + fallback pattern (like `send_welcome_email` already has), and include `organization_logo` in the context

**No model/schema/migration changes** needed — the logo already lives on the Organization model.

## 2. Add email scheduling (send at specific date/time)

No email scheduling exists today — all emails send immediately. We'll add a `ScheduledEmail` model and a scheduled task to process the queue.

### Backend changes:

**`backend/app/models/email_template.py`** — New `ScheduledEmail` model:
- `id` (String PK)
- `organization_id` (FK)
- `template_id` (FK to email_templates, nullable for ad-hoc)
- `template_type` (EmailTemplateType)
- `to_emails` (JSON list)
- `cc_emails` (JSON list, nullable)
- `context` (JSON dict of template variables)
- `scheduled_at` (DateTime, timezone-aware)
- `status` (Enum: pending / sent / failed / cancelled)
- `sent_at` (DateTime, nullable)
- `error_message` (Text, nullable)
- `created_by` (FK), `created_at`, `updated_at`

**`backend/app/schemas/email_template.py`** — New schemas:
- `ScheduledEmailCreate` — to_emails, template_type or template_id, context, scheduled_at
- `ScheduledEmailResponse` — full read view
- `ScheduledEmailUpdate` — reschedule or cancel

**`backend/app/api/v1/endpoints/email_templates.py`** — New endpoints:
- `POST /email-templates/schedule` — schedule an email
- `GET /email-templates/scheduled` — list scheduled emails for the org
- `PATCH /email-templates/scheduled/{id}` — update/reschedule
- `DELETE /email-templates/scheduled/{id}` — cancel

**`backend/app/services/email_template_service.py`** — New `process_scheduled_emails()` method:
- Called by the scheduled task system
- Queries `ScheduledEmail` where `scheduled_at <= now()` and `status = 'pending'`
- For each: loads the template, renders with context, sends via EmailService, updates status to sent/failed

**`backend/app/services/scheduled_tasks.py`** — Register `process_scheduled_emails` task (runs every 5 min)

**`backend/alembic/versions/`** — New migration for the `scheduled_emails` table

### Frontend changes:

**`frontend/src/modules/communications/`**:
- New `ScheduledEmailForm` component with date/time picker and template selector
- New `ScheduledEmailList` component showing pending/sent/failed scheduled emails
- Store methods and API service calls for CRUD
- Add a "Scheduled" tab or section in the communications page
- Types for the new schemas

## 3. Add election open/close variables to ballot template

The Election model has `start_date` (voting opens) and `end_date` (voting closes) plus `positions` (JSON list). These should be template variables.

### Changes:

**`backend/app/services/email_template_service.py`**
- Add to `TEMPLATE_AVAILABLE_VARIABLES["ballot_notification"]`:
  - `voting_opens` — "Date and time voting opens"
  - `voting_closes` — "Date and time voting closes"
  - `positions` — "Positions being voted on (comma-separated)"
- Add matching sample values to `SAMPLE_CONTEXT["ballot_notification"]`
- Update `DEFAULT_BALLOT_NOTIFICATION_HTML` and `_TEXT` to display the new variables

**`backend/app/services/email_service.py`** — Update `send_ballot_notification()`:
- Add `start_date`, `end_date` (both `Optional[datetime]`) and `positions` (`Optional[List[str]]`) params
- Format with `self._format_local_dt()` and include in both the inline HTML and the context dict
- Wire up the template-first + fallback pattern (currently inline-only)

**`backend/app/services/election_service.py`** — Update the call at ~line 2697:
- Pass `election.start_date`, `election.end_date`, and `election.positions` to `send_ballot_notification()`
