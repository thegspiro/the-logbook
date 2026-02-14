# Changelog

All notable changes to The Logbook project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added - Member Archive & Reactivation (2026-02-14)

#### Member Archiving Lifecycle
- **New `archived` status**: Added to UserStatus enum — represents a dropped member who has returned all property
- **Auto-archive on last item return**: When a dropped member returns their last assigned/checked-out item, they are automatically transitioned to `archived` status
- **Manual archive endpoint**: `POST /api/v1/users/{user_id}/archive` — allows leadership to archive a dropped member manually (e.g. items written off)
- **Reactivation endpoint**: `POST /api/v1/users/{user_id}/reactivate` — restores an archived member to `active` status when they rejoin the department
- **Archived members list**: `GET /api/v1/users/archived` — lists all archived members for legal requests or reactivation lookup
- **Audit trail**: All archive/reactivation events logged with full event data
- **Admin notification**: Admins, quartermasters, and chiefs notified by email when auto-archive occurs
- **`archived_at` column**: Tracks the exact timestamp of archiving on the user record
- **Profile preservation**: Archived members' full profile, training history, and inventory records remain accessible
- **Migration**: `20260214_0700` adds `archived` enum value and `archived_at` column

### Added - Property Return Report & Member Drop Statuses (2026-02-14)

#### Member Drop Statuses
- **New UserStatus values**: `dropped_voluntary` and `dropped_involuntary` added to the UserStatus enum
- **Status change endpoint**: `PATCH /api/v1/users/{user_id}/status` with `members.manage` permission
- **Audit logging**: All status changes logged with severity `warning` for drops
- **Migration**: `20260214_0500` adds new enum values to users, email_templates, and notification_rules tables

#### Property Return Report (Auto-Generated)
- **Automatic trigger**: When a member status changes to dropped, a formal property-return letter is generated
- **Printable HTML letter**: Professional letterhead format with department name, member address block (window-envelope compatible), and formal language
- **Item inventory table**: Lists every assigned and checked-out item with serial number, asset tag, condition, type (assigned/checked out), and dollar value
- **Total assessed value**: Summed from `current_value` or `purchase_price` of all items
- **Return instructions**: Three methods documented (in person, by appointment, by mail/courier) with tracking advice
- **Involuntary notice**: Additional legal-recovery paragraph automatically included for involuntary drops
- **Configurable deadline**: Return deadline in days (1-90, default 14) set per status change
- **Custom instructions**: Optional extra paragraph for department-specific notes
- **Document storage**: Report automatically saved to the Documents module (Reports folder) as a generated document
- **Email delivery**: Report emailed to the member's address on file (toggleable via `send_property_return_email`)
- **Plain text fallback**: Text version included for email clients that don't render HTML
- **Preview endpoint**: `GET /api/v1/users/{user_id}/property-return-report` to preview before dropping a member

#### Property Return Reminders (30-Day / 90-Day)
- **Automatic reminders**: 30-day and 90-day reminders sent to dropped members who still have outstanding items
- **Dual notification**: Reminder emailed to the member AND a summary sent to admin/quartermaster/chief users
- **Duplicate prevention**: Each reminder type (30-day, 90-day) sent only once per member via `property_return_reminders` tracking table
- **Escalation language**: 90-day reminder includes a "FINAL NOTICE" with recovery action warning
- **Process endpoint**: `POST /api/v1/users/property-return-reminders/process` — designed for daily cron/scheduler or manual trigger
- **Overdue dashboard**: `GET /api/v1/users/property-return-reminders/overdue` — lists all dropped members with outstanding items, days since drop, item details, and which reminders have been sent
- **Status tracking**: `status_changed_at` and `status_change_reason` columns added to users table for accurate drop-date tracking
- **Migration**: `20260214_0600` adds user columns and `property_return_reminders` table

#### Notification & Email Template Support
- **MEMBER_DROPPED trigger**: Added to NotificationTrigger enum for notification rules
- **MEMBER_DROPPED template type**: Added to EmailTemplateType for admin-customizable templates

### Added - Training Module Expansion (2026-02-14)

#### Self-Reported Training
- **Member Submission Page**: Members can submit external training for officer review at `/training/submit`
- **Officer Review Page**: Training officers review, approve, reject, or request revisions at `/training/submissions`
- **Configurable Approval Workflow**: Auto-approve under X hours, require manual approval, set review deadlines
- **Customizable Form Fields**: Per-field visibility, required flags, and custom labels (14 configurable fields)
- **Notification Settings**: Configurable notifications for submission and decision events
- **TrainingRecord Auto-Creation**: Approved submissions automatically create official training records
- **Database**: `self_report_configs` and `training_submissions` tables with migration `20260214_0200`

#### Shift Completion Reports
- **Shift Report Form**: Officers file detailed reports on trainee shift experiences at `/training/shift-reports`
- **Performance Tracking**: 1-5 star rating, areas of strength, areas for improvement, officer narrative
- **Skills Observed**: Track specific skills with demonstrated/not-demonstrated status
- **Auto-Pipeline Progress**: Reports linked to enrollments automatically update requirement progress for SHIFTS, CALLS, and HOURS requirement types
- **Trainee Acknowledgment**: Trainees can review and acknowledge reports with comments
- **Three-Tab Interface**: New Report, Filed Reports (by officer), My Reports (received as trainee)
- **Database**: `shift_completion_reports` table with migration `20260214_0300`
- **API**: 9 endpoints under `/api/v1/training/shift-reports/`

#### Training Reports
- **Training Progress Report**: Pipeline enrollment progress, requirement completion rates, member advancement status
- **Annual Training Report**: Comprehensive annual breakdown of training hours, shift hours, courses, calls, performance ratings, training by type
- **Date Range Picker**: Customizable reporting periods with preset buttons (This Year, Last Year, Last 90 Days, Custom) and date inputs
- **Report Period Display**: Selected period shown in report results modal header

#### Member Training Page ("My Training")
- **Personal Training Page** at `/training/my-training`: Aggregated view of all training data for each member
- **Collapsible Sections**: Training hours summary, certifications, pipeline progress, shift reports, training history, submissions
- **Stat Cards**: Total hours, records, shifts, average rating at a glance
- **Certification Alerts**: Expired and expiring-soon badges with days-until-expiry
- **Navigation**: Quick action links from Training Dashboard and member profile

