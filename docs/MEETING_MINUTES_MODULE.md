# Meeting Minutes & Documents Module

Comprehensive meeting minutes management with templates, dynamic sections, and document publishing.

## Overview

The Meeting Minutes module enables organizations to create, manage, and publish official meeting minutes. It includes a template system with meeting-type-specific default sections, a dynamic section editor, and a publish workflow that generates styled HTML documents in the Documents module.

### Key Capabilities

- **8 Meeting Types**: Business, special, committee, board, trustee, executive, annual, other — each with tailored default sections
- **Template System**: Configurable templates with default sections, header/footer configs, and meeting type defaults
- **Dynamic Sections**: Add, remove, reorder, and edit sections within minutes
- **Publish Workflow**: Approved minutes are published as styled HTML to the Documents module
- **Event Linking**: Minutes can be linked to events for context
- **Full-Text Search**: Search across minutes titles and section content

---

## Architecture

### Database Models

| Model | Description |
|-------|-------------|
| `MeetingMinutes` | Minutes record with title, meeting type, status, sections (JSON), event link, and publish reference |
| `MinutesTemplate` | Template definition with name, meeting type, default sections, header/footer config, and `is_default` flag |
| `DocumentFolder` | Folder hierarchy for organizing documents with system/custom distinction |
| `Document` | Document record with file metadata, content HTML, source tracking, and folder assignment |

### Enums

| Enum | Values |
|------|--------|
| `MeetingType` | `business`, `special`, `committee`, `board`, `trustee`, `executive`, `annual`, `other` |
| `MinuteStatus` | `draft`, `review`, `approved` |
| `DocumentType` | `policy`, `procedure`, `form`, `report`, `minutes`, `training`, `certificate`, `general` |
| `SourceType` | `upload`, `generated`, `linked` |

### Key Files

| File | Purpose |
|------|---------|
| `backend/app/models/minute.py` | SQLAlchemy models, MeetingType/MinuteStatus enums, default section presets |
| `backend/app/models/document.py` | Document and DocumentFolder models |
| `backend/app/schemas/minute.py` | Pydantic schemas for minutes and templates |
| `backend/app/schemas/document.py` | Pydantic schemas for documents and folders |
| `backend/app/services/minute_service.py` | Minutes CRUD, search, section management |
| `backend/app/services/template_service.py` | Template CRUD, default template creation |
| `backend/app/services/document_service.py` | Document/folder CRUD, system folder initialization, publish target |
| `backend/app/api/v1/endpoints/minutes.py` | Minutes and template API endpoints |
| `backend/app/api/v1/endpoints/documents.py` | Document and folder API endpoints |
| `frontend/src/pages/MinutesPage.tsx` | Minutes list, create modal with template selector |
| `frontend/src/pages/MinutesDetailPage.tsx` | Section editor, reorder, publish |
| `frontend/src/pages/DocumentsPage.tsx` | Folder browsing, document viewer |

---

## Minutes Lifecycle

```
Draft  ──(submit for review)──>  Review  ──(approve)──>  Approved
  ^                                 |                        |
  |                                 v                        v
  +──────────── (return to draft) ──+                   (publish)
                                                            |
                                                            v
                                                      Document created
                                                   in Documents module
```

### Status Rules

| Status | Can Edit Sections | Can Change Status | Can Publish |
|--------|-------------------|-------------------|-------------|
| `draft` | Yes | → `review` | No |
| `review` | Yes | → `approved` or → `draft` | No |
| `approved` | No (locked) | → `review` | Yes |

---

## Meeting Types & Default Sections

Each meeting type has a tailored set of default sections that are pre-populated when creating minutes with a template.

### Business Meeting (9 sections)
1. Call to Order
2. Roll Call
3. Approval of Previous Minutes
4. Treasurer's Report
5. Committee Reports
6. Old Business
7. New Business
8. Announcements
9. Adjournment

### Trustee Meeting (11 sections)
1. Call to Order
2. Roll Call
3. Approval of Previous Minutes
4. Treasurer's Report
5. Financial Review
6. Trust Fund Report
7. Audit Report
8. Old Business
9. New Business
10. Legal Matters
11. Adjournment

