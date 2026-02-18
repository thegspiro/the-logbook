# The Logbook — Architecture Review & Improvement Plan

## Executive Summary

This document provides a comprehensive review of The Logbook application from the perspective of five key department roles: **Chief**, **Secretary**, **Driver Trainer**, **Training Coordinator**, and **Public Outreach Coordinator**. It identifies what works well, what doesn't, and provides 15 concrete improvements (3 per role pathway) along with database schema fixes and backend dependency corrections.

---

## Part 1: Application Architecture Overview

### Tech Stack
- **Backend:** FastAPI (Python 3.11+), SQLAlchemy 2.0 (async), MySQL 8.0+, Redis 7+
- **Frontend:** React 18 (TypeScript), Vite, Tailwind CSS, Zustand, React Router 6
- **Auth:** JWT + OAuth 2.0 + SAML + LDAP, Argon2id password hashing
- **Compliance:** HIPAA-ready with AES-256 encryption, tamper-proof audit logs

### Module Map
| Module | Models | API Prefix | Frontend Routes |
|--------|--------|------------|-----------------|
| Users & Auth | User, Role, Organization, Session | `/auth`, `/users`, `/roles` | `/login`, `/members/*` |
| Events | Event, EventRSVP, EventTemplate | `/events` | `/events/*` |
| Training | 18+ models (Course, Record, Session, Program, etc.) | `/training/*` | `/training/*` |
| Scheduling | Shift, ShiftAttendance, ShiftCall + 5 more | `/scheduling` | `/scheduling` |
| Inventory | InventoryItem, Category, Assignment, Checkout | `/inventory` | `/inventory/*` |
| Apparatus | 16 models (Apparatus, Maintenance, Fuel, etc.) | `/apparatus` | `/apparatus/*` |
| Facilities | 20+ models (Facility, Maintenance, Inspection, etc.) | `/facilities` | `/facilities` |
| Elections | Election, Candidate, Vote, VotingToken | `/elections` | `/elections/*` |
| Meetings | Meeting, MeetingAttendee, MeetingActionItem | `/meetings` | (via minutes) |
| Minutes | MeetingMinutes, Motion, ActionItem, Template | `/minutes-records` | `/minutes/*` |
| Documents | Document, DocumentFolder | `/documents` | `/documents` |
| Forms | Form, FormField, FormSubmission, FormIntegration | `/forms` | `/forms`, `/f/:slug` |
| Membership Pipeline | Pipeline, Steps, ProspectiveMember | `/prospective-members` | `/prospective-members/*` |
| Notifications | NotificationRule, NotificationLog | `/notifications` | `/notifications` |
| Reports | (cross-cutting service) | `/reports` | `/reports` |

---

## Part 2: Role-Based Pathway Analysis

### 2A. THE CHIEF

**Normal Pathway:**
1. Login → Dashboard (overview of department health)
2. Review member roster, attendance trends, compliance status
3. Approve meeting minutes, review election results
4. Access reports for board presentations
5. Manage org settings, role assignments, module configuration

**What Works Well:**
- Dashboard shows notifications, upcoming shifts, and training progress
- Full admin access through role permissions (priority 95)
- Settings pages allow org configuration and role management
- Election system supports multiple voting methods

**What Does NOT Work Well:**

1. **Dashboard lacks executive-level KPIs.** The Dashboard (`Dashboard.tsx`) is member-focused — it shows personal notifications, personal shifts, and personal training progress. A Chief needs department-wide metrics: total active members, department training compliance %, upcoming events count, open action items, apparatus readiness, and budget/facility status. There is no "Chief's Dashboard" or admin dashboard widget set.

2. **No cross-module reporting summary.** The Reports page (`/reports`) relies on `ReportsService.generate_report()` which generates individual reports by type (member roster, training summary, event attendance, compliance). But there is no unified department health report that aggregates across modules. The Chief has to generate 4-5 separate reports to get a complete picture.

3. **Meeting → Minutes → Action Items workflow is disconnected.** Meetings model (`meeting.py`) has `MeetingActionItem` with `assigned_to` and `due_date`, but there is no dashboard widget or notification that surfaces overdue action items to the Chief. The minutes model (`minute.py`) has a separate `ActionItem` model with its own lifecycle. These two action item systems are not connected — a Chief cannot see all outstanding action items across both systems in one place.

