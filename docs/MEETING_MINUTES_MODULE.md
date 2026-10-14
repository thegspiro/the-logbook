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
- **Roll Call**: Six attendance statuses with notes, a suggested roll from event check-ins or the member list, and a quorum derived from it _(2026-10-14)_
- **Election Results**: A closed election's certified tally frozen into the minutes _(2026-10-14)_
- **Attachments**: Reports, handouts and the signed copy, scanned and stored encrypted _(2026-10-14)_
- **Approved Versions**: An immutable, SHA-256-hashed snapshot per approval, with verification _(2026-10-14)_
- **Action-Item Follow-Through**: Carry-forward between meetings, a "assigned to me" list, and an email to each assignee on approval _(2026-10-14)_
- **Printable PDF**: With signature lines and, once approved, the version and hash _(2026-10-14)_

---

## Architecture

### Database Models

| Model                   | Description                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `MeetingMinutes`        | Minutes record with title, meeting type, status, sections (JSON), event link, and publish reference                            |
| `MinutesTemplate`       | Template definition with name, meeting type, default sections, header/footer config, and `is_default` flag                     |
| `Motion`                | A motion with mover, seconder, result and vote counts                                                                          |
| `ActionItem`            | `minutes_action_items`; `carried_from_id` / `carried_forward_at` link an item to the one it continues                          |
| `MinutesElectionResult` | `minutes_election_results`; a frozen `ElectionResults` dump, one per (minutes, election)                                       |
| `MinutesAttachment`     | `minutes_attachments`; file metadata, category and SHA-256 (bytes live under `minutes-attachments/`)                           |
| `MinutesRevision`       | `minutes_revisions`; one row per approval: snapshot, content hash, who approved, and — once replaced — who reopened it and why |
| `DocumentFolder`        | Folder hierarchy for organizing documents with system/custom distinction                                                       |
| `Document`              | Document record with file metadata, content HTML, source tracking, and folder assignment                                       |

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
| `backend/app/services/minutes_record_service.py`           | Roll-call suggestions, election results, attachments, revisions, carry-forward, "assigned to me"       |
| `backend/app/services/minutes_notifications.py`            | Assignment email, decided by `EmailKind.MINUTES_ACTION_ITEMS`                                          |
| `backend/app/api/v1/endpoints/minutes_records.py`          | Record-keeping endpoints, mounted beside `minutes.py` at the same prefix                               |
| `backend/app/utils/minutes_attendance.py`                  | The one canonical attendee shape and what counts toward quorum                                         |
| `backend/app/utils/minutes_snapshot.py`                    | What an approval covers, and its hash                                                                  |
| `backend/app/utils/minutes_pdf.py`                         | The printable minutes                                                                                  |
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