#### Member Visibility Configuration
- **TrainingModuleConfig Model**: 14 boolean visibility toggles per organization controlling what members see
- **Officer Settings Tab**: Officers can toggle each data category on/off from the My Training page
- **Granular Control**: Independently control training history, hours, certifications, pipeline progress, requirement details, shift reports, shift stats, performance ratings, strengths, improvement areas, skills observed, officer narrative, submission history, and report export
- **Default-Off Fields**: Officer narrative and report export are hidden from members by default
- **Officer Override**: Officers and administrators always see the full dataset regardless of settings
- **Database**: `training_module_configs` table with migration `20260214_0400`
- **API**: 4 endpoints under `/api/v1/training/module-config/`

#### Documentation Updates
- **TRAINING_PROGRAMS.md**: Added sections for self-reported training, shift completion reports, member training page, member visibility configuration, training reports, and new database schemas
- **TROUBLESHOOTING.md**: Added Training Module section with 7 troubleshooting scenarios covering self-reported training, shift reports, my training page, visibility settings, and training reports
- **CHANGELOG.md**: Comprehensive changelog entry for all training module features

### Added - Events Module Enhancements (2026-02-14)

#### Recurring Events & Templates
- **Recurrence Patterns**: Support for daily, weekly, monthly, and yearly recurrence with configurable intervals, end dates, and occurrence limits
- **Event Templates**: Create and apply reusable event templates for common event configurations
- **Recurrence Pattern Models**: `EventRecurrence` and `EventTemplate` database models with full schema support
- **Frontend Types**: Complete TypeScript types for recurrence patterns, templates, and event duplication

#### Event Creation & Editing
- **Dedicated EventCreatePage**: Full-featured event creation page with `EventForm` component (extracted from EventsPage for better code organization)
- **Event Edit/Delete UI**: `EventEditPage` with pre-populated form, delete confirmation, and cancel notifications
- **Event Duplication**: Duplicate existing events from the detail page with all settings carried over
- **EventForm Component**: Reusable form component with all event fields, validation, and type safety

#### Event Attachments
- **Upload Endpoint**: `POST /events/{id}/attachments` for file uploads with metadata
- **Download Endpoint**: `GET /events/{id}/attachments/{attachment_id}` for file retrieval
- **Delete Endpoint**: `DELETE /events/{id}/attachments/{attachment_id}` for file removal

#### Event Operations
- **Booking Prevention**: Prevent double-booking of locations for overlapping event times
- **RSVP Overrides**: Admin override for RSVP limits and deadline enforcement
- **Event Notifications**: Cancel notifications sent when events are deleted
- **Organization Timezone**: Timezone support added to auth flow and date formatting utilities

#### Test Coverage
- **5 Test Files**: Comprehensive test coverage for `EventForm`, `EventCreatePage`, `EventDetailPage`, `EventEditPage`, and `EventsPage`
- **1,865+ Test Lines**: Full component testing with mock API responses, form interactions, and edge cases

### Fixed - TypeScript & Backend Quality (2026-02-14)

#### TypeScript Build Fixes
- **All Build Errors Resolved**: Fixed all TypeScript compilation errors across the entire frontend codebase
- **17 'as any' Assertions Removed**: Replaced all unsafe `as any` type assertions with proper typing across 7 files (apparatus API, AddMember, EventDetailPage, EventQRCodePage tests, MinutesDetailPage, test setup, errorHandling utility)
- **Broken JSX Fixed**: Repaired broken JSX in `DocumentsPage` and `MinutesPage` caused by merged duplicate code blocks
- **Duplicate Type Identifier Fixed**: Resolved duplicate `User` type export in membership types

#### Backend Quality Fixes
- **Python Backend Incongruities**: Fixed broken dependency injection, duplicate models, and missing permissions across 29 files
  - Fixed `models/__init__.py` with unified model registry
  - Added `core/permissions.py` with comprehensive permission definitions
  - Fixed meetings and minutes endpoints with correct DI patterns
  - Fixed document service and schemas
- **Mutable Default Arguments**: Fixed mutable default values (`[]`, `{}`) across all backend models (analytics, apparatus, email_template, error_log, integration, membership_pipeline, user) using `default_factory`
- **Documents Schema**: Made `file_name` optional and added missing folder fields in document schemas

#### Startup & Runtime Fixes
- **Polling Loop Fix**: Fixed infinite polling loop in onboarding check page
- **Type Safety**: Fixed type safety issues in onboarding hooks (`useApiRequest`) and `OnboardingCheck` page
- **API Client**: Fixed onboarding API client service method signatures

#### Events Module Bug Fixes
- **Runtime Crashes**: Fixed critical events module bugs causing runtime crashes and missing data
- **Event Endpoints**: Simplified and fixed event API endpoints (reduced broken logic)
- **Location Model**: Fixed location model relationship definitions
- **Event Service**: Fixed event service with proper error handling and data loading

#### Code Cleanup
- **Events Module Deduplication**: Removed duplicate code in `EventCheckInMonitoringPage` and `EventsPage`, extracted shared types to `event.ts`
- **Minute Model**: Added missing relationship for event linking

### Added - Meeting Minutes & Documents Module (2026-02-13)

#### Meeting Minutes Backend
- **Database Models**: `MeetingMinutes`, `MinutesTemplate`, `MinutesSection` with UUID primary keys, organization scoping, and foreign keys to events
- **8 Meeting Types**: `business`, `special`, `committee`, `board`, `trustee`, `executive`, `annual`, `other` — each with tailored default section templates
- **Dynamic Sections System**: Minutes use a flexible JSON sections array (`order`, `key`, `title`, `content`) replacing hardcoded content fields — sections can be added, removed, and reordered
- **Template System**: `MinutesTemplate` model with configurable sections, header/footer configs, meeting type defaults, and `is_default` flag per type
- **Default Section Presets**:
  - Business (9 sections): call to order, roll call, approval of previous, treasurer report, old/new business, etc.
  - Trustee (11 sections): adds financial review, trust fund report, audit report, legal matters
  - Executive (11 sections): adds officers' reports, strategic planning, personnel matters, executive session
  - Annual (12 sections): adds annual report, election results, awards & recognition