### Executive Meeting (11 sections)
1. Call to Order
2. Roll Call
3. Approval of Previous Minutes
4. Officers' Reports
5. Strategic Planning
6. Personnel Matters
7. Committee Reports
8. Old Business
9. New Business
10. Executive Session
11. Adjournment

### Annual Meeting (12 sections)
1. Call to Order
2. Roll Call
3. Approval of Previous Minutes
4. Annual Report
5. Treasurer's Report
6. Election Results
7. Awards & Recognition
8. Committee Reports
9. Old Business
10. New Business
11. Announcements
12. Adjournment

### Special / Committee / Board / Other
These use the business meeting defaults or a subset tailored to the meeting scope.

---

## Template System

### How Templates Work

1. **Default templates** are auto-created for each meeting type on first access
2. Each template defines a set of **default sections** (order, key, title)
3. When creating new minutes, selecting a template pre-populates the sections
4. Templates can include **header config** (organization name, subtitle) and **footer config** (confidentiality notices)

### Template Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Template display name |
| `meeting_type` | MeetingType | Which meeting type this template is for |
| `is_default` | boolean | Whether this is the auto-selected template for its type |
| `sections` | JSON array | Default sections (`order`, `key`, `title`) |
| `header_config` | JSON | Header settings (organization name, subtitle, logo) |
| `footer_config` | JSON | Footer settings (confidentiality notice, page numbers) |

### Creating Custom Templates

Use the templates API to create custom templates:
```
POST /api/v1/minutes/templates
{
  "name": "Special Budget Meeting",
  "meeting_type": "special",
  "is_default": false,
  "sections": [
    {"order": 0, "key": "call_to_order", "title": "Call to Order"},
    {"order": 1, "key": "budget_review", "title": "Budget Review"},
    {"order": 2, "key": "line_items", "title": "Line Item Discussion"},
    {"order": 3, "key": "vote", "title": "Budget Vote"},
    {"order": 4, "key": "adjournment", "title": "Adjournment"}
  ]
}
```

---

## Dynamic Sections

Sections are stored as a JSON array on the minutes record. Each section has:

| Field | Type | Description |
|-------|------|-------------|
| `order` | integer | Display position (0-indexed) |
| `key` | string | Unique identifier (e.g., `call_to_order`, `new_business`) |
| `title` | string | Section heading displayed in the editor |
| `content` | string | Section body text (rich text supported) |

### Section Operations

- **Add**: New sections are appended with the next available order number
- **Remove**: Section is filtered out and remaining sections are renumbered
- **Reorder**: Sections swap positions and all order values are reassigned sequentially
- **Edit**: Section content is updated in place; the full sections array is saved

---

## Publish Workflow

When approved minutes are published:

1. **HTML generation**: Sections are rendered into styled HTML with organization branding
2. **Content escaping**: All user content is passed through `html.escape()` to prevent XSS
3. **Document creation**: A new `Document` record is created in the "Meeting Minutes" system folder
4. **Link back**: The minutes record stores the `published_document_id` for cross-reference
5. **Re-publish**: If the document already exists, it is updated with new content

### Published Document Structure

The generated HTML includes:
- Organization name header (from template or minutes config)
- Meeting title and date
- Each section as a titled block with content
- Footer with confidentiality notice (if configured in template)

---

## Documents Module

### System Folders

7 system folders are auto-created on first access:

| Folder | Slug | Icon | Description |
|--------|------|------|-------------|
| SOPs | `sops` | FileText | Standard Operating Procedures |
| Policies | `policies` | Shield | Organization policies and bylaws |
| Forms & Templates | `forms-templates` | ClipboardList | Printable forms and templates |
| Reports | `reports` | BarChart | Generated and uploaded reports |
| Training Materials | `training-materials` | GraduationCap | Training documents and manuals |
| Meeting Minutes | `meeting-minutes` | BookOpen | Published meeting minutes |
| General Documents | `general` | Folder | Uncategorized documents |

