# Database Schema Reference

Complete reference for every table, column, key and index defined by the SQLAlchemy models. **Generated — do not edit by hand.**

```bash
cd backend && python scripts/generate_schema_docs.py
```

**238 tables · 4110 columns · 773 foreign keys**

---

## How the schema is materialized

A **fresh install** does not replay the migration chain. `main.py`'s `_fast_path_init()` calls `Base.metadata.create_all()` and then stamps Alembic at head, so **the models in `app/models/` are the schema** a new deployment receives. Alembic migrations exist to patch databases that already exist.

Two consequences worth internalising before changing anything:

1. **A model change alone changes the schema of every new install.** Widening or narrowing a column type in a model is a schema change even with no migration attached.
2. **A migration alone changes nothing for new installs.** Any migration must be paired with the equivalent model change, or fresh and upgraded databases diverge.

Some tables are *model-only*: they are created by `create_all()` and no migration ever creates them. A migration that alters one must guard with `sa.inspect(op.get_bind()).has_table(...)`, because on a fresh chain the table does not yet exist. See `20260802_0001_add_dues_payments_ledger.py` for the established pattern.

---

## Conventions

| Aspect | Convention |
|---|---|
| Primary key | `id VARCHAR(36)`, application-generated UUID (`default=generate_uuid`). No auto-increment integers. |
| Tenant scope | `organization_id VARCHAR(36)` → `organizations.id`, almost always `ON DELETE CASCADE`. Every by-id query must filter it (see CLAUDE.md pitfall #14). |
| Timestamps | `DateTime(timezone=True)`, stored **UTC**. `created_at` defaults to `now()`; `updated_at` uses `onupdate=now()`. Conversion to local time happens in the frontend only. |
| Actor columns | `created_by` / `updated_by` / `*_by` → `users.id`, nullable, usually `ON DELETE SET NULL` so records outlive the member. |
| Enums | Python `(str, Enum)` with **lowercase** values. Stored as MySQL `ENUM` or `VARCHAR` depending on the column. |
| `SET NULL` FKs | Must be `nullable=True` — MySQL error 1830 rejects `SET NULL` on a `NOT NULL` column. |
| Naming | `plural_snake_case` tables, `snake_case` columns. |

**Key flags used in the column tables below:**

`PK` primary key · `FK` foreign key · `UQ` unique constraint · `IDX` indexed · `UQ-IDX` unique index

---

## Table index

### Administrative Hours

<sub>`app/models/admin_hours.py`</sub>

| Table | Model | Columns | Purpose |
|---|---|---|---|
| [`admin_hours_categories`](#admin_hours_categories) | `AdminHoursCategory` | 14 | Defines the types of administrative work members can log hours for. |
| [`admin_hours_entries`](#admin_hours_entries) | `AdminHoursEntry` | 17 | Records a single session of administrative work by a member. |
| [`event_hour_mappings`](#event_hour_mappings) | `EventHourMapping` | 10 | Maps event types/custom categories to admin hours categories. |

### Analytics

<sub>`app/models/analytics.py`</sub>

| Table | Model | Columns | Purpose |
|---|---|---|---|
| [`analytics_events`](#analytics_events) | `AnalyticsEvent` | 8 | Stores analytics events (QR scans, check-ins, etc.) |
| [`saved_reports`](#saved_reports) | `SavedReport` | 16 | Saved report configuration |

### Apparatus

<sub>`app/models/apparatus.py`</sub>

| Table | Model | Columns | Purpose |
|---|---|---|---|
| [`apparatus`](#apparatus) | `Apparatus` | 79 | Main Apparatus model for tracking department vehicles |
| [`apparatus_component_notes`](#apparatus_component_notes) | `ApparatusComponentNote` | 21 | Notes, observations, issues, and repair records tied to a specific |
| [`apparatus_components`](#apparatus_components) | `ApparatusComponent` | 23 | Segments an apparatus into logical components (engine, pump, aerial, etc.) |
| [`apparatus_custom_fields`](#apparatus_custom_fields) | `ApparatusCustomField` | 23 | Custom field definitions for apparatus |
| [`apparatus_documents`](#apparatus_documents) | `ApparatusDocument` | 14 | Documents associated with apparatus |
| [`apparatus_equipment`](#apparatus_equipment) | `ApparatusEquipment` | 17 | Equipment assigned to apparatus |
| [`apparatus_fuel_logs`](#apparatus_fuel_logs) | `ApparatusFuelLog` | 16 | Fuel purchase and usage log for apparatus |
| [`apparatus_location_history`](#apparatus_location_history) | `ApparatusLocationHistory` | 9 | History of station/location assignments for apparatus |
| [`apparatus_maintenance`](#apparatus_maintenance) | `ApparatusMaintenance` | 32 | Maintenance records for apparatus |
| [`apparatus_maintenance_types`](#apparatus_maintenance_types) | `ApparatusMaintenanceType` | 18 | Maintenance type definitions |
| [`apparatus_nfpa_compliance`](#apparatus_nfpa_compliance) | `ApparatusNFPACompliance` | 15 | NFPA compliance tracking for apparatus |
| [`apparatus_operators`](#apparatus_operators) | `ApparatusOperator` | 20 | Tracks which personnel are certified/qualified to operate apparatus |
| [`apparatus_photos`](#apparatus_photos) | `ApparatusPhoto` | 14 | Photos associated with apparatus |
| [`apparatus_report_configs`](#apparatus_report_configs) | `ApparatusReportConfig` | 26 | Configuration for scheduled and custom apparatus reports |
| [`apparatus_service_providers`](#apparatus_service_providers) | `ApparatusServiceProvider` | 28 | Service providers (companies or individuals) who perform maintenance, |
| [`apparatus_status_history`](#apparatus_status_history) | `ApparatusStatusHistory` | 9 | History of status changes for apparatus |
| [`apparatus_statuses`](#apparatus_statuses) | `ApparatusStatus` | 17 | Apparatus Status model for tracking vehicle availability |
| [`apparatus_types`](#apparatus_types) | `ApparatusType` | 14 | Apparatus Type model for categorizing vehicles |
| [`check_template_compartments`](#check_template_compartments) | `CheckTemplateCompartment` | 11 | A named section/area within a checklist template. |
| [`check_template_items`](#check_template_items) | `CheckTemplateItem` | 22 | An individual item to check within a compartment. |
| [`equipment_check_templates`](#equipment_check_templates) | `EquipmentCheckTemplate` | 14 | Master template for an equipment checklist. |
| [`evoc_levels`](#evoc_levels) | `EvocLevel` | 13 | Organization-configurable EVOC (Emergency Vehicle Operator Course) levels. |
| [`template_change_logs`](#template_change_logs) | `TemplateChangeLog` | 11 | Granular audit trail for equipment check template edits. |

### Audit & Compliance Logging

<sub>`app/models/audit.py`</sub>

| Table | Model | Columns | Purpose |
|---|---|---|---|
| [`audit_log_checkpoints`](#audit_log_checkpoints) | `AuditLogCheckpoint` | 13 | Periodic integrity checkpoints for audit logs |
| [`audit_logs`](#audit_logs) | `AuditLog` | 18 | Tamper-proof audit log entries |
| [`audit_ship_state`](#audit_ship_state) | `AuditShipState` | 5 | High-water mark for off-host audit-log shipping. |

### Compliance Configuration

<sub>`app/models/compliance_config.py`</sub>

| Table | Model | Columns | Purpose |
|---|---|---|---|
| [`compliance_configs`](#compliance_configs) | `ComplianceConfig` | 15 | Organization-level compliance configuration. |
| [`compliance_profiles`](#compliance_profiles) | `ComplianceProfile` | 15 | Role/membership-type specific compliance profile. |
| [`compliance_reports`](#compliance_reports) | `ComplianceReport` | 15 | Stored compliance reports (auto-generated or manual). |

### Consent

<sub>`app/models/consent.py`</sub>

| Table | Model | Columns | Purpose |
|---|---|---|---|
| [`user_consents`](#user_consents) | `UserConsent` | 7 |  |

### Documents

<sub>`app/models/document.py`</sub>

| Table | Model | Columns | Purpose |
|---|---|---|---|
| [`document_folders`](#document_folders) | `DocumentFolder` | 16 | Document Folder model |
| [`documents`](#documents) | `Document` | 19 | Document model |

### Elections

<sub>`app/models/election.py`</sub>

| Table | Model | Columns | Purpose |
|---|---|---|---|
| [`candidates`](#candidates) | `Candidate` | 15 | Candidate model for election candidates |
| [`elections`](#elections) | `Election` | 49 | Election model for managing elections within an organization |
| [`manual_ballot_attestations`](#manual_ballot_attestations) | `ManualBallotAttestation` | 5 | One officer's confirmation that a paper-tally batch matches the |
| [`manual_ballot_batches`](#manual_ballot_batches) | `ManualBallotBatch` | 9 | One paper-tally entry — the set of manual votes sharing a batch id. |
| [`votes`](#votes) | `Vote` | 25 | Vote model for recording votes |
| [`voting_tokens`](#voting_tokens) | `VotingToken` | 15 | Voting token model for secure anonymous ballot access |

### Email Templates

<sub>`app/models/email_template.py`</sub>

| Table | Model | Columns | Purpose |
|---|---|---|---|
| [`email_attachments`](#email_attachments) | `EmailAttachment` | 8 | Stored attachment that can be included with email templates. |
| [`email_templates`](#email_templates) | `EmailTemplate` | 18 | Configurable email template stored in the database. |
| [`message_history`](#message_history) | `MessageHistory` | 12 | Log of every email sent by the application. |
| [`scheduled_emails`](#scheduled_emails) | `ScheduledEmail` | 15 | An email scheduled to be sent at a future date/time. |

### Error Logging

<sub>`app/models/error_log.py`</sub>

| Table | Model | Columns | Purpose |
|---|---|---|---|
| [`error_logs`](#error_logs) | `ErrorLog` | 10 | Stores application error logs for monitoring |

### Event Requests

<sub>`app/models/event_request.py`</sub>

| Table | Model | Columns | Purpose |
|---|---|---|---|
| [`event_request_activity`](#event_request_activity) | `EventRequestActivity` | 9 | Audit trail for event request pipeline actions. |
| [`event_request_email_templates`](#event_request_email_templates) | `EventRequestEmailTemplate` | 12 | Reusable email templates for the event request pipeline. |
| [`event_requests`](#event_requests) | `EventRequest` | 32 | Public outreach event request. |

### Events

<sub>`app/models/event.py`</sub>

| Table | Model | Columns | Purpose |
|---|---|---|---|
| [`event_external_attendees`](#event_external_attendees) | `EventExternalAttendee` | 17 | External (non-member) attendee at an event. |
| [`event_rsvps`](#event_rsvps) | `EventRSVP` | 20 | Event RSVP model for tracking attendance |
| [`event_templates`](#event_templates) | `EventTemplate` | 27 | Event Template model for reusable event configurations |
| [`events`](#events) | `Event` | 48 | Event model for managing department events |
| [`rsvp_history`](#rsvp_history) | `RSVPHistory` | 8 | RSVP History model for tracking RSVP status changes. |

### Facilities

<sub>`app/models/facilities.py`</sub>

| Table | Model | Columns | Purpose |
|---|---|---|---|
| [`facilities`](#facilities) | `Facility` | 38 | Main facility model for tracking buildings, stations, and properties. |
| [`facility_access_keys`](#facility_access_keys) | `FacilityAccessKey` | 15 | Keys, fobs, codes, and access credentials for a facility |
| [`facility_capital_projects`](#facility_capital_projects) | `FacilityCapitalProject` | 23 | Capital improvement and renovation projects for a facility |
| [`facility_compliance_checklists`](#facility_compliance_checklists) | `FacilityComplianceChecklist` | 14 | Regulatory/compliance checklists for a facility |
| [`facility_compliance_items`](#facility_compliance_items) | `FacilityComplianceItem` | 13 | Individual items within a compliance checklist |
| [`facility_documents`](#facility_documents) | `FacilityDocument` | 12 | Documents associated with a facility (blueprints, permits, leases, etc.) |
| [`facility_emergency_contacts`](#facility_emergency_contacts) | `FacilityEmergencyContact` | 15 | Emergency/vendor contacts for a facility (alarm company, plumber, etc.) |
| [`facility_inspections`](#facility_inspections) | `FacilityInspection` | 24 | Inspection records for facilities — fire inspections, building code, |
| [`facility_insurance_policies`](#facility_insurance_policies) | `FacilityInsurancePolicy` | 20 | Insurance policies covering a facility |
| [`facility_maintenance`](#facility_maintenance) | `FacilityMaintenance` | 28 | Maintenance records for facilities. |
| [`facility_maintenance_types`](#facility_maintenance_types) | `FacilityMaintenanceType` | 11 | Types of maintenance work that can be performed on facilities. |
| [`facility_occupants`](#facility_occupants) | `FacilityOccupant` | 14 | Units, crews, or teams assigned to a facility |
| [`facility_photos`](#facility_photos) | `FacilityPhoto` | 10 | Photos associated with a facility |
| [`facility_rooms`](#facility_rooms) | `FacilityRoom` | 18 | Individual rooms and spaces within a facility |
| [`facility_shutoff_locations`](#facility_shutoff_locations) | `FacilityShutoffLocation` | 11 | Utility shutoff locations within a facility (water main, gas main, etc.) |
| [`facility_statuses`](#facility_statuses) | `FacilityStatus` | 10 | Facility statuses (e.g. Operational, Under Renovation). |
| [`facility_systems`](#facility_systems) | `FacilitySystem` | 29 | Segments a facility into logical building systems (HVAC, electrical, |
| [`facility_types`](#facility_types) | `FacilityType` | 9 | Facility types (e.g. Fire Station, Meeting Hall, Training Center). |
| [`facility_utility_accounts`](#facility_utility_accounts) | `FacilityUtilityAccount` | 16 | Utility accounts (electric, gas, water, etc.) for a facility |
| [`facility_utility_readings`](#facility_utility_readings) | `FacilityUtilityReading` | 12 | Monthly/periodic utility cost and usage readings |

### Finance

<sub>`app/models/finance.py`</sub>

| Table | Model | Columns | Purpose |
|---|---|---|---|
| [`approval_chain_steps`](#approval_chain_steps) | `ApprovalChainStep` | 13 | A single step in an approval chain |
| [`approval_chains`](#approval_chains) | `ApprovalChain` | 13 | Configurable approval chain template |
| [`approval_step_records`](#approval_step_records) | `ApprovalStepRecord` | 13 | Tracks actual approval step progression for a specific entity |
| [`budget_categories`](#budget_categories) | `BudgetCategory` | 10 | Budget category (hierarchical) |
| [`budgets`](#budgets) | `Budget` | 12 | Budget line for a category within a fiscal year |
| [`check_requests`](#check_requests) | `CheckRequest` | 20 | Request to cut a check for payment |
| [`dues_payments`](#dues_payments) | `DuesPayment` | 11 | A single payment received against a member's dues (FIN-6). |
| [`dues_schedules`](#dues_schedules) | `DuesSchedule` | 15 | Schedule for dues collection |
| [`expense_line_items`](#expense_line_items) | `ExpenseLineItem` | 10 | Individual line item within an expense report |
| [`expense_reports`](#expense_reports) | `ExpenseReport` | 17 | Expense report submitted by a member for reimbursement |
| [`finance_export_logs`](#finance_export_logs) | `ExportLog` | 9 | Log of QuickBooks export operations |
| [`finance_export_mappings`](#finance_export_mappings) | `ExportMapping` | 8 | Mapping between internal budget categories and QuickBooks accounts |
| [`fiscal_years`](#fiscal_years) | `FiscalYear` | 10 | Fiscal year definition for the organization |
| [`member_dues`](#member_dues) | `MemberDues` | 18 | Individual member dues payment record |
| [`purchase_requests`](#purchase_requests) | `PurchaseRequest` | 25 | Purchase request submitted by a member |

### Forms

<sub>`app/models/forms.py`</sub>

| Table | Model | Columns | Purpose |
|---|---|---|---|
| [`form_fields`](#form_fields) | `FormField` | 21 | Form Field model |
| [`form_integrations`](#form_integrations) | `FormIntegration` | 9 | Form Integration model |
| [`form_submissions`](#form_submissions) | `FormSubmission` | 15 | Form Submission model |
| [`forms`](#forms) | `Form` | 19 | Form model |

### Grants & Fundraising

<sub>`app/models/grant.py`</sub>

| Table | Model | Columns | Purpose |
|---|---|---|---|
| [`donations`](#donations) | `Donation` | 26 | Donation model mapping to the existing donations table. |
| [`donors`](#donors) | `Donor` | 26 | Donor model mapping to the existing donors table. |
| [`fundraising_campaigns`](#fundraising_campaigns) | `FundraisingCampaign` | 22 | Fundraising campaign model mapping to the existing fundraising_campaigns table. |
| [`fundraising_events`](#fundraising_events) | `FundraisingEvent` | 22 | Fundraising event model mapping to the existing fundraising_events table. |
| [`grant_applications`](#grant_applications) | `GrantApplication` | 32 | Individual grant application tracked through the pipeline. |
| [`grant_budget_items`](#grant_budget_items) | `GrantBudgetItem` | 13 | Budget line item for a grant application. |
| [`grant_compliance_tasks`](#grant_compliance_tasks) | `GrantComplianceTask` | 19 | Follow-up task, report, or compliance obligation for a grant. |
| [`grant_expenditures`](#grant_expenditures) | `GrantExpenditure` | 16 | Individual spending record against a grant budget. |
| [`grant_notes`](#grant_notes) | `GrantNote` | 7 | Activity log / note for a grant application. |
| [`grant_opportunities`](#grant_opportunities) | `GrantOpportunity` | 26 | Library of available grant programs. |
| [`pledges`](#pledges) | `Pledge` | 16 | Pledge model mapping to the existing pledges table. |

### IP Security

<sub>`app/models/ip_security.py`</sub>

| Table | Model | Columns | Purpose |
|---|---|---|---|
| [`blocked_access_attempts`](#blocked_access_attempts) | `BlockedAccessAttempt` | 11 | Blocked Access Attempt model for logging denied requests. |
| [`country_block_rules`](#country_block_rules) | `CountryBlockRule` | 12 | Country Block Rule model for managing blocked countries. |
| [`ip_exception_audit_log`](#ip_exception_audit_log) | `IPExceptionAuditLog` | 7 | Audit log for all IP exception actions. |
| [`ip_exceptions`](#ip_exceptions) | `IPException` | 30 | IP Exception model for user-specific allowlist/blocklist entries. |

### Integrations

<sub>`app/models/integration.py`</sub>

| Table | Model | Columns | Purpose |
|---|---|---|---|
| [`integrations`](#integrations) | `Integration` | 14 | Stores integration configurations per organization |

### Inventory

<sub>`app/models/inventory.py`</sub>

| Table | Model | Columns | Purpose |
|---|---|---|---|
| [`checkout_records`](#checkout_records) | `CheckOutRecord` | 17 | Check Out Record model |
| [`departure_clearance_items`](#departure_clearance_items) | `DepartureClearanceItem` | 18 | Departure Clearance Line Item |
| [`departure_clearances`](#departure_clearances) | `DepartureClearance` | 18 | Departure Clearance model |
| [`equipment_kit_items`](#equipment_kit_items) | `EquipmentKitItem` | 8 | One line item in a kit template — specifies what item/category |
| [`equipment_kits`](#equipment_kits) | `EquipmentKit` | 10 | Kit/bundle template for issuing multiple items as a set. |
| [`equipment_requests`](#equipment_requests) | `EquipmentRequest` | 20 | Equipment Request model |
| [`inventory_categories`](#inventory_categories) | `InventoryCategory` | 16 | Inventory Category model |
| [`inventory_impact_plans`](#inventory_impact_plans) | `InventoryImpactPlan` | 8 | A saved, named impact-planner scenario. |
| [`inventory_items`](#inventory_items) | `InventoryItem` | 50 | Inventory Item model |
| [`inventory_lots`](#inventory_lots) | `InventoryLot` | 11 | A batch/lot of a consumable inventory item held as ready stock. |
| [`inventory_notification_queue`](#inventory_notification_queue) | `InventoryNotificationQueue` | 15 | Queues inventory change events for delayed, consolidated email |
| [`inventory_write_offs`](#inventory_write_offs) | `WriteOffRequest` | 18 | Write-Off Request model |
| [`issuance_allowances`](#issuance_allowances) | `IssuanceAllowance` | 10 | Issuance Allowance model |
| [`item_assignments`](#item_assignments) | `ItemAssignment` | 16 | Item Assignment model |
| [`item_issuances`](#item_issuances) | `ItemIssuance` | 18 | Item Issuance model |
| [`item_variant_groups`](#item_variant_groups) | `ItemVariantGroup` | 12 | Groups pool items that are size/color/style variants of the same |
| [`maintenance_records`](#maintenance_records) | `MaintenanceRecord` | 24 | Maintenance Record model |
| [`member_size_preferences`](#member_size_preferences) | `MemberSizePreferences` | 15 | Stores a member's preferred sizes for different garment types. |
| [`nfpa_exposure_records`](#nfpa_exposure_records) | `NFPAExposureRecord` | 15 | Tracks hazardous exposure events for NFPA-tracked PPE items. |
| [`nfpa_inspection_details`](#nfpa_inspection_details) | `NFPAInspectionDetail` | 18 | NFPA-specific inspection fields extending a MaintenanceRecord. |
| [`nfpa_item_compliance`](#nfpa_item_compliance) | `NFPAItemCompliance` | 20 | NFPA 1851/1852 compliance record for PPE and SCBA items. |
| [`property_return_reminders`](#property_return_reminders) | `PropertyReturnReminder` | 10 | Tracks which property-return reminder notices have been sent to |
| [`reorder_requests`](#reorder_requests) | `ReorderRequest` | 23 | Tracks reorder requests for inventory items that have dropped below |
| [`return_requests`](#return_requests) | `ReturnRequest` | 18 | Member-initiated return request. |
| [`storage_areas`](#storage_areas) | `StorageArea` | 14 | Storage Area model |

### Locations

<sub>`app/models/location.py`</sub>

| Table | Model | Columns | Purpose |
|---|---|---|---|
| [`locations`](#locations) | `Location` | 21 | Location model for managing physical spaces |

### Medical Screening

<sub>`app/models/medical_screening.py`</sub>

| Table | Model | Columns | Purpose |
|---|---|---|---|
| [`screening_records`](#screening_records) | `ScreeningRecord` | 18 | Individual screening instance for a user or prospective member. |
| [`screening_requirements`](#screening_requirements) | `ScreeningRequirement` | 11 | Organization-level definition of a required screening. |

### Meeting Minutes

<sub>`app/models/minute.py`</sub>

| Table | Model | Columns | Purpose |
|---|---|---|---|
| [`meeting_minutes`](#meeting_minutes) | `MeetingMinutes` | 40 | Meeting Minutes model |
| [`meeting_motions`](#meeting_motions) | `Motion` | 13 | Motion model |
| [`minutes_action_items`](#minutes_action_items) | `ActionItem` | 12 | Action Item model |
| [`minutes_templates`](#minutes_templates) | `MinutesTemplate` | 12 | Meeting Minutes Template |

### Meetings

<sub>`app/models/meeting.py`</sub>

| Table | Model | Columns | Purpose |
|---|---|---|---|
| [`meeting_action_items`](#meeting_action_items) | `MeetingActionItem` | 12 | Meeting Action Item model |
| [`meeting_attendees`](#meeting_attendees) | `MeetingAttendee` | 10 | Meeting Attendee model |
| [`meetings`](#meetings) | `Meeting` | 20 | Meeting model |

### Membership Pipeline

<sub>`app/models/membership_pipeline.py`</sub>

| Table | Model | Columns | Purpose |
|---|---|---|---|
| [`membership_pipeline_steps`](#membership_pipeline_steps) | `MembershipPipelineStep` | 17 | A single step within a membership pipeline. |
| [`membership_pipelines`](#membership_pipelines) | `MembershipPipeline` | 14 | Pipeline definition for prospective member onboarding. |
| [`prospect_activity_log`](#prospect_activity_log) | `ProspectActivityLog` | 6 | Audit trail for prospect-related actions. |
| [`prospect_documents`](#prospect_documents) | `ProspectDocument` | 10 | Document uploaded for a prospective member. |
| [`prospect_election_packages`](#prospect_election_packages) | `ProspectElectionPackage` | 11 | Election package for a prospective member. |
| [`prospect_event_links`](#prospect_event_links) | `ProspectEventLink` | 6 | Links a prospective member to an upcoming event. |
| [`prospect_interviews`](#prospect_interviews) | `ProspectInterview` | 12 | Interview record for a prospective member. |
| [`prospect_step_progress`](#prospect_step_progress) | `ProspectStepProgress` | 10 | Tracks a prospect's progress on each pipeline step. |
| [`prospective_members`](#prospective_members) | `ProspectiveMember` | 28 | Prospective member record, kept separate from the users table. |

### Notifications

<sub>`app/models/notification.py`</sub>

| Table | Model | Columns | Purpose |
|---|---|---|---|
| [`department_message_reads`](#department_message_reads) | `DepartmentMessageRead` | 5 | Tracks which users have read/acknowledged a department message. |
| [`department_messages`](#department_messages) | `DepartmentMessage` | 19 | Department Message model |
| [`notification_logs`](#notification_logs) | `NotificationLog` | 19 | Notification Log model |
| [`notification_rules`](#notification_rules) | `NotificationRule` | 12 | Notification Rule model |
| [`push_subscriptions`](#push_subscriptions) | `PushSubscription` | 10 | A single browser/device Web Push endpoint belonging to a user. |

### Onboarding

<sub>`app/models/onboarding.py`</sub>

| Table | Model | Columns | Purpose |
|---|---|---|---|
| [`onboarding_sessions`](#onboarding_sessions) | `OnboardingSessionModel` | 8 | Server-side onboarding session storage |
| [`onboarding_status`](#onboarding_status) | `OnboardingStatus` | 20 | System-wide onboarding status |

### Operational Ranks

<sub>`app/models/operational_rank.py`</sub>

| Table | Model | Columns | Purpose |
|---|---|---|---|
| [`operational_ranks`](#operational_ranks) | `OperationalRank` | 10 | Configurable operational rank for a department. |

### Organization_Officer

<sub>`app/models/organization_officer.py`</sub>

| Table | Model | Columns | Purpose |
|---|---|---|---|
| [`organization_officers`](#organization_officers) | `OrganizationOfficer` | 11 | One department office and the member who currently holds it. |

### Public Portal

<sub>`app/models/public_portal.py`</sub>

| Table | Model | Columns | Purpose |
|---|---|---|---|
| [`public_portal_access_log`](#public_portal_access_log) | `PublicPortalAccessLog` | 14 | Audit log of all public portal API access. |
| [`public_portal_api_keys`](#public_portal_api_keys) | `PublicPortalAPIKey` | 12 | API keys for accessing the public portal. |
| [`public_portal_config`](#public_portal_config) | `PublicPortalConfig` | 9 | Configuration for the public portal module. |
| [`public_portal_data_whitelist`](#public_portal_data_whitelist) | `PublicPortalDataWhitelist` | 8 | Whitelist of data fields that can be exposed via the public portal. |

### Security Alerts

<sub>`app/models/security_alert.py`</sub>

| Table | Model | Columns | Purpose |
|---|---|---|---|
| [`security_alerts`](#security_alerts) | `SecurityAlertRecord` | 16 | Persistent security alert records |

### Skills Testing

<sub>`app/models/skills_testing.py`</sub>

| Table | Model | Columns | Purpose |
|---|---|---|---|
| [`skill_templates`](#skill_templates) | `SkillTemplate` | 20 | Skill Template model |
| [`skill_test_viewers`](#skill_test_viewers) | `SkillTestViewer` | 5 | A person granted sight of one specific test's result. |
| [`skill_tests`](#skill_tests) | `SkillTest` | 29 | Skill Test model |

### Storefront

<sub>`app/models/storefront.py`</sub>

| Table | Model | Columns | Purpose |
|---|---|---|---|
| [`store_order_events`](#store_order_events) | `StoreOrderEvent` | 11 | Timeline entry on an order — the member-visible "order updates" feed |
| [`store_order_items`](#store_order_items) | `StoreOrderItem` | 14 | A line item on an order. |
| [`store_order_windows`](#store_order_windows) | `StoreOrderWindow` | 28 | A time-boxed ordering period ("order window") |
| [`store_orders`](#store_orders) | `StoreOrder` | 33 | A member order placed against an order window |
| [`store_payment_events`](#store_payment_events) | `StorePaymentEvent` | 19 | A payment a provider says it received, and what we did about it. |
| [`store_product_images`](#store_product_images) | `StoreProductImage` | 9 | Uploaded product photo, stored out of line from the catalog row. |
| [`store_product_variants`](#store_product_variants) | `StoreProductVariant` | 11 | A size/color option on a product (e.g. "L / Navy") |
| [`store_products`](#store_products) | `StoreProduct` | 26 | A sellable item in the department catalog |
| [`store_settings`](#store_settings) | `StoreSettings` | 42 | Per-organization storefront configuration (one row per org). |
| [`store_window_products`](#store_window_products) | `StoreWindowProduct` | 9 | Which catalog products a window offers, with per-window overrides |

### Training

<sub>`app/models/training.py`</sub>

| Table | Model | Columns | Purpose |
|---|---|---|---|
| [`basic_apparatus`](#basic_apparatus) | `BasicApparatus` | 10 | Lightweight apparatus/vehicle definition for shift scheduling. |
| [`competency_matrices`](#competency_matrices) | `CompetencyMatrix` | 11 | Competency Matrix model |
| [`course_classes`](#course_classes) | `CourseClass` | 25 | Course Class model — one row of a multi-class course's syllabus. |
| [`course_cohort_classes`](#course_cohort_classes) | `CourseCohortClass` | 25 | Course Cohort Class model — a syllabus row materialized onto real dates. |
| [`course_cohort_members`](#course_cohort_members) | `CourseCohortMember` | 10 | Course Cohort Member model — the roster of one cohort. |
| [`course_cohorts`](#course_cohorts) | `CourseCohort` | 24 | Course Cohort model — one scheduled run of a multi-class course. |
| [`external_category_mappings`](#external_category_mappings) | `ExternalCategoryMapping` | 12 | External Category Mapping model |
| [`external_training_imports`](#external_training_imports) | `ExternalTrainingImport` | 25 | External Training Import model |
| [`external_training_providers`](#external_training_providers) | `ExternalTrainingProvider` | 24 | External Training Provider model |
| [`external_training_sync_logs`](#external_training_sync_logs) | `ExternalTrainingSyncLog` | 18 | External Training Sync Log model |
| [`external_user_mappings`](#external_user_mappings) | `ExternalUserMapping` | 13 | External User Mapping model |
| [`instructor_qualifications`](#instructor_qualifications) | `InstructorQualification` | 19 | Instructor Qualification model |
| [`member_competencies`](#member_competencies) | `MemberCompetency` | 16 | Member Competency model |
| [`multi_agency_trainings`](#multi_agency_trainings) | `MultiAgencyTraining` | 19 | Multi-Agency Training model |
| [`program_enrollments`](#program_enrollments) | `ProgramEnrollment` | 22 | Program Enrollment model |
| [`program_milestones`](#program_milestones) | `ProgramMilestone` | 10 | Program Milestone model |
| [`program_phases`](#program_phases) | `ProgramPhase` | 10 | Program Phase model |
| [`program_requirements`](#program_requirements) | `ProgramRequirement` | 12 | Program Requirement model |
| [`recertification_pathways`](#recertification_pathways) | `RecertificationPathway` | 21 | Recertification Pathway model |
| [`renewal_tasks`](#renewal_tasks) | `RenewalTask` | 18 | Renewal Task model |
| [`requirement_progress`](#requirement_progress) | `RequirementProgress` | 14 | Requirement Progress model |
| [`requirement_progress_credits`](#requirement_progress_credits) | `RequirementProgressCredit` | 7 | Idempotency ledger for automated requirement-progress credit. |
| [`self_report_configs`](#self_report_configs) | `SelfReportConfig` | 14 | Self-Report Configuration model |
| [`shift_assignments`](#shift_assignments) | `ShiftAssignment` | 14 | Assigns a specific member to a specific shift with a designated position. |
| [`shift_attendance`](#shift_attendance) | `ShiftAttendance` | 8 | Shift Attendance model (Framework) |
| [`shift_calls`](#shift_calls) | `ShiftCall` | 13 | Shift Call model (Framework) |
| [`shift_completion_reports`](#shift_completion_reports) | `ShiftCompletionReport` | 28 | Shift Completion Report model |
| [`shift_equipment_check_items`](#shift_equipment_check_items) | `ShiftEquipmentCheckItem` | 22 | Individual item result within a completed equipment check. |
| [`shift_equipment_checks`](#shift_equipment_checks) | `ShiftEquipmentCheck` | 17 | A completed equipment checklist submission for a shift. |
| [`shift_patterns`](#shift_patterns) | `ShiftPattern` | 17 | Recurring shift pattern for automatic schedule generation. |
| [`shift_swap_requests`](#shift_swap_requests) | `ShiftSwapRequest` | 13 | Request to swap shifts between two members. |
| [`shift_templates`](#shift_templates) | `ShiftTemplate` | 19 | Reusable shift template for quick shift creation. |
| [`shift_time_off`](#shift_time_off) | `ShiftTimeOff` | 12 | Member request for time off / unavailability. |
| [`shifts`](#shifts) | `Shift` | 28 | Shift model (Framework) |
| [`skill_checkoffs`](#skill_checkoffs) | `SkillCheckoff` | 14 | Skill Checkoff model |
| [`skill_evaluations`](#skill_evaluations) | `SkillEvaluation` | 13 | Skill Evaluation model |
| [`training_approvals`](#training_approvals) | `TrainingApproval` | 15 | Training Approval model |
| [`training_categories`](#training_categories) | `TrainingCategory` | 14 | Training Category model |
| [`training_courses`](#training_courses) | `TrainingCourse` | 19 | Training Course model |
| [`training_effectiveness_evaluations`](#training_effectiveness_evaluations) | `TrainingEffectivenessEvaluation` | 20 | Training Effectiveness Evaluation model |
| [`training_module_configs`](#training_module_configs) | `TrainingModuleConfig` | 45 | Training Module Configuration model |
| [`training_programs`](#training_programs) | `TrainingProgram` | 23 | Training Program model |
| [`training_records`](#training_records) | `TrainingRecord` | 37 | Training Record model |
| [`training_requirements`](#training_requirements) | `TrainingRequirement` | 42 | Training Requirement model |
| [`training_sessions`](#training_sessions) | `TrainingSession` | 30 | Training Session model |
| [`training_submissions`](#training_submissions) | `TrainingSubmission` | 24 | Training Submission model |
| [`training_waivers`](#training_waivers) | `TrainingWaiver` | 13 | Training Waiver / Leave of Absence |
| [`xapi_statements`](#xapi_statements) | `XAPIStatement` | 27 | xAPI (Experience API / Tin Can) Statement model |

### Users, Organizations & Access Control

<sub>`app/models/user.py`</sub>

| Table | Model | Columns | Purpose |
|---|---|---|---|
| [`member_leaves_of_absence`](#member_leaves_of_absence) | `MemberLeaveOfAbsence` | 14 | Records periods where a member is on leave from the department. |
| [`organizations`](#organizations) | `Organization` | 36 | Organization/Department model |
| [`password_history`](#password_history) | `PasswordHistory` | 4 | Password history for HIPAA compliance (§164.312(d)) |
| [`positions`](#positions) | `Position` | 11 | Corporate Position model for permission-based access control. |
| [`prospects`](#prospects) | `Prospect` | 17 | Prospective member – someone who has expressed interest in joining |
| [`sessions`](#sessions) | `Session` | 12 | User session model for tracking active sessions |
| [`user_positions`](#user_positions) | _(association table)_ | 4 |  |
| [`users`](#users) | `User` | 55 | User model with comprehensive authentication and profile support. |

---

## Tables

## Administrative Hours

### `admin_hours_categories`

**AdminHoursCategory** · `app/models/admin_hours.py`

> Admin Hours Category Defines the types of administrative work members can log hours for. Each category can generate a QR code for easy clock-in/clock-out.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(200) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `color` | VARCHAR(7) | yes |  |  |  |
| `require_approval` | BOOL | no |  | `1` |  |
| `auto_approve_under_hours` | FLOAT | yes |  |  |  |
| `max_hours_per_session` | FLOAT | yes |  | `12.0` |  |
| `is_active` | BOOL | no |  | `1` |  |
| `sort_order` | INTEGER | no |  | `0` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `updated_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_admin_hours_categories_active` (`organization_id`, `is_active`)

### `admin_hours_entries`

**AdminHoursEntry** · `app/models/admin_hours.py`

> Admin Hours Entry Records a single session of administrative work by a member. Can be created via QR code scan (clock-in/clock-out) or manual entry.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `user_id` | VARCHAR(36) | no | FK, IDX |  | → `users.id` ON DELETE CASCADE |
| `category_id` | VARCHAR(36) | no | FK, IDX |  | → `admin_hours_categories.id` ON DELETE CASCADE |
| `clock_in_at` | DATETIME | no |  |  |  |
| `clock_out_at` | DATETIME | yes |  |  |  |
| `duration_minutes` | INTEGER | yes |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `entry_method` | ENUM(`qr_scan`, `manual`, `event_attendance`) | no |  | `'manual'` |  |
| `source_event_id` | VARCHAR(36) | yes | FK |  | → `events.id` ON DELETE SET NULL |
| `source_rsvp_id` | VARCHAR(36) | yes | FK, IDX |  | → `event_rsvps.id` ON DELETE SET NULL |
| `status` | ENUM(`active`, `pending`, `approved`, `rejected`) | no |  | `active` |  |
| `approved_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `approved_at` | DATETIME | yes |  |  |  |
| `rejection_reason` | TEXT | yes |  |  |  |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_admin_hours_entries_category_id` (`category_id`)
- `ix_admin_hours_entries_source_rsvp` (`source_rsvp_id`, `category_id`)
- `ix_admin_hours_entries_status` (`organization_id`, `status`)
- `ix_admin_hours_entries_user_active` (`user_id`, `status`)

### `event_hour_mappings`

**EventHourMapping** · `app/models/admin_hours.py`

> Maps event types/custom categories to admin hours categories. Allows organizations to configure how event attendance hours are automatically credited to admin hours categories, with optional percentage splits (e.g., 70% Training, 30% Professional Development).

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK |  | → `organizations.id` ON DELETE CASCADE |
| `event_type` | VARCHAR(50) | yes |  |  |  |
| `custom_category` | VARCHAR(100) | yes |  |  |  |
| `admin_hours_category_id` | VARCHAR(36) | no | FK |  | → `admin_hours_categories.id` ON DELETE CASCADE |
| `percentage` | INTEGER | no |  | `100` |  |
| `is_active` | BOOL | no |  | `1` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Constraints**

- CHECK `ck_event_hour_mappings_ck_event_hour_mappings_one_source`: `(event_type IS NOT NULL AND custom_category IS NULL) OR (event_type IS NULL AND custom_category IS NOT NULL)`
- CHECK `ck_event_hour_mappings_ck_event_hour_mappings_percentage_range`: `percentage >= 1 AND percentage <= 100`
- UNIQUE `uq_event_hour_mappings_source_target` (`organization_id`, `event_type`, `custom_category`, `admin_hours_category_id`)

## Analytics

### `analytics_events`

**AnalyticsEvent** · `app/models/analytics.py`

> Stores analytics events (QR scans, check-ins, etc.)

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | IDX |  |  |
| `event_type` | VARCHAR(50) | no |  |  |  |
| `event_id` | VARCHAR(36) | yes |  |  |  |
| `user_id` | VARCHAR(36) | yes |  |  |  |
| `device_type` | VARCHAR(20) | yes |  |  |  |
| `metadata` | JSON | yes |  | `dict()` |  |
| `created_at` | DATETIME | yes | IDX | `now()` |  |

**Indexes**

- `ix_analytics_created` (`created_at`)
- `ix_analytics_org_event` (`organization_id`, `event_id`)

### `saved_reports`

**SavedReport** · `app/models/analytics.py`

> Saved report configuration Allows users to save report configurations and optionally schedule them for periodic generation with email delivery.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(255) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `report_type` | VARCHAR(50) | no |  |  |  |
| `filters` | JSON | yes |  | `dict()` |  |
| `is_scheduled` | BOOL | no | IDX | `False` |  |
| `schedule_frequency` | VARCHAR(20) | yes |  |  |  |
| `schedule_day` | INTEGER | yes |  |  |  |
| `next_run_date` | DATE | yes |  |  |  |
| `last_run_at` | DATETIME | yes |  |  |  |
| `email_recipients` | JSON | yes |  | `list()` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `is_active` | BOOL | no |  | `True` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `ix_saved_reports_org` (`organization_id`)
- `ix_saved_reports_scheduled` (`is_scheduled`, `next_run_date`)

## Apparatus

### `apparatus`

**Apparatus** · `app/models/apparatus.py`

> Main Apparatus model for tracking department vehicles Comprehensive vehicle tracking including identification, specifications, purchase information, maintenance scheduling, and operational status.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, UQ-IDX |  | → `organizations.id` ON DELETE CASCADE |
| `unit_number` | VARCHAR(50) | no |  |  |  |
| `name` | VARCHAR(200) | yes |  |  |  |
| `vin` | VARCHAR(17) | yes |  |  |  |
| `license_plate` | VARCHAR(20) | yes |  |  |  |
| `license_state` | VARCHAR(50) | yes |  |  |  |
| `radio_id` | VARCHAR(50) | yes |  |  |  |
| `asset_tag` | VARCHAR(50) | yes |  |  |  |
| `apparatus_type_id` | VARCHAR(36) | no | FK, IDX |  | → `apparatus_types.id` |
| `status_id` | VARCHAR(36) | no | FK, IDX |  | → `apparatus_statuses.id` |
| `status_reason` | TEXT | yes |  |  |  |
| `status_changed_at` | DATETIME | yes |  |  |  |
| `status_changed_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `year` | INTEGER | yes |  |  |  |
| `make` | VARCHAR(100) | yes |  |  |  |
| `model` | VARCHAR(100) | yes |  |  |  |
| `body_manufacturer` | VARCHAR(100) | yes |  |  |  |
| `color` | VARCHAR(50) | yes |  |  |  |
| `fuel_type` | ENUM(`gasoline`, `diesel`, `electric`, `hybrid`, `propane`, `cng`, `other`) | yes |  | `'diesel'` |  |
| `fuel_capacity_gallons` | NUMERIC(10, 2) | yes |  |  |  |
| `seating_capacity` | INTEGER | yes |  |  |  |
| `gvwr` | INTEGER | yes |  |  |  |
| `min_staffing` | INTEGER | no |  | `1` |  |
| `required_evoc_level_id` | VARCHAR(36) | yes | FK |  | → `evoc_levels.id` ON DELETE SET NULL |
| `pump_capacity_gpm` | INTEGER | yes |  |  |  |
| `tank_capacity_gallons` | INTEGER | yes |  |  |  |
| `foam_capacity_gallons` | INTEGER | yes |  |  |  |
| `ladder_length_feet` | INTEGER | yes |  |  |  |
| `primary_station_id` | VARCHAR(36) | yes | FK, IDX |  | → `locations.id` |
| `current_location_id` | VARCHAR(36) | yes | FK |  | → `locations.id` |
| `current_mileage` | INTEGER | yes |  |  |  |
| `current_hours` | NUMERIC(10, 2) | yes |  |  |  |
| `mileage_updated_at` | DATETIME | yes |  |  |  |
| `hours_updated_at` | DATETIME | yes |  |  |  |
| `purchase_date` | DATE | yes |  |  |  |
| `purchase_price` | NUMERIC(12, 2) | yes |  |  |  |
| `purchase_vendor` | VARCHAR(200) | yes |  |  |  |
| `purchase_order_number` | VARCHAR(100) | yes |  |  |  |
| `in_service_date` | DATE | yes |  |  |  |
| `is_financed` | BOOL | yes |  | `False` |  |
| `financing_company` | VARCHAR(200) | yes |  |  |  |
| `financing_end_date` | DATE | yes |  |  |  |
| `monthly_payment` | NUMERIC(10, 2) | yes |  |  |  |
| `original_value` | NUMERIC(12, 2) | yes |  |  |  |
| `current_value` | NUMERIC(12, 2) | yes |  |  |  |
| `value_updated_at` | DATETIME | yes |  |  |  |
| `depreciation_method` | VARCHAR(50) | yes |  |  |  |
| `depreciation_years` | INTEGER | yes |  |  |  |
| `salvage_value` | NUMERIC(12, 2) | yes |  |  |  |
| `warranty_expiration` | DATE | yes |  |  |  |
| `extended_warranty_expiration` | DATE | yes |  |  |  |
| `warranty_provider` | VARCHAR(200) | yes |  |  |  |
| `warranty_notes` | TEXT | yes |  |  |  |
| `insurance_policy_number` | VARCHAR(100) | yes |  |  |  |
| `insurance_provider` | VARCHAR(200) | yes |  |  |  |
| `insurance_expiration` | DATE | yes |  |  |  |
| `registration_expiration` | DATE | yes |  |  |  |
| `inspection_expiration` | DATE | yes |  |  |  |
| `is_archived` | BOOL | no | IDX | `0` |  |
| `archived_at` | DATETIME | yes |  |  |  |
| `archived_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `sold_date` | DATE | yes |  |  |  |
| `sold_price` | NUMERIC(12, 2) | yes |  |  |  |
| `sold_to` | VARCHAR(200) | yes |  |  |  |
| `sold_to_contact` | VARCHAR(200) | yes |  |  |  |
| `disposal_date` | DATE | yes |  |  |  |
| `disposal_method` | VARCHAR(100) | yes |  |  |  |
| `disposal_reason` | TEXT | yes |  |  |  |
| `disposal_notes` | TEXT | yes |  |  |  |
| `nfpa_tracking_enabled` | BOOL | no |  | `0` |  |
| `has_deficiency` | BOOL | no |  | `0` |  |
| `deficiency_since` | DATETIME | yes |  |  |  |
| `custom_field_values` | JSON | yes |  | `dict()` |  |
| `description` | TEXT | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_apparatus_is_archived` (`is_archived`)
- `idx_apparatus_org_station` (`organization_id`, `primary_station_id`)
- `idx_apparatus_org_status` (`organization_id`, `status_id`)
- `idx_apparatus_org_type` (`organization_id`, `apparatus_type_id`)
- UNIQUE `idx_apparatus_org_unit` (`organization_id`, `unit_number`)
- UNIQUE `idx_apparatus_vin` (`organization_id`, `vin`)
- `ix_apparatus_apparatus_type_id` (`apparatus_type_id`)
- `ix_apparatus_primary_station_id` (`primary_station_id`)
- `ix_apparatus_status_id` (`status_id`)

### `apparatus_component_notes`

**ApparatusComponentNote** · `app/models/apparatus.py`

> Notes, observations, issues, and repair records tied to a specific apparatus component. Provides the apparatus coordinator with a detailed service history per component area.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `apparatus_id` | VARCHAR(36) | no | FK, IDX |  | → `apparatus.id` ON DELETE CASCADE |
| `component_id` | VARCHAR(36) | no | FK, IDX |  | → `apparatus_components.id` ON DELETE CASCADE |
| `title` | VARCHAR(300) | no |  |  |  |
| `description` | TEXT | no |  |  |  |
| `note_type` | ENUM(`observation`, `repair`, `issue`, `inspection`, `update`) | no | IDX | `observation` |  |
| `severity` | ENUM(`info`, `low`, `medium`, `high`, `critical`) | no | IDX | `info` |  |
| `status` | ENUM(`open`, `in_progress`, `resolved`, `deferred`) | no | IDX | `open` |  |
| `service_provider_id` | VARCHAR(36) | yes | FK, IDX |  | → `apparatus_service_providers.id` ON DELETE SET NULL |
| `estimated_cost` | NUMERIC(10, 2) | yes |  |  |  |
| `actual_cost` | NUMERIC(10, 2) | yes |  |  |  |
| `reported_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `resolved_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `resolved_at` | DATETIME | yes |  |  |  |
| `resolution_notes` | TEXT | yes |  |  |  |
| `attachments` | JSON | yes |  |  |  |
| `tags` | JSON | yes |  |  |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_component_notes_apparatus` (`apparatus_id`)
- `idx_component_notes_component` (`component_id`)
- `idx_component_notes_provider` (`service_provider_id`)
- `idx_component_notes_severity` (`severity`)
- `idx_component_notes_status` (`status`)
- `idx_component_notes_type` (`note_type`)
- `ix_apparatus_component_notes_organization_id` (`organization_id`)

### `apparatus_components`

**ApparatusComponent** · `app/models/apparatus.py`

> Segments an apparatus into logical components (engine, pump, aerial, etc.) for targeted maintenance tracking and service notes. Each apparatus can have system-default components plus custom ones.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `apparatus_id` | VARCHAR(36) | no | FK, IDX |  | → `apparatus.id` ON DELETE CASCADE |
| `name` | VARCHAR(200) | no |  |  |  |
| `component_type` | ENUM(`engine`, `pump`, `aerial`, `chassis`, `drivetrain`, `brakes`, `electrical`, `hydraulic`, `body`, `cab`, `tank`, `foam_system`, `cooling`, `exhaust`, `lighting`, `communications`, `safety_equipment`, `hvac`, `tires_wheels`, `other`) | no |  | `other` |  |
| `description` | TEXT | yes |  |  |  |
| `manufacturer` | VARCHAR(200) | yes |  |  |  |
| `model_number` | VARCHAR(100) | yes |  |  |  |
| `serial_number` | VARCHAR(100) | yes |  |  |  |
| `install_date` | DATE | yes |  |  |  |
| `warranty_expiration` | DATE | yes |  |  |  |
| `expected_life_years` | INTEGER | yes |  |  |  |
| `condition` | ENUM(`excellent`, `good`, `fair`, `poor`, `critical`) | no | IDX | `good` |  |
| `last_serviced_date` | DATE | yes |  |  |  |
| `last_inspected_date` | DATE | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `sort_order` | INTEGER | yes |  | `0` |  |
| `is_active` | BOOL | no |  | `1` |  |
| `archived_at` | DATETIME | yes |  |  |  |
| `archived_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_apparatus_components_condition` (`condition`)
- `idx_apparatus_components_type` (`apparatus_id`, `component_type`)
- `ix_apparatus_components_organization_id` (`organization_id`)

### `apparatus_custom_fields`

**ApparatusCustomField** · `app/models/apparatus.py`

> Custom field definitions for apparatus Allows organizations to define their own tracking fields beyond the standard apparatus fields.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, UQ-IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(100) | no |  |  |  |
| `field_key` | VARCHAR(100) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `field_type` | ENUM(`text`, `number`, `decimal`, `date`, `datetime`, `boolean`, `select`, `multi_select`, `url`, `email`) | no |  | `text` |  |
| `is_required` | BOOL | no |  | `0` |  |
| `default_value` | TEXT | yes |  |  |  |
| `placeholder` | VARCHAR(200) | yes |  |  |  |
| `options` | JSON | yes |  |  |  |
| `min_value` | NUMERIC(20, 6) | yes |  |  |  |
| `max_value` | NUMERIC(20, 6) | yes |  |  |  |
| `min_length` | INTEGER | yes |  |  |  |
| `max_length` | INTEGER | yes |  |  |  |
| `regex_pattern` | VARCHAR(500) | yes |  |  |  |
| `applies_to_types` | JSON | yes |  |  |  |
| `sort_order` | INTEGER | yes |  | `0` |  |
| `show_in_list` | BOOL | no |  | `0` |  |
| `show_in_detail` | BOOL | no |  | `1` |  |
| `is_active` | BOOL | no |  | `1` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_apparatus_custom_fields_org_active` (`organization_id`, `is_active`)
- UNIQUE `idx_apparatus_custom_fields_org_key` (`organization_id`, `field_key`)

### `apparatus_documents`

**ApparatusDocument** · `app/models/apparatus.py`

> Documents associated with apparatus Stores titles, registrations, manuals, inspection reports, and other documentation.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `apparatus_id` | VARCHAR(36) | no | FK, IDX |  | → `apparatus.id` ON DELETE CASCADE |
| `file_path` | TEXT | no |  |  |  |
| `file_name` | VARCHAR(255) | no |  |  |  |
| `file_size` | INTEGER | yes |  |  |  |
| `mime_type` | VARCHAR(100) | yes |  |  |  |
| `title` | VARCHAR(200) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `document_type` | VARCHAR(50) | no |  |  |  |
| `expiration_date` | DATE | yes | IDX |  |  |
| `document_date` | DATE | yes |  |  |  |
| `uploaded_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `uploaded_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_apparatus_documents_expiration` (`expiration_date`)
- `idx_apparatus_documents_type` (`apparatus_id`, `document_type`)
- `ix_apparatus_documents_organization_id` (`organization_id`)

### `apparatus_equipment`

**ApparatusEquipment** · `app/models/apparatus.py`

> Equipment assigned to apparatus Links to inventory items and tracks what equipment is mounted or carried on each apparatus.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `apparatus_id` | VARCHAR(36) | no | FK, IDX |  | → `apparatus.id` ON DELETE CASCADE |
| `inventory_item_id` | VARCHAR(36) | yes | IDX |  |  |
| `name` | VARCHAR(200) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `quantity` | INTEGER | no |  | `1` |  |
| `location_on_apparatus` | VARCHAR(200) | yes |  |  |  |
| `is_mounted` | BOOL | no |  | `0` |  |
| `is_required` | BOOL | no |  | `0` |  |
| `serial_number` | VARCHAR(100) | yes |  |  |  |
| `asset_tag` | VARCHAR(50) | yes |  |  |  |
| `is_present` | BOOL | no |  | `1` |  |
| `notes` | TEXT | yes |  |  |  |
| `assigned_at` | DATETIME | yes |  | `now()` |  |
| `assigned_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_apparatus_equipment_apparatus` (`apparatus_id`)
- `idx_apparatus_equipment_inventory` (`inventory_item_id`)
- `ix_apparatus_equipment_organization_id` (`organization_id`)

### `apparatus_fuel_logs`

**ApparatusFuelLog** · `app/models/apparatus.py`

> Fuel purchase and usage log for apparatus

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `apparatus_id` | VARCHAR(36) | no | FK, IDX |  | → `apparatus.id` ON DELETE CASCADE |
| `fuel_date` | DATETIME | no | IDX |  |  |
| `fuel_type` | ENUM(`gasoline`, `diesel`, `electric`, `hybrid`, `propane`, `cng`, `other`) | no |  |  |  |
| `gallons` | NUMERIC(10, 3) | no |  |  |  |
| `price_per_gallon` | NUMERIC(6, 3) | yes |  |  |  |
| `total_cost` | NUMERIC(10, 2) | yes |  |  |  |
| `mileage_at_fill` | INTEGER | yes |  |  |  |
| `hours_at_fill` | NUMERIC(10, 2) | yes |  |  |  |
| `is_full_tank` | BOOL | no |  | `1` |  |
| `station_name` | VARCHAR(200) | yes |  |  |  |
| `station_address` | TEXT | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `recorded_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_apparatus_fuel_apparatus` (`apparatus_id`)
- `idx_apparatus_fuel_date` (`fuel_date`)
- `ix_apparatus_fuel_logs_organization_id` (`organization_id`)

### `apparatus_location_history`

**ApparatusLocationHistory** · `app/models/apparatus.py`

> History of station/location assignments for apparatus

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `apparatus_id` | VARCHAR(36) | no | FK, IDX |  | → `apparatus.id` ON DELETE CASCADE |
| `location_id` | VARCHAR(36) | no | FK, IDX |  | → `locations.id` |
| `assigned_date` | DATETIME | no | IDX |  |  |
| `unassigned_date` | DATETIME | yes |  |  |  |
| `assignment_reason` | TEXT | yes |  |  |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_apparatus_loc_hist_apparatus` (`apparatus_id`)
- `idx_apparatus_loc_hist_dates` (`assigned_date`, `unassigned_date`)
- `idx_apparatus_loc_hist_location` (`location_id`)
- `ix_apparatus_location_history_organization_id` (`organization_id`)

### `apparatus_maintenance`

**ApparatusMaintenance** · `app/models/apparatus.py`

> Maintenance records for apparatus Tracks scheduled and unscheduled maintenance, repairs, inspections, and certifications.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `apparatus_id` | VARCHAR(36) | no | FK, IDX |  | → `apparatus.id` ON DELETE CASCADE |
| `maintenance_type_id` | VARCHAR(36) | no | FK, IDX |  | → `apparatus_maintenance_types.id` |
| `component_id` | VARCHAR(36) | yes | FK, IDX |  | → `apparatus_components.id` ON DELETE SET NULL |
| `service_provider_id` | VARCHAR(36) | yes | FK, IDX |  | → `apparatus_service_providers.id` ON DELETE SET NULL |
| `scheduled_date` | DATE | yes |  |  |  |
| `due_date` | DATE | yes | IDX |  |  |
| `completed_date` | DATE | yes |  |  |  |
| `completed_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `performed_by` | VARCHAR(200) | yes |  |  |  |
| `is_completed` | BOOL | no | IDX | `0` |  |
| `is_overdue` | BOOL | no | IDX | `0` |  |
| `description` | TEXT | yes |  |  |  |
| `work_performed` | TEXT | yes |  |  |  |
| `findings` | TEXT | yes |  |  |  |
| `mileage_at_service` | INTEGER | yes |  |  |  |
| `hours_at_service` | NUMERIC(10, 2) | yes |  |  |  |
| `cost` | NUMERIC(10, 2) | yes |  |  |  |
| `vendor` | VARCHAR(200) | yes |  |  |  |
| `invoice_number` | VARCHAR(100) | yes |  |  |  |
| `next_due_date` | DATE | yes |  |  |  |
| `next_due_mileage` | INTEGER | yes |  |  |  |
| `next_due_hours` | NUMERIC(10, 2) | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `attachments` | JSON | yes |  |  |  |
| `is_historic` | BOOL | no | IDX | `0` |  |
| `occurred_date` | DATE | yes | IDX |  |  |
| `historic_source` | VARCHAR(200) | yes |  |  |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_apparatus_maint_apparatus` (`apparatus_id`)
- `idx_apparatus_maint_completed` (`is_completed`)
- `idx_apparatus_maint_component` (`component_id`)
- `idx_apparatus_maint_due_date` (`due_date`)
- `idx_apparatus_maint_historic` (`is_historic`)
- `idx_apparatus_maint_occurred` (`occurred_date`)
- `idx_apparatus_maint_overdue` (`is_overdue`)
- `idx_apparatus_maint_provider` (`service_provider_id`)
- `idx_apparatus_maint_type` (`maintenance_type_id`)
- `ix_apparatus_maintenance_organization_id` (`organization_id`)

### `apparatus_maintenance_types`

**ApparatusMaintenanceType** · `app/models/apparatus.py`

> Maintenance type definitions Supports both system-defined maintenance types (oil change, pump test) and custom organization-defined types (custom fluid checks, etc.)

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | yes | FK, UQ-IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(100) | no |  |  |  |
| `code` | VARCHAR(50) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `category` | ENUM(`preventive`, `repair`, `inspection`, `certification`, `fluid`, `cleaning`, `other`) | no | IDX | `preventive` |  |
| `is_system` | BOOL | no | IDX | `0` |  |
| `default_interval_value` | INTEGER | yes |  |  |  |
| `default_interval_unit` | ENUM(`days`, `weeks`, `months`, `years`, `miles`, `kilometers`, `hours`) | yes |  |  |  |
| `default_interval_miles` | INTEGER | yes |  |  |  |
| `default_interval_hours` | INTEGER | yes |  |  |  |
| `is_nfpa_required` | BOOL | no |  | `0` |  |
| `nfpa_reference` | VARCHAR(100) | yes |  |  |  |
| `applies_to_types` | JSON | yes |  |  |  |
| `sort_order` | INTEGER | yes |  | `0` |  |
| `is_active` | BOOL | no |  | `1` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_apparatus_maint_types_category` (`category`)
- `idx_apparatus_maint_types_is_system` (`is_system`)
- UNIQUE `idx_apparatus_maint_types_org_code` (`organization_id`, `code`)

### `apparatus_nfpa_compliance`

**ApparatusNFPACompliance** · `app/models/apparatus.py`

> NFPA compliance tracking for apparatus Only used when nfpa_tracking_enabled is True for the apparatus.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `apparatus_id` | VARCHAR(36) | no | FK, IDX |  | → `apparatus.id` ON DELETE CASCADE |
| `standard_code` | VARCHAR(50) | no | IDX |  |  |
| `section_reference` | VARCHAR(100) | no |  |  |  |
| `requirement_description` | TEXT | no |  |  |  |
| `is_compliant` | BOOL | no |  | `0` |  |
| `compliance_status` | VARCHAR(50) | yes | IDX | `'pending'` |  |
| `last_checked_date` | DATE | yes |  |  |  |
| `last_checked_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `next_due_date` | DATE | yes | IDX |  |  |
| `notes` | TEXT | yes |  |  |  |
| `exemption_reason` | TEXT | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_apparatus_nfpa_apparatus` (`apparatus_id`)
- `idx_apparatus_nfpa_due` (`next_due_date`)
- `idx_apparatus_nfpa_standard` (`standard_code`)
- `idx_apparatus_nfpa_status` (`compliance_status`)
- `ix_apparatus_nfpa_compliance_organization_id` (`organization_id`)

### `apparatus_operators`

**ApparatusOperator** · `app/models/apparatus.py`

> Tracks which personnel are certified/qualified to operate apparatus Includes custom restrictions (parade only, daylight only, etc.)

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `apparatus_id` | VARCHAR(36) | no | FK, UQ-IDX |  | → `apparatus.id` ON DELETE CASCADE |
| `user_id` | VARCHAR(36) | no | FK, IDX |  | → `users.id` ON DELETE CASCADE |
| `evoc_level_id` | VARCHAR(36) | yes | FK, IDX |  | → `evoc_levels.id` ON DELETE SET NULL |
| `is_certified` | BOOL | no |  | `1` |  |
| `certification_date` | DATE | yes |  |  |  |
| `certification_expiration` | DATE | yes |  |  |  |
| `certified_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `license_type_required` | VARCHAR(50) | yes |  |  |  |
| `license_verified` | BOOL | no |  | `0` |  |
| `license_verified_date` | DATE | yes |  |  |  |
| `has_restrictions` | BOOL | no |  | `0` |  |
| `restrictions` | JSON | yes |  |  |  |
| `restriction_notes` | TEXT | yes |  |  |  |
| `is_active` | BOOL | no | IDX | `1` |  |
| `notes` | TEXT | yes |  |  |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_apparatus_operators_active` (`is_active`)
- UNIQUE `idx_apparatus_operators_apparatus_user` (`apparatus_id`, `user_id`)
- `idx_apparatus_operators_evoc` (`evoc_level_id`)
- `idx_apparatus_operators_user` (`user_id`)
- `ix_apparatus_operators_organization_id` (`organization_id`)

### `apparatus_photos`

**ApparatusPhoto** · `app/models/apparatus.py`

> Photos associated with apparatus Supports multiple photos per apparatus with metadata for tracking deterioration, damage documentation, etc.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `apparatus_id` | VARCHAR(36) | no | FK, IDX |  | → `apparatus.id` ON DELETE CASCADE |
| `file_path` | TEXT | no |  |  |  |
| `file_name` | VARCHAR(255) | no |  |  |  |
| `file_size` | INTEGER | yes |  |  |  |
| `mime_type` | VARCHAR(100) | yes |  |  |  |
| `title` | VARCHAR(200) | yes |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `taken_at` | DATETIME | yes |  |  |  |
| `photo_type` | VARCHAR(50) | yes |  |  |  |
| `is_primary` | BOOL | no |  | `0` |  |
| `uploaded_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `uploaded_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_apparatus_photos_is_primary` (`apparatus_id`, `is_primary`)
- `ix_apparatus_photos_organization_id` (`organization_id`)

### `apparatus_report_configs`

**ApparatusReportConfig** · `app/models/apparatus.py`

> Configuration for scheduled and custom apparatus reports

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(200) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `report_type` | VARCHAR(50) | no |  |  |  |
| `is_scheduled` | BOOL | no | IDX | `0` |  |
| `schedule_frequency` | VARCHAR(50) | yes |  |  |  |
| `schedule_day` | INTEGER | yes |  |  |  |
| `next_run_date` | DATETIME | yes | IDX |  |  |
| `last_run_date` | DATETIME | yes |  |  |  |
| `data_range_type` | VARCHAR(50) | yes |  |  |  |
| `data_range_days` | INTEGER | yes |  |  |  |
| `include_apparatus_ids` | JSON | yes |  |  |  |
| `include_type_ids` | JSON | yes |  |  |  |
| `include_status_ids` | JSON | yes |  |  |  |
| `include_archived` | BOOL | no |  | `0` |  |
| `fields_to_include` | JSON | yes |  |  |  |
| `group_by` | VARCHAR(100) | yes |  |  |  |
| `sort_by` | VARCHAR(100) | yes |  |  |  |
| `sort_direction` | VARCHAR(10) | yes |  | `'asc'` |  |
| `output_format` | VARCHAR(50) | yes |  | `'pdf'` |  |
| `email_recipients` | JSON | yes |  |  |  |
| `is_active` | BOOL | no |  | `1` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_apparatus_report_configs_next_run` (`next_run_date`)
- `idx_apparatus_report_configs_org` (`organization_id`)
- `idx_apparatus_report_configs_scheduled` (`is_scheduled`)

### `apparatus_service_providers`

**ApparatusServiceProvider** · `app/models/apparatus.py`

> Service providers (companies or individuals) who perform maintenance, repairs, and inspections on apparatus.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(200) | no |  |  |  |
| `company_name` | VARCHAR(200) | yes |  |  |  |
| `contact_name` | VARCHAR(200) | yes |  |  |  |
| `phone` | VARCHAR(50) | yes |  |  |  |
| `email` | VARCHAR(200) | yes |  |  |  |
| `address` | TEXT | yes |  |  |  |
| `city` | VARCHAR(100) | yes |  |  |  |
| `state` | VARCHAR(50) | yes |  |  |  |
| `zip_code` | VARCHAR(20) | yes |  |  |  |
| `website` | VARCHAR(300) | yes |  |  |  |
| `specialties` | JSON | yes |  |  |  |
| `certifications` | JSON | yes |  |  |  |
| `is_emergency_service` | BOOL | no |  | `0` |  |
| `license_number` | VARCHAR(100) | yes |  |  |  |
| `insurance_info` | TEXT | yes |  |  |  |
| `tax_id` | VARCHAR(50) | yes |  |  |  |
| `is_preferred` | BOOL | no |  | `0` |  |
| `rating` | INTEGER | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `contract_info` | TEXT | yes |  |  |  |
| `is_active` | BOOL | no |  | `1` |  |
| `archived_at` | DATETIME | yes |  |  |  |
| `archived_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_service_providers_active` (`organization_id`, `is_active`)
- `idx_service_providers_org_name` (`organization_id`, `name`)
- `idx_service_providers_preferred` (`organization_id`, `is_preferred`)

**Constraints**

- CHECK `ck_apparatus_service_providers_ck_service_provider_rating`: `rating IS NULL OR (rating >= 1 AND rating <= 5)`

### `apparatus_status_history`

**ApparatusStatusHistory** · `app/models/apparatus.py`

> History of status changes for apparatus

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `apparatus_id` | VARCHAR(36) | no | FK, IDX |  | → `apparatus.id` ON DELETE CASCADE |
| `status_id` | VARCHAR(36) | no | FK, IDX |  | → `apparatus_statuses.id` |
| `changed_at` | DATETIME | no | IDX | `now()` |  |
| `reason` | TEXT | yes |  |  |  |
| `mileage_at_change` | INTEGER | yes |  |  |  |
| `hours_at_change` | NUMERIC(10, 2) | yes |  |  |  |
| `changed_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |

**Indexes**

- `idx_apparatus_status_hist_apparatus` (`apparatus_id`)
- `idx_apparatus_status_hist_changed` (`changed_at`)
- `idx_apparatus_status_hist_status` (`status_id`)
- `ix_apparatus_status_history_organization_id` (`organization_id`)

### `apparatus_statuses`

**ApparatusStatus** · `app/models/apparatus.py`

> Apparatus Status model for tracking vehicle availability Supports both system-defined statuses and custom organization-defined statuses for specific operational needs.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | yes | FK, UQ-IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(100) | no |  |  |  |
| `code` | VARCHAR(50) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `is_system` | BOOL | no | IDX | `0` |  |
| `default_status` | ENUM(`in_service`, `out_of_service`, `in_maintenance`, `reserve`, `on_order`, `sold`, `disposed`) | yes |  |  |  |
| `is_available` | BOOL | no | IDX | `1` |  |
| `is_operational` | BOOL | no |  | `1` |  |
| `requires_reason` | BOOL | no |  | `0` |  |
| `is_archived_status` | BOOL | no |  | `0` |  |
| `color` | VARCHAR(20) | yes |  |  |  |
| `icon` | VARCHAR(50) | yes |  |  |  |
| `sort_order` | INTEGER | yes |  | `0` |  |
| `is_active` | BOOL | no |  | `1` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_apparatus_statuses_is_available` (`is_available`)
- `idx_apparatus_statuses_is_system` (`is_system`)
- UNIQUE `idx_apparatus_statuses_org_code` (`organization_id`, `code`)

### `apparatus_types`

**ApparatusType** · `app/models/apparatus.py`

> Apparatus Type model for categorizing vehicles Supports both system-defined types (engine, ladder, ambulance, etc.) and custom organization-defined types for specialty vehicles.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | yes | FK, UQ-IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(100) | no |  |  |  |
| `code` | VARCHAR(50) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `category` | ENUM(`fire`, `ems`, `rescue`, `support`, `command`, `marine`, `aircraft`, `admin`, `other`) | no | IDX | `fire` |  |
| `is_system` | BOOL | no | IDX | `0` |  |
| `default_type` | ENUM(`engine`, `ladder`, `quint`, `rescue`, `ambulance`, `squad`, `tanker`, `brush`, `hazmat`, `command`, `utility`, `boat`, `atv`, `staff`, `reserve`, `other`) | yes |  |  |  |
| `icon` | VARCHAR(50) | yes |  |  |  |
| `color` | VARCHAR(20) | yes |  |  |  |
| `sort_order` | INTEGER | yes |  | `0` |  |
| `is_active` | BOOL | no |  | `1` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_apparatus_types_category` (`category`)
- `idx_apparatus_types_is_system` (`is_system`)
- UNIQUE `idx_apparatus_types_org_code` (`organization_id`, `code`)

### `check_template_compartments`

**CheckTemplateCompartment** · `app/models/apparatus.py`

> A named section/area within a checklist template. Represents a physical compartment on the apparatus (e.g., "Officer Door Entry", "Driver Side Action Area", "Cabinets"). Supports nesting via parent_compartment_id.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `template_id` | VARCHAR(36) | no | FK, IDX |  | → `equipment_check_templates.id` ON DELETE CASCADE |
| `name` | VARCHAR(200) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `sort_order` | INTEGER | no |  | `0` |  |
| `image_url` | VARCHAR(500) | yes |  |  |  |
| `is_header` | BOOL | no |  | `0` |  |
| `container_type` | VARCHAR(50) | no |  | `compartment` |  |
| `parent_compartment_id` | VARCHAR(36) | yes | FK, IDX |  | → `check_template_compartments.id` ON DELETE SET NULL |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_check_compartment_parent` (`parent_compartment_id`)
- `idx_check_compartment_template` (`template_id`)

### `check_template_items`

**CheckTemplateItem** · `app/models/apparatus.py`

> An individual item to check within a compartment. Supports pass/fail, quantity (with state-mandated minimums), and reading check types. Items can track expiration dates and include reference images.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `compartment_id` | VARCHAR(36) | no | FK, IDX |  | → `check_template_compartments.id` ON DELETE CASCADE |
| `equipment_id` | VARCHAR(36) | yes | FK, IDX |  | → `apparatus_equipment.id` ON DELETE SET NULL |
| `inventory_item_id` | VARCHAR(36) | yes | FK, IDX |  | → `inventory_items.id` ON DELETE SET NULL |
| `name` | VARCHAR(200) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `sort_order` | INTEGER | no |  | `0` |  |
| `check_type` | VARCHAR(30) | no |  | `'pass_fail'` |  |
| `is_required` | BOOL | no |  | `False` |  |
| `required_quantity` | INTEGER | yes |  |  |  |
| `expected_quantity` | INTEGER | yes |  |  |  |
| `critical_minimum_quantity` | INTEGER | yes |  |  |  |
| `min_level` | FLOAT | yes |  |  |  |
| `level_unit` | VARCHAR(50) | yes |  |  |  |
| `serial_number` | VARCHAR(100) | yes |  |  |  |
| `lot_number` | VARCHAR(100) | yes |  |  |  |
| `image_url` | VARCHAR(500) | yes |  |  |  |
| `has_expiration` | BOOL | no |  | `False` |  |
| `expiration_date` | DATE | yes |  |  |  |
| `expiration_warning_days` | INTEGER | no |  | `30` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_check_item_compartment` (`compartment_id`)
- `idx_check_item_equipment` (`equipment_id`)
- `idx_check_item_inventory` (`inventory_item_id`)

### `equipment_check_templates`

**EquipmentCheckTemplate** · `app/models/apparatus.py`

> Master template for an equipment checklist. Multiple templates can exist per apparatus (e.g., start-of-shift driver vehicle check, start-of-shift officer medical check, end-of-shift check). Templates can be defined at the apparatus-type level (defaults) or for a specific apparatus (overrides).

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `apparatus_id` | VARCHAR(36) | yes | FK, IDX |  | → `apparatus.id` ON DELETE CASCADE |
| `apparatus_type` | VARCHAR(50) | yes | IDX |  |  |
| `name` | VARCHAR(200) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `check_timing` | VARCHAR(30) | no |  |  |  |
| `template_type` | VARCHAR(30) | no |  | `equipment` |  |
| `assigned_positions` | JSON | yes |  |  |  |
| `is_active` | BOOL | no |  | `True` |  |
| `sort_order` | INTEGER | no |  | `0` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |

**Indexes**

- `idx_equip_check_tmpl_apparatus` (`apparatus_id`)
- `idx_equip_check_tmpl_org` (`organization_id`)
- `idx_equip_check_tmpl_type` (`apparatus_type`)

### `evoc_levels`

**EvocLevel** · `app/models/apparatus.py`

> Organization-configurable EVOC (Emergency Vehicle Operator Course) levels. EVOC levels are a national standard (1-4) but departments can customize which level each apparatus requires based on local regulations and vehicle weight classifications. Levels are cumulative by default (EVOC 3 implies EVOC 2 privileges) but this can be overridden per level for exceptions.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | yes | FK, UQ-IDX |  | → `organizations.id` ON DELETE CASCADE |
| `level_number` | INTEGER | no |  |  |  |
| `name` | VARCHAR(100) | no |  |  |  |
| `code` | VARCHAR(50) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `is_cumulative` | BOOL | no |  | `1` |  |
| `training_program_id` | VARCHAR(36) | yes | FK |  | → `training_programs.id` ON DELETE SET NULL |
| `is_system` | BOOL | no |  | `0` |  |
| `sort_order` | INTEGER | no |  | `0` |  |
| `is_active` | BOOL | no | IDX | `1` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_evoc_levels_active` (`is_active`)
- UNIQUE `idx_evoc_levels_org_code` (`organization_id`, `code`)
- UNIQUE `idx_evoc_levels_org_level` (`organization_id`, `level_number`)

### `template_change_logs`

**TemplateChangeLog** · `app/models/apparatus.py`

> Granular audit trail for equipment check template edits. Records every add/update/delete action on templates, compartments, and items so leadership can review who changed what and when. Visible only to users with equipment_check.manage permission.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `template_id` | VARCHAR(36) | no | FK, IDX |  | → `equipment_check_templates.id` ON DELETE CASCADE |
| `user_id` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `user_name` | VARCHAR(255) | no |  |  |  |
| `action` | VARCHAR(30) | no |  |  |  |
| `entity_type` | VARCHAR(30) | no |  |  |  |
| `entity_id` | VARCHAR(36) | yes |  |  |  |
| `entity_name` | VARCHAR(200) | yes |  |  |  |
| `changes` | JSON | yes |  |  |  |
| `created_at` | DATETIME | yes | IDX | `now()` |  |

**Indexes**

- `idx_tmpl_changelog_created` (`created_at`)
- `idx_tmpl_changelog_org` (`organization_id`)
- `idx_tmpl_changelog_template` (`template_id`)

## Audit & Compliance Logging

### `audit_log_checkpoints`

**AuditLogCheckpoint** · `app/models/audit.py`

> Periodic integrity checkpoints for audit logs These provide cryptographic snapshots that can be used to verify the integrity of historical logs.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | INTEGER | no | PK |  |  |
| `checkpoint_time` | DATETIME | no | IDX | `now()` |  |
| `first_log_id` | BIGINT | no |  |  |  |
| `last_log_id` | BIGINT | no |  |  |  |
| `merkle_root` | VARCHAR(64) | no |  |  |  |
| `checkpoint_hash` | VARCHAR(64) | no |  |  |  |
| `signature` | TEXT | yes |  |  |  |
| `total_entries` | INTEGER | no |  |  |  |
| `verified_at` | DATETIME | yes |  |  |  |
| `archived_at` | DATETIME | yes |  |  |  |
| `last_log_hash` | VARCHAR(64) | yes |  |  |  |
| `archive_attestation` | VARCHAR(64) | yes |  |  |  |
| `created_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `idx_checkpoint_time` (`checkpoint_time`)

### `audit_logs`

**AuditLog** · `app/models/audit.py`

> Tamper-proof audit log entries Each entry forms part of a cryptographic hash chain, making it impossible to modify historical entries without detection.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | BIGINT | no | PK |  |  |
| `timestamp` | DATETIME | no | IDX | `now()` |  |
| `timestamp_nanos` | BIGINT | no |  |  |  |
| `event_type` | VARCHAR(100) | no | IDX |  |  |
| `event_category` | VARCHAR(50) | no | IDX |  |  |
| `severity` | ENUM(`info`, `warning`, `critical`) | no |  |  |  |
| `user_id` | VARCHAR(36) | yes | IDX |  |  |
| `username` | VARCHAR(255) | yes |  |  |  |
| `session_id` | VARCHAR(36) | yes |  |  |  |
| `organization_id` | VARCHAR(36) | yes | IDX |  |  |
| `ip_address` | VARCHAR(45) | yes |  |  |  |
| `user_agent` | TEXT | yes |  |  |  |
| `geo_location` | JSON | yes |  |  |  |
| `event_data` | JSON | no |  |  |  |
| `previous_hash` | VARCHAR(64) | no |  |  |  |
| `current_hash` | VARCHAR(64) | no | IDX |  |  |
| `hash_version` | INTEGER | yes |  |  |  |
| `created_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `idx_audit_current_hash` (`current_hash`)
- `idx_audit_event_type` (`event_type`)
- `idx_audit_timestamp` (`timestamp`)
- `idx_audit_user_id` (`user_id`)
- `ix_audit_logs_event_category` (`event_category`)
- `ix_audit_logs_organization_id` (`organization_id`)

### `audit_ship_state`

**AuditShipState** · `app/models/audit.py`

> High-water mark for off-host audit-log shipping. A single row (id=1) tracking the last AuditLog.id successfully delivered to the configured external collector (AUDIT_SHIP_WEBHOOK_URL). The watermark only advances after the collector acknowledges a batch, so a failed delivery is retried on the next scheduled run.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | INTEGER | no | PK |  |  |
| `last_shipped_id` | BIGINT | no |  | `0` |  |
| `last_shipped_at` | DATETIME | yes |  |  |  |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

## Compliance Configuration

### `compliance_configs`

**ComplianceConfig** · `app/models/compliance_config.py`

> Organization-level compliance configuration. Defines thresholds, rules, and report scheduling for the compliance requirements system.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, UQ |  | → `organizations.id` ON DELETE CASCADE |
| `threshold_type` | VARCHAR(30) | no |  | `percentage` |  |
| `compliant_threshold` | FLOAT | no |  | `100.0` |  |
| `at_risk_threshold` | FLOAT | no |  | `75.0` |  |
| `grace_period_days` | INTEGER | no |  | `0` |  |
| `include_current_month` | BOOL | no |  | `1` |  |
| `auto_report_frequency` | VARCHAR(20) | no |  | `none` |  |
| `report_email_recipients` | JSON | yes |  |  |  |
| `report_day_of_month` | INTEGER | yes |  | `1` |  |
| `notify_non_compliant_members` | BOOL | no |  | `0` |  |
| `notify_days_before_deadline` | JSON | yes |  | generated |  |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |
| `updated_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |

**Constraints**

- UNIQUE `uq_compliance_configs_organization_id` (`organization_id`)

### `compliance_profiles`

**ComplianceProfile** · `app/models/compliance_config.py`

> Role/membership-type specific compliance profile. Allows different compliance rules for different member groups (e.g., active firefighters vs. administrative members).

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `config_id` | VARCHAR(36) | no | FK |  | → `compliance_configs.id` ON DELETE CASCADE |
| `name` | VARCHAR(100) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `membership_types` | JSON | yes |  |  |  |
| `role_ids` | JSON | yes |  |  |  |
| `compliant_threshold_override` | FLOAT | yes |  |  |  |
| `at_risk_threshold_override` | FLOAT | yes |  |  |  |
| `required_requirement_ids` | JSON | yes |  |  |  |
| `optional_requirement_ids` | JSON | yes |  |  |  |
| `admin_hours_requirements` | JSON | yes |  |  |  |
| `is_active` | BOOL | no |  | `1` |  |
| `priority` | INTEGER | no |  | `0` |  |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

### `compliance_reports`

**ComplianceReport** · `app/models/compliance_config.py`

> Stored compliance reports (auto-generated or manual). Reports are generated, stored as JSON snapshots, and optionally emailed to configured recipients.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `report_type` | VARCHAR(20) | no |  |  |  |
| `period_label` | VARCHAR(50) | no |  |  |  |
| `period_year` | INTEGER | no |  |  |  |
| `period_month` | INTEGER | yes |  |  |  |
| `status` | VARCHAR(20) | no | IDX | `pending` |  |
| `report_data` | JSON | yes |  |  |  |
| `summary` | JSON | yes |  |  |  |
| `emailed_to` | JSON | yes |  |  |  |
| `emailed_at` | DATETIME | yes |  |  |  |
| `generated_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `generated_at` | DATETIME | no |  | `now()` |  |
| `generation_duration_ms` | INTEGER | yes |  |  |  |
| `error_message` | TEXT | yes |  |  |  |

**Indexes**

- `idx_compliance_reports_org_period` (`organization_id`, `period_year`, `period_month`)
- `idx_compliance_reports_status` (`status`)

## Consent

### `user_consents`

**UserConsent** · `app/models/consent.py`

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `user_id` | VARCHAR(36) | no | FK, UQ-IDX |  | → `users.id` ON DELETE CASCADE |
| `consent_type` | ENUM(`photo_use`, `public_roster_listing`, `sms_notifications`) | no |  |  |  |
| `granted` | BOOL | no |  |  |  |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- UNIQUE `idx_user_consent_unique` (`user_id`, `consent_type`)
- `ix_user_consents_organization_id` (`organization_id`)

## Documents

### `document_folders`

**DocumentFolder** · `app/models/document.py`

> Document Folder model Represents a folder for organizing documents. Supports nested folders via parent_id.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(255) | no |  |  |  |
| `slug` | VARCHAR(100) | yes |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `color` | VARCHAR(20) | yes |  | `'#3B82F6'` |  |
| `icon` | VARCHAR(50) | yes |  | `'folder'` |  |
| `is_system` | BOOL | yes |  | `False` |  |
| `sort_order` | INTEGER | yes |  | `0` |  |
| `parent_id` | VARCHAR(36) | yes | FK, IDX |  | → `document_folders.id` ON DELETE CASCADE |
| `visibility` | ENUM(`organization`, `leadership`, `owner`) | no |  | `organization` |  |
| `owner_user_id` | VARCHAR(36) | yes | FK, IDX |  | → `users.id` ON DELETE SET NULL |
| `allowed_roles` | JSON | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` |

**Indexes**

- `idx_doc_folders_org` (`organization_id`)
- `idx_doc_folders_owner` (`owner_user_id`)
- `idx_doc_folders_parent` (`parent_id`)

### `documents`

**Document** · `app/models/document.py`

> Document model Represents a file uploaded or generated in the document management system.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `folder_id` | VARCHAR(36) | yes | FK, IDX |  | → `document_folders.id` ON DELETE SET NULL |
| `name` | VARCHAR(255) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `file_name` | VARCHAR(255) | yes |  |  |  |
| `file_path` | VARCHAR(500) | yes |  |  |  |
| `file_size` | BIGINT | yes |  | `0` |  |
| `file_type` | VARCHAR(100) | yes |  |  |  |
| `document_type` | ENUM(`uploaded`, `generated`) | yes |  | `'uploaded'` |  |
| `status` | ENUM(`active`, `archived`) | no |  | `active` |  |
| `content_html` | LONGTEXT | yes |  |  |  |
| `source_type` | VARCHAR(50) | yes | IDX |  |  |
| `source_id` | VARCHAR(36) | yes |  |  |  |
| `version` | INTEGER | yes |  | `1` |  |
| `tags` | TEXT | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `uploaded_by` | VARCHAR(36) | yes | FK |  | → `users.id` |

**Indexes**

- `idx_documents_folder` (`folder_id`)
- `idx_documents_org_status` (`organization_id`, `status`)
- `ix_documents_source` (`source_type`, `source_id`)

## Elections

### `candidates`

**Candidate** · `app/models/election.py`

> Candidate model for election candidates Can represent existing members or write-in candidates.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `election_id` | VARCHAR(36) | no | FK, IDX |  | → `elections.id` ON DELETE CASCADE |
| `user_id` | VARCHAR(36) | yes | FK, IDX |  | → `users.id` ON DELETE SET NULL |
| `name` | VARCHAR(200) | no |  |  |  |
| `position` | VARCHAR(100) | yes | IDX |  |  |
| `statement` | TEXT | yes |  |  |  |
| `photo_url` | VARCHAR(500) | yes |  |  |  |
| `nomination_date` | DATETIME | no |  | `now()` |  |
| `nominated_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `accepted` | BOOL | no |  | `True` |  |
| `is_write_in` | BOOL | no |  | `False` |  |
| `merged_into_candidate_id` | VARCHAR(36) | yes |  |  |  |
| `display_order` | INTEGER | no |  | `0` |  |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_candidates_election_id` (`election_id`)
- `ix_candidates_position` (`position`)
- `ix_candidates_user_id` (`user_id`)

### `elections`

**Election** · `app/models/election.py`

> Election model for managing elections within an organization Supports various election types including officer elections, board elections, and general voting.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `title` | VARCHAR(200) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `election_type` | VARCHAR(50) | no |  | `'general'` |  |
| `positions` | JSON | yes |  |  |  |
| `ballot_items` | JSON | yes |  |  |  |
| `position_eligibility` | JSON | yes |  |  |  |
| `email_sent` | BOOL | no |  | `0` |  |
| `email_sent_at` | DATETIME | yes |  |  |  |
| `email_recipients` | JSON | yes |  |  |  |
| `meeting_date` | DATETIME | yes |  |  |  |
| `meeting_id` | VARCHAR(36) | yes | FK |  | → `meetings.id` ON DELETE SET NULL |
| `event_id` | VARCHAR(36) | yes | FK |  | → `events.id` ON DELETE SET NULL |
| `start_date` | DATETIME | no | IDX |  |  |
| `end_date` | DATETIME | no |  |  |  |
| `auto_open` | BOOL | no |  | `0` |  |
| `reminder_hours_before_close` | INTEGER | yes |  |  |  |
| `reminder_sent_at` | DATETIME | yes |  |  |  |
| `nomination_deadline` | DATETIME | yes |  |  |  |
| `status` | ENUM(`draft`, `nominations`, `open`, `closed`, `cancelled`) | no | IDX | `'draft'` |  |
| `anonymous_voting` | BOOL | no |  | `True` |  |
| `allow_write_ins` | BOOL | no |  | `False` |  |
| `max_votes_per_position` | INTEGER | no |  | `1` |  |
| `results_visible_immediately` | BOOL | no |  | `False` |  |
| `eligible_voters` | JSON | yes |  |  |  |
| `voting_method` | VARCHAR(50) | no |  | `simple_majority` |  |
| `victory_condition` | VARCHAR(50) | no |  | `most_votes` |  |
| `victory_threshold` | INTEGER | yes |  |  |  |
| `victory_percentage` | INTEGER | yes |  |  |  |
| `tie_policy` | VARCHAR(20) | no |  | `co_winners` |  |
| `eligible_roster_snapshot` | JSON | yes |  |  |  |
| `enable_runoffs` | BOOL | no |  | `0` |  |
| `runoff_type` | VARCHAR(50) | no |  | `top_two` |  |
| `max_runoff_rounds` | INTEGER | no |  | `3` |  |
| `is_runoff` | BOOL | no |  | `0` |  |
| `parent_election_id` | VARCHAR(36) | yes | FK |  | → `elections.id` |
| `runoff_round` | INTEGER | no |  | `0` |  |
| `voter_anonymity_salt` | VARCHAR(64) | yes |  |  |  |
| `attendees` | JSON | yes |  |  |  |
| `voter_overrides` | JSON | yes |  |  |  |
| `proxy_authorizations` | JSON | yes |  |  |  |
| `quorum_type` | VARCHAR(20) | no |  | `none` |  |
| `quorum_value` | INTEGER | yes |  |  |  |
| `last_chain_hash` | VARCHAR(64) | yes |  |  |  |
| `rollback_history` | JSON | yes |  |  |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_elections_dates` (`start_date`, `end_date`)
- `ix_elections_organization_id` (`organization_id`)
- `ix_elections_status` (`status`)

### `manual_ballot_attestations`

**ManualBallotAttestation** · `app/models/election.py`

> One officer's confirmation that a paper-tally batch matches the physical count. The unique constraint makes double-attestation by the same officer impossible at the DB level.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `batch_id` | VARCHAR(36) | no | FK |  | → `manual_ballot_batches.id` ON DELETE CASCADE |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `attested_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `attested_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_manual_ballot_attestations_organization_id` (`organization_id`)

**Constraints**

- UNIQUE `uq_batch_attester` (`batch_id`, `attested_by`)

### `manual_ballot_batches`

**ManualBallotBatch** · `app/models/election.py`

> One paper-tally entry — the set of manual votes sharing a batch id. The batch is the unit of officer attestation: when the organization requires N attestations, the batch starts ``pending`` and its votes are excluded from results and stats until N distinct officers (other than the recording officer) confirm the counts. ``voided`` mirrors the soft-deleted votes of a corrected batch.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `election_id` | VARCHAR(36) | no | FK, IDX |  | → `elections.id` ON DELETE CASCADE |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `recorded_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `notes` | TEXT | yes |  |  |  |
| `status` | VARCHAR(20) | no |  | `pending` |  |
| `required_attestations` | INTEGER | no |  | `0` |  |
| `created_at` | DATETIME | no |  | `now()` |  |
| `confirmed_at` | DATETIME | yes |  |  |  |

**Indexes**

- `ix_manual_ballot_batches_election_id` (`election_id`)
- `ix_manual_ballot_batches_organization_id` (`organization_id`)

### `votes`

**Vote** · `app/models/election.py`

> Vote model for recording votes Supports both anonymous and non-anonymous voting.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `election_id` | VARCHAR(36) | no | FK, IDX |  | → `elections.id` ON DELETE CASCADE |
| `candidate_id` | VARCHAR(36) | no | FK, IDX |  | → `candidates.id` ON DELETE CASCADE |
| `voter_id` | VARCHAR(36) | yes | FK, IDX |  | → `users.id` ON DELETE SET NULL |
| `voter_hash` | VARCHAR(64) | yes | IDX |  |  |
| `position` | VARCHAR(100) | yes |  |  |  |
| `vote_rank` | INTEGER | yes |  |  |  |
| `voted_at` | DATETIME | no |  | `now()` |  |
| `vote_signature` | VARCHAR(128) | yes |  |  |  |
| `vote_dedup_hash` | VARCHAR(64) | yes | UQ |  |  |
| `chain_hash` | VARCHAR(64) | yes |  |  |  |
| `receipt_hash` | VARCHAR(64) | yes |  |  |  |
| `is_test` | BOOL | no |  | `0` |  |
| `is_manual` | BOOL | no |  | `0` |  |
| `recorded_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `manual_batch_id` | VARCHAR(36) | yes | IDX |  |  |
| `is_proxy_vote` | BOOL | no | IDX | `0` |  |
| `proxy_voter_id` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `proxy_authorization_id` | VARCHAR(36) | yes |  |  |  |
| `proxy_delegating_user_id` | VARCHAR(36) | yes |  |  |  |
| `ip_address` | VARCHAR(45) | yes |  |  |  |
| `user_agent` | VARCHAR(500) | yes |  |  |  |
| `deleted_at` | DATETIME | yes | IDX |  |  |
| `deleted_by` | VARCHAR(36) | yes |  |  |  |
| `deletion_reason` | TEXT | yes |  |  |  |

**Indexes**

- `ix_votes_candidate_id` (`candidate_id`)
- `ix_votes_deleted_at` (`deleted_at`)
- `ix_votes_election_id` (`election_id`)
- `ix_votes_is_proxy_vote` (`is_proxy_vote`)
- `ix_votes_manual_batch_id` (`manual_batch_id`)
- `ix_votes_voter_hash` (`voter_hash`)
- `ix_votes_voter_id` (`voter_id`)

**Constraints**

- UNIQUE `uq_votes_vote_dedup_hash` (`vote_dedup_hash`)

### `voting_tokens`

**VotingToken** · `app/models/election.py`

> Voting token model for secure anonymous ballot access Each eligible voter receives a unique high-entropy token via email to access their ballot. Only the token's SHA-256 is stored (ELEC-5) — the raw value exists solely in the emailed link, so database read access never yields a live ballot credential. The token ensures anonymous voting while preventing duplicate votes.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `election_id` | VARCHAR(36) | no | FK, IDX |  | → `elections.id` ON DELETE CASCADE |
| `token` | VARCHAR(128) | no | UQ |  |  |
| `voter_hash` | VARCHAR(64) | no | IDX |  |  |
| `created_at` | DATETIME | no |  | `now()` |  |
| `expires_at` | DATETIME | no |  |  |  |
| `used` | BOOL | no |  | `0` |  |
| `used_at` | DATETIME | yes |  |  |  |
| `is_test` | BOOL | no |  | `0` |  |
| `eligible_item_ids` | JSON | yes |  |  |  |
| `eligible_positions` | JSON | yes |  |  |  |
| `first_accessed_at` | DATETIME | yes |  |  |  |
| `access_count` | INTEGER | no |  | `0` |  |
| `positions_voted` | JSON | yes |  |  |  |

**Indexes**

- `ix_voting_tokens_election_id` (`election_id`)
- `ix_voting_tokens_organization_id` (`organization_id`)
- `ix_voting_tokens_voter_hash` (`voter_hash`)

**Constraints**

- UNIQUE `uq_voting_tokens_token` (`token`)

## Email Templates

### `email_attachments`

**EmailAttachment** · `app/models/email_template.py`

> Stored attachment that can be included with email templates. Files are stored in the configured file storage (MinIO/S3).

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `template_id` | VARCHAR(36) | no | FK, IDX |  | → `email_templates.id` ON DELETE CASCADE |
| `filename` | VARCHAR(255) | no |  |  |  |
| `content_type` | VARCHAR(100) | no |  |  |  |
| `file_size` | VARCHAR(20) | yes |  |  |  |
| `storage_path` | VARCHAR(500) | no |  |  |  |
| `created_at` | DATETIME | no |  | `now()` |  |
| `uploaded_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |

**Indexes**

- `ix_email_attachments_template_id` (`template_id`)

### `email_templates`

**EmailTemplate** · `app/models/email_template.py`

> Configurable email template stored in the database. Admins can edit subject, body (HTML), and CSS styles. Templates support variable interpolation using {{variable_name}} syntax.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `template_type` | ENUM(`welcome`, `password_reset`, `event_cancellation`, `event_reminder`, `training_approval`, `ballot_notification`, `member_dropped`, `inventory_change`, `cert_expiration`, `post_event_validation`, `post_shift_validation`, `property_return_reminder`, `inactivity_warning`, `election_report`, `ballot_eligibility_summary`, `election_rollback`, `election_deleted`, `member_archived`, `event_request_status`, `it_password_notification`, `duplicate_application`, `series_end_reminder`, `shift_decline`, `shift_assignment`, `shift_reminder`, `storefront_order_confirmation`, `storefront_new_order_admin`, `storefront_order_update`, `storefront_order_cancelled`, `storefront_payment_reminder`, `storefront_payment_received`, `storefront_window_open`, `storefront_window_closing`, `storefront_window_closed`, `storefront_vendor_order_placed`, `custom`) | no |  |  |  |
| `name` | VARCHAR(255) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `subject` | VARCHAR(500) | no |  |  |  |
| `html_body` | TEXT | no |  |  |  |
| `text_body` | TEXT | yes |  |  |  |
| `css_styles` | TEXT | yes |  |  |  |
| `is_active` | BOOL | no |  | `1` |  |
| `allow_attachments` | BOOL | no |  | `0` |  |
| `default_cc` | JSON | yes |  |  |  |
| `default_bcc` | JSON | yes |  |  |  |
| `available_variables` | JSON | yes |  | `list()` |  |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `updated_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |

**Indexes**

- `idx_email_template_org_type` (`organization_id`, `template_type`)

### `message_history`

**MessageHistory** · `app/models/email_template.py`

> Log of every email sent by the application. Each row represents a single send attempt (one per recipient). Populated automatically by ``EmailService.send_email()``.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | yes | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `to_email` | VARCHAR(320) | no |  |  |  |
| `cc_emails` | JSON | yes |  |  |  |
| `bcc_emails` | JSON | yes |  |  |  |
| `subject` | VARCHAR(500) | no |  |  |  |
| `template_type` | VARCHAR(50) | yes |  |  |  |
| `status` | ENUM(`sent`, `failed`) | no | IDX | `sent` |  |
| `error_message` | TEXT | yes |  |  |  |
| `recipient_count` | INTEGER | no |  | `1` |  |
| `sent_at` | DATETIME | no |  | `now()` |  |
| `sent_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |

**Indexes**

- `idx_message_history_org` (`organization_id`, `sent_at`)
- `idx_message_history_status` (`status`, `sent_at`)

### `scheduled_emails`

**ScheduledEmail** · `app/models/email_template.py`

> An email scheduled to be sent at a future date/time. Processed by the ``process_scheduled_emails`` scheduled task which runs every 5 minutes.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `template_id` | VARCHAR(36) | yes | FK |  | → `email_templates.id` ON DELETE SET NULL |
| `template_type` | ENUM(`welcome`, `password_reset`, `event_cancellation`, `event_reminder`, `training_approval`, `ballot_notification`, `member_dropped`, `inventory_change`, `cert_expiration`, `post_event_validation`, `post_shift_validation`, `property_return_reminder`, `inactivity_warning`, `election_report`, `ballot_eligibility_summary`, `election_rollback`, `election_deleted`, `member_archived`, `event_request_status`, `it_password_notification`, `duplicate_application`, `series_end_reminder`, `shift_decline`, `shift_assignment`, `shift_reminder`, `storefront_order_confirmation`, `storefront_new_order_admin`, `storefront_order_update`, `storefront_order_cancelled`, `storefront_payment_reminder`, `storefront_payment_received`, `storefront_window_open`, `storefront_window_closing`, `storefront_window_closed`, `storefront_vendor_order_placed`, `custom`) | no |  |  |  |
| `to_emails` | JSON | no |  |  |  |
| `cc_emails` | JSON | yes |  |  |  |
| `bcc_emails` | JSON | yes |  |  |  |
| `context` | JSON | no |  | `dict()` |  |
| `scheduled_at` | DATETIME | no |  |  |  |
| `status` | ENUM(`pending`, `sent`, `failed`, `cancelled`) | no | IDX | `pending` |  |
| `sent_at` | DATETIME | yes |  |  |  |
| `error_message` | TEXT | yes |  |  |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `idx_scheduled_email_org` (`organization_id`, `status`)
- `idx_scheduled_email_status` (`status`, `scheduled_at`)

## Error Logging

### `error_logs`

**ErrorLog** · `app/models/error_log.py`

> Stores application error logs for monitoring

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | IDX |  |  |
| `error_type` | VARCHAR(50) | no |  |  |  |
| `error_message` | TEXT | no |  |  |  |
| `user_message` | TEXT | yes |  |  |  |
| `troubleshooting_steps` | JSON | yes |  | `list()` |  |
| `context` | JSON | yes |  | `dict()` |  |
| `user_id` | VARCHAR(36) | yes |  |  |  |
| `event_id` | VARCHAR(36) | yes |  |  |  |
| `created_at` | DATETIME | yes | IDX | `now()` |  |

**Indexes**

- `ix_error_logs_created` (`created_at`)
- `ix_error_logs_org_type` (`organization_id`, `error_type`)

## Event Requests

### `event_request_activity`

**EventRequestActivity** · `app/models/event_request.py`

> Audit trail for event request pipeline actions. Records every status change, task completion, note, and action taken on a request.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `request_id` | VARCHAR(36) | no | FK, IDX |  | → `event_requests.id` ON DELETE CASCADE |
| `action` | VARCHAR(100) | no |  |  |  |
| `old_status` | VARCHAR(50) | yes |  |  |  |
| `new_status` | VARCHAR(50) | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `details` | JSON | yes |  |  |  |
| `performed_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_event_req_activity_request` (`request_id`)

### `event_request_email_templates`

**EventRequestEmailTemplate** · `app/models/event_request.py`

> Reusable email templates for the event request pipeline. Departments can store common messages (e.g., directions to the station, volunteer signup instructions) and attach them to email triggers or send them manually.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(200) | no |  |  |  |
| `subject` | VARCHAR(500) | no |  |  |  |
| `body_html` | TEXT | no |  |  |  |
| `body_text` | TEXT | yes |  |  |  |
| `trigger` | VARCHAR(100) | yes |  |  |  |
| `trigger_days_before` | INTEGER | yes |  |  |  |
| `is_active` | BOOL | no |  | `True` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_email_tpl_org` (`organization_id`)

### `event_requests`

**EventRequest** · `app/models/event_request.py`

> Public outreach event request. Created when a community member submits a request for the department to host or participate in a public event. Flows through a review pipeline before optionally being converted into an actual Event.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `contact_name` | VARCHAR(255) | no |  |  |  |
| `contact_email` | VARCHAR(255) | no |  |  |  |
| `contact_phone` | VARCHAR(50) | yes |  |  |  |
| `organization_name` | VARCHAR(255) | yes |  |  |  |
| `outreach_type` | VARCHAR(100) | no |  | `'other'` |  |
| `description` | TEXT | no |  |  |  |
| `date_flexibility` | VARCHAR(30) | no |  | `'flexible'` |  |
| `preferred_date_start` | DATETIME | yes |  |  |  |
| `preferred_date_end` | DATETIME | yes |  |  |  |
| `preferred_timeframe` | VARCHAR(500) | yes |  |  |  |
| `preferred_time_of_day` | VARCHAR(20) | yes |  | `'flexible'` |  |
| `audience_size` | INTEGER | yes |  |  |  |
| `age_group` | VARCHAR(100) | yes |  |  |  |
| `venue_preference` | VARCHAR(20) | no |  | `'their_location'` |  |
| `venue_address` | TEXT | yes |  |  |  |
| `special_requests` | TEXT | yes |  |  |  |
| `status` | ENUM(`submitted`, `in_progress`, `scheduled`, `postponed`, `completed`, `declined`, `cancelled`) | no | IDX | `'submitted'` |  |
| `assigned_to` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `reviewer_notes` | TEXT | yes |  |  |  |
| `decline_reason` | TEXT | yes |  |  |  |
| `event_date` | DATETIME | yes |  |  |  |
| `event_end_date` | DATETIME | yes |  |  |  |
| `event_location_id` | VARCHAR(36) | yes | FK |  | → `locations.id` ON DELETE SET NULL |
| `task_completions` | JSON | yes |  | `dict()` |  |
| `event_id` | VARCHAR(36) | yes | FK |  | → `events.id` ON DELETE SET NULL |
| `status_token` | VARCHAR(64) | yes | UQ, UQ-IDX | `generate_status_token()` |  |
| `form_submission_id` | VARCHAR(36) | yes | FK |  | → `form_submissions.id` ON DELETE SET NULL |
| `ip_address` | VARCHAR(45) | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_event_request_org_status` (`organization_id`, `status`)
- `idx_event_request_org_type` (`organization_id`, `outreach_type`)
- `ix_event_requests_status` (`status`)
- UNIQUE `ix_event_requests_status_token` (`status_token`)

## Events

### `event_external_attendees`

**EventExternalAttendee** · `app/models/event.py`

> External (non-member) attendee at an event. Used primarily for public outreach events (public education, fundraisers, ceremonies) where community members attend but are not system users. Can be auto-created from public form submissions via Forms → Events integration.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `event_id` | VARCHAR(36) | no | FK, IDX |  | → `events.id` ON DELETE CASCADE |
| `name` | VARCHAR(255) | no |  |  |  |
| `email` | VARCHAR(255) | yes | IDX |  |  |
| `phone` | VARCHAR(50) | yes |  |  |  |
| `organization_name` | VARCHAR(255) | yes |  |  |  |
| `checked_in` | BOOL | no |  | `0` |  |
| `checked_in_at` | DATETIME | yes |  |  |  |
| `source` | VARCHAR(50) | yes |  |  |  |
| `source_id` | VARCHAR(36) | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `prospect_id` | VARCHAR(36) | yes | FK, IDX |  | → `prospective_members.id` ON DELETE SET NULL |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | yes |  |  |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `updated_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |

**Indexes**

- `ix_ext_attendees_email` (`email`)
- `ix_ext_attendees_event_id` (`event_id`)
- `ix_ext_attendees_org_id` (`organization_id`)
- `ix_ext_attendees_prospect_id` (`prospect_id`)

### `event_rsvps`

**EventRSVP** · `app/models/event.py`

> Event RSVP model for tracking attendance Tracks member responses to event invitations.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `event_id` | VARCHAR(36) | no | FK, UQ-IDX |  | → `events.id` ON DELETE CASCADE |
| `user_id` | VARCHAR(36) | no | FK, IDX |  | → `users.id` ON DELETE CASCADE |
| `status` | ENUM(`going`, `not_going`, `maybe`, `waitlisted`) | no |  | `going` |  |
| `guest_count` | INTEGER | no |  | `0` |  |
| `notes` | TEXT | yes |  |  |  |
| `dietary_restrictions` | VARCHAR(500) | yes |  |  |  |
| `accessibility_needs` | VARCHAR(500) | yes |  |  |  |
| `responded_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |
| `checked_in` | BOOL | no |  | `0` |  |
| `checked_in_at` | DATETIME | yes |  |  |  |
| `checked_out_at` | DATETIME | yes |  |  |  |
| `attendance_duration_minutes` | INTEGER | yes |  |  |  |
| `override_check_in_at` | DATETIME | yes |  |  |  |
| `override_check_out_at` | DATETIME | yes |  |  |  |
| `override_duration_minutes` | INTEGER | yes |  |  |  |
| `overridden_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `overridden_at` | DATETIME | yes |  |  |  |

**Indexes**

- UNIQUE `ix_event_rsvps_event_user` (`event_id`, `user_id`)
- `ix_event_rsvps_organization_id` (`organization_id`)
- `ix_event_rsvps_user_id` (`user_id`)

### `event_templates`

**EventTemplate** · `app/models/event.py`

> Event Template model for reusable event configurations Allows departments to create templates for events they run regularly (e.g., weekly meetings, annual holiday events, recurring trainings). Templates store the event structure without specific dates.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(200) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `event_type` | ENUM(`business_meeting`, `public_education`, `training`, `social`, `fundraiser`, `ceremony`, `other`) | no |  | `other` |  |
| `default_title` | VARCHAR(200) | yes |  |  |  |
| `default_description` | TEXT | yes |  |  |  |
| `default_location_id` | VARCHAR(36) | yes | FK |  | → `locations.id` |
| `default_location` | VARCHAR(300) | yes |  |  |  |
| `default_location_details` | TEXT | yes |  |  |  |
| `default_duration_minutes` | INTEGER | yes |  |  |  |
| `requires_rsvp` | BOOL | no |  | `0` |  |
| `max_attendees` | INTEGER | yes |  |  |  |
| `is_mandatory` | BOOL | no |  | `0` |  |
| `allow_guests` | BOOL | no |  | `0` |  |
| `check_in_window_type` | ENUM(`flexible`, `strict`, `window`) | yes |  |  |  |
| `check_in_minutes_before` | INTEGER | yes |  | `30` |  |
| `check_in_minutes_after` | INTEGER | yes |  | `15` |  |
| `require_checkout` | BOOL | no |  | `0` |  |
| `send_reminders` | BOOL | no |  | `1` |  |
| `reminder_schedule` | JSON | no |  | generated |  |
| `custom_fields_template` | JSON | yes |  |  |  |
| `is_active` | BOOL | no |  | `1` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `updated_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_event_templates_organization_id` (`organization_id`)

### `events`

**Event** · `app/models/event.py`

> Event model for managing department events Supports various event types including meetings, training, public education, and social events.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `title` | VARCHAR(200) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `event_type` | ENUM(`business_meeting`, `public_education`, `training`, `social`, `fundraiser`, `ceremony`, `other`) | no | IDX | `other` |  |
| `custom_category` | VARCHAR(100) | yes | IDX |  |  |
| `location_id` | VARCHAR(36) | yes | FK, IDX |  | → `locations.id` |
| `location` | VARCHAR(300) | yes |  |  |  |
| `location_details` | TEXT | yes |  |  |  |
| `start_datetime` | DATETIME | no | IDX |  |  |
| `end_datetime` | DATETIME | no |  |  |  |
| `actual_start_time` | DATETIME | yes |  |  |  |
| `actual_end_time` | DATETIME | yes |  |  |  |
| `requires_rsvp` | BOOL | no |  | `0` |  |
| `rsvp_deadline` | DATETIME | yes |  |  |  |
| `max_attendees` | INTEGER | yes |  |  |  |
| `allowed_rsvp_statuses` | JSON | yes |  |  |  |
| `is_mandatory` | BOOL | no |  | `0` |  |
| `allow_guests` | BOOL | no |  | `0` |  |
| `send_reminders` | BOOL | no |  | `1` |  |
| `reminder_schedule` | JSON | no |  | generated |  |
| `check_in_window_type` | ENUM(`flexible`, `strict`, `window`) | no |  | `flexible` |  |
| `check_in_minutes_before` | INTEGER | yes |  | `30` |  |
| `check_in_minutes_after` | INTEGER | yes |  | `15` |  |
| `require_checkout` | BOOL | no |  | `0` |  |
| `allow_guest_check_in` | BOOL | no |  | `0` |  |
| `guest_check_in_creates_prospect` | BOOL | no |  | `0` |  |
| `is_recurring` | BOOL | no |  | `0` |  |
| `recurrence_pattern` | ENUM(`daily`, `weekly`, `biweekly`, `monthly`, `monthly_weekday`, `annually`, `annually_weekday`, `custom`) | yes |  |  |  |
| `recurrence_end_date` | DATETIME | yes |  |  |  |
| `recurrence_custom_days` | JSON | yes |  |  |  |
| `recurrence_weekday` | INTEGER | yes |  |  |  |
| `recurrence_week_ordinal` | INTEGER | yes |  |  |  |
| `recurrence_month` | INTEGER | yes |  |  |  |
| `recurrence_exceptions` | JSON | yes |  |  |  |
| `rolling_recurrence` | BOOL | no |  | `0` |  |
| `recurrence_parent_id` | VARCHAR(36) | yes | FK, IDX |  | → `events.id` |
| `template_id` | VARCHAR(36) | yes | FK |  | → `event_templates.id` |
| `custom_fields` | JSON | yes |  |  |  |
| `attachments` | JSON | yes |  |  |  |
| `is_draft` | BOOL | yes |  | `0` |  |
| `is_cancelled` | BOOL | no |  | `0` |  |
| `cancellation_reason` | TEXT | yes |  |  |  |
| `cancelled_at` | DATETIME | yes |  |  |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `updated_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_events_custom_category` (`custom_category`)
- `ix_events_event_type` (`event_type`)
- `ix_events_location_id` (`location_id`)
- `ix_events_organization_id` (`organization_id`)
- `ix_events_recurrence_parent_id` (`recurrence_parent_id`)
- `ix_events_start_datetime` (`start_datetime`)

### `rsvp_history`

**RSVPHistory** · `app/models/event.py`

> RSVP History model for tracking RSVP status changes. Records each status change for audit and activity tracking purposes.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `rsvp_id` | VARCHAR(36) | no | FK, IDX |  | → `event_rsvps.id` ON DELETE CASCADE |
| `event_id` | VARCHAR(36) | no | FK, IDX |  | → `events.id` ON DELETE CASCADE |
| `user_id` | VARCHAR(36) | no | FK, IDX |  | → `users.id` ON DELETE CASCADE |
| `old_status` | VARCHAR(20) | yes |  |  |  |
| `new_status` | VARCHAR(20) | no |  |  |  |
| `changed_at` | DATETIME | no | IDX | `now()` |  |
| `changed_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |

**Indexes**

- `ix_rsvp_history_changed_at` (`changed_at`)
- `ix_rsvp_history_event_id` (`event_id`)
- `ix_rsvp_history_rsvp_id` (`rsvp_id`)
- `ix_rsvp_history_user_id` (`user_id`)

## Facilities

### `facilities`

**Facility** · `app/models/facilities.py`

> Main facility model for tracking buildings, stations, and properties.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, UQ-IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(200) | no |  |  |  |
| `facility_number` | VARCHAR(50) | yes |  |  |  |
| `facility_type_id` | VARCHAR(36) | no | FK, IDX |  | → `facility_types.id` |
| `status_id` | VARCHAR(36) | no | FK, IDX |  | → `facility_statuses.id` |
| `address_line1` | VARCHAR(200) | yes |  |  |  |
| `address_line2` | VARCHAR(200) | yes |  |  |  |
| `city` | VARCHAR(100) | yes |  |  |  |
| `state` | VARCHAR(50) | yes |  |  |  |
| `zip_code` | VARCHAR(20) | yes |  |  |  |
| `county` | VARCHAR(100) | yes |  |  |  |
| `latitude` | NUMERIC(10, 7) | yes |  |  |  |
| `longitude` | NUMERIC(10, 7) | yes |  |  |  |
| `year_built` | INTEGER | yes |  |  |  |
| `year_renovated` | INTEGER | yes |  |  |  |
| `square_footage` | INTEGER | yes |  |  |  |
| `num_floors` | INTEGER | yes |  |  |  |
| `num_bays` | INTEGER | yes |  |  |  |
| `lot_size_acres` | NUMERIC(10, 2) | yes |  |  |  |
| `is_owned` | BOOL | no |  | `1` |  |
| `lease_expiration` | DATE | yes |  |  |  |
| `property_tax_id` | VARCHAR(100) | yes |  |  |  |
| `max_occupancy` | INTEGER | yes |  |  |  |
| `sleeping_quarters` | INTEGER | yes |  |  |  |
| `phone` | VARCHAR(50) | yes |  |  |  |
| `fax` | VARCHAR(50) | yes |  |  |  |
| `email` | VARCHAR(200) | yes |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `status_changed_at` | DATETIME | yes |  |  |  |
| `status_changed_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `is_archived` | BOOL | no | IDX | `0` |  |
| `archived_at` | DATETIME | yes |  |  |  |
| `archived_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_facilities_archived` (`is_archived`)
- UNIQUE `idx_facilities_org_number` (`organization_id`, `facility_number`)
- `idx_facilities_org_status` (`organization_id`, `status_id`)
- `idx_facilities_org_type` (`organization_id`, `facility_type_id`)
- `ix_facilities_facility_type_id` (`facility_type_id`)
- `ix_facilities_status_id` (`status_id`)

### `facility_access_keys`

**FacilityAccessKey** · `app/models/facilities.py`

> Keys, fobs, codes, and access credentials for a facility

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `facility_id` | VARCHAR(36) | no | FK, IDX |  | → `facilities.id` ON DELETE CASCADE |
| `key_type` | ENUM(`physical_key`, `fob`, `access_code`, `key_card`, `biometric`, `combination`, `other`) | no | IDX |  |  |
| `key_identifier` | VARCHAR(100) | yes |  |  |  |
| `description` | VARCHAR(300) | yes |  |  |  |
| `assigned_to_user_id` | VARCHAR(36) | yes | FK, IDX |  | → `users.id` ON DELETE SET NULL |
| `assigned_to_name` | VARCHAR(200) | yes |  |  |  |
| `issued_date` | DATE | yes |  |  |  |
| `returned_date` | DATE | yes |  |  |  |
| `is_active` | BOOL | no |  | `1` |  |
| `notes` | TEXT | yes |  |  |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_facility_access_keys_facility` (`facility_id`)
- `idx_facility_access_keys_type` (`key_type`)
- `idx_facility_access_keys_user` (`assigned_to_user_id`)
- `ix_facility_access_keys_organization_id` (`organization_id`)

### `facility_capital_projects`

**FacilityCapitalProject** · `app/models/facilities.py`

> Capital improvement and renovation projects for a facility

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `facility_id` | VARCHAR(36) | no | FK, IDX |  | → `facilities.id` ON DELETE CASCADE |
| `project_name` | VARCHAR(300) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `project_type` | ENUM(`renovation`, `new_construction`, `repair`, `upgrade`, `expansion`, `demolition`, `environmental`, `ada_compliance`, `other`) | no | IDX | `'other'` |  |
| `project_status` | ENUM(`planning`, `approved`, `bidding`, `in_progress`, `on_hold`, `completed`, `cancelled`) | no | IDX | `'planning'` |  |
| `estimated_cost` | NUMERIC(12, 2) | yes |  |  |  |
| `actual_cost` | NUMERIC(12, 2) | yes |  |  |  |
| `budget_source` | VARCHAR(300) | yes |  |  |  |
| `start_date` | DATE | yes |  |  |  |
| `estimated_completion` | DATE | yes |  |  |  |
| `actual_completion` | DATE | yes |  |  |  |
| `contractor_name` | VARCHAR(200) | yes |  |  |  |
| `contractor_phone` | VARCHAR(50) | yes |  |  |  |
| `contractor_email` | VARCHAR(200) | yes |  |  |  |
| `project_manager` | VARCHAR(200) | yes |  |  |  |
| `permit_numbers` | TEXT | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `attachments` | JSON | yes |  |  |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_facility_capital_facility` (`facility_id`)
- `idx_facility_capital_status` (`project_status`)
- `idx_facility_capital_type` (`project_type`)
- `ix_facility_capital_projects_organization_id` (`organization_id`)

### `facility_compliance_checklists`

**FacilityComplianceChecklist** · `app/models/facilities.py`

> Regulatory/compliance checklists for a facility

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `facility_id` | VARCHAR(36) | no | FK, IDX |  | → `facilities.id` ON DELETE CASCADE |
| `checklist_name` | VARCHAR(300) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `compliance_type` | ENUM(`ada`, `fire_code`, `building_code`, `health`, `environmental`, `osha`, `nfpa`, `other`) | no | IDX |  |  |
| `due_date` | DATE | yes | IDX |  |  |
| `completed_date` | DATE | yes |  |  |  |
| `completed_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `is_completed` | BOOL | no | IDX | `0` |  |
| `notes` | TEXT | yes |  |  |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_facility_compliance_completed` (`is_completed`)
- `idx_facility_compliance_due` (`due_date`)
- `idx_facility_compliance_facility` (`facility_id`)
- `idx_facility_compliance_type` (`compliance_type`)
- `ix_facility_compliance_checklists_organization_id` (`organization_id`)

### `facility_compliance_items`

**FacilityComplianceItem** · `app/models/facilities.py`

> Individual items within a compliance checklist

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `checklist_id` | VARCHAR(36) | no | FK, IDX |  | → `facility_compliance_checklists.id` ON DELETE CASCADE |
| `item_number` | INTEGER | yes |  |  |  |
| `description` | TEXT | no |  |  |  |
| `is_compliant` | BOOL | yes |  |  |  |
| `findings` | TEXT | yes |  |  |  |
| `corrective_action` | TEXT | yes |  |  |  |
| `corrective_action_deadline` | DATE | yes |  |  |  |
| `corrective_action_completed` | BOOL | no |  | `0` |  |
| `notes` | TEXT | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_facility_compliance_items_checklist` (`checklist_id`)
- `ix_facility_compliance_items_organization_id` (`organization_id`)

### `facility_documents`

**FacilityDocument** · `app/models/facilities.py`

> Documents associated with a facility (blueprints, permits, leases, etc.)

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `facility_id` | VARCHAR(36) | no | FK, IDX |  | → `facilities.id` ON DELETE CASCADE |
| `file_path` | VARCHAR(500) | no |  |  |  |
| `file_name` | VARCHAR(200) | no |  |  |  |
| `mime_type` | VARCHAR(100) | yes |  |  |  |
| `document_type` | VARCHAR(100) | yes | IDX |  |  |
| `description` | TEXT | yes |  |  |  |
| `document_date` | DATE | yes |  |  |  |
| `expiration_date` | DATE | yes | IDX |  |  |
| `uploaded_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `uploaded_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_facility_documents_expiration` (`expiration_date`)
- `idx_facility_documents_facility` (`facility_id`)
- `idx_facility_documents_type` (`document_type`)
- `ix_facility_documents_organization_id` (`organization_id`)

### `facility_emergency_contacts`

**FacilityEmergencyContact** · `app/models/facilities.py`

> Emergency/vendor contacts for a facility (alarm company, plumber, etc.)

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `facility_id` | VARCHAR(36) | no | FK, IDX |  | → `facilities.id` ON DELETE CASCADE |
| `contact_type` | ENUM(`utility_provider`, `alarm_company`, `elevator_service`, `plumber`, `electrician`, `hvac_service`, `locksmith`, `general_contractor`, `fire_protection`, `pest_control`, `roofing`, `janitorial`, `other`) | no | IDX |  |  |
| `company_name` | VARCHAR(200) | no |  |  |  |
| `contact_name` | VARCHAR(200) | yes |  |  |  |
| `phone` | VARCHAR(50) | yes |  |  |  |
| `alt_phone` | VARCHAR(50) | yes |  |  |  |
| `email` | VARCHAR(200) | yes |  |  |  |
| `service_contract_number` | VARCHAR(100) | yes |  |  |  |
| `priority` | INTEGER | no |  | `1` |  |
| `notes` | TEXT | yes |  |  |  |
| `is_active` | BOOL | no |  | `1` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_facility_emerg_contacts_facility` (`facility_id`)
- `idx_facility_emerg_contacts_type` (`contact_type`)
- `ix_facility_emergency_contacts_organization_id` (`organization_id`)

### `facility_inspections`

**FacilityInspection** · `app/models/facilities.py`

> Inspection records for facilities — fire inspections, building code, ADA compliance, insurance, etc.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `facility_id` | VARCHAR(36) | no | FK, IDX |  | → `facilities.id` ON DELETE CASCADE |
| `inspection_type` | ENUM(`fire`, `building_code`, `health`, `ada`, `environmental`, `insurance`, `routine`, `other`) | no | IDX | `'routine'` |  |
| `title` | VARCHAR(300) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `inspection_date` | DATE | no | IDX |  |  |
| `next_inspection_date` | DATE | yes | IDX |  |  |
| `passed` | BOOL | yes | IDX |  |  |
| `inspector_name` | VARCHAR(200) | yes |  |  |  |
| `inspector_organization` | VARCHAR(200) | yes |  |  |  |
| `certificate_number` | VARCHAR(100) | yes |  |  |  |
| `inspector_license_number` | VARCHAR(100) | yes |  |  |  |
| `inspector_agency` | VARCHAR(200) | yes |  |  |  |
| `findings` | TEXT | yes |  |  |  |
| `corrective_actions` | TEXT | yes |  |  |  |
| `corrective_action_deadline` | DATE | yes |  |  |  |
| `corrective_action_completed` | BOOL | no |  | `0` |  |
| `corrective_action_completed_date` | DATE | yes |  |  |  |
| `attachments` | JSON | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_facility_inspections_date` (`inspection_date`)
- `idx_facility_inspections_facility` (`facility_id`)
- `idx_facility_inspections_next` (`next_inspection_date`)
- `idx_facility_inspections_passed` (`passed`)
- `idx_facility_inspections_type` (`inspection_type`)
- `ix_facility_inspections_organization_id` (`organization_id`)

### `facility_insurance_policies`

**FacilityInsurancePolicy** · `app/models/facilities.py`

> Insurance policies covering a facility

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `facility_id` | VARCHAR(36) | no | FK, IDX |  | → `facilities.id` ON DELETE CASCADE |
| `policy_type` | ENUM(`property`, `liability`, `flood`, `earthquake`, `workers_comp`, `umbrella`, `equipment`, `other`) | no | IDX |  |  |
| `policy_number` | VARCHAR(100) | yes |  |  |  |
| `carrier_name` | VARCHAR(200) | no |  |  |  |
| `agent_name` | VARCHAR(200) | yes |  |  |  |
| `agent_phone` | VARCHAR(50) | yes |  |  |  |
| `agent_email` | VARCHAR(200) | yes |  |  |  |
| `coverage_amount` | NUMERIC(14, 2) | yes |  |  |  |
| `deductible` | NUMERIC(10, 2) | yes |  |  |  |
| `annual_premium` | NUMERIC(10, 2) | yes |  |  |  |
| `effective_date` | DATE | yes |  |  |  |
| `expiration_date` | DATE | yes | IDX |  |  |
| `notes` | TEXT | yes |  |  |  |
| `attachments` | JSON | yes |  |  |  |
| `is_active` | BOOL | no |  | `1` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_facility_insurance_expiration` (`expiration_date`)
- `idx_facility_insurance_facility` (`facility_id`)
- `idx_facility_insurance_type` (`policy_type`)
- `ix_facility_insurance_policies_organization_id` (`organization_id`)

### `facility_maintenance`

**FacilityMaintenance** · `app/models/facilities.py`

> Maintenance records for facilities. Tracks scheduled and unscheduled maintenance, repairs, inspections, and renovations. Supports historic back-dated entries.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `facility_id` | VARCHAR(36) | no | FK, IDX |  | → `facilities.id` ON DELETE CASCADE |
| `maintenance_type_id` | VARCHAR(36) | no | FK, IDX |  | → `facility_maintenance_types.id` |
| `system_id` | VARCHAR(36) | yes | FK, IDX |  | → `facility_systems.id` ON DELETE SET NULL |
| `scheduled_date` | DATE | yes |  |  |  |
| `due_date` | DATE | yes | IDX |  |  |
| `completed_date` | DATE | yes |  |  |  |
| `completed_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `performed_by` | VARCHAR(200) | yes |  |  |  |
| `is_completed` | BOOL | no | IDX | `0` |  |
| `is_overdue` | BOOL | no | IDX | `0` |  |
| `description` | TEXT | yes |  |  |  |
| `work_performed` | TEXT | yes |  |  |  |
| `findings` | TEXT | yes |  |  |  |
| `cost` | NUMERIC(10, 2) | yes |  |  |  |
| `vendor` | VARCHAR(200) | yes |  |  |  |
| `invoice_number` | VARCHAR(100) | yes |  |  |  |
| `work_order_number` | VARCHAR(100) | yes |  |  |  |
| `next_due_date` | DATE | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `attachments` | JSON | yes |  |  |  |
| `is_historic` | BOOL | no | IDX | `0` |  |
| `occurred_date` | DATE | yes | IDX |  |  |
| `historic_source` | VARCHAR(200) | yes |  |  |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_facility_maint_completed` (`is_completed`)
- `idx_facility_maint_due_date` (`due_date`)
- `idx_facility_maint_facility` (`facility_id`)
- `idx_facility_maint_historic` (`is_historic`)
- `idx_facility_maint_occurred` (`occurred_date`)
- `idx_facility_maint_overdue` (`is_overdue`)
- `idx_facility_maint_system` (`system_id`)
- `idx_facility_maint_type` (`maintenance_type_id`)
- `ix_facility_maintenance_organization_id` (`organization_id`)

### `facility_maintenance_types`

**FacilityMaintenanceType** · `app/models/facilities.py`

> Types of maintenance work that can be performed on facilities. Organizations get defaults and can add custom ones. System types (is_system=True) have organization_id=NULL.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | yes | FK, UQ-IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(200) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `category` | ENUM(`preventive`, `repair`, `inspection`, `renovation`, `cleaning`, `safety`, `other`) | yes |  | `'other'` |  |
| `default_interval_value` | INTEGER | yes |  |  |  |
| `default_interval_unit` | ENUM(`days`, `weeks`, `months`, `years`) | yes |  |  |  |
| `is_system` | BOOL | no |  | `0` |  |
| `is_active` | BOOL | no |  | `1` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- UNIQUE `idx_facility_maint_types_org_name` (`organization_id`, `name`)

### `facility_occupants`

**FacilityOccupant** · `app/models/facilities.py`

> Units, crews, or teams assigned to a facility

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `facility_id` | VARCHAR(36) | no | FK, IDX |  | → `facilities.id` ON DELETE CASCADE |
| `unit_name` | VARCHAR(200) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `contact_name` | VARCHAR(200) | yes |  |  |  |
| `contact_phone` | VARCHAR(50) | yes |  |  |  |
| `effective_date` | DATE | yes |  |  |  |
| `end_date` | DATE | yes |  |  |  |
| `is_active` | BOOL | no | IDX | `1` |  |
| `notes` | TEXT | yes |  |  |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_facility_occupants_active` (`is_active`)
- `idx_facility_occupants_facility` (`facility_id`)
- `ix_facility_occupants_organization_id` (`organization_id`)

### `facility_photos`

**FacilityPhoto** · `app/models/facilities.py`

> Photos associated with a facility

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `facility_id` | VARCHAR(36) | no | FK, IDX |  | → `facilities.id` ON DELETE CASCADE |
| `file_path` | VARCHAR(500) | no |  |  |  |
| `file_name` | VARCHAR(200) | no |  |  |  |
| `mime_type` | VARCHAR(100) | yes |  |  |  |
| `caption` | VARCHAR(500) | yes |  |  |  |
| `is_primary` | BOOL | no |  | `0` |  |
| `uploaded_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `uploaded_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_facility_photos_facility` (`facility_id`)
- `ix_facility_photos_organization_id` (`organization_id`)

### `facility_rooms`

**FacilityRoom** · `app/models/facilities.py`

> Individual rooms and spaces within a facility

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `facility_id` | VARCHAR(36) | no | FK, IDX |  | → `facilities.id` ON DELETE CASCADE |
| `name` | VARCHAR(200) | no |  |  |  |
| `room_number` | VARCHAR(50) | yes |  |  |  |
| `floor` | INTEGER | yes |  |  |  |
| `room_type` | ENUM(`apparatus_bay`, `bunk_room`, `kitchen`, `bathroom`, `office`, `training_room`, `storage`, `mechanical`, `lobby`, `common_area`, `laundry`, `gym`, `decontamination`, `dispatch`, `other`) | no | IDX | `'other'` |  |
| `zone_classification` | ENUM(`hot`, `transition`, `cold`, `unclassified`) | no |  | `unclassified` |  |
| `square_footage` | INTEGER | yes |  |  |  |
| `capacity` | INTEGER | yes |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `equipment` | TEXT | yes |  |  |  |
| `sort_order` | INTEGER | yes |  | `0` |  |
| `is_active` | BOOL | no |  | `1` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `updated_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_facility_rooms_floor` (`facility_id`, `floor`)
- `idx_facility_rooms_type` (`room_type`)
- `ix_facility_rooms_organization_id` (`organization_id`)

### `facility_shutoff_locations`

**FacilityShutoffLocation** · `app/models/facilities.py`

> Utility shutoff locations within a facility (water main, gas main, etc.)

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `facility_id` | VARCHAR(36) | no | FK, IDX |  | → `facilities.id` ON DELETE CASCADE |
| `shutoff_type` | ENUM(`water_main`, `gas_main`, `electrical_main`, `fire_suppression`, `hvac`, `irrigation`, `other`) | no | IDX |  |  |
| `location_description` | TEXT | no |  |  |  |
| `floor` | INTEGER | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `photo_path` | VARCHAR(500) | yes |  |  |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_facility_shutoffs_facility` (`facility_id`)
- `idx_facility_shutoffs_type` (`shutoff_type`)
- `ix_facility_shutoff_locations_organization_id` (`organization_id`)

### `facility_statuses`

**FacilityStatus** · `app/models/facilities.py`

> Facility statuses (e.g. Operational, Under Renovation). Organizations get defaults and can add custom ones. System statuses (is_system=True) have organization_id=NULL.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | yes | FK, UQ-IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(100) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `color` | VARCHAR(7) | yes |  |  |  |
| `is_operational` | BOOL | no |  | `1` |  |
| `is_system` | BOOL | no |  | `0` |  |
| `is_active` | BOOL | no |  | `1` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- UNIQUE `idx_facility_statuses_org_name` (`organization_id`, `name`)

### `facility_systems`

**FacilitySystem** · `app/models/facilities.py`

> Segments a facility into logical building systems (HVAC, electrical, plumbing, etc.) for targeted maintenance and inspection tracking.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `facility_id` | VARCHAR(36) | no | FK, IDX |  | → `facilities.id` ON DELETE CASCADE |
| `name` | VARCHAR(200) | no |  |  |  |
| `system_type` | ENUM(`hvac`, `electrical`, `plumbing`, `fire_suppression`, `fire_alarm`, `security`, `roofing`, `structural`, `elevator`, `generator`, `communications`, `doors_windows`, `flooring`, `painting`, `landscaping`, `parking`, `exhaust_extraction`, `cascade_air`, `decontamination`, `bay_door`, `air_quality_monitor`, `ppe_cleaning`, `alerting_system`, `shore_power`, `other`) | no |  | `'other'` |  |
| `description` | TEXT | yes |  |  |  |
| `manufacturer` | VARCHAR(200) | yes |  |  |  |
| `model_number` | VARCHAR(100) | yes |  |  |  |
| `serial_number` | VARCHAR(100) | yes |  |  |  |
| `install_date` | DATE | yes |  |  |  |
| `warranty_expiration` | DATE | yes |  |  |  |
| `expected_life_years` | INTEGER | yes |  |  |  |
| `condition` | ENUM(`excellent`, `good`, `fair`, `poor`, `critical`) | no | IDX | `'good'` |  |
| `last_serviced_date` | DATE | yes |  |  |  |
| `last_inspected_date` | DATE | yes |  |  |  |
| `last_tested_date` | DATE | yes |  |  |  |
| `next_test_due` | DATE | yes |  |  |  |
| `test_result` | VARCHAR(50) | yes |  |  |  |
| `certification_number` | VARCHAR(100) | yes |  |  |  |
| `certified_by` | VARCHAR(200) | yes |  |  |  |
| `test_frequency_days` | INTEGER | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `sort_order` | INTEGER | yes |  | `0` |  |
| `is_active` | BOOL | no |  | `1` |  |
| `archived_at` | DATETIME | yes |  |  |  |
| `archived_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_facility_systems_condition` (`condition`)
- `idx_facility_systems_type` (`facility_id`, `system_type`)
- `ix_facility_systems_organization_id` (`organization_id`)

### `facility_types`

**FacilityType** · `app/models/facilities.py`

> Facility types (e.g. Fire Station, Meeting Hall, Training Center). Organizations get default types on creation and can add custom ones. System types (is_system=True) have organization_id=NULL.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | yes | FK, UQ-IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(100) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `category` | ENUM(`station`, `training`, `administration`, `storage`, `meeting_hall`, `community`, `other`) | yes |  | `'other'` |  |
| `is_system` | BOOL | no |  | `0` |  |
| `is_active` | BOOL | no |  | `1` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- UNIQUE `idx_facility_types_org_name` (`organization_id`, `name`)

### `facility_utility_accounts`

**FacilityUtilityAccount** · `app/models/facilities.py`

> Utility accounts (electric, gas, water, etc.) for a facility

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `facility_id` | VARCHAR(36) | no | FK, IDX |  | → `facilities.id` ON DELETE CASCADE |
| `utility_type` | ENUM(`electric`, `gas`, `water`, `sewer`, `internet`, `phone`, `trash`, `other`) | no |  |  |  |
| `provider_name` | VARCHAR(200) | no |  |  |  |
| `account_number` | VARCHAR(100) | yes |  |  |  |
| `meter_number` | VARCHAR(100) | yes |  |  |  |
| `contact_phone` | VARCHAR(50) | yes |  |  |  |
| `contact_email` | VARCHAR(200) | yes |  |  |  |
| `emergency_phone` | VARCHAR(50) | yes |  |  |  |
| `billing_cycle` | ENUM(`monthly`, `quarterly`, `annual`, `other`) | yes |  | `'monthly'` |  |
| `notes` | TEXT | yes |  |  |  |
| `is_active` | BOOL | no |  | `1` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_facility_utility_type` (`facility_id`, `utility_type`)
- `ix_facility_utility_accounts_organization_id` (`organization_id`)

### `facility_utility_readings`

**FacilityUtilityReading** · `app/models/facilities.py`

> Monthly/periodic utility cost and usage readings

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `utility_account_id` | VARCHAR(36) | no | FK, IDX |  | → `facility_utility_accounts.id` ON DELETE CASCADE |
| `reading_date` | DATE | no | IDX |  |  |
| `period_start` | DATE | yes |  |  |  |
| `period_end` | DATE | yes |  |  |  |
| `amount` | NUMERIC(10, 2) | yes |  |  |  |
| `usage_quantity` | NUMERIC(12, 3) | yes |  |  |  |
| `usage_unit` | VARCHAR(50) | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_facility_utility_readings_account` (`utility_account_id`)
- `idx_facility_utility_readings_date` (`reading_date`)
- `ix_facility_utility_readings_organization_id` (`organization_id`)

## Finance

### `approval_chain_steps`

**ApprovalChainStep** · `app/models/finance.py`

> A single step in an approval chain

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `chain_id` | VARCHAR(36) | no | FK, IDX |  | → `approval_chains.id` ON DELETE CASCADE |
| `step_order` | INTEGER | no |  |  |  |
| `name` | VARCHAR(200) | no |  |  |  |
| `step_type` | ENUM(`approval`, `notification`) | no |  | `'approval'` |  |
| `approver_type` | ENUM(`position`, `permission`, `specific_user`, `email`) | yes |  |  |  |
| `approver_value` | VARCHAR(500) | yes |  |  |  |
| `notification_emails` | JSON | yes |  |  |  |
| `email_template_id` | VARCHAR(36) | yes | FK |  | → `email_templates.id` ON DELETE SET NULL |
| `allow_self_approval` | BOOL | no |  | `False` |  |
| `auto_approve_under` | NUMERIC(12, 2) | yes |  |  |  |
| `required` | BOOL | no |  | `True` |  |
| `created_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_approval_chain_steps_chain` (`chain_id`, `step_order`)

### `approval_chains`

**ApprovalChain** · `app/models/finance.py`

> Configurable approval chain template

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(200) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `applies_to` | ENUM(`purchase_request`, `expense_report`, `check_request`) | no |  |  |  |
| `min_amount` | NUMERIC(12, 2) | yes |  |  |  |
| `max_amount` | NUMERIC(12, 2) | yes |  |  |  |
| `budget_category_id` | VARCHAR(36) | yes | FK |  | → `budget_categories.id` ON DELETE SET NULL |
| `is_default` | BOOL | no |  | `False` |  |
| `is_active` | BOOL | no |  | `True` |  |
| `created_by` | VARCHAR(36) | no | FK |  | → `users.id` |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_approval_chains_org_applies` (`organization_id`, `applies_to`)

### `approval_step_records`

**ApprovalStepRecord** · `app/models/finance.py`

> Tracks actual approval step progression for a specific entity

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `chain_id` | VARCHAR(36) | no | FK |  | → `approval_chains.id` ON DELETE CASCADE |
| `step_id` | VARCHAR(36) | no | FK |  | → `approval_chain_steps.id` ON DELETE CASCADE |
| `entity_type` | ENUM(`purchase_request`, `expense_report`, `check_request`) | no | IDX |  |  |
| `entity_id` | VARCHAR(36) | no |  |  |  |
| `status` | ENUM(`pending`, `approved`, `denied`, `skipped`, `auto_approved`, `sent`) | no |  | `'pending'` |  |
| `assigned_to` | VARCHAR(36) | yes | FK, IDX |  | → `users.id` ON DELETE SET NULL |
| `acted_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `acted_at` | DATETIME | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `approval_token` | VARCHAR(255) | yes | UQ |  |  |
| `token_expires_at` | DATETIME | yes |  |  |  |
| `created_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_approval_step_records_assigned` (`assigned_to`, `status`)
- `ix_approval_step_records_entity` (`entity_type`, `entity_id`)

**Constraints**

- UNIQUE `uq_approval_step_records_approval_token` (`approval_token`)

### `budget_categories`

**BudgetCategory** · `app/models/finance.py`

> Budget category (hierarchical)

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(200) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `parent_category_id` | VARCHAR(36) | yes | FK |  | → `budget_categories.id` ON DELETE SET NULL |
| `sort_order` | INTEGER | no |  | `0` |  |
| `is_active` | BOOL | no |  | `True` |  |
| `qb_account_name` | VARCHAR(200) | yes |  |  |  |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_budget_categories_org_id` (`organization_id`)

### `budgets`

**Budget** · `app/models/finance.py`

> Budget line for a category within a fiscal year

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `fiscal_year_id` | VARCHAR(36) | no | FK |  | → `fiscal_years.id` ON DELETE CASCADE |
| `category_id` | VARCHAR(36) | no | FK |  | → `budget_categories.id` ON DELETE CASCADE |
| `amount_budgeted` | NUMERIC(12, 2) | no |  | `0` |  |
| `amount_spent` | NUMERIC(12, 2) | no |  | `0` |  |
| `amount_encumbered` | NUMERIC(12, 2) | no |  | `0` |  |
| `notes` | TEXT | yes |  |  |  |
| `station_id` | VARCHAR(36) | yes | FK |  | → `facilities.id` ON DELETE SET NULL |
| `created_by` | VARCHAR(36) | no | FK |  | → `users.id` |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_budgets_org_fy_cat` (`organization_id`, `fiscal_year_id`, `category_id`)

### `check_requests`

**CheckRequest** · `app/models/finance.py`

> Request to cut a check for payment

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `request_number` | VARCHAR(20) | no |  |  |  |
| `requested_by` | VARCHAR(36) | no | FK |  | → `users.id` |
| `fiscal_year_id` | VARCHAR(36) | no | FK |  | → `fiscal_years.id` ON DELETE CASCADE |
| `budget_id` | VARCHAR(36) | yes | FK |  | → `budgets.id` ON DELETE SET NULL |
| `payee_name` | VARCHAR(300) | no |  |  |  |
| `payee_address` | TEXT | yes |  |  |  |
| `amount` | NUMERIC(12, 2) | no |  |  |  |
| `memo` | VARCHAR(500) | yes |  |  |  |
| `purpose` | TEXT | yes |  |  |  |
| `status` | ENUM(`draft`, `submitted`, `pending_approval`, `approved`, `denied`, `issued`, `voided`, `cancelled`) | no |  | `'draft'` |  |
| `approved_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `approved_at` | DATETIME | yes |  |  |  |
| `denial_reason` | TEXT | yes |  |  |  |
| `check_number` | VARCHAR(50) | yes |  |  |  |
| `check_date` | DATETIME | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_check_requests_org_status` (`organization_id`, `status`)

**Constraints**

- UNIQUE `uq_check_requests_org_number` (`organization_id`, `request_number`)

### `dues_payments`

**DuesPayment** · `app/models/finance.py`

> A single payment received against a member's dues (FIN-6). ``MemberDues`` used to be the only record of payment: one ``amount_paid`` total plus one set of ``payment_method`` / ``transaction_reference`` / ``notes`` columns, all overwritten by whichever payment was entered last. Nothing recorded that a payment had *happened*, so a retry could not be distinguished from a second instalment, and the detail of every earlier payment was destroyed as soon as another arrived. Each payment is now a row here, and the columns on ``MemberDues`` are derived from this ledger rather than mutated in place — see ``_apply_payment_totals``. That makes the total recomputable rather than accumulated, which is what allows a double-submission to be rejected without guessing.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `member_dues_id` | VARCHAR(36) | no | FK, IDX |  | → `member_dues.id` ON DELETE CASCADE |
| `amount` | NUMERIC(12, 2) | no |  |  |  |
| `payment_method` | VARCHAR(50) | yes |  |  |  |
| `transaction_reference` | VARCHAR(200) | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `received_at` | DATETIME | no |  |  |  |
| `recorded_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_dues_payments_dues` (`member_dues_id`, `received_at`)
- `ix_dues_payments_org_id` (`organization_id`)

**Constraints**

- UNIQUE `uq_dues_payment_reference` (`member_dues_id`, `transaction_reference`)

### `dues_schedules`

**DuesSchedule** · `app/models/finance.py`

> Schedule for dues collection

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(200) | no |  |  |  |
| `amount` | NUMERIC(12, 2) | no |  |  |  |
| `frequency` | ENUM(`annual`, `semi_annual`, `quarterly`, `monthly`) | no |  |  |  |
| `due_date` | DATETIME | no |  |  |  |
| `grace_period_days` | INTEGER | no |  | `30` |  |
| `late_fee_amount` | NUMERIC(12, 2) | yes |  |  |  |
| `fiscal_year_id` | VARCHAR(36) | yes | FK |  | → `fiscal_years.id` ON DELETE SET NULL |
| `applies_to_membership_types` | JSON | yes |  |  |  |
| `is_active` | BOOL | no |  | `True` |  |
| `notes` | TEXT | yes |  |  |  |
| `created_by` | VARCHAR(36) | no | FK |  | → `users.id` |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_dues_schedules_org_id` (`organization_id`)

### `expense_line_items`

**ExpenseLineItem** · `app/models/finance.py`

> Individual line item within an expense report

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `expense_report_id` | VARCHAR(36) | no | FK, IDX |  | → `expense_reports.id` ON DELETE CASCADE |
| `budget_id` | VARCHAR(36) | yes | FK |  | → `budgets.id` ON DELETE SET NULL |
| `description` | VARCHAR(500) | no |  |  |  |
| `amount` | NUMERIC(12, 2) | no |  |  |  |
| `date_incurred` | DATETIME | no |  |  |  |
| `expense_type` | ENUM(`general`, `uniform_reimbursement`, `ppe_replacement`, `boot_allowance`, `training_reimbursement`, `certification_fee`, `conference`, `travel`, `meals`, `mileage`, `equipment_purchase`, `other`) | no |  | `'general'` |  |
| `receipt_url` | VARCHAR(500) | yes |  |  |  |
| `merchant` | VARCHAR(300) | yes |  |  |  |
| `created_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_expense_line_items_report` (`expense_report_id`)

### `expense_reports`

**ExpenseReport** · `app/models/finance.py`

> Expense report submitted by a member for reimbursement

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `report_number` | VARCHAR(20) | no |  |  |  |
| `submitted_by` | VARCHAR(36) | no | FK |  | → `users.id` |
| `fiscal_year_id` | VARCHAR(36) | no | FK |  | → `fiscal_years.id` ON DELETE CASCADE |
| `title` | VARCHAR(300) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `total_amount` | NUMERIC(12, 2) | no |  | `0` |  |
| `status` | ENUM(`draft`, `submitted`, `pending_approval`, `approved`, `denied`, `paid`, `cancelled`) | no |  | `'draft'` |  |
| `approved_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `approved_at` | DATETIME | yes |  |  |  |
| `denial_reason` | TEXT | yes |  |  |  |
| `paid_at` | DATETIME | yes |  |  |  |
| `payment_method` | VARCHAR(50) | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_expense_reports_org_status` (`organization_id`, `status`)

**Constraints**

- UNIQUE `uq_expense_reports_org_number` (`organization_id`, `report_number`)

### `finance_export_logs`

**ExportLog** · `app/models/finance.py`

> Log of QuickBooks export operations

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `export_type` | VARCHAR(50) | no |  |  |  |
| `date_range_start` | DATETIME | no |  |  |  |
| `date_range_end` | DATETIME | no |  |  |  |
| `record_count` | INTEGER | no |  | `0` |  |
| `file_format` | ENUM(`csv`, `iif`) | no |  |  |  |
| `exported_by` | VARCHAR(36) | no | FK |  | → `users.id` |
| `exported_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_export_logs_org_id` (`organization_id`)

### `finance_export_mappings`

**ExportMapping** · `app/models/finance.py`

> Mapping between internal budget categories and QuickBooks accounts

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `internal_category` | VARCHAR(200) | no |  |  |  |
| `qb_account_name` | VARCHAR(200) | no |  |  |  |
| `qb_account_number` | VARCHAR(50) | yes |  |  |  |
| `mapping_type` | ENUM(`expense`, `income`, `asset`) | no |  |  |  |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_export_mappings_org_id` (`organization_id`)

### `fiscal_years`

**FiscalYear** · `app/models/finance.py`

> Fiscal year definition for the organization

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(100) | no |  |  |  |
| `start_date` | DATETIME | no |  |  |  |
| `end_date` | DATETIME | no |  |  |  |
| `status` | ENUM(`draft`, `active`, `closed`) | no |  | `'draft'` |  |
| `is_locked` | BOOL | no |  | `False` |  |
| `created_by` | VARCHAR(36) | no | FK |  | → `users.id` |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_fiscal_years_org_status` (`organization_id`, `status`)

### `member_dues`

**MemberDues** · `app/models/finance.py`

> Individual member dues payment record

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `dues_schedule_id` | VARCHAR(36) | no | FK, IDX |  | → `dues_schedules.id` ON DELETE CASCADE |
| `user_id` | VARCHAR(36) | no | FK, IDX |  | → `users.id` ON DELETE CASCADE |
| `amount_due` | NUMERIC(12, 2) | no |  |  |  |
| `amount_paid` | NUMERIC(12, 2) | no |  | `0` |  |
| `status` | ENUM(`pending`, `paid`, `partial`, `overdue`, `waived`, `exempt`) | no |  | `'pending'` |  |
| `due_date` | DATETIME | no |  |  |  |
| `paid_date` | DATETIME | yes |  |  |  |
| `payment_method` | VARCHAR(50) | yes |  |  |  |
| `transaction_reference` | VARCHAR(200) | yes |  |  |  |
| `late_fee_applied` | NUMERIC(12, 2) | yes |  |  |  |
| `waived_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `waived_at` | DATETIME | yes |  |  |  |
| `waive_reason` | TEXT | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_member_dues_org_id` (`organization_id`)
- `ix_member_dues_schedule` (`dues_schedule_id`, `status`)
- `ix_member_dues_user` (`user_id`, `status`)

### `purchase_requests`

**PurchaseRequest** · `app/models/finance.py`

> Purchase request submitted by a member

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `request_number` | VARCHAR(20) | no |  |  |  |
| `fiscal_year_id` | VARCHAR(36) | no | FK |  | → `fiscal_years.id` ON DELETE CASCADE |
| `budget_id` | VARCHAR(36) | yes | FK |  | → `budgets.id` ON DELETE SET NULL |
| `requested_by` | VARCHAR(36) | no | FK |  | → `users.id` |
| `title` | VARCHAR(300) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `vendor` | VARCHAR(300) | yes |  |  |  |
| `estimated_amount` | NUMERIC(12, 2) | no |  |  |  |
| `actual_amount` | NUMERIC(12, 2) | yes |  |  |  |
| `status` | ENUM(`draft`, `submitted`, `pending_approval`, `approved`, `denied`, `ordered`, `received`, `paid`, `cancelled`) | no |  | `'draft'` |  |
| `priority` | ENUM(`low`, `medium`, `high`, `urgent`) | no |  | `'medium'` |  |
| `approved_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `approved_at` | DATETIME | yes |  |  |  |
| `denial_reason` | TEXT | yes |  |  |  |
| `ordered_at` | DATETIME | yes |  |  |  |
| `received_at` | DATETIME | yes |  |  |  |
| `paid_at` | DATETIME | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `receipt_url` | VARCHAR(500) | yes |  |  |  |
| `apparatus_id` | VARCHAR(36) | yes | FK |  | → `apparatus.id` ON DELETE SET NULL |
| `facility_id` | VARCHAR(36) | yes | FK |  | → `facilities.id` ON DELETE SET NULL |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_purchase_requests_org_fy` (`organization_id`, `fiscal_year_id`)
- `ix_purchase_requests_org_status` (`organization_id`, `status`)

**Constraints**

- UNIQUE `uq_purchase_requests_org_number` (`organization_id`, `request_number`)

## Forms

### `form_fields`

**FormField** · `app/models/forms.py`

> Form Field model Represents a single field within a form definition.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `form_id` | VARCHAR(36) | no | FK, IDX |  | → `forms.id` ON DELETE CASCADE |
| `label` | VARCHAR(255) | no |  |  |  |
| `field_type` | ENUM(`text`, `textarea`, `number`, `email`, `phone`, `date`, `time`, `datetime`, `select`, `multiselect`, `checkbox`, `radio`, `file`, `signature`, `section_header`, `member_lookup`) | no |  |  |  |
| `placeholder` | VARCHAR(255) | yes |  |  |  |
| `help_text` | TEXT | yes |  |  |  |
| `default_value` | TEXT | yes |  |  |  |
| `required` | BOOL | yes |  | `False` |  |
| `min_length` | INTEGER | yes |  |  |  |
| `max_length` | INTEGER | yes |  |  |  |
| `min_value` | INTEGER | yes |  |  |  |
| `max_value` | INTEGER | yes |  |  |  |
| `validation_pattern` | VARCHAR(500) | yes |  |  |  |
| `options` | JSON | yes |  |  |  |
| `condition_field_id` | VARCHAR(36) | yes |  |  |  |
| `condition_operator` | VARCHAR(20) | yes |  |  |  |
| `condition_value` | VARCHAR(500) | yes |  |  |  |
| `sort_order` | INTEGER | no |  | `0` |  |
| `width` | VARCHAR(20) | yes |  | `'full'` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_form_fields_form_order` (`form_id`, `sort_order`)

### `form_integrations`

**FormIntegration** · `app/models/forms.py`

> Form Integration model Defines how a form submission feeds data into other modules (e.g., membership interest form -> membership module, equipment assignment form -> inventory module).

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `form_id` | VARCHAR(36) | no | FK |  | → `forms.id` ON DELETE CASCADE |
| `organization_id` | VARCHAR(36) | no | FK |  | → `organizations.id` ON DELETE CASCADE |
| `target_module` | ENUM(`membership`, `inventory`, `events`) | no |  |  |  |
| `integration_type` | ENUM(`membership_interest`, `equipment_assignment`, `event_registration`, `event_request`) | no |  |  |  |
| `field_mappings` | JSON | no |  |  |  |
| `is_active` | BOOL | yes |  | `True` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Constraints**

- UNIQUE `uq_form_integration_target` (`form_id`, `target_module`)

### `form_submissions`

**FormSubmission** · `app/models/forms.py`

> Form Submission model Represents a completed submission of a form by a user or anonymous visitor.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `form_id` | VARCHAR(36) | no | FK, IDX |  | → `forms.id` ON DELETE CASCADE |
| `submitted_by` | VARCHAR(36) | yes | FK, IDX |  | → `users.id` ON DELETE SET NULL |
| `submitted_at` | DATETIME | yes |  | `now()` |  |
| `data` | JSON | no |  |  |  |
| `submitter_name` | VARCHAR(255) | yes |  |  |  |
| `submitter_email` | VARCHAR(255) | yes |  |  |  |
| `is_public_submission` | BOOL | yes |  | `False` |  |
| `ip_address` | VARCHAR(45) | yes |  |  |  |
| `user_agent` | VARCHAR(500) | yes |  |  |  |
| `integration_processed` | BOOL | yes |  | `False` |  |
| `integration_result` | JSON | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_form_submissions_org_form` (`organization_id`, `form_id`)
- `idx_form_submissions_org_user` (`organization_id`, `submitted_by`)
- `ix_form_submissions_form_id` (`form_id`)
- `ix_form_submissions_submitted_by` (`submitted_by`)

### `forms`

**Form** · `app/models/forms.py`

> Form model Represents a form definition/template that can be filled out by members or the public (if public access is enabled).

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(255) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `category` | ENUM(`safety`, `operations`, `administration`, `training`, `other`) | no |  | `operations` |  |
| `status` | ENUM(`draft`, `published`, `archived`) | no | IDX | `draft` |  |
| `allow_multiple_submissions` | BOOL | yes |  | `True` |  |
| `require_authentication` | BOOL | yes |  | `True` |  |
| `notify_on_submission` | BOOL | yes |  | `False` |  |
| `notification_emails` | JSON | yes |  |  |  |
| `public_slug` | VARCHAR(12) | yes | UQ, UQ-IDX | `generate_slug()` |  |
| `is_public` | BOOL | yes |  | `False` |  |
| `integration_type` | VARCHAR(50) | yes | IDX |  |  |
| `version` | INTEGER | yes |  | `1` |  |
| `is_template` | BOOL | yes | IDX | `False` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `published_at` | DATETIME | yes |  |  |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` |

**Indexes**

- `idx_forms_org_category` (`organization_id`, `category`)
- `idx_forms_org_status` (`organization_id`, `status`)
- `idx_forms_org_template` (`organization_id`, `is_template`)
- `ix_forms_integration_type` (`integration_type`)
- `ix_forms_is_template` (`is_template`)
- UNIQUE `ix_forms_public_slug` (`public_slug`)
- `ix_forms_status` (`status`)

## Grants & Fundraising

### `donations`

**Donation** · `app/models/grant.py`

> Donation model mapping to the existing donations table. Records individual donations including payment details, receipt/thank-you tracking, and dedications.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `campaign_id` | VARCHAR(36) | yes | FK, IDX |  | → `fundraising_campaigns.id` ON DELETE SET NULL |
| `donor_id` | VARCHAR(36) | yes | FK, IDX |  | → `donors.id` ON DELETE SET NULL |
| `amount` | NUMERIC(10, 2) | no |  |  |  |
| `currency` | VARCHAR(3) | no |  | `USD` |  |
| `donation_date` | DATETIME | no | IDX |  |  |
| `payment_method` | ENUM(`cash`, `check`, `credit_card`, `bank_transfer`, `paypal`, `venmo`, `other`) | no |  |  |  |
| `payment_status` | ENUM(`pending`, `completed`, `failed`, `refunded`, `cancelled`) | no |  | `completed` |  |
| `transaction_id` | VARCHAR(255) | yes |  |  |  |
| `check_number` | VARCHAR(50) | yes |  |  |  |
| `is_recurring` | BOOL | no |  | `0` |  |
| `recurring_frequency` | ENUM(`weekly`, `monthly`, `quarterly`, `annually`) | yes |  |  |  |
| `is_anonymous` | BOOL | no |  | `0` |  |
| `donor_name` | VARCHAR(255) | yes |  |  |  |
| `donor_email` | VARCHAR(255) | yes |  |  |  |
| `dedication_type` | ENUM(`in_honor`, `in_memory`) | yes |  |  |  |
| `dedication_name` | VARCHAR(255) | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `receipt_sent` | BOOL | no |  | `0` |  |
| `thank_you_sent` | BOOL | no |  | `0` |  |
| `tax_deductible` | BOOL | no |  | `1` |  |
| `custom_fields` | JSON | yes |  |  |  |
| `recorded_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `idx_donations_campaign` (`campaign_id`)
- `idx_donations_date` (`donation_date`)
- `idx_donations_donor` (`donor_id`)
- `idx_donations_method` (`organization_id`, `payment_method`)
- `idx_donations_status` (`organization_id`, `payment_status`)

### `donors`

**Donor** · `app/models/grant.py`

> Donor model mapping to the existing donors table. Tracks donor contact information, donation history summaries, and communication preferences.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `user_id` | VARCHAR(36) | yes | FK, IDX |  | → `users.id` ON DELETE SET NULL |
| `first_name` | VARCHAR(100) | no |  |  |  |
| `last_name` | VARCHAR(100) | no |  |  |  |
| `email` | VARCHAR(255) | yes |  |  |  |
| `phone` | VARCHAR(20) | yes |  |  |  |
| `address_line1` | VARCHAR(255) | yes |  |  |  |
| `address_line2` | VARCHAR(255) | yes |  |  |  |
| `city` | VARCHAR(100) | yes |  |  |  |
| `state` | VARCHAR(50) | yes |  |  |  |
| `postal_code` | VARCHAR(20) | yes |  |  |  |
| `country` | VARCHAR(100) | yes |  | `USA` |  |
| `donor_type` | ENUM(`individual`, `business`, `foundation`, `government`, `other`) | no |  | `individual` |  |
| `company_name` | VARCHAR(255) | yes |  |  |  |
| `total_donated` | NUMERIC(12, 2) | no |  | `0.00` |  |
| `donation_count` | INTEGER | no |  | `0` |  |
| `first_donation_date` | DATE | yes |  |  |  |
| `last_donation_date` | DATE | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `tags` | JSON | yes |  |  |  |
| `communication_preferences` | JSON | yes |  |  |  |
| `is_anonymous` | BOOL | no |  | `0` |  |
| `active` | BOOL | no |  | `1` |  |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `idx_donors_email` (`organization_id`, `email`)
- `idx_donors_name` (`organization_id`, `last_name`, `first_name`)
- `idx_donors_type` (`organization_id`, `donor_type`)
- `idx_donors_user` (`user_id`)

### `fundraising_campaigns`

**FundraisingCampaign** · `app/models/grant.py`

> Fundraising campaign model mapping to the existing fundraising_campaigns table. Represents a fundraising initiative with a goal amount, date range, and optional public donation page.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(255) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `campaign_type` | ENUM(`general`, `equipment`, `training`, `community`, `memorial`, `event`, `other`) | no |  |  |  |
| `goal_amount` | NUMERIC(12, 2) | no |  |  |  |
| `current_amount` | NUMERIC(12, 2) | no |  | `0.00` |  |
| `start_date` | DATE | no | IDX |  |  |
| `end_date` | DATE | yes |  |  |  |
| `status` | ENUM(`draft`, `active`, `paused`, `completed`, `cancelled`) | no |  | `draft` |  |
| `public_page_enabled` | BOOL | no |  | `0` |  |
| `public_page_url` | VARCHAR(255) | yes |  |  |  |
| `hero_image_url` | VARCHAR(500) | yes |  |  |  |
| `thank_you_message` | TEXT | yes |  |  |  |
| `allow_anonymous` | BOOL | no |  | `1` |  |
| `minimum_donation` | NUMERIC(10, 2) | yes |  |  |  |
| `suggested_amounts` | JSON | yes |  |  |  |
| `custom_fields` | JSON | yes |  |  |  |
| `active` | BOOL | no |  | `1` |  |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` |

**Indexes**

- `idx_fundraising_campaigns_dates` (`start_date`, `end_date`)
- `idx_fundraising_campaigns_status` (`organization_id`, `status`)
- `idx_fundraising_campaigns_type` (`organization_id`, `campaign_type`)

### `fundraising_events`

**FundraisingEvent** · `app/models/grant.py`

> Fundraising event model mapping to the existing fundraising_events table. Represents events tied to fundraising campaigns such as dinners, galas, auctions, and other fundraising activities.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `campaign_id` | VARCHAR(36) | yes | FK, IDX |  | → `fundraising_campaigns.id` ON DELETE CASCADE |
| `event_id` | VARCHAR(36) | yes | FK |  | → `events.id` ON DELETE SET NULL |
| `name` | VARCHAR(255) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `event_type` | ENUM(`dinner`, `gala`, `auction`, `raffle`, `golf_outing`, `walkathon`, `other`) | no |  |  |  |
| `event_date` | DATETIME | no | IDX |  |  |
| `location` | VARCHAR(300) | yes |  |  |  |
| `ticket_price` | NUMERIC(10, 2) | yes |  |  |  |
| `max_attendees` | INTEGER | yes |  |  |  |
| `current_attendees` | INTEGER | no |  | `0` |  |
| `revenue_goal` | NUMERIC(12, 2) | yes |  |  |  |
| `actual_revenue` | NUMERIC(12, 2) | no |  | `0.00` |  |
| `expenses` | NUMERIC(12, 2) | no |  | `0.00` |  |
| `status` | ENUM(`planning`, `open`, `sold_out`, `completed`, `cancelled`) | no |  | `planning` |  |
| `registration_url` | VARCHAR(500) | yes |  |  |  |
| `sponsors` | JSON | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `idx_fundraising_events_campaign` (`campaign_id`)
- `idx_fundraising_events_date` (`event_date`)
- `idx_fundraising_events_status` (`organization_id`, `status`)

### `grant_applications`

**GrantApplication** · `app/models/grant.py`

> Individual grant application tracked through the pipeline. Represents a specific application to a grant program, including financial details, timeline, compliance requirements, and status.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `opportunity_id` | VARCHAR(36) | yes | FK, IDX |  | → `grant_opportunities.id` ON DELETE SET NULL |
| `grant_program_name` | VARCHAR(255) | yes |  |  |  |
| `grant_agency` | VARCHAR(255) | yes |  |  |  |
| `application_status` | ENUM(`researching`, `preparing`, `internal_review`, `submitted`, `under_review`, `awarded`, `denied`, `active`, `reporting`, `closed`) | no | IDX | `researching` |  |
| `amount_requested` | NUMERIC(12, 2) | yes |  |  |  |
| `amount_awarded` | NUMERIC(12, 2) | yes |  |  |  |
| `match_amount` | NUMERIC(12, 2) | yes |  |  |  |
| `match_source` | VARCHAR(255) | yes |  |  |  |
| `application_deadline` | DATE | yes | IDX |  |  |
| `submitted_date` | DATE | yes |  |  |  |
| `award_date` | DATE | yes |  |  |  |
| `grant_start_date` | DATE | yes |  |  |  |
| `grant_end_date` | DATE | yes |  |  |  |
| `project_description` | TEXT | yes |  |  |  |
| `narrative_summary` | TEXT | yes |  |  |  |
| `budget_summary` | JSON | yes |  |  |  |
| `key_contacts` | JSON | yes |  |  |  |
| `federal_award_id` | VARCHAR(100) | yes |  |  |  |
| `nfirs_compliant` | BOOL | yes |  |  |  |
| `performance_period_months` | INTEGER | yes |  |  |  |
| `reporting_frequency` | ENUM(`monthly`, `quarterly`, `semi_annual`, `annual`) | yes |  |  |  |
| `next_report_due` | DATE | yes |  |  |  |
| `final_report_due` | DATE | yes |  |  |  |
| `assigned_to` | VARCHAR(36) | yes | FK, IDX |  | → `users.id` ON DELETE SET NULL |
| `priority` | ENUM(`low`, `medium`, `high`, `critical`) | no | IDX | `medium` |  |
| `linked_campaign_id` | VARCHAR(36) | yes | FK, IDX |  | → `fundraising_campaigns.id` ON DELETE SET NULL |
| `notes` | TEXT | yes |  |  |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_grant_applications_assigned_to` (`assigned_to`)
- `ix_grant_applications_deadline` (`application_deadline`)
- `ix_grant_applications_linked_campaign_id` (`linked_campaign_id`)
- `ix_grant_applications_opportunity_id` (`opportunity_id`)
- `ix_grant_applications_organization_id` (`organization_id`)
- `ix_grant_applications_priority` (`priority`)
- `ix_grant_applications_status` (`application_status`)

### `grant_budget_items`

**GrantBudgetItem** · `app/models/grant.py`

> Budget line item for a grant application. Tracks budgeted amounts, spending, and the split between federal share and local match for each budget category.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `application_id` | VARCHAR(36) | no | FK, IDX |  | → `grant_applications.id` ON DELETE CASCADE |
| `category` | ENUM(`equipment`, `personnel`, `training`, `contractual`, `supplies`, `travel`, `construction`, `indirect`, `other`) | no | IDX |  |  |
| `description` | VARCHAR(500) | yes |  |  |  |
| `amount_budgeted` | NUMERIC(12, 2) | no |  |  |  |
| `amount_spent` | NUMERIC(12, 2) | no |  | `0` |  |
| `amount_remaining` | NUMERIC(12, 2) | yes |  |  |  |
| `federal_share` | NUMERIC(12, 2) | yes |  |  |  |
| `local_match` | NUMERIC(12, 2) | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `sort_order` | INTEGER | no |  | `0` |  |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_grant_budget_items_application_id` (`application_id`)
- `ix_grant_budget_items_category` (`category`)

### `grant_compliance_tasks`

**GrantComplianceTask** · `app/models/grant.py`

> Follow-up task, report, or compliance obligation for a grant. Tracks required reports, audits, site visits, and other compliance activities with due dates and reminders.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `application_id` | VARCHAR(36) | no | FK, IDX |  | → `grant_applications.id` ON DELETE CASCADE |
| `task_type` | ENUM(`performance_report`, `financial_report`, `progress_update`, `site_visit`, `audit`, `equipment_inventory`, `nfirs_submission`, `closeout_report`, `other`) | no |  |  |  |
| `title` | VARCHAR(255) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `due_date` | DATE | no | IDX |  |  |
| `completed_date` | DATE | yes |  |  |  |
| `status` | ENUM(`pending`, `in_progress`, `completed`, `overdue`, `waived`) | no | IDX | `pending` |  |
| `priority` | ENUM(`low`, `medium`, `high`, `critical`) | no |  | `medium` |  |
| `assigned_to` | VARCHAR(36) | yes | FK, IDX |  | → `users.id` ON DELETE SET NULL |
| `reminder_days_before` | INTEGER | no |  | `14` |  |
| `last_reminder_sent` | DATETIME | yes |  |  |  |
| `report_template` | TEXT | yes |  |  |  |
| `submission_url` | VARCHAR(500) | yes |  |  |  |
| `attachments` | JSON | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_grant_compliance_tasks_application_id` (`application_id`)
- `ix_grant_compliance_tasks_assigned_to` (`assigned_to`)
- `ix_grant_compliance_tasks_due_date` (`due_date`)
- `ix_grant_compliance_tasks_status` (`status`)

### `grant_expenditures`

**GrantExpenditure** · `app/models/grant.py`

> Individual spending record against a grant budget. Tracks actual expenditures including vendor, invoice details, and approval workflow.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `application_id` | VARCHAR(36) | no | FK, IDX |  | → `grant_applications.id` ON DELETE CASCADE |
| `budget_item_id` | VARCHAR(36) | yes | FK, IDX |  | → `grant_budget_items.id` ON DELETE SET NULL |
| `description` | VARCHAR(500) | no |  |  |  |
| `amount` | NUMERIC(12, 2) | no |  |  |  |
| `expenditure_date` | DATE | no | IDX |  |  |
| `vendor` | VARCHAR(255) | yes |  |  |  |
| `invoice_number` | VARCHAR(100) | yes |  |  |  |
| `receipt_url` | VARCHAR(500) | yes |  |  |  |
| `payment_method` | VARCHAR(100) | yes |  |  |  |
| `approved_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `approval_date` | DATE | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_grant_expenditures_application_id` (`application_id`)
- `ix_grant_expenditures_budget_item_id` (`budget_item_id`)
- `ix_grant_expenditures_expenditure_date` (`expenditure_date`)

### `grant_notes`

**GrantNote** · `app/models/grant.py`

> Activity log / note for a grant application. Records status changes, documents added, contacts made, milestones, and other activity on a grant application.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `application_id` | VARCHAR(36) | no | FK, IDX |  | → `grant_applications.id` ON DELETE CASCADE |
| `note_type` | ENUM(`general`, `status_change`, `document_added`, `contact_made`, `milestone`, `financial`, `compliance`) | no | IDX | `general` |  |
| `content` | TEXT | no |  |  |  |
| `metadata` | JSON | yes |  |  |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `created_at` | DATETIME | no | IDX | `now()` |  |

**Indexes**

- `ix_grant_notes_application_id` (`application_id`)
- `ix_grant_notes_created_at` (`created_at`)
- `ix_grant_notes_note_type` (`note_type`)

### `grant_opportunities`

**GrantOpportunity** · `app/models/grant.py`

> Library of available grant programs. Tracks grant opportunities from federal, state, and local agencies that the organization may be eligible to apply for.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(255) | no |  |  |  |
| `agency` | VARCHAR(255) | yes |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `eligible_uses` | TEXT | yes |  |  |  |
| `typical_award_min` | NUMERIC(12, 2) | yes |  |  |  |
| `typical_award_max` | NUMERIC(12, 2) | yes |  |  |  |
| `eligibility_criteria` | TEXT | yes |  |  |  |
| `application_url` | VARCHAR(500) | yes |  |  |  |
| `program_url` | VARCHAR(500) | yes |  |  |  |
| `match_required` | BOOL | no |  | `0` |  |
| `match_percentage` | NUMERIC(5, 2) | yes |  |  |  |
| `match_description` | VARCHAR(500) | yes |  |  |  |
| `deadline_type` | ENUM(`fixed`, `recurring`, `rolling`) | yes |  |  |  |
| `deadline_date` | DATE | yes | IDX |  |  |
| `recurring_schedule` | JSON | yes |  |  |  |
| `required_documents` | JSON | yes |  |  |  |
| `tags` | JSON | yes |  |  |  |
| `category` | ENUM(`equipment`, `staffing`, `training`, `prevention`, `facilities`, `vehicles`, `wellness`, `community`, `other`) | yes | IDX |  |  |
| `federal_program_code` | VARCHAR(50) | yes | IDX |  |  |
| `is_active` | BOOL | no | IDX | `1` |  |
| `notes` | TEXT | yes |  |  |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_grant_opportunities_category` (`category`)
- `ix_grant_opportunities_deadline_date` (`deadline_date`)
- `ix_grant_opportunities_federal_program_code` (`federal_program_code`)
- `ix_grant_opportunities_is_active` (`is_active`)
- `ix_grant_opportunities_organization_id` (`organization_id`)

### `pledges`

**Pledge** · `app/models/grant.py`

> Pledge model mapping to the existing pledges table. Tracks donation pledges/commitments with fulfillment tracking and payment schedules.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `campaign_id` | VARCHAR(36) | yes | FK, IDX |  | → `fundraising_campaigns.id` ON DELETE SET NULL |
| `donor_id` | VARCHAR(36) | yes | FK, IDX |  | → `donors.id` ON DELETE SET NULL |
| `pledged_amount` | NUMERIC(10, 2) | no |  |  |  |
| `fulfilled_amount` | NUMERIC(10, 2) | no |  | `0.00` |  |
| `pledge_date` | DATE | no |  |  |  |
| `due_date` | DATE | yes | IDX |  |  |
| `status` | ENUM(`pending`, `partial`, `fulfilled`, `cancelled`, `overdue`) | no |  | `pending` |  |
| `payment_schedule` | JSON | yes |  |  |  |
| `reminder_enabled` | BOOL | no |  | `1` |  |
| `last_reminder_sent` | DATETIME | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `idx_pledges_campaign` (`campaign_id`)
- `idx_pledges_donor` (`donor_id`)
- `idx_pledges_due_date` (`due_date`)
- `idx_pledges_status` (`organization_id`, `status`)

## IP Security

### `blocked_access_attempts`

**BlockedAccessAttempt** · `app/models/ip_security.py`

> Blocked Access Attempt model for logging denied requests. Records all requests that were blocked due to geo-blocking or IP blocklist. Critical for security auditing and identifying attack patterns.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `ip_address` | VARCHAR(45) | no | IDX |  |  |
| `country_code` | VARCHAR(2) | yes | IDX |  |  |
| `country_name` | VARCHAR(100) | yes |  |  |  |
| `user_id` | VARCHAR(36) | yes | FK, IDX |  | → `users.id` |
| `block_reason` | VARCHAR(100) | no | IDX |  |  |
| `block_details` | TEXT | yes |  |  |  |
| `request_path` | VARCHAR(500) | yes |  |  |  |
| `request_method` | VARCHAR(10) | yes |  |  |  |
| `user_agent` | TEXT | yes |  |  |  |
| `blocked_at` | DATETIME | yes | IDX | `now()` |  |

**Indexes**

- `idx_blocked_country_time` (`country_code`, `blocked_at`)
- `idx_blocked_ip_time` (`ip_address`, `blocked_at`)
- `idx_blocked_user` (`user_id`)
- `ix_blocked_access_attempts_block_reason` (`block_reason`)
- `ix_blocked_access_attempts_blocked_at` (`blocked_at`)

### `country_block_rules`

**CountryBlockRule** · `app/models/ip_security.py`

> Country Block Rule model for managing blocked countries. Allows dynamic management of blocked countries without code changes.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `country_code` | VARCHAR(2) | no | UQ |  |  |
| `country_name` | VARCHAR(100) | yes |  |  |  |
| `is_blocked` | BOOL | yes | IDX | `True` |  |
| `reason` | TEXT | no |  |  |  |
| `risk_level` | VARCHAR(20) | yes |  |  |  |
| `created_by` | VARCHAR(36) | no | FK |  | → `users.id` |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `updated_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `blocked_attempts_count` | INTEGER | yes |  | `0` |  |
| `last_blocked_at` | DATETIME | yes |  |  |  |

**Indexes**

- `idx_country_rule_blocked` (`is_blocked`)

**Constraints**

- UNIQUE `uq_country_block_rules_country_code` (`country_code`)

### `ip_exception_audit_log`

**IPExceptionAuditLog** · `app/models/ip_security.py`

> Audit log for all IP exception actions. Tracks every action taken on IP exceptions for compliance and security.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `exception_id` | VARCHAR(36) | no | FK, IDX |  | → `ip_exceptions.id` ON DELETE CASCADE |
| `action` | VARCHAR(50) | no | IDX |  |  |
| `performed_by` | VARCHAR(36) | no | FK |  | → `users.id` |
| `performed_at` | DATETIME | yes | IDX | `now()` |  |
| `details` | TEXT | yes |  |  |  |
| `ip_address` | VARCHAR(45) | yes |  |  |  |

**Indexes**

- `idx_exception_audit_action` (`action`)
- `idx_exception_audit_exception` (`exception_id`)
- `idx_exception_audit_time` (`performed_at`)

### `ip_exceptions`

**IPException** · `app/models/ip_security.py`

> IP Exception model for user-specific allowlist/blocklist entries. ZERO-TRUST REQUIREMENTS: - Every exception MUST be tied to a specific user - Every exception MUST be approved by an IT administrator - Every exception MUST have a defined time period (no permanent exceptions) - All actions are logged for audit purposes

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `ip_address` | VARCHAR(45) | no | IDX |  |  |
| `exception_type` | ENUM(`allowlist`, `blocklist`) | no | IDX |  |  |
| `reason` | TEXT | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `user_id` | VARCHAR(36) | no | FK, IDX |  | → `users.id` ON DELETE CASCADE |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `requested_duration_days` | INTEGER | no |  |  |  |
| `valid_from` | DATETIME | yes |  |  |  |
| `valid_until` | DATETIME | no | IDX |  |  |
| `approval_status` | ENUM(`pending`, `approved`, `rejected`, `expired`, `revoked`) | no | IDX | `'pending'` |  |
| `requested_by` | VARCHAR(36) | no | FK |  | → `users.id` |
| `requested_at` | DATETIME | yes |  | `now()` |  |
| `approved_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `approved_at` | DATETIME | yes |  |  |  |
| `approval_notes` | TEXT | yes |  |  |  |
| `approved_duration_days` | INTEGER | yes |  |  |  |
| `rejected_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `rejected_at` | DATETIME | yes |  |  |  |
| `rejection_reason` | TEXT | yes |  |  |  |
| `revoked_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `revoked_at` | DATETIME | yes |  |  |  |
| `revoke_reason` | TEXT | yes |  |  |  |
| `country_code` | VARCHAR(2) | yes |  |  |  |
| `country_name` | VARCHAR(100) | yes |  |  |  |
| `use_case` | VARCHAR(100) | yes |  |  |  |
| `last_used_at` | DATETIME | yes |  |  |  |
| `use_count` | INTEGER | yes |  | `0` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_ip_exception_approval` (`approval_status`)
- `idx_ip_exception_ip` (`ip_address`)
- `idx_ip_exception_org` (`organization_id`)
- `idx_ip_exception_type_status` (`exception_type`, `approval_status`)
- `idx_ip_exception_user` (`user_id`)
- `idx_ip_exception_valid_until` (`valid_until`)

## Integrations

### `integrations`

**Integration** · `app/models/integration.py`

> Stores integration configurations per organization

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | UQ-IDX |  |  |
| `integration_type` | VARCHAR(50) | no |  |  |  |
| `name` | VARCHAR(100) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `category` | VARCHAR(50) | no |  |  |  |
| `status` | VARCHAR(20) | no |  | `'available'` |  |
| `config` | JSON | yes |  | `dict()` |  |
| `encrypted_config` | TEXT | yes |  |  |  |
| `enabled` | BOOL | yes |  | `False` |  |
| `contains_phi` | BOOL | yes |  | `False` |  |
| `last_sync_at` | DATETIME | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- UNIQUE `ix_integrations_org_type` (`organization_id`, `integration_type`)

## Inventory

### `checkout_records`

**CheckOutRecord** · `app/models/inventory.py`

> Check Out Record model Tracks temporary check-in/check-out of items from the pool. Used for items that aren't permanently assigned.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `item_id` | VARCHAR(36) | no | FK, IDX |  | → `inventory_items.id` ON DELETE CASCADE |
| `user_id` | VARCHAR(36) | no | FK, IDX |  | → `users.id` ON DELETE CASCADE |
| `checked_out_at` | DATETIME | no |  | `now()` |  |
| `expected_return_at` | DATETIME | yes |  |  |  |
| `checked_in_at` | DATETIME | yes | IDX |  |  |
| `checked_out_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `checked_in_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `checkout_reason` | TEXT | yes |  |  |  |
| `checkout_condition` | ENUM(`excellent`, `good`, `fair`, `poor`, `damaged`, `out_of_service`, `retired`) | yes |  |  |  |
| `return_condition` | ENUM(`excellent`, `good`, `fair`, `poor`, `damaged`, `out_of_service`, `retired`) | yes |  |  |  |
| `damage_notes` | TEXT | yes |  |  |  |
| `is_returned` | BOOL | yes | IDX | `False` |  |
| `is_overdue` | BOOL | yes | IDX | `False` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_checkout_records_org_item` (`organization_id`, `item_id`)
- `idx_checkout_records_org_overdue` (`organization_id`, `is_overdue`)
- `idx_checkout_records_org_returned_expected` (`organization_id`, `is_returned`, `expected_return_at`)
- `idx_checkout_records_org_user` (`organization_id`, `user_id`)
- `ix_checkout_records_checked_in_at` (`checked_in_at`)
- `ix_checkout_records_is_overdue` (`is_overdue`)
- `ix_checkout_records_is_returned` (`is_returned`)
- `ix_checkout_records_item_id` (`item_id`)
- `ix_checkout_records_user_id` (`user_id`)

### `departure_clearance_items`

**DepartureClearanceItem** · `app/models/inventory.py`

> Departure Clearance Line Item One row per outstanding item (assignment, checkout, or pool issuance) that a departing member must return. Tracks the disposition of each line — returned, damaged, written off, or waived.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `clearance_id` | VARCHAR(36) | no | FK, IDX |  | → `departure_clearances.id` ON DELETE CASCADE |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `source_type` | VARCHAR(20) | no |  |  |  |
| `source_id` | VARCHAR(36) | no |  |  |  |
| `item_id` | VARCHAR(36) | yes | FK |  | → `inventory_items.id` ON DELETE SET NULL |
| `item_name` | VARCHAR(255) | no |  |  |  |
| `item_serial_number` | VARCHAR(255) | yes |  |  |  |
| `item_asset_tag` | VARCHAR(255) | yes |  |  |  |
| `item_value` | NUMERIC(10, 2) | yes |  |  |  |
| `quantity` | INTEGER | no |  | `1` |  |
| `disposition` | ENUM(`pending`, `returned`, `returned_damaged`, `written_off`, `waived`) | no |  | `pending` |  |
| `return_condition` | ENUM(`excellent`, `good`, `fair`, `poor`, `damaged`, `out_of_service`, `retired`) | yes |  |  |  |
| `resolved_at` | DATETIME | yes |  |  |  |
| `resolved_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `resolution_notes` | TEXT | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_clearance_item_disposition` (`clearance_id`, `disposition`)
- `idx_clearance_item_org` (`organization_id`)

### `departure_clearances`

**DepartureClearance** · `app/models/inventory.py`

> Departure Clearance model Tracks the overall clearance process when a member leaves the department. Created when a member is dropped; completed when all outstanding items are returned or accounted for. Serves as the single record of the member's departure property pipeline.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `user_id` | VARCHAR(36) | no | FK |  | → `users.id` ON DELETE CASCADE |
| `status` | ENUM(`initiated`, `in_progress`, `completed`, `closed_incomplete`) | no |  | `initiated` |  |
| `total_items` | INTEGER | no |  | `0` |  |
| `items_cleared` | INTEGER | no |  | `0` |  |
| `items_outstanding` | INTEGER | no |  | `0` |  |
| `total_value` | NUMERIC(10, 2) | no |  | `0` |  |
| `value_outstanding` | NUMERIC(10, 2) | no |  | `0` |  |
| `initiated_at` | DATETIME | yes |  | `now()` |  |
| `completed_at` | DATETIME | yes |  |  |  |
| `return_deadline` | DATETIME | yes |  |  |  |
| `initiated_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `completed_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `departure_type` | ENUM(`dropped_voluntary`, `dropped_involuntary`, `retired`) | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_departure_clearance_org_status` (`organization_id`, `status`)
- `idx_departure_clearance_org_user` (`organization_id`, `user_id`)

### `equipment_kit_items`

**EquipmentKitItem** · `app/models/inventory.py`

> One line item in a kit template — specifies what item/category to include and how many.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `kit_id` | VARCHAR(36) | no | FK, IDX |  | → `equipment_kits.id` ON DELETE CASCADE |
| `item_id` | VARCHAR(36) | yes | FK |  | → `inventory_items.id` ON DELETE SET NULL |
| `category_id` | VARCHAR(36) | yes | FK |  | → `inventory_categories.id` ON DELETE SET NULL |
| `item_name` | VARCHAR(255) | no |  |  |  |
| `quantity` | INTEGER | no |  | `1` |  |
| `size_selectable` | BOOL | yes |  | `False` |  |
| `sort_order` | INTEGER | yes |  | `0` |  |

**Indexes**

- `idx_kit_items_kit` (`kit_id`)

### `equipment_kits`

**EquipmentKit** · `app/models/inventory.py`

> Kit/bundle template for issuing multiple items as a set. E.g., "New Member Uniform Kit" = 2 polo shirts + 2 pants + 1 belt + 1 cap. A single "issue kit" action creates multiple issuances/assignments at once.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(255) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `restricted_to_roles` | JSON | yes |  |  |  |
| `min_rank_order` | INTEGER | yes |  |  |  |
| `active` | BOOL | yes |  | `True` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` |

**Indexes**

- `idx_kits_org_active` (`organization_id`, `active`)

### `equipment_requests`

**EquipmentRequest** · `app/models/inventory.py`

> Equipment Request model Members can request equipment checkouts, pool issuances, or purchases. Admins/quartermasters review and approve/deny requests.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `requester_id` | VARCHAR(36) | no | FK, IDX |  | → `users.id` ON DELETE CASCADE |
| `item_name` | VARCHAR(255) | no |  |  |  |
| `item_id` | VARCHAR(36) | yes | FK |  | → `inventory_items.id` ON DELETE SET NULL |
| `category_id` | VARCHAR(36) | yes | FK |  | → `inventory_categories.id` ON DELETE SET NULL |
| `quantity` | INTEGER | no |  | `1` |  |
| `request_type` | ENUM(`checkout`, `issuance`, `purchase`, `return`) | no |  | `'checkout'` |  |
| `priority` | ENUM(`low`, `normal`, `high`) | no |  | `'normal'` |  |
| `reason` | TEXT | yes |  |  |  |
| `status` | ENUM(`pending`, `approved`, `denied`, `fulfilled`) | no | IDX | `'pending'` |  |
| `reviewed_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `reviewed_at` | DATETIME | yes |  |  |  |
| `review_notes` | TEXT | yes |  |  |  |
| `fulfilled_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `fulfilled_at` | DATETIME | yes |  |  |  |
| `fulfillment_type` | VARCHAR(20) | yes |  |  |  |
| `fulfillment_reference_id` | VARCHAR(36) | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_equip_requests_org_status` (`organization_id`, `status`)
- `idx_equip_requests_requester` (`requester_id`, `status`)
- `ix_equipment_requests_status` (`status`)

### `inventory_categories`

**InventoryCategory** · `app/models/inventory.py`

> Inventory Category model Organizes inventory items into categories for better organization and reporting.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(255) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `item_type` | ENUM(`uniform`, `ppe`, `tool`, `equipment`, `vehicle`, `electronics`, `consumable`, `other`) | no |  |  |  |
| `parent_category_id` | VARCHAR(36) | yes | FK |  | → `inventory_categories.id` ON DELETE SET NULL |
| `requires_assignment` | BOOL | yes |  | `False` |  |
| `requires_serial_number` | BOOL | yes |  | `False` |  |
| `requires_maintenance` | BOOL | yes |  | `False` |  |
| `low_stock_threshold` | INTEGER | yes |  |  |  |
| `nfpa_tracking_enabled` | BOOL | no |  | `0` |  |
| `extra_data` | JSON | yes |  |  |  |
| `active` | BOOL | yes | IDX | `True` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` |

**Indexes**

- `idx_inventory_categories_org_active` (`organization_id`, `active`)
- `idx_inventory_categories_org_type` (`organization_id`, `item_type`)
- `ix_inventory_categories_active` (`active`)

### `inventory_impact_plans`

**InventoryImpactPlan** · `app/models/inventory.py`

> A saved, named impact-planner scenario. Persists the planner's filter set so a quartermaster can re-run recurring plans (e.g. an annual uniform refresh) without re-entering filters.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(255) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `filters` | JSON | no |  | `dict()` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_impact_plans_org` (`organization_id`)

### `inventory_items`

**InventoryItem** · `app/models/inventory.py`

> Inventory Item model Represents individual items in the inventory system with full tracking of serial numbers, purchase info, condition, maintenance, and assignments.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `category_id` | VARCHAR(36) | yes | FK, IDX |  | → `inventory_categories.id` ON DELETE SET NULL |
| `name` | VARCHAR(255) | no | IDX |  |  |
| `description` | TEXT | yes |  |  |  |
| `manufacturer` | VARCHAR(255) | yes |  |  |  |
| `model_number` | VARCHAR(255) | yes |  |  |  |
| `serial_number` | VARCHAR(255) | yes | IDX |  |  |
| `asset_tag` | VARCHAR(255) | yes | IDX |  |  |
| `barcode` | VARCHAR(255) | yes | IDX |  |  |
| `purchase_date` | DATE | yes |  |  |  |
| `purchase_price` | NUMERIC(10, 2) | yes |  |  |  |
| `purchase_order` | VARCHAR(255) | yes |  |  |  |
| `vendor` | VARCHAR(255) | yes |  |  |  |
| `warranty_expiration` | DATE | yes |  |  |  |
| `expected_lifetime_years` | INTEGER | yes |  |  |  |
| `current_value` | NUMERIC(10, 2) | yes |  |  |  |
| `replacement_cost` | NUMERIC(10, 2) | yes |  |  |  |
| `size` | VARCHAR(50) | yes |  |  |  |
| `standard_size` | ENUM(`xxs`, `xs`, `s`, `m`, `l`, `xl`, `xxl`, `xxxl`, `xxxxl`, `6`, `6.5`, `7`, `7.5`, `8`, `8.5`, `9`, `9.5`, `10`, `10.5`, `11`, `11.5`, `12`, `12.5`, `13`, `14`, `15`, `28`, `30`, `32`, `34`, `36`, `38`, `40`, `42`, `44`, `46`, `one_size`, `custom`) | yes |  |  |  |
| `color` | VARCHAR(50) | yes |  |  |  |
| `style` | ENUM(`short_sleeve`, `long_sleeve`, `mens`, `womens`, `unisex`, `v_neck`, `crew_neck`, `polo`, `button_down`, `quarter_zip`) | yes |  |  |  |
| `weight` | FLOAT | yes |  |  |  |
| `location_id` | VARCHAR(36) | yes | FK, IDX |  | → `locations.id` ON DELETE SET NULL |
| `storage_location` | VARCHAR(255) | yes |  |  |  |
| `storage_area_id` | VARCHAR(36) | yes | FK, IDX |  | → `storage_areas.id` ON DELETE SET NULL |
| `station` | VARCHAR(100) | yes |  |  |  |
| `condition` | ENUM(`excellent`, `good`, `fair`, `poor`, `damaged`, `out_of_service`, `retired`) | no | IDX | `good` |  |
| `status` | ENUM(`available`, `assigned`, `checked_out`, `in_maintenance`, `lost`, `stolen`, `retired`) | no | IDX | `available` |  |
| `status_notes` | TEXT | yes |  |  |  |
| `tracking_type` | ENUM(`individual`, `pool`) | no |  | `individual` |  |
| `variant_group_id` | VARCHAR(36) | yes | FK, IDX |  | → `item_variant_groups.id` ON DELETE SET NULL |
| `quantity` | INTEGER | yes |  | `1` |  |
| `quantity_issued` | INTEGER | yes |  | `0` |  |
| `unit_of_measure` | VARCHAR(50) | yes |  |  |  |
| `reorder_point` | INTEGER | yes |  |  |  |
| `last_inspection_date` | DATE | yes |  |  |  |
| `next_inspection_due` | DATE | yes | IDX |  |  |
| `inspection_interval_days` | INTEGER | yes |  |  |  |
| `assigned_to_user_id` | VARCHAR(36) | yes | FK, IDX |  | → `users.id` ON DELETE SET NULL |
| `assigned_date` | DATETIME | yes |  |  |  |
| `min_rank_order` | INTEGER | yes |  |  |  |
| `restricted_to_positions` | JSON | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `custom_fields` | JSON | yes |  |  |  |
| `attachments` | JSON | yes |  |  |  |
| `active` | BOOL | yes | IDX | `True` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` |

**Indexes**

- `idx_inventory_items_assigned_to` (`assigned_to_user_id`)
- `idx_inventory_items_next_inspection` (`next_inspection_due`)
- `idx_inventory_items_org_active` (`organization_id`, `active`)
- `idx_inventory_items_org_category` (`organization_id`, `category_id`)
- `idx_inventory_items_org_status` (`organization_id`, `status`)
- `idx_inventory_items_tracking_type` (`organization_id`, `tracking_type`)
- `idx_inventory_items_variant_group` (`variant_group_id`)
- `ix_inventory_items_active` (`active`)
- `ix_inventory_items_asset_tag` (`asset_tag`)
- `ix_inventory_items_barcode` (`barcode`)
- `ix_inventory_items_category_id` (`category_id`)
- `ix_inventory_items_condition` (`condition`)
- `ix_inventory_items_location_id` (`location_id`)
- `ix_inventory_items_name` (`name`)
- `ix_inventory_items_serial_number` (`serial_number`)
- `ix_inventory_items_status` (`status`)
- `ix_inventory_items_storage_area_id` (`storage_area_id`)

**Constraints**

- UNIQUE `uq_item_org_asset_tag` (`organization_id`, `asset_tag`)
- UNIQUE `uq_item_org_barcode` (`organization_id`, `barcode`)
- UNIQUE `uq_item_org_serial_number` (`organization_id`, `serial_number`)

### `inventory_lots`

**InventoryLot** · `app/models/inventory.py`

> A batch/lot of a consumable inventory item held as ready stock. One inventory item (e.g. "4x4 Gauze") can have many lots on hand, each with its own lot number and expiration date. Lots are the replacement stock a supply officer keeps ready to swap onto apparatus during equipment checks: when a crew swaps in a fresh unit, its lot's quantity is decremented and the deployed check item inherits the lot number and expiration.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `inventory_item_id` | VARCHAR(36) | no | FK, IDX |  | → `inventory_items.id` ON DELETE CASCADE |
| `lot_number` | VARCHAR(100) | yes |  |  |  |
| `expiration_date` | DATE | yes |  |  |  |
| `quantity` | INTEGER | no |  | `0` |  |
| `received_date` | DATE | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |

**Indexes**

- `idx_inventory_lots_org_exp` (`organization_id`, `expiration_date`)
- `ix_inventory_lots_inventory_item_id` (`inventory_item_id`)

### `inventory_notification_queue`

**InventoryNotificationQueue** · `app/models/inventory.py`

> Queues inventory change events for delayed, consolidated email notifications. A scheduled task processes records older than 1 hour, groups them per member, nets out offsetting actions (e.g. issue + return of the same item cancel out), and sends a single email per member summarising the net changes.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `user_id` | VARCHAR(36) | no | FK |  | → `users.id` ON DELETE CASCADE |
| `action_type` | ENUM(`assigned`, `unassigned`, `issued`, `returned`, `checked_out`, `checked_in`, `retired`) | no |  |  |  |
| `item_id` | VARCHAR(36) | yes | FK |  | → `inventory_items.id` ON DELETE SET NULL |
| `item_name` | VARCHAR(255) | no |  |  |  |
| `item_serial_number` | VARCHAR(255) | yes |  |  |  |
| `item_asset_tag` | VARCHAR(255) | yes |  |  |  |
| `quantity` | INTEGER | no |  | `1` |  |
| `performed_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `processed` | BOOL | no | IDX | `0` |  |
| `processed_at` | DATETIME | yes |  |  |  |
| `attempt_count` | INTEGER | no |  | `0` |  |
| `last_attempt_at` | DATETIME | yes |  |  |  |
| `created_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `idx_inv_notif_queue_org_user` (`organization_id`, `user_id`)
- `idx_inv_notif_queue_pending` (`processed`, `created_at`)

### `inventory_write_offs`

**WriteOffRequest** · `app/models/inventory.py`

> Write-Off Request model When an inventory item is lost, damaged beyond repair, or otherwise needs to be removed from active inventory, a write-off request is created. Items above a configurable value threshold require supervisor approval before the write-off is finalized. Lower-value items may be auto-approved by quartermasters.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `item_id` | VARCHAR(36) | yes | FK, IDX |  | → `inventory_items.id` ON DELETE SET NULL |
| `item_name` | VARCHAR(255) | no |  |  |  |
| `item_serial_number` | VARCHAR(255) | yes |  |  |  |
| `item_asset_tag` | VARCHAR(255) | yes |  |  |  |
| `item_value` | NUMERIC(10, 2) | yes |  |  |  |
| `reason` | ENUM(`lost`, `damaged_beyond_repair`, `obsolete`, `stolen`, `other`) | no |  | `'lost'` |  |
| `description` | TEXT | no |  |  |  |
| `status` | ENUM(`pending`, `approved`, `denied`) | no | IDX | `pending` |  |
| `requested_by` | VARCHAR(36) | no | FK |  | → `users.id` ON DELETE RESTRICT |
| `reviewed_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `reviewed_at` | DATETIME | yes |  |  |  |
| `review_notes` | TEXT | yes |  |  |  |
| `clearance_id` | VARCHAR(36) | yes | FK |  | → `departure_clearances.id` ON DELETE SET NULL |
| `clearance_item_id` | VARCHAR(36) | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_write_off_item` (`item_id`)
- `idx_write_off_org_status` (`organization_id`, `status`)
- `ix_inventory_write_offs_status` (`status`)

### `issuance_allowances`

**IssuanceAllowance** · `app/models/inventory.py`

> Issuance Allowance model Defines how many units of a given category each member (by role or rank) can be issued per period. E.g. "Each firefighter gets 3 polo shirts per year."

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK |  | → `organizations.id` ON DELETE CASCADE |
| `category_id` | VARCHAR(36) | no | FK, IDX |  | → `inventory_categories.id` ON DELETE CASCADE |
| `role_id` | VARCHAR(36) | yes | FK |  | → `positions.id` ON DELETE CASCADE |
| `max_quantity` | INTEGER | no |  |  |  |
| `period_type` | VARCHAR(20) | yes |  | `'annual'` |  |
| `is_active` | BOOL | yes |  | `True` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` |

**Indexes**

- `ix_issuance_allowances_category_id` (`category_id`)

**Constraints**

- UNIQUE `uq_allowance_org_cat_role` (`organization_id`, `category_id`, `role_id`)

### `item_assignments`

**ItemAssignment** · `app/models/inventory.py`

> Item Assignment model Tracks history of permanent assignments (who has had which items over time).

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `item_id` | VARCHAR(36) | no | FK, IDX |  | → `inventory_items.id` ON DELETE CASCADE |
| `user_id` | VARCHAR(36) | no | FK, IDX |  | → `users.id` ON DELETE CASCADE |
| `assignment_type` | ENUM(`permanent`, `temporary`) | no |  | `permanent` |  |
| `assigned_date` | DATETIME | no |  | `now()` |  |
| `returned_date` | DATETIME | yes |  |  |  |
| `expected_return_date` | DATETIME | yes |  |  |  |
| `assigned_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `returned_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `assignment_reason` | TEXT | yes |  |  |  |
| `return_condition` | ENUM(`excellent`, `good`, `fair`, `poor`, `damaged`, `out_of_service`, `retired`) | yes |  |  |  |
| `return_notes` | TEXT | yes |  |  |  |
| `is_active` | BOOL | yes | IDX | `True` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_item_assignments_item_active` (`item_id`, `is_active`)
- `idx_item_assignments_org_active` (`organization_id`, `is_active`)
- `idx_item_assignments_org_item` (`organization_id`, `item_id`)
- `idx_item_assignments_org_user` (`organization_id`, `user_id`)
- `ix_item_assignments_is_active` (`is_active`)
- `ix_item_assignments_user_id` (`user_id`)

### `item_issuances`

**ItemIssuance** · `app/models/inventory.py`

> Item Issuance model Tracks units issued from a pool-tracked inventory item. For example: "Dept T-Shirt (Medium)" has quantity=20; issuing 1 to a member creates an ItemIssuance, decrements the pool's quantity, and increments quantity_issued. Returning reverses the operation.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `item_id` | VARCHAR(36) | no | FK, IDX |  | → `inventory_items.id` ON DELETE CASCADE |
| `user_id` | VARCHAR(36) | no | FK, IDX |  | → `users.id` ON DELETE CASCADE |
| `quantity_issued` | INTEGER | no |  | `1` |  |
| `issued_at` | DATETIME | no |  | `now()` |  |
| `returned_at` | DATETIME | yes |  |  |  |
| `issued_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `returned_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `issue_reason` | TEXT | yes |  |  |  |
| `return_condition` | ENUM(`excellent`, `good`, `fair`, `poor`, `damaged`, `out_of_service`, `retired`) | yes |  |  |  |
| `return_notes` | TEXT | yes |  |  |  |
| `is_returned` | BOOL | yes | IDX | `False` |  |
| `unit_cost_at_issuance` | NUMERIC(10, 2) | yes |  |  |  |
| `charge_status` | ENUM(`none`, `pending`, `charged`, `waived`) | yes |  | `none` |  |
| `charge_amount` | NUMERIC(10, 2) | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_item_issuances_org_item` (`organization_id`, `item_id`)
- `idx_item_issuances_org_returned` (`organization_id`, `is_returned`)
- `idx_item_issuances_org_user` (`organization_id`, `user_id`)
- `ix_item_issuances_is_returned` (`is_returned`)
- `ix_item_issuances_item_id` (`item_id`)
- `ix_item_issuances_user_id` (`user_id`)

### `item_variant_groups`

**ItemVariantGroup** · `app/models/inventory.py`

> Groups pool items that are size/color/style variants of the same logical product. E.g., "Dept T-Shirt" groups all size/color combos. Quartermasters manage one group instead of hunting through a flat list.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(255) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `category_id` | VARCHAR(36) | yes | FK |  | → `inventory_categories.id` ON DELETE SET NULL |
| `base_price` | NUMERIC(10, 2) | yes |  |  |  |
| `base_replacement_cost` | NUMERIC(10, 2) | yes |  |  |  |
| `unit_of_measure` | VARCHAR(50) | yes |  |  |  |
| `active` | BOOL | yes | IDX | `True` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` |

**Indexes**

- `idx_variant_groups_org_active` (`organization_id`, `active`)
- `ix_item_variant_groups_active` (`active`)

### `maintenance_records`

**MaintenanceRecord** · `app/models/inventory.py`

> Maintenance Record model Tracks inspections, repairs, cleaning, and other maintenance activities.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `item_id` | VARCHAR(36) | no | FK, IDX |  | → `inventory_items.id` ON DELETE CASCADE |
| `maintenance_type` | ENUM(`inspection`, `repair`, `cleaning`, `testing`, `calibration`, `replacement`, `preventive`, `routine_inspection`, `advanced_inspection`, `independent_inspection`, `advanced_cleaning`, `decontamination`) | no |  |  |  |
| `scheduled_date` | DATE | yes | IDX |  |  |
| `completed_date` | DATE | yes | IDX |  |  |
| `next_due_date` | DATE | yes | IDX |  |  |
| `performed_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `vendor_name` | VARCHAR(255) | yes |  |  |  |
| `cost` | NUMERIC(10, 2) | yes |  |  |  |
| `condition_before` | ENUM(`excellent`, `good`, `fair`, `poor`, `damaged`, `out_of_service`, `retired`) | yes |  |  |  |
| `condition_after` | ENUM(`excellent`, `good`, `fair`, `poor`, `damaged`, `out_of_service`, `retired`) | yes |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `parts_replaced` | JSON | yes |  |  |  |
| `parts_cost` | NUMERIC(10, 2) | yes |  |  |  |
| `labor_hours` | FLOAT | yes |  |  |  |
| `passed` | BOOL | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `issues_found` | JSON | yes |  |  |  |
| `attachments` | JSON | yes |  |  |  |
| `is_completed` | BOOL | yes | IDX | `False` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` |

**Indexes**

- `idx_maintenance_records_org_completed` (`organization_id`, `is_completed`)
- `idx_maintenance_records_org_item` (`organization_id`, `item_id`)
- `idx_maintenance_records_org_next_due` (`organization_id`, `next_due_date`)
- `idx_maintenance_records_org_scheduled` (`organization_id`, `scheduled_date`)
- `ix_maintenance_records_completed_date` (`completed_date`)
- `ix_maintenance_records_is_completed` (`is_completed`)
- `ix_maintenance_records_item_id` (`item_id`)
- `ix_maintenance_records_next_due_date` (`next_due_date`)
- `ix_maintenance_records_scheduled_date` (`scheduled_date`)

### `member_size_preferences`

**MemberSizePreferences** · `app/models/inventory.py`

> Stores a member's preferred sizes for different garment types. When issuing items, the system auto-suggests the correct size variant based on the member's preferences.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `user_id` | VARCHAR(36) | no | FK, UQ, UQ-IDX |  | → `users.id` ON DELETE CASCADE |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `shirt_size` | VARCHAR(20) | yes |  |  |  |
| `shirt_style` | VARCHAR(30) | yes |  |  |  |
| `pant_waist` | VARCHAR(10) | yes |  |  |  |
| `pant_inseam` | VARCHAR(10) | yes |  |  |  |
| `jacket_size` | VARCHAR(20) | yes |  |  |  |
| `boot_size` | VARCHAR(10) | yes |  |  |  |
| `boot_width` | VARCHAR(10) | yes |  |  |  |
| `glove_size` | VARCHAR(10) | yes |  |  |  |
| `hat_size` | VARCHAR(10) | yes |  |  |  |
| `custom_sizes` | JSON | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_member_sizes_org` (`organization_id`)
- UNIQUE `ix_member_size_preferences_user_id` (`user_id`)

### `nfpa_exposure_records`

**NFPAExposureRecord** · `app/models/inventory.py`

> Tracks hazardous exposure events for NFPA-tracked PPE items. NFPA 1851 §6.2 requires recording exposure events (fire, hazmat, bloodborne pathogen) so that appropriate cleaning and inspection can be performed.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `item_id` | VARCHAR(36) | no | FK, IDX |  | → `inventory_items.id` ON DELETE CASCADE |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `exposure_type` | ENUM(`structure_fire`, `vehicle_fire`, `wildland_fire`, `hazmat`, `bloodborne_pathogen`, `chemical`, `smoke`, `other`) | no |  |  |  |
| `exposure_date` | DATE | no |  |  |  |
| `incident_number` | VARCHAR(100) | yes |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `decon_required` | BOOL | yes |  | `False` |  |
| `decon_completed` | BOOL | yes |  | `False` |  |
| `decon_completed_date` | DATE | yes |  |  |  |
| `decon_method` | VARCHAR(255) | yes |  |  |  |
| `user_id` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` |

**Indexes**

- `idx_nfpa_exposure_org_date` (`organization_id`, `exposure_date`)
- `idx_nfpa_exposure_org_item` (`organization_id`, `item_id`)
- `ix_nfpa_exposure_records_item_id` (`item_id`)

### `nfpa_inspection_details`

**NFPAInspectionDetail** · `app/models/inventory.py`

> NFPA-specific inspection fields extending a MaintenanceRecord. When a maintenance record is created for an NFPA-tracked item with maintenance_type in (inspection, routine_inspection, advanced_inspection, independent_inspection), this record stores the structured pass/fail results required by NFPA 1851 Chapters 6-8.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `maintenance_record_id` | VARCHAR(36) | no | FK, UQ, UQ-IDX |  | → `maintenance_records.id` ON DELETE CASCADE |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `inspection_level` | ENUM(`routine`, `advanced`, `independent`) | no |  |  |  |
| `thermal_damage` | BOOL | yes |  |  |  |
| `moisture_barrier` | BOOL | yes |  |  |  |
| `seam_integrity` | BOOL | yes |  |  |  |
| `reflective_trim` | BOOL | yes |  |  |  |
| `closure_systems` | BOOL | yes |  |  |  |
| `liner_integrity` | BOOL | yes |  |  |  |
| `contamination_level` | ENUM(`none`, `light`, `moderate`, `heavy`, `gross`) | yes |  |  |  |
| `facepiece_seal` | BOOL | yes |  |  |  |
| `regulator_function` | BOOL | yes |  |  |  |
| `cylinder_pressure` | FLOAT | yes |  |  |  |
| `low_air_alarm` | BOOL | yes |  |  |  |
| `recommendation` | ENUM(`pass`, `repair`, `advanced_cleaning`, `retire`) | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_nfpa_inspection_org_level` (`organization_id`, `inspection_level`)
- UNIQUE `ix_nfpa_inspection_details_maintenance_record_id` (`maintenance_record_id`)

### `nfpa_item_compliance`

**NFPAItemCompliance** · `app/models/inventory.py`

> NFPA 1851/1852 compliance record for PPE and SCBA items. Stores lifecycle dates, ensemble grouping, and SCBA-specific fields required by NFPA standards. One-to-one with InventoryItem; only created when the item's category has nfpa_tracking_enabled = True.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `item_id` | VARCHAR(36) | no | FK, UQ, UQ-IDX |  | → `inventory_items.id` ON DELETE CASCADE |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `manufacture_date` | DATE | yes |  |  |  |
| `first_in_service_date` | DATE | yes |  |  |  |
| `expected_retirement_date` | DATE | yes |  |  |  |
| `retirement_reason` | VARCHAR(255) | yes |  |  |  |
| `is_retired_by_age` | BOOL | yes |  | `False` |  |
| `ensemble_id` | VARCHAR(36) | yes | IDX |  |  |
| `ensemble_role` | VARCHAR(50) | yes |  |  |  |
| `cylinder_manufacture_date` | DATE | yes |  |  |  |
| `cylinder_expiration_date` | DATE | yes |  |  |  |
| `hydrostatic_test_date` | DATE | yes |  |  |  |
| `hydrostatic_test_due` | DATE | yes |  |  |  |
| `flow_test_date` | DATE | yes |  |  |  |
| `flow_test_due` | DATE | yes |  |  |  |
| `contamination_level` | ENUM(`none`, `light`, `moderate`, `heavy`, `gross`) | yes |  | `'none'` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` |

**Indexes**

- `idx_nfpa_compliance_ensemble` (`organization_id`, `ensemble_id`)
- `idx_nfpa_compliance_retirement` (`organization_id`, `expected_retirement_date`)
- `ix_nfpa_item_compliance_ensemble_id` (`ensemble_id`)
- UNIQUE `ix_nfpa_item_compliance_item_id` (`item_id`)

### `property_return_reminders`

**PropertyReturnReminder** · `app/models/inventory.py`

> Tracks which property-return reminder notices have been sent to dropped members so we don't send duplicates.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `user_id` | VARCHAR(36) | no | FK, IDX |  | → `users.id` ON DELETE CASCADE |
| `reminder_type` | VARCHAR(20) | no |  |  |  |
| `items_outstanding` | INTEGER | no |  | `0` |  |
| `total_value_outstanding` | NUMERIC(10, 2) | no |  | `0` |  |
| `sent_to_member` | BOOL | no |  | `1` |  |
| `sent_to_admin` | BOOL | no |  | `1` |  |
| `sent_at` | DATETIME | yes |  | `now()` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_prop_reminder_org_user` (`organization_id`, `user_id`)
- `idx_prop_reminder_type` (`user_id`, `reminder_type`)

### `reorder_requests`

**ReorderRequest** · `app/models/inventory.py`

> Tracks reorder requests for inventory items that have dropped below their reorder point or low stock threshold. Admins/quartermasters create requests, track ordering status, and record receipt of goods.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `item_id` | VARCHAR(36) | yes | FK, IDX |  | → `inventory_items.id` ON DELETE SET NULL |
| `category_id` | VARCHAR(36) | yes | FK |  | → `inventory_categories.id` ON DELETE SET NULL |
| `item_name` | VARCHAR(255) | no |  |  |  |
| `quantity_requested` | INTEGER | no |  | `1` |  |
| `quantity_received` | INTEGER | yes |  |  |  |
| `vendor` | VARCHAR(255) | yes |  |  |  |
| `vendor_contact` | VARCHAR(255) | yes |  |  |  |
| `estimated_unit_cost` | NUMERIC(10, 2) | yes |  |  |  |
| `actual_unit_cost` | NUMERIC(10, 2) | yes |  |  |  |
| `purchase_order_number` | VARCHAR(255) | yes |  |  |  |
| `expected_delivery_date` | DATE | yes |  |  |  |
| `status` | ENUM(`pending`, `approved`, `ordered`, `received`, `cancelled`) | no | IDX | `pending` |  |
| `urgency` | ENUM(`low`, `normal`, `high`, `critical`) | no |  | `normal` |  |
| `notes` | TEXT | yes |  |  |  |
| `requested_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `approved_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `approved_at` | DATETIME | yes |  |  |  |
| `ordered_at` | DATETIME | yes |  |  |  |
| `received_at` | DATETIME | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_reorder_item` (`item_id`)
- `idx_reorder_org_status` (`organization_id`, `status`)
- `ix_reorder_requests_status` (`status`)

### `return_requests`

**ReturnRequest** · `app/models/inventory.py`

> Member-initiated return request. Members can declare they want to return equipment. A quartermaster reviews and either approves (triggering the actual return) or denies the request. This prevents members from simply claiming they returned an item without physical validation.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `requester_id` | VARCHAR(36) | no | FK, IDX |  | → `users.id` ON DELETE CASCADE |
| `return_type` | ENUM(`assignment`, `issuance`, `checkout`) | no |  |  |  |
| `item_id` | VARCHAR(36) | no | FK |  | → `inventory_items.id` ON DELETE CASCADE |
| `item_name` | VARCHAR(255) | no |  |  |  |
| `assignment_id` | VARCHAR(36) | yes | FK |  | → `item_assignments.id` ON DELETE SET NULL |
| `issuance_id` | VARCHAR(36) | yes | FK |  | → `item_issuances.id` ON DELETE SET NULL |
| `checkout_id` | VARCHAR(36) | yes | FK |  | → `checkout_records.id` ON DELETE SET NULL |
| `quantity_returning` | INTEGER | no |  | `1` |  |
| `reported_condition` | ENUM(`excellent`, `good`, `fair`, `poor`, `damaged`, `out_of_service`, `retired`) | no |  | `'good'` |  |
| `member_notes` | TEXT | yes |  |  |  |
| `status` | ENUM(`pending`, `approved`, `denied`, `completed`) | no | IDX | `'pending'` |  |
| `reviewed_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `reviewed_at` | DATETIME | yes |  |  |  |
| `review_notes` | TEXT | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_return_requests_org_status` (`organization_id`, `status`)
- `idx_return_requests_requester` (`requester_id`, `status`)
- `ix_return_requests_status` (`status`)

### `storage_areas`

**StorageArea** · `app/models/inventory.py`

> Storage Area model Provides structured storage location hierarchy within rooms/locations. Hierarchy: Room (Location) → Storage Area → Rack/Closet → Shelf → Box Each storage area can have a parent, enabling flexible nesting: - A rack belongs to a room (via location_id) - A shelf belongs to a rack (via parent_id) - A box belongs to a shelf (via parent_id) or directly to a room

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(255) | no |  |  |  |
| `label` | VARCHAR(100) | yes |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `storage_type` | ENUM(`rack`, `shelf`, `box`, `cabinet`, `drawer`, `bin`, `other`) | no |  |  |  |
| `parent_id` | VARCHAR(36) | yes | FK, IDX |  | → `storage_areas.id` ON DELETE CASCADE |
| `location_id` | VARCHAR(36) | yes | FK, IDX |  | → `locations.id` ON DELETE SET NULL |
| `barcode` | VARCHAR(255) | yes |  |  |  |
| `sort_order` | INTEGER | yes |  | `0` |  |
| `is_active` | BOOL | yes | IDX | `True` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` |

**Indexes**

- `idx_storage_areas_location` (`location_id`)
- `idx_storage_areas_org` (`organization_id`)
- `idx_storage_areas_parent` (`parent_id`)
- `ix_storage_areas_is_active` (`is_active`)

## Locations

### `locations`

**Location** · `app/models/location.py`

> Location model for managing physical spaces Tracks locations where events can be held, such as meeting halls, conference rooms, offices, etc. Supports room booking and QR code display for event check-ins.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(200) | no | IDX |  |  |
| `description` | TEXT | yes |  |  |  |
| `address` | VARCHAR(255) | yes |  |  |  |
| `city` | VARCHAR(100) | yes |  |  |  |
| `state` | VARCHAR(50) | yes |  |  |  |
| `zip` | VARCHAR(20) | yes |  |  |  |
| `latitude` | VARCHAR(20) | yes |  |  |  |
| `longitude` | VARCHAR(20) | yes |  |  |  |
| `building` | VARCHAR(100) | yes |  |  |  |
| `floor` | VARCHAR(20) | yes |  |  |  |
| `room_number` | VARCHAR(50) | yes |  |  |  |
| `capacity` | INTEGER | yes |  |  |  |
| `is_active` | BOOL | no | IDX | `1` |  |
| `display_code` | VARCHAR(12) | yes | UQ, UQ-IDX |  |  |
| `facility_id` | VARCHAR(36) | yes | FK, IDX |  | → `facilities.id` ON DELETE SET NULL |
| `facility_room_id` | VARCHAR(36) | yes | FK, UQ |  | → `facility_rooms.id` ON DELETE SET NULL |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- UNIQUE `ix_locations_display_code` (`display_code`)
- `ix_locations_facility_id` (`facility_id`)
- `ix_locations_is_active` (`is_active`)
- `ix_locations_name` (`name`)
- `ix_locations_organization_id` (`organization_id`)

**Constraints**

- UNIQUE `uq_locations_facility_room_id` (`facility_room_id`)

## Medical Screening

### `screening_records`

**ScreeningRecord** · `app/models/medical_screening.py`

> Individual screening instance for a user or prospective member. Links to either a user_id (active member) or a prospect_id (prospective member in the pipeline), but not both.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `requirement_id` | VARCHAR(36) | yes | FK |  | → `screening_requirements.id` ON DELETE SET NULL |
| `user_id` | VARCHAR(36) | yes | FK, IDX |  | → `users.id` ON DELETE CASCADE |
| `prospect_id` | VARCHAR(36) | yes | FK, IDX |  | → `prospective_members.id` ON DELETE CASCADE |
| `screening_type` | ENUM(`physical_exam`, `medical_clearance`, `drug_screening`, `vision_hearing`, `fitness_assessment`, `psychological`) | no |  |  |  |
| `status` | ENUM(`scheduled`, `completed`, `passed`, `failed`, `pending_review`, `waived`, `expired`) | no |  | `scheduled` |  |
| `scheduled_date` | DATE | yes |  |  |  |
| `completed_date` | DATE | yes |  |  |  |
| `expiration_date` | DATE | yes |  |  |  |
| `provider_name` | TEXT | yes |  |  |  |
| `result_summary` | TEXT | yes |  |  |  |
| `result_data` | TEXT | yes |  |  |  |
| `reviewed_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `reviewed_at` | DATETIME | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_screening_rec_expiration` (`organization_id`, `expiration_date`)
- `idx_screening_rec_prospect` (`prospect_id`)
- `idx_screening_rec_status` (`organization_id`, `status`)
- `idx_screening_rec_user` (`user_id`)

### `screening_requirements`

**ScreeningRequirement** · `app/models/medical_screening.py`

> Organization-level definition of a required screening. Defines what screenings are required, how often, and for which roles. For example: 'Annual Physical Exam' required every 12 months for all firefighters and EMTs.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(255) | no |  |  |  |
| `screening_type` | ENUM(`physical_exam`, `medical_clearance`, `drug_screening`, `vision_hearing`, `fitness_assessment`, `psychological`) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `frequency_months` | INTEGER | yes |  |  |  |
| `applies_to_roles` | JSON | yes |  |  |  |
| `is_active` | BOOL | no |  | `1` |  |
| `grace_period_days` | INTEGER | no |  | `30` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_screening_req_org_type` (`organization_id`, `screening_type`)

## Meeting Minutes

### `meeting_minutes`

**MeetingMinutes** · `app/models/minute.py`

> Meeting Minutes model Records the official minutes of a meeting, including attendees, agenda items, motions, and action items.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `title` | VARCHAR(300) | no |  |  |  |
| `meeting_type` | ENUM(`business`, `special`, `committee`, `board`, `trustee`, `executive`, `annual`, `other`) | no | IDX | `business` |  |
| `meeting_date` | DATETIME | no | IDX |  |  |
| `location` | VARCHAR(300) | yes |  |  |  |
| `called_by` | VARCHAR(200) | yes |  |  |  |
| `called_to_order_at` | DATETIME | yes |  |  |  |
| `adjourned_at` | DATETIME | yes |  |  |  |
| `attendees` | JSON | yes |  |  |  |
| `quorum_met` | BOOL | yes |  |  |  |
| `quorum_count` | INTEGER | yes |  |  |  |
| `quorum_type` | VARCHAR(20) | yes |  |  |  |
| `quorum_threshold` | FLOAT | yes |  |  |  |
| `sections` | JSON | yes |  |  |  |
| `template_id` | VARCHAR(36) | yes | FK |  | → `minutes_templates.id` ON DELETE SET NULL |
| `header_config` | JSON | yes |  |  |  |
| `footer_config` | JSON | yes |  |  |  |
| `published_document_id` | VARCHAR(36) | yes |  |  |  |
| `agenda` | TEXT | yes |  |  |  |
| `old_business` | TEXT | yes |  |  |  |
| `new_business` | TEXT | yes |  |  |  |
| `treasurer_report` | TEXT | yes |  |  |  |
| `chief_report` | TEXT | yes |  |  |  |
| `committee_reports` | TEXT | yes |  |  |  |
| `announcements` | TEXT | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `status` | ENUM(`draft`, `submitted`, `approved`, `rejected`) | no | IDX | `draft` |  |
| `submitted_at` | DATETIME | yes |  |  |  |
| `submitted_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `approved_at` | DATETIME | yes |  |  |  |
| `approved_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `rejected_at` | DATETIME | yes |  |  |  |
| `rejected_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `rejection_reason` | TEXT | yes |  |  |  |
| `event_id` | VARCHAR(36) | yes | FK |  | → `events.id` ON DELETE SET NULL |
| `meeting_id` | VARCHAR(36) | yes | FK |  | → `meetings.id` ON DELETE SET NULL |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_meeting_minutes_meeting_date` (`meeting_date`)
- `ix_meeting_minutes_meeting_type` (`meeting_type`)
- `ix_meeting_minutes_organization_id` (`organization_id`)
- `ix_meeting_minutes_status` (`status`)

### `meeting_motions`

**Motion** · `app/models/minute.py`

> Motion model Records a formal motion made during a meeting, including who moved/seconded, the vote tally, and the result.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `minutes_id` | VARCHAR(36) | no | FK, IDX |  | → `meeting_minutes.id` ON DELETE CASCADE |
| `order` | INTEGER | no |  | `0` |  |
| `motion_text` | TEXT | no |  |  |  |
| `moved_by` | VARCHAR(200) | yes |  |  |  |
| `seconded_by` | VARCHAR(200) | yes |  |  |  |
| `discussion_notes` | TEXT | yes |  |  |  |
| `status` | ENUM(`passed`, `failed`, `tabled`, `withdrawn`) | no |  | `passed` |  |
| `votes_for` | INTEGER | yes |  |  |  |
| `votes_against` | INTEGER | yes |  |  |  |
| `votes_abstain` | INTEGER | yes |  |  |  |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_meeting_motions_minutes_id` (`minutes_id`)

### `minutes_action_items`

**ActionItem** · `app/models/minute.py`

> Action Item model Tracks tasks assigned during a meeting with assignee, due date, and completion tracking.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `minutes_id` | VARCHAR(36) | no | FK, IDX |  | → `meeting_minutes.id` ON DELETE CASCADE |
| `description` | TEXT | no |  |  |  |
| `assignee_id` | VARCHAR(36) | yes | FK, IDX |  | → `users.id` |
| `assignee_name` | VARCHAR(200) | yes |  |  |  |
| `due_date` | DATETIME | yes | IDX |  |  |
| `priority` | ENUM(`low`, `medium`, `high`, `urgent`) | no |  | `medium` |  |
| `status` | ENUM(`pending`, `in_progress`, `completed`, `cancelled`, `overdue`) | no | IDX | `pending` |  |
| `completed_at` | DATETIME | yes |  |  |  |
| `completion_notes` | TEXT | yes |  |  |  |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_minutes_action_items_assignee_id` (`assignee_id`)
- `ix_minutes_action_items_due_date` (`due_date`)
- `ix_minutes_action_items_minutes_id` (`minutes_id`)
- `ix_minutes_action_items_status` (`status`)

### `minutes_templates`

**MinutesTemplate** · `app/models/minute.py`

> Meeting Minutes Template Defines a reusable template with predefined sections, ordering, and document header/footer configuration for uniform output.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(200) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `meeting_type` | ENUM(`business`, `special`, `committee`, `board`, `trustee`, `executive`, `annual`, `other`) | no | IDX | `business` |  |
| `is_default` | BOOL | no |  | `0` |  |
| `sections` | JSON | no |  |  |  |
| `header_config` | JSON | yes |  |  |  |
| `footer_config` | JSON | yes |  |  |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_minutes_templates_meeting_type` (`meeting_type`)
- `ix_minutes_templates_organization_id` (`organization_id`)

## Meetings

### `meeting_action_items`

**MeetingActionItem** · `app/models/meeting.py`

> Meeting Action Item model Tracks action items assigned during meetings.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `meeting_id` | VARCHAR(36) | no | FK, IDX |  | → `meetings.id` ON DELETE CASCADE |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `description` | TEXT | no |  |  |  |
| `assigned_to` | VARCHAR(36) | yes | FK, IDX |  | → `users.id` |
| `due_date` | DATE | yes |  |  |  |
| `status` | ENUM(`open`, `in_progress`, `completed`, `cancelled`) | no |  | `open` |  |
| `priority` | INTEGER | yes |  | `0` |  |
| `completed_at` | DATETIME | yes |  |  |  |
| `completion_notes` | TEXT | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_action_items_assigned` (`assigned_to`, `status`)
- `idx_action_items_meeting` (`meeting_id`)
- `idx_action_items_org_status` (`organization_id`, `status`)

### `meeting_attendees`

**MeetingAttendee** · `app/models/meeting.py`

> Meeting Attendee model Tracks who attended a meeting.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `meeting_id` | VARCHAR(36) | no | FK, IDX |  | → `meetings.id` ON DELETE CASCADE |
| `user_id` | VARCHAR(36) | no | FK, IDX |  | → `users.id` ON DELETE CASCADE |
| `present` | BOOL | yes |  | `True` |  |
| `excused` | BOOL | yes |  | `False` |  |
| `waiver_reason` | TEXT | yes |  |  |  |
| `waiver_granted_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `waiver_granted_at` | DATETIME | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_meeting_attendees_meeting` (`meeting_id`)
- `idx_meeting_attendees_organization` (`organization_id`)
- `idx_meeting_attendees_user` (`user_id`)

### `meetings`

**Meeting** · `app/models/meeting.py`

> Meeting model Represents a meeting with its minutes, attendees, and action items.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `title` | VARCHAR(255) | no |  |  |  |
| `meeting_type` | ENUM(`business`, `special`, `committee`, `board`, `other`) | no |  | `business` |  |
| `meeting_date` | DATE | no | IDX |  |  |
| `start_time` | TIME | yes |  |  |  |
| `end_time` | TIME | yes |  |  |  |
| `location` | VARCHAR(255) | yes |  |  |  |
| `event_id` | VARCHAR(36) | yes | FK, IDX |  | → `events.id` ON DELETE SET NULL |
| `location_id` | VARCHAR(36) | yes | FK, IDX |  | → `locations.id` ON DELETE SET NULL |
| `called_by` | VARCHAR(255) | yes |  |  |  |
| `status` | ENUM(`draft`, `pending_approval`, `approved`) | no |  | `draft` |  |
| `agenda` | TEXT | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `motions` | TEXT | yes |  |  |  |
| `approved_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `approved_at` | DATETIME | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` |

**Indexes**

- `idx_meetings_org_date` (`organization_id`, `meeting_date`)
- `idx_meetings_org_status` (`organization_id`, `status`)
- `idx_meetings_org_type` (`organization_id`, `meeting_type`)
- `ix_meetings_event_id` (`event_id`)
- `ix_meetings_location_id` (`location_id`)
- `ix_meetings_meeting_date` (`meeting_date`)

## Membership Pipeline

### `membership_pipeline_steps`

**MembershipPipelineStep** · `app/models/membership_pipeline.py`

> A single step within a membership pipeline. Steps can be action-based (send email, schedule meeting), checkbox-based (mark complete), or note-based (add comments). Coordinators can add, remove, and reorder steps.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `pipeline_id` | VARCHAR(36) | no | FK, IDX |  | → `membership_pipelines.id` ON DELETE CASCADE |
| `name` | VARCHAR(255) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `step_type` | ENUM(`action`, `checkbox`, `note`, `form_submission`, `document_upload`, `election_vote`, `manual_approval`, `meeting`, `status_page_toggle`, `automated_email`, `reference_check`, `checklist`, `interview_requirement`, `multi_approval`, `medical_screening`) | no |  | `checkbox` |  |
| `action_type` | ENUM(`send_email`, `schedule_meeting`, `collect_document`, `custom`) | yes |  |  |  |
| `is_first_step` | BOOL | yes |  | `False` |  |
| `is_final_step` | BOOL | yes |  | `False` |  |
| `sort_order` | INTEGER | no |  | `0` |  |
| `email_template_id` | VARCHAR(36) | yes | FK, IDX |  | → `email_templates.id` ON DELETE SET NULL |
| `required` | BOOL | yes |  | `True` |  |
| `config` | JSON | yes |  | `dict()` |  |
| `inactivity_timeout_days` | INTEGER | yes |  |  |  |
| `notify_prospect_on_completion` | BOOL | yes |  | `False` |  |
| `public_visible` | BOOL | yes |  | `True` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_pipeline_step_order` (`pipeline_id`, `sort_order`)
- `ix_membership_pipeline_steps_email_template_id` (`email_template_id`)

### `membership_pipelines`

**MembershipPipeline** · `app/models/membership_pipeline.py`

> Pipeline definition for prospective member onboarding. Each organization can have multiple pipelines (e.g., from templates) but only one is marked as the default active pipeline.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(255) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `is_template` | BOOL | yes | IDX | `False` |  |
| `is_default` | BOOL | yes |  | `False` |  |
| `is_active` | BOOL | yes | IDX | `True` |  |
| `auto_transfer_on_approval` | BOOL | yes |  | `False` |  |
| `inactivity_config` | JSON | yes |  | `dict()` |  |
| `public_status_enabled` | BOOL | yes |  | `False` |  |
| `report_stage_groups` | JSON | yes |  | `list()` |  |
| `created_by` | VARCHAR(36) | yes | FK, IDX |  | → `users.id` |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_pipeline_org_default` (`organization_id`, `is_default`)
- `idx_pipeline_org_template` (`organization_id`, `is_template`)
- `ix_membership_pipelines_created_by` (`created_by`)
- `ix_membership_pipelines_is_active` (`is_active`)
- `ix_membership_pipelines_is_template` (`is_template`)

### `prospect_activity_log`

**ProspectActivityLog** · `app/models/membership_pipeline.py`

> Audit trail for prospect-related actions. Records every meaningful action taken on a prospect for accountability and history tracking.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `prospect_id` | VARCHAR(36) | no | FK, IDX |  | → `prospective_members.id` ON DELETE CASCADE |
| `action` | VARCHAR(100) | no | IDX |  |  |
| `details` | JSON | yes |  |  |  |
| `performed_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_activity_log_action` (`action`)
- `idx_activity_log_prospect` (`prospect_id`)

### `prospect_documents`

**ProspectDocument** · `app/models/membership_pipeline.py`

> Document uploaded for a prospective member. Tracks files attached during the pipeline process, such as ID photos, background checks, certifications, etc.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `prospect_id` | VARCHAR(36) | no | FK, IDX |  | → `prospective_members.id` ON DELETE CASCADE |
| `step_id` | VARCHAR(36) | yes | FK |  | → `membership_pipeline_steps.id` ON DELETE SET NULL |
| `document_type` | VARCHAR(100) | no |  |  |  |
| `file_name` | VARCHAR(255) | no |  |  |  |
| `file_path` | VARCHAR(500) | no |  |  |  |
| `file_size` | INTEGER | yes |  | `0` |  |
| `mime_type` | VARCHAR(100) | yes |  |  |  |
| `uploaded_by` | VARCHAR(36) | yes | FK, IDX |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_prospect_doc_prospect` (`prospect_id`)
- `ix_prospect_documents_uploaded_by` (`uploaded_by`)

### `prospect_election_packages`

**ProspectElectionPackage** · `app/models/membership_pipeline.py`

> Election package for a prospective member. Bundles applicant information for the membership vote, integrating with the Elections module.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `prospect_id` | VARCHAR(36) | no | FK, IDX |  | → `prospective_members.id` ON DELETE CASCADE |
| `pipeline_id` | VARCHAR(36) | yes | FK |  | → `membership_pipelines.id` ON DELETE SET NULL |
| `step_id` | VARCHAR(36) | yes | FK |  | → `membership_pipeline_steps.id` ON DELETE SET NULL |
| `election_id` | VARCHAR(36) | yes | FK |  | → `elections.id` ON DELETE SET NULL |
| `status` | VARCHAR(20) | no | IDX | `draft` |  |
| `applicant_snapshot` | JSON | yes |  | `dict()` |  |
| `coordinator_notes` | TEXT | yes |  |  |  |
| `package_config` | JSON | yes |  | `dict()` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_election_pkg_prospect` (`prospect_id`)
- `idx_election_pkg_status` (`status`)

### `prospect_event_links`

**ProspectEventLink** · `app/models/membership_pipeline.py`

> Links a prospective member to an upcoming event. Allows coordinators to associate relevant events (e.g., meetings, trainings, social gatherings) with a prospect so they can be invited or tracked against those events.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `prospect_id` | VARCHAR(36) | no | FK, UQ-IDX |  | → `prospective_members.id` ON DELETE CASCADE |
| `event_id` | VARCHAR(36) | no | FK, IDX |  | → `events.id` ON DELETE CASCADE |
| `notes` | TEXT | yes |  |  |  |
| `linked_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- UNIQUE `idx_prospect_event_link_unique` (`prospect_id`, `event_id`)
- `ix_prospect_event_links_event_id` (`event_id`)

### `prospect_interviews`

**ProspectInterview** · `app/models/membership_pipeline.py`

> Interview record for a prospective member. Tracks interviews conducted by department members (membership coordinators, chiefs, presidents, etc.) at different stages of the pipeline. Multiple interviewers can submit their own notes and recommendations.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `prospect_id` | VARCHAR(36) | no | FK, IDX |  | → `prospective_members.id` ON DELETE CASCADE |
| `pipeline_id` | VARCHAR(36) | yes | FK |  | → `membership_pipelines.id` ON DELETE SET NULL |
| `step_id` | VARCHAR(36) | yes | FK |  | → `membership_pipeline_steps.id` ON DELETE SET NULL |
| `interviewer_id` | VARCHAR(36) | yes | FK, IDX |  | → `users.id` ON DELETE SET NULL |
| `interviewer_role` | VARCHAR(100) | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `recommendation` | ENUM(`recommend`, `recommend_with_reservations`, `do_not_recommend`, `undecided`) | yes |  |  |  |
| `recommendation_notes` | TEXT | yes |  |  |  |
| `interview_date` | DATETIME | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_interview_interviewer` (`interviewer_id`)
- `idx_interview_prospect_interviewer` (`prospect_id`, `interviewer_id`)

### `prospect_step_progress`

**ProspectStepProgress** · `app/models/membership_pipeline.py`

> Tracks a prospect's progress on each pipeline step. One record per prospect-step combination, updated as the prospect advances through the pipeline.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `prospect_id` | VARCHAR(36) | no | FK, UQ-IDX |  | → `prospective_members.id` ON DELETE CASCADE |
| `step_id` | VARCHAR(36) | no | FK, IDX |  | → `membership_pipeline_steps.id` ON DELETE CASCADE |
| `status` | ENUM(`pending`, `in_progress`, `completed`, `skipped`) | no |  | `pending` |  |
| `completed_at` | DATETIME | yes |  |  |  |
| `completed_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `notes` | TEXT | yes |  |  |  |
| `action_result` | JSON | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- UNIQUE `idx_step_progress_prospect_step` (`prospect_id`, `step_id`)
- `ix_prospect_step_progress_step_id` (`step_id`)

### `prospective_members`

**ProspectiveMember** · `app/models/membership_pipeline.py`

> Prospective member record, kept separate from the users table. Only copied to the users table when elected into membership, either automatically or via manual transfer by the coordinator.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `pipeline_id` | VARCHAR(36) | yes | FK, IDX |  | → `membership_pipelines.id` ON DELETE SET NULL |
| `first_name` | VARCHAR(100) | no |  |  |  |
| `last_name` | VARCHAR(100) | no |  |  |  |
| `email` | VARCHAR(255) | no |  |  |  |
| `phone` | VARCHAR(20) | yes |  |  |  |
| `mobile` | VARCHAR(20) | yes |  |  |  |
| `date_of_birth` | DATE | yes |  |  |  |
| `address_street` | VARCHAR(255) | yes |  |  |  |
| `address_city` | VARCHAR(100) | yes |  |  |  |
| `address_state` | VARCHAR(50) | yes |  |  |  |
| `address_zip` | VARCHAR(20) | yes |  |  |  |
| `interest_reason` | TEXT | yes |  |  |  |
| `referral_source` | VARCHAR(255) | yes |  |  |  |
| `referred_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `desired_membership_type` | VARCHAR(50) | yes |  |  |  |
| `current_step_id` | VARCHAR(36) | yes | FK |  | → `membership_pipeline_steps.id` ON DELETE SET NULL |
| `status` | ENUM(`active`, `on_hold`, `approved`, `rejected`, `withdrawn`, `inactive`, `transferred`) | no | IDX | `active` |  |
| `metadata` | JSON | yes |  | `dict()` |  |
| `form_submission_id` | VARCHAR(36) | yes | FK |  | → `form_submissions.id` ON DELETE SET NULL |
| `status_token` | VARCHAR(64) | yes | UQ, UQ-IDX |  |  |
| `status_token_created_at` | DATETIME | yes |  |  |  |
| `transferred_user_id` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `transferred_at` | DATETIME | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_prospect_org_email` (`organization_id`, `email`)
- `idx_prospect_org_pipeline` (`organization_id`, `pipeline_id`)
- `idx_prospect_org_status` (`organization_id`, `status`)
- `ix_prospective_members_pipeline_id` (`pipeline_id`)
- `ix_prospective_members_status` (`status`)
- UNIQUE `ix_prospective_members_status_token` (`status_token`)

## Notifications

### `department_message_reads`

**DepartmentMessageRead** · `app/models/notification.py`

> Tracks which users have read/acknowledged a department message.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `message_id` | VARCHAR(36) | no | FK |  | → `department_messages.id` ON DELETE CASCADE |
| `user_id` | VARCHAR(36) | no | FK, IDX |  | → `users.id` ON DELETE CASCADE |
| `read_at` | DATETIME | yes |  | `now()` |  |
| `acknowledged_at` | DATETIME | yes |  |  |  |

**Indexes**

- `idx_dept_msg_read_user` (`user_id`)

**Constraints**

- UNIQUE `uq_dept_msg_read_user` (`message_id`, `user_id`)

### `department_messages`

**DepartmentMessage** · `app/models/notification.py`

> Department Message model Represents an internal message/announcement sent by leadership to department members. Messages can target all members, specific roles, statuses, or individual members. They appear on the dashboard and remain visible until dismissed or expired.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `title` | VARCHAR(500) | no |  |  |  |
| `body` | TEXT | no |  |  |  |
| `priority` | ENUM(`normal`, `important`, `urgent`) | no |  | `normal` |  |
| `target_type` | ENUM(`all`, `roles`, `statuses`, `members`) | no |  | `all` |  |
| `target_roles` | JSON | yes |  |  |  |
| `target_statuses` | JSON | yes |  |  |  |
| `target_member_ids` | JSON | yes |  |  |  |
| `is_pinned` | BOOL | yes |  | `False` |  |
| `is_active` | BOOL | yes |  | `True` |  |
| `is_persistent` | BOOL | yes |  | `False` |  |
| `requires_acknowledgment` | BOOL | yes |  | `False` |  |
| `posted_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `expires_at` | DATETIME | yes |  |  |  |
| `deleted_at` | DATETIME | yes |  |  |  |
| `scheduled_at` | DATETIME | yes | IDX |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_dept_msg_org_active_expires` (`organization_id`, `is_active`, `expires_at`)
- `idx_dept_msg_org_pinned` (`organization_id`, `is_pinned`)
- `idx_dept_msg_scheduled_at` (`scheduled_at`)

### `notification_logs`

**NotificationLog** · `app/models/notification.py`

> Notification Log model Records sent notifications for tracking and debugging.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `rule_id` | VARCHAR(36) | yes | FK, IDX |  | → `notification_rules.id` ON DELETE SET NULL |
| `recipient_id` | VARCHAR(36) | yes | FK, IDX |  | → `users.id` ON DELETE SET NULL |
| `recipient_email` | VARCHAR(255) | yes |  |  |  |
| `channel` | ENUM(`email`, `in_app`) | no |  |  |  |
| `subject` | VARCHAR(500) | yes |  |  |  |
| `message` | TEXT | yes |  |  |  |
| `category` | VARCHAR(50) | yes | IDX |  |  |
| `sent_at` | DATETIME | yes |  | `now()` |  |
| `delivered` | BOOL | yes |  | `False` |  |
| `read` | BOOL | yes |  | `False` |  |
| `read_at` | DATETIME | yes |  |  |  |
| `pinned` | BOOL | yes |  | `False` |  |
| `error` | TEXT | yes |  |  |  |
| `action_url` | VARCHAR(500) | yes |  |  |  |
| `metadata` | JSON | yes |  |  |  |
| `expires_at` | DATETIME | yes | IDX |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_notif_logs_org_sent` (`organization_id`, `sent_at`)
- `idx_notif_logs_recipient` (`recipient_id`)
- `ix_notification_logs_category` (`category`)
- `ix_notification_logs_expires_at` (`expires_at`)
- `ix_notification_logs_rule_id` (`rule_id`)

### `notification_rules`

**NotificationRule** · `app/models/notification.py`

> Notification Rule model Defines automated notification rules for an organization.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(255) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `trigger` | ENUM(`event_reminder`, `training_expiry`, `schedule_change`, `new_member`, `member_dropped`, `maintenance_due`, `election_started`, `form_submitted`, `action_item_assigned`, `meeting_scheduled`, `document_uploaded`) | no |  |  |  |
| `category` | ENUM(`events`, `training`, `scheduling`, `members`, `maintenance`, `general`) | no |  | `general` |  |
| `channel` | ENUM(`email`, `in_app`) | no |  | `in_app` |  |
| `enabled` | BOOL | yes |  | `True` |  |
| `config` | JSON | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` |

**Indexes**

- `idx_notif_rules_org_enabled` (`organization_id`, `enabled`)
- `idx_notif_rules_org_trigger` (`organization_id`, `trigger`)

### `push_subscriptions`

**PushSubscription** · `app/models/notification.py`

> A single browser/device Web Push endpoint belonging to a user. One row per device, not per user: a member may install the PWA on a phone and a station tablet and expects both to ring. Endpoints are issued by the browser's push service and are opaque; `p256dh` and `auth` are the client's public key and shared secret, required to encrypt the payload so the push service (Apple/Google/Mozilla) cannot read it. Rows are removed when the push service reports the endpoint is gone (HTTP 404/410), which happens when the user uninstalls the PWA or clears site data — there is no unsubscribe callback to rely on.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `user_id` | VARCHAR(36) | no | FK, IDX |  | → `users.id` ON DELETE CASCADE |
| `endpoint` | TEXT | no |  |  |  |
| `endpoint_hash` | VARCHAR(64) | no |  |  |  |
| `p256dh` | VARCHAR(255) | no |  |  |  |
| `auth` | VARCHAR(255) | no |  |  |  |
| `user_agent` | VARCHAR(500) | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `last_used_at` | DATETIME | yes |  |  |  |

**Indexes**

- `idx_push_sub_org_user` (`organization_id`, `user_id`)
- `ix_push_subscriptions_organization_id` (`organization_id`)
- `ix_push_subscriptions_user_id` (`user_id`)

**Constraints**

- UNIQUE `uq_push_sub_endpoint` (`endpoint_hash`)

## Onboarding

### `onboarding_sessions`

**OnboardingSessionModel** · `app/models/onboarding.py`

> Server-side onboarding session storage SECURITY: Stores sensitive onboarding data encrypted server-side instead of in browser sessionStorage. This prevents passwords, API keys, and secrets from being exposed in the browser. Session data includes: - Department configuration - Email/authentication settings (encrypted) - File storage configuration (encrypted) - Admin user credentials (encrypted) - IT team information Sessions expire after 2 hours of inactivity.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `session_id` | VARCHAR(64) | no | UQ, UQ-IDX |  |  |
| `data` | JSON | no |  | `dict()` |  |
| `ip_address` | VARCHAR(45) | no |  |  |  |
| `user_agent` | TEXT | yes |  |  |  |
| `expires_at` | DATETIME | no | IDX |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `ix_onboarding_sessions_expires_at` (`expires_at`)
- UNIQUE `ix_onboarding_sessions_session_id` (`session_id`)

### `onboarding_status`

**OnboardingStatus** · `app/models/onboarding.py`

> System-wide onboarding status Tracks whether the system has completed initial setup. Only one row should exist in this table.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `is_completed` | BOOL | no |  | `0` |  |
| `completed_at` | DATETIME | yes |  |  |  |
| `steps_completed` | JSON | yes |  | `dict()` |  |
| `current_step` | INTEGER | yes |  | `0` |  |
| `organization_name` | VARCHAR(255) | yes |  |  |  |
| `organization_type` | VARCHAR(50) | yes |  |  |  |
| `admin_email` | VARCHAR(255) | yes |  |  |  |
| `admin_username` | VARCHAR(100) | yes |  |  |  |
| `security_keys_verified` | BOOL | yes |  | `False` |  |
| `database_verified` | BOOL | yes |  | `False` |  |
| `email_configured` | BOOL | yes |  | `False` |  |
| `enabled_modules` | JSON | yes |  | `list()` |  |
| `timezone` | VARCHAR(50) | yes |  | `'America/New_York'` |  |
| `setup_started_at` | DATETIME | yes |  | `now()` |  |
| `setup_ip_address` | VARCHAR(45) | yes |  |  |  |
| `setup_user_agent` | TEXT | yes |  |  |  |
| `setup_notes` | TEXT | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

## Operational Ranks

### `operational_ranks`

**OperationalRank** · `app/models/operational_rank.py`

> Configurable operational rank for a department. Each organization maintains its own rank list. The ``rank_code`` is the machine-friendly slug stored on ``User.rank``; the ``display_name`` is shown in the UI.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK |  | → `organizations.id` ON DELETE CASCADE |
| `rank_code` | VARCHAR(100) | no |  |  |  |
| `display_name` | VARCHAR(200) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `sort_order` | INTEGER | no |  | `0` |  |
| `is_active` | BOOL | no |  | `1` |  |
| `eligible_positions` | JSON | yes |  | `list()` |  |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Constraints**

- UNIQUE `uq_ranks_org_code` (`organization_id`, `rank_code`)

## Organization_Officer

### `organization_officers`

**OrganizationOfficer** · `app/models/organization_officer.py`

> One department office and the member who currently holds it. ``user_id`` is the normal case: the name/email/phone are read from that member's record so they stay correct when the member updates their profile. The override columns exist for the cases a member record cannot express — an office held by someone without a login, a signature title that differs from the office label ("Fire Chief" vs. "Chief"), or a published office address that is not the holder's personal one.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK |  | → `organizations.id` ON DELETE CASCADE |
| `office_key` | VARCHAR(50) | no |  |  |  |
| `user_id` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `display_name` | VARCHAR(200) | yes |  |  |  |
| `title` | VARCHAR(150) | yes |  |  |  |
| `email` | VARCHAR(320) | yes |  |  |  |
| `phone` | VARCHAR(50) | yes |  |  |  |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |
| `updated_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |

**Constraints**

- UNIQUE `uq_org_officer_org_office` (`organization_id`, `office_key`)

## Public Portal

### `public_portal_access_log`

**PublicPortalAccessLog** · `app/models/public_portal.py`

> Audit log of all public portal API access. Records every request to the public API for security monitoring, anomaly detection, and compliance.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `config_id` | VARCHAR(36) | no | FK |  | → `public_portal_config.id` ON DELETE CASCADE |
| `api_key_id` | VARCHAR(36) | yes | FK, IDX |  | → `public_portal_api_keys.id` ON DELETE SET NULL |
| `ip_address` | VARCHAR(45) | no | IDX |  |  |
| `endpoint` | VARCHAR(255) | no | IDX |  |  |
| `method` | VARCHAR(10) | no |  |  |  |
| `status_code` | INTEGER | no | IDX |  |  |
| `response_time_ms` | INTEGER | yes |  |  |  |
| `user_agent` | TEXT | yes |  |  |  |
| `referer` | VARCHAR(500) | yes |  |  |  |
| `timestamp` | DATETIME | no | IDX | `now()` |  |
| `flagged_suspicious` | BOOL | no | IDX | `0` |  |
| `flag_reason` | TEXT | yes |  |  |  |

**Indexes**

- `idx_access_log_ip` (`ip_address`)
- `idx_access_log_org_timestamp` (`organization_id`, `timestamp`)
- `idx_access_log_suspicious` (`flagged_suspicious`)
- `idx_access_log_timestamp` (`timestamp`)
- `ix_public_portal_access_log_api_key_id` (`api_key_id`)
- `ix_public_portal_access_log_endpoint` (`endpoint`)
- `ix_public_portal_access_log_status_code` (`status_code`)

### `public_portal_api_keys`

**PublicPortalAPIKey** · `app/models/public_portal.py`

> API keys for accessing the public portal. Keys are hashed (bcrypt) before storage. Only a short selective prefix (first 16 chars: "logbook_" + 8 key chars) is stored in plaintext, both for identification and to make authentication lookups return a single candidate.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `config_id` | VARCHAR(36) | no | FK |  | → `public_portal_config.id` ON DELETE CASCADE |
| `key_hash` | VARCHAR(255) | no | UQ, UQ-IDX |  |  |
| `key_prefix` | VARCHAR(20) | no | IDX |  |  |
| `name` | VARCHAR(100) | no |  |  |  |
| `rate_limit_override` | INTEGER | yes |  |  |  |
| `expires_at` | DATETIME | yes |  |  |  |
| `last_used_at` | DATETIME | yes |  |  |  |
| `is_active` | BOOL | no | IDX | `1` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `idx_api_key_active` (`is_active`)
- `idx_api_key_prefix` (`key_prefix`)
- UNIQUE `ix_public_portal_api_keys_key_hash` (`key_hash`)
- `ix_public_portal_api_keys_organization_id` (`organization_id`)

### `public_portal_config`

**PublicPortalConfig** · `app/models/public_portal.py`

> Configuration for the public portal module. Controls whether the public portal is enabled and sets default security parameters for API access.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, UQ, UQ-IDX |  | → `organizations.id` ON DELETE CASCADE |
| `enabled` | BOOL | no |  | `0` |  |
| `allowed_origins` | JSON | no |  | `list()` |  |
| `default_rate_limit` | INTEGER | no |  | `1000` |  |
| `cache_ttl_seconds` | INTEGER | no |  | `300` |  |
| `settings` | JSON | no |  | `dict()` |  |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- UNIQUE `ix_public_portal_config_organization_id` (`organization_id`)

### `public_portal_data_whitelist`

**PublicPortalDataWhitelist** · `app/models/public_portal.py`

> Whitelist of data fields that can be exposed via the public portal. Uses a whitelist approach - only explicitly enabled fields are returned through the public API.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, UQ-IDX |  | → `organizations.id` ON DELETE CASCADE |
| `config_id` | VARCHAR(36) | no | FK |  | → `public_portal_config.id` ON DELETE CASCADE |
| `data_category` | VARCHAR(50) | no | IDX |  |  |
| `field_name` | VARCHAR(100) | no |  |  |  |
| `is_enabled` | BOOL | no | IDX | `0` |  |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `idx_whitelist_category` (`data_category`)
- `idx_whitelist_enabled` (`is_enabled`)
- UNIQUE `idx_whitelist_unique` (`organization_id`, `data_category`, `field_name`)

## Security Alerts

### `security_alerts`

**SecurityAlertRecord** · `app/models/security_alert.py`

> Persistent security alert records Stores security alerts in the database so they are not lost on server restart. Supports acknowledge/resolve workflows.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `alert_type` | ENUM(`brute_force`, `session_hijack`, `data_exfiltration`, `log_tampering`, `anomaly_detected`, `unauthorized_access`, `privilege_escalation`, `suspicious_activity`, `external_data_transfer`, `rate_limit_exceeded`) | no | IDX |  |  |
| `threat_level` | ENUM(`low`, `medium`, `high`, `critical`) | no | IDX |  |  |
| `timestamp` | DATETIME | no | IDX | `now()` |  |
| `description` | TEXT | no |  |  |  |
| `source_ip` | VARCHAR(45) | yes |  |  |  |
| `user_id` | VARCHAR(36) | yes | IDX |  |  |
| `organization_id` | VARCHAR(36) | yes | IDX |  |  |
| `details` | JSON | no |  | `dict()` |  |
| `acknowledged` | BOOL | no |  | `0` |  |
| `acknowledged_by` | VARCHAR(255) | yes |  |  |  |
| `acknowledged_at` | DATETIME | yes |  |  |  |
| `resolved` | BOOL | no |  | `0` |  |
| `resolved_by` | VARCHAR(255) | yes |  |  |  |
| `resolved_at` | DATETIME | yes |  |  |  |
| `created_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `idx_security_alert_org_timestamp` (`organization_id`, `timestamp`)
- `idx_security_alert_timestamp` (`timestamp`)
- `idx_security_alert_type_level` (`alert_type`, `threat_level`)
- `ix_security_alerts_threat_level` (`threat_level`)
- `ix_security_alerts_user_id` (`user_id`)

## Skills Testing

### `skill_templates`

**SkillTemplate** · `app/models/skills_testing.py`

> Skill Template model Defines a reusable template for skills testing. Contains sections with nested criteria that examiners use to evaluate candidates. The sections field stores a JSON array of SkillTemplateSection objects, each containing an array of SkillCriterion objects.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(255) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `category` | VARCHAR(100) | yes |  |  |  |
| `version` | INTEGER | yes |  | `1` |  |
| `status` | VARCHAR(20) | yes |  | `'draft'` |  |
| `visibility` | VARCHAR(20) | yes |  | `'all_members'` |  |
| `sections` | JSON | no |  |  |  |
| `time_limit_seconds` | INTEGER | yes |  |  |  |
| `passing_percentage` | FLOAT | yes |  |  |  |
| `require_all_critical` | BOOL | yes |  | `True` |  |
| `requirement_id` | VARCHAR(36) | yes | FK, IDX |  | → `training_requirements.id` ON DELETE SET NULL |
| `result_disclosure` | VARCHAR(20) | yes |  |  |  |
| `result_release` | VARCHAR(20) | yes |  |  |  |
| `result_viewer_positions` | JSON | yes |  |  |  |
| `tags` | JSON | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` |

**Indexes**

- `idx_skill_template_category` (`organization_id`, `category`)
- `idx_skill_template_org_status` (`organization_id`, `status`)
- `ix_skill_templates_requirement_id` (`requirement_id`)

### `skill_test_viewers`

**SkillTestViewer** · `app/models/skills_testing.py`

> A person granted sight of one specific test's result. Covers the case the position and candidate rules cannot: "my preceptor should see how I did on this one." Named per test rather than per template because the relationship is to the *person tested*, not to the skill — a trainee's FTO changes, and a standing template-wide grant would quietly follow the skill onto every other candidate's results. A viewer sees the result at the same disclosure level the candidate does. They are being shown someone else's evaluation; there is no reading of "share this result" that means the observer should see more of it than its subject.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `test_id` | VARCHAR(36) | no | FK, IDX |  | → `skill_tests.id` ON DELETE CASCADE |
| `user_id` | VARCHAR(36) | no | FK, IDX |  | → `users.id` ON DELETE CASCADE |
| `granted_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `granted_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `ix_skill_test_viewers_test_id` (`test_id`)
- `ix_skill_test_viewers_user_id` (`user_id`)

**Constraints**

- UNIQUE `uq_skill_test_viewer` (`test_id`, `user_id`)

### `skill_tests`

**SkillTest** · `app/models/skills_testing.py`

> Skill Test model Represents a single test session where an examiner evaluates a candidate against a skill template. Stores per-section results and an overall score.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `template_id` | VARCHAR(36) | no | FK, IDX |  | → `skill_templates.id` ON DELETE CASCADE |
| `candidate_id` | VARCHAR(36) | no | FK, IDX |  | → `users.id` ON DELETE CASCADE |
| `examiner_id` | VARCHAR(36) | no | FK |  | → `users.id` ON DELETE CASCADE |
| `requirement_id` | VARCHAR(36) | yes | FK, IDX |  | → `training_requirements.id` ON DELETE SET NULL |
| `status` | VARCHAR(20) | yes |  | `'draft'` |  |
| `result` | VARCHAR(20) | yes |  | `'incomplete'` |  |
| `is_practice` | BOOL | yes | IDX | `False` |  |
| `version` | INTEGER | no |  | `1` |  |
| `template_snapshot` | JSON | yes |  |  |  |
| `section_results` | JSON | yes |  |  |  |
| `overall_score` | FLOAT | yes |  |  |  |
| `elapsed_seconds` | INTEGER | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `result_disclosure` | VARCHAR(20) | yes |  |  |  |
| `result_release` | VARCHAR(20) | yes |  |  |  |
| `result_viewer_positions` | JSON | yes |  |  |  |
| `validated_at` | DATETIME | yes |  |  |  |
| `validated_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `released_at` | DATETIME | yes |  |  |  |
| `released_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `voided_at` | DATETIME | yes |  |  |  |
| `voided_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `void_reason` | TEXT | yes |  |  |  |
| `started_at` | DATETIME | yes |  |  |  |
| `completed_at` | DATETIME | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_skill_test_org_status` (`organization_id`, `status`)
- `idx_skill_test_org_validation` (`organization_id`, `is_practice`, `validated_at`)
- `idx_skill_test_practice_created` (`is_practice`, `created_at`)
- `idx_skill_test_template_candidate` (`template_id`, `candidate_id`)
- `ix_skill_tests_candidate_id` (`candidate_id`)
- `ix_skill_tests_requirement_id` (`requirement_id`)

## Storefront

### `store_order_events`

**StoreOrderEvent** · `app/models/storefront.py`

> Timeline entry on an order — the member-visible "order updates" feed

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `order_id` | VARCHAR(36) | no | FK, IDX |  | → `store_orders.id` ON DELETE CASCADE |
| `event_type` | ENUM(`created`, `status_changed`, `payment_reported`, `payment_recorded`, `refunded`, `message`, `note`, `cancelled`) | no |  |  |  |
| `from_status` | VARCHAR(50) | yes |  |  |  |
| `to_status` | VARCHAR(50) | yes |  |  |  |
| `message` | TEXT | yes |  |  |  |
| `is_member_visible` | BOOL | no |  | `1` |  |
| `notified` | BOOL | no |  | `0` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_store_order_events_order_id` (`order_id`)
- `ix_store_order_events_organization_id` (`organization_id`)

### `store_order_items`

**StoreOrderItem** · `app/models/storefront.py`

> A line item on an order. Product name / variant / price are snapshotted at order time: catalog rows get renamed and repriced between order windows, and a receipt must keep saying what the member actually bought and paid.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `order_id` | VARCHAR(36) | no | FK, IDX |  | → `store_orders.id` ON DELETE CASCADE |
| `product_id` | VARCHAR(36) | yes | FK |  | → `store_products.id` ON DELETE SET NULL |
| `variant_id` | VARCHAR(36) | yes | FK |  | → `store_product_variants.id` ON DELETE SET NULL |
| `product_name` | VARCHAR(255) | no |  |  |  |
| `variant_label` | VARCHAR(120) | yes |  |  |  |
| `sku` | VARCHAR(100) | yes |  |  |  |
| `personalization_text` | VARCHAR(200) | yes |  |  |  |
| `unit_price` | NUMERIC(10, 2) | no |  | `0` |  |
| `quantity` | INTEGER | no |  | `1` |  |
| `line_total` | NUMERIC(10, 2) | no |  | `0` |  |
| `fulfilled_quantity` | INTEGER | no |  | `0` |  |
| `created_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_store_order_items_order_id` (`order_id`)
- `ix_store_order_items_organization_id` (`organization_id`)

### `store_order_windows`

**StoreOrderWindow** · `app/models/storefront.py`

> A time-boxed ordering period ("order window")

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(200) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `status` | ENUM(`draft`, `scheduled`, `open`, `closed`, `fulfilled`, `cancelled`) | no |  | `draft` |  |
| `opens_at` | DATETIME | yes |  |  |  |
| `closes_at` | DATETIME | yes |  |  |  |
| `auto_open` | BOOL | no |  | `1` |  |
| `auto_close` | BOOL | no |  | `1` |  |
| `expected_delivery_date` | DATE | yes |  |  |  |
| `pickup_instructions` | TEXT | yes |  |  |  |
| `vendor_name` | VARCHAR(200) | yes |  |  |  |
| `vendor_reference` | VARCHAR(120) | yes |  |  |  |
| `vendor_ordered_at` | DATETIME | yes |  |  |  |
| `vendor_ordered_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `include_all_products` | BOOL | no |  | `1` |  |
| `notify_on_open` | BOOL | no |  | `1` |  |
| `open_notice_sent_at` | DATETIME | yes |  |  |  |
| `closing_reminder_sent_at` | DATETIME | yes |  |  |  |
| `close_notice_sent_at` | DATETIME | yes |  |  |  |
| `opened_at` | DATETIME | yes |  |  |  |
| `closed_at` | DATETIME | yes |  |  |  |
| `closed_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `cancelled_at` | DATETIME | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_store_order_windows_org_status` (`organization_id`, `status`)

### `store_orders`

**StoreOrder** · `app/models/storefront.py`

> A member order placed against an order window

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `window_id` | VARCHAR(36) | yes | FK, IDX |  | → `store_order_windows.id` ON DELETE SET NULL |
| `user_id` | VARCHAR(36) | yes | FK, IDX |  | → `users.id` ON DELETE SET NULL |
| `order_number` | VARCHAR(30) | no |  |  |  |
| `customer_name` | VARCHAR(200) | no |  |  |  |
| `customer_email` | VARCHAR(255) | yes |  |  |  |
| `customer_phone` | VARCHAR(50) | yes |  |  |  |
| `status` | ENUM(`submitted`, `awaiting_payment`, `paid`, `ordered`, `ready_for_pickup`, `fulfilled`, `cancelled`) | no |  | `submitted` |  |
| `payment_status` | ENUM(`unpaid`, `pending_verification`, `partial`, `paid`, `refunded`, `waived`) | no |  | `unpaid` |  |
| `payment_method` | ENUM(`venmo`, `paypal`, `cash_app`, `zelle`, `cash`, `check`, `payroll_deduction`, `other`) | yes |  |  |  |
| `subtotal` | NUMERIC(10, 2) | no |  | `0` |  |
| `tax_amount` | NUMERIC(10, 2) | no |  | `0` |  |
| `shipping_amount` | NUMERIC(10, 2) | no |  | `0` |  |
| `discount_amount` | NUMERIC(10, 2) | no |  | `0` |  |
| `total` | NUMERIC(10, 2) | no |  | `0` |  |
| `amount_paid` | NUMERIC(10, 2) | no |  | `0` |  |
| `payment_reference` | VARCHAR(200) | yes |  |  |  |
| `payment_reported_at` | DATETIME | yes |  |  |  |
| `paid_at` | DATETIME | yes |  |  |  |
| `payment_verified_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `fulfillment_method` | ENUM(`pickup`, `ship`) | no |  | `pickup` |  |
| `shipping_address` | TEXT | yes |  |  |  |
| `member_notes` | TEXT | yes |  |  |  |
| `admin_notes` | TEXT | yes |  |  |  |
| `submitted_at` | DATETIME | no |  | `now()` |  |
| `cancelled_at` | DATETIME | yes |  |  |  |
| `cancellation_reason` | TEXT | yes |  |  |  |
| `fulfilled_at` | DATETIME | yes |  |  |  |
| `fulfilled_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `payment_reminder_sent_at` | DATETIME | yes |  |  |  |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_store_orders_org_payment` (`organization_id`, `payment_status`)
- `ix_store_orders_org_status` (`organization_id`, `status`)
- `ix_store_orders_org_window` (`organization_id`, `window_id`)
- `ix_store_orders_user_id` (`user_id`)
- `ix_store_orders_window_id` (`window_id`)

**Constraints**

- UNIQUE `uq_store_orders_org_number` (`organization_id`, `order_number`)

### `store_payment_events`

**StorePaymentEvent** · `app/models/storefront.py`

> A payment a provider says it received, and what we did about it. Every inbound capture is recorded here whether or not it could be matched, because the failures are the point: a payment that arrives with no usable reference still has to reach a human, and silently dropping it would leave a member marked unpaid with money gone from their account. This is a ledger of *external* reports, deliberately separate from ``store_orders.amount_paid``. Applying an event writes the payment through the normal service path; this table records that it happened and why.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `provider` | VARCHAR(30) | no |  | `paypal` |  |
| `external_id` | VARCHAR(120) | no |  |  |  |
| `event_id` | VARCHAR(120) | yes |  |  |  |
| `amount` | NUMERIC(10, 2) | no |  | `0` |  |
| `currency` | VARCHAR(3) | no |  | `USD` |  |
| `payer_name` | VARCHAR(200) | yes |  |  |  |
| `payer_email` | VARCHAR(255) | yes |  |  |  |
| `reference` | VARCHAR(255) | yes |  |  |  |
| `status` | ENUM(`applied`, `matched`, `unmatched`, `ambiguous`, `ignored`, `duplicate`) | no |  | `unmatched` |  |
| `matched_order_id` | VARCHAR(36) | yes | FK, IDX |  | → `store_orders.id` ON DELETE SET NULL |
| `note` | TEXT | yes |  |  |  |
| `raw_payload` | JSON | yes |  |  |  |
| `received_at` | DATETIME | no |  | `now()` |  |
| `resolved_at` | DATETIME | yes |  |  |  |
| `resolved_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_store_payment_events_matched_order_id` (`matched_order_id`)
- `ix_store_payment_events_org_status` (`organization_id`, `status`)

**Constraints**

- UNIQUE `uq_store_payment_events_provider_external` (`organization_id`, `provider`, `external_id`)

### `store_product_images`

**StoreProductImage** · `app/models/storefront.py`

> Uploaded product photo, stored out of line from the catalog row. Kept in its own table (and served by its own endpoint) so listing the catalog never drags a few hundred KB of image bytes per product through the ORM -- the storefront lists every active product at once.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `product_id` | VARCHAR(36) | no | FK, UQ, UQ-IDX |  | → `store_products.id` ON DELETE CASCADE |
| `content_type` | VARCHAR(100) | no |  | `image/webp` |  |
| `data` | BLOB(16777215) | no |  |  |  |
| `byte_size` | INTEGER | no |  | `0` |  |
| `uploaded_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_store_product_images_organization_id` (`organization_id`)
- UNIQUE `ix_store_product_images_product_id` (`product_id`)

### `store_product_variants`

**StoreProductVariant** · `app/models/storefront.py`

> A size/color option on a product (e.g. "L / Navy")

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `product_id` | VARCHAR(36) | no | FK |  | → `store_products.id` ON DELETE CASCADE |
| `label` | VARCHAR(120) | no |  |  |  |
| `sku` | VARCHAR(100) | yes |  |  |  |
| `price_delta` | NUMERIC(10, 2) | no |  | `0` |  |
| `stock_quantity` | INTEGER | yes |  |  |  |
| `is_active` | BOOL | no |  | `1` |  |
| `sort_order` | INTEGER | no |  | `0` |  |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_store_product_variants_organization_id` (`organization_id`)

**Constraints**

- UNIQUE `uq_store_product_variants_product_label` (`product_id`, `label`)

### `store_products`

**StoreProduct** · `app/models/storefront.py`

> A sellable item in the department catalog

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(255) | no |  |  |  |
| `sku` | VARCHAR(100) | yes |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `image_url` | VARCHAR(500) | yes |  |  |  |
| `category` | VARCHAR(100) | yes |  |  |  |
| `inventory_item_id` | VARCHAR(36) | yes | FK |  | → `inventory_items.id` ON DELETE SET NULL |
| `price` | NUMERIC(10, 2) | no |  | `0` |  |
| `cost` | NUMERIC(10, 2) | yes |  |  |  |
| `is_taxable` | BOOL | no |  | `0` |  |
| `status` | ENUM(`draft`, `active`, `archived`) | no |  | `draft` |  |
| `max_per_member` | INTEGER | yes |  |  |  |
| `personalization_enabled` | BOOL | no |  | `0` |  |
| `personalization_required` | BOOL | no |  | `0` |  |
| `personalization_label` | VARCHAR(120) | yes |  |  |  |
| `personalization_max_length` | INTEGER | no |  | `30` |  |
| `personalization_price` | NUMERIC(10, 2) | no |  | `0` |  |
| `track_stock` | BOOL | no |  | `0` |  |
| `stock_quantity` | INTEGER | yes |  |  |  |
| `requires_variant` | BOOL | no |  | `0` |  |
| `sort_order` | INTEGER | no |  | `0` |  |
| `internal_notes` | TEXT | yes |  |  |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_store_products_org_status` (`organization_id`, `status`)

**Constraints**

- UNIQUE `uq_store_products_org_sku` (`organization_id`, `sku`)

### `store_settings`

**StoreSettings** · `app/models/storefront.py`

> Per-organization storefront configuration (one row per org). ``is_enabled`` gates the *member-facing* store independently of the ``storefront`` module flag in ``Organization.settings.modules``: the module flag decides whether the feature appears in navigation at all, while this flag lets a quartermaster take the store down for maintenance without disabling the module and hiding the admin screens they need.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, UQ, UQ-IDX |  | → `organizations.id` ON DELETE CASCADE |
| `is_enabled` | BOOL | no |  | `0` |  |
| `store_name` | VARCHAR(200) | no |  | `Department Store` |  |
| `tagline` | VARCHAR(300) | yes |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `currency` | VARCHAR(3) | no |  | `USD` |  |
| `accepted_payment_methods` | JSON | yes |  |  |  |
| `venmo_handle` | VARCHAR(100) | yes |  |  |  |
| `paypal_me_url` | VARCHAR(300) | yes |  |  |  |
| `paypal_email` | VARCHAR(255) | yes |  |  |  |
| `payment_policy` | ENUM(`none`, `before_pickup`, `before_vendor_order`) | no |  | `none` |  |
| `cash_app_cashtag` | VARCHAR(100) | yes |  |  |  |
| `zelle_handle` | VARCHAR(255) | yes |  |  |  |
| `zelle_instructions` | TEXT | yes |  |  |  |
| `check_payable_to` | VARCHAR(200) | yes |  |  |  |
| `check_mailing_address` | TEXT | yes |  |  |  |
| `cash_instructions` | TEXT | yes |  |  |  |
| `payroll_deduction_instructions` | TEXT | yes |  |  |  |
| `other_payment_instructions` | TEXT | yes |  |  |  |
| `payment_instructions` | TEXT | yes |  |  |  |
| `tax_rate` | NUMERIC(6, 4) | no |  | `0` |  |
| `shipping_flat_rate` | NUMERIC(10, 2) | yes |  |  |  |
| `allow_pickup` | BOOL | no |  | `1` |  |
| `allow_shipping` | BOOL | no |  | `0` |  |
| `pickup_location` | VARCHAR(300) | yes |  |  |  |
| `notify_emails` | JSON | yes |  |  |  |
| `notify_admins_on_order` | BOOL | no |  | `1` |  |
| `send_order_confirmation` | BOOL | no |  | `1` |  |
| `send_status_updates` | BOOL | no |  | `1` |  |
| `send_payment_reminders` | BOOL | no |  | `1` |  |
| `send_payment_receipts` | BOOL | no |  | `1` |  |
| `send_window_opened` | BOOL | no |  | `1` |  |
| `send_window_closing_reminder` | BOOL | no |  | `1` |  |
| `send_window_closed` | BOOL | no |  | `1` |  |
| `send_vendor_order_updates` | BOOL | no |  | `1` |  |
| `payment_reminder_days` | INTEGER | no |  | `3` |  |
| `window_reminder_hours` | INTEGER | no |  | `48` |  |
| `terms_text` | TEXT | yes |  |  |  |
| `receipt_footer` | TEXT | yes |  |  |  |
| `created_at` | DATETIME | no |  | `now()` |  |
| `updated_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- UNIQUE `ix_store_settings_organization_id` (`organization_id`)

### `store_window_products`

**StoreWindowProduct** · `app/models/storefront.py`

> Which catalog products a window offers, with per-window overrides

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `window_id` | VARCHAR(36) | no | FK |  | → `store_order_windows.id` ON DELETE CASCADE |
| `product_id` | VARCHAR(36) | no | FK, IDX |  | → `store_products.id` ON DELETE CASCADE |
| `price_override` | NUMERIC(10, 2) | yes |  |  |  |
| `quantity_limit` | INTEGER | yes |  |  |  |
| `max_per_member` | INTEGER | yes |  |  |  |
| `sort_order` | INTEGER | no |  | `0` |  |
| `created_at` | DATETIME | no |  | `now()` |  |

**Indexes**

- `ix_store_window_products_organization_id` (`organization_id`)
- `ix_store_window_products_product_id` (`product_id`)

**Constraints**

- UNIQUE `uq_store_window_products_window_product` (`window_id`, `product_id`)

## Training

### `basic_apparatus`

**BasicApparatus** · `app/models/training.py`

> Lightweight apparatus/vehicle definition for shift scheduling. Used when the full Apparatus module is not enabled. Provides basic vehicle/unit definitions with crew positions for shift staffing.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `unit_number` | VARCHAR(20) | no |  |  |  |
| `name` | VARCHAR(100) | no |  |  |  |
| `apparatus_type` | VARCHAR(50) | no |  | `engine` |  |
| `min_staffing` | INTEGER | yes |  | `1` |  |
| `positions` | JSON | yes |  |  |  |
| `is_active` | BOOL | yes |  | `True` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_basic_apparatus_org` (`organization_id`)

### `competency_matrices`

**CompetencyMatrix** · `app/models/training.py`

> Competency Matrix model Maps positions/roles to required skills at specific competency levels. Based on NFPA 1021 (Fire Officer) and NFPA 1041 (Instructor) frameworks.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(255) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `position` | VARCHAR(100) | no | IDX |  |  |
| `role_id` | VARCHAR(36) | yes | IDX |  |  |
| `skill_requirements` | JSON | no |  | `list()` |  |
| `active` | BOOL | yes | IDX | `True` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |

**Indexes**

- `idx_competency_matrix_org` (`organization_id`, `position`)
- `ix_competency_matrices_active` (`active`)
- `ix_competency_matrices_position` (`position`)
- `ix_competency_matrices_role_id` (`role_id`)

### `course_classes`

**CourseClass** · `app/models/training.py`

> Course Class model — one row of a multi-class course's syllabus. A recruit school is a single TrainingCourse whose syllabus is fifteen of these. A class is described *relative* to the course start (``day_offset`` + local ``start_time``); it becomes a real dated event only when a cohort is generated from the course.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `course_id` | VARCHAR(36) | no | FK, IDX |  | → `training_courses.id` ON DELETE CASCADE |
| `class_course_id` | VARCHAR(36) | no | FK, IDX |  | → `training_courses.id` ON DELETE CASCADE |
| `sequence` | INTEGER | no |  |  |  |
| `section_name` | VARCHAR(255) | yes |  |  |  |
| `title` | VARCHAR(255) | yes |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `day_offset` | INTEGER | no |  | `0` |  |
| `start_time` | VARCHAR(5) | yes |  |  |  |
| `duration_minutes` | INTEGER | no |  | `60` |  |
| `credit_hours` | FLOAT | yes |  |  |  |
| `instructor_id` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `instructor` | VARCHAR(255) | yes |  |  |  |
| `location_id` | VARCHAR(36) | yes | FK |  | → `locations.id` ON DELETE SET NULL |
| `location` | VARCHAR(300) | yes |  |  |  |
| `category_id` | VARCHAR(36) | yes | FK |  | → `training_categories.id` ON DELETE SET NULL |
| `requirement_id` | VARCHAR(36) | yes | FK |  | → `training_requirements.id` ON DELETE SET NULL |
| `phase_id` | VARCHAR(36) | yes | FK |  | → `program_phases.id` ON DELETE SET NULL |
| `is_required` | BOOL | no |  | `True` |  |
| `counts_toward_certification` | BOOL | no |  | `True` |  |
| `active` | BOOL | no |  | `True` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |

**Indexes**

- `idx_course_class_org_course` (`organization_id`, `course_id`)
- `ix_course_classes_class_course_id` (`class_course_id`)
- `ix_course_classes_course_id` (`course_id`)
- `ix_course_classes_organization_id` (`organization_id`)

**Constraints**

- UNIQUE `uq_course_class_sequence` (`course_id`, `sequence`)

### `course_cohort_classes`

**CourseCohortClass** · `app/models/training.py`

> Course Cohort Class model — a syllabus row materialized onto real dates. This row is the stable identity of "class 7 of the fall recruit school"; the Event and TrainingSession are its current realization. Keeping them separate is what makes rescheduling, cancelling, and idempotent regeneration possible.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `cohort_id` | VARCHAR(36) | no | FK, IDX |  | → `course_cohorts.id` ON DELETE CASCADE |
| `course_class_id` | VARCHAR(36) | yes | FK |  | → `course_classes.id` ON DELETE SET NULL |
| `sequence` | INTEGER | no |  |  |  |
| `title` | VARCHAR(255) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `scheduled_start` | DATETIME | no |  |  |  |
| `scheduled_end` | DATETIME | no |  |  |  |
| `event_id` | VARCHAR(36) | yes | FK, UQ |  | → `events.id` ON DELETE SET NULL |
| `training_session_id` | VARCHAR(36) | yes | FK |  | → `training_sessions.id` ON DELETE SET NULL |
| `status` | ENUM(`scheduled`, `completed`, `cancelled`) | no | IDX | `'scheduled'` |  |
| `class_course_id` | VARCHAR(36) | yes | FK |  | → `training_courses.id` ON DELETE SET NULL |
| `credit_hours` | FLOAT | yes |  |  |  |
| `instructor_id` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `instructor` | VARCHAR(255) | yes |  |  |  |
| `location_id` | VARCHAR(36) | yes | FK |  | → `locations.id` ON DELETE SET NULL |
| `location` | VARCHAR(300) | yes |  |  |  |
| `category_id` | VARCHAR(36) | yes | FK |  | → `training_categories.id` ON DELETE SET NULL |
| `requirement_id` | VARCHAR(36) | yes | FK |  | → `training_requirements.id` ON DELETE SET NULL |
| `phase_id` | VARCHAR(36) | yes | FK |  | → `program_phases.id` ON DELETE SET NULL |
| `counts_toward_certification` | BOOL | no |  | `True` |  |
| `cancellation_reason` | TEXT | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_cohort_class_start` (`organization_id`, `scheduled_start`)
- `ix_course_cohort_classes_cohort_id` (`cohort_id`)
- `ix_course_cohort_classes_organization_id` (`organization_id`)
- `ix_course_cohort_classes_status` (`status`)

**Constraints**

- UNIQUE `uq_cohort_class_sequence` (`cohort_id`, `sequence`)
- UNIQUE `uq_cohort_class_source` (`cohort_id`, `course_class_id`)
- UNIQUE `uq_course_cohort_classes_event_id` (`event_id`)

### `course_cohort_members`

**CourseCohortMember** · `app/models/training.py`

> Course Cohort Member model — the roster of one cohort. Links a member to the cohort and to the ProgramEnrollment that tracks their pipeline progress, so a student's classes and their credit are one record.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `cohort_id` | VARCHAR(36) | no | FK, IDX |  | → `course_cohorts.id` ON DELETE CASCADE |
| `user_id` | VARCHAR(36) | no | FK, IDX |  | → `users.id` ON DELETE CASCADE |
| `enrollment_id` | VARCHAR(36) | yes | FK |  | → `program_enrollments.id` ON DELETE SET NULL |
| `status` | ENUM(`active`, `withdrawn`, `completed`) | no |  | `'active'` |  |
| `notes` | TEXT | yes |  |  |  |
| `withdrawn_at` | DATETIME | yes |  |  |  |
| `added_at` | DATETIME | yes |  | `now()` |  |
| `added_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |

**Indexes**

- `ix_course_cohort_members_cohort_id` (`cohort_id`)
- `ix_course_cohort_members_organization_id` (`organization_id`)
- `ix_course_cohort_members_user_id` (`user_id`)

**Constraints**

- UNIQUE `uq_cohort_member_user` (`cohort_id`, `user_id`)

### `course_cohorts`

**CourseCohort** · `app/models/training.py`

> Course Cohort model — one scheduled run of a multi-class course. "Recruit School — Fall 2026" starting 2026-09-08. Generating a cohort turns each syllabus row into a real Event + TrainingSession, enrolls the roster in the linked training program, and RSVPs them to every class.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `course_id` | VARCHAR(36) | no | FK, IDX |  | → `training_courses.id` ON DELETE CASCADE |
| `name` | VARCHAR(255) | no |  |  |  |
| `code` | VARCHAR(50) | yes |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `start_date` | DATE | no |  |  |  |
| `status` | ENUM(`draft`, `scheduled`, `in_progress`, `completed`, `cancelled`) | no | IDX | `'draft'` |  |
| `program_id` | VARCHAR(36) | yes | FK |  | → `training_programs.id` ON DELETE SET NULL |
| `meeting_days` | JSON | yes |  |  |  |
| `default_start_time` | VARCHAR(5) | yes |  |  |  |
| `default_duration_minutes` | INTEGER | yes |  |  |  |
| `date_roll_policy` | ENUM(`none`, `next_business_day`, `next_meeting_day`) | no |  | `'none'` |  |
| `blackout_dates` | JSON | yes |  |  |  |
| `location_id` | VARCHAR(36) | yes | FK |  | → `locations.id` ON DELETE SET NULL |
| `location` | VARCHAR(300) | yes |  |  |  |
| `requires_rsvp` | BOOL | no |  | `True` |  |
| `auto_create_records` | BOOL | no |  | `True` |  |
| `generated_at` | DATETIME | yes |  |  |  |
| `generated_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `notes` | TEXT | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |

**Indexes**

- `idx_course_cohort_org_course` (`organization_id`, `course_id`)
- `ix_course_cohorts_course_id` (`course_id`)
- `ix_course_cohorts_organization_id` (`organization_id`)
- `ix_course_cohorts_status` (`status`)

### `external_category_mappings`

**ExternalCategoryMapping** · `app/models/training.py`

> External Category Mapping model Maps categories from external training platforms to internal TrainingCategories.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `provider_id` | VARCHAR(36) | no | FK, IDX |  | → `external_training_providers.id` ON DELETE CASCADE |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `external_category_id` | VARCHAR(255) | no |  |  |  |
| `external_category_name` | VARCHAR(255) | no |  |  |  |
| `external_category_code` | VARCHAR(100) | yes |  |  |  |
| `internal_category_id` | VARCHAR(36) | yes | FK |  | → `training_categories.id` ON DELETE SET NULL |
| `is_mapped` | BOOL | yes |  | `False` |  |
| `auto_mapped` | BOOL | yes |  | `False` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `mapped_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |

**Indexes**

- `idx_ext_mapping_external` (`provider_id`, `external_category_id`)
- `ix_external_category_mappings_organization_id` (`organization_id`)

### `external_training_imports`

**ExternalTrainingImport** · `app/models/training.py`

> External Training Import model Stores imported training records from external providers. Links external records to internal TrainingRecords.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `provider_id` | VARCHAR(36) | no | FK, IDX |  | → `external_training_providers.id` ON DELETE CASCADE |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `sync_log_id` | VARCHAR(36) | yes | FK, IDX |  | → `external_training_sync_logs.id` ON DELETE SET NULL |
| `external_record_id` | VARCHAR(255) | no |  |  |  |
| `external_user_id` | VARCHAR(255) | yes |  |  |  |
| `external_course_id` | VARCHAR(255) | yes |  |  |  |
| `external_category_id` | VARCHAR(255) | yes |  |  |  |
| `course_title` | VARCHAR(500) | no |  |  |  |
| `course_code` | VARCHAR(100) | yes |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `duration_minutes` | INTEGER | yes |  |  |  |
| `credit_hours` | FLOAT | yes |  |  |  |
| `completion_date` | DATETIME | yes |  |  |  |
| `score` | FLOAT | yes |  |  |  |
| `passed` | BOOL | yes |  |  |  |
| `external_category_name` | VARCHAR(255) | yes |  |  |  |
| `raw_data` | JSON | yes |  |  |  |
| `training_record_id` | VARCHAR(36) | yes | FK, IDX |  | → `training_records.id` ON DELETE SET NULL |
| `user_id` | VARCHAR(36) | yes | FK, IDX |  | → `users.id` ON DELETE SET NULL |
| `import_status` | VARCHAR(50) | yes | IDX | `'pending'` |  |
| `import_error` | TEXT | yes |  |  |  |
| `imported_at` | DATETIME | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_ext_import_external` (`provider_id`, `external_record_id`)
- `idx_ext_import_provider` (`provider_id`, `import_status`)
- `idx_ext_import_user` (`user_id`)
- `ix_external_training_imports_import_status` (`import_status`)
- `ix_external_training_imports_organization_id` (`organization_id`)
- `ix_external_training_imports_sync_log_id` (`sync_log_id`)
- `ix_external_training_imports_training_record_id` (`training_record_id`)

### `external_training_providers`

**ExternalTrainingProvider** · `app/models/training.py`

> External Training Provider model Configuration for connecting to external training platforms like Vector Solutions, Target Solutions, Lexipol, etc.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(255) | no |  |  |  |
| `provider_type` | ENUM(`vector_solutions`, `target_solutions`, `lexipol`, `i_am_responding`, `custom_api`) | no | IDX |  |  |
| `description` | TEXT | yes |  |  |  |
| `api_base_url` | VARCHAR(500) | yes |  |  |  |
| `api_key` | TEXT | yes |  |  |  |
| `api_secret` | TEXT | yes |  |  |  |
| `client_id` | VARCHAR(255) | yes |  |  |  |
| `client_secret` | TEXT | yes |  |  |  |
| `auth_type` | VARCHAR(50) | yes |  | `'api_key'` |  |
| `config` | JSON | yes |  |  |  |
| `auto_sync_enabled` | BOOL | yes |  | `False` |  |
| `sync_interval_hours` | INTEGER | yes |  | `24` |  |
| `last_sync_at` | DATETIME | yes |  |  |  |
| `next_sync_at` | DATETIME | yes |  |  |  |
| `default_category_id` | VARCHAR(36) | yes | FK |  | → `training_categories.id` ON DELETE SET NULL |
| `active` | BOOL | yes | IDX | `True` |  |
| `connection_verified` | BOOL | yes |  | `False` |  |
| `last_connection_test` | DATETIME | yes |  |  |  |
| `connection_error` | TEXT | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |

**Indexes**

- `idx_ext_provider_org` (`organization_id`, `active`)
- `idx_ext_provider_type` (`provider_type`)
- `ix_external_training_providers_active` (`active`)

### `external_training_sync_logs`

**ExternalTrainingSyncLog** · `app/models/training.py`

> External Training Sync Log model Tracks sync operations with external training providers.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `provider_id` | VARCHAR(36) | no | FK, IDX |  | → `external_training_providers.id` ON DELETE CASCADE |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `sync_type` | VARCHAR(50) | no |  |  |  |
| `status` | ENUM(`pending`, `in_progress`, `completed`, `failed`, `partial`) | yes | IDX | `'pending'` |  |
| `started_at` | DATETIME | yes | IDX | `now()` |  |
| `completed_at` | DATETIME | yes |  |  |  |
| `records_fetched` | INTEGER | yes |  | `0` |  |
| `records_imported` | INTEGER | yes |  | `0` |  |
| `records_updated` | INTEGER | yes |  | `0` |  |
| `records_skipped` | INTEGER | yes |  | `0` |  |
| `records_failed` | INTEGER | yes |  | `0` |  |
| `error_message` | TEXT | yes |  |  |  |
| `error_details` | JSON | yes |  |  |  |
| `sync_from_date` | DATE | yes |  |  |  |
| `sync_to_date` | DATE | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `initiated_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |

**Indexes**

- `idx_sync_log_date` (`started_at`)
- `idx_sync_log_provider` (`provider_id`, `status`)
- `ix_external_training_sync_logs_organization_id` (`organization_id`)
- `ix_external_training_sync_logs_status` (`status`)

### `external_user_mappings`

**ExternalUserMapping** · `app/models/training.py`

> External User Mapping model Maps users from external training platforms to internal Users.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `provider_id` | VARCHAR(36) | no | FK, IDX |  | → `external_training_providers.id` ON DELETE CASCADE |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `external_user_id` | VARCHAR(255) | no |  |  |  |
| `external_username` | VARCHAR(255) | yes |  |  |  |
| `external_email` | VARCHAR(255) | yes |  |  |  |
| `external_name` | VARCHAR(255) | yes |  |  |  |
| `internal_user_id` | VARCHAR(36) | yes | FK, IDX |  | → `users.id` ON DELETE SET NULL |
| `is_mapped` | BOOL | yes |  | `False` |  |
| `auto_mapped` | BOOL | yes |  | `False` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `mapped_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |

**Indexes**

- `idx_ext_user_external` (`provider_id`, `external_user_id`)
- `idx_ext_user_internal` (`internal_user_id`)
- `ix_external_user_mappings_organization_id` (`organization_id`)

### `instructor_qualifications`

**InstructorQualification** · `app/models/training.py`

> Instructor Qualification model Tracks which users are qualified to instruct or evaluate specific courses and skills. Based on NFPA 1041 requirements.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `user_id` | VARCHAR(36) | no | FK, IDX |  | → `users.id` ON DELETE CASCADE |
| `qualification_type` | VARCHAR(50) | no |  |  |  |
| `course_id` | VARCHAR(36) | yes | FK, IDX |  | → `training_courses.id` ON DELETE CASCADE |
| `skill_evaluation_id` | VARCHAR(36) | yes | FK, IDX |  | → `skill_evaluations.id` ON DELETE CASCADE |
| `category_id` | VARCHAR(36) | yes | FK |  | → `training_categories.id` ON DELETE CASCADE |
| `certification_number` | VARCHAR(100) | yes |  |  |  |
| `issuing_agency` | VARCHAR(255) | yes |  |  |  |
| `certification_level` | VARCHAR(50) | yes |  |  |  |
| `issued_date` | DATE | yes |  |  |  |
| `expiration_date` | DATE | yes | IDX |  |  |
| `active` | BOOL | yes | IDX | `True` |  |
| `verified` | BOOL | yes |  | `False` |  |
| `verified_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `verified_at` | DATETIME | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |

**Indexes**

- `idx_instructor_qual_course` (`course_id`)
- `idx_instructor_qual_expiration` (`expiration_date`)
- `idx_instructor_qual_skill` (`skill_evaluation_id`)
- `idx_instructor_qual_user` (`user_id`, `active`)
- `ix_instructor_qualifications_active` (`active`)
- `ix_instructor_qualifications_organization_id` (`organization_id`)

### `member_competencies`

**MemberCompetency** · `app/models/training.py`

> Member Competency model Tracks a member's current competency level for a specific skill. Updated when skill evaluations are completed. Supports skill decay tracking (requires re-validation after N months).

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `user_id` | VARCHAR(36) | no | FK, IDX |  | → `users.id` ON DELETE CASCADE |
| `skill_evaluation_id` | VARCHAR(36) | no | FK, IDX |  | → `skill_evaluations.id` ON DELETE CASCADE |
| `current_level` | ENUM(`novice`, `advanced_beginner`, `competent`, `proficient`, `expert`) | no |  | `'novice'` |  |
| `previous_level` | ENUM(`novice`, `advanced_beginner`, `competent`, `proficient`, `expert`) | yes |  |  |  |
| `last_evaluated_at` | DATETIME | yes |  |  |  |
| `last_evaluator_id` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `evaluation_count` | INTEGER | yes |  | `0` |  |
| `last_score` | FLOAT | yes |  |  |  |
| `decay_months` | INTEGER | yes |  |  |  |
| `decay_warning_sent` | BOOL | yes |  | `False` |  |
| `next_evaluation_due` | DATE | yes | IDX |  |  |
| `score_history` | JSON | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_member_comp_decay` (`next_evaluation_due`)
- `idx_member_comp_org` (`organization_id`)
- `idx_member_comp_user` (`user_id`, `skill_evaluation_id`)
- `ix_member_competencies_skill_evaluation_id` (`skill_evaluation_id`)

### `multi_agency_trainings`

**MultiAgencyTraining** · `app/models/training.py`

> Multi-Agency Training model Tags training records and sessions as multi-agency exercises, records participating organizations, and supports cross-org credential verification. Industry standard: NFPA 1500 Chapter 5 and FEMA NIMS require documented joint training.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `training_session_id` | VARCHAR(36) | yes | FK, IDX |  | → `training_sessions.id` ON DELETE CASCADE |
| `training_record_id` | VARCHAR(36) | yes | FK |  | → `training_records.id` ON DELETE SET NULL |
| `exercise_name` | VARCHAR(255) | no |  |  |  |
| `exercise_type` | VARCHAR(50) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `participating_organizations` | JSON | no |  |  |  |
| `lead_agency` | VARCHAR(255) | yes |  |  |  |
| `total_participants` | INTEGER | yes |  |  |  |
| `ics_position_assignments` | JSON | yes |  |  |  |
| `nims_compliant` | BOOL | yes |  | `False` |  |
| `after_action_report` | TEXT | yes |  |  |  |
| `lessons_learned` | JSON | yes |  |  |  |
| `mutual_aid_agreement_id` | VARCHAR(100) | yes |  |  |  |
| `exercise_date` | DATE | no | IDX |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |

**Indexes**

- `idx_multi_agency_date` (`exercise_date`)
- `idx_multi_agency_org` (`organization_id`)
- `idx_multi_agency_session` (`training_session_id`)

### `program_enrollments`

**ProgramEnrollment** · `app/models/training.py`

> Program Enrollment model Tracks member enrollment in training programs.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `user_id` | VARCHAR(36) | no | FK, IDX |  | → `users.id` ON DELETE CASCADE |
| `program_id` | VARCHAR(36) | no | FK, IDX |  | → `training_programs.id` ON DELETE CASCADE |
| `enrolled_at` | DATETIME | no |  | `now()` |  |
| `target_completion_date` | DATE | yes | IDX |  |  |
| `current_phase_id` | VARCHAR(36) | yes | FK |  | → `program_phases.id` ON DELETE SET NULL |
| `progress_percentage` | FLOAT | yes |  | `0.0` |  |
| `status` | ENUM(`active`, `completed`, `expired`, `on_hold`, `withdrawn`, `failed`) | yes | IDX | `'active'` |  |
| `completed_at` | DATETIME | yes |  |  |  |
| `withdrawn_at` | DATETIME | yes |  |  |  |
| `withdrawal_reason` | TEXT | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `deadline_warning_sent` | BOOL | yes |  | `False` |  |
| `deadline_warning_sent_at` | DATETIME | yes |  |  |  |
| `struggling_alert_sent_at` | DATETIME | yes |  |  |  |
| `cycle_started_at` | DATETIME | yes |  |  |  |
| `next_recert_reset_at` | DATE | yes | IDX |  |  |
| `last_recert_reset_at` | DATETIME | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `enrolled_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |

**Indexes**

- `idx_enrollment_deadline` (`target_completion_date`)
- `idx_enrollment_program` (`program_id`, `status`)
- `idx_enrollment_user` (`user_id`, `status`)
- `ix_program_enrollments_next_recert_reset_at` (`next_recert_reset_at`)
- `ix_program_enrollments_organization_id` (`organization_id`)
- `ix_program_enrollments_status` (`status`)

### `program_milestones`

**ProgramMilestone** · `app/models/training.py`

> Program Milestone model Defines milestones/checkpoints within a program or phase.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `program_id` | VARCHAR(36) | no | FK, IDX |  | → `training_programs.id` ON DELETE CASCADE |
| `phase_id` | VARCHAR(36) | yes | FK, IDX |  | → `program_phases.id` ON DELETE CASCADE |
| `name` | VARCHAR(255) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `completion_percentage_threshold` | FLOAT | yes |  |  |  |
| `notification_message` | TEXT | yes |  |  |  |
| `requires_verification` | BOOL | yes |  | `False` |  |
| `verification_notes` | TEXT | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_milestone_program` (`program_id`)
- `ix_program_milestones_phase_id` (`phase_id`)

### `program_phases`

**ProgramPhase** · `app/models/training.py`

> Program Phase model Represents a phase/stage within a training program.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `program_id` | VARCHAR(36) | no | FK |  | → `training_programs.id` ON DELETE CASCADE |
| `phase_number` | INTEGER | no |  |  |  |
| `name` | VARCHAR(255) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `prerequisite_phase_ids` | JSON | yes |  |  |  |
| `requires_manual_advancement` | BOOL | yes |  | `False` |  |
| `time_limit_days` | INTEGER | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Constraints**

- UNIQUE `uq_program_phases_program_id_phase_number` (`program_id`, `phase_number`)

### `program_requirements`

**ProgramRequirement** · `app/models/training.py`

> Program Requirement model Links training requirements to programs/phases.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `program_id` | VARCHAR(36) | no | FK, IDX |  | → `training_programs.id` ON DELETE CASCADE |
| `phase_id` | VARCHAR(36) | yes | FK, IDX |  | → `program_phases.id` ON DELETE CASCADE |
| `requirement_id` | VARCHAR(36) | no | FK, IDX |  | → `training_requirements.id` ON DELETE CASCADE |
| `is_required` | BOOL | yes |  | `True` |  |
| `is_prerequisite` | BOOL | yes |  | `False` |  |
| `sort_order` | INTEGER | yes |  | `0` |  |
| `owns_requirement` | BOOL | no |  | `true` |  |
| `program_specific_description` | TEXT | yes |  |  |  |
| `custom_deadline_days` | INTEGER | yes |  |  |  |
| `notification_message` | TEXT | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_prog_req_phase` (`phase_id`)
- `idx_prog_req_program` (`program_id`)
- `ix_program_requirements_requirement_id` (`requirement_id`)

### `recertification_pathways`

**RecertificationPathway** · `app/models/training.py`

> Recertification Pathway model Defines how to renew an expiring certification. Maps expiring certifications to the courses/hours needed for renewal, with support for grace periods and prerequisite chains. Industry standard: NREMT recertification requires specific category-hours (e.g., 50 CE hours distributed across topics for EMT).

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(255) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `source_requirement_id` | VARCHAR(36) | yes | FK, IDX |  | → `training_requirements.id` ON DELETE CASCADE |
| `renewal_type` | VARCHAR(50) | no |  | `'hours'` |  |
| `required_hours` | FLOAT | yes |  |  |  |
| `required_courses` | JSON | yes |  |  |  |
| `category_hour_requirements` | JSON | yes |  |  |  |
| `requires_assessment` | BOOL | yes |  | `False` |  |
| `assessment_course_id` | VARCHAR(36) | yes | FK |  | → `training_courses.id` ON DELETE SET NULL |
| `renewal_window_days` | INTEGER | yes |  | `90` |  |
| `grace_period_days` | INTEGER | yes |  | `0` |  |
| `max_lapse_days` | INTEGER | yes |  |  |  |
| `prerequisite_pathway_ids` | JSON | yes |  |  |  |
| `new_expiration_months` | INTEGER | yes |  |  |  |
| `auto_create_record` | BOOL | yes |  | `True` |  |
| `active` | BOOL | yes | IDX | `True` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |

**Indexes**

- `idx_recert_pathway_org` (`organization_id`, `active`)
- `idx_recert_pathway_source` (`source_requirement_id`)
- `ix_recertification_pathways_active` (`active`)

### `renewal_tasks`

**RenewalTask** · `app/models/training.py`

> Renewal Task model Auto-generated when a certification enters its renewal window. Guides the member through the renewal process.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `user_id` | VARCHAR(36) | no | FK, IDX |  | → `users.id` ON DELETE CASCADE |
| `pathway_id` | VARCHAR(36) | no | FK, IDX |  | → `recertification_pathways.id` ON DELETE CASCADE |
| `training_record_id` | VARCHAR(36) | yes | FK |  | → `training_records.id` ON DELETE SET NULL |
| `status` | ENUM(`pending`, `in_progress`, `completed`, `expired`, `lapsed`) | yes | IDX | `'pending'` |  |
| `certification_expiration_date` | DATE | no | IDX |  |  |
| `renewal_window_opens` | DATE | no |  |  |  |
| `grace_period_ends` | DATE | yes |  |  |  |
| `hours_completed` | FLOAT | yes |  | `0` |  |
| `courses_completed` | JSON | yes |  |  |  |
| `category_hours_completed` | JSON | yes |  |  |  |
| `assessment_passed` | BOOL | yes |  | `False` |  |
| `progress_percentage` | FLOAT | yes |  | `0.0` |  |
| `completed_at` | DATETIME | yes |  |  |  |
| `new_record_id` | VARCHAR(36) | yes | FK |  | → `training_records.id` ON DELETE SET NULL |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_renewal_task_expiration` (`certification_expiration_date`)
- `idx_renewal_task_pathway` (`pathway_id`)
- `idx_renewal_task_user` (`user_id`, `status`)
- `ix_renewal_tasks_organization_id` (`organization_id`)
- `ix_renewal_tasks_status` (`status`)

### `requirement_progress`

**RequirementProgress** · `app/models/training.py`

> Requirement Progress model Tracks individual requirement progress within a program enrollment.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `enrollment_id` | VARCHAR(36) | no | FK, IDX |  | → `program_enrollments.id` ON DELETE CASCADE |
| `requirement_id` | VARCHAR(36) | no | FK, IDX |  | → `training_requirements.id` ON DELETE CASCADE |
| `status` | ENUM(`not_started`, `in_progress`, `completed`, `verified`, `waived`) | yes | IDX | `'not_started'` |  |
| `progress_value` | FLOAT | yes |  | `0.0` |  |
| `progress_percentage` | FLOAT | yes |  | `0.0` |  |
| `progress_notes` | JSON | yes |  |  |  |
| `started_at` | DATETIME | yes |  |  |  |
| `completed_at` | DATETIME | yes |  |  |  |
| `verified_at` | DATETIME | yes |  |  |  |
| `verified_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `verification_notes` | TEXT | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_progress_enrollment` (`enrollment_id`, `status`)
- `idx_progress_requirement` (`requirement_id`)
- `ix_requirement_progress_status` (`status`)

### `requirement_progress_credits`

**RequirementProgressCredit** · `app/models/training.py`

> Idempotency ledger for automated requirement-progress credit. One row per (progress, source record) accrual. The unique constraint on (progress_id, source_type, source_id) is the safeguard: an automated feed that tries to apply the same source a second time is rejected at the DB level, so replays and cross-feed reprocessing cannot double-credit. Each row also records the units it contributed, which is what lets an officer cleanly un-apply a single credit later (see revoke path) without recomputing the whole enrollment by hand.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `progress_id` | VARCHAR(36) | no | FK |  | → `requirement_progress.id` ON DELETE CASCADE |
| `source_type` | ENUM(`training_session`, `shift_report`, `external_import`, `officer_apply`) | no |  |  |  |
| `source_id` | VARCHAR(64) | no |  |  |  |
| `units` | FLOAT | no |  | `0.0` |  |
| `applied_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | yes |  | `now()` |  |

**Constraints**

- UNIQUE `uq_progress_credit_source` (`progress_id`, `source_type`, `source_id`)

### `self_report_configs`

**SelfReportConfig** · `app/models/training.py`

> Self-Report Configuration model Organization-level configuration for what fields are required when members self-report training, and whether officer approval is needed.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, UQ, UQ-IDX |  | → `organizations.id` ON DELETE CASCADE |
| `require_approval` | BOOL | yes |  | `True` |  |
| `auto_approve_under_hours` | FLOAT | yes |  |  |  |
| `approval_deadline_days` | INTEGER | yes |  | `14` |  |
| `notify_officer_on_submit` | BOOL | yes |  | `True` |  |
| `notify_member_on_decision` | BOOL | yes |  | `True` |  |
| `field_config` | JSON | no |  | generated |  |
| `allowed_training_types` | JSON | yes |  |  |  |
| `max_hours_per_submission` | FLOAT | yes |  |  |  |
| `member_instructions` | TEXT | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `updated_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |

**Indexes**

- UNIQUE `ix_self_report_configs_organization_id` (`organization_id`)

### `shift_assignments`

**ShiftAssignment** · `app/models/training.py`

> Assigns a specific member to a specific shift with a designated position.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `shift_id` | VARCHAR(36) | no | FK, IDX |  | → `shifts.id` ON DELETE CASCADE |
| `user_id` | VARCHAR(36) | no | FK, IDX |  | → `users.id` ON DELETE CASCADE |
| `position` | ENUM(`officer`, `driver`, `firefighter`, `ems`, `captain`, `lieutenant`, `probationary`, `volunteer`, `other`) | no |  | `firefighter` |  |
| `assignment_status` | ENUM(`assigned`, `confirmed`, `declined`, `pending`, `cancelled`, `no_show`) | no |  | `assigned` |  |
| `is_training` | BOOL | no |  | `0` |  |
| `training_program_id` | VARCHAR(36) | yes | FK |  | → `training_programs.id` ON DELETE SET NULL |
| `training_evaluator_id` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `assigned_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `confirmed_at` | DATETIME | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_shift_assign_org` (`organization_id`)
- `idx_shift_assign_shift_status` (`shift_id`, `assignment_status`)
- `idx_shift_assign_user` (`user_id`)

**Constraints**

- UNIQUE `uq_shift_assignment_shift_user` (`shift_id`, `user_id`)

### `shift_attendance`

**ShiftAttendance** · `app/models/training.py`

> Shift Attendance model (Framework) Tracks individual member attendance on shifts.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `shift_id` | VARCHAR(36) | no | FK, IDX |  | → `shifts.id` ON DELETE CASCADE |
| `user_id` | VARCHAR(36) | no | FK, IDX |  | → `users.id` ON DELETE CASCADE |
| `checked_in_at` | DATETIME | yes |  |  |  |
| `checked_out_at` | DATETIME | yes |  |  |  |
| `duration_minutes` | INTEGER | yes |  |  |  |
| `call_count` | INTEGER | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_shift_att_shift` (`shift_id`)
- `idx_shift_att_user` (`user_id`)

### `shift_calls`

**ShiftCall** · `app/models/training.py`

> Shift Call model (Framework) Records calls/incidents responded to during a shift.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `shift_id` | VARCHAR(36) | no | FK, IDX |  | → `shifts.id` ON DELETE CASCADE |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `incident_number` | VARCHAR(100) | yes |  |  |  |
| `incident_type` | VARCHAR(100) | yes | IDX |  |  |
| `dispatched_at` | DATETIME | yes |  |  |  |
| `on_scene_at` | DATETIME | yes |  |  |  |
| `cleared_at` | DATETIME | yes |  |  |  |
| `cancelled_en_route` | BOOL | yes |  | `False` |  |
| `medical_refusal` | BOOL | yes |  | `False` |  |
| `responding_members` | JSON | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_call_shift` (`shift_id`)
- `idx_call_type` (`incident_type`)
- `ix_shift_calls_organization_id` (`organization_id`)

### `shift_completion_reports`

**ShiftCompletionReport** · `app/models/training.py`

> Shift Completion Report model Allows shift officers to report on a trainee's experience during a shift. Feeds into pipeline requirement progress for shift-based and call-based requirements.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `shift_id` | VARCHAR(36) | yes | FK |  | → `shifts.id` ON DELETE SET NULL |
| `shift_date` | DATE | no |  |  |  |
| `trainee_id` | VARCHAR(36) | no | FK, IDX |  | → `users.id` ON DELETE CASCADE |
| `officer_id` | VARCHAR(36) | no | FK, IDX |  | → `users.id` ON DELETE CASCADE |
| `hours_on_shift` | FLOAT | no |  |  |  |
| `calls_responded` | INTEGER | yes |  | `0` |  |
| `call_types` | JSON | yes |  |  |  |
| `performance_rating` | INTEGER | yes |  |  |  |
| `areas_of_strength` | TEXT | yes |  |  |  |
| `areas_for_improvement` | TEXT | yes |  |  |  |
| `officer_narrative` | TEXT | yes |  |  |  |
| `skills_observed` | JSON | yes |  |  |  |
| `tasks_performed` | JSON | yes |  |  |  |
| `data_sources` | JSON | yes |  |  |  |
| `enrollment_id` | VARCHAR(36) | yes | FK, IDX |  | → `program_enrollments.id` ON DELETE SET NULL |
| `requirements_progressed` | JSON | yes |  |  |  |
| `review_status` | VARCHAR(20) | yes |  | `'approved'` |  |
| `reviewed_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `reviewed_at` | DATETIME | yes |  |  |  |
| `reviewer_notes` | TEXT | yes |  |  |  |
| `review_history` | JSON | yes |  |  |  |
| `trainee_acknowledged` | BOOL | yes |  | `False` |  |
| `trainee_acknowledged_at` | DATETIME | yes |  |  |  |
| `trainee_comments` | TEXT | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_shift_report_enrollment` (`enrollment_id`)
- `idx_shift_report_officer` (`officer_id`)
- `idx_shift_report_org_date` (`organization_id`, `shift_date`)
- `idx_shift_report_review` (`organization_id`, `review_status`)
- `idx_shift_report_trainee` (`trainee_id`, `shift_date`)

**Constraints**

- UNIQUE `uq_shift_report_shift_trainee` (`shift_id`, `trainee_id`)

### `shift_equipment_check_items`

**ShiftEquipmentCheckItem** · `app/models/training.py`

> Individual item result within a completed equipment check. Snapshots the compartment and item name at the time of the check so historical records remain accurate even if the template changes.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `check_id` | VARCHAR(36) | no | FK, IDX |  | → `shift_equipment_checks.id` ON DELETE CASCADE |
| `template_item_id` | VARCHAR(36) | yes | FK, IDX |  | → `check_template_items.id` ON DELETE SET NULL |
| `compartment_name` | VARCHAR(200) | no |  |  |  |
| `item_name` | VARCHAR(200) | no |  |  |  |
| `check_type` | VARCHAR(30) | yes |  |  |  |
| `status` | VARCHAR(30) | no |  |  |  |
| `quantity_found` | INTEGER | yes |  |  |  |
| `required_quantity` | INTEGER | yes |  |  |  |
| `critical_minimum_quantity` | INTEGER | yes |  |  |  |
| `level_reading` | FLOAT | yes |  |  |  |
| `level_unit` | VARCHAR(50) | yes |  |  |  |
| `serial_number` | VARCHAR(100) | yes |  |  |  |
| `lot_number` | VARCHAR(100) | yes |  |  |  |
| `serial_found` | VARCHAR(100) | yes |  |  |  |
| `lot_found` | VARCHAR(100) | yes |  |  |  |
| `updated_serial` | BOOL | no |  | `0` |  |
| `photo_urls` | JSON | yes |  |  |  |
| `is_expired` | BOOL | no |  | `False` |  |
| `expiration_date` | DATE | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_shift_equip_check_item_check` (`check_id`)
- `idx_shift_equip_check_item_tmpl` (`template_item_id`)

### `shift_equipment_checks`

**ShiftEquipmentCheck** · `app/models/training.py`

> A completed equipment checklist submission for a shift. Links to the template that was used, the shift, and the member who performed the check. Stores aggregate counts for quick display.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `shift_id` | VARCHAR(36) | yes | FK, IDX |  | → `shifts.id` ON DELETE SET NULL |
| `template_id` | VARCHAR(36) | yes | FK, IDX |  | → `equipment_check_templates.id` ON DELETE SET NULL |
| `apparatus_id` | VARCHAR(36) | yes |  |  |  |
| `checked_by` | VARCHAR(36) | yes | FK, IDX |  | → `users.id` ON DELETE SET NULL |
| `checked_at` | DATETIME | yes |  | `now()` |  |
| `check_timing` | VARCHAR(30) | no |  |  |  |
| `check_context` | VARCHAR(30) | no |  | `shift_based` |  |
| `overall_status` | VARCHAR(30) | no |  |  |  |
| `total_items` | INTEGER | no |  | `0` |  |
| `completed_items` | INTEGER | no |  | `0` |  |
| `failed_items` | INTEGER | no |  | `0` |  |
| `notes` | TEXT | yes |  |  |  |
| `signature_data` | TEXT | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_shift_equip_check_org_date` (`organization_id`, `checked_at`)
- `idx_shift_equip_check_shift_timing` (`shift_id`, `check_timing`)
- `idx_shift_equip_check_shift_tmpl` (`shift_id`, `template_id`)
- `idx_shift_equip_check_template` (`template_id`)
- `idx_shift_equip_check_user` (`checked_by`)

### `shift_patterns`

**ShiftPattern** · `app/models/training.py`

> Recurring shift pattern for automatic schedule generation. Supports platoon rotations, weekly schedules, etc.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(200) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `pattern_type` | ENUM(`daily`, `weekly`, `platoon`, `custom`) | no |  | `'weekly'` |  |
| `template_id` | VARCHAR(36) | yes | FK |  | → `shift_templates.id` ON DELETE SET NULL |
| `rotation_days` | INTEGER | yes |  |  |  |
| `days_on` | INTEGER | yes |  |  |  |
| `days_off` | INTEGER | yes |  |  |  |
| `schedule_config` | JSON | yes |  |  |  |
| `start_date` | DATE | no |  |  |  |
| `end_date` | DATE | yes |  |  |  |
| `assigned_members` | JSON | yes |  |  |  |
| `is_active` | BOOL | yes |  | `True` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |

**Indexes**

- `idx_shift_pattern_org` (`organization_id`)

### `shift_swap_requests`

**ShiftSwapRequest** · `app/models/training.py`

> Request to swap shifts between two members.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `requesting_user_id` | VARCHAR(36) | no | FK, IDX |  | → `users.id` ON DELETE CASCADE |
| `offering_shift_id` | VARCHAR(36) | no | FK |  | → `shifts.id` ON DELETE CASCADE |
| `requesting_shift_id` | VARCHAR(36) | yes | FK |  | → `shifts.id` ON DELETE SET NULL |
| `target_user_id` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `status` | ENUM(`pending`, `approved`, `denied`, `cancelled`) | no | IDX | `pending` |  |
| `reason` | TEXT | yes |  |  |  |
| `reviewed_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `reviewed_at` | DATETIME | yes |  |  |  |
| `reviewer_notes` | TEXT | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_swap_req_org` (`organization_id`)
- `idx_swap_req_status` (`status`)
- `idx_swap_req_user` (`requesting_user_id`)

### `shift_templates`

**ShiftTemplate** · `app/models/training.py`

> Reusable shift template for quick shift creation. E.g., "Day Shift", "Night Shift", "Weekend Duty"

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(200) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `start_time_of_day` | VARCHAR(5) | no |  |  |  |
| `end_time_of_day` | VARCHAR(5) | no |  |  |  |
| `duration_hours` | FLOAT | no |  |  |  |
| `color` | VARCHAR(7) | yes |  |  |  |
| `positions` | JSON | yes |  |  |  |
| `min_staffing` | INTEGER | yes |  | `1` |  |
| `category` | VARCHAR(20) | yes |  | `'standard'` |  |
| `apparatus_type` | VARCHAR(50) | yes |  |  |  |
| `apparatus_id` | VARCHAR(36) | yes |  |  |  |
| `is_default` | BOOL | yes |  | `False` |  |
| `is_active` | BOOL | yes |  | `True` |  |
| `open_to_all_members` | BOOL | no |  | `0` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |

**Indexes**

- `idx_shift_template_org` (`organization_id`)

### `shift_time_off`

**ShiftTimeOff** · `app/models/training.py`

> Member request for time off / unavailability.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `user_id` | VARCHAR(36) | no | FK, IDX |  | → `users.id` ON DELETE CASCADE |
| `start_date` | DATE | no | IDX |  |  |
| `end_date` | DATE | no |  |  |  |
| `reason` | TEXT | yes |  |  |  |
| `status` | ENUM(`pending`, `approved`, `denied`, `cancelled`) | no |  | `pending` |  |
| `approved_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `approved_at` | DATETIME | yes |  |  |  |
| `reviewer_notes` | TEXT | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_timeoff_dates` (`start_date`, `end_date`)
- `idx_timeoff_org` (`organization_id`)
- `idx_timeoff_user` (`user_id`)

### `shifts`

**Shift** · `app/models/training.py`

> Shift model (Framework) Records shift information for tracking member participation and activities.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `shift_date` | DATE | no | IDX |  |  |
| `start_time` | DATETIME | no |  |  |  |
| `end_time` | DATETIME | yes |  |  |  |
| `apparatus_id` | VARCHAR(36) | yes |  |  |  |
| `station_id` | VARCHAR(36) | yes |  |  |  |
| `platoon` | VARCHAR(20) | yes |  |  |  |
| `shift_officer_id` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `color` | VARCHAR(7) | yes |  |  |  |
| `positions` | JSON | yes |  |  |  |
| `min_staffing` | INTEGER | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `activities` | JSON | yes |  |  |  |
| `pass_down_notes` | TEXT | yes |  |  |  |
| `open_to_all_members` | BOOL | no |  | `0` |  |
| `call_count` | INTEGER | yes |  |  |  |
| `total_hours` | FLOAT | yes |  |  |  |
| `is_finalized` | BOOL | no |  | `0` |  |
| `finalized_at` | DATETIME | yes |  |  |  |
| `finalized_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `status` | ENUM(`scheduled`, `cancelled`) | no |  | `scheduled` |  |
| `cancelled_at` | DATETIME | yes |  |  |  |
| `cancelled_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `cancellation_reason` | TEXT | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |

**Indexes**

- `idx_shift_date` (`organization_id`, `shift_date`)
- `ix_shifts_shift_date` (`shift_date`)

### `skill_checkoffs`

**SkillCheckoff** · `app/models/training.py`

> Skill Checkoff model Records individual skill evaluations.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `user_id` | VARCHAR(36) | no | FK, IDX |  | → `users.id` ON DELETE CASCADE |
| `skill_evaluation_id` | VARCHAR(36) | no | FK, IDX |  | → `skill_evaluations.id` ON DELETE CASCADE |
| `evaluator_id` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `status` | VARCHAR(20) | no |  |  |  |
| `session_id` | VARCHAR(36) | yes | FK, IDX |  | → `training_sessions.id` ON DELETE SET NULL |
| `apparatus_id` | VARCHAR(36) | yes | FK, IDX |  | → `apparatus.id` ON DELETE SET NULL |
| `conditions` | JSON | yes |  |  |  |
| `evaluation_results` | JSON | yes |  |  |  |
| `score` | FLOAT | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `evaluated_at` | DATETIME | yes |  | `now()` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_checkoff_skill` (`skill_evaluation_id`)
- `idx_checkoff_user` (`user_id`)
- `ix_skill_checkoffs_apparatus_id` (`apparatus_id`)
- `ix_skill_checkoffs_organization_id` (`organization_id`)
- `ix_skill_checkoffs_session_id` (`session_id`)

### `skill_evaluations`

**SkillEvaluation** · `app/models/training.py`

> Skill Evaluation model Defines skills that require evaluation/checkoff.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(255) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `category` | VARCHAR(100) | yes |  |  |  |
| `evaluation_criteria` | JSON | yes |  |  |  |
| `passing_requirements` | TEXT | yes |  |  |  |
| `required_for_programs` | JSON | yes |  |  |  |
| `allowed_evaluators` | JSON | yes |  |  |  |
| `active` | BOOL | yes | IDX | `True` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |

**Indexes**

- `idx_skill_org_category` (`organization_id`, `category`)
- `ix_skill_evaluations_active` (`active`)

### `training_approvals`

**TrainingApproval** · `app/models/training.py`

> Training Approval model Tracks pending training time approvals for training officers. Created when a training session is finalized.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `training_session_id` | VARCHAR(36) | no | FK, IDX |  | → `training_sessions.id` ON DELETE CASCADE |
| `event_id` | VARCHAR(36) | no | FK, IDX |  | → `events.id` ON DELETE CASCADE |
| `approval_token` | VARCHAR(64) | no | UQ, UQ-IDX |  |  |
| `token_expires_at` | DATETIME | no |  |  |  |
| `status` | ENUM(`pending`, `approved`, `modified`, `rejected`) | yes | IDX | `'pending'` |  |
| `approved_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `approved_at` | DATETIME | yes |  |  |  |
| `approval_notes` | TEXT | yes |  |  |  |
| `approval_deadline` | DATETIME | no | IDX |  |  |
| `reminder_sent_at` | DATETIME | yes |  |  |  |
| `attendee_data` | JSON | no |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_approval_deadline` (`approval_deadline`)
- `idx_approval_session` (`training_session_id`)
- `idx_approval_status` (`status`)
- UNIQUE `ix_training_approvals_approval_token` (`approval_token`)
- `ix_training_approvals_event_id` (`event_id`)
- `ix_training_approvals_organization_id` (`organization_id`)

### `training_categories`

**TrainingCategory** · `app/models/training.py`

> Training Category model Defines categories that training sessions can be applied towards. Examples: Fire Training, EMS Training, Driver Training, Officer Development, etc. Training hours can count towards multiple categories.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(255) | no |  |  |  |
| `code` | VARCHAR(50) | yes |  |  |  |
| `registry_code` | VARCHAR(100) | yes |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `color` | VARCHAR(7) | yes |  |  |  |
| `parent_category_id` | VARCHAR(36) | yes | FK, IDX |  | → `training_categories.id` ON DELETE SET NULL |
| `sort_order` | INTEGER | yes |  | `0` |  |
| `icon` | VARCHAR(50) | yes |  |  |  |
| `active` | BOOL | yes | IDX | `True` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |

**Indexes**

- `idx_category_org_code` (`organization_id`, `code`)
- `idx_category_parent` (`parent_category_id`)
- `idx_category_registry_code` (`organization_id`, `registry_code`)
- `ix_training_categories_active` (`active`)

### `training_courses`

**TrainingCourse** · `app/models/training.py`

> Training Course model Represents a specific training course or class that can be assigned to members.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(255) | no |  |  |  |
| `code` | VARCHAR(50) | yes |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `training_type` | ENUM(`certification`, `continuing_education`, `skills_practice`, `orientation`, `refresher`, `specialty`) | no |  |  |  |
| `duration_hours` | FLOAT | yes |  |  |  |
| `credit_hours` | FLOAT | yes |  |  |  |
| `prerequisites` | JSON | yes |  |  |  |
| `expiration_months` | INTEGER | yes |  |  |  |
| `instructor` | VARCHAR(255) | yes |  |  |  |
| `max_participants` | INTEGER | yes |  |  |  |
| `materials_required` | JSON | yes |  |  |  |
| `category_ids` | JSON | yes |  |  |  |
| `program_id` | VARCHAR(36) | yes | FK |  | → `training_programs.id` ON DELETE SET NULL |
| `active` | BOOL | yes | IDX | `True` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |

**Indexes**

- `idx_course_org_code` (`organization_id`, `code`)
- `ix_training_courses_active` (`active`)

### `training_effectiveness_evaluations`

**TrainingEffectivenessEvaluation** · `app/models/training.py`

> Training Effectiveness Evaluation model Implements the Kirkpatrick Model for measuring training effectiveness. Level 1 (Reaction): Post-training survey Level 2 (Learning): Pre/post assessment scores Level 3 (Behavior): On-the-job observation Level 4 (Results): Incident performance correlation

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `user_id` | VARCHAR(36) | no | FK, IDX |  | → `users.id` ON DELETE CASCADE |
| `training_record_id` | VARCHAR(36) | yes | FK, IDX |  | → `training_records.id` ON DELETE CASCADE |
| `training_session_id` | VARCHAR(36) | yes | FK |  | → `training_sessions.id` ON DELETE SET NULL |
| `course_id` | VARCHAR(36) | yes | FK |  | → `training_courses.id` ON DELETE SET NULL |
| `evaluation_level` | ENUM(`reaction`, `learning`, `behavior`, `results`) | no | IDX |  |  |
| `survey_responses` | JSON | yes |  |  |  |
| `overall_rating` | FLOAT | yes |  |  |  |
| `pre_assessment_score` | FLOAT | yes |  |  |  |
| `post_assessment_score` | FLOAT | yes |  |  |  |
| `knowledge_gain_percentage` | FLOAT | yes |  |  |  |
| `behavior_observations` | JSON | yes |  |  |  |
| `behavior_rating` | FLOAT | yes |  |  |  |
| `results_metrics` | JSON | yes |  |  |  |
| `results_notes` | TEXT | yes |  |  |  |
| `evaluated_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `evaluated_at` | DATETIME | yes |  | `now()` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_effectiveness_level` (`evaluation_level`)
- `idx_effectiveness_org` (`organization_id`)
- `idx_effectiveness_record` (`training_record_id`)
- `idx_effectiveness_user` (`user_id`)

### `training_module_configs`

**TrainingModuleConfig** · `app/models/training.py`

> Training Module Configuration model Organization-level configuration controlling what training data members can see about themselves. Each field group can be toggled on/off. Training officers and chiefs always see everything regardless of settings.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, UQ, UQ-IDX |  | → `organizations.id` ON DELETE CASCADE |
| `show_training_history` | BOOL | yes |  | `1` |  |
| `show_training_hours` | BOOL | yes |  | `1` |  |
| `show_certification_status` | BOOL | yes |  | `1` |  |
| `show_pipeline_progress` | BOOL | yes |  | `1` |  |
| `show_requirement_details` | BOOL | yes |  | `1` |  |
| `show_shift_reports` | BOOL | yes |  | `1` |  |
| `show_shift_stats` | BOOL | yes |  | `1` |  |
| `show_officer_narrative` | BOOL | yes |  | `0` |  |
| `show_performance_rating` | BOOL | yes |  | `1` |  |
| `show_areas_of_strength` | BOOL | yes |  | `1` |  |
| `show_areas_for_improvement` | BOOL | yes |  | `1` |  |
| `show_skills_observed` | BOOL | yes |  | `1` |  |
| `skills_result_disclosure` | VARCHAR(20) | yes |  | `full` |  |
| `skills_result_release` | VARCHAR(20) | yes |  | `on_completion` |  |
| `show_submission_history` | BOOL | yes |  | `1` |  |
| `allow_member_report_export` | BOOL | yes |  | `0` |  |
| `report_review_required` | BOOL | yes |  | `0` |  |
| `report_review_role` | VARCHAR(50) | yes |  | `'training_officer'` |  |
| `rating_label` | VARCHAR(100) | yes |  | `'Performance Rating'` |  |
| `rating_scale_type` | VARCHAR(20) | yes |  | `'stars'` |  |
| `rating_scale_labels` | JSON | yes |  |  |  |
| `apparatus_type_skills` | JSON | yes |  |  |  |
| `apparatus_type_tasks` | JSON | yes |  |  |  |
| `form_show_performance_rating` | BOOL | yes |  | `1` |  |
| `form_show_areas_of_strength` | BOOL | yes |  | `1` |  |
| `form_show_areas_for_improvement` | BOOL | yes |  | `1` |  |
| `form_show_officer_narrative` | BOOL | yes |  | `1` |  |
| `form_show_skills_observed` | BOOL | yes |  | `1` |  |
| `form_show_tasks_performed` | BOOL | yes |  | `1` |  |
| `form_show_call_types` | BOOL | yes |  | `1` |  |
| `shift_reports_enabled` | BOOL | yes |  | `1` |  |
| `shift_reports_include_training` | BOOL | yes |  | `1` |  |
| `shift_review_call_types` | JSON | yes |  |  |  |
| `shift_review_default_skills` | JSON | yes |  |  |  |
| `shift_review_default_tasks` | JSON | yes |  |  |  |
| `manual_entry_enabled` | BOOL | yes |  | `0` |  |
| `manual_entry_require_apparatus` | BOOL | yes |  | `1` |  |
| `manual_entry_apparatus_ids` | JSON | yes |  |  |  |
| `manual_entry_default_start_time` | VARCHAR(5) | yes |  |  |  |
| `manual_entry_default_duration_hours` | FLOAT | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `updated_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |

**Indexes**

- UNIQUE `ix_training_module_configs_organization_id` (`organization_id`)

### `training_programs`

**TrainingProgram** · `app/models/training.py`

> Training Program model Defines custom training programs (probationary, driver candidate, officer development, etc.) with phases, requirements, and milestones.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(255) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `code` | VARCHAR(50) | yes |  |  |  |
| `version` | INTEGER | yes |  | `1` |  |
| `target_position` | VARCHAR(100) | yes | IDX |  |  |
| `target_roles` | JSON | yes |  |  |  |
| `structure_type` | ENUM(`sequential`, `phases`, `flexible`) | no |  | `flexible` |  |
| `prerequisite_program_ids` | JSON | yes |  |  |  |
| `allows_concurrent_enrollment` | BOOL | yes |  | `True` |  |
| `time_limit_days` | INTEGER | yes |  |  |  |
| `warning_days_before` | INTEGER | yes |  | `30` |  |
| `reminder_conditions` | JSON | yes |  |  |  |
| `recert_enabled` | BOOL | no |  | `0` |  |
| `recert_interval_months` | INTEGER | yes |  |  |  |
| `recert_anchor_month` | INTEGER | yes |  |  |  |
| `recert_anchor_day` | INTEGER | yes |  |  |  |
| `active` | BOOL | yes | IDX | `True` |  |
| `is_template` | BOOL | yes |  | `False` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |

**Indexes**

- `idx_program_org_active` (`organization_id`, `active`)
- `idx_program_position` (`target_position`)
- `ix_training_programs_active` (`active`)

### `training_records`

**TrainingRecord** · `app/models/training.py`

> Training Record model Tracks individual training completions for members.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `user_id` | VARCHAR(36) | no | FK, IDX |  | → `users.id` ON DELETE CASCADE |
| `course_id` | VARCHAR(36) | yes | FK, IDX |  | → `training_courses.id` ON DELETE SET NULL |
| `category_id` | VARCHAR(36) | yes | FK, IDX |  | → `training_categories.id` ON DELETE SET NULL |
| `course_name` | VARCHAR(255) | no |  |  |  |
| `course_code` | VARCHAR(50) | yes |  |  |  |
| `training_type` | ENUM(`certification`, `continuing_education`, `skills_practice`, `orientation`, `refresher`, `specialty`) | no |  |  |  |
| `scheduled_date` | DATE | yes |  |  |  |
| `completion_date` | DATE | yes | IDX |  |  |
| `expiration_date` | DATE | yes | IDX |  |  |
| `hours_completed` | FLOAT | no |  |  |  |
| `credit_hours` | FLOAT | yes |  |  |  |
| `certification_number` | VARCHAR(100) | yes |  |  |  |
| `issuing_agency` | VARCHAR(255) | yes |  |  |  |
| `status` | ENUM(`scheduled`, `in_progress`, `completed`, `cancelled`, `failed`) | yes | IDX | `'scheduled'` |  |
| `score` | FLOAT | yes |  |  |  |
| `passing_score` | FLOAT | yes |  |  |  |
| `passed` | BOOL | yes |  |  |  |
| `instructor` | VARCHAR(255) | yes |  |  |  |
| `location_id` | VARCHAR(36) | yes | FK, IDX |  | → `locations.id` ON DELETE SET NULL |
| `location` | VARCHAR(255) | yes |  |  |  |
| `apparatus_id` | VARCHAR(36) | yes | FK, IDX |  | → `apparatus.id` ON DELETE SET NULL |
| `rank_at_completion` | VARCHAR(100) | yes |  |  |  |
| `station_at_completion` | VARCHAR(100) | yes |  |  |  |
| `external_provider_id` | VARCHAR(36) | yes | FK, IDX |  | → `external_training_providers.id` ON DELETE SET NULL |
| `external_record_id` | VARCHAR(255) | yes |  |  |  |
| `notes` | TEXT | yes |  |  |  |
| `attachments` | JSON | yes |  |  |  |
| `alert_90_sent_at` | DATETIME | yes |  |  |  |
| `alert_60_sent_at` | DATETIME | yes |  |  |  |
| `alert_30_sent_at` | DATETIME | yes |  |  |  |
| `alert_7_sent_at` | DATETIME | yes |  |  |  |
| `escalation_sent_at` | DATETIME | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |

**Indexes**

- `idx_record_category` (`category_id`)
- `idx_record_completion` (`completion_date`)
- `idx_record_expiration` (`expiration_date`)
- `idx_record_external` (`external_provider_id`, `external_record_id`)
- `idx_record_location` (`location_id`)
- `idx_record_user_status` (`user_id`, `status`)
- `ix_training_records_apparatus_id` (`apparatus_id`)
- `ix_training_records_course_id` (`course_id`)
- `ix_training_records_organization_id` (`organization_id`)
- `ix_training_records_status` (`status`)

### `training_requirements`

**TrainingRequirement** · `app/models/training.py`

> Training Requirement model Defines training requirements for the organization or specific roles. Can be sourced from department, state, or national registries.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(255) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `requirement_type` | ENUM(`hours`, `courses`, `certification`, `shifts`, `calls`, `skills_evaluation`, `checklist`, `knowledge_test`) | no | IDX |  |  |
| `training_type` | ENUM(`certification`, `continuing_education`, `skills_practice`, `orientation`, `refresher`, `specialty`) | yes |  |  |  |
| `source` | ENUM(`department`, `state`, `national`) | no |  | `department` |  |
| `registry_name` | VARCHAR(100) | yes |  |  |  |
| `registry_code` | VARCHAR(50) | yes |  |  |  |
| `is_editable` | BOOL | yes |  | `True` |  |
| `allows_external_credit` | BOOL | no |  | `0` |  |
| `required_hours` | FLOAT | yes |  |  |  |
| `required_courses` | JSON | yes |  |  |  |
| `required_shifts` | INTEGER | yes |  |  |  |
| `required_calls` | INTEGER | yes |  |  |  |
| `required_call_types` | JSON | yes |  |  |  |
| `required_skills` | JSON | yes |  |  |  |
| `checklist_items` | JSON | yes |  |  |  |
| `passing_score` | FLOAT | yes |  |  |  |
| `max_attempts` | INTEGER | yes |  |  |  |
| `frequency` | ENUM(`annual`, `biannual`, `quarterly`, `monthly`, `one_time`) | no |  |  |  |
| `year` | INTEGER | yes |  |  |  |
| `due_date_type` | ENUM(`calendar_period`, `rolling`, `certification_period`, `fixed_date`) | yes |  | `'calendar_period'` |  |
| `rolling_period_months` | INTEGER | yes |  |  |  |
| `period_start_month` | INTEGER | yes |  | `1` |  |
| `period_start_day` | INTEGER | yes |  | `1` |  |
| `period_end_month` | INTEGER | yes |  |  |  |
| `period_end_day` | INTEGER | yes |  |  |  |
| `include_current_month` | BOOL | yes |  |  |  |
| `recency_days` | INTEGER | yes |  |  |  |
| `category_ids` | JSON | yes |  |  |  |
| `applies_to_all` | BOOL | yes |  | `True` |  |
| `required_roles` | JSON | yes |  |  |  |
| `required_positions` | JSON | yes |  |  |  |
| `required_membership_types` | JSON | yes |  |  |  |
| `start_date` | DATE | yes |  |  |  |
| `due_date` | DATE | yes | IDX |  |  |
| `time_limit_days` | INTEGER | yes |  |  |  |
| `active` | BOOL | yes | IDX | `True` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |

**Indexes**

- `idx_requirement_due` (`due_date`)
- `idx_requirement_org_source` (`organization_id`, `source`)
- `idx_requirement_type` (`requirement_type`)
- `idx_requirement_year` (`organization_id`, `year`)
- `ix_training_requirements_active` (`active`)

### `training_sessions`

**TrainingSession** · `app/models/training.py`

> Training Session model Links an Event to a TrainingCourse to create a scheduled training session. When members check in to the event, TrainingRecords are automatically created.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `event_id` | VARCHAR(36) | no | FK, UQ, UQ-IDX |  | → `events.id` ON DELETE CASCADE |
| `course_id` | VARCHAR(36) | yes | FK |  | → `training_courses.id` ON DELETE SET NULL |
| `category_id` | VARCHAR(36) | yes | FK, IDX |  | → `training_categories.id` ON DELETE SET NULL |
| `program_id` | VARCHAR(36) | yes | FK, IDX |  | → `training_programs.id` ON DELETE SET NULL |
| `phase_id` | VARCHAR(36) | yes | FK |  | → `program_phases.id` ON DELETE SET NULL |
| `requirement_id` | VARCHAR(36) | yes | FK |  | → `training_requirements.id` ON DELETE SET NULL |
| `course_name` | VARCHAR(255) | no |  |  |  |
| `course_code` | VARCHAR(50) | yes |  |  |  |
| `training_type` | ENUM(`certification`, `continuing_education`, `skills_practice`, `orientation`, `refresher`, `specialty`) | no |  |  |  |
| `credit_hours` | FLOAT | no |  |  |  |
| `instructor` | VARCHAR(255) | yes |  |  |  |
| `instructor_id` | VARCHAR(36) | yes | FK, IDX |  | → `users.id` ON DELETE SET NULL |
| `co_instructors` | JSON | yes |  |  |  |
| `apparatus_id` | VARCHAR(36) | yes | FK, IDX |  | → `apparatus.id` ON DELETE SET NULL |
| `issues_certification` | BOOL | yes |  | `False` |  |
| `certification_number_prefix` | VARCHAR(50) | yes |  |  |  |
| `issuing_agency` | VARCHAR(255) | yes |  |  |  |
| `expiration_months` | INTEGER | yes |  |  |  |
| `counts_toward_certification` | BOOL | no |  | `1` |  |
| `auto_create_records` | BOOL | yes |  | `True` |  |
| `require_completion_confirmation` | BOOL | yes |  | `False` |  |
| `approval_deadline_days` | INTEGER | yes |  | `7` |  |
| `is_finalized` | BOOL | yes |  | `False` |  |
| `finalized_at` | DATETIME | yes |  |  |  |
| `finalized_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `created_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |

**Indexes**

- `idx_training_session_org` (`organization_id`)
- `ix_training_sessions_apparatus_id` (`apparatus_id`)
- `ix_training_sessions_category_id` (`category_id`)
- UNIQUE `ix_training_sessions_event_id` (`event_id`)
- `ix_training_sessions_instructor_id` (`instructor_id`)
- `ix_training_sessions_program_id` (`program_id`)

### `training_submissions`

**TrainingSubmission** · `app/models/training.py`

> Training Submission model Tracks self-reported training from members. Once approved, a TrainingRecord is created from the submission data.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `submitted_by` | VARCHAR(36) | no | FK, IDX |  | → `users.id` ON DELETE CASCADE |
| `course_name` | VARCHAR(255) | no |  |  |  |
| `course_code` | VARCHAR(50) | yes |  |  |  |
| `training_type` | ENUM(`certification`, `continuing_education`, `skills_practice`, `orientation`, `refresher`, `specialty`) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `completion_date` | DATE | no | IDX |  |  |
| `hours_completed` | FLOAT | no |  |  |  |
| `credit_hours` | FLOAT | yes |  |  |  |
| `instructor` | VARCHAR(255) | yes |  |  |  |
| `location` | VARCHAR(255) | yes |  |  |  |
| `certification_number` | VARCHAR(100) | yes |  |  |  |
| `issuing_agency` | VARCHAR(255) | yes |  |  |  |
| `expiration_date` | DATE | yes |  |  |  |
| `category_id` | VARCHAR(36) | yes | FK |  | → `training_categories.id` ON DELETE SET NULL |
| `attachments` | JSON | yes |  |  |  |
| `status` | ENUM(`draft`, `pending_review`, `approved`, `rejected`, `revision_requested`) | no | IDX | `pending_review` |  |
| `reviewed_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `reviewed_at` | DATETIME | yes |  |  |  |
| `reviewer_notes` | TEXT | yes |  |  |  |
| `training_record_id` | VARCHAR(36) | yes | FK |  | → `training_records.id` ON DELETE SET NULL |
| `submitted_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_submission_date` (`completion_date`)
- `idx_submission_org_status` (`organization_id`, `status`)
- `idx_submission_user` (`submitted_by`, `status`)
- `ix_training_submissions_status` (`status`)

### `training_waivers`

**TrainingWaiver** · `app/models/training.py`

> Training Waiver / Leave of Absence Records periods where a member is excused from training requirements. When a rolling-period requirement is calculated (e.g., average 6 hours over 12 months), waived months are excluded from the denominator so the member's required average is computed only over months they were active.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `user_id` | VARCHAR(36) | no | FK, IDX |  | → `users.id` ON DELETE CASCADE |
| `waiver_type` | ENUM(`leave_of_absence`, `medical`, `military`, `personal`, `administrative`, `new_member`, `other`) | no |  | `leave_of_absence` |  |
| `reason` | TEXT | yes |  |  |  |
| `start_date` | DATE | no | IDX |  |  |
| `end_date` | DATE | yes |  |  |  |
| `requirement_ids` | JSON | yes |  |  |  |
| `granted_by` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `granted_at` | DATETIME | yes |  |  |  |
| `active` | BOOL | no |  | `1` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_training_waivers_dates` (`start_date`, `end_date`)
- `idx_training_waivers_org_user` (`organization_id`, `user_id`)
- `ix_training_waivers_user_id` (`user_id`)

### `xapi_statements`

**XAPIStatement** · `app/models/training.py`

> xAPI (Experience API / Tin Can) Statement model Stores learning activity statements in xAPI format. Enables ingestion from any xAPI-compliant learning platform without building provider-specific connectors.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `actor_email` | VARCHAR(255) | yes | IDX |  |  |
| `actor_name` | VARCHAR(255) | yes |  |  |  |
| `user_id` | VARCHAR(36) | yes | FK, IDX |  | → `users.id` ON DELETE SET NULL |
| `verb_id` | VARCHAR(500) | no | IDX |  |  |
| `verb_display` | VARCHAR(100) | yes |  |  |  |
| `object_id` | VARCHAR(500) | no |  |  |  |
| `object_name` | VARCHAR(500) | yes |  |  |  |
| `object_type` | VARCHAR(100) | yes |  |  |  |
| `score_scaled` | FLOAT | yes |  |  |  |
| `score_raw` | FLOAT | yes |  |  |  |
| `score_min` | FLOAT | yes |  |  |  |
| `score_max` | FLOAT | yes |  |  |  |
| `success` | BOOL | yes |  |  |  |
| `completion` | BOOL | yes |  |  |  |
| `duration_seconds` | INTEGER | yes |  |  |  |
| `context_registration` | VARCHAR(36) | yes |  |  |  |
| `context_platform` | VARCHAR(255) | yes |  |  |  |
| `context_extensions` | JSON | yes |  |  |  |
| `raw_statement` | JSON | no |  |  |  |
| `processed` | BOOL | yes | IDX | `False` |  |
| `training_record_id` | VARCHAR(36) | yes | FK |  | → `training_records.id` ON DELETE SET NULL |
| `source_provider_id` | VARCHAR(36) | yes | FK |  | → `external_training_providers.id` ON DELETE SET NULL |
| `statement_timestamp` | DATETIME | no | IDX |  |  |
| `stored_at` | DATETIME | yes |  | `now()` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_xapi_actor` (`actor_email`)
- `idx_xapi_org` (`organization_id`)
- `idx_xapi_processed` (`processed`)
- `idx_xapi_timestamp` (`statement_timestamp`)
- `idx_xapi_verb` (`verb_id`)
- `ix_xapi_statements_user_id` (`user_id`)

## Users, Organizations & Access Control

### `member_leaves_of_absence`

**MemberLeaveOfAbsence** · `app/models/user.py`

> Member Leave of Absence Records periods where a member is on leave from the department. When a rolling-period requirement is calculated, months that fall within a leave period are excluded from the denominator so the member is not penalised for time they were inactive. Managed through the membership module and read by training and shift modules.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `user_id` | VARCHAR(36) | no | FK, IDX |  | → `users.id` ON DELETE CASCADE |
| `leave_type` | ENUM(`leave_of_absence`, `medical`, `military`, `personal`, `administrative`, `new_member`, `other`) | no |  | `leave_of_absence` |  |
| `reason` | TEXT | yes |  |  |  |
| `start_date` | DATE | no | IDX |  |  |
| `end_date` | DATE | yes |  |  |  |
| `granted_by` | VARCHAR(36) | yes | FK |  | → `users.id` |
| `granted_at` | DATETIME | yes |  |  |  |
| `active` | BOOL | no |  | `1` |  |
| `exempt_from_training_waiver` | BOOL | no |  | `0` |  |
| `linked_training_waiver_id` | VARCHAR(36) | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_member_leave_dates` (`start_date`, `end_date`)
- `idx_member_leave_org_user` (`organization_id`, `user_id`)
- `ix_member_leaves_of_absence_user_id` (`user_id`)

### `organizations`

**Organization** · `app/models/user.py`

> Organization/Department model Supports multi-tenancy - each organization is isolated. Contains comprehensive organization details including addresses, contact information, and regulatory identifiers.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `name` | VARCHAR(255) | no |  |  |  |
| `slug` | VARCHAR(100) | no | UQ |  |  |
| `description` | TEXT | yes |  |  |  |
| `organization_type` | ENUM(`fire_department`, `ems_only`, `fire_ems_combined`) | no |  | `fire_department` |  |
| `timezone` | VARCHAR(50) | yes |  | `'America/New_York'` |  |
| `phone` | VARCHAR(20) | yes |  |  |  |
| `fax` | VARCHAR(20) | yes |  |  |  |
| `email` | VARCHAR(255) | yes |  |  |  |
| `website` | VARCHAR(255) | yes |  |  |  |
| `mailing_address_line1` | VARCHAR(255) | yes |  |  |  |
| `mailing_address_line2` | VARCHAR(255) | yes |  |  |  |
| `mailing_city` | VARCHAR(100) | yes |  |  |  |
| `mailing_state` | VARCHAR(50) | yes |  |  |  |
| `mailing_zip` | VARCHAR(20) | yes |  |  |  |
| `mailing_country` | VARCHAR(100) | yes |  | `'USA'` |  |
| `physical_address_same` | BOOL | yes |  | `True` |  |
| `physical_address_line1` | VARCHAR(255) | yes |  |  |  |
| `physical_address_line2` | VARCHAR(255) | yes |  |  |  |
| `physical_city` | VARCHAR(100) | yes |  |  |  |
| `physical_state` | VARCHAR(50) | yes |  |  |  |
| `physical_zip` | VARCHAR(20) | yes |  |  |  |
| `physical_country` | VARCHAR(100) | yes |  | `'USA'` |  |
| `identifier_type` | ENUM(`fdid`, `state_id`, `department_id`) | no |  | `department_id` |  |
| `fdid` | VARCHAR(50) | yes |  |  |  |
| `state_id` | VARCHAR(50) | yes |  |  |  |
| `department_id` | VARCHAR(50) | yes |  |  |  |
| `county` | VARCHAR(100) | yes |  |  |  |
| `founded_year` | INTEGER | yes |  |  |  |
| `tax_id` | VARCHAR(50) | yes |  |  |  |
| `logo` | LONGTEXT | yes |  |  |  |
| `type` | VARCHAR(50) | yes |  | `'fire_department'` |  |
| `settings` | JSON | yes |  | `dict()` |  |
| `active` | BOOL | yes | IDX | `True` |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `ix_organizations_active` (`active`)

**Constraints**

- UNIQUE `uq_organizations_slug` (`slug`)

### `password_history`

**PasswordHistory** · `app/models/user.py`

> Password history for HIPAA compliance (§164.312(d)) Stores hashes of previous passwords to prevent reuse. The system checks the last N entries (configured via HIPAA_PASSWORD_HISTORY_COUNT) before allowing a password change.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `user_id` | VARCHAR(36) | no | FK, IDX |  | → `users.id` ON DELETE CASCADE |
| `password_hash` | VARCHAR(255) | no |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_password_history_user_created` (`user_id`, `created_at`)

### `positions`

**Position** · `app/models/user.py`

> Corporate Position model for permission-based access control. Positions are the primary source of permissions. Each member may hold multiple positions (e.g., Treasurer + Safety Officer). The ``it_manager`` position is the "System Owner" with wildcard access. Every member receives the ``member`` position by default.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, UQ-IDX |  | → `organizations.id` ON DELETE CASCADE |
| `name` | VARCHAR(100) | no |  |  |  |
| `slug` | VARCHAR(100) | no |  |  |  |
| `description` | TEXT | yes |  |  |  |
| `permissions` | JSON | yes |  | `list()` |  |
| `is_system` | BOOL | yes |  | `False` |  |
| `priority` | INTEGER | yes |  | `0` |  |
| `settings` | JSON | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- UNIQUE `idx_position_org_slug` (`organization_id`, `slug`)

### `prospects`

**Prospect** · `app/models/user.py`

> Prospective member – someone who has expressed interest in joining the department but has not yet been accepted. Prospects are lightweight records without department credentials (no department ID, no department email, no User record). When a prospect is accepted and converted to Probationary membership, a full User record is created and this record is marked as converted.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, IDX |  | → `organizations.id` ON DELETE CASCADE |
| `first_name` | VARCHAR(100) | no |  |  |  |
| `middle_name` | VARCHAR(100) | yes |  |  |  |
| `last_name` | VARCHAR(100) | no |  |  |  |
| `email` | VARCHAR(255) | yes |  |  |  |
| `phone` | VARCHAR(20) | yes |  |  |  |
| `mobile` | VARCHAR(20) | yes |  |  |  |
| `address_street` | VARCHAR(255) | yes |  |  |  |
| `address_city` | VARCHAR(100) | yes |  |  |  |
| `address_state` | VARCHAR(50) | yes |  |  |  |
| `address_zip` | VARCHAR(20) | yes |  |  |  |
| `status` | VARCHAR(50) | yes |  | `'applied'` |  |
| `notes` | TEXT | yes |  |  |  |
| `referred_by` | VARCHAR(255) | yes |  |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `idx_prospect_org_email` (`organization_id`, `email`)
- `idx_prospect_org_status` (`organization_id`, `status`)

### `sessions`

**Session** · `app/models/user.py`

> User session model for tracking active sessions

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `user_id` | VARCHAR(36) | no | FK, IDX |  | → `users.id` ON DELETE CASCADE |
| `token` | VARCHAR(512) | no | UQ, UQ-IDX |  |  |
| `refresh_token` | VARCHAR(512) | yes |  |  |  |
| `previous_refresh_token` | VARCHAR(512) | yes | IDX |  |  |
| `previous_refresh_expires_at` | DATETIME | yes |  |  |  |
| `ip_address` | VARCHAR(45) | yes |  |  |  |
| `user_agent` | TEXT | yes |  |  |  |
| `geo_location` | JSON | yes |  |  |  |
| `expires_at` | DATETIME | no | IDX |  |  |
| `created_at` | DATETIME | yes |  | `now()` |  |
| `last_activity` | DATETIME | yes |  | `now()` |  |

**Indexes**

- `ix_sessions_expires_at` (`expires_at`)
- `ix_sessions_previous_refresh_token` (`previous_refresh_token`)
- UNIQUE `ix_sessions_token` (`token`)
- `ix_sessions_user_id` (`user_id`)

### `user_positions`

`app/models/user.py`

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `user_id` | VARCHAR(36) | no | PK, FK |  | → `users.id` ON DELETE CASCADE |
| `position_id` | VARCHAR(36) | no | PK, FK |  | → `positions.id` ON DELETE CASCADE |
| `assigned_at` | DATETIME | yes | IDX | `now()` |  |
| `assigned_by` | VARCHAR(36) | yes | FK, IDX |  | → `users.id` |

**Indexes**

- `ix_user_positions_assigned_at` (`assigned_at`)
- `ix_user_positions_assigned_by` (`assigned_by`)

### `users`

**User** · `app/models/user.py`

> User model with comprehensive authentication and profile support. Every converted member has a User record. Prospective members do **not** – they live in the ``prospects`` table until accepted.

| Column | Type | Null | Key | Default | References |
|---|---|---|---|---|---|
| `id` | VARCHAR(36) | no | PK | `generate_uuid()` |  |
| `organization_id` | VARCHAR(36) | no | FK, UQ-IDX |  | → `organizations.id` ON DELETE CASCADE |
| `username` | VARCHAR(100) | no |  |  |  |
| `email` | VARCHAR(255) | no | IDX |  |  |
| `personal_email` | VARCHAR(255) | yes |  |  |  |
| `password_hash` | VARCHAR(255) | yes |  |  |  |
| `oauth_provider` | VARCHAR(50) | yes |  |  |  |
| `oauth_subject` | VARCHAR(255) | yes | IDX |  |  |
| `first_name` | VARCHAR(100) | yes |  |  |  |
| `middle_name` | VARCHAR(100) | yes |  |  |  |
| `last_name` | VARCHAR(100) | yes |  |  |  |
| `membership_number` | VARCHAR(50) | yes |  |  |  |
| `previous_membership_number` | VARCHAR(50) | yes |  |  |  |
| `phone` | VARCHAR(20) | yes |  |  |  |
| `mobile` | VARCHAR(20) | yes |  |  |  |
| `photo_url` | TEXT | yes |  |  |  |
| `date_of_birth` | DATE | yes |  |  |  |
| `hire_date` | DATE | yes |  |  |  |
| `rank` | VARCHAR(100) | yes |  |  |  |
| `station` | VARCHAR(100) | yes |  |  |  |
| `platoon` | VARCHAR(20) | yes |  |  |  |
| `address_street` | VARCHAR(255) | yes |  |  |  |
| `address_city` | VARCHAR(100) | yes |  |  |  |
| `address_state` | VARCHAR(50) | yes |  |  |  |
| `address_zip` | VARCHAR(20) | yes |  |  |  |
| `address_country` | VARCHAR(100) | yes |  | `'USA'` |  |
| `referral_source` | VARCHAR(255) | yes |  |  |  |
| `interest_reason` | TEXT | yes |  |  |  |
| `referred_by_user_id` | VARCHAR(36) | yes | FK |  | → `users.id` ON DELETE SET NULL |
| `emergency_contacts` | JSON | yes |  | `list()` |  |
| `notification_preferences` | JSON | yes |  | `dict()` |  |
| `membership_type` | VARCHAR(50) | yes |  | `'active'` |  |
| `membership_type_changed_at` | DATETIME | yes |  |  |  |
| `status` | ENUM(`active`, `inactive`, `suspended`, `probationary`, `leave`, `retired`, `dropped_voluntary`, `dropped_involuntary`, `archived`) | yes | IDX | `'active'` |  |
| `status_changed_at` | DATETIME | yes |  |  |  |
| `status_change_reason` | TEXT | yes |  |  |  |
| `archived_at` | DATETIME | yes |  |  |  |
| `compliance_exempt` | BOOL | no |  | `0` |  |
| `email_verified` | BOOL | yes |  | `False` |  |
| `mfa_enabled` | BOOL | yes |  | `False` |  |
| `mfa_secret` | VARCHAR(255) | yes |  |  |  |
| `mfa_backup_codes` | JSON | yes |  |  |  |
| `mfa_last_timestep` | INTEGER | yes |  |  |  |
| `password_changed_at` | DATETIME | yes |  |  |  |
| `must_change_password` | BOOL | no |  | `0` |  |
| `failed_login_attempts` | INTEGER | yes |  | `0` |  |
| `locked_until` | DATETIME | yes |  |  |  |
| `password_reset_token` | VARCHAR(128) | yes | IDX |  |  |
| `password_reset_expires_at` | DATETIME | yes |  |  |  |
| `calendar_feed_token` | VARCHAR(64) | yes | IDX |  |  |
| `last_login_at` | DATETIME | yes | IDX |  |  |
| `created_at` | DATETIME | yes | IDX | `now()` |  |
| `updated_at` | DATETIME | yes |  | `now()` |  |
| `deleted_at` | DATETIME | yes |  |  |  |
| `anonymized_at` | DATETIME | yes |  |  |  |

**Indexes**

- `idx_user_created_at` (`created_at`)
- `idx_user_last_login_at` (`last_login_at`)
- UNIQUE `idx_user_org_email` (`organization_id`, `email`)
- UNIQUE `idx_user_org_membership_number` (`organization_id`, `membership_number`)
- `idx_user_org_status_deleted` (`organization_id`, `status`, `deleted_at`)
- UNIQUE `idx_user_org_username` (`organization_id`, `username`)
- `ix_users_calendar_feed_token` (`calendar_feed_token`)
- `ix_users_email` (`email`)
- `ix_users_oauth_subject` (`oauth_subject`)
- `ix_users_password_reset_token` (`password_reset_token`)
- `ix_users_status` (`status`)

---

## Foreign key reference

Every foreign key in the schema, grouped by the table it points at — the map of which id lives where.

### → `users` (288 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `admin_hours_categories` | `created_by` | NO ACTION | yes |
| `admin_hours_categories` | `updated_by` | NO ACTION | yes |
| `admin_hours_entries` | `approved_by` | NO ACTION | yes |
| `admin_hours_entries` | `user_id` | CASCADE | no |
| `apparatus` | `archived_by` | SET NULL | yes |
| `apparatus` | `created_by` | SET NULL | yes |
| `apparatus` | `status_changed_by` | SET NULL | yes |
| `apparatus_component_notes` | `created_by` | SET NULL | yes |
| `apparatus_component_notes` | `reported_by` | SET NULL | yes |
| `apparatus_component_notes` | `resolved_by` | SET NULL | yes |
| `apparatus_components` | `archived_by` | SET NULL | yes |
| `apparatus_components` | `created_by` | SET NULL | yes |
| `apparatus_custom_fields` | `created_by` | SET NULL | yes |
| `apparatus_documents` | `uploaded_by` | SET NULL | yes |
| `apparatus_equipment` | `assigned_by` | SET NULL | yes |
| `apparatus_fuel_logs` | `recorded_by` | SET NULL | yes |
| `apparatus_location_history` | `created_by` | SET NULL | yes |
| `apparatus_maintenance` | `completed_by` | SET NULL | yes |
| `apparatus_maintenance` | `created_by` | SET NULL | yes |
| `apparatus_nfpa_compliance` | `last_checked_by` | SET NULL | yes |
| `apparatus_operators` | `certified_by` | SET NULL | yes |
| `apparatus_operators` | `created_by` | SET NULL | yes |
| `apparatus_operators` | `user_id` | CASCADE | no |
| `apparatus_photos` | `uploaded_by` | SET NULL | yes |
| `apparatus_report_configs` | `created_by` | SET NULL | yes |
| `apparatus_service_providers` | `archived_by` | SET NULL | yes |
| `apparatus_service_providers` | `created_by` | SET NULL | yes |
| `apparatus_status_history` | `changed_by` | SET NULL | yes |
| `approval_chains` | `created_by` | NO ACTION | no |
| `approval_step_records` | `acted_by` | SET NULL | yes |
| `approval_step_records` | `assigned_to` | SET NULL | yes |
| `blocked_access_attempts` | `user_id` | NO ACTION | yes |
| `budgets` | `created_by` | NO ACTION | no |
| `candidates` | `nominated_by` | SET NULL | yes |
| `candidates` | `user_id` | SET NULL | yes |
| `check_requests` | `approved_by` | SET NULL | yes |
| `check_requests` | `requested_by` | NO ACTION | no |
| `checkout_records` | `checked_in_by` | NO ACTION | yes |
| `checkout_records` | `checked_out_by` | NO ACTION | yes |
| `checkout_records` | `user_id` | CASCADE | no |
| `competency_matrices` | `created_by` | SET NULL | yes |
| `compliance_configs` | `updated_by` | SET NULL | yes |
| `compliance_reports` | `generated_by` | SET NULL | yes |
| `country_block_rules` | `created_by` | NO ACTION | no |
| `country_block_rules` | `updated_by` | NO ACTION | yes |
| `course_classes` | `created_by` | SET NULL | yes |
| `course_classes` | `instructor_id` | SET NULL | yes |
| `course_cohort_classes` | `instructor_id` | SET NULL | yes |
| `course_cohort_members` | `added_by` | SET NULL | yes |
| `course_cohort_members` | `user_id` | CASCADE | no |
| `course_cohorts` | `created_by` | SET NULL | yes |
| `course_cohorts` | `generated_by` | SET NULL | yes |
| `department_message_reads` | `user_id` | CASCADE | no |
| `department_messages` | `posted_by` | SET NULL | yes |
| `departure_clearance_items` | `resolved_by` | NO ACTION | yes |
| `departure_clearances` | `completed_by` | NO ACTION | yes |
| `departure_clearances` | `initiated_by` | NO ACTION | yes |
| `departure_clearances` | `user_id` | CASCADE | no |
| `document_folders` | `created_by` | NO ACTION | yes |
| `document_folders` | `owner_user_id` | SET NULL | yes |
| `documents` | `uploaded_by` | NO ACTION | yes |
| `donations` | `recorded_by` | NO ACTION | yes |
| `donors` | `user_id` | SET NULL | yes |
| `dues_payments` | `recorded_by` | SET NULL | yes |
| `dues_schedules` | `created_by` | NO ACTION | no |
| `elections` | `created_by` | SET NULL | yes |
| `email_attachments` | `uploaded_by` | SET NULL | yes |
| `email_templates` | `created_by` | SET NULL | yes |
| `email_templates` | `updated_by` | SET NULL | yes |
| `equipment_check_templates` | `created_by` | SET NULL | yes |
| `equipment_kits` | `created_by` | NO ACTION | yes |
| `equipment_requests` | `fulfilled_by` | SET NULL | yes |
| `equipment_requests` | `requester_id` | CASCADE | no |
| `equipment_requests` | `reviewed_by` | SET NULL | yes |
| `event_external_attendees` | `created_by` | SET NULL | yes |
| `event_external_attendees` | `updated_by` | SET NULL | yes |
| `event_hour_mappings` | `created_by` | NO ACTION | yes |
| `event_request_activity` | `performed_by` | SET NULL | yes |
| `event_request_email_templates` | `created_by` | SET NULL | yes |
| `event_requests` | `assigned_to` | SET NULL | yes |
| `event_rsvps` | `overridden_by` | NO ACTION | yes |
| `event_rsvps` | `user_id` | CASCADE | no |
| `event_templates` | `created_by` | NO ACTION | yes |
| `event_templates` | `updated_by` | NO ACTION | yes |
| `events` | `created_by` | NO ACTION | yes |
| `events` | `updated_by` | NO ACTION | yes |
| `expense_reports` | `approved_by` | SET NULL | yes |
| `expense_reports` | `submitted_by` | NO ACTION | no |
| `external_category_mappings` | `mapped_by` | SET NULL | yes |
| `external_training_imports` | `user_id` | SET NULL | yes |
| `external_training_providers` | `created_by` | SET NULL | yes |
| `external_training_sync_logs` | `initiated_by` | SET NULL | yes |
| `external_user_mappings` | `internal_user_id` | SET NULL | yes |
| `external_user_mappings` | `mapped_by` | SET NULL | yes |
| `facilities` | `archived_by` | SET NULL | yes |
| `facilities` | `created_by` | SET NULL | yes |
| `facilities` | `status_changed_by` | SET NULL | yes |
| `facility_access_keys` | `assigned_to_user_id` | SET NULL | yes |
| `facility_access_keys` | `created_by` | SET NULL | yes |
| `facility_capital_projects` | `created_by` | SET NULL | yes |
| `facility_compliance_checklists` | `completed_by` | SET NULL | yes |
| `facility_compliance_checklists` | `created_by` | SET NULL | yes |
| `facility_documents` | `uploaded_by` | SET NULL | yes |
| `facility_inspections` | `created_by` | SET NULL | yes |
| `facility_insurance_policies` | `created_by` | SET NULL | yes |
| `facility_maintenance` | `completed_by` | SET NULL | yes |
| `facility_maintenance` | `created_by` | SET NULL | yes |
| `facility_occupants` | `created_by` | SET NULL | yes |
| `facility_photos` | `uploaded_by` | SET NULL | yes |
| `facility_rooms` | `created_by` | SET NULL | yes |
| `facility_rooms` | `updated_by` | SET NULL | yes |
| `facility_shutoff_locations` | `created_by` | SET NULL | yes |
| `facility_systems` | `archived_by` | SET NULL | yes |
| `facility_systems` | `created_by` | SET NULL | yes |
| `facility_utility_accounts` | `created_by` | SET NULL | yes |
| `facility_utility_readings` | `created_by` | SET NULL | yes |
| `finance_export_logs` | `exported_by` | NO ACTION | no |
| `fiscal_years` | `created_by` | NO ACTION | no |
| `form_submissions` | `submitted_by` | SET NULL | yes |
| `forms` | `created_by` | NO ACTION | yes |
| `fundraising_campaigns` | `created_by` | NO ACTION | yes |
| `fundraising_events` | `created_by` | NO ACTION | yes |
| `grant_applications` | `assigned_to` | SET NULL | yes |
| `grant_applications` | `created_by` | NO ACTION | yes |
| `grant_compliance_tasks` | `assigned_to` | SET NULL | yes |
| `grant_compliance_tasks` | `created_by` | NO ACTION | yes |
| `grant_expenditures` | `approved_by` | SET NULL | yes |
| `grant_expenditures` | `created_by` | NO ACTION | yes |
| `grant_notes` | `created_by` | NO ACTION | yes |
| `grant_opportunities` | `created_by` | NO ACTION | yes |
| `instructor_qualifications` | `created_by` | SET NULL | yes |
| `instructor_qualifications` | `user_id` | CASCADE | no |
| `instructor_qualifications` | `verified_by` | SET NULL | yes |
| `inventory_categories` | `created_by` | NO ACTION | yes |
| `inventory_impact_plans` | `created_by` | SET NULL | yes |
| `inventory_items` | `assigned_to_user_id` | SET NULL | yes |
| `inventory_items` | `created_by` | NO ACTION | yes |
| `inventory_lots` | `created_by` | SET NULL | yes |
| `inventory_notification_queue` | `performed_by` | NO ACTION | yes |
| `inventory_notification_queue` | `user_id` | CASCADE | no |
| `inventory_write_offs` | `requested_by` | RESTRICT | no |
| `inventory_write_offs` | `reviewed_by` | SET NULL | yes |
| `ip_exception_audit_log` | `performed_by` | NO ACTION | no |
| `ip_exceptions` | `approved_by` | NO ACTION | yes |
| `ip_exceptions` | `rejected_by` | NO ACTION | yes |
| `ip_exceptions` | `requested_by` | NO ACTION | no |
| `ip_exceptions` | `revoked_by` | NO ACTION | yes |
| `ip_exceptions` | `user_id` | CASCADE | no |
| `issuance_allowances` | `created_by` | NO ACTION | yes |
| `item_assignments` | `assigned_by` | NO ACTION | yes |
| `item_assignments` | `returned_by` | NO ACTION | yes |
| `item_assignments` | `user_id` | CASCADE | no |
| `item_issuances` | `issued_by` | NO ACTION | yes |
| `item_issuances` | `returned_by` | NO ACTION | yes |
| `item_issuances` | `user_id` | CASCADE | no |
| `item_variant_groups` | `created_by` | NO ACTION | yes |
| `locations` | `created_by` | NO ACTION | yes |
| `maintenance_records` | `created_by` | NO ACTION | yes |
| `maintenance_records` | `performed_by` | NO ACTION | yes |
| `manual_ballot_attestations` | `attested_by` | SET NULL | yes |
| `manual_ballot_batches` | `recorded_by` | SET NULL | yes |
| `meeting_action_items` | `assigned_to` | NO ACTION | yes |
| `meeting_attendees` | `user_id` | CASCADE | no |
| `meeting_attendees` | `waiver_granted_by` | NO ACTION | yes |
| `meeting_minutes` | `approved_by` | NO ACTION | yes |
| `meeting_minutes` | `created_by` | NO ACTION | yes |
| `meeting_minutes` | `rejected_by` | NO ACTION | yes |
| `meeting_minutes` | `submitted_by` | NO ACTION | yes |
| `meetings` | `approved_by` | NO ACTION | yes |
| `meetings` | `created_by` | NO ACTION | yes |
| `member_competencies` | `last_evaluator_id` | SET NULL | yes |
| `member_competencies` | `user_id` | CASCADE | no |
| `member_dues` | `user_id` | CASCADE | no |
| `member_dues` | `waived_by` | SET NULL | yes |
| `member_leaves_of_absence` | `granted_by` | NO ACTION | yes |
| `member_leaves_of_absence` | `user_id` | CASCADE | no |
| `member_size_preferences` | `user_id` | CASCADE | no |
| `membership_pipelines` | `created_by` | NO ACTION | yes |
| `message_history` | `sent_by` | SET NULL | yes |
| `minutes_action_items` | `assignee_id` | NO ACTION | yes |
| `minutes_templates` | `created_by` | NO ACTION | yes |
| `multi_agency_trainings` | `created_by` | SET NULL | yes |
| `nfpa_exposure_records` | `created_by` | NO ACTION | yes |
| `nfpa_exposure_records` | `user_id` | SET NULL | yes |
| `nfpa_item_compliance` | `created_by` | NO ACTION | yes |
| `notification_logs` | `recipient_id` | SET NULL | yes |
| `notification_rules` | `created_by` | NO ACTION | yes |
| `organization_officers` | `updated_by` | SET NULL | yes |
| `organization_officers` | `user_id` | SET NULL | yes |
| `password_history` | `user_id` | CASCADE | no |
| `pledges` | `created_by` | NO ACTION | yes |
| `program_enrollments` | `enrolled_by` | SET NULL | yes |
| `program_enrollments` | `user_id` | CASCADE | no |
| `property_return_reminders` | `user_id` | CASCADE | no |
| `prospect_activity_log` | `performed_by` | SET NULL | yes |
| `prospect_documents` | `uploaded_by` | SET NULL | yes |
| `prospect_event_links` | `linked_by` | SET NULL | yes |
| `prospect_interviews` | `interviewer_id` | SET NULL | yes |
| `prospect_step_progress` | `completed_by` | SET NULL | yes |
| `prospective_members` | `referred_by` | SET NULL | yes |
| `prospective_members` | `transferred_user_id` | SET NULL | yes |
| `public_portal_api_keys` | `created_by` | SET NULL | yes |
| `purchase_requests` | `approved_by` | SET NULL | yes |
| `purchase_requests` | `requested_by` | NO ACTION | no |
| `push_subscriptions` | `user_id` | CASCADE | no |
| `recertification_pathways` | `created_by` | SET NULL | yes |
| `renewal_tasks` | `user_id` | CASCADE | no |
| `reorder_requests` | `approved_by` | SET NULL | yes |
| `reorder_requests` | `requested_by` | SET NULL | yes |
| `requirement_progress` | `verified_by` | SET NULL | yes |
| `requirement_progress_credits` | `applied_by` | SET NULL | yes |
| `return_requests` | `requester_id` | CASCADE | no |
| `return_requests` | `reviewed_by` | SET NULL | yes |
| `rsvp_history` | `changed_by` | SET NULL | yes |
| `rsvp_history` | `user_id` | CASCADE | no |
| `saved_reports` | `created_by` | SET NULL | yes |
| `scheduled_emails` | `created_by` | SET NULL | yes |
| `screening_records` | `reviewed_by` | SET NULL | yes |
| `screening_records` | `user_id` | CASCADE | yes |
| `self_report_configs` | `updated_by` | SET NULL | yes |
| `sessions` | `user_id` | CASCADE | no |
| `shift_assignments` | `assigned_by` | SET NULL | yes |
| `shift_assignments` | `training_evaluator_id` | SET NULL | yes |
| `shift_assignments` | `user_id` | CASCADE | no |
| `shift_attendance` | `user_id` | CASCADE | no |
| `shift_completion_reports` | `officer_id` | CASCADE | no |
| `shift_completion_reports` | `reviewed_by` | SET NULL | yes |
| `shift_completion_reports` | `trainee_id` | CASCADE | no |
| `shift_equipment_checks` | `checked_by` | SET NULL | yes |
| `shift_patterns` | `created_by` | SET NULL | yes |
| `shift_swap_requests` | `requesting_user_id` | CASCADE | no |
| `shift_swap_requests` | `reviewed_by` | SET NULL | yes |
| `shift_swap_requests` | `target_user_id` | SET NULL | yes |
| `shift_templates` | `created_by` | SET NULL | yes |
| `shift_time_off` | `approved_by` | SET NULL | yes |
| `shift_time_off` | `user_id` | CASCADE | no |
| `shifts` | `cancelled_by` | SET NULL | yes |
| `shifts` | `created_by` | SET NULL | yes |
| `shifts` | `finalized_by` | SET NULL | yes |
| `shifts` | `shift_officer_id` | SET NULL | yes |
| `skill_checkoffs` | `evaluator_id` | SET NULL | yes |
| `skill_checkoffs` | `user_id` | CASCADE | no |
| `skill_evaluations` | `created_by` | SET NULL | yes |
| `skill_templates` | `created_by` | NO ACTION | yes |
| `skill_test_viewers` | `granted_by` | SET NULL | yes |
| `skill_test_viewers` | `user_id` | CASCADE | no |
| `skill_tests` | `candidate_id` | CASCADE | no |
| `skill_tests` | `examiner_id` | CASCADE | no |
| `skill_tests` | `released_by` | SET NULL | yes |
| `skill_tests` | `validated_by` | SET NULL | yes |
| `skill_tests` | `voided_by` | SET NULL | yes |
| `storage_areas` | `created_by` | NO ACTION | yes |
| `store_order_events` | `created_by` | SET NULL | yes |
| `store_order_windows` | `closed_by` | SET NULL | yes |
| `store_order_windows` | `created_by` | SET NULL | yes |
| `store_order_windows` | `vendor_ordered_by` | SET NULL | yes |
| `store_orders` | `fulfilled_by` | SET NULL | yes |
| `store_orders` | `payment_verified_by` | SET NULL | yes |
| `store_orders` | `user_id` | SET NULL | yes |
| `store_payment_events` | `resolved_by` | SET NULL | yes |
| `store_product_images` | `uploaded_by` | SET NULL | yes |
| `store_products` | `created_by` | SET NULL | yes |
| `template_change_logs` | `user_id` | SET NULL | yes |
| `training_approvals` | `approved_by` | SET NULL | yes |
| `training_categories` | `created_by` | SET NULL | yes |
| `training_courses` | `created_by` | SET NULL | yes |
| `training_effectiveness_evaluations` | `evaluated_by` | SET NULL | yes |
| `training_effectiveness_evaluations` | `user_id` | CASCADE | no |
| `training_module_configs` | `updated_by` | SET NULL | yes |
| `training_programs` | `created_by` | SET NULL | yes |
| `training_records` | `created_by` | SET NULL | yes |
| `training_records` | `user_id` | CASCADE | no |
| `training_requirements` | `created_by` | SET NULL | yes |
| `training_sessions` | `created_by` | SET NULL | yes |
| `training_sessions` | `finalized_by` | SET NULL | yes |
| `training_sessions` | `instructor_id` | SET NULL | yes |
| `training_submissions` | `reviewed_by` | SET NULL | yes |
| `training_submissions` | `submitted_by` | CASCADE | no |
| `training_waivers` | `granted_by` | SET NULL | yes |
| `training_waivers` | `user_id` | CASCADE | no |
| `user_consents` | `user_id` | CASCADE | no |
| `user_positions` | `assigned_by` | NO ACTION | yes |
| `user_positions` | `user_id` | CASCADE | no |
| `users` | `referred_by_user_id` | SET NULL | yes |
| `votes` | `proxy_voter_id` | SET NULL | yes |
| `votes` | `recorded_by` | SET NULL | yes |
| `votes` | `voter_id` | SET NULL | yes |
| `xapi_statements` | `user_id` | SET NULL | yes |

### → `organizations` (187 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `admin_hours_categories` | `organization_id` | CASCADE | no |
| `admin_hours_entries` | `organization_id` | CASCADE | no |
| `apparatus` | `organization_id` | CASCADE | no |
| `apparatus_component_notes` | `organization_id` | CASCADE | no |
| `apparatus_components` | `organization_id` | CASCADE | no |
| `apparatus_custom_fields` | `organization_id` | CASCADE | no |
| `apparatus_documents` | `organization_id` | CASCADE | no |
| `apparatus_equipment` | `organization_id` | CASCADE | no |
| `apparatus_fuel_logs` | `organization_id` | CASCADE | no |
| `apparatus_location_history` | `organization_id` | CASCADE | no |
| `apparatus_maintenance` | `organization_id` | CASCADE | no |
| `apparatus_maintenance_types` | `organization_id` | CASCADE | yes |
| `apparatus_nfpa_compliance` | `organization_id` | CASCADE | no |
| `apparatus_operators` | `organization_id` | CASCADE | no |
| `apparatus_photos` | `organization_id` | CASCADE | no |
| `apparatus_report_configs` | `organization_id` | CASCADE | no |
| `apparatus_service_providers` | `organization_id` | CASCADE | no |
| `apparatus_status_history` | `organization_id` | CASCADE | no |
| `apparatus_statuses` | `organization_id` | CASCADE | yes |
| `apparatus_types` | `organization_id` | CASCADE | yes |
| `approval_chains` | `organization_id` | CASCADE | no |
| `basic_apparatus` | `organization_id` | CASCADE | no |
| `budget_categories` | `organization_id` | CASCADE | no |
| `budgets` | `organization_id` | CASCADE | no |
| `check_requests` | `organization_id` | CASCADE | no |
| `checkout_records` | `organization_id` | CASCADE | no |
| `competency_matrices` | `organization_id` | CASCADE | no |
| `compliance_configs` | `organization_id` | CASCADE | no |
| `compliance_reports` | `organization_id` | CASCADE | no |
| `course_classes` | `organization_id` | CASCADE | no |
| `course_cohort_classes` | `organization_id` | CASCADE | no |
| `course_cohort_members` | `organization_id` | CASCADE | no |
| `course_cohorts` | `organization_id` | CASCADE | no |
| `department_messages` | `organization_id` | CASCADE | no |
| `departure_clearance_items` | `organization_id` | CASCADE | no |
| `departure_clearances` | `organization_id` | CASCADE | no |
| `document_folders` | `organization_id` | CASCADE | no |
| `documents` | `organization_id` | CASCADE | no |
| `donations` | `organization_id` | CASCADE | no |
| `donors` | `organization_id` | CASCADE | no |
| `dues_payments` | `organization_id` | CASCADE | no |
| `dues_schedules` | `organization_id` | CASCADE | no |
| `elections` | `organization_id` | CASCADE | no |
| `email_templates` | `organization_id` | CASCADE | no |
| `equipment_check_templates` | `organization_id` | CASCADE | no |
| `equipment_kits` | `organization_id` | CASCADE | no |
| `equipment_requests` | `organization_id` | CASCADE | no |
| `event_external_attendees` | `organization_id` | CASCADE | no |
| `event_hour_mappings` | `organization_id` | CASCADE | no |
| `event_request_email_templates` | `organization_id` | CASCADE | no |
| `event_requests` | `organization_id` | CASCADE | no |
| `event_rsvps` | `organization_id` | CASCADE | no |
| `event_templates` | `organization_id` | CASCADE | no |
| `events` | `organization_id` | CASCADE | no |
| `evoc_levels` | `organization_id` | CASCADE | yes |
| `expense_reports` | `organization_id` | CASCADE | no |
| `external_category_mappings` | `organization_id` | CASCADE | no |
| `external_training_imports` | `organization_id` | CASCADE | no |
| `external_training_providers` | `organization_id` | CASCADE | no |
| `external_training_sync_logs` | `organization_id` | CASCADE | no |
| `external_user_mappings` | `organization_id` | CASCADE | no |
| `facilities` | `organization_id` | CASCADE | no |
| `facility_access_keys` | `organization_id` | CASCADE | no |
| `facility_capital_projects` | `organization_id` | CASCADE | no |
| `facility_compliance_checklists` | `organization_id` | CASCADE | no |
| `facility_compliance_items` | `organization_id` | CASCADE | no |
| `facility_documents` | `organization_id` | CASCADE | no |
| `facility_emergency_contacts` | `organization_id` | CASCADE | no |
| `facility_inspections` | `organization_id` | CASCADE | no |
| `facility_insurance_policies` | `organization_id` | CASCADE | no |
| `facility_maintenance` | `organization_id` | CASCADE | no |
| `facility_maintenance_types` | `organization_id` | CASCADE | yes |
| `facility_occupants` | `organization_id` | CASCADE | no |
| `facility_photos` | `organization_id` | CASCADE | no |
| `facility_rooms` | `organization_id` | CASCADE | no |
| `facility_shutoff_locations` | `organization_id` | CASCADE | no |
| `facility_statuses` | `organization_id` | CASCADE | yes |
| `facility_systems` | `organization_id` | CASCADE | no |
| `facility_types` | `organization_id` | CASCADE | yes |
| `facility_utility_accounts` | `organization_id` | CASCADE | no |
| `facility_utility_readings` | `organization_id` | CASCADE | no |
| `finance_export_logs` | `organization_id` | CASCADE | no |
| `finance_export_mappings` | `organization_id` | CASCADE | no |
| `fiscal_years` | `organization_id` | CASCADE | no |
| `form_integrations` | `organization_id` | CASCADE | no |
| `form_submissions` | `organization_id` | CASCADE | no |
| `forms` | `organization_id` | CASCADE | no |
| `fundraising_campaigns` | `organization_id` | CASCADE | no |
| `fundraising_events` | `organization_id` | CASCADE | no |
| `grant_applications` | `organization_id` | CASCADE | no |
| `grant_opportunities` | `organization_id` | CASCADE | no |
| `instructor_qualifications` | `organization_id` | CASCADE | no |
| `inventory_categories` | `organization_id` | CASCADE | no |
| `inventory_impact_plans` | `organization_id` | CASCADE | no |
| `inventory_items` | `organization_id` | CASCADE | no |
| `inventory_lots` | `organization_id` | CASCADE | no |
| `inventory_notification_queue` | `organization_id` | CASCADE | no |
| `inventory_write_offs` | `organization_id` | CASCADE | no |
| `ip_exceptions` | `organization_id` | CASCADE | no |
| `issuance_allowances` | `organization_id` | CASCADE | no |
| `item_assignments` | `organization_id` | CASCADE | no |
| `item_issuances` | `organization_id` | CASCADE | no |
| `item_variant_groups` | `organization_id` | CASCADE | no |
| `locations` | `organization_id` | CASCADE | no |
| `maintenance_records` | `organization_id` | CASCADE | no |
| `manual_ballot_attestations` | `organization_id` | CASCADE | no |
| `manual_ballot_batches` | `organization_id` | CASCADE | no |
| `meeting_action_items` | `organization_id` | CASCADE | no |
| `meeting_attendees` | `organization_id` | CASCADE | no |
| `meeting_minutes` | `organization_id` | CASCADE | no |
| `meetings` | `organization_id` | CASCADE | no |
| `member_competencies` | `organization_id` | CASCADE | no |
| `member_dues` | `organization_id` | CASCADE | no |
| `member_leaves_of_absence` | `organization_id` | CASCADE | no |
| `member_size_preferences` | `organization_id` | CASCADE | no |
| `membership_pipelines` | `organization_id` | CASCADE | no |
| `message_history` | `organization_id` | CASCADE | yes |
| `minutes_templates` | `organization_id` | CASCADE | no |
| `multi_agency_trainings` | `organization_id` | CASCADE | no |
| `nfpa_exposure_records` | `organization_id` | CASCADE | no |
| `nfpa_inspection_details` | `organization_id` | CASCADE | no |
| `nfpa_item_compliance` | `organization_id` | CASCADE | no |
| `notification_logs` | `organization_id` | CASCADE | no |
| `notification_rules` | `organization_id` | CASCADE | no |
| `operational_ranks` | `organization_id` | CASCADE | no |
| `organization_officers` | `organization_id` | CASCADE | no |
| `pledges` | `organization_id` | CASCADE | no |
| `positions` | `organization_id` | CASCADE | no |
| `program_enrollments` | `organization_id` | CASCADE | no |
| `property_return_reminders` | `organization_id` | CASCADE | no |
| `prospective_members` | `organization_id` | CASCADE | no |
| `prospects` | `organization_id` | CASCADE | no |
| `public_portal_access_log` | `organization_id` | CASCADE | no |
| `public_portal_api_keys` | `organization_id` | CASCADE | no |
| `public_portal_config` | `organization_id` | CASCADE | no |
| `public_portal_data_whitelist` | `organization_id` | CASCADE | no |
| `purchase_requests` | `organization_id` | CASCADE | no |
| `push_subscriptions` | `organization_id` | CASCADE | no |
| `recertification_pathways` | `organization_id` | CASCADE | no |
| `renewal_tasks` | `organization_id` | CASCADE | no |
| `reorder_requests` | `organization_id` | CASCADE | no |
| `return_requests` | `organization_id` | CASCADE | no |
| `saved_reports` | `organization_id` | CASCADE | no |
| `scheduled_emails` | `organization_id` | CASCADE | no |
| `screening_records` | `organization_id` | CASCADE | no |
| `screening_requirements` | `organization_id` | CASCADE | no |
| `self_report_configs` | `organization_id` | CASCADE | no |
| `shift_assignments` | `organization_id` | CASCADE | no |
| `shift_calls` | `organization_id` | CASCADE | no |
| `shift_completion_reports` | `organization_id` | CASCADE | no |
| `shift_equipment_checks` | `organization_id` | CASCADE | no |
| `shift_patterns` | `organization_id` | CASCADE | no |
| `shift_swap_requests` | `organization_id` | CASCADE | no |
| `shift_templates` | `organization_id` | CASCADE | no |
| `shift_time_off` | `organization_id` | CASCADE | no |
| `shifts` | `organization_id` | CASCADE | no |
| `skill_checkoffs` | `organization_id` | CASCADE | no |
| `skill_evaluations` | `organization_id` | CASCADE | no |
| `skill_templates` | `organization_id` | CASCADE | no |
| `skill_tests` | `organization_id` | CASCADE | no |
| `storage_areas` | `organization_id` | CASCADE | no |
| `store_order_events` | `organization_id` | CASCADE | no |
| `store_order_items` | `organization_id` | CASCADE | no |
| `store_order_windows` | `organization_id` | CASCADE | no |
| `store_orders` | `organization_id` | CASCADE | no |
| `store_payment_events` | `organization_id` | CASCADE | no |
| `store_product_images` | `organization_id` | CASCADE | no |
| `store_product_variants` | `organization_id` | CASCADE | no |
| `store_products` | `organization_id` | CASCADE | no |
| `store_settings` | `organization_id` | CASCADE | no |
| `store_window_products` | `organization_id` | CASCADE | no |
| `template_change_logs` | `organization_id` | CASCADE | no |
| `training_approvals` | `organization_id` | CASCADE | no |
| `training_categories` | `organization_id` | CASCADE | no |
| `training_courses` | `organization_id` | CASCADE | no |
| `training_effectiveness_evaluations` | `organization_id` | CASCADE | no |
| `training_module_configs` | `organization_id` | CASCADE | no |
| `training_programs` | `organization_id` | CASCADE | no |
| `training_records` | `organization_id` | CASCADE | no |
| `training_requirements` | `organization_id` | CASCADE | no |
| `training_sessions` | `organization_id` | CASCADE | no |
| `training_submissions` | `organization_id` | CASCADE | no |
| `training_waivers` | `organization_id` | CASCADE | no |
| `user_consents` | `organization_id` | CASCADE | no |
| `users` | `organization_id` | CASCADE | no |
| `voting_tokens` | `organization_id` | CASCADE | no |
| `xapi_statements` | `organization_id` | CASCADE | no |

### → `facilities` (17 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `budgets` | `station_id` | SET NULL | yes |
| `facility_access_keys` | `facility_id` | CASCADE | no |
| `facility_capital_projects` | `facility_id` | CASCADE | no |
| `facility_compliance_checklists` | `facility_id` | CASCADE | no |
| `facility_documents` | `facility_id` | CASCADE | no |
| `facility_emergency_contacts` | `facility_id` | CASCADE | no |
| `facility_inspections` | `facility_id` | CASCADE | no |
| `facility_insurance_policies` | `facility_id` | CASCADE | no |
| `facility_maintenance` | `facility_id` | CASCADE | no |
| `facility_occupants` | `facility_id` | CASCADE | no |
| `facility_photos` | `facility_id` | CASCADE | no |
| `facility_rooms` | `facility_id` | CASCADE | no |
| `facility_shutoff_locations` | `facility_id` | CASCADE | no |
| `facility_systems` | `facility_id` | CASCADE | no |
| `facility_utility_accounts` | `facility_id` | CASCADE | no |
| `locations` | `facility_id` | SET NULL | yes |
| `purchase_requests` | `facility_id` | SET NULL | yes |

### → `apparatus` (16 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `apparatus_component_notes` | `apparatus_id` | CASCADE | no |
| `apparatus_components` | `apparatus_id` | CASCADE | no |
| `apparatus_documents` | `apparatus_id` | CASCADE | no |
| `apparatus_equipment` | `apparatus_id` | CASCADE | no |
| `apparatus_fuel_logs` | `apparatus_id` | CASCADE | no |
| `apparatus_location_history` | `apparatus_id` | CASCADE | no |
| `apparatus_maintenance` | `apparatus_id` | CASCADE | no |
| `apparatus_nfpa_compliance` | `apparatus_id` | CASCADE | no |
| `apparatus_operators` | `apparatus_id` | CASCADE | no |
| `apparatus_photos` | `apparatus_id` | CASCADE | no |
| `apparatus_status_history` | `apparatus_id` | CASCADE | no |
| `equipment_check_templates` | `apparatus_id` | CASCADE | yes |
| `purchase_requests` | `apparatus_id` | SET NULL | yes |
| `skill_checkoffs` | `apparatus_id` | SET NULL | yes |
| `training_records` | `apparatus_id` | SET NULL | yes |
| `training_sessions` | `apparatus_id` | SET NULL | yes |

### → `inventory_items` (16 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `check_template_items` | `inventory_item_id` | SET NULL | yes |
| `checkout_records` | `item_id` | CASCADE | no |
| `departure_clearance_items` | `item_id` | SET NULL | yes |
| `equipment_kit_items` | `item_id` | SET NULL | yes |
| `equipment_requests` | `item_id` | SET NULL | yes |
| `inventory_lots` | `inventory_item_id` | CASCADE | no |
| `inventory_notification_queue` | `item_id` | SET NULL | yes |
| `inventory_write_offs` | `item_id` | SET NULL | yes |
| `item_assignments` | `item_id` | CASCADE | no |
| `item_issuances` | `item_id` | CASCADE | no |
| `maintenance_records` | `item_id` | CASCADE | no |
| `nfpa_exposure_records` | `item_id` | CASCADE | no |
| `nfpa_item_compliance` | `item_id` | CASCADE | no |
| `reorder_requests` | `item_id` | SET NULL | yes |
| `return_requests` | `item_id` | CASCADE | no |
| `store_products` | `inventory_item_id` | SET NULL | yes |

### → `events` (14 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `admin_hours_entries` | `source_event_id` | SET NULL | yes |
| `course_cohort_classes` | `event_id` | SET NULL | yes |
| `elections` | `event_id` | SET NULL | yes |
| `event_external_attendees` | `event_id` | CASCADE | no |
| `event_requests` | `event_id` | SET NULL | yes |
| `event_rsvps` | `event_id` | CASCADE | no |
| `events` | `recurrence_parent_id` | NO ACTION | yes |
| `fundraising_events` | `event_id` | SET NULL | yes |
| `meeting_minutes` | `event_id` | SET NULL | yes |
| `meetings` | `event_id` | SET NULL | yes |
| `prospect_event_links` | `event_id` | CASCADE | no |
| `rsvp_history` | `event_id` | CASCADE | no |
| `training_approvals` | `event_id` | CASCADE | no |
| `training_sessions` | `event_id` | CASCADE | no |

### → `locations` (13 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `apparatus` | `current_location_id` | NO ACTION | yes |
| `apparatus` | `primary_station_id` | NO ACTION | yes |
| `apparatus_location_history` | `location_id` | NO ACTION | no |
| `course_classes` | `location_id` | SET NULL | yes |
| `course_cohort_classes` | `location_id` | SET NULL | yes |
| `course_cohorts` | `location_id` | SET NULL | yes |
| `event_requests` | `event_location_id` | SET NULL | yes |
| `event_templates` | `default_location_id` | NO ACTION | yes |
| `events` | `location_id` | NO ACTION | yes |
| `inventory_items` | `location_id` | SET NULL | yes |
| `meetings` | `location_id` | SET NULL | yes |
| `storage_areas` | `location_id` | SET NULL | yes |
| `training_records` | `location_id` | SET NULL | yes |

### → `training_categories` (9 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `course_classes` | `category_id` | SET NULL | yes |
| `course_cohort_classes` | `category_id` | SET NULL | yes |
| `external_category_mappings` | `internal_category_id` | SET NULL | yes |
| `external_training_providers` | `default_category_id` | SET NULL | yes |
| `instructor_qualifications` | `category_id` | CASCADE | yes |
| `training_categories` | `parent_category_id` | SET NULL | yes |
| `training_records` | `category_id` | SET NULL | yes |
| `training_sessions` | `category_id` | SET NULL | yes |
| `training_submissions` | `category_id` | SET NULL | yes |

### → `training_courses` (9 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `course_classes` | `class_course_id` | CASCADE | no |
| `course_classes` | `course_id` | CASCADE | no |
| `course_cohort_classes` | `class_course_id` | SET NULL | yes |
| `course_cohorts` | `course_id` | CASCADE | no |
| `instructor_qualifications` | `course_id` | CASCADE | yes |
| `recertification_pathways` | `assessment_course_id` | SET NULL | yes |
| `training_effectiveness_evaluations` | `course_id` | SET NULL | yes |
| `training_records` | `course_id` | SET NULL | yes |
| `training_sessions` | `course_id` | SET NULL | yes |

### → `training_programs` (9 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `course_cohorts` | `program_id` | SET NULL | yes |
| `evoc_levels` | `training_program_id` | SET NULL | yes |
| `program_enrollments` | `program_id` | CASCADE | no |
| `program_milestones` | `program_id` | CASCADE | no |
| `program_phases` | `program_id` | CASCADE | no |
| `program_requirements` | `program_id` | CASCADE | no |
| `shift_assignments` | `training_program_id` | SET NULL | yes |
| `training_courses` | `program_id` | SET NULL | yes |
| `training_sessions` | `program_id` | SET NULL | yes |

### → `prospective_members` (8 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `event_external_attendees` | `prospect_id` | SET NULL | yes |
| `prospect_activity_log` | `prospect_id` | CASCADE | no |
| `prospect_documents` | `prospect_id` | CASCADE | no |
| `prospect_election_packages` | `prospect_id` | CASCADE | no |
| `prospect_event_links` | `prospect_id` | CASCADE | no |
| `prospect_interviews` | `prospect_id` | CASCADE | no |
| `prospect_step_progress` | `prospect_id` | CASCADE | no |
| `screening_records` | `prospect_id` | CASCADE | yes |

### → `training_requirements` (8 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `course_classes` | `requirement_id` | SET NULL | yes |
| `course_cohort_classes` | `requirement_id` | SET NULL | yes |
| `program_requirements` | `requirement_id` | CASCADE | no |
| `recertification_pathways` | `source_requirement_id` | CASCADE | yes |
| `requirement_progress` | `requirement_id` | CASCADE | no |
| `skill_templates` | `requirement_id` | SET NULL | yes |
| `skill_tests` | `requirement_id` | SET NULL | yes |
| `training_sessions` | `requirement_id` | SET NULL | yes |

### → `inventory_categories` (7 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `equipment_kit_items` | `category_id` | SET NULL | yes |
| `equipment_requests` | `category_id` | SET NULL | yes |
| `inventory_categories` | `parent_category_id` | SET NULL | yes |
| `inventory_items` | `category_id` | SET NULL | yes |
| `issuance_allowances` | `category_id` | CASCADE | no |
| `item_variant_groups` | `category_id` | SET NULL | yes |
| `reorder_requests` | `category_id` | SET NULL | yes |

### → `shifts` (7 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `shift_assignments` | `shift_id` | CASCADE | no |
| `shift_attendance` | `shift_id` | CASCADE | no |
| `shift_calls` | `shift_id` | CASCADE | no |
| `shift_completion_reports` | `shift_id` | SET NULL | yes |
| `shift_equipment_checks` | `shift_id` | SET NULL | yes |
| `shift_swap_requests` | `offering_shift_id` | CASCADE | no |
| `shift_swap_requests` | `requesting_shift_id` | SET NULL | yes |

### → `training_records` (7 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `external_training_imports` | `training_record_id` | SET NULL | yes |
| `multi_agency_trainings` | `training_record_id` | SET NULL | yes |
| `renewal_tasks` | `new_record_id` | SET NULL | yes |
| `renewal_tasks` | `training_record_id` | SET NULL | yes |
| `training_effectiveness_evaluations` | `training_record_id` | CASCADE | yes |
| `training_submissions` | `training_record_id` | SET NULL | yes |
| `xapi_statements` | `training_record_id` | SET NULL | yes |

### → `elections` (6 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `candidates` | `election_id` | CASCADE | no |
| `elections` | `parent_election_id` | NO ACTION | yes |
| `manual_ballot_batches` | `election_id` | CASCADE | no |
| `prospect_election_packages` | `election_id` | SET NULL | yes |
| `votes` | `election_id` | CASCADE | no |
| `voting_tokens` | `election_id` | CASCADE | no |

### → `external_training_providers` (6 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `external_category_mappings` | `provider_id` | CASCADE | no |
| `external_training_imports` | `provider_id` | CASCADE | no |
| `external_training_sync_logs` | `provider_id` | CASCADE | no |
| `external_user_mappings` | `provider_id` | CASCADE | no |
| `training_records` | `external_provider_id` | SET NULL | yes |
| `xapi_statements` | `source_provider_id` | SET NULL | yes |

### → `program_phases` (6 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `course_classes` | `phase_id` | SET NULL | yes |
| `course_cohort_classes` | `phase_id` | SET NULL | yes |
| `program_enrollments` | `current_phase_id` | SET NULL | yes |
| `program_milestones` | `phase_id` | CASCADE | yes |
| `program_requirements` | `phase_id` | CASCADE | yes |
| `training_sessions` | `phase_id` | SET NULL | yes |

### → `fiscal_years` (5 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `budgets` | `fiscal_year_id` | CASCADE | no |
| `check_requests` | `fiscal_year_id` | CASCADE | no |
| `dues_schedules` | `fiscal_year_id` | SET NULL | yes |
| `expense_reports` | `fiscal_year_id` | CASCADE | no |
| `purchase_requests` | `fiscal_year_id` | CASCADE | no |

### → `membership_pipeline_steps` (5 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `prospect_documents` | `step_id` | SET NULL | yes |
| `prospect_election_packages` | `step_id` | SET NULL | yes |
| `prospect_interviews` | `step_id` | SET NULL | yes |
| `prospect_step_progress` | `step_id` | CASCADE | no |
| `prospective_members` | `current_step_id` | SET NULL | yes |

### → `training_sessions` (5 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `course_cohort_classes` | `training_session_id` | SET NULL | yes |
| `multi_agency_trainings` | `training_session_id` | CASCADE | yes |
| `skill_checkoffs` | `session_id` | SET NULL | yes |
| `training_approvals` | `training_session_id` | CASCADE | no |
| `training_effectiveness_evaluations` | `training_session_id` | SET NULL | yes |

### → `email_templates` (4 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `approval_chain_steps` | `email_template_id` | SET NULL | yes |
| `email_attachments` | `template_id` | CASCADE | no |
| `membership_pipeline_steps` | `email_template_id` | SET NULL | yes |
| `scheduled_emails` | `template_id` | SET NULL | yes |

### → `fundraising_campaigns` (4 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `donations` | `campaign_id` | SET NULL | yes |
| `fundraising_events` | `campaign_id` | CASCADE | yes |
| `grant_applications` | `linked_campaign_id` | SET NULL | yes |
| `pledges` | `campaign_id` | SET NULL | yes |

### → `grant_applications` (4 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `grant_budget_items` | `application_id` | CASCADE | no |
| `grant_compliance_tasks` | `application_id` | CASCADE | no |
| `grant_expenditures` | `application_id` | CASCADE | no |
| `grant_notes` | `application_id` | CASCADE | no |

### → `meetings` (4 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `elections` | `meeting_id` | SET NULL | yes |
| `meeting_action_items` | `meeting_id` | CASCADE | no |
| `meeting_attendees` | `meeting_id` | CASCADE | no |
| `meeting_minutes` | `meeting_id` | SET NULL | yes |

### → `membership_pipelines` (4 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `membership_pipeline_steps` | `pipeline_id` | CASCADE | no |
| `prospect_election_packages` | `pipeline_id` | SET NULL | yes |
| `prospect_interviews` | `pipeline_id` | SET NULL | yes |
| `prospective_members` | `pipeline_id` | SET NULL | yes |

### → `store_products` (4 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `store_order_items` | `product_id` | SET NULL | yes |
| `store_product_images` | `product_id` | CASCADE | no |
| `store_product_variants` | `product_id` | CASCADE | no |
| `store_window_products` | `product_id` | CASCADE | no |

### → `budget_categories` (3 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `approval_chains` | `budget_category_id` | SET NULL | yes |
| `budget_categories` | `parent_category_id` | SET NULL | yes |
| `budgets` | `category_id` | CASCADE | no |

### → `budgets` (3 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `check_requests` | `budget_id` | SET NULL | yes |
| `expense_line_items` | `budget_id` | SET NULL | yes |
| `purchase_requests` | `budget_id` | SET NULL | yes |

### → `equipment_check_templates` (3 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `check_template_compartments` | `template_id` | CASCADE | no |
| `shift_equipment_checks` | `template_id` | SET NULL | yes |
| `template_change_logs` | `template_id` | CASCADE | no |

### → `forms` (3 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `form_fields` | `form_id` | CASCADE | no |
| `form_integrations` | `form_id` | CASCADE | no |
| `form_submissions` | `form_id` | CASCADE | no |

### → `program_enrollments` (3 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `course_cohort_members` | `enrollment_id` | SET NULL | yes |
| `requirement_progress` | `enrollment_id` | CASCADE | no |
| `shift_completion_reports` | `enrollment_id` | SET NULL | yes |

### → `public_portal_config` (3 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `public_portal_access_log` | `config_id` | CASCADE | no |
| `public_portal_api_keys` | `config_id` | CASCADE | no |
| `public_portal_data_whitelist` | `config_id` | CASCADE | no |

### → `skill_evaluations` (3 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `instructor_qualifications` | `skill_evaluation_id` | CASCADE | yes |
| `member_competencies` | `skill_evaluation_id` | CASCADE | no |
| `skill_checkoffs` | `skill_evaluation_id` | CASCADE | no |

### → `store_orders` (3 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `store_order_events` | `order_id` | CASCADE | no |
| `store_order_items` | `order_id` | CASCADE | no |
| `store_payment_events` | `matched_order_id` | SET NULL | yes |

### → `admin_hours_categories` (2 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `admin_hours_entries` | `category_id` | CASCADE | no |
| `event_hour_mappings` | `admin_hours_category_id` | CASCADE | no |

### → `apparatus_components` (2 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `apparatus_component_notes` | `component_id` | CASCADE | no |
| `apparatus_maintenance` | `component_id` | SET NULL | yes |

### → `apparatus_service_providers` (2 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `apparatus_component_notes` | `service_provider_id` | SET NULL | yes |
| `apparatus_maintenance` | `service_provider_id` | SET NULL | yes |

### → `apparatus_statuses` (2 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `apparatus` | `status_id` | NO ACTION | no |
| `apparatus_status_history` | `status_id` | NO ACTION | no |

### → `approval_chains` (2 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `approval_chain_steps` | `chain_id` | CASCADE | no |
| `approval_step_records` | `chain_id` | CASCADE | no |

### → `check_template_compartments` (2 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `check_template_compartments` | `parent_compartment_id` | SET NULL | yes |
| `check_template_items` | `compartment_id` | CASCADE | no |

### → `course_cohorts` (2 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `course_cohort_classes` | `cohort_id` | CASCADE | no |
| `course_cohort_members` | `cohort_id` | CASCADE | no |

### → `departure_clearances` (2 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `departure_clearance_items` | `clearance_id` | CASCADE | no |
| `inventory_write_offs` | `clearance_id` | SET NULL | yes |

### → `document_folders` (2 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `document_folders` | `parent_id` | CASCADE | yes |
| `documents` | `folder_id` | SET NULL | yes |

### → `donors` (2 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `donations` | `donor_id` | SET NULL | yes |
| `pledges` | `donor_id` | SET NULL | yes |

### → `event_rsvps` (2 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `admin_hours_entries` | `source_rsvp_id` | SET NULL | yes |
| `rsvp_history` | `rsvp_id` | CASCADE | no |

### → `evoc_levels` (2 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `apparatus` | `required_evoc_level_id` | SET NULL | yes |
| `apparatus_operators` | `evoc_level_id` | SET NULL | yes |

### → `form_submissions` (2 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `event_requests` | `form_submission_id` | SET NULL | yes |
| `prospective_members` | `form_submission_id` | SET NULL | yes |

### → `meeting_minutes` (2 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `meeting_motions` | `minutes_id` | CASCADE | no |
| `minutes_action_items` | `minutes_id` | CASCADE | no |

### → `positions` (2 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `issuance_allowances` | `role_id` | CASCADE | yes |
| `user_positions` | `position_id` | CASCADE | no |

### → `storage_areas` (2 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `inventory_items` | `storage_area_id` | SET NULL | yes |
| `storage_areas` | `parent_id` | CASCADE | yes |

### → `store_order_windows` (2 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `store_orders` | `window_id` | SET NULL | yes |
| `store_window_products` | `window_id` | CASCADE | no |

### → `apparatus_equipment` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `check_template_items` | `equipment_id` | SET NULL | yes |

### → `apparatus_maintenance_types` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `apparatus_maintenance` | `maintenance_type_id` | NO ACTION | no |

### → `apparatus_types` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `apparatus` | `apparatus_type_id` | NO ACTION | no |

### → `approval_chain_steps` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `approval_step_records` | `step_id` | CASCADE | no |

### → `candidates` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `votes` | `candidate_id` | CASCADE | no |

### → `check_template_items` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `shift_equipment_check_items` | `template_item_id` | SET NULL | yes |

### → `checkout_records` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `return_requests` | `checkout_id` | SET NULL | yes |

### → `compliance_configs` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `compliance_profiles` | `config_id` | CASCADE | no |

### → `course_classes` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `course_cohort_classes` | `course_class_id` | SET NULL | yes |

### → `department_messages` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `department_message_reads` | `message_id` | CASCADE | no |

### → `dues_schedules` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `member_dues` | `dues_schedule_id` | CASCADE | no |

### → `equipment_kits` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `equipment_kit_items` | `kit_id` | CASCADE | no |

### → `event_requests` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `event_request_activity` | `request_id` | CASCADE | no |

### → `event_templates` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `events` | `template_id` | NO ACTION | yes |

### → `expense_reports` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `expense_line_items` | `expense_report_id` | CASCADE | no |

### → `external_training_sync_logs` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `external_training_imports` | `sync_log_id` | SET NULL | yes |

### → `facility_compliance_checklists` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `facility_compliance_items` | `checklist_id` | CASCADE | no |

### → `facility_maintenance_types` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `facility_maintenance` | `maintenance_type_id` | NO ACTION | no |

### → `facility_rooms` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `locations` | `facility_room_id` | SET NULL | yes |

### → `facility_statuses` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `facilities` | `status_id` | NO ACTION | no |

### → `facility_systems` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `facility_maintenance` | `system_id` | SET NULL | yes |

### → `facility_types` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `facilities` | `facility_type_id` | NO ACTION | no |

### → `facility_utility_accounts` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `facility_utility_readings` | `utility_account_id` | CASCADE | no |

### → `grant_budget_items` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `grant_expenditures` | `budget_item_id` | SET NULL | yes |

### → `grant_opportunities` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `grant_applications` | `opportunity_id` | SET NULL | yes |

### → `ip_exceptions` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `ip_exception_audit_log` | `exception_id` | CASCADE | no |

### → `item_assignments` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `return_requests` | `assignment_id` | SET NULL | yes |

### → `item_issuances` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `return_requests` | `issuance_id` | SET NULL | yes |

### → `item_variant_groups` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `inventory_items` | `variant_group_id` | SET NULL | yes |

### → `maintenance_records` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `nfpa_inspection_details` | `maintenance_record_id` | CASCADE | no |

### → `manual_ballot_batches` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `manual_ballot_attestations` | `batch_id` | CASCADE | no |

### → `member_dues` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `dues_payments` | `member_dues_id` | CASCADE | no |

### → `minutes_templates` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `meeting_minutes` | `template_id` | SET NULL | yes |

### → `notification_rules` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `notification_logs` | `rule_id` | SET NULL | yes |

### → `public_portal_api_keys` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `public_portal_access_log` | `api_key_id` | SET NULL | yes |

### → `recertification_pathways` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `renewal_tasks` | `pathway_id` | CASCADE | no |

### → `requirement_progress` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `requirement_progress_credits` | `progress_id` | CASCADE | no |

### → `screening_requirements` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `screening_records` | `requirement_id` | SET NULL | yes |

### → `shift_equipment_checks` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `shift_equipment_check_items` | `check_id` | CASCADE | no |

### → `shift_templates` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `shift_patterns` | `template_id` | SET NULL | yes |

### → `skill_templates` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `skill_tests` | `template_id` | CASCADE | no |

### → `skill_tests` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `skill_test_viewers` | `test_id` | CASCADE | no |

### → `store_product_variants` (1 references)

| From table | Column | On delete | Nullable |
|---|---|---|---|
| `store_order_items` | `variant_id` | SET NULL | yes |

---

## Tables without `organization_id`

These tables are not directly tenant-scoped. Each must reach its organization through a parent row, so **every query against one has to join through an org-scoped parent** (CLAUDE.md pitfall #14a). This list is the review checklist for multi-tenant isolation.

| Table | Scoped via |
|---|---|
| `approval_chain_steps` | `approval_chains`, `email_templates` |
| `approval_step_records` | `approval_chain_steps`, `approval_chains`, `users` |
| `audit_log_checkpoints` | — _(root table)_ |
| `audit_ship_state` | — _(root table)_ |
| `blocked_access_attempts` | `users` |
| `candidates` | `elections`, `users` |
| `check_template_compartments` | `check_template_compartments`, `equipment_check_templates` |
| `check_template_items` | `apparatus_equipment`, `check_template_compartments`, `inventory_items` |
| `compliance_profiles` | `compliance_configs` |
| `country_block_rules` | `users` |
| `department_message_reads` | `department_messages`, `users` |
| `email_attachments` | `email_templates`, `users` |
| `equipment_kit_items` | `equipment_kits`, `inventory_categories`, `inventory_items` |
| `event_request_activity` | `event_requests`, `users` |
| `expense_line_items` | `budgets`, `expense_reports` |
| `form_fields` | `forms` |
| `grant_budget_items` | `grant_applications` |
| `grant_compliance_tasks` | `grant_applications`, `users` |
| `grant_expenditures` | `grant_applications`, `grant_budget_items`, `users` |
| `grant_notes` | `grant_applications`, `users` |
| `ip_exception_audit_log` | `ip_exceptions`, `users` |
| `meeting_motions` | `meeting_minutes` |
| `membership_pipeline_steps` | `email_templates`, `membership_pipelines` |
| `minutes_action_items` | `meeting_minutes`, `users` |
| `onboarding_sessions` | — _(root table)_ |
| `onboarding_status` | — _(root table)_ |
| `organizations` | — _(root table)_ |
| `password_history` | `users` |
| `program_milestones` | `program_phases`, `training_programs` |
| `program_phases` | `training_programs` |
| `program_requirements` | `program_phases`, `training_programs`, `training_requirements` |
| `prospect_activity_log` | `prospective_members`, `users` |
| `prospect_documents` | `membership_pipeline_steps`, `prospective_members`, `users` |
| `prospect_election_packages` | `elections`, `membership_pipeline_steps`, `membership_pipelines`, `prospective_members` |
| `prospect_event_links` | `events`, `prospective_members`, `users` |
| `prospect_interviews` | `membership_pipeline_steps`, `membership_pipelines`, `prospective_members`, `users` |
| `prospect_step_progress` | `membership_pipeline_steps`, `prospective_members`, `users` |
| `requirement_progress` | `program_enrollments`, `training_requirements`, `users` |
| `requirement_progress_credits` | `requirement_progress`, `users` |
| `rsvp_history` | `event_rsvps`, `events`, `users` |
| `sessions` | `users` |
| `shift_attendance` | `shifts`, `users` |
| `shift_equipment_check_items` | `check_template_items`, `shift_equipment_checks` |
| `skill_test_viewers` | `skill_tests`, `users` |
| `user_positions` | `positions`, `users` |
| `votes` | `candidates`, `elections`, `users` |