- **Minutes Lifecycle**: `draft` → `review` → `approved` status progression with edit protection for approved minutes
- **Publish Workflow**: Approved minutes can be published to the Documents module as styled HTML with organization branding
- **Event Linking**: Minutes can be linked to events via `event_id` foreign key
- **Search**: Full-text search across title and section content with SQL LIKE injection protection

#### Documents Backend
- **Document Management**: `Document` and `DocumentFolder` models with folder hierarchy, tagging, and file metadata
- **7 System Folders**: SOPs, Policies, Forms & Templates, Reports, Training Materials, Meeting Minutes, General Documents — auto-created on first access, non-deletable
- **Custom Folders**: Users can create, update, and delete custom folders alongside system folders
- **Document Types**: `policy`, `procedure`, `form`, `report`, `minutes`, `training`, `certificate`, `general`
- **Source Tracking**: Documents track their origin (`upload`, `generated`, `linked`) and source reference ID

#### API Endpoints
- **Minutes**: 10 endpoints — CRUD, list, search, templates CRUD, publish
- **Documents**: 5 endpoints — folders CRUD, document list/get/delete
- **Permissions**: `meetings.view` for read access, `meetings.manage` for write operations

#### Frontend Pages
- **MinutesPage.tsx**: Meeting type filtering with color-coded badges, template selector in create modal (auto-selects default template per meeting type), search, quick stats dashboard
- **MinutesDetailPage.tsx**: Dynamic section editor with rich text, section reordering (up/down), add/delete sections, publish button for approved minutes, "View in Documents" link for published minutes
- **DocumentsPage.tsx**: Folder-based browsing, document viewer modal with server-rendered HTML, grid/list view toggle, custom folder management, document count badges

#### Database Migrations
- Migration `add_meeting_minutes`: Creates `meeting_minutes` table with all fields and indexes
- Migration `20260213_0800`: Adds `minutes_templates`, `document_folders`, `documents` tables with dynamic sections support
- Migration `a7f3e2d91b04`: Extends MeetingType ENUM with `trustee`, `executive`, `annual` on both tables

### Security - Meeting Minutes Module Review (2026-02-13)

#### Fixes Applied
- **HIGH: Audit log parameter mismatch** — 6 audit log calls in minutes and documents endpoints used wrong parameter names (`action=`, `details=` instead of `event_type=`, `event_data=`), causing silent `TypeError` at runtime. Fixed all calls to use correct `log_audit_event()` signature
- **MEDIUM: SQL LIKE pattern injection** — Search inputs in `minute_service.py` (2 methods) and `document_service.py` (1 method) passed directly into `%{search}%` without escaping `%` and `_` wildcards. Fixed by escaping all three special characters before interpolation
- **LOW: Unbounded query limits** — List and search endpoints accepted arbitrary `limit` values. Added `min(limit, 100)` for list endpoints and `min(limit, 50)` for search

#### Verified Secure
- Multi-tenancy via `organization_id` scoping on all queries
- Permission checks (`meetings.view`/`meetings.manage`) on all endpoints
- Status-based edit protection (approved minutes cannot be modified)
- HTML generation uses `html.escape()` for all user content
- System folder protection (cannot delete system folders)
- Pydantic validation on all request schemas

### Fixed - Migration Chain Integrity (2026-02-13)

- **Broken Alembic migration chain**: Three minutes/documents migrations had incorrect `down_revision` values creating orphaned migration heads
  - `add_meeting_minutes`: Fixed `down_revision` from `None` to `'20260212_0400'`
  - `20260213_0800`: Fixed `down_revision` from `'20260212_1200'` (wrong revision ID) to `'add_meeting_minutes'`
  - `a7f3e2d91b04`: Fixed `down_revision` from `None` to `'20260213_0800'`

### Enhanced - Email Ballot Voting Page (2026-02-12)

#### Token-Based Ballot Page (`BallotVotingPage.tsx`)
- **Public ballot page** at `/ballot?token=xxx` — no authentication required, accessed via "Vote Now" link in email
- **Full ballot display**: Shows all ballot items with item numbers, titles, descriptions
- **Voting options per item**: Approve/Deny for approval items, candidate selection for elections, write-in for custom entries, or abstain
- **Submit Ballot button** at bottom of page with review prompt
- **Confirmation modal**: Shows summary of all choices (item title + selected option) before final submission
- **"Change Ballot" / "Cast Ballot"** options in confirmation — member can go back and modify or confirm
- **Success confirmation**: Green checkmark with submission summary (votes cast, abstentions)
- **Error handling**: Clear messages for expired tokens, already-submitted ballots, invalid links

#### Backend: Bulk Ballot Submission
- **`POST /ballot/vote/bulk?token=xxx`** endpoint: Submits all ballot item votes atomically in one transaction
- **Write-in support**: Creates write-in candidates on the fly when member enters a custom name
- **Approve/Deny candidates**: Auto-created for approval-type ballot items
- **Abstain handling**: Items marked as abstain are skipped (no vote recorded)
- **Token lifecycle**: Token marked as used after full ballot submission, preventing reuse
- **HMAC-SHA256 signatures** on every vote for tamper detection
- **Audit logging**: Full ballot submission logged with vote count and abstention count

#### Email Template Updates
- **"Vote Now" button** (was "Cast Your Vote") — centered, prominent blue button
- **Ballot URL** now points to frontend `/ballot` page instead of API endpoint

### Enhanced - Ballot Builder, Meeting Attendance & Member Class Eligibility (2026-02-12)

#### Meeting Attendance Tracking
- **Attendance management endpoints**: `POST /elections/{id}/attendees` (check in), `DELETE /elections/{id}/attendees/{user_id}` (remove), `GET /elections/{id}/attendees` (list)
- **`attendees` JSON column** on Election model to track who is present at meetings
- **Audit logging**: All attendance check-ins and removals are logged to the tamper-proof audit trail