**3 Improvements for the Chief:**

| # | Improvement | What Changes |
|---|-------------|--------------|
| C1 | **Add Admin Dashboard Summary API** | Create `/api/v1/dashboard/admin-summary` endpoint that aggregates: active member count, training compliance %, upcoming events, overdue action items, apparatus out-of-service count, open maintenance requests. Frontend: add admin summary cards to Dashboard when user has `settings.manage` permission. |
| C2 | **Unified Action Items View** | Create a new `/api/v1/action-items/all` endpoint that queries BOTH `meeting_action_items` AND `action_items` (from minutes) tables, returning a merged list sorted by due date. Add an "Action Items" widget to the dashboard for admins. Add a dedicated `/action-items` page. |
| C3 | **Cross-Module Department Report** | Add a "Department Overview" report type to `ReportsService` that pulls key metrics from every enabled module into a single exportable document. Include: member counts by status, training completion rates, event attendance averages, apparatus readiness, facility compliance scores, and open action items. |

---

### 2B. THE SECRETARY

**Normal Pathway:**
1. Login → Navigate to Minutes (via Governance → Minutes)
2. Create meeting record, record attendance, take notes
3. Draft minutes with motions, action items
4. Submit for review → get approval
5. Publish approved minutes → distribute to members
6. Track action items assigned during meetings

**What Works Well:**
- Minutes module has a proper Draft → Review → Approved lifecycle
- Meeting model tracks attendees with present/excused/waiver
- Motions are modeled with proposer, seconder, vote counts
- Templates exist for standardizing minutes format

**What Does NOT Work Well:**

1. **Meeting and Minutes are two separate, poorly linked systems.** The `Meeting` model (`meeting.py`) and the `MeetingMinutes` model (`minute.py`) both exist but are loosely connected. `MeetingMinutes` has an `event_id` FK but no `meeting_id` FK linking back to the `Meeting` record. This means the Secretary creates a Meeting record in one place and then must separately create Minutes in another place, manually re-entering the date, attendees, and agenda. There's no "Create Minutes from Meeting" workflow that pre-fills data.

2. **No Event-to-Meeting connection.** Events of type `BUSINESS_MEETING` are created via the Events module, but there's no foreign key from `Meeting` to `Event`. While `MeetingMinutes` already has an `event_id` FK, the `Meeting` record itself does not. The Secretary likely creates a business meeting as an Event (for RSVP/check-in), then separately creates a Meeting record. The attendance from Event check-in doesn't flow into Meeting attendance — the secretary must manually re-enter who was present.

3. **Action item tracking is fragmented.** `MeetingActionItem` (in `meeting.py`) and `ActionItem` (in `minute.py`) are completely separate tables with different schemas. If the secretary assigns action items during minutes, they exist in `action_items` with a `minutes_id` FK. But if they create them during the meeting itself, they're in `meeting_action_items`. No unified view, no cross-referencing, no notification when items are overdue.

**3 Improvements for the Secretary:**

| # | Improvement | What Changes |
|---|-------------|--------------|
| S1 | **Link MeetingMinutes to Meeting via FK** | Add `meeting_id` FK to `MeetingMinutes` model. Add migration. When a Secretary creates minutes, offer "Link to existing meeting" which auto-populates date, attendees, and agenda from the Meeting record. Update the minutes creation API to accept an optional `meeting_id` and pre-fill data. |
| S2 | **Bridge Event check-in to Meeting attendance** | Add `event_id` FK to `Meeting` model. When an Event of type `business_meeting` is completed, provide a "Generate Meeting Record" button that creates a `Meeting` with attendees pre-populated from EventRSVP check-ins. Update the Events admin and Meeting creation APIs. |
| S3 | **Unified Action Items with Notifications** | Create a shared `action_items` view/API that queries both `meeting_action_items` and minutes `action_items`. Add a `notification_trigger` in `NotificationRule` for action item due dates (3 days before, 1 day before, overdue). Surface in dashboard and notifications page. |

