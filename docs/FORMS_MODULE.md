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

| Model | Description |
|-------|-------------|
| `Form` | Form definition with name, description, category, status, public access settings |
| `FormField` | Individual fields within a form with type, validation rules, and display options |
| `FormSubmission` | Submitted form data with metadata (submitter info, IP, timestamps) |
| `FormIntegration` | Links a form to a target module with field mappings |

### Enums

| Enum | Values |
|------|--------|
| `FormStatus` | `draft`, `published`, `archived` |
| `FormCategory` | `Operations`, `Membership`, `Training`, `Compliance`, `Events`, `HR`, `Finance`, `Custom` |
| `FieldType` | `text`, `textarea`, `number`, `email`, `phone`, `date`, `time`, `datetime`, `select`, `multiselect`, `checkbox`, `radio`, `file`, `signature`, `section_header`, `member_lookup` |
| `IntegrationTarget` | `membership`, `inventory` |
| `IntegrationType` | `membership_interest`, `equipment_assignment` |

### Key Files

| File | Purpose |
|------|---------|
| `backend/app/models/forms.py` | SQLAlchemy models for all forms tables |
| `backend/app/schemas/forms.py` | Pydantic request/response schemas |
| `backend/app/services/forms_service.py` | Business logic, sanitization, integration processing |
| `backend/app/api/v1/endpoints/forms.py` | Authenticated API endpoints |
| `backend/app/api/public/forms.py` | Public (no-auth) API endpoints |
| `frontend/src/pages/FormsPage.tsx` | Admin interface for managing forms |
| `frontend/src/pages/PublicFormPage.tsx` | Public-facing form renderer |

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

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `GET` | `/api/v1/forms/` | `forms.view` | List all forms (with filtering) |
| `POST` | `/api/v1/forms/` | `forms.manage` | Create a new form |
| `GET` | `/api/v1/forms/summary` | `forms.view` | Get forms summary statistics |
| `GET` | `/api/v1/forms/member-lookup?q=` | authenticated | Search members for lookup fields |
| `GET` | `/api/v1/forms/{id}` | `forms.view` | Get form details with fields |
| `PATCH` | `/api/v1/forms/{id}` | `forms.manage` | Update a form |
| `DELETE` | `/api/v1/forms/{id}` | `forms.manage` | Delete a form |
| `POST` | `/api/v1/forms/{id}/publish` | `forms.manage` | Publish a form |
| `POST` | `/api/v1/forms/{id}/archive` | `forms.manage` | Archive a form |
| `POST` | `/api/v1/forms/{id}/fields` | `forms.manage` | Add a field |
| `PATCH` | `/api/v1/forms/{id}/fields/{fid}` | `forms.manage` | Update a field |
| `DELETE` | `/api/v1/forms/{id}/fields/{fid}` | `forms.manage` | Delete a field |
| `POST` | `/api/v1/forms/{id}/fields/reorder` | `forms.manage` | Reorder fields |
| `POST` | `/api/v1/forms/{id}/submit` | authenticated | Submit a form (internal) |
| `GET` | `/api/v1/forms/{id}/submissions` | `forms.manage` | List submissions |
| `GET` | `/api/v1/forms/{id}/submissions/{sid}` | `forms.manage` | Get submission detail |
| `DELETE` | `/api/v1/forms/{id}/submissions/{sid}` | `forms.manage` | Delete a submission |
| `POST` | `/api/v1/forms/{id}/integrations` | `forms.manage` | Add integration |
| `PATCH` | `/api/v1/forms/{id}/integrations/{iid}` | `forms.manage` | Update integration |
| `DELETE` | `/api/v1/forms/{id}/integrations/{iid}` | `forms.manage` | Delete integration |

### Public Endpoints (no authentication required)

| Method | Path | Rate Limit | Description |
|--------|------|------------|-------------|
| `GET` | `/api/public/v1/forms/{slug}` | 60/min/IP | Get public form by slug |
| `POST` | `/api/public/v1/forms/{slug}/submit` | 10/min/IP | Submit public form |

---

## Public Forms

### How It Works

1. **Create a form** in the admin interface
2. **Enable public access** via the Share modal (toggle "Public Access" on)
3. **Publish the form** to make it live
4. **Share the URL** or **print the QR code** for physical distribution

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
- Optional submitter name/email section
- Loading, error, and success states
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

### Public Form Protection

| Layer | Protection |
|-------|-----------|
| Rate Limiting | 60 views/min, 10 submits/min per IP |
| Honeypot | Hidden "website" field catches bots |
| Slug Validation | Strict `^[a-f0-9]{12}$` pattern prevents injection |
| Sanitization | HTML escape + type validation on all data |
| DOMPurify | Frontend strips all HTML from server text |
| Data Isolation | Public submissions flagged, IP/UA captured |

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

| Migration | Description |
|-----------|-------------|
| `20260212_0100_create_forms_tables` | Creates `forms`, `form_fields`, `form_submissions` tables with all enums |
| `20260212_0200_add_public_forms_and_integrations` | Adds `member_lookup` to fieldtype enum, public form columns, `form_integrations` table |

### Running Migrations

```bash
cd backend
alembic upgrade head
```

---

## Permissions

| Permission | Grants |
|------------|--------|
| `forms.view` | View forms list, form details, submission data |
| `forms.manage` | All view permissions + create/edit/delete forms, manage fields, publish/archive, configure public access, manage integrations, delete submissions |

Public form submission requires no permissions or authentication.

---

## Frontend Components

### FormsPage (Admin)

- **Stats Dashboard**: Total forms, published, draft, submissions, public forms
- **Form Cards**: Status badges, public URL with copy button, action buttons
- **Create Modal**: Form name, description, category, public toggle, starter templates
- **Share Modal**: Public access toggle, URL display, QR code with download
- **Integration Modal**: View/add/delete cross-module integrations
- **Submissions View**: Paginated list with public/integrated badges, submitter info

### PublicFormPage

- Standalone page at `/f/:slug` (outside authenticated routes)
- Light theme for public visitors
- Full field type rendering with HTML5 inputs
- Optional contact info section
- Loading/error/success states