#### Member Class Eligibility System
- **Extended `_user_has_role_type()`** with member class categories: `regular` (active non-probationary), `life` (life_member role), `probationary` (probationary status)
- **Per-ballot-item eligibility**: Each ballot item can specify which member classes may vote (e.g., only regular + life members for membership approvals)
- **Attendance requirement**: Ballot items can require meeting attendance (`require_attendance` flag) — voters must be checked in to participate
- **Combined checks**: Voting eligibility now evaluates both member class AND attendance for each ballot item

#### Ballot Templates API
- **7 pre-configured templates**: Probationary to Regular, Admin Member Acceptance, Officer Election, Board Election, General Resolution, Bylaw Amendment, Budget Approval
- **`GET /elections/templates/ballot-items`** endpoint returns templates with title/description placeholders
- **One-click creation**: Secretary selects a template, fills in the name/topic, and the ballot item is created with correct eligibility rules

#### Ballot Builder UI (`BallotBuilder.tsx`)
- **Template picker**: Visual grid of available templates with eligibility badges
- **Custom item form**: Create custom ballot items with configurable type, vote type, voter eligibility, and attendance requirements
- **Reorder and remove**: Drag items up/down, remove unwanted items
- **Live preview**: Shows title preview as secretary types the name/topic

#### Meeting Attendance UI (`MeetingAttendance.tsx`)
- **Check-in interface**: Search members by name or badge number, one-click check-in
- **Attendance display**: Green pills showing checked-in members with timestamps
- **Attendance percentage**: Shows percentage of organization members present
- **Remove capability**: Remove accidentally checked-in members

#### Database Migration
- Migration `20260212_0400`: Adds `attendees` JSON column to elections table

### Enhanced - Elections Audit Logging & Ballot Forensics (2026-02-12)

#### Tamper-Proof Audit Logging
- **Full audit trail integration**: All election operations now log to the tamper-proof `audit_logs` table with blockchain-style hash chains
- **14 event types**: `election_created`, `election_opened`, `election_closed`, `election_deleted`, `election_rollback`, `vote_cast`, `vote_cast_token`, `vote_double_attempt`, `vote_double_attempt_token`, `vote_soft_deleted`, `vote_integrity_check`, `ballot_emails_sent`, `runoff_election_created`, `forensics_report_generated`
- **Loguru structured logging**: All election operations emit structured log messages with election IDs, positions, and outcomes for operational monitoring

#### Ballot Forensics
- **Forensics aggregation endpoint** (`GET /elections/{id}/forensics`): Single API call returning vote integrity, deleted votes, rollback history, token access logs, audit trail, anomaly detection (suspicious IPs), and voting timeline
- **Anomaly detection**: Flags IP addresses with suspiciously high vote counts; provides per-hour voting timeline for detecting ballot stuffing patterns
- **BALLOT_FORENSICS_GUIDE.md**: Step-by-step playbook for investigating disputed elections with 5 scenario walkthroughs, complete API reference, and audit event reference table

### Enhanced - Elections Module Low-Priority Improvements (2026-02-12)

#### Vote Integrity & Audit Trail
- **Vote Signatures**: HMAC-SHA256 cryptographic signatures on every vote for tampering detection. New `verify_vote_integrity()` endpoint validates all signatures and reports any anomalies
- **Soft-Delete for Votes**: Votes are never hard-deleted — `deleted_at`, `deleted_by`, and `deletion_reason` columns maintain full audit trail. All queries filter out soft-deleted votes
- **Vote Integrity Verification Endpoint**: `GET /elections/{id}/integrity` returns signature validation results (PASS/FAIL, tampered vote IDs)
- **Soft-Delete Vote Endpoint**: `DELETE /elections/{id}/votes/{vote_id}` marks votes as deleted with reason, preserving audit trail

#### Voting Methods
- **Ranked-Choice (Instant-Runoff) Voting**: Full IRV implementation with iterative elimination rounds. Voters rank candidates; lowest-ranked candidate eliminated each round until majority winner found
- **Approval Voting**: Voters can approve multiple candidates; percentages calculated based on unique voters rather than total ballot count
- **Vote Rank Support**: `vote_rank` field on votes (schema, model, migration) for ranked-choice ballots

#### Bulk & Multi-Position Improvements
- **Atomic Bulk Voting**: `POST /elections/{id}/vote/bulk` now uses database savepoints — either all votes succeed or none are committed
- **Multi-Position Token Tracking**: Token-based voting tracks `positions_voted` per token; tokens are only marked as "used" when all positions are voted on

#### Frontend Components
- **Voter-Facing Ballot UI** (`ElectionBallot.tsx`): Full voting interface supporting simple, ranked-choice, and approval voting methods. Shows eligibility status, per-position voting, and confirmation
- **Candidate Management UI** (`CandidateManagement.tsx`): Admin interface for adding, editing, accepting/declining, and removing candidates with position grouping and write-in support
- **ElectionDetailPage Integration**: Ballot and candidate management sections embedded in the election detail page

#### Database Migration
- Migration `20260212_0300`: Adds `vote_signature`, `deleted_at`, `deleted_by`, `deletion_reason`, `vote_rank` to votes table; `positions_voted` to voting_tokens table; `ix_votes_deleted_at` index

### Security - Elections Module Deep Review (2026-02-12)

#### Critical Fixes (4)
- **SEC-C1: Remove status from ElectionUpdate** — Prevents bypassing `/open`, `/close`, `/rollback` validation logic by directly PATCHing the status field on DRAFT elections
- **SEC-C2: Add IntegrityError handling to `cast_vote_with_token()`** — Token-based anonymous voting now catches database constraint violations instead of returning 500 errors
- **SEC-C3: Fix anonymous vote eligibility check** — `check_voter_eligibility()`, `_get_user_votes()`, and `has_user_voted()` now query by `voter_hash` for anonymous elections instead of `voter_id` (which is NULL)
- **SEC-C4: Fix `datetime.now()` to `datetime.utcnow()`** — Results visibility check now uses consistent UTC time, preventing timezone-dependent early/late result disclosure