---

### 2C. THE DRIVER TRAINER

**Normal Pathway:**
1. Login → Training → Training Admin (requires `training.manage`)
2. Create/manage training sessions for driver training
3. Record training records for individual members (skills checkoffs)
4. Track member progress through driver training program (multi-phase)
5. Evaluate skill proficiency, record competency evaluations
6. Review and approve training submissions

**What Works Well:**
- Training module is very comprehensive with Programs, Phases, Requirements, Milestones
- `SkillEvaluation` and `SkillCheckoff` models support granular competency tracking
- `ProgramEnrollment` and `RequirementProgress` track individual member advancement
- Training sessions support attendance tracking and external provider integration

**What Does NOT Work Well:**

1. **No connection between Training Sessions and Apparatus.** A driver trainer needs to record WHICH apparatus a member trained on. The `TrainingSession` model has no `apparatus_id` FK. The `TrainingRecord` also has no apparatus reference. This is critical for driver training — you need to know that a member completed pump operations on Engine 1, not just "completed pump operations."

2. **SkillCheckoff lacks evaluator context.** `SkillCheckoff` (in `training.py`) records `checked_off_by` and `checked_off_at`, but doesn't record the training context: which session it occurred in, which apparatus was used, what conditions (day/night, weather). For driver training, certifications often require multiple checkoffs under different conditions, and there's no structured way to capture this.

3. **No recurring/expiring certification tracking.** Training requirements have `renewal_period_months` in the `TrainingRequirement` model, but there's no automated system to flag expiring certifications. The scheduled tasks service doesn't include a job for scanning expiring certifications and generating notifications. A driver trainer must manually check each member's certification dates.

**3 Improvements for the Driver Trainer:**

| # | Improvement | What Changes |
|---|-------------|--------------|
| DT1 | **Add Apparatus link to Training Sessions and Records** | Add `apparatus_id` FK (nullable) to `TrainingSession` and `TrainingRecord` models. Add migration. Update training session creation API/schema to accept optional apparatus selection. Update frontend training admin session creation form to show apparatus dropdown (populated from Apparatus module). |
| DT2 | **Enrich SkillCheckoff with training context** | Add `session_id` FK, `apparatus_id` FK, and `conditions` (JSON) fields to `SkillCheckoff`. The conditions JSON can store: `{"time_of_day": "night", "weather": "rain", "road_conditions": "wet"}`. Update checkoff API and frontend evaluation forms. |
| DT3 | **Automated Certification Expiry Notifications** | Create a scheduled task `check_expiring_certifications` that runs daily. It queries `TrainingRecord` joined with `TrainingRequirement.renewal_period_months` to find certifications expiring within 30/60/90 days. Generate `NotificationLog` entries for the member AND their training officer. Add a "Expiring Certifications" widget to the Training Admin dashboard tab. |

---

### 2D. THE TRAINING COORDINATOR

**Normal Pathway:**
1. Login → Training Admin Hub (`/training/admin`)
2. Manage training programs, requirements, and courses
3. Schedule training sessions and assign instructors
4. Track department-wide compliance and completion rates
5. Review and approve submitted training records
6. Generate training reports for state reporting requirements
7. Manage external training provider integrations (NFPA, NREMT)

**What Works Well:**
- Training Programs support multi-phase progression with prerequisites
- External training integration exists with provider mapping and sync
- Training submissions have a review/approval workflow
- Course library provides reusable training definitions

**What Does NOT Work Well:**

1. **No instructor/trainer assignment on training sessions.** `TrainingSession` model has `created_by` but no `instructor_id` or `instructors` relationship. The training coordinator can't assign instructors to sessions or track who taught what. For compliance reporting, knowing the instructor is often required.

2. **Training compliance gap analysis is missing.** While `TrainingRequirement` defines what's needed and `TrainingRecord` tracks what's completed, there's no service method that generates a compliance matrix: "For each active member, for each requirement, what's the status (complete/incomplete/expiring)?" The `competency_matrix_service.py` file exists but the frontend Training Admin hub doesn't surface a compliance matrix view.

