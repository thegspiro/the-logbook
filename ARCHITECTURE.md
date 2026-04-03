# The Logbook — Complete Architecture Reference

> **Generated:** 2026-03-31
> **Purpose:** Master reference for all connection points, data models, API routes, frontend pages, services, stores, data paths, and data sharing across the application.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Backend API Routes](#2-backend-api-routes)
3. [Database Models](#3-database-models)
4. [Backend Services](#4-backend-services)
5. [Backend Schemas](#5-backend-schemas)
6. [Frontend Pages & Routes](#6-frontend-pages--routes)
7. [Frontend Services & API Clients](#7-frontend-services--api-clients)
8. [Frontend Stores (State Management)](#8-frontend-stores)
9. [Frontend Types](#9-frontend-types)
10. [Frontend Module Structure](#10-frontend-module-structure)
11. [Data Flow & Sharing Patterns](#11-data-flow--sharing-patterns)
12. [Cross-Module Connection Points](#12-cross-module-connection-points)
13. [Public & Unauthenticated Endpoints](#13-public--unauthenticated-endpoints)
14. [Navigation & Permission Gating](#14-navigation--permission-gating)
15. [Core Infrastructure](#15-core-infrastructure)
16. [WebSocket & Real-Time](#16-websocket--real-time)
17. [Scheduled Tasks & Background Jobs](#17-scheduled-tasks--background-jobs)

---

## 1. System Overview

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser / PWA                             │
│  React 19 + TypeScript + Vite + Tailwind + Zustand + React Router│
└──────────────────────────┬──────────────────────────────────────┘
                           │ httpOnly cookies (auth)
                           │ CSRF double-submit
                           │ axios (withCredentials: true)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Nginx Reverse Proxy                           │
│              (production: port 80/443)                           │
└──────────────┬──────────────────────────────┬───────────────────┘
               │ /api/*                        │ /*
               ▼                               ▼
┌──────────────────────────┐    ┌──────────────────────────────┐
│   FastAPI + Uvicorn       │    │   Vite Static / Dev Server   │
│   (port 3001)             │    │   (port 3000)                │
│                           │    └──────────────────────────────┘
│  ┌─────────────────────┐  │
│  │  API v1 Router       │  │
│  │  (CSRF protected)    │  │
│  ├─────────────────────┤  │
│  │  Public API Router   │  │
│  │  (no CSRF, API key)  │  │
│  ├─────────────────────┤  │
│  │  WebSocket (/ws)     │  │
│  └─────────────────────┘  │
└────────┬──────────┬───────┘
         │          │
    ┌────▼───┐  ┌───▼────┐
    │ MySQL  │  │ Redis  │
    │  8.0   │  │  7     │
    └────────┘  └────────┘
```

### Request Flow

1. **Browser** sends request with httpOnly cookie + CSRF header
2. **Nginx** routes `/api/*` to FastAPI, everything else to frontend
3. **FastAPI** verifies CSRF token → authenticates via cookie/JWT → checks permissions → calls service layer
4. **Service layer** performs business logic, queries DB via SQLAlchemy async
5. **Response** returned as camelCase JSON (Pydantic `alias_generator=to_camel`)

### Multi-Tenancy

All data is scoped by `organization_id`. Every query filters by the current user's organization. Cross-org data access is prevented at the service layer.

---

## 2. Backend API Routes

### Route Mount Points (from `backend/main.py`)

| Mount | Prefix | Description |
|-------|--------|-------------|
| `api_router` | `/api/v1` | All authenticated v1 routes (CSRF protected) |
| `public_portal_router` | `/api/public/v1` | Public portal endpoints (API key auth) |
| `public_forms_router` | `/api/public/v1/forms` | Public form access (rate limited) |
| `public_display_router` | `/api/public/v1/display` | Location kiosk display (no auth) |

### Complete Route Registry

All routes registered in `backend/app/api/v1/api.py`:

| API Prefix | Endpoint File | Tags | Route Count |
|------------|--------------|------|-------------|
| `/api/v1/auth` | `auth.py` | auth | 13 |
| `/api/v1/users` | `users.py` + `member_status.py` + `member_leaves.py` | users, member-status, member-leaves | ~28 |
| `/api/v1/roles` | `roles.py` | roles | 13 |
| `/api/v1/organization` | `organizations.py` | organization | 15 |
| `/api/v1/events` | `events.py` | events | ~35 |
| `/api/v1/event-requests` | `event_requests.py` | event-requests | 18 |
| `/api/v1/locations` | `locations.py` | locations | 6 |
| `/api/v1/apparatus` | `apparatus.py` | apparatus | ~68 |
| `/api/v1/equipment-checks` | `equipment_check.py` | equipment-checks | ~25 |
| `/api/v1/facilities` | `facilities.py` | facilities | ~28 |
| `/api/v1/security` | `security_monitoring.py` | security | 13 |
| `/api/v1/dashboard` | `dashboard.py` | dashboard | 4 |
| `/api/v1/training` | `training.py` | training | ~24 |
| `/api/v1/training/programs` | `training_programs.py` | training-programs | ~20 |
| `/api/v1/training/sessions` | `training_sessions.py` | training-sessions | 5 |
| `/api/v1/training/submissions` | `training_submissions.py` | training-submissions | 11 |
| `/api/v1/training/waivers` | `training_waivers.py` | training-waivers | 5 |
| `/api/v1/training/external` | `external_training.py` | external-training | 15 |
| `/api/v1/training/module-config` | `training_module_config.py` | training-module-config | 4 |
| `/api/v1/training/skills-testing` | `skills_testing.py` | skills-testing | 16 |
| `/api/v1/training/shift-reports` | `shift_completion.py` | shift-completion | 16 |
| `/api/v1/training/recertification` | `training_enhancements.py` | training-recertification | 5 |
| `/api/v1/training/instructors` | `training_enhancements.py` | training-instructors | 5 |
| `/api/v1/training/effectiveness` | `training_enhancements.py` | training-effectiveness | 3 |
| `/api/v1/training/multi-agency` | `training_enhancements.py` | training-multi-agency | 3 |
| `/api/v1/training/xapi` | `training_enhancements.py` | training-xapi | 3 |
| `/api/v1/training/competency` | `training_enhancements.py` | training-competency | 5 |
| `/api/v1/training/reports` | `training_enhancements.py` | training-reports | 2 |
| `/api/v1/compliance` | `training_enhancements.py` | compliance-officer | 7 |
| `/api/v1/elections` | `elections.py` | elections | ~36 |
| `/api/v1/inventory` | `inventory.py` | inventory | ~52 + 1 WS |
| `/api/v1/forms` | `forms.py` | forms | 21 |
| `/api/v1/email-templates` | `email_templates.py` | email-templates | 10 |
| `/api/v1/prospective-members` | `membership_pipeline.py` | prospective-members | ~30 |
| `/api/v1/documents` | `documents.py` | documents | 11 |
| `/api/v1/meetings` | `meetings.py` | meetings | 17 |
| `/api/v1/minutes-records` | `minutes.py` | minutes | 25 |
| `/api/v1/scheduling` | `scheduling.py` | scheduling | ~46 |
| `/api/v1/reports` | `reports.py` | reports | 7 |
| `/api/v1/notifications` | `notifications.py` | notifications | 12 |
| `/api/v1/messages` | `messages.py` | messages | 11 |
| `/api/v1/analytics` | `analytics.py` | analytics | 3 |
| `/api/v1/platform-analytics` | `platform_analytics.py` | platform-analytics | 1 |
| `/api/v1/errors` | `error_logs.py` | errors | 5 |
| `/api/v1/integrations` | `integrations.py` | integrations | 5 |
| `/api/v1/scheduled` | `scheduled.py` | scheduled-tasks | 2 |
| `/api/v1/admin-hours` | `admin_hours.py` | admin-hours | 21 |
| `/api/v1/grants` | `grants.py` | grants | ~42 |
| `/api/v1/operational-ranks` | `operational_ranks.py` | operational-ranks | 7 |
| `/api/v1/onboarding` | `onboarding.py` | onboarding | 25 |
| `/api/v1/public-portal` | `public_portal_admin.py` | public-portal-admin | 13 |
| **Total** | | | **~835+** |

### Key Cross-Module API Endpoints

These endpoints bridge data across modules:

| Endpoint | Method | Description | Connects |
|----------|--------|-------------|----------|
| `/dashboard/stats` | GET | Aggregated dashboard data | Events + Training + Scheduling + Notifications |
| `/dashboard/admin-summary` | GET | Admin-level KPIs | All modules |
| `/dashboard/action-items` | GET | Unified action items | Meetings + Minutes |
| `/dashboard/community-engagement` | GET | Community metrics | Events (external attendees) |
| `/meetings/from-event/{event_id}` | POST | Create meeting from event | Events → Meetings |
| `/minutes-records/from-meeting/{meeting_id}` | POST | Create minutes from meeting | Meetings → Minutes |
| `/training/compliance-matrix` | GET | Member compliance grid | Training + Users |
| `/training/competency-matrix` | GET | Department readiness heat-map | Training + Users |
| `/training/certifications/expiring` | GET | Cross-member cert expiry | Training + Users |
| `/training/multi-agency` | GET/POST | Joint training across departments | Training + Organizations |
| `/training/xapi/statements` | POST | xAPI statement delivery to LRS | Training + External LRS |
| `/training/reports/compliance-forecast` | GET | Projected compliance trends | Training + Users |
| `/compliance/iso-readiness` | GET | ISO compliance readiness | Training + Compliance |
| `/compliance/annual-report` | GET | Annual compliance report | Training + Users + Compliance |
| `/reports/generate` | POST | Cross-module report generation | All modules |
| `/users/{user_id}/property-return-report` | GET | Property return preview | Users + Inventory |
| `/equipment-checks/shifts/{shift_id}/checklists` | GET | Applicable checklists for shift | Equipment Checks + Scheduling + Apparatus |
| `/equipment-checks/reports/compliance` | GET | Apparatus compliance stats | Equipment Checks + Apparatus |
| `/scheduling/shifts/{id}/finalize` | POST | Finalize shift, snapshot data, auto-create draft reports | Scheduling + Training + Equipment Checks |
| `/training/shift-reports/shift-preview/{shift_id}/{trainee_id}` | GET | Auto-populate report from shift data | Training + Scheduling |
| `/training/shift-reports/officer-analytics` | GET | Org-wide shift report analytics | Training + Users |
| `/elections/{id}/send-report` | POST | Email election results to voters | Elections + Email |
| `/elections/{id}/verify-receipt` | GET | Public vote receipt verification | Elections (public, rate-limited) |

---

## 3. Database Models

### Model Files (`backend/app/models/`)

| File | Models | Table(s) |
|------|--------|----------|
| `user.py` | Organization, User, Role, Session, MemberLeaveOfAbsence | organizations, users, roles, sessions, user_roles, member_leaves_of_absence |
| `event.py` | Event, EventRSVP, EventExternalAttendee | events, event_attendees, event_external_attendees |
| `event_request.py` | EventRequest, EventRequestActivity, EventRequestEmailTemplate | event_requests, event_request_activities, event_request_email_templates |
| `training.py` | TrainingCategory, TrainingCourse, TrainingRecord, TrainingRequirement, TrainingSession, TrainingApproval, TrainingProgram, ProgramPhase, ProgramRequirement, ProgramMilestone, ProgramEnrollment, RequirementProgress, SkillEvaluation, SkillCheckoff, ExternalTrainingProvider, ExternalCategoryMapping, ExternalUserMapping, ExternalTrainingSyncLog, ExternalTrainingImport, Shift, ShiftAttendance, ShiftCall, ShiftCompletionReport | training_categories, training_courses, training_records, training_requirements, training_sessions, training_approvals, training_programs, program_phases, program_requirements, program_milestones, program_enrollments, requirement_progress, skill_evaluations, skill_checkoffs, external_training_providers, external_category_mappings, external_user_mappings, external_training_sync_logs, external_training_imports, shifts, shift_attendance, shift_calls, shift_completion_reports |
| `skills_testing.py` | SkillTemplate, SkillTest | skill_templates, skill_tests |
| `election.py` | Election, Candidate, Vote, VotingToken | elections, candidates, ballots, voting_tokens |
| `inventory.py` | InventoryCategory, InventoryItem, ItemAssignment, CheckOutRecord, MaintenanceRecord, StorageArea | inventory_categories, inventory_items, item_assignments, inventory_checkouts, maintenance_records, storage_areas |
| `apparatus.py` | Apparatus, ApparatusType, ApparatusStatus, ApparatusCustomField, ApparatusPhoto, ApparatusDocument, ApparatusMaintenanceType, ApparatusMaintenance, ApparatusFuelLog, ApparatusOperator, ApparatusEquipment, ApparatusLocationHistory, ApparatusStatusHistory, ApparatusNFPACompliance, ApparatusReportConfig, EquipmentCheckTemplate, CheckTemplateCompartment, CheckTemplateItem, ShiftEquipmentCheck, ShiftEquipmentCheckItem | apparatus, apparatus_types, apparatus_statuses, apparatus_custom_fields, apparatus_photos, apparatus_documents, apparatus_maintenance_types, apparatus_maintenance, apparatus_fuel_logs, apparatus_operators, apparatus_equipment, apparatus_location_history, apparatus_status_history, apparatus_nfpa_compliance, apparatus_report_configs, equipment_check_templates, check_template_compartments, check_template_items, shift_equipment_checks, shift_equipment_check_items |
| `facilities.py` | Facility, FacilityType, FacilityStatus, FacilityPhoto, FacilityDocument, FacilityMaintenanceType, FacilityMaintenance, FacilitySystem, FacilityInspection, FacilityUtilityAccount, FacilityUtilityReading, FacilityAccessKey, FacilityRoom, FacilityEmergencyContact, FacilityShutoffLocation, FacilityCapitalProject, FacilityInsurancePolicy, FacilityOccupant, FacilityComplianceChecklist, FacilityComplianceItem, FacilityCategory | facilities, facility_types, facility_statuses, facility_photos, facility_documents, facility_maintenance_types, facility_maintenance, facility_systems, facility_inspections, facility_utility_accounts, facility_utility_readings, facility_access_keys, facility_rooms, facility_emergency_contacts, facility_shutoff_locations, facility_capital_projects, facility_insurance_policies, facility_occupants, facility_compliance_checklists, facility_compliance_items, facility_categories |
| `meeting.py` | Meeting, MeetingAttendee, MeetingActionItem | meetings, meeting_attendees, meeting_action_items |
| `minute.py` | MeetingMinutes, MinutesTemplate, Motion, ActionItem | meeting_minutes, minute_templates, motions, action_items |
| `document.py` | Document, DocumentFolder | documents, document_folders |
| `forms.py` | Form, FormField, FormSubmission, FormIntegration | forms, form_fields, form_submissions, form_integrations |
| `notification.py` | NotificationRule, NotificationLog, DepartmentMessage, DepartmentMessageRead | notification_rules, notification_logs, department_messages, department_message_reads |
| `email_template.py` | EmailTemplate, EmailAttachment | email_templates, email_attachments |
| `membership_pipeline.py` | MembershipPipeline, MembershipPipelineStep, ProspectiveMember, ProspectStepProgress, ProspectActivityLog | pipelines, pipeline_stages, applicants, prospect_step_progress, prospect_activity_log |
| `admin_hours.py` | AdminHoursCategory, AdminHoursEntry | admin_hours_categories, admin_hours_entries |
| `location.py` | Location | locations |
| `audit.py` | AuditLog, AuditLogCheckpoint | audit_logs, audit_log_checkpoints |
| `analytics.py` | AnalyticsEvent | analytics_events |
| `error_log.py` | ErrorLog | error_logs |
| `integration.py` | Integration | integrations |
| `onboarding.py` | OnboardingChecklistItem | onboarding_checklist_items |
| `operational_rank.py` | OperationalRank | operational_ranks |
| `public_portal.py` | PublicPortalConfig, PublicPortalAPIKey, PublicPortalAccessLog, PublicPortalDataWhitelist | public_portal_configs, public_portal_api_keys, public_portal_access_logs, public_portal_data_whitelist |
| `security_alert.py` | SecurityAlertRecord | security_alerts |
| `ip_security.py` | IPException, BlockedAccessAttempt, CountryBlockRule, IPExceptionAuditLog | ip_exceptions, blocked_access_attempts, country_block_rules, ip_exception_audit_logs |
| `grant.py` | GrantOpportunity, GrantApplication, GrantBudgetItem, GrantExpenditure, GrantComplianceTask, GrantNote, FundraisingCampaign, Donor, Donation, Pledge, FundraisingEvent | grant_opportunities, grant_applications, grant_budget_items, grant_expenditures, grant_compliance_tasks, grant_notes, fundraising_campaigns, donors, donations, pledges, fundraising_events |

### Key Foreign Key Relationships

```
Organization ─┬─< User ─┬─< EventRSVP
              │          ├─< TrainingRecord
              │          ├─< ShiftAttendance
              │          ├─< ItemAssignment
              │          ├─< ProgramEnrollment
              │          ├─< MeetingAttendee
              │          ├─< AdminHoursEntry
              │          ├─< MemberLeaveOfAbsence
              │          └─< user_roles >─ Role
              │
              ├─< Event ─┬─< EventRSVP
              │           ├─< EventExternalAttendee
              │           └─< EventAttachment
              │
              ├─< TrainingCourse ─< TrainingRecord
              │
              ├─< TrainingProgram ─< ProgramPhase ─< ProgramRequirement
              │                    └─< ProgramEnrollment ─< RequirementProgress
              │
              ├─< TrainingSession ─< TrainingApproval
              │
              ├─< TrainingRequirement
              │
              ├─< Shift ─┬─< ShiftAttendance
              │           ├─< ShiftCall
              │           └─< ShiftCompletionReport ─< User (trainee + officer)
              │
              ├─< Election ─┬─< Candidate
              │              ├─< Vote
              │              └─< VotingToken
              │
              ├─< InventoryCategory ─< InventoryItem ─┬─< ItemAssignment
              │                                        ├─< CheckOutRecord
              │                                        └─< MaintenanceRecord
              │
              ├─< Apparatus ─┬─< ApparatusMaintenance
              │               ├─< ApparatusFuelLog
              │               ├─< ApparatusOperator
              │               ├─< ApparatusEquipment
              │               ├─< ApparatusPhoto / ApparatusDocument
              │               ├─< EquipmentCheckTemplate ─< CheckTemplateCompartment ─< CheckTemplateItem
              │               └─< ShiftEquipmentCheck ─< ShiftEquipmentCheckItem
              │
              ├─< Facility ─┬─< FacilityMaintenance
              │              ├─< FacilityInspection
              │              ├─< FacilityRoom
              │              └─< FacilityUtilityAccount ─< FacilityUtilityReading
              │
              ├─< Location (bridges to Facility via facility_id)
              │
              ├─< Meeting ─┬─< MeetingAttendee
              │             └─< MeetingActionItem
              │
              ├─< MeetingMinutes ─┬─< Motion
              │                   └─< ActionItem
              │
              ├─< Document / DocumentFolder
              │
              ├─< Form ─┬─< FormField
              │          ├─< FormSubmission
              │          └─< FormIntegration
              │
              ├─< MembershipPipeline ─< MembershipPipelineStep
              │                       └─< ProspectiveMember ─┬─< ProspectStepProgress
              │                                              └─< ProspectActivityLog
              │
              ├─< NotificationRule / NotificationLog
              │
              ├─< AdminHoursCategory ─< AdminHoursEntry
              │
              ├─< GrantOpportunity ─< GrantApplication ─┬─< GrantBudgetItem
              │                                          ├─< GrantExpenditure
              │                                          └─< GrantNote
              │
              └─< FundraisingCampaign ─< Donation / Pledge
```

### Key Enums

| Model File | Enum | Values |
|------------|------|--------|
| `user.py` | UserStatus | active, inactive, suspended, archived, deceased, pending |
| `user.py` | LeaveType | medical, personal, military, family, educational, administrative, other |
| `event.py` | EventType | business_meeting, training, drill, fundraiser, social, ceremony, public_education, work_detail, other |
| `event.py` | RSVPStatus | attending, not_attending, maybe, pending |
| `event.py` | CheckInWindowType | before_only, after_only, before_and_after, anytime |
| `training.py` | (various) | TrainingCategory types, approval statuses |
| `election.py` | ElectionStatus | draft, open, closed, certified, cancelled |
| `inventory.py` | ItemType | individual, pool, consumable |
| `inventory.py` | ItemCondition | new, good, fair, poor, damaged, retired |
| `inventory.py` | ItemStatus | available, assigned, checked_out, maintenance, retired, lost |
| `forms.py` | FormStatus | draft, published, archived |
| `forms.py` | FieldType | text, textarea, number, email, phone, date, select, multiselect, checkbox, radio, file, hidden, section_header |
| `forms.py` | IntegrationTarget | membership, inventory, events |
| `minute.py` | MinutesStatus | draft, submitted, approved, rejected, published |
| `minute.py` | MotionStatus | proposed, seconded, passed, failed, tabled, withdrawn |
| `notification.py` | NotificationChannel | in_app, email, sms, push |
| `membership_pipeline.py` | ProspectStatus | active, accepted, rejected, withdrawn, on_hold, expired |
| `membership_pipeline.py` | PipelineStepType | application, document_upload, background_check, interview, training, election_vote, committee_review, orientation, custom |
| `apparatus.py` | CheckType | pass_fail, present, functional, quantity, level, date_lot, reading, text |
| `apparatus.py` | TemplateType | equipment, vehicle, combined |
| `apparatus.py` | CheckTiming | start_of_shift, end_of_shift |
| `admin_hours.py` | AdminHoursEntryStatus | pending, approved, rejected |
| `admin_hours.py` | AdminHoursEntryMethod | clock, manual, qr_code |
| `grant.py` | ApplicationStatus | draft, submitted, under_review, approved, denied, withdrawn, active, closed, completed |

---

## 4. Backend Services

All services in `backend/app/services/`:

### Core Services

| Service File | Class | Primary Model(s) | Key Methods |
|-------------|-------|-------------------|-------------|
| `auth_service.py` | AuthService | User, Session | authenticate, register, refresh_token, change_password, forgot_password, reset_password |
| `user_service.py` | UserService | User | get_users, create_user, update_user, delete_user, upload_photo, get_audit_history |
| `role_service.py` | RoleService | Role | get_roles, create_role, update_role, delete_role, clone_role, assign_roles |
| `organization_service.py` | OrganizationService | Organization | get_settings, update_settings, get_enabled_modules, update_modules |
| `onboarding.py` | OnboardingService | Organization, User | create_organization, create_system_owner, configure_modules, complete_onboarding |
| `onboarding_session.py` | OnboardingSessionService | — | save_session_data, get_session_data (Redis-backed) |

### Module Services

| Service File | Class | Primary Model(s) | Key Methods |
|-------------|-------|-------------------|-------------|
| `event_service.py` | EventService | Event, EventRSVP, EventExternalAttendee | create_event, update_event, create_rsvp, check_in, self_check_in, get_stats, manage_external_attendees |
| `training_service.py` | TrainingService | TrainingRecord, TrainingCourse, TrainingRequirement | create_record, get_user_stats, get_compliance_summary, get_competency_matrix, get_expiring_certifications |
| `training_program_service.py` | TrainingProgramService | TrainingProgram, ProgramPhase, ProgramEnrollment | create_program, create_phase, enroll_member, update_progress, duplicate_program |
| `training_session_service.py` | TrainingSessionService | TrainingSession, TrainingApproval | create_session, finalize_session, get_approval, submit_approval |
| `training_submission_service.py` | TrainingSubmissionService | TrainingSubmission | create_submission, review_submission, get_pending |
| `training_waiver_service.py` | TrainingWaiverService | TrainingWaiver | create_waiver, list_waivers, update_waiver |
| `training_compliance.py` | TrainingComplianceService | TrainingRecord, TrainingRequirement | get_compliance_matrix, get_expiring_certs |
| `training_module_config_service.py` | TrainingModuleConfigService | — | get_config, update_config, get_visibility |
| `external_training_service.py` | ExternalTrainingService | ExternalTrainingProvider, ExternalTrainingSyncLog | create_provider, test_connection, trigger_sync, import_records |
| `shift_completion_service.py` | ShiftCompletionService | ShiftCompletionReport | create_report, update_report, review_report, acknowledge_report, get_reports_for_trainee, get_reports_by_officer, get_all_reports, get_reports_by_status, get_trainee_stats, get_officer_analytics |
| `skills_testing_service.py` | SkillsTestingService | SkillTemplate, SkillTest | create_template, publish_template, create_test, complete_test, calculate_score |
| `scheduling_service.py` | SchedulingService | Shift, ShiftAttendance, ShiftCall, ShiftTemplate, ShiftPattern, ShiftAssignment, ShiftSwapRequest, ShiftTimeOff | create_shift, manage_attendance, create_template, create_pattern, generate_shifts, manage_assignments, manage_swap_requests, manage_time_off, get_reports, finalize_shift |
| `election_service.py` | ElectionService | Election, Candidate, Vote, VotingToken | create_election, open_election, close_election, cast_vote, get_results, verify_integrity, manage_proxy_voting |
| `inventory_service.py` | InventoryService | InventoryItem, InventoryCategory, ItemAssignment, CheckOutRecord | create_item, assign_item, checkout, checkin, get_summary, import_csv, generate_labels |
| `apparatus_service.py` | ApparatusService | Apparatus, ApparatusType, ApparatusStatus, ApparatusMaintenance | create_apparatus, manage_types, manage_statuses, manage_maintenance, manage_fuel_logs, manage_operators, manage_equipment |
| `equipment_check_service.py` | EquipmentCheckService | EquipmentCheckTemplate, ShiftEquipmentCheck | manage_templates, manage_compartments, manage_items, submit_check, get_reports, manage_photos |
| `facilities_service.py` | FacilitiesService | Facility, FacilityType, FacilityMaintenance, FacilityInspection | create_facility, manage_maintenance, manage_inspections, manage_utility_readings |
| `location_service.py` | LocationService | Location | create_location, update_location, get_display_info |
| `meetings_service.py` | MeetingsService | Meeting, MeetingAttendee, MeetingActionItem | create_meeting, manage_attendees, manage_action_items, create_from_event |
| `minute_service.py` | MinuteService | MeetingMinutes, Motion, ActionItem | create_minutes, submit, approve, reject, publish, create_from_meeting |
| `document_service.py` | DocumentService | Document, DocumentFolder | upload_document, create_folder, get_documents |
| `documents_service.py` | DocumentsService | Document, DocumentFolder | (alternate document service) |
| `forms_service.py` | FormsService | Form, FormField, FormSubmission, FormIntegration | create_form, publish_form, submit_form, manage_integrations |
| `email_template_service.py` | EmailTemplateService | EmailTemplate, EmailAttachment | get_templates, update_template, preview, schedule_email |
| `email_service.py` | EmailService | — | send_email, send_templated_email |
| `membership_pipeline_service.py` | MembershipPipelineService | MembershipPipeline, ProspectiveMember | create_pipeline, create_prospect, advance_prospect, complete_step |
| `admin_hours_service.py` | AdminHoursService | AdminHoursCategory, AdminHoursEntry | manage_categories, clock_in, clock_out, create_manual_entry, review_entry |
| `notifications_service.py` | NotificationsService | NotificationRule, NotificationLog | create_rule, send_notification, get_user_notifications |
| `messaging_service.py` | MessagingService | DepartmentMessage | create_message, get_inbox, mark_read |
| `reports_service.py` | ReportsService | — (cross-cutting) | generate_report, get_available_reports |
| `grant_service.py` | GrantService | GrantOpportunity, GrantApplication, FundraisingCampaign, Donor, Donation | manage_grants, manage_campaigns, manage_donors, manage_donations |
| `fundraising_service.py` | FundraisingService | FundraisingCampaign, Donor, Donation, Pledge | (fundraising-specific operations) |
| `operational_rank_service.py` | OperationalRankService | OperationalRank | create_rank, update_rank, reorder_ranks |

### Specialized Services (No Direct Frontend Exposure)

| Service File | Class | Purpose |
|-------------|-------|---------|
| `competency_matrix_service.py` | CompetencyMatrixService | Skills/competency tracking matrix computation |
| `cert_alert_service.py` | CertAlertService | Certification expiry alerting logic (tiered: 90/60/30/7 days + expired escalation) |
| `recertification_service.py` | RecertificationService | Automated recertification pathway generation and reminders |
| `struggling_member_service.py` | StrugglingMemberService | Detects members at risk of disengagement |
| `departure_clearance_service.py` | DepartureClearanceService | Exit procedure checklists |
| `property_return_service.py` | PropertyReturnService | Department property return tracking |
| `property_return_reminder_service.py` | PropertyReturnReminderService | Automated property return reminders |
| `quorum_service.py` | QuorumService | Meeting quorum calculation |
| `member_archive_service.py` | MemberArchiveService | Inactive member archival |
| `attendance_dashboard_service.py` | AttendanceDashboardService | Attendance analytics computation |
| `membership_tier_service.py` | MembershipTierService | Membership tier management and advancement |
| `member_leave_service.py` | MemberLeaveService | Leave of absence management |
| `inventory_notification_service.py` | InventoryNotificationService | Inventory-specific notifications |
| `ip_security_service.py` | IPSecurityService | IP blocking and geofencing |
| `security_monitoring.py` | SecurityMonitoringService | Intrusion detection, data exfiltration checks |
| `template_service.py` | TemplateService | Jinja2 email template rendering |
| `scheduled_tasks.py` | ScheduledTasksService | Background task execution |

---

## 5. Backend Schemas

All Pydantic schemas in `backend/app/schemas/`:

| Schema File | Key Classes | Pattern |
|------------|-------------|---------|
| `auth.py` | LoginRequest, TokenResponse, PasswordChangeRequest, PasswordResetRequest | Request/Response |
| `user.py` | UserBase, UserCreate, UserUpdate, UserResponse, UserWithRoles | Base/Create/Update/Response |
| `role.py` | RoleBase, RoleCreate, RoleUpdate, RoleResponse, PermissionResponse | Base/Create/Update/Response |
| `organization.py` | OrganizationSettings, OrganizationUpdate, ModuleSettings | Settings-based |
| `event.py` | EventBase, EventCreate, EventUpdate, EventResponse, RSVPCreate, RSVPResponse | Base/Create/Update/Response |
| `event_request.py` | EventRequestCreate, EventRequestResponse, EventRequestStatusUpdate | Create/Response |
| `training.py` | TrainingRecordCreate, TrainingRecordResponse, CourseCreate, CourseResponse, RequirementCreate | Create/Response |
| `training_program.py` | ProgramCreate, ProgramResponse, PhaseCreate, EnrollmentCreate, ProgressUpdate | Create/Response |
| `training_session.py` | SessionCreate, SessionResponse, ApprovalResponse | Create/Response |
| `training_submission.py` | SubmissionCreate, SubmissionResponse, ReviewAction | Create/Response |
| `election.py` | ElectionCreate, ElectionResponse, CandidateCreate, VoteCreate, ResultsResponse | Create/Response |
| `inventory.py` | ItemCreate, ItemUpdate, ItemResponse, AssignmentCreate, CheckoutCreate, CheckoutResponse | Create/Update/Response |
| `apparatus.py` | ApparatusCreate, ApparatusUpdate, ApparatusResponse, MaintenanceCreate, FuelLogCreate | Create/Update/Response |
| `facilities.py` | FacilityCreate, FacilityUpdate, FacilityResponse, MaintenanceCreate, InspectionCreate | Create/Update/Response |
| `location.py` | LocationCreate, LocationUpdate, LocationResponse | Create/Update/Response |
| `meetings.py` | MeetingCreate, MeetingUpdate, MeetingResponse, ActionItemCreate | Create/Update/Response |
| `minute.py` | MinutesCreate, MinutesUpdate, MinutesResponse, MotionCreate, ActionItemCreate | Create/Update/Response |
| `document.py` / `documents.py` | DocumentCreate, DocumentResponse, FolderCreate, FolderResponse | Create/Response |
| `forms.py` | FormCreate, FormUpdate, FormResponse, FieldCreate, SubmissionCreate, IntegrationCreate | Create/Update/Response |
| `email_template.py` | TemplateResponse, TemplateUpdate, ScheduleEmailRequest | Response/Update |
| `membership_pipeline.py` | PipelineCreate, PipelineResponse, StepCreate, ProspectCreate, ProspectUpdate | Create/Update/Response |
| `admin_hours.py` | CategoryCreate, CategoryResponse, EntryCreate, EntryResponse, ClockInRequest | Create/Response |
| `notifications.py` | RuleCreate, RuleUpdate, LogResponse, NotificationSummary | Create/Update/Response |
| `scheduling.py` | ShiftCreate, ShiftUpdate, ShiftResponse, TemplateCreate, PatternCreate, AssignmentCreate, SwapRequestCreate | Create/Update/Response |
| `shift_completion.py` | ShiftReportCreate, ShiftReportResponse, ReviewAction | Create/Response |
| `skills_testing.py` | TemplateCreate, TemplateResponse, TestCreate, TestResponse | Create/Response |
| `reports.py` | ReportRequest, ReportResponse, SavedReportCreate | Request/Response |
| `grant.py` | GrantOpportunityCreate, ApplicationCreate, CampaignCreate, DonorCreate, DonationCreate | Create/Response |
| `platform_analytics.py` | PlatformAnalyticsResponse | Response |
| `public_portal.py` | PortalConfigResponse, APIKeyCreate, WhitelistEntry | Response/Create |
| `operational_rank.py` | RankCreate, RankUpdate, RankResponse | Create/Update/Response |
| `training_module_config.py` | ModuleConfigResponse, ModuleConfigUpdate | Response/Update |
| `training_enhancements.py` | RecertificationPathway, InstructorQualification, TrainingEffectiveness, MultiAgencyTraining, XAPIStatement, CompetencyMatrix, ComplianceAttestation, ISOReadiness | Create/Response |

All Response schemas use `ConfigDict(from_attributes=True, alias_generator=to_camel, populate_by_name=True)` for automatic camelCase JSON serialization.

---

## 6. Frontend Pages & Routes

### Public Routes (No Auth Required)

| URL Path | Component | Module |
|----------|-----------|--------|
| `/login` | LoginPage | (root) |
| `/forgot-password` | ForgotPasswordPage | (root) |
| `/reset-password` | ResetPasswordPage | (root) |
| `/f/:slug` | PublicFormPage | forms |
| `/ballot` | BallotVotingPage | elections |
| `/display/:code` | LocationKioskPage | facilities |
| `/event-request/status/:token` | EventRequestStatusPage | events |
| `/application-status/:token` | ApplicationStatusPage | prospective-members |

### Onboarding Routes (No Auth, No AppLayout)

| URL Path | Component |
|----------|-----------|
| `/` | Welcome |
| `/onboarding` | OnboardingCheck |
| `/onboarding/start` | OrganizationSetup |
| `/onboarding/navigation-choice` | NavigationChoice |
| `/onboarding/email-platform` | EmailPlatformChoice |
| `/onboarding/email-config` | EmailConfiguration |
| `/onboarding/file-storage` | FileStorageChoice |
| `/onboarding/file-storage-config` | FileStorageConfigPlaceholder |
| `/onboarding/authentication` | AuthenticationChoice |
| `/onboarding/it-team` | ITTeamBackupAccess |
| `/onboarding/positions` | PositionSetup |
| `/onboarding/modules` | ModuleOverview |
| `/onboarding/modules/:moduleId/config` | ModuleConfigTemplate |
| `/onboarding/system-owner` | SystemOwnerCreation |
| `/onboarding/security-check` | SecurityCheckPlaceholder |

### Protected Routes (Auth Required)

All routes below are inside `<AppLayout>` + `<ProtectedRoute>`. All non-Dashboard pages use `lazyWithRetry()`.

#### Core

| URL | Component | Permission |
|-----|-----------|------------|
| `/dashboard` | Dashboard | auth only |
| `/account` | UserSettingsPage | auth only |
| `/notifications` | NotificationsPage | auth only |

#### Members

| URL | Component | Permission |
|-----|-----------|------------|
| `/members` | Members | auth only |
| `/members/scan` | MemberScanPage | auth only |
| `/members/:userId` | MemberProfilePage | auth only |
| `/members/:userId/training` | MemberTrainingHistoryPage | auth only |
| `/members/:userId/id-card` | MemberIdCardPage | auth only |
| `/members/admin` | MembersAdminHub | `members.manage` |
| `/members/admin/edit/:userId` | MemberAdminEditPage | `members.manage` |
| `/members/admin/history/:userId` | MemberAuditHistoryPage | `members.manage` |
| `/members/admin/waivers` | WaiverManagementPage | `members.manage` |

#### Events

| URL | Component | Permission |
|-----|-----------|------------|
| `/events` | EventsPage | auth only |
| `/events/:id` | EventDetailPage | auth only |
| `/events/:id/qr-code` | EventQRCodePage | auth only |
| `/events/:id/check-in` | EventSelfCheckInPage | auth only |
| `/events/admin` | EventsAdminHub | `events.manage` |
| `/events/:id/edit` | EventEditPage | `events.manage` |
| `/events/:id/monitoring` | EventCheckInMonitoringPage | `events.manage` |
| `/events/:id/analytics` | AnalyticsDashboardPage | `analytics.view` |

#### Training

| URL | Component | Permission |
|-----|-----------|------------|
| `/training` | MyTrainingPage | auth only |
| `/training/my-training` | MyTrainingPage | auth only |
| `/training/submit` | SubmitTrainingPage | auth only |
| `/training/courses` | CourseLibraryPage | auth only |
| `/training/programs` | TrainingProgramsPage | auth only |
| `/training/programs/:programId` | PipelineDetailPage | auth only |
| `/training/admin` | TrainingAdminPage | `training.manage` |
| `/training/skills-testing` | SkillsTestingPage | auth only |
| `/training/skills-testing/templates/new` | SkillTemplateBuilderPage | `training.manage` |
| `/training/skills-testing/templates/:id` | SkillTemplateBuilderPage | `training.manage` |
| `/training/skills-testing/templates/:id/edit` | SkillTemplateBuilderPage | `training.manage` |
| `/training/skills-testing/test/new` | StartSkillTestPage | auth only |
| `/training/skills-testing/test/:testId` | ActiveSkillTestPage | auth only |
| `/training/skills-testing/test/:testId/active` | ActiveSkillTestPage | auth only |

#### Apparatus

| URL | Component | Permission |
|-----|-----------|------------|
| `/apparatus` | ApparatusListPage | auth only |
| `/apparatus/new` | ApparatusFormPage | `apparatus.manage` |
| `/apparatus/:id` | ApparatusDetailPage | auth only |
| `/apparatus/:id/edit` | ApparatusFormPage | `apparatus.manage` |

#### Inventory

| URL | Component | Permission |
|-----|-----------|------------|
| `/inventory` | InventoryPage | auth only |
| `/inventory/my-equipment` | MyEquipmentPage | auth only |
| `/inventory/admin` | InventoryAdminHub | `inventory.manage` |
| `/inventory/admin/kits` | EquipmentKitsPage | `inventory.manage` |
| `/inventory/admin/variant-groups` | VariantGroupsPage | `inventory.manage` |
| `/inventory/checkouts` | InventoryCheckoutsPage | `inventory.manage` |
| `/inventory/storage-areas` | StorageAreasPage | auth only |
| `/inventory/import` | ImportInventoryPage | `inventory.manage` |

#### Scheduling

| URL | Component | Permission |
|-----|-----------|------------|
| `/scheduling` | SchedulingPage | auth only |
| `/scheduling/templates` | SchedulingTemplatesPage | `scheduling.manage` |
| `/scheduling/patterns` | SchedulingPatternsPage | `scheduling.manage` |
| `/scheduling/reports` | SchedulingReportsPage | `scheduling.manage` |
| `/scheduling/settings` | SchedulingSettingsPage | `scheduling.manage` |
| `/scheduling/equipment-check-templates/new` | EquipmentCheckTemplateBuilder | `equipment_check.manage` |
| `/scheduling/equipment-check-templates/:templateId` | EquipmentCheckTemplateBuilder | `equipment_check.manage` |
| `/scheduling/equipment-check-reports` | EquipmentCheckReportsPage | `equipment_check.manage` |

#### Facilities & Locations

| URL | Component | Permission |
|-----|-----------|------------|
| `/facilities` | FacilitiesPage | auth only |
| `/locations` | LocationsPage | auth only |
| `/apparatus-basic` | ApparatusBasicPage | auth only |

#### Elections

| URL | Component | Permission |
|-----|-----------|------------|
| `/elections` | ElectionsPage | auth only |
| `/elections/:electionId` | ElectionDetailPage | auth only |

#### Minutes & Action Items

| URL | Component | Permission |
|-----|-----------|------------|
| `/minutes` | MinutesPage | auth only |
| `/minutes/:minutesId` | MinutesDetailPage | auth only |
| `/action-items` | ActionItemsPage | auth only |

#### Documents

| URL | Component | Permission |
|-----|-----------|------------|
| `/documents` | DocumentsPage | auth only |

#### Forms

| URL | Component | Permission |
|-----|-----------|------------|
| `/forms` | FormsPage | `forms.view` |

#### Grants & Fundraising

| URL | Component | Permission |
|-----|-----------|------------|
| `/grants` | GrantsDashboardPage | auth only |
| `/grants/opportunities` | GrantOpportunitiesPage | auth only |
| `/grants/applications` | GrantApplicationsPage | auth only |
| `/grants/applications/new` | GrantApplicationFormPage | `fundraising.manage` |
| `/grants/applications/:id` | GrantDetailPage | auth only |
| `/grants/applications/:id/edit` | GrantApplicationFormPage | `fundraising.manage` |
| `/grants/campaigns` | CampaignsPage | auth only |
| `/grants/donors` | DonorsPage | auth only |
| `/grants/donations` | DonationsPage | auth only |
| `/grants/reports` | GrantsReportsPage | `fundraising.view` |

#### Admin Hours

| URL | Component | Permission |
|-----|-----------|------------|
| `/admin-hours` | AdminHoursPage | auth only |
| `/admin-hours/categories/:categoryId/qr-code` | AdminHoursQRCodePage | auth only |
| `/admin-hours/:categoryId/clock-in` | AdminHoursClockInPage | auth only |
| `/admin-hours/manage` | AdminHoursManagePage | `admin_hours.manage` |

#### Prospective Members

| URL | Component | Permission |
|-----|-----------|------------|
| `/prospective-members` | ProspectiveMembersPage | `prospective_members.manage` |
| `/prospective-members/settings` | PipelineSettingsPage | `prospective_members.manage` |

#### Communications

| URL | Component | Permission |
|-----|-----------|------------|
| `/communications/email-templates` | EmailTemplatesPage | `settings.manage` |

#### Reports

| URL | Component | Permission |
|-----|-----------|------------|
| `/reports` | ReportsPage | auth only |

#### Integrations

| URL | Component | Permission |
|-----|-----------|------------|
| `/integrations` | IntegrationsPage | `settings.manage` |

#### Settings & Admin

| URL | Component | Permission |
|-----|-----------|------------|
| `/settings` | SettingsPage | `settings.manage` |
| `/settings/roles` | RoleManagementPage | `positions.manage_permissions` |
| `/setup` | DepartmentSetupPage | `settings.manage` |
| `/admin/errors` | ErrorMonitoringPage | `settings.manage` |
| `/admin/analytics` | AnalyticsDashboardPage | `analytics.view` |
| `/admin/platform-analytics` | PlatformAnalyticsPage | `settings.manage` |
| `/admin/public-portal` | PublicPortalAdmin | `settings.manage` |

**Total: ~130+ direct routes + admin hub tabs across 20+ modules**

---

## 7. Frontend Services & API Clients

### Global Services (`frontend/src/services/`)

| File | Service Object | Key Methods | API Prefix |
|------|---------------|-------------|------------|
| `api.ts` | `authService` | login, logout, refresh, getMe, changePassword, forgotPassword, resetPassword | `/auth` |
| `api.ts` | `userService` | getUsers, createUser, updateProfile, deleteUser, uploadPhoto, getAuditHistory, manageRoles | `/users` |
| `api.ts` | `organizationService` | getSettings, updateSettings, getEnabledModules, updateModules, getSetupChecklist | `/organization` |
| `api.ts` | `roleService` | getRoles, createRole, updateRole, deleteRole, cloneRole, getMyRoles, getMyPermissions | `/roles` |
| `api.ts` | `dashboardService` | getStats, getAdminSummary, getActionItems, getCommunityEngagement | `/dashboard` |
| `api.ts` | `notificationService` | getMyNotifications, getUnreadCount, markRead, manageRules | `/notifications` |
| `api.ts` | `messageService` | getInbox, getMessages, sendMessage, markRead | `/messages` |
| `api.ts` | `analyticsService` (ref) | trackEvent, getMetrics, exportAnalytics | `/analytics` |
| `api.ts` | `scheduledTasksService` | listTasks, runTask | `/scheduled` |
| `eventServices.ts` | `eventService` | getEvents, createEvent, updateEvent, manageRSVPs, checkIn, manageTemplates, manageAttachments, manageExternalAttendees | `/events` |
| `trainingServices.ts` | `trainingService`, `externalTrainingService`, `trainingProgramService`, `trainingSessionService`, `trainingSubmissionService`, `trainingModuleConfigService`, `skillsTestingService`, `recertificationService`, `competencyService`, `instructorService`, `effectivenessService`, `multiAgencyService`, `xapiService`, `reportExportService`, `documentService`, `complianceOfficerService` | getCourses, getRecords, createRecord, getRequirements, getStats, managePrograms, manageSessions, manageSubmissions, manageWaivers, manageExternalProviders, getComplianceMatrix, manageSkillTemplates, manageSkillTests, manageRecertification, manageCompetency, manageInstructors, trackEffectiveness, coordinateMultiAgency, sendXAPIStatements, exportReports, manageCompliance | `/training`, `/compliance` |
| `electionService.ts` | `electionService` | getElections, createElection, manageCandidates, castVote, getResults, manageBallots, manageProxyVoting | `/elections` |
| `inventoryService.ts` | `inventoryService` | getItems, createItem, assignItem, checkout, checkin, manageCategories, manageMaintenance, manageStorageAreas | `/inventory` |
| `documentsService.ts` | `documentsService` | getDocuments, uploadDocument, manageFolders | `/documents` |
| `meetingsServices.ts` | `meetingsService` | getMeetings, createMeeting, manageAttendees, manageActionItems, createFromEvent | `/meetings` |
| `formsServices.ts` | `formsService` | getForms, createForm, publishForm, submitForm, manageFields, manageIntegrations | `/forms` |
| `facilitiesServices.ts` | `facilitiesService` | getFacilities, createFacility, manageMaintenance, manageInspections | `/facilities` |
| `communicationsServices.ts` | `emailTemplateService`, `scheduledEmailService` | getTemplates, updateTemplate, preview, scheduleEmail | `/email-templates` |
| `userServices.ts` | `userServices` | (member-specific operations) | `/users` |
| `adminServices.ts` | `adminServices` | getErrors, getErrorStats, clearErrors, exportErrors | `/errors` |
| `analytics.ts` | analyticsService | trackEvent, getMetrics, exportAnalytics | `/analytics` |
| `authService.ts` | (standalone auth helpers) | — | — |
| `errorTracking.ts` | ErrorTrackingService | logError, getErrorsByType, getUserFriendlyMessage | — |

### API Client Factory (`frontend/src/services/apiClient.ts`)

Creates axios instances with:
- `baseURL: '/api/v1'`
- `withCredentials: true` (sends httpOnly cookies)
- Request interceptor: reads `csrf_token` cookie, attaches `X-CSRF-Token` header
- Response interceptor: 401 → attempts refresh via `POST /auth/refresh` → retries
- In-memory stale-while-revalidate cache (30s fresh, 90s stale)
- HIPAA-sensitive paths excluded from caching (`UNCACHEABLE_PREFIXES`)

### Module-Specific Services

| Module | Service File | API Prefix |
|--------|-------------|------------|
| admin-hours | `modules/admin-hours/services/api.ts` | `/admin-hours` |
| apparatus | `modules/apparatus/services/api.ts` | `/apparatus` |
| communications | `modules/communications/services/api.ts` | `/email-templates` |
| prospective-members | `modules/prospective-members/services/api.ts` | `/prospective-members` |
| public-portal | `modules/public-portal/services/api.ts` | `/public-portal` |
| scheduling | `modules/scheduling/services/api.ts` | `/scheduling` |
| reports | `modules/reports/services/api.ts` | `/reports` |
| grants-fundraising | `modules/grants-fundraising/services/api.ts` | `/grants` |
| onboarding | `modules/onboarding/services/api-client.ts` | `/onboarding` |

---

## 8. Frontend Stores

### Global Stores (`frontend/src/stores/`)

| Store File | Store Hook | State | Key Actions |
|-----------|------------|-------|-------------|
| `authStore.ts` | `useAuthStore` | user, isAuthenticated, isLoading, permissions | login, logout, loadUser, checkPermission |
| `skillsTestingStore.ts` | `useSkillsTestingStore` | templates, tests, summary, isLoading | fetchTemplates, fetchTests, createTemplate, startTest, completeTest |

### Module Stores

| Module | Store File | Store Hook | State |
|--------|-----------|------------|-------|
| admin-hours | `store/adminHoursStore.ts` | `useAdminHoursStore` | categories, entries, activeSession, activeSessions, summary, pagination |
| apparatus | `store/apparatusStore.ts` | `useApparatusStore` | apparatus, types, statuses, fleetSummary, pagination |
| communications | `store/emailTemplatesStore.ts` | `useEmailTemplatesStore` | templates, selectedTemplate, isLoading |
| communications | `store/scheduledEmailsStore.ts` | `useScheduledEmailsStore` | scheduledEmails, isLoading |
| membership | `store/membershipStore.ts` | `useMembershipStore` | members, stats, filters, pagination |
| onboarding | `store/onboardingStore.ts` | `useOnboardingStore` | currentStep, organizationData, sessionId |
| prospective-members | `store/prospectiveMembersStore.ts` | `useProspectiveMembersStore` | pipelines, applicants, kanbanData, stats, inactivitySettings |
| scheduling | `store/schedulingStore.ts` | `useSchedulingStore` | shifts, templates, patterns, assignments, swapRequests, timeOff, calendar |
| reports | `store/reportsStore.ts` | `useReportsStore` | reports, savedReports, isLoading |
| grants-fundraising | `store/grantsStore.ts` | `useGrantsStore` | opportunities, applications, campaigns, donors, donations, dashboard |

---

## 9. Frontend Types

### Global Type Files (`frontend/src/types/`)

| File | Key Interfaces/Types |
|------|---------------------|
| `auth.ts` | LoginCredentials, AuthTokens, SessionSettings, PasswordPolicy |
| `user.ts` | User, UserProfile, UserCreate, UserUpdate, UserWithRoles |
| `member.ts` | Member, MemberStatus, MemberLeave, MembershipTier |
| `role.ts` | Role, Permission, PermissionCategory |
| `event.ts` | Event, EventRSVP, EventTemplate, EventSettings, ExternalAttendee |
| `training.ts` | TrainingRecord, TrainingCourse, TrainingRequirement, TrainingSession, TrainingProgram, ProgramPhase, ProgramEnrollment, RecertificationPathway, CompetencyMatrix, InstructorQualification, TrainingEffectivenessEvaluation, MultiAgencyTraining, XAPIStatement, ComplianceForecast, ISOReadiness, ComplianceAttestation, AnnualComplianceReport, ShiftCompletionReport, ShiftCompletionReportCreate, TraineeShiftStats, MonthlyShiftData, OfficerShiftAnalytics, OfficerAnalyticsTrainee, SkillObservation, TaskPerformed |
| `scanner.ts` | MemberIdPayload, isMemberIdPayload |
| `scheduling.ts` | Shift, ShiftTemplate, ShiftPattern, ShiftAssignment, SwapRequest, TimeOff |
| `election.ts` | Election, Candidate, Vote, ElectionResults, BallotItem, ElectionReportResponse, VoteReceiptResponse |
| `document.ts` | Document, DocumentFolder |
| `minutes.ts` | MeetingMinutes, Motion, ActionItem, MinutesTemplate |
| `skillsTesting.ts` | SkillTemplate, SkillTest, SkillItem, TestResult |
| `modules.ts` | ModuleInfo, AVAILABLE_MODULES |
| `platformAnalytics.ts` | PlatformAnalytics, UsageMetrics |

### Module-Specific Types

| Module | Types File | Key Interfaces |
|--------|-----------|----------------|
| admin-hours | `types/index.ts` | AdminHoursCategory, AdminHoursEntry, ClockInRequest, AdminHoursSummary |
| apparatus | `types/index.ts` | Apparatus, ApparatusType, ApparatusStatus, Maintenance, FuelLog, Operator, Equipment, FleetSummary |
| communications | `types/index.ts` | (re-exports from global services) |
| membership | `types/index.ts` | MemberStats, MemberFilters |
| prospective-members | `types/index.ts` | Pipeline, PipelineStage, Applicant, StageConfig, ApplicantActivity |
| scheduling | `types/index.ts` | (various scheduling types) |
| reports | `types/index.ts` | Report, ReportType, SavedReport |
| grants-fundraising | `types/index.ts` | GrantOpportunity, GrantApplication, Campaign, Donor, Donation, Pledge |
| public-portal | `types/index.ts` | PortalConfig, APIKey, AccessLog, WhitelistEntry |
| onboarding | `types/index.ts` | OnboardingStep, OrganizationSetupData, ModuleConfig |

---

## 10. Frontend Module Structure

### Module Completeness Matrix

| Module | index.ts | routes.tsx | pages/ | components/ | services/ | store/ | types/ | tests |
|--------|----------|------------|--------|-------------|-----------|--------|--------|-------|
| action-items | Y | Y | — | — | — | — | — | — |
| admin | Y | Y | — | — | — | — | — | — |
| admin-hours | Y | Y | Y (4) | Y | Y | Y | Y | — |
| apparatus | Y | Y | Y (3) | Y (2) | Y | Y | Y | — |
| communications | Y | Y | Y (1) | Y (5) | Y | Y (2) | Y | 4 files |
| documents | Y | Y | — | — | — | — | — | — |
| elections | Y | Y | — | — | — | — | — | — |
| events | Y | Y | — | — | — | — | — | — |
| facilities | Y | Y | — | — | — | — | — | — |
| forms | Y | Y | — | — | — | — | — | — |
| grants-fundraising | Y | Y | Y (8) | — | Y | Y | Y | — |
| integrations | Y | Y | — | — | — | — | — | — |
| inventory | Y | Y | Y (2) | — | — | — | — | — |
| membership | Y | Y | — | — | — | Y | Y | — |
| minutes | Y | Y | — | — | — | — | — | — |
| notifications | Y | Y | — | — | — | — | — | — |
| onboarding | Y | Y | Y (12) | Y (11) | Y | Y | Y | — |
| prospective-members | Y | Y | Y (3) | Y (7) | Y | Y | Y | — |
| public-portal | Y | Y | Y (1) | Y (5) | Y | — | Y | — |
| reports | Y | Y | Y (1) | Y | Y | Y | Y | — |
| scheduling | Y | Y | — | Y (2) | Y | Y | Y | 1 file |
| settings | Y | Y | — | — | — | — | — | — |
| training | Y | Y | Y (36) | Y (9) | — | Y | — | 10 files |

Modules with only `index.ts` + `routes.tsx` use pages from `frontend/src/pages/` and global services from `frontend/src/services/`.

---

## 11. Data Flow & Sharing Patterns

### Authentication Flow

```
LoginPage → authService.login() → POST /auth/login
  → Backend sets httpOnly cookies (access_token, refresh_token, csrf_token)
  → Frontend stores has_session=true in localStorage
  → authStore.loadUser() → GET /auth/me → populates user + permissions

On page refresh:
  → authStore.loadUser() checks has_session flag
  → If true: GET /auth/me (cookies sent automatically)
  → If 401: POST /auth/refresh → retry original request
  → If refresh fails: clear has_session, redirect to /login
```

### Permission Flow

```
Backend:
  require_permission("resource.action") → checks user.roles → role_permissions
  Supports OR logic: require_permission("a.view", "a.manage") — any one grants access
  Supports AND logic: require_all_permissions("a.view", "b.view") — all required
  Wildcard: "*" (global admin), "module.*" (module admin)

Frontend:
  ProtectedRoute requiredPermission="resource.action"
  authStore.checkPermission("resource.action") → checks against cached permissions
  Navigation items gated by checkPermission() + isModuleOn()
```

### Module Feature Flag Flow

```
Backend: MODULE_*_ENABLED env vars → config.py → module_settings table
Frontend: organizationService.getEnabledModules() → GET /organization/modules
  → Navigation components check isModuleOn(key) to show/hide menu items
  → Routes are always registered (accessible by URL) but hidden from navigation
```

### Data Caching

```
GET requests → apiCache (in-memory):
  - Fresh: 30 seconds (returns cached response)
  - Stale: 90 seconds (returns cached + revalidates in background)
  - Expired: fetches fresh from server

Mutations (POST/PUT/PATCH/DELETE) → auto-invalidate by URL prefix:
  - POST /events/123/rsvp → invalidates /events/* cache entries

HIPAA exclusions (UNCACHEABLE_PREFIXES):
  /auth/, /users/, /security/, /audit/, /admin-hours/
  → Never cached, always fetched fresh
```

### Cross-Module Data References

| Source Module | Target Module | Connection | Mechanism |
|--------------|---------------|------------|-----------|
| Events | Meetings | Event → Meeting creation | `POST /meetings/from-event/{event_id}` |
| Meetings | Minutes | Meeting → Minutes creation | `POST /minutes-records/from-meeting/{meeting_id}` |
| Events | Training | Event attendance → Training records | Manual record creation referencing event |
| Events | Analytics | Event stats | `GET /events/{id}/analytics` |
| Training | Users | Compliance per member | `GET /training/compliance-summary/{user_id}` |
| Training | Scheduling | Shift completion reports | `POST /training/shift-reports` |
| Scheduling | Training | Shift finalization → draft report creation | `POST /scheduling/shifts/{id}/finalize` auto-creates draft ShiftCompletionReports |
| Training | Scheduling | Auto-populate report from shift data | `GET /training/shift-reports/shift-preview/{shift_id}/{trainee_id}` |
| Elections | Events | Import event attendees as ballot recipients | Election detail → select linked event → import checked-in attendees |
| Training | Training (Multi-Agency) | Joint training sessions across orgs | `POST /training/multi-agency` |
| Training | External LRS | xAPI statement delivery | `POST /training/xapi/statements` |
| Training | Compliance | ISO readiness, attestations, annual reports | `GET /compliance/iso-readiness`, `POST /compliance/attestations` |
| Inventory | Users | Item assignments | `GET /inventory/users/{user_id}/assignments` |
| Inventory | Users | Departure clearance | `POST /inventory/clearances` |
| Locations | Facilities | Location → Facility bridge | `location.facility_id` FK |
| Locations | Events | Event location | `event.location_id` FK |
| Locations | Training | Training session location | `training_session.location_id` FK |
| Prospective Members | Elections | Auto-create election package | Pipeline step type `election_vote` |
| Prospective Members | Forms | Pipeline application form | `FormIntegration` with target=membership |
| Forms | Events | Event registration | `FormIntegration` with target=events |
| Member Leaves | Training Waivers | Auto-create waiver from LOA | `leave.exempt_from_training_waiver` → auto-link |
| Users | Notifications | User notification preferences | `NotificationRule` per user/org |
| Scheduling | Apparatus | Equipment check templates per apparatus | `equipment_check_template.apparatus_id` FK |
| Scheduling | Apparatus | Deficiency flag from failed checks | `apparatus.has_deficiency` set by check results |
| Scheduling | Notifications | Persistent dept. messages on dashboard | `DepartmentMessage.is_persistent` flag |
| Inventory | Camera/Scanner | Barcode/QR lookup via camera | `GET /inventory/lookup` from `InventoryScanModal` |
| Members | Camera/Scanner | Member ID QR/barcode lookup | `GET /users` from `MemberIdScannerModal` / `MemberScanPage` |
| All Modules | Audit | Audit trail | `log_audit_event()` in endpoints |
| All Modules | Error Logs | Error tracking | `POST /errors/log` from frontend `errorTracker` |

---

## 12. Cross-Module Connection Points

### Action Items (Fragmented)

Two separate systems exist:

| System | Table | FK | Status Enum |
|--------|-------|----|-------------|
| Meeting Action Items | `meeting_action_items` | `meeting_id` → meetings | ActionItemStatus (open, in_progress, completed, overdue) |
| Minutes Action Items | `action_items` | `minutes_id` → meeting_minutes | MinutesActionItemStatus (pending, in_progress, completed, cancelled) |

**Unified API:** `GET /dashboard/action-items` merges both into a single response.
**Dedicated page:** `/action-items` (ActionItemsPage) shows unified view.

### Location System

```
Location (universal "place picker")
  ├── facility_id FK → Facility (when Facilities module is on)
  ├── display_code (unique, for kiosk displays)
  ├── Used by: Events (event.location_id)
  │            Training Sessions (training_session.location)
  │            Meetings (meeting.location)
  │            Scheduling (shift.location)
  └── Public kiosk: /display/:code → /api/public/v1/display/{code}
```

### Notification Triggers

| Trigger | Source Module | Channel |
|---------|-------------|---------|
| Event created/updated | Events | in_app, email |
| RSVP received | Events | in_app |
| Training submission | Training | in_app, email |
| Training approved/rejected | Training | in_app, email |
| Certification expiring | Training | in_app, email |
| Recertification reminder | Training | in_app, email |
| Training effectiveness evaluation due | Training | in_app |
| Multi-agency training invitation | Training | in_app, email |
| Shift assigned | Scheduling | in_app, email |
| Swap request | Scheduling | in_app |
| Election opened | Elections | in_app, email |
| Minutes published | Minutes | in_app |
| Form submitted | Forms | in_app, email |
| Pipeline advancement | Prospective Members | in_app |
| Admin hours pending | Admin Hours | in_app |
| Equipment check failure | Scheduling/Equipment Check | in_app, email |
| Shift finalized — draft reports created | Scheduling/Training | in_app |
| Shift report reviewed | Training | in_app |
| End-of-shift checklist reminder | Scheduling | in_app |
| Department message (persistent) | Notifications | in_app (stays until admin clears) |
| Department message (normal) | Notifications | in_app (dismissible by member) |

### Camera/Scanner Data Flow

```
InventoryScanModal:
  Camera → BarcodeDetector (Chrome/Edge) or html5-qrcode (Firefox/Safari)
    → decoded barcode string
    → GET /api/v1/inventory/lookup?q=<barcode>
    → Item matches displayed in dropdown
    → User selects item → adds to batch (checkout or return)
    → POST /api/v1/inventory/batch-checkout or batch-return

MemberIdScannerModal / MemberScanPage:
  Camera → html5-qrcode (useHtml5Scanner hook)
    → QR code decoded: JSON { type: "member_id", id: "<uuid>" } → user lookup by ID
    → Barcode decoded: raw string → user lookup by membership_number
    → GET /api/v1/users (filtered) → member profile loaded

Shared Infrastructure:
  constants/camera.ts → QR_SCAN_CONFIG, BARCODE_SCAN_CONFIG, HAS_BARCODE_DETECTOR
  hooks/useHtml5Scanner.ts → camera lifecycle, environment→user fallback
  types/scanner.ts → MemberIdPayload, isMemberIdPayload type guard
```

### Reporting Data Sources

The Reports module (`/reports`) generates cross-module reports:

| Report Type | Data Sources |
|------------|-------------|
| Member Roster | users, roles, user_roles |
| Training Summary | training_records, training_requirements, users |
| Event Attendance | events, event_attendees, users |
| Compliance Report | training_records, training_requirements, users |
| Compliance Forecast | training_records, training_requirements, users, training_waivers |
| Annual Compliance Report | training_records, training_requirements, certifications, waivers, users |
| Competency Matrix | training_records, training_requirements, skill_tests, users |
| Training Effectiveness | training_records, effectiveness_evaluations, users |
| Shift Coverage | shifts, shift_attendance, users |
| Inventory Summary | inventory_items, item_assignments, inventory_categories |
| Department Overview | All modules (aggregated KPIs) |

---

## 13. Public & Unauthenticated Endpoints

### Public Portal API (`/api/public/v1/`)

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /api/public/v1/organization/info` | API key (optional) | Org name, contact info (field-level whitelist) |
| `GET /api/public/v1/organization/stats` | API key | Org statistics |
| `GET /api/public/v1/events/public` | API key | Public events calendar |
| `GET /api/public/v1/application-status/{token}` | Token | Prospective member application status |
| `GET /api/public/v1/health` | None | Health check |

### Public Forms (`/api/public/v1/forms/`)

| Endpoint | Auth | Rate Limit |
|----------|------|------------|
| `GET /api/public/v1/forms/{form_id}` | None | 60/min/IP |
| `POST /api/public/v1/forms/{form_id}/submit` | None | 10/min/IP |

### Public Display (`/api/public/v1/display/`)

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /api/public/v1/display/{display_code}` | None | Kiosk QR code display for rooms |

### Token-Based Routes (No Session Auth)

| Endpoint | Token Type | Purpose |
|----------|-----------|---------|
| `GET/POST /training/sessions/approve/{token}` | Approval token | Training session approval |
| `GET /elections/ballot` | Ballot token (query param) | Get ballot |
| `GET /elections/ballot/{token}/candidates` | Ballot token | Get candidates |
| `POST /elections/ballot/{token}/vote` | Ballot token | Cast vote |
| `POST /elections/ballot/{token}/submit` | Ballot token | Submit ballot |
| `GET /event-requests/status/{token}` | Request token | Check request status |
| `POST /event-requests/status/{token}/cancel` | Request token | Cancel request |

### Health Checks

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | App health |
| `GET /health/db` | Database connectivity |
| `GET /health/redis` | Redis connectivity |

---

## 14. Navigation & Permission Gating

### Navigation Layout

The app supports two layouts chosen during onboarding:
- **Side navigation** (default): Collapsible sidebar at 256px
- **Top navigation**: Horizontal header navbar

Both layouts read from `localStorage.getItem('navigationLayout')`.

### Navigation Structure

**Member-Facing Items** (always visible to authenticated users):

| Label | Path | Module Gate |
|-------|------|-------------|
| Dashboard | `/dashboard` | — |
| Members | `/members` | — |
| Events | `/events` | — |
| Documents | `/documents` | — |
| Training → My Training | `/training/my-training` | `training` |
| Training → Submit Training | `/training/submit` | `training` |
| Training → Course Library | `/training/courses` | `training` |
| Training → Programs | `/training/programs` | `training` |
| Training → Skills Testing | `/training/skills-testing` | `training` |
| Admin Hours | `/admin-hours` | — |
| Shift Scheduling | `/scheduling` | `scheduling` |
| My Equipment | `/inventory/my-equipment` | `inventory` |
| Inventory | `/inventory` | `inventory` |
| Apparatus | `/apparatus` or `/apparatus-basic` | `apparatus` |
| Facilities | `/facilities` | `facilities` |
| Locations | `/locations` | shown when `facilities` OFF |
| Elections | `/elections` | `elections` |
| Minutes | `/minutes` | `minutes` |
| Action Items | `/action-items` | `minutes` |
| Notifications | `/notifications` | `notifications` |
| My Account | `/account` | — |
| My ID Card | `/members/:userId/id-card` | — |

**Administration Section** (shown if user has any admin permission):

| Label | Path | Permission | Module Gate |
|-------|------|------------|-------------|
| Department Setup | `/setup` | `settings.manage` | — |
| Prospective Members | `/prospective-members` | `prospective_members.manage` | `prospective_members` |
| Member Management | `/members/admin` | `members.manage` | — |
| Events Admin | `/events/admin` | `events.manage` | — |
| Training Admin | `/training/admin` | `training.manage` | `training` |
| Inventory Admin | `/inventory/admin` | `inventory.manage` | `inventory` |
| Admin Hours Manage | `/admin-hours/manage` | `admin_hours.manage` | — |
| Email Templates | `/communications/email-templates` | `settings.manage` | — |
| Forms | `/forms` | `forms.view` | `forms` |
| Integrations | `/integrations` | `settings.manage` | `integrations` |
| Reports | `/reports` | — | `reports` |
| Organization Settings | `/settings` | `settings.manage` | — |
| Role Management | `/settings/roles` | `positions.manage_permissions` | — |
| Public Portal | `/admin/public-portal` | `settings.manage` | `public_info` |
| Platform Analytics | `/admin/platform-analytics` | `settings.manage` | — |
| QR Code Analytics | `/admin/analytics` | `analytics.view` | — |
| Error Monitor | `/admin/errors` | `settings.manage` | — |

### Permission Strings

All permissions follow dot notation: `resource.action`

| Permission | Description |
|------------|-------------|
| `settings.manage` | Organization settings, module config |
| `members.manage` | Member admin, edit profiles |
| `members.create` | Add new members |
| `users.view` / `users.edit` / `users.delete` / `users.admin` | User CRUD |
| `events.view` / `events.create` / `events.edit` / `events.delete` / `events.manage` / `events.checkin` | Event management |
| `training.view` / `training.manage` / `training.evaluate` | Training operations |
| `scheduling.view` / `scheduling.manage` | Shift scheduling |
| `inventory.view` / `inventory.manage` / `inventory.checkout` | Inventory operations |
| `apparatus.view` / `apparatus.create` / `apparatus.edit` / `apparatus.manage` / `apparatus.maintenance` | Apparatus management |
| `facilities.view` / `facilities.create` / `facilities.edit` / `facilities.manage` | Facility management |
| `elections.view` / `elections.manage` | Election operations |
| `minutes.view` / `minutes.manage` / `minutes.approve` | Minutes management |
| `meetings.view` / `meetings.manage` | Meeting management |
| `documents.view` / `documents.upload` / `documents.manage` | Document management |
| `forms.view` / `forms.manage` | Form management |
| `reports.view` / `reports.manage` | Report generation |
| `analytics.view` | Analytics dashboards |
| `positions.view` / `positions.create` / `positions.edit` / `positions.delete` / `positions.manage_permissions` | Role/position management |
| `prospective_members.manage` | Pipeline management |
| `admin_hours.view` / `admin_hours.manage` | Admin hours tracking |
| `security.view` / `security.manage` | Security monitoring |
| `messages.send` / `messages.manage` | Department messaging |
| `grants.view` / `grants.manage` | Grant management |
| `fundraising.view` / `fundraising.manage` | Fundraising operations |
| `*` | Wildcard — all permissions |
| `module.*` | Module-level wildcard |

---

## 15. Core Infrastructure

### Backend Core (`backend/app/core/`)

| File | Purpose |
|------|---------|
| `config.py` | Pydantic Settings class, env var parsing, module flags |
| `database.py` | SQLAlchemy async engine + session factory |
| `security.py` | JWT creation/verification, password hashing (Argon2), TOTP |
| `security_middleware.py` | CSRF verification, rate limiting middleware |
| `permissions.py` | `require_permission()`, `require_all_permissions()` dependency factories |
| `audit.py` | `log_audit_event()` — tamper-proof SHA-256 hash chain |
| `cache.py` | Redis-backed caching utilities |
| `constants.py` | Application constants |
| `encrypted_types.py` | SQLAlchemy encrypted column types (AES-256) |
| `geoip.py` | GeoIP lookup for IP security |
| `logging.py` | Loguru configuration |
| `seed.py` | Database seeding (roles, permissions, demo data) |
| `seed_training.py` | Training module seeding |
| `utils.py` | `safe_error_detail()`, `generate_uuid()`, misc utilities |
| `websocket_manager.py` | WebSocket connection management |
| `public_portal_security.py` | API key validation for public portal |

### Frontend Utilities

| File | Purpose |
|------|---------|
| `utils/apiCache.ts` | In-memory SWR cache for axios |
| `utils/errorHandling.ts` | `toAppError()`, `getErrorMessage()` |
| `utils/dateFormatting.ts` | Timezone-aware date/time formatting |
| `utils/lazyWithRetry.ts` | Retry-capable `React.lazy()` for chunk loading |
| `utils/simpleMarkdown.ts` | React-based safe markdown renderer (bold, italic, links, lists) — replaces dangerouslySetInnerHTML |
| `utils/colorContrast.ts` | WCAG AA contrast ratio calculation, accessible text color generation |
| `hooks/useEmailListInput.ts` | Shared email list input hook with validation, add/remove, and state management |
| `hooks/useHtml5Scanner.ts` | Reusable HTML5 QR/barcode scanner hook with camera fallback logic |
| `hooks/useNotificationPoller.ts` | Smart notification polling with Page Visibility API pause/resume |
| `constants/config.ts` | `API_TIMEOUT_MS`, `DEFAULT_PAGE_SIZE`, etc. |
| `constants/enums.ts` | All `as const` enum objects + status badge colors |
| `contexts/ThemeContext.tsx` | Dark mode / high-contrast theme management |
| `components/ErrorBoundary.tsx` | Global React error boundary |
| `components/ProtectedRoute.tsx` | Auth + permission + password expiry gating |

---

## 16. WebSocket & Real-Time

### Inventory WebSocket

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `WS /api/v1/inventory/ws` | Cookie or `?token=` query param | Real-time inventory change notifications |

The `WebSocketManager` (`core/websocket_manager.py`) manages connections per organization. When inventory mutations occur (checkout, return, assignment), connected clients receive push updates.

---

## 17. Scheduled Tasks & Background Jobs

### Scheduled Tasks (via `backend/app/services/scheduled_tasks.py`)

| Task | Schedule | Description |
|------|----------|-------------|
| `check_expiring_certifications` | Daily | Scans for certifications expiring within 30/60/90 days, generates notifications |
| `process_recertification_reminders` | Daily | Sends tiered recertification reminders based on configured lead times (Celery beat) |
| `send_xapi_statements` | Async (Celery) | Delivers xAPI statements to configured LRS endpoints for multi-agency training records |
| `process_property_return_reminders` | Daily | Sends reminders for overdue property returns |
| `close_stale_sessions` | Hourly | Auto-closes admin hours sessions that have been open too long |
| `advance_membership_tiers` | Weekly | Checks and advances member tier progression |
| `purge_inactive_prospects` | Weekly | Archives inactive prospective members past timeout |
| `send_shift_reminders` | Every 30 min | Sends start-of-shift reminders within configurable lookahead window (default 2 hours). Includes equipment checklist info |
| `cleanup_old_notifications` | Daily | Purges read notifications older than configurable retention period |

### Admin API for Tasks

| Endpoint | Method | Permission |
|----------|--------|------------|
| `/api/v1/scheduled/tasks` | GET | `settings.manage` |
| `/api/v1/scheduled/run-task` | POST | `settings.manage` |

---

## Appendix: Legacy Redirects

| Old URL | Redirects To |
|---------|-------------|
| `/onboarding/department` | `/onboarding/start` |
| `/onboarding/roles` | `/onboarding/positions` |
| `/onboarding/admin-user` | `/onboarding/system-owner` |
| `/onboarding/module-selection` | `/onboarding/modules` |
| `/admin/members` | `/members/admin` |
| `/members/add` | `/members/admin?tab=add` |
| `/members/import` | `/members/admin?tab=import` |
| `/events/new` | `/events/admin?tab=create` |
| `/training/officer` | `/training/admin?page=dashboard&tab=overview` |
| `/training/submissions` | `/training/admin?page=records&tab=submissions` |
| `/training/requirements` | `/training/admin?page=setup&tab=requirements` |
| `/training/sessions/new` | `/training/admin?page=records&tab=sessions` |
| `/training/programs/new` | `/training/admin?page=setup&tab=pipelines` |
| `/training/shift-reports` | `/training/admin?page=records&tab=shift-reports` |
| `/training/integrations` | `/training/admin?page=setup&tab=integrations` |
| `/settings/account` | `/account` |
| `*` (catch-all) | `/` |