### Custom Folders

Users with `meetings.manage` permission can:
- Create custom folders with name, description, icon, and color
- Delete custom folders (moves contained documents to parent or root)
- System folders cannot be deleted

---

## API Reference

### Minutes Endpoints

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `GET` | `/api/v1/minutes` | `meetings.view` | List minutes with filtering |
| `POST` | `/api/v1/minutes` | `meetings.manage` | Create new minutes |
| `GET` | `/api/v1/minutes/search` | `meetings.view` | Search minutes by title/content |
| `GET` | `/api/v1/minutes/{id}` | `meetings.view` | Get minutes detail with sections |
| `PUT` | `/api/v1/minutes/{id}` | `meetings.manage` | Update minutes and sections |
| `DELETE` | `/api/v1/minutes/{id}` | `meetings.manage` | Delete minutes |
| `POST` | `/api/v1/minutes/{id}/publish` | `meetings.manage` | Publish approved minutes to documents |
| `GET` | `/api/v1/minutes/templates` | `meetings.view` | List templates |
| `POST` | `/api/v1/minutes/templates` | `meetings.manage` | Create template |
| `DELETE` | `/api/v1/minutes/templates/{id}` | `meetings.manage` | Delete template |

### Document Endpoints

| Method | Path | Permission | Description |
|--------|------|------------|-------------|
| `GET` | `/api/v1/documents/folders` | `meetings.view` | List folders (auto-creates system folders) |
| `POST` | `/api/v1/documents/folders` | `meetings.manage` | Create custom folder |
| `DELETE` | `/api/v1/documents/folders/{id}` | `meetings.manage` | Delete custom folder |
| `GET` | `/api/v1/documents` | `meetings.view` | List documents with filtering |
| `GET` | `/api/v1/documents/{id}` | `meetings.view` | Get document detail with content |
| `DELETE` | `/api/v1/documents/{id}` | `meetings.manage` | Delete document |

---

## Security

### Multi-Tenancy
All queries are scoped to `organization_id`. Users can only access minutes and documents belonging to their organization.

### Permission Model
- **`meetings.view`**: Read access to minutes, templates, folders, and documents
- **`meetings.manage`**: Write access — create, update, delete, publish

### Input Sanitization
- All published HTML content uses `html.escape()` to prevent XSS
- Search queries escape SQL wildcards (`%`, `_`, `\`) to prevent LIKE pattern injection
- Pydantic validation on all request schemas enforces field types and constraints

### Edit Protection
Approved minutes are locked — status must be changed back to `review` or `draft` before content can be modified.

### Audit Logging
All write operations are logged to the tamper-proof audit trail:
- `minutes_created`, `minutes_updated`, `minutes_deleted`
- `minutes_published`
- `template_created`, `template_deleted`
- `folder_created`
- `document_deleted`

---

## Database Migrations

| Migration | Revision | Description |
|-----------|----------|-------------|
| `20260212_1200_add_meeting_minutes_tables.py` | `add_meeting_minutes` | Creates `meeting_minutes` table |
| `20260213_0800_add_templates_documents_dynamic_sections.py` | `20260213_0800` | Creates `minutes_templates`, `document_folders`, `documents` tables |
| `20260213_1400_add_trustee_executive_annual_meeting_types.py` | `a7f3e2d91b04` | Extends MeetingType ENUM with `trustee`, `executive`, `annual` |

### Migration Chain
```
20260212_0400 (elections attendees)
    → add_meeting_minutes (minutes table)
        → 20260213_0800 (templates, documents, dynamic sections)
            → a7f3e2d91b04 (new meeting types)
```

---

## Troubleshooting

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md#meeting-minutes-module-issues) for common issues including:
- Minutes sections not loading
- Cannot edit approved minutes
- Publish button not appearing
- Template not auto-selected
- System folders not appearing
- Cannot delete a folder

---

**Document Version**: 1.0
**Last Updated**: 2026-02-13
**Maintainer**: Development Team