3. **Training hours don't aggregate into scheduling/reporting.** The Dashboard shows personal training hours, but training hours recorded in `TrainingRecord` (with `hours` field) don't flow into the Reports module as department-wide totals. The reports endpoint has a `training_summary` type but it doesn't break down by member, by requirement, or by time period in a way useful for state reporting.

**3 Improvements for the Training Coordinator:**

| # | Improvement | What Changes |
|---|-------------|--------------|
| TC1 | **Add Instructor assignment to Training Sessions** | Add `instructor_id` FK (nullable, references `users.id`) and `co_instructors` (JSON array of user IDs) to `TrainingSession`. Add migration. Update session creation/edit API schema. Update frontend session form to include instructor dropdown. Add "Instructors" column to session list views. |
| TC2 | **Build Compliance Matrix API and UI** | Create `/api/v1/training/compliance-matrix` endpoint that returns `{member_id, member_name, requirements: [{req_id, req_name, status, completion_date, expiry_date}]}` for all active members. Wire up `CompetencyMatrixService` to the training admin hub. Add a "Compliance Matrix" tab showing a grid of members vs. requirements with color-coded status. |
| TC3 | **Enhanced Training Reports with aggregation** | Extend `ReportsService.generate_report("training_summary")` to support: breakdown by member, breakdown by requirement, breakdown by time period (monthly/quarterly), total department hours, and average hours per member. Add export formats (CSV, PDF). Surface in both Training Admin and Reports pages. |

---

### 2E. THE PUBLIC OUTREACH COORDINATOR

**Normal Pathway:**
1. Login → Events (create public education events, fundraisers, ceremonies)
2. Create events with public-facing details
3. Manage RSVP tracking for community events
4. Use Forms module to create public-facing feedback forms / sign-up forms
5. Manage Public Portal for community-facing information
6. Generate attendance reports for community engagement metrics

**What Works Well:**
- Events support various types including `PUBLIC_EDUCATION`, `FUNDRAISER`, `CEREMONY`
- Forms module supports public forms with slug-based URLs (`/f/:slug`)
- Form integrations can pipe data into membership pipeline
- Public Portal admin exists for configuring community-facing information
- Event templates support recurring community events

**What Does NOT Work Well:**

1. **No "community contact" or "attendee" model for non-members.** Events only track RSVP via `EventRSVP` which requires a `user_id` FK to the `users` table. Public outreach events have community attendees who are NOT system users. There's no way to track external attendee names, contact info, or attendance at public events. The `guest_count` field on EventRSVP is just a number — no details.

2. **Forms and Events are not connected.** A public outreach coordinator would want to create an event registration form (via Forms module) that links to a specific event. But `FormIntegration` only supports `membership` and `inventory` as targets — there's no `events` integration target. The coordinator must manually cross-reference form submissions with event attendance.

3. **No public event calendar or community engagement dashboard.** The Public Portal admin (`/admin/public-portal`) configures portal settings, but there's no way to expose a public event calendar showing upcoming community events. The outreach coordinator has no dashboard showing community engagement metrics: total public events held, total community attendees, form responses received, etc.

**3 Improvements for the Public Outreach Coordinator:**

| # | Improvement | What Changes |
|---|-------------|--------------|
| PO1 | **Add External Attendee tracking for Events** | Create `EventExternalAttendee` model with: `event_id` FK, `name`, `email` (optional), `phone` (optional), `organization` (optional), `checked_in`, `checked_in_at`, `notes`. Add migration. Add API endpoints for managing external attendees on events. Update Event detail frontend to show both member RSVPs and external attendees. |
| PO2 | **Add Events integration target to Forms** | Add `EVENTS = "events"` to `IntegrationTarget` enum and `EVENT_REGISTRATION = "event_registration"` to `IntegrationType` enum. Add `event_id` FK (nullable) to `FormIntegration`. When a form with events integration receives a submission, auto-create an `EventExternalAttendee` record. Update Forms admin and integration configuration UI. |
| PO3 | **Community Engagement Dashboard & Public Calendar API** | Create `/api/v1/events/public-calendar` endpoint (no auth required) that returns future events where `event_type` is `PUBLIC_EDUCATION`, `FUNDRAISER`, `CEREMONY`, or `SOCIAL`. Create `/api/v1/dashboard/community-engagement` (requires `events.manage`) that aggregates: total public events, total attendees (member + external), form submission counts, and trend data. Add "Community" tab to Events Admin hub. |

