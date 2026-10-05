# Meeting Minutes & Documents Module

Comprehensive meeting minutes management with templates, dynamic sections, and document publishing.

## Overview

The Meeting Minutes module enables organizations to create, manage, and publish official meeting minutes. It includes a template system with meeting-type-specific default sections, a dynamic section editor, and a publish workflow that generates styled HTML documents in the Documents module.

### Key Capabilities

- **8 Minutes Types**: Business, special, committee, board, trustee, executive, annual, other — each with tailored default sections. A **meeting** record (`meetings.meeting_type`) accepts only five of them — business, special, committee, board, other — see [Meetings and minutes are two records](#meetings-and-minutes-are-two-records-2026-10-03)
- **Template System**: Configurable templates with default sections, header/footer configs, and meeting type defaults
- **Dynamic Sections**: Add, remove, reorder, and edit sections within minutes
- **Approval Workflow**: Draft → submitted → approved (or rejected back for changes), with separation of duties — the submitter cannot approve
- **Publish Workflow**: Approved minutes are published as styled HTML to the Documents module
- **Event Linking**: Minutes can be linked to events for context
- **Full-Text Search**: Search across minutes titles and section content

---

## Architecture

### Database Models

| Model             | Description                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `MeetingMinutes`  | Minutes record with title, meeting type, status, sections (JSON), event link, and publish reference        |
| `MinutesTemplate` | Template definition with name, meeting type, default sections, header/footer config, and `is_default` flag |
| `DocumentFolder`  | Folder hierarchy for organizing documents with system/custom distinction                                   |
| `Document`        | Document record with file metadata, content HTML, source tracking, and folder assignment                   |

### Enums

| Enum            | Values                                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| `MeetingType`   | `business`, `special`, `committee`, `board`, `trustee`, `executive`, `annual`, `other`                      |
| `MinutesStatus` | `draft`, `submitted`, `approved`, `rejected` (UI: Draft, Awaiting approval, Approved, Returned for changes) |
| `DocumentType`  | `policy`, `procedure`, `form`, `report`, `minutes`, `training`, `certificate`, `general`                    |
| `SourceType`    | `upload`, `generated`, `linked`                                                                             |

### Key Files

| File                                                       | Purpose                                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `backend/app/models/minute.py`                             | SQLAlchemy models, MeetingType/MinuteStatus enums, default section presets                             |
| `backend/app/models/document.py`                           | Document and DocumentFolder models                                                                     |
| `backend/app/schemas/minute.py`                            | Pydantic schemas for minutes and templates                                                             |
| `backend/app/schemas/document.py`                          | Pydantic schemas for documents and folders                                                             |
| `backend/app/services/minute_service.py`                   | Minutes CRUD, search, section management                                                               |
| `backend/app/services/template_service.py`                 | Template CRUD, default template creation                                                               |
| `backend/app/services/document_service.py`                 | Document/folder CRUD, system folder initialization, publish target                                     |
| `backend/app/api/v1/endpoints/minutes.py`                  | Minutes and template API endpoints                                                                     |
| `backend/app/api/v1/endpoints/documents.py`                | Document and folder API endpoints                                                                      |
| `frontend/src/modules/minutes/pages/MinutesPage.tsx`       | Meetings list with each meeting's minutes linked beneath it; Record Minutes dialog (creates a meeting) |
| `frontend/src/modules/minutes/pages/MinutesDetailPage.tsx` | Section editor, reorder, publish                                                                       |
| `frontend/src/modules/minutes/index.ts`                    | Module barrel export                                                                                   |
| `frontend/src/modules/minutes/routes.tsx`                  | Route definitions                                                                                      |
| `frontend/src/modules/minutes/services/api.ts`             | Module axios instance with auth interceptors                                                           |
| `frontend/src/modules/minutes/store/minutesStore.ts`       | Zustand store for minutes CRUD                                                                         |
| `frontend/src/modules/minutes/types/minutes.ts`            | TypeScript types and interfaces                                                                        |
| `frontend/src/pages/MinutesPage.tsx`                       | Re-export from module (backward compatibility)                                                         |
| `frontend/src/pages/MinutesDetailPage.tsx`                 | Re-export from module (backward compatibility)                                                         |
| `frontend/src/pages/DocumentsPage.tsx`                     | Folder browsing, document viewer                                                                       |

---

## Minutes Lifecycle

_(Corrected 2026-10-04. This section described a `review` status that does
not exist and an approved record that could be sent back to review; neither
matches the service.)_

```
Draft ──(Submit for Approval)──> Submitted ──(Approve Minutes)──> Approved ──(publish)──> Document
  ^                                  |                                              in Documents
  |                                  v
  +──(any edit)── Rejected <──(Reject Minutes, reason required)
```

### Status Rules

| Status      | Can edit sections                                                 | Next                                                               | Can publish | Can delete |
| ----------- | ----------------------------------------------------------------- | ------------------------------------------------------------------ | ----------- | ---------- |
| `draft`     | Yes                                                               | → `submitted`                                                      | No          | Yes        |
| `submitted` | No                                                                | → `approved` (by someone other than the submitter) or → `rejected` | No          | No         |
| `rejected`  | Yes — an edit returns it to `draft` and clears the rejection      | → `submitted`                                                      | No          | No         |
| `approved`  | No (locked; action items accept status and completion notes only) | —                                                                  | Yes         | No         |

**Separation of duties.** `approve_minutes` calls `assert_different_person`, so
the officer who submitted a record cannot approve it ("You cannot approve your
own meeting minutes…"). Since 2026-10-03 the detail page does not offer the
submitter **Approve Minutes**; it reads _"Waiting for another officer to
approve. You submitted these minutes, so you cannot approve them."_ **Reject
Minutes** stays available to them as a way to withdraw.

**Who sees what.** Callers without `minutes.manage` see approved, non-executive
minutes only; the list endpoint decides this server-side.

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

| Field           | Type        | Description                                             |
| --------------- | ----------- | ------------------------------------------------------- |
| `name`          | string      | Template display name                                   |
| `meeting_type`  | MeetingType | Which meeting type this template is for                 |
| `is_default`    | boolean     | Whether this is the auto-selected template for its type |
| `sections`      | JSON array  | Default sections (`order`, `key`, `title`)              |
| `header_config` | JSON        | Header settings (organization name, subtitle, logo)     |
| `footer_config` | JSON        | Footer settings (confidentiality notice, page numbers)  |

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

| Field     | Type    | Description                                               |
| --------- | ------- | --------------------------------------------------------- |
| `order`   | integer | Display position (0-indexed)                              |
| `key`     | string  | Unique identifier (e.g., `call_to_order`, `new_business`) |
| `title`   | string  | Section heading displayed in the editor                   |
| `content` | string  | Section body text (rich text supported)                   |

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

| Folder             | Slug                 | Icon          | Description                      |
| ------------------ | -------------------- | ------------- | -------------------------------- |
| SOPs               | `sops`               | FileText      | Standard Operating Procedures    |
| Policies           | `policies`           | Shield        | Organization policies and bylaws |
| Forms & Templates  | `forms-templates`    | ClipboardList | Printable forms and templates    |
| Reports            | `reports`            | BarChart      | Generated and uploaded reports   |
| Training Materials | `training-materials` | GraduationCap | Training documents and manuals   |
| Meeting Minutes    | `meeting-minutes`    | BookOpen      | Published meeting minutes        |
| General Documents  | `general`            | Folder        | Uncategorized documents          |

### Custom Folders

Users with `documents.manage` permission can:

- Create custom folders with name, description, icon, and color
- Delete custom folders (moves contained documents to parent or root)
- System folders cannot be deleted

---

## API Reference

### Minutes Endpoints

_(Corrected 2026-10-04: the router is mounted at `/api/v1/minutes-records`, not
`/api/v1/minutes`, and is gated on `minutes.view` / `minutes.manage`, not the
`meetings.*` permissions this table used to name.)_

| Method   | Path                                                | Permission       | Description                                                                                                   |
| -------- | --------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/minutes-records`                           | `minutes.view`   | List minutes (non-managers get approved, non-executive only); each item carries `meeting_id` since 2026-10-03 |
| `GET`    | `/api/v1/minutes-records/stats`                     | `minutes.view`   | Counts, including minutes awaiting approval                                                                   |
| `GET`    | `/api/v1/minutes-records/search`                    | `minutes.view`   | Search minutes by title/content                                                                               |
| `GET`    | `/api/v1/minutes-records/{id}`                      | `minutes.view`   | Minutes detail with sections                                                                                  |
| `POST`   | `/api/v1/minutes-records`                           | `minutes.manage` | Create minutes                                                                                                |
| `POST`   | `/api/v1/minutes-records/from-meeting/{meeting_id}` | `minutes.manage` | Create minutes from a meeting record (title, date, type, location, attendees)                                 |
| `PUT`    | `/api/v1/minutes-records/{id}`                      | `minutes.manage` | Update a draft or rejected record                                                                             |
| `DELETE` | `/api/v1/minutes-records/{id}`                      | `minutes.manage` | Delete a draft                                                                                                |
| `POST`   | `/api/v1/minutes-records/{id}/submit`               | `minutes.manage` | Submit a draft or rejected record for approval                                                                |
| `POST`   | `/api/v1/minutes-records/{id}/approve`              | `minutes.manage` | Approve (not by the submitter)                                                                                |
| `POST`   | `/api/v1/minutes-records/{id}/reject`               | `minutes.manage` | Reject with a reason                                                                                          |
| `POST`   | `/api/v1/minutes-records/{id}/publish`              | `minutes.manage` | Publish approved minutes to Documents                                                                         |
| `GET`    | `/api/v1/minutes-records/templates`                 | `minutes.view`   | List templates                                                                                                |
| `POST`   | `/api/v1/minutes-records/templates`                 | `minutes.manage` | Create template                                                                                               |
| `PUT`    | `/api/v1/minutes-records/templates/{id}`            | `minutes.manage` | Update template                                                                                               |
| `DELETE` | `/api/v1/minutes-records/templates/{id}`            | `minutes.manage` | Delete template                                                                                               |

Motions, action items and quorum have their own sub-routes under
`/{id}/motions`, `/{id}/action-items` and `/{id}/quorum`, all `minutes.manage`.
Meeting records themselves are a separate router at `/api/v1/meetings`.

### List Response Counts _(2026-08-17)_

`MeetingResponse` declares `attendee_count` and `action_item_count`, and the
Minutes page renders them on every card. The list query loaded no children, so
**every card read "0 attendees · 0 action items"** over meetings whose detail
view showed real numbers.

`MeetingsService.attach_child_counts(meetings)` now populates both, using two
grouped `COUNT()` queries keyed on `meeting_id` rather than loading the rows —
only the totals are rendered here. It is attached the same way `creator_name`
is, and a meeting with no children reports `0` rather than being absent from
the result map.

> **Same shape of gap, worth checking for elsewhere:** a response schema that
> declares a derived field the list query never populates fails silently and
> plausibly. `0` is a legitimate value, so nothing errors and nothing looks
> broken — it just quietly misreports.

The demo seeder was also rebuilt for this page: the Minutes UI moved onto
`/meetings` while the seeder still populated the older `/minutes-records`
model, so a seeded department showed a "No Meeting Minutes" empty state over
real data. It now seeds an approved business meeting (attendees, motions, open
action items), a draft board meeting, and a pending public event request for
the Requests tab — each guarded per title, so a run that dies midway adds what
is missing rather than deciding the step is done.

### Document Endpoints

| Method   | Path                             | Permission         | Description                                |
| -------- | -------------------------------- | ------------------ | ------------------------------------------ |
| `GET`    | `/api/v1/documents/folders`      | `documents.view`   | List folders (auto-creates system folders) |
| `POST`   | `/api/v1/documents/folders`      | `documents.manage` | Create custom folder                       |
| `DELETE` | `/api/v1/documents/folders/{id}` | `documents.manage` | Delete custom folder                       |
| `GET`    | `/api/v1/documents`              | `documents.view`   | List documents with filtering              |
| `GET`    | `/api/v1/documents/{id}`         | `documents.view`   | Get document detail with content           |
| `DELETE` | `/api/v1/documents/{id}`         | `documents.manage` | Delete document                            |

---

## Security

### Multi-Tenancy

All queries are scoped to `organization_id`. Users can only access minutes and documents belonging to their organization.

### Permission Model

- **`minutes.view`**: Read access to minutes and templates (approved, non-executive minutes only without `minutes.manage`)
- **`minutes.manage`**: Write access — create, update, delete, submit, approve, reject, publish
- **`meetings.view` / `meetings.manage`**: the meeting records at `/api/v1/meetings`
- **`documents.view` / `documents.manage`**: folders and documents, including published minutes

### Input Sanitization

- All published HTML content uses `html.escape()` to prevent XSS
- Search queries escape SQL wildcards (`%`, `_`, `\`) to prevent LIKE pattern injection
- Pydantic validation on all request schemas enforces field types and constraints

### Edit Protection

Only `draft` and `rejected` minutes can be edited. Submitted and approved minutes are locked; on approved minutes an action item accepts only its status and completion notes.

### Audit Logging

All write operations are logged to the tamper-proof audit trail:

- `minutes_created`, `minutes_updated`, `minutes_deleted`
- `minutes_published`
- `template_created`, `template_deleted`
- `folder_created`
- `document_deleted`

---

## Database Migrations

| Migration                                                     | Revision              | Description                                                         |
| ------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------- |
| `20260212_1200_add_meeting_minutes_tables.py`                 | `add_meeting_minutes` | Creates `meeting_minutes` table                                     |
| `20260213_0800_add_templates_documents_dynamic_sections.py`   | `20260213_0800`       | Creates `minutes_templates`, `document_folders`, `documents` tables |
| `20260213_1400_add_trustee_executive_annual_meeting_types.py` | `a7f3e2d91b04`        | Extends MeetingType ENUM with `trustee`, `executive`, `annual`      |

### Migration Chain

```
20260212_0400 (elections attendees)
    → add_meeting_minutes (minutes table)
        → 20260213_0800 (templates, documents, dynamic sections)
            → a7f3e2d91b04 (new meeting types)
                → 20260312_0200 (rename meeting_action_items table)
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

---

## Module Refactoring (2026-03-12)

The minutes module was refactored to follow the standard module conventions used by other modules in the application:

### Changes

- **Module extraction**: Pages moved from `frontend/src/pages/` to `frontend/src/modules/minutes/pages/`. Original files re-export from the module for backward compatibility with existing routes and deep links
- **Dedicated Zustand store**: `minutesStore.ts` manages loading/error states for all minutes CRUD operations, replacing ad-hoc state management in page components
- **Module API service**: `services/api.ts` provides a dedicated axios instance with auth interceptors (CSRF, `withCredentials: true`), matching the pattern used by other modules
- **TypeScript types**: All minutes-related interfaces and types extracted to `types/minutes.ts`
- **Table name migration**: `20260312_0200_rename_meeting_action_items_table.py` renames the table to match the expected SQLAlchemy model table name. Handles index recreation

### Backend Tests

- `backend/tests/test_minute_service.py` — comprehensive test suite covering:
  - Minutes CRUD (create, read, update, delete)
  - Section operations (add, remove, reorder, edit content)
  - Full-text search across titles and section content
  - Template management (create, list, delete, defaults)
  - Publish workflow (draft → review → approved → publish)
  - Edge cases: empty sections, duplicate keys, publish without approval, re-publish

### Edge Cases

- Existing deployments must run `alembic upgrade head` for the table rename migration
- Deep links to `/minutes/:id` continue to work via re-exported route definitions
- The old `meetingsServices.ts` API methods remain functional alongside the new module API service

---

## Meetings and minutes are two records _(2026-10-03)_

The **Minutes** page (`/minutes`) lists **meeting** records (`/api/v1/meetings`)
and, since 2026-10-03, each meeting's **minutes** (`/api/v1/minutes-records`)
as links beneath its card. **Record Minutes** creates a meeting; the book icon
on its card creates minutes from it (`POST …/from-meeting/{meeting_id}`) or,
when it already has some, opens the newest. On an event page, **More → Create
Meeting** creates a meeting from a business meeting event, with attendees from
its check-ins.

Found driving workflow review W51 (`docs/workflow-review/W51-minutes.md`):

| Finding                                                                     | What changed                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W51-1 (HIGH) Minutes from a meeting carried the wrong date and time         | `MinuteService.create_from_meeting` combined the meeting's date and start time with `tzinfo=timezone.utc`; both are the department's wall clock. It now reads them in the organization's scheduling timezone (`resolve_scheduling_timezone`) and converts to UTC. A meeting dated 1 Oct with no time no longer reads "September 30 at 7:00 PM"; a 7:00 PM meeting no longer reads 2:00 PM. **Existing rows are not corrected** — see W51-8                       |
| W51-2 (HIGH) The Minutes page never led back to minutes                     | `MinutesListItem` carries `meeting_id` (additive). The page loads every set of minutes the caller may see, all pages, and links them under their meeting with their state (Draft / Awaiting approval / Approved / Returned for changes). **Pending Approval** reads the minutes stats endpoint rather than the meeting records' own status, which nothing advances (it read 0 while minutes waited)                                                              |
| W51-3 The book icon wrote a second set of minutes                           | It opens the newest existing set ("Open the minutes of …"); only a meeting with none gets new minutes; double-clicks are guarded. The API still accepts a second set (e.g. from another tab)                                                                                                                                                                                                                                                                     |
| W51-4 Executive, Trustee and Annual meetings could not be recorded          | `meetings.meeting_type` is a database ENUM of five types and the dialog offered all eight minutes types, so those three were refused with a 422 the dialog explained as a missing title or date. The dialog and the type filter now offer the five; a refused create shows the server's reason. Recording a closed (executive) session as its own meeting type needs a migration on `meetings.meeting_type` and a mapping in `create_from_meeting` — **flagged** |
| W51-5 An action item's due date read a day early                            | Rendered with `formatCalendarDate` (a calendar day stored at UTC midnight was being converted to Chicago time)                                                                                                                                                                                                                                                                                                                                                   |
| W51-6 The submitter was offered Approve                                     | Replaced by the "Waiting for another officer to approve" notice; Reject stays as a withdraw                                                                                                                                                                                                                                                                                                                                                                      |
| W51-7 Meetings list                                                         | Dates read "Thu, Oct 1, 2026 at 7:00 PM" instead of `2026-10-01` / `19:00`; the create dialog is a named modal dialog; **Start Recording** stays disabled without the required date; the card's icon buttons have `aria-label`s naming the meeting and are 44px on phones                                                                                                                                                                                        |
| W51-8 (flagged) Minutes already created from meetings keep the shifted date | A backfill could recompute from `meeting_id`, but cannot tell a date a secretary corrected by hand from a shifted one — owner decision, `docs/KNOWN_LIMITATIONS.md`                                                                                                                                                                                                                                                                                              |
| W51-9 (open) A meeting's own status badge never moves                       | Nothing advances a meeting record's status, so it reads "Draft" beside approved minutes                                                                                                                                                                                                                                                                                                                                                                          |

Related, 2026-09-26: a meeting created from an event copied its date and times
from the event's UTC timestamp, so a 7 PM Eastern meeting read 11 PM and one
after 8 PM landed on the next day; it now uses the department's date and time.

**Copy pass** _(2026-09-29)_: the page reads "Record meetings, write up their
minutes, and track action items"; the first tile is **Total Meetings**; the
empty state is **No Meetings Recorded** / "Record your first meeting to start
keeping minutes."; deleting a meeting warns "Delete this meeting with its
attendees and action items? Minutes already created from it are kept."; the
detail page's status badge reads Draft / Submitted / Approved / Rejected
instead of the raw value; and an unlinked record reads "No event linked. Link
the business meeting event these minutes record."

---

**Document Version**: 1.2
**Last Updated**: 2026-10-04
**Maintainer**: Development Team