#### Medium Fixes (6)
- **SEC-M3: Add enum validation** — `voting_method`, `victory_condition`, and `runoff_type` are now validated against allowed values via Pydantic field validators
- **SEC-M4: Validate candidate positions** — Candidate creation now rejects positions not defined in the election's positions list
- **SEC-M5: HTML-escape rollback email content** — Election titles, performer names, reasons, and user names are HTML-escaped in rollback notification emails
- **SEC-M6: Block results visibility toggle for OPEN elections** — `results_visible_immediately` can no longer be toggled while voting is active, preventing strategic voting via live result disclosure
- **Guard `close_election()` to require OPEN status** — Prevents closing DRAFT or CANCELLED elections that were never opened
- **Frontend: Hide results visibility toggle for open elections** — Matches backend restriction

#### Updated
- **ELECTION_SECURITY_AUDIT.md** — Updated scores (7.1/10 → 9.0/10), marked all critical/high items as fixed, added new test recommendations, added audit history

### Added - Prospective Members: Withdraw & Election Package Integration (2026-02-12)

#### Withdraw / Archive Feature
- **Withdraw Action**: Active or on-hold applicants can be voluntarily withdrawn from the pipeline with an optional reason
- **Withdrawn Tab**: New tab on the main page showing all withdrawn applications with date, reason, and reactivate option
- **Withdrawn Stats Card**: Stats bar shows withdrawn count when greater than zero
- **Reactivation from Withdrawn**: Coordinators can reactivate withdrawn applications back to their previous pipeline stage
- **Confirmation Dialogs**: Withdraw action requires confirmation in both the detail drawer and table action menu

#### Election Package Integration
- **Auto-Created Packages**: When an applicant advances to an `election_vote` stage, the system automatically creates an election package bundling their data
- **Configurable Package Fields**: Stage config lets coordinators choose what applicant data to include (email, phone, address, DOB, documents, stage history)
- **Package Review UI**: Election package section in the applicant detail drawer with status badge, applicant snapshot, and editable fields
- **Coordinator Notes**: Draft packages can be edited with coordinator notes and a supporting statement for voters
- **Submit for Ballot**: "Mark Ready for Ballot" button transitions package from draft to ready for the secretary
- **Cross-Module Query**: `electionPackageService` provides endpoints for the Elections module to discover ready packages
- **Recommended Ballot Item**: Each package includes pre-configured ballot item settings from the stage's election config (voting method, victory condition, anonymous voting)
- **Package Status Tracking**: Five statuses (draft, ready, added_to_ballot, elected, not_elected) with appropriate UI for each

### Added - Prospective Members Module (2026-02-12)

#### Pipeline Management
- **Configurable Pipeline Builder**: Drag-and-drop stage builder with four stage types (form submission, document upload, election/vote, manual approval)
- **Pipeline Stages**: Each stage has a name, description, type, and optional per-stage inactivity timeout override
- **Dual View Modes**: Toggle between kanban board (drag-and-drop columns) and table view (sortable, paginated) for managing applicants
- **Server-Side Pagination**: Efficient pagination for large applicant lists with configurable page sizes
- **Bulk Actions**: Select multiple applicants to advance, hold, or reject in batch

#### Applicant Lifecycle
- **Status Tracking**: Six applicant statuses — active, on_hold, withdrawn, converted, rejected, inactive
- **Stage Progression**: Advance applicants through pipeline stages with action menu or drag-and-drop
- **Detail Drawer**: Slide-out panel showing full applicant details, notes, stage history, and activity timestamps
- **Conversion Flow**: Convert successful applicants to administrative member or probationary member via conversion modal

#### Inactivity Timeout System
- **Configurable Timeouts**: Pipeline-level default timeout with presets (3 months, 6 months, 1 year, never) or custom days
- **Per-Stage Overrides**: Individual stages can override the pipeline default for stages that naturally take longer (e.g., background checks)
- **Two-Phase Warnings**: Visual indicators at configurable warning threshold (amber at warning %, red at critical/approaching timeout)
- **Automatic Deactivation**: Applications automatically marked inactive when no action occurs within the timeout period
- **Notification Controls**: Toggle notifications for coordinators and/or applicants when approaching timeout
- **Active/Inactive Tabs**: Main page splits into Active and Inactive tabs with badge counts
- **Reactivation**: Coordinators can reactivate inactive applications; applicants can self-reactivate by resubmitting interest form
- **Auto-Purge**: Optional automatic purging of inactive applications after configurable period (default 365 days) to reduce stored private data
- **Manual Purge**: Bulk purge with confirmation modal and security messaging about permanent data deletion
- **Stats Annotations**: Statistics explicitly note what is included/excluded (active applicants only; inactive, rejected, withdrawn excluded from conversion rates)

#### Cross-Module Integration
- **Forms Integration**: Pipeline stages of type `form_submission` link to the Forms module for structured data collection
- **Elections Integration**: Pipeline stages of type `election_vote` link to the Elections module for membership votes
- **Notifications Integration**: Configurable alerts for stage changes, inactivity warnings, and timeout events

#### Onboarding & Permissions
- **Optional Module**: Added to onboarding module registry as optional, Core category module
- **Role Permissions**: Secretary and Membership Coordinator roles granted manage permissions by default
- **RBAC Integration**: `prospective_members.view` and `prospective_members.manage` permissions

#### Frontend Architecture
- **Module Structure**: Full standalone module at `frontend/src/modules/prospective-members/` with types, services, store, components, and pages
- **Zustand Store**: Comprehensive state management with server-side pagination, active/inactive tabs, loading states, and all CRUD operations
- **Route Encapsulation**: `getProspectiveMembersRoutes()` registered in App.tsx with lazy-loaded pages
- **7 Components**: PipelineBuilder, PipelineKanban, PipelineTable, ApplicantCard, ApplicantDetailDrawer, ConversionModal, StageConfigModal

### Added - Forms Module (2026-02-12)

#### Custom Forms Engine
- **Form Builder**: Full form management with 15+ field types (text, textarea, email, phone, number, date, time, datetime, select, multiselect, checkbox, radio, file, signature, section_header, member_lookup)
- **Form Lifecycle**: Draft, Published, and Archived states with publish/archive workflows
- **Starter Templates**: Pre-built templates for Membership Interest Form and Equipment Assignment Form
- **Field Configuration**: Labels, placeholders, help text, validation patterns, min/max constraints, required flags, field width (full/half/third)
- **Field Reordering**: Drag-and-drop field ordering via reorder endpoint
- **Submission Management**: View, filter, and delete submissions with pagination