---

## Part 3: Database Schema Gaps & Disconnected Data Points

### 3A. Missing Foreign Keys & Relationships

| Issue | Location | Fix |
|-------|----------|-----|
| `MeetingMinutes` has no FK to `Meeting` | `minute.py` | Add `meeting_id = Column(String(36), ForeignKey("meetings.id"), nullable=True)` |
| `Meeting` has no FK to `Event` | `meeting.py` | Add `event_id = Column(String(36), ForeignKey("events.id"), nullable=True)` |
| `TrainingSession` has no FK to `Apparatus` | `training.py` | Add `apparatus_id = Column(String(36), ForeignKey("apparatus.id"), nullable=True)` |
| `TrainingSession` has no instructor FK | `training.py` | Add `instructor_id = Column(String(36), ForeignKey("users.id"), nullable=True)` |
| `TrainingRecord` has no FK to `Apparatus` | `training.py` | Add `apparatus_id = Column(String(36), ForeignKey("apparatus.id"), nullable=True)` |
| `SkillCheckoff` has no FK to `TrainingSession` | `training.py` | Add `session_id = Column(String(36), ForeignKey("training_sessions.id"), nullable=True)` |

### 3B. Missing Models

| Model | Purpose | Fields |
|-------|---------|--------|
| `EventExternalAttendee` | Track non-member attendees at public events | `id`, `event_id` FK, `organization_id` FK, `name`, `email`, `phone`, `organization_name`, `checked_in`, `checked_in_at`, `notes`, `created_at` |

### 3C. Enum Gaps

| Issue | Location | Fix |
|-------|----------|-----|
| `IntegrationTarget` missing `EVENTS` | `forms.py` | Add `EVENTS = "events"` |
| `IntegrationType` missing `EVENT_REGISTRATION` | `forms.py` | Add `EVENT_REGISTRATION = "event_registration"` |

### 3D. Duplicate/Fragmented Data

| Issue | Description | Fix |
|-------|-------------|-----|
| Two action item tables | `meeting_action_items` (from Meeting) and `action_items` (from Minutes) track the same concept with different schemas | Create a unified query/view API that returns both. Long-term: migrate to a single `action_items` table with `source_type` and `source_id` polymorphic fields. |
| Meeting location is free-text | `Meeting.location` is `String(255)` with no FK to `Location` | Add optional `location_id` FK to `Meeting` (keep free-text for backward compat) |

---

## Part 4: Backend Dependency Issues

### 4A. Scheduling Service imports models that may not exist

**File:** `backend/app/services/scheduling_service.py` (line 14-18)

```python
from app.models.training import (
    Shift, ShiftAttendance, ShiftCall,
    ShiftTemplate, ShiftPattern, ShiftAssignment,
    ShiftSwapRequest, ShiftTimeOff,
    AssignmentStatus, SwapRequestStatus, TimeOffStatus, PatternType,
)
```

**Issue:** `ShiftTemplate`, `ShiftPattern`, `ShiftAssignment`, `ShiftSwapRequest`, `ShiftTimeOff`, `AssignmentStatus`, `SwapRequestStatus`, `TimeOffStatus`, and `PatternType` are imported from `app.models.training` but need verification that they are all defined there. The scheduling endpoint (`scheduling.py`) also imports `BasicApparatus` from `app.models.training`. Scheduling models being in the training module file is a structural concern — they should ideally be in their own `scheduling.py` model file for clarity. **This is functional but creates maintenance confusion.**

### 4B. Missing Service Methods Referenced by API

The Reports API calls `ReportsService.generate_report()` with various report types, but the service needs to support all the types that the frontend might request. Verify that `get_available_reports()` returns types that `generate_report()` can actually handle.

### 4C. Dashboard API Missing Admin Summary

**File:** `backend/app/api/v1/endpoints/dashboard.py`