**Who sees what.** Callers without `minutes.manage` see circulated (`submitted`)
and approved, non-executive minutes; drafts and executive sessions are hidden.
The list endpoint decides this server-side (updated 2026-10-14, see
[Review, adoption and outlines](#review-adoption-and-outlines-2026-10-14); the
screens now say _Circulated for review_ and _Adopted_ for `submitted` and
`approved`).

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
5. **Re-publish**: If the document already exists, it is updated in place with new content (same document id, so links stay valid) and its `under_correction_since` flag, set when the minutes were reopened for correction, is cleared

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
| `POST`   | `/api/v1/minutes-records/{id}/reopen`               | `minutes.manage` | Return approved minutes to draft for a correction, with a reason (audit-logged)                               |
| `POST`   | `/api/v1/minutes-records/{id}/publish`              | `minutes.manage` | Publish approved minutes to Documents                                                                         |
| `GET`    | `/api/v1/minutes-records/templates`                 | `minutes.view`   | List templates                                                                                                |
| `POST`   | `/api/v1/minutes-records/templates`                 | `minutes.manage` | Create template                                                                                               |
| `PUT`    | `/api/v1/minutes-records/templates/{id}`            | `minutes.manage` | Update template                                                                                               |
| `DELETE` | `/api/v1/minutes-records/templates/{id}`            | `minutes.manage` | Delete template                                                                                               |

Motions, action items and quorum have their own sub-routes under
`/{id}/motions`, `/{id}/action-items` and `/{id}/quorum`, all `minutes.manage`
— with one exception: `PUT /{id}/action-items/{item_id}` also accepts the
item's assignee (matched on `assignee_id`), who may change only `status` and
`completion_notes`; any other field is a 403, and someone else's item a 404
_(2026-10-11, W52-7)_. `GET /api/v1/minutes-records/action-item-assignees`
(`minutes.manage`) lists every active member as `{id, name}` for the assignee
picker; an action item's `assignee_id` must name an active member of the
department, and the server stores that member's name beside it _(W52-6)_.

**Approved minutes are locked, including their quorum settings** _(2026-10-11,
MM-17)_. `PATCH /{id}/quorum-config` refuses approved minutes (400), as every
content, motion and action-item edit already did, and `GET /{id}/quorum` on
approved minutes reports the stored `quorum_met` / `quorum_count` instead of
recalculating and overwriting them. A correction goes through
`POST /{id}/reopen` (`{"reason": "..."}`, 10–500 characters): the minutes
return to draft with their approval and submission cleared, the prior approver
and approval time are written to the `minutes_reopened` audit event, and the
record must be submitted and approved again — by someone other than the new
submitter. A document already published from the approved version stays
readable in Documents, but the reopen stamps its `under_correction_since`
(resolved in-org through `published_document_id`) and the Documents screen
shows a "Being corrected" notice on it until the minutes are re-approved and
re-published over it _(2026-10-12, owner decision)_.
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

## Record keeping _(2026-10-14)_

### Roll call

`meeting_minutes.attendees` stays a JSON list; its entries now have one stored
shape (`app/utils/minutes_attendance.py`):

```json
{
  "user_id": "…|null",
  "name": "…",
  "role": "…|null",
  "status": "present|late|left_early|excused|absent|guest",
  "present": true,
  "note": "…|null"
}
```

`status` is the record; `present` is derived from it and means "counted toward
quorum". **Present, late and left early count; excused, absent and guests do
not.** A client that sends only `present` (the old contract) gets the matching
status, so existing callers keep working. A member can be listed once. A
migration rewrote every stored entry; a legacy entry that was present stays
`present`, so a quorum already recorded does not change.

`GET /{id}/attendance-suggestions` builds a starting roll without saving it:
the active members, with those who checked in to the linked event marked
present and checked-in outside guests added as guests; with no event, everyone
starts absent. Whatever the minutes already record for a member wins.

### Election results

`GET /{id}/importable-elections` lists the department's closed elections;
`POST /{id}/election-results {"election_id"}` copies that election's results
into `minutes_election_results`. Only a **closed** election in the caller's own
department can be filed (a foreign id and a missing one answer identically),
and each election once per set of minutes. The copy is the record: renaming or
annotating the election later does not change what the minutes say. While the
minutes are a draft or rejected, a filed result can be removed.

**Elections that run past the meeting.** A result can also be filed once the
minutes have been circulated or adopted. It is then stored with
`is_addendum = true`: permanent (it cannot be removed), dated by its filing
time, outside the approved version's hash (so `verify` still matches what the
body adopted), and labelled as an addendum on the screen, the PDF and the
published copy. `importable-elections` lists the elections held at this meeting
(through a motion's ballot link) first, flagged `linked_to_meeting`.

### Attachments

`POST /{id}/attachments` (multipart: `file`, `title`, `category`) stores a
file through `FileStorageService` — 25 MB cap, content-type detection, malware
scan, encrypted at rest — under `<org>/minutes-attachments/<minutes id>/` on
the uploads volume, so it is covered by the same backup as every other upload.
Allowed: PDF, Word, Excel, text, JPEG/PNG/GIF/WebP. They are **not** filed as
shared Documents: that folder's rights reach every `documents.view` holder and
would expose an executive session's files. Instead they are served only through
`GET /{id}/attachments/{attachment_id}/file`, with the minutes' own visibility —
a member sees them once the minutes are approved, and never for executive
minutes. Categories: `signed_copy`, `report`, `agenda`, `handout`,
`correspondence`, `other`.

### Locking and approved versions

Everything above follows the MM-17 lock: roll call, election results and
attachments change only while the minutes are a draft or rejected. **Two
deliberate exceptions:** a `signed_copy` attachment can be filed on approved
minutes (it is the scanned signature page and cannot exist before approval) and
can never be deleted from them; and an election result can be filed as an
addendum (see above). Anything else attached before approval is part
of what was approved.

Every approval writes a `minutes_revisions` row: a snapshot of the minutes
(heading, roll, quorum, sections, motions, action items _as assigned_, filed
election results, and a manifest of attachments by hash) and its SHA-256.
Action-item progress and the signed copy are outside the snapshot on purpose —
assignees update progress on approved minutes by design. `GET /{id}/verify`
rebuilds the snapshot from the live record and compares; a mismatch names the
parts that differ. Reopening supersedes the current revision (who, when, why)
and keeps it; the corrected minutes are approved as the next version.
`GET /{id}/revisions` lists them and `GET /{id}/revisions/{revision_id}` returns
one with its snapshot. Minutes approved before this change have no revision;
`verify` says so, and reopening and re-approving establishes one.

### Action items between meetings

`GET /{id}/open-action-items` offers the open items of earlier **approved**
minutes of the same meeting type (`?include_other_types=true` widens it;
executive-session items are never offered to another kind of meeting).
`POST /{id}/carry-forward {"item_ids": [...]}` copies them into draft minutes
and stamps the originals `carried_forward_at`, so an item is open in exactly one
place — in the stats, the list counts and the due-date reminders. It is all or
nothing, and the same item cannot be carried twice.

`GET /action-items/mine` lists the caller's own items from approved minutes
(`?include_closed=true` for finished ones); it needs no permission beyond being
signed in, and shows no one else's.

When minutes are approved each assignee is emailed their items, once. This is
`EmailKind.MINUTES_ACTION_ITEMS` in `email_policy.py`: on by default, a member
can turn it off, and a department can make it required. An item added to
already-approved minutes is emailed when it is added. A failed send is logged
and never fails the approval.

### Printable minutes

`GET /{id}/pdf` renders the minutes with attendance by status, quorum, sections,
motions, action items, filed election results, the attachment list, signature
lines for the recording secretary and presiding officer, and — for approved
minutes — the approver, version and SHA-256 in the footer. It follows the same
visibility as the minutes.

### Record-keeping endpoints

| Method   | Path                                               | Permission       | Description                                                      |
| -------- | -------------------------------------------------- | ---------------- | ---------------------------------------------------------------- |
| `GET`    | `/{id}/attendance-suggestions`                     | `minutes.manage` | Starting roll from event check-ins or the roster (not saved)     |
| `GET`    | `/{id}/importable-elections`                       | `minutes.manage` | Closed elections that can be filed                               |
| `GET`    | `/{id}/election-results`                           | `minutes.view`   | Results filed with the minutes                                   |
| `POST`   | `/{id}/election-results`                           | `minutes.manage` | File a closed election's result (draft/rejected)                 |
| `DELETE` | `/{id}/election-results/{result_id}`               | `minutes.manage` | Remove a filed result (draft/rejected)                           |
| `GET`    | `/{id}/attachments`                                | `minutes.view`   | List files                                                       |
| `POST`   | `/{id}/attachments`                                | `minutes.manage` | Attach a file (draft/rejected; `signed_copy` only once approved) |
| `GET`    | `/{id}/attachments/{attachment_id}/file`           | `minutes.view`   | Download                                                         |
| `DELETE` | `/{id}/attachments/{attachment_id}`                | `minutes.manage` | Delete (draft/rejected)                                          |
| `GET`    | `/{id}/revisions`, `/{id}/revisions/{revision_id}` | `minutes.view`   | Approved versions                                                |
| `GET`    | `/{id}/verify`                                     | `minutes.view`   | Does the record still match the version in force                 |
| `GET`    | `/{id}/open-action-items`                          | `minutes.manage` | Open items from earlier approved minutes                         |
| `POST`   | `/{id}/carry-forward`                              | `minutes.manage` | Carry items into draft minutes                                   |
| `GET`    | `/action-items/mine`                               | signed in        | The caller's own items                                           |
| `GET`    | `/{id}/pdf`                                        | `minutes.view`   | Printable minutes                                                |

Every `{id}` route resolves the minutes in the caller's own department first;
without `minutes.manage`, drafts and executive-session minutes answer 404.

### Not built

Recorded in [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md#meeting-minutes--what-record-keeping-does-not-do-2026-10-14):
automatic filing of results at certification, and emailing members when minutes
are circulated.

---

## Review, adoption and outlines _(2026-10-14)_

### Review and adoption

Most departments circulate draft minutes, take corrections, and adopt them at
the next meeting. The API statuses are unchanged (`draft`, `submitted`,
`approved`, `rejected`); the screens say **Circulated for review** and
**Adopted**.

```
Draft ──Circulate──> Circulated ──Adopt──> Adopted ──Reopen──> Draft
  ^                      |  |
  |                      |  +──Return for changes──> Rejected
  +──────Recall──────────+
```

- **Members read circulated minutes.** `member_visible_conditions()` in
  `minute_service.py` is the one definition of what a caller without
  `minutes.manage` may read: status `submitted` or `approved`, and never an
  executive session. Drafts stay hidden.
- **Required sections.** A section marked `required` in its outline must have
  text before the minutes can be circulated (`missing_required_sections`); the
  roll-call section is satisfied by a recorded roll.
- **Suggestions.** While the minutes circulate, anyone who can view them may
  suggest a change: an optional section, a comment, and optional proposed
  wording. A member sees only their own; `minutes.manage` sees all. A manager
  accepts or declines each (with a note) until adoption. Suggestions never edit
  the minutes; the secretary works accepted ones in after **Recall to Draft**
  (`POST /{id}/recall`, circulated → draft; suggestions are kept) and
  circulates again.
- **Adoption.** `POST /{id}/approve` takes an optional body
  `{adopted_on, adopting_minutes_id, as_amended}`. `adopted_on` defaults to now;
  `adopting_minutes_id` is the minutes of the meeting at which the body voted
  (resolved inside the caller's department); `as_amended` defaults to true when
  any suggestion was accepted. The same separation of duties applies. Reopening
  clears the adoption details and keeps the superseded version.
- **Closed sessions.** `meeting_minutes` is joined by `minutes_closed_sessions`:
  reason, legal basis, start and end, participants (`{user_id, name, joined_at,
left_at}`, so someone who stepped out is recorded), a summary, and the motion
  that moved into it. Draft/rejected only, like the rest of the record.
- **Motion → ballot.** A motion can name the `election_id` (and optionally the
  `ballot_item_id`) that decided it, so the minutes link to the tally. A ballot
  item must belong to that election; the election must be in the department.

The approved version's snapshot now also holds the adoption details, closed
sessions and each motion's ballot link. It still excludes action-item progress,
signed copies and election addenda.

### Outlines

An **outline** is the department's standard order of business. It is stored as a
minutes template (`/minutes-records/templates`), edited at **Minutes → Outlines**
(`/minutes/outlines`, `minutes.manage`). Each outline has a meeting type, a
sequence of sections (`key`, `title`, prefilled text, `required`) and header and
footer settings, and one outline per meeting type is the default.

- New minutes start from `TemplateService.resolve_outline`: the outline chosen
  on the Minutes page; else the department's default for that meeting type; else
  any outline of that type; else the built-in order of business. The page asks
  only when a meeting type has more than one outline.
- **Apply an outline** (`POST /{id}/apply-outline {template_id}`) on a draft lays
  an outline over it: its sections in its order, keeping every section that
  already has text and any section the outline lacks.
- Outline sections are validated on save: unique lowercase keys, order
  renumbered, at least one section.

### Endpoints added

| Method   | Path                                      | Permission       | Description                                                     |
| -------- | ----------------------------------------- | ---------------- | --------------------------------------------------------------- |
| `POST`   | `/{id}/approve`                           | `minutes.manage` | Adopt; optional `{adopted_on, adopting_minutes_id, as_amended}` |
| `POST`   | `/{id}/recall`                            | `minutes.manage` | Circulated → draft                                              |
| `GET`    | `/{id}/suggestions`                       | `minutes.view`   | All for a manager; the caller's own otherwise                   |
| `POST`   | `/{id}/suggestions`                       | `minutes.view`   | Suggest a change (circulated minutes only)                      |
| `PUT`    | `/{id}/suggestions/{suggestion_id}`       | `minutes.manage` | Accept or decline, with a note                                  |
| `GET`    | `/{id}/closed-sessions`                   | `minutes.view`   | Closed sessions                                                 |
| `POST`   | `/{id}/closed-sessions`                   | `minutes.manage` | Record one (draft/rejected)                                     |
| `PUT`    | `/{id}/closed-sessions/{session_id}`      | `minutes.manage` | Edit                                                            |
| `DELETE` | `/{id}/closed-sessions/{session_id}`      | `minutes.manage` | Remove                                                          |
| `POST`   | `/{id}/apply-outline`                     | `minutes.manage` | Lay an outline over a draft                                     |
| `POST`   | `/from-meeting/{meeting_id}?template_id=` | `minutes.manage` | Create minutes from a meeting, optionally from an outline       |
| `GET`    | `/templates`, `/templates/{id}`           | `minutes.view`   | Outlines                                                        |
| `POST`   | `/templates`                              | `minutes.manage` | Create an outline                                               |
| `PUT`    | `/templates/{id}`                         | `minutes.manage` | Edit an outline, or make it the default                         |
| `DELETE` | `/templates/{id}`                         | `minutes.manage` | Delete an outline (minutes already written are unchanged)       |

---

## Database Migrations

| Migration                                                      | Revision              | Description                                                                                                                           |
| -------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `20260212_1200_add_meeting_minutes_tables.py`                  | `add_meeting_minutes` | Creates `meeting_minutes` table                                                                                                       |
| `20260213_0800_add_templates_documents_dynamic_sections.py`    | `20260213_0800`       | Creates `minutes_templates`, `document_folders`, `documents` tables                                                                   |
| `20260213_1400_add_trustee_executive_annual_meeting_types.py`  | `a7f3e2d91b04`        | Extends MeetingType ENUM with `trustee`, `executive`, `annual`                                                                        |
| `20261014_1719_8efc77d4c0c3_minutes_record_keeping_*.py`       | `8efc77d4c0c3`        | Attendance backfill; carry-forward columns; election results, attachments and revisions tables (idempotent; the downgrade drops them) |
| `20261014_1830_f2c5e55e7dda_minutes_adoption_suggestions_*.py` | `f2c5e55e7dda`        | Adoption columns; motion ballot link; `is_addendum`; closed-session and suggestion tables (idempotent; the downgrade drops them)      |

### Migration Chain

```
20260212_0400 (elections attendees)
    → add_meeting_minutes (minutes table)
        → 20260213_0800 (templates, documents, dynamic sections)
            → a7f3e2d91b04 (new meeting types)
                → 20260312_0200 (rename meeting_action_items table)
                    → … → 8efc77d4c0c3 (record keeping)
                        → f2c5e55e7dda (adoption, suggestions, closed sessions)
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