#### Public-Facing Forms
- **Public Form URLs**: Each form gets a unique 12-character hex slug for public access (`/f/:slug`)
- **No-Auth Submission**: Public forms accept submissions without authentication
- **Public Form Page**: Clean, light-themed form page for external visitors with all field types rendered
- **QR Code Generation**: Downloadable QR codes (PNG/SVG) in the sharing modal for printing and placing in physical locations
- **Organization Branding**: Public forms display the organization name and form description

#### Cross-Module Integrations
- **Membership Integration**: Public form submissions can feed into the membership module for admin review
- **Inventory Integration**: Internal forms with member lookup can assign equipment via the inventory module
- **Field Mappings**: Configurable JSON field mappings between form fields and target module fields
- **Integration Management UI**: Add, view, and delete integrations per form in the admin interface

#### Form Security
- **Input Sanitization**: All form submission data is HTML-escaped, null-byte stripped, and length-limited before storage
- **Type Validation**: Email format + header injection check, phone character validation, number range validation
- **Option Validation**: Select/radio/checkbox values validated against allowed options (prevents arbitrary value injection)
- **Rate Limiting**: Public form views (60/min/IP) and submissions (10/min/IP) with lockout periods
- **Honeypot Bot Detection**: Hidden field in public forms silently rejects bot submissions with fake success response
- **Slug Validation**: Form slugs validated against strict hex pattern to prevent path traversal
- **DOMPurify**: Frontend sanitization of all server-provided text content for defense-in-depth XSS protection

#### Backend Architecture
- **Database Models**: Form, FormField, FormSubmission, FormIntegration with UUID primary keys
- **Alembic Migrations**: Two migrations for forms tables and public form extensions
- **FormsService**: Comprehensive service layer with sanitization, validation, integration processing
- **API Endpoints**: 16+ REST endpoints for form CRUD, field management, submissions, integrations, member lookup
- **Public API**: Separate `/api/public/v1/forms/` router with no authentication
- **Permissions**: `forms.view` and `forms.manage` integrated with RBAC system

### Added - Module UIs (2026-02-11)

#### Fully-Built Module Pages
- **Events Page**: Full event management with create/edit modals, event type filtering (business meeting, public education, training, social, fundraiser, ceremony), RSVP settings, reminders, QR code check-in links
- **Inventory Page**: Tabbed items/categories management with CRUD modals, item types (uniform, PPE, tool, equipment, vehicle, electronics, consumable), status tracking (available, assigned, checked out, in maintenance, lost, retired), condition tracking, search and filtering
- **Training Dashboard**: Three-tab layout (courses, requirements, certifications), expiring certification alerts (90-day window), links to officer dashboard, requirements management, programs, and session creation
- **Documents Page**: Folder-based document management with 6 default categories (SOPs, Policies, Forms & Templates, Reports, Training Materials, General Documents), grid/list view toggle, upload and folder creation modals
- **Scheduling Page**: Week/month calendar views, shift templates (day, night, morning), calendar navigation, shift creation with date ranges and staffing requirements
- **Reports Page**: Reports catalog with categories (member, training, event, compliance), report cards with descriptions and availability status
- **Minutes Page**: Meeting minutes management with type filtering (business, special, committee, board), quick stats dashboard, create modal, search and filter
- **Elections Page**: Election management with detail view sub-page

#### Navigation System
- **Persistent Side Navigation**: Fixed 256px sidebar (collapsible to 64px) with submenu support for Operations, Governance, Communication, and Settings sections
- **Top Navigation**: Horizontal header bar alternative with responsive mobile hamburger menu
- **Configurable Layout**: Users choose between top or left sidebar navigation during onboarding; preference stored in sessionStorage
- **Accessibility**: ARIA labels, focus traps for mobile menu, "Skip to main content" link, keyboard navigation

#### Dashboard
- **Stats Dashboard**: Displays total members, active members, documents count, setup percentage, recent events, and pending tasks
- **Dashboard Stats API**: `GET /api/v1/dashboard/stats` endpoint returns organization statistics
- **Training Widget**: Shows top 3 active training enrollments with progress

### Added - Roles & Permissions (2026-02-10)

#### New System Roles (8 additional roles)
- **Officers** (Priority 70): General officer role with broad operational access — scheduling, inventory, events, forms management
- **Quartermaster** (Priority 85): Department inventory, equipment, and gear assignment management
- **Training Officer** (Priority 65): Training programs, sessions, certifications, and related event management
- **Public Outreach Coordinator** (Priority 65): Public education and outreach event management
- **Meeting Hall Coordinator** (Priority 60): Meeting hall and location booking management
- **Membership Coordinator** (Priority 55): Member records, applications, onboarding/offboarding, role assignment
- **Communications Officer** (Priority 55): Website, social media, newsletters, and notification management
- **Apparatus Manager** (Priority 50): Fleet tracking, maintenance logging, and equipment checks

#### Role System Improvements
- **Unified Role Initialization**: `DEFAULT_ROLES` in `permissions.py` is now the single source of truth for all role definitions, replacing scattered role creation logic
- **Wildcard Permission Fix**: Permission check now correctly handles wildcard (`*`) permissions for IT Administrator role

### Fixed - Onboarding (2026-02-09)

#### State Persistence
- **Role Permissions Persistence**: Role permission customizations now persist across page navigation via Zustand store with localStorage; previously, navigating away from the Role Setup page reset all permissions to defaults
- **Module Configuration Persistence**: Module permission configs (`modulePermissionConfigs`) now save to the Zustand store instead of using a fake setTimeout; available roles are dynamically read from `rolesConfig` instead of being hardcoded
- **Orphaned Role ID Filtering**: When restoring module permission configs, role IDs are now validated against available roles — prevents "undefined" display when a previously-configured role is removed in the Role Setup step
- **Icon Serialization**: Role icons are serialized to string names for localStorage storage and deserialized back to React components on restore via `ICON_MAP`