The dashboard endpoint serves member-level data (notifications, shifts, training progress, hours). There is no admin-level summary endpoint. The Chief and other admins must navigate to separate module pages to get aggregate data.

### 4D. Notification Rules Not Connected to All Modules

**File:** `backend/app/models/notification.py`

`NotificationRule` has a `trigger` field with predefined triggers, but not all modules generate notifications. Specifically:
- Action item due dates (from both Meeting and Minutes) have no notification trigger
- Certification expiry has no automatic notification
- Facility inspection due dates have no notification trigger
- Apparatus maintenance due dates have no notification trigger

---

## Part 5: Implementation Plan

### Phase 1: Database Schema Fixes (Foundation)
**Priority: HIGHEST — All other improvements depend on these**

1. **Migration: Add missing FKs to existing models**
   - `MeetingMinutes.meeting_id` → `meetings.id`
   - `Meeting.event_id` → `events.id`
   - `Meeting.location_id` → `locations.id`
   - `TrainingSession.apparatus_id` → `apparatus.id`
   - `TrainingSession.instructor_id` → `users.id`
   - `TrainingRecord.apparatus_id` → `apparatus.id`
   - `SkillCheckoff.session_id` → `training_sessions.id`
   - `SkillCheckoff.apparatus_id` → `apparatus.id`
   - `SkillCheckoff.conditions` (JSON)

2. **Migration: Create EventExternalAttendee table**

3. **Migration: Extend Forms enums**
   - Add `EVENTS` to `IntegrationTarget`
   - Add `EVENT_REGISTRATION` to `IntegrationType`

### Phase 2: Backend API Additions
**Priority: HIGH**

4. **Admin Dashboard Summary endpoint** (`/api/v1/dashboard/admin-summary`)
5. **Unified Action Items endpoint** (`/api/v1/action-items/all`)
6. **Compliance Matrix endpoint** (`/api/v1/training/compliance-matrix`)
7. **External Attendees CRUD endpoints** (`/api/v1/events/{id}/external-attendees`)
8. **Public Calendar endpoint** (`/api/v1/events/public-calendar`)
9. **Community Engagement metrics endpoint** (`/api/v1/dashboard/community-engagement`)
10. **Expiring Certifications query in training service**

### Phase 3: Service Layer Enhancements
**Priority: HIGH**

11. **Scheduled task: `check_expiring_certifications`** — daily scan + notification generation
12. **Enhanced `ReportsService.generate_report("training_summary")`** — member/requirement/time breakdowns
13. **Department Overview report type** — cross-module aggregate
14. **Forms → Events integration processor** — auto-create external attendees from form submissions

### Phase 4: Frontend Improvements
**Priority: MEDIUM**

15. **Admin Dashboard widgets** — summary cards for Chief/admins on Dashboard page
16. **Unified Action Items page** — `/action-items` with filters and status updates
17. **"Create Minutes from Meeting" button** — on Meeting detail, pre-fills minutes
18. **"Generate Meeting from Event" button** — on Event detail (business_meeting type), creates Meeting with attendees
19. **Compliance Matrix tab** — in Training Admin hub
20. **External Attendees section** — on Event detail page
21. **Community Engagement tab** — in Events Admin hub
22. **Instructor field** — on Training Session creation/edit forms
23. **Apparatus selector** — on Training Session and Training Record forms
24. **Expiring Certifications widget** — on Training Admin dashboard

### Phase 5: Data Integrity & Cleanup
**Priority: MEDIUM**

25. **Add relationship definitions** for all new FKs in SQLAlchemy models
26. **Add indexes** on new FK columns for query performance
27. **Update Pydantic schemas** for all modified models
28. **Update API documentation** for new/modified endpoints

---

## Part 6: Detailed File Changes

### Models to Modify
| File | Changes |
|------|---------|
| `backend/app/models/training.py` | Add `apparatus_id`, `instructor_id`, `co_instructors` to TrainingSession; Add `apparatus_id` to TrainingRecord; Add `session_id`, `apparatus_id`, `conditions` to SkillCheckoff |
| `backend/app/models/meeting.py` | Add `event_id` FK, `location_id` FK to Meeting |
| `backend/app/models/minute.py` | Add `meeting_id` FK to MeetingMinutes |
| `backend/app/models/event.py` | Add EventExternalAttendee class |
| `backend/app/models/forms.py` | Add EVENTS to IntegrationTarget, EVENT_REGISTRATION to IntegrationType |
| `backend/app/models/__init__.py` | Export new model (EventExternalAttendee) |