#### Authentication & Navigation
- **Auth Token Key Fix**: Fixed critical redirect loop caused by AppLayout checking `localStorage.getItem('auth_token')` instead of the correct `'access_token'` key — this caused hundreds of API requests per second as the app bounced between login and dashboard
- **Branding Persistence**: Organization name and logo now transfer correctly from onboarding to the main application layout via sessionStorage

### Fixed - Infrastructure (2026-02-09)

#### Docker Graceful Shutdown
- **Exec Form CMD**: Backend Dockerfile and all Docker Compose files now use exec form (`["uvicorn", ...]`) instead of shell form, ensuring uvicorn receives SIGTERM signals directly
- **Stop Grace Period**: Added `stop_grace_period: 15s` to all Docker Compose configurations (main, minimal, Unraid) to allow in-flight requests to complete
- **Init Process**: Added `init: true` to backend services as a signal-forwarding safety net
- **Unraid Compose Files**: Updated both `docker-compose-unraid.yml` and `docker-compose-build-from-source.yml` with graceful shutdown settings

#### Backend Fixes
- **Apparatus Module Whitelist**: Fixed module slug mismatch for apparatus/public outreach in the module configuration whitelist

### Fixed - Authentication & Login (2026-02-11)

#### Login Flow
- **Login 401 Fix**: `get_user_from_token()` compared a UUID object against a `String(36)` database column causing type mismatch in aiomysql — fixed to query by token string only
- **Account Lockout Persistence**: Failed login counter was flushed but rolled back when HTTPException was raised — changed to explicit `commit()` so lockout increments persist
- **Token Refresh Type Mismatch**: `UUID(payload["sub"])` didn't match `String(36)` column — kept as string for correct comparison
- **Session Revocation Fix**: Same UUID-vs-String mismatch in session revocation resolved
- **Session Creation**: Onboarding endpoint created bare JWT with no UserSession row — now uses `create_user_tokens()` which creates the session record
- **Login Redirect**: Login page now redirects to `/dashboard` instead of `/` for authenticated users
- **ProtectedRoute Race Condition**: Route component now checks localStorage first and shows spinner while validating token, preventing flash of login page

#### Auth UX
- **Concurrent Token Refresh**: Multiple simultaneous 401 responses now share a single refresh promise instead of each triggering independent refresh calls — prevents replay detection from logging users out
- **Welcome Page Detection**: Welcome page now detects when onboarding is already completed and redirects appropriately
- **Logout Confirmation Modal**: New modal with ARIA attributes, Escape key support, and background scroll lock warns about unsaved changes before logging out

### Added - Login Page (2026-02-11)

- **Organization Branding**: Unauthenticated `GET /auth/branding` endpoint returns org name and logo; login page displays logo with "Sign in to [Org Name]" heading
- **Footer**: Copyright footer with org name and "Powered by The Logbook" text matching onboarding style
- **Logo Shape**: Updated logo container from circular to rounded square

### Added - Startup Optimization (2026-02-11)

- **Fast-Path Database Initialization**: Fresh databases now use `create_all()` instead of running 39+ Alembic migrations sequentially, reducing first-boot time from ~20 minutes to seconds
- **Onboarding Completion Fix**: Added explicit `await db.commit()` in admin-user endpoint — previously relied on auto-commit but frontend immediately called `/complete`
- **Audit Logger Savepoint**: Onboarding `/complete` endpoint was failing with 500 error due to audit logger commit conflicts — added savepoint isolation
- **End-to-End Test Script**: Comprehensive bash script (`test_onboarding_e2e.sh`) validating complete onboarding flow: startup, session management, organization creation, admin user setup, login/auth, and database verification

### Security - Election System (2026-02-10)

- **Double-Voting Prevention**: Added 4 partial unique indexes on the votes table to prevent duplicate votes at the database level — guards against race conditions and direct DB manipulation
- **Election Results Timing**: Results now require both `status=CLOSED` AND `end_date` to have passed before revealing vote counts — prevents premature result leaks during active elections
- **Integrity Error Handling**: `cast_vote()` now catches `IntegrityError` with a user-friendly message instead of a 500 error
- **Security Audit**: Comprehensive election security audit documented in `ELECTION_SECURITY_AUDIT.md` (rating: 7.1/10) — identified and resolved critical double-voting gap, catalogued anonymous voting strengths (HMAC-SHA256)

### Added - UX Improvements (2026-02-10)

#### Week 1: Core Usability
- **Password Reset Flow**: New Forgot Password and Reset Password pages
- **Live Dashboard Stats**: Replaced hardcoded dashboard values with live API data and skeleton loaders
- **User Settings Page**: Full settings page with account, password, and notification tabs
- **Dead Navigation Links Fixed**: Reports and Settings links now route correctly

#### Week 2: Safety
- **Logout Confirmation**: Modal warns about unsaved changes before logging out

#### Week 3: Onboarding Polish
- **Module Features Visible**: Module cards now display the first 3 features upfront with "+ X more" hint instead of hiding behind "More info" button
- **Breadcrumb Progress Indicator**: Step names with green checkmarks replace the simple step counter
- **Simplified Organization Setup**: Relaxed ZIP validation, form sections expanded by default
- **Focus Trap Hook**: Reusable `useFocusTrap` hook for WCAG-compliant mobile menus

#### Week 4: Contextual Help
- **Help Link Component**: Reusable `HelpLink` with 3 variants (icon/button/inline), tooltip support, configurable positioning
- **Integrated Help Tooltips**: Added to Dashboard, Organization Setup, and Reports pages

#### Additional UX Fixes
- **Membership Type Field**: Dropdown (prospective/probationary/regular/life/administrative) in admin user creation with prospective member warning banner
- **Administrator Terminology**: Clarified distinction between IT Administrator (system admin) and Administrative Member (membership type)
- **Validation Toast Fix**: `validateForm()` now returns errors directly instead of reading stale state, fixing "0 errors" toast message

### Fixed - Backend (2026-02-10)

#### SQLAlchemy Async Fixes
- **Organization Creation Greenlet Error**: Added `await db.refresh(org)` after flush to prevent lazy-loading of `organization_type.value` in async context
- **Admin User Creation Greenlet Error**: Eagerly loaded `roles` relationship before appending to avoid lazy loading in async context
- **Migration Dependency Chain**: Fixed `down_revision` pointer in vote constraints migration from non-existent ID to correct parent
- **Tax ID Field**: Added `tax_id` to onboarding Pydantic schema, service method, and API endpoint — frontend was sending it but backend rejected it with 422

#### Test Infrastructure
- **MySQL Test Database**: Tests now use actual MySQL database instead of SQLite for realistic testing
- **Transaction Management**: Replaced `commit()` calls with `flush()` for test compatibility; fixed audit logger transaction management
- **Comprehensive Onboarding Test Suite**: Full integration test coverage for onboarding flow
- **Database Initialization Fixture**: Shared test fixture for consistent database state
- **Async SQLAlchemy Review**: Full codebase audit of 32 `flush()` calls documented in `ASYNC_SQLALCHEMY_REVIEW.md` — 87.5% safe, 0 critical issues

### Added - Frontend (2026-02-08)

#### Onboarding UX Improvements
- **Unsaved Changes Warning**: Added `useUnsavedChanges` and `useFormChanged` hooks to prevent accidental data loss during navigation
  - Warns before browser refresh/close with unsaved changes
  - Blocks in-app navigation with confirmation dialog
  - Location: `frontend/src/modules/onboarding/hooks/useUnsavedChanges.ts`

- **Password Requirements Always Visible**: Password requirements now display before user starts typing
  - Shows all requirements (length, uppercase, lowercase, numbers, special characters)
  - Initially displays with unchecked indicators
  - Updates in real-time as user types
  - Location: `frontend/src/modules/onboarding/pages/AdminUserCreation.tsx`

- **Section Completion Checkmarks**: Organization setup form now shows visual completion status
  - Green checkmarks appear when required fields are filled
  - Red asterisks removed when section is complete
  - Provides instant feedback on form progress
  - Location: `frontend/src/modules/onboarding/pages/OrganizationSetup.tsx`

- **Sticky Continue Button (Mobile)**: Continue button stays visible at bottom on mobile devices
  - Uses responsive Tailwind classes (`sticky bottom-0 md:relative`)
  - Improves UX on long forms by keeping primary action visible
  - Applied to NavigationChoice and OrganizationSetup pages

#### Onboarding Validation Enhancements
- **Inline Address Validation**: Error messages now appear directly under address form fields
  - Previously only showed summary errors at bottom
  - Improves user experience by showing exactly which field has an issue
  - Location: `frontend/src/modules/onboarding/pages/OrganizationSetup.tsx`

- **URL Auto-HTTPS**: Website URLs automatically prepend `https://` if no protocol specified
  - Triggers on blur event
  - Prevents common user error of omitting protocol
  - Location: `frontend/src/modules/onboarding/pages/OrganizationSetup.tsx`

- **Improved ZIP Code Error Message**: Now shows expected format
  - Old: "Invalid ZIP code"
  - New: "Invalid ZIP code format. Expected: 12345 or 12345-6789"

#### Onboarding Progress & Consistency
- **Standardized Progress Indicators**: All onboarding pages now show consistent "Step X of 10"
  - Updated DepartmentInfo, ModuleSelection, NavigationChoice pages
  - Provides clear expectation of onboarding length

- **Enhanced Database Initialization Messaging**: Onboarding check page now explains 1-3 minute startup delay
  - Shows database connection retry attempts during MySQL initialization
  - Displays migration count and progress
  - Explains which tables are being created (users, training, events, elections, inventory, etc.)
  - Provides context for first-time startup delays
  - Location: `frontend/src/modules/onboarding/pages/OnboardingCheck.tsx`

### Removed - Frontend (2026-02-08)

- **Auto-save Notification**: Removed misleading auto-save indicators from OrganizationSetup page
  - Zustand state changes are not true "auto-saves" to backend
  - Prevents user confusion about when data is actually persisted

- **Redundant Session Storage Calls**: Removed unnecessary `sessionStorage` writes in DepartmentInfo
  - Data already persisted via Zustand store with localStorage
  - Simplified state management approach

### Fixed - Backend (2026-02-08)

#### Configuration Errors
- **Fixed Settings Configuration Reference** (`backend/app/utils/startup_validators.py`)
  - Changed `settings.MYSQL_DATABASE` → `settings.DB_NAME` (lines 64, 199)
  - Resolves error: `'Settings' object has no attribute 'MYSQL_DATABASE'`
  - Enum validation now works correctly on startup

#### Migration Errors
- **Fixed Duplicate Migration** (`backend/alembic/versions/20260206_0301_add_missing_training_tables.py`)
  - Migration was creating tables (`skill_evaluations`, `skill_checkoffs`, `shifts`, etc.) already created in migration `20260122_0015`
  - Converted to conditional migration that checks if tables exist before creating
  - Prevents error: `(1050, "Table 'skill_evaluations' already exists")`
  - Maintains backwards compatibility with existing deployments

#### API Errors
- **Fixed Organization Creation Error** (`backend/app/api/v1/onboarding.py`)
  - Endpoint was accessing `data.description` but `OrganizationSetupCreate` schema doesn't have that field
  - Changed `description=data.description` → `description=None` (line 1322)
  - Resolves error: `'OrganizationSetupCreate' object has no attribute 'description'`

### Technical Improvements

#### New Hooks & Utilities
- `useUnsavedChanges(options)`: Warns before leaving page with unsaved changes
- `useFormChanged(currentData, initialData)`: Detects if form data has changed from initial values

#### Migration System
- Improved migration error handling with conditional table creation
- Better backwards compatibility for existing installations

#### State Management
- Cleaned up redundant storage operations
- Improved consistency between Zustand store and backend persistence

## [1.0.0] - 2026-02-06

### Initial Release
- Full onboarding flow (10 steps)
- Organization setup with comprehensive fields
- Admin user creation
- Module selection system
- Role-based permission system
- Training module
- Events & RSVP module
- Elections & voting module
- Inventory management
- And more...

---

## Release Notes Format

Each release includes:
- **Added**: New features
- **Changed**: Changes in existing functionality
- **Deprecated**: Soon-to-be removed features
- **Removed**: Removed features
- **Fixed**: Bug fixes
- **Security**: Vulnerability patches

For full details on any release, see the commit history in the Git repository.