### New Service Files
| File | Purpose |
|------|---------|
| `backend/app/services/action_items_service.py` | Unified action item queries across Meeting + Minutes |
| `backend/app/services/certification_expiry_service.py` | Expiry scanning and notification |

### Service Files to Modify
| File | Changes |
|------|---------|
| `backend/app/services/dashboard_service.py` | Add `get_admin_summary()` method |
| `backend/app/services/reports_service.py` | Enhance training_summary, add department_overview type |
| `backend/app/services/event_service.py` | Add external attendee CRUD, public calendar query, community metrics |
| `backend/app/services/training_service.py` | Add compliance matrix generation |
| `backend/app/services/forms_service.py` | Add events integration processor |
| `backend/app/services/meeting_service.py` | Add create_from_event() method |
| `backend/app/services/minute_service.py` | Add create_from_meeting() method |
| `backend/app/services/scheduled_tasks.py` | Add check_expiring_certifications task |

### API Endpoint Files to Modify/Create
| File | Changes |
|------|---------|
| `backend/app/api/v1/endpoints/dashboard.py` | Add `/admin-summary` and `/community-engagement` |
| `backend/app/api/v1/endpoints/events.py` | Add external attendee endpoints, public calendar |
| `backend/app/api/v1/endpoints/training.py` | Add `/compliance-matrix` |
| `backend/app/api/v1/endpoints/action_items.py` | **NEW** — unified action items API |

### Frontend Files to Modify
| File | Changes |
|------|---------|
| `frontend/src/pages/Dashboard.tsx` | Add admin summary cards (conditional on permission) |
| `frontend/src/pages/EventDetailPage.tsx` (or admin) | Add external attendees section |
| `frontend/src/pages/TrainingAdminPage.tsx` | Add compliance matrix tab, expiring certs widget, instructor fields |
| `frontend/src/pages/EventsAdminHub.tsx` | Add community engagement tab |
| `frontend/src/pages/MinutesPage.tsx` or creation flow | Add "Create from Meeting" option |
| `frontend/src/App.tsx` | Add `/action-items` route |

### New Migration File
| File | Purpose |
|------|---------|
| `backend/alembic/versions/xxx_add_cross_module_fks.py` | All FK additions, new table, enum extensions |

---

## Summary of All 15 Improvements

| # | Role | Improvement | Type |
|---|------|-------------|------|
| C1 | Chief | Admin Dashboard Summary API + widgets | API + Frontend |
| C2 | Chief | Unified Action Items view | Model + API + Frontend |
| C3 | Chief | Cross-Module Department Report | Service + API |
| S1 | Secretary | Link MeetingMinutes → Meeting via FK | Model + Migration + API |
| S2 | Secretary | Bridge Event check-in → Meeting attendance | Model + Migration + API + Frontend |
| S3 | Secretary | Unified Action Items with Notifications | Service + Notifications |
| DT1 | Driver Trainer | Apparatus link on Training Sessions/Records | Model + Migration + API + Frontend |
| DT2 | Driver Trainer | Enrich SkillCheckoff with context | Model + Migration + API + Frontend |
| DT3 | Driver Trainer | Automated Certification Expiry Notifications | Service + Scheduled Task + Frontend |
| TC1 | Training Coordinator | Instructor assignment on Sessions | Model + Migration + API + Frontend |
| TC2 | Training Coordinator | Compliance Matrix API and UI | Service + API + Frontend |
| TC3 | Training Coordinator | Enhanced Training Reports | Service + API |
| PO1 | Public Outreach | External Attendee tracking | Model + Migration + API + Frontend |
| PO2 | Public Outreach | Forms → Events integration | Model + Migration + Service |
| PO3 | Public Outreach | Community Dashboard & Public Calendar | API + Frontend |
